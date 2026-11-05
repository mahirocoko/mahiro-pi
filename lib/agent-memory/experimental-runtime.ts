import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { bytes, digest, hasSecret, objectShape } from '../continuity/records.ts'
import { selectedVerification, verificationResultText } from './verification-evidence.ts'
import { recordMemoryDiagnostic } from '../guards/memory-fixture.mjs'
import { abi2PalaceStyle, renderAbi2PalacePage } from '../palace-render/abi2-page.ts'
import { type ImmutablePalaceServer, startImmutablePalaceServer } from '../palace-render/immutable-server.ts'
import { resolveAgentDir } from '../setup.ts'
import { compactionBoundary, compactionObservation } from './compaction.ts'
import { type AttemptOutcome, createAttempt } from './engine/attempt.ts'
import { attemptTimingSink, type AttemptTimingEvent } from './engine/attempt-timing.ts'
import { assertCurrent, MemoryEngineController, type OperationContext } from './engine/controller.ts'
import { initializeMemoryRoot, prepareInitialization } from './engine/initializer.ts'
import { atomicPrivate } from './engine/io.ts'
import { MemoryLifetime } from './engine/lifetime.ts'
import { type MaintenanceRequest, offlineMaintenance } from './engine/offline-maintenance.ts'
import { offlineReset, type ResetRequest } from './engine/offline-reset.ts'
import { memoryPolicyStatus, reconcileMemoryPolicy, setMemoryAutomatic } from './engine/policy.ts'
import type { Input, Method, Output } from './engine/protocol.ts'
import { MemoryPublisher } from './engine/publisher.ts'
import { allowedDirectory, allowedPath, ensureTieredFrontmatter } from './engine/schema.ts'
import { extractFrontmatterAndLinks } from './retrieval.ts'
import type { EngineWorkerValue, MemoryABIV2 } from './experimental-contracts.ts'
import { memoryCurationDoctrine } from './guidance.ts'
import { buildMemoryInvocationContext, type MemoryProjectionReceipt } from './invocation-context.ts'
import type { KnowledgeHistory } from './knowledge-history.ts'
import { isOfflineMaintenanceSession } from './offline-bootstrap.ts'
import { buildPalaceDiagnostic, type PalaceDiagnostic } from './palace-diagnostic.ts'
import { buildPalaceHandoff, type PalaceHandoff } from './palace-handoff.ts'
import { primaryDelegationDoctrine } from './prompt.ts'
import {
  memoryFailure,
  memoryFailureCode,
  offlineResetFailure,
  type OfflineResetFailureCode,
} from './reasons.ts'
import {
  reflectionPolicy,
  validReflectionStepCount,
  validReflectionTrigger,
  type ReflectionTrigger,
} from './reflection-config.ts'
import {
  appendedSuffix,
  appendedSuffixSync,
  sameSessionAnchor,
  sessionAnchor,
  sessionSuffixBound,
  type SessionAnchor,
} from './session-branch.ts'
import {
  applyDerivedAssistantCredit,
  completeReflectionDelivery,
  createReflectionWindow,
  isReflectionRetryDeferred,
  nextReflectionDelivery,
  openReflectionBacklog,
  openReflectionCapture,
  openReflectionDrain,
  recordReflectionRetryOutcome,
  reflectionBacklogLimit,
  reflectionDeliveryLimit,
  resetReflectionWindow,
  stopReflectionDrain,
} from './reflection-schedule.ts'
import type { MemoryNode } from './runtime.ts'
import type { TurnEpisode } from './store.ts'
import { installedWriter, preflightWriterRoute } from './writer-route.ts'

const resetCheck = <T>(enabled: boolean, code: OfflineResetFailureCode, check: () => T): T => {
  try {
    return check()
  } catch (error) {
    throw enabled ? offlineResetFailure(error, code) : error
  }
}

const writerLifetimeMs = 240000
const publicationReserveMs = 30000
const statusOwnersKey = Symbol.for('@mahirocoko/pi-memory:status-owners')
const statusOwners: WeakMap<object, object> = ((
  globalThis as unknown as Record<symbol, WeakMap<object, object>>
)[statusOwnersKey] ??= new WeakMap())

export function formatReflectionStatus(
  mode: { trigger: ReflectionTrigger; stepCount: number },
  steps?: number,
) {
  if (mode.trigger === 'off') return '💤 off'
  if (mode.trigger === 'compaction-event') return '🗜️ compact'
  if (typeof steps === 'number' && Number.isSafeInteger(steps) && steps >= 0)
    return `😴 ${steps}/${mode.stepCount}`
  return `😴 ${mode.stepCount}`
}

export function resolveProjectSlug(
  cwd: string,
  projects: ReadonlyArray<{ cwd?: unknown; id?: unknown }>,
  explicitSlug?: string,
): string {
  if (!explicitSlug) {
    const mapped = projects.find((entry) => entry?.cwd === cwd && typeof entry.id === 'string')?.id as
      | string
      | undefined
    if (mapped) return mapped
  }
  const rawSlug =
    explicitSlug ??
    basename(cwd)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
  const baseSlug = /^[a-z0-9]/.test(rawSlug) ? rawSlug : `p-${rawSlug || 'project'}`.slice(0, 60)
  let slug = baseSlug
  let suffix = 2
  while (projects.some((entry) => entry?.id === slug && entry?.cwd !== cwd)) {
    slug = `${baseSlug.slice(0, 56)}-${suffix++}`
  }
  return slug
}

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
  branch: SessionAnchor
  actions: TurnEpisode['actions']
  results: TurnEpisode['results']
  toolCalls: Map<string, { command?: 'pnpm check' | 'pnpm test' }>
  assistantEvents: number
}
const registry = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
const palaceViewerTtlMs = 10 * 60 * 1000
const viewerReadActions = new Set([
  'status',
  'doctor',
  'palace',
  'migration-export',
  'offline-inspect',
  'offline-reset-inspect',
  'offline-episode-inspect',
  'offline-draft-inspect',
  'offline-draft-park-inspect',
  'offline-draft-restore-inspect',
  'capacity',
  'retained-preview',
])

interface PalaceViewerCapture {
  handoff: PalaceHandoff
  token: number
  binding: RuntimeBinding
  admission: number
  branch: SessionAnchor
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

export interface ExperimentalRuntimeConfig {
  openBrowser?: (url: string) => void | Promise<void>
}

function openSystemBrowser(url: string) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  const child = spawn(command, args, { shell: false, stdio: 'ignore', detached: true })
  child.on('error', () => {})
  child.unref()
}

