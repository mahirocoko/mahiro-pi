import { bytes, digest, objectShape } from '../continuity/records.ts'
import {
  allowedPath,
  idPattern,
  isAlwaysLoadedTieredPath,
  isProtectedRetentionPath,
  limits,
  revisionPattern,
} from './engine/schema.ts'
import { palaceLayerFor } from './retrieval.ts'

// Shared validation only; committed reads remain exclusively in engine/data.ts.
export function palaceScopedPath(path: string, project = 'default') {
  if (typeof project !== 'string' || !idPattern.test(project)) return false
  if (path.startsWith('archives/')) {
    const parts = path.split('/')
    if (parts[1]?.startsWith('legacy-v1')) {
      if (!/^legacy-v1-[a-f0-9]{12}$/.test(parts[1])) return false
      if (
        !(parts.length === 4 && parts[2] === 'global') &&
        !(parts.length === 5 && parts[2] === 'deferred' && idPattern.test(parts[3] ?? ''))
      )
        return false
    } else if (!idPattern.test(parts[1] ?? '')) return false
  }
  return (
    allowedPath(path) &&
    !path.split('/').some((part) => !part || part === '.' || part === '..') &&
    !/[\u0000-\u001f\u007f-\u009f\\]/.test(path) &&
    (path === 'Core.md' ||
      path === 'index.md' ||
      ['system/', 'reference/', 'archives/', 'projects/'].some((p) => path.startsWith(p)))
  )
}
// Export includes the full shared primary corpus; legacy archives retain their narrower attribution fence.
export function palaceExportPath(path: string, project = 'default') {
  return allowedPath(path) && (path.startsWith('archives/') ? palaceScopedPath(path, project) : true)
}
export function utf8Preview(text: string, cap: number) {
  let result = ''
  let size = 0
  for (const char of text) {
    const n = Buffer.byteLength(char)
    if (size + n > cap) break
    result += char
    size += n
  }
  return result
}
export interface PalaceStructureFile {
  path: string
  layer: string
  bytes: number
  protectedRetention: boolean
  alwaysLoaded: boolean
  sourcesCount: number
  body?: string
  bodyTruncated?: boolean
}
export interface PalaceStructure {
  version: 1
  revision: string
  configHash: string
  project: string
  basis: 'committed-head'
  currentness: 'config-and-head-matched-at-final-checks'
  bodyInspection: 'not-requested' | 'bounded-committed-preview'
  structureDigest: string
  snapshotDigest: string
  output: { total: number; returned: number; omitted: number; truncated: boolean }
  files: PalaceStructureFile[]
}
export function structureDigest(files: PalaceStructureFile[]) {
  return digest(JSON.stringify(files))
}
export function snapshotDigest(
  s: Pick<PalaceStructure, 'revision' | 'configHash' | 'project' | 'structureDigest' | 'output'>,
) {
  return digest(JSON.stringify([1, s.revision, s.configHash, s.project, s.structureDigest, s.output.total]))
}
export function assertPalaceStructure(
  value: unknown,
  input: { project: unknown; expectedConfigHash: unknown },
): asserts value is PalaceStructure {
  const exact = (v: unknown, keys: string[]) =>
    objectShape(v, keys) && Object.keys(v as object).length === keys.length
  const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max
  const fail = () => {
    throw Error('Invalid Palace structure reply')
  }
  if (
    !exact(value, [
      'version',
      'revision',
      'configHash',
      'project',
      'basis',
      'currentness',
      'bodyInspection',
      'structureDigest',
      'snapshotDigest',
      'output',
      'files',
    ])
  )
    fail()
  const s = value as PalaceStructure
  if (
    bytes(JSON.stringify(s)) > 192 * 1024 ||
    s.version !== 1 ||
    typeof s.revision !== 'string' ||
    !revisionPattern.test(s.revision) ||
    typeof s.configHash !== 'string' ||
    s.configHash !== input.expectedConfigHash ||
    !/^[a-f0-9]{64}$/.test(s.configHash) ||
    typeof s.project !== 'string' ||
    s.project !== input.project ||
    !idPattern.test(s.project) ||
    s.basis !== 'committed-head' ||
    s.currentness !== 'config-and-head-matched-at-final-checks' ||
    !['not-requested', 'bounded-committed-preview'].includes(s.bodyInspection) ||
    !exact(s.output, ['total', 'returned', 'omitted', 'truncated']) ||
    !Array.isArray(s.files) ||
    s.files.length > 128
  )
    fail()
  for (const [i, f] of s.files.entries()) {
    if (
      !exact(f, [
        'path',
        'layer',
        'bytes',
        'protectedRetention',
        'alwaysLoaded',
        'sourcesCount',
        ...(s.bodyInspection === 'bounded-committed-preview' ? ['body', 'bodyTruncated'] : []),
      ]) ||
      (s.bodyInspection === 'bounded-committed-preview' &&
        (!palaceScopedPath(f.path, s.project) ||
          typeof f.body !== 'string' ||
          bytes(f.body) > 8192 ||
          typeof f.bodyTruncated !== 'boolean' ||
          f.bodyTruncated !== bytes(f.body) < f.bytes)) ||
      typeof f.path !== 'string' ||
      !allowedPath(f.path) ||
      f.layer !== palaceLayerFor(f.path) ||
      !integer(f.bytes, limits.file) ||
      !integer(f.sourcesCount, 32) ||
      f.protectedRetention !== isProtectedRetentionPath(f.path) ||
      f.alwaysLoaded !==
        (f.path === 'Core.md' || f.path === 'index.md' || isAlwaysLoadedTieredPath(f.path, s.project)) ||
      (i > 0 && s.files[i - 1].path >= f.path)
    )
      fail()
  }
  if (
    s.bodyInspection === 'bounded-committed-preview' &&
    (s.files.length > 32 ||
      bytes(JSON.stringify(s)) > 192 * 1024 ||
      s.files.reduce((n, file) => n + bytes(file.body!), 0) > 128 * 1024)
  )
    fail()
  const o = s.output
  if (
    !integer(o.total, limits.files) ||
    o.returned !== s.files.length ||
    !integer(o.omitted) ||
    o.omitted !== o.total - o.returned ||
    o.truncated !== o.omitted > 0 ||
    typeof s.structureDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(s.structureDigest) ||
    typeof s.snapshotDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(s.snapshotDigest) ||
    s.snapshotDigest !== snapshotDigest(s) ||
    (!o.truncated && s.structureDigest !== structureDigest(s.files))
  )
    fail()
}
