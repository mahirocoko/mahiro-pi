// Disposable real SDK/Faux/PSS diagnostic: never reads installed profile or private memory.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const product = fileURLToPath(new URL('../..', import.meta.url))
const previous = { ...process.env }
const previousCwd = process.cwd()
const originalFetch = globalThis.fetch
let fixture, session, ctx, serviceForSession
let externalFetches = 0
const errors = []
const denyNote = process.argv.includes('--deny-note')
try {
  for (const key of Object.keys(process.env))
    if (/^(GIT_|PI_|MAHIRO_)/.test(key) || /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key))
      delete process.env[key]
  globalThis.fetch = () => {
    externalFetches++
    throw Error('No external fetch in memory usability fixture')
  }
  const fixtures = await import('../../lib/guards/memory-fixture.mjs')
  fixture = await fixtures.createDisposableMemoryFixture()
  Object.assign(process.env, {
    HOME: fixture.home,
    PI_CODING_AGENT_DIR: fixture.agentDir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(fixture.home, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: fixture.directory,
    GIT_TERMINAL_PROMPT: '0',
  })
  process.chdir(fixture.cwd)
  fs.writeFileSync(
    path.join(fixture.home, '.gitconfig'),
    '[user]\n name = Synthetic SDK\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
    { mode: 0o600 },
  )
  const sdk = await import('@earendil-works/pi-coding-agent')
  const ai = await import('@earendil-works/pi-ai')
  const permissions = fs.realpathSync(path.join(product, 'node_modules/@gotgenes/pi-permission-system'))
  const subagents = fs.realpathSync(path.join(product, 'node_modules/@gotgenes/pi-subagents'))
  const capability = `managed_memory_${createHash('sha256').update(fixture.root).digest('hex')}`
  const permissionPath = path.join(fixture.agentDir, 'extensions/pi-permission-system/config.json')
  fs.mkdirSync(path.dirname(permissionPath), { recursive: true })
  const policy = {
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
      ...(denyNote ? { path_write: { [path.join(fixture.root, 'system/human/notes.md')]: 'deny' } } : {}),
    },
  }
  fs.writeFileSync(permissionPath, JSON.stringify(policy), { mode: 0o600 })
  fs.mkdirSync(path.join(fixture.agentDir, 'extensions/pi-subagents'), { recursive: true })
  fs.writeFileSync(
    path.join(fixture.agentDir, 'extensions/pi-subagents/config.json'),
    JSON.stringify({ excludedExtensionPackages: [subagents] }),
    { mode: 0o600 },
  )
  fs.symlinkSync(path.join(product, 'node_modules'), path.join(fixture.directory, 'node_modules'), 'dir')
  const observerFile = path.join(fixture.directory, 'permission-observer.ts')
  fs.writeFileSync(
    observerFile,
    `import { getPermissionsService } from '@gotgenes/pi-permission-system';
export default pi => { pi.on('session_start', (_event, ctx) =>
  pi.events.emit('fixture:memory-permissions', () => getPermissionsService(ctx.sessionManager.getSessionId()))); };`,
  )
  const runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const faux = ai.fauxProvider({
    provider: 'memory-usability-offline',
    models: [{ id: 'usability', contextWindow: 32768, maxTokens: 4096 }],
  })
  runtime.registerNativeProvider({
    id: faux.provider.id,
    name: faux.provider.name,
    auth: faux.provider.auth,
    getModels: () => faux.provider.getModels(),
    stream: (...args) => faux.provider.stream(...args),
    streamSimple: (...args) => faux.provider.streamSimple(...args),
  })
  const settingsManager = sdk.SettingsManager.inMemory({
    packages: [permissions, subagents, product],
    skills: [],
    themes: [],
    prompts: [],
    cacheWarming: 'off',
    retry: { enabled: false },
    compaction: { enabled: false },
  })
  const loader = new sdk.DefaultResourceLoader({
    cwd: fixture.cwd,
    agentDir: fixture.agentDir,
    settingsManager,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    disabledBuiltinExtensions: ['mcp'],
    systemPromptOverride: () => 'Synthetic offline memory usability regression.',
    additionalExtensionPaths: [observerFile],
    extensionFactories: [
      (pi) => {
        pi.events.on('fixture:memory-permissions', (getService) => {
          serviceForSession = getService
        })
        pi.on('session_start', (_, context) => {
          ctx = context
        })
      },
    ],
  })
  await loader.reload()
  assert.deepEqual(loader.getExtensions().errors, [])
  const manager = sdk.SessionManager.create(fixture.cwd, path.join(fixture.directory, 'sessions'))
  ;({ session } = await sdk.createAgentSession({
    cwd: fixture.cwd,
    agentDir: fixture.agentDir,
    modelRuntime: runtime,
    model: faux.getModel(),
    thinkingLevel: 'off',
    resourceLoader: loader,
    settingsManager,
    sessionManager: manager,
    tools: ['agent_memory_read', 'agent_memory_manage', 'agent_memory_reflect'],
  }))
  fixtures.selectManagedMemoryFixture(manager, fixture.capability)
  const diagnostic = fixture.startDiagnostics()
  await session.bindExtensions({
    onError: (error) => errors.push({ event: error.event, message: error.message }),
  })
  const permissionService = serviceForSession()
  assert.ok(permissionService)
  assert.equal(permissionService.checkPermission(capability).state, 'allow')
  if (denyNote)
    assert.equal(
      permissionService.checkPermission('path_write', path.join(fixture.root, 'system/human/notes.md')).state,
      'deny',
    )
  const manage = async (action, extra = {}) => {
    let result
    try {
      result = await session
        .getToolDefinition('agent_memory_manage')
        .execute(`synthetic-${action}`, { action, ...extra }, undefined, undefined, ctx)
    } catch (error) {
      const evidence = diagnostic()
      console.log(
        JSON.stringify({
          action,
          error: error.message,
          firstError: evidence.firstError,
          recentEvents: evidence.events.slice(-8),
        }),
      )
      throw error
    }
    console.log(
      JSON.stringify({ action, isError: result.isError, details: result.details, content: result.content }),
    )
    return result
  }
  assert.equal(fs.existsSync(fixture.root), false)
  assert.equal(
    (
      await manage('initialize', {
        core: '# Core\nSYNTHETIC_USABILITY_CORE\n',
        projectId: 'synthetic',
        automatic: false,
      })
    ).details.initialized,
    true,
  )
  // No installed writer in this disposable profile: readiness is not the live Ready claim.
  assert.equal((await manage('status')).details.storage, 'authorized')
  assert.equal((await manage('doctor')).details.healthy, true)
  assert.equal((await manage('palace')).details.healthy, true)
  const initializedProject = await manage('init-project')
  assert.ok(initializedProject.details.revision)
  if (denyNote) {
    await assert.rejects(manage('remember', { text: 'SYNTHETIC_DENIED_NOTE' }), /reason: unknown/)
    assert.ok(diagnostic().events.some((event) => event.event === 'checkpoint' && event.allow === false))
    assert.equal((await manage('doctor')).details.healthy, true)
    assert.equal((await manage('status')).details.storage, 'authorized')
    console.log(JSON.stringify({ deniedNote: true, storageStillAuthorized: true, externalFetches }))
  } else {
    const remembered = await manage('remember', {
      text: 'SYNTHETIC_USABILITY_REMEMBER: disposable fact only.',
    })
    assert.equal(remembered.isError, undefined)
    assert.equal(remembered.details.remembered, true)
    const read = async (args) => {
      const result = await session
        .getToolDefinition('agent_memory_read')
        .execute('synthetic-read', args, undefined, undefined, ctx)
      assert.equal(result.isError, undefined)
      return result.details
    }
    assert.match((await read({ path: 'system/human/notes.md' })).text, /SYNTHETIC_USABILITY_REMEMBER/)
    assert.ok(await read({ query: 'SYNTHETIC_USABILITY_REMEMBER' }))
    assert.ok(await read({ topic: '*', limit: 4 }))
    assert.equal(
      (await manage('remember', { text: 'SYNTHETIC_SECOND_NOTE', section: 'Facts' })).details.remembered,
      true,
    )
    assert.match((await read({ path: 'system/human/notes.md' })).text, /SYNTHETIC_SECOND_NOTE/)
    const doctor = await manage('doctor')
    assert.equal(doctor.isError, undefined)
    assert.equal(doctor.details.healthy, true)
    assert.equal((await manage('status')).details.storage, 'authorized')
    faux.setResponses([() => ai.fauxAssistantMessage('SYNTHETIC_OFFLINE_COMPLETE')])
    await session.prompt('Synthetic offline usability check, no tool calls.', { source: 'extension' })
    await session.waitForIdle()
    assert.equal(faux.state.callCount, 1)
    assert.equal((await manage('status')).details.storage, 'authorized')
    assert.equal(externalFetches, 0)
    assert.deepEqual(errors, [])
    assert.equal(diagnostic().firstError, undefined)
    console.log(
      JSON.stringify({
        passed: true,
        initProjectThenRemember: true,
        postRememberReadSearchTopics: true,
        fauxCalls: faux.state.callCount,
        engineDiagnosticEvents: diagnostic().count,
        externalFetches,
      }),
    )
  }
} finally {
  if (session) {
    await session.waitForIdle()
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
    session.dispose()
  }
  process.chdir(previousCwd)
  globalThis.fetch = originalFetch
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
  Object.assign(process.env, previous)
  await fixture?.dispose()
}
