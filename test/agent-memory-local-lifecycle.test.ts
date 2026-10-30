import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { canonicalGitDirectoryName } from '../lib/agent-memory/local/contracts.ts'
import { createSyntheticLocalMemoryService, type LocalWorker } from '../lib/agent-memory/local/service.ts'

const initialFiles = { 'Core.md': 'base\n' }

function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-local-'))
  const stateRoot = join(dir, 'state')
  const hooks = join(dir, 'hooks')
  mkdirSync(stateRoot, { mode: 0o700 })
  mkdirSync(hooks, { mode: 0o700 })
  const bare = () => join(stateRoot, canonicalGitDirectoryName)
  const git = (cwd: string | undefined, args: string[]) =>
    execFileSync(
      'git',
      [
        ...(cwd ? ['-C', cwd] : ['--git-dir', bare()]),
        '-c',
        `core.hooksPath=${hooks}`,
        '-c',
        'credential.helper=',
        '-c',
        'core.fsmonitor=',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=Synthetic Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        ...args,
      ],
      { encoding: 'utf8' },
    ).trim()
  return {
    dir,
    stateRoot,
    bare,
    git,
    close() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function remembering(body: string): LocalWorker {
  return (ctx) => {
    assert.equal('worktreeRoot' in ctx, false)
    ctx.write('notes.md', body)
  }
}

test('queued worker commit integrates once against the bare ref', async () => {
  const fx = fixture()
  try {
    const first = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      worker: remembering('from worker\n'),
      initialFiles,
    })
    assert.equal(fx.git(undefined, ['rev-parse', '--is-bare-repository']), 'true')
    const queued = await first.enqueue({ id: 'learn-1', summary: 'remember note' })
    assert.equal(queued.status, 'queued')
    const committed = await first.start('learn-1')
    assert.equal(committed.status, 'committed')
    const before = Number(fx.git(undefined, ['rev-list', '--count', 'refs/heads/main']))
    const restarted = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      worker: () => {
        throw Error('worker re-entered')
      },
      initialFiles,
    })
    const integrated = await restarted.resume('learn-1')
    assert.equal(integrated.status, 'integrated')
    assert.equal(integrated.integratedCommit, committed.workerCommit)
    assert.equal(await restarted.readCommitted('notes.md'), 'from worker\n')
    assert.equal(await restarted.readCommitted('Core.md'), 'base\n')
    writeFileSync(join(fx.dir, 'decoy.md'), 'not published\n')
    assert.equal(await restarted.readCommitted('notes.md'), 'from worker\n')
    const head = await restarted.head()
    await restarted.resume('learn-1')
    assert.equal(await restarted.head(), head)
    assert.equal(Number(fx.git(undefined, ['rev-list', '--count', 'refs/heads/main'])), before + 1)
  } finally {
    fx.close()
  }
})

test('disjoint main edit and overlap both follow the bare ref', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      worker: (ctx) => {
        if (ctx.jobId === 'overlap') ctx.write('Core.md', 'overlap\n')
        else if (ctx.jobId === 'aside') ctx.write('aside.md', 'aside\n')
        else ctx.write('notes.md', `${ctx.jobId}\n`)
      },
      initialFiles,
    })
    await service.enqueue({ id: 'learn-1', summary: 'remember note' })
    const committed = await service.start('learn-1')
    const side = join(fx.dir, 'side')
    fx.git(undefined, ['worktree', 'add', side, 'main'])
    writeFileSync(join(side, 'other.md'), 'parent edit\n')
    fx.git(side, ['add', '--', 'other.md'])
    fx.git(side, ['commit', '-m', 'parent edit'])
    const parentHead = fx.git(undefined, ['rev-parse', 'refs/heads/main'])
    const integrated = await service.integrate('learn-1')
    assert.equal(integrated.status, 'integrated')
    assert.notEqual(integrated.integratedCommit, committed.workerCommit)
    assert.equal(await service.readCommitted('notes.md'), 'learn-1\n')
    assert.equal(await service.readCommitted('other.md'), 'parent edit\n')
    assert.equal(fx.git(undefined, ['merge-base', '--is-ancestor', parentHead, 'refs/heads/main']), '')

    await service.enqueue({ id: 'overlap', summary: 'overlap core' })
    await service.start('overlap')
    fx.git(side, ['merge', '--ff-only', 'main'])
    writeFileSync(join(side, 'Core.md'), 'parent\n')
    fx.git(side, ['add', '--', 'Core.md'])
    fx.git(side, ['commit', '-m', 'parent core'])
    const blocked = await service.integrate('overlap')
    assert.equal(blocked.status, 'repair-needed')
    assert.deepEqual(blocked.conflictPaths, ['Core.md'])
    assert.equal(await service.readCommitted('Core.md'), 'parent\n')
    await service.enqueue({ id: 'aside', summary: 'disjoint note' })
    const aside = await service.integrate((await service.start('aside')).id)
    assert.equal(aside.status, 'integrated')
    assert.equal(await service.readCommitted('aside.md'), 'aside\n')
    assert.equal((await service.job('overlap')).status, 'repair-needed')
  } finally {
    fx.close()
  }
})

