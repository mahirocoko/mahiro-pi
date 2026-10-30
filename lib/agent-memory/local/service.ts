import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath, unlink } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { readRegularFile, writeNoFollow } from './confine.ts'
import {
  type LocalJobRecord,
  type LocalServiceMeta,
  type LocalWorker,
  type SyntheticLocalInjection,
  assertExactDirectory,
  assertJobId,
  assertOid,
  assertRelativePath,
  assertSummary,
  canonicalGitDirectoryName,
  localGitIdentity,
  localMemoryLimits,
} from './contracts.ts'
import {
  type LocalGitContext,
  gitAddAll,
  gitCommit,
  gitCommitParents,
  gitCommitTree,
  gitBlobPrefix,
  gitBlobSize,
  gitEntriesRecursive,
  gitEntryAt,
  gitEmptyIndex,
  gitRequireCommit,
  gitHashObject,
  gitIndexClean,
  gitInitBare,
  gitIsAncestor,
  gitMain,
  gitMainPresence,
  gitMergeTree,
  gitShow,
  gitStage,
  gitStageMode,
  gitTree,
  gitUpdateMain,
  gitWorktreeDirty,
  gitWorktreeHead,
  gitWorktreeIndex,
  gitWorktreeUnstage,
  gitWriteTree,
  localGitEnvironment,
  publicationMatches,
} from './git.ts'
import {
  certifyServiceFiles,
  deleteProgress,
  ensureStateDirs,
  listJobs,
  listOwnership,
  loadJob,
  loadProgress,
  ownershipFile,
  parseMeta,
  saveJob,
  writeJson,
} from './jobs.ts'
import { cleanupOwnedWorktree, createOwnedWorktree } from './worktrees.ts'
import {
  type ReflectionReceipt,
  type SyntheticTrajectoryConfig,
  type SyntheticTrajectoryRequest,
  type TrajectoryProjection,
  type WatermarkView,
  normalizeTrajectoryConfig,
  performReflection,
  readWatermarkView,
  settleReflection,
  trajectoryView,
} from './trajectory.ts'
import { createMaintenanceWorkspace, removeHiddenMemoryFile } from './workspace.ts'
import {
  type ForgettingGuard,
  type ForgettingMetadata,
  type ForgettingRecord,
  type TombstoneImport,
  createEmptyForgetting,
  forgettingFile,
  forgettingGuard,
  forgettingMetadata,
  forgettingRemovalRecord,
  forgettingRemovedRecord,
  isProtectedMemoryPath,
  loadForgetting,
  localGitBlobId,
  parseTombstoneImport,
  prepareForgettingImport,
  saveForgetting,
  suppressForgotten,
} from './forgetting.ts'
import {
  type PalaceCorpusFact,
  type PalaceJobFact,
  type PalaceRecoveryFact,
  type PalaceSnapshot,
  buildPalaceSnapshot,
  palaceEntryKind,
  palacePreviewLimits,
} from './palace.ts'
import {
  type PalaceCorpusPage,
  type PalaceCorpusRequest,
  buildPalaceCorpusPage,
  palaceCorpusLimits,
} from './palace-corpus.ts'
import {
  type PalaceDocument,
  type PalaceDocumentRequest,
  buildPalaceDocument,
  clipPalaceUtf8,
  palaceDocumentLimits,
} from './palace-document.ts'
import { assertPalacePath } from './palace-path.ts'
import {
  type LocalMemoryList,
  type LocalMemoryPrompt,
  type LocalMemoryRead,
  compileLocalMemoryPrompt,
  listLocalMemory,
  readLocalMemory,
} from './projection.ts'

// Synthetic bare-repository service. Not ABI3 and not an installed memory selector.
export interface SyntheticLocalMemoryService {
  enqueue(input: { id: string; summary: string }): Promise<LocalJobRecord>
  start(id: string): Promise<LocalJobRecord>
  integrate(id: string): Promise<LocalJobRecord>
  resume(id: string): Promise<LocalJobRecord>
  readCommitted(relativePath: string): Promise<string>
  job(id: string): Promise<LocalJobRecord>
  head(): Promise<string>
  cleanup(path: string): Promise<void>
  reflect(request: SyntheticTrajectoryRequest): Promise<ReflectionReceipt>
  retry(id: string): Promise<LocalJobRecord>
  watermark(identity: { sessionId: string; branchId: string }): Promise<WatermarkView>
  compilePrompt(input?: { project?: string }): Promise<LocalMemoryPrompt>
  readMemory(input: {
    path: string
    project?: string
    offset?: number
    limit?: number
  }): Promise<LocalMemoryRead>
  listMemory(input?: {
    path?: string
    project?: string
    offset?: number
    limit?: number
  }): Promise<LocalMemoryList>
  importTombstones(input: TombstoneImport): Promise<ForgettingMetadata>
  palacePreview(): Promise<PalaceSnapshot>
  palaceCorpusPage(request: PalaceCorpusRequest): Promise<PalaceCorpusPage>
  palaceDocument(request: PalaceDocumentRequest): Promise<PalaceDocument>
}

export type { LocalJobRecord, LocalWorker }

function commitMessage(summary: string): string {
  assertSummary(summary)
  return `Maintain local memory: ${summary}`
}

async function createIdentity(path: string): Promise<void> {
  const handle = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
    0o600,
  )
  try {
    await handle.writeFile(localGitIdentity)
  } finally {
    await handle.close()
  }
}

async function clearSeedIndex(stateRoot: string): Promise<void> {
  const index = join(stateRoot, 'seed.index')
  const stat = await lstat(index).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!stat) return
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Local memory seed refused')
  await unlink(index)
}

function validateSeed(files: Record<string, string> | undefined) {
  const entries = Object.entries(files ?? {})
  if (!entries.length) throw Error('Local memory seed refused')
  for (const [path, text] of entries) {
    assertRelativePath(path)
    if (
      typeof text !== 'string' ||
      text.includes('\0') ||
      Buffer.byteLength(text) > localMemoryLimits.maxFileBytes
    )
      throw Error('Local memory seed refused')
  }
}

