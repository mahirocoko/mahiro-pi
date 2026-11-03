import { offlineResetFailureCode, type OfflineResetFailureCode } from './reasons.ts'

const key = Symbol.for('@mahirocoko/pi-guards:offline-memory-maintenance-sessions')

type RejectionObserver = (toolCallId: string, code: OfflineResetFailureCode | undefined) => void
type OfflineSessionRegistry = Map<string, RejectionObserver | undefined>
type OfflineSessionGlobal = typeof globalThis & Record<symbol, unknown>

function registry(create = false) {
  const owner = globalThis as OfflineSessionGlobal
  const existing = owner[key]
  if (existing instanceof Map) return existing as OfflineSessionRegistry
  if (!create) return undefined
  const sessions: OfflineSessionRegistry = new Map()
  owner[key] = sessions
  return sessions
}

export function registerOfflineMaintenanceSession(sessionId: string, observer?: RejectionObserver) {
  if (!sessionId) throw Error('Offline maintenance session identity required')
  const sessions = registry(true)!
  sessions.set(sessionId, observer)
  return () => {
    sessions.delete(sessionId)
    if (!sessions.size) (globalThis as OfflineSessionGlobal)[key] = undefined
  }
}

// Only an explicitly registered ephemeral owner receives identity-branded diagnostic codes.
// Neither the error nor its message/payload leaves the extension boundary.
export function reportOfflineResetFailure(sessionId: string, toolCallId: string, error: unknown) {
  try {
    registry()?.get(sessionId)?.(toolCallId, offlineResetFailureCode(error))
  } catch {
    // Diagnostics cannot replace the original refusal or authorize execution.
  }
}

export function isOfflineMaintenanceSession(sessionId: string) {
  return Boolean(sessionId && registry()?.has(sessionId))
}
