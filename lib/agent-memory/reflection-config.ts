export const reflectionTriggers = ['off', 'step-count', 'compaction-event'] as const
export type ReflectionTrigger = (typeof reflectionTriggers)[number]
export const defaultReflectionSteps = 25
export const maxReflectionSteps = 100_000

const v1Keys = 'automatic,coreBytes,fileBytes,indexBytes,projects,totalBytes,version'
const v2Keys =
  'automatic,coreBytes,fileBytes,indexBytes,projects,reflectionStepCount,reflectionTrigger,totalBytes,version'

export function automaticForTrigger(trigger: ReflectionTrigger) {
  return trigger !== 'off'
}

export function validReflectionStepCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= maxReflectionSteps
}

export function validReflectionTrigger(value: unknown): value is ReflectionTrigger {
  return reflectionTriggers.includes(value as ReflectionTrigger)
}

// Version 1 is the seven-key automatic record. Version 2 adds the explicit
// trigger and step count. A version-1 object that also carries those fields is
// invalid, so an in-flight v1 record cannot be read as compaction-event.
export function configRecordVersion(value: object): 1 | 2 | undefined {
  const keys = Object.keys(value).sort().join()
  const version = (value as { version?: unknown }).version
  if (keys === v1Keys && version === 1) return 1
  if (keys === v2Keys && version === 2) return 2
  return undefined
}

export function reflectionSelectionValid(value: {
  automatic?: unknown
  reflectionTrigger?: unknown
  reflectionStepCount?: unknown
}) {
  return (
    validReflectionTrigger(value.reflectionTrigger) &&
    validReflectionStepCount(value.reflectionStepCount) &&
    value.automatic === automaticForTrigger(value.reflectionTrigger)
  )
}

export function reflectionPolicy(config: {
  version?: unknown
  automatic: boolean
  reflectionTrigger?: unknown
  reflectionStepCount?: unknown
}): { trigger: ReflectionTrigger; stepCount: number } {
  if (
    config.version === 2 &&
    validReflectionTrigger(config.reflectionTrigger) &&
    validReflectionStepCount(config.reflectionStepCount)
  )
    return { trigger: config.reflectionTrigger, stepCount: config.reflectionStepCount }
  return { trigger: config.automatic ? 'step-count' : 'off', stepCount: defaultReflectionSteps }
}
