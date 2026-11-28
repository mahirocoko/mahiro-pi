import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { assertSafeContainer } from '../feature-data.ts'

export const roles = ['implementer', 'verifier'] as const
export type Role = (typeof roles)[number]
export const isRole = (value: unknown): value is Role => roles.some((role) => value === role)
const slugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const hashPattern = /^[a-f0-9]{64}$/
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const maxChanges = 64
const maxFile = 24_576

interface IRevision {
  ref: string
  description: string
  roles: Role[]
}
interface IEntry {
  slug: string
  active: IRevision | null
  previous: IRevision | null
}
interface ICatalog {
  entries: IEntry[]
  changes: string[]
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const slug = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 48 && slugPattern.test(value)
const hash = (value: unknown): value is string => typeof value === 'string' && hashPattern.test(value)
const description = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\x00-\x1f\x7f]/.test(value)
const validRevision = (value: unknown): value is IRevision | null =>
  value === null ||
  (record(value) &&
    hash(value.ref) &&
    description(value.description) &&
    Array.isArray(value.roles) &&
    value.roles.length > 0 &&
    value.roles.length <= roles.length &&
    value.roles.every(isRole) &&
    new Set(value.roles).size === value.roles.length)
const validEntry = (value: unknown): value is IEntry =>
  record(value) && slug(value.slug) && validRevision(value.active) && validRevision(value.previous)

const privateDirectory = (path: string) => {
  assertSafeContainer(path)
  const info = lstatSync(path)
  if ((info.mode & 0o777) !== 0o700 || info.uid !== process.getuid?.()) throw Error('Unsafe skill store')
}
const ownFile = (path: string) => {
  const info = lstatSync(path)
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    (info.mode & 0o777) !== 0o600 ||
    info.uid !== process.getuid?.() ||
    info.size > maxFile
  )
    throw Error('Unsafe skill store file')
  return readFileSync(path, 'utf8')
}
const json = (path: string): unknown => JSON.parse(ownFile(path))
const ensureDir = (path: string) => {
  try {
    mkdirSync(path, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  privateDirectory(path)
}
const replace = (path: string, content: string, authorized?: (paths: string[]) => boolean) => {
  const temp = `${path}.${randomUUID()}.tmp`
  if (authorized && !authorized([path, temp])) throw Error('Skill staging path is not authorized')
  writeFileSync(temp, content, { flag: 'wx', mode: 0o600 })
  try {
    renameSync(temp, path)
  } finally {
    if (existsSync(temp)) unlinkSync(temp)
  }
}

export const learningRoot = (profile: string) => join(profile, 'preferences', 'agent-skill-learning')
export function readScope(root: string, cwd: string): string | undefined {
  try {
    privateDirectory(root)
    const value = json(join(root, 'scope.json'))
    return record(value) &&
      value.version === 1 &&
      value.enabled === true &&
      typeof value.project === 'string' &&
      value.project === realpathSync(cwd)
      ? value.project
      : undefined
  } catch {
    return undefined
  }
}

export function configureScope(profile: string, project: string, enabled: boolean) {
  assertSafeContainer(profile)
  assertSafeContainer(project)
  if (
    realpathSync(profile) !== profile ||
    realpathSync(project) !== project ||
    !existsSync(join(project, '.git'))
  )
    throw Error('A canonical Git project root and existing profile are required')
  const preferences = join(profile, 'preferences')
  if (!existsSync(preferences)) ensureDir(preferences)
  else assertSafeContainer(preferences)
  const root = learningRoot(profile)
  if (!enabled && !existsSync(root)) return
  ensureDir(root)
  const lock = join(root, 'publishing')
  mkdirSync(lock, { mode: 0o700 })
  try {
    const config = join(root, 'scope.json')
    if (existsSync(config)) {
      const saved = json(config)
      if (!record(saved) || saved.version !== 1 || saved.project !== project)
        throw Error('Skill pilot already belongs to a different project; nothing replaced')
    }
    replace(config, `${JSON.stringify({ version: 1, project, enabled })}\n`)
  } finally {
    rmdirSync(lock)
  }
}

function readCatalog(root: string): ICatalog {
  privateDirectory(root)
  const file = join(root, 'catalog.json')
  if (!existsSync(file)) return { entries: [], changes: [] }
  const value = json(file)
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.entries) ||
    value.entries.length > 1 ||
    !value.entries.every(validEntry) ||
    new Set(value.entries.map((entry) => entry.slug)).size !== value.entries.length ||
    !Array.isArray(value.changes) ||
    value.changes.length > maxChanges ||
    !value.changes.every(hash)
  )
    throw Error('Invalid skill catalog')
  return { entries: value.entries, changes: value.changes }
}

const revisionPath = (root: string, name: string, ref: string) =>
  join(root, 'revisions', ref, `mh-learned-${name}`, 'SKILL.md')

