import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { LocalRepairRequest, SyntheticLocalInjection } from '../lib/agent-memory/local/contracts.ts'
import {
  emptyForgettingMetadata,
  localGitBlobId,
  tombstoneSnapshotDigest,
} from '../lib/agent-memory/local/forgetting.ts'
import { parseJob } from '../lib/agent-memory/local/jobs.ts'
import { renderPalacePage } from '../lib/agent-memory/local/palace-page.ts'
import { createSyntheticLocalMemoryService } from '../lib/agent-memory/local/service.ts'
import type { SyntheticPublicEntry } from '../lib/agent-memory/local/trajectory.ts'

const initialFiles = { 'Core.md': 'base\n', 'index.md': 'index\n', 'note.md': 'note\n' }
const identity = { sessionId: 'synthetic', branchId: 'branch' }
const entries: SyntheticPublicEntry[] = [
  {
    ...identity,
    entryId: 'entry-1',
    order: 1,
    role: 'assistant',
    text: 'synthetic learning',
    timestamp: '2026-10-30T00:00:00Z',
  },
]

function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-local-repair-'))
  const stateRoot = join(dir, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const git = (args: string[], input?: string) =>
    execFileSync(
      'git',
      [
        '--git-dir',
        join(stateRoot, 'canonical.git'),
        '-c',
        `core.hooksPath=${join(stateRoot, 'empty-hooks')}`,
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
      { encoding: 'utf8', input },
    ).trim()
  const open = (injection?: SyntheticLocalInjection) =>
    createSyntheticLocalMemoryService({
      stateRoot,
      initialFiles,
      injection,
      worker: (ctx) => {
        ctx.write('Core.md', 'worker\n')
        ctx.write('worker-only.md', 'keep worker\n')
      },
      trajectory: {
        policy: 'step-count',
        stepCount: 1,
        maintenance: ({ workspace }) => {
          workspace.write('Core.md', 'worker\n')
        },
      },
    })
  const moveMain = (body: string) => {
    const main = git(['rev-parse', 'main'])
    const blob = git(['hash-object', '-w', '--stdin'], body)
    const tree = git(
      ['mktree'],
      [
        `100644 blob ${blob}\tCore.md`,
        ...git(['ls-tree', main])
          .split('\n')
          .filter((line) => !line.endsWith('\tCore.md')),
      ].join('\n') + '\n',
    )
    const commit = git(['commit-tree', tree, '-p', main, '-m', 'synthetic parent edit'])
    git(['update-ref', 'refs/heads/main', commit, main])
    return commit
  }
  const conflict = async (reflection = false, injection?: SyntheticLocalInjection) => {
    const service = await open(injection)
    const job = reflection
      ? (await service.reflect({ ...identity, entries })).job!
      : await service.enqueue({ id: 'conflict', summary: 'synthetic conflict' })
    await service.start(job.id)
    const expectedHead = moveMain('parent\n')
    const blocked = await service.integrate(job.id)
    assert.equal(blocked.status, 'repair-needed')
    const request: LocalRepairRequest = {
      id: job.id,
      expectedHead,
      workerCommit: blocked.workerCommit!,
      resolutions: { 'Core.md': 'reviewed\n' },
    }
    return { service, blocked, request }
  }
  return {
    dir,
    stateRoot,
    git,
    open,
    moveMain,
    conflict,
    close: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function retained(
  before: Awaited<ReturnType<ReturnType<typeof fixture>['conflict']>>['blocked'],
  after: typeof before,
) {
  for (const key of ['baseHead', 'workerCommit', 'conflictPaths', 'conflictHead', 'reflection'] as const)
    assert.deepEqual(after[key], before[key])
}

test('explicit repair publishes exactly reviewed resolutions and preserves both parents and evidence', async () => {
  const fx = fixture()
  try {
    const { service, blocked, request } = await fx.conflict()
    const repaired = await service.repair(request)
    assert.equal(repaired.status, 'repaired')
    retained(blocked, repaired)
    assert.equal(repaired.pendingIntegration, null)
    assert.equal(repaired.expectedParent, null)
    assert.equal(await service.head(), repaired.integratedCommit)
    assert.equal(await service.readCommitted('Core.md'), 'reviewed\n')
    assert.equal(await service.readCommitted('worker-only.md'), 'keep worker\n')
    assert.equal(await service.readCommitted('note.md'), 'note\n')
    assert.equal(
      fx.git(['show', '-s', '--format=%P', repaired.integratedCommit!]),
      `${request.expectedHead} ${request.workerCommit}`,
    )
    const restarted = await fx.open()
    assert.deepEqual(await restarted.repair(request), repaired)
    assert.deepEqual(await restarted.integrate(request.id), repaired)
    assert.deepEqual(await restarted.resume(request.id), repaired)
    await assert.rejects(() => restarted.retry(request.id), /trajectory refused/)
    await assert.rejects(() => restarted.abandon(request.id), /abandonment refused/)
    const snapshot = await restarted.palacePreview()
    const palaceJob = snapshot.jobs.entries[0]
    assert.equal(palaceJob.status, 'repaired')
    assert.equal(palaceJob.conflictHead, blocked.conflictHead)
    assert.equal(palaceJob.reviewedHead, request.expectedHead)
    assert.equal(palaceJob.repairCandidate, repaired.integratedCommit)
    assert.equal(palaceJob.guidance, 'repaired-unconsumed')
    assert.equal(palaceJob.retry, 'refused')
    assert.equal(snapshot.conflicts.entries[0].path, 'Core.md')
    const html = renderPalacePage({ state: 'snapshot', snapshot, reloadPath: '/preview' })
    assert.match(html, /Repaired/)
    assert.match(html, /trajectory progress did not advance/)
  } finally {
    fx.close()
  }
})

test('repair preserves compatibility with a legacy Core-only seed', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles: { 'Core.md': 'base\n' },
      worker: (ctx) => ctx.write('Core.md', 'worker\n'),
    })
    await service.enqueue({ id: 'legacy', summary: 'repair legacy core' })
    const committed = await service.start('legacy')
    const expectedHead = fx.moveMain('parent\n')
    const blocked = await service.integrate('legacy')
    assert.equal(blocked.status, 'repair-needed')
    const repaired = await service.repair({
      id: 'legacy',
      expectedHead,
      workerCommit: committed.workerCommit!,
      resolutions: { 'Core.md': 'reviewed legacy\n' },
    })
    assert.equal(repaired.status, 'repaired')
    assert.equal(await service.readCommitted('Core.md'), 'reviewed legacy\n')
    assert.equal(fx.git(['ls-tree', 'main', '--', 'index.md']), '')
  } finally {
    fx.close()
  }
})

