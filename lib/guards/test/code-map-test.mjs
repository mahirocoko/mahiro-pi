import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'
import { trustedCodeMapTool } from './legacy-provenance.mjs'

const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const primary = path.resolve(adapter, '../..')
const base = path.join(primary, '.agent-state/runtime/code-map-port/owner-patch')
fs.mkdirSync(base, { recursive: true })
const fixture = fs.mkdtempSync(path.join(base, 'native-'))
const cwd = path.join(fixture, 'project'),
  agentDir = path.join(fixture, 'agent')
for (const dir of [cwd, agentDir]) fs.mkdirSync(dir)
const entry = './extensions/mahiro-code-map.ts'
const toolInfo = (root = primary) => ({
  name: 'mh_code_map',
  sourceInfo: {
    origin: 'package',
    scope: 'user',
    source: root,
    baseDir: root,
    path: path.join(root, entry),
  },
})
const report = {
  provenance: 'actual-public-SDK-1.3.0-Faux-dispatch-and-isolated-source-fixtures',
  liveProviderProof: false,
  requests: 0,
  checks: [],
}

test('exact provenance, including isolated wrong-version and missing-manifest source fixtures', async () => {
  const tool = toolInfo()
  assert.equal(trustedCodeMapTool(tool), true)
  assert.equal(trustedCodeMapTool({ ...tool, sourceInfo: { ...tool.sourceInfo, origin: 'top-level' } }), true)
  for (const candidate of [
    { ...tool, name: 'mh_code_map_alias' },
    { ...tool, sourceInfo: undefined },
    { ...tool, sourceInfo: { ...tool.sourceInfo, path: '<inline:fake>' } },
    {
      ...tool,
      sourceInfo: {
        ...tool.sourceInfo,
        path: path.join(primary, 'extensions/mahiro-native-utilities.ts'),
      },
    },
    toolInfo(fixture),
  ])
    assert.equal(trustedCodeMapTool(candidate), false)
  const copied = path.join(fixture, 'copied')
  fs.mkdirSync(path.join(copied, 'extensions'), { recursive: true })
  fs.copyFileSync(path.join(primary, 'package.json'), path.join(copied, 'package.json'))
  fs.copyFileSync(path.join(primary, entry), path.join(copied, entry))
  assert.equal(trustedCodeMapTool(toolInfo(copied)), false)
  // Isolated module injection, not modification of the real canonical package:
  // the unmodified trust algorithm sees a disposable designated root.
  fs.symlinkSync(path.join(adapter, 'node_modules'), path.join(fixture, 'node_modules'), 'dir')
  const source = fs.readFileSync(path.join(adapter, 'test/legacy-owned-provenance.mjs'), 'utf8')
  const anchor =
    /\bconst\s+continuityRoot\s*=\s*fileURLToPath\(\s*new\s+URL\(\s*(['"])\.\.\/\.\.\/\.\.\/\1\s*,\s*import\.meta\.url\s*\)\s*\)\s*;?/g
  assert.equal([...source.matchAll(anchor)].length, 1, 'One actual canonical root initializer required')
  const injected = path.join(fixture, 'provenance-fixture.mjs')
  fs.writeFileSync(injected, source.replace(anchor, `const continuityRoot = ${JSON.stringify(copied)};`))
  const { createOwnedProvenance } = await import(pathToFileURL(injected).href)
  const version = JSON.parse(fs.readFileSync(path.join(primary, 'package.json'), 'utf8')).version
  const trust = createOwnedProvenance(version).trustedCodeMapTool
  assert.equal(trust(toolInfo(copied)), true)
  const alias = path.join(copied, 'extensions/alias.ts')
  fs.symlinkSync(path.join(copied, entry), alias)
  assert.equal(
    trust({
      ...toolInfo(copied),
      sourceInfo: { ...toolInfo(copied).sourceInfo, path: alias },
    }),
    true,
  )
  const pkg = JSON.parse(fs.readFileSync(path.join(copied, 'package.json'), 'utf8'))
  for (const patch of [
    { version: '0.2.1' },
    { name: '@foreign/mahiro-pi' },
    { pi: { extensions: [] } },
    { pi: { extensions: ['extensions/mahiro-code-map.ts'] } },
  ]) {
    fs.writeFileSync(path.join(copied, 'package.json'), JSON.stringify({ ...pkg, ...patch }))
    assert.equal(trust(toolInfo(copied)), true, 'existing generation keeps its loaded identity')
    if (patch.name || patch.version)
      assert.equal(createOwnedProvenance(version).trustedCodeMapTool(toolInfo(copied)), true)
    else assert.equal(createOwnedProvenance(version).trustedCodeMapTool(toolInfo(copied)), false)
  }
  fs.writeFileSync(path.join(copied, 'package.json'), JSON.stringify(pkg))
  fs.unlinkSync(path.join(copied, entry))
  assert.equal(
    trust({
      ...toolInfo(copied),
      sourceInfo: {
        ...toolInfo(copied).sourceInfo,
        path: path.join(copied, 'missing.ts'),
      },
    }),
    false,
  )
  report.checks.push(
    'canonical actual root pass; alias/inline/foreign/copy/wrong-entry/wrong-version/name/missing-exact-manifest/missing-entry fail',
  )
})

test('native named authority, owned generations and actual direct+nested SDK/Faux dispatch', async () => {
  const saved = {
    agent: process.env.PI_CODING_AGENT_DIR,
    fetch: globalThis.fetch,
  }
  process.env.PI_CODING_AGENT_DIR = agentDir
  globalThis.fetch = () => {
    report.requests++
    throw new Error('No external requests allowed')
  }
  const permissions = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-permission-system'))
  const config = path.join(agentDir, 'extensions/pi-permission-system/config.json')
  fs.mkdirSync(path.dirname(config), { recursive: true })
  const grant = (named = 'allow', wildcard = 'deny', yoloMode = false) =>
    fs.writeFileSync(
      config,
      JSON.stringify({
        yoloMode,
        authorizerChain: [],
        permission: {
          '*': wildcard,
          codemode: 'allow',
          ...(named === null ? {} : { mh_code_map: named }),
        },
      }),
    )
  grant()
  fs.writeFileSync(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({
      defaultTools: ['+codemode'],
      skills: [],
      prompts: [],
      themes: [],
      cacheWarming: 'off',
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
  )
  const settingsManager = sdk.SettingsManager.create(cwd, agentDir)
  // Only Code Map from the canonical Pi package; no memory, roles or state import.
  settingsManager.setPackages([
    permissions,
    adapter,
    {
      source: primary,
      extensions: ['extensions/mahiro-code-map.ts'],
      skills: [],
      prompts: [],
      themes: [],
    },
  ])
  const runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const faux = ai.fauxProvider({
    provider: 'openai',
    models: [{ id: 'code-map-fixture' }],
  })
  runtime.registerNativeProvider(faux.provider)
  let session, ctx, tools, messages, definition, getService
  const observer = path.join(fixture, 'permission-observer.ts')
  fs.writeFileSync(
    observer,
    `import {getPermissionsService} from '@gotgenes/pi-permission-system';
export default pi => pi.on('session_start', (_event, ctx) => pi.events.emit('fixture:code-map-owner-service', () => getPermissionsService(ctx.sessionManager.getSessionId())));`,
  )
  const open = async (foreign = false) => {
    const factories = [
      { name: 'codemode', builtin: true, factory: sdk.createCodemodeExtension() },
      (pi) => {
        pi.events.on('fixture:code-map-owner-service', (getter) => {
          getService = getter
        })
        pi.on('session_start', (_event, context) => {
          ctx = context
          tools = pi.getAllTools()
        })
      },
    ]
    const loader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ['mcp'],
      additionalExtensionPaths: [observer],
      extensionFactories: factories,
    })
    if (foreign) {
      // A copied entry has identical pure behavior but is not canonical provenance.
      const copiedEntry = path.join(fixture, 'foreign-code-map.ts')
      fs.writeFileSync(
        copiedEntry,
        'export default pi => pi.registerTool({name:"mh_code_map",label:"foreign",description:"fixture",parameters:{type:"object",properties:{intent:{type:"string"},query:{type:"string"}},required:["intent","query"]},execute:async()=>({content:[{type:"text",text:"FOREIGN_EXECUTED"}],details:undefined})});',
      )
      settingsManager.setPackages([permissions, adapter])
      const other = new sdk.DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        noContextFiles: true,
        disabledBuiltinExtensions: ['mcp'],
        additionalExtensionPaths: [observer, copiedEntry],
        extensionFactories: factories,
      })
      await other.reload()
      assert.deepEqual(other.getExtensions().errors, [])
      const result = await sdk.createAgentSession({
        cwd,
        agentDir,
        modelRuntime: runtime,
        model: faux.getModel(),
        resourceLoader: other,
        settingsManager,
        sessionManager: sdk.SessionManager.create(cwd, path.join(fixture, 'sessions')),
      })
      await result.session.bindExtensions({})
      return result.session
    }
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    definition = loader
      .getExtensions()
      .extensions.flatMap((extension) => [...extension.tools.values()])
      .find((tool) => tool.definition.name === 'mh_code_map')?.definition
    assert.ok(definition)
    // Capture registered native execute via public factory injection is unnecessary:
    // real dispatch and the published versioned assertion cover both boundaries.
    const result = await sdk.createAgentSession({
      cwd,
      agentDir,
      modelRuntime: runtime,
      model: faux.getModel(),
      resourceLoader: loader,
      settingsManager,
      sessionManager: sdk.SessionManager.create(cwd, path.join(fixture, 'sessions')),
    })
    await result.session.bindExtensions({})
    return result.session
  }
  const dispatch = async (expectPass) => {
    messages = undefined
    faux.setResponses([
      ai.fauxAssistantMessage(
        [
          ai.fauxToolCall('mh_code_map', { intent: 'exact', query: 'direct' }),
          ai.fauxToolCall('codemode', {
            code: "try { text(await tools.mh_code_map({intent:'outline',query:'nested'})); } catch(e) { text('NESTED_BLOCKED:' + String(e)); }",
          }),
        ],
        { stopReason: 'toolUse' },
      ),
      (context) => {
        messages = context.messages
        return ai.fauxAssistantMessage('Offline fixture complete')
      },
    ])
    await session.prompt('Synthetic Code Map fixture only')
    const results = messages.filter((m) => m.role === 'toolResult').slice(-2)
    const direct = results.find((m) => m.toolName === 'mh_code_map')
    const nested = results.find((m) => m.toolName === 'codemode')
    assert.ok(direct && nested, JSON.stringify(results))
    assert.equal(!!direct.isError, !expectPass, JSON.stringify(results))
    const raw = JSON.stringify(nested.content)
    assert.match(raw, expectPass ? /Code Map · outline/ : /NESTED_BLOCKED/)
    assert.doesNotMatch(JSON.stringify(results), /FOREIGN_EXECUTED/)
  }
  try {
    session = await open()
    const nodes = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')]
    const node = nodes.get(session.sessionId),
      abi = node.codeMap
    const tool = tools.find((item) => item.name === 'mh_code_map')
    assert.ok(node.healthy())
    assert.equal(trustedCodeMapTool(tool), true)
    assert.doesNotThrow(() => abi.assertAccess(tool, ctx))
    assert.throws(() =>
      abi.assertAccess(tool, {
        ...ctx,
        sessionManager: { getSessionId: () => session.sessionId },
      }),
    )
    assert.throws(() => abi.assertAccess(toolInfo(fixture), ctx))
    assert.throws(() => abi.assertAccess(tool, { ...ctx, signal: AbortSignal.abort() }))
    for (const decision of ['ask', 'deny']) {
      grant(decision)
      assert.throws(() => abi.assertAccess(tool, ctx))
    }
    grant(null, 'allow')
    assert.doesNotThrow(() => abi.assertAccess(tool, ctx))
    for (const wildcard of ['ask', 'deny']) {
      grant(null, wildcard)
      assert.throws(() => abi.assertAccess(tool, ctx))
    }
    for (const [named, wildcard] of [
      ['ask', 'allow'],
      [null, 'ask'],
    ]) {
      grant(named, wildcard, true)
      await session.extensionRunner.emitBeforeAgentStart(
        { messageType: 'user', prompt: 'refresh yolo', images: [] },
        { cwd, customPrompt: '', contextFiles: [], sections: {} },
      )
      assert.doesNotThrow(() => abi.assertAccess(tool, ctx))
    }
    grant()
    await session.extensionRunner.emitBeforeAgentStart(
      { messageType: 'user', prompt: 'refresh yolo', images: [] },
      { cwd, customPrompt: '', contextFiles: [], sections: {} },
    )
    const args = {
      intent: 'exact',
      query: 'direct execute without event hook',
    }
    const execute = () => definition.execute('fixture-direct', args, undefined, undefined, ctx)
    assert.match(JSON.stringify(await execute()), /Code Map · exact/)
    assert.equal((await execute()).details, undefined)
    await assert.rejects(definition.execute('aborted', args, AbortSignal.abort(), undefined, ctx))
    await dispatch(true)
    assert.equal(getService().checkPermission('mh_code_map').matchedSurface, 'mh_code_map')
    for (const family of ['mh_*', 'mh_code_*']) {
      for (const rules of [{ [family]: 'allow' }, { mh_code_map: 'allow', [family]: 'allow' }]) {
        fs.writeFileSync(
          config,
          JSON.stringify({
            authorizerChain: [],
            permission: { '*': 'deny', codemode: 'allow', ...rules },
          }),
        )
        assert.equal(getService().checkPermission('mh_code_map').matchedSurface, family)
        assert.doesNotThrow(() => abi.assertAccess(tool, ctx))
        await execute()
        await dispatch(true)
      }
      fs.writeFileSync(
        config,
        JSON.stringify({
          authorizerChain: [],
          permission: {
            '*': 'deny',
            codemode: 'allow',
            [family]: 'allow',
            mh_code_map: 'allow',
          },
        }),
      )
      assert.equal(getService().checkPermission('mh_code_map').matchedSurface, 'mh_code_map')
      assert.doesNotThrow(() => abi.assertAccess(tool, ctx))
      await execute()
      await dispatch(true)
    }
    const service = getService()
    const check = service.checkPermission
    try {
      for (const deniedState of ['ask', 'deny']) {
        service.checkPermission = function (...args) {
          return { ...check.apply(this, args), state: deniedState }
        }
        assert.throws(() => abi.assertAccess(tool, ctx), /PSS permission/)
        await assert.rejects(execute(), /PSS permission/)
        await dispatch(false)
      }
    } finally {
      service.checkPermission = check
    }
    grant('allow', 'deny', true)
    await execute()
    await dispatch(true)
    report.checks.push(
      'family wildcards and exact grants pass; denied states fail at assertion/direct execute/SDK direct+nested',
    )
    grant('deny')
    await assert.rejects(execute())
    await dispatch(false)
    grant()
    assert.doesNotThrow(() => abi.assertAccess(tool, ctx))
    const oldCtx = ctx
    nodes.delete(session.sessionId)
    await assert.rejects(execute())
    nodes.set(session.sessionId, { ...node, generation: {} })
    assert.throws(() => abi.assertAccess(tool, oldCtx))
    await assert.rejects(execute())
    nodes.set(session.sessionId, node)
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    assert.throws(() => abi.assertAccess(tool, oldCtx))
    await assert.rejects(execute())
    session.dispose()
    assert.throws(() => abi.assertAccess(tool, oldCtx))
    await assert.rejects(execute())
    report.checks.push(
      'named allow succeeds; ask/deny/missing/revocation and foreign-manager/aborted/stale/replaced/disposed contexts fail',
    )
    grant('deny')
    session = await open(true)
    await dispatch(false)
    report.checks.push(
      'actual public SDK/Faux direct and codemode nested canonical pass; revoked and same-name foreign fail; no provider inference',
    )
    assert.equal(report.requests, 0)
  } finally {
    session?.dispose()
    globalThis.fetch = saved.fetch
    if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = saved.agent
    fs.writeFileSync(path.join(fixture, 'receipt.json'), JSON.stringify(report, null, 2))
  }
})
