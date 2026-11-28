import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import {
  changeSkill,
  configureScope,
  describeSkills,
  learningRoot,
  readScope,
} from './lib/agent-skill-learning/store.ts'

const [action, profile, project, slug, exact, ...extra] = process.argv.slice(2)
if (
  extra.length ||
  !['enable', 'disable', 'status', 'rollback'].includes(action) ||
  !profile ||
  resolve(profile) !== profile ||
  !project ||
  resolve(project) !== project ||
  (action === 'rollback' ? !slug || !exact : slug !== undefined || exact !== undefined)
) {
  console.error(
    'Usage: node skill-learning.mjs enable|disable|status /canonical/profile /canonical/project\n       node skill-learning.mjs rollback /canonical/profile /canonical/project slug exact-current-revision',
  )
  process.exitCode = 2
} else {
  try {
    const root = learningRoot(profile)
    const inScope = () => readScope(root, project) === project
    if (action === 'enable' || action === 'disable') configureScope(profile, project, action === 'enable')
    const enabled = inScope()
    if (action === 'rollback') {
      if (!enabled) throw Error('Pilot not enabled for this project')
      const restored = changeSkill(
        root,
        { slug, expected: exact, evidence: randomBytes(32).toString('hex') },
        inScope,
      )
      console.log(JSON.stringify({ status: 'rolled-back', ...restored }))
    } else {
      console.log(
        JSON.stringify({
          enabled,
          active: enabled ? describeSkills(root).map(({ path: _path, ...skill }) => skill) : [],
        }),
      )
    }
  } catch (error) {
    console.error(
      error instanceof Error && !('code' in error) ? error.message : 'Skill pilot operation failed',
    )
    process.exitCode = 1
  }
}
