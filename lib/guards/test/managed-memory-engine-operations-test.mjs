import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { createDisposableMemoryFixture, selectManagedMemoryFixture } from '../memory-fixture.mjs'
import { createMemoryStore } from '../../agent-memory/store.ts'
import { parseConfig } from '../../agent-memory/engine/schema.ts'

const primary = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const adapter = path.join(primary, 'lib/guards')

async function canonicalOperations(coldOnly = false) {
  const fixture = await createDisposableMemoryFixture()
  const previous = { ...process.env }
  for (const key of Object.keys(process.env))
    if (
      key.startsWith('GIT_') ||
      key.startsWith('PI_') ||
      key.includes('API_KEY') ||
      key.startsWith('MAHIRO_')
    )
      delete process.env[key]
  Object.assign(process.env, {
    HOME: fixture.home,
    PI_CODING_AGENT_DIR: fixture.agentDir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(fixture.home, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: fixture.directory,
  })
  fs.writeFileSync(
    path.join(fixture.home, '.gitconfig'),
    '[user]\n name = Synthetic ABI2\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
    { mode: 0o600 },
  )
  const savedFetch = globalThis.fetch
  let external = 0
  globalThis.fetch = () => {
    external++
    throw Error('External transport forbidden')
  }
  let session
  let engine
  const observations = []
  const observationKey = Symbol.for('@mahirocoko/t246:fixture-context-observations')
  globalThis[observationKey] = observations
  const results = []
  const childRequests = []
  const extraSessions = []
  try {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const ai = await import('@earendil-works/pi-ai')
    const store = createMemoryStore(fixture.root)
    assert.equal(fs.existsSync(fixture.root), false, 'canonical initializer starts with absent fixture root')
    const permissions = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-permission-system'))
    const subagents = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-subagents'))
    const configPath = path.join(fixture.agentDir, 'extensions/pi-permission-system/config.json')
    const capability = `managed_memory_${createHash('sha256').update(fixture.root).digest('hex')}`
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const grant = (overrides = {}) =>
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
            [capability]: 'allow',
            ...overrides,
          },
        }),
      )
    grant()
    fs.mkdirSync(path.join(fixture.agentDir, 'extensions/pi-subagents'), { recursive: true })
    fs.writeFileSync(
      path.join(fixture.agentDir, 'extensions/pi-subagents/config.json'),
      JSON.stringify({ excludedExtensionPackages: [subagents] }),
    )
    fs.writeFileSync(
      path.join(fixture.agentDir, 'extensions/t246-observer.ts'),
      `export default function(pi) { pi.on('session_start', (_,ctx) => { globalThis[Symbol.for('@mahirocoko/t246:fixture-context-observations')].push({ctx, tools:pi.getAllTools(), source:import.meta.url}) }) }\n`,
    )
    fs.mkdirSync(path.join(fixture.agentDir, 'agents'))
    fs.copyFileSync(
      path.join(primary, 'agents/managed-memory-writer.md'),
      path.join(fixture.agentDir, 'agents/managed-memory-writer.md'),
    )
    fs.writeFileSync(
      path.join(fixture.agentDir, 'settings.json'),
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
    const runtime = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const faux = ai.fauxProvider({ provider: 'openai', models: [{ id: 'gpt-6.1-sol', reasoning: true }] })
    runtime.registerNativeProvider(faux.provider)
    let parentStage = 0
    let negative = false
    let automaticCase = false
    let readyAutomatic = false
    let childSeen = 0
    let parentContext
    const childValues = []
    const respond = (context) => {
      const child = JSON.stringify(context.messages).includes('You maintain the primary companion')
      const toolResults = context.messages.filter((message) => message.role === 'toolResult')
      results.push(...toolResults.filter((message) => !results.includes(message)))
      if (child) {
        childRequests.push(context.messages)
        const nodeMap = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')]
        const observed = observations.findLast((entry) => entry.ctx.sessionManager !== session.sessionManager)
        assert.ok(observed, 'actual independent child loader observation')
        assert.equal(
          fileURLToPath(observed.source),
          path.join(fixture.agentDir, 'extensions/t246-observer.ts'),
          'actual child callback originates in the supported discovered entry',
        )
        assert.notEqual(observed.ctx.sessionManager, session.sessionManager)
        const childNode = nodeMap.get(observed.ctx.sessionManager.getSessionId())
        assert.equal(childNode?.healthy(), true)
        assert.equal(childNode.managedMemory.version, 2, 'child selection derives from real recorded parent')
        const tool = observed.tools.find((entry) => entry.name === 'agent_memory_read')
        if (!toolResults.length) {
          const access = childNode.managedMemory.assertAccess(tool, observed.ctx, fixture.root, 'read')
          assert.equal(access.kind, 'worker')
          childValues.push(access.value)
          if (engine)
            assert.equal(
              access.value.engine,
              engine,
              'exact parent controller reused by subsequent genuine child',
            )
          engine = access.value.engine
          assert.ok(engine.pid)
          childSeen++
          if (!negative) {
            // Separate intended real-context authority adversaries before the positive call.
            grant({ path_read: { [path.join(fixture.root, 'Core.md')]: 'deny' } })
            assert.throws(
              () =>
                childNode.managedMemory.assertTargets(tool, observed.ctx, fixture.root, 'read', [
                  fixture.root,
                  path.join(fixture.root, 'Core.md'),
                ]),
              /permission|authority/,
            )
            assert.throws(
              () =>
                childNode.managedMemory.assertAccess(
                  tool,
                  observed.ctx,
                  fixture.root,
                  'read',
                  path.join(fixture.root, 'Core.md'),
                ),
              /permission|authority/,
            )
            grant({ agent_memory_read: 'deny' })
            assert.throws(
              () => childNode.managedMemory.assertAccess(tool, observed.ctx, fixture.root, 'read'),
              /permission/,
            )
            grant({ [capability]: 'deny' })
            assert.throws(
              () => childNode.managedMemory.assertAccess(tool, observed.ctx, fixture.root, 'read'),
              /permission|authority/,
            )
            grant()
            const reflectionTool = session
              .getAllTools()
              .find((entry) => entry.name === 'agent_memory_reflect')
            const parentNode = nodeMap.get(session.sessionId)
            const running = parentNode.managedMemory
              .parentService()
              .listAgents()
              .find((entry) => entry.status === 'running')
            let identityCalls = 0
            assert.throws(
              () =>
                parentNode.managedMemory.bindWorker(
                  reflectionTool,
                  parentContext,
                  fixture.root,
                  running.id,
                  access.value,
                  () => {
                    identityCalls++
                    return Promise.resolve(true)
                  },
                ),
              /binding/,
            )
            assert.equal(
              identityCalls,
              1,
              'Root actually evaluates and rejects a Promise liveness result before binding',
            )
            assert.equal(
              childNode.managedMemory.assertAccess(tool, observed.ctx, fixture.root, 'read').value,
              access.value,
              'negative attempts never replace the real opaque lease',
            )
          }
          if (negative) {
            // INTENDED NEGATIVE: revoke parent named launch tool while child named/root grants remain.
            grant({ agent_memory_reflect: 'deny' })
            assert.throws(
              () =>
                childNode.managedMemory.assertTargets(tool, observed.ctx, fixture.root, 'read', [
                  path.join(fixture.root, 'Core.md'),
                ]),
              /permission|authority/,
            )
            assert.throws(
              () => childNode.managedMemory.assertAccess(tool, observed.ctx, fixture.root, 'read'),
              /permission/,
            )
          }
          return ai.fauxAssistantMessage([ai.fauxToolCall('agent_memory_read', { path: 'Core.md' })], {
            stopReason: 'toolUse',
          })
        }
        if (negative) return ai.fauxAssistantMessage('Expected denial; no ready proposal.')
        if (automaticCase) {
          if (!readyAutomatic)
            return ai.fauxAssistantMessage('Observed native completion without ready; do not adopt.')
          if (toolResults.length === 1)
            return ai.fauxAssistantMessage(
              [
                ai.fauxToolCall('agent_memory_commit', {
                  revision: JSON.parse(toolResults[0].content[0].text).baseRevision,
                }),
              ],
              { stopReason: 'toolUse' },
            )
          return ai.fauxAssistantMessage('Metadata-only episode review completed.')
        }
        if (toolResults.length === 1)
          return ai.fauxAssistantMessage(
            [
              ai.fauxToolCall('agent_memory_edit', {
                path: 'procedures/native-verification.md',
                expectedHash: null,
                text: '# Native verification\nUse actual synthetic evidence before claiming success.\n',
                sources: [],
              }),
            ],
            { stopReason: 'toolUse' },
          )
        if (toolResults.length === 2)
          return ai.fauxAssistantMessage(
            [
              ai.fauxToolCall('agent_memory_commit', {
                revision: JSON.parse(toolResults[0].content[0].text).baseRevision,
              }),
            ],
            { stopReason: 'toolUse' },
          )
        return ai.fauxAssistantMessage('Synthetic writer completed.')
      }
      if (automaticCase)
        return ai.fauxAssistantMessage(
          'Synthetic bounded observed outcome; no tool arguments or transcript export.',
        )
      const stage = parentStage++
      if (negative) {
        if (stage === 0) {
          const system = JSON.stringify(context.messages.filter((message) => message.role === 'system'))
          assert.ok(system.includes(revision), 'next primary request projects the newly committed HEAD')
          assert.match(system, /Parent verified canonical tools/)
          assert.ok(
            system.includes('procedures'),
            'topic discovery includes newly committed procedure namespace',
          )
          assert.doesNotMatch(
            system,
            /native-verification\.md/,
            'projection is discovery metadata, not deferred body/leaf hydration',
          )
          return ai.fauxAssistantMessage(
            [
              ai.fauxToolCall('agent_memory_reflect', {
                assignment: 'Intended parent named grant revocation fixture; must not publish.',
              }),
            ],
            { stopReason: 'toolUse' },
          )
        }
        return ai.fauxAssistantMessage('Negative fixture primary complete.')
      }
      if (stage === 0) {
        const system = JSON.stringify(context.messages.filter((message) => message.role === 'system'))
        assert.match(system, /Primary delegation guidance:/)
        assert.match(system, /New revision replaces older managed-memory context/)
        assert.match(system, /Archives and observed episodes are fallible provenance/)
        return ai.fauxAssistantMessage([ai.fauxToolCall('agent_memory_read', { path: 'Core.md' })], {
          stopReason: 'toolUse',
        })
      }
      if (stage === 1)
        return ai.fauxAssistantMessage(
          [
            ai.fauxToolCall('agent_memory_edit', {
              path: 'Core.md',
              expectedHash: JSON.parse(toolResults.at(-1).content[0].text).hash,
              text: '# Core\nSynthetic established identity. Parent verified canonical tools.\n',
              sources: [],
            }),
          ],
          { stopReason: 'toolUse' },
        )
      if (stage === 2)
        return ai.fauxAssistantMessage(
          [
            ai.fauxToolCall('agent_memory_commit', {
              revision: JSON.parse(toolResults[0].content[0].text).baseRevision,
            }),
          ],
          { stopReason: 'toolUse' },
        )
      if (stage === 3)
        return ai.fauxAssistantMessage(
          [
            ai.fauxToolCall('agent_memory_reflect', {
              assignment: 'Maintain a synthetic native verification procedure.',
            }),
          ],
          { stopReason: 'toolUse' },
        )
      return ai.fauxAssistantMessage('Synthetic primary complete.')
    }
    faux.setResponses(Array.from({ length: 32 }, () => respond))
    const settingsManager = sdk.SettingsManager.create(fixture.cwd, fixture.agentDir)
    const makeLoader = () =>
      new sdk.DefaultResourceLoader({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        settingsManager,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        noContextFiles: true,
        systemPromptOverride: () => 'UNRELATED_SYNTHETIC_PARENT_PREAMBLE',
        disabledBuiltinExtensions: ['mcp'],
        extensionFactories: [
          (pi) => {
            pi.events.on('t246:context', (event) => {
              observations.push(event)
              if (event.ctx.sessionManager === session?.sessionManager) parentContext = event.ctx
            })
            pi.on('session_start', (_, ctx) => {
              parentContext = ctx
            })
          },
        ],
      })
    const loader = makeLoader()
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    assert.ok(
      loader
        .getExtensions()
        .extensions.some(
          (entry) => path.resolve(entry.path) === path.join(fixture.agentDir, 'extensions/t246-observer.ts'),
        ),
      'public loader actually discovers the observer source',
    )
    const created = await sdk.createAgentSession({
      cwd: fixture.cwd,
      agentDir: fixture.agentDir,
      modelRuntime: runtime,
      model: faux.getModel(),
      resourceLoader: loader,
      settingsManager,
      sessionManager: sdk.SessionManager.create(fixture.cwd, path.join(fixture.directory, 'sessions')),
    })
    session = created.session
    selectManagedMemoryFixture(session.sessionManager, fixture.capability)
    await session.bindExtensions({})
    const node = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].get(session.sessionId)
    assert.equal(node.healthy(), true)
    assert.equal(node.managedMemory.version, 2)
    const initialized = (
      await session
        .getToolDefinition('agent_memory_manage')
        .execute(
          'native-parent-initialize',
          { action: 'initialize', core: '# Core\nSynthetic established identity.\n', projectId: 'project' },
          undefined,
          undefined,
          parentContext,
        )
    ).details
    assert.equal(initialized.initialized, true)
    assert.equal(initialized.nativeBootstrapChanged, false)
    assert.equal(fs.existsSync(path.join(fixture.root, '.bootstrap-v2.json')), false)
    await assert.rejects(
      session
        .getToolDefinition('agent_memory_manage')
        .execute(
          'refuse-reseed',
          { action: 'initialize', core: '# Replacement\n', projectId: 'project' },
          undefined,
          undefined,
          parentContext,
        ),
      /Managed memory unavailable/,
    )
    if (coldOnly) {
      // Genuine cold 286-file FIRST registered read, through the unchanged canonical Root/PSS
      // and ABI2 runtime. Initialization does not certify bodies; no controller proxy/alias.
      // Keep the initializer's actual 64 KiB total budget unchanged; this is a metadata/cold-read
      // regression, not a reproduction of the larger diagnostic dataset or a latency benchmark.
      const seeder = createMemoryStore(fixture.root, () => {}, 'primary')
      const seeded = seeder.createView('project', 120000, true)
      for (let i = 0; i < 284; i++) {
        const header = `# Synthetic cold topic ${i}\n`
        seeder.edit(
          seeded,
          `global/cold-${i}.md`,
          null,
          `${header}${'x'.repeat(127 - Buffer.byteLength(header))}\n`,
          [],
        )
      }
      seeder.integrate(seeded)
      assert.equal(Object.keys(store.snapshot().files).length, 286)
      const coldDiagnostic = fixture.startDiagnostics()
      const coldStart = performance.now()
      let coldRead
      try {
        coldRead = await session
          .getToolDefinition('agent_memory_read')
          .execute('cold-286-first-registered-read', { path: 'Core.md' }, undefined, undefined, parentContext)
      } finally {
        console.log(
          JSON.stringify({
            diagnostic: 'cold-286-first-registered-read',
            ms: performance.now() - coldStart,
            evidence: coldDiagnostic(),
          }),
        )
      }
      assert.equal(coldRead.details.text, '# Core\nSynthetic established identity.\n')
      assert.equal(
        coldDiagnostic().firstError,
        undefined,
        'unexpected canonical denial/deadline stops this causal attempt',
      )
      assert.ok(performance.now() - coldStart < 30000, 'original 30-second request deadline, never extended')
      return // finally joins the canonical runtime/Root drain and disposes only this owned fixture.
    }
    await session.prompt('Run the approved synthetic canonical tool and native writer fixture.')
    const service = node.managedMemory.parentService()
    await service.waitForAll()
    const status = async () =>
      (
        await session
          .getToolDefinition('agent_memory_manage')
          .execute('status', { action: 'status' }, undefined, undefined, parentContext)
      ).details
    for (let attempt = 0; attempt < 100 && (await status()).worker !== 'idle'; attempt++) await delay(50)
    assert.equal(
      (await status()).lastError,
      undefined,
      JSON.stringify(service.listAgents().map(({ status, error }) => ({ status, error }))),
    )
    const attempt = (await status()).latestAttempt
    assert.equal(attempt.outcome, 'integrated')
    assert.equal(attempt.nativeStatus, 'completed')
    assert.equal(attempt.selectedEpisodeCount, 0)
    assert.equal(attempt.latestToolEnd, null, 'unobserved tool ends are not fabricated')
    assert.equal(typeof attempt.progress.toolUses, 'number')
    assert.equal(childSeen, 1)
    assert.equal(service.listAgents()[0].status, 'completed')
    assert.equal(childValues[0].ready, true)
    assert.match(store.snapshot().files['Core.md'].text, /Parent verified canonical tools/)
    assert.ok(store.snapshot().files['procedures/native-verification.md'])
    assert.equal(
      results.some((message) => message.isError),
      false,
      JSON.stringify(results),
    )
    const primaryTool = session.getAllTools().find((entry) => entry.name === 'agent_memory_read')
    const statistics = await engine.request(
      'stats',
      {},
      {
        current: (targets) => {
          for (const target of [
            fixture.root,
            ...targets.physical,
            ...targets.logical.map((p) => path.join(fixture.root, p)),
          ])
            node.managedMemory.assertAccess(primaryTool, parentContext, fixture.root, 'read', target)
          return true
        },
      },
    )
    assert.equal(
      statistics.overlayWrites['Core.md'],
      1,
      'native leased controller contains earlier primary edit instrumentation',
    )
    assert.equal(statistics.overlayWrites['procedures/native-verification.md'], 1)
    assert.ok(childRequests.length >= 4)
    for (const messages of childRequests)
      assert.doesNotMatch(
        JSON.stringify(messages.filter((message) => message.role === 'system')),
        /UNRELATED_SYNTHETIC_PARENT_PREAMBLE/,
        'actual worker prompt replacement excludes primary preamble',
      )
    // Separate intended negative writer attempt; not a retry of any unexpected denial.
    const revision = store.snapshot().revision
    negative = true
    parentStage = 0
    await session.prompt('Run separately labeled parent named-grant revocation negative fixture.')
    await service.waitForAll()
    for (let attempt = 0; attempt < 100 && (await status()).worker !== 'idle'; attempt++) await delay(50)
    assert.equal(childSeen, 2)
    assert.equal(
      store.snapshot().revision,
      revision,
      'revoked parent never adopts failed/not-ready native work',
    )
    assert.ok(results.some((message) => message.toolName === 'agent_memory_read' && message.isError))
    // Fixture-only explicit policy cases. No actual private automatic value is inspected.
    negative = false
    automaticCase = true
    grant()
    const memoryConfig = JSON.parse(fs.readFileSync(path.join(fixture.root, 'config.json'), 'utf8'))
    const automaticPolicy = (enabled) =>
      fs.writeFileSync(
        path.join(fixture.root, 'config.json'),
        `${JSON.stringify({ ...memoryConfig, automatic: enabled })}\n`,
        { mode: 0o600 },
      )
    automaticPolicy(true)
    const waitAutomatic = async (expectedChildren) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (childSeen >= expectedChildren && (await status()).worker === 'idle') return
        await delay(25)
      }
      assert.fail(`automatic writer did not settle: children=${childSeen}, expected=${expectedChildren}`)
    }
    const beforeReview = store.snapshot()
    await session.prompt('Synthetic observed episode with completed but not-ready writer.')
    await waitAutomatic(3)
    assert.equal(
      store.snapshot().revision,
      beforeReview.revision,
      'completed without ready never advances HEAD/cursor',
    )
    const retained = store.pendingEpisodes('project')
    assert.equal(retained.length, 1)
    assert.equal(retained[0].input.text, 'Synthetic observed episode with completed but not-ready writer.')
    assert.equal(retained[0].evidence, 'observed-native-unverified')
    readyAutomatic = true
    await session.prompt('Synthetic observed episode with successful metadata-only review.')
    await waitAutomatic(4)
    assert.equal(store.pendingEpisodes('project').length, 0)
    assert.equal(
      store.snapshot().reviewed.length,
      2,
      'successful ready-only adoption advances both reviewed IDs',
    )
    assert.deepEqual(
      store.snapshot().files,
      beforeReview.files,
      'metadata-only review preserves all knowledge bodies',
    )
    const episodeNames = fs.readdirSync(path.join(fixture.root, '.episodes')).sort()
    automaticPolicy(false)
    await session.prompt('Synthetic off-policy request is not admitted.')
    await delay(50)
    assert.equal(childSeen, 4)
    assert.deepEqual(fs.readdirSync(path.join(fixture.root, '.episodes')).sort(), episodeNames)
    automaticPolicy(true)
    grant({ agent_memory_reflect: 'deny' })
    await session.prompt('Synthetic denied-admission request is not captured.')
    await delay(50)
    assert.equal(childSeen, 4)
    assert.deepEqual(fs.readdirSync(path.join(fixture.root, '.episodes')).sort(), episodeNames)
    assert.equal(external, 0)

    // Fresh authorized canonical primary SAME-operation observation, not a replay capability.
    grant()
    automaticPolicy(false)
    const journalDir = path.join(fixture.root, '.views/.engine-v2/journal')
    const lastOperation = fs
      .readdirSync(journalDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(journalDir, name), 'utf8')))
      .find((record) => record.receipt.revision === store.snapshot().revision)
    assert.ok(lastOperation)
    const operationPath = path.join(journalDir, `${lastOperation.immutable.plan.id}.json`)
    const proposalPath = path.join(
      fixture.root,
      '.views/.engine-v2/drafts',
      `${lastOperation.immutable.plan.view}.json`,
    )
    const proposalEvidence = fs.readFileSync(proposalPath, 'utf8')
    const publicationBeforeReconcile = store.snapshot()
    const lockPath = path.join(fixture.root, '.lock')
    const lockBeforeReconcile = fs.existsSync(lockPath)
      ? fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')
      : null
    assert.notEqual(
      createHash('sha256')
        .update(JSON.stringify(parseConfig(fs.readFileSync(path.join(fixture.root, 'config.json'), 'utf8'))))
        .digest('hex'),
      lastOperation.immutable.plan.configHash,
      'fixture really changed the configuration bound to the operation',
    )
    const reconciliation = (
      await session.getToolDefinition('agent_memory_manage').execute(
        'same-operation',
        {
          action: 'reconcile',
          target: lastOperation.immutable.plan.id,
          revision: lastOperation.immutable.plan.digest,
        },
        undefined,
        undefined,
        parentContext,
      )
    ).details
    assert.equal(
      reconciliation.stage,
      'unknown',
      'changed automatic config cannot authenticate an old operation',
    )
    assert.equal(reconciliation.detail, 'Publication detail withheld; retain recovery evidence')
    assert.equal(reconciliation.operation, lastOperation.immutable.plan.id)
    assert.equal(reconciliation.sequence, lastOperation.sequence + 1)
    assert.equal(reconciliation.lockRetained, lockBeforeReconcile !== null)
    const retainedOperation = JSON.parse(fs.readFileSync(operationPath, 'utf8'))
    assert.equal(retainedOperation.receipt.stage, 'unknown')
    assert.equal(retainedOperation.receipt.detail, 'Configuration changed')
    assert.deepEqual(retainedOperation.immutable, lastOperation.immutable)
    assert.equal(retainedOperation.immutableHash, lastOperation.immutableHash)
    assert.deepEqual(retainedOperation.owner, lastOperation.owner)
    assert.equal(retainedOperation.sequence, lastOperation.sequence + 1)
    assert.deepEqual(store.snapshot(), publicationBeforeReconcile, 'unknown recovery never republishes')
    assert.equal(fs.readFileSync(proposalPath, 'utf8'), proposalEvidence, 'retain exact proposal evidence')
    assert.equal(
      fs.existsSync(lockPath) ? fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8') : null,
      lockBeforeReconcile,
      'unknown recovery never removes or replaces a lock',
    )
    automaticPolicy(true)
    const recertified = (
      await session.getToolDefinition('agent_memory_manage').execute(
        'same-operation-recertified',
        {
          action: 'reconcile',
          target: lastOperation.immutable.plan.id,
          revision: lastOperation.immutable.plan.digest,
        },
        undefined,
        undefined,
        parentContext,
      )
    ).details
    assert.equal(recertified.stage, 'reconciled_committed', JSON.stringify(recertified))
    assert.equal(recertified.revision, publicationBeforeReconcile.revision)
    assert.equal(recertified.observedCommit, publicationBeforeReconcile.revision)
    assert.equal(recertified.indexDirty, false)
    assert.equal(recertified.worktreeDirty, false)
    assert.equal(recertified.operation, lastOperation.immutable.plan.id)
    assert.equal(recertified.sequence, retainedOperation.sequence + 1)
    assert.equal(recertified.lockRetained, false)
    const recertifiedOperation = JSON.parse(fs.readFileSync(operationPath, 'utf8'))
    assert.deepEqual(recertifiedOperation.immutable, lastOperation.immutable)
    assert.equal(recertifiedOperation.immutableHash, lastOperation.immutableHash)
    assert.deepEqual(recertifiedOperation.owner, lastOperation.owner)
    assert.equal(recertifiedOperation.sequence, retainedOperation.sequence + 1)
    assert.equal(recertifiedOperation.receipt.stage, 'reconciled_committed')
    assert.deepEqual(store.snapshot(), publicationBeforeReconcile, 'recertification observes, never replays')
    assert.equal(fs.readFileSync(proposalPath, 'utf8'), proposalEvidence)
    assert.equal(fs.existsSync(lockPath), false)

    const originalContext = parentContext
    const activeReplacement = await verifyActiveNative()
    parentContext = originalContext

    // Lifetime falsifier: a normal blocked Git hook survives Root retirement.
    // Uses actual canonical tools/context/manager and the same opaque parent engine.
    grant()
    automaticPolicy(false)
    const execute = (name, args) =>
      session.getToolDefinition(name).execute(`lifetime-${name}`, args, undefined, undefined, parentContext)
    const core = (await execute('agent_memory_read', { path: 'Core.md' })).details
    await execute('agent_memory_edit', {
      path: 'Core.md',
      expectedHash: core.hash,
      text: '# Core\nSynthetic lifetime drain checkpoint.\n',
      sources: [],
    })
    const hookStarted = path.join(fixture.directory, 'hook-started')
    const hookRelease = path.join(fixture.directory, 'hook-release')
    const hook = path.join(fixture.root, '.git/hooks/pre-commit')
    fs.writeFileSync(
      hook,
      `#!/bin/sh\necho $$ > '${hookStarted}'\nwhile [ ! -f '${hookRelease}' ]; do sleep 0.05; done\n`,
      { mode: 0o700 },
    )
    let committing
    let shutdown
    const diagnosticSnapshot = fixture.startDiagnostics()
    let settlement = { state: 'pending' }
    const diagnosticStart = performance.now()
    try {
      const original = execute('agent_memory_commit', { revision: core.baseRevision })
      // Observe the ORIGINAL promise immediately, before normalization into the cleanup wrapper.
      committing = original.then(
        (value) => {
          settlement = { state: 'resolved', ms: performance.now() - diagnosticStart }
          return { value }
        },
        (error) => {
          settlement = { state: 'rejected', ms: performance.now() - diagnosticStart, error: error.message }
          return { error }
        },
      )
      for (let i = 0; i < 200 && !fs.existsSync(hookStarted); i++) await delay(25)
      if (!fs.existsSync(hookStarted))
        console.log(
          JSON.stringify({ diagnostic: 'before-release', settlement, evidence: diagnosticSnapshot() }),
        )
      assert.equal(fs.existsSync(hookStarted), true, 'ordinary hook really entered')
      const hookPid = Number(fs.readFileSync(hookStarted, 'utf8').trim())
      await assert.rejects(fixture.dispose(), /still held/)
      assert.equal(node.managedMemory.live(), true, 'dispose refusal keeps live authority unchanged')
      let preRemoval = false
      node.managedMemory.onRetire(async () => {
        preRemoval = true
        assert.equal(
          globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].get(session.sessionId),
          node,
        )
        assert.equal(node.managedMemory.live(), false, 'retire fences before callback awaits')
      })
      let shutdownDone = false
      shutdown = session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }).then(() => {
        shutdownDone = true
      })
      await delay(75)
      assert.equal(preRemoval, true)
      assert.equal(shutdownDone, false, 'shutdown joins already-started mutating Git')
      process.kill(hookPid, 0)
      process.kill(engine.pid, 0)
      await assert.rejects(fixture.dispose(), /still held/)
      assert.throws(() => node.managedMemory.assertAccess(primaryTool, parentContext, fixture.root, 'read'))
      fs.writeFileSync(hookRelease, '')
      const result = await committing
      assert.match(
        result.error?.message ?? '',
        /Managed memory unavailable/,
        'retired publication is unavailable, not safely absent',
      )
      await shutdown
      assert.equal(shutdownDone, true)
      assert.throws(() => process.kill(hookPid, 0), /ESRCH/)
      assert.throws(() => process.kill(engine.pid, 0), /ESRCH/)
      assert.equal(
        fs.existsSync(path.join(fixture.root, '.lock')),
        true,
        'retirement never unlinks publication lock',
      )
      // No assertion of learning/reconciliation from Git exit: Root was already retired.
      assert.equal(node.managedMemory.live(), false)
    } finally {
      fs.writeFileSync(hookRelease, '')
      const drained = await committing
      if (drained?.error && !shutdown)
        console.log(JSON.stringify({ diagnostic: 'after-drain', settlement, evidence: diagnosticSnapshot() }))
      await shutdown
    }
    const afterUnknown = (
      await activeReplacement.session
        .getToolDefinition('agent_memory_read')
        .execute('head-during-unknown', { path: 'Core.md' }, undefined, undefined, activeReplacement.context)
    ).details
    assert.equal(afterUnknown.currentRevision, store.snapshot().revision)
    assert.equal(afterUnknown.text, store.snapshot().files['Core.md'].text)
    assert.equal(fs.existsSync(path.join(fixture.root, '.lock')), true)

    async function verifyActiveNative() {
      // Finite genuine-active-native lifecycle case. No invented service/execution promise.
      const openGeneration = async () => {
        const resources = makeLoader()
        await resources.reload()
        assert.deepEqual(resources.getExtensions().errors, [])
        const { session: next } = await sdk.createAgentSession({
          cwd: fixture.cwd,
          agentDir: fixture.agentDir,
          modelRuntime: runtime,
          model: faux.getModel(),
          resourceLoader: resources,
          settingsManager,
          sessionManager: sdk.SessionManager.create(fixture.cwd, path.join(fixture.directory, 'sessions')),
        })
        extraSessions.push(next)
        selectManagedMemoryFixture(next.sessionManager, fixture.capability)
        await next.bindExtensions({})
        const actual = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].get(next.sessionId)
        assert.equal(actual.healthy(), true)
        assert.equal(actual.managedMemory.version, 2)
        return { session: next, node: actual, context: parentContext }
      }
      const generationA = await openGeneration()
      const beforeActive = store.snapshot().revision
      let paused
      let workerA
      let workerB
      let secondId
      let releaseA
      let releaseB
      let abortSeen = 0
      const providerHold = async (options, which) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            abortSeen++
          },
          { once: true },
        )
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 10000) // bounded fixture cleanup even after a failed assertion
          const release = () => {
            clearTimeout(timer)
            resolve()
          }
          if (which === 'a') releaseA = release
          else releaseB = release
        })
        return ai.fauxAssistantMessage('Owned synthetic paused response drained.')
      }
      const activeResponse = async (messages, options) => {
        const observed = observations.findLast(
          (entry) =>
            entry.ctx.sessionManager !== generationA.session.sessionManager &&
            entry.ctx.sessionManager.getSessionFile?.() ===
              generationA.node.managedMemory.parentService().getRecord(secondId)?.outputFile,
        )
        if (observed && secondId) {
          workerB = observed
          return await providerHold(options, 'b')
        }
        const actual = observations.findLast(
          (entry) =>
            entry.ctx.sessionManager !== generationA.session.sessionManager &&
            entry.ctx.sessionManager.getSessionFile?.() ===
              generationA.node.managedMemory
                .parentService()
                .listAgents()
                .find((record) => record.status === 'running' && record.id !== secondId)?.outputFile,
        )
        assert.ok(actual, 'real running native output identifies child context')
        workerA = actual
        const toolResults = messages.messages.filter((message) => message.role === 'toolResult')
        if (toolResults.length === 0)
          return ai.fauxAssistantMessage(ai.fauxToolCall('agent_memory_read', { path: 'Core.md' }), {
            stopReason: 'toolUse',
          })
        if (toolResults.length === 1)
          return ai.fauxAssistantMessage(
            ai.fauxToolCall('agent_memory_edit', {
              path: 'global/no-premature-adoption.md',
              expectedHash: null,
              text: '# Never premature\n',
              sources: [],
            }),
            { stopReason: 'toolUse' },
          )
        if (toolResults.length === 2)
          return ai.fauxAssistantMessage(
            ai.fauxToolCall('agent_memory_commit', {
              revision: JSON.parse(toolResults[0].content[0].text).baseRevision,
            }),
            { stopReason: 'toolUse' },
          )
        paused = true
        return await providerHold(options, 'a')
      }
      faux.setResponses(Array.from({ length: 12 }, () => activeResponse))
      grant()
      const dispatch = (
        await generationA.session
          .getToolDefinition('agent_memory_reflect')
          .execute(
            'active-native',
            { assignment: 'Finite active native lifecycle fixture; never adopt a running job.' },
            undefined,
            undefined,
            generationA.context,
          )
      ).details
      for (let i = 0; i < 200 && !paused; i++) await delay(25)
      assert.equal(paused, true)
      const serviceA = generationA.node.managedMemory.parentService()
      assert.equal(serviceA.getRecord(dispatch.job).status, 'running')
      const childNodeA = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].get(
        workerA.ctx.sessionManager.getSessionId(),
      )
      const childRead = workerA.tools.find((tool) => tool.name === 'agent_memory_read')
      const leased = childNodeA.managedMemory.assertAccess(childRead, workerA.ctx, fixture.root, 'read').value
      assert.equal(leased.ready, true)
      assert.equal(store.snapshot().revision, beforeActive, 'ready alone while running never adopts')
      assert.equal(fs.existsSync(path.join(fixture.root, 'global/no-premature-adoption.md')), false)
      assert.equal(serviceA.getRecord(dispatch.job).outputFile, workerA.ctx.sessionManager.getSessionFile())
      const manageA = generationA.session.getAllTools().find((tool) => tool.name === 'agent_memory_manage')
      const reflectA = generationA.session.getAllTools().find((tool) => tool.name === 'agent_memory_reflect')
      assert.throws(
        () =>
          generationA.node.managedMemory.bindWorker(
            reflectA,
            workerA.ctx,
            fixture.root,
            dispatch.job,
            leased,
            () => true,
          ),
        /unavailable|binding/,
      )
      assert.throws(
        () => childNodeA.managedMemory.assertAccess(childRead, generationA.context, fixture.root, 'read'),
        /unavailable/,
      )

      // Two actual running records with distinct real output files, but the SAME value object.
      secondId = serviceA.spawn('managed-memory-writer', 'Synthetic distinct-output binding fixture.', {
        foreground: false,
        bypassQueue: false,
        inheritContext: false,
        maxTurns: 8,
        claimOutcome: true,
      })
      const revokeSecond = generationA.node.managedMemory.bindWorker(
        manageA,
        generationA.context,
        fixture.root,
        secondId,
        leased,
        () => true,
      )
      try {
        for (let i = 0; i < 200 && !workerB; i++) await delay(25)
        assert.ok(workerB)
        assert.notEqual(serviceA.getRecord(secondId).outputFile, serviceA.getRecord(dispatch.job).outputFile)
        const childNodeB = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].get(
          workerB.ctx.sessionManager.getSessionId(),
        )
        const readB = workerB.tools.find((tool) => tool.name === 'agent_memory_read')
        grant({ agent_memory_manage: 'deny' })
        assert.equal(
          childNodeA.managedMemory.assertTargets(childRead, workerA.ctx, fixture.root, 'read', [
            path.join(fixture.root, 'Core.md'),
          ]).value,
          leased,
        )
        assert.throws(
          () =>
            childNodeB.managedMemory.assertTargets(readB, workerB.ctx, fixture.root, 'read', [
              path.join(fixture.root, 'Core.md'),
            ]),
          /permission|authority/,
        )
        grant()

        // Post-await individual physical object deny, while all logical Markdown remains allowed.
        const objectDir = fs
          .readdirSync(path.join(fixture.root, '.git/objects'))
          .find((name) => /^[a-f0-9]{2}$/.test(name))
        const physical = path.join(
          fixture.root,
          '.git/objects',
          objectDir,
          fs.readdirSync(path.join(fixture.root, '.git/objects', objectDir))[0],
        )
        let crossedAwait = false
        let deniedTarget = false
        const primaryRead = generationA.session
          .getAllTools()
          .find((tool) => tool.name === 'agent_memory_read')
        const operation = leased.engine
          .request(
            'headRead',
            { project: 'project', shared: true, selection: { path: 'Core.md' } },
            {
              current(targets) {
                generationA.node.managedMemory.assertAccess(
                  primaryRead,
                  generationA.context,
                  fixture.root,
                  'read',
                )
                const paths = [
                  ...targets.physical,
                  ...targets.logical.map((name) => path.join(fixture.root, name)),
                ]
                if (crossedAwait && paths.includes(physical)) deniedTarget = true
                for (let i = 0; i < paths.length; i += 32)
                  generationA.node.managedMemory.assertTargets(
                    primaryRead,
                    generationA.context,
                    fixture.root,
                    'read',
                    paths.slice(i, i + 32),
                  )
                return true
              },
            },
          )
          .then(
            (value) => ({ value }),
            (error) => ({ error }),
          )
        await delay(0)
        crossedAwait = true
        grant({ path_read: { [physical]: 'deny' } })
        const denied = await operation
        assert.ok(denied.error)
        assert.equal(deniedTarget, true)
        grant() // separate later lifecycle case, not a retry of the denied operation

        const workerAId = workerA.ctx.sessionManager.getSessionId()
        const workerBId = workerB.ctx.sessionManager.getSessionId()
        let retiredDone = false
        const retired = generationA.session.extensionRunner
          .emit({ type: 'session_shutdown', reason: 'exit' })
          .then(() => {
            retiredDone = true
          })
        await delay(50)
        assert.ok(abortSeen > 0)
        assert.equal(retiredDone, false, 'retirement joins genuine active native responses')
        process.kill(leased.engine.pid, 0)
        await assert.rejects(fixture.dispose(), /still held/)
        const generationB = await openGeneration()
        assert.notEqual(generationB.node.generation, generationA.node.generation)
        assert.equal(generationB.node.healthy(), true)
        serviceA.abort(secondId)
        releaseA()
        releaseB()
        await retired
        await serviceA.waitForAll()
        assert.equal(retiredDone, true)
        assert.equal(store.snapshot().revision, beforeActive)
        assert.throws(() => process.kill(leased.engine.pid, 0), /ESRCH/)
        assert.equal(globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].has(workerAId), false)
        assert.equal(globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')].has(workerBId), false)
        await generationA.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
        assert.equal(generationB.node.healthy(), true, 'old repeated cleanup cannot retire replacement')
        await assert.rejects(fixture.dispose(), /still held/)
        const stable = (
          await generationB.session
            .getToolDefinition('agent_memory_read')
            .execute('replacement-head', { path: 'Core.md' }, undefined, undefined, generationB.context)
        ).details
        assert.equal(stable.currentRevision, beforeActive)
        assert.equal(store.snapshot().revision, beforeActive)
        return generationB
      } finally {
        grant()
        serviceA.abort(dispatch.job)
        serviceA.abort(secondId)
        releaseA?.()
        releaseB?.()
        revokeSecond()
        await serviceA.waitForAll()
      }
    }
  } finally {
    for (const extra of extraSessions.reverse()) {
      await extra.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
      extra.dispose()
    }
    if (session) await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
    session?.dispose()
    delete globalThis[observationKey]
    if (engine) {
      const pid = engine.pid
      const exit = await engine.close()
      assert.equal(exit.code, 0)
      assert.equal(exit.signal, null)
      assert.throws(() => process.kill(pid, 0), /ESRCH/)
    }
    globalThis.fetch = savedFetch
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, previous)
    await fixture.dispose()
  }
}

test('canonical ABI2 tools publish and genuine native writer reuses parent engine; live parent grants stop worker', () =>
  canonicalOperations())
test('canonical cold 286 FIRST registered read completes under unchanged 30-second deadline in its own disposable Root', () =>
  canonicalOperations(true))
