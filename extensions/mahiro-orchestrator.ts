import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { SubagentsService, SubagentStatus } from '@gotgenes/pi-subagents'
import { Type } from 'typebox'
import { nodes as sharedNodes } from '../lib/kernel/registry.mjs'
import type { KernelNode, KernelRegistry } from '../lib/kernel/types.ts'

const nodes = sharedNodes as KernelRegistry
const COMMAND = 'mh-orchestrate'
const DISPATCH = 'mh_orchestrate_dispatch'
const STATUS = 'mahiro-orchestrator'
const WRITER = 'implementer'
const terminal = new Set(['completed', 'error', 'stopped', 'aborted'])
const workflowGuidance = [
  'Orchestration is ON for this session. This is a workflow, not permission or a request to do work.',
  'Answer questions and handle small scoped changes yourself. For already authorized implementation where delegation helps, decide the plan, scope, non-goals and checks before calling mh_orchestrate_dispatch. Use it rather than calling subagent directly for this orchestration lane.',
  'Send the writer only the necessary brief, never private memory, credentials or parent conversation history. Return contradictory evidence, two failures of the same check, scope/budget decisions or human gates to Main rather than silently changing the plan.',
  'Use native Subagents completion and get_subagent_result to receive the worker report. Check results before marking existing /mh-todos steps complete. A worker report is not Main review or human acceptance. Do not dispatch more work merely because a completion woke you.',
].join('\n')

type Manager = ExtensionContext['sessionManager']
interface Dispatch {
  callId: string
  input: {
    description: string
    prompt: string
    subagent_type: string
    run_in_background: true
    inherit_context: false
    require_exact_role: true
  }
  abort: AbortController
  service: SubagentsService
  nestedId?: string
}
interface Session {
  manager: Manager
  id: string
  owner: KernelNode
  mode: ExtensionContext['mode']
  ui: ExtensionContext['ui']
  service?: SubagentsService
  enabled: boolean
  modeEpoch: number
  runEpoch?: number
  pending?: Dispatch
  job?: { id: string; description: string; status: SubagentStatus }
  uncertain: boolean
}

const reply = (state: string, text: string, id?: string) => ({
  content: [{ type: 'text' as const, text }],
  details: { state, ...(id ? { agentId: id } : {}) },
})
const real = (path: string | undefined) => {
  try {
    return path && realpathSync.native(path)
  } catch {
    return undefined
  }
}

