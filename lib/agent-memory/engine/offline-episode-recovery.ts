import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryEngineController, OperationContext } from './controller.ts'
import { episodeMutex, episodeRecovery, inode } from './episode-admission.ts'
import { privateDirectory, safePath } from './io.ts'
import { withExecutionOwner } from './offline-draft-archive.ts'
import {
  durableJSON,
  gate,
  inspectHolders,
  maintenanceMarker,
  makeDirectory,
  offlineAssurance,
  present,
  read,
  syncDirectory,
  type MaintenanceRequest,
} from './offline-maintenance.ts'

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const canonical = /^[a-f0-9]{64}\.json$/
const temporary = /^([a-f0-9]{64})\.json\.[a-f0-9-]{36}\.tmp$/
const completed = /^\.admission-recovered-[a-f0-9]{64}$/
const digest = /^[a-f0-9]{64}$/
interface File {
  name: string
  inode: string
  mode: number
  size: number
  mtime: number
  links: number
  hash: string
}
interface Review {
  version: 1
  root: string
  folder: string
  lock: { inode: string; owner: File | null } | null
  files: File[]
  recovery: { inode: string; files: File[] } | null
}
interface Plan {
  version: 1
  revision: string
  review: Review
  recovery: string
}
const workPath = (root: string) => join(root, episodeRecovery)
const savedPath = (root: string, revision: string) =>
  join(root, '.episodes', `.admission-recovered-${revision}`)

// Unlike generic offline inventory this recognizes ONLY confined episode temp/published
// pairs. No arbitrary hardlink, symlink, unknown entry, recursive corpus read or private reply.
async function file(path: string, name: string, context: OperationContext, max = 16384): Promise<File> {
  await gate(context, [path])
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    await gate(context, [path])
    const before = await fd.stat()
    if (!before.isFile() || before.mode & 0o077 || before.size > max || before.nlink > 2)
      throw Error('Episode recovery unsafe file or bound')
    const buffer = Buffer.alloc(max + 1)
    let length = 0
    while (length < buffer.length) {
      await gate(context, [path])
      const { bytesRead } = await fd.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    const bytes = buffer.subarray(0, length)
    await gate(context, [path])
    const after = await fd.stat()
    if (
      bytes.length !== before.size ||
      inode(before) !== inode(after) ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.nlink !== after.nlink
    )
      throw Error('Episode recovery file changed')
    return {
      name,
      inode: inode(before),
      mode: before.mode,
      size: before.size,
      mtime: before.mtimeMs,
      links: before.nlink,
      hash: hash(bytes),
    }
  } finally {
    await fd.close()
  }
}
const sameFile = (a: File, b: File, links = true) =>
  a.inode === b.inode &&
  a.mode === b.mode &&
  a.size === b.size &&
  a.mtime === b.mtime &&
  a.hash === b.hash &&
  (!links || a.links === b.links)
