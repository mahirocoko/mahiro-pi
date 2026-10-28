import { stripVTControlCharacters } from 'node:util'
import type { ExtensionAPI, Theme, ToolRenderers } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'

type Geometry = Pick<typeof import('@earendil-works/pi-tui'), 'wrapTextWithAnsi' | 'truncateToWidth'>
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
  mh_rtk: 'RTK',
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

/** Only structured result fields are summarized; assistant prose never becomes workflow state. */
export function workflowSummary(details: unknown): string[] {
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
        /^(id|goal_id|task_id|status|state|stage|phase|revision|currentRevision|baseRevision|sequence|mode|freshness|error|reason|outcome|automatic|next_action|nextAction)$/.test(
          key,
        ) &&
        (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
      ) {
        const priority = /^(error|reason)$/.test(key)
          ? 0
          : /^(state|status|stage|phase|outcome)$/.test(key)
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
      } else if (/^(tasks|criteria|evidence|lanes|checks|results|items)$/.test(key) && Array.isArray(item)) {
        add(key, 6, `${key}: ${item.length}`)
      } else if (/^(goal|workflow|run|report|task|result|data|state)$/.test(key) && record(item))
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
type Line = Segment[]
const row = (text: string, tone: Tone): Line => [{ text, tone }]

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
    const wrapped: string[] = []
    for (const line of this.lines) {
      // Sanitize captured data before adding trusted theme styling.
      const styled = line.map(({ text, tone }) => this.theme.fg(tone, clean(text))).join('')
      if (!this.expanded) wrapped.push(geometry.truncateToWidth(styled, innerWidth))
      else wrapped.push(...geometry.wrapTextWithAnsi(styled, innerWidth))
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
      const operation = record(args)?.operation ?? record(args)?.action
      const title = subject(args)
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
      const lines: Line[] = options.expanded
        ? [
            stateLine,
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
          ]
      return new WorkflowText(lines, theme, options.expanded, context.outputPad)
    },
  }
}
