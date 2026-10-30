import {
  type LocalJobKind,
  type LocalJobStatus,
  assertJobId,
  assertOid,
  assertRelativePath,
  jobIdPattern,
  localJobStatuses,
  oidPattern,
  relativePathPattern,
} from './contracts.ts'
import { assertPalacePath } from './palace-path.ts'

// Metadata snapshot and HTML for a disconnected synthetic Palace preview.
// It does not read Git, job files, or a private state root.
export const palacePreviewLimits = {
  pageSize: 32,
  maxSnapshotBytes: 48 * 1024,
} as const

const jobStatusSet = new Set<string>(localJobStatuses)
const kinds = new Set(['ordinary', 'reflection'])
const resumeCodes = ['starts', 'integrates', 'unchanged'] as const
const retryCodes = ['requeues', 'blocked', 'refused'] as const
const guidanceCodes = [
  'resume-starts',
  'resume-integrates',
  'resume-unchanged',
  'retry-requeues',
  'retry-blocked',
  'running-recovers-next-turn',
] as const
const recoveryOutcomes = ['committed', 'failed', 'interrupted'] as const
const recoveryPhases = ['none', 'settled', 'interrupted'] as const
const forgettingPhases = ['empty', 'removing', 'removed'] as const
const entryKinds = ['file', 'directory', 'symlink', 'submodule', 'special'] as const
const detachedRoles = ['detached-commit', 'detached-worktree'] as const

export type PalaceResume = (typeof resumeCodes)[number]
export type PalaceRetry = (typeof retryCodes)[number]
export type PalaceGuidance = (typeof guidanceCodes)[number]
export type PalaceRecoveryOutcome = (typeof recoveryOutcomes)[number]
export type PalaceEntryKind = (typeof entryKinds)[number]

export interface PalaceCorpusFact {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  bytes: number | null
}

export interface PalaceJobFact {
  id: string
  kind: LocalJobKind
  status: LocalJobStatus
  sequence: number
  baseHead: string
  workerCommit: string | null
  integratedCommit: string | null
  pendingIntegration: string | null
  expectedParent: string | null
  conflictPaths: readonly string[]
  detached: boolean
}

export interface PalaceRecoveryFact {
  jobId: string
  outcome: PalaceRecoveryOutcome
}

export interface PalaceForgettingFact {
  phase: (typeof forgettingPhases)[number]
  policyRevision: number
  pathCount: number
  blobCount: number
  sourceCount: number
}

export interface PalaceSnapshotFacts {
  head: string
  forgotten: number
  forgetting: PalaceForgettingFact
  corpus: readonly PalaceCorpusFact[]
  jobs: readonly PalaceJobFact[]
  recovery: readonly PalaceRecoveryFact[]
  hiddenConflicts?: number
}

export interface PalaceCorpusEntry {
  path: string
  kind: PalaceEntryKind
  bytes: number | null
}

export interface PalaceJobEntry {
  id: string
  kind: LocalJobKind
  status: LocalJobStatus
  sequence: number
  baseHead: string
  workerCommit: string | null
  integratedCommit: string | null
  pendingIntegration: string | null
  expectedParent: string | null
  conflictCount: number
  detached: boolean
  resume: PalaceResume
  retry: PalaceRetry
  guidance: PalaceGuidance
}

export interface PalaceConflictEntry {
  jobId: string
  sequence: number
  path: string
}

export interface PalaceDetachedEntry {
  jobId: string
  sequence: number
  role: (typeof detachedRoles)[number]
  oid: string | null
}

export interface PalaceRecoveryEntry {
  jobId: string
  outcome: PalaceRecoveryOutcome
}

export interface PalacePendingEntry {
  jobId: string
  sequence: number
  commit: string
  expectedParent: string
}

export interface PalacePageList<T> {
  total: number
  returned: number
  truncated: boolean
  entries: T[]
}

