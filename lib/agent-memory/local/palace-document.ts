import { assertOid, oidPattern } from './contracts.ts'
import { escapePalaceText } from './palace.ts'
import { assertPalacePath } from './palace-path.ts'

// Bounded committed-file read for the disconnected Palace reader.
// The snapshot stays metadata-only. This object is the only file body.
export const palaceDocumentLimits = {
  maxTextBytes: 12 * 1024,
  maxResponseBytes: 16 * 1024,
  maxFileBytes: 8 * 1024 * 1024,
} as const

const groups = ['baseline', 'human', 'project', 'reference', 'library'] as const
const placements = ['baseline', 'library'] as const
const baselinePaths = new Set(['Core.md', 'index.md', 'system/persona.md'])

export type PalaceMemoryGroup = (typeof groups)[number]
export type PalacePlacement = (typeof placements)[number]

export interface PalaceDocument {
  version: 1
  bytes: number
  commit: string
  path: string
  placement: PalacePlacement
  group: PalaceMemoryGroup
  totalBytes: number
  returnedBytes: number
  truncated: boolean
  text: string
}

export interface PalaceDocumentRequest {
  commit: string
  path: string
}

function refused(): never {
  throw Error('Local memory palace refused')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function clipPalaceUtf8(buffer: Buffer, maxBytes: number): Buffer {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) refused()
  if (maxBytes === 0 || buffer.length === 0) return Buffer.alloc(0)
  const end = Math.min(buffer.length, maxBytes)
  let start = end - 1
  while (start >= 0 && (buffer[start] & 0xc0) === 0x80) start -= 1
  if (start < 0) return Buffer.alloc(0)
  const lead = buffer[start] ?? 0
  let width = 1
  if ((lead & 0xe0) === 0xc0) width = 2
  else if ((lead & 0xf0) === 0xe0) width = 3
  else if ((lead & 0xf8) === 0xf0) width = 4
  if (start + width > end) return buffer.subarray(0, start)
  return buffer.subarray(0, end)
}

function clipText(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text)
  if (buffer.length <= maxBytes) return text
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(clipPalaceUtf8(buffer, maxBytes))
  } catch {
    refused()
  }
}

export function palaceMemoryPlacement(path: string): {
  placement: PalacePlacement
  group: PalaceMemoryGroup
  label: string
} {
  if (baselinePaths.has(path)) return { placement: 'baseline', group: 'baseline', label: 'Baseline prompt' }
  if (path.startsWith('human/') || path.startsWith('system/human/'))
    return { placement: 'library', group: 'human', label: 'On-demand library' }
  if (path.startsWith('projects/'))
    return { placement: 'library', group: 'project', label: 'On-demand library' }
  if (path.startsWith('reference/'))
    return { placement: 'library', group: 'reference', label: 'On-demand library' }
  return { placement: 'library', group: 'library', label: 'On-demand library' }
}

export function defaultPalacePath(entries: readonly { path: string; kind: string }[]): string | null {
  const files = new Set(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path))
  for (const path of ['Core.md', 'index.md', 'system/persona.md']) {
    if (files.has(path)) return path
  }
  return entries.find((entry) => entry.kind === 'file')?.path ?? null
}

function assertFileBytes(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > palaceDocumentLimits.maxFileBytes) refused()
}

function stamp(fields: Omit<PalaceDocument, 'bytes' | 'version'>, bytes: number): PalaceDocument {
  return { version: 1, bytes, ...fields }
}

function measure(fields: Omit<PalaceDocument, 'bytes' | 'version'>): PalaceDocument {
  let bytes = 0
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const document = stamp(fields, bytes)
    const size = Buffer.byteLength(JSON.stringify(document))
    if (size === bytes) return document
    bytes = size
  }
  refused()
}

export function buildPalaceDocument(input: {
  commit: string
  path: string
  totalBytes: number
  text: string
}): PalaceDocument {
  assertOid(input.commit)
  assertPalacePath(input.path)
  assertFileBytes(input.totalBytes)
  if (typeof input.text !== 'string' || input.text.includes('\0')) refused()
  let text = clipText(input.text, palaceDocumentLimits.maxTextBytes)
  if (Buffer.byteLength(text) > input.totalBytes) refused()
  const placed = palaceMemoryPlacement(input.path)
  let document = measure({
    commit: input.commit,
    path: input.path,
    placement: placed.placement,
    group: placed.group,
    totalBytes: input.totalBytes,
    returnedBytes: Buffer.byteLength(text),
    truncated: Buffer.byteLength(text) < input.totalBytes,
    text,
  })
  let guard = 0
  while (
    document.bytes > palaceDocumentLimits.maxResponseBytes &&
    guard < palaceDocumentLimits.maxTextBytes
  ) {
    guard += 1
    if (text.length === 0) refused()
    text = clipText(text, Math.max(0, Buffer.byteLength(text) - 1))
    document = measure({
      commit: input.commit,
      path: input.path,
      placement: placed.placement,
      group: placed.group,
      totalBytes: input.totalBytes,
      returnedBytes: Buffer.byteLength(text),
      truncated: true,
      text,
    })
  }
  if (document.bytes > palaceDocumentLimits.maxResponseBytes) refused()
  return document
}

function assertKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).sort().join() !== [...expected].sort().join()) refused()
}

