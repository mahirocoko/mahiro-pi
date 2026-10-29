import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { canonicalGitDirectoryName } from '../lib/agent-memory/local/contracts.ts'
import {
  emptyForgettingMetadata,
  localGitBlobId,
  tombstoneSnapshotDigest,
  type TombstoneSnapshot,
  type TombstoneSource,
} from '../lib/agent-memory/local/forgetting.ts'
import { createSyntheticLocalMemoryService, type LocalWorker } from '../lib/agent-memory/local/service.ts'
import type { MaintenanceWorkerInput, SyntheticPublicEntry } from '../lib/agent-memory/local/trajectory.ts'

const coreText = 'core-bytes\n'
const indexText = 'index-bytes\n'
const keepText = 'keep-bytes\n'
const secretText = 'secret-bytes\n'
const otherText = 'different-bytes\n'
const sourceRevision = 'a'.repeat(40)

function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-local-forgetting-'))
  const stateRoot = join(dir, 'state')
  const hooks = join(dir, 'hooks')
  mkdirSync(stateRoot, { mode: 0o700 })
  mkdirSync(hooks, { mode: 0o700 })
  const bare = () => join(stateRoot, canonicalGitDirectoryName)
  const git = (args: string[], input?: string) =>
    execFileSync(
      'git',
      [
        '--git-dir',
        bare(),
        '-c',
        `core.hooksPath=${hooks}`,
        '-c',
        'credential.helper=',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=Synthetic Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        ...args,
      ],
      { input, encoding: 'utf8' },
    ).trim()
  return {
    dir,
    stateRoot,
    git,
    close() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function seed(): Record<string, string> {
  return {
    'Core.md': coreText,
    'index.md': indexText,
    'notes/keep.md': keepText,
    'notes/secret.md': secretText,
    'system/persona.md': 'persona\n',
  }
}

function snapshot(
  paths: string[],
  blobs: string[],
  sources: TombstoneSource[] = [],
  revision = sourceRevision,
): TombstoneSnapshot {
  const body = { version: 1 as const, revision, paths, blobs, sources }
  return { ...body, digest: tombstoneSnapshotDigest(body) }
}

function secretSnapshot(): TombstoneSnapshot {
  return snapshot(
    ['notes/secret.md'],
    [localGitBlobId(secretText)],
    [{ project: 'demo', source: 'source-old' }],
  )
}

async function open(stateRoot: string, worker: LocalWorker = () => {}, stopAfter?: 'forgetting-recorded') {
  return createSyntheticLocalMemoryService({
    stateRoot,
    initialFiles: seed(),
    worker,
    ...(stopAfter ? { injection: { stopAfter } } : {}),
  })
}

async function rejects(promise: Promise<unknown>, message: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal(error.message, message)
    assert.equal(error.message.includes(secretText), false)
    assert.equal(error.message.includes('notes/secret.md'), false)
    return true
  })
}

function blob(fx: ReturnType<typeof fixture>, path: string): string {
  return fx.git(['rev-parse', `refs/heads/main:${path}`])
}

test('git blob identity matches the service repository hash', () => {
  const fx = fixture()
  try {
    const hashed = execFileSync('git', ['hash-object', '--stdin'], {
      input: secretText,
      encoding: 'utf8',
    }).trim()
    assert.equal(localGitBlobId(secretText), hashed)
  } finally {
    fx.close()
  }
})

