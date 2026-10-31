import type { ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent'
import { setImmediate as yieldTurn } from 'node:timers/promises'

// One operation may follow only this many newly appended parent links.
// Total session history is not a capacity limit. getBranch walks to the root.
export const sessionSuffixBound = 8192

export interface SessionAnchor {
  manager: ExtensionContext['sessionManager']
  sessionId: string
  leafId: string | null
}

export type SuffixVerdict = { ok: true; suffix: SessionEntry[] } | { ok: false; reason: 'branch' }

export function sessionAnchor(ctx: ExtensionContext): SessionAnchor {
  const manager = ctx.sessionManager
  return { manager, sessionId: manager.getSessionId(), leafId: manager.getLeafId() }
}

const identified = (entry: SessionEntry | undefined, id: string) => !!entry && entry.id === id
const parentIdOf = (entry: SessionEntry): string | null | undefined => {
  if (entry.parentId === null || typeof entry.parentId === 'string') return entry.parentId
  return undefined
}

// The public session contract is append-only, but getEntry returns the live
// entry. This walk copies each parent id it follows. It does not freeze older
// entries, and it does not re-read ancestry behind the anchor. A caller that
// mutates those live objects is outside this proof.
const chunkSize = 64
const sameBinding = (ctx: ExtensionContext, anchor: SessionAnchor) => {
  const manager = ctx.sessionManager
  if (manager !== anchor.manager || manager.getSessionId() !== anchor.sessionId) return false
  return anchor.leafId === null || identified(manager.getEntry(anchor.leafId), anchor.leafId)
}

// Append stays valid when the current leaf's parent chain reaches the anchored
// leaf within the bound. The same leaf is an empty suffix. A missing entry,
// cycle, sibling, rewind, manager/session change, or a chain longer than the
// bound is rejected. Stopping at the bound is a branch proof failure, not a
// storage-capacity result, and it does not read past the bound.
export function appendedSuffixSync(
  ctx: ExtensionContext,
  anchor: SessionAnchor,
  bound = sessionSuffixBound,
): SuffixVerdict {
  const manager = ctx.sessionManager
  if (manager !== anchor.manager || manager.getSessionId() !== anchor.sessionId)
    return { ok: false, reason: 'branch' }
  if (anchor.leafId !== null && !identified(manager.getEntry(anchor.leafId), anchor.leafId))
    return { ok: false, reason: 'branch' }
  const leafId = manager.getLeafId()
  if (leafId === anchor.leafId) {
    if (leafId !== null && !identified(manager.getEntry(leafId), leafId))
      return { ok: false, reason: 'branch' }
    return { ok: true, suffix: [] }
  }
  if (leafId === null) return { ok: false, reason: 'branch' }
  const seen = new Set<string>()
  const reversed: SessionEntry[] = []
  let id: string | null = leafId
  while (id !== anchor.leafId) {
    if (id === null || seen.has(id)) return { ok: false, reason: 'branch' }
    if (reversed.length >= bound) return { ok: false, reason: 'branch' }
    seen.add(id)
    const entry = manager.getEntry(id)
    const parentId: string | null | undefined = entry && identified(entry, id) ? parentIdOf(entry) : undefined
    if (!entry || parentId === undefined) return { ok: false, reason: 'branch' }
    reversed.push(entry)
    id = parentId
  }
  reversed.reverse()
  return { ok: true, suffix: reversed }
}

export function sameSessionAnchor(ctx: ExtensionContext, anchor: SessionAnchor) {
  const verdict = appendedSuffixSync(ctx, anchor)
  return verdict.ok && verdict.suffix.length === 0
}

export async function appendedSuffix(
  ctx: ExtensionContext,
  anchor: SessionAnchor,
  bound = sessionSuffixBound,
  guard?: () => void,
): Promise<SuffixVerdict> {
  if (!sameBinding(ctx, anchor)) return { ok: false, reason: 'branch' }
  const manager = anchor.manager
  const leafId = manager.getLeafId()
  if (leafId === anchor.leafId) {
    if (leafId !== null && !identified(manager.getEntry(leafId), leafId))
      return { ok: false, reason: 'branch' }
    return { ok: true, suffix: [] }
  }
  if (leafId === null) return { ok: false, reason: 'branch' }
  const seen = new Set<string>()
  const reversed: SessionEntry[] = []
  let cursor: string | null = leafId
  let taken = 0
  while (cursor !== anchor.leafId) {
    if (cursor === null || seen.has(cursor) || reversed.length >= bound)
      return { ok: false, reason: 'branch' }
    const entry = manager.getEntry(cursor)
    const parentId: string | null | undefined =
      entry && identified(entry, cursor) ? parentIdOf(entry) : undefined
    if (!entry || parentId === undefined) return { ok: false, reason: 'branch' }
    seen.add(cursor)
    reversed.push(entry)
    cursor = parentId
    taken++
    if (taken < chunkSize || cursor === anchor.leafId) continue
    taken = 0
    await yieldTurn()
    // The caller's current/abort guard throws its own error. Do not replace it.
    guard?.()
    if (!sameBinding(ctx, anchor) || ctx.sessionManager !== manager || manager.getLeafId() !== leafId)
      return { ok: false, reason: 'branch' }
  }
  reversed.reverse()
  return { ok: true, suffix: reversed }
}
