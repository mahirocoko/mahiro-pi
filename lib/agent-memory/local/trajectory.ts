import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { hasSecret } from '../../continuity/records.ts'
import { assertRealDirectory, isOwnedTempName, readRegularFile, writeExclusive } from './confine.ts'
import { type LocalJobKind, type LocalJobRecord, assertJobId, assertSummary } from './contracts.ts'
import { type MaintenanceWorkspace } from './workspace.ts'

// Synthetic trajectory owner. Harness entries only. Not a live session or model worker.
export const trajectoryLimits = {
  maxInputEntries: 128,
  maxStepCount: 128,
  maxRangeEntries: 8,
  maxEntryBytes: 256,
  maxRangeBytes: 1024,
  maxHardTextBytes: 65536,
  maxBranches: 16,
} as const

export const trajectoryPolicies = ['off', 'compaction', 'step-count'] as const
export type TrajectoryPolicy = (typeof trajectoryPolicies)[number]
export const trajectoryRoles = ['user', 'assistant', 'tool'] as const
export type TrajectoryRole = (typeof trajectoryRoles)[number]

const roleSet = new Set<string>(trajectoryRoles)
const trajectoryIdPattern = /^[a-z][a-z0-9-]{0,31}$/
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const digestPattern = /^[0-9a-f]{64}$/
const inputEntryKeys = ['branchId', 'entryId', 'order', 'role', 'sessionId', 'text', 'timestamp']
const storedEntryKeys = [...inputEntryKeys, 'truncated']
const snapshotKeys = [
  'afterOrder',
  'branchId',
  'byteCount',
  'compactionFirstKeptEntryId',
  'compactionFirstKeptOrder',
  'digest',
  'endEntryId',
  'endOrder',
  'entries',
  'entryCount',
  'omittedEntryCount',
  'omittedEntryIds',
  'preservedPreCompactionCount',
  'sessionId',
  'startEntryId',
  'startOrder',
  'truncatedEntryCount',
]
const watermarkKeys = ['branchId', 'entryId', 'jobId', 'order', 'rangeDigest', 'sessionId', 'version']

// An assistant row is caller-finalized; this API does not ingest streaming or reasoning rows.
export interface SyntheticPublicEntry {
  sessionId: string
  branchId: string
  entryId: string
  role: TrajectoryRole
  text: string
  order: number
  timestamp: string
}

export interface SyntheticTrajectoryRequest {
  sessionId: string
  branchId: string
  entries: SyntheticPublicEntry[]
  compaction?: { firstKeptEntryId: string }
  replay?: { jobId: string; digest: string }
}

export interface TrajectoryViewEntry {
  sessionId: string
  branchId: string
  entryId: string
  role: TrajectoryRole
  text: string
  order: number
  timestamp: string
  truncated: boolean
}

export interface TrajectoryProjection {
  sessionId: string
  branchId: string
  afterOrder: number
  startEntryId: string
  endEntryId: string
  startOrder: number
  endOrder: number
  entryCount: number
  byteCount: number
  omittedEntryCount: number
  truncatedEntryCount: number
  preservedPreCompactionCount: number
  compactionFirstKeptEntryId: string | null
  compactionFirstKeptOrder: number | null
  digest: string
  entries: TrajectoryViewEntry[]
  omittedEntryIds: string[]
}

export interface WatermarkRecord {
  version: 1
  sessionId: string
  branchId: string
  entryId: string
  order: number
  rangeDigest: string
  jobId: string
}

export interface WatermarkView {
  sessionId: string
  branchId: string
  entryId: string | null
  order: number
  rangeDigest: string | null
  jobId: string | null
}

export interface TrajectoryWorkerView {
  sessionId: string
  branchId: string
  digest: string
  startEntryId: string
  endEntryId: string
  entryCount: number
  byteCount: number
  omittedEntryCount: number
  truncatedEntryCount: number
  preservedPreCompactionCount: number
  entries: TrajectoryViewEntry[]
}

export interface MaintenanceWorkerInput {
  jobId: string
  trajectory: TrajectoryWorkerView
  workspace: MaintenanceWorkspace
}

