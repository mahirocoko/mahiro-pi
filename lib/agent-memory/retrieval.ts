import { bytes, digest, objectShape } from '../continuity/records.ts'
import type { MemoryFile } from './store.ts'

// Derived, operation-local metadata only. These selectors never select authority.
export const discoveryVersion = 2
export const retrievalLimits = Object.freeze({
  queryBytes: 256,
  terms: 16,
  results: 8,
  page: 32,
  snippetCharacters: 192,
  outputBytes: 32768,
  workBytes: 1024 * 1024,
})
export type ReadSelection =
  | { mode: 'list' }
  | { mode: 'path'; path: string; offset: number; limit: number }
  | { mode: 'query'; query: string; offset: number; limit: number }
  | { mode: 'topic'; topic: string; offset: number; limit: number }
const namespacePattern =
  '^(?:\\*|global|procedures|system|system/human|reference|deferred/[a-z0-9][a-z0-9-]{0,63}|projects/[a-z0-9][a-z0-9-]{0,63}/(?:system|reference))?$'
const pageProperties = (max: number) => ({
  offset: { type: 'integer', minimum: 0 },
  limit: { type: 'integer', minimum: 1, maximum: max },
})
// A single schema/parser owner keeps mode-specific rejection coherent with SDK validation.
export const memoryReadSchema = {
  properties: {
    path: { type: 'string' },
    query: { type: 'string' },
    topic: { type: 'string' },
    ...pageProperties(4096),
  },
  oneOf: [
    { type: 'object', properties: {}, additionalProperties: false },
    {
      type: 'object',
      properties: { path: { type: 'string' }, ...pageProperties(4096) },
      required: ['path'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 256 },
        ...pageProperties(8),
      },
      required: ['query'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        topic: { type: 'string', pattern: namespacePattern },
        ...pageProperties(32),
      },
      required: ['topic'],
      additionalProperties: false,
    },
  ],
}
const fold = (value: string) => value.normalize('NFKC').toLowerCase().replace(/ς/g, 'σ')
const termsFor = (query: string) => {
  if (!query.trim() || bytes(query) > retrievalLimits.queryBytes || /[\x00-\x1f\x7f]/.test(query))
    throw new Error('Invalid bounded memory query')
  const terms = [
    ...new Set(
      [...new Intl.Segmenter('th', { granularity: 'word' }).segment(fold(query))]
        .filter((part) => part.isWordLike)
        .map((part) => part.segment),
    ),
  ]
  if (!terms.length || terms.length > retrievalLimits.terms) throw new Error('Invalid memory query terms')
  return terms
}
export function parseMemoryRead(args: unknown): ReadSelection {
  if (!objectShape(args, ['path', 'query', 'topic', 'offset', 'limit']))
    throw new Error('Invalid memory read arguments')
  const selectors = ['path', 'query', 'topic'].filter((key) => Object.hasOwn(args, key))
  if (!selectors.length) {
    if (Object.keys(args).length) throw new Error('Selector required for paging')
    return { mode: 'list' }
  }
  if (selectors.length !== 1) throw new Error('Memory read modes are mutually exclusive')
  const mode = selectors[0] as 'path' | 'query' | 'topic'
  const value = args[mode]
  const offset = args.offset === undefined ? 0 : args.offset
  const limit = args.limit === undefined ? (mode === 'path' ? 4096 : mode === 'query' ? 8 : 32) : args.limit
  const maximum = mode === 'path' ? 4096 : mode === 'query' ? 8 : 32
  if (
    typeof value !== 'string' ||
    !Number.isSafeInteger(offset) ||
    (offset as number) < 0 ||
    !Number.isSafeInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > maximum
  )
    throw new Error('Invalid memory read paging')
  if (mode === 'query') termsFor(value)
  if (mode === 'topic' && !new RegExp(namespacePattern).test(value)) throw new Error('Invalid memory topic')
  return { mode, [mode]: value, offset, limit } as ReadSelection
}
export const topicFor = (path: string) =>
  path.startsWith('deferred/')
    ? path.split('/').slice(0, 2).join('/')
    : path.startsWith('projects/')
      ? path.split('/').slice(0, 3).join('/')
      : path.startsWith('system/human/')
        ? 'system/human'
        : path.includes('/')
          ? path.split('/')[0]
          : 'core'
export function topicMetadata(paths: string[]) {
  const counts = new Map<string, number>()
  for (const path of paths) {
    const topic = topicFor(path)
    if (topic !== 'core' && topic !== 'archives') counts.set(topic, (counts.get(topic) ?? 0) + 1)
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([topic, files]) => ({ topic, files }))
}
export function extractFrontmatterAndLinks(text: string): {
  name?: string
  description?: string
  links: string[]
} {
  let name: string | undefined
  let description: string | undefined
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = /^([a-zA-Z0-9_-]+):\s*(.+?)\s*$/.exec(line)
      if (!m) continue
      const val = m[2].replace(/^['"]|['"]$/g, '').trim()
      if (m[1] === 'name' && val) name = val
      if (m[1] === 'description' && val) description = val
    }
  }
  const links = [
    ...new Set(
      [...text.matchAll(/\[\[([^\][\n]{1,128})\]\]/g)]
        .map((m) => m[1].trim())
        .filter((link) => link.length > 0),
    ),
  ]
  return { ...(name ? { name } : {}), ...(description ? { description } : {}), links }
}
export function directoryIndex(files: Record<string, MemoryFile>, prefix: string) {
  const clean = prefix.replace(/\/+$/, '')
  const entries = Object.keys(files)
    .filter((p) => p.startsWith(`${clean}/`))
    .sort()
    .map((p) => {
      const meta = extractFrontmatterAndLinks(files[p].text)
      return {
        path: p,
        ...(meta.name ? { name: meta.name } : {}),
        ...(meta.description ? { description: meta.description } : {}),
        ...(meta.links.length ? { links: meta.links } : {}),
      }
    })
  return { directory: clean, entries, total: entries.length, hash: null as string | null }
}

