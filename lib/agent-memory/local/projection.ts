import { assertOid, assertRelativePath, localMemoryLimits } from './contracts.ts'
import {
  type ForgettingGuard,
  type ForgettingMetadata,
  inactiveForgettingGuard,
  suppressForgotten,
} from './forgetting.ts'
import {
  type LocalGitContext,
  type LocalGitTreeEntry,
  gitBlobPrefix,
  gitBlobSize,
  gitEntriesRecursive,
  gitEntryAt,
  gitTreeAt,
} from './git.ts'

// Disconnected committed projection. It does not publish or replace the live prompt.
export const localProjectionLimits = {
  directoryPage: 32,
  maxReadBytes: 8192,
  maxPromptFileBytes: 8192,
  maxListedPaths: 32,
  maxReplyBytes: 48 * 1024,
  maxReadOffset: localMemoryLimits.maxFileBytes,
} as const

const projectPattern = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface LocalMemoryPromptFile {
  path: string
  role: 'core' | 'index' | 'persona' | 'project'
  text: string
  bytes: number
  returnedBytes: number
  truncated: boolean
}

export interface LocalMemoryPathList<T> {
  paths: T[]
  total: number
  truncated: boolean
}

export interface LocalMemoryBlocked {
  path: string
  kind: 'symlink' | 'submodule' | 'special'
}

export interface LocalMemoryPrompt {
  commit: string
  prompt: string
  replyBytes: number
  files: LocalMemoryPromptFile[]
  absent: string[]
  deferred: LocalMemoryPathList<string>
  blocked: LocalMemoryPathList<LocalMemoryBlocked>
  forgetting: ForgettingMetadata
}

export interface LocalMemoryRead {
  commit: string
  path: string
  text: string
  offset: number
  limit: number
  bytes: number
  returnedBytes: number
  truncated: boolean
  forgetting: ForgettingMetadata
}

export interface LocalMemoryListEntry {
  path: string
  kind: 'file' | 'directory' | 'symlink' | 'submodule' | 'special'
}

export interface LocalMemoryList {
  commit: string
  directory: string
  entries: LocalMemoryListEntry[]
  offset: number
  limit: number
  total: number
  truncated: boolean
  nextOffset?: number
  forgetting: ForgettingMetadata
}

interface CompactOwner {
  path: string
  role: LocalMemoryPromptFile['role']
  required: boolean
}

interface PromptBody {
  commit: string
  files: LocalMemoryPromptFile[]
  absent: string[]
  deferred: LocalMemoryPathList<string>
  blocked: LocalMemoryPathList<LocalMemoryBlocked>
  forgetting: ForgettingMetadata
}

function described(guard: ForgettingGuard, filtered: boolean): ForgettingMetadata {
  return { ...guard.metadata, filtered }
}

function assertProject(project: string | undefined): string | undefined {
  if (project === undefined) return undefined
  if (typeof project !== 'string' || !projectPattern.test(project))
    throw Error('Local memory project refused')
  return project
}

function pathInProject(path: string, project: string): boolean {
  const match = /^(projects|deferred|archives)\/([^/]+)(?:\/|$)/.exec(path)
  if (!match) return true
  if (match[1] === 'archives' && match[2].startsWith('legacy-v1')) return true
  return match[2] === project
}

function assertPortableMemoryPath(path: string): void {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/')
  )
    throw Error('Local memory path refused')
  assertRelativePath(path)
}

function assertProjectPath(path: string, project: string | undefined): void {
  assertPortableMemoryPath(path)
  if (project && !pathInProject(path, project)) throw Error('Local memory path refused')
}

function pageBounds(
  offset: number | undefined,
  limit: number | undefined,
  cap: number,
  maxOffset: number,
): { offset: number; limit: number } {
  const resolvedOffset = offset ?? 0
  const requested = limit ?? cap
  if (!Number.isInteger(resolvedOffset) || resolvedOffset < 0 || resolvedOffset > maxOffset)
    throw Error('Local memory path refused')
  if (!Number.isInteger(requested) || requested < 1) throw Error('Local memory path refused')
  return { offset: resolvedOffset, limit: Math.min(requested, cap) }
}

