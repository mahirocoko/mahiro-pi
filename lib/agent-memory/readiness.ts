import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { resolveAgentDir } from '../setup.ts'
import type { MemoryNode } from './runtime.ts'
import { installedWriter, preflightWriterRoute } from './writer-route.ts'
import { readMemorySelection } from './profile.ts'

export function memoryReadiness(pi: ExtensionAPI, ctx: ExtensionContext, node?: MemoryNode) {
  const causes: { state: 'Needs setup' | 'Denied'; cause: string; next: string }[] = []
  const add = (state: 'Needs setup' | 'Denied', cause: string, next: string) =>
    causes.push({ state, cause, next })
  let route: { model: string; thinking: string } | null = null
  const abi = node?.managedMemory
  let mode = abi?.version === 2 ? 'engine' : abi?.version === 1 ? 'legacy' : 'unknown'
  let root: string | undefined
  try {
    const profile = resolveAgentDir()
    const selection = readMemorySelection(profile)
    root = abi?.version === 2 ? abi.root : (selection?.root ?? `${profile}/memory`)
    mode = selection?.mode ?? mode
    if (mode === 'off')
      add(
        'Needs setup',
        'memory-engine-off',
        'Review the explicit profile engine selection, then start a fresh session; installation preserves off.',
      )
    const installed = installedWriter(profile)
    route = { model: installed.model, thinking: installed.thinking }
    const service = abi?.parentService()
    const role = service?.getAgentType('managed-memory-writer')
    if (!service || !role)
      add(
        'Needs setup',
        'native-writer-not-loaded',
        'Install package roles/resources and start a fresh session.',
      )
    else installedWriter(profile, role)
    preflightWriterRoute(ctx, installed)
  } catch {
    add(
      'Needs setup',
      'writer-or-selection-unavailable',
      'Review install prerequisites and the installed canonical writer route; configure that exact physical model or explicitly review --managed-writer-model/--managed-writer-thinking, then start a fresh session. No credentials were resolved.',
    )
  }
  if (!node?.healthy() || !abi)
    add(
      'Needs setup',
      'healthy-root-unavailable',
      'Install guarded public owners and start a fresh primary session.',
    )
  else if (root && mode !== 'off') {
    for (const name of ['agent_memory_read', 'agent_memory_manage', 'agent_memory_reflect']) {
      try {
        const tool = pi.getAllTools().find((entry) => entry.name === name)
        if (!tool || !abi.isPrimarySession(ctx)) throw Error('Primary tool required')
        abi.assertAccess(tool, ctx, root, name === 'agent_memory_read' ? 'read' : 'write')
      } catch {
        add(
          'Denied',
          `${name}-authority-unavailable`,
          name === 'agent_memory_reflect'
            ? 'Reflection is denied or awaits explicit permission. Manual memory can remain usable. Review only memory reflection/root/path policy through the public permission owner; do not enable historical quote-learning.'
            : 'Review exact memory tool/root/path authority through the public permission owner; no storage was accessed for this diagnosis.',
        )
      }
    }
  }
  return {
    readiness: causes.some((entry) => entry.state === 'Denied')
      ? 'Denied'
      : causes.length
        ? 'Needs setup'
        : 'Ready',
    causes: causes.slice(0, 5),
    route,
    engine: { abi: abi?.version ?? null, mode },
    automatic: 'unknown' as boolean | 'unknown',
    publication: 'unknown',
    contextActivation: 'next-primary-request',
    latestAttempt: 'unknown' as unknown,
    storage: 'not-read',
    semanticLearningProven: false,
  }
}
