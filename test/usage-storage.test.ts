import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import test from 'node:test'
const USAGE_DEFAULTS = { codex: false }
import { usageBinding, readUsageState, publishUsageState, UsageStorageError } from '../lib/usage-state.ts'
import { createUsageOwner } from '../lib/kernel/usage.ts'

function fixture(work: (b: ReturnType<typeof usageBinding>, profile: string) => void) {
  const base = path.resolve('.agent-state/runtime/t291-usage-profile/implementation/unit')
  fs.mkdirSync(base, { recursive: true, mode: 0o700 })
  const profile = path.join(fs.mkdtempSync(path.join(base, 'state-')), 'profile')
  fs.mkdirSync(profile, { mode: 0o700 })
  const old = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = profile
  try {
    work(usageBinding(), profile)
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = old
  }
}
const unavailable = (work: () => unknown) =>
  assert.throws(
    work,
    (error: unknown) =>
      error instanceof UsageStorageError &&
      error.code === 'unavailable' &&
      error.message === 'Usage storage unavailable; preferences not saved.',
  )

test('usage filesystem: absent read creates nothing, roundtrip, raw CAS, sequence, owned modes', () =>
  fixture((b, profile) => {
    const initial = readUsageState(b)
    assert.deepEqual(fs.readdirSync(profile), [])
    const first = publishUsageState(b, initial.ticket, { codex: true }, () => {})
    assert.equal(first.state.sequence, 1)
    assert.equal(first.state.codex, true)
    assert.deepEqual(readUsageState(b), first)
    for (const p of [path.join(profile, 'preferences'), b.root])
      assert.equal(fs.statSync(p).mode & 0o7777, 0o700)
    const file = path.join(b.root, 'state.json')
    assert.equal(fs.statSync(file).mode & 0o7777, 0o600)
    assert.deepEqual(fs.readdirSync(b.root), ['state.json'])
    assert.throws(() => publishUsageState(b, initial.ticket, USAGE_DEFAULTS, () => {}), /revision changed/)
    fs.appendFileSync(file, ' ')
    assert.throws(() => publishUsageState(b, first.ticket, USAGE_DEFAULTS, () => {}), /revision changed/)
    const second = publishUsageState(b, readUsageState(b).ticket, USAGE_DEFAULTS, () => {})
    assert.equal(second.state.sequence, 2)
  }))

test('usage storage rejects corrupt/schema/UTF8/bounds without empty success or parser disclosure', () =>
  fixture((b) => {
    publishUsageState(b, readUsageState(b).ticket, USAGE_DEFAULTS, () => {})
    const file = path.join(b.root, 'state.json')
    for (const bytes of [
      Buffer.from('{PRIVATE_CANARY'),
      Buffer.from([0xff]),
      Buffer.alloc(4097),
      Buffer.from(JSON.stringify({ version: 2, sequence: 1, ...USAGE_DEFAULTS })),
      Buffer.from(
        JSON.stringify({
          version: 1,
          sequence: 1,
          ...USAGE_DEFAULTS,
          unexpected: 'PRIVATE_CANARY',
        }),
      ),
    ]) {
      fs.writeFileSync(file, bytes)
      unavailable(() => readUsageState(b))
      assert.deepEqual(fs.readFileSync(file), bytes)
    }
  }))