test('import removes forgotten paths, stays idempotent, and refuses stale or conflicting snapshots', async () => {
  const fx = fixture()
  try {
    const service = await open(fx.stateRoot)
    const keepBefore = blob(fx, 'notes/keep.md')
    const coreBefore = blob(fx, 'Core.md')
    const prior = await service.head()
    const empty = emptyForgettingMetadata()
    const imported = secretSnapshot()
    const view = await service.importTombstones({
      expectedPolicyRevision: empty.policyRevision,
      expectedDigest: empty.digest,
      snapshot: imported,
    })
    assert.equal(view.policyRevision, 1)
    assert.equal(view.phase, 'removed')
    assert.equal(view.pathCount, 1)
    assert.equal(view.blobCount, 1)
    assert.equal(view.sourceCount, 1)
    assert.equal(view.filtered, true)
    assert.equal(JSON.stringify(view).includes(secretText), false)
    assert.equal(JSON.stringify(view).includes('notes/secret.md'), false)
    assert.equal(JSON.stringify(view).includes(fx.stateRoot), false)
    const removal = await service.head()
    assert.notEqual(removal, prior)
    assert.equal(fx.git(['rev-parse', `${removal}^`]), prior)
    assert.equal(fx.git(['cat-file', '-t', prior]), 'commit')
    assert.equal(blob(fx, 'notes/keep.md'), keepBefore)
    assert.equal(blob(fx, 'Core.md'), coreBefore)
    assert.throws(() => blob(fx, 'notes/secret.md'))
    const stored = readFileSync(join(fx.stateRoot, 'forgetting.json'), 'utf8')
    assert.equal(stored.includes(secretText), false)
    assert.equal(stored.includes(fx.stateRoot), false)
    assert.equal(stored.includes(prior), true)
    assert.equal(stored.includes('notes/secret.md'), true)

    const againHead = await service.head()
    const again = await service.importTombstones({
      expectedPolicyRevision: 0,
      expectedDigest: empty.digest,
      snapshot: imported,
    })
    assert.equal(again.policyRevision, 1)
    assert.equal(again.digest, view.digest)
    assert.equal(await service.head(), againHead)

    const conflict = snapshot(['notes/other.md'], [localGitBlobId(otherText)])
    await rejects(
      service.importTombstones({
        expectedPolicyRevision: 0,
        expectedDigest: empty.digest,
        snapshot: conflict,
      }),
      'Local memory forgetting stale',
    )
    await rejects(
      service.importTombstones({
        expectedPolicyRevision: view.policyRevision,
        expectedDigest: view.digest,
        snapshot: conflict,
      }),
      'Local memory forgetting conflict',
    )
    assert.equal(await service.head(), againHead)

    const reopened = await open(fx.stateRoot)
    assert.equal(await reopened.head(), againHead)
    assert.equal((await reopened.compilePrompt()).forgetting.policyRevision, 1)
    await rejects(reopened.readMemory({ path: 'notes/secret.md' }), 'Local memory path refused')
    await rejects(reopened.readCommitted('notes/secret.md'), 'Local memory path refused')
  } finally {
    fx.close()
  }
})

test('interrupted import recovers on restart without rewriting the parent commit', async () => {
  const fx = fixture()
  try {
    const service = await open(fx.stateRoot, () => {}, 'forgetting-recorded')
    const prior = await service.head()
    await rejects(
      service.importTombstones({
        expectedPolicyRevision: 0,
        expectedDigest: emptyForgettingMetadata().digest,
        snapshot: secretSnapshot(),
      }),
      'Local memory forgetting interrupted',
    )
    assert.equal(fx.git(['rev-parse', 'refs/heads/main']), prior)
    const partial = JSON.parse(readFileSync(join(fx.stateRoot, 'forgetting.json'), 'utf8')) as {
      migration: { phase: string; priorMain: string; removalCommit: string }
    }
    assert.equal(partial.migration.phase, 'removing')
    assert.equal(partial.migration.priorMain, prior)
    assert.equal(fx.git(['cat-file', '-t', partial.migration.removalCommit]), 'commit')
    assert.equal(blob(fx, 'notes/secret.md'), localGitBlobId(secretText))

    const recovered = await open(fx.stateRoot)
    assert.equal(await recovered.head(), partial.migration.removalCommit)
    assert.equal(fx.git(['rev-parse', `${await recovered.head()}^`]), prior)
    assert.throws(() => blob(fx, 'notes/secret.md'))
    assert.equal(blob(fx, 'notes/keep.md'), localGitBlobId(keepText))
    const done = JSON.parse(readFileSync(join(fx.stateRoot, 'forgetting.json'), 'utf8')) as {
      migration: { phase: string }
      policyRevision: number
    }
    assert.equal(done.migration.phase, 'removed')
    assert.equal(done.policyRevision, 1)
  } finally {
    fx.close()
  }
})

