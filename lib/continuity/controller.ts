import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { bytes, digest, type IRecord, normalize, objectShape, validId } from './records.ts'
import { excludedCwd, type IGuardNode, type IRuntimeConfig, parseProjects } from './runtime.ts'
import { assertPrivatePath, createStore, safeQuote } from './store.ts'
import { resolveAgentDir } from '../setup.ts'

interface IService {
  supportsInitialOutcomeClaim: true
  getAgentType(name: string):
    | {
        name: string
        toolNames?: readonly string[]
        model?: string
        thinking?: string
        runInBackground?: boolean
        inheritContext?: boolean
        locked?: true | readonly string[]
        promptMode: string
      }
    | undefined
  spawn(name: string, prompt: string, options: object): string
  getRecord(id: string): { id: string; status: string; result?: string } | undefined
  hasRunning(): boolean
  abort(id: string): boolean
}
const policy = {
  excludedProjectIds: [],
  excludedPaths: [],
}
const key = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
const read = (path: string, max: number) => {
  assertPrivatePath(path)
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > max || stat.mode & 0o077) throw new Error('Unavailable')
    const raw = readFileSync(fd, 'utf8')
    if (bytes(raw) > max) throw new Error('Unavailable')
    return raw
  } finally {
    closeSync(fd)
  }
}
export function decodeNotes(raw: string, records: readonly IRecord[]) {
  if (bytes(raw) > 8192) throw new Error('Result bound exceeded')
  const value = JSON.parse(raw)
  if (!objectShape(value, ['notes']) || !Array.isArray(value.notes) || value.notes.length > 8)
    throw new Error('Invalid notes')
  const seen = new Set<string>()
  return value.notes.map((note) => {
    if (
      !objectShape(note, ['recordId', 'quote']) ||
      !validId(note.recordId) ||
      !safeQuote(note.quote) ||
      seen.has(note.recordId)
    )
      throw new Error('Invalid note')
    const source = records.find((record) => record.id === note.recordId)
    if (!source || source.authority !== 'historical-user' || !source.text.includes(note.quote))
      throw new Error('Unconfirmed source')
    seen.add(note.recordId)
    return {
      recordId: source.id,
      projectId: source.projectId!,
      quote: note.quote,
      id: `note-${digest(`${source.id}:${note.quote}`)}`,
    }
  })
}

