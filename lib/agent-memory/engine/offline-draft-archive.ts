import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile as copyFileExclusive, link, lstat, open, opendir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryEngineController, OperationContext } from './controller.ts'
import {
  container,
  copyFile,
  durableJSON,
  fileHash,
  gate,
  git,
  inspectHolders,
  maintenanceMarker,
  makeDirectory,
  offlineAssurance,
  present,
  read,
  relativeToRoot,
  syncDirectory,
  type Entry,
  type MaintenanceRequest,
} from './offline-maintenance.ts'
import { parseOperation } from './operation.ts'
import { classifyRetainedManifest } from './retained-preview.ts'
import { limits, parseConfig, parseLedger, uuidPattern } from './schema.ts'

const drafts = '.views/.engine-v2/drafts'
const journal = '.views/.engine-v2/journal'
const scanLimit = 8192
const executionOwners = new Map<string, symbol>()
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const draftActions = new Set<MaintenanceRequest['action']>([
  'offline-draft-inspect',
  'offline-draft-archive',
  'offline-draft-resume',
  'offline-draft-rollback',
])
interface Row {
  id: string
  identity: string
  mode: number
  size: number
  hash: string
  role: 'candidate' | 'retain'
}
interface Reviewed {
  rootIdentity: string
  head: string
  configSemantic: string
  ledgerHash: string
  journalHash: string
  exact: boolean
  draftEntries: number
  rows: Row[]
  counts: { candidates: number; unresolved: number; journalReferenced: number; unstable: number }
}
interface DraftPlan {
  version: 1
  kind: 'terminal-draft-archive'
  id: string
  root: string
  rootIdentity: string
  head: string
  configSemantic: string
  ledgerHash: string
  journalHash: string
  rows: Row[]
}
interface DraftState {
  version: 1
  phase: 'snapshotted' | 'moving' | 'completed' | 'rolling-back'
  planHash: string
  disposition: 'terminal-drafts-archived'
}
const candidateTarget = (rows: Row[]) =>
  hash(
    rows
      .filter((row) => row.role === 'candidate')
      .map((row) => row.id)
      .join('\n'),
  )
