import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

export type AttentionFeature = 'goal' | 'evidence' | 'ux' | 'run' | 'memory' | 'rtk'
export const WORKFLOW_ATTENTION_WIDGET = 'mahiro-workflow-attention'
const labels: Record<AttentionFeature, string> = {
  goal: 'Goal',
  evidence: 'Code Evidence',
  ux: 'UX Workflow',
  run: 'Execution Run',
  memory: 'Managed Memory',
  rtk: 'RTK',
}
const statusCommands: Record<AttentionFeature, string> = {
  goal: '/mh-goal status',
  evidence: '/mh-evidence status',
  ux: '/mh-ux status',
  run: '/mh-run status',
  memory: '/mh-memory status',
  rtk: '/mh-rtk status',
}
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

/** Fixed public labels/counts only: never echo private content, paths, reasons or credentials.
 * Shapes come from the canonical owners' structured tool outputs, not their command prose.
 */
export function workflowAttention(feature: AttentionFeature, result: unknown): string | undefined {
  const data = object(result)
  if (!data) return
  if (feature === 'goal') {
    const goal = object(data.goal)
    const blockers = goal?.blockers
    if (Array.isArray(blockers)) {
      const count = blockers.filter((entry) => object(entry)?.status === 'open').length
      if (count) return `${count} open blocker${count === 1 ? '' : 's'}`
    }
  }
  if (feature === 'ux' || feature === 'run') {
    if (Array.isArray(data.open_blockers) && data.open_blockers.length)
      return `${data.open_blockers.length} open blocker${data.open_blockers.length === 1 ? '' : 's'}`
  }
  if (feature === 'evidence') {
    if (object(object(data.repository)?.freshness)?.isCurrent === false)
      return 'repository evidence stale or unassessed'
  }
  if (feature === 'memory') {
    if (data.readiness === 'Needs setup') return 'needs setup'
    if (data.readiness === 'Denied') return 'readiness denied'
    if (data.storage === 'unavailable') return 'storage unavailable'
    if (data.freshness === 'stale') return 'retained view stale'
    if (
      data.state === 'conflict' ||
      data.draft === 'conflict' ||
      (Array.isArray(data.conflict) && data.conflict.length) ||
      (Array.isArray(data.conflicts) && data.conflicts.length)
    )
      return 'memory conflict retained'
    const outcome = object(data.latestAttempt)?.outcome
    if (
      typeof outcome === 'string' &&
      [
        'conflict',
        'native-unsuccessful',
        'not-ready',
        'integration-unavailable',
        'deadline',
        'dispatch-failed',
      ].includes(outcome)
    )
      return `latest attempt: ${outcome}`
    if (typeof data.lastError === 'string' && data.lastError) return 'owner reported an error'
  }
  if (feature === 'rtk' && ['unavailable', 'denied', 'malformed'].includes(String(data.status)))
    return `preview ${data.status}`
}

type Geometry = Pick<typeof import('@earendil-works/pi-tui'), 'truncateToWidth'>
type Display = { owner: symbol; feature: AttentionFeature; rows: string[] }
type Slot = {
  manager: ExtensionContext['sessionManager']
  session: string
  cwd: string
  next: number
  observed: number
  display?: Display
}
// One bounded projection per UI sink, not a state database or per-feature row registry.
// File-loaded native extensions do not share module caches. A versioned realm
// slot coordinates only the ephemeral UI projection, never canonical state.
const slotsKey = Symbol.for('@mahirocoko/pi-workflow:attention-slots:v1')
type Slots = WeakMap<ExtensionContext['ui'], Slot>
const globals = globalThis as typeof globalThis & { [slotsKey]?: Slots }
const slots = (globals[slotsKey] ??= new WeakMap())

/** Capture before awaiting an existing owner operation; observe only its returned structured result.
 * This helper performs no reads, writes, tool execution, polling, persistence or prompt parsing.
 */
