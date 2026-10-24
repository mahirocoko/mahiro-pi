import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createAgentMemoryRuntime, type MemoryNode, type RuntimeConfig } from './runtime.ts'
import { createExperimentalMemoryRuntime } from './experimental-runtime.ts'

type Handler = (event: never, ctx: ExtensionContext) => unknown
// ExtensionAPI.on is overloaded; the proxy retains that public signature while
// collecting heterogeneous handlers. Only the selected handler returns to Pi.
type EventName = Parameters<ExtensionAPI['on']>[0]

export function createAgentMemoryRouter(pi: ExtensionAPI, config: RuntimeConfig = {}) {
  let mode: 1 | 2 | undefined
  let pinned: MemoryNode | undefined
  const key = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
  const handlers = new Map<EventName, Map<1 | 2, Handler[]>>()
  const filtered = (expected: 1 | 2): ExtensionAPI =>
    new Proxy(pi, {
      get(target, property, receiver) {
        if (property !== 'on') return Reflect.get(target, property, receiver)
        return (event: EventName, handler: Handler) => {
          let routes = handlers.get(event)
          if (!routes) {
            routes = new Map()
            handlers.set(event, routes)
          }
          let callbacks = routes.get(expected)
          if (!callbacks) {
            callbacks = []
            routes.set(expected, callbacks)
          }
          callbacks.push(handler)
          return () => {
            const index = callbacks.indexOf(handler)
            if (index >= 0) callbacks.splice(index, 1)
          }
        }
      },
    })
  // Construct during factory load, never during session_start dispatch.
  const legacy = createAgentMemoryRuntime(filtered(1), config)
  const experimental = createExperimentalMemoryRuntime(filtered(2))
  const selected = () => {
    if (mode === 1) return legacy
    if (mode === 2) return experimental
    throw Error('Managed memory runtime ABI unavailable')
  }
  for (const [event, routes] of handlers) {
    const dispatch = async (data: never, ctx: ExtensionContext) => {
      if ((event as string) === 'session_start') {
        const nodes = config.nodes ?? (globalThis as Record<symbol, Map<string, MemoryNode>>)[key]
        const node = nodes?.get(ctx.sessionManager.getSessionId())
        const next =
          node?.healthy() && (node.managedMemory?.version === 1 || node.managedMemory?.version === 2)
            ? node.managedMemory.version
            : undefined
        if (mode !== undefined && (mode !== next || pinned !== node)) await selected().cancel()
        mode = next
        pinned = node
      }
      if (mode === undefined) return
      let result: unknown
      for (const handler of routes.get(mode) ?? []) result = await handler(data, ctx)
      return result
    }
    // Exactly one public registration per hook. Inactive routes cannot overwrite
    // a selected prompt transformation or register late lifecycle callbacks.
    pi.on(event, dispatch as Parameters<ExtensionAPI['on']>[1])
  }
  return {
    run: (...args: Parameters<typeof legacy.run>) => selected().run(...args),
    cancel: () => selected().cancel(),
    startWriter: (...args: Parameters<typeof legacy.startWriter>) => selected().startWriter(...args),
    status: () => selected().status(),
  }
}
