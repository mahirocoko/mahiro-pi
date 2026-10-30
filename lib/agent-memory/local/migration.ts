import { randomBytes } from 'node:crypto'
import { lstat, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { bytes, digest, validId } from '../../continuity/records.ts'
import {
  assertMigrationExportPage,
  type MigrationExportPage,
  type MigrationExportSection,
  migrationExportSections,
} from '../migration-export.ts'
import { suppressed, type Ledger } from '../engine/schema.ts'
import { isOwnedTempName, readRegularFile, writeExclusive } from './confine.ts'
import {
  assertExactDirectory,
  assertRelativePath,
  canonicalGitDirectoryName,
  localGitIdentity,
  type LocalWorker,
  type SyntheticLocalInjection,
} from './contracts.ts'
import {
  isProtectedMemoryPath,
  loadForgetting,
  localGitBlobId,
  tombstoneSnapshotDigest,
  type TombstoneSource,
} from './forgetting.ts'
import {
  gitBlobSize,
  gitEntriesRecursive,
  gitIsAncestor,
  gitMain,
  localGitEnvironment,
  type LocalGitContext,
} from './git.ts'
import { loadJob, parseMeta } from './jobs.ts'
import { hasLocalMemoryClaim } from './coordination.ts'
import {
  createLocalMemoryServiceUnderClaim,
  importLocalTombstonesUnderClaim,
  localMemoryTurn,
  retireLocalMemoryRoot,
  type SyntheticLocalMemoryService,
} from './service.ts'

// Disconnected shadow of a canonical export. It does not read a private root or switch live authority.
export const shadowMigrationLimits = {
  maxFiles: 1024,
  maxFileBytes: 262144,
  maxTotalBytes: 8 * 1024 * 1024,
  maxReceiptBytes: 60 * 1024,
} as const

export interface CommittedReadEnvelope {
  revision: string
  currentRevision: string
  basis: 'view-snapshot'
  freshness: 'current'
  path: string
  hash: string
  sources: string[]
}

export interface ShadowMigrationFile {
  path: string
  text: string
  hash: string
  sources: string[]
  read: CommittedReadEnvelope
}

export interface ShadowMigrationBundle {
  revision: string
  configHash: string
  ledgerDigest: string
  files: ShadowMigrationFile[]
  forgottenPaths: string[]
  forgottenSources: TombstoneSource[]
  reviewed: string[]
  pages: MigrationExportPage[]
}

export interface ShadowMigrationReceipt {
  version: 1
  sourceRevision: string
  ledgerDigest: string
  configHash: string
  exportDigest: string
  fileCount: number
  bytes: number
  manifestHash: string
  initialHead: string
  forgettingDigest: string
  reviewed: string[]
  rollback: {
    migrationNonce: string
    serviceNonce: string
    repository: string
    dev: string
    ino: string
  }
}

export interface ShadowMigration {
  receipt: ShadowMigrationReceipt
  service: SyntheticLocalMemoryService
}

export type ShadowMigrationStop = NonNullable<SyntheticLocalInjection['stopAfter']> | 'owner' | 'seeded'

export interface ShadowMigrationInjection extends Omit<SyntheticLocalInjection, 'stopAfter'> {
  stopAfter?: ShadowMigrationStop
}

const turns = new Map<string, Promise<void>>()
const hashPattern = /^[a-f0-9]{64}$/
export async function openShadowMigration(options: {
  stateRoot: string
  bundle: ShadowMigrationBundle
  worker: LocalWorker
  injection?: ShadowMigrationInjection
  beforeReceipt?: () => Promise<void> | void
}): Promise<ShadowMigration> {
  if (hasLocalMemoryClaim()) throw Error('Local memory recursive claim refused')
  if (typeof options.worker !== 'function') refuse()
  const prepared = prepareBundle(options.bundle)
  const stateRoot = await assertDirectory(options.stateRoot)
  return turn(stateRoot, () =>
    localMemoryTurn(
      stateRoot,
      async (claim) => {
        const identity = await directoryIdentity(stateRoot)
        const stored = await readOptional(join(stateRoot, 'migration.json'))
        if (stored) {
          const receipt = parseReceipt(stored)
          if (!sameReceipt(receipt, prepared, identity)) throw Error('Local memory migration stale')
          const expected = seedManifest(prepared.seed)
          if (
            expected.manifestHash !== receipt.manifestHash ||
            expected.fileCount !== receipt.fileCount ||
            expected.bytes !== receipt.bytes
          )
            refuse()
          const service = await createLocalMemoryServiceUnderClaim(
            {
              stateRoot,
              worker: options.worker,
              injection: forwardInjection(options.injection),
            },
            claim,
          )
          await verifyReceipt(stateRoot, receipt)
          return { receipt, service }
        }
        const ownerPath = join(stateRoot, 'migration-owner.json')
        const existingOwner = await readOptional(ownerPath)
        if (existingOwner) {
          const owner = parseOwner(existingOwner)
          if (
            owner.dev !== identity.dev ||
            owner.ino !== identity.ino ||
            owner.exportDigest !== prepared.exportDigest
          )
            refuse()
        } else {
          if ((await readdir(stateRoot)).length !== 0) refuse()
          const owner = {
            version: 1 as const,
            nonce: randomBytes(16).toString('hex'),
            exportDigest: prepared.exportDigest,
            dev: identity.dev,
            ino: identity.ino,
          }
          await writeExclusive(ownerPath, `${JSON.stringify(owner)}\n`)
          if (options.injection?.stopAfter === 'owner') throw Error('Local memory migration interrupted')
        }
        const service = await createLocalMemoryServiceUnderClaim(
          {
            stateRoot,
            worker: options.worker,
            initialFiles: Object.fromEntries(prepared.seed.map((file) => [file.path, file.text])),
            injection: forwardInjection(options.injection),
          },
          claim,
        )
        if (options.injection?.stopAfter === 'seeded') throw Error('Local memory migration interrupted')
        if (prepared.tombstone) {
          const current = await loadForgetting(stateRoot)
          await importLocalTombstonesUnderClaim(service, claim, {
            expectedPolicyRevision: current.policyRevision,
            expectedDigest: current.digest,
            snapshot: prepared.tombstone,
          })
        }
        const owner = parseOwner(await readRequired(ownerPath))
        const meta = await readMeta(stateRoot)
        const head = await gitMain(shadowGit(stateRoot))
        const expected = seedManifest(prepared.seed)
        const manifest = await treeManifest(stateRoot, head)
        if (
          manifest.manifestHash !== expected.manifestHash ||
          manifest.fileCount !== expected.fileCount ||
          manifest.bytes !== expected.bytes
        )
          refuse()
        const forgetting = await loadForgetting(stateRoot)
        const receipt: ShadowMigrationReceipt = {
          version: 1,
          sourceRevision: prepared.revision,
          ledgerDigest: prepared.ledgerDigest,
          configHash: prepared.configHash,
          exportDigest: prepared.exportDigest,
          fileCount: manifest.fileCount,
          bytes: manifest.bytes,
          manifestHash: manifest.manifestHash,
          initialHead: head,
          forgettingDigest: forgetting.digest,
          reviewed: prepared.reviewed,
          rollback: {
            migrationNonce: owner.nonce,
            serviceNonce: meta.nonce,
            repository: meta.repository,
            dev: identity.dev,
            ino: identity.ino,
          },
        }
        const text = `${JSON.stringify(receipt)}\n`
        if (bytes(text) > shadowMigrationLimits.maxReceiptBytes) refuse()
        parseReceipt(text)
        if (options.beforeReceipt) await options.beforeReceipt()
        await writeExclusive(join(stateRoot, 'migration.json'), text)
        await verifyReceipt(stateRoot, receipt)
        return { receipt, service }
      },
      'migration-open',
    ),
  )
}

export async function rollbackShadowMigration(
  stateRoot: string,
  options?: {
    beforeQuiescence?: () => Promise<void> | void
    afterQuiescence?: () => Promise<void> | void
  },
): Promise<{ quarantined: string }> {
  if (hasLocalMemoryClaim()) throw Error('Local memory recursive claim refused')
  const root = await assertDirectory(stateRoot)
  return turn(root, () =>
    localMemoryTurn(root, async (claim) => {
      if (options?.beforeQuiescence) await options.beforeQuiescence()
      const identity = await directoryIdentity(root)
      let ownerText: string
      try {
        ownerText = await readRequired(join(root, 'migration-owner.json'))
      } catch {
        refuse()
      }
      const owner = parseOwner(ownerText)
      if (owner.dev !== identity.dev || owner.ino !== identity.ino) refuse()
      const receiptText = await readOptional(join(root, 'migration.json'))
      if (receiptText) {
        const receipt = parseReceipt(receiptText)
        if (
          receipt.rollback.migrationNonce !== owner.nonce ||
          receipt.rollback.dev !== identity.dev ||
          receipt.rollback.ino !== identity.ino ||
          receipt.exportDigest !== owner.exportDigest
        )
          refuse()
        const meta = await readMeta(root)
        if (meta.nonce !== receipt.rollback.serviceNonce || meta.repository !== receipt.rollback.repository)
          refuse()
        if (meta.repository !== join(root, canonicalGitDirectoryName)) refuse()
      } else if (await exists(join(root, 'meta.json'))) {
        const meta = await readMeta(root)
        if (meta.repository !== join(root, canonicalGitDirectoryName)) refuse()
      }
      await assertQuiescent(root)
      if (options?.afterQuiescence) await options.afterQuiescence()
      await assertQuiescent(root)
      const hadService = await exists(join(root, 'meta.json'))
      const quarantined = `${root}.quarantine-${owner.nonce.slice(0, 12)}`
      if (await exists(quarantined)) refuse()
      claim.verify()
      await rename(root, quarantined)
      claim.movedTo(quarantined)
      const moved = await lstat(quarantined)
      if (!moved.isDirectory() || String(moved.dev) !== identity.dev || String(moved.ino) !== identity.ino)
        refuse()
      if (hadService) retireLocalMemoryRoot(root)
      return { quarantined }
    }),
  )
}

interface PreparedBundle {
  revision: string
  configHash: string
  ledgerDigest: string
  exportDigest: string
  reviewed: string[]
  seed: ShadowMigrationFile[]
  bytes: number
  tombstone: ReturnType<typeof tombstone> | null
}

function prepareBundle(bundle: ShadowMigrationBundle): PreparedBundle {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) refuse()
  const keys = Object.keys(bundle).sort().join()
  if (keys !== 'configHash,files,forgottenPaths,forgottenSources,ledgerDigest,pages,reviewed,revision')
    refuse()
  if (
    typeof bundle.revision !== 'string' ||
    !/^[a-f0-9]{40,64}$/.test(bundle.revision) ||
    !hashPattern.test(bundle.configHash) ||
    !hashPattern.test(bundle.ledgerDigest) ||
    !Array.isArray(bundle.files) ||
    !Array.isArray(bundle.forgottenPaths) ||
    !Array.isArray(bundle.forgottenSources) ||
    !Array.isArray(bundle.reviewed) ||
    !Array.isArray(bundle.pages)
  )
    refuse()
  if (bundle.forgottenPaths.some((path) => typeof path !== 'string' || isProtectedMemoryPath(path))) refuse()
  const files = bundle.files.map(parseFile)
  if (files.length > shadowMigrationLimits.maxFiles) refuse()
  if (new Set(files.map((file) => file.path)).size !== files.length) refuse()
  const ordered = [...files].sort((left, right) => comparePath(left.path, right.path))
  if (ordered.some((file, index) => file.path !== files[index]?.path)) refuse()
  let total = 0
  for (const file of files) {
    if (file.text.includes('\0') || bytes(file.text) > shadowMigrationLimits.maxFileBytes) refuse()
    if (digest(file.text) !== file.hash) refuse()
    if (!committedReadAgrees(file, bundle.revision)) refuse()
    total += bytes(file.text)
  }
  if (total > shadowMigrationLimits.maxTotalBytes) refuse()
  const forgottenPaths = stringList(bundle.forgottenPaths, 4096)
  const forgottenSources = bundle.forgottenSources.map(parseSource)
  if (forgottenSources.length > 4096) refuse()
  if (new Set(forgottenSources.map((entry) => JSON.stringify(entry))).size !== forgottenSources.length)
    refuse()
  const reviewed = bundle.reviewed.map((id) => {
    if (!validId(id)) refuse()
    return id
  })
  if (reviewed.length > 4096 || new Set(reviewed).size !== reviewed.length) refuse()
  const grouped = groupPages(bundle.pages, bundle)
  if (
    !isDeepStrictEqual(grouped.forgottenPaths, forgottenPaths) ||
    !isDeepStrictEqual(grouped.forgottenSources, forgottenSources) ||
    !isDeepStrictEqual(grouped.reviewed, reviewed) ||
    grouped.binding.activeFiles !== grouped.sources.length ||
    grouped.binding.forgottenPaths !== forgottenPaths.length ||
    grouped.binding.forgottenSources !== forgottenSources.length ||
    grouped.binding.reviewed !== reviewed.length
  )
    refuse()
  const exported = new Map(grouped.sources.map((entry) => [entry.path, entry]))
  const seed: ShadowMigrationFile[] = []
  const blobs: string[] = []
  const ledger = forgettingLedger(forgottenPaths, forgottenSources)
  for (const file of files) {
    const listed = exported.get(file.path)
    const dropped = suppressed(ledger, file.path, file.sources)
    if (listed && (listed.hash !== file.hash || !sameStrings(listed.sources, file.sources))) refuse()
    if (!listed && !dropped) refuse()
    if (dropped) {
      blobs.push(localGitBlobId(file.text))
      continue
    }
    if (!listed) refuse()
    seed.push(file)
  }
  if (exported.size !== grouped.sources.length) refuse()
  for (const path of exported.keys()) if (!files.some((file) => file.path === path)) refuse()
  if (!seed.some((file) => file.path === 'Core.md') || !seed.some((file) => file.path === 'index.md'))
    refuse()
  const uniqueBlobs = [...new Set(blobs)].sort()
  return {
    revision: bundle.revision,
    configHash: bundle.configHash,
    ledgerDigest: bundle.ledgerDigest,
    exportDigest: digest(
      JSON.stringify({
        configHash: bundle.configHash,
        files: files.map((file) => ({ hash: file.hash, path: file.path, sources: file.sources })),
        forgottenPaths,
        forgottenSources,
        ledgerDigest: bundle.ledgerDigest,
        pages: bundle.pages.map((page) => ({
          count: page.entries.length,
          limit: page.limit,
          nextOffset: page.nextOffset ?? null,
          offset: page.offset,
          section: page.section,
          total: page.total,
        })),
        reviewed,
        revision: bundle.revision,
      }),
    ),
    reviewed,
    seed,
    bytes: seed.reduce((sum, file) => sum + bytes(file.text), 0),
    tombstone: tombstone(bundle.revision, forgottenPaths, uniqueBlobs, forgottenSources),
  }
}

