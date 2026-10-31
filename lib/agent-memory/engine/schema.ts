import { isAbsolute, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { memoryFailure } from '../reasons.ts'
import { bytes, hasSecret, objectShape, validId } from '../../continuity/records.ts'
import type { MemoryConfig, MemoryFile } from '../store.ts'
import { configRecordVersion, reflectionSelectionValid } from '../reflection-config.ts'

// Deliberately data-only. No store factory, SDK, loader or resource discovery.
export const limits = Object.freeze({
  files: 1024,
  changes: 2049,
  file: 262144,
  total: 8388608,
  ledger: 512 * 1024,
  views: 64,
})
export const revisionPattern = /^[a-f0-9]{40,64}$/
export const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/
export const uuidPattern = /^[a-f0-9-]{36}$/
export const projectOfPath = (path: string): string | null => {
  const m = /^(?:deferred|projects)\/([a-z0-9][a-z0-9-]{0,63})\//.exec(path)
  return m ? m[1] : null
}
export const allowedPath = (path: string, project?: string) => {
  if (typeof path !== 'string') return false
  if (['Core.md', 'index.md', 'system/persona.md'].includes(path)) return true
  if (/^(global|procedures)\/[a-z0-9][a-z0-9-]{0,63}\.md$/.test(path)) return true
  if (/^system\/human\/(?:prefs\/)?[a-z0-9][a-z0-9-]{0,63}\.md$/.test(path)) return true
  if (/^reference\/(?:[a-z0-9][a-z0-9-]{0,63}\/)?[a-z0-9][a-z0-9-]{0,63}\.md$/.test(path)) return true
  const archive = /^archives\/([a-z0-9][a-z0-9-]{0,63})(?:\/[a-z0-9][a-z0-9-]{0,63}){1,3}\.md$/.exec(path)
  if (archive) return !project || archive[1] === project || archive[1].startsWith('legacy-v1')
  const deferred = /^deferred\/([a-z0-9][a-z0-9-]{0,63})\/[a-z0-9][a-z0-9-]{0,63}\.md$/.exec(path)
  if (deferred) return !project || deferred[1] === project
  const tieredProject =
    /^projects\/([a-z0-9][a-z0-9-]{0,63})\/(?:system|reference)\/[a-z0-9][a-z0-9-]{0,63}\.md$/.exec(path)
  return !!tieredProject && (!project || tieredProject[1] === project)
}
export interface LegacyV1Migration {
  archivePath: string
  targetPath: string
  metadataName: string
  description: string
}

interface LegacyArchiveIdentity {
  hash: string
  size: number
  sources: string[]
}

export function assertLegacyArchiveCompatible(
  archivePath: string,
  existing: LegacyArchiveIdentity | undefined,
  incoming: LegacyArchiveIdentity,
) {
  if (existing && !isDeepStrictEqual(existing, incoming))
    throw Error(`Legacy migration archive collision: ${archivePath}`)
}

export function legacyV1Migration(revision: string, path: string): LegacyV1Migration {
  if (!revisionPattern.test(revision)) throw Error('Invalid migration revision')
  const archivePrefix = `archives/legacy-v1-${revision.slice(0, 12)}`
  const global = /^global\/([a-z0-9][a-z0-9-]{0,63}\.md)$/.exec(path)
  if (global) {
    const slug = global[1]
    const result = {
      archivePath: `${archivePrefix}/global/${slug}`,
      targetPath: `system/human/${slug}`,
      metadataName: slug.slice(0, -3),
      description: `Shared human preference migrated from ${path}`,
    }
    if (!allowedPath(result.archivePath) || !allowedPath(result.targetPath))
      throw Error('Invalid global migration path')
    return result
  }
  const deferred = /^deferred\/([a-z0-9][a-z0-9-]{0,63})\/([a-z0-9][a-z0-9-]{0,63}\.md)$/.exec(path)
  if (deferred) {
    const [, project, slug] = deferred
    const result = {
      archivePath: `${archivePrefix}/deferred/${project}/${slug}`,
      targetPath: `projects/${project}/system/${slug}`,
      metadataName: slug.slice(0, -3),
      description: `Project memory migrated from ${path}`,
    }
    if (!allowedPath(result.archivePath) || !allowedPath(result.targetPath))
      throw Error('Invalid project migration path')
    return result
  }
  throw Error('Invalid legacy v1 migration path')
}

const frontmatterScalar = (value: string, fallback: string, maximum: number) => {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum)
  return JSON.stringify(normalized || fallback)
}

