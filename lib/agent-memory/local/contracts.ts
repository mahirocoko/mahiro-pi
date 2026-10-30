import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, parse, resolve, sep } from 'node:path'
import { type TrajectoryProjection } from './trajectory.ts'

export const localMemoryLimits = {
  maxJobs: 32,
  maxPaths: 32,
  maxSummary: 120,
  maxFileBytes: 262144,
  maxRecordBytes: 65536,
  maxDirectoryEntries: 64,
} as const

export const localJobStatuses = [
  'queued',
  'running',
  'committed',
  'integrated',
  'noop',
  'repair-needed',
  'repaired',
  'abandoned',
  'failed',
] as const

export type LocalJobStatus = (typeof localJobStatuses)[number]
export type LocalJobKind = 'ordinary' | 'reflection'

export interface LocalRepairEvidence {
  reviewedHead: string
  workerCommit: string
  resolutionDigest: string
  forgettingDigest: string
  tree: string
  candidate: string
}

export interface LocalRepairRequest {
  id: string
  expectedHead: string
  workerCommit: string
  /** Exact conflict coverage. null explicitly deletes a non-required file. */
  resolutions: Record<string, string | null>
}

export interface LocalJobRecord {
  version: 1
  id: string
  kind: LocalJobKind
  status: LocalJobStatus
  summary: string
  baseHead: string
  workerCommit: string | null
  integratedCommit: string | null
  pendingIntegration: string | null
  expectedParent: string | null
  worktreePath: string | null
  conflictPaths: string[]
  /** Absent in legacy version-1 records; never infer a historical conflict head. */
  conflictHead?: string | null
  repair?: LocalRepairEvidence | null
  sequence: number
  reflection: TrajectoryProjection | null
}

export interface LocalServiceMeta {
  version: 1
  repository: string
  nonce: string
  nextSequence: number
}

export interface LocalOwnershipRecord {
  version: 1
  jobId: string
  path: string
  dev: string
  ino: string
  nonce: string
  repository: string
  gitDir: string
}

export interface LocalProgressRecord {
  version: 1
  jobId: string
  phase: 'adding' | 'added' | 'owned' | 'removing'
  path: string
  nonce: string
  dev: string | null
  ino: string | null
  gitDir: string | null
}

export interface LocalWorkerContext {
  jobId: string
  worktreeRoot: string
  write(relativePath: string, text: string): void
}

export type LocalWorker = (context: LocalWorkerContext) => Promise<void> | void

export const jobIdPattern = /^[a-z][a-z0-9-]{0,31}$/
export const relativePathPattern =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63})(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,7}$/
export const oidPattern = /^[0-9a-f]{40,64}$/
export const localGitIdentity =
  '[user]\nname = Synthetic Local Memory\nemail = local-memory@example.invalid\n[commit]\ngpgsign = false\n'

export interface LocalFileIdentity {
  dev: string
  ino: string
}

export const canonicalGitDirectoryName = 'canonical.git'

export const localStateDirectoryNames = [
  'jobs',
  'ownership',
  'worktrees',
  'empty-hooks',
  'progress',
  'watermarks',
] as const

export interface SyntheticLocalInjection {
  stopAfter?:
    | 'running'
    | 'worktree-adding'
    | 'worktree-added'
    | 'ownership-written'
    | 'worktree-path'
    | 'commit'
    | 'worktree-removed'
    | 'recover-removed'
    | 'identity'
    | 'forgetting-recorded'
    | 'repair-prepared'
    | 'repair-published'
    | 'repair-terminal'
  failCleanupRemoves?: number
  /** Test seam. Runs after an operation captures refs/heads/main and before it reads objects. */
  afterCommitResolved?: (commit: string) => Promise<void> | void
}

export function assertJobId(id: string): void {
  if (!jobIdPattern.test(id)) throw Error('Local memory job id refused')
}

export function assertRelativePath(path: string): void {
  if (!relativePathPattern.test(path) || path.split('/').includes('.git'))
    throw Error('Local memory path refused')
}

export function assertSummary(summary: string): void {
  if (
    summary.length < 1 ||
    summary.length > localMemoryLimits.maxSummary ||
    /[\u0000-\u001f\u007f]/.test(summary)
  )
    throw Error('Local memory summary refused')
}

export function assertOid(value: string): void {
  if (!oidPattern.test(value)) throw Error('Local Git object refused')
}

export async function assertExactDirectory(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path) throw Error('Canonical absolute path required')
  let current = parse(path).root
  for (const part of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    const stat = await lstat(current)
    if (stat.isSymbolicLink()) throw Error('Linked path refused')
  }
  const stat = await lstat(path)
  if (!stat.isDirectory()) throw Error('Directory required')
  const canonical = await realpath(path)
  if (canonical !== path) throw Error('Canonical absolute path required')
  return canonical
}
