import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import * as ai from '@earendil-works/pi-ai'
import * as sdk from '@earendil-works/pi-coding-agent'

const primary = path.resolve(import.meta.dirname, '../../..')
const stage = path.dirname(primary)
const modules = path.join(primary, 'node_modules')
const subagents = fs.realpathSync(path.join(modules, '@gotgenes/pi-subagents'))
const pss = fs.realpathSync(path.join(modules, '@gotgenes/pi-permission-system'))
const provider = 'orchestrator-offline'
const marker = 'SYNTHETIC_PARENT_ONLY'
const promptMarker = 'SYNTHETIC_PRIVATE_SYSTEM_PROMPT'
const memoryMarker = 'SYNTHETIC_FLAT_MEMORY_PROJECTION'
const role = 'implementer'
const carrier = 'mh_orchestrate_dispatch'
const blocker = 'BLOCKER: fixture input contradicts the plan; return the decision to Main.'
const ordinaryPrompt = 'Synthetic assigned work only. Return the blocker without making changes.'
const args = (description, subagentType = role) => ({
  description,
  prompt: ordinaryPrompt,
  subagent_type: subagentType,
  // Deliberately contradict the synthetic role lock. Production would not request a model override.
  model: `${provider}/main-b`,
  thinking: 'off',
  inherit_context: false,
  run_in_background: true,
})

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function bounded(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), 5_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function expectNativeCompletionTurn(session) {
  const settled = deferred()
  let seen = false
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'message_start' && event.message.customType === 'subagent-notification') seen = true
    if (event.type === 'agent_settled' && seen) settled.resolve()
  })
  return () => bounded(settled.promise, 'native completion-triggered Main turn').finally(unsubscribe)
}

// Observe the shipped trial without substituting its dispatch path. This hook
// also injects stale events and can remove a role after the public preflight.
function observation(lane, get, pi) {
  pi.on('session_start', (_event, ctx) => {
    lane.manager = ctx.sessionManager
    lane.entry = () => pi.getAllTools().find((tool) => tool.name === 'subagent')
    lane.guard = () =>
      globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')]
        ?.get(lane.manager.getSessionId())
        ?.guard?.healthy()
    lane.service = () => get(ctx.sessionManager)
  })
  pi.on('tool_call', async (event) => {
    if (event.toolName === carrier) await lane.beforeFacade?.()
    if (event.toolName !== 'subagent') return
    lane.calls.push({ id: event.toolCallId, parent: event.parentToolCallId, input: event.input })
    if (lane.beforeSpawn && event.parentToolCallId) await lane.beforeSpawn()
  })
  pi.on('tool_result', (event) => {
    if (event.toolName === 'subagent' && event.parentToolCallId && lane.substituteId) {
      return { details: { ...event.details, agentId: lane.substituteId } }
    }
  })
  lane.poke = (id) => pi.events.emit('subagents:completed', { id, status: 'completed' })
}

