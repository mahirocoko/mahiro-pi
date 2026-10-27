// Offline native SDK/Faux regression adapted from the T246 split-turn diagnostic.
// Genuine threshold compaction only: no fabricated compact/settle events or live inference.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const product = fileURLToPath(new URL('../..', import.meta.url))
const previous = { ...process.env }
const previousCwd = process.cwd()
const originalFetch = globalThis.fetch
let fixture, session, manager, timer, permissionService, originalCheckPermission, serviceForSession
let writerService, originalGetAgentType
let writerPhase = 'positive'
const writerAttempts = { positive: 0, compaction: 0, continuation: 0 }
const denyEpisodeTemp = process.argv.includes('--deny-episode-temp')
const duplicateSummary = process.argv.includes('--duplicate-summary')
const permissionCalls = []
let permissionCallOverflow = false
let externalFetches = 0
let compactions = 0
let compacting = false
let ctx
const errors = []
const hooks = []
const requests = []
const sha = (text) => createHash('sha256').update(text).digest('hex')
const messageText = (message) =>
  typeof message.content === 'string'
    ? message.content
    : (message.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
const positive = 'SYNTHETIC_RPC_POSITIVE: bounded fixture only, no human preference.'
const large = 'X'.repeat(40000)
const first = 'SYNTHETIC_CONTINUATION_ONE'
const second = 'SYNTHETIC_CONTINUATION_TWO'
const classify = (context) => {
  const system = context.messages
    .filter((message) => message.role === 'system')
    .map(messageText)
    .join('\n')
  const users = context.messages.filter((message) => message.role === 'user').map(messageText)
  const last = users.at(-1) ?? ''
  if (duplicateSummary && compacting && system.startsWith('You are a context summarization assistant.'))
    return 'duplicate-summary'
  if (duplicateSummary && !compacting && system.includes('<mahiro-managed-memory>')) return 'duplicate-turn'
  if (compacting && system.startsWith('You are a context summarization assistant.')) {
    if (last.includes('Later messages are stored separately') && last.includes('## Original Request'))
      return 'split-summary'
    if (last.includes('Create a structured context checkpoint summary') && last.includes('<conversation>'))
      return 'history-summary'
  }
  if (!compacting && system.includes('<mahiro-managed-memory>')) {
    if (!compactions && users.includes(large)) return 'large'
    if (!compactions && users.includes(positive)) return 'positive'
    if (compactions === 1 && last === first) return 'first'
    if (compactions === 1 && last === second) return 'second'
  }
  return 'unclassified'
}
const inventory = () => {
  const folder = path.join(fixture.root, '.episodes')
  return fs.existsSync(folder)
    ? fs
        .readdirSync(folder)
        .filter((name) => name.endsWith('.json'))
        .sort()
        .map((name) => ({
          name,
          raw: fs.readFileSync(path.join(folder, name), 'utf8'),
        }))
    : []
}
try {
  for (const key of Object.keys(process.env))
    if (/^(GIT_|PI_|MAHIRO_)/.test(key) || /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key))
      delete process.env[key]
  globalThis.fetch = () => {
    externalFetches++
    throw Error('No external fetch in offline compaction fixture')
  }
  const fixtures = await import('../../lib/guards/memory-fixture.mjs')
  fixture = await fixtures.createDisposableMemoryFixture()
  Object.assign(process.env, {
    HOME: fixture.home,
    PI_CODING_AGENT_DIR: fixture.agentDir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(fixture.home, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: fixture.directory,
    GIT_TERMINAL_PROMPT: '0',
  })
  process.chdir(fixture.cwd)
  fs.writeFileSync(
    path.join(fixture.home, '.gitconfig'),
    '[user]\n name = Synthetic SDK\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
    { mode: 0o600 },
  )
  const sdk = await import('@earendil-works/pi-coding-agent')
  const ai = await import('@earendil-works/pi-ai')
  const permissions = fs.realpathSync(path.join(product, 'node_modules/@gotgenes/pi-permission-system'))
  const subagents = fs.realpathSync(path.join(product, 'node_modules/@gotgenes/pi-subagents'))
  const capability = `managed_memory_${sha(fixture.root)}`
  const deniedTempPattern = `${fixture.root}/.episodes/*.json.*.tmp`
  const permissionPath = path.join(fixture.agentDir, 'extensions/pi-permission-system/config.json')
  fs.mkdirSync(path.dirname(permissionPath), { recursive: true })
  fs.writeFileSync(
    permissionPath,
    JSON.stringify({
      yoloMode: false,
      authorizerChain: [],
      permission: {
        '*': 'deny',
        read: 'allow',
        agent_memory_read: 'allow',
        agent_memory_manage: 'allow',
        agent_memory_edit: 'allow',
        agent_memory_commit: 'allow',
        agent_memory_reflect: 'allow',
        [capability]: 'allow',
        ...(denyEpisodeTemp ? { path_write: { [deniedTempPattern]: 'deny' } } : {}),
      },
    }),
    { mode: 0o600 },
  )
  fs.mkdirSync(path.join(fixture.agentDir, 'extensions/pi-subagents'), { recursive: true })
  fs.writeFileSync(
    path.join(fixture.agentDir, 'extensions/pi-subagents/config.json'),
    JSON.stringify({ excludedExtensionPackages: [subagents] }),
    { mode: 0o600 },
  )
  const runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const faux = ai.fauxProvider({
    provider: 'memory-compaction-offline',
    models: [{ id: 'threshold', contextWindow: 32768, maxTokens: 4096 }],
    tokenSize: { min: 512, max: 512 },
  })
  const capture = (context) => {
    const system = context.messages
      .filter((message) => message.role === 'system')
      .map(messageText)
      .join('\n')
    requests.push({
      kind: classify(context),
      checkpoint: system.includes('Compaction continuity checkpoint (unverified summary context)'),
      core: system.includes('SYNTHETIC_COMPACTION_CORE'),
      wrapper: system.includes('<mahiro-managed-memory>'),
      callCountBefore: faux.state.callCount,
    })
  }
  runtime.registerNativeProvider({
    id: faux.provider.id,
    name: faux.provider.name,
    auth: faux.provider.auth,
    getModels: () => faux.provider.getModels(),
    stream: (model, context, options) => {
      capture(context)
      return faux.provider.stream(model, context, options)
    },
    streamSimple: (model, context, options) => {
      capture(context)
      return faux.provider.streamSimple(model, context, options)
    },
  })
  const settingsManager = sdk.SettingsManager.inMemory({
    packages: [permissions, subagents, product],
    skills: [],
    themes: [],
    prompts: [],
    cacheWarming: 'off',
    retry: { enabled: false },
    compaction: {
      enabled: !duplicateSummary,
      reserveTokens: duplicateSummary ? 4096 : 24576,
      keepRecentTokens: 128,
    },
  })
  const observerFile = path.join(fixture.directory, 'permission-observer.ts')
  if (denyEpisodeTemp) {
    // The public PSS entry is TS: let Pi's public extension loader handle it,
    // rather than asking Node to strip a dependency's types under node_modules.
    fs.symlinkSync(path.join(product, 'node_modules'), path.join(fixture.directory, 'node_modules'), 'dir')
    fs.writeFileSync(
      observerFile,
      `import { getPermissionsService } from '@gotgenes/pi-permission-system';
export default pi => { pi.on('session_start', (_event, ctx) =>
  pi.events.emit('fixture:compaction-permissions', () => getPermissionsService(ctx.sessionManager.getSessionId()))); };`,
    )
  }
  const loader = new sdk.DefaultResourceLoader({
    cwd: fixture.cwd,
    agentDir: fixture.agentDir,
    settingsManager,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    disabledBuiltinExtensions: ['mcp'],
    systemPromptOverride: () => 'Synthetic offline compaction regression.',
    additionalExtensionPaths: denyEpisodeTemp ? [observerFile] : [],
    extensionFactories: [
      (pi) => {
        if (denyEpisodeTemp)
          pi.events.on('fixture:compaction-permissions', (getService) => {
            serviceForSession = getService
          })
        pi.on('session_start', (_, context) => {
          ctx = context
        })
        pi.on('session_before_compact', (event) => {
          compacting = true
          hooks.push({ type: event.type, reason: event.reason })
        })
        pi.on('session_compact', (event, context) => {
          compacting = false
          compactions++
          hooks.push({
            type: event.type,
            reason: event.reason,
            fromExtension: event.fromExtension,
            eventEntryId: event.compactionEntry.id,
            leafId: context.sessionManager.getBranch().at(-1)?.id,
            branchContains: context.sessionManager
              .getBranch()
              .some((entry) => entry.id === event.compactionEntry.id),
          })
        })
        pi.on('session_compact_failed', (event) => {
          throw Error(`Unexpected compaction failure ${event.reason}`)
        })
        pi.on('agent_before_settle', (event) => hooks.push({ type: event.type, outcome: event.outcome }))
        pi.on('agent_settled', (event) => hooks.push({ type: event.type, aborted: event.aborted }))
      },
    ],
  })
  await loader.reload()
  assert.deepEqual(loader.getExtensions().errors, [])
  manager = sdk.SessionManager.create(fixture.cwd, path.join(fixture.directory, 'sessions'))
  ;({ session } = await sdk.createAgentSession({
    cwd: fixture.cwd,
    agentDir: fixture.agentDir,
    modelRuntime: runtime,
    model: faux.getModel(),
    thinkingLevel: 'off',
    resourceLoader: loader,
    settingsManager,
    sessionManager: manager,
    tools: ['agent_memory_read', 'agent_memory_manage', 'agent_memory_reflect'],
  }))
  fixtures.selectManagedMemoryFixture(manager, fixture.capability)
  await session.bindExtensions({
    onError: (error) => errors.push({ event: error.event, message: error.message }),
  })
  const nodes = globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')]
  const node = nodes.get(session.sessionId)
  assert.equal(node.healthy(), true)
  assert.equal(node.managedMemory.version, 2)
  assert.equal(node.managedMemory.root, fixture.root)
  assert.equal(node.managedMemory.isPrimarySession(ctx), true)
  writerService = node.managedMemory.parentService()
  originalGetAgentType = writerService.getAgentType
  writerService.getAgentType = function (...args) {
    if (args[0] === 'managed-memory-writer') {
      assert.ok(writerAttempts[writerPhase] < 64, 'bounded writer-attempt observer overflow')
      writerAttempts[writerPhase]++
    }
    // Observe real native lookup without changing its outcome or any authority.
    return originalGetAgentType.apply(this, args)
  }
  if (denyEpisodeTemp) {
    permissionService = serviceForSession()
    assert.ok(permissionService)
    originalCheckPermission = permissionService.checkPermission
    permissionService.checkPermission = function (...args) {
      const decision = originalCheckPermission.apply(this, args)
      // Filter before bounding: unrelated root/read checks must not displace
      // the real episode publication decisions. Observe only, never rewrite.
      if (
        args[0] !== 'path_write' ||
        typeof args[1] !== 'string' ||
        !args[1].startsWith(`${fixture.root}/.episodes/`)
      )
        return decision
      if (permissionCalls.length < 2048) {
        permissionCalls.push({
          surface: args[0],
          target: args[1],
          state: decision.state,
          matchedSurface: decision.matchedSurface,
          matchedPattern: decision.matchedPattern,
          source: decision.source,
          origin: decision.origin,
        })
      } else permissionCallOverflow = true
      return decision
    }
  }
  assert.equal(fs.existsSync(fixture.root), false, 'source loading provisions nothing')
  const init = (
    await session.getToolDefinition('agent_memory_manage').execute(
      'synthetic-init',
      {
        action: 'initialize',
        core: '# Core\nSYNTHETIC_COMPACTION_CORE\n',
        projectId: 'synthetic',
        automatic: true,
      },
      undefined,
      undefined,
      ctx,
    )
  ).details
  assert.equal(init.initialized, true)
  assert.equal(fs.existsSync(path.join(fixture.agentDir, 'agents/managed-memory-writer.md')), false)
  const response = (kind, text) => (context) => {
    assert.equal(classify(context), kind, 'response queue position is not request classification')
    return ai.fauxAssistantMessage(text)
  }
  if (duplicateSummary) {
    const summary =
      '## Goal\nSYNTHETIC_IDENTICAL_SUMMARY\n## Progress\nOffline only.\n## Next Steps\nContinue.'
    faux.setResponses([
      response('duplicate-turn', 'Seed one complete.'),
      response('duplicate-turn', 'Tail one complete.'),
      response('duplicate-summary', summary),
      response('duplicate-turn', 'Seed two complete.'),
      response('duplicate-turn', 'Tail two complete.'),
      response('duplicate-summary', summary),
    ])
    let deadline = false
    timer = setTimeout(() => {
      deadline = true
      void session.abort()
    }, 45000)
    let firstBytes
    for (let index = 1; index <= 2; index++) {
      writerPhase = 'continuation'
      await session.prompt(`SYNTHETIC_SEED_${index}`, { source: 'extension' })
      await session.waitForIdle()
      await session.prompt(`SYNTHETIC_TAIL_${index}\n${'T'.repeat(1600)}`, { source: 'extension' })
      await session.waitForIdle()
      writerPhase = 'compaction'
      const result = await session.compact()
      assert.equal(deadline, false)
      assert.equal(result.summary, summary)
      const leaf = manager.getBranch().at(-1)
      assert.equal(leaf.type, 'compaction')
      const id = sha(`${session.sessionId}:compact:${leaf.id}`)
      const files = inventory()
      assert.equal(files.length, index, 'each actual append receives its own canonical episode')
      const saved = files.find((file) => file.name === `${id}.json`)
      assert.ok(saved)
      const episode = JSON.parse(saved.raw)
      assert.equal(episode.id, id)
      assert.equal(episode.kind, 'compaction')
      assert.equal(episode.observedAt, leaf.timestamp)
      assert.deepEqual(episode.compaction, {
        entryId: leaf.id,
        parentId: leaf.parentId,
        firstKeptEntryId: leaf.firstKeptEntryId,
        tokensBefore: leaf.tokensBefore,
        reason: 'manual',
        fromExtension: false,
        willRetry: false,
      })
      assert.equal(episode.entryHash, sha(JSON.stringify(episode.compaction)))
      assert.doesNotMatch(saved.raw, /SYNTHETIC_IDENTICAL_SUMMARY|summary|details|systemMessage/)
      if (index === 1) firstBytes = saved
      else assert.equal(files.find((file) => file.name === firstBytes.name).raw, firstBytes.raw)
    }
    const compactHooks = hooks.filter((event) => event.type === 'session_compact')
    assert.equal(compactHooks.length, 2)
    assert.notEqual(compactHooks[0].leafId, compactHooks[1].leafId)
    assert.equal(
      compactHooks[1].eventEntryId,
      compactHooks[0].eventEntryId,
      'reproduce SDK first-summary lookup',
    )
    assert.notEqual(compactHooks[1].eventEntryId, compactHooks[1].leafId)
    assert.equal(writerAttempts.compaction, 0)
    assert.equal(writerAttempts.continuation, 0)
    assert.deepEqual(writerService.listAgents(), [])
    assert.deepEqual(errors, [])
    assert.equal(externalFetches, 0)
    assert.equal(faux.state.callCount, 6)
    assert.equal(faux.getPendingResponseCount(), 0)
    console.log(
      JSON.stringify({
        actualManualCompactions: compactions,
        duplicateSummaryResolved: true,
        episodes: inventory().length,
        compactionWriterAttempts: writerAttempts.compaction,
        externalFetches,
      }),
    )
  } else {
    faux.setResponses([
      response('positive', 'Synthetic bounded outcome.'),
      response('large', 'A'.repeat(2048)),
      response(
        'history-summary',
        '## Goal\nSYNTHETIC_NATIVE_SUMMARY\n## Progress\nComplete.\n## Next Steps\nContinue.',
      ),
      response(
        'split-summary',
        '## Original Request\nSYNTHETIC_SPLIT_SUMMARY\n## Progress So Far\nComplete.\n## Context Needed to Continue\nContinue offline.',
      ),
      response('first', 'Small continuation.'),
      response('second', 'Second continuation.'),
    ])
    let deadline = false
    timer = setTimeout(() => {
      deadline = true
      void session.abort()
    }, 45000)
    const prompt = async (text, source) => {
      const start = hooks.length
      await session.prompt(text, { source })
      await session.waitForIdle()
      assert.equal(deadline, false)
      const own = hooks.slice(start)
      assert.deepEqual(
        own.filter((event) => event.type === 'agent_before_settle').map((event) => event.outcome),
        ['completed'],
      )
      assert.deepEqual(
        own.filter((event) => event.type === 'agent_settled').map((event) => event.aborted),
        [false],
      )
      assert.equal(session.getLastAssistantText().length > 0, true)
    }
    await prompt(positive, 'rpc')
    const before = inventory()
    if (denyEpisodeTemp) assert.deepEqual(before, [], 'RPC episode temp publication is also denied')
    else {
      assert.equal(before.length, 1, 'real automatic turn admission positive control')
      assert.equal(JSON.parse(before[0].raw).input.source, 'rpc')
    }
    // Covers the entire native threshold lifecycle, including handlers ordered before
    // this fixture's session_compact observer. No fabricated boundary or role required.
    writerPhase = 'compaction'
    await prompt(large, 'extension')
    assert.equal(writerAttempts.compaction, 0, 'compaction must not even look up the writer role')
    if (!denyEpisodeTemp)
      assert.ok(
        writerAttempts.positive > 0,
        'normal RPC turn proves the same observer detects writer attempts',
      )
    const after = inventory()
    assert.equal(compactions, 1)
    const compact = manager.getEntries().find((entry) => entry.type === 'compaction')
    assert.ok(compact)
    assert.notEqual(compact.fromHook, true)
    assert.ok(compact.tokensBefore >= 8192)
    assert.ok(
      hooks.some(
        (event) =>
          event.type === 'session_compact' &&
          event.reason === 'threshold' &&
          event.fromExtension === false &&
          event.branchContains,
      ),
    )
    const compactionId = sha(`${session.sessionId}:compact:${compact.id}`)
    if (denyEpisodeTemp) {
      assert.deepEqual(after, [])
      assert.equal(permissionCallOverflow, false, JSON.stringify(permissionCalls))
      const finalPath = path.join(fixture.root, '.episodes', `${compactionId}.json`)
      const deniedCalls = permissionCalls.filter(
        (call) =>
          call.surface === 'path_write' &&
          typeof call.target === 'string' &&
          call.target.startsWith(`${finalPath}.`) &&
          call.target.endsWith('.tmp'),
      )
      assert.ok(deniedCalls.length > 0, JSON.stringify({ compactionId, permissionCalls }))
      for (const call of deniedCalls) {
        assert.equal(call.state, 'deny', JSON.stringify(call))
        assert.equal(call.matchedSurface, 'path_write', JSON.stringify(call))
        assert.equal(call.matchedPattern, deniedTempPattern, JSON.stringify(call))
        assert.equal(call.source, 'special', JSON.stringify(call))
        assert.equal(call.origin, 'global', JSON.stringify(call))
        assert.equal(fs.existsSync(call.target), false)
      }
      assert.equal(fs.existsSync(finalPath), false)
      const folder = path.join(fixture.root, '.episodes')
      assert.deepEqual(fs.existsSync(folder) ? fs.readdirSync(folder) : [], [])
    } else {
      assert.equal(after.length, 2)
      assert.equal(after.find((file) => file.name === before[0].name).raw, before[0].raw)
      const added = after.find((file) => file.name !== before[0].name)
      const episode = JSON.parse(added.raw)
      assert.equal(episode.id, compactionId)
      assert.equal(episode.kind, 'compaction')
      assert.equal(episode.observedAt, compact.timestamp)
      assert.deepEqual(episode.compaction, {
        entryId: compact.id,
        parentId: compact.parentId,
        firstKeptEntryId: compact.firstKeptEntryId,
        tokensBefore: compact.tokensBefore,
        reason: 'threshold',
        fromExtension: false,
        willRetry: false,
      })
      assert.equal(episode.entryHash, sha(JSON.stringify(episode.compaction)))
      assert.doesNotMatch(
        added.raw,
        /SYNTHETIC_NATIVE_SUMMARY|SYNTHETIC_SPLIT_SUMMARY|summary|systemMessage|input|actions|results|outcome/,
      )
    }
    writerPhase = 'continuation'
    await prompt(first, 'extension')
    await prompt(second, 'extension')
    assert.deepEqual(inventory(), after, 'extension continuations do not backfill or mutate metadata')
    assert.deepEqual(
      requests.map((request) => request.kind),
      ['positive', 'large', 'history-summary', 'split-summary', 'first', 'second'],
    )
    assert.equal(requests.find((request) => request.kind === 'first').checkpoint, true)
    assert.equal(requests.find((request) => request.kind === 'second').checkpoint, false)
    for (const kind of ['first', 'second']) {
      assert.equal(requests.find((request) => request.kind === kind).core, true)
      assert.equal(requests.find((request) => request.kind === kind).wrapper, true)
    }
    assert.equal(faux.state.callCount, 6)
    assert.equal(faux.getPendingResponseCount(), 0)
    assert.deepEqual(node.managedMemory.parentService().listAgents(), [])
    assert.equal(originalGetAgentType.call(writerService, 'managed-memory-writer'), undefined)
    assert.equal(writerAttempts.continuation, 0)
    assert.deepEqual(errors, [])
    assert.equal(externalFetches, 0)
    console.log(
      JSON.stringify({
        genuineAutomaticCompactions: compactions,
        episodes: after.length,
        fauxCalls: faux.state.callCount,
        nativeAgents: 0,
        compactionWriterAttempts: writerAttempts.compaction,
        writerAttempts,
        externalFetches,
        metadataOnly: true,
        ...(denyEpisodeTemp
          ? { deniedEpisodeTemp: true, compactionId, permissionCalls, permissionCallOverflow }
          : {}),
      }),
    )
  }
} finally {
  clearTimeout(timer)
  if (writerService && originalGetAgentType) writerService.getAgentType = originalGetAgentType
  if (permissionService && originalCheckPermission)
    permissionService.checkPermission = originalCheckPermission
  if (session) {
    await session.waitForIdle()
    // Public embedder shutdown, not a fabricated compaction or settlement.
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
    session.dispose()
    assert.equal(
      globalThis[Symbol.for('@mahirocoko/pi-guards:healthy-nodes')]?.has(manager.getSessionId()),
      false,
    )
  }
  process.chdir(previousCwd)
  await fixture?.dispose()
  globalThis.fetch = originalFetch
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, previous)
}
