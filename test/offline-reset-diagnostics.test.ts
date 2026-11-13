import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { offlineReset, type ResetRequest } from '../lib/agent-memory/engine/offline-reset.ts'
import type { MemoryEngineController } from '../lib/agent-memory/engine/controller.ts'
import {
  offlineResetFailure,
  offlineResetFailureCode,
  type OfflineResetFailureCode,
} from '../lib/agent-memory/reasons.ts'
import {
  registerOfflineMaintenanceSession,
  reportOfflineResetFailure,
} from '../lib/agent-memory/offline-bootstrap.ts'

const codes: OfflineResetFailureCode[] = [
  'holder-present',
  'holder-inspection',
  'unsafe-entry',
  'scan',
  'authority',
  'reset-owner',
  'reset-binding',
  'offline-context',
  'maintenance-authority',
  'idle',
  'branch',
  'standard-root',
  'reset-preflight',
  'reset-controller-busy',
  'reset-request-shape',
  'fingerprint',
  'recovery-plan',
  'recovery-layout',
  'recovery-journal',
  'recovery-lock',
  'recovery-artifacts',
  'recovery-commit',
  'recovery-proposal',
]
test('reset preflight distinguishes controller activity from exact request shape, including undefined keys', async () => {
  const context = {
    current: () => {
      throw Error('No authority or filesystem operation expected')
    },
  }
  for (const [pid, queueSize] of [
    [123, 0],
    [undefined, 1],
  ]) {
    const engine = { pid, queueSize } as unknown as MemoryEngineController
    await assert.rejects(offlineReset(engine, context, { action: 'offline-reset-inspect' }), (error) => {
      assert.equal(offlineResetFailureCode(error), 'reset-controller-busy')
      return true
    })
  }
  const engine = {
    pid: undefined,
    queueSize: 0,
    root: '/synthetic-not-opened/memory',
  } as unknown as MemoryEngineController
  for (const request of [
    { action: 'offline-reset-inspect', target: undefined },
    { action: 'offline-reset-inspect', revision: undefined, offline: undefined, destruction: undefined },
    { action: 'offline-reset' },
  ] as ResetRequest[]) {
    await assert.rejects(offlineReset(engine, context, request), (error) => {
      assert.equal(offlineResetFailureCode(error), 'reset-request-shape')
      return true
    })
  }
})

test('offline reset failure categories are identity-branded across loaders, not messages or properties', async () => {
  const other = await import(`../lib/agent-memory/reasons.ts?offline=${randomUUID()}`)
  for (const code of codes) {
    const error = new Error('/synthetic/private payload stderr must not escape')
    assert.equal(offlineResetFailure(error, code), error)
    assert.equal(other.offlineResetFailureCode(error), code)
    offlineResetFailure(error, 'scan')
    assert.equal(offlineResetFailureCode(error), code, 'outer boundary must preserve the narrower source')
    assert.equal(offlineResetFailureCode(new Error(error.message)), undefined)
    assert.equal(offlineResetFailureCode({ code, message: error.message, cause: error }), undefined)
    assert.equal(
      offlineResetFailureCode({
        get code() {
          throw Error('do not inspect')
        },
      }),
      undefined,
    )
  }
})

test('offline diagnostic observation is session/tool-bound, bounded, optional, and removed at teardown', () => {
  const session = randomUUID()
  const seen: unknown[] = []
  const unregister = registerOfflineMaintenanceSession(session, (id, code) => seen.push([id, code]))
  try {
    const error = offlineResetFailure(new Error('SYNTHETIC_PRIVATE_ERROR'), 'holder-present')
    reportOfflineResetFailure(randomUUID(), 'operation', error)
    assert.deepEqual(seen, [])
    reportOfflineResetFailure(session, 'operation', error)
    assert.deepEqual(seen, [['operation', 'holder-present']])
    reportOfflineResetFailure(session, 'other', new Error('SYNTHETIC_PRIVATE_ERROR'))
    assert.deepEqual(seen, [
      ['operation', 'holder-present'],
      ['other', undefined],
    ])
    assert.equal(JSON.stringify(seen).includes('SYNTHETIC_PRIVATE_ERROR'), false)
  } finally {
    unregister()
  }
  reportOfflineResetFailure(session, 'operation', offlineResetFailure(new Error('private'), 'scan'))
  assert.equal(seen.length, 2)
  const unobserve = registerOfflineMaintenanceSession(session, () => {
    throw Error('observer failure')
  })
  try {
    assert.doesNotThrow(() => reportOfflineResetFailure(session, 'operation', new Error('original failure')))
  } finally {
    unobserve()
  }
})
