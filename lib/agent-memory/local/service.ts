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
  gitUpdateMain,
  gitWorktreeDirty,
  gitWorktreeHead,
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
import { createMaintenanceWorkspace } from './workspace.ts'
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
): Promise<{ meta: LocalServiceMeta; git: LocalGitContext; bare: string }> {
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
    return { meta, git, bare }
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
  return { meta, git, bare }
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

function turn<T>(stateRoot: string, body: () => Promise<T>): Promise<T> {
  const previous = turns.get(stateRoot) ?? Promise.resolve()
  const run = previous.then(body, body)
  turns.set(
    stateRoot,
    run.then(
      () => {},
      () => {},
    ),
  )
  return run
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
  const { git, bare } = opened
  const metaPath = join(stateRoot, 'meta.json')
  let failRemoves = options.injection?.failCleanupRemoves ?? 0

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
    if (job.status !== 'running') return job
    if (!job.worktreePath) return saveJob(stateRoot, { ...job, status: 'failed' })
    const ownership = (await listOwnership(stateRoot)).find((item) => item.jobId === job.id)
    if (!ownership || ownership.path !== job.worktreePath || ownership.nonce !== meta.nonce)
      return saveJob(stateRoot, { ...job, status: 'failed' })
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
    if (!sameIdentity) return saveJob(stateRoot, { ...job, status: 'failed' })
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
        if (stopped) return job
      }
      return saveJob(stateRoot, { ...job, status: 'failed' })
    }
    return saveJob(stateRoot, { ...job, status: 'committed', workerCommit: head })
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
      await reconcile()
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

  const integrate = async (id: string): Promise<LocalJobRecord> => {
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
          workspace: createMaintenanceWorkspace(owned.path, { reserve, remember }),
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

  const safeReadMessages = new Set([
    'Local memory path refused',
    'Local memory project refused',
    'Local memory projection refused',
    'Local memory read refused',
    'Local memory repository refused',
    'Local memory identity refused',
    'Local memory state refused',
    'Local memory record refused',
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

  return {
    enqueue: (input) => turnOnce(() => enqueue(input)),
    start: (id) => turnOnce(() => start(id)),
    integrate: (id) => turnOnce(() => integrate(id)),
    resume: (id) => turnOnce(() => resume(id)),
    readCommitted: (relativePath) => {
      assertRelativePath(relativePath)
      return turnOnce(() => gitShow(git, relativePath))
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
      publicSnapshot(() => readSnapshot((commit) => compileLocalMemoryPrompt(git, commit, input?.project))),
    readMemory: (input) =>
      publicSnapshot(() => readSnapshot((commit) => readLocalMemory(git, commit, input))),
    listMemory: (input) =>
      publicSnapshot(() => readSnapshot((commit) => listLocalMemory(git, commit, input))),
  }
}