export function withMigrationFrontmatter(text: string, migration: LegacyV1Migration) {
  if (/^---\n[\s\S]*?\n---(?:\n|$)/.test(text)) return text
  return `---\nname: ${frontmatterScalar(migration.metadataName, 'migrated-memory', 64)}\ndescription: ${frontmatterScalar(migration.description, 'Migrated legacy memory', 256)}\n---\n${text}`
}

export const isAlwaysLoadedTieredPath = (path: string, project?: string) => {
  if (path === 'system/persona.md') return true
  const m = /^projects\/([a-z0-9][a-z0-9-]{0,63})\/system\/(?:overview|conventions)\.md$/.exec(path)
  return !!m && m[1] === project
}
export const isCriticalLinkSource = (path: string, project?: string) =>
  path === 'Core.md' || path === 'index.md' || isAlwaysLoadedTieredPath(path, project)

export const isProtectedRetentionPath = (path: string) =>
  path === 'Core.md' ||
  path === 'system/persona.md' ||
  path.startsWith('system/human/') ||
  /^projects\/[a-z0-9][a-z0-9-]{0,63}\/system\//.test(path)

export interface EditModeOptions {
  mode?: 'replace' | 'patch' | 'append'
  oldText?: string
  newText?: string
  section?: string
}

export function applySurgicalEdit(
  currentText: string | undefined,
  text: string | null,
  options?: EditModeOptions,
): string | null {
  const mode = options?.mode ?? 'replace'
  if (mode === 'replace') return text
  if (mode === 'patch') {
    if (typeof currentText !== 'string') throw Error('Surgical patch requires an existing file')
    const oldText = options?.oldText
    const newText = options?.newText ?? text
    if (typeof oldText !== 'string' || !oldText.length || typeof newText !== 'string')
      throw Error('Surgical patch requires non-empty oldText and newText')
    const first = currentText.indexOf(oldText)
    if (first === -1) throw Error('Surgical patch target not found')
    if (currentText.indexOf(oldText, first + oldText.length) !== -1)
      throw Error('Surgical patch target is ambiguous')
    const patched = `${currentText.slice(0, first)}${newText}${currentText.slice(first + oldText.length)}`
    return patched.endsWith('\n') ? patched : `${patched}\n`
  }
  if (mode === 'append') {
    const addition = typeof text === 'string' ? text : options?.newText
    if (typeof addition !== 'string' || !addition.trim().length)
      throw Error('Surgical append requires non-empty text')
    const trimmed = addition.trimEnd()
    if (!currentText) {
      if (options?.section) {
        const heading = options.section.startsWith('#') ? options.section : `## ${options.section}`
        return `${heading}\n\n${trimmed}\n`
      }
      return `${trimmed}\n`
    }
    if (options?.section) {
      const normalizedSection = options.section
        .replace(/^#+\s*/, '')
        .trim()
        .toLowerCase()
      const lines = currentText.split('\n')
      let sectionIdx = -1
      let sectionLevel = 2
      for (let i = 0; i < lines.length; i++) {
        const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i])
        if (m && m[2].toLowerCase() === normalizedSection) {
          sectionIdx = i
          sectionLevel = m[1].length
          break
        }
      }
      if (sectionIdx !== -1) {
        let insertIdx = lines.length
        while (insertIdx > sectionIdx + 1 && lines[insertIdx - 1] === '') insertIdx--
        for (let i = sectionIdx + 1; i < lines.length; i++) {
          const m = /^(#{1,6})\s+/.exec(lines[i])
          if (m && m[1].length <= sectionLevel) {
            insertIdx = i
            while (insertIdx > sectionIdx + 1 && lines[insertIdx - 1] === '') insertIdx--
            break
          }
        }
        lines.splice(insertIdx, 0, ...trimmed.split('\n'))
        const joined = lines.join('\n')
        return joined.endsWith('\n') ? joined : `${joined}\n`
      }
      const heading = options.section.startsWith('#') ? options.section : `## ${options.section}`
      const base = currentText.endsWith('\n') ? currentText : `${currentText}\n`
      return `${base}\n${heading}\n\n${trimmed}\n`
    }
    const base = currentText.endsWith('\n') ? currentText : `${currentText}\n`
    return `${base}${trimmed}\n`
  }
  throw Error('Invalid edit mode')
}