test('repair refuses a worker-side deletion of a protected file present in the reviewed head', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService({
      stateRoot: fx.stateRoot,
      initialFiles,
      worker: () => {
        throw Error('ordinary worker must not run')
      },
      trajectory: {
        policy: 'step-count',
        stepCount: 1,
        maintenance: ({ workspace }) => {
          workspace.write('Core.md', 'worker\n')
          workspace.delete('index.md')
        },
      },
    })
    const job = (await service.reflect({ ...identity, entries })).job!
    await service.start(job.id)
    const expectedHead = fx.moveMain('parent\n')
    const blocked = await service.integrate(job.id)
    assert.equal(blocked.status, 'repair-needed')
    await assert.rejects(
      () =>
        service.repair({
          id: job.id,
          expectedHead,
          workerCommit: blocked.workerCommit!,
          resolutions: { 'Core.md': 'reviewed\n' },
        }),
      /repair refused/,
    )
    assert.equal(await service.head(), expectedHead)
    assert.equal(await service.readCommitted('index.md'), 'index\n')
    assert.deepEqual(await service.job(job.id), blocked)
    assert.equal((await service.watermark(identity)).order, 0)
  } finally {
    fx.close()
  }
})

test('stale, malformed, missing, extra, protected deletion and oversized resolutions fail without evidence loss', async () => {
  const fx = fixture()
  try {
    const { service, blocked, request } = await fx.conflict(true)
    const invalid: LocalRepairRequest[] = [
      { ...request, expectedHead: blocked.baseHead },
      { ...request, workerCommit: blocked.baseHead },
      { ...request, resolutions: {} },
      { ...request, resolutions: { ...request.resolutions, 'extra.md': 'extra' } },
      { ...request, resolutions: { '../Core.md': 'bad' } },
      { ...request, resolutions: { 'Core.md': null } },
      { ...request, resolutions: { 'Core.md': '\0bad' } },
      { ...request, resolutions: { 'Core.md': '\ud800' } },
      { ...request, resolutions: { 'Core.md': 'x'.repeat(262145) } },
      { ...request, resolutions: [] } as unknown as LocalRepairRequest,
      { ...request, resolutions: { 'Core.md': 1 } } as unknown as LocalRepairRequest,
    ]
    for (const input of invalid) {
      await assert.rejects(() => service.repair(input), /refused/)
      assert.deepEqual(await service.job(blocked.id), blocked)
      assert.equal(await service.head(), request.expectedHead)
      assert.equal((await service.watermark(identity)).order, 0)
    }
    // New head must itself be explicitly reviewed; old head cannot silently publish.
    const next = fx.moveMain('later parent\n')
    await assert.rejects(() => service.repair(request), /repair refused/)
    const saved = await service.repair({ ...request, expectedHead: next })
    retained(blocked, saved)
    assert.equal(saved.repair?.reviewedHead, next)
    assert.equal((await service.watermark(identity)).order, 0)
  } finally {
    fx.close()
  }
})

