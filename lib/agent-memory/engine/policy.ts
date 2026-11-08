import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { constants, type Stats } from 'node:fs'
import { lstat, open, opendir, realpath, rename, unlink } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { digest, objectShape } from '../../continuity/records.ts'
import { parseConfig, revisionPattern, uuidPattern } from './schema.ts'
import type { MemoryConfig } from '../store.ts'
import {
  automaticForTrigger,
  type ReflectionTrigger,
  validReflectionStepCount,
  validReflectionTrigger,
} from '../reflection-config.ts'
import { privateDirectory, readPrivate, safePath } from './io.ts'
import { acquireOperationLock, releaseOperationLock, verifyOperationLock } from './owned-lock.ts'
import { parseLockOwner, type LockOwner } from './operation.ts'
import { assertCurrent, type MemoryEngineController, type OperationContext } from './controller.ts'

// Require the native module, never a generation-local transpiler copy or injectable global map.
const { executePolicy, policyExecutor, recoverPolicy, forgetPolicy } = createRequire(import.meta.url)(
  './policy-executors.mjs',
) as typeof import('./policy-executors.mjs')

interface PolicyIdentity {
  root: string
  rootIdentity: string
  operation: string
  nonce: string
  revision: string
  originalHash: string
  intendedHash: string
  originalBytes: string
  intendedBytes: string
  automatic: boolean
  reflectionTrigger?: ReflectionTrigger
  reflectionStepCount?: number
  digest: string
}
interface PolicyRecord {
  version: 1 | 2
  kind: 'policy'
  identity: PolicyIdentity
  owner: LockOwner
}
const inode = (stat: Awaited<ReturnType<typeof lstat>>) => `${stat.dev}:${stat.ino}`
const bytesHash = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const recordPath = (root: string) => join(root, '.lock/policy.json')
const stagePath = (root: string) => join(root, '.lock/config.next')
const check = (context: OperationContext, ...physical: string[]) =>
  assertCurrent(context, { physical, logical: [], kind: 'data' })

const policyIdentityKeys = [
  'root',
  'rootIdentity',
  'operation',
  'nonce',
  'revision',
  'originalHash',
  'intendedHash',
  'originalBytes',
  'intendedBytes',
  'automatic',
  'digest',
]
function parsePolicy(raw: Buffer): PolicyRecord {
  const value = JSON.parse(raw.toString('utf8'))
  const version = value?.version
  const identityKeys =
    version === 2
      ? [...policyIdentityKeys.slice(0, -1), 'reflectionTrigger', 'reflectionStepCount', 'digest']
      : policyIdentityKeys
  if (
    !objectShape(value, ['version', 'kind', 'identity', 'owner']) ||
    Object.keys(value).length !== 4 ||
    (version !== 1 && version !== 2) ||
    value.kind !== 'policy' ||
    !objectShape(value.identity, identityKeys) ||
    Object.keys(value.identity).length !== identityKeys.length
  )
    throw Error('Unknown policy evidence')
  const i = value.identity
  const { digest: expected, ...binding } = i
  if (
    typeof i.root !== 'string' ||
    typeof i.rootIdentity !== 'string' ||
    !/^\d+:\d+$/.test(i.rootIdentity) ||
    typeof i.operation !== 'string' ||
    !uuidPattern.test(i.operation) ||
    typeof i.nonce !== 'string' ||
    !uuidPattern.test(i.nonce) ||
    typeof i.revision !== 'string' ||
    !revisionPattern.test(i.revision) ||
    ![i.originalHash, i.intendedHash, i.originalBytes, i.intendedBytes, expected].every(hash) ||
    typeof i.automatic !== 'boolean' ||
    (version === 2 &&
      (!validReflectionTrigger(i.reflectionTrigger) ||
        !validReflectionStepCount(i.reflectionStepCount) ||
        i.automatic !== automaticForTrigger(i.reflectionTrigger))) ||
    digest(JSON.stringify(binding)) !== expected
  )
    throw Error('Unknown policy binding')
  const owner = parseLockOwner(value.owner)
  if (owner.operation !== i.operation || owner.digest !== i.digest || owner.nonce !== i.nonce)
    throw Error('Unknown policy lock binding')
  return value as unknown as PolicyRecord
}

