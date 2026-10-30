import { readdir, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  assertRealDirectory,
  ensureRealDirectory,
  isOwnedTempName,
  readRegularFile,
  writeExclusive,
} from './confine.ts'
import {
  type LocalJobKind,
  type LocalJobRecord,
  type LocalJobStatus,
  type LocalRepairEvidence,
  type LocalOwnershipRecord,
  type LocalProgressRecord,
  type LocalServiceMeta,
  assertJobId,
  assertOid,
  assertRelativePath,
  assertSummary,
  jobIdPattern,
  localGitIdentity,
  localJobStatuses,
  localStateDirectoryNames,
  oidPattern,
} from './contracts.ts'
import { parseJobReflection } from './trajectory.ts'
import { verifyLocalMemoryClaim } from './coordination.ts'

const jobStatuses = new Set<string>(localJobStatuses)

export async function ensureStateDirs(stateRoot: string): Promise<void> {
  for (const name of localStateDirectoryNames) await ensureRealDirectory(join(stateRoot, name))
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeExclusive(path, `${JSON.stringify(value)}\n`)
}

function nullableOid(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string' && oidPattern.test(value)) return value
  throw Error('Local memory job refused')
}

function samePresence(left: string | null, right: string | null): void {
  if ((left === null) !== (right === null)) throw Error('Local memory job refused')
}

export function parseMeta(value: unknown, repository: string): LocalServiceMeta {
  if (!value || typeof value !== 'object') throw Error('Local memory state refused')
  const meta = value as LocalServiceMeta
  if (
    meta.version !== 1 ||
    meta.repository !== repository ||
    !/^[0-9a-f]{32}$/.test(meta.nonce) ||
    Object.keys(meta).sort().join() !== 'nextSequence,nonce,repository,version'
  )
    throw Error('Local memory state refused')
  if (!Number.isInteger(meta.nextSequence) || meta.nextSequence < 1 || meta.nextSequence > 100000)
    throw Error('Local memory state refused')
  return {
    version: 1,
    repository,
    nonce: meta.nonce,
    nextSequence: meta.nextSequence,
  }
}

