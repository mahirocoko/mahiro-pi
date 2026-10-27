import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import {
  decodeMemoryFailure,
  memoryFailure,
  memoryFailureCode,
  publicMemoryError,
} from '../lib/agent-memory/reasons.ts'
import { MemoryEngineController } from '../lib/agent-memory/engine/controller.ts'
import { MemoryPublisher } from '../lib/agent-memory/engine/publisher.ts'
import { validateReply } from '../lib/agent-memory/engine/replies.ts'
import { applySurgicalEdit } from '../lib/agent-memory/engine/schema.ts'
import type { Plan } from '../lib/agent-memory/engine/protocol.ts'

const secret = '/private/not-a-real-root # Private heading stderr: never echo'
const reasons = ['capacity', 'deadline', 'branch', 'CAS', 'retention', 'unknown'] as const

test('safe memory reasons are identity-bound across native and query-loaded wrappers, not tags or messages', async () => {
  const other = await import(`../lib/agent-memory/reasons.ts?test=${randomUUID()}`)
  const native = createRequire(import.meta.url)('../lib/agent-memory/reasons.mjs')
  for (const reason of reasons) {
    const error = memoryFailure(reason, secret)
    assert.equal(other.memoryFailureCode(error).reason, reason)
    assert.equal(native.memoryFailureCode(error).reason, reason)
    assert.equal(memoryFailureCode(native.memoryFailure(reason, secret)).reason, reason)
    assert.match(publicMemoryError(error).message, new RegExp(`reason: ${reason}`))
    assert.ok(!publicMemoryError(error).message.includes(secret))
    for (const spoof of [
      new Error(error.message),
      Object.assign(new Error(secret), { reason, code: reason, name: 'MemoryFailure', cause: error }),
      { ...error },
      JSON.parse(JSON.stringify(error)),
      {
        get message() {
          throw Error('untrusted getter')
        },
        reason,
      },
      null,
      'capacity deadline CAS retention',
    ])
      assert.equal(memoryFailureCode(spoof).reason, 'unknown')
  }
  for (const readInvalidation of ['forgetting', 'revision'] as const) {
    const error = memoryFailure(readInvalidation === 'revision' ? 'CAS' : 'unknown', secret, readInvalidation)
    assert.match(
      publicMemoryError(error, true).message,
      readInvalidation === 'forgetting' ? /current forgetting/ : /current revision changed/,
    )
    assert.ok(!publicMemoryError(new Error(error.message), true).message.includes('proposal preserved'))
  }
})

test('safe memory child diagnostics round-trip closed codes; malformed and text envelopes fail closed', () => {
  for (const reason of reasons) {
    const error = memoryFailure(reason, secret)
    const decoded = decodeMemoryFailure(JSON.parse(JSON.stringify(memoryFailureCode(error))))
    assert.equal(memoryFailureCode(decoded).reason, reason)
    assert.ok(!decoded.message.includes(secret))
  }
  for (const readInvalidation of ['forgetting', 'revision'] as const) {
    const reason = readInvalidation === 'revision' ? 'CAS' : 'unknown'
    const decoded = decodeMemoryFailure({ reason, readInvalidation })
    assert.equal(memoryFailureCode(decoded).readInvalidation, readInvalidation)
  }
  for (const value of [
    secret,
    {},
    [],
    null,
    { reason: 'full' },
    { reason: 'capacity', message: secret },
    { reason: 'capacity', readInvalidation: 'forgetting' },
    { reason: 'unknown', readInvalidation: 'revision' },
    {
      get reason() {
        throw Error('getter must not run')
      },
    },
  ])
    assert.throws(() => decodeMemoryFailure(value), /Invalid engine error/)
})

test('safe memory controller correlates error-only frames and rechecks current authority before accepting classification', () => {
  for (const variant of [
    'valid',
    'epoch',
    'id',
    'extra',
    'mixed',
    'malformed',
    'denied',
    'cancelled',
    'malformed-denied',
    'malformed-cancelled',
    'legacy-text',
  ] as const) {
    // Exercise the actual receiver without spawning an alternate transport or reading storage.
    const engine = new MemoryEngineController('/unused-diagnostic-fixture') as any
    const frame = {
      v: 2,
      epoch: engine.epoch,
      id: 'request',
      error: variant === 'legacy-text' ? secret : { reason: 'capacity' },
      ...(variant === 'extra' ? { path: secret } : {}),
      ...(variant === 'mixed' ? { result: { text: secret } } : {}),
    }
    if (variant === 'epoch') frame.epoch = 'wrong'
    if (variant === 'id') frame.id = 'wrong'
    if (variant.startsWith('malformed')) frame.error = { reason: 'arbitrary' }
    let rejected: unknown
    let resolved = false
    engine.active = {
      id: 'request',
      method: 'config',
      frame: Buffer.from('{}'),
      context: { current: () => variant !== 'denied' && variant !== 'malformed-denied' },
      reject: (error: unknown) => {
        rejected = error
      },
      resolve: () => {
        resolved = true
      },
      abort() {},
      cancelled: variant === 'cancelled' || variant === 'malformed-cancelled',
    }
    if (variant === 'valid' || variant === 'denied' || variant === 'cancelled') {
      engine.receive(frame)
      assert.equal(memoryFailureCode(rejected).reason, variant === 'valid' ? 'capacity' : 'unknown')
      assert.ok(rejected instanceof Error)
    } else {
      assert.throws(() => engine.receive(frame), /Invalid|Uncorrelated/)
      assert.equal(rejected, undefined, 'malformed code cannot complete an active request')
    }
    assert.equal(resolved, false)
  }
})