function groupPages(pages: MigrationExportPage[], bundle: ShadowMigrationBundle) {
  const grouped = new Map<MigrationExportSection, MigrationExportPage[]>()
  for (const section of migrationExportSections) grouped.set(section, [])
  for (const value of pages) {
    const page = assertMigrationExportPage(value)
    if (
      page.revision !== bundle.revision ||
      page.configHash !== bundle.configHash ||
      page.ledgerDigest !== bundle.ledgerDigest
    )
      throw Error('Local memory migration stale')
    grouped.get(page.section)?.push(page)
  }
  const entries = (section: MigrationExportSection) => {
    const list = grouped.get(section) ?? []
    list.sort((left, right) => left.offset - right.offset)
    if (!list.length) refuse()
    const total = list[0]?.total
    let offset = 0
    const rows: unknown[] = []
    for (const page of list) {
      if (page.total !== total || page.offset !== offset) refuse()
      rows.push(...page.entries)
      offset += page.entries.length
    }
    if (offset !== total) refuse()
    return rows
  }
  const bindingRows = entries('binding')
  if (bindingRows.length !== 1) refuse()
  const binding = bindingRows[0] as {
    activeFiles: number
    forgottenPaths: number
    forgottenSources: number
    reviewed: number
  }
  return {
    binding,
    sources: entries('sources') as { path: string; sources: string[]; hash: string }[],
    forgottenPaths: entries('forgotten-paths') as string[],
    forgottenSources: entries('forgotten-sources') as TombstoneSource[],
    reviewed: entries('reviewed') as string[],
  }
}

