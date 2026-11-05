import { stripVTControlCharacters } from 'node:util'
import type { ExtensionAPI, Theme, ToolRenderers } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'

type Geometry = Pick<
  typeof import('@earendil-works/pi-tui'),
  'wrapTextWithAnsi' | 'truncateToWidth' | 'visibleWidth' | 'mixColors' | 'backgroundAnsi'
>
let geometry: Geometry | undefined
let loading: Promise<void> | undefined

/** Public geometry is loaded at lifecycle, never by importing an extension factory. */
export function initializeWorkflowUI(): Promise<void> {
  return (loading ??= import('@earendil-works/pi-tui')
    .then((tui) => {
      geometry = tui
    })
    .catch(() => {
      loading = undefined
    }))
}
export function registerWorkflowPresentation(pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    if (ctx.mode === 'tui') await initializeWorkflowUI()
  })
}

const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return '[Unserializable details]'
  }
}
const labels: Record<string, string> = {
  mh_get_goal: 'Goal · Read',
  mh_create_goal: 'Goal · Create',
  mh_update_goal: 'Goal · Update',
  mh_clear_goal: 'Goal · Clear',
  mh_code_evidence: 'Code Evidence',
  mh_get_ux_workflow: 'UX · Read',
  mh_create_ux_workflow: 'UX · Create',
  mh_update_ux_workflow: 'UX · Update',
  mh_execution_run: 'Execution Run',
  mh_code_map: 'Code Map',
  mh_rtk: 'RTK',
  recall_search: 'Recall · Search',
  recall_read: 'Recall · Read',
  agent_memory_read: 'Memory · Read',
  agent_memory_edit: 'Memory · Edit',
  agent_memory_commit: 'Memory · Integrate',
  agent_memory_manage: 'Memory · Manage',
  agent_memory_reflect: 'Memory · Reflect',
}
function label(name: string) {
  return labels[name] ?? name.replace(/^mh_/, '').replace(/_/g, ' ')
}
function subject(value: unknown): string | undefined {
  const object = record(value)
  if (!object) return
  for (const key of ['title', 'subject', 'objective', 'mission', 'summary']) {
    if (typeof object[key] === 'string') return short(object[key])
    const nested = record(object[key])
    if (typeof nested?.title === 'string') return short(nested.title)
    if (typeof nested?.objective === 'string') return short(nested.objective)
  }
}
function short(value: unknown) {
  const text = clean(String(value)).replace(/\s+/g, ' ')
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)
  let output = '',
    count = 0
  for (const { segment } of segments) {
    if (count++ === 120) return `${output}…`
    output += segment
  }
  return output
}
function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return short(value.trim())
  }
}

