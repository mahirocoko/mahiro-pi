import { createHash, randomUUID } from 'node:crypto'
import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { WORKER_CAP } from './worker-activity.ts'

// Herdr Web private wire v1. This package owns its producer, not Web's readers.
export const WEB_ACTIVITY_MAX_BYTES = 16_384
export const WEB_ACTIVITY_MAX_RECORDS = 24
export const WEB_ACTIVITY_HEARTBEAT_MS = 2_000
export const WEB_ACTIVITY_TTL_MS = 8_000
export interface WebSession {
  getSessionFile(): string | undefined
  getSessionId(): string
}
interface RecordV1 {
  id: string
  type: string
  description: string
  status: 'queued' | 'running' | 'completed' | 'aborted' | 'stopped' | 'error'
  startedAt: number
  completedAt?: number
  toolUses: number
  outputFile?: string
}
function record(value: unknown): RecordV1 | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const r = value as Record<string, unknown>
  const date = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8.64e15
  if (
    typeof r.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(r.id) ||
    typeof r.type !== 'string' ||
    r.type.length > 128 ||
    typeof r.description !== 'string' ||
    r.description.length > 1024 ||
    !['queued', 'running', 'completed', 'aborted', 'stopped', 'error'].includes(String(r.status)) ||
    !date(r.startedAt) ||
    !Number.isSafeInteger(r.toolUses) ||
    (r.toolUses as number) < 0 ||
    (r.completedAt !== undefined && (!date(r.completedAt) || r.completedAt < r.startedAt)) ||
    (r.outputFile !== undefined && (typeof r.outputFile !== 'string' || r.outputFile.length > 4096))
  )
    return
  return {
    id: r.id,
    type: r.type,
    description: r.description,
    status: r.status as RecordV1['status'],
    startedAt: r.startedAt,
    toolUses: r.toolUses as number,
    ...(r.completedAt === undefined ? {} : { completedAt: r.completedAt as number }),
    ...(r.outputFile === undefined ? {} : { outputFile: r.outputFile as string }),
  }
}

/** Select only bounded native metadata. No prompt, result, history or transcript read. */
export function webActivitySnapshot(manager: WebSession, all: unknown, now = Date.now(), pid = process.pid) {
  if (
    (all !== undefined && (!Array.isArray(all) || all.length > WORKER_CAP)) ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !Number.isFinite(now) ||
    now < 0
  )
    return
  const records: RecordV1[] = []
  for (const value of all ?? []) {
    const next = record(value)
    if (!next) return
    records.push(next)
  }
  if (new Set(records.map((r) => r.id)).size !== records.length) return
  const active = (r: RecordV1) => r.status === 'running' || r.status === 'queued'
  if (records.filter(active).length > WEB_ACTIVITY_MAX_RECORDS) return
  records.sort((a, b) => Number(active(b)) - Number(active(a)) || b.startedAt - a.startedAt)
  const file = manager.getSessionFile()
  const id = manager.getSessionId()
  if (!file || !isAbsolute(file) || file.length > 4096 || typeof id !== 'string' || !id || id.length > 256)
    return
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(file) !== file) return
  const snapshot = {
    version: 1,
    parentFile: file,
    parentSessionId: id,
    pid,
    updatedAt: now,
    records: records.slice(0, WEB_ACTIVITY_MAX_RECORDS),
    ...(all === undefined ? { activity: 'unavailable' as const } : {}),
  }
  return Buffer.byteLength(JSON.stringify(snapshot)) <= WEB_ACTIVITY_MAX_BYTES ? snapshot : undefined
}

function privateNode(path: string, directory: boolean) {
  const stat = lstatSync(path)
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new Error('Observer path is not owner-private; left unchanged')
  }
}
function checkExistingReceipt(path: string, producer: string, parent: string, now: number) {
  let fd: number | undefined
  try {
    privateNode(path, false)
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const previous = boundedJson(fd, WEB_ACTIVITY_MAX_BYTES)
    if (
      previous.version !== 1 ||
      previous.parentFile !== parent ||
      typeof previous.updatedAt !== 'number' ||
      !Number.isFinite(previous.updatedAt) ||
      (previous.producer !== producer && now - previous.updatedAt <= WEB_ACTIVITY_TTL_MS)
    )
      throw new Error('Foreign or incompatible observer receipt; do not run competing producers')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
function prepare(root: string) {
  if (process.platform === 'win32')
    throw new Error('Windows live observer unavailable; no ACL/POSIX fallback')
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory())
    throw new Error('Non-canonical observer checkout')
  let path = root
  for (const part of ['.agent-state', 'runtime', 'upstream-v10700', 'pi-subagents']) {
    path = join(path, part)
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 })
    privateNode(path, true)
  }
  return path
}

