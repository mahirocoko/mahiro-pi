import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent'

type Command = Parameters<ExtensionAPI['registerCommand']>[1]
type Entry = { name: string; label: string; invoke: (ctx: ExtensionCommandContext) => Promise<void> }
// Native file extensions have independent module caches. Share only ephemeral
// owner callbacks across those loaders, keyed by the exact public manager.
const ownersKey = Symbol.for('@mahirocoko/pi-workflow:hub-surfaces:v1')
type Surfaces = WeakMap<ExtensionContext['sessionManager'], Map<string, Entry>>
const globals = globalThis as typeof globalThis & { [ownersKey]?: Surfaces }
const owners = (globals[ownersKey] ??= new WeakMap())

function primary(ctx: ExtensionContext) {
  return !ctx.sessionManager.getHeader()?.parentSession
}

/** Register the SAME command handler, not a tool executor or a simulated slash message.
 * Entries belong to an active manager/session/generation and carry no workflow state.
 */
export function registerWorkflowCommand(pi: ExtensionAPI, name: string, command: Command) {
  pi.registerCommand(name, command)
  const labels: Record<string, string> = {
    'mh-goal': 'Goal',
    'mh-evidence': 'Code Evidence',
    'mh-ux': 'UX Workflow',
    'mh-run': 'Execution Run',
    'mh-rtk': 'RTK',
    'mh-memory': 'Managed Memory',
  }
  registerWorkflowSurface(pi, {
    id: name,
    label: `${labels[name] ?? name} · /${name}`,
    open: (ctx) => command.handler('status', ctx),
  })
}

export interface WorkflowSurface {
  id: string
  label: string
  open: (ctx: ExtensionCommandContext) => Promise<void> | void
}

/** Owners register navigation only; open must delegate their existing authorized handler. */
export function registerWorkflowSurface(pi: ExtensionAPI, surface: WorkflowSurface) {
  const name = surface.id
  let dispose = () => {}
  let retired = false
  let child = false
  const bind = (_event: unknown, ctx: ExtensionContext) => {
    dispose()
    if (!primary(ctx) || child || retired) return
    const manager = ctx.sessionManager
    const id = manager.getSessionId()
    const cwd = ctx.cwd
    const entries = owners.get(manager) ?? new Map<string, Entry>()
    owners.set(manager, entries)
    let active = true
    const entry: Entry = {
      name,
      label: surface.label,
      async invoke(current) {
        if (
          !active ||
          child ||
          !primary(current) ||
          current.mode !== 'tui' ||
          !current.hasUI ||
          current.sessionManager !== manager ||
          manager.getSessionId() !== id ||
          current.cwd !== cwd ||
          entries.get(name) !== entry
        )
          return
        await surface.open(current)
      },
    }
    entries.set(name, entry)
    dispose = () => {
      active = false
      if (entries.get(name) === entry) entries.delete(name)
    }
  }
  pi.on('session_start', bind)
  pi.on('session_tree', bind)
  pi.on('before_agent_start', (event) => {
    if (
      /<active_agent\s+name=/.test(event.systemPrompt) ||
      event.systemPrompt.includes("You maintain the primary companion's private managed knowledge")
    ) {
      child = true
      dispose()
    }
  })
  // BEFORE events may be cancelled by another extension. Invalidate pending hub
  // interactions there, but retain surfaces until an actual replacement or shutdown.
  const retire = () => {
    retired = true
    dispose()
  }
  pi.on('session_shutdown', retire)
  return retire
}

/** On-demand navigation only. No state database, persistent widget, settings save or mutation. */
export function registerWorkflowHub(pi: ExtensionAPI) {
  let generation = 0
  let child = false
  let retired = false
  pi.on('session_start', () => {
    if (retired) return
    generation++
    child = false
  })
  pi.on('session_shutdown', () => {
    retired = true
  })
  const invalidate = () => {
    generation++
  }
  pi.on('session_before_switch', invalidate)
  pi.on('session_before_fork', invalidate)
  pi.on('session_before_tree', invalidate)
  pi.on('session_shutdown', invalidate)
  pi.on('before_agent_start', (event) => {
    if (
      /<active_agent\s+name=/.test(event.systemPrompt) ||
      event.systemPrompt.includes("You maintain the primary companion's private managed knowledge")
    )
      child = true
  })
  pi.registerCommand('mh', {
    description: 'On-demand workflow navigation; delegates status to canonical feature commands',
    async handler(_args, ctx) {
      if (retired || child || !primary(ctx) || ctx.mode !== 'tui' || !ctx.hasUI) return
      const captured = generation
      const id = ctx.sessionManager.getSessionId()
      const entries = [...(owners.get(ctx.sessionManager)?.values() ?? [])].slice(0, 16)
      if (!entries.length) {
        ctx.ui.notify(
          'Workflow navigation unavailable; use the installed feature commands directly.',
          'warning',
        )
        return
      }
      const selected = await ctx.ui.select(
        'Workflow inspector · owner-authorized status (no creation)',
        entries.map((entry) => entry.label),
      )
      if (retired || captured !== generation || child || ctx.sessionManager.getSessionId() !== id) return
      const entry = entries.find((candidate) => candidate.label === selected)
      if (entry) await entry.invoke(ctx)
    },
  })
}