test('worker writes do not follow symlinks or hard links', async () => {
  const fx = fixture()
  try {
    const outside = join(fx.dir, 'outside')
    mkdirSync(outside, { mode: 0o700 })
    writeFileSync(join(outside, 'leaf.md'), 'safe\n')
    writeFileSync(join(outside, 'nested.md'), 'safe\n')
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      injection: {
        beforeWorker: (path) => {
          symlinkSync(join(outside, 'leaf.md'), join(path, 'notes.md'))
        },
      },
      worker: (ctx) => {
        ctx.write('notes.md', 'pwned\n')
      },
    })
    await service.enqueue({ id: 'leaf', summary: 'leaf symlink' })
    await assert.rejects(() => service.start('leaf'), /path refused/)
    assert.equal(readFileSync(join(outside, 'leaf.md'), 'utf8'), 'safe\n')
    const linked = join(fx.dir, 'hardlink-target')
    writeFileSync(linked, 'safe\n')
    const hard = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      injection: {
        beforeWorker: (path) => {
          linkSync(linked, join(path, 'notes.md'))
        },
      },
      worker: (ctx) => {
        ctx.write('notes.md', 'pwned\n')
      },
    })
    await hard.enqueue({ id: 'hardlink', summary: 'hard link' })
    await assert.rejects(() => hard.start('hardlink'), /path refused/)
    assert.equal(readFileSync(linked, 'utf8'), 'safe\n')
    const ancestor = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      injection: {
        beforeWorker: (path) => {
          symlinkSync(outside, join(path, 'linked'))
        },
      },
      worker: (ctx) => {
        ctx.write('linked/nested.md', 'pwned\n')
      },
    })
    await ancestor.enqueue({ id: 'ancestor', summary: 'ancestor symlink' })
    await assert.rejects(() => ancestor.start('ancestor'), /path refused/)
    assert.equal(readFileSync(join(outside, 'nested.md'), 'utf8'), 'safe\n')
  } finally {
    fx.close()
  }
})

test('an unrelated pending commit cannot move main', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('notes.md', 'from worker\n'),
    })
    await service.enqueue({ id: 'learn-1', summary: 'remember note' })
    await service.start('learn-1')
    const main = await service.head()
    const unrelated = fx.git(undefined, [
      'commit-tree',
      fx.git(undefined, ['rev-parse', 'HEAD^{tree}']),
      '-m',
      'unrelated',
    ])
    const jobPath = join(fx.stateRoot, 'jobs', 'learn-1.json')
    const record = JSON.parse(readFileSync(jobPath, 'utf8')) as {
      pendingIntegration: string
      expectedParent: string
    }
    record.pendingIntegration = unrelated
    record.expectedParent = main
    writeFileSync(jobPath, `${JSON.stringify(record)}\n`)
    await assert.rejects(() => service.integrate('learn-1'), /publication refused/)
    assert.equal(await service.head(), main)
  } finally {
    fx.close()
  }
})