function tombstone(revision: string, paths: string[], blobs: string[], sources: TombstoneSource[]) {
  if (!paths.length && !blobs.length && !sources.length) return null
  const snapshot = {
    version: 1 as const,
    revision,
    paths,
    blobs,
    sources,
    digest: '',
  }
  snapshot.digest = tombstoneSnapshotDigest(snapshot)
  return snapshot
}

function parseFile(value: unknown): ShadowMigrationFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  const file = value as ShadowMigrationFile
  if (Object.keys(file).sort().join() !== 'hash,path,read,sources,text') refuse()
  if (typeof file.path !== 'string' || typeof file.text !== 'string' || !hashPattern.test(file.hash)) refuse()
  try {
    assertRelativePath(file.path)
  } catch {
    refuse()
  }
  if (!Array.isArray(file.sources) || file.sources.length > 32 || !file.sources.every(validId)) refuse()
  if (new Set(file.sources).size !== file.sources.length) refuse()
  return {
    path: file.path,
    text: file.text,
    hash: file.hash,
    sources: [...file.sources],
    read: parseRead(file.read),
  }
}

function parseRead(value: unknown): CommittedReadEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  const read = value as CommittedReadEnvelope
  if (Object.keys(read).sort().join() !== 'basis,currentRevision,freshness,hash,path,revision,sources')
    refuse()
  if (read.basis !== 'view-snapshot' || read.freshness !== 'current') refuse()
  if (typeof read.path !== 'string' || !hashPattern.test(read.hash)) refuse()
  if (typeof read.revision !== 'string' || typeof read.currentRevision !== 'string') refuse()
  if (!Array.isArray(read.sources) || !read.sources.every(validId)) refuse()
  return {
    revision: read.revision,
    currentRevision: read.currentRevision,
    basis: 'view-snapshot',
    freshness: 'current',
    path: read.path,
    hash: read.hash,
    sources: [...read.sources],
  }
}

