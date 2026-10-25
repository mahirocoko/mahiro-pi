import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open, readlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { KernelRegistry as GuardRegistry } from './kernel/types.ts'

// Public Mods auth.json format provenance, not an official Codex schema.
// No auth/login/refresh or keychain subprocess, alternate files or API-key fallback.
// The fixed macOS metadata-only lsof invocation inspects this process's retained fd.
export interface ExternalQuotaAuth {
  token: string
  accountId?: string
  check(): Promise<void>
}
export interface ExternalQuotaSource {
  read(signal: AbortSignal, current: () => boolean): Promise<ExternalQuotaAuth>
}
const unavailable = () => new Error('Codex CLI unavailable')
const safe = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !/[^\x21-\x7e]/.test(value)
const guardKey = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
type Policy = {
  checkPermission(surface: string, path: string): { state: string; origin?: string; matchedPattern?: string }
}

export function codexReadAllowed(service: Policy | undefined, path: string, cwd: string): boolean {
  const allowed = (surface: string) => {
    const decision = service?.checkPermission(surface, path)
    return decision?.state === 'allow'
  }
  const pathRead = service?.checkPermission('path_read', path)
  const outside = relative(cwd, path)
  return (
    !!service &&
    allowed('read') &&
    (pathRead?.matchedPattern === undefined || pathRead.state === 'allow') &&
    (!(outside === '..' || outside.startsWith('../') || isAbsolute(outside)) ||
      allowed('external_directory_read'))
  )
}

export function codexAuthPath(home = process.env.CODEX_HOME, userHome = homedir()): string {
  const root = home ?? join(userHome, '.codex')
  if (!isAbsolute(root) || root !== resolve(root) || /[\x00-\x1f\x7f-\x9f]/.test(root)) throw unavailable()
  return join(root, 'auth.json')
}

type DescriptorInspector = {
  platform?: string
  spawn?: typeof spawn
  readlink?: (path: string) => Promise<string>
}

// Descriptor-associated names are a bounded OS observation, not a namespace lock or
// a guarantee against concurrent content changes. Never substitute another path sample.
async function descriptorPath(fd: number, signal: AbortSignal, injection: DescriptorInspector = {}) {
  if (!Number.isSafeInteger(fd) || fd < 0 || signal.aborted) throw unavailable()
  const platform = injection.platform ?? process.platform
  if (platform !== 'linux' && platform !== 'darwin') throw unavailable()
  return new Promise<string>((resolve, reject) => {
    let settled = false
    let child: ReturnType<typeof spawn> | undefined
    const finish = (error?: unknown, path?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error) {
        child?.kill('SIGKILL')
        reject(unavailable())
      } else resolve(path!)
    }
    const abort = () => finish(unavailable())
    const timer = setTimeout(abort, 1500)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) return abort()
    if (platform === 'linux') {
      void (injection.readlink ?? readlink)(`/proc/self/fd/${fd}`).then(
        (path) => {
          if (Buffer.byteLength(path) > 16384) finish(unavailable())
          else finish(undefined, path)
        },
        () => finish(unavailable()),
      )
      return
    }
    try {
      child = (injection.spawn ?? spawn)(
        '/usr/sbin/lsof',
        ['-nP', '-a', '-p', String(process.pid), '-d', String(fd), '-F0fn'],
        { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      const chunks: Buffer[] = []
      let size = 0
      let stderr = false
      const capture = (data: Buffer, errorStream: boolean) => {
        if (settled) return
        size += data.length
        if (size > 16384) return finish(unavailable())
        if (errorStream) stderr = true
        else chunks.push(Buffer.from(data))
      }
      if (!child.stdout || !child.stderr) return finish(unavailable())
      child.stdout.on('data', (data: Buffer) => capture(data, false))
      child.stderr.on('data', (data: Buffer) => capture(data, true))
      child.stdout.on('error', abort)
      child.stderr.on('error', abort)
      child.on('error', abort)
      child.on('close', (code, killedBy) => {
        if (settled) return
        if (code !== 0 || killedBy !== null || stderr) return finish(unavailable())
        const output = Buffer.concat(chunks)
        // Exactly one p set and one f/n set, with documented NUL fields and NL sets.
        // No trimming, decoding substitutions, suffix removal or extra fields.
        const prefix = Buffer.from(`p${process.pid}\0\nf${fd}\0n`)
        if (
          !output.subarray(0, prefix.length).equals(prefix) ||
          !output.subarray(-2).equals(Buffer.from('\0\n'))
        )
          return finish(unavailable())
        const name = output.subarray(prefix.length, -2)
        const path = name.toString('utf8')
        // lsof can escape nonprintable names. Refuse escape-like/unsupported names
        // rather than accepting an escaped alias for the approved physical path.
        if (!name.length || /[^\x20-\x7e]|[\\^]/.test(path) || !Buffer.from(path).equals(name))
          return finish(unavailable())
        finish(undefined, path)
      })
    } catch {
      finish(unavailable())
    }
  })
}

