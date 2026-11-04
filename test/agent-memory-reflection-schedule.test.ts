import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assistantReflectionSteps,
  completeReflectionDelivery,
  createReflectionWindow,
  initialReflectionRetryDelayMs,
  isReflectionRetryDeferred,
  maxReflectionRetryDelayMs,
  nextReflectionDelivery,
  openReflectionBacklog,
  openReflectionDrain,
  recordFinalizedAssistantWork,
  recordReflectionRetryOutcome,
  reflectionBacklogLimit,
  reflectionDeliveryLimit,
  resetReflectionWindow,
  stopReflectionDrain,
} from '../lib/agent-memory/reflection-schedule.ts'

const fill = (window: ReturnType<typeof createReflectionWindow>, events: number[]) => {
  let crossed = false
  for (const [index, count] of events.entries())
    crossed = recordFinalizedAssistantWork(window, 'project', `episode-${index}`, count)
  return crossed
}

test('reflection schedule counts assistant events and freezes backlog without a moving tail', () => {
  assert.equal(assistantReflectionSteps, 25)
  assert.equal(reflectionDeliveryLimit, 32)
  assert.equal(reflectionBacklogLimit, 32)
  const window = createReflectionWindow()
  assert.equal(fill(window, [5, 5, 5, 5, 4]), false)
  assert.equal(window.steps, 24)
  assert.equal(recordFinalizedAssistantWork(window, 'project', 'episode-5', 1), true)
  assert.equal(window.steps, 25)
  const opened = openReflectionDrain(window, ['compaction', 'older'])
  const drainId = window.drain?.id
  assert.equal(typeof drainId, 'number')
  assert.deepEqual(opened, [
    'compaction',
    'older',
    'episode-0',
    'episode-1',
    'episode-2',
    'episode-3',
    'episode-4',
    'episode-5',
  ])
  assert.equal(window.steps, 25)
  assert.equal(recordFinalizedAssistantWork(window, 'project', 'late', 1), false)
  assert.equal(window.drain?.ids.includes('late'), false)
  assert.deepEqual(window.pendingIds, ['late'])
  const reviewed = opened.slice(0, 2)
  const second = completeReflectionDelivery(window, drainId ?? 0, opened, reviewed)
  assert.deepEqual(reviewed, ['compaction', 'older'])
  assert.deepEqual(second, [])
  assert.equal(window.drain, null)
  assert.equal(window.steps, 1)
  const stale = drainId ?? 0
  assert.equal(stopReflectionDrain(window, stale), false)
  for (let index = 0; index < 24; index++)
    recordFinalizedAssistantWork(window, 'project', `fresh-${index}`, 1)
  const replacement = openReflectionDrain(window, [])
  const currentDrain = window.drain as { id: number } | null
  const replacementId = currentDrain?.id
  assert.equal(replacement.length, 25)
  assert.notEqual(replacementId, stale)
  assert.equal(stopReflectionDrain(window, stale), false)
  assert.equal(currentDrain?.id, replacementId)
  assert.equal(replacement.includes('episode-5'), false)
  assert.deepEqual(nextReflectionDelivery(window), replacement)
})

test('reflection schedule cancellation drops only the named drain', () => {
  const window = createReflectionWindow()
  assert.equal(fill(window, [5, 5, 5, 5, 5]), true)
  const opened = openReflectionDrain(window, [])
  const drainId = window.drain?.id ?? 0
  assert.equal(opened.length, 5)
  assert.equal(window.drain?.ids.length, 5)
  assert.equal(stopReflectionDrain(window, drainId), true)
  assert.deepEqual(nextReflectionDelivery(window), [])
  assert.equal(recordFinalizedAssistantWork(window, 'project', 'fresh', 1), false)
  assert.deepEqual(window.pendingIds, ['fresh'])
  assert.equal(window.steps, 1)
})

test('reflection schedule backlog recovery does not count old ids as assistant steps', () => {
  const window = createReflectionWindow()
  recordFinalizedAssistantWork(window, 'project', 'recent', 4)
  const opened = openReflectionBacklog(window, 'project', ['old-compaction', 'recent', 'stranded'])
  assert.deepEqual(opened, ['old-compaction', 'stranded'])
  assert.equal(window.steps, 4)
  assert.deepEqual(window.pendingIds, ['recent'])
  assert.equal(window.drain?.ids.includes('old-compaction'), true)
  const drainId = window.drain?.id ?? 0
  assert.deepEqual(completeReflectionDelivery(window, drainId, opened, ['old-compaction']), [])
  assert.equal(window.drain, null)
  assert.equal(window.steps, 4)
})

test('reflection schedule reset drops the in-memory window without inventing steps', () => {
  const window = createReflectionWindow()
  assert.equal(fill(window, [5, 5, 5, 5, 5]), true)
  openReflectionDrain(window, ['prior'])
  resetReflectionWindow(window)
  assert.equal(window.steps, 0)
  assert.equal(window.drain, null)
  assert.deepEqual(window.pendingIds, [])
  assert.equal(recordFinalizedAssistantWork(window, 'project', 'later', 24), false)
  assert.equal(window.steps, 24)
})

test('reflection schedule keeps prototype names as ordinary project and episode ids', () => {
  const window = createReflectionWindow()
  assert.equal(recordFinalizedAssistantWork(window, 'constructor', 'constructor', 25), true)
  assert.deepEqual(openReflectionDrain(window, []), ['constructor'])
  assert.equal(Object.hasOwn(window, 'constructor'), false)
})

test('reflection retry backoff doubles from 60s to 30m and clears on success or reset', () => {
  const window = createReflectionWindow()
  const base = 1_000_000
  assert.equal(initialReflectionRetryDelayMs, 60_000)
  assert.equal(maxReflectionRetryDelayMs, 30 * 60_000)
  assert.equal(isReflectionRetryDeferred(window, base), false)

  recordReflectionRetryOutcome(window, false, base)
  assert.equal(window.retryDelayMs, 60_000)
  assert.equal(isReflectionRetryDeferred(window, base + 59_999), true)
  assert.equal(isReflectionRetryDeferred(window, base + 60_000), false)

  recordReflectionRetryOutcome(window, false, base + 60_000)
  assert.equal(window.retryDelayMs, 120_000)
  assert.equal(isReflectionRetryDeferred(window, base + 179_999), true)
  assert.equal(isReflectionRetryDeferred(window, base + 180_000), false)

  for (let i = 0; i < 10; i++) recordReflectionRetryOutcome(window, false, base)
  assert.equal(window.retryDelayMs, maxReflectionRetryDelayMs)

  recordReflectionRetryOutcome(window, true, base)
  assert.equal(window.retryDelayMs, 0)
  assert.equal(isReflectionRetryDeferred(window, base), false)
})
