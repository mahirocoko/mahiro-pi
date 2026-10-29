import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { canonicalGitDirectoryName } from '../lib/agent-memory/local/contracts.ts'
import {
  emptyForgettingMetadata,
  localGitBlobId,
  tombstoneSnapshotDigest,
  type TombstoneSnapshot,
} from '../lib/agent-memory/local/forgetting.ts'
import {
  type PalaceCorpusFact,
  type PalaceJobFact,
  type PalaceSnapshot,
  type PalaceSnapshotFacts,
  buildPalaceSnapshot,
  escapePalaceText,
  palacePreviewLimits,
  palacePreviewStyle,
  parsePalaceSnapshot,
  renderPalacePage,
} from '../lib/agent-memory/local/palace.ts'
import { startPalacePreviewServer } from '../lib/agent-memory/local/palace-server.ts'
import { openSyntheticPalacePreview } from '../lib/agent-memory/local/preview.ts'
import { createSyntheticLocalMemoryService, type LocalWorker } from '../lib/agent-memory/local/service.ts'
import type { MaintenanceWorkerInput, SyntheticPublicEntry } from '../lib/agent-memory/local/trajectory.ts'

const head = 'a'.repeat(40)
const other = 'b'.repeat(40)
const third = 'c'.repeat(64)
const repoRoot = join(import.meta.dirname, '..')

function forgetting(phase: PalaceSnapshotFacts['forgetting']['phase'] = 'empty') {
  return { phase, policyRevision: 0, pathCount: 0, blobCount: 0, sourceCount: 0 }
}

function baseFacts(patch: Partial<PalaceSnapshotFacts> = {}): PalaceSnapshotFacts {
  return {
    head,
    forgotten: 0,
    forgetting: forgetting(),
    corpus: [],
    jobs: [],
    recovery: [],
    ...patch,
  }
}

function file(path: string, bytes = 4): PalaceCorpusFact {
  return { path, mode: '100644', type: 'blob', bytes }
}

function job(
  patch: Partial<PalaceJobFact> & Pick<PalaceJobFact, 'id' | 'status' | 'sequence'>,
): PalaceJobFact {
  return {
    kind: 'ordinary',
    baseHead: head,
    workerCommit: null,
    integratedCommit: null,
    pendingIntegration: null,
    expectedParent: null,
    conflictPaths: [],
    detached: false,
    ...patch,
  }
}

function encoded(value: unknown): string {
  return JSON.stringify(value)
}

function walkKeys(value: unknown, found: string[] = []): string[] {
  if (!value || typeof value !== 'object') return found
  for (const [key, entry] of Object.entries(value)) {
    found.push(key)
    walkKeys(entry, found)
  }
  return found
}

function assertDocument(html: string, options: { tables: boolean }): void {
  assert.equal(html.match(/<main[\s>]/g)?.length, 1)
  assert.equal(html.match(/<h1[\s>]/g)?.length, 1)
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]))
  for (let index = 1; index < levels.length; index += 1) assert.ok(levels[index] <= levels[index - 1] + 1)
  assert.match(html, /lang="en"/)
  assert.match(html, /not live authority/i)
  assert.match(html, /ABI2/)
  assert.match(html, /:focus-visible/)
  assert.match(html, /min-block-size:\s*1\.5rem/)
  assert.match(html, /overflow-wrap:\s*anywhere/)
  assert.match(html, /<a href="[^"]*">Reload<\/a>/)
  assert.doesNotMatch(html, /content-visibility/)
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /aria-live/)
  assert.doesNotMatch(html, /http-equiv="refresh"/i)
  assert.doesNotMatch(html, /https?:\/\//)
  assert.doesNotMatch(html, /url\(/)
  assert.doesNotMatch(html, /@import/)
  assert.doesNotMatch(html, /\ssrc=/)
  assert.doesNotMatch(html, /min-width:\s*[0-9]{3,}px/)
  assert.doesNotMatch(html, /display:\s*none/)
  assert.doesNotMatch(html, /display:\s*block/)
  assert.doesNotMatch(html, /@container/)
  if (!options.tables) return
  assert.match(html, /class="skip-link"/)
  assert.match(html, /<table[\s>]/)
  assert.match(html, /<thead[\s>]/)
  assert.match(html, /<caption[\s>]/)
  assert.match(html, /scope="col"/)
  assert.match(html, /scope="row"/)
  assert.match(html, /tabindex="0"/)
  assert.match(html, /role="region"/)
  assert.match(html, /aria-labelledby="/)
  assert.match(html, /overflow:\s*auto/)
}

function responseOf(
  url: string,
  headers?: http.OutgoingHttpHeaders,
  method = 'GET',
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers, family: 4 }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      )
    })
    request.on('error', reject)
    request.end()
  })
}