test('projection, read, and list hide forgotten data after a deliberate ref rollback', async () => {
  const fx = fixture()
  try {
    const service = await open(fx.stateRoot)
    const prior = await service.head()
    await service.importTombstones({
      expectedPolicyRevision: 0,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot: secretSnapshot(),
    })
    fx.git(['update-ref', 'refs/heads/main', prior])
    assert.equal(await service.head(), prior)
    const prompt = await service.compilePrompt()
    assert.equal(prompt.forgetting.filtered, true)
    assert.equal(prompt.forgetting.policyRevision, 1)
    assert.equal(prompt.prompt.includes(secretText), false)
    assert.equal(prompt.prompt.includes('notes/secret.md'), false)
    assert.equal(prompt.deferred.paths.includes('notes/secret.md'), false)
    assert.equal(
      prompt.blocked.paths.some((entry) => entry.path === 'notes/secret.md'),
      false,
    )
    assert.equal(prompt.absent.includes('notes/secret.md'), false)
    assert.equal(
      prompt.files.some((file) => file.path === 'Core.md' && file.text === coreText),
      true,
    )
    assert.equal(
      prompt.files.some((file) => file.path === 'index.md' && file.text === indexText),
      true,
    )
    await rejects(service.readMemory({ path: 'notes/secret.md' }), 'Local memory path refused')
    const listed = await service.listMemory({ path: 'notes' })
    assert.equal(listed.forgetting.filtered, true)
    assert.deepEqual(
      listed.entries.map((entry) => entry.path),
      ['notes/keep.md'],
    )
    const seen: string[] = []
    const worker = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: seed(),
      worker: () => {},
      trajectory: {
        policy: 'step-count',
        stepCount: 1,
        maintenance(input: MaintenanceWorkerInput) {
          seen.push(...input.workspace.list('notes'))
          assert.equal(input.workspace.search(secretText).length, 0)
          assert.throws(() => input.workspace.read('notes/secret.md'), /Local memory path refused/)
          input.workspace.write('notes/visible.md', 'visible\n')
        },
      },
    })
    const reflected = await worker.reflect({
      sessionId: 'session-a',
      branchId: 'line-a',
      entries: [entry('session-a', 'line-a', 'entry-1', 'user', 'look', 1)],
    })
    assert.ok(reflected.job)
    await worker.start(reflected.job.id)
    await worker.integrate(reflected.job.id)
    assert.deepEqual(seen, ['keep.md'])
    assert.equal((await worker.compilePrompt()).prompt.includes(secretText), false)
    assert.equal((await worker.readMemory({ path: 'notes/visible.md' })).text, 'visible\n')
    await rejects(worker.readMemory({ path: 'notes/secret.md' }), 'Local memory path refused')
  } finally {
    fx.close()
  }
})

