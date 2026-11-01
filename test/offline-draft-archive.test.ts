import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { digest } from '../lib/continuity/records.ts'
import { memoryFailureCode } from '../lib/agent-memory/reasons.ts'
import { MemoryEngineController, type OperationContext } from '../lib/agent-memory/engine/controller.ts'
import { offlineAssurance, offlineMaintenance, read } from '../lib/agent-memory/engine/offline-maintenance.ts'
import { parseOperation } from '../lib/agent-memory/engine/operation.ts'
import { createMemoryStore } from '../lib/agent-memory/store.ts'

const kernelAvailable =
  process.platform === 'darwin'
    ? existsSync('/usr/sbin/lsof')
    : process.platform === 'linux' && existsSync('/usr/bin/lsof')

function journalId(index: number) {
  const hex = index.toString(16)
  return `${hex.padStart(8, '0')}-0000-4000-8000-${hex.padStart(12, '0')}`
}
function draftManifest(id: string, revision: string, state: string, dirty = false) {
  const hash = 'a'.repeat(64)
  return JSON.stringify({
    version: 2,
    id,
    project: 'fixture',
    shared: false,
    configHash: hash,
    base: {
      revision,
      refs: {
        'Core.md': { oid: revision, hash, size: 1, sources: [] },
        'index.md': { oid: revision, hash, size: 1, sources: [] },
      },
      ledger: {
        forgottenPaths: [],
        forgottenSources: [],
        reviewed: [],
        sources: { 'Core.md': [], 'index.md': [] },
        version: 2,
      },
    },
    overlay: dirty
      ? {
          'global/notes.md': {
            blob: '00000000-0000-4000-8000-000000000099',
            hash,
            size: 1,
            sources: [],
            identity: '1:1',
          },
        }
      : {},
    state,
    deadline: 0,
  })
}
function referencingJournal(root: string, revision: string, view: string) {
  const ledger = {
    forgottenPaths: [],
    forgottenSources: [],
    reviewed: [],
    sources: { 'Core.md': [], 'index.md': [] },
    version: 2,
  }
  const ledgerText = JSON.stringify(ledger)
  const blob = 'a'.repeat(64)
  const planMeta = {
    id: '00000000-0000-4000-8000-000000000001',
    view,
    base: revision,
    current: revision,
    configHash: blob,
    ledgerHash: digest(ledgerText),
    changes: [],
  }
  const plan = { ...planMeta, digest: digest(JSON.stringify(planMeta)) }
  const immutable = {
    root,
    rootIdentity: '1:1',
    plan,
    next: {
      'Core.md': { hash: blob, size: 1, sources: [] },
      'index.md': { hash: blob, size: 1, sources: [] },
    },
    ledger,
    ledgerText,
    proposalHash: blob,
    tree: [`100644 blob ${blob}\tCore.md`, `100644 blob ${blob}\tindex.md`],
  }
  const record = {
    version: 1,
    immutable,
    immutableHash: digest(JSON.stringify(immutable)),
    sequence: 0,
    owner: null,
    receipt: { stage: 'reconciled_committed', observedCommit: revision },
  }
  parseOperation(JSON.stringify(record))
  return JSON.stringify(record)
}
function filesUnder(root: string) {
  const found: string[] = []
  const visit = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name)
      let directory = false
      try {
        readdirSync(path)
        directory = true
      } catch {
        directory = false
      }
      if (directory) visit(path)
      else found.push(path)
    }
  }
  visit(root)
  return found
}
async function fixture(spec: { candidates: number; referenced?: boolean; unresolved?: number }) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-draft-archive-'))
  const root = join(directory, 'memory')
  const project = join(directory, 'project')
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
    '# Fixture\nPreserved core.\n',
  )
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const draftDir = join(root, '.views/.engine-v2/drafts')
  const journalDir = join(root, '.views/.engine-v2/journal')
  mkdirSync(draftDir, { recursive: true, mode: 0o700 })
  mkdirSync(journalDir, { recursive: true, mode: 0o700 })
  const candidates = Array.from({ length: spec.candidates }, (_, index) => journalId(index))
  const referenced = spec.referenced ? journalId(spec.candidates) : undefined
  const unresolved = Array.from({ length: spec.unresolved ?? 0 }, (_, index) =>
    journalId(spec.candidates + 1 + index),
  )
  const bodies = new Map<string, string>()
  for (const id of candidates) bodies.set(id, draftManifest(id, revision, 'cancelled'))
  if (referenced) {
    bodies.set(referenced, draftManifest(referenced, revision, 'cancelled'))
    writeFileSync(
      join(journalDir, `${journalId(900)}.json`),
      referencingJournal(root, revision, referenced),
      {
        mode: 0o600,
      },
    )
  }
  unresolved.forEach((id, index) => {
    const state = ['open', 'ready', 'conflict', 'cancelled', '{'][index] ?? 'open'
    bodies.set(
      id,
      state === '{'
        ? '{'
        : draftManifest(id, revision, state === 'cancelled' ? 'cancelled' : state, state === 'cancelled'),
    )
  })
  for (const [id, body] of bodies) writeFileSync(join(draftDir, `${id}.json`), body, { mode: 0o600 })
  const prior = join(root, '.views/.maintenance/prior/old-archive.txt')
  mkdirSync(join(root, '.views/.maintenance/prior'), { recursive: true, mode: 0o700 })
  writeFileSync(prior, 'PRIOR_ARCHIVE_SENTINEL', { mode: 0o600 })
  const context: OperationContext = { current: () => true }
  const engine = new MemoryEngineController(root)
  const core = readFileSync(join(root, 'Core.md'))
  const ledger = readFileSync(join(root, '.memory.json'))
  return {
    directory,
    root,
    draftDir,
    context,
    engine,
    candidates,
    referenced,
    bodies,
    core,
    ledger,
    prior,
    head: `${revision}\n`,
    async close() {
      await engine.close()
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('sixty-four retained drafts archive only strict terminal manifests and leave admission room', {
  skip: !kernelAvailable,
}, async () => {
  const unresolved = [
    ['open', 'open'],
    ['ready', 'ready'],
    ['conflict', 'conflict'],
    ['dirty', 'cancelled'],
    ['malformed', '{'],
    ...Array.from({ length: 35 }, () => ['open', 'open'] as const),
  ]
  const f = await fixture({ candidates: 23, referenced: true, unresolved: unresolved.length })
  try {
    unresolved.forEach(([, state], index) => {
      const id = journalId(24 + index)
      const body = state === '{' ? '{' : draftManifest(id, f.head.trim(), state, index === 3)
      writeFileSync(join(f.draftDir, `${id}.json`), body, { mode: 0o600 })
      f.bodies.set(id, body)
    })
    assert.equal(readdirSync(f.draftDir).length, 64)
    await assert.rejects(
      f.engine.request('create', { project: 'fixture', shared: true }, f.context),
      (error: unknown) => {
        assert.equal(memoryFailureCode(error).reason, 'capacity')
        return true
      },
    )
    const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
    assert.equal(preview && 'candidates' in preview && preview.candidates, 23)
    assert.equal('journalReferenced' in preview && preview.journalReferenced, 1)
    assert.equal('exact' in preview && preview.exact, true)
    assert.equal('archiveAvailable' in preview && preview.archiveAvailable, true)
    assert.equal('hostileProcessGuarantee' in preview && preview.hostileProcessGuarantee, false)
    assert.equal('corpusReturned' in preview && preview.corpusReturned, false)
    assert.equal('admissionRoom' in preview && preview.admissionRoom, 23)
    assert.doesNotMatch(JSON.stringify(preview), /Preserved core|PRIOR_ARCHIVE_SENTINEL|\.views/)
    const result = await offlineMaintenance(f.engine, f.context, {
      action: 'offline-draft-archive',
      target: preview && 'target' in preview ? preview.target : '',
      revision: preview && 'revision' in preview ? preview.revision : '',
      offline: offlineAssurance,
    })
    assert.equal(result && 'archived' in result && result.archived, 23)
    assert.equal(result && 'hostileProcessGuarantee' in result && result.hostileProcessGuarantee, false)
    assert.equal(existsSync(join(f.root, '.views/.maintenance-active.json')), false)
    assert.equal(readdirSync(f.draftDir).length, 41)
    for (const id of f.candidates) assert.equal(existsSync(join(f.draftDir, `${id}.json`)), false)
    if (f.referenced)
      assert.equal(readFileSync(join(f.draftDir, `${f.referenced}.json`), 'utf8'), f.bodies.get(f.referenced))
    assert.equal(readFileSync(f.prior, 'utf8'), 'PRIOR_ARCHIVE_SENTINEL')
    assert.deepEqual(readFileSync(join(f.root, 'Core.md')), f.core)
    assert.deepEqual(readFileSync(join(f.root, '.memory.json')), f.ledger)
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root, encoding: 'utf8' }), f.head)
    const snapshot = filesUnder(
      join(
        f.root,
        '.views/.maintenance',
        String(result && 'target' in result ? result.target : ''),
        'snapshot',
      ),
    )
    assert.equal(snapshot.length, 23)
    assert.equal(
      snapshot.some((path) => readFileSync(path, 'utf8').includes('PRIOR_ARCHIVE_SENTINEL')),
      false,
    )
    const created = await f.engine.request('create', { project: 'fixture', shared: true }, f.context)
    assert.ok(created.view)
    await f.engine.request('cancel', { view: created.view }, f.context)
  } finally {
    await f.close()
  }
})