test('a pre-existing repository or malformed manifest is refused', async () => {
  const existing = fixture()
  try {
    execFileSync('git', ['init', '--bare', '--quiet', '--template=', '-b', 'main', existing.bare()])
    await assert.rejects(
      () =>
        createSyntheticLocalMemoryService({ stateRoot: existing.stateRoot, initialFiles, worker: () => {} }),
      /repository refused/,
    )
  } finally {
    existing.close()
  }
  const malformed = fixture()
  try {
    writeFileSync(join(malformed.stateRoot, 'meta.json'), '{}\n')
    await assert.rejects(
      () =>
        createSyntheticLocalMemoryService({ stateRoot: malformed.stateRoot, initialFiles, worker: () => {} }),
      /repository refused|state refused/,
    )
  } finally {
    malformed.close()
  }
})

test('allocation and removal interruptions reconcile without touching replacements', async () => {
  const fx = fixture()
  try {
    const added = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('notes.md', 'from worker\n'),
      injection: { stopAfter: 'worktree-added' },
    })
    await added.enqueue({ id: 'added', summary: 'added window' })
    assert.equal((await added.start('added')).status, 'running')
    const addedPath = join(fx.stateRoot, 'worktrees', 'added')
    rmSync(addedPath, { recursive: true })
    mkdirSync(addedPath, { mode: 0o700 })
    writeFileSync(join(addedPath, 'sentinel.txt'), 'keep\n')
    const resumed = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('aside.md', 'aside\n'),
    })
    assert.equal((await resumed.job('added')).status, 'failed')
    assert.equal(readFileSync(join(addedPath, 'sentinel.txt'), 'utf8'), 'keep\n')

    const owned = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: () => {},
      injection: { stopAfter: 'ownership-written' },
    })
    await owned.enqueue({ id: 'owned', summary: 'owned window' })
    assert.equal((await owned.start('owned')).status, 'running')
    const ownedPath = join(fx.stateRoot, 'worktrees', 'owned')
    assert.equal(existsSync(join(fx.stateRoot, 'ownership', 'owned.json')), true)
    rmSync(ownedPath, { recursive: true })
    mkdirSync(ownedPath, { mode: 0o700 })
    writeFileSync(join(ownedPath, 'sentinel.txt'), 'keep\n')
    assert.equal((await resumed.job('owned')).status, 'failed')
    assert.equal(readFileSync(join(ownedPath, 'sentinel.txt'), 'utf8'), 'keep\n')

    const clean = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('notes.md', 'owned\n'),
      injection: { stopAfter: 'worktree-removed' },
    })
    await clean.enqueue({ id: 'gone', summary: 'remove window' })
    const committed = await clean.start('gone')
    assert.ok(committed.worktreePath)
    await clean.cleanup(committed.worktreePath)
    assert.equal(existsSync(join(fx.stateRoot, 'ownership', 'gone.json')), true)
    mkdirSync(committed.worktreePath, { mode: 0o700 })
    writeFileSync(join(committed.worktreePath, 'sentinel.txt'), 'keep\n')
    await resumed.head()
    assert.equal(existsSync(join(fx.stateRoot, 'ownership', 'gone.json')), false)
    assert.equal(readFileSync(join(committed.worktreePath, 'sentinel.txt'), 'utf8'), 'keep\n')
  } finally {
    fx.close()
  }
})

test('automatic recover removal restarts after git removal', async () => {
  const fx = fixture()
  try {
    const prepared = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: () => {},
      injection: { stopAfter: 'ownership-written' },
    })
    await prepared.enqueue({ id: 'rec', summary: 'recover removal' })
    assert.equal((await prepared.start('rec')).status, 'running')
    const recPath = join(fx.stateRoot, 'worktrees', 'rec')
    const cutting = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('aside.md', 'aside\n'),
      injection: { stopAfter: 'recover-removed' },
    })
    assert.equal((await cutting.job('rec')).status, 'running')
    assert.equal(existsSync(join(fx.stateRoot, 'ownership', 'rec.json')), true)
    assert.equal(existsSync(recPath), false)
    mkdirSync(recPath, { mode: 0o700 })
    writeFileSync(join(recPath, 'sentinel.txt'), 'keep\n')
    const resumed = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('aside.md', 'aside\n'),
    })
    assert.equal((await resumed.job('rec')).status, 'failed')
    assert.equal(readFileSync(join(recPath, 'sentinel.txt'), 'utf8'), 'keep\n')
    assert.equal(await resumed.readCommitted('Core.md'), 'base\n')
    await resumed.enqueue({ id: 'later', summary: 'after recover' })
    await resumed.integrate((await resumed.start('later')).id)
    assert.equal(await resumed.readCommitted('aside.md'), 'aside\n')
  } finally {
    fx.close()
  }
})

