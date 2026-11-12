import { randomUUID } from 'node:crypto'

// Process-local references, NOT PID/generation/stage/digest authority. Never reconstructed
// from disk. No eviction of unknown owners. Each exact operation can execute at most once.
const roots = new Map()
export function reserveExecutor(root, plan) {
  let owners = roots.get(root)
  if (!owners) {
    owners = new Map()
    roots.set(root, owners)
  }
  if (owners.has(plan.id) || owners.size >= 64)
    throw Error('Operation executor already reserved or capacity blocked')
  const owner = { plan, nonce: randomUUID(), drained: false, lockStarted: false, contended: false }
  owners.set(plan.id, owner)
  return Object.freeze({
    nonce: owner.nonce,
    beginLock: () => {
      if (owner.drained || owner.lockStarted) throw Error('Publication executor sealed or started')
      owner.lockStarted = true
    },
    lockContended: () => {
      if (!owner.lockStarted || owner.drained || owner.contended) throw Error('Invalid lock lifecycle')
      owner.contended = true
    },
    // Called only after every already-started canonical/native operation has joined.
    // Once sealed, publisher must never start another canonical mutation except exact lock removal.
    seal: () => {
      owner.drained = true
    },
  })
}
export function executorOwnsLock(root, id, digest, nonce) {
  const owner = roots.get(root)?.get(id)
  return !!owner && owner.plan.digest === digest && owner.nonce === nonce && owner.drained === true
}
export function executorNeverStarted(root, id, digest) {
  const owner = roots.get(root)?.get(id)
  return (
    !!owner &&
    owner.plan.digest === digest &&
    owner.drained === true &&
    (owner.lockStarted === false || owner.contended === true)
  )
}
export function executorDrained(root, id, digest) {
  const owner = roots.get(root)?.get(id)
  return !!owner && owner.plan.digest === digest && owner.drained === true
}
