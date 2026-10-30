import { bytes, objectShape } from '../continuity/records.ts'
import type { MemoryInvocationContext } from './invocation-context.ts'
import { assertKnowledgeHistory, type KnowledgeHistory, historyOID } from './knowledge-history.ts'
import type { PalaceDiagnostic } from './palace-diagnostic.ts'
import { assertPalaceStructure, type PalaceStructureFile } from './palace-structure.ts'

export interface PalaceHandoff {
  version: 1
  kind: 'abi2-palace-html-handoff'
  diagnostic: PalaceDiagnostic
  history: KnowledgeHistory
  delivery: {
    immutable: true
    expiresAt: string
    refresh: 'new-command-required'
  }
}

const maxHandoffBytes = 48 * 1024
const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const captureId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function buildPalaceHandoff(input: {
  diagnostic: PalaceDiagnostic
  history: KnowledgeHistory
  expiresAt: Date
}): PalaceHandoff {
  const diagnostic = copyDiagnostic(input.diagnostic)
  const history = copyHistory(input.history)
  const expiresAt = input.expiresAt.toISOString()
  if (!canonicalTime(expiresAt)) throw Error('Palace HTML handoff unavailable')
  if (
    diagnostic.captureId !== diagnostic.context.captureId ||
    diagnostic.context.binding.revision !== diagnostic.structure.revision ||
    diagnostic.context.binding.configHash !== diagnostic.structure.configHash ||
    history.offset !== 0 ||
    history.revision !== diagnostic.structure.revision ||
    history.configHash !== diagnostic.structure.configHash ||
    history.project !== diagnostic.structure.project
  )
    throw Error('Palace HTML handoff identity mismatch')
  const result: PalaceHandoff = {
    version: 1,
    kind: 'abi2-palace-html-handoff',
    diagnostic,
    history,
    delivery: { immutable: true, expiresAt, refresh: 'new-command-required' },
  }
  if (bytes(JSON.stringify(result)) > maxHandoffBytes) throw Error('Palace HTML handoff exceeds bound')
  return freeze(result)
}

function copyDiagnostic(value: PalaceDiagnostic): PalaceDiagnostic {
  exact(value, ['version', 'kind', 'captureId', 'replay', 'consistency', 'context', 'structure'])
  exact(value.consistency, [
    'atomic',
    'committedSnapshot',
    'invocationAssociation',
    'revision',
    'config',
    'lifecycle',
  ])
  if (
    value.version !== 2 ||
    value.kind !== 'abi2-palace-context-diagnostic' ||
    typeof value.captureId !== 'string' ||
    !captureId.test(value.captureId) ||
    value.replay !== 'unsupported' ||
    value.consistency.atomic !== false ||
    value.consistency.committedSnapshot !== 'owner-certified' ||
    value.consistency.invocationAssociation !== 'observed-non-atomic' ||
    value.consistency.revision !== 'matched-at-checks' ||
    value.consistency.config !== 'matched-at-checks' ||
    value.consistency.lifecycle !== 'omitted'
  )
    refused()
  exact(value.structure, [
    'version',
    'revision',
    'configHash',
    'project',
    'basis',
    'currentness',
    'bodyInspection',
    'structureDigest',
    'snapshotDigest',
    'upstreamOutput',
    'output',
    'files',
  ])
  if (!Array.isArray(value.structure.files)) refused()
  const files: PalaceStructureFile[] = value.structure.files.map((file) => {
    exact(file, ['path', 'layer', 'bytes', 'protectedRetention', 'alwaysLoaded', 'sourcesCount'])
    return {
      path: file.path,
      layer: file.layer,
      bytes: file.bytes,
      protectedRetention: file.protectedRetention,
      alwaysLoaded: file.alwaysLoaded,
      sourcesCount: file.sourcesCount,
    }
  })
  const output = copyOutput(value.structure.output)
  const upstreamOutput = copyOutput(value.structure.upstreamOutput)
  if (
    upstreamOutput.total !== output.total ||
    upstreamOutput.returned < output.returned ||
    upstreamOutput.omitted > output.omitted
  )
    refused()
  const structure = {
    version: 1 as const,
    revision: value.structure.revision,
    configHash: value.structure.configHash,
    project: value.structure.project,
    basis: value.structure.basis,
    currentness: value.structure.currentness,
    bodyInspection: value.structure.bodyInspection,
    structureDigest: value.structure.structureDigest,
    snapshotDigest: value.structure.snapshotDigest,
    output,
    files,
  }
  assertPalaceStructure(structure, {
    project: value.structure.project,
    expectedConfigHash: value.structure.configHash,
  })
  const context = copyContext(value.context)
  if (context.captureId !== value.captureId) refused()
  return {
    version: 2,
    kind: 'abi2-palace-context-diagnostic',
    captureId: value.captureId,
    replay: 'unsupported',
    consistency: {
      atomic: false,
      committedSnapshot: 'owner-certified',
      invocationAssociation: 'observed-non-atomic',
      revision: 'matched-at-checks',
      config: 'matched-at-checks',
      lifecycle: 'omitted',
    },
    context,
    structure: { ...structure, upstreamOutput },
  }
}

