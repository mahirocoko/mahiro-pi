import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { type Check, privateDirectory, readPrivate } from './io.ts'

export const episodeMutex = '.episodes/.admission'
export const episodeRecovery = '.episodes/.admission-recovery'
export const inode = (s: { dev: number; ino: number }) => `${s.dev}:${s.ino}`
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
export async function episodePresent(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (!absent(error)) throw error
    return false
  }
}
// Keep a kernel-visible directory holder BEFORE mkdir and until all work has unwound.
// Even an anonymous mkdir/owner-recording seam is visible to the existing offline lsof
// check. A failed/returned operation closes this handle; no detached work may use it.
export async function withEpisodeDirectory<T>(
  root: string,
  check: Check,
  create: boolean,
  body: () => Promise<T>,
) {
  const folder = join(root, '.episodes')
  await check({ physical: [folder], logical: [], kind: 'view' })
  await privateDirectory(folder, create)
  await check({ physical: [folder], logical: [], kind: 'view' })
  const held = await open(folder, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    await check({ physical: [folder], logical: [], kind: 'view' })
    if (inode(await held.stat()) !== inode(await lstat(folder)))
      throw Error('Episode directory identity changed')
    if (create) {
      // Persist the provisioned .episodes entry before any lock or acknowledged work.
      // Also sync on retry: an existing directory may be residue from a failed sync.
      await check({ physical: [root], logical: [], kind: 'view' })
      const parent = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        await check({ physical: [root], logical: [], kind: 'view' })
        await parent.sync()
      } finally {
        await parent.close()
      }
    }
    return await body()
  } finally {
    await held.close()
  }
}
export async function withEpisodeAdmission<T>(root: string, check: Check, body: () => Promise<T>) {
  return await withEpisodeDirectory(root, check, true, () => admissionHeld(root, check, body))
}
async function admissionHeld<T>(root: string, check: Check, body: () => Promise<T>) {
  const folder = join(root, '.episodes')
  const lock = join(root, episodeMutex)
  const recovery = join(root, episodeRecovery)
  const owner = join(lock, 'owner.json')
  const gate = (physical: string[]) => check({ physical, logical: [], kind: 'view' })
  const sync = async (path: string) => {
    await gate([path])
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      await gate([path])
      await fd.sync()
    } finally {
      await fd.close()
    }
  }
  let acquired = false
  // Bounded cooperative contention, never PID/age stealing (including anonymous locks).
  for (let attempt = 0; attempt < 80; attempt++) {
    await gate([lock, recovery])
    if (await episodePresent(recovery)) throw Error('Episode admission offline recovery pending')
    try {
      await mkdir(lock, { mode: 0o700 })
      acquired = true
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (attempt < 79) await delay(25)
  }
  if (!acquired) throw Error('Episode admission busy; explicit offline recovery may be required')
  // Every failure from mkdir through owner durability retains the lock for explicit review.
  await gate([lock])
  await privateDirectory(lock)
  const directory = inode(await lstat(lock))
  const raw = `${JSON.stringify({ version: 1, directory, token: randomUUID() })}\n`
  await gate([owner])
  const fd = await open(
    owner,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await gate([owner])
    await fd.writeFile(raw)
    await gate([owner])
    await fd.sync()
  } finally {
    await fd.close()
  }
  await sync(lock)
  await sync(folder)
  let failed = false
  try {
    await gate([lock, recovery])
    if (await episodePresent(recovery)) throw Error('Episode admission offline recovery pending')
    return await body()
  } catch (error) {
    failed = true
    throw error
  } finally {
    try {
      await gate([lock, owner, recovery])
      if (await episodePresent(recovery)) throw Error('Episode admission offline recovery pending')
      await privateDirectory(lock)
      if (
        inode(await lstat(lock)) !== directory ||
        (await readPrivate(owner, 2048)).toString() !== raw ||
        (await readdir(lock)).join() !== 'owner.json'
      )
        throw Error('Episode admission ownership changed')
      await gate([owner])
      await unlink(owner)
      await sync(lock)
      await gate([lock])
      if (inode(await lstat(lock)) !== directory) throw Error('Episode admission ownership changed')
      await rmdir(lock)
      await sync(folder)
    } catch (error) {
      // Revocation/uncertain release preserves evidence and never masks the original error.
      if (!failed) throw error
    }
  }
}
