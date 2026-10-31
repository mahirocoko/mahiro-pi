import { bytes, digest, objectShape, validId } from '../../continuity/records.ts'
import { assertKnowledgeHistory } from '../knowledge-history.ts'
import { assertPalaceStructure } from '../palace-structure.ts'
import { assertMigrationExportPage } from '../migration-export.ts'
import {
  memoryMissingHint,
  palaceLayerFor,
  palaceReplyBytes,
  parseMemoryRead,
  retrievalLimits,
} from '../retrieval.ts'
import { observedEpisode } from './episodes.ts'
import { operationLimit, parseLockOwner, validatePlan, validateReceipt } from './operation.ts'
import {
  allowedPath,
  idPattern,
  isAlwaysLoadedTieredPath,
  isCriticalLinkSource,
  isProtectedRetentionPath,
  limits,
  parseConfig,
  revisionPattern,
  uuidPattern,
} from './schema.ts'
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
  typeof v === 'string' &&
  /^(?:global|procedures|system|system\/human|reference|deferred\/[a-z0-9][a-z0-9-]{0,63}|projects\/[a-z0-9][a-z0-9-]{0,63}\/(?:system|reference))$/.test(
    v,
  )
const documents = (value: unknown, prefix: string) => {
  ensure(objectShape(value, Object.keys(value && typeof value === 'object' ? value : {})))
  ensure(
    Object.entries(value as Record<string, unknown>).every(
      ([path, body]) => path.startsWith(prefix) && allowedPath(path) && text(body, limits.file),
    ),
  )
}
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
    case 'knowledgeHistory':
      assertKnowledgeHistory(value, {
        project: input.project,
        expectedRevision: input.expectedRevision,
        expectedConfigHash: input.expectedConfigHash,
        offset: input.offset,
      })
      return
    case 'palaceStructure':
      assertPalaceStructure(value, { project: input.project, expectedConfigHash: input.expectedConfigHash })
      return
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
      // Surgical edits hash the resulting document, not the patch/append operand.
      // The parent has no complete prior body; validate its digest shape here.
      // Replacement/deletion can still be bound exactly to the request text.
      if (input.mode === 'append' || input.mode === 'patch') ensure(hash(v.hash))
      else ensure(v.hash === (input.text === null ? null : digest(input.text as string)))
      return
    }
    case 'prepare':
    case 'manage': {
      if (method === 'manage' && input.action === 'doctor') {
        const outer = shape(value, ['doctor'])
        const doctor = shape(outer.doctor, [
          'revision',
          'project',
          'healthy',
          'fileCount',
          'fileCeiling',
          'totalBytesUsed',
          'totalBytesCeiling',
          'alwaysLoadedBytes',
          'episodes',
          'views',
          'conflicts',
          'missingDescriptions',
          'unmigratedV1Paths',
        ])
        ensure(
          revision(doctor.revision) &&
            doctor.project === input.project &&
            typeof doctor.healthy === 'boolean' &&
            integer(doctor.fileCount, limits.files) &&
            doctor.fileCeiling === limits.files &&
            integer(doctor.totalBytesUsed, limits.total) &&
            integer(doctor.totalBytesCeiling, limits.total) &&
            integer(doctor.alwaysLoadedBytes, limits.total) &&
            integer(doctor.episodes) &&
            integer(doctor.views, limits.views) &&
            integer(doctor.conflicts, limits.views) &&
            paths(doctor.missingDescriptions) &&
            paths(doctor.unmigratedV1Paths) &&
            (doctor.unmigratedV1Paths as string[]).every(
              (path) => path.startsWith('global/') || path.startsWith('deferred/'),
            ),
        )
        return
      }
      if (method === 'manage' && input.action === 'palace') {
        ensure(bytes(JSON.stringify(value)) <= palaceReplyBytes)
        const outer = shape(value, ['palace'])
        const palace = shape(outer.palace, [
          'revision',
          'project',
          'healthy',
          'coverage',
          'budget',
          'layers',
          'files',
          'brokenLinks',
          'views',
          'episodes',
          'tombstones',
          'pendingOperations',
        ])
        ensure(
          revision(palace.revision) &&
            palace.project === input.project &&
            typeof palace.healthy === 'boolean',
        )
        const coverage = shape(palace.coverage, [
          'complete',
          'inspectedFiles',
          'nonArchiveFiles',
          'totalFiles',
          'filesReturned',
          'filesTruncated',
          'layersTruncated',
          'brokenLinksTotal',
          'criticalBrokenLinksTotal',
          'advisoryBrokenLinksTotal',
          'brokenLinksTruncated',
        ])
        const budget = shape(palace.budget, [
          'coreBytes',
          'indexBytes',
          'fileBytes',
          'totalBytesUsed',
          'totalBytesCeiling',
          'alwaysLoadedBytes',
          'fileCount',
          'fileCeiling',
        ])
        ensure(
          integer(budget.coreBytes, limits.file) &&
            integer(budget.indexBytes, limits.file) &&
            integer(budget.fileBytes, limits.file) &&
            integer(budget.totalBytesUsed, limits.total) &&
            integer(budget.totalBytesCeiling, limits.total) &&
            integer(budget.alwaysLoadedBytes, limits.total) &&
            integer(budget.fileCount, limits.files) &&
            budget.fileCeiling === limits.files,
        )
        const layerKeys = [
          'core',
          'index',
          'system',
          'reference',
          'projectSystem',
          'projectReference',
          'archives',
          'legacy',
        ]
        const layers = shape(palace.layers, layerKeys)
        for (const key of layerKeys) ensure(paths(layers[key]))
        ensure(Array.isArray(palace.files) && palace.files.length <= limits.files)
        for (const entry of palace.files) {
          const f = shape(
            entry,
            [
              'path',
              'layer',
              'bytes',
              'protectedRetention',
              'alwaysLoaded',
              'sourcesCount',
              'name',
              'description',
              'links',
            ],
            ['path', 'layer', 'bytes', 'protectedRetention', 'alwaysLoaded', 'sourcesCount'],
          )
          ensure(
            paths([f.path], 1) &&
              f.layer === palaceLayerFor(f.path as string) &&
              integer(f.bytes, limits.file) &&
              f.protectedRetention === isProtectedRetentionPath(f.path as string) &&
              f.alwaysLoaded ===
                (f.path === 'Core.md' ||
                  f.path === 'index.md' ||
                  isAlwaysLoadedTieredPath(f.path as string, input.project as string)) &&
              integer(f.sourcesCount, 32),
          )
          if (f.name !== undefined) ensure(text(f.name, 512))
          if (f.description !== undefined) ensure(text(f.description, 2048))
          if (f.links !== undefined)
            ensure(Array.isArray(f.links) && f.links.length <= 16 && f.links.every((l) => text(l, 512)))
        }
        const returnedPaths = palace.files.map((entry) => entry.path as string)
        ensure(new Set(returnedPaths).size === returnedPaths.length)
        for (const key of layerKeys) {
          const expected = palace.files.filter((entry) => entry.layer === key).map((entry) => entry.path)
          ensure(JSON.stringify(layers[key]) === JSON.stringify(expected))
        }
        ensure(Array.isArray(palace.brokenLinks) && palace.brokenLinks.length <= 64)
        for (const entry of palace.brokenLinks) {
          const b = shape(entry, ['source', 'target'])
          ensure(paths([b.source], 1) && text(b.target, 512))
        }
        ensure(
          typeof coverage.complete === 'boolean' &&
            integer(coverage.inspectedFiles, limits.files) &&
            integer(coverage.nonArchiveFiles, limits.files) &&
            integer(coverage.totalFiles, limits.files) &&
            integer(coverage.filesReturned, limits.files) &&
            typeof coverage.filesTruncated === 'boolean' &&
            integer(coverage.brokenLinksTotal) &&
            integer(coverage.criticalBrokenLinksTotal) &&
            integer(coverage.advisoryBrokenLinksTotal) &&
            coverage.brokenLinksTotal ===
              (coverage.criticalBrokenLinksTotal as number) + (coverage.advisoryBrokenLinksTotal as number) &&
            palace.brokenLinks.filter((entry) =>
              isCriticalLinkSource(entry.source as string, input.project as string),
            ).length <= (coverage.criticalBrokenLinksTotal as number) &&
            palace.brokenLinks.filter(
              (entry) => !isCriticalLinkSource(entry.source as string, input.project as string),
            ).length <= (coverage.advisoryBrokenLinksTotal as number) &&
            typeof coverage.brokenLinksTruncated === 'boolean' &&
            (coverage.inspectedFiles as number) <= (coverage.nonArchiveFiles as number) &&
            (coverage.nonArchiveFiles as number) <= (coverage.totalFiles as number) &&
            coverage.totalFiles === budget.fileCount &&
            coverage.filesReturned === palace.files.length &&
            coverage.filesTruncated ===
              (coverage.filesReturned as number) < (coverage.totalFiles as number) &&
            coverage.complete === (coverage.inspectedFiles === coverage.nonArchiveFiles) &&
            coverage.layersTruncated === coverage.filesTruncated &&
            palace.brokenLinks.length <= (coverage.brokenLinksTotal as number) &&
            coverage.brokenLinksTruncated ===
              palace.brokenLinks.length < (coverage.brokenLinksTotal as number) &&
            palace.healthy ===
              (coverage.complete &&
                coverage.criticalBrokenLinksTotal === 0 &&
                (budget.totalBytesUsed as number) <= (budget.totalBytesCeiling as number)),
        )
        const views = shape(palace.views, ['total', 'open', 'conflict', 'committed', 'cancelled'])
        ensure(
          integer(views.total, limits.views) &&
            integer(views.open, limits.views) &&
            integer(views.conflict, limits.views) &&
            integer(views.committed, limits.views) &&
            integer(views.cancelled, limits.views) &&
            (views.open as number) +
              (views.conflict as number) +
              (views.committed as number) +
              (views.cancelled as number) ===
              views.total,
        )
        const episodes = shape(palace.episodes, ['total', 'reviewed'])
        ensure(integer(episodes.total) && integer(episodes.reviewed))
        const tombstones = shape(palace.tombstones, ['forgottenPaths', 'forgottenSources'])
        ensure(integer(tombstones.forgottenPaths) && integer(tombstones.forgottenSources))
        ensure(Array.isArray(palace.pendingOperations) && palace.pendingOperations.length <= limits.views)
        for (const entry of palace.pendingOperations) {
          const operation = shape(entry, ['id', 'digest', 'stage', 'recordBytes'])
          ensure(
            uuid(operation.id) &&
              hash(operation.digest) &&
              [
                'prepared',
                'worktree_mutating',
                'index_staged',
                'commit_start_intent',
                'commit_started',
                'head_observed',
                'unknown',
              ].includes(operation.stage as string) &&
              integer(operation.recordBytes, operationLimit),
          )
        }
        return
      }
      if (method === 'manage' && input.action === 'migration-export') {
        const outer = shape(value, ['migrationExport'])
        try {
          const page = assertMigrationExportPage(outer.migrationExport)
          ensure(page.revision === input.revision && page.section === input.section)
          if (input.offset !== undefined) ensure(page.offset === input.offset)
          if (input.limit !== undefined) ensure(page.limit === input.limit)
          else ensure(page.limit === 32)
        } catch (error) {
          if (error instanceof Error && error.message === 'Invalid deeply validated engine reply') throw error
          throw Error('Invalid deeply validated engine reply')
        }
        return
      }
      if (objectShape(value, ['conflict']) && Object.hasOwn(value, 'conflict')) {
        ensure(method === 'prepare' && paths(value.conflict) && (value.conflict as unknown[]).length > 0)
        return
      }
      if (method === 'manage' && ['init-project', 'migrate-v2'].includes(input.action as string)) {
        if (objectShape(value, ['revision', 'added', 'changed']) && !Object.hasOwn(value, 'view')) {
          const v = shape(value, ['revision', 'added', 'changed'])
          ensure(revision(v.revision) && paths(v.added) && v.changed === false)
          return
        }
        const v = shape(value, ['view', 'added', 'changed'])
        ensure(uuid(v.view) && paths(v.added) && v.changed === true)
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
      for (const e of value) ensure(observedEpisode(e).project === input.project)
      return
    case 'capacityDiagnostic': {
      const v = shape(value, [
        'version',
        'kind',
        'revision',
        'configHash',
        'scanLimit',
        'association',
        'namespaces',
        'derived',
        'blockers',
        'classification',
        'corpusReturned',
      ])
      ensure(
        v.version === 1 &&
          v.kind === 'abi2-capacity-diagnostic' &&
          revision(v.revision) &&
          hash(v.configHash) &&
          v.scanLimit === 8192 &&
          v.association === 'sequential-non-atomic' &&
          v.corpusReturned === false,
      )
      const namespaceNames = ['journal', 'legacyViews', 'drafts', 'episodes']
      const namespaces = shape(v.namespaces, namespaceNames)
      const namespaceRows: Record<string, Record<string, unknown>> = {}
      const states = ['available', 'blocked', 'unknown', 'not-applicable']
      const boundedState = (blocked: boolean, exact: boolean) =>
        blocked ? 'blocked' : exact ? 'available' : 'unknown'
      for (const name of namespaceNames) {
        const entry = shape(namespaces[name], [
          'entries',
          'matching',
          'exact',
          'status',
          'doctor',
          'admission',
        ])
        ensure(
          integer(entry.entries, 8193) &&
            integer(entry.matching, 8193) &&
            (entry.matching as number) <= (entry.entries as number) &&
            typeof entry.exact === 'boolean' &&
            entry.exact === (entry.entries as number) <= 8192 &&
            states.includes(entry.status as string) &&
            states.includes(entry.doctor as string) &&
            states.includes(entry.admission as string),
        )
        const entries = entry.entries as number
        const matching = entry.matching as number
        const exact = entry.exact as boolean
        const expected =
          name === 'journal'
            ? {
                status: boundedState(matching > limits.views, exact),
                doctor: 'not-applicable',
                admission: boundedState(entries >= limits.views, exact),
              }
            : name === 'legacyViews'
              ? {
                  status: 'not-applicable',
                  doctor: boundedState(matching > limits.views, exact),
                  admission: 'not-applicable',
                }
              : name === 'drafts'
                ? {
                    status: 'not-applicable',
                    doctor: boundedState(matching > limits.views, exact),
                    admission: boundedState(entries >= limits.views, exact),
                  }
                : {
                    status: 'not-applicable',
                    doctor: boundedState(matching > 256, exact),
                    admission:
                      matching > 256 ? 'blocked' : matching === 256 || !exact ? 'unknown' : 'available',
                  }
        ensure(
          entry.status === expected.status &&
            entry.doctor === expected.doctor &&
            entry.admission === expected.admission,
        )
        namespaceRows[name] = entry
      }
      const derived = shape(v.derived, ['retainedViews'])
      const retainedViews = shape(derived.retainedViews, ['matching', 'exact', 'doctor'])
      const expectedRetainedMatching =
        (namespaceRows.legacyViews.matching as number) + (namespaceRows.drafts.matching as number)
      const expectedRetainedExact =
        namespaceRows.legacyViews.exact === true && namespaceRows.drafts.exact === true
      const expectedRetainedDoctor =
        expectedRetainedMatching > limits.views ? 'blocked' : expectedRetainedExact ? 'available' : 'unknown'
      ensure(
        integer(retainedViews.matching, 16386) &&
          retainedViews.matching === expectedRetainedMatching &&
          retainedViews.exact === expectedRetainedExact &&
          retainedViews.doctor === expectedRetainedDoctor,
      )
      const blockers = shape(v.blockers, ['status', 'doctor', 'admission'])
      for (const key of ['status', 'admission']) {
        const list = blockers[key]
        ensure(
          Array.isArray(list) &&
            list.length <= namespaceNames.length &&
            new Set(list).size === list.length &&
            list.every(
              (name) => namespaceNames.includes(name) && namespaceRows[String(name)][key] === 'blocked',
            ),
        )
        ensure(
          namespaceNames.filter((name) => namespaceRows[name][key] === 'blocked').join('\n') ===
            list.join('\n'),
        )
      }
      const doctor = blockers.doctor
      const expectedDoctor = [
        ...namespaceNames.filter((name) => namespaceRows[name].doctor === 'blocked'),
        ...(retainedViews.doctor === 'blocked' ? ['retainedViews'] : []),
      ]
      ensure(
        Array.isArray(doctor) &&
          doctor.length === expectedDoctor.length &&
          new Set(doctor).size === doctor.length &&
          doctor.every((name, index) => typeof name === 'string' && name === expectedDoctor[index]),
      )
      const statusBlocked = (blockers.status as unknown[]).length > 0
      const statusUnknown = namespaceNames.some((name) => namespaceRows[name].status === 'unknown')
      ensure(
        v.classification ===
          (statusBlocked
            ? 'status-namespace-capacity'
            : statusUnknown
              ? 'inconclusive'
              : 'non-namespace-status-capacity'),
      )
      return
    }
    case 'status': {
      const v = shape(value, ['revision', 'files', 'pendingOperations'])
      ensure(revision(v.revision) && paths(v.files) && Array.isArray(v.pendingOperations))
      ensure(v.pendingOperations.length <= limits.views)
      for (const entry of v.pendingOperations) {
        const operation = shape(entry, ['id', 'digest', 'stage', 'recordBytes'])
        ensure(
          uuid(operation.id) &&
            hash(operation.digest) &&
            [
              'prepared',
              'worktree_mutating',
              'index_staged',
              'commit_start_intent',
              'commit_started',
              'head_observed',
              'unknown',
            ].includes(operation.stage as string) &&
            integer(operation.recordBytes, operationLimit),
        )
      }
      return
    }
    case 'offlineCertify': {
      const v = shape(value, ['revision'])
      ensure(revision(v.revision) && v.revision === input.revision)
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
      const v = shape(
        value,
        ['revision', 'core', 'index', 'system', 'projectSystem', 'discovery'],
        ['revision', 'core', 'index', 'discovery'],
      )
      ensure(revision(v.revision) && text(v.core, 32768) && text(v.index, 8192))
      if (v.system !== undefined) documents(v.system, 'system/')
      if (v.projectSystem !== undefined) documents(v.projectSystem, `projects/${input.project}/system/`)
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
          'directory',
          'hash',
          'missing',
          'suggestions',
          'hint',
          'text',
          'sources',
          'offset',
          'limit',
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
        if (selected.directory !== undefined) {
          const v = shape(
            selected,
            ['directory', 'entries', 'total', 'hash', 'offset', 'limit', 'truncated', 'nextOffset'],
            ['directory', 'entries', 'total', 'hash', 'offset', 'limit', 'truncated'],
          )
          const effectiveLimit = Math.min(selection.limit, retrievalLimits.page)
          ensure(
            v.directory === selection.path.replace(/\/+$/, '') &&
              v.hash === null &&
              Array.isArray(v.entries) &&
              integer(v.total, limits.files) &&
              v.offset === selection.offset &&
              v.limit === effectiveLimit &&
              v.entries.length ===
                Math.min(effectiveLimit, Math.max(0, (v.total as number) - selection.offset)) &&
              typeof v.truncated === 'boolean' &&
              v.truncated ===
                (selection.offset > 0 || selection.offset + v.entries.length < (v.total as number)),
          )
          const more = selection.offset + v.entries.length < (v.total as number)
          if (!more) ensure(v.nextOffset === undefined)
          else
            ensure(
              integer(v.nextOffset, limits.files) &&
                v.nextOffset === selection.offset + v.entries.length &&
                (v.nextOffset as number) > selection.offset &&
                (v.nextOffset as number) < (v.total as number),
            )
          const entryPaths: string[] = []
          for (const entry of v.entries) {
            const e = shape(entry, ['path', 'name', 'description', 'links'], ['path'])
            ensure(paths([e.path], 1) && (e.path as string).startsWith(`${v.directory}/`))
            entryPaths.push(e.path as string)
            if (e.name !== undefined) ensure(text(e.name, 512))
            if (e.description !== undefined) ensure(text(e.description, 4096))
            if (e.links !== undefined)
              ensure(Array.isArray(e.links) && e.links.every((link) => text(link, 512)))
          }
          ensure(entryPaths.every((path, index) => index === 0 || entryPaths[index - 1] < path))
          return
        }
        ensure(selected.path === selection.path)
        if (selected.missing === true) {
          const hinted = selected.suggestions !== undefined || selected.hint !== undefined
          const v = shape(
            selected,
            hinted ? ['path', 'hash', 'missing', 'suggestions', 'hint'] : ['path', 'hash', 'missing'],
          )
          ensure(v.hash === null && v.missing === true)
          if (hinted) {
            ensure(Array.isArray(v.suggestions) && paths(v.suggestions, 5))
            const suggestions = v.suggestions as string[]
            ensure(
              suggestions.length >= 1 &&
                suggestions.every((candidate) => candidate !== v.path) &&
                text(v.hint, 4096) &&
                v.hint === memoryMissingHint(String(v.path), suggestions),
            )
          }
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
