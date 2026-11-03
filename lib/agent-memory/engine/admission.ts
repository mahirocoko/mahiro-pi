import { randomUUID } from 'node:crypto'
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
} from 'node:fs'
import { lstat, mkdir, open, rename } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { objectShape } from '../../continuity/records.ts'
import type { OperationContext } from './controller.ts'
import { privateDirectory, safePath } from './io.ts'
import { MemoryLifetime } from './lifetime.ts'
import { uuidPattern } from './schema.ts'

const { registerParticipant, memoryParticipant } = createRequire(import.meta.url)(
  './admission-participants.mjs',
) as typeof import('./admission-participants.mjs')

export const admissionDirectory = '.views/.admission-v1'
const stateName = 'state.json'
const maximum = 64
const bound = 64 * 1024
const inode = (s: { dev: number; ino: number }) => `${s.dev}:${s.ino}`
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  objectShape(value, keys) && Object.keys(value).length === keys.length
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && uuidPattern.test(v)
export interface BarrierTarget {
  id: string
  digest: string
}
export interface AdmissionBarrier {
  id: string
  epoch: number
  target: BarrierTarget
}
interface ParticipantRecord {
  id: string
  epoch: number
  acknowledgement: string | null
}
interface AdmissionState {
  version: 1
  root: string
  rootIdentity: string
  epoch: number
  barrier: AdmissionBarrier | null
  participants: ParticipantRecord[]
}
export interface MemoryAdmission {
  readonly root: string
  run<T>(start: () => Promise<T>, context?: OperationContext): Promise<T>
  assertCurrent(context?: OperationContext): void
  retire(): Promise<void>
}
function authority(root: string, context: OperationContext, paths: string[] = []) {
  context.signal?.throwIfAborted()
  if (resolve(root) !== root || realpathSync(root) !== root)
    throw Error('Canonical memory admission root required')
  if (
    context.current({
      kind: 'data',
      physical: [
        root,
        join(root, '.views'),
        join(root, admissionDirectory),
        join(root, admissionDirectory, stateName),
        ...paths,
      ],
      logical: [],
    }) !== true
  )
    throw Error('Current exact-root admission authority required')
}
function rootIdentity(root: string) {
  const s = lstatSync(root)
  if (!s.isDirectory() || s.isSymbolicLink() || s.mode & 0o077)
    throw Error('Private memory admission root required')
  return inode(s)
}
function load(root: string, context: OperationContext): AdmissionState {
  authority(root, context)
  const folder = join(root, admissionDirectory)
  for (const path of [join(root, '.views'), folder]) {
    const s = lstatSync(path)
    if (!s.isDirectory() || s.isSymbolicLink() || s.mode & 0o077)
      throw Error('Private memory admission storage required')
  }
  const fd = openSync(join(folder, stateName), constants.O_RDONLY | constants.O_NOFOLLOW)
  let value: unknown
  try {
    const before = fstatSync(fd)
    if (!before.isFile() || before.nlink !== 1 || before.mode & 0o077 || before.size > bound)
      throw Error('Memory admission state unavailable; offline fallback required')
    const raw = readFileSync(fd)
    const after = fstatSync(fd)
    if (raw.length > bound || before.size !== after.size || before.ctimeMs !== after.ctimeMs)
      throw Error('Memory admission state changed')
    value = JSON.parse(raw.toString('utf8'))
  } finally {
    closeSync(fd)
  }
  if (
    !exact(value, ['version', 'root', 'rootIdentity', 'epoch', 'barrier', 'participants']) ||
    value.version !== 1 ||
    value.root !== root ||
    value.rootIdentity !== rootIdentity(root) ||
    !Number.isSafeInteger(value.epoch) ||
    (value.epoch as number) < 0 ||
    !Array.isArray(value.participants) ||
    value.participants.length > maximum ||
    value.participants.some(
      (p: unknown) =>
        !exact(p, ['id', 'epoch', 'acknowledgement']) ||
        !uuid(p.id) ||
        !Number.isSafeInteger(p.epoch) ||
        (p.epoch as number) < 0 ||
        (p.epoch as number) > (value.epoch as number) ||
        !(p.acknowledgement === null || uuid(p.acknowledgement)),
    ) ||
    new Set(value.participants.map((p) => p.id)).size !== value.participants.length
  )
    throw Error('Malformed memory admission participants; offline fallback required')
  if (value.barrier !== null) {
    const b = value.barrier
    if (
      !exact(b, ['id', 'epoch', 'target']) ||
      !uuid(b.id) ||
      b.epoch !== value.epoch ||
      !exact(b.target, ['id', 'digest']) ||
      !uuid(b.target.id) ||
      !sha(b.target.digest)
    )
      throw Error('Malformed memory admission barrier; offline fallback required')
  }
  return value as unknown as AdmissionState
}
async function sync(path: string, root: string, context: OperationContext) {
  authority(root, context, [path])
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    await fd.sync()
  } finally {
    await fd.close()
  }
}
async function save(root: string, context: OperationContext, state: AdmissionState) {
  const folder = join(root, admissionDirectory)
  const temp = join(folder, `${randomUUID()}.tmp`)
  authority(root, context, [temp])
  const fd = await open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    authority(root, context, [temp])
    await fd.writeFile(`${JSON.stringify(state)}\n`)
    await fd.sync()
  } finally {
    await fd.close()
  }
  authority(root, context, [temp])
  await rename(temp, join(folder, stateName))
  await sync(folder, root, context)
}
// Exclusive native directory acquisition. No time/PID/metadata-based lock stealing.
// A crashed serialization turn is deliberately an offline-recovery boundary.
async function serialized<T>(
  root: string,
  context: OperationContext,
  create: boolean,
  turn: (state: AdmissionState) => Promise<T>,
) {
  authority(root, context)
  await privateDirectory(root)
  await privateDirectory(join(root, '.views'))
  const folder = join(root, admissionDirectory)
  await privateDirectory(folder, create)
  const lock = join(folder, 'turn')
  authority(root, context, [lock])
  await safePath(lock)
  authority(root, context, [lock])
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw Error('Memory admission turn busy or interrupted; no force unlock, retry or use offline fallback')
    throw error
  }
  const own = inode(await lstat(lock))
  const ownerRoot = rootIdentity(root)
  const ownerViews = inode(lstatSync(join(root, '.views')))
  const ownerFolder = inode(lstatSync(folder))
  try {
    let state: AdmissionState
    try {
      state = load(root, context)
    } catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      state = {
        version: 1,
        root,
        rootIdentity: rootIdentity(root),
        epoch: 0,
        barrier: null,
        participants: [],
      }
      await save(root, context, state)
    }
    return await turn(state)
  } finally {
    // Releasing our acquired turn is an ownership obligation, not new operation authority.
    // Cancellation must not strand it. Never remove a replacement or follow rebound parents;
    // keep the identity check and removal synchronous, with no cancellation/authority callback.
    if (
      realpathSync(root) !== root ||
      rootIdentity(root) !== ownerRoot ||
      inode(lstatSync(join(root, '.views'))) !== ownerViews ||
      inode(lstatSync(folder)) !== ownerFolder ||
      inode(lstatSync(lock)) !== own
    )
      throw Error('Memory admission turn identity changed')
    const fd = openSync(folder, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      if (inode(fstatSync(fd)) !== ownerFolder) throw Error('Memory admission turn identity changed')
      rmdirSync(lock)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }
}
const key = (state: AdmissionState, id: string) => `${state.root}:${state.rootIdentity}:${id}`