for (const stopAfter of ['repair-prepared', 'repair-published', 'repair-terminal'] as const) {
  test(`repair restart is exact and idempotent after ${stopAfter}`, async () => {
    const fx = fixture()
    try {
      const { service, blocked, request } = await fx.conflict(true, { stopAfter })
      await assert.rejects(() => service.repair(request), /repair interrupted/)
      const interrupted = await service.job(request.id)
      const candidate = interrupted.repair!.candidate
      assert.equal(interrupted.status, stopAfter === 'repair-terminal' ? 'repaired' : 'repair-needed')
      assert.equal(await service.head(), stopAfter === 'repair-prepared' ? request.expectedHead : candidate)
      assert.equal((await service.watermark(identity)).order, 0)
      const restarted = await fx.open()
      if (stopAfter !== 'repair-terminal') {
        await assert.rejects(() => restarted.abandon(request.id), /abandonment refused/)
        await assert.rejects(
          () => restarted.repair({ ...request, resolutions: { 'Core.md': 'other\n' } }),
          /repair refused/,
        )
      }
      const repaired = await restarted.repair(request)
      assert.equal(repaired.status, 'repaired')
      assert.equal(repaired.integratedCommit, candidate)
      retained(blocked, repaired)
      assert.equal((await restarted.watermark(identity)).order, 0)
      assert.deepEqual(await restarted.repair(request), repaired)
      await assert.rejects(() => restarted.retry(request.id), /trajectory refused/)
      const fresh = await restarted.reflect({ ...identity, entries })
      assert.equal(fresh.action, 'queued')
      assert.notEqual(fresh.job!.id, request.id)
      assert.equal(fresh.range!.afterOrder, 0)
    } finally {
      fx.close()
    }
  })
}

test('abandon is idempotent, retains conflict evidence, advances nothing and releases only a covered range', async () => {
  const fx = fixture()
  try {
    const { service, blocked, request } = await fx.conflict(true)
    const abandoned = await service.abandon(request.id)
    assert.equal(abandoned.status, 'abandoned')
    retained(blocked, abandoned)
    assert.equal(await service.head(), request.expectedHead)
    assert.equal((await service.watermark(identity)).order, 0)
    const restarted = await fx.open()
    assert.deepEqual(await restarted.abandon(request.id), abandoned)
    assert.deepEqual(await restarted.resume(request.id), abandoned)
    await assert.rejects(() => restarted.retry(request.id), /trajectory refused/)
    await assert.rejects(() => restarted.repair(request), /repair refused/)
    await assert.rejects(() => restarted.reflect({ ...identity, entries: [] }), /trajectory refused/)
    await assert.rejects(
      () => restarted.reflect({ ...identity, entries: [{ ...entries[0], text: 'changed' }] }),
      /trajectory refused/,
    )
    const snapshot = await restarted.palacePreview()
    assert.equal(snapshot.jobs.entries[0].guidance, 'abandoned-unconsumed')
    assert.equal(snapshot.jobs.entries[0].detached, true)
    assert.deepEqual(snapshot.history.detached, [
      {
        jobId: request.id,
        sequence: abandoned.sequence,
        role: 'detached-commit',
        oid: abandoned.workerCommit,
      },
    ])
    assert.deepEqual(
      snapshot.conflicts.entries.map((entry) => entry.path),
      ['Core.md'],
    )
    const fresh = await restarted.reflect({ ...identity, entries })
    assert.equal(fresh.action, 'queued')
    assert.notEqual(fresh.job!.id, request.id)
    assert.equal(fresh.range!.digest, blocked.reflection!.digest)
    assert.equal((await restarted.watermark(identity)).order, 0)
  } finally {
    fx.close()
  }
})

