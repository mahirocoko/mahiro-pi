import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'

export const COPY_CODE_COMMAND = 'mh-copy-code'
const VISIBLE_ROWS = 8
const PREVIEW_CHARS = 48
const LANGUAGE_CHARS = 24

export type CopySelectAction =
  | 'tui.select.up'
  | 'tui.select.down'
  | 'tui.select.confirm'
  | 'tui.select.cancel'

export type CopyBranchEntry = {
  type?: string
  message?: {
    role?: string
    stopReason?: string
    content?: string | readonly { type?: string; text?: string }[]
  }
}

export type CopyTarget = {
  id: string
  kind: 'response' | 'block'
  label: string
  description: string
  text: string
  responseIndex: number
  blockIndex?: number
  closed?: boolean
  language?: string
}

export type CopyCommandRecord = {
  name?: string
  source?: string
}

type CopyKeybindings = {
  matches(data: string, action: CopySelectAction): boolean
}

export type CopyCodeDeps = {
  commands(): readonly CopyCommandRecord[]
  copyText(text: string): Promise<void>
  parse?(entries: readonly CopyBranchEntry[]): CopyTarget[]
}

type Fence = {
  language: string
  closed: boolean
  text: string
}

function lineBody(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

function limited(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return chars.slice(0, max).join('')
}

function fenceLanguage(info: string): string {
  const token = info.trim().split(/\s+/, 1)[0] ?? ''
  return limited(token.replace(/[\u0000-\u001f\u007f]/g, ''), LANGUAGE_CHARS)
}

function openingFence(
  line: string,
): { indent: number; marker: string; length: number; language: string } | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return null
  const marker = match[2][0] ?? ''
  const rest = match[3] ?? ''
  if (marker === '`' && rest.includes('`')) return null
  return {
    indent: match[1]?.length ?? 0,
    marker,
    length: match[2].length,
    language: fenceLanguage(rest),
  }
}

function closingFence(line: string, open: { marker: string; length: number }): boolean {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match || match[2][0] !== open.marker || match[2].length < open.length) return false
  return (match[3] ?? '').trim() === ''
}

function stripIndent(line: string, indent: number): string {
  let index = 0
  while (index < indent && line[index] === ' ') index += 1
  return line.slice(index)
}

export function parseFences(text: string): Fence[] {
  const lines = text.split('\n')
  const blocks: Fence[] = []
  let index = 0
  while (index < lines.length) {
    const open = openingFence(lineBody(lines[index] ?? ''))
    if (!open) {
      index += 1
      continue
    }
    const content: string[] = []
    let closed = false
    let cursor = index + 1
    for (; cursor < lines.length; cursor += 1) {
      const line = lineBody(lines[cursor] ?? '')
      if (closingFence(line, open)) {
        closed = true
        break
      }
      content.push(stripIndent(line, open.indent))
    }
    blocks.push({
      language: open.language,
      closed,
      text: content.join('\n'),
    })
    index = closed ? cursor + 1 : lines.length
  }
  return blocks
}

function preview(text: string): string {
  const line = text.slice(0, 240).split('\n', 1)[0]?.replace(/\s+/g, ' ').trim() ?? ''
  const chars = Array.from(line)
  if (chars.length <= PREVIEW_CHARS) return line
  return `${chars.slice(0, PREVIEW_CHARS - 1).join('')}…`
}

function assistantText(message: NonNullable<CopyBranchEntry['message']>): string | undefined {
  if (message.role !== 'assistant') return undefined
  const content = message.content
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'text' && typeof part.text === 'string') text += part.text
    }
  } else return undefined
  if (message.stopReason === 'aborted' && text.length === 0) return undefined
  if (text.trim().length === 0) return undefined
  return text
}

export function parseCopyTargets(entries: readonly CopyBranchEntry[]): CopyTarget[] {
  const targets: CopyTarget[] = []
  let responseIndex = 0
  for (const entry of entries) {
    if (entry?.type !== 'message' || !entry.message) continue
    const text = assistantText(entry.message)
    if (text === undefined) continue
    responseIndex += 1
    const blocks = parseFences(text)
    targets.push({
      id: `response-${responseIndex}`,
      kind: 'response',
      responseIndex,
      label: `Response ${responseIndex} · full`,
      description: preview(text),
      text,
    })
    for (const [offset, block] of blocks.entries()) {
      const blockIndex = offset + 1
      const state = block.closed ? 'closed' : 'unclosed'
      const language = block.language ? ` ${block.language}` : ''
      targets.push({
        id: `response-${responseIndex}-block-${blockIndex}`,
        kind: 'block',
        responseIndex,
        blockIndex,
        closed: block.closed,
        language: block.language || undefined,
        label: `Response ${responseIndex} · block ${blockIndex}${language} ${state}`,
        description: preview(block.text),
        text: block.text,
      })
    }
  }
  return targets
}

// The public registry lists extension, prompt and skill commands only; native
// built-ins are not exported, so only same-name non-native collisions are visible.
export function copyCommandConflict(live: readonly CopyCommandRecord[]): string | undefined {
  const matches = live.filter((command) => command?.name === COPY_CODE_COMMAND)
  if (matches.length !== 1 || matches[0]?.source !== 'extension')
    return `${COPY_CODE_COMMAND} is not a single extension command in the live registry. Clipboard was not changed.`
  return undefined
}

function inventory(targets: readonly CopyTarget[]): string {
  const responses = targets.filter((target) => target.kind === 'response').length
  const blocks = targets.length - responses
  const responseWord = responses === 1 ? 'response' : 'responses'
  const blockWord = blocks === 1 ? 'code block' : 'code blocks'
  return `${responses} ${responseWord} and ${blocks} ${blockWord}`
}

