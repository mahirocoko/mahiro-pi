import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'
import { trustedMemoryTool } from './legacy-provenance.mjs'
import { createMemoryStore } from '../../agent-memory/store.ts'

const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const primary = path.resolve(adapter, '../..')
const evidenceRoot = path.join(primary, '.agent-state/runtime')
const fixture = fs.mkdtempSync(path.join(evidenceRoot, 'managed-memory-native-'))
const cwd = path.join(fixture, 'project'),
  agentDir = path.join(fixture, 'agent'),
  root = path.join(fixture, 'memory')
for (const dir of [cwd, agentDir]) fs.mkdirSync(dir, { mode: 0o700 })
const key = `managed_memory_${createHash('sha256').update(root).digest('hex')}`
const permissions = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-permission-system'))
const subagents = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-subagents'))
const configPath = path.join(agentDir, 'extensions/pi-permission-system/config.json')
const oldRoot = process.env.MAHIRO_AGENT_MEMORY_ROOT
const oldAgentDir = process.env.PI_CODING_AGENT_DIR
process.env.PI_CODING_AGENT_DIR = agentDir
process.env.MAHIRO_AGENT_MEMORY_ROOT = root
process.env.GIT_AUTHOR_NAME = 'Native memory fixture'
process.env.GIT_AUTHOR_EMAIL = 'fixture@example.invalid'
process.env.GIT_COMMITTER_NAME = 'Native memory fixture'
process.env.GIT_COMMITTER_EMAIL = 'fixture@example.invalid'
const store = createMemoryStore(root)
const otherCwd = path.join(fixture, 'other-project')
fs.mkdirSync(otherCwd)
store.initialize(
  {
    version: 1,
    projects: [
      { cwd, id: 'project' },
      { cwd: otherCwd, id: 'other' },
    ],
    coreBytes: 8192,
    indexBytes: 2048,
    fileBytes: 8192,
    totalBytes: 65536,
    automatic: false,
  },
  '# Core\nSYNTHETIC established companion identity.\n',
)
const otherView = store.createView('other')
store.edit(otherView, 'deferred/other/private.md', null, '# Private\nUNRELATED_PRIVATE_CORPUS\n')
store.integrate(otherView)
fs.mkdirSync(path.dirname(configPath), { recursive: true })
function grant(overrides = {}) {
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      yoloMode: false,
      authorizerChain: [],
      permission: {
        '*': 'deny',
        read: 'allow',
        agent_memory_read: 'allow',
        agent_memory_edit: 'allow',
        agent_memory_commit: 'allow',
        agent_memory_manage: 'allow',
        agent_memory_reflect: 'allow',
        [key]: 'allow',
        ...overrides,
      },
    }),
  )
}
grant()
fs.mkdirSync(path.join(agentDir, 'extensions/pi-subagents'), {
  recursive: true,
})
fs.writeFileSync(
  path.join(agentDir, 'extensions/pi-subagents/config.json'),
  JSON.stringify({ excludedExtensionPackages: [subagents] }),
)
fs.mkdirSync(path.join(agentDir, 'agents'))
fs.copyFileSync(
  path.join(primary, 'agents/managed-memory-writer.md'),
  path.join(agentDir, 'agents/managed-memory-writer.md'),
)
fs.writeFileSync(
  path.join(agentDir, 'settings.json'),
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
const report = {
  provenance: 'actual-sdk-1.3.0-native-dispatch-with-injected-faux-transports',
  liveProviderProof: false,
  actualProviderRequests: 0,
  homeMutated: false,
  fixture,
  checks: [],
  errors: [],
  bindings: [],
}
let session
const savedFetch = globalThis.fetch
globalThis.fetch = () => {
  report.actualProviderRequests++
  throw new Error('Native fixture forbids external transport')
}

test('native managed-memory authority and session-file lease binding (zero external inference)', async () => {
  try {
    const runtime = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const faux = ai.fauxProvider({
      provider: 'openai',
      models: [{ id: 'gpt-6.1-sol', reasoning: true }],
    })
    runtime.registerNativeProvider(faux.provider)
    await runtime.refresh({ allowNetwork: false })
    const requests = []
    let stage = 0
    const respond = (context) => {
      requests.push(context.messages)
      const raw = JSON.stringify(context.messages)
      const child = raw.includes('You maintain the primary companion')
      if (child) {
        const results = context.messages.filter((m) => m.role === 'toolResult')
        if (!results.length)
          return ai.fauxAssistantMessage([ai.fauxToolCall('agent_memory_read', { path: 'Core.md' })], {
            stopReason: 'toolUse',
          })
        if (results.length === 1)
          return ai.fauxAssistantMessage(
            [
              ai.fauxToolCall('agent_memory_read', {
                path: 'deferred/other/private.md',
              }),
            ],
            { stopReason: 'toolUse' },
          )
        if (results.length === 2)
          return ai.fauxAssistantMessage([ai.fauxToolCall('agent_memory_read', { query: 'UNRELATED' })], {
            stopReason: 'toolUse',
          })
        if (results.length === 3)
          return ai.fauxAssistantMessage([ai.fauxToolCall('agent_memory_read', { topic: '*' })], {
            stopReason: 'toolUse',
          })
        if (results.length === 4) {
          const core = JSON.parse(results[0].content[0].text)
          return ai.fauxAssistantMessage(
            [
              ai.fauxToolCall('agent_memory_edit', {
                path: 'Core.md',
                expectedHash: core.hash,
                text: '# Core\nSYNTHETIC established companion identity. Inspect actual check results before claiming completion.\n',
                sources: [],
              }),
            ],
            { stopReason: 'toolUse' },
          )
        }
        if (results.length === 5)
          return ai.fauxAssistantMessage(
            [
              ai.fauxToolCall('agent_memory_edit', {
                path: 'procedures/verification.md',
                expectedHash: null,
                text: '# Verification\nInspect actual check results before claiming completion.\n',
                sources: [],
              }),
            ],
            { stopReason: 'toolUse' },
          )
        if (results.length === 6) {
          const listing = JSON.parse(results[0].content[0].text)
          return ai.fauxAssistantMessage(
            [
              ai.fauxToolCall('agent_memory_commit', {
                revision: listing.revision,
              }),
            ],
            { stopReason: 'toolUse' },
          )
        }
        return ai.fauxAssistantMessage('Synthetic writer completed.')
      }
      const primaryStage = stage++
      if (primaryStage === 0)
        return ai.fauxAssistantMessage(
          [
            ai.fauxToolCall('agent_memory_read', {
              query: 'UNRELATED_PRIVATE_CORPUS',
            }),
          ],
          { stopReason: 'toolUse' },
        )
      if (primaryStage === 1)
        return ai.fauxAssistantMessage([ai.fauxToolCall('agent_memory_read', { topic: '*' })], {
          stopReason: 'toolUse',
        })
      if (primaryStage === 2)
        return ai.fauxAssistantMessage(
          [
            ai.fauxToolCall('agent_memory_read', {
              query: 'violet',
              path: 'Core.md',
            }),
          ],
          { stopReason: 'toolUse' },
        )
      if (primaryStage === 3)
        return ai.fauxAssistantMessage(
          [
            ai.fauxToolCall('agent_memory_reflect', {
              assignment: 'Maintain a reusable verification method in procedural memory.',
            }),
          ],
          { stopReason: 'toolUse' },
        )
      return ai.fauxAssistantMessage('Synthetic primary complete.')
    }
    faux.setResponses(Array.from({ length: 24 }, () => respond))
    let context, tools, node, nativeBus
    const settingsManager = sdk.SettingsManager.create(cwd, agentDir)
    const open = async () => {
      const loader = new sdk.DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        noContextFiles: true,
        systemPromptOverride: () => 'UNRELATED_NATIVE_PARENT_CONTEXT',
        disabledBuiltinExtensions: ['mcp'],
        extensionFactories: [
          (pi) => {
            for (const channel of [
              'subagents:child:session-created',
              'subagents:child:bound',
              'subagents:child:disposed',
            ])
              pi.events.on(channel, (event) => report.bindings.push({ channel, ...event }))
            pi.on('session_start', (_event, ctx) => {
              context = ctx
              tools = pi.getAllTools()
              nativeBus = pi.events
            })
          },
        ],
      })
      await loader.reload()
      assert.deepEqual(loader.getExtensions().errors, [])
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
    session = await open()
    node = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].get(session.sessionId)
    assert.ok(node?.healthy())
    const abi = node.managedMemory
    const tool = tools.find((t) => t.name === 'agent_memory_read')
    assert.equal(trustedMemoryTool(tool), true)
    // Check raw caller arguments, not Pi-AI's optional-null normalization before
    // dispatch. The public SDK intentionally deletes invalid optional nulls.
    const readDefinition = session.getToolDefinition('agent_memory_read')
    assert.ok(readDefinition)
    for (const selector of [{ path: 'Core.md' }, { query: 'violet' }, { topic: '*' }]) {
      for (const key of ['offset', 'limit']) {
        const args = { ...selector, [key]: null }
        assert.equal(tool.parameters.properties[key].type, 'integer')
        await assert.rejects(
          readDefinition.execute('null-paging', args, undefined, undefined, context),
          /Managed memory unavailable/,
        )
      }
    }
    report.checks.push(
      'all six raw null paging inputs rejected by actual registered integer schema and canonical tool execution; public SDK optional-null normalization remains unchanged',
    )
    assert.equal(abi.permission(root), key)
    assert.notEqual(abi.permission(root), node.continuity.learningPermission(root))
    assert.equal(abi.assertAccess(tool, context, root).kind, 'primary')
    assert.throws(() =>
      abi.assertAccess({ ...tool, sourceInfo: { ...tool.sourceInfo, path: '/foreign.ts' } }, context, root),
    )
    assert.throws(() =>
      abi.assertAccess(
        tool,
        {
          ...context,
          sessionManager: { getSessionId: () => session.sessionId },
        },
        root,
      ),
    )
    assert.throws(() => abi.assertAccess(tool, context, `${root}-other`))
    assert.throws(() => abi.assertAccess(tool, context, root, 'write', `${root}/../escape`))
    assert.throws(() => node.continuity.authorizeLearning(context, root))
    report.checks.push(
      'actual canonical package provenance, healthy primary identity, separate exact-root grant, old-C1 separation, foreign tool/manager/root/path rejection',
    )
    grant({
      [key]: 'deny',
      [node.continuity.learningPermission(root)]: 'allow',
    })
    assert.throws(() => abi.assertAccess(tool, context, root), /permission/)
    for (const decision of ['ask', 'deny']) {
      grant({ [key]: decision })
      assert.throws(() => abi.assertAccess(tool, context, root), /permission/)
    }
    grant({ [key]: undefined, '*': 'allow' })
    assert.throws(() => abi.assertAccess(tool, context, root), /permission/)
    grant({ path_write: { [path.join(root, 'Core.md')]: 'deny' } })
    assert.throws(
      () => abi.assertAccess(tool, context, root, 'write', path.join(root, 'Core.md')),
      /permission/,
    )
    grant()
    assert.throws(() => abi.bindWorker(tool, context, root, 'unknown-job', {}, () => true), /binding/)
    report.checks.push(
      'missing/default/wrong C1/ask/deny grants and descendant path restrictions rejected; unknown native job cannot bind',
    )
    // Public config service re-reads this fixture; no real HOME/profile is changed.
    assert.equal(abi.assertAccess(tool, context, root).kind, 'primary')
    await session.prompt('Synthetic explicit memory assignment. No external inference is permitted.')
    const service = abi.parentService()
    assert.ok(service?.supportsInitialOutcomeClaim)
    await service.waitForAll()
    const records = service.listAgents()
    report.records = records.map(({ id, type, status, toolUses, error, outputFile }) => ({
      id,
      type,
      status,
      toolUses,
      error,
      outputFile,
    }))
    const toolResults = requests.flat().filter((m) => m.role === 'toolResult')
    report.toolResults = toolResults.map(({ toolName, isError, content }) => ({
      toolName,
      isError,
      content,
    }))
    assert.equal(
      records.length,
      1,
      JSON.stringify({
        results: report.toolResults,
        catalog: context.modelRegistry
          .getAll()
          .filter((model) => model.provider === 'openai' && model.id === 'gpt-6.1-sol'),
        available: context.modelRegistry
          .getAvailable()
          .filter((model) => model.provider === 'openai' && model.id === 'gpt-6.1-sol'),
        resolved: context.modelRegistry.find('openai', 'gpt-6.1-sol'),
      }),
    )
    assert.equal(records[0].type, 'managed-memory-writer')
    assert.equal(records[0].status, 'completed')
    assert.ok(records[0].outputFile.startsWith(`${fixture}/`))
    const stat = fs.lstatSync(records[0].outputFile)
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 131072)
    const header = JSON.parse(fs.readFileSync(records[0].outputFile, 'utf8').split('\n')[0])
    assert.equal(header.type, 'session')
    assert.equal(header.parentSession, session.sessionId)
    assert.ok(
      report.bindings.some(
        (e) =>
          e.channel === 'subagents:child:bound' &&
          e.sessionId === header.id &&
          e.parentSessionId === session.sessionId,
      ),
    )
    report.nativeIdentity = {
      job: records[0].id,
      child: header.id,
      parent: header.parentSession,
      outputFile: records[0].outputFile,
    }
    assert.ok(store.snapshot().files['procedures/verification.md'], JSON.stringify(report.records))
    assert.ok(toolResults.some((r) => r.toolName === 'agent_memory_commit' && !r.isError))
    const childRequests = requests.filter((messages) =>
      JSON.stringify(messages).includes('You maintain the primary companion'),
    )
    report.firstChildRequest = childRequests[0]
    const childResults = childRequests.at(-1).filter((m) => m.role === 'toolResult')
    assert.equal(JSON.parse(childResults[2].content[0].text).outcome, 'no-match')
    assert.doesNotMatch(childResults[3].content[0].text, /deferred\/other|private\.md/)
    assert.match(JSON.stringify(childRequests[0]), /Curation doctrine v1/)
    const parentResults = requests
      .filter((messages) => !JSON.stringify(messages).includes('You maintain the primary companion'))
      .flat()
      .filter((m) => m.role === 'toolResult' && m.toolName === 'agent_memory_read')
    assert.ok(parentResults.some((m) => !m.isError && m.content[0].text.includes('UNRELATED_PRIVATE_CORPUS')))
    assert.ok(
      parentResults.some((m) => !m.isError && m.content[0].text.includes('deferred/other/private.md')),
    )
    assert.ok(
      parentResults.some((m) => m.isError),
      'mixed selectors rejected by genuine registered schema',
    )
    assert.ok(
      !childRequests.some((messages) =>
        /UNRELATED_PRIVATE_CORPUS|UNRELATED_NATIVE_PARENT_CONTEXT/.test(JSON.stringify(messages)),
      ),
    )
    assert.ok(toolResults.some((r) => r.toolName === 'agent_memory_read' && r.isError))
    assert.match(store.snapshot().files['Core.md'].text, /Inspect actual check results/)
    report.checks.push(
      'actual native public spawn/immutable descriptor/claimed outcome; native session-created/bound events; public outputFile equals captured child SessionManager file; scoped read/edit/ready; successful-parent automatic integration',
    )
    // A later primary request recompiles the latest committed revision, independently of cached AGENTS.
    await session.prompt('Synthetic subsequent primary task.')
    const last = JSON.stringify(requests.at(-1))
    assert.ok(last.includes(store.snapshot().revision))
    assert.match(last, /Curation doctrine v1/)
    assert.ok(last.includes('\\"topic\\":\\"procedures\\"'))
    assert.ok(!last.includes('procedures/verification.md'))
    assert.ok(last.includes('Inspect actual check results'))
    report.checks.push(
      'next native primary request contains latest committed revision, changed Core, curation doctrine and bounded topic discovery (not leaf paths)',
    )
    grant({ [key]: 'deny' })
    await session.prompt('Synthetic revocation task.')
    assert.ok(
      !JSON.stringify(requests.at(-1).filter((m) => m.role === 'system')).includes('<mahiro-managed-memory>'),
    )
    grant()
    session.dispose()
    session = await open()
    await session.prompt('Synthetic fresh-session task without a recall cue.')
    const fresh = JSON.stringify(requests.at(-1))
    assert.ok(fresh.includes(store.snapshot().revision))
    assert.ok(fresh.includes('Inspect actual check results'))
    report.checks.push(
      'revocation removes managed system projection; fresh actual SDK session projects latest committed Core without cached-resource reload claims',
    )
    assert.equal(report.actualProviderRequests, 0)
    report.state = 'passed-native-synthetic-not-provider-proof'
  } catch (error) {
    report.errors.push(String(error?.stack ?? error))
    throw error
  } finally {
    session?.dispose()
    globalThis.fetch = savedFetch
    if (oldRoot === undefined) delete process.env.MAHIRO_AGENT_MEMORY_ROOT
    else process.env.MAHIRO_AGENT_MEMORY_ROOT = oldRoot
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir
    fs.writeFileSync(path.join(fixture, 'receipt.json'), JSON.stringify(report, null, 2))
  }
})
