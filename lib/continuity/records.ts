import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'

export interface IRecord {
  id: string
  sourceKind: 'letta_memory' | 'letta_message' | 'pi_message'
  agentId?: string
  conversationId?: string
  messageId?: string
  date?: string
  path?: string
  hash: string
  projectId: string | null
  authority: 'historical-user' | 'historical-assistant' | 'imported-memory'
  evidence: 'imported-untrusted'
  text: string
}
export interface IImport {
  id: string
  sourceKind: IRecord['sourceKind']
  projectId: string | null
  agentId?: string
  conversationId?: string
  messageId?: string
  date?: string
  path?: string
  markdown?: string
  message?: unknown
}
export interface IPolicy {
  excludedProjectIds: readonly string[]
  excludedPaths: readonly string[]
}
export interface IQuarantine {
  id: string
  reason: string
}
export interface IArchive {
  records: IRecord[]
  quarantine: IQuarantine[]
}
export const validId = (id: unknown): id is string =>
  typeof id === 'string' &&
  /^[\p{L}\p{N}_.:-]{1,160}$/u.test(id) &&
  !['__proto__', 'constructor', 'prototype'].includes(id) &&
  !hasSecret(id)
export const bytes = (text: string) => Buffer.byteLength(text, 'utf8')
export const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const secret =
  /-----BEGIN [^-]*(?:PRIVATE KEY|OPENSSH)[^-]*-----|\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})|\bBearer\s+\S+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:api[_-]?key|access[_-]?token|password|secret|credential)\s*[:=]\s*\S+/i
export const hasSecret = (text: string) => secret.test(text)
const wrapperNames =
  'system-reminder|task-notification|tool-result|tool_response|user_timestamp|terminal_file_link_contract|skill_content|system_alert'