function assertRevision(root: string, name: string, ref: string) {
  const path = revisionPath(root, name, ref)
  privateDirectory(join(root, 'revisions'))
  privateDirectory(join(root, 'revisions', ref))
  privateDirectory(join(root, 'revisions', ref, `mh-learned-${name}`))
  if (digest(ownFile(path)) !== ref) throw Error('Skill content no longer matches the selected revision')
  return path
}

export function describeSkills(root: string, role?: Role, allowed?: (name: string, path: string) => boolean) {
  return readCatalog(root).entries.flatMap(({ slug: name, active }) => {
    if (!active || (role && !active.roles.includes(role))) return []
    if (allowed && !allowed(name, revisionPath(root, name, active.ref))) return []
    const path = assertRevision(root, name, active.ref)
    return [{ slug: name, ...active, path }]
  })
}

export interface ISkillChange {
  slug: string
  expected: string | null
  evidence: string
  targets?: Role[]
  description?: string
  instructions?: string
}

export function changeSkill(
  root: string,
  change: ISkillChange,
  authorized: (paths: string[], operation?: 'read' | 'write') => boolean,
) {
  if (!slug(change.slug) || (change.expected !== null && !hash(change.expected)) || !hash(change.evidence))
    throw Error('Invalid skill selector')
  const lock = join(root, 'publishing')
  privateDirectory(root)
  if (!authorized([root, lock, join(root, 'catalog.json')]))
    throw Error('Skill scope is no longer authorized')
  mkdirSync(lock, { mode: 0o700 })
  try {
    const catalog = readCatalog(root)
    const entry = catalog.entries.find((item) => item.slug === change.slug)
    if ((entry?.active?.ref ?? null) !== change.expected)
      throw Error('Skill revision changed; read status first')
    if (catalog.changes.includes(change.evidence)) throw Error('This evidence was already used')
    if (!entry && catalog.entries.length)
      throw Error('Revise the existing pilot skill instead of adding a second one')
    if (change.instructions !== undefined && catalog.changes.length >= maxChanges)
      throw Error('Skill pilot capacity reached')
    let next: IEntry
    if (change.instructions === undefined) {
      if (!entry?.active) throw Error('No active skill to roll back')
      if (entry.previous) {
        if (!authorized([revisionPath(root, change.slug, entry.previous.ref)], 'read'))
          throw Error('Previous revision is not authorized')
        assertRevision(root, change.slug, entry.previous.ref)
      }
      next = { slug: change.slug, active: entry.previous, previous: null }
    } else {
      const body = change.instructions.trim()
      if (
        !description(change.description) ||
        !body ||
        body.length > 2400 ||
        !Array.isArray(change.targets) ||
        !change.targets.length ||
        change.targets.length > roles.length ||
        !change.targets.every(isRole) ||
        new Set(change.targets).size !== change.targets.length ||
        (entry?.active && !entry.active.roles.every((item) => change.targets?.includes(item))) ||
        /[\x00-\x08\x0b-\x1f\x7f]|```|<\/?(?:script|system|instructions)\b|https?:\/\/|(?:^|\s)(?:~\/|\/(?:Users|home|var|private|etc)\/)|-----BEGIN |\b(?:sk-(?:proj-)?[a-z\d_-]{16,}|gh[pousr]_[a-z\d]{20,})\b/i.test(
          `${change.description}\n${body}`,
        )
      )
        throw Error('Skill must be bounded, project-safe Markdown for eligible roles')
      const name = `mh-learned-${change.slug}`
      const content = `---\nname: ${name}\ndescription: ${JSON.stringify(change.description)}\n---\n\n${body}\n`
      const ref = digest(content)
      if (
        entry?.active?.ref === ref &&
        roles.every((role) => entry.active?.roles.includes(role) === change.targets?.includes(role))
      )
        throw Error('Skill is unchanged')
      const path = revisionPath(root, change.slug, ref)
      const directories = [
        join(root, 'revisions'),
        join(root, 'revisions', ref),
        join(root, 'revisions', ref, name),
      ]
      if (!authorized([...directories, path])) throw Error('Skill scope is no longer authorized')
      for (const directory of directories) ensureDir(directory)
      if (existsSync(path)) {
        if (ownFile(path) !== content) throw Error('Existing skill revision changed')
      } else replace(path, content, authorized)
      next = {
        slug: change.slug,
        active: { ref, description: change.description, roles: change.targets },
        previous: entry?.active ?? null,
      }
    }
    const entries = [...catalog.entries.filter((item) => item !== entry), next]
    const file = join(root, 'catalog.json')
    const changes =
      change.instructions === undefined ? catalog.changes : [...catalog.changes, change.evidence]
    replace(file, `${JSON.stringify({ version: 1, entries, changes })}\n`, authorized)
    return { slug: next.slug, revision: next.active?.ref ?? null, roles: next.active?.roles ?? [] }
  } finally {
    rmdirSync(lock)
  }
}

export const skillEvidenceKey = (agent: string, verifier: string) => digest(JSON.stringify([agent, verifier]))
