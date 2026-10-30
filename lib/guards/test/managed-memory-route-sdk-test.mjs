import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { createDisposableMemoryFixture, selectManagedMemoryFixture } from '../memory-fixture.mjs'
import { createMemoryStore } from '../../agent-memory/store.ts'

const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const stagedModules = path.join(product, 'lib/guards/node_modules')
const modules = fs.existsSync(stagedModules)
  ? stagedModules
  : (process.env.MAHIRO_PI_TEST_MODULES ?? path.join(product, 'node_modules'))
const registry = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
const marker = 'SYNTHETIC_ROUTE_INITIAL_CORE'

// Actual public loader, kernel/PSS and ABI2 controller with isolated Faux requests.
// Initialization/read probes use direct execute; writer calls use native model/tool middleware.
async function fixture() {
  const owned = await createDisposableMemoryFixture()
  const previous = { ...process.env }
  for (const key of Object.keys(process.env))
    if (/^(GIT_|PI_|MAHIRO_)/.test(key) || key.includes('API_KEY')) delete process.env[key]
  Object.assign(process.env, {
    HOME: owned.home,
    PI_CODING_AGENT_DIR: owned.agentDir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(owned.home, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: owned.directory,
  })
  fs.writeFileSync(
    path.join(owned.home, '.gitconfig'),
    '[user]\n name = Synthetic Navigation\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
  )
  const savedFetch = globalThis.fetch
  let external = 0
  globalThis.fetch = () => {
    external++
    throw Error('Automatic route fixture forbids external transport')
  }
  let session
  let restored = false
  const observationKey = Symbol.for('@mahirocoko/memory-route-test:contexts')
  const observations = []
  globalThis[observationKey] = observations
  const restore = () => {
    if (restored) return
    restored = true
    delete globalThis[observationKey]
    globalThis.fetch = savedFetch
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, previous)
  }
  try {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const ai = await import('@earendil-works/pi-ai')
    const permissions = fs.realpathSync(path.join(modules, '@gotgenes/pi-permission-system'))
    const subagents = fs.realpathSync(path.join(modules, '@gotgenes/pi-subagents'))
    const capability = `managed_memory_${createHash('sha256').update(owned.root).digest('hex')}`
    const config = path.join(owned.agentDir, 'extensions/pi-permission-system/config.json')
    fs.mkdirSync(path.dirname(config), { recursive: true })
    fs.writeFileSync(
      config,
      JSON.stringify({
        yoloMode: false,
        authorizerChain: [],
        permission: {
          '*': 'deny',
          read: 'allow',
          agent_memory_read: 'allow',
          agent_memory_manage: 'allow',
          agent_memory_edit: 'allow',
          agent_memory_commit: 'allow',
          agent_memory_reflect: 'allow',
          [capability]: 'allow',
        },
      }),
    )
    fs.mkdirSync(path.join(owned.agentDir, 'extensions/pi-subagents'), { recursive: true })
    fs.writeFileSync(
      path.join(owned.agentDir, 'extensions/pi-subagents/config.json'),
      JSON.stringify({ excludedExtensionPackages: [subagents] }),
    )
    fs.writeFileSync(
      path.join(owned.agentDir, 'extensions/tree-context.ts'),
      `export default (pi) => { pi.on('session_start', (_, ctx) => {
        globalThis[Symbol.for('@mahirocoko/memory-route-test:contexts')].push({ ctx, tools: pi.getAllTools() })
      }) }`,
    )
    fs.mkdirSync(path.join(owned.agentDir, 'agents'))
    fs.copyFileSync(
      path.join(product, 'agents/managed-memory-writer.md'),
      path.join(owned.agentDir, 'agents/managed-memory-writer.md'),
    )
    assert.deepEqual(
      fs.readFileSync(path.join(owned.agentDir, 'agents/managed-memory-writer.md')),
      fs.readFileSync(path.join(product, 'agents/managed-memory-writer.md')),
    )
    const runtime = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const faux = ai.fauxProvider({ provider: 'openai', models: [{ id: 'gpt-6.1-sol', reasoning: true }] })
    runtime.registerNativeProvider(faux.provider)
    const settings = {
      packages: [permissions, subagents, product],
      skills: [],
      themes: [],
      prompts: [],
      cacheWarming: 'off',
      compaction: { enabled: false },
      retry: { enabled: false },
    }
    fs.writeFileSync(path.join(owned.agentDir, 'settings.json'), JSON.stringify(settings))
    const settingsManager = sdk.SettingsManager.inMemory(settings)
    const errors = []
    let ctx
    const loader = new sdk.DefaultResourceLoader({
      cwd: owned.cwd,
      agentDir: owned.agentDir,
      settingsManager,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ['mcp'],
      systemPromptOverride: () => 'Offline synthetic route test.',
      extensionFactories: [
        (pi) => {
          pi.on('session_start', (_event, context) => {
            ctx = context
          })
        },
      ],
    })
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    const manager = sdk.SessionManager.inMemory(owned.cwd)
    ;({ session } = await sdk.createAgentSession({
      cwd: owned.cwd,
      agentDir: owned.agentDir,
      modelRuntime: runtime,
      model: faux.getModel(),
      thinkingLevel: 'off',
      resourceLoader: loader,
      settingsManager,
      sessionManager: manager,
      tools: ['agent_memory_read', 'agent_memory_manage', 'agent_memory_reflect'],
    }))
    selectManagedMemoryFixture(manager, owned.capability)
    await session.bindExtensions({ onError: (error) => errors.push(error) })
    const node = globalThis[registry].get(session.sessionId)
    assert.equal(node?.healthy(), true)
    assert.equal(node.managedMemory.version, 2)
    assert.equal(node.managedMemory.root, owned.root)
    assert.equal(node.managedMemory.isPrimarySession(ctx), true)
    const invoke = async (name, args) =>
      (await session.getToolDefinition(name).execute('synthetic-tree', args, undefined, undefined, ctx))
        .details
    assert.equal(fs.existsSync(owned.root), false, 'startup provisions nothing')
    await invoke('agent_memory_manage', {
      action: 'initialize',
      core: `# Core\n${marker}\n`,
      projectId: 'synthetic',
      automatic: true,
    })
    return {
      session,
      manager,
      node,
      ai,
      faux,
      invoke,
      observations,
      root: owned.root,
      revision: () => createMemoryStore(owned.root).snapshot().revision,
      read: () => invoke('agent_memory_read', { path: 'Core.md' }),
      async close() {
        try {
          await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
          session.dispose()
          await owned.dispose()
          assert.deepEqual(errors, [])
          assert.equal(external, 0)
          assert.equal(fs.existsSync(owned.directory), false)
          assert.equal(globalThis[registry].has(manager.getSessionId()), false)
        } finally {
          restore()
        }
      },
    }
  } catch (error) {
    try {
      if (session) {
        await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
        session.dispose()
      }
      await owned.dispose()
    } finally {
      restore()
    }
    throw error
  }
}

