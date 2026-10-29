import { bytes, digest, validId } from '../continuity/records.ts'
import { allowedPath, limits, revisionPattern, suppressed, type Ledger } from './engine/schema.ts'

// Read-only committed ledger pages. File text, roots, drafts and credentials stay out.
export const migrationExportSections = [
  'binding',
  'sources',
  'forgotten-paths',
  'forgotten-sources',
  'reviewed',
] as const

export const migrationExportPageLimit = 32

export type MigrationExportSection = (typeof migrationExportSections)[number]

export interface MigrationExportPage {
  revision: string
  configHash: string
  ledgerDigest: string
  section: MigrationExportSection
  offset: number
  limit: number
  total: number
  nextOffset?: number
  entries: unknown[]
}

const hashPattern = /^[a-f0-9]{64}$/
const forbiddenKeys = new Set(['text', 'root', 'cwd', 'draft', 'conflict', 'body', 'prompt', 'credential'])

export function canonicalLedgerDigest(raw: string): string {
  if (!raw.endsWith('\n') || raw.slice(0, -1).includes('\n') || raw.includes('\0'))
    throw new Error('Invalid memory ledger')
  return digest(raw.slice(0, -1))
}

export function migrationSourceIndex(ledger: Ledger): { path: string; sources: string[] }[] {
  return Object.keys(ledger.sources)
    .filter((path) => !suppressed(ledger, path, ledger.sources[path]))
    .sort(comparePath)
    .map((path) => ({ path, sources: [...ledger.sources[path]] }))
}

export function pageMigrationExport(input: {
  revision: string
  configHash: string
  ledgerDigest: string
  ledger: Ledger
  section: string
  offset: number
  limit: number
  contentHashes?: Record<string, string>
}): MigrationExportPage {
  if (
    !revisionPattern.test(input.revision) ||
    !hashPattern.test(input.configHash) ||
    !hashPattern.test(input.ledgerDigest) ||
    !isSection(input.section) ||
    !Number.isSafeInteger(input.offset) ||
    input.offset < 0 ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > migrationExportPageLimit
  )
    throw new Error('Invalid memory migration export')
  const active = migrationSourceIndex(input.ledger)
  const rows =
    input.section === 'binding'
      ? [
          {
            activeFiles: active.length,
            forgottenPaths: input.ledger.forgottenPaths.length,
            forgottenSources: input.ledger.forgottenSources.length,
            reviewed: input.ledger.reviewed.length,
          },
        ]
      : input.section === 'sources'
        ? active
        : input.section === 'forgotten-paths'
          ? [...input.ledger.forgottenPaths]
          : input.section === 'forgotten-sources'
            ? input.ledger.forgottenSources.map((entry) => ({ project: entry.project, source: entry.source }))
            : [...input.ledger.reviewed]
  if (input.offset > rows.length) throw new Error('Invalid memory migration export')
  const entries = rows.slice(input.offset, input.offset + input.limit).map((entry) => {
    if (input.section !== 'sources') return entry
    const row = entry as { path: string; sources: string[] }
    const hash = input.contentHashes?.[row.path]
    if (typeof hash !== 'string' || !hashPattern.test(hash))
      throw new Error('Invalid memory migration export')
    return { path: row.path, sources: row.sources, hash }
  })
  const next = input.offset + entries.length
  const page: MigrationExportPage = {
    revision: input.revision,
    configHash: input.configHash,
    ledgerDigest: input.ledgerDigest,
    section: input.section,
    offset: input.offset,
    limit: input.limit,
    total: rows.length,
    entries,
    ...(next < rows.length ? { nextOffset: next } : {}),
  }
  return assertMigrationExportPage(page)
}

export function assertMigrationExportPage(value: unknown): MigrationExportPage {
  const page = record(value)
  const keys = Object.keys(page).sort()
  const expected =
    page.nextOffset === undefined
      ? ['configHash', 'entries', 'ledgerDigest', 'limit', 'offset', 'revision', 'section', 'total']
      : [
          'configHash',
          'entries',
          'ledgerDigest',
          'limit',
          'nextOffset',
          'offset',
          'revision',
          'section',
          'total',
        ]
  if (keys.join() !== expected.join()) refuse()
  if (
    typeof page.revision !== 'string' ||
    !revisionPattern.test(page.revision) ||
    typeof page.configHash !== 'string' ||
    !hashPattern.test(page.configHash) ||
    typeof page.ledgerDigest !== 'string' ||
    !hashPattern.test(page.ledgerDigest) ||
    !isSection(page.section) ||
    !integer(page.offset) ||
    !integer(page.limit, migrationExportPageLimit) ||
    page.limit < 1 ||
    !integer(page.total, page.section === 'binding' ? 1 : page.section === 'sources' ? limits.files : 4096) ||
    page.offset > page.total ||
    !Array.isArray(page.entries) ||
    page.entries.length > page.limit ||
    page.offset + page.entries.length > page.total
  )
    refuse()
  const end = page.offset + page.entries.length
  if (page.nextOffset === undefined) {
    if (end !== page.total) refuse()
  } else if (page.nextOffset !== end || end >= page.total) refuse()
  if (page.section === 'binding') {
    if (page.total !== 1) refuse()
    if (page.entries.length === 1) bindingEntry(page.entries[0])
    else if (page.entries.length !== 0) refuse()
  } else if (page.section === 'sources') {
    const paths: string[] = []
    for (const entry of page.entries) {
      const row = record(entry)
      if (
        Object.keys(row).sort().join() !== 'hash,path,sources' ||
        typeof row.path !== 'string' ||
        !allowedPath(row.path) ||
        typeof row.hash !== 'string' ||
        !hashPattern.test(row.hash) ||
        !sources(row.sources)
      )
        refuse()
      paths.push(row.path)
    }
    if (paths.some((path, index) => index > 0 && comparePath(paths[index - 1], path) >= 0)) refuse()
  } else if (page.section === 'forgotten-paths') {
    if (page.entries.some((entry) => typeof entry !== 'string' || !allowedPath(entry))) refuse()
  } else if (page.section === 'forgotten-sources') {
    for (const entry of page.entries) sourceEntry(entry)
  } else if (page.entries.some((entry) => !validId(entry))) refuse()
  rejectPrivate(page)
  if (bytes(JSON.stringify(page)) > 64 * 1024) refuse()
  return page as unknown as MigrationExportPage
}

function bindingEntry(value: unknown) {
  const row = record(value)
  if (
    Object.keys(row).sort().join() !== 'activeFiles,forgottenPaths,forgottenSources,reviewed' ||
    !integer(row.activeFiles, limits.files) ||
    !integer(row.forgottenPaths, 4096) ||
    !integer(row.forgottenSources, 4096) ||
    !integer(row.reviewed, 4096)
  )
    refuse()
}

function sourceEntry(value: unknown) {
  const row = record(value)
  if (
    Object.keys(row).sort().join() !== 'project,source' ||
    !(
      row.project === null ||
      (typeof row.project === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(row.project))
    ) ||
    !validId(row.source)
  )
    refuse()
}

function sources(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length <= 32 && new Set(value).size === value.length && value.every(validId)
  )
}

function rejectPrivate(value: unknown) {
  if (typeof value === 'string') {
    if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) refuse()
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) rejectPrivate(entry)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) refuse()
      rejectPrivate(entry)
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  return value as Record<string, unknown>
}

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
}

function isSection(value: unknown): value is MigrationExportSection {
  return typeof value === 'string' && (migrationExportSections as readonly string[]).includes(value)
}

function comparePath(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function refuse(): never {
  throw new Error('Invalid memory migration export')
}
