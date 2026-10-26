import { bytes, objectShape, validId } from '../../continuity/records.ts'
import {
  allowedPath,
  idPattern,
  limits,
  parseLedger,
  revisionPattern,
  uuidPattern,
  type Ledger,
} from './schema.ts'
export interface Ref {
  oid: string
  hash: string
  size: number
  sources: string[]
}
export interface Overlay extends Omit<Ref, 'oid'> {
  blob: string
  identity: string
}
export interface Base {
  revision: string
  refs: Record<string, Ref>
  ledger: Ledger
}
export interface Draft {
  version: 2
  id: string
  project: string
  shared: boolean
  configHash: string
  base: Base
  overlay: Record<string, Overlay | null>
  state: 'open' | 'ready' | 'conflict' | 'committed' | 'cancelled'
  deadline: number
}
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  objectShape(value, keys) && Object.keys(value).length === keys.length
function ref(value: unknown, overlay: boolean) {
  if (
    !exact(
      value,
      overlay ? ['blob', 'hash', 'size', 'sources', 'identity'] : ['oid', 'hash', 'size', 'sources'],
    ) ||
    typeof value.hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.hash) ||
    !Number.isSafeInteger(value.size) ||
    (value.size as number) < 0 ||
    (value.size as number) > limits.file ||
    !Array.isArray(value.sources) ||
    value.sources.length > 32 ||
    new Set(value.sources).size !== value.sources.length ||
    value.sources.some((s) => !validId(s))
  )
    throw Error('Invalid manifest reference')
  if (
    overlay
      ? typeof value.blob !== 'string' ||
        !uuidPattern.test(value.blob) ||
        typeof value.identity !== 'string' ||
        !/^[0-9:.+-]{1,256}$/.test(value.identity)
      : typeof value.oid !== 'string' || !revisionPattern.test(value.oid)
  )
    throw Error('Invalid manifest physical reference')
}
export function parseDraft(raw: string): Draft {
  if (bytes(raw) > 2 * 1024 * 1024) throw Error('Manifest bound exceeded')
  const d = JSON.parse(raw)
  if (
    !exact(d, ['version', 'id', 'project', 'shared', 'configHash', 'base', 'overlay', 'state', 'deadline']) ||
    d.version !== 2 ||
    typeof d.id !== 'string' ||
    !uuidPattern.test(d.id) ||
    typeof d.project !== 'string' ||
    !idPattern.test(d.project) ||
    typeof d.shared !== 'boolean' ||
    typeof d.configHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(d.configHash) ||
    !Number.isSafeInteger(d.deadline) ||
    (d.deadline as number) < 0 ||
    !['open', 'ready', 'conflict', 'committed', 'cancelled'].includes(d.state as string) ||
    !exact(d.base, ['revision', 'refs', 'ledger']) ||
    typeof d.base.revision !== 'string' ||
    !revisionPattern.test(d.base.revision) ||
    !objectShape(
      d.base.refs,
      Object.keys(d.base.refs && typeof d.base.refs === 'object' ? d.base.refs : {}),
    ) ||
    !objectShape(d.overlay, Object.keys(d.overlay && typeof d.overlay === 'object' ? d.overlay : {}))
  )
    throw Error('Invalid manifest metadata')
  const ledger = parseLedger(JSON.stringify(d.base.ledger))
  if (
    Object.keys(d.base.refs).length > limits.files ||
    Object.keys(d.overlay).length > limits.changes - 1 ||
    !d.base.refs['Core.md'] ||
    !d.base.refs['index.md']
  )
    throw Error('Invalid manifest layout')
  for (const [path, value] of Object.entries(d.base.refs)) {
    if (!allowedPath(path, d.shared ? undefined : d.project)) throw Error('Invalid manifest scope')
    ref(value, false)
    if (JSON.stringify((value as Ref).sources) !== JSON.stringify(ledger.sources[path]))
      throw Error('Invalid manifest provenance')
  }
  for (const [path, value] of Object.entries(d.overlay)) {
    if (
      !allowedPath(path, d.shared ? undefined : d.project) ||
      (value === null && ['Core.md', 'index.md'].includes(path))
    )
      throw Error('Invalid overlay scope/removal')
    if (value !== null) ref(value, true)
  }
  return d as unknown as Draft
}
