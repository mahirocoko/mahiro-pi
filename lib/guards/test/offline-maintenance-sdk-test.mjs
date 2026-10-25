import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { MemoryEngineController } from '../../agent-memory/engine/controller.ts'
import { parseOperation } from '../../agent-memory/engine/operation.ts'

const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const evidence = path.join(product, '.agent-state/runtime/offline-owner-sdk')
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 })

test('registered offline Faux owner: exact DATA positive; persistent primary, native child, wildcard and deny negative', async () => {
  const directory = fs.mkdtempSync(path.join(evidence, 'operator-'))
  const profile = path.join(directory, 'profile')
  const cwd = path.join(directory, 'project')
  fs.mkdirSync(profile, { mode: 0o700 })
  fs.mkdirSync(cwd, { mode: 0o700 })
  const root = path.join(profile, 'memory')
  const previous = { ...process.env }
  for (const key of Object.keys(process.env))
    if (/^(?:GIT_|PI_|MAHIRO_)/.test(key) || /API_KEY/.test(key)) delete process.env[key]
  Object.assign(process.env, {
    PI_CODING_AGENT_DIR: profile,
    GIT_AUTHOR_NAME: 'Offline fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Offline fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  })
  // HOME stays ordinary. Only disposable profile paths and declared public modules are used.
  const home = process.env.HOME
  const modules = path.join(product, 'node_modules')
  const guardModules = path.join(product, 'lib/guards/node_modules')
  const relocated = fs.lstatSync(modules).isSymbolicLink() && fs.realpathSync(modules) === guardModules
  if (relocated) {
    fs.unlinkSync(modules)
    fs.renameSync(guardModules, modules)
  }
  const originalFetch = globalThis.fetch
  let external = 0
  globalThis.fetch = () => {
    external++
    throw Error('External transport forbidden')
  }
  let session
  let preparing
  try {
    const installed = spawnSync(
      process.execPath,
      [
        path.join(product, 'install.mjs'),
        '--agent-dir',
        profile,
        '--managed-writer-model',
        'offline-maintenance-faux/model',
        '--managed-writer-thinking',
        'off',
      ],
      { cwd, env: process.env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    )
    assert.equal(installed.status, 0, installed.stderr)
    const permissionPath = path.join(profile, 'extensions/pi-permission-system/config.json')
    const permissions = fs.readFileSync(permissionPath)
    const configured = JSON.parse(permissions)
    const capability = `managed_memory_${createHash('sha256').update(root).digest('hex')}`
    assert.equal(configured.permission[capability], 'allow')
    const packages = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).packages
    const sdk = await import('@earendil-works/pi-coding-agent')
    const ai = await import('@earendil-works/pi-ai')
    const runtime = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const faux = ai.fauxProvider({ provider: 'offline-maintenance-faux', models: [{ id: 'model' }] })
    runtime.registerNativeProvider(faux.provider)
    const observedChildren = []
    let node
    let primaryContext
    let manageTool
    let result
    const settingsManager = sdk.SettingsManager.inMemory({
      packages,
      skills: [],
      themes: [],
      prompts: [],
      cacheWarming: 'off',
      compaction: { enabled: false },
      retry: { enabled: false },
    })
    const loader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir: profile,
      settingsManager,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ['mcp'],
      systemPromptOverride: () => 'Offline disposable SDK fixture.',
      extensionFactories: [
        (pi) => {
          pi.on('session_start', (_, ctx) => {
            node = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')]?.get(
              ctx.sessionManager.getSessionId(),
            )
            assert.ok(node?.healthy())
            primaryContext = ctx
            manageTool = pi.getAllTools().find((tool) => tool.name === 'agent_memory_manage')
          })
          pi.on('tool_result', (event) => {
            if (event.toolName === 'agent_memory_manage') result = event
          })
        },
      ],
    })
    // Child observer sees real native managers and current tools, never fabricates contexts/authority.
    const observation = Symbol.for('@mahirocoko/offline-maintenance-sdk:children')
    globalThis[observation] = observedChildren
    fs.writeFileSync(
      path.join(profile, 'extensions/offline-child-observer.ts'),
      `
      export default pi => pi.on('before_agent_start', (_,ctx) => {
        const node=globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')]?.get(ctx.sessionManager.getSessionId());
        const seen=globalThis[Symbol.for('@mahirocoko/offline-maintenance-sdk:children')];
        if (node?.managedMemory?.version !== 2 || node.managedMemory.isPrimarySession(ctx)) {
          seen.push({version:node?.managedMemory?.version, primary:node?.managedMemory?.isPrimarySession(ctx)}); return;
        }
        let denied=false;
        try { node.managedMemory.maintenanceAccess(pi.getAllTools().find(t=>t.name==='agent_memory_manage'),
          ctx, ${JSON.stringify(root)}, 'write', []); } catch { denied=true; }
        globalThis[Symbol.for('@mahirocoko/offline-maintenance-sdk:children')].push({denied, primary:false,
          session:ctx.sessionManager.getSessionId()});
      });`,
      { mode: 0o600 },
    )
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    ;({ session } = await sdk.createAgentSession({
      cwd,
      agentDir: profile,
      modelRuntime: runtime,
      model: faux.getModel(),
      settingsManager,
      resourceLoader: loader,
      sessionManager: sdk.SessionManager.create(cwd, path.join(directory, 'sessions')),
    }))
    await session.bindExtensions({})
    faux.setResponses([
      () =>
        ai.fauxAssistantMessage([ai.fauxToolCall('agent_memory_manage', { action: 'offline-inspect' })], {
          stopReason: 'toolUse',
        }),
      () => ai.fauxAssistantMessage('Expected persistent-primary refusal.'),
    ])
    await session.prompt('Attempt offline action in a persistent primary; must refuse.', {
      source: 'extension',
    })
    assert.equal(result?.isError, true)
    assert.throws(
      () => node.managedMemory.maintenanceAccess(manageTool, primaryContext, root, 'write', []),
      /ephemeral|headless/i,
    )
    // A durable fixture marker blocks an actual ordinary primary WRITE while READ/status/projection continue.
    const markerPath = path.join(root, '.views/.maintenance-active.json')
    fs.mkdirSync(path.join(root, '.views'), { recursive: true, mode: 0o700 })
    const coreBefore = fs.readFileSync(path.join(root, 'Core.md'))
    fs.writeFileSync(markerPath, JSON.stringify({ version: 1, id: randomUUID() }), { mode: 0o600 })
    assert.throws(
      () => node.managedMemory.assertAccess(manageTool, primaryContext, root, 'write'),
      /maintenance/,
    )
    assert.equal(node.managedMemory.assertAccess(manageTool, primaryContext, root, 'read').kind, 'primary')
    faux.setResponses([
      () =>
        ai.fauxAssistantMessage([ai.fauxToolCall('agent_memory_manage', { action: 'status' })], {
          stopReason: 'toolUse',
        }),
      () => ai.fauxAssistantMessage('Read-only status remains available.'),
    ])
    await session.prompt('Read authorized status with maintenance marker.', { source: 'extension' })
    assert.equal(result?.isError, false)
    faux.setResponses([
      () =>
        ai.fauxAssistantMessage(
          [
            ai.fauxToolCall('agent_memory_edit', {
              path: 'Core.md',
              expectedHash: createHash('sha256').update(coreBefore).digest('hex'),
              text: '# Must not write\n',
              sources: [],
            }),
          ],
          { stopReason: 'toolUse' },
        ),
      () => ai.fauxAssistantMessage('Expected ordinary write refusal.'),
    ])
    await session.prompt('Ordinary edit must stay blocked by marker.', { source: 'extension' })
    assert.deepEqual(fs.readFileSync(path.join(root, 'Core.md')), coreBefore)
    fs.unlinkSync(markerPath) // disposable barrier fixture only, never production recovery
    const service = node.managedMemory.parentService()
    faux.setResponses([() => ai.fauxAssistantMessage('Native child negative fixture; no memory access.')])
    const child = service.spawn('managed-memory-writer', 'No corpus; observe child boundary only.', {
      model: 'offline-maintenance-faux/model',
      thinkingLevel: 'off',
      inheritContext: false,
      foreground: false,
      bypassQueue: false,
      maxTurns: 1,
      claimOutcome: true,
    })
    await service.waitForAll()
    assert.equal(service.getRecord(child).status, 'completed')
    assert.ok(
      observedChildren.some((entry) => entry.denied && entry.primary === false),
      JSON.stringify(observedChildren),
    )
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    session.dispose()
    session = undefined
    delete globalThis[observation]

    preparing = new MemoryEngineController(root)
    const context = { current: () => true } // disposable incident construction ONLY
    const view = await preparing.request(
      'create',
      { project: createHash('sha256').update(cwd).digest('hex'), shared: true },
      context,
    )
    // Ready an unchanged proposal; the uncertain typed operation is synthesized only in this fixture.
    await preparing.request('ready', { view: view.view }, context)
    const prepared = await preparing.request('prepare', { view: view.view, reviewed: [] }, context)
    assert.ok('plan' in prepared)
    const journalPath = path.join(root, '.views/.engine-v2/journal', `${prepared.plan.id}.json`)
    const record = parseOperation(fs.readFileSync(journalPath, 'utf8'))
    fs.mkdirSync(path.join(root, '.lock'), { mode: 0o700 })
    const stat = fs.lstatSync(path.join(root, '.lock'))
    const owner = {
      version: 1,
      operation: prepared.plan.id,
      digest: prepared.plan.digest,
      nonce: randomUUID(),
      directory: `${stat.dev}:${stat.ino}`,
    }
    fs.writeFileSync(path.join(root, '.lock/owner.json'), JSON.stringify(owner), { mode: 0o600 })
    const unknown = { ...record, sequence: 3, owner, receipt: { stage: 'unknown' } }
    parseOperation(JSON.stringify(unknown))
    fs.writeFileSync(journalPath, `${JSON.stringify(unknown)}\n`, { mode: 0o600 })
    fs.writeFileSync(path.join(root, `.memory-engine-${randomUUID()}.tmp`), 'fixture orphan', { mode: 0o600 })
    await preparing.close()
    preparing = undefined
    const cli = (...args) =>
      spawnSync(
        process.execPath,
        [path.join(product, 'memory-maintenance.mjs'), '--agent-dir', profile, '--project', cwd, ...args],
        { cwd, env: process.env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
      )
    const wildcard = structuredClone(configured)
    delete wildcard.permission[capability]
    wildcard.permission['*'] = 'allow'
    fs.writeFileSync(permissionPath, JSON.stringify(wildcard), { mode: 0o600 })
    assert.notEqual(cli('--inspect').status, 0, 'wildcard alone cannot authorize offline owner')
    const denied = structuredClone(configured)
    denied.permission[capability] = 'deny'
    fs.writeFileSync(permissionPath, JSON.stringify(denied), { mode: 0o600 })
    assert.notEqual(cli('--inspect').status, 0, 'exact deny cannot authorize offline owner')
    fs.writeFileSync(permissionPath, permissions, { mode: 0o600 })
    assert.equal(fs.existsSync(path.join(root, '.lock')), true)
    const preview = cli('--inspect')
    fs.writeFileSync(path.join(directory, 'preview.log'), preview.stdout + preview.stderr)
    assert.equal(preview.status, 0, preview.stderr)
    const reviewed = JSON.parse(preview.stdout)
    assert.equal(reviewed.externalRequests, 0)
    assert.equal(reviewed.maintenance.counts.unknownAdmission, 1)
    const head = fs.readFileSync(path.join(root, '.git/HEAD'))
    const config = fs.readFileSync(path.join(root, 'config.json'))
    assert.equal(JSON.parse(config).automatic, true, 'operator never disables automatic profile policy')
    for (const restriction of ['write-tool', 'marker-path']) {
      const blocked = structuredClone(configured)
      if (restriction === 'write-tool') blocked.permission.write = 'deny'
      else blocked.permission.path_write = { [path.join(root, '.views/.maintenance-active.json')]: 'deny' }
      fs.writeFileSync(permissionPath, JSON.stringify(blocked), { mode: 0o600 })
      const rejected = cli(
        '--apply',
        '--offline',
        '--target',
        reviewed.maintenance.target,
        '--expect',
        reviewed.maintenance.revision,
      )
      assert.notEqual(rejected.status, 0, restriction)
      assert.equal(fs.existsSync(path.join(root, '.lock')), true)
      assert.equal(fs.existsSync(path.join(root, '.views/.maintenance-active.json')), false)
    }
    fs.writeFileSync(permissionPath, permissions, { mode: 0o600 })
    const adopted = cli(
      '--apply',
      '--offline',
      '--target',
      reviewed.maintenance.target,
      '--expect',
      reviewed.maintenance.revision,
    )
    fs.writeFileSync(path.join(directory, 'adoption.log'), adopted.stdout + adopted.stderr)
    assert.equal(adopted.status, 0, adopted.stderr)
    const receipt = JSON.parse(adopted.stdout)
    assert.equal(receipt.maintenance.disposition, 'manually-adopted-prior-outcome-unknown')
    assert.equal(receipt.externalRequests, 0)
    assert.equal(receipt.noNativeWorkersAdmitted, true)
    assert.equal(receipt.maintenanceProjectionSkipped, true)
    assert.equal(Object.hasOwn(receipt, 'nextRequestProjection'), false)
    assert.equal(Object.hasOwn(receipt, 'nextRequestRevision'), false)
    assert.equal(receipt.maintenance.humanAcceptance, false)
    assert.deepEqual(fs.readFileSync(path.join(root, '.git/HEAD')), head)
    assert.deepEqual(fs.readFileSync(path.join(root, 'config.json')), config)
    assert.equal(fs.existsSync(path.join(root, '.lock')), false)
    assert.equal(process.env.HOME, home)
    assert.equal(external, 0)
    console.log(
      'offline-owner-sdk: genuine ephemeral Faux exact-DATA adoption; persistent/child/wildcard/deny refused; zero external',
    )
  } finally {
    if (session) {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
      session.dispose()
    }
    await preparing?.close()
    globalThis.fetch = originalFetch
    if (relocated) {
      fs.renameSync(modules, guardModules)
      fs.symlinkSync('lib/guards/node_modules', modules, 'dir')
    }
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, previous)
  }
})