test('a replaced running worktree stays put and does not block reads', async () => {
  const fx = fixture()
  try {
    const prepared = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('notes.md', 'from worker\n'),
      injection: { stopAfter: 'worktree-path' },
    })
    await prepared.enqueue({ id: 'live', summary: 'running tree' })
    const running = await prepared.start('live')
    assert.equal(running.status, 'running')
    const livePath = running.worktreePath
    assert.ok(livePath)
    const base = readFileSync(join(livePath, 'Core.md'))
    const original = lstatSync(livePath)
    const held = join(fx.dir, 'held-worktree')
    renameSync(livePath, held)
    mkdirSync(livePath, { mode: 0o700 })
    writeFileSync(join(livePath, 'Core.md'), base)
    const replacement = lstatSync(livePath)
    assert.notEqual(`${replacement.dev}:${replacement.ino}`, `${original.dev}:${original.ino}`)
    const resumed = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('aside.md', 'aside\n'),
    })
    assert.equal((await resumed.job('live')).status, 'failed')
    assert.equal(readFileSync(join(livePath, 'Core.md'), 'utf8'), 'base\n')
    assert.equal(await resumed.readCommitted('Core.md'), 'base\n')
    await resumed.enqueue({ id: 'aside', summary: 'disjoint note' })
    await resumed.integrate((await resumed.start('aside')).id)
    assert.equal(await resumed.readCommitted('aside.md'), 'aside\n')
    assert.equal(readFileSync(join(livePath, 'Core.md'), 'utf8'), 'base\n')
  } finally {
    fx.close()
  }
})

test('a stop after worktree add reconciles the registered worktree', async () => {
  const fx = fixture()
  try {
    const adding = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: () => {},
      injection: { stopAfter: 'worktree-adding' },
    })
    await adding.enqueue({ id: 'early', summary: 'before added' })
    assert.equal((await adding.start('early')).status, 'running')
    const earlyPath = join(fx.stateRoot, 'worktrees', 'early')
    const progress = JSON.parse(readFileSync(join(fx.stateRoot, 'progress', 'early.json'), 'utf8')) as {
      phase: string
      gitDir: string | null
      dev: string | null
    }
    assert.equal(progress.phase, 'adding')
    assert.equal(progress.dev, null)
    assert.equal(progress.gitDir, join(fx.bare(), 'worktrees', 'early'))
    assert.equal(existsSync(earlyPath), true)
    const resumed = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('aside.md', 'aside\n'),
    })
    assert.equal((await resumed.job('early')).status, 'failed')
    assert.equal(fx.git(undefined, ['worktree', 'list', '--porcelain']).includes(earlyPath), false)
    assert.equal(await resumed.readCommitted('Core.md'), 'base\n')
    await resumed.enqueue({ id: 'later', summary: 'after adding' })
    await resumed.integrate((await resumed.start('later')).id)
    assert.equal(await resumed.readCommitted('aside.md'), 'aside\n')

    const replaced = fixture()
    const planted = await createSyntheticLocalMemoryService({
      stateRoot: replaced.stateRoot,
      initialFiles,
      worker: () => {},
      injection: { stopAfter: 'worktree-adding' },
    })
    await planted.enqueue({ id: 'early', summary: 'replaced add' })
    await planted.start('early')
    const replacedPath = join(replaced.stateRoot, 'worktrees', 'early')
    rmSync(replacedPath, { recursive: true })
    mkdirSync(replacedPath, { mode: 0o700 })
    writeFileSync(join(replacedPath, 'sentinel.txt'), 'keep\n')
    const next = await createSyntheticLocalMemoryService({
      stateRoot: replaced.stateRoot,
      initialFiles,
      worker: () => {},
    })
    assert.equal((await next.job('early')).status, 'failed')
    assert.equal(readFileSync(join(replacedPath, 'sentinel.txt'), 'utf8'), 'keep\n')
    assert.equal(existsSync(join(replaced.stateRoot, 'ownership', 'early.json')), false)
    await next.enqueue({ id: 'later', summary: 'after replacement' })
    assert.equal((await next.job('later')).status, 'queued')
    assert.equal(await next.readCommitted('Core.md'), 'base\n')
    replaced.close()
  } finally {
    fx.close()
  }
})

