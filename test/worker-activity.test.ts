import assert from 'node:assert/strict'
import test from 'node:test'
import {
  startWorkerActivity,
  WORKER_CAP,
  WORKER_TOKENS,
  workerArgs,
  workerCounts,
  workerOwner,
  type WorkerOwner,
} from '../lib/worker-activity.ts'
import type { Run } from '../lib/status.ts'

const epoch = '12345678-1234-1234-1234-123456789abc'
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
function fixture(options: { mode?: string; env?: NodeJS.ProcessEnv; missing?: boolean } = {}) {
  let time = 0
  let records: unknown = [{ status: 'running', prompt: 'PRIVATE' }, { status: 'queued' }]
  let service = { listAgents: () => records }
  const ctx = { mode: options.mode ?? 'tui', sessionManager: {} }
  const owner: WorkerOwner = { seq: 0 }
  const calls: string[][] = []
  let polls = 0
  let stopped = false
  let callback = () => {}
  let foreground = true
  let pane = 'pane-a'
  let fail = false
  let hold: (() => void) | undefined
  let delay = false
  let loads = 0
  const run: Run = (_command, args) => {
    calls.push(args)
    let cancel = false
    return {
      promise: (async () => {
        if (delay)
          await new Promise<void>((resolve) => {
            hold = resolve
          })
        if (cancel || fail) throw new Error('transport rejected')
        return args[1] === 'process-info'
          ? JSON.stringify({
              result: {
                process_info: {
                  pane_id: pane,
                  foreground_processes: foreground ? [{ pid: process.pid }] : [{ pid: -1 }],
                },
              },
            })
          : '{}'
      })(),
      cancel() {
        cancel = true
        hold?.()
      },
    }
  }
  const producer = startWorkerActivity(ctx, {
    owner,
    run,
    env: options.env ?? {
      HERDR_ENV: '1',
      HERDR_PANE_ID: 'pane-a',
      HERDR_SOCKET_PATH: '/owned/socket',
    },
    now: () => time,
    every(fn, ms) {
      assert.equal(ms, 1000)
      callback = fn
      return () => {
        stopped = true
      }
    },
    async load() {
      loads++
      return options.missing
        ? {}
        : {
            getSubagentsServiceForSession: (manager) => {
              polls++
              return manager === ctx.sessionManager ? service : undefined
            },
          }
    },
  })
  return {
    producer,
    ctx,
    owner,
    calls,
    tick(ms = 1000) {
      time += ms
      callback()
    },
    records(value: unknown) {
      records = value
    },
    replace() {
      service = { listAgents: () => [{ status: 'queued' }] }
    },
    foreground(value: boolean) {
      foreground = value
    },
    pane(value: string) {
      pane = value
    },
    fail(value: boolean) {
      fail = value
    },
    delay(value: boolean) {
      delay = value
    },
    release() {
      delay = false
      hold?.()
    },
    get loads() {
      return loads
    },
    get polls() {
      return polls
    },
    get stopped() {
      return stopped
    },
    reports() {
      return calls.filter((args) => args[1] === 'report-metadata')
    },
  }
}

test('whole native snapshot validation and counts-only atomic wire', () => {
  assert.deepEqual(
    workerCounts([
      { status: 'running' },
      { status: 'queued' },
      ...['completed', 'aborted', 'stopped', 'error'].map((status) => ({
        status,
      })),
    ]),
    { running: 1, queued: 1 },
  )
  for (const bad of [
    undefined,
    {},
    null,
    [null],
    [{}],
    [{ status: 'done' }],
    new Array(WORKER_CAP + 1).fill({ status: 'running' }),
    new Array(2),
  ])
    assert.equal(workerCounts(bad), undefined)
  assert.deepEqual(workerCounts([]), { running: 0, queued: 0 })
  const args = workerArgs('pane-a', { running: 1, queued: 2 }, epoch, 5)
  assert.equal(args[args.indexOf('--source') + 1], 'mahiro:pi-workers')
  assert.equal(args[args.indexOf('--ttl-ms') + 1], '30000')
  assert.deepEqual(
    args.filter((_, i) => args[i - 1] === '--token'),
    WORKER_TOKENS.map((key, i) => `${key}=${['1', '1', '2', epoch][i]}`),
  )
  assert.equal(workerArgs('pane-a', undefined, epoch, 6).filter((s) => s === '--clear-token').length, 4)
  for (const running of [-1, 0.5, NaN, Infinity, 257])
    assert.throws(() => workerArgs('pane-a', { running, queued: 0 }, epoch, 1))
})

