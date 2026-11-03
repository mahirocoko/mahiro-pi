import { createHash } from 'node:crypto'
import { lstat, readdir, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { memorySelectionPath, parseMemorySelection, readProfileMetadata } from '../profile.ts'
import { type MemoryEngineController, type OperationContext } from './controller.ts'
import { privateDirectory, safePath } from './io.ts'
import { fileHash, gate as maintenanceGate, inspectHolders, offlineAssurance } from './offline-maintenance.ts'
import { offlineResetFailure, type OfflineResetFailureCode } from '../reasons.ts'

const classified = async <T>(code: OfflineResetFailureCode, operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation()
  } catch (error) {
    throw offlineResetFailure(error, code)
  }
}
const gate: typeof maintenanceGate = (context, targets) =>
  classified('authority', () => maintenanceGate(context, targets))

export const destroyNoBackup = 'destroy-entire-standard-memory-root-no-backup'
export interface ResetRequest {
  action: 'offline-reset-inspect' | 'offline-reset'
  target?: string
  revision?: string
  offline?: string
  destruction?: string
}
interface Entry {
  path: string
  identity: string
  kind: 'file' | 'directory'
  mode: number
  size: number
  hash?: string
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const identity = (stat: { dev: number; ino: number }) => `${stat.dev}:${stat.ino}`
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

// Separate from recovery: no journal replay, Git invocation, marker, archive, rename or initialization.
// The caller must be the registered native offline primary; context rechecks exact PSS/DATA authority.
export async function offlineReset(
  engine: MemoryEngineController,
  context: OperationContext,
  request: ResetRequest,
) {
  if (engine.pid || engine.queueSize)
    throw offlineResetFailure(
      Error('Reset requires a fresh idle offline controller'),
      'reset-controller-busy',
    )
  const root = engine.root
  const agentDir = dirname(root)
  if (root !== join(agentDir, 'memory'))
    throw offlineResetFailure(Error('Only the standard memory root can be reset'), 'standard-root')
  const inspection = request.action === 'offline-reset-inspect'
  if (
    !['offline-reset-inspect', 'offline-reset'].includes(request.action) ||
    Object.keys(request).some(
      (key) => !['action', 'target', 'revision', 'offline', 'destruction'].includes(key),
    ) ||
    (inspection
      ? Object.keys(request).length !== 1
      : request.offline !== offlineAssurance ||
        request.destruction !== destroyNoBackup ||
        !/^[a-f0-9]{64}$/.test(request.target ?? '') ||
        !/^[a-f0-9]{64}$/.test(request.revision ?? ''))
  )
    throw offlineResetFailure(
      Error('Exact reviewed destructive offline reset arguments required'),
      'reset-request-shape',
    )

  const authority = async () => {
    await gate(context, [root])
    await safePath(agentDir)
    const parent = await lstat(agentDir)
    if (!parent.isDirectory()) throw Error('Canonical agent directory required')
    const selected = readProfileMetadata(memorySelectionPath(agentDir))
    const settings = readProfileMetadata(join(agentDir, 'settings.json'))
    if (!selected || !settings || parseMemorySelection(selected, agentDir).mode !== 'engine')
      throw Error('Existing standard ABI2 selection and settings required')
    const parsed = JSON.parse(settings)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.packages))
      throw Error('Existing installation settings required')
    await gate(context, [root])
    return digest({ root, parent: identity(parent), selected, settings })
  }
  const scan = () =>
    classified('scan', async () => {
      const binding = await authority()
      await gate(context, [root])
      let rootStat
      try {
        rootStat = await lstat(root)
      } catch (error) {
        if (!missing(error)) throw error
        return { binding, entries: [] as Entry[] }
      }
      await classified('unsafe-entry', () => privateDirectory(root))
      const entries: Entry[] = []
      const pending = ['.']
      let bytes = 0
      while (pending.length) {
        const path = pending.pop()!
        const physical = path === '.' ? root : join(root, path)
        await gate(context, [physical])
        await classified('unsafe-entry', () => safePath(physical))
        const stat = await lstat(physical)
        if (
          stat.isSymbolicLink() ||
          (!stat.isFile() && !stat.isDirectory()) ||
          (stat.isFile() && stat.nlink !== 1) ||
          stat.mode & 0o022 ||
          (process.getuid && stat.uid !== process.getuid())
        )
          throw offlineResetFailure(
            Error('Reset refuses links, special files or unsafe ownership'),
            'unsafe-entry',
          )
        const entry: Entry = {
          path,
          identity: identity(stat),
          kind: stat.isDirectory() ? 'directory' : 'file',
          mode: stat.mode & 0o777,
          size: 0,
        }
        if (stat.isFile()) {
          Object.assign(entry, await fileHash(physical, context))
          bytes += entry.size
          if (bytes > 8 * 1024 * 1024 * 1024) throw Error('Reset byte bound exceeded')
        } else {
          await gate(context, [physical])
          const names = await readdir(physical)
          if (names.length + entries.length + pending.length > 131072)
            throw Error('Reset entry bound exceeded')
          for (const name of names) pending.push(path === '.' ? name : `${path}/${name}`)
        }
        entries.push(entry)
        if (entries.length > 131072) throw Error('Reset entry bound exceeded')
      }
      entries.sort((a, b) => a.path.localeCompare(b.path, 'en'))
      if (identity(rootStat) !== entries.find((entry) => entry.path === '.')?.identity)
        throw offlineResetFailure(Error('Reset root changed during inventory'), 'fingerprint')
      if ((await authority()) !== binding)
        throw offlineResetFailure(Error('Reset selection/settings changed'), 'fingerprint')
      return { binding, entries }
    })
  const holders = () =>
    classified('holder-inspection', () => inspectHolders(root, engine, context, false, true))
  const plan = await scan()
  const revision = digest(plan)
  const rootIdentity = plan.entries.find((entry) => entry.path === '.')?.identity ?? null
  const target = digest({ binding: plan.binding, rootIdentity })
  // A fresh controller has never started an executor; inspection itself never drains/mutates one.
  if (plan.entries.length) await holders()
  if (digest(await scan()) !== revision)
    throw offlineResetFailure(Error('Reset fingerprint changed during inspection'), 'fingerprint')
  const counts = {
    files: plan.entries.filter((entry) => entry.kind === 'file').length,
    directories: plan.entries.filter((entry) => entry.kind === 'directory').length,
    bytes: plan.entries.reduce((sum, entry) => sum + entry.size, 0),
  }
  if (inspection)
    return {
      target,
      revision,
      rootIdentity,
      state: rootIdentity ? 'present-unvalidated-or-partial' : 'absent-uninitialized',
      counts,
      backupCreated: false,
      corpusReturned: false,
    } as const
  if (request.target !== target || request.revision !== revision)
    throw offlineResetFailure(Error('Exact reviewed reset target and fingerprint required'), 'fingerprint')
  if (!plan.entries.length)
    throw offlineResetFailure(Error('Reset root already absent; no action'), 'reset-preflight')
  // Last complete bytes/config/selection review, then the fixed kernel holder check immediately
  // before deletion. Cooperative exclusion is mandatory; this is not a same-user hostile OS sandbox.
  if (digest(await scan()) !== revision)
    throw offlineResetFailure(Error('Reset fingerprint changed before deletion'), 'fingerprint')
  await holders()
  if ((await authority()) !== plan.binding)
    throw offlineResetFailure(Error('Reset selection/settings changed before deletion'), 'fingerprint')
  const depth = (entry: Entry) => (entry.path === '.' ? 0 : entry.path.split('/').length)
  for (const entry of [...plan.entries].sort((a, b) => depth(b) - depth(a))) {
    const physical = entry.path === '.' ? root : join(root, entry.path)
    await gate(context, [physical])
    if ((await authority()) !== plan.binding)
      throw offlineResetFailure(Error('Reset authority changed during deletion'), 'fingerprint')
    await safePath(physical)
    const stat = await lstat(physical)
    if (
      identity(stat) !== entry.identity ||
      (stat.mode & 0o777) !== entry.mode ||
      stat.isSymbolicLink() ||
      (entry.kind === 'file' ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory())
    )
      throw offlineResetFailure(
        Error('Reset entry changed; partial deletion requires fresh inspection'),
        'fingerprint',
      )
    if (entry.kind === 'file') {
      if ((await fileHash(physical, context)).hash !== entry.hash)
        throw offlineResetFailure(
          Error('Reset bytes changed; partial deletion requires fresh inspection'),
          'fingerprint',
        )
      await gate(context, [physical])
      await unlink(physical)
    } else {
      await gate(context, [physical])
      await rmdir(physical) // Never recursive: new/unreviewed children cause refusal, not deletion.
    }
  }
  await gate(context, [root])
  try {
    await lstat(root)
    throw Error('Reset root still present')
  } catch (error) {
    if (!missing(error)) throw error
  }
  return {
    state: 'absent-uninitialized',
    destroyed: true,
    backupCreated: false,
    corpusReturned: false,
    lockPresent: false,
    pendingOperation: false,
  } as const
}