export type MaintenanceWorker = (input: MaintenanceWorkerInput) => Promise<void> | void

export interface SyntheticTrajectoryConfig {
  policy: TrajectoryPolicy
  stepCount?: number
  maintenance?: MaintenanceWorker
}

export interface TrajectoryRuntime {
  policy: TrajectoryPolicy
  stepCount: number | null
  maintenance?: MaintenanceWorker
}

export interface ReflectionReceipt {
  action: 'idle' | 'queued' | 'pending'
  reason:
    | 'policy-off'
    | 'empty'
    | 'below-threshold'
    | 'awaiting-compaction'
    | 'queued'
    | 'in-flight'
    | 'consumed'
  policy: TrajectoryPolicy
  range: TrajectoryProjection | null
  job: LocalJobRecord | null
  progress: {
    observedEntryCount: number
    pendingAssistantStepCount: number
    settledOrder: number
    configuredThreshold: number | null
    capturedEntryCount: number
  }
}

function refuse(): never {
  throw Error('Local memory trajectory refused')
}

function exactKeys(value: object, keys: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) refuse()
}

function assertTrajectoryId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !trajectoryIdPattern.test(value)) refuse()
}

function assertTimestamp(value: string): void {
  if (typeof value !== 'string' || !timestampPattern.test(value)) refuse()
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) refuse()
  if (`${new Date(parsed).toISOString().slice(0, 19)}Z` !== value) refuse()
}

export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text
  let used = 0
  let end = 0
  for (const char of text) {
    const size = Buffer.byteLength(char)
    if (used + size > maxBytes) break
    used += size
    end += char.length
  }
  return text.slice(0, end)
}

function enoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export function normalizeTrajectoryConfig(
  value: SyntheticTrajectoryConfig | undefined,
): TrajectoryRuntime | null {
  if (value === undefined) return null
  if (!value || typeof value !== 'object') refuse()
  const policy = value.policy
  if (policy !== 'off' && policy !== 'compaction' && policy !== 'step-count') refuse()
  let stepCount: number | null = null
  if (policy === 'step-count') {
    if (
      !Number.isInteger(value.stepCount) ||
      value.stepCount === undefined ||
      value.stepCount < 1 ||
      value.stepCount > trajectoryLimits.maxStepCount
    )
      refuse()
    stepCount = value.stepCount
  } else if (value.stepCount !== undefined) refuse()
  if (value.maintenance !== undefined && typeof value.maintenance !== 'function') refuse()
  if (policy !== 'off' && typeof value.maintenance !== 'function') refuse()
  return value.maintenance ? { policy, stepCount, maintenance: value.maintenance } : { policy, stepCount }
}

export function normalizeEntries(
  sessionId: string,
  branchId: string,
  value: unknown,
): SyntheticPublicEntry[] {
  assertTrajectoryId(sessionId)
  assertTrajectoryId(branchId)
  if (!Array.isArray(value) || value.length > trajectoryLimits.maxInputEntries) refuse()
  const seen = new Set<string>()
  let previousOrder = 0
  let previousTimestamp = ''
  const entries: SyntheticPublicEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) refuse()
    exactKeys(item, inputEntryKeys)
    const entry = item as SyntheticPublicEntry
    assertTrajectoryId(entry.sessionId)
    assertTrajectoryId(entry.branchId)
    assertTrajectoryId(entry.entryId)
    if (entry.sessionId !== sessionId || entry.branchId !== branchId) refuse()
    if (seen.has(entry.entryId)) refuse()
    seen.add(entry.entryId)
    if (!roleSet.has(entry.role)) refuse()
    if (typeof entry.text !== 'string' || entry.text.includes('\0')) refuse()
    if (Buffer.byteLength(entry.text) > trajectoryLimits.maxHardTextBytes) refuse()
    if (!Number.isInteger(entry.order) || entry.order <= previousOrder || entry.order > 1_000_000) refuse()
    assertTimestamp(entry.timestamp)
    if (previousTimestamp && entry.timestamp <= previousTimestamp) refuse()
    previousOrder = entry.order
    previousTimestamp = entry.timestamp
    entries.push({
      sessionId,
      branchId,
      entryId: entry.entryId,
      role: entry.role,
      text: entry.text,
      order: entry.order,
      timestamp: entry.timestamp,
    })
  }
  return entries
}

