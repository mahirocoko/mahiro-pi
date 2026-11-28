import { join } from 'node:path'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { nodes } from '../kernel/registry.mjs'
import type { KernelRegistry } from '../kernel/types.ts'
import { resolveAgentDir } from '../setup.ts'
import { learningRoot, readActiveSkills, readScope } from './store.ts'

export type SkillView = Omit<ReturnType<typeof readActiveSkills>[number], 'path'>

// The human viewer uses the same live project and policy owner as the pilot.
// Its output never contains file paths, unselected revisions, or review data.
export async function createLearnedSkillReader(ctx: ExtensionContext) {
  try {
    const root = learningRoot(resolveAgentDir())
    const id = ctx.sessionManager.getSessionId()
    const registry = nodes as KernelRegistry
    const owner = registry.get(id)
    const inScope = () =>
      owner &&
      registry.get(id) === owner &&
      owner.isPrimarySession(ctx) &&
      ctx.isProjectTrusted() &&
      readScope(root, ctx.cwd)
    if (!inScope()) return undefined
    const { getPermissionsService } = await import('@gotgenes/pi-permission-system')
    return (): SkillView[] | undefined => {
      try {
        if (!inScope()) return undefined
        const pss = getPermissionsService(id)
        if (pss?.checkPermission('mh_skill_learning').state !== 'allow') return undefined
        const canRead = (path: string) =>
          ['read', 'path_read', 'external_directory_read'].every(
            (surface) => pss.checkPermission(surface, path).state === 'allow',
          )
        if (!canRead(join(root, 'catalog.json'))) return undefined
        return readActiveSkills(root, undefined, (_slug, path) => canRead(path)).map(
          ({ path: _path, ...skill }) => skill,
        )
      } catch {
        return undefined
      }
    }
  } catch {
    return undefined
  }
}
