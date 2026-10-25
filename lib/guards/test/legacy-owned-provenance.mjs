// Retired identity classifier retained ONLY as a legacy unit-fixture helper.
// No production module may import this file. Kernel/host SDK tests own current behavior.
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const canonical = (value) => {
  try {
    return realpathSync(value)
  } catch {
    return undefined
  }
}
const sameSource = (a, b) =>
  !!a && !!b && ['origin', 'scope', 'source', 'path', 'baseDir'].every((key) => a[key] === b[key])

// Loaded resource identity, not a package-version or live-disk permission pin.
// Root supplies public registry readers. A remembered source binding never stands
// in for current registration, exposure, context or the effective PSS decision.
export function createOwnedProvenance(options = {}) {
  const continuityRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const pkg = JSON.parse(readFileSync(join(continuityRoot, 'package.json'), 'utf8'))
  if (!Array.isArray(pkg.pi?.extensions) || pkg.pi.extensions.some((entry) => typeof entry !== 'string'))
    throw Error('Pi guard: loaded resource manifest unavailable; reload this package')
  const entries = new Map(
    pkg.pi.extensions.map((entry) => {
      const path = join(continuityRoot, entry)
      return [entry, new Set([path, canonical(path)].filter(Boolean))]
    }),
  )
  // Capture installed symlink/resource aliases while the host binds the runtime,
  // not on every action against a possibly upgraded/relocated on-disk checkout.
  const bindings = new Map()
  const registry = typeof options.getTools === 'function' ? options.getTools : undefined
  function bindSource(source) {
    if (
      !source ||
      !['package', 'top-level'].includes(source.origin) ||
      !['user', 'project', 'temporary'].includes(source.scope) ||
      typeof source.path !== 'string'
    )
      return undefined
    const key = JSON.stringify(source)
    if (bindings.has(key)) return bindings.get(key)
    const resolved = canonical(source.path)
    const entry = [...entries].find(
      ([, paths]) => paths.has(source.path) || (resolved && paths.has(resolved)),
    )?.[0]
    bindings.set(key, entry)
    return entry
  }
  function bindRegistry() {
    for (const tool of registry?.() ?? []) bindSource(tool.sourceInfo)
    for (const command of options.getCommands?.() ?? []) bindSource(command.sourceInfo)
  }
  function current(tool) {
    if (!tool?.sourceInfo) return false
    if (!registry) return true // Standalone source fixtures have no host dispatcher.
    const matches = registry().filter((item) => item.name === tool.name)
    return (
      matches.length === 1 &&
      matches[0].exposure !== 'hidden' &&
      sameSource(matches[0].sourceInfo, tool.sourceInfo)
    )
  }
  /** @returns {tool is Pick<import('@earendil-works/pi-coding-agent').ToolInfo, 'name' | 'sourceInfo'>} */
  function fromEntry(tool, entry, names) {
    return (
      !!tool &&
      (!names || names.includes(tool.name)) &&
      current(tool) &&
      bindSource(tool.sourceInfo) === entry
    )
  }
  const uxWorkflowToolNames = Object.freeze([
    'mh_get_ux_workflow',
    'mh_create_ux_workflow',
    'mh_update_ux_workflow',
  ])
  const goalToolNames = Object.freeze(['mh_get_goal', 'mh_create_goal', 'mh_update_goal', 'mh_clear_goal'])
  /** @returns {tool is Pick<import('@earendil-works/pi-coding-agent').ToolInfo, 'name' | 'sourceInfo'>} */
  function trustedRecallTool(tool) {
    return fromEntry(tool, './extensions/mahiro-continuity.ts', ['recall_search', 'recall_read'])
  }
  /** @returns {tool is Pick<import('@earendil-works/pi-coding-agent').ToolInfo, 'name' | 'sourceInfo'>} */
  function trustedCodeMapTool(tool) {
    return fromEntry(tool, './extensions/mahiro-code-map.ts', ['mh_code_map'])
  }
  /** @returns {tool is Pick<import('@earendil-works/pi-coding-agent').ToolInfo, 'name' | 'sourceInfo'>} */
  function trustedEvidenceTool(tool) {
    return fromEntry(tool, './extensions/mahiro-code-evidence.ts', ['mh_code_evidence'])
  }
  /** @returns {tool is Pick<import('@earendil-works/pi-coding-agent').ToolInfo, 'name' | 'sourceInfo'>} */
  function trustedUXWorkflowTool(tool) {
    return fromEntry(tool, './extensions/mahiro-ux-workflow.ts', uxWorkflowToolNames)
  }
  /** @returns {tool is Pick<import('@earendil-works/pi-coding-agent').ToolInfo, 'name' | 'sourceInfo'>} */
  function trustedExecutionRunTool(tool) {
    return fromEntry(tool, './extensions/mahiro-execution-run.ts', ['mh_execution_run'])
  }
  /** @returns {tool is Pick<import('@earendil-works/pi-coding-agent').ToolInfo, 'name' | 'sourceInfo'>} */
  function trustedGoalTool(tool) {
    return fromEntry(tool, './extensions/mahiro-goal.ts', goalToolNames)
  }
  /** @returns {tool is Pick<import('@earendil-works/pi-coding-agent').ToolInfo, 'name' | 'sourceInfo'>} */
  function trustedMemoryTool(tool) {
    return fromEntry(tool, './extensions/mahiro-agent-memory.ts', [
      'agent_memory_read',
      'agent_memory_edit',
      'agent_memory_commit',
      'agent_memory_manage',
      'agent_memory_reflect',
    ])
  }
  /** @returns {tool is Pick<import('@earendil-works/pi-coding-agent').ToolInfo, 'name' | 'sourceInfo'>} */
  function trustedTaskTool(tool) {
    return fromEntry(tool, './extensions/mahiro-native-utilities.ts', [
      'mh_task_create',
      'mh_task_get',
      'mh_task_list',
      'mh_task_update',
    ])
  }
  /** @returns {tool is Pick<import('@earendil-works/pi-coding-agent').ToolInfo, 'name' | 'sourceInfo'>} */
  function trustedRTKTool(tool) {
    return fromEntry(tool, './lib/guards/index.ts', ['mh_rtk'])
  }
  function trustedCommand(commands, name, entry) {
    if (!Array.isArray(commands)) return false
    const matches = commands.filter((command) => command?.name === name)
    return (
      matches.length === 1 && matches[0].source === 'extension' && bindSource(matches[0].sourceInfo) === entry
    )
  }
  function trustedOwnUICommand(commands) {
    return trustedCommand(commands, 'mh-ui', './extensions/mahiro-claude-ui.ts')
  }
  function trustedUsageCommand(commands) {
    return trustedCommand(commands, 'mh-usage', './extensions/mahiro-status.ts')
  }
  function trustedRootTool(tool) {
    return fromEntry(tool, './lib/guards/index.ts')
  }
  function trustedOwnedTool(tool) {
    return current(tool) && bindSource(tool.sourceInfo)?.startsWith('./extensions/') === true
  }
  return Object.freeze({
    bindRegistry,
    trustedRootTool,
    trustedOwnedTool,
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
  })
}

