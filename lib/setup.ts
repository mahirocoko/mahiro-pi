import { isUtf8 } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { assertPrivatePath } from './continuity/store.ts'

const MAX_BYTES = 1024 * 1024
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const action = (value: unknown) => ['allow', 'ask', 'deny'].includes(value as string)
const patternAction = (value: unknown) =>
  action(value) ||
  (object(value) &&
    value.action === 'deny' &&
    Object.keys(value).every((key) => ['action', 'reason'].includes(key)) &&
    (value.reason === undefined || (typeof value.reason === 'string' && value.reason.length <= 500)))
const surface = (value: unknown) =>
  action(value) ||
  (object(value) &&
    Object.entries(value).every(([key, decision]) => key.length > 0 && patternAction(decision)))
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

// Deliberately bounded to the public 40.2.2 config shape; unknown future fields
// require review rather than silently modifying a profile this setup cannot validate.
const validate: (config: unknown) => asserts config is Record<string, unknown> = (config) => {
  if (!object(config)) throw new Error('Unsupported permission config')
  const booleans = ['debugLog', 'permissionReviewLog', 'yoloMode', 'doublePressToConfirm']
  const integers = [
    'forwardingTimeoutMs',
    'promptTimeoutMs',
    'promptMaxRows',
    'promptFieldMaxWidth',
    'reviewLogFieldMaxWidth',
    'toolInputPreviewMaxLength',
    'toolTextSummaryMaxLength',
  ]
  for (const [key, value] of Object.entries(config)) {
    let valid = false
    if (key === '$schema') valid = typeof value === 'string'
    if (booleans.includes(key)) valid = typeof value === 'boolean'
    if (integers.includes(key)) valid = typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    if (['piInfrastructureReadPaths', 'authorizerChain'].includes(key))
      valid = Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
    if (key === 'promptNotifications')
      valid = Array.isArray(value) && value.every((item) => ['bell', 'osc9', 'osc777'].includes(item))
    if (key === 'permissionDialogKeys')
      valid =
        object(value) &&
        Object.entries(value).every(
          ([name, binding]) =>
            ['approve', 'approveSession', 'approveSessionBoth', 'deny', 'denyWithReason'].includes(name) &&
            typeof binding === 'string',
        )
    if (key === 'shellTools')
      valid =
        object(value) &&
        Object.entries(value).every(
          ([name, mapping]) =>
            name.length > 0 &&
            object(mapping) &&
            typeof mapping.commandArgument === 'string' &&
            mapping.commandArgument.length > 0 &&
            Object.keys(mapping).every((field) => ['commandArgument', 'workdirArgument'].includes(field)) &&
            (mapping.workdirArgument === undefined ||
              (typeof mapping.workdirArgument === 'string' && mapping.workdirArgument.length > 0)),
        )
    if (key === 'permission')
      valid =
        object(value) &&
        Object.entries(value).every(
          ([name, decision]) =>
            name.length > 0 &&
            (!/^(path|external_directory)_/.test(name) ||
              ['path_read', 'path_write', 'external_directory_read', 'external_directory_write'].includes(
                name,
              )) &&
            surface(decision),
        )
    if (!valid) throw new Error('Unsupported permission config field or value')
  }
}

export interface ISetupPlan {
  beforeHash: string | null
  afterHash: string
  next: string
  changed: boolean
  defaultSkillActivationConfigured: boolean
  retainedRestrictionCount: number
  existingCatchAllRetained: boolean
}

// Pure transformation. No runtime/profile discovery, grants or package loading.
export const planSetup = (previous: string | null): ISetupPlan => {
  if (previous !== null && Buffer.byteLength(previous) > MAX_BYTES)
    throw new Error('Config exceeds setup bound')
  const config: unknown = previous === null ? {} : JSON.parse(previous)
  validate(config)
  const permission = (config.permission ?? {}) as Record<string, unknown>
  const skill = permission.skill
  let nextSkill = skill
  if (skill === undefined) nextSkill = 'allow'
  else if (object(skill) && !Object.hasOwn(skill, '*')) {
    // Integer-like keys are reordered by JavaScript before '*', defeating prepend.
    if (Object.keys(skill).some((key) => String(Number(key) >>> 0) === key && key !== '4294967295'))
      throw new Error('Unsupported integer-like skill pattern order')
    nextSkill = { '*': 'allow', ...skill }
  }
  const changed = nextSkill !== skill
  const next = changed
    ? `${JSON.stringify({ ...config, permission: { ...permission, skill: nextSkill } }, null, 2)}\n`
    : previous!
  if (Buffer.byteLength(next) > MAX_BYTES) throw new Error('Config exceeds setup bound')
  const restrictions = object(nextSkill)
    ? Object.values(nextSkill).filter((value) => value !== 'allow').length
    : nextSkill === 'allow'
      ? 0
      : 1
  return {
    beforeHash: previous === null ? null : hash(previous),
    afterHash: hash(next),
    next,
    changed,
    defaultSkillActivationConfigured:
      nextSkill === 'allow' || (object(nextSkill) && nextSkill['*'] === 'allow' && restrictions === 0),
    retainedRestrictionCount: restrictions,
    existingCatchAllRetained: object(skill) && Object.hasOwn(skill, '*'),
  }
}

