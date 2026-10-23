import { Type, type Static } from 'typebox'
import { Check } from 'typebox/value'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'

export const QUEUE_MESSAGE = 'mahiro-queue-handoff'
const id = Type.String({ minLength: 1, maxLength: 80 })
const lane = Type.Union([Type.Literal('steer'), Type.Literal('followUp')])
const image = Type.Object(
  {
    type: Type.Literal('image'),
    mimeType: Type.String({ pattern: '^image/(png|jpeg|gif|webp)$' }),
    data: Type.String({ maxLength: 2800000, pattern: '^[A-Za-z0-9+/]*={0,2}$' }),
  },
  { additionalProperties: false },
)
const payload = { text: Type.String({ maxLength: 32000 }), images: Type.Array(image, { maxItems: 8 }) }
const operationSchema = Type.Union([
  Type.Object({ kind: Type.Literal('stage'), id, lane, ...payload }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('edit'), id, text: payload.text }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('remove-images'), id }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal('move'), id, lane, index: Type.Integer({ minimum: 0, maximum: 31 }) },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('attempt'), id, attemptId: id }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('discard'), id }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal('capture'), lane: Type.Union([lane, Type.Literal('off')]) },
    { additionalProperties: false },
  ),
])
export type QueueOperation = Static<typeof operationSchema>
export type QueueLane = Static<typeof lane>
export type QueueImage = Static<typeof image>
export type QueueRow = {
  id: string
  revision: number
  text: string
  images: QueueImage[]
  lane: QueueLane
  attemptId?: string
}
export type QueueState = { rows: QueueRow[]; capture: QueueLane | 'off'; imageBytesWritten: number }
export const emptyQueue = (): QueueState => ({ rows: [], capture: 'off', imageBytesWritten: 0 })
export const isQueueOperation = (value: unknown): value is QueueOperation => Check(operationSchema, value)
const imageBytes = (images: QueueImage[]) => images.reduce((sum, image) => sum + image.data.length, 0)
export function reduceQueue(state: QueueState, op: QueueOperation): QueueState {
  if (op.kind === 'capture') return { ...state, capture: op.lane }
  if (op.kind === 'stage') {
    if (state.rows.length >= 32)
      throw new Error('Staging is full (32 retained rows); discard reviewed rows first.')
    if (state.rows.some((r) => r.id === op.id)) throw new Error('Duplicate staging row ID.')
    if (!op.text.trim() && op.images.length === 0) throw new Error('A staged row needs text or an image.')
    const bytes = imageBytes(op.images)
    if (
      bytes > 2800000 ||
      state.rows.reduce((sum, row) => sum + imageBytes(row.images), 0) + bytes > 22400000 ||
      state.imageBytesWritten + bytes > 44800000
    )
      throw new Error(
        'Image staging limit exceeded; original input remains native. Per-row ~2MiB decoded, live ~16MiB, branch history ~32MiB.',
      )
    return {
      ...state,
      imageBytesWritten: state.imageBytesWritten + bytes,
      rows: [
        ...state.rows,
        { id: op.id, revision: 1, text: op.text, images: structuredClone(op.images), lane: op.lane },
      ],
    }
  }
  const row = state.rows.find((r) => r.id === op.id)
  if (!row) throw new Error('Staged row not found.')
  if (op.kind === 'discard') return { ...state, rows: state.rows.filter((r) => r !== row) }
  if (row.attemptId)
    throw new Error('Handed row is locked. Native receipt is not execution success; no automatic retry.')
  let replacement = { ...row, revision: row.revision + 1 }
  if (op.kind === 'attempt') replacement.attemptId = op.attemptId
  if (op.kind === 'edit') {
    if (!op.text.trim() && row.images.length === 0) throw new Error('A staged row needs text or an image.')
    replacement.text = op.text
  }
  if (op.kind === 'remove-images') {
    if (!row.text.trim()) throw new Error('Cannot remove the only content; discard the row instead.')
    replacement.images = []
  }
  if (op.kind === 'move') {
    replacement.lane = op.lane
    const rest = state.rows.filter((r) => r !== row)
    rest.splice(Math.min(op.index, rest.length), 0, replacement)
    return { ...state, rows: rest }
  }
  return { ...state, rows: state.rows.map((r) => (r === row ? replacement : r)) }
}

/** A native custom_message journal entry, NOT void send return, pending count or model completion. */
export function queueReceipts(entries: readonly SessionEntry[]) {
  const receipts = new Map<string, string>()
  for (const entry of entries) {
    if (entry.type !== 'custom_message' || entry.customType !== QUEUE_MESSAGE) continue
    const details = entry.details as { version?: unknown; rowId?: unknown; attemptId?: unknown } | undefined
    if (details?.version === 1 && typeof details.rowId === 'string' && typeof details.attemptId === 'string')
      receipts.set(`${details.rowId}:${details.attemptId}`, entry.id)
  }
  return receipts
}
export function queueStatus(row: QueueRow, receipts: ReadonlyMap<string, string>) {
  if (!row.attemptId) return 'staged' as const
  return receipts.has(`${row.id}:${row.attemptId}`) ? ('recorded' as const) : ('unconfirmed' as const)
}
