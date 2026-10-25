// Fixed usage data only. Synchronous bounded publication, never read-time repair.
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveAgentDir } from './setup.ts'
import { assertSafeContainer } from './feature-data.ts'
import { assertPrivatePath } from './continuity/store.ts'
import {
  decodeUsageState,
  nextUsageState,
  USAGE_STATE_BYTE_LIMIT,
  type UsageRevision,
  type UsagePreferences,
} from './usage-preferences.ts'

export class UsageStorageError extends Error {
  readonly code: 'unavailable' | 'stale' | 'durability-unknown'
  constructor(code: 'unavailable' | 'stale' | 'durability-unknown') {
    super(
      code === 'durability-unknown'
        ? 'Usage state written, but durability is unknown. Read the preference again before another explicit save.'
        : code === 'stale'
          ? 'Usage stored revision changed. Read the preference again before another explicit save.'
          : 'Usage storage unavailable; preferences not saved.',
    )
    this.code = code
  }
}
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const same = (a: Stats, b: Stats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.uid === b.uid &&
  a.nlink === b.nlink &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs
const ownedFile = (s: Stats) => {
  if (
    !s.isFile() ||
    s.nlink !== 1 ||
    (s.mode & 0o7777) !== 0o600 ||
    (process.getuid && s.uid !== process.getuid())
  )
    throw new UsageStorageError('unavailable')
}
function directory(path: string, optional = false) {
  assertSafeContainer(path)
  try {
    const s = lstatSync(path)
    if (
      !s.isDirectory() ||
      (s.mode & 0o7777) !== 0o700 ||
      (process.getuid && s.uid !== process.getuid()) ||
      realpathSync(path) !== path
    )
      throw new UsageStorageError('unavailable')
    return s
  } catch (error) {
    if (optional && absent(error)) return null
    throw error
  }
}
export interface UsageBinding {
  readonly profile: string
  readonly root: string
}
export function usageBinding(): UsageBinding {
  const profile = resolveAgentDir()
  assertSafeContainer(profile)
  if (realpathSync(profile) !== profile) throw new UsageStorageError('unavailable')
  const root = join(profile, 'preferences/usage')
  assertPrivatePath(root)
  for (const other of [
    process.env.MAHIRO_AGENT_MEMORY_ROOT ?? join(profile, 'memory'),
    process.env.MAHIRO_CONTINUITY_ROOT ?? join(profile, 'continuity'),
  ]) {
    if (other === root || root.startsWith(`${other}/`) || other.startsWith(`${root}/`))
      throw new UsageStorageError('unavailable')
  }
  for (const path of [join(profile, 'preferences'), root]) directory(path, true)
  return Object.freeze({ profile, root })
}
function assertBinding(binding: UsageBinding) {
  const actual = usageBinding()
  if (actual.profile !== binding.profile || actual.root !== binding.root)
    throw new UsageStorageError('unavailable')
}
function readBytes(binding: UsageBinding): Buffer | null {
  assertBinding(binding)
  const path = join(binding.root, 'state.json')
  let before: Stats
  try {
    before = lstatSync(path)
  } catch (error) {
    if (absent(error)) return null
    throw error
  }
  ownedFile(before)
  if (before.size > USAGE_STATE_BYTE_LIMIT) throw new UsageStorageError('unavailable')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const opened = fstatSync(fd)
    ownedFile(opened)
    if (!same(before, opened)) throw new UsageStorageError('unavailable')
    const bytes = Buffer.alloc(USAGE_STATE_BYTE_LIMIT + 1)
    let size = 0
    while (size < bytes.length) {
      const n = readSync(fd, bytes, size, bytes.length - size, size)
      if (!n) break
      size += n
    }
    if (
      size !== before.size ||
      size > USAGE_STATE_BYTE_LIMIT ||
      !same(opened, fstatSync(fd)) ||
      !same(opened, lstatSync(path))
    )
      throw new UsageStorageError('unavailable')
    return bytes.subarray(0, size)
  } finally {
    closeSync(fd)
  }
}
const safe = <T>(work: () => T): T => {
  try {
    return work()
  } catch (error) {
    if (error instanceof UsageStorageError) throw error
    throw new UsageStorageError('unavailable')
  }
}
export function readUsageState(binding: UsageBinding): UsageRevision {
  return safe(() => decodeUsageState(readBytes(binding)))
}
function syncDirectory(path: string) {
  const before = lstatSync(path)
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = fstatSync(fd)
    if (!opened.isDirectory() || opened.dev !== before.dev || opened.ino !== before.ino)
      throw new UsageStorageError('unavailable')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
// No callbacks supplied by UI: this owner-private callback rechecks live Root authority.
export function publishUsageState(
  binding: UsageBinding,
  ticket: string,
  preferences: UsagePreferences,
  assertCurrent: (paths?: readonly string[]) => void,
): UsageRevision {
  return safe(() => {
    assertCurrent()
    assertBinding(binding)
    const revision = readUsageState(binding)
    if (revision.ticket !== ticket) throw new UsageStorageError('stale')
    const state = nextUsageState(revision, preferences)
    const bytes = Buffer.from(`${JSON.stringify(state)}\n`)
    if (bytes.length > USAGE_STATE_BYTE_LIMIT) throw new UsageStorageError('unavailable')
    const nextRevision = decodeUsageState(bytes)
    const lock = join(binding.root, 'state.lock')
    const file = join(binding.root, 'state.json')
    const temp = join(binding.root, `.state-${randomUUID()}.tmp`)
    assertCurrent([temp]) // Authorize the actual temp path before any directory creation.
    for (const path of [join(binding.profile, 'preferences'), binding.root]) {
      if (!directory(path, true)) {
        mkdirSync(path, { mode: 0o700 })
        directory(path)
      }
      // A prior failed Save may have left an existing but undurable entry.
      // Save must persist each private directory and its parent even on retry.
      syncDirectory(path)
      syncDirectory(dirname(path))
    }
    const containers = [binding.profile, join(binding.profile, 'preferences'), binding.root].map((path) => ({
      path,
      stat: lstatSync(path),
    }))
    const fd = openSync(
      lock,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    const lockStat = fstatSync(fd)
    let tempFd: number | undefined
    let tempStat: Stats | undefined
    let published = false
    let failure: unknown
    try {
      ownedFile(lockStat)
      writeFileSync(fd, randomUUID())
      fsyncSync(fd)
      const heldLock = fstatSync(fd)
      ownedFile(heldLock)
      if (!same(heldLock, lstatSync(lock))) throw new UsageStorageError('unavailable')
      if (readUsageState(binding).ticket !== ticket) throw new UsageStorageError('stale')
      tempFd = openSync(
        temp,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
      tempStat = fstatSync(tempFd)
      ownedFile(tempStat)
      writeFileSync(tempFd, bytes)
      fsyncSync(tempFd)
      tempStat = fstatSync(tempFd)
      ownedFile(tempStat)
      const checked = Buffer.alloc(bytes.length + 1)
      if (
        readSync(tempFd, checked, 0, checked.length, 0) !== bytes.length ||
        !checked.subarray(0, bytes.length).equals(bytes) ||
        !same(tempStat, lstatSync(temp)) ||
        !same(tempStat, fstatSync(tempFd)) ||
        !same(heldLock, lstatSync(lock))
      )
        throw new UsageStorageError('unavailable')
      assertBinding(binding)
      assertCurrent([temp])
      for (const { path, stat } of containers) {
        const actual = lstatSync(path)
        if (
          actual.dev !== stat.dev ||
          actual.ino !== stat.ino ||
          actual.mode !== stat.mode ||
          actual.uid !== stat.uid
        )
          throw new UsageStorageError('unavailable')
      }
      if (readUsageState(binding).ticket !== ticket) throw new UsageStorageError('stale')
      renameSync(temp, file)
      published = true
      syncDirectory(binding.root)
    } catch (error) {
      failure = error
    } finally {
      // Never unlink a replaced lock/temp. No stale lock steal or broad cleanup.
      try {
        if (tempFd !== undefined) closeSync(tempFd)
        if (!published && tempStat) {
          const actual = lstatSync(temp)
          ownedFile(actual)
          if (actual.dev !== tempStat.dev || actual.ino !== tempStat.ino)
            throw new UsageStorageError('unavailable')
          unlinkSync(temp)
        }
      } catch (error) {
        if (!absent(error)) failure ??= error
      }
      try {
        closeSync(fd)
        const actual = lstatSync(lock)
        if (actual.dev !== lockStat.dev || actual.ino !== lockStat.ino || actual.nlink !== 1)
          throw new UsageStorageError('unavailable')
        unlinkSync(lock)
        syncDirectory(binding.root)
      } catch (error) {
        failure ??= error
      }
    }
    if (failure) {
      if (published) throw new UsageStorageError('durability-unknown')
      throw failure
    }
    return nextRevision
  })
}
