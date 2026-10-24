import { objectShape } from '../../continuity/records.ts'

export type AttemptOutcome =
  | 'pending'
  | 'integrated'
  | 'conflict'
  | 'native-unsuccessful'
  | 'not-ready'
  | 'integration-unavailable'
  | 'deadline'
  | 'cancelled'
  | 'dispatch-failed'
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const time = () => Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(Date.now())))
export function createAttempt(selectedEpisodeCount: number, deadlineAt: number) {
  let dispatchedAt: number | null = null
  let outcome: AttemptOutcome = 'pending'
  let read: (() => unknown) | undefined
  return {
    bind(observe: () => unknown) {
      read = observe
      dispatchedAt = time()
    },
    finish(result: AttemptOutcome) {
      if (outcome === 'pending') outcome = result
    },
    snapshot() {
      let record: unknown
      try {
        record = read?.()
      } catch {
        /* unavailable stays unknown */
      }
      const value =
        record && typeof record === 'object' && !Array.isArray(record)
          ? (record as Record<string, unknown>)
          : undefined
      const status = value?.status
      const nativeStatus =
        typeof status === 'string' &&
        ['queued', 'running', 'completed', 'aborted', 'stopped', 'error'].includes(status)
          ? status
          : 'unknown'
      const budget = value?.turnBudget
      const b = objectShape(budget, ['used', 'maxTurns', 'phase']) ? budget : undefined
      const phase = b?.phase
      return {
        phase:
          nativeStatus === 'queued' || nativeStatus === 'running'
            ? nativeStatus
            : nativeStatus === 'unknown'
              ? 'unknown'
              : 'terminal',
        nativeStatus,
        outcome,
        dispatchedAt,
        observedAt: time(),
        deadlineAt,
        selectedEpisodeCount,
        latestToolEnd: null, // no native tool-end observation installed in ABI2; never fabricated
        progress: {
          toolUses: count(value?.toolUses),
          turnBudget: {
            used: count(b?.used),
            maxTurns: count(b?.maxTurns),
            phase: phase === 'within' || phase === 'warned' || phase === 'exhausted' ? phase : null,
          },
        },
        backlog: { total: null, selectedLowerBound: selectedEpisodeCount, complete: false },
      }
    },
  }
}
