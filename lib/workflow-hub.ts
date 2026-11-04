import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
} from '@earendil-works/pi-coding-agent'
import type { Component, SelectItem } from '@earendil-works/pi-tui'

type Command = Parameters<ExtensionAPI['registerCommand']>[1]
type Entry = {
  name: string
  label: string
  menuLabel: string
  description: string
  group?: 'workflows'
  invoke: (ctx: ExtensionCommandContext) => Promise<boolean | void>
}
// Native file extensions have independent module caches. Share only ephemeral
// owner callbacks across those loaders, keyed by the exact public manager.
const ownersKey = Symbol.for('@mahirocoko/pi-workflow:hub-surfaces:v1')
type Surfaces = WeakMap<ExtensionContext['sessionManager'], Map<string, Entry>>
const globals = globalThis as typeof globalThis & { [ownersKey]?: Surfaces }
const owners = (globals[ownersKey] ??= new WeakMap())

const HUB_ORDER = ['mh-memory', 'tasks', 'queue', 'mh-rtk', 'usage', 'appearance'] as const
const WORKFLOW_GROUP_LABEL = 'Workflows (Goal / Evidence / UX / Run) ▸'

const DEFAULT_SURFACE_META: Record<string, { menuLabel: string; description: string }> = {
  'mh-memory': {
    menuLabel: 'Managed Memory  open',
    description: 'Project memory, pending proposals, Palace preview and Letta sync · /mh-memory',
  },
  tasks: {
    menuLabel: 'Todos  open',
    description: 'Branch-local session steps, dependencies and retention controls · /mh-todos',
  },
  queue: {
    menuLabel: 'Queue / staging  open',
    description: 'Staged follow-up messages and steer/follow-up queue controls · /mh-queue',
  },
  'mh-rtk': {
    menuLabel: 'RTK  open',
    description: 'Non-executing shell command rewrite preview and mode controls · /mh-rtk',
  },
  usage: {
    menuLabel: 'Usage  open',
    description: 'Native usage bar, compact footer and quota status panel · /mh-usage',
  },
  appearance: {
    menuLabel: 'Appearance  live',
    description: 'Palette, tool style, edit diff and extra detail live preview · /mh-ui',
  },
  'mh-goal': {
    menuLabel: 'Goal  open',
    description: 'Mission objective, plan steps, blockers and human approval · /mh-goal',
  },
  'mh-evidence': {
    menuLabel: 'Code Evidence  open',
    description: 'Recorded verification runs, checks, blockers and clear controls · /mh-evidence',
  },
  'mh-ux': {
    menuLabel: 'UX Workflow  open',
    description: 'Design brief, prototype direction, review and human approval · /mh-ux',
  },
  'mh-run': {
    menuLabel: 'Execution Run  open',
    description: 'Bounded execution run items, pause/resume and clear controls · /mh-run',
  },
}

export type HubMenuItem = {
  value: string
  label: string
  description?: string
}