test('usage state and ancestors: mode, symlink, hardlink, unsafe containers, overlap, no repair', () =>
  fixture((b, profile) => {
    publishUsageState(b, readUsageState(b).ticket, USAGE_DEFAULTS, () => {})
    const file = path.join(b.root, 'state.json'),
      bytes = fs.readFileSync(file)
    fs.chmodSync(file, 0o644)
    unavailable(() => readUsageState(b))
    assert.equal(fs.statSync(file).mode & 0o777, 0o644)
    fs.chmodSync(file, 0o600)
    fs.renameSync(file, `${file}.original`)
    fs.symlinkSync(`${file}.original`, file)
    unavailable(() => readUsageState(b))
    fs.unlinkSync(file)
    fs.linkSync(`${file}.original`, file)
    unavailable(() => readUsageState(b))
    fs.unlinkSync(file)
    fs.renameSync(`${file}.original`, file)
    fs.chmodSync(b.root, 0o755)
    unavailable(() => readUsageState(b))
    assert.equal(fs.statSync(b.root).mode & 0o777, 0o755)
    fs.chmodSync(b.root, 0o700)
    fs.chmodSync(profile, 0o777)
    unavailable(() => readUsageState(b))
    fs.chmodSync(profile, 0o700)
    const memory = process.env.MAHIRO_AGENT_MEMORY_ROOT
    try {
      process.env.MAHIRO_AGENT_MEMORY_ROOT = b.root
      unavailable(() => readUsageState(b))
    } finally {
      if (memory === undefined) delete process.env.MAHIRO_AGENT_MEMORY_ROOT
      else process.env.MAHIRO_AGENT_MEMORY_ROOT = memory
    }
    assert.deepEqual(fs.readFileSync(file), bytes)
    fs.renameSync(b.root, `${b.root}.original`)
    fs.symlinkSync(`${b.root}.original`, b.root)
    unavailable(() => readUsageState(b))
  }))

test('usage publication: cooperative lock never stolen; final revocation and CAS recheck leave bytes intact', () =>
  fixture((b) => {
    const first = publishUsageState(b, readUsageState(b).ticket, USAGE_DEFAULTS, () => {})
    const file = path.join(b.root, 'state.json'),
      lock = path.join(b.root, 'state.lock')
    fs.writeFileSync(lock, 'NO_STEAL', { mode: 0o600 })
    unavailable(() => publishUsageState(b, first.ticket, USAGE_DEFAULTS, () => {}))
    assert.equal(fs.readFileSync(lock, 'utf8'), 'NO_STEAL')
    fs.unlinkSync(lock)
    const bytes = fs.readFileSync(file)
    let calls = 0
    unavailable(() =>
      publishUsageState(b, first.ticket, USAGE_DEFAULTS, () => {
        if (++calls === 3) throw Error('PRIVATE_REVOCATION_CANARY')
      }),
    )
    assert.equal(calls, 3)
    assert.deepEqual(fs.readFileSync(file), bytes)
    calls = 0
    assert.throws(
      () =>
        publishUsageState(b, first.ticket, USAGE_DEFAULTS, () => {
          if (++calls === 3) fs.appendFileSync(file, ' ')
        }),
      /revision changed/,
    )
    assert.equal(fs.readFileSync(file, 'utf8'), bytes.toString() + ' ')
    assert.deepEqual(fs.readdirSync(b.root), ['state.json'])
  }))

