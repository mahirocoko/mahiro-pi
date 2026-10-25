import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'
import { trustedCodeMapTool } from './legacy-provenance.mjs'

const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const primary = path.resolve(adapter, '../..')
const evidence = path.join(primary, '.agent-state/runtime/code-map-port/owner-patch')
fs.mkdirSync(evidence, { recursive: true })
const fixture = fs.mkdtempSync(path.join(evidence, 'repair-retake-quarantine-'))
const cwd = path.join(fixture, 'project'),
  agentDir = path.join(fixture, 'agent')
for (const dir of [cwd, agentDir]) fs.mkdirSync(dir)
const report = {
  status: 'old-unpatched-owner-must-remain-unavailable',
  provenance: 'actual-public-SDK-1.3.0-Faux-and-public-permission-service',
  externalRequests: 0,
  cases: [],
}

test('unpatched owner: missing attestation denies exact and family grants through ABI/direct/nested execution', async () => {
  const savedAgent = process.env.PI_CODING_AGENT_DIR,
    savedFetch = globalThis.fetch
  process.env.PI_CODING_AGENT_DIR = agentDir
  globalThis.fetch = () => {
    report.externalRequests++
    throw new Error('No external requests allowed')
  }
  let session
  try {
    const permissions = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-permission-system'))
    const config = path.join(agentDir, 'extensions/pi-permission-system/config.json')
    fs.mkdirSync(path.dirname(config), { recursive: true })
    const policy = (rules, yoloMode = false) =>
      fs.writeFileSync(
        config,
        JSON.stringify({
          yoloMode,
          authorizerChain: [],
          permission: { '*': 'deny', codemode: 'allow', ...rules },
        }),
      )
    policy({ mh_code_map: 'allow' })
    fs.writeFileSync(
      path.join(agentDir, 'settings.json'),
      JSON.stringify({
        packages: [
          permissions,
          adapter,
          {
            source: primary,
            extensions: ['extensions/mahiro-code-map.ts'],
            skills: [],
            themes: [],
            prompts: [],
          },
        ],
        defaultTools: ['+codemode'],
        cacheWarming: 'off',
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
    )
    const settingsManager = sdk.SettingsManager.create(cwd, agentDir)
    let ctx, tools, requests, getService
    // Let the SDK's public extension loader resolve the owner's TS public export.
    // Node 22 itself cannot strip TypeScript inside node_modules.
    fs.symlinkSync(path.join(adapter, 'node_modules'), path.join(fixture, 'node_modules'), 'dir')
    const observer = path.join(fixture, 'permission-observer.ts')
    fs.writeFileSync(
      observer,
      `import { getPermissionsService } from '@gotgenes/pi-permission-system';
export default pi => pi.on('session_start', (_event, ctx) => pi.events.emit('fixture:code-map-permission-query', () => getPermissionsService(ctx.sessionManager.getSessionId())));`,
    )
    const loader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      additionalExtensionPaths: [observer],
      disabledBuiltinExtensions: ['mcp'],
      extensionFactories: [
        { name: 'codemode', builtin: true, factory: sdk.createCodemodeExtension() },
        (pi) => {
          pi.events.on('fixture:code-map-permission-query', (getter) => {
            getService = getter
          })
          pi.on('session_start', (_event, context) => {
            ctx = context
            tools = pi.getAllTools()
          })
        },
      ],
    })
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    const definition = loader
      .getExtensions()
      .extensions.flatMap((extension) => [...extension.tools.values()])
      .find((tool) => tool.definition.name === 'mh_code_map')?.definition
    assert.ok(definition)
    const runtime = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const faux = ai.fauxProvider({
      provider: 'openai',
      models: [{ id: 'quarantine-fixture' }],
    })
    runtime.registerNativeProvider(faux.provider)
    ;({ session } = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager,
      modelRuntime: runtime,
      model: faux.getModel(),
      resourceLoader: loader,
      sessionManager: sdk.SessionManager.create(cwd, path.join(fixture, 'sessions')),
    }))
    await session.bindExtensions({})
    const node = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].get(session.sessionId)
    assert.ok(node.healthy())
    assert.equal(trustedCodeMapTool(tools.find((tool) => tool.name === 'mh_code_map')), true)
    const query = () => {
      const service = getService()
      assert.ok(service)
      return {
        check: service.checkPermission('mh_code_map'),
        blanket: service.getToolPermission('mh_code_map'),
        fullyDenied: service.isToolFullyDenied('mh_code_map'),
      }
    }
    const exact = query()
    assert.equal(exact.check.state, 'allow')
    const cases = [
      ['mh_*', { 'mh_*': 'allow' }, false, true],
      ['mh_code_*', { 'mh_code_*': 'allow' }, false, true],
      ['exact-name', { mh_code_map: 'allow' }, false, true],
      ['revoked', { mh_code_map: 'deny' }, false, false],
      ['ask', { mh_code_map: 'ask' }, false, false],
      ['missing', {}, false, false],
      ['default-wildcard', { '*': 'allow' }, false, true],
      ['yolo-only', { mh_code_map: 'ask' }, true, true],
    ]
    for (const [name, rules, yolo = false, expectPass = false] of cases) {
      policy(rules, yolo)
      await session.extensionRunner.emitBeforeAgentStart(
        { messageType: 'user', prompt: 'refresh yolo', images: [] },
        { cwd, customPrompt: '', contextFiles: [], sections: {} },
      )
      const ownerResult = query()
      // A real owner-backed counterexample, not a mock or duplicated parser:
      // all three public authority queries are identical for exact/family allows.
      if (name === 'mh_*' || name === 'mh_code_*') assert.deepEqual(ownerResult, exact)
      assert.equal(
        ownerResult.check.matchedSurface,
        undefined,
        'This fixture specifically uses the unchanged installed owner',
      )
      assert.equal(node.codeMap.version, 1)
      if (expectPass) {
        assert.doesNotThrow(() =>
          node.codeMap.assertAccess(
            tools.find((tool) => tool.name === 'mh_code_map'),
            ctx,
          ),
        )
        assert.match(
          JSON.stringify(
            await definition.execute(
              'without-tool-call',
              { intent: 'exact', query: name },
              undefined,
              undefined,
              ctx,
            ),
          ),
          /Code Map · exact/,
        )
      } else {
        assert.throws(
          () =>
            node.codeMap.assertAccess(
              tools.find((tool) => tool.name === 'mh_code_map'),
              ctx,
            ),
          /PSS permission/,
        )
        await assert.rejects(
          definition.execute(
            'without-tool-call',
            { intent: 'exact', query: name },
            undefined,
            undefined,
            ctx,
          ),
          /PSS permission/,
        )
      }
      requests = undefined
      faux.setResponses([
        ai.fauxAssistantMessage(
          [
            ai.fauxToolCall('mh_code_map', { intent: 'exact', query: name }),
            ai.fauxToolCall('codemode', {
              code: "try { text(await tools.mh_code_map({intent:'outline',query:'quarantine'})); } catch(e) { text('NESTED_BLOCKED:' + String(e)); }",
            }),
          ],
          { stopReason: 'toolUse' },
        ),
        (context) => {
          requests = context.messages
          return ai.fauxAssistantMessage('Offline quarantine fixture complete')
        },
      ])
      await session.prompt('Synthetic quarantine test only')
      const results = requests.filter((message) => message.role === 'toolResult').slice(-2)
      const direct = results.find((message) => message.toolName === 'mh_code_map')
      const nested = results.find((message) => message.toolName === 'codemode')
      assert.equal(!!direct?.isError, !expectPass, JSON.stringify(results))
      assert.ok(nested && !nested.isError, JSON.stringify(results))
      assert.match(JSON.stringify(nested.content), expectPass ? /Code Map · outline/ : /NESTED_BLOCKED/)
      report.cases.push({
        name,
        ownerResult,
        expectPass,
      })
    }
    assert.equal(report.externalRequests, 0)
  } catch (error) {
    report.error = String(error?.stack ?? error)
    throw error
  } finally {
    session?.dispose()
    globalThis.fetch = savedFetch
    if (savedAgent === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = savedAgent
    fs.writeFileSync(path.join(fixture, 'receipt.json'), JSON.stringify(report, null, 2))
  }
})
