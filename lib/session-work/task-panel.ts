import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import type { Task, TaskState } from './task-model.ts'
import { label } from './view.ts'

export type TaskPanelChoice =
  | { kind: 'cancel' }
  | { kind: 'create' }
  | { kind: 'view' }
  | { kind: 'retention' }
  | { kind: 'reminders' }
  | { kind: 'clear-completed' }
  | { kind: 'task'; id: string }

type Geometry = Pick<typeof import('@earendil-works/pi-tui'), 'truncateToWidth' | 'visibleWidth'>
type TaskPanelTUI = { requestRender(): void }
type TaskPanelKeys = { matches(data: string, action: string): boolean }

const MAX_VISIBLE_TASKS = 7
const statusOrder: Record<Task['status'], number> = { completed: 0, in_progress: 1, pending: 2 }

export function orderedTasks(tasks: readonly Task[]) {
  return [...tasks].sort((a, b) => statusOrder[a.status] - statusOrder[b.status])
}

function shortDetail(task: Task, state: TaskState) {
  const blockers = task.blockedBy.filter(
    (id) => state.tasks.find((candidate) => candidate.id === id)?.status !== 'completed',
  )
  if (blockers.length) return `blocked by ${blockers.length}`
  const description = label(task.description.replace(/\s+/g, ' ').trim(), 42)
  if (task.status === 'in_progress' && description) return description
  if (task.owner) return `owner ${label(task.owner, 24)}`
  return ''
}

function cardFrame(width: number, theme: Theme, geometry: Geometry) {
  const innerWidth = width - 2
  const contentWidth = innerWidth - 4
  const border = (text: string) => theme.fg('borderMuted', text)
  const line = (text = '') => {
    const fitted = geometry.truncateToWidth(text, contentWidth, '…')
    const padding = ' '.repeat(Math.max(0, contentWidth - geometry.visibleWidth(fitted)))
    return `${border('│')}  ${fitted}${padding}  ${border('│')}`
  }
  return { innerWidth, contentWidth, border, line }
}

function taskRow(task: Task, state: TaskState, theme: Theme, branch: string, selected = false) {
  const blockers = task.blockedBy.filter(
    (id) => state.tasks.find((candidate) => candidate.id === id)?.status !== 'completed',
  )
  const marker =
    task.status === 'completed'
      ? theme.fg('dim', '✓')
      : task.status === 'in_progress'
        ? theme.fg('warning', '◐')
        : theme.fg('dim', '○')
  const subject =
    task.status === 'completed'
      ? theme.strikethrough(theme.fg('dim', label(task.subject)))
      : theme.fg(task.status === 'in_progress' ? 'text' : 'muted', label(task.subject))
  const detail = shortDetail(task, state)
  const suffix = detail ? ` ${theme.fg(blockers.length ? 'warning' : 'dim', `(${detail})`)}` : ''
  const cursor = selected ? theme.fg('accent', '›') : ' '
  return `${cursor} ${theme.fg('dim', branch)} ${marker} ${subject}${suffix}`
}

export class TaskPanel implements Component {
  private readonly state: TaskState
  private readonly tasks: Task[]
  private readonly tui: TaskPanelTUI
  private readonly theme: Theme
  private readonly keys: TaskPanelKeys
  private readonly done: (choice: TaskPanelChoice) => void
  private readonly geometry: Geometry
  private selected = 0
  private cachedWidth?: number
  private cachedLines?: string[]

  constructor(options: {
    state: TaskState
    tui: TaskPanelTUI
    theme: Theme
    keys: TaskPanelKeys
    done: (choice: TaskPanelChoice) => void
    geometry: Geometry
  }) {
    this.state = options.state
    this.tasks = orderedTasks(options.state.tasks)
    this.tui = options.tui
    this.theme = options.theme
    this.keys = options.keys
    this.done = options.done
    this.geometry = options.geometry
    this.selected = Math.max(
      0,
      this.tasks.findIndex((task) => task.status !== 'completed'),
    )
  }

  invalidate() {
    this.cachedWidth = undefined
    this.cachedLines = undefined
  }

