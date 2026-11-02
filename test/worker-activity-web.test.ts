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
import {
  createWebActivityPublisher,
  readWebActivityTarget,
  webActivitySnapshot,
} from '../lib/worker-activity-web.ts'
import { startWorkerActivity, type WorkerOwner } from '../lib/worker-activity.ts'

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
  let file: string | undefined = parent
  const manager = { getSessionFile: () => file, getSessionId: () => 'parent' }
  const ctx = { mode: 'tui', sessionManager: manager }
  const directory = join(root, '.agent-state/runtime/upstream-v10700/pi-subagents')
  const receipt = join(directory, `${createHash('sha256').update(parent).digest('hex')}.json`)
  let now = 10_000
  const make = () => createWebActivityPublisher(ctx, { root, now: () => now })
  const sink = make()
  return {
    root,
    ctx,
    receipt,
    directory,
    sink,
    make,
    time() {
      now += 2000
    },
    parent(v: string | undefined) {
      file = v
    },
    clean() {
      sink.dispose()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

test('wire whitelist, parent-only unavailable, active-first caps and native statuses', () => {
  const f = fixture()
  try {
    const snapshot = webActivitySnapshot(
      f.ctx.sessionManager,
      [row('terminal', 'completed'), row('live')],
      10,
    )
    assert.equal(snapshot?.records[0].id, 'live')
    assert.doesNotMatch(JSON.stringify(snapshot), /DO_NOT_PUBLISH|prompt|result/)
    assert.equal(webActivitySnapshot(f.ctx.sessionManager, [])?.records.length, 0)
    assert.equal(webActivitySnapshot(f.ctx.sessionManager, undefined)?.activity, 'unavailable')
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
    ])
      assert.equal(webActivitySnapshot(f.ctx.sessionManager, bad), undefined)
    assert.equal(
      webActivitySnapshot(
        f.ctx.sessionManager,
        Array.from({ length: 24 }, (_, i) => ({ ...row(`r${i}`), description: 'x'.repeat(1024) })),
      ),
      undefined,
    )
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

test('runtime-neutral configured sink, private atomic publication, bounded heartbeat and revocation', () => {
  const f = fixture()
  try {
    assert.equal(existsSync(f.directory), false)
    f.sink.publish(
      () => [row('a')],
      () => true,
    )
    assert.equal(lstatSync(f.receipt).mode & 0o777, 0o600)
    assert.equal(lstatSync(f.directory).mode & 0o777, 0o700)
    assert.equal(JSON.parse(readFileSync(f.receipt, 'utf8')).records[0].id, 'a')
    f.sink.publish(
      () => [],
      () => true,
    )
    assert.equal(JSON.parse(readFileSync(f.receipt, 'utf8')).records.length, 1)
    f.time()
    f.sink.publish(
      () => undefined,
      () => true,
    )
    assert.equal(JSON.parse(readFileSync(f.receipt, 'utf8')).activity, 'unavailable')
    f.sink.dispose()
    assert.equal(existsSync(f.receipt), false)
    f.time()
    f.sink.publish(
      () => [],
      () => true,
    )
    assert.equal(existsSync(f.receipt), false)
  } finally {
    f.clean()
  }
})

test('single producer generation, replacement session and stale shutdown cannot erase newer receipt', () => {
  const f = fixture()
  let next: ReturnType<typeof createWebActivityPublisher> | undefined
  try {
    f.sink.publish(
      () => [row('old')],
      () => true,
    )
    next = f.make()
    assert.equal(existsSync(f.receipt), false)
    next.publish(
      () => [row('new')],
      () => true,
    )
    f.time()
    f.sink.publish(
      () => [row('stale')],
      () => true,
    )
    f.sink.dispose()
    assert.equal(JSON.parse(readFileSync(f.receipt, 'utf8')).records[0].id, 'new')
    f.parent(join(f.root, 'other.jsonl'))
    next.publish(
      () => [],
      () => true,
    )
    assert.equal(existsSync(f.receipt), false)
  } finally {
    next?.dispose()
    f.clean()
  }
})

test('fresh legacy/foreign producers never race; only expired same-parent wire may be replaced', () => {
  for (const foreign of [undefined, 'another-producer']) {
    const f = fixture()
    try {
      f.sink.publish(
        () => [row('own')],
        () => true,
      )
      const previous = JSON.parse(readFileSync(f.receipt, 'utf8'))
      delete previous.producer
      if (foreign) previous.producer = foreign
      previous.records = [row('foreign')]
      writeFileSync(f.receipt, JSON.stringify(previous), { mode: 0o600 })
      f.time()
      f.sink.publish(
        () => [row('must-not-overwrite')],
        () => true,
      )
      assert.equal(JSON.parse(readFileSync(f.receipt, 'utf8')).records[0].id, 'foreign')
      assert.match(f.sink.status(), /unavailable/)
      for (let i = 0; i < 4; i++) f.time()
      f.sink.publish(
        () => [row('after-expiry')],
        () => true,
      )
      assert.equal(JSON.parse(readFileSync(f.receipt, 'utf8')).records[0].id, 'after-expiry')
    } finally {
      f.clean()
    }
  }
})

test('lazy persistent SessionManager file is bound on first valid publication, not construction', () => {
  const f = fixture()
  try {
    f.parent(undefined)
    f.sink.publish(
      () => [],
      () => true,
    )
    assert.equal(existsSync(f.receipt), false)
    f.parent(join(f.root, 'parent.jsonl'))
    f.time()
    f.sink.publish(
      () => [],
      () => true,
    )
    assert.equal(existsSync(f.receipt), true)
  } finally {
    f.clean()
  }
})

test('unsafe ancestors/files/links refuse without repair or temporary leaks', () => {
  for (const kind of ['ancestor', 'file', 'link', 'dangling']) {
    const f = fixture()
    try {
      f.sink.publish(
        () => [],
        () => true,
      )
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

test('one-time profile config is explicit, private, bounded, canonical and independent of cwd', () => {
  const f = fixture()
  const profile = join(f.root, 'profile')
  mkdirSync(profile, { mode: 0o700 })
  const file = join(profile, 'herdr-web.json')
  try {
    assert.equal(readWebActivityTarget(profile), undefined)
    writeFileSync(file, JSON.stringify({ version: 1, root: f.root }), { mode: 0o600 })
    assert.equal(readWebActivityTarget(profile), f.root)
    chmodSync(file, 0o644)
    assert.throws(() => readWebActivityTarget(profile))
    rmSync(file)
    symlinkSync(join(f.root, 'absent'), file)
    // O_NOFOLLOW refuses a dangling link rather than treating it as absent config.
    assert.throws(() => readWebActivityTarget(profile))
    rmSync(file)
    writeFileSync(file, 'x'.repeat(4097), { mode: 0o600 })
    assert.throws(() => readWebActivityTarget(profile))
  } finally {
    f.clean()
  }
})

test('core can observe without old Herdr binding; non-TUI cannot replace TUI owner', async () => {
  let read: (() => unknown) | undefined
  let current: (() => boolean) | undefined
  const manager = {}
  const owner: WorkerOwner = { seq: 0 }
  const service = { listAgents: () => [row('a')] }
  let polls = 0
  const p = startWorkerActivity(
    { mode: 'tui', sessionManager: manager },
    {
      owner,
      env: {},
      load: async () => ({ getSubagentsServiceForSession: (o) => (o === manager ? service : undefined) }),
      every() {
        polls++
        return () => {}
      },
      observe(r, valid) {
        read = r
        current = valid
      },
    },
  )
  for (let i = 0; i < 25; i++) await Promise.resolve()
  assert.deepEqual(read?.(), service.listAgents())
  const generation = owner.generation
  startWorkerActivity(
    { mode: 'print', sessionManager: {} },
    {
      owner,
      observe() {
        throw Error('child must not observe')
      },
    },
  )
  assert.equal(owner.generation, generation)
  assert.equal(polls, 1)
  p.dispose()
  assert.equal(current?.(), false)
})

test('non-TUI publisher refuses before output', () => {
  const f = fixture()
  try {
    for (const mode of ['rpc', 'print', 'sdk'])
      assert.throws(() => createWebActivityPublisher({ ...f.ctx, mode }, { root: f.root }))
    assert.equal(existsSync(f.directory), false)
  } finally {
    f.clean()
  }
})
