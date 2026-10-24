import { bytes, digest, objectShape, validId } from '../../continuity/records.ts'
import { parseMemoryRead } from '../retrieval.ts'
import { observedEpisode } from './episodes.ts'
import { parseLockOwner, validatePlan, validateReceipt } from './operation.ts'
import { allowedPath, idPattern, limits, parseConfig, revisionPattern, uuidPattern } from './schema.ts'
import type { Method } from './protocol.ts'

const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const revision = (v: unknown) => typeof v === 'string' && revisionPattern.test(v)
const uuid = (v: unknown) => typeof v === 'string' && uuidPattern.test(v)
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max
function shape(value: unknown, keys: string[], required = keys): Record<string, unknown> {
  if (!objectShape(value, keys) || required.some((key) => !Object.hasOwn(value, key)))
    throw Error('Invalid engine reply shape')
  return value
}
function ensure(condition: unknown): asserts condition {
  if (!condition) throw Error('Invalid deeply validated engine reply')
}
const text = (v: unknown, max: number) => typeof v === 'string' && bytes(v) <= max
const paths = (v: unknown, max: number = limits.files) =>
  Array.isArray(v) &&
  v.length <= max &&
  new Set(v).size === v.length &&
  v.every((p) => typeof p === 'string' && allowedPath(p))
const sources = (v: unknown) =>
  Array.isArray(v) && v.length <= 32 && new Set(v).size === v.length && v.every(validId)
const topic = (v: unknown) =>
  typeof v === 'string' && /^(?:global|procedures|deferred\/[a-z0-9][a-z0-9-]{0,63})$/.test(v)
