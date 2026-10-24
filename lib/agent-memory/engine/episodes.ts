import { bytes, hasSecret, objectShape, validId } from '../../continuity/records.ts'
import type { Episode } from '../store.ts'
import { idPattern } from './schema.ts'

// Same bounded data contract as the legacy oracle; no transcript/tool-argument endpoint.
export function observedEpisode(value: unknown): Episode {
  if (
    !objectShape(value, [
      'id',
      'project',
      'session',
      'evidence',
      'observedAt',
      'entryHash',
      'input',
      'actions',
      'results',
      'outcome',
    ]) ||
    typeof value.id !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.id) ||
    typeof value.project !== 'string' ||
    !idPattern.test(value.project) ||
    !validId(value.session) ||
    value.evidence !== 'observed-native-unverified' ||
    value.outcome !== 'completed' ||
    typeof value.observedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.observedAt) ||
    typeof value.entryHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.entryHash) ||
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
  for (const result of value.results)
    if (
      !objectShape(result, ['tool', 'error', 'text']) ||
      result.tool !== 'bash' ||
      typeof result.error !== 'boolean' ||
      (result.text !== undefined && typeof result.text !== 'string')
    )
      throw Error('Invalid selected result')
  const raw = JSON.stringify(value)
  if (bytes(raw) > 16384 || hasSecret(raw)) throw Error('Episode rejected')
  return value as unknown as Episode
}
