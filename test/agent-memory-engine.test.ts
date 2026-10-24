import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import {
  chmodSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { parseOperation } from '../lib/agent-memory/engine/operation.ts'
import { MemoryEngineController, type OperationContext } from '../lib/agent-memory/engine/controller.ts'
import {
  engineEnvironment,
  gitBlobBatches,
  gitBlobLimits,
  parseGitBlobs,
  type Check,
} from '../lib/agent-memory/engine/io.ts'
import { MemoryDataEngine } from '../lib/agent-memory/engine/data.ts'
import { encode, Frames, transportLimits, type Plan } from '../lib/agent-memory/engine/protocol.ts'
import { MemoryPublisher } from '../lib/agent-memory/engine/publisher.ts'
import { allowedPath as newPath, parseConfig as newConfig } from '../lib/agent-memory/engine/schema.ts'
import { allowedPath, createMemoryStore, parseConfig, type MemoryConfig } from '../lib/agent-memory/store.ts'
import { digest } from '../lib/continuity/records.ts'
import type { Episode } from '../lib/agent-memory/store.ts'
import { parseMemoryRead, retrieveMemory } from '../lib/agent-memory/retrieval.ts'

// Fixture owns the complete process env while active (tests in this file are serial).
// No inherited Git discovery/config/index/identity and no ancestor repository commits.
function fixture(count = 12) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-engine-'))
  const home = join(dir, 'home')
  const root = join(dir, 'memory')
  const project = join(dir, 'project')
  mkdirSync(home, { mode: 0o700 })
  mkdirSync(project, { mode: 0o700 })
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n name = Synthetic Fixture\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
    { mode: 0o600 },
  )
  const previous = { ...process.env }
  for (const key of Object.keys(process.env))
    if (key.startsWith('GIT_') || key === 'HOME' || key.startsWith('PI_') || key.includes('API_KEY'))
      delete process.env[key]
  Object.assign(process.env, {
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: dir,
    GIT_TERMINAL_PROMPT: '0',
  })
  const config: MemoryConfig = {
    version: 1,
    automatic: false,
    coreBytes: 8192,
    indexBytes: 2048,
    fileBytes: 262144,
    totalBytes: 8388608,
    projects: [{ cwd: project, id: 'project' }],
  }
  const store = createMemoryStore(root, () => {}, 'primary')
  store.initialize(config, '# Core\nSynthetic identity.\n')
  if (count) {
    const view = store.createView('project', 120000, true)
    for (let i = 0; i < count; i++)
      store.edit(
        view,
        `global/file-${i}.md`,
        null,
        `# Subject ${i}\nSynthetic body ${'data '.repeat(20)}\n`,
        ['source-one'],
      )
    store.integrate(view)
  }
  const env = engineEnvironment(process.env)
  const engine = new MemoryEngineController(root, env)
  const context: OperationContext = { current: () => true }
  const git = (...args: string[]) =>
    execFileSync('git', ['--no-pager', ...args], {
      cwd: root,
      env: {
        ...env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
        GIT_CEILING_DIRECTORIES: dir,
      },
      encoding: 'utf8',
    }).trim()
  return {
    dir,
    root,
    home,
    config,
    store,
    engine,
    env,
    context,
    git,
    async close() {
      const pid = engine.pid
      const exit = await engine.close()
      if (pid) assert.throws(() => process.kill(pid, 0), /ESRCH/, 'owned engine naturally absent')
      assert.equal(exit.code, 0)
      assert.equal(exit.signal, null)
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
function legacyText(
  store: ReturnType<typeof createMemoryStore>,
  view: Parameters<ReturnType<typeof createMemoryStore>['read']>[0],
  path: string,
) {
  const result = store.read(view, path)
  assert.ok('text' in result)
  return result.text
}
async function ready(f: ReturnType<typeof fixture>, view: string) {
  await f.engine.request('ready', { view }, f.context)
  const result = await f.engine.request('prepare', { view, reviewed: [] }, f.context)
  assert.ok('plan' in result)
  return result.plan
}
async function read(f: ReturnType<typeof fixture>, view: string, path = 'Core.md') {
  return await f.engine.request('read', { view, selection: { path } }, f.context)
}

function blobFrame(body: Buffer, algorithm = 'sha1') {
  const oid = createHash(algorithm).update(`blob ${body.length}\0`).update(body).digest('hex')
  return {
    oid,
    size: body.length,
    raw: Buffer.concat([Buffer.from(`${oid} blob ${body.length}\n`), body, Buffer.from('\n')]),
  }
}

test('cold Git batch framing is byte-exact, ordered, hashed and strict UTF-8 with fixed bounds', () => {
  const a = blobFrame(Buffer.from('# First 😀\u2028\u2029\n'))
  const b = blobFrame(Buffer.from('\ufeff# BOM retained\n'), 'sha256')
  const raw = Buffer.concat([a.raw, b.raw, a.raw])
  assert.deepEqual(parseGitBlobs(raw, [a, b, a]), [
    '# First 😀\u2028\u2029\n',
    '\ufeff# BOM retained\n',
    '# First 😀\u2028\u2029\n',
  ])
  const empty = blobFrame(Buffer.alloc(0))
  const crlf = blobFrame(Buffer.from('# CRLF\r\nSecond\r\n'))
  assert.deepEqual(gitBlobBatches([]), [], 'cache-hit/no-cold entries never schedule a native batch')
  assert.deepEqual(
    gitBlobBatches(Array(33).fill(empty)).map((batch) => batch.length),
    [32, 1],
  )
  assert.deepEqual(
    parseGitBlobs(Buffer.concat(Array(32).fill(empty.raw)), Array(32).fill(empty)),
    Array(32).fill(''),
  )
  assert.deepEqual(parseGitBlobs(crlf.raw, [crlf]), ['# CRLF\r\nSecond\r\n'])
  const header = `${a.oid} blob ${a.size}\n`
  for (const broken of [
    Buffer.from(`${a.oid} missing\n`),
    Buffer.from(a.raw.toString().replace(' blob ', ' tree ')),
    Buffer.from(a.raw.toString().replace(a.oid, '0'.repeat(40))),
    Buffer.from(a.raw.toString().replace(` ${a.size}\n`, ` ${a.size + 1}\n`)),
    Buffer.from(a.raw.toString().replace(` ${a.size}\n`, ` 0${a.size}\n`)),
    Buffer.from(`${a.oid} blob 9007199254740992\n`),
    a.raw.subarray(0, header.length - 1),
    a.raw.subarray(0, header.length + a.size - 1),
    a.raw.subarray(0, -1),
    Buffer.concat([a.raw.subarray(0, -1), Buffer.from('x')]),
    Buffer.concat([a.raw, Buffer.from('\n')]),
    Buffer.concat([a.raw, a.raw]),
    Buffer.concat([b.raw, a.raw]),
  ])
    assert.throws(() => parseGitBlobs(broken, [a]), /certification/i)
  const corrupt = Buffer.from(a.raw)
  corrupt[header.length + 2] ^= 1
  assert.throws(() => parseGitBlobs(corrupt, [a]), /hash/)
  assert.throws(() => parseGitBlobs(a.raw, [a, b]), /header/)
  for (const bytes of [
    [0xc0, 0xaf, 10],
    [0xed, 0xa0, 0x80, 10],
    [0xf0, 0x9f, 10],
  ]) {
    const invalid = blobFrame(Buffer.from(bytes))
    assert.throws(() => parseGitBlobs(invalid.raw, [invalid]), /encoded data/)
  }
  const max = blobFrame(Buffer.alloc(262144, 97))
  assert.equal(gitBlobLimits.entries, 32)
  assert.equal(gitBlobLimits.bytes, 1048576)
  assert.deepEqual(
    gitBlobBatches(Array(33).fill(a)).map((batch) => batch.length),
    [32, 1],
  )
  assert.deepEqual(
    gitBlobBatches([...Array(4).fill(max), a]).map((batch) => batch.length),
    [4, 1],
  )
  assert.equal(parseGitBlobs(Buffer.concat(Array(4).fill(max.raw)), Array(4).fill(max)).length, 4)
  assert.throws(() => parseGitBlobs(Buffer.alloc(0), Array(33).fill(a)), /bound/)
  assert.throws(() => parseGitBlobs(Buffer.alloc(0), [...Array(4).fill(max), a]), /bound/)
  assert.throws(() => parseGitBlobs(Buffer.alloc(2 * 1024 * 1024 + 1), [a]), /bound/)
  assert.throws(() => parseGitBlobs(Buffer.alloc(0), []), /bound/)
  for (const entry of [
    { ...a, oid: a.oid.slice(1) },
    { ...a, size: -1 },
    { ...a, size: NaN },
    { ...a, size: 262145 },
    { ...a, size: Number.MAX_SAFE_INTEGER + 1 },
  ])
    assert.throws(() => gitBlobBatches([entry]), /Invalid/)
})

test('cold 286 paths use nine native batches with all-member physical checkpoints; warm certification is body-free', async () => {
  const f = fixture(284)
  try {
    const trace = join(f.dir, 'git-trace.jsonl')
    const engine = new MemoryDataEngine(f.root, { ...f.env, GIT_TRACE2_EVENT: trace })
    const groups = new Map<string, Set<string>>()
    const check: Check = async ({ kind, physical, logical }) => {
      if (kind !== 'git' || logical.length < 2) return
      assert.ok(logical.length <= 32)
      const key = JSON.stringify(logical)
      const seen = groups.get(key) ?? new Set<string>()
      for (const path of physical) seen.add(path)
      groups.set(key, seen)
    }
    const signal = new AbortController().signal
    const page = await engine.execute(
      'headRead',
      { project: 'project', shared: true, selection: { path: 'Core.md' } },
      check,
      signal,
    )
    assert.equal(page.text, '# Core\nSynthetic identity.\n')
    const cold = await engine.execute('stats', {}, check, signal)
    const starts = () =>
      readFileSync(trace, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((event) => event.event === 'start')
    assert.equal(starts().filter((event) => event.argv.slice(-2).join(' ') === 'cat-file --batch').length, 9)
    assert.equal(
      starts().filter((event) => event.argv.includes('cat-file') && event.argv.includes('blob')).length,
      1,
      'only selected body uses individual cat-file',
    )
    assert.equal(groups.size, 9)
    assert.equal(
      [...groups.keys()].reduce((n, key) => n + JSON.parse(key).length, 0),
      286,
    )
    const objectDirectory = join(f.root, '.git/objects')
    const objects = readdirSync(objectDirectory)
      .filter((name) => /^[a-f0-9]{2}$/.test(name))
      .flatMap((name) =>
        readdirSync(join(objectDirectory, name)).map((file) => join(objectDirectory, name, file)),
      )
    for (const targets of groups.values()) {
      assert.ok(targets.has(join(f.root, '.git/config')))
      for (const object of objects)
        assert.ok(
          targets.has(object),
          'every batch freshly checks every physical Git object with all logical members',
        )
    }
    assert.equal(cold.certifications, 286)
    assert.equal(Object.keys(cold.blobReads).length, 286)
    assert.equal(cold.gitCalls, 14)
    await engine.execute(
      'headRead',
      { project: 'project', shared: true, selection: { path: 'Core.md' } },
      check,
      signal,
    )
    const warm = await engine.execute('stats', {}, check, signal)
    assert.equal(warm.gitCalls - cold.gitCalls, 5)
    assert.equal(warm.certifications, cold.certifications)
    for (const [path, count] of Object.entries(cold.blobReads))
      assert.equal(warm.blobReads[path], count + (path === 'Core.md' ? 1 : 0))
    assert.equal(starts().filter((event) => event.argv.slice(-2).join(' ') === 'cat-file --batch').length, 9)
  } finally {
    await f.close()
  }
})

test('cold loose and packed repeated OIDs remain separate per-path certificates and source checks', async () => {
  const f = fixture(0)
  try {
    const view = f.store.createView('project', 120000, true)
    for (let i = 0; i < 34; i++)
      f.store.edit(view, `global/repeated-${i}.md`, null, '# Identical 😀\n', [`source-${i}`])
    f.store.integrate(view)
    for (const packed of [false, true]) {
      if (packed) f.git('gc', '--prune=now')
      const engine = new MemoryDataEngine(f.root, f.env)
      const signal = new AbortController().signal
      const check: Check = async () => {}
      const result = await engine.execute(
        'headRead',
        { project: 'project', shared: true, selection: { path: 'global/repeated-33.md' } },
        check,
        signal,
      )
      assert.equal(result.hash, digest('# Identical 😀\n'))
      assert.deepEqual(result.sources, ['source-33'])
      const stats = await engine.execute('stats', {}, check, signal)
      assert.equal(stats.certifications, 36)
      assert.equal(Object.keys(stats.blobReads).length, 36)
      assert.equal(stats.gitCalls, 7)
      const other = await engine.execute(
        'headRead',
        { project: 'project', shared: true, selection: { path: 'global/repeated-0.md' } },
        check,
        signal,
      )
      assert.deepEqual(other.sources, ['source-0'], 'identical cached OID does not share per-path sources')
      await assert.rejects(
        engine.execute(
          'headRead',
          { project: 'project', shared: true, selection: { path: 'Core.md' } },
          async ({ logical }) => {
            if (logical.includes('global/repeated-17.md')) throw Error('Intended cached-path denial')
          },
          signal,
        ),
        /cached-path denial/,
      )
      const warm = await engine.execute('stats', {}, check, signal)
      assert.equal(warm.certifications, 36)
      assert.equal(
        warm.gitCalls - stats.gitCalls,
        8,
        'warm read plus denied warm read tree metadata only; no batch spawn',
      )
    }
  } finally {
    await f.close()
  }
})

test('inter-batch logical and individual physical revocation stop before next native batch or exposure', async () => {
  const f = fixture(65)
  try {
    const objectDir = readdirSync(join(f.root, '.git/objects')).find((name) => /^[a-f0-9]{2}$/.test(name))!
    const physicalTarget = join(
      f.root,
      '.git/objects',
      objectDir,
      readdirSync(join(f.root, '.git/objects', objectDir))[0],
    )
    for (const target of [0, 15, 31, 'physical'] as const) {
      const engine = new MemoryDataEngine(f.root, f.env)
      let first = ''
      let second = ''
      let denied = false
      let revoked = false
      const check: Check = async ({ kind, logical, physical }) => {
        if (kind !== 'git' || logical.length < 2) return
        const key = JSON.stringify(logical)
        first ||= key
        if (key === first) return
        second ||= key
        assert.equal(key, second, 'no later batch reached')
        if (!revoked) {
          await delay(0)
          revoked = true
        }
        if (
          target === 'physical'
            ? physical.includes(physicalTarget)
            : logical.includes(JSON.parse(second)[target])
        ) {
          denied = true
          throw Error('Intended unit revocation')
        }
      }
      await assert.rejects(
        engine.execute(
          'headRead',
          { project: 'project', shared: true, selection: { path: 'Core.md' } },
          check,
          new AbortController().signal,
        ),
        /Intended unit revocation/,
      )
      assert.equal(denied, true)
      const stats = await engine.execute('stats', {}, async () => {}, new AbortController().signal)
      assert.equal(stats.certifications, 32)
      assert.equal(stats.gitCalls, 4, 'second native cat-file never started after denial')
    }
  } finally {
    await f.close()
  }
})

test('cold read final config, HEAD and current-authority barriers remain effective', async () => {
  const f = fixture(33)
  try {
    for (const mutation of ['config', 'HEAD', 'authority']) {
      const engine = new MemoryDataEngine(f.root, f.env)
      let batches = new Set<string>()
      let selected = false
      let changed = false
      const configPath = join(f.root, 'config.json')
      const originalConfig = readFileSync(configPath, 'utf8')
      const check: Check = async ({ kind, logical }) => {
        if (kind === 'git' && logical.length > 1) batches.add(JSON.stringify(logical))
        if (batches.size === 2 && kind === 'git' && logical.length === 1 && logical[0] === 'Core.md')
          selected = true
        if (selected && !changed) {
          await delay(0)
          changed = true
          if (mutation === 'config')
            writeFileSync(configPath, JSON.stringify({ ...JSON.parse(originalConfig), automatic: true }))
          else if (mutation === 'HEAD') f.git('commit', '--allow-empty', '-m', 'Synthetic final HEAD change')
          else throw Error('Intended current-authority revocation')
        }
      }
      try {
        await assert.rejects(
          engine.execute(
            'headRead',
            { project: 'project', shared: true, selection: { path: 'Core.md' } },
            check,
            new AbortController().signal,
          ),
          /current revision changed|current-authority revocation/,
        )
        assert.equal(changed, true)
      } finally {
        writeFileSync(configPath, originalConfig)
      }
    }
  } finally {
    await f.close()
  }
})

test('bounded LF protocol preserves Unicode separators and rejects oversized framing', () => {
  const messages: unknown[] = []
  const frames = new Frames(100, (message) => messages.push(message))
  const text = 'a\u2028b\u2029😀'
  const raw = encode({ text }, 100)
  for (const byte of raw) frames.push(Buffer.from([byte]))
  assert.deepEqual(messages, [{ text }])
  assert.throws(() => new Frames(5, () => {}).push(Buffer.from('123456')), /bound/)
  assert.throws(() => encode({ text: 'x'.repeat(100) }, 10), /bound/)
  const env = engineEnvironment({
    HOME: '/synthetic',
    PATH: '/bin',
    OPENAI_API_KEY: 'not-real',
    PI_AGENT_DIR: '/forbidden',
    GIT_INDEX_FILE: '/forbidden',
  })
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.PI_AGENT_DIR, undefined)
  assert.equal(env.GIT_INDEX_FILE, undefined)
})

test('cold certification then single-file read/edit/publication does zero unchanged body I/O; old schema remains readable', async () => {
  const f = fixture(24)
  try {
    assert.equal(f.engine.pid, undefined, 'construction is inert')
    const legacy = f.store.createView('project')
    const initial = await f.engine.request('create', { project: 'project', shared: true }, f.context)
    const cold = await f.engine.request('stats', {}, f.context)
    assert.equal(cold.certifications, 26)
    const beforeModes = Object.fromEntries(
      Array.from({ length: 24 }, (_, i) => {
        const path = `global/file-${i}.md`
        const s = lstatSync(join(f.root, path))
        return [path, `${s.ino}:${s.mtimeMs}:${s.ctimeMs}`]
      }),
    )
    const page = await read(f, initial.view, 'global/file-0.md')
    assert.equal(page.hash, digest(legacyText(f.store, legacy, 'global/file-0.md')))
    const text = '# Changed\nTyped engine 😀\u2028next\u2029line\n'
    await f.engine.request(
      'edit',
      {
        view: initial.view,
        path: 'global/file-0.md',
        expectedHash: page.hash as string,
        text,
        sources: ['source-one'],
      },
      f.context,
    )
    const plan = await ready(f, initial.view)
    assert.deepEqual(
      plan.changes.map((c) => c.path),
      ['global/file-0.md'],
    )
    assert.ok(Object.isFrozen(plan))
    const result = await new MemoryPublisher(f.engine, f.env).publish(plan, f.context)
    assert.equal(result.stage, 'reconciled_committed')
    assert.equal(result.commitStarted, true)
    assert.equal(result.lockRetained, false)
    assert.equal(f.git('log', '-1', '--format=%an <%ae>'), 'Synthetic Fixture <fixture@example.invalid>')
    const stats = await f.engine.request('stats', {}, f.context)
    for (let i = 1; i < 24; i++) {
      const path = `global/file-${i}.md`
      assert.equal(stats.blobReads[path], cold.blobReads[path], `no unchanged blob reread: ${path}`)
      assert.equal(stats.overlayReads[path], undefined)
      assert.equal(stats.overlayWrites[path], undefined)
      const s = lstatSync(join(f.root, path))
      assert.equal(`${s.ino}:${s.mtimeMs}:${s.ctimeMs}`, beforeModes[path], `no unchanged rewrite: ${path}`)
    }
    assert.equal(stats.overlayWrites['global/file-0.md'], 1)
    assert.equal(f.store.snapshot().files['global/file-0.md'].text, text)
    assert.equal(
      legacyText(f.store, legacy, 'global/file-0.md'),
      page.text,
      'legacy snapshot/proposal retained',
    )
    assert.ok(existsSync(join(f.root, '.views', '.engine-v2', 'drafts', `${initial.view}.json`)))
    assert.ok(!readdirSync(join(f.root, '.views')).some((name) => name === `${initial.view}.json`))
    const old = f.store.createView('project')
    assert.equal(legacyText(f.store, old, 'global/file-0.md'), text)
    for (const path of [join(f.root, '.views', '.engine-v2'), join(f.root, '.views', '.engine-v2', 'blobs')])
      assert.equal(lstatSync(path).mode & 0o077, 0)
  } finally {
    await f.close()
  }
})

test('maximum changed file streams bounded chunks; no-op publication makes no Git commit', async () => {
  const f = fixture(0)
  try {
    const { view } = await f.engine.request('create', { project: 'project' }, f.context)
    const text = `${'😀'.repeat(65535)}abc\n`
    assert.equal(Buffer.byteLength(text), 262144)
    await f.engine.request(
      'edit',
      { view, path: 'global/large.md', expectedHash: null, text, sources: [] },
      f.context,
    )
    const plan = await ready(f, view)
    let offset = 0
    const chunks: Buffer[] = []
    while (offset < Buffer.byteLength(text)) {
      const reply = await f.engine.request(
        'chunk',
        { plan: plan.id, digest: plan.digest, path: 'global/large.md', offset },
        f.context,
      )
      assert.ok(Buffer.byteLength(JSON.stringify(reply)) < transportLimits.reply)
      const data = Buffer.from(reply.data, 'base64')
      assert.ok(data.length <= transportLimits.chunk)
      chunks.push(data)
      offset += data.length
    }
    assert.equal(Buffer.concat(chunks).toString(), text)
    assert.equal(
      (await new MemoryPublisher(f.engine, f.env).publish(plan, f.context)).stage,
      'reconciled_committed',
    )
    const next = await f.engine.request('create', { project: 'project' }, f.context)
    const noOp = await ready(f, next.view)
    assert.equal(noOp.changes.length, 0)
    const before = f.git('rev-parse', 'HEAD')
    const result = await new MemoryPublisher(f.engine, f.env).publish(noOp, f.context)
    assert.equal(result.commitStarted, false)
    assert.equal(result.stage, 'reconciled_committed')
    assert.equal(f.git('rev-parse', 'HEAD'), before)
  } finally {
    await f.close()
  }
})

test('CAS, disjoint merge and overlapping conflict retain proposals; query/paging match legacy lexical owner', async () => {
  const f = fixture(3)
  try {
    const a = await f.engine.request('create', { project: 'project' }, f.context)
    const b = await f.engine.request('create', { project: 'project' }, f.context)
    const c = await f.engine.request('create', { project: 'project' }, f.context)
    const original = await read(f, a.view, 'global/file-0.md')
    await assert.rejects(
      f.engine.request(
        'edit',
        { view: a.view, path: 'global/file-0.md', expectedHash: null, text: '# Wrong\n', sources: [] },
        f.context,
      ),
      /Stale/,
    )
    for (const [view, path, text] of [
      [a.view, 'global/file-0.md', '# Winner\n'],
      [b.view, 'global/file-1.md', '# Disjoint\n'],
      [c.view, 'global/file-0.md', '# Retained conflict\n'],
    ]) {
      const page = await read(f, view, path)
      await f.engine.request(
        'edit',
        { view, path, expectedHash: page.hash as string, text, sources: [] },
        f.context,
      )
    }
    const publisher = new MemoryPublisher(f.engine, f.env)
    assert.equal((await publisher.publish(await ready(f, a.view), f.context)).stage, 'reconciled_committed')
    const stale = await read(f, b.view, 'global/file-0.md')
    assert.equal(stale.freshness, 'stale')
    assert.equal(stale.hash, original.hash)
    assert.equal((await publisher.publish(await ready(f, b.view), f.context)).stage, 'reconciled_committed')
    await f.engine.request('ready', { view: c.view }, f.context)
    assert.deepEqual(await f.engine.request('prepare', { view: c.view, reviewed: [] }, f.context), {
      conflict: ['global/file-0.md'],
    })
    const fresh = await f.engine.request('create', { project: 'project' }, f.context)
    const topic = await f.engine.request(
      'read',
      { view: fresh.view, selection: { topic: '*', limit: 2 } },
      f.context,
    )
    assert.ok('nextOffset' in topic)
    assert.equal(topic.nextOffset, 2)
    const result = await f.engine.request(
      'read',
      { view: fresh.view, selection: { query: 'winner', limit: 1 } },
      f.context,
    )
    assert.ok('results' in result)
    assert.deepEqual(
      (result.results as { path: string }[]).map((item) => item.path),
      ['global/file-0.md'],
    )
    const page = await f.engine.request(
      'read',
      { view: fresh.view, selection: { path: 'Core.md', offset: 2, limit: 5 } },
      f.context,
    )
    assert.equal(page.text, [...f.store.snapshot().files['Core.md'].text].slice(2, 7).join(''))
    await assert.rejects(
      f.engine.request('read', { view: fresh.view, selection: { query: 'x'.repeat(257) } }, f.context),
      /query/,
    )
  } finally {
    await f.close()
  }
})

test('logical path denies gate entire view; overlays/manifest corruption and forgotten sources fail closed', async () => {
  const f = fixture(2)
  try {
    const { view } = await f.engine.request('create', { project: 'project' }, f.context)
    const denied: OperationContext = { current: (targets) => !targets.logical.includes('global/file-1.md') }
    await assert.rejects(
      f.engine.request(
        'headRead',
        { project: 'project', shared: true, selection: { path: 'Core.md' } },
        denied,
      ),
      /authority/,
    )
    await assert.rejects(
      f.engine.request('read', { view, selection: { path: 'Core.md' } }, denied),
      /authority/,
    )
    const core = await read(f, view)
    await f.engine.request(
      'edit',
      { view, path: 'Core.md', expectedHash: core.hash as string, text: '# Modified\n', sources: [] },
      f.context,
    )
    const blobs = join(f.root, '.views', '.engine-v2', 'blobs')
    const blob = join(blobs, readdirSync(blobs)[0])
    writeFileSync(blob, '# Tampered\n')
    await assert.rejects(read(f, view), /identity|integrity/)
    const second = await f.engine.request('create', { project: 'project' }, f.context)
    const manifest = join(f.root, '.views', '.engine-v2', 'drafts', `${second.view}.json`)
    writeFileSync(manifest, '{}')
    await assert.rejects(read(f, second.view), /manifest/)
    const third = await f.engine.request('create', { project: 'project' }, f.context)
    f.store.forget(f.store.snapshot().revision, [], ['source-one'], 'project')
    await assert.rejects(read(f, third.view), /forgetting/)
  } finally {
    await f.close()
  }
})

test('queue overload, queued/active cancellation, strict boolean and stale reply never expose text', async () => {
  const f = fixture(20)
  try {
    await assert.rejects(
      f.engine.request('config', {}, { current: () => Promise.resolve(true) as unknown as boolean }),
      /strict boolean/,
    )
    assert.equal(f.engine.pid, undefined)
    const abort = new AbortController()
    const creating = f.engine.request(
      'create',
      { project: 'project' },
      { current: () => true, signal: abort.signal },
    )
    const queueAbort = new AbortController()
    const queued = f.engine.request('config', {}, { current: () => true, signal: queueAbort.signal })
    const rejection = assert.rejects(queued, /cancelled/)
    queueAbort.abort()
    await rejection
    const jobs = Array.from({ length: 15 }, () => f.engine.request('config', {}, f.context))
    await assert.rejects(f.engine.request('config', {}, f.context), /overload/)
    const activeRejection = assert.rejects(creating, /cancel|abort/i)
    abort.abort()
    await activeRejection
    await Promise.all(jobs)
    const { view } = await f.engine.request('create', { project: 'project' }, f.context)
    let live = true
    const pending = f.engine.request(
      'read',
      { view, selection: { path: 'Core.md' } },
      { current: () => live },
    )
    live = false
    await assert.rejects(pending, /authority/)
    assert.equal((await read(f, view)).text, '# Core\nSynthetic identity.\n')
  } finally {
    await f.close()
  }
})

test('normal hook failure retains dirty index/proposal and committed HEAD; later publication cannot silently recover', async () => {
  const f = fixture(0)
  try {
    const { view } = await f.engine.request('create', { project: 'project' }, f.context)
    const core = await read(f, view)
    await f.engine.request(
      'edit',
      { view, path: 'Core.md', expectedHash: core.hash as string, text: '# Proposal\n', sources: [] },
      f.context,
    )
    const plan = await ready(f, view)
    const hook = join(f.root, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o700 })
    chmodSync(hook, 0o700)
    const before = f.git('rev-parse', 'HEAD')
    const result = await new MemoryPublisher(f.engine, f.env).publish(plan, f.context)
    assert.equal(result.stage, 'not_committed_dirty')
    assert.equal(result.mutated, true)
    assert.equal(result.commitStarted, true)
    assert.equal(f.git('rev-parse', 'HEAD'), before)
    assert.match(f.git('status', '--porcelain', '--untracked-files=no'), /Core.md/)
    assert.equal(f.store.projection('project').core, '# Core\nSynthetic identity.\n')
    assert.equal(readFileSync(join(f.root, 'Core.md'), 'utf8'), '# Proposal\n')
    assert.ok(existsSync(join(f.root, '.views', '.engine-v2', 'drafts', `${view}.json`)))
    await assert.rejects(f.engine.request('prepare', { view, reviewed: [] }, f.context), /Uncommitted/)
  } finally {
    await f.close()
  }
})

test('revocation at exact canonical native start leaves unknown, never a buffered publish grant; forged plan rejected', async () => {
  const f = fixture(0)
  try {
    const { view } = await f.engine.request('create', { project: 'project' }, f.context)
    const core = await read(f, view)
    await f.engine.request(
      'edit',
      { view, path: 'Core.md', expectedHash: core.hash as string, text: '# Proposal\n', sources: [] },
      f.context,
    )
    const plan = await ready(f, view)
    const publisher = new MemoryPublisher(f.engine, f.env)
    await assert.rejects(publisher.publish({ ...plan } as Plan, f.context), /Parent-owned/)
    let live = true
    const context: OperationContext = {
      current: (targets) => {
        if (targets.physical.some((path) => path.includes('.memory-engine-'))) live = false
        return live
      },
    }
    const before = f.git('rev-parse', 'HEAD')
    const result = await publisher.publish(plan, context)
    assert.equal(result.stage, 'unknown')
    assert.equal(result.commitStarted, false)
    assert.equal(result.lockRetained, true)
    assert.equal(f.git('rev-parse', 'HEAD'), before)
    assert.equal(readFileSync(join(f.root, 'Core.md'), 'utf8'), '# Core\nSynthetic identity.\n')
    assert.ok(existsSync(join(f.root, '.lock')))
    assert.equal(readdirSync(f.root).filter((name) => name.includes('.memory-engine-')).length, 0)
  } finally {
    await f.close()
  }
})

test('management forgetting and rollback match old snapshot oracle without schema/config changes or resurrection', async () => {
  const f = fixture(3)
  const oracle = fixture(3)
  const comparable = (s: ReturnType<typeof f.store.snapshot>) => ({
    files: s.files,
    forgottenPaths: s.forgottenPaths,
    forgottenSources: s.forgottenSources,
    reviewed: s.reviewed,
  })
  try {
    for (const owner of [f, oracle]) {
      const view = owner.store.createView('project', 120000, true)
      owner.store.edit(view, 'deferred/other/keep.md', null, '# Other project knowledge\n', ['source-one'])
      owner.store.integrate(view)
    }
    const initial = f.store.snapshot().revision
    const oldInitial = oracle.store.snapshot().revision
    const configBytes = readFileSync(join(f.root, 'config.json'))
    const expected = oracle.store.forget(oldInitial, [], ['source-one'], 'project')
    const prepared = await f.engine.request(
      'manage',
      { action: 'forget', project: 'project', revision: initial, paths: [], sources: ['source-one'] },
      f.context,
    )
    assert.equal(
      (await new MemoryPublisher(f.engine, f.env).publish(prepared.plan, f.context)).stage,
      'reconciled_committed',
    )
    assert.deepEqual(comparable(f.store.snapshot()), comparable(expected))
    assert.equal(JSON.parse(f.git('show', 'HEAD:.memory.json')).version, 2)
    assert.ok(
      f.store.snapshot().files['deferred/other/keep.md'],
      'source forgetting never tombstones a foreign project',
    )
    const scoped = await f.engine.request('create', { project: 'project' }, f.context)
    await assert.rejects(read(f, scoped.view, 'deferred/other/keep.md'), /outside scope/)
    assert.deepEqual(readFileSync(join(f.root, 'config.json')), configBytes)
    const oldRollback = oracle.store.rollback(expected.revision, oldInitial, 'project')
    const rollback = await f.engine.request(
      'manage',
      { action: 'rollback', project: 'project', revision: f.store.snapshot().revision, target: initial },
      f.context,
    )
    assert.equal(
      (await new MemoryPublisher(f.engine, f.env).publish(rollback.plan, f.context)).stage,
      'reconciled_committed',
    )
    assert.deepEqual(comparable(f.store.snapshot()), comparable(oldRollback))
    assert.ok(!f.store.snapshot().files['global/file-0.md'], 'rollback cannot revive source-forgotten files')
    await assert.rejects(
      f.engine.request(
        'manage',
        { action: 'forget', project: 'project', revision: initial, paths: ['global/file-0.md'], sources: [] },
        f.context,
      ),
      /Stale/,
    )
    await assert.rejects(
      f.engine.request(
        'manage',
        {
          action: 'forget',
          project: 'project',
          revision: f.store.snapshot().revision,
          paths: ['Core.md'],
          sources: [],
        },
        f.context,
      ),
      /scope/,
    )
    const view = await f.engine.request('create', { project: 'project' }, f.context)
    await f.engine.request('cancel', { view: view.view }, f.context)
    await assert.rejects(read(f, view.view), /inactive/)
  } finally {
    await oracle.close()
    await f.close()
  }
})

test('retained v2 and legacy conflicts recover after restart with code-point pages, tombstones and byte-preserved legacy files', async () => {
  const f = fixture(1)
  let restarted: MemoryEngineController | undefined
  try {
    const legacy = f.store.createView('project')
    const base = f.store.snapshot().revision
    f.store.edit(
      legacy,
      'global/file-0.md',
      digest(legacy.files['global/file-0.md'].text),
      '# Legacy 😀 proposal\n',
      ['source-one'],
    )
    const proposal = await f.engine.request('create', { project: 'project' }, f.context)
    const original = await read(f, proposal.view, 'global/file-0.md')
    await f.engine.request(
      'edit',
      {
        view: proposal.view,
        path: 'global/file-0.md',
        expectedHash: original.hash as string,
        text: '# New 😀 proposal\n',
        sources: ['source-one'],
      },
      f.context,
    )
    const winner = f.store.createView('project')
    f.store.edit(winner, 'global/file-0.md', digest(winner.files['global/file-0.md'].text), '# Winner\n', [])
    f.store.integrate(winner)
    assert.ok('conflict' in f.store.integrate(legacy))
    await f.engine.request('ready', { view: proposal.view }, f.context)
    assert.ok(
      'conflict' in (await f.engine.request('prepare', { view: proposal.view, reviewed: [] }, f.context)),
    )
    const legacyPath = join(f.root, '.views', `${legacy.id}.json`)
    const legacyBytes = readFileSync(legacyPath)
    const pid = f.engine.pid
    assert.equal((await f.engine.close()).code, 0)
    assert.throws(() => process.kill(pid!, 0), /ESRCH/)
    restarted = new MemoryEngineController(f.root, f.env)
    const list = await restarted.request('conflicts', { project: 'project' }, f.context)
    assert.equal(list.total, 2)
    const oldPage = f.store.conflicts('project', legacy.id, 'global/file-0.md', 8, 3)
    assert.deepEqual(
      await restarted.request(
        'conflicts',
        { project: 'project', target: legacy.id, path: 'global/file-0.md', offset: 8, limit: 3 },
        f.context,
      ),
      oldPage,
    )
    const page = await restarted.request(
      'conflicts',
      { project: 'project', target: proposal.view, path: 'global/file-0.md', offset: 6, limit: 3 },
      f.context,
    )
    assert.equal(page.text, [...'# New 😀 proposal\n'].slice(6, 9).join(''))
    assert.equal(page.baseRevision, base)
    assert.equal(page.proposalHash, digest('# New 😀 proposal\n'))
    await assert.rejects(
      restarted.request('conflicts', { project: 'other', target: proposal.view }, f.context),
      /Unknown scoped/,
    )
    f.store.forget(f.store.snapshot().revision, [], ['source-one'], 'project')
    assert.deepEqual(
      await restarted.request(
        'conflicts',
        { project: 'project', target: proposal.view, path: 'global/file-0.md' },
        f.context,
      ),
      { id: proposal.view, path: 'global/file-0.md', suppressedByForgetting: true },
    )
    await restarted.request(
      'discard',
      { project: 'project', target: legacy.id, revision: f.store.snapshot().revision },
      f.context,
    )
    assert.deepEqual(readFileSync(legacyPath), legacyBytes)
    assert.equal((await restarted.request('conflicts', { project: 'project' }, f.context)).total, 1)
    const manifest = join(f.root, '.views', '.engine-v2', 'drafts', `${proposal.view}.json`)
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
    const originalManifest = readFileSync(manifest)
    parsed.base.refs['Core.md'].hash = '0'.repeat(64)
    writeFileSync(manifest, JSON.stringify(parsed))
    await assert.rejects(
      restarted.request('conflicts', { project: 'project', target: proposal.view }, f.context),
      /recertified/,
    )
    // Explicitly restore only this test's tamper to probe a separate negative boundary.
    writeFileSync(manifest, originalManifest)
    const unknownJournal = join(
      f.root,
      '.views',
      '.engine-v2',
      'journal',
      '00000000-0000-0000-0000-000000000000.json',
    )
    writeFileSync(unknownJournal, JSON.stringify({ receipt: { stage: 'unknown' } }), { mode: 0o600 })
    await assert.rejects(
      restarted.request(
        'discard',
        { project: 'project', target: proposal.view, revision: f.store.snapshot().revision },
        f.context,
      ),
      /Unreconciled/,
    )
    assert.deepEqual(readFileSync(manifest), originalManifest, 'unknown publication is not discard authority')
    assert.ok(existsSync(unknownJournal), 'unknown mutation record is retained; never evicted or replayed')
  } finally {
    if (restarted) {
      const pid = restarted.pid
      assert.equal((await restarted.close()).code, 0)
      assert.throws(() => process.kill(pid!, 0), /ESRCH/)
    }
    await f.close()
  }
})

test('bounded child episodes match old admission/selection and reviewed metadata-only publication cursor', async () => {
  const f = fixture(0)
  try {
    const episodes: Episode[] = Array.from({ length: 5 }, (_, i) => ({
      id: digest(`episode-${i}`),
      project: 'project',
      session: 'synthetic-session',
      evidence: 'observed-native-unverified',
      observedAt: `2026-01-01T00:00:0${i}.000Z`,
      entryHash: digest(`entry-${i}`),
      input: { text: 'Synthetic bounded input', source: 'rpc' },
      actions: [{ text: 'Verified outcome', tools: ['bash'] }],
      results: [{ tool: 'bash', error: false, text: 'ok' }],
      outcome: 'completed',
    }))
    for (const episode of episodes) {
      f.store.recordEpisode(episode.id, episode)
      assert.deepEqual(await f.engine.request('observe', { episode }, f.context), { recorded: true })
    }
    assert.deepEqual(
      await f.engine.request('episodes', { project: 'project' }, f.context),
      f.store.pendingEpisodes('project'),
    )
    const pending = f.store.pendingEpisodes('project')
    assert.equal(pending.length, 4)
    const { view } = await f.engine.request('create', { project: 'project' }, f.context)
    await f.engine.request('ready', { view }, f.context)
    const prepared = await f.engine.request(
      'prepare',
      { view, reviewed: pending.map((e) => e.id) },
      f.context,
    )
    assert.ok('plan' in prepared)
    assert.deepEqual(
      prepared.plan.changes.map((c) => c.path),
      ['.memory.json'],
    )
    assert.equal(
      (await new MemoryPublisher(f.engine, f.env).publish(prepared.plan, f.context)).stage,
      'reconciled_committed',
    )
    assert.equal(f.store.pendingEpisodes('project').length, 1)
    assert.deepEqual(
      await f.engine.request('episodes', { project: 'project' }, f.context),
      f.store.pendingEpisodes('project'),
    )
    const forgotten = episodes[4]
    f.store.forget(f.store.snapshot().revision, [], [forgotten.id], 'project')
    await assert.rejects(f.engine.request('observe', { episode: forgotten }, f.context), /Forgotten/)
    const invalid = { ...episodes[0], actions: Array.from({ length: 5 }, () => ({ text: 'Too many' })) }
    assert.throws(() => f.store.recordEpisode(invalid.id, invalid), /episode/)
    await assert.rejects(f.engine.request('observe', { episode: invalid }, f.context), /episode/)
    const changed = { ...episodes[0], input: { text: 'Changed', source: 'rpc' } }
    assert.throws(() => f.store.recordEpisode(changed.id, changed), /changed/)
    await assert.rejects(f.engine.request('observe', { episode: changed }, f.context), /changed/)
  } finally {
    await f.close()
  }
})

test('new selective read/query/topic/projection match legacy result semantics including no-op draft basis', async () => {
  const f = fixture(3)
  try {
    const old = f.store.createView('project', 120000, true)
    const { view } = await f.engine.request('create', { project: 'project', shared: true }, f.context)
    const files = old.files
    for (const selection of [
      { topic: '' },
      { topic: '*', offset: 1, limit: 2 },
      { query: 'subject', limit: 1 },
      { query: 'missing' },
    ]) {
      const parsed = parseMemoryRead(selection)
      assert.ok(parsed.mode === 'topic' || parsed.mode === 'query')
      const result = await f.engine.request('read', { view, selection }, f.context)
      const { revision, baseRevision, currentRevision, basis, freshness, ...selected } = result
      assert.deepEqual(selected, retrieveMemory(files, parsed))
    }
    assert.deepEqual(
      await f.engine.request('projection', { project: 'project', shared: true }, f.context),
      f.store.projection('project', true),
    )
    const page = await read(f, view)
    await f.engine.request(
      'edit',
      { view, path: 'Core.md', expectedHash: page.hash as string, text: page.text as string, sources: [] },
      f.context,
    )
    assert.equal((await read(f, view)).basis, 'view-snapshot')
  } finally {
    await f.close()
  }
})

test('hardlinks and loose modes rejected; legacy/default import does not activate child or v2 namespace', async () => {
  const f = fixture(0)
  try {
    assert.equal(existsSync(join(f.root, '.views', '.engine-v2')), false)
    f.store.projection('project')
    assert.equal(f.engine.pid, undefined)
    const alias = join(f.dir, 'alias')
    linkSync(join(f.root, 'config.json'), alias)
    await assert.rejects(f.engine.request('config', {}, f.context), /Linked|Private/)
    rmSync(alias)
    chmodSync(join(f.root, 'config.json'), 0o644)
    await assert.rejects(f.engine.request('config', {}, f.context), /Private/)
    chmodSync(join(f.root, 'config.json'), 0o600)
    assert.deepEqual(newConfig(JSON.stringify(f.config)), parseConfig(JSON.stringify(f.config)))
    for (const path of [
      'Core.md',
      'index.md',
      'global/a.md',
      'procedures/a.md',
      'deferred/project/a.md',
      '../Core.md',
      'global/A.md',
      'global/x/y.md',
    ])
      assert.equal(newPath(path, 'project'), allowedPath(path, 'project'))
  } finally {
    await f.close()
  }
})

async function recoveryPlan(f: ReturnType<typeof fixture>) {
  const { view } = await f.engine.request('create', { project: 'project' }, f.context)
  const core = await read(f, view)
  await f.engine.request(
    'edit',
    { view, path: 'Core.md', expectedHash: core.hash as string, text: '# Durable proposal\n', sources: [] },
    f.context,
  )
  return await ready(f, view)
}
for (const stop of ['prepared', 'worktree_mutating', 'index_staged', 'commit_start_intent']) {
  test(`durable SAME-operation recovery after ${stop} authority loss never replays or grants chunks`, async () => {
    const f = fixture(0)
    let fresh: MemoryEngineController | undefined
    try {
      const plan = await recoveryPlan(f)
      const journal = join(f.root, '.views/.engine-v2/journal', `${plan.id}.json`)
      const proposal = join(f.root, '.views/.engine-v2/drafts', `${plan.view}.json`)
      const proposalBefore = readFileSync(proposal)
      const initial = parseOperation(readFileSync(journal, 'utf8'))
      assert.equal(initial.sequence, 0)
      assert.equal(initial.immutable.plan.digest, plan.digest)
      assert.ok(initial.immutable.tree.length)
      let live = true
      const context: OperationContext = {
        current(targets) {
          if (
            live &&
            targets.physical.includes(join(f.root, 'config.json')) &&
            parseOperation(readFileSync(journal, 'utf8')).receipt.stage === stop
          )
            live = false
          return live
        },
      }
      const before = f.git('rev-parse', 'HEAD')
      const result = await new MemoryPublisher(f.engine, f.env).publish(plan, context)
      assert.equal(result.stage, 'unknown')
      await f.engine.close()
      if (stop === 'prepared') {
        const module = new URL('../lib/agent-memory/engine/controller.ts', import.meta.url).href
        const publisher = new URL('../lib/agent-memory/engine/publisher.ts', import.meta.url).href
        const external = execFileSync(
          process.execPath,
          [
            '--experimental-strip-types',
            '--input-type=module',
            '-e',
            `import { MemoryEngineController } from ${JSON.stringify(module)};
           import { MemoryPublisher } from ${JSON.stringify(publisher)};
           const e = new MemoryEngineController(process.argv[1]);
           try { console.log(JSON.stringify(await new MemoryPublisher(e).reconcileExisting(process.argv[2], process.argv[3], { current: () => true }))) }
           finally { await e.close() }`,
            f.root,
            plan.id,
            plan.digest,
          ],
          { env: f.env, encoding: 'utf8', timeout: 15000 },
        )
        assert.equal(
          JSON.parse(external.trim()).stage,
          'unknown',
          'another process has no trusted executor-drain reference',
        )
      }
      fresh = new MemoryEngineController(f.root, f.env)
      const recovered = await new MemoryPublisher(fresh, f.env).reconcileExisting(
        plan.id,
        plan.digest,
        f.context,
      )
      assert.equal(recovered.stage, 'not_committed_dirty')
      assert.equal(typeof recovered.indexDirty, 'boolean')
      assert.equal(typeof recovered.worktreeDirty, 'boolean')
      assert.equal(f.git('rev-parse', 'HEAD'), before)
      assert.deepEqual(readFileSync(proposal), proposalBefore)
      assert.ok(parseOperation(readFileSync(journal, 'utf8')).sequence > initial.sequence)
      assert.equal(fresh.ownsPlan(plan), false)
      await assert.rejects(new MemoryPublisher(fresh, f.env).publish(plan, f.context), /Parent-owned/)
      await assert.rejects(
        fresh.request('chunk', { plan: plan.id, digest: plan.digest, path: 'Core.md', offset: 0 }, f.context),
        /Unknown/,
      )
    } finally {
      await fresh?.close()
      await f.close()
    }
  })
}

test('unchanged HEAD during live hook is unknown; later exact same-Pi drain recovers one commit and exact lock', async () => {
  const f = fixture(0)
  const fresh = new MemoryEngineController(f.root, f.env)
  const marker = join(f.dir, 'hook-start')
  const release = join(f.dir, 'hook-release')
  let publishing: Promise<unknown> | undefined
  try {
    const plan = await recoveryPlan(f)
    writeFileSync(
      join(f.root, '.git/hooks/pre-commit'),
      `#!/bin/sh\necho $$ >> '${marker}'\nwhile [ ! -f '${release}' ]; do sleep 0.05; done\n`,
      { mode: 0o700 },
    )
    const before = f.git('rev-parse', 'HEAD')
    publishing = new MemoryPublisher(f.engine, f.env).publish(plan, f.context)
    for (let i = 0; i < 200 && !existsSync(marker); i++) await delay(20)
    assert.ok(existsSync(marker))
    assert.equal(f.git('rev-parse', 'HEAD'), before)
    const early = await new MemoryPublisher(fresh, f.env).reconcileExisting(plan.id, plan.digest, f.context)
    assert.equal(early.stage, 'unknown')
    assert.equal(early.lockRetained, true)
    process.kill(Number(readFileSync(marker, 'utf8').trim()), 0)
    writeFileSync(release, '')
    await publishing
    const revision = f.git('rev-parse', 'HEAD')
    assert.notEqual(revision, before)
    const late = await new MemoryPublisher(fresh, f.env).reconcileExisting(plan.id, plan.digest, f.context)
    assert.equal(late.stage, 'reconciled_committed')
    assert.equal(late.revision, revision)
    assert.equal(late.lockRetained, false)
    assert.equal(readFileSync(marker, 'utf8').trim().split('\n').length, 1, 'never a second commit/hook')
    assert.equal(existsSync(join(f.root, '.lock')), false)
  } finally {
    writeFileSync(release, '')
    await publishing
    await fresh.close()
    await f.close()
  }
})

for (const stop of ['commit_started', 'head_observed', 'reconciled_committed']) {
  test(`authority loss after durable ${stop} retains non-stealable CAS and observed commit without replay`, async () => {
    const f = fixture(0)
    let fresh: MemoryEngineController | undefined
    try {
      const plan = await recoveryPlan(f)
      const journal = join(f.root, '.views/.engine-v2/journal', `${plan.id}.json`)
      const marker = join(f.dir, 'commit-count')
      writeFileSync(join(f.root, '.git/hooks/pre-commit'), `#!/bin/sh\necho invoked >> '${marker}'\n`, {
        mode: 0o700,
      })
      let live = true
      const context: OperationContext = {
        current() {
          if (live && parseOperation(readFileSync(journal, 'utf8')).receipt.stage === stop) live = false
          return live
        },
      }
      const before = f.git('rev-parse', 'HEAD')
      const result = await new MemoryPublisher(f.engine, f.env).publish(plan, context)
      assert.equal(live, false, 'fault actually fired after the specified durable journal')
      assert.equal(result.stage, 'unknown')
      assert.equal(result.lockRetained, true)
      const committed = f.git('rev-parse', 'HEAD')
      assert.notEqual(committed, before)
      const oldPid = f.engine.pid
      await f.engine.close()
      assert.throws(() => process.kill(oldPid!, 0), /ESRCH/)
      fresh = new MemoryEngineController(f.root, f.env)
      // Revocation happened before the original child could authorize CAS removal.
      // A new owner has no authority to steal that directory, even after observing HEAD.
      await assert.rejects(
        new MemoryPublisher(fresh, f.env).reconcileExisting(plan.id, plan.digest, f.context),
        /EEXIST/,
      )
      assert.equal(existsSync(`${journal}.cas`), true)
      assert.equal(existsSync(join(f.root, '.lock')), true)
      assert.equal(f.git('rev-parse', 'HEAD'), committed)
      assert.equal(parseOperation(readFileSync(journal, 'utf8')).receipt.stage, stop)
      const committedRead = await fresh.request(
        'headRead',
        { project: 'project', shared: true, selection: { path: 'Core.md' } },
        f.context,
      )
      assert.equal(committedRead.text, '# Durable proposal\n')
      const projection = await fresh.request('projection', { project: 'project', shared: true }, f.context)
      assert.equal(projection.revision, committed)
      assert.equal(projection.core, '# Durable proposal\n')
      await assert.rejects(fresh.request('create', { project: 'project' }, f.context), /CAS|Unreconciled/)
      assert.equal(readFileSync(marker, 'utf8').trim().split('\n').length, 1)
      assert.equal(fresh.ownsPlan(plan), false)
      await assert.rejects(new MemoryPublisher(fresh, f.env).publish(plan, f.context), /Parent-owned/)
    } finally {
      await fresh?.close()
      await f.close()
    }
  })
}

for (const stop of ['prepared', 'index_staged', 'head_observed']) {
  test(`separate OS parent abrupt exit at ${stop}: same-operation observation never replays`, async () => {
    const f = fixture(0)
    const fresh = new MemoryEngineController(f.root, f.env)
    const control = join(f.dir, 'crash-receipt.json')
    const marker = join(f.dir, 'commit-count')
    let receipt: { pid: number; engine: number; plan: string; digest: string } | undefined
    try {
      const before = f.git('rev-parse', 'HEAD')
      writeFileSync(join(f.root, '.git/hooks/pre-commit'), `#!/bin/sh\necho invoked >> '${marker}'\n`, {
        mode: 0o700,
      })
      const child = spawn(
        process.execPath,
        [
          '--experimental-strip-types',
          new URL('./fixtures/agent-memory-engine-crash.mjs', import.meta.url).pathname,
          f.root,
          control,
          stop,
        ],
        {
          env: {
            ...f.env,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: join(f.home, '.gitconfig'),
            GIT_CEILING_DIRECTORIES: f.dir,
          },
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      )
      let diagnosticBytes = 0
      child.stderr.on('data', (chunk: Buffer) => {
        diagnosticBytes += chunk.length
      })
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once('error', reject)
          child.once('exit', (code, signal) => resolve({ code, signal }))
        },
      )
      assert.deepEqual(exit, { code: 23, signal: null }, 'actual process exit, not cooperative revocation')
      receipt = JSON.parse(readFileSync(control, 'utf8'))
      assert.equal(receipt!.pid, child.pid)
      assert.ok(diagnosticBytes < 65536)
      // The owned data child sees EOF and exits naturally. Never kill a Git/hook to claim cancellation.
      for (let i = 0; i < 200; i++) {
        try {
          process.kill(receipt!.engine, 0)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') break
          throw error
        }
        await delay(25)
      }
      assert.throws(() => process.kill(receipt!.pid, 0), /ESRCH/)
      assert.throws(() => process.kill(receipt!.engine, 0), /ESRCH/)
      const observed = await new MemoryPublisher(fresh, f.env).reconcileExisting(
        receipt!.plan,
        receipt!.digest,
        f.context,
      )
      if (stop === 'head_observed') {
        assert.equal(observed.stage, 'reconciled_committed')
        assert.equal(observed.lockRetained, true, 'foreign process has no exact local drain ownership')
        assert.equal(readFileSync(marker, 'utf8').trim().split('\n').length, 1)
      } else {
        assert.equal(observed.stage, 'unknown')
        assert.equal(f.git('rev-parse', 'HEAD'), before)
        assert.equal(existsSync(marker), false)
      }
      const projection = await fresh.request('projection', { project: 'project', shared: true }, f.context)
      const committedRead = await fresh.request(
        'headRead',
        { project: 'project', shared: true, selection: { path: 'Core.md' } },
        f.context,
      )
      assert.equal(
        projection.core,
        stop === 'head_observed' ? '# Separate process proposal\n' : '# Core\nSynthetic identity.\n',
      )
      assert.equal(committedRead.text, projection.core)
      await assert.rejects(
        fresh.request(
          'chunk',
          { plan: receipt!.plan, digest: receipt!.digest, path: 'Core.md', offset: 0 },
          f.context,
        ),
        /Unknown/,
      )
      console.log(
        JSON.stringify({
          osFault: stop,
          parent: receipt!.pid,
          dataChild: receipt!.engine,
          absent: true,
          outcome: observed.stage,
          lockRetained: observed.lockRetained,
        }),
      )
    } finally {
      await fresh.close()
      await f.close()
    }
  })
}

