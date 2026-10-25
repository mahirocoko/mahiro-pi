// Closed profile selection only: no account, credential, quota or window data.
import { createHash } from 'node:crypto'

export type UsagePreferences = { codex: boolean }
export type UsageState = UsagePreferences & { version: 1; sequence: number }
export type UsageRevision = { state: UsageState; ticket: string }
export const USAGE_STATE_BYTE_LIMIT = 1024
export function validateUsagePreferences(value: unknown): asserts value is UsagePreferences {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    Object.keys(value)[0] !== 'codex' ||
    typeof (value as UsagePreferences).codex !== 'boolean'
  )
    throw Error('Invalid usage preferences')
}
function validateState(value: unknown): asserts value is UsageState {
  const state = value as UsageState
  if (
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    Object.keys(state).length !== 3 ||
    Object.keys(state).some((key) => !['version', 'sequence', 'codex'].includes(key)) ||
    state.version !== 1 ||
    !Number.isSafeInteger(state.sequence) ||
    state.sequence < 1 ||
    typeof state.codex !== 'boolean'
  )
    throw Error('Invalid usage state')
}
const ticket = (bytes: Uint8Array | null) =>
  createHash('sha256')
    .update(bytes === null ? 'absent\0' : 'file\0')
    .update(bytes ?? new Uint8Array())
    .digest('hex')
export function decodeUsageState(bytes: Uint8Array | null): UsageRevision {
  if (bytes === null) return { state: { version: 1, sequence: 0, codex: false }, ticket: ticket(null) }
  if (bytes.byteLength > USAGE_STATE_BYTE_LIMIT) throw Error('Invalid usage state')
  try {
    const state: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    validateState(state)
    return { state, ticket: ticket(bytes) }
  } catch {
    throw Error('Invalid usage state')
  }
}
export function nextUsageState(revision: UsageRevision, preferences: unknown): UsageState {
  validateUsagePreferences(preferences)
  if (
    !Number.isSafeInteger(revision.state.sequence) ||
    revision.state.sequence < 0 ||
    revision.state.sequence === Number.MAX_SAFE_INTEGER
  )
    throw Error('Usage sequence exhausted')
  return { version: 1, sequence: revision.state.sequence + 1, ...preferences }
}
