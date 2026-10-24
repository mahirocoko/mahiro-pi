import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { constants } from 'node:fs'
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { digest, objectShape } from '../../continuity/records.ts'
import { parseConfig, revisionPattern, uuidPattern } from './schema.ts'
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
  digest: string
}
interface PolicyRecord {
  version: 1
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

function parsePolicy(raw: Buffer): PolicyRecord {
  const value = JSON.parse(raw.toString('utf8'))
  if (
    !objectShape(value, ['version', 'kind', 'identity', 'owner']) ||
    Object.keys(value).length !== 4 ||
    value.version !== 1 ||
    value.kind !== 'policy' ||
    !objectShape(value.identity, [
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
    ]) ||
    Object.keys(value.identity).length !== 11
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

// Diagnostic disk evidence NEVER proves quiescence. Unknown/non-policy locks are retained.
export async function memoryPolicyStatus(engine: MemoryEngineController, context: OperationContext) {
  try {
    check(context, join(engine.root, '.lock'))
    try {
      await lstat(join(engine.root, '.lock'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      assertCurrent(context)
      return { state: 'idle', lockRetained: false, next: 'none' }
    }
    const { record, reference } = await evidence(engine.root, context)
    const actual = await observed(engine, context, record.identity)
    const available =
      !reference.drained || reference.recovering
        ? false
        : actual.outcome !== 'unknown' &&
          (await engine.request('status', {}, context)).revision === record.identity.revision &&
          (await stagingMatches(engine.root, record, reference.staging, context))
    const state =
      !reference.drained || reference.recovering
        ? 'active/draining'
        : available
          ? 'retained+recoverable'
          : 'unknown/unavailable'
    assertCurrent(context)
    return {
      state,
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
    assertCurrent(context)
    return {
      state: 'unknown/unavailable',
      lockRetained: true,
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
  if (!uuidPattern.test(target) || !hash(expectedDigest)) throw Error('Typed policy target/digest required')
  const release = context.hold?.({ policyRecovery: randomUUID() })
  try {
    await context.barrier?.()
    const { record, reference } = await evidence(engine.root, context)
    if (record.identity.operation !== target || record.identity.digest !== expectedDigest)
      throw Error('Policy reconciliation binding mismatch')
    return await recoverPolicy(engine.root, reference, async () => {
      await context.barrier?.()
      const status = await engine.request('status', {}, context)
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
          (await engine.request('status', {}, context)).revision !== record.identity.revision ||
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
export async function setMemoryAutomatic(
  engine: MemoryEngineController,
  context: OperationContext,
  revision: string,
  configHash: string,
  automatic: boolean,
) {
  if (!revisionPattern.test(revision) || !hash(configHash) || typeof automatic !== 'boolean')
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
    const next = { ...config, automatic }
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
      automatic,
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
          record = { version: 1, kind: 'policy', identity, owner }
          await writeRecord(root, record, context)
          await context.barrier?.()
          const status = await engine.request('status', {}, context)
          const current = await engine.request('config', {}, context)
          if (status.revision !== revision || current.configHash !== configHash)
            throw Error('Memory policy CAS conflict; read current status')
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
          if (
            (await engine.request('status', {}, context)).revision !== revision ||
            (await engine.request('config', {}, context)).configHash !== configHash
          )
            throw Error('Memory policy state changed before publication')
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
            automatic,
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
