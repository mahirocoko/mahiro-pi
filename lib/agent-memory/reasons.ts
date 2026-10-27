import { createRequire } from 'node:module'

export type MemoryReason = 'capacity' | 'deadline' | 'branch' | 'CAS' | 'retention' | 'unknown'
export interface MemoryFailureCode {
  reason: MemoryReason
  readInvalidation?: 'forgetting' | 'revision'
}
const require = createRequire(import.meta.url)
const native = require('./reasons.mjs') as {
  memoryFailure(reason: MemoryReason, message: string, readInvalidation?: 'forgetting' | 'revision'): Error
  memoryFailureCode(error: unknown): Readonly<MemoryFailureCode>
}
export const { memoryFailure, memoryFailureCode } = native

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
    CAS: 'revision or hash conflict; retained proposal preserved',
    retention: 'lossless retention guard refused the proposal; published knowledge not replaced',
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
    !['capacity', 'deadline', 'branch', 'CAS', 'retention', 'unknown'].includes(reason as string) ||
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
