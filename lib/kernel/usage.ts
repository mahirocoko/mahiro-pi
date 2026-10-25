// Root-private storage controller. Registered-owner identity is not human-save
// attestation, cryptography, or isolation against another same-UID extension.
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  usageBinding,
  publishUsageState,
  readUsageState,
  UsageStorageError,
  type UsageBinding,
} from '../usage-state.ts'
import type { UsageRevision } from '../usage-preferences.ts'
import type { UsageOwner, UsageStoredPreferences, UsageTicket } from '../usage-owner.ts'

export function createUsageOwner(
  generation: object,
  access: (
    ctx: ExtensionContext,
    binding: UsageBinding | undefined,
    operation: 'read' | 'write',
    paths: readonly string[],
  ) => void,
): UsageOwner {
  const tickets = new WeakMap<
    UsageTicket,
    {
      binding: UsageBinding
      revision: UsageRevision
      manager: ExtensionContext['sessionManager']
    }
  >()
  const view = (
    ctx: ExtensionContext,
    binding: UsageBinding,
    revision: UsageRevision,
  ): UsageStoredPreferences => {
    const { codex, sequence } = revision.state
    const ticket = Object.freeze({ version: 1 as const })
    tickets.set(ticket, { binding, revision, manager: ctx.sessionManager })
    return Object.freeze({
      preferences: Object.freeze({ codex }),
      revision: revision.ticket,
      present: sequence > 0,
      ticket,
    })
  }
  const protect = <T>(work: () => T): T => {
    try {
      return work()
    } catch (error) {
      if (error instanceof UsageStorageError) throw error
      throw new UsageStorageError('unavailable')
    }
  }
  return Object.freeze({
    version: 1 as const,
    generation,
    read(ctx: ExtensionContext) {
      return protect(() => {
        // Context/policy check precedes even fixed-binding filesystem inspection.
        access(ctx, undefined, 'read', [])
        const binding = usageBinding()
        access(ctx, binding, 'read', [])
        const revision = readUsageState(binding)
        access(ctx, binding, 'read', [])
        return view(ctx, binding, revision)
      })
    },
    save(ctx: ExtensionContext, ticket: UsageTicket, preferences: Parameters<UsageOwner['save']>[2]) {
      return protect(() => {
        access(ctx, undefined, 'write', [])
        const captured = ticket && tickets.get(ticket)
        if (!captured || captured.manager !== ctx.sessionManager) throw new UsageStorageError('stale')
        const { binding, revision } = captured
        tickets.delete(ticket) // Every explicit attempt consumes its identity-bound ticket.
        const next = publishUsageState(binding, revision.ticket, preferences, (paths = []) =>
          access(ctx, binding, 'write', paths),
        )
        return view(ctx, binding, next)
      })
    },
  })
}