/** Only structured result fields are summarized; assistant prose never becomes workflow state. */
export function workflowSummary(details: unknown): string[] {
  if (Array.isArray(details)) {
    const first = record(details[0])
    const sample = firstText(first?.recordId, first?.path, first?.sourceKind)
    return [`hits: ${details.length}${sample ? ` · ${sample}` : ''}`]
  }
  const facts: { priority: number; path: string; text: string }[] = []
  const visit = (value: unknown, prefix: string, depth: number) => {
    const object = record(value)
    if (!object || depth > 3) return
    const add = (key: string, priority: number, text: string) =>
      facts.push({ priority, path: `${prefix}${key}`, text })
    const heading = subject(object)
    if (heading) add('subject', 5, heading)
    for (const [key, item] of Object.entries(object)) {
      if (
        /^(id|goal_id|task_id|status|state|stage|phase|revision|currentRevision|baseRevision|sequence|mode|freshness|error|reason|outcome|automatic|next_action|nextAction|path|committed|remembered|deleted|verdict|candidate|recordId|sourceKind|unavailable)$/.test(
          key,
        ) &&
        (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') &&
        (!/^(committed|remembered|unavailable)$/.test(key) || typeof item === 'boolean') &&
        (!/^(path|candidate)$/.test(key) || (typeof item === 'string' && item.length > 0))
      ) {
        const priority = /^(error|reason)$/.test(key)
          ? 0
          : /^(path|unavailable)$/.test(key)
            ? 1
            : /^(state|status|stage|phase|outcome|committed|remembered|deleted|verdict|candidate|recordId|sourceKind)$/.test(
                  key,
                )
              ? 2
              : /revision/i.test(key)
                ? 3
                : /^(next_action|nextAction)$/.test(key)
                  ? 4
                  : 6
        const text =
          /revision/i.test(key) && typeof item === 'string' && /^[a-f0-9]{12,}$/i.test(item)
            ? item.slice(0, 8) + '…'
            : short(item)
        const captions: Record<string, string> = {
          revision: 'rev',
          currentRevision: 'current rev',
          baseRevision: 'base rev',
        }
        const caption = captions[key] ?? key
        add(key, priority, `${caption}: ${text}`)
      } else if (/^(blockers|completion_issues|issues|conflicts)$/.test(key) && Array.isArray(item)) {
        const open =
          key === 'blockers'
            ? item.filter(
                (entry) => record(entry)?.status !== 'resolved' && record(entry)?.status !== 'closed',
              )
            : item
        add(
          key,
          open.length ? 1 : 6,
          `${key}: ${open.length}${open.length ? ` · ${short(typeof open[0] === 'string' ? open[0] : (record(open[0])?.reason ?? subject(open[0]) ?? record(open[0])?.status ?? 'details on expand'))}` : ''}`,
        )
      } else if (
        /^(tasks|criteria|evidence|lanes|checks|results|items|plan|rules)$/.test(key) &&
        Array.isArray(item)
      ) {
        add(key, 6, `${key}: ${item.length}`)
      } else if (
        /^(goal|workflow|run|report|task|result|data|state|summary|verdict|rewrite)$/.test(key) &&
        record(item)
      )
        visit(item, `${prefix}${key}.`, depth + 1)
      else if (item === null && /^(goal|workflow|run|report)$/.test(key)) add(key, 5, `${key}: none`)
    }
  }
  visit(details, '', 0)
  const ordered = facts
    .sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path, 'en'))
    .map((fact) => fact.text)
  return [...new Set(ordered)].slice(0, 6)
}

type Tone = 'toolTitle' | 'accent' | 'muted' | 'dim' | 'warning' | 'error' | 'toolOutput'
type Segment = { text: string; tone: Tone }
type DiffSpan = { text: string; changed: boolean }
type Line = Segment[] & {
  wrap?: boolean
  maxRows?: number
  diffSide?: 'old' | 'new'
  diffPrefix?: string
  diffBody?: string
  diffSpans?: DiffSpan[]
}
const words = new Intl.Segmenter(undefined, { granularity: 'word' })
const row = (text: string, tone: Tone): Line => [{ text, tone }]
const wrapRow = (segments: Segment[], maxRows = 6): Line => Object.assign(segments, { wrap: true, maxRows })
const diffRow = (side: 'old' | 'new', body: string, spans?: DiffSpan[], maxRows = 6): Line => {
  const prefix = side === 'old' ? '- ' : '+ '
  const segments: Segment[] =
    side === 'old'
      ? [
          { text: prefix, tone: 'error' },
          { text: body, tone: 'muted' },
        ]
      : [
          { text: prefix, tone: 'accent' },
          { text: body, tone: 'toolOutput' },
        ]
  return Object.assign(segments, {
    wrap: true,
    maxRows,
    diffSide: side,
    diffPrefix: prefix,
    diffBody: body,
    diffSpans: spans,
  })
}
function diffWordSpans(
  oldText: string,
  newText: string,
): { oldSpans: DiffSpan[]; newSpans: DiffSpan[] } | undefined {
  if (oldText.length > 4096 || newText.length > 4096) return undefined
  const a = Array.from(words.segment(oldText), (s) => s.segment)
  const b = Array.from(words.segment(newText), (s) => s.segment)
  const work = (a.length + 1) * (b.length + 1)
  if (work > 65536 || a.length > 256 || b.length > 256) return undefined
  const cols = b.length + 1
  const table = new Uint16Array(work)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? 1 + table[(i + 1) * cols + j + 1]!
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!)
    }
  }
  const oldSpans: DiffSpan[] = []
  const newSpans: DiffSpan[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      oldSpans.push({ text: a[i++]!, changed: false })
      newSpans.push({ text: b[j++]!, changed: false })
    } else if (i < a.length && (j === b.length || table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!)) {
      oldSpans.push({ text: a[i++]!, changed: true })
    } else {
      newSpans.push({ text: b[j++]!, changed: true })
    }
  }
  return { oldSpans, newSpans }
}