function committedReadAgrees(file: ShadowMigrationFile, revision: string) {
  return (
    file.read.revision === revision &&
    file.read.currentRevision === revision &&
    file.read.basis === 'view-snapshot' &&
    file.read.freshness === 'current' &&
    file.read.path === file.path &&
    file.read.hash === file.hash &&
    sameStrings(file.read.sources, file.sources)
  )
}

function parseSource(value: unknown): TombstoneSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  const entry = value as TombstoneSource
  if (Object.keys(entry).sort().join() !== 'project,source') refuse()
  if (
    !(
      entry.project === null ||
      (typeof entry.project === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.project))
    ) ||
    !validId(entry.source)
  )
    refuse()
  return { project: entry.project, source: entry.source }
}

function stringList(values: unknown[], max: number): string[] {
  if (values.length > max) refuse()
  const list = values.map((value) => {
    if (typeof value !== 'string') refuse()
    try {
      assertRelativePath(value)
    } catch {
      refuse()
    }
    return value
  })
  if (new Set(list).size !== list.length) refuse()
  return list
}

function forgettingLedger(paths: string[], sources: TombstoneSource[]): Ledger {
  return {
    version: 2,
    sources: {},
    forgottenPaths: paths,
    forgottenSources: sources,
    reviewed: [],
  }
}