export interface PalaceSnapshot {
  version: 1
  bytes: number
  authority: {
    surface: 'synthetic-local-palace'
    live: 'abi2'
    label: 'not-live-authority'
  }
  head: string
  recovery: PalacePageList<PalaceRecoveryEntry> & {
    phase: (typeof recoveryPhases)[number]
    settledCommitted: number
    settledFailed: number
    interrupted: number
  }
  corpus: PalacePageList<PalaceCorpusEntry> & {
    forgotten: number
    corePresent: boolean
    indexPresent: boolean
  }
  history: {
    canonicalRef: 'refs/heads/main'
    canonicalCommit: string
    detachedTotal: number
    detachedReturned: number
    detachedTruncated: boolean
    detached: PalaceDetachedEntry[]
  }
  jobs: PalacePageList<PalaceJobEntry>
  conflicts: PalacePageList<PalaceConflictEntry> & { hidden: number }
  publication: {
    surface: 'synthetic'
    liveAuthority: 'abi2'
    notLiveAuthority: true
    pendingTotal: number
    pendingReturned: number
    pendingTruncated: boolean
    pending: PalacePendingEntry[]
    integrated: number
    forgettingPhase: (typeof forgettingPhases)[number]
    forgettingRevision: number
    forgottenPaths: number
    forgottenBlobs: number
    forgottenSources: number
  }
}

export type PalaceRenderPage =
  | { state: 'snapshot'; snapshot: PalaceSnapshot; reloadPath: string }
  | { state: 'loading'; reloadPath: string }
  | { state: 'error'; reloadPath: string }
  | { state: 'stale'; reloadPath: string }

function refused(): never {
  throw Error('Local memory palace refused')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareKeyed(
  left: { sequence?: number; id?: string; jobId?: string; path?: string },
  right: typeof left,
): number {
  const leftSequence = left.sequence ?? 0
  const rightSequence = right.sequence ?? 0
  if (leftSequence !== rightSequence) return leftSequence - rightSequence
  const leftId = left.id ?? left.jobId ?? ''
  const rightId = right.id ?? right.jobId ?? ''
  const byId = compareText(leftId, rightId)
  if (byId !== 0) return byId
  return compareText(left.path ?? '', right.path ?? '')
}

function assertCount(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) refused()
}

function nullableOid(value: string | null): string | null {
  if (value === null) return null
  assertOid(value)
  return value
}

export function palaceEntryKind(mode: string, type: PalaceCorpusFact['type']): PalaceEntryKind {
  if (mode === '100644' && type === 'blob') return 'file'
  if (mode === '040000' && type === 'tree') return 'directory'
  if (mode === '120000' && type === 'blob') return 'symlink'
  if (mode === '160000' && type === 'commit') return 'submodule'
  return 'special'
}

function eligibility(
  kind: LocalJobKind,
  status: LocalJobStatus,
): {
  resume: PalaceResume
  retry: PalaceRetry
  guidance: PalaceGuidance
} {
  const resume: PalaceResume =
    status === 'queued' ? 'starts' : status === 'committed' ? 'integrates' : 'unchanged'
  const retry: PalaceRetry =
    status === 'repair-needed'
      ? 'blocked'
      : kind === 'reflection' && status === 'failed'
        ? 'requeues'
        : 'refused'
  const guidance: PalaceGuidance =
    status === 'running'
      ? 'running-recovers-next-turn'
      : status === 'repair-needed'
        ? 'retry-blocked'
        : kind === 'reflection' && status === 'failed'
          ? 'retry-requeues'
          : status === 'queued'
            ? 'resume-starts'
            : status === 'committed'
              ? 'resume-integrates'
              : 'resume-unchanged'
  return { resume, retry, guidance }
}

function pageOf<T>(items: readonly T[], count: number): PalacePageList<T> {
  const entries = items.slice(0, count)
  return {
    total: items.length,
    returned: entries.length,
    truncated: entries.length < items.length,
    entries: [...entries],
  }
}

function jobEntry(job: PalaceJobFact): PalaceJobEntry {
  assertJobId(job.id)
  if (!kinds.has(job.kind) || !jobStatusSet.has(job.status)) refused()
  assertCount(job.sequence)
  if (job.sequence < 1) refused()
  assertOid(job.baseHead)
  const workerCommit = nullableOid(job.workerCommit)
  const integratedCommit = nullableOid(job.integratedCommit)
  const pendingIntegration = nullableOid(job.pendingIntegration)
  const expectedParent = nullableOid(job.expectedParent)
  if ((pendingIntegration === null) !== (expectedParent === null)) refused()
  if (!Array.isArray(job.conflictPaths) || job.conflictPaths.length > palacePreviewLimits.pageSize) refused()
  if (job.status !== 'repair-needed' && job.conflictPaths.length > 0) refused()
  const conflictPaths = [...job.conflictPaths]
  for (const path of conflictPaths) assertRelativePath(path)
  if (typeof job.detached !== 'boolean') refused()
  const access = eligibility(job.kind, job.status)
  const detached =
    ((job.status === 'committed' || job.status === 'repair-needed') && workerCommit !== null) ||
    (job.status === 'running' && job.detached)
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    sequence: job.sequence,
    baseHead: job.baseHead,
    workerCommit,
    integratedCommit,
    pendingIntegration,
    expectedParent,
    conflictCount: conflictPaths.length,
    detached,
    resume: access.resume,
    retry: access.retry,
    guidance: access.guidance,
  }
}

