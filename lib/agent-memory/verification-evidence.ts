import { bytes, hasSecret } from '../continuity/records.ts'

export const verificationEvidenceLimit = 2048
export const verificationPartLimit = 32
const decodePasses = 4
const wrapper = /<\/?(?:system-reminder|tool-result|task-notification|skill_content)\b/i

type Decode = { ok: true; value: string } | { ok: false }

export type TextDecision =
  | { kind: 'none' }
  | { kind: 'keep'; text: string; strict: boolean }
  | { kind: 'drop' }

export type SelectedCommand = { kind: 'pair'; command: 'pnpm check' | 'pnpm test' } | { kind: 'result' }

function percentStep(value: string): Decode {
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '%') continue
    const hex = value.slice(i + 1, i + 3)
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return { ok: false }
    i += 2
  }
  if (!value.includes('%')) return { ok: true, value }
  try {
    return { ok: true, value: decodeURIComponent(value) }
  } catch {
    return { ok: false }
  }
}

function unicodeStep(value: string): Decode {
  if (!value.includes('\\u') && !value.includes('\\x')) return { ok: true, value }
  let out = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\' || (value[i + 1] !== 'u' && value[i + 1] !== 'x')) {
      out += value[i]
      continue
    }
    if (value[i + 1] === 'x') {
      const hex = value.slice(i + 2, i + 4)
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return { ok: false }
      out += String.fromCodePoint(Number.parseInt(hex, 16))
      i += 3
      continue
    }
    if (value[i + 2] === '{') {
      const end = value.indexOf('}', i + 3)
      const hex = end > i + 3 ? value.slice(i + 3, end) : ''
      if (!/^[0-9A-Fa-f]{1,6}$/.test(hex)) return { ok: false }
      const code = Number.parseInt(hex, 16)
      if (code > 0x10ffff) return { ok: false }
      out += String.fromCodePoint(code)
      i = end
      continue
    }
    const hex = value.slice(i + 2, i + 6)
    if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return { ok: false }
    out += String.fromCodePoint(Number.parseInt(hex, 16))
    i += 5
  }
  return { ok: true, value: out }
}

function entityStep(value: string): Decode {
  if (!value.includes('&#')) return { ok: true, value }
  let out = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '&' || value[i + 1] !== '#') {
      out += value[i]
      continue
    }
    let cursor = i + 2
    const hex = value[cursor] === 'x' || value[cursor] === 'X'
    if (hex) cursor += 1
    const start = cursor
    const digit = hex ? /[0-9A-Fa-f]/ : /[0-9]/
    while (cursor < value.length && digit.test(value[cursor] ?? '')) cursor += 1
    const body = value.slice(start, cursor)
    if (value[cursor] !== ';' || body.length < 1 || body.length > (hex ? 6 : 7)) return { ok: false }
    const code = Number.parseInt(body, hex ? 16 : 10)
    if (code > 0x10ffff) return { ok: false }
    out += String.fromCodePoint(code)
    i = cursor
  }
  return { ok: true, value: out }
}

const quotedValueLimit = 128
const quotedKey = /["'](?:api[ _-]?key|access[ _-]?token|password|secret|credential)["']\s*:\s*["']/gi

/** Bounded scan. A long quoted value fails closed instead of being skipped. */
function quotedSensitive(value: string) {
  quotedKey.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = quotedKey.exec(value))) {
    const quote = match[0].at(-1)
    const start = match.index + match[0].length
    let end = start
    const limit = Math.min(value.length, start + quotedValueLimit)
    while (end < limit && value[end] !== quote && value[end] !== '\n' && value[end] !== '\r') end += 1
    if (end > start && (value[end] === quote || end - start === quotedValueLimit)) return true
    if (quotedKey.lastIndex === match.index) quotedKey.lastIndex += 1
  }
  return false
}

function recognized(value: string) {
  return hasSecret(value) || quotedSensitive(value) || wrapper.test(value)
}

/** Bounded composition. Malformed percent, unicode, or entity text fails closed. */
function screenDecoded(value: string): boolean {
  if (recognized(value)) return false
  let current = value
  for (let pass = 0; pass < decodePasses; pass++) {
    const percent = percentStep(current)
    if (!percent.ok || bytes(percent.value) > verificationEvidenceLimit || recognized(percent.value))
      return false
    const unicode = unicodeStep(percent.value)
    if (!unicode.ok || bytes(unicode.value) > verificationEvidenceLimit || recognized(unicode.value))
      return false
    const entity = entityStep(unicode.value)
    if (!entity.ok || bytes(entity.value) > verificationEvidenceLimit || recognized(entity.value))
      return false
    if (entity.value === current) return true
    current = entity.value
  }
  return false
}

const legacyCommand = /^(?:pnpm (?:check|test):[a-z-]+|node --test [a-zA-Z0-9_./* -]+)$/

function whole(pattern: RegExp, value: string) {
  const match = pattern.exec(value)
  return Boolean(match && match[0] === value)
}

/**
 * Exact `pnpm check` or `pnpm test` may keep the command. Older `pnpm check:*`,
 * `pnpm test:*`, and `node --test` forms stay result-only: the command is not retained.
 * A regex `$` match is not enough, because `$` accepts a final newline.
 */
export function selectedVerification(value: unknown): SelectedCommand | undefined {
  if (typeof value !== 'string' || bytes(value) > verificationEvidenceLimit) return undefined
  if (value === 'pnpm check' || value === 'pnpm test') return { kind: 'pair', command: value }
  if (!whole(legacyCommand, value)) return undefined
  return { kind: 'result' }
}

/** Command field on a stored result. Only the exact pair survives. */
export function verificationCommand(value: unknown): string | undefined {
  const selected = selectedVerification(value)
  if (selected?.kind !== 'pair') return undefined
  if (!screenDecoded(selected.command)) return undefined
  return selected.command
}

/**
 * Count and bytes are decided before decode or join. A kept string is the original
 * raw text. `kind: 'drop'` is not a stored sentence.
 */
export function verificationResultText(content: unknown): TextDecision {
  if (content === undefined || content === null) return { kind: 'none' }
  if (typeof content === 'string') {
    if (content === '') return { kind: 'none' }
    if (bytes(content) > verificationEvidenceLimit) return { kind: 'drop' }
    return finish(content)
  }
  if (!Array.isArray(content) || content.length > verificationPartLimit) return { kind: 'drop' }
  let total = 0
  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return { kind: 'drop' }
    const record = part as { type?: unknown; text?: unknown }
    if (record.type !== 'text') continue
    if (typeof record.text !== 'string') return { kind: 'drop' }
    const separator = parts.length > 0 ? 1 : 0
    const size = bytes(record.text)
    if (total + separator + size > verificationEvidenceLimit) return { kind: 'drop' }
    total += separator + size
    parts.push(record.text)
  }
  if (parts.length === 0) return { kind: 'none' }
  return finish(parts.join('\n'))
}

function formerText(text: string) {
  return (
    Boolean(text.trim()) &&
    bytes(text) <= verificationEvidenceLimit &&
    !hasSecret(text) &&
    !wrapper.test(text)
  )
}

function finish(text: string): TextDecision {
  if (!formerText(text)) return { kind: 'drop' }
  return { kind: 'keep', text, strict: screenDecoded(text) }
}
