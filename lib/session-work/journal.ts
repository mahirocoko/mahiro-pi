import { randomUUID } from 'node:crypto'
import type { ExtensionAPI, ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent'

export type JournalTicket = { generation: number; revision: number }
type Envelope<Operation> = { version: 1; id: string; revision: number; operation: Operation }
type Owner = { retire(): void }
const key = Symbol.for('@mahirocoko/pi-session-work:owners')
const globals = globalThis as typeof globalThis & { [key]?: Map<string, Owner> }
const owners = (globals[key] ??= new Map<string, Owner>())
const MAX_OPERATIONS = 10000

/** Public branch journal only. No files, profile settings, native queue internals or worker execution. */
export function createBranchJournal<State, Operation>(
  pi: ExtensionAPI,
  namespace: string,
  empty: () => State,
  validate: (value: unknown) => value is Operation,
  reduce: (state: State, operation: Operation) => State,
) {
  let state = empty()
  let revision = 0
  let generation = 0
  let scanned = 0
  let lastId: string | undefined
  let manager: ExtensionContext['sessionManager'] | undefined
  let ownerId: string | undefined
  let disposed = false
  let entries: SessionEntry[] = []
  const owner: Owner = {
    retire() {
      disposed = true
      generation++
      if (ownerId && owners.get(ownerId) === owner) owners.delete(ownerId)
      manager = undefined
      state = empty()
      entries = []
    },
  }
  pi.on('session_start', (_event, ctx) => {
    if (disposed || manager) return
    manager = ctx.sessionManager
    ownerId = `${namespace}:${manager.getSessionId()}`
    owners.get(ownerId)?.retire()
    owners.set(ownerId, owner)
    generation++
  })
  const invalidate = () => {
    generation++
  }
  pi.on('session_before_switch', invalidate)
  pi.on('session_before_fork', invalidate)
  pi.on('session_before_tree', invalidate)
  pi.on('session_shutdown', () => owner.retire())

  function assertCurrent(ctx: ExtensionContext, ticket?: JournalTicket) {
    if (
      disposed ||
      !manager ||
      ctx.sessionManager !== manager ||
      !ownerId ||
      owners.get(ownerId) !== owner ||
      ctx.signal?.aborted ||
      (ticket && (ticket.generation !== generation || ticket.revision !== revision))
    )
      throw new Error('Session work changed or retired; reopen the current view before writing.')
  }
  function read(ctx: ExtensionContext) {
    assertCurrent(ctx)
    entries = ctx.sessionManager.getBranch()
    // Native entries are immutable tree nodes. A different prefix means actual tree navigation.
    if (scanned > entries.length || (scanned > 0 && entries[scanned - 1]?.id !== lastId)) {
      state = empty()
      revision = 0
      scanned = 0
      generation++
    }
    for (; scanned < entries.length; scanned++) {
      const entry = entries[scanned]
      if (entry.type !== 'custom' || entry.customType !== namespace) continue
      const data = entry.data as Partial<Envelope<unknown>> | undefined
      if (
        !data ||
        data.version !== 1 ||
        typeof data.id !== 'string' ||
        data.revision !== revision + 1 ||
        !validate(data.operation)
      )
        throw new Error(`Invalid ${namespace} journal; no automatic repair or overwrite.`)
      state = reduce(state, data.operation)
      revision++
    }
    lastId = entries.at(-1)?.id
    return { state, ticket: { generation, revision }, entries }
  }
  function write(ctx: ExtensionContext, operation: Operation, ticket: JournalTicket) {
    read(ctx)
    assertCurrent(ctx, ticket)
    if (revision >= MAX_OPERATIONS) throw new Error('Session work journal is full; start a new session.')
    if (!validate(operation)) throw new Error('Invalid session work operation.')
    // Validate the transition before recording. Never update local state on failed append.
    reduce(state, operation)
    const data: Envelope<Operation> = { version: 1, id: randomUUID(), revision: revision + 1, operation }
    pi.appendEntry(namespace, data)
    const view = read(ctx)
    if (
      view.ticket.revision !== data.revision ||
      !view.entries.some(
        (entry) =>
          entry.type === 'custom' &&
          entry.customType === namespace &&
          (entry.data as Partial<Envelope<unknown>> | undefined)?.id === data.id,
      )
    )
      throw new Error('Session journal did not record intent; original input must remain native.')
    return view
  }
  const active = (ctx: ExtensionContext) => {
    try {
      assertCurrent(ctx)
      return true
    } catch {
      return false
    }
  }
  return { read, write, assertCurrent, active }
}
