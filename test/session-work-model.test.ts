import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyTasks, reduceTasks, taskProjection, type Task } from '../lib/session-work/task-model.ts'
import {
  emptyQueue,
  reduceQueue,
  queueReceipts,
  queueStatus,
  QUEUE_MESSAGE,
} from '../lib/session-work/queue-model.ts'
import { label } from '../lib/session-work/view.ts'

const task = (id: string, blockedBy: string[] = []): Task => ({
  id,
  revision: 1,
  subject: id,
  description: '',
  owner: '',
  metadata: {},
  blockedBy,
  status: 'pending',
  completedTurn: null,
})

test('task dependency cycles reject without mutating the original; removal cleans reciprocal projections', () => {
  let state = reduceTasks(emptyTasks(), { kind: 'put', task: task('a') })
  state = reduceTasks(state, { kind: 'put', task: task('b', ['a']) })
  const before = structuredClone(state)
  assert.throws(
    () => reduceTasks(state, { kind: 'put', task: { ...task('a', ['b']), revision: 2 } }),
    /cycle/,
  )
  assert.deepEqual(state, before)
  assert.deepEqual(taskProjection(state, state.tasks[0]!).blocks, ['b'])
  const next = reduceTasks(state, { kind: 'delete', id: 'a' })
  assert.deepEqual(next.tasks[0]?.blockedBy, [])
  assert.equal(next.tasks[0]?.revision, 2)
})

test('clear and four-turn expiration clean dependency edges and invalidate affected revisions', () => {
  for (const operation of ['clear', 'expire']) {
    let state = reduceTasks(emptyTasks(), {
      kind: 'put',
      task: { ...task('a'), status: 'completed', completedTurn: 0 },
    })
    state = reduceTasks(state, { kind: 'put', task: task('b', ['a']) })
    if (operation === 'clear') state = reduceTasks(state, { kind: 'clear-completed' })
    else {
      state = reduceTasks(state, { kind: 'config', config: { ...state.config, retention: 'four-turns' } })
      for (let i = 0; i < 3; i++) state = reduceTasks(state, { kind: 'tick' })
      assert.equal(state.tasks.length, 2)
      state = reduceTasks(state, { kind: 'tick' })
    }
    assert.equal(state.tasks.length, 1)
    assert.deepEqual(state.tasks[0]?.blockedBy, [])
    assert.equal(state.tasks[0]?.revision, 2)
  }
})

test('queue edits preserve image object/data without rewriting payload operations; bounds reject atomically', () => {
  const images = [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' }]
  const state = reduceQueue(emptyQueue(), {
    kind: 'stage',
    id: 'row',
    lane: 'followUp',
    text: 'original',
    images,
  })
  const edited = reduceQueue(state, { kind: 'edit', id: 'row', text: 'edited' })
  assert.equal(edited.rows[0]?.images, state.rows[0]?.images)
  assert.equal(edited.imageBytesWritten, state.imageBytesWritten)
  assert.equal(state.rows[0]?.text, 'original')
  assert.throws(
    () =>
      reduceQueue(state, {
        kind: 'stage',
        id: 'big',
        lane: 'steer',
        text: 'big',
        images: [{ ...images[0]!, data: 'A'.repeat(2800001) }],
      }),
    /limit/,
  )
  assert.equal(state.rows.length, 1)
  let full = emptyQueue()
  for (let i = 0; i < 32; i++)
    full = reduceQueue(full, { kind: 'stage', id: String(i), lane: 'steer', text: 'x', images: [] })
  assert.throws(
    () => reduceQueue(full, { kind: 'stage', id: 'overflow', lane: 'steer', text: 'x', images: [] }),
    /full/,
  )
})

test('missing, unrelated, delayed and duplicate native receipts correlate exact row and attempt only', () => {
  let state = reduceQueue(emptyQueue(), { kind: 'stage', id: 'row', lane: 'steer', text: 'text', images: [] })
  state = reduceQueue(state, { kind: 'attempt', id: 'row', attemptId: 'attempt' })
  const row = state.rows[0]!
  const receipt = (rowId: string, attemptId: string) => ({
    type: 'custom_message' as const,
    id: 'native',
    parentId: null,
    timestamp: new Date().toISOString(),
    customType: QUEUE_MESSAGE,
    content: 'text',
    display: true,
    details: { version: 1, rowId, attemptId },
  })
  assert.equal(queueStatus(row, queueReceipts([])), 'unconfirmed')
  assert.equal(
    queueStatus(row, queueReceipts([receipt('other', 'attempt'), receipt('row', 'other')])),
    'unconfirmed',
  )
  assert.equal(queueStatus(row, queueReceipts([receipt('row', 'attempt')])), 'recorded')
  const duplicates = queueReceipts([receipt('row', 'attempt'), receipt('row', 'attempt')])
  assert.equal(duplicates.size, 1)
  assert.equal(queueStatus(row, duplicates), 'recorded')
  assert.throws(() => reduceQueue(state, { kind: 'edit', id: 'row', text: 'retry' }), /locked/)
})

test('labels retain Thai/CJK/ZWJ graphemes, remove terminal controls and bound visible data', () => {
  assert.equal(label('ภาษาไทย 中文 👩‍👩‍👧‍👦'), 'ภาษาไทย 中文 👩‍👩‍👧‍👦')
  assert.equal(label('👩‍👩‍👧‍👦x', 1), '👩‍👩‍👧‍👦')
  assert.equal(label('\x1b[31mred\x1b[0m\ntext'), 'red text')
  assert.equal(
    Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(label('界'.repeat(1000))))
      .length,
    180,
  )
})