// Current public builtin provenance, never a caller's tool name or attestation.
export function trustedNativeDispatcher(tool) {
  const source = tool?.sourceInfo
  return (
    ['codemode', 'tool_search'].includes(tool?.name) &&
    source?.path === `builtin:${tool.name === 'tool_search' ? 'tool-search' : tool.name}` &&
    source.source === 'builtin' &&
    source.origin === 'top-level' &&
    source.scope === 'temporary'
  )
}

// Root supplies a fresh public registry snapshot, not caller metadata. Admission
// continues into PSS; it is not cryptographic attestation against loaded code.
export function trustedNativeMcpTool(tools, activeTools, event) {
  if (!Array.isArray(tools) || !Array.isArray(activeTools) || typeof event?.toolName !== 'string')
    return false
  const matches = tools.filter((tool) => tool?.name === event.toolName)
  if (matches.length !== 1) return false
  const tool = matches[0]
  const source = tool.sourceInfo
  if (
    source?.path !== 'builtin:mcp' ||
    source.source !== 'builtin' ||
    source.origin !== 'top-level' ||
    source.scope !== 'temporary'
  )
    return false
  const nested = typeof event.parentToolCallId === 'string' && event.parentToolCallId.length > 0
  switch (tool.exposure) {
    case 'direct':
      return activeTools.includes(tool.name)
    case 'model-only':
      return !nested && activeTools.includes(tool.name)
    case 'codemode':
    case 'deferred':
      return nested || activeTools.includes(tool.name)
    default:
      return false
  }
}
