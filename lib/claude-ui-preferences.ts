// Closed own-UI data contract. No SDK, host settings, filesystem or grants.
import { createHash } from 'node:crypto'

export const PALETTE_THEMES = Object.freeze({
  claude: 'mahiro-claude-dark',
  obsidian: 'mahiro-obsidian-dark',
  ember: 'mahiro-ember-dark',
  nordic: 'mahiro-nordic-dark',
})
export type FixedPaletteMode = keyof typeof PALETTE_THEMES
export const PALETTE_MODES = ['follow', 'claude', 'obsidian', 'ember', 'nordic'] as const
export type PaletteMode = (typeof PALETTE_MODES)[number]
export type UIPreferences = {
  palette: PaletteMode
  toolStyle: 'transparent' | 'tinted'
  diffView: 'split' | 'unified' | 'native'
  extraDetail: boolean
}
export const UI_DEFAULTS: Readonly<UIPreferences> = Object.freeze({
  palette: 'follow',
  toolStyle: 'transparent',
  diffView: 'split',
  extraDetail: false,
})
export type UIState = UIPreferences & { version: 1; sequence: number }
export type UIRevision = { state: UIState; ticket: string }
export const UI_STATE_BYTE_LIMIT = 4096
const preferenceKeys = ['palette', 'toolStyle', 'diffView', 'extraDetail']
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const validPreferences = (value: Record<string, unknown>) =>
  (PALETTE_MODES as readonly string[]).includes(value.palette as string) &&
  ['transparent', 'tinted'].includes(value.toolStyle as string) &&
  ['split', 'unified', 'native'].includes(value.diffView as string) &&
  typeof value.extraDetail === 'boolean'
export function validateUIPreferences(value: unknown): asserts value is UIPreferences {
  if (
    !record(value) ||
    !validPreferences(value) ||
    Object.keys(value).length !== preferenceKeys.length ||
    Object.keys(value).some((key) => !preferenceKeys.includes(key))
  )
    throw Error('Invalid own-UI preferences')
}
export function validateUIState(value: unknown): asserts value is UIState {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    !validPreferences(value) ||
    Object.keys(value).length !== 6 ||
    Object.keys(value).some((key) => ![...preferenceKeys, 'version', 'sequence'].includes(key))
  )
    throw Error('Invalid own-UI state')
}
// Domain-separated absence cannot collide with the hash of an existing byte file.
export const uiStateTicket = (bytes: Uint8Array | null) =>
  createHash('sha256')
    .update(bytes === null ? 'absent\0' : 'file\0')
    .update(bytes ?? new Uint8Array())
    .digest('hex')
export function decodeUIState(bytes: Uint8Array | null): UIRevision {
  if (bytes === null)
    return {
      state: { version: 1, sequence: 0, ...UI_DEFAULTS },
      ticket: uiStateTicket(null),
    }
  if (bytes.byteLength > UI_STATE_BYTE_LIMIT) throw Error('Own-UI state exceeds byte limit')
  let state: unknown
  try {
    state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    validateUIState(state)
  } catch {
    // Never echo parser errors, JSON contents or paths into the UI.
    throw Error('Invalid own-UI state')
  }
  return { state: state as UIState, ticket: uiStateTicket(bytes) }
}
export function nextUIState(revision: UIRevision, preferences: unknown): UIState {
  validateUIState(revision.state)
  validateUIPreferences(preferences)
  if (revision.state.sequence === Number.MAX_SAFE_INTEGER) throw Error('Own-UI sequence exhausted')
  return { version: 1, sequence: revision.state.sequence + 1, ...preferences }
}
