import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'
import { createMemoryStore } from '../lib/agent-memory/store.ts'
import { resolveGoalBinding, readGoalState, stateTicket, transactGoal } from '../lib/goal/store.ts'
import { applyGoal } from '../lib/goal/model.ts'
import { createStore as createContinuityStore } from '../lib/continuity/store.ts'
import { installRTKHelper } from '../lib/guards/test/rtk-helper-fixture.mjs'
import { resolveEvidenceBinding, readEvidenceState } from '../lib/evidence/store.ts'
import { resolveUXBinding, readUXState } from '../lib/ux-workflow/store.ts'
import { resolveRunBinding, readRunState } from '../lib/execution-run/store.ts'

const product = path.resolve(import.meta.dirname, '..')
const evidence = path.join(
  product,
  '.agent-state/runtime/rtk-rewrite-models-retirement/no-blanket-deny-contract',
)
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

test('owned profile upgrade: aliased Root, redundant guard package/bootstrap, additive worker, native dispatch/children and idempotent preserved data', async () => {
  fs.mkdirSync(evidence, { recursive: true, mode: 0o700 })
  const dir = fs.mkdtempSync(path.join(evidence, 'one-install-'))
  const profile = path.join(dir, 'profile')
  const projectA = path.join(dir, 'project-a')
  const projectB = path.join(dir, 'project-b')
  for (const p of [profile, projectA, projectB]) {
    fs.mkdirSync(p, { mode: 0o755 })
    // This preservation fixture intentionally starts at 0755, independent of inherited umask.
    fs.chmodSync(p, 0o755)
  }
  const unrelated = path.join(dir, 'unrelated-halo')
  fs.mkdirSync(unrelated)
  fs.writeFileSync(
    path.join(unrelated, 'package.json'),
    JSON.stringify({ name: 'fixture-halo', pi: { extensions: [] } }),
  )
  const initialSettings = {
    packages: [
      path.relative(profile, product),
      path.relative(profile, unrelated),
      path.join(product, 'node_modules/@gotgenes/pi-subagents'),
      path.join(product, 'node_modules/@gotgenes/pi-permission-system'),
      path.join(product, 'lib/guards'),
    ],
    extensions: [
      path.join(product, 'lib/guards/bootstrap.mjs'),
      path.join(product, 'extensions/mahiro-worker-activity.ts'),
    ],
    defaultProvider: 'preserved-provider-canary',
    defaultModel: 'preserved-model-canary',
    device: { fixture: 'untouched' },
  }
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(initialSettings), { mode: 0o600 })
  const policyFile = path.join(profile, 'extensions/pi-permission-system/config.json')
  fs.mkdirSync(path.dirname(policyFile), { recursive: true, mode: 0o700 })
  const originalPolicy = {
    yoloMode: false,
    permission: {
      '*': 'deny',
      path: { '*.env': 'deny' },
      bash: { 'git commit *': 'deny', 'rm -rf *': 'deny' },
      unrelated_private_data: 'deny',
    },
  }
  fs.writeFileSync(policyFile, JSON.stringify(originalPolicy), { mode: 0o600 })
  const canaries = [
    ['auth.json', '{"fixture":"not-a-credential"}\n'],
    ['models.json', '{"fixture":"not-a-model"}\n'],
    ['agents/personal.md', '# Personal role fixture; preserve verbatim.\n'],
  ]
  for (const [name, text] of canaries) {
    fs.mkdirSync(path.dirname(path.join(profile, name)), { recursive: true })
    fs.writeFileSync(path.join(profile, name), text, { mode: 0o600 })
  }
  const assertCanaries = () => {
    for (const [name, text] of canaries) assert.equal(fs.readFileSync(path.join(profile, name), 'utf8'), text)
    const actual = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'))
    assert.deepEqual(actual, {
      ...initialSettings,
      packages: [
        path.relative(profile, unrelated),
        fs.realpathSync(path.join(product, 'node_modules/@gotgenes/pi-permission-system')),
        fs.realpathSync(path.join(product, 'node_modules/@gotgenes/pi-subagents')),
        product,
      ],
    })
  }
  const prior = {
    agent: process.env.PI_CODING_AGENT_DIR,
    memory: process.env.MAHIRO_AGENT_MEMORY_ROOT,
    continuity: process.env.MAHIRO_CONTINUITY_ROOT,
    fetch: globalThis.fetch,
  }
  process.env.PI_CODING_AGENT_DIR = profile
  delete process.env.MAHIRO_AGENT_MEMORY_ROOT
  delete process.env.MAHIRO_CONTINUITY_ROOT
  let session: any
  let requests = 0
  globalThis.fetch = () => {
    requests++
    throw Error('No external inference or auth transport')
  }
  try {
    const install = (args: string[] = ['--remove-default-deny']) =>
      spawnSync(process.execPath, [path.join(product, 'install.mjs'), '--agent-dir', profile, ...args], {
        cwd: projectA,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
        },
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
      })
    const beforeSettings = fs.readFileSync(path.join(profile, 'settings.json'))
    const beforePolicy = fs.readFileSync(policyFile)
    for (const args of [[], ['--preview']]) {
      const refused = install(args)
      assert.equal(refused.status, 1)
      assert.match(refused.stderr, /--remove-default-deny/)
      assert.deepEqual(fs.readFileSync(policyFile), beforePolicy)
      assert.deepEqual(fs.readFileSync(path.join(profile, 'settings.json')), beforeSettings)
      assert.equal(fs.existsSync(path.join(profile, '.mahiro-bootstrap')), false)
      assert.equal(fs.existsSync(path.join(profile, 'memory')), false)
    }
    const preview = install(['--preview', '--remove-default-deny'])
    assert.equal(preview.status, 0, preview.stderr)
    assert.deepEqual(fs.readFileSync(policyFile), beforePolicy)
    assert.deepEqual(fs.readFileSync(path.join(profile, 'settings.json')), beforeSettings)
    const first = install()
    fs.writeFileSync(path.join(dir, 'install.log'), first.stdout + first.stderr)
    assert.equal(first.status, 0, first.stdout + first.stderr)
    assert.equal(JSON.parse(first.stdout).status, 'completed')
    assertCanaries()
    const provisioned = JSON.parse(fs.readFileSync(policyFile, 'utf8'))
    assert.equal(Object.hasOwn(provisioned.permission, '*'), false)
    assert.equal(provisioned.yoloMode, false)
    for (const [key, value] of Object.entries(originalPolicy.permission))
      if (key !== '*') assert.deepEqual(provisioned.permission[key], value)
    assert.equal(
      Object.keys(provisioned.permission).some((key) => key.startsWith('continuity_learning_')),
      false,
      'standard installation does not opt into optional historical quote learning',
    )
    const upgradedSettingsBytes = fs.readFileSync(path.join(profile, 'settings.json'))
    assert.equal(fs.statSync(profile).mode & 0o777, 0o755, 'safe host container is not chmodded')
    const root = path.join(profile, 'memory')
    const store = createMemoryStore(root)
    const originalConfig = fs.readFileSync(path.join(root, 'config.json'))
    const originalLedger = fs.readFileSync(path.join(root, '.memory.json'))
    const core = store.snapshot().files['Core.md'].text
    assert.match(core, /^# Companion\n/)
    assert.match(core, /## Editable persona/)
    assert.match(core, /- Name: Companion/)
    assert.match(core, /No personal identity, preferences, project facts or imported corpus are assumed\./)
    assert.doesNotMatch(core, /Mahiro|mahirocoko|\/Users\/|SYNTHETIC_BOOTSTRAP_IDENTITY/i)
    const settings = sdk.SettingsManager.inMemory({
      ...JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')),
      cacheWarming: 'off',
      compaction: { enabled: false },
      retry: { enabled: false },
    })
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
    const initialRefresh = await runtime.refresh({ allowNetwork: false })
    assert.equal(initialRefresh.aborted, false)
    let results: any[] = [],
      context: any,
      tools: any[],
      node: any,
      definitions: any[]
    const prompts: string[] = []
    const open = async (cwd: string) => {
      const loader = new sdk.DefaultResourceLoader({
        cwd,
        agentDir: profile,
        settingsManager: settings,
        noSkills: true,
        noContextFiles: true,
        noThemes: true,
        noPromptTemplates: true,
        disabledBuiltinExtensions: ['mcp'],
        extensionFactories: [
          (pi: any) => {
            pi.on('session_start', (_e: any, c: any) => {
              context = c
              tools = pi.getAllTools()
              node = (globalThis as any)[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')]?.get(
                c.sessionManager.getSessionId(),
              )
            })
            pi.on('tool_result', (e: any) =>
              results.push({
                tool: e.toolName,
                error: e.isError,
                value: e.content.map((p: any) => p.text ?? '').join('\n'),
              }),
            )
            pi.on('before_agent_start', (e: any) => {
              prompts.push(e.systemPrompt)
            })
          },
        ],
      })
      await loader.reload()
      assert.deepEqual(loader.getExtensions().errors, [])
      const loaded = loader.getExtensions().extensions
      for (const owned of [
        'lib/guards/bootstrap.mjs',
        'lib/guards/index.ts',
        'extensions/mahiro-worker-activity.ts',
      ])
        assert.equal(
          loaded.filter((e: any) => e.path === path.join(product, owned)).length,
          1,
          `exactly one ${owned}`,
        )
      definitions = loader
        .getExtensions()
        .extensions.flatMap((e: any) => [...e.tools.values()].map((t: any) => t.definition))
      const created = await sdk.createAgentSession({
        cwd,
        agentDir: profile,
        resourceLoader: loader,
        settingsManager: settings,
        modelRuntime: runtime,
        model: faux.getModel(),
        sessionManager: sdk.SessionManager.create(cwd, path.join(dir, 'sessions')),
      })
      await created.session.bindExtensions({})
      assert.equal(node.healthy(), true)
      return created.session
    }
    const call = async (tool: string, args: any, error = false) => {
      results = []
      const before = session.messages.length
      faux.setResponses([
        () =>
          ai.fauxAssistantMessage([ai.fauxToolCall(tool, args)], {
            stopReason: 'toolUse',
          }),
        () => ai.fauxAssistantMessage('Synthetic native operation complete.'),
      ])
      await session.prompt('Synthetic explicit operation; no enduring preference is implied.', {
        source: 'extension',
      })
      const native = session.messages
        .slice(before)
        .find((m: any) => m.role === 'toolResult' && m.toolName === tool)
      const result =
        results.find((r) => r.tool === tool) ??
        (native
          ? {
              tool,
              error: native.isError,
              value: native.content.map((p: any) => p.text ?? '').join('\n'),
            }
          : undefined)
      assert.ok(result, `${tool}: native result required`)
      assert.equal(result.error, error, result.value)
      return result
    }
    const waitForIntegration = async () => {
      const manage = definitions!.find((t: any) => t.name === 'agent_memory_manage')
      let status: any
      for (let i = 0; i < 200; i++) {
        const result = await manage.execute(
          'fixture-integration-status',
          { action: 'status' },
          undefined,
          undefined,
          context,
        )
        assert.notEqual(result.isError, true, JSON.stringify(result))
        status = JSON.parse(result.content[0].text)
        if (status.worker === 'idle' && status.latestAttempt?.outcome === 'integrated') break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      assert.equal(status.worker, 'idle', JSON.stringify(status))
      assert.equal(status.latestAttempt?.outcome, 'integrated', JSON.stringify(status))
    }
    session = await open(projectA)
    // Documented public service slot (cross-extension-api.md); the installed
    // extension loaded it through Pi. Node cannot type-strip its TS npm entry.
    const publicPermissions = (globalThis as any)[
      Symbol.for('@gotgenes/pi-permission-system:session-services')
    ].get(session.sessionId)
    assert.equal(publicPermissions.checkPermission('bash', 'git commit -m synthetic').state, 'deny')
    assert.equal(publicPermissions.checkPermission('bash', 'rm -rf synthetic').state, 'deny')
    assert.equal(publicPermissions.checkPermission('unrelated_private_data').state, 'deny')
    assert.equal(publicPermissions.checkPermission('unconfigured_fixture_tool').state, 'ask')
    // Actual public service and native model dispatch below, not a copied resolver.
    for (const tool of [
      'mh_get_goal',
      'mh_create_goal',
      'mh_update_goal',
      'mh_clear_goal',
      'mh_code_evidence',
      'mh_get_ux_workflow',
      'mh_create_ux_workflow',
      'mh_update_ux_workflow',
      'mh_execution_run',
    ]) {
      assert.ok(
        tools!.some((t: any) => t.name === tool),
        tool,
      )
      assert.equal(publicPermissions.isToolFullyDenied(tool), false, tool)
      assert.equal(publicPermissions.checkPermission(tool).state, 'allow', tool)
    }
    fs.writeFileSync(path.join(projectA, '.env'), 'SYNTHETIC_NON_SECRET=canary\n')
    await call('read', { path: path.join(projectA, '.env') }, true)
    for (const [tool, args] of [
      ['mh_get_goal', {}],
      ['mh_code_evidence', { action: 'get' }],
      ['mh_get_ux_workflow', {}],
      ['mh_execution_run', { operation: 'get' }],
      ['recall_search', { query: 'absent', crossProject: true }],
    ] as const)
      await call(tool, args)
    assert.equal(
      fs.existsSync(path.join(profile, 'workflow')),
      false,
      'empty reads create no Goal/Run/data directories',
    )
    const listed = JSON.parse((await call('agent_memory_read', {})).value)
    await call('agent_memory_edit', {
      path: 'deferred/project-b/relevant.md',
      expectedHash: null,
      text: '# Relevant\nCross-project maintained knowledge.\n',
      sources: [],
    })
    await call('agent_memory_commit', { revision: listed.revision })
    await call('agent_memory_read', { path: 'deferred/project-b/relevant.md' })
    const queried = JSON.parse((await call('agent_memory_read', { query: 'Cross-project maintained' })).value)
    assert.equal(queried.results[0].path, 'deferred/project-b/relevant.md')
    assert.equal(queried.freshness, 'current')
    assert.equal(queried.basis, 'view-snapshot')
    const topics = JSON.parse((await call('agent_memory_read', { topic: '*', limit: 1 })).value)
    assert.equal(topics.entries.length, 1)
    assert.equal(topics.complete, false)
    for (const invalid of [
      { query: 'Cross-project', path: 'Core.md' },
      { topic: '*', query: 'Cross-project' },
      { topic: '*', limit: 33 },
      { offset: 1 },
    ])
      await call('agent_memory_read', invalid, true)
    assert.match(prompts.at(-1)!, /Curation doctrine v1/)
    assert.ok(prompts.at(-1)!.includes(store.snapshot().revision))
    assert.equal(store.snapshot().files['Core.md'].text, core)
    // Namespace authority MUST NOT mask exact legacy leaf, tool or path denies.
    const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'))
    const leaf = resolveGoalBinding(projectA)!
    for (const extra of [
      { [`goal_state_${sha(leaf.root)}`]: 'deny' },
      { mh_get_goal: 'deny' },
      { path_read: { [path.join(leaf.root, 'state.json')]: 'deny' } },
    ]) {
      fs.writeFileSync(
        policyFile,
        JSON.stringify({
          ...policy,
          permission: { ...policy.permission, ...extra },
        }),
      )
      await call('mh_get_goal', {}, true)
    }
    fs.writeFileSync(policyFile, JSON.stringify(policy))
    await call('mh_get_goal', {})
    // Genuine normal child perturbs the public singleton. Its own native Bash
    // must still use the installed rewrite default and its own public decisions.
    fs.writeFileSync(path.join(projectA, 'safe.txt'), 'SAFE\n')
    const helper = installRTKHelper(dir)
    const savedPath = process.env.PATH
    process.env.PATH = `${helper.bin}:${savedPath}`
    fs.writeFileSync(
      policyFile,
      JSON.stringify({
        ...policy,
        permission: {
          ...policy.permission,
          bash: { '*': 'ask', 'ls *': 'allow', 'rtk ls *': 'allow' },
        },
      }),
    )
    await session.extensionRunner.emit({
      type: 'session_shutdown',
      reason: 'quit',
    })
    session.dispose()
    session = await open(projectA)
    const service = node.managedMemory.parentService()
    assert.ok(service?.supportsInitialOutcomeClaim)
    const childContexts: string[] = []
    let normalTurns = 0
    faux.setResponses(
      Array.from({ length: 32 }, () => (c: any) => {
        childContexts.push(JSON.stringify(c.messages))
        const turn = normalTurns++
        if (turn === 0)
          return ai.fauxAssistantMessage([ai.fauxToolCall('bash', { command: 'ls safe.txt' })], {
            stopReason: 'toolUse',
          })
        if (turn === 1)
          return ai.fauxAssistantMessage([ai.fauxToolCall('agent_memory_read', { query: 'Cross-project' })], {
            stopReason: 'toolUse',
          })
        return ai.fauxAssistantMessage('Synthetic normal child complete.')
      }),
    )
    // Spawn resolves the model string against the available snapshot.
    // registerNativeProvider starts that refresh in the background. The retired
    // secret checker no longer adds enough delay for it to land first.
    const refreshed = await runtime.refresh({ allowNetwork: false })
    assert.equal(refreshed.aborted, false)
    assert.ok(
      runtime
        .getAvailableSnapshot()
        .some(
          (model: { provider: string; id: string }) =>
            model.provider === 'openai' && model.id === 'gpt-6.1-sol',
        ),
    )
    const normal = service.spawn('general-purpose', 'Synthetic child Bash check only.', {
      foreground: false,
      inheritContext: false,
      model: 'openai/gpt-6.1-sol',
      claimOutcome: true,
    })
    await service.waitForAll()
    process.env.PATH = savedPath
    assert.equal(service.getRecord(normal).status, 'completed')
    assert.equal(helper.calls().length, 1, 'actual child entered bounded installed execFile resolver')
    assert.equal(helper.spawns().length, 1, 'actual native factory spawned final candidate')
    assert.equal(
      node.managedMemory.parentService(),
      service,
      'normal child cannot replace the owning primary service',
    )
    assert.ok(!childContexts.some((c) => c.includes('Cross-project maintained knowledge')))
    assert.ok(
      childContexts.some((c) =>
        JSON.parse(c).some(
          (m: any) => m.role === 'toolResult' && m.toolName === 'agent_memory_read' && m.isError,
        ),
      ),
      'ordinary native child cannot query maintained memory without a lease',
    )
    // Start reflection while the parent is idle, after a real child has bound.
    // The writer gets a real private-view lease, not the shared primary corpus.
    results = []
    const writerContexts: string[] = []
    faux.setResponses(
      Array.from({ length: 32 }, () => (c: any) => {
        writerContexts.push(JSON.stringify(c.messages))
        const rr = c.messages.filter((m: any) => m.role === 'toolResult')
        let call: [string, Parameters<typeof ai.fauxToolCall>[1]] | undefined
        if (rr.length === 0) call = ['agent_memory_read', { path: 'deferred/project-b/relevant.md' }]
        else if (rr.length === 1) call = ['agent_memory_read', { path: 'Core.md' }]
        else if (rr.length === 2) call = ['agent_memory_read', { query: 'Cross-project' }]
        else if (rr.length === 3) call = ['agent_memory_read', { topic: '*' }]
        else if (rr.length === 4)
          call = [
            'agent_memory_edit',
            {
              path: 'procedures/idle-check.md',
              expectedHash: null,
              text: '# Idle check\nInspect explicit owner receipts.\n',
              sources: [],
            },
          ]
        else if (rr.length === 5)
          call = ['agent_memory_commit', { revision: JSON.parse(rr[1].content[0].text).revision }]
        return call
          ? ai.fauxAssistantMessage([ai.fauxToolCall(call[0], call[1])], {
              stopReason: 'toolUse',
            })
          : ai.fauxAssistantMessage('Synthetic scoped writer complete.')
      }),
    )
    const reflectTool = tools!.find((t) => t.name === 'agent_memory_reflect')
    // Access to the actual registered definition, with its real SDK context/ABI.
    // No forged sourceInfo/health/auth/role metadata.
    const definition = definitions!.find((t: any) => t.name === reflectTool.name)
    const reflection = await definition.execute(
      'explicit-idle-reflect',
      { assignment: 'Maintain a generic owner-receipt inspection procedure.' },
      undefined,
      undefined,
      context,
    )
    assert.match(reflection.content[0].text, /native-dispatched/)
    await service.waitForAll()
    // Native completion and parent publication are distinct public settlement boundaries.
    await waitForIntegration()
    assert.ok(store.snapshot().files['procedures/idle-check.md'])
    assert.ok(writerContexts.some((c) => c.includes('Managed memory unavailable')))
    assert.ok(
      writerContexts.some((c) =>
        JSON.parse(c).some(
          (m: any) => m.role === 'toolResult' && m.toolName === 'agent_memory_read' && m.isError === true,
        ),
      ),
      'actual bound worker cross-project read rejects',
    )
    assert.ok(!writerContexts.some((c) => c.includes('Cross-project maintained knowledge')))
    const writerMessages = JSON.parse(writerContexts.at(-1)!)
    const negative = writerMessages.find(
      (m: any) => m.role === 'toolResult' && m.toolName === 'agent_memory_read' && m.isError,
    )
    const positive = writerMessages.find(
      (m: any) => m.role === 'toolResult' && m.toolName === 'agent_memory_read' && !m.isError,
    )
    assert.equal(JSON.parse(positive.content[0].text).path, 'Core.md')
    assert.equal(JSON.parse(positive.content[0].text).text, core)
    const leasedReads = writerMessages.filter(
      (m: any) => m.role === 'toolResult' && m.toolName === 'agent_memory_read',
    )
    assert.equal(JSON.parse(leasedReads[2].content[0].text).outcome, 'no-match')
    assert.doesNotMatch(leasedReads[3].content[0].text, /project-b|relevant\.md/)
    assert.match(writerContexts[0], /Curation doctrine v1/)
    const writerRecord = service.listAgents().find((r: any) => r.type === 'managed-memory-writer')
    assert.equal(writerRecord.status, 'completed')
    const writerHeader = JSON.parse(fs.readFileSync(writerRecord.outputFile, 'utf8').split('\n')[0])
    assert.equal(writerHeader.parentSession, session.sessionId)
    fs.writeFileSync(
      path.join(dir, 'writer-negative.json'),
      JSON.stringify(
        {
          job: writerRecord.id,
          child: writerHeader.id,
          parent: writerHeader.parentSession,
          outputFile: writerRecord.outputFile,
          allowedCoreRead: positive,
          otherProjectRejected: negative,
          integratedProcedure: !!store.snapshot().files['procedures/idle-check.md'],
        },
        null,
        2,
      ),
    )
    await call('agent_memory_read', {})
    assert.ok(prompts.at(-1)!.includes('"topic":"procedures"'))
    assert.ok(!prompts.at(-1)!.includes('procedures/idle-check.md'))
    await session.extensionRunner.emit({
      type: 'session_shutdown',
      reason: 'quit',
    })
    session.dispose()
    session = await open(projectB) // Unmapped synthetic former-ban name; no profile/project config.
    assert.match(
      (
        await call('agent_memory_read', {
          path: 'deferred/project-b/relevant.md',
        })
      ).value,
      /Cross-project maintained/,
    )
    await call('mh_get_goal', {})
    await call('recall_search', { query: 'absent', crossProject: true })
    const archive = createContinuityStore(path.join(profile, 'continuity'), {
      excludedProjectIds: [],
      excludedPaths: [],
    })
    archive.ingest(archive.snapshot(), [
      {
        id: 'historical-cross-project',
        sourceKind: 'pi_message',
        projectId: sha(projectA),
        conversationId: 'synthetic-history',
        messageId: 'history-message',
        message: {
          message_type: 'user_message',
          content: 'Historical cross-project violet receipt.',
        },
      },
    ])
    assert.match((await call('recall_search', { query: 'violet', crossProject: true })).value, /violet/)
    assert.ok(!(await call('recall_search', { query: 'violet' })).value.includes('violet'))
    const pointer = path.join(profile, 'continuity/state.json'),
      pointerBytes = fs.readFileSync(pointer)
    fs.writeFileSync(pointer, '{broken')
    await call('recall_search', { query: 'violet', crossProject: true }, true)
    fs.writeFileSync(pointer, pointerBytes)
    const a = resolveGoalBinding(projectA)!,
      b = resolveGoalBinding(projectB)!
    assert.notEqual(a.root, b.root)
    const ticket = stateTicket(readGoalState(a))
    await transactGoal(
      a,
      ticket,
      () => {},
      (s) =>
        applyGoal(s, { ...a, sessionId: 'fixture' }, 'create', {
          objective: 'Authorized synthetic state',
          criteria: [{ text: 'Synthetic only', owner: 'agent' }],
        }),
    )
    assert.equal(readGoalState(b).sequence, 0)
    assert.equal(readGoalState(a).sequence, 1)
    await assert.rejects(
      transactGoal(
        a,
        ticket,
        () => {},
        () => {},
      ),
      /Stale/,
    )
    for (const p of [projectA, projectB]) {
      assert.equal(readEvidenceState(resolveEvidenceBinding(p)!).sequence, 0)
      assert.equal(readUXState(resolveUXBinding(p)!).sequence, 0)
      assert.equal(readRunState(resolveRunBinding(p)!).sequence, 0)
    }
    // Explicit test-only opt-in for the optional historical owner; standard
    // installation above must not grant this authority implicitly.
    const learningPolicy = JSON.parse(fs.readFileSync(policyFile, 'utf8'))
    learningPolicy.permission[`continuity_learning_${sha(path.join(profile, 'continuity'))}`] = 'allow'
    fs.writeFileSync(policyFile, JSON.stringify(learningPolicy), { mode: 0o600 })
    // Both automatic owners receive one genuine observed idle settlement. They
    // share the exact native parent's bounded queue, not a last-child singleton.
    const automaticService = node.managedMemory.parentService()
    faux.setResponses(
      Array.from({ length: 64 }, () => (c: any) => {
        const raw = JSON.stringify(c.messages)
        if (raw.includes('You maintain the primary companion')) {
          const rr = c.messages.filter((m: any) => m.role === 'toolResult')
          const tc: [string, Parameters<typeof ai.fauxToolCall>[1]] | undefined =
            rr.length === 0
              ? ['agent_memory_read', {}]
              : rr.length === 1
                ? [
                    'agent_memory_edit',
                    {
                      path: 'procedures/auto-coexist.md',
                      expectedHash: null,
                      text: '# Coexistence\nInspect separate native owner receipts.\n',
                      sources: [],
                    },
                  ]
                : rr.length === 2
                  ? ['agent_memory_commit', { revision: JSON.parse(rr[0].content[0].text).revision }]
                  : undefined
          return tc
            ? ai.fauxAssistantMessage([ai.fauxToolCall(tc[0], tc[1])], {
                stopReason: 'toolUse',
              })
            : ai.fauxAssistantMessage('Synthetic automatic writer complete.')
        }
        if (
          raw.includes('active_agent name=\\"memory-reflector\\"') ||
          raw.includes('active_agent name="memory-reflector"')
        )
          return ai.fauxAssistantMessage('{"notes":[]}')
        return ai.fauxAssistantMessage('Synthetic completed observation.')
      }),
    )
    await session.prompt('Synthetic observation for bounded queue coexistence.', { source: 'interactive' })
    await automaticService.waitForAll()
    await waitForIntegration()
    const automaticRecords = automaticService.listAgents()
    assert.ok(
      automaticRecords.some((r: any) => r.type === 'managed-memory-writer' && r.status === 'completed'),
    )
    assert.ok(
      automaticRecords.some((r: any) => r.type === 'memory-reflector' && r.status === 'completed'),
      JSON.stringify(automaticRecords),
    )
    assert.ok(store.snapshot().files['procedures/auto-coexist.md'])
    assert.ok(
      archive.inspect().cursor > 0,
      'genuine C1 empty-note success advances accepted review, not fabricated health',
    )
    await call('agent_memory_read', {})
    assert.ok(prompts.at(-1)!.includes('"topic":"procedures"'))
    assert.ok(!prompts.at(-1)!.includes('procedures/auto-coexist.md'))
    const before = store.snapshot()
    const ledger = fs.readFileSync(path.join(root, '.memory.json'))
    const again = install()
    fs.writeFileSync(path.join(dir, 'rerun.log'), again.stdout + again.stderr)
    assert.equal(again.status, 0, again.stdout + again.stderr)
    assertCanaries()
    assert.deepEqual(fs.readFileSync(path.join(profile, 'settings.json')), upgradedSettingsBytes)
    assert.deepEqual(store.snapshot(), before)
    assert.deepEqual(fs.readFileSync(path.join(root, 'config.json')), originalConfig)
    assert.deepEqual(fs.readFileSync(path.join(root, '.memory.json')), ledger)
    assert.notDeepEqual(ledger, originalLedger, 'real persistence, not universal empty response')
    fs.chmodSync(profile, 0o777)
    assert.throws(() => resolveGoalBinding(projectA), /Unsafe/)
    fs.chmodSync(profile, 0o755)
    assert.equal(requests, 0)
    fs.writeFileSync(
      path.join(dir, 'receipt.json'),
      JSON.stringify(
        {
          actualAuthoringRoot: product,
          oneInstall: true,
          nativeSDK: true,
          externalRequests: requests,
          realProfileChanged: false,
          existingRevisionPreserved: before.revision,
        },
        null,
        2,
      ),
    )
  } finally {
    if (session) {
      await session.extensionRunner.emit({
        type: 'session_shutdown',
        reason: 'quit',
      })
      session.dispose()
    }
    globalThis.fetch = prior.fetch
    for (const [key, value] of [
      ['PI_CODING_AGENT_DIR', prior.agent],
      ['MAHIRO_AGENT_MEMORY_ROOT', prior.memory],
      ['MAHIRO_CONTINUITY_ROOT', prior.continuity],
    ]) {
      if (value === undefined) delete process.env[key!]
      else process.env[key!] = value
    }
  }
})
