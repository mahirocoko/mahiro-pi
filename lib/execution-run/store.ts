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
import { fileURLToPath } from 'node:url'
import { resolveAgentDir } from '../setup.ts'
import { emptyState, validateState, type Scope, type State as RunState } from './model.ts'

const MAX_BYTES = 8 * 1024 * 1024
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')
const sourceRoots = [sourceRoot, join(dirname(sourceRoot), 'mods')]
const inside = (root: string, path: string) => path === root || path.startsWith(`${root}/`)
export const executionRunHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const uid = () => process.getuid?.()
const excluded = (path: string) => /(?:^|\/)\.letta(?:\/|$)/i.test(path)
function canonical(path: string) {
  if (
    typeof path !== 'string' ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    /[\x00-\x1f]/.test(path) ||
    excluded(path)
  )
    throw new Error('Canonical nonexcluded Execution Run path required')
  let current = path
  for (;;) {
    try {
      const stat = lstatSync(current)
      if (
        stat.isSymbolicLink() ||
        (current !== path && !stat.isDirectory()) ||
        (stat.mode & 0o022) !== 0 ||
        (uid() !== undefined && stat.uid !== uid() && stat.uid !== 0)
      )
        throw new Error('Unsafe Execution Run path ancestor')
    } catch (error) {
      if (!missing(error)) throw error
    }
    if (dirname(current) === current) break
    current = dirname(current)
  }
}
function privateDirectory(path: string, optional = false) {
  canonical(path)
  try {
    const stat = lstatSync(path)
    if (
      !stat.isDirectory() ||
      (stat.mode & 0o7777) !== 0o700 ||
      (uid() !== undefined && stat.uid !== uid()) ||
      realpathSync(path) !== path
    )
      throw new Error('Private owned Execution Run directory required')
    return true
  } catch (error) {
    if (optional && missing(error)) return false
    throw error
  }
}
function readPrivate(path: string, bound = MAX_BYTES): string | null {
  canonical(path)
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o7777) !== 0o600 ||
    (uid() !== undefined && stat.uid !== uid()) ||
    stat.size > bound
  )
    throw new Error('Unsafe or oversized private Execution Run file')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const buffer = Buffer.alloc(bound + 1)
    let size = 0,
      count = 0
    do {
      count = readSync(fd, buffer, size, buffer.length - size, size)
      size += count
    } while (count && size < buffer.length)
    const after = fstatSync(fd)
    if (
      !after.isFile() ||
      after.ino !== stat.ino ||
      after.dev !== stat.dev ||
      after.nlink !== 1 ||
      after.mode !== stat.mode ||
      after.uid !== stat.uid ||
      after.size !== size ||
      size > bound ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    )
      throw new Error('Execution Run file changed during read')
    const text = buffer.subarray(0, size).toString('utf8')
    if (!Buffer.from(text).equals(buffer.subarray(0, size))) throw new Error('Execution Run UTF-8 required')
    return text
  } finally {
    closeSync(fd)
  }
}
export interface RunBinding extends Scope {
  root: string
  configHash: string
  configIdentity: string
}
/** Canonical read-only binding; optional legacy configs bind freshness, not availability. */
export function resolveRunBinding(project: string): RunBinding | null {
  const profile = resolveAgentDir()
  canonical(profile)
  canonical(project)
  if (
    sourceRoots.some(
      (source) =>
        (inside(source, profile) && !inside(join(source, '.agent-state/runtime'), profile)) ||
        inside(profile, source),
    ) ||
    inside(profile, project) ||
    inside(project, profile) ||
    inside(join(profile, 'memory'), project) ||
    inside(join(profile, 'continuity'), project)
  )
    throw new Error('Execution Run profile/project/source separation required')
  // No project whitelist or read-time initialization.
  const configPath = join(profile, 'extensions/mahiro-execution-run/config.json')
  const text = readPrivate(configPath, 16384)
  if (text !== null) privateDirectory(dirname(configPath))
  if (realpathSync(project) !== project || !lstatSync(project).isDirectory())
    throw new Error('Existing canonical project required')
  let config: any
  try {
    config = text === null ? { version: 1, profile, projects: [] } : JSON.parse(text)
  } catch {
    throw new Error('Invalid Execution Run configuration JSON')
  }
  validateRunConfiguration(config, profile)
  // Each canonical project has its own derived state leaf.
  const root = join(profile, 'workflow/execution-run', executionRunHash(project))
  for (const dir of [join(profile, 'workflow'), join(profile, 'workflow/execution-run'), root])
    privateDirectory(dir, true)
  return {
    profile,
    project,
    root,
    configHash: executionRunHash(text ?? `canonical-run-v2:${profile}`),
    configIdentity:
      text === null ? 'canonical-v2' : [lstatSync(configPath).dev, lstatSync(configPath).ino].join(':'),
    sessionId: '',
  }
}
function validateRunConfiguration(config: any, profile: string): void {
  canonical(profile)
  // Host profile containers may be safe 0755; data leaves remain 0700.
  if (
    sourceRoots.some(
      (source) =>
        (inside(source, profile) && !inside(join(source, '.agent-state/runtime'), profile)) ||
        inside(profile, source),
    ) ||
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    config.version !== 1 ||
    config.profile !== profile ||
    Object.keys(config).some((k) => !['version', 'profile', 'projects'].includes(k)) ||
    !Array.isArray(config.projects) ||
    config.projects.length > 32 ||
    new Set(config.projects).size !== config.projects.length ||
    Buffer.byteLength(JSON.stringify(config)) > 16384
  )
    throw new Error('Invalid explicit Execution Run configuration')
  const workflow = join(profile, 'workflow/execution-run')
  for (const protectedRoot of [
    process.env.MAHIRO_AGENT_MEMORY_ROOT ?? join(profile, 'memory'),
    process.env.MAHIRO_CONTINUITY_ROOT ?? join(profile, 'continuity'),
  ]) {
    canonical(protectedRoot)
    if (inside(protectedRoot, workflow) || inside(workflow, protectedRoot))
      throw new Error('Execution Run storage overlaps managed-memory or continuity root')
  }
  for (const root of config.projects) {
    canonical(root)
    if (
      realpathSync(root) !== root ||
      !lstatSync(root).isDirectory() ||
      inside(profile, root) ||
      inside(root, profile)
    )
      throw new Error('Invalid configured Execution Run project')
  }
}
function assertBinding(binding: RunBinding) {
  const current = resolveRunBinding(binding.project)
  if (
    !current ||
    current.profile !== binding.profile ||
    current.root !== binding.root ||
    current.configHash !== binding.configHash ||
    current.configIdentity !== binding.configIdentity
  )
    throw new Error('Execution Run configuration authority changed')
}
export function readRunState(binding: RunBinding): RunState {
  assertBinding(binding)
  const text = readPrivate(join(binding.root, 'state.json'))
  if (text === null) return emptyState(binding.profile, binding.project)
  let state
  try {
    state = JSON.parse(text)
  } catch {
    throw new Error('Invalid Execution Run state JSON')
  }
  validateState(state, binding.profile, binding.project)
  return state
}
export interface RunTicket {
  readonly digest: string
}
/** Whole-state ticket also prevents absent→create→clear ABA across processes. */
export function stateTicket(state: RunState): RunTicket {
  return Object.freeze({ digest: executionRunHash(JSON.stringify(state)) })
}
const queues = new Map<string, { tail: Promise<unknown>; pending: number }>()
export async function transactRun<T>(
  binding: RunBinding,
  ticket: RunTicket,
  authorize: () => void | Promise<void>,
  mutate: (state: RunState) => T,
  assertCurrent: () => void = () => {},
): Promise<T> {
  let queue = queues.get(binding.root)
  if (!queue) {
    queue = { tail: Promise.resolve(), pending: 0 }
    queues.set(binding.root, queue)
  }
  if (queue.pending >= 32) throw new Error('Execution Run local queue bound reached')
  queue.pending++
  const operation = queue.tail
    .catch(() => {})
    .then(async () => {
      await authorize()
      assertCurrent()
      assertBinding(binding)
      // Parent creation is solely in this explicit authorized mutation, never reads/startup.
      for (const dir of [
        join(binding.profile, 'workflow'),
        join(binding.profile, 'workflow/execution-run'),
        binding.root,
      ]) {
        if (!privateDirectory(dir, true)) {
          try {
            mkdirSync(dir, { mode: 0o700 })
          } catch (error) {
            // A cooperating process may create the same parent after preview.
            // Accept only EEXIST followed by full private-directory validation.
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          }
          privateDirectory(dir)
        }
      }
      const lockPath = join(binding.root, 'state.lock'),
        token = randomUUID()
      let lockFd: number
      try {
        lockFd = openSync(
          lockPath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        )
      } catch (error) {
        throw new Error('Execution Run lock unavailable; no automatic stale steal or force unlock', {
          cause: error,
        })
      }
      let lockStat
      let temp: string | undefined
      let tempFd: number | undefined
      let targetFd: number | undefined
      let tempStat: import('node:fs').Stats | undefined
      try {
        const lockBytes = JSON.stringify({ token, pid: process.pid })
        writeFileSync(lockFd, lockBytes)
        fsyncSync(lockFd)
        lockStat = fstatSync(lockFd)
        const state = readRunState(binding)
        if (stateTicket(state).digest !== ticket.digest)
          throw new Error('Stale Execution Run revision ticket; read again')
        const result = mutate(state)
        state.sequence++
        validateState(state, binding.profile, binding.project)
        const bytes = Buffer.from(`${JSON.stringify(state)}\n`)
        if (bytes.length > MAX_BYTES) throw new Error('Execution Run state byte bound exceeded')
        temp = join(binding.root, `.state-${process.pid}-${randomUUID()}.tmp`)
        // Keep the original descriptor open across authorization: an unlinked
        // inode cannot be reused and mistaken for our owned temporary file.
        tempFd = openSync(
          temp,
          constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        )
        tempStat = fstatSync(tempFd)
        writeFileSync(tempFd, bytes)
        fsyncSync(tempFd)
        const parentPaths: string[] = []
        for (let p = binding.root; ; p = dirname(p)) {
          parentPaths.push(p)
          if (dirname(p) === p) break
        }
        const parents = parentPaths.map((path) => ({
          path,
          stat: lstatSync(path),
        }))
        const target = join(binding.root, 'state.json')
        let targetStat: import('node:fs').Stats | undefined
        try {
          targetStat = lstatSync(target)
        } catch (error) {
          if (!missing(error)) throw error
        }
        if (targetStat) {
          targetFd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW)
          const openedTarget = fstatSync(targetFd)
          if (openedTarget.dev !== targetStat.dev || openedTarget.ino !== targetStat.ino)
            throw new Error('Execution Run target changed while binding descriptor')
        }
        await authorize()
        // Recheck in this continuation, not only inside the awaited authorizer:
        // a navigation/cancellation microtask may precede this resumption.
        assertCurrent()
        assertBinding(binding)
        // Revalidate lock token/inode, target safety and canonical context immediately before commit.
        const currentLock = lstatSync(lockPath)
        if (
          currentLock.ino !== lockStat.ino ||
          currentLock.dev !== lockStat.dev ||
          readPrivate(lockPath, 1024) !== lockBytes
        )
          throw new Error('Execution Run lock ownership changed')
        const fresh = readRunState(binding)
        if (stateTicket(fresh).digest !== ticket.digest)
          throw new Error('Execution Run state changed before commit')
        for (const parent of parents) {
          canonical(parent.path)
          const current = lstatSync(parent.path)
          if (current.dev !== parent.stat.dev || current.ino !== parent.stat.ino)
            throw new Error('Execution Run parent identity changed')
        }
        let currentTarget: import('node:fs').Stats | undefined
        try {
          currentTarget = lstatSync(target)
        } catch (error) {
          if (!missing(error)) throw error
        }
        if (
          !!currentTarget !== !!targetStat ||
          (currentTarget &&
            targetStat &&
            (currentTarget.dev !== targetStat.dev || currentTarget.ino !== targetStat.ino))
        )
          throw new Error('Execution Run target identity changed')
        const pathname = lstatSync(temp),
          opened = fstatSync(tempFd)
        const owned = (stat: import('node:fs').Stats) =>
          stat.isFile() &&
          stat.dev === tempStat!.dev &&
          stat.ino === tempStat!.ino &&
          stat.nlink === 1 &&
          (stat.mode & 0o7777) === 0o600 &&
          stat.uid === tempStat!.uid &&
          stat.gid === tempStat!.gid &&
          stat.size === bytes.length
        if (!owned(pathname) || !owned(opened))
          throw new Error('Execution Run temporary identity or private metadata changed')
        const prepared = Buffer.alloc(bytes.length + 1)
        let length = 0,
          count = 0
        do {
          count = readSync(tempFd, prepared, length, prepared.length - length, length)
          length += count
        } while (count && length < prepared.length)
        const afterRead = fstatSync(tempFd),
          finalPath = lstatSync(temp)
        if (
          !owned(afterRead) ||
          !owned(finalPath) ||
          afterRead.mtimeMs !== opened.mtimeMs ||
          afterRead.ctimeMs !== opened.ctimeMs ||
          length !== bytes.length ||
          !prepared.subarray(0, length).equals(bytes)
        )
          throw new Error('Execution Run temporary serialized bytes changed')
        // Bounded synchronous final checks: no JS authorization/context yield
        // between this integrity check and rename. Public pathname APIs cannot
        // eliminate an external same-UID race; this is not an adversarial sandbox.
        fsyncSync(tempFd)
        renameSync(temp, target)
        temp = undefined
        const dirFd = openSync(binding.root, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          fsyncSync(dirFd)
        } finally {
          closeSync(dirFd)
        }
        return result
      } finally {
        try {
          try {
            if (temp && tempStat) {
              const current = lstatSync(temp)
              if (current.isFile() && current.dev === tempStat.dev && current.ino === tempStat.ino)
                unlinkSync(temp)
            }
          } catch (error) {
            if (!missing(error)) throw error
          }
        } finally {
          // Release only the lock this transaction created, even if owned-temp
          // cleanup failed. Held descriptors prevent inode-reuse confusion.
          try {
            const current = lstatSync(lockPath)
            if (
              lockStat &&
              current.isFile() &&
              current.ino === lockStat.ino &&
              current.dev === lockStat.dev &&
              JSON.parse(readPrivate(lockPath, 1024)!).token === token
            )
              unlinkSync(lockPath)
          } catch (error) {
            if (!missing(error)) throw error
          } finally {
            closeSync(lockFd)
            if (tempFd !== undefined) closeSync(tempFd)
            if (targetFd !== undefined) closeSync(targetFd)
          }
        }
      }
    })
  queue.tail = operation
  try {
    return await operation
  } finally {
    queue.pending--
    if (!queue.pending && queues.get(binding.root) === queue) queues.delete(binding.root)
  }
}
