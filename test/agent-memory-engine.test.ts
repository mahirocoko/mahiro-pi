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
import { parseOperation, validatePlan } from '../lib/agent-memory/engine/operation.ts'
import {
  engineRequestDeadline,
  MemoryEngineController,
  type OperationContext,
} from '../lib/agent-memory/engine/controller.ts'
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
import { validateReply } from '../lib/agent-memory/engine/replies.ts'
import { recoveryCeiling } from '../lib/agent-memory/engine/recovery.ts'
import {
  allowedPath as newPath,
  limits,
  parseConfig as newConfig,
} from '../lib/agent-memory/engine/schema.ts'
import { allowedPath, createMemoryStore, parseConfig, type MemoryConfig } from '../lib/agent-memory/store.ts'
import { digest } from '../lib/continuity/records.ts'
import type { Episode } from '../lib/agent-memory/store.ts'
import { parseMemoryRead, retrieveMemory } from '../lib/agent-memory/retrieval.ts'
import { memoryFailureCode, type MemoryFailureCode } from '../lib/agent-memory/reasons.ts'

// Real child replies carry closed metadata, not the child's private exception text.
// Each caller still supplies the forbidden operation/tamper and checks its storage outcome.
const engineError =
  (expected: MemoryFailureCode = { reason: 'unknown' }) =>
  (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal(error.message, 'Engine operation unavailable')
    assert.deepEqual(memoryFailureCode(error), expected)
    return true
  }

test('ordinary reads and offline certification are completion-driven; mutation/publication keep deadlines', () => {
  for (const method of [
    'offlineCertify',
    'projection',
    'config',
    'capacityDiagnostic',
    'status',
    'episodes',
    'conflicts',
    'read',
    'headRead',
    'stats',
  ] as const)
    assert.equal(engineRequestDeadline(method), undefined, method)
  for (const action of ['doctor', 'palace', 'migration-export'] as const)
    assert.equal(engineRequestDeadline('manage', { action, project: 'project' }), undefined, action)
  for (const action of ['forget', 'rollback', 'init-project', 'migrate-v2'] as const)
    assert.equal(engineRequestDeadline('manage', { action, project: 'project' }), 30000, action)
  for (const method of [
    'observe',
    'manage',
    'discard',
    'cancel',
    'create',
    'edit',
    'ready',
    'prepare',
    'chunk',
    'fence',
    'journal',
    'claim',
    'reconcile',
    'recover',
  ] as const)
    assert.equal(engineRequestDeadline(method), 30000, method)
})

// Fixture owns the complete process env while active (tests in this file are serial).
// No inherited Git discovery/config/index/identity and no ancestor repository commits.
function fixture(count = 12, longPaths = false) {
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
        longPaths ? `global/${'x'.repeat(58)}${i.toString(36).padStart(3, '0')}.md` : `global/file-${i}.md`,
        null,
        `# Subject ${i}\nSynthetic body ${'data '.repeat(20)}\n`,
        ['source-one'],
      )
    store.integrate(view)
  }
  const env = engineEnvironment(process.env)
  const engine = new MemoryEngineController(root, env)
  let currentCalls = 0
  const context: OperationContext = {
    current: () => {
      currentCalls++
      return true
    },
  }
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
    get currentCalls() {
      return currentCalls
    },
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
test('knowledge history follows only current first-parent identity/time, bounds pages and refuses unsupported Git', async () => {
  const f = fixture(0)
  try {
    const request = async (offset = 0) => {
      const { configHash } = await f.engine.request('config', {}, f.context)
      return f.engine.request(
        'knowledgeHistory',
        {
          project: 'project',
          expectedRevision: f.git('rev-parse', 'HEAD'),
          expectedConfigHash: configHash,
          offset,
        },
        f.context,
      )
    }
    const root = await request()
    assert.equal(root.entries.length, 1)
    assert.equal(root.entries[0].parent, null)
    assert.equal((await request(127)).entries.length, 0)
    f.git('branch', 'side')
    f.git('commit', '--allow-empty', '-m', 'PRIVATE_MAIN')
    const main = f.git('rev-parse', 'HEAD')
    f.git('checkout', 'side')
    f.git('commit', '--allow-empty', '-m', 'PRIVATE_SIDE')
    const side = f.git('rev-parse', 'HEAD')
    f.git('checkout', 'main')
    f.git('merge', '--no-ff', 'side', '-m', 'PRIVATE_MERGE')
    const merged = await request()
    assert.equal(merged.entries[0].parent, main)
    assert.equal(merged.entries.length, 3)
    assert.ok(!merged.entries.some((e) => e.revision === side))
    assert.doesNotMatch(JSON.stringify(merged), /PRIVATE|Synthetic|Core.md|fixture@example/)
    f.git('replace', merged.revision, main)
    await assert.rejects(request(), engineError())
    f.git('replace', '-d', merged.revision)
    writeFileSync(join(f.root, '.git', 'info', 'grafts'), `${merged.revision}\n`)
    await assert.rejects(request(), engineError())
    rmSync(join(f.root, '.git', 'info', 'grafts'))
    writeFileSync(join(f.root, '.git', 'shallow'), `${root.revision}\n`)
    await assert.rejects(request(), engineError())
    rmSync(join(f.root, '.git', 'shallow'))
    for (let i = 0; i < 126; i++) f.git('commit', '--allow-empty', '-m', 'PRIVATE_WINDOW')
    const first = await request()
    assert.equal(first.windowLimitReached, true)
    assert.equal(first.nextOffset, 8)
    const last = await request(127)
    assert.equal(last.entries.length, 1)
    assert.equal(last.nextOffset, null)
    assert.equal(last.windowLimitReached, true)
  } finally {
    await f.close()
  }
})

test('knowledge history refuses all source tombstones but path tombstones reveal no markers', async () => {
  const f = fixture(0)
  try {
    const { configHash } = await f.engine.request('config', {}, f.context)
    const request = () =>
      f.engine.request(
        'knowledgeHistory',
        {
          project: 'project',
          expectedRevision: f.git('rev-parse', 'HEAD'),
          expectedConfigHash: configHash,
          offset: 0,
        },
        f.context,
      )
    const ledgerPath = join(f.root, '.memory.json')
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    ledger.forgottenPaths.push('global/private-marker.md')
    writeFileSync(ledgerPath, JSON.stringify(ledger))
    f.git('add', '.memory.json')
    f.git('commit', '-m', 'PRIVATE_PATH')
    assert.doesNotMatch(JSON.stringify(await request()), /private-marker|PRIVATE_PATH|forgottenPaths/)
    for (const project of [null, 'project', 'another']) {
      ledger.forgottenSources = [{ project, source: 'PRIVATE_SOURCE' }]
      writeFileSync(ledgerPath, JSON.stringify(ledger))
      f.git('add', '.memory.json')
      f.git('commit', '-m', 'PRIVATE_SOURCE')
      await assert.rejects(request(), engineError({ reason: 'unknown', readInvalidation: 'forgetting' }))
    }
  } finally {
    await f.close()
  }
})

test('knowledge history rejects expected/final config, HEAD, cancellation and authority drift', async () => {
  for (const race of [
    'expected-head',
    'expected-config',
    'final-head',
    'final-config',
    'permission',
    'cancel',
  ]) {
    const f = fixture(0)
    try {
      const { configHash } = await f.engine.request('config', {}, f.context)
      const revision = f.git('rev-parse', 'HEAD')
      let gitChecks = 0
      const abort = new AbortController()
      const context: OperationContext = {
        signal: abort.signal,
        current: (targets) => {
          if (targets.kind === 'git' && ++gitChecks === 20) {
            if (race === 'final-head') f.git('commit', '--allow-empty', '-m', 'PRIVATE_DRIFT')
            if (race === 'final-config')
              writeFileSync(join(f.root, 'config.json'), JSON.stringify({ ...f.config, automatic: true }))
            if (race === 'cancel') abort.abort()
            if (race === 'permission') return false
          }
          return true
        },
      }
      await assert.rejects(
        f.engine.request(
          'knowledgeHistory',
          {
            project: 'project',
            expectedRevision: race === 'expected-head' ? 'a'.repeat(40) : revision,
            expectedConfigHash: race === 'expected-config' ? 'b'.repeat(64) : configHash,
            offset: 0,
          },
          context,
        ),
      )
    } finally {
      await f.close()
    }
  }
})