export function parseJob(value: unknown, expected: { id: string; stateRoot: string }): LocalJobRecord {
  if (!value || typeof value !== 'object') throw Error('Local memory job refused')
  const job = value as LocalJobRecord
  assertJobId(job.id)
  if (job.id !== expected.id) throw Error('Local memory job refused')
  assertSummary(job.summary)
  assertOid(job.baseHead)
  if (job.version !== 1 || !jobStatuses.has(job.status)) throw Error('Local memory job refused')
  if (!Number.isInteger(job.sequence) || job.sequence < 1) throw Error('Local memory job refused')
  const workerCommit = nullableOid(job.workerCommit)
  const integratedCommit = nullableOid(job.integratedCommit)
  const pendingIntegration = nullableOid(job.pendingIntegration)
  const expectedParent = nullableOid(job.expectedParent)
  samePresence(pendingIntegration, expectedParent)
  const worktree = join(expected.stateRoot, 'worktrees', job.id)
  if (job.worktreePath !== null && (typeof job.worktreePath !== 'string' || !isAbsolute(job.worktreePath)))
    throw Error('Local memory job refused')
  if (job.worktreePath !== null && job.worktreePath !== worktree) throw Error('Local memory job refused')
  if (!Array.isArray(job.conflictPaths) || job.conflictPaths.length > 32)
    throw Error('Local memory job refused')
  for (const path of job.conflictPaths) assertRelativePath(path)
  if (new Set(job.conflictPaths).size !== job.conflictPaths.length) throw Error('Local memory job refused')
  const recovery = ['repair-needed', 'repaired', 'abandoned'].includes(job.status)
  if (!recovery && job.conflictPaths.length) throw Error('Local memory job refused')
  const conflictHead = nullableOid(job.conflictHead ?? null)
  const repair = parseRepairEvidence(job.repair ?? null)
  if (!recovery && (conflictHead || repair)) throw Error('Local memory job refused')
  if (repair && repair.workerCommit !== workerCommit) throw Error('Local memory job refused')
  if (
    job.status === 'repair-needed' &&
    repair &&
    (pendingIntegration !== repair.candidate || expectedParent !== repair.reviewedHead)
  )
    throw Error('Local memory job refused')
  if (
    job.status === 'repaired' &&
    (!repair || integratedCommit !== repair.candidate || pendingIntegration !== null)
  )
    throw Error('Local memory job refused')
  if (job.status === 'abandoned' && (repair || integratedCommit || pendingIntegration))
    throw Error('Local memory job refused')
  if (recovery && workerCommit === null) throw Error('Local memory job refused')
  const open = workerCommit === null && integratedCommit === null && pendingIntegration === null
  if ((job.status === 'queued' || job.status === 'running' || job.status === 'noop') && !open)
    throw Error('Local memory job refused')
  if (job.status === 'queued' && job.worktreePath !== null) throw Error('Local memory job refused')
  if (job.status === 'failed' && (integratedCommit !== null || pendingIntegration !== null))
    throw Error('Local memory job refused')
  if (
    job.status === 'committed' &&
    (workerCommit === null || integratedCommit !== null || job.worktreePath === null)
  )
    throw Error('Local memory job refused')
  if (
    job.status === 'integrated' &&
    (workerCommit === null || integratedCommit === null || pendingIntegration !== null)
  )
    throw Error('Local memory job refused')
  if (job.status === 'repair-needed' && (workerCommit === null || integratedCommit !== null))
    throw Error('Local memory job refused')
  const record = job as LocalJobRecord & { kind?: unknown; reflection?: unknown }
  let kind: LocalJobKind = 'ordinary'
  if (record.kind !== undefined) {
    if (record.kind !== 'ordinary' && record.kind !== 'reflection') throw Error('Local memory job refused')
    kind = record.kind
  }
  const reflection = parseJobReflection(record.reflection, kind)
  return {
    version: 1,
    id: job.id,
    kind,
    status: job.status as LocalJobStatus,
    summary: job.summary,
    baseHead: job.baseHead,
    workerCommit,
    integratedCommit,
    pendingIntegration,
    expectedParent,
    worktreePath: job.worktreePath,
    conflictPaths: [...job.conflictPaths],
    conflictHead,
    repair,
    sequence: job.sequence,
    reflection,
  }
}

export function parseRepairEvidence(value: unknown): LocalRepairEvidence | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Local memory job refused')
  const record = value as LocalRepairEvidence
  if (
    Object.keys(record).sort().join() !==
    'candidate,forgettingDigest,resolutionDigest,reviewedHead,tree,workerCommit'
  )
    throw Error('Local memory job refused')
  for (const oid of [record.reviewedHead, record.workerCommit, record.tree, record.candidate]) assertOid(oid)
  for (const digest of [record.forgettingDigest, record.resolutionDigest])
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) throw Error('Local memory job refused')
  return { ...record }
}

export function parseOwnership(value: unknown): LocalOwnershipRecord {
  if (!value || typeof value !== 'object') throw Error('Local memory ownership refused')
  const record = value as LocalOwnershipRecord
  assertJobId(record.jobId)
  if (
    record.version !== 1 ||
    typeof record.path !== 'string' ||
    typeof record.dev !== 'string' ||
    typeof record.ino !== 'string' ||
    typeof record.nonce !== 'string' ||
    typeof record.repository !== 'string' ||
    typeof record.gitDir !== 'string' ||
    !record.gitDir.startsWith('/')
  )
    throw Error('Local memory ownership refused')
  return {
    version: 1,
    jobId: record.jobId,
    path: record.path,
    dev: record.dev,
    ino: record.ino,
    nonce: record.nonce,
    repository: record.repository,
    gitDir: record.gitDir,
  }
}

async function readRecords<T>(directory: string, parse: (value: unknown, id: string) => T): Promise<T[]> {
  await assertRealDirectory(directory)
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  names = names.filter((name) => !isOwnedTempName(name))
  if (names.length > 64) throw Error('Local memory record refused')
  const records: T[] = []
  for (const name of names) {
    if (!name.endsWith('.json') || !jobIdPattern.test(name.slice(0, -'.json'.length))) continue
    const id = name.slice(0, -'.json'.length)
    const file = await readRegularFile(join(directory, name))
    records.push(parse(JSON.parse(file.text), id))
  }
  return records
}

