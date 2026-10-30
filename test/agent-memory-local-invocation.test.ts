import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { canonicalGitDirectoryName } from '../lib/agent-memory/local/contracts.ts'
import { localGitBlobId, tombstoneSnapshotDigest } from '../lib/agent-memory/local/forgetting.ts'
import { syntheticPalaceContextFixture } from '../lib/agent-memory/local/palace-context.ts'
import { parsePalaceInvocation } from '../lib/agent-memory/local/palace-invocation.ts'
import { createSyntheticLocalMemoryService } from '../lib/agent-memory/local/service.ts'

async function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-invocation-'))
  const stateRoot = join(dir, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const service = await createSyntheticLocalMemoryService({
    stateRoot,
    initialFiles: {
      'Core.md': 'core\n',
      'index.md': 'index\n',
      'notes/secret.md': 'secret\n',
      'notes/alias.md': 'secret\n',
      'notes/keep.md': 'before\n',
      'projects/demo/system/overview.md': 'overview\n',
      'projects/demo/system/conventions.md': 'conventions\n',
    },
    worker: ({ write, jobId }) => write('notes/keep.md', `${jobId}\n`),
  })
  const git = (args: string[], input?: string | Buffer) =>
    execFileSync(
      'git',
      [
        '--git-dir',
        join(stateRoot, canonicalGitDirectoryName),
        '-c',
        'user.name=Synthetic Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        '-c',
        `core.hooksPath=${join(stateRoot, 'empty-hooks')}`,
        ...args,
      ],
      { input, encoding: 'utf8' },
    ).trim()
  return { service, git, close: () => rmSync(dir, { recursive: true, force: true }) }
}

test('invocation receipt binds actual committed projection; corpus is not context; v1 remains strict', async () => {
  const f = await fixture()
  try {
    const context = syntheticPalaceContextFixture()
    const capture = await f.service.palaceCapture({ context, project: 'demo' })
    const projection = await f.service.compilePrompt({ project: 'demo' })
    assert.equal(capture.context.provenance, 'fixture')
    assert.equal(capture.capturedAt, new Date(context.capturedAt).toISOString())
    assert.equal(capture.head, projection.commit)
    assert.deepEqual(
      capture.projection.files,
      projection.files.map(({ text: _text, ...file }) => file),
    )
    assert.deepEqual(
      capture.projection.files.filter((file) => file.role === 'project').map((file) => file.path),
      ['projects/demo/system/overview.md', 'projects/demo/system/conventions.md'],
    )
    assert.equal(capture.projection.provenance, 'synthetic-local-projection')
    assert.equal(capture.workingTree, 'unavailable')
    assert.ok(!JSON.stringify(capture).includes('secret\\n'))
    assert.equal((await f.service.palaceCapture()).context.quality, 'unavailable')
    const caller = await f.service.palaceCapture({
      context: {
        ...context,
        capture: 'command-invocation',
        usage: { ...context.usage, quality: 'estimated' },
      },
    })
    assert.equal(caller.context.provenance, 'caller-supplied')
    assert.equal(caller.context.quality, 'estimated')
    assert.throws(() => parsePalaceInvocation({ ...capture, root: '/private' }))
    assert.throws(() =>
      parsePalaceInvocation({ ...capture, projection: { ...capture.projection, commit: 'f'.repeat(40) } }),
    )
    assert.throws(() =>
      parsePalaceInvocation({ ...capture, context: { ...capture.context, provenance: 'caller-supplied' } }),
    )
    const { percent: _percent, ...usageWithoutPercent } = context.usage
    const normalized = parsePalaceInvocation({
      ...capture,
      context: {
        ...capture.context,
        snapshot: { ...context, usage: usageWithoutPercent },
      },
    })
    assert.equal(normalized.context.snapshot?.usage.percent, context.usage.percent)
    // Mutation of returned data cannot alter the retained service capture.
    capture.head = 'f'.repeat(40)
    assert.equal((await f.service.palaceCapturedSnapshot(capture.captureId)).head, projection.commit)
    const history = await f.service.palaceKnowledgeHistory(capture.captureId)
    assert.equal(history.entries[0].commit, projection.commit)
    assert.ok(history.entries[0].stats.files > 0)
    const snapshot = await f.service.palaceCapturedSnapshot(capture.captureId)
    assert.equal(snapshot.history.canonicalCommit, projection.commit)
    assert.ok(!('entries' in snapshot.history))
  } finally {
    f.close()
  }
})