const wrapper = new RegExp(`<(${wrapperNames})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi')
const residualWrapper = new RegExp(`<\\/?(?:${wrapperNames})(?:\\b|$)`, 'i')
// Detect uncertain tag-shaped content; do not interpret or strip ordinary prose HTML.
const unknownWrapper = (text: string) =>
  [...text.matchAll(/<\/?([a-z][a-z0-9_-]*)\b[^>]*(?:>|$)/gi)].some(
    ([tag, name]) =>
      !tag.endsWith('>') ||
      ![
        'em',
        'strong',
        'b',
        'i',
        'code',
        'pre',
        'p',
        'br',
        'a',
        'ul',
        'ol',
        'li',
        'blockquote',
        'span',
      ].includes(name.toLowerCase()),
  )
const unsafePath = (path: string) =>
  !isAbsolute(path) ||
  path.includes('\0') ||
  path.split(/[\\/]/).some((part) => part === '..' || part === '.') ||
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|auth\.json|credentials[^/]*)(?:\/|$)/i.test(path)
export const excluded = (record: Pick<IRecord, 'projectId' | 'path'>, policy: IPolicy) =>
  (record.projectId !== null &&
    policy.excludedProjectIds.some((id) => id.toLowerCase() === record.projectId?.toLowerCase())) ||
  (record.path !== undefined &&
    policy.excludedPaths.some((path) => record.path === path || record.path?.startsWith(`${path}/`)))

// DTO whitelist only: never traverse tool payloads, reasoning, or arbitrary fields.
export function normalize(inputs: readonly IImport[], policy: IPolicy): IArchive {
  if (!Array.isArray(inputs) || inputs.length > 10000) throw new Error('Import bound exceeded')
  const archive: IArchive = { records: [], quarantine: [] }
  const seen = new Map<string, string>()
  let total = 0
  for (const input of inputs) {
    if (!input || typeof input !== 'object') throw new Error('Invalid import')
    const metadata = [
      input.id,
      input.sourceKind,
      input.projectId,
      input.agentId,
      input.conversationId,
      input.messageId,
      input.date,
      input.path,
    ]
    if (metadata.some((value) => typeof value === 'string' && hasSecret(value))) {
      archive.quarantine.push({
        id: `quarantine-${archive.quarantine.length}`,
        reason: 'sensitive-metadata',
      })
      continue
    }
    if (!validId(input.id) || !['letta_memory', 'letta_message', 'pi_message'].includes(input.sourceKind))
      throw new Error('Invalid record identity')
    if (input.projectId !== null && !validId(input.projectId)) throw new Error('Invalid project identity')
    for (const id of [input.agentId, input.conversationId, input.messageId]) {
      if (id !== undefined && !validId(id)) throw new Error('Invalid source identity')
    }
    if (input.projectId === undefined) throw new Error('Explicit project assignment required')
    if (
      input.date !== undefined &&
      (typeof input.date !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input.date) ||
        !Number.isFinite(Date.parse(input.date)) ||
        new Date(input.date).toISOString().replace('.000Z', 'Z') !== input.date.replace('.000Z', 'Z'))
    )
      throw new Error('Invalid source date')
    if (input.path !== undefined && (typeof input.path !== 'string' || unsafePath(input.path)))
      throw new Error('Unsafe source path')
    if (excluded(input, policy)) continue
    let text = ''
    let authority: IRecord['authority'] = 'imported-memory'
    let unknownPart = false
    if (input.sourceKind === 'letta_memory') {
      if (typeof input.markdown !== 'string') throw new Error('Markdown required')
      text = input.markdown
    } else {
      const message = input.message as {
        message_type?: string
        content?: unknown
      } | null
      if (!message || !['user_message', 'assistant_message'].includes(message.message_type ?? '')) continue
      authority = message.message_type === 'user_message' ? 'historical-user' : 'historical-assistant'
      if (typeof message.content === 'string') text = message.content
      else if (Array.isArray(message.content)) {
        if (message.content.length > 1000) throw new Error('Part bound exceeded')
        text = message.content
          .flatMap((part) => {
            if (part && part.type === 'text' && typeof part.text === 'string') return [part.text]
            unknownPart = true
            return []
          })
          .join('\n')
      } else unknownPart = true
    }
    total += bytes(text)
    if (bytes(text) > 65536 || total > 8 * 1024 * 1024) throw new Error('Import byte bound exceeded')
    const fingerprint = digest(
      JSON.stringify([
        input.sourceKind,
        input.projectId,
        input.agentId,
        input.conversationId,
        input.messageId,
        input.date,
        input.path,
        authority,
        text,
      ]),
    )
    if (seen.has(input.id)) {
      if (seen.get(input.id) !== fingerprint) throw new Error('Conflicting duplicate identity')
      continue
    }
    seen.set(input.id, fingerprint)
    // Authored Markdown is literal untrusted data, not a transcript envelope.
    // Privacy screens apply to both domains; harness grammar applies only to messages.
    const isMemory = input.sourceKind === 'letta_memory'
    // These screens are defense in depth, not a secret-free guarantee.
    if (
      secret.test(text) ||
      unknownPart ||
      (!isMemory &&
        (residualWrapper.test(text.replace(wrapper, '')) || unknownWrapper(text.replace(wrapper, ''))))
    ) {
      archive.quarantine.push({
        id: input.id,
        reason: unknownPart ? 'unknown-content' : 'sensitive-or-uncertain',
      })
      continue
    }
    if (!isMemory) text = text.replace(wrapper, '').trim()
    if (!text.trim()) {
      archive.quarantine.push({ id: input.id, reason: 'automated-or-empty' })
      continue
    }
    archive.records.push({
      id: input.id,
      sourceKind: input.sourceKind,
      projectId: input.projectId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      date: input.date,
      path: input.path,
      hash: digest(text),
      authority,
      evidence: 'imported-untrusted',
      text,
    })
  }
  return archive
}

export const objectShape = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key))

export function assertArchive(value: unknown, policy: IPolicy): asserts value is IArchive {
  const fail = () => {
    throw new Error('Invalid continuity data')
  }
  if (
    !objectShape(value, ['records', 'quarantine']) ||
    !Array.isArray(value.records) ||
    !Array.isArray(value.quarantine) ||
    value.records.length + value.quarantine.length > 10000
  )
    fail()
  const archive = value as IArchive
  const inputs: IImport[] = []
  for (const record of archive.records) {
    if (
      !objectShape(record, [
        'id',
        'sourceKind',
        'projectId',
        'agentId',
        'conversationId',
        'messageId',
        'date',
        'path',
        'hash',
        'authority',
        'evidence',
        'text',
      ]) ||
      typeof record.text !== 'string' ||
      record.evidence !== 'imported-untrusted' ||
      !['historical-user', 'historical-assistant', 'imported-memory'].includes(record.authority) ||
      typeof record.hash !== 'string' ||
      record.hash !== digest(record.text)
    )
      fail()
    if ((record.sourceKind === 'letta_memory') !== (record.authority === 'imported-memory')) fail()
    inputs.push({
      id: record.id,
      sourceKind: record.sourceKind,
      projectId: record.projectId,
      agentId: record.agentId,
      conversationId: record.conversationId,
      messageId: record.messageId,
      date: record.date,
      path: record.path,
      ...(record.sourceKind === 'letta_memory'
        ? { markdown: record.text }
        : {
            message: {
              message_type: record.authority === 'historical-user' ? 'user_message' : 'assistant_message',
              content: record.text,
            },
          }),
    })
  }
  const normalized = normalize(inputs, policy)
  if (
    normalized.quarantine.length ||
    normalized.records.length !== archive.records.length ||
    normalized.records.some((record, index) => record.text !== archive.records[index].text)
  )
    fail()
  for (const item of archive.quarantine) {
    if (
      !objectShape(item, ['id', 'reason']) ||
      !validId(item.id) ||
      !['unknown-content', 'sensitive-or-uncertain', 'sensitive-metadata', 'automated-or-empty'].includes(
        item.reason,
      )
    )
      fail()
  }
}

export interface IReadScope {
  projectId: string
  includeGlobal?: boolean
  crossProject?: boolean
}
export interface IHit {
  recordId: string
  citation: string
  evidence: 'UNTRUSTED'
  quote: string
}
export const inScope = (record: Pick<IRecord, 'projectId'>, scope: IReadScope) =>
  record.projectId === scope.projectId ||
  (record.projectId === null ? scope.includeGlobal === true : scope.crossProject === true)
export function search(
  records: readonly IRecord[],
  query: string,
  scope: IReadScope,
  limits = { count: 8, perResultBytes: 2048, totalBytes: 8192 },
): IHit[] {
  if (
    typeof query !== 'string' ||
    !query.trim() ||
    bytes(query) > 512 ||
    /[\x00-\x1f]/.test(query) ||
    !validId(scope.projectId)
  )
    throw new Error('Invalid query')
  for (const [key, max] of [
    ['count', 50],
    ['perResultBytes', 8192],
    ['totalBytes', 32768],
  ] as const)
    if (!Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > max)
      throw new Error('Invalid search bound')
  const terms = [...new Intl.Segmenter('th', { granularity: 'word' }).segment(query.toLocaleLowerCase())]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment)
  if (!terms.length) throw new Error('No query words')
  const ranked = records
    .filter((r) => inScope(r, scope))
    .map((r) => ({
      r,
      score: terms.filter((term) => r.text.toLocaleLowerCase().includes(term)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id, 'en'))
  const hits: IHit[] = []
  for (const { r } of ranked) {
    const lower = r.text.toLocaleLowerCase()
    const exact = lower.indexOf(query.toLocaleLowerCase())
    const term = [...terms].sort((a, b) => b.length - a.length).find((value) => lower.includes(value))!
    const start = exact >= 0 ? exact : lower.indexOf(term)
    const hit: IHit = {
      recordId: r.id,
      citation: `${r.id}#${r.hash}`,
      evidence: 'UNTRUSTED',
      quote: '',
    }
    for (const char of r.text.slice(start)) {
      const next = { ...hit, quote: hit.quote + char }
      if (
        bytes(JSON.stringify(next)) > limits.perResultBytes ||
        bytes(JSON.stringify([...hits, next])) > limits.totalBytes
      )
        break
      hit.quote = next.quote
    }
    if (
      !hit.quote ||
      bytes(JSON.stringify(hit)) > limits.perResultBytes ||
      bytes(JSON.stringify([...hits, hit])) > limits.totalBytes
    )
      continue
    hits.push(hit)
    if (hits.length === limits.count) break
  }
  return hits
}
