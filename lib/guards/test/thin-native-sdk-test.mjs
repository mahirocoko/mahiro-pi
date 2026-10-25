// Disposable public SDK proof: optional feature services cannot gate native execution.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'

const primary = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const stage = path.dirname(primary)

test('Root native tools work without feature kernel and still obey live PSS', async () => {
  assert.match(stage, /\.agent-state\/runtime\/guard-redesign-A\/phase-2\//)
  const cwd = path.join(stage, 'project')
  const agentDir = path.join(stage, 'profile')
  fs.mkdirSync(cwd, { mode: 0o700 })
  fs.mkdirSync(agentDir, { mode: 0o700 })
  fs.writeFileSync(path.join(cwd, 'fixture.txt'), 'thin-native-marker\n')
  fs.writeFileSync(path.join(cwd, '.env'), 'FIXTURE_TOKEN=thin-secret-not-for-output\n')
  const saved = { agent: process.env.PI_CODING_AGENT_DIR, home: process.env.HOME, fetch: globalThis.fetch }
  process.env.PI_CODING_AGENT_DIR = agentDir
  let network = 0
  globalThis.fetch = () => {
    network++
    throw Error('External network prohibited')
  }
  const config = path.join(agentDir, 'extensions/pi-permission-system/config.json')
  fs.mkdirSync(path.dirname(config), { recursive: true, mode: 0o700 })
  const grant = (read = 'allow') =>
    fs.writeFileSync(
      config,
      JSON.stringify({
        authorizerChain: [],
        permission: { '*': 'deny', read, grep: 'allow', bash: 'allow', mh_env_config: 'allow' },
      }),
      { mode: 0o600 },
    )
  grant()
  fs.writeFileSync(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({
      packages: [
        {
          source: primary,
          extensions: ['lib/guards/index.ts'],
          skills: [],
          prompts: [],
          themes: [],
        },
        fs.realpathSync(path.join(primary, 'node_modules/@gotgenes/pi-permission-system')),
        fs.realpathSync(path.join(primary, 'node_modules/@gotgenes/pi-subagents')),
      ],
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
  const faux = ai.fauxProvider({ provider: 'thin-native-offline', models: [{ id: 'fixture' }] })
  runtime.registerNativeProvider(faux.provider)
  let session
  const errors = []
  try {
    const settingsManager = sdk.SettingsManager.create(cwd, agentDir)
    const loader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ['mcp'],
    })
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    assert.equal(
      loader
        .getExtensions()
        .extensions.some((entry) => entry.path === path.join(primary, 'lib/guards/bootstrap.ts')),
      false,
      'bootstrap/kernel deliberately omitted; native tools must not require their readiness',
    )
    const manager = sdk.SessionManager.inMemory(cwd)
    ;({ session } = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager,
      resourceLoader: loader,
      modelRuntime: runtime,
      model: faux.getModel(),
      sessionManager: manager,
    }))
    await session.bindExtensions({ onError: (event) => errors.push(event) })
    const ask = async (name, input) => {
      faux.setResponses([
        ai.fauxAssistantMessage([ai.fauxToolCall(name, input)], { stopReason: 'toolUse' }),
        ai.fauxAssistantMessage('offline native check complete'),
      ])
      const before = session.messages.length
      await session.prompt('Run the requested disposable native fixture check only')
      return session.messages.slice(before).find((message) => message.role === 'toolResult')
    }
    const read = await ask('read', { path: 'fixture.txt' })
    assert.equal(read?.isError, false, JSON.stringify(read))
    assert.match(JSON.stringify(read), /thin-native-marker/)
    const grep = await ask('grep', { pattern: 'thin-native-marker', path: '.' })
    assert.equal(grep?.isError, false, JSON.stringify(grep))
    assert.match(JSON.stringify(grep), /fixture\.txt/)
    const bash = await ask('bash', { command: 'printf thin-bash-marker' })
    assert.equal(bash?.isError, false, JSON.stringify(bash))
    assert.match(JSON.stringify(bash), /thin-bash-marker/)
    const rawSecret = await ask('read', { path: '.env' })
    assert.equal(rawSecret?.isError, true, 'lightweight secret rule survives ordinary PSS read allow')
    assert.doesNotMatch(JSON.stringify(rawSecret), /thin-secret-not-for-output/)
    const filtered = await ask('mh_env_config', { path: '.env' })
    assert.equal(filtered?.isError, false, JSON.stringify(filtered))
    assert.match(JSON.stringify(filtered), /FIXTURE_TOKEN/)
    assert.doesNotMatch(JSON.stringify(filtered), /thin-secret-not-for-output/)
    grant('deny')
    const denied = await ask('read', { path: 'fixture.txt' })
    assert.equal(denied?.isError, true, 'live PSS denial remains authoritative')
    grant()
    assert.equal((await ask('read', { path: 'fixture.txt' }))?.isError, false)
    assert.equal(network, 0)
    assert.equal(process.env.HOME, saved.home)
    assert.deepEqual(errors, [])
    console.log('thin-native-without-kernel: actual read/grep/bash/PSS-revoke; network=0; HOME unchanged')
  } finally {
    if (session) {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
      session.dispose()
    }
    globalThis.fetch = saved.fetch
    if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = saved.agent
  }
})