export const resolveAgentDir = (
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
) => {
  // Public Pi 1.3 getAgentDir uses PI_CODING_AGENT_DIR and expands '~'.
  const override = env.PI_CODING_AGENT_DIR
  const value =
    explicit ??
    (override
      ? override === '~'
        ? home
        : override.startsWith('~/')
          ? join(home, override.slice(2))
          : override
      : join(home, '.pi', 'agent'))
  if (!isAbsolute(value) || resolve(value) !== value)
    throw new Error('Absolute canonical agent directory required')
  return value
}
export const setupTarget = (agentDir: string) => {
  resolveAgentDir(agentDir)
  return join(agentDir, 'extensions', 'pi-permission-system', 'config.json')
}

const assertSetupPath = (target: string) => {
  assertPrivatePath(target)
  let ancestor = dirname(target)
  while (ancestor !== parse(ancestor).root) {
    try {
      if (!lstatSync(ancestor).isDirectory()) throw new Error('Unsafe config ancestor')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    ancestor = dirname(ancestor)
  }
}
const readTarget = (target: string): { text: string; mode: number } | null => {
  assertSetupPath(target)
  let stat
  try {
    stat = lstatSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o022) !== 0 ||
    (process.getuid && stat.uid !== process.getuid()) ||
    stat.size > MAX_BYTES
  )
    throw new Error('Unsafe permission config target')
  const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = fstatSync(fd)
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > MAX_BYTES)
      throw new Error('Config changed during read')
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, length)
      if (count === 0) break
      length += count
    }
    const bytes = buffer.subarray(0, length)
    if (bytes.length > MAX_BYTES) throw new Error('Config exceeds setup bound')
    if (!isUtf8(bytes)) throw new Error('Config must be UTF-8 JSON')
    return { text: bytes.toString('utf8'), mode: stat.mode & 0o777 }
  } finally {
    closeSync(fd)
  }
}
export const inspectSetup = (agentDir: string) => planSetup(readTarget(setupTarget(agentDir))?.text ?? null)

export interface ISetupReceipt {
  changed: boolean
  defaultSkillActivationConfigured: boolean
  retainedRestrictionCount: number
  existingCatchAllRetained: boolean
  beforeHash: string | null
  afterHash: string
  backup: string | null
}
export const setupSummary = (plan: ISetupPlan): ISetupReceipt => ({
  changed: plan.changed,
  defaultSkillActivationConfigured: plan.defaultSkillActivationConfigured,
  retainedRestrictionCount: plan.retainedRestrictionCount,
  existingCatchAllRetained: plan.existingCatchAllRetained,
  beforeHash: plan.beforeHash,
  afterHash: plan.afterHash,
  backup: null,
})

export const applySetup = (
  agentDir: string,
  reviewed: ISetupPlan,
  hooks: {
    beforeCommit?: () => void
    beforeWrite?: (path: string) => void
  } = {},
): ISetupReceipt => {
  const target = setupTarget(agentDir)
  const current = readTarget(target)
  const plan = planSetup(current?.text ?? null)
  if (JSON.stringify(plan) !== JSON.stringify(reviewed)) throw new Error('Reviewed setup plan is stale')
  const receipt = setupSummary(plan)
  if (!plan.changed) return receipt
  const directory = dirname(target)
  assertPrivatePath(directory)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  assertPrivatePath(directory)
  const temporary = join(directory, `.mahiro-setup-${randomUUID()}.tmp`)
  let residualBackup: string | null = null
  const writeExclusive = (path: string, text: string, mode: number) => {
    hooks.beforeWrite?.(path)
    assertPrivatePath(path)
    const fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode,
    )
    try {
      writeFileSync(fd, text)
      fsyncSync(fd)
    } catch (error) {
      try {
        unlinkSync(path)
      } catch {
        residualBackup = path
      }
      throw error
    } finally {
      closeSync(fd)
    }
  }
  let createdTemporary = false
  let published = false
  try {
    // Mark ownership before a possible partial write; cleanup only our unique file.
    hooks.beforeWrite?.(temporary)
    assertSetupPath(temporary)
    const fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      current?.mode ?? 0o600,
    )
    createdTemporary = true
    try {
      fchmodSync(fd, current?.mode ?? 0o600)
      writeFileSync(fd, plan.next)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    hooks.beforeCommit?.()
    const assertCurrent = () => {
      const latest = readTarget(target)
      if ((latest === null ? null : hash(latest.text)) !== plan.beforeHash || latest?.mode !== current?.mode)
        throw new Error('Concurrent permission config change; nothing replaced')
    }
    assertCurrent()
    if (current) {
      const backup = join(directory, `config.json.mahiro-setup-${randomUUID()}.bak`)
      // Keep an accurate recovery receipt even if a later publication fails.
      writeExclusive(backup, current.text, 0o600)
      receipt.backup = backup
    }
    assertCurrent()
    if (current) {
      renameSync(temporary, target)
      published = true
    } else {
      linkSync(temporary, target)
      published = true
      unlinkSync(temporary)
    }
    createdTemporary = false
    const directoryFd = openSync(directory, constants.O_RDONLY)
    try {
      fsyncSync(directoryFd)
    } finally {
      closeSync(directoryFd)
    }
    return receipt
  } catch (cause) {
    let residualTemporary: string | null = null
    if (createdTemporary) {
      try {
        unlinkSync(temporary)
      } catch {
        residualTemporary = temporary
      }
    }
    // No rollback: a third party may already have edited the published file.
    const error = new Error('Setup apply failed; inspect receipt before recovery', { cause })
    Object.assign(error, {
      receipt: {
        ...receipt,
        changed: published,
        residualTemporary,
        residualBackup,
        publication: published ? 'published-durability-unconfirmed' : 'not-published',
      },
    })
    throw error
  }
}
