import { basename } from 'node:path'
import { homedir } from 'node:os'
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
  const separator = paint(' · ', COLORS.separator)
  let line = ''
  for (const part of parts) {
    let value = part.text
    const colored = () => paint(value, part.color)
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
      lines.push(paint(chunk, part.color))
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
  const cell = (value: string, color: string = COLORS.label): Segment => ({ text: value, color })
  const model = ctx.model
  const effort = ctx.thinkingLevel
    ? ` r:${ctx.thinkingLevel === 'medium' ? 'med' : text(ctx.thinkingLevel)}`
    : ''
  const identity = [
    cell('Pi', COLORS.folder),
    cell(
      `[${text(model?.name) || text(model?.id) || 'no-model'}${effort}]`,
      effort ? COLORS.dirty : COLORS.label,
    ),
    ...(model ? [cell(text(model.provider))] : []),
  ]
  const route = routeLabel(ctx)
  if (route) identity.push(cell(route, COLORS.context))
  const home = homedir()
  const cwd =
    ctx.cwd === home ? '~' : ctx.cwd.startsWith(`${home}/`) ? `~${ctx.cwd.slice(home.length)}` : ctx.cwd
  const project = [cell(`📁 ${text(width >= 120 ? cwd : basename(ctx.cwd))}`, COLORS.folder)]
  const branch = text(data.getGitBranch())
  const changes = [
    ['?', '+'],
    ['dirty', '~'],
    ['ahead', '↑'],
    ['behind', '↓'],
  ].flatMap(([key, label]) => {
    const count = state.git.match(new RegExp(`${key === '?' ? '\\?' : key}:(\\d+)`))?.[1]
    return count ? [`${label}${count}`] : []
  })
  const git =
    [branch ? `🌿 ${branch}` : '', ...changes].filter(Boolean).join(' ') || state.git.replace(/^git /, '')
  project.push(cell(git, /dirty:|\?:/.test(state.git) ? COLORS.dirty : COLORS.git))
  const session = text(ctx.sessionManager.getSessionName())
  if (session) project.push(cell(`💬 ${session}`))
  project.push(cell(state.activity.replace(/^tool /, '🔧 '), COLORS.activity))
  const left = pack(project, width, geometry),
    right = pack(identity, width, geometry)
  let rows: string[]
  if (
    left.length === 1 &&
    right.length === 1 &&
    geometry.visibleWidth(left[0]) + geometry.visibleWidth(right[0]) + 3 <= width
  ) {
    rows = [
      left[0] +
        ' '.repeat(width - geometry.visibleWidth(left[0]) - geometry.visibleWidth(right[0])) +
        right[0],
    ]
  } else {
    // Model first on narrow screens; optional project/session never crowds it out.
    rows = [...right, ...left]
  }
  const { stats, context } = totals(ctx)
  const percent = !state.hideContext && finite(context?.percent) ? context.percent : undefined
  const capacity = context?.contextWindow ?? model?.contextWindow
  const contextText = `ctx ${percent === undefined ? '?' : `${percent.toFixed(1)}%`}/${finite(capacity) && capacity > 0 ? tokens(capacity) : '?'} (${settings.compaction?.enabled === false ? 'auto off' : 'auto'})`
  const usage = [
    cell(
      contextText,
      percent !== undefined && percent > 90
        ? COLORS.error
        : percent !== undefined && percent > 70
          ? COLORS.dirty
          : COLORS.context,
    ),
  ]
  usage.push(cell(`↑${tokens(stats.input)} ↓${tokens(stats.output)}`))
  if (stats.cacheRead) usage.push(cell(`R${tokens(stats.cacheRead)}`))
  if (stats.cacheWrite) usage.push(cell(`W${tokens(stats.cacheWrite)}`))
  if ((stats.cacheRead || stats.cacheWrite) && stats.cacheHit !== undefined)
    usage.push(cell(`CH${stats.cacheHit.toFixed(1)}%`))
  const subscription =
    model &&
    (model.provider === 'kimi-coding' ||
      (ctx.modelRegistry.isUsingOAuth(model) &&
        ctx.modelRegistry.getProvider(model.provider)?.auth?.oauth?.isSubscription === true))
  usage.push(cell(`$${stats.cost.toFixed(3)}${subscription ? ' (sub)' : ''}`))
  rows.push(...pack(usage, width, geometry))
  rows.push(...pack(state.quota, width, geometry))
  const others = [...data.getExtensionStatuses()]
    .filter(([key]) => key !== 'mahiro-status')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => cell(text(value, 4096)))
  rows.push(...pack(others, width, geometry))
  return rows
}