test('capture A never reads B; first-parent pages and safe replacement diff are bounded', async () => {
  const f = await fixture()
  try {
    const a = await f.service.palaceCapture()
    for (let index = 0; index < 9; index += 1) {
      const id = `job-${index}`
      await f.service.enqueue({ id, summary: id })
      await f.service.start(id)
      await f.service.integrate(id)
    }
    await assert.rejects(f.service.palaceCapturedSnapshot(a.captureId), /stale/)
    await assert.rejects(f.service.palaceKnowledgeHistory(a.captureId), /stale/)
    await assert.rejects(f.service.palaceKnowledgeDiff(a.captureId, a.head), /stale/)
    const b = await f.service.palaceCapture()
    const page = await f.service.palaceKnowledgeHistory(b.captureId)
    assert.equal(page.entries.length, 8)
    assert.equal(page.nextOffset, 8)
    assert.equal(page.truncated, true)
    const tail = await f.service.palaceKnowledgeHistory(b.captureId, 8)
    assert.ok(tail.entries.length > 0)
    assert.equal(tail.entries[0].commit, page.entries.at(-1)?.parent)
    assert.equal(tail.nextOffset, null)
    const diff = await f.service.palaceKnowledgeDiff(b.captureId, b.head)
    assert.equal(diff.files[0].path, 'notes/keep.md')
    assert.equal(diff.files[0].before, 'job-7\n')
    assert.equal(diff.files[0].after, 'job-8\n')
    for (const invalid of ['HEAD', 'refs/heads/main', '../Core.md', 'f'.repeat(40)])
      await assert.rejects(f.service.palaceKnowledgeDiff(b.captureId, invalid))
    await assert.rejects(f.service.palaceKnowledgeHistory(b.captureId, 128))
    // A real detached commit is not first-parent knowledge history.
    const detached = f.git(['commit-tree', `${b.head}^{tree}`, '-p', a.head], 'detached\n')
    await assert.rejects(f.service.palaceKnowledgeDiff(b.captureId, detached))
  } finally {
    f.close()
  }
})

test('path-only and blob-only forgetting hide aliases, deleted sides, and commit metadata', async () => {
  for (const mode of ['path', 'blob'] as const) {
    const f = await fixture()
    try {
      const jobId = mode === 'path' ? 'forgetpathjob' : 'forgetblobjob'
      await f.service.enqueue({ id: jobId, summary: 'forget notes/secret.md secret' })
      await f.service.start(jobId)
      await f.service.integrate(jobId)
      const old = await f.service.palaceCapture()
      const policy = (await f.service.compilePrompt()).forgetting
      const body = {
        version: 1 as const,
        revision: 'a'.repeat(40),
        paths: mode === 'path' ? ['notes/secret.md'] : [],
        blobs: mode === 'blob' ? [localGitBlobId('secret\n')] : [],
        sources: [],
      }
      await f.service.importTombstones({
        expectedPolicyRevision: policy.policyRevision,
        expectedDigest: policy.digest,
        snapshot: { ...body, digest: tombstoneSnapshotDigest(body) },
      })
      await assert.rejects(f.service.palaceKnowledgeDiff(old.captureId, old.head), /stale/)
      const view = await f.service.palaceCapture()
      const removed = await f.service.palaceKnowledgeDiff(view.captureId, view.head)
      assert.ok(!JSON.stringify(removed).includes('secret'))
      assert.ok(removed.omitted >= 1)
      const history = await f.service.palaceKnowledgeHistory(view.captureId)
      const initial = history.entries.at(-1)?.commit
      assert.ok(initial)
      const earlier = await f.service.palaceKnowledgeDiff(view.captureId, initial)
      assert.ok(!JSON.stringify(earlier).includes('secret'))
      assert.ok(earlier.omitted >= 2)
      assert.ok(!JSON.stringify(history).includes('notes/secret.md'))
      assert.ok(!JSON.stringify(history).includes('forget notes'))
      assert.ok(history.entries.every((entry) => entry.metadataUnavailable))
      assert.ok(history.entries.every((entry) => entry.author === null && entry.message === null))
    } finally {
      f.close()
    }
  }
})

test('source exclusion uncertainty is explicitly unavailable, not guessed from paths', async () => {
  const f = await fixture()
  try {
    const policy = (await f.service.compilePrompt()).forgetting
    const body = {
      version: 1 as const,
      revision: 'a'.repeat(40),
      paths: [],
      blobs: [],
      sources: [{ project: null, source: 'unknown-source' }],
    }
    await f.service.importTombstones({
      expectedPolicyRevision: policy.policyRevision,
      expectedDigest: policy.digest,
      snapshot: { ...body, digest: tombstoneSnapshotDigest(body) },
    })
    await assert.rejects(f.service.palaceCapture(), /unavailable: source exclusions/)
  } finally {
    f.close()
  }
})