function fit(text: string, width: number): string {
  if (width <= 0) return ''
  const chars = Array.from(text)
  if (chars.length <= width) return text
  if (width === 1) return '…'
  return `${chars.slice(0, width - 1).join('')}…`
}

export class CopyCodePicker implements Component {
  private readonly targets: readonly CopyTarget[]
  private readonly matches: CopyKeybindings['matches']
  private readonly onSelect: (target: CopyTarget) => void
  private readonly onCancel: () => void
  private selected = 0

  constructor(options: {
    targets: readonly CopyTarget[]
    matches?: CopyKeybindings['matches']
    onSelect: (target: CopyTarget) => void
    onCancel: () => void
  }) {
    this.targets = options.targets
    this.matches = options.matches ?? defaultMatches
    this.onSelect = options.onSelect
    this.onCancel = options.onCancel
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines = ['Copy from the current branch', 'Enter copies the selected row. Esc cancels.']
    const count = this.targets.length
    if (count === 0) {
      lines.push('No assistant text.')
      return lines
    }
    const start = Math.max(0, Math.min(this.selected - Math.floor(VISIBLE_ROWS / 2), count - VISIBLE_ROWS))
    const end = Math.min(count, start + VISIBLE_ROWS)
    for (let index = start; index < end; index += 1) {
      const target = this.targets[index]
      if (!target) continue
      const mark = index === this.selected ? '>' : ' '
      lines.push(fit(`${mark} ${target.label}`, width))
      if (target.description) lines.push(fit(`  ${target.description}`, width))
    }
    return lines
  }

  handleInput(data: string): void {
    if (this.matches(data, 'tui.select.cancel')) {
      this.onCancel()
      return
    }
    const count = this.targets.length
    if (count === 0) return
    if (this.matches(data, 'tui.select.up')) {
      this.selected = this.selected === 0 ? count - 1 : this.selected - 1
      return
    }
    if (this.matches(data, 'tui.select.down')) {
      this.selected = this.selected === count - 1 ? 0 : this.selected + 1
      return
    }
    if (this.matches(data, 'tui.select.confirm')) {
      const target = this.targets[this.selected]
      if (target) this.onSelect(target)
    }
  }
}

function defaultMatches(data: string, action: CopySelectAction): boolean {
  const keys: Record<CopySelectAction, readonly string[]> = {
    'tui.select.up': ['\u001b[A', '\u001bOA'],
    'tui.select.down': ['\u001b[B', '\u001bOB'],
    'tui.select.cancel': ['\u001b', '\u0003'],
    'tui.select.confirm': ['\r', '\n'],
  }
  return keys[action].includes(data)
}

function notify(ctx: ExtensionCommandContext, message: string, type: 'info' | 'warning' | 'error') {
  ctx.ui.notify(message, type)
}

export async function handleCopyCode(ctx: ExtensionCommandContext, deps: CopyCodeDeps): Promise<void> {
  let live: readonly CopyCommandRecord[]
  try {
    live = deps.commands()
  } catch {
    notify(ctx, 'Command registry unavailable. Clipboard was not changed.', 'warning')
    return
  }
  const conflict = copyCommandConflict(live)
  if (conflict) {
    notify(ctx, conflict, 'warning')
    return
  }
  let entries: readonly CopyBranchEntry[]
  try {
    entries = ctx.sessionManager.getBranch()
  } catch {
    notify(ctx, 'Current branch is unavailable. Clipboard was not changed.', 'warning')
    return
  }
  const targets = (deps.parse ?? parseCopyTargets)(entries)
  if (targets.length === 0) {
    notify(ctx, 'No assistant text on the current branch. Clipboard was not changed.', 'info')
    return
  }
  if (ctx.mode !== 'tui') {
    notify(
      ctx,
      `Interactive TUI is required for clipboard copy. Current branch has ${inventory(targets)}. Clipboard was not changed.`,
      'info',
    )
    return
  }
  if (typeof ctx.ui.custom !== 'function') {
    notify(ctx, 'Copy picker unavailable. Clipboard was not changed.', 'warning')
    return
  }
  let closed = false
  const close = () => {
    if (closed) return false
    closed = true
    return true
  }
  try {
    await ctx.ui.custom<void>(
      (_tui, _theme, keybindings, done) =>
        new CopyCodePicker({
          targets,
          matches: (data, action) => keybindings.matches(data, action),
          onCancel: () => {
            if (close()) done()
          },
          onSelect: (target) => {
            if (!close()) return
            void Promise.resolve()
              .then(() => deps.copyText(target.text))
              .then(
                () => notify(ctx, `Copied ${target.label}.`, 'info'),
                () => notify(ctx, 'Clipboard copy failed. Nothing else was saved.', 'error'),
              )
              .catch(() => {})
              .finally(() => done())
          },
        }),
      {
        overlay: true,
        overlayOptions: { width: '80%', maxHeight: '70%' },
      },
    )
  } catch {
    notify(ctx, 'Copy picker failed.', 'warning')
  }
}

export function createCopyCodeHandler(pi: ExtensionAPI) {
  return (_args: string, ctx: ExtensionCommandContext) =>
    handleCopyCode(ctx, {
      commands: () => pi.getCommands(),
      copyText: async (text: string) => {
        const { copyToClipboard } = await import('@earendil-works/pi-coding-agent')
        await copyToClipboard(text)
      },
    })
}