function copyContext(value: MemoryInvocationContext): MemoryInvocationContext {
  exact(value, [
    'version',
    'kind',
    'captureId',
    'capturedAt',
    'binding',
    'model',
    'usage',
    'effectiveSystemPrompt',
    'memoryProjection',
    'providerPrompt',
    'categoryTokenAccounting',
  ])
  exact(value.binding, ['primary', 'authority', 'revision', 'configHash'])
  if (
    value.version !== 1 ||
    value.kind !== 'abi2-invocation-context' ||
    typeof value.captureId !== 'string' ||
    !captureId.test(value.captureId) ||
    !canonicalTime(value.capturedAt) ||
    value.binding.primary !== true ||
    value.binding.authority !== 'abi2' ||
    typeof value.binding.revision !== 'string' ||
    !historyOID.test(value.binding.revision) ||
    typeof value.binding.configHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.binding.configHash) ||
    value.providerPrompt !== 'unavailable' ||
    value.categoryTokenAccounting !== 'unavailable'
  )
    refused()
  let model: MemoryInvocationContext['model'] = null
  if (value.model !== null) {
    exact(value.model, ['provider', 'id'])
    model = {
      provider: text(value.model.provider, 120),
      id: text(value.model.id, 240),
    }
  }
  const usage = copyUsage(value.usage)
  const effectiveSystemPrompt = copyPrompt(value.effectiveSystemPrompt)
  let memoryProjection: MemoryInvocationContext['memoryProjection'] = null
  if (value.memoryProjection !== null) {
    exact(value.memoryProjection, ['source', 'revision', 'configHash', 'capturedAt', 'emittedBlockUtf8Bytes'])
    if (
      value.memoryProjection.source !== 'abi2-before-agent-start-output' ||
      typeof value.memoryProjection.revision !== 'string' ||
      !historyOID.test(value.memoryProjection.revision) ||
      typeof value.memoryProjection.configHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.memoryProjection.configHash) ||
      !canonicalTime(value.memoryProjection.capturedAt) ||
      !count(value.memoryProjection.emittedBlockUtf8Bytes, 16 * 1024 * 1024)
    )
      refused()
    memoryProjection = {
      source: 'abi2-before-agent-start-output',
      revision: value.memoryProjection.revision,
      configHash: value.memoryProjection.configHash,
      capturedAt: value.memoryProjection.capturedAt,
      emittedBlockUtf8Bytes: value.memoryProjection.emittedBlockUtf8Bytes,
    }
  }
  return {
    version: 1,
    kind: 'abi2-invocation-context',
    captureId: value.captureId,
    capturedAt: value.capturedAt,
    binding: {
      primary: true,
      authority: 'abi2',
      revision: value.binding.revision,
      configHash: value.binding.configHash,
    },
    model,
    usage,
    effectiveSystemPrompt,
    memoryProjection,
    providerPrompt: 'unavailable',
    categoryTokenAccounting: 'unavailable',
  }
}

