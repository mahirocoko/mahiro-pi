// Root-private storage controller. Registered-owner identity is not human-save
// attestation, cryptography, or isolation against another same-UID extension.
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  ownUIBinding,
  publishOwnUIState,
  readOwnUIState,
  UIStorageError,
  type UIBinding,
} from '../claude-ui-state.ts'
import type { UIRevision } from '../claude-ui-preferences.ts'
import type { OwnUIOwner, UIStoredPreferences, UITicket } from '../claude-ui-owner.ts'

export function createOwnUIOwner(
  generation: object,
  access: (
    ctx: ExtensionContext,
    binding: UIBinding | undefined,
    operation: 'read' | 'write',
    paths: readonly string[],
  ) => void,
): OwnUIOwner {
  const tickets = new WeakMap<
    UITicket,
    {
      binding: UIBinding
      revision: UIRevision
      manager: ExtensionContext['sessionManager']
    }
  >()
  const view = (ctx: ExtensionContext, binding: UIBinding, revision: UIRevision): UIStoredPreferences => {
    const { palette, toolStyle, diffView, extraDetail } = revision.state
    const ticket = Object.freeze({ version: 1 as const })
    tickets.set(ticket, { binding, revision, manager: ctx.sessionManager })
    return Object.freeze({
      preferences: Object.freeze({ palette, toolStyle, diffView, extraDetail }),
      ticket,
    })
  }
  const protect = <T>(work: () => T): T => {
    try {
      return work()
    } catch (error) {
      if (error instanceof UIStorageError) throw error
      throw new UIStorageError('unavailable')
    }
  }
  return Object.freeze({
    version: 1 as const,
    generation,
    read(ctx: ExtensionContext) {
      return protect(() => {
        // Context/policy check precedes even fixed-binding filesystem inspection.
        access(ctx, undefined, 'read', [])
        const binding = ownUIBinding()
        access(ctx, binding, 'read', [])
        const revision = readOwnUIState(binding)
        access(ctx, binding, 'read', [])
        return view(ctx, binding, revision)
      })
    },
    save(ctx: ExtensionContext, ticket: UITicket, preferences: Parameters<OwnUIOwner['save']>[2]) {
      return protect(() => {
        access(ctx, undefined, 'write', [])
        const captured = ticket && tickets.get(ticket)
        if (!captured || captured.manager !== ctx.sessionManager) throw new UIStorageError('stale')
        const { binding, revision } = captured
        const next = publishOwnUIState(binding, revision.ticket, preferences, (paths = []) =>
          access(ctx, binding, 'write', paths),
        )
        tickets.delete(ticket)
        return view(ctx, binding, next)
      })
    },
  })
}