const fingerprint = (reviewed: Omit<Reviewed, 'exact' | 'draftEntries' | 'counts'>) =>
  hash(
    JSON.stringify({
      rootIdentity: reviewed.rootIdentity,
      head: reviewed.head,
      configSemantic: reviewed.configSemantic,
      ledgerHash: reviewed.ledgerHash,
      journalHash: reviewed.journalHash,
      rows: reviewed.rows,
    }),
  )
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
async function names(root: string, path: string, context: OperationContext) {
  const physical = join(root, path)
  await gate(context, [physical])
  try {
    const directory = await opendir(physical)
    const listed: string[] = []
    let seen = 0
    let exact = true
    try {
      for await (const entry of directory) {
        await gate(context, [physical])
        seen++
        if (seen > scanLimit) {
          exact = false
          break
        }
        listed.push(entry.name)
        if (!/^[a-f0-9-]{36}\.json$/.test(entry.name) && !entry.name.endsWith('.cas')) exact = false
      }
    } finally {
      await directory.close().catch(() => {})
    }
    return { listed: exact ? listed : listed.slice(0, scanLimit), exact }
  } catch (error) {
    if (!missing(error)) throw error
    return { listed: [] as string[], exact: true as const }
  }
}
async function withExecutionOwner<T>(root: string, context: OperationContext, body: () => Promise<T>) {
  if (executionOwners.has(root)) throw Error('Offline maintenance execution owner held')
  const token = Symbol(root)
  executionOwners.set(root, token)
  let inode: string | undefined
  try {
    await gate(context, [root])
    const stat = await lstat(root)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Offline maintenance root unavailable')
    inode = `${stat.dev}:${stat.ino}`
    const held = executionOwners.get(inode)
    if (held && held !== token) throw Error('Offline maintenance execution owner held')
    executionOwners.set(inode, token)
    await gate(context, [root])
    const again = await lstat(root)
    if (`${again.dev}:${again.ino}` !== inode || again.isSymbolicLink())
      throw Error('Offline maintenance root replaced')
    return await body()
  } finally {
    if (executionOwners.get(root) === token) executionOwners.delete(root)
    if (inode && executionOwners.get(inode) === token) executionOwners.delete(inode)
  }
}
// Public Node exposes COPYFILE_EXCL, not RENAME_NOREPLACE/renamex_np. The copy fails
// when the destination exists, so this does not replace it. It is not an atomic rename:
// a crash after the copy and before unlinking the source leaves both names, and resume
// keeps the marker instead of choosing one.
async function moveExclusive(source: string, destination: string, context: OperationContext) {
  await gate(context, [source, destination])
  try {
    await copyFileExclusive(source, destination, constants.COPYFILE_EXCL)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw Error('Terminal draft destination exists; marker retained')
    throw error
  }
  const original = await fileHash(source, context)
  const copied = await fileHash(destination, context)
  if (original.hash !== copied.hash || original.size !== copied.size)
    throw Error('Terminal draft copy uncertain; marker retained')
  await gate(context, [destination])
  const fd = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW)
  let failed = false
  try {
    await gate(context, [destination])
    await fd.sync()
  } catch (error) {
    failed = true
    throw error
  } finally {
    try {
      await fd.close()
    } catch (error) {
      if (!failed) throw error
    }
  }
  await gate(context, [source, destination])
  await unlink(source)
}
async function fileIdentity(path: string, context: OperationContext) {
  await gate(context, [path])
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
    throw Error('Offline draft archive refuses links or special files')
  return { identity: `${stat.dev}:${stat.ino}`, mode: stat.mode & 0o777 }
}
async function reviewDrafts(root: string, context: OperationContext): Promise<Reviewed> {
  await gate(context, [root])
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory()) throw Error('Offline draft archive requires the memory root')
  const head = (await git(root, ['rev-parse', '--verify', 'HEAD'], context)).toString().trim()
  if (!/^[a-f0-9]{40,64}$/.test(head)) throw Error('Offline draft archive requires full HEAD')
  const configSemantic = hash(JSON.stringify(parseConfig(await read(root, 'config.json', 131072, context))))
  const ledgerText = await read(root, '.memory.json', limits.ledger, context)
  parseLedger(ledgerText)
  const ledgerFile = await fileHash(join(root, '.memory.json'), context)
  const journalNames = await names(root, journal, context)
  const referenced = new Set<string>()
  let exact = journalNames.exact
  const journalParts: string[] = []
  for (const name of [...journalNames.listed].sort()) {
    const path = `${journal}/${name}`
    if (name.endsWith('.cas')) {
      const physical = join(root, path)
      await gate(context, [physical])
      const stat = await lstat(physical)
      if (!stat.isDirectory()) exact = false
      continue
    }
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) {
      exact = false
      continue
    }
    try {
      const first = await read(root, path, 8 * 1024 * 1024, context)
      const second = await read(root, path, 8 * 1024 * 1024, context)
      if (first !== second) exact = false
      const record = parseOperation(first)
      if (record.immutable.root !== root) exact = false
      referenced.add(record.immutable.plan.view)
      const hashed = await fileHash(join(root, path), context)
      journalParts.push(`${name}:${hashed.hash}:${hashed.size}`)
    } catch {
      exact = false
    }
  }
  const draftNames = await names(root, drafts, context)
  if (!draftNames.exact) exact = false
  const rows: Row[] = []
  let journalReferenced = 0
  let unstable = 0
  let terminal = 0
  for (const name of [...draftNames.listed].sort()) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) {
      exact = false
      continue
    }
    const id = name.slice(0, -5)
    const path = join(root, drafts, name)
    let role: Row['role'] = 'retain'
    try {
      const identity = await fileIdentity(path, context)
      const first = await read(root, `${drafts}/${name}`, 2 * 1024 * 1024, context)
      const second = await read(root, `${drafts}/${name}`, 2 * 1024 * 1024, context)
      const hashed = await fileHash(path, context)
      const kind = classifyRetainedManifest({
        id,
        first,
        second,
        referenced: referenced.has(id),
        locallyActive: false,
      })
      if (kind === 'unstable') {
        unstable++
        exact = false
      } else if (kind === 'journalReferenced') journalReferenced++
      else if (kind === 'terminal') {
        terminal++
        role = 'candidate'
      }
      if (kind !== 'terminal' || !exact) role = 'retain'
      rows.push({ id, ...identity, size: hashed.size, hash: hashed.hash, role })
    } catch {
      exact = false
    }
  }
  if (!exact) for (const row of rows) row.role = 'retain'
  const candidates = exact ? terminal : 0
  return {
    rootIdentity: `${rootStat.dev}:${rootStat.ino}`,
    head,
    configSemantic,
    ledgerHash: ledgerFile.hash,
    journalHash: hash(journalParts.join('\n')),
    exact,
    draftEntries: draftNames.listed.length,
    rows,
    counts: {
      candidates,
      unresolved: draftNames.listed.length - candidates,
      journalReferenced,
      unstable,
    },
  }
}
function receipt(reviewed: Reviewed) {
  const candidates = reviewed.counts.candidates
  return {
    kind: 'abi2-terminal-draft-archive' as const,
    target: candidateTarget(reviewed.rows),
    revision: fingerprint(reviewed),
    head: reviewed.head,
    candidates,
    unresolved: reviewed.counts.unresolved,
    journalReferenced: reviewed.counts.journalReferenced,
    unstable: reviewed.counts.unstable,
    exact: reviewed.exact,
    archiveAvailable: reviewed.exact && candidates > 0,
    retainedDrafts: reviewed.draftEntries,
    admissionRoom:
      reviewed.exact && candidates > 0 ? Math.max(0, limits.views - (reviewed.draftEntries - candidates)) : 0,
    snapshotScope: 'candidate-manifests' as const,
    quiescence: 'cooperative-lsof-and-operator-assurance' as const,
    hostileProcessGuarantee: false as const,
    corpusReturned: false as const,
  }
}
async function markerKind(root: string, context: OperationContext) {
  try {
    const marker = await validatedMarker(root, context)
    if (!marker) return 'absent' as const
    if (!uuidPattern.test(marker.id)) return 'unavailable' as const
    const path = join(root, container, marker.id, 'plan.json')
    await gate(context, [path])
    const prefix = (await read(root, `${container}/${marker.id}/plan.json`, 1024 * 1024, context)).slice(
      0,
      256,
    )
    if (prefix.includes('"kind":"terminal-draft-archive"')) return 'terminal-draft-archive' as const
    return 'publication' as const
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' ||
        error.message.startsWith('Current parent authority') ||
        error.message.includes('names preserved'))
    )
      throw error
    return 'unavailable' as const
  }
}
function sourcePath(id: string) {
  return `${drafts}/${id}.json`
}
function quarantined(work: string, id: string) {
  return join(work, 'quarantine', sourcePath(id))
}
async function locate(root: string, work: string, row: Row, context: OperationContext) {
  const source = join(root, sourcePath(row.id))
  const saved = quarantined(work, row.id)
  const atSource = await present(source, context)
  const atSaved = await present(saved, context)
  if (atSource === atSaved) throw Error('Terminal draft relocation uncertain; marker retained')
  const actual = await fileHash(atSource ? source : saved, context)
  if (actual.hash !== row.hash || actual.size !== row.size)
    throw Error('Terminal draft bytes uncertain; marker retained')
  return atSource ? 'source' : 'quarantine'
}
async function assertIdentity(
  root: string,
  plan: Pick<DraftPlan, 'rootIdentity' | 'head' | 'configSemantic' | 'ledgerHash' | 'journalHash' | 'rows'>,
  context: OperationContext,
) {
  const head = (await git(root, ['rev-parse', '--verify', 'HEAD'], context)).toString().trim()
  await gate(context, [root])
  const stat = await lstat(root)
  const configSemantic = hash(JSON.stringify(parseConfig(await read(root, 'config.json', 131072, context))))
  const ledger = await fileHash(join(root, '.memory.json'), context)
  const reviewed = await reviewDrafts(root, context)
  if (!reviewed.exact) throw Error('Terminal draft journal or inventory uncertain; marker retained')
  if (
    `${stat.dev}:${stat.ino}` !== plan.rootIdentity ||
    head !== plan.head ||
    configSemantic !== plan.configSemantic ||
    ledger.hash !== plan.ledgerHash ||
    reviewed.journalHash !== plan.journalHash
  )
    throw Error('Terminal draft identity changed; marker retained')
  for (const row of plan.rows) {
    if (row.role !== 'retain') continue
    const actual = await fileHash(join(root, sourcePath(row.id)), context)
    if (actual.hash !== row.hash || actual.size !== row.size)
      throw Error('Retained draft bytes changed; marker retained')
  }
}
async function snapshot(plan: DraftPlan, work: string, context: OperationContext) {
  const root = join(work, 'snapshot')
  await makeDirectory(root, context)
  for (const row of plan.rows) {
    if (row.role !== 'candidate') continue
    const expected: Entry = {
      path: sourcePath(row.id),
      kind: 'file',
      identity: row.identity,
      mode: row.mode,
      size: row.size,
      hash: row.hash,
    }
    await copyFile(join(plan.root, expected.path), join(root, expected.path), work, expected, context)
  }
  for (const row of plan.rows) {
    if (row.role !== 'candidate') continue
    const actual = await fileHash(join(root, sourcePath(row.id)), context)
    if (actual.hash !== row.hash || actual.size !== row.size)
      throw Error('Terminal draft snapshot verification failed')
  }
  await syncDirectory(root, context)
  await syncDirectory(join(plan.root, drafts), context)
}
function immutableMarker(text: string) {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw Error('Offline maintenance marker link uncertain; marker retained')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Offline maintenance marker link uncertain; marker retained')
  const record = value as { version?: unknown; id?: unknown }
  if (
    Object.keys(record).sort().join() !== 'id,version' ||
    record.version !== 1 ||
    typeof record.id !== 'string' ||
    !uuidPattern.test(record.id) ||
    text !== `${JSON.stringify({ version: 1, id: record.id })}\n`
  )
    throw Error('Offline maintenance marker link uncertain; marker retained')
  return record.id
}
async function readLinkedFile(
  path: string,
  identity: { dev: number; ino: number },
  nlink: 1 | 2,
  context: OperationContext,
  names: string[],
) {
  await gate(context, names)
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let failed = false
  try {
    await gate(context, names)
    const stat = await fd.stat()
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.dev !== identity.dev ||
      stat.ino !== identity.ino ||
      stat.nlink !== nlink ||
      stat.mode & 0o077 ||
      stat.size > 1024
    )
      throw Error('Offline maintenance marker link uncertain; marker retained')
    await gate(context, names)
    return await fd.readFile()
  } catch (error) {
    failed = true
    throw error
  } finally {
    try {
      await fd.close()
    } catch (error) {
      if (!failed) throw error
    }
  }
}
interface LinkedMarker {
  id: string
  raw: string
  tempPath: string | null
}
// Read-only. safePath refuses nlink !== 1, so a validated pair is read here without unlinking.
async function validatedMarker(root: string, context: OperationContext): Promise<LinkedMarker | undefined> {
  const dir = join(root, '.views')
  const finalPath = join(root, maintenanceMarker)
  await gate(context, [finalPath])
  let finalStat: Awaited<ReturnType<typeof lstat>>
  try {
    finalStat = await lstat(finalPath)
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
  if (finalStat.isSymbolicLink() || !finalStat.isFile())
    throw Error('Offline maintenance marker link uncertain; marker retained')
  if (finalStat.nlink === 1) {
    const raw = (
      await readLinkedFile(finalPath, { dev: finalStat.dev, ino: finalStat.ino }, 1, context, [finalPath])
    ).toString('utf8')
    return { id: immutableMarker(raw), raw, tempPath: null }
  }
  if (finalStat.nlink !== 2) throw Error('Offline maintenance marker link uncertain; marker retained')
  await gate(context, [dir])
  const directory = await opendir(dir)
  const temps: string[] = []
  let seen = 0
  let failed = false
  try {
    while (true) {
      await gate(context, [dir])
      const entry = await directory.read()
      if (!entry) break
      seen++
      if (seen > scanLimit) throw Error('Offline maintenance marker scan bound; names preserved')
      if (!/^maintenance-marker-[0-9a-f-]{36}\.partial$/.test(entry.name)) continue
      temps.push(entry.name)
      if (temps.length > 8) throw Error('Offline maintenance marker link uncertain; marker retained')
    }
  } catch (error) {
    failed = true
    throw error
  } finally {
    try {
      await directory.close()
    } catch (error) {
      if (!failed) throw error
    }
  }
  const identity = { dev: finalStat.dev, ino: finalStat.ino }
  const matches: string[] = []
  for (const name of temps) {
    const path = join(dir, name)
    await gate(context, [path])
    const stat = await lstat(path)
    if (!stat.isSymbolicLink() && stat.isFile() && stat.dev === identity.dev && stat.ino === identity.ino)
      matches.push(name)
  }
  if (matches.length !== 1) throw Error('Offline maintenance marker link uncertain; marker retained')
  const tempPath = join(dir, matches[0]!)
  const names = [finalPath, tempPath]
  const finalBytes = await readLinkedFile(finalPath, identity, 2, context, names)
  const tempBytes = await readLinkedFile(tempPath, identity, 2, context, names)
  if (!finalBytes.equals(tempBytes)) throw Error('Offline maintenance marker link uncertain; marker retained')
  const raw = finalBytes.toString('utf8')
  const id = immutableMarker(raw)
  return { id, raw, tempPath }
}
async function recoverLinkedMarker(root: string, context: OperationContext, expectedId: string) {
  const linked = await validatedMarker(root, context)
  if (!linked || linked.id !== expectedId)
    throw Error('Offline maintenance marker link uncertain; marker retained')
  if (!linked.tempPath) return
  const tempPath = linked.tempPath
  const finalPath = join(root, maintenanceMarker)
  await gate(context, [finalPath, tempPath])
  const finalStat = await lstat(finalPath)
  const identity = { dev: finalStat.dev, ino: finalStat.ino }
  await gate(context, [finalPath, tempPath])
  const againFinal = await lstat(finalPath)
  await gate(context, [finalPath, tempPath])
  const againTemp = await lstat(tempPath)
  if (
    againFinal.dev !== identity.dev ||
    againFinal.ino !== identity.ino ||
    againTemp.dev !== identity.dev ||
    againTemp.ino !== identity.ino ||
    againFinal.nlink !== 2 ||
    againTemp.nlink !== 2
  )
    throw Error('Offline maintenance marker link uncertain; marker retained')
  await gate(context, [tempPath])
  await unlink(tempPath)
  await gate(context, [finalPath])
  const after = await lstat(finalPath)
  if (after.dev !== identity.dev || after.ino !== identity.ino || after.nlink !== 1 || after.isSymbolicLink())
    throw Error('Offline maintenance marker link uncertain; marker retained')
}
async function createMarker(root: string, id: string, context: OperationContext) {
  const dir = join(root, '.views')
  const finalPath = join(root, maintenanceMarker)
  const temp = join(dir, `maintenance-marker-${randomUUID()}.partial`)
  const payload = `${JSON.stringify({ version: 1, id })}\n`
  await gate(context, [dir, finalPath, temp])
  const fd = await open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  let failed = false
  try {
    try {
      await gate(context, [temp])
      await fd.writeFile(payload)
      await gate(context, [temp])
      await fd.sync()
    } catch (error) {
      failed = true
      throw error
    } finally {
      try {
        await fd.close()
      } catch (error) {
        if (!failed) throw error
      }
    }
    await syncDirectory(dir, context)
    await gate(context, [dir, finalPath, temp])
    try {
      await link(temp, finalPath)
    } catch (error) {
      failed = true
      throw error
    }
    await gate(context, [dir, finalPath, temp])
    const dirFd = await open(dir, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      await gate(context, [dir])
      await dirFd.sync()
    } finally {
      await dirFd.close()
    }
    await gate(context, [dir, finalPath, temp])
    const linked = await lstat(finalPath)
    const published = (
      await readLinkedFile(finalPath, { dev: linked.dev, ino: linked.ino }, 2, context, [finalPath, temp])
    ).toString('utf8')
    if (published !== payload) throw Error('Offline maintenance marker bytes uncertain; marker retained')
  } catch (error) {
    failed = true
    throw error
  } finally {
    try {
      await gate(context, [temp])
      await unlink(temp)
    } catch (error) {
      // Revoked cleanup preserves the temp and the original error.
      if (!failed) throw error
    }
  }
}
async function moveCandidate(root: string, work: string, row: Row, context: OperationContext) {
  const source = join(root, sourcePath(row.id))
  const destination = quarantined(work, row.id)
  await makeDirectory(join(work, 'quarantine', drafts), context)
  await moveExclusive(source, destination, context)
  await syncDirectory(join(work, 'quarantine', drafts), context)
  await syncDirectory(join(root, drafts), context)
  const actual = await fileHash(destination, context)
  if (actual.hash !== row.hash || actual.size !== row.size)
    throw Error('Quarantined terminal draft bytes changed; marker retained')
}
async function verifySnapshots(plan: DraftPlan, work: string, context: OperationContext) {
  for (const row of plan.rows) {
    if (row.role !== 'candidate') continue
    const actual = await fileHash(join(work, 'snapshot', sourcePath(row.id)), context)
    if (actual.hash !== row.hash || actual.size !== row.size)
      throw Error('Terminal draft snapshot mismatch; marker retained')
  }
}
async function releaseMarker(
  plan: DraftPlan,
  engine: MemoryEngineController,
  work: string,
  context: OperationContext,
) {
  await inspectHolders(plan.root, engine, context)
  await assertIdentity(plan.root, plan, context)
  await verifySnapshots(plan, work, context)
  const head = (await git(plan.root, ['rev-parse', '--verify', 'HEAD'], context)).toString().trim()
  if (head !== plan.head) throw Error('Offline HEAD changed; marker retained')
  await gate(context, [plan.root])
  const stat = await lstat(plan.root)
  if (`${stat.dev}:${stat.ino}` !== plan.rootIdentity || stat.isSymbolicLink())
    throw Error('Offline maintenance root replaced; marker retained')
  await gate(context, [join(plan.root, maintenanceMarker)])
  await unlink(join(plan.root, maintenanceMarker))
  await syncDirectory(join(plan.root, '.views'), context)
}
async function finishMoves(
  plan: DraftPlan,
  state: DraftState,
  work: string,
  engine: MemoryEngineController,
  context: OperationContext,
) {
  const save = async (phase: DraftState['phase']) => {
    state = { ...state, phase }
    await durableJSON(join(work, 'state.json'), state, context)
  }
  await inspectHolders(plan.root, engine, context)
  await assertIdentity(plan.root, plan, context)
  if (state.phase === 'snapshotted') await save('moving')
  for (const row of plan.rows) {
    if (row.role !== 'candidate') continue
    const place = await locate(plan.root, work, row, context)
    if (place === 'quarantine') continue
    await inspectHolders(plan.root, engine, context)
    await moveCandidate(plan.root, work, row, context)
  }
  for (const row of plan.rows) {
    if (row.role !== 'candidate') continue
    if ((await locate(plan.root, work, row, context)) !== 'quarantine')
      throw Error('Terminal draft archive incomplete; marker retained')
  }
  await assertIdentity(plan.root, plan, context)
  const head = (await git(plan.root, ['rev-parse', '--verify', 'HEAD'], context)).toString().trim()
  if (head !== plan.head) throw Error('Offline HEAD changed; marker retained')
  await save('completed')
  await releaseMarker(plan, engine, work, context)
  return {
    kind: 'abi2-terminal-draft-archive' as const,
    target: plan.id,
    archived: plan.rows.filter((row) => row.role === 'candidate').length,
    headUnchanged: true,
    archiveRetained: true,
    markerReleased: true,
    hostileProcessGuarantee: false as const,
    corpusReturned: false as const,
  }
}
async function rollback(
  plan: DraftPlan,
  state: DraftState,
  work: string,
  engine: MemoryEngineController,
  context: OperationContext,
) {
  state = { ...state, phase: 'rolling-back' }
  await durableJSON(join(work, 'state.json'), state, context)
  await inspectHolders(plan.root, engine, context)
  await assertIdentity(plan.root, plan, context)
  for (const row of plan.rows) {
    if (row.role !== 'candidate') continue
    const source = join(plan.root, sourcePath(row.id))
    const saved = quarantined(work, row.id)
    const atSource = await present(source, context)
    const atSaved = await present(saved, context)
    if (atSource === atSaved) throw Error('Terminal draft rollback uncertain; marker retained')
    if (atSource) {
      const actual = await fileHash(source, context)
      if (actual.hash !== row.hash || actual.size !== row.size)
        throw Error('Terminal draft rollback refuses to overwrite changed bytes; marker retained')
      continue
    }
    const actual = await fileHash(saved, context)
    if (actual.hash !== row.hash || actual.size !== row.size)
      throw Error('Terminal draft rollback bytes uncertain; marker retained')
    await inspectHolders(plan.root, engine, context)
    await moveExclusive(saved, source, context)
    await syncDirectory(join(plan.root, drafts), context)
    await syncDirectory(join(work, 'quarantine', drafts), context)
    const restored = await fileHash(source, context)
    if (restored.hash !== row.hash || restored.size !== row.size)
      throw Error('Terminal draft restoration bytes uncertain; marker retained')
  }
  await assertIdentity(plan.root, plan, context)
  await releaseMarker(plan, engine, work, context)
  return {
    kind: 'abi2-terminal-draft-archive' as const,
    target: plan.id,
    restored: plan.rows.filter((row) => row.role === 'candidate').length,
    headUnchanged: true,
    archiveRetained: true,
    markerReleased: true,
    hostileProcessGuarantee: false as const,
    corpusReturned: false as const,
  }
}
async function load(root: string, context: OperationContext) {
  const linked = await validatedMarker(root, context)
  if (!linked) throw Error('Offline terminal-draft marker unavailable')
  const markerRaw = linked.raw
  const marker = { version: 1, id: linked.id }
  const work = join(root, container, marker.id)
  const raw = await read(root, relativeToRoot(root, join(work, 'plan.json')), 1024 * 1024, context)
  const plan = JSON.parse(raw) as DraftPlan
  const state = JSON.parse(
    await read(root, relativeToRoot(root, join(work, 'state.json')), 2048, context),
  ) as DraftState
  const candidates = plan.rows?.filter((row) => row.role === 'candidate') ?? []
  if (
    plan.version !== 1 ||
    plan.kind !== 'terminal-draft-archive' ||
    plan.id !== marker.id ||
    plan.root !== root ||
    !/^\d+:\d+$/.test(plan.rootIdentity) ||
    !/^[a-f0-9]{40,64}$/.test(plan.head) ||
    !/^[a-f0-9]{64}$/.test(plan.configSemantic) ||
    !/^[a-f0-9]{64}$/.test(plan.ledgerHash) ||
    !/^[a-f0-9]{64}$/.test(plan.journalHash) ||
    !Array.isArray(plan.rows) ||
    plan.rows.length > scanLimit ||
    candidates.length < 1 ||
    state.version !== 1 ||
    state.planHash !== hash(raw) ||
    state.disposition !== 'terminal-drafts-archived' ||
    !['snapshotted', 'moving', 'completed', 'rolling-back'].includes(state.phase) ||
    plan.rows.some(
      (row) =>
        !row ||
        !uuidPattern.test(row.id) ||
        !/^\d+:\d+$/.test(row.identity) ||
        (row.role !== 'candidate' && row.role !== 'retain') ||
        !/^[a-f0-9]{64}$/.test(row.hash) ||
        !Number.isSafeInteger(row.size) ||
        row.size < 0 ||
        row.size > 2 * 1024 * 1024 ||
        !Number.isSafeInteger(row.mode),
    )
  )
    throw Error('Offline terminal-draft checkpoint unavailable')
  const active = await reviewDrafts(root, context)
  const digest = hash(
    JSON.stringify({
      marker: hash(markerRaw),
      plan: hash(raw),
      state: hash(JSON.stringify(state)),
      active: fingerprint(active),
    }),
  )
  return { plan, state, work, digest }
}
async function archive(
  engine: MemoryEngineController,
  context: OperationContext,
  request: MaintenanceRequest,
  reviewed: Reviewed,
) {
  const root = engine.root
  const preview = receipt(reviewed)
  if (!preview.archiveAvailable)
    throw Error('No safe terminal draft candidates; unresolved and uncertain drafts stay in place')
  if (
    request.action !== 'offline-draft-archive' ||
    request.target !== preview.target ||
    request.revision !== preview.revision ||
    request.offline !== offlineAssurance
  )
    throw Error('Exact reviewed terminal-draft fingerprint and operator assurance required')
  await inspectHolders(root, engine, context)
  const again = await reviewDrafts(root, context)
  if (fingerprint(again) !== preview.revision) throw Error('Terminal draft inventory changed before archive')
  const plan: DraftPlan = {
    version: 1,
    kind: 'terminal-draft-archive',
    id: randomUUID(),
    root,
    rootIdentity: again.rootIdentity,
    head: again.head,
    configSemantic: again.configSemantic,
    ledgerHash: again.ledgerHash,
    journalHash: again.journalHash,
    rows: again.rows,
  }
  const work = join(root, container, plan.id)
  await makeDirectory(work, context)
  await durableJSON(join(work, 'plan.json'), plan, context)
  const stored = await read(root, relativeToRoot(root, join(work, 'plan.json')), 1024 * 1024, context)
  await snapshot(plan, work, context)
  await inspectHolders(root, engine, context)
  await assertIdentity(root, plan, context)
  const state: DraftState = {
    version: 1,
    phase: 'snapshotted',
    planHash: hash(stored),
    disposition: 'terminal-drafts-archived',
  }
  await durableJSON(join(work, 'state.json'), state, context)
  await createMarker(root, plan.id, context)
  for (const path of [maintenanceMarker, `${container}/${plan.id}`])
    await git(root, ['check-ignore', '--quiet', '--', path], context)
  return await finishMoves(plan, state, work, engine, context)
}
export async function draftArchiveMaintenance(
  engine: MemoryEngineController,
  context: OperationContext,
  request: MaintenanceRequest,
) {
  const root = engine.root
  const requested = draftActions.has(request.action)
  if (!requested) {
    await gate(context, [root, join(root, maintenanceMarker)])
    const markerOn = await present(join(root, maintenanceMarker), context)
    const kind = markerOn ? await markerKind(root, context) : 'absent'
    if (kind !== 'terminal-draft-archive') return undefined
  }
  return await withExecutionOwner(root, context, async () => {
    const markerNow = await present(join(root, maintenanceMarker), context)
    const kindNow = markerNow ? await markerKind(root, context) : 'absent'
    if (requested && markerNow && kindNow === 'publication')
      throw Error('Offline publication checkpoint blocks terminal-draft archive')
    if (requested && markerNow && kindNow === 'unavailable')
      throw Error('Offline terminal-draft checkpoint unavailable')
    if (!markerNow && request.action === 'offline-draft-resume')
      throw Error('Offline terminal-draft marker absent; no replay')
    if (!markerNow && request.action === 'offline-draft-rollback')
      throw Error('Offline terminal-draft marker absent; no replay')
    if (markerNow && kindNow === 'terminal-draft-archive') {
      const tx = await load(root, context)
      if (request.action === 'offline-draft-inspect' || request.action === 'offline-inspect')
        return {
          kind: 'abi2-terminal-draft-archive' as const,
          target: tx.plan.id,
          revision: tx.digest,
          head: tx.plan.head,
          phase: tx.state.phase,
          candidates: tx.plan.rows.filter((row) => row.role === 'candidate').length,
          next:
            tx.state.phase === 'rolling-back'
              ? 'explicit-reviewed-offline-draft-rollback'
              : 'explicit-reviewed-offline-draft-resume',
          hostileProcessGuarantee: false as const,
          corpusReturned: false as const,
        }
      if (
        (request.action !== 'offline-draft-resume' && request.action !== 'offline-draft-rollback') ||
        request.target !== tx.plan.id ||
        request.revision !== tx.digest ||
        request.offline !== offlineAssurance
      )
        throw Error('Explicit reviewed terminal-draft checkpoint required')
      await inspectHolders(root, engine, context)
      await recoverLinkedMarker(root, context, tx.plan.id)
      if (request.action === 'offline-draft-rollback')
        return await rollback(tx.plan, tx.state, tx.work, engine, context)
      if (tx.state.phase === 'rolling-back')
        throw Error('Explicit terminal-draft rollback required; marker retained')
      if (tx.state.phase === 'completed') {
        for (const row of tx.plan.rows) {
          if (row.role !== 'candidate') continue
          if ((await locate(root, tx.work, row, context)) !== 'quarantine')
            throw Error('Completed terminal draft archive is uncertain; marker retained')
        }
        await releaseMarker(tx.plan, engine, tx.work, context)
        return {
          kind: 'abi2-terminal-draft-archive' as const,
          target: tx.plan.id,
          archived: tx.plan.rows.filter((row) => row.role === 'candidate').length,
          headUnchanged: true,
          archiveRetained: true,
          markerReleased: true,
          hostileProcessGuarantee: false as const,
          corpusReturned: false as const,
        }
      }
      return await finishMoves(tx.plan, tx.state, tx.work, engine, context)
    }
    const reviewed = await reviewDrafts(root, context)
    if (request.action === 'offline-draft-inspect') {
      await inspectHolders(root, engine, context)
      return receipt(reviewed)
    }
    return await archive(engine, context, request, reviewed)
  })
}
