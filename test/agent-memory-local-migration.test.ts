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
import { setImmediate as yieldTurn } from 'node:timers/promises'
import { canonicalGitDirectoryName } from '../lib/agent-memory/local/contracts.ts'
import { loadJob, saveJob } from '../lib/agent-memory/local/jobs.ts'
import {
  openShadowMigration,
  rollbackShadowMigration,
  type ShadowMigrationBundle,
  type ShadowMigrationFile,
} from '../lib/agent-memory/local/migration.ts'
import type { TombstoneSource } from '../lib/agent-memory/local/forgetting.ts'
import {
  canonicalLedgerDigest,
  migrationExportSections,
  pageMigrationExport,
} from '../lib/agent-memory/migration-export.ts'
import { suppressed, type Ledger } from '../lib/agent-memory/engine/schema.ts'
import { digest } from '../lib/continuity/records.ts'

const secretText = 'secret-sentinel\n'
const oldText = 'old-sentinel\n'

function fixture(name = 'mahiro-shadow-') {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), name))
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

function file(path: string, text: string, sources: string[] = []): ShadowMigrationFile {
  const hash = digest(text)
  const revision = 'a'.repeat(40)
  return {
    path,
    text,
    hash,
    sources,
    read: {
      revision,
      currentRevision: revision,
      basis: 'view-snapshot',
      freshness: 'current',
      path,
      hash,
      sources,
    },
  }
}

function bundleFor(input: {
  files: ShadowMigrationFile[]
  forgottenPaths?: string[]
  forgottenSources?: TombstoneSource[]
  reviewed?: string[]
  includeForgottenInExport?: boolean
}): ShadowMigrationBundle {
  const files = [...input.files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )
  const forgottenPaths = input.forgottenPaths ?? []
  const forgottenSources = input.forgottenSources ?? []
  const reviewed = input.reviewed ?? []
  const ledger: Ledger = {
    version: 2,
    sources: {},
    forgottenPaths,
    forgottenSources,
    reviewed,
  }
  for (const entry of files) {
    const dropped = suppressed(ledger, entry.path, entry.sources)
    if (!dropped || input.includeForgottenInExport) ledger.sources[entry.path] = entry.sources
  }
  const raw = `${JSON.stringify({
    version: 2,
    sources: ledger.sources,
    forgottenPaths,
    forgottenSources,
    reviewed,
  })}\n`
  const revision = 'a'.repeat(40)
  const configHash = 'b'.repeat(64)
  const ledgerDigest = canonicalLedgerDigest(raw)
  const contentHashes = Object.fromEntries(files.map((entry) => [entry.path, entry.hash]))
  const pages = []
  for (const section of migrationExportSections) {
    let offset = 0
    for (;;) {
      const page = pageMigrationExport({
        revision,
        configHash,
        ledgerDigest,
        ledger,
        section,
        offset,
        limit: 32,
        contentHashes,
      })
      pages.push(page)
      if (page.nextOffset === undefined) break
      offset = page.nextOffset
    }
  }
  const bundle = {
    revision,
    configHash,
    ledgerDigest,
    files,
    forgottenPaths,
    forgottenSources,
    reviewed,
    pages,
  }
  if (input.includeForgottenInExport) includeForgotten(bundle)
  return bundle
}