function normalizeCompaction(
  value: unknown,
  entries: readonly SyntheticPublicEntry[],
): { firstKeptEntryId: string } | null {
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  exactKeys(value, ['firstKeptEntryId'])
  const id = (value as { firstKeptEntryId: unknown }).firstKeptEntryId
  if (typeof id !== 'string' || !entries.some((entry) => entry.entryId === id)) refuse()
  return { firstKeptEntryId: id }
}

function normalizeReplay(value: unknown): { jobId: string; digest: string } | null {
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  exactKeys(value, ['digest', 'jobId'])
  const replay = value as { jobId: unknown; digest: unknown }
  if (typeof replay.jobId !== 'string' || typeof replay.digest !== 'string') refuse()
  assertJobId(replay.jobId)
  if (!digestPattern.test(replay.digest)) refuse()
  return { jobId: replay.jobId, digest: replay.digest }
}

function projectionDigest(range: Omit<TrajectoryProjection, 'digest'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        afterOrder: range.afterOrder,
        branchId: range.branchId,
        byteCount: range.byteCount,
        compactionFirstKeptEntryId: range.compactionFirstKeptEntryId,
        compactionFirstKeptOrder: range.compactionFirstKeptOrder,
        endEntryId: range.endEntryId,
        endOrder: range.endOrder,
        entries: range.entries.map((entry) => ({
          branchId: entry.branchId,
          entryId: entry.entryId,
          order: entry.order,
          role: entry.role,
          sessionId: entry.sessionId,
          text: entry.text,
          timestamp: entry.timestamp,
          truncated: entry.truncated,
        })),
        entryCount: range.entryCount,
        omittedEntryCount: range.omittedEntryCount,
        omittedEntryIds: range.omittedEntryIds,
        preservedPreCompactionCount: range.preservedPreCompactionCount,
        sessionId: range.sessionId,
        startEntryId: range.startEntryId,
        startOrder: range.startOrder,
        truncatedEntryCount: range.truncatedEntryCount,
      }),
    )
    .digest('hex')
}

export function selectTrajectoryRange(
  entries: readonly SyntheticPublicEntry[],
  afterOrder: number,
  compaction: { firstKeptEntryId: string } | null,
): TrajectoryProjection | null {
  if (!Number.isInteger(afterOrder) || afterOrder < 0) refuse()
  const pending = entries.filter((entry) => entry.order > afterOrder)
  if (!pending.length) return null
  let keptOrder: number | null = null
  let keptId: string | null = null
  if (compaction) {
    const kept = entries.find((entry) => entry.entryId === compaction.firstKeptEntryId)
    if (!kept) refuse()
    keptOrder = kept.order
    keptId = kept.entryId
  }
  const selected: TrajectoryViewEntry[] = []
  const omittedEntryIds: string[] = []
  let byteCount = 0
  let truncatedEntryCount = 0
  for (const entry of pending) {
    const { text, truncated } = exposedEntry(entry.text)
    const size = Buffer.byteLength(text)
    const fits =
      selected.length < trajectoryLimits.maxRangeEntries && byteCount + size <= trajectoryLimits.maxRangeBytes
    if (!fits) {
      omittedEntryIds.push(
        entry.entryId,
        ...pending.slice(pending.indexOf(entry) + 1).map((item) => item.entryId),
      )
      break
    }
    if (truncated) truncatedEntryCount += 1
    byteCount += size
    selected.push({
      sessionId: entry.sessionId,
      branchId: entry.branchId,
      entryId: entry.entryId,
      role: entry.role,
      text,
      order: entry.order,
      timestamp: entry.timestamp,
      truncated,
    })
  }
  const first = selected[0]
  const last = selected[selected.length - 1]
  if (!first || !last) refuse()
  const preservedPreCompactionCount =
    keptOrder === null ? 0 : selected.filter((entry) => entry.order < keptOrder).length
  const projection = {
    sessionId: first.sessionId,
    branchId: first.branchId,
    afterOrder,
    startEntryId: first.entryId,
    endEntryId: last.entryId,
    startOrder: first.order,
    endOrder: last.order,
    entryCount: selected.length,
    byteCount,
    omittedEntryCount: omittedEntryIds.length,
    truncatedEntryCount,
    preservedPreCompactionCount,
    compactionFirstKeptEntryId: keptId,
    compactionFirstKeptOrder: keptOrder,
    entries: selected,
    omittedEntryIds,
  }
  return { ...projection, digest: projectionDigest(projection) }
}