function fixture(prefix: string) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), prefix))
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
    git,
    close() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('snapshot pages, orders, and byte-caps metadata without private fields', () => {
  const corpus = Array.from({ length: 40 }, (_, index) =>
    file(`p${String(index).padStart(2, '0')}.md`, index),
  )
  corpus.reverse()
  const jobs = [2, 1].map((sequence) =>
    job({ id: sequence === 1 ? 'alpha' : 'beta', status: 'queued', sequence }),
  )
  const snapshot = buildPalaceSnapshot(baseFacts({ corpus, jobs: jobs.reverse() }))
  assert.deepEqual(
    snapshot.corpus.entries.map((entry) => entry.path),
    Array.from({ length: 32 }, (_, index) => `p${String(index).padStart(2, '0')}.md`),
  )
  assert.equal(snapshot.corpus.total, 40)
  assert.equal(snapshot.corpus.returned, 32)
  assert.equal(snapshot.corpus.truncated, true)
  assert.deepEqual(
    snapshot.jobs.entries.map((entry) => entry.id),
    ['alpha', 'beta'],
  )
  assert.equal(snapshot.jobs.truncated, false)
  assert.equal(snapshot.bytes, Buffer.byteLength(encoded(snapshot)))
  assert.ok(snapshot.bytes <= palacePreviewLimits.maxSnapshotBytes)
  assert.deepEqual(snapshot, buildPalaceSnapshot(baseFacts({ corpus, jobs })))
  const symlink = buildPalaceSnapshot(
    baseFacts({
      corpus: [{ path: 'link.md', mode: '120000', type: 'blob', bytes: 99 }],
    }),
  )
  assert.equal(symlink.corpus.entries[0]?.kind, 'symlink')
  assert.equal(symlink.corpus.entries[0]?.bytes, null)

  const longPath = (index: number) =>
    [0, 1, 2, 3, 4, 5, 6, 7]
      .map((part) => `p${String(index).padStart(2, '0')}${part}${'a'.repeat(59)}`)
      .join('/')
  const heavyJobs = Array.from({ length: 32 }, (_, index) =>
    job({
      id: `j${String(index).padStart(2, '0')}${'x'.repeat(29)}`,
      status: 'repair-needed',
      sequence: index + 1,
      workerCommit: 'd'.repeat(64),
      conflictPaths: [longPath(index)],
      detached: true,
    }),
  )
  const heavy = buildPalaceSnapshot(
    baseFacts({
      corpus: Array.from({ length: 32 }, (_, index) => file(longPath(index), 20)),
      jobs: heavyJobs,
    }),
  )
  assert.ok(heavy.bytes <= palacePreviewLimits.maxSnapshotBytes)
  assert.equal(heavy.bytes, Buffer.byteLength(encoded(heavy)))
  assert.equal(
    heavy.corpus.truncated ||
      heavy.conflicts.truncated ||
      heavy.jobs.truncated ||
      heavy.history.detachedTruncated,
    true,
  )
  assert.ok(heavy.corpus.returned <= 32)
  assert.ok(heavy.conflicts.returned <= 32)
  assert.ok(heavy.jobs.returned <= 32)
})

test('parser rejects lying bounds, private keys, and unsorted rows', () => {
  const snapshot = buildPalaceSnapshot(
    baseFacts({
      corpus: [file('b.md'), file('a.md')],
      jobs: [job({ id: 'queued', status: 'queued', sequence: 1 })],
    }),
  )
  const lying = structuredClone(snapshot)
  lying.bytes = 1
  assert.throws(() => parsePalaceSnapshot(lying), /Local memory palace refused/)
  const extra = { ...snapshot, summary: 'SENTINEL_SUMMARY' }
  assert.throws(() => parsePalaceSnapshot(extra), /Local memory palace refused/)
  const unsorted = structuredClone(snapshot)
  const first = unsorted.corpus.entries[0]
  unsorted.corpus.entries[0] = unsorted.corpus.entries[1]
  unsorted.corpus.entries[1] = first
  assert.throws(() => parsePalaceSnapshot(unsorted), /Local memory palace refused/)
  const paged = buildPalaceSnapshot(
    baseFacts({
      corpus: Array.from({ length: 40 }, (_, index) => file(`q${String(index).padStart(2, '0')}.md`)),
    }),
  )
  assert.equal(paged.corpus.truncated, true)
  const flags = structuredClone(paged)
  flags.corpus.truncated = false
  assert.throws(() => parsePalaceSnapshot(flags), /Local memory palace refused/)
  assert.throws(
    () => buildPalaceSnapshot(baseFacts({ corpus: [file('/etc/passwd')] })),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message.includes('/etc/passwd'), false)
      return true
    },
  )
  const dirty = job({ id: 'queued', status: 'queued', sequence: 1 }) as PalaceJobFact & {
    summary: string
    reflection: { text: string }
    worktreePath: string
    error: string
  }
  dirty.summary = 'SENTINEL_SUMMARY'
  dirty.reflection = { text: 'SENTINEL_REFLECTION' }
  dirty.worktreePath = '/tmp/SENTINEL_WORKTREE'
  dirty.error = 'SENTINEL_RAW_ERROR'
  const clean = buildPalaceSnapshot(baseFacts({ jobs: [dirty] }))
  const body = encoded(clean)
  for (const sentinel of [
    'SENTINEL_SUMMARY',
    'SENTINEL_REFLECTION',
    'SENTINEL_WORKTREE',
    'SENTINEL_RAW_ERROR',
  ])
    assert.equal(body.includes(sentinel), false)
  assert.equal(walkKeys(clean).includes('summary'), false)
  assert.equal(walkKeys(clean).includes('worktreePath'), false)
  assert.equal(walkKeys(clean).includes('reflection'), false)
})

