// Runs only in a disposable public-owner stage; normal HOME is intentionally retained.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'

const primary = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const stage = path.dirname(primary)
const sha = (value) => createHash('sha256').update(value).digest('hex')

test('bootstrap kernel serves genuine Goal without Root; PSS, native child, fork and generation fences remain', async () => {
  assert.match(stage, /\.agent-state\/runtime\/guard-redesign-A\/phase-1\//)
  const cwd = path.join(stage, 'project'),
    agentDir = path.join(stage, 'profile')
  for (const dir of [cwd, agentDir]) fs.mkdirSync(dir, { mode: 0o700 })
  const saved = { agent: process.env.PI_CODING_AGENT_DIR, fetch: globalThis.fetch, home: process.env.HOME }
  process.env.PI_CODING_AGENT_DIR = agentDir
  let network = 0
  globalThis.fetch = () => {
    network++
    throw Error('External network prohibited')
  }
  const root = path.join(agentDir, 'workflow/goals', sha(cwd))
  const capability = `goal_state_${sha(root)}`
  const config = path.join(agentDir, 'extensions/pi-permission-system/config.json')
  const goalConfig = path.join(agentDir, 'extensions/mahiro-goal/config.json')
  for (const file of [config, goalConfig]) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(goalConfig, JSON.stringify({ version: 1, profile: agentDir, projects: [cwd] }), {
    mode: 0o600,
  })
  const policy = (permission, yoloMode = false) =>
    fs.writeFileSync(config, JSON.stringify({ authorizerChain: [], permission, yoloMode }), { mode: 0o600 })
  const grant = (decision = 'allow') => policy({ '*': 'deny', mh_get_goal: decision, [capability]: 'allow' })
  grant()
  fs.mkdirSync(path.join(agentDir, 'agents'))
  fs.writeFileSync(
    path.join(agentDir, 'agents/kernel-fixture.md'),
    '---\nname: kernel-fixture\ntools: [mh_get_goal]\nprompt_mode: replace\n---\nOffline fixture status only.\n',
  )
  fs.writeFileSync(path.join(agentDir, 'subagents.json'), JSON.stringify({ maxConcurrent: 1 }))
  const packages = [
    {
      source: primary,
      extensions: ['lib/guards/bootstrap.ts', 'extensions/mahiro-goal.ts'],
      skills: [],
      prompts: [],
      themes: [],
    },
    fs.realpathSync(path.join(primary, 'node_modules/@gotgenes/pi-permission-system')),
    fs.realpathSync(path.join(primary, 'node_modules/@gotgenes/pi-subagents')),
  ]
  const key = Symbol.for(`kernel-fixture:${path.basename(stage)}`)
  const contexts = []
  globalThis[key] = contexts
  const observer = path.join(stage, 'observer.ts')
  fs.symlinkSync(path.join(primary, 'node_modules'), path.join(stage, 'node_modules'), 'dir')
  fs.writeFileSync(
    observer,
    `import {getSubagentsServiceForSession} from '@gotgenes/pi-subagents';
import {getPermissionsService} from '@gotgenes/pi-permission-system';
export default pi=>pi.on('before_agent_start',(_event,ctx)=>{
 globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})].push({ctx,tools:pi.getAllTools(),service:getSubagentsServiceForSession(ctx.sessionManager),permissions:getPermissionsService(ctx.sessionManager.getSessionId())});
});`,
  )
  fs.writeFileSync(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({
      packages,
      extensions: [observer],
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
  const faux = ai.fauxProvider({ provider: 'kernel-offline', models: [{ id: 'fixture' }] })
  runtime.registerNativeProvider(faux.provider)
  const opened = []
  const errors = []
  const make = async (manager) => {
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
        .extensions.some((entry) => entry.path === path.join(primary, 'lib/guards/index.ts')),
      false,
      'Root explicitly omitted from actual loaded resources',
    )
    const definitions = new Map(
      loader
        .getExtensions()
        .extensions.flatMap((entry) =>
          [...entry.tools.values()].map((tool) => [tool.definition.name, tool.definition]),
        ),
    )
    const { session } = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager,
      resourceLoader: loader,
      modelRuntime: runtime,
      model: faux.getModel(),
      sessionManager: manager,
    })
    opened.push(session)
    await session.bindExtensions({ onError: (event) => errors.push(event) })
    return { session, definitions }
  }
  const ask = async (session, name = 'mh_get_goal', args = {}) => {
    faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxToolCall(name, args)], { stopReason: 'toolUse' }),
      ai.fauxAssistantMessage('offline status complete'),
    ])
    const before = session.messages.length
    await session.prompt('Read fixture status; do not create a Goal')
    return session.messages.slice(before).find((message) => message.role === 'toolResult')
  }
  try {
    const manager = sdk.SessionManager.create(cwd, path.join(stage, 'sessions'))
    const first = await make(manager)
    const result = await ask(first.session)
    assert.equal(result?.isError, false, JSON.stringify(result))
    assert.match(JSON.stringify(result), /completion_issues/)
    const parent = contexts.find((entry) => entry.ctx.sessionManager === manager)
    assert.ok(parent?.service, 'genuine scoped native parent service')
    const nodes = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')]
    const node = nodes.get(manager.getSessionId())
    assert.ok(node.healthy())
    assert.equal(node.guard, undefined)
    assert.equal(node.isPrimarySession(parent.ctx), true)
    assert.equal(fs.existsSync(path.join(root, 'state.json')), false, 'status/startup provisions no Goal')
    policy({ '*': 'allow' })
    assert.equal(
      (await ask(first.session))?.isError,
      false,
      'standard wildcard is sufficient without DATA grant',
    )
    policy({ '*': 'allow', [capability]: 'deny' })
    assert.equal(
      (await ask(first.session))?.isError,
      false,
      'obsolete DATA capability is not a second permission plane',
    )
    policy({ '*': 'ask' }, true)
    assert.equal((await ask(first.session))?.isError, false, 'public PSS yolo effective allow is honored')
    policy({ '*': 'allow', mh_get_goal: 'deny' }, true)
    assert.equal(
      (await ask(first.session))?.isError,
      true,
      'specific deny follows actual public PSS precedence',
    )
    policy({ '*': 'allow', path_read: { [root]: 'deny' } })
    assert.equal((await ask(first.session))?.isError, true, 'explicit state path denial remains effective')
    assert.equal(
      (await ask(first.session, 'mh_rtk', { operation: 'status' }))?.isError,
      false,
      'RTK wildcard status is available before scalar restriction',
    )
    policy({ '*': 'allow', read: 'deny' })
    const scalar = parent.permissions.checkPermission('read', root)
    assert.equal(scalar.state, 'deny')
    assert.equal(scalar.matchedSurface, 'read')
    assert.equal(
      scalar.matchedPattern,
      '*',
      'public PSS attributes scalar read rules to a wildcard path pattern',
    )
    const rtkScalarDenied = await ask(first.session, 'mh_rtk', { operation: 'status' })
    assert.equal(
      rtkScalarDenied?.isError,
      true,
      'RTK honors scalar read denial with actual public PSS attribution',
    )
    policy({ '*': 'allow', path_read: 'deny' })
    assert.equal((await ask(first.session))?.isError, true, 'scalar path_read denial remains effective')
    grant('deny')
    assert.equal((await ask(first.session))?.isError, true, 'live PSS revocation refuses actual dispatch')
    assert.equal(node.healthy(), true, 'policy denial is not kernel lifecycle failure')
    grant()
    assert.equal((await ask(first.session))?.isError, false)

    let childResult
    faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxToolCall('mh_get_goal', {})], { stopReason: 'toolUse' }),
      (context) => {
        childResult = context.messages.find((message) => message.role === 'toolResult')
        return ai.fauxAssistantMessage('native child status refused')
      },
    ])
    const job = parent.service.spawn('kernel-fixture', 'Read fixture status only', { claimOutcome: true })
    await parent.service.waitForAll()
    assert.equal(parent.service.getRecord(job).status, 'completed')
    assert.equal(childResult?.isError, true, JSON.stringify(childResult))
    const child = contexts.find((entry) => entry.ctx.sessionManager !== manager)
    assert.ok(child)
    assert.notEqual(child.ctx.sessionManager, manager)
    assert.ok(nodes.nativeChildren.has(child.ctx.sessionManager.getSessionId()))
    assert.equal(nodes.nativeParents.get(child.ctx.sessionManager.getSessionId()), manager.getSessionId())
    assert.equal(node.isPrimarySession(child.ctx), false)
    assert.equal(node.managedMemory.parentService(), parent.service, 'child cannot replace parent service')
    assert.equal((await ask(first.session))?.isError, false, 'parent survives native child disposal')

    const fork = sdk.SessionManager.forkFrom(manager.getSessionFile(), cwd, path.join(stage, 'forks'))
    const forked = await make(fork)
    assert.ok(fork.getHeader().parentSession)
    assert.equal((await ask(forked.session))?.isError, true, 'genuine fork header is not primary')

    const replacementManager = sdk.SessionManager.open(manager.getSessionFile())
    const replacement = await make(replacementManager)
    assert.equal((await ask(replacement.session))?.isError, false)
    const next = nodes.get(manager.getSessionId())
    assert.notEqual(next.generation, node.generation)
    assert.equal(node.healthy(), false, 'superseded generation retired')
    await assert.rejects(
      first.definitions.get('mh_get_goal').execute('old', {}, undefined, undefined, parent.ctx),
      /requires the active primary session; child, fork and retired owners/,
    )
    await first.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
    first.session.dispose()
    assert.equal(nodes.get(manager.getSessionId()), next, 'old cleanup cannot remove replacement')
    assert.equal((await ask(replacement.session))?.isError, false)
    await replacement.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
    replacement.session.dispose()
    assert.equal(nodes.has(manager.getSessionId()), false)
    assert.equal(network, 0)
    assert.equal(process.env.HOME, saved.home)
    assert.deepEqual(errors, [])
    console.log(
      'kernel-without-root: genuine Goal/PSS/native-child/fork/generation/disposal; network=0; HOME unchanged',
    )
  } finally {
    for (const session of opened) {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
      session.dispose()
    }
    globalThis.fetch = saved.fetch
    if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = saved.agent
    delete globalThis[key]
  }
})
