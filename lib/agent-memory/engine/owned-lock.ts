import { constants } from 'node:fs'
import { lstat, mkdir, open, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { assertCurrent, type OperationContext } from './controller.ts'
import { readPrivate, safePath } from './io.ts'
import { parseLockOwner, type LockOwner } from './operation.ts'

const identity = (s: Awaited<ReturnType<typeof lstat>>) => `${s.dev}:${s.ino}`
async function syncLockParent(root: string, context: OperationContext) {
  const current = () => assertCurrent(context, { physical: [root], logical: [], kind: 'data' })
  current()
  const parent = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    current()
    await parent.sync()
  } finally {
    await parent.close()
  }
}
export async function acquireOperationLock(
  root: string,
  operation: string,
  digest: string,
  nonce: string,
  context: OperationContext,
) {
  const lock = join(root, '.lock')
  const file = join(lock, 'owner.json')
  const current = () => assertCurrent(context, { physical: [root, lock, file], logical: [], kind: 'data' })
  await safePath(lock)
  current()
  await mkdir(lock, { mode: 0o700 })
  // Any interruption from here leaves a non-stealable lock, even if owner recording fails.
  await syncLockParent(root, context) // durable parent entry before recording ownership
  const stat = await lstat(lock)
  const owner: LockOwner = { version: 1, operation, digest, nonce, directory: identity(stat) }
  parseLockOwner(owner)
  current()
  const fd = await open(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    current()
    await fd.writeFile(`${JSON.stringify(owner)}\n`)
    current()
    await fd.sync()
  } finally {
    await fd.close()
  }
  current()
  const directory = await open(lock, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    current()
    await directory.sync()
  } finally {
    await directory.close()
  }
  return owner
}
export async function releaseOperationLock(
  root: string,
  expected: LockOwner,
  context: OperationContext,
): Promise<boolean> {
  const owner = parseLockOwner(expected)
  const lock = join(root, '.lock')
  const file = join(lock, 'owner.json')
  const current = () => assertCurrent(context, { physical: [lock, file], logical: [], kind: 'data' })
  current()
  await safePath(lock)
  const actual = parseLockOwner(JSON.parse((await readPrivate(file, 2048)).toString('utf8')))
  const stat = await lstat(lock)
  if (
    !stat.isDirectory() ||
    stat.mode & 0o077 ||
    identity(stat) !== owner.directory ||
    !isDeepStrictEqual(actual, owner)
  )
    throw Error('Exact operation lock ownership changed')
  current() // nonce + inode rechecked immediately before fixed native unlink, no intervening await
  await unlink(file)
  const after = await lstat(lock)
  if (!after.isDirectory() || identity(after) !== owner.directory) throw Error('Operation lock replaced')
  current()
  await rmdir(lock)
  await syncLockParent(root, context) // durable removal, never a new owner's lock cleanup
  return true
}
