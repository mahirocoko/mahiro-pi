import { basename } from 'node:path'
import type { ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent'
import { text } from './status.ts'

export const COLORS = {
  folder: '#8C8CF9',
  git: '#64CF64',
  dirty: '#FEE19C',
  activity: '#20B2AA',
  context: '#BEBEEE',
  separator: '#46484A',
  label: '#A5A8AB',
  error: '#F1689F',
} as const
export interface Geometry {
  visibleWidth(value: string): number
  truncateToWidth(value: string, width: number, ellipsis?: string): string
}
export interface Segment {
  text: string
  color: string
}
// Presentation ranges refer only to sanitized plain cell text. Keep Segment's
// public shape unchanged; only this footer's authored cells carry highlights.
type Highlight = { start: number; end: number; color: string }
const highlights = new WeakMap<Segment, Highlight[]>()
const highlight = (part: Segment, ranges: Highlight[]): Segment => {
  highlights.set(part, ranges)
  return part
}
const paintCell = (part: Segment, value: string, offset = 0): string => {
  const ranges = highlights.get(part)
  if (!ranges?.length) return paint(value, part.color)
  // Public geometry can append ANSI resets even to plain truncated input.
  const plain = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  let result = '',
    cursor = 0
  for (const range of ranges) {
    const start = Math.max(0, range.start - offset)
    const end = Math.min(plain.length, range.end - offset)
    if (end <= start) continue
    if (start > cursor) result += paint(plain.slice(cursor, start), part.color)
    result += paint(plain.slice(start, end), range.color)
    cursor = end
  }
  if (cursor < plain.length) result += paint(plain.slice(cursor), part.color)
  return result
}
// Called only for the context/quota projection, never arbitrary identity/status
// cells. Anchor to the final ten-cell bar and percentage, not label-like text.
const footerBar = (part: Segment): Segment => {
  const bar = /[▰▱]{10} \d+(?:\.\d+)?%(?: stale)?$/.exec(part.text)
  if (!bar) return part
  const empty = bar[0].indexOf('▱')
  return empty < 0
    ? part
    : highlight(part, [
        {
          start: bar.index + empty,
          end: bar.index + 10,
          color: COLORS.label,
        },
      ])
}
export const paint = (value: string, hex: string) => {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((v) => parseInt(v, 16))
  return `\x1b[38;2;${rgb.join(';')}m${value}\x1b[0m`
}
export function tokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`
  return `${Math.round(count / 1000000)}M`
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

// Match Pi 1.3's full-session footer scan, not the post-compaction branch.
// Each entry contributes once; cache hit rate is from the latest assistant only.
export function usageStats(entries: readonly SessionEntry[]) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  let cacheHit: number | undefined
  for (const entry of entries) {
    const message = entry.type === 'message' ? entry.message : undefined
    const usage =
      entry.type === 'usage' || entry.type === 'compaction' || entry.type === 'branch_summary'
        ? entry.usage
        : message?.role === 'assistant' || message?.role === 'toolResult'
          ? message.usage
          : undefined
    if (!usage) continue
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
      if (finite(usage[key])) totals[key] += usage[key]
    }
    if (finite(usage.cost?.total)) totals.cost += usage.cost.total
    if (message?.role === 'assistant') {
      const prompt = usage.input + usage.cacheRead + usage.cacheWrite
      cacheHit = finite(prompt) && prompt > 0 ? (usage.cacheRead / prompt) * 100 : undefined
    }
  }
  return { ...totals, cacheHit }
}

// Never infer a route just because a different provider appeared somewhere in
// history. A virtual selection and a successful physical response on the active
// branch are both required. Public context supplies the routed capacity.
export function routeLabel(ctx: Pick<ExtensionContext, 'model' | 'sessionManager'>): string {
  if (ctx.model?.api !== 'pi-virtual') return ''
  const branch = ctx.sessionManager.getBranch()
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i]
    if (entry.type === 'model_change') break
    if (entry.type !== 'message' || entry.message.role !== 'assistant') continue
    const m = entry.message
    if (m.api === 'pi-virtual' || m.stopReason === 'error' || m.stopReason === 'aborted') continue
    return `→ ${text(m.provider)}/${text(m.model)}${m.thinkingLevel ? ` r:${text(m.thinkingLevel)}` : ''}`
  }
  return '→ route unknown'
}

// Pack whole semantic cells before wrapping a long cell by grapheme. Geometry
// always comes from Pi TUI in production; no UTF-16 slicing or ANSI arithmetic.
export function pack(parts: Segment[], width: number, geometry: Geometry): string[] {
  if (width <= 0) return []
  const lines: string[] = []
  const separator = paint(' | ', COLORS.separator)
  let line = ''
  for (const part of parts) {
    let value = part.text
    let offset = 0
    const colored = () => paintCell(part, value, offset)
    if (geometry.visibleWidth(value) <= width) {
      if (line && geometry.visibleWidth(line + separator + colored()) > width) {
        lines.push(line)
        line = ''
      }
      line += (line ? separator : '') + colored()
      continue
    }
    if (line) {
      lines.push(line)
      line = ''
    }
    // truncateToWidth returns whole graphemes. Remove that exact plain prefix
    // from the sanitized cell, then continue rather than dropping native data.
    while (value) {
      // Pi TUI appends an ANSI reset even when truncating plain text. Strip
      // that generated suffix before consuming the plain source prefix.
      const chunk = geometry.truncateToWidth(value, width, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      if (!chunk) break // terminal narrower than a single grapheme
      lines.push(paintCell(part, chunk, offset))
      offset += chunk.length
      value = value.slice(chunk.length)
    }
  }
  if (line) lines.push(line)
  return lines
}
// A Pi TUI render request re-renders every transcript component, so periodic
// polls may only request one when this footer's own painted output changed.
export function footerRepaint(lines: (width: number) => string[], request: () => void) {
  let width: number | undefined,
    painted = ''
  return {
    render(next: number) {
      const output = lines(next)
      width = next
      painted = output.join('\n')
      return output
    },
    changed() {
      try {
        if (width !== undefined && lines(width).join('\n') === painted) return
      } catch {
        /* repaint below */
      }
      request()
    },
  }
}
// Sessions are append-only and the leaf moves only by branching, so full-session
// usage and the host's context estimate change only with these inputs.
export function sessionTotals() {
  let key: unknown[] = []
  let value:
    | { stats: ReturnType<typeof usageStats>; context: ReturnType<ExtensionContext['getContextUsage']> }
    | undefined
  return (ctx: ExtensionContext) => {
    const entries = ctx.sessionManager.getEntries()
    const next = [
      ctx.sessionManager.getSessionId?.(),
      ctx.sessionManager.getLeafId?.(),
      entries.length,
      entries.at(-1),
      ctx.model,
    ]
    if (value && next.length === key.length && next.every((part, i) => part === key[i])) return value
    const stats = usageStats(entries)
    try {
      value = { stats, context: ctx.getContextUsage() }
      key = next
    } catch {
      key = []
      return { stats, context: undefined }
    }
    return value
  }
}
export interface FooterState {
  git: string
  activity: string
  hideContext: boolean
  quota: Segment[]
  quotaCompact?: Segment[]
  usageDisplay?: { quota: boolean; style: 'bar' | 'compact' }
}
export interface FooterData {
  getGitBranch(): string | null
  getExtensionStatuses(): ReadonlyMap<string, string>
}
export function renderFooter(
  ctx: ExtensionContext,
  settings: { compaction?: { enabled?: boolean } },
  data: FooterData,
  state: FooterState,
  width: number,
  geometry: Geometry,
  totals = sessionTotals(),
): string[] {
  if (width <= 0) return []
  const cell = (value: string, color: string = COLORS.label): Segment => ({ text: value, color })
  // Core rows never wrap. Truncation and measurement use the host's public geometry.
  const line = (parts: Segment[], budget = width): string => {
    let remaining = Math.max(0, budget)
    const output: string[] = []
    for (const part of parts.filter((part) => part.text)) {
      if (output.length) {
        if (remaining <= 3) break
        output.push(paint(' | ', COLORS.separator))
        remaining -= 3
      }
      const value = geometry.truncateToWidth(text(part.text, 4096), remaining, '')
      output.push(paintCell(part, value))
      remaining -= geometry.visibleWidth(value)
      if (remaining <= 0) break
    }
    return output.join('')
  }
  const pair = (left: Segment[], right: Segment[]): string => {
    const r = line(right)
    const available = width - geometry.visibleWidth(r) - 3
    if (available <= 0) return r
    const l = line(left, available)
    return l + ' '.repeat(width - geometry.visibleWidth(l) - geometry.visibleWidth(r)) + r
  }
  const model = ctx.model
  const effort = ctx.thinkingLevel ? ` | ${text(ctx.thinkingLevel)}` : ''
  const identity = (budget: number) => {
    const suffix = budget >= geometry.visibleWidth(effort) + 4 ? effort : ''
    const name = geometry.truncateToWidth(
      text(model?.name) || text(model?.id) || 'no-model',
      Math.max(1, budget - geometry.visibleWidth(suffix)),
      '',
    )
    const cleanName = text(name, 4096)
    return highlight(
      cell(cleanName + suffix, effort ? COLORS.dirty : COLORS.label),
      suffix
        ? [
            { start: cleanName.length, end: cleanName.length + 3, color: COLORS.separator },
            { start: cleanName.length + 3, end: cleanName.length + suffix.length, color: COLORS.label },
          ]
        : [],
    )
  }
  const branch = text(data.getGitBranch())
  const changes = [
    ['?', '?'],
    ['dirty', '~'],
    ['ahead', '↑'],
    ['behind', '↓'],
  ].flatMap(([key, label]) => {
    const count = state.git.match(new RegExp(`${key === '?' ? '\\?' : key}:(\\d+)`))?.[1]
    return count ? [`${label}${count}`] : []
  })
  const git =
    [branch ? `🌿 ${branch}` : '', ...changes].filter(Boolean).join(' ') ||
    text(state.git.replace(/^git /, ''))
  const gitCell = cell(git, /dirty:|\?:/.test(state.git) ? COLORS.dirty : COLORS.git)
  // Counts are generated operands after the branch, never matches inside a name.
  let changeOffset = branch ? `🌿 ${branch}`.length + 1 : 0
  const countRanges: Highlight[] = []
  for (const change of changes) {
    if (change.startsWith('?') || change.startsWith('~')) {
      countRanges.push({ start: changeOffset, end: changeOffset + change.length, color: COLORS.label })
    }
    changeOffset += change.length + 1
  }
  highlight(gitCell, countRanges)
  const project = [
    cell(`📁 ${text(basename(ctx.cwd))}`, COLORS.folder),
    gitCell,
    ...(['added', 'deleted'] as const).flatMap((key) => {
      const count = state.git.match(new RegExp(`\\b${key}:(\\d+)`))?.[1]
      return count === undefined
        ? []
        : [cell(`${key === 'added' ? '+' : '−'}${count}`, key === 'added' ? COLORS.git : '#FF6068')]
    }),
  ]
  const { stats, context } = totals(ctx)
  const percent = !state.hideContext && finite(context?.percent) ? context.percent : undefined
  const contextCompact = `ctx ${percent === undefined ? '?' : `${percent.toFixed(1)}%`}`
  const filled = percent === undefined ? 0 : Math.round(Math.min(100, percent) / 10)
  const contextLabel =
    percent === undefined
      ? contextCompact
      : `ctx ${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${percent.toFixed(1)}%`
  const contextColor =
    percent !== undefined && percent > 90
      ? COLORS.error
      : percent !== undefined && percent > 70
        ? COLORS.dirty
        : COLORS.context
  const warning = settings.compaction?.enabled === false ? [cell('auto off', COLORS.error)] : []
  const statuses = data.getExtensionStatuses()
  const rtk = text(statuses.get('mahiro-rtk'))
  const native = cell(`↑${tokens(stats.input)} ↓${tokens(stats.output)}`)
  const modelBudget = Math.min(width, Math.max(30, Math.floor(width / 2)))
  const rows =
    width >= 80 ? [pair(project, [identity(modelBudget)])] : [line(project), line([identity(width)])]
  const contextCell = footerBar(
    cell(geometry.visibleWidth(contextLabel) <= width ? contextLabel : contextCompact, contextColor),
  )
  const quota =
    state.usageDisplay?.quota === false
      ? []
      : state.quota.map((part, index) => {
          const full = text(part.text, 4096)
          const compact = text(state.quotaCompact?.[index]?.text ?? full, 4096)
          return footerBar({
            ...part,
            text:
              state.usageDisplay?.style === 'compact' || geometry.visibleWidth(full) > width ? compact : full,
          })
        })
  // Context USED and quota LEFT are adjacent semantic cells. Pack whole cells
  // before wrapping, so narrow terminals never lose a known percentage behind
  // a long label. Native totals/RTK remain visible on additional rows if needed.
  rows.push(
    ...pack([...warning, contextCell, ...quota, native, ...(rtk ? [cell(rtk)] : [])], width, geometry),
  )
  // A virtual route is exceptional evidence, not a repeated ordinary provider.
  const route = routeLabel(ctx)
  if (route) rows.push(...pack([cell(route, COLORS.context)], width, geometry))
  const others = [...statuses]
    .filter(([key]) => key !== 'mahiro-status' && key !== 'mahiro-rtk')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => cell(text(value, 4096)))
  rows.push(...pack(others, width, geometry))
  return rows
}
