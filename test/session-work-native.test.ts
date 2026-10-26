import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Task } from '../lib/session-work/task-model.ts'
import { QUEUE_MESSAGE, queueStatus } from '../lib/session-work/queue-model.ts'
import { sessionWorkFixture } from './session-work-fixture.ts'

const idOf = (value: Record<string, unknown>) => {
  assert.equal(typeof value.id, 'string')
  return value.id as string
}
const tasksOf = (value: Record<string, unknown>) => {
  assert.ok(Array.isArray(value.tasks))
  return value.tasks as Task[]
}

for (const action of ['cancel', 'save'] as const)
  test(`SIMULATED HOST UI: staging ${action} preserves public Editor text/caret and fixture images`, async () => {
    const f = await sessionWorkFixture()
    try {
      const draft = 'DRAFT_ASCII_TAIL'
      const positionBeforeTail = () => {
        f.composerEditor.setText(draft)
        for (let i = 0; i < 4; i++) f.composerEditor.handleInput('\x1b[D')
      }
      // Cheap positive control proves public left-arrow + insertion works first.
      positionBeforeTail()
      f.composerEditor.handleInput('X')
      assert.equal(f.composerEditor.getText(), 'DRAFT_ASCII_XTAIL')
      positionBeforeTail()
      const composer = structuredClone(f.composer)
      const current = f.current()
      current.queue.stage(
        current.ctx,
        'staged original',
        [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
        'steer',
      )
      const before = current.queue.view(current.ctx)
      const row = structuredClone(before.state.rows[0])
      assert.ok(row)
      f.modalKeys.push(['\x1b[200~_MODAL_EDIT\x1b[201~', action === 'save' ? '\x13' : '\x1b'])
      await f.command('mh-queue', [row.id, 'Edit text'])
      const after = current.queue.view(current.ctx)
      assert.equal(after.entries.length, before.entries.length + (action === 'save' ? 1 : 0))
      assert.equal(after.state.rows[0]?.text, row.text + (action === 'save' ? '_MODAL_EDIT' : ''))
      assert.deepEqual(after.state.rows[0]?.images, row.images)
      assert.deepEqual(
        f.composer,
        composer,
        'Core composer image fixture remains intact, not OS clipboard proof',
      )
      assert.equal(f.composerEditor.getText(), draft, 'close must preserve composer text')
      f.composerEditor.handleInput(`${action.toUpperCase()}_OK_`)
      assert.equal(
        f.composerEditor.getText(),
        `DRAFT_ASCII_${action.toUpperCase()}_OK_TAIL`,
        'post-close insertion must remain before TAIL, not at end after host setText restore',
      )
      assert.deepEqual(
        f.customCloses,
        ['overlay-hide'],
        'public overlay option bypasses host setText restore',
      )
      assert.equal(f.composerTouches, 0, 'product never calls composer get/set/replacement APIs')
      assert.deepEqual(f.errors, [])
    } finally {
      await f.dispose()
    }
  })

test('actual in-memory manager reload preserves branch journal with fresh factories and no session file', async () => {
  const f = await sessionWorkFixture({ memory: true })
  try {
    const task = await f.invoke('mh_task_create', { subject: 'in-memory journal step' })
    const beforeTasks = tasksOf(await f.invoke('mh_task_list'))
    const old = f.current()
    old.queue.stage(
      old.ctx,
      'in-memory row',
      [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
      'steer',
    )
    let view = old.queue.view(old.ctx)
    const row = view.state.rows[0]
    assert.ok(row)
    old.queue.change(old.ctx, { kind: 'attempt', id: row.id, attemptId: 'memory-unconfirmed' }, view.ticket)
    view = old.queue.view(old.ctx)
    const beforeQueue = structuredClone(view.state)
    const journalIds = view.entries.filter((entry) => entry.type === 'custom').map((entry) => entry.id)
    const manager = f.runtime.session.sessionManager
    const factories = f.factories
    assert.equal(manager.isPersisted(), false)
    assert.equal(manager.getSessionFile(), undefined)
    assert.equal(f.runtime.session.sessionFile, undefined)
    await f.runtime.session.reload()
    assert.equal(f.runtime.session.sessionManager, manager)
    assert.ok(f.factories > factories, 'real reload creates fresh extension factories')
    assert.equal(manager.isPersisted(), false)
    assert.equal(manager.getSessionFile(), undefined)
    assert.equal(f.runtime.session.sessionFile, undefined)
    assert.deepEqual(tasksOf(await f.invoke('mh_task_list')), beforeTasks)
    assert.equal(idOf(task), beforeTasks[0]?.id)
    const fresh = f.current()
    const after = fresh.queue.view(fresh.ctx)
    assert.deepEqual(after.state, beforeQueue)
    assert.deepEqual(
      after.entries.filter((entry) => entry.type === 'custom').map((entry) => entry.id),
      journalIds,
    )
    assert.equal(queueStatus(after.state.rows[0]!, after.receipts), 'unconfirmed')
    assert.throws(() => old.queue.view(old.ctx), /retired/)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('actual fork cutoff excludes later task/stage/attempt operations and child changes leave parent intact', async () => {
  const f = await sessionWorkFixture()
  try {
    const task = await f.invoke('mh_task_create', { subject: 'before cutoff' })
    const id = idOf(task)
    let current = f.current()
    current.queue.stage(
      current.ctx,
      'before cutoff row',
      [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
      'followUp',
    )
    const originalRow = structuredClone(current.queue.view(current.ctx).state.rows[0])
    assert.ok(originalRow)
    await f.textTurn('FORK CUTOFF before excluded operations')
    const cutoff = f.runtime.session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === 'message' && entry.message.role === 'user')
      .at(-1)
    assert.ok(cutoff)
    await f.invoke('mh_task_update', { id, expected_revision: 1, status: 'completed' })
    const later = await f.invoke('mh_task_create', { subject: 'excluded later task' })
    current.queue.stage(current.ctx, 'excluded later staging', [], 'steer')
    const beforeAttempt = current.queue.view(current.ctx)
    current.queue.change(
      current.ctx,
      { kind: 'attempt', id: originalRow.id, attemptId: 'excluded-later-attempt' },
      beforeAttempt.ticket,
    )
    const parentTasks = tasksOf(await f.invoke('mh_task_list'))
    const parentQueue = structuredClone(current.queue.view(current.ctx).state)
    const parentPath = f.runtime.session.sessionFile
    const parentManager = f.runtime.session.sessionManager
    assert.ok(parentPath)
    await f.runtime.fork(cutoff.id, { position: 'at' })
    assert.notEqual(f.runtime.session.sessionManager, parentManager)
    const forkTasks = tasksOf(await f.invoke('mh_task_list'))
    assert.equal(forkTasks.length, 1)
    assert.equal(forkTasks[0]?.id, id)
    assert.equal(forkTasks[0]?.revision, 1)
    assert.equal(forkTasks[0]?.status, 'pending')
    assert.equal(
      forkTasks.some((step) => step.id === idOf(later)),
      false,
    )
    current = f.current()
    const forkQueue = current.queue.view(current.ctx)
    assert.deepEqual(forkQueue.state.rows, [originalRow])
    assert.equal(forkQueue.state.rows[0]?.attemptId, undefined)
    assert.equal(JSON.stringify(forkQueue.entries).includes('excluded-later-attempt'), false)
    assert.equal(JSON.stringify(forkQueue.entries).includes('excluded later staging'), false)
    await f.invoke('mh_task_update', { id, expected_revision: 1, subject: 'child-only change' })
    current.queue.change(
      current.ctx,
      { kind: 'edit', id: originalRow.id, text: 'child-only row edit' },
      current.queue.view(current.ctx).ticket,
    )
    await f.runtime.switchSession(parentPath)
    assert.deepEqual(tasksOf(await f.invoke('mh_task_list')), parentTasks)
    current = f.current()
    assert.deepEqual(current.queue.view(current.ctx).state, parentQueue)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('pending public handoff selector rejects intervening journal revision before confirmed send', async () => {
  const f = await sessionWorkFixture()
  try {
    const composer = structuredClone(f.composer)
    const current = f.current()
    current.queue.stage(
      current.ctx,
      'original staged text',
      [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
      'steer',
    )
    const row = current.queue.view(current.ctx).state.rows[0]
    assert.ok(row)
    const held = f.holdUI('select', 'Hand off once')
    const pending = f.command('mh-queue', [row.id, 'Hand off once'])
    await held.entered
    current.queue.change(
      current.ctx,
      { kind: 'edit', id: row.id, text: 'newer authoritative text' },
      current.queue.view(current.ctx).ticket,
    )
    const expected = structuredClone(current.queue.view(current.ctx).state)
    const entriesBeforeSave = current.queue.view(current.ctx).entries.length
    held.release()
    await pending
    assert.deepEqual(current.queue.view(current.ctx).state, expected)
    assert.equal(f.confirmationCalls, 1, 'actual scripted public confirmation ran after stale selection')
    assert.equal(
      current.queue.view(current.ctx).entries.length,
      entriesBeforeSave,
      'stale save appends nothing',
    )
    assert.deepEqual(expected.rows[0]?.images, row.images)
    assert.equal(expected.rows[0]?.attemptId, undefined)
    assert.ok(f.notices.some((notice) => /changed or retired/.test(notice)))
    assert.equal(
      current.queue
        .view(current.ctx)
        .entries.some((entry) => entry.type === 'custom_message' && entry.customType === QUEUE_MESSAGE),
      false,
    )
    assert.deepEqual(f.composer, composer)
    assert.equal(f.composerTouches, 0)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('pending public editor save rejects actual same-manager reload with no write/send or stale UI error', async () => {
  const f = await sessionWorkFixture()
  try {
    const composer = structuredClone(f.composer)
    const old = f.current()
    old.queue.stage(
      old.ctx,
      'do not send after reload',
      [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
      'followUp',
    )
    const before = old.queue.view(old.ctx)
    const row = before.state.rows[0]
    assert.ok(row)
    const expected = structuredClone(before.state)
    f.modalKeys.push(['\x1b[200~ stale reload edit\x1b[201~', '\x13'])
    const held = f.holdUI('editor')
    const pending = f.command('mh-queue', [row.id, 'Edit text'])
    await held.entered
    const manager = f.runtime.session.sessionManager
    const factories = f.factories
    await f.runtime.session.reload()
    assert.equal(f.runtime.session.sessionManager, manager)
    assert.ok(f.factories > factories)
    const fresh = f.current()
    const entriesBeforeConfirm = fresh.queue.view(fresh.ctx).entries.length
    held.release()
    await pending
    const after = fresh.queue.view(fresh.ctx)
    assert.deepEqual(after.state, expected)
    assert.equal(after.entries.length, entriesBeforeConfirm, 'retired command appends no attempt')
    assert.equal(after.state.rows[0]?.attemptId, undefined)
    assert.equal(
      after.entries.some((entry) => entry.type === 'custom_message' && entry.customType === QUEUE_MESSAGE),
      false,
    )
    assert.throws(() => old.queue.view(old.ctx), /retired/)
    assert.deepEqual(f.composer, composer)
    assert.equal(f.composerTouches, 0)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('pending task text save after actual reload preserves task/queue/composer and avoids retired UI notification', async () => {
  const f = await sessionWorkFixture()
  try {
    const composer = structuredClone(f.composer)
    const created = await f.invoke('mh_task_create', {
      subject: 'original task title',
      description: 'original description',
    })
    const beforeTasks = tasksOf(await f.invoke('mh_task_list'))
    const old = f.current()
    old.queue.stage(
      old.ctx,
      'untouched row',
      [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
      'steer',
    )
    const expectedQueue = structuredClone(old.queue.view(old.ctx).state)
    f.inputs.push('stale saved title', 'stale saved description')
    const held = f.holdUI('input', 'stale saved description')
    const pending = f.command('mh-tasks', [idOf(created), 'Edit text'])
    await held.entered
    const manager = f.runtime.session.sessionManager
    const factories = f.factories
    await f.runtime.session.reload()
    assert.equal(f.runtime.session.sessionManager, manager)
    assert.ok(f.factories > factories)
    const fresh = f.current()
    const entriesBeforeSave = fresh.queue.view(fresh.ctx).entries.length
    held.release()
    await pending
    const after = fresh.queue.view(fresh.ctx)
    assert.equal(after.entries.length, entriesBeforeSave, 'stale task save appends nothing')
    assert.deepEqual(after.state, expectedQueue)
    assert.equal(
      after.entries.some((entry) => entry.type === 'custom_message' && entry.customType === QUEUE_MESSAGE),
      false,
    )
    assert.deepEqual(tasksOf(await f.invoke('mh_task_list')), beforeTasks)
    assert.equal(f.inputs.length, 0, 'both public task text inputs were consumed')
    assert.deepEqual(f.composer, composer)
    assert.equal(f.composerTouches, 0)
    assert.deepEqual(f.errors, [])
    await f.command('mh-tasks', [idOf(created), 'Dependencies', 'Done'])
    assert.deepEqual(tasksOf(await f.invoke('mh_task_list')), beforeTasks)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('task panel targets the requested row and toggles dependencies without manual ID entry', async () => {
  const f = await sessionWorkFixture()
  try {
    const first = await f.invoke('mh_task_create', { subject: 'First selectable step' })
    const second = await f.invoke('mh_task_create', { subject: 'Second selectable step' })
    const firstId = idOf(first)
    const secondId = idOf(second)
    await f.command('mh-tasks', [secondId, 'Dependencies', `○ ${firstId}`, 'Done'])
    assert.deepEqual((await f.invoke('mh_task_get', { id: secondId })).blockedBy, [firstId])
    assert.deepEqual((await f.invoke('mh_task_get', { id: firstId })).blockedBy, [])
    await f.command('mh-tasks', [secondId, 'Dependencies', `✓ ${firstId}`, 'Done'])
    assert.deepEqual((await f.invoke('mh_task_get', { id: secondId })).blockedBy, [])
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('real SDK core CRUD, revision/dependencies and branch-local reload/fork/resume/new', async () => {
  const f = await sessionWorkFixture()
  try {
    assert.deepEqual(f.runtime.session.getActiveToolNames().sort(), [
      'mh_task_create',
      'mh_task_get',
      'mh_task_list',
      'mh_task_update',
    ])
    const a = await f.invoke('mh_task_create', {
        subject: 'A ภาษาไทย 👩‍👩‍👧‍👦',
        metadata: { keep: 'one', drop: 'two' },
      }),
      id = idOf(a)
    const b = await f.invoke('mh_task_create', { subject: 'B dependent' }),
      bid = idOf(b)
    await f.invoke('mh_task_update', { id: bid, expected_revision: 1, blockedBy: [id] })
    const started = await f.invoke('mh_task_update', { id: bid, expected_revision: 2, status: 'in_progress' })
    assert.match(String(started.warning), /Manual start/)
    await f.invoke('mh_task_update', {
      id,
      expected_revision: 1,
      status: 'completed',
      metadata: { drop: null },
      owner: 'fixture',
    })
    await f.invoke('mh_task_update', { id, expected_revision: 1, subject: 'stale overwrite' }, true)
    assert.deepEqual((await f.invoke('mh_task_get', { id })).metadata, { keep: 'one' })
    const before = tasksOf(await f.invoke('mh_task_list'))
    const parentPath = f.runtime.session.sessionFile
    assert.ok(parentPath)
    const manager = f.runtime.session.sessionManager,
      generation = f.factories
    await f.runtime.session.reload()
    assert.equal(f.runtime.session.sessionManager, manager)
    assert.ok(f.factories > generation)
    assert.deepEqual(tasksOf(await f.invoke('mh_task_list')), before)
    const entry = f.runtime.session.sessionManager
      .getBranch()
      .filter((e) => e.type === 'message' && e.message.role === 'user')
      .at(-1)
    assert.ok(entry)
    await f.runtime.fork(entry.id, { position: 'at' })
    assert.notEqual(f.runtime.session.sessionManager, manager)
    assert.deepEqual(
      tasksOf(await f.invoke('mh_task_list')),
      before,
      'actual fork inherits branch journal without seeding',
    )
    await f.invoke('mh_task_update', { id, expected_revision: 2, status: 'pending' })
    await f.invoke('mh_task_update', { id, expected_revision: 3, delete: true })
    assert.deepEqual((await f.invoke('mh_task_get', { id: bid })).blockedBy, [])
    await f.runtime.switchSession(parentPath)
    assert.deepEqual(tasksOf(await f.invoke('mh_task_list')), before, 'parent independent of fork edits')
    await f.runtime.newSession()
    assert.deepEqual(tasksOf(await f.invoke('mh_task_list')), [])
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('real SDK commands, transient reminders, never/four-native-turn retention and immediate new batch', async () => {
  const f = await sessionWorkFixture()
  try {
    const first = await f.invoke('mh_task_create', { subject: 'retention never' }),
      id = idOf(first)
    await f.invoke('mh_task_update', { id, expected_revision: 1, status: 'completed' })
    for (let i = 0; i < 5; i++) await f.textTurn()
    assert.equal(tasksOf(await f.invoke('mh_task_list')).length, 1)
    f.inputs.push('manual title')
    await f.command('mh-todos', ['Create step'])
    const crossAlias = tasksOf(await f.invoke('mh_task_list'))
    assert.equal(crossAlias.length, 2)
    const manual = crossAlias.find((task) => task.subject === 'manual title')
    assert.ok(manual)
    await f.command('mh-tasks', [manual.id, 'in_progress'])
    assert.equal(
      tasksOf(await f.invoke('mh_task_list')).find((task) => task.id === manual.id)?.status,
      'in_progress',
    )
    await f.command('mh-todos', [manual.id, 'pending'])
    assert.equal(tasksOf(await f.invoke('mh_task_list')).find((task) => task.id === manual.id)?.revision, 3)
    await f.command('mh-tasks', ['Retention', 'four-turns'])
    await f.command('mh-tasks', ['Clear completed'])
    const second = tasksOf(await f.invoke('mh_task_list'))[0]
    assert.ok(second)
    await f.invoke('mh_task_update', {
      id: second.id,
      expected_revision: second.revision,
      status: 'completed',
    })
    // No idle/text prompts between settlement and next explicit create.
    await f.invoke('mh_task_create', { subject: 'immediate settled next batch' })
    let tasks = tasksOf(await f.invoke('mh_task_list'))
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]?.subject, 'immediate settled next batch')
    const next = tasks[0]
    assert.ok(next)
    await f.invoke('mh_task_update', { id: next.id, expected_revision: 1, status: 'completed' })
    // Final post-tool assistant turn counts as the first native turn after completion.
    for (let i = 0; i < 3; i++) await f.textTurn()
    assert.deepEqual(tasksOf(await f.invoke('mh_task_list')), [])
    const reminderTask = await f.invoke('mh_task_create', { subject: 'reminder data <do not execute>' })
    await f.invoke('mh_task_update', { id: idOf(reminderTask), expected_revision: 1, status: 'in_progress' })
    await f.command('mh-tasks', ['Reminders', 'on'])
    let seen = false
    f.faux.setResponses([
      (context) => {
        seen = JSON.stringify(context.messages).includes('Session tracking reminder')
        return f.ai.fauxAssistantMessage('reminder request observed')
      },
    ])
    await f.runtime.session.prompt('next request')
    assert.equal(seen, true)
    assert.equal(
      JSON.stringify(f.runtime.session.sessionManager.getBranch()).includes('Session tracking reminder'),
      false,
      'request-only reminder not journaled',
    )
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('real SDK busy input staging + modal save/cancel preserves images/composer; recorded correlation survives reload/fork', async () => {
  const f = await sessionWorkFixture()
  try {
    const composer = structuredClone(f.composer)
    await f.runtime.session.prompt('/mh-queue capture followUp')
    f.faux.setResponses([
      async () => {
        await f.runtime.session.prompt('stage original ภาษาไทย 中文 👩‍👩‍👧‍👦', {
          streamingBehavior: 'followUp',
          images: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
        })
        // The staging input must not leak into the native follow-up queue.
        assert.equal(f.current().queue.view(f.current().ctx).state.rows.length, 1)
        return f.ai.fauxAssistantMessage('busy response')
      },
    ])
    await f.runtime.session.prompt('begin busy')
    let current = f.current(),
      view = current.queue.view(current.ctx)
    const row = view.state.rows[0]
    assert.ok(row)
    assert.equal(row.images.length, 1)
    assert.equal(
      f.runtime.session.sessionManager
        .getBranch()
        .some(
          (e) =>
            e.type === 'message' &&
            e.message.role === 'user' &&
            JSON.stringify(e.message).includes('stage original'),
        ),
      false,
    )
    f.modalKeys.push(['changed then cancel', '\x1b'])
    await f.command('mh-queue', [row.id, 'Edit text'])
    assert.equal(current.queue.view(current.ctx).state.rows[0]?.text, row.text)
    f.modalKeys.push(['\x1b[200~ appended\x1b[201~', '\x13'])
    await f.command('mh-queue', [row.id, 'Edit text'])
    view = current.queue.view(current.ctx)
    assert.match(view.state.rows[0]?.text ?? '', /appended/)
    assert.deepEqual(view.state.rows[0]?.images, row.images)
    assert.deepEqual(f.composer, composer)
    assert.equal(f.composerTouches, 0)
    const parent = f.runtime.session.sessionFile
    assert.ok(parent)
    await f.runtime.session.reload()
    current = f.current()
    view = current.queue.view(current.ctx)
    assert.deepEqual(view.state.rows[0]?.images, row.images)
    f.faux.setResponses([
      async () => {
        await f.runtime.session.prompt('UNRELATED native pending', {
          streamingBehavior: 'followUp',
          source: 'extension',
        })
        const now = f.current(),
          before = now.queue.view(now.ctx),
          item = before.state.rows[0]
        assert.ok(item)
        now.queue.handoff(now.ctx, item, before.ticket)
        const after = now.queue.view(now.ctx),
          handed = after.state.rows[0]
        assert.ok(handed)
        assert.equal(
          queueStatus(handed, after.receipts),
          'unconfirmed',
          'void send and unrelated pending cannot ack row',
        )
        assert.throws(() => now.queue.handoff(now.ctx, handed, after.ticket), /locked/)
        return f.ai.fauxAssistantMessage('busy initial complete')
      },
      f.ai.fauxAssistantMessage('unrelated pending response'),
      f.ai.fauxAssistantMessage('handed row response'),
    ])
    await f.runtime.session.prompt('second busy')
    current = f.current()
    view = current.queue.view(current.ctx)
    const handed = view.state.rows[0]
    assert.ok(handed)
    assert.equal(queueStatus(handed, view.receipts), 'recorded')
    const receipts = f.runtime.session.sessionManager
      .getBranch()
      .filter((e) => e.type === 'custom_message' && e.customType === QUEUE_MESSAGE)
    assert.equal(receipts.length, 1)
    assert.deepEqual(current.queue.view(current.ctx).state, view.state, 'repeat observations idempotent')
    await f.runtime.session.reload()
    await f.textTurn('no resend after reload')
    current = f.current()
    view = current.queue.view(current.ctx)
    assert.equal(queueStatus(view.state.rows[0]!, view.receipts), 'recorded')
    const entry = f.runtime.session.sessionManager
      .getBranch()
      .filter((e) => e.type === 'message' && e.message.role === 'user')
      .at(-1)
    assert.ok(entry)
    await f.runtime.fork(entry.id, { position: 'at' })
    current = f.current()
    view = current.queue.view(current.ctx)
    assert.equal(queueStatus(view.state.rows[0]!, view.receipts), 'recorded')
    current.queue.change(current.ctx, { kind: 'discard', id: row.id }, view.ticket)
    await f.runtime.switchSession(parent)
    current = f.current()
    assert.equal(current.queue.view(current.ctx).state.rows.length, 1)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('real journal missing receipt stays locked across reload; order/revision/generation conflicts reject', async () => {
  const f = await sessionWorkFixture()
  try {
    const current = f.current()
    current.queue.stage(current.ctx, 'first', [], 'steer')
    current.queue.stage(current.ctx, 'second', [], 'followUp')
    let view = current.queue.view(current.ctx)
    const first = view.state.rows[0],
      second = view.state.rows[1]
    assert.ok(first && second)
    current.queue.stage(current.ctx, 'third same-lane', [], 'steer')
    view = current.queue.view(current.ctx)
    const third = view.state.rows[2]
    assert.ok(third)
    assert.throws(() => current.queue.handoff(current.ctx, third, view.ticket), /first staged row/)
    current.queue.change(current.ctx, { kind: 'move', id: second.id, index: 0, lane: 'steer' }, view.ticket)
    assert.throws(
      () => current.queue.change(current.ctx, { kind: 'edit', id: first.id, text: 'stale' }, view.ticket),
      /changed/,
    )
    view = current.queue.view(current.ctx)
    current.queue.change(
      current.ctx,
      { kind: 'attempt', id: first.id, attemptId: 'intent-without-send' },
      view.ticket,
    )
    const stale = current.queue.view(current.ctx)
    await f.runtime.session.reload()
    assert.throws(
      () => current.queue.change(current.ctx, { kind: 'discard', id: first.id }, stale.ticket),
      /retired/,
    )
    const fresh = f.current(),
      reloaded = fresh.queue.view(fresh.ctx)
    assert.equal(reloaded.state.rows[0]?.id, second.id)
    const retained = reloaded.state.rows.find((r) => r.id === first.id)
    assert.ok(retained)
    assert.equal(queueStatus(retained, reloaded.receipts), 'unconfirmed')
    await f.textTurn('no automatic resend of unknown receipt')
    assert.equal(
      f.runtime.session.sessionManager
        .getBranch()
        .filter((e) => e.type === 'custom_message' && e.customType === QUEUE_MESSAGE).length,
      0,
    )
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('pending-only reminders use actual native non-task turns, suppress repeats and reset on tracking use', async () => {
  const f = await sessionWorkFixture()
  try {
    await f.invoke('mh_task_create', { subject: 'pending-only reminder' })
    await f.command('mh-tasks', ['Reminders', 'on'])
    const observed: boolean[] = []
    const request = async () => {
      f.faux.setResponses([
        (context) => {
          observed.push(JSON.stringify(context.messages).includes('Session tracking reminder'))
          return f.ai.fauxAssistantMessage('ordinary non-task response')
        },
      ])
      await f.runtime.session.prompt('ordinary non-task request')
    }
    for (let i = 0; i < 4; i++) await request()
    assert.deepEqual(observed, [false, false, true, false])
    await f.invoke('mh_task_list')
    await request()
    assert.equal(observed.at(-1), false, 'tracking-tool use resets the reminder gap')
    assert.equal(
      JSON.stringify(f.runtime.session.sessionManager.getBranch()).includes('Session tracking reminder'),
      false,
    )
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('public widget factories bound narrow Thai/CJK/ZWJ rows and respect off/empty views', async () => {
  const f = await sessionWorkFixture()
  try {
    assert.equal(f.widgets.size, 0)
    for (let i = 0; i < 7; i++)
      await f.invoke('mh_task_create', { subject: `ขั้นตอน ${i} 中文 👩‍👩‍👧‍👦 `.repeat(10) })
    await f.command('mh-tasks', ['View mode', 'compact'])
    const tasks = f.widgets.get('mahiro-session-tasks')
    assert.ok(tasks)
    assert.equal(tasks.render(120).length, 7, 'header + five open rows + overflow summary')
    f.current().queue.stage(f.current().ctx, 'คิว 中文 👩‍👩‍👧‍👦 '.repeat(100), [], 'steer')
    await f.runtime.session.prompt('/mh-queue capture off')
    const queue = f.widgets.get('mahiro-session-queue')
    assert.ok(queue)
    for (const width of [1, 2, 12, 24, 48, 80, 120])
      for (const widget of [tasks, queue])
        for (const line of widget.render(width)) assert.ok(f.tui.visibleWidth(line) <= width)
    await f.command('mh-tasks', ['View mode', 'off'])
    assert.equal(f.widgets.has('mahiro-session-tasks'), false)
    assert.equal(f.composerTouches, 0)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('storage failure preserves original busy native input and never sends unrecorded intent', async () => {
  const f = await sessionWorkFixture()
  try {
    await f.runtime.session.prompt('/mh-queue capture followUp')
    f.failAppend = true
    f.faux.setResponses([
      async () => {
        await f.runtime.session.prompt('native fallback after storage failure', {
          streamingBehavior: 'followUp',
        })
        assert.equal(f.current().queue.view(f.current().ctx).state.rows.length, 0)
        return f.ai.fauxAssistantMessage('initial complete')
      },
      f.ai.fauxAssistantMessage('native fallback response'),
    ])
    await f.runtime.session.prompt('begin busy storage failure')
    assert.ok(
      f.notices.some((notice) =>
        /Not staged; original input continues natively: Fixture storage unavailable/.test(notice),
      ),
    )
    assert.ok(
      f.runtime.session.sessionManager
        .getBranch()
        .some(
          (entry) =>
            entry.type === 'message' &&
            entry.message.role === 'user' &&
            JSON.stringify(entry.message).includes('native fallback after storage failure'),
        ),
    )
    assert.deepEqual(f.errors, [])
    f.failAppend = false
    const current = f.current()
    current.queue.stage(current.ctx, 'durable row', [], 'steer')
    const before = current.queue.view(current.ctx)
    f.failAppend = true
    assert.throws(
      () => current.queue.handoff(current.ctx, before.state.rows[0]!, before.ticket),
      /storage unavailable/,
    )
    assert.equal(current.queue.view(current.ctx).state.rows[0]?.attemptId, undefined)
    assert.equal(
      f.runtime.session.sessionManager
        .getBranch()
        .filter((entry) => entry.type === 'custom_message' && entry.customType === QUEUE_MESSAGE).length,
      0,
    )
  } finally {
    await f.dispose()
  }
})
