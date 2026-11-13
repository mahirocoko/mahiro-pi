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
  'recovery-plan',
  'recovery-layout',
  'recovery-journal',
  'recovery-lock',
  'recovery-artifacts',
  'recovery-commit',
  'recovery-proposal',
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
  'invalid-arguments',
  'out-of-scope',
  'read-only',
  'patch-target-not-found',
  'patch-target-ambiguous',
  'budget',
  'unknown',
])
const stages = new Set([
  'binding',
  'target-authority',
  'config',
  'certify-head',
  'certify-ledger',
  'certify-tree',
  'certify-file-budget',
  'certify-total-budget',
  'certify-blobs',
  'status-journal',
  'status-policy',
])
export function memoryFailure(reason, message, readInvalidation, failureStage) {
  const error = new Error(message)
  const value = { reason: reasons.has(reason) ? reason : 'unknown' }
  if (readInvalidation === 'forgetting' || readInvalidation === 'revision')
    value.readInvalidation = readInvalidation
  if (stages.has(failureStage)) value.failureStage = failureStage
  failures.set(error, Object.freeze(value))
  return error
}
export function memoryFailureStage(error, stage) {
  const code = failures.get(error)
  if (code?.failureStage || !stages.has(stage)) return error
  return memoryFailure(
    code?.reason ?? 'unknown',
    'Memory operation unavailable',
    code?.readInvalidation,
    stage,
  )
}
export function memoryFailureCode(error) {
  // No properties/getters, prototype, name, message, cause or caller-supplied tags are inspected.
  return failures.get(error) ?? Object.freeze({ reason: 'unknown' })
}
