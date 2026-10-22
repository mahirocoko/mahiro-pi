import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { herdrBinding, type Job, type Run, run } from './status.ts'
import { WORKER_CAP } from './worker-activity.ts'

// Herdr Web private wire v1. This package owns its producer, not Web's readers.
export const WEB_ACTIVITY_MAX_BYTES = 16_384
export const WEB_ACTIVITY_MAX_RECORDS = 24
export const WEB_ACTIVITY_HEARTBEAT_MS = 2_000
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
    !Array.isArray(all) ||
    all.length > WORKER_CAP ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !Number.isFinite(now) ||
    now < 0
  )
    return
  const records: RecordV1[] = []
  for (const value of all) {
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
function checkExistingReceipt(path: string) {
  try {
    privateNode(path, false)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
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

/** Explicit session command enables this sink; loading/reloading never writes a receipt.
 * The existing worker owner supplies the only poll and revalidates service/generation.
 */
export function createWebActivityPublisher(
  ctx: { mode: string; cwd: string; sessionManager: WebSession },
  options: {
    env?: NodeJS.ProcessEnv
    run?: Run
    now?: () => number
  } = {},
) {
  const binding = herdrBinding(options.env ?? process.env)
  if (ctx.mode !== 'tui' || !binding || process.platform === 'win32')
    throw new Error('Observer requires POSIX foreground Herdr TUI')
  const root = realpathSync(resolve(ctx.cwd))
  const manager = ctx.sessionManager
  const parent = manager.getSessionFile()
  const parentId = manager.getSessionId()
  const execute = options.run ?? run
  const now = options.now ?? Date.now
  let alive = true
  let job: Job | undefined
  let at = -Infinity
  let state = 'enabled; awaiting scoped owner/foreground publication'
  return {
    status: () => state,
    dispose() {
      alive = false
      job?.cancel()
      state = "stopped; last receipt expires within Web's 8s TTL"
      // Never unlink a newer runtime's receipt. No chmod/umask/ACL repair.
    },
    publish(read: () => unknown, current: () => boolean) {
      if (!alive || job || now() - at < WEB_ACTIVITY_HEARTBEAT_MS) return
      at = now()
      const same = () =>
        alive &&
        current() &&
        ctx.sessionManager === manager &&
        manager.getSessionFile() === parent &&
        manager.getSessionId() === parentId
      if (!same()) {
        state = 'unavailable: session/owner changed'
        return
      }
      try {
        const currentJob = execute(
          'herdr',
          ['pane', 'process-info', '--pane', binding.HERDR_PANE_ID!],
          undefined,
          binding,
        )
        job = currentJob
        currentJob.promise
          .then((text) => {
            if (!same()) return
            const info = JSON.parse(text)?.result?.process_info
            if (
              info?.pane_id !== binding.HERDR_PANE_ID ||
              !Array.isArray(info.foreground_processes) ||
              !info.foreground_processes.some((p: { pid?: number }) => p?.pid === process.pid)
            )
              throw new Error('Parent Pi is not foreground')
            // Read the *current* scoped service after the async foreground check.
            const snapshot = webActivitySnapshot(manager, read(), now())
            if (!snapshot || !same()) throw new Error('Scoped snapshot unavailable or outside bounds')
            const directory = prepare(root)
            const file = join(
              directory,
              `${createHash('sha256').update(snapshot.parentFile).digest('hex')}.json`,
            )
            checkExistingReceipt(file)
            let temporary: string | undefined
            try {
              temporary = `${file}.${randomUUID()}.tmp`
              writeFileSync(temporary, JSON.stringify(snapshot), {
                flag: 'wx',
                mode: 0o600,
              })
              // Cooperating owner/session changes during validation must not publish.
              if (!same()) throw new Error('Observer owner changed before publication')
              prepare(root)
              checkExistingReceipt(file)
              renameSync(temporary, file)
              temporary = undefined
              state = 'publishing private wire v1; Web independently checks parent/PID/8s freshness'
            } finally {
              if (temporary) {
                try {
                  unlinkSync(temporary)
                } catch {
                  /* own temporary only */
                }
              }
            }
          })
          .catch(() => {
            if (alive) state = 'unavailable: privacy/foreground/owner/transport check failed; lease expires'
          })
          .finally(() => {
            if (job === currentJob) job = undefined
          })
      } catch {
        state = 'unavailable: transport failed; lease expires'
      }
    },
  }
}
