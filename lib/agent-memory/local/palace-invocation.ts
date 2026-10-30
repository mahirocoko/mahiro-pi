import { randomUUID } from 'node:crypto'
import { assertOid } from './contracts.ts'
import { type ForgettingGuard, type ForgettingRecord, forgettingGuard } from './forgetting.ts'
import {
  type LocalGitContext,
  type LocalGitTreeEntry,
  gitBlobPrefix,
  gitBlobSize,
  gitCommitParents,
  gitEntriesRecursive,
  gitKnowledgeMetadata,
} from './git.ts'
import { type PalaceContextSnapshot, parsePalaceContext } from './palace-context.ts'
import { assertPalacePath } from './palace-path.ts'
import { type LocalMemoryPrompt, compileLocalMemoryPrompt } from './projection.ts'

// A disconnected, committed-at-capture view, never an installed invocation collector.
export const palaceInvocationLimits = {
  captures: 16,
  commits: 128,
  page: 8,
  files: 16,
  fileBytes: 4096,
  diffBytes: 32 * 1024,
  envelopeBytes: 48 * 1024,
} as const

export interface PalaceInvocationView {
  version: 1
  kind: 'synthetic-local-invocation-view'
  captureId: string
  capturedAt: string
  head: string
  forgetting: { digest: string; policyRevision: number }
  context: {
    provenance: 'fixture' | 'caller-supplied' | 'unavailable'
    quality: 'estimated' | 'owner-supplied' | 'unavailable'
    snapshot: PalaceContextSnapshot | null
  }
  workingTree: 'unavailable'
  projection: {
    provenance: 'synthetic-local-projection'
    commit: string
    replyBytes: number
    files: Omit<LocalMemoryPrompt['files'][number], 'text'>[]
    absent: string[]
    deferred: LocalMemoryPrompt['deferred']
    blocked: LocalMemoryPrompt['blocked']
  }
}

function refused(): never {
  throw Error('Local memory invocation refused')
}

function keys(value: unknown, names: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refused()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== names.length || names.some((key) => !Object.hasOwn(record, key)))
    refused()
  return record
}

function count(value: unknown, max = 1_000_000): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0 || value > max) refused()
  return value
}

function path(value: unknown): string {
  if (typeof value !== 'string') refused()
  assertPalacePath(value)
  return value
}

function paths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) refused()
  return value.map(path)
}

export function parsePalaceInvocation(value: unknown): PalaceInvocationView {
  const v = keys(value, [
    'version',
    'kind',
    'captureId',
    'capturedAt',
    'head',
    'forgetting',
    'context',
    'workingTree',
    'projection',
  ])
  if (Buffer.byteLength(JSON.stringify(value)) > palaceInvocationLimits.envelopeBytes) refused()
  if (v.version !== 1 || v.kind !== 'synthetic-local-invocation-view' || v.workingTree !== 'unavailable')
    refused()
  if (typeof v.captureId !== 'string' || !/^[0-9a-f-]{36}$/.test(v.captureId)) refused()
  if (typeof v.capturedAt !== 'string' || new Date(v.capturedAt).toISOString() !== v.capturedAt) refused()
  if (typeof v.head !== 'string') refused()
  assertOid(v.head)
  const f = keys(v.forgetting, ['digest', 'policyRevision'])
  if (typeof f.digest !== 'string' || !/^[0-9a-f]{64}$/.test(f.digest)) refused()
  count(f.policyRevision)
  const c = keys(v.context, ['provenance', 'quality', 'snapshot'])
  if (!['fixture', 'caller-supplied', 'unavailable'].includes(String(c.provenance))) refused()
  if (!['estimated', 'owner-supplied', 'unavailable'].includes(String(c.quality))) refused()
  let normalizedContext: PalaceContextSnapshot | null = null
  if (c.snapshot === null) {
    if (c.provenance !== 'unavailable' || c.quality !== 'unavailable') refused()
  } else {
    normalizedContext = parsePalaceContext(c.snapshot)
    if (c.provenance === 'unavailable' || c.quality !== normalizedContext.usage.quality) refused()
    if ((c.provenance === 'fixture') !== (normalizedContext.capture === 'preview-fixture')) refused()
    if (new Date(normalizedContext.capturedAt).toISOString() !== v.capturedAt) refused()
  }
  const p = keys(v.projection, [
    'provenance',
    'commit',
    'replyBytes',
    'files',
    'absent',
    'deferred',
    'blocked',
  ])
  if (p.provenance !== 'synthetic-local-projection' || p.commit !== v.head) refused()
  count(p.replyBytes, 48 * 1024)
  if (!Array.isArray(p.files) || p.files.length > 5) refused()
  const seen = new Set<string>()
  for (const file of p.files) {
    const entry = keys(file, ['path', 'role', 'bytes', 'returnedBytes', 'truncated'])
    const name = path(entry.path)
    if (seen.has(name)) refused()
    seen.add(name)
    const expected =
      name === 'Core.md'
        ? 'core'
        : name === 'index.md'
          ? 'index'
          : name === 'system/persona.md'
            ? 'persona'
            : /^projects\/[a-z0-9][a-z0-9-]{0,63}\/system\/(overview|conventions)\.md$/.test(name)
              ? 'project'
              : null
    if (!expected || entry.role !== expected) refused()
    count(entry.bytes)
    count(entry.returnedBytes, 8192)
    if (
      Number(entry.returnedBytes) > Number(entry.bytes) ||
      entry.truncated !== (entry.returnedBytes !== entry.bytes)
    )
      refused()
  }
  paths(p.absent)
  for (const field of ['deferred', 'blocked']) {
    const list = keys(p[field], ['paths', 'total', 'truncated'])
    count(list.total)
    if (!Array.isArray(list.paths) || list.paths.length > 32 || list.paths.length > Number(list.total))
      refused()
    if (list.truncated !== list.paths.length < Number(list.total)) refused()
    if (field === 'deferred') paths(list.paths)
    else
      for (const item of list.paths) {
        const entry = keys(item, ['path', 'kind'])
        path(entry.path)
        if (!['symlink', 'submodule', 'special'].includes(String(entry.kind))) refused()
      }
  }
  // Copy prevents caller mutation of retained capture identity/receipt; retain normalized context fields.
  const parsed = JSON.parse(JSON.stringify(value)) as PalaceInvocationView
  parsed.context.snapshot = normalizedContext
  return parsed
}

