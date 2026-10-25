import { createFilteredTools } from './filtered-config.mjs'
import { assertSecretPaths } from './secret-paths.mjs'
import activateAttribution from './mahiro-commit-attribution-guard.js'

const COMMIT_CHECK = 'mahiro-commit-attribution-guard'
const FILTERED_TOOLS = new Set(['mh_npm_config', 'mh_env_config', 'mh_pypi_config', 'mh_certificate_info'])

// Only the immutable commit factory remains active. Secret protection is a
// bounded path rule plus standalone filtered inspectors, not its old checker.
export function createGuardHost() {
  const controller = new AbortController()
  const checks = new Map()
  const tools = createFilteredTools(controller.signal)
  const transforms = new Set()
  const diagnostics = []
  const register = (map, key, value) => {
    if (map.has(key)) throw new Error(`Duplicate guard registration: ${key}`)
    map.set(key, value)
    return () => map.delete(key)
  }
  const host = {
    signal: controller.signal,
    capabilities: { permissions: true, tools: true, events: { tools: true } },
    permissions: {
      register: (entry) => {
        if (entry.id !== COMMIT_CHECK || typeof entry.check !== 'function')
          throw new Error('Unexpected canonical commit check registration')
        return register(checks, entry.id, entry.check)
      },
    },
    tools: {
      register: (tool) => {
        if (!FILTERED_TOOLS.has(tool.name) || typeof tool.run !== 'function')
          throw new Error('Unexpected canonical filtered tool registration')
        return register(tools, tool.name, tool)
      },
    },
    events: {
      on(name, handler) {
        if (name !== 'tool_start' || typeof handler !== 'function' || transforms.size)
          throw new Error(`Unsupported guard event: ${name}`)
        transforms.add(handler)
        return () => transforms.delete(handler)
      },
    },
    diagnostics: { report: (entry) => diagnostics.push(entry) },
  }
  const complete = () =>
    !controller.signal.aborted &&
    checks.size === 1 &&
    checks.has(COMMIT_CHECK) &&
    tools.size === FILTERED_TOOLS.size &&
    [...FILTERED_TOOLS].every((name) => tools.has(name)) &&
    transforms.size === 1 &&
    diagnostics.length === 0
  const disposers = []
  try {
    disposers.push(activateAttribution(host))
    if (!complete()) {
      throw new Error('Canonical guard ABI incomplete')
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose?.()
    controller.abort()
    throw error
  }
  return {
    tools,
    get healthy() {
      return complete()
    },
    async finalArgs(name, input, ctx) {
      if (controller.signal.aborted) throw new Error('Pi guard generation disposed; tool blocked')
      if (!complete()) throw new Error('Canonical guard ABI incomplete; tool blocked')
      let args = structuredClone(input)
      assertSecretPaths(name, args, ctx.cwd)
      const context = { cwd: ctx.cwd, memfs: { enabled: false } }
      for (const transform of transforms) {
        const result = await transform({ toolName: name, args, cwd: ctx.cwd }, context)
        if (result?.args) args = result.args
      }
      for (const check of checks.values()) {
        const verdict = await check({ phase: 'execution', toolName: name, args, cwd: ctx.cwd }, context)
        if (verdict !== undefined) throw new Error(verdict.reason || 'Canonical guard blocked tool')
      }
      if (controller.signal.aborted) throw new Error('Pi guard generation disposed; tool blocked')
      if (!complete()) throw new Error('Canonical guard ABI incomplete; tool blocked')
      return args
    },
    dispose() {
      if (controller.signal.aborted) return
      for (const dispose of disposers.reverse()) dispose?.()
      controller.abort()
    },
  }
}