function stamp(fields: Omit<PalaceSnapshot, 'bytes' | 'version'>, bytes: number): PalaceSnapshot {
  return {
    version: 1,
    bytes,
    authority: fields.authority,
    head: fields.head,
    recovery: fields.recovery,
    corpus: fields.corpus,
    history: fields.history,
    jobs: fields.jobs,
    conflicts: fields.conflicts,
    publication: fields.publication,
  }
}

function seal(fields: Omit<PalaceSnapshot, 'bytes' | 'version'>): PalaceSnapshot {
  let bytes = 0
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const snapshot = stamp(fields, bytes)
    const size = Buffer.byteLength(JSON.stringify(snapshot))
    if (size === bytes) return snapshot
    bytes = size
  }
  refused()
}

function project(
  facts: {
    head: string
    forgotten: number
    forgetting: PalaceForgettingFact
    corpus: PalaceCorpusEntry[]
    jobs: PalaceJobEntry[]
    conflicts: PalaceConflictEntry[]
    detached: PalaceDetachedEntry[]
    recovery: PalaceRecoveryEntry[]
    pending: PalacePendingEntry[]
    corePresent: boolean
    indexPresent: boolean
    integrated: number
    hiddenConflicts: number
  },
  counts: {
    corpus: number
    jobs: number
    conflicts: number
    detached: number
    recovery: number
    pending: number
  },
): PalaceSnapshot {
  const corpus = pageOf(facts.corpus, counts.corpus)
  const jobs = pageOf(facts.jobs, counts.jobs)
  const visibleJobs = new Set(jobs.entries.map((job) => job.id))
  const conflictsForJobs = facts.conflicts.filter((entry) => visibleJobs.has(entry.jobId))
  const conflictPage = pageOf(conflictsForJobs, Math.min(counts.conflicts, conflictsForJobs.length))
  conflictPage.total = facts.conflicts.length
  conflictPage.truncated = conflictPage.returned < facts.conflicts.length
  const conflicts = { ...conflictPage, hidden: facts.hiddenConflicts }
  const detachedPage = pageOf(facts.detached, counts.detached)
  const recoveryPage = pageOf(facts.recovery, counts.recovery)
  const pendingPage = pageOf(facts.pending, counts.pending)
  const settledCommitted = facts.recovery.filter((entry) => entry.outcome === 'committed').length
  const settledFailed = facts.recovery.filter((entry) => entry.outcome === 'failed').length
  const interrupted = facts.recovery.filter((entry) => entry.outcome === 'interrupted').length
  return seal({
    authority: { surface: 'synthetic-local-palace', live: 'abi2', label: 'not-live-authority' },
    head: facts.head,
    recovery: {
      phase: interrupted > 0 ? 'interrupted' : settledCommitted + settledFailed > 0 ? 'settled' : 'none',
      settledCommitted,
      settledFailed,
      interrupted,
      ...recoveryPage,
    },
    corpus: {
      forgotten: facts.forgotten,
      corePresent: facts.corePresent,
      indexPresent: facts.indexPresent,
      ...corpus,
    },
    history: {
      canonicalRef: 'refs/heads/main',
      canonicalCommit: facts.head,
      detachedTotal: detachedPage.total,
      detachedReturned: detachedPage.returned,
      detachedTruncated: detachedPage.truncated,
      detached: detachedPage.entries,
    },
    jobs,
    conflicts,
    publication: {
      surface: 'synthetic',
      liveAuthority: 'abi2',
      notLiveAuthority: true,
      pendingTotal: pendingPage.total,
      pendingReturned: pendingPage.returned,
      pendingTruncated: pendingPage.truncated,
      pending: pendingPage.entries,
      integrated: facts.integrated,
      forgettingPhase: facts.forgetting.phase,
      forgettingRevision: facts.forgetting.policyRevision,
      forgottenPaths: facts.forgetting.pathCount,
      forgottenBlobs: facts.forgetting.blobCount,
      forgottenSources: facts.forgetting.sourceCount,
    },
  })
}