async function directory(path: string, context: OperationContext) {
  await gate(context, [path])
  await privateDirectory(path)
  return inode(await lstat(path))
}
async function names(path: string, max: number, context: OperationContext) {
  await gate(context, [path])
  // A directory entry bound is checked during enumeration, not after an unbounded allocation.
  const entries: string[] = []
  const stream = await opendir(path)
  for await (const entry of stream) {
    if (entries.length >= max) throw Error('Episode recovery entry bound')
    entries.push(entry.name)
  }
  return entries.sort()
}
async function review(root: string, context: OperationContext): Promise<Review> {
  await gate(context, [root, join(root, '.episodes'), join(root, maintenanceMarker)])
  await safePath(root)
  if (await present(join(root, maintenanceMarker), context)) throw Error('Other offline maintenance pending')
  const result: Review = {
    version: 1,
    root: await directory(root, context),
    folder: await directory(join(root, '.episodes'), context),
    lock: null,
    files: [],
    recovery: null,
  }
  const all = await names(join(root, '.episodes'), 548, context)
  let archives = 0
  for (const name of all) {
    const path = join(root, '.episodes', name)
    if (name === '.admission') {
      const id = await directory(path, context)
      const children = await names(path, 1, context)
      if (children.some((name) => name !== 'owner.json')) throw Error('Episode recovery ambiguous lock')
      const owner = children.length ? await file(join(path, 'owner.json'), 'owner.json', context) : null
      if (owner && owner.links !== 1) throw Error('Episode recovery linked owner')
      result.lock = { inode: id, owner }
    } else if (name === '.admission-recovery') {
      const id = await directory(path, context)
      const children = await names(path, 16, context)
      if (children.length >= 16) throw Error('Episode recovery incomplete checkpoint residue bound')
      if (children.some((name) => !/^write-[a-f0-9-]{36}\.partial$/.test(name)))
        throw Error('Episode recovery incomplete checkpoint ambiguous')
      const files = []
      for (const name of children) {
        const entry = await file(join(path, name), name, context, 256 * 1024)
        if (entry.links !== 1) throw Error('Episode recovery linked checkpoint')
        files.push(entry)
      }
      result.recovery = { inode: id, files }
    } else if (completed.test(name)) {
      if (++archives > 32) throw Error('Episode recovery quarantine capacity')
      await directory(path, context)
    } else if (canonical.test(name) || temporary.test(name))
      result.files.push(await file(path, name, context))
    else throw Error('Episode recovery unknown entry')
  }
  if (archives >= 32) throw Error('Episode recovery quarantine capacity')
  if (
    result.files.filter((f) => canonical.test(f.name)).length > 256 ||
    result.files.filter((f) => temporary.test(f.name)).length > 256
  )
    throw Error('Episode recovery file capacity')
  for (const entry of result.files) {
    const peers = result.files.filter((f) => f.inode === entry.inode)
    if (entry.links === 1 && peers.length === 1) continue
    if (entry.links !== 2 || peers.length !== 2)
      throw Error('Episode recovery external or ambiguous hardlink')
    const temp = peers.find((f) => temporary.test(f.name))
    const target = peers.find((f) => canonical.test(f.name))
    if (
      !temp ||
      !target ||
      temporary.exec(temp.name)![1] + '.json' !== target.name ||
      temp.hash !== target.hash
    )
      throw Error('Episode recovery hardlink identity mismatch')
  }
  if (!result.lock && !result.files.some((f) => temporary.test(f.name)) && !result.recovery)
    throw Error('Episode admission residue absent; no recovery needed')
  return result
}
function parsePlan(raw: string): Plan {
  const plan = JSON.parse(raw) as Plan
  // Re-serialization plus checksum binds every field to the reviewed metadata. No plan paths
  // are accepted until this strict grammar check; identities are checked again against Root.
  if (
    plan.version !== 1 ||
    !digest.test(plan.revision) ||
    hash(JSON.stringify(plan.review)) !== plan.revision ||
    typeof plan.recovery !== 'string' ||
    !/^\d+:\d+$/.test(plan.recovery)
  )
    throw Error('Episode recovery checkpoint invalid')
  const r = plan.review
  if (
    r.version !== 1 ||
    !/^\d+:\d+$/.test(r.root) ||
    !/^\d+:\d+$/.test(r.folder) ||
    !Array.isArray(r.files) ||
    r.files.length > 512 ||
    r.files.some((f) => !canonical.test(f.name) && !temporary.test(f.name))
  )
    throw Error('Episode recovery plan invalid')
  if (new Set(r.files.map((f) => f.name)).size !== r.files.length)
    throw Error('Episode recovery duplicate plan')
  if (r.lock && (!/^\d+:\d+$/.test(r.lock.inode) || (r.lock.owner && r.lock.owner.name !== 'owner.json')))
    throw Error('Episode recovery lock plan invalid')
  return plan
}
async function load(root: string, work: string, context: OperationContext) {
  return parsePlan(await read(root, `${work.slice(root.length + 1)}/plan.json`, 256 * 1024, context))
}
async function rootFence(root: string, plan: Plan, work: string, context: OperationContext) {
  if (
    (await directory(root, context)) !== plan.review.root ||
    (await directory(join(root, '.episodes'), context)) !== plan.review.folder ||
    (await directory(work, context)) !== plan.recovery
  )
    throw Error('Episode recovery exact Root/checkpoint changed')
  if (await present(join(root, maintenanceMarker), context)) throw Error('Other offline maintenance pending')
}
async function lockFence(root: string, plan: Plan, work: string, context: OperationContext) {
  const source = join(root, episodeMutex)
  const saved = join(work, 'lock')
  const atSource = await present(source, context)
  const atSaved = await present(saved, context)
  if (!plan.review.lock) {
    if (atSource || atSaved) throw Error('Episode recovery unexpected lock')
    return
  }
  if (atSource === atSaved) throw Error('Episode recovery lock absent or ambiguous')
  const path = atSource ? source : saved
  if ((await directory(path, context)) !== plan.review.lock.inode)
    throw Error('Episode recovery lock identity changed')
  const children = await names(path, 1, context)
  const owner = plan.review.lock.owner
  if (
    children.join() !== (owner ? 'owner.json' : '') ||
    (owner && !sameFile(await file(join(path, 'owner.json'), 'owner.json', context), owner))
  )
    throw Error('Episode recovery lock evidence changed')
}
async function quiescent(root: string, engine: MemoryEngineController, context: OperationContext) {
  if (engine.queueSize) throw Error('Episode recovery requires idle offline controller')
  // Unlike publication certification, episode recovery never needs an active data child.
  // Do not exempt even this controller's actual child if it holds the episode directory.
  await inspectHolders(root, engine, context, false)
  if (engine.queueSize) throw Error('Episode recovery requires idle offline controller')
}
async function finish(root: string, plan: Plan, engine: MemoryEngineController, context: OperationContext) {
  const work = workPath(root)
  await rootFence(root, plan, work, context)
  await quiescent(root, engine, context)
  // Interrupted copies/checkpoint writes are retained, never blindly unlinked. Bound
  // the retry residue too; exhaustion is an operator HOLD, not permission to prune.
  const workNames = await names(work, 292, context)
  let partials = 0
  const temps = new Set(plan.review.files.filter((f) => temporary.test(f.name)).map((f) => f.name))
  for (const name of workNames) {
    if (name === 'plan.json' || name === 'lock' || temps.has(name)) continue
    if (!/^(?:copy|write)-[a-f0-9-]{36}\.partial$/.test(name) || ++partials > 32)
      throw Error('Episode recovery checkpoint ambiguity or residue bound')
    if ((await file(join(work, name), name, context, 256 * 1024)).links !== 1)
      throw Error('Episode recovery linked partial')
  }
  if (partials >= 32) throw Error('Episode recovery checkpoint residue bound')
  await lockFence(root, plan, work, context)
  const expected = new Set(plan.review.files.map((f) => f.name))
  for (const name of await names(join(root, '.episodes'), 548, context))
    if (
      name !== '.admission' &&
      name !== '.admission-recovery' &&
      !completed.test(name) &&
      !expected.has(name)
    )
      throw Error('Episode recovery new or unknown entry')
  // Copy each temp to a NEW private inode and sync it before removing its exact original link.
  // Moving a hardlink alone would leave the acknowledged canonical episode unreadable (nlink=2).
  for (const entry of plan.review.files.filter((f) => temporary.test(f.name))) {
    await rootFence(root, plan, work, context)
    const source = join(root, '.episodes', entry.name)
    const saved = join(work, entry.name)
    const atSource = await present(source, context)
    if (atSource && !sameFile(await file(source, entry.name, context), entry))
      throw Error('Episode recovery temp changed')
    if (!(await present(saved, context))) {
      if (!atSource) throw Error('Episode recovery temp lost; preserve checkpoint')
      await gate(context, [source, saved])
      const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
      let bytes: Buffer
      try {
        const buffer = Buffer.alloc(16385)
        let length = 0
        while (length < buffer.length) {
          await gate(context, [source])
          const { bytesRead } = await input.read(buffer, length, buffer.length - length, null)
          if (!bytesRead) break
          length += bytesRead
        }
        bytes = buffer.subarray(0, length)
      } finally {
        await input.close()
      }
      if (bytes.length !== entry.size || hash(bytes) !== entry.hash)
        throw Error('Episode recovery temp changed')
      const partial = join(work, `copy-${randomUUID()}.partial`)
      await gate(context, [partial])
      const output = await open(
        partial,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
      try {
        await gate(context, [partial])
        await output.writeFile(bytes)
        await gate(context, [partial])
        await output.sync()
      } finally {
        await output.close()
      }
      await gate(context, [partial, saved])
      await rename(partial, saved)
      await syncDirectory(work, context)
    }
    const archived = await file(saved, entry.name, context)
    if (archived.hash !== entry.hash || archived.size !== entry.size || archived.links !== 1)
      throw Error('Episode recovery archive bytes mismatch')
    // Also required on resume after rename but before the original directory sync.
    await syncDirectory(work, context)
    if (atSource) {
      await gate(context, [source])
      if (!sameFile(await file(source, entry.name, context), entry))
        throw Error('Episode recovery temp changed')
      await gate(context, [source])
      await unlink(source)
      await syncDirectory(join(root, '.episodes'), context)
    }
  }
  for (const entry of plan.review.files.filter((f) => canonical.test(f.name))) {
    const actual = await file(join(root, '.episodes', entry.name), entry.name, context)
    if (!sameFile(actual, entry, false) || actual.links !== 1)
      throw Error('Episode recovery canonical episode changed')
  }
  await rootFence(root, plan, work, context)
  await lockFence(root, plan, work, context)
  if (plan.review.lock && (await present(join(root, episodeMutex), context))) {
    await gate(context, [join(root, episodeMutex), join(work, 'lock')])
    await rename(join(root, episodeMutex), join(work, 'lock'))
    await syncDirectory(work, context)
    await syncDirectory(join(root, '.episodes'), context)
  }
  await rootFence(root, plan, work, context)
  await syncDirectory(work, context)
  await syncDirectory(join(root, '.episodes'), context)
  const destination = savedPath(root, plan.revision)
  if (await present(destination, context)) throw Error('Episode recovery quarantine destination exists')
  await gate(context, [work, destination])
  await rename(work, destination)
  await syncDirectory(join(root, '.episodes'), context)
  return receipt(plan, 'completed')
}
function receipt(plan: Plan, phase: 'prepared' | 'completed') {
  return {
    kind: 'episode-admission-recovery',
    target: plan.revision,
    revision: plan.revision,
    phase,
    episodes: plan.review.files.filter((f) => canonical.test(f.name)).length,
    temporaries: plan.review.files.filter((f) => temporary.test(f.name)).length,
    corpusReturned: false,
    hostileProcessGuarantee: false,
    next: phase === 'prepared' ? 'explicit-reviewed-offline-episode-resume' : 'ordinary-episode-admission',
  }
}
export async function episodeRecoveryMaintenance(
  engine: MemoryEngineController,
  context: OperationContext,
  request: MaintenanceRequest,
) {
  if (!request.action.startsWith('offline-episode-')) return undefined
  return await withExecutionOwner(engine.root, context, async () => {
    const root = engine.root
    const work = workPath(root)
    await gate(context, [root, work, join(work, 'plan.json')])
    let plan: Plan | undefined
    if (await present(join(work, 'plan.json'), context)) plan = await load(root, work, context)
    if (plan) {
      await rootFence(root, plan, work, context)
      if (request.action === 'offline-episode-inspect') {
        await quiescent(root, engine, context)
        return receipt(plan, 'prepared')
      }
      if (
        request.action !== 'offline-episode-resume' ||
        request.target !== plan.revision ||
        request.revision !== plan.revision ||
        request.offline !== offlineAssurance
      )
        throw Error('Explicit reviewed episode recovery resume required')
      return await finish(root, plan, engine, context)
    }
    if (request.action === 'offline-episode-resume') {
      if (
        !digest.test(request.target ?? '') ||
        request.revision !== request.target ||
        request.offline !== offlineAssurance
      )
        throw Error('Exact episode recovery checkpoint required')
      const saved = savedPath(root, request.target!)
      plan = await load(root, saved, context)
      if (plan.revision !== request.target) throw Error('Episode recovery checkpoint mismatch')
      await rootFence(root, plan, saved, context)
      await quiescent(root, engine, context)
      await syncDirectory(saved, context)
      await syncDirectory(join(root, '.episodes'), context)
      return receipt(plan, 'completed')
    }
    const reviewed = await review(root, context)
    const revision = hash(JSON.stringify(reviewed))
    await quiescent(root, engine, context)
    if (request.action === 'offline-episode-inspect')
      return {
        kind: 'episode-admission-recovery',
        target: revision,
        revision,
        phase: 'reviewed',
        episodes: reviewed.files.filter((f) => canonical.test(f.name)).length,
        temporaries: reviewed.files.filter((f) => temporary.test(f.name)).length,
        anonymousLock: !!reviewed.lock && !reviewed.lock.owner,
        corpusReturned: false,
        hostileProcessGuarantee: false,
        next: 'explicit-reviewed-offline-episode-recover',
      }
    if (
      request.action !== 'offline-episode-recover' ||
      request.target !== revision ||
      request.revision !== revision ||
      request.offline !== offlineAssurance
    )
      throw Error('Exact reviewed episode recovery and offline assurance required')
    if (hash(JSON.stringify(await review(root, context))) !== revision)
      throw Error('Episode recovery review changed')
    await makeDirectory(work, context)
    plan = { version: 1, revision, review: reviewed, recovery: await directory(work, context) }
    await durableJSON(join(work, 'plan.json'), plan, context)
    return await finish(root, plan, engine, context)
  })
}
