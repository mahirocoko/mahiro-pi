import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  writeSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  createMemoryStore,
  memoryLimits,
  memoryViewDerivedBytes,
  parseConfig,
  type MemoryConfig,
  type MemoryFile,
  type View,
} from '../lib/agent-memory/store.ts'
import { bytes, digest } from '../lib/continuity/records.ts'

process.env.GIT_AUTHOR_NAME = 'Memory capacity fixture'
process.env.GIT_AUTHOR_EMAIL = 'fixture@example.invalid'
process.env.GIT_COMMITTER_NAME = 'Memory capacity fixture'
process.env.GIT_COMMITTER_EMAIL = 'fixture@example.invalid'
const parent = new URL('../.agent-state/runtime/', import.meta.url).pathname
function fixture() {
  const dir = mkdtempSync(join(parent, 'managed-memory-capacity-'))
  const root = join(dir, 'memory')
  const cwd = join(dir, 'project')
  mkdirSync(cwd)
  const config: MemoryConfig = {
    version: 1,
    projects: [{ cwd, id: 'project' }],
    coreBytes: 32768,
    indexBytes: 8192,
    fileBytes: memoryLimits.fileBytes,
    totalBytes: memoryLimits.totalBytes,
    automatic: false,
  }
  const store = createMemoryStore(root)
  store.initialize(config, '# Core\nSynthetic established identity.\n')
  return {
    dir,
    root,
    config,
    store,
    close: () => rmSync(dir, { recursive: true, force: true }),
  }
}
// Synthetic private-draft seeding avoids O(N^2) fixture construction. Publication,
// restart, bounded reading and subsequent edits still run the actual store owner.
function seedDraft(root: string, v: View) {
  for (const [path, file] of Object.entries(v.files)) {
    const full = join(root, '.views', v.id, path)
    mkdirSync(dirname(full), { recursive: true, mode: 0o700 })
    writeFileSync(full, file.text, { mode: 0o600 })
  }
  writeFileSync(join(root, '.views', `${v.id}.json`), `${JSON.stringify(v)}\n`, { mode: 0o600 })
}
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
function ledgerText(files: Record<string, MemoryFile>, reviewed: string[]) {
  return `${JSON.stringify({ version: 2, sources: Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.sources])), forgottenPaths: [], forgottenSources: [], reviewed })}\n`
}
function exactReviewed(files: Record<string, MemoryFile>, target: number) {
  const reviewed: string[] = []
  while (bytes(ledgerText(files, reviewed)) + 164 <= target)
    reviewed.push(`r${reviewed.length.toString().padStart(4, '0')}${'x'.repeat(155)}`)
  const remaining = target - bytes(ledgerText(files, reviewed))
  if (remaining) {
    assert.ok(remaining >= 4 && remaining <= 163)
    reviewed.push('z'.repeat(remaining - 3))
  }
  assert.equal(bytes(ledgerText(files, reviewed)), target)
  return reviewed
}

test('capacity ceilings are independent, defaults unchanged and serialized-view derivation fits', () => {
  const f = fixture()
  try {
    assert.equal(parseConfig(JSON.stringify(f.config)).totalBytes, 8 * 1024 * 1024)
    for (const [key, max] of [
      ['coreBytes', 32768],
      ['indexBytes', 8192],
      ['fileBytes', memoryLimits.fileBytes],
      ['totalBytes', memoryLimits.totalBytes],
    ] as const)
      assert.throws(() => parseConfig(JSON.stringify({ ...f.config, [key]: max + 1 })), /ceiling/)
    assert.throws(
      () =>
        parseConfig(
          JSON.stringify({
            ...f.config,
            projects: Array.from({ length: 129 }, (_, i) => ({
              cwd: join(f.dir, `p${i}`),
              id: `p${i}`,
            })),
          }),
        ),
      /configuration/,
    )
    assert.equal(memoryLimits.viewBytes, 40 * 1024 * 1024)
    assert.ok(memoryViewDerivedBytes < memoryLimits.viewBytes)
    assert.equal(
      memoryViewDerivedBytes,
      4 * 8 * 1024 * 1024 + 2 * 512 * 1024 + 64 * memoryLimits.files + 1024,
    )
  } finally {
    f.close()
  }
})