test('workers cannot republish a tombstoned path or exact blob', async () => {
  const fx = fixture()
  try {
    const service = await open(fx.stateRoot, (ctx) => {
      ctx.write('notes/secret.md', secretText)
    })
    await service.importTombstones({
      expectedPolicyRevision: 0,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot: secretSnapshot(),
    })
    const head = await service.head()
    await service.enqueue({ id: 'recreate', summary: 'recreate secret' })
    await rejects(service.start('recreate'), 'Local memory forgetting refused')
    assert.equal((await service.job('recreate')).status, 'failed')
    assert.equal(await service.head(), head)

    const copy = await open(fx.stateRoot, (ctx) => {
      ctx.write('notes/alias.md', secretText)
    })
    await copy.enqueue({ id: 'alias', summary: 'copy blob' })
    await rejects(copy.start('alias'), 'Local memory forgetting refused')
    assert.equal(await copy.head(), head)

    const changed = await open(fx.stateRoot, (ctx) => {
      ctx.write('notes/alias.md', otherText)
    })
    await changed.enqueue({ id: 'other', summary: 'different bytes' })
    await changed.start('other')
    await changed.integrate('other')
    assert.equal(blob(fx, 'notes/alias.md'), localGitBlobId(otherText))
    assert.equal(blob(fx, 'notes/keep.md'), localGitBlobId(keepText))
    assert.throws(() => blob(fx, 'notes/secret.md'))
    const prompt = await changed.compilePrompt()
    assert.equal(prompt.prompt.includes(otherText), false)
    assert.equal(prompt.deferred.paths.includes('notes/alias.md'), true)
    assert.equal(prompt.deferred.paths.includes('notes/secret.md'), false)
    assert.equal((await changed.readMemory({ path: 'notes/alias.md' })).text, otherText)

    const renaming = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: seed(),
      worker: () => {},
      trajectory: {
        policy: 'step-count',
        stepCount: 1,
        maintenance(input: MaintenanceWorkerInput) {
          input.workspace.rename('notes/alias.md', 'notes/secret.md')
        },
      },
    })
    const renamed = await renaming.reflect({
      sessionId: 'session-b',
      branchId: 'line-b',
      entries: [entry('session-b', 'line-b', 'entry-1', 'user', 'move', 1)],
    })
    assert.ok(renamed.job)
    await rejects(renaming.start(renamed.job.id), 'Local memory forgetting refused')
    assert.equal((await renaming.job(renamed.job.id)).status, 'failed')
    const retried = await renaming.retry(renamed.job.id)
    assert.equal(retried.status, 'queued')
    await rejects(renaming.start(renamed.job.id), 'Local memory forgetting refused')
    assert.throws(() => blob(fx, 'notes/secret.md'))
    assert.equal(blob(fx, 'notes/alias.md'), localGitBlobId(otherText))

    const deleting = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: seed(),
      worker: () => {},
      trajectory: {
        policy: 'step-count',
        stepCount: 1,
        maintenance(input: MaintenanceWorkerInput) {
          input.workspace.delete('notes/keep.md')
        },
      },
    })
    const dropped = await deleting.reflect({
      sessionId: 'session-c',
      branchId: 'line-c',
      entries: [entry('session-c', 'line-c', 'entry-1', 'user', 'drop', 1)],
    })
    assert.ok(dropped.job)
    await deleting.start(dropped.job.id)
    const deleted = await deleting.integrate(dropped.job.id)
    assert.equal(deleted.status, 'integrated')
    assert.throws(() => blob(fx, 'notes/keep.md'))
    assert.equal(JSON.parse(readFileSync(join(fx.stateRoot, 'forgetting.json'), 'utf8')).policyRevision, 1)
    await rejects(deleting.readMemory({ path: 'notes/secret.md' }), 'Local memory path refused')

    const quiet = await open(fx.stateRoot)
    await quiet.enqueue({ id: 'quiet', summary: 'noop' })
    const noop = await quiet.start('quiet')
    assert.equal(noop.status, 'noop')
    assert.equal((await quiet.compilePrompt()).forgetting.pathCount, 1)
    assert.equal(JSON.parse(readFileSync(join(fx.stateRoot, 'forgetting.json'), 'utf8')).policyRevision, 1)
  } finally {
    fx.close()
  }
})

test('a committed worker cannot merge a tombstoned blob back onto main', async () => {
  const fx = fixture()
  try {
    const service = await open(fx.stateRoot, (ctx) => {
      ctx.write('notes/keep.md', 'keep-v2\n')
    })
    await service.enqueue({ id: 'edit', summary: 'edit keep' })
    await service.start('edit')
    const committed = await service.job('edit')
    assert.equal(committed.status, 'committed')
    assert.equal(blob(fx, 'notes/secret.md'), localGitBlobId(secretText))
    const keepBefore = blob(fx, 'Core.md')
    await service.importTombstones({
      expectedPolicyRevision: 0,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot: secretSnapshot(),
    })
    assert.throws(() => blob(fx, 'notes/secret.md'))
    const integrated = await service.integrate('edit')
    assert.equal(integrated.status, 'integrated')
    assert.equal(integrated.conflictPaths.includes('notes/secret.md'), false)
    assert.throws(() => blob(fx, 'notes/secret.md'))
    assert.equal(blob(fx, 'notes/keep.md'), localGitBlobId('keep-v2\n'))
    assert.equal(blob(fx, 'Core.md'), keepBefore)
    const prompt = await service.compilePrompt()
    assert.equal(prompt.prompt.includes(secretText), false)
    assert.equal(prompt.deferred.paths.includes('notes/secret.md'), false)
  } finally {
    fx.close()
  }
})