function callMeta(name: string, args: unknown): { operation?: unknown; title?: string } {
  const object = record(args)
  if (!object) return {}
  if (name === 'agent_memory_edit') {
    const mode =
      object.text === null
        ? 'remove'
        : typeof object.mode === 'string' && object.mode
          ? object.mode
          : 'replace'
    const operation = object.commit === true ? `${mode} + commit` : mode
    const path = typeof object.path === 'string' && object.path ? short(object.path) : undefined
    const section =
      typeof object.section === 'string' && object.section.trim() ? ` #${short(object.section.trim())}` : ''
    return { operation, title: path ? `${path}${section}` : undefined }
  }
  if (name === 'agent_memory_read') {
    const offset =
      typeof object.offset === 'number' && Number.isFinite(object.offset) && object.offset > 0
        ? `from ${Math.floor(object.offset)}`
        : undefined
    const title =
      typeof object.path === 'string' && object.path
        ? short(object.path)
        : typeof object.query === 'string' && object.query
          ? `query: ${short(object.query)}`
          : typeof object.topic === 'string'
            ? `topic: ${object.topic ? short(object.topic) : '(namespaces)'}`
            : undefined
    return { operation: offset, title }
  }
  if (name === 'agent_memory_commit') {
    const operation = object.allowShrink === true ? 'allowShrink' : undefined
    const title =
      typeof object.revision === 'string' && object.revision
        ? `rev ${short(object.revision).slice(0, 8)}…`
        : undefined
    return { operation, title }
  }
  if (name === 'agent_memory_manage') {
    const operation = object.action
    const target =
      typeof object.path === 'string' && object.path
        ? short(object.path)
        : typeof object.text === 'string' && object.text
          ? short(object.text)
          : typeof object.projectId === 'string' && object.projectId
            ? short(object.projectId)
            : typeof object.target === 'string' && object.target
              ? short(object.target)
              : undefined
    return { operation, title: target }
  }
  if (name === 'agent_memory_reflect') {
    const title =
      typeof object.assignment === 'string' && object.assignment ? short(object.assignment) : undefined
    return { title }
  }
  if (name === 'mh_task_update') {
    const operation =
      object.delete === true
        ? 'delete'
        : typeof object.status === 'string' && object.status
          ? object.status
          : undefined
    const title =
      subject(args) ??
      firstText(object.description, typeof object.id === 'string' ? object.id.slice(0, 8) : undefined)
    return { operation, title }
  }
  if (name === 'mh_update_goal') {
    const planLabel = firstText(
      typeof object.plan_text === 'string' && object.plan_text.trim()
        ? typeof object.plan_status === 'string' && object.plan_status
          ? `${object.plan_status}: ${object.plan_text.trim()}`
          : object.plan_text
        : undefined,
      typeof object.plan_note === 'string' && object.plan_note.trim()
        ? typeof object.plan_status === 'string' && object.plan_status
          ? `${object.plan_status}: ${object.plan_note.trim()}`
          : object.plan_note
        : undefined,
      object.plan_status,
    )
    const ruleLabel = firstText(
      typeof object.rule_text === 'string' && object.rule_text.trim()
        ? typeof object.rule_level === 'string' && object.rule_level
          ? `${object.rule_level}: ${object.rule_text.trim()}`
          : object.rule_text
        : undefined,
    )
    return {
      operation: object.action,
      title:
        subject(args) ??
        firstText(
          object.phase,
          object.next_action,
          planLabel,
          ruleLabel,
          object.criterion_id,
          object.blocker_id,
          object.goal_id,
        ),
    }
  }
  if (name === 'mh_clear_goal') {
    return { title: firstText(object.goal_id) }
  }
  if (name === 'mh_code_evidence') {
    const operation =
      object.action === 'record'
        ? [object.action, object.kind, object.result]
            .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
            .join(' · ')
        : object.action
    return {
      operation,
      title: subject(args) ?? firstText(object.command, object.reference, object.base_ref, object.workspace),
    }
  }
  if (name === 'mh_update_ux_workflow') {
    const operation =
      typeof object.action === 'string' && typeof object.verdict === 'string' && object.verdict
        ? `${object.action} · ${object.verdict}`
        : object.action
    return {
      operation,
      title:
        subject(args) ??
        firstText(
          object.problem,
          object.desired_outcome,
          record(object.handoff)?.readiness,
          object.concept_id,
          object.phase,
        ),
    }
  }
  if (name === 'mh_execution_run') {
    const operation =
      typeof object.operation === 'string' && typeof object.action === 'string' && object.action
        ? `${object.operation} · ${object.action}`
        : (object.operation ?? object.action)
    const fallbackTitle = [object.lane_id, object.status ?? object.stage ?? object.blocker_id]
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => short(entry.trim()))
      .join(' · ')
    return {
      operation,
      title: subject(args) ?? (fallbackTitle || undefined),
    }
  }
  if (name === 'mh_rtk') {
    return {
      operation: object.operation,
      title: firstText(object.command, object.mode),
    }
  }
  if (name === 'mh_code_map') {
    return {
      operation: object.intent,
      title: firstText(object.query),
    }
  }
  if (name === 'recall_search') {
    const scope = [
      object.includeGlobal === true ? 'global' : undefined,
      object.crossProject === true ? 'cross-project' : undefined,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join(' + ')
    return {
      operation: scope || undefined,
      title: firstText(object.query),
    }
  }
  if (name === 'recall_read') {
    const query =
      typeof object.query === 'string' && object.query.trim()
        ? `query: ${short(object.query.trim())}`
        : undefined
    return {
      operation: query,
      title: firstText(object.recordId),
    }
  }
  return {
    operation: object.operation ?? object.action,
    title: subject(args),
  }
}