test('1024 includes Core/index; 1025 and per-file byte overflow cannot mutate HEAD or private proposal', () => {
  const f = fixture()
  try {
    const v = f.store.createView('project')
    for (let i = 0; i < 1022; i++) v.files[`global/f${i}.md`] = { text: '# Synthetic\n', sources: [] }
    v.files['global/f0.md'].text =
      `# Unicode 😀 ไทย\n${'x'.repeat(memoryLimits.fileBytes - bytes('# Unicode 😀 ไทย\n') - 1)}\n`
    seedDraft(f.root, v)
    const result = f.store.integrate(v)
    assert.ok('revision' in result)
    const reopened = createMemoryStore(f.root)
    assert.equal(Object.keys(reopened.snapshot().files).length, 1024)
    const own = reopened.createView('project')
    const metadata = join(f.root, '.views', `${own.id}.json`)
    const before = readFileSync(metadata, 'utf8')
    assert.throws(() => reopened.edit(own, 'global/extra.md', null, '# Extra\n'), /layout/)
    assert.throws(
      () =>
        reopened.edit(
          own,
          'global/f0.md',
          digest(own.files['global/f0.md'].text),
          `${own.files['global/f0.md'].text}\n`,
        ),
      /file budget/,
    )
    assert.equal(readFileSync(metadata, 'utf8'), before)
    assert.equal(existsSync(join(f.root, '.views', own.id, 'global/extra.md')), false)
    assert.equal(git(f.root, 'rev-parse', 'HEAD').trim(), result.revision)
    assert.equal(git(f.root, 'status', '--porcelain'), '')
  } finally {
    f.close()
  }
})

test('exact configured total accepts, one UTF-8 byte over rejects without writing', () => {
  const f = fixture()
  try {
    f.config.totalBytes = 256
    writeFileSync(join(f.root, 'config.json'), JSON.stringify(f.config))
    const v = f.store.createView('project')
    const overhead = Object.values(v.files).reduce((n, file) => n + bytes(file.text), 0)
    const text = `${'t'.repeat(256 - overhead - 1)}\n`
    f.store.edit(v, 'global/total.md', null, text)
    const raw = readFileSync(join(f.root, '.views', `${v.id}.json`), 'utf8')
    assert.throws(() => f.store.edit(v, 'global/total.md', digest(text), `${text}\n`), /total budget/)
    assert.equal(readFileSync(join(f.root, '.views', `${v.id}.json`), 'utf8'), raw)
    f.store.integrate(v)
    assert.equal(
      Object.values(f.store.snapshot().files).reduce((n, file) => n + bytes(file.text), 0),
      256,
    )
  } finally {
    f.close()
  }
})

test('512-KiB ledger accepts; one-byte-over publication fails before Git/worktree mutation', () => {
  const f = fixture()
  try {
    const v = f.store.createView('project')
    f.store.edit(v, 'Core.md', digest(v.files['Core.md'].text), v.files['Core.md'].text, ['a'])
    const reviewed = exactReviewed(v.files, memoryLimits.ledgerBytes)
    f.store.integrate(v, reviewed)
    assert.equal(bytes(readFileSync(join(f.root, '.memory.json'), 'utf8')), memoryLimits.ledgerBytes)
    const before = f.store.snapshot()
    const next = f.store.createView('project')
    f.store.edit(next, 'Core.md', digest(next.files['Core.md'].text), next.files['Core.md'].text, ['aa'])
    assert.throws(() => f.store.integrate(next), /ledger budget/)
    assert.deepEqual(f.store.snapshot(), before)
    assert.equal(git(f.root, 'status', '--porcelain'), '')
  } finally {
    f.close()
  }
})