function includeForgotten(bundle: ShadowMigrationBundle) {
  const page = bundle.pages.find((entry) => entry.section === 'sources')
  assert.ok(page)
  assert.equal(page.nextOffset, undefined)
  const present = new Set((page.entries as { path: string }[]).map((entry) => entry.path))
  const rows = [
    ...(page.entries as { path: string; sources: string[] }[]),
    ...bundle.files
      .filter((entry) => !present.has(entry.path))
      .map((entry) => ({ path: entry.path, sources: entry.sources, hash: entry.hash })),
  ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  page.entries = rows
  page.total = rows.length
  const binding = bundle.pages.find((entry) => entry.section === 'binding')
  assert.ok(binding)
  ;(binding.entries[0] as { activeFiles: number }).activeFiles = rows.length
}

test('shadow migration filters forgotten entries and reconciles a corpus-scale bundle', async () => {
  const fx = fixture()
  try {
    const files = [
      file('Core.md', 'base\n'),
      file('index.md', 'index\n'),
      file('global/keep.md', 'kept\n', ['source-keep']),
    ]
    files.push(file('global/secret.md', secretText, ['source-secret']))
    files.push(file('global/old.md', oldText, ['source-old']))
    const bundle = bundleFor({
      files,
      forgottenPaths: ['global/secret.md'],
      forgottenSources: [
        { project: null, source: 'source-old' },
        { project: 'project', source: 'source-old' },
      ],
      reviewed: ['episode-one'],
      includeForgottenInExport: true,
    })
    const opened = await openShadowMigration({
      stateRoot: fx.stateRoot,
      bundle,
      worker: () => {},
    })
    assert.equal(opened.receipt.fileCount, 3)
    assert.equal(opened.receipt.reviewed[0], 'episode-one')
    assert.equal(JSON.stringify(opened.receipt).includes(secretText.trim()), false)
    assert.equal(JSON.stringify(opened.receipt).includes(oldText.trim()), false)
    assert.equal(await opened.service.readCommitted('global/keep.md'), 'kept\n')
    await assert.rejects(() => opened.service.readCommitted('global/secret.md'), /Local memory path refused/)
    await assert.rejects(() => opened.service.readCommitted('global/old.md'), /Local memory path refused/)
    const again = await openShadowMigration({ stateRoot: fx.stateRoot, bundle, worker: () => {} })
    assert.deepEqual(again.receipt, opened.receipt)
    const changed = bundleFor({
      files: [file('Core.md', 'other\n'), file('index.md', 'index\n')],
    })
    await assert.rejects(
      () => openShadowMigration({ stateRoot: fx.stateRoot, bundle: changed, worker: () => {} }),
      /Local memory migration stale/,
    )
    const scaleRoot = join(fx.dir, 'scale')
    mkdirSync(scaleRoot, { mode: 0o700 })
    const scaleFiles = [file('Core.md', 'base\n'), file('index.md', 'index\n')]
    for (let index = 0; index < 291; index += 1)
      scaleFiles.push(
        file(
          `global/f${String(index).padStart(3, '0')}.md`,
          `${String(index).padStart(4, '0')}${'x'.repeat(13596)}\n`,
        ),
      )
    const scale = bundleFor({ files: scaleFiles, reviewed: ['episode-scale'] })
    assert.equal(scale.files.length, 293)
    const seeded = await openShadowMigration({ stateRoot: scaleRoot, bundle: scale, worker: () => {} })
    assert.equal(seeded.receipt.fileCount, 293)
    assert.ok(seeded.receipt.bytes > 3.7 * 1024 * 1024)
    assert.ok(seeded.receipt.bytes < 4 * 1024 * 1024)
    assert.equal(seeded.receipt.sourceRevision, scale.revision)
    assert.equal(seeded.receipt.ledgerDigest, scale.ledgerDigest)
    const reopened = await openShadowMigration({ stateRoot: scaleRoot, bundle: scale, worker: () => {} })
    assert.deepEqual(reopened.receipt, seeded.receipt)
  } finally {
    fx.close()
  }
})

test('interrupted shadow creation resumes, and rollback refuses a replacement', async () => {
  const fx = fixture('mahiro-shadow-recover-')
  const sibling = join(fx.dir, 'sibling')
  mkdirSync(sibling, { mode: 0o700 })
  writeFileSync(join(sibling, 'keep.txt'), 'stay\n')
  const bundle = bundleFor({
    files: [file('Core.md', 'base\n'), file('index.md', 'index\n'), file('global/secret.md', secretText)],
    forgottenPaths: ['global/secret.md'],
  })
  try {
    await assert.rejects(
      () =>
        openShadowMigration({
          stateRoot: fx.stateRoot,
          bundle,
          worker: () => {},
          injection: { stopAfter: 'owner' },
        }),
      /Local memory migration interrupted/,
    )
    const removed = await rollbackShadowMigration(fx.stateRoot)
    assert.equal(existsSync(fx.stateRoot), false)
    assert.equal(existsSync(removed.quarantined), true)
    assert.ok(removed.quarantined.includes('.quarantine-'))
    assert.equal(readFileSync(join(sibling, 'keep.txt'), 'utf8'), 'stay\n')
    mkdirSync(fx.stateRoot, { mode: 0o700 })
    await assert.rejects(
      () =>
        openShadowMigration({
          stateRoot: fx.stateRoot,
          bundle,
          worker: () => {},
          injection: { stopAfter: 'identity' },
        }),
      /Local memory initialization interrupted/,
    )
    const resumed = await openShadowMigration({ stateRoot: fx.stateRoot, bundle, worker: () => {} })
    assert.equal(await resumed.service.readCommitted('Core.md'), 'base\n')
    await assert.rejects(() => resumed.service.readCommitted('global/secret.md'), /Local memory path refused/)
    const partial = join(fx.dir, 'partial')
    mkdirSync(partial, { mode: 0o700 })
    await assert.rejects(
      () =>
        openShadowMigration({
          stateRoot: partial,
          bundle,
          worker: () => {},
          injection: { stopAfter: 'seeded' },
        }),
      /Local memory migration interrupted/,
    )
    const recovered = await openShadowMigration({ stateRoot: partial, bundle, worker: () => {} })
    const same = await openShadowMigration({ stateRoot: partial, bundle, worker: () => {} })
    assert.deepEqual(same.receipt, recovered.receipt)
    const empty = join(fx.dir, 'empty')
    mkdirSync(empty, { mode: 0o700 })
    await assert.rejects(() => rollbackShadowMigration(empty), /Local memory migration refused/)
    assert.equal(readFileSync(join(sibling, 'keep.txt'), 'utf8'), 'stay\n')
    const metaPath = join(partial, 'meta.json')
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    meta.nonce = 'c'.repeat(32)
    writeFileSync(metaPath, `${JSON.stringify(meta)}\n`)
    await assert.rejects(() => rollbackShadowMigration(partial), /Local memory migration refused/)
    assert.equal(JSON.parse(readFileSync(metaPath, 'utf8')).nonce, 'c'.repeat(32))
    const bad = bundleFor({
      files: [file('Core.md', 'base\n'), file('index.md', 'index\n'), file('Core.md', 'other\n')],
    })
    const untouched = join(fx.dir, 'untouched')
    mkdirSync(untouched, { mode: 0o700 })
    await assert.rejects(
      () => openShadowMigration({ stateRoot: untouched, bundle: bad, worker: () => {} }),
      /Local memory migration refused/,
    )
    assert.equal(existsSync(join(untouched, canonicalGitDirectoryName)), false)
  } finally {
    fx.close()
  }
})

test('shadow learn, repair, retrieval, restart and rollback keep tombstones', async () => {
  const fx = fixture('mahiro-shadow-learn-')
  const bundle = bundleFor({
    files: [
      file('Core.md', 'base\n'),
      file('index.md', 'index\n'),
      file('global/keep.md', 'kept\n'),
      file('global/secret.md', secretText, ['source-secret']),
      file('global/old.md', oldText, ['source-old']),
    ],
    forgottenPaths: ['global/secret.md'],
    forgottenSources: [{ project: null, source: 'source-old' }],
    reviewed: ['episode-learn'],
    includeForgottenInExport: true,
  })
  try {
    const opened = await openShadowMigration({
      stateRoot: fx.stateRoot,
      bundle,
      worker: (ctx) => {
        if (ctx.jobId === 'learn-1') ctx.write('global/learned.md', 'learned-fact\n')
        else if (ctx.jobId === 'overlap') ctx.write('Core.md', 'overlap\n')
        else if (ctx.jobId === 'same') ctx.write('Core.md', 'parent\n')
        else if (ctx.jobId === 'aside') ctx.write('global/aside.md', 'aside\n')
      },
    })
    await opened.service.enqueue({ id: 'learn-1', summary: 'remember note' })
    await opened.service.start('learn-1')
    const side = join(fx.dir, 'side')
    fx.git(undefined, ['worktree', 'add', side, 'main'])
    writeFileSync(join(side, 'global/parent.md'), 'parent edit\n')
    fx.git(side, ['add', '--', 'global/parent.md'])
    fx.git(side, ['commit', '-m', 'parent edit'])
    const integrated = await opened.service.integrate('learn-1')
    assert.equal(integrated.status, 'integrated')
    assert.equal(await opened.service.readCommitted('global/learned.md'), 'learned-fact\n')
    assert.equal(await opened.service.readCommitted('global/parent.md'), 'parent edit\n')
    await opened.service.enqueue({ id: 'overlap', summary: 'overlap core' })
    await opened.service.start('overlap')
    fx.git(side, ['reset', '--hard', 'main'])
    writeFileSync(join(side, 'Core.md'), 'parent\n')
    fx.git(side, ['add', '--', 'Core.md'])
    fx.git(side, ['commit', '-m', 'parent core'])
    const blocked = await opened.service.integrate('overlap')
    assert.equal(blocked.status, 'repair-needed')
    assert.deepEqual(blocked.conflictPaths, ['Core.md'])
    await opened.service.enqueue({ id: 'same', summary: 'same bytes' })
    assert.equal((await opened.service.start('same')).status, 'noop')
    await opened.service.enqueue({ id: 'aside', summary: 'disjoint note' })
    assert.equal(
      (await opened.service.integrate((await opened.service.start('aside')).id)).status,
      'integrated',
    )
    const learned = await opened.service.readMemory({ path: 'global/learned.md' })
    assert.equal(learned.text, 'learned-fact\n')
    const prompt = await opened.service.compilePrompt()
    assert.equal(prompt.prompt.includes('base') || prompt.prompt.includes('parent'), true)
    assert.equal(prompt.prompt.includes(secretText.trim()), false)
    assert.equal(prompt.prompt.includes(oldText.trim()), false)
    await assert.rejects(
      () => opened.service.readMemory({ path: 'global/secret.md' }),
      /Local memory path refused/,
    )
    await assert.rejects(
      () => opened.service.readMemory({ path: 'global/old.md' }),
      /Local memory path refused/,
    )
    const restarted = await openShadowMigration({
      stateRoot: fx.stateRoot,
      bundle,
      worker: () => {},
    })
    assert.deepEqual(restarted.receipt, opened.receipt)
    assert.equal((await restarted.service.readMemory({ path: 'global/learned.md' })).text, 'learned-fact\n')
    await assert.rejects(
      () => restarted.service.readCommitted('global/secret.md'),
      /Local memory path refused/,
    )
    await assert.rejects(() => rollbackShadowMigration(fx.stateRoot), /Local memory migration refused/)
    for (const id of ['learn-1', 'overlap', 'same', 'aside']) {
      const job = await opened.service.job(id)
      if (!job.worktreePath) continue
      await opened.service.cleanup(job.worktreePath)
    }
    const repair = await loadJob(fx.stateRoot, 'overlap')
    await saveJob(fx.stateRoot, {
      ...repair,
      status: 'failed',
      worktreePath: null,
      conflictPaths: [],
      pendingIntegration: null,
      expectedParent: null,
    })
    const quarantined = await rollbackShadowMigration(fx.stateRoot)
    await assert.rejects(() => restarted.service.head(), /Local memory repository refused/)
    assert.ok(quarantined.quarantined.includes('.quarantine-'))
    await assert.rejects(
      () => openShadowMigration({ stateRoot: fx.stateRoot, bundle, worker: () => {} }),
      /Local memory migration refused/,
    )
  } finally {
    fx.close()
  }
})

test('seeded resume, read envelope, quiescence, and rollback exclusion fail closed', async () => {
  const fx = fixture('mahiro-shadow-gate-')
  const bundle = bundleFor({ files: [file('Core.md', 'base\n'), file('index.md', 'index\n')] })
  const openAt = (
    stateRoot: string,
    next = bundle,
    injection?: { stopAfter: 'seeded' | 'ownership-written' },
  ) =>
    openShadowMigration({
      stateRoot,
      bundle: next,
      worker: (ctx) => {
        if (ctx.jobId === 'note') ctx.write('global/note.md', 'note\n')
        if (ctx.jobId === 'overlap') ctx.write('Core.md', 'overlap\n')
      },
      ...(injection ? { injection } : {}),
    })
  try {
    const draft = bundleFor({ files: [file('Core.md', 'base\n'), file('index.md', 'index\n')] })
    draft.files[0].read = { ...draft.files[0].read, basis: 'private-draft' as 'view-snapshot' }
    await assert.rejects(() => openAt(fx.stateRoot, draft), /Local memory migration refused/)
    const stale = bundleFor({ files: [file('Core.md', 'base\n'), file('index.md', 'index\n')] })
    stale.files[0].read = { ...stale.files[0].read, freshness: 'stale' as 'current' }
    await assert.rejects(() => openAt(fx.stateRoot, stale), /Local memory migration refused/)
    const mixed = bundleFor({ files: [file('Core.md', 'base\n'), file('index.md', 'index\n')] })
    mixed.files[0].read = { ...mixed.files[0].read, currentRevision: 'b'.repeat(40) }
    await assert.rejects(() => openAt(fx.stateRoot, mixed), /Local memory migration refused/)
    const altered = bundleFor({ files: [file('Core.md', 'base\n'), file('index.md', 'index\n')] })
    altered.files[0] = { ...altered.files[0], text: 'XXXX\n' }
    await assert.rejects(() => openAt(fx.stateRoot, altered), /Local memory migration refused/)
    assert.equal(existsSync(fx.bare()), false)

    const mutated = join(fx.dir, 'mutated')
    mkdirSync(mutated, { mode: 0o700 })
    await assert.rejects(
      () => openAt(mutated, bundle, { stopAfter: 'seeded' }),
      /Local memory migration interrupted/,
    )
    const side = join(fx.dir, 'mutated-side')
    const git = (cwd: string | undefined, args: string[]) =>
      execFileSync(
        'git',
        [
          ...(cwd ? ['-C', cwd] : ['--git-dir', join(mutated, canonicalGitDirectoryName)]),
          '-c',
          `core.hooksPath=${join(mutated, 'empty-hooks')}`,
          '-c',
          'commit.gpgsign=false',
          '-c',
          'user.name=Synthetic Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          ...args,
        ],
        { encoding: 'utf8' },
      )
    git(undefined, ['worktree', 'add', side, 'main'])
    writeFileSync(join(side, 'Core.md'), 'XXXX\n')
    git(side, ['add', '--', 'Core.md'])
    git(side, ['commit', '-m', 'same length'])
    await assert.rejects(() => openAt(mutated), /Local memory migration refused/)
    assert.equal(existsSync(join(mutated, canonicalGitDirectoryName)), true)

    const committedRoot = join(fx.dir, 'committed')
    mkdirSync(committedRoot, { mode: 0o700 })
    const committed = await openAt(committedRoot)
    await committed.service.enqueue({ id: 'note', summary: 'remember note' })
    assert.equal((await committed.service.start('note')).status, 'committed')
    await assert.rejects(() => rollbackShadowMigration(committedRoot), /Local memory migration refused/)
    assert.equal(existsSync(committedRoot), true)

    const held = join(fx.dir, 'held')
    mkdirSync(held, { mode: 0o700 })
    const holding = await openAt(held, bundle, { stopAfter: 'ownership-written' })
    await holding.service.enqueue({ id: 'hold', summary: 'hold work' })
    assert.equal((await holding.service.start('hold')).status, 'running')
    await assert.rejects(() => rollbackShadowMigration(held), /Local memory migration refused/)
    assert.equal(existsSync(join(held, 'ownership')), true)
    assert.equal(existsSync(join(held, 'progress')), true)

    const quiet = join(fx.dir, 'quiet')
    mkdirSync(quiet, { mode: 0o700 })
    const quietService = await openAt(quiet)
    let pending: Promise<unknown> | undefined
    const rolled = await rollbackShadowMigration(quiet, {
      afterQuiescence: () => {
        pending = quietService.service.enqueue({ id: 'race', summary: 'during rollback' })
      },
    })
    assert.ok(pending)
    await assert.rejects(pending, /Local memory repository refused/)
    await assert.rejects(() => quietService.service.head(), /Local memory repository refused/)
    assert.equal(existsSync(join(rolled.quarantined, 'jobs', 'race.json')), false)
    assert.equal(existsSync(quiet), false)
  } finally {
    fx.close()
  }
})

test('rollback waits for an open paused before receipt publication', async () => {
  const fx = fixture('mahiro-shadow-order-')
  const bundle = bundleFor({ files: [file('Core.md', 'base\n'), file('index.md', 'index\n')] })
  let releaseOpen!: () => void
  const release = new Promise<void>((resolve) => {
    releaseOpen = resolve
  })
  let markPaused!: () => void
  const paused = new Promise<void>((resolve) => {
    markPaused = resolve
  })
  let entered = false
  try {
    const opening = openShadowMigration({
      stateRoot: fx.stateRoot,
      bundle,
      worker: () => {},
      beforeReceipt: async () => {
        markPaused()
        await release
      },
    })
    await paused
    const rolling = rollbackShadowMigration(fx.stateRoot, {
      beforeQuiescence: () => {
        entered = true
      },
    })
    for (let turn = 0; turn < 40; turn += 1) await yieldTurn()
    assert.equal(entered, false)
    assert.equal(existsSync(fx.stateRoot), true)
    assert.equal(existsSync(join(fx.stateRoot, 'migration.json')), false)
    releaseOpen()
    const opened = await opening
    assert.equal(opened.receipt.fileCount, 2)
    assert.equal(existsSync(join(fx.stateRoot, 'migration.json')), true)
    const quarantined = await rolling
    assert.equal(entered, true)
    assert.equal(existsSync(fx.stateRoot), false)
    assert.equal(existsSync(quarantined.quarantined), true)
    await assert.rejects(() => opened.service.head(), /Local memory repository refused/)
  } finally {
    releaseOpen()
    fx.close()
  }
})