async function rootIdentity(root: string, context: OperationContext) {
  check(context, root)
  await privateDirectory(root)
  if ((await realpath(root)) !== root) throw Error('Canonical policy root required')
  const stat = await lstat(root)
  check(context, root)
  return inode(stat)
}

async function writeRecord(root: string, record: PolicyRecord, context: OperationContext) {
  const path = recordPath(root)
  await safePath(path)
  await verifyOperationLock(root, record.owner, context)
  check(context, path)
  const fd = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    check(context, path)
    await fd.writeFile(`${JSON.stringify(record)}\n`)
    check(context, path)
    await fd.sync()
  } finally {
    await fd.close()
  }
}

async function evidence(root: string, context: OperationContext) {
  check(context, recordPath(root), stagePath(root), join(root, '.lock/owner.json'))
  const record = parsePolicy(await readPrivate(recordPath(root), 4096))
  if (record.identity.root !== root || record.identity.rootIdentity !== (await rootIdentity(root, context)))
    throw Error('Policy root identity changed')
  await verifyOperationLock(root, record.owner, context)
  const reference = policyExecutor(root, record.identity.operation)
  if (
    !reference ||
    !isDeepStrictEqual(reference.identity, record.identity) ||
    !isDeepStrictEqual(reference.owner, record.owner)
  )
    throw Error('Actual policy executor unavailable')
  return { record, reference }
}

async function observed(engine: MemoryEngineController, context: OperationContext, identity: PolicyIdentity) {
  check(context, join(engine.root, 'config.json'))
  const raw = await readPrivate(join(engine.root, 'config.json'), 65536)
  const config = parseConfig(raw.toString('utf8'))
  const configHash = digest(JSON.stringify(config))
  const outcome =
    configHash === identity.intendedHash
      ? 'intended'
      : configHash === identity.originalHash
        ? 'original'
        : 'unknown'
  const bytesKnown = [identity.originalBytes, identity.intendedBytes].includes(bytesHash(raw))
  return { automatic: config.automatic, configHash, outcome: bytesKnown ? outcome : 'unknown' }
}