export async function capturePalaceInvocation(
  git: LocalGitContext,
  head: string,
  policy: ForgettingRecord,
  input: { context?: PalaceContextSnapshot; project?: string } = {},
): Promise<PalaceInvocationView> {
  // No historical source attribution exists in this synthetic service.
  if (policy.snapshot?.sources.length) throw Error('Local memory knowledge unavailable: source exclusions')
  const context = input.context === undefined ? null : parsePalaceContext(input.context)
  const prompt = await compileLocalMemoryPrompt(git, head, input.project, forgettingGuard(policy))
  return parsePalaceInvocation({
    version: 1,
    kind: 'synthetic-local-invocation-view',
    captureId: randomUUID(),
    capturedAt: context ? new Date(context.capturedAt).toISOString() : new Date().toISOString(),
    head,
    forgetting: { digest: policy.digest, policyRevision: policy.policyRevision },
    context: {
      provenance: context
        ? context.capture === 'preview-fixture'
          ? 'fixture'
          : 'caller-supplied'
        : 'unavailable',
      quality: context?.usage.quality ?? 'unavailable',
      snapshot: context,
    },
    workingTree: 'unavailable',
    projection: {
      provenance: 'synthetic-local-projection',
      commit: prompt.commit,
      replyBytes: prompt.replyBytes,
      files: prompt.files.map(({ text: _text, ...receipt }) => receipt),
      absent: prompt.absent,
      deferred: prompt.deferred,
      blocked: prompt.blocked,
    },
  })
}

export interface PalaceKnowledgeDiff {
  version: 1
  captureId: string
  head: string
  commit: string
  parent: string | null
  files: { path: string; before: string; after: string; added: number; removed: number }[]
  bytes: number
  truncated: boolean
  omitted: number
}

export interface PalaceKnowledgeHistory {
  version: 1
  captureId: string
  head: string
  offset: number
  nextOffset: number | null
  truncated: boolean
  entries: {
    commit: string
    parent: string | null
    author: string | null
    date: string
    message: string | null
    metadataUnavailable: boolean
    stats: { files: number; added: number; removed: number; truncated: boolean; omitted: number }
  }[]
}

export async function knowledgeChain(
  git: LocalGitContext,
  head: string,
): Promise<{ commits: string[]; truncated: boolean }> {
  const commits: string[] = []
  let current: string | undefined = head
  while (current && commits.length < palaceInvocationLimits.commits) {
    commits.push(current)
    current = (await gitCommitParents(git, current))[0]
  }
  return { commits, truncated: current !== undefined }
}