const redactedEntryText = '[Secret-bearing entry withheld]'

function exposedEntry(raw: string): { text: string; truncated: boolean } {
  const safe = hasSecret(raw) ? redactedEntryText : raw
  const text = truncateUtf8(safe, trajectoryLimits.maxEntryBytes)
  return { text, truncated: text !== raw }
}

function parseStoredEntry(value: unknown, sessionId: string, branchId: string): TrajectoryViewEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  exactKeys(value, storedEntryKeys)
  const entry = value as TrajectoryViewEntry
  assertTrajectoryId(entry.sessionId)
  assertTrajectoryId(entry.branchId)
  assertTrajectoryId(entry.entryId)
  if (entry.sessionId !== sessionId || entry.branchId !== branchId) refuse()
  if (!roleSet.has(entry.role)) refuse()
  if (typeof entry.text !== 'string' || entry.text.includes('\0')) refuse()
  if (Buffer.byteLength(entry.text) > trajectoryLimits.maxEntryBytes) refuse()
  if (!Number.isInteger(entry.order) || entry.order < 1 || entry.order > 1_000_000) refuse()
  assertTimestamp(entry.timestamp)
  if (typeof entry.truncated !== 'boolean') refuse()
  return {
    sessionId,
    branchId,
    entryId: entry.entryId,
    role: entry.role,
    text: entry.text,
    order: entry.order,
    timestamp: entry.timestamp,
    truncated: entry.truncated,
  }
}

