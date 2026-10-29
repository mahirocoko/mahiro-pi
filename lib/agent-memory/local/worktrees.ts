import { lstat, realpath, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { readRegularFile } from './confine.ts'
import { type LocalOwnershipRecord, type LocalProgressRecord } from './contracts.ts'
import { type LocalGitContext, gitWorktreeAdd, gitWorktreeDirty, gitWorktreeRemove } from './git.ts'
import {
  deleteProgress,
  listOwnership,
  ownershipFile,
  parseOwnership,
  saveProgress,
  writeJson,
} from './jobs.ts'

function progress(
  jobId: string,
  phase: LocalProgressRecord['phase'],
  path: string,
  nonce: string,
  dev: string | null,
  ino: string | null,
  gitDir: string | null,
): LocalProgressRecord {
  return { version: 1, jobId, phase, path, nonce, dev, ino, gitDir }
}

export async function createOwnedWorktree(
  context: LocalGitContext,
  stateRoot: string,
  bare: string,
  jobId: string,
  baseHead: string,
  nonce: string,
  stopAfter?: string,
): Promise<{ path: string; gitDir: string; stopped: boolean }> {
  const path = join(stateRoot, 'worktrees', jobId)
  const expectedGitDir = join(bare, 'worktrees', jobId)
  await saveProgress(stateRoot, progress(jobId, 'adding', path, nonce, null, null, expectedGitDir))
  await gitWorktreeAdd(context, path, baseHead)
  if (stopAfter === 'worktree-adding') return { path, gitDir: expectedGitDir, stopped: true }
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Local memory worktree refused')
  const canonical = await realpath(path)
  if (canonical !== path) throw Error('Local memory worktree path refused')
  const gitDir = /^gitdir: (.+)$/.exec((await readRegularFile(join(canonical, '.git'))).text.trim())?.[1]
  if (gitDir !== expectedGitDir) throw Error('Local memory worktree refused')
  const dev = String(stat.dev)
  const ino = String(stat.ino)
  await saveProgress(stateRoot, progress(jobId, 'added', canonical, nonce, dev, ino, gitDir))
  if (stopAfter === 'worktree-added') return { path: canonical, gitDir, stopped: true }
  const record: LocalOwnershipRecord = {
    version: 1,
    jobId,
    path: canonical,
    dev,
    ino,
    nonce,
    repository: bare,
    gitDir,
  }
  await writeJson(ownershipFile(stateRoot, jobId), parseOwnership(record))
  await saveProgress(stateRoot, progress(jobId, 'owned', canonical, nonce, dev, ino, gitDir))
  if (stopAfter === 'ownership-written') return { path: canonical, gitDir, stopped: true }
  return { path: canonical, gitDir, stopped: false }
}

export async function cleanupOwnedWorktree(
  context: LocalGitContext,
  stateRoot: string,
  bare: string,
  nonce: string,
  path: string,
  failBeforeRemove = false,
  stopAfterRemove = false,
  discardDirty = false,
): Promise<boolean> {
  if (!isAbsolute(path)) throw Error('Unowned worktree refused')
  let stat
  try {
    stat = await lstat(path)
  } catch {
    throw Error('Unowned worktree refused')
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Unowned worktree refused')
  const canonical = await realpath(path)
  if (canonical !== resolve(path)) throw Error('Unowned worktree refused')
  const record = (await listOwnership(stateRoot)).find((item) => item.path === canonical)
  const expected = record ? join(stateRoot, 'worktrees', record.jobId) : ''
  if (
    !record ||
    record.path !== expected ||
    canonical !== expected ||
    record.repository !== bare ||
    record.nonce !== nonce
  )
    throw Error('Unowned worktree refused')
  if (record.dev !== String(stat.dev) || record.ino !== String(stat.ino))
    throw Error('Replaced worktree refused')
  if (!discardDirty && (await gitWorktreeDirty(context, record.gitDir, canonical)))
    throw Error('Local memory worktree dirty')
  await saveProgress(
    stateRoot,
    progress(record.jobId, 'removing', canonical, nonce, record.dev, record.ino, record.gitDir),
  )
  if (failBeforeRemove) throw Error('Local memory cleanup interrupted')
  await gitWorktreeRemove(context, canonical, discardDirty)
  if (stopAfterRemove) return true
  await unlink(ownershipFile(stateRoot, record.jobId))
  await deleteProgress(stateRoot, record.jobId)
  return false
}