export function jobFile(stateRoot: string, id: string): string {
  assertJobId(id)
  return join(stateRoot, 'jobs', `${id}.json`)
}

export function ownershipFile(stateRoot: string, id: string): string {
  assertJobId(id)
  return join(stateRoot, 'ownership', `${id}.json`)
}

export async function loadJob(stateRoot: string, id: string): Promise<LocalJobRecord> {
  const file = await readRegularFile(jobFile(stateRoot, id))
  return parseJob(JSON.parse(file.text), { id, stateRoot })
}

export async function saveJob(stateRoot: string, job: LocalJobRecord): Promise<LocalJobRecord> {
  const stored = parseJob(job, { id: job.id, stateRoot })
  const prior = await readRegularFile(jobFile(stateRoot, stored.id)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (prior) {
    const previous = parseJob(JSON.parse(prior.text), { id: stored.id, stateRoot })
    if (previous.kind !== stored.kind) throw Error('Local memory trajectory refused')
    if (['repair-needed', 'repaired', 'abandoned'].includes(previous.status)) {
      for (const key of ['baseHead', 'workerCommit', 'conflictHead', 'conflictPaths'] as const)
        if (JSON.stringify(previous[key]) !== JSON.stringify(stored[key]))
          throw Error('Local memory recovery evidence refused')
      if (previous.repair && JSON.stringify(previous.repair) !== JSON.stringify(stored.repair))
        throw Error('Local memory recovery evidence refused')
      if (previous.status !== 'repair-needed' && previous.status !== stored.status)
        throw Error('Local memory recovery terminal')
    }
    if (previous.kind === 'reflection' && previous.reflection?.digest !== stored.reflection?.digest)
      throw Error('Local memory trajectory refused')
  }
  const json = `${JSON.stringify(stored)}\n`
  if (Buffer.byteLength(json) > 60000) throw Error('Local memory trajectory refused')
  await writeJson(jobFile(stateRoot, stored.id), stored)
  return stored
}

export function listJobs(stateRoot: string): Promise<LocalJobRecord[]> {
  return readRecords(join(stateRoot, 'jobs'), (value, id) => parseJob(value, { id, stateRoot }))
}

export function listOwnership(stateRoot: string): Promise<LocalOwnershipRecord[]> {
  return readRecords(join(stateRoot, 'ownership'), (value) => parseOwnership(value))
}

export function progressFile(stateRoot: string, id: string): string {
  assertJobId(id)
  return join(stateRoot, 'progress', `${id}.json`)
}

export function parseProgress(value: unknown, id: string): LocalProgressRecord {
  if (!value || typeof value !== 'object') throw Error('Local memory progress refused')
  const record = value as LocalProgressRecord
  assertJobId(record.jobId)
  if (record.jobId !== id || record.version !== 1) throw Error('Local memory progress refused')
  if (!['adding', 'added', 'owned', 'removing'].includes(record.phase))
    throw Error('Local memory progress refused')
  if (typeof record.path !== 'string' || typeof record.nonce !== 'string')
    throw Error('Local memory progress refused')
  for (const field of [record.dev, record.ino, record.gitDir])
    if (field !== null && typeof field !== 'string') throw Error('Local memory progress refused')
  return { ...record, version: 1 }
}

export async function loadProgress(stateRoot: string): Promise<LocalProgressRecord[]> {
  return readRecords(join(stateRoot, 'progress'), (value, id) => parseProgress(value, id))
}

export async function saveProgress(stateRoot: string, record: LocalProgressRecord): Promise<void> {
  await writeJson(progressFile(stateRoot, record.jobId), parseProgress(record, record.jobId))
}

export async function deleteProgress(stateRoot: string, id: string): Promise<void> {
  verifyLocalMemoryClaim()
  await unlink(progressFile(stateRoot, id)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

export async function certifyServiceFiles(stateRoot: string): Promise<void> {
  await assertRealDirectory(stateRoot)
  for (const name of localStateDirectoryNames) await assertRealDirectory(join(stateRoot, name))
  const identity = await readRegularFile(join(stateRoot, 'git-identity'))
  if (identity.text !== localGitIdentity) throw Error('Local memory identity refused')
  await readRegularFile(join(stateRoot, 'meta.json'))
}