export function buildPalaceSnapshot(input: PalaceSnapshotFacts): PalaceSnapshot {
  assertOid(input.head)
  assertCount(input.forgotten)
  if (!isRecord(input.forgetting) || !forgettingPhases.includes(input.forgetting.phase)) refused()
  assertCount(input.forgetting.policyRevision)
  assertCount(input.forgetting.pathCount)
  assertCount(input.forgetting.blobCount)
  assertCount(input.forgetting.sourceCount)
  if (!Array.isArray(input.corpus) || !Array.isArray(input.jobs) || !Array.isArray(input.recovery)) refused()
  const seenPaths = new Set<string>()
  const corpus: PalaceCorpusEntry[] = []
  for (const entry of input.corpus) {
    if (typeof entry?.path !== 'string') refused()
    assertPalacePath(entry.path)
    if (seenPaths.has(entry.path)) refused()
    seenPaths.add(entry.path)
    if (entry.type !== 'blob' && entry.type !== 'tree' && entry.type !== 'commit') refused()
    if (typeof entry.mode !== 'string' || !/^[0-7]{6}$/.test(entry.mode)) refused()
    if (
      entry.bytes !== null &&
      (!Number.isInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 1_048_576)
    )
      refused()
    const kind = palaceEntryKind(entry.mode, entry.type)
    corpus.push({
      path: entry.path,
      kind,
      bytes: kind === 'file' ? entry.bytes : null,
    })
  }
  corpus.sort((left, right) => compareText(left.path, right.path))
  const seenJobs = new Set<string>()
  const jobs = input.jobs.map((job) => {
    if (typeof job?.id !== 'string') refused()
    const entry = jobEntry(job)
    if (seenJobs.has(entry.id)) refused()
    seenJobs.add(entry.id)
    return entry
  })
  jobs.sort(compareKeyed)
  const conflicts: PalaceConflictEntry[] = []
  for (const job of input.jobs) {
    const paths = [...job.conflictPaths].sort(compareText)
    for (const path of paths) conflicts.push({ jobId: job.id, sequence: job.sequence, path })
  }
  conflicts.sort(compareKeyed)
  const detached: PalaceDetachedEntry[] = []
  for (const job of jobs) {
    if ((job.status === 'committed' || job.status === 'repair-needed') && job.workerCommit)
      detached.push({ jobId: job.id, sequence: job.sequence, role: 'detached-commit', oid: job.workerCommit })
    else if (job.status === 'running' && job.detached)
      detached.push({ jobId: job.id, sequence: job.sequence, role: 'detached-worktree', oid: null })
  }
  const recovery: PalaceRecoveryEntry[] = input.recovery.map((entry) => {
    if (typeof entry?.jobId !== 'string') refused()
    assertJobId(entry.jobId)
    if (!recoveryOutcomes.includes(entry.outcome)) refused()
    return { jobId: entry.jobId, outcome: entry.outcome }
  })
  recovery.sort(
    (left, right) => compareText(left.jobId, right.jobId) || compareText(left.outcome, right.outcome),
  )
  const pending: PalacePendingEntry[] = []
  for (const job of jobs) {
    if (!job.pendingIntegration || !job.expectedParent) continue
    pending.push({
      jobId: job.id,
      sequence: job.sequence,
      commit: job.pendingIntegration,
      expectedParent: job.expectedParent,
    })
  }
  const core = corpus.find((entry) => entry.path === 'Core.md')
  const index = corpus.find((entry) => entry.path === 'index.md')
  const fields = {
    head: input.head,
    forgotten: input.forgotten,
    forgetting: input.forgetting,
    corpus,
    jobs,
    conflicts,
    detached,
    recovery,
    pending,
    corePresent: core?.kind === 'file',
    indexPresent: index?.kind === 'file',
    integrated: jobs.filter((job) => job.status === 'integrated').length,
    hiddenConflicts: input.hiddenConflicts ?? 0,
  }
  assertCount(fields.hiddenConflicts)
  let counts = {
    corpus: Math.min(palacePreviewLimits.pageSize, corpus.length),
    jobs: Math.min(palacePreviewLimits.pageSize, jobs.length),
    conflicts: Math.min(palacePreviewLimits.pageSize, conflicts.length),
    detached: Math.min(palacePreviewLimits.pageSize, detached.length),
    recovery: Math.min(palacePreviewLimits.pageSize, recovery.length),
    pending: Math.min(palacePreviewLimits.pageSize, pending.length),
  }
  let snapshot = project(fields, counts)
  for (let guard = 0; snapshot.bytes > palacePreviewLimits.maxSnapshotBytes && guard < 200; guard += 1) {
    if (counts.corpus > 0) counts = { ...counts, corpus: counts.corpus - 1 }
    else if (counts.detached > 0) counts = { ...counts, detached: counts.detached - 1 }
    else if (counts.conflicts > 0) counts = { ...counts, conflicts: counts.conflicts - 1 }
    else if (counts.pending > 0) counts = { ...counts, pending: counts.pending - 1 }
    else if (counts.recovery > 0) counts = { ...counts, recovery: counts.recovery - 1 }
    else if (counts.jobs > 0) counts = { ...counts, jobs: counts.jobs - 1 }
    else refused()
    snapshot = project(fields, counts)
  }
  if (snapshot.bytes > palacePreviewLimits.maxSnapshotBytes) refused()
  return parsePalaceSnapshot(snapshot)
}

function assertKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).sort().join() !== [...expected].sort().join()) refused()
}

function readBool(value: unknown): boolean {
  if (typeof value !== 'boolean') refused()
  return value
}

function readInt(value: unknown): number {
  if (typeof value !== 'number') refused()
  assertCount(value)
  return value
}

function readText(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) refused()
  return value
}

function readPalacePath(value: unknown): string {
  if (typeof value !== 'string') refused()
  assertPalacePath(value)
  return value
}

function readNullableOid(value: unknown): string | null {
  if (value === null) return null
  return readText(value, oidPattern)
}

function assertPage<T>(
  value: unknown,
  read: (entry: unknown) => T,
  extra: readonly string[] = [],
): PalacePageList<T> {
  if (!isRecord(value)) refused()
  assertKeys(value, ['entries', 'returned', 'total', 'truncated', ...extra])
  const total = readInt(value.total)
  const returned = readInt(value.returned)
  const truncated = readBool(value.truncated)
  if (
    !Array.isArray(value.entries) ||
    value.entries.length !== returned ||
    value.entries.length > palacePreviewLimits.pageSize
  )
    refused()
  if (returned > total || truncated !== returned < total) refused()
  return { total, returned, truncated, entries: value.entries.map(read) }
}

function assertSorted(
  entries: readonly { sequence?: number; id?: string; jobId?: string; path?: string }[],
): void {
  for (let index = 1; index < entries.length; index += 1) {
    if (compareKeyed(entries[index - 1], entries[index]) > 0) refused()
  }
}

function assertNoPrivateString(value: unknown): void {
  if (typeof value === 'string') {
    if (value.startsWith('/') || value.includes('\\') || value.includes('\0') || value.includes('://'))
      refused()
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertNoPrivateString(entry)
    return
  }
  if (!isRecord(value)) return
  for (const [key, entry] of Object.entries(value)) {
    if (
      [
        'reflection',
        'summary',
        'worktreePath',
        'trajectory',
        'session',
        'text',
        'body',
        'excerpt',
        'prompt',
        'frontmatter',
        'diff',
        'error',
        'ownership',
        'stateRoot',
        'repository',
      ].includes(key)
    )
      refused()
    assertNoPrivateString(entry)
  }
}

