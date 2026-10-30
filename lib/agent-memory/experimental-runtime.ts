import { realpath } from 'node:fs/promises'
import { memoryFailure } from './reasons.ts'
import { resolveAgentDir } from '../setup.ts'
import { installedWriter, preflightWriterRoute } from './writer-route.ts'
import { join } from 'node:path'
import { setImmediate as yieldTurn } from 'node:timers/promises'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { bytes, digest, hasSecret, objectShape } from '../continuity/records.ts'
import { MemoryEngineController, assertCurrent, type OperationContext } from './engine/controller.ts'
import { MemoryPublisher } from './engine/publisher.ts'
import { memoryPolicyStatus, reconcileMemoryPolicy, setMemoryAutomatic } from './engine/policy.ts'
import { MemoryLifetime } from './engine/lifetime.ts'
import { offlineMaintenance, type MaintenanceRequest } from './engine/offline-maintenance.ts'
import { initializeMemoryRoot, prepareInitialization } from './engine/initializer.ts'
import { createAttempt, type AttemptOutcome } from './engine/attempt.ts'
import type { Input, Method, Output } from './engine/protocol.ts'
import type { MemoryABIV2, EngineWorkerValue } from './experimental-contracts.ts'
import type { MemoryNode } from './runtime.ts'
import { memoryCurationDoctrine } from './guidance.ts'
import { isOfflineMaintenanceSession } from './offline-bootstrap.ts'
import { primaryDelegationDoctrine } from './prompt.ts'
import type { TurnEpisode } from './store.ts'
import { compactionBoundary, compactionObservation } from './compaction.ts'
import { recordMemoryDiagnostic } from '../guards/memory-fixture.mjs'
import { buildMemoryInvocationContext, type MemoryProjectionReceipt } from './invocation-context.ts'
import { buildPalaceDiagnostic, type PalaceDiagnostic } from './palace-diagnostic.ts'
import { buildPalaceHandoff, type PalaceHandoff } from './palace-handoff.ts'
import type { KnowledgeHistory } from './knowledge-history.ts'
import { abi2PalaceStyle, renderAbi2PalacePage } from '../palace-render/abi2-page.ts'
import { startImmutablePalaceServer, type ImmutablePalaceServer } from '../palace-render/immutable-server.ts'

interface RuntimeBinding {
  manager: ExtensionContext['sessionManager']
  sessionId: string
  node: MemoryNode
  abi: MemoryABIV2
  generation: unknown
  root: string
}
interface Draft {
  view: string
  base: string
  configHash: string
  project: string
  deadline: number
}
interface Job {
  id?: string
  value: EngineWorkerValue
  phase: 'starting' | 'running' | 'integrating' | 'retired'
  stop(): void
  cancel(outcome?: AttemptOutcome): void
  finish(): Promise<void>
}
function actionOf(args: unknown): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  return (args as { action?: unknown }).action
}
const bounded = (value: unknown, max = 2048): string | undefined => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    bytes(value) > max ||
    hasSecret(value) ||
    /<\/?(?:system-reminder|tool-result|task-notification|skill_content)\b/i.test(value)
  )
    return undefined
  return value
}
const rawText = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  return content
    .filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n')
}
const retain = <T>(items: T[], item: T) => {
  if (items.length === 4) items.splice(1, 1)
  items.push(item)
}
interface PendingEpisode {
  serial: number
  input: TurnEpisode['input']
  branch: string[]
  actions: TurnEpisode['actions']
  results: TurnEpisode['results']
  toolCalls: Set<string>
}
const registry = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
const palaceViewerTtlMs = 10 * 60 * 1000
const viewerReadActions = new Set(['status', 'doctor', 'palace', 'migration-export', 'offline-inspect'])

interface PalaceViewerCapture {
  handoff: PalaceHandoff
  token: number
  binding: RuntimeBinding
  admission: number
  branch: string[]
  project: string
  revision: string
  configHash: string
  structureDigest: string
  snapshotDigest: string
  historyJson: string
}

interface PalaceViewer {
  serial: number
  server: ImmutablePalaceServer
  timer: NodeJS.Timeout
  abort: AbortController
  capture: PalaceViewerCapture
  revoked: boolean
}

interface PalaceViewerOpening {
  abort: AbortController
  server?: ImmutablePalaceServer
  done: Promise<void>
  finish(): void
}

