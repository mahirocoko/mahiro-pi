import { objectShape } from '../continuity/records.ts'

export interface KnowledgeHistory {
  version: 1
  project: string
  revision: string
  configHash: string
  ledgerDigest: string
  basis: 'committed-head-first-parent'
  currentness: 'config-head-ledger-matched-at-final-checks'
  offset: number
  pageSize: 8
  windowSize: 128
  nextOffset: number | null
  windowLimitReached: boolean
  metadata: 'commit-identity-time-only'
  entries: HistoryEntry[]
}
interface HistoryEntry {
  revision: string
  parent: string | null
  committedAt: string
}
export const historyOID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
function ensure(condition: unknown): asserts condition {
  if (!condition) throw Error('Knowledge history unavailable')
}
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  ensure(objectShape(value, keys) && Object.keys(value).length === keys.length)
}
export function historyOffset(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < 128
}
export function parseHistoryRows(raw: Buffer, revision: string): HistoryEntry[] {
  ensure(raw.length > 0 && raw.length <= 300 * 1024 && raw[raw.length - 1] === 10)
  ensure(raw.every((b) => b === 10 || b === 32 || (b >= 48 && b <= 57) || (b >= 97 && b <= 102)))
  const rows = raw.toString('ascii').slice(0, -1).split('\n')
  ensure(rows.length <= 128)
  const seen = new Set<string>()
  const entries = rows.map((row) => {
    const fields = row.split(' ')
    ensure(fields.length >= 2 && fields.length <= 34 && /^(?:0|[1-9][0-9]*)$/.test(fields[0]))
    const [timestamp, oid, ...parents] = fields
    ensure(historyOID.test(oid) && oid.length === revision.length && !seen.has(oid))
    ensure(parents.every((p) => historyOID.test(p) && p.length === oid.length && p !== oid))
    ensure(new Set(parents).size === parents.length)
    seen.add(oid)
    const seconds = Number(timestamp)
    ensure(Number.isSafeInteger(seconds) && Number.isSafeInteger(seconds * 1000))
    const date = new Date(seconds * 1000)
    ensure(Number.isFinite(date.getTime()))
    const committedAt = date.toISOString()
    ensure(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(committedAt))
    return { revision: oid, parent: parents[0] ?? null, committedAt }
  })
  ensure(entries[0].revision === revision)
  entries.forEach((entry, index) => {
    if (index + 1 < entries.length) ensure(entry.parent === entries[index + 1].revision)
  })
  ensure(entries.length === 128 || entries.at(-1)?.parent === null)
  return entries
}
export function assertKnowledgeHistory(
  value: unknown,
  input: { project: unknown; expectedRevision: unknown; expectedConfigHash: unknown; offset: unknown },
): asserts value is KnowledgeHistory {
  exact(value, [
    'version',
    'project',
    'revision',
    'configHash',
    'ledgerDigest',
    'basis',
    'currentness',
    'offset',
    'pageSize',
    'windowSize',
    'nextOffset',
    'windowLimitReached',
    'metadata',
    'entries',
  ])
  ensure(Buffer.byteLength(JSON.stringify(value)) <= 32768)
  ensure(value.version === 1 && value.project === input.project && value.revision === input.expectedRevision)
  ensure(typeof value.revision === 'string' && historyOID.test(value.revision))
  ensure(
    value.configHash === input.expectedConfigHash &&
      typeof value.configHash === 'string' &&
      /^[a-f0-9]{64}$/.test(value.configHash),
  )
  ensure(typeof value.ledgerDigest === 'string' && /^[a-f0-9]{64}$/.test(value.ledgerDigest))
  ensure(
    value.basis === 'committed-head-first-parent' &&
      value.currentness === 'config-head-ledger-matched-at-final-checks',
  )
  ensure(value.metadata === 'commit-identity-time-only' && value.pageSize === 8 && value.windowSize === 128)
  ensure(
    historyOffset(value.offset) &&
      value.offset === input.offset &&
      typeof value.windowLimitReached === 'boolean',
  )
  ensure(Array.isArray(value.entries) && value.entries.length <= Math.min(8, 128 - value.offset))
  const entries = value.entries
  const seen = new Set<string>()
  entries.forEach((entry, index) => {
    exact(entry, ['revision', 'parent', 'committedAt'])
    ensure(
      typeof entry.revision === 'string' &&
        historyOID.test(entry.revision) &&
        entry.revision.length === (value.revision as string).length &&
        !seen.has(entry.revision),
    )
    seen.add(entry.revision)
    ensure(
      entry.parent === null ||
        (typeof entry.parent === 'string' &&
          historyOID.test(entry.parent) &&
          entry.parent.length === entry.revision.length &&
          entry.parent !== entry.revision),
    )
    ensure(
      typeof entry.committedAt === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(entry.committedAt) &&
        new Date(entry.committedAt).toISOString() === entry.committedAt,
    )
    if (index + 1 < entries.length) ensure(entry.parent === entries[index + 1].revision)
  })
  if (value.offset === 0) ensure(entries.length > 0 && entries[0].revision === value.revision)
  const end = value.offset + entries.length
  const more = entries.length === 8 && end < 128 && entries.at(-1)?.parent !== null
  ensure(value.nextOffset === (more ? end : null))
  if (entries.length && end < 128 && !more) ensure(entries.at(-1)?.parent === null)
  if (value.windowLimitReached) {
    ensure(entries.length === Math.min(8, 128 - value.offset))
    if (entries.length && end < 128) ensure(entries.at(-1)?.parent !== null)
  }
  if (entries.length && end === 128) ensure(value.windowLimitReached)
}