test('non-TUI inherited binding and outside Herdr never claim/dispose/import/poll', async () => {
  for (const mode of ['rpc', 'print', 'sdk', 'json']) {
    const f = fixture({ mode })
    f.tick()
    f.producer.dispose()
    await settle()
    assert.equal(f.calls.length, 0)
    assert.equal(f.loads, 0)
    assert.equal(f.polls, 0)
    let disposed = false
    const owner = {
      seq: 1,
      dispose: () => {
        disposed = true
      },
    }
    startWorkerActivity({ mode, sessionManager: {} }, { owner, env: { HERDR_ENV: '1' } }).dispose()
    assert.equal(disposed, false)
  }
  for (const env of [{}, { HERDR_ENV: '1', HERDR_PANE_ID: '-bad', HERDR_SOCKET_PATH: '/s' }]) {
    const f = fixture({ env })
    await settle()
    assert.equal(f.loads, 0)
    assert.equal(f.calls.length, 0)
  }
})

test('idle parent independent positive counts; terminal/unknown clear; heartbeat, stop', async () => {
  const f = fixture()
  await settle()
  assert.ok(
    f
      .reports()
      .some((a) => a.includes('mahiro_pi_workers_running=1') && a.includes('mahiro_pi_workers_queued=1')),
  )
  assert.doesNotMatch(JSON.stringify(f.reports()), /PRIVATE|prompt|session|model|role|usage/)
  const n = f.reports().length
  f.tick()
  await settle()
  assert.equal(f.reports().length, n)
  f.tick(10000)
  await settle()
  assert.equal(f.reports().length, n + 1)
  f.records(['completed', 'aborted', 'stopped', 'error'].map((status) => ({ status })))
  f.tick()
  await settle()
  assert.ok(f.reports().at(-1)?.includes('mahiro_pi_workers_running=0'))
  f.records({ running: 7 })
  f.tick()
  await settle()
  assert.ok(f.reports().at(-1)?.includes('--clear-token'))
  f.producer.dispose()
  await settle()
  assert.equal(f.stopped, true)
  const done = f.calls.length
  f.tick(50000)
  await settle()
  assert.equal(f.calls.length, done)
})

test('missing old API and replaced exact service fail closed, never adopt/global fallback', async () => {
  const old = fixture({ missing: true })
  await settle()
  assert.ok(old.reports().every((a) => !a.includes('--token')))
  old.producer.dispose()
  const f = fixture()
  await settle()
  f.replace()
  f.tick()
  await settle()
  assert.ok(f.reports().at(-1)?.includes('--clear-token'))
  f.tick(11000)
  await settle()
  assert.ok(f.reports().at(-1)?.includes('--clear-token'))
  f.producer.dispose()
})

test('foreground mismatch and wrong pane gate every publication including clear', async () => {
  for (const wrongPane of [false, true]) {
    const f = fixture()
    await settle()
    if (wrongPane) f.pane('other')
    else f.foreground(false)
    const count = f.reports().length
    f.records([])
    f.tick(10000)
    await settle()
    f.producer.dispose()
    await settle()
    assert.equal(f.reports().length, count)
  }
})

test('single-flight latest coalescing, owner recheck after process-info and backoff', async () => {
  const f = fixture()
  await settle()
  f.delay(true)
  f.tick(10000)
  const count = f.calls.length
  for (let i = 0; i < 5; i++) {
    f.records(new Array(i).fill({ status: 'running' }))
    f.tick()
  }
  assert.equal(f.calls.length, count)
  f.replace()
  f.release()
  await settle()
  f.tick()
  await settle()
  assert.ok(f.reports().at(-1)?.includes('--clear-token'))
  f.fail(true)
  f.tick(10000)
  await settle()
  const failed = f.calls.length
  f.producer.tick()
  await settle()
  assert.equal(f.calls.length, failed)
  f.producer.dispose()
})

test('separate process-global sequence survives reload; stale generation cannot clear successor', async () => {
  const owner = workerOwner()
  assert.equal(workerOwner(), owner)
  const f = fixture()
  await settle()
  const seq = f.owner.seq
  f.delay(true)
  f.tick(10000)
  const reports = f.reports().length
  f.owner.generation = {}
  f.release()
  await settle()
  f.producer.dispose()
  await settle()
  assert.equal(f.reports().length, reports)
  assert.ok(f.owner.seq > seq)
})
