import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createSyntheticLocalMemoryService } from '../lib/agent-memory/local/service.ts'
import {
  selectTrajectoryRange,
  type SyntheticPublicEntry,
  type TrajectoryRole,
} from '../lib/agent-memory/local/trajectory.ts'

const identity = { sessionId: 'synthetic', branchId: 'branch' }
function row(
  order: number,
  role: TrajectoryRole = 'assistant',
  text = 'synthetic row',
): SyntheticPublicEntry {
  return {
    ...identity,
    entryId: `entry-${order}`,
    order,
    role,
    text,
    timestamp: `${new Date(Date.parse('2026-10-29T00:00:00Z') + order * 1000).toISOString().slice(0, 19)}Z`,
  }
}

async function fixture(stepCount: number, maintenance = () => {}) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-r3-'))
  try {
    mkdirSync(join(dir, 'state'), { mode: 0o700 })
    const service = await createSyntheticLocalMemoryService({
      stateRoot: join(dir, 'state'),
      initialFiles: { 'Core.md': 'synthetic\n' },
      worker: () => {
        throw Error('ordinary worker must not run')
      },
      trajectory: { policy: 'step-count', stepCount, maintenance },
    })
    return { service, close: () => rmSync(dir, { recursive: true, force: true }) }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

test('25 finalized assistant steps trigger bounded draining of only the captured prefix', async () => {
  const fx = await fixture(25)
  try {
    const entries = Array.from({ length: 75 }, (_, index) =>
      row(index + 1, (['user', 'assistant', 'tool'] as const)[index % 3]),
    )
    const before = await fx.service.reflect({ ...identity, entries: entries.slice(0, 73) })
    assert.equal(before.reason, 'below-threshold')
    assert.deepEqual(before.progress, {
      observedEntryCount: 73,
      pendingAssistantStepCount: 24,
      settledOrder: 0,
      configuredThreshold: 25,
      capturedEntryCount: 0,
    })
    const first = await fx.service.reflect({ ...identity, entries })
    assert.equal(first.action, 'queued')
    assert.equal(first.progress.capturedEntryCount, 75)
    assert.equal(first.progress.pendingAssistantStepCount, 25)
    const late = [...entries, row(76, 'user'), row(77)]
    let current = first
    let settled = 0
    let chunks = 0
    while (current.job && current.range) {
      assert.equal(current.action, 'queued')
      assert.ok(current.range.entryCount <= 8)
      assert.ok(current.range.byteCount <= 1024)
      assert.equal(current.range.afterOrder, settled)
      const held = await fx.service.reflect({ ...identity, entries: late })
      assert.equal(held.range?.digest, current.range.digest)
      assert.equal(held.job?.id, current.job.id)
      assert.equal((await fx.service.start(current.job.id)).status, 'noop')
      settled = current.range.endOrder
      assert.equal((await fx.service.watermark(identity)).order, settled)
      chunks += 1
      current = await fx.service.reflect({ ...identity, entries: late })
    }
    assert.equal(chunks, 10)
    assert.equal(settled, 75)
    assert.equal(current.reason, 'below-threshold')
    assert.equal(current.progress.pendingAssistantStepCount, 1)
    assert.equal(current.progress.observedEntryCount, 77)
    assert.equal(current.progress.settledOrder, 75)
    assert.equal(current.progress.capturedEntryCount, 0)
    const replay = await fx.service.reflect({
      ...identity,
      entries: late,
      replay: { jobId: first.job!.id, digest: first.range!.digest },
    })
    assert.equal(replay.reason, 'consumed')
    assert.equal((await fx.service.watermark(identity)).order, 75)
  } finally {
    fx.close()
  }
})

test('held and failed snapshots tolerate late tails but reject captured prefix changes; retry is explicit', async () => {
  let fail = true
  const fx = await fixture(1, () => {
    if (fail) throw Error('synthetic failure')
  })
  try {
    const entries = Array.from({ length: 12 }, (_, index) => row(index + 1))
    const first = await fx.service.reflect({ ...identity, entries })
    assert.ok(first.job && first.range)
    const late = [...entries, row(13)]
    await assert.rejects(() => fx.service.start(first.job!.id), /synthetic failure/)
    const held = await fx.service.reflect({ ...identity, entries: late })
    assert.equal(held.job?.status, 'failed')
    assert.equal(held.range?.digest, first.range.digest)
    assert.equal((await fx.service.watermark(identity)).order, 0)
    for (const changed of [
      late.filter((entry) => entry.order !== 10),
      late.map((entry) => (entry.order === 10 ? { ...entry, entryId: 'inserted' } : entry)),
      late.map((entry) => (entry.order === 1 ? { ...entry, text: 'rewritten' } : entry)),
      [late[1]!, late[0]!, ...late.slice(2)],
    ])
      await assert.rejects(() => fx.service.reflect({ ...identity, entries: changed }), /trajectory refused/)
    await assert.rejects(
      () =>
        fx.service.reflect({
          ...identity,
          entries: late,
          replay: { jobId: first.job!.id, digest: '0'.repeat(64) },
        }),
      /trajectory refused/,
    )
    fail = false
    await fx.service.retry(first.job.id)
    assert.equal((await fx.service.watermark(identity)).order, 0)
    assert.equal((await fx.service.start(first.job.id)).status, 'noop')
    assert.equal((await fx.service.watermark(identity)).order, 8)
    const replay = await fx.service.reflect({
      ...identity,
      entries: late,
      replay: { jobId: first.job.id, digest: first.range.digest },
    })
    assert.equal(replay.reason, 'consumed')
    assert.equal((await fx.service.watermark(identity)).order, 8)
  } finally {
    fx.close()
  }
})

test('secret scanning precedes UTF-8 truncation and shares the legacy truncated flag', () => {
  const raw = `${'ก'.repeat(200)} password=synthetic-placeholder`
  const projection = selectTrajectoryRange(
    [row(1, 'assistant', raw), row(2, 'tool', 'ก'.repeat(200))],
    0,
    null,
  )!
  assert.equal(projection.entries[0]?.text, '[Secret-bearing entry withheld]')
  assert.equal(projection.entries[0]?.truncated, true)
  assert.equal(projection.entries[1]?.truncated, true)
  assert.ok(Buffer.byteLength(projection.entries[1]!.text) <= 256)
  assert.equal(projection.entries[1]?.text.includes('�'), false)
  assert.equal(projection.truncatedEntryCount, 2)
  assert.equal(
    projection.entries.some((entry) => entry.text.includes('password=')),
    false,
  )
})