test('a keep conflict does not publish or name the tombstoned path', async () => {
  const fx = fixture()
  try {
    const service = await open(fx.stateRoot, (ctx) => {
      ctx.write('notes/keep.md', 'keep-v2\n')
    })
    await service.enqueue({ id: 'edit', summary: 'edit keep' })
    await service.start('edit')
    const base = await service.head()
    const index = join(fx.dir, 'keep.index')
    const env = { ...process.env, GIT_INDEX_FILE: index }
    const indexed = (args: string[], input?: string) =>
      execFileSync(
        'git',
        [
          '--git-dir',
          join(fx.stateRoot, canonicalGitDirectoryName),
          '-c',
          'commit.gpgsign=false',
          '-c',
          'user.name=Synthetic Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          ...args,
        ],
        { env, input, encoding: 'utf8' },
      ).trim()
    const keepV3 = indexed(['hash-object', '-w', '--stdin'], 'keep-v3\n')
    indexed(['read-tree', base])
    indexed(['update-index', '--add', '--cacheinfo', `100644,${keepV3},notes/keep.md`])
    const tree = indexed(['write-tree'])
    const moved = indexed(['commit-tree', tree, '-p', base, '-m', 'keep v3'])
    fx.git(['update-ref', 'refs/heads/main', moved, base])
    await service.importTombstones({
      expectedPolicyRevision: 0,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot: secretSnapshot(),
    })
    const cleaned = await service.head()
    const repaired = await service.integrate('edit')
    assert.equal(repaired.status, 'repair-needed')
    assert.deepEqual(repaired.conflictPaths, ['notes/keep.md'])
    assert.equal(await service.head(), cleaned)
    assert.throws(() => blob(fx, 'notes/secret.md'))
    const again = await service.integrate('edit')
    assert.equal(again.status, 'repair-needed')
    assert.deepEqual(again.conflictPaths, ['notes/keep.md'])
    await rejects(service.readMemory({ path: 'notes/secret.md' }), 'Local memory path refused')
  } finally {
    fx.close()
  }
})

test('malformed or replaced forgetting state fails closed and protected owners stay', async () => {
  const fx = fixture()
  try {
    const service = await open(fx.stateRoot)
    await service.head()
    writeFileSync(join(fx.stateRoot, 'forgetting.json'), '{}\n')
    await rejects(open(fx.stateRoot), 'Local memory forgetting refused')
    writeFileSync(join(fx.stateRoot, 'forgetting.json'), '{"version":1,"digest":"no"}\n')
    await rejects(open(fx.stateRoot), 'Local memory forgetting refused')
    rmSync(join(fx.stateRoot, 'forgetting.json'))
    await rejects(open(fx.stateRoot), 'Local memory forgetting refused')

    const fresh = fixture()
    try {
      const created = await open(fresh.stateRoot)
      const empty = emptyForgettingMetadata()
      await rejects(
        created.importTombstones({
          expectedPolicyRevision: 0,
          expectedDigest: empty.digest,
          snapshot: snapshot(['Core.md'], []),
        }),
        'Local memory forgetting refused',
      )
      await rejects(
        created.importTombstones({
          expectedPolicyRevision: 0,
          expectedDigest: empty.digest,
          snapshot: snapshot(['index.md'], [localGitBlobId(indexText)]),
        }),
        'Local memory forgetting refused',
      )
      await rejects(
        created.importTombstones({
          expectedPolicyRevision: 0,
          expectedDigest: empty.digest,
          snapshot: snapshot([], [localGitBlobId(coreText)]),
        }),
        'Local memory forgetting refused',
      )
      await rejects(
        created.importTombstones({
          expectedPolicyRevision: 0,
          expectedDigest: empty.digest,
          snapshot: snapshot(['/tmp/private/secret.md'], []),
        }),
        'Local memory forgetting refused',
      )
      const withRoot = {
        expectedPolicyRevision: 0,
        expectedDigest: empty.digest,
        root: fresh.stateRoot,
        snapshot: secretSnapshot(),
      }
      await rejects(created.importTombstones(withRoot), 'Local memory forgetting refused')
      assert.equal(await created.head(), await created.head())
      assert.equal((await created.readMemory({ path: 'Core.md' })).text, coreText)
    } finally {
      fresh.close()
    }
  } finally {
    fx.close()
  }
})

