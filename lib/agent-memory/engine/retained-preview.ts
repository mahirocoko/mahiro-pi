import { bytes, digest, objectShape } from '../../continuity/records.ts'
import { parseDraft } from './manifest.ts'

export interface RetainedDraftPreview {
  version: 1
  kind: 'abi2-retained-draft-preview'
  revision: string
  configHash: string
  scanLimit: 8192
  association: 'sequential-non-atomic'
  quiescence: 'unproven'
  mutation: 'not-performed'
  safeCandidates: 0
  reason: 'cross-controller-exclusion-unproven'
  observed: {
    examined: number
    exact: boolean
    terminal: number
    open: number
    ready: number
    conflict: number
    unknown: number
    dirty: number
    journalReferenced: number
    locallyActive: number
    unstable: number
  }
  corpusReturned: false
}

export type DraftClass =
  | 'terminal'
  | 'open'
  | 'ready'
  | 'conflict'
  | 'unknown'
  | 'dirty'
  | 'journalReferenced'
  | 'locallyActive'
  | 'unstable'

/** Shared disk classification. A live preview cannot prove another controller is absent. */
export function classifyRetainedManifest(input: {
  id: string
  first: string
  second: string
  referenced: boolean
  locallyActive: boolean
}): DraftClass {
  if (input.first !== input.second || digest(input.first) !== digest(input.second)) return 'unstable'
  let draft: ReturnType<typeof parseDraft>
  try {
    if (bytes(input.first) > 2 * 1024 * 1024) return 'unknown'
    draft = parseDraft(input.first)
  } catch {
    return 'unknown'
  }
  if (draft.id !== input.id) return 'unknown'
  if (input.locallyActive) return 'locallyActive'
  if (input.referenced) return 'journalReferenced'
  if (Object.keys(draft.overlay).length > 0) return 'dirty'
  if (draft.state === 'open' || draft.state === 'ready' || draft.state === 'conflict') return draft.state
  if (draft.state === 'cancelled' || draft.state === 'committed') return 'terminal'
  return 'unknown'
}

export function assertRetainedDraftPreview(value: unknown) {
  if (
    !objectShape(value, [
      'version',
      'kind',
      'revision',
      'configHash',
      'scanLimit',
      'association',
      'quiescence',
      'mutation',
      'safeCandidates',
      'reason',
      'observed',
      'corpusReturned',
    ]) ||
    value.version !== 1 ||
    value.kind !== 'abi2-retained-draft-preview' ||
    value.scanLimit !== 8192 ||
    value.association !== 'sequential-non-atomic' ||
    value.quiescence !== 'unproven' ||
    value.mutation !== 'not-performed' ||
    value.safeCandidates !== 0 ||
    value.reason !== 'cross-controller-exclusion-unproven' ||
    value.corpusReturned !== false ||
    typeof value.revision !== 'string' ||
    typeof value.configHash !== 'string'
  )
    throw Error('Invalid deeply validated engine reply')
  const observed = value.observed
  if (
    !objectShape(observed, [
      'examined',
      'exact',
      'terminal',
      'open',
      'ready',
      'conflict',
      'unknown',
      'dirty',
      'journalReferenced',
      'locallyActive',
      'unstable',
    ]) ||
    typeof observed.exact !== 'boolean' ||
    typeof observed.examined !== 'number' ||
    observed.examined > 8192
  )
    throw Error('Invalid deeply validated engine reply')
  const counts = [
    observed.examined,
    observed.terminal,
    observed.open,
    observed.ready,
    observed.conflict,
    observed.unknown,
    observed.dirty,
    observed.journalReferenced,
    observed.locallyActive,
    observed.unstable,
  ]
  if (
    counts.some(
      (count) => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 8192,
    )
  )
    throw Error('Invalid deeply validated engine reply')
}
