import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

// Public prerequisite metadata only. Never reads the maintained corpus or resolves credentials.
export function readProfileMetadata(path: string, privateFile = true): string | undefined {
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size > 16384 ||
    realpathSync(path) !== path ||
    stat.mode & 0o022 ||
    (privateFile && (stat.mode & 0o777) !== 0o600) ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw Error('Unsafe memory prerequisite metadata; review its owner and permissions')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const buffer = Buffer.alloc(16385)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null)
      if (!count) break
      length += count
    }
    const after = fstatSync(fd)
    if (
      length !== stat.size ||
      after.ino !== stat.ino ||
      after.dev !== stat.dev ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      after.mode !== stat.mode ||
      after.uid !== stat.uid ||
      after.nlink !== 1
    )
      throw Error('Memory prerequisite changed during read')
    const bytes = buffer.subarray(0, length)
    const text = bytes.toString('utf8')
    if (!Buffer.from(text).equals(bytes)) throw Error('UTF-8 memory prerequisite required')
    return text
  } finally {
    closeSync(fd)
  }
}

export interface MemoryEngineSelection {
  version: 2
  root: string
  mode: 'engine' | 'legacy' | 'off'
}
export const memorySelectionPath = (profile: string) => join(profile, '.mahiro-memory-engine.json')
export function parseMemorySelection(text: string, profile: string): MemoryEngineSelection {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw Error('Invalid memory engine selection; review explicit installation')
  }
  if (
    !value ||
    Object.keys(value).sort().join() !== 'mode,root,version' ||
    value.version !== 2 ||
    !['engine', 'legacy', 'off'].includes(value.mode) ||
    value.root !== join(profile, 'memory') ||
    !isAbsolute(profile) ||
    resolve(profile) !== profile
  )
    throw Error('Invalid memory engine selection; review explicit installation (no fallback)')
  return value
}
export function readMemorySelection(profile: string) {
  const text = readProfileMetadata(memorySelectionPath(profile))
  return text === undefined ? undefined : parseMemorySelection(text, profile)
}

// Ordinary installation lifetime, not a fixture capability or authority grant.
// Root fences synchronously, joins callbacks/native work, releases holds, then drains.
export function createInstalledMemoryOwner(selection: MemoryEngineSelection) {
  let retired = selection.mode === 'off'
  const holds = new Set<object>()
  const waiters = new Set<() => void>()
  const hold = (owner: object) => {
    if (retired || !owner || typeof owner !== 'object') throw Error('Memory engine is off or retired')
    const token = { owner }
    holds.add(token)
    return () => {
      holds.delete(token)
      if (!holds.size) for (const done of waiters) done()
    }
  }
  return {
    root: selection.root,
    live: () => !retired,
    hold,
    retire: () => {
      retired = true
    },
    drain: () => (holds.size ? new Promise<void>((done) => waiters.add(done)) : Promise.resolve()),
  }
}