async function openState(
  stateRoot: string,
  initialFiles: Record<string, string> | undefined,
  stopAfter?: string,
): Promise<{ meta: LocalServiceMeta; git: LocalGitContext; bare: string; created: boolean }> {
  await clearSeedIndex(stateRoot)
  const bare = join(stateRoot, canonicalGitDirectoryName)
  const metaPath = join(stateRoot, 'meta.json')
  const identityPath = join(stateRoot, 'git-identity')
  const hooksPath = join(stateRoot, 'empty-hooks')
  const bareStat = await lstat(bare).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  const metaStat = await lstat(metaPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (bareStat?.isSymbolicLink() || metaStat?.isSymbolicLink()) throw Error('Local memory repository refused')
  const gitBase = (): LocalGitContext => ({
    bare,
    env: localGitEnvironment(identityPath),
    hooksPath,
    identityPath,
  })
  if (!bareStat && !metaStat) {
    validateSeed(initialFiles)
    await clearSeedIndex(stateRoot)
    const identityStat = await lstat(identityPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (identityStat?.isSymbolicLink() || (identityStat && !identityStat.isFile()))
      throw Error('Local memory repository refused')
    if (!identityStat) {
      await ensureStateDirs(stateRoot)
      await createIdentity(identityPath)
      if (stopAfter === 'identity') throw Error('Local memory initialization interrupted')
    } else {
      const identity = await readRegularFile(identityPath)
      if (identity.text !== localGitIdentity) throw Error('Local memory repository refused')
      await ensureStateDirs(stateRoot)
    }
    const hooksStat = await lstat(hooksPath)
    if (hooksStat.isSymbolicLink() || !hooksStat.isDirectory() || (await readdir(hooksPath)).length)
      throw Error('Local memory hooks refused')
    const git = gitBase()
    await gitInitBare(git, bare)
    if ((await realpath(bare)) !== bare) throw Error('Local memory repository refused')
    const meta: LocalServiceMeta = {
      version: 1,
      repository: bare,
      nonce: randomBytes(16).toString('hex'),
      nextSequence: 1,
    }
    await writeJson(metaPath, meta)
    if ((await gitMainPresence(git)) !== 'absent') throw Error('Local memory repository refused')
    await seed(git, stateRoot, initialFiles)
    return { meta, git, bare, created: true }
  }
  if (!bareStat?.isDirectory() || !metaStat?.isFile()) throw Error('Local memory repository refused')
  if ((await realpath(bare)) !== bare) throw Error('Local memory repository refused')
  let parsed: unknown
  try {
    parsed = JSON.parse((await readRegularFile(metaPath)).text)
  } catch (error) {
    if (error instanceof Error && error.message === 'Local memory record refused') throw error
    throw Error('Local memory state refused')
  }
  const meta = parseMeta(parsed, bare)
  await clearSeedIndex(stateRoot)
  await certifyServiceFiles(stateRoot)
  const git = gitBase()
  if ((await gitMainPresence(git)) !== 'present') throw Error('Local memory repository refused')
  return { meta, git, bare, created: false }
}

async function seed(
  git: LocalGitContext,
  stateRoot: string,
  files: Record<string, string> | undefined,
): Promise<void> {
  const entries = Object.entries(files ?? {})
  if (!entries.length) throw Error('Local memory seed refused')
  const index = join(stateRoot, 'seed.index')
  try {
    for (const [path, text] of entries) {
      assertRelativePath(path)
      if (
        typeof text !== 'string' ||
        text.includes('\0') ||
        Buffer.byteLength(text) > localMemoryLimits.maxFileBytes
      )
        throw Error('Local memory seed refused')
      await gitStage(git, index, await gitHashObject(git, text), path)
    }
    await gitUpdateMain(
      git,
      await gitCommitTree(git, await gitWriteTree(git, index), [], 'Seed synthetic memory'),
    )
  } finally {
    const stat = await lstat(index).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (stat?.isFile() && !stat.isSymbolicLink()) await unlink(index)
  }
}

const turns = new Map<string, Promise<void>>()
const retiredRoots = new Set<string>()

function turn<T>(stateRoot: string, body: () => Promise<T>): Promise<T> {
  const previous = turns.get(stateRoot) ?? Promise.resolve()
  const run = previous.then(
    () => {
      if (retiredRoots.has(stateRoot)) throw Error('Local memory repository refused')
      return body()
    },
    () => {
      if (retiredRoots.has(stateRoot)) throw Error('Local memory repository refused')
      return body()
    },
  )
  turns.set(
    stateRoot,
    run.then(
      () => {},
      () => {},
    ),
  )
  return run
}

export function localMemoryTurn<T>(stateRoot: string, body: () => Promise<T>): Promise<T> {
  return turn(stateRoot, body)
}

export function retireLocalMemoryRoot(stateRoot: string): void {
  retiredRoots.add(stateRoot)
}

export async function createSyntheticLocalMemoryService(options: {
  stateRoot: string
  worker: LocalWorker
  initialFiles?: Record<string, string>
  injection?: SyntheticLocalInjection
  trajectory?: SyntheticTrajectoryConfig
}): Promise<SyntheticLocalMemoryService> {
  const trajectoryRuntime = normalizeTrajectoryConfig(options.trajectory)
  const stateRoot = await assertExactDirectory(options.stateRoot)
  const opened = await turn(stateRoot, () =>
    openState(stateRoot, options.initialFiles, options.injection?.stopAfter),
  )
  let meta = opened.meta
  const { git, bare, created } = opened
  const metaPath = join(stateRoot, 'meta.json')
  let failRemoves = options.injection?.failCleanupRemoves ?? 0
  let forgettingInitialized = false
  let recoveryNotes: PalaceRecoveryFact[] = []

  const missingFile = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

  const clearIndex = async (index: string) => {
    const stat = await lstat(index).catch((error: unknown) => {
      if (missingFile(error)) return undefined
      throw error
    })
    if (!stat) return
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Local memory forgetting refused')
    await unlink(index)
  }

  const installForgetting = async () => {
    const stat = await lstat(forgettingFile(stateRoot)).catch((error: unknown) => {
      if (missingFile(error)) return undefined
      throw error
    })
    if (!stat) {
      if (forgettingInitialized || !created) throw Error('Local memory forgetting refused')
      await createEmptyForgetting(stateRoot)
      forgettingInitialized = true
      return
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw Error('Local memory forgetting refused')
    await loadForgetting(stateRoot)
    forgettingInitialized = true
  }

  const readyPolicy = async (): Promise<ForgettingRecord> => {
    await installForgetting()
    let record = await loadForgetting(stateRoot)
    if (record.migration?.phase !== 'removing') return record
    const removal = record.migration.removalCommit
    if (!removal) throw Error('Local memory forgetting refused')
    await gitRequireCommit(git, removal)
    const guard = forgettingGuard(record)
    for (const entry of await gitEntriesRecursive(git, removal)) {
      if (suppressForgotten(entry.path, entry.oid, guard)) throw Error('Local memory forgetting refused')
    }
    const main = await gitMain(git)
    if (main === record.migration.priorMain) await gitUpdateMain(git, removal, record.migration.priorMain)
    else if (main !== removal) throw Error('Local memory forgetting refused')
    const removed = forgettingRemovedRecord(record)
    await saveForgetting(stateRoot, removed, record.digest)
    record = await loadForgetting(stateRoot)
    if (record.digest !== removed.digest || record.migration?.phase !== 'removed')
      throw Error('Local memory forgetting refused')
    return record
  }

  const protectedFallbackOid = async (
    record: ForgettingRecord,
    path: string,
    guard: ForgettingGuard,
  ): Promise<string | undefined> => {
    const candidates = [record.migration?.removalCommit, record.migration?.priorMain].filter(
      (commit): commit is string => typeof commit === 'string',
    )
    for (const commit of candidates) {
      const entry = await gitEntryAt(git, commit, path)
      if (!entry || entry.type !== 'blob' || entry.mode !== '100644') continue
      if (guard.oidForbidden(entry.oid)) continue
      return entry.oid
    }
    return undefined
  }

  const stripTree = async (treeish: string, guard: ForgettingGuard, fallback: string): Promise<string> => {
    const entries = await gitEntriesRecursive(git, treeish)
    const previous = new Map((await gitEntriesRecursive(git, fallback)).map((entry) => [entry.path, entry]))
    const index = join(stateRoot, 'forget.index')
    await clearIndex(index)
    try {
      await gitEmptyIndex(git, index)
      const seen = new Set<string>()
      for (const entry of entries) {
        if (seen.has(entry.path)) throw Error('Local Git object refused')
        seen.add(entry.path)
        let kept = entry
        if (isProtectedMemoryPath(entry.path) && guard.oidForbidden(entry.oid)) {
          const stable = previous.get(entry.path)
          if (!stable || guard.oidForbidden(stable.oid)) throw Error('Local memory forgetting refused')
          kept = stable
        } else if (suppressForgotten(entry.path, entry.oid, guard)) continue
        await gitStageMode(git, index, kept.mode, kept.oid, kept.path)
      }
      for (const path of ['Core.md', 'index.md']) {
        if (seen.has(path)) continue
        const stable = previous.get(path)
        if (!stable || stable.type !== 'blob') continue
        if (guard.oidForbidden(stable.oid)) throw Error('Local memory forgetting refused')
        await gitStageMode(git, index, stable.mode, stable.oid, path)
      }
      return await gitWriteTree(git, index)
    } finally {
      await clearIndex(index)
    }
  }

  const readJob = async (id: string): Promise<LocalJobRecord> => {
    const job = await loadJob(stateRoot, id)
    if (job.workerCommit) {
      const parents = await gitCommitParents(git, job.workerCommit)
      if (parents.length !== 1 || parents[0] !== job.baseHead) throw Error('Local memory job refused')
    }
    if (job.integratedCommit && job.workerCommit && job.integratedCommit !== job.workerCommit) {
      try {
        if (!(await gitIsAncestor(git, job.workerCommit, job.integratedCommit))) throw Error('lineage')
      } catch {
        throw Error('Local memory job refused')
      }
    }
    return job
  }

  const recover = async (job: LocalJobRecord): Promise<LocalJobRecord> => {
    const finish = (next: LocalJobRecord): LocalJobRecord => {
      if (job.status === 'running') {
        if (next.status === 'committed') recoveryNotes.push({ jobId: job.id, outcome: 'committed' })
        else if (next.status === 'failed') recoveryNotes.push({ jobId: job.id, outcome: 'failed' })
        else if (next.status === 'running') recoveryNotes.push({ jobId: job.id, outcome: 'interrupted' })
      }
      return next
    }
    if (job.status !== 'running') return job
    if (!job.worktreePath) return finish(await saveJob(stateRoot, { ...job, status: 'failed' }))
    const ownership = (await listOwnership(stateRoot)).find((item) => item.jobId === job.id)
    if (!ownership || ownership.path !== job.worktreePath || ownership.nonce !== meta.nonce)
      return finish(await saveJob(stateRoot, { ...job, status: 'failed' }))
    const stat = await lstat(job.worktreePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    const sameIdentity =
      !!stat &&
      !stat.isSymbolicLink() &&
      stat.isDirectory() &&
      String(stat.dev) === ownership.dev &&
      String(stat.ino) === ownership.ino
    if (!sameIdentity) return finish(await saveJob(stateRoot, { ...job, status: 'failed' }))
    const head = await gitWorktreeHead(git, ownership.gitDir, job.worktreePath)
    const parents = await gitCommitParents(git, head)
    if (parents.length !== 1 || parents[0] !== job.baseHead) {
      if (!(await gitWorktreeDirty(git, ownership.gitDir, job.worktreePath))) {
        const stopped = await cleanupOwnedWorktree(
          git,
          stateRoot,
          bare,
          meta.nonce,
          job.worktreePath,
          false,
          options.injection?.stopAfter === 'recover-removed',
        )
        if (stopped) return finish(job)
      }
      return finish(await saveJob(stateRoot, { ...job, status: 'failed' }))
    }
    return finish(await saveJob(stateRoot, { ...job, status: 'committed', workerCommit: head }))
  }

  const ours = async (path: string, gitDir: string | null) => {
    if (!gitDir?.startsWith(`${join(bare, 'worktrees')}${sep}`)) return false
    try {
      const recorded = /^gitdir: (.+)$/.exec((await readRegularFile(join(path, '.git'))).text.trim())?.[1]
      return recorded === gitDir
    } catch {
      return false
    }
  }

  const registrationNames = async (path: string, gitDir: string) => {
    try {
      return (await readRegularFile(join(gitDir, 'gitdir'))).text.trim() === join(path, '.git')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || (error instanceof Error && error.message === 'Local memory record refused'))
        return false
      throw error
    }
  }

  const reconcile = async () => {
    for (const item of await loadProgress(stateRoot)) {
      const expected = join(stateRoot, 'worktrees', item.jobId)
      if (item.path !== expected) {
        await deleteProgress(stateRoot, item.jobId)
        continue
      }
      const stat = await lstat(item.path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (item.phase === 'removing') {
        const same =
          !!stat && !stat.isSymbolicLink() && String(stat.dev) === item.dev && String(stat.ino) === item.ino
        if (same) continue
        if (stat) {
          await unlink(ownershipFile(stateRoot, item.jobId)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error
          })
          await deleteProgress(stateRoot, item.jobId)
          continue
        }
        await unlink(ownershipFile(stateRoot, item.jobId)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
        await deleteProgress(stateRoot, item.jobId)
        continue
      }
      if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
        await deleteProgress(stateRoot, item.jobId)
        continue
      }
      const inodeOk = item.dev === null || (item.dev === String(stat.dev) && item.ino === String(stat.ino))
      const linked = inodeOk && (await ours(item.path, item.gitDir))
      let dev = item.dev
      let ino = item.ino
      if (item.phase === 'adding') {
        if (!linked || !item.gitDir || !(await registrationNames(item.path, item.gitDir))) {
          await deleteProgress(stateRoot, item.jobId)
          continue
        }
        const canonical = await realpath(item.path)
        if (canonical !== item.path) {
          await deleteProgress(stateRoot, item.jobId)
          continue
        }
        dev = String(stat.dev)
        ino = String(stat.ino)
      } else if (!linked || !item.gitDir || !dev || !ino) {
        await deleteProgress(stateRoot, item.jobId)
        continue
      }
      if (!dev || !ino || !item.gitDir) throw Error('Local memory progress refused')
      const ownershipPath = ownershipFile(stateRoot, item.jobId)
      const existing = await lstat(ownershipPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (!existing)
        await writeJson(ownershipPath, {
          version: 1,
          jobId: item.jobId,
          path: item.path,
          dev,
          ino,
          nonce: item.nonce,
          repository: bare,
          gitDir: item.gitDir,
        })
      const running = await loadJob(stateRoot, item.jobId).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (running?.status === 'running' && !running.worktreePath)
        await saveJob(stateRoot, { ...running, worktreePath: item.path })
      await deleteProgress(stateRoot, item.jobId)
    }
  }

  const turnOnce = <T>(body: () => Promise<T>): Promise<T> =>
    turn(stateRoot, async () => {
      recoveryNotes = []
      await reconcile()
      await readyPolicy()
      for (const job of await listJobs(stateRoot)) if (job.status === 'running') await recover(job)
      return body()
    })

  const inFlight = async (exceptId?: string) => {
    const jobs = await listJobs(stateRoot)
    if (jobs.some((job) => job.id !== exceptId && (job.status === 'running' || job.status === 'committed')))
      throw Error('Local memory job in flight')
  }

  const markIntegrated = async (job: LocalJobRecord, integratedCommit: string) => {
    const saved = await saveJob(stateRoot, {
      ...job,
      status: 'integrated',
      integratedCommit,
      pendingIntegration: null,
      expectedParent: null,
      conflictPaths: [],
    })
    await settleReflection(stateRoot, saved)
    return saved
  }

  const publish = async (job: LocalJobRecord, pending: string, expected: string, workerCommit: string) => {
    if (!(await publicationMatches(git, pending, expected, workerCommit)))
      throw Error('Local memory publication refused')
    const main = await gitMain(git)
    if (main === pending) return markIntegrated(job, pending)
    if (main !== expected) throw Error('Local memory publication refused')
    await gitUpdateMain(git, pending, expected)
    return markIntegrated(job, pending)
  }

  const treeHasForgotten = async (commit: string, guard: ForgettingGuard) =>
    (await gitEntriesRecursive(git, commit)).some((entry) => suppressForgotten(entry.path, entry.oid, guard))

  const integrateActive = async (id: string, policy: ForgettingRecord): Promise<LocalJobRecord> => {
    const guard = forgettingGuard(policy)
    const current = await readJob(id)
    if (current.status === 'integrated' || current.status === 'noop' || current.status === 'failed')
      return current
    if (current.status === 'repair-needed') return current
    if (current.status !== 'committed' || !current.workerCommit)
      throw Error('Local memory job is not committed')
    const workerCommit = current.workerCommit
    let job = current
    const assertBound = async () => {
      const latest = await loadForgetting(stateRoot)
      if (latest.policyRevision !== policy.policyRevision || latest.digest !== policy.digest)
        throw Error('Local memory forgetting stale')
    }
    const publishClean = async (pending: string, expected: string) => {
      await assertBound()
      const pendingTree = await gitTree(git, pending)
      const merged = await gitMergeTree(git, expected, workerCommit)
      if (merged.conflicts.some((path) => !guard.pathForbidden(path)))
        throw Error('Local memory publication refused')
      const cleaned = await stripTree(merged.tree, guard, expected)
      if (pendingTree !== cleaned) throw Error('Local memory publication refused')
      const parents = await gitCommitParents(git, pending)
      const fastForward = pending === workerCommit && parents.length === 1 && parents[0] === expected
      const merge = parents.length === 2 && parents[0] === expected && parents[1] === workerCommit
      if (!fastForward && !merge) throw Error('Local memory publication refused')
      const workerParents = await gitCommitParents(git, workerCommit)
      const workerParent = workerParents[0]
      if (workerParents.length !== 1 || workerParent === undefined)
        throw Error('Local memory publication refused')
      if (!(await gitIsAncestor(git, workerParent, expected))) throw Error('Local memory publication refused')
      const head = await gitMain(git)
      if (head === pending) return markIntegrated(job, pending)
      if (head !== expected) throw Error('Local memory publication refused')
      await gitUpdateMain(git, pending, expected)
      return markIntegrated(job, pending)
    }
    const main = await gitMain(git)
    if (job.pendingIntegration && job.expectedParent)
      return publishClean(job.pendingIntegration, job.expectedParent)
    if (
      (main === workerCommit || (await gitIsAncestor(git, workerCommit, main))) &&
      !(await treeHasForgotten(main, guard))
    )
      return markIntegrated(job, main === workerCommit ? workerCommit : main)
    const merged = await gitMergeTree(git, main, workerCommit)
    const conflicts = merged.conflicts.filter((path) => !guard.pathForbidden(path))
    if (conflicts.length)
      return saveJob(stateRoot, {
        ...job,
        status: 'repair-needed',
        conflictPaths: conflicts,
        pendingIntegration: null,
        expectedParent: null,
      })
    const cleaned = await stripTree(merged.tree, guard, main)
    const workerTree = await gitTree(git, workerCommit)
    if (cleaned === workerTree && main === job.baseHead) {
      const parents = await gitCommitParents(git, workerCommit)
      if (parents.length !== 1 || parents[0] !== job.baseHead) throw Error('Local memory job refused')
      job = await saveJob(stateRoot, { ...job, pendingIntegration: workerCommit, expectedParent: main })
      return publishClean(workerCommit, main)
    }
    const createdCommit = await gitCommitTree(git, cleaned, [main, workerCommit], commitMessage(job.summary))
    job = await saveJob(stateRoot, { ...job, pendingIntegration: createdCommit, expectedParent: main })
    return publishClean(createdCommit, main)
  }

  const integrate = async (id: string): Promise<LocalJobRecord> => {
    const policy = await loadForgetting(stateRoot)
    if (forgettingGuard(policy).active) return integrateActive(id, policy)
    const current = await readJob(id)
    if (current.status === 'integrated' || current.status === 'noop' || current.status === 'failed')
      return current
    if (current.status === 'repair-needed') return current
    if (current.status !== 'committed' || !current.workerCommit)
      throw Error('Local memory job is not committed')
    const workerCommit = current.workerCommit
    let job = current
    const main = await gitMain(git)
    if (job.pendingIntegration && job.expectedParent)
      return publish(job, job.pendingIntegration, job.expectedParent, workerCommit)
    if (main === workerCommit || (await gitIsAncestor(git, workerCommit, main)))
      return markIntegrated(job, main === workerCommit ? workerCommit : main)
    if (main === job.baseHead) {
      const parents = await gitCommitParents(git, workerCommit)
      if (parents.length !== 1 || parents[0] !== job.baseHead) throw Error('Local memory job refused')
      job = await saveJob(stateRoot, { ...job, pendingIntegration: workerCommit, expectedParent: main })
      return publish(job, workerCommit, main, workerCommit)
    }
    const merged = await gitMergeTree(git, main, workerCommit)
    if (merged.conflicts.length)
      return saveJob(stateRoot, {
        ...job,
        status: 'repair-needed',
        conflictPaths: merged.conflicts,
        pendingIntegration: null,
        expectedParent: null,
      })
    const created = await gitCommitTree(git, merged.tree, [main, workerCommit], commitMessage(job.summary))
    job = await saveJob(stateRoot, { ...job, pendingIntegration: created, expectedParent: main })
    return publish(job, created, main, workerCommit)
  }

  const start = async (id: string): Promise<LocalJobRecord> => {
    const existing = await readJob(id)
    if (existing.status !== 'queued') throw Error('Local memory job is not queued')
    await inFlight(id)
    const baseHead = await gitMain(git)
    let job = await saveJob(stateRoot, { ...existing, status: 'running', baseHead })
    if (options.injection?.stopAfter === 'running') return job
    try {
      const owned = await createOwnedWorktree(
        git,
        stateRoot,
        bare,
        id,
        baseHead,
        meta.nonce,
        options.injection?.stopAfter,
      )
      if (owned.stopped) return job
      job = await saveJob(stateRoot, { ...job, worktreePath: owned.path })
      await deleteProgress(stateRoot, id)
      if (options.injection?.stopAfter === 'worktree-path') return job
      const policy = await loadForgetting(stateRoot)
      const guard = forgettingGuard(policy)
      if (guard.active) {
        for (const entry of await gitEntriesRecursive(git, baseHead)) {
          if (isProtectedMemoryPath(entry.path)) {
            if (!guard.oidForbidden(entry.oid)) continue
            const fallback = await protectedFallbackOid(policy, entry.path, guard)
            if (!fallback) throw Error('Local memory forgetting refused')
            const loaded = await gitBlobPrefix(git, fallback, localMemoryLimits.maxFileBytes)
            if (loaded.bytes.length !== loaded.total) throw Error('Local memory forgetting refused')
            let text: string
            try {
              text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(loaded.bytes)
            } catch {
              throw Error('Local memory forgetting refused')
            }
            if (localGitBlobId(text) !== fallback) throw Error('Local memory forgetting refused')
            writeNoFollow(owned.path, entry.path, text)
            continue
          }
          if (!suppressForgotten(entry.path, entry.oid, guard)) continue
          removeHiddenMemoryFile(owned.path, entry.path)
        }
      }
      const written: string[] = []
      if (job.kind === 'reflection') {
        const maintenance = trajectoryRuntime?.maintenance
        if (!job.reflection || !maintenance) throw Error('Local memory trajectory refused')
        const reserve = (paths: readonly string[]) => {
          const next = new Set(written)
          for (const path of paths) {
            assertRelativePath(path)
            next.add(path)
          }
          if (next.size > localMemoryLimits.maxPaths) throw Error('Local memory path bound refused')
        }
        const remember = (paths: readonly string[]) => {
          for (const path of paths) if (!written.includes(path)) written.push(path)
        }
        await maintenance({
          jobId: id,
          trajectory: trajectoryView(job.reflection),
          workspace: createMaintenanceWorkspace(owned.path, { reserve, remember }, guard),
        })
      } else {
        await options.worker({
          jobId: id,
          worktreeRoot: owned.path,
          write(relativePath, text) {
            assertRelativePath(relativePath)
            if (
              typeof text !== 'string' ||
              text.includes('\0') ||
              Buffer.byteLength(text) > localMemoryLimits.maxFileBytes
            )
              throw Error('Local memory content refused')
            if (written.length >= localMemoryLimits.maxPaths && !written.includes(relativePath))
              throw Error('Local memory path bound refused')
            if (guard.pathForbidden(relativePath) || guard.textForbidden(text))
              throw Error('Local memory forgetting refused')
            writeNoFollow(owned.path, relativePath, text)
            if (!written.includes(relativePath)) written.push(relativePath)
          },
        })
      }
      const finishNoop = async () => {
        const saved = await saveJob(stateRoot, { ...job, status: 'noop' })
        await settleReflection(stateRoot, saved)
        return saved
      }
      if (!written.length) return finishNoop()
      await gitAddAll(git, owned.gitDir, owned.path)
      if (guard.active) {
        const staged = await gitWorktreeIndex(git, owned.gitDir, owned.path)
        let violated = false
        for (const entry of staged) {
          const protectedBytes = isProtectedMemoryPath(entry.path) && guard.oidForbidden(entry.oid)
          const hidden = suppressForgotten(entry.path, entry.oid, guard)
          if (!protectedBytes && !hidden) continue
          if (written.includes(entry.path) || protectedBytes) violated = true
          if (!isProtectedMemoryPath(entry.path)) {
            await gitWorktreeUnstage(git, owned.gitDir, owned.path, entry.path)
            removeHiddenMemoryFile(owned.path, entry.path)
          }
        }
        if (violated) throw Error('Local memory forgetting refused')
        const latest = await loadForgetting(stateRoot)
        if (latest.policyRevision !== policy.policyRevision || latest.digest !== policy.digest)
          throw Error('Local memory forgetting stale')
      }
      if (await gitIndexClean(git, owned.gitDir, owned.path)) return finishNoop()
      await gitCommit(git, owned.gitDir, owned.path, commitMessage(job.summary))
      if (options.injection?.stopAfter === 'commit') return job
      return saveJob(stateRoot, {
        ...job,
        status: 'committed',
        workerCommit: await gitWorktreeHead(git, owned.gitDir, owned.path),
      })
    } catch (error) {
      await saveJob(stateRoot, { ...job, status: 'failed' })
      throw error
    }
  }

  const enqueue = async (input: {
    id: string
    summary: string
    reflection?: TrajectoryProjection | null
  }) => {
    assertJobId(input.id)
    assertSummary(input.summary)
    const jobs = await listJobs(stateRoot)
    if (jobs.some((job) => job.id === input.id)) throw Error('Local memory job exists')
    if (jobs.length >= localMemoryLimits.maxJobs) throw Error('Local memory job bound refused')
    const reflection = input.reflection ?? null
    const disk = parseMeta(JSON.parse((await readRegularFile(metaPath)).text), bare)
    const record: LocalJobRecord = {
      version: 1,
      id: input.id,
      kind: reflection ? 'reflection' : 'ordinary',
      status: 'queued',
      summary: input.summary,
      baseHead: await gitMain(git),
      workerCommit: null,
      integratedCommit: null,
      pendingIntegration: null,
      expectedParent: null,
      worktreePath: null,
      conflictPaths: [],
      sequence: disk.nextSequence,
      reflection,
    }
    disk.nextSequence += 1
    await writeJson(metaPath, disk)
    meta = disk
    return saveJob(stateRoot, record)
  }

  const resume = async (id: string) => {
    const current = await readJob(id)
    if (current.status === 'queued') {
      const started = await start(id)
      if (started.status !== 'committed') return started
      return integrate(id)
    }
    if (current.status === 'committed') return integrate(id)
    return current
  }

  const reflect = (request: SyntheticTrajectoryRequest) => {
    if (!trajectoryRuntime) throw Error('Local memory trajectory refused')
    return performReflection({
      stateRoot,
      runtime: trajectoryRuntime,
      request,
      allocateId: async () => {
        const disk = parseMeta(JSON.parse((await readRegularFile(metaPath)).text), bare)
        const id = `reflect-${disk.nextSequence}`
        assertJobId(id)
        return id
      },
      listJobs: () => listJobs(stateRoot),
      enqueue,
    })
  }

  const retry = async (id: string) => {
    const current = await readJob(id)
    if (current.kind !== 'reflection' || !current.reflection) throw Error('Local memory trajectory refused')
    if (current.status === 'repair-needed') throw Error('Local memory reflection repair blocked')
    if (current.status !== 'failed') throw Error('Local memory trajectory refused')
    if (current.worktreePath)
      await cleanupOwnedWorktree(git, stateRoot, bare, meta.nonce, current.worktreePath, false, false, true)
    return saveJob(stateRoot, {
      ...current,
      status: 'queued',
      worktreePath: null,
      workerCommit: null,
      integratedCommit: null,
      pendingIntegration: null,
      expectedParent: null,
      conflictPaths: [],
    })
  }

  const importTombstones = async (input: TombstoneImport): Promise<ForgettingMetadata> => {
    const parsed = parseTombstoneImport(input)
    const current = await loadForgetting(stateRoot)
    const decision = prepareForgettingImport(current, parsed)
    if (decision.kind === 'same') return forgettingMetadata(current, false)
    const main = await gitMain(git)
    for (const entry of await gitEntriesRecursive(git, main)) {
      if (isProtectedMemoryPath(entry.path) && parsed.snapshot.blobs.includes(entry.oid))
        throw Error('Local memory forgetting refused')
    }
    const guard = forgettingGuard(decision.record)
    const cleaned = await stripTree(main, guard, main)
    const removal =
      cleaned === (await gitTree(git, main))
        ? null
        : await gitCommitTree(git, cleaned, [main], 'Forget local memory (history retained)')
    const removing = forgettingRemovalRecord(decision.record, main, removal)
    await saveForgetting(stateRoot, removing, current.digest)
    if (options.injection?.stopAfter === 'forgetting-recorded')
      throw Error('Local memory forgetting interrupted')
    if (removal) {
      await gitUpdateMain(git, removal, main)
      const saved = await loadForgetting(stateRoot)
      if (saved.digest !== removing.digest) throw Error('Local memory forgetting stale')
      await saveForgetting(stateRoot, forgettingRemovedRecord(saved), saved.digest)
    }
    return forgettingMetadata(await loadForgetting(stateRoot), removal !== null)
  }

  const safeReadMessages = new Set([
    'Local memory path refused',
    'Local memory project refused',
    'Local memory projection refused',
    'Local memory read refused',
    'Local memory repository refused',
    'Local memory identity refused',
    'Local memory state refused',
    'Local memory record refused',
    'Local memory forgetting refused',
    'Local memory forgetting stale',
    'Local memory forgetting conflict',
    'Local Git object refused',
    'Local Git timed out',
    'Local Git output exceeded',
    'Local Git diagnostics exceeded',
  ])

  const refuseRead = (error: unknown): never => {
    const message = error instanceof Error ? error.message : ''
    if (safeReadMessages.has(message)) throw error instanceof Error ? error : Error(message)
    if (message.startsWith('Local Git failed')) throw Error('Local Git object refused')
    throw Error('Local memory read refused')
  }

  const certifyIdentity = async (): Promise<void> => {
    try {
      const stat = await lstat(bare)
      if (stat.isSymbolicLink() || !stat.isDirectory() || (await realpath(bare)) !== bare)
        throw Error('Local memory repository refused')
      const identity = await readRegularFile(join(stateRoot, 'git-identity'))
      if (identity.text !== localGitIdentity) throw Error('Local memory identity refused')
      let parsed: unknown
      try {
        parsed = JSON.parse((await readRegularFile(metaPath)).text)
      } catch (error) {
        if (error instanceof Error && error.message === 'Local memory record refused') throw error
        throw Error('Local memory state refused')
      }
      const disk = parseMeta(parsed, bare)
      if (disk.nonce !== meta.nonce || disk.repository !== bare)
        throw Error('Local memory repository refused')
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'Local memory repository refused' ||
          error.message === 'Local memory identity refused' ||
          error.message === 'Local memory state refused' ||
          error.message === 'Local memory record refused')
      )
        throw error
      throw Error('Local memory repository refused')
    }
  }

  const readSnapshot = async <T>(read: (commit: string) => Promise<T>): Promise<T> => {
    await certifyIdentity()
    const commit = await gitMain(git).catch((error: unknown) => refuseRead(error))
    await gitRequireCommit(git, commit).catch((error: unknown) => refuseRead(error))
    if (options.injection?.afterCommitResolved) await options.injection.afterCommitResolved(commit)
    const value = await read(commit).catch((error: unknown) => refuseRead(error))
    await certifyIdentity()
    return value
  }

  const publicSnapshot = <T>(body: () => Promise<T>): Promise<T> =>
    turnOnce(body).catch((error: unknown) => refuseRead(error))

  const sourceForbidden = (policy: ForgettingRecord, path: string) =>
    policy.snapshot?.sources.some((source) => source.source === path || source.project === path) ?? false

  const listVisibleCorpus = async (head: string) => {
    const policy = await loadForgetting(stateRoot)
    const guard = forgettingGuard(policy)
    const listed = await gitEntriesRecursive(git, head)
    const visible: { fact: PalaceCorpusFact; bytesOf: string | null }[] = []
    let forgotten = 0
    const seen = new Set<string>()
    for (const entry of listed) {
      if (seen.has(entry.path)) throw Error('Local memory palace refused')
      seen.add(entry.path)
      if (suppressForgotten(entry.path, entry.oid, guard) || sourceForbidden(policy, entry.path)) {
        forgotten += 1
        continue
      }
      visible.push({
        fact: { path: entry.path, mode: entry.mode, type: entry.type, bytes: null },
        bytesOf: entry.mode === '100644' && entry.type === 'blob' ? entry.oid : null,
      })
    }
    visible.sort((left, right) =>
      left.fact.path < right.fact.path ? -1 : left.fact.path > right.fact.path ? 1 : 0,
    )
    return { policy, guard, visible, forgotten }
  }

  const palacePreview = async (): Promise<PalaceSnapshot> => {
    try {
      await certifyIdentity()
    } catch {
      throw Error('Local memory palace stale')
    }
    let snapshot: PalaceSnapshot
    try {
      const head = await gitMain(git)
      await gitRequireCommit(git, head)
      const listed = await listVisibleCorpus(head)
      for (const item of listed.visible.slice(0, palacePreviewLimits.pageSize)) {
        if (item.bytesOf) item.fact.bytes = await gitBlobSize(git, item.bytesOf)
      }
      const { policy, guard, forgotten } = listed
      const conflictVisible = async (path: string, commits: readonly string[]) => {
        if (guard.pathForbidden(path) || sourceForbidden(policy, path)) return false
        if (guard.metadata.blobCount === 0) return true
        let proved = false
        for (const commit of commits) {
          try {
            const entry = await gitEntryAt(git, commit, path)
            if (!entry) continue
            if (entry.type !== 'blob' || guard.oidForbidden(entry.oid)) return false
            proved = true
          } catch {
            return false
          }
        }
        return proved
      }
      const jobs: PalaceJobFact[] = []
      let hiddenConflicts = 0
      for (const job of await listJobs(stateRoot)) {
        const commits = [head]
        if (job.workerCommit) commits.push(job.workerCommit)
        const paths: string[] = []
        for (const path of job.conflictPaths) {
          if (await conflictVisible(path, commits)) paths.push(path)
          else hiddenConflicts += 1
        }
        let runningTree = false
        if (job.status === 'running' && job.worktreePath) {
          try {
            const stat = await lstat(job.worktreePath)
            runningTree = !stat.isSymbolicLink() && stat.isDirectory()
          } catch {
            runningTree = false
          }
        }
        jobs.push({
          id: job.id,
          kind: job.kind,
          status: job.status,
          sequence: job.sequence,
          baseHead: job.baseHead,
          workerCommit: job.workerCommit,
          integratedCommit: job.integratedCommit,
          pendingIntegration: job.pendingIntegration,
          expectedParent: job.expectedParent,
          conflictPaths: paths,
          detached: runningTree,
        })
      }
      snapshot = buildPalaceSnapshot({
        head,
        forgotten,
        forgetting: {
          phase: guard.metadata.phase,
          policyRevision: guard.metadata.policyRevision,
          pathCount: guard.metadata.pathCount,
          blobCount: guard.metadata.blobCount,
          sourceCount: guard.metadata.sourceCount,
        },
        corpus: listed.visible.map((item) => item.fact),
        jobs,
        recovery: recoveryNotes,
        hiddenConflicts,
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'Local memory palace refused') throw error
      throw Error('Local memory palace refused')
    }
    try {
      await certifyIdentity()
    } catch {
      throw Error('Local memory palace stale')
    }
    return snapshot
  }

  const palaceCorpusPage = async (request: PalaceCorpusRequest): Promise<PalaceCorpusPage> => {
    assertOid(request.commit)
    if (
      !Number.isInteger(request.offset) ||
      request.offset < 0 ||
      request.offset > palaceCorpusLimits.maxOffset
    )
      throw Error('Local memory palace refused')
    try {
      await certifyIdentity()
    } catch {
      throw Error('Local memory palace stale')
    }
    let page: PalaceCorpusPage
    try {
      const head = await gitMain(git)
      await gitRequireCommit(git, head)
      if (head !== request.commit) throw Error('Local memory palace stale')
      const listed = await listVisibleCorpus(head)
      if (request.offset > 0 && request.offset >= listed.visible.length)
        throw Error('Local memory palace refused')
      const slice = listed.visible.slice(request.offset, request.offset + palaceCorpusLimits.pageSize)
      for (const item of slice) {
        if (item.bytesOf) item.fact.bytes = await gitBlobSize(git, item.bytesOf)
      }
      page = buildPalaceCorpusPage({
        commit: head,
        offset: request.offset,
        total: listed.visible.length,
        entries: slice.map((item) => ({
          path: item.fact.path,
          kind: palaceEntryKind(item.fact.mode, item.fact.type),
          bytes: item.fact.bytes,
        })),
      })
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'Local memory palace refused' || error.message === 'Local memory palace stale')
      )
        throw error
      throw Error('Local memory palace refused')
    }
    try {
      await certifyIdentity()
    } catch {
      throw Error('Local memory palace stale')
    }
    return page
  }

  const palaceDocument = async (request: PalaceDocumentRequest): Promise<PalaceDocument> => {
    assertOid(request.commit)
    assertPalacePath(request.path)
    try {
      await certifyIdentity()
    } catch {
      throw Error('Local memory palace stale')
    }
    let document: PalaceDocument
    try {
      const resolved = await gitMain(git)
      await gitRequireCommit(git, resolved)
      if (resolved !== request.commit) throw Error('Local memory palace stale')
      const listed = await listVisibleCorpus(resolved)
      const entry = listed.visible.find((item) => item.fact.path === request.path)
      if (!entry || entry.fact.mode !== '100644' || entry.fact.type !== 'blob' || entry.bytesOf === null)
        throw Error('Local memory palace refused')
      const loaded = await gitBlobPrefix(git, entry.bytesOf, palaceDocumentLimits.maxTextBytes)
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          clipPalaceUtf8(loaded.bytes, palaceDocumentLimits.maxTextBytes),
        )
      } catch {
        throw Error('Local memory palace refused')
      }
      document = buildPalaceDocument({
        commit: resolved,
        path: request.path,
        totalBytes: loaded.total,
        text,
      })
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'Local memory palace refused' || error.message === 'Local memory palace stale')
      )
        throw error
      throw Error('Local memory palace refused')
    }
    try {
      await certifyIdentity()
    } catch {
      throw Error('Local memory palace stale')
    }
    return document
  }

  await turn(stateRoot, () => readyPolicy())

  return {
    enqueue: (input) => turnOnce(() => enqueue(input)),
    start: (id) => turnOnce(() => start(id)),
    integrate: (id) => turnOnce(() => integrate(id)),
    resume: (id) => turnOnce(() => resume(id)),
    readCommitted: (relativePath) => {
      assertRelativePath(relativePath)
      return turnOnce(async () => {
        const guard = forgettingGuard(await loadForgetting(stateRoot))
        if (guard.active) {
          const main = await gitMain(git)
          const entry = await gitEntryAt(git, main, relativePath)
          if (!entry || suppressForgotten(relativePath, entry.oid, guard))
            throw Error('Local memory path refused')
        }
        return gitShow(git, relativePath)
      })
    },
    job: (id) => turnOnce(() => readJob(id)),
    head: () => turnOnce(() => gitMain(git)),
    cleanup: (path) =>
      turnOnce(async () => {
        const fail = failRemoves > 0
        if (fail) failRemoves -= 1
        await cleanupOwnedWorktree(
          git,
          stateRoot,
          bare,
          meta.nonce,
          path,
          fail,
          options.injection?.stopAfter === 'worktree-removed',
        )
      }),
    reflect: (request) => turnOnce(() => reflect(request)),
    retry: (id) => turnOnce(() => retry(id)),
    watermark: (identity) => {
      if (!trajectoryRuntime) throw Error('Local memory trajectory refused')
      return turnOnce(() => readWatermarkView(stateRoot, identity))
    },
    compilePrompt: (input) =>
      publicSnapshot(() =>
        readSnapshot(async (commit) =>
          compileLocalMemoryPrompt(
            git,
            commit,
            input?.project,
            forgettingGuard(await loadForgetting(stateRoot)),
          ),
        ),
      ),
    readMemory: (input) =>
      publicSnapshot(() =>
        readSnapshot(async (commit) =>
          readLocalMemory(git, commit, input, forgettingGuard(await loadForgetting(stateRoot))),
        ),
      ),
    listMemory: (input) =>
      publicSnapshot(() =>
        readSnapshot(async (commit) =>
          listLocalMemory(git, commit, input, forgettingGuard(await loadForgetting(stateRoot))),
        ),
      ),
    importTombstones: (input) => turnOnce(() => importTombstones(input)),
    palacePreview: () => turnOnce(() => palacePreview()),
    palaceCorpusPage: (request) => turnOnce(() => palaceCorpusPage(request)),
    palaceDocument: (request) => turnOnce(() => palaceDocument(request)),
  }
}
