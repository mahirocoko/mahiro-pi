import type { MemoryInvocationContext } from './invocation-context.ts'
import { assertPalaceStructure, type PalaceStructure } from './palace-structure.ts'

export interface PalaceDiagnostic {
  version: 2
  kind: 'abi2-palace-context-diagnostic'
  captureId: string
  replay: 'unsupported'
  consistency: {
    atomic: false
    committedSnapshot: 'owner-certified'
    invocationAssociation: 'observed-non-atomic'
    revision: 'matched-at-checks'
    config: 'matched-at-checks'
    lifecycle: 'omitted'
  }
  context: MemoryInvocationContext
  structure: Omit<PalaceStructure, 'files' | 'output'> & {
    upstreamOutput: PalaceStructure['output']
    output: PalaceStructure['output']
    files: PalaceStructure['files']
  }
}

export function buildPalaceDiagnostic(
  context: MemoryInvocationContext,
  palace: PalaceStructure,
): PalaceDiagnostic {
  assertPalaceStructure(palace, { project: palace.project, expectedConfigHash: context.binding.configHash })
  if (palace.revision !== context.binding.revision) throw Error('Palace revision mismatch during capture')
  const result: PalaceDiagnostic = {
    version: 2,
    kind: 'abi2-palace-context-diagnostic',
    captureId: context.captureId,
    replay: 'unsupported',
    consistency: {
      atomic: false,
      committedSnapshot: 'owner-certified',
      invocationAssociation: 'observed-non-atomic',
      revision: 'matched-at-checks',
      config: 'matched-at-checks',
      lifecycle: 'omitted',
    },
    context: copyContext(context),
    structure: {
      version: 1,
      revision: palace.revision,
      configHash: palace.configHash,
      project: palace.project,
      basis: palace.basis,
      currentness: palace.currentness,
      bodyInspection: palace.bodyInspection,
      structureDigest: palace.structureDigest,
      snapshotDigest: palace.snapshotDigest,
      upstreamOutput: { ...palace.output },
      output: { ...palace.output },
      files: palace.files.map((f) => ({ ...f })),
    },
  }
  if (Buffer.byteLength(JSON.stringify(context)) > 4096) throw Error('Invocation context reply exceeds bound')
  const account = () => {
    const returned = result.structure.files.length
    const total = palace.output.total
    result.structure.output = { total, returned, omitted: total - returned, truncated: returned < total }
  }
  account()
  while (Buffer.byteLength(JSON.stringify(result)) > 32768) {
    if (!result.structure.files.pop()) throw Error('Palace diagnostic exceeds bound')
    account()
  }
  return result
}

function copyContext(c: MemoryInvocationContext): MemoryInvocationContext {
  return {
    version: 1,
    kind: 'abi2-invocation-context',
    captureId: c.captureId,
    capturedAt: c.capturedAt,
    binding: {
      primary: true,
      authority: 'abi2',
      revision: c.binding.revision,
      configHash: c.binding.configHash,
    },
    model: c.model ? { provider: c.model.provider, id: c.model.id } : null,
    usage: c.usage.available
      ? {
          available: true,
          source: 'pi-public-estimate',
          tokens: c.usage.tokens,
          contextWindow: c.usage.contextWindow,
          percent: c.usage.percent,
        }
      : { available: false, source: 'pi-public-estimate', reason: c.usage.reason },
    effectiveSystemPrompt: c.effectiveSystemPrompt.available
      ? {
          available: true,
          source: 'pi-current-effective-system-prompt',
          utf8Bytes: c.effectiveSystemPrompt.utf8Bytes,
        }
      : {
          available: false,
          source: 'pi-current-effective-system-prompt',
          reason: c.effectiveSystemPrompt.reason,
        },
    memoryProjection: c.memoryProjection
      ? {
          source: 'abi2-before-agent-start-output',
          revision: c.memoryProjection.revision,
          configHash: c.memoryProjection.configHash,
          capturedAt: c.memoryProjection.capturedAt,
          emittedBlockUtf8Bytes: c.memoryProjection.emittedBlockUtf8Bytes,
        }
      : null,
    providerPrompt: 'unavailable',
    categoryTokenAccounting: 'unavailable',
  }
}
