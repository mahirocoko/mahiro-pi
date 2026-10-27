// Real public SDK/Faux/PSS dispatch in an installed disposable profile, including native children.
// No direct execute(), synthetic identity, copied policy resolver or private-runtime package supply.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const product = fileURLToPath(new URL('../..', import.meta.url))
const evidence = path.join(product, '.agent-state/runtime/first-use-workers')
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 })
const runDir = fs.mkdtempSync(path.join(evidence, 'sdk-'))
const disposable = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mahiro-first-use-workers-'))
const home = path.join(disposable, 'home')
const profile = path.join(disposable, 'profile')
const project = path.join(disposable, 'project')
const root = path.join(profile, 'memory')
const policyPath = path.join(profile, 'extensions/pi-permission-system/config.json')
const previous = { ...process.env }
const previousCwd = process.cwd()
const originalFetch = globalThis.fetch
const rows = [],
  notifications = [],
  extensionErrors = [],
  childRequests = [],
  events = []
const exercisedTools = new Set()
const releases = new Set()
let session, faux, workerFaux, writerFaux, ai, sdk, service, fatal, policy
const cleanup = { budgetMs: 10000, status: 'pending', disposableRemoved: false }
const ownershipArg = process.argv.indexOf('--ownership-file')
if (ownershipArg !== -1)
  fs.writeFileSync(process.argv[ownershipArg + 1], JSON.stringify({ pid: process.pid, disposable, runDir }), {
    mode: 0o600,
  })
let interceptedFetchCalls = 0,
  sequence = 0,
  reflectionPublished = false,
  steeringObserved = false
const save = (name, value) => fs.writeFileSync(path.join(runDir, name), value, { mode: 0o600 })
const record = (row) => {
  rows.push(row)
  fs.appendFileSync(path.join(runDir, 'matrix.jsonl'), `${JSON.stringify(row)}\n`, { mode: 0o600 })
}
const textOf = (result) => result.content.map((part) => part.text ?? '').join('\n')
const dataOf = (result) => {
  try {
    return JSON.parse(textOf(result))
  } catch {
    return undefined
  }
}
const writePolicy = (value = policy) => fs.writeFileSync(policyPath, JSON.stringify(value), { mode: 0o600 })
const command = (argv) => {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: project,
    env: process.env,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${argv.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}
const inspect = async (id, operation, verify, control = false, successOutcome = 'success') => {
  const start = performance.now()
  let value
  try {
    value = await operation()
    await verify?.(value)
    record({
      id,
      outcome: control ? 'expected-control' : successOutcome,
      ms: performance.now() - start,
      value,
    })
  } catch (error) {
    record({ id, outcome: 'unexpected', ms: performance.now() - start, error: error.message, value })
  }
  return value
}
const call = async (tool, args) => {
  await session.waitForIdle()
  exercisedTools.add(tool)
  const start = session.messages.length
  const id = `first-use-workers-${++sequence}`
  faux.setResponses([
    () => ai.fauxAssistantMessage([ai.fauxToolCall(tool, args, { id })], { stopReason: 'toolUse' }),
    () => ai.fauxAssistantMessage('Synthetic fixture step settled, not human acceptance.'),
  ])
  await session.prompt('Exercise only the explicitly requested disposable synthetic operation.', {
    source: 'extension',
  })
  await session.waitForIdle()
  const result = session.messages
    .slice(start)
    .find(
      (message) => message.role === 'toolResult' && message.toolName === tool && message.toolCallId === id,
    )
  assert.ok(result, `${tool}: native toolResult required`)
  assert.equal(faux.getPendingResponseCount(), 0)
  return {
    tool,
    args,
    isError: result.isError === true,
    text: textOf(result),
    data: dataOf(result),
    details: result.details,
  }
}
const ok = (value) => assert.equal(value.isError, false, value.text)
const denied = (message) => (value) => {
  assert.equal(value.isError, true, value.text)
  assert.equal(value.text, message)
}
const step = (id, tool, args, verify = ok, control = false) =>
  inspect(id, () => call(tool, args), verify, control)
const until = async (predicate, label) => {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await delay(20)
  }
  throw Error(`Timed out: ${label}`)
}
const terminal = async (id) =>
  until(() => {
    const value = service.getRecord(id)
    return value && !['running', 'queued'].includes(value.status) ? value : undefined
  }, `native child ${id} settlement`)
