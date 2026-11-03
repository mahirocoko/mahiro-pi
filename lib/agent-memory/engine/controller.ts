import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { objectShape } from '../../continuity/records.ts'
import { recordMemoryDiagnostic } from '../../guards/memory-fixture.mjs'
import { decodeMemoryFailure, memoryFailure } from '../reasons.ts'
import { executorDrained } from './executor.ts'
import { contained, engineEnvironment } from './io.ts'
import { parseLockOwner, validatePlan, validateReceipt } from './operation.ts'
import {
  type Checkpoint,
  encode,
  Frames,
  type Input,
  type Method,
  type Output,
  type Plan,
  protocolVersion,
  transportLimits,
  validateInput,
} from './protocol.ts'
import { validateReply } from './replies.ts'
import type { MemoryAdmission } from './admission.ts'

export interface OperationContext {
  /** Actual root-bound generation participant; never a serialized acknowledgement. */
  admission?: MemoryAdmission
  // Must close over actual runtime/Root/context/lease, never a deserialized verdict.
  // Strict synchronous true only. Phase B binds real canonical contexts here.
  current: (targets: Checkpoint) => boolean
  signal?: AbortSignal
  /** Runtime-owned async branch/data fence, never part of synchronous identity. */
  barrier?: () => Promise<void>
  /** Private fixture lifetime ownership, never a permission or data capability. */
  hold?: (owner: object) => () => void
}
interface Pending {
  id: string
  method: Method
  frame: Buffer
  context: OperationContext
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  abort: () => void
  cancelled: boolean
  preparation?: {
    plan: Plan
    drained: boolean
    published: boolean
    retired: boolean
    joined: Promise<void>
    finish(): void
  }
  timer?: NodeJS.Timeout
}
const empty: Checkpoint = { physical: [], logical: [], kind: 'data' }
export function engineRequestDeadline(method: Method, input?: Input<Method>) {
  // Ordinary reads finish or drain under caller cancellation, not a whole-request clock.
  // Publication helpers keep their deadline even when an individual step only reads.
  if (
    method === 'offlineCertify' ||
    method === 'projection' ||
    method === 'palaceStructure' ||
    method === 'knowledgeHistory' ||
    method === 'config' ||
    method === 'capacityDiagnostic' ||
    method === 'status' ||
    method === 'episodes' ||
    method === 'selectEpisodes' ||
    method === 'episodeBacklog' ||
    method === 'episodeCredit' ||
    method === 'conflicts' ||
    method === 'read' ||
    method === 'headRead' ||
    method === 'stats' ||
    (method === 'manage' &&
      input &&
      'action' in input &&
      ['doctor', 'palace', 'migration-export'].includes(input.action))
  )
    return undefined
  return 30000
}
export function assertCurrent(context: OperationContext, targets: Checkpoint = empty) {
  context.signal?.throwIfAborted()
  context.admission?.assertCurrent(context)
  if (context.current(targets) !== true) throw Error('Current parent authority required (strict boolean)')
}

