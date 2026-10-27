// Native module owns identity across Jiti/native/query-loaded TypeScript wrappers.
// This is diagnostic provenance only, never permission, liveness or publication truth.
const failures = new WeakMap()
const reasons = new Set(['capacity', 'deadline', 'branch', 'CAS', 'retention', 'unknown'])
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
