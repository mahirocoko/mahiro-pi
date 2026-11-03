// Native module owns identity across Jiti/native/query-loaded TypeScript wrappers.
// This is diagnostic provenance only, never permission, liveness or publication truth.
const failures = new WeakMap()
const resetFailures = new WeakMap()
const resetCodes = new Set([
  'holder-present',
  'holder-inspection',
  'unsafe-entry',
  'scan',
  'authority',
  'reset-owner',
  'reset-binding',
  'offline-context',
  'maintenance-authority',
  'idle',
  'branch',
  'standard-root',
  'reset-preflight',
  'reset-controller-busy',
  'reset-request-shape',
  'fingerprint',
])
export function offlineResetFailure(error, code) {
  if (error instanceof Error && resetCodes.has(code) && !resetFailures.has(error))
    resetFailures.set(error, code)
  return error
}
export function offlineResetFailureCode(error) {
  return resetFailures.get(error)
}
const reasons = new Set([
  'capacity',
  'deadline',
  'branch',
  'CAS',
  'retention',
  'draft',
  'offline-only',
  'unknown',
])
export function memoryFailure(reason, message, readInvalidation) {
  const error = new Error(message)
  const value = { reason: reasons.has(reason) ? reason : 'unknown' }
  if (readInvalidation === 'forgetting' || readInvalidation === 'revision')
    value.readInvalidation = readInvalidation
  failures.set(error, Object.freeze(value))
  return error
}
export function memoryFailureCode(error) {
  // No properties/getters, prototype, name, message, cause or caller-supplied tags are inspected.
  return failures.get(error) ?? Object.freeze({ reason: 'unknown' })
}
