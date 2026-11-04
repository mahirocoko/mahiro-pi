import { createRequire } from 'node:module'

export type MemoryReason =
  | 'capacity'
  | 'deadline'
  | 'branch'
  | 'CAS'
  | 'retention'
  | 'draft'
  | 'offline-only'
  | 'invalid-arguments'
  | 'out-of-scope'
  | 'read-only'
  | 'patch-target-not-found'
  | 'patch-target-ambiguous'
  | 'budget'
  | 'unknown'
export interface MemoryFailureCode {
  reason: MemoryReason
  readInvalidation?: 'forgetting' | 'revision'
}
export type OfflineResetFailureCode =
  | 'holder-present'
  | 'holder-inspection'
  | 'unsafe-entry'
  | 'scan'
  | 'authority'
  | 'reset-owner'
  | 'reset-binding'
  | 'offline-context'
  | 'maintenance-authority'
  | 'idle'
  | 'branch'
  | 'standard-root'
  | 'reset-preflight'
  | 'reset-controller-busy'
  | 'reset-request-shape'
  | 'fingerprint'
const require = createRequire(import.meta.url)
const native = require('./reasons.mjs') as {
  memoryFailure(reason: MemoryReason, message: string, readInvalidation?: 'forgetting' | 'revision'): Error
  memoryFailureCode(error: unknown): Readonly<MemoryFailureCode>
  offlineResetFailure<T>(error: T, code: OfflineResetFailureCode): T
  offlineResetFailureCode(error: unknown): OfflineResetFailureCode | undefined
}
export const { memoryFailure, memoryFailureCode, offlineResetFailure, offlineResetFailureCode } = native

// Fixed text only. In particular, an Error's message is NOT evidence of its source.
export function publicMemoryError(error: unknown, read = false): Error {
  const code = memoryFailureCode(error)
  if (read && code.readInvalidation)
    return new Error(
      code.readInvalidation === 'forgetting'
        ? 'Managed memory unavailable: current forgetting invalidates this retained view; proposal preserved'
        : 'Managed memory unavailable: current revision changed during read; proposal preserved',
    )
  const text: Record<MemoryReason, string> = {
    capacity: 'capacity limit reached; retained state preserved; explicit owner review required',
    deadline: 'operation deadline reached; work may still be draining; publication unknown',
    branch: 'current branch changed; retained proposal preserved',
    CAS: 'revision or expectedHash conflict; retained proposal preserved — call agent_memory_read to get the current hash/revision',
    retention:
      'lossless retention guard refused the proposal; published knowledge not replaced — pass allowShrink: true to agent_memory_commit if intentional, or archive details to reference/',
    draft:
      'primary draft expired, scope/configuration changed, or creation pending; proposal preserved; explicit owner review required',
    'offline-only': 'reset requires the explicit native offline operator, not an active primary session',
    'invalid-arguments':
      'invalid arguments or mutually exclusive read selectors; check required fields and mode limits',
    'out-of-scope': 'target path is outside the allowed memory layout or current project scope',
    'read-only': 'target file has read_only: true frontmatter and cannot be modified or removed',
    'patch-target-not-found':
      'surgical patch oldText not found in current file; read the file again or use mode="replace"',
    'patch-target-ambiguous':
      'surgical patch oldText matches multiple locations; include more surrounding context',
    budget: 'file size or total memory budget exceeded; keep files concise or move details to reference/',
    unknown: 'valid arguments, scope, CAS, separate permission and healthy native binding required',
  }
  return new Error(`Managed memory unavailable: ${text[code.reason]} (reason: ${code.reason})`)
}

// Child diagnostics are accepted only after the controller checks epoch + active request ID
// and the exact error-only response shape. This metadata never grants authority.
export function decodeMemoryFailure(value: unknown): Error {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid engine error')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Object.keys(descriptors)
  if (
    !keys.includes('reason') ||
    keys.some((key) => !['reason', 'readInvalidation'].includes(key)) ||
    keys.some((key) => !('value' in descriptors[key]))
  )
    throw Error('Invalid engine error')
  const reason = descriptors.reason.value as unknown
  const readInvalidation = descriptors.readInvalidation?.value as unknown
  if (
    ![
      'capacity',
      'deadline',
      'branch',
      'CAS',
      'retention',
      'draft',
      'offline-only',
      'invalid-arguments',
      'out-of-scope',
      'read-only',
      'patch-target-not-found',
      'patch-target-ambiguous',
      'budget',
      'unknown',
    ].includes(reason as string) ||
    (readInvalidation !== undefined &&
      !(
        (readInvalidation === 'forgetting' && reason === 'unknown') ||
        (readInvalidation === 'revision' && reason === 'CAS')
      ))
  )
    throw Error('Invalid engine error')
  return memoryFailure(
    reason as MemoryReason,
    'Engine operation unavailable',
    readInvalidation as MemoryFailureCode['readInvalidation'],
  )
}

// Durable receipt detail is bounded but not trusted prose. Preserve uncertainty/stage,
// hashes and dirty/lock facts, never echo arbitrary stored or subprocess error text.
export function publicReceipt<T extends { detail?: string }>(receipt: T): T {
  return {
    ...receipt,
    ...(receipt.detail === undefined
      ? {}
      : { detail: 'Publication detail withheld; retain recovery evidence' }),
  }
}
