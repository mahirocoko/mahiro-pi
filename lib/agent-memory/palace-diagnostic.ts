import type { MemoryInvocationContext } from './invocation-context.ts'
import { palaceLayerFor } from './retrieval.ts'

export interface PalaceDiagnostic {
  version: 1
  kind: 'abi2-palace-context-diagnostic'
  captureId: string
  replay: 'unsupported'
  consistency: {
    atomic: false
    revision: 'matched-at-checks'
    config: 'matched-at-checks-not-certified-by-palace'
    lifecycle: 'omitted'
  }
  context: MemoryInvocationContext
  structure: {
    revision: string
    inspection: { complete: boolean; inspectedFiles: number; nonArchiveFiles: number; totalFiles: number }
    upstreamOutput: { returned: number; omitted: number; truncated: boolean }
    output: { returned: number; omitted: number; truncated: boolean }
    files: {
      path: string
      layer: string
      bytes: number
      protectedRetention: boolean
      alwaysLoaded: boolean
      sourcesCount: number
    }[]
  }
}

// Reconstruct every field; the real manage reply is validated upstream, but no
// nested Palace object or caller-owned reference crosses this output boundary.
export function buildPalaceDiagnostic(
  context: MemoryInvocationContext,
  palace: Record<string, unknown>,
): PalaceDiagnostic {
  const count = (value: unknown): number => {
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw Error('Invalid Palace count')
    return value as number
  }
  if (palace.revision !== context.binding.revision) throw Error('Palace revision mismatch during capture')
  const coverage = palace.coverage as Record<string, unknown>
  if (!coverage || typeof coverage.complete !== 'boolean' || !Array.isArray(palace.files))
    throw Error('Invalid Palace coverage')
  const total = count(coverage.totalFiles)
  const returned = count(coverage.filesReturned)
  if (returned !== palace.files.length || returned > total) throw Error('Invalid Palace output count')
  const result: PalaceDiagnostic = {
    version: 1,
    kind: 'abi2-palace-context-diagnostic',
    captureId: context.captureId,
    replay: 'unsupported',
    consistency: {
      atomic: false,
      revision: 'matched-at-checks',
      config: 'matched-at-checks-not-certified-by-palace',
      lifecycle: 'omitted',
    },
    context: copyContext(context),
    structure: {
      revision: context.binding.revision,
      inspection: {
        complete: coverage.complete,
        inspectedFiles: count(coverage.inspectedFiles),
        nonArchiveFiles: count(coverage.nonArchiveFiles),
        totalFiles: total,
      },
      upstreamOutput: { returned, omitted: total - returned, truncated: returned < total },
      output: { returned: 0, omitted: total, truncated: total > 0 },
      files: [],
    },
  }
  if (Buffer.byteLength(JSON.stringify(context)) > 4096) throw Error('Invocation context reply exceeds bound')
  for (const raw of palace.files.slice(0, 128)) {
    const f = raw as Record<string, unknown>
    if (
      typeof f.path !== 'string' ||
      !f.path.endsWith('.md') ||
      /[\\\u0000-\u001f\u007f]/.test(f.path) ||
      f.path.startsWith('/') ||
      f.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      f.layer !== palaceLayerFor(f.path) ||
      typeof f.protectedRetention !== 'boolean' ||
      typeof f.alwaysLoaded !== 'boolean'
    )
      throw Error('Invalid Palace structural entry')
    result.structure.files.push({
      path: f.path,
      layer: f.layer as string,
      bytes: count(f.bytes),
      protectedRetention: f.protectedRetention,
      alwaysLoaded: f.alwaysLoaded,
      sourcesCount: count(f.sourcesCount),
    })
  }
  const account = () => {
    const n = result.structure.files.length
    result.structure.output = { returned: n, omitted: total - n, truncated: n < total }
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
