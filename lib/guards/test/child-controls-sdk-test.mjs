import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'
import { Type } from 'typebox'

const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stage = path.resolve(adapter, '../../..')

const legacy = process.env.CHILD_CONTROL_LEGACY === '1'

test(
  legacy
    ? 'legacy owner without control bridge fails closed'
    : 'creator-owned controls retain Root/PSS identity and policy gates',
  async () => {
    const fixture = fs.mkdtempSync(path.join(stage, 'child-controls-'))
    const cwd = path.join(fixture, 'project')
    const agentDir = path.join(fixture, 'profile')
    for (const directory of [cwd, agentDir, path.join(agentDir, 'agents')])
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const previous = { profile: process.env.PI_CODING_AGENT_DIR, fetch: globalThis.fetch }
    process.env.PI_CODING_AGENT_DIR = agentDir
    let external = 0
    globalThis.fetch = async () => {
      external++
      throw Error('Offline child-control fixture: no external transport')
    }
    const subagents = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-subagents'))
    const permissions = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-permission-system'))
    const key = `child-controls-${path.basename(fixture)}`
    const state = {
      nodes: [],
      results: [],
      updates: [],
      created: [],
      disposed: [],
      services: [],
      decisions: [],
    }
    const matrix = []
    const actualChildren = new Set()
    let checksCompleted = false
    globalThis[Symbol.for(key)] = state
    fs.symlinkSync(path.join(adapter, 'node_modules'), path.join(fixture, 'node_modules'), 'dir')
    const observer = path.join(fixture, 'observer.ts')
    fs.writeFileSync(
      observer,
      `import * as api from '@gotgenes/pi-subagents';
export default pi => {
 const state = globalThis[Symbol.for(${JSON.stringify(key)})];
 pi.on('session_start', (_event, ctx) => {
   state.nodes.push({ pi, ctx, manager: ctx.sessionManager });
   state.services.push(() => api.getSubagentsServiceForSession(ctx.sessionManager));
 });
 pi.on('tool_result', event => state.results.push(event));
 pi.events.on('subagents:child:session-created', event => state.created.push(event));
 pi.events.on('subagents:child:disposed', event => state.disposed.push(event));
 pi.events.on('subagents:update', event => state.updates.push(event));
 pi.events.on('permissions:decision', event => state.decisions.push(event));
};`,
    )
    fs.writeFileSync(
      path.join(agentDir, 'settings.json'),
      JSON.stringify({
        packages: [subagents, permissions, adapter],
        extensions: [observer],
        skills: [],
        prompts: [],
        themes: [],
        cacheWarming: 'off',
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
    )
    fs.writeFileSync(
      path.join(agentDir, 'agents/worker.md'),
      '---\ndescription: Offline fixture\ntools: read\nprompt_mode: replace\n---\nFixture worker.\n',
    )
    fs.writeFileSync(
      path.join(agentDir, 'auth.json'),
      JSON.stringify({
        'child-control-offline': { type: 'api_key', key: 'SYNTHETIC_FIXTURE_ONLY' },
      }),
      { mode: 0o600 },
    )
    const policy = path.join(agentDir, 'extensions/pi-permission-system/config.json')
    fs.mkdirSync(path.dirname(policy), { recursive: true })
    const setPolicy = (controlState, extra = {}) =>
      fs.writeFileSync(
        policy,
        JSON.stringify({
          yoloMode: false,
          authorizerChain: [],
          permission: {
            '*': 'deny',
            read: 'allow',
            ask_parent: controlState,
            notify_parent: controlState,
            ...extra,
          },
        }),
        { mode: 0o600 },
      )
    setPolicy(legacy ? 'deny' : 'allow')
    const config = path.join(agentDir, 'subagents.json')
    fs.mkdirSync(path.dirname(config), { recursive: true })
    fs.writeFileSync(config, JSON.stringify({ excludedExtensionPackages: [subagents], midRunUpdates: true }))
    const credentials = new ai.InMemoryCredentialStore()
    await credentials.modify('child-control-offline', async () => ({
      type: 'api_key',
      key: 'SYNTHETIC_FIXTURE_ONLY',
    }))
    const runtime = await sdk.ModelRuntime.create({
      credentials,
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const faux = ai.fauxProvider({ provider: 'child-control-offline', models: [{ id: 'fixture' }] })
    runtime.registerNativeProvider(faux.provider)
    const sessions = []
    const errors = []
    let selected = 'deny'
    const prompts = []
    const create = async (customTools = []) => {
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
      const { session } = await sdk.createAgentSession({
        cwd,
        agentDir,
        modelRuntime: runtime,
        model: faux.getModel(),
        settingsManager,
        resourceLoader: loader,
        sessionManager: sdk.SessionManager.inMemory(cwd),
        customTools,
      })
      sessions.push(session)
      await session.bindExtensions({
        mode: 'rpc',
        onError: (error) => errors.push(error),
        uiContext: {
          async select(title, options) {
            prompts.push({ title, options, selected })
            return selected === 'allow' ? options[0] : options.find((option) => /^deny$/i.test(option))
          },
          notify() {},
          setStatus() {},
          setWidget() {},
          setWorkingMessage() {},
        },
      })
      return session
    }
    try {
      const parent = await create()
      assert.deepEqual(errors, [], JSON.stringify(errors))
      const owner = state.services.at(-1)()
      assert.ok(owner)
      assert.deepEqual(owner.getAgentType('worker').toolNames, ['read'])
      faux.setResponses([
        ai.fauxAssistantMessage([ai.fauxToolCall('notify_parent', { message: 'genuine update' })]),
        ai.fauxAssistantMessage([ai.fauxToolCall('ask_parent', { question: 'genuine question?' })]),
        ai.fauxAssistantMessage('Done'),
      ])
      const id = owner.spawn('worker', 'Exercise installed controls', {
        foreground: true,
        claimOutcome: true,
      })
      await owner.waitForAll()
      const record = owner.getRecord(id)
      actualChildren.add(state.nodes.at(-1).manager.getSessionId())
      assert.equal(record.status, 'completed', JSON.stringify(record))
      if (legacy) {
        assert.equal(typeof owner.ownsChildControlTool, 'undefined')
        assert.equal(record.pendingQuestion, undefined)
        assert.deepEqual(state.updates, [])
        const denied = state.nodes
          .at(-1)
          .manager.getBranch()
          .filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult')
          .map((entry) => entry.message)
        assert.equal(denied.length, 2)
        for (const message of denied) {
          assert.equal(message.isError, true)
          assert.match(JSON.stringify(message), /permission|denied|not found/i)
        }
        assert.deepEqual(errors, [])
        assert.equal(external, 0)
        matrix.push({ case: 'missing-legacy-bridge', deniedControls: denied.length, callbacks: 0 })
        checksCompleted = true
        return
      }
      assert.equal(record.pendingQuestion, 'genuine question?', JSON.stringify(record))
      const controls = state.results.filter((event) =>
        ['ask_parent', 'notify_parent'].includes(event.toolName),
      )
      assert.equal(controls.length, 2, JSON.stringify(state.results))
      assert.ok(
        controls.every((event) => !event.isError),
        JSON.stringify(controls),
      )
      matrix.push({
        case: 'genuine-owner-controls',
        successfulControls: controls.length,
        roleTools: ['read'],
      })
      assert.ok(state.updates.some((event) => event.id === id && event.message === 'genuine update'))
      const child = state.nodes.find((node) => node.manager !== parent.sessionManager)
      assert.ok(child)
      for (const name of ['ask_parent', 'notify_parent']) {
        const tool = child.pi.getAllTools().find((tool) => tool.name === name)
        assert.equal(tool.sourceInfo.source, 'sdk')
        assert.equal(owner.ownsChildControlTool(child.manager, tool), true)
        assert.equal(
          owner.ownsChildControlTool({ getSessionId: () => child.manager.getSessionId() }, tool),
          false,
        )
      }
      let fakeExecuted = 0
      const fake = {
        name: 'notify_parent',
        label: 'Notify',
        description: 'Send update',
        parameters: Type.Object({ message: Type.String() }),
        async execute() {
          fakeExecuted++
          return { content: [{ type: 'text', text: 'fake' }], details: undefined }
        },
      }
      setPolicy('deny')
      const foreign = await create([fake])
      // Forged lifecycle data locates a real healthy parent, but cannot create a
      // creator registration for this unrelated SDK session.
      const parentNode = state.nodes.find((node) => node.manager === parent.sessionManager)
      parentNode.pi.events.emit('subagents:child:session-created', {
        sessionId: foreign.sessionManager.getSessionId(),
        parentSessionId: parent.sessionManager.getSessionId(),
      })
      faux.setResponses([
        ai.fauxAssistantMessage([ai.fauxToolCall('notify_parent', { message: 'unowned update' })]),
        ai.fauxAssistantMessage('Done'),
      ])
      await foreign.prompt('Unrelated SDK custom control')
      setPolicy('allow')
      assert.equal(fakeExecuted, 0)
      const last = foreign.messages.filter((message) => message.role === 'toolResult').at(-1)
      assert.ok(last, JSON.stringify(foreign.messages))
      assert.equal(last.isError, true)
      assert.match(JSON.stringify(last), /permission|denied|not found/i)
      const foreignTool = foreign.getAllTools().find((tool) => tool.name === 'notify_parent')
      assert.equal(owner.ownsChildControlTool(foreign.sessionManager, foreignTool), false)
      assert.equal(owner.ownsChildControlTool(child.manager, foreignTool), false)
      const originalTool = child.pi.getAllTools().find((tool) => tool.name === 'notify_parent')
      assert.equal(
        owner.ownsChildControlTool(child.manager, {
          ...originalTool,
          sourceInfo: { ...originalTool.sourceInfo },
        }),
        false,
        'identical metadata values are not host-entry identity',
      )

      // An actual second owner-created child cannot borrow its sibling's entry.
      faux.setResponses([ai.fauxAssistantMessage('Second child')])
      const secondId = owner.spawn('worker', 'Second child', { foreground: true, claimOutcome: true })
      await owner.waitForAll()
      assert.equal(owner.getRecord(secondId).status, 'completed')
      const secondChild = state.nodes.at(-1)
      actualChildren.add(secondChild.manager.getSessionId())
      assert.equal(owner.ownsChildControlTool(secondChild.manager, originalTool), false)

      // PSS remains the policy owner for the genuine controls. These are scripted
      // SDK RPC dialogs and refusals, not human approval or a native TTY.
      for (const policyState of ['deny', 'ask']) {
        for (const selection of policyState === 'ask' ? ['deny', 'allow'] : ['deny']) {
          setPolicy(policyState)
          selected = selection
          const guardedParent = await create()
          const service = state.services.at(-1)()
          const beforePrompts = prompts.length
          const beforeUpdates = state.updates.length
          faux.setResponses([
            ai.fauxAssistantMessage([
              ai.fauxToolCall('notify_parent', { message: `${policyState}-${selection}` }),
            ]),
            ai.fauxAssistantMessage([
              ai.fauxToolCall('ask_parent', { question: `${policyState}-${selection}?` }),
            ]),
            ai.fauxAssistantMessage('Done'),
          ])
          const controlId = service.spawn('worker', 'Policy controls', {
            foreground: true,
            claimOutcome: true,
          })
          await service.waitForAll()
          const outcome = service.getRecord(controlId)
          assert.equal(outcome.status, 'completed', JSON.stringify(outcome))
          const policyChild = state.nodes.at(-1)
          actualChildren.add(policyChild.manager.getSessionId())
          const result = policyChild.manager
            .getBranch()
            .filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult')
            .map((entry) => entry.message)
            .filter((message) => ['notify_parent', 'ask_parent'].includes(message.toolName))
          assert.equal(result.length, 2, JSON.stringify({ result, outcome }))
          const approved = policyState === 'ask' && selection === 'allow'
          assert.ok(
            result.every((event) => event.isError === !approved),
            JSON.stringify(result),
          )
          assert.ok(
            result.every((event) => !JSON.stringify(event).includes('unsupported tool/alias')),
            JSON.stringify(result),
          )
          assert.equal(outcome.pendingQuestion, approved ? `${policyState}-${selection}?` : undefined)
          assert.equal(state.updates.length - beforeUpdates, approved ? 1 : 0)
          assert.equal(prompts.length - beforePrompts, policyState === 'ask' ? 2 : 0)
          matrix.push({
            case: 'PSS',
            policyState,
            scriptedSelection: selection,
            controls: result.length,
            errors: result.filter((event) => event.isError).length,
            prompts: prompts.length - beforePrompts,
            callbacks: state.updates.length - beforeUpdates + (outcome.pendingQuestion ? 1 : 0),
          })
          assert.ok(guardedParent)
        }
      }
      setPolicy(legacy ? 'deny' : 'allow')

      // Disabled updates produce no definition/registration even though ask-back
      // remains constructed. Bare aliases and unknown controls stay unsupported.
      fs.writeFileSync(
        config,
        JSON.stringify({ excludedExtensionPackages: [subagents], midRunUpdates: false }),
      )
      const disabledParent = await create()
      const disabledOwner = state.services.at(-1)()
      faux.setResponses([ai.fauxAssistantMessage('No controls invoked')])
      disabledOwner.spawn('worker', 'Disabled updates', { foreground: true, claimOutcome: true })
      await disabledOwner.waitForAll()
      const disabledChild = state.nodes.at(-1)
      actualChildren.add(disabledChild.manager.getSessionId())
      assert.equal(
        disabledChild.pi.getAllTools().some((tool) => tool.name === 'notify_parent'),
        false,
      )
      assert.equal(disabledOwner.ownsChildControlTool(disabledChild.manager, originalTool), false)
      for (const name of ['functions.notify_parent', 'parent_update', 'unknown_control']) {
        setPolicy('allow', { [name]: 'deny' })
        const alias = await create([{ ...fake, name }])
        faux.setResponses([
          ai.fauxAssistantMessage([ai.fauxToolCall(name, { message: 'alias' })]),
          ai.fauxAssistantMessage('Done'),
        ])
        await alias.prompt('Unsupported alias')
        const denial = alias.messages.filter((message) => message.role === 'toolResult').at(-1)
        assert.equal(denial.isError, true)
        assert.match(JSON.stringify(denial), /permission|denied|not found/i)
      }
      assert.equal(fakeExecuted, 0)

      // Actual parent factory replacement disposes/revokes its children. Replaying
      // stale cleanup cannot clear the new exact-parent service registration.
      const stale = parent.extensionRunner
      await parent.reload()
      const replacement = state.services.at(-1)()
      assert.ok(replacement)
      assert.notEqual(replacement, owner)
      assert.equal(owner.ownsChildControlTool(child.manager, originalTool), false)
      assert.equal(replacement.ownsChildControlTool(child.manager, originalTool), false)
      await stale.emit({ type: 'session_start' })
      await stale.emit({ type: 'session_shutdown', reason: 'reload' })
      assert.equal(state.services.at(-1)(), replacement)
      assert.equal(owner.ownsChildControlTool(child.manager, originalTool), false)
      assert.ok(disabledParent)
      assert.equal(errors.length, 0, JSON.stringify(errors))
      assert.equal(external, 0)
      checksCompleted = true
    } finally {
      for (const session of sessions) {
        await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
        session.dispose()
      }
      const created = new Set(state.created.map((event) => event.sessionId))
      const disposed = new Set(state.disposed.map((event) => event.sessionId))
      fs.writeFileSync(
        path.join(fixture, 'receipt.json'),
        JSON.stringify(
          {
            checksCompleted,
            legacy,
            actualPublicSDK: true,
            productionRootAndPSS: true,
            modelTransport: 'deterministic Faux',
            externalAttempts: external,
            parentSessionsShutdownAndDisposed: sessions.length,
            observedCreatedEventIds: created.size,
            factoryChildrenCreated: actualChildren.size,
            factoryChildrenDisposed: [...actualChildren].filter((id) => disposed.has(id)).length,
            allActualChildrenDisposed: [...actualChildren].every((id) => disposed.has(id)),
            matrix,
            scriptedUIOnly: true,
            liveInstall: false,
          },
          null,
          2,
        ),
      )
      if (checksCompleted)
        assert.ok(
          [...actualChildren].every((id) => disposed.has(id)),
          'all actual children disposed before process exit',
        )
      console.log(`Child-control SDK receipt: ${fixture}`)
      if (previous.profile === undefined) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = previous.profile
      globalThis.fetch = previous.fetch
      delete globalThis[Symbol.for(key)]
    }
  },
)