test('lifecycle guidance and publication stay explicit and not live', () => {
  const snapshot = buildPalaceSnapshot(
    baseFacts({
      forgetting: { phase: 'removed', policyRevision: 2, pathCount: 1, blobCount: 1, sourceCount: 0 },
      corpus: [file('Core.md', 5), file('index.md', 6)],
      recovery: [{ jobId: 'runningjob', outcome: 'interrupted' }],
      jobs: [
        job({ id: 'queuedjob', status: 'queued', sequence: 1, detached: true }),
        job({ id: 'runningjob', status: 'running', sequence: 2, detached: true }),
        job({
          id: 'committedjob',
          status: 'committed',
          sequence: 3,
          workerCommit: other,
          pendingIntegration: third,
          expectedParent: head,
          detached: true,
        }),
        job({
          id: 'integratedjob',
          status: 'integrated',
          sequence: 4,
          workerCommit: other,
          integratedCommit: head,
          detached: true,
        }),
        job({ id: 'noopjob', status: 'noop', sequence: 5, workerCommit: other, detached: true }),
        job({ id: 'failedjob', status: 'failed', sequence: 6, kind: 'ordinary' }),
        job({ id: 'reflectjob', status: 'failed', sequence: 7, kind: 'reflection' }),
        job({
          id: 'repairjob',
          status: 'repair-needed',
          sequence: 8,
          workerCommit: other,
          conflictPaths: ['notes.md', 'Core.md'],
          detached: true,
        }),
      ],
    }),
  )
  const byId = new Map(snapshot.jobs.entries.map((entry) => [entry.id, entry]))
  assert.equal(byId.get('queuedjob')?.resume, 'starts')
  assert.equal(byId.get('queuedjob')?.retry, 'refused')
  assert.equal(byId.get('committedjob')?.resume, 'integrates')
  assert.equal(byId.get('reflectjob')?.retry, 'requeues')
  assert.equal(byId.get('failedjob')?.retry, 'refused')
  assert.equal(byId.get('repairjob')?.retry, 'blocked')
  assert.equal(byId.get('repairjob')?.guidance, 'retry-blocked')
  assert.equal(byId.get('runningjob')?.guidance, 'running-recovers-next-turn')
  assert.equal(byId.get('integratedjob')?.resume, 'unchanged')
  assert.equal(byId.get('integratedjob')?.detached, false)
  assert.equal(byId.get('noopjob')?.resume, 'unchanged')
  assert.equal(byId.get('noopjob')?.detached, false)
  assert.equal(byId.get('committedjob')?.detached, true)
  assert.equal(byId.get('queuedjob')?.detached, false)
  assert.deepEqual(
    snapshot.conflicts.entries.map((entry) => entry.path),
    ['Core.md', 'notes.md'],
  )
  assert.equal(snapshot.publication.notLiveAuthority, true)
  assert.equal(snapshot.publication.liveAuthority, 'abi2')
  assert.equal(snapshot.publication.integrated, 1)
  assert.equal(snapshot.publication.pendingReturned, 1)
  assert.equal(snapshot.publication.forgettingPhase, 'removed')
  assert.equal(snapshot.history.canonicalRef, 'refs/heads/main')
  assert.equal(
    snapshot.history.detached.some((entry) => entry.jobId === 'integratedjob' || entry.jobId === 'noopjob'),
    false,
  )
  assert.equal(
    snapshot.history.detached.some((entry) => entry.role === 'detached-worktree'),
    true,
  )
  assert.equal(
    snapshot.history.detached.every((entry) => entry.role !== 'detached-commit' || entry.oid !== null),
    true,
  )
  assert.equal(snapshot.recovery.phase, 'interrupted')
  assert.equal(snapshot.corpus.corePresent, true)
  assert.equal(snapshot.corpus.indexPresent, true)
  const html = renderPalacePage({ state: 'snapshot', snapshot, reloadPath: '/capability-token' })
  assertDocument(html, { tables: true })
  for (const status of ['queued', 'running', 'committed', 'integrated', 'noop', 'failed', 'repair-needed'])
    assert.match(html, new RegExp(`> ${status}<`))
  assert.match(html, /Detached job work is not a Git branch/)
  assert.match(html, /Synthetic publication is not live authority/)
  assert.match(html, /does not show a diff or a file body/)
  assert.match(html, /Retry and resume are read-only/)
  assert.match(html, /Coordinator recovery stopped before detached work was finished/)
  assert.equal(html.includes('branch'), true)
  assert.doesNotMatch(html, /refs\/heads\/(?!main)/)
})

