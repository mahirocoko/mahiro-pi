// Genuine declared public SDK: disposable resources, Faux inference, no installed state.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'
import { createMemoryStore } from '../../agent-memory/store.ts'
import { featureGrants } from '../../feature-data.ts'

const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const primary = path.resolve(adapter, '../..')
const sha = (text) => createHash('sha256').update(text).digest('hex')

test('registered installed resources and native composite remain usable through guarded SDK dispatch', async () => {
  const fixture = fs.mkdtempSync(path.join(path.dirname(primary), 'friction-native-'))
  const cwd = path.join(fixture, 'project')
  const agentDir = path.join(fixture, 'profile')
  const installed = path.join(fixture, 'installed')
  const memory = path.join(fixture, 'memory')
  for (const directory of [cwd, agentDir, installed]) fs.mkdirSync(directory, { mode: 0o700 })
  const saved = {
    profile: process.env.PI_CODING_AGENT_DIR,
    memory: process.env.MAHIRO_AGENT_MEMORY_ROOT,
    fetch: globalThis.fetch,
  }
  process.env.PI_CODING_AGENT_DIR = agentDir
  process.env.MAHIRO_AGENT_MEMORY_ROOT = memory
  let external = 0
  globalThis.fetch = () => {
    external++
    throw Error('Offline fixture forbids external requests')
  }
  const permissions = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-permission-system'))
  const subagents = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-subagents'))
  fs.writeFileSync(path.join(cwd, 'safe.txt'), 'NATIVE_FRICTION_SAFE\nquery .env is only text\n')
  fs.writeFileSync(path.join(cwd, '.env'), 'NEVER_RETURN_SECRET\n')
  const store = createMemoryStore(memory)
  store.initialize(
    {
      version: 1,
      projects: [{ cwd, id: 'fixture' }],
      coreBytes: 8192,
      indexBytes: 2048,
      fileBytes: 8192,
      totalBytes: 65536,
      automatic: false,
    },
    '# Core\nFriction fixture.\n',
  )
  const featureEntries = [
    'mahiro-native-utilities.ts',
    'mahiro-agent-memory.ts',
    'mahiro-continuity.ts',
    'mahiro-goal.ts',
    'mahiro-code-evidence.ts',
    'mahiro-ux-workflow.ts',
    'mahiro-execution-run.ts',
  ]
  for (const entry of featureEntries)
    fs.symlinkSync(path.join(primary, 'extensions', entry), path.join(installed, entry))
  const key = `guard-friction-${path.basename(fixture)}`
  const observed = { nodes: [], calls: [], results: [] }
  globalThis[Symbol.for(key)] = observed
  const observer = path.join(fixture, 'observer.ts')
  fs.writeFileSync(
    observer,
    `export default pi => {
    const state = globalThis[Symbol.for(${JSON.stringify(key)})];
    pi.on('before_agent_start', (_e, ctx) => state.nodes.push({ pi, ctx }));
    pi.on('tool_call', e => state.calls.push({...e}));
    pi.on('tool_result', e => state.results.push({...e}));
  }`,
  )
  const config = path.join(agentDir, 'extensions/pi-permission-system/config.json')
  fs.mkdirSync(path.dirname(config), { recursive: true })
  const basePolicy = {
    '*': 'allow',
    ...Object.fromEntries(featureGrants(agentDir).map((name) => [name, 'allow'])),
    [`managed_memory_${sha(memory)}`]: 'allow',
    path_read: { '*': 'allow', [path.join(cwd, '.env')]: 'deny' },
    bash: { '*': 'allow', 'cat .env*': 'deny', 'FORBIDDEN_SPAWN*': 'deny' },
  }
  const grant = (changes = {}) =>
    fs.writeFileSync(
      config,
      JSON.stringify({ yoloMode: false, authorizerChain: [], permission: { ...basePolicy, ...changes } }),
    )
  grant()
  fs.writeFileSync(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({
      packages: [
        permissions,
        subagents,
        {
          source: primary,
          extensions: ['lib/guards/bootstrap.ts', 'lib/guards/index.ts'],
          skills: [],
          themes: [],
          prompts: [],
        },
      ],
      extensions: [...featureEntries.map((entry) => path.join(installed, entry)), observer],
      defaultTools: ['+codemode'],
      skills: [],
      prompts: [],
      themes: [],
      cacheWarming: 'off',
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
  )
  fs.writeFileSync(
    path.join(agentDir, 'subagents.json'),
    JSON.stringify({ excludedExtensionPackages: [subagents] }),
  )
  fs.mkdirSync(path.join(agentDir, 'agents'))
  fs.writeFileSync(
    path.join(agentDir, 'agents/friction.md'),
    '---\ndescription: Offline primary-negative fixture\ntools: read, mh_create_goal, mh_rtk, mh_execution_run\nprompt_mode: replace\n---\nGUARD_FRICTION_CHILD\n',
  )
  const runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const faux = ai.fauxProvider({ provider: 'guard-friction-offline', models: [{ id: 'fixture' }] })
  runtime.registerNativeProvider(faux.provider)
  const settingsManager = sdk.SettingsManager.create(cwd, agentDir)
  let session, pi, context
  const errors = []
  try {
    const loader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ['mcp'],
      extensionFactories: [
        { name: 'codemode', builtin: true, factory: sdk.createCodemodeExtension() },
        (api) => {
          pi = api
          api.on('before_agent_start', (_event, ctx) => {
            context = ctx
          })
        },
      ],
    })
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    const created = await sdk.createAgentSession({
      cwd,
      agentDir,
      resourceLoader: loader,
      settingsManager,
      modelRuntime: runtime,
      model: faux.getModel(),
      sessionManager: sdk.SessionManager.inMemory(cwd),
    })
    session = created.session
    await session.bindExtensions({
      mode: 'rpc',
      onError: (error) => errors.push(error),
      uiContext: {
        notify() {},
        setStatus() {},
        setWidget() {},
        setWorkingMessage() {},
        select: async () => 'deny',
      },
    })
    const call = async (name, args, error = false) => {
      let messages
      faux.setResponses([
        ai.fauxAssistantMessage([ai.fauxToolCall(name, args)]),
        (ctx) => {
          messages = ctx.messages
          return ai.fauxAssistantMessage('Done')
        },
      ])
      await session.prompt('Guard friction offline fixture')
      const result = messages.filter((m) => m.role === 'toolResult').at(-1)
      assert.equal(result.toolName, name)
      assert.equal(!!result.isError, error, JSON.stringify(result))
      return result
    }
    const read = await call('read', { path: 'safe.txt' })
    assert.match(JSON.stringify(read), /NATIVE_FRICTION_SAFE/)
    assert.match(
      JSON.stringify(await call('grep', { pattern: '.env', path: 'safe.txt', literal: true })),
      /only text/,
    )
    assert.match(
      JSON.stringify(await call('bash', { command: 'printf NATIVE_BASH_SAFE' })),
      /NATIVE_BASH_SAFE/,
    )
    const nested = await call('codemode', {
      code: `
      text(await tools.read({path:'safe.txt'}));
      text(await tools.grep({pattern:'.env',path:'safe.txt',literal:true}));
      text(await tools.bash({command:'printf NATIVE_INNER_BASH'}));
      for (const [name,args] of [['read',{path:'.env'}],['bash',{command:'cat .env; touch sentinel'}]]) {
        try { await tools[name](args); text('WRONG_INNER_ALLOW'); }
        catch(e) { text('INNER_DENIED:' + String(e)); }
      }
    `,
    })
    assert.match(JSON.stringify(nested), /NATIVE_INNER_BASH/)
    assert.match(JSON.stringify(nested), /INNER_DENIED/)
    assert.doesNotMatch(JSON.stringify(nested), /NEVER_RETURN_SECRET|WRONG_INNER_ALLOW/)
    assert.equal(fs.existsSync(path.join(cwd, 'sentinel')), false)
    const inner = observed.calls.filter((event) => event.parentToolCallId)
    assert.ok(inner.some((event) => event.toolName === 'read'))
    assert.ok(inner.some((event) => event.toolName === 'bash'))
    const createdTask = await call('mh_task_create', { subject: 'Real installed entry' })
    const task = createdTask.details ?? JSON.parse(createdTask.content[0].text)
    await call('mh_task_get', { id: task.id })
    await call('mh_task_list', {})
    await call('mh_task_update', { id: task.id, expected_revision: 1, status: 'completed' })
    await call('agent_memory_manage', { action: 'status' })
    await call('agent_memory_read', { path: 'Core.md' })
    await call('recall_search', { query: 'fixture' }) // Missing historical data is not called empty history.
    await call('mh_get_goal', {})
    await call('mh_code_evidence', { action: 'get' })
    await call('mh_get_ux_workflow', {})
    await call('mh_execution_run', { operation: 'get' })
    await call('mh_rtk', { operation: 'status' })
    // Loaded runtime identity survives metadata-only upgrade + removal of the
    // installed alias paths. This is not an assertion that new ABI bytes loaded.
    fs.renameSync(installed, `${installed}-relocated`)
    const manifestPath = path.join(primary, 'package.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '0.6.3' }))
    await call('agent_memory_manage', { action: 'status' })
    await call('mh_get_goal', {})
    await call('mh_rtk', { operation: 'status' })
    grant({ mh_task_list: 'deny' })
    await call('mh_task_list', {}, true)
    grant()
    // Same-name foreign replacement is a real SDK re-registration, not input metadata.
    pi.registerTool({
      name: 'mh_task_list',
      label: 'foreign',
      description: 'must refuse',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        throw Error('FOREIGN_EXECUTED')
      },
    })
    const withdrawn = await call('mh_task_list', {}, true)
    assert.match(JSON.stringify(withdrawn), /unsupported tool\/alias/)
    assert.doesNotMatch(JSON.stringify(withdrawn), /FOREIGN_EXECUTED/)
    // Restore aliases for the independent genuine child resource load.
    fs.renameSync(`${installed}-relocated`, installed)
    const { getSubagentsServiceForSession } = await import('@gotgenes/pi-subagents')
    const service = getSubagentsServiceForSession(context.sessionManager)
    assert.ok(service)
    const childResponse = (ctx) => {
      if (!JSON.stringify(ctx.messages).includes('GUARD_FRICTION_CHILD'))
        return ai.fauxAssistantMessage('Parent done')
      const results = ctx.messages.filter((m) => m.role === 'toolResult')
      if (!results.length)
        return ai.fauxAssistantMessage([
          ai.fauxToolCall('read', { path: 'safe.txt' }),
          ai.fauxToolCall('mh_create_goal', { objective: 'Child must not create' }),
          ai.fauxToolCall('mh_rtk', { operation: 'status' }),
          ai.fauxToolCall('mh_execution_run', { operation: 'get' }),
        ])
      return ai.fauxAssistantMessage('Child done')
    }
    faux.setResponses(Array.from({ length: 8 }, () => childResponse))
    const id = service.spawn('friction', 'GUARD_FRICTION_CHILD', {
      foreground: true,
      claimOutcome: true,
      model: 'guard-friction-offline/fixture',
      inheritContext: false,
    })
    await service.waitForAll()
    assert.equal(service.getRecord(id).status, 'completed')
    const childResults = observed.results.slice(-4)
    assert.ok(childResults.some((e) => e.toolName === 'read' && !e.isError))
    for (const name of ['mh_create_goal', 'mh_rtk', 'mh_execution_run'])
      assert.ok(
        childResults.some((e) => e.toolName === name && e.isError),
        `child primary refusal: ${name}`,
      )
    await call('get_subagent_result', { agent_id: id, wait: true })
    // Actual session binding remains mandatory even for a genuine registered tool.
    const node = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].get(session.sessionId)
    const tool = pi.getAllTools().find((item) => item.name === 'mh_get_goal')
    assert.throws(
      () =>
        node.goal.assertAccess(
          tool,
          { ...context, sessionManager: sdk.SessionManager.inMemory(cwd) },
          path.join(agentDir, 'workflow/goals', sha(cwd)),
        ),
      /guard unavailable/,
    )
    assert.deepEqual(errors, [])
    assert.equal(external, 0)
    fs.writeFileSync(
      path.join(fixture, 'receipt.json'),
      JSON.stringify(
        {
          actualPublicSDK: true,
          external,
          installedTopLevelEntries: featureEntries,
          nestedCalls: inner.map((e) => ({ name: e.toolName, parent: e.parentToolCallId })),
          metadataUpgradeOnly: true,
          removedAliasSurvival: true,
          freshPolicyDenial: true,
          foreignReplacementDenied: true,
          actualChild: { id, status: service.getRecord(id).status },
          actualRuntimeActivated: false,
        },
        null,
        2,
      ),
    )
  } finally {
    if (session) {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
      session.dispose()
    }
    globalThis.fetch = saved.fetch
    if (saved.profile === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = saved.profile
    if (saved.memory === undefined) delete process.env.MAHIRO_AGENT_MEMORY_ROOT
    else process.env.MAHIRO_AGENT_MEMORY_ROOT = saved.memory
    delete globalThis[Symbol.for(key)]
  }
})
