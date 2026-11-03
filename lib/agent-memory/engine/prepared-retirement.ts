import type { MemoryRetirementResult } from '../experimental-contracts.ts'
import { assertCurrent, type OperationContext } from './controller.ts'
import { inspectPreparedPublication } from './offline-maintenance.ts'

// A useful, non-destructive handoff for today's legacy roots. Deliberately separate
// from runtime lifetime.track: a retirement request must never join itself.
// There is no online archive authority in this slice and no manufactured offline assurance.
export async function retirePreparedPublication(
  root: string,
  context: OperationContext,
  retire: () => Promise<MemoryRetirementResult>,
) {
  await inspectPreparedPublication(root, context) // refuse policy/unknown/dirty/draft owners before retiring
  assertCurrent(context)
  const result = await retire() // actual kernel fence + native/controller/worker joins, foreground stays open
  assertCurrent(context)
  if (result.state !== 'drained')
    return {
      state: 'offline-required',
      reason: 'generation-retirement-unsupported',
      globalQuiescence: false,
      barrier: 'not-created',
      handoff: 'offline-inspect-required',
    } as const
  // The first fingerprint is not reused: already-started work had to join first.
  const reviewed = await inspectPreparedPublication(root, context)
  assertCurrent(context)
  return {
    ...reviewed,
    state: 'offline-required',
    generation: 'drained',
    globalQuiescence: false,
    barrier: 'not-created',
    mutationsPerformed: false,
    archiveRetained: false,
    proposalsActivated: false,
    handoff: {
      inspect: 'offline-inspect',
      action: 'offline-adopt',
      target: reviewed.target,
      revision: reviewed.revision,
      assuranceRequired: true,
      reinspectionRequired: true,
    },
  } as const
}