test('renderer covers empty, loading, error, stale, and escaped reload targets', () => {
  const empty = buildPalaceSnapshot(baseFacts())
  const emptyHtml = renderPalacePage({ state: 'snapshot', snapshot: empty, reloadPath: '/cap' })
  assert.equal(emptyHtml.includes('data-preview-state="empty"'), true)
  assert.match(emptyHtml, /No visible corpus entries and no jobs are in this snapshot/)
  assertDocument(emptyHtml, { tables: true })
  const loading = renderPalacePage({ state: 'loading', reloadPath: '/x<script>' })
  assert.equal(loading.includes('data-preview-state="loading"'), true)
  assert.match(loading, /does not refresh automatically/)
  assert.match(loading, /\/x&lt;script&gt;/)
  assert.doesNotMatch(loading, /<script>/)
  assertDocument(loading, { tables: false })
  const error = renderPalacePage({ state: 'error', reloadPath: '/cap' })
  assert.match(error, /Palace preview is unavailable/)
  assert.equal(error.includes('data-preview-state="error"'), true)
  const stale = renderPalacePage({ state: 'stale', reloadPath: '/cap' })
  assert.match(stale, /This snapshot is stale/)
  assert.equal(stale.includes('data-preview-state="stale"'), true)
  assert.equal(escapePalaceText(`"'<>&`), '&quot;&#39;&lt;&gt;&amp;')
})

test('loopback server binds locally, rejects foreign hosts, and closes cleanly', async () => {
  const snapshot = buildPalaceSnapshot(baseFacts({ corpus: [file('Core.md', 3)] }))
  const server = await startPalacePreviewServer({ snapshot: async () => snapshot })
  try {
    assert.equal(server.address, '127.0.0.1')
    assert.equal(server.capability.length, 43)
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}$/)
    const page = await responseOf(server.url)
    assert.equal(page.status, 200)
    assert.match(String(page.headers['content-security-policy']), /default-src 'none'/)
    assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/)
    assert.match(String(page.headers['content-security-policy']), /script-src 'none'/)
    const hash = createHash('sha256').update(palacePreviewStyle()).digest('base64')
    assert.equal(String(page.headers['content-security-policy']).includes(hash), true)
    assert.equal(page.headers['x-content-type-options'], 'nosniff')
    assert.equal(page.headers['cache-control'], 'no-store')
    assert.equal(page.headers['referrer-policy'], 'no-referrer')
    assert.equal(page.headers['access-control-allow-origin'], undefined)
    assert.equal(page.headers['set-cookie'], undefined)
    assertDocument(page.body, { tables: true })
    assert.match(page.body, /Core\.md/)
    const json = await responseOf(server.snapshotUrl)
    assert.equal(json.status, 200)
    assert.match(String(json.headers['content-type']), /^application\/json/)
    assert.equal(json.headers['x-content-type-options'], 'nosniff')
    const parsed = parsePalaceSnapshot(JSON.parse(json.body))
    assert.equal(parsed.head, head)
    const headOnly = await responseOf(server.url, undefined, 'HEAD')
    assert.equal(headOnly.status, 200)
    assert.equal(headOnly.body, '')
    assert.equal(Number(headOnly.headers['content-length']), Buffer.byteLength(page.body))
    const foreign = await responseOf(server.url, { host: `localhost:${server.port}` })
    assert.equal(foreign.status, 400)
    assert.equal(foreign.body.includes(server.capability), false)
    const evil = await responseOf(server.url, { host: 'evil.test' })
    assert.equal(evil.status, 400)
    assert.equal(evil.body.includes(server.capability), false)
    const missing = await responseOf(`http://127.0.0.1:${server.port}/nope`)
    assert.equal(missing.status, 404)
    assert.equal(missing.body.includes(server.capability), false)
    const query = await responseOf(`${server.url}?x=1`)
    assert.equal(query.status, 404)
    const posted = await responseOf(server.url, undefined, 'POST')
    assert.equal(posted.status, 405)
    assert.match(String(posted.headers.allow), /GET, HEAD/)
    const leaked = await startPalacePreviewServer({
      snapshot: async () => {
        throw Error('SENTINEL_RAW_ERROR')
      },
    })
    try {
      const failure = await responseOf(leaked.url)
      assert.equal(failure.status, 500)
      assert.equal(failure.body.includes('SENTINEL_RAW_ERROR'), false)
      assert.match(failure.body, /Palace preview is unavailable/)
      const staleServer = await startPalacePreviewServer({
        snapshot: async () => {
          throw Error('Local memory palace stale')
        },
      })
      try {
        const stale = await responseOf(staleServer.url)
        assert.equal(stale.status, 409)
        assert.match(stale.body, /This snapshot is stale/)
        assert.equal(stale.body.includes('Local memory palace stale'), false)
      } finally {
        await staleServer.close()
      }
    } finally {
      await leaked.close()
    }
  } finally {
    await server.close()
    await server.close()
  }
  await assert.rejects(() => responseOf(server.url), { code: 'ECONNREFUSED' })
  const reopened = await startPalacePreviewServer({ snapshot: async () => snapshot })
  try {
    assert.notEqual(reopened.capability, server.capability)
    const again = await responseOf(reopened.url)
    assert.equal(again.status, 200)
    const oldCapability = await responseOf(`http://127.0.0.1:${reopened.port}/${server.capability}`)
    assert.equal(oldCapability.status, 404)
  } finally {
    await reopened.close()
  }
})