test('usage fault injection: temp write/fsync/rename fail before publication, directory fsync after rename is ambiguous', () => {
  for (const fault of ['write', 'fsync', 'rename', 'post-rename'] as const)
    fixture((b) => {
      const first = publishUsageState(b, readUsageState(b).ticket, USAGE_DEFAULTS, () => {})
      const file = path.join(b.root, 'state.json'),
        bytes = fs.readFileSync(file)
      const original = {
        open: fs.openSync,
        write: fs.writeFileSync,
        fsync: fs.fsyncSync,
        rename: fs.renameSync,
      }
      const tempFds = new Set<number>()
      let renamed = false,
        injected = false
      fs.openSync = ((p: any, ...args: any[]) => {
        const fd = (original.open as any)(p, ...args)
        if (String(p).endsWith('.tmp')) tempFds.add(fd)
        return fd
      }) as typeof fs.openSync
      fs.writeFileSync = ((fd: any, ...args: any[]) => {
        if (fault === 'write' && tempFds.has(fd)) {
          injected = true
          throw Error('PRIVATE_WRITE_CANARY')
        }
        return (original.write as any)(fd, ...args)
      }) as typeof fs.writeFileSync
      fs.fsyncSync = ((fd: number) => {
        if (!injected && ((fault === 'fsync' && tempFds.has(fd)) || (fault === 'post-rename' && renamed))) {
          injected = true
          throw Error('PRIVATE_FSYNC_CANARY')
        }
        return original.fsync(fd)
      }) as typeof fs.fsyncSync
      fs.renameSync = ((...args: any[]) => {
        if (fault === 'rename') {
          injected = true
          throw Error('PRIVATE_RENAME_CANARY')
        }
        ;(original.rename as any)(...args)
        renamed = true
      }) as typeof fs.renameSync
      syncBuiltinESMExports()
      try {
        assert.throws(
          () => publishUsageState(b, first.ticket, { codex: true }, () => {}),
          (error: unknown) =>
            error instanceof UsageStorageError &&
            error.code === (fault === 'post-rename' ? 'durability-unknown' : 'unavailable'),
        )
      } finally {
        fs.openSync = original.open
        fs.writeFileSync = original.write
        fs.fsyncSync = original.fsync
        fs.renameSync = original.rename
        syncBuiltinESMExports()
      }
      assert.equal(injected, true)
      assert.deepEqual(fs.readdirSync(b.root), ['state.json'])
      if (fault === 'post-rename') {
        assert.equal(readUsageState(b).state.codex, true)
        assert.throws(() => publishUsageState(b, first.ticket, USAGE_DEFAULTS, () => {}), /revision changed/)
      } else assert.deepEqual(fs.readFileSync(file), bytes)
    })
})

for (const target of ['preferences', 'usage'] as const)
  for (const boundary of ['mkdir-before', 'mkdir-after', 'self-sync', 'parent-sync'] as const)
    test(`usage directory retry: ${target} ${boundary} failure, reopen, then durable ancestors before success`, () =>
      fixture((b, profile) => {
        const preferences = path.join(profile, 'preferences')
        const directory = target === 'preferences' ? preferences : b.root
        const parent = path.dirname(directory)
        const initial = readUsageState(b)
        const original = {
          mkdir: fs.mkdirSync,
          open: fs.openSync,
          close: fs.closeSync,
          fsync: fs.fsyncSync,
          rename: fs.renameSync,
        }
        const fds = new Map<number, string>()
        const events: string[] = []
        let injected = false
        let retry = false
        let selfSynced = false
        const fail = () => {
          injected = true
          throw Error('PRIVATE_DIRECTORY_CANARY')
        }
        fs.mkdirSync = ((p: any, ...args: any[]) => {
          events.push(`mkdir:${String(p)}`)
          if (!retry && String(p) === directory && boundary === 'mkdir-before') fail()
          const result = (original.mkdir as any)(p, ...args)
          if (!retry && String(p) === directory && boundary === 'mkdir-after') fail()
          return result
        }) as typeof fs.mkdirSync
        fs.openSync = ((p: any, ...args: any[]) => {
          const fd = (original.open as any)(p, ...args)
          fds.set(fd, String(p))
          return fd
        }) as typeof fs.openSync
        fs.closeSync = ((fd: number) => {
          fds.delete(fd)
          return original.close(fd)
        }) as typeof fs.closeSync
        fs.fsyncSync = ((fd: number) => {
          const p = fds.get(fd)
          if (!retry && !injected) {
            if (boundary === 'self-sync' && p === directory) fail()
            if (boundary === 'parent-sync' && selfSynced && p === parent) fail()
          }
          original.fsync(fd)
          events.push(`sync:${p}`)
          if (p === directory) selfSynced = true
        }) as typeof fs.fsyncSync
        fs.renameSync = ((...args: any[]) => {
          events.push('rename')
          return (original.rename as any)(...args)
        }) as typeof fs.renameSync
        syncBuiltinESMExports()
        try {
          unavailable(() => publishUsageState(b, initial.ticket, USAGE_DEFAULTS, () => {}))
          assert.equal(injected, true)
          assert.equal(fs.existsSync(path.join(b.root, 'state.json')), false)
          assert.equal(fs.existsSync(directory), boundary !== 'mkdir-before')
          retry = true
          events.length = 0
          const reopened = usageBinding()
          const revision = readUsageState(reopened)
          assert.equal(revision.ticket, initial.ticket)
          assert.deepEqual(events, [] as string[], 'reopen/read never creates or syncs')
          const saved = publishUsageState(reopened, revision.ticket, USAGE_DEFAULTS, () => {})
          events.push('success')
          assert.equal(saved.state.sequence, 1)
          assert.deepEqual(
            events.filter((event) => event.startsWith('sync:')).slice(0, 4),
            [preferences, profile, b.root, preferences].map((p) => `sync:${p}`),
            'retry persists both private directories and their parents, including profile',
          )
          const rename = events.indexOf('rename')
          assert.ok(rename >= 0)
          assert.deepEqual(
            events
              .slice(0, rename)
              .filter((event) => event.startsWith('sync:'))
              .slice(0, 4),
            [preferences, profile, b.root, preferences].map((p) => `sync:${p}`),
            'ancestor durability precedes publication, not merely successful return',
          )
          assert.ok(events.indexOf('success') > rename)
          assert.deepEqual(readUsageState(reopened), saved)
        } finally {
          fs.mkdirSync = original.mkdir
          fs.openSync = original.open
          fs.closeSync = original.close
          fs.fsyncSync = original.fsync
          fs.renameSync = original.rename
          syncBuiltinESMExports()
        }
      }))

