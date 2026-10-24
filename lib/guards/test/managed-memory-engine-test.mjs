import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createDisposableMemoryFixture, selectManagedMemoryFixture } from '../memory-fixture.mjs'
import { trustedMemoryTool } from '../provenance.mjs'

const primary = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const adapter = path.join(primary, 'lib/guards')

test('canonical public SDK pre-bind ABI2 singleton selection, isolated capability, and default ABI1', async () => {
  const fixture = await createDisposableMemoryFixture()
  const previous = { ...process.env }
  for (const key of Object.keys(process.env))
    if (
      key.startsWith('GIT_') ||
      key.startsWith('PI_') ||
      key.includes('API_KEY') ||
      key.startsWith('MAHIRO_')
    )
      delete process.env[key]
  Object.assign(process.env, { HOME: fixture.home, PI_CODING_AGENT_DIR: fixture.agentDir })
  const fetch = globalThis.fetch
  let external = 0
  globalThis.fetch = () => {
    external++
    throw Error('External transport forbidden')
  }
  const sdk = await import('@earendil-works/pi-coding-agent')
  const ai = await import('@earendil-works/pi-ai')
  const sessions = []
  try {
    const permissions = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-permission-system'))
    const subagents = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-subagents'))
    fs.mkdirSync(path.join(fixture.agentDir, 'extensions/pi-permission-system'), { recursive: true })
    fs.writeFileSync(
      path.join(fixture.agentDir, 'extensions/pi-permission-system/config.json'),
      JSON.stringify({ yoloMode: false, authorizerChain: [], permission: { '*': 'deny' } }),
    )
    fs.mkdirSync(path.join(fixture.agentDir, 'extensions/pi-subagents'), { recursive: true })
    fs.writeFileSync(
      path.join(fixture.agentDir, 'extensions/pi-subagents/config.json'),
      JSON.stringify({ excludedExtensionPackages: [subagents] }),
    )
    fs.writeFileSync(
      path.join(fixture.agentDir, 'settings.json'),
      JSON.stringify({
        packages: [permissions, subagents, adapter, primary],
        skills: [],
        prompts: [],
        themes: [],
        cacheWarming: 'off',
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
    )
    const runtime = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const faux = ai.fauxProvider({ provider: 'openai', models: [{ id: 'gpt-6.1-sol' }] })
    runtime.registerNativeProvider(faux.provider)
    async function open(selected) {
      const settingsManager = sdk.SettingsManager.create(fixture.cwd, fixture.agentDir)
      const loader = new sdk.DefaultResourceLoader({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        settingsManager,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        noContextFiles: true,
        disabledBuiltinExtensions: ['mcp'],
      })
      await loader.reload()
      assert.deepEqual(loader.getExtensions().errors, [])
      const { session } = await sdk.createAgentSession({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        modelRuntime: runtime,
        model: faux.getModel(),
        resourceLoader: loader,
        settingsManager,
        sessionManager: sdk.SessionManager.inMemory(fixture.cwd),
      })
      sessions.push(session)
      if (selected) {
        assert.throws(() => selectManagedMemoryFixture(session.sessionManager, {}), /owned disposable/)
        selectManagedMemoryFixture(session.sessionManager, fixture.capability)
        assert.throws(
          () => selectManagedMemoryFixture(session.sessionManager, fixture.capability),
          /pre-bind/,
        )
      }
      await session.bindExtensions({})
      const node = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].get(session.sessionId)
      assert.equal(node?.healthy(), true, 'real canonical Root health, not inline replacement')
      assert.equal(node.managedMemory.version, selected ? 2 : 1)
      if (selected) assert.equal(node.managedMemory.fixtureRoot, fixture.root)
      assert.equal(
        trustedMemoryTool(session.getAllTools().find((tool) => tool.name === 'agent_memory_read')),
        true,
      )
      assert.throws(() => selectManagedMemoryFixture(session.sessionManager, fixture.capability), /pre-bind/)
      return { session, node }
    }
    const first = await open(true)
    await assert.rejects(fixture.dispose(), /still held/)
    assert.equal(first.node.managedMemory.fixtureLive(), true, 'refusal does not retire admission')
    const replacement = await open(true)
    await first.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
    await first.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
    await assert.rejects(fixture.dispose(), /still held/, 'old idempotent cleanup cannot release replacement')
    assert.equal(replacement.node.managedMemory.fixtureLive(), true)
    await open(false)
    assert.equal(
      fs.existsSync(fixture.root),
      false,
      'selection/default construction does not initialize or spawn data work',
    )
    assert.equal(external, 0)
  } finally {
    for (const session of sessions.reverse()) {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
      session.dispose()
    }
    globalThis.fetch = fetch
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, previous)
    await fixture.dispose()
  }
})