test('coordinator snapshot omits bodies, summaries, paths, and tombstones', async () => {
  const fx = fixture('mahiro-palace-service-')
  try {
    const worker: LocalWorker = (ctx) => {
      if (ctx.jobId === 'failjob') throw Error('SENTINEL_RAW_ERROR')
      if (ctx.jobId === 'keepjob') ctx.write('notes.md', 'SENTINEL_BODY')
    }
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'core-bytes\n', 'index.md': 'index-bytes\n', 'notes.md': 'seed-bytes\n' },
      worker,
    })
    await service.enqueue({ id: 'queuedjob', summary: 'SENTINEL_SUMMARY' })
    await service.enqueue({ id: 'noopjob', summary: 'SENTINEL_NOOP_SUMMARY' })
    await service.enqueue({ id: 'failjob', summary: 'SENTINEL_FAIL_SUMMARY' })
    assert.equal((await service.start('noopjob')).status, 'noop')
    await assert.rejects(() => service.start('failjob'), /SENTINEL_RAW_ERROR/)
    const early = await service.palacePreview()
    const earlyJson = encoded(early)
    for (const sentinel of [
      'SENTINEL_SUMMARY',
      'SENTINEL_NOOP_SUMMARY',
      'SENTINEL_FAIL_SUMMARY',
      'SENTINEL_RAW_ERROR',
      'core-bytes',
      'index-bytes',
      'seed-bytes',
      fx.stateRoot,
    ])
      assert.equal(earlyJson.includes(sentinel), false, sentinel)
    assert.equal(early.jobs.entries.find((entry) => entry.id === 'queuedjob')?.resume, 'starts')
    assert.equal(early.jobs.entries.find((entry) => entry.id === 'noopjob')?.status, 'noop')
    assert.equal(early.jobs.entries.find((entry) => entry.id === 'noopjob')?.detached, false)
    assert.equal(
      early.history.detached.some((entry) => entry.jobId === 'noopjob'),
      false,
    )
    assert.equal(early.jobs.entries.find((entry) => entry.id === 'failjob')?.retry, 'refused')
    assert.equal(early.authority.label, 'not-live-authority')
    assert.equal(
      early.corpus.entries.some((entry) => entry.path === 'Core.md'),
      true,
    )
    assert.equal(walkKeys(early).includes('worktreePath'), false)

    await service.enqueue({ id: 'keepjob', summary: 'SENTINEL_KEEP_SUMMARY' })
    const committed = await service.start('keepjob')
    assert.equal(committed.status, 'committed')
    assert.ok(committed.worktreePath)
    const held = await service.palacePreview()
    const heldJson = encoded(held)
    assert.equal(heldJson.includes('SENTINEL_BODY'), false)
    assert.equal(heldJson.includes(committed.worktreePath), false)
    assert.equal(heldJson.includes(fx.stateRoot), false)
    assert.equal(held.jobs.entries.find((entry) => entry.id === 'keepjob')?.resume, 'integrates')
    assert.equal(
      held.history.detached.some((entry) => entry.jobId === 'keepjob' && entry.role === 'detached-commit'),
      true,
    )
    const integrated = await service.integrate('keepjob')
    assert.equal(integrated.status, 'integrated')
    const published = await service.palacePreview()
    assert.equal(published.publication.notLiveAuthority, true)
    assert.equal(published.publication.liveAuthority, 'abi2')
    assert.equal(published.jobs.entries.find((entry) => entry.id === 'keepjob')?.status, 'integrated')
    assert.equal(published.jobs.entries.find((entry) => entry.id === 'keepjob')?.resume, 'unchanged')
    assert.equal(published.jobs.entries.find((entry) => entry.id === 'keepjob')?.detached, false)
    assert.equal(
      published.history.detached.some((entry) => entry.jobId === 'keepjob'),
      false,
    )
    assert.equal(encoded(published).includes('SENTINEL_BODY'), false)
    assert.ok(committed.worktreePath)
    await service.cleanup(committed.worktreePath)
    const cleaned = await service.palacePreview()
    assert.equal(cleaned.jobs.entries.find((entry) => entry.id === 'keepjob')?.detached, false)
    assert.equal(
      cleaned.history.detached.some((entry) => entry.jobId === 'keepjob'),
      false,
    )
    assert.equal((await service.job('keepjob')).workerCommit, integrated.workerCommit)
    assert.equal(encoded(cleaned).includes(committed.worktreePath), false)
  } finally {
    fx.close()
  }
})