// Construction is IO-free. Registration is explicit/lazy and serialized with barrier publication.
// This protocol accounts only registered participants; it NEVER certifies a legacy/mixed cohort.
export function createMemoryAdmission(
  root: string,
  context: OperationContext,
  retireGeneration: () => Promise<void>,
): MemoryAdmission {
  const id = randomUUID()
  const lifetime = new MemoryLifetime()
  let registered: Promise<void> | undefined
  let epoch: number | undefined
  let retired = false
  let drain: Promise<void> | undefined
  const participant: MemoryAdmission = {
    root,
    run<T>(start: () => Promise<T>, current = context): Promise<T> {
      if (retired) return Promise.reject(Error('Memory admission retired'))
      registered ??= serialized(root, current, true, async (state) => {
        if (state.barrier || state.participants.length >= maximum)
          throw Error('Memory admission barrier or participant capacity; offline fallback required')
        epoch = state.epoch
        state.participants.push({ id, epoch, acknowledgement: null })
        registerParticipant(key(state, id), participant)
        await save(root, current, state)
      })
      return registered.then(() => {
        // Register -> reread. A barrier may win immediately after registration releases its turn.
        participant.assertCurrent(current)
        return lifetime.track(start)
      })
    },
    assertCurrent(current = context) {
      if (retired) throw Error('Memory admission retired')
      if (epoch === undefined) return // read-only/unregistered generation provisions nothing
      const state = load(root, current)
      if (
        state.barrier ||
        state.epoch !== epoch ||
        !state.participants.some((p) => p.id === id && p.epoch === epoch)
      )
        throw Error('Memory admission epoch/barrier retired')
    },
    retire() {
      if (drain) return drain
      retired = true // synchronous before invoking actual generation retirement
      let join: Promise<void>
      try {
        join = retireGeneration()
        if (!join || typeof join.then !== 'function') throw Error('Actual generation join required')
      } catch (error) {
        join = Promise.reject(error)
      }
      drain = (async () => {
        const results = await Promise.allSettled([join, lifetime.drain()])
        for (const result of results) if (result.status === 'rejected') throw result.reason
      })()
      return drain
    },
  }
  return participant
}
export async function beginMemoryBarrier(
  root: string,
  context: OperationContext,
  target: BarrierTarget,
): Promise<AdmissionBarrier> {
  if (!uuid(target.id) || !sha(target.digest)) throw Error('Exact memory operation target required')
  return await serialized(root, context, false, async (state) => {
    if (state.barrier) {
      if (state.barrier.target.id !== target.id || state.barrier.target.digest !== target.digest)
        throw Error('Memory admission barrier belongs to another operation')
      return state.barrier // explicit same-operation resume, never reopen old epoch
    }
    if (state.epoch >= Number.MAX_SAFE_INTEGER) throw Error('Memory admission epoch exhausted')
    const barrier = { id: randomUUID(), epoch: state.epoch + 1, target: { ...target } }
    state.epoch = barrier.epoch
    state.barrier = barrier
    await save(root, context, state)
    return barrier
  })
}
export async function joinMemoryBarrier(root: string, context: OperationContext, barrier: AdmissionBarrier) {
  const same = (state: AdmissionState) => {
    if (JSON.stringify(state.barrier) !== JSON.stringify(barrier))
      throw Error('Memory admission transaction changed')
  }
  // Barrier -> enumerate -> actual retire/join -> revalidate under serialization.
  const state = load(root, context)
  same(state)
  if (!state.participants.length) throw Error('Unaccounted memory owners; offline fallback required')
  const joins = state.participants.map((record) => {
    const participant = memoryParticipant(key(state, record.id)) as MemoryAdmission | undefined
    if (!participant)
      throw Error('Unsupported cross-process or legacy memory participant; offline fallback required')
    return participant.retire()
  })
  const results = await Promise.allSettled(joins)
  for (const result of results) if (result.status === 'rejected') throw result.reason
  await serialized(root, context, false, async (current) => {
    same(current)
    if (JSON.stringify(current.participants) !== JSON.stringify(state.participants))
      throw Error('Memory participant set changed during join')
    for (const record of current.participants) record.acknowledgement = barrier.id
    await save(root, context, current)
  })
  return { transaction: barrier.id, registeredParticipantsDrained: true, globalQuiescence: false } as const
}

// Admission-only cancellation: this slice never archives/quarantines. Reopening keeps
// old participant identities and epochs, so no old continuation can resurrect.
export async function cancelMemoryBarrier(
  root: string,
  context: OperationContext,
  barrier: AdmissionBarrier,
) {
  await serialized(root, context, false, async (state) => {
    if (JSON.stringify(state.barrier) !== JSON.stringify(barrier))
      throw Error('Exact memory admission transaction required')
    state.barrier = null
    await save(root, context, state)
  })
  return { state: 'cancelled', oldEpochReopened: false, mutationsPerformed: false } as const
}
