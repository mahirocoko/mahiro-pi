// Private RTK-only binding and synchronous CAS publication. No profile provisioning.
import { createHash, randomUUID } from 'node:crypto'
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
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { resolveAgentDir } from './setup.ts'
import { readBootstrapFile } from './bootstrap.ts'
import { assertPrivatePath } from './continuity/store.ts'
import { assertSafeContainer } from './feature-data.ts'

export const rtkModes = ['off', 'suggest', 'rewrite-safe', 'rewrite-rtk'] as const
export type RTKMode = (typeof rtkModes)[number]
export const validateRTKState = (s: any) => {
  if (
    !s ||
    s.version !== 1 ||
    !Number.isSafeInteger(s.sequence) ||
    s.sequence < 0 ||
    !rtkModes.includes(s.mode) ||
    Object.keys(s).some((k) => !['version', 'sequence', 'mode'].includes(k))
  )
    throw Error('Invalid private RTK state')
}
export const rtkHash = (value: string) => createHash('sha256').update(value).digest('hex')
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT'
const inside = (a: string, b: string) => b === a || b.startsWith(`${a}/`)
export function privateDirectory(path: string, optional = false): boolean {
  assertPrivatePath(path)
  try {
    const s = lstatSync(path)
    if (
      !s.isDirectory() ||
      (s.mode & 0o7777) !== 0o700 ||
      (process.getuid && s.uid !== process.getuid()) ||
      realpathSync(path) !== path
    )
      throw Error('Private owned 0700 RTK directory required')
    return true
  } catch (e) {
    if (optional && missing(e)) return false
    throw e
  }
}
export function readRTKFile(path: string): string | null {
  const f = readBootstrapFile(path)
  if (!f) return null
  if ((lstatSync(path).mode & 0o7777) !== 0o600 || Buffer.byteLength(f.text) > 65536)
    throw Error('Bounded private 0600 RTK file required')
  return f.text
}
export interface RTKBinding {
  profile: string
  project: string
  root: string
  configHash: string
}
export function rtkBinding(project: string): RTKBinding | null {
  const profile = resolveAgentDir()
  assertSafeContainer(profile)
  assertSafeContainer(project)
  for (const p of [profile, project]) {
    assertPrivatePath(p)
    if (!isAbsolute(p) || p !== resolve(p) || /[\x00-\x1f\x7f]|(?:^|\/)\.letta(?:\/|$)/i.test(p))
      throw Error('Canonical nonexcluded RTK scope required')
  }
  if (
    inside(profile, project) ||
    inside(project, profile) ||
    realpathSync(project) !== project ||
    !lstatSync(project).isDirectory()
  )
    throw Error('Separate canonical profile/project required')
  const file = join(profile, `extensions/mahiro-rtk/config.json`),
    text = readRTKFile(file)
  if (text !== null) privateDirectory(dirname(file))
  const c = text === null ? { version: 1, profile, projects: [] } : JSON.parse(text)
  if (
    !c ||
    c.version !== 1 ||
    c.profile !== profile ||
    Object.keys(c).some((k) => !['version', 'profile', 'projects'].includes(k)) ||
    !Array.isArray(c.projects) ||
    c.projects.length > 32 ||
    c.projects.some((p: unknown) => typeof p !== 'string') ||
    new Set(c.projects).size !== c.projects.length
  )
    throw Error('Invalid explicit RTK configuration')
  // Profile-wide preference; project identity is validated, not whitelisted.
  const root = join(profile, 'preferences', 'rtk')
  for (const p of [
    process.env.MAHIRO_AGENT_MEMORY_ROOT ?? join(profile, 'memory'),
    process.env.MAHIRO_CONTINUITY_ROOT ?? join(profile, 'continuity'),
  ]) {
    assertPrivatePath(p)
    if (inside(p, root) || inside(root, p)) throw Error('RTK overlap memory or continuity')
  }
  for (const p of [join(profile, 'preferences'), root]) privateDirectory(p, true)
  return {
    profile,
    project,
    root,
    configHash: rtkHash(text ?? `canonical-rtk-v2:${profile}`),
  }
}
export function assertRTKBinding(b: RTKBinding) {
  if (JSON.stringify(rtkBinding(b.project)) !== JSON.stringify(b)) throw Error('RTK configuration changed')
}
// A bounded synchronous publication after the final synchronous owner check.
// UI awaits happen before this boundary. No stale-lock steal or read-time repair.
export function publishRTKState(b: RTKBinding, ticket: string, next: unknown, assertCurrent: () => void) {
  assertCurrent()
  assertRTKBinding(b)
  validateRTKState(next)
  const bytes = `${JSON.stringify(next)}\n`
  if (Buffer.byteLength(bytes) > 65536) throw Error('RTK byte bound exceeded')
  for (const p of [join(b.profile, 'preferences'), b.root]) {
    if (!privateDirectory(p, true)) mkdirSync(p, { mode: 0o700 })
    privateDirectory(p)
  }
  const lock = join(b.root, 'state.lock'),
    file = join(b.root, 'state.json'),
    temp = join(b.root, `.state-${randomUUID()}.tmp`)
  const fd = openSync(
    lock,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  const lockStat = fstatSync(fd)
  let tempFd: number | undefined
  let published = false
  try {
    writeFileSync(fd, randomUUID())
    fsyncSync(fd)
    if (rtkHash(readRTKFile(file) ?? '<absent>') !== ticket) throw Error('Stale RTK revision; read again')
    tempFd = openSync(
      temp,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    writeFileSync(tempFd, bytes)
    fsyncSync(tempFd)
    const original = fstatSync(tempFd)
    assertCurrent()
    assertRTKBinding(b)
    for (const p of [join(b.profile, 'preferences'), b.root]) privateDirectory(p)
    if (rtkHash(readRTKFile(file) ?? '<absent>') !== ticket) throw Error('Stale RTK revision; read again')
    const actual = lstatSync(temp)
    const checked = Buffer.alloc(Buffer.byteLength(bytes) + 1)
    const checkedSize = readSync(tempFd, checked, 0, checked.length, 0)
    if (
      !actual.isFile() ||
      actual.ino !== original.ino ||
      actual.dev !== original.dev ||
      actual.nlink !== 1 ||
      actual.mode !== original.mode ||
      actual.size !== Buffer.byteLength(bytes) ||
      checkedSize !== Buffer.byteLength(bytes) ||
      !checked.subarray(0, checkedSize).equals(Buffer.from(bytes))
    )
      throw Error('RTK temporary changed')
    renameSync(temp, file)
    published = true
    const d = openSync(b.root, constants.O_RDONLY)
    try {
      fsyncSync(d)
    } finally {
      closeSync(d)
    }
  } finally {
    if (tempFd !== undefined) closeSync(tempFd)
    if (!published) {
      try {
        unlinkSync(temp)
      } catch (e) {
        if (!missing(e)) throw e
      }
    }
    closeSync(fd)
    const actual = lstatSync(lock)
    if (actual.ino !== lockStat.ino || actual.dev !== lockStat.dev)
      throw Error('RTK lock changed; manual recovery required')
    unlinkSync(lock)
  }
}
