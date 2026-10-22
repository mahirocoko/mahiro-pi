import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createWebActivityPublisher, webActivitySnapshot } from '../lib/worker-activity-web.ts'
import { startWorkerActivity } from '../lib/worker-activity.ts'
import type { Run } from '../lib/status.ts'

const settle = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve()
}
const row = (id: string, status = 'running') => ({
  id,
  type: 'verifier',
  description: 'bounded job',
  status,
  startedAt: 1,
  toolUses: 2,
  prompt: 'DO_NOT_PUBLISH',
  result: 'DO_NOT_PUBLISH',
})
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-web-observer-')))
  const parent = join(root, 'parent.jsonl')
  writeFileSync(parent, '{"type":"session","id":"parent"}\n', { mode: 0o600 })
  let file = parent
  const manager = { getSessionFile: () => file, getSessionId: () => 'parent' }
  const ctx = { mode: 'tui', cwd: root, sessionManager: manager }
  const env = {
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'w1:p1',
    HERDR_SOCKET_PATH: '/fixture/socket',
  }
  const directory = join(root, '.agent-state/runtime/upstream-v10700/pi-subagents')
  const receipt = join(directory, `${createHash('sha256').update(parent).digest('hex')}.json`)
  let now = 10_000
  let foreground = true
  let release: (() => void) | undefined
  let delayed = false
  let calls = 0
  let cancelled = 0
  const run: Run = (_command, args) => {
    assert.deepEqual(args, ['pane', 'process-info', '--pane', env.HERDR_PANE_ID])
    calls++
    return {
      promise: (async () => {
        if (delayed)
          await new Promise<void>((r) => {
            release = r
          })
        return JSON.stringify({
          result: {
            process_info: {
              pane_id: env.HERDR_PANE_ID,
              foreground_processes: [{ pid: foreground ? process.pid : -1 }],
            },
          },
        })
      })(),
      cancel() {
        cancelled++
        release?.()
      },
    }
  }
  const sink = createWebActivityPublisher(ctx, { env, run, now: () => now })
  return {
    root,
    ctx,
    env,
    receipt,
    directory,
    sink,
    get calls() {
      return calls
    },
    get cancelled() {
      return cancelled
    },
    time() {
      now += 2000
    },
    delay() {
      delayed = true
    },
    release() {
      delayed = false
      release?.()
    },
    foreground(v: boolean) {
      foreground = v
    },
    parent(v: string) {
      file = v
    },
    clean() {
      sink.dispose()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

test('wire v1 whitelist, caps, native statuses and active-first metadata', () => {
  const f = fixture()
  try {
    const snapshot = webActivitySnapshot(
      f.ctx.sessionManager,
      [row('terminal', 'completed'), row('live')],
      10,
    )
    assert.equal(snapshot?.version, 1)
    assert.equal(snapshot?.parentFile, f.ctx.sessionManager.getSessionFile())
    assert.equal(snapshot?.records[0].id, 'live')
    assert.doesNotMatch(JSON.stringify(snapshot), /DO_NOT_PUBLISH|prompt|result/)
    assert.equal(webActivitySnapshot(f.ctx.sessionManager, [] as unknown[], 10)?.records.length, 0)
    for (const bad of [
      [null],
      [row('same'), row('same')],
      [row('x', 'done')],
      [row('x', 'resuming')],
      new Array(2),
      Array.from({ length: 25 }, (_, i) => row(`a${i}`)),
      Array.from({ length: 257 }, (_, i) => row(`a${i}`, 'completed')),
      [{ ...row('x'), toolUses: -1 }],
      [{ ...row('x'), completedAt: 0 }],
    ]) {
      assert.equal(webActivitySnapshot(f.ctx.sessionManager, bad), undefined)
    }
    const large = Array.from({ length: 24 }, (_, i) => ({
      ...row(`r${i}`),
      description: 'x'.repeat(1024),
    }))
    assert.equal(webActivitySnapshot(f.ctx.sessionManager, large), undefined)
    assert.equal(
      webActivitySnapshot(
        f.ctx.sessionManager,
        Array.from({ length: 40 }, (_, i) => row(`r${i}`, 'completed')),
      )?.records.length,
      24,
    )
  } finally {
    f.clean()
  }
})

test('explicit sink only; 2s single-flight, foreground guard, private atomic parent SHA receipt', async () => {
  const f = fixture()
  try {
    assert.equal(f.calls, 0)
    assert.equal(existsSync(f.directory), false)
    f.sink.publish(
      () => [row('a')],
      () => true,
    )
    await settle()
    assert.equal(f.calls, 1)
    assert.equal(lstatSync(f.receipt).mode & 0o777, 0o600)
    assert.equal(lstatSync(f.directory).mode & 0o777, 0o700)
    assert.equal(JSON.parse(readFileSync(f.receipt, 'utf8')).records[0].id, 'a')
    f.sink.publish(
      () => [],
      () => true,
    )
    assert.equal(f.calls, 1)
    f.time()
    f.foreground(false)
    const prior = readFileSync(f.receipt, 'utf8')
    f.sink.publish(
      () => [],
      () => true,
    )
    await settle()
    assert.equal(readFileSync(f.receipt, 'utf8'), prior)
    assert.match(f.sink.status(), /unavailable/)
    assert.deepEqual(readdirSync(f.directory), [f.receipt.split('/').at(-1)])
  } finally {
    f.clean()
  }
})

test('async return fence reads latest native data; no stale generation, switched parent or shutdown publication', async () => {
  for (const action of ['latest', 'revoke', 'parent', 'dispose']) {
    const f = fixture()
    try {
      let current = true
      let records = [row('old')]
      f.delay()
      f.sink.publish(
        () => records,
        () => current,
      )
      f.time()
      f.sink.publish(
        () => [row('ignored')],
        () => true,
      )
      assert.equal(f.calls, 1)
      if (action === 'latest') records = [row('new', 'completed')]
      if (action === 'revoke') current = false
      if (action === 'parent') f.parent(join(f.root, 'other.jsonl'))
      if (action === 'dispose') f.sink.dispose()
      f.release()
      await settle()
      if (action === 'latest') assert.equal(JSON.parse(readFileSync(f.receipt, 'utf8')).records[0].id, 'new')
      else assert.equal(existsSync(f.receipt), false)
    } finally {
      f.clean()
    }
  }
})

test('unsafe existing directories, files and links refuse without chmod/repair or dangling temp', async () => {
  for (const kind of ['ancestor', 'file', 'link', 'dangling']) {
    const f = fixture()
    try {
      f.sink.publish(
        () => [],
        () => true,
      )
      await settle()
      const before = readFileSync(f.receipt)
      f.time()
      if (kind === 'ancestor') chmodSync(join(f.root, '.agent-state'), 0o755)
      if (kind === 'file') chmodSync(f.receipt, 0o644)
      if (kind === 'link' || kind === 'dangling') {
        rmSync(f.receipt)
        symlinkSync(join(f.root, kind === 'link' ? 'parent.jsonl' : 'absent'), f.receipt)
      }
      f.sink.publish(
        () => [row('secret')],
        () => true,
      )
      await settle()
      assert.match(f.sink.status(), /unavailable/)
      if (kind === 'ancestor') assert.equal(lstatSync(join(f.root, '.agent-state')).mode & 0o777, 0o755)
      if (kind === 'file') {
        assert.equal(lstatSync(f.receipt).mode & 0o777, 0o644)
        assert.deepEqual(readFileSync(f.receipt), before)
      }
      if (kind === 'link' || kind === 'dangling') assert.equal(lstatSync(f.receipt).isSymbolicLink(), true)
      assert.equal(
        readdirSync(f.directory).some((p) => p.endsWith('.tmp')),
        false,
      )
    } finally {
      f.clean()
    }
  }
})

test('worker observer uses existing exact owner, no extra poll/import; revoked getter fails closed', async () => {
  let observe: (() => unknown) | undefined
  let current: (() => boolean) | undefined
  let callback = () => {}
  let records: unknown[] = [row('a')]
  let service = { listAgents: () => records }
  const manager = {}
  const p = startWorkerActivity(
    { mode: 'tui', sessionManager: manager },
    {
      owner: { seq: 0 },
      env: {
        HERDR_ENV: '1',
        HERDR_PANE_ID: 'w1:p1',
        HERDR_SOCKET_PATH: '/test/socket',
      },
      every(cb) {
        callback = cb
        return () => {}
      },
      load: async () => ({
        getSubagentsServiceForSession: (owner) => (owner === manager ? service : undefined),
      }),
      run: (_command, args) => ({
        promise: Promise.resolve(
          args[1] === 'process-info'
            ? JSON.stringify({
                result: {
                  process_info: {
                    pane_id: 'w1:p1',
                    foreground_processes: [{ pid: process.pid }],
                  },
                },
              })
            : '{}',
        ),
        cancel() {},
      }),
      observe(read, valid) {
        observe = read
        current = valid
      },
    },
  )
  await settle()
  assert.deepEqual(observe?.(), records)
  records = [row('b')]
  assert.deepEqual(observe?.(), records)
  service = { listAgents: () => [] }
  assert.equal(current?.(), false)
  assert.equal(observe?.(), undefined)
  callback()
  p.dispose()
  assert.equal(observe?.(), undefined)
})

test('non-TUI or absent Herdr sink fails before creating output', () => {
  const f = fixture()
  try {
    for (const mode of ['rpc', 'print', 'sdk'])
      assert.throws(() => createWebActivityPublisher({ ...f.ctx, mode }, { env: f.env }))
    assert.throws(() => createWebActivityPublisher(f.ctx, { env: {} }))
    assert.equal(existsSync(f.directory), false)
  } finally {
    f.clean()
  }
})