test('owned lock parent fsync EIO retains anonymous lock and HEAD-only reads; no canonical start', async (t) => {
  const f = fixture(0)
  try {
    const plan = await recoveryPlan(f)
    const before = f.git('rev-parse', 'HEAD')
    const rootIdentity = lstatSync(f.root).ino
    const handle = await open(f.root, 'r')
    const prototype = Object.getPrototypeOf(handle)
    const original = prototype.sync
    await handle.close()
    let injected = 0
    const fault = t.mock.method(prototype, 'sync', function (this: { fd: number }) {
      if (fstatSync(this.fd).ino === rootIdentity && injected++ === 0)
        return Promise.reject(Object.assign(Error('Synthetic directory fsync EIO'), { code: 'EIO' }))
      return original.call(this)
    })
    const result = await new MemoryPublisher(f.engine, f.env).publish(plan, f.context)
    fault.mock.restore()
    assert.ok(injected > 0, 'real directory fsync boundary was exercised')
    assert.equal(result.stage, 'unknown')
    assert.equal(result.commitStarted, false)
    assert.equal(result.mutated, false)
    assert.equal(result.lockRetained, true, 'failed lock durability never claims lock absence')
    assert.equal(existsSync(join(f.root, '.lock')), true)
    assert.equal(f.git('rev-parse', 'HEAD'), before)
    const head = await f.engine.request(
      'headRead',
      { project: 'project', shared: true, selection: { path: 'Core.md' } },
      f.context,
    )
    assert.equal(head.text, '# Core\nSynthetic identity.\n')
    await assert.rejects(f.engine.request('create', { project: 'project' }, f.context), /Unreconciled/)
  } finally {
    t.mock.restoreAll()
    await f.close()
  }
})

