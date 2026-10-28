// Explicit installation consent. Loading resources never invokes this command.
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveAgentDir } from './lib/setup.ts'
import { applyBootstrap, bootstrapSummary, inspectBootstrap } from './lib/bootstrap.ts'
import { starterCore } from './lib/agent-memory/starter.ts'
import { validateWriterRoute } from './lib/agent-memory/writer-route.ts'
import { readMemorySelection } from './lib/agent-memory/profile.ts'

let scaffoldDirectory
let inspectMemory = false
try {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Usage: pnpm install:profile [--agent-dir /canonical/profile] [--preview] [--inspect-memory] [--remove-default-deny] [--native-basic-file-policy] [--managed-writer-model exact-provider/model-id --managed-writer-thinking off|minimal|low|medium|high|xhigh|max]\nExplicitly compose one Root guard owner, pinned public permission/subagents resources, three owned system roles, ordinary feature DATA authority and RTK off default. Retains restrictions and existing RTK state, Core/data and unrelated settings. --remove-default-deny explicitly deletes ONLY scalar permission["*"]="deny" (unset falls back to public ask, never blanket allow). Retained required tool/DATA restrictions refuse before writes; this flag cannot override them. Standard installation selects ordinary ABI2 per profile; explicit legacy/off records are preserved. Fresh memory gets an editable starter persona through guarded native initialization; existing Core/customization is never reseeded. Existing canonical writer routes survive; explicit route flags review only model/thinking slots. Reflection denies remain intact; historical quote-learning is optional and never granted here. No dependency install, provider call or reload. Startup grants nothing. --native-basic-file-policy independently opts in to finite BASIC read-deny defaults; not a sandbox or complete secret protection. Public runtime policy, project overrides and yolo remain authoritative. --inspect-memory requires --preview and exposes bounded read-only blocker metadata, never repair authority or private file bodies.',
    )
  } else {
    let agentDir,
      preview = false,
      removeDefaultDeny = false,
      nativeBasicFilePolicy = false,
      managedWriterModel,
      managedWriterThinking
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--preview' && !preview) preview = true
      else if (args[i] === '--inspect-memory' && !inspectMemory) inspectMemory = true
      else if (args[i] === '--remove-default-deny' && !removeDefaultDeny) removeDefaultDeny = true
      else if (args[i] === '--native-basic-file-policy' && !nativeBasicFilePolicy)
        nativeBasicFilePolicy = true
      else if (args[i] === '--agent-dir' && !agentDir && args[i + 1]) agentDir = args[++i]
      else if (args[i] === '--managed-writer-model' && !managedWriterModel && args[i + 1])
        managedWriterModel = args[++i]
      else if (args[i] === '--managed-writer-thinking' && !managedWriterThinking && args[i + 1])
        managedWriterThinking = args[++i]
      else throw Error('Invalid install arguments; use --help')
    }
    if (inspectMemory && !preview) throw Error('--inspect-memory requires --preview; nothing written')
    if (!!managedWriterModel !== !!managedWriterThinking)
      throw Error('Route review requires both --managed-writer-model and --managed-writer-thinking')
    const managedWriterRoute = managedWriterModel
      ? validateWriterRoute(managedWriterModel, managedWriterThinking)
      : undefined
    const profile = resolveAgentDir(agentDir)
    const root = join(profile, 'memory')
    const project = realpathSync(process.cwd())
    const fresh = !existsSync(root)
    const selected = readMemorySelection(profile)
    if (fresh && selected && selected.mode !== 'engine')
      throw Error(
        'Explicit legacy/off engine selection has no initialized root. Selection preserved; standard install wrote nothing. Review that explicit selection or use an authorized legacy initializer before retrying.',
      )
    let seedFile
    if (fresh) {
      scaffoldDirectory = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-install-'))
      seedFile = join(scaffoldDirectory, 'scaffold.md')
      writeFileSync(seedFile, starterCore, { mode: 0o600, flag: 'wx' })
    }
    const plan = inspectBootstrap(
      {
        version: 1,
        agentDir: profile,
        sources: {
          pi: fileURLToPath(new URL('./', import.meta.url)).replace(/\/$/, ''),
        },
        components: {
          packages: true,
          roles: true,
          memoryEngine: true,
          ...(managedWriterRoute ? { managedWriterRoute } : {}),
          featureData: true,
          ...(removeDefaultDeny ? { removeDefaultDeny: true } : {}),
          ...(nativeBasicFilePolicy ? { nativeBasicFilePolicy: true } : {}),
          ...(fresh
            ? {
                memory: {
                  root,
                  project,
                  projectId: createHash('sha256').update(project).digest('hex'),
                  seedFile,
                  automatic: true,
                },
              }
            : {}),
        },
      },
      { inspectMemory },
    )
    console.log(JSON.stringify(preview ? bootstrapSummary(plan) : applyBootstrap(plan, plan.digest), null, 2))
  }
} catch (error) {
  console.error(error instanceof SyntaxError ? 'Invalid JSON; contents withheld' : error.message)
  if (inspectMemory && error.memoryInspection) console.error(JSON.stringify(error.memoryInspection))
  if (error.receipt) console.error(JSON.stringify(error.receipt))
  process.exitCode = 1
} finally {
  if (scaffoldDirectory) rmSync(scaffoldDirectory, { recursive: true, force: true })
}