test('usage profile roots isolate selection and a fresh owner restores across manager/project bindings', () =>
  fixture((b, profile) => {
    const first = createUsageOwner({}, () => {})
    const ctx = { sessionManager: {}, cwd: '/project-one' } as never
    const initial = first.read(ctx)
    first.save(ctx, initial.ticket, { codex: true })
    const second = createUsageOwner({}, () => {})
    const fresh = { sessionManager: {}, cwd: '/project-two' } as never
    assert.equal(second.read(fresh).preferences.codex, true)
    const separate = `${profile}-separate`
    fs.mkdirSync(separate, { mode: 0o700 })
    process.env.PI_CODING_AGENT_DIR = separate
    const other = second.read(fresh)
    assert.equal(other.present, false)
    assert.equal(other.preferences.codex, false)
    assert.deepEqual(fs.readdirSync(separate), [])
    unavailable(() => readUsageState(b))
    process.env.PI_CODING_AGENT_DIR = profile
    assert.equal(second.read(fresh).preferences.codex, true)
  }))

test('usage Root-private controller uses generation/manager-bound tickets and fixed authority before any IO', () =>
  fixture((b, profile) => {
    const generation = {},
      manager = {},
      ctx = { sessionManager: manager } as never
    let allowed = false,
      calls = 0
    const owner = createUsageOwner(generation, () => {
      calls++
      if (!allowed) throw Error('DENIED_CANARY')
    })
    unavailable(() => owner.read(ctx))
    assert.equal(calls, 1)
    assert.deepEqual(fs.readdirSync(profile), [])
    allowed = true
    const first = owner.read(ctx)
    assert.deepEqual(first.preferences, USAGE_DEFAULTS)
    const competing = owner.read(ctx)
    assert.throws(
      () => owner.save({ sessionManager: {} } as never, first.ticket, USAGE_DEFAULTS),
      /revision changed/,
    )
    assert.throws(() => owner.save(ctx, { version: 1 }, USAGE_DEFAULTS), /revision changed/)
    const second = owner.save(ctx, first.ticket, {
      codex: true,
    })
    assert.equal(second.preferences.codex, true)
    assert.throws(() => owner.save(ctx, competing.ticket, USAGE_DEFAULTS), /revision changed/)
    const replacement = createUsageOwner({}, () => {})
    assert.throws(() => replacement.save(ctx, second.ticket, USAGE_DEFAULTS), /revision changed/)
    allowed = false
    unavailable(() => owner.save(ctx, second.ticket, USAGE_DEFAULTS))
    assert.equal(readUsageState(b).state.sequence, 1)
  }))
