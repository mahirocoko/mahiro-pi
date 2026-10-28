import type { ExtensionAPI, ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { PermissionsService, PermissionDecisionEvent } from '@gotgenes/pi-permission-system'
import type { KernelNode, KernelRegistry } from '../kernel/types.ts'
import { nodes as sharedNodes } from '../kernel/registry.mjs'
import { createGuardHost } from './host.mjs'

const nodes = sharedNodes as KernelRegistry
const HELPER_DEFAULT_PATHS: Record<string, string> = {
  mh_npm_config: '.npmrc',
  mh_env_config: '.env',
  mh_pypi_config: '.pypirc',
}
const helperAccessPath = (fallback: string) => (input: Record<string, unknown>) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  if (Object.hasOwn(input, 'path')) {
    const value = input.path
    return typeof value === 'string' && value.length > 0 && !value.includes('\0') ? value : undefined
  }
  return fallback
}
const registerHelperExtractors = (service: PermissionsService | undefined) => {
  if (!service?.registerToolAccessExtractor) return
  for (const [name, fallback] of Object.entries(HELPER_DEFAULT_PATHS)) {
    if (service.getToolAccessExtractor?.(name)) continue
    service.registerToolAccessExtractor(name, helperAccessPath(fallback))
  }
}
const finalPathSurface = (name: string) =>
  name === 'write' ? 'path_write' : ['read', 'grep', 'find', 'ls'].includes(name) ? 'path_read' : 'path'