test('a changed unresolved draft refuses archive before any move', { skip: !kernelAvailable }, async () => {
  const f = await fixture({ candidates: 1, unresolved: 1 })
  try {
    const open = journalId(2)
    writeFileSync(join(f.draftDir, `${open}.json`), draftManifest(open, f.head.trim(), 'open'), {
      mode: 0o600,
    })
    const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
    writeFileSync(join(f.draftDir, `${open}.json`), draftManifest(open, f.head.trim(), 'ready'), {
      mode: 0o600,
    })
    await assert.rejects(
      offlineMaintenance(f.engine, f.context, {
        action: 'offline-draft-archive',
        target: preview && 'target' in preview ? preview.target : '',
        revision: preview && 'revision' in preview ? preview.revision : '',
        offline: offlineAssurance,
      }),
      /fingerprint and operator assurance required|inventory changed/,
    )
    assert.equal(existsSync(join(f.root, '.views/.maintenance-active.json')), false)
    assert.equal(existsSync(join(f.draftDir, `${f.candidates[0]}.json`)), true)
  } finally {
    await f.close()
  }
})

test('an external Root descriptor refuses terminal draft archive', { skip: !kernelAvailable }, async () => {
  const f = await fixture({ candidates: 1 })
  let childPid: number | undefined
  try {
    const launcher = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { spawn } from 'node:child_process';
        const c = spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(`
          import { openSync, writeFileSync } from 'node:fs';
          openSync(${JSON.stringify(join(f.root, '.git'))}, 'r');
          process.chdir('/');
          writeFileSync(${JSON.stringify(join(f.directory, 'holder-ready'))}, String(process.pid));
          setInterval(() => {}, 1000);
        `)}], { detached: true, stdio: 'ignore', cwd: '/' }); c.unref();`,
      ],
      { stdio: 'ignore', cwd: '/' },
    )
    await new Promise<void>((resolve) => launcher.once('exit', () => resolve()))
    for (let i = 0; i < 100 && !existsSync(join(f.directory, 'holder-ready')); i++)
      await new Promise((resolve) => setTimeout(resolve, 20))
    childPid = Number(readFileSync(join(f.directory, 'holder-ready'), 'utf8'))
    await assert.rejects(
      offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' }),
      /Unexpected kernel Root holder/,
    )
    assert.equal(existsSync(join(f.root, '.views/.maintenance-active.json')), false)
    assert.equal(existsSync(join(f.draftDir, `${f.candidates[0]}.json`)), true)
  } finally {
    if (childPid) process.kill(childPid, 'SIGTERM')
    await f.close()
  }
})

test('a dormant second controller is not treated as a hostile-process proof', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ candidates: 1 })
  const other = new MemoryEngineController(f.root)
  try {
    await other.request('config', {}, { current: () => true })
    const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
    let result = await offlineMaintenance(f.engine, f.context, {
      action: 'offline-draft-archive',
      target: preview && 'target' in preview ? preview.target : '',
      revision: preview && 'revision' in preview ? preview.revision : '',
      offline: offlineAssurance,
    }).catch(async (error: unknown) => {
      assert.match(String(error), /Unexpected kernel Root holder/)
      await other.close()
      const again = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
      return offlineMaintenance(f.engine, f.context, {
        action: 'offline-draft-archive',
        target: again && 'target' in again ? again.target : '',
        revision: again && 'revision' in again ? again.revision : '',
        offline: offlineAssurance,
      })
    })
    assert.equal(result && 'hostileProcessGuarantee' in result && result.hostileProcessGuarantee, false)
    assert.equal(existsSync(join(f.draftDir, `${f.candidates[0]}.json`)), false)
  } finally {
    await other.close()
    await f.close()
  }
})

function interrupt(root: string, preview: { target?: string; revision?: string }) {
  const moduleURL = new URL('../lib/agent-memory/engine/offline-maintenance.ts', import.meta.url).href
  const controllerURL = new URL('../lib/agent-memory/engine/controller.ts', import.meta.url).href
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `
      import { existsSync, readdirSync } from 'node:fs';
      import { join } from 'node:path';
      import { offlineMaintenance, offlineAssurance } from ${JSON.stringify(moduleURL)};
      import { MemoryEngineController } from ${JSON.stringify(controllerURL)};
      const root = ${JSON.stringify(root)};
      const stable = () => {
        const base = join(root, '.views/.maintenance');
        if (!existsSync(base)) return false;
        for (const id of readdirSync(base)) {
          const dir = join(base, id, 'quarantine/.views/.engine-v2/drafts');
          if (!existsSync(dir)) continue;
          const names = readdirSync(dir);
          if (names.length !== 1) continue;
          return !existsSync(join(root, '.views/.engine-v2/drafts', names[0]));
        }
        return false;
      };
      const context = { current() { if (existsSync(join(root, '.views/.maintenance-active.json')) && stable()) process.exit(73); return true; } };
      await offlineMaintenance(new MemoryEngineController(root), context, {
        action: 'offline-draft-archive',
        target: ${JSON.stringify(preview.target)},
        revision: ${JSON.stringify(preview.revision)},
        offline: offlineAssurance,
      });
    `,
    ],
    { cwd: '/', env: process.env, encoding: 'utf8', timeout: 30000 },
  )
}

test('interrupted rename resumes only from source xor quarantine', { skip: !kernelAvailable }, async () => {
  const f = await fixture({ candidates: 2, unresolved: 1 })
  try {
    const open = journalId(3)
    const openBody = draftManifest(open, f.head.trim(), 'open')
    writeFileSync(join(f.draftDir, `${open}.json`), openBody, { mode: 0o600 })
    await f.engine.close()
    const engine = new MemoryEngineController(f.root)
    const preview = await offlineMaintenance(engine, f.context, { action: 'offline-draft-inspect' })
    await engine.close()
    const child = interrupt(f.root, preview && 'target' in preview ? preview : {})
    assert.equal(child.status, 73, child.stderr)
    const resumeEngine = new MemoryEngineController(f.root)
    const checkpoint = await offlineMaintenance(resumeEngine, f.context, { action: 'offline-draft-inspect' })
    assert.equal(existsSync(join(f.root, '.views/.maintenance-active.json')), true)
    await offlineMaintenance(resumeEngine, f.context, {
      action: 'offline-draft-resume',
      target: checkpoint && 'target' in checkpoint ? checkpoint.target : '',
      revision: checkpoint && 'revision' in checkpoint ? checkpoint.revision : '',
      offline: offlineAssurance,
    })
    assert.equal(existsSync(join(f.root, '.views/.maintenance-active.json')), false)
    for (const id of f.candidates) assert.equal(existsSync(join(f.draftDir, `${id}.json`)), false)
    assert.equal(readFileSync(join(f.draftDir, `${open}.json`), 'utf8'), openBody)
    await resumeEngine.close()
  } finally {
    await f.close()
  }
})

test('rollback restores only an absent original and refuses when both copies exist', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ candidates: 2 })
  try {
    await f.engine.close()
    const engine = new MemoryEngineController(f.root)
    const preview = await offlineMaintenance(engine, f.context, { action: 'offline-draft-inspect' })
    await engine.close()
    const child = interrupt(f.root, preview && 'target' in preview ? preview : {})
    assert.equal(child.status, 73, child.stderr)
    const moved = f.candidates.find((id) => !existsSync(join(f.draftDir, `${id}.json`)))
    const stayed = f.candidates.find((id) => existsSync(join(f.draftDir, `${id}.json`)))
    assert.ok(moved && stayed)
    const quarantine = filesUnder(join(f.root, '.views/.maintenance')).find(
      (path) => path.endsWith(`${moved}.json`) && path.includes('/quarantine/'),
    )
    assert.ok(quarantine)
    writeFileSync(join(f.draftDir, `${moved}.json`), readFileSync(quarantine))
    const rollbackEngine = new MemoryEngineController(f.root)
    const checkpoint = await offlineMaintenance(rollbackEngine, f.context, {
      action: 'offline-draft-inspect',
    })
    await assert.rejects(
      offlineMaintenance(rollbackEngine, f.context, {
        action: 'offline-draft-rollback',
        target: checkpoint && 'target' in checkpoint ? checkpoint.target : '',
        revision: checkpoint && 'revision' in checkpoint ? checkpoint.revision : '',
        offline: offlineAssurance,
      }),
      /uncertain/,
    )
    assert.equal(existsSync(join(f.root, '.views/.maintenance-active.json')), true)
    assert.equal(readFileSync(join(f.draftDir, `${moved}.json`), 'utf8'), readFileSync(quarantine, 'utf8'))
    await rollbackEngine.close()
  } finally {
    await f.close()
  }
})

test('explicit rollback puts an interrupted candidate back at its original path', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ candidates: 2, unresolved: 1 })
  try {
    const open = journalId(3)
    const openBody = draftManifest(open, f.head.trim(), 'open')
    writeFileSync(join(f.draftDir, `${open}.json`), openBody, { mode: 0o600 })
    await f.engine.close()
    const engine = new MemoryEngineController(f.root)
    const preview = await offlineMaintenance(engine, f.context, { action: 'offline-draft-inspect' })
    await engine.close()
    const child = interrupt(f.root, preview && 'target' in preview ? preview : {})
    assert.equal(child.status, 73, child.stderr)
    const rollbackEngine = new MemoryEngineController(f.root)
    const checkpoint = await offlineMaintenance(rollbackEngine, f.context, {
      action: 'offline-draft-inspect',
    })
    const result = await offlineMaintenance(rollbackEngine, f.context, {
      action: 'offline-draft-rollback',
      target: checkpoint && 'target' in checkpoint ? checkpoint.target : '',
      revision: checkpoint && 'revision' in checkpoint ? checkpoint.revision : '',
      offline: offlineAssurance,
    })
    assert.equal(result && 'restored' in result && result.restored, 2)
    assert.equal(existsSync(join(f.root, '.views/.maintenance-active.json')), false)
    for (const id of f.candidates)
      assert.equal(readFileSync(join(f.draftDir, `${id}.json`), 'utf8'), f.bodies.get(id))
    assert.equal(readFileSync(join(f.draftDir, `${open}.json`), 'utf8'), openBody)
    const snapshot = filesUnder(join(f.root, '.views/.maintenance')).filter((path) =>
      path.includes('/snapshot/'),
    )
    assert.equal(snapshot.length, 2)
    await rollbackEngine.close()
  } finally {
    await f.close()
  }
})

test('same-process rollback loses to resume and does not release the marker', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ candidates: 2 })
  try {
    await f.engine.close()
    const engine = new MemoryEngineController(f.root)
    const preview = await offlineMaintenance(engine, f.context, { action: 'offline-draft-inspect' })
    await engine.close()
    const child = interrupt(f.root, preview && 'target' in preview ? preview : {})
    assert.equal(child.status, 73, child.stderr)
    const resumeEngine = new MemoryEngineController(f.root)
    const checkpoint = await offlineMaintenance(resumeEngine, f.context, { action: 'offline-draft-inspect' })
    const marker = join(f.root, '.views/.maintenance-active.json')
    let loser: Promise<unknown> = Promise.resolve()
    let started = false
    const context: OperationContext = {
      current() {
        if (!started) {
          started = true
          loser = offlineMaintenance(
            resumeEngine,
            { current: () => true },
            {
              action: 'offline-draft-rollback',
              target: checkpoint && 'target' in checkpoint ? checkpoint.target : '',
              revision: checkpoint && 'revision' in checkpoint ? checkpoint.revision : '',
              offline: offlineAssurance,
            },
          ).then(
            () => {
              throw Error('rollback released the barrier')
            },
            (error: unknown) => {
              if (!existsSync(marker)) throw Error('rollback released the barrier')
              return error
            },
          )
        }
        return true
      },
    }
    await offlineMaintenance(resumeEngine, context, {
      action: 'offline-draft-resume',
      target: checkpoint && 'target' in checkpoint ? checkpoint.target : '',
      revision: checkpoint && 'revision' in checkpoint ? checkpoint.revision : '',
      offline: offlineAssurance,
    })
    const error = await loser
    assert.match(String(error), /execution owner held/)
    assert.equal(existsSync(marker), false)
    for (const id of f.candidates) assert.equal(existsSync(join(f.draftDir, `${id}.json`)), false)
    await resumeEngine.close()
  } finally {
    await f.close()
  }
})

function markerSeam(root: string, preview: { target?: string; revision?: string }, failWrite: boolean) {
  const moduleURL = new URL('../lib/agent-memory/engine/offline-maintenance.ts', import.meta.url).href
  const controllerURL = new URL('../lib/agent-memory/engine/controller.ts', import.meta.url).href
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `
      import { chmodSync, existsSync, readdirSync } from 'node:fs';
      import { join } from 'node:path';
      import { offlineMaintenance, offlineAssurance } from ${JSON.stringify(moduleURL)};
      import { MemoryEngineController } from ${JSON.stringify(controllerURL)};
      const root = ${JSON.stringify(root)};
      const views = join(root, '.views');
      const marker = join(views, '.maintenance-active.json');
      const partial = () => existsSync(views) && readdirSync(views).some((name) => name.startsWith('maintenance-marker-'));
      const context = { current() {
        if (!partial() || existsSync(marker)) return true;
        if (${failWrite ? 'true' : 'false'}) { chmodSync(views, 0o500); return true; }
        process.exit(74);
      } };
      await offlineMaintenance(new MemoryEngineController(root), context, {
        action: 'offline-draft-archive',
        target: ${JSON.stringify(preview.target)},
        revision: ${JSON.stringify(preview.revision)},
        offline: offlineAssurance,
      });
    `,
    ],
    { cwd: '/', env: process.env, encoding: 'utf8', timeout: 30000 },
  )
}

test('marker publication interruption and write failure leave no marker', {
  skip: !kernelAvailable,
}, async () => {
  for (const failWrite of [false, true]) {
    const f = await fixture({ candidates: 1 })
    try {
      const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
      await f.engine.close()
      const child = markerSeam(f.root, preview && 'target' in preview ? preview : {}, failWrite)
      chmodSync(join(f.root, '.views'), 0o700)
      if (failWrite) assert.notEqual(child.status, 0)
      else assert.equal(child.status, 74, child.stderr)
      assert.equal(existsSync(join(f.root, '.views/.maintenance-active.json')), false)
      assert.equal(existsSync(join(f.draftDir, `${f.candidates[0]}.json`)), true)
      const engine = new MemoryEngineController(f.root)
      const again = await offlineMaintenance(engine, f.context, { action: 'offline-draft-inspect' })
      assert.equal('archiveAvailable' in again && again.archiveAvailable, true)
      assert.equal('phase' in again, false)
      await engine.close()
    } finally {
      chmodSync(join(f.root, '.views'), 0o700)
      await f.close()
    }
  }
})

test('completed resume refuses a drifted HEAD and keeps the marker', { skip: !kernelAvailable }, async () => {
  const f = await fixture({ candidates: 1 })
  try {
    const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
    await f.engine.close()
    const moduleURL = new URL('../lib/agent-memory/engine/offline-maintenance.ts', import.meta.url).href
    const controllerURL = new URL('../lib/agent-memory/engine/controller.ts', import.meta.url).href
    const child = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `
        import { existsSync, readdirSync, readFileSync } from 'node:fs';
        import { join } from 'node:path';
        import { offlineMaintenance, offlineAssurance } from ${JSON.stringify(moduleURL)};
        import { MemoryEngineController } from ${JSON.stringify(controllerURL)};
        const root = ${JSON.stringify(f.root)};
        const done = () => {
          const base = join(root, '.views/.maintenance');
          if (!existsSync(join(root, '.views/.maintenance-active.json')) || !existsSync(base)) return false;
          return readdirSync(base).some((id) => {
            const state = join(base, id, 'state.json');
            return existsSync(state) && readFileSync(state, 'utf8').includes('"phase":"completed"');
          });
        };
        const context = { current() { if (done()) process.exit(75); return true; } };
        await offlineMaintenance(new MemoryEngineController(root), context, {
          action: 'offline-draft-archive',
          target: ${JSON.stringify(preview && 'target' in preview ? preview.target : '')},
          revision: ${JSON.stringify(preview && 'revision' in preview ? preview.revision : '')},
          offline: offlineAssurance,
        });
      `,
      ],
      { cwd: '/', env: process.env, encoding: 'utf8', timeout: 30000 },
    )
    assert.equal(child.status, 75, child.stderr)
    execFileSync('git', ['commit', '--allow-empty', '-m', 'drift'], { cwd: f.root, env: process.env })
    const engine = new MemoryEngineController(f.root)
    const checkpoint = await offlineMaintenance(engine, f.context, { action: 'offline-draft-inspect' })
    await assert.rejects(
      offlineMaintenance(engine, f.context, {
        action: 'offline-draft-resume',
        target: checkpoint && 'target' in checkpoint ? checkpoint.target : '',
        revision: checkpoint && 'revision' in checkpoint ? checkpoint.revision : '',
        offline: offlineAssurance,
      }),
      /HEAD changed|marker retained/,
    )
    assert.equal(existsSync(join(f.root, '.views/.maintenance-active.json')), true)
    await engine.close()
  } finally {
    await f.close()
  }
})

test('a newly inserted malformed journal keeps the marker', { skip: !kernelAvailable }, async () => {
  const f = await fixture({ candidates: 2 })
  try {
    await f.engine.close()
    const engine = new MemoryEngineController(f.root)
    const preview = await offlineMaintenance(engine, f.context, { action: 'offline-draft-inspect' })
    await engine.close()
    const child = interrupt(f.root, preview && 'target' in preview ? preview : {})
    assert.equal(child.status, 73, child.stderr)
    writeFileSync(join(f.root, '.views/.engine-v2/journal', `${journalId(50)}.json`), '{', { mode: 0o600 })
    const resumeEngine = new MemoryEngineController(f.root)
    const checkpoint = await offlineMaintenance(resumeEngine, f.context, { action: 'offline-draft-inspect' })
    await assert.rejects(
      offlineMaintenance(resumeEngine, f.context, {
        action: 'offline-draft-resume',
        target: checkpoint && 'target' in checkpoint ? checkpoint.target : '',
        revision: checkpoint && 'revision' in checkpoint ? checkpoint.revision : '',
        offline: offlineAssurance,
      }),
      /uncertain|marker retained/,
    )
    assert.equal(existsSync(join(f.root, '.views/.maintenance-active.json')), true)
    await resumeEngine.close()
  } finally {
    await f.close()
  }
})

test('more than 8192 nonmatching draft entries stay inexact', { skip: !kernelAvailable }, async () => {
  const f = await fixture({ candidates: 1 })
  try {
    for (let index = 0; index < 8193; index++)
      writeFileSync(join(f.draftDir, `extra-${index}.txt`), '', { mode: 0o600 })
    const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
    assert.equal('exact' in preview && preview.exact, false)
    assert.equal('candidates' in preview && preview.candidates, 0)
    assert.equal('archiveAvailable' in preview && preview.archiveAvailable, false)
    const diagnostic = await f.engine.request('retainedDraftPreview', {}, f.context)
    assert.equal(diagnostic.observed.exact, false)
    assert.equal(diagnostic.observed.terminal, 0)
    assert.equal(diagnostic.observed.examined, 8192)
    assert.equal(Object.hasOwn(diagnostic, 'hypothetical'), false)
    assert.equal(existsSync(join(f.draftDir, `${f.candidates[0]}.json`)), true)
  } finally {
    await f.close()
  }
})

function publishSeam(
  root: string,
  preview: { target?: string; revision?: string },
  seam: 'link' | 'sync' | 'revoke',
) {
  const moduleURL = new URL('../lib/agent-memory/engine/offline-maintenance.ts', import.meta.url).href
  const controllerURL = new URL('../lib/agent-memory/engine/controller.ts', import.meta.url).href
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `
      import { existsSync, readdirSync } from 'node:fs';
      import { join } from 'node:path';
      import { offlineMaintenance, offlineAssurance } from ${JSON.stringify(moduleURL)};
      import { MemoryEngineController } from ${JSON.stringify(controllerURL)};
      const root = ${JSON.stringify(root)};
      const views = join(root, '.views');
      const marker = join(views, '.maintenance-active.json');
      const both = () => existsSync(marker) && readdirSync(views).some((name) => name.startsWith('maintenance-marker-'));
      let seen = 0;
      const context = { current() {
        if (!both()) return true;
        seen += 1;
        if (${JSON.stringify(seam)} === 'revoke' && seen >= 1) return false;
        if (${JSON.stringify(seam)} === 'link' && seen === 1) process.exit(76);
        if (${JSON.stringify(seam)} === 'sync' && seen === 3) process.exit(77);
        return true;
      } };
      await offlineMaintenance(new MemoryEngineController(root), context, {
        action: 'offline-draft-archive',
        target: ${JSON.stringify(preview.target)},
        revision: ${JSON.stringify(preview.revision)},
        offline: offlineAssurance,
      });
    `,
    ],
    { cwd: '/', env: process.env, encoding: 'utf8', timeout: 30000 },
  )
}

async function resumeLinkedMarker(root: string, context: OperationContext) {
  const engine = new MemoryEngineController(root)
  try {
    const checkpoint = await offlineMaintenance(engine, context, { action: 'offline-draft-inspect' })
    const result = await offlineMaintenance(engine, context, {
      action: 'offline-draft-resume',
      target: checkpoint && 'target' in checkpoint ? checkpoint.target : '',
      revision: checkpoint && 'revision' in checkpoint ? checkpoint.revision : '',
      offline: offlineAssurance,
    })
    assert.equal(result && 'markerReleased' in result && result.markerReleased, true)
    assert.equal(existsSync(join(root, '.views/.maintenance-active.json')), false)
    assert.equal(
      readdirSync(join(root, '.views')).some((name) => name.startsWith('maintenance-marker-')),
      false,
    )
  } finally {
    await engine.close()
  }
}

test('a hardlinked marker resumes after a crash following link and following directory sync', {
  skip: !kernelAvailable,
}, async () => {
  for (const seam of ['link', 'sync'] as const) {
    const f = await fixture({ candidates: 1 })
    try {
      const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
      await f.engine.close()
      const child = publishSeam(f.root, preview && 'target' in preview ? preview : {}, seam)
      assert.equal(child.status, seam === 'link' ? 76 : 77, child.stderr)
      const marker = join(f.root, '.views/.maintenance-active.json')
      assert.equal(lstatSync(marker).nlink, 2)
      await resumeLinkedMarker(f.root, f.context)
      assert.equal(existsSync(join(f.draftDir, `${f.candidates[0]}.json`)), false)
    } finally {
      await f.close()
    }
  }
})

test('revoking authority while the marker is still hardlinked does not unlink it', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ candidates: 1 })
  try {
    const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
    await f.engine.close()
    const child = publishSeam(f.root, preview && 'target' in preview ? preview : {}, 'revoke')
    assert.notEqual(child.status, 0)
    const marker = join(f.root, '.views/.maintenance-active.json')
    assert.equal(lstatSync(marker).nlink, 2)
    assert.equal(
      readdirSync(join(f.root, '.views')).some((name) => name.startsWith('maintenance-marker-')),
      true,
    )
    await resumeLinkedMarker(f.root, f.context)
    assert.equal(existsSync(join(f.draftDir, `${f.candidates[0]}.json`)), false)
  } finally {
    await f.close()
  }
})

test('an existing quarantine file is not replaced', { skip: !kernelAvailable }, async () => {
  const f = await fixture({ candidates: 1 })
  try {
    const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
    await f.engine.close()
    const moduleURL = new URL('../lib/agent-memory/engine/offline-maintenance.ts', import.meta.url).href
    const controllerURL = new URL('../lib/agent-memory/engine/controller.ts', import.meta.url).href
    const source = join(f.draftDir, `${f.candidates[0]}.json`)
    const original = readFileSync(source)
    const child = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `
        import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
        import { join } from 'node:path';
        import { offlineMaintenance, offlineAssurance } from ${JSON.stringify(moduleURL)};
        import { MemoryEngineController } from ${JSON.stringify(controllerURL)};
        const root = ${JSON.stringify(f.root)};
        const name = ${JSON.stringify(`${f.candidates[0]}.json`)};
        let planted = false;
        const context = { current() {
          const marker = join(root, '.views/.maintenance-active.json');
          const base = join(root, '.views/.maintenance');
          if (!planted && existsSync(marker) && existsSync(base)) {
            for (const id of readdirSync(base)) {
              if (id === 'prior') continue;
              const dir = join(base, id, 'quarantine/.views/.engine-v2/drafts');
              mkdirSync(dir, { recursive: true, mode: 0o700 });
              writeFileSync(join(dir, name), 'SENTINEL_NOT_OVERWRITTEN', { mode: 0o600 });
              planted = true;
            }
          }
          return true;
        } };
        await offlineMaintenance(new MemoryEngineController(root), context, {
          action: 'offline-draft-archive',
          target: ${JSON.stringify(preview && 'target' in preview ? preview.target : '')},
          revision: ${JSON.stringify(preview && 'revision' in preview ? preview.revision : '')},
          offline: offlineAssurance,
        });
      `,
      ],
      { cwd: '/', env: process.env, encoding: 'utf8', timeout: 30000 },
    )
    assert.notEqual(child.status, 0, child.stderr)
    assert.deepEqual(readFileSync(source), original)
    const planted = readdirSync(join(f.root, '.views/.maintenance'), { recursive: true })
      .map(String)
      .find((name) => name.includes('quarantine') && name.endsWith(`${f.candidates[0]}.json`))
    assert.ok(planted)
    assert.equal(
      readFileSync(join(f.root, '.views/.maintenance', String(planted)), 'utf8'),
      'SENTINEL_NOT_OVERWRITTEN',
    )
    assert.equal(existsSync(join(f.root, '.views/.maintenance-active.json')), true)
  } finally {
    await f.close()
  }
})

test('read-only inspect does not unlink a hardlinked marker; bound resume does', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ candidates: 1 })
  try {
    const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
    await f.engine.close()
    const child = publishSeam(f.root, preview && 'target' in preview ? preview : {}, 'link')
    assert.equal(child.status, 76, child.stderr)
    const marker = join(f.root, '.views/.maintenance-active.json')
    const engine = new MemoryEngineController(f.root)
    const checkpoint = await offlineMaintenance(engine, f.context, { action: 'offline-draft-inspect' })
    assert.equal(lstatSync(marker).nlink, 2)
    assert.equal(
      readdirSync(join(f.root, '.views')).some((name) => name.startsWith('maintenance-marker-')),
      true,
    )
    assert.equal('phase' in checkpoint && checkpoint.phase, 'snapshotted')
    await assert.rejects(
      offlineMaintenance(engine, f.context, {
        action: 'offline-draft-resume',
        target: '00000000-0000-4000-8000-000000000099',
        revision: checkpoint && 'revision' in checkpoint ? checkpoint.revision : '',
        offline: offlineAssurance,
      }),
      /checkpoint required|marker retained/,
    )
    assert.equal(lstatSync(marker).nlink, 2)
    const result = await offlineMaintenance(engine, f.context, {
      action: 'offline-draft-resume',
      target: checkpoint && 'target' in checkpoint ? checkpoint.target : '',
      revision: checkpoint && 'revision' in checkpoint ? checkpoint.revision : '',
      offline: offlineAssurance,
    })
    assert.equal(result && 'markerReleased' in result && result.markerReleased, true)
    assert.equal(existsSync(marker), false)
    assert.equal(existsSync(join(f.draftDir, `${f.candidates[0]}.json`)), false)
    await engine.close()
  } finally {
    await f.close()
  }
})

test('one unstable manifest clears stable terminal candidates', { skip: !kernelAvailable }, async () => {
  const f = await fixture({ candidates: 2 })
  try {
    const unstable = f.candidates[1]!
    const seen = new Map<string, number>()
    const context: OperationContext = {
      current(targets) {
        for (const path of targets?.physical ?? []) {
          if (!path.endsWith(`${unstable}.json`)) continue
          const count = (seen.get(path) ?? 0) + 1
          seen.set(path, count)
          if (count === 7) writeFileSync(path, draftManifest(unstable, f.head.trim(), 'open'))
        }
        return true
      },
    }
    const preview = await offlineMaintenance(f.engine, context, { action: 'offline-draft-inspect' })
    assert.equal('exact' in preview && preview.exact, false)
    assert.equal('candidates' in preview && preview.candidates, 0)
    assert.equal('archiveAvailable' in preview && preview.archiveAvailable, false)
    assert.ok('unstable' in preview && (preview.unstable as number) >= 1)
    assert.equal(existsSync(join(f.draftDir, `${f.candidates[0]}.json`)), true)
    assert.equal(existsSync(join(f.draftDir, `${unstable}.json`)), true)
    writeFileSync(join(f.draftDir, `${unstable}.json`), f.bodies.get(unstable) ?? '')
    const seenPreview = new Map<string, number>()
    const diagnostic = await f.engine.request(
      'retainedDraftPreview',
      {},
      {
        current(targets) {
          for (const path of targets?.physical ?? []) {
            if (!path.endsWith(`${unstable}.json`)) continue
            const count = (seenPreview.get(path) ?? 0) + 1
            seenPreview.set(path, count)
            if (count === 2) writeFileSync(path, draftManifest(unstable, f.head.trim(), 'committed'))
          }
          return true
        },
      },
    )
    assert.equal(diagnostic.observed.exact, false)
    assert.equal(diagnostic.observed.terminal, 0)
    assert.ok(diagnostic.observed.unstable >= 1)
  } finally {
    await f.close()
  }
})

test('a crash between exclusive copy and source unlink keeps both names', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ candidates: 1 })
  try {
    const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
    await f.engine.close()
    const moduleURL = new URL('../lib/agent-memory/engine/offline-maintenance.ts', import.meta.url).href
    const controllerURL = new URL('../lib/agent-memory/engine/controller.ts', import.meta.url).href
    const name = `${f.candidates[0]}.json`
    const source = join(f.draftDir, name)
    const original = readFileSync(source)
    const child = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `
        import { existsSync, readdirSync } from 'node:fs';
        import { join } from 'node:path';
        import { offlineMaintenance, offlineAssurance } from ${JSON.stringify(moduleURL)};
        import { MemoryEngineController } from ${JSON.stringify(controllerURL)};
        const root = ${JSON.stringify(f.root)};
        const name = ${JSON.stringify(name)};
        const both = () => {
          const base = join(root, '.views/.maintenance');
          if (!existsSync(join(root, '.views/.engine-v2/drafts', name)) || !existsSync(base)) return false;
          return readdirSync(base).some((id) => existsSync(join(base, id, 'quarantine/.views/.engine-v2/drafts', name)));
        };
        const context = { current() { if (both()) process.exit(78); return true; } };
        await offlineMaintenance(new MemoryEngineController(root), context, {
          action: 'offline-draft-archive',
          target: ${JSON.stringify(preview && 'target' in preview ? preview.target : '')},
          revision: ${JSON.stringify(preview && 'revision' in preview ? preview.revision : '')},
          offline: offlineAssurance,
        });
      `,
      ],
      { cwd: '/', env: process.env, encoding: 'utf8', timeout: 30000 },
    )
    assert.equal(child.status, 78, child.stderr)
    const copied = readdirSync(join(f.root, '.views/.maintenance'), { recursive: true })
      .map(String)
      .find((entry) => entry.includes('quarantine') && entry.endsWith(name))
    assert.ok(copied)
    const quarantine = join(f.root, '.views/.maintenance', String(copied))
    assert.deepEqual(readFileSync(source), original)
    assert.deepEqual(readFileSync(quarantine), original)
    const engine = new MemoryEngineController(f.root)
    const checkpoint = await offlineMaintenance(engine, f.context, { action: 'offline-draft-inspect' })
    await assert.rejects(
      offlineMaintenance(engine, f.context, {
        action: 'offline-draft-resume',
        target: checkpoint && 'target' in checkpoint ? checkpoint.target : '',
        revision: checkpoint && 'revision' in checkpoint ? checkpoint.revision : '',
        offline: offlineAssurance,
      }),
      /uncertain|marker retained/,
    )
    assert.deepEqual(readFileSync(source), original)
    assert.deepEqual(readFileSync(quarantine), original)
    assert.equal(existsSync(join(f.root, '.views/.maintenance-active.json')), true)
    await engine.close()
  } finally {
    await f.close()
  }
})

test('a denied partial target is not statted or read', { skip: !kernelAvailable }, async () => {
  for (const deny of ['lstat', 'read'] as const) {
    const f = await fixture({ candidates: 1 })
    try {
      const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
      await f.engine.close()
      const child = publishSeam(f.root, preview && 'target' in preview ? preview : {}, 'link')
      assert.equal(child.status, 76, child.stderr)
      const marker = join(f.root, '.views/.maintenance-active.json')
      const before = readFileSync(marker)
      const partial = readdirSync(join(f.root, '.views')).find((name) =>
        name.startsWith('maintenance-marker-'),
      )
      assert.ok(partial)
      const partialPath = join(f.root, '.views', partial)
      const partialBefore = readFileSync(partialPath)
      const engine = new MemoryEngineController(f.root)
      await assert.rejects(
        offlineMaintenance(
          engine,
          {
            current(targets) {
              const physical = targets?.physical ?? []
              const partials = physical.filter((path) => path.endsWith('.partial'))
              const markers = physical.filter((path) => path.endsWith('.maintenance-active.json'))
              if (deny === 'lstat' && partials.length === 1 && physical.length === 1) return false
              if (deny === 'read' && partials.length === 1 && markers.length === 1) return false
              return true
            },
          },
          { action: 'offline-draft-inspect' },
        ),
        /Current parent authority required/,
      )
      assert.equal(lstatSync(marker).nlink, 2)
      assert.deepEqual(readFileSync(marker), before)
      assert.deepEqual(readFileSync(partialPath), partialBefore)
      await engine.close()
    } finally {
      await f.close()
    }
  }
})

function denyMarkerStage(
  root: string,
  preview: { target?: string; revision?: string },
  stage: 'write' | 'sync' | 'cleanup',
) {
  const moduleURL = new URL('../lib/agent-memory/engine/offline-maintenance.ts', import.meta.url).href
  const controllerURL = new URL('../lib/agent-memory/engine/controller.ts', import.meta.url).href
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `
      import { existsSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { offlineMaintenance, offlineAssurance } from ${JSON.stringify(moduleURL)};
      import { MemoryEngineController } from ${JSON.stringify(controllerURL)};
      const root = ${JSON.stringify(root)};
      const marker = join(root, '.views/.maintenance-active.json');
      let tempGates = 0;
      const context = { current(targets) {
        const physical = targets && targets.physical || [];
        const onlyTemp = physical.length === 1 && String(physical[0]).includes('maintenance-marker-');
        if (onlyTemp) {
          tempGates += 1;
          const stage = ${JSON.stringify(stage)};
          if (stage === 'write' && tempGates >= 1) return false;
          if (stage === 'sync' && tempGates >= 2) return false;
          if (stage === 'cleanup' && tempGates >= 3) return false;
        }
        if (${JSON.stringify(stage)} === 'cleanup' && physical.some((path) => String(path).endsWith('.maintenance-active.json')) && physical.some((path) => String(path).includes('maintenance-marker-')) && !existsSync(marker))
          writeFileSync(marker, 'SENTINEL_NOT_OVERWRITTEN', { mode: 0o600 });
        return true;
      } };
      await offlineMaintenance(new MemoryEngineController(root), context, {
        action: 'offline-draft-archive',
        target: ${JSON.stringify(preview.target)},
        revision: ${JSON.stringify(preview.revision)},
        offline: offlineAssurance,
      });
    `,
    ],
    { cwd: '/', env: process.env, encoding: 'utf8', timeout: 30000 },
  )
}

test('revoked marker write, sync, and link cleanup preserve the temp and the original error', {
  skip: !kernelAvailable,
}, async () => {
  for (const stage of ['write', 'sync', 'cleanup'] as const) {
    const f = await fixture({ candidates: 1 })
    try {
      const preview = await offlineMaintenance(f.engine, f.context, { action: 'offline-draft-inspect' })
      await f.engine.close()
      const child = denyMarkerStage(f.root, preview && 'target' in preview ? preview : {}, stage)
      assert.notEqual(child.status, 0)
      const output = `${child.stderr}\n${child.stdout}`
      const marker = join(f.root, '.views/.maintenance-active.json')
      const partial = readdirSync(join(f.root, '.views')).find((name) =>
        name.startsWith('maintenance-marker-'),
      )
      assert.ok(partial, output)
      if (stage === 'cleanup') {
        assert.match(output, /EEXIST/)
        assert.equal(readFileSync(marker, 'utf8'), 'SENTINEL_NOT_OVERWRITTEN')
      } else {
        assert.match(output, /Current parent authority required/)
        assert.equal(existsSync(marker), false)
        if (stage === 'sync')
          assert.match(readFileSync(join(f.root, '.views', partial), 'utf8'), /"version":1/)
      }
    } finally {
      await f.close()
    }
  }
})

test('denied root and journal cas targets do not stat those paths', { skip: !kernelAvailable }, async () => {
  const rootDenied = await fixture({ candidates: 1 })
  try {
    const source = readFileSync(join(rootDenied.draftDir, `${rootDenied.candidates[0]}.json`))
    await assert.rejects(
      offlineMaintenance(
        rootDenied.engine,
        {
          current(targets) {
            const physical = targets?.physical ?? []
            return !(physical.length === 1 && physical[0] === rootDenied.root)
          },
        },
        { action: 'offline-draft-inspect' },
      ),
      /Current parent authority required/,
    )
    assert.deepEqual(readFileSync(join(rootDenied.draftDir, `${rootDenied.candidates[0]}.json`)), source)
  } finally {
    await rootDenied.close()
  }
  const casDenied = await fixture({ candidates: 1 })
  try {
    const cas = join(
      casDenied.root,
      '.views/.engine-v2/journal/00000000-0000-4000-8000-0000000000aa.json.cas',
    )
    mkdirSync(cas, { mode: 0o700 })
    await assert.rejects(
      offlineMaintenance(
        casDenied.engine,
        {
          current(targets) {
            return !(targets?.physical ?? []).some((path) => path.endsWith('.cas'))
          },
        },
        { action: 'offline-draft-inspect' },
      ),
      /Current parent authority required/,
    )
    assert.equal(existsSync(cas), true)
  } finally {
    await casDenied.close()
  }
})

test('denied linked-file read, snapshot write, and marker scan overflow preserve names', {
  skip: !kernelAvailable,
}, async () => {
  const linked = await fixture({ candidates: 1 })
  try {
    const preview = await offlineMaintenance(linked.engine, linked.context, {
      action: 'offline-draft-inspect',
    })
    await linked.engine.close()
    const crashed = publishSeam(linked.root, preview && 'target' in preview ? preview : {}, 'link')
    assert.equal(crashed.status, 76, crashed.stderr)
    const marker = join(linked.root, '.views/.maintenance-active.json')
    const before = readFileSync(marker)
    let paired = 0
    const engine = new MemoryEngineController(linked.root)
    await assert.rejects(
      offlineMaintenance(
        engine,
        {
          current(targets) {
            const physical = targets?.physical ?? []
            const both =
              physical.some((path) => path.endsWith('.partial')) &&
              physical.some((path) => path.endsWith('.maintenance-active.json'))
            if (!both) return true
            paired++
            return paired !== 2
          },
        },
        { action: 'offline-draft-inspect' },
      ),
      /Current parent authority required/,
    )
    assert.equal(lstatSync(marker).nlink, 2)
    assert.deepEqual(readFileSync(marker), before)
    await engine.close()
    for (let index = 0; index < 8193; index++)
      writeFileSync(join(linked.root, '.views', `extra-${index}.txt`), '', { mode: 0o600 })
    const bounded = new MemoryEngineController(linked.root)
    await assert.rejects(
      offlineMaintenance(bounded, linked.context, { action: 'offline-draft-inspect' }),
      /names preserved/,
    )
    assert.equal(lstatSync(marker).nlink, 2)
    assert.equal(
      readdirSync(join(linked.root, '.views')).some((name) => name.startsWith('maintenance-marker-')),
      true,
    )
    await bounded.close()
  } finally {
    await linked.close()
  }
  const snapshot = await fixture({ candidates: 1 })
  try {
    const preview = await offlineMaintenance(snapshot.engine, snapshot.context, {
      action: 'offline-draft-inspect',
    })
    await snapshot.engine.close()
    const moduleURL = new URL('../lib/agent-memory/engine/offline-maintenance.ts', import.meta.url).href
    const controllerURL = new URL('../lib/agent-memory/engine/controller.ts', import.meta.url).href
    const source = join(snapshot.draftDir, `${snapshot.candidates[0]}.json`)
    const original = readFileSync(source)
    const child = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `
        import { offlineMaintenance, offlineAssurance } from ${JSON.stringify(moduleURL)};
        import { MemoryEngineController } from ${JSON.stringify(controllerURL)};
        const root = ${JSON.stringify(snapshot.root)};
        let copies = 0;
        const context = { current(targets) {
          const physical = targets && targets.physical || [];
          if (physical.some((path) => String(path).includes('/copy-') && String(path).endsWith('.partial'))) {
            copies += 1;
            if (copies === 4) return false;
          }
          return true;
        } };
        await offlineMaintenance(new MemoryEngineController(root), context, {
          action: 'offline-draft-archive',
          target: ${JSON.stringify(preview && 'target' in preview ? preview.target : '')},
          revision: ${JSON.stringify(preview && 'revision' in preview ? preview.revision : '')},
          offline: offlineAssurance,
        });
      `,
      ],
      { cwd: '/', env: process.env, encoding: 'utf8', timeout: 30000 },
    )
    assert.match(`${child.stderr}`, /Current parent authority required/)
    assert.deepEqual(readFileSync(source), original)
    assert.equal(existsSync(join(snapshot.root, '.views/.maintenance-active.json')), false)
  } finally {
    await snapshot.close()
  }
})

test('denied copy sync and recovered marker stat leave both names in place', {
  skip: !kernelAvailable,
}, async () => {
  const copied = await fixture({ candidates: 1 })
  try {
    const preview = await offlineMaintenance(copied.engine, copied.context, {
      action: 'offline-draft-inspect',
    })
    await copied.engine.close()
    const moduleURL = new URL('../lib/agent-memory/engine/offline-maintenance.ts', import.meta.url).href
    const controllerURL = new URL('../lib/agent-memory/engine/controller.ts', import.meta.url).href
    const name = `${copied.candidates[0]}.json`
    const source = join(copied.draftDir, name)
    const original = readFileSync(source)
    const child = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `
        import { offlineMaintenance, offlineAssurance } from ${JSON.stringify(moduleURL)};
        import { MemoryEngineController } from ${JSON.stringify(controllerURL)};
        const root = ${JSON.stringify(copied.root)};
        let syncs = 0;
        const context = { current(targets) {
          const physical = targets && targets.physical || [];
          const onlyDest = physical.length === 1 && String(physical[0]).includes('/quarantine/') && String(physical[0]).endsWith('.json');
          if (onlyDest) {
            syncs += 1;
            if (syncs >= 2) return false;
          }
          return true;
        } };
        await offlineMaintenance(new MemoryEngineController(root), context, {
          action: 'offline-draft-archive',
          target: ${JSON.stringify(preview && 'target' in preview ? preview.target : '')},
          revision: ${JSON.stringify(preview && 'revision' in preview ? preview.revision : '')},
          offline: offlineAssurance,
        });
      `,
      ],
      { cwd: '/', env: process.env, encoding: 'utf8', timeout: 30000 },
    )
    assert.match(`${child.stderr}`, /Current parent authority required/)
    assert.deepEqual(readFileSync(source), original)
    const quarantine = readdirSync(join(copied.root, '.views/.maintenance'), { recursive: true })
      .map(String)
      .find((entry) => entry.includes('quarantine') && entry.endsWith(name))
    assert.ok(quarantine)
    assert.deepEqual(readFileSync(join(copied.root, '.views/.maintenance', String(quarantine))), original)
    assert.equal(existsSync(join(copied.root, '.views/.maintenance-active.json')), true)
  } finally {
    await copied.close()
  }
  const recovered = await fixture({ candidates: 1 })
  try {
    const preview = await offlineMaintenance(recovered.engine, recovered.context, {
      action: 'offline-draft-inspect',
    })
    await recovered.engine.close()
    const crashed = publishSeam(recovered.root, preview && 'target' in preview ? preview : {}, 'link')
    assert.equal(crashed.status, 76, crashed.stderr)
    const marker = join(recovered.root, '.views/.maintenance-active.json')
    const before = readFileSync(marker)
    let paired = 0
    const engine = new MemoryEngineController(recovered.root)
    const checkpoint = await offlineMaintenance(engine, recovered.context, {
      action: 'offline-draft-inspect',
    })
    assert.equal(lstatSync(marker).nlink, 2)
    await assert.rejects(
      offlineMaintenance(
        engine,
        {
          current(targets) {
            const physical = targets?.physical ?? []
            const both =
              physical.some((path) => path.endsWith('.partial')) &&
              physical.some((path) => path.endsWith('.maintenance-active.json'))
            if (!both) return true
            paired++
            return paired < 7
          },
        },
        {
          action: 'offline-draft-resume',
          target: checkpoint && 'target' in checkpoint ? checkpoint.target : '',
          revision: checkpoint && 'revision' in checkpoint ? checkpoint.revision : '',
          offline: offlineAssurance,
        },
      ),
      /Current parent authority required/,
    )
    assert.equal(lstatSync(marker).nlink, 2)
    assert.deepEqual(readFileSync(marker), before)
    await engine.close()
  } finally {
    await recovered.close()
  }
})

test('read lstats an in-root target only after authorization and skips it when denied', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture({ candidates: 0 })
  const target = join(f.root, 'config.json')
  const before = readFileSync(target)
  const originalLstat = fsPromises.lstat
  const originalOpen = fsPromises.open
  const events: string[] = []
  const authorized = new Set<string>()
  let denyTarget = true
  let revoked = false
  let hold = false
  let opens = 0
  let releaseHold = () => {}
  const held = new Promise<void>((resolve) => {
    releaseHold = resolve
  })
  let markEntered = () => {}
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  const inRoot = (path: string) => path === f.root || path.startsWith(`${f.root}/`)
  t.mock.method(fsPromises, 'lstat', async (...args: Parameters<typeof originalLstat>) => {
    const path = String(args[0])
    events.push(`lstat ${path}`)
    if (hold && path === target) {
      markEntered()
      await held
    }
    return originalLstat(...args)
  })
  t.mock.method(fsPromises, 'open', async (...args: Parameters<typeof originalOpen>) => {
    if (String(args[0]) === target) opens++
    return originalOpen(...args)
  })
  syncBuiltinESMExports()
  const context: OperationContext = {
    current(targets) {
      if (revoked) return false
      const paths = targets.physical ?? []
      for (const path of paths) if (!inRoot(path)) throw Error('Managed memory path unavailable')
      if (denyTarget && paths.includes(target)) return false
      for (const path of paths) {
        authorized.add(path)
        events.push(`auth ${path}`)
      }
      return true
    },
  }
  const lstatBeforeAuth = () =>
    events.some((event, index) => {
      if (!event.startsWith('lstat ')) return false
      const path = event.slice(6)
      if (!inRoot(path)) return false
      return !events.slice(0, index).includes(`auth ${path}`)
    })
  try {
    await assert.rejects(read(f.root, 'config.json', 131072, context), /Current parent authority required/)
    assert.equal(events.includes(`lstat ${target}`), false)
    assert.equal(events.includes(`lstat ${dirname(f.root)}`), true)
    assert.equal(events.includes(`auth ${dirname(f.root)}`), false)
    assert.equal(lstatBeforeAuth(), false)
    assert.equal(opens, 0)
    denyTarget = false
    hold = true
    const pending = read(f.root, 'config.json', 131072, context)
    await entered
    const early = lstatBeforeAuth()
    const targetAuthorized = authorized.has(target)
    revoked = true
    releaseHold()
    await assert.rejects(pending, /Current parent authority required/)
    assert.equal(early, false)
    assert.equal(targetAuthorized, true)
    assert.equal(opens, 0)
    assert.deepEqual(readFileSync(target), before)
  } finally {
    releaseHold()
    t.mock.restoreAll()
    syncBuiltinESMExports()
    await f.close()
  }
})

test('read refuses a symlink ancestor before in-root authorization', { timeout: 15000 }, async (t) => {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-draft-symlink-ancestor-'))
  const realParent = join(base, 'real')
  const link = join(base, 'link')
  const root = join(link, 'memory')
  const target = join(root, 'config.json')
  mkdirSync(join(realParent, 'memory'), { recursive: true, mode: 0o700 })
  writeFileSync(join(realParent, 'memory', 'config.json'), '{"ok":true}\n', { mode: 0o600 })
  symlinkSync(realParent, link)
  const originalLstat = fsPromises.lstat
  let calls = 0
  let targetLstats = 0
  let linkLstats = 0
  t.mock.method(fsPromises, 'lstat', async (...args: Parameters<typeof originalLstat>) => {
    const path = String(args[0])
    if (path === target) targetLstats++
    if (path === link) linkLstats++
    return originalLstat(...args)
  })
  syncBuiltinESMExports()
  try {
    await assert.rejects(
      read(root, 'config.json', 1024, {
        current() {
          calls++
          return true
        },
      }),
      /Linked path refused/,
    )
    assert.equal(calls, 0)
    assert.equal(targetLstats, 0)
    assert.equal(linkLstats > 0, true)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    rmSync(base, { recursive: true, force: true })
  }
})

test('maintenance work reads gate every in-root ancestor before lstat', { timeout: 20000 }, async (t) => {
  const f = await fixture({ candidates: 0 })
  const id = journalId(1)
  const work = join(f.root, '.views/.maintenance', id)
  mkdirSync(work, { recursive: true, mode: 0o700 })
  writeFileSync(join(f.root, '.views/.maintenance-active.json'), `${JSON.stringify({ version: 1, id })}\n`, {
    mode: 0o600,
  })
  const ancestors = [
    f.root,
    join(f.root, '.views'),
    join(f.root, '.views/.maintenance'),
    work,
    join(work, 'plan.json'),
    join(work, 'state.json'),
  ]
  const originalLstat = fsPromises.lstat
  const pending = new Set<string>()
  const ungated: string[] = []
  const counts = new Map<string, number>()
  let denyPath: string | undefined
  const inRoot = (path: string) => path === f.root || path.startsWith(`${f.root}/`)
  t.mock.method(fsPromises, 'lstat', async (...args: Parameters<typeof originalLstat>) => {
    const path = String(args[0])
    if (inRoot(path)) {
      counts.set(path, (counts.get(path) ?? 0) + 1)
      if (!pending.delete(path)) ungated.push(path)
    }
    return originalLstat(...args)
  })
  syncBuiltinESMExports()
  const context: OperationContext = {
    current(targets) {
      const paths = targets.physical ?? []
      for (const path of paths) {
        if (!inRoot(path)) throw Error('Managed memory path unavailable')
        if (path === denyPath) return false
      }
      for (const path of paths) pending.add(path)
      return true
    },
  }
  const reset = () => {
    pending.clear()
    ungated.length = 0
    counts.clear()
    denyPath = undefined
  }
  try {
    for (const action of ['offline-draft-inspect', 'offline-inspect'] as const) {
      writeFileSync(
        join(work, 'plan.json'),
        action === 'offline-draft-inspect' ? '{"kind":"terminal-draft-archive"}\n' : '{"version":1}\n',
        { mode: 0o600 },
      )
      writeFileSync(join(work, 'state.json'), '{}\n', { mode: 0o600 })
      reset()
      await assert.rejects(offlineMaintenance(f.engine, context, { action }), /checkpoint unavailable/)
      assert.deepEqual(ungated, [])
      for (const path of ancestors) assert.equal((counts.get(path) ?? 0) > 0, true, path)
      for (const path of ancestors) {
        reset()
        denyPath = path
        await assert.rejects(
          offlineMaintenance(f.engine, context, { action }),
          /Current parent authority required/,
        )
        assert.equal(counts.get(path) ?? 0, 0, path)
        assert.deepEqual(ungated, [])
      }
    }
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    await f.close()
  }
})

test('kernel-shaped authority accepts in-root reads and refuses an in-root target', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ candidates: 1 })
  try {
    const source = readFileSync(join(f.draftDir, `${f.candidates[0]}.json`))
    const preview = await offlineMaintenance(
      f.engine,
      {
        current(targets) {
          for (const path of targets?.physical ?? [])
            if (path !== f.root && !path.startsWith(`${f.root}/`))
              throw Error('Managed memory path unavailable')
          return true
        },
      },
      { action: 'offline-draft-inspect' },
    )
    assert.equal(preview && 'corpusReturned' in preview && preview.corpusReturned, false)
    assert.equal('kind' in preview && preview.kind, 'abi2-terminal-draft-archive')
    await assert.rejects(
      offlineMaintenance(
        f.engine,
        {
          current(targets) {
            for (const path of targets?.physical ?? []) {
              if (path !== f.root && !path.startsWith(`${f.root}/`))
                throw Error('Managed memory path unavailable')
              if (path.endsWith('/config.json')) return false
            }
            return true
          },
        },
        { action: 'offline-draft-inspect' },
      ),
      /Current parent authority required/,
    )
    assert.deepEqual(readFileSync(join(f.draftDir, `${f.candidates[0]}.json`)), source)
  } finally {
    await f.close()
  }
})

test('revoking during a held file stat prevents the next read and create', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ candidates: 1 })
  const fsPromises = await import('node:fs/promises')
  const probe = await fsPromises.open(join(f.root, 'Core.md'), 'r')
  const proto = Object.getPrototypeOf(probe) as {
    stat: (...args: unknown[]) => Promise<unknown>
    read: (...args: unknown[]) => Promise<unknown>
    readFile: (...args: unknown[]) => Promise<unknown>
  }
  await probe.close()
  const originalStat = proto.stat
  const originalRead = proto.read
  const originalReadFile = proto.readFile
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let entered!: () => void
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve
  })
  let armed = true
  let revoked = false
  let readsAfter = 0
  proto.stat = function (this: unknown, ...args: unknown[]) {
    const pending = originalStat.apply(this, args)
    if (!armed) return pending
    armed = false
    return pending.then(async (value) => {
      entered()
      await held
      return value
    })
  }
  proto.read = function (this: unknown, ...args: unknown[]) {
    if (revoked) readsAfter++
    return originalRead.apply(this, args)
  }
  proto.readFile = function (this: unknown, ...args: unknown[]) {
    if (revoked) readsAfter++
    return originalReadFile.apply(this, args)
  }
  try {
    const op = offlineMaintenance(f.engine, { current: () => !revoked }, { action: 'offline-draft-inspect' })
    await enteredPromise
    revoked = true
    release()
    await assert.rejects(op, /Current parent authority required/)
    assert.equal(readsAfter, 0)
    assert.equal(
      readdirSync(join(f.root, '.views')).some(
        (name) => name.startsWith('maintenance-marker-') || name.startsWith('copy-'),
      ),
      false,
    )
  } finally {
    proto.stat = originalStat
    proto.read = originalRead
    proto.readFile = originalReadFile
    await f.close()
  }
})
