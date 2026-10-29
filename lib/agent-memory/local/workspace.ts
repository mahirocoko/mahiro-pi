import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { join, sep } from 'node:path'
import { writeNoFollow } from './confine.ts'
import { assertRelativePath, localMemoryLimits } from './contracts.ts'

// Confined worktree adapter. No shell, Git, network, or absolute-path authority.
export interface MaintenanceSearchHit {
  path: string
  line: number
}

export interface MaintenanceWorkspace {
  read(relativePath: string): string
  list(relativePath?: string): string[]
  search(query: string): MaintenanceSearchHit[]
  write(relativePath: string, text: string): void
  edit(relativePath: string, oldText: string, newText: string): void
  delete(relativePath: string): void
  rename(from: string, to: string): void
}

function refuse(): never {
  throw Error('Local memory path refused')
}

function partsOf(relativePath: string): string[] {
  assertRelativePath(relativePath)
  return relativePath.split('/')
}

function inside(root: string, target: string): void {
  if (target !== root && !target.startsWith(`${root}${sep}`)) refuse()
}

function walk(root: string, relativePath: string, allowMissingLeaf: boolean): string {
  const parts = partsOf(relativePath)
  const rootStat = lstatSync(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) refuse()
  let current = root
  for (const [index, part] of parts.entries()) {
    const next = join(current, part)
    const leaf = index === parts.length - 1
    let stat: ReturnType<typeof lstatSync> | undefined
    try {
      stat = lstatSync(next)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (stat?.isSymbolicLink()) refuse()
    if (!leaf) {
      if (!stat || !stat.isDirectory()) refuse()
      current = next
      continue
    }
    if (!stat) {
      if (!allowMissingLeaf) refuse()
    } else if (!stat.isFile() || stat.nlink !== 1 || stat.isFIFO() || stat.isSocket()) refuse()
    current = next
  }
  inside(root, current)
  return current
}

function directoryAt(root: string, relativePath: string | undefined): string {
  if (!relativePath) {
    const stat = lstatSync(root)
    if (stat.isSymbolicLink() || !stat.isDirectory()) refuse()
    return root
  }
  const parts = partsOf(relativePath)
  let current = root
  for (const part of parts) {
    current = join(current, part)
    const stat = lstatSync(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) refuse()
  }
  inside(root, current)
  return current
}

function readAt(target: string): string {
  let fd: number
  try {
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ELOOP' || code === 'ENOENT') refuse()
    throw error
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > localMemoryLimits.maxFileBytes) refuse()
    const buffer = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, offset)
      if (count === 0) break
      offset += count
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset))
  } catch (error) {
    if (error instanceof Error && error.message === 'Local memory path refused') throw error
    refuse()
  } finally {
    closeSync(fd)
  }
}

function assertText(text: string): void {
  if (
    typeof text !== 'string' ||
    text.includes('\0') ||
    Buffer.byteLength(text) > localMemoryLimits.maxFileBytes
  )
    refuse()
}

function occurrenceCount(text: string, needle: string): number {
  let count = 0
  let from = 0
  while (from <= text.length) {
    const found = text.indexOf(needle, from)
    if (found < 0) break
    count += 1
    from = found + needle.length
  }
  return count
}

export function createMaintenanceWorkspace(
  root: string,
  track: { reserve(paths: readonly string[]): void; remember(paths: readonly string[]): void },
): MaintenanceWorkspace {
  const read = (relativePath: string): string => readAt(walk(root, relativePath, false))
  const write = (relativePath: string, text: string): void => {
    partsOf(relativePath)
    assertText(text)
    track.reserve([relativePath])
    writeNoFollow(root, relativePath, text)
    track.remember([relativePath])
  }
  return {
    read,
    list(relativePath?: string): string[] {
      const target = directoryAt(root, relativePath)
      const names = readdirSync(target, { withFileTypes: true })
      if (names.length > localMemoryLimits.maxDirectoryEntries) refuse()
      const visible: string[] = []
      for (const entry of names) {
        if (entry.name === '.git') continue
        if (entry.isSymbolicLink()) refuse()
        if (!entry.isFile() && !entry.isDirectory()) refuse()
        visible.push(entry.name)
      }
      visible.sort()
      return visible
    },
    search(query: string): MaintenanceSearchHit[] {
      if (typeof query !== 'string' || query.length < 1 || query.length > 128 || query.includes('\0'))
        refuse()
      const hits: MaintenanceSearchHit[] = []
      let files = 0
      const visit = (directory: string, prefix: string): void => {
        const names = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
          left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
        )
        if (names.length > localMemoryLimits.maxDirectoryEntries) refuse()
        for (const entry of names) {
          if (entry.name === '.git') continue
          if (entry.isSymbolicLink()) refuse()
          const relative = prefix ? `${prefix}/${entry.name}` : entry.name
          const next = join(directory, entry.name)
          if (entry.isDirectory()) {
            visit(next, relative)
            continue
          }
          if (!entry.isFile()) refuse()
          files += 1
          if (files > localMemoryLimits.maxDirectoryEntries) refuse()
          const text = read(relative)
          const lines = text.split('\n')
          for (const [index, line] of lines.entries()) {
            if (!line.includes(query)) continue
            if (hits.length >= 32) refuse()
            hits.push({ path: relative, line: index + 1 })
          }
        }
      }
      visit(directoryAt(root, undefined), '')
      return hits
    },
    write,
    edit(relativePath: string, oldText: string, newText: string): void {
      if (typeof oldText !== 'string' || oldText.length < 1) refuse()
      const current = read(relativePath)
      if (occurrenceCount(current, oldText) !== 1) refuse()
      write(
        relativePath,
        current.replace(oldText, () => newText),
      )
    },
    delete(relativePath: string): void {
      const target = walk(root, relativePath, false)
      track.reserve([relativePath])
      unlinkSync(target)
      track.remember([relativePath])
    },
    rename(from: string, to: string): void {
      const source = walk(root, from, false)
      const destination = walk(root, to, true)
      if (lstatSync(source).isSymbolicLink()) refuse()
      try {
        const existing = lstatSync(destination)
        if (existing.isSymbolicLink() || existing.isFile() || existing.isDirectory()) refuse()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      track.reserve([from, to])
      renameSync(source, destination)
      track.remember([from, to])
    },
  }
}