function sameReceipt(
  receipt: ShadowMigrationReceipt,
  prepared: PreparedBundle,
  identity: { dev: string; ino: string },
) {
  return (
    receipt.sourceRevision === prepared.revision &&
    receipt.ledgerDigest === prepared.ledgerDigest &&
    receipt.configHash === prepared.configHash &&
    receipt.exportDigest === prepared.exportDigest &&
    isDeepStrictEqual(receipt.reviewed, prepared.reviewed) &&
    receipt.rollback.dev === identity.dev &&
    receipt.rollback.ino === identity.ino
  )
}

async function verifyReceipt(stateRoot: string, receipt: ShadowMigrationReceipt) {
  const forgetting = await loadForgetting(stateRoot)
  if (forgetting.digest !== receipt.forgettingDigest) refuse()
  const meta = await readMeta(stateRoot)
  if (
    meta.nonce !== receipt.rollback.serviceNonce ||
    meta.repository !== receipt.rollback.repository ||
    meta.repository !== join(stateRoot, canonicalGitDirectoryName)
  )
    refuse()
  const identity = await readRegularFile(join(stateRoot, 'git-identity'))
  if (identity.text !== localGitIdentity) refuse()
  const git = shadowGit(stateRoot)
  const head = await gitMain(git)
  if (!(await gitIsAncestor(git, receipt.initialHead, head))) refuse()
  const manifest = await treeManifest(stateRoot, receipt.initialHead)
  if (
    manifest.fileCount !== receipt.fileCount ||
    manifest.bytes !== receipt.bytes ||
    manifest.manifestHash !== receipt.manifestHash
  )
    refuse()
}