test('tombstone import drops the path and body from the palace snapshot', async () => {
  const fx = fixture('mahiro-palace-forget-')
  try {
    const secret = 'SENTINEL_TOMBSTONE_BODY\n'
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: {
        'Core.md': 'core-bytes\n',
        'index.md': 'index-bytes\n',
        'notes/keep.md': 'keep-bytes\n',
        'notes/secret.md': secret,
      },
      worker: () => {},
    })
    const before = await service.palacePreview()
    const snapshot: TombstoneSnapshot = {
      version: 1,
      revision: 'e'.repeat(40),
      paths: ['notes/secret.md'],
      blobs: [localGitBlobId(secret)],
      sources: [],
      digest: '',
    }
    snapshot.digest = tombstoneSnapshotDigest(snapshot)
    const imported = await service.importTombstones({
      expectedPolicyRevision: before.publication.forgettingRevision,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot,
    })
    assert.equal(imported.pathCount, 1)
    const after = await service.palacePreview()
    const body = encoded(after)
    assert.equal(body.includes('SENTINEL_TOMBSTONE_BODY'), false)
    assert.equal(body.includes('notes/secret.md'), false)
    assert.equal(body.includes('keep-bytes'), false)
    assert.equal(
      after.corpus.entries.some((entry) => entry.path === 'notes/keep.md'),
      true,
    )
    assert.equal(after.publication.forgottenPaths, 1)
    assert.equal(
      after.corpus.entries.some((entry) => entry.path === 'notes/secret.md'),
      false,
    )
  } finally {
    fx.close()
  }
})

test('repair-needed reports relative paths and blocks retry without a diff', async () => {
  const fx = fixture('mahiro-palace-repair-')
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      worker: (ctx) => ctx.write('Core.md', 'SENTINEL_WORKER_BODY\n'),
    })
    await service.enqueue({ id: 'repairjob', summary: 'SENTINEL_REPAIR_SUMMARY' })
    await service.start('repairjob')
    const side = join(fx.dir, 'side')
    fx.git(undefined, ['worktree', 'add', side, 'main'])
    writeFileSync(join(side, 'Core.md'), 'SENTINEL_PARENT_BODY\n')
    fx.git(side, ['add', '--', 'Core.md'])
    fx.git(side, ['commit', '-m', 'parent core'])
    const blocked = await service.integrate('repairjob')
    assert.equal(blocked.status, 'repair-needed')
    const snapshot = await service.palacePreview()
    assert.deepEqual(
      snapshot.conflicts.entries.filter((entry) => entry.jobId === 'repairjob').map((entry) => entry.path),
      ['Core.md'],
    )
    const repair = snapshot.jobs.entries.find((entry) => entry.id === 'repairjob')
    assert.equal(repair?.status, 'repair-needed')
    assert.equal(repair?.retry, 'blocked')
    assert.equal(repair?.resume, 'unchanged')
    const body = encoded(snapshot)
    assert.equal(body.includes('SENTINEL_WORKER_BODY'), false)
    assert.equal(body.includes('SENTINEL_PARENT_BODY'), false)
    assert.equal(body.includes('SENTINEL_REPAIR_SUMMARY'), false)
    assert.equal(body.includes(fx.stateRoot), false)
    const html = renderPalacePage({ state: 'snapshot', snapshot, reloadPath: '/cap' })
    assert.match(html, /Resume and retry cannot advance this state/)
    assert.match(html, /separately supported coordinator repair operation is required/)
    assert.doesNotMatch(html, /Resolve the listed relative paths/)
    assert.doesNotMatch(html, /SENTINEL_WORKER_BODY|SENTINEL_PARENT_BODY|SENTINEL_REPAIR_SUMMARY/)
  } finally {
    fx.close()
  }
})