test('edit reply hashes represent resulting content, not the append or patch operand', () => {
  const digest = (text: string) => createHash('sha256').update(text).digest('hex')
  for (const [current, text, options] of [
    [undefined, '- synthetic note', { mode: 'append' as const }],
    ['# Notes\n- previous\n', '- synthetic note', { mode: 'append' as const }],
    ['# Notes\n- previous\n', '- synthetic note', { mode: 'append' as const, section: 'Facts' }],
    ['# Notes\n- previous\n', 'new', { mode: 'patch' as const, oldText: 'previous' }],
    ['# Notes\n- previous\n', null, { mode: 'patch' as const, oldText: 'previous', newText: 'new' }],
  ] as const) {
    const result = applySurgicalEdit(current, text, options)
    assert.equal(typeof result, 'string')
    validateReply('edit', { text, ...options }, { hash: digest(result!) })
    for (const hash of [null, '', 'not-a-hash', 'A'.repeat(64), 1])
      assert.throws(() => validateReply('edit', { text, ...options }, { hash }))
    assert.throws(() => validateReply('edit', { text, ...options }, { hash: digest(result!), extra: true }))
  }
  for (const mode of [undefined, 'replace']) {
    validateReply('edit', { text: 'replacement', mode }, { hash: digest('replacement') })
    validateReply('edit', { text: null, mode }, { hash: null })
    assert.throws(() => validateReply('edit', { text: 'replacement', mode }, { hash: digest('different') }))
    assert.throws(() => validateReply('edit', { text: null, mode }, { hash: digest('different') }))
  }
})

test('controller admission denial is request-local; injected channel failure remains terminal', async () => {
  // No child, filesystem, private root, or replacement authorization transport.
  for (const variant of ['admission', 'checkpoint', 'channel'] as const) {
    const engine = new MemoryEngineController('/unused-diagnostic-fixture') as any
    const sent: any[] = []
    engine.start = () => {}
    engine.send = (frame: unknown) => sent.push(frame)
    const denied = { current: () => false }
    const allowed = { current: () => true }
    if (variant === 'admission') {
      await assert.rejects(engine.request('config', {}, denied), /Current parent authority/)
      assert.equal(sent.length, 0)
      assert.equal(engine.failure, undefined)
    } else if (variant === 'checkpoint') {
      const request = engine.request('config', {}, allowed)
      const frame = sent.at(-1)
      engine.active.context = denied
      engine.receive({
        v: 2,
        epoch: engine.epoch,
        id: frame.id,
        check: 1,
        targets: { physical: [], logical: [], kind: 'data' },
      })
      assert.equal(sent.at(-1).allow, false)
      engine.receive({ v: 2, epoch: engine.epoch, id: frame.id, error: { reason: 'unknown' } })
      await assert.rejects(request, /Current parent authority/)
      assert.equal(engine.failure, undefined)
    } else {
      const request = engine.request('config', {}, allowed)
      const injected = Error('synthetic terminal channel failure')
      engine.fail(injected)
      await assert.rejects(request, (error) => error === injected)
      await assert.rejects(engine.request('config', {}, allowed), (error) => error === injected)
      assert.equal(sent.length, 1, 'terminal channel failures are not replayed or respawned')
      continue
    }
    const request = engine.request('ready', { view: randomUUID() }, allowed)
    engine.receive({ v: 2, epoch: engine.epoch, id: sent.at(-1).id, result: { ready: true } })
    assert.deepEqual(await request, { ready: true })
    assert.equal(engine.queueSize, 0)
    await engine.close()
  }
})

test('safe memory publisher success-shaped failure and reconciliation never return arbitrary receipt detail', async () => {
  for (const detail of [undefined, secret]) {
    const root = `/unused-publisher-${randomUUID()}`
    const receipt = {
      stage: 'not_committed_dirty',
      revision: 'a'.repeat(40),
      indexDirty: true,
      worktreeDirty: false,
      observedCommit: 'b'.repeat(40),
      ...(detail ? { detail } : {}),
    }
    const engine = {
      root,
      ownsPlan: () => true,
      async request(method: string) {
        if (method === 'fence') throw new Error(secret)
        if (method === 'reconcile') return receipt
        if (method === 'journal') return { recorded: true }
        if (method === 'recover') return { receipt, owner: null, sequence: 1, lockPresent: true }
        throw Error('Unexpected storage operation')
      },
    } as unknown as MemoryEngineController
    const publisher = new MemoryPublisher(engine)
    const context = { current: () => true }
    const result = await publisher.publish({ id: randomUUID(), changes: [] } as unknown as Plan, context)
    assert.equal(result.stage, 'not_committed_dirty')
    assert.equal(result.revision, receipt.revision)
    assert.equal(result.indexDirty, true)
    assert.equal(result.worktreeDirty, false)
    assert.equal(result.observedCommit, receipt.observedCommit)
    assert.equal(result.mutated, false)
    assert.equal(result.commitStarted, false)
    assert.ok(!JSON.stringify(result).includes(secret))
    const reconciled = await publisher.reconcileExisting(randomUUID(), 'b'.repeat(64), context)
    assert.equal(reconciled.stage, 'not_committed_dirty')
    assert.equal(reconciled.revision, receipt.revision)
    assert.equal(reconciled.indexDirty, true)
    assert.equal(reconciled.worktreeDirty, false)
    assert.equal(reconciled.observedCommit, receipt.observedCommit)
    assert.equal(reconciled.lockRetained, true)
    assert.ok(!JSON.stringify(reconciled).includes(secret))
  }
})
