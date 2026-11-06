import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, opendir, readdir, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { bytes, digest, objectShape, validId } from '../../continuity/records.ts'
import {
  assertKnowledgeHistory,
  historyClassification,
  type KnowledgeHistory,
  parseHistoryRows,
} from '../knowledge-history.ts'
import {
  canonicalLedgerDigest,
  migrationExportPageLimit,
  migrationSourceIndex,
  pageMigrationExport,
} from '../migration-export.ts'
import {
  type PalaceStructure,
  palaceScopedPath,
  utf8Preview,
  snapshotDigest,
  structureDigest,
} from '../palace-structure.ts'
import { memoryFailure } from '../reasons.ts'
import {
  buildMemoryPalace,
  childDirectoryPaths,
  childIndexDescription,
  directoryIndex,
  directoryPage,
  extractFrontmatterAndLinks,
  memoryExtensionSuggestion,
  memoryMissingHint,
  memoryPathSuggestions,
  palaceLayerFor,
  parseMemoryRead,
  retrievalLimits,
  retrieveMemory,
  topicMetadata,
  projectedDirectoryIndexes,
} from '../retrieval.ts'
import type { MemoryConfig, MemoryFile, View } from '../store.ts'
import { episodeAssistantSteps, observedEpisode } from './episodes.ts'
import { withEpisodeAdmission } from './episode-admission.ts'
import {
  atomicPrivate,
  type Check,
  createPrivate,
  gitBlobBatches,
  gitSafety,
  parseGitBlobs,
  privateDirectory,
  readPrivate,
  runGit,
  safePath,
} from './io.ts'
import { type Base, type Draft, type Overlay, parseDraft, type Ref } from './manifest.ts'
import { classifyRetainedManifest, type RetainedDraftPreview } from './retained-preview.ts'
import {
  type LockOwner,
  type OperationRecord,
  operationLimit,
  parseLockOwner,
  parseOperation,
  validateReceipt,
} from './operation.ts'
import type {
  CapacityDiagnostic,
  CapacityNamespace,
  Change,
  Counters,
  Input,
  Method,
  Operations,
  Plan,
  Receipt,
  Stage,
} from './protocol.ts'
import { legacyView, recoveryCeiling, validateFiles } from './recovery.ts'
import {
  allowedDirectory,
  allowedPath,
  applySurgicalEdit,
  assertLegacyArchiveCompatible,
  assertLosslessRetention,
  assertReadOnlyFrontmatter,
  ensureTieredFrontmatter,
  fileLimit,
  idPattern,
  isAlwaysLoadedTieredPath,
  isProtectedRetentionPath,
  type Ledger,
  legacyV1Migration,
  limits,
  overflowDraftLimit as overflowLimit,
  overflowJournalCutoff,
  parseConfig,
  parseLedger,
  revisionPattern,
  suppressed,
  uuidPattern,
  validateFile,
  withMigrationFrontmatter,
} from './schema.ts'
import { starterCore, starterPersona } from '../starter.ts'

interface Prepared {
  plan: Plan
  next: Record<string, Ref | Overlay>
  ledger: Ledger
  ledgerText: string
  receipt: Receipt
  record: OperationRecord
}
interface RetainedConflictCandidate {
  id: string
  baseRevision: string
  fileCount: number
  modern: boolean
  raw: string
  rawHash: string
  physical: string
  draft?: Draft
}
const same = isDeepStrictEqual
const maintenanceViewTtl = 30 * 60 * 1000
const bump = (counts: Record<string, number>, path: string) => {
  counts[path] = (counts[path] ?? 0) + 1
}
const stamp = (s: Awaited<ReturnType<typeof lstat>>) =>
  `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.mode}:${s.nlink}`
const states: Record<Stage, Stage[]> = {
  prepared: ['worktree_mutating', 'head_observed', 'not_committed_dirty', 'unknown'],
  worktree_mutating: ['worktree_mutating', 'index_staged', 'not_committed_dirty', 'unknown'],
  index_staged: ['commit_start_intent', 'not_committed_dirty', 'unknown'],
  commit_start_intent: ['commit_started', 'not_committed_dirty', 'unknown'],
  commit_started: ['head_observed', 'not_committed_dirty', 'unknown'],
  head_observed: ['reconciled_committed', 'not_committed_dirty', 'unknown'],
  reconciled_committed: [],
  not_committed_dirty: [],
  unknown: [],
}