test('same blob at a new path is hidden and different bytes remain', async () => {
  const fx = fixture()
  try {
    const service = await open(fx.stateRoot)
    await service.importTombstones({
      expectedPolicyRevision: 0,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot: secretSnapshot(),
    })
    const head = await service.head()
    const index = join(fx.dir, 'alias.index')
    const env = { ...process.env, GIT_INDEX_FILE: index }
    const indexed = (args: string[], input?: string) =>
      execFileSync(
        'git',
        [
          '--git-dir',
          join(fx.stateRoot, canonicalGitDirectoryName),
          '-c',
          'commit.gpgsign=false',
          '-c',
          'user.name=Synthetic Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          ...args,
        ],
        { env, input, encoding: 'utf8' },
      ).trim()
    const secretBlob = indexed(['hash-object', '-w', '--stdin'], secretText)
    const otherBlob = indexed(['hash-object', '-w', '--stdin'], otherText)
    indexed(['read-tree', head])
    indexed(['update-index', '--add', '--cacheinfo', `100644,${secretBlob},notes/alias.md`])
    indexed(['update-index', '--add', '--cacheinfo', `100644,${otherBlob},notes/other.md`])
    const tree = indexed(['write-tree'])
    const commit = indexed(['commit-tree', tree, '-p', head, '-m', 'alias'])
    fx.git(['update-ref', 'refs/heads/main', commit, head])
    const prompt = await service.compilePrompt()
    assert.equal(prompt.prompt.includes(secretText), false)
    assert.equal(prompt.deferred.paths.includes('notes/alias.md'), false)
    assert.equal(prompt.deferred.paths.includes('notes/other.md'), true)
    await rejects(service.readMemory({ path: 'notes/alias.md' }), 'Local memory path refused')
    assert.equal((await service.readMemory({ path: 'notes/other.md' })).text, otherText)
    const listed = await service.listMemory({ path: 'notes' })
    assert.equal(
      listed.entries.some((entry) => entry.path === 'notes/alias.md'),
      false,
    )
    assert.equal(
      listed.entries.some((entry) => entry.path === 'notes/other.md'),
      true,
    )
  } finally {
    fx.close()
  }
})

test('filtered integration keeps the worker commit in the published lineage', async () => {
  const fx = fixture()
  try {
    const secret = 'soon-forgotten\n'
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { ...seed(), 'notes/secret.md': secret },
      worker: () => {},
      trajectory: {
        policy: 'step-count',
        stepCount: 1,
        maintenance(input: MaintenanceWorkerInput) {
          input.workspace.write('notes/secret.md', 'changed-secret\n')
        },
      },
    })
    const reflected = await service.reflect({
      sessionId: 'session-f',
      branchId: 'line-f',
      entries: [entry('session-f', 'line-f', 'entry-1', 'user', 'edit secret', 1)],
    })
    assert.ok(reflected.job)
    const started = await service.start(reflected.job.id)
    assert.equal(started.status, 'committed')
    const workerCommit = started.workerCommit
    assert.ok(workerCommit)
    const imported = await service.importTombstones({
      expectedPolicyRevision: 0,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot: snapshot(['notes/secret.md'], [localGitBlobId(secret), localGitBlobId('changed-secret\n')]),
    })
    assert.equal(imported.phase, 'removed')
    const base = await service.head()
    const integrated = await service.integrate(reflected.job.id)
    assert.equal(integrated.status, 'integrated')
    assert.ok(integrated.integratedCommit)
    assert.notEqual(integrated.integratedCommit, base)
    assert.equal(
      fx
        .git(['rev-parse', `${integrated.integratedCommit}^@`])
        .split('\n')
        .join(' '),
      `${base} ${workerCommit}`,
    )
    assert.equal(fx.git(['merge-base', '--is-ancestor', workerCommit, integrated.integratedCommit]), '')
    assert.throws(() => blob(fx, 'notes/secret.md'))
    assert.equal(blob(fx, 'notes/keep.md'), localGitBlobId(keepText))
    const mark = await service.watermark({ sessionId: 'session-f', branchId: 'line-f' })
    assert.equal(mark.order, 1)
    assert.equal(mark.jobId, reflected.job.id)
    const reopened = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: seed(),
      worker: () => {},
      trajectory: { policy: 'step-count', stepCount: 1, maintenance() {} },
    })
    const reread = await reopened.job(reflected.job.id)
    assert.equal(reread.status, 'integrated')
    assert.equal(reread.integratedCommit, integrated.integratedCommit)
    const resumed = await reopened.resume(reflected.job.id)
    assert.equal(resumed.status, 'integrated')
    const again = await reopened.integrate(reflected.job.id)
    assert.equal(again.status, 'integrated')
    assert.equal(again.integratedCommit, integrated.integratedCommit)
  } finally {
    fx.close()
  }
})

