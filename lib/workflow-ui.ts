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
  for (const key of ['title', 'subject', 'objective', 'mission']) {
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
  const lines: string[] = []
  const visit = (value: unknown, prefix: string, depth: number) => {
    const object = record(value)
    if (!object || depth > 3 || lines.length >= 6) return
    const heading = subject(object)
    if (heading) lines.push(`${prefix}${heading}`)
    for (const [key, item] of Object.entries(object)) {
      if (lines.length >= 6) break
      if (
        /^(id|goal_id|task_id|status|state|stage|phase|revision|currentRevision|baseRevision|sequence|mode|freshness|error|reason|outcome|automatic|next_action|nextAction)$/.test(
          key,
        ) &&
        (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
      ) {
        lines.push(`${prefix}${key}: ${short(item)}`)
      } else if (/^(blockers|completion_issues|issues|conflicts)$/.test(key) && Array.isArray(item)) {
        const open =
          key === 'blockers'
            ? item.filter(
                (entry) => record(entry)?.status !== 'resolved' && record(entry)?.status !== 'closed',
              )
            : item
        lines.push(
          `${prefix}${key}: ${open.length}${open.length ? ` · ${short(typeof open[0] === 'string' ? open[0] : (subject(open[0]) ?? record(open[0])?.reason ?? record(open[0])?.summary ?? record(open[0])?.status ?? 'details on expand'))}` : ''}`,
        )
      } else if (/^(tasks|criteria|evidence|lanes|checks|results|items)$/.test(key) && Array.isArray(item)) {
        lines.push(`${prefix}${key}: ${item.length}`)
      } else if (/^(goal|workflow|run|report|task|result|data|state)$/.test(key) && record(item))
        visit(item, `${prefix}${key}.`, depth + 1)
      else if (item === null && /^(goal|workflow|run|report)$/.test(key)) lines.push(`${prefix}${key}: none`)
    }
  }
  visit(details, '', 0)
  return lines
}

class WorkflowText implements Component {
  private lines: string[]
  private theme: Theme
  private tone: 'muted' | 'warning' | 'error'
  private expanded: boolean
  private outputPad: number
  constructor(
    lines: string[],
    theme: Theme,
    tone: 'muted' | 'warning' | 'error',
    expanded = false,
    outputPad = 0,
  ) {
    this.lines = lines
    this.theme = theme
    this.tone = tone
    this.expanded = expanded
    this.outputPad = outputPad
  }
  invalidate() {}
  render(width: number): string[] {
    if (width <= 0) return []
    // No guessed character widths, including during offline/non-TUI bootstrap.
    if (!geometry) return ['.'.repeat(Math.min(3, Math.floor(width)))]
    const padding = ' '.repeat(Math.min(Math.max(0, Math.floor(this.outputPad)), Math.floor((width - 1) / 2)))
    const innerWidth = width - padding.length * 2
    const wrapped: string[] = []
    for (const line of this.lines) {
      const safe = clean(line)
      if (!this.expanded) wrapped.push(geometry.truncateToWidth(safe, innerWidth))
      else wrapped.push(...geometry.wrapTextWithAnsi(safe, innerWidth))
    }
    return wrapped.map((line) =>
      geometry!.truncateToWidth(`${padding}${this.theme.fg(this.tone, line)}${padding}`, width),
    )
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
      return new WorkflowText(
        [
          `${label(name)}${operation ? ` · ${short(operation)}` : ''} · ${context.executionStarted ? 'pending' : 'requested'}`,
          ...(title ? [title] : []),
        ],
        theme,
        'muted',
        false,
        context.outputPad,
      )
    },
    renderResult(result, options, theme, context) {
      const summary = workflowSummary(result.details)
      const object = record(result.details)
      const failed = context.isError || Boolean(object?.error) || object?.ok === false
      const state = failed ? 'error' : options.isPartial ? 'partial · pending' : 'result (not acceptance)'
      const text = result.content
        .map((part) =>
          part.type === 'text' ? part.text : `[${part.type} content retained in native result]`,
        )
        .join('\n')
      const lines = options.expanded
        ? [
            `${label(name)} · ${state}`,
            text,
            ...(result.details === undefined ? [] : ['Details', json(result.details)]),
          ].flatMap((line) => line.split('\n'))
        : [
            `${label(name)} · ${state}`,
            ...summary,
            ...(summary.length ? [] : [short(text)]),
            'Expand for captured output/details',
          ]
      return new WorkflowText(
        lines,
        theme,
        failed ? 'error' : options.isPartial ? 'warning' : 'muted',
        options.expanded,
        context.outputPad,
      )
    },
  }
}
