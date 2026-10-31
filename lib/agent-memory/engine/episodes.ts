import { bytes, digest, hasSecret, objectShape, validId } from '../../continuity/records.ts'
import type { CompactionEpisode, Episode } from '../store.ts'
import { verificationCommand, verificationResultText } from '../verification-evidence.ts'
import { idPattern } from './schema.ts'

const identity = ['id', 'project', 'session', 'evidence', 'observedAt', 'entryHash']
const turnKeys = [...identity, 'input', 'actions', 'results', 'outcome', 'assistantSteps']
export function compactionMetadata(value: unknown): value is CompactionEpisode['compaction'] {
  return (
    objectShape(value, [
      'entryId',
      'parentId',
      'firstKeptEntryId',
      'tokensBefore',
      'reason',
      'fromExtension',
      'willRetry',
    ]) &&
    validId(value.entryId) &&
    (value.parentId === null || validId(value.parentId)) &&
    validId(value.firstKeptEntryId) &&
    Number.isSafeInteger(value.tokensBefore) &&
    (value.tokensBefore as number) >= 0 &&
    ['manual', 'threshold', 'overflow'].includes(value.reason as string) &&
    typeof value.fromExtension === 'boolean' &&
    typeof value.willRetry === 'boolean'
  )
}

// Fixed producer key order, independent of caller/storage property insertion order.
export function serializeCompactionMetadata(value: CompactionEpisode['compaction']) {
  return JSON.stringify({
    entryId: value.entryId,
    parentId: value.parentId,
    firstKeptEntryId: value.firstKeptEntryId,
    tokensBefore: value.tokensBefore,
    reason: value.reason,
    fromExtension: value.fromExtension,
    willRetry: value.willRetry,
  })
}

// One closed reader for ABI1, ABI2 requests and ABI2 replies. Legacy bytes are never rewritten.
export function observedEpisode(value: unknown): Episode {
  if (
    !objectShape(value, [
      ...identity,
      'kind',
      'compaction',
      'input',
      'actions',
      'results',
      'outcome',
      'assistantSteps',
    ]) ||
    typeof value.id !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.id) ||
    typeof value.project !== 'string' ||
    !idPattern.test(value.project) ||
    !validId(value.session) ||
    value.evidence !== 'observed-native-unverified' ||
    typeof value.observedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.observedAt) ||
    typeof value.entryHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.entryHash)
  )
    throw Error('Invalid observed episode; caller provenance labels are not accepted')
  if (value.kind === 'compaction') {
    if (
      !objectShape(value, [...identity, 'kind', 'compaction']) ||
      !compactionMetadata(value.compaction) ||
      value.id !== digest(`${value.session}:compact:${value.compaction.entryId}`) ||
      value.entryHash !== digest(serializeCompactionMetadata(value.compaction))
    )
      throw Error('Invalid compaction episode')
  } else {
    if (
      !objectShape(value, turnKeys) ||
      value.outcome !== 'completed' ||
      !objectShape(value.input, ['text', 'source']) ||
      typeof value.input.text !== 'string' ||
      !['rpc', 'interactive'].includes(value.input.source as string) ||
      !Array.isArray(value.actions) ||
      value.actions.length > 4 ||
      !Array.isArray(value.results) ||
      value.results.length > 4
    )
      throw Error('Invalid observed episode; caller provenance labels are not accepted')
    for (const action of value.actions)
      if (
        !objectShape(action, ['text', 'tools']) ||
        (action.text !== undefined && typeof action.text !== 'string') ||
        (action.tools !== undefined &&
          (!Array.isArray(action.tools) ||
            action.tools.length > 8 ||
            action.tools.some((n: unknown) => typeof n !== 'string' || !/^[a-z_]{1,64}$/.test(n))))
      )
        throw Error('Invalid observed action')
    for (const result of value.results) {
      if (
        !objectShape(result, ['tool', 'error', 'text', 'command']) ||
        result.tool !== 'bash' ||
        typeof result.error !== 'boolean' ||
        (result.text !== undefined && typeof result.text !== 'string') ||
        (result.command !== undefined && verificationCommand(result.command) !== result.command)
      )
        throw Error('Invalid selected result')
      // Commandless records keep the previous text check: a string, then the
      // episode-level secret and size checks below. Strict decoding applies only
      // when a command is present, so older "100%" and Windows-path results still read.
      if (result.command !== undefined && typeof result.text === 'string') {
        const decision = verificationResultText(result.text)
        if (decision.kind !== 'keep' || !decision.strict || decision.text !== result.text)
          throw Error('Episode rejected')
      }
    }
    if (
      value.assistantSteps !== undefined &&
      (!Number.isSafeInteger(value.assistantSteps) ||
        (value.assistantSteps as number) < 0 ||
        (value.assistantSteps as number) > 1024)
    )
      throw Error('Invalid observed episode; caller provenance labels are not accepted')
  }
  const raw = JSON.stringify(value)
  if (bytes(raw) > 16384 || hasSecret(raw)) throw Error('Episode rejected')
  return value as unknown as Episode
}

export function episodeAssistantSteps(episode: Episode) {
  if ('kind' in episode) return 0
  return episode.assistantSteps ?? 0
}
