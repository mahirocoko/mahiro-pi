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
import vm from 'node:vm'
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
  parsePalaceSnapshot,
} from '../lib/agent-memory/local/palace.ts'
import {
  buildPalaceDocument,
  clipPalaceUtf8,
  palaceDocumentLimits,
  parsePalaceDocument,
  renderPalaceMarkdown,
} from '../lib/agent-memory/local/palace-document.ts'
import {
  buildPalaceCorpusPage,
  palaceCorpusLimits,
  parsePalaceCorpusPage,
} from '../lib/agent-memory/local/palace-corpus.ts'
import { decodePalacePath, encodePalacePath } from '../lib/agent-memory/local/palace-path.ts'
import { syntheticPalaceContextFixture } from '../lib/agent-memory/local/palace-context.ts'
import {
  palaceFontHrefs,
  palacePreviewScript,
  palacePreviewStyle,
  renderPalacePage,
} from '../lib/agent-memory/local/palace-page.ts'
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

function assertDocument(html: string, options: { tables: boolean; script?: boolean }): void {
  assert.equal(html.match(/<main[\s>]/g)?.length, 1)
  assert.equal(html.match(/<h1[\s>]/g)?.length, 1)
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]))
  for (let index = 1; index < levels.length; index += 1)
    assert.ok(levels[index] <= levels[index - 1] + 1, `heading ${levels[index - 1]} to ${levels[index]}`)
  assert.match(html, /lang="en"/)
  assert.match(html, /not live authority/i)
  assert.match(html, /ABI2/)
  assert.match(html, /:focus-visible/)
  assert.match(html, /min-block-size:\s*2\.75rem/)
  assert.match(html, /overflow-wrap:\s*anywhere/)
  assert.match(html, /<a href="[^"]*">Reload<\/a>/)
  assert.match(html, /prefers-reduced-motion:\s*reduce/)
  assert.doesNotMatch(html, /content-visibility/)
  assert.doesNotMatch(html, /http-equiv="refresh"/i)
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
  const fontUrls = [...style.matchAll(/url\(([^)]*)\)/g)].map((match) => match[1])
  assert.deepEqual(
    fontUrls,
    [...fontUrls].filter((url) =>
      /^"(?:[A-Za-z0-9_-]+\/font\/|(?:\.\.\/){1,8}font\/|font\/)(?:manrope|firacode)-latin\.woff2"$/.test(
        url,
      ),
    ),
  )
  assert.equal(fontUrls.length, 2)
  assert.match(style, /font-display:\s*swap/)
  assert.match(style, /font-weight:\s*300 700/)
  assert.match(style, /font-weight:\s*400 500/)
  assert.match(style, /font-family:\s*Manrope/)
  assert.match(style, /font-family:\s*"Fira Code"/)
  assert.match(style, /--sans:\s*Manrope,/)
  assert.match(style, /--mono:\s*"Fira Code"/)
  assert.equal(html.match(/rel="preload"/g)?.length, 2)
  assert.match(html, /as="font"/)
  assert.match(html, /type="font\/woff2"/)
  assert.match(html, /crossorigin/)
  assert.doesNotMatch(html, /@import/)
  assert.doesNotMatch(style, /fonts\.gstatic|fonts\.googleapis|https?:\/\//)
  assert.doesNotMatch(html, /\ssrc=/)
  assert.doesNotMatch(html, /min-width:\s*[0-9]{3,}px/)
  assert.match(html, /\[hidden\].*display: none/)
  assert.doesNotMatch(html, /onclick=/i)
  assert.doesNotMatch(html, /innerHTML/)
  assert.doesNotMatch(palacePreviewStyle(), /https?:\/\//)
  assert.doesNotMatch(palacePreviewScript(), /https?:\/\//)
  assert.doesNotMatch(palacePreviewScript(), /eval\(|document\.write|innerHTML/)
  if (options.script) {
    assert.equal(html.match(/<script>/g)?.length, 1)
    assert.equal(html.match(/aria-live=/g)?.length, 2)
    assert.match(html, /aria-live="polite"/)
    assert.match(html, /<search>/)
    assert.match(html, /<label for="memory-filter">Filter loaded files by path<\/label>/)
    assert.match(html, /type="search"/)
    assert.match(html, /<aside[\s>]/)
    assert.match(html, /<article[\s>]/)
    assert.match(html, /href="#context"/)
    assert.match(html, /href="#core"/)
    assert.match(html, /href="#external"/)
    assert.match(html, /href="#history"/)
    assert.doesNotMatch(html, /data-view="memory"|data-view="maintenance"/)
    assert.match(html, /ArrowDown/)
    assert.match(html, /<header[\s>]/)
    assert.match(html, /<nav[\s>]/)
    assert.match(html, /<footer[\s>]/)
  } else {
    assert.doesNotMatch(html, /<script/i)
    assert.doesNotMatch(html, /aria-live/)
  }
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
  assert.match(html, /<summary>Diagnostics<\/summary>/)
}

function coreDocument(text = 'Synthetic core memory.\n') {
  return buildPalaceDocument({ commit: head, path: 'Core.md', totalBytes: Buffer.byteLength(text), text })
}

function responseBytes(
  url: string,
  headers?: http.OutgoingHttpHeaders,
  method = 'GET',
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers, family: 4 }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      )
    })
    request.on('error', reject)
    request.end()
  })
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
  assert.ok(heavy.corpus.returned > 0 && heavy.corpus.returned < palacePreviewLimits.pageSize)
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
  assertDocument(html, { tables: true, script: true })
  for (const [status, label] of [
    ['queued', 'Waiting'],
    ['running', 'Maintaining'],
    ['committed', 'Ready to publish'],
    ['integrated', 'Published'],
    ['noop', 'No change'],
    ['failed', 'Failed'],
    ['repair-needed', 'Needs repair'],
  ] as const) {
    assert.match(html, new RegExp(`data-status="${status}"`))
    assert.match(html, new RegExp(label))
  }
  assert.match(html, /Detached job work is not a Git branch/)
  assert.match(html, /not Git commit history/)
  assert.match(html, /<h2[^>]*>\s*Knowledge history/)
  assert.match(html, /<h2[^>]*>\s*Lifecycle history/)
  assert.match(html, /Synthetic preview · Not live authority/)
  assert.match(html, /does not show a conflict diff or a job body/)
  assert.match(html, /Retry and resume are read-only/)
  assert.match(html, /Coordinator recovery stopped before detached work was finished/)
  assert.equal(html.includes('branch'), true)
  assert.doesNotMatch(html, /refs\/heads\/(?!main)/)
})

