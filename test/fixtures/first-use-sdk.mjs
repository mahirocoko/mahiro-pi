// First-use integration smoke, not a copied permission resolver or direct execute() harness.
// Only declared public SDK/Faux/PSS packages; all product calls enter native model dispatch.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rootCertificates } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { installRTKHelper } from '../../lib/guards/test/rtk-helper-fixture.mjs'

const product = fileURLToPath(new URL('../..', import.meta.url))
const evidence = path.join(product, '.agent-state/runtime/first-use')
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 })
const runDir = fs.mkdtempSync(path.join(evidence, 'sdk-'))
const disposable = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mahiro-first-use-'))
const home = path.join(disposable, 'home')
const profile = path.join(disposable, 'profile')
const project = path.join(disposable, 'project')
const policyPath = path.join(profile, 'extensions/pi-permission-system/config.json')
const previous = { ...process.env }
const previousCwd = process.cwd()
const originalFetch = globalThis.fetch
const rows = []
const extensionErrors = []
const notifications = []
const registeredTools = new Set()
const exercisedTools = new Set()
let session, faux, sdk, ai, runtime, installedPolicy, fatal
let externalFetches = 0
let toolSequence = 0
let mode = 'installed-named'
const sha = (text) => createHash('sha256').update(text).digest('hex')
const textOf = (result) => result.content.map((part) => part.text ?? '').join('\n')
const save = (name, value) => fs.writeFileSync(path.join(runDir, name), value, { mode: 0o600 })
const record = (row) => {
  rows.push(row)
  fs.appendFileSync(path.join(runDir, 'matrix.jsonl'), `${JSON.stringify(row)}\n`, { mode: 0o600 })
  return row
}
const writePolicy = (policy) => fs.writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 })
const command = (argv, cwd = project) => {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env: process.env,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${argv.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result
}
const inspect = async (id, operation, verify, control = false) => {
  const start = performance.now()
  let value
  try {
    value = await operation()
    await verify?.(value)
    record({
      id,
      mode,
      outcome: control ? 'expected-control' : 'success',
      ms: performance.now() - start,
      value,
    })
  } catch (error) {
    record({
      id,
      mode,
      outcome: 'unexpected',
      // Never relabel an input/fixture bug as a feature false block without reviewing the saved native result.
      classification: value?.isError
        ? 'candidate-feature-block-review-native-result'
        : 'assertion-or-host-failure',
      ms: performance.now() - start,
      error: error.message,
      value,
    })
  }
  return value
}
const call = async (tool, args) => {
  exercisedTools.add(tool)
  const start = session.messages.length
  const callId = `first-use-${++toolSequence}`
  faux.setResponses([
    () => ai.fauxAssistantMessage([ai.fauxToolCall(tool, args, callId)], { stopReason: 'toolUse' }),
    () => ai.fauxAssistantMessage('Synthetic disposable smoke step settled; not human acceptance.'),
  ])
  await session.prompt('Exercise this explicitly requested synthetic fixture operation only.', {
    source: 'extension',
  })
  await session.waitForIdle()
  const result = session.messages
    .slice(start)
    .find((message) => message.role === 'toolResult' && message.toolName === tool)
  assert.ok(result, `${tool}: genuine native toolResult required`)
  assert.equal(faux.getPendingResponseCount(), 0)
  const text = textOf(result)
  let data
  try {
    data = JSON.parse(text)
  } catch {}
  return { tool, args, isError: result.isError === true, text, data }
}
const ok = (result) => {
  assert.equal(result.isError, false, result.text)
  assert.ok(!['blocked', 'denied', 'error', 'unavailable'].includes(result.data?.status), result.text)
}
// Match the observed owner/PSS rejection, not just any native execution error.
const denied = (message) => (result) => {
  assert.equal(result.isError, true, result.text)
  assert.equal(result.text, message)
}
const memoryDenied = denied(
  'Managed memory unavailable: valid arguments, scope, CAS, separate permission and healthy native binding required (reason: unknown)',
)
const rtkDenied = denied('RTK original/final Bash permission required')
const step = (id, tool, args, verify = ok, control = false) =>
  inspect(id, () => call(tool, args), verify, control)
const close = async () => {
  if (!session) return
  await session.waitForIdle()
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
  session.dispose()
  session = undefined
}
const open = async () => {
  const settingsManager = sdk.SettingsManager.inMemory({
    ...JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')),
    skills: [],
    themes: [],
    prompts: [],
    cacheWarming: 'off',
    retry: { enabled: false },
    compaction: { enabled: false },
  })
  const loader = new sdk.DefaultResourceLoader({
    cwd: project,
    agentDir: profile,
    settingsManager,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    disabledBuiltinExtensions: ['mcp'],
    systemPromptOverride: () =>
      'Offline synthetic public-host first-use exercise. No human preference is implied.',
    extensionFactories: [
      (pi) => {
        pi.on('session_start', (_event, ctx) => {
          // A headless UI notification sink only: do not set hasUI or confirm human gates.
          ctx.ui.notify = (text, level) => notifications.push({ mode, text, level })
        })
      },
    ],
  })
  await loader.reload()
  assert.deepEqual(loader.getExtensions().errors, [])
  const manifest = JSON.parse(fs.readFileSync(path.join(product, 'package.json'), 'utf8')).pi.extensions
  const loaded = loader.getExtensions().extensions.map((extension) => extension.path)
  assert.equal(manifest.length, 13)
  for (const entry of manifest)
    assert.equal(loaded.filter((entryPath) => entryPath === path.join(product, entry)).length, 1, entry)
  const created = await sdk.createAgentSession({
    cwd: project,
    agentDir: profile,
    modelRuntime: runtime,
    model: faux.getModel(),
    thinkingLevel: 'off',
    resourceLoader: loader,
    settingsManager,
    sessionManager: sdk.SessionManager.create(project, path.join(disposable, 'sessions')),
  })
  session = created.session
  for (const name of session.getActiveToolNames()) registeredTools.add(name)
  await session.bindExtensions({
    onError: (error) => extensionErrors.push({ event: error.event, message: error.message }),
  })
  save(
    `loaded-${mode}.json`,
    JSON.stringify({ extensions: loaded, tools: session.getActiveToolNames() }, null, 2),
  )
}
try {
  for (const key of Object.keys(process.env))
    if (/^(GIT_|PI_|MAHIRO_)/.test(key) || /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key))
      delete process.env[key]
  for (const directory of [home, profile, project]) fs.mkdirSync(directory, { mode: 0o700 })
  Object.assign(process.env, {
    HOME: home,
    PI_CODING_AGENT_DIR: profile,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: disposable,
    GIT_TERMINAL_PROMPT: '0',
  })
  fs.writeFileSync(
    path.join(home, '.gitconfig'),
    '[user]\n name = First Use Fixture\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
    { mode: 0o600 },
  )
  process.chdir(project)
  globalThis.fetch = () => {
    externalFetches++
    throw Error('External fetch forbidden in first-use fixture')
  }
  // Actual supported installer, no direct memory store initialization or forged readiness.
  const install = (args) =>
    command([process.execPath, path.join(product, 'install.mjs'), '--agent-dir', profile, ...args])
  save('install-preview.log', install(['--preview']).stdout)
  assert.equal(fs.existsSync(path.join(profile, 'memory')), false)
  save('install-apply.log', install([]).stdout)
  installedPolicy = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
  save('installed-policy.json', JSON.stringify(installedPolicy, null, 2))
  record({
    id: 'install.preview-apply',
    mode,
    outcome: 'success',
    value: {
      status: 'completed',
      profile: 'disposable',
      memoryEngine: JSON.parse(fs.readFileSync(path.join(profile, '.mahiro-memory-engine.json'), 'utf8'))
        .version,
    },
  })
  command(['/usr/bin/git', 'init'])
  fs.writeFileSync(path.join(project, 'safe.txt'), 'SYNTHETIC_SAFE\n')
  command(['/usr/bin/git', 'add', 'safe.txt'])
  command(['/usr/bin/git', 'commit', '-m', 'Synthetic disposable baseline'])
  fs.appendFileSync(path.join(project, 'safe.txt'), 'SYNTHETIC_CHANGE\n')
  fs.writeFileSync(path.join(project, '.env'), 'SYNTHETIC_CANARY=not-a-secret\n', { mode: 0o600 })
  // The installer intentionally grants no generic file/Bash authority. Explicit test-only
  // authorizations below exercise ordinary native execution; never alter the installed original.
  const explicit = {
    ...installedPolicy,
    yoloMode: false,
    authorizerChain: [],
    permission: {
      ...installedPolicy.permission,
      read: 'allow',
      write: 'allow',
      edit: 'allow',
      grep: 'allow',
      find: 'allow',
      ls: 'allow',
      mh_npm_config: 'allow',
      mh_env_config: 'allow',
      mh_pypi_config: 'allow',
      mh_certificate_info: 'allow',
      path_read: { '*': 'allow', [path.join(project, '.env')]: 'deny' },
      path_write: { '*': 'allow' },
      bash: { '*': 'allow' },
    },
  }
  writePolicy(explicit)
  sdk = await import('@earendil-works/pi-coding-agent')
  ai = await import('@earendil-works/pi-ai')
  runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  faux = ai.fauxProvider({
    // Match the installed canonical writer route with simulated transport only.
    // No writer is spawned, no provider credential is configured or requested.
    provider: 'openai',
    models: [{ id: 'gpt-6.1-sol', reasoning: true, contextWindow: 262144, maxTokens: 4096 }],
  })
  runtime.registerNativeProvider(faux.provider)
  await runtime.refresh({ allowNetwork: false })
  await open()
  for (const [id, tool, args] of [
    ['native.read', 'read', { path: 'safe.txt' }],
    ['native.write', 'write', { path: 'scratch.txt', content: 'ONE\n' }],
    ['native.edit', 'edit', { path: 'scratch.txt', oldText: 'ONE', newText: 'TWO' }],
    ['native.grep', 'grep', { pattern: 'SYNTHETIC_SAFE', path: 'safe.txt' }],
    ['native.find', 'find', { pattern: 'safe.txt', path: '.' }],
    ['native.ls', 'ls', { path: '.' }],
    ['memory.status', 'agent_memory_manage', { action: 'status' }],
    ['memory.list', 'agent_memory_read', {}],
    ['memory.core', 'agent_memory_read', { path: 'Core.md' }],
    ['memory.doctor', 'agent_memory_manage', { action: 'doctor' }],
    ['memory.palace', 'agent_memory_manage', { action: 'palace' }],
    ['memory.init-project', 'agent_memory_manage', { action: 'init-project' }],
    ['memory.search-empty', 'agent_memory_read', { query: 'SYNTHETIC_FIRST_USE_NOTE' }],
    ['memory.topics', 'agent_memory_read', { topic: '*', limit: 4 }],
    ['recall.empty-search', 'recall_search', { query: 'SYNTHETIC_ABSENT', crossProject: true }],
    ['goal.empty', 'mh_get_goal', {}],
    ['evidence.empty', 'mh_code_evidence', { action: 'get' }],
    ['ux.empty', 'mh_get_ux_workflow', {}],
    ['run.empty', 'mh_execution_run', { operation: 'get' }],
    ['tasks.empty', 'mh_task_list', {}],
    ['rtk.status', 'mh_rtk', { operation: 'status' }],
  ])
    await step(id, tool, args)
  await step('recall.absent-record', 'recall_read', { recordId: 'SYNTHETIC_ABSENT' }, (result) => {
    ok(result)
    assert.equal(result.data.unavailable, true)
  })
  // Filtered inspectors read only newly authored synthetic fixtures. The certificate
  // is a public Node TLS trust-bundle entry, never a host key, profile or credential.
  fs.writeFileSync(
    path.join(project, '.npmrc'),
    'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=SYNTHETIC_NPM_VALUE\n',
    { mode: 0o600 },
  )
  fs.writeFileSync(path.join(project, '.env.fixture'), 'SYNTHETIC_KEY=SYNTHETIC_ENV_VALUE\n', { mode: 0o600 })
  fs.writeFileSync(
    path.join(project, '.pypirc'),
    '[pypi]\nrepository=https://upload.pypi.org/legacy/\nusername=__token__\npassword=SYNTHETIC_PYPI_VALUE\n',
    { mode: 0o600 },
  )
  fs.writeFileSync(path.join(project, 'public-certificate.pem'), rootCertificates[0], { mode: 0o600 })
  for (const [tool, file] of [
    ['mh_npm_config', '.npmrc'],
    ['mh_env_config', '.env.fixture'],
    ['mh_pypi_config', '.pypirc'],
    ['mh_certificate_info', 'public-certificate.pem'],
  ]) {
    await step(`filtered.${tool}`, tool, { path: file }, (result) => {
      ok(result)
      assert.equal(result.data.status, 'success', result.text)
      assert.doesNotMatch(result.text, /SYNTHETIC_(?:NPM|ENV|PYPI)_VALUE|BEGIN CERTIFICATE/)
    })
  }
  // Safe metadata-only Code Map must work from the installer's own named grant,
  // without the fixture repairing a first-use omission in public policy.
  await step('code-map.installed-grant', 'mh_code_map', {
    intent: 'exact',
    query: 'synthetic',
    path_hints: ['safe.txt'],
  })
  // Verify content, not merely the absence of a native error.
  const snapshot = await step('memory.draft-base', 'agent_memory_read', {})
  await step('memory.edit-draft', 'agent_memory_edit', {
    path: 'procedures/smoke.md',
    expectedHash: null,
    text: '# Smoke\nSYNTHETIC_DRAFT_CONTENT\n',
    sources: [],
  })
  if (snapshot?.data?.revision)
    await step('memory.commit-draft', 'agent_memory_commit', { revision: snapshot.data.revision })
  await step('memory.read-committed', 'agent_memory_read', { path: 'procedures/smoke.md' }, (result) => {
    ok(result)
    assert.match(result.text, /SYNTHETIC_DRAFT_CONTENT/)
  })

  const task = await step('tasks.create', 'mh_task_create', {
    subject: 'Synthetic fixture step',
    description: 'No real task-board mutation.',
  })
  const taskId = task?.data?.task?.id ?? task?.data?.id
  if (taskId) {
    const current = await step('tasks.get', 'mh_task_get', { id: taskId })
    const revision = current?.data?.task?.revision ?? current?.data?.revision
    if (revision) {
      const updated = await step('tasks.update', 'mh_task_update', {
        id: taskId,
        expected_revision: revision,
        status: 'in_progress',
      })
      await step(
        'tasks.stale-revision',
        'mh_task_update',
        { id: taskId, expected_revision: revision, status: 'completed' },
        denied('Read the latest task revision before updating.'),
        true,
      )
      await step('tasks.after-stale-revision', 'mh_task_get', { id: taskId }, (result) => {
        ok(result)
        for (const field of [
          'id',
          'revision',
          'subject',
          'description',
          'owner',
          'metadata',
          'blockedBy',
          'status',
          'completedTurn',
          'blocks',
          'open_blockers',
        ])
          assert.deepEqual(result.data[field], updated.data[field], `Task state changed: ${field}`)
      })
    }
  }
  await step('goal.create', 'mh_create_goal', {
    objective: 'Synthetic first-use metadata only',
    criteria: [
      { text: 'Observe the fixture result', owner: 'agent' },
      { text: 'Human product acceptance remains unclaimed', owner: 'human' },
    ],
  })
  let goal = await step('goal.read-created', 'mh_get_goal', {})
  let revision = goal?.data?.goal?.revision
  if (revision) {
    const updated = await step('goal.update', 'mh_update_goal', {
      action: 'set_phase',
      expected_revision: revision,
      phase: 'fixture-verification',
    })
    await step(
      'goal.stale-revision',
      'mh_update_goal',
      { action: 'set_phase', expected_revision: revision, phase: 'stale-write' },
      // The successful mutation consumed the read binding; that gate precedes revision validation.
      denied('Read mh_get_goal in this native context before mutating'),
      true,
    )
    goal = await step('goal.read-before-human-gate', 'mh_get_goal', {}, (result) => {
      ok(result)
      assert.deepEqual(result.data.goal, updated.data.goal)
    })
    revision = goal?.data?.goal?.revision
    if (revision) {
      await step(
        'goal.clear-no-ui',
        'mh_clear_goal',
        { expected_revision: revision },
        denied('Goal human mutation requires public UI confirmation; no UI means no write'),
        true,
      )
      await step('goal.after-human-gate', 'mh_get_goal', {}, (result) => {
        ok(result)
        assert.deepEqual(result.data.goal, goal.data.goal)
      })
    }
  }
  await step('ux.create', 'mh_create_ux_workflow', {
    summary: 'Synthetic UX metadata, no product acceptance',
  })
  const ux = await step('ux.read-created', 'mh_get_ux_workflow', {})
  const uxRevision = ux?.data?.workflow?.revision ?? ux?.data?.run?.revision
  if (uxRevision)
    await step('ux.update-frame', 'mh_update_ux_workflow', {
      action: 'set_frame',
      expected_revision: uxRevision,
      problem: 'Exercise synthetic metadata',
      audience: 'Fixture',
      desired_outcome: 'Read back revision',
      constraints: [],
    })
  await step('run.create', 'mh_execution_run', {
    operation: 'create',
    summary: 'Synthetic coordination only',
    acceptance_criteria: ['Inspect fixture metadata'],
    non_goals: ['Execute workers'],
    protected_contracts: ['No live inference'],
    open_questions: [],
    suggested_checks: ['Inspect native result'],
    worktree_refs: ['fixture'],
    targets: [
      {
        id: 'scratch',
        path: 'scratch.txt',
        intent: 'Disposable test target',
        worktree_ref: 'fixture',
        access: 'read',
        writer_lane_id: null,
        reader_lane_ids: [],
      },
    ],
  })
  const run = await step('run.read-created', 'mh_execution_run', { operation: 'get' })
  const runValue = run?.data?.run
  if (runValue)
    await step('run.add-lane', 'mh_execution_run', {
      operation: 'update',
      action: 'add_lane',
      expected_run_id: runValue.id,
      expected_revision: runValue.revision,
      lane_id: 'verify',
      required: false,
      executor_kind: 'main_agent',
      role: 'verify',
      summary: 'Metadata only',
      worktree_ref: 'fixture',
    })
  // Evidence collection respects path denials, even for synthetic secrets. Then remove
  // only the fixture canary to permit full ordinary collection; never relax the deny.
  await step(
    'evidence.denied-source',
    'mh_code_evidence',
    { action: 'collect', workspace: project },
    denied('Evidence source read path denied'),
    true,
  )
  assert.equal(fs.readFileSync(path.join(project, '.env'), 'utf8'), 'SYNTHETIC_CANARY=not-a-secret\n')
  fs.unlinkSync(path.join(project, '.env'))
  const collected = await step('evidence.collect', 'mh_code_evidence', {
    action: 'collect',
    workspace: project,
  })
  const report = collected?.data?.report ?? collected?.data
  if (report)
    await step('evidence.record', 'mh_code_evidence', {
      action: 'record',
      workspace: project,
      expected_revision: report.revision,
      kind: 'test',
      result: 'observed',
      summary: 'Fixture native write/edit read back',
      command: 'descriptive-only',
    })

  // Public PSS explicit denial controls, re-read by the real service on native dispatch.
  writePolicy({ ...explicit, permission: { ...explicit.permission, mh_get_goal: 'deny' } })
  // PSS hides explicitly denied tools from native dispatch; the host reports them as not found.
  await step('pss.tool-deny', 'mh_get_goal', {}, denied('Tool mh_get_goal not found'), true)
  writePolicy({ ...explicit, permission: { ...explicit.permission, mh_code_map: 'deny' } })
  await step(
    'pss.code-map-deny',
    'mh_code_map',
    { intent: 'exact', query: 'synthetic' },
    denied('Tool mh_code_map not found'),
    true,
  )
  writePolicy(explicit)
  const memoryCapability = `managed_memory_${sha(path.join(profile, 'memory'))}`
  writePolicy({ ...explicit, permission: { ...explicit.permission, [memoryCapability]: 'deny' } })
  await step('pss.memory-exact-root-deny', 'agent_memory_read', { path: 'Core.md' }, memoryDenied, true)
  writePolicy(explicit)
  fs.writeFileSync(path.join(project, '.env'), 'SYNTHETIC_CANARY=not-a-secret\n', { mode: 0o600 })
  await step(
    'pss.file-deny',
    'read',
    { path: '.env' },
    denied(
      `[pi-permission-system] Denied by policy: 'path_read' for tool 'read' for path '.env' (rule '${path.join(project, '.env')}').`,
    ),
    true,
  )
  assert.equal(fs.readFileSync(path.join(project, '.env'), 'utf8'), 'SYNTHETIC_CANARY=not-a-secret\n')
  fs.unlinkSync(path.join(project, '.env'))
  await step('pss.memory-restored', 'agent_memory_read', { path: 'Core.md' })
  await step('pss.tool-restored', 'mh_get_goal', {})
  await step('pss.code-map-restored', 'mh_code_map', { intent: 'exact', query: 'synthetic' })

  const helper = installRTKHelper(disposable)
  process.env.PATH = `${helper.bin}:${previous.PATH}`
  helper.set({ out: 'rtk ls safe.txt\n' })
  await step('rtk.rewrite-preview', 'mh_rtk', { operation: 'rewrite', command: 'ls safe.txt' })
  const beforeRewrite = helper.spawns().length
  await step('rtk.native-rewrite', 'bash', { command: 'ls safe.txt' }, (result) => {
    ok(result)
    assert.match(result.text, /FAKE_RTK_NATIVE/)
    assert.equal(helper.spawns().length, beforeRewrite + 1)
  })
  const beforeDeniedOriginal = helper.calls().length
  writePolicy({
    ...explicit,
    permission: { ...explicit.permission, bash: { '*': 'allow', 'ls safe.txt': 'deny' } },
  })
  await step(
    'rtk.original-denied',
    'bash',
    { command: 'ls safe.txt' },
    (result) => {
      denied("[pi-permission-system] Denied by policy: 'bash' (rule 'ls safe.txt').")(result)
      assert.equal(helper.calls().length, beforeDeniedOriginal)
    },
    true,
  )
  writePolicy({
    ...explicit,
    permission: { ...explicit.permission, bash: { '*': 'allow', 'rtk ls safe.txt': 'deny' } },
  })
  const beforeDeniedCandidate = helper.spawns().length
  await step(
    'rtk.candidate-denied',
    'bash',
    { command: 'ls safe.txt' },
    (result) => {
      rtkDenied(result)
      assert.equal(helper.spawns().length, beforeDeniedCandidate)
    },
    true,
  )
  // Exercise the real sanitizer's final-command recheck, not just RTK's candidate
  // check. The proposal is allowed; only its attribution-stripped final form is denied.
  helper.set({ out: "git commit -m 'Co-Authored-By: Letta Code <noreply@letta.com>'\n" })
  const headBefore = command(['/usr/bin/git', 'rev-parse', 'HEAD']).stdout
  const callsBeforeFinal = helper.calls().length
  const spawnsBeforeFinal = helper.spawns().length
  writePolicy({
    ...explicit,
    permission: { ...explicit.permission, bash: { '*': 'allow', "git commit -m ''": 'deny' } },
  })
  await step(
    'rtk.sanitized-final-denied',
    'bash',
    { command: 'ls safe.txt' },
    (result) => {
      rtkDenied(result)
      assert.equal(helper.calls().length, callsBeforeFinal + 1)
      assert.equal(helper.spawns().length, spawnsBeforeFinal)
      assert.equal(command(['/usr/bin/git', 'rev-parse', 'HEAD']).stdout, headBefore)
    },
    true,
  )
  writePolicy(explicit)
  helper.set({ code: 1 })
  await step('rtk.original-fallback', 'bash', { command: 'printf SYNTHETIC_ORIGINAL' }, (result) => {
    ok(result)
    assert.match(result.text, /SYNTHETIC_ORIGINAL/)
  })
  save('rtk-transport.json', JSON.stringify({ resolver: helper.calls(), native: helper.spawns() }, null, 2))
  // Headless slash-command dispatch exercises owner paths without claiming UI acceptance.
  for (const slash of [
    '/mh-memory status',
    '/mh-rtk status',
    '/mh-goal status',
    '/mh-evidence status',
    '/mh-ux status',
    '/mh-run status',
    '/mh-copy-code',
    '/mh-queue',
    '/mh-todos',
    '/mh-ui',
    '/mh-usage',
    '/mh',
  ]) {
    await inspect(`command.${slash.slice(1).replaceAll(' ', '-')}`, async () => {
      const before = faux.state.callCount
      await session.prompt(slash)
      assert.equal(faux.state.callCount, before, 'slash command must not trigger inference')
      return { notifications: notifications.slice(-1) }
    })
  }
  // Keep this mutation last in the owner generation so a failure cannot turn
  // unrelated memory/permission tests into spurious downstream false blocks.
  const remembered = await step('memory.remember', 'agent_memory_manage', {
    action: 'remember',
    text: 'SYNTHETIC_FIRST_USE_NOTE: disposable fixture only.',
  })
  if (!remembered?.isError) {
    await step('memory.remember-read', 'agent_memory_read', { path: 'system/human/notes.md' }, (result) => {
      ok(result)
      assert.match(result.text, /SYNTHETIC_FIRST_USE_NOTE/)
    })
    await step(
      'memory.remember-search',
      'agent_memory_read',
      { query: 'SYNTHETIC_FIRST_USE_NOTE' },
      (result) => {
        ok(result)
        assert.ok(result.data.results.length > 0)
      },
    )
  } else {
    await step('memory.after-failed-remember-core', 'agent_memory_read', { path: 'Core.md' })
  }
  await close()
  for (const policyMode of ['wildcard', 'yolo']) {
    mode = policyMode
    writePolicy({
      yoloMode: policyMode === 'yolo',
      authorizerChain: [],
      permission: policyMode === 'wildcard' ? { '*': 'allow' } : {},
    })
    await open()
    for (const [tool, args] of [
      ['mh_get_goal', {}],
      ['mh_code_evidence', { action: 'get' }],
      ['mh_get_ux_workflow', {}],
      ['mh_execution_run', { operation: 'get' }],
      ['mh_code_map', { intent: 'outline', query: 'fixture' }],
      ['mh_rtk', { operation: 'status' }],
      ['mh_task_list', {}],
    ])
      await step(`${policyMode}.${tool}`, tool, args)
    await step(`${policyMode}.goal-create`, 'mh_create_goal', {
      objective: 'Synthetic ordinary-permission creation',
      criteria: [{ text: 'Metadata persisted', owner: 'agent' }],
    })
    await step(`${policyMode}.ux-create`, 'mh_create_ux_workflow', {
      summary: 'Synthetic ordinary-permission UX creation',
    })
    // Maintained private memory deliberately has stricter exact-root authority.
    await step(
      `${policyMode}.memory-no-exact-root`,
      'agent_memory_read',
      { path: 'Core.md' },
      memoryDenied,
      true,
    )
    await close()
  }
  assert.deepEqual(extensionErrors, [])
  assert.equal(externalFetches, 0)
} catch (error) {
  fatal = { message: error.message, stack: error.stack }
} finally {
  try {
    await close()
  } catch (error) {
    fatal ??= { message: error.message, stack: error.stack }
  }
  save('notifications.json', JSON.stringify(notifications, null, 2))
  save('extension-errors.json', JSON.stringify(extensionErrors, null, 2))
  process.chdir(previousCwd)
  fs.rmSync(disposable, { recursive: true, force: true })
  globalThis.fetch = originalFetch
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, previous)
  const summary = {
    evidence: path.relative(product, runDir),
    fatal: fatal ?? null,
    externalFetches,
    fauxCalls: faux?.state.callCount ?? 0,
    successes: rows.filter((row) => row.outcome === 'success').length,
    controls: rows.filter((row) => row.outcome === 'expected-control').length,
    controlIds: rows.filter((row) => row.outcome === 'expected-control').map((row) => row.id),
    coverage: {
      registered: [...registeredTools].sort(),
      exercised: [...exercisedTools].sort(),
      notExercised: [...registeredTools].filter((tool) => !exercisedTools.has(tool)).sort(),
    },
    unexpected: rows.filter((row) => row.outcome === 'unexpected'),
    limitations: [
      'Offline Faux only; no live provider',
      'No rendered TUI, clipboard, theme/voice/Herdr or human acceptance',
      'No worker/reflector spawn, real memory, profile or permission-policy changes',
      'Installer child uses its own guarded offline Faux initialization',
    ],
  }
  save('summary.json', JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary))
  if (fatal) process.exitCode = 1
}
