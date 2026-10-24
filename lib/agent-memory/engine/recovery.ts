import { objectShape, bytes } from '../../continuity/records.ts'
import type { MemoryConfig, View, MemoryFile } from '../store.ts'
import {
  allowedPath,
  idPattern,
  uuidPattern,
  revisionPattern,
  parseLedger,
  validateFile,
  limits,
} from './schema.ts'

export const recoveryCeiling = {
  coreBytes: 32768,
  indexBytes: 8192,
  fileBytes: limits.file,
  totalBytes: limits.total,
} as MemoryConfig
export function validateFiles(value: unknown, project?: string): asserts value is Record<string, MemoryFile> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid retained files')
  const files = value as Record<string, MemoryFile>
  if (Object.keys(files).length > limits.files || !files['Core.md'] || !files['index.md'])
    throw Error('Invalid retained layout')
  let total = 0
  for (const [path, file] of Object.entries(files)) {
    if (!allowedPath(path, project)) throw Error('Invalid retained scope')
    validateFile(path, file, recoveryCeiling)
    total += bytes(file.text)
  }
  if (total > limits.total) throw Error('Invalid retained total budget')
}
export function legacyView(raw: string, id: string): View {
  const v = JSON.parse(raw)
  if (
    !objectShape(v, ['id', 'project', 'scope', 'configHash', 'base', 'files', 'state', 'deadline']) ||
    ![7, 8].includes(Object.keys(v).length) ||
    v.id !== id ||
    !uuidPattern.test(id) ||
    typeof v.project !== 'string' ||
    !idPattern.test(v.project) ||
    (v.scope !== undefined && v.scope !== 'primary') ||
    typeof v.configHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.configHash) ||
    !['open', 'committed', 'conflict', 'cancelled'].includes(v.state as string) ||
    !Number.isSafeInteger(v.deadline) ||
    !objectShape(v.base, ['revision', 'files', 'forgottenPaths', 'forgottenSources', 'reviewed']) ||
    Object.keys(v.base).length !== 5 ||
    typeof v.base.revision !== 'string' ||
    !revisionPattern.test(v.base.revision)
  )
    throw Error('Invalid retained view metadata')
  for (const files of [v.base.files, v.files]) {
    validateFiles(files, v.scope === 'primary' ? undefined : v.project)
    parseLedger(
      JSON.stringify({
        version: 2,
        sources: Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.sources])),
        forgottenPaths: v.base.forgottenPaths,
        forgottenSources: v.base.forgottenSources,
        reviewed: v.base.reviewed,
      }),
    )
  }
  return v as unknown as View
}
