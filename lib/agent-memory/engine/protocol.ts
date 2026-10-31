import { objectShape, validId } from '../../continuity/records.ts'
import { reflectionBacklogLimit } from '../reflection-schedule.ts'
import { migrationExportPageLimit, migrationExportSections } from '../migration-export.ts'
import type { MemoryFailureCode } from '../reasons.ts'
import type { Episode, MemoryConfig } from '../store.ts'
import type { LockOwner } from './operation.ts'
import { idPattern, revisionPattern, uuidPattern } from './schema.ts'

export const protocolVersion = 2
export const transportLimits = Object.freeze({
  queued: 16,
  queuedBytes: 8 * 1024 * 1024,
  request: 1024 * 1024,
  reply: 256 * 1024,
  chunk: 64 * 1024,
})
export interface Change {
  path: string
  hash: string | null
  size: number
}
export interface Plan {
  id: string
  digest: string
  view: string
  base: string
  current: string
  configHash: string
  ledgerHash: string
  changes: Change[]
}
export type Stage =
  | 'prepared'
  | 'worktree_mutating'
  | 'index_staged'
  | 'commit_start_intent'
  | 'commit_started'
  | 'head_observed'
  | 'reconciled_committed'
  | 'not_committed_dirty'
  | 'unknown'
export interface Receipt {
  stage: Stage
  revision?: string
  detail?: string
  indexDirty?: boolean
  worktreeDirty?: boolean
  observedCommit?: string
}
export interface Counters {
  blobReads: Record<string, number>
  overlayReads: Record<string, number>
  overlayWrites: Record<string, number>
  certifications: number
  gitCalls: number
}
export interface Page {
  revision: string
  baseRevision: string
  currentRevision: string
  basis: 'view-snapshot' | 'private-draft'
  freshness: 'current' | 'stale'
  path: string
  hash: string | null
  text?: string
  sources?: string[]
  offset: number
  totalCharacters: number
  truncated: boolean
  missing?: boolean
}
export type CapacityNamespaceName = 'journal' | 'legacyViews' | 'drafts' | 'episodes'
export type CapacityDoctorBlockerName = CapacityNamespaceName | 'retainedViews'
export type CapacityNamespaceState = 'available' | 'blocked' | 'unknown' | 'not-applicable'
export interface CapacityNamespace {
  entries: number
  matching: number
  exact: boolean
  status: CapacityNamespaceState
  doctor: CapacityNamespaceState
  admission: CapacityNamespaceState
}
export interface CapacityDiagnostic {
  version: 1
  kind: 'abi2-capacity-diagnostic'
  revision: string
  configHash: string
  scanLimit: number
  association: 'sequential-non-atomic'
  namespaces: {
    journal: CapacityNamespace
    legacyViews: CapacityNamespace
    drafts: CapacityNamespace
    episodes: CapacityNamespace
  }
  derived: {
    retainedViews: {
      matching: number
      exact: boolean
      doctor: CapacityNamespaceState
    }
  }
  blockers: {
    status: CapacityNamespaceName[]
    doctor: CapacityDoctorBlockerName[]
    admission: CapacityNamespaceName[]
  }
  classification: 'status-namespace-capacity' | 'non-namespace-status-capacity' | 'inconclusive'
  corpusReturned: false
}
export interface Operations {
  knowledgeHistory: {
    input: { project: string; expectedRevision: string; expectedConfigHash: string; offset: number }
    output: import('../knowledge-history.ts').KnowledgeHistory
  }
  palaceStructure: {
    input: { project: string; expectedConfigHash: string }
    output: import('../palace-structure.ts').PalaceStructure
  }
  projection: {
    input: { project: string; shared: boolean }
    output: {
      revision: string
      core: string
      index: string
      system?: Record<string, string>
      projectSystem?: Record<string, string>
      discovery: Record<string, unknown>
    }
  }
  config: { input: Record<string, never>; output: { config: MemoryConfig; configHash: string } }
  capacityDiagnostic: { input: Record<string, never>; output: CapacityDiagnostic }
  status: {
    input: Record<string, never>
    output: {
      revision: string
      files: string[]
      pendingOperations: { id: string; digest: string; stage: Stage; recordBytes: number }[]
    }
  }
  offlineCertify: { input: { revision: string }; output: { revision: string } }
  episodes: { input: { project: string }; output: Episode[] }
  selectEpisodes: { input: { project: string; ids: string[] }; output: Episode[] }
  episodeBacklog: { input: { project: string; limit: number }; output: { ids: string[] } }
  episodeCredit: { input: { project: string; session: string }; output: { steps: number } }
  observe: { input: { episode: Episode }; output: { recorded: true } }
  manage: {
    input: {
      action: 'forget' | 'rollback' | 'doctor' | 'palace' | 'init-project' | 'migrate-v2' | 'migration-export'
      project: string
      revision?: string
      paths?: string[]
      sources?: string[]
      target?: string
      section?: string
      offset?: number
      limit?: number
    }
    output:
      | { plan: Plan }
      | { view: string; added: string[]; changed: true }
      | { revision: string; added: string[]; changed: false }
      | { doctor: Record<string, unknown> }
      | { palace: Record<string, unknown> }
      | { migrationExport: Record<string, unknown> }
  }
  conflicts: {
    input: { project: string; target?: string; path?: string; offset?: number; limit?: number }
    output: Record<string, unknown>
  }
  discard: { input: { project: string; target: string; revision: string }; output: { discarded: string } }
  cancel: { input: { view: string }; output: { cancelled: true } }
  create: {
    input: { project: string; shared?: boolean; ttlMs?: number }
    output: { view: string; base: string }
  }
  read: { input: { view: string; selection: unknown }; output: Page | Record<string, unknown> }
  headRead: {
    input: { project: string; shared: boolean; selection: unknown }
    output: Page | Record<string, unknown>
  }
  edit: {
    input: {
      view: string
      path: string
      expectedHash: string | null
      text: string | null
      sources: string[]
      mode?: 'replace' | 'patch' | 'append'
      oldText?: string
      newText?: string
      section?: string
    }
    output: { hash: string | null }
  }
  ready: { input: { view: string }; output: { ready: true } }
  prepare: {
    input: { view: string; reviewed: string[]; allowShrink?: boolean }
    output: { plan: Plan } | { conflict: string[] }
  }
  chunk: {
    input: { plan: string; digest: string; path: string; offset: number }
    output: { data: string; total: number; hash: string }
  }
  fence: { input: { plan: string; digest: string }; output: { current: string; configHash: string } }
  journal: { input: { plan: string; digest: string; receipt: Receipt }; output: { recorded: true } }
  claim: { input: { plan: string; digest: string; owner: LockOwner }; output: { recorded: true } }
  reconcile: { input: { plan: string; digest: string }; output: Receipt }
  recover: {
    input: { plan: string; digest: string }
    output: { receipt: Receipt; owner: LockOwner | null; sequence: number; lockPresent: boolean }
  }
  stats: { input: Record<string, never>; output: Counters }
}
export type Method = keyof Operations
export type Input<M extends Method> = Operations[M]['input']
export type Output<M extends Method> = Operations[M]['output']
export interface Checkpoint {
  physical: string[]
  logical: string[]
  kind: 'data' | 'view' | 'git'
}
export interface Request {
  v: 2
  epoch: string
  id: string
  method: Method
  input: unknown
}
export interface CheckMessage {
  v: 2
  epoch: string
  id: string
  check: number
  targets: Checkpoint
}
export type Reply =
  | { v: 2; epoch: string; id: string; result: unknown }
  | { v: 2; epoch: string; id: string; error: Readonly<MemoryFailureCode> }
  | CheckMessage
