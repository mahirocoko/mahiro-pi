import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Theme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { TaskPanel, type TaskPanelChoice } from '../lib/session-work/task-panel.ts'
import { emptyTasks, type Task, type TaskState } from '../lib/session-work/task-model.ts'

const task = (patch: Partial<Task> & Pick<Task, 'id' | 'subject'>): Task => ({
  revision: 1,
  description: '',
  owner: '',
  metadata: {},
  blockedBy: [],
  status: 'pending',
  completedTurn: null,
  ...patch,
})

const theme = {
  fg: (_tone: string, text: string) => text,
  strikethrough: (text: string) => `~${text}~`,
} as unknown as Theme

function panel(state: TaskState) {
  const choices: TaskPanelChoice[] = []
  let renders = 0
  const component = new TaskPanel({
    state,
    tui: { requestRender: () => renders++ },
    theme,
    keys: { matches: (data, action) => data === action },
    done: (choice) => choices.push(choice),
    geometry: { truncateToWidth, visibleWidth },
  })
  return { component, choices, renders: () => renders }
}

test('task panel renders reference-inspired progress, state markers and bounded multilingual rows', () => {
  const state: TaskState = {
    ...emptyTasks(),
    config: { view: 'compact', retention: 'four-turns', reminders: true },
    tasks: [
      task({ id: 'done', subject: 'เสร็จแล้ว 中文 👩‍👩‍👧‍👦', status: 'completed', completedTurn: 1 }),
      task({
        id: 'active',
        subject: 'Implement task overlay',
        status: 'in_progress',
        description: 'Building the first compact native panel',
      }),
      task({ id: 'blocked', subject: 'Verify integration', blockedBy: ['active'] }),
    ],
  }
  const { component } = panel(state)
  const wide = component.render(88).join('\n')
  assert.match(wide, /● Todos \(1\/3\)/)
  assert.match(component.render(88)[0], /^┌─+┐$/)
  assert.match(component.render(88).at(-1)!, /^└─+┘$/)
  assert.match(wide, /◐ Implement task overlay \(Building the first compact native panel\)/)
  assert.match(wide, /○ Verify integration \(blocked by 1\)/)
  assert.match(wide, /✓ ~เสร็จแล้ว 中文/)
  assert.doesNotMatch(wide, /BRANCH JOURNAL/)
  assert.match(wide, /branch-local · not tsk or human acceptance/)
  assert.match(wide, /↑↓ move · Enter manage · Esc close/)
  assert.match(wide, /c new · v view · r retention · m reminders · x clear completed/)
  const rows = component.render(88)
  const completed = rows.findIndex((line) => line.includes('✓'))
  const active = rows.findIndex((line) => line.includes('◐'))
  const pending = rows.findIndex((line) => line.includes('○ Verify'))
  assert.ok(completed < active && active < pending)
  assert.match(rows[completed + 1], /^│ +│$/, 'one breathing-space separator')
  assert.equal(active, completed + 2)
  const narrow = component.render(36).join('\n')
  for (const phrase of [
    'Esc close',
    'v view',
    'r retention',
    'm remind',
    'x clear completed',
    'not tsk',
    'not human acceptance',
  ])
    assert.ok(narrow.includes(phrase), `minimum overlay width: ${phrase}`)
  for (const width of [1, 2, 11, 12, 24, 36, 40, 60, 80, 88, 120, 160]) {
    for (const line of component.render(width)) {
      assert.ok(visibleWidth(line) <= width, `${width}: overflow`)
      if (width >= 12) assert.equal(visibleWidth(line), width, `${width}: right edge aligned`)
      if (line.startsWith('│')) assert.ok(line.endsWith('  │'), 'right inset survives truncation')
    }
  }
})