// Map folded UTF-16 positions back to ORIGINAL code-point offsets. Grapheme-local
// normalization handles combining marks/expansion without clipping astral pairs.
function searchable(text: string) {
  let folded = ''
  const starts: number[] = []
  let point = 0
  for (const part of new Intl.Segmenter('th', {
    granularity: 'grapheme',
  }).segment(text)) {
    const normalized = fold(part.segment)
    folded += normalized
    for (let i = 0; i < normalized.length; i++) starts.push(point)
    point += [...part.segment].length
  }
  return { folded, starts }
}
function retrieveMemoryImpl(
  files: Record<string, MemoryFile>,
  selection: Extract<ReadSelection, { mode: 'topic' | 'query' }>,
) {
  const paths = Object.keys(files).sort()
  const { offset, limit } = selection
  if (selection.mode === 'topic') {
    const entries =
      selection.topic === ''
        ? topicMetadata(paths)
        : paths
            .filter((path) => selection.topic === '*' || topicFor(path) === selection.topic)
            .map((path) => {
              const meta = extractFrontmatterAndLinks(files[path].text)
              return {
                path,
                ...(meta.name ? { name: meta.name } : {}),
                ...(meta.description ? { description: meta.description } : {}),
                ...(meta.links.length ? { links: meta.links } : {}),
              }
            })
    return {
      discoveryVersion,
      topic: selection.topic,
      entries: entries.slice(offset, offset + limit),
      offset,
      total: entries.length,
      complete: offset + limit >= entries.length,
      ...(offset + limit < entries.length ? { nextOffset: offset + limit } : {}),
    }
  }
  const terms = termsFor(selection.query)
  const results: {
    path: string
    hash: string
    citation: string
    sources: string[]
    text: string
    offset: number
    totalCharacters: number
    truncated: boolean
  }[] = []
  let workBytes = 0
  let cursor = Math.min(offset, paths.length)
  for (; cursor < paths.length; cursor++) {
    const path = paths[cursor]
    const file = files[path]
    const cost = bytes(file.text)
    if (workBytes + cost > retrievalLimits.workBytes || results.length >= limit) break
    workBytes += cost
    const pathText = fold(path)
    // Fast literal presence check first; build the original-offset map only for hits.
    const text = fold(file.text)
    if (!terms.every((term) => pathText.includes(term) || text.includes(term))) continue
    const mapped = searchable(file.text)
    const positions = terms.map((term) => mapped.folded.indexOf(term)).filter((at) => at >= 0)
    const start = positions.length ? Math.max(0, mapped.starts[Math.min(...positions)] - 48) : 0
    const characters = [...file.text]
    const hash = digest(file.text)
    const result = {
      path,
      hash,
      citation: `${path}#sha256:${hash}`,
      sources: [...file.sources],
      text: characters.slice(start, start + retrievalLimits.snippetCharacters).join(''),
      offset: start,
      totalCharacters: characters.length,
      truncated: start > 0 || start + retrievalLimits.snippetCharacters < characters.length,
    }
    // Leave room for revision/status envelope; never silently drop source IDs.
    if (bytes(JSON.stringify([...results, result])) > retrievalLimits.outputBytes - 2048) break
    results.push(result)
  }
  const complete = cursor >= paths.length
  return {
    query: selection.query,
    results,
    offset,
    complete,
    outcome: complete ? (results.length ? 'matches' : 'no-match') : 'incomplete',
    workBytes,
    ...(complete ? {} : { nextOffset: cursor }),
  }
}
type RetrievalResult = ReturnType<typeof retrieveMemoryImpl>
export function retrieveMemory(
  files: Record<string, MemoryFile>,
  selection: Extract<ReadSelection, { mode: 'topic' }>,
): Extract<RetrievalResult, { topic: string }>
export function retrieveMemory(
  files: Record<string, MemoryFile>,
  selection: Extract<ReadSelection, { mode: 'query' }>,
): Extract<RetrievalResult, { query: string }>
export function retrieveMemory(
  files: Record<string, MemoryFile>,
  selection: Extract<ReadSelection, { mode: 'topic' | 'query' }>,
): RetrievalResult
export function retrieveMemory(
  files: Record<string, MemoryFile>,
  selection: Extract<ReadSelection, { mode: 'topic' | 'query' }>,
): RetrievalResult {
  return retrieveMemoryImpl(files, selection)
}
