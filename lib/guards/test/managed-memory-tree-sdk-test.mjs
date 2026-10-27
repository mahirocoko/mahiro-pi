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
const marker = 'SYNTHETIC_TREE_SDK_CORE'

// Actual public loader, kernel/PSS, registered tools, tree hooks and Faux requests.
// Direct execute calls below are not model-issued tool_call middleware evidence.
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
    throw Error('Navigation fixture forbids external transport')
  }
  let session
  const observationKey = Symbol.for('@mahirocoko/memory-tree-test:contexts')
  const observations = []
  globalThis[observationKey] = observations
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
        globalThis[Symbol.for('@mahirocoko/memory-tree-test:contexts')].push({ ctx, tools: pi.getAllTools() })
      }) }`,
    )
    fs.mkdirSync(path.join(owned.agentDir, 'agents'))
    fs.copyFileSync(
      path.join(product, 'agents/managed-memory-writer.md'),
      path.join(owned.agentDir, 'agents/managed-memory-writer.md'),
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
    const hooks = []
    const errors = []
    let ctx
    let cancel = false
    const loader = new sdk.DefaultResourceLoader({
      cwd: owned.cwd,
      agentDir: owned.agentDir,
      settingsManager,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ['mcp'],
      systemPromptOverride: () => 'Offline synthetic navigation test.',
      extensionFactories: [
        (pi) => {
          pi.on('session_start', (_event, context) => {
            ctx = context
          })
          pi.on('session_before_tree', () => {
            hooks.push('before')
            if (cancel) return { cancel: true }
          })
          pi.on('session_tree', () => {
            hooks.push('after')
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
      automatic: false,
    })
    const systems = []
    const respond = (context) => {
      const text = JSON.stringify(context.messages.filter((message) => message.role === 'system'))
      systems.push({ wrapper: text.includes('<mahiro-managed-memory>'), core: text.includes(marker) })
      return ai.fauxAssistantMessage('Synthetic response only.')
    }
    faux.setResponses(Array.from({ length: 8 }, () => respond))
    await session.prompt('First synthetic exchange.', { source: 'extension' })
    await session.prompt('Second synthetic exchange.', { source: 'extension' })
    const assistants = manager
      .getBranch()
      .filter((entry) => entry.type === 'message' && entry.message.role === 'assistant')
    assert.equal(assistants.length, 2)
    assert.ok(systems.every((system) => system.wrapper && system.core))
    return {
      session,
      manager,
      hooks,
      systems,
      target: assistants[0].id,
      node,
      ai,
      faux,
      invoke,
      observations,
      root: owned.root,
      revision: () => createMemoryStore(owned.root).snapshot().revision,
      setCancel: (value) => (cancel = value),
      read: () => invoke('agent_memory_read', { path: 'Core.md' }),
      async close() {
        await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
        session.dispose()
        await owned.dispose()
        assert.deepEqual(errors, [])
        assert.equal(external, 0)
        assert.equal(fs.existsSync(owned.directory), false)
        assert.equal(globalThis[registry].has(manager.getSessionId()), false)
        delete globalThis[observationKey]
        globalThis.fetch = savedFetch
        for (const key of Object.keys(process.env)) delete process.env[key]
        Object.assign(process.env, previous)
      },
    }
  } catch (error) {
    if (session) {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
      session.dispose()
    }
    await owned.dispose()
    delete globalThis[observationKey]
    globalThis.fetch = savedFetch
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, previous)
    throw error
  }
}

for (const scenario of ['completed', 'cancelled', 'shutdown']) {
  test(`public SDK tree ${scenario} drains real running ready worker; no stale adoption`, async () => {
    const f = await fixture()
    const cancel = scenario !== 'completed'
    let release
    let navigation
    let shutdown
    let timer
    let readinessTimer
    const service = f.node.managedMemory.parentService()
    try {
      const revision = (await f.read()).currentRevision
      let paused = false
      const { promise: workerPaused, resolve: signalWorkerPaused } = Promise.withResolvers()
      let aborts = 0
      const respond = async (context, options) => {
        const results = context.messages.filter((message) => message.role === 'toolResult')
        for (const result of results) assert.equal(result.isError, false)
        if (!results.length)
          return f.ai.fauxAssistantMessage(f.ai.fauxToolCall('agent_memory_read', { path: 'Core.md' }), {
            stopReason: 'toolUse',
          })
        if (results.length === 1)
          return f.ai.fauxAssistantMessage(
            f.ai.fauxToolCall('agent_memory_edit', {
              path: 'global/tree-stale.md',
              expectedHash: null,
              text: '# Never adopt a retired tree worker\n',
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
        paused = true
        options?.signal?.addEventListener('abort', () => aborts++, { once: true })
        await new Promise((resolve) => {
          release = resolve
          timer = setTimeout(resolve, 10000) // bounded cleanup even if a fixture assertion fails
          signalWorkerPaused()
        })
        return f.ai.fauxAssistantMessage('Retired native response drained, never adopted.')
      }
      f.faux.setResponses(Array.from({ length: 8 }, () => respond))
      const dispatched = await f.invoke('agent_memory_reflect', { assignment: 'Synthetic tree drain check.' })
      // SDK suites can contend during child startup; wait for the actual response pause,
      // not a short polling budget. A missing pause still fails within a bounded deadline.
      try {
        await Promise.race([
          workerPaused,
          new Promise((_, reject) => {
            readinessTimer = setTimeout(() => reject(Error('Worker did not pause within 30 seconds')), 30000)
          }),
        ])
      } finally {
        clearTimeout(readinessTimer)
      }
      assert.equal(paused, true)
      const record = service.getRecord(dispatched.job)
      assert.equal(record.status, 'running')
      const child = f.observations.find(
        (entry) => entry.ctx.sessionManager.getSessionFile() === record.outputFile,
      )
      assert.ok(child, 'genuine SDK-loaded child context tied to actual output file')
      const childNode = globalThis[registry].get(child.ctx.sessionManager.getSessionId())
      const childRead = child.tools.find((tool) => tool.name === 'agent_memory_read')
      const leased = childNode.managedMemory.assertAccess(childRead, child.ctx, f.root, 'read').value
      assert.equal(leased.ready, true, 'worker commit is ready but not completion truth')
      const oldPid = leased.engine.pid
      assert.ok(oldPid)
      assert.equal((await f.read()).currentRevision, revision)
      f.setCancel(cancel)
      let done = false
      navigation = f.session.navigateTree(f.target, { summarize: false }).then((result) => {
        done = true
        return result
      })
      await delay(30)
      assert.equal(done, false, 'before-tree must join actual native response, not just abort it')
      assert.ok(aborts > 0)
      await assert.rejects(
        f.session.navigateTree(f.target, { summarize: false }),
        /compaction or tree navigation/,
        'genuine SDK rejects overlapping navigation without admitting a second transition',
      )
      if (scenario === 'shutdown')
        // Embedder-owned terminal cleanup control, not a fabricated navigation event.
        shutdown = f.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
      process.kill(oldPid, 0)
      await assert.rejects(f.read(), /Managed memory unavailable/)
      assert.throws(() => childNode.managedMemory.assertAccess(childRead, child.ctx, f.root, 'read'))
      release()
      clearTimeout(timer)
      assert.equal((await navigation).cancelled, cancel)
      await service.waitForAll()
      if (shutdown) await shutdown
      assert.throws(() => process.kill(oldPid, 0), /ESRCH/, 'old data child genuinely closed')
      assert.deepEqual(f.hooks, shutdown ? [] : cancel ? ['before'] : ['before', 'after'])
      if (shutdown) await assert.rejects(f.read(), /Managed memory unavailable/)
      else assert.equal((await f.read()).currentRevision, revision)
      assert.equal(f.revision(), revision)
      assert.equal(fs.existsSync(path.join(f.root, 'global/tree-stale.md')), false)
      // Native service may retain its child runtime until parent shutdown; revoked lease,
      // not display metadata or node disappearance, is the access/publication fence.
      assert.throws(() => childNode.managedMemory.assertAccess(childRead, child.ctx, f.root, 'read'))
    } finally {
      release?.()
      clearTimeout(timer)
      clearTimeout(readinessTimer)
      for (const record of service.listAgents()) service.abort(record.id)
      if (navigation) await navigation
      if (shutdown) await shutdown
      await service.waitForAll()
      await f.close()
    }
  })
}

for (const scenario of [
  'no-op',
  'completed',
  'cancel-read',
  'cancel-input',
  'cancel-custom',
  'cancel-then-complete',
  'cancel-then-cancel',
]) {
  test(`public SDK ABI2 tree ${scenario}: exact synthetic reads and actual request projection`, async () => {
    const f = await fixture()
    try {
      assert.match(JSON.stringify(await f.read()), new RegExp(marker))
      const oldLeaf = f.manager.getLeafId()
      f.setCancel(scenario.startsWith('cancel'))
      const result = await f.session.navigateTree(scenario === 'no-op' ? oldLeaf : f.target, {
        summarize: false,
      })
      assert.equal(result.cancelled, scenario.startsWith('cancel'))
      assert.deepEqual(
        f.hooks,
        scenario === 'no-op' ? [] : scenario === 'completed' ? ['before', 'after'] : ['before'],
      )
      assert.equal(f.manager.getLeafId(), scenario === 'completed' ? f.target : oldLeaf)
      if (scenario.startsWith('cancel-then-')) {
        // No idle memory read or input occurs between the two genuine SDK transitions.
        f.setCancel(scenario === 'cancel-then-cancel')
        const second = await f.session.navigateTree(f.target, { summarize: false })
        assert.equal(second.cancelled, scenario === 'cancel-then-cancel')
        assert.deepEqual(
          f.hooks,
          scenario === 'cancel-then-cancel' ? ['before', 'before'] : ['before', 'before', 'after'],
        )
        assert.equal(f.manager.getLeafId(), second.cancelled ? oldLeaf : f.target)
      }
      if (scenario === 'cancel-custom') {
        // No idle input/read intervenes: busy before_agent_start cannot prove navigation ended.
        await f.session.sendCustomMessage(
          { customType: 'synthetic', content: 'Synthetic trigger without input.', display: false },
          { triggerTurn: true },
        )
        assert.deepEqual(f.systems.at(-1), { wrapper: false, core: false })
      }
      if (scenario !== 'cancel-input') assert.match(JSON.stringify(await f.read()), new RegExp(marker))
      // Normal input is idle and can safely reactivate cancellation even with automatic off.
      await f.session.prompt('Synthetic continuation.', { source: 'extension' })
      assert.deepEqual(f.systems.at(-1), { wrapper: true, core: true })
      assert.match(JSON.stringify(await f.read()), new RegExp(marker))
      assert.equal(
        f.manager.getEntries().some((entry) => entry.type === 'compaction'),
        false,
      )
      assert.equal(
        f.manager.getEntries().some((entry) => entry.type === 'branch_summary'),
        false,
      )
    } finally {
      await f.close()
    }
  })
}