function comparePath(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function entryKind(entry: LocalGitTreeEntry): LocalMemoryListEntry['kind'] {
  if (entry.mode === '100644' && entry.type === 'blob') return 'file'
  if (entry.mode === '040000' && entry.type === 'tree') return 'directory'
  if (entry.mode === '120000' && entry.type === 'blob') return 'symlink'
  if (entry.mode === '160000' && entry.type === 'commit') return 'submodule'
  return 'special'
}

function compactOwners(project: string | undefined): CompactOwner[] {
  const owners: CompactOwner[] = [
    { path: 'Core.md', role: 'core', required: true },
    { path: 'index.md', role: 'index', required: true },
    { path: 'system/persona.md', role: 'persona', required: false },
  ]
  if (!project) return owners
  owners.push(
    { path: `projects/${project}/system/overview.md`, role: 'project', required: false },
    { path: `projects/${project}/system/conventions.md`, role: 'project', required: false },
  )
  return owners
}

function utf8Prefix(buffer: Buffer, maxBytes: number): Buffer {
  if (maxBytes <= 0) return Buffer.alloc(0)
  const end = Math.min(buffer.length, maxBytes)
  let start = end - 1
  while (start >= 0 && (buffer[start] & 0xc0) === 0x80) start -= 1
  if (start < 0) return Buffer.alloc(0)
  const lead = buffer[start]
  let width = 1
  if ((lead & 0xe0) === 0xc0) width = 2
  else if ((lead & 0xf0) === 0xe0) width = 3
  else if ((lead & 0xf8) === 0xf0) width = 4
  if (start + width > end) return buffer.subarray(0, start)
  return buffer.subarray(0, end)
}

function decodeBytes(buffer: Buffer, failure: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)
  } catch {
    throw Error(failure)
  }
}

function shorten(text: string): string {
  const buffer = Buffer.from(text)
  if (buffer.length === 0) return ''
  return decodeBytes(utf8Prefix(buffer, buffer.length - 1), 'Local memory projection refused')
}

function listed<T>(items: T[], cap: number): LocalMemoryPathList<T> {
  return {
    paths: items.slice(0, cap),
    total: items.length,
    truncated: items.length > cap,
  }
}

function fitPrompt(body: PromptBody): { body: PromptBody; prompt: string } {
  let current = body
  let prompt = JSON.stringify(current)
  let guard =
    current.files.reduce((sum, file) => sum + file.text.length, 0) +
    current.deferred.paths.length +
    current.blocked.paths.length +
    8
  while (Buffer.byteLength(prompt) > localProjectionLimits.maxReplyBytes) {
    if (guard <= 0) throw Error('Local memory projection refused')
    guard -= 1
    if (current.blocked.paths.length) {
      current = {
        ...current,
        blocked: {
          ...current.blocked,
          paths: current.blocked.paths.slice(0, -1),
          truncated: true,
        },
      }
    } else if (current.deferred.paths.length) {
      current = {
        ...current,
        deferred: {
          ...current.deferred,
          paths: current.deferred.paths.slice(0, -1),
          truncated: true,
        },
      }
    } else {
      const index = current.files.findLastIndex((file) => file.text.length > 0)
      if (index < 0) throw Error('Local memory projection refused')
      const file = current.files[index]
      const text = shorten(file.text)
      if (text === file.text) throw Error('Local memory projection refused')
      const files = current.files.slice()
      files[index] = {
        ...file,
        text,
        returnedBytes: Buffer.byteLength(text),
        truncated: true,
      }
      current = { ...current, files }
    }
    prompt = JSON.stringify(current)
  }
  return { body: current, prompt }
}

export async function compileLocalMemoryPrompt(
  git: LocalGitContext,
  commit: string,
  project: string | undefined,
  guard: ForgettingGuard = inactiveForgettingGuard(),
): Promise<LocalMemoryPrompt> {
  assertOid(commit)
  const scope = assertProject(project)
  const owners = compactOwners(scope)
  const entries = await gitEntriesRecursive(git, commit)
  const byPath = new Map<string, LocalGitTreeEntry>()
  const hidden = new Set<string>()
  const deferredPaths: string[] = []
  const blocked: LocalMemoryBlocked[] = []
  let filtered = false
  for (const entry of entries) {
    if (byPath.has(entry.path) || hidden.has(entry.path)) throw Error('Local Git object refused')
    try {
      assertPortableMemoryPath(entry.path)
    } catch {
      throw Error('Local memory projection refused')
    }
    if (suppressForgotten(entry.path, entry.oid, guard)) {
      filtered = true
      hidden.add(entry.path)
      continue
    }
    byPath.set(entry.path, entry)
    const kind = entryKind(entry)
    if (kind === 'file') deferredPaths.push(entry.path)
    else if (kind === 'symlink' || kind === 'submodule' || kind === 'special')
      blocked.push({ path: entry.path, kind })
    else throw Error('Local memory projection refused')
  }
  const absent: string[] = []
  const files: LocalMemoryPromptFile[] = []
  for (const owner of owners) {
    const entry = byPath.get(owner.path)
    if (!entry) {
      if (owner.required) throw Error('Local memory projection refused')
      if (hidden.has(owner.path) || guard.pathForbidden(owner.path)) {
        filtered = true
        continue
      }
      absent.push(owner.path)
      continue
    }
    if (entryKind(entry) !== 'file') throw Error('Local memory projection refused')
    const loaded = await gitBlobPrefix(git, entry.oid, localProjectionLimits.maxPromptFileBytes)
    const clipped = utf8Prefix(loaded.bytes, localProjectionLimits.maxPromptFileBytes)
    const text = decodeBytes(clipped, 'Local memory projection refused')
    files.push({
      path: owner.path,
      role: owner.role,
      text,
      bytes: loaded.total,
      returnedBytes: clipped.length,
      truncated: clipped.length !== loaded.total,
    })
  }
  const ownerPaths = new Set(owners.map((owner) => owner.path))
  const visible = (path: string) => !scope || pathInProject(path, scope)
  deferredPaths.sort(comparePath)
  blocked.sort((left, right) => comparePath(left.path, right.path))
  const fitted = fitPrompt({
    commit,
    files,
    absent,
    deferred: listed(
      deferredPaths.filter((path) => !ownerPaths.has(path) && visible(path)),
      localProjectionLimits.maxListedPaths,
    ),
    blocked: listed(
      blocked.filter((entry) => visible(entry.path)),
      localProjectionLimits.maxListedPaths,
    ),
    forgetting: described(guard, filtered),
  })
  return {
    ...fitted.body,
    prompt: fitted.prompt,
    replyBytes: Buffer.byteLength(fitted.prompt),
  }
}

