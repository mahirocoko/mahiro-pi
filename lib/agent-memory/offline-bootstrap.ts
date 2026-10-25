const key = Symbol.for('@mahirocoko/pi-guards:offline-memory-maintenance-sessions')

type OfflineSessionRegistry = Set<string>
type OfflineSessionGlobal = typeof globalThis & Record<symbol, unknown>

function registry(create = false) {
  const owner = globalThis as OfflineSessionGlobal
  const existing = owner[key]
  if (existing instanceof Set) return existing as OfflineSessionRegistry
  if (!create) return undefined
  const sessions: OfflineSessionRegistry = new Set()
  owner[key] = sessions
  return sessions
}

export function registerOfflineMaintenanceSession(sessionId: string) {
  if (!sessionId) throw Error('Offline maintenance session identity required')
  const sessions = registry(true)!
  sessions.add(sessionId)
  return () => {
    sessions.delete(sessionId)
    if (!sessions.size) (globalThis as OfflineSessionGlobal)[key] = undefined
  }
}

export function isOfflineMaintenanceSession(sessionId: string) {
  return Boolean(sessionId && registry()?.has(sessionId))
}
