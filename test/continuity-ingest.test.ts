import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { IImport } from '../lib/continuity/records.ts'
import { createStore } from '../lib/continuity/store.ts'

const policy = { excludedProjectIds: [], excludedPaths: [] }
const lifecycle = { session: 'session', branch: 'main', epoch: 0 }
// Cooperative DTO fixtures, not evidence of live SDK ingestion.
const user = (id: string, text = 'I prefer tea'): IImport => ({
  id,
  sourceKind: 'pi_message',
  projectId: 'pi',
  conversationId: 'session',
  messageId: id,
  message: { message_type: 'user_message', content: text },
})
function fixture() {
  const parent = resolve('.agent-state/runtime/continuity-ingest-tests')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const root = mkdtempSync(join(parent, 'case-'))
  chmodSync(root, 0o700)
  const store = createStore(root, policy)
  store.initialize(lifecycle)
  return {
    root,
    store,
    clean: () => rmSync(root, { recursive: true, force: true }),
  }
}
const files = (root: string) =>
  Object.fromEntries(readdirSync(root).map((name) => [name, readFileSync(join(root, name), 'utf8')]))

test('ingest appends without consuming the archive ordinal; repeats and stale forks fail safely', () => {
  const f = fixture()
  try {
    const before = f.store.snapshot()
    const inputs = [user('a')]
    const original = structuredClone(inputs)
    const next = f.store.ingest(before, inputs)
    assert.equal(next.revision, 1)
    assert.equal(next.cursor, 0)
    assert.deepEqual(inputs, original)
    assert.equal(f.store.read('a', { projectId: 'pi' })?.text, 'I prefer tea')
    const disk = files(f.root)
    f.store.ingest(next, inputs)
    assert.deepEqual(files(f.root), disk)
    assert.throws(() => f.store.ingest(before, []), /Stale/)
    assert.throws(() => f.store.ingest({ ...next, lifecycle: { ...lifecycle, branch: 'fork' } }, []), /Stale/)
    f.store.changeLifecycle(next, { ...lifecycle, epoch: 1 })
    assert.throws(() => f.store.ingest(next, inputs), /Stale/)
    const reviewed = f.store.markReviewed(f.store.snapshot(), 1)
    assert.equal(reviewed.cursor, 1)
    assert.equal(reviewed.revision, 3)
  } finally {
    f.clean()
  }
})

test('same-text metadata conflicts and intra-batch conflicts cause no writes', () => {
  const f = fixture()
  try {
    f.store.ingest(f.store.snapshot(), [user('a')])
    const disk = files(f.root)
    for (const input of [
      { ...user('a'), projectId: 'other' },
      { ...user('a'), conversationId: 'other' },
      { ...user('a'), messageId: 'other' },
      user('a', 'I prefer coffee'),
      {
        ...user('a'),
        message: { message_type: 'toolMessage', content: 'different payload' },
      },
    ]) {
      assert.throws(() => f.store.ingest(f.store.snapshot(), [user('b'), input]), /Conflicting/)
      assert.deepEqual(files(f.root), disk)
    }
    assert.throws(
      () => f.store.ingest(f.store.snapshot(), [user('b'), { ...user('b'), projectId: 'other' }]),
      /Conflicting/,
    )
    for (const sourceKind of ['letta_message', 'letta_memory', 'synthetic', 'unknown'])
      assert.throws(
        () => f.store.ingest(f.store.snapshot(), [{ ...user('b'), sourceKind } as IImport]),
        /Invalid ingestion source/,
      )
    assert.deepEqual(files(f.root), disk)
  } finally {
    f.clean()
  }
})

test('privacy, wrappers and tool payloads cannot persist canaries or grow rejection logs', () => {
  const f = fixture()
  try {
    const canary = 'INGEST_CANARY_94370'
    const inputs: IImport[] = [
      user('secret', `password=${canary}`),
      user('wrapper', `<system-reminder>${canary}</system-reminder>`),
      user('unknown', `<future_event>${canary}</future_event>`),
      {
        ...user('tool'),
        message: { message_type: 'toolMessage', content: canary },
      },
      {
        ...user('helper'),
        message: {
          message_type: 'assistant_message',
          content: [{ type: 'toolCall', arguments: canary }],
        },
      },
    ]
    const before = files(f.root)
    f.store.ingest(f.store.snapshot(), inputs)
    f.store.ingest(f.store.snapshot(), inputs)
    assert.deepEqual(files(f.root), before)
    f.store.ingest(f.store.snapshot(), [
      user('safe', `<system-reminder>${canary}</system-reminder>I prefer tea`),
      ...inputs,
    ])
    assert.equal(f.store.read('safe', { projectId: 'pi' })?.text, 'I prefer tea')
    assert.ok(!JSON.stringify(files(f.root)).includes(canary))
  } finally {
    f.clean()
  }
})

