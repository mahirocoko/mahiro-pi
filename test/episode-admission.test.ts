import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MemoryEngineController, type OperationContext } from '../lib/agent-memory/engine/controller.ts'
import { MemoryDataEngine } from '../lib/agent-memory/engine/data.ts'
import {
  episodeMutex,
  episodeRecovery,
  withEpisodeAdmission,
} from '../lib/agent-memory/engine/episode-admission.ts'
import { engineEnvironment, type Check } from '../lib/agent-memory/engine/io.ts'
import { offlineMaintenance, offlineAssurance } from '../lib/agent-memory/engine/offline-maintenance.ts'
import { createMemoryStore, type Episode } from '../lib/agent-memory/store.ts'

const allow: Check = async () => {}
const episode = (seed: string): Episode => ({
  id: createHash('sha256').update(seed).digest('hex'),
  project: 'fixture',
  session: 'synthetic',
  evidence: 'observed-native-unverified',
  observedAt: '2026-08-01T00:00:00.000Z',
  entryHash: createHash('sha256').update(seed).digest('hex'),
  input: { text: seed, source: 'rpc' },
  actions: [],
  results: [],
  outcome: 'completed',
  assistantSteps: 1,
})
function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-episode-admission-'))
  const root = join(dir, 'memory')
  const project = join(dir, 'project')
  mkdirSync(project, { mode: 0o700 })
  const previous = { ...process.env }
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key]
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
  })
  const store = createMemoryStore(root, () => {}, 'primary')
  store.initialize(
    {
      version: 1,
      automatic: false,
      coreBytes: 8192,
      indexBytes: 2048,
      fileBytes: 8192,
      totalBytes: 65536,
      projects: [{ id: 'fixture', cwd: project }],
    },
    '# Synthetic fixture\n',
  )
  mkdirSync(join(root, '.episodes'), { mode: 0o700 })
  const engine = new MemoryEngineController(root)
  const context: OperationContext = { current: () => true }
  const data = () => new MemoryDataEngine(root, engineEnvironment())
  const observe = (value: Episode, check = allow) =>
    data().execute('observe', { episode: value }, check, new AbortController().signal)
  const inspect = async () => {
    const result = await offlineMaintenance(engine, context, { action: 'offline-episode-inspect' })
    assert.ok('revision' in result)
    return result
  }
  const apply = async (preview: { target: string; revision: string }, selected = context, resume = false) => {
    const result = await offlineMaintenance(engine, selected, {
      action: resume ? 'offline-episode-resume' : 'offline-episode-recover',
      target: preview.target,
      revision: preview.revision,
      offline: offlineAssurance,
    })
    assert.ok('phase' in result)
    return result
  }
  return {
    root,
    dir,
    engine,
    context,
    data,
    observe,
    inspect,
    apply,
    async close() {
      await engine.close()
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
function seed(root: string, count: number) {
  const original = new Map<string, string>()
  for (let i = 0; i < count; i++) {
    const value = episode(`seed-${i}`)
    const name = `${value.id}.json`
    const raw = `${JSON.stringify(value)}\n`
    original.set(name, raw)
    writeFileSync(join(root, '.episodes', name), raw, { mode: 0o600 })
  }
  return original
}
function residue(root: string, owner: 'absent' | 'empty' | 'partial' | 'complete' = 'complete') {
  if (owner !== 'absent') {
    mkdirSync(join(root, episodeMutex), { mode: 0o700 })
    if (owner !== 'empty')
      writeFileSync(
        join(root, episodeMutex, 'owner.json'),
        owner === 'partial'
          ? '{"version":'
          : JSON.stringify({ version: 1, token: randomUUID(), directory: 'synthetic-only' }),
        { mode: 0o600 },
      )
  }
  const value = episode('acknowledged-private-synthetic-bytes')
  const target = join(root, '.episodes', `${value.id}.json`)
  writeFileSync(target, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  const temp = `${target}.${randomUUID()}.tmp`
  linkSync(target, temp)
  return { target, temp, raw: readFileSync(target) }
}

test('independent ABI2 controllers serialize 255 -> 256, duplicate IDs and full-capacity idempotence without lost bytes', async () => {
  const f = fixture()
  const other = new MemoryEngineController(f.root)
  try {
    const originals = seed(f.root, 255)
    const left = episode('left')
    const right = episode('right')
    const results = await Promise.allSettled([
      f.engine.request('observe', { episode: left }, f.context),
      other.request('observe', { episode: right }, f.context),
    ])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(readdirSync(join(f.root, '.episodes')).filter((n) => n.endsWith('.json')).length, 256)
    for (const [name, bytes] of originals)
      assert.equal(readFileSync(join(f.root, '.episodes', name), 'utf8'), bytes)
    const admitted = existsSync(join(f.root, '.episodes', `${left.id}.json`)) ? left : right
    assert.deepEqual(
      await Promise.all([
        f.engine.request('observe', { episode: admitted }, f.context),
        other.request('observe', { episode: admitted }, f.context),
      ]),
      [{ recorded: true }, { recorded: true }],
    )
    await assert.rejects(f.observe({ ...admitted, assistantSteps: 9 }), /Observed episode changed/)
    assert.equal(existsSync(join(f.root, episodeMutex)), false)
    assert.equal(existsSync(join(f.root, '.lock')), false, 'not the publication mutex')
  } finally {
    await other.close()
    await f.close()
  }
})

test('an existing root without an episode directory admits without migration', async () => {
  const f = fixture()
  try {
    rmSync(join(f.root, '.episodes'), { recursive: true })
    assert.deepEqual(await f.observe(episode('first')), { recorded: true })
    assert.equal(readdirSync(join(f.root, '.episodes')).length, 1)
  } finally {
    await f.close()
  }
})

for (const failure of ['sync-error', 'revoked'] as const) {
  test(`episode provisioning root sync precedes admission and fails closed on ${failure}`, async (t) => {
    const f = fixture()
    try {
      rmSync(join(f.root, '.episodes'), { recursive: true })
      const root = lstatSync(f.root)
      const handle = await open(f.root, 'r')
      const prototype = Object.getPrototypeOf(handle)
      const original = prototype.sync
      await handle.close()
      let retry = false
      let rootSyncs = 0
      let rootGates = 0
      t.mock.method(prototype, 'sync', function (this: { fd: number }) {
        const stat = fstatSync(this.fd)
        if (stat.dev === root.dev && stat.ino === root.ino) {
          rootSyncs++
          assert.equal(existsSync(join(f.root, '.episodes')), true)
          assert.equal(
            existsSync(join(f.root, episodeMutex)),
            false,
            'parent sync must precede lock creation',
          )
          if (!retry && failure === 'sync-error')
            return Promise.reject(Object.assign(Error('Synthetic root sync EIO'), { code: 'EIO' }))
        }
        return original.call(this)
      })
      const check: Check = async ({ physical }) => {
        if (
          physical.includes(f.root) &&
          physical.length === 1 &&
          !retry &&
          ++rootGates === 2 &&
          failure === 'revoked'
        )
          throw Error('Synthetic root sync revoked')
      }
      await assert.rejects(f.observe(episode('provisioned'), check), /Synthetic root sync/)
      assert.equal(rootSyncs, failure === 'sync-error' ? 1 : 0)
      assert.equal(
        readdirSync(join(f.root, '.episodes')).length,
        0,
        'no lock or episode acknowledged after failure',
      )
      retry = true
      assert.deepEqual(await f.observe(episode('provisioned')), { recorded: true })
      assert.equal(
        rootSyncs,
        failure === 'sync-error' ? 2 : 1,
        'retry syncs even an already-present directory',
      )
      // Exercises the actual sync boundary and failure ordering, not a power-loss simulation.
    } finally {
      t.mock.restoreAll()
      await f.close()
    }
  })
}

test('same ID concurrent fresh admission is exactly one durable episode', async () => {
  const f = fixture()
  try {
    const value = episode('duplicate')
    assert.deepEqual(await Promise.all([f.observe(value), f.observe(value)]), [
      { recorded: true },
      { recorded: true },
    ])
    assert.equal(readdirSync(join(f.root, '.episodes')).length, 1)
  } finally {
    await f.close()
  }
})

for (const seam of ['mkdir', 'owner-partial', 'release-owner-removed'] as const) {
  test(`admission crash/revocation seam ${seam} stays non-stealable and recovers only explicitly`, async () => {
    const f = fixture()
    try {
      let stopped = false
      const lock = join(f.root, episodeMutex)
      const check: Check = async ({ physical }) => {
        if (stopped) throw Error('revoked')
        const owner = join(lock, 'owner.json')
        if (
          (seam === 'mkdir' && physical.includes(owner) && !existsSync(owner)) ||
          (seam === 'owner-partial' && existsSync(owner) && readFileSync(owner).length === 0) ||
          (seam === 'release-owner-removed' &&
            existsSync(lock) &&
            !existsSync(owner) &&
            existsSync(join(f.root, '.episodes', `${episode(seam).id}.json`)))
        ) {
          stopped = true
          throw Error('revoked')
        }
      }
      await assert.rejects(f.observe(episode(seam), check), /revoked/)
      assert.equal(stopped, true)
      assert.equal(existsSync(lock), true)
      const original = readdirSync(lock).map((name) => [name, readFileSync(join(lock, name))] as const)
      const started = Date.now()
      await assert.rejects(
        withEpisodeAdmission(f.root, allow, async () => {}),
        /busy/,
      )
      assert.ok(Date.now() - started < 5000)
      for (const [name, bytes] of original) assert.deepEqual(readFileSync(join(lock, name)), bytes)
      const preview = await f.inspect()
      const result = await f.apply(preview)
      assert.equal(result.phase, 'completed')
      assert.equal(existsSync(lock), false)
      assert.deepEqual(await f.observe(episode(seam)), { recorded: true })
    } finally {
      await f.close()
    }
  })
}

test('an orphan partial episode temp is quarantined byte-exactly without inventing a canonical episode', async () => {
  const f = fixture()
  try {
    const name = `${episode('orphan').id}.json.${randomUUID()}.tmp`
    const bytes = '{"interrupted":'
    writeFileSync(join(f.root, '.episodes', name), bytes, { mode: 0o600 })
    const preview = await f.inspect()
    assert.equal((await f.apply(preview)).phase, 'completed')
    const saved = join(f.root, '.episodes', `.admission-recovered-${preview.revision}`, name)
    assert.equal(readFileSync(saved, 'utf8'), bytes)
    assert.equal(
      readdirSync(join(f.root, '.episodes')).some((n) => n.endsWith('.json')),
      false,
    )
  } finally {
    await f.close()
  }
})

for (const owner of ['absent', 'empty', 'partial', 'complete'] as const) {
  test(`offline recovery preserves published hardlink bytes and ${owner} owner evidence`, async () => {
    const f = fixture()
    try {
      const r = residue(f.root, owner)
      const preview = await f.inspect()
      assert.equal(JSON.stringify(preview).includes('acknowledged-private'), false)
      assert.equal(JSON.stringify(preview).includes(f.root), false)
      await assert.rejects(f.apply({ ...preview, revision: '0'.repeat(64) }))
      await assert.rejects(
        offlineMaintenance(f.engine, f.context, {
          action: 'offline-episode-recover',
          target: preview.target,
          revision: preview.revision,
        }),
      )
      assert.equal(lstatSync(r.target).nlink, 2)
      assert.equal((await f.apply(preview)).phase, 'completed')
      assert.equal(lstatSync(r.target).nlink, 1)
      assert.deepEqual(readFileSync(r.target), r.raw)
      assert.equal(existsSync(r.temp), false)
      const saved = join(f.root, '.episodes', `.admission-recovered-${preview.revision}`)
      assert.deepEqual(readFileSync(join(saved, r.temp.split('/').at(-1)!)), r.raw)
      if (owner !== 'absent') assert.equal(existsSync(join(saved, 'lock')), true)
      if (owner === 'partial')
        assert.equal(readFileSync(join(saved, 'lock/owner.json'), 'utf8'), '{"version":')
      assert.equal((await f.apply(preview, f.context, true)).phase, 'completed')
      assert.deepEqual(await f.observe(episode('after-recovery')), { recorded: true })
    } finally {
      await f.close()
    }
  })
}

for (const seam of [
  'empty-checkpoint',
  'partial-plan',
  'copy-partial',
  'copied',
  'unlinked',
  'lock-moved',
  'completion',
] as const) {
  test(`offline episode quarantine resumes after ${seam} without loss or duplicate canonical files`, async () => {
    const f = fixture()
    try {
      const r = residue(f.root)
      const preview = await f.inspect()
      const work = join(f.root, episodeRecovery)
      const savedTemp = join(work, r.temp.split('/').at(-1)!)
      let stopped = false
      const selected: OperationContext = {
        current: ({ physical }) => {
          if (stopped) return false
          const workExists = existsSync(work)
          const planExists = existsSync(join(work, 'plan.json'))
          const partial =
            workExists &&
            readdirSync(work).some((n) => n.startsWith('write-') && lstatSync(join(work, n)).size > 0)
          if (
            (seam === 'empty-checkpoint' &&
              workExists &&
              !planExists &&
              physical.includes(join(work, 'plan.json'))) ||
            (seam === 'partial-plan' && partial && !planExists) ||
            (seam === 'copy-partial' &&
              workExists &&
              readdirSync(work).some((n) => n.startsWith('copy-') && lstatSync(join(work, n)).size > 0)) ||
            (seam === 'copied' && existsSync(savedTemp) && existsSync(r.temp)) ||
            (seam === 'unlinked' &&
              existsSync(savedTemp) &&
              !existsSync(r.temp) &&
              existsSync(join(f.root, episodeMutex))) ||
            (seam === 'lock-moved' && existsSync(join(work, 'lock'))) ||
            (seam === 'completion' &&
              existsSync(join(f.root, '.episodes', `.admission-recovered-${preview.revision}`)))
          ) {
            stopped = true
            return false
          }
          return true
        },
      }
      await assert.rejects(f.apply(preview, selected))
      assert.equal(stopped, true)
      assert.deepEqual(readFileSync(r.target), r.raw)
      if (seam === 'empty-checkpoint' || seam === 'partial-plan') {
        const next = await f.inspect()
        assert.equal((await f.apply(next)).phase, 'completed')
      } else assert.equal((await f.apply(preview, f.context, true)).phase, 'completed')
      assert.deepEqual(readFileSync(r.target), r.raw)
      assert.equal(lstatSync(r.target).nlink, 1)
      assert.deepEqual(await f.observe(episode('after-crash')), { recorded: true })
    } finally {
      await f.close()
    }
  })
}

test('recovery refuses unknown entries, external hardlinks, changed reviewed identities and exact-root revocation', async () => {
  const f = fixture()
  try {
    const r = residue(f.root)
    const preview = await f.inspect()
    const outsider = join(f.dir, 'outside')
    linkSync(r.target, outsider)
    await assert.rejects(f.inspect(), /unsafe|hardlink/)
    rmSync(outsider)
    writeFileSync(join(f.root, '.episodes', 'unknown'), 'unknown synthetic bytes', { mode: 0o600 })
    await assert.rejects(f.inspect(), /unknown entry/)
    rmSync(join(f.root, '.episodes', 'unknown'))
    writeFileSync(join(f.root, episodeMutex, 'owner.json'), 'changed owner', { mode: 0o600 })
    await assert.rejects(f.apply(preview), /Exact reviewed/)
    const next = await f.inspect()
    await assert.rejects(f.apply(next, { current: () => false }))
    assert.equal(existsSync(join(f.root, episodeMutex)), true)
    assert.equal(lstatSync(r.target).nlink, 2)
    assert.deepEqual(readFileSync(r.target), r.raw)
  } finally {
    await f.close()
  }
})

test('recovery bounds unknown lock contents and temporary population without deleting any entry', async () => {
  const f = fixture()
  try {
    residue(f.root, 'empty')
    writeFileSync(join(f.root, episodeMutex, 'unknown'), 'unknown', { mode: 0o600 })
    await assert.rejects(f.inspect(), /ambiguous lock/)
    rmSync(join(f.root, episodeMutex, 'unknown'))
    for (let i = 0; i < 257; i++)
      writeFileSync(
        join(f.root, '.episodes', `${episode(`temp-${i}`).id}.json.${randomUUID()}.tmp`),
        'synthetic',
        { mode: 0o600 },
      )
    await assert.rejects(f.inspect(), /capacity/)
    assert.equal(readdirSync(join(f.root, '.episodes')).filter((n) => n.endsWith('.tmp')).length, 258)
  } finally {
    await f.close()
  }
})

test('offline episode recovery does not exempt its own controller when admission is active', async () => {
  const f = fixture()
  try {
    const r = residue(f.root)
    const pending = f.engine.request('observe', { episode: episode('waiting') }, f.context)
    const rejected = assert.rejects(pending)
    await assert.rejects(f.inspect(), /idle offline controller/)
    assert.deepEqual(readFileSync(r.target), r.raw)
    await rejected
    const preview = await f.inspect()
    assert.equal((await f.apply(preview)).phase, 'completed')
  } finally {
    await f.close()
  }
})

for (const ambiguity of ['second-lock', 'rebound-folder', 'new-file'] as const) {
  test(`resuming episode recovery refuses ${ambiguity} without deleting canonical bytes`, async () => {
    const f = fixture()
    try {
      const r = residue(f.root)
      const preview = await f.inspect()
      const work = join(f.root, episodeRecovery)
      await assert.rejects(f.apply(preview, { current: () => !existsSync(join(work, 'lock')) }))
      let target = r.target
      if (ambiguity === 'second-lock') mkdirSync(join(f.root, episodeMutex), { mode: 0o700 })
      if (ambiguity === 'new-file')
        writeFileSync(join(f.root, '.episodes', 'unreviewed-new-file'), 'preserve', { mode: 0o600 })
      if (ambiguity === 'rebound-folder') {
        const old = join(f.root, '.old-synthetic-episodes')
        renameSync(join(f.root, '.episodes'), old)
        mkdirSync(join(f.root, '.episodes'), { mode: 0o700 })
        renameSync(join(old, '.admission-recovery'), work)
        target = join(old, r.target.split('/').at(-1)!)
      }
      await assert.rejects(f.apply(preview, f.context, true), /ambiguous|changed|unknown/)
      assert.deepEqual(readFileSync(target), r.raw)
      assert.equal(existsSync(work), true)
    } finally {
      await f.close()
    }
  })
}

test('an actual separate writer paused at anonymous mkdir is a kernel holder; recovery refuses until it unwinds', async () => {
  const f = fixture()
  const module = new URL('../lib/agent-memory/engine/episode-admission.ts', import.meta.url).href
  const child = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `
    import { withEpisodeAdmission } from ${JSON.stringify(module)}
    try {
      await withEpisodeAdmission(process.argv[1], async ({ physical }) => {
        if (physical.some((p) => p.endsWith('/.admission/owner.json'))) {
          process.stdout.write('held\\n')
          await new Promise((resolve) => { process.stdin.once('end', resolve); process.stdin.resume() })
          throw Error('controlled synthetic unwind')
        }
      }, async () => { throw Error('body must not start') })
    } catch { /* Explicit stdin release unwinds; no PID signals or live data. */ }
  `,
      f.root,
    ],
    { env: engineEnvironment(), stdio: ['pipe', 'pipe', 'ignore'] },
  )
  const exited = once(child, 'close')
  try {
    const ready = once(child.stdout, 'data')
    const [output] = await ready
    assert.equal(output.toString(), 'held\n')
    assert.equal(existsSync(join(f.root, episodeMutex, 'owner.json')), false)
    await assert.rejects(f.inspect(), /Unexpected kernel Root holder/)
    assert.equal(existsSync(join(f.root, episodeMutex)), true)
    child.stdin.end()
    assert.equal((await exited)[0], 0)
    const preview = await f.inspect()
    assert.equal((await f.apply(preview)).phase, 'completed')
    assert.deepEqual(await f.observe(episode('after-actual-unwind')), { recorded: true })
  } finally {
    child.stdin.end()
    await exited
    await f.close()
  }
})