async function ready(f: ReturnType<typeof fixture>, view: string) {
  await f.engine.request('ready', { view }, f.context)
  const result = await f.engine.request('prepare', { view, reviewed: [] }, f.context)
  assert.ok('plan' in result)
  return result.plan
}
async function prepareManagement(f: ReturnType<typeof fixture>, action: 'init-project' | 'migrate-v2') {
  const staged = await f.engine.request('manage', { action, project: 'project' }, f.context)
  assert.ok('view' in staged)
  const prepared = await f.engine.request('prepare', { view: staged.view, reviewed: [] }, f.context)
  assert.ok('plan' in prepared)
  return prepared
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

test('ABI2 directory reads page large descendant metadata below the transport cap', async () => {
  const f = fixture(0)
  try {
    const seed = f.store.createView('project', 120000, true)
    for (let i = 0; i < 80; i++)
      f.store.edit(
        seed,
        `reference/group/file-${i.toString().padStart(2, '0')}.md`,
        null,
        `---\nname: File ${i}\ndescription: ${'d'.repeat(3500)}${i}\n---\n# File ${i}\n`,
      )
    f.store.integrate(seed)
    const first = (await f.engine.request(
      'headRead',
      { project: 'project', shared: true, selection: { path: 'reference' } },
      f.context,
    )) as any
    assert.ok(Buffer.byteLength(JSON.stringify(first)) < transportLimits.reply)
    assert.equal(first.offset, 0)
    assert.equal(first.limit, 32)
    assert.equal(first.entries.length, 32)
    assert.equal(first.total, 80)
    assert.equal(first.nextOffset, 32)
    const second = (await f.engine.request(
      'headRead',
      {
        project: 'project',
        shared: true,
        selection: { path: 'reference', offset: first.nextOffset, limit: 32 },
      },
      f.context,
    )) as any
    assert.equal(second.offset, 32)
    assert.equal(second.entries.length, 32)
    assert.equal(second.nextOffset, 64)
    assert.ok(
      first.entries.every((entry: any) => !second.entries.some((next: any) => next.path === entry.path)),
    )
    const final = (await f.engine.request(
      'headRead',
      {
        project: 'project',
        shared: true,
        selection: { path: 'reference', offset: second.nextOffset, limit: 32 },
      },
      f.context,
    )) as any
    assert.equal(final.entries.length, 16)
    assert.equal(final.nextOffset, undefined)
    assert.equal(final.truncated, true)
  } finally {
    await f.close()
  }
})

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
      engineError({ reason: 'CAS' }),
    )
    assert.equal((await read(f, a.view, 'global/file-0.md')).hash, original.hash)
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
      engineError(),
    )
    assert.equal((await read(f, fresh.view, 'Core.md')).text, f.store.snapshot().files['Core.md'].text)
  } finally {
    await f.close()
  }
})

test('safe memory child retention code preserves published HEAD and the rejected ready proposal', async () => {
  const f = fixture(0)
  try {
    const established = f.store.createView('project')
    const text = '# Core\n# Synthetic protected heading\n' + 'Established fact. '.repeat(30) + '\n'
    f.store.edit(established, 'Core.md', digest(established.files['Core.md'].text), text)
    f.store.integrate(established)
    const before = f.git('rev-parse', 'HEAD')
    const { view } = await f.engine.request('create', { project: 'project' }, f.context)
    const original = await read(f, view)
    await f.engine.request(
      'edit',
      {
        view,
        path: 'Core.md',
        expectedHash: original.hash as string,
        text: '# Core\nShort.\n',
        sources: [],
      },
      f.context,
    )
    await f.engine.request('ready', { view }, f.context)
    const manifest = join(f.root, '.views', '.engine-v2', 'drafts', `${view}.json`)
    const proposal = readFileSync(manifest)
    await assert.rejects(
      f.engine.request('prepare', { view, reviewed: [] }, f.context),
      engineError({ reason: 'retention' }),
    )
    assert.equal(f.git('rev-parse', 'HEAD'), before)
    assert.equal(f.store.projection('project').core, text)
    assert.deepEqual(
      readFileSync(manifest),
      proposal,
      'retention refusal does not discard or rewrite proposal',
    )
    assert.equal((await read(f, view)).text, '# Core\nShort.\n')
    await assert.rejects(
      f.engine.request('prepare', { view, reviewed: [] }, { current: () => false }),
      (error: unknown) => {
        assert.deepEqual(memoryFailureCode(error), { reason: 'unknown' })
        return true
      },
    )
    assert.deepEqual(readFileSync(manifest), proposal)
  } finally {
    await f.close()
  }
})

test('logical path denies gate entire view; overlays/manifest corruption and forgotten sources fail closed', async () => {
  const f = fixture(2)
  try {
    const { view } = await f.engine.request('create', { project: 'project' }, f.context)
    const expectedCore = f.store.snapshot().files['Core.md'].text
    assert.equal((await read(f, view)).text, expectedCore)
    assert.equal(
      (
        await f.engine.request(
          'headRead',
          { project: 'project', shared: true, selection: { path: 'Core.md' } },
          f.context,
        )
      ).text,
      expectedCore,
    )
    let deniedCalls = 0
    const denied: OperationContext = {
      current: (targets) => {
        if (!targets.logical.includes('global/file-1.md')) return true
        deniedCalls++
        return false
      },
    }
    await assert.rejects(
      f.engine.request(
        'headRead',
        { project: 'project', shared: true, selection: { path: 'Core.md' } },
        denied,
      ),
      engineError(),
    )
    assert.ok(deniedCalls > 0, 'head read reached the forbidden logical operand')
    deniedCalls = 0
    await assert.rejects(
      f.engine.request('read', { view, selection: { path: 'Core.md' } }, denied),
      engineError(),
    )
    assert.ok(deniedCalls > 0, 'draft read reached the forbidden logical operand')
    const core = await read(f, view)
    assert.equal(core.text, expectedCore, 'same read succeeds when authority is restored')
    await f.engine.request(
      'edit',
      { view, path: 'Core.md', expectedHash: core.hash as string, text: '# Modified\n', sources: [] },
      f.context,
    )
    const blobs = join(f.root, '.views', '.engine-v2', 'blobs')
    const blob = join(blobs, readdirSync(blobs)[0])
    assert.equal((await read(f, view)).text, '# Modified\n', 'untampered overlay is readable')
    writeFileSync(blob, '# Tampered\n')
    await assert.rejects(read(f, view), engineError())
    assert.equal(readFileSync(blob, 'utf8'), '# Tampered\n')
    const second = await f.engine.request('create', { project: 'project' }, f.context)
    const manifest = join(f.root, '.views', '.engine-v2', 'drafts', `${second.view}.json`)
    assert.equal((await read(f, second.view)).text, expectedCore)
    const manifestBefore = readFileSync(manifest)
    writeFileSync(manifest, '{}')
    await assert.rejects(read(f, second.view), engineError())
    assert.equal(readFileSync(manifest, 'utf8'), '{}')
    // Only this synthetic manifest tamper is restored; authority and controller stay the same.
    writeFileSync(manifest, manifestBefore)
    assert.equal((await read(f, second.view)).text, expectedCore)
    const third = await f.engine.request('create', { project: 'project' }, f.context)
    f.store.forget(f.store.snapshot().revision, [], ['source-one'], 'project')
    await assert.rejects(
      read(f, third.view),
      engineError({ reason: 'unknown', readInvalidation: 'forgetting' }),
    )
    assert.ok(existsSync(join(f.root, '.views', '.engine-v2', 'drafts', `${third.view}.json`)))
  } finally {
    await f.close()
  }
})

test('mutation request deadline rejects with typed uncertainty and drains the same child without replay', async (t) => {
  const f = fixture(0)
  try {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const request = f.engine.request('create', { project: 'project' }, f.context)
    const pid = f.engine.pid
    assert.ok(pid)
    const rejection = assert.rejects(request, (error: unknown) => {
      assert.deepEqual(memoryFailureCode(error), { reason: 'deadline' })
      return true
    })
    t.mock.timers.tick(30000)
    await rejection
    assert.equal(f.engine.queueSize, 1, 'deadline rejection is not completed drain')
    t.mock.timers.reset()
    assert.deepEqual(await f.engine.request('config', {}, f.context), {
      config: f.config,
      configHash: digest(JSON.stringify(f.config)),
    })
    assert.equal(f.engine.pid, pid, 'same controller/channel; no restart or replay')
    assert.equal(f.engine.queueSize, 0)
  } finally {
    t.mock.timers.reset()
    await f.close()
  }
})