test('task panel stable completed → active → pending grouping and initial unfinished selection', () => {
  const { component, choices } = panel({
    ...emptyTasks(),
    tasks: [
      task({ id: 'p1', subject: 'Pending first' }),
      task({ id: 'a1', subject: 'Active first', status: 'in_progress' }),
      task({ id: 'd1', subject: 'Done first', status: 'completed' }),
      task({ id: 'p2', subject: 'Pending second' }),
      task({ id: 'd2', subject: 'Done second', status: 'completed' }),
      task({ id: 'a2', subject: 'Active second', status: 'in_progress' }),
    ],
  })
  const rows = component.render(120).filter((line) => line.startsWith('│') && /[├└]─/.test(line))
  const expected = [
    'Done first',
    'Done second',
    'Active first',
    'Active second',
    'Pending first',
    'Pending second',
  ]
  assert.equal(rows.length, expected.length)
  for (const [index, subject] of expected.entries()) assert.ok(rows[index].includes(subject))
  component.handleInput('tui.select.confirm')
  assert.deepEqual(choices, [{ kind: 'task', id: 'a1' }])
  component.handleInput('tui.select.up')
  component.handleInput('tui.select.confirm')
  assert.deepEqual(choices.at(-1), { kind: 'task', id: 'd2' })
})

test('blocked state preserves active/pending lifecycle markers', () => {
  const rendered = panel({
    ...emptyTasks(),
    tasks: [
      task({ id: 'dependency', subject: 'Dependency' }),
      task({
        id: 'blocked-active',
        subject: 'Blocked active',
        status: 'in_progress',
        blockedBy: ['dependency'],
      }),
      task({ id: 'blocked-pending', subject: 'Blocked pending', blockedBy: ['dependency'] }),
    ],
  })
    .component.render(88)
    .join('\n')
  assert.match(rendered, /◐ Blocked active \(blocked by 1\)/)
  assert.match(rendered, /○ Blocked pending \(blocked by 1\)/)
})

test('task panel bounds overflow, keeps selection visible, and renders empty state', () => {
  const empty = panel(emptyTasks()).component.render(60).join('\n')
  assert.match(empty, /● Todos \(0\/0\)/)
  assert.match(empty, /No todos yet/)
  assert.match(empty, /Press c or Enter/)
  assert.match(empty, /Enter create · Esc close/)
  assert.doesNotMatch(empty, /x clear completed/)
  const { component, choices } = panel({
    ...emptyTasks(),
    tasks: Array.from({ length: 24 }, (_, index) =>
      task({
        id: String(index),
        subject: `งานที่ ${index} กำลังตรวจสอบ ภาษาไทย 中文 👩🏽‍💻 👨‍👩‍👧‍👦 `.repeat(4),
      }),
    ),
  })
  for (let step = 0; step < 24; step++) {
    for (const width of [12, 24, 40, 60, 80, 120, 160]) {
      const rows = component.render(width)
      assert.ok(rows.length <= 20, 'bounded overlay height')
      assert.equal(rows.filter((line) => line.startsWith('│') && /[├└]─/.test(line)).length, 7)
      assert.ok(rows.every((line) => visibleWidth(line) === width))
    }
    const rows = component.render(120).join('\n')
    assert.match(rows, new RegExp(`› .*งานที่ ${step} `))
    assert.match(rows, /(?:↑|↓) \d+ more/)
    component.handleInput('tui.select.confirm')
    assert.deepEqual(choices.at(-1), { kind: 'task', id: String(step) })
    component.handleInput('tui.select.down')
  }
})

test('task panel keyboard keeps task selection and direct actions explicit', () => {
  const state: TaskState = {
    ...emptyTasks(),
    tasks: [
      task({ id: 'pending', subject: 'Pending' }),
      task({ id: 'active', subject: 'Active', status: 'in_progress' }),
      task({ id: 'done', subject: 'Done', status: 'completed', completedTurn: 0 }),
    ],
  }
  const taskPanel = panel(state)
  taskPanel.component.handleInput('tui.select.down')
  assert.equal(taskPanel.renders(), 1)
  taskPanel.component.handleInput('tui.select.confirm')
  assert.deepEqual(taskPanel.choices, [{ kind: 'task', id: 'pending' }])

  const createPanel = panel({ ...emptyTasks() })
  createPanel.component.handleInput('tui.select.confirm')
  assert.deepEqual(createPanel.choices, [{ kind: 'create' }])

  const settingsPanel = panel(state)
  for (const shortcut of ['v', 'r', 'm', 'x', 'c', 'tui.select.cancel'])
    settingsPanel.component.handleInput(shortcut)
  assert.deepEqual(settingsPanel.choices, [
    { kind: 'view' },
    { kind: 'retention' },
    { kind: 'reminders' },
    { kind: 'clear-completed' },
    { kind: 'create' },
    { kind: 'cancel' },
  ])
})
