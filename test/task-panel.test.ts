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
  assert.match(wide, /Session steps \(1\/3\)/)
  assert.match(wide, /◐ Implement task overlay \(Building the first compact native panel\)/)
  assert.match(wide, /! Verify integration \(blocked by 1\)/)
  assert.match(wide, /✓ ~เสร็จแล้ว 中文/)
  assert.match(wide, /compact · keep 4 turns · reminders on/)
  assert.match(wide, /Enter manage · c create/)
  for (const width of [1, 2, 11, 24, 48, 88, 120])
    for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width)
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