// Completed-but-not-ready, permission loss, and native root/generation replacement:
// managed-memory-engine-operations-test.mjs. Lower-level conflicts, config/current
// authority, and no-learning metadata: agent-memory-engine.test.ts. Lifetime and
// tree SDK fixtures own revocation/drain. This route additionally proves child != primary.
test('ABI2 automatic settled RPC route publishes only after genuine native completion', async () => {
  const f = await fixture()
  const service = f.node.managedMemory.parentService()
  const updated = 'SYNTHETIC_R4_UPDATED_CORE'
  const initialCore = `# Core\n${marker}\n`
  const nextCore = `${initialCore}${updated}\n`
  const paused = Promise.withResolvers()
  const gate = Promise.withResolvers()
  let timer
  let primaryRequests = 0
  const systems = []
  const ledger = () => JSON.parse(fs.readFileSync(path.join(f.root, '.memory.json'), 'utf8'))
  const core = () => fs.readFileSync(path.join(f.root, 'Core.md'), 'utf8')
  try {
    const revision = f.revision()
    const respond = async (context) => {
      const system = JSON.stringify(context.messages.filter((m) => m.role === 'system'))
      // Child prompt is replaced by the installed role; primary keeps its native preamble.
      if (system.includes('Offline synthetic route test.')) {
        primaryRequests++
        systems.push(system)
        return f.ai.fauxAssistantMessage('Synthetic durable understanding, not live evidence.')
      }
      const results = context.messages.filter((m) => m.role === 'toolResult')
      for (const result of results) assert.equal(result.isError, false, JSON.stringify(result))
      if (!results.length)
        return f.ai.fauxAssistantMessage(f.ai.fauxToolCall('agent_memory_read', { path: 'Core.md' }), {
          stopReason: 'toolUse',
        })
      if (results.length === 1)
        return f.ai.fauxAssistantMessage(
          f.ai.fauxToolCall('agent_memory_edit', {
            path: 'Core.md',
            expectedHash: createHash('sha256').update(initialCore).digest('hex'),
            text: nextCore,
            sources: [],
          }),
          { stopReason: 'toolUse' },
        )
      if (results.length === 2)
        return f.ai.fauxAssistantMessage(
          f.ai.fauxToolCall('agent_memory_commit', {
            revision: JSON.parse(results[0].content[0].text).baseRevision,
          }),
          { stopReason: 'toolUse' },
        )
      paused.resolve()
      await gate.promise
      return f.ai.fauxAssistantMessage('Private proposal ready; native run now completes.')
    }
    f.faux.setResponses(Array.from({ length: 16 }, () => respond))
    await f.session.prompt('Retain this synthetic durable understanding.', { source: 'rpc' })
    await Promise.race([
      paused.promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Automatic writer did not become ready')), 30000)
      }),
    ])
    clearTimeout(timer)
    const records = service.listAgents()
    assert.equal(records.length, 1, 'one automatic writer, no manual reflect dispatch')
    const record = service.getRecord(records[0].id)
    assert.equal(record.type, 'managed-memory-writer')
    assert.equal(record.status, 'running')
    const child = f.observations.find(
      (entry) => entry.ctx.sessionManager.getSessionFile() === record.outputFile,
    )
    assert.ok(child, 'actual SDK child output identity')
    const childNode = globalThis[registry].get(child.ctx.sessionManager.getSessionId())
    assert.equal(childNode.managedMemory.isPrimarySession(child.ctx), false)
    const childRead = child.tools.find((tool) => tool.name === 'agent_memory_read')
    const leased = childNode.managedMemory.assertAccess(childRead, child.ctx, f.root, 'read').value
    assert.equal(leased.ready, true)
    assert.equal(core(), initialCore)
    assert.equal(f.revision(), revision)
    assert.deepEqual(ledger().reviewed, [])
    const episodes = fs.readdirSync(path.join(f.root, '.episodes')).filter((name) => name.endsWith('.json'))
    assert.equal(episodes.length, 1)
    const episode = JSON.parse(fs.readFileSync(path.join(f.root, '.episodes', episodes[0]), 'utf8'))
    assert.equal(episode.input.source, 'rpc')
    assert.equal(episode.outcome, 'completed')
    assert.equal(episode.session, f.manager.getSessionId())
    assert.ok(episode.actions.length)
    const startedPrompt = f.session.systemPrompt
    assert.ok(!startedPrompt.includes(updated))
    assert.ok(!systems[0].includes(updated))
    gate.resolve()
    await service.waitForAll()
    // Completion wakeup is asynchronous; observe actual reconciliation, never invoke it.
    for (let i = 0; i < 500 && f.revision() === revision; i++) await delay(10)
    assert.equal(service.getRecord(record.id).status, 'completed')
    assert.notEqual(f.revision(), revision)
    assert.equal(core(), nextCore)
    assert.deepEqual(ledger().reviewed, [episode.id])
    assert.throws(() => childNode.managedMemory.assertAccess(childRead, child.ctx, f.root, 'read'))
    assert.equal(f.session.systemPrompt, startedPrompt, 'already-started run is immutable')
    await f.session.prompt('Read the later synthetic projection.', { source: 'extension' })
    assert.equal(primaryRequests, 2)
    assert.equal(service.listAgents().length, 1, 'extension input is not automatic observation')
    assert.equal(systems[1].split('<mahiro-managed-memory>').length - 1, 1)
    assert.ok(systems[1].includes(updated))
    assert.ok(systems[1].includes('Offline synthetic route test.'))
  } finally {
    gate.resolve()
    clearTimeout(timer)
    let drainError
    try {
      for (const record of service.listAgents()) service.abort(record.id)
      await service.waitForAll()
    } catch (error) {
      drainError = error
    }
    let closeError
    try {
      await f.close()
    } catch (error) {
      closeError = error
    }
    if (drainError && closeError)
      throw new AggregateError([drainError, closeError], 'Automatic route fixture cleanup failed')
    if (drainError) throw drainError
    if (closeError) throw closeError
  }
})
