import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import type { Checkpoint } from './protocol.ts'

export type Check = (targets: Checkpoint) => Promise<void>
// Explicit OS/Git environment only. Never forward provider/SDK/profile/auth settings.
export function engineEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    'SYSTEMROOT',
  ])
    if (source[key] !== undefined) env[key] = source[key]
  return env
}
export async function safePath(path: string) {
  if (!isAbsolute(path) || resolve(path) !== path) throw Error('Canonical absolute path required')
  let current = parse(path).root
  for (const part of path.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part)
    try {
      const s = await lstat(current)
      if (s.isSymbolicLink() || (s.isFile() && s.nlink !== 1)) throw Error('Linked path refused')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
export async function privateDirectory(path: string, create = false) {
  await safePath(path)
  if (create) await mkdir(path, { mode: 0o700, recursive: true })
  const s = await lstat(path)
  if (!s.isDirectory() || s.mode & 0o077) throw Error('Private directory required')
}
export async function readPrivate(path: string, max: number) {
  await safePath(path)
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const s = await fd.stat()
    if (!s.isFile() || s.nlink !== 1 || s.mode & 0o077 || s.size > max)
      throw Error('Private file unavailable')
    const data = await fd.readFile()
    if (data.length > max) throw Error('Private file bound exceeded')
    return data
  } finally {
    await fd.close()
  }
}
export async function atomicPrivate(path: string, text: string | Buffer) {
  await privateDirectory(dirname(path), true)
  await safePath(path)
  const temp = `${path}.${randomUUID()}.tmp`
  const fd = await open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await fd.writeFile(text)
    await fd.sync()
  } finally {
    await fd.close()
  }
  await rename(temp, path)
  const dir = await open(dirname(path), constants.O_RDONLY)
  try {
    await dir.sync()
  } finally {
    await dir.close()
  }
}
export async function gitSafety(root: string, check?: Check, logical: string[] = []) {
  const gate = async (physical: string[]) => {
    if (!check) return
    for (let start = 0; start < Math.max(physical.length, logical.length, 1); start += 32)
      await check({
        physical: physical.slice(start, start + 32),
        logical: logical.slice(start, start + 32),
        kind: 'git',
      })
  }
  await gate([root, join(root, '.git')])
  await privateDirectory(root)
  if ((await realpath(root)) !== root) throw Error('Canonical root required')
  const git = join(root, '.git')
  await safePath(git)
  if (!(await lstat(git)).isDirectory()) throw Error('Standalone Git required')
  await gate(
    [
      'HEAD',
      'HEAD.lock',
      'index',
      'index.lock',
      'config',
      'config.lock',
      'packed-refs',
      'packed-refs.lock',
      'objects',
      'objects/pack',
      'objects/info',
      'refs',
      'refs/heads',
      'logs',
      'hooks',
      'info',
      'info/exclude',
    ].map((path) => join(git, path)),
  )
  const pending = [git]
  let count = 0
  while (pending.length) {
    // Coalesce traversal RPCs, not verdicts: each bounded native batch has its own fresh gate.
    // Launch all native reads in that batch synchronously after the checkpoint resolves.
    const directories = pending.splice(-32)
    await gate(directories)
    const listings = await Promise.all(directories.map((dir) => readdir(dir)))
    const paths = listings.flatMap((entries, index) =>
      entries.map((entry) => join(directories[index], entry)),
    )
    count += paths.length
    if (count > 8192) throw Error('Git metadata capacity exceeded')
    for (let start = 0; start < paths.length; start += 32) {
      const batch = paths.slice(start, start + 32)
      await gate(batch)
      const stats = await Promise.all(
        batch.map(async (path) => {
          try {
            return await lstat(path)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
            throw error
          }
        }),
      )
      for (let index = 0; index < batch.length; index++) {
        const s = stats[index]
        if (!s) continue
        if (s.isSymbolicLink() || (s.isFile() && s.nlink !== 1)) throw Error('Linked Git metadata refused')
        if (s.isDirectory()) pending.push(batch[index])
      }
    }
  }
}
export const contained = (root: string, path: string) => {
  const part = relative(root, path)
  return part === '' || (!part.startsWith('..') && !isAbsolute(part))
}
// Cold certification only: bounded path entries (not deduplicated OIDs), with framing headroom
// below runGit's unchanged 2 MiB stdout ceiling. These are not transport/protocol capabilities.
export const gitBlobLimits = Object.freeze({ entries: 32, bytes: 1024 * 1024 })
export interface GitBlob {
  oid: string
  size: number
}
export function gitBlobBatches<T extends GitBlob>(entries: T[]): T[][] {
  const batches: T[][] = []
  let batch: T[] = []
  let size = 0
  for (const entry of entries) {
    if (
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(entry.oid) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > 262144
    )
      throw Error('Invalid certification blob')
    if (batch.length === gitBlobLimits.entries || size + entry.size > gitBlobLimits.bytes) {
      batches.push(batch)
      batch = []
      size = 0
    }
    batch.push(entry)
    size += entry.size
  }
  if (batch.length) batches.push(batch)
  return batches
}
export function parseGitBlobs(raw: Buffer, expected: GitBlob[]): string[] {
  if (!expected.length || gitBlobBatches(expected).length !== 1 || raw.length > 2 * 1024 * 1024)
    throw Error('Invalid certification batch bound')
  const texts: string[] = []
  let offset = 0
  for (const { oid, size } of expected) {
    const header = Buffer.from(`${oid} blob ${size}\n`, 'ascii')
    if (!raw.subarray(offset, offset + header.length).equals(header))
      throw Error('Invalid certification blob header/order')
    offset += header.length
    const body = raw.subarray(offset, offset + size)
    offset += size
    if (body.length !== size || raw[offset++] !== 10) throw Error('Truncated certification blob/delimiter')
    const actual = createHash(oid.length === 40 ? 'sha1' : 'sha256')
      .update(`blob ${size}\0`)
      .update(body)
      .digest('hex')
    if (actual !== oid) throw Error('Certification blob object hash mismatch')
    // Preserve a literal BOM as content; never silently replace invalid UTF-8 bytes.
    texts.push(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body))
  }
  if (offset !== raw.length) throw Error('Extra certification blob bytes')
  return texts
}
export function runGit(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  input?: string,
): Promise<Buffer> {
  // Caller owns fixed argv selection; never exposed as a transport method.
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-pager', ...args], {
      cwd: root,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal,
    })
    const chunks: Buffer[] = []
    let length = 0
    let stderr = 0
    const timer = setTimeout(() => child.kill('SIGTERM'), 10000)
    child.stdout.on('data', (chunk: Buffer) => {
      length += chunk.length
      if (length > 2 * 1024 * 1024) child.kill('SIGTERM')
      else chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.length
      if (stderr > 65536) child.kill('SIGTERM')
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code, killed) => {
      clearTimeout(timer)
      if (code !== 0 || killed || length > 2 * 1024 * 1024 || stderr > 65536)
        reject(Error(`Git failed (${code ?? killed}); output withheld`))
      else resolve(Buffer.concat(chunks))
    })
  })
}