  handleInput(data: string) {
    if (this.keys.matches(data, 'tui.select.cancel')) {
      this.done({ kind: 'cancel' })
      return
    }
    if (this.keys.matches(data, 'tui.select.up')) {
      if (this.tasks.length) this.selected = (this.selected - 1 + this.tasks.length) % this.tasks.length
      this.changed()
      return
    }
    if (this.keys.matches(data, 'tui.select.down')) {
      if (this.tasks.length) this.selected = (this.selected + 1) % this.tasks.length
      this.changed()
      return
    }
    if (this.keys.matches(data, 'tui.select.confirm')) {
      const task = this.tasks[this.selected]
      this.done(task ? { kind: 'task', id: task.id } : { kind: 'create' })
      return
    }
    const shortcut = data.toLowerCase()
    const choice: TaskPanelChoice | undefined =
      shortcut === 'c'
        ? { kind: 'create' }
        : shortcut === 'v'
          ? { kind: 'view' }
          : shortcut === 'r'
            ? { kind: 'retention' }
            : shortcut === 'm'
              ? { kind: 'reminders' }
              : shortcut === 'x' && this.tasks.some((task) => task.status === 'completed')
                ? { kind: 'clear-completed' }
                : undefined
    if (choice) this.done(choice)
  }

  render(width: number): string[] {
    if (width <= 0) return []
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines
    if (width < 12) return [this.geometry.truncateToWidth('Todos', width)]

    const { innerWidth, contentWidth, border, line } = cardFrame(width, this.theme, this.geometry)
    const doneCount = this.tasks.filter((task) => task.status === 'completed').length
    const lines = [
      border(`┌${'─'.repeat(innerWidth)}┐`),
      line(this.theme.fg('accent', `● Todos (${doneCount}/${this.tasks.length})`)),
      line(),
    ]

    if (this.tasks.length === 0) {
      lines.push(line(this.theme.fg('muted', 'No todos yet.')))
      lines.push(line(this.theme.fg('dim', 'Press c or Enter to create one.')))
    } else {
      const start = Math.min(
        Math.max(0, this.selected - Math.floor(MAX_VISIBLE_TASKS / 2)),
        Math.max(0, this.tasks.length - MAX_VISIBLE_TASKS),
      )
      const visible = this.tasks.slice(start, start + MAX_VISIBLE_TASKS)
      if (start > 0) lines.push(line(this.theme.fg('dim', `  ↑ ${start} more`)))
      for (const [offset, task] of visible.entries()) {
        if (offset > 0 && visible[offset - 1].status === 'completed' && task.status !== 'completed')
          lines.push(line())
        const index = start + offset
        const branch = index === this.tasks.length - 1 ? '└─' : '├─'
        lines.push(line(taskRow(task, this.state, this.theme, branch, index === this.selected)))
      }
      const hiddenAfter = this.tasks.length - (start + visible.length)
      if (hiddenAfter > 0) lines.push(line(this.theme.fg('dim', `  ↓ ${hiddenAfter} more`)))
    }

    lines.push(line())
    if (contentWidth >= 44) {
      lines.push(line(this.theme.fg('dim', 'branch-local · not tsk or human acceptance')))
    } else {
      lines.push(line(this.theme.fg('dim', 'branch-local · not tsk')))
      lines.push(line(this.theme.fg('dim', 'not human acceptance')))
    }
    lines.push(
      line(
        this.theme.fg(
          'dim',
          this.tasks.length
            ? contentWidth >= 34
              ? '↑↓ move · Enter manage · Esc close'
              : '↑↓ move · Enter · Esc close'
            : 'Enter create · Esc close',
        ),
      ),
    )
    const hasCompleted = this.tasks.some((task) => task.status === 'completed')
    if (contentWidth >= 62) {
      lines.push(
        line(
          this.theme.fg(
            'dim',
            `c new · v view · r retention · m reminders${hasCompleted ? ' · x clear completed' : ''}`,
          ),
        ),
      )
    } else if (contentWidth >= 31) {
      lines.push(line(this.theme.fg('dim', 'c new · v view · r retention')))
      lines.push(line(this.theme.fg('dim', `m reminders${hasCompleted ? ' · x clear completed' : ''}`)))
    } else {
      lines.push(line(this.theme.fg('dim', 'c new · v view · r retention')))
      lines.push(line(this.theme.fg('dim', `m remind${hasCompleted ? ' · x clear completed' : ''}`)))
    }
    lines.push(border(`└${'─'.repeat(innerWidth)}┘`))

    this.cachedWidth = width
    this.cachedLines = lines
    return lines
  }

