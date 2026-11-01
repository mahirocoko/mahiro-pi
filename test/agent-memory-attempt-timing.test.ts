import assert from 'node:assert/strict'
import test from 'node:test'
import { createAttemptTiming } from '../lib/agent-memory/engine/attempt-timing.ts'

test('attempt clock unions overlaps and freezes terminal metadata', () => {
  let now = 0
  const timing = createAttemptTiming(() => now)
  assert.equal(timing.snapshot(), null)
  timing.observe('start')
  now = 10
  timing.observe('tool-start', 'a')
  now = 20
  timing.observe('tool-start', 'b')
  now = 30
  timing.observe('tool-end', 'a')
  now = 40
  timing.observe('tool-end', 'b')
  now = 50
  timing.freeze()
  const expected = { elapsedMs: 50, observedToolWallMs: 30, unclassifiedMs: 20, complete: true }
  assert.deepEqual(timing.snapshot(), expected)
  now = 100
  timing.observe('tool-start', 'late')
  timing.observe('start')
  assert.deepEqual(timing.snapshot(), expected)
})

for (const mode of ['unpaired', 'duplicate', 'overflow', 'unfinished', 'oversized'] as const)
  test(`attempt timing marks ${mode} incomplete without retaining unbounded identifiers`, () => {
    let now = 0
    const timing = createAttemptTiming(() => now)
    timing.observe('start')
    if (mode === 'unpaired') timing.observe('tool-end', 'unknown')
    if (mode === 'oversized') timing.observe('tool-start', 'x'.repeat(257))
    if (mode === 'duplicate') {
      timing.observe('tool-start', 'a')
      timing.observe('tool-start', 'a')
      timing.observe('tool-end', 'a')
    }
    if (mode === 'overflow') {
      for (let i = 0; i < 1000; i++) timing.observe('tool-start', String(i))
      for (let i = 0; i < 1000; i++) timing.observe('tool-end', String(i))
    }
    if (mode === 'unfinished') timing.observe('tool-start', 'unfinished')
    now = 10
    timing.freeze()
    assert.equal(timing.snapshot()?.complete, false)
    assert.equal(timing.snapshot()?.unclassifiedMs, null)
    const frozen = timing.snapshot()
    now = 20
    timing.observe('tool-end', 'unfinished')
    assert.deepEqual(timing.snapshot(), frozen)
    assert.ok(!JSON.stringify(frozen).includes('unfinished'))
  })
