// Ephemeral, metadata-only bridge on the identity-bound worker lease. Never serialize it.
export const attemptTimingSink = Symbol.for('@mahirocoko/agent-memory:abi2-attempt-timing')
export type AttemptTimingEvent = 'start' | 'tool-start' | 'tool-end'
export type AttemptTimingSink = (event: AttemptTimingEvent, id?: unknown) => void

export function createAttemptTiming(now: () => number = () => performance.now()) {
  let started: number | undefined
  let stopped: number | undefined
  let last = 0
  let wall = 0
  let opened = 0
  let incomplete = false
  const active = new Set<string>()
  const clock = () => (last = Math.max(last, now()))
  const snapshot = () => {
    if (started === undefined) return null
    const end = stopped ?? clock()
    const elapsedMs = Math.max(0, end - started)
    const observedToolWallMs = wall + (active.size ? Math.max(0, end - opened) : 0)
    const complete = !incomplete && active.size === 0
    return {
      elapsedMs,
      observedToolWallMs,
      unclassifiedMs: complete ? Math.max(0, elapsedMs - observedToolWallMs) : null,
      complete,
    }
  }
  return {
    observe(event: AttemptTimingEvent, id?: unknown) {
      if (stopped !== undefined) return
      if (event === 'start') {
        started ??= clock()
        return
      }
      if (started === undefined) return
      if (typeof id !== 'string' || !id || id.length > 256) {
        incomplete = true
        return
      }
      if (event === 'tool-start') {
        if (active.has(id) || active.size >= 64) {
          incomplete = true
          return
        }
        if (!active.size) opened = clock()
        active.add(id)
      } else if (!active.delete(id)) incomplete = true
      else if (!active.size) wall += Math.max(0, clock() - opened)
    },
    freeze() {
      stopped ??= clock()
      if (active.size) {
        wall += Math.max(0, stopped - opened)
        incomplete = true
        active.clear()
      }
    },
    snapshot,
  }
}
