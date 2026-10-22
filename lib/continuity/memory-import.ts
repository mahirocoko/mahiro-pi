import { isAbsolute } from 'node:path'
import {
  bytes,
  digest,
  hasSecret,
  normalize,
  type IImport,
  type IPolicy,
  type IQuarantine,
} from './records.ts'

export interface ISourceMemoryDocument {
  relativePath: string
  sourcePath: string
  sourceSha256: string
  projectId: string | null
  text: string
}

export interface IMemoryImportSource {
  recordId: string
  relativePath: string
  originalSha256: string
  firstLine: number
  lastLine: number
  redactedLines: number
}

export interface IMemoryImportResult {
  imports: IImport[]
  sources: IMemoryImportSource[]
  quarantine: IQuarantine[]
}

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
const MAX_BATCH_BYTES = 8 * 1024 * 1024
const CHUNK_BYTES = 32 * 1024
const WITHHELD_LINE = '[withheld: sensitive-or-uncertain source line]'

// Data preparation only. The caller owns file allowlisting and symlink-safe IO.
// Original hashes bind the retained source; they are not signatures or proof of origin.
export const prepareMemoryDocuments = (
  documents: readonly ISourceMemoryDocument[],
  policy: IPolicy,
): IMemoryImportResult => {
  if (!Array.isArray(documents) || documents.length > 5000) throw new Error('Memory import bound exceeded')
  const result: IMemoryImportResult = {
    imports: [],
    sources: [],
    quarantine: [],
  }
  let batchBytes = 0
  for (const [ordinal, document] of documents.entries()) {
    const opaqueId = `memory-input-${ordinal}`
    if (
      !document ||
      typeof document.relativePath !== 'string' ||
      typeof document.sourcePath !== 'string' ||
      typeof document.text !== 'string' ||
      typeof document.sourceSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(document.sourceSha256) ||
      document.sourceSha256 !== digest(document.text) ||
      isAbsolute(document.relativePath) ||
      document.relativePath.includes('\\') ||
      document.relativePath.split('/').some((part: string) => !part || part === '.' || part === '..') ||
      !document.relativePath.endsWith('.md')
    )
      throw new Error('Invalid source memory document')
    batchBytes += bytes(document.text)
    if (batchBytes > MAX_BATCH_BYTES) throw new Error('Memory import bound exceeded')
    if (
      bytes(document.text) > MAX_DOCUMENT_BYTES ||
      document.text.includes('\0') ||
      hasSecret(document.relativePath) ||
      hasSecret(document.sourcePath)
    ) {
      result.quarantine.push({
        id: opaqueId,
        reason: 'excluded-or-uncertain-document',
      })
      continue
    }
    // Never retain a private-key body after removing only its BEGIN line.
    if (document.text.includes('-----BEGIN') && hasSecret(document.text)) {
      result.quarantine.push({ id: opaqueId, reason: 'sensitive-document' })
      continue
    }
    let redactedLines = 0
    const text = (document.text.match(/[^\n]*\n|[^\n]+$/g) ?? [])
      .map((line: string) => {
        if (!hasSecret(line)) return line
        redactedLines++
        return WITHHELD_LINE + (line.endsWith('\n') ? '\n' : '')
      })
      .join('')
    // Cross-line or otherwise unhandled matches remain quarantined, not laundered.
    if (hasSecret(text)) {
      result.quarantine.push({ id: opaqueId, reason: 'sensitive-document' })
      continue
    }
    const chunks: { text: string; firstLine: number; lastLine: number }[] = []
    let chars: string[] = []
    let used = 0
    let line = 1
    let firstLine = 1
    let lastLine = 1
    const flush = () => {
      if (chars.length) chunks.push({ text: chars.join(''), firstLine, lastLine })
      chars = []
      used = 0
      firstLine = line
    }
    for (const char of text) {
      const size = bytes(char)
      if (used + size > CHUNK_BYTES) flush()
      if (!chars.length) firstLine = line
      chars.push(char)
      used += size
      lastLine = line
      if (char === '\n') line++
    }
    flush()
    for (const [part, chunk] of chunks.entries()) {
      const id = `memory-${digest(`${document.relativePath}:${document.sourceSha256}:${part}`).slice(0, 32)}`
      const input: IImport = {
        id,
        sourceKind: 'letta_memory',
        path: document.sourcePath,
        projectId: document.projectId,
        markdown: chunk.text,
      }
      const screened = normalize([input], policy)
      result.quarantine.push(...screened.quarantine)
      if (!screened.records.length) continue
      result.imports.push(input)
      result.sources.push({
        recordId: id,
        relativePath: document.relativePath,
        originalSha256: document.sourceSha256,
        firstLine: chunk.firstLine,
        lastLine: chunk.lastLine,
        redactedLines,
      })
    }
  }
  return result
}