test('renderer covers empty, loading, error, stale, and escaped reload targets', () => {
  const empty = buildPalaceSnapshot(baseFacts())
  const emptyHtml = renderPalacePage({ state: 'snapshot', snapshot: empty, reloadPath: '/cap' })
  assert.equal(emptyHtml.includes('data-preview-state="empty"'), true)
  assert.match(emptyHtml, /No committed memory files and no maintenance jobs are in this snapshot/)
  assertDocument(emptyHtml, { tables: true, script: true })
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

test('Context is a fixed session snapshot separate from corpus coverage', () => {
  const later = Array.from({ length: 40 }, (_, index) => file(`n/f${String(index).padStart(2, '0')}.md`, 8))
  const snapshot = buildPalaceSnapshot(baseFacts({ corpus: [file('Core.md', 4), ...later] }))
  const context = syntheticPalaceContextFixture()
  const contextSection = (html: string) => {
    const section = html.match(/<section id="context">[\s\S]*?<\/section>/)?.[0]
    assert.ok(section)
    return section
  }
  const html = renderPalacePage({ state: 'snapshot', snapshot, reloadPath: '/cap', context })
  assert.equal(snapshot.corpus.total, 41)
  assert.equal(snapshot.corpus.returned, 32)
  const empty = renderPalacePage({
    state: 'snapshot',
    snapshot: buildPalaceSnapshot(baseFacts()),
    reloadPath: '/cap',
    context,
  })
  assert.equal(contextSection(html), contextSection(empty))
  for (const page of [html, empty]) {
    const section = contextSection(page)
    assert.equal(section.match(/<span class="block /g)?.length, 480)
    assert.match(section, /240\/480 owner-supplied tokens \(50%\)/)
    assert.doesNotMatch(
      section,
      /entries loaded|loaded-page coverage|Baseline|Human|Project|Reference|Other library|Not loaded yet/i,
    )
  }
  const unavailable = contextSection(renderPalacePage({ state: 'snapshot', snapshot, reloadPath: '/cap' }))
  assert.match(
    unavailable,
    /Session context snapshot unavailable\. This preview was not opened from an active Pi command\./,
  )
  assert.doesNotMatch(unavailable, /class="context-grid"|class="context-layout"|<span class="block /)
})

test('preview provenance stays synthetic unless a caller asks for a private shadow', async () => {
  const snapshot = buildPalaceSnapshot(baseFacts({ corpus: [file('Core.md', 3)] }))
  const synthetic = renderPalacePage({
    state: 'snapshot',
    snapshot,
    reloadPath: '/cap',
    document: coreDocument('Fixture core line.\n'),
  })
  assert.match(synthetic, /aaaaaaa · Synthetic preview · Not live authority/)
  assert.match(synthetic, /Read-only synthetic workspace · ABI2 remains live authority/)
  assert.match(synthetic, /No mutation controls; reads may reconcile or recover under the service owner/)
  assert.match(synthetic, /Committed in this synthetic snapshot/)
  assert.equal(synthetic.includes('Migrated real memory'), false)
  assert.equal(synthetic.includes('private-shadow workspace'), false)
  const syntheticLoading = renderPalacePage({ state: 'loading', reloadPath: '/cap' })
  assert.match(syntheticLoading, /Loading synthetic Palace preview/)
  assert.match(syntheticLoading, /Synthetic preview · Not live authority/)
  const syntheticError = renderPalacePage({ state: 'error', reloadPath: '/cap' })
  assert.match(syntheticError, /Palace preview is unavailable/)
  assert.match(syntheticError, /Synthetic preview · Not live authority/)
  const syntheticStale = renderPalacePage({ state: 'stale', reloadPath: '/cap' })
  assert.match(syntheticStale, /This snapshot is stale/)
  assert.match(syntheticStale, /Synthetic preview · Not live authority/)
  const shadow = renderPalacePage({
    state: 'snapshot',
    snapshot,
    reloadPath: '/cap',
    document: coreDocument('Fixture core line.\n'),
    provenance: 'private-shadow',
  })
  assert.match(shadow, /aaaaaaa · Migrated real memory · Private shadow · Not live authority/)
  assert.match(shadow, /Read-only private-shadow workspace · ABI2 remains live authority/)
  assert.match(shadow, /This page does not mutate live memory/)
  assert.match(shadow, /Committed in this private shadow/)
  assert.equal(shadow.includes('does not mutate the shadow'), false)
  assert.equal(shadow.includes('cannot be mutated'), false)
  assert.match(
    renderPalacePage({ state: 'loading', reloadPath: '/cap', provenance: 'private-shadow' }),
    /Loading private-shadow Palace preview/,
  )
  assert.match(
    renderPalacePage({ state: 'loading', reloadPath: '/cap', provenance: 'private-shadow' }),
    /Private-shadow preview · Not live authority/,
  )
  assert.match(
    renderPalacePage({ state: 'error', reloadPath: '/cap', provenance: 'private-shadow' }),
    /Private-shadow preview is unavailable/,
  )
  assert.match(
    renderPalacePage({ state: 'stale', reloadPath: '/cap', provenance: 'private-shadow' }),
    /This private-shadow preview snapshot is stale/,
  )
  const server = await startPalacePreviewServer({
    snapshot: async () => snapshot,
    document: async () => coreDocument('Fixture core line.\n'),
    corpus: async () => {
      throw Error('Local memory palace refused')
    },
    provenance: 'private-shadow',
  })
  const staleServer = await startPalacePreviewServer({
    snapshot: async () => {
      throw Error('Local memory palace stale')
    },
    document: async () => coreDocument('Fixture core line.\n'),
    corpus: async () => {
      throw Error('Local memory palace refused')
    },
    provenance: 'private-shadow',
  })
  try {
    const page = await responseOf(server.url)
    assert.equal(page.status, 200)
    assert.match(page.body, /Migrated real memory · Private shadow · Not live authority/)
    assert.match(page.body, /does not mutate live memory/)
    assert.match(page.body, /Fixture core line/)
    assert.equal(page.body.includes('Synthetic preview'), false)
    const error = await responseOf(server.url, { host: 'evil.test' })
    assert.equal(error.status, 400)
    assert.match(error.body, /Private-shadow preview · Not live authority/)
    assert.match(error.body, /Private-shadow preview is unavailable/)
    assert.equal(error.body.includes(server.capability), false)
    assert.equal(error.body.includes('Synthetic preview'), false)
    const stale = await responseOf(staleServer.url)
    assert.equal(stale.status, 409)
    assert.match(stale.body, /This private-shadow preview snapshot is stale/)
    assert.match(stale.body, /Private-shadow preview · Not live authority/)
    assert.equal(stale.body.includes('Synthetic preview'), false)
  } finally {
    await server.close()
    await staleServer.close()
  }
})

test('loopback server binds locally, rejects foreign hosts, and closes cleanly', async () => {
  const snapshot = buildPalaceSnapshot(baseFacts({ corpus: [file('Core.md', 3)] }))
  const server = await startPalacePreviewServer({
    snapshot: async () => snapshot,
    document: async () => coreDocument(),
    corpus: async () => {
      throw Error('Local memory palace refused')
    },
  })
  try {
    assert.equal(server.address, '127.0.0.1')
    assert.equal(server.capability.length, 43)
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}$/)
    const page = await responseOf(server.url)
    assert.equal(page.status, 200)
    assert.match(String(page.headers['content-security-policy']), /default-src 'none'/)
    assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/)
    assert.match(String(page.headers['content-security-policy']), /script-src 'sha256-/)
    assert.match(String(page.headers['content-security-policy']), /connect-src 'self'/)
    assert.match(String(page.headers['content-security-policy']), /img-src 'none'/)
    assert.doesNotMatch(
      String(page.headers['content-security-policy']),
      /unsafe-inline|unsafe-eval|wasm-unsafe-eval/,
    )
    const hash = createHash('sha256')
      .update(palacePreviewStyle(palaceFontHrefs(`/${server.capability}`, `/${server.capability}`)))
      .digest('base64')
    const scriptHash = createHash('sha256').update(palacePreviewScript()).digest('base64')
    assert.equal(String(page.headers['content-security-policy']).includes(hash), true)
    assert.equal(String(page.headers['content-security-policy']).includes(scriptHash), true)
    assert.equal(page.headers['x-content-type-options'], 'nosniff')
    assert.equal(page.headers['cache-control'], 'no-store')
    assert.equal(page.headers['referrer-policy'], 'no-referrer')
    assert.equal(page.headers['access-control-allow-origin'], undefined)
    assert.equal(page.headers['set-cookie'], undefined)
    assertDocument(page.body, { tables: true, script: true })
    assert.match(page.body, /Core\.md/)
    assert.match(page.body, /Synthetic core memory/)
    assert.match(page.body, /data-view="context" aria-current="page"/)
    assert.match(page.body, /data-palace-open="context"/)
    assert.doesNotMatch(page.body, /data-view="core" aria-current="page"/)
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
      document: async () => coreDocument(),
      corpus: async () => {
        throw Error('Local memory palace refused')
      },
    })
    try {
      const failure = await responseOf(leaked.url)
      assert.equal(failure.status, 500)
      assert.equal(failure.body.includes('SENTINEL_RAW_ERROR'), false)
      assert.equal(failure.body.includes(server.capability), false)
      assert.match(failure.body, /Palace preview is unavailable/)
      const staleServer = await startPalacePreviewServer({
        snapshot: async () => {
          throw Error('Local memory palace stale')
        },
        document: async () => coreDocument(),
        corpus: async () => {
          throw Error('Local memory palace refused')
        },
      })
      try {
        const stale = await responseOf(staleServer.url)
        assert.equal(stale.status, 409)
        assert.match(stale.body, /This snapshot is stale/)
        assert.equal(stale.body.includes('Local memory palace stale'), false)
        assert.equal(stale.body.includes(server.capability), false)
        assert.match(stale.body, new RegExp(`href="/${staleServer.capability}"`))
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
  const reopened = await startPalacePreviewServer({
    snapshot: async () => snapshot,
    document: async () => coreDocument(),
    corpus: async () => {
      throw Error('Local memory palace refused')
    },
  })
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

test('local palace fonts stay capability-scoped and same-origin', async () => {
  const snapshot = buildPalaceSnapshot(baseFacts({ corpus: [file('Core.md', 4)] }))
  const server = await startPalacePreviewServer({
    snapshot: async () => snapshot,
    document: async () => coreDocument('Core'),
    corpus: async () => {
      throw Error('Local memory palace refused')
    },
  })
  const expected = {
    'manrope-latin.woff2': '8bd97e6bbbc1f602a8f791530eed1064c9a357d5731bbc76e3fc587fb068728f',
    'firacode-latin.woff2': 'd32d5b5a7c9720cf3812f7d1e3ebdb54116f8f656e7471a03a5a93bdd93c98b3',
  } as const
  try {
    const page = await responseOf(server.url)
    const csp = String(page.headers['content-security-policy'])
    const embedded = page.body.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
    const faces = palaceFontHrefs(`/${server.capability}`, `/${server.capability}`)
    assert.equal(embedded, palacePreviewStyle(faces))
    const styleHash = createHash('sha256').update(embedded).digest('base64')
    const scriptHash = createHash('sha256').update(palacePreviewScript()).digest('base64')
    assert.equal(csp.includes(`style-src 'sha256-${styleHash}'`), true)
    assert.equal(csp.includes(`script-src 'sha256-${scriptHash}'`), true)
    assert.match(csp, /font-src 'self'/)
    assert.doesNotMatch(csp, /font-src 'none'|fonts\.gstatic|fonts\.googleapis|unsafe-inline/)
    assert.match(page.body, new RegExp(`href="${server.capability}/font/manrope-latin\\.woff2"`))
    assert.match(page.body, new RegExp(`href="${server.capability}/font/firacode-latin\\.woff2"`))
    assert.doesNotMatch(page.body, new RegExp(`href="/${server.capability}/font/`))
    assert.doesNotMatch(page.body, /@import|fonts\.gstatic|fonts\.googleapis/)
    const token = encodePalacePath('Core.md')
    const read = await responseOf(`${server.url}/read/${head}/${token}`)
    assert.equal(read.status, 200)
    assert.match(read.body, /href="\.\.\/\.\.\/font\/manrope-latin\.woff2"/)
    assert.match(read.body, /href="\.\.\/\.\.\/font\/firacode-latin\.woff2"/)
    assert.match(read.body, /url\("\.\.\/\.\.\/font\/manrope-latin\.woff2"\)/)
    assert.doesNotMatch(read.body, new RegExp(`href="/${server.capability}/font/`))
    const readStyle = read.body.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
    const readHash = createHash('sha256').update(readStyle).digest('base64')
    assert.equal(
      String(read.headers['content-security-policy']).includes(`style-src 'sha256-${readHash}'`),
      true,
    )
    assert.equal(
      String(read.headers['content-security-policy']).includes(`script-src 'sha256-${scriptHash}'`),
      true,
    )
    for (const name of ['manrope-latin.woff2', 'firacode-latin.woff2'] as const) {
      const fileBytes = readFileSync(join(repoRoot, 'lib/agent-memory/local/palace-assets', name))
      const got = await responseBytes(`${server.url}/font/${name}`)
      assert.equal(got.status, 200, name)
      assert.equal(got.headers['content-type'], 'font/woff2', name)
      assert.equal(got.headers['cache-control'], 'no-store', name)
      assert.equal(got.headers['x-content-type-options'], 'nosniff', name)
      assert.equal(got.headers['access-control-allow-origin'], undefined, name)
      assert.equal(got.body.subarray(0, 4).toString('latin1'), 'wOF2', name)
      assert.equal(createHash('sha256').update(got.body).digest('hex'), expected[name], name)
      assert.equal(got.body.equals(fileBytes), true, name)
      const headOnly = await responseBytes(`${server.url}/font/${name}`, undefined, 'HEAD')
      assert.equal(headOnly.status, 200, name)
      assert.equal(headOnly.body.length, 0, name)
      assert.equal(Number(headOnly.headers['content-length']), fileBytes.length, name)
      assert.equal(headOnly.headers['content-type'], 'font/woff2', name)
    }
    const document = await responseOf(`${server.url}/document/${head}/${token}`)
    assert.equal(document.status, 200)
    assert.match(String(document.headers['content-type']), /^application\/json/)
    assert.equal(parsePalaceDocument(JSON.parse(document.body)).text, 'Core')
    assert.equal(
      String(document.headers['content-security-policy']).includes(`script-src 'sha256-${scriptHash}'`),
      true,
    )
    assert.equal(
      String(document.headers['content-security-policy']).includes(`style-src 'sha256-${styleHash}'`),
      true,
    )
    assert.match(String(document.headers['content-security-policy']), /font-src 'self'/)
    const corpus = await responseOf(`${server.url}/corpus/${head}/0`)
    assert.equal(corpus.status, 404)
    assert.match(String(corpus.headers['content-type']), /^application\/json/)
    assert.match(corpus.body, /"status":"unavailable"/)
    for (const target of [
      `${server.url}/font/other.woff2`,
      `${server.url}/font/manrope-latin.woff2/extra`,
      `${server.url}/font/../manrope-latin.woff2`,
      `${server.url}/font/manrope-latin.woff2?x=1`,
      `${server.url}/assets/manrope-latin.woff2`,
    ]) {
      const denied = await responseOf(target)
      assert.equal(denied.status, 404, target)
      assert.match(denied.body, /Palace preview is unavailable/, target)
      assert.equal(denied.body.includes(server.capability), false, target)
      assert.doesNotMatch(String(denied.headers['content-type']), /font\/woff2/, target)
    }
    const posted = await responseOf(`${server.url}/font/manrope-latin.woff2`, undefined, 'POST')
    assert.equal(posted.status, 405)
    assert.equal(posted.body.includes(server.capability), false)
    const foreign = await responseBytes(`${server.url}/font/manrope-latin.woff2`, { host: 'evil.test' })
    assert.equal(foreign.status, 400)
    assert.equal(foreign.body.toString('utf8').includes(server.capability), false)
  } finally {
    await server.close()
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
    const kept = await service.palaceDocument({ commit: after.head, path: 'notes/keep.md' })
    assert.match(kept.text, /keep-bytes/)
    assert.equal(kept.text.includes('SENTINEL_TOMBSTONE_BODY'), false)
    assert.equal(encoded(kept).includes(fx.stateRoot), false)
    const wrong = after.head.startsWith('b') ? 'a'.repeat(40) : 'b'.repeat(40)
    await assert.rejects(
      () => service.palaceDocument({ commit: wrong, path: 'notes/keep.md' }),
      /Local memory palace stale/,
    )
    await assert.rejects(
      () => service.palaceDocument({ commit: after.head, path: 'notes/secret.md' }),
      /Local memory palace refused/,
    )
    await assert.rejects(
      () => service.palaceDocument({ commit: after.head, path: 'notes' }),
      /Local memory palace refused/,
    )
    const html = renderPalacePage({ state: 'snapshot', snapshot: after, reloadPath: '/cap' })
    assert.equal(html.includes('SENTINEL_TOMBSTONE_BODY'), false)
    assert.equal(html.includes('notes/secret.md'), false)
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
    assert.match(html, /synthetic coordinator requires explicit repair resolutions or abandonment/)
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
      role: 'assistant',
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
    assert.match(page.body, /Waiting/)
    assert.match(page.body, /Core\.md/)
    assert.match(page.body, /Synthetic baseline for this preview/)
    assert.match(page.body, /data-view="context" aria-current="page"/)
    assert.match(page.body, /data-palace-open="context"/)
    assert.match(page.body, /not automatic context|Not automatic context/)
    assert.equal(page.body.includes('synthetic preview job'), false)
    const json = await responseOf(opened.snapshotUrl)
    const snapshot = parsePalaceSnapshot(JSON.parse(json.body)) as PalaceSnapshot
    assert.equal(snapshot.authority.live, 'abi2')
    assert.equal(encoded(snapshot).includes('synthetic preview job'), false)
    assert.equal(encoded(snapshot).includes('Synthetic baseline for this preview'), false)
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
    document: async () => coreDocument(),
    corpus: async () => {
      throw Error('Local memory palace refused')
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

test('document reads bind the canonical commit and keep tombstoned text out', async () => {
  const fx = fixture('mahiro-palace-document-')
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: {
        'Core.md': 'before\n',
        'index.md': 'index\n',
        'human/prefs.md': 'prefs\n',
      },
      worker: (ctx) => ctx.write('Core.md', 'after\n'),
    })
    const old = await service.head()
    const first = await service.palaceDocument({ commit: old, path: 'Core.md' })
    assert.equal(first.placement, 'baseline')
    assert.match(first.text, /before/)
    assert.equal(encoded(first).includes(fx.stateRoot), false)
    const prefs = await service.palaceDocument({ commit: old, path: 'human/prefs.md' })
    assert.equal(prefs.placement, 'library')
    assert.equal(prefs.group, 'human')
    await assert.rejects(
      () => service.palaceDocument({ commit: old, path: 'human' }),
      /Local memory palace refused/,
    )
    await assert.rejects(
      () => service.palaceDocument({ commit: old, path: '../Core.md' }),
      /Local memory path refused/,
    )
    await service.enqueue({ id: 'edit', summary: 'SENTINEL_EDIT_SUMMARY' })
    await service.start('edit')
    assert.equal((await service.integrate('edit')).status, 'integrated')
    await assert.rejects(
      () => service.palaceDocument({ commit: old, path: 'Core.md' }),
      /Local memory palace stale/,
    )
    const next = await service.head()
    const second = await service.palaceDocument({ commit: next, path: 'Core.md' })
    assert.match(second.text, /after/)
    assert.equal(second.text.includes('SENTINEL_EDIT_SUMMARY'), false)
    assert.equal(encoded(second).includes(fx.stateRoot), false)
  } finally {
    fx.close()
  }
})

test('service-backed Palace reads committed Unicode, spaces, and hash paths', async () => {
  const fx = fixture('mahiro-palace-unicode-')
  const worktree = join(fx.dir, 'unicode-worktree')
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'core\n', 'index.md': 'index\n' },
      worker: () => {},
    })
    fx.git(undefined, ['worktree', 'add', worktree, 'main'])
    mkdirSync(join(worktree, 'system', 'human'), { recursive: true })
    mkdirSync(join(worktree, 'notes'), { recursive: true })
    const thaiPath = 'system/human/ภาษา ไทย.md'
    const hashPath = 'notes/tag#one.md'
    writeFileSync(join(worktree, thaiPath), '# ภาษาไทย\n')
    writeFileSync(join(worktree, hashPath), '# Hash path\n')
    fx.git(worktree, ['add', '--', thaiPath, hashPath])
    fx.git(worktree, ['commit', '-m', 'add unicode palace fixtures'])
    const commit = await service.head()
    const snapshot = await service.palacePreview()
    assert.equal(snapshot.head, commit)
    assert.equal(
      snapshot.corpus.entries.some((entry) => entry.path === thaiPath),
      true,
    )
    assert.equal(
      snapshot.corpus.entries.some((entry) => entry.path === hashPath),
      true,
    )
    const thai = await service.palaceDocument({ commit, path: thaiPath })
    const hashed = await service.palaceDocument({ commit, path: hashPath })
    assert.equal(thai.group, 'human')
    assert.match(thai.text, /ภาษาไทย/)
    assert.match(hashed.text, /Hash path/)
  } finally {
    if (existsSync(worktree)) {
      try {
        fx.git(undefined, ['worktree', 'remove', '--force', worktree])
      } catch {
        // The exact fixture root is removed below even if Git cleanup refuses.
      }
    }
    fx.close()
  }
})

test('a forbidden source stays out of the corpus and the document read', async () => {
  const fx = fixture('mahiro-palace-source-')
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'core\n', 'index.md': 'index\n', 'Alias.md': 'SENTINEL_SOURCE_BODY\n' },
      worker: () => {},
    })
    const before = await service.palacePreview()
    const tombstone: TombstoneSnapshot = {
      version: 1,
      revision: 'e'.repeat(40),
      paths: [],
      blobs: [],
      sources: [{ project: null, source: 'Alias.md' }],
      digest: '',
    }
    tombstone.digest = tombstoneSnapshotDigest(tombstone)
    await service.importTombstones({
      expectedPolicyRevision: before.publication.forgettingRevision,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot: tombstone,
    })
    const after = await service.palacePreview()
    assert.equal(
      after.corpus.entries.some((entry) => entry.path === 'Alias.md'),
      false,
    )
    assert.equal(encoded(after).includes('SENTINEL_SOURCE_BODY'), false)
    assert.equal(encoded(after).includes('Alias.md'), false)
    await assert.rejects(
      () => service.palaceDocument({ commit: after.head, path: 'Alias.md' }),
      /Local memory palace refused/,
    )
    const html = renderPalacePage({ state: 'snapshot', snapshot: after, reloadPath: '/cap' })
    assert.equal(html.includes('SENTINEL_SOURCE_BODY'), false)
    assert.equal(html.includes('Alias.md'), false)
  } finally {
    fx.close()
  }
})