test('a tombstoned repair conflict path stays out of the snapshot and the job record', async () => {
  const fx = fixture('mahiro-palace-hidden-conflict-')
  const conflictPath = 'notes/sentinel.md'
  const workerBody = 'SENTINEL_CONFLICT_BODY\n'
  const parentBody = 'SENTINEL_OTHER_NOTE\n'
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n', [conflictPath]: 'seed\n' },
      worker: (ctx) => ctx.write(conflictPath, workerBody),
    })
    await service.enqueue({ id: 'repairjob', summary: 'overlap sentinel' })
    await service.start('repairjob')
    const side = join(fx.dir, 'side')
    fx.git(undefined, ['worktree', 'add', side, 'main'])
    writeFileSync(join(side, conflictPath), parentBody)
    fx.git(side, ['add', '--', conflictPath])
    fx.git(side, ['commit', '-m', 'parent sentinel'])
    const blocked = await service.integrate('repairjob')
    assert.deepEqual(blocked.conflictPaths, [conflictPath])
    const before = await service.palacePreview()
    assert.equal(
      before.conflicts.entries.some((entry) => entry.path === conflictPath),
      true,
    )
    const tombstone: TombstoneSnapshot = {
      version: 1,
      revision: 'e'.repeat(40),
      paths: [conflictPath],
      blobs: [localGitBlobId(workerBody)],
      sources: [{ project: null, source: 'sentinel-source' }],
      digest: '',
    }
    tombstone.digest = tombstoneSnapshotDigest(tombstone)
    await service.importTombstones({
      expectedPolicyRevision: before.publication.forgettingRevision,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot: tombstone,
    })
    const after = await service.palacePreview()
    const json = encoded(after)
    const html = renderPalacePage({ state: 'snapshot', snapshot: after, reloadPath: '/cap' })
    for (const sentinel of [conflictPath, workerBody.trim(), parentBody.trim(), 'sentinel-source', 'seed']) {
      assert.equal(json.includes(sentinel), false, sentinel)
      assert.equal(html.includes(sentinel), false, sentinel)
    }
    assert.ok(after.conflicts.hidden >= 1)
    assert.equal(
      after.conflicts.entries.some((entry) => entry.path === conflictPath),
      false,
    )
    assert.deepEqual((await service.job('repairjob')).conflictPaths, [conflictPath])
  } finally {
    fx.close()
  }
})

test('failed reflection can be retried later and its text stays out of the snapshot', async () => {
  const fx = fixture('mahiro-palace-reflect-')
  try {
    const maintenance = (_input: MaintenanceWorkerInput) => {
      throw Error('SENTINEL_RAW_ERROR')
    }
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      worker: () => {},
      trajectory: { policy: 'step-count', stepCount: 1, maintenance },
    })
    const entry: SyntheticPublicEntry = {
      sessionId: 'session-a',
      branchId: 'line-a',
      entryId: 'entry-1',
      role: 'user',
      text: 'SENTINEL_REFLECTION_TEXT',
      order: 1,
      timestamp: '2026-10-29T00:00:01Z',
    }
    const queued = await service.reflect({ sessionId: 'session-a', branchId: 'line-a', entries: [entry] })
    assert.equal(queued.action, 'queued')
    const reflectionJob = queued.job
    assert.ok(reflectionJob)
    await assert.rejects(() => service.start(reflectionJob.id), /SENTINEL_RAW_ERROR/)
    const snapshot = await service.palacePreview()
    const failed = snapshot.jobs.entries.find((item) => item.id === reflectionJob.id)
    assert.equal(failed?.kind, 'reflection')
    assert.equal(failed?.status, 'failed')
    assert.equal(failed?.retry, 'requeues')
    const body = encoded(snapshot)
    assert.equal(body.includes('SENTINEL_REFLECTION_TEXT'), false)
    assert.equal(body.includes('SENTINEL_RAW_ERROR'), false)
    assert.equal(body.includes('Reflect line-a'), false)
    assert.equal(body.includes(fx.stateRoot), false)
  } finally {
    fx.close()
  }
})

test('interrupted running recovery stays coordinator-owned and pathless', async () => {
  const fx = fixture('mahiro-palace-running-')
  try {
    const prepared = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      worker: () => {},
      injection: { stopAfter: 'ownership-written' },
    })
    await prepared.enqueue({ id: 'rec', summary: 'SENTINEL_RUNNING_SUMMARY' })
    assert.equal((await prepared.start('rec')).status, 'running')
    const cutting = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
      worker: () => {},
      injection: { stopAfter: 'recover-removed' },
    })
    const snapshot = await cutting.palacePreview()
    const running = snapshot.jobs.entries.find((entry) => entry.id === 'rec')
    assert.equal(running?.status, 'running')
    assert.equal(running?.guidance, 'running-recovers-next-turn')
    assert.equal(running?.resume, 'unchanged')
    assert.equal(snapshot.recovery.phase, 'interrupted')
    assert.equal(snapshot.recovery.interrupted, 1)
    const body = encoded(snapshot)
    assert.equal(body.includes('SENTINEL_RUNNING_SUMMARY'), false)
    assert.equal(body.includes(fx.stateRoot), false)
    assert.equal(body.includes('worktrees'), false)
    const html = renderPalacePage({ state: 'snapshot', snapshot, reloadPath: '/cap' })
    assert.match(html, /This preview does not resume it/)
  } finally {
    fx.close()
  }
})

