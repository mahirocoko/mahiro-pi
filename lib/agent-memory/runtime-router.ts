import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createAgentMemoryRuntime, type MemoryNode, type RuntimeConfig } from './runtime.ts'
import { createExperimentalMemoryRuntime } from './experimental-runtime.ts'
import { memoryReadiness } from './readiness.ts'
import { memoryFailureCode } from './reasons.ts'

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
  const diagnose = async (ctx: ExtensionContext, primaryOnly = false) => {
    const node = (config.nodes ?? (globalThis as Record<symbol, Map<string, MemoryNode>>)[key])?.get(
      ctx.sessionManager.getSessionId(),
    )
    if (primaryOnly && !node?.managedMemory?.isPrimarySession(ctx))
      throw Error('Primary memory management required')
    const readiness = memoryReadiness(pi, ctx, node)
    if (mode === undefined || readiness.engine.mode === 'off') return readiness
    if (
      readiness.causes.some((entry) =>
        [
          'agent_memory_read-authority-unavailable',
          'agent_memory_manage-authority-unavailable',
          'healthy-root-unavailable',
        ].includes(entry.cause),
      )
    )
      return { ...readiness, storage: 'unavailable' }
    // Public prerequisite diagnosis never depends on denied storage. Only the
    // normal Root-authorized operation may add private lifecycle information.
    try {
      const data = (await selected().run('agent_memory_manage', { action: 'status' }, ctx)) as Record<
        string,
        unknown
      >
      return {
        ...readiness,
        ...data,
        storage: 'authorized',
        readiness: readiness.readiness,
        causes: readiness.causes,
      }
    } catch (error) {
      const failure = memoryFailureCode(error)
      let storageCapacity: unknown
      if (mode === 2 && failure.reason === 'capacity') {
        try {
          storageCapacity = await experimental.capacityDiagnostic(ctx)
        } catch {
          // The primary storage failure remains authoritative; diagnostic absence is unknown.
        }
      }
      return {
        ...readiness,
        readiness: readiness.readiness === 'Ready' ? 'Needs setup' : readiness.readiness,
        causes: [
          ...readiness.causes,
          {
            state: 'Needs setup',
            cause: 'storage-status-unavailable',
            next: 'Readiness could not certify the existing store; preserve it and review authorized storage/CAS/recovery diagnostics, never reseed.',
          },
        ].slice(0, 5),
        storage: 'unavailable',
        storageReason: failure.reason,
        ...(storageCapacity === undefined ? {} : { storageCapacity }),
        publication: 'unknown',
      }
    }
  }
  return {
    run: (...args: Parameters<typeof legacy.run>) =>
      args[0] === 'agent_memory_manage' &&
      args[1] &&
      typeof args[1] === 'object' &&
      'action' in args[1] &&
      args[1].action === 'status' &&
      Object.keys(args[1]).length === 1
        ? diagnose(args[2], true)
        : selected().run(...args),
    diagnose,
    captureInvocation: (ctx: ExtensionContext) => {
      if (mode !== 2) throw Error('ABI2 invocation context unavailable')
      return experimental.captureInvocation(ctx)
    },
    knowledgeHistory: (ctx: ExtensionContext, offset: number) => {
      if (mode !== 2) throw Error('ABI2 knowledge history unavailable')
      return experimental.knowledgeHistory(ctx, offset)
    },
    capturePalaceContext: (ctx: ExtensionContext) => {
      if (mode !== 2) throw Error('ABI2 Palace context unavailable')
      return experimental.capturePalaceContext(ctx)
    },
    openPalaceViewer: (ctx: ExtensionContext) => {
      if (mode !== 2) throw Error('ABI2 Palace HTML unavailable')
      return experimental.openPalaceViewer(ctx)
    },
    closePalaceViewer: () => {
      if (mode !== 2) throw Error('ABI2 Palace HTML unavailable')
      return experimental.closePalaceViewer()
    },
    cancel: () => selected().cancel(),
    startWriter: (...args: Parameters<typeof legacy.startWriter>) => selected().startWriter(...args),
    status: () => selected().status(),
  }
}
