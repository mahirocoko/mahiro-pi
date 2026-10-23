import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'

const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const product = path.resolve(adapter, '../..')

test('creator registration predicates use real SDK definitions and revoke failed/disposed/replaced bindings', async () => {
  const base = path.join(product, '.agent-state/runtime/pi-ownership-repair/child-controls')
  fs.mkdirSync(base, { recursive: true })
  const fixture = fs.mkdtempSync(path.join(base, 'owner-'))
  const supplied = fs.realpathSync(path.join(product, 'node_modules/@gotgenes/pi-subagents'))
  fs.symlinkSync(path.join(product, 'node_modules'), path.join(fixture, 'node_modules'), 'dir')
  const module = path.join(fixture, 'creator.mjs')
  const exports = {
    createChildControlOwner: 'service/child-controls.ts',
    createSessionServiceBinding: 'service/session-owner.ts',
    SubagentsServiceAdapter: 'service/service-adapter.ts',
    createSubagentSession: 'lifecycle/create-subagent-session.ts',
    NotifyParentTool: 'session/notify-parent-tool.ts',
  }
  await build({
    stdin: {
      contents: Object.entries(exports)
        .map(([name, file]) => `export { ${name} } from ${JSON.stringify(path.join(supplied, 'src', file))};`)
        .join('\n'),
      resolveDir: supplied,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: module,
    plugins: [
      {
        name: 'public-subagents-source-map',
        setup(builder) {
          builder.onResolve({ filter: /^#src\// }, ({ path: specifier }) => ({
            path: path.join(supplied, 'src', `${specifier.slice(5)}.ts`),
          }))
        },
      },
    ],
  })
  const {
    createChildControlOwner,
    createSessionServiceBinding,
    SubagentsServiceAdapter,
    createSubagentSession,
    NotifyParentTool,
  } = await import(pathToFileURL(module).href)
  const runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const faux = ai.fauxProvider({ provider: 'child-control-predicate', models: [{ id: 'fixture' }] })
  runtime.registerNativeProvider(faux.provider)
  const settings = sdk.SettingsManager.inMemory({ cacheWarming: 'off', compaction: { enabled: false } })
  const parentManager = sdk.SessionManager.inMemory(fixture)
  const children = []
  const created = []
  const events = []
  let questions = 0,
    updates = 0
  let binding
  const controls = createChildControlOwner(() => binding.isCurrent())
  // This lane injects the service's unrelated manager/runtime collaborators. It
  // tests the real creator+SDK predicate, not parent spawning or Root/PSS policy.
  const service = new SubagentsServiceAdapter({}, () => '', {}, controls)
  binding = createSessionServiceBinding(service)
  binding.start(parentManager)
  const legacy = new SubagentsServiceAdapter({}, () => '', {})
  assert.equal(legacy.ownsChildControlTool(parentManager, undefined), false)
  const lifecycle = Object.fromEntries(
    ['spawning', 'sessionCreated', 'bound', 'disposed', 'completed'].map((name) => [
      name,
      (data) => events.push({ name, data }),
    ]),
  )
  const create = async ({
    missing = false,
    failBind = false,
    sharedManager,
    injected,
    owner = controls,
  } = {}) => {
    let pi
    const child = await createSubagentSession(
      {
        type: 'worker',
        snapshot: { cwd: fixture, systemPrompt: 'Fixture', model: faux.getModel(), modelRegistry: {} },
        askParent: missing
          ? undefined
          : () => {
              questions++
            },
        notifyParent: missing
          ? undefined
          : () => {
              updates++
            },
      },
      {
        childControls: owner,
        exec: async () => {
          throw Error('Unexpected environment command')
        },
        lifecycle,
        resolvePromptInheritance: () => 'full',
        listParentToolNames: () => [],
        registry: {
          resolveAgentConfig: () => ({ name: 'worker', promptMode: 'replace' }),
          getToolNamesForType: () => ['read'],
        },
        io: {
          detectEnv: async () => ({}),
          getAgentDir: () => fixture,
          deriveSessionDir: () => fixture,
          createSettingsManager: () => settings,
          createLoaderSettingsManager: (value) => value,
          createSessionManager: () => sharedManager ?? sdk.SessionManager.inMemory(fixture),
          assemblerIO: { buildAgentPrompt: () => 'Fixture', loadProjectContext: () => [] },
          createResourceLoader: (options) =>
            new sdk.DefaultResourceLoader({
              ...options,
              noSkills: true,
              disabledBuiltinExtensions: ['mcp'],
              extensionFactories: [
                ...options.extensionFactories,
                (api) => {
                  pi = api
                },
              ],
            }),
          createSession: async (options) => {
            const result = await sdk.createAgentSession({
              ...options,
              modelRuntime: runtime,
              customTools: injected ? [injected] : options.customTools,
            })
            created.push(result.session)
            if (failBind) {
              const bind = result.session.bindExtensions.bind(result.session)
              // Explicit factory IO failure injection after genuine public binding;
              // this is rollback coverage, not a claim that the SDK failed itself.
              result.session.bindExtensions = async () => {
                await bind({})
                throw Error('Injected post-bind failure')
              }
            }
            return result
          },
        },
      },
    )
    children.push(child)
    return {
      child,
      pi,
      manager: child.session.sessionManager,
      tool: child.session.getAllTools().find((tool) => tool.name === 'notify_parent'),
    }
  }
  let shadowing
  let checksCompleted = false
  try {
    const a = await create()
    assert.equal(service.ownsChildControlTool(a.manager, a.tool), true)
    assert.equal(
      service.ownsChildControlTool({ getSessionId: () => a.manager.getSessionId() }, a.tool),
      false,
    )
    assert.equal(
      service.ownsChildControlTool(a.manager, { ...a.tool, sourceInfo: { ...a.tool.sourceInfo } }),
      false,
    )
    for (const name of ['functions.notify_parent', 'other', 'unknown_control'])
      assert.equal(service.ownsChildControlTool(a.manager, { ...a.tool, name }), false)

    const original = a.child.session.getToolDefinition('notify_parent')
    const execute = original.execute
    const replacement = {
      ...original,
      execute: async () => {
        throw Error('Unowned replacement executed')
      },
    }
    try {
      a.pi.registerTool(replacement)
      shadowing =
        a.child.session.getToolDefinition('notify_parent') === original
          ? 'SDK custom definition retains precedence over extension registration'
          : 'Public replacement accepted; attestation denied'
    } catch (error) {
      shadowing = `SDK registration rejected: ${String(error)}`
    }
    const winning = a.child.session.getToolDefinition('notify_parent')
    assert.equal(
      winning,
      original,
      'public SDK 1.3 customTools retain precedence over extension registration',
    )
    const staleEntry = a.tool
    a.tool = a.child.session.getAllTools().find((tool) => tool.name === 'notify_parent')
    assert.equal(
      service.ownsChildControlTool(a.manager, staleEntry),
      staleEntry.sourceInfo === a.tool.sourceInfo,
    )
    assert.equal(service.ownsChildControlTool(a.manager, a.tool), true)
    assert.notEqual(replacement.execute, execute)
    // Same object mutation must not make both sides of a comparison drift.
    original.execute = replacement.execute
    assert.equal(a.child.session.getToolDefinition('notify_parent'), original)
    assert.equal(service.ownsChildControlTool(a.manager, a.tool), false)
    original.execute = execute
    assert.equal(service.ownsChildControlTool(a.manager, a.tool), true)

    const wrong = new NotifyParentTool(() => {
      throw Error('Unowned callback executed')
    }).toToolDefinition()
    // Same name/schema/SDK metadata, but a different ACTUAL winning definition
    // was supplied to the real SDK. The creator captured its own bare controls.
    const b = await create({ injected: wrong })
    assert.equal(b.child.session.getToolDefinition('notify_parent'), wrong)
    assert.deepEqual(b.tool.sourceInfo, a.tool.sourceInfo)
    assert.deepEqual(b.tool.parameters, a.tool.parameters)
    assert.equal(service.ownsChildControlTool(b.manager, b.tool), false)
    const noRecorder = await create({ missing: true, injected: wrong })
    assert.equal(service.ownsChildControlTool(noRecorder.manager, noRecorder.tool), false)

    const boundBefore = events.filter((event) => event.name === 'bound').length
    await assert.rejects(create({ failBind: true }), /Injected post-bind failure/)
    const failed = created.at(-1)
    assert.equal(events.filter((event) => event.name === 'bound').length, boundBefore)
    assert.equal(
      service.ownsChildControlTool(
        failed.sessionManager,
        failed.getAllTools().find((tool) => tool.name === 'notify_parent'),
      ),
      false,
    )
    assert.ok(events.some((event) => event.name === 'disposed'))

    // Same exact SDK manager receives a new creator record. Stale shutdown and
    // disposal may only revoke the old record, never the current replacement.
    const fresh = await create({ sharedManager: a.manager })
    assert.equal(service.ownsChildControlTool(fresh.manager, fresh.tool), true)
    await a.child.session.extensionRunner.emit({ type: 'session_start' })
    assert.equal(service.ownsChildControlTool(fresh.manager, fresh.tool), true)
    await a.child.dispose()
    assert.equal(service.ownsChildControlTool(a.manager, a.tool), false)
    assert.equal(service.ownsChildControlTool(fresh.manager, fresh.tool), true)
    await fresh.child.dispose()
    assert.equal(service.ownsChildControlTool(fresh.manager, fresh.tool), false)

    const live = await create()
    const newService = new SubagentsServiceAdapter({}, () => '', {})
    const newBinding = createSessionServiceBinding(newService)
    newBinding.start(parentManager)
    assert.equal(service.ownsChildControlTool(live.manager, live.tool), false)
    binding.start(parentManager)
    assert.equal(binding.isCurrent(), false, 'replaced factory cannot restore itself by stale start')
    assert.equal(newBinding.isCurrent(), true)
    binding.shutdown()
    controls.clear()
    assert.equal(newBinding.isCurrent(), true, 'stale parent shutdown cannot revoke replacement')
    newBinding.shutdown()
    assert.equal(questions, 0)
    assert.equal(updates, 0)
    checksCompleted = true
  } finally {
    controls.clear()
    binding.shutdown()
    for (const child of children) await child.dispose()
    for (const session of created) session.dispose()
    fs.writeFileSync(
      path.join(fixture, 'receipt.json'),
      JSON.stringify(
        {
          checksCompleted,
          actualSDK: true,
          productionCreator: true,
          predicateOnly: true,
          shadowing,
          originalExecuteCapturedSeparately: true,
          callbacksExecuted: questions + updates,
          failedBindIsExplicitIOInjection: true,
          noModelPrompts: true,
          childDisposeAwaited: children.length,
          sdkDisposeInvoked: created.length,
          cleanupCompleted: true,
        },
        null,
        2,
      ),
    )
    console.log(`Child-control predicate receipts: ${fixture}; ${shadowing}`)
  }
})