// Created only by the private child entry, never on source import.
export class MemoryDataEngine {
  private folder: string
  private drafts = new Map<string, { value: Draft; hash: string }>()
  private bases = new Map<string, Base>()
  private certificates = new Map<string, Ref>()
  private plans = new Map<string, Prepared>()
  private managementLedgers = new Map<string, Ledger>()
  private counters: Counters = {
    blobReads: {},
    overlayReads: {},
    overlayWrites: {},
    certifications: 0,
    gitCalls: 0,
  }
  private check: Check = async () => {
    throw Error('No active operation')
  }
  private signal?: AbortSignal
  private root: string
  private env: NodeJS.ProcessEnv
  constructor(root: string, env: NodeJS.ProcessEnv) {
    this.root = root
    this.env = env
    this.folder = join(root, '.views', '.engine-v2')
  }
  private async gate(physical: string[], logical: string[] = [], kind: 'data' | 'view' | 'git' = 'data') {
    this.signal?.throwIfAborted()
    for (let start = 0; start < Math.max(physical.length, logical.length, 1); start += 32) {
      await this.check({
        physical: physical.slice(start, start + 32),
        logical: logical.slice(start, start + 32),
        kind,
      })
      this.signal?.throwIfAborted()
    }
  }
  private async read(path: string, max: number, logical: string[] = []) {
    await this.gate([path], logical)
    return (await readPrivate(path, max)).toString('utf8')
  }
  private async write(path: string, text: string, logical: string[] = []) {
    await this.gate([path], logical, 'view')
    await atomicPrivate(path, text)
  }
  private async gitBytes(args: string[], logical: string[] = [], input?: string) {
    await this.gate([this.root, join(this.root, '.git')], logical, 'git')
    await gitSafety(this.root, (targets) => this.gate(targets.physical, targets.logical, 'git'), logical)
    this.signal?.throwIfAborted()
    this.counters.gitCalls++
    return await runGit(this.root, args, this.env, this.signal, input)
  }
  private async git(args: string[], logical: string[] = [], input?: string) {
    return (await this.gitBytes(args, logical, input)).toString('utf8')
  }
  private async config() {
    await this.gate([this.root])
    await privateDirectory(this.root)
    const intent = join(this.root, '.bootstrap-v2.json')
    await this.gate([intent])
    try {
      await lstat(intent)
      throw Error('Incomplete initialization; existing root never reseeded')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const config = parseConfig(await this.read(join(this.root, 'config.json'), 65536))
    for (const project of config.projects) await safePath(project.cwd)
    return { config, configHash: digest(JSON.stringify(config)) }
  }
  private async head() {
    const revision = (await this.git(['rev-parse', '--verify', 'HEAD'])).trim()
    if (!revisionPattern.test(revision)) throw Error('Invalid memory revision')
    return revision
  }
  private async ledger(revision: string) {
    return parseLedger(await this.git(['show', `${revision}:.memory.json`], ['.memory.json']))
  }
  private async body(path: string, ref: Ref | Overlay) {
    let text: string
    if ('blob' in ref) {
      const physical = join(this.folder, 'blobs', ref.blob)
      text = await this.read(physical, limits.file, [path])
      bump(this.counters.overlayReads, path)
      if (stamp(await lstat(physical)) !== ref.identity) throw Error('Overlay identity changed externally')
    } else {
      text = await this.git(['cat-file', 'blob', ref.oid], [path])
      bump(this.counters.blobReads, path)
    }
    if (bytes(text) !== ref.size || digest(text) !== ref.hash) throw Error('Memory blob integrity mismatch')
    return text
  }
  private async bodies(entries: [string, Ref | Overlay][]) {
    if (new Set(entries.map(([path]) => path)).size !== entries.length)
      throw Error('Duplicate memory body path')
    const texts = new Map<string, string>()
    const committed = entries
      .filter((entry): entry is [string, Ref] => !('blob' in entry[1]))
      .map(([path, ref]) => ({ path, ...ref }))
    for (const batch of gitBlobBatches(committed)) {
      const raw = await this.gitBytes(
        ['cat-file', '--batch'],
        batch.map(({ path }) => path),
        batch.map(({ oid }) => `${oid}\n`).join(''),
      )
      const parsed = parseGitBlobs(raw, batch)
      for (const [index, { path, hash, size }] of batch.entries()) {
        const text = parsed[index]
        bump(this.counters.blobReads, path)
        if (bytes(text) !== size || digest(text) !== hash) throw Error('Memory blob integrity mismatch')
        texts.set(path, text)
      }
    }
    for (const [path, ref] of entries) if ('blob' in ref) texts.set(path, await this.body(path, ref))
    return Object.fromEntries(entries.map(([path]) => [path, texts.get(path)!]))
  }
  private async certify(c: MemoryConfig, configHash: string, requested?: string): Promise<Base> {
    const revision = requested ?? (await this.head())
    if (!revisionPattern.test(revision)) throw Error('Invalid revision')
    const ledger = await this.ledger(revision)
    const tree = await this.git(['ls-tree', '-rlz', revision])
    const refs: Record<string, Ref> = {}
    const cold: { key: string; path: string; oid: string; size: number; sources: string[] }[] = []
    let total = 0
    const paths: string[] = []
    for (const entry of tree.split('\0')) {
      if (!entry) continue
      const match = /^(100644|100755) blob ([a-f0-9]{40,64}) +([0-9]+)\t(.+)$/.exec(entry)
      if (!match || !Object.hasOwn(ledger.sources, match[4])) continue
      const [, , oid, sizeString, path] = match
      const size = Number(sizeString)
      if (!allowedPath(path) || !Number.isSafeInteger(size) || size > fileLimit(path, c))
        throw Error('Memory file budget exceeded')
      const sources = ledger.sources[path]
      const key = digest(JSON.stringify([1, configHash, path, oid, sources]))
      const ref = this.certificates.get(key)
      if (ref) refs[path] = ref
      else cold.push({ key, path, oid, size, sources })
      paths.push(path)
      total += size
    }
    if (paths.length !== Object.keys(ledger.sources).length || total > c.totalBytes)
      throw Error('Invalid memory layout or total budget')
    for (const batch of gitBlobBatches(cold)) {
      // Every remaining native batch gets the full fresh Git safety walk, with ALL member
      // logical paths at every physical checkpoint. No allow verdict survives an await.
      const raw = await this.gitBytes(
        ['cat-file', '--batch'],
        batch.map((entry) => entry.path),
        batch.map((entry) => `${entry.oid}\n`).join(''),
      )
      const texts = parseGitBlobs(raw, batch)
      for (const [index, { key, path, oid, size, sources }] of batch.entries()) {
        const text = texts[index]
        bump(this.counters.blobReads, path)
        validateFileText(path, text, sources, c)
        if (bytes(text) !== size) throw Error('Memory blob size mismatch')
        const ref = { oid, hash: digest(text), size, sources }
        this.certificates.set(key, ref)
        this.counters.certifications++
        refs[path] = ref
      }
    }
    // Cache contains immutable refs only; every request still reads config/ledger/HEAD.
    const base = { revision, refs: Object.fromEntries(paths.map((path) => [path, refs[path]])), ledger }
    this.bases.set(`${revision}:${configHash}`, base)
    if (this.bases.size > 64) this.bases.delete(this.bases.keys().next().value!)
    if (this.certificates.size > 32768) this.certificates.delete(this.certificates.keys().next().value!)
    return base
  }
  private files(v: Draft): Record<string, Ref | Overlay> {
    const refs: Record<string, Ref | Overlay> = { ...v.base.refs }
    for (const [path, ref] of Object.entries(v.overlay)) {
      if (ref === null) delete refs[path]
      else refs[path] = ref
    }
    return refs
  }
  private overflowFolder() {
    return join(this.folder, 'overflow-drafts')
  }
  private async boundedEntries(folder: string, ceiling: number) {
    await this.gate([folder], [], 'view')
    await safePath(folder)
    const entries: string[] = []
    try {
      await privateDirectory(folder)
      const directory = await opendir(folder)
      try {
        for await (const entry of directory) {
          entries.push(entry.name)
          if (entries.length > ceiling) throw memoryFailure('capacity', 'Private overflow capacity exceeded')
        }
      } finally {
        await directory.close().catch(() => {})
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return entries.sort()
  }
  private async overflowManifests() {
    const folder = this.overflowFolder()
    const slots = join(folder, 'slots')
    const owners = new Set<string>()
    for (const name of await this.boundedEntries(slots, overflowLimit)) {
      if (!/^(?:[0-2][0-9]|3[01])$/.test(name)) throw Error('Invalid overflow admission slot')
      await this.gate([join(slots, name)], [], 'view')
      await privateDirectory(join(slots, name))
      try {
        const id = await this.read(join(slots, name, 'owner'), 64)
        if (!uuidPattern.test(id) || owners.has(id)) throw Error('Invalid overflow admission owner')
        owners.add(id)
      } catch (error) {
        // A crash before owner publication consumes the slot; never adopt or reclaim it.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const manifests: { id: string; physical: string; overflow: true }[] = []
    for (const name of await this.boundedEntries(folder, overflowLimit * 3 + 1)) {
      if (name === 'slots' || /^[a-f0-9-]{36}\.json\.[a-f0-9-]{36}\.tmp$/.test(name)) continue
      const id = name.slice(0, -5)
      if (!name.endsWith('.json') || !uuidPattern.test(id) || !owners.has(id))
        throw Error('Unreserved overflow manifest')
      manifests.push({ id, physical: join(folder, name), overflow: true })
    }
    if (manifests.length > overflowLimit)
      throw memoryFailure('capacity', 'Private overflow capacity exceeded')
    return manifests
  }
  private async modernManifests() {
    const old = (await this.names(join(this.folder, 'drafts'), /^[a-f0-9-]{36}\.json$/)).map((name) => ({
      id: name.slice(0, -5),
      physical: join(this.folder, 'drafts', name),
      overflow: false,
    }))
    const overflow = await this.overflowManifests()
    if (overflow.some(({ id }) => old.some((entry) => entry.id === id)))
      throw Error('Ambiguous private manifest identity')
    return [...old, ...overflow]
  }
  private async manifest(v: Pick<Draft, 'id'>) {
    if (!uuidPattern.test(v.id)) throw Error('Invalid private manifest identity')
    const overflow = (await this.overflowManifests()).find(({ id }) => id === v.id)
    const old = join(this.folder, 'drafts', `${v.id}.json`)
    if (overflow) {
      await this.gate([old], [], 'view')
      await safePath(old)
      try {
        await lstat(old)
        throw Error('Ambiguous private manifest identity')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return overflow?.physical ?? old
  }
  private async overflowJournalFence() {
    const names = await this.boundedEntries(join(this.folder, 'journal'), overflowJournalCutoff)
    if (names.length >= overflowJournalCutoff)
      throw memoryFailure('capacity', 'Overflow admission requires shared journal headroom')
  }
  private async reserveOverflow(id: string) {
    await this.overflowJournalFence()
    await this.overflowManifests()
    const slots = join(this.overflowFolder(), 'slots')
    await this.gate([this.overflowFolder(), slots], [], 'view')
    await privateDirectory(this.overflowFolder(), true)
    await privateDirectory(slots, true)
    for (let slot = 0; slot < overflowLimit; slot++) {
      const directory = join(slots, String(slot).padStart(2, '0'))
      await this.gate([directory], [], 'view')
      await safePath(directory)
      try {
        await mkdir(directory, { mode: 0o700 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }
      // Permanent exclusive reservation, including failed/crashed admissions. No stale-lock stealing.
      await this.write(join(directory, 'owner'), id)
      // Persist the directory chain before a manifest can become publication evidence.
      for (const parent of [slots, this.overflowFolder(), this.folder]) {
        await this.gate([parent], [], 'view')
        const fd = await open(parent, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          await this.gate([parent], [], 'view')
          await fd.sync()
        } finally {
          await fd.close()
        }
      }
      return join(this.overflowFolder(), `${id}.json`)
    }
    throw memoryFailure('capacity', 'Private overflow admission capacity exceeded')
  }
  private isLocallyActiveDraft(id: string) {
    const state = this.drafts.get(id)?.value.state
    return state === 'open' || state === 'ready'
  }
  private async save(v: Draft, initialPhysical?: string) {
    const raw = `${JSON.stringify(v)}\n`
    parseDraft(raw)
    await this.write(initialPhysical ?? (await this.manifest(v)), raw)
    this.drafts.set(v.id, { value: structuredClone(v), hash: digest(raw) })
    if (this.drafts.size > limits.views) {
      for (const [key, entry] of this.drafts) {
        if (key !== v.id && (entry.value.state === 'cancelled' || entry.value.state === 'committed')) {
          this.drafts.delete(key)
          if (this.drafts.size <= limits.views) break
        }
      }
    }
  }
  private async active(id: string, ready = false) {
    const stored = this.drafts.get(id)
    if (!stored) throw Error('Unknown view; persisted views require explicit recertified recovery')
    const v = structuredClone(stored.value)
    const { config, configHash } = await this.config()
    if (Date.now() >= v.deadline) throw memoryFailure('deadline', 'Memory view inactive')
    if (configHash !== v.configHash || (v.state !== 'open' && !(ready && v.state === 'ready')))
      throw Error('Memory view inactive')
    if (digest(await this.read(await this.manifest(v), 2 * 1024 * 1024)) !== stored.hash)
      throw Error('Private manifest changed externally')
    const refs = this.files(v)
    const paths = Object.keys(refs)
    // Observable view-wide logical-path checks, never body-wide hydration.
    await this.gate(
      paths.map((path) => join(this.root, path)),
      paths,
    )
    const overlays = Object.entries(refs).filter((entry): entry is [string, Overlay] => 'blob' in entry[1])
    await this.gate(
      overlays.map(([, ref]) => join(this.folder, 'blobs', ref.blob)),
      overlays.map(([path]) => path),
      'view',
    )
    let total = 0
    for (const [path, ref] of Object.entries(refs)) {
      if (!allowedPath(path, v.shared ? undefined : v.project) || ref.size > fileLimit(path, config))
        throw Error('Invalid view scope/budget')
      total += ref.size
      if ('blob' in ref) {
        const physical = join(this.folder, 'blobs', ref.blob)
        await safePath(physical)
        const stat = await lstat(physical)
        if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || stamp(stat) !== ref.identity)
          throw Error('Overlay identity changed externally')
      }
    }
    if (paths.length > limits.files || !refs['Core.md'] || !refs['index.md'] || total > config.totalBytes)
      throw Error('Memory layout/budget exceeded')
    const revision = await this.head()
    const ledger = await this.ledger(revision)
    if (Object.entries(refs).some(([path, ref]) => suppressed(ledger, path, ref.sources)))
      throw memoryFailure(
        'unknown',
        'Memory read unavailable: current forgetting; proposal retained',
        'forgetting',
      )
    return { v, refs, config, revision, ledger }
  }
  private async final(v: Draft, revision: string) {
    const after = await this.active(v.id, true)
    if (after.revision !== revision || !same(v, after.v))
      throw memoryFailure('CAS', 'Memory view/revision changed during operation', 'revision')
    await this.gate([this.root])
    if ((await this.head()) !== revision)
      throw memoryFailure('CAS', 'Memory revision changed at final fence', 'revision')
  }
  private async reclaimNamespaceCapacity(force = false) {
    const counts = {
      reclaimedDrafts: 0,
      reclaimedJournals: 0,
      reclaimedBlobs: 0,
    }
    const journal = join(this.folder, 'journal')
    const draftsFolder = join(this.folder, 'drafts')
    await this.gate([journal, draftsFolder], [], 'view')
    await privateDirectory(journal, true)
    await privateDirectory(draftsFolder, true)
    const rawDraftNames = (await readdir(draftsFolder)).sort()
    const draftNames: string[] = []
    for (const name of rawDraftNames) {
      if (force && name.endsWith('.tmp')) {
        const tmpPath = join(draftsFolder, name)
        await this.gate([tmpPath], [], 'view')
        await unlink(tmpPath).catch(() => {})
        continue
      }
      draftNames.push(name)
    }
    const journalNames = (await readdir(journal)).sort()
    if (!force && journalNames.length < overflowJournalCutoff && draftNames.length < limits.views)
      return counts
    const now = Date.now()
    const reconciledJournals: { path: string; planId: string; view: string }[] = []
    const ownerlessDirtyJournals: { path: string; planId: string; view: string }[] = []
    const activeJournalViews = new Set<string>()
    for (const name of journalNames) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) {
        if (!force) return counts
        continue
      }
      const path = join(journal, name)
      let record: OperationRecord
      try {
        record = parseOperation(await this.read(path, operationLimit))
      } catch {
        if (!force) return counts
        continue
      }
      if (!['reconciled_committed', 'not_committed_dirty'].includes(record.receipt.stage)) {
        if (!force) return counts
        activeJournalViews.add(record.immutable.plan.view)
        continue
      }
      if (record.receipt.stage === 'reconciled_committed')
        reconciledJournals.push({
          path,
          planId: record.immutable.plan.id,
          view: record.immutable.plan.view,
        })
      else if (record.owner === null)
        ownerlessDirtyJournals.push({
          path,
          planId: record.immutable.plan.id,
          view: record.immutable.plan.view,
        })
      else activeJournalViews.add(record.immutable.plan.view)
    }
    const allDraftIds = new Set<string>()
    const reclaimableDraftIds = new Set<string>()
    const reclaimableDrafts: { id: string; path: string; blobs: string[]; discarded: boolean }[] = []
    const retainedBlobs = new Set<string>()
    let unreadableDrafts = 0
    for (const name of draftNames) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) {
        unreadableDrafts++
        continue
      }
      const id = name.slice(0, -5)
      allDraftIds.add(id)
      const path = join(draftsFolder, name)
      try {
        const raw = await this.read(path, 2 * 1024 * 1024)
        const draft = parseDraft(raw)
        if (draft.id !== id) {
          unreadableDrafts++
          continue
        }
        const blobs = Object.values(draft.overlay)
          .filter((ref): ref is Overlay => ref !== null)
          .map((ref) => ref.blob)
        const discarded =
          draft.state === 'conflict' && (force || now >= draft.deadline)
            ? await this.retainedDiscarded(id, digest(raw)).catch(() => false)
            : false
        const reclaimable =
          !this.isLocallyActiveDraft(id) &&
          !activeJournalViews.has(id) &&
          (draft.state === 'committed' ||
            (force && (draft.state === 'cancelled' || (draft.state === 'conflict' && discarded))) ||
            (now >= draft.deadline && (draft.state !== 'conflict' || discarded)))
        if (reclaimable) {
          reclaimableDraftIds.add(id)
          reclaimableDrafts.push({ id, path, blobs, discarded })
        } else {
          for (const blob of blobs) retainedBlobs.add(blob)
        }
      } catch {
        // Leave unreadable/invalid draft manifests untouched for strict callers to report.
        unreadableDrafts++
      }
    }
    const allOverflowIds = new Set<string>()
    const expiredCommittedOverflowIds = new Set<string>()
    const overflowFolder = this.overflowFolder()
    await this.gate([overflowFolder], [], 'view')
    try {
      await safePath(overflowFolder)
      await privateDirectory(overflowFolder)
      for (const name of (await readdir(overflowFolder)).sort()) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue
        const id = name.slice(0, -5)
        allOverflowIds.add(id)
        const path = join(overflowFolder, name)
        try {
          const draft = parseDraft(await this.read(path, 2 * 1024 * 1024))
          if (draft.id !== id) {
            unreadableDrafts++
            continue
          }
          for (const ref of Object.values(draft.overlay)) if (ref !== null) retainedBlobs.add(ref.blob)
          if (
            draft.state === 'committed' &&
            (force || now >= draft.deadline) &&
            !this.isLocallyActiveDraft(id) &&
            !activeJournalViews.has(id)
          )
            expiredCommittedOverflowIds.add(id)
        } catch {
          // Ignore unreadable overflow manifests during best-effort reclamation.
          unreadableDrafts++
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const unlinkJournal = async (entry: { path: string; planId: string }) => {
      await this.gate([entry.path], [], 'view')
      await unlink(entry.path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
      this.plans.delete(entry.planId)
      const staging = join(this.folder, 'staging', entry.planId)
      await this.gate([staging], [], 'view')
      await rmdir(staging).catch(() => {})
    }
    for (const entry of reconciledJournals) {
      if (!force && !reclaimableDraftIds.has(entry.view) && !expiredCommittedOverflowIds.has(entry.view))
        continue
      await unlinkJournal(entry)
      counts.reclaimedJournals++
    }
    for (const entry of ownerlessDirtyJournals) {
      if (!force && !reclaimableDraftIds.has(entry.view)) continue
      await unlinkJournal(entry)
      counts.reclaimedJournals++
    }
    for (const entry of reclaimableDrafts) {
      await this.gate([entry.path], [], 'view')
      await unlink(entry.path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
      counts.reclaimedDrafts++
      if (entry.discarded) {
        const marker = join(this.folder, 'discarded', `${entry.id}.json`)
        await this.gate([marker], [], 'view')
        await unlink(marker).catch(() => {})
      }
      this.drafts.delete(entry.id)
      this.managementLedgers.delete(entry.id)
      for (const blob of entry.blobs) {
        if (retainedBlobs.has(blob)) continue
        const blobPath = join(this.folder, 'blobs', blob)
        await this.gate([blobPath], [], 'view')
        await unlink(blobPath).catch(() => {})
        counts.reclaimedBlobs++
      }
    }
    if (force && unreadableDrafts === 0) {
      const blobsFolder = join(this.folder, 'blobs')
      await this.gate([blobsFolder], [], 'view')
      try {
        await safePath(blobsFolder)
        await privateDirectory(blobsFolder)
        for (const name of (await readdir(blobsFolder)).sort()) {
          if (!uuidPattern.test(name) || retainedBlobs.has(name)) continue
          const blobPath = join(blobsFolder, name)
          await this.gate([blobPath], [], 'view')
          await unlink(blobPath).catch(() => {})
          counts.reclaimedBlobs++
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return counts
  }
  private async initializeNamespace() {
    await this.gate([this.folder], [], 'view')
    await privateDirectory(this.folder, true)
    await this.reclaimNamespaceCapacity()
    const journal = join(this.folder, 'journal')
    await this.gate([journal], [], 'view')
    await privateDirectory(journal, true)
    const names = await readdir(journal)
    if (names.length >= 64)
      throw memoryFailure('capacity', 'Unreconciled journal capacity requires explicit maintenance')
    // Never import/trust persisted manifests/certificates or silently reclaim proposals.
    for (const name of names) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw Error('Unknown operation/CAS entry blocks mutation')
      let value: OperationRecord
      try {
        value = parseOperation(await this.read(join(journal, name), operationLimit))
      } catch {
        throw Error('Unreconciled or invalid durable operation blocks mutation')
      }
      if (!['reconciled_committed', 'not_committed_dirty'].includes(value.receipt.stage))
        throw Error('Unreconciled publication blocks mutation; no replay')
    }
  }
  private async migrationExport(args: Input<'manage'>) {
    if (args.action !== 'migration-export') throw Error('Invalid memory migration export')
    const { config, configHash } = await this.config()
    if (!config.projects.some((project) => project.id === args.project))
      throw Error('Explicit mapped management scope required')
    const revision = await this.head()
    if (typeof args.revision !== 'string' || args.revision !== revision)
      throw memoryFailure('CAS', 'Stale memory revision')
    const raw = await this.git(['show', `${revision}:.memory.json`], ['.memory.json'])
    const ledger = parseLedger(raw)
    const offset = args.offset ?? 0
    const limit = args.limit ?? migrationExportPageLimit
    const contentHashes: Record<string, string> = {}
    if (args.section === 'sources') {
      const index = migrationSourceIndex(ledger)
      if (offset > index.length) throw Error('Invalid memory migration export')
      for (const row of index.slice(offset, offset + limit))
        contentHashes[row.path] = digest(
          await this.git(['cat-file', 'blob', `${revision}:${row.path}`], [row.path]),
        )
    }
    const page = pageMigrationExport({
      revision,
      configHash,
      ledgerDigest: canonicalLedgerDigest(raw),
      ledger,
      section: args.section ?? '',
      offset,
      limit,
      contentHashes,
    })
    if ((await this.head()) !== revision) throw memoryFailure('CAS', 'Stale memory revision')
    return page
  }
  private async management(args: Input<'manage'>) {
    if (args.action === 'migration-export') return { migrationExport: await this.migrationExport(args) }
    if (args.action === 'cleanup') {
      const { config } = await this.config()
      if (!config.projects.some((project) => project.id === args.project))
        throw Error('Explicit mapped management scope required')
      if (await this.exactLock(null)) {
        const journal = join(this.folder, 'journal')
        await this.gate([journal], [], 'view')
        await privateDirectory(journal, true)
        for (const name of (await readdir(journal)).sort()) {
          if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue
          try {
            const record = parseOperation(await this.read(join(journal, name), operationLimit))
            if (record.owner !== null || record.receipt.stage !== 'prepared' || record.sequence !== 0)
              continue
            const receipt = await this.outcome(record, false, true)
            if (receipt.stage !== 'not_committed_dirty' || receipt.indexDirty || receipt.worktreeDirty)
              continue
            const next = await this.updateOperation(record, receipt)
            const cached = this.plans.get(record.immutable.plan.id)
            if (cached) {
              cached.record = next
              cached.receipt = next.receipt
            }
            const viewId = record.immutable.plan.view
            if (!this.isLocallyActiveDraft(viewId)) {
              const draftPath = join(this.folder, 'drafts', `${viewId}.json`)
              try {
                const draft = parseDraft(await this.read(draftPath, 2 * 1024 * 1024))
                if (draft.id === viewId && (draft.state === 'ready' || draft.state === 'open')) {
                  draft.state = 'cancelled'
                  await this.save(draft)
                }
              } catch {
                // Ignore missing/unreadable draft during best-effort prepared journal retirement.
              }
            }
          } catch {
            // Leave non-reconcilable records untouched for strict inspection.
          }
        }
      }
      const counts = await this.reclaimNamespaceCapacity(true)
      return {
        cleanup: {
          cleaned: true as const,
          ...counts,
        },
      }
    }
    const { config, configHash } = await this.config()
    const now = await this.certify(config, configHash)
    const scope = args.project
    if (args.action === 'doctor') {
      const activePaths = Object.keys(now.refs).filter((p) => !suppressed(now.ledger, p, now.refs[p].sources))
      let totalBytesUsed = 0
      let alwaysLoadedBytes = 0
      const missingDescriptions: string[] = []
      const unmigratedV1Paths: string[] = []
      const descriptionPaths: string[] = []
      for (const p of activePaths) {
        totalBytesUsed += now.refs[p].size
        if (p === 'Core.md' || p === 'index.md' || isAlwaysLoadedTieredPath(p, scope))
          alwaysLoadedBytes += now.refs[p].size
        if (p.startsWith('reference/') || /^projects\/[^/]+\/reference\//.test(p)) descriptionPaths.push(p)
        if (p.startsWith('global/') || p.startsWith('deferred/')) unmigratedV1Paths.push(p)
      }
      const descriptionTexts = await this.bodies(descriptionPaths.map((p) => [p, now.refs[p]]))
      for (const p of descriptionPaths)
        if (!extractFrontmatterAndLinks(descriptionTexts[p]).description) missingDescriptions.push(p)
      const episodes = (await this.episodeNames()).length
      const legacy = await this.names(join(this.root, '.views'), /^[a-f0-9-]{36}\.json$/)
      const modern = await this.modernManifests()
      const conflicts = (await this.retainedConflictCandidates(scope)).length
      return {
        doctor: {
          revision: now.revision,
          project: scope,
          healthy: totalBytesUsed <= config.totalBytes,
          fileCount: activePaths.length,
          fileCeiling: limits.files,
          totalBytesUsed,
          totalBytesCeiling: config.totalBytes,
          alwaysLoadedBytes,
          episodes,
          views: legacy.length + modern.length,
          conflicts,
          missingDescriptions,
          unmigratedV1Paths,
        },
      }
    }
    if (args.action === 'palace') {
      const activePaths = Object.keys(now.refs)
        .filter((p) => !suppressed(now.ledger, p, now.refs[p].sources))
        .sort()
      const fileSizes: Record<string, number> = {}
      const fileSources: Record<string, string[]> = {}
      const inspectPaths: string[] = []
      for (const p of activePaths) {
        fileSizes[p] = now.refs[p].size
        fileSources[p] = now.refs[p].sources
        if (!p.startsWith('archives/')) inspectPaths.push(p)
      }
      const fileTexts = await this.bodies(inspectPaths.map((p) => [p, now.refs[p]]))
      const episodes = (await this.episodeNames()).length
      const legacy = await this.names(join(this.root, '.views'), /^[a-f0-9-]{36}\.json$/)
      const modern = await this.modernManifests()
      if (legacy.length + modern.filter((entry) => !entry.overflow).length > limits.views)
        throw memoryFailure('capacity', 'Private view capacity exceeded')
      const viewCounts = {
        total: legacy.length + modern.length,
        open: 0,
        conflict: 0,
        committed: 0,
        cancelled: 0,
      }
      const isDiscarded = async (id: string, rawHash: string) => {
        const marker = join(this.folder, 'discarded', `${id}.json`)
        try {
          const discarded = JSON.parse(await this.read(marker, 1024))
          if (
            !objectShape(discarded, ['id', 'hash']) ||
            Object.keys(discarded).length !== 2 ||
            discarded.id !== id ||
            discarded.hash !== rawHash
          )
            throw Error('Invalid retained discard marker')
          return true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
          throw error
        }
      }
      for (const name of legacy) {
        const id = name.slice(0, -5)
        const raw = await this.read(join(this.root, '.views', name), 40 * 1024 * 1024)
        const v = legacyView(raw, id)
        const state = v.state === 'conflict' && (await isDiscarded(id, digest(raw))) ? 'cancelled' : v.state
        viewCounts[state]++
      }
      for (const { id, physical } of modern) {
        const raw = await this.read(physical, 2 * 1024 * 1024)
        const d = parseDraft(raw)
        if (d.id !== id) throw Error('Invalid persisted view metadata')
        const mapped = d.state === 'ready' ? 'open' : d.state
        const state = mapped === 'conflict' && (await isDiscarded(id, digest(raw))) ? 'cancelled' : mapped
        viewCounts[state]++
      }
      const pendingOperations: { id: string; digest: string; stage: Stage; recordBytes: number }[] = []
      const journalNames = await this.names(join(this.folder, 'journal'), /^[a-f0-9-]{36}\.json$/)
      for (const name of journalNames) {
        const raw = await this.read(join(this.folder, 'journal', name), operationLimit)
        const record = parseOperation(raw)
        if (!['reconciled_committed', 'not_committed_dirty'].includes(record.receipt.stage))
          pendingOperations.push({
            id: record.immutable.plan.id,
            digest: record.immutable.plan.digest,
            stage: record.receipt.stage,
            recordBytes: bytes(raw),
          })
      }
      return {
        palace: buildMemoryPalace({
          revision: now.revision,
          project: scope,
          config,
          activePaths,
          fileSizes,
          fileSources,
          fileTexts,
          views: viewCounts,
          episodes: {
            total: episodes,
            reviewed: now.ledger.reviewed.length,
          },
          tombstones: {
            forgottenPaths: now.ledger.forgottenPaths.length,
            forgottenSources: now.ledger.forgottenSources.length,
          },
          pendingOperations,
        }),
      }
    }
    if (args.revision !== undefined && now.revision !== args.revision)
      throw memoryFailure('CAS', 'Stale memory revision')
    let ledger = structuredClone(now.ledger)
    const next = { ...now.refs }
    const writeNewOverlay = async (v: Draft, path: string, text: string, sources: string[]) => {
      validateFileText(path, text, sources, config)
      const blob = randomUUID()
      const physical = join(this.folder, 'blobs', blob)
      await this.write(physical, text, [path])
      bump(this.counters.overlayWrites, path)
      v.overlay[path] = {
        blob,
        hash: digest(text),
        size: bytes(text),
        sources,
        identity: stamp(await lstat(physical)),
      }
    }
    if (args.action === 'init-project' || args.action === 'migrate-v2') {
      const legacyEntries = Object.entries(now.refs).filter(
        ([path]) => path.startsWith('global/') || path.startsWith('deferred/'),
      )
      if (
        (args.action === 'init-project' &&
          now.refs[`projects/${scope}/system/overview.md`] &&
          now.refs[`projects/${scope}/system/conventions.md`] &&
          now.refs[`projects/${scope}/system/index.md`]) ||
        (args.action === 'migrate-v2' && now.refs['system/persona.md'] && !legacyEntries.length)
      )
        return { revision: now.revision, added: [], changed: false }
      const created = (await this.dispatch('create', { project: scope, shared: true, ttlMs: 600000 })) as {
        view: string
        base: string
      }
      const v = this.drafts.get(created.view)!.value
      v.deadline = Date.now() + maintenanceViewTtl
      await this.save(v)
      const added: string[] = []
      if (args.action === 'init-project') {
        const overviewPath = `projects/${scope}/system/overview.md`
        const conventionsPath = `projects/${scope}/system/conventions.md`
        const indexPath = `projects/${scope}/system/index.md`
        if (!now.refs[overviewPath]) {
          await writeNewOverlay(
            v,
            overviewPath,
            `---\nname: ${scope}-overview\ndescription: Architecture and project overview for ${scope}\n---\n# Project Overview (${scope})\n\n- Active repository context and boundaries.\n`,
            [],
          )
          added.push(overviewPath)
        }
        if (!now.refs[conventionsPath]) {
          await writeNewOverlay(
            v,
            conventionsPath,
            `---\nname: ${scope}-conventions\ndescription: Coding conventions and workflow rules for ${scope}\n---\n# Project Conventions (${scope})\n\n## Rules\n\n- Follow repository-local contracts and verification gates.\n`,
            [],
          )
          added.push(conventionsPath)
        }
        if (!now.refs[indexPath]) {
          await writeNewOverlay(
            v,
            indexPath,
            `---\nname: ${scope}-system-index\ndescription: System memory index for ${scope}\n---\n# ${scope} System Memory\n\n- [[overview.md]] — Architecture and project overview for ${scope}\n- [[conventions.md]] — Coding conventions and workflow rules for ${scope}\n`,
            [],
          )
          added.push(indexPath)
        }
      } else {
        const migrationEntries = Object.entries(now.refs).filter(
          ([path]) => path === 'Core.md' || path.startsWith('global/') || path.startsWith('deferred/'),
        )
        const migrationTexts = await this.bodies(migrationEntries)
        if (!now.refs['system/persona.md']) {
          const personaText =
            migrationTexts['Core.md'] === starterCore
              ? starterPersona
              : `---\nname: persona\ndescription: Single fixed Companion identity and collaboration posture\n---\n${migrationTexts['Core.md']}`
          await writeNewOverlay(v, 'system/persona.md', personaText, [...now.refs['Core.md'].sources])
          added.push('system/persona.md')
        }
        for (const [p, ref] of migrationEntries) {
          if (p === 'Core.md') continue
          const migration = legacyV1Migration(now.revision, p)
          const text = migrationTexts[p]
          const archive = now.refs[migration.archivePath]
          assertLegacyArchiveCompatible(
            migration.archivePath,
            archive && { hash: archive.hash, size: archive.size, sources: archive.sources },
            { hash: digest(text), size: bytes(text), sources: ref.sources },
          )
          if (!archive) await writeNewOverlay(v, migration.archivePath, text, [...ref.sources])
          if (!now.refs[migration.targetPath]) {
            await writeNewOverlay(v, migration.targetPath, withMigrationFrontmatter(text, migration), [
              ...ref.sources,
            ])
            added.push(migration.targetPath)
          }
          v.overlay[p] = null
        }
      }
      v.state = 'ready'
      await this.save(v)
      return { view: v.id, added, changed: true }
    }
    if (now.revision !== args.revision) throw memoryFailure('CAS', 'Stale memory revision')
    if (args.action === 'forget') {
      const { paths, sources } = args
      if (
        !Array.isArray(paths) ||
        !Array.isArray(sources) ||
        (!paths.length && !sources.length) ||
        paths.length > 128 ||
        sources.length > 128 ||
        paths.some((p) => !allowedPath(p, scope) || ['Core.md', 'index.md'].includes(p)) ||
        sources.some((s) => !validId(s))
      )
        throw Error('Invalid forgetting scope; revise Core/index explicitly')
      ledger.forgottenPaths = [...new Set([...ledger.forgottenPaths, ...paths])]
      for (const source of sources)
        for (const project of [scope, null])
          if (!ledger.forgottenSources.some((e) => e.project === project && e.source === source))
            ledger.forgottenSources.push({ project, source })
      for (const [path, ref] of Object.entries(next))
        if (
          allowedPath(path, scope) &&
          (paths.includes(path) || ref.sources.some((source) => sources.includes(source)))
        ) {
          if (['Core.md', 'index.md'].includes(path))
            throw Error(
              'Revise Core/index and remove the source link before forgetting; preserve established identity',
            )
          delete next[path]
        }
    } else {
      if (typeof args.target !== 'string' || !revisionPattern.test(args.target))
        throw Error('Invalid rollback revision')
      const old = await this.certify(config, configHash, args.target)
      for (const path of Object.keys(next)) if (allowedPath(path, scope)) delete next[path]
      for (const [path, ref] of Object.entries(old.refs))
        if (allowedPath(path, scope)) {
          if (!suppressed(now.ledger, path, ref.sources)) next[path] = ref
          else if (['Core.md', 'index.md'].includes(path)) next[path] = now.refs[path]
        }
    }
    ledger = {
      ...ledger,
      sources: Object.fromEntries(Object.entries(next).map(([path, ref]) => [path, ref.sources])),
    }
    parseLedger(JSON.stringify(ledger))
    const created = (await this.dispatch('create', { project: scope, shared: true, ttlMs: 600000 })) as {
      view: string
      base: string
    }
    const v = this.drafts.get(created.view)!.value
    v.deadline = Date.now() + maintenanceViewTtl
    await this.save(v)
    const changedPaths = [...new Set([...Object.keys(now.refs), ...Object.keys(next)])].filter(
      (path) => !sameContent(now.refs[path], next[path]),
    )
    const changedTexts = await this.bodies(
      changedPaths.filter((path) => next[path]).map((path) => [path, next[path]]),
    )
    for (const path of changedPaths) {
      if (!next[path]) v.overlay[path] = null
      else {
        const text = changedTexts[path]
        const blob = randomUUID()
        const physical = join(this.folder, 'blobs', blob)
        await this.write(physical, text, [path])
        bump(this.counters.overlayWrites, path)
        v.overlay[path] = {
          blob,
          hash: digest(text),
          size: bytes(text),
          sources: next[path].sources,
          identity: stamp(await lstat(physical)),
        }
      }
    }
    v.state = 'ready'
    await this.save(v)
    this.managementLedgers.set(v.id, ledger)
    const result = (await this.dispatch('prepare', { view: v.id, reviewed: [] })) as
      | { plan: Plan }
      | { conflict: string[] }
    if (!('plan' in result)) throw Error('Management revision conflict; proposal retained')
    return result
  }
  private async capacityNamespace(
    folder: string,
    pattern: RegExp,
    thresholds: {
      status?: number
      doctor?: number
      admissionEntries?: number
      admissionMatching?: number
      admissionMatchingMayPrune?: number
    },
  ): Promise<CapacityNamespace> {
    await this.gate([folder], [], 'view')
    await safePath(folder)
    let entries = 0
    let matching = 0
    let exact = true
    try {
      await privateDirectory(folder)
      const directory = await opendir(folder)
      try {
        for await (const entry of directory) {
          entries++
          if (pattern.test(entry.name)) matching++
          if (entries > 8192) {
            exact = false
            break
          }
        }
      } finally {
        await directory.close().catch(() => {})
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const state = (threshold: number | undefined) => {
      if (threshold === undefined) return 'not-applicable' as const
      if (matching > threshold) return 'blocked' as const
      return exact ? ('available' as const) : ('unknown' as const)
    }
    const admission = () => {
      if (thresholds.admissionEntries !== undefined && entries >= thresholds.admissionEntries)
        return 'blocked' as const
      if (thresholds.admissionMatching !== undefined && matching >= thresholds.admissionMatching)
        return 'blocked' as const
      if (thresholds.admissionMatchingMayPrune !== undefined) {
        if (matching > thresholds.admissionMatchingMayPrune) return 'blocked' as const
        if (matching === thresholds.admissionMatchingMayPrune) return 'unknown' as const
      }
      if (
        thresholds.admissionEntries === undefined &&
        thresholds.admissionMatching === undefined &&
        thresholds.admissionMatchingMayPrune === undefined
      )
        return 'not-applicable' as const
      return exact ? ('available' as const) : ('unknown' as const)
    }
    return {
      entries,
      matching,
      exact,
      status: state(thresholds.status),
      doctor: state(thresholds.doctor),
      admission: admission(),
    }
  }
  private async capacityDiagnostic(): Promise<CapacityDiagnostic> {
    const { configHash } = await this.config()
    const revision = await this.head()
    const namespaces = {
      journal: await this.capacityNamespace(join(this.folder, 'journal'), /^[a-f0-9-]{36}\.json$/, {
        status: limits.views,
        admissionEntries: limits.views,
      }),
      legacyViews: await this.capacityNamespace(join(this.root, '.views'), /^[a-f0-9-]{36}\.json$/, {
        doctor: limits.views,
      }),
      drafts: await this.capacityNamespace(join(this.folder, 'drafts'), /^[a-f0-9-]{36}\.json$/, {
        doctor: limits.views,
      }),
      overflowDrafts: await this.capacityNamespace(this.overflowFolder(), /^[a-f0-9-]{36}\.json$/, {}),
      overflowSlots: await this.capacityNamespace(
        join(this.overflowFolder(), 'slots'),
        /^(?:[0-2][0-9]|3[01])$/,
        {},
      ),
      episodes: await this.capacityNamespace(join(this.root, '.episodes'), /^[a-f0-9]{64}\.json$/, {
        doctor: 256,
        admissionMatchingMayPrune: 256,
      }),
    }
    // Namespace headroom is not manifest/owner integrity certification. Never read bodies here.
    const drafts = namespaces.drafts
    drafts.admission =
      drafts.entries > limits.views
        ? 'blocked'
        : !drafts.exact
          ? 'unknown'
          : drafts.entries < limits.views
            ? 'available'
            : namespaces.journal.entries >= overflowJournalCutoff ||
                namespaces.overflowSlots.matching >= overflowLimit
              ? 'blocked'
              : namespaces.journal.exact && namespaces.overflowSlots.exact
                ? 'available'
                : 'unknown'
    const names = Object.keys(namespaces) as (keyof typeof namespaces)[]
    const retainedViews = {
      matching: namespaces.legacyViews.matching + namespaces.drafts.matching,
      exact: namespaces.legacyViews.exact && namespaces.drafts.exact,
      doctor:
        namespaces.legacyViews.matching + namespaces.drafts.matching > limits.views
          ? ('blocked' as const)
          : namespaces.legacyViews.exact && namespaces.drafts.exact
            ? ('available' as const)
            : ('unknown' as const),
    }
    const blockers = {
      status: names.filter((name) => namespaces[name].status === 'blocked'),
      doctor: [
        ...names.filter((name) => namespaces[name].doctor === 'blocked'),
        ...(retainedViews.doctor === 'blocked' ? (['retainedViews'] as const) : []),
      ],
      admission: names.filter((name) => namespaces[name].admission === 'blocked'),
    }
    const statusUnknown = names.some((name) => namespaces[name].status === 'unknown')
    if ((await this.config()).configHash !== configHash || (await this.head()) !== revision)
      throw memoryFailure('CAS', 'Capacity diagnostic state changed')
    return {
      version: 2,
      kind: 'abi2-capacity-diagnostic',
      revision,
      configHash,
      scanLimit: 8192,
      association: 'sequential-non-atomic',
      namespaces,
      derived: { retainedViews },
      blockers,
      classification: blockers.status.length
        ? 'status-namespace-capacity'
        : statusUnknown
          ? 'inconclusive'
          : 'non-namespace-status-capacity',
      corpusReturned: false,
    }
  }
  private async retainedDraftPreview(): Promise<RetainedDraftPreview> {
    const { configHash } = await this.config()
    const revision = await this.head()
    const referenced = new Set<string>()
    let journalExact = true
    const journal = join(this.folder, 'journal')
    await this.gate([journal], [], 'view')
    await safePath(journal)
    try {
      await privateDirectory(journal)
      const directory = await opendir(journal)
      const names: string[] = []
      let seen = 0
      try {
        for await (const entry of directory) {
          await this.gate([journal], [], 'view')
          this.signal?.throwIfAborted()
          seen++
          if (seen > 8192) {
            journalExact = false
            break
          }
          if (!/^[a-f0-9-]{36}\.json$/.test(entry.name)) {
            journalExact = false
            continue
          }
          names.push(entry.name)
        }
      } finally {
        await directory.close().catch(() => {})
      }
      for (const name of names) {
        let text: string
        try {
          text = await this.read(join(journal, name), operationLimit)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          journalExact = false
          continue
        }
        try {
          referenced.add(parseOperation(text).immutable.plan.view)
        } catch {
          journalExact = false
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const observed = {
      examined: 0,
      exact: true,
      terminal: 0,
      open: 0,
      ready: 0,
      conflict: 0,
      unknown: 0,
      dirty: 0,
      journalReferenced: 0,
      locallyActive: 0,
      unstable: 0,
    }
    const folder = join(this.folder, 'drafts')
    await this.gate([folder], [], 'view')
    await safePath(folder)
    try {
      await privateDirectory(folder)
      const directory = await opendir(folder)
      const names: string[] = []
      let seen = 0
      try {
        for await (const entry of directory) {
          await this.gate([folder], [], 'view')
          this.signal?.throwIfAborted()
          seen++
          if (seen > 8192) {
            observed.exact = false
            break
          }
          observed.examined++
          if (!/^[a-f0-9-]{36}\.json$/.test(entry.name)) {
            observed.exact = false
            continue
          }
          names.push(entry.name)
        }
      } finally {
        await directory.close().catch(() => {})
      }
      for (const name of names) {
        const id = name.slice(0, -5)
        const path = join(folder, name)
        let first: string
        let second: string
        try {
          first = await this.read(path, 2 * 1024 * 1024)
          second = await this.read(path, 2 * 1024 * 1024)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          observed.unstable++
          observed.exact = false
          continue
        }
        const kind = classifyRetainedManifest({
          id,
          first,
          second,
          referenced: referenced.has(id),
          locallyActive: this.isLocallyActiveDraft(id),
        })
        if (kind === 'unstable') observed.exact = false
        observed[kind]++
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const { id, physical } of await this.overflowManifests()) {
      observed.examined++
      let first: string
      let second: string
      try {
        first = await this.read(physical, 2 * 1024 * 1024)
        second = await this.read(physical, 2 * 1024 * 1024)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        observed.unstable++
        observed.exact = false
        continue
      }
      const kind = classifyRetainedManifest({
        id,
        first,
        second,
        referenced: referenced.has(id),
        locallyActive: this.isLocallyActiveDraft(id),
      })
      if (kind === 'unstable') observed.exact = false
      observed[kind]++
    }
    if (!journalExact || !observed.exact) {
      observed.unknown += observed.terminal
      observed.terminal = 0
      observed.exact = false
    }
    if ((await this.config()).configHash !== configHash || (await this.head()) !== revision)
      throw memoryFailure('CAS', 'Retained draft preview changed')
    return {
      version: 1,
      kind: 'abi2-retained-draft-preview',
      revision,
      configHash,
      scanLimit: 8192,
      association: 'sequential-non-atomic',
      quiescence: 'unproven',
      mutation: 'not-performed',
      safeCandidates: 0,
      reason: 'cross-controller-exclusion-unproven',
      observed,
      corpusReturned: false,
    }
  }
  private async names(folder: string, pattern: RegExp) {
    await this.gate([folder], [], 'view')
    await safePath(folder)
    try {
      await privateDirectory(folder)
      const names = (await readdir(folder)).filter((name) => pattern.test(name)).sort()
      if (names.length > limits.views) throw memoryFailure('capacity', 'Private view capacity exceeded')
      return names
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  private async retained(
    id: string,
    modern: boolean,
    prepared?: { raw: string; draft: Draft; physical: string },
  ): Promise<{ v: View; rawHash: string; physical: string }> {
    const physical =
      prepared?.physical ?? (modern ? await this.manifest({ id }) : join(this.root, '.views', `${id}.json`))
    const raw = prepared?.raw ?? (await this.read(physical, modern ? 2 * 1024 * 1024 : 40 * 1024 * 1024))
    if (!modern) {
      const v = legacyView(raw, id)
      await this.gate(
        Object.keys(v.files).map((p) => join(this.root, p)),
        Object.keys(v.files),
        'view',
      )
      return { v, rawHash: digest(raw), physical }
    }
    const d = prepared?.draft ?? parseDraft(raw)
    if (
      !objectShape(d, [
        'version',
        'id',
        'project',
        'shared',
        'configHash',
        'base',
        'overlay',
        'state',
        'deadline',
      ]) ||
      Object.keys(d).length !== 9 ||
      d.version !== 2 ||
      d.id !== id ||
      !uuidPattern.test(id) ||
      typeof d.project !== 'string' ||
      !idPattern.test(d.project) ||
      typeof d.shared !== 'boolean' ||
      typeof d.configHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(d.configHash) ||
      !Number.isSafeInteger(d.deadline) ||
      !['open', 'ready', 'conflict', 'committed', 'cancelled'].includes(d.state) ||
      !objectShape(d.base, ['revision', 'refs', 'ledger']) ||
      Object.keys(d.base).length !== 3 ||
      !d.overlay ||
      typeof d.overlay !== 'object' ||
      Array.isArray(d.overlay) ||
      Object.keys(d.overlay).length > limits.changes - 1
    )
      throw Error('Invalid persisted view metadata')
    const ledger = parseLedger(JSON.stringify(d.base.ledger))
    const c = (await this.config()).config
    const certified = await this.certify({ ...c, ...recoveryCeiling }, d.configHash, d.base.revision)
    const refs = Object.fromEntries(
      Object.entries(certified.refs).filter(([p]) => allowedPath(p, d.shared ? undefined : d.project)),
    )
    if (!same(refs, d.base.refs) || !same(ledger, certified.ledger))
      throw Error('Persisted base differs from recertified revision')
    for (const [path, ref] of Object.entries(d.overlay)) {
      if (!allowedPath(path, d.shared ? undefined : d.project)) throw Error('Invalid persisted overlay scope')
      if (ref === null) {
        if (['Core.md', 'index.md'].includes(path)) throw Error('Invalid persisted removal')
        continue
      }
      if (
        !objectShape(ref, ['blob', 'hash', 'size', 'sources', 'identity']) ||
        Object.keys(ref).length !== 5 ||
        typeof ref.blob !== 'string' ||
        !uuidPattern.test(ref.blob) ||
        typeof ref.hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(ref.hash) ||
        !Number.isSafeInteger(ref.size) ||
        ref.size < 0 ||
        ref.size > limits.file ||
        typeof ref.identity !== 'string' ||
        !Array.isArray(ref.sources)
      )
        throw Error('Invalid persisted overlay metadata')
    }
    const files: Record<string, MemoryFile> = {}
    const retainedRefs = Object.entries(this.files(d))
    const retainedTexts = await this.bodies(retainedRefs)
    for (const [path, ref] of retainedRefs) files[path] = { text: retainedTexts[path], sources: ref.sources }
    validateFiles(files, d.shared ? undefined : d.project)
    return {
      v: {
        id,
        project: d.project,
        ...(d.shared ? { scope: 'primary' as const } : {}),
        configHash: d.configHash,
        base: {
          revision: d.base.revision,
          files: {},
          forgottenPaths: ledger.forgottenPaths,
          forgottenSources: ledger.forgottenSources,
          reviewed: ledger.reviewed,
        },
        files,
        state: d.state === 'ready' ? 'open' : d.state,
        deadline: d.deadline,
      },
      rawHash: digest(raw),
      physical,
    }
  }
  private async retainedDiscarded(id: string, rawHash: string) {
    const marker = join(this.folder, 'discarded', `${id}.json`)
    try {
      const discarded = JSON.parse(await this.read(marker, 1024))
      if (
        !objectShape(discarded, ['id', 'hash']) ||
        Object.keys(discarded).length !== 2 ||
        discarded.id !== id ||
        discarded.hash !== rawHash
      )
        throw Error('Invalid retained discard marker')
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  private retainedDraftFileCount(draft: Draft) {
    const sizes = new Map(Object.entries(draft.base.refs).map(([path, ref]) => [path, ref.size]))
    for (const [path, ref] of Object.entries(draft.overlay)) {
      if (ref === null) sizes.delete(path)
      else sizes.set(path, ref.size)
    }
    if (
      !sizes.has('Core.md') ||
      !sizes.has('index.md') ||
      sizes.size > limits.files ||
      [...sizes].some(([path, size]) => size > fileLimit(path, recoveryCeiling))
    )
      throw Error('Invalid retained layout')
    const total = [...sizes.values()].reduce((sum, size) => sum + size, 0)
    if (total > limits.total) throw Error('Invalid retained total budget')
    return sizes.size
  }
  private async retainedConflictCandidates(project: string) {
    const legacy = await this.names(join(this.root, '.views'), /^[a-f0-9-]{36}\.json$/)
    const modern = await this.modernManifests()
    if (legacy.length + modern.filter((entry) => !entry.overflow).length > limits.views)
      throw memoryFailure('capacity', 'Private view capacity exceeded')
    const matches: RetainedConflictCandidate[] = []
    for (const name of legacy) {
      const id = name.slice(0, -5)
      const physical = join(this.root, '.views', name)
      const raw = await this.read(physical, 40 * 1024 * 1024)
      const view = legacyView(raw, id)
      if (view.project !== project || view.state !== 'conflict') continue
      const rawHash = digest(raw)
      if (await this.retainedDiscarded(id, rawHash)) continue
      matches.push({
        id,
        baseRevision: view.base.revision,
        fileCount: Object.keys(view.files).length,
        modern: false,
        raw,
        rawHash,
        physical,
      })
    }
    for (const { id, physical } of modern) {
      const raw = await this.read(physical, 2 * 1024 * 1024)
      const draft = parseDraft(raw)
      if (draft.id !== id) throw Error('Invalid persisted view metadata')
      if (draft.project !== project || draft.state !== 'conflict') continue
      const rawHash = digest(raw)
      if (await this.retainedDiscarded(id, rawHash)) continue
      matches.push({
        id,
        baseRevision: draft.base.revision,
        fileCount: this.retainedDraftFileCount(draft),
        modern: true,
        raw,
        rawHash,
        physical,
        draft,
      })
    }
    return matches
  }
  private async retainedConflict(project: string, target: string, candidates?: RetainedConflictCandidate[]) {
    const candidate = (candidates ?? (await this.retainedConflictCandidates(project))).find(
      ({ id }) => id === target,
    )
    if (!candidate) throw Error('Unknown scoped conflict')
    const selected = candidate.modern
      ? await this.retained(candidate.id, true, {
          raw: candidate.raw,
          draft: candidate.draft!,
          physical: candidate.physical,
        })
      : await this.retained(candidate.id, false)
    if (selected.rawHash !== candidate.rawHash) throw Error('Retained view changed during recovery')
    return selected
  }
  private async conflicts(args: Input<'conflicts'>) {
    const offset = args.offset ?? 0
    const limit = args.limit ?? 4096
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 4096 ||
      (args.path === undefined && (offset !== 0 || limit !== 4096))
    )
      throw Error('Invalid conflict paging')
    const { configHash } = await this.config()
    const revision = await this.head()
    const ledger = await this.ledger(revision)
    const candidates = await this.retainedConflictCandidates(args.project)
    let result: Record<string, unknown>
    if (args.target === undefined)
      result = {
        conflicts: candidates.slice(0, 8).map(({ id, baseRevision, fileCount }) => ({
          id,
          baseRevision,
          fileCount,
        })),
        total: candidates.length,
      }
    else {
      const selected = await this.retainedConflict(args.project, args.target, candidates)
      const { v } = selected
      if (args.path === undefined) result = { id: v.id, files: Object.keys(v.files).sort() }
      else {
        const path = args.path
        if (!allowedPath(path, v.scope === 'primary' ? undefined : args.project))
          throw Error('Path outside conflict scope')
        const file = v.files[path]
        if (!file) result = { id: v.id, path, removed: true }
        else if (suppressed(ledger, path, file.sources))
          result = { id: v.id, path, suppressedByForgetting: true }
        else {
          const text = [...file.text]
          const current = ledger.sources[path]
            ? await this.git(['show', `${revision}:${path}`], [path])
            : undefined
          result = {
            id: v.id,
            path,
            text: text.slice(offset, offset + limit).join(''),
            offset,
            totalCharacters: text.length,
            truncated: offset > 0 || offset + limit < text.length,
            sources: file.sources,
            proposalHash: digest(file.text),
            currentHash: current === undefined ? null : digest(current),
            baseRevision: v.base.revision,
          }
        }
      }
      if (digest(await this.read(selected.physical, 40 * 1024 * 1024)) !== selected.rawHash)
        throw Error('Retained view changed during recovery')
    }
    if ((await this.config()).configHash !== configHash || (await this.head()) !== revision)
      throw Error('Conflict recovery revision changed')
    return result
  }
  private async discard(args: Input<'discard'>) {
    const selected = await this.retainedConflict(args.project, args.target)
    await this.initializeNamespace() // unknown mutation records are never discardable
    if ((await this.head()) !== args.revision) throw memoryFailure('CAS', 'Stale memory revision')
    if (digest(await this.read(selected.physical, 40 * 1024 * 1024)) !== selected.rawHash)
      throw Error('Retained view changed')
    await this.write(
      join(this.folder, 'discarded', `${args.target}.json`),
      `${JSON.stringify({ id: args.target, hash: selected.rawHash })}\n`,
    )
    return { discarded: args.target }
  }
  private async episodes(project: string) {
    const revision = await this.head()
    const ledger = await this.ledger(revision)
    const names = await this.episodeNames()
    const pending = []
    for (const name of names) {
      const id = name.slice(0, -5)
      if (
        ledger.reviewed.includes(id) ||
        ledger.forgottenSources.some((e) => e.source === id && e.project === project)
      )
        continue
      const e = observedEpisode(JSON.parse(await this.read(join(this.root, '.episodes', name), 16384)))
      if (e.id !== id) throw Error('Invalid episode filename identity')
      if (e.project === project) pending.push(e)
    }
    if ((await this.head()) !== revision) throw Error('Episode revision changed')
    return pending
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id))
      .slice(0, 4)
  }
  private async selectEpisodes(project: string, ids: readonly string[]) {
    const revision = await this.head()
    const ledger = await this.ledger(revision)
    const folder = join(this.root, '.episodes')
    const selected = []
    for (const id of ids) {
      let raw: string
      try {
        raw = await this.read(join(folder, `${id}.json`), 16384)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      const episode = observedEpisode(JSON.parse(raw))
      if (episode.id !== id) throw Error('Invalid episode filename identity')
      if (
        ledger.reviewed.includes(id) ||
        ledger.forgottenSources.some((entry) => entry.source === id && entry.project === project) ||
        episode.project !== project
      )
        continue
      selected.push(episode)
    }
    if ((await this.head()) !== revision) throw Error('Episode revision changed')
    return selected
  }
  private async episodeBacklog(project: string, limit: number, session?: string) {
    const revision = await this.head()
    const ledger = await this.ledger(revision)
    const pending = []
    for (const name of await this.episodeNames()) {
      const id = name.slice(0, -5)
      if (
        ledger.reviewed.includes(id) ||
        ledger.forgottenSources.some((entry) => entry.source === id && entry.project === project)
      )
        continue
      const episode = observedEpisode(JSON.parse(await this.read(join(this.root, '.episodes', name), 16384)))
      if (episode.id !== id) throw Error('Invalid episode filename identity')
      if (
        episode.project === project &&
        (session === undefined || 'kind' in episode || episode.session === session)
      )
        pending.push(episode)
    }
    if ((await this.head()) !== revision) throw Error('Episode revision changed')
    return {
      ids: pending
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((episode) => episode.id),
    }
  }
  private async episodeCredit(project: string, session: string) {
    const revision = await this.head()
    const ledger = await this.ledger(revision)
    let steps = 0
    for (const name of await this.episodeNames()) {
      const id = name.slice(0, -5)
      if (
        ledger.reviewed.includes(id) ||
        ledger.forgottenSources.some((entry) => entry.source === id && entry.project === project)
      )
        continue
      const episode = observedEpisode(JSON.parse(await this.read(join(this.root, '.episodes', name), 16384)))
      if (episode.id !== id) throw Error('Invalid episode filename identity')
      if (episode.project === project && episode.session === session) steps += episodeAssistantSteps(episode)
    }
    if ((await this.head()) !== revision) throw Error('Episode revision changed')
    return { steps }
  }
  private async episodeNames() {
    const folder = join(this.root, '.episodes')
    await this.gate([folder])
    await safePath(folder)
    try {
      await privateDirectory(folder)
      const names = (await readdir(folder)).filter((n) => /^[a-f0-9]{64}\.json$/.test(n)).sort()
      if (names.length > 256) throw Error('Episode backlog full')
      return names
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  private async observe(value: unknown) {
    // Acquire before fresh ledger/cleanup/count/create, not merely before per-ID publication.
    observedEpisode(value)
    return await withEpisodeAdmission(
      this.root,
      (targets) => this.gate(targets.physical, [], 'view'),
      () => this.observeAdmitted(value),
    )
  }
  private async observeAdmitted(value: unknown) {
    const e = observedEpisode(value)
    const automatic = async () => {
      if ('kind' in e && !(await this.config()).config.automatic)
        throw Error('Automatic compaction observation disabled')
    }
    await automatic()
    const revision = await this.head()
    const ledger = await this.ledger(revision)
    const forgotten = (id: string, project: string) =>
      ledger.forgottenSources.some((s) => s.source === id && s.project === project)
    if (forgotten(e.id, e.project)) throw Error('Forgotten episode cannot be re-admitted')
    const raw = `${JSON.stringify(e)}\n`
    const folder = join(this.root, '.episodes')
    const target = join(folder, `${e.id}.json`)
    const names = await this.episodeNames()
    if (names.includes(`${e.id}.json`)) {
      if ((await this.read(target, 16384)) !== raw) throw Error('Observed episode changed')
      return { recorded: true }
    }
    if (names.length >= 256) {
      const reclaim: string[] = []
      for (const name of names) {
        const id = name.slice(0, -5)
        const path = join(folder, name)
        const old = observedEpisode(JSON.parse(await this.read(path, 16384)))
        if (old.id !== id) throw Error('Invalid episode filename identity')
        if (ledger.reviewed.includes(id) || forgotten(id, old.project)) reclaim.push(path)
      }
      for (const path of reclaim) {
        await this.gate([path])
        await unlink(path)
      }
      if ((await this.episodeNames()).length >= 256)
        throw memoryFailure('capacity', 'Unreviewed episode capacity exceeded')
    }
    if ((await this.head()) !== revision) throw Error('Episode revision changed')
    await this.gate([target], [], 'view')
    const created = await createPrivate(
      target,
      raw,
      async () => {
        await automatic()
        if ((await this.head()) !== revision) throw Error('Episode revision changed')
      },
      (physical) => this.gate(physical, [], 'view'),
    )
    if (!created && (await this.read(target, 16384)) !== raw) throw Error('Observed episode changed')
    return { recorded: true }
  }
  private plan(id: string, hash: string) {
    const value = this.plans.get(id)
    if (!value || value.plan.digest !== hash) throw Error('Unknown or stale publication plan')
    return value
  }
  private async proposalFence(p: Prepared) {
    const stored = this.drafts.get(p.plan.view)
    if (!stored) throw Error('Publication proposal unavailable')
    const raw = await this.read(await this.manifest(stored.value), 2 * 1024 * 1024)
    const proposal = parseDraft(raw)
    if (
      stored.hash !== p.record.immutable.proposalHash ||
      digest(raw) !== p.record.immutable.proposalHash ||
      proposal.id !== p.plan.view ||
      proposal.state !== 'ready' ||
      proposal.configHash !== p.plan.configHash ||
      Date.now() >= proposal.deadline
    )
      throw Error('Publication proposal fence changed')
  }
  private async fence(p: Prepared) {
    const { configHash } = await this.config()
    if (configHash !== p.plan.configHash || (await this.head()) !== p.plan.current)
      throw Error('Publication data fence changed')
    await this.proposalFence(p)
    return { current: p.plan.current, configHash }
  }
  private operationPath(id: string) {
    if (!uuidPattern.test(id)) throw Error('Invalid operation identifier')
    return join(this.folder, 'journal', `${id}.json`)
  }
  private async loadOperation(id: string, hash: string) {
    const record = parseOperation(await this.read(this.operationPath(id), operationLimit))
    await this.gate([this.root])
    const root = await lstat(this.root)
    if (
      record.immutable.plan.id !== id ||
      record.immutable.plan.digest !== hash ||
      record.immutable.root !== this.root ||
      record.immutable.rootIdentity !== `${root.dev}:${root.ino}`
    )
      throw Error('Operation binding mismatch')
    return record
  }
  private async updateOperation(previous: OperationRecord, receipt: Receipt, owner = previous.owner) {
    validateReceipt(receipt)
    const path = this.operationPath(previous.immutable.plan.id)
    const cas = `${path}.cas`
    await this.gate([cas], [], 'view')
    await safePath(cas)
    await mkdir(cas, { mode: 0o700 }) // exclusive CAS; stale/malformed CAS is never stolen
    try {
      const actual = await this.read(path, operationLimit)
      if (digest(actual) !== digest(`${JSON.stringify(previous)}\n`))
        throw Error('Operation revision/CAS changed')
      const next = { ...previous, sequence: previous.sequence + 1, owner, receipt: structuredClone(receipt) }
      const raw = `${JSON.stringify(next)}\n`
      parseOperation(raw)
      await this.write(path, raw)
      return next
    } finally {
      await this.gate([cas], [], 'view')
      await rmdir(cas)
    }
  }
  private async exactLock(owner: LockOwner | null): Promise<boolean> {
    const lock = join(this.root, '.lock')
    await this.gate([lock, join(lock, 'owner.json')])
    try {
      let s
      try {
        s = await lstat(lock)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
        throw error
      }
      if (!owner || !s.isDirectory() || s.mode & 0o077 || `${s.dev}:${s.ino}` !== owner.directory)
        return false
      const actual = parseLockOwner(JSON.parse(await this.read(join(lock, 'owner.json'), 2048)))
      return same(actual, owner)
    } catch (error) {
      return false
    }
  }
  private async outcome(record: OperationRecord, drained: boolean, unpublished = false): Promise<Receipt> {
    const p = record.immutable
    const unknown = (detail: string, evidence: Partial<Receipt> = {}): Receipt => ({
      stage: 'unknown',
      detail,
      ...evidence,
    })
    const { config, configHash } = await this.config()
    await this.gate([this.root], [...new Set([...Object.keys(p.next), ...p.plan.changes.map((c) => c.path)])])
    if (configHash !== p.plan.configHash) return unknown('Configuration changed')
    // Persisted proposals are recertified evidence only; never reopened or registered for chunks.
    const raw = await this.read(await this.manifest({ id: p.plan.view }), 2 * 1024 * 1024)
    const proposal = parseDraft(raw)
    const normalized =
      proposal?.state === 'committed' ? `${JSON.stringify({ ...proposal, state: 'ready' })}\n` : raw
    if (digest(normalized) !== p.proposalHash) return unknown('Proposal evidence changed')
    const revision = await this.head()
    const indexDirty = !!(await this.git(['diff', '--cached', '--name-only', '-z', 'HEAD'])).length
    const worktreeDirty =
      !!(await this.git(['diff', '--name-only', '-z'])).length ||
      !!(await this.git(['ls-files', '--others', '--exclude-standard', '-z'])).length
    const evidence = { revision, indexDirty, worktreeDirty }
    const tree = (await this.git(['ls-tree', '-rz', '--full-tree', revision]))
      .split('\0')
      .filter(Boolean)
      .sort()
    let exact = same(tree, p.tree)
    if (exact) {
      const actual = await this.certify(config, configHash, revision)
      exact =
        same(actual.ledger, p.ledger) &&
        same(Object.keys(actual.refs).sort(), Object.keys(p.next).sort()) &&
        Object.entries(p.next).every(([path, ref]) => sameContent(ref, actual.refs[path]))
    }
    const parent =
      revision === p.plan.current
        ? !p.plan.changes.length
        : (await this.git(['rev-list', '--parents', '-n', '1', revision])).trim() ===
          `${revision} ${p.plan.current}`
    if ((await this.head()) !== revision || (await this.config()).configHash !== configHash)
      return unknown('State changed during reconciliation')
    if (unpublished) {
      // This proof is narrower than executor drain: no publication was ever admitted.
      // Never turn an unchanged/no-op tree into evidence of a committed publication.
      if (
        record.owner !== null ||
        (record.receipt.stage === 'prepared' && record.sequence !== 0) ||
        !['prepared', 'not_committed_dirty'].includes(record.receipt.stage) ||
        revision !== p.plan.current
      )
        return unknown('Never-published operation evidence changed', evidence)
      return { stage: 'not_committed_dirty', ...evidence }
    }
    if (exact && parent) {
      // An unchanged no-op tree is not evidence that any publisher ran. Only an
      // actual sealed publication executor can certify its genuine completion.
      if (revision === p.plan.current && !drained)
        return unknown('Unchanged HEAD has no drained publication executor', evidence)
      if (indexDirty || worktreeDirty)
        return unknown('Expected commit observed with dirty index/worktree', {
          ...evidence,
          observedCommit: revision,
        })
      return { stage: 'reconciled_committed', ...evidence, observedCommit: revision }
    }
    if (revision === p.plan.current && drained) return { stage: 'not_committed_dirty', ...evidence }
    return unknown(
      revision === p.plan.current
        ? 'Executor quiescence is unproven'
        : 'HEAD differs from exact expected ancestry/tree/ledger',
      evidence,
    )
  }
  async execute<M extends Method>(
    method: M,
    input: Input<M>,
    check: Check,
    signal: AbortSignal,
    drained = false,
    unpublished = false,
  ): Promise<Operations[M]['output']> {
    this.check = check
    this.signal = signal
    // Entry serializes requests; the cast is confined to the method dispatch boundary.
    return (await this.dispatch(method, input, drained, unpublished)) as Operations[M]['output']
  }
  private async dispatch(
    method: Method,
    input: Operations[Method]['input'],
    drained = false,
    unpublished = false,
  ): Promise<unknown> {
    switch (method) {
      case 'knowledgeHistory': {
        const args = input as Input<'knowledgeHistory'>
        const { config, configHash } = await this.config()
        if (configHash !== args.expectedConfigHash || !config.projects.some((p) => p.id === args.project))
          throw memoryFailure('CAS', 'History configuration mismatch')
        const revision = await this.head()
        if (revision !== args.expectedRevision) throw memoryFailure('CAS', 'History revision mismatch')
        const readLedger = async () => {
          const raw = await this.gitBytes(
            ['--no-replace-objects', 'show', `${revision}:.memory.json`],
            ['.memory.json'],
          )
          const ledger = parseLedger(raw.toString('utf8'))
          if (ledger.forgottenPaths.length || ledger.forgottenSources.length)
            throw memoryFailure('unknown', 'History unavailable', 'forgetting')
          return createHash('sha256').update(raw).digest('hex')
        }
        const semantics = async () => {
          const shallow = await this.gitBytes([
            '--no-replace-objects',
            'rev-parse',
            '--is-shallow-repository',
          ])
          const replace = await this.gitBytes([
            '--no-replace-objects',
            'for-each-ref',
            '--format=%(refname)',
            'refs/replace/',
          ])
          if (!shallow.equals(Buffer.from('false\n')) || replace.length)
            throw memoryFailure('unknown', 'History unavailable')
          const grafts = join(this.root, '.git', 'info', 'grafts')
          await this.gate([grafts])
          try {
            const stat = await lstat(grafts)
            if (!stat.isFile() || stat.size !== 0) throw memoryFailure('unknown', 'History unavailable')
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
        }
        await semantics()
        const ledgerDigest = await readLedger()
        const raw = await this.gitBytes([
          '--no-replace-objects',
          'rev-list',
          '--first-parent',
          '--parents',
          '--timestamp',
          '--max-count=128',
          revision,
        ])
        const entries = parseHistoryRows(raw, revision)
        const end = Math.min(args.offset + 8, entries.length)
        const detailedEntries = []
        let diffBudget = 8192
        for (const entry of entries.slice(args.offset, args.offset + 8)) {
          const subject = await this.gitBytes([
            '--no-replace-objects',
            'show',
            '-s',
            '--format=%s',
            entry.revision,
          ])
          const paths = await this.gitBytes([
            '--no-replace-objects',
            'diff-tree',
            '--no-commit-id',
            '--name-only',
            '--no-renames',
            '-r',
            '-z',
            ...(entry.parent ? [entry.parent, entry.revision] : ['--root', entry.revision]),
          ])
          const details = historyClassification(subject, paths, args.project)
          let patch = ''
          if (!details.redacted && details.paths.length) {
            // No external diff/textconv helpers, rename/copy headers, or caller-supplied Git arguments.
            const rawPatch = await this.gitBytes(
              [
                '--no-replace-objects',
                'diff-tree',
                '--no-commit-id',
                '-r',
                '-p',
                '--no-ext-diff',
                '--no-textconv',
                '--no-renames',
                '--no-color',
                ...(entry.parent ? [entry.parent, entry.revision] : ['--root', entry.revision]),
                '--',
                ...details.paths,
              ],
              details.paths,
            )
            // Retain only canonical in-scope file headers and hunks; raw Git/helper metadata never leaves.
            const allowed = new Set(details.paths)
            let inHunk = false
            let pendingHeader = ''
            for (const line of rawPatch.toString('utf8').split('\n')) {
              if (line.startsWith('diff --git ')) {
                inHunk = false
                pendingHeader = ''
                continue
              }
              if (!inHunk && line.startsWith('--- a/')) {
                const candidate = line.slice(6)
                if (allowed.has(candidate)) pendingHeader = `--- ${candidate}\n`
                continue
              }
              if (!inHunk && line.startsWith('+++ b/')) {
                const candidate = line.slice(6)
                if (allowed.has(candidate)) pendingHeader = `+++ ${candidate}\n`
                continue
              }
              if (line.startsWith('@@ ')) {
                inHunk = true
                if (pendingHeader) {
                  patch += pendingHeader
                  pendingHeader = ''
                }
              }
              if (inHunk && /^(?:@@ |[ +\\-])/.test(line)) patch += `${line}\n`
            }
          }
          const diff = utf8Preview(patch, Math.min(4096, diffBudget))
          diffBudget -= bytes(diff)
          detailedEntries.push({
            ...entry,
            subject: details.subject,
            changedFiles: details.changedFiles,
            diff,
            diffTruncated: diff !== patch,
          })
        }
        const result: KnowledgeHistory = {
          version: 1,
          project: args.project,
          revision,
          configHash,
          ledgerDigest,
          basis: 'committed-head-first-parent',
          currentness: 'config-head-ledger-matched-at-final-checks',
          offset: args.offset,
          pageSize: 8,
          windowSize: 128,
          nextOffset: end < entries.length ? end : null,
          windowLimitReached: entries.length === 128,
          metadata: 'commit-identity-time-subject-count',
          entries: detailedEntries,
        }
        await semantics()
        // Sequential endpoint observations, not an atomic snapshot or ABA protection.
        if ((await this.config()).configHash !== configHash)
          throw memoryFailure('CAS', 'History configuration changed')
        if ((await this.head()) !== revision) throw memoryFailure('CAS', 'History revision changed')
        if ((await readLedger()) !== ledgerDigest) throw memoryFailure('CAS', 'History ledger changed')
        assertKnowledgeHistory(result, args)
        return result
      }
      case 'palaceStructure': {
        const args = input as Input<'palaceStructure'>
        const { config, configHash } = await this.config()
        if (configHash !== args.expectedConfigHash || !config.projects.some((p) => p.id === args.project))
          throw memoryFailure('CAS', 'Palace configuration mismatch')
        const base = await this.certify(config, configHash)
        const paths = Object.keys(base.refs)
          .filter(
            (p) => palaceScopedPath(p, args.project) && !suppressed(base.ledger, p, base.refs[p].sources),
          )
          .sort()
        // Mandatory even for warm certificates and paths omitted by the presentation cap.
        await this.gate(
          paths.map((p) => join(this.root, p)),
          paths,
        )
        const files = paths.map((path) => ({
          path,
          layer: palaceLayerFor(path),
          bytes: base.refs[path].size,
          protectedRetention: isProtectedRetentionPath(path),
          alwaysLoaded:
            path === 'Core.md' || path === 'index.md' || isAlwaysLoadedTieredPath(path, args.project),
          sourcesCount: base.refs[path].sources.length,
        }))
        const result: PalaceStructure = {
          version: 1,
          revision: base.revision,
          configHash,
          project: args.project,
          basis: 'committed-head',
          currentness: 'config-and-head-matched-at-final-checks',
          bodyInspection: 'bounded-committed-preview',
          structureDigest: structureDigest(files),
          snapshotDigest: '',
          output: { total: files.length, returned: 0, omitted: files.length, truncated: files.length > 0 },
          files: [],
        }
        const selectedFiles = files.slice(0, 32)
        let bodyBudget = 128 * 1024
        for (const [index, file] of selectedFiles.entries()) {
          const raw = await this.gitBytes(
            ['--no-replace-objects', 'cat-file', 'blob', base.refs[file.path].oid],
            [file.path],
          )
          // Invalid UTF-8 cannot be certified as a truthful byte-bounded preview.
          const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw)
          const remainingDemand = selectedFiles
            .slice(index)
            .reduce((sum, entry) => sum + Math.min(8192, entry.bytes), 0)
          const fileCap =
            remainingDemand <= bodyBudget
              ? Math.min(8192, bodyBudget)
              : Math.min(8192, Math.floor(bodyBudget / (selectedFiles.length - index)))
          const body = utf8Preview(text, fileCap)
          bodyBudget -= bytes(body)
          result.files.push({ ...file, body, bodyTruncated: bytes(body) < file.bytes })
        }
        const account = () => {
          result.output = {
            total: files.length,
            returned: result.files.length,
            omitted: files.length - result.files.length,
            truncated: result.files.length < files.length,
          }
          result.structureDigest = structureDigest(result.files)
          result.snapshotDigest = snapshotDigest(result)
        }
        account()
        while (bytes(JSON.stringify(result)) > 192 * 1024) {
          if (!result.files.pop()) throw Error('Palace structure exceeds bound')
          account()
        }
        // Sequential observations, not simultaneous sampling or an interval guarantee.
        if ((await this.config()).configHash !== configHash)
          throw memoryFailure('CAS', 'Palace configuration changed')
        if ((await this.head()) !== base.revision) throw memoryFailure('CAS', 'Palace revision changed')
        return result
      }
      case 'projection': {
        const args = input as Input<'projection'>
        const { config, configHash } = await this.config()
        const revision = await this.head()
        const ledger = await this.ledger(revision)
        const tieredPaths = Object.keys(ledger.sources)
          .filter(
            (p) => isAlwaysLoadedTieredPath(p, args.project) && !suppressed(ledger, p, ledger.sources[p]),
          )
          .sort()
        const batchPaths = ['Core.md', 'index.md', ...tieredPaths]
        for (const path of batchPaths) {
          if (suppressed(ledger, path, ledger.sources[path]))
            throw Error('Memory projection unavailable: current forgetting')
        }
        const rawBatch = await this.gitBytes(
          ['cat-file', '--batch'],
          batchPaths,
          `${batchPaths.map((p) => `${revision}:${p}`).join('\n')}\n`,
        )
        const selected: Record<string, string> = {}
        let offset = 0
        for (const path of batchPaths) {
          const end = rawBatch.indexOf(10, offset)
          const header = end < 0 ? '' : rawBatch.subarray(offset, end).toString('utf8')
          const m = /^([a-f0-9]{40,64}) blob ([0-9]+)$/.exec(header)
          const size = m ? Number(m[2]) : -1
          if (!m || size < 0 || rawBatch[end + 1 + size] !== 10) throw Error('Invalid memory Git object')
          const text = rawBatch.subarray(end + 1, end + 1 + size).toString('utf8')
          bump(this.counters.blobReads, path)
          validateFileText(path, text, ledger.sources[path], config)
          selected[path] = text
          offset = end + size + 2
        }
        if (offset !== rawBatch.length) throw Error('Invalid memory Git batch')
        const paths = Object.keys(ledger.sources).filter(
          (path) =>
            allowedPath(path, args.shared ? undefined : args.project) &&
            !suppressed(ledger, path, ledger.sources[path]),
        )
        await this.gate(
          paths.map((path) => join(this.root, path)),
          paths,
        )
        const topics = topicMetadata(paths)
        const { directories, directoriesTruncated } = projectedDirectoryIndexes(paths, args.project)
        if ((await this.config()).configHash !== configHash || (await this.head()) !== revision)
          throw Error('Memory projection unavailable: current state changed')
        const systemEntries = tieredPaths
          .filter((p) => p.startsWith('system/'))
          .map((p) => [p, selected[p]] as const)
        const projectSystemEntries = tieredPaths
          .filter((p) => p.startsWith(`projects/${args.project}/system/`))
          .map((p) => [p, selected[p]] as const)
        return {
          revision,
          core: selected['Core.md'],
          index: selected['index.md'],
          ...(systemEntries.length ? { system: Object.fromEntries(systemEntries) } : {}),
          ...(projectSystemEntries.length ? { projectSystem: Object.fromEntries(projectSystemEntries) } : {}),
          discovery: {
            version: 2,
            ...(directories.length ? { directories } : {}),
            ...(directoriesTruncated ? { directoriesTruncated: true } : {}),
            topics: topics.slice(0, 8),
            totalTopics: topics.length,
            ...(topics.length > 8 ? { nextOffset: 8 } : {}),
            routes: {
              namespaces: { topic: '' },
              allFiles: { topic: '*' },
              lexical: 'agent_memory_read query',
            },
          },
        }
      }
      case 'config':
        return await this.config()
      case 'capacityDiagnostic':
        return await this.capacityDiagnostic()
      case 'retainedDraftPreview':
        return await this.retainedDraftPreview()
      case 'status': {
        const { config, configHash } = await this.config()
        const base = await this.certify(config, configHash)
        const pendingOperations: { id: string; digest: string; stage: Stage; recordBytes: number }[] = []
        const names = await this.names(join(this.folder, 'journal'), /^[a-f0-9-]{36}\.json$/)
        for (const name of names) {
          const raw = await this.read(join(this.folder, 'journal', name), operationLimit)
          const record = parseOperation(raw)
          if (!['reconciled_committed', 'not_committed_dirty'].includes(record.receipt.stage))
            pendingOperations.push({
              id: record.immutable.plan.id,
              digest: record.immutable.plan.digest,
              stage: record.receipt.stage,
              recordBytes: bytes(raw),
            })
        }
        return { revision: base.revision, files: Object.keys(base.refs), pendingOperations }
      }
      case 'offlineCertify': {
        const args = input as Input<'offlineCertify'>
        const { config, configHash } = await this.config()
        const base = await this.certify(config, configHash, args.revision)
        if ((await this.config()).configHash !== configHash || (await this.head()) !== base.revision)
          throw Error('Offline certification state changed')
        return { revision: base.revision }
      }
      case 'episodes':
        return await this.episodes((input as Input<'episodes'>).project)
      case 'selectEpisodes': {
        const args = input as Input<'selectEpisodes'>
        return await this.selectEpisodes(args.project, args.ids)
      }
      case 'episodeBacklog': {
        const args = input as Input<'episodeBacklog'>
        return await this.episodeBacklog(args.project, args.limit, args.session)
      }
      case 'episodeCredit': {
        const args = input as Input<'episodeCredit'>
        return await this.episodeCredit(args.project, args.session)
      }
      case 'observe':
        return await this.observe((input as Input<'observe'>).episode)
      case 'manage':
        return await this.management(input as Input<'manage'>)
      case 'conflicts':
        return await this.conflicts(input as Input<'conflicts'>)
      case 'discard':
        return await this.discard(input as Input<'discard'>)
      case 'cancel': {
        const id = (input as Input<'cancel'>).view
        const stored = this.drafts.get(id)
        if (stored?.value.shared) {
          // Only an in-process owned primary draft may retire without a current
          // lease/config. This changes metadata only; no hydration or publication.
          const v = structuredClone(stored.value)
          if (v.state !== 'open' && v.state !== 'ready') throw Error('Memory view inactive')
          const refs = this.files(v)
          const paths = Object.keys(refs)
          await this.gate(
            paths.map((path) => join(this.root, path)),
            paths,
          )
          for (const [path, ref] of Object.entries(refs)) {
            if (!('blob' in ref)) continue
            const physical = join(this.folder, 'blobs', ref.blob)
            await this.gate([physical], [path], 'view')
            await safePath(physical)
            const stat = await lstat(physical)
            if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || stamp(stat) !== ref.identity)
              throw Error('Overlay identity changed externally')
          }
          const manifest = await this.manifest(v)
          if (digest(await this.read(manifest, 2 * 1024 * 1024)) !== stored.hash)
            throw Error('Private manifest changed externally')
          await this.gate([this.root, manifest], [], 'view')
          v.state = 'cancelled'
          await this.save(v)
        } else {
          const { v, revision } = await this.active(id, true)
          await this.final(v, revision)
          v.state = 'cancelled'
          await this.save(v)
        }
        return { cancelled: true }
      }
      case 'stats':
        await this.gate([this.root])
        return structuredClone(this.counters)
      case 'create': {
        const args = input as Input<'create'>
        const { config, configHash } = await this.config()
        await this.initializeNamespace()
        const folder = join(this.folder, 'drafts')
        await this.gate([folder], [], 'view')
        await privateDirectory(folder, true)
        const overflow = (await this.boundedEntries(folder, limits.views)).length === limits.views
        const base = await this.certify(config, configHash)
        const refs = Object.fromEntries(
          Object.entries(base.refs).filter(([path]) =>
            allowedPath(path, args.shared ? undefined : args.project),
          ),
        )
        const v: Draft = {
          version: 2,
          id: randomUUID(),
          project: args.project,
          shared: args.shared ?? false,
          configHash,
          base: { ...base, refs },
          overlay: {},
          state: 'open',
          deadline: Date.now() + (args.ttlMs ?? 120000),
        }
        await this.gate(
          Object.keys(refs).map((p) => join(this.root, p)),
          Object.keys(refs),
        )
        const physical = overflow ? await this.reserveOverflow(v.id) : undefined
        await this.save(v, physical)
        await this.final(v, base.revision)
        return { view: v.id, base: base.revision }
      }
      case 'headRead':
      case 'read': {
        const selection = parseMemoryRead((input as Input<'read'>).selection)
        const committed = method === 'headRead'
        const snapshot = async () => {
          const args = input as Input<'headRead'>
          const { config, configHash } = await this.config()
          const base = await this.certify(config, configHash)
          const refs = Object.fromEntries(
            Object.entries(base.refs).filter(([path]) =>
              allowedPath(path, args.shared ? undefined : args.project),
            ),
          )
          await this.gate(
            Object.keys(refs).map((path) => join(this.root, path)),
            Object.keys(refs),
          )
          if (Object.entries(refs).some(([path, ref]) => suppressed(base.ledger, path, ref.sources)))
            throw memoryFailure('unknown', 'Memory read unavailable: current forgetting', 'forgetting')
          const v: Draft = {
            version: 2,
            id: randomUUID(),
            project: args.project,
            shared: args.shared,
            configHash,
            base: { ...base, refs },
            overlay: {},
            state: 'open',
            deadline: Date.now() + 120000,
          }
          // Ephemeral committed read only: no persisted draft, mutation admission, or handle registration.
          return { v, refs, revision: base.revision }
        }
        const { v, refs, revision } = committed
          ? await snapshot()
          : await this.active((input as Input<'read'>).view, true)
        const paths = Object.keys(refs).sort()
        const missingAt = (path: string, suggestions: string[]) => ({
          path,
          hash: null as null,
          missing: true as const,
          ...(suggestions.length ? { suggestions, hint: memoryMissingHint(path, suggestions) } : {}),
        })
        const envelope = {
          revision: v.base.revision,
          baseRevision: v.base.revision,
          currentRevision: revision,
          basis: Object.keys(v.overlay).some((path) => !sameContent(v.base.refs[path], refs[path]))
            ? 'private-draft'
            : 'view-snapshot',
          freshness: revision === v.base.revision ? 'current' : 'stale',
        }
        let result: object
        if (selection.mode === 'list') result = { files: paths, project: v.project, state: v.state }
        else if (selection.mode === 'path') {
          const cleanDir = selection.path.replace(/\/+$/, '')
          if (allowedDirectory(cleanDir, v.project, v.shared, paths)) {
            // Pin history to the view's committed base and restrict Git to already
            // authorized active paths; draft-only paths have an unknown timestamp.
            const committedPaths = paths.filter(
              (path) => path.startsWith(`${cleanDir}/`) && v.base.refs[path],
            )
            const edited = new Map<string, number>()
            if (committedPaths.length) {
              const history = await this.git(
                [
                  '--no-replace-objects',
                  'log',
                  '--format=%x00%ct',
                  '--name-only',
                  v.base.revision,
                  '--',
                  cleanDir,
                ],
                committedPaths,
              )
              const committed = new Set(committedPaths)
              const seen = new Set<string>()
              let time = 0
              for (const line of history.split('\n')) {
                if (line.startsWith('\0')) {
                  const seconds = Number(line.slice(1))
                  time =
                    Number.isSafeInteger(seconds) && Number.isSafeInteger(seconds * 1000) && seconds > 0
                      ? seconds * 1000
                      : 0
                } else if (committed.has(line) && !seen.has(line)) {
                  seen.add(line)
                  const child = line.slice(cleanDir.length + 1).split('/')[0]
                  edited.set(child, Math.max(edited.get(child) ?? 0, time))
                }
              }
            }
            const page = directoryPage(paths, cleanDir, selection.offset, selection.limit, edited)
            const childPaths = childDirectoryPaths(paths, cleanDir, edited)
            const shownChildren = childPaths.slice(0, retrievalLimits.page)
            const indexPath = `${cleanDir}/index.md`
            // Directory selection is metadata-only and has no body-dependent early stop.
            // Preserve first-use order and load only the index, shown child indexes and page.
            const selectedPaths = [
              ...new Set([indexPath, ...shownChildren.map((child) => `${child}/index.md`), ...page.paths]),
            ].filter((path) => refs[path])
            const loaded = await this.bodies(selectedPaths.map((path) => [path, refs[path]]))
            const indexText = loaded[indexPath]
            const indexPoints = indexText === undefined ? undefined : [...indexText]
            const indexShownCount =
              indexPoints === undefined
                ? undefined
                : Math.min(indexPoints.length, retrievalLimits.indexPreview)
            const indexShown = indexPoints?.slice(0, indexShownCount).join('')
            const directories: { path: string; description?: string }[] = []
            for (const child of shownChildren) {
              const childIndexPath = `${child}/index.md`
              const childIndex = refs[childIndexPath]
              if (!childIndex) {
                directories.push({ path: child })
                continue
              }
              const text = loaded[childIndexPath]
              const description = childIndexDescription(text)
              directories.push(description ? { path: child, description } : { path: child })
            }
            const dirFiles: Record<string, MemoryFile> = {}
            for (const p of page.paths)
              dirFiles[p] = {
                text: loaded[p],
                sources: refs[p].sources,
              }
            result = {
              ...directoryIndex(dirFiles, page),
              ...(indexPoints !== undefined && indexShown !== undefined && indexShownCount !== undefined
                ? {
                    index: {
                      path: indexPath,
                      text: indexShown,
                      totalCharacters: indexPoints.length,
                      truncated: indexPoints.length > indexShownCount,
                      ...(indexPoints.length > indexShownCount ? { nextOffset: indexShownCount } : {}),
                    },
                  }
                : {}),
              ...(directories.length ? { directories } : {}),
              ...(childPaths.length > shownChildren.length ? { directoriesTruncated: true } : {}),
            }
          } else {
            const scope = v.shared ? undefined : v.project
            if (!allowedPath(selection.path, scope)) {
              // A missing extension can name one in-scope sibling. Other out-of-scope paths stay refused.
              const suggestions = memoryExtensionSuggestion(selection.path, paths)
              if (!suggestions.length) throw memoryFailure('out-of-scope', 'Memory path outside scope')
              result = missingAt(selection.path, suggestions)
            } else {
              const ref = refs[selection.path]
              const points = ref ? [...(await this.body(selection.path, ref))] : []
              result = !ref
                ? missingAt(selection.path, memoryPathSuggestions(selection.path, paths))
                : {
                    path: selection.path,
                    hash: ref.hash,
                    text: points.slice(selection.offset, selection.offset + selection.limit).join(''),
                    sources: ref.sources,
                    offset: selection.offset,
                    totalCharacters: points.length,
                    truncated: selection.offset > 0 || selection.offset + selection.limit < points.length,
                    ...(selection.offset + selection.limit < points.length
                      ? { nextOffset: selection.offset + selection.limit }
                      : {}),
                  }
            }
          }
        } else if (selection.mode === 'topic') {
          const files = Object.fromEntries(
            paths.map((path) => [path, { text: '', sources: refs[path].sources }]),
          )
          result = retrieveMemory(files, selection)
        } else {
          // Same lexical owner and cursor semantics, with selective bounded body loads.
          const files: Record<string, MemoryFile> = {}
          let cost = 0
          let cursor = Math.min(selection.offset, paths.length)
          const results: unknown[] = []
          for (; cursor < paths.length; cursor++) {
            const path = paths[cursor]
            const ref = refs[path]
            if (cost + ref.size > retrievalLimits.workBytes || results.length >= selection.limit) break
            cost += ref.size
            files[path] = { text: await this.body(path, ref), sources: ref.sources }
            const found = retrieveMemory({ [path]: files[path] }, { ...selection, offset: 0 }).results
            if (bytes(JSON.stringify([...results, ...found])) > retrievalLimits.outputBytes - 2048) break
            results.push(...found)
          }
          const complete = cursor >= paths.length
          result = {
            query: selection.query,
            results,
            offset: selection.offset,
            workBytes: cost,
            complete,
            outcome: complete ? (results.length ? 'matches' : 'no-match') : 'incomplete',
            ...(complete ? {} : { nextOffset: cursor }),
          }
        }
        if (committed) {
          if ((await this.config()).configHash !== v.configHash || (await this.head()) !== revision)
            throw memoryFailure(
              'CAS',
              'Memory read unavailable: current revision changed during read',
              'revision',
            )
          await this.gate(
            Object.keys(refs).map((path) => join(this.root, path)),
            Object.keys(refs),
          )
        } else await this.final(v, revision)
        return { ...result, ...envelope }
      }
      case 'edit': {
        const args = input as Input<'edit'>
        const { v, refs, config, revision, ledger } = await this.active(args.view, true)
        const old = refs[args.path]
        if (!allowedPath(args.path, v.shared ? undefined : v.project))
          throw memoryFailure('out-of-scope', 'Stale file or path outside scope')
        const expectedHash =
          args.expectedHash === undefined && args.mode === 'append' ? (old?.hash ?? null) : args.expectedHash
        if ((old?.hash ?? null) !== expectedHash)
          throw memoryFailure('CAS', 'Stale file or path outside scope')
        const oldText = old ? await this.body(args.path, old) : undefined
        const rawNextText = applySurgicalEdit(oldText, args.text, {
          mode: args.mode,
          oldText: args.oldText,
          newText: args.newText,
          section: args.section,
        })
        const nextText =
          args.mode === 'append' && !oldText && typeof rawNextText === 'string'
            ? ensureTieredFrontmatter(args.path, rawNextText)
            : rawNextText
        if (nextText === null && ['Core.md', 'index.md'].includes(args.path))
          throw memoryFailure('invalid-arguments', 'Core and index cannot be removed')
        assertReadOnlyFrontmatter(args.path, oldText, nextText)
        const next = structuredClone(v)
        // A failed prepare retains the proposal as ready. A current primary may
        // revise it after the actionable diagnostic; worker runtimes refuse edits
        // after marking ready. Any successful revision returns it to open.
        next.state = 'open'
        if (nextText === null) next.overlay[args.path] = null
        else {
          const sources = [...new Set(args.sources ?? [])].sort()
          validateFileText(args.path, nextText, sources, config)
          if (suppressed(ledger, args.path, sources)) throw Error('Forgotten knowledge cannot be revived')
          const blob = randomUUID()
          const physical = join(this.folder, 'blobs', blob)
          await this.write(physical, nextText, [args.path])
          bump(this.counters.overlayWrites, args.path)
          next.overlay[args.path] = {
            blob,
            hash: digest(nextText),
            size: bytes(nextText),
            sources,
            identity: stamp(await lstat(physical)),
          }
        }
        const all = this.files(next)
        if (
          Object.keys(all).length > limits.files ||
          Object.values(all).reduce((sum, ref) => sum + ref.size, 0) > config.totalBytes
        )
          throw memoryFailure('budget', 'Memory total/layout budget exceeded')
        // Fail before manifest switch on any await-time data/authority change.
        await this.final(v, revision)
        await this.save(next)
        await this.final(next, revision)
        return { hash: nextText === null ? null : digest(nextText) }
      }
      case 'ready': {
        const { v, revision } = await this.active((input as Input<'ready'>).view, true)
        await this.final(v, revision)
        if (v.state === 'ready') return { ready: true }
        v.state = 'ready'
        await this.save(v)
        await this.final(v, revision)
        return { ready: true }
      }
      case 'prepare': {
        const args = input as Input<'prepare'>
        const { v, config, refs } = await this.active(args.view, true)
        if (v.state !== 'ready') throw Error('Proposal is not ready')
        await this.initializeNamespace()
        if (dirname(await this.manifest(v)) === this.overflowFolder()) await this.overflowJournalFence()
        if (
          [...this.plans.values()].some(
            (p) => !['reconciled_committed', 'not_committed_dirty'].includes(p.receipt.stage),
          )
        )
          throw Error('Publication already pending; no retry')
        const current = await this.certify(config, v.configHash)
        if (this.managementLedgers.has(v.id) && current.revision !== v.base.revision)
          throw memoryFailure('CAS', 'Stale management revision')
        if ((await this.git(['status', '--porcelain', '--untracked-files=no'])).trim())
          throw Error('Uncommitted work requires explicit recovery; proposal retained')
        const changed = Object.keys(v.overlay).filter((path) => !sameContent(v.base.refs[path], refs[path]))
        const conflict = changed.filter(
          (path) =>
            suppressed(current.ledger, path, refs[path]?.sources ?? []) ||
            (!sameContent(v.base.refs[path], current.refs[path]) &&
              !sameContent(refs[path], current.refs[path])),
        )
        if (conflict.length) {
          v.state = 'conflict'
          await this.save(v)
          return { conflict }
        }
        const baseBodies: Record<string, { text: string } | undefined> = {}
        const nextBodies: Record<string, { text: string } | undefined> = {}
        const baseTexts = await this.bodies(
          changed.filter((path) => v.base.refs[path]).map((path) => [path, v.base.refs[path]]),
        )
        const nextTexts = await this.bodies(
          changed.filter((path) => refs[path]).map((path) => [path, refs[path]]),
        )
        for (const path of changed) {
          if (v.base.refs[path]) baseBodies[path] = { text: baseTexts[path] }
          if (refs[path]) nextBodies[path] = { text: nextTexts[path] }
        }
        assertLosslessRetention(baseBodies, nextBodies, changed, args.allowShrink)
        if (args.reviewed.length > 4096 || args.reviewed.some((id) => !validId(id)))
          throw Error('Invalid episode cursor')
        const next: Record<string, Ref | Overlay> = { ...current.refs }
        for (const path of changed) {
          if (refs[path]) next[path] = refs[path]
          else delete next[path]
        }
        const ledger: Ledger = {
          ...(this.managementLedgers.get(v.id) ?? current.ledger),
          sources: Object.fromEntries(Object.entries(next).map(([path, ref]) => [path, ref.sources])),
          reviewed: [...new Set([...current.ledger.reviewed, ...args.reviewed])],
        }
        const ledgerText = `${JSON.stringify(ledger)}\n`
        parseLedger(ledgerText)
        const changes: Change[] = changed.map((path) => ({
          path,
          hash: refs[path]?.hash ?? null,
          size: refs[path]?.size ?? 0,
        }))
        if (!same(ledger, current.ledger))
          changes.push({ path: '.memory.json', hash: digest(ledgerText), size: bytes(ledgerText) })
        await this.bodies(changed.filter((path) => refs[path]).map((path) => [path, refs[path]]))
        const metadata = {
          id: randomUUID(),
          view: v.id,
          base: v.base.revision,
          current: current.revision,
          configHash: v.configHash,
          ledgerHash: digest(JSON.stringify(current.ledger)),
          changes,
        }
        const plan: Plan = { ...metadata, digest: digest(JSON.stringify(metadata)) }
        const tree = (await this.git(['ls-tree', '-rz', '--full-tree', current.revision]))
          .split('\0')
          .filter(Boolean)
        const expected = new Map(tree.map((entry) => [entry.split('\t')[1], entry]))
        const expectedTexts = await this.bodies(
          changes
            .filter((change) => change.path !== '.memory.json' && change.hash !== null)
            .map((change) => [change.path, next[change.path]]),
        )
        for (const change of changes) {
          if (change.hash === null) expected.delete(change.path)
          else {
            const text = change.path === '.memory.json' ? ledgerText : expectedTexts[change.path]
            const data = Buffer.from(text)
            const oid = createHash(current.revision.length === 40 ? 'sha1' : 'sha256')
              .update(`blob ${data.length}\0`)
              .update(data)
              .digest('hex')
            if (!revisionPattern.test(oid)) throw Error('Invalid expected Git object')
            expected.set(change.path, `100644 blob ${oid}\t${change.path}`)
          }
        }
        const rootStat = await lstat(this.root)
        const immutable: OperationRecord['immutable'] = {
          root: this.root,
          rootIdentity: `${rootStat.dev}:${rootStat.ino}`,
          plan,
          next: Object.fromEntries(
            Object.entries(next).map(([path, ref]) => [
              path,
              { hash: ref.hash, size: ref.size, sources: ref.sources },
            ]),
          ),
          ledger,
          ledgerText,
          proposalHash: digest(await this.read(await this.manifest(v), 2 * 1024 * 1024)),
          tree: [...expected.values()].sort(),
        }
        const record: OperationRecord = {
          version: 1,
          immutable,
          immutableHash: digest(JSON.stringify(immutable)),
          sequence: 0,
          owner: null,
          receipt: { stage: 'prepared' },
        }
        const raw = `${JSON.stringify(record)}\n`
        parseOperation(raw)
        const prepared: Prepared = { plan, next, ledger, ledgerText, receipt: record.receipt, record }
        await this.final(v, current.revision)
        if (dirname(await this.manifest(v)) === this.overflowFolder()) await this.overflowJournalFence()
        // The parent must own this exact prepare->publish interval before durability.
        // Cancellation may lose the final reply even when the write completes.
        await this.check({
          physical: [this.operationPath(plan.id)],
          logical: [],
          kind: 'view',
          preparing: plan,
        })
        await this.write(this.operationPath(plan.id), raw)
        this.plans.set(plan.id, prepared)
        return { plan }
      }
      case 'fence': {
        const args = input as Input<'fence'>
        return await this.fence(this.plan(args.plan, args.digest))
      }
      case 'chunk': {
        const args = input as Input<'chunk'>
        const p = this.plan(args.plan, args.digest)
        await this.proposalFence(p)
        const change = p.plan.changes.find((item) => item.path === args.path)
        if (!change?.hash) throw Error('Path absent from prepared plan')
        const text =
          args.path === '.memory.json' ? p.ledgerText : await this.body(args.path, p.next[args.path])
        const data = Buffer.from(text)
        if (digest(text) !== change.hash || data.length !== change.size || args.offset > data.length)
          throw Error('Plan body changed')
        return {
          data: data.subarray(args.offset, args.offset + 64 * 1024).toString('base64'),
          total: data.length,
          hash: change.hash,
        }
      }
      case 'journal': {
        const args = input as Input<'journal'>
        const p = this.plan(args.plan, args.digest)
        if (!states[p.receipt.stage]?.includes(args.receipt?.stage)) throw Error('Invalid journal transition')
        const receipt = structuredClone(args.receipt)
        p.record = await this.updateOperation(p.record, receipt)
        p.receipt = receipt
        if (receipt.stage === 'reconciled_committed') {
          const stored = this.drafts.get(p.plan.view)
          if (!stored) throw Error('Published view metadata unavailable')
          const v = structuredClone(stored.value)
          v.state = 'committed'
          await this.save(v)
        }
        return { recorded: true }
      }
      case 'claim': {
        const args = input as Input<'claim'>
        const p = this.plan(args.plan, args.digest)
        const owner = parseLockOwner(args.owner)
        if (
          p.record.owner ||
          owner.operation !== args.plan ||
          owner.digest !== args.digest ||
          !(await this.exactLock(owner))
        )
          throw Error('Unknown or replaced operation lock')
        p.record = await this.updateOperation(p.record, p.receipt, owner)
        return { recorded: true }
      }
      case 'reconcile': {
        const args = input as Input<'reconcile'>
        const p = this.plan(args.plan, args.digest)
        if (!(await this.exactLock(p.record.owner)))
          return { stage: 'unknown', detail: 'Operation lock unknown or replaced' }
        return await this.outcome(p.record, drained, unpublished)
      }
      case 'recover': {
        const args = input as Input<'recover'>
        const record = await this.loadOperation(args.plan, args.digest)
        const receipt: Receipt = (await this.exactLock(record.owner))
          ? await this.outcome(record, drained, unpublished)
          : { stage: 'unknown', detail: 'Operation lock unknown or replaced' }
        const next = await this.updateOperation(record, receipt)
        const cached = this.plans.get(args.plan)
        if (
          cached?.plan.id === args.plan &&
          cached.plan.digest === args.digest &&
          cached.record.immutableHash === next.immutableHash &&
          same(cached.record.immutable, next.immutable)
        ) {
          cached.record = next
          cached.receipt = next.receipt
        }
        const lock = join(this.root, '.lock')
        await this.gate([lock])
        let lockPresent = true
        try {
          await lstat(lock)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') lockPresent = false
          else throw error
        }
        return { receipt, owner: next.owner, sequence: next.sequence, lockPresent }
      }
    }
  }
}
function validateFileText(path: string, text: string, sources: string[], c: MemoryConfig) {
  validateFile(path, { text, sources }, c)
}
function sameContent(
  a: Pick<Ref, 'hash' | 'sources'> | undefined,
  b: Pick<Ref, 'hash' | 'sources'> | undefined,
) {
  return a === undefined || b === undefined ? a === b : a.hash === b.hash && same(a.sources, b.sources)
}
