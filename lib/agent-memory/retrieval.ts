import { bytes, digest, objectShape } from '../continuity/records.ts'
import {
  isAlwaysLoadedTieredPath,
  isCriticalLinkSource,
  isProtectedRetentionPath,
  limits,
} from './engine/schema.ts'
import type { MemoryConfig, MemoryFile } from './store.ts'

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
// Existing discovery callers keep their 128-character presentation contract.
// Palace opts into full file-bounded targets for inspection before clipping output.
export function extractFrontmatterAndLinks(
  text: string,
  linkTargetCharacters = 128,
): {
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
      [...text.matchAll(/\[\[([^\][\n]+)\]\]/g)]
        .filter((m) => m[1].length <= linkTargetCharacters)
        .map((m) => m[1].trim())
        .filter((link) => link.length > 0),
    ),
  ]
  return { ...(name ? { name } : {}), ...(description ? { description } : {}), links }
}
export function directoryPage(paths: string[], prefix: string, offset: number, limit: number) {
  const directory = prefix.replace(/\/+$/, '')
  const all = [...new Set(paths.filter((p) => p.startsWith(`${directory}/`)))].sort()
  const boundedLimit = Math.min(limit, retrievalLimits.page)
  const pagePaths = all.slice(offset, offset + boundedLimit)
  const nextOffset = offset + pagePaths.length
  return {
    directory,
    paths: pagePaths,
    total: all.length,
    offset,
    limit: boundedLimit,
    truncated: offset > 0 || nextOffset < all.length,
    ...(nextOffset < all.length ? { nextOffset } : {}),
  }
}
const memorySuggestionLimit = 5

function blockedMemoryLookup(path: string): boolean {
  if (
    path.length === 0 ||
    path.length > 512 ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\\') ||
    /[\x00-\x1f\x7f]/.test(path)
  )
    return true
  return path
    .split('/')
    .some((segment) => segment === '' || segment === '.' || segment === '..' || segment.startsWith('.'))
}

// Hints use only the caller's already scoped paths. Appending `.md` wins when that
// file is in scope; other matches share the basename, skip root files, and stop at five.
export function memoryExtensionSuggestion(requested: string, authorizedPaths: readonly string[]): string[] {
  if (blockedMemoryLookup(requested) || requested.endsWith('.md')) return []
  const sibling = `${requested}.md`
  return authorizedPaths.includes(sibling) ? [sibling] : []
}

export function memoryPathSuggestions(requested: string, authorizedPaths: readonly string[]): string[] {
  const extension = memoryExtensionSuggestion(requested, authorizedPaths)
  if (extension.length) return extension
  if (blockedMemoryLookup(requested)) return []
  const name = requested.slice(requested.lastIndexOf('/') + 1)
  const found: string[] = []
  for (const path of authorizedPaths) {
    if (found.length >= memorySuggestionLimit) break
    if (!path.includes('/') || path.startsWith('skills/') || path === requested) continue
    if (path.split('/').some((segment) => segment.startsWith('.'))) continue
    if (path.slice(path.lastIndexOf('/') + 1) === name) found.push(path)
  }
  return found
}

export function memoryMissingHint(requested: string, suggestions: readonly string[]): string {
  return `No memory at ${requested}. Did you mean ${suggestions.join(' or ')}? Paths are relative to the memory directory.`
}

