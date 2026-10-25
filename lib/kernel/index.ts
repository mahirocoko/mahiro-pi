import type { ExtensionAPI, ExtensionContext, ToolInfo } from '@earendil-works/pi-coding-agent'
import type { PermissionsService } from '@gotgenes/pi-permission-system'
import type { SubagentsService } from '@gotgenes/pi-subagents'
import type { KernelRegistry } from './types.ts'
import { lstatSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { nodes as sharedNodes, claimKernel } from './registry.mjs'
import { isAbsolute, relative, resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { evidenceGitCommand } from './evidence-git.mjs'
import { rtkBinding } from '../rtk-state.ts'
import { registerRTK } from '../rtk.ts'
import { createOwnUIOwner } from './own-ui.ts'
import { createUsageOwner } from './usage.ts'
import { resolveAgentDir } from '../setup.ts'
import { selectMemoryLease } from './memory-lease.ts'
import { createInstalledMemoryOwner, readMemorySelection } from '../agent-memory/profile.ts'
import { installedWriter, preflightWriterRoute } from '../agent-memory/writer-route.ts'
import { resolveRunBinding } from '../execution-run/store.ts'
import { goalTools } from '../goal/runtime.ts'
import { uxTools } from '../ux-workflow/runtime.ts'
import { featureCapability } from '../feature-data.ts'
import {
  buildManagedMemoryABI,
  type MemoryABIV2,
  type ManagedMemoryABI,
  type EngineWorkerValue,
} from '../agent-memory/experimental-contracts.ts'

// Feature lifecycle is activated by the first bootstrap entry, never by Root.
const nodes = sharedNodes as KernelRegistry
const nativeChildren = nodes.nativeChildren!
const nativeParents = nodes.nativeParents!
const memoryLeases = nodes.memoryLeases!
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

export default async function activateKernel(pi: ExtensionAPI) {
  if (!claimKernel(pi)) return
  const require = createRequire(import.meta.url)
  const { consumeManagedMemoryFixture, recordMemoryDiagnostic } =
    require('../guards/memory-fixture.mjs') as typeof import('../guards/memory-fixture.mjs')
  let hasSubagents = true
  try {
    require.resolve('@gotgenes/pi-subagents')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error
    hasSubagents = false
  }
  // Subagent ownership is optional for ordinary native work, never a builtin
  // classifier prerequisite. Missing capabilities refuse only that family.
  const subagents = !hasSubagents ? undefined : await import('@gotgenes/pi-subagents')
  const getSubagentsServiceForSession = (manager: ExtensionContext['sessionManager']) =>
    subagents?.getSubagentsServiceForSession(manager)
  const { getPermissionsService } = await import('@gotgenes/pi-permission-system')
  // One policy owner: accept its effective allow, including wildcard and yolo.
  // DATA capabilities remain namespace metadata, not an extra feature grant.
  const requireFeaturePermission = (name: string) => {
    const decision = getPermissionsService(sessionId)?.checkPermission(name)
    if (decision?.state !== 'allow')
      throw Error(
        `${name}: PSS permission is ${decision?.state ?? 'unavailable'}; configure this tool in PSS`,
      )
  }
  const requirePrimary = (ctx: ExtensionContext, name: string) => {
    if (!isPrimarySession(ctx))
      throw Error(
        `${name} requires the active primary session; child, fork and retired owners cannot access shared state`,
      )
  }
  // Tool metadata comes from the current public registration at this boundary.
  // No package manifest, realpath/version provenance or guard-health permission.
  const registeredTool = (tool: ToolInfo | undefined, names: readonly string[]): tool is ToolInfo => {
    if (!tool || !names.includes(tool.name)) return false
    const actual = pi.getAllTools().find((item) => item.name === tool.name)
    return (
      !!actual &&
      actual.exposure !== 'hidden' &&
      actual.sourceInfo.path === tool.sourceInfo.path &&
      actual.sourceInfo.baseDir === tool.sourceInfo.baseDir
    )
  }
  const memoryTool = (tool: ToolInfo | undefined): tool is ToolInfo =>
    registeredTool(tool, [
      'agent_memory_read',
      'agent_memory_edit',
      'agent_memory_commit',
      'agent_memory_manage',
      'agent_memory_reflect',
    ])
  const recallTool = (tool: ToolInfo | undefined): tool is ToolInfo =>
    registeredTool(tool, ['recall_search', 'recall_read'])
  const context = {
    async finalArgs<T>(_name: string, input: T, ctx: ExtensionContext): Promise<T> {
      if (!ownsContext(ctx) || ctx.signal?.aborted) throw Error('Feature kernel context retired')
      return structuredClone(input)
    },
  }
  const executionArgs = (name: string, args: Record<string, unknown>, ctx: ExtensionContext) =>
    nodes.get(sessionId)?.execution?.finalArgs(name, args, ctx) ?? context.finalArgs(name, args, ctx)
  let sessionId: string
  let sessionManager: ExtensionContext['sessionManager']
  let parentService: SubagentsService | undefined
  let latched = false
  const generation = {}
  const children = new Set<string>()
  const unsubscribes: (() => void)[] = []
  let registered = false
  type Lease = NonNullable<KernelRegistry['memoryLeases']> extends Map<string, infer L> ? L : never
  // Private validator function, not retained authority. Its lease result lives only on the caller's stack.
  let validateMemoryAccess: (
    ...args: [...Parameters<ManagedMemoryABI['assertAccess']>, maintenance?: boolean]
  ) => {
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
        maintenanceAccess: MemoryABIV2['maintenanceAccess']
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
    ctx.sessionManager === sessionManager &&
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
    if (
      !isPrimarySession(ctx) ||
      ctx.mode !== 'tui' ||
      !ctx.hasUI ||
      pi.getCommands().filter((command) => command.name === 'mh-ui' && command.source === 'extension')
        .length !== 1
    )
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
  const usage = createUsageOwner(generation, (ctx, binding, operation, paths) => {
    // Re-read actual public host metadata, never caller-supplied SourceInfo.
    if (
      !isPrimarySession(ctx) ||
      ctx.mode !== 'tui' ||
      !ctx.hasUI ||
      pi.getCommands().filter((command) => command.name === 'mh-usage' && command.source === 'extension')
        .length !== 1
    )
      throw Error('Usage Root unavailable')
    const profile = resolveAgentDir()
    const root = join(profile, 'preferences/usage')
    if (binding && (binding.profile !== profile || binding.root !== root))
      throw Error('Usage binding changed')
    const service = getPermissionsService(sessionId)
    // No legacy leaf, RTK, native settings or wildcard capability fallback.
    const capability = featureCapability('usage_state', root)
    const grant = service?.checkPermission(capability)
    if (
      grant?.state !== 'allow' ||
      grant.source !== 'tool' ||
      grant.toolName !== capability ||
      grant.matchedSurface !== capability ||
      grant.origin === 'yolo'
    )
      throw Error('Usage exact DATA authority required')
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
          throw Error('Usage path denied')
      }
    }
  })
  const rtkAccess = (tool: ToolInfo | undefined, ctx: ExtensionContext, root: string, operation = 'read') => {
    requirePrimary(ctx, 'mh_rtk')
    const actual = pi.getAllTools().find((item) => item.name === tool?.name)
    const binding = rtkBinding(ctx.cwd)
    if (
      !binding ||
      root !== binding.root ||
      !actual ||
      !registeredTool(tool, ['mh_rtk']) ||
      tool.sourceInfo.path !== actual.sourceInfo.path ||
      tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
      !['read', 'write'].includes(operation)
    )
      throw Error('Native preference guard unavailable')
    const service = getPermissionsService(sessionId)
    requireFeaturePermission(tool.name)
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
    finalArgs: (name, args, ctx) => executionArgs(name, args, ctx),
    permission: (ctx, surface, value) =>
      ownsContext(ctx) ? getPermissionsService(sessionId)?.checkPermission(surface, value) : undefined,
    current: isPrimarySession,
    executionCurrent: (ctx) => ownsContext(ctx) && ctx.sessionManager === sessionManager,
    executionAccess(ctx, root, checkedBinding) {
      const binding = checkedBinding ?? rtkBinding(ctx.cwd)
      if (
        !ownsContext(ctx) ||
        ctx.sessionManager !== sessionManager ||
        ctx.signal?.aborted ||
        binding?.root !== root ||
        binding.project !== ctx.cwd
      )
        throw Error('RTK execution owner unavailable')
      const service = getPermissionsService(sessionId)
      requireFeaturePermission('mh_rtk')
      for (const target of [root, join(root, 'state.json'), join(root, 'default.json')])
        for (const name of ['read', 'path_read']) {
          const d = service!.checkPermission(name, target)
          if (d.matchedPattern !== undefined && d.state !== 'allow')
            throw Error('RTK execution data path denied')
        }
    },
  })
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
            maintenanceAccess(tool, ctx, root, operation, targets) {
              // A genuine ephemeral headless primary only, not an offline caller verdict.
              if (
                !isPrimarySession(ctx) ||
                ctx.hasUI ||
                ctx.sessionManager.getSessionFile?.() ||
                tool.name !== 'agent_memory_manage' ||
                !Array.isArray(targets) ||
                targets.length > 32
              )
                throw Error('Ephemeral headless primary maintenance owner required')
              const access = validateMemoryAccess(tool, ctx, root, operation, root, true).access
              if (access.kind !== 'primary') throw Error('Primary maintenance owner required')
              for (const target of targets) validateMemoryAccess(tool, ctx, root, operation, target, true)
              return { kind: 'primary' }
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
      nodes.set(id, {
        generation,
        context,
        rtk: { assertAccess: rtkAccess, transform: rtk.transform },
        ownsContext,
        isPrimarySession,
        ownUI,
        usage,
        codeMap: {
          version: 1,
          generation,
          assertAccess(tool, ctx) {
            const actual = pi.getAllTools().find((item) => item.name === 'mh_code_map')
            if (
              !ownsContext(ctx) ||
              ctx.sessionManager !== sessionManager ||
              ctx.signal?.aborted ||
              !actual ||
              !registeredTool(tool, ['mh_code_map']) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir
            )
              throw new Error('Code Map guard unavailable')
            const grant = getPermissionsService(sessionId)?.checkPermission('mh_code_map')
            if (grant?.state !== 'allow')
              throw Error(`mh_code_map: PSS permission is ${grant?.state ?? 'unavailable'}`)
          },
        },
        goal: {
          version: 1,
          generation,
          assertAccess(tool, ctx, root, operation = 'read') {
            requirePrimary(ctx, 'Goal')
            const actual = pi.getAllTools().find((item) => item.name === tool?.name)
            const profile = resolveGoalProfile()
            const expected = join(
              profile,
              'workflow/goals',
              createHash('sha256').update(ctx.cwd).digest('hex'),
            )
            if (
              !isPrimarySession(ctx) ||
              !actual ||
              !registeredTool(tool, goalTools) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              realpathSync(ctx.cwd) !== ctx.cwd ||
              root !== expected ||
              !['read', 'write'].includes(operation)
            )
              throw new Error(
                'Goal context/root mismatch; use the canonical current project and a read/write operation',
              )
            const service = getPermissionsService(sessionId)
            requireFeaturePermission(tool.name)
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
            // Recheck live public policy after awaiting; never cache approvals
            // or infer authority from DATA grants or package provenance.
            nodes.get(sessionId)?.goal.assertAccess(tool, ctx, root, operation)
          },
        },
        uxWorkflow: {
          version: 1,
          generation,
          assertAccess(tool, ctx, root, operation = 'read') {
            requirePrimary(ctx, 'UX workflow')
            const actual = pi.getAllTools().find((item) => item.name === tool?.name)
            const expected = join(
              resolveGoalProfile(),
              'workflow/ux-workflow',
              createHash('sha256').update(ctx.cwd).digest('hex'),
            )
            if (
              !isPrimarySession(ctx) ||
              !actual ||
              !registeredTool(tool, uxTools) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              realpathSync(ctx.cwd) !== ctx.cwd ||
              root !== expected ||
              !['read', 'write'].includes(operation)
            )
              throw Error(
                'UX workflow context/root mismatch; use the canonical current project and a read/write operation',
              )
            const service = getPermissionsService(sessionId)
            requireFeaturePermission(tool.name)
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
            requirePrimary(ctx, 'Execution Run')
            const actual = pi.getAllTools().find((item) => item.name === 'mh_execution_run')
            const profile = resolveGoalProfile()
            const expected = join(
              profile,
              'workflow/execution-run',
              createHash('sha256').update(ctx.cwd).digest('hex'),
            )
            if (
              !isPrimarySession(ctx) ||
              !actual ||
              !registeredTool(tool, ['mh_execution_run']) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              realpathSync(ctx.cwd) !== ctx.cwd ||
              root !== expected ||
              !['read', 'write'].includes(operation) ||
              resolveRunBinding(ctx.cwd)?.root !== root
            )
              throw Error(
                'Execution Run context/root mismatch; bind the canonical current project before accessing state',
              )
            const service = getPermissionsService(sessionId)
            requireFeaturePermission('mh_execution_run')
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
            requirePrimary(ctx, 'Code Evidence')
            const actual = pi.getAllTools().find((item) => item.name === 'mh_code_evidence')
            const expected = join(
              resolveGoalProfile(),
              'workflow/evidence',
              createHash('sha256').update(ctx.cwd).digest('hex'),
            )
            if (
              !isPrimarySession(ctx) ||
              !actual ||
              !registeredTool(tool, ['mh_code_evidence']) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              realpathSync(ctx.cwd) !== ctx.cwd ||
              root !== expected ||
              !['read', 'write'].includes(operation)
            )
              throw Error(
                'Code Evidence context/root mismatch; use the canonical current project and a read/write operation',
              )
            const service = getPermissionsService(sessionId)
            requireFeaturePermission('mh_code_evidence')
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
            const transformed = await executionArgs('bash', { command }, ctx)
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
          trustedTool: memoryTool,
          isPrimarySession,
          parentService: () => (isPrimarySession({ sessionManager }) ? getParentService() : undefined),
          assertAccess: (() => {
            validateMemoryAccess = (
              tool,
              ctx,
              root,
              operation = 'read',
              target = root,
              maintenance = false,
            ) => {
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
                !memoryTool(tool) ||
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
              if (
                maintenance &&
                (!memorySelection ||
                  !primary ||
                  ctx.hasUI ||
                  ctx.sessionManager.getSessionFile?.() ||
                  tool.name !== 'agent_memory_manage')
              )
                throw Error('Ephemeral headless primary maintenance owner required')
              if (operation === 'write' && !maintenance) {
                try {
                  lstatSync(join(root, '.views/.maintenance-active.json'))
                  throw Error('Memory offline maintenance blocks ordinary writes; inspect owner checkpoint')
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
                }
              }
              let ownerId = sessionId
              let lease
              if (!primary) {
                if (['agent_memory_manage', 'agent_memory_reflect'].includes(tool.name))
                  throw new Error('Managed worker operation unavailable')
                const parentId = nativeParents.get(sessionId)
                const owner = parentId ? nodes.get(parentId) : undefined
                const outputFile = sessionManager.getSessionFile?.()
                if (!parentId || !owner?.healthy() || typeof outputFile !== 'string')
                  throw new Error('Native memory binding unavailable')
                ownerId = parentId
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
                maintenance &&
                (grant?.source !== 'tool' ||
                  grant.toolName !== memoryPermission(root) ||
                  grant.matchedSurface !== memoryPermission(root) ||
                  grant.origin === 'yolo' ||
                  toolGrant?.source !== 'tool' ||
                  toolGrant.toolName !== tool.name ||
                  toolGrant.matchedSurface !== tool.name ||
                  toolGrant.origin === 'yolo')
              )
                throw Error('Offline maintenance requires exact existing DATA and tool authority')
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
                    : ['read', 'path_read', 'path_write', ...(maintenance ? ['write'] : [])]) {
                    const decision =
                      policy === service && surface === (operation === 'read' ? 'path_read' : 'path_write')
                        ? path
                        : policy?.checkPermission(surface, target)
                    if (decision?.matchedPattern !== undefined && decision.state !== 'allow')
                      throw Error('Managed memory path authority required')
                  }
                }
              }
              if (primary) return { access: { kind: 'primary' }, lease }
              const value = lease!.value
              const isEngine = (entry: Lease['value']): entry is EngineWorkerValue =>
                'version' in entry && entry.version === 2
              if (isEngine(value)) return { access: { kind: 'worker', value }, lease }
              return { access: { kind: 'worker', value }, lease }
            }
            return (...args) => validateMemoryAccess(...args).access
          })(),
          async authorize(tool, ctx, root, operation = 'read', signal) {
            const access = nodes.get(sessionId)!.managedMemory.assertAccess(tool, ctx, root, operation)
            const args = await context.finalArgs(operation === 'read' ? 'read' : 'write', { path: root }, ctx)
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
          trustedTool: recallTool,
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
            if (!ownsContext(ctx) || !recallTool(tool) || signal?.aborted || !isAbsolute(path))
              throw new Error('Continuity guard unavailable')
            const args = await context.finalArgs('read', { path }, ctx)
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
          parentService: () => (ownsContext({ sessionManager }) ? getParentService() : undefined),
        },
        ownsChildControlTool(manager, tool) {
          if (!ownsContext({ sessionManager }) || !getParentService()) return false
          return getParentService()?.ownsChildControlTool?.(manager, tool) === true
        },
        healthy: () =>
          registered &&
          nodes.get(id)?.generation === generation &&
          !latched &&
          Boolean(getPermissionsService(id)),
      })
      rtk.initialize(ctx)
    }),
  )
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
    pi.events.on(subagents?.SUBAGENT_EVENTS.RESUMING ?? 'subagents:resuming', (data) => {
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