export function registerWorkflowAttention(pi: ExtensionAPI) {
  let geometry: Geometry | undefined
  let epoch = 0
  let retired = false
  let child = false
  let binding: { ctx: ExtensionContext; slot: Slot; owner: symbol } | undefined
  const clear = () => {
    const current = binding
    if (
      !current ||
      slots.get(current.ctx.ui) !== current.slot ||
      current.slot.display?.owner !== current.owner
    )
      return
    current.slot.display = undefined
    current.ctx.ui.setWidget(WORKFLOW_ATTENTION_WIDGET, undefined)
  }
  const invalidate = () => {
    epoch++
    clear()
  }
  const bind = async (_event: unknown, ctx: ExtensionContext) => {
    invalidate()
    binding = undefined
    if (retired || child || ctx.mode !== 'tui' || !ctx.hasUI || ctx.sessionManager.getHeader()?.parentSession)
      return
    const captured = epoch
    const manager = ctx.sessionManager
    const session = manager.getSessionId()
    const cwd = ctx.cwd
    if (!session) return
    let slot = slots.get(ctx.ui)
    if (!slot || slot.manager !== manager || slot.session !== session || slot.cwd !== cwd) {
      // A new exact sink binding supersedes the old projection, not another sink's widget.
      ctx.ui.setWidget(WORKFLOW_ATTENTION_WIDGET, undefined)
      slot = { manager, session, cwd, next: 0, observed: 0 }
      slots.set(ctx.ui, slot)
    }
    binding = { ctx, slot, owner: Symbol('workflow-attention-owner') }
    try {
      const loaded = await import('@earendil-works/pi-tui')
      if (!retired && captured === epoch && binding?.ctx === ctx) geometry = loaded
    } catch {
      /* unavailable geometry means no projection, never guessed terminal widths */
    }
  }
  pi.on('session_start', bind)
  pi.on('session_tree', bind)
  pi.on('agent_start', invalidate)
  pi.on('session_before_switch', invalidate)
  pi.on('session_before_fork', invalidate)
  pi.on('session_before_tree', invalidate)
  pi.on('session_shutdown', () => {
    invalidate()
    retired = true
    binding = undefined
  })
  pi.on('before_agent_start', (event) => {
    if (
      /<active_agent\s+name=/.test(event.systemPrompt) ||
      event.systemPrompt.includes("You maintain the primary companion's private managed knowledge")
    ) {
      child = true
      invalidate()
    }
  })
  return {
    capture(ctx: ExtensionContext) {
      const current = binding
      const captured = epoch
      const slot = current?.slot
      const sequence = slot ? ++slot.next : 0
      const valid = () =>
        Boolean(
          !retired &&
            !child &&
            geometry &&
            current &&
            binding === current &&
            captured === epoch &&
            slot &&
            ctx.mode === 'tui' &&
            ctx.hasUI &&
            !ctx.sessionManager.getHeader()?.parentSession &&
            ctx.sessionManager === slot.manager &&
            ctx.sessionManager.getSessionId() === slot.session &&
            ctx.cwd === slot.cwd &&
            slots.get(ctx.ui) === slot &&
            current.ctx.ui === ctx.ui,
        )
      return (feature: AttentionFeature, result: unknown) => {
        if (!valid() || !slot || !current || sequence < slot.observed) return
        slot.observed = sequence
        const attention = workflowAttention(feature, result)
        if (!attention) {
          // An ordinary/empty observation clears only this feature's own prior projection.
          if (slot.display?.owner === current.owner && slot.display.feature === feature) clear()
          return
        }
        const display: Display = {
          owner: current.owner,
          feature,
          rows: [
            `${labels[feature]} · observed status: ${attention}`,
            `${statusCommands[feature]} to review · informational, not a permission gate`,
          ],
        }
        slot.display = display
        ctx.ui.setWidget(
          WORKFLOW_ATTENTION_WIDGET,
          (_tui, theme) => ({
            render: (width) =>
              valid() && slot.display === display && width > 0
                ? display.rows.map((line) => geometry!.truncateToWidth(theme.fg('warning', line), width))
                : [],
            invalidate() {},
          }),
          { placement: 'aboveEditor' },
        )
      }
    },
  }
}
