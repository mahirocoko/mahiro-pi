import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { assertCurrent, type MemoryEngineController, type OperationContext } from './controller.ts'
import { engineEnvironment, privateDirectory, readPrivate, runGit, safePath } from './io.ts'
import { operationLimit, parseLockOwner, parseOperation, type LockOwner } from './operation.ts'
import { parseDraft } from './manifest.ts'
import { limits, parseConfig, parseLedger, uuidPattern } from './schema.ts'

// Explicit cooperative offline adoption only. This is NOT executor drain or normal reconciliation.
export const maintenanceMarker = '.views/.maintenance-active.json'
export const offlineAssurance = 'known-profile-closed-no-cooperative-writers-start'
const container = '.views/.maintenance'
const journal = '.views/.engine-v2/journal'
const bounds = Object.freeze({ entries: 131072, bytes: 8 * 1024 * 1024 * 1024, file: 256 * 1024 * 1024 })
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
interface Entry {
  path: string
  kind: 'file' | 'directory'
  identity: string
  mode: number
  size: number
  hash?: string
}
interface Plan {
  version: 1
  id: string
  root: string
  entries: Entry[]
  head: string
  configSemantic: string
  owner: LockOwner
  operation: { immutableHash: string; sequence: number; view: string }
  outcome: 'unknown' | 'not_committed_dirty'
  moves: string[]
  worktree: { path: string; state: 'tracked' | 'untracked' }[]
  draft: string | null
  counts: { journal: number; drafts: number; legacyViews: number; staging: number; unknownAdmission: number }
}
interface State {
  version: 1
  phase: 'prepared' | 'archived' | 'quarantining' | 'completed'
  planHash: string
  disposition: 'manually-adopted-prior-outcome-unknown' | 'manually-recovered-not-committed-dirty'
}
export interface MaintenanceRequest {
  action: 'offline-inspect' | 'offline-adopt' | 'offline-resume'
  target?: string
  revision?: string
  offline?: string
}
const identity = (s: { dev: number; ino: number }) => `${s.dev}:${s.ino}`
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
async function present(path: string, context: OperationContext) {
  await gate(context, [path])
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (!missing(error)) throw error
    return false
  }
}
const within = (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`)
const validPath = (path: unknown): path is string =>
  typeof path === 'string' &&
  path.length <= 4096 &&
  (path === '.' ||
    (path.split('/').every((p) => p !== '' && p !== '.' && p !== '..') && !path.includes('\0')))
async function gate(context: OperationContext, paths: string[]) {
  for (let start = 0; start < Math.max(paths.length, 1); start += 32)
    assertCurrent(context, { physical: paths.slice(start, start + 32), logical: [], kind: 'data' })
}
async function syncDirectory(path: string, context: OperationContext) {
  await gate(context, [path])
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    await fd.sync()
  } finally {
    await fd.close()
  }
}
async function fileHash(path: string, context: OperationContext): Promise<{ hash: string; size: number }> {
  await gate(context, [path])
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await fd.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size > bounds.file)
      throw Error('Offline inventory unsafe file or resource bound')
    const digest = createHash('sha256')
    const buffer = Buffer.alloc(65536)
    let size = 0
    while (true) {
      await gate(context, [path])
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      size += bytesRead
      if (size > bounds.file) throw Error('Offline inventory file bound')
      digest.update(buffer.subarray(0, bytesRead))
    }
    const after = await fd.stat()
    if (
      identity(before) !== identity(after) ||
      before.size !== size ||
      after.size !== size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw Error('Offline file changed during hashing')
    return { hash: digest.digest('hex'), size }
  } finally {
    await fd.close()
  }
}
async function inventory(root: string, context: OperationContext, excluded: string[] = []): Promise<Entry[]> {
  await safePath(root)
  const entries: Entry[] = []
  const pending = ['.']
  let total = 0
  while (pending.length) {
    const path = pending.pop()!
    if (excluded.some((p) => within(path, p))) continue
    const physical = path === '.' ? root : join(root, path)
    await gate(context, [physical])
    const s = await lstat(physical)
    if (s.isSymbolicLink() || (!s.isFile() && !s.isDirectory()) || (s.isFile() && s.nlink !== 1))
      throw Error('Offline inventory refuses links or special files')
    const entry: Entry = {
      path,
      kind: s.isDirectory() ? 'directory' : 'file',
      identity: identity(s),
      mode: s.mode & 0o777,
      size: 0,
    }
    if (s.isFile()) {
      Object.assign(entry, await fileHash(physical, context))
      total += entry.size
      if (total > bounds.bytes) throw Error('Offline inventory byte bound')
    } else {
      await gate(context, [physical])
      const names = await readdir(physical)
      if (names.length + pending.length + entries.length > bounds.entries)
        throw Error('Offline inventory entry bound')
      for (const name of names) pending.push(path === '.' ? name : `${path}/${name}`)
    }
    // Container may first be created by this transaction. Its contents (including ALL old archives)
    // are still inventoried. Directory times/atime are never a freshness substitute for file bytes.
    if (path !== container) entries.push(entry)
    if (entries.length > bounds.entries) throw Error('Offline inventory entry bound')
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path, 'en'))
}
async function read(root: string, path: string, max: number, context: OperationContext) {
  await gate(context, [join(root, path)])
  return (await readPrivate(join(root, path), max)).toString('utf8')
}
async function git(root: string, args: string[], context: OperationContext) {
  await gate(context, [root, join(root, '.git'), join(root, '.git/index')])
  return await runGit(root, args, engineEnvironment(), context.signal)
}
async function review(root: string, context: OperationContext): Promise<Omit<Plan, 'id'>> {
  await privateDirectory(root)
  const entries = await inventory(root, context, [maintenanceMarker])
  const entry = (path: string) => entries.find((e) => e.path === path)
  for (const path of ['.git', '.views']) {
    if (entry(path)?.kind !== 'directory')
      throw Error('Offline adoption requires existing typed owner storage')
    if (path !== '.git') await privateDirectory(join(root, path))
  }
  const lockPresent = entry('.lock')?.kind === 'directory'
  if (entry('.lock') && !lockPresent) throw Error('Offline adoption lock storage is not a directory')
  if (lockPresent) await privateDirectory(join(root, '.lock'))
  for (const path of ['Core.md', 'index.md', '.memory.json', 'config.json', '.git/index'])
    if (entry(path)?.kind !== 'file') throw Error('Offline adoption missing canonical bytes')
  if (entries.some((e) => e.path.startsWith('.git/') && e.path.endsWith('.lock')))
    throw Error('Offline adoption refuses pending Git locks')
  if (
    [
      '.git/commondir',
      '.git/objects/info/alternates',
      '.git/objects/info/http-alternates',
      '.git/shallow',
      '.git/worktrees',
      '.git/modules',
    ].some((path) => entry(path))
  )
    throw Error('Offline independent archive requires standalone complete Git object storage')
  const head = (await git(root, ['rev-parse', '--verify', 'HEAD'], context)).toString().trim()
  if (!/^[a-f0-9]{40,64}$/.test(head)) throw Error('Offline adoption requires full HEAD')
  const configSemantic = hash(JSON.stringify(parseConfig(await read(root, 'config.json', 131072, context))))
  parseLedger(await read(root, '.memory.json', limits.ledger, context))
  const journalEntries = entries.filter((e) => dirname(e.path) === journal)
  const records: { entry: Entry; record: ReturnType<typeof parseOperation> }[] = []
  for (const e of journalEntries) {
    const name = relative(journal, e.path)
    if (name.endsWith('.cas')) continue
    if (!/^[a-f0-9-]{36}\.json$/.test(name) || e.kind !== 'file')
      throw Error('Offline adoption refuses unknown journal/CAS inventory')
    const record = parseOperation(await read(root, e.path, operationLimit, context))
    if (
      record.immutable.root !== root ||
      record.immutable.rootIdentity !== entry('.')!.identity ||
      `${record.immutable.plan.id}.json` !== name
    )
      throw Error('Offline operation root binding mismatch')
    records.push({ entry: e, record })
  }
  let owner: LockOwner
  let outcome: Plan['outcome']
  if (lockPresent) {
    owner = parseLockOwner(JSON.parse(await read(root, '.lock/owner.json', 2048, context)))
    if (
      owner.directory !== entry('.lock')!.identity ||
      entries
        .filter((e) => e.path.startsWith('.lock/'))
        .map((e) => e.path)
        .join() !== '.lock/owner.json'
    )
      throw Error('Offline adoption refuses incomplete or policy lock evidence')
    outcome = 'unknown'
  } else {
    const candidates = records.filter(
      ({ record }) =>
        record.receipt.stage === 'not_committed_dirty' &&
        record.immutable.plan.current === head &&
        record.owner !== null,
    )
    if (candidates.length !== 1)
      throw Error('Offline recovery requires one exact terminal dirty operation without a lock')
    owner = parseLockOwner(candidates[0].record.owner)
    outcome = 'not_committed_dirty'
  }
  const moves = lockPresent ? ['.lock'] : []
  let operation: Plan['operation'] | undefined
  let operationRecord: ReturnType<typeof parseOperation> | undefined
  let draft: string | null = null
  for (const { entry: journalEntry, record } of records) {
    if (record.immutable.plan.id === owner.operation) {
      if (
        record.immutable.plan.digest !== owner.digest ||
        JSON.stringify(record.owner) !== JSON.stringify(owner) ||
        record.immutable.plan.current !== head ||
        record.receipt.stage !== outcome
      )
        throw Error('Offline recovery operation binding mismatch')
      operation = {
        immutableHash: record.immutableHash,
        sequence: record.sequence,
        view: record.immutable.plan.view,
      }
      operationRecord = record
      moves.push(journalEntry.path)
      const path = `.views/.engine-v2/drafts/${record.immutable.plan.view}.json`
      const proposal = parseDraft(await read(root, path, 2 * 1024 * 1024, context))
      if (proposal.id !== record.immutable.plan.view || proposal.state !== 'ready')
        throw Error('Offline adoption requires retained ready proposal')
      draft = path
    } else if (!['reconciled_committed', 'not_committed_dirty'].includes(record.receipt.stage))
      throw Error('Offline adoption refuses additional unresolved operations')
  }
  const casPath = `${journal}/${owner.operation}.json.cas`
  if (entry(casPath)) {
    if (entry(casPath)?.kind !== 'directory' || entries.some((value) => value.path.startsWith(`${casPath}/`)))
      throw Error('Offline CAS is not empty')
    moves.push(casPath)
  }
  if (!operation || !operationRecord)
    throw Error('Offline adoption requires complete typed operation evidence')
  const stagingPath = `.views/.engine-v2/staging/${owner.operation}`
  const stagingEntries = entries.filter((e) => e.path.startsWith('.views/.engine-v2/staging/'))
  if (stagingEntries.some((e) => !within(e.path, stagingPath)))
    throw Error('Offline adoption refuses staging from another operation')
  if (entry(stagingPath)) {
    if (entry(stagingPath)?.kind !== 'directory') throw Error('Offline operation staging is not a directory')
    moves.push(stagingPath)
  }
  const status = (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], context))
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  const changes = new Map(operationRecord.immutable.plan.changes.map((change) => [change.path, change]))
  const worktree: Plan['worktree'] = []
  const orphans: string[] = []
  for (const line of status) {
    if (/^\?\? \.memory-engine-[a-f0-9-]{36}\.tmp$/.test(line)) {
      const path = line.slice(3)
      if (entry(path)?.kind !== 'file') throw Error('Offline orphan inventory mismatch')
      orphans.push(path)
      if (orphans.length > 64) throw Error('Offline reviewed native orphan count bound')
      continue
    }
    const untracked = line.startsWith('?? ')
    const tracked =
      line.length >= 4 && line[0] === ' ' && (line[1] === 'M' || line[1] === 'D') && line[2] === ' '
    if (!untracked && !tracked) throw Error('Offline adoption refuses staged or unknown user work')
    const path = line.slice(3)
    const change = changes.get(path)
    if (!change || worktree.some((item) => item.path === path))
      throw Error('Offline adoption refuses work outside the exact operation plan')
    const current = entry(path)
    if (change.hash === null) {
      if (!tracked || line[1] !== 'D' || current) throw Error('Offline planned deletion state mismatch')
    } else {
      if (
        (untracked && current?.kind !== 'file') ||
        (tracked && (line[1] !== 'M' || current?.kind !== 'file'))
      )
        throw Error('Offline planned write state mismatch')
      if (!current || current.hash !== change.hash || current.size !== change.size)
        throw Error('Offline planned write bytes mismatch')
    }
    worktree.push({ path, state: untracked ? 'untracked' : 'tracked' })
  }
  moves.push(...orphans)
  const children = (path: string) => entries.filter((e) => dirname(e.path) === path)
  const counts = {
    journal: children(journal).length,
    drafts: children('.views/.engine-v2/drafts').length,
    legacyViews: children('.views').filter((e) => /^[a-f0-9-]{36}\.json$/.test(relative('.views', e.path)))
      .length,
    staging: entries.filter((e) => e.kind === 'file' && e.path.startsWith('.views/.engine-v2/staging/'))
      .length,
    unknownAdmission: 1 + children(journal).filter((e) => e.path.endsWith('.cas')).length,
  }
  return {
    version: 1,
    root,
    entries,
    head,
    configSemantic,
    owner,
    operation,
    outcome,
    moves,
    worktree,
    draft,
    counts,
  }
}

// Fixed public system tool; no PATH/env/caller-selected helper, PID-death or quiet-time fallback.
// +D selects kernel-reported TREE file descriptors AND cwd, including .git and detached holders.
async function inspectHolders(root: string, engine: MemoryEngineController, context: OperationContext) {
  await gate(context, [root, join(root, '.git')])
  const executable =
    process.platform === 'darwin'
      ? '/usr/sbin/lsof'
      : process.platform === 'linux'
        ? '/usr/bin/lsof'
        : undefined
  if (!executable) throw Error('Offline maintenance requires supported system lsof')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['-nP', '-F0pfn', '+D', root], {
      env: engineEnvironment(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: context.signal,
    })
    const chunks: Buffer[] = []
    let length = 0
    let diagnostic = 0
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, 10000)
    child.stdout.on('data', (chunk: Buffer) => {
      length += chunk.length
      if (length > 2 * 1024 * 1024) child.kill('SIGTERM')
      else chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostic += chunk.length
    })
    child.once('error', () => {
      clearTimeout(timer)
      reject(Error('Offline holder inspection unavailable'))
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (timedOut || signal || diagnostic || length > 2 * 1024 * 1024 || (code !== 0 && code !== 1))
        return reject(Error('Offline holder inspection incomplete; preserve all evidence'))
      let pid: number | undefined
      let found = false
      for (const field of Buffer.concat(chunks)
        .toString('utf8')
        .split(/[\0\n]/)
        .filter(Boolean)) {
        if (/^p[1-9]\d*$/.test(field)) pid = Number(field.slice(1))
        else if (field.startsWith('f') || field.startsWith('n')) {
          if (!pid) return reject(Error('Offline holder inspection malformed'))
          found = true
          // These identities come only from this actual owner process and controller object.
          if (pid !== process.pid && pid !== engine.pid)
            return reject(Error('Unexpected kernel Root holder; close it explicitly, do not kill or adopt'))
        } else return reject(Error('Offline holder inspection unknown field'))
      }
      if ((code === 1 && length !== 0) || (code === 0 && !found))
        return reject(Error('Offline holder inspection incomplete'))
      resolve()
    })
  })
  await gate(context, [root])
}
async function replacePrivate(
  path: string,
  text: string,
  context: OperationContext,
  staging = dirname(path),
) {
  await gate(context, [path, staging])
  await safePath(path)
  await privateDirectory(staging)
  const temp = join(staging, `write-${randomUUID()}.partial`)
  await gate(context, [temp])
  const fd = await open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await gate(context, [temp])
    await fd.writeFile(text)
    await gate(context, [temp])
    await fd.sync()
  } finally {
    await fd.close()
  }
  await gate(context, [temp, path])
  await rename(temp, path)
  await syncDirectory(dirname(path), context)
}
async function durableJSON(path: string, value: unknown, context: OperationContext) {
  await replacePrivate(path, `${JSON.stringify(value)}\n`, context)
}
async function makeDirectory(path: string, context: OperationContext): Promise<void> {
  await gate(context, [path, dirname(path)])
  await safePath(path)
  if (await present(path, context)) {
    await privateDirectory(path)
    return
  }
  await makeDirectory(dirname(path), context)
  await gate(context, [path])
  await mkdir(path, { mode: 0o700 })
  await syncDirectory(path, context)
  await syncDirectory(dirname(path), context)
}
async function copyFile(
  source: string,
  destination: string,
  work: string,
  expected: Entry,
  context: OperationContext,
) {
  if (await present(destination, context)) {
    const actual = await fileHash(destination, context)
    if (actual.hash !== expected.hash || actual.size !== expected.size)
      throw Error('Archive existing bytes mismatch')
    return
  }
  await makeDirectory(dirname(destination), context)
  const temp = join(work, `copy-${randomUUID()}.partial`)
  await gate(context, [source, temp])
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  let output
  try {
    const s = await input.stat()
    if (!s.isFile() || s.nlink !== 1 || identity(s) !== expected.identity || s.size !== expected.size)
      throw Error('Archive source identity changed')
    output = await open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    const digest = createHash('sha256')
    const buffer = Buffer.alloc(65536)
    let size = 0
    while (true) {
      await gate(context, [source, temp])
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      size += bytesRead
      if (size > expected.size) throw Error('Archive source grew')
      const data = buffer.subarray(0, bytesRead)
      digest.update(data)
      let offset = 0
      while (offset < data.length)
        offset += (await output.write(data, offset, data.length - offset)).bytesWritten
    }
    if (size !== expected.size || digest.digest('hex') !== expected.hash)
      throw Error('Archive source bytes changed')
    await output.sync()
  } finally {
    await input.close()
    await output?.close()
  }
  await gate(context, [temp, destination])
  await rename(temp, destination)
  await syncDirectory(dirname(destination), context)
  if ((await fileHash(destination, context)).hash !== expected.hash)
    throw Error('Archive independent verification failed')
}
async function archive(plan: Plan, work: string, context: OperationContext) {
  const root = join(work, 'snapshot')
  await makeDirectory(root, context)
  for (const entry of plan.entries) {
    if (entry.path === '.') continue
    const path = join(root, entry.path)
    if (entry.kind === 'directory') await makeDirectory(path, context)
    else await copyFile(join(plan.root, entry.path), path, work, entry, context)
  }
  await verifyArchive(plan, work, context)
  await syncDirectory(root, context)
}
async function verifyArchive(plan: Plan, work: string, context: OperationContext) {
  const actual = await inventory(join(work, 'snapshot'), context)
  if (actual.some((e) => e.mode !== (e.kind === 'directory' ? 0o700 : 0o600)))
    throw Error('Archive must remain private independent storage')
  const content = (entries: Entry[]) =>
    entries.map(({ path, kind, size, hash }) => ({ path, kind, size, hash }))
  if (JSON.stringify(content(actual)) !== JSON.stringify(content(plan.entries)))
    throw Error('Archive full byte inventory verification failed')
  const root = join(work, 'snapshot')
  const owner = plan.owner
  const archivedOwner =
    plan.outcome === 'unknown'
      ? parseLockOwner(JSON.parse(await read(root, '.lock/owner.json', 2048, context)))
      : null
  const record = parseOperation(
    await read(root, `${journal}/${owner.operation}.json`, operationLimit, context),
  )
  const draft = parseDraft(await read(root, plan.draft!, 2 * 1024 * 1024, context))
  const semantic = hash(JSON.stringify(parseConfig(await read(root, 'config.json', 131072, context))))
  parseLedger(await read(root, '.memory.json', limits.ledger, context))
  const changes = new Map(record.immutable.plan.changes.map((change) => [change.path, change]))
  const snapshotEntries = new Map(plan.entries.map((entry) => [entry.path, entry]))
  const worktreeBound = plan.worktree.every((item) => {
    const change = changes.get(item.path)
    const entry = snapshotEntries.get(item.path)
    if (!change) return false
    if (change.hash === null) return item.state === 'tracked' && entry === undefined
    return entry?.kind === 'file' && entry.hash === change.hash && entry.size === change.size
  })
  if (
    (plan.outcome === 'unknown'
      ? JSON.stringify(archivedOwner) !== JSON.stringify(plan.owner) ||
        archivedOwner?.directory !== plan.entries.find((e) => e.path === '.lock')?.identity
      : archivedOwner !== null || plan.entries.some((entry) => within(entry.path, '.lock'))) ||
    record.immutable.root !== plan.root ||
    record.immutable.rootIdentity !== plan.entries.find((e) => e.path === '.')?.identity ||
    record.immutableHash !== plan.operation.immutableHash ||
    record.sequence !== plan.operation.sequence ||
    record.immutable.plan.digest !== owner.digest ||
    record.immutable.plan.id !== owner.operation ||
    JSON.stringify(record.owner) !== JSON.stringify(owner) ||
    record.receipt.stage !== plan.outcome ||
    record.immutable.plan.current !== plan.head ||
    record.immutable.plan.view !== plan.operation.view ||
    draft.id !== plan.operation.view ||
    draft.state !== 'ready' ||
    semantic !== plan.configSemantic ||
    !worktreeBound
  )
    throw Error('Archive original typed ownership/proposal binding failed')
}
async function conflictBytes(plan: Plan, work: string, context: OperationContext) {
  if (!plan.draft) return undefined
  const original = await read(join(work, 'snapshot'), plan.draft, 2 * 1024 * 1024, context)
  const draft = parseDraft(original)
  return `${JSON.stringify({ ...draft, state: 'conflict' })}\n`
}
async function currentWorktree(plan: Plan, context: OperationContext) {
  const status = (await git(plan.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], context))
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  const planned = new Map(plan.worktree.map((item) => [item.path, item]))
  const original = new Map(plan.entries.map((entry) => [entry.path, entry]))
  const dirty = new Set<string>()
  for (const line of status) {
    const path = line.slice(3)
    if (/^\?\? \.memory-engine-[a-f0-9-]{36}\.tmp$/.test(line) && plan.moves.includes(path)) continue
    const item = planned.get(path)
    const untracked = line.startsWith('?? ')
    const tracked =
      line.length >= 4 && line[0] === ' ' && (line[1] === 'M' || line[1] === 'D') && line[2] === ' '
    if (
      !item ||
      (!untracked && !tracked) ||
      (untracked ? item.state !== 'untracked' : item.state !== 'tracked')
    )
      throw Error('Offline active worktree escaped the reviewed operation')
    const expected = original.get(path)
    if (tracked && line[1] === 'D') {
      if (expected) throw Error('Offline active planned deletion changed')
    } else {
      if (!expected || expected.kind !== 'file') throw Error('Offline active planned write missing')
      const actual = await fileHash(join(plan.root, path), context)
      if (actual.hash !== expected.hash || actual.size !== expected.size)
        throw Error('Offline active planned write changed')
    }
    dirty.add(path)
  }
  return dirty
}
async function restoreWorktree(plan: Plan, context: OperationContext) {
  const dirty = await currentWorktree(plan, context)
  const tracked = plan.worktree.filter((item) => item.state === 'tracked')
  const trackedDirty = tracked.filter((item) => dirty.has(item.path))
  const untracked = plan.worktree.filter((item) => item.state === 'untracked' && dirty.has(item.path))
  if (tracked.length) {
    if (trackedDirty.length)
      await git(
        plan.root,
        ['restore', '--worktree', '--source=HEAD', '--', ...trackedDirty.map((item) => item.path)],
        context,
      )
    for (const item of tracked) {
      const path = join(plan.root, item.path)
      await safePath(path)
      await gate(context, [path])
      const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = await fd.stat()
        if (!stat.isFile() || stat.nlink !== 1) throw Error('Offline restored tracked path is unsafe')
        await fd.chmod(0o600)
        await fd.sync()
      } finally {
        await fd.close()
      }
      await syncDirectory(dirname(path), context)
    }
  }
  const originalDirectories = new Set(
    plan.entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.path),
  )
  for (const item of untracked) {
    const path = join(plan.root, item.path)
    await gate(context, [path])
    await unlink(path)
    await syncDirectory(dirname(path), context)
    for (
      let parent = dirname(item.path);
      parent !== '.' && !originalDirectories.has(parent);
      parent = dirname(parent)
    ) {
      const physical = join(plan.root, parent)
      await gate(context, [physical])
      try {
        await rmdir(physical)
        await syncDirectory(dirname(physical), context)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOTEMPTY' && code !== 'ENOENT') throw error
        if (code === 'ENOTEMPTY') break
      }
    }
  }
  if ((await currentWorktree(plan, context)).size)
    throw Error('Offline operation worktree restoration incomplete')
}
async function verifyActive(plan: Plan, work: string, context: OperationContext, allowMoves: boolean) {
  const original = plan.entries
  const expected = new Map(original.map((e) => [e.path, e]))
  const dirty = await currentWorktree(plan, context)
  if (!allowMoves && dirty.size !== plan.worktree.length)
    throw Error('Offline reviewed operation worktree changed before archive')
  const restored = new Set(
    allowMoves ? plan.worktree.filter((item) => !dirty.has(item.path)).map((item) => item.path) : [],
  )
  for (const path of restored) expected.delete(path)
  for (const path of plan.moves) {
    const source = join(plan.root, path)
    const destination = join(work, 'quarantine', path)
    const atSource = await present(source, context)
    const atDestination = await present(destination, context)
    if (atSource === atDestination || (!allowMoves && atDestination))
      throw Error('Offline quarantine checkpoint ambiguous')
    if (atDestination) {
      const saved = await inventory(destination, context)
      const subtree = original.filter((e) => within(e.path, path))
      // Files and directories use the same bounded inventory verifier.
      const mapped = saved.map((e) => ({ ...e, path: e.path === '.' ? path : `${path}/${e.path}` }))
      if (JSON.stringify(mapped) !== JSON.stringify(subtree)) throw Error('Offline quarantine bytes changed')
      for (const entry of subtree) expected.delete(entry.path)
    }
  }
  const active = (await inventory(plan.root, context, [maintenanceMarker, relative(plan.root, work)])).filter(
    (entry) => !restored.has(entry.path),
  )
  if (allowMoves && plan.draft) {
    const current = active.find((e) => e.path === plan.draft)
    const before = expected.get(plan.draft)!
    if (current?.hash !== before.hash) {
      const text = await conflictBytes(plan, work, context)
      if (
        !text ||
        !current ||
        current.hash !== hash(text) ||
        current.mode !== before.mode ||
        current.kind !== 'file'
      )
        throw Error('Offline proposal checkpoint changed')
      expected.set(plan.draft, current)
    }
  }
  if (JSON.stringify(active) !== JSON.stringify([...expected.values()]))
    throw Error('Offline full source fingerprint changed; no adoption')
  const head = (await git(plan.root, ['rev-parse', '--verify', 'HEAD'], context)).toString().trim()
  if (head !== plan.head) throw Error('Offline HEAD changed')
}
async function loadTransaction(root: string, context: OperationContext) {
  const markerRaw = await read(root, maintenanceMarker, 1024, context)
  const marker = JSON.parse(markerRaw)
  if (
    marker?.version !== 1 ||
    typeof marker.id !== 'string' ||
    !uuidPattern.test(marker.id) ||
    Object.keys(marker).sort().join() !== 'id,version'
  )
    throw Error('Offline maintenance marker unavailable')
  const work = join(root, container, marker.id)
  const raw = await read(work, 'plan.json', 64 * 1024 * 1024, context)
  const plan = JSON.parse(raw) as Plan
  if (!Object.hasOwn(plan, 'worktree')) plan.worktree = []
  if (!Object.hasOwn(plan, 'outcome')) plan.outcome = 'unknown'
  const stateRaw = await read(work, 'state.json', 2048, context)
  const state = JSON.parse(stateRaw) as State
  if (
    plan.version !== 1 ||
    plan.id !== marker.id ||
    plan.root !== root ||
    !Array.isArray(plan.entries) ||
    plan.entries.length > bounds.entries ||
    !Array.isArray(plan.moves) ||
    plan.moves.length > 128 ||
    !Array.isArray(plan.worktree) ||
    plan.worktree.length > limits.changes ||
    plan.entries.some(
      (e) =>
        !validPath(e.path) ||
        !['file', 'directory'].includes(e.kind) ||
        !/^\d+:\d+$/.test(e.identity) ||
        !Number.isSafeInteger(e.size) ||
        e.size < 0 ||
        e.size > bounds.file ||
        !Number.isSafeInteger(e.mode) ||
        (e.kind === 'file' && !/^[a-f0-9]{64}$/.test(e.hash ?? '')),
    ) ||
    plan.moves.some((p) => !validPath(p) || !plan.entries.some((e) => e.path === p)) ||
    plan.worktree.some(
      (item) => !item || !validPath(item.path) || (item.state !== 'tracked' && item.state !== 'untracked'),
    ) ||
    new Set(plan.worktree.map((item) => item.path)).size !== plan.worktree.length ||
    (plan.draft !== null && (!validPath(plan.draft) || !plan.entries.some((e) => e.path === plan.draft))) ||
    new Set(plan.entries.map((e) => e.path)).size !== plan.entries.length ||
    state.version !== 1 ||
    state.planHash !== hash(raw) ||
    !['prepared', 'archived', 'quarantining', 'completed'].includes(state.phase) ||
    !['manually-adopted-prior-outcome-unknown', 'manually-recovered-not-committed-dirty'].includes(
      state.disposition,
    )
  )
    throw Error('Offline maintenance checkpoint unavailable')
  parseLockOwner(plan.owner)
  if (
    !/^[a-f0-9]{40,64}$/.test(plan.head) ||
    !/^[a-f0-9]{64}$/.test(plan.configSemantic) ||
    !plan.operation ||
    !/^[a-f0-9]{64}$/.test(plan.operation.immutableHash) ||
    !Number.isSafeInteger(plan.operation.sequence) ||
    plan.operation.sequence < 0 ||
    !uuidPattern.test(plan.operation.view) ||
    plan.draft !== `.views/.engine-v2/drafts/${plan.operation.view}.json` ||
    !['unknown', 'not_committed_dirty'].includes(plan.outcome) ||
    (plan.outcome === 'unknown' ? !plan.moves.includes('.lock') : plan.moves.includes('.lock')) ||
    (plan.outcome === 'unknown') !== (state.disposition === 'manually-adopted-prior-outcome-unknown') ||
    !plan.moves.includes(`${journal}/${plan.owner.operation}.json`) ||
    new Set(plan.moves).size !== plan.moves.length ||
    plan.moves.some(
      (path) =>
        path !== '.lock' &&
        path !== `${journal}/${plan.owner.operation}.json` &&
        path !== `${journal}/${plan.owner.operation}.json.cas` &&
        path !== `.views/.engine-v2/staging/${plan.owner.operation}` &&
        !/^\.memory-engine-[a-f0-9-]{36}\.tmp$/.test(path),
    ) ||
    plan.entries.some(
      (e) =>
        e.path === maintenanceMarker ||
        within(e.path, relative(root, work)) ||
        e.mode < 0 ||
        e.mode > 0o777 ||
        (e.kind === 'directory' && (e.size !== 0 || e.hash !== undefined)),
    ) ||
    plan.entries.reduce((n, e) => n + e.size, 0) > bounds.bytes
  )
    throw Error('Offline checkpoint is not the narrow typed adoption contract')
  const active = await inventory(root, context, [maintenanceMarker, relative(root, work)])
  const workspace = await inventory(work, context)
  const digest = hash(
    JSON.stringify({ marker: hash(markerRaw), plan: hash(raw), state: hash(stateRaw), active, workspace }),
  )
  const children = (path: string) => active.filter((e) => dirname(e.path) === path)
  const counts = {
    journal: children(journal).length,
    drafts: children('.views/.engine-v2/drafts').length,
    legacyViews: children('.views').filter((e) => /^[a-f0-9-]{36}\.json$/.test(relative('.views', e.path)))
      .length,
    staging: active.filter((e) => e.kind === 'file' && e.path.startsWith('.views/.engine-v2/staging/'))
      .length,
    unknownAdmission: children(journal).filter(
      (e) => e.path.endsWith('.cas') || e.path === `${journal}/${plan.owner.operation}.json`,
    ).length,
  }
  return { plan, state, work, digest, counts }
}
async function finish(
  plan: Plan,
  state: State,
  work: string,
  engine: MemoryEngineController,
  context: OperationContext,
) {
  const save = async (phase: State['phase']) => {
    state = { ...state, phase }
    await durableJSON(join(work, 'state.json'), state, context)
  }
  await verifyActive(plan, work, context, state.phase !== 'prepared' && state.phase !== 'archived')
  if (state.phase === 'prepared') {
    await inspectHolders(plan.root, engine, context)
    await archive(plan, work, context)
    await verifyActive(plan, work, context, false)
    await save('archived')
  } else await verifyArchive(plan, work, context)
  // Kernel inspection and complete source hash recheck occur AFTER durable independent archive,
  // BEFORE the first destructive relocation. Assurance is not a sensor or a drain reference.
  await inspectHolders(plan.root, engine, context)
  await verifyActive(plan, work, context, state.phase !== 'archived')
  if (state.phase !== 'completed') {
    await save('quarantining')
    await restoreWorktree(plan, context)
    await verifyActive(plan, work, context, true)
    for (const path of plan.moves) {
      const source = join(plan.root, path)
      const destination = join(work, 'quarantine', path)
      if (await present(destination, context)) continue // verifyActive already validated exact original identity/bytes
      await makeDirectory(dirname(destination), context)
      await inspectHolders(plan.root, engine, context)
      await verifyActive(plan, work, context, true)
      await gate(context, [source, destination, dirname(source), dirname(destination)])
      await rename(source, destination)
      await syncDirectory(dirname(destination), context)
      await syncDirectory(dirname(source), context)
    }
    if (plan.draft) {
      const text = await conflictBytes(plan, work, context)
      if (!text) throw Error('Offline retained proposal unavailable')
      await gate(context, [join(plan.root, plan.draft)])
      await replacePrivate(join(plan.root, plan.draft), text, context, work)
    }
    await verifyArchive(plan, work, context)
    await verifyActive(plan, work, context, true)
    const status = (
      await git(plan.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], context)
    ).length
    if (status) throw Error('Offline active tracked/index state not clean')
    const active = await inventory(plan.root, context, [maintenanceMarker, relative(plan.root, work)])
    const remainingJournal = active.filter((e) => dirname(e.path) === journal)
    const remainingDrafts = active.filter((e) => dirname(e.path) === '.views/.engine-v2/drafts')
    if (remainingJournal.length >= 64 || remainingDrafts.length >= 64)
      throw Error('Offline adoption HOLD: active namespace capacity blocks ordinary admission')
    for (const entry of remainingJournal) {
      if (entry.kind !== 'file' || !/^[a-f0-9-]{36}\.json$/.test(relative(journal, entry.path)))
        throw Error('Offline adoption HOLD: unknown active namespace entry')
      const record = parseOperation(await read(plan.root, entry.path, operationLimit, context))
      if (!['reconciled_committed', 'not_committed_dirty'].includes(record.receipt.stage))
        throw Error('Offline adoption HOLD: unresolved active admission record')
    }
    // Use the existing owner's cold committed certification, without creating/evicting a view.
    await engine.request('offlineCertify', { revision: plan.head }, context)
    await verifyActive(plan, work, context, true)
    await save('completed') // durable disposition BEFORE releasing admission barrier
  }
  await gate(context, [join(plan.root, maintenanceMarker)])
  await unlink(join(plan.root, maintenanceMarker))
  await syncDirectory(join(plan.root, '.views'), context)
  return {
    target: plan.id,
    disposition: state.disposition,
    head: plan.head,
    headUnchanged: true,
    archiveRetained: true,
    proposalsActivated: false,
    humanAcceptance: false,
  }
}
export async function offlineMaintenance(
  engine: MemoryEngineController,
  context: OperationContext,
  request: MaintenanceRequest,
) {
  const root = engine.root
  await gate(context, [root, join(root, maintenanceMarker)])
  if (await present(join(root, maintenanceMarker), context)) {
    const tx = await loadTransaction(root, context)
    if (request.action === 'offline-inspect')
      return {
        target: tx.plan.id,
        head: tx.plan.head,
        revision: tx.digest,
        phase: tx.state.phase,
        counts: tx.counts,
        disposition: tx.state.disposition,
        next: 'explicit-reviewed-offline-resume',
        corpusReturned: false,
      }
    if (
      request.action !== 'offline-resume' ||
      request.target !== tx.plan.id ||
      request.revision !== tx.digest ||
      request.offline !== offlineAssurance
    )
      throw Error('Explicit reviewed offline checkpoint resume required')
    return await finish(tx.plan, tx.state, tx.work, engine, context)
  }
  if (request.action === 'offline-resume') throw Error('Offline maintenance marker absent; no replay')
  const reviewed = await review(root, context)
  const revision = hash(JSON.stringify(reviewed))
  if (request.action === 'offline-inspect') {
    await inspectHolders(root, engine, context)
    return {
      target: reviewed.owner.operation,
      revision,
      head: reviewed.head,
      rootIdentity: reviewed.entries.find((e) => e.path === '.')!.identity,
      operation: reviewed.operation,
      owner: reviewed.owner,
      files: reviewed.entries.length,
      bytes: reviewed.entries.reduce((n, e) => n + e.size, 0),
      artifacts: reviewed.moves,
      counts: reviewed.counts,
      remainingJournal: reviewed.counts.journal - reviewed.moves.filter((p) => dirname(p) === journal).length,
      adoptionAvailable:
        reviewed.counts.drafts < 64 &&
        reviewed.counts.journal - reviewed.moves.filter((p) => dirname(p) === journal).length < 64,
      archiveRequired: true,
      corpusReturned: false,
      priorOutcome: reviewed.outcome,
    }
  }
  if (
    request.action !== 'offline-adopt' ||
    request.target !== reviewed.owner.operation ||
    request.revision !== revision ||
    request.offline !== offlineAssurance
  )
    throw Error('Exact reviewed offline target/fingerprint and operator assurance required')
  if (
    reviewed.counts.drafts >= 64 ||
    reviewed.counts.journal - reviewed.moves.filter((p) => dirname(p) === journal).length >= 64
  )
    throw Error('Offline adoption HOLD: remaining active journal/drafts capacity blocks ordinary admission')
  await inspectHolders(root, engine, context)
  const plan: Plan = { ...reviewed, id: randomUUID() }
  const work = join(root, container, plan.id)
  await makeDirectory(work, context)
  const raw = `${JSON.stringify(plan)}\n`
  await gate(context, [join(work, 'plan.json')])
  await replacePrivate(join(work, 'plan.json'), raw, context)
  const state: State = {
    version: 1,
    phase: 'prepared',
    planHash: hash(raw),
    disposition:
      plan.outcome === 'unknown'
        ? 'manually-adopted-prior-outcome-unknown'
        : 'manually-recovered-not-committed-dirty',
  }
  await durableJSON(join(work, 'state.json'), state, context)
  const path = join(root, maintenanceMarker)
  await gate(context, [path])
  const marker = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await marker.writeFile(`${JSON.stringify({ version: 1, id: plan.id })}\n`)
    await marker.sync()
  } finally {
    await marker.close()
  }
  await syncDirectory(dirname(path), context)
  for (const path of [maintenanceMarker, relative(root, work)])
    await git(root, ['check-ignore', '--quiet', '--', path], context)
  return await finish(plan, state, work, engine, context)
}