export function createHubMenuPanel(options: {
  tui: Pick<
    typeof import('@earendil-works/pi-tui'),
    'SelectList' | 'Text' | 'matchesKey' | 'getKeybindings' | 'truncateToWidth'
  >
  title: string
  items: readonly HubMenuItem[]
  hint?: string
  theme: () => Theme
  done: (value: string | undefined) => void
  requestRender: () => void
}): Component & { dispose(): void; readonly menuValues: readonly string[] } {
  let closed = false
  let listTop = 0
  let listHeight = 0
  let renderedWidth = 0
  const finish = (value: string | undefined) => {
    if (closed) return
    closed = true
    options.done(value)
  }
  const choices: SelectItem[] = options.items.map((item) => ({
    value: item.value,
    label: item.label,
    description: item.description,
  }))
  const list = new options.tui.SelectList(choices, Math.min(Math.max(1, choices.length), 12), {
    selectedPrefix: (s) => options.theme().fg('accent', s),
    selectedText: (s) => options.theme().fg('accent', s),
    description: (s) => options.theme().fg('dim', s),
    scrollInfo: (s) => options.theme().fg('dim', s),
    noMatch: (s) => options.theme().fg('dim', s),
  })
  list.onSelectionChange = () => options.requestRender()
  list.onCancel = () => finish(undefined)
  list.onSelect = ({ value }) => finish(value)
  const text = (s: string, width: number) => new options.tui.Text(s, 0, 0).render(Math.max(1, width))
  const hint = options.hint ?? '↑/↓ focus · Enter/Space select · Esc/← back'
  return {
    menuValues: choices.map((c) => c.value),
    render(width) {
      if (width <= 0) return []
      const theme = options.theme()
      const heading = text(theme.bold(theme.fg('accent', options.title)), width)
      const rows = list.render(Math.max(8, width))
      listTop = heading.length + 1
      listHeight = rows.length
      renderedWidth = width
      const focused = list.getSelectedItem()?.value ?? choices[0]?.value
      const description = choices.find((item) => item.value === focused)?.description ?? ''
      return [
        ...heading,
        '',
        ...rows,
        ...(description ? text(description, width) : []),
        ...text(theme.fg('dim', hint), width),
      ].map((line) => options.tui.truncateToWidth(line, width, ''))
    },
    invalidate() {
      list.invalidate()
    },
    handleInput(data) {
      if (closed) return
      if (data === '\x1b[D' || data === '\x1bOD' || data === '\x7f' || data === '\x08') {
        finish(undefined)
        return
      }
      const selectorKeys = options.tui.getKeybindings()
      if (
        selectorKeys.matches(data, 'tui.select.up') ||
        selectorKeys.matches(data, 'tui.select.down') ||
        selectorKeys.matches(data, 'tui.select.confirm') ||
        selectorKeys.matches(data, 'tui.select.cancel')
      )
        list.handleInput(data)
      else if (options.tui.matchesKey(data, 'space')) {
        const selected = list.getSelectedItem()
        if (selected) list.onSelect?.(selected)
      } else list.handleInput(data)
      options.requestRender()
    },
    handleMouse(event) {
      if (closed) return undefined
      if (event.x < 0 || event.x >= renderedWidth || event.y < listTop || event.y >= listTop + listHeight)
        return undefined
      const result = list.handleMouse({ ...event, y: event.y - listTop })
      if (result) options.requestRender()
      return result
    },
    dispose() {
      if (!closed) finish(undefined)
    },
  }
}

/** Open a two-column SelectList menu where Esc, Left Arrow (←) or Backspace cancels/steps back one level. */
export async function selectHubMenu(
  ctx: Pick<ExtensionCommandContext, 'ui'>,
  title: string,
  items: ReadonlyArray<string | HubMenuItem>,
  options?: { hint?: string },
): Promise<string | undefined> {
  const normalized: HubMenuItem[] = items.map((item) =>
    typeof item === 'string' ? { value: item, label: item, description: '' } : item,
  )
  if (typeof ctx.ui.custom === 'function' && ctx.ui.theme) {
    const tui = await import('@earendil-works/pi-tui')
    return await ctx.ui.custom<string | undefined>((screen, theme, _keybindings, done) =>
      createHubMenuPanel({
        tui,
        title,
        items: normalized,
        hint: options?.hint,
        theme: () => ctx.ui.theme ?? theme,
        done,
        requestRender: () => screen.requestRender(),
      }),
    )
  }
  const unsubscribe =
    typeof ctx.ui.onTerminalInput === 'function'
      ? ctx.ui.onTerminalInput((data) => {
          if (data === '\x1b[D' || data === '\x1bOD' || data === '\x7f' || data === '\x08')
            return { data: '\x1b' }
          return undefined
        })
      : undefined
  try {
    return await ctx.ui.select(
      title,
      normalized.map((item) => item.value),
    )
  } finally {
    unsubscribe?.()
  }
}

function primary(ctx: ExtensionContext) {
  return !ctx.sessionManager.getHeader()?.parentSession
}

/** Register the SAME command handler, not a tool executor or a simulated slash message.
 * Entries belong to an active manager/session/generation and carry no workflow state.
 */
export function registerWorkflowCommand(
  pi: ExtensionAPI,
  name: string,
  command: Command,
  options?: {
    open?: (ctx: ExtensionCommandContext) => Promise<boolean | void> | boolean | void
    group?: 'workflows'
  },
) {
  pi.registerCommand(name, command)
  const labels: Record<string, string> = {
    'mh-goal': 'Goal',
    'mh-evidence': 'Code Evidence',
    'mh-ux': 'UX Workflow',
    'mh-run': 'Execution Run',
    'mh-rtk': 'RTK',
    'mh-memory': 'Managed Memory',
  }
  const defaultGroup = ['mh-goal', 'mh-evidence', 'mh-ux', 'mh-run'].includes(name) ? 'workflows' : undefined
  registerWorkflowSurface(pi, {
    id: name,
    label: `${labels[name] ?? name} · /${name}`,
    group: options?.group ?? defaultGroup,
    open: options?.open ?? ((ctx) => command.handler('status', ctx)),
  })
}

export interface WorkflowSurface {
  id: string
  label: string
  menuLabel?: string
  description?: string
  group?: 'workflows'
  open: (ctx: ExtensionCommandContext) => Promise<boolean | void> | boolean | void
}

