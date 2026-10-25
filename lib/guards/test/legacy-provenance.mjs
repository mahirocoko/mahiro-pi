// Legacy unit-fixture compatibility, not runtime authority or dispatch policy.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createOwnedProvenance } from './legacy-owned-provenance.mjs'

// Compatibility exports for standalone SDK/source fixtures. Root uses its own
// current public registry readers; importing this module validates no dependency.
export { trustedNativeMcpTool } from './legacy-owned-provenance.mjs'
const defaultOwned = createOwnedProvenance()
export const {
  trustedRecallTool,
  trustedCodeMapTool,
  trustedEvidenceTool,
  uxWorkflowToolNames,
  trustedUXWorkflowTool,
  trustedExecutionRunTool,
  goalToolNames,
  trustedGoalTool,
  trustedMemoryTool,
  trustedTaskTool,
  trustedOwnUICommand,
  trustedUsageCommand,
  trustedRTKTool,
} = defaultOwned

const canonical = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}
const metaTools = new Set(['subagent', 'get_subagent_result', 'steer_subagent'])

// Resolve the declared owner only at its actual dispatch boundary. Neither
// builtin read/grep/bash nor a native dispatcher depends on its package version.
export function createMetaProvenance() {
  let entries
  const bindings = new Map()
  return (tool) => {
    if (!metaTools.has(tool?.name)) return false
    const source = tool.sourceInfo
    if (
      !source ||
      !['package', 'top-level'].includes(source.origin) ||
      !['user', 'project', 'temporary'].includes(source.scope)
    )
      return false
    if (!entries) {
      try {
        const require = createRequire(import.meta.url)
        let root = dirname(require.resolve('@gotgenes/pi-subagents'))
        while (!existsSync(join(root, 'package.json'))) {
          const parent = dirname(root)
          if (parent === root) return false
          root = parent
        }
        const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
        if (!Array.isArray(metadata.pi?.extensions)) return false
        entries = new Set(
          metadata.pi.extensions.flatMap((entry) => {
            const path = join(root, entry)
            return [path, canonical(path)].filter(Boolean)
          }),
        )
      } catch {
        return false
      }
    }
    const key = JSON.stringify(source)
    if (!bindings.has(key)) bindings.set(key, entries.has(source.path) || entries.has(canonical(source.path)))
    return bindings.get(key)
  }
}
export const trustedMetaTool = createMetaProvenance()
