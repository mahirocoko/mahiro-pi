import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { digest, objectShape } from '../../continuity/records.ts'
import { assertCurrent, type OperationContext } from './controller.ts'
import { engineEnvironment, gitSafety, runGit, safePath } from './io.ts'
import { startGitMutation } from './native-git.ts'
import { parseConfig, parseLedger, revisionPattern, validateFile } from './schema.ts'
import type { MemoryConfig } from '../store.ts'

const prepared = new WeakSet<object>()
export interface InitializationPlan {
  readonly config: MemoryConfig
  readonly files: Readonly<Record<string, string>>
  readonly digest: string
}
// Pure, bounded preparation. No caller chooses root, executable, actions, paths or argv.
export function prepareInitialization(cwd: string, args: unknown): InitializationPlan {
  if (
    !objectShape(args, ['action', 'core', 'projectId', 'automatic']) ||
    args.action !== 'initialize' ||
    typeof args.core !== 'string' ||
    typeof args.projectId !== 'string' ||
    (args.automatic !== undefined && typeof args.automatic !== 'boolean')
  )
    throw Error('Explicit initial identity and project required')
  const config = parseConfig(
    JSON.stringify({
      version: 1,
      projects: [{ cwd, id: args.projectId }],
      coreBytes: 8192,
      indexBytes: 2048,
      fileBytes: 8192,
      totalBytes: 65536,
      automatic: args.automatic === true,
    }),
  )
  const index = '# Memory index\n'
  validateFile('Core.md', { text: args.core, sources: [] }, config)
  validateFile('index.md', { text: index, sources: [] }, config)
  const ledger = `${JSON.stringify({
    version: 2,
    sources: { 'Core.md': [], 'index.md': [] },
    forgottenPaths: [],
    forgottenSources: [],
    reviewed: [],
  })}\n`
  parseLedger(ledger)
  const files = Object.freeze({
    'config.json': `${JSON.stringify(config)}\n`,
    '.gitignore': 'config.json\n.views/\n.episodes/\n.lock/\n',
    'Core.md': args.core,
    'index.md': index,
    '.memory.json': ledger,
  })
  for (const project of config.projects) Object.freeze(project)
  Object.freeze(config.projects)
  Object.freeze(config)
  const plan = Object.freeze({ config, files, digest: digest(JSON.stringify(files)) })
  prepared.add(plan)
  return plan
}
export async function initializeMemoryRoot(
  root: string,
  plan: InitializationPlan,
  context: OperationContext & { barrier: () => Promise<void> },
  environment = engineEnvironment(),
) {
  if (!prepared.has(plan)) throw Error('Parent-owned initialization plan required')
  if (typeof context.barrier !== 'function') throw Error('Bootstrap branch barrier required')
  const fence = async () => {
    assertCurrent(context)
    await context.barrier()
    assertCurrent(context)
  }
  await fence()
  const release = context.hold?.({ initialization: plan })
  const current = (paths = [root]) => assertCurrent(context, { physical: paths, logical: [], kind: 'data' })
  const syncDirectory = async (directory: string) => {
    await fence()
    current()
    const fd = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      await fence()
      current()
      await fd.sync()
    } finally {
      await fd.close()
    }
  }
  const write = async (name: string, text: string) => {
    const path = join(root, name)
    await fence()
    await safePath(path)
    await fence()
    current([root, path])
    const fd = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await fence()
      current([path])
      await fd.writeFile(text)
      await fence()
      current([path])
      await fd.sync()
    } finally {
      await fd.close()
    }
    await syncDirectory(root)
  }
  const readonly = async (args: string[]) => {
    await fence()
    await gitSafety(root, async (targets) => {
      await fence()
      assertCurrent(context, targets)
    })
    await fence()
    current([root, join(root, '.git')])
    return (await runGit(root, args, environment)).toString('utf8')
  }
  try {
    await safePath(root)
    if ((await realpath(dirname(root))) !== dirname(root)) throw Error('Canonical parent required')
    await fence()
    current()
    await mkdir(root, { mode: 0o700 }) // exclusive absent-root create; NEVER repair/reseed
    await fence()
    const stat = await lstat(root)
    if (!stat.isDirectory() || stat.mode & 0o077) throw Error('Private root required')
    // The initial create/intent gap leaves an existing unavailable root, never a retry grant.
    await write(
      '.bootstrap-v2.json',
      `${JSON.stringify({ version: 1, digest: plan.digest, stage: 'intent' })}\n`,
    )
    await syncDirectory(dirname(root)) // fixed root-entry durability, no parent content read
    for (const [name, text] of Object.entries(plan.files)) await write(name, text)
    await fence()
    current([root, join(root, '.git')])
    await startGitMutation(root, ['init', '--quiet'], environment).completed
    const paths = ['.gitignore', 'Core.md', 'index.md', '.memory.json']
    await fence()
    await gitSafety(root, async (targets) => {
      await fence()
      assertCurrent(context, targets)
    })
    await fence()
    current([root, join(root, '.git')])
    await startGitMutation(root, ['add', '--', ...paths], environment).completed
    await fence()
    await gitSafety(root, async (targets) => {
      await fence()
      assertCurrent(context, targets)
    })
    await fence()
    current([root, join(root, '.git')])
    await startGitMutation(root, ['commit', '-m', 'Initialize private managed memory'], environment).completed
    const revision = (await readonly(['rev-parse', '--verify', 'HEAD'])).trim()
    if (
      !revisionPattern.test(revision) ||
      (await readonly(['rev-list', '--parents', '-n', '1', revision])).trim() !== revision
    )
      throw Error('Initialization HEAD ancestry unavailable')
    const tree = (await readonly(['ls-tree', '-r', '--name-only', '-z', revision]))
      .split('\0')
      .filter(Boolean)
      .sort()
    if (JSON.stringify(tree) !== JSON.stringify([...paths].sort()))
      throw Error('Initialization tree differs from plan')
    for (const path of paths)
      if ((await readonly(['show', `${revision}:${path}`])) !== plan.files[path])
        throw Error('Initialization content differs from plan')
    if (
      (await readonly(['diff', '--cached', '--name-only', '-z', 'HEAD'])).length ||
      (await readonly(['diff', '--name-only', '-z'])).length
    )
      throw Error('Initialization index/worktree changed')
    await fence()
    current([join(root, '.bootstrap-v2.json')])
    await unlink(join(root, '.bootstrap-v2.json'))
    await syncDirectory(root)
    if (
      (await readonly(['status', '--porcelain', '--untracked-files=all'])).trim() ||
      (await readonly(['rev-parse', '--verify', 'HEAD'])).trim() !== revision
    )
      throw Error('Initialization final state changed')
    await fence()
    assertCurrent(context)
    return {
      revision,
      initialized: true,
      nativeBootstrapChanged: false,
      contextActivation: 'next-primary-request',
    }
  } finally {
    release?.()
  }
}
