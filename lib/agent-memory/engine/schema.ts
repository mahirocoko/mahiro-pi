import { isAbsolute, resolve } from 'node:path'
import { bytes, hasSecret, objectShape, validId } from '../../continuity/records.ts'
import type { MemoryConfig, MemoryFile } from '../store.ts'

// Deliberately data-only. No store factory, SDK, loader or resource discovery.
export const limits = Object.freeze({ files: 512, file: 262144, total: 8388608, ledger: 131072, views: 64 })
export const revisionPattern = /^[a-f0-9]{40,64}$/
export const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/
export const uuidPattern = /^[a-f0-9-]{36}$/
export const allowedPath = (path: string, project?: string) => {
  if (typeof path !== 'string') return false
  if (['Core.md', 'index.md'].includes(path)) return true
  if (/^(global|procedures)\/[a-z0-9][a-z0-9-]{0,63}\.md$/.test(path)) return true
  const match = /^deferred\/([a-z0-9][a-z0-9-]{0,63})\/[a-z0-9][a-z0-9-]{0,63}\.md$/.exec(path)
  return !!match && (!project || match[1] === project)
}
export function parseConfig(raw: string): MemoryConfig {
  const c = JSON.parse(raw)
  if (
    !objectShape(c, [
      'automatic',
      'coreBytes',
      'fileBytes',
      'indexBytes',
      'projects',
      'totalBytes',
      'version',
    ]) ||
    Object.keys(c).length !== 7 ||
    c.version !== 1 ||
    typeof c.automatic !== 'boolean' ||
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
    ledger.forgottenSources.some(
      (entry) =>
        entry.source === source &&
        entry.project === (path.startsWith('deferred/') ? path.split('/')[1] : null),
    ),
  )
