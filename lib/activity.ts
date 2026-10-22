// Streaming activity line. The footer keeps Git, model, measured usage and its
// short tool-name cell. Worker counts stay on the optional worker widget.
// Queue and plan are not rendered here. There is no text-length estimate.

export const ACTIVITY_TICK_MS = 1_000
export const ACTIVITY_FRAME_MS = 160
export const ACTIVITY_INDICATOR_COLUMNS = 2
export const ACTIVITY_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

const VERB_COLUMNS = 10
const HINT_COLUMNS = 24
const ELAPSED_CAP_SECONDS = 99 * 3_600 + 59 * 60 + 59
const READ_TOOLS = new Set(['read', 'grep', 'find', 'ls'])
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const VERBS = {
  working: 'Working',
  thinking: 'Thinking',
  responding: 'Responding',
  reading: 'Reading',
  running: 'Running',
} as const

export type ActivityPhase = 'idle' | keyof typeof VERBS
export type ActivityStream = 'none' | 'thinking' | 'text'

export function activityColumns(value: string): number {
  const plain = value.replace(ANSI, '')
  return [...graphemes.segment(plain)].length
}

export function fitActivity(line: string, width: number): string {
  if (!Number.isFinite(width) || width <= 0) return ''
  if (activityColumns(line) <= width) return line
  if (width === 1) return '…'
  const parts = [...graphemes.segment(line)]
  return `${parts
    .slice(0, width - 1)
    .map((part) => part.segment)
    .join('')}…`
}

function padColumns(value: string, columns: number): string {
  const width = activityColumns(value)
  if (width === columns) return value
  if (width < columns) return value + ' '.repeat(columns - width)
  return fitActivity(value, columns)
}

function cleanLabel(label: string): string {
  const clean = label
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean || 'escape'
}

function elapsedField(ms: number): string {
  const seconds = Math.max(0, Math.min(ELAPSED_CAP_SECONDS, Math.floor(ms / 1000)))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remain = seconds % 60
  const body = `${hours}:${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`
  return body.padStart(8, ' ')
}

function toolsField(count: number): string {
  const shown = Math.max(0, Math.min(99, Math.floor(Number.isFinite(count) ? count : 0)))
  return `${String(shown).padStart(2, '0')} tools`
}

export function activityPhase(
  running: boolean,
  names: readonly string[],
  stream: ActivityStream,
): ActivityPhase {
  if (!running) return 'idle'
  if (names.length > 0) {
    const normalized = names.map((name) => name.trim().toLowerCase())
    if (normalized.some((name) => name === 'bash')) return 'running'
    if (normalized.every((name) => READ_TOOLS.has(name))) return 'reading'
    return 'working'
  }
  if (stream === 'thinking') return 'thinking'
  if (stream === 'text') return 'responding'
  return 'working'
}

export function activityText(input: {
  phase: ActivityPhase
  tools: number
  elapsedMs: number
  interrupt: string
}): string {
  if (input.phase === 'idle') return ''
  const verb = padColumns(VERBS[input.phase], VERB_COLUMNS)
  const hint = padColumns(`${cleanLabel(input.interrupt)} to interrupt`, HINT_COLUMNS)
  return `${verb} · ${toolsField(input.tools)} · ${elapsedField(input.elapsedMs)} · ${hint}`
}

export function indicatorFrames(color: (frame: string) => string = (frame) => frame): {
  frames: string[]
  intervalMs: number
} {
  return {
    frames: ACTIVITY_FRAMES.map((frame) => {
      try {
        const painted = color(frame)
        if (typeof painted === 'string' && activityColumns(painted) === 1) return painted
      } catch {
        /* A wide or failed colorizer must not change the spinner column. */
      }
      return frame
    }),
    intervalMs: ACTIVITY_FRAME_MS,
  }
}

export interface ActivityUI {
  setWorkingMessage(message?: string): void
  setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }): void
  theme?: { fg(color: 'accent', text: string): string }
}

export interface ActivityOptions {
  now?: () => number
  every?: (callback: () => void, ms: number) => () => void
  width?: () => number
  interrupt?: () => string
  color?: (frame: string) => string
  onResize?: (callback: () => void) => () => void
}