  private changed() {
    this.invalidate()
    this.tui.requestRender()
  }
}

/** Read-only above-editor companion to the interactive task panel. */
export class TaskWidget implements Component {
  private cachedWidth?: number
  private cachedLines?: string[]
  private readonly tasks: Task[]
  private readonly state: TaskState
  private readonly theme: Theme
  private readonly geometry: Geometry
  private readonly current: () => boolean

  constructor(state: TaskState, theme: Theme, geometry: Geometry, current: () => boolean) {
    this.state = state
    this.theme = theme
    this.geometry = geometry
    this.current = current
    this.tasks = orderedTasks(state.tasks)
  }

  invalidate() {
    this.cachedWidth = undefined
    this.cachedLines = undefined
  }

  render(width: number): string[] {
    if (!this.current() || width <= 0 || this.state.config.view === 'off') return []
    const completed = this.tasks.filter((task) => task.status === 'completed')
    const open = this.tasks.filter((task) => task.status !== 'completed')
    // Keep the existing completed-only hide behavior; records remain in the dialog.
    if (!open.length) return []
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines
    if (width < 12) return [this.geometry.truncateToWidth('● Todos', width, '')]

    const contentWidth = width - 1
    const line = (text = '') => this.geometry.truncateToWidth(text, contentWidth, '…')
    const openLimit = this.state.config.view === 'compact' ? 5 : 3
    const shownCompleted = completed.slice(0, 2)
    const shownOpen = open.slice(0, openLimit)
    const lines = [line(this.theme.fg('accent', `● Todos (${completed.length}/${this.tasks.length})`))]
    const addTask = (task: Task) => {
      const branch = task === this.tasks.at(-1) ? '└─' : '├─'
      lines.push(line(taskRow(task, this.state, this.theme, branch)))
    }
    for (const task of shownCompleted) addTask(task)
    for (const task of shownOpen) addTask(task)
    const hiddenCompleted = completed.length - shownCompleted.length
    const hiddenOpen = open.length - shownOpen.length
    const overflow = [
      ...(hiddenCompleted ? [`${hiddenCompleted} completed`] : []),
      ...(hiddenOpen ? [`${hiddenOpen} more`] : []),
    ]
    if (overflow.length) lines.push(line(this.theme.fg('dim', `  … ${overflow.join(' · ')} · /mh-todos`)))
    this.cachedWidth = width
    this.cachedLines = lines
    return lines
  }
}

export async function showTaskWidget(ctx: ExtensionContext, state: TaskState, current: () => boolean) {
  if (!ctx.hasUI || ctx.mode !== 'tui') return
  if (state.config.view === 'off' || !state.tasks.some((task) => task.status !== 'completed')) {
    if (current()) ctx.ui.setWidget('mahiro-session-tasks', undefined)
    return
  }
  const geometry = await import('@earendil-works/pi-tui')
  if (!current()) return
  ctx.ui.setWidget('mahiro-session-tasks', (_tui, theme) => new TaskWidget(state, theme, geometry, current), {
    placement: 'aboveEditor',
  })
}

export async function openTaskPanel(ctx: ExtensionContext, state: TaskState) {
  const geometry = await import('@earendil-works/pi-tui')
  return ctx.ui.custom<TaskPanelChoice>(
    (tui, theme, keys, done) =>
      new TaskPanel({
        state,
        tui,
        theme,
        keys,
        done,
        geometry,
      }),
    {
      overlay: true,
      overlayOptions: {
        anchor: 'center',
        width: '82%',
        minWidth: 36,
        maxHeight: 20,
        margin: 1,
      },
    },
  )
}