test('invalid UTF-8, special modes, oversize and file count are omitted with truncation', async () => {
  const f = await fixture()
  try {
    const parent = await f.service.head()
    const rows: string[] = []
    for (const name of ['Core.md', 'index.md']) {
      const blob = f.git(['hash-object', '-w', '--stdin'], `${name}\n`)
      rows.push(`100644 blob ${blob}\t${name}`)
    }
    for (let index = 0; index < 20; index += 1) {
      const blob = f.git(['hash-object', '-w', '--stdin'], `text-${index}\n`)
      rows.push(`100644 blob ${blob}\tf${index}.md`)
    }
    for (const [name, bytes, mode] of [
      ['00-bad.md', Buffer.from([0xff]), '100644'],
      ['01-large.md', Buffer.alloc(5000, 65), '100644'],
      ['02-link.md', Buffer.from('Core.md'), '120000'],
    ] as const) {
      const blob = f.git(['hash-object', '-w', '--stdin'], bytes)
      rows.push(`${mode} blob ${blob}\t${name}`)
    }
    const tree = f.git(['mktree'], `${rows.join('\n')}\n`)
    const commit = f.git(['commit-tree', tree, '-p', parent], '<script>safe metadata</script>\n')
    f.git(['update-ref', 'refs/heads/main', commit, parent])
    const capture = await f.service.palaceCapture()
    const diff = await f.service.palaceKnowledgeDiff(capture.captureId, commit)
    assert.equal(diff.truncated, true)
    assert.ok(diff.files.length <= 16)
    assert.ok(diff.bytes <= 32 * 1024)
    assert.ok(diff.omitted >= 3)
    assert.ok(!diff.files.some((file) => ['00-bad.md', '01-large.md', '02-link.md'].includes(file.path)))
  } finally {
    f.close()
  }
})

test('replacement diffs preserve UTF-8 BOMs and enforce the aggregate byte budget', async () => {
  const f = await fixture()
  try {
    const parent = await f.service.head()
    const tree = (texts: string[]) => {
      const rows: string[] = []
      for (const [name, text] of [
        ['Core.md', 'core\n'],
        ['index.md', 'index\n'],
        ['00-bom.md', texts[0]],
        ...texts.slice(1).map((text, index) => [`budget-${index}.md`, text]),
      ] as [string, string][]) {
        const blob = f.git(['hash-object', '-w', '--stdin'], text)
        rows.push(`100644 blob ${blob}\t${name}`)
      }
      return f.git(['mktree'], `${rows.join('\n')}\n`)
    }
    const before = ['\ufeffbefore\n', ...Array.from({ length: 5 }, () => `${'a'.repeat(3500)}\n`)]
    const after = ['\ufeffafter\n', ...Array.from({ length: 5 }, () => `${'b'.repeat(3500)}\n`)]
    const base = f.git(['commit-tree', tree(before), '-p', parent], 'bom base\n')
    const commit = f.git(['commit-tree', tree(after), '-p', base], 'bom and budget\n')
    f.git(['update-ref', 'refs/heads/main', commit, parent])
    const capture = await f.service.palaceCapture()
    const diff = await f.service.palaceKnowledgeDiff(capture.captureId, commit)
    const bom = diff.files.find((file) => file.path === '00-bom.md')
    assert.equal(bom?.before, '\ufeffbefore\n')
    assert.equal(bom?.after, '\ufeffafter\n')
    assert.equal(diff.truncated, true)
    assert.ok(diff.omitted >= 1)
    assert.ok(diff.bytes <= 32 * 1024)
  } finally {
    f.close()
  }
})

test('history depth is bounded and a reachable merge second parent is not first-parent history', async () => {
  const f = await fixture()
  try {
    let parent = await f.service.head()
    const tree = f.git(['rev-parse', `${parent}^{tree}`])
    const commits: string[] = []
    for (let index = 0; index < 130; index += 1) {
      parent = f.git(['commit-tree', tree, '-p', parent], `depth ${index}\n`)
      commits.push(parent)
    }
    f.git(['update-ref', 'refs/heads/main', parent])
    const depthCapture = await f.service.palaceCapture()
    const tail = await f.service.palaceKnowledgeHistory(depthCapture.captureId, 120)
    assert.equal(tail.entries.length, 8)
    assert.equal(tail.nextOffset, null)
    assert.equal(tail.truncated, true)
    await assert.rejects(f.service.palaceKnowledgeDiff(depthCapture.captureId, commits[0]))

    const side = f.git(['commit-tree', tree, '-p', parent], 'side\n')
    const merge = f.git(['commit-tree', tree, '-p', parent, '-p', side], 'merge\n')
    f.git(['update-ref', 'refs/heads/main', merge, parent])
    const mergeCapture = await f.service.palaceCapture()
    await assert.rejects(f.service.palaceKnowledgeDiff(mergeCapture.captureId, side))
    assert.equal((await f.service.palaceKnowledgeDiff(mergeCapture.captureId, merge)).parent, parent)
  } finally {
    f.close()
  }
})