export function parseJobReflection(value: unknown, kind: LocalJobKind): TrajectoryProjection | null {
  if (kind === 'ordinary') {
    if (value !== undefined && value !== null) refuse()
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  exactKeys(value, snapshotKeys)
  const range = value as TrajectoryProjection
  assertTrajectoryId(range.sessionId)
  assertTrajectoryId(range.branchId)
  assertTrajectoryId(range.startEntryId)
  assertTrajectoryId(range.endEntryId)
  if (!digestPattern.test(range.digest)) refuse()
  if (!Number.isInteger(range.afterOrder) || range.afterOrder < 0) refuse()
  if (!Number.isInteger(range.entryCount) || range.entryCount < 1) refuse()
  if (!Number.isInteger(range.byteCount) || range.byteCount < 0) refuse()
  if (!Number.isInteger(range.omittedEntryCount) || range.omittedEntryCount < 0) refuse()
  if (!Number.isInteger(range.truncatedEntryCount) || range.truncatedEntryCount < 0) refuse()
  if (!Number.isInteger(range.preservedPreCompactionCount) || range.preservedPreCompactionCount < 0) refuse()
  if (!Array.isArray(range.entries) || !Array.isArray(range.omittedEntryIds)) refuse()
  const entries = range.entries.map((entry) => parseStoredEntry(entry, range.sessionId, range.branchId))
  if (entries.length !== range.entryCount || entries.length > trajectoryLimits.maxRangeEntries) refuse()
  const first = entries[0]
  const last = entries[entries.length - 1]
  if (!first || !last) refuse()
  if (first.entryId !== range.startEntryId || first.order !== range.startOrder) refuse()
  if (last.entryId !== range.endEntryId || last.order !== range.endOrder) refuse()
  if (first.order <= range.afterOrder) refuse()
  let bytes = 0
  let truncated = 0
  let previous = range.afterOrder
  const included = new Set<string>()
  for (const entry of entries) {
    if (entry.order <= previous) refuse()
    previous = entry.order
    included.add(entry.entryId)
    bytes += Buffer.byteLength(entry.text)
    if (entry.truncated) truncated += 1
  }
  if (bytes !== range.byteCount || bytes > trajectoryLimits.maxRangeBytes) refuse()
  if (truncated !== range.truncatedEntryCount) refuse()
  if (range.omittedEntryIds.length !== range.omittedEntryCount) refuse()
  if (range.omittedEntryIds.length > trajectoryLimits.maxInputEntries) refuse()
  const omitted = new Set<string>()
  for (const id of range.omittedEntryIds) {
    if (typeof id !== 'string') refuse()
    assertTrajectoryId(id)
    if (included.has(id) || omitted.has(id)) refuse()
    omitted.add(id)
  }
  const keptId = range.compactionFirstKeptEntryId
  const keptOrder = range.compactionFirstKeptOrder
  if ((keptId === null) !== (keptOrder === null)) refuse()
  if (keptId !== null) {
    if (typeof keptId !== 'string' || !Number.isInteger(keptOrder)) refuse()
    assertTrajectoryId(keptId)
    const kept = entries.find((entry) => entry.entryId === keptId)
    if (kept && kept.order !== keptOrder) refuse()
  }
  const preserved =
    keptOrder === null ? 0 : entries.filter((entry) => entry.order < (keptOrder as number)).length
  if (preserved !== range.preservedPreCompactionCount) refuse()
  const projection = {
    sessionId: range.sessionId,
    branchId: range.branchId,
    afterOrder: range.afterOrder,
    startEntryId: range.startEntryId,
    endEntryId: range.endEntryId,
    startOrder: range.startOrder,
    endOrder: range.endOrder,
    entryCount: range.entryCount,
    byteCount: range.byteCount,
    omittedEntryCount: range.omittedEntryCount,
    truncatedEntryCount: range.truncatedEntryCount,
    preservedPreCompactionCount: range.preservedPreCompactionCount,
    compactionFirstKeptEntryId: keptId,
    compactionFirstKeptOrder: keptOrder,
    entries,
    omittedEntryIds: [...range.omittedEntryIds],
  }
  if (projectionDigest(projection) !== range.digest) refuse()
  return { ...projection, digest: range.digest }
}

function parseWatermark(value: unknown, sessionId: string, branchId: string): WatermarkRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse()
  exactKeys(value, watermarkKeys)
  const record = value as WatermarkRecord
  assertTrajectoryId(sessionId)
  assertTrajectoryId(branchId)
  assertTrajectoryId(record.sessionId)
  assertTrajectoryId(record.branchId)
  assertTrajectoryId(record.entryId)
  if (record.version !== 1 || record.sessionId !== sessionId || record.branchId !== branchId) refuse()
  assertJobId(record.jobId)
  if (!digestPattern.test(record.rangeDigest)) refuse()
  if (!Number.isInteger(record.order) || record.order < 1 || record.order > 1_000_000) refuse()
  return {
    version: 1,
    sessionId,
    branchId,
    entryId: record.entryId,
    order: record.order,
    rangeDigest: record.rangeDigest,
    jobId: record.jobId,
  }
}

async function readJson(path: string): Promise<unknown> {
  const file = await readRegularFile(path)
  try {
    return JSON.parse(file.text) as unknown
  } catch {
    refuse()
  }
}

function watermarkPath(stateRoot: string, sessionId: string, branchId: string): string {
  assertTrajectoryId(sessionId)
  assertTrajectoryId(branchId)
  return join(stateRoot, 'watermarks', `${sessionId}__${branchId}.json`)
}

async function watermarkNames(stateRoot: string): Promise<string[]> {
  const directory = join(stateRoot, 'watermarks')
  await assertRealDirectory(directory)
  const names = (await readdir(directory)).filter((name) => !isOwnedTempName(name))
  if (names.length > trajectoryLimits.maxBranches) refuse()
  for (const name of names) if (!/^[a-z][a-z0-9-]{0,31}__[a-z][a-z0-9-]{0,31}\.json$/.test(name)) refuse()
  return [...names].sort()
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeExclusive(path, `${JSON.stringify(value)}\n`)
}

