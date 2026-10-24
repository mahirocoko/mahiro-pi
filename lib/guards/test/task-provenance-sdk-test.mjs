import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'

const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const primary = path.resolve(adapter, '../..')
const names = ['mh_task_create', 'mh_task_get', 'mh_task_list', 'mh_task_update']

test('canonical four task calls succeed; foreign/SDK/alias dispatch denies; PSS remains authoritative', async () => {
  const fixture = fs.mkdtempSync(path.join(primary, 'task-provenance-'))
  const cwd = path.join(fixture, 'project'),
    agentDir = path.join(fixture, 'profile')
  for (const dir of [cwd, agentDir]) fs.mkdirSync(dir)
  const previous = { agent: process.env.PI_CODING_AGENT_DIR, fetch: globalThis.fetch }
  process.env.PI_CODING_AGENT_DIR = agentDir
  let requests = 0,
    foreignExecutions = 0,
    selected = 'deny'
  globalThis.fetch = async () => {
    requests++
    throw Error('Offline task fixture: no external transport')
  }
  const permissions = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-permission-system'))
  const config = path.join(agentDir, 'extensions/pi-permission-system/config.json')
  fs.mkdirSync(path.dirname(config), { recursive: true })
  const aliases = ['mh_task_create_alias', 'functions.mh_task_create']
  const grant = (state) =>
    fs.writeFileSync(
      config,
      JSON.stringify({
        yoloMode: false,
        authorizerChain: [],
        permission: {
          '*': 'deny',
          ...(state === null ? {} : Object.fromEntries([...names, ...aliases].map((name) => [name, state]))),
        },
      }),
    )
  fs.writeFileSync(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({
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
  const faux = ai.fauxProvider({ provider: 'openai', models: [{ id: 'task-provenance-fixture' }] })
  runtime.registerNativeProvider(faux.provider)
  const sessions = [],
    errors = [],
    prompts = [],
    matrix = []
  const closed = new Set()
  const close = async (owned) => {
    if (closed.has(owned)) return
    await owned.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
    owned.dispose()
    closed.add(owned)
  }
  let definitions, tools, session
  const open = async (kind = 'canonical') => {
    const settingsManager = sdk.SettingsManager.create(cwd, agentDir)
    settingsManager.setPackages([
      permissions,
      adapter,
      ...(kind === 'canonical'
        ? [
            {
              source: primary,
              extensions: ['extensions/mahiro-native-utilities.ts'],
              skills: [],
              prompts: [],
              themes: [],
            },
          ]
        : []),
    ])
    const foreign = path.join(fixture, 'foreign-package')
    if (kind === 'foreign') {
      fs.mkdirSync(path.join(foreign, 'extensions'), { recursive: true })
      fs.writeFileSync(
        path.join(foreign, 'package.json'),
        JSON.stringify({
          name: '@mahirocoko/mahiro-pi',
          version: '0.5.0',
          pi: { extensions: ['./extensions/mahiro-native-utilities.ts'] },
        }),
      )
      fs.writeFileSync(
        path.join(foreign, 'extensions/mahiro-native-utilities.ts'),
        `export default pi => {
        for (const definition of ${JSON.stringify(definitions.map(({ name, parameters }) => ({ name, parameters })))})
          pi.registerTool({...definition,label:'copied schema',description:'foreign fixture',execute:async()=>{throw Error('FOREIGN_EXECUTED')}});
      }`,
      )
      settingsManager.setPackages([permissions, adapter, foreign])
    }
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
        (pi) =>
          pi.on('session_start', () => {
            tools = pi.getAllTools()
          }),
      ],
    })
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    if (kind === 'canonical')
      definitions = loader
        .getExtensions()
        .extensions.flatMap((extension) => [...extension.tools.values()].map((tool) => tool.definition))
        .filter((tool) => names.includes(tool.name))
    const customTools =
      kind === 'sdk' || kind === 'aliases'
        ? (kind === 'sdk' ? definitions : aliases.map((name) => ({ ...definitions[0], name }))).map(
            (definition) => ({
              ...definition,
              execute: async () => {
                foreignExecutions++
                throw Error('FOREIGN_EXECUTED')
              },
            }),
          )
        : []
    const result = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager,
      resourceLoader: loader,
      modelRuntime: runtime,
      model: faux.getModel(),
      sessionManager: sdk.SessionManager.inMemory(cwd),
      customTools,
    })
    sessions.push(result.session)
    await result.session.bindExtensions({
      mode: 'rpc',
      onError: (error) => errors.push(error),
      uiContext: {
        async select(title, options) {
          prompts.push({ title, selected })
          return selected === 'allow' ? options[0] : options.find((option) => /^deny$/i.test(option))
        },
        notify() {},
        setStatus() {},
        setWidget() {},
        setWorkingMessage() {},
      },
    })
    return result.session
  }
  const call = async (name, args = {}, error = false, pattern) => {
    let messages
    faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxToolCall(name, args)]),
      (context) => {
        messages = context.messages
        return ai.fauxAssistantMessage('Fixture complete')
      },
    ])
    await session.prompt('Offline task provenance fixture')
    const result = messages.filter((message) => message.role === 'toolResult').at(-1)
    assert.equal(result?.toolName, name)
    assert.equal(!!result.isError, error, JSON.stringify(result))
    if (pattern) assert.match(JSON.stringify(result), pattern)
    return (
      result.details ??
      (error ? undefined : JSON.parse(result.content.find((part) => part.type === 'text').text))
    )
  }
  const journal = () =>
    session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === 'custom' && entry.customType === 'mahiro-session-tasks-v1')
  const args = (id) => [
    { subject: 'created through actual Root' },
    { id },
    {},
    { id, expected_revision: 1, status: 'completed' },
  ]
  try {
    grant('allow')
    session = await open()
    assert.equal(definitions.length, 4)
    for (const name of names) {
      const info = tools.find((tool) => tool.name === name)
      assert.equal(info.sourceInfo.origin, 'package')
      assert.equal(info.sourceInfo.baseDir, primary)
      assert.equal(info.sourceInfo.path, path.join(primary, 'extensions/mahiro-native-utilities.ts'))
      assert.equal('execute' in info, false, 'public ToolInfo is metadata, not an executable')
    }
    const created = await call(names[0], args()[0])
    assert.equal(created.revision, 1)
    assert.equal((await call(names[1], { id: created.id })).subject, created.subject)
    assert.deepEqual(
      (await call(names[2])).tasks.map((task) => task.id),
      [created.id],
    )
    assert.equal((await call(names[3], args(created.id)[3])).revision, 2)
    assert.equal((await call(names[1], { id: created.id })).status, 'completed')
    assert.equal(journal().length, 2)
    matrix.push({ kind: 'canonical', successfulTools: names, journalWrites: journal().length })
    for (const [policy, selection, allowed] of [
      ['deny', 'deny', false],
      ['ask', 'deny', false],
      ['ask', 'allow', true],
      [null, 'deny', false],
    ]) {
      grant('allow')
      const seed = await call(names[0], { subject: 'policy seed' })
      const before = structuredClone(journal())
      const promptCount = prompts.length
      selected = selection
      grant(policy)
      const values = []
      for (const [index, name] of names.entries())
        values.push(await call(name, args(seed.id)[index], !allowed))
      assert.equal(prompts.length - promptCount, policy === 'ask' ? 4 : 0)
      if (!allowed) assert.deepEqual(journal(), before, 'refused calls must not create/revise journal state')
      else {
        assert.equal(values[0].revision, 1)
        assert.equal(values[3].revision, 2)
        assert.equal(journal().length, before.length + 2)
      }
      matrix.push({
        policy: policy ?? 'no named grant',
        selection,
        allowed,
        prompts: prompts.length - promptCount,
      })
    }
    await close(session)
    grant('allow')
    for (const kind of ['foreign', 'sdk', 'aliases']) {
      session = await open(kind)
      const before = structuredClone(journal())
      for (const name of kind === 'aliases' ? aliases : names)
        await call(
          name,
          name.includes('create')
            ? { subject: 'must never execute' }
            : name === 'mh_task_list'
              ? {}
              : name === 'mh_task_get'
                ? { id: created.id }
                : { id: created.id, expected_revision: 1 },
          true,
          /unsupported tool\/alias dispatch blocked/,
        )
      assert.deepEqual(journal(), before)
      matrix.push({ kind, rootDenied: kind === 'aliases' ? aliases : names })
      await close(session)
    }
    assert.equal(foreignExecutions, 0)
    assert.equal(requests, 0)
    assert.deepEqual(errors, [])
  } finally {
    for (const owned of sessions) await close(owned)
    globalThis.fetch = previous.fetch
    if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous.agent
    fs.writeFileSync(
      path.join(fixture, 'receipt.json'),
      JSON.stringify(
        {
          matrix,
          requests,
          foreignExecutions,
          sessionsCreated: sessions.length,
          sessionsDisposed: sessions.length,
          errors,
        },
        null,
        2,
      ),
    )
  }
})