export function startActivity(ctx: { mode: string; ui: ActivityUI }, options: ActivityOptions = {}) {
  const noop = () => {}
  const idle = {
    begin: noop,
    turn: noop,
    stream: (_kind: string) => {},
    toolStart: (_id: string, _name: string) => {},
    toolEnd: (_id: string) => {},
    assistantEnd: (_reason?: string) => {},
    finish: noop,
    dispose: noop,
  }
  if (ctx.mode !== 'tui') return idle

  const ui = ctx.ui
  const now = options.now ?? Date.now
  const every =
    options.every ??
    ((callback: () => void, ms: number) => {
      const timer = setInterval(callback, ms)
      timer.unref()
      return () => clearInterval(timer)
    })
  const width =
    options.width ??
    (() => {
      const columns = process.stdout.columns
      return typeof columns === 'number' && Number.isFinite(columns) ? columns : 80
    })
  const interrupt = options.interrupt ?? (() => 'escape')
  const tools = new Map<string, string>()
  let alive = true
  let running = false
  let startedAt = 0
  let streamKind: ActivityStream = 'none'
  let painted: string | undefined
  let indicatorKey = ''
  let timerStop: (() => void) | undefined
  let unlisten = noop

  function paint(frame: string): string {
    try {
      const paintedFrame = options.color ? options.color(frame) : ctx.ui.theme?.fg('accent', frame)
      if (typeof paintedFrame === 'string' && activityColumns(paintedFrame) === 1) return paintedFrame
    } catch {
      /* Fall through to the uncolored one-column frame. */
    }
    return frame
  }

  function syncIndicator() {
    const next = indicatorFrames(paint)
    const key = `${next.intervalMs}\0${next.frames.join('\0')}`
    if (key === indicatorKey) return
    indicatorKey = key
    ui.setWorkingIndicator(next)
  }

  function haltTimer() {
    timerStop?.()
    timerStop = undefined
  }

  function publish() {
    if (!alive) return
    try {
      if (!running) {
        haltTimer()
        if (painted !== undefined) {
          painted = undefined
          ui.setWorkingMessage(undefined)
        }
        return
      }
      syncIndicator()
      if (!timerStop) timerStop = every(() => publish(), ACTIVITY_TICK_MS)
      const columns = width() - ACTIVITY_INDICATOR_COLUMNS
      const line = fitActivity(
        activityText({
          phase: activityPhase(true, [...tools.values()], streamKind),
          tools: tools.size,
          elapsedMs: Math.max(0, now() - startedAt),
          interrupt: interrupt(),
        }),
        columns,
      )
      if (line === painted) return
      ui.setWorkingMessage(line)
      painted = line
    } catch {
      /* The working row is display-only. */
    }
  }

  function begin() {
    if (!alive || running) return
    running = true
    startedAt = now()
    streamKind = 'none'
    tools.clear()
    publish()
  }

  function finish() {
    if (!alive) return
    running = false
    tools.clear()
    streamKind = 'none'
    publish()
  }

  try {
    unlisten = (
      options.onResize ??
      ((callback: () => void) => {
        process.stdout.on('resize', callback)
        return () => process.stdout.off('resize', callback)
      })
    )(() => {
      if (alive && running) publish()
    })
  } catch {
    unlisten = noop
  }
  try {
    syncIndicator()
  } catch {
    indicatorKey = ''
  }

  return {
    begin,
    turn() {
      if (!alive) return
      if (!running) begin()
      else {
        streamKind = 'none'
        publish()
      }
    },
    stream(kind: string) {
      if (!alive || !running) return
      let next: ActivityStream
      if (kind === 'thinking_start' || kind === 'thinking_delta') {
        if (streamKind === 'text') return
        next = 'thinking'
      } else if (kind === 'text_start' || kind === 'text_delta') next = 'text'
      else return
      // Every streamed token arrives here; only a phase change can alter the line.
      if (next === streamKind) return
      streamKind = next
      publish()
    },
    toolStart(id: string, name: string) {
      if (!alive || !running || !id) return
      tools.set(id, name.trim().toLowerCase() || 'tool')
      publish()
    },
    toolEnd(id: string) {
      if (!alive || !running) return
      tools.delete(id)
      publish()
    },
    assistantEnd(reason?: string) {
      if (reason === 'error' || reason === 'aborted') finish()
    },
    finish,
    dispose() {
      if (!alive) return
      alive = false
      running = false
      haltTimer()
      unlisten()
      unlisten = noop
      tools.clear()
      try {
        if (painted !== undefined) ui.setWorkingMessage(undefined)
        if (indicatorKey) ui.setWorkingIndicator(undefined)
      } catch {
        /* A replaced session may already have dropped the UI. */
      }
      painted = undefined
      indicatorKey = ''
    },
  }
}
