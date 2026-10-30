import { randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  writeSync,
} from 'node:fs'
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { verifyLocalMemoryClaim } from './coordination.ts'

export async function assertRealDirectory(path: string): Promise<void> {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Local memory state child refused')
  if ((await realpath(path)) !== path) throw Error('Local memory state child refused')
}

export async function ensureRealDirectory(path: string): Promise<void> {
  verifyLocalMemoryClaim()
  try {
    await assertRealDirectory(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(path, { mode: 0o700 })
    await assertRealDirectory(path)
  }
}

export async function readRegularFile(path: string): Promise<{ text: string; dev: string; ino: string }> {
  let stat
  try {
    stat = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
    throw Error('Local memory record refused')
  }
  if (stat.isSymbolicLink() || stat.isFIFO() || stat.isSocket() || !stat.isFile() || stat.nlink !== 1)
    throw Error('Local memory record refused')
  if (stat.size > 65536) throw Error('Local memory record refused')
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch {
    throw Error('Local memory record refused')
  }
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.nlink !== 1 || String(opened.ino) !== String(stat.ino))
      throw Error('Local memory record refused')
    return { text: await handle.readFile('utf8'), dev: String(opened.dev), ino: String(opened.ino) }
  } finally {
    await handle.close()
  }
}

export function isOwnedTempName(name: string): boolean {
  return /^\.[A-Za-z0-9][A-Za-z0-9._-]*\.\d+\.[0-9a-f]{16}\.tmp$/.test(name)
}

export async function writeExclusive(path: string, text: string): Promise<void> {
  verifyLocalMemoryClaim()
  await assertRealDirectory(dirname(path))
  const temporary = join(
    dirname(path),
    `.${path.slice(dirname(path).length + 1)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  )
  let fd: number
  try {
    fd = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
      0o600,
    )
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ELOOP' || code === 'EEXIST') throw Error('Local memory temp refused')
    throw error
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1) throw Error('Local memory temp refused')
    writeSync(fd, text)
  } finally {
    closeSync(fd)
  }
  const created = lstatSync(temporary)
  if (!created.isFile() || created.isSymbolicLink() || created.nlink !== 1) {
    await unlink(temporary).catch(() => {})
    throw Error('Local memory temp refused')
  }
  verifyLocalMemoryClaim()
  await rename(temporary, path)
  const finalStat = await lstat(path)
  if (!finalStat.isFile() || finalStat.isSymbolicLink() || finalStat.nlink !== 1)
    throw Error('Local memory record refused')
}

export function writeNoFollow(root: string, relativePath: string, text: string): void {
  verifyLocalMemoryClaim()
  const parts = relativePath.split('/')
  if (!parts.length) throw Error('Local memory path refused')
  const rootStat = lstatSync(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw Error('Local memory path refused')
  let current = root
  for (const [index, part] of parts.entries()) {
    if (!part || part === '.' || part === '..' || part.includes('\0') || part.includes('/'))
      throw Error('Local memory path refused')
    const next = join(current, part)
    const leaf = index === parts.length - 1
    let stat: ReturnType<typeof lstatSync> | undefined
    try {
      stat = lstatSync(next)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (stat?.isSymbolicLink()) throw Error('Local memory path refused')
    if (!leaf) {
      if (!stat) mkdirSync(next, { mode: 0o700 })
      const directory = lstatSync(next)
      if (directory.isSymbolicLink() || !directory.isDirectory()) throw Error('Local memory path refused')
      current = next
      continue
    }
    let fd: number
    if (!stat) {
      try {
        fd = openSync(
          next,
          constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
          0o600,
        )
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ELOOP' || code === 'EEXIST') throw Error('Local memory path refused')
        throw error
      }
    } else {
      if (!stat.isFile() || stat.nlink !== 1) throw Error('Local memory path refused')
      try {
        fd = openSync(next, constants.O_WRONLY | constants.O_NOFOLLOW)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ELOOP' || code === 'EEXIST') throw Error('Local memory path refused')
        throw error
      }
      const opened = fstatSync(fd)
      if (!opened.isFile() || opened.nlink !== 1 || String(opened.ino) !== String(stat.ino)) {
        closeSync(fd)
        throw Error('Local memory path refused')
      }
      ftruncateSync(fd, 0)
    }
    try {
      writeSync(fd, text)
    } finally {
      closeSync(fd)
    }
  }
}