test('all view readers accept exact 40-MiB storage and reject one over; both copies are validated', () => {
  const f = fixture()
  try {
    const v = f.store.createView('project')
    const metadata = join(f.root, '.views', `${v.id}.json`)
    const raw = readFileSync(metadata, 'utf8')
    writeFileSync(metadata, raw + ' '.repeat(memoryLimits.viewBytes - bytes(raw)))
    const core = f.store.read(v, 'Core.md')
    assert.ok('text' in core)
    assert.equal(core.text, v.files['Core.md'].text)
    appendFileSync(metadata, ' ')
    assert.throws(() => f.store.read(v, 'Core.md'), /Private file/)
    assert.throws(() => f.store.createView('project'), /Private file/)
    writeFileSync(metadata, raw)
    const invalid = structuredClone(v)
    invalid.base.files['global/bad.md'] = {
      text: `${'x'.repeat(memoryLimits.fileBytes)}\n`,
      sources: [],
    }
    writeFileSync(metadata, JSON.stringify(invalid))
    assert.throws(() => f.store.read(invalid, 'Core.md'), /file budget/)
    assert.equal(git(f.root, 'status', '--porcelain'), '')
  } finally {
    f.close()
  }
})

test('budget shrink and stale publication retain unique conflict until explicit discard', () => {
  const f = fixture()
  try {
    const a = f.store.createView('project'),
      b = f.store.createView('project')
    const original = a.files['Core.md'].text
    f.store.edit(a, 'Core.md', digest(original), `# Core\n${'A'.repeat(512)}\n`)
    f.store.edit(b, 'Core.md', digest(original), `# Core\nUnique B ${'B'.repeat(512)}\n`)
    f.store.integrate(a)
    assert.ok('conflict' in f.store.integrate(b))
    const metadata = join(f.root, '.views', `${b.id}.json`)
    const retained = readFileSync(metadata, 'utf8')
    f.config.totalBytes = 256
    writeFileSync(join(f.root, 'config.json'), JSON.stringify(f.config))
    assert.equal(f.store.conflicts('project').total, 1)
    assert.throws(() => f.store.conflicts('project', b.id, 'Core.md'), /total budget/)
    assert.throws(() => f.store.integrate(b), /inactive/)
    assert.throws(() => f.store.createView('project'), /total budget/)
    assert.equal(readFileSync(metadata, 'utf8'), retained)
    assert.equal(f.store.conflicts('project').total, 1)
    f.store.discardConflict('project', b.id)
    assert.equal(f.store.conflicts('project').total, 0)
  } finally {
    f.close()
  }
})

test('lightweight summary is never authority to delete a unique retained conflict', () => {
  const f = fixture()
  try {
    const v = f.store.createView('project')
    v.state = 'conflict'
    seedDraft(f.root, v)
    // Canonical header ordering, but a malicious duplicate state at the end.
    const valid = `${JSON.stringify({ id: v.id, project: v.project, state: v.state, deadline: v.deadline, configHash: v.configHash, base: v.base, files: v.files })}\n`
    const forged = valid
      .replace('"state":"conflict"', '"state":"cancelled"')
      .replace(/}\n$/, ',"state":"conflict"}\n')
    const metadata = join(f.root, '.views', `${v.id}.json`)
    writeFileSync(metadata, forged)
    for (let i = 0; i < 31; i++) {
      const id = randomUUID()
      writeFileSync(join(f.root, '.views', `${id}.json`), valid.replace(v.id, id), { mode: 0o600 })
    }
    assert.throws(() => f.store.createView('project'), /summary.*retained/)
    assert.equal(readFileSync(metadata, 'utf8'), forged)
    assert.equal(existsSync(join(f.root, '.views', v.id, 'Core.md')), true)
    writeFileSync(metadata, valid)
    assert.equal(f.store.conflicts('project').total, 32)
  } finally {
    f.close()
  }
})

test('snapshot deadline includes Git metadata preflight and fails closed at the unchanged 15 seconds', () => {
  const f = fixture()
  const realNow = Date.now
  try {
    const before = f.store.snapshot().revision
    let now = 0
    let walks = 0
    Date.now = () => now
    const guarded = createMemoryStore(f.root, (path) => {
      if (path === join(f.root, '.git')) {
        now += 5000
        walks++
      }
    })
    assert.throws(() => guarded.snapshot(), /snapshot deadline/)
    assert.equal(now, 15000)
    assert.equal(walks, 3)
    Date.now = realNow
    assert.equal(f.store.snapshot().revision, before)
    assert.equal(git(f.root, 'status', '--porcelain'), '')
  } finally {
    Date.now = realNow
    f.close()
  }
})

