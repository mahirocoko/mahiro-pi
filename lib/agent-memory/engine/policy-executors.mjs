// Native MJS singleton survives TypeScript runtime generations. IDs locate only;
// only this module's actual by-reference producer/continuation proves drain.
const roots = new Map()
const limit = 64

export async function executePolicy(root, identity, run) {
  let owners = roots.get(root)
  if (!owners) {
    owners = new Map()
    roots.set(root, owners)
  }
  if (owners.size >= limit || owners.has(identity.operation)) throw Error('Policy executor capacity blocked')
  const state = { identity, owner: null, staging: null, drained: false, recovering: false }
  const reference = Object.freeze({
    identity,
    get owner() {
      return state.owner
    },
    get staging() {
      return state.staging
    },
    get drained() {
      return state.drained
    },
    get recovering() {
      return state.recovering
    },
  })
  owners.set(identity.operation, { state, reference })
  try {
    return await run((owner, staging) => {
      state.owner = owner
      state.staging = staging
    })
  } finally {
    // run joins all started native work AND handle closes, including finally.
    state.drained = true
  }
}

export function policyExecutor(root, operation) {
  return roots.get(root)?.get(operation)?.reference
}

export async function recoverPolicy(root, reference, run) {
  const entry = roots.get(root)?.get(reference.identity.operation)
  if (!entry || entry.reference !== reference || !entry.state.drained || entry.state.recovering)
    throw Error('Actual drained policy executor required')
  entry.state.recovering = true
  try {
    return await run()
  } finally {
    entry.state.recovering = false
  }
}

export function forgetPolicy(root, operation) {
  const owners = roots.get(root)
  owners?.delete(operation)
  if (!owners?.size) roots.delete(root)
}
