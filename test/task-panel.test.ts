import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import {
  TaskPanel,
  TaskWidget,
  showTaskWidget,
  type TaskPanelChoice,
} from '../lib/session-work/task-panel.ts'
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

test('read-only widget aligns its heading with other widgets and renders frameless progress', () => {
  const state: TaskState = {
    ...emptyTasks(),
    tasks: [
      task({ id: 'pending', subject: 'Pending step' }),
      task({ id: 'done', subject: 'Finished ภาษาไทย 中文 👩🏽‍💻', status: 'completed' }),
      task({ id: 'active', subject: 'Active step', status: 'in_progress', description: 'Current work' }),
    ],
  }
  const widget = new TaskWidget(state, theme, { truncateToWidth, visibleWidth }, () => true)
  const lines = widget.render(88)
  const text = lines.join('\n')
  assert.doesNotMatch(text, /[┌┐┘│]|└─+┘/)
  assert.match(lines[0]!, /^● Todos \(1\/3\)$/)
  assert.match(lines[1]!, /^ {2}├─ ✓ ~Finished ภาษาไทย 中文 👩🏽‍💻~$/)
  assert.match(text, /● Todos \(1\/3\)/)
  assert.match(text, /✓ ~Finished ภาษาไทย 中文 👩🏽‍💻~/)
  assert.match(text, /◐ Active step \(Current work\)/)
  assert.match(text, /○ Pending step/)
  assert.doesNotMatch(text, /branch-local|not tsk or human acceptance/)
  assert.doesNotMatch(text, /›|↑↓ move|Enter manage|Esc close/)
  const completed = lines.findIndex((line) => line.includes('✓'))
  const active = lines.findIndex((line) => line.includes('◐'))
  const pending = lines.findIndex((line) => line.includes('○ Pending'))
  assert.ok(completed < active && active < pending)
  assert.equal(active, completed + 1, 'completed and open rows remain connected')
  for (const width of [1, 2, 11, 12, 24, 36, 40, 60, 80, 88, 120, 160]) {
    const rows = widget.render(width)
    for (const line of rows) {
      assert.ok(visibleWidth(line) <= (width >= 12 ? width - 1 : width), `${width}: overflow`)
    }
    assert.doesNotMatch(rows.join('\n'), /[┌┐┘│]|└─+┘|branch-local|not tsk or human acceptance/)
  }
})

test('widget connects completed rows to the final open row even when completed items overflow', () => {
  const state: TaskState = {
    ...emptyTasks(),
    tasks: [
      ...Array.from({ length: 3 }, (_, index) =>
        task({ id: `done-${index}`, subject: `Done ${index}`, status: 'completed' }),
      ),
      task({ id: 'active', subject: 'Active', status: 'in_progress' }),
    ],
  }
  const lines = new TaskWidget(state, theme, { truncateToWidth, visibleWidth }, () => true).render(88)
  const first = lines.findIndex((line) => line.includes('✓'))
  assert.match(lines[first]!, /├─.*✓/)
  assert.match(lines[first + 1]!, /├─.*✓/)
  assert.match(lines[first + 2]!, /└─.*◐ Active/)
  assert.match(lines[first + 3]!, /1 completed/)
})

test('widget bounds completed and open previews, preserves active visibility and guards retired views', () => {
  let current = true
  const state: TaskState = {
    ...emptyTasks(),
    tasks: [
      ...Array.from({ length: 8 }, (_, index) =>
        task({ id: `done-${index}`, subject: `Done ${index}`, status: 'completed' }),
      ),
      task({ id: 'active', subject: 'Active \u001b[31munsafe\u001b[0m', status: 'in_progress' }),
      ...Array.from({ length: 6 }, (_, index) =>
        task({ id: `pending-${index}`, subject: `Pending ${index}` }),
      ),
    ],
  }
  const widget = new TaskWidget(state, theme, { truncateToWidth, visibleWidth }, () => current)
  const lines = widget.render(100)
  const text = lines.join('\n')
  assert.match(text, /● Todos \(8\/15\)/)
  assert.equal(lines.filter((line) => line.includes('✓')).length, 2)
  assert.equal(lines.filter((line) => line.includes('◐') || line.includes('○ Pending')).length, 3)
  assert.match(text, /6 completed · 4 more · \/mh-todos/)
  assert.match(text, /◐ Active unsafe/)
  assert.doesNotMatch(text, /\u001b/)
  assert.ok(lines.length <= 14, 'the persistent card stays compact')
  const compact = new TaskWidget(
    { ...state, config: { ...state.config, view: 'compact' } },
    theme,
    { truncateToWidth, visibleWidth },
    () => true,
  )
  assert.ok(compact.render(36).length <= 14, 'compact view also leaves room for the editor')
  current = false
  assert.deepEqual(widget.render(100), [])
  current = true
  widget.invalidate()
  assert.match(widget.render(100).join('\n'), /Active unsafe/)
  assert.deepEqual(
    new TaskWidget(
      { ...state, config: { ...state.config, view: 'off' } },
      theme,
      { truncateToWidth, visibleWidth },
      () => true,
    ).render(100),
    [],
  )
  assert.deepEqual(
    new TaskWidget(
      { ...state, tasks: state.tasks.filter((item) => item.status === 'completed') },
      theme,
      { truncateToWidth, visibleWidth },
      () => true,
    ).render(100),
    [],
  )
})