test('synthetic preview command serves a fresh loopback page and does not take a state path', async () => {
  const help = spawnSync(process.execPath, ['palace-preview.mjs', '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /not live authority|does not read a private memory root/)
  const refused = spawnSync(process.execPath, ['palace-preview.mjs', '--root', '/tmp/not-a-root'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /does not accept a state path/)
  assert.equal(refused.stderr.includes('/tmp/not-a-root'), false)
  const opened = await openSyntheticPalacePreview()
  try {
    assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}$/)
    const page = await responseOf(opened.url)
    assert.equal(page.status, 200)
    assert.match(page.body, /Not live authority/)
    assert.match(page.body, /queued/)
    assert.match(page.body, /Core\.md/)
    assert.equal(page.body.includes('synthetic preview job'), false)
    assert.equal(page.body.includes('Synthetic core.'), false)
    const json = await responseOf(opened.snapshotUrl)
    const snapshot = parsePalaceSnapshot(JSON.parse(json.body)) as PalaceSnapshot
    assert.equal(snapshot.authority.live, 'abi2')
    assert.equal(encoded(snapshot).includes('synthetic preview job'), false)
  } finally {
    await opened.close()
    await opened.close()
  }
  const child = spawn(process.execPath, ['palace-preview.mjs'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const printed = await new Promise<string>((resolve, reject) => {
      let buffer = ''
      const timer = setTimeout(() => reject(Error('preview did not print a url')), 20_000)
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        if (buffer.includes('http://127.0.0.1:')) {
          clearTimeout(timer)
          resolve(buffer)
        }
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        reject(Error(`preview exited ${code ?? 'signal'} before printing a url`))
      })
    })
    assert.match(
      printed,
      /Synthetic Palace preview \(not live authority\)\nhttp:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}/,
    )
    child.kill('SIGINT')
    const exit = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('preview did not close')), 10_000)
      child.on('exit', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    assert.equal(exit, 0)
  } finally {
    child.kill('SIGKILL')
  }
})

test('close waits for the snapshot callback before temporary root cleanup', async () => {
  const snapshot = buildPalaceSnapshot(baseFacts({ corpus: [file('Core.md', 3)] }))
  let release = () => {}
  let entered = false
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const server = await startPalacePreviewServer({
    snapshot: () => {
      entered = true
      return gate.then(() => snapshot)
    },
  })
  const response = responseOf(server.url).catch(() => undefined)
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-palace-close-'))
  writeFileSync(join(root, 'marker'), 'keep')
  let finished: Promise<void> = Promise.resolve()
  try {
    for (let attempt = 0; attempt < 50 && !entered; attempt += 1) await delay(10)
    assert.equal(entered, true)
    let cleaned = false
    finished = (async () => {
      await server.close()
      rmSync(root, { recursive: true, force: true })
      cleaned = true
    })()
    await delay(40)
    assert.equal(cleaned, false)
    assert.equal(existsSync(join(root, 'marker')), true)
    release()
    await finished
    assert.equal(cleaned, true)
    assert.equal(existsSync(root), false)
    await response
  } finally {
    release()
    await finished.catch(() => undefined)
    await server.close().catch(() => undefined)
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

test('preview server and entrypoint do not import job or extension owners', () => {
  for (const relative of [
    'lib/agent-memory/local/palace.ts',
    'lib/agent-memory/local/palace-server.ts',
    'lib/agent-memory/local/preview.ts',
    'palace-preview.mjs',
  ]) {
    const source = readFileSync(join(repoRoot, relative), 'utf8')
    assert.equal(source.includes('jobs.ts'), false, relative)
    assert.equal(source.includes('extensions/mahiro-agent-memory'), false, relative)
  }
  const server = readFileSync(join(repoRoot, 'lib/agent-memory/local/palace-server.ts'), 'utf8')
  assert.equal(server.includes('service.ts'), false)
  assert.equal(server.includes('git.ts'), false)
  const extension = readFileSync(join(repoRoot, 'extensions/mahiro-agent-memory.ts'), 'utf8')
  assert.equal(extension.includes('palace-server'), false)
  assert.equal(extension.includes('palacePreview'), false)
})
