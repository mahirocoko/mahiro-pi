import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { objectShape } from '../../continuity/records.ts'
import { recordMemoryDiagnostic } from '../../guards/memory-fixture.mjs'
import { contained, engineEnvironment } from './io.ts'
import { executorDrained } from './executor.ts'
import { validatePlan, validateReceipt, parseLockOwner } from './operation.ts'
import { validateReply } from './replies.ts'
import {
  encode,
  Frames,
  protocolVersion,
  transportLimits,
  validateInput,
  type Checkpoint,
  type Input,
  type Method,
  type Output,
  type Plan,
} from './protocol.ts'

export interface OperationContext {
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
  timer?: NodeJS.Timeout
}
const empty: Checkpoint = { physical: [], logical: [], kind: 'data' }
export function assertCurrent(context: OperationContext, targets: Checkpoint = empty) {
  context.signal?.throwIfAborted()
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
  ownsPlan(plan: Plan) {
    return this.prepared.has(plan)
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
        !objectShape(message.targets, ['physical', 'logical', 'kind'])
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
    let error: Error | undefined
    try {
      assertCurrent(p.context)
      if (p.cancelled) throw Error('Engine request cancelled')
      if ('error' in message)
        throw Error(typeof message.error === 'string' ? message.error.slice(0, 256) : 'Invalid engine error')
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
        message.drained = executorDrained(this.root, message.input.plan, message.input.digest)
      }
      recordMemoryDiagnostic(this.root, 'dispatch', { id: p.id, method: p.method })
      this.send(message)
      p.timer = setTimeout(() => {
        p.cancelled = true
        this.send({ v: 2, epoch: this.epoch, id: p.id, cancel: true })
        // No restart/replay. If a child cannot drain, caller teardown owns it.
        p.reject(Error('Engine request deadline; channel draining'))
      }, 30000)
    } catch (error) {
      this.active = undefined
      this.finish(p, error instanceof Error ? error : Error('Engine start failed'))
      this.pump()
    }
  }
  request<M extends Method>(method: M, input: Input<M>, context: OperationContext): Promise<Output<M>> {
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
        throw Error('Engine overload')
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