test('palace document validation, markdown, and memory groups stay bounded', () => {
  const thai = Buffer.from('ก')
  assert.equal(clipPalaceUtf8(Buffer.concat([Buffer.from('x'), thai]), 2).toString('utf8'), 'x')
  const huge = 'a'.repeat(20_000)
  const clipped = buildPalaceDocument({ commit: head, path: 'Core.md', totalBytes: huge.length, text: huge })
  assert.equal(clipped.truncated, true)
  assert.equal(clipped.placement, 'baseline')
  assert.ok(clipped.bytes <= palaceDocumentLimits.maxResponseBytes)
  assert.ok(clipped.returnedBytes <= palaceDocumentLimits.maxTextBytes)
  assert.equal(parsePalaceDocument(clipped).text, clipped.text)
  const lying = structuredClone(clipped)
  lying.placement = 'library'
  assert.throws(() => parsePalaceDocument(lying), /Local memory palace refused/)
  const extra = { ...clipped, stateRoot: '/tmp/secret' }
  assert.throws(() => parsePalaceDocument(extra), /Local memory palace refused/)
  assert.throws(
    () => buildPalaceDocument({ commit: head, path: '../Core.md', totalBytes: 1, text: 'x' }),
    /Local memory path refused/,
  )
  const project = buildPalaceDocument({
    commit: head,
    path: 'projects/example/system/overview.md',
    totalBytes: 5,
    text: 'hello',
  })
  assert.equal(project.group, 'project')
  assert.equal(project.placement, 'library')
  const humanFile = buildPalaceDocument({
    commit: head,
    path: 'system/human/communication.md',
    totalBytes: 5,
    text: 'human',
  })
  assert.equal(humanFile.group, 'human')
  const libraryFile = buildPalaceDocument({
    commit: head,
    path: 'system/other.md',
    totalBytes: 5,
    text: 'other',
  })
  assert.equal(libraryFile.group, 'library')
  assert.notEqual(libraryFile.placement, 'baseline')
  const payload = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    '![x](https://evil.example/a.png)',
    '<a href="javascript:alert(1)">x</a>',
  ].join('\n\n')
  const rendered = renderPalaceMarkdown(payload)
  assert.match(rendered, /click/)
  assert.doesNotMatch(rendered, /<\s*script/i)
  assert.doesNotMatch(rendered, /<\s*img/i)
  assert.doesNotMatch(rendered, /<\s*a[\s>]/i)
  assert.doesNotMatch(rendered, /<[a-z][^>]*\son\w+\s*=/i)
  assert.doesNotMatch(rendered, /<[a-z][^>]*\shref\s*=/i)
  assert.match(rendered, />click</)
  const tags = [...rendered.matchAll(/<\/?([a-z0-9]+)/g)].map((match) => match[1])
  for (const tag of tags)
    assert.ok(
      ['p', 'code', 'pre', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote', 'h3', 'h4', 'h5'].includes(tag),
      tag,
    )
  const snapshot = buildPalaceSnapshot(
    baseFacts({
      corpus: [
        file('Core.md', 40),
        file('index.md', 40),
        file('system/persona.md', 40),
        file('system/other.md', 40),
        file('human/prefs/communication.md', 40),
        file('projects/example/system/overview.md', 40),
        file('projects/example/system/conventions.md', 40),
        file('reference/notes/deferred.md', 40),
      ],
      jobs: [
        job({
          id: 'repairjob',
          status: 'repair-needed',
          sequence: 1,
          workerCommit: other,
          conflictPaths: ['notes.md'],
        }),
      ],
      recovery: [{ jobId: 'runningjob', outcome: 'interrupted' }],
    }),
  )
  const core = '# Core\n\nSynthetic baseline paragraph.\n\n- readable item\n'
  const context = syntheticPalaceContextFixture()
  const html = renderPalacePage({
    state: 'snapshot',
    snapshot,
    reloadPath: '/cap',
    context,
    document: buildPalaceDocument({
      commit: head,
      path: 'Core.md',
      totalBytes: Buffer.byteLength(core),
      text: core,
    }),
  })
  assertDocument(html, { tables: true, script: true })
  assert.match(html, /Synthetic baseline paragraph/)
  assert.match(html, /aria-label="system\/persona\.md"/)
  assert.match(html, /aria-label="system\/other\.md"/)
  assert.match(html, /class="app-shell"/)
  assert.match(html, /class="product-mark"/)
  assert.match(
    html,
    /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1254 1254" aria-hidden="true" focusable="false">/,
  )
  assert.match(html, /fill="#0a0606"/)
  assert.match(html, /fill="#a552fc"/)
  assert.match(html, /fill="#fdf5d9"/)
  assert.match(html, /class="product-name">Mahiro Pi</)
  assert.doesNotMatch(html, /<img\b/i)
  assert.doesNotMatch(html, /foreignObject|data:|onclick=/)
  assert.match(palacePreviewStyle(), /#DED0FD/)
  assert.doesNotMatch(palacePreviewStyle(), /rotate\(45deg\)|idlePulse/)
  assert.match(html, /class="context-layout"/)
  assert.match(html, /class="context-grid"/)
  assert.match(html, /class="context-sidebar"/)
  assert.match(html, /class="ctx-usage-label">240\/480 owner-supplied tokens \(50%\)/)
  assert.match(html, /Preview fixture · Not a live session/)
  assert.match(html, /Owner-supplied context composition/)
  assert.match(html, /240 tokens free/)
  assert.match(html, /ABI2 remains live authority\. This preview does not publish/)
  assert.match(html, /<button type="button" class="ctx-legend-item" data-legend="core" data-view="core">/)
  assert.match(
    html,
    /<button type="button" class="ctx-legend-item" data-legend="external" data-view="external">/,
  )
  assert.equal(html.match(/<span class="block /g)?.length, 480)
  for (const category of ['system', 'core', 'external', 'summary', 'tools', 'messages']) {
    assert.equal(html.match(new RegExp(`<span class="block ctx-${category}"`, 'g'))?.length, 20)
    assert.match(
      html,
      new RegExp(
        `data-legend="${category}"[^>]*>[\\s\\S]*?<span class="ctx-legend-value">20 \\(4\\.2%\\)</span>`,
      ),
    )
  }
  assert.equal(html.match(/<span class="block ctx-unattributed"/g)?.length, 120)
  assert.equal(html.match(/<span class="block ctx-free"/g)?.length, 240)
  assert.match(html, /Unattributed<\/span><span class="ctx-legend-value">120 \(25\.0%\)/)
  assert.match(html, /Free<\/span><span class="ctx-legend-value">240 \(50\.0%\)/)
  assert.equal(html.includes('Corpus composition'), false)
  assert.equal(html.includes('id="authority-title"'), false)
  assert.equal(html.includes('comp-row'), false)
  assert.match(html, /data-view="core" aria-current="page"/)
  assert.match(html, /data-palace-open="core"/)
  const contextFirst = renderPalacePage({
    state: 'snapshot',
    snapshot,
    reloadPath: '/cap',
    context,
    document: buildPalaceDocument({
      commit: head,
      path: 'Core.md',
      totalBytes: Buffer.byteLength(core),
      text: core,
    }),
    focus: 'context',
  })
  assert.match(contextFirst, /data-view="context" aria-current="page"/)
  assert.match(contextFirst, /data-palace-open="context"/)
  assert.match(contextFirst, /Synthetic baseline paragraph/)
  assert.doesNotMatch(contextFirst, /data-view="core" aria-current="page"/)
  const external = renderPalacePage({
    state: 'snapshot',
    snapshot,
    reloadPath: '/cap',
    document: buildPalaceDocument({
      commit: head,
      path: 'human/prefs/communication.md',
      totalBytes: 4,
      text: 'note',
    }),
  })
  assert.match(external, /data-view="external" aria-current="page"/)
  assert.match(external, /data-palace-open="external"/)
  assert.match(html, /data-view="context"/)
  assert.match(html, /data-view="external"/)
  assert.match(html, /data-view="history"/)
  assert.match(html, />Context</)
  assert.match(html, />Core memory \(/)
  assert.match(html, />External memory \(/)
  assert.match(html, />History</)
  assert.doesNotMatch(html, />Memory<\/a>|>Maintenance<\/a>/)
  const externalAt = html.indexOf('data-tree="external"')
  assert.ok(html.indexOf('data-tree="core"') < externalAt)
  assert.ok(html.indexOf('data-memory-group="baseline"') < externalAt)
  assert.ok(html.indexOf('aria-label="system/persona.md"') < externalAt)
  assert.ok(html.indexOf('data-memory-group="library"') > externalAt)
  assert.ok(html.indexOf('aria-label="system/other.md"') > externalAt)
  assert.match(html, /data-folder="system\/"/)
  assert.match(html, /class="meta-pill"/)
  assert.match(html, /description:/)
  assert.match(html, /aria-label="Document format"/)
  assert.match(html, /class="commit-item"/)
  assert.match(html, /class="history-search-group"/)
  assert.match(html, /class="history-search-select"/)
  assert.match(html, /id="history-filter"/)
  assert.match(html, /id="history-kind"/)
  assert.match(html, /data-history-kind="job"/)
  assert.match(html, />Load more files<\/button>/)
  assert.match(palacePreviewStyle(), /--bg:\s*hsl\(0,\s*0%,\s*11%\)/)
  assert.match(palacePreviewStyle(), /color-scheme:\s*dark/)
  assert.match(palacePreviewStyle(), /--accent:\s*hsl\(240,\s*80%,\s*68%\)/)
  assert.match(palacePreviewStyle(), /max-inline-size:\s*min\(1180px,\s*100%\)/)
  assert.match(palacePreviewStyle(), /grid-template-columns: 320px minmax\(0, 1fr\)/)
  assert.match(palacePreviewStyle(), /@media \(max-width: 900px\)/)
  assert.match(palacePreviewStyle(), /@media \(max-width: 600px\)/)
  const previewStyle = palacePreviewStyle()
  const headerStackAt = previewStyle.indexOf('@media (max-width: 900px)')
  const headerStackEnd = previewStyle.indexOf('@media (max-width: 700px)')
  assert.ok(headerStackAt !== -1 && headerStackEnd > headerStackAt)
  const headerStack = previewStyle.slice(headerStackAt, headerStackEnd)
  const headerDesktop = previewStyle.slice(0, headerStackAt)
  assert.match(headerDesktop, /\.header\s*\{[^}]*display:\s*flex/)
  assert.match(headerDesktop, /\.header\s*\{[^}]*align-items:\s*center/)
  assert.match(headerDesktop, /\.header \.agent-meta\s*\{\s*margin-left:\s*auto;\s*text-align:\s*right/)
  assert.doesNotMatch(headerDesktop, /grid-template-areas/)
  assert.match(headerStack, /\.header\s*\{[^}]*display:\s*grid/)
  assert.match(headerStack, /\.header\s*\{[^}]*grid-template-areas:\s*"brand reload" "meta meta"/)
  assert.match(headerStack, /\.header\s*\{[^}]*grid-template-columns:\s*auto auto/)
  assert.match(headerStack, /\.header\s*\{[^}]*justify-content:\s*start/)
  assert.doesNotMatch(headerStack, /\.header\s*\{[^}]*minmax\(0,\s*1fr\) auto/)
  assert.match(headerStack, /\.header-brand\s*\{[^}]*grid-area:\s*brand/)
  assert.match(headerStack, /\.header-brand\s*\{[^}]*min-inline-size:\s*0/)
  assert.match(headerStack, /\.header > a\s*\{[^}]*grid-area:\s*reload/)
  assert.match(headerStack, /\.header > a\s*\{[^}]*margin-inline-start:\s*0/)
  assert.match(headerStack, /\.header > a\s*\{[^}]*align-self:\s*start/)
  assert.match(headerStack, /\.header \.agent-meta\s*\{[^}]*grid-area:\s*meta/)
  assert.match(headerStack, /\.header \.agent-meta\s*\{[^}]*inline-size:\s*min\(100%,\s*42ch\)/)
  assert.match(headerStack, /\.header \.agent-id\s*\{[^}]*max-inline-size:\s*42ch/)
  assert.match(headerStack, /\.header \.agent-meta\s*\{[^}]*max-inline-size:\s*100%/)
  assert.match(headerStack, /\.header \.agent-meta\s*\{[^}]*justify-self:\s*start/)
  assert.match(headerStack, /\.header \.agent-meta\s*\{[^}]*min-inline-size:\s*0/)
  assert.match(headerStack, /\.header \.agent-id\s*\{[^}]*overflow-wrap:\s*anywhere/)
  assert.match(headerStack, /\.header \.agent-id\s*\{[^}]*word-break:\s*break-word/)
  assert.doesNotMatch(headerStack, /order:\s*3|flex:\s*1 1 100%/)
  assert.match(previewStyle, /\.context-grid-area\s*\{[^}]*overflow:\s*clip/)
  assert.match(previewStyle, /\.context-grid-area\s*\{[^}]*overflow-clip-margin:\s*4px/)
  assert.doesNotMatch(previewStyle, /\.context-grid-area\s*\{[^}]*overflow:\s*hidden/)
  const historyColumns = previewStyle.indexOf('grid-template-columns: 110px minmax(0, 1fr) auto')
  const historyNarrow = previewStyle.lastIndexOf('max-width: 600px')
  assert.ok(historyColumns !== -1 && historyNarrow > historyColumns)
  assert.match(
    previewStyle.slice(historyNarrow),
    /\.commit-head\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  )
  const historySearch = previewStyle.indexOf('.history-search-group {')
  const historyActivity = previewStyle.indexOf('.history-field-activity { flex: 0 0 auto')
  assert.ok(historySearch !== -1 && historyActivity !== -1 && historySearch < historyNarrow)
  assert.ok(historyActivity < historyNarrow)
  assert.match(previewStyle.slice(historyNarrow), /\.history-toolbar\s*\{[^}]*flex-direction:\s*column/)
  assert.match(
    previewStyle.slice(historyNarrow),
    /\.history-search-input,\s*\.history-search-select\s*\{[^}]*inline-size:\s*100%/,
  )
  assert.match(previewStyle, /\.file-size,\s*\.folder-count\s*\{[^}]*flex:\s*0 0 auto/)
  assert.match(previewStyle, /\.file-size,\s*\.folder-count\s*\{[^}]*white-space:\s*nowrap/)
  assert.match(previewStyle, /\.file-path,\s*\.folder-name\s*\{[^}]*flex:\s*1 1 auto/)
  assert.match(previewStyle, /\.file-path,\s*\.folder-name\s*\{[^}]*min-inline-size:\s*0/)
  assert.match(previewStyle, /\.file-path,\s*\.folder-name\s*\{[^}]*overflow-wrap:\s*anywhere/)
  assert.match(palacePreviewStyle(), /@media \(max-width: 320px\)/)
  assert.match(palacePreviewStyle(), /overflow-x:\s*auto/)
  const laterFiles = Array.from({ length: 40 }, (_, index) =>
    file(`n/f${String(index).padStart(2, '0')}.md`, 8),
  )
  const truncatedSnapshot = buildPalaceSnapshot(baseFacts({ corpus: [file('Core.md', 4), ...laterFiles] }))
  assert.equal(truncatedSnapshot.corpus.truncated, true)
  const truncatedHtml = renderPalacePage({
    state: 'snapshot',
    snapshot: truncatedSnapshot,
    reloadPath: '/cap',
    context,
  })
  assert.match(truncatedHtml, /data-tab-count="core">\d+ loaded</)
  assert.match(truncatedHtml, /data-tab-count="external">\d+ loaded</)
  assert.match(truncatedHtml, /240\/480 owner-supplied tokens \(50%\)/)
  assert.doesNotMatch(truncatedHtml, /Categories describe the loaded page only/)
  assert.match(html, /Not automatic context/)
  assert.match(html, /Needs repair/)
  assert.match(html, /notes\.md/)
  assert.match(html, /data-format="rendered" aria-pressed="true"/)
  assert.match(html, /data-format="raw" aria-pressed="false"/)
  assert.equal(html.match(/<script>/g)?.length, 1)
  assert.doesNotMatch(html, /<img[\s>]/i)

  const jobs = Array.from({ length: 32 }, (_, index) =>
    job({ id: `queued-${String(index + 1).padStart(2, '0')}`, status: 'queued', sequence: index + 1 }),
  )
  jobs.push(
    job({
      id: 'repair-later',
      status: 'repair-needed',
      sequence: 33,
      workerCommit: other,
      conflictPaths: ['later-conflict.md'],
    }),
  )
  const pagedRepair = buildPalaceSnapshot(baseFacts({ jobs }))
  assert.equal(
    pagedRepair.jobs.entries.some((entry) => entry.id === 'repair-later'),
    false,
  )
  assert.equal(pagedRepair.conflicts.total, 1)
  assert.equal(pagedRepair.conflicts.entries.length, 0)
  const pagedRepairHtml = renderPalacePage({
    state: 'snapshot',
    snapshot: pagedRepair,
    reloadPath: '/cap',
  })
  assert.match(pagedRepairHtml, /Needs repair/)
  assert.match(pagedRepairHtml, /repair job is outside the current bounded activity page/)
  assert.match(pagedRepairHtml, /Not every visible conflict path fits in this page/)
})

test('document routes reject hostile requests and drain on close', async () => {
  const snapshot = buildPalaceSnapshot(baseFacts({ corpus: [file('Core.md', 4)] }))
  const text = 'Core'
  const server = await startPalacePreviewServer({
    snapshot: async () => snapshot,
    document: async (request) => {
      if (request.commit !== head) throw Error('Local memory palace stale')
      if (request.path !== 'Core.md') throw Error('Local memory palace refused')
      return buildPalaceDocument({ commit: head, path: 'Core.md', totalBytes: text.length, text })
    },
    corpus: async () => {
      throw Error('Local memory palace refused')
    },
  })
  const coreToken = encodePalacePath('Core.md')
  try {
    const ok = await responseOf(`${server.url}/document/${head}/${coreToken}`)
    assert.equal(ok.status, 200)
    assert.equal(parsePalaceDocument(JSON.parse(ok.body)).text, text)
    assert.match(String(ok.headers['content-security-policy']), /connect-src 'self'/)
    const stale = await responseOf(`${server.url}/document/${'b'.repeat(40)}/${coreToken}`)
    assert.equal(stale.status, 409)
    assert.match(stale.body, /"status":"stale"/)
    assert.equal(stale.body.includes(server.capability), false)
    assert.equal(stale.body.includes(text), false)
    const missing = await responseOf(`${server.url}/document/${head}/${encodePalacePath('index.md')}`)
    assert.equal(missing.status, 404)
    assert.match(missing.body, /"status":"unavailable"/)
    assert.equal(missing.body.includes('index.md'), false)
    for (const target of [
      `${server.url}/document/${head}/Core.md?x=1`,
      `${server.url}/document/${head}/Core.md?path=a&path=b`,
      `${server.url}/document/${head}/%2e%2e/Core.md`,
      `${server.url}/document/${head}/../Core.md`,
      `${server.url}/document/${'a'.repeat(80)}/Core.md`,
      `${server.url}/${'x'.repeat(1100)}`,
    ]) {
      const denied = await responseOf(target)
      assert.equal(denied.status, 404, target)
      assert.equal(denied.body.includes(server.capability), false, target)
    }
    const posted = await responseOf(`${server.url}/document/${head}/${coreToken}`, undefined, 'POST')
    assert.equal(posted.status, 405)
    assert.equal(posted.body.includes(server.capability), false)
    const foreign = await responseOf(`${server.url}/document/${head}/${coreToken}`, { host: 'evil.test' })
    assert.equal(foreign.status, 400)
    assert.equal(foreign.body.includes(server.capability), false)
    const read = await responseOf(`${server.url}/read/${head}/${coreToken}`)
    assert.equal(read.status, 200)
    assert.match(read.body, />Core</)
    assert.match(read.body, /data-view="core" aria-current="page"/)
    assert.match(read.body, /data-palace-open="core"/)
    const staleRead = await responseOf(`${server.url}/read/${'b'.repeat(40)}/${coreToken}`)
    assert.equal(staleRead.status, 409)
    assert.match(staleRead.body, new RegExp(`href="/${server.capability}"`))
    assert.doesNotMatch(staleRead.body, /href=""/)
  } finally {
    await server.close()
  }

  let release = () => {}
  let entered = false
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const draining = await startPalacePreviewServer({
    snapshot: async () => snapshot,
    document: () => {
      entered = true
      return gate.then(() =>
        buildPalaceDocument({ commit: head, path: 'Core.md', totalBytes: text.length, text }),
      )
    },
    corpus: async () => {
      throw Error('Local memory palace refused')
    },
  })
  const response = responseOf(`${draining.url}/document/${head}/${encodePalacePath('Core.md')}`).catch(
    () => undefined,
  )
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-palace-document-close-'))
  writeFileSync(join(root, 'marker'), 'keep')
  let finished: Promise<void> = Promise.resolve()
  try {
    for (let attempt = 0; attempt < 50 && !entered; attempt += 1) await delay(10)
    assert.equal(entered, true)
    let cleaned = false
    finished = (async () => {
      await draining.close()
      rmSync(root, { recursive: true, force: true })
      cleaned = true
    })()
    await delay(40)
    assert.equal(cleaned, false)
    assert.equal(existsSync(join(root, 'marker')), true)
    release()
    await finished
    assert.equal(cleaned, true)
    await response
  } finally {
    release()
    await finished.catch(() => undefined)
    await draining.close().catch(() => undefined)
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

test('markdown advances through degenerate markers and path tokens keep dotted names', async () => {
  for (const sample of [
    '# \n',
    '## \n',
    '### \n',
    '#\n',
    '##\n',
    '###\n',
    '```\n',
    '>\n',
    '-\n',
    '*\n',
    '1.\n',
  ]) {
    const rendered = renderPalaceMarkdown(sample)
    assert.equal(typeof rendered, 'string')
    assert.ok(rendered.length < sample.length * 12 + 64)
  }
  const mixed = '# \n## \n### \n#\n```\ncode\n```\n> \n- \n* \n1. \n# Title\n\n- item\n1. item\n\npara\n'
  const mixedHtml = renderPalaceMarkdown(mixed)
  assert.match(mixedHtml, />Title</)
  assert.match(mixedHtml, />item</)
  assert.ok(mixedHtml.length < mixed.length * 12 + 64)
  const many = Array.from({ length: 200 }, () => '# ').join('\n')
  const manyHtml = renderPalaceMarkdown(many)
  assert.match(manyHtml, /<h3>/)
  assert.ok(manyHtml.length < many.length * 12)
  const script = palacePreviewScript()
  assert.match(script, /if \(index <= lineStart\)/)
  assert.match(script, /index = lineStart \+ 1/)
  assert.match(script, /if \(rest\.length >= before\) rest = rest\.slice\(1\)/)
  assert.match(script, /new AbortController/)
  assert.match(script, /selection \+= 1/)
  assert.match(script, /generation === selection/)
  assert.match(script, /signal: controller\.signal/)
  assert.match(script, /data-document/)
  assert.match(script, /Loading one page of memory files/)
  assert.match(script, /Use Load more files to try again/)
  assert.match(script, /data-tab-count/)
  assert.match(script, /data-tree/)
  assert.match(script, /history-filter/)
  assert.match(script, /Baseline memory/)
  assert.match(script, /On-demand library/)
  assert.doesNotMatch(script, /\/document\/' \+ commit \+ '\/' \+ path/)
  assert.equal(encodePalacePath('notes/v1..v2.md').includes('.'), false)
  assert.equal(decodePalacePath(encodePalacePath('notes/v1..v2.md')), 'notes/v1..v2.md')
  assert.equal(decodePalacePath(encodePalacePath('human/ภาษา ไทย.md')), 'human/ภาษา ไทย.md')
  for (const path of ['../secret.md', 'foo/../bar.md', 'foo/.git/config', 'a\0b.md', '..', 'notes/../v1.md'])
    assert.throws(() => encodePalacePath(path), /Local memory path refused/)
  const thai = 'human/ภาษา ไทย.md'
  const dotted = 'notes/v1..v2.md'
  const hashed = 'notes/tag#one.md'
  const snapshot = buildPalaceSnapshot(
    baseFacts({ corpus: [file(thai, 8), file(dotted, 8), file(hashed, 8)] }),
  )
  const html = renderPalacePage({ state: 'snapshot', snapshot, reloadPath: '/cap' })
  assert.match(html, /data-path="human\/ภาษา ไทย.md"/)
  assert.match(html, /data-path="notes\/v1\.\.v2\.md"/)
  assert.match(html, new RegExp(`data-document="/cap/document/${head}/${encodePalacePath(dotted)}"`))
  for (const href of [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '')) {
    if (!href.startsWith('/cap/')) continue
    assert.equal(href.includes('..'), false, href)
    assert.equal(href.includes('%'), false, href)
    assert.equal(href.includes(' '), false, href)
    assert.equal(href.includes('ภาษา'), false, href)
    assert.equal(href.includes('#'), false, href)
  }
  const server = await startPalacePreviewServer({
    snapshot: async () => snapshot,
    document: async (request) => {
      if (request.commit !== head) throw Error('Local memory palace stale')
      if (request.path === 'Core.md')
        return buildPalaceDocument({ commit: head, path: 'index.md', totalBytes: 1, text: 'x' })
      if (request.path !== thai && request.path !== dotted && request.path !== hashed)
        throw Error('Local memory palace refused')
      const text = `body ${request.path}`
      return buildPalaceDocument({
        commit: head,
        path: request.path,
        totalBytes: Buffer.byteLength(text),
        text,
      })
    },
    corpus: async () => {
      throw Error('Local memory palace refused')
    },
  })
  try {
    const opened = await responseOf(`${server.url}/document/${head}/${encodePalacePath(dotted)}`)
    assert.equal(opened.status, 200)
    assert.equal(parsePalaceDocument(JSON.parse(opened.body)).path, dotted)
    const thaiResponse = await responseOf(`${server.url}/document/${head}/${encodePalacePath(thai)}`)
    assert.equal(thaiResponse.status, 200)
    assert.equal(parsePalaceDocument(JSON.parse(thaiResponse.body)).path, thai)
    assert.equal(thaiResponse.body.includes('%'), false)
    const rawName = await responseOf(`${server.url}/document/${head}/notes/v1..v2.md`)
    assert.equal(rawName.status, 404)
    const mismatched = await responseOf(`${server.url}/document/${head}/${encodePalacePath('Core.md')}`)
    assert.equal(mismatched.status, 404)
    assert.match(mismatched.body, /"status":"unavailable"/)
    assert.equal(mismatched.body.includes(server.capability), false)
    const crafted = (path: string) => Buffer.from(path, 'utf8').toString('base64url')
    for (const token of [
      crafted('../secret.md'),
      crafted('foo/../bar.md'),
      crafted('foo/.git/config'),
      crafted('a\0b.md'),
      '!!!',
      'A'.repeat(685),
    ]) {
      const denied = await responseOf(`${server.url}/document/${head}/${token}`)
      assert.equal(denied.status, 404, token)
      assert.equal(denied.body.includes(server.capability), false, token)
    }
  } finally {
    await server.close()
  }
})

test('a late file response does not replace the newer selection', async () => {
  class Element {
    tag: string
    attrs = new Map<string, string>()
    listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>()
    childNodes: Array<Element | TextNode> = []
    parent: Element | null = null
    hidden = false
    open = false
    className = ''
    id = ''
    value = ''
    text = ''
    constructor(tag: string) {
      this.tag = tag
    }
    get tagName(): string {
      return this.tag.toUpperCase()
    }
    get parentElement(): Element | null {
      return this.parent
    }
    get textContent(): string {
      if (this.childNodes.length === 0) return this.text
      return this.childNodes.map((node) => node.textContent).join('')
    }
    set textContent(value: string) {
      this.text = String(value)
      this.childNodes = []
    }
    setAttribute(name: string, value: string): void {
      this.attrs.set(name, String(value))
    }
    getAttribute(name: string): string | null {
      return this.attrs.has(name) ? (this.attrs.get(name) ?? null) : null
    }
    removeAttribute(name: string): void {
      this.attrs.delete(name)
    }
    addEventListener(type: string, fn: (event: Record<string, unknown>) => void): void {
      const list = this.listeners.get(type) ?? []
      list.push(fn)
      this.listeners.set(type, list)
    }
    append(...nodes: Array<Element | TextNode>): void {
      for (const node of nodes) {
        node.parent = this
        this.childNodes.push(node)
      }
    }
    get firstChild(): Element | TextNode | null {
      return this.childNodes[0] ?? null
    }
    removeChild(node: Element | TextNode): Element | TextNode {
      const index = this.childNodes.indexOf(node)
      if (index >= 0) this.childNodes.splice(index, 1)
      return node
    }
    closest(selector: string): Element | null {
      let current: Element | null = this
      while (current) {
        if (matches(current, selector)) return current
        current = current.parent
      }
      return null
    }
    querySelector(selector: string): Element | null {
      return walk(this, selector)[0] ?? null
    }
    querySelectorAll(selector: string): Element[] {
      return walk(this, selector)
    }
    focus(): void {}
  }
  class TextNode {
    text: string
    parent: Element | null = null
    constructor(text: string) {
      this.text = text
    }
    get textContent(): string {
      return this.text
    }
  }
  const matches = (node: Element, selector: string) => {
    if (selector.startsWith('#')) return node.id === selector.slice(1)
    if (selector === 'a[data-path]') return node.tag === 'a' && node.attrs.has('data-path')
    if (selector === 'li[data-path]') return node.tag === 'li' && node.attrs.has('data-path')
    if (selector === 'li') return node.tag === 'li'
    const tree = /^\[data-tree="([^"]+)"\]$/.exec(selector)
    if (tree) return node.getAttribute('data-tree') === tree[1]
    return false
  }
  const walk = (node: Element, selector: string): Element[] => {
    const found: Element[] = []
    for (const child of node.childNodes) {
      if (child instanceof Element) {
        if (matches(child, selector)) found.push(child)
        found.push(...walk(child, selector))
      }
    }
    return found
  }
  const byId = new Map<string, Element>()
  const make = (tag: string, id: string) => {
    const node = new Element(tag)
    node.id = id
    byId.set(id, node)
    return node
  }
  const browser = make('div', 'memory-browser')
  const filter = make('input', 'memory-filter')
  const count = make('p', 'memory-count')
  const title = make('h2', 'document-title')
  const meta = make('p', 'document-meta')
  const readerStatus = make('span', 'reader-status')
  const readerMessage = make('span', 'reader-message')
  const rendered = make('div', 'document-rendered')
  const raw = make('pre', 'document-raw')
  const status = make('p', 'document-status')
  const root = make('div', 'memory')
  const commit = head
  const pagePath = `/${'b'.repeat(43)}`
  root.setAttribute('data-palace-commit', commit)
  root.setAttribute('data-palace-page', pagePath)
  root.setAttribute('data-palace-document', `${pagePath}/document/${commit}/`)
  root.setAttribute('data-palace-read', `${pagePath}/read/${commit}/`)
  root.setAttribute('data-palace-corpus', `${pagePath}/corpus/${commit}`)
  root.setAttribute('data-corpus-truncated', 'false')
  root.setAttribute('data-corpus-total', '2')
  root.setAttribute('data-corpus-returned', '2')
  const pathA = 'A.md'
  const pathB = 'notes/v1..v2.md'
  const urlA = `${pagePath}/document/${commit}/${encodePalacePath(pathA)}`
  const urlB = `${pagePath}/document/${commit}/${encodePalacePath(pathB)}`
  const hrefA = `${pagePath}/read/${commit}/${encodePalacePath(pathA)}`
  const hrefB = `${pagePath}/read/${commit}/${encodePalacePath(pathB)}`
  const linkFor = (path: string, url: string, href: string) => {
    const item = new Element('li')
    item.setAttribute('data-path', path)
    const anchor = new Element('a')
    anchor.setAttribute('data-path', path)
    anchor.setAttribute('data-document', url)
    anchor.setAttribute('href', href)
    item.append(anchor)
    browser.append(item)
    return anchor
  }
  const linkA = linkFor(pathA, urlA, hrefA)
  const linkB = linkFor(pathB, urlB, hrefB)
  const coreTree = new Element('div')
  coreTree.setAttribute('data-tree', 'core')
  const externalTree = new Element('div')
  externalTree.setAttribute('data-tree', 'external')
  browser.append(coreTree, externalTree)
  const treeLink = (tree: Element, path: string) => {
    const item = new Element('li')
    item.setAttribute('data-path', path)
    const anchor = new Element('a')
    anchor.setAttribute('data-path', path)
    const url = `${pagePath}/document/${commit}/${encodePalacePath(path)}`
    const href = `${pagePath}/read/${commit}/${encodePalacePath(path)}`
    anchor.setAttribute('data-document', url)
    anchor.setAttribute('href', href)
    item.append(anchor)
    tree.append(item)
    return { anchor, item, url, href }
  }
  const coreFile = treeLink(coreTree, 'Core.md')
  const collapsedPath = 'notes/closed.md'
  const collapsedUrl = `${pagePath}/document/${commit}/${encodePalacePath(collapsedPath)}`
  const collapsedHref = `${pagePath}/read/${commit}/${encodePalacePath(collapsedPath)}`
  const collapsedFolder = new Element('li')
  const collapsed = new Element('details')
  collapsed.open = false
  const collapsedList = new Element('ul')
  const collapsedItem = new Element('li')
  const collapsedAnchor = new Element('a')
  collapsedAnchor.setAttribute('data-path', collapsedPath)
  collapsedAnchor.setAttribute('data-document', collapsedUrl)
  collapsedAnchor.setAttribute('href', collapsedHref)
  collapsedItem.append(collapsedAnchor)
  collapsedList.append(collapsedItem)
  collapsed.append(collapsedList)
  collapsedFolder.append(collapsed)
  externalTree.append(collapsedFolder)
  const hiddenExternal = treeLink(externalTree, 'hidden/skip.md')
  const externalFile = treeLink(externalTree, 'human/prefs.md')
  const pending: { url: string; resolve: (value: unknown) => void }[] = []
  const signals: AbortSignal[] = []
  const historyCalls: string[] = []
  const contextView = new Element('a')
  contextView.setAttribute('data-view', 'context')
  const coreView = new Element('a')
  coreView.setAttribute('data-view', 'core')
  const externalView = new Element('a')
  externalView.setAttribute('data-view', 'external')
  const historyView = new Element('a')
  historyView.setAttribute('data-view', 'history')
  vm.runInNewContext(palacePreviewScript(), {
    document: {
      activeElement: null,
      querySelector(selector: string) {
        if (selector.startsWith('#')) return byId.get(selector.slice(1)) ?? null
        if (selector === '[data-palace-commit]') return root
        return null
      },
      querySelectorAll(selector: string) {
        if (selector === '[data-view]') return [contextView, coreView, externalView, historyView]
        return []
      },
      createElement: (tag: string) => new Element(tag),
      createTextNode: (text: string) => new TextNode(text),
    },
    history: {
      replaceState(_state: unknown, _title: string, href: string) {
        historyCalls.push(href)
      },
    },
    fetch: (url: string, init?: { signal?: AbortSignal }) =>
      new Promise((resolve) => {
        if (init?.signal) signals.push(init.signal)
        pending.push({ url, resolve })
      }),
    Element,
    TextEncoder,
    AbortController,
    Array,
    Set,
    JSON,
    Number,
    String,
    RegExp,
    Math,
    Promise,
    Error,
  })
  const click = (target: Element) => {
    for (const fn of browser.listeners.get('click') ?? [])
      fn({
        target,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault() {},
      })
  }
  const payload = (path: string, text: string, placement = 'library') => ({
    ok: true,
    json: async () => ({
      commit,
      path,
      placement,
      group: placement === 'baseline' ? 'baseline' : 'library',
      text,
      returnedBytes: Buffer.byteLength(text),
      truncated: false,
    }),
  })
  assert.equal(pending.length, 0)
  click(linkA)
  click(linkB)
  const later = pending.find((item) => item.url === urlB)
  const earlier = pending.find((item) => item.url === urlA)
  if (!later || !earlier) throw Error('file fetch was not started')
  later.resolve(payload(pathB, 'beta file'))
  await delay(30)
  earlier.resolve(payload(pathA, 'alpha file'))
  await delay(30)
  assert.equal(title.textContent, pathB)
  assert.match(raw.textContent, /beta file/)
  assert.doesNotMatch(raw.textContent, /alpha file/)
  assert.equal(status.textContent, 'Showing the selected memory file.')
  assert.equal(linkB.getAttribute('aria-current'), 'page')
  assert.equal(linkA.getAttribute('aria-current'), null)
  assert.deepEqual(historyCalls, [hrefB])
  historyCalls.length = 0
  click(linkA)
  const tabLate = pending.at(-1)
  const tabSignal = signals.at(-1)
  if (!tabLate || !tabSignal) throw Error('tab race fetch was not started')
  for (const fn of contextView.listeners.get('click') ?? []) fn({ preventDefault() {} })
  assert.equal(tabSignal.aborted, true)
  assert.equal(contextView.getAttribute('aria-current'), 'page')
  tabLate.resolve(payload(pathA, 'stale after tab'))
  await delay(30)
  assert.equal(title.textContent, pathB)
  assert.doesNotMatch(raw.textContent, /stale after tab/)
  assert.equal(linkA.getAttribute('aria-current'), null)
  assert.equal(linkB.getAttribute('aria-current'), 'page')
  assert.deepEqual(historyCalls, [])
  assert.equal(contextView.getAttribute('aria-current'), 'page')
  const clickView = (view: Element) => {
    for (const fn of view.listeners.get('click') ?? []) fn({ preventDefault() {} })
  }
  click(coreFile.anchor)
  const coreOpen = pending.at(-1)
  if (!coreOpen) throw Error('core file fetch was not started')
  coreOpen.resolve(payload('Core.md', 'core body', 'baseline'))
  await delay(30)
  assert.equal(title.textContent, 'Core.md')
  assert.match(meta.textContent, /Baseline prompt/)
  assert.equal(readerMessage.textContent, 'Baseline prompt')
  hiddenExternal.item.hidden = true
  const beforeExternal = pending.length
  clickView(externalView)
  assert.equal(collapsed.open, false)
  assert.equal(pending.length, beforeExternal + 1)
  assert.equal(pending.at(-1)?.url, externalFile.url)
  assert.notEqual(pending.at(-1)?.url, hiddenExternal.url)
  assert.notEqual(pending.at(-1)?.url, collapsedUrl)
  assert.equal(title.textContent, 'Memory file')
  assert.doesNotMatch(meta.textContent, /Baseline prompt/)
  assert.equal(readerMessage.textContent, 'Select a memory file')
  assert.equal(readerStatus.textContent, 'No file loaded')
  pending.at(-1)?.resolve(payload('human/prefs.md', 'external body'))
  await delay(30)
  assert.equal(title.textContent, 'human/prefs.md')
  assert.match(meta.textContent, /On-demand library/)
  assert.doesNotMatch(meta.textContent, /Baseline prompt/)
  assert.equal(readerMessage.textContent, 'On-demand library')
  assert.equal(externalView.getAttribute('aria-current'), 'page')
  assert.equal(coreFile.anchor.getAttribute('aria-current'), null)
  const sameCategory = pending.length
  const historyBefore = historyCalls.length
  clickView(externalView)
  assert.equal(pending.length, sameCategory)
  assert.match(meta.textContent, /On-demand library/)
  clickView(coreView)
  const switchedCore = pending.at(-1)
  const switchedSignal = signals.at(-1)
  if (!switchedCore || !switchedSignal) throw Error('cross-category fetch was not started')
  assert.equal(pending.length, sameCategory + 1)
  assert.equal(switchedCore.url, coreFile.url)
  assert.equal(title.textContent, 'Memory file')
  clickView(historyView)
  assert.equal(switchedSignal.aborted, true)
  switchedCore.resolve(payload('Core.md', 'late core', 'baseline'))
  await delay(30)
  assert.equal(title.textContent, 'Memory file')
  assert.doesNotMatch(meta.textContent, /Baseline prompt/)
  assert.doesNotMatch(raw.textContent, /late core/)
  assert.equal(historyView.getAttribute('aria-current'), 'page')
  assert.equal(coreView.getAttribute('aria-current'), null)
  assert.equal(historyCalls.length, historyBefore)
  assert.equal(historyCalls.at(-1), externalFile.href)
  assert.equal(filter.id, 'memory-filter')
  assert.equal(count.id, 'memory-count')
  assert.equal(meta.id, 'document-meta')
  assert.equal(rendered.id, 'document-rendered')
})

test('corpus pages stay bound to the canonical commit and omit forgotten later paths', async () => {
  const fx = fixture('mahiro-palace-corpus-')
  try {
    const secret = 'SENTINEL_LATER_SECRET\n'
    const initialFiles: Record<string, string> = {
      'Core.md': 'core\n',
      'index.md': 'index\n',
      'notes/v1..v2.md': 'dots\n',
      'n/zzz.md': secret,
    }
    for (let index = 0; index < 40; index += 1)
      initialFiles[`n/f${String(index).padStart(2, '0')}.md`] = `body ${index}\n`
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: () => {},
    })
    const before = await service.palacePreview()
    const tombstone: TombstoneSnapshot = {
      version: 1,
      revision: 'e'.repeat(40),
      paths: ['n/zzz.md'],
      blobs: [localGitBlobId(secret)],
      sources: [],
      digest: '',
    }
    tombstone.digest = tombstoneSnapshotDigest(tombstone)
    await service.importTombstones({
      expectedPolicyRevision: before.publication.forgettingRevision,
      expectedDigest: emptyForgettingMetadata().digest,
      snapshot: tombstone,
    })
    const preview = await service.palacePreview()
    assert.equal(preview.corpus.truncated, true)
    assert.equal(preview.corpus.returned, 32)
    assert.equal(preview.corpus.total, 43)
    const first = await service.palaceCorpusPage({ commit: preview.head, offset: 0 })
    const second = await service.palaceCorpusPage({ commit: preview.head, offset: 32 })
    const paths = [...first.entries, ...second.entries].map((entry) => entry.path)
    assert.equal(new Set(paths).size, paths.length)
    assert.equal(paths.length, preview.corpus.total)
    assert.deepEqual(
      paths.slice(0, preview.corpus.returned),
      preview.corpus.entries.map((entry) => entry.path),
    )
    assert.equal(paths.includes('n/zzz.md'), false)
    assert.equal(paths.includes('notes/v1..v2.md'), true)
    assert.equal(JSON.stringify(second).includes(secret.trim()), false)
    assert.equal(JSON.stringify(first).includes(fx.stateRoot), false)
    assert.ok(first.bytes <= palaceCorpusLimits.maxResponseBytes)
    assert.ok(second.bytes <= palaceCorpusLimits.maxResponseBytes)
    await assert.rejects(
      () => service.palaceCorpusPage({ commit: 'b'.repeat(40), offset: 0 }),
      /Local memory palace stale/,
    )
    const unaligned = await service.palaceCorpusPage({ commit: preview.head, offset: 16 })
    assert.equal(unaligned.offset, 16)
    assert.ok(unaligned.returned > 0 && unaligned.returned <= palaceCorpusLimits.pageSize)
    await assert.rejects(
      () => service.palaceCorpusPage({ commit: preview.head, offset: 64 }),
      /Local memory palace refused/,
    )
    assert.throws(() => parsePalaceCorpusPage({ ...first, text: secret }), /Local memory palace refused/)
    const server = await startPalacePreviewServer({
      snapshot: () => service.palacePreview(),
      document: (request) => service.palaceDocument(request),
      corpus: (request) => service.palaceCorpusPage(request),
    })
    try {
      const page = await responseOf(`${server.url}/corpus/${preview.head}/32`)
      assert.equal(page.status, 200)
      const body = parsePalaceCorpusPage(JSON.parse(page.body))
      assert.equal(
        body.entries.some((entry) => entry.path === 'notes/v1..v2.md'),
        true,
      )
      assert.equal(
        body.entries.some((entry) => entry.path === 'n/zzz.md'),
        false,
      )
      assert.equal(page.body.includes(secret.trim()), false)
      assert.equal(page.body.includes(fx.stateRoot), false)
      assert.ok(Buffer.byteLength(page.body) <= palaceCorpusLimits.maxResponseBytes)
      const stale = await responseOf(`${server.url}/corpus/${'b'.repeat(40)}/0`)
      assert.equal(stale.status, 409)
      assert.equal(stale.body.includes(server.capability), false)
      const unalignedPage = await responseOf(`${server.url}/corpus/${preview.head}/16`)
      assert.equal(unalignedPage.status, 200)
      assert.equal(parsePalaceCorpusPage(JSON.parse(unalignedPage.body)).offset, 16)
      for (const target of [
        `${server.url}/corpus/${preview.head}/4096`,
        `${server.url}/corpus/${preview.head}/32?x=1`,
        `${server.url}/corpus/${preview.head}/%32`,
      ]) {
        const denied = await responseOf(target)
        assert.equal(denied.status, 404, target)
        assert.equal(denied.body.includes(server.capability), false, target)
      }
    } finally {
      await server.close()
    }
  } finally {
    fx.close()
  }
})

test('corpus pagination remains reachable beyond the former 4096-entry ceiling', async () => {
  const offset = 4096
  const page = buildPalaceCorpusPage({
    commit: head,
    offset,
    total: 5000,
    entries: [{ path: 'reference/later.md', kind: 'file', bytes: 5 }],
  })
  assert.equal(page.offset, offset)
  assert.equal(page.truncated, true)
  assert.ok(palaceCorpusLimits.maxOffset > offset)
  const server = await startPalacePreviewServer({
    snapshot: async () => buildPalaceSnapshot(baseFacts()),
    document: async () => coreDocument(),
    corpus: async (request) => {
      assert.deepEqual(request, { kind: 'corpus', commit: head, offset })
      return page
    },
  })
  try {
    const response = await responseOf(`${server.url}/corpus/${head}/${offset}`)
    assert.equal(response.status, 200)
    assert.equal(parsePalaceCorpusPage(JSON.parse(response.body)).offset, offset)
  } finally {
    await server.close()
  }
})

test('close waits for the corpus callback before temporary root cleanup', async () => {
  const snapshot = buildPalaceSnapshot(baseFacts({ corpus: [file('Core.md', 3)] }))
  const page = buildPalaceCorpusPage({
    commit: head,
    offset: 0,
    total: 1,
    entries: [{ path: 'Core.md', kind: 'file', bytes: 3 }],
  })
  let release = () => {}
  let entered = false
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const draining = await startPalacePreviewServer({
    snapshot: async () => snapshot,
    document: async () => coreDocument(),
    corpus: () => {
      entered = true
      return gate.then(() => page)
    },
  })
  const response = responseOf(`${draining.url}/corpus/${head}/0`).catch(() => undefined)
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-palace-corpus-close-'))
  writeFileSync(join(root, 'marker'), 'keep')
  let finished: Promise<void> = Promise.resolve()
  try {
    for (let attempt = 0; attempt < 50 && !entered; attempt += 1) await delay(10)
    assert.equal(entered, true)
    let cleaned = false
    finished = (async () => {
      await draining.close()
      rmSync(root, { recursive: true, force: true })
      cleaned = true
    })()
    await delay(40)
    assert.equal(cleaned, false)
    assert.equal(existsSync(join(root, 'marker')), true)
    release()
    await finished
    assert.equal(cleaned, true)
    await response
  } finally {
    release()
    await finished.catch(() => undefined)
    await draining.close().catch(() => undefined)
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

test('preview server and entrypoint do not import job or extension owners', () => {
  for (const relative of [
    'lib/agent-memory/local/palace.ts',
    'lib/agent-memory/local/palace-document.ts',
    'lib/agent-memory/local/palace-path.ts',
    'lib/agent-memory/local/palace-corpus.ts',
    'lib/agent-memory/local/palace-page.ts',
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