function seedManifest(seed: ShadowMigrationFile[]) {
  const rows = seed
    .map((file) => ({ oid: localGitBlobId(file.text), path: file.path }))
    .sort((left, right) => comparePath(left.path, right.path))
  return {
    fileCount: rows.length,
    bytes: seed.reduce((sum, file) => sum + bytes(file.text), 0),
    manifestHash: digest(JSON.stringify(rows)),
  }
}

async function treeManifest(stateRoot: string, commit: string) {
  const git = shadowGit(stateRoot)
  const entries = await gitEntriesRecursive(git, commit)
  if (entries.some((entry) => entry.type !== 'blob' || entry.mode !== '100644')) refuse()
  const rows = [...entries].sort((left, right) => comparePath(left.path, right.path))
  let total = 0
  for (const entry of rows) total += await gitBlobSize(git, entry.oid)
  return {
    fileCount: rows.length,
    bytes: total,
    manifestHash: digest(JSON.stringify(rows.map((entry) => ({ oid: entry.oid, path: entry.path })))),
  }
}

function shadowGit(stateRoot: string): LocalGitContext {
  const identityPath = join(stateRoot, 'git-identity')
  return {
    bare: join(stateRoot, canonicalGitDirectoryName),
    env: localGitEnvironment(identityPath),
    hooksPath: join(stateRoot, 'empty-hooks'),
    identityPath,
  }
}

async function readMeta(stateRoot: string) {
  const bare = join(stateRoot, canonicalGitDirectoryName)
  const text = await readRequired(join(stateRoot, 'meta.json'))
  return parseMeta(JSON.parse(text), bare)
}

function parseReceipt(text: string): ShadowMigrationReceipt {
  if (bytes(text) > shadowMigrationLimits.maxReceiptBytes) refuse()
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    refuse()
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  const receipt = value as ShadowMigrationReceipt
  if (
    Object.keys(receipt).sort().join() !==
    'bytes,configHash,exportDigest,fileCount,forgettingDigest,initialHead,ledgerDigest,manifestHash,reviewed,rollback,sourceRevision,version'
  )
    refuse()
  if (
    receipt.version !== 1 ||
    !hashPattern.test(receipt.ledgerDigest) ||
    !hashPattern.test(receipt.configHash)
  )
    refuse()
  if (!/^[a-f0-9]{40,64}$/.test(receipt.sourceRevision) || !hashPattern.test(receipt.exportDigest)) refuse()
  if (
    !Number.isSafeInteger(receipt.fileCount) ||
    receipt.fileCount < 2 ||
    receipt.fileCount > shadowMigrationLimits.maxFiles
  )
    refuse()
  if (
    !Number.isSafeInteger(receipt.bytes) ||
    receipt.bytes < 0 ||
    receipt.bytes > shadowMigrationLimits.maxTotalBytes
  )
    refuse()
  if (!hashPattern.test(receipt.manifestHash) || !/^[a-f0-9]{40,64}$/.test(receipt.initialHead)) refuse()
  if (!hashPattern.test(receipt.forgettingDigest) || !Array.isArray(receipt.reviewed)) refuse()
  if (
    receipt.reviewed.some((id) => !validId(id)) ||
    new Set(receipt.reviewed).size !== receipt.reviewed.length
  )
    refuse()
  const rollback = receipt.rollback
  if (!rollback || typeof rollback !== 'object' || Array.isArray(rollback)) refuse()
  if (
    Object.keys(rollback).sort().join() !== 'dev,ino,migrationNonce,repository,serviceNonce' ||
    !/^[0-9a-f]{32}$/.test(rollback.migrationNonce) ||
    !/^[0-9a-f]{32}$/.test(rollback.serviceNonce) ||
    typeof rollback.repository !== 'string' ||
    typeof rollback.dev !== 'string' ||
    typeof rollback.ino !== 'string'
  )
    refuse()
  return receipt
}

