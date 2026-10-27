import type {
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionCompactEvent,
} from '@earendil-works/pi-coding-agent'
import { digest } from '../continuity/records.ts'
import { compactionMetadata, observedEpisode, serializeCompactionMetadata } from './engine/episodes.ts'
import type { CompactionEpisode } from './store.ts'

// Before/after lifecycle pairing is evidence only, never permission. No summaries or
// full native entries are retained in the boundary or durable observation.
export function compactionBoundary(
  event: Pick<SessionBeforeCompactEvent, 'reason' | 'willRetry' | 'signal'>,
  ctx: ExtensionContext,
) {
  const manager = ctx.sessionManager
  const session = manager.getSessionId()
  const branch = manager.getBranch()
  if (event.signal.aborted || branch.length > 8191) throw Error('Compaction boundary unavailable')
  const prefix = branch.map((entry) => entry.id)
  if (new Set(prefix).size !== prefix.length) throw Error('Ambiguous compaction branch')
  return { manager, session, prefix, reason: event.reason, willRetry: event.willRetry, signal: event.signal }
}

// Select metadata only. Never serialize/hash the full native entry: it contains summary,
// details, usage and systemMessage. A lifecycle event supplies evidence, not authority.
export function compactionObservation(
  event: SessionCompactEvent,
  ctx: ExtensionContext,
  boundary: ReturnType<typeof compactionBoundary>,
) {
  const manager = ctx.sessionManager
  if (
    !boundary ||
    manager !== boundary.manager ||
    manager.getSessionId() !== boundary.session ||
    boundary.signal.aborted ||
    event.reason !== boundary.reason ||
    event.willRetry !== boundary.willRetry
  )
    throw Error('Unpaired compaction event')
  const entries = manager.getBranch()
  if (
    entries.length !== boundary.prefix.length + 1 ||
    entries.length > 8192 ||
    !boundary.prefix.every((id, index) => entries[index]?.id === id) ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length
  )
    throw Error('Compaction branch changed or append ambiguous')
  const entry = entries.at(-1)!
  const reported = event.compactionEntry
  const native = manager.getEntry(reported.id)
  if (
    entry.type !== 'compaction' ||
    entry.parentId !== (boundary.prefix.at(-1) ?? null) ||
    native?.id !== reported.id ||
    native.type !== 'compaction' ||
    native.timestamp !== reported.timestamp ||
    native.parentId !== reported.parentId ||
    native.firstKeptEntryId !== reported.firstKeptEntryId ||
    native.tokensBefore !== reported.tokensBefore ||
    native.summary !== reported.summary ||
    Boolean(native.fromHook) !== Boolean(reported.fromHook) ||
    Boolean(entry.fromHook) !== event.fromExtension
  )
    throw Error('Compaction entry is not the paired native append')
  // SDK 1.3 finds the FIRST saved entry by summary across the whole session,
  // including sibling branches. getEntry binds that report to this same manager.
  // Recover only the uniquely paired new leaf with an equal summary. This comparison
  // is transient; summary content never enters the boundary, episode or its digest.
  if (
    reported.id !== entry.id &&
    (typeof entry.summary !== 'string' ||
      typeof reported.summary !== 'string' ||
      entry.summary !== reported.summary ||
      native.summary !== reported.summary)
  )
    throw Error('Historical compaction event does not match the native append')
  const compaction: CompactionEpisode['compaction'] = {
    entryId: entry.id,
    parentId: entry.parentId,
    firstKeptEntryId: entry.firstKeptEntryId,
    tokensBefore: entry.tokensBefore,
    reason: event.reason,
    fromExtension: event.fromExtension,
    willRetry: event.willRetry,
  }
  if (!compactionMetadata(compaction)) throw Error('Invalid compaction metadata')
  const session = boundary.session
  const identity = {
    id: digest(`${session}:compact:${entry.id}`),
    session,
    evidence: 'observed-native-unverified' as const,
    observedAt: entry.timestamp,
    entryHash: digest(serializeCompactionMetadata(compaction)),
    kind: 'compaction' as const,
    compaction,
  }
  observedEpisode({ ...identity, project: 'validation' })
  const prefix = entries.map((value) => value.id)
  return {
    episode: (project: string): CompactionEpisode => ({ ...identity, project }),
    current: () => {
      if (ctx.sessionManager !== manager || manager.getSessionId() !== session || boundary.signal.aborted)
        return false
      const branch = manager.getBranch()
      const leaf = branch.at(-1)
      return (
        branch.length === prefix.length &&
        prefix.every((id, index) => branch[index]?.id === id) &&
        leaf?.type === 'compaction' &&
        leaf.timestamp === identity.observedAt &&
        leaf.parentId === compaction.parentId &&
        leaf.firstKeptEntryId === compaction.firstKeptEntryId &&
        leaf.tokensBefore === compaction.tokensBefore &&
        Boolean(leaf.fromHook) === compaction.fromExtension
      )
    },
  }
}