test('hook-altered exact tree and foreign/malformed locks remain unknown and retained', async () => {
  for (const variant of ['tree', 'index', 'foreign', 'malformed']) {
    const f = fixture(0)
    try {
      const plan = await recoveryPlan(f)
      if (variant === 'tree') {
        writeFileSync(
          join(f.root, '.git/hooks/pre-commit'),
          '#!/bin/sh\nprintf "hook alteration\\n" >> .gitignore\ngit add -- .gitignore\n',
          { mode: 0o700 },
        )
      } else if (variant === 'index') {
        writeFileSync(
          join(f.root, '.git/hooks/post-commit'),
          '#!/bin/sh\nprintf "# Hook changed index\\n" > Core.md\ngit add -- Core.md\n',
          { mode: 0o700 },
        )
      } else {
        mkdirSync(join(f.root, '.lock'), { mode: 0o700 })
        writeFileSync(
          join(f.root, '.lock/owner.json'),
          variant === 'malformed'
            ? '{}'
            : JSON.stringify({
                version: 1,
                operation: '00000000-0000-4000-8000-000000000000',
                digest: 'a'.repeat(64),
                nonce: '00000000-0000-4000-8000-000000000000',
                directory: '0:0',
              }),
          { mode: 0o600 },
        )
      }
      const result = await new MemoryPublisher(f.engine, f.env).publish(plan, f.context)
      assert.equal(result.stage, 'unknown', variant)
      const recovered = await new MemoryPublisher(f.engine, f.env).reconcileExisting(
        plan.id,
        plan.digest,
        f.context,
      )
      assert.equal(recovered.stage, 'unknown', variant)
      assert.equal(existsSync(join(f.root, '.lock')), true)
      await assert.rejects(f.engine.request('create', { project: 'project' }, f.context), /Unreconciled/)
    } finally {
      await f.close()
    }
  }
})
