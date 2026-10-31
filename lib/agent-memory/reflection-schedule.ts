// The delivery window freezes ids in memory. ABI2 outstanding assistant steps are
// the assistantSteps values on bounded episode files that are not reviewed or
// forgotten; this module does not scan those files. A stopped drain is not retried
// in place. The next threshold may include a new bounded backlog of still-pending
// ids, including compaction and episodes left by a restart or a failed window.
// Those ids are not assistant steps. The backlog is fixed when the drain opens;
// later episodes are not appended. Unseen ids are not marked reviewed.

export const assistantReflectionSteps = 25
export const reflectionDeliveryLimit = 4
export const reflectionBacklogLimit = 32

export interface ReflectionDrain {
  id: number
  ids: readonly string[]
  next: number
}

export interface ReflectionWindow {
  project: string | null
  steps: number
  stepsAtCapture: number
  pendingIds: string[]
  drainSerial: number
  drain: ReflectionDrain | null
}

export function createReflectionWindow(): ReflectionWindow {
  return { project: null, steps: 0, stepsAtCapture: 0, pendingIds: [], drainSerial: 0, drain: null }
}

const tracked = (window: ReflectionWindow, id: string) =>
  window.pendingIds.includes(id) || (window.drain?.ids.includes(id) ?? false)

const freeze = (window: ReflectionWindow, ids: readonly string[], consumeSteps: boolean) => {
  window.drainSerial += 1
  window.stepsAtCapture = consumeSteps ? window.steps : 0
  window.drain = { id: window.drainSerial, ids: Object.freeze(ids.slice()), next: 0 }
  return nextReflectionDelivery(window)
}

export function nextReflectionDelivery(window: ReflectionWindow): readonly string[] {
  if (!window.drain) return []
  return window.drain.ids.slice(window.drain.next, window.drain.next + reflectionDeliveryLimit)
}

export function openReflectionDrain(
  window: ReflectionWindow,
  backlogIds: readonly string[] = [],
  threshold = assistantReflectionSteps,
): readonly string[] {
  if (window.drain || window.steps < threshold || window.pendingIds.length === 0) return []
  const ids: string[] = []
  const seen = new Set<string>()
  const take = (id: string, capped: boolean) => {
    if (seen.has(id)) return
    if (capped && ids.length >= reflectionBacklogLimit) return
    seen.add(id)
    ids.push(id)
  }
  for (const id of backlogIds) take(id, true)
  for (const id of window.pendingIds) take(id, false)
  window.pendingIds = []
  return freeze(window, ids, true)
}

// Compaction-event selection. Pending assistant episodes are included with the
// backlog, then capped and deduped. This does not consume step credit.
export function openReflectionCapture(
  window: ReflectionWindow,
  project: string,
  backlogIds: readonly string[],
): readonly string[] {
  if (window.drain) return []
  if (window.project !== null && window.project !== project) return []
  window.project = project
  const ids: string[] = []
  const seen = new Set<string>()
  const take = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  for (const id of window.pendingIds) {
    take(id)
    if (ids.length === reflectionBacklogLimit) break
  }
  if (ids.length < reflectionBacklogLimit) {
    for (const id of backlogIds) {
      take(id)
      if (ids.length === reflectionBacklogLimit) break
    }
  }
  if (!ids.length) return []
  window.pendingIds = window.pendingIds.filter((id) => !seen.has(id))
  return freeze(window, ids, false)
}

// Capacity recovery only. These ids are not assistant steps and do not extend an open drain.
export function openReflectionBacklog(
  window: ReflectionWindow,
  project: string,
  backlogIds: readonly string[],
): readonly string[] {
  if (window.drain || backlogIds.length === 0) return []
  if (window.project !== null && window.project !== project) return []
  window.project = project
  const ids: string[] = []
  const seen = new Set<string>()
  for (const id of backlogIds) {
    if (seen.has(id) || tracked(window, id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length === reflectionBacklogLimit) break
  }
  if (!ids.length) return []
  window.pendingIds = window.pendingIds.filter((id) => !seen.has(id))
  return freeze(window, ids, false)
}

export function applyDerivedAssistantCredit(
  window: ReflectionWindow,
  project: string,
  episodeId: string,
  pendingSteps: number,
  threshold = assistantReflectionSteps,
): boolean {
  if (!Number.isSafeInteger(pendingSteps) || pendingSteps < 0) return false
  if (window.project !== null && window.project !== project) resetReflectionWindow(window)
  window.project = project
  window.steps = pendingSteps
  if (tracked(window, episodeId)) return false
  window.pendingIds.push(episodeId)
  return window.drain === null && window.steps >= threshold
}

export function recordFinalizedAssistantWork(
  window: ReflectionWindow,
  project: string,
  episodeId: string,
  assistantEvents: number,
  threshold = assistantReflectionSteps,
): boolean {
  if (!Number.isSafeInteger(assistantEvents) || assistantEvents < 1) return false
  if (window.project !== null && window.project !== project) resetReflectionWindow(window)
  window.project = project
  if (tracked(window, episodeId)) return false
  window.steps += assistantEvents
  window.pendingIds.push(episodeId)
  return window.drain === null && window.steps >= threshold
}

export function completeReflectionDelivery(
  window: ReflectionWindow,
  drainId: number,
  requested: readonly string[],
  delivered: readonly string[],
): readonly string[] {
  if (!window.drain || window.drain.id !== drainId) return []
  const slice = nextReflectionDelivery(window)
  const same = requested.length === slice.length && requested.every((id, index) => id === slice[index])
  const deliveredIds = new Set(delivered)
  const subset = deliveredIds.size === delivered.length && delivered.every((id) => requested.includes(id))
  if (!same || !subset) {
    stopReflectionDrain(window, drainId)
    return []
  }
  const next = window.drain.next + requested.length
  if (next < window.drain.ids.length) {
    window.drain = { id: window.drain.id, ids: window.drain.ids, next }
    return nextReflectionDelivery(window)
  }
  window.steps = Math.max(0, window.steps - window.stepsAtCapture)
  window.stepsAtCapture = 0
  window.drain = null
  return []
}

export function stopReflectionDrain(window: ReflectionWindow, drainId: number) {
  if (!window.drain || window.drain.id !== drainId) return false
  window.steps = Math.max(0, window.steps - window.stepsAtCapture)
  window.stepsAtCapture = 0
  window.drain = null
  return true
}

export function resetReflectionWindow(window: ReflectionWindow) {
  const drainSerial = window.drainSerial
  window.project = null
  window.steps = 0
  window.stepsAtCapture = 0
  window.pendingIds = []
  window.drain = null
  window.drainSerial = drainSerial
}
