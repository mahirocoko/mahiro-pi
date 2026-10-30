import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import './owned-provenance-test.mjs'
import { createMemoryStore } from '../../agent-memory/store.ts'
import { installedWriter, preflightWriterRoute } from '../../agent-memory/writer-route.ts'

const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const evidence = path.join(product, '.agent-state/runtime/ordinary-memory-install')
fs.mkdirSync(evidence, { recursive: true })

test('ordinary standard install, native eligible writer publication, policy CAS and existing-user upgrade use no fixture selector', async () => {
  const directory = fs.mkdtempSync(path.join(evidence, 'journey-'))
  const profile = path.join(directory, 'profile'),
    cwd = path.join(directory, 'project'),
    home = path.join(directory, 'home')
  for (const dir of [profile, cwd, home]) fs.mkdirSync(dir, { mode: 0o700 })
  const root = path.join(profile, 'memory')
  const previous = { ...process.env }
  for (const key of Object.keys(process.env))
    if (/^(?:GIT_|PI_|MAHIRO_)/.test(key) || /API_KEY/.test(key)) delete process.env[key]
  Object.assign(process.env, {
    HOME: home,
    PI_CODING_AGENT_DIR: profile,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: directory,
  })
  fs.writeFileSync(
    process.env.GIT_CONFIG_GLOBAL,
    '[user]\n name = Ordinary synthetic\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
    { mode: 0o600 },
  )
  const originalFetch = globalThis.fetch
  let external = 0
  globalThis.fetch = () => {
    external++
    throw Error('External transport forbidden')
  }
  let session
  let service
  let releaseBlocker = () => {}
  // This standalone installer test uses the actual public root layout. The
  // shared SDK staging helper normally keeps a legacy guard-local module link;
  // restore that disposable staging layout after natural session drain.
  const modules = path.join(product, 'node_modules')
  const guardModules = path.join(product, 'lib/guards/node_modules')
  const relocated = fs.lstatSync(modules).isSymbolicLink() && fs.realpathSync(modules) === guardModules
  if (relocated) {
    fs.unlinkSync(modules)
    fs.renameSync(guardModules, modules)
  }
  try {
    const install = (...args) => {
      const result = spawnSync(
        process.execPath,
        [path.join(product, 'install.mjs'), '--agent-dir', profile, ...args],
        { cwd, env: process.env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      )
      assert.equal(result.status, 0, result.stderr)
      return JSON.parse(result.stdout)
    }
    const receipt = install(
      '--managed-writer-model',
      'ordinary-faux/writer-v1',
      '--managed-writer-thinking',
      'off',
    )
    assert.equal(receipt.status, 'completed')
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, '.mahiro-memory-engine.json'), 'utf8')), {
      version: 2,
      root,
      mode: 'engine',
    })
    fs.writeFileSync(path.join(profile, 'subagents.json'), JSON.stringify({ maxConcurrent: 1 }), {
      mode: 0o600,
    })
    fs.writeFileSync(
      path.join(profile, 'agents/queue-blocker.md'),
      '---\nname: queue-blocker\nmodel: ordinary-faux/parent-similar\nrun_in_background: true\nprompt_mode: replace\n---\nQUEUE_BLOCKER_ONLY\n',
      { mode: 0o600 },
    )
    // Public loaded descriptors expose no body/maxTurns. A project override must
    // not replace the canonical public prompt or the explicit per-call 8-turn budget.
    fs.mkdirSync(path.join(cwd, '.pi/agents'), { recursive: true, mode: 0o700 })
    fs.writeFileSync(
      path.join(cwd, '.pi/agents/managed-memory-writer.md'),
      fs
        .readFileSync(path.join(profile, 'agents/managed-memory-writer.md'), 'utf8')
        .replace('max_turns: 8', 'max_turns: 999') + '\nPROJECT_OVERRIDE_BODY_MUST_NOT_REACH_MODEL\n',
      { mode: 0o600 },
    )
    const installedStarter = fs.readFileSync(path.join(root, 'Core.md'), 'utf8')
    assert.match(installedStarter, /Language|language/)
    const permissionPath = path.join(profile, 'extensions/pi-permission-system/config.json')
    let permission = JSON.parse(fs.readFileSync(permissionPath, 'utf8'))
    assert.equal(
      Object.keys(permission.permission).some((key) => key.startsWith('continuity_learning_')),
      false,
    )
    // Synthetic observer captures actual public context, never substitutes it.
    const observation = Symbol.for('@mahirocoko/ordinary-memory-test:ctx')
    globalThis[observation] = []
    fs.writeFileSync(
      path.join(profile, 'extensions/ordinary-observer.ts'),
      `export default pi => {
        const observed=globalThis[Symbol.for('@mahirocoko/ordinary-memory-test:ctx')];
        pi.on('session_start', (_,ctx) => observed.push({ctx,tools:pi.getAllTools()}));
        pi.on('before_agent_start', (_,ctx) => {
          (observed.beforeStarts ??= []).push({session:ctx.sessionManager.getSessionId(),
            model:ctx.model && {provider:ctx.model.provider,id:ctx.model.id,api:ctx.model.api,baseUrl:ctx.model.baseUrl}});
        });
      }\n`,
      { mode: 0o600 },
    )
    const sdk = await import('@earendil-works/pi-coding-agent')
    const ai = await import('@earendil-works/pi-ai')
    const runtime = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const faux = ai.fauxProvider({
      provider: 'ordinary-faux',
      models: [{ id: 'writer-v1' }, { id: 'parent-similar' }],
    })
    runtime.registerNativeProvider(faux.provider)
    await runtime.refresh({ allowNetwork: false })
    let children = 0
    let blockerEntered, blockerRelease
    const blockerReady = new Promise((resolve) => {
      blockerEntered = resolve
    })
    const blockerGate = new Promise((resolve) => {
      blockerRelease = resolve
      releaseBlocker = resolve
    })
    const modelCalls = []
    const parentPrompts = [],
      childPrompts = []
    faux.setResponses(
      Array.from({ length: 64 }, () => async (context, _options, _state, model) => {
        const message = context.messages.find((message) => message.role === 'system')
        const system = message?.sections?.preamble ?? message?.content ?? ''
        modelCalls.push({ provider: model.provider, id: model.id, system: JSON.stringify(system) })
        if (JSON.stringify(system).includes('QUEUE_BLOCKER_ONLY')) {
          blockerEntered()
          await blockerGate
          return ai.fauxAssistantMessage('Released the synthetic native queue slot.')
        }
        const child = JSON.stringify(system).includes('You maintain the primary companion')
        const results = context.messages.filter((message) => message.role === 'toolResult')
        if (!child) {
          parentPrompts.push(JSON.stringify(system))
          return ai.fauxAssistantMessage('Verified the synthetic bounded coding method.')
        }
        assert.equal(model.provider, 'ordinary-faux')
        assert.equal(model.id, 'writer-v1', 'actual native writer transport is exact, never parent/similar')
        assert.ok(!JSON.stringify(system).includes('PROJECT_OVERRIDE_BODY_MUST_NOT_REACH_MODEL'))
        childPrompts.push(JSON.stringify(system))
        if (!results.length) {
          children++
          return ai.fauxAssistantMessage([ai.fauxToolCall('agent_memory_read', { path: 'Core.md' })], {
            stopReason: 'toolUse',
          })
        }
        if (results.length === 1)
          return ai.fauxAssistantMessage(
            [
              ai.fauxToolCall('agent_memory_edit', {
                path: 'global/ordinary-method.md',
                expectedHash: null,
                text: '# Method\nUse the synthetic verified method.\n',
                sources: [],
              }),
            ],
            { stopReason: 'toolUse' },
          )
        if (results.length === 2)
          return ai.fauxAssistantMessage(
            [
              ai.fauxToolCall('agent_memory_commit', {
                revision: JSON.parse(results[0].content[0].text).baseRevision,
              }),
            ],
            { stopReason: 'toolUse' },
          )
        assert.equal(
          results.some((result) => result.isError),
          false,
          JSON.stringify(results),
        )
        return ai.fauxAssistantMessage('Synthetic draft marked ready; only the parent can publish.')
      }),
    )
    let ctx
    const create = async (expectedABI = 2) => {
      const settingsManager = sdk.SettingsManager.create(cwd, profile)
      const loader = new sdk.DefaultResourceLoader({
        cwd,
        agentDir: profile,
        settingsManager,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        noContextFiles: true,
        disabledBuiltinExtensions: ['mcp'],
        systemPromptOverride: () => 'ORDINARY_PARENT_ONLY',
      })
      await loader.reload()
      assert.deepEqual(loader.getExtensions().errors, [])
      session = (
        await sdk.createAgentSession({
          cwd,
          agentDir: profile,
          modelRuntime: runtime,
          model: faux.getModel('parent-similar'),
          settingsManager,
          resourceLoader: loader,
          sessionManager: sdk.SessionManager.create(cwd, path.join(directory, 'sessions')),
        })
      ).session
      await session.bindExtensions({})
      ctx = globalThis[observation].findLast(
        (entry) => entry.ctx.sessionManager === session.sessionManager,
      )?.ctx
      assert.ok(ctx)
      const node = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].get(session.sessionId)
      assert.equal(node.healthy(), true)
      assert.equal(node.managedMemory.version, expectedABI)
      if (expectedABI === 2) assert.equal(node.managedMemory.root, root)
      service = node.managedMemory.parentService()
      assert.ok(service)
      return node
    }
    const invokeMemoryContext = async (subcommand = 'context') => {
      const notifications = []
      const ui = new Proxy(
        {
          notify(message, type) {
            notifications.push({ message, type })
          },
        },
        {
          get(target, key) {
            if (key in target) return target[key]
            if (key === 'confirm') return async () => false
            if (['select', 'input', 'editor', 'custom'].includes(key)) return async () => undefined
            if (key === 'onTerminalInput') return () => () => {}
            if (key === 'getEditorText') return () => ''
            return () => undefined
          },
        },
      )
      session.extensionRunner.setUIContext(ui, 'print')
      try {
        const command = session.extensionRunner.getCommand('mh-memory')
        assert.ok(command)
        await command.handler(subcommand, session.extensionRunner.createCommandContext())
      } finally {
        session.extensionRunner.setUIContext(undefined, 'print')
      }
      assert.equal(notifications.length, 1)
      assert.equal(notifications[0].type, 'info')
      return JSON.parse(notifications[0].message)
    }
    const containsText = (value, text) => {
      if (typeof value === 'string') return value.includes(text)
      if (Array.isArray(value)) return value.some((item) => containsText(item, text))
      if (!value || typeof value !== 'object') return false
      return Object.entries(value).some(([key, item]) => key.includes(text) || containsText(item, text))
    }
    const node = await create()
    console.log('ordinary-sdk:bound', JSON.stringify({ pid: process.pid, session: session.sessionId, root }))
    const execute = async (name, args) =>
      (await session.getToolDefinition(name).execute(`ordinary-${name}`, args, undefined, undefined, ctx))
        .details
    const status = () => execute('agent_memory_manage', { action: 'status' })
    preflightWriterRoute(ctx, installedWriter(profile, service.getAgentType('managed-memory-writer')))
    const initialStatus = await status()
    assert.equal(
      initialStatus.readiness,
      'Ready',
      JSON.stringify({
        status: initialStatus,
        physical: ctx.modelRegistry.getAll().filter((model) => model.provider === 'ordinary-faux'),
        available: ctx.modelRegistry.getAvailable().filter((model) => model.provider === 'ordinary-faux'),
        role: service.getAgentType('managed-memory-writer'),
      }),
    )
    assert.equal((await status()).automatic, true)
    assert.equal((await status()).route.model, 'ordinary-faux/writer-v1')
    const invokePalaceContext = async () => {
      const diagnostic = await invokeMemoryContext('palace-context')
      assert.equal(diagnostic.kind, 'abi2-palace-context-diagnostic')
      assert.equal(diagnostic.consistency.atomic, false)
      assert.equal(diagnostic.structure.revision, diagnostic.context.binding.revision)
      assert.ok(Buffer.byteLength(JSON.stringify(diagnostic)) <= 32768)
      for (const sentinel of [root, installedStarter, 'ORDINARY_PARENT_ONLY', 'Name: Ada'])
        assert.equal(containsText(diagnostic, sentinel), false)
      return diagnostic
    }
    assert.equal((await invokePalaceContext()).context.memoryProjection, null)
    const beforeProjectionContext = await invokeMemoryContext()
    assert.equal(beforeProjectionContext.kind, 'abi2-invocation-context')
    assert.equal(beforeProjectionContext.binding.primary, true)
    assert.equal(beforeProjectionContext.binding.authority, 'abi2')
    assert.equal(beforeProjectionContext.binding.revision, initialStatus.revision)
    assert.equal(beforeProjectionContext.binding.configHash, initialStatus.configHash)
    assert.equal(beforeProjectionContext.memoryProjection, null)
    assert.equal(beforeProjectionContext.providerPrompt, 'unavailable')
    assert.equal(beforeProjectionContext.categoryTokenAccounting, 'unavailable')
    assert.equal(containsText(beforeProjectionContext, root), false)
    assert.equal(containsText(beforeProjectionContext, installedStarter), false)
    assert.equal(containsText(beforeProjectionContext, 'ORDINARY_PARENT_ONLY'), false)
    // Actual registered runtime tool + native AbortController, not a direct
    // policy helper. This test-local scheduler calls native abort at an existing
    // signal checkpoint once the real typed owner record has been written.
    // It supplies no authority/drain verdict and adds no production hook.
    const abort = new AbortController()
    const nativeThrow = abort.signal.throwIfAborted.bind(abort.signal)
    let cancellationReached = false
    abort.signal.throwIfAborted = () => {
      const file = path.join(root, '.lock/policy.json')
      if (!cancellationReached && fs.existsSync(file)) {
        let record
        try {
          record = JSON.parse(fs.readFileSync(file, 'utf8'))
        } catch {}
        if (record?.kind === 'policy' && record?.owner?.operation === record?.identity?.operation) {
          cancellationReached = true
          abort.abort()
        }
      }
      nativeThrow()
    }
    const beforeCancel = await status()
    await assert.rejects(
      session.getToolDefinition('agent_memory_manage').execute(
        'ordinary-policy-cancel',
        {
          action: 'policy',
          revision: beforeCancel.revision,
          configHash: beforeCancel.configHash,
          automatic: false,
        },
        abort.signal,
        undefined,
        ctx,
      ),
      /Managed memory unavailable/,
    )
    assert.equal(cancellationReached, true, 'real runtime signal checkpoint reached after actual acquisition')
    assert.equal(abort.signal.aborted, true)
    const retained = await status()
    assert.equal(retained.automatic, true)
    assert.equal(retained.policyOperation.state, 'retained+recoverable')
    assert.equal(retained.policyOperation.automatic, true)
    assert.equal(retained.policyOperation.outcome, 'original')
    const cancelledConfigBytes = fs.readFileSync(path.join(root, 'config.json'))
    const reconciled = await execute('agent_memory_manage', {
      action: 'policy-reconcile',
      target: retained.policyOperation.target,
      revision: retained.policyOperation.digest,
    })
    assert.equal(reconciled.configChanged, false)
    assert.deepEqual(fs.readFileSync(path.join(root, 'config.json')), cancelledConfigBytes)
    assert.equal((await status()).policyOperation.state, 'idle')
    console.log(
      'ordinary-sdk:policy-cancel-reconciled',
      JSON.stringify({
        target: retained.policyOperation.target,
        digest: retained.policyOperation.digest,
        automatic: retained.automatic,
      }),
    )
    const initial = await execute('agent_memory_read', { path: 'Core.md' })
    assert.equal(initial.text, installedStarter)
    // Genuine first request projects the installed starter before customization.
    await execute('agent_memory_manage', {
      action: 'policy',
      revision: initial.baseRevision,
      configHash: (await status()).configHash,
      automatic: false,
    })
    await session.prompt('Check the installed editable starter without automatic learning.')
    assert.ok(parentPrompts[0].includes('Language') || parentPrompts[0].includes('language'))
    const projectedStatus = await status()
    const projectedContext = await invokeMemoryContext()
    assert.equal((await invokePalaceContext()).context.memoryProjection?.revision, projectedStatus.revision)
    assert.equal(projectedContext.binding.revision, projectedStatus.revision)
    assert.equal(projectedContext.binding.configHash, projectedStatus.configHash)
    assert.equal(projectedContext.memoryProjection?.revision, projectedStatus.revision)
    assert.equal(projectedContext.memoryProjection?.configHash, projectedStatus.configHash)
    assert.ok(projectedContext.memoryProjection?.emittedBlockUtf8Bytes > 0)
    assert.equal(containsText(projectedContext, installedStarter), false)
    assert.equal(containsText(projectedContext, 'ORDINARY_PARENT_ONLY'), false)
    assert.equal(containsText(projectedContext, root), false)
    const customCore =
      '# Core\nName: Ada\nLanguage: Spanish\nTone: concise\nPreserved synthetic user persona.\n'
    await execute('agent_memory_edit', {
      path: 'Core.md',
      expectedHash: initial.hash,
      text: customCore,
      sources: [],
    })
    assert.equal((await status()).publication, 'private-draft-not-published')
    await assert.rejects(
      execute('agent_memory_commit', { revision: initial.baseRevision }),
      /Managed memory unavailable/,
      'whole-Core replacement requires explicit lossless-retention override',
    )
    assert.equal((await status()).publication, 'private-draft-not-published')
    const retainedDraft = await execute('agent_memory_read', { path: 'Core.md' })
    assert.equal(retainedDraft.text, customCore)
    await execute('agent_memory_edit', {
      path: 'Core.md',
      expectedHash: retainedDraft.hash,
      text: customCore,
      sources: [],
    })
    await execute('agent_memory_commit', { revision: initial.baseRevision, allowShrink: true })
    const changedDiagnostic = await invokePalaceContext()
    assert.notEqual(changedDiagnostic.context.binding.revision, projectedStatus.revision)
    assert.equal(changedDiagnostic.context.memoryProjection?.revision, projectedStatus.revision)
    const reenable = await status()
    await execute('agent_memory_manage', {
      action: 'policy',
      revision: reenable.revision,
      configHash: reenable.configHash,
      automatic: true,
    })
    await session.prompt('Remember this synthetic verified coding method as reusable knowledge.')
    await service.waitForAll()
    let settled
    for (let i = 0; i < 200; i++) {
      settled = await status()
      if (settled.worker === 'idle' && settled.latestAttempt?.outcome === 'integrated') break
      await delay(25)
    }
    assert.equal(children, 1)
    assert.equal(settled.latestAttempt?.outcome, 'integrated', JSON.stringify(settled))
    assert.equal(
      service.listAgents()[0].turnBudget.maxTurns,
      8,
      'public per-call budget defeats project max_turns:999',
    )
    assert.equal(settled.publication, 'committed-head')
    assert.equal(settled.contextActivation, 'next-primary-request')
    const store = createMemoryStore(root)
    assert.ok(store.snapshot().files['global/ordinary-method.md'])
    assert.equal(store.snapshot().files['Core.md'].text, customCore)
    assert.equal(store.pendingEpisodes(store.config().projects[0].id).length, 0)
    assert.ok(
      childPrompts.every(
        (prompt) => !prompt.includes('ORDINARY_PARENT_ONLY') && !prompt.includes('Name: Ada'),
      ),
    )
    assert.ok(parentPrompts.at(-1).includes('Name: Ada'))
    // Revision/config CAS public lifecycle control, not an installer overwrite.
    const beforeOff = await status()
    await assert.rejects(
      execute('agent_memory_manage', {
        action: 'policy',
        revision: '0'.repeat(40),
        configHash: beforeOff.configHash,
        automatic: false,
      }),
      /Managed memory unavailable/,
    )
    await execute('agent_memory_manage', {
      action: 'policy',
      revision: beforeOff.revision,
      configHash: beforeOff.configHash,
      automatic: false,
    })
    await assert.rejects(
      execute('agent_memory_manage', {
        action: 'policy',
        revision: beforeOff.revision,
        configHash: beforeOff.configHash,
        automatic: true,
      }),
      /Managed memory unavailable/,
    )
    await session.prompt('Automatic off must not observe this request; retrieve committed memory.')
    assert.equal(children, 1)
    assert.equal((await status()).automatic, false)
    await execute('agent_memory_read', { path: 'global/ordinary-method.md' })
    // GENUINE native limiter delay: blocker owns the only slot, managed writer
    // is queued with an already synchronously resolved explicit physical model.
    const blocker = service.spawn('queue-blocker', 'Hold the one native queue slot.', {
      model: 'ordinary-faux/parent-similar',
      foreground: false,
      inheritContext: false,
      claimOutcome: true,
    })
    // Functional observation deadline never kills native work. A terminal
    // blocker before readiness is a fixture failure, not an endless gate wait.
    let blockerObserved = false
    blockerReady.then(() => {
      blockerObserved = true
    })
    const blockerDeadline = performance.now() + 10000
    while (!blockerObserved) {
      const record = service.getRecord(blocker)
      if (!record || ['completed', 'error', 'aborted', 'stopped'].includes(record.status))
        throw Error(`Native blocker terminal before readiness: ${JSON.stringify(record)}`)
      if (performance.now() > blockerDeadline) throw Error('Native blocker readiness observation expired')
      await delay(10)
    }
    assert.equal(service.getRecord(blocker).status, 'running')
    console.log('ordinary-sdk:blocker-ready', JSON.stringify(service.getRecord(blocker)))
    const queued = await execute('agent_memory_reflect', { assignment: 'Queued exact-route adversary.' })
    console.log('ordinary-sdk:writer-queued', JSON.stringify(service.getRecord(queued.job)))
    assert.equal(service.getRecord(queued.job).status, 'queued')
    const beforeQueueCalls = modelCalls.length
    const pinnedPhysical = ctx.modelRegistry.find('ordinary-faux', 'writer-v1')
    const beforeQueueRevision = store.snapshot().revision
    const queuedConfigBytes = fs.readFileSync(path.join(root, 'config.json'))
    // Disposable adversary changes config while the real native job is queued;
    // this is not a supported policy API or a production write path.
    fs.writeFileSync(
      path.join(root, 'config.json'),
      JSON.stringify({
        ...JSON.parse(queuedConfigBytes),
        automatic: true,
      }),
      { mode: 0o600 },
    )
    // No fallback to available parent/similar route after exact writer disappears.
    runtime.unregisterProvider('ordinary-faux')
    const parentOnly = ai.fauxProvider({ provider: 'ordinary-faux', models: [{ id: 'parent-similar' }] })
    const replacementCalls = []
    parentOnly.setResponses([
      (context, _options, _state, model) => {
        replacementCalls.push({
          provider: model.provider,
          id: model.id,
          api: model.api,
          baseUrl: model.baseUrl,
          system: (() => {
            const message = context.messages.find((message) => message.role === 'system')
            return message?.sections?.preamble ?? message?.content ?? ''
          })(),
        })
        return ai.fauxAssistantMessage('Queued route witness only; no knowledge change or save claimed.')
      },
    ])
    runtime.registerNativeProvider(parentOnly.provider)
    await runtime.refresh({ allowNetwork: false })
    assert.equal((await status()).readiness, 'Needs setup')
    blockerRelease()
    await service.waitForAll()
    for (let i = 0; i < 200 && (await status()).worker !== 'idle'; i++) await delay(25)
    const queuedRecord = service.getRecord(queued.job)
    console.log('ordinary-sdk:queue-settled', JSON.stringify(service.listAgents()))
    assert.equal(queuedRecord.status, 'completed', JSON.stringify(queuedRecord))
    // Public child context AND actual transport model argument witness the model
    // selected after queue delay. Requested options/role/getRecord are not proof.
    const childManager = sdk.SessionManager.open(queuedRecord.outputFile)
    const childStart = globalThis[observation].beforeStarts.find(
      (entry) => entry.session === childManager.getSessionId(),
    )
    assert.deepEqual(childStart.model, {
      provider: pinnedPhysical.provider,
      id: pinnedPhysical.id,
      api: pinnedPhysical.api,
      baseUrl: pinnedPhysical.baseUrl,
    })
    assert.equal(replacementCalls.length, 1, 'replacement transport has a real deterministic response')
    const { system: queuedSystem, ...transportModel } = replacementCalls[0]
    assert.deepEqual(
      transportModel,
      childStart.model,
      'actual queued native model remains exact physical pinned route',
    )
    assert.equal(transportModel.id, 'writer-v1', 'available parent/similar was never substituted')
    assert.ok(!queuedSystem.includes('PROJECT_OVERRIDE_BODY_MUST_NOT_REACH_MODEL'))
    assert.equal(queuedRecord.turnBudget.maxTurns, 8)
    assert.equal(
      modelCalls.length,
      beforeQueueCalls,
      'new registered transport, not an exhausted old response list',
    )
    assert.equal(
      store.snapshot().revision,
      beforeQueueRevision,
      'config/catalog change never publishes old queued proposal',
    )
    fs.writeFileSync(path.join(root, 'config.json'), queuedConfigBytes, { mode: 0o600 })
    console.log(
      'ordinary-sdk:queue-route-witness',
      JSON.stringify({
        childStart,
        transportModel,
        configAndCatalogChanged: true,
        budget: queuedRecord.turnBudget,
        publicationChanged: false,
      }),
    )
    assert.equal(children, 1, 'queued writer never substituted the available parent/similar model')
    await assert.rejects(
      execute('agent_memory_reflect', { assignment: 'Must not use parent or a similar model.' }),
      /Managed memory unavailable/,
    )
    assert.equal(service.listAgents().length, 3)
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
    assert.equal(node.managedMemory.live(), false)
    session.dispose()
    session = undefined
    // Existing persona, automatic off, route, targeted denials survive standard upgrade.
    permission = JSON.parse(fs.readFileSync(permissionPath, 'utf8'))
    permission.permission.agent_memory_reflect = 'deny'
    permission.permission[`continuity_learning_${'a'.repeat(64)}`] = 'deny'
    fs.writeFileSync(permissionPath, JSON.stringify(permission), { mode: 0o600 })
    const coreBefore = fs.readFileSync(path.join(root, 'Core.md'), 'utf8')
    const upgrade = install()
    assert.equal(upgrade.status, 'completed')
    assert.equal(fs.readFileSync(path.join(root, 'Core.md'), 'utf8'), coreBefore)
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).automatic, false)
    assert.match(
      fs.readFileSync(path.join(profile, 'agents/managed-memory-writer.md'), 'utf8'),
      /model: ordinary-faux\/writer-v1/,
    )
    runtime.unregisterProvider('ordinary-faux')
    runtime.registerNativeProvider(faux.provider)
    await runtime.refresh({ allowNetwork: false })
    await create()
    assert.equal((await status()).readiness, 'Denied')
    assert.equal((await status()).automatic, false)
    assert.equal((await execute('agent_memory_read', { path: 'Core.md' })).text, customCore)
    assert.equal(JSON.parse(fs.readFileSync(permissionPath, 'utf8')).permission.agent_memory_reflect, 'deny')
    const corePath = path.join(root, 'Core.md')
    fs.writeFileSync(corePath, `${customCore}Uncommitted disposable edit.\n`, { mode: 0o600 })
    const dirtyUpgrade = spawnSync(
      process.execPath,
      [path.join(product, 'install.mjs'), '--agent-dir', profile, '--preview'],
      { cwd, env: process.env, encoding: 'utf8' },
    )
    assert.equal(dirtyUpgrade.status, 1)
    assert.match(dirtyUpgrade.stderr, /dirty|uncertain/)
    assert.match(fs.readFileSync(corePath, 'utf8'), /Uncommitted disposable edit/)
    fs.writeFileSync(corePath, customCore, { mode: 0o600 })
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
    session.dispose()
    session = undefined
    for (const mode of ['off', 'legacy']) {
      const selected = JSON.stringify({ version: 2, root, mode })
      fs.writeFileSync(path.join(profile, '.mahiro-memory-engine.json'), selected, { mode: 0o600 })
      assert.equal(install().status, 'completed')
      assert.equal(fs.readFileSync(path.join(profile, '.mahiro-memory-engine.json'), 'utf8'), selected)
      assert.equal(fs.readFileSync(corePath, 'utf8'), customCore)
      await create(1)
      assert.equal((await status()).engine.mode, mode)
      if (mode === 'off') {
        assert.equal(
          (await status()).automatic,
          'unknown',
          'off never reads private policy to decorate status',
        )
        await assert.rejects(execute('agent_memory_read', { path: 'Core.md' }), /Managed memory unavailable/)
      } else {
        assert.equal((await execute('agent_memory_read', { path: 'Core.md' })).text, customCore)
        assert.equal((await status()).automatic, false)
      }
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
      session.dispose()
      session = undefined
    }
    fs.writeFileSync(
      path.join(profile, '.mahiro-memory-engine.json'),
      JSON.stringify({ version: 2, root, mode: 'engine' }),
      { mode: 0o600 },
    )
    await create()
    // Genuine registered SDK publication/reconciliation flow. This does not locate
    // the controller in Root versus Feature or compare against the old TS-map baseline.
    // Abort after actual private staging exists, then reconcile with fresh authority.
    const publicationAbort = new AbortController()
    const publicationThrow = publicationAbort.signal.throwIfAborted.bind(publicationAbort.signal)
    let publicationOwner
    let publicationCheckpoint = false
    publicationAbort.signal.throwIfAborted = () => {
      const ownerFile = path.join(root, '.lock/owner.json')
      if (!publicationCheckpoint && fs.existsSync(ownerFile)) {
        let owner
        try {
          owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'))
        } catch {}
        const staging = owner && path.join(root, '.views/.engine-v2/staging', owner.operation)
        if (
          staging &&
          fs.existsSync(staging) &&
          fs.readdirSync(staging).some((name) => name.endsWith('.tmp'))
        ) {
          publicationOwner = owner
          publicationCheckpoint = true
          publicationAbort.abort()
        }
      }
      publicationThrow()
    }
    const cancelBase = await execute('agent_memory_read', { path: 'Core.md' })
    await execute('agent_memory_edit', {
      path: 'Core.md',
      expectedHash: cancelBase.hash,
      text: '# Aborted proposal\n',
      sources: [],
    })
    await assert.rejects(
      session
        .getToolDefinition('agent_memory_commit')
        .execute(
          'ordinary-publication-cancel',
          { revision: cancelBase.baseRevision },
          publicationAbort.signal,
          undefined,
          ctx,
        ),
      /Managed memory unavailable/,
    )
    assert.equal(publicationCheckpoint, true, 'registered publication reached real staging checkpoint')
    assert.equal(publicationAbort.signal.aborted, true)
    assert.ok(fs.existsSync(path.join(root, '.lock/owner.json')))
    const recoveredPublication = await execute('agent_memory_manage', {
      action: 'reconcile',
      target: publicationOwner.operation,
      revision: publicationOwner.digest,
    })
    assert.equal(recoveredPublication.stage, 'not_committed_dirty', JSON.stringify(recoveredPublication))
    assert.equal(recoveredPublication.indexDirty, false)
    assert.equal(recoveredPublication.worktreeDirty, false)
    assert.equal(
      recoveredPublication.lockRetained,
      false,
      'registered SDK recovery uses an actual sealed executor reference',
    )
    assert.equal(fs.existsSync(path.join(root, '.lock')), false)
    assert.equal(fs.readFileSync(path.join(root, 'Core.md'), 'utf8'), customCore)
    assert.equal(
      fs.readdirSync(root).some((name) => name.startsWith('.memory-engine-')),
      false,
    )
    assert.equal(
      fs.readdirSync(path.join(root, '.views/.engine-v2/staging', publicationOwner.operation)).length,
      1,
    )
    await execute('agent_memory_manage', { action: 'cancel' })
    console.log('ordinary-sdk:publication-cancel-reconciled', JSON.stringify(recoveredPublication))
    // End placement must not hide a stale in-memory publication barrier. Use a
    // fresh registered draft and commit, not a replay of the cancelled plan.
    const freshBase = await execute('agent_memory_read', { path: 'Core.md' })
    const freshCore = `${customCore}Fresh publication after quiescent recovery.\n`
    await execute('agent_memory_edit', {
      path: 'Core.md',
      expectedHash: freshBase.hash,
      text: freshCore,
      sources: [],
    })
    await execute('agent_memory_commit', { revision: freshBase.baseRevision })
    assert.equal(fs.readFileSync(path.join(root, 'Core.md'), 'utf8'), freshCore)
    assert.notEqual(store.snapshot().revision, freshBase.baseRevision)
    assert.equal(fs.existsSync(path.join(root, '.lock')), false)
    console.log('ordinary-sdk:fresh-publication-after-recovery', store.snapshot().revision)
    assert.equal(external, 0)
    console.log(
      'ordinary-sdk:journey-complete',
      JSON.stringify({
        external,
        children,
        modelCalls: modelCalls.map(({ provider, id }) => ({ provider, id })),
      }),
    )
  } finally {
    // Always open ALL fixture gates before aborting/joining. Aborts stop native
    // model work; Root/runtime shutdown still joins started FS/Git/handle closes.
    releaseBlocker()
    if (service) {
      for (const record of service.listAgents())
        if (['queued', 'running'].includes(record.status)) service.abort(record.id)
      await service.waitForAll()
    }
    if (session) {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
      session.dispose()
    }
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
    fs.rmSync(directory, { recursive: true, force: true })
    if (relocated) {
      fs.renameSync(modules, guardModules)
      fs.symlinkSync(guardModules, modules, 'dir')
    }
  }
})
