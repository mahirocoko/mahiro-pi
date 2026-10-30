import { randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { digest } from '../../continuity/records.ts'
import { readRegularFile, writeExclusive } from './confine.ts'

export const rehearsalFixture = 'r6-basic-v1' as const
export const rehearsalLimits = { maxBytes: 65536, maxEvents: 16 } as const
export type RehearsalState = 'previewed' | 'applying' | 'shadow-verified' | 'quarantining' | 'quarantined'
export type RehearsalAction = 'preview' | 'apply' | 'rollback'
export type RehearsalKind = RehearsalState | 'refused' | 'unknown'
export interface RehearsalPlan {
  targetHash: string
  parentDev: string
  parentIno: string
  dev: string
  ino: string
  fixtureDigest: string
}
export interface RehearsalQuarantineIdentity {
  suffix: string
  dev: string
  ino: string
  ownerDigest: string
  receiptDigest: string
}
export interface RehearsalEvent {
  action: RehearsalAction
  kind: RehearsalKind
  evidence: string | RehearsalQuarantineIdentity | null
  previous: string
  digest: string
}
export interface RehearsalRecord {
  version: 1
  fixture: typeof rehearsalFixture
  operation: string
  plan: RehearsalPlan
  expect: string
  events: RehearsalEvent[]
  checksum: string
}
const hash = /^[a-f0-9]{64}$/
const states: RehearsalState[] = ['previewed', 'applying', 'shadow-verified', 'quarantining', 'quarantined']
const actions: RehearsalAction[] = ['preview', 'apply', 'apply', 'rollback', 'rollback']

export function rehearsalState(record: RehearsalRecord): RehearsalState {
  return record.events.filter((event) => states.includes(event.kind as RehearsalState)).at(-1)!
    .kind as RehearsalState
}

export function newRehearsalRecord(plan: RehearsalPlan): RehearsalRecord {
  const operation = randomBytes(16).toString('hex')
  const expect = digest(JSON.stringify({ version: 1, fixture: rehearsalFixture, operation, plan }))
  return appendRehearsalEvent(
    { version: 1, fixture: rehearsalFixture, operation, plan, expect, events: [], checksum: '' },
    'preview',
    'previewed',
  )
}

export function appendRehearsalEvent(
  record: RehearsalRecord,
  action: RehearsalAction,
  kind: RehearsalKind,
  evidence: string | RehearsalQuarantineIdentity | null = null,
): RehearsalRecord {
  const previous = record.events.at(-1)?.digest ?? record.expect
  const event = { action, kind, evidence, previous }
  const body = {
    version: record.version,
    fixture: record.fixture,
    operation: record.operation,
    plan: record.plan,
    expect: record.expect,
    events: [...record.events, { ...event, digest: digest(JSON.stringify(event)) }],
  }
  const next = { ...body, checksum: digest(JSON.stringify(body)) }
  return parseRehearsalRecord(`${JSON.stringify(next)}\n`)
}

export function parseRehearsalRecord(text: string): RehearsalRecord {
  if (Buffer.byteLength(text) > rehearsalLimits.maxBytes) refused()
  const record = JSON.parse(text) as RehearsalRecord
  exactKeys(record, 'checksum,events,expect,fixture,operation,plan,version')
  if (
    record.version !== 1 ||
    record.fixture !== rehearsalFixture ||
    typeof record.operation !== 'string' ||
    !/^[a-f0-9]{32}$/.test(record.operation) ||
    !Array.isArray(record.events) ||
    record.events.length < 1 ||
    record.events.length > rehearsalLimits.maxEvents
  )
    refused()
  exactKeys(record.plan, 'dev,fixtureDigest,ino,parentDev,parentIno,targetHash')
  for (const key of ['dev', 'ino', 'parentDev', 'parentIno'] as const)
    if (typeof record.plan[key] !== 'string' || !/^\d{1,32}$/.test(record.plan[key])) refused()
  for (const value of [record.plan.targetHash, record.plan.fixtureDigest, record.expect, record.checksum])
    if (typeof value !== 'string' || !hash.test(value)) refused()
  const expected = digest(
    JSON.stringify({
      version: 1,
      fixture: rehearsalFixture,
      operation: record.operation,
      plan: record.plan,
    }),
  )
  if (record.expect !== expected) refused()
  let previous = record.expect
  let step = 0
  let shadowDigest: string | undefined
  for (const event of record.events) {
    exactKeys(event, 'action,digest,evidence,kind,previous')
    if (event.previous !== previous || typeof event.digest !== 'string' || !hash.test(event.digest)) refused()
    if (event.kind === 'refused' || event.kind === 'unknown') {
      if (step === 0 || !['apply', 'rollback'].includes(event.action) || event.evidence !== null) refused()
    } else {
      if (event.kind !== states[step] || event.action !== actions[step]) refused()
      if (event.kind === 'shadow-verified') {
        if (typeof event.evidence !== 'string' || !hash.test(event.evidence)) refused()
        shadowDigest = event.evidence
      } else if (event.kind === 'quarantined') {
        exactKeys(event.evidence, 'dev,ino,ownerDigest,receiptDigest,suffix')
        const identity = event.evidence as RehearsalQuarantineIdentity
        if (
          typeof identity.suffix !== 'string' ||
          !/^[a-f0-9]{12}$/.test(identity.suffix) ||
          typeof identity.dev !== 'string' ||
          !/^(0|[1-9]\d{0,31})$/.test(identity.dev) ||
          typeof identity.ino !== 'string' ||
          !/^[1-9]\d{0,31}$/.test(identity.ino) ||
          identity.dev !== record.plan.dev ||
          identity.ino !== record.plan.ino ||
          typeof identity.ownerDigest !== 'string' ||
          !hash.test(identity.ownerDigest) ||
          typeof identity.receiptDigest !== 'string' ||
          !hash.test(identity.receiptDigest) ||
          identity.receiptDigest !== shadowDigest
        )
          refused()
      } else if (event.evidence !== null) refused()
      step += 1
    }
    const body = {
      action: event.action,
      kind: event.kind,
      evidence: event.evidence,
      previous: event.previous,
    }
    if (event.digest !== digest(JSON.stringify(body))) refused()
    previous = event.digest
  }
  const { checksum, ...body } = record
  if (checksum !== digest(JSON.stringify(body))) refused()
  return record
}

export async function readRehearsalRecord(path: string): Promise<RehearsalRecord | undefined> {
  try {
    return parseRehearsalRecord((await readRegularFile(path)).text)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw Error('Rehearsal record refused')
  }
}

// Atomic record replacement and read-back give verified process-restart boundaries only.
// This does not fsync the service or promise whole-service power-loss atomicity.
export async function saveRehearsalRecord(path: string, record: RehearsalRecord): Promise<void> {
  const text = `${JSON.stringify(record)}\n`
  parseRehearsalRecord(text)
  await writeExclusive(path, text)
  if (!isDeepStrictEqual(await readRehearsalRecord(path), record)) refused()
}

function exactKeys(value: unknown, keys: string) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== keys
  )
    refused()
}
function refused(): never {
  throw Error('Rehearsal record refused')
}