const gate = () => {
  let release, entered
  const ready = new Promise((resolve) => {
    entered = resolve
  })
  const pending = new Promise((resolve) => {
    release = resolve
  })
  releases.add(release)
  return { ready, entered, release, pending }
}
const toolMessage = (name, args) =>
  ai.fauxAssistantMessage([ai.fauxToolCall(name, args)], {
    stopReason: 'toolUse',
  })
const summarizeRequest = (kind, context, model) => {
  const tools = context.messages.filter((message) => message.role === 'toolResult')
  childRequests.push({
    kind,
    model: `${model.provider}/${model.id}`,
    system: context.messages.filter((message) => message.role === 'system'),
    tools: tools.map((message) => ({
      tool: message.toolName,
      isError: message.isError === true,
      text: textOf(message),
    })),
    users: context.messages.filter((message) => message.role === 'user'),
  })
  return tools
}
const scriptWorker = (firstGate) => {
  workerFaux.setResponses(
    Array.from({ length: 12 }, () => async (context, _options, _state, model) => {
      const results = summarizeRequest('worker', context, model)
      if (firstGate && !firstGate.used) {
        firstGate.used = true
        firstGate.entered()
        await firstGate.pending
        return ai.fauxAssistantMessage('Synthetic first response before queued steering.')
      }
      if (firstGate) {
        steeringObserved ||= JSON.stringify(context.messages).includes('SYNTHETIC_STEER_TOKEN')
        return ai.fauxAssistantMessage('SYNTHETIC_STEER_COMPLETE')
      }
      if (!results.length) return toolMessage('read', { path: 'safe.txt' })
      assert.equal(results.at(-1).isError, false, textOf(results.at(-1)))
      assert.match(textOf(results.at(-1)), /SYNTHETIC_WORKER_SAFE/)
      return ai.fauxAssistantMessage('SYNTHETIC_WORKER_COMPLETE')
    }),
  )
}
const scriptWriter = (target, firstGate, expectDenied = false) => {
  writerFaux.setResponses(
    Array.from({ length: 10 }, () => async (context, _options, _state, model) => {
      const results = summarizeRequest('writer', context, model)
      assert.equal(`${model.provider}/${model.id}`, 'openai/gpt-6.1-sol')
      if (firstGate && !firstGate.used) {
        firstGate.used = true
        firstGate.entered()
        await firstGate.pending
      }
      if (!results.length) return toolMessage('agent_memory_read', { path: 'Core.md' })
      if (results.length === 1) {
        assert.equal(results[0].isError, false, textOf(results[0]))
        return toolMessage('agent_memory_edit', {
          path: target,
          expectedHash: null,
          text: '# Synthetic worker method\nSYNTHETIC_REFLECTION_PUBLISHED\n',
          sources: [],
        })
      }
      if (results.length === 2) {
        if (expectDenied) {
          assert.equal(results[1].isError, true, textOf(results[1]))
          return ai.fauxAssistantMessage('Synthetic denied proposal was not marked ready or published.')
        }
        assert.equal(results[1].isError, false, textOf(results[1]))
        return toolMessage('agent_memory_commit', { revision: dataOf(results[0]).baseRevision })
      }
      assert.ok(
        results.every((result) => !result.isError),
        JSON.stringify(results),
      )
      return ai.fauxAssistantMessage('Synthetic draft ready; parent publication is a separate boundary.')
    }),
  )
}
const reflectSettled = async (id) => {
  const native = await terminal(id)
  // Native completion is not publication: wait for the owner's asynchronous integration too.
  let status
  await until(async () => {
    // A new primary model prompt intentionally cancels background reflection. Poll the public
    // status slash command instead: it does not admit a new input or forge an execution context.
    const start = notifications.length
    await session.prompt('/mh-memory status')
    const text = notifications.slice(start).at(-1)?.text
    status = text ? JSON.parse(text) : undefined
    return status?.worker === 'idle'
  }, `memory job ${id} retirement`)
  return { native, status }
}
const slash = (command, verify, { control = false, noop = false } = {}) =>
  inspect(
    `command.${command.slice(1).replaceAll(' ', '-')}`,
    async () => {
      const before = faux.state.callCount
      const errorsBefore = extensionErrors.length
      const noteStart = notifications.length
      await session.prompt(command)
      await session.waitForIdle()
      assert.equal(faux.state.callCount, before, 'slash command must not invoke the parent model')
      assert.equal(extensionErrors.length, errorsBefore, 'command handler must not throw')
      const observed = notifications.slice(noteStart)
      assert.ok(
        observed.every((item) => item.level !== 'error'),
        JSON.stringify(observed),
      )
      if (!control)
        assert.ok(
          observed.every((item) => item.level === 'info'),
          JSON.stringify(observed),
        )
      assert.equal(typeof verify, 'function', 'Each command needs an explicit branch verifier')
      return {
        dispatch: 'handled-without-inference',
        verification: noop ? 'headless-noop' : control ? 'expected-validation' : 'semantic-output',
        notifications: observed,
      }
    },
    verify,
    control,
    noop ? 'verified-headless-noop' : 'success',
  )
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
    '[user]\n name = Synthetic Workers\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
    { mode: 0o600 },
  )
  process.chdir(project)
  globalThis.fetch = () => {
    interceptedFetchCalls++
    throw Error('External fetch forbidden in worker fixture')
  }
  save('install.log', command([process.execPath, path.join(product, 'install.mjs'), '--agent-dir', profile]))
  fs.writeFileSync(path.join(project, 'safe.txt'), 'SYNTHETIC_WORKER_SAFE\n', { mode: 0o600 })
  fs.writeFileSync(
    path.join(profile, 'agents/fixture-worker.md'),
    '---\nname: fixture-worker\nmodel: openai/fixture-worker\nthinking: off\ntools: read\nmax_turns: 4\nprompt_mode: replace\n---\nSynthetic disposable read-only worker. No real human preferences.\n',
    { mode: 0o600 },
  )
  const installedPolicy = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
  // Installer grants no generic worker/file authority. These are explicit fixture-only grants,
  // not a first-use omission repair; retain the installed exact-root DATA grant and all role locks.
  policy = {
    ...installedPolicy,
    yoloMode: false,
    authorizerChain: [],
    permission: {
      ...installedPolicy.permission,
      subagent: 'allow',
      get_subagent_result: 'allow',
      steer_subagent: 'allow',
      read: 'allow',
      path_read: { '*': 'allow' },
    },
  }
  writePolicy()
  sdk = await import('@earendil-works/pi-coding-agent')
  ai = await import('@earendil-works/pi-ai')
  const handles = ['fixture-parent', 'fixture-worker', 'gpt-6.1-sol'].map((id) =>
    ai.fauxProvider({
      provider: 'openai',
      models: [{ id, reasoning: true, contextWindow: 262144, maxTokens: 4096 }],
    }),
  )
  ;[faux, workerFaux, writerFaux] = handles
  const transport = (method, model, ...args) => {
    const handle = handles.find((handle) => handle.getModel().id === model.id)
    assert.ok(handle, `No live model fallback: ${model.provider}/${model.id}`)
    return handle.provider[method](model, ...args)
  }
  const provider = {
    id: 'openai',
    name: 'Disposable Faux transport only',
    auth: faux.provider.auth,
    getModels: () => handles.flatMap((handle) => handle.provider.getModels()),
    stream: (...args) => transport('stream', ...args),
    streamSimple: (...args) => transport('streamSimple', ...args),
  }
  const runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  runtime.registerNativeProvider(provider)
  await runtime.refresh({ allowNetwork: false })
  // A profile-owned observer is inherited naturally by children; it only records public events/UI.
  // It grants no identity/authority and never substitutes the native parent service.
  const observerKey = Symbol.for('@mahirocoko/first-use-workers:observer')
  globalThis[observerKey] = { notifications, events }
  fs.symlinkSync(path.join(product, 'node_modules'), path.join(disposable, 'node_modules'), 'dir')
  fs.writeFileSync(
    path.join(profile, 'extensions/fixture-observer.ts'),
    `import { getSubagentsService } from '@gotgenes/pi-subagents';
  import { getPermissionsService } from '@gotgenes/pi-permission-system';
  export default pi => {
    const sink = globalThis[Symbol.for('@mahirocoko/first-use-workers:observer')];
    sink.getService = getSubagentsService;
    sink.getPermissions = getPermissionsService;
    pi.on('session_start', (_, ctx) => {
      sink.events.push({ event: 'session_start', sessionId: ctx.sessionManager.getSessionId(),
        parent: ctx.sessionManager.getHeader()?.parentSession, mode: ctx.mode, hasUI: ctx.hasUI });
      ctx.ui.notify = (text, level) => sink.notifications.push({ text, level });
    });
    for (const event of ['subagents:created', 'subagents:started', 'subagents:completed',
      'subagents:failed', 'subagents:steered']) pi.events.on(event, data => sink.events.push({ event, ...data }));
  };\n`,
    { mode: 0o600 },
  )
  const settingsManager = sdk.SettingsManager.create(project, profile)
  const loader = new sdk.DefaultResourceLoader({
    cwd: project,
    agentDir: profile,
    settingsManager,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    disabledBuiltinExtensions: ['mcp'],
    systemPromptOverride: () => 'Synthetic offline first-use parent. Never infer real human acceptance.',
  })
  await loader.reload()
  assert.deepEqual(loader.getExtensions().errors, [])
  session = (
    await sdk.createAgentSession({
      cwd: project,
      agentDir: profile,
      modelRuntime: runtime,
      model: faux.getModel(),
      thinkingLevel: 'off',
      resourceLoader: loader,
      settingsManager,
      sessionManager: sdk.SessionManager.create(project, path.join(disposable, 'sessions')),
    })
  ).session
  await session.bindExtensions({
    onError: (error) => extensionErrors.push({ event: error.event, message: error.message }),
  })
  service = globalThis[observerKey].getService()
  assert.ok(service)
  save(
    'loaded.json',
    JSON.stringify(
      {
        extensions: loader.getExtensions().extensions.map((entry) => entry.path),
        tools: session.getActiveToolNames(),
      },
      null,
      2,
    ),
  )
  await step('memory.ready', 'agent_memory_manage', { action: 'status' }, (value) => {
    ok(value)
    assert.equal(value.data.readiness, 'Ready', value.text)
  })
  await step(
    'worker.unknown-get',
    'get_subagent_result',
    { agent_id: 'SYNTHETIC_ABSENT' },
    (value) => {
      ok(value)
      assert.match(value.text, /Agent not found: "SYNTHETIC_ABSENT"/)
    },
    true,
  )
  if (!process.argv.includes('--probe-worker')) {
    await step(
      'worker.unknown-steer',
      'steer_subagent',
      { agent_id: 'SYNTHETIC_ABSENT', message: 'fixture' },
      (value) => {
        ok(value)
        assert.match(value.text, /Agent not found: "SYNTHETIC_ABSENT"/)
      },
      true,
    )
    const spawnArgs = {
      subagent_type: 'fixture-worker',
      description: 'Synthetic read-only worker',
      prompt: 'Read safe.txt and return the synthetic marker.',
      run_in_background: false,
    }
    const beforeDenied = service.listAgents().length
    for (const [tool, id, args] of [
      ['subagent', 'worker.spawn-denied', spawnArgs],
      ['get_subagent_result', 'worker.get-denied', { agent_id: 'SYNTHETIC_ABSENT' }],
      ['steer_subagent', 'worker.steer-denied', { agent_id: 'SYNTHETIC_ABSENT', message: 'fixture' }],
      ['agent_memory_reflect', 'reflect.tool-denied', { assignment: 'Synthetic fixture assignment.' }],
    ]) {
      writePolicy({ ...policy, permission: { ...policy.permission, [tool]: 'deny' } })
      await step(
        id,
        tool,
        args,
        (value) => {
          denied(`Tool ${tool} not found`)(value)
          assert.equal(service.listAgents().length, beforeDenied)
        },
        true,
      )
    }
    writePolicy()
    const capability = `managed_memory_${createHash('sha256').update(root).digest('hex')}`
    writePolicy({ ...policy, permission: { ...policy.permission, [capability]: 'deny' } })
    await step(
      'reflect.exact-root-denied',
      'agent_memory_reflect',
      { assignment: 'Synthetic blocked assignment.' },
      (value) => {
        assert.equal(value.isError, true)
        assert.match(value.text, /^Managed memory unavailable:/)
        assert.equal(service.listAgents().length, beforeDenied)
      },
      true,
    )
    writePolicy()
    scriptWorker()
    const foreground = await step('worker.foreground', 'subagent', spawnArgs, (value) => {
      ok(value)
      assert.match(value.text, /SYNTHETIC_WORKER_COMPLETE/)
    })
    const foregroundId = foreground?.details?.agentId
    assert.ok(foregroundId)
    await step(
      'worker.completed-get',
      'get_subagent_result',
      { agent_id: foregroundId, verbose: true },
      (value) => {
        ok(value)
        assert.match(value.text, /SYNTHETIC_WORKER_COMPLETE/)
      },
    )
    await step(
      'worker.completed-steer',
      'steer_subagent',
      { agent_id: foregroundId, message: 'fixture' },
      (value) => {
        ok(value)
        assert.match(value.text, /Cannot steer a non-running agent/)
      },
      true,
    )
    scriptWorker()
    await step(
      'worker.resume',
      'subagent',
      { ...spawnArgs, resume: foregroundId, prompt: 'Continue the synthetic fixture only.' },
      (value) => {
        ok(value)
        assert.match(value.text, /SYNTHETIC_WORKER_COMPLETE/)
      },
    )
    const workerGate = gate()
    scriptWorker(workerGate)
    const background = await step(
      'worker.background',
      'subagent',
      { ...spawnArgs, run_in_background: true },
      (value) => {
        ok(value)
        assert.match(value.text, /background/i)
      },
    )
    const backgroundId = background?.details?.agentId
    assert.ok(backgroundId)
    await until(() => workerGate.used, 'background Faux request admission')
    await step(
      'worker.running-get',
      'get_subagent_result',
      { agent_id: backgroundId, wait: true, timeout: 0.02 },
      (value) => {
        ok(value)
        assert.match(value.text, /running/i)
      },
    )
    await step(
      'worker.running-steer',
      'steer_subagent',
      { agent_id: backgroundId, message: 'SYNTHETIC_STEER_TOKEN: finish without touching other files.' },
      (value) => {
        ok(value)
        assert.match(value.text, /Steering message (?:sent|queued)/)
      },
    )
    setTimeout(workerGate.release, 300)
    await step(
      'worker.background-result',
      'get_subagent_result',
      { agent_id: backgroundId, wait: true, timeout: 10, verbose: true },
      (value) => {
        ok(value)
        assert.match(value.text, /SYNTHETIC_STEER_COMPLETE/)
        assert.equal(steeringObserved, true)
      },
    )
    const target = 'procedures/worker-smoke.md'
    scriptWriter(target)
    const reflected = await step(
      'reflect.dispatch',
      'agent_memory_reflect',
      {
        assignment:
          'Write a synthetic fixture method to procedures/worker-smoke.md, preserving existing memory.',
      },
      (value) => {
        ok(value)
        assert.equal(value.data.status, 'native-dispatched')
      },
    )
    assert.ok(reflected?.data?.job, 'native reflection job required')
    await inspect(
      'reflect.parent-publication',
      () => reflectSettled(reflected.data.job),
      (value) => {
        assert.equal(value.native.status, 'completed', JSON.stringify(value))
        assert.equal(value.status.latestAttempt?.outcome, 'integrated', JSON.stringify(value))
        assert.equal(value.status.publication, 'committed-head')
      },
    )
    await step('reflect.read-published', 'agent_memory_read', { path: target }, (value) => {
      ok(value)
      assert.match(value.text, /SYNTHETIC_REFLECTION_PUBLISHED/)
      reflectionPublished = true
    })
    const deniedTarget = 'procedures/worker-denied.md'
    const revisionBefore = (await call('agent_memory_manage', { action: 'status' })).data.revision
    scriptWriter(deniedTarget, undefined, true)
    writePolicy({
      ...policy,
      permission: {
        ...policy.permission,
        path_write: { '*': 'allow', [path.join(root, deniedTarget)]: 'deny' },
      },
    })
    const deniedReflection = await step('reflect.denied-child-dispatch', 'agent_memory_reflect', {
      assignment: 'Attempt only the synthetic denied path; stop without committing if rejected.',
    })
    assert.ok(deniedReflection?.data?.job)
    await inspect(
      'reflect.child-path-denied',
      async () => {
        const value = await reflectSettled(deniedReflection.data.job)
        const transcript = sdk.parseSessionEntries(fs.readFileSync(value.native.outputFile, 'utf8'))
        const header = transcript.find((entry) => entry.type === 'session')
        assert.ok(header?.id, 'Native child transcript identity required')
        const permissions = globalThis[observerKey].getPermissions(header.id)
        assert.ok(permissions, 'Live public PSS service for this actual child required')
        const checks = {
          deniedTarget: permissions.checkPermission(
            'path_write',
            path.join(root, deniedTarget),
            'managed-memory-writer',
          ),
          allowedSibling: permissions.checkPermission(
            'path_write',
            path.join(root, target),
            'managed-memory-writer',
          ),
          editTool: permissions.checkPermission('agent_memory_edit', undefined, 'managed-memory-writer'),
          exactRoot: permissions.checkPermission(capability, undefined, 'managed-memory-writer'),
        }
        const messages = transcript.filter((entry) => entry.type === 'message').map((entry) => entry.message)
        save(
          'denied-job.json',
          JSON.stringify({ job: value.native, sessionId: header.id, checks, messages }, null, 2),
        )
        return { ...value, checks, messages, sessionId: header.id }
      },
      (value) => {
        assert.equal(value.native.id, deniedReflection.data.job)
        assert.equal(value.native.type, 'managed-memory-writer')
        assert.equal(value.native.status, 'completed', JSON.stringify(value))
        assert.equal(value.status.latestAttempt?.outcome, 'not-ready')
        assert.equal(value.status.revision, revisionBefore)
        assert.equal(fs.existsSync(path.join(root, deniedTarget)), false)
        assert.equal(value.checks.deniedTarget.state, 'deny')
        assert.equal(value.checks.deniedTarget.matchedSurface, 'path_write')
        assert.equal(value.checks.deniedTarget.matchedPattern, path.join(root, deniedTarget))
        for (const key of ['allowedSibling', 'editTool', 'exactRoot'])
          assert.equal(value.checks[key].state, 'allow', JSON.stringify(value.checks))
        const edits = value.messages
          .filter((message) => message.role === 'assistant')
          .flatMap((message) => message.content)
          .filter(
            (part) =>
              part.type === 'toolCall' &&
              part.name === 'agent_memory_edit' &&
              part.arguments.path === deniedTarget,
          )
        assert.equal(edits.length, 1, 'This job must attempt exactly the denied target')
        const result = value.messages.find(
          (message) => message.role === 'toolResult' && message.toolCallId === edits[0].id,
        )
        assert.equal(result?.toolName, 'agent_memory_edit')
        assert.equal(result?.isError, true)
        assert.match(textOf(result), /^Managed memory unavailable:/)
        assert.equal(
          value.messages.some(
            (message) => message.role === 'toolResult' && message.toolName === 'agent_memory_commit',
          ),
          false,
          'Denied job must never mark ready',
        )
      },
      true,
    )
    writePolicy()
    await step('reflect.after-denial-healthy', 'agent_memory_manage', { action: 'doctor' }, (value) => {
      ok(value)
      assert.equal(value.data.healthy, true)
    })
    const writerGate = gate()
    scriptWriter('procedures/worker-cancelled.md', writerGate)
    const cancelled = await step('reflect.cancel-dispatch', 'agent_memory_reflect', {
      assignment: 'Synthetic cancellable reflection; no real human preferences.',
    })
    assert.ok(cancelled?.data?.job)
    await until(() => writerGate.used, 'cancellable writer Faux request admission')
    assert.equal(service.getRecord(cancelled.data.job)?.status, 'running')
    // New primary model input itself cancels reflection before this tool executes; this proves
    // the supported combined input/cancel boundary, not that execute(cancel) alone caused it.
    await step('reflect.cancel-operation', 'agent_memory_manage', { action: 'cancel' }, (value) => {
      ok(value)
      assert.equal(value.data.cancelled, true)
    })
    writerGate.release()
    await inspect(
      'reflect.cancelled',
      () => reflectSettled(cancelled.data.job),
      (value) => {
        assert.equal(value.native.id, cancelled.data.job)
        assert.equal(value.native.type, 'managed-memory-writer')
        assert.equal(value.native.status, 'stopped', JSON.stringify(value))
        assert.equal(value.native.toolUses, 0, 'Gated cancelled job must not execute memory tools')
        assert.equal(value.status.latestAttempt?.outcome, 'cancelled')
        assert.equal(value.status.latestAttempt?.nativeStatus, 'stopped')
        assert.ok(
          events.some(
            (event) =>
              event.event === 'subagents:failed' &&
              event.id === cancelled.data.job &&
              event.type === 'managed-memory-writer' &&
              event.status === 'stopped',
          ),
          'Matching native stopped event required',
        )
        assert.equal(value.status.revision, revisionBefore)
        assert.equal(fs.existsSync(path.join(root, 'procedures/worker-cancelled.md')), false)
      },
      true,
    )
    const noUi = (value) => assert.equal(value.notifications.length, 0, JSON.stringify(value))
    const note = (pattern) => (value) =>
      assert.match(value.notifications.map((item) => item.text).join('\n'), pattern)
    const jsonNote = (verify) => (value) => {
      assert.equal(value.notifications.length, 1, JSON.stringify(value))
      verify(JSON.parse(value.notifications[0].text))
    }
    // Real public slash dispatch: assert branch-specific output or intentional non-TUI no-op.
    for (const [cmd, verify, options] of [
      ['/subagents:settings', noUi, { noop: true }],
      ['/subagents:sessions', noUi, { noop: true }],
      ['/mh-memory help', note(/Memory:/)],
      ['/mh-memory doctor', jsonNote((data) => assert.equal(data.healthy, true))],
      ['/mh-memory palace', jsonNote((data) => assert.equal(data.healthy, true))],
      ['/mh-memory remember', note(/Usage:/), { control: true }],
      ['/mh-memory unsupported', note(/Use \/mh-memory/), { control: true }],
      ['/mh-memory status', jsonNote((data) => assert.equal(data.readiness, 'Ready'))],
      ['/mh-rtk status', jsonNote((data) => assert.equal(data.mode, 'rewrite-rtk'))],
      ['/mh-goal help', note(/Mahiro Goal:/)],
      ['/mh-goal status', jsonNote((data) => assert.equal(data.goal, null))],
      ['/mh-goal-status', jsonNote((data) => assert.equal(data.goal, null))],
      ['/mh-evidence help', note(/\/mh-evidence status/)],
      ['/mh-ux help', note(/Mahiro UX metadata coordinator:/)],
      ['/mh-run help', note(/Execution Run metadata:/)],
      ['/mh-copy-code', note(/Interactive TUI is required.*Clipboard was not changed/)],
      ['/mh-queue', noUi, { noop: true }],
      ['/mh-todos', noUi, { noop: true }],
      ['/mh-ui', noUi, { noop: true }],
      ['/mh-usage', noUi, { noop: true }],
      ['/mh', noUi, { noop: true }],
    ])
      await slash(cmd, verify, options)
    // Slash reflection is a real owner operation even without TUI. It must not ask the parent model.
    scriptWriter('procedures/slash-worker-smoke.md')
    const slashResult = await slash(
      '/mh-memory dream Synthetic slash fixture only.',
      note(/native-dispatched/),
    )
    const slashDispatch = JSON.parse(slashResult.notifications.at(-1).text)
    const slashJob = service.getRecord(slashDispatch.job)
    assert.equal(slashJob?.id, slashDispatch.job)
    assert.equal(slashJob?.type, 'managed-memory-writer')
    await inspect(
      'reflect.slash-publication',
      () => reflectSettled(slashJob.id),
      (value) => {
        assert.equal(value.status.latestAttempt?.outcome, 'integrated', JSON.stringify(value))
      },
    )
    await step(
      'reflect.slash-read-published',
      'agent_memory_read',
      { path: 'procedures/slash-worker-smoke.md' },
      (value) => {
        ok(value)
        assert.match(value.text, /SYNTHETIC_REFLECTION_PUBLISHED/)
      },
    )
  }
  assert.equal(interceptedFetchCalls, 0)
  assert.deepEqual(extensionErrors, [])
} catch (error) {
  fatal = { message: error.message, stack: error.stack }
} finally {
  for (const release of releases) release()
  let cleanupTimer
  try {
    await Promise.race([
      (async () => {
        if (service) {
          for (const record of service.listAgents())
            if (['running', 'queued'].includes(record.status)) service.abort(record.id)
          await service.waitForAll()
        }
        if (session) {
          await session.abort()
          await session.waitForIdle()
          await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
          session.dispose()
        }
      })(),
      new Promise((_, reject) => {
        cleanupTimer = setTimeout(
          () => reject(Error('Native cleanup exceeded 10s; supervisor must reap process group')),
          cleanup.budgetMs,
        )
      }),
    ])
    cleanup.status = 'drained'
  } catch (error) {
    cleanup.status = 'incomplete-supervisor-required'
    fatal ??= { message: error.message, stack: error.stack }
  } finally {
    clearTimeout(cleanupTimer)
  }
  save('notifications.json', JSON.stringify(notifications, null, 2))
  save('events.json', JSON.stringify(events, null, 2))
  save('child-requests.json', JSON.stringify(childRequests, null, 2))
  save('extension-errors.json', JSON.stringify(extensionErrors, null, 2))
  delete globalThis[Symbol.for('@mahirocoko/first-use-workers:observer')]
  process.chdir(previousCwd)
  if (cleanup.status === 'drained') {
    fs.rmSync(disposable, { recursive: true, force: true })
    cleanup.disposableRemoved = !fs.existsSync(disposable)
  }
  globalThis.fetch = originalFetch
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, previous)
  const summary = {
    evidence: path.relative(product, runDir),
    fatal: fatal ?? null,
    networkObservation: { interceptedFetchCalls, scope: 'fixture process globalThis.fetch only' },
    cleanup,
    successes: rows.filter((row) => row.outcome === 'success').length,
    controlIds: rows.filter((row) => row.outcome === 'expected-control').map((row) => row.id),
    unexpected: rows.filter((row) => row.outcome === 'unexpected'),
    exercisedTools: [...exercisedTools].sort(),
    commands: rows.filter((row) => row.id.startsWith('command.')).length,
    commandResults: rows
      .filter((row) => row.id.startsWith('command.'))
      .map((row) => ({
        id: row.id,
        outcome: row.outcome,
        verification: row.value?.verification,
      })),
    verifiedHeadlessNoops: rows.filter((row) => row.outcome === 'verified-headless-noop').length,
    fauxCalls: {
      parent: faux?.state.callCount ?? 0,
      worker: workerFaux?.state.callCount ?? 0,
      writer: writerFaux?.state.callCount ?? 0,
    },
    reflectionPublished,
    steeringObserved,
    limitations: [
      'Disposable offline Faux only; no live provider or real profile/private memory',
      'No rendered TUI, human acceptance, real permissions/profile changes or session reload',
      'Synthetic role, file and worker permissions explicitly granted only in disposable profile',
      'Fetch interception excludes child subprocesses and non-fetch networking; not total network observation',
      'Cancellation verifies new primary input plus cancel tool; input admission may stop the job before tool execution',
      'Path denial attribution uses matching native job transcript plus live child PSS checks, not private engine instrumentation',
    ],
  }
  save('summary.json', JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary))
  if (fatal || summary.unexpected.length) process.exitCode = 1
}