const extractHeadings = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => /^(#{1,6}\s+.+?)\s*$/.exec(line)?.[1])
    .filter((h): h is string => Boolean(h))

export function assertLosslessRetention(
  baseFiles: Record<string, { text: string } | undefined>,
  nextFiles: Record<string, { text: string } | undefined>,
  changedPaths: Iterable<string>,
  allowShrink = false,
) {
  if (allowShrink) return
  const changed = [...changedPaths]
  const archivedAlongside = changed.some((p) => {
    if (!p.startsWith('reference/') && !p.startsWith('archives/') && !/^projects\/[^/]+\/reference\//.test(p))
      return false
    const beforeLen = baseFiles[p]?.text.length ?? 0
    const afterLen = nextFiles[p]?.text.length ?? 0
    return afterLen > beforeLen
  })
  if (archivedAlongside) return
  for (const path of changed) {
    if (!isProtectedRetentionPath(path)) continue
    const before = baseFiles[path]?.text
    const after = nextFiles[path]?.text
    if (!before) continue
    if (!after)
      throw memoryFailure(
        'retention',
        `Lossless retention guard: cannot remove protected memory ${path} without archiving to reference/ or archives/`,
      )
    const beforeHeadings = extractHeadings(before)
    if (path === 'Core.md' && beforeHeadings.length < 2 && before.length < 160) continue
    const afterHeadings = new Set(extractHeadings(after))
    const dropped = beforeHeadings.filter((h) => !afterHeadings.has(h))
    if (dropped.length)
      throw memoryFailure(
        'retention',
        `Lossless retention guard: ${path} dropped section heading(s) (${dropped.join(', ')}) without archiving to reference/ or archives/`,
      )
    if (before.length >= 160 && after.length < before.length * 0.8)
      throw memoryFailure(
        'retention',
        `Lossless retention guard: ${path} shrank by >20% (${before.length} -> ${after.length} bytes) without archiving to reference/ or archives/`,
      )
  }
}
export function parseConfig(raw: string): MemoryConfig {
  const c = JSON.parse(raw)
  const version = c && typeof c === 'object' ? configRecordVersion(c) : undefined
  if (
    !version ||
    typeof c.automatic !== 'boolean' ||
    (version === 2 && !reflectionSelectionValid(c)) ||
    !Array.isArray(c.projects) ||
    !c.projects.length ||
    c.projects.length > 128
  )
    throw Error('Invalid memory configuration')
  for (const key of ['coreBytes', 'indexBytes', 'fileBytes', 'totalBytes'])
    if (!Number.isSafeInteger(c[key]) || (c[key] as number) < 256) throw Error('Invalid memory budget')
  if (
    (c.coreBytes as number) > 32768 ||
    (c.indexBytes as number) > 8192 ||
    (c.fileBytes as number) > limits.file ||
    (c.totalBytes as number) > limits.total
  )
    throw Error('Memory configured budget ceiling exceeded')
  const seen = new Set<string>()
  for (const p of c.projects) {
    if (
      !objectShape(p, ['cwd', 'id']) ||
      Object.keys(p).length !== 2 ||
      typeof p.cwd !== 'string' ||
      !isAbsolute(p.cwd) ||
      resolve(p.cwd) !== p.cwd ||
      typeof p.id !== 'string' ||
      !idPattern.test(p.id) ||
      seen.has(p.cwd)
    )
      throw Error('Invalid memory project')
    seen.add(p.cwd)
  }
  return c as unknown as MemoryConfig
}
export interface Ledger {
  version: 2
  sources: Record<string, string[]>
  forgottenPaths: string[]
  forgottenSources: { project: string | null; source: string }[]
  reviewed: string[]
}
export function parseLedger(raw: string): Ledger {
  if (bytes(raw) > limits.ledger) throw Error('Memory ledger budget exceeded')
  const s = JSON.parse(raw)
  if (
    !objectShape(s, ['forgottenPaths', 'forgottenSources', 'reviewed', 'sources', 'version']) ||
    Object.keys(s).length !== 5 ||
    s.version !== 2 ||
    !s.sources ||
    typeof s.sources !== 'object' ||
    Array.isArray(s.sources) ||
    Object.keys(s.sources).length > limits.files ||
    !Object.hasOwn(s.sources, 'Core.md') ||
    !Object.hasOwn(s.sources, 'index.md')
  )
    throw Error('Invalid memory ledger')
  for (const [path, sources] of Object.entries(s.sources))
    if (
      !allowedPath(path) ||
      !Array.isArray(sources) ||
      sources.length > 32 ||
      new Set(sources).size !== sources.length ||
      sources.some((id) => !validId(id))
    )
      throw Error('Invalid memory source metadata')
  for (const key of ['forgottenPaths', 'forgottenSources', 'reviewed']) {
    const entries = s[key]
    if (
      !Array.isArray(entries) ||
      entries.length > 4096 ||
      entries.some((value: unknown) =>
        key === 'forgottenPaths'
          ? typeof value !== 'string' || !allowedPath(value)
          : key === 'reviewed'
            ? !validId(value)
            : !objectShape(value, ['project', 'source']) ||
              Object.keys(value).length !== 2 ||
              !(
                value.project === null ||
                (typeof value.project === 'string' && idPattern.test(value.project))
              ) ||
              !validId(value.source),
      ) ||
      new Set(entries.map((value: unknown) => JSON.stringify(value))).size !== entries.length
    )
      throw Error('Invalid memory ledger entry')
  }
  return s as unknown as Ledger
}
export const fileLimit = (path: string, c: MemoryConfig) =>
  path === 'Core.md' ? c.coreBytes : path === 'index.md' ? c.indexBytes : c.fileBytes
export function validateFile(path: string, file: MemoryFile, c: MemoryConfig) {
  if (
    !allowedPath(path) ||
    !objectShape(file, ['sources', 'text']) ||
    Object.keys(file).length !== 2 ||
    typeof file.text !== 'string' ||
    !file.text.endsWith('\n') ||
    hasSecret(file.text) ||
    /[\x00-\x08\x0b-\x1f\x7f]/.test(file.text) ||
    !Array.isArray(file.sources) ||
    file.sources.length > 32 ||
    file.sources.some((id) => !validId(id)) ||
    new Set(file.sources).size !== file.sources.length
  )
    throw Error('Unsafe memory content')
  if (bytes(file.text) > fileLimit(path, c)) throw Error('Memory file budget exceeded')
}
export const suppressed = (ledger: Ledger, path: string, sources: string[]) =>
  ledger.forgottenPaths.includes(path) ||
  sources.some((source) =>
    ledger.forgottenSources.some((entry) => entry.source === source && entry.project === projectOfPath(path)),
  )