export function parsePalaceDocument(value: unknown): PalaceDocument {
  if (!isRecord(value)) refused()
  assertKeys(value, [
    'bytes',
    'commit',
    'group',
    'path',
    'placement',
    'returnedBytes',
    'text',
    'totalBytes',
    'truncated',
    'version',
  ])
  if (value.version !== 1) refused()
  if (typeof value.commit !== 'string' || !oidPattern.test(value.commit)) refused()
  if (typeof value.path !== 'string') refused()
  assertPalacePath(value.path)
  if (typeof value.text !== 'string' || value.text.includes('\0')) refused()
  if (Buffer.byteLength(value.text) > palaceDocumentLimits.maxTextBytes) refused()
  if (typeof value.totalBytes !== 'number') refused()
  assertFileBytes(value.totalBytes)
  const built = buildPalaceDocument({
    commit: value.commit,
    path: value.path,
    totalBytes: value.totalBytes,
    text: value.text,
  })
  if (
    value.bytes !== built.bytes ||
    value.placement !== built.placement ||
    value.group !== built.group ||
    value.returnedBytes !== built.returnedBytes ||
    value.truncated !== built.truncated ||
    value.text !== built.text ||
    built.bytes > palaceDocumentLimits.maxResponseBytes
  )
    refused()
  return built
}

function takeLink(value: string): { label: string; rest: string } | undefined {
  const image = value.startsWith('![')
  const start = image ? 2 : value.startsWith('[') ? 1 : -1
  if (start < 0) return undefined
  const marker = value.indexOf('](', start)
  if (marker <= start) return undefined
  const label = value.slice(start, marker)
  if (label.includes('\n')) return undefined
  let depth = 0
  for (let cursor = marker + 2; cursor < value.length; cursor += 1) {
    const char = value[cursor]
    if (char === '(') depth += 1
    else if (char === ')') {
      if (depth === 0) return { label, rest: value.slice(cursor + 1) }
      depth -= 1
    } else if (char === '\n') return undefined
  }
  return undefined
}

function inline(value: string): string {
  let html = ''
  let rest = value
  while (rest.length > 0) {
    const before = rest.length
    const code = /^`([^`]+)`/.exec(rest)
    const linked = rest.startsWith('[') || rest.startsWith('![') ? takeLink(rest) : undefined
    const strong = /^\*\*([^*]+)\*\*/.exec(rest)
    const emphasis = /^\*([^*]+)\*/.exec(rest)
    if (code?.index === 0) {
      html += `<code>${escapePalaceText(code[1] ?? '')}</code>`
      rest = rest.slice(code[0].length)
    } else if (linked && linked.rest.length < rest.length) {
      html += escapePalaceText(linked.label)
      rest = linked.rest
    } else if (strong?.index === 0) {
      html += `<strong>${escapePalaceText(strong[1] ?? '')}</strong>`
      rest = rest.slice(strong[0].length)
    } else if (emphasis?.index === 0) {
      html += `<em>${escapePalaceText(emphasis[1] ?? '')}</em>`
      rest = rest.slice(emphasis[0].length)
    } else {
      html += escapePalaceText(rest[0] ?? '')
      rest = rest.slice(1)
    }
    if (rest.length >= before) rest = rest.slice(1)
  }
  return html
}

function isBlockStart(line: string): boolean {
  return (
    line.startsWith('```') ||
    /^#{1,3} /.test(line) ||
    line.startsWith('> ') ||
    /^[-*] /.test(line) ||
    /^\d{1,2}\. /.test(line)
  )
}

export function renderPalaceMarkdown(value: string): string {
  if (value.includes('\0')) refused()
  const lines = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  const blocks: string[] = []
  let index = 0
  while (index < lines.length) {
    const lineStart = index
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
    } else if (line.startsWith('```')) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(`<pre><code>${escapePalaceText(code.join('\n'))}</code></pre>`)
    } else if (/^(#{1,3}) (.*)$/.test(line)) {
      const heading = /^(#{1,3}) (.*)$/.exec(line)
      const level = (heading?.[1]?.length ?? 1) + 2
      blocks.push(`<h${level}>${inline(heading?.[2] ?? '')}</h${level}>`)
      index += 1
    } else if (line.startsWith('> ')) {
      const quote: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('> ')) {
        quote.push((lines[index] ?? '').slice(2))
        index += 1
      }
      if (quote.length > 0) blocks.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`)
    } else if (/^[-*] /.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*] /.test(lines[index] ?? '')) {
        items.push(`<li>${inline((lines[index] ?? '').slice(2))}</li>`)
        index += 1
      }
      if (items.length > 0) blocks.push(`<ul>${items.join('')}</ul>`)
    } else if (/^\d{1,2}\. /.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d{1,2}\. /.test(lines[index] ?? '')) {
        items.push(`<li>${inline((lines[index] ?? '').replace(/^\d{1,2}\. /, ''))}</li>`)
        index += 1
      }
      if (items.length > 0) blocks.push(`<ol>${items.join('')}</ol>`)
    } else {
      const paragraph: string[] = []
      while (
        index < lines.length &&
        (lines[index] ?? '').trim() !== '' &&
        !isBlockStart(lines[index] ?? '')
      ) {
        paragraph.push(lines[index] ?? '')
        index += 1
      }
      if (paragraph.length > 0) blocks.push(`<p>${inline(paragraph.join(' '))}</p>`)
    }
    if (index <= lineStart) {
      blocks.push(`<p>${inline(line)}</p>`)
      index = lineStart + 1
    }
  }
  return blocks.join('')
}
