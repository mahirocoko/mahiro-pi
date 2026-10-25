// One process-wide service registry, shared by native ESM and Pi's Jiti loaders.
// The stable symbol predates the kernel extraction; it is not guard authority.
const key = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
export const nodes = (globalThis[key] ??= new Map())
nodes.nativeChildren ??= new Set()
nodes.nativeParents ??= new Map()
nodes.memoryLeases ??= new Map()
const activations = (nodes.activations ??= new WeakSet())
export function claimKernel(api) {
  if (activations.has(api)) return false
  activations.add(api)
  return true
}
