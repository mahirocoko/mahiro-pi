import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { writeExclusive } from './confine.ts'
import { assertRelativePath, oidPattern } from './contracts.ts'

// Coordinator-owned logical forgetting. This is not Git-history erasure.
export const forgettingLimits = {
  maxPaths: 4096,
  maxBlobs: 4096,
  maxSources: 4096,
  maxRecordBytes: 512 * 1024,
} as const

const digestPattern = /^[0-9a-f]{64}$/
const revisionPattern = /^[0-9a-f]{40,64}$/
const projectPattern = /^[a-z0-9][a-z0-9-]{0,63}$/
const sourcePattern = /^[\p{L}\p{N}_.:-]{1,160}$/u
const protectedPaths = new Set(['Core.md', 'index.md'])
const blockedSourceNames = new Set(['__proto__', 'constructor', 'prototype'])

export interface TombstoneSource {
  project: string | null
  source: string
}

export interface TombstoneSnapshot {
  version: 1
  revision: string
  digest: string
  paths: string[]
  blobs: string[]
  sources: TombstoneSource[]
}

export interface ForgettingMigration {
  phase: 'removing' | 'removed'
  priorMain: string
  removalCommit: string | null
  sourceDigest: string
  sourceRevision: string
}

export interface ForgettingRecord {
  version: 1
  policyRevision: number
  digest: string
  snapshot: TombstoneSnapshot | null
  migration: ForgettingMigration | null
}

export interface TombstoneImport {
  expectedPolicyRevision: number
  expectedDigest: string
  snapshot: TombstoneSnapshot
}

export interface ForgettingMetadata {
  policyRevision: number
  digest: string
  phase: 'empty' | 'removing' | 'removed'
  pathCount: number
  blobCount: number
  sourceCount: number
  filtered: boolean
}

export interface ForgettingGuard {
  active: boolean
  metadata: Omit<ForgettingMetadata, 'filtered'>
  pathForbidden(path: string): boolean
  oidForbidden(oid: string): boolean
  textForbidden(text: string): boolean
}

export function isProtectedMemoryPath(path: string): boolean {
  return protectedPaths.has(path)
}

export function localGitBlobId(text: string): string {
  const size = Buffer.byteLength(text)
  return createHash('sha1').update(`blob ${size}\0`).update(text).digest('hex')
}

export function tombstoneSnapshotDigest(snapshot: {
  version: 1
  revision: string
  paths: readonly string[]
  blobs: readonly string[]
  sources: readonly TombstoneSource[]
}): string {
  return sha256(
    JSON.stringify({
      blobs: [...snapshot.blobs].sort(),
      paths: [...snapshot.paths].sort(),
      revision: snapshot.revision,
      sources: [...snapshot.sources].map(canonicalSource).sort(compareSource),
      version: 1 as const,
    }),
  )
}

export function emptyForgettingMetadata(): ForgettingMetadata {
  return metadataOf(emptyRecord(), false)
}

export function inactiveForgettingGuard(): ForgettingGuard {
  return forgettingGuard(emptyRecord())
}

export function forgettingGuard(record: ForgettingRecord): ForgettingGuard {
  const paths = new Set(record.snapshot?.paths ?? [])
  const blobs = new Set(record.snapshot?.blobs ?? [])
  const meta = metadataOf(record, false)
  return {
    active: record.policyRevision > 0 && record.snapshot !== null,
    metadata: {
      policyRevision: meta.policyRevision,
      digest: meta.digest,
      phase: meta.phase,
      pathCount: meta.pathCount,
      blobCount: meta.blobCount,
      sourceCount: meta.sourceCount,
    },
    pathForbidden(path: string): boolean {
      return paths.has(path)
    },
    oidForbidden(oid: string): boolean {
      return blobs.has(oid)
    },
    textForbidden(text: string): boolean {
      return blobs.has(localGitBlobId(text))
    },
  }
}

export function forgettingMetadata(record: ForgettingRecord, filtered: boolean): ForgettingMetadata {
  return metadataOf(record, filtered)
}

export function suppressForgotten(path: string, oid: string | undefined, guard: ForgettingGuard): boolean {
  if (guard.pathForbidden(path)) return true
  if (oid !== undefined && guard.oidForbidden(oid)) return true
  return false
}

export function forgettingFile(stateRoot: string): string {
  return join(stateRoot, 'forgetting.json')
}

export async function loadForgetting(stateRoot: string): Promise<ForgettingRecord> {
  const text = await readForgetting(forgettingFile(stateRoot))
  return parseForgetting(text)
}

export async function saveForgetting(
  stateRoot: string,
  next: ForgettingRecord,
  expectedDigest: string,
): Promise<void> {
  const current = await loadForgetting(stateRoot)
  if (current.digest !== expectedDigest) throw Error('Local memory forgetting stale')
  const text = serialize(next)
  if (Buffer.byteLength(text) > forgettingLimits.maxRecordBytes) refuse()
  if (parseForgetting(text).digest !== next.digest) refuse()
  await writeExclusive(forgettingFile(stateRoot), text)
}