async function safeSide(
  git: LocalGitContext,
  entry: LocalGitTreeEntry | undefined,
  guard: ForgettingGuard,
): Promise<string> {
  if (!entry) return ''
  if (entry.mode !== '100644' || entry.type !== 'blob' || guard.oidForbidden(entry.oid)) refused()
  if ((await gitBlobSize(git, entry.oid)) > palaceInvocationLimits.fileBytes) refused()
  const loaded = await gitBlobPrefix(git, entry.oid, palaceInvocationLimits.fileBytes)
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(loaded.bytes)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) refused()
  return text
}

// Full-side replacement diff, not Git patch rendering. No raw diff command, rename inference or worktree reads.
export async function readKnowledgeDiff(
  git: LocalGitContext,
  view: PalaceInvocationView,
  policy: ForgettingRecord,
  commit: string,
): Promise<PalaceKnowledgeDiff> {
  assertOid(commit)
  const chain = await knowledgeChain(git, view.head)
  if (!chain.commits.includes(commit)) refused()
  if (policy.snapshot?.sources.length) throw Error('Local memory knowledge unavailable: source exclusions')
  const parent = (await gitCommitParents(git, commit))[0] ?? null
  const before = new Map(
    (parent ? await gitEntriesRecursive(git, parent) : []).map((entry) => [entry.path, entry]),
  )
  const after = new Map((await gitEntriesRecursive(git, commit)).map((entry) => [entry.path, entry]))
  const guard = forgettingGuard(policy)
  // Treat an exact-content move from/to a forbidden path as blocked on both sides too.
  const excluded = new Set(
    [...before.values(), ...after.values()]
      .filter((entry) => guard.pathForbidden(entry.path) || guard.oidForbidden(entry.oid))
      .map((entry) => entry.oid),
  )
  const result: PalaceKnowledgeDiff = {
    version: 1,
    captureId: view.captureId,
    head: view.head,
    commit,
    parent,
    files: [],
    bytes: 0,
    truncated: false,
    omitted: 0,
  }
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(name)
    const next = after.get(name)
    if (old?.oid === next?.oid && old?.mode === next?.mode) continue
    try {
      assertPalacePath(name)
      if (
        !/\.(md|txt)$/.test(name) ||
        guard.pathForbidden(name) ||
        (old && excluded.has(old.oid)) ||
        (next && excluded.has(next.oid))
      )
        refused()
      if (result.files.length >= palaceInvocationLimits.files) refused()
      const left = await safeSide(git, old, guard)
      const right = await safeSide(git, next, guard)
      const bytes = Buffer.byteLength(left) + Buffer.byteLength(right) + Buffer.byteLength(name)
      if (result.bytes + bytes > palaceInvocationLimits.diffBytes) refused()
      const lines = (text: string) => (text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0)
      result.files.push({ path: name, before: left, after: right, added: lines(right), removed: lines(left) })
      result.bytes += bytes
    } catch {
      result.omitted += 1
      result.truncated = true
    }
  }
  return result
}

export async function readKnowledgeHistory(
  git: LocalGitContext,
  view: PalaceInvocationView,
  policy: ForgettingRecord,
  offset = 0,
): Promise<PalaceKnowledgeHistory> {
  if (!Number.isInteger(offset) || offset < 0 || offset >= palaceInvocationLimits.commits) refused()
  if (policy.snapshot?.sources.length) throw Error('Local memory knowledge unavailable: source exclusions')
  const chain = await knowledgeChain(git, view.head)
  const entries: PalaceKnowledgeHistory['entries'] = []
  const metadataUnavailable = Boolean(policy.snapshot?.paths.length || policy.snapshot?.blobs.length)
  for (const commit of chain.commits.slice(offset, offset + palaceInvocationLimits.page)) {
    const diff = await readKnowledgeDiff(git, view, policy, commit)
    const metadata = await gitKnowledgeMetadata(git, commit)
    entries.push({
      commit,
      parent: diff.parent,
      author: metadataUnavailable ? null : metadata.author,
      date: metadata.date,
      message: metadataUnavailable ? null : metadata.message,
      metadataUnavailable,
      stats: {
        files: diff.files.length,
        added: diff.files.reduce((sum, file) => sum + file.added, 0),
        removed: diff.files.reduce((sum, file) => sum + file.removed, 0),
        truncated: diff.truncated,
        omitted: diff.omitted,
      },
    })
  }
  const next = offset + entries.length
  return {
    version: 1,
    captureId: view.captureId,
    head: view.head,
    offset,
    nextOffset: next < chain.commits.length ? next : null,
    truncated: chain.truncated || next < chain.commits.length,
    entries,
  }
}
