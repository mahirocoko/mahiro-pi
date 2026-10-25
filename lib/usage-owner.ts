// Closed public bridge: no caller paths, policy services, or provenance objects.
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { UsagePreferences } from './usage-preferences.ts'
export interface UsageTicket {
  readonly version: 1
}
export interface UsageStoredPreferences {
  readonly preferences: UsagePreferences
  readonly revision: string
  readonly present: boolean
  readonly ticket: UsageTicket
}
export interface UsageOwner {
  readonly version: 1
  readonly generation: object
  read(ctx: ExtensionContext): UsageStoredPreferences
  save(ctx: ExtensionContext, ticket: UsageTicket, preferences: UsagePreferences): UsageStoredPreferences
}
const guardKey = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
export function usageOwner(ctx: ExtensionContext): UsageOwner | undefined {
  const id = ctx.sessionManager?.getSessionId?.()
  if (!id) return undefined
  const node = (globalThis as any)[guardKey]?.get(id)
  const owner = node?.usage
  return node?.healthy?.() === true &&
    owner?.version === 1 &&
    owner.generation === node.generation &&
    typeof owner.read === 'function' &&
    typeof owner.save === 'function'
    ? owner
    : undefined
}