test('legacy conflict records parse without inventing the historical head; pending publication refuses abandonment', async () => {
  const fx = fixture()
  try {
    const { service, blocked, request } = await fx.conflict()
    const { conflictHead: _head, repair: _repair, ...legacy } = blocked
    const parsed = parseJob(legacy, { id: blocked.id, stateRoot: fx.stateRoot })
    assert.equal(parsed.conflictHead, null)
    assert.equal(parsed.repair, null)
    const path = join(fx.stateRoot, 'jobs', `${blocked.id}.json`)
    writeFileSync(
      path,
      JSON.stringify({
        ...legacy,
        pendingIntegration: request.workerCommit,
        expectedParent: request.expectedHead,
      }),
    )
    await assert.rejects(() => service.abandon(request.id), /abandonment refused/)
    await assert.rejects(() => service.repair(request), /repair refused/)
    assert.equal(await service.head(), request.expectedHead)
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).status, 'repair-needed')
  } finally {
    fx.close()
  }
})

test('repair refuses forgotten resolution bytes', async () => {
  const fx = fixture()
  try {
    const { service, request } = await fx.conflict(true)
    const body = {
      version: 1 as const,
      revision: 'a'.repeat(40),
      paths: [],
      blobs: [localGitBlobId('forbidden\n')],
      sources: [],
    }
    const empty = emptyForgettingMetadata()
    await service.importTombstones({
      expectedPolicyRevision: empty.policyRevision,
      expectedDigest: empty.digest,
      snapshot: { ...body, digest: tombstoneSnapshotDigest(body) },
    })
    await assert.rejects(
      () => service.repair({ ...request, resolutions: { 'Core.md': 'forbidden\n' } }),
      /repair refused/,
    )
    assert.equal((await service.watermark(identity)).order, 0)
    assert.equal((await service.repair(request)).status, 'repaired')
  } finally {
    fx.close()
  }
})

for (const boundary of ['policy', 'head'] as const) {
  test(`prepared repair refuses changed ${boundary} and retains ambiguous publication evidence`, async () => {
    const fx = fixture()
    try {
      const { service, request } = await fx.conflict(true, { stopAfter: 'repair-prepared' })
      await assert.rejects(() => service.repair(request), /repair interrupted/)
      const prepared = await service.job(request.id)
      const restarted = await fx.open()
      if (boundary === 'policy') {
        const body = {
          version: 1 as const,
          revision: 'a'.repeat(40),
          paths: [],
          blobs: [localGitBlobId('reviewed\n')],
          sources: [],
        }
        const empty = emptyForgettingMetadata()
        await restarted.importTombstones({
          expectedPolicyRevision: empty.policyRevision,
          expectedDigest: empty.digest,
          snapshot: { ...body, digest: tombstoneSnapshotDigest(body) },
        })
      } else fx.moveMain('new unreviewed parent\n')
      const head = await restarted.head()
      await assert.rejects(() => restarted.repair(request), /repair refused/)
      await assert.rejects(() => restarted.abandon(request.id), /abandonment refused/)
      await restarted.enqueue({ id: 'blocked', summary: 'must wait for publication outcome' })
      await assert.rejects(() => restarted.start('blocked'), /job in flight/)
      assert.deepEqual(await restarted.job(request.id), prepared)
      assert.equal(await restarted.head(), head)
      assert.equal((await restarted.watermark(identity)).order, 0)
    } finally {
      fx.close()
    }
  })
}
