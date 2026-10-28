import { createFilteredTools } from './filtered-config.mjs'
import { assertSecretPaths } from './secret-paths.mjs'

const FILTERED_TOOLS = new Set(['mh_npm_config', 'mh_env_config', 'mh_pypi_config', 'mh_certificate_info'])

// PSS alone resolves permissions. This host owns only recognized secret-path
// operands, four filtered inspectors and generation disposal fencing.
export function createGuardHost() {
  const controller = new AbortController()
  const tools = createFilteredTools(controller.signal)
  const complete = () =>
    !controller.signal.aborted &&
    tools.size === FILTERED_TOOLS.size &&
    [...FILTERED_TOOLS].every((name) => tools.has(name))
  if (!complete()) {
    controller.abort()
    throw new Error('Guard tool ABI incomplete')
  }
  return {
    tools,
    get healthy() {
      return complete()
    },
    async finalArgs(name, input, ctx) {
      if (controller.signal.aborted) throw new Error('Pi guard generation disposed; tool blocked')
      if (!complete()) throw new Error('Guard tool ABI incomplete; tool blocked')
      const args = structuredClone(input)
      assertSecretPaths(name, args, ctx.cwd)
      if (controller.signal.aborted) throw new Error('Pi guard generation disposed; tool blocked')
      if (!complete()) throw new Error('Guard tool ABI incomplete; tool blocked')
      return args
    },
    dispose() {
      if (controller.signal.aborted) return
      controller.abort()
    },
  }
}