// Expensive opt-in stress is deterministic, bounded and serial. Select one shape
// per process so process.resourceUsage().maxRSS has unambiguous attribution.
const scale = process.env.MAHIRO_MEMORY_SCALE
for (const shape of ['realistic', 'max', 'retention'] as const) {
  test(`opt-in synthetic scale: ${shape}`, { skip: scale !== shape }, () => {
    const started = performance.now()
    const f = fixture()
    const measurements: Record<string, number> = {}
    const measure = <T>(name: string, run: () => T): T => {
      const at = performance.now()
      const result = run()
      measurements[`${name}Ms`] = Math.round(performance.now() - at)
      measurements[`${name}PeakRssKiB`] = process.resourceUsage().maxRSS
      return result
    }
    try {
      const count = shape === 'realistic' ? 281 : 512
      const target = shape === 'realistic' ? 3607826 : memoryLimits.totalBytes
      const largest = shape === 'realistic' ? 145763 : memoryLimits.fileBytes
      const v = f.store.createView('project', 600000)
      let remaining = target - Object.values(v.files).reduce((n, file) => n + bytes(file.text), 0)
      for (let i = 0; i < count - 2; i++) {
        const size = i === 0 ? largest : Math.ceil(remaining / (count - 2 - i))
        // Escape-heavy valid Markdown reaches the 2x JSON expansion bound; the
        // largest file also carries astral/Thai text and is byte-exact.
        const prefix = i === 0 ? '# Synthetic 😀 ไทย\n' : '# Synthetic\n'
        const text = `${prefix}${'\\"\t'.repeat(size).slice(0, size - bytes(prefix) - 1)}\n`
        assert.equal(bytes(text), size)
        v.files[`global/f${i.toString().padStart(3, '0')}.md`] = {
          text,
          sources: [],
        }
        remaining -= size
      }
      assert.equal(remaining, 0)
      seedDraft(f.root, v)
      const published = measure('publish', () => f.store.integrate(v))
      assert.ok('revision' in published)
      const reopened = createMemoryStore(f.root)
      const snap = measure('snapshot', () => reopened.snapshot())
      assert.equal(Object.keys(snap.files).length, count)
      assert.equal(
        Object.values(snap.files).reduce((n, file) => n + bytes(file.text), 0),
        target,
      )
      for (const [path, file] of Object.entries(v.files))
        assert.equal(digest(snap.files[path].text), digest(file.text))
      const view = measure('view', () => reopened.createView('project', 600000))
      const viewBytes = bytes(readFileSync(join(f.root, '.views', `${view.id}.json`), 'utf8'))
      assert.ok(viewBytes <= memoryViewDerivedBytes)
      const file = reopened.read(view, 'global/f000.md')
      assert.ok('text' in file)
      assert.equal(file.text, v.files['global/f000.md'].text)
      if (shape !== 'realistic') {
        const unchanged = view.files['global/f001.md'].text
        assert.throws(
          () => reopened.edit(view, 'global/f001.md', digest(unchanged), `${unchanged}\n`),
          /total budget/,
        )
        assert.equal(readFileSync(join(f.root, '.views', view.id, 'global/f001.md'), 'utf8'), unchanged)
        assert.equal(reopened.snapshot().revision, snap.revision)
      }
      const path = 'global/f000.md'
      const old = view.files[path].text
      // Same-byte-size correction remains valid at the exact 8-MiB envelope.
      const corrected = old.replace('Synthetic', 'Corrected')
      measure('correction', () => reopened.edit(view, path, digest(old), corrected))
      const committed = measure('integration', () => reopened.integrate(view))
      assert.ok('revision' in committed && committed.revision)
      assert.equal(createMemoryStore(f.root).snapshot().files[path].text, corrected)
      const rolled = measure('rollback', () =>
        reopened.rollback(committed.revision, snap.revision, 'project'),
      )
      assert.equal(digest(rolled.files[path].text), digest(old))
      if (shape !== 'retention') {
        measure('conflictRecovery', () => {
          const a = reopened.createView('project', 600000)
          const b = reopened.createView('project', 600000)
          const different = old.replace('Synthetic', 'Different')
          reopened.edit(a, path, digest(old), corrected)
          reopened.edit(b, path, digest(old), different)
          reopened.integrate(a)
          assert.ok('conflict' in reopened.integrate(b))
          const proposal = reopened.conflicts('project', b.id, path)
          assert.equal(proposal.proposalHash, digest(different))
          assert.equal(proposal.truncated, true)
          const recovery = reopened.createView('project', 600000)
          reopened.edit(recovery, path, digest(corrected), different)
          reopened.integrate(recovery)
          reopened.discardConflict('project', b.id)
          assert.equal(createMemoryStore(f.root).snapshot().files[path].text, different)
          assert.equal(reopened.conflicts('project').total, 0)
        })
      }
      if (shape === 'retention') {
        // Seed independent full-sized retained conflicts from one validated view,
        // not 64 simultaneously retained JS objects. Conflict files are metadata;
        // inspection/discard reads one selected proposal, never all bodies.
        const source = reopened.createView('project', 600000)
        const raw = readFileSync(join(f.root, '.views', `${source.id}.json`), 'utf8')
        // Reclaim earlier committed views and the one unneeded open proposal.
        for (const id of [v.id, view.id, source.id]) {
          rmSync(join(f.root, '.views', id), { recursive: true, force: true })
          rmSync(join(f.root, '.views', `${id}.json`))
        }
        let first = ''
        const template = join(f.dir, 'retained-template.json')
        writeFileSync(template, raw.replace('"state":"open"', '"state":"conflict"'), { mode: 0o600 })
        measure('seed64', () => {
          for (let i = 0; i < 64; i++) {
            const id = randomUUID()
            if (!first) first = id
            const target = join(f.root, '.views', `${id}.json`)
            copyFileSync(template, target)
            const fd = openSync(target, 'r+')
            try {
              writeSync(fd, Buffer.from(id), 0, 36, 7)
            } finally {
              closeSync(fd)
            }
          }
          // Materialize a selected directory to prove cleanup removes that one
          // while retaining all other unique full-size serialized proposals.
          mkdirSync(join(f.root, '.views', first), { mode: 0o700 })
          writeFileSync(join(f.root, '.views', first, 'Core.md'), source.files['Core.md'].text, {
            mode: 0o600,
          })
        })
        const listing = measure('inspect64', () => reopened.conflicts('project'))
        assert.equal(listing.total, 64)
        assert.equal(listing.conflicts.length, 8)
        measure('refuse65', () => assert.throws(() => reopened.createView('project'), /manual resolution/))
        assert.equal(reopened.conflicts('project').total, 64)
        measure('discard', () => reopened.discardConflict('project', first))
        const fresh = measure('cleanup', () => reopened.createView('project'))
        assert.equal(reopened.conflicts('project').total, 63)
        assert.equal(existsSync(join(f.root, '.views', `${first}.json`)), false)
        assert.equal(fresh.state, 'open')
      }
      const receipt = {
        shape,
        synthetic: true,
        externalInferenceRequests: 0,
        recordedAt: new Date().toISOString(),
        node: process.version,
        execArgv: process.execArgv,
        storeSha256: digest(readFileSync(new URL('../lib/agent-memory/store.ts', import.meta.url), 'utf8')),
        testSha256: digest(readFileSync(new URL('./agent-memory-capacity.test.ts', import.meta.url), 'utf8')),
        filesIncludingCoreAndIndex: count,
        totalUtf8Bytes: target,
        largestUtf8Bytes: largest,
        serializedViewBytes: viewBytes,
        peakScope: 'cumulative process high-water RSS in KiB; phase times exclude fixture teardown',
        retainedViewShape:
          shape === 'retention'
            ? '64 complete serialized base/proposal conflicts; one selected physical directory'
            : undefined,
        ...measurements,
        wallMs: Math.round(performance.now() - started),
        peakRssKiB: process.resourceUsage().maxRSS,
      }
      const receiptPath = join(parent, `managed-memory-scale-${shape}-${process.pid}.json`)
      writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
      })
      console.log(JSON.stringify({ ...receipt, receiptPath }))
    } finally {
      f.close()
    }
  })
}