test('styled completed rows do not leak strikethrough past a truncated widget or card boundary', () => {
  const ansiTheme = {
    fg: (_tone: string, text: string) => `\x1b[38;2;31;52;73m${text}\x1b[39m`,
    strikethrough: (text: string) => `\x1b[9m${text}\x1b[29m`,
  } as unknown as Theme
  const state: TaskState = {
    ...emptyTasks(),
    tasks: [
      task({ id: 'done', subject: 'เสร็จแล้ว 中文 👩🏽‍💻 '.repeat(20), status: 'completed' }),
      task({ id: 'active', subject: 'กำลังทำ', status: 'in_progress' }),
    ],
  }
  const widget = new TaskWidget(state, ansiTheme, { truncateToWidth, visibleWidth }, () => true)
  const dialog = new TaskPanel({
    state,
    tui: { requestRender() {} },
    theme: ansiTheme,
    keys: { matches: (data, action) => data === action },
    done() {},
    geometry: { truncateToWidth, visibleWidth },
  })
  for (const width of [12, 24, 48, 120]) {
    const widgetLines = widget.render(width)
    assert.ok(widgetLines.every((line) => visibleWidth(line) <= width - 1))
    assert.doesNotMatch(stripTerminalSequences(widgetLines.join('\n')), /[┌┐┘│]|└─+┘/)
    let widgetStrike = false
    for (const match of widgetLines[1]!.matchAll(/\x1b\[([\d;]*)m/g)) {
      for (const code of (match[1] || '0').split(';').map(Number)) {
        if (code === 0 || code === 29) widgetStrike = false
        else if (code === 9) widgetStrike = true
      }
    }
    assert.equal(widgetStrike, false, `strikethrough leaked past widget truncation at width ${width}`)

    const lines = dialog.render(width)
    assert.ok(lines.every((line) => visibleWidth(line) === width))
    const completed = lines[2]!
    assert.ok(stripTerminalSequences(completed).endsWith('│'))
    let strike = false
    const beforeBorder = completed.slice(0, completed.lastIndexOf('│'))
    for (const match of beforeBorder.matchAll(/\x1b\[([\d;]*)m/g)) {
      for (const code of (match[1] || '0').split(';').map(Number)) {
        if (code === 0 || code === 29) strike = false
        else if (code === 9) strike = true
      }
    }
    assert.equal(strike, false, `strikethrough reached right border at width ${width}`)
  }
})

test('a retired asynchronous widget publication cannot replace or resurrect the current view', async () => {
  const state = { ...emptyTasks(), tasks: [task({ id: 'open', subject: 'Open' })] }
  const published: Array<{ key: string; content: unknown }> = []
  const ctx = {
    hasUI: true,
    mode: 'tui',
    ui: { setWidget: (key: string, content: unknown) => published.push({ key, content }) },
  } as unknown as ExtensionContext
  let oldCurrent = true
  let newCurrent = true
  const old = showTaskWidget(ctx, state, () => oldCurrent)
  oldCurrent = false
  await showTaskWidget(ctx, state, () => newCurrent)
  await old
  assert.equal(published.length, 1, 'the retired publisher must not replace the new widget')
  const factory = published[0]!.content as (_tui: unknown, selectedTheme: Theme) => TaskWidget
  const component = factory({}, theme)
  assert.ok(component.render(80).length)
  newCurrent = false
  assert.deepEqual(component.render(80), [], 'retired factories cannot show old tasks')

  for (const endState of [
    { ...state, config: { ...state.config, view: 'off' as const } },
    { ...state, tasks: [task({ id: 'done', subject: 'Done', status: 'completed' })] },
  ]) {
    published.length = 0
    let stillCurrent = true
    const pending = showTaskWidget(ctx, state, () => stillCurrent)
    stillCurrent = false
    await showTaskWidget(ctx, endState, () => true)
    await pending
    assert.deepEqual(published, [{ key: 'mahiro-session-tasks', content: undefined }])
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