test('rolled-back Core and index blobs stay hidden and the paths stay present', async () => {
  const fx = fixture()
  try {
    const oldCore = 'old-core-secret\n'
    const oldIndex = 'old-index-secret\n'
    const nextCore = 'new-core\n'
    const nextIndex = 'new-index\n'
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { ...seed(), 'Core.md': oldCore, 'index.md': oldIndex },
      worker: (ctx) => {
        ctx.write('Core.md', nextCore)
        ctx.write('index.md', nextIndex)
      },
    })
    const original = await service.head()
    await service.enqueue({ id: 'revise', summary: 'revise owners' })
    await service.start('revise')
    await service.integrate('revise')
    await service.importTombstones({
      expectedPolicyRevision: 0,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot: snapshot([], [localGitBlobId(oldCore), localGitBlobId(oldIndex)]),
    })
    fx.git(['update-ref', 'refs/heads/main', original])
    assert.equal(blob(fx, 'Core.md'), localGitBlobId(oldCore))
    assert.equal(blob(fx, 'index.md'), localGitBlobId(oldIndex))
    await rejects(service.compilePrompt(), 'Local memory projection refused')
    await rejects(service.readMemory({ path: 'Core.md' }), 'Local memory path refused')
    await rejects(service.readMemory({ path: 'index.md' }), 'Local memory path refused')
    await rejects(service.readCommitted('Core.md'), 'Local memory path refused')
    await rejects(service.readCommitted('index.md'), 'Local memory path refused')
    let coreRead = ''
    let indexRead = ''
    const worker = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: seed(),
      worker: () => {},
      trajectory: {
        policy: 'step-count',
        stepCount: 1,
        maintenance(input: MaintenanceWorkerInput) {
          coreRead = input.workspace.read('Core.md')
          indexRead = input.workspace.read('index.md')
          assert.equal(input.workspace.search(oldCore.trim()).length, 0)
          assert.equal(input.workspace.search(oldIndex.trim()).length, 0)
          assert.throws(() => input.workspace.delete('Core.md'), /Local memory forgetting refused/)
          assert.throws(() => input.workspace.delete('index.md'), /Local memory forgetting refused/)
        },
      },
    })
    const reflected = await worker.reflect({
      sessionId: 'session-o',
      branchId: 'line-o',
      entries: [entry('session-o', 'line-o', 'entry-1', 'user', 'read owners', 1)],
    })
    assert.ok(reflected.job)
    const started = await worker.start(reflected.job.id)
    assert.equal(started.status, 'noop')
    assert.equal(coreRead, nextCore)
    assert.equal(indexRead, nextIndex)
    assert.equal(coreRead.includes(oldCore.trim()), false)
    assert.equal(indexRead.includes(oldIndex.trim()), false)
    assert.equal(blob(fx, 'Core.md'), localGitBlobId(oldCore))
    assert.equal(blob(fx, 'index.md'), localGitBlobId(oldIndex))
  } finally {
    fx.close()
  }
})

