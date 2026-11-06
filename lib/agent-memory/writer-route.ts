import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { AgentTypeDescriptor } from '@gotgenes/pi-subagents'
import { readProfileMetadata } from './profile.ts'

export const writerThinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type WriterThinking = (typeof writerThinkingLevels)[number]
export interface WriterRoute {
  model: string
  thinking: WriterThinking
}
const source = fileURLToPath(new URL('../../agents/managed-memory-writer.md', import.meta.url))
export const writerDescriptorPath = (profile: string) => join(profile, 'agents/managed-memory-writer.md')
export function validateWriterRoute(model: unknown, thinking: unknown): WriterRoute {
  if (
    typeof model !== 'string' ||
    (model !== 'inherit' &&
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\/[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/.test(model)) ||
    !writerThinkingLevels.includes(thinking as WriterThinking)
  )
    throw Error('Exact provider/model-id or inherit and supported writer thinking required')
  return { model, thinking: thinking as WriterThinking }
}
export function validateWriterTemplate(text: string): WriterRoute {
  const canonical = readProfileMetadata(source, false)
  const match = /^---\n[\s\S]*?\n(?:model: ([^\n]+)\n)?thinking: ([^\n]+)\n/.exec(text)
  const model = match?.[1] ?? 'inherit'
  const normalize = (value: string) =>
    value.replace(/^model: [^\n]+\n(?=thinking:)/m, '').replace(/^thinking: [^\n]+$/m, 'thinking: @route')
  if (!canonical || !match || normalize(text) !== normalize(canonical))
    throw Error('Managed writer differs from canonical template; explicit owner review required')
  if (model === 'inherit' && /^model:/m.test(text))
    throw Error('Inherited writer model must omit the model slot')
  return validateWriterRoute(model, match[2])
}
export function renderWriterTemplate(route: WriterRoute, text = readProfileMetadata(source, false)!) {
  validateWriterTemplate(text)
  validateWriterRoute(route.model, route.thinking)
  return text
    .replace(/^model: [^\n]+\n/m, '')
    .replace(/^thinking:/m, `${route.model === 'inherit' ? '' : `model: ${route.model}\n`}thinking:`)
    .replace(/^thinking: [^\n]+$/m, `thinking: ${route.thinking}`)
}
export function installedWriter(profile: string, role?: AgentTypeDescriptor) {
  const text = readProfileMetadata(writerDescriptorPath(profile), false)
  if (!text) throw Error('Install the canonical managed-memory-writer role with an available route')
  const route = validateWriterTemplate(text)
  const tools = ['agent_memory_read', 'agent_memory_edit', 'agent_memory_commit']
  if (
    role &&
    (role.name !== 'managed-memory-writer' ||
      role.model !== (route.model === 'inherit' ? undefined : route.model) ||
      role.thinking !== route.thinking ||
      role.locked !== true ||
      role.promptMode !== 'replace' ||
      role.inheritContext !== false ||
      role.runInBackground !== true ||
      role.toolNames?.length !== tools.length ||
      tools.some((tool) => !role.toolNames!.includes(tool)))
  )
    throw Error(
      'Locked native writer must match the approved installed descriptor; reload after route changes',
    )
  return { ...route, text, body: text.replace(/^---\n[\s\S]*?\n---\n/, '') }
}

// Synchronous public catalog snapshots only: no auth lookup, fuzzy match, virtual
// selection or provider request. Only an omitted descriptor model follows the
// current primary model. Call again immediately at spawn, then pin the result.
export function preflightWriterRoute(ctx: ExtensionContext, route: WriterRoute) {
  validateWriterRoute(route.model, route.thinking)
  if (route.model === 'inherit') {
    if (!ctx.model || String(ctx.model.api) === 'pi-virtual')
      throw Error('Current primary physical writer model unavailable')
    route = {
      model: `${ctx.model.provider}/${ctx.model.id}`,
      thinking: ctx.model.reasoning ? route.thinking : 'off',
    }
    validateWriterRoute(route.model, route.thinking)
  }
  const slash = route.model.indexOf('/')
  const provider = route.model.slice(0, slash),
    id = route.model.slice(slash + 1)
  const registry = ctx.modelRegistry
  const exact = (model: { provider: string; id: string }) => model.provider === provider && model.id === id
  const physical = registry.getAll().filter(exact)
  const available = registry.getAvailable().filter(exact)
  const found = registry.find(provider, id)
  if (
    physical.length !== 1 ||
    available.length !== 1 ||
    !found ||
    !exact(found) ||
    String(found.api) === 'pi-virtual' ||
    // Virtual aliases are not physical catalog entries. The public resolver must
    // resolve to the catalog entry's actual API/base URL, not another model.
    found.api !== physical[0].api ||
    found.baseUrl !== physical[0].baseUrl ||
    available[0].api !== physical[0].api ||
    available[0].baseUrl !== physical[0].baseUrl
  )
    throw Error('Exact physical writer route unavailable; configure its provider or review install route')
  const model = physical[0]
  if (
    (route.thinking !== 'off' && !model.reasoning) ||
    model.thinkingLevelMap?.[route.thinking] === null ||
    (['xhigh', 'max'].includes(route.thinking) && model.thinkingLevelMap?.[route.thinking] === undefined)
  )
    throw Error('Writer thinking is unsupported by the selected physical model')
  return route
}