export function parsePalaceSnapshot(value: unknown): PalaceSnapshot {
  if (!isRecord(value)) refused()
  assertNoPrivateString(value)
  assertKeys(value, [
    'authority',
    'bytes',
    'conflicts',
    'corpus',
    'head',
    'history',
    'jobs',
    'publication',
    'recovery',
    'version',
  ])
  if (value.version !== 1) refused()
  const bytes = readInt(value.bytes)
  if (!isRecord(value.authority)) refused()
  assertKeys(value.authority, ['label', 'live', 'surface'])
  if (
    value.authority.surface !== 'synthetic-local-palace' ||
    value.authority.live !== 'abi2' ||
    value.authority.label !== 'not-live-authority'
  )
    refused()
  const head = readText(value.head, oidPattern)
  if (!isRecord(value.recovery)) refused()
  const recoveryPage = assertPage(
    value.recovery,
    (entry) => {
      if (!isRecord(entry)) refused()
      assertKeys(entry, ['jobId', 'outcome'])
      if (!recoveryOutcomes.includes(entry.outcome as PalaceRecoveryOutcome)) refused()
      return { jobId: readText(entry.jobId, jobIdPattern), outcome: entry.outcome as PalaceRecoveryOutcome }
    },
    ['interrupted', 'phase', 'settledCommitted', 'settledFailed'],
  )
  if (!recoveryPhases.includes(value.recovery.phase as (typeof recoveryPhases)[number])) refused()
  const recovery = {
    phase: value.recovery.phase as (typeof recoveryPhases)[number],
    settledCommitted: readInt(value.recovery.settledCommitted),
    settledFailed: readInt(value.recovery.settledFailed),
    interrupted: readInt(value.recovery.interrupted),
    ...recoveryPage,
  }
  if (!isRecord(value.corpus)) refused()
  const corpusPage = assertPage(
    value.corpus,
    (entry) => {
      if (!isRecord(entry)) refused()
      assertKeys(entry, ['bytes', 'kind', 'path'])
      if (!entryKinds.includes(entry.kind as PalaceEntryKind)) refused()
      const bytesValue = entry.bytes === null ? null : readInt(entry.bytes)
      return {
        path: readPalacePath(entry.path),
        kind: entry.kind as PalaceEntryKind,
        bytes: bytesValue,
      }
    },
    ['corePresent', 'forgotten', 'indexPresent'],
  )
  const corpus = {
    forgotten: readInt(value.corpus.forgotten),
    corePresent: readBool(value.corpus.corePresent),
    indexPresent: readBool(value.corpus.indexPresent),
    ...corpusPage,
  }
  assertSorted(corpus.entries)
  if (!isRecord(value.history)) refused()
  assertKeys(value.history, [
    'canonicalCommit',
    'canonicalRef',
    'detached',
    'detachedReturned',
    'detachedTotal',
    'detachedTruncated',
  ])
  if (value.history.canonicalRef !== 'refs/heads/main' || value.history.canonicalCommit !== head) refused()
  const detachedTotal = readInt(value.history.detachedTotal)
  const detachedReturned = readInt(value.history.detachedReturned)
  const detachedTruncated = readBool(value.history.detachedTruncated)
  if (!Array.isArray(value.history.detached) || value.history.detached.length !== detachedReturned) refused()
  if (detachedReturned > palacePreviewLimits.pageSize || detachedReturned > detachedTotal) refused()
  if (detachedTruncated !== detachedReturned < detachedTotal) refused()
  const detached = value.history.detached.map((entry) => {
    if (!isRecord(entry)) refused()
    assertKeys(entry, ['jobId', 'oid', 'role', 'sequence'])
    if (!detachedRoles.includes(entry.role as (typeof detachedRoles)[number])) refused()
    const oid = entry.oid === null ? null : readText(entry.oid, oidPattern)
    if (entry.role === 'detached-commit' && oid === null) refused()
    if (entry.role === 'detached-worktree' && oid !== null) refused()
    return {
      jobId: readText(entry.jobId, jobIdPattern),
      sequence: readInt(entry.sequence),
      role: entry.role as (typeof detachedRoles)[number],
      oid,
    }
  })
  assertSorted(detached)
  const jobs = assertPage(value.jobs, (entry) => {
    if (!isRecord(entry)) refused()
    assertKeys(entry, [
      'baseHead',
      'conflictCount',
      'detached',
      'expectedParent',
      'guidance',
      'id',
      'integratedCommit',
      'kind',
      'pendingIntegration',
      'resume',
      'retry',
      'sequence',
      'status',
      'workerCommit',
    ])
    const kind: LocalJobKind =
      entry.kind === 'reflection' ? 'reflection' : entry.kind === 'ordinary' ? 'ordinary' : refused()
    const status = jobStatusSet.has(String(entry.status)) ? (entry.status as LocalJobStatus) : refused()
    const access = eligibility(kind, status)
    if (entry.resume !== access.resume || entry.retry !== access.retry || entry.guidance !== access.guidance)
      refused()
    return {
      id: readText(entry.id, jobIdPattern),
      kind,
      status: status as LocalJobStatus,
      sequence: readInt(entry.sequence),
      baseHead: readText(entry.baseHead, oidPattern),
      workerCommit: readNullableOid(entry.workerCommit),
      integratedCommit: readNullableOid(entry.integratedCommit),
      pendingIntegration: readNullableOid(entry.pendingIntegration),
      expectedParent: readNullableOid(entry.expectedParent),
      conflictCount: readInt(entry.conflictCount),
      detached: (() => {
        const workerCommit = readNullableOid(entry.workerCommit)
        const claimed = readBool(entry.detached)
        const actual =
          ((status === 'committed' || status === 'repair-needed') && workerCommit !== null) ||
          (status === 'running' && claimed)
        if (claimed !== actual) refused()
        return claimed
      })(),
      resume: access.resume,
      retry: access.retry,
      guidance: access.guidance,
    }
  })
  assertSorted(jobs.entries)
  const conflictPage = assertPage(
    value.conflicts,
    (entry) => {
      if (!isRecord(entry)) refused()
      assertKeys(entry, ['jobId', 'path', 'sequence'])
      return {
        jobId: readText(entry.jobId, jobIdPattern),
        sequence: readInt(entry.sequence),
        path: readText(entry.path, relativePathPattern),
      }
    },
    ['hidden'],
  )
  if (!isRecord(value.conflicts)) refused()
  const conflicts = { ...conflictPage, hidden: readInt(value.conflicts.hidden) }
  assertSorted(conflicts.entries)
  if (!isRecord(value.publication)) refused()
  assertKeys(value.publication, [
    'forgottenBlobs',
    'forgottenPaths',
    'forgottenSources',
    'forgettingPhase',
    'forgettingRevision',
    'integrated',
    'liveAuthority',
    'notLiveAuthority',
    'pending',
    'pendingReturned',
    'pendingTotal',
    'pendingTruncated',
    'surface',
  ])
  if (value.publication.surface !== 'synthetic' || value.publication.liveAuthority !== 'abi2') refused()
  if (value.publication.notLiveAuthority !== true) refused()
  if (!forgettingPhases.includes(value.publication.forgettingPhase as (typeof forgettingPhases)[number]))
    refused()
  const pendingTotal = readInt(value.publication.pendingTotal)
  const pendingReturned = readInt(value.publication.pendingReturned)
  const pendingTruncated = readBool(value.publication.pendingTruncated)
  if (!Array.isArray(value.publication.pending) || value.publication.pending.length !== pendingReturned)
    refused()
  if (pendingReturned > palacePreviewLimits.pageSize || pendingReturned > pendingTotal) refused()
  if (pendingTruncated !== pendingReturned < pendingTotal) refused()
  const pending = value.publication.pending.map((entry) => {
    if (!isRecord(entry)) refused()
    assertKeys(entry, ['commit', 'expectedParent', 'jobId', 'sequence'])
    return {
      jobId: readText(entry.jobId, jobIdPattern),
      sequence: readInt(entry.sequence),
      commit: readText(entry.commit, oidPattern),
      expectedParent: readText(entry.expectedParent, oidPattern),
    }
  })
  const snapshot = seal({
    authority: { surface: 'synthetic-local-palace', live: 'abi2', label: 'not-live-authority' },
    head,
    recovery,
    corpus,
    history: {
      canonicalRef: 'refs/heads/main',
      canonicalCommit: head,
      detachedTotal,
      detachedReturned,
      detachedTruncated,
      detached,
    },
    jobs,
    conflicts,
    publication: {
      surface: 'synthetic',
      liveAuthority: 'abi2',
      notLiveAuthority: true,
      pendingTotal,
      pendingReturned,
      pendingTruncated,
      pending,
      integrated: readInt(value.publication.integrated),
      forgettingPhase: value.publication.forgettingPhase as (typeof forgettingPhases)[number],
      forgettingRevision: readInt(value.publication.forgettingRevision),
      forgottenPaths: readInt(value.publication.forgottenPaths),
      forgottenBlobs: readInt(value.publication.forgottenBlobs),
      forgottenSources: readInt(value.publication.forgottenSources),
    },
  })
  if (snapshot.bytes !== bytes || snapshot.bytes > palacePreviewLimits.maxSnapshotBytes) refused()
  return snapshot
}

export function escapePalaceText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