export const methods: Method[] = [
  'knowledgeHistory',
  'palaceStructure',
  'projection',
  'config',
  'capacityDiagnostic',
  'status',
  'offlineCertify',
  'episodes',
  'selectEpisodes',
  'episodeBacklog',
  'episodeCredit',
  'observe',
  'manage',
  'conflicts',
  'discard',
  'cancel',
  'create',
  'read',
  'headRead',
  'edit',
  'ready',
  'prepare',
  'chunk',
  'fence',
  'journal',
  'claim',
  'reconcile',
  'recover',
  'stats',
]
// Reject extra selectors; no root/role/lease/argv endpoint exists on this channel.
export function validateInput(method: Method, input: unknown) {
  const keys: Record<Method, string[]> = {
    knowledgeHistory: ['project', 'expectedRevision', 'expectedConfigHash', 'offset'],
    palaceStructure: ['project', 'expectedConfigHash'],
    projection: ['project', 'shared'],
    config: [],
    capacityDiagnostic: [],
    status: [],
    offlineCertify: ['revision'],
    episodes: ['project'],
    selectEpisodes: ['project', 'ids'],
    episodeBacklog: ['project', 'limit'],
    episodeCredit: ['project', 'session'],
    observe: ['episode'],
    manage: ['action', 'project', 'revision', 'paths', 'sources', 'target', 'section', 'offset', 'limit'],
    conflicts: ['project', 'target', 'path', 'offset', 'limit'],
    discard: ['project', 'target', 'revision'],
    cancel: ['view'],
    create: ['project', 'shared', 'ttlMs'],
    read: ['view', 'selection'],
    headRead: ['project', 'shared', 'selection'],
    edit: ['view', 'path', 'expectedHash', 'text', 'sources', 'mode', 'oldText', 'newText', 'section'],
    ready: ['view'],
    prepare: ['view', 'reviewed', 'allowShrink'],
    chunk: ['plan', 'digest', 'path', 'offset'],
    fence: ['plan', 'digest'],
    journal: ['plan', 'digest', 'receipt'],
    claim: ['plan', 'digest', 'owner'],
    reconcile: ['plan', 'digest'],
    recover: ['plan', 'digest'],
    stats: [],
  }
  if (!objectShape(input, keys[method])) throw Error('Invalid engine input')
  if (
    method === 'knowledgeHistory' &&
    (Object.keys(input).length !== 4 ||
      typeof input.project !== 'string' ||
      !idPattern.test(input.project) ||
      typeof input.expectedRevision !== 'string' ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.expectedRevision) ||
      typeof input.expectedConfigHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.expectedConfigHash) ||
      !Number.isSafeInteger(input.offset) ||
      (input.offset as number) < 0 ||
      (input.offset as number) > 127)
  )
    throw Error('Invalid knowledge history input')
  if (
    method === 'palaceStructure' &&
    (Object.keys(input).length !== 2 ||
      typeof input.project !== 'string' ||
      !idPattern.test(input.project) ||
      typeof input.expectedConfigHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.expectedConfigHash))
  )
    throw Error('Invalid Palace structure input')
  if (
    ['projection', 'headRead'].includes(method) &&
    (typeof input.project !== 'string' || !idPattern.test(input.project) || typeof input.shared !== 'boolean')
  )
    throw Error('Invalid projection scope')
  if ('view' in input && (typeof input.view !== 'string' || !uuidPattern.test(input.view)))
    throw Error('Invalid view handle')
  if (['read', 'edit', 'ready', 'prepare', 'cancel'].includes(method) && !('view' in input))
    throw Error('View required')
  if (
    ['chunk', 'fence', 'journal', 'claim', 'reconcile', 'recover'].includes(method) &&
    (typeof input.plan !== 'string' ||
      !uuidPattern.test(input.plan) ||
      typeof input.digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.digest))
  )
    throw Error('Invalid plan handle')
  if (
    method === 'create' &&
    (typeof input.project !== 'string' ||
      !idPattern.test(input.project) ||
      (input.shared !== undefined && typeof input.shared !== 'boolean') ||
      (input.ttlMs !== undefined &&
        (!Number.isSafeInteger(input.ttlMs) ||
          (input.ttlMs as number) < 1000 ||
          (input.ttlMs as number) > 600000)))
  )
    throw Error('Invalid view scope')
  if (
    method === 'edit' &&
    (typeof input.path !== 'string' ||
      !(
        input.expectedHash === null ||
        (typeof input.expectedHash === 'string' && /^[a-f0-9]{64}$/.test(input.expectedHash))
      ) ||
      !(input.text === null || typeof input.text === 'string') ||
      !Array.isArray(input.sources) ||
      (input.mode !== undefined && !['replace', 'patch', 'append'].includes(input.mode as string)) ||
      (input.oldText !== undefined && typeof input.oldText !== 'string') ||
      (input.newText !== undefined && typeof input.newText !== 'string') ||
      (input.section !== undefined && typeof input.section !== 'string'))
  )
    throw Error('Invalid edit')
  if (method === 'episodes' && (typeof input.project !== 'string' || !idPattern.test(input.project)))
    throw Error('Invalid episode scope')
  if (method === 'selectEpisodes') {
    const ids = input.ids
    if (
      typeof input.project !== 'string' ||
      !idPattern.test(input.project) ||
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 4 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
    )
      throw Error('Invalid episode selection')
  }
  if (method === 'episodeBacklog') {
    if (
      typeof input.project !== 'string' ||
      !idPattern.test(input.project) ||
      !Number.isSafeInteger(input.limit) ||
      (input.limit as number) < 1 ||
      (input.limit as number) > reflectionBacklogLimit
    )
      throw Error('Invalid episode backlog')
  }
  if (
    method === 'episodeCredit' &&
    (typeof input.project !== 'string' || !idPattern.test(input.project) || !validId(input.session))
  )
    throw Error('Invalid episode credit')
  if (
    method === 'offlineCertify' &&
    (typeof input.revision !== 'string' || !revisionPattern.test(input.revision))
  )
    throw Error('Invalid offline certification revision')
  if (['manage', 'conflicts', 'discard'].includes(method)) {
    if (typeof input.project !== 'string' || !idPattern.test(input.project))
      throw Error('Invalid management scope')
    if (
      method !== 'conflicts' &&
      !(
        method === 'manage' &&
        ['doctor', 'palace', 'init-project', 'migrate-v2'].includes(input.action as string)
      ) &&
      (typeof input.revision !== 'string' || !/^[a-f0-9]{40,64}$/.test(input.revision))
    )
      throw Error('Expected current memory revision')
    if (
      method === 'manage' &&
      !['forget', 'rollback', 'doctor', 'palace', 'init-project', 'migrate-v2', 'migration-export'].includes(
        input.action as string,
      )
    )
      throw Error('Invalid management action')
    if (method === 'manage' && input.action === 'migration-export') {
      if (
        typeof input.section !== 'string' ||
        !(migrationExportSections as readonly string[]).includes(input.section) ||
        (input.offset !== undefined &&
          (!Number.isSafeInteger(input.offset) || (input.offset as number) < 0)) ||
        (input.limit !== undefined &&
          (!Number.isSafeInteger(input.limit) ||
            (input.limit as number) < 1 ||
            (input.limit as number) > migrationExportPageLimit)) ||
        input.paths !== undefined ||
        input.sources !== undefined ||
        input.target !== undefined
      )
        throw Error('Invalid memory migration export')
    } else if (
      method === 'manage' &&
      (input.section !== undefined || input.offset !== undefined || input.limit !== undefined)
    )
      throw Error('Invalid management action')
    if (
      input.target !== undefined &&
      (typeof input.target !== 'string' ||
        !(method === 'manage' ? /^[a-f0-9]{40,64}$/ : uuidPattern).test(input.target))
    )
      throw Error('Invalid management target')
    if (method === 'discard' && input.target === undefined) throw Error('Conflict target required')
  }
  if (
    method === 'prepare' &&
    (!Array.isArray(input.reviewed) ||
      (input.allowShrink !== undefined && typeof input.allowShrink !== 'boolean'))
  )
    throw Error('Invalid reviewed cursor')
  if (
    method === 'chunk' &&
    (typeof input.path !== 'string' || !Number.isSafeInteger(input.offset) || (input.offset as number) < 0)
  )
    throw Error('Invalid chunk')
}
// LF only: U+2028/U+2029 are content, not framing boundaries. Bound before parsing.
export class Frames {
  private pending = Buffer.alloc(0)
  private maximum: number
  private accept: (value: unknown) => void
  constructor(maximum: number, accept: (value: unknown) => void) {
    this.maximum = maximum
    this.accept = accept
  }
  push(chunk: Buffer) {
    let start = 0
    for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
      const frame = Buffer.concat([this.pending, chunk.subarray(start, end)])
      this.pending = Buffer.alloc(0)
      if (frame.length > this.maximum) throw Error('Engine frame bound exceeded')
      this.accept(JSON.parse(frame.toString('utf8')))
      start = end + 1
    }
    this.pending = Buffer.concat([this.pending, chunk.subarray(start)])
    if (this.pending.length > this.maximum) throw Error('Engine frame bound exceeded')
  }
}
export function encode(value: unknown, maximum: number) {
  const frame = Buffer.from(`${JSON.stringify(value)}\n`)
  if (frame.length - 1 > maximum) throw Error('Engine frame bound exceeded')
  return frame
}