export function createExperimentalMemoryRuntime(pi: ExtensionAPI) {
  let epoch = 0
  let admissionSerial = 0
  let active = false
  let pinned: MemoryNode | undefined
  let binding: RuntimeBinding | undefined
  let primaryEngine: MemoryEngineController | undefined
  let draft: Draft | undefined
  let starting = false
  let job: Job | undefined
  let lastError: string | undefined
  let latestAttempt:
    | {
        value: ReturnType<typeof createAttempt>
        matches(ctx: ExtensionContext, configHash: string, project: string): boolean
      }
    | undefined
  let pending: PendingEpisode | undefined
  let outcome: string | undefined
  let compactionCheckpoint: string | undefined
  let compacting: ReturnType<typeof compactionBoundary> | undefined
  let compactionObserving = false
  let projectionReceipt:
    | (MemoryProjectionReceipt & {
        binding: RuntimeBinding
        token: number
        project: string
      })
    | undefined
  // Local cancellation/policy intent fence, not cross-process publication atomicity.
  // Ordinary input admission must not revoke an otherwise valid compaction event.
  let compactionSerial = 0
  const lifetime = new MemoryLifetime()
  let retirement: Promise<void> | undefined
  let releaseRuntime: (() => void) | undefined
  let releaseController: (() => void) | undefined
  let unregisterRetire: (() => void) | undefined
  let bindingSerial = 0
  let viewerSerial = 0
  let viewerOpening: PalaceViewerOpening | undefined
  let viewer: PalaceViewer | undefined
  let treeResume:
    | (RuntimeBinding & { serial: number; token: number; drained: Promise<void>; ready: boolean })
    | undefined
  const nodes = () => (globalThis as Record<symbol, Map<string, MemoryNode>>)[registry]
  const closeActiveViewer = async (): Promise<boolean> => {
    viewerSerial++
    const own = viewer
    viewer = undefined
    if (!own) return false
    clearTimeout(own.timer)
    own.abort.abort()
    await own.server.close()
    return true
  }
  const closeViewer = async (): Promise<boolean> => {
    const opening = viewerOpening
    if (opening) {
      viewerOpening = undefined
      opening.abort.abort()
      viewerSerial++
    }
    const closed = await closeActiveViewer()
    if (opening?.server) await opening.server.close()
    if (opening) await opening.done
    return closed || Boolean(opening)
  }
  const retire = (): Promise<void> => {
    // Even an already-draining terminal transition revokes pending tree/start rebinds.
    bindingSerial++
    treeResume = undefined
    if (retirement) return retirement
    const viewerDrain = closeViewer()
    epoch++
    admissionSerial++
    active = false
    draft = undefined
    pending = undefined
    outcome = undefined
    compactionCheckpoint = undefined
    compacting = undefined
    latestAttempt = undefined
    projectionReceipt = undefined
    const own = job
    job = undefined
    own?.cancel()
    const engine = primaryEngine
    primaryEngine = undefined
    pinned = undefined
    binding = undefined
    engine?.retireAdmission()
    const runtimeRelease = releaseRuntime
    const controllerRelease = releaseController
    const unregister = unregisterRetire
    releaseRuntime = releaseController = unregisterRetire = undefined
    retirement = (async () => {
      // A retired owner can only join native work/close handles, never finish publication.
      await viewerDrain
      await lifetime.drain()
      if (engine) await engine.close() // data child LAST, after all parent continuations
      controllerRelease?.()
      runtimeRelease?.()
      unregister?.()
    })()
    return retirement
  }
  const bind = (node: MemoryNode, ctx: ExtensionContext) => {
    const abi = node.managedMemory
    const manager = ctx.sessionManager
    const sessionId = manager.getSessionId()
    if (
      abi?.version !== 2 ||
      nodes()?.get(sessionId) !== node ||
      !node.healthy() ||
      !abi.live() ||
      node.generation !== abi.generation ||
      ctx.signal?.aborted
    )
      throw Error('Experimental ABI2 required')
    const release = abi.hold({ runtime: epoch })
    try {
      unregisterRetire = abi.onRetire(retire)
    } catch (error) {
      release()
      throw error
    }
    releaseRuntime = release
    retirement = undefined
    pinned = node
    binding = { manager, sessionId, node, abi, generation: node.generation, root: abi.root }
    active = true
    starting = false
  }
  const treeBindingCurrent = (own: RuntimeBinding, ctx: ExtensionContext) =>
    !ctx.signal?.aborted &&
    ctx.sessionManager === own.manager &&
    own.manager.getSessionId() === own.sessionId &&
    nodes()?.get(own.sessionId) === own.node &&
    own.node.managedMemory === own.abi &&
    own.node.generation === own.generation &&
    own.abi.generation === own.generation &&
    own.abi.root === own.root &&
    own.node.healthy() &&
    own.abi.live() &&
    own.abi.isPrimarySession(ctx)
  const reactivateTree = async (ctx: ExtensionContext, completed = false) => {
    const own = treeResume
    // No cancellation-complete hook exists. Only a real idle boundary proves that
    // navigation is no longer pending; before_agent_start is busy, not such proof.
    if (!own || (!completed && !ctx.isIdle())) return false
    try {
      await own.drained // outside lifetime.track: never join ourselves
      if (treeResume !== own || own.serial !== bindingSerial || own.token !== epoch) return false
      if (!own.ready || (!completed && !ctx.isIdle()) || !treeBindingCurrent(own, ctx))
        throw Error('Tree memory owner changed or boundary unavailable')
      bind(own.node, ctx) // old controller is closed; data work creates a fresh one lazily
      treeResume = undefined
      return true
    } catch (error) {
      if (treeResume === own) treeResume = undefined
      throw error
    }
  }
  const admit = <T>(ctx: ExtensionContext, start: () => Promise<T>): Promise<T> => {
    if (active || !treeResume || !ctx.isIdle()) return lifetime.track(start)
    const serial = bindingSerial
    const token = epoch
    return reactivateTree(ctx).then(() => {
      if (!active || serial !== bindingSerial || token !== epoch) throw Error('Tree memory admission retired')
      return lifetime.track(start)
    })
  }
  const owner = (
    ctx: ExtensionContext,
    name: string,
    operation: 'read' | 'write',
    signal?: AbortSignal,
    maintenance = false,
  ) => {
    const node = pinned
    const ownBinding = binding
    const abi = node?.managedMemory
    const tool = pi.getAllTools().find((entry) => entry.name === name)
    if (!active || !node || !ownBinding || abi?.version !== 2 || !tool || !abi.root)
      throw Error('Experimental memory unavailable')
    const root = abi.root
    const token = epoch
    const manager = ctx.sessionManager
    let expected: ReturnType<MemoryABIV2['assertAccess']> | undefined
    const context: OperationContext = {
      signal,
      hold: (identity) => abi.hold(identity),
      current(targets) {
        if (
          !active ||
          epoch !== token ||
          pinned !== node ||
          binding !== ownBinding ||
          ownBinding.manager !== manager ||
          ownBinding.sessionId !== manager.getSessionId() ||
          ownBinding.abi !== abi ||
          ownBinding.generation !== node.generation ||
          ownBinding.root !== abi.root ||
          nodes()?.get(manager.getSessionId()) !== node ||
          !node.healthy() ||
          node.generation !== abi.generation ||
          node.managedMemory !== abi ||
          !abi.live() ||
          ctx.signal?.aborted ||
          signal?.aborted ||
          ctx.sessionManager !== manager ||
          !abi.trustedTool(tool)
        )
          return false
        const access = maintenance
          ? abi.maintenanceAccess(tool, ctx, root, operation, [])
          : abi.assertAccess(tool, ctx, root, operation)
        if (
          expected &&
          (access.kind !== expected.kind ||
            (access.kind === 'worker' && expected.kind === 'worker' && access.value !== expected.value))
        )
          return false
        // Identical logical/physical target within this synchronous call is one PSS check, not a cache.
        const paths = [...new Set([...targets.physical, ...targets.logical.map((path) => join(root, path))])]
        for (let start = 0; start < paths.length; start += 32)
          if (maintenance) abi.maintenanceAccess(tool, ctx, root, operation, paths.slice(start, start + 32))
          else abi.assertTargets(tool, ctx, root, operation, paths.slice(start, start + 32))
        return true
      },
    }
    assertCurrent(context)
    const access = maintenance
      ? abi.maintenanceAccess(tool, ctx, root, operation, [])
      : abi.assertAccess(tool, ctx, root, operation)
    expected = access
    if (access.kind === 'primary' && !primaryEngine) {
      releaseController = abi.hold({ controller: token })
      primaryEngine = new MemoryEngineController(root)
    }
    const engine = access.kind === 'worker' ? access.value.engine : primaryEngine!
    if (
      engine.root !== root ||
      (access.kind === 'worker' && (access.value.version !== 2 || access.value.root !== root))
    )
      throw Error('Opaque parent engine binding mismatch')
    let branchPrefix: string[] | undefined
    const barrier = async () => {
      assertCurrent(context)
      branchPrefix = await branch(ctx, branchPrefix)
      if (access.kind === 'worker') await access.value.dataBarrier()
      const data = await engine.request('config', {}, context)
      await branch(ctx, branchPrefix)
      assertCurrent(context)
      if (access.kind === 'worker' && data.configHash !== access.value.configHash)
        throw Error('Worker configuration changed')
      return data
    }
    context.barrier = async () => {
      await barrier()
    }
    const request = async <M extends Method>(method: M, input: Input<M>): Promise<Output<M>> => {
      await barrier()
      const result = await engine.request(method, input, context)
      await barrier()
      assertCurrent(context)
      return result
    }
    return { node, abi, tool, root, context, access, engine, barrier, request }
  }
  const resolve = async (
    ctx: ExtensionContext,
    name: string,
    operation: 'read' | 'write',
    signal?: AbortSignal,
  ) => {
    const f = owner(ctx, name, operation, signal)
    await f.abi.authorize(f.tool, ctx, f.root, operation, signal)
    const { config, configHash } = await f.barrier()
    const cwd = await realpath(ctx.cwd)
    assertCurrent(f.context)
    const project = config.projects.find((entry) => entry.cwd === cwd)?.id ?? digest(cwd)
    if (config.projects.some((entry) => entry.id === project && entry.cwd !== cwd))
      throw Error('Project identity collision')
    return { ...f, project, configHash }
  }
  const branch = async (ctx: ExtensionContext, prefix?: string[]) => {
    const entries = ctx.sessionManager.getBranch()
    if (entries.length > 8192) throw memoryFailure('capacity', 'Branch barrier capacity exceeded')
    const ids: string[] = []
    for (let start = 0; start < entries.length; start += 64) {
      for (const entry of entries.slice(start, start + 64)) ids.push(entry.id)
      await yieldTurn()
    }
    if (prefix?.some((id, index) => ids[index] !== id))
      throw memoryFailure('branch', 'Native memory branch changed')
    return ids
  }
  const captureInvocation = async (ctx: ExtensionContext, combined = false) => {
    if (!ctx.isIdle() || starting || job || draft)
      throw Error('Idle ABI2 primary invocation context required')
    const exactBranch = await branch(ctx)
    const token = epoch
    const ownBinding = binding
    const f = await resolve(ctx, 'agent_memory_manage', 'read', ctx.signal)
    if (f.access.kind !== 'primary' || !f.abi.isPrimarySession(ctx) || !ownBinding || ownBinding !== binding)
      throw Error('Primary invocation context required')
    const status = await f.request('status', {})
    const palaceReply = combined
      ? await f.request('palaceStructure', { project: f.project, expectedConfigHash: f.configHash })
      : undefined
    const receipt = projectionReceipt
    let usage: unknown
    let systemPrompt: unknown
    try {
      usage = ctx.getContextUsage()
    } catch {
      usage = undefined
    }
    try {
      systemPrompt = ctx.getSystemPrompt()
    } catch {
      systemPrompt = undefined
    }
    const finalStatus = combined ? await f.request('status', {}) : undefined
    const finalConfig = await f.barrier()
    if (finalStatus && finalStatus.revision !== status.revision)
      throw memoryFailure('CAS', 'Palace revision mismatch during capture')
    const finalEntries = ctx.sessionManager.getBranch()
    if (finalEntries.length > 8192) throw memoryFailure('capacity', 'Branch barrier capacity exceeded')
    const finalBranch = finalEntries.map((entry) => {
      if (typeof entry.id !== 'string' || Buffer.byteLength(entry.id) > 4096)
        throw memoryFailure('branch', 'Invalid branch entry identity')
      return entry.id
    })
    if (finalConfig.configHash !== f.configHash)
      throw memoryFailure('CAS', 'Invocation configuration changed during capture')
    if (
      token !== epoch ||
      ownBinding !== binding ||
      !ctx.isIdle() ||
      starting ||
      job ||
      draft ||
      exactBranch.length !== finalBranch.length ||
      exactBranch.some((id, index) => finalBranch[index] !== id)
    )
      throw memoryFailure('branch', 'Invocation context changed during capture')
    assertCurrent(f.context)
    const projection =
      receipt &&
      receipt.binding === ownBinding &&
      receipt.token === token &&
      receipt.project === f.project &&
      receipt.configHash === f.configHash
        ? {
            revision: receipt.revision,
            configHash: receipt.configHash,
            capturedAt: receipt.capturedAt,
            emittedBlockUtf8Bytes: receipt.emittedBlockUtf8Bytes,
          }
        : undefined
    const context = buildMemoryInvocationContext({
      revision: status.revision,
      configHash: f.configHash,
      model: ctx.model,
      usage,
      systemPrompt,
      projection,
    })
    if (combined) {
      if (!palaceReply) throw Error('Palace diagnostic unavailable')
      return buildPalaceDiagnostic(context, palaceReply)
    }
    return context
  }
  const knowledgeHistory = async (ctx: ExtensionContext, offset: number) => {
    if (!ctx.isIdle() || starting || job || draft) throw Error('Idle ABI2 primary history required')
    const exactBranch = await branch(ctx)
    const token = epoch
    const ownBinding = binding
    const serial = admissionSerial
    const f = await resolve(ctx, 'agent_memory_manage', 'read', ctx.signal)
    if (f.access.kind !== 'primary' || !f.abi.isPrimarySession(ctx) || !ownBinding || ownBinding !== binding)
      throw Error('Primary history required')
    const current = f.context.current
    f.context.current = (targets) => serial === admissionSerial && current(targets)
    const status = await f.request('status', {})
    const result = await f.request('knowledgeHistory', {
      project: f.project,
      expectedRevision: status.revision,
      expectedConfigHash: f.configHash,
      offset,
    })
    const finalStatus = await f.request('status', {})
    const finalConfig = await f.barrier()
    const finalBranch = await branch(ctx)
    if (finalStatus.revision !== status.revision || finalConfig.configHash !== f.configHash)
      throw memoryFailure('CAS', 'History binding changed')
    if (
      token !== epoch ||
      ownBinding !== binding ||
      !ctx.isIdle() ||
      starting ||
      job ||
      draft ||
      exactBranch.length !== finalBranch.length ||
      exactBranch.some((id, i) => id !== finalBranch[i])
    )
      throw memoryFailure('branch', 'History invocation changed')
    assertCurrent(f.context)
    return result
  }
  const capturePalaceViewer = async (
    ctx: ExtensionContext,
    signal: AbortSignal,
  ): Promise<PalaceViewerCapture> => {
    if (signal.aborted || !ctx.isIdle() || starting || job || draft)
      throw Error('Idle ABI2 primary Palace viewer required')
    const exactBranch = await branch(ctx)
    const token = epoch
    const ownBinding = binding
    const serial = admissionSerial
    const f = await resolve(ctx, 'agent_memory_manage', 'read', signal)
    if (f.access.kind !== 'primary' || !f.abi.isPrimarySession(ctx) || !ownBinding || ownBinding !== binding)
      throw Error('Primary Palace viewer required')
    const current = f.context.current
    f.context.current = (targets) => !signal.aborted && serial === admissionSerial && current(targets)
    const status = await f.request('status', {})
    const palace = await f.request('palaceStructure', {
      project: f.project,
      expectedConfigHash: f.configHash,
    })
    const history = await f.request('knowledgeHistory', {
      project: f.project,
      expectedRevision: status.revision,
      expectedConfigHash: f.configHash,
      offset: 0,
    })
    const receipt = projectionReceipt
    let usage: unknown
    let systemPrompt: unknown
    try {
      usage = ctx.getContextUsage()
    } catch {
      usage = undefined
    }
    try {
      systemPrompt = ctx.getSystemPrompt()
    } catch {
      systemPrompt = undefined
    }
    const finalStatus = await f.request('status', {})
    const finalConfig = await f.barrier()
    const finalBranch = await branch(ctx)
    if (finalStatus.revision !== status.revision || finalConfig.configHash !== f.configHash)
      throw memoryFailure('CAS', 'Palace viewer binding changed during capture')
    if (
      signal.aborted ||
      token !== epoch ||
      serial !== admissionSerial ||
      ownBinding !== binding ||
      !ctx.isIdle() ||
      starting ||
      job ||
      draft ||
      exactBranch.length !== finalBranch.length ||
      exactBranch.some((id, index) => id !== finalBranch[index])
    )
      throw memoryFailure('branch', 'Palace viewer invocation changed during capture')
    assertCurrent(f.context)
    const projection =
      receipt &&
      receipt.binding === ownBinding &&
      receipt.token === token &&
      receipt.project === f.project &&
      receipt.configHash === f.configHash
        ? {
            revision: receipt.revision,
            configHash: receipt.configHash,
            capturedAt: receipt.capturedAt,
            emittedBlockUtf8Bytes: receipt.emittedBlockUtf8Bytes,
          }
        : undefined
    const context = buildMemoryInvocationContext({
      revision: status.revision,
      configHash: f.configHash,
      model: ctx.model,
      usage,
      systemPrompt,
      projection,
    })
    const diagnostic = buildPalaceDiagnostic(context, palace)
    const handoff = buildPalaceHandoff({
      diagnostic,
      history,
      expiresAt: new Date(Date.now() + palaceViewerTtlMs),
    })
    return {
      handoff,
      token,
      binding: ownBinding,
      admission: serial,
      branch: [...exactBranch],
      project: f.project,
      revision: status.revision,
      configHash: f.configHash,
      structureDigest: palace.structureDigest,
      snapshotDigest: palace.snapshotDigest,
      historyJson: JSON.stringify(history),
    }
  }
  const validatePalaceViewer = async (
    ctx: ExtensionContext,
    capture: PalaceViewerCapture,
    signal: AbortSignal,
    currentViewer: () => boolean,
  ): Promise<boolean> => {
    const locallyCurrent = () =>
      currentViewer() &&
      !signal.aborted &&
      active &&
      capture.token === epoch &&
      capture.binding === binding &&
      capture.admission === admissionSerial &&
      ctx.isIdle() &&
      !starting &&
      !job &&
      !draft
    if (!locallyCurrent()) return false
    try {
      const f = await resolve(ctx, 'agent_memory_manage', 'read', signal)
      if (
        f.access.kind !== 'primary' ||
        !f.abi.isPrimarySession(ctx) ||
        f.project !== capture.project ||
        f.configHash !== capture.configHash ||
        !locallyCurrent()
      )
        return false
      const original = f.context.current
      f.context.current = (targets) => locallyCurrent() && original(targets)
      const status = await f.request('status', {})
      if (status.revision !== capture.revision) return false
      const palace = await f.request('palaceStructure', {
        project: capture.project,
        expectedConfigHash: capture.configHash,
      })
      if (
        palace.revision !== capture.revision ||
        palace.structureDigest !== capture.structureDigest ||
        palace.snapshotDigest !== capture.snapshotDigest
      )
        return false
      const history = await f.request('knowledgeHistory', {
        project: capture.project,
        expectedRevision: capture.revision,
        expectedConfigHash: capture.configHash,
        offset: 0,
      })
      if (JSON.stringify(history) !== capture.historyJson) return false
      const finalStatus = await f.request('status', {})
      const finalConfig = await f.barrier()
      const finalBranch = await branch(ctx)
      if (
        finalStatus.revision !== capture.revision ||
        finalConfig.configHash !== capture.configHash ||
        capture.branch.length !== finalBranch.length ||
        capture.branch.some((id, index) => id !== finalBranch[index]) ||
        !locallyCurrent()
      )
        return false
      assertCurrent(f.context)
      return true
    } catch {
      return false
    }
  }
  const openPalaceViewer = async (ctx: ExtensionContext) => {
    if (ctx.mode !== 'tui' || !ctx.hasUI) throw Error('TUI Palace viewer required')
    if (viewerOpening) throw Error('Palace viewer start already active')
    let finishOpening!: () => void
    const abort = new AbortController()
    const opening: PalaceViewerOpening = {
      abort,
      done: new Promise<void>((resolve) => {
        finishOpening = resolve
      }),
      finish: () => finishOpening(),
    }
    viewerOpening = opening
    let server: ImmutablePalaceServer | undefined
    let candidate: PalaceViewer | undefined
    try {
      await closeActiveViewer()
      if (viewerOpening !== opening || abort.signal.aborted) throw Error('Palace viewer admission changed')
      const serial = ++viewerSerial
      const capture = await capturePalaceViewer(ctx, abort.signal)
      const html = renderAbi2PalacePage(capture.handoff)
      server = await startImmutablePalaceServer({
        html,
        style: abi2PalaceStyle,
        validate: async (signal) => {
          const own = candidate
          if (!own) return false
          const valid = await validatePalaceViewer(ctx, capture, signal, () => viewer === own && !own.revoked)
          if (!valid && viewer === own) {
            own.revoked = true
            clearTimeout(own.timer)
            own.abort.abort()
          }
          return valid
        },
      })
      opening.server = server
      if (viewerOpening !== opening || abort.signal.aborted) throw Error('Palace viewer admission changed')
      const ready = await validatePalaceViewer(
        ctx,
        capture,
        abort.signal,
        () => serial === viewerSerial && !abort.signal.aborted,
      )
      if (!ready || serial !== viewerSerial || capture.token !== epoch || capture.binding !== binding)
        throw Error('Palace viewer admission changed')
      const expiresAt = Date.parse(capture.handoff.delivery.expiresAt)
      const timer = setTimeout(
        () => {
          if (viewer === candidate)
            void closeViewer().catch(() => {
              lastError = 'palace-viewer-close-unavailable'
            })
        },
        Math.max(1, expiresAt - Date.now()),
      )
      timer.unref()
      candidate = { serial, server, timer, abort, capture, revoked: false }
      const published = candidate
      viewer = published
      void server.closed.then(
        () => {
          if (viewer === published) {
            clearTimeout(published.timer)
            published.abort.abort()
            viewer = undefined
          }
        },
        () => {
          if (viewer === published) {
            clearTimeout(published.timer)
            published.abort.abort()
            viewer = undefined
          }
          lastError = 'palace-viewer-close-unavailable'
        },
      )
      return {
        version: 1 as const,
        kind: 'abi2-palace-html-viewer' as const,
        url: server.url,
        captureId: capture.handoff.diagnostic.captureId,
        revision: capture.revision,
        expiresAt: capture.handoff.delivery.expiresAt,
        immutable: true as const,
        atomic: false as const,
        replay: 'unsupported' as const,
        closeCommand: '/mh-memory palace-html close' as const,
      }
    } catch (error) {
      abort.abort()
      if (candidate && viewer === candidate) viewer = undefined
      if (candidate) clearTimeout(candidate.timer)
      if (server) await server.close()
      throw error
    } finally {
      if (viewerOpening === opening) viewerOpening = undefined
      opening.finish()
    }
  }
  const startWriter = async (ctx: ExtensionContext, assignment?: string) => {
    await closeViewer()
    if (starting || job) throw Error('Managed memory writer already active')
    if (assignment !== undefined && !bounded(assignment, 4096))
      throw Error('Bounded explicit memory assignment required')
    starting = true
    const token = epoch
    const serial = admissionSerial
    try {
      const f = await resolve(ctx, 'agent_memory_reflect', 'write')
      const current = f.context.current
      f.context.current = (targets) => serial === admissionSerial && current(targets)
      assertCurrent(f.context)
      if (f.access.kind !== 'primary' || !f.abi.isPrimarySession(ctx))
        throw Error('Primary writer launch required')
      const { config } = await f.barrier()
      if (assignment === undefined && !config.automatic) return { skipped: 'automatic-off' }
      const episodes = await f.request('episodes', { project: f.project })
      if (assignment === undefined && !episodes.length) return { skipped: 'no-unreviewed-episodes' }
      const service = f.abi.parentService()
      const role = service?.getAgentType('managed-memory-writer')
      if (!service || service.supportsInitialOutcomeClaim !== true || !role)
        throw Error('Locked native writer unavailable')
      const approved = installedWriter(resolveAgentDir(), role)
      preflightWriterRoute(ctx, approved)
      const prefix = await branch(ctx)
      const created = await f.request('create', { project: f.project })
      const value: EngineWorkerValue = {
        version: 2,
        engine: f.engine,
        root: f.root,
        project: f.project,
        view: created.view,
        base: created.base,
        configHash: f.configHash,
        deadline: Date.now() + 120000,
        ready: false,
        dataBarrier: async () => {
          throw Error('Unbound native data barrier')
        },
      }
      const attempt = createAttempt(episodes.length, value.deadline)
      latestAttempt = {
        value: attempt,
        matches: (context, configHash, project) =>
          active &&
          epoch === token &&
          pinned === f.node &&
          context.sessionManager === ctx.sessionManager &&
          configHash === value.configHash &&
          project === value.project,
      }
      let revoke: (() => void) | undefined
      let timer: NodeJS.Timeout | undefined
      const disposers: (() => void)[] = []
      const identityLive = () =>
        active &&
        token === epoch &&
        serial === admissionSerial &&
        pinned === f.node &&
        nodes()?.get(ctx.sessionManager.getSessionId()) === f.node &&
        f.node.managedMemory === f.abi &&
        f.node.generation === f.abi.generation &&
        job === own &&
        own.phase !== 'retired' &&
        typeof own.id === 'string' &&
        value.engine === f.engine &&
        value.view === created.view &&
        Date.now() < value.deadline &&
        !ctx.signal?.aborted
      const jobContext: OperationContext = {
        hold: (identity) => f.abi.hold(identity),
        current(targets) {
          if (identityLive() !== true) return false
          const record = service.getRecord(own.id!)
          if (
            !record ||
            record.id !== own.id ||
            record.type !== 'managed-memory-writer' ||
            (own.phase === 'integrating'
              ? record.status !== 'completed' || !value.ready
              : !['queued', 'running', 'completed'].includes(record.status))
          )
            return false
          return f.context.current(targets) === true
        },
      }
      const dataBarrier = async () => {
        assertCurrent(jobContext)
        await branch(ctx, prefix)
        const data = await f.engine.request('config', {}, jobContext)
        if (data.configHash !== value.configHash) throw Error('Native memory config fence changed')
        await branch(ctx, prefix)
        assertCurrent(jobContext)
      }
      value.dataBarrier = dataBarrier
      jobContext.barrier = dataBarrier
      const own: Job = {
        id: undefined,
        value,
        phase: 'starting',
        stop() {
          own.phase = 'retired'
          if (timer) clearTimeout(timer)
          revoke?.()
          for (const dispose of disposers.splice(0)) dispose()
          if (job === own) job = undefined
        },
        cancel(result = 'cancelled') {
          attempt.finish(result)
          const id = own.id
          own.stop()
          if (id) service.abort(id)
        },
        finish: () =>
          lifetime.track(async () => {
            if (job !== own || own.phase !== 'running' || !own.id) return
            const record = service.getRecord(own.id)
            if (!record || ['queued', 'running'].includes(record.status)) return
            own.phase = 'integrating' // reserve adoption synchronously before any await
            try {
              if (record.status !== 'completed' || !value.ready) {
                attempt.finish(record.status !== 'completed' ? 'native-unsuccessful' : 'not-ready')
                throw Error('Successful ready native writer required')
              }
              await dataBarrier()
              const prepared = await f.engine.request(
                'prepare',
                { view: value.view, reviewed: episodes.map((e) => e.id) },
                jobContext,
              )
              if ('conflict' in prepared) {
                attempt.finish('conflict')
                throw Error('Native proposal conflict retained')
              }
              const result = await new MemoryPublisher(f.engine).publish(prepared.plan, jobContext)
              if (result.stage !== 'reconciled_committed')
                throw Error('Native integration unavailable; proposal retained')
              assertCurrent(jobContext)
              attempt.finish('integrated')
              if (token === epoch) lastError = undefined
            } catch {
              attempt.finish('integration-unavailable')
              if (token === epoch && job === own) lastError = 'worker-integration-unavailable'
            } finally {
              own.stop()
            }
          }),
      }
      job = own
      const wake = (event: unknown) => {
        if (
          objectShape(event, ['id', 'type']) &&
          event.id === own.id &&
          event.type === 'managed-memory-writer'
        )
          void own.finish()
      }
      // Native event payloads may include extra diagnostics; only these two fields locate a candidate.
      const onWake = (event: unknown) => {
        if (event && typeof event === 'object' && 'id' in event && 'type' in event)
          wake({ id: event.id, type: event.type })
      }
      disposers.push(pi.events.on('subagents:completed', onWake), pi.events.on('subagents:failed', onWake))
      timer = setTimeout(() => {
        if (job === own) {
          lastError = 'worker-deadline'
          own.cancel('deadline')
        }
      }, 120000)
      timer.unref()
      try {
        assertCurrent(f.context)
        // No await between final installed/loaded-role/physical-route validation
        // and public synchronous spawn. Explicit options survive queue delays.
        const currentRole = service.getAgentType('managed-memory-writer')
        if (!currentRole) throw Error('Locked native writer unavailable')
        const route = installedWriter(resolveAgentDir(), currentRole)
        if (route.text !== approved.text) throw Error('Approved writer route changed before dispatch')
        preflightWriterRoute(ctx, route)
        own.id = service.spawn(
          'managed-memory-writer',
          JSON.stringify({
            task:
              assignment ??
              'Maintain durable knowledge from these observed episodes; do not transcribe them into instructions.',
            project: f.project,
            baseRevision: value.base,
            episodes,
            evidence: 'observed-native-unverified; user role/source is not authenticated human identity',
          }),
          {
            model: route.model,
            thinkingLevel: route.thinking,
            foreground: false,
            bypassQueue: false,
            inheritContext: false,
            maxTurns: 8,
            claimOutcome: true,
          },
        )
        attempt.bind(() => service.getRecord(own.id!))
        revoke = f.abi.bindWorker(f.tool, ctx, f.root, own.id, value, identityLive)
        own.phase = 'running'
        // Public native service join; inherited Root/runtime holds additionally pin each child.
        void lifetime
          .track(() => service.waitForAll())
          .catch(() => {
            if (token === epoch) lastError = 'native-drain-unavailable'
          })
        void own.finish()
        return { job: own.id, status: 'native-dispatched', providerProof: false }
      } catch (error) {
        own.cancel('dispatch-failed')
        throw error
      }
    } finally {
      if (token === epoch) starting = false
    }
  }
  const run = async (name: string, args: unknown, ctx: ExtensionContext, signal?: AbortSignal) => {
    if (
      name === 'agent_memory_manage' &&
      objectShape(args, ['action', 'core', 'projectId', 'automatic']) &&
      args.action === 'initialize'
    ) {
      const f = owner(ctx, name, 'write', signal)
      // Capture bootstrap branch eligibility at admission, before authorization yields.
      // The ordinary data barrier reads config, which cannot exist at bootstrap.
      const entries = ctx.sessionManager.getBranch()
      if (entries.length > 8192) throw memoryFailure('capacity', 'Branch barrier capacity exceeded')
      const prefix = entries.map((entry) => entry.id)
      const context = {
        ...f.context,
        barrier: async () => {
          assertCurrent(f.context)
          await branch(ctx, prefix)
          // Re-read after the yielding traversal, before returning to native admission.
          const current = ctx.sessionManager.getBranch()
          if (current.length > 8192 || prefix.some((id, index) => current[index]?.id !== id))
            throw memoryFailure('branch', 'Native memory branch changed')
          assertCurrent(f.context)
        },
      }
      await context.barrier()
      await f.abi.authorize(f.tool, ctx, f.root, 'write', signal)
      await context.barrier()
      if (f.access.kind !== 'primary' || !f.abi.isPrimarySession(ctx))
        throw Error('Primary management required')
      const cwd = await realpath(ctx.cwd)
      await context.barrier()
      const plan = prepareInitialization(cwd, args)
      return await initializeMemoryRoot(f.root, plan, context)
    }
    if (
      name === 'agent_memory_manage' &&
      objectShape(args, ['action', 'target', 'revision', 'offline']) &&
      ['offline-inspect', 'offline-adopt', 'offline-resume'].includes(args.action as string)
    ) {
      const f = owner(ctx, name, args.action === 'offline-inspect' ? 'read' : 'write', signal, true)
      if (f.access.kind !== 'primary' || !f.abi.isPrimarySession(ctx) || starting || job || draft)
        throw Error('Idle ephemeral primary maintenance owner required')
      // No ordinary config/data barrier, cached recovered plan or manufactured current verdict.
      // Root maintenanceAccess rechecks the real manager, generation, tool and exact PSS targets.
      const prefix = await branch(ctx)
      const current = f.context.current
      const context: OperationContext = {
        ...f.context,
        current: (targets) => {
          const entries = ctx.sessionManager.getBranch()
          return (
            entries.length <= 8192 &&
            prefix.every((id, index) => entries[index]?.id === id) &&
            current(targets)
          )
        },
      }
      assertCurrent(context)
      return await offlineMaintenance(f.engine, context, args as unknown as MaintenanceRequest)
    }
    const manageRead = (action: unknown) =>
      action === 'status' || action === 'doctor' || action === 'palace' || action === 'migration-export'
    const requestedRead = name === 'agent_memory_manage' && manageRead(actionOf(args))
    const f = await resolve(
      ctx,
      name,
      name === 'agent_memory_read' || requestedRead ? 'read' : 'write',
      signal,
    )
    if (name === 'agent_memory_reflect') {
      if (!objectShape(args, ['assignment']) || typeof args.assignment !== 'string')
        throw Error('Bounded assignment required')
      return await startWriter(ctx, args.assignment)
    }
    if (name === 'agent_memory_manage') {
      if (
        f.access.kind !== 'primary' ||
        !objectShape(args, [
          'action',
          'revision',
          'configHash',
          'paths',
          'sources',
          'target',
          'path',
          'text',
          'section',
          'core',
          'projectId',
          'automatic',
          'offset',
          'limit',
        ])
      )
        throw Error('Primary management required')
      if (
        (args.offset !== undefined || args.limit !== undefined) &&
        args.action !== 'migration-export' &&
        (args.action !== 'conflicts' || typeof args.target !== 'string' || typeof args.path !== 'string')
      )
        throw Error('Conflict file required for paging')
      if (args.action === 'doctor') {
        const res = await f.request('manage', { action: 'doctor', project: f.project })
        if ('doctor' in res) return res.doctor
        throw Error('Doctor result unavailable')
      }
      if (args.action === 'palace') {
        const res = await f.request('manage', { action: 'palace', project: f.project })
        if ('palace' in res) return res.palace
        throw Error('Palace result unavailable')
      }
      if (args.action === 'migration-export') {
        if (
          typeof args.revision !== 'string' ||
          typeof args.section !== 'string' ||
          ['paths', 'sources', 'target', 'text', 'core', 'projectId', 'automatic', 'configHash', 'path'].some(
            (key) => args[key] !== undefined,
          )
        )
          throw Error('Invalid memory migration export')
        const res = await f.request('manage', {
          action: 'migration-export',
          project: f.project,
          revision: args.revision,
          section: args.section,
          ...(typeof args.offset === 'number' ? { offset: args.offset } : {}),
          ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
        })
        if ('migrationExport' in res) return res.migrationExport
        throw Error('Migration export unavailable')
      }
      if (args.action === 'init-project' || args.action === 'migrate-v2') {
        job?.cancel()
        const staged = await f.request('manage', { action: args.action, project: f.project })
        if (!('changed' in staged)) throw Error('Management draft unavailable')
        if (!staged.changed) {
          return {
            revision: staged.revision,
            ...(args.action === 'init-project'
              ? { initialized: [], existing: [] }
              : { migrated: [], skipped: [] }),
          }
        }
        if (!('view' in staged)) throw Error('Management draft unavailable')
        const prepared = await f.request('prepare', { view: staged.view, reviewed: [] })
        if (!('plan' in prepared)) throw Error('Management revision conflict; proposal retained')
        const result = await new MemoryPublisher(f.engine).publish(prepared.plan, f.context)
        if (result.stage !== 'reconciled_committed')
          throw Error('Management publication unavailable; proposal retained')
        draft = undefined
        const changedPaths = prepared.plan.changes
          .map((change) => change.path)
          .filter((path) => path !== '.memory.json')
        return {
          revision: result.revision,
          ...(args.action === 'init-project'
            ? { initialized: changedPaths, existing: [] }
            : { migrated: changedPaths, skipped: [] }),
        }
      }
      if (args.action === 'remember') {
        const text = bounded(args.text, 4096)
        if (!text) throw Error('Bounded remember text required')
        const targetPath = typeof args.path === 'string' ? args.path : 'system/human/notes.md'
        job?.cancel()
        const created = await f.request('create', { project: f.project, shared: true, ttlMs: 60000 })
        const currentFile = (await f.request('read', {
          view: created.view,
          selection: { path: targetPath, offset: 0, limit: 1 },
        })) as { missing?: boolean; hash?: string | null }
        const expectedHash = currentFile.missing ? null : (currentFile.hash ?? null)
        await f.request('edit', {
          view: created.view,
          path: targetPath,
          expectedHash,
          text: `- ${text}`,
          sources: [],
          mode: 'append',
          ...(typeof args.section === 'string' ? { section: args.section } : {}),
        })
        await f.request('ready', { view: created.view })
        const prepared = await f.request('prepare', { view: created.view, reviewed: [] })
        if ('conflict' in prepared) return prepared
        const result = await new MemoryPublisher(f.engine).publish(prepared.plan, f.context)
        if (result.stage !== 'reconciled_committed')
          throw Error('Remember publication unavailable; proposal retained')
        draft = undefined
        return {
          revision: result.revision,
          path: targetPath,
          remembered: true,
          contextActivation: 'next-primary-request',
        }
      }
      if (args.action === 'status') {
        if (latestAttempt && !latestAttempt.matches(ctx, f.configHash, f.project)) latestAttempt = undefined
        return {
          ...(await f.request('status', {})),
          project: f.project,
          draft: draft ? 'open' : undefined,
          worker: starting || job ? 'active' : 'idle',
          lastError,
          latestAttempt: latestAttempt?.value.snapshot() ?? null,
          historicalErasure: false,
          automatic: (await f.barrier()).config.automatic,
          policyOperation: await memoryPolicyStatus(f.engine, f.context),
          configHash: f.configHash,
          engineABI: 2,
          publication: draft ? 'private-draft-not-published' : 'committed-head',
          contextActivation: 'next-primary-request',
          unsupportedManagement: [],
        }
      }
      const policyContext = () => {
        const ids = ctx.sessionManager.getBranch().map((entry) => entry.id)
        if (ids.length > 8192) throw memoryFailure('capacity', 'Policy branch capacity exceeded')
        return {
          ...f.context,
          current: (targets: Parameters<OperationContext['current']>[0]) => {
            const branch = ctx.sessionManager.getBranch()
            return (
              branch.length <= 8192 &&
              ids.every((id, index) => branch[index]?.id === id) &&
              f.context.current(targets)
            )
          },
        }
      }
      if (args.action === 'policy-reconcile') {
        if (
          !f.abi.isPrimarySession(ctx) ||
          typeof args.target !== 'string' ||
          typeof args.revision !== 'string' ||
          Object.keys(args).some((key) => !['action', 'target', 'revision'].includes(key))
        )
          throw Error('Explicit primary policy target/digest required')
        compactionSerial++
        compacting = undefined
        return await reconcileMemoryPolicy(f.engine, policyContext(), args.target, args.revision)
      }
      if (args.action === 'policy') {
        if (
          !f.abi.isPrimarySession(ctx) ||
          typeof args.revision !== 'string' ||
          typeof args.configHash !== 'string' ||
          typeof args.automatic !== 'boolean' ||
          Object.keys(args).some((key) => !['action', 'revision', 'configHash', 'automatic'].includes(key))
        )
          throw Error('Explicit primary policy revision/configHash/automatic required')
        admissionSerial++
        compactionSerial++
        compacting = undefined
        pending = undefined
        job?.cancel()
        draft = undefined // retained proposal, never silently reset or published
        return await setMemoryAutomatic(
          f.engine,
          policyContext(),
          args.revision,
          args.configHash,
          args.automatic,
        )
      }
      if (args.action === 'reconcile') {
        if (
          !f.abi.isPrimarySession(ctx) ||
          typeof args.target !== 'string' ||
          typeof args.revision !== 'string'
        )
          throw Error('Primary same-operation reconciliation required')
        return await new MemoryPublisher(f.engine).reconcileExisting(args.target, args.revision, f.context)
      }
      if (args.action === 'conflicts')
        return await f.request('conflicts', {
          project: f.project,
          target: args.target as string | undefined,
          path: args.path as string | undefined,
          offset: args.offset as number | undefined,
          limit: args.limit as number | undefined,
        })
      if (args.action === 'cancel') {
        admissionSerial++
        compactionSerial++
        compacting = undefined
        pending = undefined
        job?.cancel()
        if (draft) await f.request('cancel', { view: draft.view })
        draft = undefined
        return { cancelled: true }
      }
      if (args.action === 'initialize') throw Error('Initialization requires an exclusively absent root')
      if (typeof args.revision !== 'string') throw Error('Expected current memory revision')
      job?.cancel()
      if (args.action === 'discard' && typeof args.target === 'string')
        return await f.request('discard', {
          project: f.project,
          target: args.target,
          revision: args.revision,
        })
      if (args.action === 'forget' || args.action === 'rollback') {
        const prepared = await f.request('manage', {
          action: args.action,
          project: f.project,
          revision: args.revision,
          paths: args.paths as string[] | undefined,
          sources: args.sources as string[] | undefined,
          target: args.target as string | undefined,
        })
        if (!('plan' in prepared)) throw Error('Management plan unavailable')
        const result = await new MemoryPublisher(f.engine).publish(prepared.plan, f.context)
        if (result.stage !== 'reconciled_committed')
          throw Error('Management publication unavailable; proposal retained')
        draft = undefined
        return {
          revision: result.revision,
          ...(args.action === 'forget'
            ? { historicalErasure: false }
            : { forgottenKnowledgeRestored: false }),
        }
      }
      throw Error('Invalid memory management action')
    }
    // A committed read does not acquire mutation admission or create a private draft.
    // Unknown publication/CAS locks may block new writes, never substitute dirty worktree truth for HEAD.
    if (name === 'agent_memory_read' && f.access.kind === 'primary' && !draft)
      return await f.request('headRead', { project: f.project, shared: true, selection: args })
    let selected: Draft
    if (f.access.kind === 'worker') {
      if (f.access.value.ready) throw Error('Worker proposal already ready')
      selected = { ...f.access.value }
    } else {
      if (
        !draft ||
        draft.project !== f.project ||
        draft.configHash !== f.configHash ||
        Date.now() >= draft.deadline
      ) {
        const created = await f.request('create', { project: f.project, shared: true, ttlMs: 600000 })
        draft = { ...created, project: f.project, configHash: f.configHash, deadline: Date.now() + 600000 }
      }
      selected = draft
    }
    if (name === 'agent_memory_read') return await f.request('read', { view: selected.view, selection: args })
    if (name === 'agent_memory_edit') {
      if (
        !objectShape(args, [
          'path',
          'expectedHash',
          'text',
          'sources',
          'mode',
          'oldText',
          'newText',
          'section',
        ]) ||
        typeof args.path !== 'string' ||
        !(typeof args.expectedHash === 'string' || args.expectedHash === null) ||
        !(typeof args.text === 'string' || args.text === null) ||
        !Array.isArray(args.sources) ||
        args.sources.some((source) => typeof source !== 'string') ||
        (args.mode !== undefined && !['replace', 'patch', 'append'].includes(args.mode as string)) ||
        (args.oldText !== undefined && typeof args.oldText !== 'string') ||
        (args.newText !== undefined && typeof args.newText !== 'string') ||
        (args.section !== undefined && typeof args.section !== 'string')
      )
        throw Error('Invalid edit')
      const result = await f.request('edit', {
        view: selected.view,
        path: args.path,
        expectedHash: args.expectedHash,
        text: args.text,
        sources: args.sources as string[],
        ...(typeof args.mode === 'string' ? { mode: args.mode as 'replace' | 'patch' | 'append' } : {}),
        ...(typeof args.oldText === 'string' ? { oldText: args.oldText } : {}),
        ...(typeof args.newText === 'string' ? { newText: args.newText } : {}),
        ...(typeof args.section === 'string' ? { section: args.section } : {}),
      })
      return { path: args.path, ...result, draft: true, activeContextChanged: false }
    }
    if (
      name !== 'agent_memory_commit' ||
      !objectShape(args, ['revision', 'allowShrink']) ||
      args.revision !== selected.base ||
      (args.allowShrink !== undefined && typeof args.allowShrink !== 'boolean')
    )
      throw Error('Expected base revision')
    await f.request('ready', { view: selected.view })
    if (f.access.kind === 'worker') {
      assertCurrent(f.context)
      f.access.value.ready = true
      return { readyForIntegration: true, activeContextChanged: false }
    }
    const prepared = await f.request('prepare', {
      view: selected.view,
      reviewed: [],
      ...(args.allowShrink === true ? { allowShrink: true } : {}),
    })
    draft = undefined
    if ('conflict' in prepared) return prepared
    const result = await new MemoryPublisher(f.engine).publish(prepared.plan, f.context)
    if (result.stage !== 'reconciled_committed') throw Error('Publication unavailable; proposal retained')
    return {
      revision: result.revision,
      changed: prepared.plan.changes.filter((change) => change.path !== '.memory.json').length,
      contextActivation: 'next-primary-request',
    }
  }
  pi.on('session_start', async (_event, ctx) => {
    const drained = retire()
    const serial = bindingSerial
    await drained
    if (serial !== bindingSerial) throw Error('Memory start retired')
    const next = nodes()?.get(ctx.sessionManager.getSessionId())
    if (next?.managedMemory?.version !== 2) throw Error('Experimental ABI2 required')
    bind(next, ctx)
  })
  pi.on('session_before_switch', retire)
  pi.on('session_before_fork', retire)
  pi.on('session_before_tree', async (_event, ctx) => {
    // A second SDK navigation after cancellation may carry a proven drained ticket,
    // never an in-flight transition or a terminally revoked owner. No engine is revived here.
    const previous =
      binding ??
      (treeResume?.ready && treeResume.serial === bindingSerial && treeResume.token === epoch
        ? treeResume
        : undefined)
    let serial = bindingSerial
    try {
      const drained = retire() // fences old operations synchronously, before the first await
      serial = bindingSerial
      if (!previous || !treeBindingCurrent(previous, ctx)) {
        await drained
        return { cancel: true }
      }
      const own = { ...previous, serial, token: epoch, drained, ready: false }
      treeResume = own
      await drained
      // SDK reports handler throws but may proceed. Explicit cancellation is the gate.
      if (treeResume !== own) return { cancel: true }
      if (!treeBindingCurrent(own, ctx)) {
        treeResume = undefined
        return { cancel: true }
      }
      own.ready = true
    } catch {
      if (serial === bindingSerial) treeResume = undefined
      return { cancel: true }
    }
  })
  pi.on('session_tree', async (_event, ctx) => {
    await reactivateTree(ctx, true)
  })
  pi.on('session_shutdown', retire)
  pi.on('session_before_compact', async (event, ctx) => {
    await closeViewer()
    compactionCheckpoint = `reason=${event.reason}; tokensBefore=${event.preparation?.tokensBefore ?? 'unknown'}`
    compacting = undefined
    try {
      if (active) compacting = compactionBoundary(event, ctx)
    } catch {
      // Missing/ambiguous evidence disables observation, never native compaction.
    }
  })
  pi.on('session_compact_failed', () => {
    compacting = undefined
  })
  pi.on('session_compact', (event, ctx) => {
    const boundary = compacting
    compacting = undefined
    const summaryText = bounded(event.compactionEntry?.summary, 1024)
    compactionCheckpoint = summaryText
      ? `reason=${event.reason}; summary=${summaryText.replace(/\s+/g, ' ').slice(0, 320)}`
      : `reason=${event.reason}; completed=true`
    // Owner-local bound before the first await; retirement joins this work. Do not
    // enqueue an unbounded tail, reactivate a retired owner, or start a writer here.
    if (compactionObserving || !active || !boundary) return
    compactionObserving = true
    const serial = compactionSerial
    return lifetime.track(async () => {
      try {
        const observation = compactionObservation(event, ctx, boundary)
        const f = await resolve(ctx, 'agent_memory_reflect', 'write')
        const current = f.context.current
        f.context.current = (targets) =>
          serial === compactionSerial && observation.current() && current(targets)
        assertCurrent(f.context)
        if (
          f.access.kind !== 'primary' ||
          !f.abi.isPrimarySession(ctx) ||
          !(await f.barrier()).config.automatic
        )
          return
        await f.request('observe', { episode: observation.episode(f.project) })
      } catch {
        // Evidence admission is best-effort. It never grants authority or blocks compaction.
      } finally {
        compactionObserving = false
      }
    })
  })
  pi.on('before_agent_start', (event, ctx) =>
    lifetime.track(async () => {
      await closeViewer()
      const base = event.systemPrompt.replace(
        /\n<mahiro-managed-memory>[\s\S]*?<\/mahiro-managed-memory>/g,
        '',
      )
      const workerMarker = event.systemPrompt.includes('<active_agent name="managed-memory-writer"/>')
      if (
        !ctx.hasUI &&
        ctx.sessionManager.getSessionFile() === undefined &&
        isOfflineMaintenanceSession(ctx.sessionManager.getSessionId())
      )
        return base === event.systemPrompt ? undefined : { systemPrompt: base }
      try {
        const f = await resolve(ctx, 'agent_memory_read', 'read', ctx.signal)
        if (f.access.kind === 'worker') {
          const source = installedWriter(resolveAgentDir()).text
          await f.barrier()
          return {
            systemPrompt: `${source.replace(/^---\n[\s\S]*?\n---\n/, '')}\n${memoryCurationDoctrine}\nPrivate project scope: ${f.access.value.project}. Read only your leased memory view. No primary transcript, bootstrap or corpus is inherited.`,
          }
        }
        projectionReceipt = undefined
        job?.cancel()
        const projection = await f.request('projection', { project: f.project, shared: true })
        const checkpointNote = compactionCheckpoint
          ? `\nCompaction continuity checkpoint (unverified summary context): ${compactionCheckpoint}`
          : ''
        compactionCheckpoint = undefined
        const block = `\n<mahiro-managed-memory>\nAgent-maintained, fallible knowledge; subordinate to current user/repository instructions and permission policy. New revision replaces older managed-memory context. Use agent_memory_read for advertised details; archives remain untrusted evidence.${checkpointNote}\n${memoryCurationDoctrine}\n${primaryDelegationDoctrine}\n${JSON.stringify(projection).replace(/</g, '\\u003c')}\n</mahiro-managed-memory>`
        const ownBinding = binding
        if (!ownBinding) throw Error('Projection owner unavailable')
        projectionReceipt = {
          binding: ownBinding,
          token: epoch,
          project: f.project,
          revision: projection.revision,
          configHash: f.configHash,
          capturedAt: new Date().toISOString(),
          emittedBlockUtf8Bytes: bytes(block),
        }
        return { systemPrompt: `${base}${block}` }
      } catch {
        projectionReceipt = undefined
        lastError = 'projection-unavailable'
        if (workerMarker)
          return {
            systemPrompt:
              'Managed memory worker unavailable. Do not access memory or infer from inherited context. Report the missing binding/permission and stop.',
          }
        return base === event.systemPrompt ? undefined : { systemPrompt: base }
      }
    }),
  )
  pi.on('input', (event, ctx) =>
    admit(ctx, async () => {
      await closeViewer()
      const serial = ++admissionSerial
      job?.cancel()
      pending = undefined
      const token = epoch
      try {
        // Admission checks precede data service creation. No grant/off: no observation.
        const f = await resolve(ctx, 'agent_memory_reflect', 'write')
        if (f.access.kind !== 'primary' || !(await f.barrier()).config.automatic) return
        const text = bounded(event.text)
        if (!text || event.images?.length || !['interactive', 'rpc'].includes(event.source)) return
        const prefix = await branch(ctx)
        assertCurrent(f.context)
        if (token !== epoch || serial !== admissionSerial) return
        pending = {
          serial,
          input: { text, source: event.source },
          branch: prefix,
          actions: [],
          results: [],
          toolCalls: new Set(),
        }
      } catch {
        /* No authority: no capture or fallback. */
      }
    }),
  )
  pi.on('message_end', (event, ctx) => {
    if (!pending) return
    try {
      const f = owner(ctx, 'agent_memory_reflect', 'write')
      if (f.access.kind !== 'primary' || event.message.role !== 'assistant') return
      const raw = rawText(event.message.content)
      const text = bounded(raw)
      if (raw && !text) return
      const tools = Array.isArray(event.message.content)
        ? event.message.content
            .filter((p) => p?.type === 'toolCall')
            .map((p) => p.name)
            .filter((n) => typeof n === 'string' && /^[a-z_]{1,64}$/.test(n) && !hasSecret(n))
            .slice(0, 8)
        : []
      if (text || tools.length)
        retain(pending.actions, { ...(text ? { text } : {}), ...(tools.length ? { tools } : {}) })
    } catch {
      pending = undefined
    }
  })
  pi.on('tool_execution_start', (event) => {
    if (
      pending &&
      pending.toolCalls.size < 64 &&
      event.toolName === 'bash' &&
      typeof event.args?.command === 'string' &&
      /^(?:pnpm (?:check|test)(?::[a-z-]+)?|node --test [a-zA-Z0-9_./* -]+)$/.test(event.args.command)
    )
      pending.toolCalls.add(event.toolCallId)
  })
  pi.on('tool_execution_end', (event) => {
    if (!pending?.toolCalls.delete(event.toolCallId) || event.toolName !== 'bash') return
    const raw = rawText(event.result?.content)
    const text = bounded(raw)
    if (raw && !text) return
    retain(pending.results, { tool: 'bash', error: event.isError, ...(text ? { text } : {}) })
  })
  pi.on('agent_before_settle', (event) => {
    outcome = event.outcome
    if (outcome !== 'completed') pending = undefined
  })
  pi.on('agent_settled', (event, ctx) =>
    lifetime.track(async () => {
      const own = pending
      pending = undefined
      if (event.aborted || outcome !== 'completed' || !own) {
        outcome = undefined
        return
      }
      outcome = undefined
      const token = epoch
      try {
        const f = await resolve(ctx, 'agent_memory_reflect', 'write')
        const current = f.context.current
        f.context.current = (targets) => own.serial === admissionSerial && current(targets)
        assertCurrent(f.context)
        if (f.access.kind !== 'primary' || !(await f.barrier()).config.automatic) return
        await branch(ctx, own.branch)
        const observed = ctx.sessionManager
          .getBranch()
          .slice(own.branch.length)
          .filter(
            (entry) =>
              entry.type === 'message' &&
              entry.message.role === 'user' &&
              bounded(rawText(entry.message.content)) === own.input.text,
          )
        if (observed.length !== 1 || !own.actions.length || token !== epoch) return
        const episode: TurnEpisode = {
          id: digest(`${ctx.sessionManager.getSessionId()}:${observed[0].id}`),
          project: f.project,
          session: ctx.sessionManager.getSessionId(),
          evidence: 'observed-native-unverified',
          observedAt: new Date().toISOString(),
          entryHash: digest(JSON.stringify(observed[0])),
          input: own.input,
          actions: own.actions,
          results: own.results,
          outcome: 'completed',
        }
        while (bytes(`${JSON.stringify(episode)}\n`) > 16384) {
          if (episode.results.length > 2) episode.results.splice(1, 1)
          else if (episode.actions.length > 2) episode.actions.splice(1, 1)
          else return
        }
        await f.request('observe', { episode })
        assertCurrent(f.context)
        if (token === epoch && (await f.barrier()).config.automatic) await startWriter(ctx)
      } catch {
        if (token === epoch) lastError = 'episode-or-writer-unavailable'
      }
    }),
  )
  return {
    run: (...args: Parameters<typeof run>) =>
      admit(args[2], async () => {
        const abi = pinned?.managedMemory
        const root = abi?.version === 2 ? abi.root : undefined
        const readOnly =
          args[0] === 'agent_memory_read' ||
          (args[0] === 'agent_memory_manage' && viewerReadActions.has(String(actionOf(args[1]))))
        try {
          if (!readOnly) await closeViewer()
          return await run(...args)
        } catch (error) {
          if (root) recordMemoryDiagnostic(root, 'runtime-error', { tool: args[0] }, error)
          throw error
        }
      }),
    cancel: retire,
    startWriter: (...args: Parameters<typeof startWriter>) => admit(args[0], () => startWriter(...args)),
    openPalaceViewer: (ctx: ExtensionContext) => admit(ctx, () => openPalaceViewer(ctx)),
    closePalaceViewer: async () => ({
      version: 1 as const,
      kind: 'abi2-palace-html-close' as const,
      closed: await closeViewer(),
    }),
    captureInvocation: (ctx: ExtensionContext) =>
      admit(
        ctx,
        async () =>
          (await captureInvocation(ctx)) as import('./invocation-context.ts').MemoryInvocationContext,
      ),
    capturePalaceContext: (ctx: ExtensionContext) => admit(ctx, () => captureInvocation(ctx, true)),
    knowledgeHistory: (ctx: ExtensionContext, offset: number) =>
      admit(ctx, () => knowledgeHistory(ctx, offset)),
    status: () => ({
      active,
      worker: starting || !!job,
      draft: draft ? 'open' : undefined,
      lastError,
      pid: primaryEngine?.pid,
      palaceViewer: viewer ? (viewer.revoked ? 'closing' : 'open') : viewerOpening ? 'starting' : undefined,
    }),
    drain: async () => {
      if (retirement) await retirement
      else await lifetime.drain()
    },
  }
}