function topics(value: unknown, max: number) {
  ensure(Array.isArray(value) && value.length <= max)
  for (const entry of value) {
    const e = shape(entry, ['topic', 'files'])
    ensure(topic(e.topic) && integer(e.files, limits.files))
  }
}
function page(value: Record<string, unknown>, snippet = false) {
  ensure(
    typeof value.path === 'string' &&
      allowedPath(value.path) &&
      hash(value.hash) &&
      sources(value.sources) &&
      text(value.text, snippet ? 768 : 16384) &&
      integer(value.offset) &&
      integer(value.totalCharacters, limits.file) &&
      typeof value.truncated === 'boolean',
  )
  ensure([...(value.text as string)].length <= (snippet ? 192 : 4096))
}
// All child results cross this boundary BEFORE ownership registration or exposure.
export function validateReply(method: Method, inputValue: unknown, value: unknown) {
  const input = inputValue as Record<string, unknown> // controller already validated the exact request
  switch (method) {
    case 'config': {
      const v = shape(value, ['config', 'configHash'])
      const config = parseConfig(JSON.stringify(v.config))
      ensure(hash(v.configHash) && digest(JSON.stringify(config)) === v.configHash)
      return
    }
    case 'create': {
      const v = shape(value, ['view', 'base'])
      ensure(uuid(v.view) && revision(v.base))
      return
    }
    case 'ready':
      ensure(shape(value, ['ready']).ready === true)
      return
    case 'observe':
    case 'journal':
    case 'claim':
      ensure(shape(value, ['recorded']).recorded === true)
      return
    case 'cancel':
      ensure(shape(value, ['cancelled']).cancelled === true)
      return
    case 'discard':
      ensure(shape(value, ['discarded']).discarded === input.target)
      return
    case 'edit': {
      const v = shape(value, ['hash'])
      ensure(v.hash === (input.text === null ? null : digest(input.text as string)))
      return
    }
    case 'prepare':
    case 'manage': {
      if (objectShape(value, ['conflict']) && Object.hasOwn(value, 'conflict')) {
        ensure(method === 'prepare' && paths(value.conflict) && (value.conflict as unknown[]).length > 0)
        return
      }
      const v = shape(value, ['plan'])
      validatePlan(v.plan)
      ensure(method !== 'prepare' || v.plan.view === input.view)
      return
    }
    case 'fence': {
      const v = shape(value, ['current', 'configHash'])
      ensure(revision(v.current) && hash(v.configHash))
      return
    }
    case 'reconcile':
      validateReceipt(value)
      return
    case 'recover': {
      const v = shape(value, ['receipt', 'owner', 'sequence', 'lockPresent'])
      validateReceipt(v.receipt)
      ensure(integer(v.sequence) && (v.sequence as number) > 0 && typeof v.lockPresent === 'boolean')
      if (v.owner !== null) {
        const owner = parseLockOwner(v.owner)
        ensure(owner.operation === input.plan && owner.digest === input.digest)
      }
      return
    }
    case 'chunk': {
      const v = shape(value, ['data', 'total', 'hash'])
      ensure(text(v.data, 87384) && hash(v.hash) && integer(v.total, limits.file))
      const data = Buffer.from(v.data as string, 'base64')
      ensure(
        data.toString('base64') === v.data &&
          data.length <= 65536 &&
          (input.offset as number) + data.length <= (v.total as number),
      )
      return
    }
    case 'episodes':
      ensure(Array.isArray(value) && value.length <= 4)
      for (const e of value) observedEpisode(e)
      return
    case 'status': {
      const v = shape(value, ['revision', 'files'])
      ensure(revision(v.revision) && paths(v.files))
      return
    }
    case 'stats': {
      const v = shape(value, ['blobReads', 'overlayReads', 'overlayWrites', 'certifications', 'gitCalls'])
      ensure(integer(v.certifications) && integer(v.gitCalls))
      for (const key of ['blobReads', 'overlayReads', 'overlayWrites']) {
        const counters = v[key]
        ensure(objectShape(counters, Object.keys(counters && typeof counters === 'object' ? counters : {})))
        ensure(
          Object.keys(counters).length <= limits.files &&
            Object.entries(counters).every(([p, n]) => allowedPath(p) && integer(n)),
        )
      }
      return
    }
    case 'projection': {
      const v = shape(value, ['revision', 'core', 'index', 'discovery'])
      ensure(revision(v.revision) && text(v.core, 32768) && text(v.index, 8192))
      const d = shape(
        v.discovery,
        ['version', 'topics', 'totalTopics', 'nextOffset', 'routes'],
        ['version', 'topics', 'totalTopics', 'routes'],
      )
      ensure(d.version === 2 && integer(d.totalTopics, limits.files))
      topics(d.topics, 8)
      if (d.nextOffset !== undefined) ensure(d.nextOffset === 8 && (d.totalTopics as number) > 8)
      const r = shape(d.routes, ['namespaces', 'allFiles', 'lexical'])
      ensure(
        shape(r.namespaces, ['topic']).topic === '' &&
          shape(r.allFiles, ['topic']).topic === '*' &&
          r.lexical === 'agent_memory_read query',
      )
      return
    }
    case 'headRead':
    case 'read': {
      const selection = parseMemoryRead(input.selection)
      const envelope = ['revision', 'baseRevision', 'currentRevision', 'basis', 'freshness']
      const common = shape(
        value,
        [
          ...envelope,
          'files',
          'project',
          'state',
          'path',
          'hash',
          'missing',
          'text',
          'sources',
          'offset',
          'totalCharacters',
          'truncated',
          'nextOffset',
          'discoveryVersion',
          'topic',
          'entries',
          'total',
          'complete',
          'query',
          'results',
          'workBytes',
          'outcome',
        ],
        envelope,
      )
      ensure(
        revision(common.revision) &&
          common.revision === common.baseRevision &&
          revision(common.currentRevision) &&
          ['view-snapshot', 'private-draft'].includes(common.basis as string) &&
          common.freshness === (common.baseRevision === common.currentRevision ? 'current' : 'stale'),
      )
      if (method === 'headRead')
        ensure(common.basis === 'view-snapshot' && common.baseRevision === common.currentRevision)
      const selected = Object.fromEntries(Object.entries(common).filter(([key]) => !envelope.includes(key)))
      if (selection.mode === 'list') {
        const v = shape(selected, ['files', 'project', 'state'])
        ensure(
          paths(v.files) &&
            typeof v.project === 'string' &&
            idPattern.test(v.project) &&
            ['open', 'ready'].includes(v.state as string),
        )
        return
      }
      if (selection.mode === 'path') {
        ensure(selected.path === selection.path)
        if (selected.missing === true) {
          const v = shape(selected, ['path', 'hash', 'missing'])
          ensure(v.hash === null)
          return
        }
        const v = shape(
          selected,
          ['path', 'hash', 'text', 'sources', 'offset', 'totalCharacters', 'truncated', 'nextOffset'],
          ['path', 'hash', 'text', 'sources', 'offset', 'totalCharacters', 'truncated'],
        )
        page(v)
        ensure(v.offset === selection.offset && [...(v.text as string)].length <= selection.limit)
        if (v.nextOffset !== undefined)
          ensure(
            integer(v.nextOffset) &&
              (v.nextOffset as number) > selection.offset &&
              (v.nextOffset as number) < (v.totalCharacters as number),
          )
        return
      }
      if (selection.mode === 'topic') {
        const v = shape(
          selected,
          ['discoveryVersion', 'topic', 'entries', 'offset', 'total', 'complete', 'nextOffset'],
          ['discoveryVersion', 'topic', 'entries', 'offset', 'total', 'complete'],
        )
        ensure(
          v.discoveryVersion === 2 &&
            v.topic === selection.topic &&
            v.offset === selection.offset &&
            integer(v.total, limits.files) &&
            typeof v.complete === 'boolean' &&
            Array.isArray(v.entries) &&
            v.entries.length <= selection.limit,
        )
        if (selection.topic === '') topics(v.entries, 32)
        else for (const e of v.entries) ensure(paths([shape(e, ['path']).path], 1))
        if (v.nextOffset !== undefined) ensure(integer(v.nextOffset))
        return
      }
      const v = shape(
        selected,
        ['query', 'results', 'offset', 'complete', 'outcome', 'workBytes', 'nextOffset'],
        ['query', 'results', 'offset', 'complete', 'outcome', 'workBytes'],
      )
      ensure(
        v.query === selection.query &&
          v.offset === selection.offset &&
          typeof v.complete === 'boolean' &&
          ['matches', 'no-match', 'incomplete'].includes(v.outcome as string) &&
          integer(v.workBytes, 1048576) &&
          Array.isArray(v.results) &&
          v.results.length <= selection.limit &&
          bytes(JSON.stringify(v)) <= 32768,
      )
      for (const entry of v.results) {
        const e = shape(entry, [
          'path',
          'hash',
          'citation',
          'sources',
          'text',
          'offset',
          'totalCharacters',
          'truncated',
        ])
        page(e, true)
        ensure(e.citation === `${e.path}#sha256:${e.hash}`)
      }
      if (v.nextOffset !== undefined) ensure(integer(v.nextOffset))
      return
    }
    case 'conflicts': {
      if (input.target === undefined) {
        const v = shape(value, ['conflicts', 'total'])
        ensure(integer(v.total, 64) && Array.isArray(v.conflicts) && v.conflicts.length <= 8)
        for (const entry of v.conflicts) {
          const e = shape(entry, ['id', 'baseRevision', 'fileCount'])
          ensure(uuid(e.id) && revision(e.baseRevision) && integer(e.fileCount, limits.files))
        }
        return
      }
      if (input.path === undefined) {
        const v = shape(value, ['id', 'files'])
        ensure(v.id === input.target && paths(v.files))
        return
      }
      const v = shape(
        value,
        [
          'id',
          'path',
          'removed',
          'suppressedByForgetting',
          'text',
          'offset',
          'totalCharacters',
          'truncated',
          'sources',
          'proposalHash',
          'currentHash',
          'baseRevision',
        ],
        ['id', 'path'],
      )
      ensure(v.id === input.target && v.path === input.path)
      if (v.removed === true || v.suppressedByForgetting === true) {
        ensure(Object.keys(v).length === 3)
        return
      }
      ensure(
        text(v.text, 16384) &&
          integer(v.offset) &&
          integer(v.totalCharacters, limits.file) &&
          typeof v.truncated === 'boolean' &&
          sources(v.sources) &&
          hash(v.proposalHash) &&
          (v.currentHash === null || hash(v.currentHash)) &&
          revision(v.baseRevision),
      )
      return
    }
  }
}
