import { randomUUID } from 'node:crypto'
import type { Plan } from './protocol.ts'

// Process-local references, NOT PID/generation/stage/digest authority. Never reconstructed
// from disk. No eviction of unknown owners. Each exact operation can execute at most once.
const roots = new Map<string, Map<string, { plan: Plan; nonce: string; drained: boolean }>>()
export function reserveExecutor(root: string, plan: Plan) {
  let owners = roots.get(root)
  if (!owners) {
    owners = new Map()
    roots.set(root, owners)
  }
  if (owners.has(plan.id) || owners.size >= 64)
    throw Error('Operation executor already reserved or capacity blocked')
  const owner = { plan, nonce: randomUUID(), drained: false }
  owners.set(plan.id, owner)
  return Object.freeze({
    nonce: owner.nonce,
    // Called only after every already-started canonical/native operation has joined.
    // Once sealed, publisher must never start another canonical mutation except exact lock removal.
    seal: () => {
      owner.drained = true
    },
  })
}
export function executorOwnsLock(root: string, id: string, digest: string, nonce: string): boolean {
  const owner = roots.get(root)?.get(id)
  return !!owner && owner.plan.digest === digest && owner.nonce === nonce && owner.drained === true
}
export function executorDrained(root: string, id: string, digest: string): boolean {
  const owner = roots.get(root)?.get(id)
  return !!owner && owner.plan.digest === digest && owner.drained === true
}
