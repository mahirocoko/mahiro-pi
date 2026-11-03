// Disposable real SDK/PSS/kernel + blocked real native Git hook. No live profile or root.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const product = fileURLToPath(new URL('../..', import.meta.url))
const previous = { ...process.env }
const previousCwd = process.cwd()
const originalFetch = globalThis.fetch
let fixture,
  runtime,
  session,
  ctx,
  releaseHook,
  publication,
  retirement,
  heldRelease,
  getPermissions,
  getAllTools
let externalFetches = 0
const errors = []
const notifications = []
const wait = async (condition) => {
  for (let i = 0; i < 1500; i++) {
    if (condition()) return
    await delay(20)
  }
  throw Error('Bounded synthetic wait exhausted')
}
try {
  for (const key of Object.keys(process.env))
    if (/^(GIT_|PI_|MAHIRO_)/.test(key) || /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key))
      delete process.env[key]
  globalThis.fetch = () => {
    externalFetches++
    throw Error('No external fetch in retirement fixture')
  }
  const fixtures = await import('../../lib/guards/memory-fixture.mjs')
  const disposable = await fixtures.createDisposableMemoryFixture()
  fixture = { ...disposable, root: path.join(disposable.agentDir, 'memory') }
  fs.writeFileSync(
    path.join(fixture.agentDir, '.mahiro-memory-engine.json'),
    JSON.stringify({ version: 2, mode: 'engine', root: fixture.root }),
    { mode: 0o600 },
  )
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
  fs.writeFileSync(
    permissionPath,
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
    { mode: 0o600 },
  )
  fs.mkdirSync(path.join(fixture.agentDir, 'extensions/pi-subagents'), { recursive: true })
  fs.writeFileSync(
    path.join(fixture.agentDir, 'extensions/pi-subagents/config.json'),
    JSON.stringify({ excludedExtensionPackages: [subagents] }),
    { mode: 0o600 },
  )
  fs.symlinkSync(path.join(product, 'node_modules'), path.join(fixture.directory, 'node_modules'), 'dir')
  const observer = path.join(fixture.directory, 'permission-observer.ts')
  fs.writeFileSync(
    observer,
    `import { getPermissionsService } from '@gotgenes/pi-permission-system';
export default pi => { pi.on('session_start', (_event, ctx) =>
  pi.events.emit('fixture:retirement-permissions', () => getPermissionsService(ctx.sessionManager.getSessionId()))); };`,
  )
  const modelRuntime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const faux = ai.fauxProvider({
    provider: 'memory-retirement-offline',
    models: [{ id: 'retirement', contextWindow: 32768, maxTokens: 4096 }],
  })
  modelRuntime.registerNativeProvider({
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
  const resourceLoaderOptions = {
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    disabledBuiltinExtensions: ['mcp'],
    systemPromptOverride: () => 'Synthetic retirement test.',
    additionalExtensionPaths: [observer],
    extensionFactories: [
      (pi) => {
        pi.events.on('fixture:retirement-permissions', (getService) => {
          getPermissions = getService
        })
        getAllTools = () => pi.getAllTools()
        pi.on('session_start', (_, context) => {
          ctx = context
        })
      },
    ],
  }
  const createRuntime = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    const services = await sdk.createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      settingsManager,
      resourceLoaderOptions,
    })
    assert.deepEqual(services.resourceLoader.getExtensions().errors, [])
    return {
      ...(await sdk.createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model: faux.getModel(),
        thinkingLevel: 'off',
        tools: ['agent_memory_read', 'agent_memory_manage', 'agent_memory_reflect'],
      })),
      services,
      diagnostics: services.diagnostics,
    }
  }
  const manager = sdk.SessionManager.create(fixture.cwd, path.join(fixture.directory, 'sessions'))
  runtime = await sdk.createAgentSessionRuntime(createRuntime, {
    cwd: fixture.cwd,
    agentDir: fixture.agentDir,
    sessionManager: manager,
  })
  session = runtime.session
  await session.bindExtensions({
    onError: (error) => errors.push({ event: error.event, message: error.message }),
  })
  const nodes = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')]
  const node = nodes.get(session.sessionId)
  const abi = node.managedMemory
  const manageTool = session.getToolDefinition('agent_memory_manage')
  const command = session.extensionRunner.getCommand('mh-memory')
  const nativeCommandCtx = session.extensionRunner.createCommandContext()
  const commandCtx = {
    ...nativeCommandCtx,
    ui: { ...nativeCommandCtx.ui, notify: (text) => notifications.push(text) },
  }
  const callCommand = (args) => command.handler(args, commandCtx)
  assert.equal(fs.existsSync(fixture.root), false, 'startup provisions nothing')
  assert.equal(typeof abi.retireMemory, 'function')
  const retire = abi.retireMemory
  // The real public command reports unsupported for old loaded owners without attempting cancellation.
  abi.retireMemory = undefined
  await callCommand('retire')
  assert.equal(JSON.parse(notifications.pop()).state, 'unsupported')
  abi.version = 1
  await callCommand('retire')
  assert.equal(JSON.parse(notifications.pop()).state, 'unsupported')
  abi.version = 2
  abi.retireMemory = retire
  const actual = getAllTools().find((entry) => entry.name === 'agent_memory_manage')
  assert.ok(actual)
  for (const probe of [
    () => retire(actual, ctx, `${fixture.root}-foreign`),
    () => retire({ ...actual, sourceInfo: { ...actual.sourceInfo, path: '/foreign' } }, ctx, fixture.root),
    () => retire(actual, { ...ctx, sessionManager: { ...manager } }, fixture.root),
    () => retire(actual, { ...ctx, signal: AbortSignal.abort() }, fixture.root),
  ])
    assert.throws(probe)
  const permissionService = getPermissions()
  const check = permissionService.checkPermission
  for (const denied of [capability, 'agent_memory_manage', 'path_write']) {
    permissionService.checkPermission = function (surface, ...args) {
      if (surface === denied) return { state: 'deny', source: 'tool', matchedPattern: '*' }
      return check.call(this, surface, ...args)
    }
    assert.throws(() => retire(actual, ctx, fixture.root), /permission|authority/)
  }
  permissionService.checkPermission = check
  nodes.set(session.sessionId, { ...node, generation: {} })
  assert.throws(() => retire(actual, ctx, fixture.root), /primary/)
  nodes.set(session.sessionId, node)
  assert.equal(abi.live(), true, 'all rejected probes leave admission open')
  const manage = (action, extra = {}) =>
    manageTool.execute(`synthetic-${action}`, { action, ...extra }, undefined, undefined, ctx)
  assert.equal(
    (
      await manage('initialize', {
        core: '# Core\nSYNTHETIC_RETIREMENT\n',
        projectId: 'synthetic',
        automatic: false,
      })
    ).details.initialized,
    true,
  )
  await manage('init-project')
  assert.equal(typeof abi.preparedRetirementAccess, 'function')
  abi.preparedRetirementAccess(actual, ctx, fixture.root, [path.join(fixture.root, 'Core.md')])
  for (const probe of [
    () => abi.preparedRetirementAccess(actual, ctx, `${fixture.root}-foreign`, []),
    () => abi.preparedRetirementAccess(actual, { ...ctx, sessionManager: { ...manager } }, fixture.root, []),
    () => abi.preparedRetirementAccess(actual, ctx, fixture.root, [path.dirname(fixture.root)]),
  ])
    assert.throws(probe)
  await callCommand('prepared-retire status') // no strict prepared operation: diagnostic refusal, no retirement
  assert.doesNotMatch(notifications.pop(), /"onlineEligible":true/)
  assert.equal(abi.live(), true)
  const started = path.join(fixture.directory, 'hook-started')
  const release = path.join(fixture.directory, 'hook-release')
  releaseHook = () => fs.writeFileSync(release, '')
  fs.writeFileSync(
    path.join(fixture.root, '.git/hooks/pre-commit'),
    `#!/bin/sh\necho started > '${started}'\nwhile [ ! -f '${release}' ]; do sleep 0.02; done\n`,
    { mode: 0o700 },
  )
  publication = manage('remember', { text: 'Synthetic pending native publication.' }).then(
    () => 'resolved',
    () => 'rejected',
  )
  await wait(() => fs.existsSync(started))
  heldRelease = abi.hold({ syntheticLateOwner: true })
  let drained = false
  retirement = callCommand('retire').then(() => {
    drained = true
  })
  const staleAbort = new AbortController()
  const staleResult = retire(actual, { ...ctx, signal: staleAbort.signal }, fixture.root).then(
    () => 'drained',
    () => 'rejected',
  )
  staleAbort.abort()
  assert.equal(abi.live(), false, 'fence is synchronous even through command/router')
  assert.equal(nodes.get(session.sessionId), node, 'foreground node is not removed')
  assert.equal(node.healthy(), true)
  assert.equal(node.isPrimarySession(ctx), true)
  assert.throws(() => abi.hold({}), /retir/)
  await delay(50)
  assert.equal(drained, false, 'real native hook still owns publication')
  faux.setResponses([() => ai.fauxAssistantMessage('SYNTHETIC_FOREGROUND_CONTINUES')])
  await session.prompt('Continue foreground, no tool calls.', { source: 'extension' })
  await session.waitForIdle()
  assert.equal(faux.state.callCount, 1, 'foreground completes while memory drain remains pending')
  assert.equal(drained, false)
  assert.deepEqual(await node.context.finalArgs('synthetic', { foreground: true }, ctx), { foreground: true })
  releaseHook()
  await publication
  await delay(50)
  assert.equal(drained, false, 'publication join alone does not release another held memory owner')
  // Lose PSS while joining: actual drain is not permission to return a success certificate.
  permissionService.checkPermission = function (surface, ...args) {
    if (surface === capability) return { state: 'deny', source: 'tool' }
    return check.call(this, surface, ...args)
  }
  heldRelease()
  heldRelease = undefined
  await retirement
  assert.doesNotMatch(notifications.pop(), /\"state\":\s*\"drained\"/)
  assert.equal(await staleResult, 'rejected', 'aborted caller cannot receive the eventual drain result')
  permissionService.checkPermission = check
  await callCommand('retire') // fresh existing authority can observe the same completed local join
  const result = JSON.parse(notifications.pop())
  assert.deepEqual(result, { state: 'drained', scope: 'memory-generation', globalQuiescence: false })
  // Read-only exact-PSS handoff authority remains valid after this generation has actually drained.
  abi.preparedRetirementAccess(actual, ctx, fixture.root, [path.join(fixture.root, 'Core.md')])
  await session.extensionRunner.emit({ type: 'session_start' })
  assert.equal(nodes.get(session.sessionId).managedMemory.live(), false, 'same generation cannot reactivate')
  assert.equal(nodes.get(session.sessionId).generation, node.generation)
  assert.equal(nodes.get(session.sessionId).healthy(), true)

  // Public SDK replacement, not a synthetic session_start or an in-place/live reload.
  const savedId = session.sessionId
  const savedFile = session.sessionFile
  const savedCwd = manager.getCwd()
  assert.ok(savedFile && fs.existsSync(savedFile), 'foreground turn saved this exact session')
  const oldSession = session
  assert.deepEqual(await runtime.switchSession(savedFile), { cancelled: false })
  session = runtime.session
  await session.bindExtensions({
    onError: (error) => errors.push({ event: error.event, message: error.message }),
  })
  assert.notEqual(session, oldSession)
  assert.equal(session.sessionId, savedId)
  assert.equal(session.sessionFile, savedFile)
  assert.equal(session.sessionManager.getCwd(), savedCwd)
  const recovered = nodes.get(savedId)
  assert.notEqual(recovered, node)
  assert.notEqual(recovered.generation, node.generation)
  assert.equal(abi.live(), false, 'retired owner stays fenced after replacement')
  assert.equal(recovered.healthy(), true)
  assert.equal(recovered.isPrimarySession(ctx), true)
  assert.equal(recovered.managedMemory.live(), true)
  const recoveredManage = (action) =>
    session
      .getToolDefinition('agent_memory_manage')
      .execute(`recovered-${action}`, { action }, undefined, undefined, ctx)
  assert.equal((await recoveredManage('status')).details.storage, 'authorized')
  const recoveredRead = await session
    .getToolDefinition('agent_memory_read')
    .execute('recovered-core', { path: 'Core.md' }, undefined, undefined, ctx)
  assert.equal(recoveredRead.isError, undefined)
  assert.match(recoveredRead.details.text, /SYNTHETIC_RETIREMENT/)
  const recoveredTool = getAllTools().find((entry) => entry.name === 'agent_memory_manage')
  assert.throws(() => recovered.managedMemory.retireMemory(recoveredTool, ctx, `${fixture.root}-foreign`))
  assert.equal(recovered.managedMemory.live(), true, 'original exact-root authority remains selected')
  assert.deepEqual(await recovered.context.finalArgs('synthetic', { foreground: true }, ctx), {
    foreground: true,
  })
  assert.equal(externalFetches, 0)
  assert.deepEqual(errors, [])
} finally {
  try {
    releaseHook?.()
    heldRelease?.()
    await publication
    await retirement
    if (runtime) {
      await runtime.session.waitForIdle()
      await runtime.dispose()
    }
  } finally {
    process.chdir(previousCwd)
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
    await fixture?.dispose()
  }
}
// Shutdown handlers report through onError even when public disposal resolves.
assert.deepEqual(errors, [])
assert.equal(externalFetches, 0)
console.log(
  JSON.stringify({
    passed: true,
    blockedNativeHook: true,
    foregroundContinued: true,
    holdsJoined: true,
    unsupported: true,
    authorityAndGenerationFences: true,
    sameSessionNewGenerationRecovery: true,
    publicLifecycle: 'AgentSessionRuntime.switchSession',
    liveReloadProven: false,
    externalFetches,
  }),
)