/** Explicitly loaded trial resource. Never part of the default manifest. */
export default async function mahiroOrchestrator(pi: ExtensionAPI) {
  let pkg: string | undefined
  let getService: ((manager: Manager) => SubagentsService | undefined) | undefined
  let permissionsActive: ((id: string) => boolean) | undefined
  try {
    const entry = createRequire(import.meta.url).resolve('@gotgenes/pi-subagents')
    // The pinned public entry is src/service/service.ts. The registered tool
    // must come from this package owner, not a different tool with the same name.
    pkg = real(resolve(dirname(entry), '../..'))
    getService = (await import('@gotgenes/pi-subagents')).getSubagentsServiceForSession
    const { getPermissionsService } = await import('@gotgenes/pi-permission-system')
    permissionsActive = (id) => !!getPermissionsService(id)
  } catch {
    // Only the optional dispatch lane is unavailable.
  }
  let session: Session | undefined
  let retired = false
  const current = (s: Session) =>
    !retired &&
    session === s &&
    s.manager.getSessionId() === s.id &&
    nodes.get(s.id) === s.owner &&
    s.owner.isPrimarySession({ sessionManager: s.manager })
  const nativeTool = () => {
    const tool = pi.getAllTools().find((entry) => entry.name === 'subagent' && entry.exposure !== 'hidden')
    const properties = (tool?.parameters as { properties?: Record<string, { type?: string }> } | undefined)
      ?.properties
    if (
      pkg &&
      tool?.sourceInfo.origin === 'package' &&
      real(tool.sourceInfo.baseDir) === pkg &&
      real(tool.sourceInfo.path) === join(pkg, 'src/index.ts') &&
      properties?.require_exact_role?.type === 'boolean'
    )
      return tool
  }
  const route = (s: Session) => (current(s) ? getService?.(s.manager) : undefined)
  // PSS owns tool authorization. Optional Root health is not a dispatch grant.
  const guarded = (s: Session) => permissionsActive?.(s.id) === true
  const review = (s: Session) => {
    if (!s.job) return
    const record = route(s) === s.service ? s.service?.getRecord(s.job.id) : undefined
    if (
      !record ||
      record.type !== WRITER ||
      record.description !== s.job.description ||
      !record.isBackground
    ) {
      s.uncertain = true
      return
    }
    s.job.status = record.status
  }
  const liveJob = (s: Session) => !!s.job && !terminal.has(s.job.status)
  const status = (s: Session) => {
    if (s.uncertain) return s.enabled ? 'Orch · unknown' : 'Orch off · unknown'
    if (s.mode === 'rpc') {
      const prefix = s.enabled ? 'Orch' : 'Orch off'
      if (s.pending) return `${prefix} · ${s.enabled ? 'dispatching' : 'cancelling dispatch'}`
      switch (s.job?.status) {
        case 'queued':
          return `${prefix} · implementer queued`
        case 'running':
          return `${prefix} · implementer running`
        case 'completed':
          return `${prefix} · implementer finished (Main review)`
        case 'error':
          return `${prefix} · implementer failed`
        case 'stopped':
          return `${prefix} · implementer stopped`
        case 'aborted':
          return `${prefix} · implementer aborted`
      }
    }
    const busy = !!s.pending || liveJob(s)
    if (!s.enabled) return busy ? 'Orch off · finishing' : 'Orch off'
    if (busy) return 'Orch · worker'
    return s.job ? 'Orch · review' : 'Orch on'
  }
  const paint = (s: Session) => {
    if (session === s && !retired) s.ui.setStatus(STATUS, current(s) ? status(s) : undefined)
  }
  const bind = (ctx: ExtensionContext) => {
    if (retired) return
    if (session) return current(session) && session.manager === ctx.sessionManager ? session : undefined
    const id = ctx.sessionManager.getSessionId()
    const owner = nodes.get(id)
    if (!owner?.isPrimarySession(ctx)) return
    session = {
      id,
      manager: ctx.sessionManager,
      mode: ctx.mode,
      ui: ctx.ui,
      owner,
      enabled: false,
      modeEpoch: 0,
      uncertain: false,
    }
    paint(session)
    return session
  }

  pi.on('resources_discover', (_event, ctx) => {
    bind(ctx)
  })
  const wakeups = [
    'subagents:started',
    'subagents:completed',
    'subagents:failed',
    'subagents:resuming',
    'subagents:resumed',
  ].map((event) =>
    pi.events.on(event, (eventData: unknown) => {
      const s = session
      if (!s || !current(s) || s.job?.id !== (eventData as { id?: unknown } | undefined)?.id) return
      // The event is only a wakeup. Never trust its status, result or role.
      review(s)
      paint(s)
    }),
  )
  pi.on('session_shutdown', (_event, ctx) => {
    if (session && session.manager !== ctx.sessionManager) return
    session?.pending?.abort.abort()
    session?.ui.setStatus(STATUS, undefined)
    retired = true
    session = undefined
    for (const unsubscribe of wakeups) unsubscribe()
  })
  const control = (args: string, ctx: ExtensionContext) => {
    const action = args.trim()
    if (action && action !== 'on' && action !== 'off' && action !== 'status') {
      ctx.ui.notify(`Usage: /${COMMAND} [on|off|status]`, 'warning')
      return
    }
    const s = bind(ctx)
    if (!s) {
      ctx.ui.notify('Orchestrator requires a current guarded primary session.', 'warning')
      return
    }
    const enabled = action === 'status' ? s.enabled : action ? action === 'on' : !s.enabled
    if (enabled !== s.enabled) {
      if (enabled) {
        const service = route(s)
        if (!guarded(s) || !service || !nativeTool() || (s.service && s.service !== service) || s.uncertain) {
          ctx.ui.notify(
            'Orchestrator unavailable: no current exact-role Subagents route or unresolved dispatch.',
            'warning',
          )
          return
        }
      }
      s.enabled = enabled
      s.modeEpoch++
      // Cancel admission, never call abort on a worker owned by Subagents.
      if (!enabled) s.pending?.abort.abort()
    }
    review(s)
    paint(s)
    ctx.ui.notify(status(s), 'info')
  }
  pi.registerCommand(COMMAND, {
    description: 'Show or change orchestration for this session: on, off, status, or toggle',
    handler: async (args, ctx) => control(args, ctx),
  })
  // Pi runs registered commands first. Handle an exact human RPC submission
  // only if it reaches the input path without native command expansion.
  pi.on('input', (event, ctx) => {
    if (ctx.mode !== 'rpc' || event.source !== 'rpc' || event.images?.length) return
    const match = /^\/mh-orchestrate(?:[ \t]+(on|off|status))?$/.exec(event.text.trim())
    if (!match) return
    control(match[1] ?? '', ctx)
    return { action: 'handled' }
  })
  pi.on('before_agent_start', (event, ctx) => {
    const s = bind(ctx)
    const sections = { ...event.systemPromptOptions.sections }
    delete sections[STATUS]
    if (s) {
      review(s)
      paint(s)
      s.runEpoch = s.enabled && !s.uncertain ? s.modeEpoch : undefined
      if (s.runEpoch !== undefined) {
        sections[STATUS] = workflowGuidance
        // Managed Memory can flatten earlier sections before this extension runs.
        if (event.systemPromptOptions.forceSystemPrompt !== undefined)
          event.systemPromptOptions.forceSystemPrompt += `\n\n<${STATUS}>\n${workflowGuidance}\n</${STATUS}>`
      }
    }
    event.systemPromptOptions.sections = sections
  })
  pi.on('agent_settled', (_event, ctx) => {
    if (session?.manager === ctx.sessionManager) session.runEpoch = undefined
  })
  pi.on('tool_call', (event, ctx) => {
    const s = session
    const d = s?.pending
    if (!s || !d || event.toolName !== 'subagent' || event.parentToolCallId !== d.callId) return
    if (
      !s.enabled ||
      s.runEpoch !== s.modeEpoch ||
      !current(s) ||
      ctx.sessionManager !== s.manager ||
      d.abort.signal.aborted ||
      d.service !== route(s) ||
      !guarded(s) ||
      !nativeTool() ||
      d.nestedId ||
      !Object.entries(d.input).every(
        ([key, value]) => key in event.input && (event.input as Record<string, unknown>)[key] === value,
      ) ||
      Object.keys(event.input).length !== Object.keys(d.input).length
    )
      return { block: true, reason: 'Orchestrated dispatch lost its current owner, mode or exact request.' }
    d.nestedId = event.toolCallId
  })
  pi.registerTool({
    name: DISPATCH,
    label: 'Orchestrated writer dispatch',
    description:
      'When /mh-orchestrate is ON, hand one already authorized implementation to the configured implementer. No model override, private context inheritance, new permission, resume or automatic follow-up.',
    parameters: Type.Object(
      {
        description: Type.String({
          minLength: 1,
          maxLength: 100,
          description: 'Short display label for the scoped work.',
        }),
        brief: Type.String({
          minLength: 1,
          maxLength: 6000,
          description:
            'Agreed objective, writable scope, non-goals, checks and evidence the worker should return. No secrets or inherited context.',
        }),
      },
      { additionalProperties: false },
    ),
    reachesTools: () => ['subagent'],
    async execute(callId, input, signal, _update, ctx) {
      const s = session
      if (!s || !current(s) || ctx.sessionManager !== s.manager || !s.enabled)
        return reply('off', 'Orchestration is off or unavailable in this session. No worker was started.')
      if (signal?.aborted || ctx.signal?.aborted) return reply('cancelled', 'No worker was started.')
      review(s)
      if (s.uncertain)
        return reply('unknown', 'Previous dispatch is unresolved. Inspect native Subagents; do not retry.')
      // The facade's own admission may wait in native hooks before execute.
      // An OFF → ON transition never reauthorizes calls from that older run.
      if (s.runEpoch !== s.modeEpoch)
        return reply('stale-mode', 'Orchestration mode changed during this run. Start a fresh Main turn.')
      if (s.pending || liveJob(s))
        return reply(
          'occupied',
          'One orchestrated writer is already in flight. No second worker was started.',
        )
      const service = route(s)
      const tool = nativeTool()
      if (
        !guarded(s) ||
        !service ||
        !tool ||
        (s.service && s.service !== service) ||
        service.getAgentType(WRITER)?.name !== WRITER
      )
        return reply(
          'unavailable',
          'The exact configured implementer route is unavailable. No fallback was started.',
        )
      const label = input.description.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
      if (!label || !input.brief.trim()) return reply('unavailable', 'A label and scoped brief are required.')
      const baseline = new Set(service.listAgents().map((record) => record.id))
      const d: Dispatch = {
        callId,
        service,
        abort: new AbortController(),
        input: {
          description: `${label} [orch ${randomUUID()}]`,
          prompt: `Implement only the supplied scope. If evidence contradicts the plan, the same check fails twice, or continuing needs a new scope, budget or human decision, stop and return the exact blocker and evidence to Main. Never treat your own report as user acceptance.\n\n${input.brief}`,
          subagent_type: WRITER,
          inherit_context: false,
          run_in_background: true,
          require_exact_role: true,
        },
      }
      s.service = service
      s.pending = d
      paint(s)
      try {
        const outcome = await ctx.executeTool('subagent', d.input, {
          signal: AbortSignal.any(
            [d.abort.signal, signal, ctx.signal].filter((value) => value !== undefined),
          ),
        })
        if (!current(s)) return reply('retired', 'This session generation retired; no result was adopted.')
        const now = nativeTool()
        const details = outcome.result.details as
          | { agentId?: unknown; status?: unknown; subagentType?: unknown }
          | undefined
        if (
          route(s) === service &&
          now?.sourceInfo === tool.sourceInfo &&
          now.parameters === tool.parameters
        ) {
          const id = details?.agentId
          const record = typeof id === 'string' ? service.getRecord(id) : undefined
          if (
            !outcome.isError &&
            outcome.toolCall.name === 'subagent' &&
            outcome.toolCall.id === d.nestedId &&
            details?.status === 'background' &&
            details.subagentType === WRITER &&
            typeof id === 'string' &&
            !baseline.has(id) &&
            record?.type === WRITER &&
            record.description === d.input.description &&
            record.isBackground
          ) {
            s.job = { id, description: d.input.description, status: record.status }
            return reply(
              'dispatched',
              'Native Subagents accepted the writer. Wait for its report; dispatch is not completion.',
              id,
            )
          }
          // A pre-execution denial or native refusal is not an owned worker. If
          // anything new exists (or a result claims an id), fail closed instead.
          if (id === undefined && !service.listAgents().some((entry) => !baseline.has(entry.id)))
            return reply(
              'not-started',
              'Native Subagents declined or cancelled the call. No writer was bound.',
            )
        }
        s.uncertain = true
        return reply('unknown', 'Native dispatch could not be verified. Inspect Subagents; do not retry.')
      } catch {
        if (current(s)) s.uncertain = true
        return reply('unknown', 'Native dispatch could not be verified. Inspect Subagents; do not retry.')
      } finally {
        if (s.pending === d) s.pending = undefined
        paint(s)
      }
    },
  })
}