function copyUsage(value: MemoryInvocationContext['usage']): MemoryInvocationContext['usage'] {
  if (value.available === true) {
    exact(value, ['available', 'source', 'tokens', 'contextWindow', 'percent'])
    if (
      value.source !== 'pi-public-estimate' ||
      (value.tokens !== null && !count(value.tokens, 10_000_000)) ||
      !count(value.contextWindow, 10_000_000) ||
      value.contextWindow < 1 ||
      (value.percent !== null &&
        (typeof value.percent !== 'number' ||
          !Number.isFinite(value.percent) ||
          value.percent < 0 ||
          value.percent > 100))
    )
      refused()
    return {
      available: true,
      source: 'pi-public-estimate',
      tokens: value.tokens,
      contextWindow: value.contextWindow,
      percent: value.percent,
    }
  }
  exact(value, ['available', 'source', 'reason'])
  if (
    value.available !== false ||
    value.source !== 'pi-public-estimate' ||
    (value.reason !== 'unavailable' && value.reason !== 'invalid')
  )
    refused()
  return { available: false, source: 'pi-public-estimate', reason: value.reason }
}

function copyPrompt(
  value: MemoryInvocationContext['effectiveSystemPrompt'],
): MemoryInvocationContext['effectiveSystemPrompt'] {
  if (value.available === true) {
    exact(value, ['available', 'source', 'utf8Bytes'])
    if (value.source !== 'pi-current-effective-system-prompt' || !count(value.utf8Bytes, 256 * 1024 * 1024))
      refused()
    return {
      available: true,
      source: 'pi-current-effective-system-prompt',
      utf8Bytes: value.utf8Bytes,
    }
  }
  exact(value, ['available', 'source', 'reason'])
  if (
    value.available !== false ||
    value.source !== 'pi-current-effective-system-prompt' ||
    (value.reason !== 'unavailable' && value.reason !== 'invalid')
  )
    refused()
  return { available: false, source: 'pi-current-effective-system-prompt', reason: value.reason }
}

function copyOutput(value: unknown) {
  exact(value, ['total', 'returned', 'omitted', 'truncated'])
  if (
    !count(value.total, 1024) ||
    !count(value.returned, 1024) ||
    !count(value.omitted, 1024) ||
    value.returned + value.omitted !== value.total ||
    value.truncated !== value.omitted > 0
  )
    refused()
  return {
    total: value.total,
    returned: value.returned,
    omitted: value.omitted,
    truncated: value.truncated,
  }
}

function copyHistory(value: KnowledgeHistory): KnowledgeHistory {
  assertKnowledgeHistory(value, {
    project: value.project,
    expectedRevision: value.revision,
    expectedConfigHash: value.configHash,
    offset: 0,
  })
  return {
    version: 1,
    project: value.project,
    revision: value.revision,
    configHash: value.configHash,
    ledgerDigest: value.ledgerDigest,
    basis: value.basis,
    currentness: value.currentness,
    offset: 0,
    pageSize: 8,
    windowSize: 128,
    nextOffset: value.nextOffset,
    windowLimitReached: value.windowLimitReached,
    metadata: 'commit-identity-time-only',
    entries: value.entries.map((entry) => ({ ...entry })),
  }
}

function exact(value: unknown, keys: string[]): asserts value is Record<string, any> {
  if (!objectShape(value, keys) || Object.keys(value).length !== keys.length) refused()
}

function text(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    bytes(value) > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    refused()
  return value
}

function count(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum
}

function canonicalTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isoTime.test(value) &&
    Number.isFinite(new Date(value).getTime()) &&
    new Date(value).toISOString() === value
  )
}

function refused(): never {
  throw Error('Palace HTML handoff unavailable')
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