test('parent cardinality is exact and inspection failures propagate', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('notes.md', 'from worker\n'),
    })
    await service.enqueue({ id: 'learn-1', summary: 'remember note' })
    await service.start('learn-1')
    const main = await service.head()
    const tree = fx.git(undefined, ['rev-parse', 'HEAD^{tree}'])
    const other = fx.git(undefined, ['commit-tree', tree, '-p', main, '-m', 'other'])
    const extra = fx.git(undefined, ['commit-tree', tree, '-p', main, '-p', other, '-m', 'extra'])
    const side = fx.git(undefined, ['commit-tree', tree, '-p', other, '-m', 'side'])
    const third = fx.git(undefined, ['commit-tree', tree, '-p', main, '-p', extra, '-p', side, '-m', 'third'])
    const jobPath = join(fx.stateRoot, 'jobs', 'learn-1.json')
    const record = JSON.parse(readFileSync(jobPath, 'utf8')) as {
      workerCommit: string
      pendingIntegration: string | null
      expectedParent: string | null
    }
    const worker = record.workerCommit
    record.workerCommit = extra
    writeFileSync(jobPath, `${JSON.stringify(record)}\n`)
    await assert.rejects(() => service.job('learn-1'), /job refused/)
    assert.equal(await service.head(), main)
    record.workerCommit = worker
    record.pendingIntegration = third
    record.expectedParent = main
    writeFileSync(jobPath, `${JSON.stringify(record)}\n`)
    await assert.rejects(() => service.integrate('learn-1'), /publication refused/)
    assert.equal(await service.head(), main)
    record.pendingIntegration = null
    record.expectedParent = null
    record.workerCommit = 'a'.repeat(40)
    writeFileSync(jobPath, `${JSON.stringify(record)}\n`)
    await assert.rejects(() => service.job('learn-1'), /Local Git failed/)
    assert.equal(fx.git(undefined, ['rev-parse', 'refs/heads/main']), main)
  } finally {
    fx.close()
  }
})

test('unchanged writes are noop and identity interruption can resume', async () => {
  const fx = fixture()
  try {
    const same = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('Core.md', 'base\n'),
    })
    await same.enqueue({ id: 'same', summary: 'same bytes' })
    const before = Number(fx.git(undefined, ['rev-list', '--count', 'refs/heads/main']))
    assert.equal((await same.start('same')).status, 'noop')
    assert.equal(Number(fx.git(undefined, ['rev-list', '--count', 'refs/heads/main'])), before)
    const partial = fixture()
    await assert.rejects(
      () =>
        createSyntheticLocalMemoryService({
          stateRoot: partial.stateRoot,
          initialFiles,
          worker: () => {},
          injection: { stopAfter: 'identity' },
        }),
      /initialization interrupted/,
    )
    assert.equal(existsSync(join(partial.stateRoot, 'git-identity')), true)
    assert.equal(existsSync(partial.bare()), false)
    const resumed = await createSyntheticLocalMemoryService({
      stateRoot: partial.stateRoot,
      initialFiles,
      worker: () => {},
    })
    assert.equal(await resumed.readCommitted('Core.md'), 'base\n')
    partial.close()
  } finally {
    fx.close()
  }
})