function memoryPreviewLines(name: string, args: unknown, details: unknown, expanded: boolean): Line[] {
  const out = record(details)
  const lines: Line[] = []
  if (name === 'recall_search' && Array.isArray(details)) {
    const limit = expanded ? Number.POSITIVE_INFINITY : 3
    const hits = details
      .map((entry) => record(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    for (const hit of hits.slice(0, limit)) {
      const id = typeof hit.recordId === 'string' && hit.recordId ? hit.recordId : 'hit'
      const quote = typeof hit.quote === 'string' && hit.quote.trim() ? short(hit.quote.trim()) : ''
      lines.push(
        wrapRow(
          [
            { text: `• ${id}`, tone: 'accent' },
            ...(quote ? [{ text: `: ${quote}`, tone: 'toolOutput' as const }] : []),
          ],
          3,
        ),
      )
    }
    if (hits.length > limit) {
      lines.push(row(`  … (${hits.length - limit} more hits)`, 'dim'))
    }
    return lines
  }
  if (name === 'recall_read' && typeof out?.quote === 'string' && out.quote.trim()) {
    const limit = expanded ? Number.POSITIVE_INFINITY : 4
    const quoteLines = out.quote.replace(/\r\n/g, '\n').split('\n')
    for (const line of quoteLines.slice(0, limit)) {
      lines.push(
        wrapRow(
          [
            { text: '│ ', tone: 'muted' },
            { text: line, tone: 'toolOutput' },
          ],
          4,
        ),
      )
    }
    if (quoteLines.length > limit) {
      lines.push(row(`  … (${quoteLines.length - limit} more quote lines)`, 'dim'))
    }
    return lines
  }
  if (name === 'agent_memory_commit' && Array.isArray(out?.files)) {
    const limit = expanded ? Number.POSITIVE_INFINITY : 6
    const files = out.files.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    for (const file of files.slice(0, limit)) {
      lines.push(diffRow('new', file))
    }
    if (files.length > limit) {
      lines.push(row(`  … (${files.length - limit} more integrated files)`, 'dim'))
    }
    return lines
  }
  const input = record(args)
  if (!input) return []
  if (name === 'agent_memory_edit') {
    if (input.text === null) {
      const target =
        typeof input.path === 'string' && input.path
          ? input.path
          : typeof out?.path === 'string' && out.path
            ? out.path
            : 'file'
      return [diffRow('old', `(removed ${target})`)]
    }
    if (typeof input.section === 'string' && input.section.trim()) {
      lines.push(row(`§ ${short(input.section.trim())}`, 'muted'))
    }
    if (input.mode === 'patch' || (typeof input.oldText === 'string' && typeof input.newText === 'string')) {
      const limit = expanded ? Number.POSITIVE_INFINITY : 6
      const oldLines =
        typeof input.oldText === 'string' ? input.oldText.replace(/\r\n/g, '\n').split('\n') : []
      const newLines =
        typeof input.newText === 'string' ? input.newText.replace(/\r\n/g, '\n').split('\n') : []
      const pairedSpans = Array.from({ length: Math.min(oldLines.length, newLines.length) }, (_, index) =>
        diffWordSpans(oldLines[index]!, newLines[index]!),
      )
      for (const [index, line] of oldLines.slice(0, limit).entries()) {
        lines.push(diffRow('old', line, pairedSpans[index]?.oldSpans))
      }
      if (oldLines.length > limit) {
        lines.push(row(`  … (${oldLines.length - limit} more removed lines)`, 'dim'))
      }
      for (const [index, line] of newLines.slice(0, limit).entries()) {
        lines.push(diffRow('new', line, pairedSpans[index]?.newSpans))
      }
      if (newLines.length > limit) {
        lines.push(row(`  … (${newLines.length - limit} more added lines)`, 'dim'))
      }
      return lines
    }
    const body =
      typeof input.text === 'string'
        ? input.text
        : typeof input.newText === 'string'
          ? input.newText
          : undefined
    if (body !== undefined) {
      const limit = expanded ? Number.POSITIVE_INFINITY : 8
      const bodyLines = body.replace(/\r\n/g, '\n').split('\n')
      for (const line of bodyLines.slice(0, limit)) {
        lines.push(diffRow('new', line))
      }
      if (bodyLines.length > limit) {
        lines.push(row(`  … (${bodyLines.length - limit} more lines)`, 'dim'))
      }
      return lines
    }
  }
  if (name === 'agent_memory_manage') {
    if (input.action === 'remember' && typeof input.text === 'string' && input.text.trim()) {
      const limit = expanded ? Number.POSITIVE_INFINITY : 6
      const bodyLines = input.text.replace(/\r\n/g, '\n').split('\n')
      for (const line of bodyLines.slice(0, limit)) {
        lines.push(diffRow('new', line))
      }
      if (bodyLines.length > limit) {
        lines.push(row(`  … (${bodyLines.length - limit} more lines)`, 'dim'))
      }
      return lines
    }
    if (input.action === 'forget') {
      const limit = expanded ? Number.POSITIVE_INFINITY : 6
      const targets = [
        ...(Array.isArray(input.paths) ? input.paths : []),
        ...(Array.isArray(input.sources) ? input.sources : []),
      ].filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      for (const entry of targets.slice(0, limit)) {
        lines.push(diffRow('old', entry))
      }
      if (targets.length > limit) {
        lines.push(row(`  … (${targets.length - limit} more entries)`, 'dim'))
      }
      return lines
    }
  }
  return []
}

class WorkflowText implements Component {
  private lines: Line[]
  private theme: Theme
  private expanded: boolean
  private outputPad: number
  private marker: Segment
  constructor(
    lines: Line[],
    theme: Theme,
    expanded = false,
    outputPad = 0,
    marker: Segment = { text: '⎿', tone: 'dim' },
  ) {
    this.lines = lines
    this.theme = theme
    this.expanded = expanded
    this.outputPad = outputPad
    this.marker = marker
  }
  invalidate() {}
  render(width: number): string[] {
    if (width <= 0) return []
    // No guessed character widths, including during offline/non-TUI bootstrap.
    if (!geometry) return ['.'.repeat(Math.min(3, Math.floor(width)))]
    // At narrow widths spend the available cells on state, not framing or padding.
    const pad = Math.max(0, Math.floor(this.outputPad))
    const framed = width - pad * 2 >= 30
    const padding = framed ? ' '.repeat(pad) : ''
    const innerWidth = width - padding.length * 2 - (framed ? 2 : 0)
    const hasDiffSurface = Boolean(
      typeof geometry.mixColors === 'function' &&
        typeof geometry.backgroundAnsi === 'function' &&
        typeof this.theme.style === 'function' &&
        typeof this.theme.getFgAnsi === 'function' &&
        typeof this.theme.getColorMode === 'function' &&
        this.theme.colors?.toolPendingBg &&
        this.theme.colors?.toolDiffRemoved &&
        this.theme.colors?.toolDiffAdded,
    )
    const darkCanvas = { kind: 'rgb' as const, r: 14, g: 16, b: 20 }
    const surface = hasDiffSurface
      ? this.theme.appearance === 'dark'
        ? geometry.mixColors(this.theme.colors.toolPendingBg, darkCanvas, 0.56, 'srgb')
        : this.theme.colors.toolPendingBg
      : undefined
    const rowAmount = this.theme.appearance === 'dark' ? 0.28 : 0.12
    const wordAmount = this.theme.appearance === 'dark' ? 0.5 : 0.28
    const diffColors =
      hasDiffSurface && surface
        ? {
            old: {
              row: geometry.mixColors(surface, this.theme.colors.toolDiffRemoved, rowAmount, 'srgb'),
              word: geometry.mixColors(surface, this.theme.colors.toolDiffRemoved, wordAmount, 'srgb'),
            },
            new: {
              row: geometry.mixColors(surface, this.theme.colors.toolDiffAdded, rowAmount, 'srgb'),
              word: geometry.mixColors(surface, this.theme.colors.toolDiffAdded, wordAmount, 'srgb'),
            },
          }
        : undefined
    const wrapped: string[] = []
    for (const line of this.lines) {
      if (line.diffSide && diffColors && innerWidth >= 10) {
        const colors = diffColors[line.diffSide]
        const prefix = clean(line.diffPrefix ?? (line.diffSide === 'old' ? '- ' : '+ '))
        const contentWidth = Math.max(1, innerWidth - prefix.length)
        const rowBackground = geometry.backgroundAnsi(colors.row, this.theme.getColorMode())
        const rowForeground = this.theme.getFgAnsi('text')
        const bodyText = line.diffSpans
          ? line.diffSpans
              .map((span) => {
                const safe = clean(span.text)
                return span.changed
                  ? this.theme.style(safe, { bg: colors.word, bold: true }) + rowForeground + rowBackground
                  : safe
              })
              .join('')
          : clean(line.diffBody ?? '')
        const rawRows = geometry.wrapTextWithAnsi(this.theme.fg('text', bodyText), contentWidth)
        const limit = this.expanded ? Number.POSITIVE_INFINITY : (line.maxRows ?? 6)
        const boundedRows =
          rawRows.length > limit
            ? [
                ...rawRows.slice(0, limit - 1),
                geometry.truncateToWidth(`${rawRows[limit - 1]}…`, contentWidth, ''),
              ]
            : rawRows
        for (const [rowIndex, rawRow] of boundedRows.entries()) {
          const lead = rowIndex === 0 ? prefix : ' '.repeat(prefix.length)
          const cut = geometry.truncateToWidth(`${lead}${rawRow}`, innerWidth, '')
          wrapped.push(this.theme.style(`${cut}\x1b[22m`, { fg: 'text', bg: colors.row }))
        }
        continue
      }
      // Sanitize captured data before adding trusted theme styling.
      const styled = line.map(({ text, tone }) => this.theme.fg(tone, clean(text))).join('')
      if (this.expanded) {
        wrapped.push(...geometry.wrapTextWithAnsi(styled, innerWidth))
      } else if (line.wrap && innerWidth >= 20) {
        const rows = geometry.wrapTextWithAnsi(styled, innerWidth)
        const limit = line.maxRows ?? 6
        if (rows.length > limit) {
          wrapped.push(...rows.slice(0, limit - 1))
          wrapped.push(geometry.truncateToWidth(`${rows[limit - 1]}…`, innerWidth))
        } else {
          wrapped.push(...rows)
        }
      } else {
        wrapped.push(geometry.truncateToWidth(styled, innerWidth))
      }
    }
    return wrapped.map((line, index) => {
      const prefix = !framed
        ? ''
        : index === 0
          ? `${this.theme.fg(this.marker.tone, this.marker.text)} `
          : '  '
      return geometry!.truncateToWidth(`${padding}${prefix}${line}${padding}`, width)
    })
  }
}

/** Presentation-only API: spread into an ordinary public tool registration.
 * Execution, raw content/details and native expansion remain untouched.
 */
export function workflowRenderers(name: string): ToolRenderers {
  return {
    // Neutral framing: a native successful return is not workflow success/acceptance.
    renderShell: 'self',
    renderCall(args, theme, context) {
      const { operation, title } = callMeta(name, args)
      // `isPartial` is also used by Pi's HTML exporter when replaying a completed call,
      // so only pre-execution `requested` is truthful at this boundary. Partial/result
      // state belongs to renderResult, where the host supplies the actual result phase.
      const state = !context.executionStarted ? 'requested' : undefined
      return new WorkflowText(
        [
          [
            { text: label(name), tone: 'toolTitle' },
            ...(state ? [{ text: ` · ${state}`, tone: 'dim' as const }] : []),
            ...(operation ? [{ text: ` · ${short(operation)}`, tone: 'accent' as const }] : []),
            ...(title ? [{ text: ` · ${title}`, tone: 'muted' as const }] : []),
          ],
        ],
        theme,
        false,
        context.outputPad,
        { text: '●', tone: 'muted' },
      )
    },
    renderResult(result, options, theme, context) {
      const summary = workflowSummary(result.details)
      const object = record(result.details)
      const failed = context.isError || Boolean(object?.error) || object?.ok === false
      const partial = options.isPartial
      const state = partial
        ? `Partial · pending${failed ? ' · Error' : ''}`
        : failed
          ? 'Error'
          : 'Returned · not acceptance'
      const text = result.content
        .map((part) =>
          part.type === 'text' ? part.text : `[${part.type} content retained in native result]`,
        )
        .join('\n')
      const stateLine = row(state, failed ? 'error' : partial ? 'warning' : 'muted')
      const preview =
        !failed && !partial ? memoryPreviewLines(name, context?.args, result.details, options.expanded) : []
      const lines: Line[] = options.expanded
        ? [
            stateLine,
            ...(preview.length ? [row('Changes', 'muted'), ...preview] : []),
            row('Output', 'muted'),
            ...text.split('\n').map((line) => row(line, 'toolOutput')),
            ...(result.details === undefined
              ? []
              : [
                  row('Details', 'muted'),
                  ...json(result.details)
                    .split('\n')
                    .map((line) => row(line, 'toolOutput')),
                ]),
          ]
        : [
            stateLine,
            ...((summary.length ? summary.join(' · ') : short(text))
              ? [row(summary.length ? summary.join(' · ') : short(text), 'muted')]
              : []),
            ...preview,
          ]
      return new WorkflowText(lines, theme, options.expanded, context.outputPad)
    },
  }
}