export async function loadWatermark(
  stateRoot: string,
  sessionId: string,
  branchId: string,
): Promise<WatermarkRecord | undefined> {
  try {
    return parseWatermark(await readJson(watermarkPath(stateRoot, sessionId, branchId)), sessionId, branchId)
  } catch (error) {
    if (enoent(error)) return undefined
    throw error
  }
}

async function saveWatermark(stateRoot: string, record: WatermarkRecord): Promise<void> {
  const stored = parseWatermark(record, record.sessionId, record.branchId)
  const names = await watermarkNames(stateRoot)
  const name = `${stored.sessionId}__${stored.branchId}.json`
  if (!names.includes(name) && names.length >= trajectoryLimits.maxBranches) refuse()
  await writeJson(watermarkPath(stateRoot, stored.sessionId, stored.branchId), stored)
}

export async function assertBranchRoom(
  stateRoot: string,
  sessionId: string,
  branchId: string,
  jobs: readonly LocalJobRecord[],
): Promise<void> {
  assertTrajectoryId(sessionId)
  assertTrajectoryId(branchId)
  const reserved = new Set(await watermarkNames(stateRoot))
  for (const job of jobs) {
    if (job.kind !== 'reflection' || !job.reflection) continue
    reserved.add(`${job.reflection.sessionId}__${job.reflection.branchId}.json`)
  }
  const key = `${sessionId}__${branchId}.json`
  if (reserved.has(key)) return
  if (reserved.size >= trajectoryLimits.maxBranches) refuse()
}

export async function readWatermarkView(
  stateRoot: string,
  identity: { sessionId: string; branchId: string },
): Promise<WatermarkView> {
  const stored = await loadWatermark(stateRoot, identity.sessionId, identity.branchId)
  if (!stored) {
    return {
      sessionId: identity.sessionId,
      branchId: identity.branchId,
      entryId: null,
      order: 0,
      rangeDigest: null,
      jobId: null,
    }
  }
  return {
    sessionId: stored.sessionId,
    branchId: stored.branchId,
    entryId: stored.entryId,
    order: stored.order,
    rangeDigest: stored.rangeDigest,
    jobId: stored.jobId,
  }
}

export function trajectoryView(range: TrajectoryProjection): TrajectoryWorkerView {
  return {
    sessionId: range.sessionId,
    branchId: range.branchId,
    digest: range.digest,
    startEntryId: range.startEntryId,
    endEntryId: range.endEntryId,
    entryCount: range.entryCount,
    byteCount: range.byteCount,
    omittedEntryCount: range.omittedEntryCount,
    truncatedEntryCount: range.truncatedEntryCount,
    preservedPreCompactionCount: range.preservedPreCompactionCount,
    entries: range.entries.map((entry) => ({ ...entry })),
  }
}

function compactionOf(range: TrajectoryProjection): { firstKeptEntryId: string } | null {
  return range.compactionFirstKeptEntryId ? { firstKeptEntryId: range.compactionFirstKeptEntryId } : null
}

function assertCovers(entries: readonly SyntheticPublicEntry[], range: TrajectoryProjection): void {
  const ids = [...range.entries.map((entry) => entry.entryId), ...range.omittedEntryIds]
  const pending = entries.filter((entry) => entry.order > range.afterOrder)
  if (pending.length < ids.length || ids.some((id, index) => pending[index]?.entryId !== id)) refuse()
  for (const stored of range.entries) {
    const found = entries.find((entry) => entry.entryId === stored.entryId)
    if (
      !found ||
      found.order !== stored.order ||
      found.role !== stored.role ||
      found.timestamp !== stored.timestamp ||
      found.sessionId !== stored.sessionId ||
      found.branchId !== stored.branchId
    )
      refuse()
    const { text, truncated } = exposedEntry(found.text)
    if (text !== stored.text || truncated !== stored.truncated) refuse()
  }
  for (const id of range.omittedEntryIds) {
    const found = entries.find((entry) => entry.entryId === id)
    if (!found || found.order <= range.endOrder) refuse()
  }
}

export function snapshotConsumed(watermark: WatermarkRecord | undefined, job: LocalJobRecord): boolean {
  const snap = job.reflection
  if (!snap || !watermark) return false
  if (watermark.order > snap.endOrder) return true
  return (
    watermark.order === snap.endOrder &&
    watermark.entryId === snap.endEntryId &&
    watermark.rangeDigest === snap.digest &&
    watermark.jobId === job.id
  )
}

