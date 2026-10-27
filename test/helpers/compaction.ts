import type { SessionCompactEvent } from '@earendil-works/pi-coding-agent'

// Synthetic event/branch shape for unit tests, not genuine native lifecycle proof.
export function syntheticCompaction(id = 'compact-one'): SessionCompactEvent {
  return {
    type: 'session_compact',
    reason: 'threshold',
    fromExtension: false,
    willRetry: false,
    compactionEntry: {
      type: 'compaction',
      id,
      parentId: 'parent-one',
      timestamp: '2026-07-24T00:00:00.000Z',
      firstKeptEntryId: 'kept-one',
      tokensBefore: 12000,
      summary: 'SYNTHETIC_SUMMARY_NOT_PERSISTED',
      details: { private: 'SYNTHETIC_DETAILS_NOT_PERSISTED' },
    },
  }
}