/** All injections are for isolated fake-file tests; production uses the status context only. */
export function codexCliSource(
  ctx: ExtensionContext,
  options: {
    path?: () => string
    authorize?: (path: string) => Promise<() => Promise<void>>
    descriptor?: DescriptorInspector
  } = {},
): ExternalQuotaSource {
  const manager = ctx.sessionManager,
    session = manager.getSessionId(),
    cwd = ctx.cwd
  const authorize =
    options.authorize ??
    (async (path: string) => {
      const registry = (globalThis as typeof globalThis & { [guardKey]?: GuardRegistry })[guardKey]
      const node = registry?.get(session),
        generation = node?.generation
      const current = () => {
        if (
          !node ||
          !registry ||
          registry.get(session) !== node ||
          node.generation !== generation ||
          !node.healthy() ||
          node.continuity.generation !== generation ||
          node.continuity.isPrimarySession?.(ctx) !== true ||
          ctx.mode !== 'tui' ||
          !ctx.hasUI ||
          ctx.sessionManager !== manager ||
          manager.getSessionId() !== session ||
          ctx.cwd !== cwd ||
          !isAbsolute(cwd) ||
          cwd !== resolve(cwd)
        )
          throw unavailable()
      }
      current()
      const { getPermissionsService } = await import('@gotgenes/pi-permission-system')
      const check = async () => {
        current()
        const service = getPermissionsService(session)
        if (!codexReadAllowed(service, path, cwd)) throw unavailable()
        current()
      }
      await check()
      return check
    })
  return {
    async read(signal, current) {
      try {
        const path = (options.path ?? codexAuthPath)()
        if (!isAbsolute(path) || path !== resolve(path) || /[\x00-\x1f\x7f-\x9f]/.test(path))
          throw unavailable()
        const authority = await authorize(path)
        const check = async () => {
          if (signal.aborted || !current()) throw unavailable()
          await authority()
          if (signal.aborted || !current()) throw unavailable()
        }
        await check()
        // Reject symlinks in the whole fixed path, not only its final component.
        for (let parent = dirname(path); ; parent = dirname(parent)) {
          await check()
          const info = await lstat(parent)
          if (!info.isDirectory() || info.isSymbolicLink()) throw unavailable()
          if (parent === dirname(path) && (info.uid !== process.getuid?.() || (info.mode & 0o022) !== 0))
            throw unavailable()
          if (parent === dirname(parent)) break
        }
        await check()
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        try {
          const info = await file.stat()
          if (
            !info.isFile() ||
            info.uid !== process.getuid?.() ||
            (info.mode & 0o077) !== 0 ||
            info.size > 65536
          )
            throw unavailable()
          const physicalPath = await descriptorPath(file.fd, signal, options.descriptor)
          if (physicalPath !== path || physicalPath.endsWith(' (deleted)')) throw unavailable()
          // Recheck Root/PSS, generation and cancellation after inspection, before any content read.
          await check()
          const buffer = Buffer.alloc(65537)
          let size = 0
          while (size < buffer.length) {
            await check()
            const part = await file.read(buffer, size, buffer.length - size, null)
            if (!part.bytesRead) break
            size += part.bytesRead
          }
          if (size > 65536) throw unavailable()
          const data = JSON.parse(buffer.subarray(0, size).toString('utf8'))
          const token = data?.tokens?.access_token,
            accountId = data?.tokens?.account_id
          if (
            (data.auth_mode !== undefined && data.auth_mode !== 'chatgpt') ||
            !safe(token, 16384) ||
            (accountId !== undefined && !safe(accountId, 256))
          )
            throw unavailable()
          await check()
          return { token, accountId, check }
        } finally {
          await file.close()
        }
      } catch {
        throw unavailable()
      }
    },
  }
}