function parseOwner(text: string) {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    refuse()
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  const owner = value as { version: number; nonce: string; exportDigest: string; dev: string; ino: string }
  if (
    Object.keys(owner).sort().join() !== 'dev,exportDigest,ino,nonce,version' ||
    owner.version !== 1 ||
    !/^[0-9a-f]{32}$/.test(owner.nonce) ||
    !hashPattern.test(owner.exportDigest) ||
    typeof owner.dev !== 'string' ||
    typeof owner.ino !== 'string'
  )
    refuse()
  return owner
}

async function assertQuiescent(stateRoot: string) {
  const terminal = new Set(['integrated', 'noop', 'failed', 'repaired', 'abandoned'])
  const jobsDir = join(stateRoot, 'jobs')
  if (await exists(jobsDir)) {
    for (const name of await readdir(jobsDir)) {
      if (isOwnedTempName(name)) continue
      if (!name.endsWith('.json')) refuse()
      let job
      try {
        job = await loadJob(stateRoot, name.slice(0, -5))
      } catch {
        refuse()
      }
      if (!terminal.has(job.status)) refuse()
      if (job.pendingIntegration !== null || job.expectedParent !== null) refuse()
      if (typeof job.worktreePath === 'string' && (await exists(job.worktreePath))) refuse()
    }
  }
  for (const path of ['repair.index', 'repair.index.lock']) if (await exists(join(stateRoot, path))) refuse()
  if (await residue(join(stateRoot, 'ownership'))) refuse()
  if (await residue(join(stateRoot, 'progress'))) refuse()
  if (await residue(join(stateRoot, 'worktrees'))) refuse()
}

async function residue(directory: string) {
  if (!(await exists(directory))) return false
  const names = (await readdir(directory)).filter((name) => !isOwnedTempName(name))
  return names.length > 0
}

function forwardInjection(
  injection: ShadowMigrationInjection | undefined,
): SyntheticLocalInjection | undefined {
  if (!injection) return undefined
  const { stopAfter, ...rest } = injection
  if (stopAfter === undefined || stopAfter === 'owner' || stopAfter === 'seeded') return rest
  return { ...rest, stopAfter }
}

async function directoryIdentity(path: string) {
  const stat = await lstat(path)
  return { dev: String(stat.dev), ino: String(stat.ino) }
}

async function assertDirectory(path: string) {
  try {
    return await assertExactDirectory(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') refuse()
    throw error
  }
}

async function readOptional(path: string) {
  try {
    return (await readRegularFile(path)).text
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    refuse()
  }
}

async function readRequired(path: string) {
  const text = await readOptional(path)
  if (text === undefined) refuse()
  return text
}

async function exists(path: string) {
  return lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false
      refuse()
    },
  )
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function comparePath(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function refuse(): never {
  throw Error('Local memory migration refused')
}

function turn<T>(stateRoot: string, body: () => Promise<T>): Promise<T> {
  const previous = turns.get(stateRoot) ?? Promise.resolve()
  const run = previous.then(body, body)
  turns.set(
    stateRoot,
    run.then(
      () => {},
      () => {},
    ),
  )
  return run
}
