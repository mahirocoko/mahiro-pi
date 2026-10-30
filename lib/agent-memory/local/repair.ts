import { createHash } from 'node:crypto'
import { lstat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type LocalJobRecord,
  type LocalRepairRequest,
  type SyntheticLocalInjection,
  assertOid,
  assertRelativePath,
  localMemoryLimits,
} from './contracts.ts'
import { forgettingGuard, isProtectedMemoryPath, loadForgetting } from './forgetting.ts'
import {
  type LocalGitContext,
  gitBlobPrefix,
  gitCommitParents,
  gitCommitTree,
  gitEmptyIndex,
  gitEntriesRecursive,
  gitHashObject,
  gitMain,
  gitMergeTree,
  gitStage,
  gitTree,
  gitUpdateMain,
  gitWriteTree,
} from './git.ts'
import { saveJob } from './jobs.ts'

function refuse(): never {
  throw Error('Local memory repair refused')
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function resolutionsOf(input: LocalRepairRequest, job: LocalJobRecord) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) refuse()
  if (Object.keys(input).sort().join() !== 'expectedHead,id,resolutions,workerCommit' || input.id !== job.id)
    refuse()
  assertOid(input.expectedHead)
  assertOid(input.workerCommit)
  if (input.workerCommit !== job.workerCommit) refuse()
  const values = input.resolutions
  if (!values || typeof values !== 'object' || Array.isArray(values)) refuse()
  const paths = Object.keys(values).sort()
  if (!paths.length || paths.length > localMemoryLimits.maxPaths || !samePaths(paths, job.conflictPaths))
    refuse()
  const entries = paths.map((path) => {
    assertRelativePath(path)
    const text = values[path]
    if (text === null) {
      if (isProtectedMemoryPath(path)) refuse()
    } else if (
      typeof text !== 'string' ||
      text.includes('\0') ||
      Buffer.byteLength(text) > localMemoryLimits.maxFileBytes ||
      // Reject lone surrogates rather than silently changing caller resolutions in UTF-8.
      Buffer.from(text).toString('utf8') !== text
    )
      refuse()
    return [path, text] as const
  })
  const digest = createHash('sha256').update(JSON.stringify(entries)).digest('hex')
  return { entries, digest }
}

