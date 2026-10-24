import type {
  ExtensionAPI,
  ExtensionContext,
  ToolInfo,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type {
  PermissionsService,
  PermissionsReadyEvent,
  PermissionDecisionEvent,
} from '@gotgenes/pi-permission-system'
import type { SubagentsService } from '@gotgenes/pi-subagents'
import type { GuardRegistry } from './types.ts'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createGuardHost } from './host.mjs'
import { isAbsolute, relative, resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { evidenceGitCommand } from './evidence-git.mjs'
import { rtkBinding } from '../rtk-state.ts'
import { registerRTK } from '../rtk.ts'
import { createOwnUIOwner } from './own-ui.ts'
import { resolveAgentDir } from '../setup.ts'
import { selectMemoryLease } from './memory-lease.ts'
import { createInstalledMemoryOwner, readMemorySelection } from '../agent-memory/profile.ts'
import { installedWriter, preflightWriterRoute } from '../agent-memory/writer-route.ts'
import { resolveRunBinding } from '../execution-run/store.ts'
import { featureCapability } from '../feature-data.ts'
import {
  buildManagedMemoryABI,
  type MemoryABIV2,
  type ManagedMemoryABI,
} from '../agent-memory/experimental-contracts.ts'

const registryKey = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
const shared = globalThis as typeof globalThis & { [registryKey]?: GuardRegistry }
const nodes = (shared[registryKey] ??= new Map() as GuardRegistry)
// Shared across extension instances: session-created precedes child binding.
// Keep identities for the process lifetime so disposed children cannot become roots.
const nativeChildren = (nodes.nativeChildren ??= new Set())
const nativeParents = (nodes.nativeParents ??= new Map())
const memoryLeases = (nodes.memoryLeases ??= new Map())
// Omitted helper paths are not `input.path`, so the public convention cannot
// see them. Explicit paths and these defaults must both reach the path gate.
const HELPER_DEFAULT_PATHS: Record<string, string | undefined> = {
  mh_npm_config: '.npmrc',
  mh_env_config: '.env',
  mh_pypi_config: '.pypirc',
}
const helperAccessPath = (fallback: string) => (input: Record<string, unknown>) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  if (Object.hasOwn(input, 'path')) {
    const value = input.path
    return typeof value === 'string' && value.length > 0 && !value.includes('\0') ? value : undefined
  }
  return fallback
}
const registerHelperExtractors = (service: PermissionsService | undefined) => {
  if (!service?.registerToolAccessExtractor) return
  for (const [name, fallback] of Object.entries(HELPER_DEFAULT_PATHS)) {
    if (!fallback || service.getToolAccessExtractor?.(name)) continue
    service.registerToolAccessExtractor(name, helperAccessPath(fallback))
  }
}
const finalPathSurface = (toolName: string) =>
  toolName === 'write'
    ? 'path_write'
    : ['read', 'grep', 'find', 'ls'].includes(toolName)
      ? 'path_read'
      : 'path'

const memoryPermission = (root: string) => {
  if (typeof root !== 'string' || !isAbsolute(root) || root !== resolve(root))
    throw new Error('Canonical managed-memory root required')
  return `managed_memory_${createHash('sha256').update(root).digest('hex')}`
}

// A scoped scalar permission: native unknown-surface maps do not match paths.
const learningPermission = (root: string) => {
  if (typeof root !== 'string' || !isAbsolute(root) || root !== resolve(root))
    throw new Error('Continuity learning root must be canonical and absolute')
  return `continuity_learning_${createHash('sha256').update(root).digest('hex')}`
}

const resolveGoalProfile = () => {
  const override = process.env.PI_CODING_AGENT_DIR
  const value =
    override === '~'
      ? homedir()
      : override?.startsWith('~/')
        ? join(homedir(), override.slice(2))
        : override || join(homedir(), '.pi/agent')
  if (!isAbsolute(value) || resolve(value) !== value || realpathSync(value) !== value)
    throw new Error('Canonical Goal profile required')
  return value
}

