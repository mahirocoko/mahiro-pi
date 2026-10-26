import { isAbsolute, resolve } from 'node:path'
import { bytes, digest, objectShape, validId } from '../../continuity/records.ts'
import type { Change, Plan, Receipt, Stage } from './protocol.ts'
import { allowedPath, limits, parseLedger, revisionPattern, uuidPattern, type Ledger } from './schema.ts'

// One durable record contains both bounded snapshots (next/tree), a bounded delta,
// and the ledger twice (parsed plus exact text). Eight MiB covers the 1,024-file / 2,049-change maxima
// plus receipt/owner transitions without making recovery depend on the prepared record's exact byte edge.
export const operationLimit = 8 * 1024 * 1024
export const stages: Stage[] = [
  'prepared',
  'worktree_mutating',
  'index_staged',
  'commit_start_intent',
  'commit_started',
  'head_observed',
  'reconciled_committed',
  'not_committed_dirty',
  'unknown',
]
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const revision = (v: unknown): v is string => typeof v === 'string' && revisionPattern.test(v)
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  objectShape(v, keys) && Object.keys(v).length === keys.length
export interface LockOwner {
  version: 1
  operation: string
  digest: string
  nonce: string
  directory: string
}
export function parseLockOwner(value: unknown): LockOwner {
  if (
    !exact(value, ['version', 'operation', 'digest', 'nonce', 'directory']) ||
    value.version !== 1 ||
    typeof value.operation !== 'string' ||
    !uuidPattern.test(value.operation) ||
    !hash(value.digest) ||
    typeof value.nonce !== 'string' ||
    !uuidPattern.test(value.nonce) ||
    typeof value.directory !== 'string' ||
    !/^\d+:\d+$/.test(value.directory)
  )
    throw Error('Unknown lock ownership')
  return value as unknown as LockOwner
}
export function validatePlan(value: unknown): asserts value is Plan {
  if (
    !exact(value, ['id', 'digest', 'view', 'base', 'current', 'configHash', 'ledgerHash', 'changes']) ||
    typeof value.id !== 'string' ||
    !uuidPattern.test(value.id) ||
    typeof value.view !== 'string' ||
    !uuidPattern.test(value.view) ||
    !revision(value.base) ||
    !revision(value.current) ||
    !hash(value.configHash) ||
    !hash(value.ledgerHash) ||
    !hash(value.digest) ||
    !Array.isArray(value.changes) ||
    value.changes.length > limits.changes
  )
    throw Error('Invalid operation plan')
  const paths = new Set<string>()
  for (const c of value.changes) {
    if (
      !exact(c, ['path', 'hash', 'size']) ||
      typeof c.path !== 'string' ||
      !(c.path === '.memory.json' || allowedPath(c.path)) ||
      paths.has(c.path) ||
      !(c.hash === null || hash(c.hash)) ||
      !Number.isSafeInteger(c.size) ||
      (c.size as number) < 0 ||
      (c.size as number) > (c.path === '.memory.json' ? limits.ledger : limits.file) ||
      (c.hash === null && c.size !== 0)
    )
      throw Error('Invalid operation delta')
    paths.add(c.path)
  }
  const { digest: expected, ...metadata } = value
  if (digest(JSON.stringify(metadata)) !== expected) throw Error('Operation plan digest mismatch')
}
export function validateReceipt(value: unknown): asserts value is Receipt {
  if (
    !objectShape(value, ['stage', 'revision', 'detail', 'indexDirty', 'worktreeDirty', 'observedCommit']) ||
    !stages.includes(value.stage as Stage) ||
    (value.revision !== undefined && !revision(value.revision)) ||
    (value.observedCommit !== undefined && !revision(value.observedCommit)) ||
    (value.detail !== undefined && (typeof value.detail !== 'string' || bytes(value.detail) > 256)) ||
    (value.indexDirty !== undefined && typeof value.indexDirty !== 'boolean') ||
    (value.worktreeDirty !== undefined && typeof value.worktreeDirty !== 'boolean')
  )
    throw Error('Invalid operation receipt')
}
export interface ExpectedRef {
  hash: string
  size: number
  sources: string[]
}
export interface OperationRecord {
  version: 1
  immutable: {
    root: string
    rootIdentity: string
    plan: Plan
    next: Record<string, ExpectedRef>
    ledger: Ledger
    ledgerText: string
    proposalHash: string
    tree: string[]
  }
  immutableHash: string
  sequence: number
  owner: LockOwner | null
  receipt: Receipt
}
export function parseOperation(raw: string): OperationRecord {
  const size = bytes(raw)
  if (size > operationLimit) throw Error(`Operation record bound exceeded (${size} > ${operationLimit})`)
  const value = JSON.parse(raw)
  if (
    !exact(value, ['version', 'immutable', 'immutableHash', 'sequence', 'owner', 'receipt']) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    !exact(value.immutable, [
      'root',
      'rootIdentity',
      'plan',
      'next',
      'ledger',
      'ledgerText',
      'proposalHash',
      'tree',
    ]) ||
    !hash(value.immutableHash) ||
    digest(JSON.stringify(value.immutable)) !== value.immutableHash
  )
    throw Error('Invalid durable operation')
  const i = value.immutable
  if (
    typeof i.root !== 'string' ||
    !isAbsolute(i.root) ||
    resolve(i.root) !== i.root ||
    typeof i.rootIdentity !== 'string' ||
    !/^\d+:\d+$/.test(i.rootIdentity)
  )
    throw Error('Invalid operation root binding')
  validatePlan(i.plan)
  validateReceipt(value.receipt)
  if (value.owner !== null) {
    const owner = parseLockOwner(value.owner)
    if (owner.operation !== i.plan.id || owner.digest !== i.plan.digest)
      throw Error('Operation lock mismatch')
  }
  const ledger = parseLedger(JSON.stringify(i.ledger))
  if (
    typeof i.ledgerText !== 'string' ||
    JSON.stringify(parseLedger(i.ledgerText)) !== JSON.stringify(ledger) ||
    !hash(i.proposalHash) ||
    !i.next ||
    !objectShape(i.next, Object.keys(ledger.sources)) ||
    Object.keys(i.next).length > limits.files ||
    !i.next['Core.md'] ||
    !i.next['index.md'] ||
    !Array.isArray(i.tree) ||
    i.tree.length > limits.files + 16 ||
    new Set(i.tree).size !== i.tree.length ||
    i.tree.some(
      (s: unknown) =>
        typeof s !== 'string' || !/^100(?:644|755) blob [a-f0-9]{40,64}\t[^\x00-\x1f]+$/.test(s),
    )
  )
    throw Error('Invalid expected operation state')
  let total = 0
  for (const [path, ref] of Object.entries(i.next)) {
    if (
      !allowedPath(path) ||
      !exact(ref, ['hash', 'size', 'sources']) ||
      !hash(ref.hash) ||
      !Number.isSafeInteger(ref.size) ||
      (ref.size as number) < 0 ||
      (ref.size as number) > limits.file ||
      !Array.isArray(ref.sources) ||
      ref.sources.length > 32 ||
      ref.sources.some((s: unknown) => !validId(s)) ||
      new Set(ref.sources).size !== ref.sources.length ||
      JSON.stringify(ref.sources) !== JSON.stringify(ledger.sources[path])
    )
      throw Error('Invalid expected provenance')
    total += ref.size as number
  }
  if (total > limits.total || Object.keys(i.next).length !== Object.keys(ledger.sources).length)
    throw Error('Invalid expected layout')
  for (const c of i.plan.changes as Change[]) {
    const ref = (i.next as Record<string, ExpectedRef>)[c.path]
    if (c.path === '.memory.json') {
      if (c.hash !== digest(i.ledgerText) || c.size !== bytes(i.ledgerText))
        throw Error('Invalid ledger delta')
    } else if (c.hash === null ? ref !== undefined : !ref || ref.hash !== c.hash || ref.size !== c.size)
      throw Error('Invalid expected delta')
  }
  return value as unknown as OperationRecord
}