export function createExperimentalMemoryRuntime(pi: ExtensionAPI, config: ExperimentalRuntimeConfig = {}) {
  let epoch = 0
  let admissionSerial = 0
  let active = false
  let pinned: MemoryNode | undefined
  let binding: RuntimeBinding | undefined
  let primaryEngine: MemoryEngineController | undefined
  let draft: Draft | undefined
  let creatingPrimaryDraft = false
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
  const reflection = createReflectionWindow()
  let reflectionFence:
    | {
        token: number
        serial: number
        generation: unknown
        configHash: string
        project: string
        node: MemoryNode
        manager: ExtensionContext['sessionManager']
        drainId: number
      }
    | undefined
  let reflectionLaunching = false
  let capacityDrainHeld = false
  let launchFence = 0
  interface ReflectionLaunch {
    token: number
    serial: number
    fence: number
    node: MemoryNode | undefined
    generation: unknown
    manager: ExtensionContext['sessionManager']
    drainId: number
  }
  const reflectionLaunchLive = (ctx: ExtensionContext, launch: ReflectionLaunch) =>
    active &&
    launch.token === epoch &&
    launch.serial === admissionSerial &&
    launch.fence === launchFence &&
    launch.node !== undefined &&
    pinned === launch.node &&
    launch.node.generation === launch.generation &&
    launch.node.managedMemory?.generation === launch.generation &&
    nodes()?.get(ctx.sessionManager.getSessionId()) === launch.node &&
    ctx.sessionManager === launch.manager &&
    reflection.drain?.id === launch.drainId &&
    reflectionFence?.drainId === launch.drainId &&
    reflectionFence?.serial === launch.serial &&
    reflectionFence?.token === launch.token
  const currentReflectionDrain = () => reflection.drain
  const reflectionForegroundMatches = (ctx: ExtensionContext) => {
    const fence = reflectionFence
    const drain = reflection.drain
    const node = fence?.node
    return (
      active &&
      fence !== undefined &&
      drain !== null &&
      node !== undefined &&
      fence.drainId === drain.id &&
      fence.token === epoch &&
      pinned === node &&
      node.generation === fence.generation &&
      node.managedMemory?.generation === fence.generation &&
      nodes()?.get(ctx.sessionManager.getSessionId()) === node &&
      ctx.sessionManager === fence.manager &&
      node.managedMemory?.isPrimarySession(ctx) === true
    )
  }
  // A cancelled admission must not dispatch its old ticket. The frozen ids stay
  // unreviewed, and the next settled launch on the same foreground adopts the
  // current admission before it builds a new ticket.
  const adoptReflectionAdmission = (ctx: ExtensionContext) => {
    const fence = reflectionFence
    if (!reflectionForegroundMatches(ctx) || !fence) return false
    if (fence.serial !== admissionSerial) reflectionFence = { ...fence, serial: admissionSerial }
    return true
  }
  // Primary foreground begins before any await. This fence cancels an automatic
  // launch already awaiting work. It does not change the admission captured by
  // the input that precedes an ordinary before_agent_start. Compaction keeps
  // its own serial, and an explicit reflect does not use this fence.
  const invalidateForegroundLaunch = (ctx: ExtensionContext) => {
    if (!active || !binding || ctx.sessionManager !== binding.manager) return
    if (pinned?.managedMemory?.isPrimarySession(ctx) !== true) return
    if (
      !ctx.hasUI &&
      ctx.sessionManager.getSessionFile() === undefined &&
      isOfflineMaintenanceSession(ctx.sessionManager.getSessionId())
    )
      return
    launchFence++
    job?.cancel()
  }
  const retireDrain = (drainId: number | undefined) => {
    if (drainId === undefined || !stopReflectionDrain(reflection, drainId)) return
    if (reflectionFence?.drainId === drainId) reflectionFence = undefined
    // The next settled capacity failure may open one new bounded drain.
    // This return does not launch that writer.
    capacityDrainHeld = false
  }
  let launchReflection: (
    ctx: ExtensionContext,
    ids: readonly string[],
    boundFence?: number,
  ) => Promise<void> = async () => {}
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
  const statusOwner = {}
  let statusContext: ExtensionContext | undefined
  const nodes = () => (globalThis as Record<symbol, Map<string, MemoryNode>>)[registry]
  const isPrimaryTui = (ctx: ExtensionContext) =>
    active &&
    ctx.mode === 'tui' &&
    ctx.hasUI &&
    typeof ctx.ui?.setStatus === 'function' &&
    binding !== undefined &&
    ctx.sessionManager === binding.manager &&
    binding.manager.getSessionId() === binding.sessionId &&
    pinned === binding.node &&
    binding.node.healthy() &&
    binding.abi.live() &&
    binding.abi.isPrimarySession(ctx)
  const clearStatus = () => {
    const ctx = statusContext
    statusContext = undefined
    if (!ctx?.ui || statusOwners.get(ctx.ui) !== statusOwner) return
    statusOwners.delete(ctx.ui)
    if (typeof ctx.ui.setStatus === 'function') ctx.ui.setStatus('mahiro-memory', undefined)
  }
  const publishStatus = (
    ctx: ExtensionContext,
    mode: { trigger: ReflectionTrigger; stepCount: number },
    steps?: number,
  ) => {
    if (!isPrimaryTui(ctx)) return
    if (statusContext?.ui !== ctx.ui) clearStatus()
    statusOwners.set(ctx.ui, statusOwner)
    statusContext = ctx
    ctx.ui.setStatus('mahiro-memory', formatReflectionStatus(mode, steps))
  }
  const publishInitialStatus = (ctx: ExtensionContext) => {
    if (!isPrimaryTui(ctx) || !binding) return
    try {
      const { abi, root, sessionId } = binding
      const tool = pi.getAllTools().find((entry) => entry.name === 'agent_memory_read')
      if (!tool || !abi.trustedTool(tool)) return
      const access = abi.assertAccess(tool, ctx, root, 'read')
      if (access.kind !== 'primary') return
      const configPath = join(root, 'config.json')
      abi.assertTargets(tool, ctx, root, 'read', [configPath])
      const rawConfig = JSON.parse(readFileSync(configPath, 'utf8'))
      if (!rawConfig || typeof rawConfig !== 'object' || typeof rawConfig.automatic !== 'boolean') return
      const mode = reflectionPolicy(rawConfig)
      if (mode.trigger !== 'step-count') {
        publishStatus(ctx, mode)
        return
      }
      let steps = 0
      try {
        const cwd = realpathSync(ctx.cwd)
        const projects = Array.isArray(rawConfig.projects) ? rawConfig.projects : []
        const project = resolveProjectSlug(cwd, projects)
        const ledgerPath = join(root, '.memory.json')
        const episodesDir = join(root, '.episodes')
        abi.assertTargets(tool, ctx, root, 'read', [ledgerPath, episodesDir])
        const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
        const reviewed = new Set<string>(Array.isArray(ledger?.reviewed) ? ledger.reviewed : [])
        const forgotten = new Set<string>(
          Array.isArray(ledger?.forgottenSources)
            ? ledger.forgottenSources
                .filter((entry: { project?: unknown }) => entry?.project === project)
                .map((entry: { source?: unknown }) => String(entry?.source ?? ''))
            : [],
        )
        const names = readdirSync(episodesDir)
          .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
          .sort()
        if (names.length <= 256) {
          const targets = names.map((name) => join(episodesDir, name))
          for (let start = 0; start < targets.length; start += 32)
            abi.assertTargets(tool, ctx, root, 'read', targets.slice(start, start + 32))
          for (const name of names) {
            const id = name.slice(0, -5)
            if (reviewed.has(id) || forgotten.has(id)) continue
            const ep = JSON.parse(readFileSync(join(episodesDir, name), 'utf8'))
            if (ep?.id === id && ep?.project === project && ep?.session === sessionId && !('kind' in ep)) {
              const credit =
                typeof ep.assistantSteps === 'number' &&
                Number.isSafeInteger(ep.assistantSteps) &&
                ep.assistantSteps >= 1
                  ? ep.assistantSteps
                  : 0
              steps += credit
            }
          }
        }
        if (reflection.project === null && !reflection.drain) {
          reflection.project = project
          reflection.steps = steps
        }
      } catch {
        steps = 0
      }
      publishStatus(ctx, mode, steps)
    } catch {
      // Absent/unconfigured/unattested store leaves status unset; startup provisions nothing.
    }
  }
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
    clearStatus()
    if (retirement) return retirement
    const viewerDrain = closeViewer()
    epoch++
    admissionSerial++
    launchFence++
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
    resetReflectionWindow(reflection)
    reflectionFence = undefined
    capacityDrainHeld = false
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
      const drains = await Promise.allSettled([viewerDrain, lifetime.drain()])
      if (engine) await engine.close() // data child LAST, even if a native/viewer join failed
      for (const result of drains) if (result.status === 'rejected') throw result.reason
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
    publishInitialStatus(ctx)
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
    resetDiagnostics = false,
  ) => {
    const node = pinned
    const ownBinding = binding
    const abi = node?.managedMemory
    const tool = pi.getAllTools().find((entry) => entry.name === name)
    if (!active || !node || !ownBinding || abi?.version !== 2 || !tool || !abi.root)
      throw resetDiagnostics
        ? offlineResetFailure(Error('Experimental memory unavailable'), 'reset-owner')
        : Error('Experimental memory unavailable')
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
          ? resetCheck(resetDiagnostics, 'maintenance-authority', () =>
              abi.maintenanceAccess(tool, ctx, root, operation, []),
            )
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
          if (maintenance)
            resetCheck(resetDiagnostics, 'maintenance-authority', () =>
              abi.maintenanceAccess(tool, ctx, root, operation, paths.slice(start, start + 32)),
            )
          else abi.assertTargets(tool, ctx, root, operation, paths.slice(start, start + 32))
        return true
      },
    }
    resetCheck(resetDiagnostics, 'reset-binding', () => assertCurrent(context))
    const access = maintenance
      ? resetCheck(resetDiagnostics, 'maintenance-authority', () =>
          abi.maintenanceAccess(tool, ctx, root, operation, []),
        )
      : abi.assertAccess(tool, ctx, root, operation)
    expected = access
    // No automatic cohort provisioning. Only an actually supplied parent participant
    // is inherited; installed legacy roots use the explicit offline handoff instead.
    if (!maintenance && access.kind === 'worker') context.admission = access.value.admission
    if (access.kind === 'primary' && !primaryEngine) {
      releaseController = abi.hold({ controller: token })
      primaryEngine = new MemoryEngineController(root)
    }
    const engine = access.kind === 'worker' ? access.value.engine : primaryEngine!
    if (
      engine.root !== root ||
      (access.kind === 'worker' && (access.value.version !== 2 || access.value.root !== root))
    )
      throw resetDiagnostics
        ? offlineResetFailure(Error('Opaque parent engine binding mismatch'), 'reset-binding')
        : Error('Opaque parent engine binding mismatch')
    let branchPrefix: SessionAnchor | undefined
    const barrier = async () => {
      assertCurrent(context)
      const guard = () => assertCurrent(context)
      branchPrefix = await branch(ctx, branchPrefix, guard)
      if (access.kind === 'worker') await access.value.dataBarrier()
      const data = await engine.request('config', {}, context)
      await branch(ctx, branchPrefix, guard)
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
    explicitProjectId?: string,
  ) => {
    const f = owner(ctx, name, operation, signal)
    await f.abi.authorize(f.tool, ctx, f.root, operation, signal)
    let { config, configHash } = await f.barrier()
    const cwd = await realpath(ctx.cwd)
    assertCurrent(f.context)
    const explicitSlug =
      typeof explicitProjectId === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(explicitProjectId)
        ? explicitProjectId
        : undefined
    const mappedEntry = config.projects.find((entry) => entry.cwd === cwd)
    const project = resolveProjectSlug(
      cwd,
      explicitSlug ? config.projects.filter((entry) => entry.cwd !== cwd) : config.projects,
      explicitSlug,
    )
    if (config.projects.some((entry) => entry.id === project && entry.cwd !== cwd))
      throw Error('Project identity collision')
    const canRegister = mappedEntry
      ? Boolean(explicitSlug && mappedEntry.id !== explicitSlug)
      : config.projects.length < 128
    if (
      f.access.kind === 'primary' &&
      f.abi.isPrimarySession(ctx) &&
      canRegister &&
      !viewer &&
      !viewerOpening &&
      !job &&
      !starting &&
      !draft
    ) {
      try {
        const configPath = join(f.root, 'config.json')
        const lockPath = join(f.root, '.lock')
        f.abi.assertTargets(f.tool, ctx, f.root, 'write', [f.root, configPath, lockPath])
        let locked = true
        try {
          await lstat(lockPath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') locked = false
          else throw error
        }
        if (!locked) {
          const currentStatus = await f.request('status', {})
          if (!currentStatus.pendingOperations.length) {
            const nextConfig = {
              ...config,
              projects: [...config.projects.filter((entry) => entry.cwd !== cwd), { cwd, id: project }],
            }
            await atomicPrivate(configPath, `${JSON.stringify(nextConfig)}\n`)
            const refreshed = await f.barrier()
            config = refreshed.config
            configHash = refreshed.configHash
          }
        }
      } catch {
        // Read-only calls or restricted target policies keep the derived readable slug in memory.
      }
    }
    return { ...f, project, configHash, config }
  }
  const branch = async (ctx: ExtensionContext, anchor?: SessionAnchor, guard?: () => void) => {
    const captured = anchor ?? sessionAnchor(ctx)
    const verdict = await appendedSuffix(ctx, captured, sessionSuffixBound, guard)
    if (!verdict.ok) throw memoryFailure('branch', 'Native memory branch changed')
    return captured
  }
  const capacityDiagnostic = async (ctx: ExtensionContext, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    ctx.signal?.throwIfAborted()
    if (!ctx.isIdle() || starting || job || draft)
      throw Error('Idle ABI2 primary capacity diagnostic required')
    const leaf = ctx.sessionManager.getLeafId()
    const f = owner(ctx, 'agent_memory_manage', 'read', signal ?? ctx.signal)
    const current = f.context.current
    f.context.current = (targets) => {
      signal?.throwIfAborted()
      ctx.signal?.throwIfAborted()
      return (
        ctx.isIdle() &&
        !starting &&
        !job &&
        !draft &&
        ctx.sessionManager.getLeafId() === leaf &&
        current(targets)
      )
    }
    assertCurrent(f.context)
    await f.abi.authorize(f.tool, ctx, f.root, 'read')
    assertCurrent(f.context)
    if (f.access.kind !== 'primary' || !f.abi.isPrimarySession(ctx))
      throw Error('Primary capacity diagnostic required')
    // This fallback diagnoses private metadata capacity. It does not walk the
    // session branch. The child still rechecks config/HEAD and every private
    // metadata target under current authority.
    const result = await f.engine.request('capacityDiagnostic', {}, f.context)
    assertCurrent(f.context)
    return result
  }
  const retainedDraftPreview = async (ctx: ExtensionContext, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    ctx.signal?.throwIfAborted()
    if (!ctx.isIdle() || starting || job || draft)
      throw Error('Idle ABI2 primary retained draft preview required')
    const leaf = ctx.sessionManager.getLeafId()
    const f = owner(ctx, 'agent_memory_manage', 'read', signal ?? ctx.signal)
    const current = f.context.current
    f.context.current = (targets) => {
      signal?.throwIfAborted()
      ctx.signal?.throwIfAborted()
      return (
        ctx.isIdle() &&
        !starting &&
        !job &&
        !draft &&
        ctx.sessionManager.getLeafId() === leaf &&
        current(targets)
      )
    }
    assertCurrent(f.context)
    await f.abi.authorize(f.tool, ctx, f.root, 'read')
    assertCurrent(f.context)
    if (f.access.kind !== 'primary' || !f.abi.isPrimarySession(ctx))
      throw Error('Primary retained draft preview required')
    // Classification only. It does not archive, unlink, or prove another controller is idle.
    const result = await f.engine.request('retainedDraftPreview', {}, f.context)
    assertCurrent(f.context)
    return result
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
    if (!sameSessionAnchor(ctx, exactBranch))
      throw memoryFailure('branch', 'Invocation context changed during capture')
    const finalStatus = combined ? await f.request('status', {}) : undefined
    const finalConfig = await f.barrier()
    if (finalStatus && finalStatus.revision !== status.revision)
      throw memoryFailure('CAS', 'Palace revision mismatch during capture')
    if (finalConfig.configHash !== f.configHash)
      throw memoryFailure('CAS', 'Invocation configuration changed during capture')
    if (
      token !== epoch ||
      ownBinding !== binding ||
      !ctx.isIdle() ||
      starting ||
      job ||
      draft ||
      !sameSessionAnchor(ctx, exactBranch)
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
    if (finalStatus.revision !== status.revision || finalConfig.configHash !== f.configHash)
      throw memoryFailure('CAS', 'History binding changed')
    if (
      token !== epoch ||
      ownBinding !== binding ||
      !ctx.isIdle() ||
      starting ||
      job ||
      draft ||
      !sameSessionAnchor(ctx, exactBranch)
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
      !sameSessionAnchor(ctx, exactBranch)
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
      branch: exactBranch,
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
      if (
        finalStatus.revision !== capture.revision ||
        finalConfig.configHash !== capture.configHash ||
        !sameSessionAnchor(ctx, capture.branch) ||
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
      // Best effort only: do not let an opener's rejection or pending promise own
      // the viewer lifecycle, block retirement, or tear down a published viewer.
      try {
        void Promise.resolve((config.openBrowser ?? openSystemBrowser)(server.url)).catch(() => {})
      } catch {}
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
        closeCommand: '/mh-memory palace close' as const,
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
  const startWriter = async (
    ctx: ExtensionContext,
    assignment?: string,
    delivery?: readonly string[],
    launch?: ReflectionLaunch,
  ) => {
    const token = launch?.token ?? epoch
    const serial = launch?.serial ?? admissionSerial
    const stale = () =>
      token !== epoch ||
      serial !== admissionSerial ||
      (launch !== undefined && !reflectionLaunchLive(ctx, launch))
    if (stale()) return { skipped: 'stale-launch' as const }
    await closeViewer()
    if (stale()) return { skipped: 'stale-launch' as const }
    if (starting || job) throw Error('Managed memory writer already active')
    if (assignment !== undefined && !bounded(assignment, 4096))
      throw Error('Bounded explicit memory assignment required')
    starting = true
    let own!: Job
    try {
      if (stale()) return { skipped: 'stale-launch' as const }
      const f = await resolve(ctx, 'agent_memory_reflect', 'write')
      const writerBinding = binding
      const current = f.context.current
      f.context.current = (targets) => serial === admissionSerial && current(targets)
      assertCurrent(f.context)
      if (f.access.kind !== 'primary' || !f.abi.isPrimarySession(ctx))
        throw Error('Primary writer launch required')
      const { config } = await f.barrier()
      if (assignment === undefined && !config.automatic) return { skipped: 'automatic-off' }
      if (delivery && (delivery.length < 1 || delivery.length > reflectionDeliveryLimit))
        throw Error('Invalid episode delivery')
      const episodes = delivery
        ? await f.request('selectEpisodes', { project: f.project, ids: [...delivery] })
        : await f.request('episodes', { project: f.project })
      if (delivery && !episodes.length) return { skipped: 'selection-empty' }
      if (assignment === undefined && !delivery && !episodes.length)
        return { skipped: 'no-unreviewed-episodes' }
      const requested = delivery ? [...delivery] : undefined
      const drainId = launch?.drainId
      if (stale()) return { skipped: 'stale-launch' as const }
      const service = f.abi.parentService()
      const role = service?.getAgentType('managed-memory-writer')
      if (!service || service.supportsInitialOutcomeClaim !== true || !role)
        throw Error('Locked native writer unavailable')
      const approved = installedWriter(resolveAgentDir(), role)
      preflightWriterRoute(ctx, approved)
      const prefix = await branch(ctx)
      const startedAt = Date.now()
      const created = await f.request('create', {
        project: f.project,
        ttlMs: writerLifetimeMs + publicationReserveMs,
      })
      const value: EngineWorkerValue = {
        version: 2,
        engine: f.engine,
        admission: f.context.admission,
        root: f.root,
        project: f.project,
        view: created.view,
        base: created.base,
        configHash: f.configHash,
        deadline: startedAt + writerLifetimeMs,
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
      let publicationDeadline: number | undefined
      const armDeadline = (deadline: number) => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(
          () => {
            if (job === own) {
              lastError = 'worker-deadline'
              own.cancel('deadline')
            }
          },
          Math.max(0, deadline - Date.now()),
        )
        timer.unref()
      }
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
        Date.now() < (publicationDeadline ?? value.deadline) &&
        !ctx.signal?.aborted
      const writerRecordCompleted = (
        record: { status?: unknown; turnBudget?: unknown } | undefined,
        ready: boolean,
      ) => {
        if (record?.status === 'completed') return true
        if (
          !ready ||
          (record?.status !== 'failed' &&
            record?.status !== 'error' &&
            record?.status !== 'aborted' &&
            record?.status !== 'stopped')
        )
          return false
        const budget =
          record.turnBudget && typeof record.turnBudget === 'object'
            ? (record.turnBudget as { used?: unknown; maxTurns?: unknown; phase?: unknown })
            : undefined
        return (
          budget?.phase === 'exhausted' ||
          (typeof budget?.used === 'number' &&
            typeof budget?.maxTurns === 'number' &&
            budget.maxTurns > 0 &&
            budget.used >= budget.maxTurns)
        )
      }
      const jobContext: OperationContext = {
        admission: f.context.admission,
        hold: (identity) => f.abi.hold(identity),
        current(targets) {
          if (identityLive() !== true) return false
          const record = service.getRecord(own.id!)
          if (
            !record ||
            record.id !== own.id ||
            record.type !== 'managed-memory-writer' ||
            (own.phase === 'integrating'
              ? !writerRecordCompleted(record, value.ready) || !value.ready
              : !['queued', 'running', 'completed'].includes(record.status) &&
                !writerRecordCompleted(record, value.ready))
          )
            return false
          return f.context.current(targets) === true
        },
      }
      const dataBarrier = async () => {
        assertCurrent(jobContext)
        const guard = () => assertCurrent(jobContext)
        await branch(ctx, prefix, guard)
        const data = await f.engine.request('config', {}, jobContext)
        if (data.configHash !== value.configHash) throw Error('Native memory config fence changed')
        await branch(ctx, prefix, guard)
        assertCurrent(jobContext)
      }
      value.dataBarrier = dataBarrier
      value[attemptTimingSink] = () => {
        assertCurrent(jobContext)
        return (event, id) => {
          assertCurrent(jobContext)
          attempt.timing.observe(event, id)
        }
      }
      jobContext.barrier = dataBarrier
      own = {
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
          if (requested) {
            retireDrain(drainId)
            if (result === 'deadline') recordReflectionRetryOutcome(reflection, false)
          }
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
            // Admission still uses the original worker deadline. Never revive an expired job.
            if (!identityLive()) {
              own.cancel('deadline')
              return
            }
            attempt.timing.freeze()
            own.phase = 'integrating' // reserve adoption synchronously before any await
            publicationDeadline = Math.min(
              value.deadline + publicationReserveMs,
              Date.now() + publicationReserveMs,
            )
            armDeadline(publicationDeadline)
            let integrated = false
            try {
              if (!writerRecordCompleted(record, value.ready) || !value.ready) {
                attempt.finish(
                  !writerRecordCompleted(record, value.ready) ? 'native-unsuccessful' : 'not-ready',
                )
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
              integrated = true
              recordReflectionRetryOutcome(reflection, true)
              if (token === epoch) lastError = undefined
            } catch {
              if (requested) {
                retireDrain(drainId)
                if (token === epoch && job === own) recordReflectionRetryOutcome(reflection, false)
              }
              attempt.finish('integration-unavailable')
              if (token === epoch && job === own) lastError = 'worker-integration-unavailable'
              // Foreground cancellation revokes job authority, not permission to adopt an
              // uncertain operation. Only this controller's pre-write owner can prove a
              // never-published prepare drained. Obtain fresh primary authority, fenced to
              // the original runtime/root/generation; retirement never performs cleanup.
              try {
                if (active && token === epoch && binding === writerBinding) {
                  const cleanup = await resolve(ctx, 'agent_memory_manage', 'write')
                  const cleanupCurrent = cleanup.context.current
                  cleanup.context.current = (targets) =>
                    token === epoch &&
                    binding === writerBinding &&
                    cleanup.engine === f.engine &&
                    cleanup.access.kind === 'primary' &&
                    cleanupCurrent(targets)
                  assertCurrent(cleanup.context)
                  await f.engine.retireUnpublished(value.view, cleanup.context)
                  await f.engine.request('cancel', { view: value.view }, cleanup.context).catch(() => {})
                }
              } catch {
                // Lost authority/CAS/channel/operation evidence remains unknown, never replayed.
              }
            } finally {
              own.stop()
            }
            if (
              integrated &&
              requested &&
              launch &&
              drainId !== undefined &&
              reflection.drain?.id === drainId
            ) {
              const session = episodes.find((episode) => typeof episode.session === 'string')?.session
              if (session && reflectionLaunchLive(ctx, launch)) {
                try {
                  const credit = await f.request('episodeCredit', { project: f.project, session })
                  if (reflectionLaunchLive(ctx, launch)) reflection.steps = credit.steps
                } catch {
                  // The ledger already excludes published ids. The next observation reads that sum.
                }
              }
              completeReflectionDelivery(
                reflection,
                drainId,
                requested,
                episodes.map((episode) => episode.id),
              )
              if (!reflection.drain) capacityDrainHeld = false
            }
            if (integrated && isPrimaryTui(ctx)) {
              try {
                const { config } = await f.barrier()
                const mode = reflectionPolicy(config)
                if (mode.trigger === 'step-count') {
                  const credit = await f.request('episodeCredit', {
                    project: f.project,
                    session: ctx.sessionManager.getSessionId(),
                  })
                  if (reflection.project === f.project) reflection.steps = credit.steps
                  publishStatus(ctx, mode, credit.steps)
                } else {
                  publishStatus(ctx, mode)
                }
              } catch {
                // Status refresh after writer integration is best-effort.
              }
            }
          }),
      }
      if (stale()) return { skipped: 'stale-launch' as const }
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
      armDeadline(value.deadline)
      try {
        if (stale()) {
          own.stop()
          return { skipped: 'stale-launch' as const }
        }
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
            description: assignment
              ? `Reflect memory (${f.project})`
              : `Curate memory (${episodes.length} episode${episodes.length === 1 ? '' : 's'})`,
            model: route.model,
            thinkingLevel: route.thinking,
            foreground: false,
            bypassQueue: false,
            inheritContext: false,
            maxTurns: 8,
            claimOutcome: true,
          },
        )
        // Reserve the actual native join immediately after spawn, BEFORE any fallible binding.
        // The enclosing lifetime.track also pins reentrant retirement until spawn returns its id.
        void lifetime
          .join(() => service.waitForAll())
          .catch(() => {
            if (token === epoch) lastError = 'native-drain-unavailable'
          })
        if (stale() || job !== own) throw Error('Memory writer launch retired')
        attempt.bind(() => service.getRecord(own.id!))
        revoke = f.abi.bindWorker(f.tool, ctx, f.root, own.id, value, identityLive)
        own.phase = 'running'
        void own.finish()
        return { job: own.id, status: 'native-dispatched', providerProof: false }
      } catch (error) {
        if (own) own.cancel('dispatch-failed')
        throw error
      }
    } finally {
      if (token === epoch) starting = false
    }
  }
  launchReflection = async (ctx, ids, boundFence = launchFence) => {
    if (!ids.length || reflectionLaunching || starting || job || !reflection.drain || !reflectionFence) return
    if (boundFence !== launchFence || !adoptReflectionAdmission(ctx)) return
    const launch: ReflectionLaunch = {
      token: epoch,
      serial: admissionSerial,
      fence: boundFence,
      node: pinned,
      generation: pinned?.generation,
      manager: ctx.sessionManager,
      drainId: reflection.drain.id,
    }
    if (!reflectionLaunchLive(ctx, launch)) return
    reflectionLaunching = true
    try {
      let batch = ids
      for (let jobs = 0; batch.length && jobs < 64; jobs++) {
        if (!reflectionLaunchLive(ctx, launch)) return
        let resolved: Awaited<ReturnType<typeof resolve>>
        let automatic = false
        try {
          resolved = await resolve(ctx, 'agent_memory_reflect', 'write')
          automatic = (await resolved.barrier()).config.automatic
        } catch {
          if (reflectionLaunchLive(ctx, launch)) {
            retireDrain(launch.drainId)
            if (launch.token === epoch) lastError = 'episode-or-writer-unavailable'
          }
          return
        }
        if (!reflectionLaunchLive(ctx, launch)) return
        if (
          !automatic ||
          resolved.configHash !== reflectionFence.configHash ||
          resolved.project !== reflectionFence.project ||
          resolved.node !== reflectionFence.node ||
          resolved.node.generation !== launch.generation ||
          resolved.abi.generation !== launch.generation ||
          resolved.node.managedMemory !== resolved.abi ||
          resolved.access.kind !== 'primary' ||
          !resolved.abi.isPrimarySession(ctx)
        ) {
          if (reflectionLaunchLive(ctx, launch)) retireDrain(launch.drainId)
          return
        }
        try {
          const result = await startWriter(ctx, undefined, batch, launch)
          if (!reflectionLaunchLive(ctx, launch)) return
          if (result && 'skipped' in result && result.skipped === 'stale-launch') return
          if (result && 'skipped' in result && result.skipped === 'selection-empty') {
            batch = completeReflectionDelivery(reflection, launch.drainId, batch, [])
            continue
          }
          if (result && 'skipped' in result) {
            retireDrain(launch.drainId)
            return
          }
          return
        } catch (error) {
          if (error instanceof Error && error.message === 'Managed memory writer already active') return
          if (reflectionLaunchLive(ctx, launch)) {
            retireDrain(launch.drainId)
            if (launch.token === epoch) lastError = 'episode-or-writer-unavailable'
          }
          return
        }
      }
      if (batch.length && reflectionLaunchLive(ctx, launch)) retireDrain(launch.drainId)
    } finally {
      reflectionLaunching = false
    }
  }
  const run = async (name: string, args: unknown, ctx: ExtensionContext, signal?: AbortSignal) => {
    if (
      name === 'agent_memory_manage' &&
      objectShape(args, ['action']) &&
      args.action === 'capacity' &&
      Object.keys(args).length === 1
    )
      return await capacityDiagnostic(ctx, signal)
    if (
      name === 'agent_memory_manage' &&
      objectShape(args, ['action']) &&
      args.action === 'retained-preview' &&
      Object.keys(args).length === 1
    )
      return await retainedDraftPreview(ctx, signal)
    if (
      name === 'agent_memory_manage' &&
      objectShape(args, ['action', 'core', 'projectId', 'automatic']) &&
      args.action === 'initialize'
    ) {
      const f = owner(ctx, name, 'write', signal)
      // Capture the leaf before authorization yields. Initialization has no config
      // for the ordinary data barrier. Later checks accept only a bounded suffix.
      const anchor = await branch(ctx, undefined, () => assertCurrent(f.context))
      const context = {
        ...f.context,
        barrier: async () => {
          assertCurrent(f.context)
          await branch(ctx, anchor, () => assertCurrent(f.context))
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
      const initialized = await initializeMemoryRoot(f.root, plan, context)
      publishStatus(ctx, reflectionPolicy({ automatic: args.automatic !== false }), 0)
      return initialized
    }
    if (
      name === 'agent_memory_manage' &&
      objectShape(args, ['action', 'target', 'revision', 'offline', 'destruction']) &&
      [
        'offline-reset-inspect',
        'offline-reset',
        'offline-inspect',
        'offline-adopt',
        'offline-resume',
        'offline-episode-inspect',
        'offline-episode-recover',
        'offline-episode-resume',
        'offline-draft-inspect',
        'offline-draft-archive',
        'offline-draft-resume',
        'offline-draft-rollback',
        'offline-draft-park-inspect',
        'offline-draft-park',
        'offline-draft-restore-inspect',
        'offline-draft-restore',
      ].includes(args.action as string)
    ) {
      const reset = args.action === 'offline-reset-inspect' || args.action === 'offline-reset'
      if (
        reset &&
        (!isOfflineMaintenanceSession(ctx.sessionManager.getSessionId()) ||
          ctx.hasUI ||
          ctx.sessionManager.getSessionFile() !== undefined)
      )
        throw offlineResetFailure(
          memoryFailure(
            'offline-only',
            'Reset is available only through the explicit native offline operator',
          ),
          'offline-context',
        )
      if (!reset && 'destruction' in args) throw Error('Destruction belongs only to offline reset')
      const f = resetCheck(reset, 'reset-owner', () =>
        owner(
          ctx,
          name,
          viewerReadActions.has(args.action as string) ? 'read' : 'write',
          signal,
          true,
          reset,
        ),
      )
      if (f.access.kind !== 'primary' || !f.abi.isPrimarySession(ctx) || starting || job || draft)
        throw reset
          ? offlineResetFailure(Error('Idle ephemeral primary maintenance owner required'), 'idle')
          : Error('Idle ephemeral primary maintenance owner required')
      // No ordinary config/data barrier, cached recovered plan or manufactured current verdict.
      // Root maintenanceAccess rechecks the real manager, generation, tool and exact PSS targets.
      const anchor = await branch(ctx).catch((error) => {
        throw reset ? offlineResetFailure(error, 'branch') : error
      })
      const current = f.context.current
      const context: OperationContext = {
        ...f.context,
        current: (targets) => appendedSuffixSync(ctx, anchor).ok && current(targets),
      }
      resetCheck(reset, 'branch', () => assertCurrent(context))
      if (reset) {
        if (f.root !== join(resolveAgentDir(), 'memory'))
          throw offlineResetFailure(Error('Exact standard profile root required'), 'standard-root')
        return await offlineReset(f.engine, context, args as unknown as ResetRequest)
      }
      return await offlineMaintenance(f.engine, context, args as unknown as MaintenanceRequest)
    }
    if (
      name === 'agent_memory_manage' &&
      objectShape(args, ['action']) &&
      args.action === 'status' &&
      Object.keys(args).length === 1
    ) {
      const f = owner(ctx, name, 'read', signal)
      if (f.access.kind !== 'primary' || !f.abi.isPrimarySession(ctx))
        throw Error('Primary management required')
      await branch(ctx, undefined, () => assertCurrent(f.context))
      assertCurrent(f.context, { physical: [f.root], logical: [], kind: 'data' })
      try {
        await lstat(f.root)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        assertCurrent(f.context, { physical: [f.root], logical: [], kind: 'data' })
        return {
          state: 'absent-uninitialized',
          initialized: false,
          lockPresent: false,
          pendingOperation: false,
        }
      }
    }
    const manageRead = (action: unknown) =>
      action === 'status' || action === 'doctor' || action === 'palace' || action === 'migration-export'
    const requestedRead = name === 'agent_memory_manage' && manageRead(actionOf(args))
    const explicitInitProjectId =
      name === 'agent_memory_manage' &&
      objectShape(args, ['action', 'projectId']) &&
      args.action === 'init-project' &&
      typeof args.projectId === 'string'
        ? args.projectId
        : undefined
    const f = await resolve(
      ctx,
      name,
      name === 'agent_memory_read' || requestedRead ? 'read' : 'write',
      signal,
      explicitInitProjectId,
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
          'reflectionTrigger',
          'reflectionStepCount',
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
        let targetProject = f.project
        if (args.action === 'init-project') {
          const cwd = await realpath(ctx.cwd)
          assertCurrent(f.context)
          const explicitSlug =
            typeof args.projectId === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(args.projectId)
              ? args.projectId
              : undefined
          const mappedEntry = f.config.projects.find((entry) => entry.cwd === cwd)
          const canRegister = mappedEntry
            ? Boolean(explicitSlug && mappedEntry.id !== explicitSlug)
            : f.config.projects.length < 128
          if (canRegister && !draft && !starting && !viewer && !viewerOpening) {
            const currentStatus = await f.request('status', {})
            const slug = resolveProjectSlug(
              cwd,
              f.config.projects.filter((entry) => entry.cwd !== cwd),
              explicitSlug,
            )
            const configPath = join(f.root, 'config.json')
            const lockPath = join(f.root, '.lock')
            f.abi.assertTargets(f.tool, ctx, f.root, 'write', [f.root, configPath, lockPath])
            let locked = true
            try {
              await lstat(lockPath)
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') locked = false
              else throw error
            }
            if (!locked && !currentStatus.pendingOperations.length) {
              const nextConfig = {
                ...f.config,
                projects: [...f.config.projects.filter((entry) => entry.cwd !== cwd), { cwd, id: slug }],
              }
              await atomicPrivate(configPath, `${JSON.stringify(nextConfig)}\n`)
              const refreshed = await f.barrier()
              f.config = refreshed.config
              f.configHash = refreshed.configHash
              f.project = slug
              targetProject = slug
            }
          }
          if (reflection.project === null || (!reflection.drain && reflection.project !== targetProject)) {
            reflection.project = targetProject
            reflection.steps = 0
          }
          publishStatus(
            ctx,
            reflectionPolicy(f.config),
            reflection.project === targetProject ? reflection.steps : 0,
          )
        }
        const staged = await f.request('manage', { action: args.action, project: targetProject })
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
        if (!allowedPath(targetPath, f.project)) throw Error('Memory path outside scope')
        job?.cancel()
        if (draft) {
          await f.request('cancel', { view: draft.view }).catch(() => undefined)
          draft = undefined
        }
        const created = await f.request('create', { project: f.project, shared: true, ttlMs: 60000 })
        const currentFile = (await f.request('read', {
          view: created.view,
          selection: { path: targetPath, offset: 0, limit: 1 },
        })) as { missing?: boolean; hash?: string | null }
        const expectedHash = currentFile.missing ? null : (currentFile.hash ?? null)
        const slug = targetPath.split('/').pop()!.replace(/\.md$/, '')
        const newEntry =
          currentFile.missing && !['Core.md', 'index.md'].includes(targetPath)
            ? `---\nname: ${slug}\ndescription: Durable remembered notes for ${targetPath}\n---\n# ${slug}\n\n${
                typeof args.section === 'string'
                  ? `${args.section.startsWith('#') ? args.section : `## ${args.section}`}\n\n- ${text}`
                  : `- ${text}`
              }`
            : `- ${text}`
        await f.request('edit', {
          view: created.view,
          path: targetPath,
          expectedHash,
          text: newEntry,
          sources: [],
          mode: 'append',
          ...(typeof args.section === 'string' &&
          (!currentFile.missing || ['Core.md', 'index.md'].includes(targetPath))
            ? { section: args.section }
            : {}),
        })
        if (!['Core.md', 'index.md'].includes(targetPath) && !targetPath.endsWith('/index.md')) {
          const indexTargets = ['index.md']
          if (targetPath.includes('/')) {
            const parentIndex = `${targetPath.slice(0, targetPath.lastIndexOf('/'))}/index.md`
            if (allowedPath(parentIndex, f.project)) indexTargets.unshift(parentIndex)
          }
          for (const indexPath of indexTargets) {
            const idxFile = (await f.request('read', {
              view: created.view,
              selection: { path: indexPath, offset: 0, limit: 4096 },
            })) as { missing?: boolean; hash?: string | null; text?: string }
            if (
              !idxFile.missing &&
              idxFile.hash &&
              typeof idxFile.text === 'string' &&
              !idxFile.text.includes(`[[${targetPath}]]`)
            ) {
              await f.request('edit', {
                view: created.view,
                path: indexPath,
                expectedHash: idxFile.hash,
                text: `- [[${targetPath}]] — Durable remembered notes for ${targetPath}`,
                sources: [],
                mode: 'append',
              })
            }
          }
        }
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
        const status = await f.request('status', {})
        const { config } = await f.barrier()
        const mode = reflectionPolicy(config)
        publishStatus(ctx, mode, reflection.project === f.project ? reflection.steps : 0)
        return {
          ...status,
          project: f.project,
          draft: draft ? 'open' : undefined,
          worker: starting || job ? 'active' : 'idle',
          lastError,
          latestAttempt: latestAttempt?.value.snapshot() ?? null,
          historicalErasure: false,
          automatic: config.automatic,
          reflectionTrigger: mode.trigger,
          reflectionStepCount: mode.stepCount,
          policyOperation: await memoryPolicyStatus(f.engine, f.context, status.pendingOperations),
          configHash: f.configHash,
          engineABI: 2,
          publication: draft ? 'private-draft-not-published' : 'committed-head',
          contextActivation: 'next-primary-request',
          unsupportedManagement: [],
        }
      }
      const policyContext = () => {
        const anchor = sessionAnchor(ctx)
        const verdict = appendedSuffixSync(ctx, anchor)
        if (!verdict.ok) throw memoryFailure('branch', 'Native memory branch changed')
        return {
          ...f.context,
          current: (targets: Parameters<OperationContext['current']>[0]) =>
            appendedSuffixSync(ctx, anchor).ok && f.context.current(targets),
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
        const reflectionRequested =
          Object.hasOwn(args, 'reflectionTrigger') || Object.hasOwn(args, 'reflectionStepCount')
        if (
          !f.abi.isPrimarySession(ctx) ||
          typeof args.revision !== 'string' ||
          typeof args.configHash !== 'string' ||
          typeof args.automatic !== 'boolean' ||
          Object.keys(args).some(
            (key) =>
              ![
                'action',
                'revision',
                'configHash',
                'automatic',
                'reflectionTrigger',
                'reflectionStepCount',
              ].includes(key),
          ) ||
          (reflectionRequested &&
            (!validReflectionTrigger(args.reflectionTrigger) ||
              !validReflectionStepCount(args.reflectionStepCount)))
        )
          throw Error('Explicit primary policy revision/configHash/automatic required')
        admissionSerial++
        launchFence++
        compactionSerial++
        compacting = undefined
        pending = undefined
        job?.cancel()
        draft = undefined // retained proposal, never silently reset or published
        const selection = reflectionRequested
          ? {
              trigger: args.reflectionTrigger as ReflectionTrigger,
              stepCount: args.reflectionStepCount as number,
            }
          : undefined
        const policyResult = await setMemoryAutomatic(
          f.engine,
          policyContext(),
          args.revision,
          args.configHash,
          args.automatic,
          selection,
        )
        const mode = selection ?? reflectionPolicy({ automatic: args.automatic })
        publishStatus(ctx, mode, reflection.project === f.project ? reflection.steps : 0)
        return policyResult
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
        launchFence++
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
        draft &&
        (draft.project !== f.project || draft.configHash !== f.configHash || Date.now() >= draft.deadline)
      )
        throw memoryFailure('draft', 'Existing primary draft selection invalid; proposal preserved')
      if (!draft) {
        // Fail closed while creation yields: a second caller must not replace the first pointer.
        if (creatingPrimaryDraft)
          throw memoryFailure('draft', 'Primary draft creation pending; proposal preserved')
        creatingPrimaryDraft = true
        const token = epoch
        const serial = admissionSerial
        try {
          const created = await f.request('create', { project: f.project, shared: true, ttlMs: 600000 })
          assertCurrent(f.context)
          if (token !== epoch || serial !== admissionSerial)
            throw memoryFailure('draft', 'Primary draft admission changed; proposal preserved')
          draft = { ...created, project: f.project, configHash: f.configHash, deadline: Date.now() + 600000 }
        } finally {
          creatingPrimaryDraft = false
        }
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
          'commit',
          'allowShrink',
        ]) ||
        typeof args.path !== 'string' ||
        !(
          typeof args.expectedHash === 'string' ||
          args.expectedHash === null ||
          (args.expectedHash === undefined && args.mode === 'append')
        ) ||
        !(
          typeof args.text === 'string' ||
          args.text === null ||
          (args.text === undefined && (args.mode === 'patch' || args.mode === 'append'))
        ) ||
        !(args.sources === undefined || Array.isArray(args.sources)) ||
        (Array.isArray(args.sources) && args.sources.some((source) => typeof source !== 'string')) ||
        (args.mode !== undefined && !['replace', 'patch', 'append'].includes(args.mode as string)) ||
        (args.oldText !== undefined && typeof args.oldText !== 'string') ||
        (args.newText !== undefined && typeof args.newText !== 'string') ||
        (args.section !== undefined && typeof args.section !== 'string') ||
        (args.commit !== undefined && typeof args.commit !== 'boolean') ||
        (args.allowShrink !== undefined && typeof args.allowShrink !== 'boolean')
      )
        throw memoryFailure('invalid-arguments', 'Invalid memory edit arguments')
      const strippedPath = args.path.startsWith('/') ? args.path.replace(/^\/+/, '') : args.path
      const normalizedPath =
        args.path.startsWith('/') &&
        (allowedPath(strippedPath) || allowedDirectory(strippedPath.replace(/\/+$/, ''), undefined, true))
          ? strippedPath
          : args.path
      const normalizedText =
        args.expectedHash === null &&
        typeof args.text === 'string' &&
        (args.mode === undefined || args.mode === 'replace')
          ? ensureTieredFrontmatter(normalizedPath, args.text)
          : args.text
      const result = await f.request('edit', {
        view: selected.view,
        path: normalizedPath,
        ...(args.expectedHash !== undefined ? { expectedHash: args.expectedHash } : {}),
        ...(normalizedText !== undefined ? { text: normalizedText } : {}),
        sources: (args.sources ?? []) as string[],
        ...(typeof args.mode === 'string' ? { mode: args.mode as 'replace' | 'patch' | 'append' } : {}),
        ...(typeof args.oldText === 'string' ? { oldText: args.oldText } : {}),
        ...(typeof args.newText === 'string' ? { newText: args.newText } : {}),
        ...(typeof args.section === 'string' ? { section: args.section } : {}),
      })
      if (args.commit === true) {
        if (
          normalizedText !== null &&
          !['Core.md', 'index.md'].includes(normalizedPath) &&
          !normalizedPath.endsWith('/index.md')
        ) {
          const scope = f.access.kind === 'primary' ? undefined : f.project
          const indexEntries: { indexPath: string; targetPath: string; summary: string }[] = []
          const draftTarget = (await f.request('read', {
            view: selected.view,
            selection: { path: normalizedPath, offset: 0, limit: 4096 },
          })) as { text?: string }
          const targetBody =
            typeof draftTarget.text === 'string'
              ? draftTarget.text
              : typeof normalizedText === 'string'
                ? normalizedText
                : undefined
          const description =
            (targetBody ? extractFrontmatterAndLinks(targetBody).description : undefined) ??
            `Maintained memory notes for ${normalizedPath}`
          if (normalizedPath.includes('/')) {
            const dirParts = normalizedPath.slice(0, normalizedPath.lastIndexOf('/')).split('/')
            for (let i = 1; i < dirParts.length; i++) {
              const ancestorDir = dirParts.slice(0, i).join('/')
              const childDir = dirParts.slice(0, i + 1).join('/')
              const ancestorIndex = `${ancestorDir}/index.md`
              const childIndex = `${childDir}/index.md`
              if (allowedPath(ancestorIndex, scope) && allowedPath(childIndex, scope)) {
                indexEntries.push({
                  indexPath: ancestorIndex,
                  targetPath: childIndex,
                  summary: `Index for ${childDir}`,
                })
              }
            }
            const parentIndex = `${dirParts.join('/')}/index.md`
            if (allowedPath(parentIndex, scope)) {
              indexEntries.push({
                indexPath: parentIndex,
                targetPath: normalizedPath,
                summary: description,
              })
            }
          }
          indexEntries.push({
            indexPath: 'index.md',
            targetPath: normalizedPath,
            summary: description,
          })
          for (const { indexPath, targetPath, summary } of indexEntries) {
            const idxFile = (await f.request('read', {
              view: selected.view,
              selection: { path: indexPath, offset: 0, limit: 4096 },
            })) as { missing?: boolean; hash?: string | null; text?: string }
            if (idxFile.missing) {
              const title = indexPath.endsWith('/index.md')
                ? `${indexPath.slice(0, -'/index.md'.length)} index`
                : 'Index'
              await f.request('edit', {
                view: selected.view,
                path: indexPath,
                expectedHash: null,
                text: `# ${title}\n\n- [[${targetPath}]] — ${summary}\n`,
                sources: (args.sources ?? []) as string[],
              })
            } else if (
              idxFile.hash &&
              typeof idxFile.text === 'string' &&
              !idxFile.text.includes(`[[${targetPath}]]`)
            ) {
              await f.request('edit', {
                view: selected.view,
                path: indexPath,
                expectedHash: idxFile.hash,
                text: `- [[${targetPath}]] — ${summary}`,
                sources: (args.sources ?? []) as string[],
                mode: 'append',
              })
            }
          }
        }
        await f.request('ready', { view: selected.view })
        if (f.access.kind === 'worker') {
          assertCurrent(f.context)
          f.access.value.ready = true
          return {
            path: normalizedPath,
            ...result,
            draft: false,
            readyForIntegration: true,
            activeContextChanged: false,
          }
        }
        const prepared = await f.request('prepare', {
          view: selected.view,
          reviewed: [],
          ...(args.allowShrink === true ? { allowShrink: true } : {}),
        })
        draft = undefined
        if ('conflict' in prepared) return { path: normalizedPath, ...result, ...prepared }
        const published = await new MemoryPublisher(f.engine).publish(prepared.plan, f.context)
        if (published.stage !== 'reconciled_committed')
          throw Error('Publication unavailable; proposal retained')
        return {
          path: normalizedPath,
          ...result,
          draft: false,
          committed: true,
          revision: published.revision,
          changed: prepared.plan.changes.filter((change) => change.path !== '.memory.json').length,
          contextActivation: 'next-primary-request',
        }
      }
      return { path: normalizedPath, ...result, draft: true, activeContextChanged: false }
    }
    if (
      name !== 'agent_memory_commit' ||
      !objectShape(args, ['revision', 'allowShrink']) ||
      typeof args.revision !== 'string' ||
      (args.allowShrink !== undefined && typeof args.allowShrink !== 'boolean')
    )
      throw Error('Expected base revision')
    if (args.revision !== selected.base) throw memoryFailure('CAS', 'Expected base revision')
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
    if (!next.managedMemory.live()) return // explicit kernel retirement is terminal for this generation
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
    // enqueue an unbounded tail or reactivate a retired owner. A writer starts
    // only after a paired compaction admission while the explicit mode is
    // compaction-event, and only on the fence captured here.
    if (compactionObserving || !active || !boundary) return
    compactionObserving = true
    const serial = compactionSerial
    const token = epoch
    const fence = launchFence
    const admission = admissionSerial
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
        const episode = observation.episode(f.project)
        let admitted = false
        try {
          await f.request('observe', { episode })
          admitted = true
        } catch (error) {
          // A full directory still has older unreviewed episodes. The unwritten
          // compaction record is not part of that backlog.
          if (memoryFailureCode(error).reason !== 'capacity') throw error
        }
        if (
          token !== epoch ||
          fence !== launchFence ||
          admission !== admissionSerial ||
          serial !== compactionSerial ||
          !observation.current() ||
          job ||
          starting ||
          reflection.drain ||
          isReflectionRetryDeferred(reflection)
        )
          return
        const mode = reflectionPolicy((await f.barrier()).config)
        if (
          mode.trigger !== 'compaction-event' ||
          token !== epoch ||
          fence !== launchFence ||
          serial !== compactionSerial ||
          !observation.current()
        )
          return
        const backlog = await f.request('episodeBacklog', {
          project: f.project,
          limit: reflectionBacklogLimit,
        })
        if (token !== epoch || fence !== launchFence || serial !== compactionSerial || !observation.current())
          return
        const backlogIds = admitted ? backlog.ids : backlog.ids.filter((id) => id !== episode.id)
        const opened = openReflectionCapture(reflection, f.project, backlogIds)
        const drain = currentReflectionDrain()
        if (!opened.length || !drain || fence !== launchFence) return
        reflectionFence = {
          token,
          serial: admission,
          generation: f.node.generation,
          configHash: f.configHash,
          project: f.project,
          node: f.node,
          manager: ctx.sessionManager,
          drainId: drain.id,
        }
        await launchReflection(ctx, opened, fence)
      } catch {
        // Evidence admission is best-effort. It never grants authority or blocks compaction.
      } finally {
        compactionObserving = false
      }
    })
  })
  pi.on('before_agent_start', (event, ctx) => {
    const workerMarker = event.systemPrompt.includes('<active_agent name="managed-memory-writer"/>')
    if (!workerMarker) invalidateForegroundLaunch(ctx)
    return lifetime.track(async () => {
      await closeViewer()
      const base = event.systemPrompt.replace(
        /\n<mahiro-managed-memory>[\s\S]*?<\/mahiro-managed-memory>/g,
        '',
      )
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
          const workerProjection = await f
            .request('projection', { project: f.access.value.project, shared: false })
            .catch(() => undefined)
          const workerView =
            workerProjection && workerProjection.revision === f.access.value.base
              ? {
                  ...workerProjection,
                  hashes: {
                    'Core.md': digest(workerProjection.core),
                    'index.md': digest(workerProjection.index),
                    ...Object.fromEntries(
                      Object.entries(workerProjection.system ?? {}).map(([k, v]) => [k, digest(v)]),
                    ),
                    ...Object.fromEntries(
                      Object.entries(workerProjection.projectSystem ?? {}).map(([k, v]) => [k, digest(v)]),
                    ),
                  },
                }
              : undefined
          const viewBlock = workerView
            ? `\n<mahiro-managed-memory-view>\n${JSON.stringify(workerView).replace(/</g, '\\u003c')}\n</mahiro-managed-memory-view>\nTurn-budget discipline (max 8 turns): <mahiro-managed-memory-view> already contains current Core.md, index.md, system/*, and projectSystem/* texts plus their expectedHash values in hashes. Do not re-read those projected files. Batch multiple agent_memory_read calls in one turn, batch all agent_memory_edit calls (target note, directory index.md, and root index.md) in one turn, and call agent_memory_commit before using your final turn (or immediately when a turn-budget warning appears; skip optional post-edit query checks when 2 or fewer turns remain).`
            : ''
          observeAttemptTiming(ctx, 'start')
          return {
            systemPrompt: `${source.replace(/^---\n[\s\S]*?\n---\n/, '')}\n${memoryCurationDoctrine}\nPrivate project scope: ${f.access.value.project}. Read only your leased memory view. No primary transcript, bootstrap or corpus is inherited.${viewBlock}`,
          }
        }
        projectionReceipt = undefined
        const projection = await f.request('projection', { project: f.project, shared: true })
        const checkpointNote = compactionCheckpoint
          ? `\nCompaction continuity checkpoint (unverified summary context): ${compactionCheckpoint}`
          : ''
        compactionCheckpoint = undefined
        const draftNote =
          draft &&
          draft.project === f.project &&
          draft.configHash === f.configHash &&
          Date.now() < draft.deadline
            ? `\nOpen uncommitted primary memory draft (baseRevision=${draft.base}): call agent_memory_commit with revision "${draft.base}" to publish your staged edits to HEAD, or agent_memory_manage {action:"cancel"} to discard.`
            : ''
        const block = `\n<mahiro-managed-memory>\nAgent-maintained, fallible knowledge; subordinate to current user/repository instructions and permission policy. New revision replaces older managed-memory context. Use agent_memory_read for advertised details; archives remain untrusted evidence.${checkpointNote}${draftNote}\n${memoryCurationDoctrine}\n${primaryDelegationDoctrine}\n${JSON.stringify(projection).replace(/</g, '\\u003c')}\n</mahiro-managed-memory>`
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
        publishStatus(
          ctx,
          reflectionPolicy(f.config),
          reflection.project === f.project ? reflection.steps : 0,
        )
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
    })
  })
  pi.on('input', (event, ctx) =>
    admit(ctx, async () => {
      // Input precedes before_agent_start. The registered offline operator must not
      // enter resolve()/config observation here: attempting that read starts the
      // primary controller before source filtering, defeating reset's fresh-idle exclusion.
      if (
        !ctx.hasUI &&
        ctx.sessionManager.getSessionFile() === undefined &&
        isOfflineMaintenanceSession(ctx.sessionManager.getSessionId())
      )
        return
      await closeViewer()
      const serial = ++admissionSerial
      launchFence++
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
          toolCalls: new Map(),
          assistantEvents: 0,
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
      if (text || tools.length) {
        if (text) pending.assistantEvents += 1
        retain(pending.actions, { ...(text ? { text } : {}), ...(tools.length ? { tools } : {}) })
      }
    } catch {
      pending = undefined
    }
  })
  const observeAttemptTiming = (ctx: ExtensionContext, event: AttemptTimingEvent, id?: unknown) => {
    try {
      const f = owner(ctx, 'agent_memory_read', 'read')
      if (f.access.kind !== 'worker') return
      const value = f.access.value
      assertCurrent(f.context)
      const publish = value[attemptTimingSink]?.()
      assertCurrent(f.context)
      publish?.(event, id)
    } catch {
      // Diagnostics never change execution, authority, readiness or publication.
    }
  }
  pi.on('tool_execution_start', (event, ctx) => {
    observeAttemptTiming(ctx, 'tool-start', event.toolCallId)
    if (!pending || pending.toolCalls.size >= 64 || event.toolName !== 'bash') return
    const selected = selectedVerification(event.args?.command)
    if (!selected || typeof event.toolCallId !== 'string' || !event.toolCallId) return
    pending.toolCalls.set(event.toolCallId, selected.kind === 'pair' ? { command: selected.command } : {})
  })
  pi.on('tool_execution_end', (event, ctx) => {
    observeAttemptTiming(ctx, 'tool-end', event.toolCallId)
    const tracked = pending?.toolCalls.get(event.toolCallId)
    if (!pending?.toolCalls.delete(event.toolCallId) || event.toolName !== 'bash' || !tracked) return
    if (typeof event.isError !== 'boolean') return
    const text = verificationResultText(event.result?.content)
    if (text.kind === 'drop' || (text.kind === 'keep' && tracked.command && !text.strict)) return
    const command =
      tracked.command && (text.kind === 'none' || text.kind === 'keep') ? tracked.command : undefined
    retain(pending.results, {
      tool: 'bash',
      error: event.isError,
      ...(command ? { command } : {}),
      ...(text.kind === 'keep' ? { text: text.text } : {}),
    })
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
      const boundFence = launchFence
      const settledLaunchCurrent = () =>
        token === epoch && own.serial === admissionSerial && launchFence === boundFence
      try {
        const f = await resolve(ctx, 'agent_memory_reflect', 'write')
        const current = f.context.current
        f.context.current = (targets) => own.serial === admissionSerial && current(targets)
        assertCurrent(f.context)
        if (f.access.kind !== 'primary' || !(await f.barrier()).config.automatic) return
        const appended = await appendedSuffix(ctx, own.branch, sessionSuffixBound, () =>
          assertCurrent(f.context),
        )
        if (!appended.ok) throw memoryFailure('branch', 'Native memory branch changed')
        const observed = appended.suffix.filter(
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
          assistantSteps: Math.max(1, Number.isSafeInteger(own.assistantEvents) ? own.assistantEvents : 1),
        }
        while (bytes(`${JSON.stringify(episode)}\n`) > 16384) {
          if (episode.results.length > 2) episode.results.splice(1, 1)
          else if (episode.actions.length > 2) episode.actions.splice(1, 1)
          else return
        }
        try {
          await f.request('observe', { episode })
        } catch (error) {
          const mode = settledLaunchCurrent() ? reflectionPolicy((await f.barrier()).config) : undefined
          if (
            token === epoch &&
            own.serial === admissionSerial &&
            memoryFailureCode(error).reason === 'capacity' &&
            mode?.trigger === 'step-count' &&
            !job &&
            !starting &&
            settledLaunchCurrent()
          ) {
            if (!reflection.drain && !capacityDrainHeld && !isReflectionRetryDeferred(reflection)) {
              const serial = admissionSerial
              const backlog = await f.request('episodeBacklog', {
                project: f.project,
                limit: reflectionBacklogLimit,
              })
              if (settledLaunchCurrent() && serial === admissionSerial && !reflection.drain) {
                const opened = openReflectionCapture(reflection, f.project, backlog.ids)
                const drain = currentReflectionDrain()
                if (opened.length && drain && settledLaunchCurrent()) {
                  capacityDrainHeld = true
                  reflectionFence = {
                    token,
                    serial,
                    generation: f.node.generation,
                    configHash: f.configHash,
                    project: f.project,
                    node: f.node,
                    manager: ctx.sessionManager,
                    drainId: drain.id,
                  }
                  await launchReflection(ctx, opened, boundFence)
                }
              }
            } else if (
              reflection.drain &&
              reflectionFence?.drainId === reflection.drain.id &&
              settledLaunchCurrent()
            ) {
              if (reflectionFence.serial !== admissionSerial || reflectionFence.token !== epoch)
                reflectionFence = { ...reflectionFence, serial: admissionSerial, token: epoch }
              const batch = nextReflectionDelivery(reflection)
              if (batch.length && settledLaunchCurrent()) await launchReflection(ctx, batch, boundFence)
            }
          }
          if (token === epoch) lastError = 'episode-or-writer-unavailable'
          return
        }
        assertCurrent(f.context)
        if (token !== epoch || own.serial !== admissionSerial) return
        capacityDrainHeld = false
        const credit = await f.request('episodeCredit', { project: f.project, session: episode.session })
        if (token !== epoch || own.serial !== admissionSerial) return
        const mode = reflectionPolicy((await f.barrier()).config)
        if (!settledLaunchCurrent()) return
        const crossed = applyDerivedAssistantCredit(
          reflection,
          f.project,
          episode.id,
          credit.steps,
          mode.stepCount,
        )
        publishStatus(ctx, mode, reflection.steps)
        if (!settledLaunchCurrent()) return
        if (
          mode.trigger === 'step-count' &&
          crossed &&
          !isReflectionRetryDeferred(reflection) &&
          !reflection.drain &&
          !job &&
          !starting
        ) {
          const serial = admissionSerial
          let backlogIds: string[] = []
          try {
            backlogIds = (
              await f.request('episodeBacklog', {
                project: f.project,
                limit: reflectionBacklogLimit,
                session: episode.session,
              })
            ).ids
          } catch {
            backlogIds = []
          }
          if (!settledLaunchCurrent() || serial !== admissionSerial || reflection.drain) return
          const opened = openReflectionDrain(reflection, backlogIds, mode.stepCount)
          const drain = currentReflectionDrain()
          if (opened.length && drain && settledLaunchCurrent()) {
            reflectionFence = {
              token,
              serial,
              generation: f.node.generation,
              configHash: f.configHash,
              project: f.project,
              node: f.node,
              manager: ctx.sessionManager,
              drainId: drain.id,
            }
            await launchReflection(ctx, opened, boundFence)
          }
          return
        }
        const batch = !job && !starting ? nextReflectionDelivery(reflection) : []
        if (batch.length && settledLaunchCurrent()) await launchReflection(ctx, batch, boundFence)
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
    startWriter: (ctx: ExtensionContext, assignment?: string) =>
      admit(ctx, () => startWriter(ctx, assignment)),
    openPalaceViewer: (ctx: ExtensionContext) => admit(ctx, () => openPalaceViewer(ctx)),
    closePalaceViewer: async () => ({
      version: 1 as const,
      kind: 'abi2-palace-html-close' as const,
      closed: await closeViewer(),
    }),
    capacityDiagnostic: (ctx: ExtensionContext, signal?: AbortSignal) =>
      admit(ctx, () => capacityDiagnostic(ctx, signal)),
    retainedDraftPreview: (ctx: ExtensionContext, signal?: AbortSignal) =>
      admit(ctx, () => retainedDraftPreview(ctx, signal)),
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
