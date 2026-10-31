import type {
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionCompactEvent,
} from '@earendil-works/pi-coding-agent'
import { digest } from '../continuity/records.ts'
import { compactionMetadata, observedEpisode, serializeCompactionMetadata } from './engine/episodes.ts'
import { appendedSuffixSync, type SessionAnchor } from './session-branch.ts'
import type { CompactionEpisode } from './store.ts'

// Before/after lifecycle pairing is evidence only, never permission. No summaries or
// full native entries are retained in the boundary or durable observation.
export function compactionBoundary(
  event: Pick<SessionBeforeCompactEvent, 'reason' | 'willRetry' | 'signal'>,
  ctx: ExtensionContext,
) {
  const manager = ctx.sessionManager
  const session = manager.getSessionId()
  const leafId = manager.getLeafId()
  if (event.signal.aborted || (leafId !== null && manager.getEntry(leafId)?.id !== leafId))
    throw Error('Compaction boundary unavailable')
  return { manager, session, leafId, reason: event.reason, willRetry: event.willRetry, signal: event.signal }
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
  const anchor: SessionAnchor = {
    manager: boundary.manager,
    sessionId: boundary.session,
    leafId: boundary.leafId,
  }
  // Exactly one appended entry. A longer, missing, cyclic, sibling, or rewound chain is not that append.
  const verdict = appendedSuffixSync(ctx, anchor, 1)
  if (!verdict.ok || verdict.suffix.length !== 1) throw Error('Compaction branch changed or append ambiguous')
  const entry = verdict.suffix[0]
  if (!entry) throw Error('Compaction branch changed or append ambiguous')
  const reported = event.compactionEntry
  const native = manager.getEntry(reported.id)
  if (
    entry.type !== 'compaction' ||
    entry.parentId !== boundary.leafId ||
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
  return {
    episode: (project: string): CompactionEpisode => ({ ...identity, project }),
    current: () => {
      if (ctx.sessionManager !== manager || manager.getSessionId() !== session || boundary.signal.aborted)
        return false
      const now = appendedSuffixSync(ctx, anchor, 1)
      const leaf = now.ok ? now.suffix[0] : undefined
      return (
        now.ok &&
        now.suffix.length === 1 &&
        leaf?.type === 'compaction' &&
        leaf.id === entry.id &&
        leaf.timestamp === identity.observedAt &&
        leaf.parentId === compaction.parentId &&
        leaf.firstKeptEntryId === compaction.firstKeptEntryId &&
        leaf.tokensBefore === compaction.tokensBefore &&
        Boolean(leaf.fromHook) === compaction.fromExtension
      )
    },
  }
}