// Root consumes an already running kernel. It never publishes feature ABIs,
// initializes registry state, owns memory retirement or clears kernel nodes.
export default async function activate(pi: ExtensionAPI) {
  const sdk = await import('@earendil-works/pi-coding-agent')
  const { getPermissionsService } = await import('@gotgenes/pi-permission-system')
  const host = createGuardHost()
  const nativeFactory =
    <Params extends ToolDefinition['parameters'], Details, State>(
      factory: (cwd: string) => ToolDefinition<Params, Details, State>,
    ) =>
    (cwd: string) =>
      sdk.defineTool(factory(cwd))
  const nativeFactories = {
    read: nativeFactory(sdk.createReadToolDefinition),
    bash: nativeFactory(sdk.createBashToolDefinition),
    grep: nativeFactory(sdk.createGrepToolDefinition),
    find: nativeFactory(sdk.createFindToolDefinition),
    ls: nativeFactory(sdk.createLsToolDefinition),
    write: nativeFactory(sdk.createWriteToolDefinition),
    edit: nativeFactory(sdk.createEditToolDefinition),
  }
  let manager: ExtensionContext['sessionManager'] | undefined
  let node: KernelNode | undefined
  let registered = true
  const current = (ctx: ExtensionContext) =>
    registered && host.healthy && !!getPermissionsService(ctx.sessionManager.getSessionId())
  const guard = { healthy: () => registered && host.healthy }
  const execution = { finalArgs: host.finalArgs }
  const pathApprovals = new Map<string, number>()
  const approvalKey = (surface: string, value: string) => `${surface}\0${value}`
  const vetoFinalPath = (name: string, args: Record<string, unknown>, ctx: ExtensionContext) => {
    const service = getPermissionsService(ctx.sessionManager.getSessionId())
    registerHelperExtractors(service)
    const fallback = HELPER_DEFAULT_PATHS[name]
    const path = fallback
      ? helperAccessPath(fallback)(args)
      : typeof args.path === 'string'
        ? args.path
        : undefined
    if (!path || !service) return
    const surface = finalPathSurface(name)
    const decision = service.checkPermission(surface, path)
    if (decision?.matchedPattern === undefined || decision.state === 'allow') return
    if (decision.state === 'ask') {
      const key = approvalKey(surface, path)
      const left = pathApprovals.get(key) ?? 0
      if (left > 0) {
        if (left === 1) pathApprovals.delete(key)
        else pathApprovals.set(key, left - 1)
        return
      }
    }
    throw Error('Native final path permission denied')
  }
  for (const [name, factory] of Object.entries(nativeFactories)) {
    const native = factory(process.cwd())
    pi.registerTool({
      ...native,
      async execute(id, rawInput, signal, update, ctx) {
        const input = rawInput as Record<string, unknown>
        if (!current(ctx)) throw Error('Pi native guard unavailable; execution blocked')
        const classifier = ({ find: 'find_files', ls: 'list_dir' } as Record<string, string>)[name] ?? name
        const service = getPermissionsService(ctx.sessionManager.getSessionId())
        const rawCommand = input.command as string
        const rawApproval =
          name === 'bash'
            ? service?.consumeBashApproval?.({
                sessionManager: ctx.sessionManager,
                toolCallId: id,
                command: rawCommand,
              })
            : undefined
        const originAllowed = () =>
          rawApproval
            ? rawApproval(rawCommand)
            : getPermissionsService(ctx.sessionManager.getSessionId())?.checkPermission('bash', rawCommand)
                ?.state === 'allow'
        if (name === 'bash' && !originAllowed()) throw Error('Native final Bash permission denied')
        if (signal?.aborted) throw Error('Pi guard execution cancelled')
        const executionContext = { ...ctx, signal: signal ?? ctx.signal }
        const final = await host.finalArgs(classifier, input, executionContext)
        if (signal?.aborted || !current(ctx)) throw Error('Pi native guard retired; execution blocked')
        // Revalidate the original receipt/current policy after the owned path checks.
        if (name === 'bash' && !originAllowed()) throw Error('Native final Bash permission denied')
        if (name !== 'bash') vetoFinalPath(name, final, ctx)
        return native.execute(id, final, signal, update, ctx)
      },
    })
  }
  for (const tool of host.tools.values()) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_id, input, signal, _update, ctx) {
        if (!current(ctx)) throw Error('Pi native guard unavailable; execution blocked')
        const args = await host.finalArgs(tool.name, input, ctx)
        if (signal?.aborted || !current(ctx)) throw Error('Pi native guard retired; execution blocked')
        vetoFinalPath(tool.name, args, ctx)
        const result = await tool.run({ cwd: ctx.cwd, args, signal })
        if (result.status === 'error')
          throw Error(
            'error' in result && typeof result.error === 'string'
              ? result.error
              : 'Filtered configuration read failed.',
          )
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result }
      },
    })
  }
  pi.on('session_start', (_event, ctx) => {
    manager = ctx.sessionManager
    node = nodes.get(manager.getSessionId())
    if (node?.ownsContext?.(ctx)) {
      node.guard = guard
      node.execution = execution
    }
    registerHelperExtractors(getPermissionsService(manager.getSessionId()))
  })
  // The host and PSS own tool dispatch. Root applies final checks to actual
  // native execution; it does not maintain a second tool allowlist.
  const unsubscribes = [
    pi.events.on('permissions:ready', () => {
      if (manager) registerHelperExtractors(getPermissionsService(manager.getSessionId()))
    }),
    pi.events.on('permissions:decision', (data) => {
      const event = data as PermissionDecisionEvent | undefined
      if (
        event?.result !== 'allow' ||
        typeof event.value !== 'string' ||
        !['path', 'path_read', 'path_write'].includes(event.surface)
      )
        return
      const key = approvalKey(event.surface, event.value)
      pathApprovals.set(key, (pathApprovals.get(key) ?? 0) + 1)
    }),
  ]
  pi.on('turn_end', () => pathApprovals.clear())
  pi.on('session_shutdown', () => {
    registered = false
    host.dispose()
    pathApprovals.clear()
    if (node?.guard === guard) delete node.guard
    if (node?.execution === execution) delete node.execution
    for (const unsubscribe of unsubscribes) unsubscribe()
    // Kernel alone retires memory admission, joins workers and releases holds.
  })
}