export async function readLocalMemory(
  git: LocalGitContext,
  commit: string,
  input: { path: string; project?: string; offset?: number; limit?: number },
  guard: ForgettingGuard = inactiveForgettingGuard(),
): Promise<LocalMemoryRead> {
  assertOid(commit)
  const project = assertProject(input?.project)
  assertProjectPath(input?.path, project)
  if (suppressForgotten(input.path, undefined, guard)) throw Error('Local memory path refused')
  const window = pageBounds(
    input.offset,
    input.limit,
    localProjectionLimits.maxReadBytes,
    localProjectionLimits.maxReadOffset,
  )
  const entry = await gitEntryAt(git, commit, input.path)
  if (!entry || entryKind(entry) !== 'file') throw Error('Local memory path refused')
  if (suppressForgotten(input.path, entry.oid, guard)) throw Error('Local memory path refused')
  const total = await gitBlobSize(git, entry.oid)
  if (window.offset > total) throw Error('Local memory path refused')
  if (window.offset === total) {
    return {
      commit,
      path: input.path,
      text: '',
      offset: window.offset,
      limit: window.limit,
      bytes: total,
      returnedBytes: 0,
      truncated: false,
      forgetting: described(guard, false),
    }
  }
  const fetched = await gitBlobPrefix(git, entry.oid, Math.min(total, window.offset + window.limit))
  if (window.offset >= fetched.bytes.length) throw Error('Local Git object refused')
  const lead = fetched.bytes[window.offset]
  if (lead === undefined || (lead & 0xc0) === 0x80) throw Error('Local memory read refused')
  const clipped = utf8Prefix(fetched.bytes.subarray(window.offset), window.limit)
  const text = decodeBytes(clipped, 'Local memory read refused')
  return {
    commit,
    path: input.path,
    text,
    offset: window.offset,
    limit: window.limit,
    bytes: total,
    returnedBytes: clipped.length,
    truncated: window.offset + clipped.length < total,
    forgetting: described(guard, false),
  }
}

export async function listLocalMemory(
  git: LocalGitContext,
  commit: string,
  input?: { path?: string; project?: string; offset?: number; limit?: number },
  guard: ForgettingGuard = inactiveForgettingGuard(),
): Promise<LocalMemoryList> {
  assertOid(commit)
  const project = assertProject(input?.project)
  const directory = input?.path
  if (directory === '') throw Error('Local memory path refused')
  if (directory !== undefined) assertProjectPath(directory, project)
  if (directory !== undefined && guard.pathForbidden(directory)) throw Error('Local memory path refused')
  const page = pageBounds(
    input?.offset,
    input?.limit,
    localProjectionLimits.directoryPage,
    localProjectionLimits.maxReadOffset,
  )
  if (directory !== undefined) {
    const exact = await gitEntryAt(git, commit, directory)
    if (!exact || entryKind(exact) !== 'directory') throw Error('Local memory path refused')
  }
  const listedEntries = await gitTreeAt(git, commit, directory)
  const entries: LocalMemoryListEntry[] = []
  let filtered = false
  for (const entry of listedEntries) {
    if (entry.path.includes('/') || entry.path.includes('\\') || entry.path.includes('\0'))
      throw Error('Local Git object refused')
    const path = directory ? `${directory}/${entry.path}` : entry.path
    try {
      assertPortableMemoryPath(path)
    } catch {
      throw Error('Local memory path refused')
    }
    if (project && !pathInProject(path, project)) continue
    if (suppressForgotten(path, entry.oid, guard)) {
      filtered = true
      continue
    }
    entries.push({ path, kind: entryKind(entry) })
  }
  entries.sort((left, right) => comparePath(left.path, right.path))
  if (page.offset > entries.length) throw Error('Local memory path refused')
  const slice = entries.slice(page.offset, page.offset + page.limit)
  const next = page.offset + slice.length
  const truncated = next < entries.length
  return {
    commit,
    directory: directory ?? '',
    entries: slice,
    offset: page.offset,
    limit: page.limit,
    total: entries.length,
    truncated,
    ...(truncated ? { nextOffset: next } : {}),
    forgetting: described(guard, filtered),
  }
}