test('optional orchestration through guarded native SDK: exact role, OFF drain, and same-manager reload', {
  timeout: 30_000,
}, async () => {
  const root = fs.mkdtempSync(path.join(stage, 'orchestrator-spike-'))
  const home = path.join(root, 'home')
  fs.mkdirSync(home)
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = path.join(home, '.config')
  process.env.XDG_CACHE_HOME = path.join(home, '.cache')
  process.env.PI_TELEMETRY = '0'
  let network = 0
  globalThis.fetch = async () => {
    network++
    throw Error('Offline fixture: no network')
  }
  const faux = ai.fauxProvider({
    provider,
    models: [{ id: 'main-a' }, { id: 'main-b' }, { id: 'locked-writer', reasoning: true }],
  })
  const credentials = new ai.InMemoryCredentialStore()
  await credentials.modify(provider, async () => ({ type: 'api_key', key: 'SYNTHETIC_FIXTURE_ONLY' }))
  const modelRuntime = await sdk.ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  const childInferences = []
  const parentInferences = []
  let latestParentPrompt
  const ordinaryPromptReceipts = []
  let parentPromptObserved = false
  const errors = []
  const sessions = []
  let nextCall
  let hold
  const respond = async (ctx, options, _state, model) => {
    const transcript = JSON.stringify(ctx.messages)
    if (
      ctx.messages.some(
        (message) => message.role === 'user' && JSON.stringify(message.content).includes(ordinaryPrompt),
      )
    ) {
      ordinaryPromptReceipts.push(transcript.includes(promptMarker))
      return ai.fauxAssistantMessage(blocker)
    }
    if (model.id === 'locked-writer') {
      childInferences.push({
        model: model.id,
        reasoning: options?.reasoning,
        inherited: JSON.stringify(ctx.messages).includes(marker),
        inheritedPrompt: JSON.stringify(ctx.messages).includes(promptMarker),
      })
      const gate = hold
      if (gate) {
        gate.started.resolve()
        await gate.finish.promise
        if (gate.error)
          return ai.fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Synthetic worker error' })
      }
      return ai.fauxAssistantMessage(blocker)
    }
    parentInferences.push(model.id)
    latestParentPrompt = ai.getCurrentSystemPrompt(ctx.messages)
    parentPromptObserved ||= JSON.stringify(ctx.messages).includes(promptMarker)
    const tool = nextCall
    nextCall = undefined
    return tool
      ? ai.fauxAssistantMessage(ai.fauxToolCall(tool.name, tool.args))
      : ai.fauxAssistantMessage('Main stays idle after its reply.')
  }
  faux.setResponses(Array.from({ length: 100 }, () => respond))
  const create = async (name, model, permission, { flatMemory = false } = {}) => {
    const cwd = path.join(root, name, 'project')
    const agentDir = path.join(root, name, 'agent')
    process.env.PI_CODING_AGENT_DIR = agentDir
    for (const d of [
      cwd,
      path.join(agentDir, 'agents'),
      path.join(agentDir, 'extensions/pi-permission-system'),
    ])
      fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(cwd, 'safe.txt'), 'ORCHESTRATE_FIXTURE_READ_OK\n')
    fs.writeFileSync(
      path.join(agentDir, 'settings.json'),
      JSON.stringify({
        packages: [primary, pss, subagents],
        cacheWarming: 'off',
        retry: { enabled: false },
        compaction: { enabled: false },
      }),
    )
    fs.writeFileSync(
      path.join(agentDir, 'subagents.json'),
      JSON.stringify({ excludedExtensionPackages: [subagents], maxConcurrent: 1 }),
    )
    fs.writeFileSync(
      path.join(agentDir, 'auth.json'),
      JSON.stringify({ [provider]: { type: 'api_key', key: 'SYNTHETIC_FIXTURE_ONLY' } }),
      { mode: 0o600 },
    )
    const roleFile = path.join(agentDir, 'agents', `${role}.md`)
    fs.writeFileSync(
      roleFile,
      `---\nname: ${role}\ndescription: Locked synthetic writer\nmodel: ${provider}/locked-writer\nthinking: medium\nlocked: model, thinking\ninherit_context: false\ntools: []\nprompt_mode: replace\n---\nRun offline and report the tagged blocker.\n`,
    )
    fs.writeFileSync(
      path.join(agentDir, 'extensions/pi-permission-system/config.json'),
      JSON.stringify({
        authorizerChain: [],
        yoloMode: false,
        permission: { '*': 'allow', bash: { '*': 'allow' }, subagent: permission },
      }),
    )
    const lane = { calls: [], statuses: new Map(), notices: [] }
    const bridge = path.join(root, name, 'observer.ts')
    // The patched public package uses Pi's Jiti loader for its source export.
    // Symbols are local to the fixture; only the public getter crosses the bridge.
    const share = Symbol.for(`orchestrator-spike:${root}:${name}`)
    globalThis[share] = (get, pi) => {
      observation(lane, get, pi)
    }
    fs.symlinkSync(modules, path.join(root, name, 'node_modules'), 'dir')
    fs.writeFileSync(
      bridge,
      `import { getSubagentsServiceForSession as get } from '@gotgenes/pi-subagents';\nexport default pi => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(share))})](get, pi);\n`,
    )
    const memory = path.join(root, name, 'flat-memory.ts')
    if (flatMemory)
      fs.writeFileSync(
        memory,
        `export default pi => { pi.on('before_agent_start', e => ({systemPrompt: e.systemPrompt + ${JSON.stringify(`\n${memoryMarker}`)}})); };`,
      )
    const settingsManager = sdk.SettingsManager.create(cwd, agentDir)
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      systemPromptOverride: (base) => `${promptMarker}\n\n${base}`,
      disabledBuiltinExtensions: ['mcp'],
      additionalExtensionPaths: [
        ...(flatMemory ? [memory] : []),
        path.join(primary, 'extensions/mahiro-orchestrator.ts'),
        bridge,
      ],
    })
    await resourceLoader.reload()
    assert.deepEqual(resourceLoader.getExtensions().errors, [])
    const { session } = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager,
      resourceLoader,
      modelRuntime,
      model: faux.getModel(model),
      sessionManager: sdk.SessionManager.create(cwd, path.join(root, name, 'sessions')),
    })
    sessions.push(session)
    await session.bindExtensions({
      mode: 'rpc',
      onError: (error) => errors.push(error),
      uiContext: {
        notify(text) {
          lane.notices.push(text)
        },
        setStatus(key, value) {
          lane.statuses.set(key, value)
        },
        setWidget() {},
        setWorkingMessage() {},
      },
    })
    const service = lane.service()
    assert.ok(service)
    const call = async (name, args) => {
      const from = session.messages.length
      nextCall = { name, args }
      await bounded(session.prompt(marker), name)
      const receipt = session.messages
        .slice(from)
        .find((entry) => entry.role === 'toolResult' && entry.toolName === name)
      assert.ok(receipt, JSON.stringify(session.messages.slice(from)).slice(-3500))
      return receipt
    }
    return {
      lane,
      session,
      service,
      call,
      roleFile,
      status: () => lane.statuses.get('mahiro-orchestrator'),
      toggle: () => bounded(session.prompt('/mh-orchestrate'), 'mode toggle'),
      dispatch: (description) =>
        call(carrier, {
          description,
          brief: 'Only inspect the mock input; return the blocker if the plan does not fit.',
        }),
    }
  }
  try {
    const rpc = await create('rpc-control', 'main-a', 'allow', { flatMemory: true })
    const rpcControl = async (text, expandPromptTemplates) => {
      const before = parentInferences.length
      let disposition
      await bounded(
        rpc.session.prompt(text, {
          source: 'rpc',
          expandPromptTemplates,
          preflightResult: (value) => (disposition = value),
        }),
        text,
      )
      assert.equal(disposition, 'handled')
      assert.equal(parentInferences.length, before)
      assert.deepEqual(rpc.service.listAgents(), [])
      return rpc.lane.notices.at(-1)
    }
    assert.equal(await rpcControl('/mh-orchestrate status', true), 'Orch off')
    assert.equal(await rpcControl('  /mh-orchestrate on\n', false), 'Orch on')
    assert.equal(await rpcControl('/mh-orchestrate on', true), 'Orch on')
    assert.equal(await rpcControl('/mh-orchestrate status', false), 'Orch on')
    await bounded(rpc.session.prompt('An ordinary request after enabling Orch.'), 'flat prompt ON')
    assert.match(latestParentPrompt, /SYNTHETIC_FLAT_MEMORY_PROJECTION/)
    assert.match(latestParentPrompt, /Orchestration is ON.*not permission/)
    assert.equal(await rpcControl('/mh-orchestrate off', true), 'Orch off')
    // T3 appends attachment context to the RPC text; that is not an ON operand.
    assert.equal(
      await rpcControl('/mh-orchestrate on\n\n[Attached image "sample.png" is saved at: fixture.png]', true),
      'Usage: /mh-orchestrate [on|off|status]',
    )
    // Neither quoted user text nor an extension-injected message is a switch.
    await bounded(rpc.session.prompt('`/mh-orchestrate on`', { source: 'rpc' }), 'quoted command')
    await bounded(
      rpc.session.prompt('/mh-orchestrate on', { source: 'extension', expandPromptTemplates: false }),
      'injected command text',
    )
    assert.equal(await rpcControl('/mh-orchestrate status', true), 'Orch off')
    assert.match(latestParentPrompt, /SYNTHETIC_FLAT_MEMORY_PROJECTION/)
    assert.doesNotMatch(latestParentPrompt, /Orchestration is ON/)

    const denied = await create('denied', 'main-a', 'deny')
    await denied.toggle()
    assert.equal(
      denied.status(),
      'Orch on',
      JSON.stringify({
        notices: denied.lane.notices,
        tool: denied.lane.entry()?.sourceInfo,
        guard: denied.lane.guard(),
        subagents,
      }),
    )
    assert.equal((await denied.dispatch('denied by PSS')).details.state, 'not-started')
    assert.deepEqual(denied.service.listAgents(), [])

    const absent = await create('missing', 'main-b', 'allow')
    await absent.toggle()
    // The role is initially present in the service cache. Remove it during the
    // guarded nested call, before the native tool reloads its own registry.
    absent.lane.beforeSpawn = () => fs.unlinkSync(absent.roleFile)
    assert.equal((await absent.dispatch('role disappeared')).details.state, 'not-started')
    absent.lane.beforeSpawn = undefined
    assert.deepEqual(absent.service.listAgents(), [])
    assert.equal((await absent.dispatch('role still absent')).details.state, 'unavailable')
    assert.equal(absent.lane.calls.length, 1)

    const noModel = await create('missing-model', 'main-a', 'allow')
    await noModel.toggle()
    const roleText = fs.readFileSync(noModel.roleFile, 'utf8')
    fs.writeFileSync(noModel.roleFile, roleText.replace('/locked-writer', '/unavailable-fixture-model'))
    assert.equal((await noModel.dispatch('no exact model')).details.state, 'not-started')
    fs.writeFileSync(noModel.roleFile, roleText.replace(/^model: .*\n/m, ''))
    assert.equal((await noModel.dispatch('must not inherit the Main model')).details.state, 'not-started')
    assert.deepEqual(noModel.service.listAgents(), [])

    const facade = await create('stale-facade', 'main-a', 'allow')
    await facade.toggle()
    const hook = { started: deferred(), finish: deferred() }
    facade.lane.beforeFacade = async () => {
      hook.started.resolve()
      await hook.finish.promise
    }
    const stale = facade.dispatch('pause before facade execution')
    try {
      await bounded(hook.started.promise, 'pending facade hook')
      await facade.toggle()
      assert.equal(facade.status(), 'Orch off')
      await facade.toggle()
      assert.equal(facade.status(), 'Orch on')
    } finally {
      hook.finish.resolve()
    }
    assert.equal((await stale).details.state, 'stale-mode')
    assert.deepEqual(facade.lane.calls, [])
    assert.deepEqual(facade.service.listAgents(), [])

    const pending = await create('pending', 'main-a', 'allow')
    await pending.toggle()
    const admission = { started: deferred(), finish: deferred() }
    pending.lane.beforeSpawn = async () => {
      admission.started.resolve()
      await admission.finish.promise
    }
    const admitted = pending.dispatch('pause guarded admission')
    try {
      await bounded(admission.started.promise, 'pending nested call')
      assert.equal(pending.status(), 'Orch · dispatching')
      await pending.toggle()
      assert.equal(pending.status(), 'Orch off · cancelling dispatch')
    } finally {
      admission.finish.resolve()
    }
    assert.equal((await admitted).details.state, 'not-started')
    assert.equal(pending.status(), 'Orch off')
    assert.deepEqual(pending.service.listAgents(), [])

    let previous
    for (const model of ['main-a', 'main-b']) {
      const parent = await create(model, model, 'allow')
      assert.equal(parent.status(), 'Orch off')
      assert.equal((await parent.dispatch('off must not launch')).details.state, 'off')
      const beforeToggle = parentInferences.length
      await parent.toggle()
      assert.equal(parentInferences.length, beforeToggle, 'toggle never invokes Main')
      assert.equal(parent.status(), 'Orch on')
      await bounded(parent.session.prompt('Ordinary question; no tool is needed.'), 'Q&A')
      assert.ok(
        parent.session.messages.some((message) =>
          message.sections?.['mahiro-orchestrator']?.includes('Orchestration is ON for this session'),
        ),
      )
      assert.deepEqual(parent.service.listAgents(), [])
      await parent.toggle()
      assert.equal(parent.status(), 'Orch off')
      const ordinaryNotice = expectNativeCompletionTurn(parent.session)
      const normal = await parent.call('subagent', args(`ordinary unowned ${model}`))
      assert.equal(normal.details.status, 'background', JSON.stringify(normal))
      await bounded(parent.service.waitForAll(), 'ordinary worker')
      await ordinaryNotice()
      assert.equal(ordinaryPromptReceipts.at(-1), true, 'unflagged child receives the parent base')
      const unowned = normal.details.agentId
      parent.lane.poke(unowned)
      assert.equal(parent.status(), 'Orch off')
      await parent.toggle()
      assert.equal(parent.status(), 'Orch on')
      if (previous) {
        assert.notEqual(parent.lane.manager, previous.manager)
        assert.notEqual(parent.service, previous.service)
        parent.lane.poke(previous.id)
        assert.equal(parent.status(), 'Orch on')
      }

      const todo = await parent.call('mh_task_create', { subject: 'Main must check the worker report' })
      assert.equal(todo.details.status, 'pending')
      hold = { started: deferred(), finish: deferred() }
      const started = await parent.dispatch(`owned writer ${model}`)
      assert.equal(started.details.state, 'dispatched', JSON.stringify(started))
      await bounded(hold.started.promise, 'locked writer starts')
      const id = started.details.agentId
      assert.notEqual(id, unowned)
      assert.equal(parent.lane.calls.at(-1).parent, started.toolCallId)
      assert.equal(parent.lane.calls.at(-1).input.inherit_context, false)
      assert.equal(parent.lane.calls.at(-1).input.model, undefined)
      assert.deepEqual(childInferences.at(-1), {
        model: 'locked-writer',
        reasoning: 'medium',
        inherited: false,
        inheritedPrompt: false,
      })
      assert.equal(parent.status(), 'Orch · implementer running')
      parent.lane.poke(unowned)
      parent.lane.poke(id)
      assert.equal(
        parent.status(),
        'Orch · implementer running',
        'a forged completion cannot set a live worker terminal',
      )
      await parent.toggle()
      assert.equal(parent.status(), 'Orch off · implementer running')
      assert.equal((await parent.dispatch('no work while off')).details.state, 'off')
      assert.equal(parent.service.getRecord(id).status, 'running')
      await parent.toggle()
      assert.equal((await parent.dispatch('no second writer')).details.state, 'occupied')
      await parent.toggle()
      const offNotice = expectNativeCompletionTurn(parent.session)
      const beforeNotice = parentInferences.length
      const beforeOffMessages = parent.session.messages.length
      hold.finish.resolve()
      await bounded(parent.service.waitForAll(), 'OFF drains worker')
      hold = undefined
      await offNotice()
      assert.equal(parentInferences.length - beforeNotice, 1)
      assert.ok(
        !parent.session.messages
          .slice(beforeOffMessages)
          .some((message) =>
            message.sections?.['mahiro-orchestrator']?.includes('Orchestration is ON for this session'),
          ),
      )
      assert.equal(parent.status(), 'Orch off · implementer finished (Main review)')
      assert.equal((await parent.call('mh_task_list', {})).details.tasks[0].status, 'pending')
      assert.equal(parent.service.getRecord(id).result, blocker)
      assert.equal(parent.service.listAgents().length, 2)
      assert.equal(parent.session.model.id, model)
      await parent.toggle()
      assert.equal(parent.status(), 'Orch · implementer finished (Main review)')
      parent.lane.poke(id)
      assert.equal(
        parent.status(),
        'Orch · implementer finished (Main review)',
        'duplicate completion never dispatches or implies acceptance',
      )
      const read = await parent.call('read', { path: 'safe.txt' })
      const bash = await parent.call('bash', { command: 'printf ORCHESTRATE_FIXTURE_BASH_OK' })
      assert.equal(read.isError, false)
      assert.equal(bash.isError, false)
      assert.match(JSON.stringify(read.content), /ORCHESTRATE_FIXTURE_READ_OK/)
      assert.match(JSON.stringify(bash.content), /ORCHESTRATE_FIXTURE_BASH_OK/)
      previous = { manager: parent.lane.manager, service: parent.service, id }
      if (model === 'main-b') {
        hold = { started: deferred(), finish: deferred() }
        const retiring = await parent.dispatch('active during same-manager reload')
        assert.equal(retiring.details.state, 'dispatched')
        await bounded(hold.started.promise, 'reload worker starts')
        previous.id = retiring.details.agentId
        assert.equal(parent.service.getRecord(previous.id).status, 'running')
        const reload = parent.session.reload()
        hold.finish.resolve()
        await bounded(reload, 'reload with a native worker in flight')
        hold = undefined
      } else {
        hold = { started: deferred(), finish: deferred(), error: true }
        const willFail = expectNativeCompletionTurn(parent.session)
        const failed = await parent.dispatch('owned writer with synthetic provider error')
        assert.equal(failed.details.state, 'dispatched')
        await bounded(hold.started.promise, 'failing writer starts')
        hold.finish.resolve()
        await willFail()
        hold = undefined
        assert.equal(parent.service.getRecord(failed.details.agentId).status, 'error')
        assert.equal(parent.status(), 'Orch · implementer failed')
        await parent.session.reload()
      }
      assert.equal(parent.lane.manager, previous.manager, 'SDK reload uses the same manager')
      assert.notEqual(parent.lane.service(), previous.service)
      assert.equal(parent.status(), 'Orch off')
      parent.lane.poke(previous.id)
      assert.equal((await parent.dispatch('old completion cannot reopen mode')).details.state, 'off')
      await parent.toggle()
      parent.lane.poke(previous.id)
      assert.equal(parent.status(), 'Orch on', 'the new generation never adopts the old receipt')
      assert.equal(parent.lane.service().listAgents().length, 0)
    }
    const forged = await create('forged-result', 'main-a', 'allow')
    await forged.toggle()
    const ordinaryNotice = expectNativeCompletionTurn(forged.session)
    const ordinary = await forged.call('subagent', args('unrelated result'))
    await ordinaryNotice()
    forged.lane.substituteId = ordinary.details.agentId
    hold = { started: deferred(), finish: deferred() }
    assert.equal((await forged.dispatch('receipt overwritten')).details.state, 'unknown')
    await bounded(hold.started.promise, 'unverified native job starts')
    assert.equal(forged.status(), 'Orch · unknown')
    assert.equal((await forged.dispatch('unknown must not retry')).details.state, 'unknown')
    assert.equal(forged.service.listAgents().length, 2)
    const unknownNotice = expectNativeCompletionTurn(forged.session)
    hold.finish.resolve()
    await unknownNotice()
    hold = undefined
    assert.equal(forged.status(), 'Orch · unknown')
    assert.deepEqual(errors, [])
    assert.equal(parentPromptObserved, true, 'the parent marker was present in a real Faux input')
    assert.equal(network, 0)
  } finally {
    hold?.finish.resolve()
    for (const session of sessions.reverse()) await session.dispose()
  }
})