export async function settleReflection(stateRoot: string, job: LocalJobRecord): Promise<void> {
  if (job.kind !== 'reflection' || !job.reflection) return
  if (job.status !== 'integrated' && job.status !== 'noop') return
  const snap = job.reflection
  const current = await loadWatermark(stateRoot, snap.sessionId, snap.branchId)
  if (snapshotConsumed(current, job)) return
  if ((current?.order ?? 0) !== snap.afterOrder) refuse()
  await saveWatermark(stateRoot, {
    version: 1,
    sessionId: snap.sessionId,
    branchId: snap.branchId,
    entryId: snap.endEntryId,
    order: snap.endOrder,
    rangeDigest: snap.digest,
    jobId: job.id,
  })
}

function receipt(
  action: ReflectionReceipt['action'],
  reason: ReflectionReceipt['reason'],
  policy: TrajectoryPolicy,
  range: TrajectoryProjection | null,
  job: LocalJobRecord | null,
  progress: ReflectionReceipt['progress'],
): ReflectionReceipt {
  return { action, reason, policy, range, job, progress }
}

function branchJobs(jobs: readonly LocalJobRecord[], sessionId: string, branchId: string): LocalJobRecord[] {
  return jobs.filter(
    (job) =>
      job.kind === 'reflection' &&
      job.reflection?.sessionId === sessionId &&
      job.reflection.branchId === branchId,
  )
}