export async function createEmptyForgetting(stateRoot: string): Promise<ForgettingRecord> {
  const record = emptyRecord()
  const text = serialize(record)
  await writeExclusive(forgettingFile(stateRoot), text)
  return record
}

export function parseTombstoneImport(value: unknown): TombstoneImport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  exactKeys(value, ['expectedDigest', 'expectedPolicyRevision', 'snapshot'])
  const input = value as TombstoneImport
  if (!Number.isInteger(input.expectedPolicyRevision) || input.expectedPolicyRevision < 0) refuse()
  if (typeof input.expectedDigest !== 'string' || !digestPattern.test(input.expectedDigest)) refuse()
  return {
    expectedPolicyRevision: input.expectedPolicyRevision,
    expectedDigest: input.expectedDigest,
    snapshot: parseSnapshot(input.snapshot),
  }
}

export function prepareForgettingImport(
  current: ForgettingRecord,
  input: TombstoneImport,
): { kind: 'same' } | { kind: 'apply'; record: ForgettingRecord } {
  if (current.snapshot?.digest === input.snapshot.digest) return { kind: 'same' }
  if (current.policyRevision !== input.expectedPolicyRevision || current.digest !== input.expectedDigest)
    throw Error('Local memory forgetting stale')
  if (current.snapshot) throw Error('Local memory forgetting conflict')
  const record = withDigest({
    version: 1,
    policyRevision: current.policyRevision + 1,
    snapshot: input.snapshot,
    migration: null,
  })
  return { kind: 'apply', record }
}

export function forgettingRemovalRecord(
  prepared: ForgettingRecord,
  priorMain: string,
  removalCommit: string | null,
): ForgettingRecord {
  if (!prepared.snapshot) refuse()
  if (!oidPattern.test(priorMain)) throw Error('Local Git object refused')
  if (removalCommit !== null && !oidPattern.test(removalCommit)) throw Error('Local Git object refused')
  return withDigest({
    version: 1,
    policyRevision: prepared.policyRevision,
    snapshot: prepared.snapshot,
    migration: {
      phase: removalCommit === null ? 'removed' : 'removing',
      priorMain,
      removalCommit,
      sourceDigest: prepared.snapshot.digest,
      sourceRevision: prepared.snapshot.revision,
    },
  })
}

export function forgettingRemovedRecord(current: ForgettingRecord): ForgettingRecord {
  if (!current.snapshot || !current.migration || !current.migration.removalCommit) refuse()
  return withDigest({
    version: 1,
    policyRevision: current.policyRevision,
    snapshot: current.snapshot,
    migration: { ...current.migration, phase: 'removed' },
  })
}

function metadataOf(record: ForgettingRecord, filtered: boolean): ForgettingMetadata {
  return {
    policyRevision: record.policyRevision,
    digest: record.digest,
    phase: record.migration?.phase ?? 'empty',
    pathCount: record.snapshot?.paths.length ?? 0,
    blobCount: record.snapshot?.blobs.length ?? 0,
    sourceCount: record.snapshot?.sources.length ?? 0,
    filtered,
  }
}

function emptyRecord(): ForgettingRecord {
  return withDigest({
    version: 1,
    policyRevision: 0,
    snapshot: null,
    migration: null,
  })
}

function withDigest(record: Omit<ForgettingRecord, 'digest'>): ForgettingRecord {
  return { ...record, digest: recordDigest(record) }
}

function recordDigest(record: Omit<ForgettingRecord, 'digest'>): string {
  return sha256(
    JSON.stringify({
      migration: record.migration
        ? {
            phase: record.migration.phase,
            priorMain: record.migration.priorMain,
            removalCommit: record.migration.removalCommit,
            sourceDigest: record.migration.sourceDigest,
            sourceRevision: record.migration.sourceRevision,
          }
        : null,
      policyRevision: record.policyRevision,
      snapshot: record.snapshot,
      version: record.version,
    }),
  )
}

function serialize(record: ForgettingRecord): string {
  return `${JSON.stringify({
    version: record.version,
    policyRevision: record.policyRevision,
    digest: record.digest,
    snapshot: record.snapshot,
    migration: record.migration,
  })}\n`
}

function parseForgetting(text: string): ForgettingRecord {
  if (Buffer.byteLength(text) > forgettingLimits.maxRecordBytes) refuse()
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    refuse()
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  exactKeys(value, ['digest', 'migration', 'policyRevision', 'snapshot', 'version'])
  const record = value as ForgettingRecord
  if (record.version !== 1) refuse()
  if (!Number.isInteger(record.policyRevision) || record.policyRevision < 0 || record.policyRevision > 100000)
    refuse()
  if (typeof record.digest !== 'string' || !digestPattern.test(record.digest)) refuse()
  const snapshot = record.snapshot === null ? null : parseSnapshot(record.snapshot)
  const migration = parseMigration(record.migration, snapshot)
  if ((record.policyRevision === 0) !== (snapshot === null) || (snapshot === null) !== (migration === null))
    refuse()
  const parsed = withDigest({
    version: 1,
    policyRevision: record.policyRevision,
    snapshot,
    migration,
  })
  if (parsed.digest !== record.digest) refuse()
  return parsed
}