test('read-only construction and failed pointer commits leave cursor and pointer intact', () => {
  const f = fixture()
  try {
    f.store.ingest(f.store.snapshot(), [user('a')])
    const before = files(f.root)
    const readOnly = createStore(f.root, policy, { readOnly: true })
    assert.deepEqual(files(f.root), before)
    assert.throws(() => readOnly.ingest(readOnly.snapshot(), [user('b')]), /Read-only/)
    assert.throws(() => readOnly.markReviewed(readOnly.snapshot(), 1), /Read-only/)
    assert.deepEqual(files(f.root), before)
    const failing = createStore(f.root, policy, {
      beforePointer: () => {
        throw new Error('injected IO failure')
      },
    })
    const snapshot = f.store.snapshot()
    const pointer = readFileSync(join(f.root, 'state.json'), 'utf8')
    assert.throws(() => failing.ingest(snapshot, [user('b')]), /injected IO/)
    assert.throws(() => failing.markReviewed(snapshot, 1), /injected IO/)
    assert.deepEqual(f.store.snapshot(), snapshot)
    assert.equal(readFileSync(join(f.root, 'state.json'), 'utf8'), pointer)
    assert.equal(f.store.read('b', { projectId: 'pi' }), undefined)
  } finally {
    f.clean()
  }
})

test('new evidence supports correction; reviewed-no-facts preserves controls and forgotten facts stay suppressed', () => {
  const f = fixture()
  try {
    f.store.ingest(f.store.snapshot(), [user('a')])
    const snapshot = f.store.snapshot()
    f.store.accept(
      snapshot,
      {
        snapshot,
        cursor: 1,
        notes: [{ id: 'note', recordId: 'a', projectId: 'pi', quote: 'I prefer tea' }],
      },
      'completed',
      ['note'],
    )
    assert.throws(
      () => f.store.correct(f.store.snapshot(), 'note', 'a', 'I prefer coffee'),
      /Invalid correction/,
    )
    f.store.ingest(f.store.snapshot(), [user('b', 'I prefer coffee')])
    assert.equal(f.store.snapshot().cursor, 1)
    f.store.correct(f.store.snapshot(), 'note', 'b', 'I prefer coffee')
    const before = f.store.inspect()
    const archive = JSON.parse(readFileSync(join(f.root, `${before.generation}.json`), 'utf8')).archive
    const disk = files(f.root)
    for (const cursor of [0, 1, 3, -1, 1.5, NaN, Infinity])
      assert.throws(() => f.store.markReviewed(f.store.snapshot(), cursor), /Invalid reflection/)
    assert.deepEqual(files(f.root), disk)
    f.store.markReviewed(f.store.snapshot(), 2)
    const after = f.store.inspect()
    assert.equal(after.revision, before.revision + 1)
    assert.equal(after.cursor, 2)
    assert.notEqual(after.generation, before.generation)
    assert.deepEqual(after.facts, before.facts)
    assert.deepEqual(after.controls, before.controls)
    assert.deepEqual(
      JSON.parse(readFileSync(join(f.root, `${after.generation}.json`), 'utf8')).archive,
      archive,
    )
    assert.throws(() => f.store.markReviewed(before, 2), /Stale/)
    f.store.forget(f.store.snapshot(), ['note'])
    const forgotten = files(f.root)
    f.store.ingest(f.store.snapshot(), [user('a'), user('b', 'I prefer coffee')])
    assert.deepEqual(files(f.root), forgotten)
    assert.deepEqual(f.store.inspect().facts, [])
    assert.equal(f.store.read('a', { projectId: 'pi' }), undefined)
    assert.equal(f.store.read('b', { projectId: 'pi' }), undefined)
  } finally {
    f.clean()
  }
})

test('merged canonical archive retains the existing eight MiB text bound', () => {
  const f = fixture()
  try {
    const store = createStore(join(f.root, 'bounded'), policy)
    const text = 'x'.repeat(65536)
    store.initialize(
      lifecycle,
      Array.from({ length: 127 }, (_, n) => user(`old-${n}`, text)),
    )
    const before = store.snapshot()
    const generation = store.inspect().generation
    assert.throws(
      () => store.ingest(before, [user('new-a', text), user('new-b', text)]),
      /bound|Invalid continuity/,
    )
    assert.deepEqual(store.snapshot(), before)
    assert.equal(store.inspect().generation, generation)
    assert.equal(store.read('new-a', { projectId: 'pi' }), undefined)
  } finally {
    f.clean()
  }
})

