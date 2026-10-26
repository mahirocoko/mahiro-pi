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

    const innerWidth = width - 2
    const contentWidth = innerWidth - 4
    const border = (text: string) => this.theme.fg('borderMuted', text)
    const line = (text = '') => {
      const fitted = this.geometry.truncateToWidth(text, contentWidth, '…')
      const padding = ' '.repeat(Math.max(0, contentWidth - this.geometry.visibleWidth(fitted)))
      return `${border('│')}  ${fitted}${padding}  ${border('│')}`
    }
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
        const selected = index === this.selected
        const branch = index === this.tasks.length - 1 ? '└─' : '├─'
        const blockers = task.blockedBy.filter(
          (id) => this.state.tasks.find((candidate) => candidate.id === id)?.status !== 'completed',
        )
        const marker =
          task.status === 'completed'
            ? this.theme.fg('dim', '✓')
            : task.status === 'in_progress'
              ? this.theme.fg('warning', '◐')
              : this.theme.fg('dim', '○')
        const subject =
          task.status === 'completed'
            ? this.theme.strikethrough(this.theme.fg('dim', label(task.subject)))
            : this.theme.fg(task.status === 'in_progress' ? 'text' : 'muted', label(task.subject))
        const detail = shortDetail(task, this.state)
        const suffix = detail ? ` ${this.theme.fg(blockers.length ? 'warning' : 'dim', `(${detail})`)}` : ''
        const cursor = selected ? this.theme.fg('accent', '›') : ' '
        lines.push(line(`${cursor} ${this.theme.fg('dim', branch)} ${marker} ${subject}${suffix}`))
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