test('ordinary reads outlive the former deadline and remain caller-cancellable', async (t) => {
  const f = fixture(0)
  try {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const abort = new AbortController()
    const request = f.engine.request('config', {}, { current: () => true, signal: abort.signal })
    let settled = false
    const rejection = assert.rejects(request, /cancel|abort/i).finally(() => {
      settled = true
    })
    t.mock.timers.tick(60000)
    await Promise.resolve()
    assert.equal(settled, false, 'no whole-request read deadline')
    assert.equal(f.engine.queueSize, 1)
    abort.abort()
    t.mock.timers.reset()
    await rejection
    assert.equal(f.engine.queueSize, 0, 'active cancellation settles after child drain')
  } finally {
    t.mock.timers.reset()
    await f.close()
  }
})

test('capacity diagnostic reports bounded namespace counts without parsing retained bodies', async () => {
  const f = fixture(0)
  try {
    const uuid = (value: number) => {
      const hex = value.toString(16)
      return `${hex.padStart(8, '0')}-0000-4000-8000-${hex.padStart(12, '0')}.json`
    }
    const journal = join(f.root, '.views/.engine-v2/journal')
    const legacyViews = join(f.root, '.views')
    const drafts = join(f.root, '.views/.engine-v2/drafts')
    const episodes = join(f.root, '.episodes')
    mkdirSync(journal, { recursive: true, mode: 0o700 })
    mkdirSync(drafts, { recursive: true, mode: 0o700 })
    mkdirSync(episodes, { recursive: true, mode: 0o700 })
    for (let index = 0; index < 65; index++) writeFileSync(join(journal, uuid(index)), 'not-json')
    writeFileSync(join(legacyViews, uuid(999)), 'not-json')
    for (let index = 0; index < 64; index++) writeFileSync(join(drafts, uuid(index)), 'not-json')
    for (let index = 0; index < 256; index++)
      writeFileSync(join(episodes, `${index.toString(16).padStart(64, '0')}.json`), 'not-json')

    await assert.rejects(f.engine.request('status', {}, f.context), engineError({ reason: 'capacity' }))
    const diagnostic = await f.engine.request('capacityDiagnostic', {}, f.context)
    assert.equal(diagnostic.kind, 'abi2-capacity-diagnostic')
    assert.equal(diagnostic.classification, 'status-namespace-capacity')
    assert.equal(diagnostic.association, 'sequential-non-atomic')
    assert.deepEqual(diagnostic.namespaces.journal, {
      entries: 65,
      matching: 65,
      exact: true,
      status: 'blocked',
      doctor: 'not-applicable',
      admission: 'blocked',
    })
    assert.deepEqual(diagnostic.namespaces.legacyViews, {
      entries: 2,
      matching: 1,
      exact: true,
      status: 'not-applicable',
      doctor: 'available',
      admission: 'not-applicable',
    })
    assert.deepEqual(diagnostic.namespaces.drafts, {
      entries: 64,
      matching: 64,
      exact: true,
      status: 'not-applicable',
      doctor: 'available',
      admission: 'blocked',
    })
    assert.deepEqual(diagnostic.namespaces.episodes, {
      entries: 256,
      matching: 256,
      exact: true,
      status: 'not-applicable',
      doctor: 'available',
      admission: 'unknown',
    })
    assert.deepEqual(diagnostic.derived.retainedViews, {
      matching: 65,
      exact: true,
      doctor: 'blocked',
    })
    assert.deepEqual(diagnostic.blockers, {
      status: ['journal'],
      doctor: ['retainedViews'],
      admission: ['journal', 'drafts'],
    })
    assert.equal(diagnostic.corpusReturned, false)
    assert.doesNotMatch(JSON.stringify(diagnostic), /not-json|\.views|\.episodes|memory-/)

    const forgedState: any = structuredClone(diagnostic)
    forgedState.namespaces.journal.status = 'available'
    forgedState.namespaces.journal.admission = 'available'
    forgedState.blockers.status = []
    forgedState.blockers.admission = ['drafts']
    forgedState.classification = 'non-namespace-status-capacity'
    assert.throws(() => validateReply('capacityDiagnostic', {}, forgedState), /Invalid/)
    const forgedExact: any = structuredClone(diagnostic)
    forgedExact.namespaces.journal.entries = 8193
    forgedExact.namespaces.journal.exact = true
    assert.throws(() => validateReply('capacityDiagnostic', {}, forgedExact), /Invalid/)
    const forgedDoctor: any = structuredClone(diagnostic)
    forgedDoctor.blockers.doctor = [['retainedViews']]
    assert.throws(() => validateReply('capacityDiagnostic', {}, forgedDoctor), /Invalid/)

    rmSync(join(journal, uuid(64)))
    const admissionOnly = await f.engine.request('capacityDiagnostic', {}, f.context)
    assert.equal(admissionOnly.classification, 'non-namespace-status-capacity')
    assert.deepEqual(admissionOnly.blockers.status, [])
    assert.deepEqual(admissionOnly.blockers.admission, ['journal', 'drafts'])
  } finally {
    await f.close()
  }
})