async function stagingMatches(
  root: string,
  record: PolicyRecord,
  staging: string | null,
  context: OperationContext,
) {
  const path = stagePath(root)
  check(context, path)
  let stat
  try {
    stat = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
  return (
    !!staging &&
    inode(stat) === staging &&
    stat.isFile() &&
    stat.nlink === 1 &&
    !(stat.mode & 0o077) &&
    bytesHash(await readPrivate(path, 65536)) === record.identity.intendedBytes
  )
}

export type LockObservation = 'absent' | 'directory-present' | 'other-entry-present' | 'unavailable'
export type LockShape = 'empty' | 'owner-only' | 'other' | 'unavailable'

// Cooperative pathname observation, NOT a descriptor-bound snapshot. Node opendir has
// no no-follow flag: observed links/replacements fail closed, transient swaps may escape
// detection. No entry contents or entry metadata are read; owner-only is a name only.
async function observeLockShape(
  root: string,
  initial: Stats,
  context: OperationContext,
  discovered: string[],
): Promise<LockShape> {
  const lock = join(root, '.lock')
  const bound = () => check(context, root, lock, ...discovered)
  const fenced = async <T>(read: () => Promise<T>): Promise<T> => {
    bound()
    try {
      return await read()
    } finally {
      bound()
    }
  }
  const same = (a: typeof initial, b: typeof initial) =>
    b.isDirectory() &&
    !(b.mode & 0o077) &&
    inode(a) === inode(b) &&
    a.mode === b.mode &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  try {
    await fenced(() => privateDirectory(root))
    const rootBefore = await fenced(() => lstat(root))
    await fenced(() => privateDirectory(lock))
    const before = await fenced(() => lstat(lock))
    if (!same(initial, before)) throw Error('Lock changed')
    // bufferSize 1 and two explicit reads: never inventory the full directory.
    // Acquire outside fenced so a post-open revocation cannot leak the Dir handle.
    bound()
    const directory = await opendir(lock, { bufferSize: 1 })
    let shape: LockShape
    try {
      bound()
      const first = await fenced(() => directory.read())
      if (first) {
        discovered.push(join(lock, first.name))
        bound()
      }
      const second = first ? await fenced(() => directory.read()) : null
      if (second) {
        discovered.push(join(lock, second.name))
        bound()
      }
      shape = !first ? 'empty' : !second && first.name === 'owner.json' ? 'owner-only' : 'other'
    } finally {
      // Closing the already-open handle must also happen on revoked authority.
      try {
        bound()
      } finally {
        try {
          await directory.close()
        } finally {
          bound()
        }
      }
    }
    const after = await fenced(() => lstat(lock))
    const rootAfter = await fenced(() => lstat(root))
    if (!same(before, after) || !same(rootBefore, rootAfter)) throw Error('Directory changed')
    bound()
    return shape
  } catch {
    bound()
    return 'unavailable'
  }
}

export type LockOwnerPendingComparison = 'match' | 'mismatch' | 'unavailable'

// Read-only, cooperative comparison with already-read pending metadata. This is
// neither a policy/publication ownership check nor a recovery eligibility test.
async function compareLockOwnerPending(
  root: string,
  initial: Stats,
  pending: readonly { id: string; digest: string }[],
  context: OperationContext,
  discovered: string[],
): Promise<LockOwnerPendingComparison> {
  const lock = join(root, '.lock')
  const ownerPath = join(lock, 'owner.json')
  if (!discovered.includes(ownerPath)) discovered.push(ownerPath)
  const bound = () => check(context, root, lock, ...discovered)
  const fenced = async <T>(read: () => Promise<T>): Promise<T> => {
    bound()
    try {
      return await read()
    } finally {
      bound()
    }
  }
  const same = (a: Stats, b: Stats) =>
    b.isDirectory() &&
    !(b.mode & 0o077) &&
    inode(a) === inode(b) &&
    a.mode === b.mode &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  try {
    await fenced(() => privateDirectory(root))
    const rootBefore = await fenced(() => lstat(root))
    await fenced(() => privateDirectory(lock))
    const before = await fenced(() => lstat(lock))
    if (!same(initial, before)) throw Error('Lock changed')
    const raw = await fenced(() => readPrivate(ownerPath, 2048))
    const owner = parseLockOwner(JSON.parse(raw.toString('utf8')))
    const again = await fenced(() => readPrivate(ownerPath, 2048))
    const after = await fenced(() => lstat(lock))
    const rootAfter = await fenced(() => lstat(root))
    if (!raw.equals(again) || !same(before, after) || !same(rootBefore, rootAfter))
      throw Error('Comparison evidence changed')
    bound()
    return pending.some((entry) => entry.id === owner.operation && entry.digest === owner.digest)
      ? 'match'
      : 'mismatch'
  } catch {
    bound()
    return 'unavailable'
  }
}

// Point-in-time entry observation only, never ownership, quiescence or removal eligibility.
// Diagnostic disk evidence NEVER proves quiescence. Unknown/non-policy locks are retained.
interface MemoryPolicyStatus {
  state: string
  lockRetained: boolean
  lockObservation: LockObservation
  lockShape?: LockShape
  lockOwnerPendingComparison?: LockOwnerPendingComparison
  next: string
  outcome?: string
  target?: string
  digest?: string
  expectedRevision?: string
  automatic?: boolean
  configHash?: string
}

export async function memoryPolicyStatus(
  engine: MemoryEngineController,
  context: OperationContext,
  pending?: readonly { id: string; digest: string }[],
): Promise<MemoryPolicyStatus> {
  const lock = join(engine.root, '.lock')
  // Retain discovered exact targets through the entire status call, including error
  // fallbacks. A child denial must not become a successful shape classification.
  const discovered: string[] = []
  const bound = () => check(context, engine.root, lock, ...discovered)
  const fenced = async <T>(read: () => Promise<T>): Promise<T> => {
    bound()
    try {
      return await read()
    } finally {
      bound()
    }
  }
  let lockObservation: LockObservation = 'unavailable'
  let lockShape: LockShape | undefined
  let lockOwnerPendingComparison: LockOwnerPendingComparison = 'unavailable'
  try {
    bound()
    await privateDirectory(engine.root)
    bound()
    try {
      const stat = await lstat(lock)
      bound()
      lockObservation = stat.isDirectory() ? 'directory-present' : 'other-entry-present'
      if (lockObservation === 'directory-present') {
        lockShape = await observeLockShape(engine.root, stat, context, discovered)
        if (pending)
          lockOwnerPendingComparison = await compareLockOwnerPending(
            engine.root,
            stat,
            pending,
            context,
            discovered,
          )
      }
      bound()
    } catch (error) {
      bound()
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      lockObservation = 'absent'
      return { state: 'idle', lockRetained: false, lockObservation, next: 'none' }
    }
    if (lockObservation !== 'directory-present') throw Error('Policy lock directory unavailable')
    const { record, reference } = await fenced(() => evidence(engine.root, context))
    const actual = await fenced(() => observed(engine, context, record.identity))
    const available =
      !reference.drained || reference.recovering
        ? false
        : actual.outcome !== 'unknown' &&
          (await fenced(() => engine.request('upgradePreflight', {}, context))).revision ===
            record.identity.revision &&
          (await fenced(() => stagingMatches(engine.root, record, reference.staging, context)))
    const state =
      !reference.drained || reference.recovering
        ? 'active/draining'
        : available
          ? 'retained+recoverable'
          : 'unknown/unavailable'
    bound()
    return {
      state,
      lockObservation,
      ...(lockObservation === 'directory-present' ? { lockShape: lockShape ?? 'unavailable' } : {}),
      ...(lockObservation === 'directory-present' ? { lockOwnerPendingComparison } : {}),
      target: record.identity.operation,
      digest: record.identity.digest,
      expectedRevision: record.identity.revision,
      ...actual,
      lockRetained: true,
      next:
        state === 'retained+recoverable'
          ? 'fresh-primary-policy-reconcile'
          : state === 'active/draining'
            ? 'wait-for-actual-drain-then-read-status'
            : 'explicit-owner-review-no-lock-stealing',
    }
  } catch {
    bound()
    return {
      state: 'unknown/unavailable',
      lockRetained: true,
      lockObservation,
      ...(lockObservation === 'directory-present' ? { lockShape: lockShape ?? 'unavailable' } : {}),
      ...(lockObservation === 'directory-present' ? { lockOwnerPendingComparison } : {}),
      outcome: 'unknown',
      next: 'explicit-owner-review-no-lock-stealing',
    }
  }
}

async function removeOwnedStage(
  root: string,
  record: PolicyRecord,
  staging: string | null,
  context: OperationContext,
  fence?: () => Promise<void>,
) {
  const path = stagePath(root)
  await verifyOperationLock(root, record.owner, context) // owner BEFORE inspecting/deleting staging
  check(context, path)
  let stat
  try {
    stat = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  if (
    !staging ||
    inode(stat) !== staging ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.mode & 0o077 ||
    bytesHash(await readPrivate(path, 65536)) !== record.identity.intendedBytes
  )
    throw Error('Exact policy staging identity changed')
  await fence?.()
  await verifyOperationLock(root, record.owner, context)
  const final = await lstat(path)
  if (inode(final) !== staging || !final.isFile() || final.nlink !== 1) throw Error('Policy staging replaced')
  check(context, path)
  await unlink(path)
}

async function cleanup(
  root: string,
  record: PolicyRecord,
  staging: string | null,
  context: OperationContext,
  fence?: () => Promise<void>,
) {
  await fence?.()
  const path = recordPath(root)
  if (!isDeepStrictEqual(parsePolicy(await readPrivate(path, 4096)), record))
    throw Error('Policy evidence changed before staging cleanup')
  await removeOwnedStage(root, record, staging, context, fence)
  await fence?.()
  if (!isDeepStrictEqual(parsePolicy(await readPrivate(path, 4096)), record))
    throw Error('Policy evidence changed')
  await verifyOperationLock(root, record.owner, context)
  check(context, path)
  await unlink(path)
  await fence?.()
  await releaseOperationLock(root, record.owner, context)
}

// A fresh normally-authorized primary call only removes retained owned files.
// No rename/reapply/revert, no old request context, no caller drain verdict.
export async function reconcileMemoryPolicy(
  engine: MemoryEngineController,
  context: OperationContext,
  target: string,
  expectedDigest: string,
) {
  if (context.admission) {
    if (context.admission.root !== engine.root) throw Error('Memory admission root mismatch')
    return await context.admission.run(
      () => reconcilePolicyAdmitted(engine, context, target, expectedDigest),
      context,
    )
  }
  return await reconcilePolicyAdmitted(engine, context, target, expectedDigest)
}
async function reconcilePolicyAdmitted(
  engine: MemoryEngineController,
  context: OperationContext,
  target: string,
  expectedDigest: string,
) {
  if (!uuidPattern.test(target) || !hash(expectedDigest)) throw Error('Typed policy target/digest required')
  const release = context.hold?.({ policyRecovery: randomUUID() })
  try {
    await context.barrier?.()
    const { record, reference } = await evidence(engine.root, context)
    if (record.identity.operation !== target || record.identity.digest !== expectedDigest)
      throw Error('Policy reconciliation binding mismatch')
    return await recoverPolicy(engine.root, reference, async () => {
      await context.barrier?.()
      // Reconciliation only inspects retained owner evidence; the hard ceiling permits
      // cleanup after a capacity upgrade even when the old config cannot certify HEAD.
      const status = await engine.request('upgradePreflight', {}, context)
      const actual = await observed(engine, context, record.identity)
      if (status.revision !== record.identity.revision || actual.outcome === 'unknown')
        throw Error('Policy reconciliation HEAD/config changed; retain evidence')
      await context.barrier?.()
      // Fresh current branch and exact physical authority, never the cancelled request's context.
      const latest = await evidence(engine.root, context)
      if (latest.reference !== reference) throw Error('Policy executor changed')
      const config = await readPrivate(join(engine.root, 'config.json'), 65536)
      if (![record.identity.originalBytes, record.identity.intendedBytes].includes(bytesHash(config)))
        throw Error('Policy reconciliation config bytes changed')
      await cleanup(engine.root, record, reference.staging, context, async () => {
        await context.barrier?.()
        if (
          (await engine.request('upgradePreflight', {}, context)).revision !== record.identity.revision ||
          (await observed(engine, context, record.identity)).outcome === 'unknown'
        )
          throw Error('Policy reconciliation state changed during cleanup; retain remaining evidence')
        await context.barrier?.()
        assertCurrent(context)
      })
      forgetPolicy(engine.root, target)
      assertCurrent(context)
      return {
        policy: 'reconciled',
        target,
        digest: expectedDigest,
        ...actual,
        lockRetained: false,
        configChanged: false,
        contextActivation: 'next-primary-request',
      }
    })
  } finally {
    release?.()
  }
}

// Explicit primary action only. The ignored config owns automatic admission;
// same root lock and HEAD/config CAS, no Git/corpus publication or grants.
function nextPolicyConfig(
  config: MemoryConfig,
  automatic: boolean,
  reflection?: { trigger: ReflectionTrigger; stepCount: number },
): MemoryConfig {
  if (reflection) {
    if (!validReflectionTrigger(reflection.trigger) || !validReflectionStepCount(reflection.stepCount))
      throw Error('Explicit reflection trigger and positive step count required')
    if (automatic !== automaticForTrigger(reflection.trigger))
      throw Error('Reflection trigger and automatic policy disagree')
    return {
      version: 2,
      projects: config.projects,
      coreBytes: config.coreBytes,
      indexBytes: config.indexBytes,
      fileBytes: config.fileBytes,
      totalBytes: config.totalBytes,
      automatic,
      reflectionTrigger: reflection.trigger,
      reflectionStepCount: reflection.stepCount,
    }
  }
  if (config.version === 2 && config.reflectionTrigger && config.reflectionStepCount) {
    const trigger: ReflectionTrigger = automatic
      ? config.reflectionTrigger === 'off'
        ? 'step-count'
        : config.reflectionTrigger
      : 'off'
    return {
      version: 2,
      projects: config.projects,
      coreBytes: config.coreBytes,
      indexBytes: config.indexBytes,
      fileBytes: config.fileBytes,
      totalBytes: config.totalBytes,
      automatic,
      reflectionTrigger: trigger,
      reflectionStepCount: config.reflectionStepCount,
    }
  }
  return { ...config, automatic }
}

// Upgrade only the established canonical capacity floor and optional cwd registration.
// It uses the policy owner's durable lock, CAS and retained-evidence reconciliation.
export async function upgradeMemoryConfig(
  engine: MemoryEngineController,
  context: OperationContext,
  revision: string,
  configHash: string,
  project?: { cwd: string; id: string },
) {
  const run = () =>
    setPolicyAdmitted(engine, context, revision, configHash, undefined, undefined, project, true)
  if (context.admission) {
    if (context.admission.root !== engine.root) throw Error('Memory admission root mismatch')
    return await context.admission.run(run, context)
  }
  return await run()
}

export async function setMemoryAutomatic(
  engine: MemoryEngineController,
  context: OperationContext,
  revision: string,
  configHash: string,
  automatic: boolean,
  reflection?: { trigger: ReflectionTrigger; stepCount: number },
) {
  if (context.admission) {
    if (context.admission.root !== engine.root) throw Error('Memory admission root mismatch')
    return await context.admission.run(
      () => setPolicyAdmitted(engine, context, revision, configHash, automatic, reflection),
      context,
    )
  }
  return await setPolicyAdmitted(engine, context, revision, configHash, automatic, reflection)
}
async function setPolicyAdmitted(
  engine: MemoryEngineController,
  context: OperationContext,
  revision: string,
  configHash: string,
  automatic: boolean | undefined,
  reflection?: { trigger: ReflectionTrigger; stepCount: number },
  project?: { cwd: string; id: string },
  upgrade = false,
) {
  if (!revisionPattern.test(revision) || !hash(configHash) || (!upgrade && typeof automatic !== 'boolean'))
    throw Error('Current memory revision/configHash and explicit automatic policy required')
  const root = engine.root
  const path = join(root, 'config.json')
  const temporary = stagePath(root)
  const release = context.hold?.({ policy: randomUUID() })
  try {
    check(context, path)
    await context.barrier?.()
    const original = await readPrivate(path, 65536)
    const config = parseConfig(original.toString('utf8'))
    if (digest(JSON.stringify(config)) !== configHash) throw Error('Memory policy CAS conflict')
    const next = upgrade
      ? {
          ...config,
          coreBytes: Math.max(config.coreBytes, 32768),
          indexBytes: Math.max(config.indexBytes, 8192),
          fileBytes: Math.max(config.fileBytes, 262144),
          totalBytes: Math.max(config.totalBytes, 8388608),
          ...(project
            ? { projects: [...config.projects.filter((entry) => entry.cwd !== project.cwd), project] }
            : {}),
        }
      : nextPolicyConfig(config, automatic as boolean, reflection)
    const text = `${JSON.stringify(next)}\n`
    const binding = {
      root,
      rootIdentity: await rootIdentity(root, context),
      operation: randomUUID(),
      nonce: randomUUID(),
      revision,
      originalHash: configHash,
      intendedHash: digest(JSON.stringify(next)),
      originalBytes: bytesHash(original),
      intendedBytes: digest(text),
      automatic: next.automatic,
      ...(next.version === 2
        ? { reflectionTrigger: next.reflectionTrigger, reflectionStepCount: next.reflectionStepCount }
        : {}),
    }
    const identity = Object.freeze({ ...binding, digest: digest(JSON.stringify(binding)) })
    // Registration precedes the first async acquisition; missing/incomplete owner remains unknown.
    return await executePolicy(
      root,
      identity,
      async (update: (owner: LockOwner, staging: string | null) => void) => {
        let record: PolicyRecord | undefined
        let staging: string | null = null
        try {
          const owner = await acquireOperationLock(
            root,
            identity.operation,
            identity.digest,
            identity.nonce,
            context,
          )
          update(owner, staging)
          record = { version: next.version === 2 ? 2 : 1, kind: 'policy', identity, owner }
          await writeRecord(root, record, context)
          await context.barrier?.()
          const status = await engine.request(upgrade ? 'upgradePreflight' : 'status', {}, context)
          const current = await engine.request('config', {}, context)
          if (status.revision !== revision || current.configHash !== configHash)
            throw Error('Memory policy CAS conflict; read current status')
          if (upgrade && status.pendingOperations.length)
            throw Error('Pending memory operations prevent configuration upgrade')
          await safePath(temporary)
          check(context, path, temporary)
          const fd = await open(
            temporary,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            0o600,
          )
          try {
            staging = inode(await fd.stat())
            update(owner, staging)
            check(context, temporary)
            await fd.writeFile(text)
            check(context, temporary)
            await fd.sync()
          } finally {
            await fd.close()
          }
          await context.barrier?.()
          const beforePublication = await engine.request(upgrade ? 'upgradePreflight' : 'status', {}, context)
          if (
            beforePublication.revision !== revision ||
            (await engine.request('config', {}, context)).configHash !== configHash
          )
            throw Error('Memory policy state changed before publication')
          if (upgrade && beforePublication.pendingOperations.length)
            throw Error('Pending memory operations prevent configuration upgrade')
          await context.barrier?.()
          check(context, path, temporary)
          if (!(await readPrivate(path, 65536)).equals(original))
            throw Error('Memory policy changed before publication')
          if (bytesHash(await readPrivate(temporary, 65536)) !== identity.intendedBytes)
            throw Error('Policy staged bytes changed before publication')
          await verifyOperationLock(root, owner, context)
          const stat = await lstat(temporary)
          if (inode(stat) !== staging || !stat.isFile() || stat.nlink !== 1)
            throw Error('Policy staging replaced')
          if (upgrade) {
            const final = await engine.request('upgradePreflight', {}, context)
            if (
              final.revision !== revision ||
              final.configHash !== configHash ||
              final.pendingOperations.length
            )
              throw Error('Memory upgrade state changed before publication')
            await verifyOperationLock(root, owner, context)
          }
          check(context, path, temporary) // synchronous final admission directly before native rename
          await rename(temporary, path)
          check(context, path)
          const directory = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW)
          try {
            check(context, root)
            await directory.sync()
          } finally {
            await directory.close()
          }
          await context.barrier?.()
          assertCurrent(context)
          return {
            revision,
            configHash: identity.intendedHash,
            automatic: next.automatic,
            contextActivation: 'next-primary-request',
            permissionsChanged: false,
          }
        } finally {
          // No cancellation bypass: loss retains files. executePolicy seals only after this joins.
          if (record) {
            await cleanup(root, record, staging, context)
            forgetPolicy(root, identity.operation)
          }
        }
      },
    )
  } finally {
    release?.()
  }
}
