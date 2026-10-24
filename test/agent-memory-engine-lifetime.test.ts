import assert from 'node:assert/strict'
import test from 'node:test'
import { MemoryLifetime } from '../lib/agent-memory/engine/lifetime.ts'
import { startGitMutation } from '../lib/agent-memory/engine/native-git.ts'
import { selectMemoryLease } from '../lib/guards/memory-lease.ts'

// These are resolver/join/OS-start units, not substitutes for canonical SDK authority proof.
test('isolated lease resolver returns exact unique record, never first equal value; strict ABI2 identity', () => {
  const generation = {}
  const value = {}
  const record = { type: 'managed-memory-writer', status: 'running', outputFile: '/owned/worker-a' }
  const real = {
    ownerId: 'parent',
    generation,
    root: '/owned/root',
    version: 2,
    jobId: 'a',
    value,
    active: (): unknown => true,
    service: { getRecord: () => record },
  }
  const expected = {
    ownerId: 'parent',
    generation,
    root: '/owned/root',
    version: 2 as const,
    outputFile: record.outputFile,
  }
  for (const invalid of [
    { ownerId: 'foreign' },
    { generation: {} },
    { root: '/other' },
    { version: 1 },
    { active: () => false },
    { active: () => Promise.resolve(true) },
    { active: () => 1 },
    { service: { getRecord: () => undefined } },
    { service: { getRecord: () => ({ ...record, outputFile: '/owned/worker-b' }) } },
    { service: { getRecord: () => ({ ...record, status: 'completed' }) } },
    { service: { getRecord: () => ({ ...record, type: 'other-role' }) } },
  ]) {
    const decoy = { ...real, ...invalid }
    assert.equal(selectMemoryLease([decoy, real], expected), real)
    assert.throws(() => selectMemoryLease([decoy], expected), /binding/)
  }
  assert.throws(
    () => selectMemoryLease([real, { ...real }], expected),
    /binding/,
    'two matching records are ambiguous even with identical value',
  )
  assert.equal(
    selectMemoryLease([{ ...real, version: 1, active: () => 1 }], { ...expected, version: 1 }).value,
    value,
    'legacy truthy liveness semantics remain ABI1 only',
  )
})
test('parent join reserves before invoking work and joins nested adoption, including rejection', async () => {
  const lifetime = new MemoryLifetime()
  let release!: () => void
  let nestedRelease!: () => void
  let done = false
  const first = lifetime.track(async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    void lifetime
      .track(async () => {
        await new Promise<void>((resolve) => {
          nestedRelease = resolve
        })
        throw Error('expected fenced continuation')
      })
      .catch(() => {})
  })
  const drain = lifetime.drain().then(() => {
    done = true
  })
  await Promise.resolve()
  assert.equal(done, false)
  release()
  await first
  assert.equal(done, false)
  nestedRelease()
  await drain
  assert.equal(done, true)
  await assert.rejects(
    lifetime.track(() => {
      throw Error('synchronous start failure')
    }),
    /start failure/,
  )
  await lifetime.drain()
})

test('native mutating Git distinguishes actual spawn failure and drains its close event', async () => {
  const native = startGitMutation('/nonexistent-mahiro-owned-fixture', ['add', '--', 'Core.md'], { PATH: '' })
  assert.equal(native.started, false)
  await assert.rejects(native.completed, /ENOENT/)
})