test('capacity diagnostic stops at one overflow sentinel and keeps partial counts unknown', async () => {
  const f = fixture(0)
  try {
    const legacyViews = join(f.root, '.views')
    mkdirSync(legacyViews, { recursive: true, mode: 0o700 })
    for (let index = 0; index < 8193; index++)
      writeFileSync(join(legacyViews, `unknown-${index.toString(16).padStart(4, '0')}`), 'private')
    const diagnostic = await f.engine.request('capacityDiagnostic', {}, f.context)
    assert.deepEqual(diagnostic.namespaces.legacyViews, {
      entries: 8193,
      matching: 0,
      exact: false,
      status: 'not-applicable',
      doctor: 'unknown',
      admission: 'not-applicable',
    })
    assert.deepEqual(diagnostic.derived.retainedViews, {
      matching: 0,
      exact: false,
      doctor: 'unknown',
    })
    assert.equal(diagnostic.classification, 'non-namespace-status-capacity')
    assert.equal(diagnostic.corpusReturned, false)
    assert.doesNotMatch(JSON.stringify(diagnostic), /unknown-|private|\.views|memory-/)
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
    await assert.rejects(f.engine.request('config', {}, f.context), (error: unknown) => {
      assert.deepEqual(memoryFailureCode(error), { reason: 'capacity' })
      assert.ok(error instanceof Error && error.message === 'Engine overload')
      return true
    })
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
    const privateDetail = '/synthetic/private/path Private-heading-stderr'
    writeFileSync(hook, `#!/bin/sh\necho '${privateDetail}' >&2\nexit 1\n`, { mode: 0o700 })
    chmodSync(hook, 0o700)
    const before = f.git('rev-parse', 'HEAD')
    const result = await new MemoryPublisher(f.engine, f.env).publish(plan, f.context)
    assert.equal(result.stage, 'not_committed_dirty')
    assert.equal(result.mutated, true)
    assert.equal(result.commitStarted, true)
    assert.ok(
      !JSON.stringify(result).includes(privateDetail),
      'actual hook stderr never reaches public receipt',
    )
    assert.equal(f.git('rev-parse', 'HEAD'), before)
    assert.match(f.git('status', '--porcelain', '--untracked-files=no'), /Core.md/)
    assert.equal(f.store.projection('project').core, '# Core\nSynthetic identity.\n')
    assert.equal(readFileSync(join(f.root, 'Core.md'), 'utf8'), '# Proposal\n')
    assert.ok(existsSync(join(f.root, '.views', '.engine-v2', 'drafts', `${view}.json`)))
    await assert.rejects(f.engine.request('prepare', { view, reviewed: [] }, f.context), engineError())
    assert.equal(f.git('rev-parse', 'HEAD'), before)
    assert.equal(readFileSync(join(f.root, 'Core.md'), 'utf8'), '# Proposal\n')
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
        if (targets.physical.some((path) => path.includes('/.engine-v2/staging/') && path.endsWith('.tmp')))
          live = false
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

test('operation plans separately bound migration deltas that exceed the resulting file ceiling', () => {
  const changes = Array.from({ length: 342 }, (_, index) => {
    const slug = `legacy-${index.toString(36).padStart(3, '0')}.md`
    return [
      { path: `global/${slug}`, hash: null, size: 0 },
      { path: `archives/legacy-v1-${'a'.repeat(12)}/global/${slug}`, hash: 'b'.repeat(64), size: 1 },
      { path: `system/human/${slug}`, hash: 'c'.repeat(64), size: 1 },
    ]
  }).flat()
  changes.push(
    { path: 'system/persona.md', hash: 'd'.repeat(64), size: 1 },
    { path: '.memory.json', hash: 'e'.repeat(64), size: limits.ledger },
  )
  const metadata: Omit<Plan, 'digest'> = {
    id: '11111111-1111-4111-8111-111111111111',
    view: '22222222-2222-4222-8222-222222222222',
    base: '1'.repeat(40),
    current: '2'.repeat(40),
    configHash: '3'.repeat(64),
    ledgerHash: '4'.repeat(64),
    changes,
  }
  assert.equal(changes.length, 1028)
  assert.doesNotThrow(() => validatePlan({ ...metadata, digest: digest(JSON.stringify(metadata)) }))
  const oversizedFile = {
    ...metadata,
    changes: [{ path: 'global/too-large.md', hash: 'f'.repeat(64), size: limits.file + 1 }],
  }
  assert.throws(
    () => validatePlan({ ...oversizedFile, digest: digest(JSON.stringify(oversizedFile)) }),
    /operation delta/,
  )
})

test('doctor counts validated conflict manifests without hydrating retained bodies', async () => {
  const f = fixture(286)
  try {
    await f.engine.request('create', { project: 'project', shared: true }, f.context)
    const conflict = await f.engine.request('create', { project: 'project', shared: true }, f.context)
    const manifest = join(f.root, '.views', '.engine-v2', 'drafts', `${conflict.view}.json`)
    const draft = JSON.parse(readFileSync(manifest, 'utf8'))
    draft.state = 'conflict'
    writeFileSync(manifest, `${JSON.stringify(draft)}\n`)
    const before = await f.engine.request('stats', {}, f.context)
    const { doctor: report } = (await f.engine.request(
      'manage',
      { action: 'doctor', project: 'project' },
      f.context,
    )) as unknown as { doctor: { conflicts: number; views: number } }
    const after = await f.engine.request('stats', {}, f.context)
    const readsBefore = Object.values(before.blobReads).reduce((sum, count) => sum + count, 0)
    const readsAfter = Object.values(after.blobReads).reduce((sum, count) => sum + count, 0)
    assert.ok(report.views >= 2)
    assert.equal(report.conflicts, 1)
    assert.equal(readsAfter - readsBefore, 0, 'conflict discovery does not hydrate retained bodies')
    assert.ok(after.gitCalls - before.gitCalls <= 4, 'conflict discovery uses bounded metadata checks')
  } finally {
    await f.close()
  }
})

test('conflict discovery rejects effective Core and index sizes above recovery ceilings', async () => {
  const f = fixture(1)
  try {
    const conflict = await f.engine.request('create', { project: 'project', shared: true }, f.context)
    const manifest = join(f.root, '.views', '.engine-v2', 'drafts', `${conflict.view}.json`)
    const draft = JSON.parse(readFileSync(manifest, 'utf8'))
    draft.state = 'conflict'
    draft.base.refs['Core.md'].size = recoveryCeiling.coreBytes + 1
    writeFileSync(manifest, `${JSON.stringify(draft)}\n`)
    await assert.rejects(f.engine.request('conflicts', { project: 'project' }, f.context), engineError())
    await assert.rejects(
      f.engine.request('manage', { action: 'doctor', project: 'project' }, f.context),
      engineError(),
    )
  } finally {
    await f.close()
  }
})

test('above-341-file engine migration prepares segmented lossless changes with bounded Git calls', async () => {
  const f = fixture(340, true)
  try {
    const longProject = 'p'.repeat(64)
    const longSlug = `${'s'.repeat(64)}.md`
    const primary = createMemoryStore(f.root, () => {}, 'primary')
    const legacy = primary.createView('project', 120000, true)
    primary.edit(legacy, `global/${longSlug}`, null, '# Long global\nLegacy preference.\n', [])
    primary.edit(
      legacy,
      `deferred/${longProject}/${longSlug}`,
      null,
      '# Long project\nLegacy project memory.\n',
      [],
    )
    primary.integrate(legacy)
    chmodSync(join(f.root, `global/${longSlug}`), 0o644)
    chmodSync(join(f.root, `deferred/${longProject}/${longSlug}`), 0o644)
    const beforeMigration = primary.snapshot()
    const archivePrefix = `archives/legacy-v1-${beforeMigration.revision.slice(0, 12)}`
    const before = await f.engine.request('stats', {}, f.context)
    const prepared = await prepareManagement(f, 'migrate-v2')
    const afterPrepare = await f.engine.request('stats', {}, f.context)
    assert.ok(
      afterPrepare.gitCalls - before.gitCalls < 100,
      'migration and prepare avoid per-file Git spawning',
    )
    assert.equal(prepared.plan.changes.length, 1028)
    const status = await f.engine.request('status', {}, f.context)
    const pending = status.pendingOperations.find((operation) => operation.id === prepared.plan.id)
    assert.deepEqual(pending && { digest: pending.digest, stage: pending.stage }, {
      digest: prepared.plan.digest,
      stage: 'prepared',
    })
    assert.ok(pending && pending.recordBytes > 512 * 1024 && pending.recordBytes <= 8 * 1024 * 1024)
    const changes = new Map(prepared.plan.changes.map((change) => [change.path, change]))
    assert.equal(changes.get(`global/${longSlug}`)?.hash, null)
    assert.equal(changes.get(`deferred/${longProject}/${longSlug}`)?.hash, null)
    const archivePath = `${archivePrefix}/deferred/${longProject}/${longSlug}`
    assert.ok(changes.get(`${archivePrefix}/global/${longSlug}`)?.hash)
    assert.ok(changes.get(archivePath)?.hash)
    assert.ok(changes.get(`system/human/${longSlug}`)?.hash)
    assert.ok(changes.get(`projects/${longProject}/system/${longSlug}`)?.hash)
    const archiveChunk = await f.engine.request(
      'chunk',
      { plan: prepared.plan.id, digest: prepared.plan.digest, path: archivePath, offset: 0 },
      f.context,
    )
    assert.equal(
      Buffer.from(archiveChunk.data, 'base64').toString(),
      '# Long project\nLegacy project memory.\n',
    )
    const checksBeforePublish = f.currentCalls
    const publication = await new MemoryPublisher(f.engine, f.env).publish(prepared.plan, f.context)
    assert.equal(publication.stage, 'reconciled_committed', JSON.stringify(publication))
    assert.ok(
      f.currentCalls - checksBeforePublish < 100000,
      'live-scale publication keeps checkpoints bounded',
    )
  } finally {
    await f.close()
  }
})

test('engine migration publishes segmented archives then initializes and diagnoses the v2 corpus', async () => {
  const f = fixture(8)
  try {
    const longProject = 'p'.repeat(64)
    const longSlug = `${'s'.repeat(64)}.md`
    const primary = createMemoryStore(f.root, () => {}, 'primary')
    const legacy = primary.createView('project', 120000, true)
    primary.edit(legacy, `global/${longSlug}`, null, '# Long global\nLegacy preference.\n', [])
    primary.edit(
      legacy,
      `deferred/${longProject}/${longSlug}`,
      null,
      '# Long project\nLegacy project memory.\n',
      [],
    )
    primary.integrate(legacy)
    const beforeMigration = primary.snapshot()
    const archivePrefix = `archives/legacy-v1-${beforeMigration.revision.slice(0, 12)}`
    const prepared = await prepareManagement(f, 'migrate-v2')
    const publication = await new MemoryPublisher(f.engine, f.env).publish(prepared.plan, f.context)
    assert.equal(publication.stage, 'reconciled_committed', JSON.stringify(publication))
    const migrated = primary.snapshot()
    assert.equal(migrated.files[`global/${longSlug}`], undefined)
    assert.equal(migrated.files[`deferred/${longProject}/${longSlug}`], undefined)
    assert.equal(
      migrated.files[`${archivePrefix}/global/${longSlug}`].text,
      '# Long global\nLegacy preference.\n',
    )
    assert.equal(
      migrated.files[`${archivePrefix}/deferred/${longProject}/${longSlug}`].text,
      '# Long project\nLegacy project memory.\n',
    )
    assert.ok(migrated.files[`system/human/${longSlug}`])
    assert.ok(migrated.files[`projects/${longProject}/system/${longSlug}`])
    const initialized = await prepareManagement(f, 'init-project')
    assert.equal(
      (await new MemoryPublisher(f.engine, f.env).publish(initialized.plan, f.context)).stage,
      'reconciled_committed',
    )
    const { doctor: report } = (await f.engine.request(
      'manage',
      { action: 'doctor', project: 'project' },
      f.context,
    )) as unknown as { doctor: { healthy: boolean; unmigratedV1Paths: string[]; views: number } }
    assert.equal(report.healthy, true)
    assert.deepEqual(report.unmigratedV1Paths, [])
    const noOpRevision = (await f.engine.request('status', {}, f.context)).revision
    for (const action of ['migrate-v2', 'init-project'] as const) {
      const noOp = await f.engine.request('manage', { action, project: 'project' }, f.context)
      assert.ok('revision' in noOp)
      assert.equal(noOp.changed, false)
      assert.equal(noOp.revision, noOpRevision)
    }
    const afterNoOp = (await f.engine.request(
      'manage',
      { action: 'doctor', project: 'project' },
      f.context,
    )) as unknown as { doctor: { views: number } }
    assert.equal(afterNoOp.doctor.views, report.views)
    assert.deepEqual((await f.engine.request('status', {}, f.context)).pendingOperations, [])
    const directory = (await f.engine.request(
      'headRead',
      {
        project: 'project',
        shared: true,
        selection: { path: `${archivePrefix}/deferred/${longProject}` },
      },
      f.context,
    )) as unknown as { directory: string; total: number }
    assert.equal(directory.directory, `${archivePrefix}/deferred/${longProject}`)
    assert.equal(directory.total, 1)

    // Auditable belief supersession in ABI2 engine without allowShrink
    const draftSupersede = await f.engine.request('create', { project: 'project', shared: true }, f.context)
    const convPage = await read(f, draftSupersede.view, 'projects/project/system/conventions.md')
    await f.engine.request(
      'edit',
      {
        view: draftSupersede.view,
        path: 'projects/project/system/conventions.md',
        expectedHash: convPage.hash as string,
        text: '---\nname: project-conventions\ndescription: Coding conventions and workflow rules for project\n---\n# Project Conventions (project)\n\n- Updated concise rule after superseding the old heading.\n',
        sources: [],
      },
      f.context,
    )
    await f.engine.request('ready', { view: draftSupersede.view }, f.context)
    await assert.rejects(
      f.engine.request('prepare', { view: draftSupersede.view, reviewed: [] }, f.context),
      engineError({ reason: 'retention' }),
    )
    await f.engine.request(
      'edit',
      {
        view: draftSupersede.view,
        path: 'projects/project/reference/supersessions.md',
        expectedHash: null,
        text: '---\nname: project-supersessions\ndescription: Auditable log of superseded project rules\n---\n# Superseded Rules\n\n- [SUPERSEDED] Replaced initial `## Rules` section in [[projects/project/system/conventions.md]].\n',
        sources: [],
      },
      f.context,
    )
    await f.engine.request('ready', { view: draftSupersede.view }, f.context)
    const preparedSupersede = await f.engine.request(
      'prepare',
      { view: draftSupersede.view, reviewed: [] },
      f.context,
    )
    assert.ok('plan' in preparedSupersede)
    const publishedSupersede = await new MemoryPublisher(f.engine, f.env).publish(
      preparedSupersede.plan,
      f.context,
    )
    assert.equal(publishedSupersede.stage, 'reconciled_committed')

    // Read-only palace inspection in ABI2 engine
    const statusBeforePalace = await f.engine.request('status', {}, f.context)
    const { palace } = (await f.engine.request(
      'manage',
      { action: 'palace', project: 'project' },
      f.context,
    )) as unknown as {
      palace: {
        revision: string
        project: string
        healthy: boolean
        layers: Record<string, string[]>
        files: { path: string; protectedRetention: boolean; alwaysLoaded: boolean; links?: string[] }[]
        views: { total: number; committed: number }
        pendingOperations: unknown[]
      }
    }
    assert.equal(palace.revision, statusBeforePalace.revision)
    assert.equal(palace.project, 'project')
    assert.equal(palace.healthy, true)
    assert.ok(palace.layers.core.includes('Core.md'))
    assert.ok(palace.layers.system.includes('system/persona.md'))
    assert.ok(palace.layers.projectSystem.includes('projects/project/system/conventions.md'))
    assert.ok(palace.layers.projectReference.includes('projects/project/reference/supersessions.md'))
    assert.ok(palace.layers.archives.some((p) => p.startsWith(archivePrefix)))
    const superEntry = palace.files.find(
      (entry) => entry.path === 'projects/project/reference/supersessions.md',
    )
    assert.ok(superEntry)
    assert.equal(superEntry.protectedRetention, false)
    assert.ok(superEntry.links?.includes('projects/project/system/conventions.md'))
    assert.ok(palace.views.total >= 1)
    assert.ok(palace.views.committed >= 1)
    assert.deepEqual(palace.pendingOperations, [])
    const statusAfterPalace = await f.engine.request('status', {}, f.context)
    assert.equal(statusAfterPalace.revision, statusBeforePalace.revision)
    assert.deepEqual(statusAfterPalace.pendingOperations, [])

    // Seed 70 archive files + 65 additional non-archive files + 1 trailing non-archive file with a broken link
    // to prove ABI2 palace inspects 65+ non-archive files, preserves non-archive metadata ahead of archives,
    // exposes shared-primary foreign project files, and never reports false healthy=true.
    const bulkDraft = await f.engine.request('create', { project: 'project', shared: true }, f.context)
    for (let i = 0; i < 70; i++) {
      const idx = String(i).padStart(2, '0')
      await f.engine.request(
        'edit',
        {
          view: bulkDraft.view,
          path: `archives/legacy-v1-bulk/global/arch-${idx}.md`,
          expectedHash: null,
          text: `# Archived ${idx}\nHistorical note ${idx}.\n`,
          sources: [],
        },
        f.context,
      )
    }
    await f.engine.request(
      'edit',
      {
        view: bulkDraft.view,
        path: 'projects/other/system/foreign-abi2.md',
        expectedHash: null,
        text: '---\nname: foreign-abi2\ndescription: Foreign project system file in ABI2\n---\n# Foreign ABI2\n\n- Shared visibility check.\n',
        sources: [],
      },
      f.context,
    )
    for (let i = 0; i < 60; i++) {
      const idx = String(i).padStart(2, '0')
      await f.engine.request(
        'edit',
        {
          view: bulkDraft.view,
          path: `reference/bulk-ref-${idx}.md`,
          expectedHash: null,
          text: `---\nname: bulk-ref-${idx}\ndescription: Bulk reference ${idx}\n---\n# Bulk Reference ${idx}\n\n- Links to [[Core.md]].\n`,
          sources: [],
        },
        f.context,
      )
    }
    await f.engine.request(
      'edit',
      {
        view: bulkDraft.view,
        path: 'system/human/zz-beyond-64.md',
        expectedHash: null,
        text: '---\nname: zz-beyond-64\ndescription: Trailing non-archive file beyond 64 limit\n---\n# Trailing File\n\n- Broken link [[reference/nonexistent-beyond-64.md]].\n',
        sources: [],
      },
      f.context,
    )
    await f.engine.request('ready', { view: bulkDraft.view }, f.context)
    const bulkPrepared = await f.engine.request('prepare', { view: bulkDraft.view, reviewed: [] }, f.context)
    assert.ok('plan' in bulkPrepared)
    const bulkPublished = await new MemoryPublisher(f.engine, f.env).publish(bulkPrepared.plan, f.context)
    assert.equal(bulkPublished.stage, 'reconciled_committed')

    const { palace: bulkPalace } = (await f.engine.request(
      'manage',
      { action: 'palace', project: 'project' },
      f.context,
    )) as unknown as {
      palace: {
        revision: string
        project: string
        healthy: boolean
        coverage: {
          complete: boolean
          inspectedFiles: number
          nonArchiveFiles: number
          totalFiles: number
          filesReturned: number
          filesTruncated: boolean
          brokenLinksTotal: number
          criticalBrokenLinksTotal: number
          advisoryBrokenLinksTotal: number
          brokenLinksTruncated: boolean
        }
        files: { path: string; layer: string; alwaysLoaded: boolean; name?: string }[]
        brokenLinks: { source: string; target: string }[]
      }
    }
    assert.ok(bulkPalace.coverage.nonArchiveFiles >= 65)
    assert.equal(bulkPalace.coverage.inspectedFiles, bulkPalace.coverage.nonArchiveFiles)
    assert.equal(bulkPalace.coverage.complete, true)
    assert.equal(bulkPalace.healthy, true, 'detail broken links are advisory across the ABI2 boundary')
    assert.equal(bulkPalace.coverage.criticalBrokenLinksTotal, 0)
    assert.equal(bulkPalace.coverage.advisoryBrokenLinksTotal, 1)
    assert.equal(bulkPalace.coverage.brokenLinksTotal, 1)
    assert.deepEqual(bulkPalace.brokenLinks, [
      { source: 'system/human/zz-beyond-64.md', target: 'reference/nonexistent-beyond-64.md' },
    ])
    const trailingIdx = bulkPalace.files.findIndex((entry) => entry.path === 'system/human/zz-beyond-64.md')
    const firstArchiveIdx = bulkPalace.files.findIndex((entry) => entry.path.startsWith('archives/'))
    const foreignAbi2Entry = bulkPalace.files.find(
      (entry) => entry.path === 'projects/other/system/foreign-abi2.md',
    )
    assert.ok(trailingIdx >= 0, 'trailing non-archive file beyond 64 is returned in palace.files')
    assert.ok(
      firstArchiveIdx === -1 || trailingIdx < firstArchiveIdx,
      'non-archive files precede archives in ABI2 palace.files',
    )
    assert.ok(foreignAbi2Entry, 'foreign project file is visible in shared-primary ABI2 palace')
    assert.equal(foreignAbi2Entry.alwaysLoaded, false)
    assert.equal(bulkPalace.files[trailingIdx].alwaysLoaded, false)
    const projection = await f.engine.request('projection', { project: 'project', shared: true }, f.context)
    assert.equal(projection.system?.['system/human/zz-beyond-64.md'], undefined)
    assert.equal(projection.projectSystem?.['projects/other/system/foreign-abi2.md'], undefined)
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
    assert.ok('plan' in prepared)
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
    await assert.rejects(read(f, scoped.view, 'deferred/other/keep.md'), engineError())
    assert.equal((await read(f, scoped.view)).text, f.store.snapshot().files['Core.md'].text)
    const shared = await f.engine.request('create', { project: 'project', shared: true }, f.context)
    assert.equal((await read(f, shared.view, 'deferred/other/keep.md')).text, '# Other project knowledge\n')
    assert.deepEqual(readFileSync(join(f.root, 'config.json')), configBytes)
    const oldRollback = oracle.store.rollback(expected.revision, oldInitial, 'project')
    const rollback = await f.engine.request(
      'manage',
      { action: 'rollback', project: 'project', revision: f.store.snapshot().revision, target: initial },
      f.context,
    )
    assert.ok('plan' in rollback)
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
      engineError({ reason: 'CAS' }),
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
      engineError(),
    )
    assert.deepEqual(comparable(f.store.snapshot()), comparable(oldRollback))
    const view = await f.engine.request('create', { project: 'project' }, f.context)
    assert.equal((await read(f, view.view)).text, f.store.snapshot().files['Core.md'].text)
    await f.engine.request('cancel', { view: view.view }, f.context)
    await assert.rejects(read(f, view.view), engineError())
    assert.equal(
      JSON.parse(readFileSync(join(f.root, '.views', '.engine-v2', 'drafts', `${view.view}.json`), 'utf8'))
        .state,
      'cancelled',
    )
  } finally {
    await oracle.close()
    await f.close()
  }
})

test('project management can forget deeply nested legacy migration archives', async () => {
  const f = fixture(1)
  const path = 'archives/legacy-v1-abcdef123456/deferred/project/overview.md'
  try {
    const view = f.store.createView('project', 120000, true)
    f.store.edit(view, path, null, '# Archived project memory\n', [])
    f.store.integrate(view)
    const revision = f.store.snapshot().revision
    const prepared = await f.engine.request(
      'manage',
      { action: 'forget', project: 'project', revision, paths: [path], sources: [] },
      f.context,
    )
    assert.ok('plan' in prepared)
    assert.equal(
      (await new MemoryPublisher(f.engine, f.env).publish(prepared.plan, f.context)).stage,
      'reconciled_committed',
    )
    const snapshot = f.store.snapshot()
    assert.equal(snapshot.files[path], undefined)
    assert.ok(snapshot.forgottenPaths.includes(path))
  } finally {
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
      engineError(),
    )
    assert.deepEqual(
      await restarted.request(
        'conflicts',
        { project: 'project', target: proposal.view, path: 'global/file-0.md', offset: 6, limit: 3 },
        f.context,
      ),
      page,
      'same retained proposal remains available to the correct project',
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
      engineError(),
    )
    assert.equal(
      (await restarted.request('conflicts', { project: 'project' }, f.context)).total,
      1,
      'validated discovery metadata remains available when exact recovery fails',
    )
    const tamperedDoctor = (await restarted.request(
      'manage',
      { action: 'doctor', project: 'project' },
      f.context,
    )) as unknown as { doctor: { conflicts: number } }
    assert.equal(tamperedDoctor.doctor.conflicts, 1)
    // Explicitly restore only this test's tamper to probe a separate negative boundary.
    writeFileSync(manifest, originalManifest)
    assert.equal((await restarted.request('conflicts', { project: 'project' }, f.context)).total, 1)
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
      engineError(),
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

test('bounded synthetic non-learning/uncertainty episodes checkpoint reviewed metadata without knowledge changes', async () => {
  const f = fixture(0)
  try {
    const episodes: Episode[] = Array.from({ length: 5 }, (_, i) => ({
      id: digest(`episode-${i}`),
      project: 'project',
      session: 'synthetic-session',
      evidence: 'observed-native-unverified',
      observedAt: `2026-01-01T00:00:0${i}.000Z`,
      entryHash: digest(`entry-${i}`),
      input: {
        text:
          i % 2 === 0
            ? 'For this one response only, use a shorter explanation.'
            : 'Maybe use a different formatter; I have not decided on a durable preference.',
        source: 'rpc',
      },
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
    const knowledgeBefore = f.store.snapshot().files
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
      f.store.snapshot().files,
      knowledgeBefore,
      'reviewed no-change checkpoint is not invented learning',
    )
    assert.deepEqual(
      await f.engine.request('episodes', { project: 'project' }, f.context),
      f.store.pendingEpisodes('project'),
    )
    const forgotten = episodes[4]
    f.store.forget(f.store.snapshot().revision, [], [forgotten.id], 'project')
    const episodeState = () =>
      Object.fromEntries(
        readdirSync(join(f.root, '.episodes'))
          .sort()
          .map((name) => [name, readFileSync(join(f.root, '.episodes', name))]),
      )
    const beforeRejectedObservations = episodeState()
    await assert.rejects(f.engine.request('observe', { episode: forgotten }, f.context), engineError())
    assert.deepEqual(episodeState(), beforeRejectedObservations, 'forgotten episode is not recreated')
    const invalid = { ...episodes[0], actions: Array.from({ length: 5 }, () => ({ text: 'Too many' })) }
    assert.throws(() => f.store.recordEpisode(invalid.id, invalid), /episode/)
    await assert.rejects(f.engine.request('observe', { episode: invalid }, f.context), engineError())
    const changed = { ...episodes[0], input: { text: 'Changed', source: 'rpc' } }
    assert.throws(() => f.store.recordEpisode(changed.id, changed), /changed/)
    await assert.rejects(f.engine.request('observe', { episode: changed }, f.context), engineError())
    assert.deepEqual(episodeState(), beforeRejectedObservations, 'no rejected observation replaces bytes')
    assert.deepEqual(await f.engine.request('observe', { episode: episodes[0] }, f.context), {
      recorded: true,
    })
    assert.deepEqual(episodeState(), beforeRejectedObservations, 'unchanged observation remains idempotent')
  } finally {
    await f.close()
  }
})

test('bounded synthetic durable correction replaces its existing owner, not an incident append', async () => {
  const f = fixture(1)
  try {
    const episode: Episode = {
      id: digest('synthetic-durable-correction'),
      project: 'project',
      session: 'synthetic-session',
      evidence: 'observed-native-unverified',
      observedAt: '2026-01-01T00:00:00.000Z',
      entryHash: digest('synthetic-correction-entry'),
      input: {
        text: 'Correct the reusable method: verify the current owner before changing shared state, because stale observations can mislead.',
        source: 'rpc',
      },
      actions: [{ text: 'Verified the owner against current source.', tools: ['bash'] }],
      results: [{ tool: 'bash', error: false, text: 'Current owner verified.' }],
      outcome: 'completed',
    }
    await f.engine.request('observe', { episode }, f.context)
    const before = f.store.snapshot()
    const { view } = await f.engine.request('create', { project: 'project' }, f.context)
    const owner = await read(f, view, 'global/file-0.md')
    assert.ok('hash' in owner && typeof owner.hash === 'string')
    const correction =
      '# Reusable method\nVerify the current owner before changing shared state. Stale observations can mislead.\n'
    await f.engine.request(
      'edit',
      { view, path: 'global/file-0.md', expectedHash: owner.hash, text: correction, sources: [episode.id] },
      f.context,
    )
    await f.engine.request('ready', { view }, f.context)
    const prepared = await f.engine.request('prepare', { view, reviewed: [episode.id] }, f.context)
    assert.ok('plan' in prepared)
    assert.equal(
      (await new MemoryPublisher(f.engine, f.env).publish(prepared.plan, f.context)).stage,
      'reconciled_committed',
    )
    const after = f.store.snapshot()
    assert.deepEqual(
      Object.keys(after.files).sort(),
      Object.keys(before.files).sort(),
      'no dated incident file added',
    )
    assert.equal(after.files['global/file-0.md'].text, correction)
    assert.deepEqual(after.files['global/file-0.md'].sources, [episode.id])
    assert.equal(after.files['Core.md'].text, before.files['Core.md'].text)
    assert.equal(f.store.pendingEpisodes('project').length, 0)
    assert.ok(
      !Object.values(after.files).some((file) => file.text.includes('Synthetic body')),
      'contradicted owner text replaced rather than accumulated',
    )
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
    const expectedConfig = { config: f.config, configHash: digest(JSON.stringify(f.config)) }
    assert.deepEqual(await f.engine.request('config', {}, f.context), expectedConfig)
    const alias = join(f.dir, 'alias')
    linkSync(join(f.root, 'config.json'), alias)
    await assert.rejects(f.engine.request('config', {}, f.context), engineError())
    assert.equal(lstatSync(join(f.root, 'config.json')).nlink, 2)
    rmSync(alias)
    assert.deepEqual(await f.engine.request('config', {}, f.context), expectedConfig)
    chmodSync(join(f.root, 'config.json'), 0o644)
    await assert.rejects(f.engine.request('config', {}, f.context), engineError())
    assert.equal(lstatSync(join(f.root, 'config.json')).mode & 0o777, 0o644)
    chmodSync(join(f.root, 'config.json'), 0o600)
    assert.deepEqual(await f.engine.request('config', {}, f.context), expectedConfig)
    assert.deepEqual(newConfig(JSON.stringify(f.config)), parseConfig(JSON.stringify(f.config)))
    for (const path of [
      'Core.md',
      'index.md',
      'global/a.md',
      'procedures/a.md',
      'deferred/project/a.md',
      'archives/project/history/a.md',
      'archives/legacy-v1-abcdef123456/deferred/project/a.md',
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
  const plan = await ready(f, view)
  const chunk = await f.engine.request(
    'chunk',
    { plan: plan.id, digest: plan.digest, path: 'Core.md', offset: 0 },
    f.context,
  )
  assert.equal(Buffer.from(chunk.data, 'base64').toString('utf8'), '# Durable proposal\n')
  return plan
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
      const recoveredJournal = readFileSync(journal)
      await assert.rejects(
        fresh.request('chunk', { plan: plan.id, digest: plan.digest, path: 'Core.md', offset: 0 }, f.context),
        engineError(),
      )
      assert.deepEqual(
        readFileSync(journal),
        recoveredJournal,
        'recovered observation grants no chunk authority',
      )
      assert.deepEqual(readFileSync(proposal), proposalBefore)
      assert.equal(f.git('rev-parse', 'HEAD'), before)
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
        engineError(),
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
      const journalBeforeCreate = readFileSync(journal)
      const lockBeforeCreate = readFileSync(join(f.root, '.lock', 'owner.json'))
      await assert.rejects(fresh.request('create', { project: 'project' }, f.context), engineError())
      assert.deepEqual(readFileSync(journal), journalBeforeCreate)
      assert.deepEqual(readFileSync(join(f.root, '.lock', 'owner.json')), lockBeforeCreate)
      assert.equal(existsSync(`${journal}.cas`), true, 'failed create never steals retained CAS')
      assert.equal(f.git('rev-parse', 'HEAD'), committed)
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
      const journal = join(f.root, '.views', '.engine-v2', 'journal', `${receipt!.plan}.json`)
      const journalBeforeChunk = readFileSync(journal)
      const headBeforeChunk = f.git('rev-parse', 'HEAD')
      await assert.rejects(
        fresh.request(
          'chunk',
          { plan: receipt!.plan, digest: receipt!.digest, path: 'Core.md', offset: 0 },
          f.context,
        ),
        engineError(),
      )
      assert.deepEqual(
        readFileSync(journal),
        journalBeforeChunk,
        'foreign parent never gains a plan by reading',
      )
      assert.equal(f.git('rev-parse', 'HEAD'), headBeforeChunk)
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
    const lockIdentity = lstatSync(join(f.root, '.lock')).ino
    const journal = join(f.root, '.views', '.engine-v2', 'journal', `${plan.id}.json`)
    const journalBeforeCreate = readFileSync(journal)
    await assert.rejects(f.engine.request('create', { project: 'project' }, f.context), engineError())
    assert.equal(lstatSync(join(f.root, '.lock')).ino, lockIdentity, 'anonymous lock is not replaced')
    assert.deepEqual(readFileSync(journal), journalBeforeCreate)
    assert.equal(f.git('rev-parse', 'HEAD'), before)
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
      const lockBeforeCreate = readFileSync(join(f.root, '.lock', 'owner.json'))
      const journal = join(f.root, '.views', '.engine-v2', 'journal', `${plan.id}.json`)
      const journalBeforeCreate = readFileSync(journal)
      const headBeforeCreate = f.git('rev-parse', 'HEAD')
      await assert.rejects(f.engine.request('create', { project: 'project' }, f.context), engineError())
      assert.deepEqual(readFileSync(join(f.root, '.lock', 'owner.json')), lockBeforeCreate, variant)
      assert.deepEqual(readFileSync(journal), journalBeforeCreate, variant)
      assert.equal(f.git('rev-parse', 'HEAD'), headBeforeCreate, variant)
    } finally {
      await f.close()
    }
  }
})

test('query-loaded publication facades share only actual native sealed executor references', async () => {
  const url = new URL('../lib/agent-memory/engine/executor.ts', import.meta.url)
  const a = await import(`${url.href}?generation=a`)
  const b = await import(`${url.href}?generation=b`)
  const root = '/synthetic-publication-reference-test'
  const plan = { id: 'actual-operation', digest: 'actual-digest' } as Plan
  const owner = a.reserveExecutor(root, plan)
  assert.equal(b.executorDrained(root, plan.id, plan.digest), false)
  assert.equal(b.executorOwnsLock(root, plan.id, plan.digest, owner.nonce), false)
  owner.seal()
  assert.equal(b.executorDrained(root, plan.id, plan.digest), true)
  assert.equal(b.executorOwnsLock(root, plan.id, plan.digest, owner.nonce), true)
  assert.equal(b.executorOwnsLock(root, plan.id, plan.digest, 'invented'), false)
  assert.throws(() => b.reserveExecutor(root, plan), /already reserved/)
  const isolated = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { executorDrained } from ${JSON.stringify(new URL('../lib/agent-memory/engine/publication-executors.mjs', import.meta.url).href)};
     console.log(executorDrained(${JSON.stringify(root)}, 'actual-operation', 'actual-digest'))`,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(isolated.trim(), 'false')
})

test('aborted first chunk retains private staging evidence without untracked canonical temp', async () => {
  const f = fixture(0)
  try {
    const plan = await recoveryPlan(f)
    const staging = join(f.root, '.views/.engine-v2/staging', plan.id)
    let live = true
    let reached = false
    const context: OperationContext = {
      current(targets) {
        if (
          live &&
          targets.physical.some(
            (path) => path.startsWith(`${staging}/`) && path.endsWith('.tmp') && existsSync(path),
          )
        ) {
          reached = true
          live = false
        }
        return live
      },
    }
    const before = f.git('rev-parse', 'HEAD')
    const result = await new MemoryPublisher(f.engine, f.env).publish(plan, context)
    assert.equal(reached, true)
    assert.equal(result.stage, 'unknown')
    assert.equal(f.git('rev-parse', 'HEAD'), before)
    assert.equal(f.git('status', '--porcelain', '--untracked-files=all').trim(), '')
    const files = readdirSync(staging)
    assert.equal(files.length, 1)
    assert.match(files[0], /^[a-f0-9-]{36}\.tmp$/)
    assert.equal(readFileSync(join(staging, files[0])).length, 0)
    assert.equal(lstatSync(join(staging, files[0])).mode & 0o777, 0o600)
    const recovered = await new MemoryPublisher(f.engine, f.env).reconcileExisting(
      plan.id,
      plan.digest,
      f.context,
    )
    assert.equal(recovered.stage, 'not_committed_dirty')
    assert.equal(recovered.indexDirty, false)
    assert.equal(recovered.worktreeDirty, false)
    assert.equal(recovered.lockRetained, false)
    // A fresh proposal on the SAME engine must observe the durable recovery.
    // Replaying the old operation remains forbidden by its actual sealed ref.
    const next = await recoveryPlan(f)
    assert.notEqual(next.id, plan.id)
    const published = await new MemoryPublisher(f.engine, f.env).publish(next, f.context)
    assert.equal(published.stage, 'reconciled_committed')
    await assert.rejects(new MemoryPublisher(f.engine, f.env).publish(plan, f.context), /already reserved/)
  } finally {
    await f.close()
  }
})

test('Palace structure certifies committed metadata, bounds output and reauthorizes every warm active path', async () => {
  const f = fixture(140, true)
  try {
    const { configHash } = await f.engine.request('config', {}, f.context)
    const args = { project: 'project', expectedConfigHash: configHash }
    const first = await f.engine.request('palaceStructure', args, f.context)
    assert.equal(first.revision, f.store.snapshot().revision)
    assert.equal(first.configHash, configHash)
    assert.equal(first.bodyInspection, 'not-requested')
    assert.equal(first.output.total, 142)
    assert.equal(first.output.returned, 128)
    assert.equal(first.output.omitted, 14)
    assert.equal(first.output.truncated, true)
    assert.deepEqual(
      first.files.map((x) => x.path),
      first.files.map((x) => x.path).sort(),
    )
    assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 65536)
    assert.doesNotMatch(
      JSON.stringify(first),
      /Synthetic body|source-one|mahiro-engine-|sources"|links|views|episodes/,
    )
    const before = await f.engine.request('stats', {}, f.context)
    const seen = new Set<string>()
    const warm = await f.engine.request('palaceStructure', args, {
      current: (targets) => {
        for (const p of targets.logical) seen.add(p)
        return true
      },
    })
    assert.deepEqual(warm, first)
    assert.equal([...seen].filter((p) => newPath(p)).length, 142)
    assert.ok(seen.has('Core.md'))
    assert.deepEqual((await f.engine.request('stats', {}, f.context)).blobReads, before.blobReads)
    const omitted = [...seen].find((p) => newPath(p) && !first.files.some((x) => x.path === p))!
    await assert.rejects(
      f.engine.request('palaceStructure', args, { current: (targets) => !targets.logical.includes(omitted) }),
    )
  } finally {
    await f.close()
  }
})

test('Palace structure refuses expected-config mismatch, unmapped project and final config or HEAD drift', async () => {
  for (const race of ['mismatch', 'project', 'config', 'head']) {
    const f = fixture(1)
    try {
      const { configHash } = await f.engine.request('config', {}, f.context)
      // Warm certificates make the path-wide checkpoint a deterministic final-reread seam.
      await f.engine.request(
        'palaceStructure',
        { project: 'project', expectedConfigHash: configHash },
        f.context,
      )
      let changed = false
      const context: OperationContext = {
        current: (targets) => {
          if (!changed && targets.kind === 'data' && targets.logical.includes('Core.md')) {
            changed = true
            if (race === 'config')
              writeFileSync(join(f.root, 'config.json'), JSON.stringify({ ...f.config, automatic: true }))
            if (race === 'head')
              f.git(
                '-c',
                'user.name=Synthetic',
                '-c',
                'user.email=fixture@example.invalid',
                'commit',
                '--allow-empty',
                '-m',
                'Synthetic drift',
              )
          }
          return true
        },
      }
      await assert.rejects(
        f.engine.request(
          'palaceStructure',
          {
            project: race === 'project' ? 'unmapped' : 'project',
            expectedConfigHash: race === 'mismatch' ? '0'.repeat(64) : configHash,
          },
          context,
        ),
      )
      if (race === 'config' || race === 'head') assert.equal(changed, true)
    } finally {
      await f.close()
    }
  }
})

test('Palace structure ignores worktree text and filters committed suppression without body inspection', async () => {
  const f = fixture(2)
  try {
    const { configHash } = await f.engine.request('config', {}, f.context)
    const args = { project: 'project', expectedConfigHash: configHash }
    const first = await f.engine.request('palaceStructure', args, f.context)
    writeFileSync(join(f.root, 'global/file-0.md'), 'PRIVATE_WORKTREE_SENTINEL')
    assert.deepEqual(await f.engine.request('palaceStructure', args, f.context), first)
    const ledger = JSON.parse(readFileSync(join(f.root, '.memory.json'), 'utf8'))
    ledger.forgottenPaths.push('global/file-1.md')
    writeFileSync(join(f.root, '.memory.json'), JSON.stringify(ledger))
    f.git('add', '.memory.json')
    f.git(
      '-c',
      'user.name=Synthetic',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'Synthetic suppression',
    )
    const next = await f.engine.request('palaceStructure', args, f.context)
    assert.equal(next.output.total, first.output.total - 1)
    assert.ok(!next.files.some((x) => x.path === 'global/file-1.md'))
    assert.notEqual(next.snapshotDigest, first.snapshotDigest)
    assert.notEqual(next.structureDigest, first.structureDigest)
  } finally {
    await f.close()
  }
})

test('scoped memory read suggests an in-map path and withholds out-of-scope names', async () => {
  const f = fixture(0)
  try {
    const seed = f.store.createView('project', 120000, true)
    const files: Record<string, string> = {
      'reference/area/leaf.md': '# Area leaf\n',
      'projects/project/reference/leaf.md': '# Project leaf\n',
      'reference/new.md': '# New\n',
      'reference/area/new.md': '# Nested new\n',
      'deferred/other/leaf.md': 'PRIVATE_OTHER_LEAF\n',
      'deferred/other/unique-private.md': 'PRIVATE_UNIQUE_BODY\n',
      'global/notes.md': '# Notes\n',
      'procedures/notes.md': '# Notes\n',
      'projects/project/reference/notes.md': '# Notes\n',
      'projects/project/system/notes.md': '# Notes\n',
      'reference/area/notes.md': '# Notes\n',
      'system/human/notes.md': '# Notes\n',
    }
    for (const [path, text] of Object.entries(files)) f.store.edit(seed, path, null, text)
    f.store.integrate(seed)
    const read = (path: string) =>
      f.engine.request(
        'headRead',
        { project: 'project', shared: false, selection: { path } },
        f.context,
      ) as Promise<any>
    const present = await read('reference/area/leaf.md')
    assert.equal(present.missing, undefined)
    assert.match(present.text, /# Area leaf/)
    assert.equal('suggestions' in present, false)
    const leaf = await read('reference/leaf.md')
    assert.equal(leaf.missing, true)
    assert.equal(leaf.hash, null)
    assert.deepEqual(leaf.suggestions, ['projects/project/reference/leaf.md', 'reference/area/leaf.md'])
    assert.equal(
      leaf.hint,
      'No memory at reference/leaf.md. Did you mean projects/project/reference/leaf.md or reference/area/leaf.md? Paths are relative to the memory directory.',
    )
    assert.equal(JSON.stringify(leaf).includes('PRIVATE_OTHER_LEAF'), false)
    assert.equal(JSON.stringify(leaf).includes('deferred/other'), false)
    const extension = await read('reference/new')
    assert.deepEqual(extension.suggestions, ['reference/new.md'])
    assert.match(extension.hint, /Did you mean reference\/new\.md\?/)
    assert.equal(extension.hint.includes('reference/area/new.md'), false)
    const rootName = await read('reference/index.md')
    assert.equal(rootName.missing, true)
    assert.equal('suggestions' in rootName, false)
    assert.equal('hint' in rootName, false)
    const notes = await read('reference/notes.md')
    assert.deepEqual(notes.suggestions, [
      'global/notes.md',
      'procedures/notes.md',
      'projects/project/reference/notes.md',
      'projects/project/system/notes.md',
      'reference/area/notes.md',
    ])
    assert.equal(notes.suggestions.includes('system/human/notes.md'), false)
    const refused = async (path: string) => {
      await assert.rejects(read(path), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(error.message, 'Engine operation unavailable')
        assert.equal(error.message.includes('Did you mean'), false)
        assert.equal(error.message.includes('PRIVATE_'), false)
        assert.deepEqual(memoryFailureCode(error), { reason: 'unknown' })
        return true
      })
    }
    await refused('deferred/other/leaf.md')
    await refused('deferred/other/unique-private.md')
    await refused('../reference/area/leaf.md')
  } finally {
    await f.close()
  }
})
