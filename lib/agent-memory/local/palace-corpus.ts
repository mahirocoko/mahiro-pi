import { assertOid, oidPattern } from './contracts.ts'
import { palacePreviewLimits, type PalaceEntryKind } from './palace.ts'
import { encodePalacePath, assertPalacePath } from './palace-path.ts'

// One bounded page of committed corpus metadata. It has no file bodies.
export const palaceCorpusLimits = {
  pageSize: palacePreviewLimits.pageSize,
  maxOffset: 999_999,
  maxResponseBytes: palacePreviewLimits.maxSnapshotBytes,
} as const

const entryKinds = ['file', 'directory', 'symlink', 'submodule', 'special'] as const

export interface PalaceCorpusPageEntry {
  path: string
  kind: PalaceEntryKind
  bytes: number | null
  token: string
}

export interface PalaceCorpusPage {
  version: 1
  bytes: number
  commit: string
  offset: number
  total: number
  returned: number
  truncated: boolean
  entries: PalaceCorpusPageEntry[]
}

export interface PalaceCorpusRequest {
  commit: string
  offset: number
}

function refused(): never {
  throw Error('Local memory palace refused')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).sort().join() !== [...expected].sort().join()) refused()
}

function assertOffset(offset: number, total: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > palaceCorpusLimits.maxOffset) refused()
  if (offset > 0 && offset >= total) refused()
}

function assertEntry(entry: PalaceCorpusPageEntry, previous: string | null): void {
  assertPalacePath(entry.path)
  if (!entryKinds.includes(entry.kind)) refused()
  if (entry.kind === 'file') {
    if (
      entry.bytes !== null &&
      (!Number.isInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 1_048_576)
    )
      refused()
  } else if (entry.bytes !== null) refused()
  if (entry.token !== encodePalacePath(entry.path)) refused()
  if (previous !== null && previous >= entry.path) refused()
}

function measure(fields: Omit<PalaceCorpusPage, 'bytes' | 'version'>): PalaceCorpusPage {
  let bytes = 0
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const page = { version: 1 as const, bytes, ...fields }
    const size = Buffer.byteLength(JSON.stringify(page))
    if (size === bytes) return page
    bytes = size
  }
  refused()
}

export function buildPalaceCorpusPage(input: {
  commit: string
  offset: number
  total: number
  entries: readonly { path: string; kind: PalaceEntryKind; bytes: number | null }[]
}): PalaceCorpusPage {
  assertOid(input.commit)
  if (!Number.isInteger(input.total) || input.total < 0 || input.total > 1_000_000) refused()
  assertOffset(input.offset, input.total)
  if (input.entries.length > palaceCorpusLimits.pageSize) refused()
  if (input.offset + input.entries.length > input.total) refused()
  const entries: PalaceCorpusPageEntry[] = []
  let previous: string | null = null
  for (const entry of input.entries) {
    const next = { ...entry, token: encodePalacePath(entry.path) }
    assertEntry(next, previous)
    entries.push(next)
    previous = next.path
  }
  const truncated = input.offset + entries.length < input.total
  const page = measure({
    commit: input.commit,
    offset: input.offset,
    total: input.total,
    returned: entries.length,
    truncated,
    entries,
  })
  if (page.bytes > palaceCorpusLimits.maxResponseBytes) refused()
  return page
}

export function parsePalaceCorpusPage(value: unknown): PalaceCorpusPage {
  if (!isRecord(value)) refused()
  assertKeys(value, ['bytes', 'commit', 'entries', 'offset', 'returned', 'total', 'truncated', 'version'])
  if (value.version !== 1) refused()
  if (typeof value.commit !== 'string' || !oidPattern.test(value.commit)) refused()
  if (
    typeof value.offset !== 'number' ||
    typeof value.total !== 'number' ||
    typeof value.returned !== 'number'
  )
    refused()
  if (typeof value.truncated !== 'boolean' || typeof value.bytes !== 'number') refused()
  if (!Array.isArray(value.entries) || value.entries.length !== value.returned) refused()
  const entries: { path: string; kind: PalaceEntryKind; bytes: number | null; token: string }[] = []
  for (const entry of value.entries) {
    if (!isRecord(entry)) refused()
    assertKeys(entry, ['bytes', 'kind', 'path', 'token'])
    if (typeof entry.path !== 'string' || typeof entry.token !== 'string') refused()
    if (!entryKinds.includes(entry.kind as PalaceEntryKind)) refused()
    const bytes = entry.bytes
    if (bytes !== null && (typeof bytes !== 'number' || !Number.isInteger(bytes))) refused()
    entries.push({
      path: entry.path,
      kind: entry.kind as PalaceEntryKind,
      bytes,
      token: entry.token,
    })
  }
  const built = buildPalaceCorpusPage({
    commit: value.commit,
    offset: value.offset,
    total: value.total,
    entries,
  })
  if (
    built.bytes !== value.bytes ||
    built.returned !== value.returned ||
    built.truncated !== value.truncated ||
    built.entries.some((entry, index) => entry.token !== entries[index]?.token)
  )
    refused()
  return built
}