export function directoryIndex(files: Record<string, MemoryFile>, page: ReturnType<typeof directoryPage>) {
  const entries = page.paths.map((p) => {
    const meta = extractFrontmatterAndLinks(files[p].text)
    return {
      path: p,
      ...(meta.name ? { name: meta.name } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.links.length ? { links: meta.links } : {}),
    }
  })
  return {
    directory: page.directory,
    entries,
    total: page.total,
    hash: null as string | null,
    offset: page.offset,
    limit: page.limit,
    truncated: page.truncated,
    ...(page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {}),
  }
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

// Complete manage reply (including the palace wrapper); leaves transport envelope headroom.
export const palaceReplyBytes = 240 * 1024

export type PalaceLayer =
  | 'core'
  | 'index'
  | 'system'
  | 'reference'
  | 'projectSystem'
  | 'projectReference'
  | 'archives'
  | 'legacy'

export interface PalaceFileEntry {
  path: string
  layer: PalaceLayer
  bytes: number
  protectedRetention: boolean
  alwaysLoaded: boolean
  sourcesCount: number
  name?: string
  description?: string
  links?: string[]
}

export interface PalaceInput {
  revision: string
  project: string
  config: Pick<MemoryConfig, 'coreBytes' | 'indexBytes' | 'fileBytes' | 'totalBytes'>
  activePaths: string[]
  fileSizes: Record<string, number>
  fileSources: Record<string, string[]>
  fileTexts: Record<string, string | undefined>
  views: {
    total: number
    open: number
    conflict: number
    committed: number
    cancelled: number
  }
  episodes: {
    total: number
    reviewed: number
  }
  tombstones: {
    forgottenPaths: number
    forgottenSources: number
  }
  pendingOperations: {
    id: string
    digest: string
    stage: string
    recordBytes: number
  }[]
}

export function palaceLayerFor(path: string): PalaceLayer {
  if (path === 'Core.md') return 'core'
  if (path === 'index.md') return 'index'
  if (path === 'system/persona.md' || path.startsWith('system/human/')) return 'system'
  if (path.startsWith('reference/') || path.startsWith('procedures/')) return 'reference'
  if (/^projects\/[a-z0-9][a-z0-9-]{0,63}\/system\//.test(path)) return 'projectSystem'
  if (/^projects\/[a-z0-9][a-z0-9-]{0,63}\/reference\//.test(path)) return 'projectReference'
  if (path.startsWith('archives/')) return 'archives'
  return 'legacy'
}

export function buildMemoryPalace(input: PalaceInput) {
  const sortedPaths = [...input.activePaths].sort()
  const nonArchivePaths = sortedPaths.filter((p) => !p.startsWith('archives/'))
  const archivePaths = sortedPaths.filter((p) => p.startsWith('archives/'))
  const orderedPaths = [...nonArchivePaths, ...archivePaths]
  const activeSet = new Set(sortedPaths)
  const layers: Record<PalaceLayer, string[]> = {
    core: [],
    index: [],
    system: [],
    reference: [],
    projectSystem: [],
    projectReference: [],
    archives: [],
    legacy: [],
  }
  let totalBytesUsed = 0
  let alwaysLoadedBytes = 0
  let inspectedFiles = 0
  let uninspectedNonArchive = 0
  let brokenLinksTotal = 0
  let criticalBrokenLinksTotal = 0
  let advisoryBrokenLinksTotal = 0
  let filesBytesUsed = 0
  let filesCapped = false
  const files: PalaceFileEntry[] = []
  const brokenLinks: { source: string; target: string }[] = []

  for (const p of orderedPaths) {
    const layer = palaceLayerFor(p)
    const size = input.fileSizes[p] ?? 0
    totalBytesUsed += size
    const alwaysLoaded = p === 'Core.md' || p === 'index.md' || isAlwaysLoadedTieredPath(p, input.project)
    if (alwaysLoaded) alwaysLoadedBytes += size
    const isArchive = p.startsWith('archives/')
    const text = !isArchive ? input.fileTexts[p] : undefined
    if (!isArchive) {
      if (typeof text === 'string') inspectedFiles++
      else uninspectedNonArchive++
    }
    const meta = typeof text === 'string' ? extractFrontmatterAndLinks(text, limits.file) : { links: [] }
    for (const link of meta.links) {
      const normalized = link.endsWith('.md') ? link : `${link}.md`
      if (!activeSet.has(link) && !activeSet.has(normalized)) {
        brokenLinksTotal++
        if (isCriticalLinkSource(p, input.project)) criticalBrokenLinksTotal++
        else advisoryBrokenLinksTotal++
        if (brokenLinks.length < 64) {
          brokenLinks.push({ source: p, target: link.slice(0, 128) })
        }
      }
    }
    if (!filesCapped && files.length < limits.files) {
      const boundedName = meta.name ? meta.name.slice(0, 128) : undefined
      const boundedDesc = meta.description ? meta.description.slice(0, 256) : undefined
      const boundedLinks = meta.links.length ? meta.links.slice(0, 16).map((l) => l.slice(0, 128)) : undefined
      const entry: PalaceFileEntry = {
        path: p,
        layer,
        bytes: size,
        protectedRetention: isProtectedRetentionPath(p),
        alwaysLoaded,
        sourcesCount: (input.fileSources[p] ?? []).length,
        ...(boundedName ? { name: boundedName } : {}),
        ...(boundedDesc ? { description: boundedDesc } : {}),
        ...(boundedLinks ? { links: boundedLinks } : {}),
      }
      const entryBytes = Buffer.byteLength(JSON.stringify(entry), 'utf8')
      if (filesBytesUsed + entryBytes <= 163840) {
        files.push(entry)
        layers[layer].push(p)
        filesBytesUsed += entryBytes
      } else {
        filesCapped = true
      }
    }
  }

  const complete = uninspectedNonArchive === 0
  const palace = {
    revision: input.revision,
    project: input.project,
    healthy: complete && totalBytesUsed <= input.config.totalBytes && criticalBrokenLinksTotal === 0,
    coverage: {
      complete,
      inspectedFiles,
      nonArchiveFiles: nonArchivePaths.length,
      totalFiles: sortedPaths.length,
      filesReturned: files.length,
      filesTruncated: files.length < sortedPaths.length,
      layersTruncated: files.length < sortedPaths.length,
      brokenLinksTotal,
      criticalBrokenLinksTotal,
      advisoryBrokenLinksTotal,
      brokenLinksTruncated: brokenLinks.length < brokenLinksTotal,
    },
    budget: {
      coreBytes: input.config.coreBytes,
      indexBytes: input.config.indexBytes,
      fileBytes: input.config.fileBytes,
      totalBytesUsed,
      totalBytesCeiling: input.config.totalBytes,
      alwaysLoadedBytes,
      fileCount: sortedPaths.length,
      fileCeiling: limits.files,
    },
    layers,
    files,
    brokenLinks,
    views: input.views,
    episodes: input.episodes,
    tombstones: input.tombstones,
    pendingOperations: input.pendingOperations,
  }
  // Inspection above is exhaustive independently of presentation. Charge *all*
  // encoded metadata, repeated layer paths, JSON escaping and the reply wrapper.
  while (bytes(JSON.stringify({ palace })) > palaceReplyBytes) {
    const removed = files.pop()
    if (removed) layers[removed.layer].pop()
    else if (brokenLinks.length) brokenLinks.pop()
    else throw new Error('Memory palace fixed metadata exceeds reply bound')
    palace.coverage.filesReturned = files.length
    palace.coverage.filesTruncated = files.length < sortedPaths.length
    palace.coverage.layersTruncated = palace.coverage.filesTruncated
    palace.coverage.brokenLinksTruncated = brokenLinks.length < brokenLinksTotal
  }
  return palace
}