/** Owners register navigation only; open must delegate their existing authorized handler. */
export function registerWorkflowSurface(pi: ExtensionAPI, surface: WorkflowSurface) {
  const name = surface.id
  const defaults = DEFAULT_SURFACE_META[name]
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
      menuLabel: surface.menuLabel ?? defaults?.menuLabel ?? surface.label,
      description: surface.description ?? defaults?.description ?? '',
      group: surface.group,
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
        return await surface.open(current)
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
    description:
      'On-demand workflow control center; delegates status and actions to canonical feature owners',
    async handler(args, ctx) {
      if (retired || child || !primary(ctx) || ctx.mode !== 'tui' || !ctx.hasUI) return
      const captured = generation
      const id = ctx.sessionManager.getSessionId()
      const stillValid = () =>
        !retired &&
        captured === generation &&
        !child &&
        primary(ctx) &&
        ctx.mode === 'tui' &&
        ctx.hasUI &&
        ctx.sessionManager.getSessionId() === id
      const openWorkflowsGroup = async (workflowEntries: Entry[]): Promise<boolean> => {
        while (stillValid()) {
          const backLabel = '← Back to /mh'
          const picked = await selectHubMenu(
            ctx,
            'Mahiro Workflows · owner-authorized status & safe actions',
            [
              ...workflowEntries.map((entry) => ({
                value: entry.label,
                label: entry.menuLabel,
                description: entry.description,
              })),
              {
                value: backLabel,
                label: '← Back to /mh  esc',
                description: 'Return to Mahiro Control Center',
              },
            ],
            { hint: '↑/↓ focus · Enter/Space select · Esc/← back' },
          )
          if (!stillValid()) return false
          if (!picked || picked === backLabel) return true
          const target = workflowEntries.find((candidate) => candidate.label === picked)
          if (!target) return false
          const reopenGroup = await target.invoke(ctx)
          if (reopenGroup !== true) return false
        }
        return false
      }
      const query = args.trim().toLowerCase()
      if (query) {
        const all = [...(owners.get(ctx.sessionManager)?.values() ?? [])]
        if (query === 'workflows' || query === 'workflow') {
          const wf = all.filter((entry) => entry.group === 'workflows')
          if (wf.length) {
            await openWorkflowsGroup(wf)
            return
          }
        }
        const direct = all.find(
          (entry) =>
            entry.name.toLowerCase() === query ||
            entry.name.toLowerCase() === `mh-${query}` ||
            entry.label.toLowerCase().startsWith(query),
        )
        if (direct) {
          await direct.invoke(ctx)
          return
        }
      }
      while (stillValid()) {
        const rawEntries = [...(owners.get(ctx.sessionManager)?.values() ?? [])]
        if (!rawEntries.length) {
          ctx.ui.notify(
            'Workflow navigation unavailable; use the installed feature commands directly.',
            'warning',
          )
          return
        }
        const workflowEntries = rawEntries.filter((entry) => entry.group === 'workflows')
        const groupWorkflows = workflowEntries.length > 1
        const topEntries = (
          groupWorkflows ? rawEntries.filter((entry) => entry.group !== 'workflows') : rawEntries
        ).sort((a, b) => {
          const ai = HUB_ORDER.indexOf(a.name as (typeof HUB_ORDER)[number])
          const bi = HUB_ORDER.indexOf(b.name as (typeof HUB_ORDER)[number])
          if (ai === -1 && bi === -1) return 0
          if (ai === -1) return 1
          if (bi === -1) return -1
          return ai - bi
        })
        const options: HubMenuItem[] = [
          ...topEntries.map((entry) => ({
            value: entry.label,
            label: entry.menuLabel,
            description: entry.description,
          })),
          ...(groupWorkflows
            ? [
                {
                  value: WORKFLOW_GROUP_LABEL,
                  label: `Workflows  ${workflowEntries.length} surfaces ▸`,
                  description: 'Goal, Code Evidence, UX Workflow and Execution Run controls',
                },
              ]
            : []),
        ].slice(0, 16)
        const selected = await selectHubMenu(
          ctx,
          'Mahiro Control Center · owner-authorized status & controls',
          options,
          { hint: '↑/↓ focus · Enter/Space select · Esc close' },
        )
        if (!stillValid() || !selected) return
        if (groupWorkflows && selected === WORKFLOW_GROUP_LABEL) {
          const reopen = await openWorkflowsGroup(workflowEntries)
          if (reopen) continue
          return
        }
        const entry = topEntries.find((candidate) => candidate.label === selected)
        if (!entry) return
        const reopen = await entry.invoke(ctx)
        if (reopen !== true) return
      }
    },
  })
}