// Called only inside the coordinator's service turn. No worker or model publishes.
// A prepared candidate is immutable; uncertain/stale publication is retained, not abandoned.
export async function repairLocalJob(input: {
  git: LocalGitContext
  stateRoot: string
  job: LocalJobRecord
  request: LocalRepairRequest
  injection?: SyntheticLocalInjection
}): Promise<LocalJobRecord> {
  const { git, stateRoot, injection } = input
  const request = { ...input.request }
  let job = input.job
  const resolutions = resolutionsOf(request, job)
  if (job.status !== 'repair-needed' && job.status !== 'repaired') refuse()
  const previous = job.repair
  if (
    previous &&
    (previous.reviewedHead !== request.expectedHead ||
      previous.workerCommit !== request.workerCommit ||
      previous.resolutionDigest !== resolutions.digest)
  )
    refuse()
  if (job.status === 'repaired') return job
  if (job.pendingIntegration && !previous) refuse()
  const policy = await loadForgetting(stateRoot)
  if (previous && previous.forgettingDigest !== policy.digest) refuse()
  const guard = forgettingGuard(policy)
  const forbiddenPath = (path: string) =>
    guard.pathForbidden(path) ||
    (policy.snapshot?.sources.some((source) => source.source === path || source.project === path) ?? false)
  for (const [path, text] of resolutions.entries) {
    if (forbiddenPath(path) || (text !== null && guard.textForbidden(text))) refuse()
  }
  const head = await gitMain(git)
  if (head !== request.expectedHead && head !== previous?.candidate) refuse()
  // Reproduce the reviewed automatic *non-conflicting* result, then replace every
  // conflict with explicit caller content. Never accept Git's conflict-marker blobs.
  const merged = await gitMergeTree(git, request.expectedHead, request.workerCommit)
  const conflicts = merged.conflicts.filter((path) => !guard.pathForbidden(path))
  if (!samePaths(conflicts, job.conflictPaths)) refuse()
  const entries = await gitEntriesRecursive(git, merged.tree)
  if (entries.length > 1024) refuse()
  const replacements = new Map(resolutions.entries)
  const index = join(stateRoot, 'repair.index')
  const clearIndex = async () => {
    const stat = await lstat(index).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!stat) return
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) refuse()
    await unlink(index)
  }
  await clearIndex()
  let tree: string
  try {
    await gitEmptyIndex(git, index)
    let bytes = 0
    // Preserve protected compact owners that exist in the reviewed canonical head.
    // A worker-side deletion disappears from the merge tree, while a legacy root that
    // never had index.md must remain repairable without inventing it.
    const reviewedEntries = await gitEntriesRecursive(git, request.expectedHead)
    if (reviewedEntries.length > 1024) refuse()
    const required = new Set(
      reviewedEntries.filter((entry) => isProtectedMemoryPath(entry.path)).map((entry) => entry.path),
    )
    for (const entry of entries) {
      if (replacements.has(entry.path)) continue
      assertRelativePath(entry.path)
      if (forbiddenPath(entry.path) || guard.oidForbidden(entry.oid)) {
        if (isProtectedMemoryPath(entry.path)) refuse()
        continue
      }
      if (entry.mode !== '100644' || entry.type !== 'blob') refuse()
      const loaded = await gitBlobPrefix(git, entry.oid, localMemoryLimits.maxFileBytes)
      if (loaded.total !== loaded.bytes.length) refuse()
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(loaded.bytes)
      } catch {
        refuse()
      }
      if (text.includes('\0')) refuse()
      bytes += loaded.total
      if (bytes > localMemoryLimits.maxPaths * localMemoryLimits.maxFileBytes) refuse()
      await gitStage(git, index, entry.oid, entry.path)
      required.delete(entry.path)
    }
    for (const [path, text] of resolutions.entries) {
      if (text === null) continue
      bytes += Buffer.byteLength(text)
      if (bytes > localMemoryLimits.maxPaths * localMemoryLimits.maxFileBytes) refuse()
      await gitStage(git, index, await gitHashObject(git, text), path)
      required.delete(path)
    }
    if (required.size) refuse()
    tree = await gitWriteTree(git, index)
  } finally {
    await clearIndex()
  }
  if (previous) {
    const parents = await gitCommitParents(git, previous.candidate)
    if (
      previous.tree !== tree ||
      (await gitTree(git, previous.candidate)) !== tree ||
      parents.length !== 2 ||
      parents[0] !== request.expectedHead ||
      parents[1] !== request.workerCommit
    )
      refuse()
  } else {
    const candidate = await gitCommitTree(
      git,
      tree,
      [request.expectedHead, request.workerCommit],
      `Repair local memory: ${job.summary}`,
    )
    job = await saveJob(stateRoot, {
      ...job,
      pendingIntegration: candidate,
      expectedParent: request.expectedHead,
      repair: {
        reviewedHead: request.expectedHead,
        workerCommit: request.workerCommit,
        resolutionDigest: resolutions.digest,
        forgettingDigest: policy.digest,
        tree,
        candidate,
      },
    })
    if (injection?.stopAfter === 'repair-prepared') throw Error('Local memory repair interrupted')
  }
  const evidence = job.repair
  if (!evidence) refuse()
  if ((await loadForgetting(stateRoot)).digest !== evidence.forgettingDigest) refuse()
  const now = await gitMain(git)
  if (now === evidence.reviewedHead) await gitUpdateMain(git, evidence.candidate, evidence.reviewedHead)
  else if (now !== evidence.candidate) refuse()
  if (injection?.stopAfter === 'repair-published') throw Error('Local memory repair interrupted')
  const saved = await saveJob(stateRoot, {
    ...job,
    status: 'repaired',
    integratedCommit: evidence.candidate,
    pendingIntegration: null,
    expectedParent: null,
  })
  // Deliberately no settleReflection: repaired knowledge is not consumed experience.
  if (injection?.stopAfter === 'repair-terminal') throw Error('Local memory repair interrupted')
  return saved
}

export async function abandonLocalJob(stateRoot: string, job: LocalJobRecord): Promise<LocalJobRecord> {
  if (job.status === 'abandoned') return job
  if (job.status !== 'repair-needed' || job.pendingIntegration || job.expectedParent || job.repair)
    throw Error('Local memory abandonment refused')
  // Evidence and worktree ownership remain. Explicit cleanup is a separate operation.
  return saveJob(stateRoot, { ...job, status: 'abandoned' })
}