function boundedJson(fd: number, cap: number) {
  const bytes = Buffer.alloc(cap + 1)
  const size = readSync(fd, bytes, 0, bytes.length, 0)
  if (size > cap) throw new Error('Observer JSON exceeds bound')
  return JSON.parse(bytes.subarray(0, size).toString('utf8'))
}

/** One-time, owner-private profile configuration. Never inferred from session cwd or a socket. */
export function readWebActivityTarget(agentDir: string): string | undefined {
  let fd: number | undefined
  try {
    if (realpathSync(agentDir) !== agentDir) throw new Error('Non-canonical profile directory')
    fd = openSync(
      join(agentDir, 'herdr-web.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 4096 || stat.uid !== process.getuid?.() || stat.mode & 0o077)
      throw new Error('Observer configuration is not private or bounded')
    const config = boundedJson(fd, 4096)
    if (
      config?.version !== 1 ||
      typeof config.root !== 'string' ||
      !isAbsolute(config.root) ||
      config.root.length > 4096 ||
      realpathSync(config.root) !== config.root
    )
      throw new Error('Invalid observer target')
    return config.root
  } catch (error) {
    if (fd === undefined && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

const producerKey = Symbol.for('mahirocoko.pi-web-observer.owner.v1')
interface ProducerOwner {
  dispose(): void
}

/** Runtime-neutral sink. One configured TUI producer per process; Web alone validates the
 * current foreground PID in either native runtime. No CLI, socket, subprocess or extra poll.
 */
export function createWebActivityPublisher(
  ctx: { mode: string; sessionManager: WebSession },
  options: { root: string; now?: () => number },
) {
  if (ctx.mode !== 'tui' || process.platform === 'win32') throw new Error('Observer requires POSIX TUI')
  const root = resolve(options.root)
  if (root !== options.root || realpathSync(root) !== root)
    throw new Error('Observer target is not canonical')
  const host = globalThis as typeof globalThis & { [producerKey]?: ProducerOwner }
  host[producerKey]?.dispose()
  const manager = ctx.sessionManager
  const producer = randomUUID()
  const now = options.now ?? Date.now
  let alive = true
  let at = -Infinity
  let state = 'enabled; awaiting scoped publication'
  let receipt: string | undefined
  let identity: string | undefined
  const revoke = () => {
    if (!receipt) return
    let fd: number | undefined
    try {
      prepare(root)
      privateNode(receipt, false)
      fd = openSync(receipt, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      if (
        fstatSync(fd).size <= WEB_ACTIVITY_MAX_BYTES &&
        boundedJson(fd, WEB_ACTIVITY_MAX_BYTES).producer === producer
      )
        unlinkSync(receipt)
    } catch {
      /* Never delete another generation or repair privacy. TTL remains the crash fallback. */
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
    receipt = undefined
  }
  const sink = {
    status: () => state,
    dispose() {
      if (!alive) return
      alive = false
      revoke()
      if (host[producerKey] === sink) delete host[producerKey]
      state = 'stopped; own receipt revoked (8s crash fallback)'
    },
    publish(read: () => unknown, current: () => boolean) {
      const same = () => alive && host[producerKey] === sink && current() && ctx.sessionManager === manager
      if (!same()) return
      if (now() - at < WEB_ACTIVITY_HEARTBEAT_MS) return
      at = now()
      let temporary: string | undefined
      try {
        // Public SessionManager creates the file lazily. Bind on its first valid publication.
        const snapshot = webActivitySnapshot(manager, read(), now())
        if (!snapshot || !same()) throw new Error('Scoped snapshot unavailable or outside bounds')
        const nextIdentity = `${snapshot.parentFile}\0${snapshot.parentSessionId}`
        if (identity !== undefined && identity !== nextIdentity)
          throw new Error('Session identity changed without lifecycle')
        identity = nextIdentity
        const text = JSON.stringify({ ...snapshot, producer })
        if (Buffer.byteLength(text) > WEB_ACTIVITY_MAX_BYTES) throw new Error('Receipt exceeds bound')
        const directory = prepare(root)
        const file = join(directory, `${createHash('sha256').update(snapshot.parentFile).digest('hex')}.json`)
        checkExistingReceipt(file, producer, snapshot.parentFile, now())
        temporary = `${file}.${producer}.tmp`
        writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 })
        if (!same()) throw new Error('Observer owner changed before publication')
        prepare(root)
        checkExistingReceipt(file, producer, snapshot.parentFile, now())
        renameSync(temporary, file)
        temporary = undefined
        receipt = file
        state =
          snapshot.activity === 'unavailable'
            ? 'publishing parent only; child activity unavailable'
            : 'publishing parent and children; Web independently checks foreground PID and 8s freshness'
      } catch {
        revoke()
        state = 'unavailable: privacy/identity/producer/owner/bounds check failed'
      } finally {
        if (temporary) {
          try {
            unlinkSync(temporary)
          } catch {
            /* own temporary only */
          }
        }
      }
    },
  }
  host[producerKey] = sink
  return sink
}