test('rollback retains newer DTO sources, facts, archive ordinals and privacy controls across reopen', () => {
  const f = fixture()
  try {
    const store = createStore(join(f.root, 'rollback'), policy)
    store.initialize(lifecycle, [
      {
        ...user('old-a', 'Earlier concrete choice'),
        sourceKind: 'letta_message',
      },
    ])
    let snapshot = store.snapshot()
    store.accept(
      snapshot,
      {
        snapshot,
        cursor: 1,
        notes: [
          {
            id: 'old-note',
            recordId: 'old-a',
            projectId: 'pi',
            quote: 'Earlier concrete choice',
          },
        ],
      },
      'completed',
      ['old-note'],
    )
    const baseline = store.inspect().generation
    // pi_message is a cooperative DTO fixture, not native/live provenance.
    store.ingest(store.snapshot(), [user('native-b', 'New concrete choice')])
    snapshot = store.snapshot()
    store.accept(
      snapshot,
      {
        snapshot,
        cursor: 2,
        notes: [
          {
            id: 'new-note',
            recordId: 'native-b',
            projectId: 'pi',
            quote: 'New concrete choice',
          },
        ],
      },
      'completed',
      ['new-note'],
    )
    store.correct(store.snapshot(), 'old-note', 'native-b', 'concrete choice')
    const controls = store.inspect().controls
    store.rollback(store.snapshot(), baseline)
    const reopened = createStore(join(f.root, 'rollback'), policy)
    assert.equal(reopened.snapshot().cursor, 2)
    assert.deepEqual(reopened.inspect().controls, controls)
    assert.deepEqual(
      reopened
        .inspect()
        .facts.map((fact) => fact.id)
        .sort(),
      ['new-note', 'old-note'],
    )
    assert.equal(reopened.inspect().facts.find((fact) => fact.id === 'old-note')?.quote, 'concrete choice')
    assert.equal(reopened.read('native-b', { projectId: 'pi' })?.text, 'New concrete choice')
    const state = reopened.inspect()
    const archive = JSON.parse(
      readFileSync(join(f.root, 'rollback', `${state.generation}.json`), 'utf8'),
    ).archive
    assert.deepEqual(
      archive.records.map((record: { id: string }) => record.id),
      ['old-a', 'native-b'],
    )
    reopened.forget(reopened.snapshot(), ['old-a'])
    const forgotten = reopened.inspect().controls
    reopened.rollback(reopened.snapshot(), baseline)
    assert.deepEqual(reopened.inspect().controls, forgotten)
    assert.equal(reopened.snapshot().cursor, 2)
    assert.deepEqual(
      reopened.inspect().facts.map((fact) => fact.id),
      ['new-note'],
    )
    assert.equal(reopened.read('old-a', { projectId: 'pi' }), undefined)
    assert.doesNotThrow(() => createStore(join(f.root, 'rollback'), policy).inspect())
  } finally {
    f.clean()
  }
})

test('rollback canonical merge rejects conflicting metadata and combined archive bounds before publication', () => {
  for (const mode of ['metadata', 'bounds']) {
    const f = fixture()
    try {
      const text = 'x'.repeat(65536)
      f.store.ingest(
        f.store.snapshot(),
        mode === 'metadata'
          ? [user('same')]
          : Array.from({ length: 127 }, (_, n) => user(`current-${n}`, text)),
      )
      const targetRoot = join(f.root, 'target')
      const target = createStore(targetRoot, policy)
      target.initialize(
        lifecycle,
        mode === 'metadata'
          ? [{ ...user('same'), conversationId: 'different' }]
          : [user('target-a', text), user('target-b', text)],
      )
      writeFileSync(
        join(f.root, 'historical-target.json'),
        readFileSync(join(targetRoot, `${target.inspect().generation}.json`)),
        { mode: 0o600 },
      )
      const before = f.store.snapshot()
      const disk = filesWithoutDirectories(f.root)
      assert.throws(
        () => f.store.rollback(before, 'historical-target'),
        /Conflicting|bound|Invalid continuity/,
      )
      assert.deepEqual(f.store.snapshot(), before)
      assert.deepEqual(filesWithoutDirectories(f.root), disk)
    } finally {
      f.clean()
    }
  }
})

const filesWithoutDirectories = (root: string) =>
  Object.fromEntries(
    readdirSync(root)
      .filter((name) => name !== 'target')
      .map((name) => [name, readFileSync(join(root, name), 'utf8')]),
  )

test('literal old Memory Markdown and source ordering survive ingestion unchanged', () => {
  const f = fixture()
  try {
    const root = join(f.root, 'memory')
    const store = createStore(root, policy)
    const markdown =
      '<system-reminder>literal documentation</system-reminder>\nconst identity = <T>(value: T) => value'
    store.initialize(lifecycle, [{ id: 'memory', sourceKind: 'letta_memory', projectId: 'pi', markdown }])
    const old = store.read('memory', { projectId: 'pi' })
    store.ingest(store.snapshot(), [user('a'), user('b')])
    assert.deepEqual(store.read('memory', { projectId: 'pi' }), old)
    const state = store.inspect()
    const archive = JSON.parse(readFileSync(join(root, `${state.generation}.json`), 'utf8')).archive
    assert.deepEqual(
      archive.records.map((record: { id: string }) => record.id),
      ['memory', 'a', 'b'],
    )
  } finally {
    f.clean()
  }
})