export async function performReflection(input: {
  stateRoot: string
  runtime: TrajectoryRuntime
  request: SyntheticTrajectoryRequest
  allocateId: () => Promise<string>
  listJobs: () => Promise<LocalJobRecord[]>
  enqueue: (job: { id: string; summary: string; reflection: TrajectoryProjection }) => Promise<LocalJobRecord>
}): Promise<ReflectionReceipt> {
  const request = input.request
  if (!request || typeof request !== 'object' || Array.isArray(request)) refuse()
  for (const key of Object.keys(request)) {
    if (!['branchId', 'compaction', 'entries', 'replay', 'sessionId'].includes(key)) refuse()
  }
  if (!('sessionId' in request) || !('branchId' in request) || !('entries' in request)) refuse()
  const entries = normalizeEntries(request.sessionId, request.branchId, request.entries)
  const compaction = normalizeCompaction(request.compaction, entries)
  const replay = normalizeReplay(request.replay)
  const jobs = await input.listJobs()
  if (!replay) {
    for (const job of branchJobs(jobs, request.sessionId, request.branchId))
      await settleReflection(input.stateRoot, job)
  }
  const watermark = await loadWatermark(input.stateRoot, request.sessionId, request.branchId)
  const orderNow = watermark?.order ?? 0
  const pending = entries.filter((entry) => entry.order > orderNow)
  const progress = (range: TrajectoryProjection | null): ReflectionReceipt['progress'] => ({
    observedEntryCount: entries.length,
    pendingAssistantStepCount: pending.filter((entry) => entry.role === 'assistant').length,
    settledOrder: orderNow,
    configuredThreshold: input.runtime.stepCount,
    capturedEntryCount: range ? range.entryCount + range.omittedEntryCount : 0,
  })
  const result = (
    action: ReflectionReceipt['action'],
    reason: ReflectionReceipt['reason'],
    range: TrajectoryProjection | null,
    job: LocalJobRecord | null,
  ) => receipt(action, reason, input.runtime.policy, range, job, progress(range))
  const resume = (job: LocalJobRecord): ReflectionReceipt => {
    const snap = job.reflection
    if (!snap || snap.sessionId !== request.sessionId || snap.branchId !== request.branchId) refuse()
    assertCovers(entries, snap)
    if (snapshotConsumed(watermark, job)) return result('idle', 'consumed', snap, job)
    if (orderNow !== snap.afterOrder) refuse()
    if ((compaction?.firstKeptEntryId ?? null) !== snap.compactionFirstKeptEntryId) refuse()
    // The persisted selected+omitted IDs bind the captured prefix. Later tail entries
    // must not change the digest or become part of this held attempt.
    return result('pending', 'in-flight', snap, job)
  }
  if (replay) {
    const job = jobs.find((item) => item.id === replay.jobId)
    if (!job?.reflection || job.reflection.digest !== replay.digest) refuse()
    const snap = job.reflection
    if (snap.sessionId !== request.sessionId || snap.branchId !== request.branchId) refuse()
    assertCovers(entries, snap)
    // Replay selects immutable evidence only. It never enqueues or settles work.
    return result(
      snapshotConsumed(watermark, job) ? 'idle' : 'pending',
      snapshotConsumed(watermark, job) ? 'consumed' : 'in-flight',
      snap,
      job,
    )
  }
  const branch = branchJobs(jobs, request.sessionId, request.branchId)
  // Recovery releases a range without consuming it. A fresh attempt still needs
  // the captured evidence; abandonment must not turn omission into permission to skip.
  for (const job of branch) {
    if ((job.status === 'repaired' || job.status === 'abandoned') && job.reflection?.afterOrder === orderNow)
      assertCovers(entries, job.reflection)
  }
  const holding = branch.filter(
    (job) =>
      job.status !== 'repaired' &&
      job.status !== 'abandoned' &&
      job.reflection?.afterOrder === orderNow &&
      (job.reflection?.endOrder ?? 0) > orderNow,
  )
  if (holding.length > 1) refuse()
  const current = holding[0]
  if (current) return resume(current)
  if (input.runtime.policy === 'off') return result('idle', 'policy-off', null, null)
  const pendingCount = pending.length
  if (pendingCount === 0) {
    const reviewed = branchJobs(jobs, request.sessionId, request.branchId).find(
      (job) =>
        job.reflection?.endOrder === orderNow &&
        (compaction?.firstKeptEntryId ?? null) === job.reflection?.compactionFirstKeptEntryId &&
        snapshotConsumed(watermark, job),
    )
    if (reviewed?.reflection) {
      try {
        assertCovers(entries, reviewed.reflection)
        return result('idle', 'consumed', reviewed.reflection, reviewed)
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'Local memory trajectory refused') throw error
      }
    }
    return result('idle', 'empty', null, null)
  }
  const settled = branchJobs(jobs, request.sessionId, request.branchId).find(
    (job) =>
      job.id === watermark?.jobId &&
      job.reflection?.digest === watermark.rangeDigest &&
      (job.status === 'integrated' || job.status === 'noop'),
  )
  let captured = entries
  let rangeCompaction = compaction
  const prior = settled?.reflection
  const continuing = Boolean(prior?.omittedEntryIds.length)
  if (continuing && prior) {
    assertCovers(entries, prior)
    const ids = prior.omittedEntryIds
    captured = pending.slice(0, ids.length)
    if (captured.length !== ids.length || ids.some((id, index) => captured[index]?.entryId !== id)) refuse()
    // Retain earlier rows only to resolve the captured compaction marker;
    // selection still starts strictly after the settled watermark.
    captured = entries.filter((entry) => entry.order <= orderNow || ids.includes(entry.entryId))
    rangeCompaction = compactionOf(prior)
  }
  if (
    !continuing &&
    input.runtime.policy === 'step-count' &&
    progress(null).pendingAssistantStepCount < (input.runtime.stepCount ?? 0)
  )
    return result('idle', 'below-threshold', null, null)
  if (!continuing && input.runtime.policy === 'compaction' && !compaction)
    return result('idle', 'awaiting-compaction', null, null)
  const projected = selectTrajectoryRange(captured, orderNow, rangeCompaction)
  if (!projected) return result('idle', 'empty', null, null)
  await assertBranchRoom(input.stateRoot, request.sessionId, request.branchId, jobs)
  const jobId = await input.allocateId()
  const summary = `Reflect ${request.branchId}`
  assertSummary(summary)
  const job = await input.enqueue({ id: jobId, summary, reflection: projected })
  if (job.kind !== 'reflection' || job.reflection?.digest !== projected.digest) refuse()
  return result('queued', 'queued', job.reflection, job)
}
