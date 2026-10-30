import { randomUUID } from 'node:crypto'
import { bytes, hasSecret } from '../continuity/records.ts'

export interface MemoryProjectionReceipt {
  revision: string
  configHash: string
  capturedAt: string
  emittedBlockUtf8Bytes: number
}

export interface MemoryInvocationContext {
  version: 1
  kind: 'abi2-invocation-context'
  captureId: string
  capturedAt: string
  binding: {
    primary: true
    authority: 'abi2'
    revision: string
    configHash: string
  }
  model: null | {
    provider: string
    id: string
  }
  usage:
    | {
        available: true
        source: 'pi-public-estimate'
        tokens: number | null
        contextWindow: number
        percent: number | null
      }
    | {
        available: false
        source: 'pi-public-estimate'
        reason: 'unavailable' | 'invalid'
      }
  effectiveSystemPrompt:
    | {
        available: true
        source: 'pi-current-effective-system-prompt'
        utf8Bytes: number
      }
    | {
        available: false
        source: 'pi-current-effective-system-prompt'
        reason: 'unavailable' | 'invalid'
      }
  memoryProjection: null | ({ source: 'abi2-before-agent-start-output' } & MemoryProjectionReceipt)
  providerPrompt: 'unavailable'
  categoryTokenAccounting: 'unavailable'
}

const safeIdentity = (value: unknown, max: number): string | undefined => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    bytes(value) > max ||
    hasSecret(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return undefined
  return value
}

const safeCount = (value: unknown, maximum: number): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : undefined

const safePercent = (value: unknown): number | null | undefined =>
  value === null
    ? null
    : typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
      ? value
      : undefined

function contextUsage(value: unknown): MemoryInvocationContext['usage'] {
  if (value === undefined) return { available: false, source: 'pi-public-estimate', reason: 'unavailable' }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { available: false, source: 'pi-public-estimate', reason: 'invalid' }
  const usage = value as Record<string, unknown>
  const contextWindow = safeCount(usage.contextWindow, 10_000_000)
  const tokens = usage.tokens === null ? null : safeCount(usage.tokens, 10_000_000)
  const percent = safePercent(usage.percent)
  if (contextWindow === undefined || contextWindow < 1 || tokens === undefined || percent === undefined)
    return { available: false, source: 'pi-public-estimate', reason: 'invalid' }
  return {
    available: true,
    source: 'pi-public-estimate',
    tokens,
    contextWindow,
    percent,
  }
}

function effectiveSystemPrompt(value: unknown): MemoryInvocationContext['effectiveSystemPrompt'] {
  if (value === undefined)
    return {
      available: false,
      source: 'pi-current-effective-system-prompt',
      reason: 'unavailable',
    }
  if (typeof value !== 'string')
    return {
      available: false,
      source: 'pi-current-effective-system-prompt',
      reason: 'invalid',
    }
  return {
    available: true,
    source: 'pi-current-effective-system-prompt',
    utf8Bytes: bytes(value),
  }
}

export function buildMemoryInvocationContext(input: {
  revision: string
  configHash: string
  model: unknown
  usage: unknown
  systemPrompt: unknown
  projection: MemoryProjectionReceipt | undefined
  now?: Date
}): MemoryInvocationContext {
  if (!/^[a-f0-9]{40,64}$/.test(input.revision) || !/^[a-f0-9]{64}$/.test(input.configHash))
    throw Error('Invocation context identity unavailable')
  const candidate = input.model as { provider?: unknown; id?: unknown } | undefined
  const provider = safeIdentity(candidate?.provider, 120)
  const id = safeIdentity(candidate?.id, 240)
  const model = provider && id ? { provider, id } : null
  const result: MemoryInvocationContext = {
    version: 1,
    kind: 'abi2-invocation-context',
    captureId: randomUUID(),
    capturedAt: (input.now ?? new Date()).toISOString(),
    binding: {
      primary: true,
      authority: 'abi2',
      revision: input.revision,
      configHash: input.configHash,
    },
    model,
    usage: contextUsage(input.usage),
    effectiveSystemPrompt: effectiveSystemPrompt(input.systemPrompt),
    memoryProjection: input.projection
      ? { source: 'abi2-before-agent-start-output', ...input.projection }
      : null,
    providerPrompt: 'unavailable',
    categoryTokenAccounting: 'unavailable',
  }
  if (bytes(JSON.stringify(result)) > 4096) throw Error('Invocation context reply exceeds bound')
  return result
}