// Construction/source loading has no child or filesystem effects. No auto-respawn/replay.
export class MemoryEngineController {
  private child?: ChildProcessWithoutNullStreams
  private epoch = randomUUID()
  private pending: Pending[] = []
  private active?: Pending
  private queuedBytes = 0
  private retired = false
  private failure?: Error
  private prepared = new WeakSet<Plan>()
  // Controller-local actual references, not reconstructed from status or durable records.
  // A rejected caller promise is not drain. Only a terminal child reply seals preparation.
  private preparations = new Map<string, NonNullable<Pending['preparation']>>()
  ownsPlan(plan: Plan) {
    const own = this.preparations.get(plan.id)
    return this.prepared.has(plan) && own?.drained === true && !own.retired
  }
  claimPlan(plan: Plan) {
    if (!this.ownsPlan(plan)) throw Error('Exact unpublished parent plan required')
    const own = this.preparations.get(plan.id)!
    if (own.published) throw Error('Operation executor already reserved or capacity blocked')
    own.published = true // irreversible, before any publisher await
  }
  async retireUnpublished(view: string, context: OperationContext) {
    assertCurrent(context)
    const candidates = [...this.preparations.values()].filter(
      (entry) => entry.plan.view === view && !entry.retired,
    )
    if (candidates.length !== 1) return // never guess between distinct prepare attempts
    const own = candidates[0]!
    if (own.published) return
    own.retired = true // no old continuation may publish while fresh-authority recovery awaits
    await own.joined
    if (!own.drained || own.published) return
    return await this.request('recover', { plan: own.plan.id, digest: own.plan.digest }, context)
  }
  private exited?: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  readonly root: string
  private environment: NodeJS.ProcessEnv
  constructor(root: string, environment: NodeJS.ProcessEnv = engineEnvironment()) {
    this.root = root
    this.environment = environment
  }
  get pid() {
    return this.child?.pid
  }
  get queueSize() {
    return this.pending.length + (this.active ? 1 : 0)
  }
  private start() {
    if (this.child) return
    if (this.retired || this.failure) throw this.failure ?? Error('Engine retired')
    this.child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        fileURLToPath(new URL('./entry.ts', import.meta.url)),
        this.root,
        this.epoch,
      ],
      { env: engineEnvironment(this.environment), shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const child = this.child
    this.exited = new Promise((resolve) =>
      child.once('close', (code, signal) => {
        resolve({ code, signal })
        this.fail(Error(`Engine closed (${code ?? signal})`))
      }),
    )
    const frames = new Frames(transportLimits.reply, (message) => this.receive(message))
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        frames.push(chunk)
      } catch (error) {
        this.fail(error instanceof Error ? error : Error('Invalid engine reply'))
        child.stdin.end()
      }
    })
    let errors = 0
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.length
      if (errors > 65536) {
        this.fail(Error('Engine diagnostic overflow'))
        child.stdin.end()
      }
    })
    child.on('error', (error) => this.fail(error))
    child.stdin.on('error', (error) => this.fail(error))
  }
  private finish(p: Pending, error?: Error, result?: unknown) {
    clearTimeout(p.timer)
    p.preparation?.finish() // failed/closed channels release waiters, but confer no drain proof
    p.context.signal?.removeEventListener('abort', p.abort)
    this.queuedBytes -= p.frame.length
    recordMemoryDiagnostic(this.root, 'response', { id: p.id, method: p.method }, error)
    if (error) p.reject(error)
    else p.resolve(result)
  }
  private fail(error: Error) {
    this.failure ??= error
    if (this.active) {
      this.finish(this.active, error)
      this.active = undefined
    }
    for (const pending of this.pending.splice(0)) this.finish(pending, error)
  }
  private send(value: unknown) {
    if (!this.child || this.child.stdin.destroyed) throw Error('Engine channel closed')
    // One active request and at most one bounded checkpoint reply in flight.
    this.child.stdin.write(encode(value, transportLimits.request))
  }
  private receive(message: unknown) {
    if (this.retired) return // only drain the fenced channel; never dispatch late replies/checkpoints
    if (
      !objectShape(message, ['v', 'epoch', 'id', 'result', 'error', 'check', 'targets']) ||
      message.v !== protocolVersion ||
      message.epoch !== this.epoch ||
      typeof message.id !== 'string'
    )
      throw Error('Invalid engine response/channel')
    const p = this.active
    if (!p || p.id !== message.id) throw Error('Uncorrelated engine response')
    if ('check' in message) {
      if (
        Object.keys(message).length !== 5 ||
        !Number.isSafeInteger(message.check) ||
        !objectShape(message.targets, ['physical', 'logical', 'kind', 'preparing'])
      )
        throw Error('Invalid authorization checkpoint')
      const targets = message.targets as unknown as Checkpoint
      if (
        !['data', 'git', 'view'].includes(targets.kind) ||
        !Array.isArray(targets.physical) ||
        targets.physical.length > 32 ||
        !Array.isArray(targets.logical) ||
        targets.logical.length > 32 ||
        targets.physical.some((path) => typeof path !== 'string' || !contained(this.root, path)) ||
        targets.logical.some((path) => typeof path !== 'string' || path.length > 256)
      )
        throw Error('Invalid checkpoint targets')
      let allow = false
      const started = performance.now()
      try {
        if (!p.cancelled) {
          assertCurrent(p.context, targets)
          if (targets.preparing !== undefined) {
            if (!['prepare', 'manage'].includes(p.method) || p.preparation)
              throw Error('Unexpected preparation handoff')
            validatePlan(targets.preparing)
            const input = JSON.parse(p.frame.toString('utf8')).input
            if (p.method === 'prepare' && targets.preparing.view !== input.view)
              throw Error('Preparation view mismatch')
            if (this.preparations.has(targets.preparing.id) || this.preparations.size >= 64)
              throw Error('Preparation ownership capacity blocked')
            const plan = targets.preparing
            for (const change of plan.changes) Object.freeze(change)
            Object.freeze(plan.changes)
            Object.freeze(plan)
            let finish!: () => void
            const joined = new Promise<void>((resolve) => {
              finish = resolve
            })
            p.preparation = { plan, drained: false, published: false, retired: false, joined, finish }
            this.preparations.set(plan.id, p.preparation)
          }
          allow = true
        }
      } catch (error) {
        recordMemoryDiagnostic(
          this.root,
          'checkpoint-denied',
          { id: p.id, method: p.method, check: message.check },
          error,
        )
      }
      recordMemoryDiagnostic(this.root, 'checkpoint', {
        id: p.id,
        method: p.method,
        check: message.check,
        kind: targets.kind,
        physical: targets.physical.length,
        logical: targets.logical.length,
        duration: performance.now() - started,
        allow,
      })
      this.send({ v: 2, epoch: this.epoch, id: p.id, check: message.check, allow })
      return
    }
    if (Object.keys(message).length !== 4 || 'result' in message === 'error' in message)
      throw Error('Invalid engine result')
    // Validate even on cancellation/authority loss: malformed diagnostics are protocol failures,
    // not a valid result. Classification is diagnostic only; current authority still wins.
    const childError = 'error' in message ? decodeMemoryFailure(message.error) : undefined
    // Receipt of the terminal frame joins the child's operation, including a cancelled
    // write whose result was suppressed. Timeouts/fail()/retirement never set this bit.
    if (p.preparation) p.preparation.drained = true
    let error: Error | undefined
    try {
      assertCurrent(p.context)
      if (p.cancelled) throw Error('Engine request cancelled')
      if (childError) throw childError
    } catch (caught) {
      error = caught instanceof Error ? caught : Error('Engine operation unavailable')
    }
    if (!error) validateReply(p.method, JSON.parse(p.frame.toString('utf8')).input, message.result)
    if (
      !error &&
      (p.method === 'prepare' || p.method === 'manage') &&
      objectShape(message.result, ['plan', 'conflict']) &&
      message.result.plan
    ) {
      const plan = message.result.plan
      validatePlan(plan)
      if (!p.preparation || JSON.stringify(p.preparation.plan) !== JSON.stringify(plan))
        throw Error('Prepared plan differs from pre-write ownership')
      for (const change of plan.changes) Object.freeze(change)
      Object.freeze(plan.changes)
      Object.freeze(plan)
      this.prepared.add(plan)
    }
    if (!error && p.method === 'recover') {
      const input = JSON.parse(p.frame.toString('utf8')).input
      if (
        !objectShape(message.result, ['receipt', 'owner', 'sequence', 'lockPresent']) ||
        Object.keys(message.result).length !== 4 ||
        typeof message.result.lockPresent !== 'boolean' ||
        !Number.isSafeInteger(message.result.sequence) ||
        (message.result.sequence as number) < 1
      )
        throw Error('Invalid reconciliation evidence')
      validateReceipt(message.result.receipt)
      if (message.result.owner !== null) {
        const owner = parseLockOwner(message.result.owner)
        if (owner.operation !== input.plan || owner.digest !== input.digest)
          throw Error('Reconciled lock binding mismatch')
      }
    }
    this.active = undefined
    this.finish(p, error, message.result)
    this.pump()
  }
  private pump() {
    if (this.active || this.retired || this.failure) return
    const p = this.pending.shift()
    if (!p) return
    try {
      assertCurrent(p.context)
      this.start()
      this.active = p
      const message = JSON.parse(p.frame.toString('utf8'))
      if (p.method === 'reconcile' || p.method === 'recover') {
        const own = this.preparations.get(message.input.plan)
        message.unpublished =
          own?.drained === true && !own.published && own.plan.digest === message.input.digest
        if (message.unpublished) own!.retired = true
        message.drained = executorDrained(this.root, message.input.plan, message.input.digest)
      }
      recordMemoryDiagnostic(this.root, 'dispatch', { id: p.id, method: p.method })
      this.send(message)
      const deadline = engineRequestDeadline(p.method, message.input)
      if (deadline !== undefined)
        p.timer = setTimeout(() => {
          p.cancelled = true
          this.send({ v: 2, epoch: this.epoch, id: p.id, cancel: true })
          // No restart/replay. If a child cannot drain, caller teardown owns it.
          p.reject(memoryFailure('deadline', 'Engine request deadline; channel draining'))
        }, deadline)
    } catch (error) {
      this.active = undefined
      this.finish(p, error instanceof Error ? error : Error('Engine start failed'))
      this.pump()
    }
  }
  request<M extends Method>(method: M, input: Input<M>, context: OperationContext): Promise<Output<M>> {
    if (context.admission && context.admission.root !== this.root)
      return Promise.reject(Error('Memory admission root mismatch'))
    const readOnly =
      [
        'knowledgeHistory',
        'palaceStructure',
        'projection',
        'config',
        'capacityDiagnostic',
        'retainedDraftPreview',
        'status',
        'offlineCertify',
        'episodes',
        'selectEpisodes',
        'episodeBacklog',
        'episodeCredit',
        'conflicts',
        'read',
        'headRead',
        'stats',
        'chunk',
        'fence',
      ].includes(method) ||
      (method === 'manage' &&
        'action' in input &&
        ['doctor', 'palace', 'migration-export'].includes(input.action))
    if (context.admission && !readOnly)
      return context.admission.run(() => this.requestAdmitted(method, input, context), context)
    return this.requestAdmitted(method, input, context)
  }
  private requestAdmitted<M extends Method>(
    method: M,
    input: Input<M>,
    context: OperationContext,
  ): Promise<Output<M>> {
    try {
      assertCurrent(context)
      if (this.retired || this.failure) throw this.failure ?? Error('Engine retired')
      validateInput(method, input)
      const id = randomUUID()
      const frame = encode({ v: 2, epoch: this.epoch, id, method, input }, transportLimits.request)
      if (
        this.queueSize >= transportLimits.queued ||
        this.queuedBytes + frame.length > transportLimits.queuedBytes
      )
        throw memoryFailure('capacity', 'Engine overload')
      return new Promise((resolve, reject) => {
        const p: Pending = {
          id,
          method,
          frame,
          context,
          resolve: (value) => resolve(value as Output<M>),
          reject,
          cancelled: false,
          abort: () => {
            p.cancelled = true
            if (this.active === p) this.send({ v: 2, epoch: this.epoch, id, cancel: true })
            else {
              const index = this.pending.indexOf(p)
              if (index >= 0) {
                this.pending.splice(index, 1)
                this.finish(p, Error('Engine queued request cancelled'))
              }
            }
          },
        }
        this.queuedBytes += frame.length
        this.pending.push(p)
        context.signal?.addEventListener('abort', p.abort, { once: true })
        this.pump()
      })
    } catch (error) {
      return Promise.reject(error)
    }
  }
  retireAdmission() {
    if (this.retired) return
    this.retired = true
    if (this.active) {
      try {
        this.send({ v: 2, epoch: this.epoch, id: this.active.id, cancel: true })
      } catch {
        /* closed */
      }
    }
    this.fail(Error('Engine retired'))
  }
  async close() {
    this.retireAdmission()
    this.child?.stdin.end()
    return this.exited ? await this.exited : { code: 0, signal: null }
  }
}