test('cleanup failure after ownership checks can be retried', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('notes.md', 'owned\n'),
      injection: { failCleanupRemoves: 1 },
    })
    await service.enqueue({ id: 'keep', summary: 'owned note' })
    const committed = await service.start('keep')
    const worktree = committed.worktreePath
    assert.ok(worktree)
    const sibling = join(fx.dir, 'sibling.txt')
    writeFileSync(sibling, 'keep\n')
    await assert.rejects(() => service.cleanup(worktree), /cleanup interrupted/)
    assert.equal(fx.git(undefined, ['worktree', 'list', '--porcelain']).includes(worktree), true)
    assert.equal(readFileSync(join(fx.stateRoot, 'ownership', 'keep.json'), 'utf8').includes(worktree), true)
    await service.cleanup(worktree)
    assert.equal(readFileSync(sibling, 'utf8'), 'keep\n')
    assert.equal(fx.git(undefined, ['worktree', 'list', '--porcelain']).includes(worktree), false)
    await assert.rejects(() => service.cleanup(worktree), /Unowned worktree refused/)
    await service.integrate('keep')
    const dirty = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('dirty.md', 'owned\n'),
    })
    await dirty.enqueue({ id: 'dirty', summary: 'dirty tree' })
    const dirtyJob = await dirty.start('dirty')
    const dirtyPath = dirtyJob.worktreePath
    assert.ok(dirtyPath)
    writeFileSync(join(dirtyPath, 'extra.md'), 'keep\n')
    await assert.rejects(() => dirty.cleanup(dirtyPath), /worktree dirty/)
    assert.equal(readFileSync(join(dirtyPath, 'extra.md'), 'utf8'), 'keep\n')
  } finally {
    fx.close()
  }
})

test('interrupted running jobs do not block later work', async () => {
  const fx = fixture()
  try {
    const stopped = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('notes.md', 'from worker\n'),
      injection: { stopAfter: 'running' },
    })
    await stopped.enqueue({ id: 'stuck', summary: 'stuck job' })
    assert.equal((await stopped.start('stuck')).status, 'running')
    const next = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('aside.md', 'aside\n'),
    })
    assert.equal((await next.job('stuck')).status, 'failed')
    await next.enqueue({ id: 'aside', summary: 'aside job' })
    await next.integrate((await next.start('aside')).id)
    assert.equal(await next.readCommitted('aside.md'), 'aside\n')
    const committed = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: (ctx) => ctx.write('notes.md', 'from worker\n'),
      injection: { stopAfter: 'commit' },
    })
    await committed.enqueue({ id: 'cut', summary: 'cut after commit' })
    assert.equal((await committed.start('cut')).status, 'running')
    const before = Number(fx.git(undefined, ['rev-list', '--count', 'refs/heads/main']))
    assert.equal((await next.resume('cut')).status, 'integrated')
    const head = await next.head()
    await next.resume('cut')
    assert.equal(await next.head(), head)
    assert.equal(Number(fx.git(undefined, ['rev-list', '--count', 'refs/heads/main'])), before + 1)
  } finally {
    fx.close()
  }
})

test('malformed records and a fifo path are refused without blocking', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: () => {},
    })
    const head = await service.head()
    const plant = (body: Record<string, unknown>) =>
      writeFileSync(
        join(fx.stateRoot, 'jobs', 'learn-1.json'),
        `${JSON.stringify({
          version: 1,
          id: 'learn-1',
          status: 'queued',
          summary: 'planted',
          baseHead: head,
          workerCommit: null,
          integratedCommit: null,
          pendingIntegration: null,
          expectedParent: null,
          worktreePath: null,
          conflictPaths: [],
          sequence: 1,
          ...body,
        })}\n`,
      )
    plant({ id: 'other-job' })
    await assert.rejects(() => service.job('learn-1'), /job refused|record refused/)
    rmSync(join(fx.stateRoot, 'jobs', 'learn-1.json'))
    execFileSync('mkfifo', [join(fx.stateRoot, 'jobs', 'learn-1.json')])
    const raced = await Promise.race([
      service.job('learn-1').then(
        () => 'opened',
        (error: Error) => error.message,
      ),
      delay(1000).then(() => 'blocked'),
    ])
    assert.notEqual(raced, 'blocked')
    assert.match(String(raced), /refused/)
    rmSync(join(fx.stateRoot, 'jobs', 'learn-1.json'))
    assert.equal(await service.head(), head)
  } finally {
    fx.close()
  }
})