function parseSnapshot(value: unknown): TombstoneSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  exactKeys(value, ['blobs', 'digest', 'paths', 'revision', 'sources', 'version'])
  const snapshot = value as TombstoneSnapshot
  if (snapshot.version !== 1) refuse()
  if (typeof snapshot.revision !== 'string' || !revisionPattern.test(snapshot.revision)) refuse()
  if (typeof snapshot.digest !== 'string' || !digestPattern.test(snapshot.digest)) refuse()
  const paths = parsePaths(snapshot.paths)
  const blobs = parseBlobs(snapshot.blobs)
  const sources = parseSources(snapshot.sources)
  if (!paths.length && !blobs.length && !sources.length) refuse()
  const canonical: TombstoneSnapshot = {
    version: 1,
    revision: snapshot.revision,
    digest: snapshot.digest,
    paths,
    blobs,
    sources,
  }
  if (tombstoneSnapshotDigest(canonical) !== canonical.digest) refuse()
  return canonical
}

function parsePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > forgettingLimits.maxPaths) refuse()
  const paths = value.map((path) => {
    if (typeof path !== 'string') refuse()
    try {
      assertRelativePath(path)
    } catch {
      refuse()
    }
    if (isProtectedMemoryPath(path)) refuse()
    return path
  })
  const sorted = [...paths].sort()
  if (new Set(sorted).size !== sorted.length) refuse()
  return sorted
}

function parseBlobs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > forgettingLimits.maxBlobs) refuse()
  const blobs = value.map((blob) => {
    if (typeof blob !== 'string' || !oidPattern.test(blob)) refuse()
    return blob
  })
  const sorted = [...blobs].sort()
  if (new Set(sorted).size !== sorted.length) refuse()
  return sorted
}

function parseSources(value: unknown): TombstoneSource[] {
  if (!Array.isArray(value) || value.length > forgettingLimits.maxSources) refuse()
  const sources = value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) refuse()
    exactKeys(entry, ['project', 'source'])
    return canonicalSource(entry as TombstoneSource)
  })
  const sorted = [...sources].sort(compareSource)
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    if (previous && current && compareSource(previous, current) === 0) refuse()
  }
  return sorted
}

function canonicalSource(entry: TombstoneSource): TombstoneSource {
  if (!(entry.project === null || (typeof entry.project === 'string' && projectPattern.test(entry.project))))
    refuse()
  if (
    typeof entry.source !== 'string' ||
    !sourcePattern.test(entry.source) ||
    blockedSourceNames.has(entry.source)
  )
    refuse()
  return { project: entry.project, source: entry.source }
}

function parseMigration(value: unknown, snapshot: TombstoneSnapshot | null): ForgettingMigration | null {
  if (value === null) return null
  if (!snapshot || !value || typeof value !== 'object' || Array.isArray(value)) refuse()
  exactKeys(value, ['phase', 'priorMain', 'removalCommit', 'sourceDigest', 'sourceRevision'])
  const migration = value as ForgettingMigration
  if (migration.phase !== 'removing' && migration.phase !== 'removed') refuse()
  if (typeof migration.priorMain !== 'string' || !oidPattern.test(migration.priorMain)) refuse()
  if (
    migration.removalCommit !== null &&
    (typeof migration.removalCommit !== 'string' || !oidPattern.test(migration.removalCommit))
  )
    refuse()
  if (migration.phase === 'removing' && migration.removalCommit === null) refuse()
  if (migration.sourceDigest !== snapshot.digest || migration.sourceRevision !== snapshot.revision) refuse()
  return {
    phase: migration.phase,
    priorMain: migration.priorMain,
    removalCommit: migration.removalCommit,
    sourceDigest: migration.sourceDigest,
    sourceRevision: migration.sourceRevision,
  }
}

function compareSource(left: TombstoneSource, right: TombstoneSource): number {
  const project = (left.project ?? '').localeCompare(right.project ?? '')
  if (project !== 0) return project
  return left.source < right.source ? -1 : left.source > right.source ? 1 : 0
}

function exactKeys(value: object, keys: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) refuse()
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function refuse(): never {
  throw Error('Local memory forgetting refused')
}

async function readForgetting(path: string): Promise<string> {
  let stat
  try {
    stat = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
    refuse()
  }
  if (
    stat.isSymbolicLink() ||
    stat.isFIFO() ||
    stat.isSocket() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size > forgettingLimits.maxRecordBytes
  )
    refuse()
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch {
    refuse()
  }
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.nlink !== 1 || String(opened.ino) !== String(stat.ino)) refuse()
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}