export function createController(pi: ExtensionAPI, config: IRuntimeConfig = {}) {
  let epoch = 0
  let active = false
  let outcome: string | undefined
  const observed = new Map<
    string,
    {
      text: string
      hash: string
      entryHash: string
      recordId: string
      projectId: string
      sessionId: string
      node: IGuardNode
      generation: unknown
    }
  >()
  let pending: { text: string; ids: string[] }[] = []
  let job: { id?: string; service: IService; stop: () => void } | undefined
  const cancelJob = () => {
    epoch++
    const own = job
    job = undefined
    if (own) {
      own.stop()
      if (own.id) own.service.abort(own.id)
    }
  }
  const cancel = () => {
    cancelJob()
    outcome = undefined
    pending = []
    observed.clear()
  }
  const guard = (ctx: ExtensionContext) => {
    if (!active || excludedCwd(ctx.cwd)) throw new Error('Learning unavailable')
    const nodes = config.nodes ?? (globalThis as Record<symbol, Map<string, IGuardNode>>)[key]
    const node = nodes?.get(ctx.sessionManager.getSessionId())
    const abi = node?.continuity
    if (
      !node?.healthy() ||
      abi?.version !== 1 ||
      abi.generation !== node.generation ||
      !abi.isPrimarySession?.(ctx) ||
      !abi.authorizeLearning ||
      ctx.signal?.aborted
    )
      throw new Error('Learning unavailable')
    const root = config.root ?? process.env.MAHIRO_CONTINUITY_ROOT ?? join(resolveAgentDir(), 'continuity')
    abi.authorizeLearning(ctx, root, root)
    return { node, abi, root }
  }
  const open = (ctx: ExtensionContext) => {
    const owner = guard(ctx)
    const token = epoch
    const manifestPath = join(owner.root, 'manifest.json')
    const raw = read(manifestPath, 65536)
    const cwd = realpathSync(ctx.cwd)
    const projectId = parseProjects(raw).projects.get(cwd) ?? digest(cwd)
    const current = (target = owner.root) => {
      const next = guard(ctx)
      if (
        epoch !== token ||
        next.node !== owner.node ||
        next.abi !== owner.abi ||
        next.root !== owner.root ||
        read(manifestPath, 65536) !== raw
      )
        throw new Error('Stale learning')
      owner.abi.authorizeLearning!(ctx, owner.root, target)
    }
    const store = createStore(owner.root, policy, {
      beforeRead: () => current(),
      beforeWrite: current,
      beforePointer: () => current(join(owner.root, 'state.json')),
    })
    return { ...owner, projectId, current, store }
  }
  pi.on('session_start', () => {
    cancel()
    active = true
  })
  pi.on('session_before_switch', cancel)
  pi.on('session_before_fork', cancel)
  pi.on('session_before_tree', cancel)
  pi.on('session_shutdown', () => {
    cancel()
    active = false
  })
  pi.on('input', (event, ctx) => {
    // No historical scan admits records: the baseline is captured at the observed hook.
    try {
      guard(ctx)
      if (
        !['interactive', 'rpc'].includes(event.source) ||
        event.images?.length ||
        !event.text.trim() ||
        bytes(event.text) > 12000
      )
        return
      if (job) cancelJob()
      pending.push({
        text: event.text,
        ids: ctx.sessionManager.getBranch().map((entry) => entry.id),
      })
      if (pending.length > 8) pending = []
    } catch {
      cancel()
    }
  })
  pi.on('agent_start', () => {
    if (job) cancelJob()
    outcome = undefined
  })
  pi.on('agent_before_settle', (event) => {
    outcome = event.outcome
    if (outcome !== 'completed') cancel()
  })
  pi.on('agent_settled', (event, ctx) => {
    if (event.aborted || outcome !== 'completed') {
      cancel()
      return
    }
    outcome = undefined
    const inputs = pending
    pending = []
    if (!inputs.length || job) return
    let release: (() => void) | undefined
    try {
      const f = open(ctx)
      const service = f.abi.parentService?.() as IService | undefined
      const role = service?.getAgentType?.('memory-reflector')
      if (
        service?.supportsInitialOutcomeClaim !== true ||
        !role ||
        role.name !== 'memory-reflector' ||
        role.model !== 'openai/gpt-6.1-sol' ||
        role.thinking !== 'medium' ||
        role.locked !== true ||
        role.promptMode !== 'replace' ||
        role.inheritContext !== false ||
        role.runInBackground !== true ||
        role.toolNames?.length !== 0
      )
        return
      const branch = ctx.sessionManager.getBranch()
      const sessionId = ctx.sessionManager.getSessionId()
      // Only still-attested sources survive into a later qualifying batch.
      for (const [entryId, source] of observed) {
        const entry = branch.find((entry) => entry.id === entryId)
        if (
          !entry ||
          source.node !== f.node ||
          source.generation !== f.node.generation ||
          source.sessionId !== sessionId ||
          source.projectId !== f.projectId ||
          digest(JSON.stringify(entry)) !== source.entryHash
        )
          observed.delete(entryId)
      }
      // Each hook is capped at 12 KiB; retain at most 32 unreviewed attestations.
      // Refuse new admission at capacity rather than evicting an unreviewed source.
      const candidates = inputs.slice(0, Math.max(0, 32 - observed.size))
      const admissions: Parameters<typeof observed.set>[] = []
      const imported = candidates.map((input) => {
        if (input.ids.some((id, i) => branch[i]?.id !== id)) throw new Error('Branch changed')
        const matches = branch
          .slice(input.ids.length)
          .filter(
            (entry) =>
              entry.type === 'message' &&
              entry.message.role === 'user' &&
              (typeof entry.message.content === 'string'
                ? entry.message.content === input.text
                : entry.message.content.length === 1 &&
                  entry.message.content[0].type === 'text' &&
                  entry.message.content[0].text === input.text),
          )
        if (matches.length !== 1) throw new Error('Ambiguous input')
        const entry = matches[0]
        const id = `pi-${digest(`${ctx.sessionManager.getSessionId()}:${entry.id}`)}`
        if (observed.has(entry.id)) throw new Error('Repeated input')
        admissions.push([
          entry.id,
          {
            text: input.text,
            hash: digest(input.text),
            entryHash: digest(JSON.stringify(entry)),
            recordId: id,
            projectId: f.projectId,
            sessionId,
            node: f.node,
            generation: f.node.generation,
          },
        ])
        return {
          id,
          sourceKind: 'pi_message' as const,
          projectId: f.projectId,
          conversationId: ctx.sessionManager.getSessionId(),
          messageId: entry.id,
          message: { message_type: 'user_message', content: input.text },
        }
      })
      const normalized = normalize(imported, policy).records
      if (
        normalized.length !== imported.length ||
        normalized.some((record, i) => record.text !== candidates[i].text)
      )
        return
      const assistantImports = branch
        .slice(candidates[0].ids.length)
        .filter(
          (entry): entry is Extract<typeof entry, { type: 'message' }> =>
            entry.type === 'message' && entry.message.role === 'assistant' && validId(entry.id),
        )
        .slice(-4)
        .flatMap((entry) => {
          const rawContent =
            'content' in entry.message ? (entry.message as { content?: unknown }).content : undefined
          const content =
            typeof rawContent === 'string'
              ? rawContent
              : Array.isArray(rawContent)
                ? rawContent
                    .filter(
                      (part: unknown): part is { type: 'text'; text: string } =>
                        !!part &&
                        typeof part === 'object' &&
                        (part as { type?: unknown }).type === 'text' &&
                        typeof (part as { text?: unknown }).text === 'string',
                    )
                    .map((part) => part.text)
                    .join('\n')
                : ''
          if (!content.trim() || bytes(content) > 12000) return []
          const item = {
            id: `pi-assistant-${digest(`${ctx.sessionManager.getSessionId()}:${entry.id}`)}`,
            sourceKind: 'pi_message' as const,
            projectId: f.projectId,
            conversationId: ctx.sessionManager.getSessionId(),
            messageId: entry.id,
            message: { message_type: 'assistant_message', content },
          }
          return normalize([item], policy).records.length === 1 ? [item] : []
        })
      release = f.store.acquireLease()
      f.current()
      f.store.ingest(f.store.snapshot(), [...imported, ...assistantImports])
      for (const [entryId, source] of admissions) observed.set(entryId, source)
      const snapshot = f.store.snapshot()
      const eligible = new Set([...observed.values()].map((source) => source.recordId))
      const delta = f.store.delta(snapshot, eligible)
      if (!delta.records.length) {
        release()
        return
      }
      const ancestry = branch.map((entry) => entry.id)
      const token = epoch
      let timer: ReturnType<typeof setTimeout> | undefined
      const unsubscribes: (() => void)[] = []
      const own = {
        service,
        id: undefined as string | undefined,
        stop: () => {
          if (timer) clearTimeout(timer)
          for (const unsubscribe of unsubscribes.splice(0)) unsubscribe()
          release?.()
        },
      }
      job = own
      const finish = () => {
        if (job !== own || !own.id) return
        const result = service.getRecord(own.id)
        if (!result || ['running', 'queued'].includes(result.status)) return
        job = undefined // Consume before any callback, including duplicate native events.
        try {
          f.current()
          if (
            epoch !== token ||
            f.abi.parentService?.() !== service ||
            result.status !== 'completed' ||
            typeof result.result !== 'string'
          )
            return
          const now = ctx.sessionManager.getBranch()
          if (ancestry.some((id, i) => now[i]?.id !== id)) return
          for (const source of delta.records) {
            const entry = now.find((entry) => entry.id === source.messageId)
            const attested = observed.get(source.messageId!)
            if (
              !entry ||
              !attested ||
              digest(JSON.stringify(entry)) !== attested.entryHash ||
              attested.hash !== source.hash ||
              digest(attested.text) !== source.hash
            )
              throw new Error('Source changed')
          }
          const notes = decodeNotes(result.result, delta.records)
          if (notes.length)
            f.store.accept(
              snapshot,
              { snapshot, cursor: delta.cursor, notes },
              'completed',
              notes.map((note) => note.id),
            )
          else f.store.markReviewed(snapshot, delta.cursor)
          for (const source of delta.records) observed.delete(source.messageId!)
        } catch {
          /* Failed or stale batches never advance the review cursor. */
        } finally {
          own.stop()
        }
      }
      unsubscribes.push(pi.events.on('subagents:completed', finish), pi.events.on('subagents:failed', finish))
      timer = setTimeout(() => {
        if (job === own) {
          job = undefined
          own.stop()
          if (own.id) service.abort(own.id)
        }
      }, 120000)
      timer.unref?.()
      own.id = service.spawn(
        'memory-reflector',
        JSON.stringify({
          records: delta.records.map(({ id, hash, projectId, text }) => ({
            id,
            hash,
            projectId,
            text,
          })),
        }),
        {
          foreground: false,
          bypassQueue: false,
          inheritContext: false,
          maxTurns: 2,
          claimOutcome: true,
        },
      )
      finish()
    } catch {
      if (job) {
        const own = job
        job = undefined
        own.stop()
        if (own.id) own.service.abort(own.id)
      } else release?.()
    }
  })
  if (pi.registerCommand) {
    for (const command of ['memory-status', 'memory-forget', 'memory-correct'] as const) {
      pi.registerCommand(command, {
        description: 'Manage current-project UNTRUSTED quoted notes; historical archives are retained',
        handler: async (args, ctx) => {
          try {
            cancel()
            const f = open(ctx)
            const facts = f.store.inspect().facts.filter((fact) => fact.projectId === f.projectId)
            if (command === 'memory-status') {
              ctx.ui.notify(
                JSON.stringify({
                  evidence: 'UNTRUSTED',
                  count: facts.length,
                  notes: facts.slice(-8).map(({ id, recordId, quote }) => ({
                    id,
                    recordId,
                    quote: quote.slice(0, 400),
                  })),
                }),
                'info',
              )
              return
            }
            const [id, recordId, ...quote] = args.trim().split(/\s+/)
            if (!facts.some((fact) => fact.id === id)) throw new Error('Unknown project note')
            if (command === 'memory-forget') {
              if (recordId) throw new Error('Expected one existing note ID')
              f.store.forget(f.store.snapshot(), [id])
            } else {
              const source = f.store.read(recordId, { projectId: f.projectId })
              if (!source || !quote.length) throw new Error('Retained source and literal quote required')
              f.store.correct(f.store.snapshot(), id, source.id, quote.join(' '))
            }
            ctx.ui.notify('Quoted note updated; historical archives are not erased.', 'info')
          } catch {
            ctx.ui.notify('Memory unavailable or invalid current-project citation.', 'warning')
          }
        },
      })
    }
  }
  return { cancel }
}