// Load this exact local package root, alongside the exact local upstream roots.
// Child excludedExtensionPackages must contain the subagents package SOURCE,
// never this adapter or permission-system. Upstream's default exclusion is empty.
export default async function activate(pi: ExtensionAPI) {
  let sdk
  try {
    sdk = await import('@earendil-works/pi-coding-agent')
  } catch (cause) {
    throw new Error('Pi guards inactive: public Pi SDK 1.3.0 peer unavailable; do not run unguarded', {
      cause,
    })
  }
  // Root is also a live local package. Public owners may not have been explicitly
  // installed yet: absence must register real denial, not fail module discovery
  // or silently leave native definitions executable. No cache/sibling fallback.
  // Public defineTool is the SDK's identity-preserving parameter-erasure bridge
  // for heterogeneous registries; it does not replace native schemas/execution.
  const nativeFactory = <Params extends ToolDefinition['parameters'], Details, State>(
    factory: (cwd: string) => ToolDefinition<Params, Details, State>,
  ) => (typeof factory === 'function' ? (cwd: string) => sdk.defineTool(factory(cwd)) : undefined)
  const nativeFactories = {
    read: nativeFactory(sdk.createReadToolDefinition),
    bash: nativeFactory(sdk.createBashToolDefinition),
    grep: nativeFactory(sdk.createGrepToolDefinition),
    find: nativeFactory(sdk.createFindToolDefinition),
    ls: nativeFactory(sdk.createLsToolDefinition),
    write: nativeFactory(sdk.createWriteToolDefinition),
    edit: nativeFactory(sdk.createEditToolDefinition),
    powershell: nativeFactory(sdk.createPowerShellToolDefinition),
  }
  const require = createRequire(import.meta.url)
  const { consumeManagedMemoryFixture, recordMemoryDiagnostic } =
    require('./memory-fixture.mjs') as typeof import('./memory-fixture.mjs')
  const missing = []
  for (const name of ['@gotgenes/pi-subagents', '@gotgenes/pi-permission-system']) {
    try {
      require.resolve(name)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND')) throw error
      missing.push(name)
    }
  }
  if (missing.length) {
    const reason = `Mahiro native guards unavailable: missing declared public owners ${missing.join(', ')}. All tool execution is blocked. Explicit dependency installation in the mahiro-pi checkout requires operator approval; see /mh-guards-status.`
    pi.on('tool_call', () => ({ block: true, reason }))
    pi.on('session_start', (_event, ctx) => {
      nodes.delete(ctx.sessionManager.getSessionId())
      if (ctx.hasUI) ctx.ui.notify(reason, 'error')
    })
    pi.registerCommand('mh-guards-status', {
      description: 'Explain fail-closed native guard dependency availability',
      handler: async (_args, ctx) => {
        ctx.ui.notify(
          reason +
            ' Required after operator approval: pnpm install --offline --frozen-lockfile --ignore-scripts (pnpm 10.33.0); permission-system 40.2.2 + subagents 23.4.1 and both authored patches. No install or activation has been performed.',
          'error',
        )
      },
    })
    for (const factory of Object.values(nativeFactories)) {
      if (typeof factory !== 'function')
        throw Error('Public native tool factory unavailable; startup cannot assure denial')
      pi.registerTool({
        ...factory(process.cwd()),
        async execute() {
          throw Error(reason)
        },
      })
    }
    return
  }
  const { getSubagentsServiceForSession, SUBAGENT_EVENTS } = await import('@gotgenes/pi-subagents')
  const { getPermissionsService } = await import('@gotgenes/pi-permission-system')
  const {
    trustedMetaTool,
    trustedTaskTool,
    trustedRecallTool,
    trustedMemoryTool,
    trustedCodeMapTool,
    trustedGoalTool,
    goalToolNames,
    trustedEvidenceTool,
    uxWorkflowToolNames,
    trustedUXWorkflowTool,
    trustedExecutionRunTool,
    trustedRTKTool,
    trustedOwnUICommand,
  } = await import('./provenance.mjs')
  const host = createGuardHost()
  let sessionId: string
  let sessionManager: ExtensionContext['sessionManager']
  let parentService: SubagentsService | undefined
  let latched = false
  const generation = {}
  const children = new Set<string>()
  const unsubscribes: (() => void)[] = []
  let registered = false
  type Lease = NonNullable<GuardRegistry['memoryLeases']> extends Map<string, infer L> ? L : never
  // Private validator function, not retained authority. Its lease result lives only on the caller's stack.
  let validateMemoryAccess: (...args: Parameters<ManagedMemoryABI['assertAccess']>) => {
    access: ReturnType<ManagedMemoryABI['assertAccess']>
    lease?: Lease
  }
  let memoryModeBound = false
  let memorySelection:
    | {
        root: string
        live: () => boolean
        hold(owner: object): () => void
        onRetire(callback: () => Promise<void>): () => void
        assertTargets: MemoryABIV2['assertTargets']
      }
    | undefined
  let installedMemoryOwner: ReturnType<typeof createInstalledMemoryOwner> | undefined
  let memoryDisabled = false
  let memoryRetiring = false
  let memoryRootRelease: (() => void) | undefined
  const memoryRetirements = new Set<() => Promise<void>>()
  let memoryDisposed: Promise<void> | undefined
  const healthy = (id: string) => nodes.get(id)?.healthy?.() === true
  const ownsContext = (ctx: Pick<ExtensionContext, 'sessionManager'>) =>
    !!sessionId &&
    ctx.sessionManager.getSessionId() === sessionId &&
    nodes.get(sessionId)?.generation === generation &&
    healthy(sessionId) &&
    !latched
  const isPrimarySession = (ctx: Pick<ExtensionContext, 'sessionManager'> & { signal?: AbortSignal }) => {
    if (
      !ownsContext(ctx) ||
      ctx.signal?.aborted ||
      ctx.sessionManager !== sessionManager ||
      nativeChildren.has(sessionId)
    )
      return false
    const header = ctx.sessionManager.getHeader?.()
    return header?.type === 'session' && header.id === sessionId && header.parentSession === undefined
  }
  const abortOwned = () => {
    latched = true
    const service = parentService ?? getSubagentsServiceForSession(sessionManager)
    if (!service) return
    // Conservative cancellation includes healthy siblings and queued work.
    for (const record of service.listAgents()) {
      if (['running', 'queued'].includes(record.status)) service.abort(record.id)
    }
  }
  const getParentService = () => {
    // Root can start before the public owner. Resolve lazily by the exact SDK
    // manager, never by the mutable last-child singleton or a session-id alias.
    const service = sessionManager && getSubagentsServiceForSession(sessionManager)
    if (latched) return undefined
    if (!service) {
      if (parentService) abortOwned()
      return undefined
    }
    if (parentService && service !== parentService) {
      abortOwned()
      return undefined
    }
    parentService = service
    return service
  }
  // Public policy remains the sole resolver. Exact legacy leaf restrictions win;
  // a one-time canonical namespace grant covers only the checked derived leaves.
  const stateCapability = (service: PermissionsService | undefined, prefix: string, root: string) => {
    const leaf = `${prefix}_${createHash('sha256').update(root).digest('hex')}`
    const decision = service?.checkPermission(leaf)
    if (decision?.matchedSurface === leaf || (decision?.source === 'tool' && decision.state !== 'allow'))
      return leaf
    return featureCapability(prefix, root)
  }
  const ownUI = createOwnUIOwner(generation, (ctx, binding, operation, paths) => {
    // Re-read actual public host metadata, never caller-supplied SourceInfo.
    if (!isPrimarySession(ctx) || ctx.mode !== 'tui' || !ctx.hasUI || !trustedOwnUICommand(pi.getCommands()))
      throw Error('Own-UI Root unavailable')
    const profile = resolveAgentDir()
    const root = join(profile, 'preferences/own-ui')
    if (binding && (binding.profile !== profile || binding.root !== root))
      throw Error('Own-UI binding changed')
    const service = getPermissionsService(sessionId)
    // No legacy leaf, RTK, native settings or wildcard capability fallback.
    const capability = featureCapability('own_ui_state', root)
    const grant = service?.checkPermission(capability)
    if (
      grant?.state !== 'allow' ||
      grant.source !== 'tool' ||
      grant.toolName !== capability ||
      grant.matchedSurface !== capability ||
      grant.origin === 'yolo'
    )
      throw Error('Own-UI exact DATA authority required')
    for (const target of [
      join(profile, 'preferences'),
      root,
      join(root, 'state.json'),
      join(root, 'state.lock'),
      ...paths,
    ]) {
      for (const surface of operation === 'read'
        ? ['read', 'path_read']
        : ['read', 'path_read', 'path_write']) {
        const decision = service!.checkPermission(surface, target)
        // The exact DATA grant is independent of the global tool fallback.
        // Explicit read/tool or path restrictions still veto this owner.
        if (
          decision?.state !== 'allow' &&
          (decision?.matchedPattern !== undefined ||
            (decision?.matchedSurface !== undefined && decision.matchedSurface !== '*'))
        )
          throw Error('Own-UI path denied')
      }
    }
  })
  const rtkAccess = (tool: ToolInfo | undefined, ctx: ExtensionContext, root: string, operation = 'read') => {
    const actual = pi.getAllTools().find((item) => item.name === tool?.name)
    const binding = rtkBinding(ctx.cwd)
    if (
      !isPrimarySession(ctx) ||
      !binding ||
      root !== binding.root ||
      !trustedRTKTool(actual) ||
      !trustedRTKTool(tool) ||
      tool.sourceInfo.path !== actual.sourceInfo.path ||
      tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
      !['read', 'write'].includes(operation)
    )
      throw Error('Native preference guard unavailable')
    const service = getPermissionsService(sessionId)
    for (const surface of [tool.name, stateCapability(service, 'rtk_state', root)]) {
      const d = service?.checkPermission(surface)
      if (
        d?.state !== 'allow' ||
        d.source !== 'tool' ||
        d.toolName !== surface ||
        d.matchedSurface !== surface ||
        d.origin === 'yolo'
      )
        throw Error('Preferences require exact tool/root owner winning-surface permissions')
    }
    for (const path of [root, join(root, 'state.json'), join(root, 'state.lock')])
      for (const surface of operation === 'read'
        ? ['read', 'path_read']
        : ['read', 'path_read', 'path_write']) {
        const d = service?.checkPermission(surface, path)
        if (d?.matchedPattern !== undefined && d.state !== 'allow') throw Error('Preference path denied')
      }
  }
  const rtk = registerRTK(pi, {
    access: (ctx, root, operation) =>
      rtkAccess(
        pi.getAllTools().find((t) => t.name === 'mh_rtk'),
        ctx,
        root,
        operation,
      ),
    finalArgs: (name, args, ctx) => host.finalArgs(name, args, ctx),
    permission: (ctx, surface, value) =>
      ownsContext(ctx) ? getPermissionsService(sessionId)?.checkPermission(surface, value) : undefined,
    current: isPrimarySession,
    executionCurrent: (ctx) => ownsContext(ctx) && ctx.sessionManager === sessionManager,
    executionAccess(ctx, root) {
      const binding = rtkBinding(ctx.cwd)
      if (
        !ownsContext(ctx) ||
        ctx.sessionManager !== sessionManager ||
        ctx.signal?.aborted ||
        binding?.root !== root
      )
        throw Error('RTK execution owner unavailable')
      const service = getPermissionsService(sessionId)
      const surface = stateCapability(service, 'rtk_state', root)
      const grant = service?.checkPermission(surface)
      if (
        grant?.state !== 'allow' ||
        grant.source !== 'tool' ||
        grant.matchedSurface !== surface ||
        grant.origin === 'yolo'
      )
        throw Error('RTK installed data authority required')
      for (const target of [root, join(root, 'state.json'), join(root, 'default.json')])
        for (const name of ['read', 'path_read']) {
          const d = service!.checkPermission(name, target)
          if (d.matchedPattern !== undefined && d.state !== 'allow')
            throw Error('RTK execution data path denied')
        }
    },
  })
  // Public path gate rule: only a matched deny or ask is a decision here.
  // An unmatched universal fallback, including ask, stays with that gate.
  // A one-time approval is not recorded as a rule, so a matched ask passes only
  // by consuming an allow decision the gate published this turn for the same
  // surface and path. A path rewritten after that gate has no such decision.
  const pathApprovals = new Map<string, number>()
  const approvalKey = (surface: string, value: string) => `${surface}\0${value}`
  const vetoFinalPath = (toolName: string, args: Record<string, unknown>) => {
    const service = getPermissionsService(sessionId)
    registerHelperExtractors(service)
    const fallback = HELPER_DEFAULT_PATHS[toolName]
    const filePath = fallback
      ? helperAccessPath(fallback)(args)
      : typeof args?.path === 'string' && args.path
        ? args.path
        : undefined
    if (!filePath || !service) return
    const surface = finalPathSurface(toolName)
    const decision = service.checkPermission(surface, filePath)
    if (decision?.matchedPattern === undefined || decision.state === 'allow') return
    if (decision.state === 'ask') {
      const key = approvalKey(surface, filePath)
      const left = pathApprovals.get(key) ?? 0
      if (left > 0) {
        if (left === 1) pathApprovals.delete(key)
        else pathApprovals.set(key, left - 1)
        return
      }
    }
    throw new Error('Native final path permission denied')
  }
  const names = ['read', 'bash', 'grep', 'find', 'ls', 'write', 'edit', 'powershell']
  for (const [name, factory] of Object.entries(nativeFactories)) {
    if (typeof factory !== 'function') {
      host.dispose()
      throw new Error(`Pi guards inactive: missing public native ${name} factory`)
    }
    // Native definitions retain parameters, results, renderers and structured output.
    const native = factory(process.cwd())
    pi.registerTool({
      ...native,
      async execute(id, rawInput, signal, update, ctx) {
        // Native schema validation precedes this final-execution wrapper.
        const input = rawInput as Record<string, unknown>
        if (!ownsContext(ctx)) throw new Error('Pi guard node unhealthy; execution blocked')
        if (name === 'powershell')
          throw new Error('Pi guard: PowerShell classifier unsupported; execution blocked')
        const classifierName =
          ({ find: 'find_files', ls: 'list_dir' } as Record<string, string>)[name] ?? name
        // PSS owns aggregate approval and principal selection. Consume before
        // awaiting transformations; the checker is local to this one execution,
        // not an event/path cache and not usable by RTK preview or DATA control.
        const service = getPermissionsService(sessionId)
        const effectiveBash =
          name === 'bash'
            ? service?.consumeBashApproval?.({
                sessionManager: ctx.sessionManager,
                toolCallId: id,
                command: input.command as string,
              })
            : undefined
        const bashAllowed = (command: string) =>
          effectiveBash
            ? effectiveBash(command)
            : getPermissionsService(sessionId)?.checkPermission('bash', command)?.state === 'allow'
        if (name === 'bash' && !bashAllowed(input.command as string))
          throw Error('Native final Bash permission denied')
        if (signal?.aborted) throw new Error('Pi guard execution cancelled')
        const executionContext = { ...ctx, signal: signal ?? ctx.signal }
        const args = await host.finalArgs(classifierName, input, executionContext)
        const final = name === 'bash' ? await rtk.transform(args, executionContext, effectiveBash) : args
        if (signal?.aborted || !ownsContext(ctx))
          throw new Error('Pi guard node unavailable; execution blocked')
        if (name === 'bash' && !bashAllowed(final.command)) throw Error('Native final Bash permission denied')
        if (name !== 'bash') vetoFinalPath(name, final)
        return native.execute(id, final, signal, update, ctx)
      },
    })
  }
  for (const tool of host.tools.values()) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_id, input, signal, _update, ctx) {
        if (!ownsContext(ctx)) throw new Error('Pi guard node unhealthy; execution blocked')
        const args = await host.finalArgs(tool.name, input, ctx)
        if (signal?.aborted || !ownsContext(ctx))
          throw new Error('Pi guard node unavailable; execution blocked')
        vetoFinalPath(tool.name, args)
        const result = await tool.run({ cwd: ctx.cwd, args, signal })
        if (result.status === 'error') throw new Error(result.error || 'Filtered configuration read failed.')
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          details: result,
        }
      },
    })
  }
  const supported = new Set([...names, ...host.tools.keys(), 'codemode'])
  const ownedChildControl = (tool: ToolInfo | undefined, ctx: ExtensionContext) => {
    if (
      !tool ||
      !['ask_parent', 'notify_parent'].includes(tool.name) ||
      !ownsContext(ctx) ||
      ctx.sessionManager !== sessionManager ||
      ctx.signal?.aborted
    )
      return false
    // Event metadata only locates a candidate. Its current public factory must
    // independently attest the exact child manager and registered definition.
    const parentId = nativeParents.get(sessionId)
    const parent = parentId && nodes.get(parentId)
    return !!parent && parent.healthy() && parent.ownsChildControlTool?.(sessionManager, tool) === true
  }
  unsubscribes.push(
    pi.on('tool_call', (event, ctx) => {
      const tool = pi.getAllTools().find((tool) => tool.name === event.toolName)
      if (event.toolName === 'mh_rtk') {
        try {
          const binding = rtkBinding(ctx.cwd)
          if (!binding) throw Error('RTK disabled')
          const read = event.input?.operation !== 'mode'
          rtkAccess(tool, ctx, binding.root, read ? 'read' : 'write')
        } catch {
          return {
            block: true,
            reason:
              'Pi guard: native preferences require canonical primary context and exact tool/root permissions',
          }
        }
        return
      }
      if (event.toolName === 'mh_execution_run') {
        try {
          const root = join(
            resolveGoalProfile(),
            'workflow/execution-run',
            createHash('sha256').update(ctx.cwd).digest('hex'),
          )
          const abi = nodes.get(sessionId)?.executionRun
          if (!abi) throw Error('Execution Run unavailable')
          abi.assertAccess(tool, ctx, root, event.input?.operation === 'get' ? 'read' : 'write')
        } catch {
          return {
            block: true,
            reason:
              'Pi guard: Execution Run requires canonical primary context and exact tool/root permission',
          }
        }
        return
      }
      if (uxWorkflowToolNames.includes(event.toolName)) {
        try {
          const root = join(
            resolveGoalProfile(),
            'workflow/ux-workflow',
            createHash('sha256').update(ctx.cwd).digest('hex'),
          )
          const abi = nodes.get(sessionId)?.uxWorkflow
          if (!abi) throw Error('UX workflow unavailable')
          abi.assertAccess(tool, ctx, root, event.toolName === 'mh_get_ux_workflow' ? 'read' : 'write')
        } catch {
          return {
            block: true,
            reason: 'Pi guard: UX workflow requires canonical primary context and exact tool/root permission',
          }
        }
        return
      }
      if (event.toolName === 'mh_code_evidence') {
        try {
          const root = join(
            resolveGoalProfile(),
            'workflow/evidence',
            createHash('sha256').update(ctx.cwd).digest('hex'),
          )
          const abi = nodes.get(sessionId)?.evidence
          if (!abi) throw Error('Evidence unavailable')
          abi.assertAccess(tool, ctx, root, event.input?.action === 'get' ? 'read' : 'write')
        } catch {
          return {
            block: true,
            reason:
              'Pi guard: Evidence requires canonical primary context and exact tool plus project-root permission',
          }
        }
        return
      }
      if (goalToolNames.includes(event.toolName)) {
        try {
          const profile = resolveGoalProfile()
          const root = join(profile, 'workflow/goals', createHash('sha256').update(ctx.cwd).digest('hex'))
          const abi = nodes.get(sessionId)?.goal
          if (!abi) throw new Error('Goal unavailable')
          abi.assertAccess(tool, ctx, root, event.toolName === 'mh_get_goal' ? 'read' : 'write')
        } catch {
          return {
            block: true,
            reason:
              'Pi guard: Goal requires canonical primary context and exact tool plus project-root permission',
          }
        }
        return
      }
      if (event.toolName === 'mh_code_map') {
        try {
          nodes.get(sessionId)?.codeMap?.assertAccess(tool, ctx)
        } catch {
          return {
            block: true,
            reason: 'Pi guard: Code Map requires canonical provenance, healthy context and named permission',
          }
        }
        if (!nodes.get(sessionId)?.codeMap) return { block: true, reason: 'Pi guard: Code Map unavailable' }
        return
      }
      if (
        !supported.has(event.toolName) &&
        !trustedMetaTool(tool) &&
        !trustedTaskTool(tool) &&
        !trustedRecallTool(tool) &&
        !trustedMemoryTool(tool) &&
        !ownedChildControl(tool, ctx)
      ) {
        return {
          block: true,
          reason: 'Pi guard: unsupported tool/alias dispatch blocked',
        }
      }
    }),
  )
  unsubscribes.push(
    pi.on('session_start', (_event, ctx) => {
      const id = ctx.sessionManager.getSessionId()
      if ((sessionId && sessionId !== id) || (sessionManager && sessionManager !== ctx.sessionManager)) {
        abortOwned()
        throw new Error('Pi guard session ownership changed; reload required')
      }
      sessionId = id
      sessionManager = ctx.sessionManager
      // Repeated starts must validate, never reset, the already pinned owner.
      getParentService()
      if (!registered) return
      if (!memoryModeBound) {
        const selected = consumeManagedMemoryFixture(ctx.sessionManager, resolveGoalProfile())
        const parentId = nativeParents.get(id)
        const parent = parentId ? nodes.get(parentId) : undefined
        const inherited =
          parent?.healthy() && parent.managedMemory.version === 2 ? parent.managedMemory : undefined
        // A native child inherits only its actual parent; no profile reselection.
        // Explicit fixture capability remains separate and test-only.
        const selection = !selected && !parentId ? readMemorySelection(resolveGoalProfile()) : undefined
        memoryDisabled = selection?.mode === 'off'
        if (selection?.mode === 'engine') installedMemoryOwner = createInstalledMemoryOwner(selection)
        const source =
          selected ??
          (inherited
            ? {
                root: inherited.root,
                live: inherited.live,
                hold: inherited.hold,
              }
            : installedMemoryOwner)
        if (source) {
          memoryRootRelease = selected?.release ?? source.hold(generation)
          memorySelection = {
            root: source.root,
            live: () => !memoryRetiring && source.live(),
            hold: (owner) => {
              if (memoryRetiring) throw Error('Memory Root retiring')
              return source.hold(owner)
            },
            assertTargets(tool, ctx, root, operation, targets) {
              if (!Array.isArray(targets) || targets.length > 32)
                throw Error('Bounded memory targets required')
              const abi = nodes.get(sessionId)?.managedMemory
              if (abi?.version !== 2) throw Error('Memory Root2 required')
              const validated = validateMemoryAccess(tool, ctx, root, operation)
              const access = validated.access
              let ownerId = sessionId
              if (access.kind === 'worker') {
                const parentId = nativeParents.get(sessionId)
                const parent = parentId ? nodes.get(parentId) : undefined
                const lease = validated.lease
                if (!lease || parent?.managedMemory.version !== 2)
                  throw Error('Actual memory parent lease required')
                parent.managedMemory.assertTargets(
                  lease.parentTool,
                  lease.parentContext,
                  root,
                  'write',
                  targets,
                )
                ownerId = lease.ownerId
              }
              const policies = new Set([getPermissionsService(ownerId), getPermissionsService(sessionId)])
              const policyStart = performance.now()
              let checks = 0
              for (const target of targets) {
                if (
                  typeof target !== 'string' ||
                  !isAbsolute(target) ||
                  resolve(target) !== target ||
                  (target !== root && !target.startsWith(`${root}/`))
                )
                  throw Error('Memory target unavailable')
                for (const policy of policies) {
                  if (!policy) throw Error('Memory policy unavailable')
                  for (const surface of operation === 'read'
                    ? ['read', 'path_read']
                    : ['read', 'path_read', 'path_write']) {
                    const decision = policy.checkPermission(surface, target)
                    checks++
                    if (decision?.matchedPattern !== undefined && decision.state !== 'allow') {
                      recordMemoryDiagnostic(root, 'public-pss-denial', {
                        surface,
                        target: relative(root, target),
                      })
                      throw Error('Managed memory path authority required')
                    }
                  }
                }
              }
              recordMemoryDiagnostic(root, 'public-pss-batch', {
                checks,
                duration: performance.now() - policyStart,
              })
              const revalidated = validateMemoryAccess(tool, ctx, root, operation)
              const after = revalidated.access
              if (
                revalidated.lease !== validated.lease ||
                after.kind !== access.kind ||
                (after.kind === 'worker' && access.kind === 'worker' && after.value !== access.value)
              )
                throw Error('Memory batch identity changed')
              if (after.kind === 'primary') return { kind: 'primary' }
              if (!after.value || !('version' in after.value) || after.value.version !== 2)
                throw Error('Memory batch ABI mismatch')
              return { kind: 'worker', value: after.value }
            },
            onRetire(callback) {
              if (memoryRetiring) throw Error('Memory Root retiring')
              memoryRetirements.add(callback)
              return () => {
                memoryRetirements.delete(callback)
              }
            },
          }
        }
        memoryModeBound = true
      }
      // Pi may reject a conflicting tool after its factory has returned while
      // retaining the extension's event handlers. Confirm actual public tool
      // ownership before publishing any health assurance.
      const owner = realpathSync(fileURLToPath(import.meta.url))
      const actualTools = pi.getAllTools()
      const complete = [...names, ...host.tools.keys()].every((name) => {
        const tool = actualTools.find((tool) => tool.name === name)
        // Child tool restrictions can make a registration unreachable. Only
        // publicly dispatchable names need an executable owner in this node.
        if (!tool) return true
        try {
          return realpathSync(tool.sourceInfo.path) === owner
        } catch {
          return false
        }
      })
      if (!complete) {
        registered = false
        host.dispose()
        return
      }
      nodes.set(id, {
        generation,
        host,
        ownUI,
        codeMap: {
          version: 1,
          generation,
          assertAccess(tool, ctx) {
            const actual = pi.getAllTools().find((item) => item.name === 'mh_code_map')
            if (
              !ownsContext(ctx) ||
              ctx.sessionManager !== sessionManager ||
              ctx.signal?.aborted ||
              !trustedCodeMapTool(actual) ||
              !trustedCodeMapTool(tool) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir
            )
              throw new Error('Code Map guard unavailable')
            const grant = getPermissionsService(sessionId)?.checkPermission('mh_code_map')
            // Only the policy owner's ACTUAL winning surface is authority.
            // Old/unpatched services lack this optional attestation and fail closed.
            if (
              grant?.state !== 'allow' ||
              grant.source !== 'tool' ||
              grant.toolName !== 'mh_code_map' ||
              grant.origin === 'yolo' ||
              grant.matchedSurface !== 'mh_code_map'
            )
              throw new Error(
                'Code Map requires existing named permission and owner winning-surface attestation',
              )
          },
        },
        goal: {
          version: 1,
          generation,
          assertAccess(tool, ctx, root, operation = 'read') {
            const actual = pi.getAllTools().find((item) => item.name === tool?.name)
            const profile = resolveGoalProfile()
            const expected = join(
              profile,
              'workflow/goals',
              createHash('sha256').update(ctx.cwd).digest('hex'),
            )
            if (
              !isPrimarySession(ctx) ||
              !trustedGoalTool(actual) ||
              !trustedGoalTool(tool) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              realpathSync(ctx.cwd) !== ctx.cwd ||
              root !== expected ||
              !['read', 'write'].includes(operation)
            )
              throw new Error('Goal guard unavailable')
            const service = getPermissionsService(sessionId)
            const capability = stateCapability(service, 'goal_state', root)
            for (const surface of [tool.name, capability]) {
              const grant = service?.checkPermission(surface)
              if (
                grant?.state !== 'allow' ||
                grant.source !== 'tool' ||
                grant.toolName !== surface ||
                grant.origin === 'yolo' ||
                grant.matchedSurface !== surface
              )
                throw new Error(
                  'Goal requires exact named tool and root permissions with owner winning-surface attestation',
                )
            }
            for (const target of [root, join(root, 'state.json'), join(root, 'state.lock')]) {
              const decision = service?.checkPermission(
                operation === 'read' ? 'path_read' : 'path_write',
                target,
              )
              if (decision?.matchedPattern !== undefined && decision.state !== 'allow')
                throw new Error('Goal path denied')
            }
          },
          async authorize(tool, ctx, root, operation = 'read', signal) {
            nodes.get(sessionId)?.goal.assertAccess(tool, ctx, root, operation)
            if (signal?.aborted || !ownsContext(ctx)) throw new Error('Goal cancelled')
            // No fallback approval or policy parser: existing exact scalar decisions
            // and applicable path denials above are the sole permission owner.
            nodes.get(sessionId)?.goal.assertAccess(tool, ctx, root, operation)
          },
        },
        uxWorkflow: {
          version: 1,
          generation,
          assertAccess(tool, ctx, root, operation = 'read') {
            const actual = pi.getAllTools().find((item) => item.name === tool?.name)
            const expected = join(
              resolveGoalProfile(),
              'workflow/ux-workflow',
              createHash('sha256').update(ctx.cwd).digest('hex'),
            )
            if (
              !isPrimarySession(ctx) ||
              !trustedUXWorkflowTool(actual) ||
              !trustedUXWorkflowTool(tool) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              realpathSync(ctx.cwd) !== ctx.cwd ||
              root !== expected ||
              !['read', 'write'].includes(operation)
            )
              throw Error('UX workflow guard unavailable')
            const service = getPermissionsService(sessionId),
              capability = stateCapability(service, 'ux_workflow_state', root)
            for (const surface of [tool.name, capability]) {
              const grant = service?.checkPermission(surface)
              if (
                grant?.state !== 'allow' ||
                grant.source !== 'tool' ||
                grant.toolName !== surface ||
                grant.origin === 'yolo' ||
                grant.matchedSurface !== surface
              )
                throw Error(
                  'UX workflow requires exact named tool/root permissions and owner winning-surface attestation',
                )
            }
            for (const target of [root, join(root, 'state.json'), join(root, 'state.lock')]) {
              // Every operation reads the old state; a read denial also gates writes.
              for (const surface of operation === 'read'
                ? ['read', 'path_read']
                : ['read', 'path_read', 'path_write']) {
                const decision = service?.checkPermission(surface, target)
                if (decision?.matchedPattern !== undefined && decision.state !== 'allow')
                  throw Error('UX workflow path denied')
              }
            }
          },
          async authorize(tool, ctx, root, operation = 'read', signal) {
            nodes.get(sessionId)?.uxWorkflow.assertAccess(tool, ctx, root, operation)
            if (signal?.aborted || !ownsContext(ctx)) throw Error('UX workflow cancelled')
            nodes.get(sessionId)?.uxWorkflow.assertAccess(tool, ctx, root, operation)
          },
        },
        executionRun: {
          version: 1,
          generation,
          assertAccess(tool, ctx, root, operation = 'read') {
            const actual = pi.getAllTools().find((item) => item.name === 'mh_execution_run')
            const profile = resolveGoalProfile()
            const expected = join(
              profile,
              'workflow/execution-run',
              createHash('sha256').update(ctx.cwd).digest('hex'),
            )
            if (
              !isPrimarySession(ctx) ||
              !trustedExecutionRunTool(actual) ||
              !trustedExecutionRunTool(tool) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              realpathSync(ctx.cwd) !== ctx.cwd ||
              root !== expected ||
              !['read', 'write'].includes(operation) ||
              resolveRunBinding(ctx.cwd)?.root !== root
            )
              throw Error('Execution Run guard unavailable')
            const service = getPermissionsService(sessionId),
              capability = stateCapability(service, 'execution_run_state', root)
            for (const surface of ['mh_execution_run', capability]) {
              const grant = service?.checkPermission(surface)
              if (
                grant?.state !== 'allow' ||
                grant.source !== 'tool' ||
                grant.toolName !== surface ||
                grant.origin === 'yolo' ||
                grant.matchedSurface !== surface
              )
                throw Error(
                  'Execution Run requires exact named tool/root permissions and owner winning-surface attestation',
                )
            }
            for (const target of [root, join(root, 'state.json'), join(root, 'state.lock')]) {
              for (const surface of operation === 'read'
                ? ['read', 'path_read']
                : ['read', 'path_read', 'path_write']) {
                const decision = service?.checkPermission(surface, target)
                if (decision?.matchedPattern !== undefined && decision.state !== 'allow')
                  throw Error('Execution Run path denied')
              }
            }
          },
          async authorize(tool, ctx, root, operation = 'read', signal) {
            nodes.get(sessionId)?.executionRun.assertAccess(tool, ctx, root, operation)
            if (signal?.aborted || !ownsContext(ctx)) throw Error('Execution Run cancelled')
            nodes.get(sessionId)?.executionRun.assertAccess(tool, ctx, root, operation)
          },
        },
        evidence: {
          version: 1,
          generation,
          assertAccess(tool, ctx, root, operation = 'read') {
            const actual = pi.getAllTools().find((item) => item.name === 'mh_code_evidence')
            const expected = join(
              resolveGoalProfile(),
              'workflow/evidence',
              createHash('sha256').update(ctx.cwd).digest('hex'),
            )
            if (
              !isPrimarySession(ctx) ||
              !trustedEvidenceTool(actual) ||
              !trustedEvidenceTool(tool) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              realpathSync(ctx.cwd) !== ctx.cwd ||
              root !== expected ||
              !['read', 'write'].includes(operation)
            )
              throw Error('Evidence guard unavailable')
            const service = getPermissionsService(sessionId),
              capability = stateCapability(service, 'code_evidence_state', root)
            for (const surface of ['mh_code_evidence', capability]) {
              const grant = service?.checkPermission(surface)
              if (
                grant?.state !== 'allow' ||
                grant.source !== 'tool' ||
                grant.toolName !== surface ||
                grant.origin === 'yolo' ||
                grant.matchedSurface !== surface
              )
                throw Error(
                  'Evidence requires exact named tool/root permissions and owner winning-surface attestation',
                )
            }
            for (const target of [root, join(root, 'state.json'), join(root, 'state.lock')]) {
              const decision = service?.checkPermission(
                operation === 'read' ? 'path_read' : 'path_write',
                target,
              )
              if (decision?.matchedPattern !== undefined && decision.state !== 'allow')
                throw Error('Evidence path denied')
            }
          },
          async authorize(tool, ctx, root, operation = 'read', signal) {
            nodes.get(sessionId)?.evidence.assertAccess(tool, ctx, root, operation)
            if (signal?.aborted || !ownsContext(ctx)) throw Error('Evidence cancelled')
            nodes.get(sessionId)?.evidence.assertAccess(tool, ctx, root, operation)
          },
          assertSources(tool, ctx, root, operation, paths) {
            nodes.get(sessionId)?.evidence.assertAccess(tool, ctx, root, operation)
            if (!Array.isArray(paths) || paths.length > 8192) throw Error('Evidence source set unavailable')
            const service = getPermissionsService(sessionId)
            if (!service) throw Error('Evidence source owner unavailable')
            const targets = new Set<string>()
            for (const target of paths) {
              if (
                typeof target !== 'string' ||
                !isAbsolute(target) ||
                resolve(target) !== target ||
                (target !== ctx.cwd && !target.startsWith(ctx.cwd + '/'))
              )
                throw Error('Evidence source outside project')
              // Check the lexical historical path even if missing; never replace
              // it with only a parent decision. Existing ancestors must be canonical.
              const chain = [ctx.cwd]
              let current = ctx.cwd
              for (const part of relative(ctx.cwd, target).split('/').filter(Boolean)) {
                current = join(current, part)
                chain.push(current)
              }
              for (const path of chain) targets.add(path)
            }
            for (const path of targets) {
              for (const surface of ['read', 'path_read']) {
                const decision = service.checkPermission(surface, path)
                if (decision?.matchedPattern !== undefined && decision.state !== 'allow')
                  throw Error('Evidence source read path denied')
              }
              try {
                if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path)
                  throw Error('Evidence source symlink unsupported')
              } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
              }
            }
          },
          async authorizeGit(tool, ctx, root, operation, executable, args, signal) {
            const assert = () => {
              nodes.get(sessionId)?.evidence.assertAccess(tool, ctx, root, operation)
              if (signal?.aborted || !ownsContext(ctx)) throw Error('Evidence Git cancelled')
            }
            assert()
            const command = evidenceGitCommand(executable, args)
            const transformed = await host.finalArgs('bash', { command }, ctx)
            if (transformed.command !== command || Object.keys(transformed).some((key) => key !== 'command'))
              throw Error('Evidence Git transformation rejected')
            assert()
            const service = getPermissionsService(sessionId)
            if (service?.checkPermission('bash', command).state !== 'allow')
              throw Error('Evidence Git requires existing narrow Bash permission')
            for (const target of [ctx.cwd, join(ctx.cwd, '.git')]) {
              for (const surface of ['read', 'path_read']) {
                const decision = service?.checkPermission(surface, target)
                if (decision?.matchedPattern !== undefined && decision.state !== 'allow')
                  throw Error('Evidence Git read path denied')
              }
            }
            assert()
          },
        },
        managedMemory: buildManagedMemoryABI(memorySelection, {
          generation,
          permission: memoryPermission,
          trustedTool: trustedMemoryTool,
          isPrimarySession,
          parentService: () => (isPrimarySession({ sessionManager }) ? getParentService() : undefined),
          assertAccess: (() => {
            validateMemoryAccess = (tool, ctx, root, operation = 'read', target = root) => {
              const expected =
                memorySelection?.root ??
                process.env.MAHIRO_AGENT_MEMORY_ROOT ??
                join(resolveGoalProfile(), 'memory')
              if (memoryDisabled || (memorySelection && !memorySelection.live()))
                throw Error('Memory engine off or retired')
              if (
                !ownsContext(ctx) ||
                ctx.sessionManager !== sessionManager ||
                ctx.signal?.aborted ||
                !trustedMemoryTool(tool) ||
                !['read', 'write'].includes(operation) ||
                !isAbsolute(root) ||
                root !== resolve(root) ||
                !isAbsolute(expected) ||
                root !== resolve(expected) ||
                !isAbsolute(ctx.cwd) ||
                ctx.cwd !== resolve(ctx.cwd)
              )
                throw new Error('Managed memory unavailable')
              if (
                typeof target !== 'string' ||
                !isAbsolute(target) ||
                target !== resolve(target) ||
                (target !== root && !target.startsWith(`${root}/`))
              )
                throw new Error('Managed memory path unavailable')
              const primary = isPrimarySession(ctx)
              let ownerId = sessionId
              let lease
              if (!primary) {
                if (['agent_memory_manage', 'agent_memory_reflect'].includes(tool.name))
                  throw new Error('Managed worker operation unavailable')
                ownerId = nativeParents.get(sessionId)
                const owner = nodes.get(ownerId)
                const outputFile = sessionManager.getSessionFile?.()
                if (!ownerId || !owner?.healthy() || typeof outputFile !== 'string')
                  throw new Error('Native memory binding unavailable')
                lease = selectMemoryLease(memoryLeases.values(), {
                  ownerId,
                  generation: owner.generation,
                  root,
                  version: memorySelection ? 2 : 1,
                  outputFile,
                })
                if (memorySelection) {
                  // ABI2 identity is IO-free. The removed active→store chain does NOT
                  // remove the actual parent's launch-tool/context/path authority.
                  owner.managedMemory.assertAccess(
                    lease.parentTool,
                    lease.parentContext,
                    root,
                    'write',
                    target,
                  )
                }
              }
              const service = getPermissionsService(ownerId)
              const grant = service?.checkPermission(memoryPermission(root))
              const toolGrant = getPermissionsService(sessionId)?.checkPermission(tool.name)
              const path = service?.checkPermission(operation === 'read' ? 'path_read' : 'path_write', target)
              if (
                !service ||
                grant?.state !== 'allow' ||
                grant.source === 'default' ||
                toolGrant?.state !== 'allow' ||
                (path?.matchedPattern !== undefined && path.state !== 'allow')
              )
                throw new Error('Managed memory requires separate existing permission')
              if (memorySelection) {
                const childService = getPermissionsService(sessionId)
                const childRoot =
                  childService === service ? grant : childService?.checkPermission(memoryPermission(root))
                if (childRoot?.state !== 'allow' || childRoot.source === 'default')
                  throw Error('Managed memory child root authority required')
                // A primary policy object occupies both roles. Within this synchronous call,
                // check each identical policy/surface once; no verdict survives an await/call.
                for (const policy of new Set([service, childService])) {
                  for (const surface of operation === 'read'
                    ? ['read', 'path_read']
                    : ['read', 'path_read', 'path_write']) {
                    const decision =
                      policy === service && surface === (operation === 'read' ? 'path_read' : 'path_write')
                        ? path
                        : policy?.checkPermission(surface, target)
                    if (decision?.matchedPattern !== undefined && decision.state !== 'allow')
                      throw Error('Managed memory path authority required')
                  }
                }
              }
              return {
                access: primary ? { kind: 'primary' } : { kind: 'worker', value: lease!.value },
                lease,
              }
            }
            return (...args) => validateMemoryAccess(...args).access
          })(),
          async authorize(tool, ctx, root, operation = 'read', signal) {
            const access = nodes.get(sessionId)!.managedMemory.assertAccess(tool, ctx, root, operation)
            const args = await host.finalArgs(operation === 'read' ? 'read' : 'write', { path: root }, ctx)
            if (args.path !== root || signal?.aborted) throw new Error('Managed memory blocked')
            nodes.get(sessionId)!.managedMemory.assertAccess(tool, ctx, root, operation)
            return access
          },
          bindWorker(tool, ctx, root, jobId, value, active) {
            const parentService = getParentService()
            nodes.get(sessionId)!.managedMemory.assertAccess(tool, ctx, root, 'write')
            if (
              !isPrimarySession(ctx) ||
              typeof active !== 'function' ||
              (memorySelection && active() !== true) ||
              (memorySelection
                ? !('version' in value) || value.version !== 2
                : 'version' in value && value.version === 2) ||
              !parentService ||
              parentService.supportsInitialOutcomeClaim !== true
            )
              throw new Error('Managed memory binding unavailable')
            const record = parentService.getRecord(jobId)
            const role = parentService.getAgentType('managed-memory-writer')
            if (
              !role ||
              !record ||
              record.type !== 'managed-memory-writer' ||
              !['running', 'queued'].includes(record.status) ||
              memoryLeases.has(jobId)
            )
              throw new Error('Managed memory role binding unavailable')
            const route = installedWriter(resolveGoalProfile(), role)
            preflightWriterRoute(ctx, route)
            const lease = {
              ownerId: sessionId,
              generation,
              root,
              jobId,
              service: parentService,
              value,
              active,
              version: memorySelection ? (2 as const) : (1 as const),
              parentTool: tool,
              parentContext: ctx,
            }
            memoryLeases.set(jobId, lease)
            return () => {
              if (memoryLeases.get(jobId) === lease) memoryLeases.delete(jobId)
            }
          },
        }),
        continuity: {
          version: 1,
          generation,
          trustedTool: trustedRecallTool,
          isPrimarySession,
          learningPermission,
          authorizeLearning(ctx, root, target = root) {
            const expected = process.env.MAHIRO_CONTINUITY_ROOT ?? join(resolveGoalProfile(), 'continuity')
            if (
              !isPrimarySession(ctx) ||
              !isAbsolute(root) ||
              root !== resolve(root) ||
              !isAbsolute(expected) ||
              root !== resolve(expected) ||
              !isAbsolute(target) ||
              target !== resolve(target) ||
              (target !== root && !target.startsWith(`${root}/`)) ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd)
            )
              throw new Error('Continuity learning unavailable')
            const service = getPermissionsService(sessionId)
            const pathWrite = service?.checkPermission('path_write', target)
            const learning = service?.checkPermission(learningPermission(root))
            if (
              !service ||
              learning?.state !== 'allow' ||
              learning.source === 'default' ||
              (pathWrite?.matchedPattern !== undefined && pathWrite.state !== 'allow')
            )
              throw new Error('Continuity learning requires existing permission')
          },
          async authorizeRead(tool, path, ctx, signal) {
            if (!ownsContext(ctx) || !trustedRecallTool(tool) || signal?.aborted || !isAbsolute(path))
              throw new Error('Continuity guard unavailable')
            const args = await host.finalArgs('read', { path }, ctx)
            if (
              args.path !== path ||
              Object.keys(args).some((key) => key !== 'path') ||
              !ownsContext(ctx) ||
              signal?.aborted
            )
              throw new Error('Continuity read blocked')
            const service = getPermissionsService(sessionId)
            const outside = relative(ctx.cwd, path)
            const root = process.env.MAHIRO_CONTINUITY_ROOT ?? join(resolveGoalProfile(), 'continuity')
            const capability = `continuity_data_${createHash('sha256').update(root).digest('hex')}`
            const dataGrant = service?.checkPermission(capability)
            const ownedData =
              (path === root || path.startsWith(`${root}/`)) &&
              dataGrant?.state === 'allow' &&
              dataGrant.source === 'tool' &&
              dataGrant.matchedSurface === capability &&
              dataGrant.origin !== 'yolo'
            if (ownedData) {
              for (const surface of ['read', 'path_read', 'external_directory_read']) {
                const d = service!.checkPermission(surface, path)
                if (d.matchedPattern !== undefined && d.state !== 'allow')
                  throw Error('Continuity data path denied')
              }
              const t = service!.checkPermission(tool.name)
              if (t.state !== 'allow' || t.matchedSurface !== tool.name || t.origin === 'yolo')
                throw Error('Continuity named tool authority required')
              return
            }
            const pathRead = service?.checkPermission('path_read', path)
            if (
              !service ||
              service.checkPermission(tool.name).state !== 'allow' ||
              service.checkPermission('read', path).state !== 'allow' ||
              // Native path gate skips only an unmatched universal fallback.
              (pathRead?.matchedPattern !== undefined && pathRead.state !== 'allow') ||
              ((outside === '..' || outside.startsWith('../') || isAbsolute(outside)) &&
                service.checkPermission('external_directory_read', path).state !== 'allow')
            )
              throw new Error('Continuity read requires existing permission')
          },
          // Only the exact current owner may supply this healthy node's service.
          parentService: () =>
            ownsContext({ sessionManager: { getSessionId: () => id } as ExtensionContext['sessionManager'] })
              ? getParentService()
              : undefined,
        },
        ownsChildControlTool(manager, tool) {
          if (
            !ownsContext({ sessionManager }) ||
            !trustedMetaTool(pi.getAllTools().find((entry) => entry.name === 'subagent'))
          )
            return false
          return getParentService()?.ownsChildControlTool?.(manager, tool) === true
        },
        healthy: () =>
          registered &&
          nodes.get(id)?.generation === generation &&
          host.healthy &&
          !!getPermissionsService(id) &&
          !latched,
      })
      rtk.initialize(ctx)
    }),
  )
  unsubscribes.push(
    pi.events.on('permissions:ready', (data) => {
      const event = data as PermissionsReadyEvent | undefined
      registerHelperExtractors(event?.sessionId ? getPermissionsService(event.sessionId) : undefined)
    }),
  )
  unsubscribes.push(
    pi.events.on('permissions:decision', (data) => {
      const event = data as PermissionDecisionEvent | undefined
      if (
        event?.result !== 'allow' ||
        typeof event.value !== 'string' ||
        !['path', 'path_read', 'path_write'].includes(event.surface)
      )
        return
      const key = approvalKey(event.surface, event.value)
      pathApprovals.set(key, (pathApprovals.get(key) ?? 0) + 1)
    }),
  )
  unsubscribes.push(pi.on('turn_end', () => pathApprovals.clear()))
  unsubscribes.push(
    pi.events.on('subagents:child:session-created', (data) => {
      const event = data as { sessionId?: string; parentSessionId?: string }
      if (typeof event.sessionId === 'string') {
        nativeChildren.add(event.sessionId)
        if (typeof event.parentSessionId === 'string')
          nativeParents.set(event.sessionId, event.parentSessionId)
      }
    }),
  )
  unsubscribes.push(
    pi.events.on('subagents:child:bound', (data) => {
      const event = data as { sessionId: string; parentSessionId: string }
      if (typeof event.sessionId === 'string') nativeChildren.add(event.sessionId)
      if (event.parentSessionId !== sessionId) return
      children.add(event.sessionId)
      if (!getParentService() || !healthy(event.sessionId) || latched) abortOwned()
    }),
  )
  unsubscribes.push(
    pi.events.on('subagents:child:disposed', (data) => {
      const event = data as { sessionId: string }
      children.delete(event.sessionId)
    }),
  )
  unsubscribes.push(
    pi.events.on(SUBAGENT_EVENTS.RESUMING, (data) => {
      const event = data as { id: string }
      if (!getParentService()?.getRecord(event.id)) return
      if ([...children].some((id) => !healthy(id))) latched = true
      if (latched) abortOwned()
    }),
  )
  const dispose = () => {
    if (memoryDisposed) return memoryDisposed
    // ABI2 retirement fences admission BEFORE node removal, independently of hook order.
    // Callbacks must fence synchronously, then join only already-started work.
    memoryRetiring = true
    installedMemoryOwner?.retire()
    const drains: Promise<void>[] = []
    if (memorySelection)
      for (const callback of memoryRetirements) {
        try {
          drains.push(callback())
        } catch (error) {
          drains.push(Promise.reject(error))
        }
      }
    registered = false
    if (nodes.get(sessionId)?.generation === generation) nodes.delete(sessionId)
    for (const [jobId, lease] of memoryLeases)
      if (lease.ownerId === sessionId && lease.generation === generation) memoryLeases.delete(jobId)
    host.dispose()
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe?.()
    if (memorySelection) {
      memoryDisposed = Promise.all(drains).then(async () => {
        memoryRootRelease?.()
        memoryRetirements.clear()
        await installedMemoryOwner?.drain()
      })
      return memoryDisposed
    }
  }
  unsubscribes.push(pi.on('session_shutdown', dispose))
  registered = true
}
