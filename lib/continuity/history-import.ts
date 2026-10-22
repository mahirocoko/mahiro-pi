import { bytes, digest, normalize, type IImport, type IPolicy, type IRecord } from './records.ts'

export interface ITranscriptSource {
  agentId: string
  conversationId: string
  projectId: string | null
  path: string
}

export interface ITranscriptProjection {
  records: IRecord[]
  reason: string
  excludeConversation?: boolean
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// One-time, pinned native JSONL data adapter. Never imports runtime internals,
// traverses metadata/tool payloads or claims that imported messages are Pi events.
export const projectTranscriptEntry = (
  entry: unknown,
  source: ITranscriptSource,
  policy: IPolicy,
): ITranscriptProjection => {
  const skipped = (reason: string): ITranscriptProjection => ({
    records: [],
    reason,
  })
  if (
    !object(entry) ||
    entry.type !== 'message' ||
    typeof entry.id !== 'string' ||
    typeof entry.timestamp !== 'string' ||
    !object(entry.message)
  )
    return skipped('non-message-or-unsupported-entry')
  const message = entry.message
  if (message.role !== 'user' && message.role !== 'assistant') return skipped('non-visible-role')
  if (message.role === 'assistant' && (message.stopReason === 'error' || message.stopReason === 'aborted'))
    return skipped('failed-assistant')
  if (!Array.isArray(message.content)) return skipped('unsupported-content')
  const content = message.content.flatMap((part) =>
    object(part) && part.type === 'text' && typeof part.text === 'string'
      ? [{ type: 'text', text: part.text }]
      : [],
  )
  if (!content.length) return skipped('no-visible-text')
  if (content.reduce((sum, part) => sum + bytes(part.text), 0) > 65536)
    return skipped('visible-message-byte-bound')
  const input: IImport = {
    id: `letta-${digest(`${source.agentId}:${source.conversationId}:${entry.id}`).slice(0, 40)}`,
    sourceKind: 'letta_message',
    agentId: source.agentId,
    conversationId: source.conversationId,
    messageId: typeof message.id === 'string' ? message.id : entry.id,
    projectId: source.projectId,
    path: source.path,
    date: entry.timestamp,
    message: {
      message_type: message.role === 'user' ? 'user_message' : 'assistant_message',
      content,
    },
  }
  try {
    const result = normalize([input], policy)
    if (!result.records.length) return skipped(result.quarantine[0]?.reason ?? 'no-visible-record')
    // Future imports have no project-name ban. This does not restore previously
    // quarantined conversations or forgotten records.
    // Return only screened records, never the original wrapped text input.
    return { records: result.records, reason: 'accepted-visible-text' }
  } catch {
    return skipped('invalid-or-bounded-visible-record')
  }
}
