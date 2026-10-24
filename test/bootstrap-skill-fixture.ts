// Minimal public optional-owner protocol fixture, not the external skills implementation.
// Paired git-commit bytes always come from this repository's canonical owner.
import fs from 'node:fs'
import path from 'node:path'

export function stagePublicSkillFixture(root: string, product: string) {
  const put = (name: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true, mode: 0o700 })
    fs.writeFileSync(path.join(root, name), text, { mode: 0o600 })
  }
  put('package.json', JSON.stringify({ name: 'public-test-skill-owner', private: true, type: 'module' }))
  put('.claude-plugin/marketplace.json', JSON.stringify({ name: 'public-test-skill-owner', plugins: [] }))
  put(
    'skills/recap/SKILL.md',
    '---\nname: recap\ndescription: Synthetic public fixture recap.\n---\nReport only explicit synthetic fixture receipts.\n',
  )
  fs.cpSync(path.join(product, 'skills/git-commit'), path.join(root, 'skills/git-commit'), {
    recursive: true,
  })
  put(
    'src/content-hash.ts',
    `
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
export function hashPath(root) {
  if (!fs.existsSync(root)) return null
  const rows = []
  function walk(file) {
    const stat = fs.lstatSync(file)
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name))
    } else if (stat.isFile()) rows.push([path.relative(root, file), fs.readFileSync(file, 'utf8')])
    else throw Error('Fixture owner refuses non-file payload')
  }
  walk(root)
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}
export const hashSkillPayload = hashPath
`,
  )
  put(
    'src/cli.ts',
    `
import fs from 'node:fs'
import path from 'node:path'
import { hashPath, hashSkillPayload } from './content-hash.ts'
const [mode, ...args] = process.argv.slice(2)
const names = args.slice(0, args.indexOf('--agent'))
const root = process.env.PI_CODING_AGENT_DIR
const sourceRepoPath = process.env.MAHIRO_SKILLS_REPO_ROOT
if (!root || !sourceRepoPath || !['plan', 'install', 'doctor'].includes(mode)) throw Error('Invalid fixture request')
const skills = names.map(name => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw Error('Invalid fixture skill')
  const source = path.join(sourceRepoPath, 'skills', name)
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) throw Error('Missing fixture skill')
  return { name, source, target: path.join(root, 'skills', name) }
})
if (mode === 'plan') console.log(JSON.stringify({ root, commands: [], skipped: [], skills }))
if (mode === 'doctor') console.log('[]')
if (mode === 'install') {
  const receiptPath = path.join(root, '.mahiro-skills/receipts/global-pi.json')
  const previous = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null
  for (const skill of skills) {
    if (fs.existsSync(skill.target)) throw Error('Fixture owner refuses target overwrite')
    fs.mkdirSync(path.dirname(skill.target), { recursive: true, mode: 0o700 })
    fs.cpSync(skill.source, skill.target, { recursive: true })
  }
  const installedSkills = [...new Set([...(previous?.installedSkills ?? []), ...names])]
  const receipt = {
    schemaVersion: 2, root, agent: 'pi', scope: 'global', sourceRepoPath,
    installedSkills, installedCommands: [],
    targetStates: installedSkills.map(name => ({ kind: 'skill', name,
      sourceHash: hashSkillPayload(path.join(sourceRepoPath, 'skills', name)),
      installedHash: hashPath(path.join(root, 'skills', name)),
    })),
  }
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(receiptPath, JSON.stringify(receipt), { mode: 0o600 })
  console.log(JSON.stringify({ status: 'completed' }))
}
`,
  )
}