test('required-owner fallback keeps a leading BOM and does not publish the forbidden blob', async () => {
  const fx = fixture()
  try {
    const secret = 'owner-secret\n'
    const safe = `\uFEFF${secret}`
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { ...seed(), 'Core.md': secret, 'index.md': secret },
      worker: (ctx) => {
        ctx.write('Core.md', safe)
        ctx.write('index.md', safe)
      },
    })
    const original = await service.head()
    await service.enqueue({ id: 'bom', summary: 'prefix owners' })
    await service.start('bom')
    await service.integrate('bom')
    await service.importTombstones({
      expectedPolicyRevision: 0,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot: snapshot([], [localGitBlobId(secret)]),
    })
    fx.git(['update-ref', 'refs/heads/main', original])
    await rejects(service.compilePrompt(), 'Local memory projection refused')
    await rejects(service.readMemory({ path: 'Core.md' }), 'Local memory path refused')
    await rejects(service.readMemory({ path: 'index.md' }), 'Local memory path refused')
    await rejects(service.readCommitted('Core.md'), 'Local memory path refused')
    await rejects(service.readCommitted('index.md'), 'Local memory path refused')
    const worker = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: seed(),
      worker: () => {},
      trajectory: {
        policy: 'step-count',
        stepCount: 1,
        maintenance(input: MaintenanceWorkerInput) {
          for (const path of ['Core.md', 'index.md']) {
            const text = input.workspace.read(path)
            assert.equal(text, safe)
            assert.notEqual(text, secret)
            assert.equal(localGitBlobId(text), localGitBlobId(safe))
            assert.notEqual(localGitBlobId(text), localGitBlobId(secret))
          }
          const hits = input.workspace.search('owner-secret')
          assert.equal(
            hits.some((hit) => input.workspace.read(hit.path) === secret),
            false,
          )
          input.workspace.write('notes/marker.md', 'marker\n')
        },
      },
    })
    const reflected = await worker.reflect({
      sessionId: 'session-bom',
      branchId: 'line-bom',
      entries: [entry('session-bom', 'line-bom', 'entry-1', 'user', 'read owners', 1)],
    })
    assert.ok(reflected.job)
    const started = await worker.start(reflected.job.id)
    assert.equal(started.status, 'committed')
    assert.ok(started.workerCommit)
    const listed = fx.git(['ls-tree', '-r', started.workerCommit])
    assert.equal(listed.includes(localGitBlobId(secret)), false)
    assert.equal(listed.includes(localGitBlobId(safe)), true)
    const integrated = await worker.integrate(reflected.job.id)
    assert.equal(integrated.status, 'integrated')
    assert.equal(blob(fx, 'Core.md'), localGitBlobId(safe))
    assert.equal(blob(fx, 'index.md'), localGitBlobId(safe))
    assert.notEqual(blob(fx, 'Core.md'), localGitBlobId(secret))
    assert.equal((await worker.readMemory({ path: 'Core.md' })).text, safe)
    assert.equal((await worker.readMemory({ path: 'index.md' })).text, safe)
  } finally {
    fx.close()
  }
})

test('a missing forgetting record fails closed after initialization and can be restored', async () => {
  const fx = fixture()
  try {
    const service = await open(fx.stateRoot)
    await service.importTombstones({
      expectedPolicyRevision: 0,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot: secretSnapshot(),
    })
    const exact = readFileSync(join(fx.stateRoot, 'forgetting.json'))
    const head = await service.head()
    rmSync(join(fx.stateRoot, 'forgetting.json'))
    await rejects(service.head(), 'Local memory forgetting refused')
    assert.equal(existsSync(join(fx.stateRoot, 'forgetting.json')), false)
    await rejects(open(fx.stateRoot), 'Local memory forgetting refused')
    assert.equal(existsSync(join(fx.stateRoot, 'forgetting.json')), false)
    writeFileSync(join(fx.stateRoot, 'forgetting.json'), exact)
    assert.equal(await service.head(), head)
    assert.equal((await service.compilePrompt()).forgetting.policyRevision, 1)
    const reopened = await open(fx.stateRoot)
    assert.equal(await reopened.head(), head)
    assert.equal((await reopened.compilePrompt()).forgetting.pathCount, 1)
    await rejects(reopened.readMemory({ path: 'notes/secret.md' }), 'Local memory path refused')
  } finally {
    fx.close()
  }
})

function entry(
  sessionId: string,
  branchId: string,
  entryId: string,
  role: 'user' | 'assistant' | 'tool',
  text: string,
  order: number,
): SyntheticPublicEntry {
  return {
    sessionId,
    branchId,
    entryId,
    role,
    text,
    order,
    timestamp: `2026-10-29T00:00:${String(order).padStart(2, '0')}Z`,
  }
}
