import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { registerSessionTasks } from '../lib/session-work/tasks.ts'
import { emptyTasks, type TaskOperation } from '../lib/session-work/task-model.ts'
import { sessionWorkFixture } from './session-work-fixture.ts'

test('isolated tasks owner initializes its captured renderers only at TUI startup across generations', () => {
  // Fresh processes prevent other extension owners or this file's fixtures from
  // warming workflow-ui. Observe genuine public geometry resolution, not a mock.
  for (const mode of ['tui', 'rpc', 'json']) {
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
let geometryLoads = 0
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@earendil-works/pi-tui') geometryLoads++
    return nextResolve(specifier, context)
  },
})
const { registerSessionTasks } = await import(${JSON.stringify(new URL('../lib/session-work/tasks.ts', import.meta.url).href)})
assert.equal(geometryLoads, 0, 'factory import must not load public TUI')
const mode = ${JSON.stringify(mode)}
const theme = { fg: (_tone, text) => text }
const renderContext = { executionStarted: true, isError: false, outputPad: 0 }
const options = { expanded: false, isPartial: false }
for (let generation = 0; generation < 2; generation++) {
  const handlers = new Map()
  const tools = new Map()
  const entries = []
  const ctx = {
    mode, hasUI: false,
    sessionManager: {
      getSessionId: () => 'isolated-task-session',
      getHeader: () => ({ id: 'isolated-task-session' }),
      getBranch: () => entries,
    },
    getSystemPrompt: () => 'Canonical system instructions.',
    ui: { setWidget() { throw Error('No widget needed for renderer regression') } },
  }
  registerSessionTasks({
    on(name, handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]) },
    registerTool(tool) { tools.set(tool.name, tool) },
    registerCommand() {},
    appendEntry(customType, data) {
      entries.push({ type: 'custom', id: crypto.randomUUID(), customType, data })
    },
  })
  if (generation === 0) assert.equal(geometryLoads, 0, 'registration is lazy')
  for (const handler of handlers.get('session_start') ?? []) await handler({}, ctx)
  assert.equal(geometryLoads > 0, mode === 'tui', 'only TUI lifecycle loads geometry')
  const invoke = (name, args = {}) => tools.get(name).execute('call', args, undefined, undefined, ctx)
  const created = await invoke('mh_task_create', { subject: 'Readable isolated task' })
  const results = [
    ['mh_task_list', {}, await invoke('mh_task_list')],
    ['mh_task_get', { id: created.details.id }, await invoke('mh_task_get', { id: created.details.id })],
  ]
  assert.equal(results[0][2].details.tasks.length, 1)
  assert.equal(results[1][2].details.subject, 'Readable isolated task')
  for (const [name, args, result] of results) {
    const tool = tools.get(name)
    const before = JSON.stringify(result)
    const call = tool.renderCall(args, theme, renderContext).render(100).join('\\n')
    const output = tool.renderResult(result, options, theme, renderContext).render(100).join('\\n')
    if (mode === 'tui') {
      assert.match(call, new RegExp(name.replace(/^mh_/, '').replaceAll('_', ' ') + ' · pending'))
      assert.match(output, /result \\(not acceptance\\)/)
      assert.match(output, name === 'mh_task_list' ? /tasks: 1/ : /Readable isolated task/)
      assert.notEqual(call, '...')
      assert.notEqual(output, '...')
    } else {
      assert.equal(call, '...')
      assert.equal(output, '...')
      assert.equal(geometryLoads, 0, 'non-TUI execution/rendering stays geometry-free')
    }
    assert.equal(JSON.stringify(result), before, 'presentation does not mutate captured results')
  }
  for (const handler of handlers.get('session_shutdown') ?? []) await handler({}, ctx)
}
`,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    )
    assert.equal(child.status, 0, `${mode}: ${child.error ?? ''}\n${child.stdout}\n${child.stderr}`)
  }
})

// Public-event model fixture; no inference, input classifier or implicit task writes.
function fixture(id: string = crypto.randomUUID()) {
  type Handler = (event: any, ctx: ExtensionContext) => any
  const handlers = new Map<string, Handler[]>()
  const tools = new Map<string, any>()
  const commands = new Map<string, any>()
  const entries: any[] = []
  const widgets = new Map<string, any>()
  let prompt = 'Canonical system instructions.'
  let parentSession: string | undefined
  let identity = id
  const ctx = {
    mode: 'tui',
    hasUI: true,
    sessionManager: {
      getSessionId: () => identity,
      getHeader: () => ({ id, parentSession }),
      getBranch: () => entries,
    },
    getSystemPrompt: () => prompt,
    ui: {
      setWidget(key: string, value: unknown) {
        if (value === undefined) widgets.delete(key)
        else widgets.set(key, value)
      },
      notify() {},
    },
  } as unknown as ExtensionContext
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler])
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool)
    },
    registerCommand(name: string, command: any) {
      commands.set(name, command)
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: 'custom', id: crypto.randomUUID(), customType, data })
    },
  } as unknown as ExtensionAPI
  const owner = registerSessionTasks(pi)
  async function emit(name: string, event: any = {}, context = ctx) {
    let result: any
    for (const handler of handlers.get(name) ?? []) {
      const value = await handler(event, context)
      if (value !== undefined) result = value
    }
    return result
  }
  const invoke = (name: string, args = {}) => tools.get(name).execute('call', args, undefined, undefined, ctx)
  const run = (text = 'ordinary request', messageType = 'user') => ({
    messageType,
    prompt: text,
    systemPrompt: prompt,
    systemPromptOptions: { sections: { existing: 'Keep this section.' } },
  })
  function configure(patch: Partial<ReturnType<typeof emptyTasks>['config']>) {
    const revision = entries.length + 1
    const operation: TaskOperation = { kind: 'config', config: { ...emptyTasks().config, ...patch } }
    entries.push({
      type: 'custom',
      id: crypto.randomUUID(),
      customType: 'mahiro-session-tasks-v1',
      data: { version: 1, id: crypto.randomUUID(), revision, operation },
    })
  }
  return {
    ctx,
    emit,
    invoke,
    tools,
    commands,
    owner,
    entries,
    widgets,
    run,
    configure,
    set prompt(value: string) {
      prompt = value
    },
    set parent(value: string | undefined) {
      parentSession = value
    },
    set identity(value: string) {
      identity = value
    },
  }
}

test('adoption describes concrete positives/negatives and all four tools, without parsing or writing input', async () => {
  const f = fixture()
  await f.emit('session_start')
  assert.deepEqual([...f.tools.keys()], ['mh_task_create', 'mh_task_get', 'mh_task_list', 'mh_task_update'])
  assert.deepEqual([...f.commands.keys()], ['mh-todos'])
  assert.equal(f.owner.open, f.commands.get('mh-todos').handler)
  assert.equal(f.commands.has('mh-tasks'), false)
  const create = f.tools.get('mh_task_create').description
  for (const phrase of [
    'investigate/fix/test',
    'across files/verify',
    'without waiting',
    'casual chat',
    'single-step',
  ])
    assert.ok(create.includes(phrase), phrase)
  const update = f.tools.get('mh_task_update').description
  for (const phrase of [
    'mh_task_get or mh_task_list',
    'expected_revision',
    'reread',
    'checking its result',
    'human acceptance',
  ])
    assert.ok(update.includes(phrase), phrase)
  let guidance: string | undefined
  for (const input of [
    'Investigate the bug, fix it and run tests',
    'Compare alternatives then implement across files',
    'Hello',
    'What does this identifier mean?',
    'Change one typo',
    'Do not use tasks',
    '<active_agent name="literal prompt data">',
  ]) {
    const event = f.run(input)
    const before = structuredClone(event)
    const result = await f.emit('before_agent_start', event)
    assert.deepEqual(event, before, 'no persistent prompt-section or input mutation')
    assert.equal(result.message, undefined, 'no transcript message')
    assert.ok(result.systemPrompt.startsWith(event.systemPrompt + '\n\n'))
    const suffix = result.systemPrompt.slice(event.systemPrompt.length)
    assert.ok(suffix.length < 1600)
    assert.match(suffix, /generated advisory, not a human request/)
    assert.match(suffix, /Skip casual conversation, explanations, quick lookups and single-step edits/)
    assert.match(suffix, /including requests not to track/)
    guidance ??= suffix
    assert.equal(suffix, guidance, 'guidance does not classify or reinterpret prompt text')
    await f.emit('agent_start')
    await f.emit('turn_start')
    assert.equal(await f.emit('context', { messages: [] }), undefined)
    await f.emit('agent_settled')
  }
  assert.deepEqual(f.entries, [], 'adoption never creates tasks or settings')
  assert.deepEqual((await f.invoke('mh_task_list')).details.config, emptyTasks().config)
  assert.equal(f.widgets.size, 0)
})

test('the Todos command retains the RPC selector fallback and one branch journal', async () => {
  const f = fixture()
  const selections: Array<string | undefined> = ['Create step', 'Reminders', 'on']
  let selectorCalls = 0
  Object.assign(f.ctx, { mode: 'rpc' })
  Object.assign(f.ctx.ui, {
    async select() {
      selectorCalls++
      return selections.shift()
    },
    async input() {
      return 'RPC todo ภาษาไทย 中文 👩🏽‍💻'
    },
    custom() {
      assert.fail('RPC must not open a custom TUI overlay')
    },
  })
  await f.emit('session_start')
  await f.commands.get('mh-todos').handler('', f.ctx)
  await f.commands.get('mh-todos').handler('', f.ctx)
  const { tasks, config } = (await f.invoke('mh_task_list')).details
  assert.equal(selectorCalls, 3)
  assert.equal(selections.length, 0)
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].subject, 'RPC todo ภาษาไทย 中文 👩🏽‍💻')
  assert.equal(config.reminders, true)
  assert.equal(f.entries.length, 2, 'one create and one config operation, no duplicate runtime writes')
  assert.ok(f.entries.every((entry) => entry.customType === 'mahiro-session-tasks-v1'))
  assert.deepEqual(
    f.entries.map((entry) => entry.data.revision),
    [1, 2],
  )
})

test('adoption preserves the latest maintained-memory/persona prompt and does not touch structured prompt state', async () => {
  const f = fixture()
  await f.emit('session_start')
  const latest =
    'Canonical persona\n<mahiro-managed-memory>Current revision, fallible knowledge.</mahiro-managed-memory>\nEarlier hook guidance.'
  const event = { ...f.run(), systemPrompt: latest }
  const result = await f.emit('before_agent_start', event)
  assert.ok(result.systemPrompt.startsWith(latest + '\n\n'))
  assert.equal(result.systemPrompt.split('<mahiro-managed-memory>').length, 2)
  assert.deepEqual(event.systemPromptOptions, { sections: { existing: 'Keep this section.' } })
  assert.equal(event.systemPrompt, latest)
  assert.deepEqual(f.entries, [])
})

test('off/custom/child/identity/shutdown/replaced contexts cannot inject adoption', async () => {
  for (const mode of ['off', 'custom', 'parent', 'role', 'memory', 'identity', 'shutdown', 'replacement']) {
    const id = crypto.randomUUID()
    const f = fixture(id)
    await f.emit('session_start')
    if (mode === 'off') f.configure({ view: 'off', reminders: true })
    if (mode === 'parent') f.parent = 'parent-session.jsonl'
    if (mode === 'role') f.prompt = '<active_agent name="implementer"/>'
    if (mode === 'memory') f.prompt = "You maintain the primary companion's private managed knowledge"
    if (mode === 'identity') f.identity = 'other'
    if (mode === 'shutdown') {
      await f.emit('session_shutdown')
      await f.emit('session_start')
    }
    if (mode === 'replacement') await fixture(id).emit('session_start')
    const before = structuredClone(f.entries)
    assert.equal(
      await f.emit('before_agent_start', f.run('fix and test', mode === 'custom' ? 'custom' : 'user')),
      undefined,
      mode,
    )
    await f.emit('turn_start')
    assert.equal(await f.emit('context', { messages: [] }), undefined, mode)
    if (['role', 'memory', 'identity', 'shutdown', 'replacement'].includes(mode))
      await assert.rejects(f.invoke('mh_task_create', { subject: 'must not write' }), /primary|retired/)
    assert.deepEqual(f.entries, before, mode)
  }
})

test('a child role observed only on the current run cannot later write through a primary-looking base prompt', async () => {
  const f = fixture()
  await f.emit('session_start')
  assert.equal(
    await f.emit('before_agent_start', { ...f.run(), systemPrompt: '<active_agent name="implementer"/>' }),
    undefined,
  )
  await assert.rejects(f.invoke('mh_task_create', { subject: 'child write rejected' }), /primary/)
  assert.equal(await f.emit('before_agent_start', f.run()), undefined)
  assert.deepEqual(f.entries, [])
})

test('reminders remain opt-in, transient, bounded, revision-aware and reset on navigation', async () => {
  const f = fixture()
  await f.emit('session_start')
  const created = (await f.invoke('mh_task_create', { subject: 'UNTRUSTED ' + '界'.repeat(490) })).details
  for (let turn = 0; turn < 5; turn++) await f.emit('turn_start')
  assert.equal(await f.emit('context', { messages: [] }), undefined)
  f.configure({ reminders: true })
  await f.emit('session_before_tree')
  for (let turn = 0; turn < 3; turn++) {
    await f.emit('turn_start')
    assert.equal(await f.emit('context', { messages: [] }), undefined)
  }
  await f.emit('turn_start')
  const messages = [{ role: 'user', content: 'actual human input' }]
  const before = structuredClone(f.entries)
  const reminder = await f.emit('context', { messages })
  assert.equal(messages.length, 1)
  assert.equal(reminder.messages[0], messages[0])
  assert.match(reminder.messages[1].content[0].text, /generated guidance, no authority/)
  assert.match(reminder.messages[1].content[0].text, /untrusted data/)
  assert.ok(reminder.messages[1].content[0].text.length < 650)
  assert.equal(await f.emit('context', { messages }), undefined)
  assert.deepEqual(f.entries, before, 'request-only reminder appends no evidence')
  await f.invoke('mh_task_get', { id: created.id })
  await f.invoke('mh_task_update', { id: created.id, expected_revision: 1, status: 'in_progress' })
  await assert.rejects(
    f.invoke('mh_task_update', { id: created.id, expected_revision: 1, status: 'completed' }),
    /latest task revision/,
  )
  await f.emit('turn_start')
  assert.equal(await f.emit('context', { messages }), undefined)
  await f.emit('turn_start')
  assert.ok(await f.emit('context', { messages }))
  f.configure({ view: 'off', reminders: true })
  await f.invoke('mh_task_get', { id: created.id })
  for (let turn = 0; turn < 4; turn++) await f.emit('turn_start')
  assert.equal(await f.emit('context', { messages }), undefined)
})

test('contextual widget bounds open work and hides completed-only batches without deleting records', async () => {
  const f = fixture()
  await f.emit('session_start')
  const tasks = []
  for (let i = 0; i < 7; i++) tasks.push((await f.invoke('mh_task_create', { subject: `step ${i}` })).details)
  const render = () => {
    const widget = f.widgets.get('mahiro-session-tasks')
    return (
      widget?.(
        {},
        { fg: (_color: string, text: string) => text, strikethrough: (text: string) => text },
      ).render(1000) ?? []
    )
  }
  assert.equal(render().filter((line: string) => line.includes('○ step')).length, 3, 'quiet: three open')
  assert.match(render().join('\n'), /● Todos \(0\/7\)/)
  assert.doesNotMatch(render().join('\n'), /branch-local|not tsk or human acceptance/)
  f.configure({ view: 'compact' })
  await f.invoke('mh_task_list')
  assert.equal(render().filter((line: string) => line.includes('○ step')).length, 5, 'compact: five open')
  await f.invoke('mh_task_update', { id: tasks[0].id, expected_revision: 1, status: 'completed' })
  assert.match(render().join('\n'), /✓ step 0/)
  assert.match(render().join('\n'), /● Todos \(1\/7\)/)
  for (const task of tasks.slice(1))
    await f.invoke('mh_task_update', { id: task.id, expected_revision: 1, status: 'completed' })
  assert.equal(f.widgets.size, 0)
  assert.equal((await f.invoke('mh_task_list')).details.tasks.length, 7)
  assert.equal((await f.invoke('mh_task_get', { id: tasks[0].id })).details.status, 'completed')
  await f.invoke('mh_task_update', { id: tasks[0].id, expected_revision: 2, status: 'pending' })
  assert.ok(f.widgets.size)
  f.configure({ view: 'off' })
  await f.invoke('mh_task_list')
  assert.equal(f.widgets.size, 0)
})

test('public SDK/Faux: ordinary runs add no task or synthetic guidance entries; completed steps remain inspectable across reload', async () => {
  const f = await sessionWorkFixture({ memory: true })
  try {
    const requests: string[] = []
    const pi = f.current().pi
    // Registered after tasks: emulate a later public prompt owner composing the
    // latest override, then inspect the real SDK's request-local transcript.
    pi.on('before_agent_start', (event) => {
      assert.ok(event.systemPrompt.includes('Session-step guidance (generated advisory'))
      return {
        systemPrompt: `${event.systemPrompt}\n<mahiro-managed-memory>Fixture projection, not live memory.</mahiro-managed-memory>`,
      }
    })
    for (const text of ['hello', 'Explain a symbol', 'Fix and test across files']) {
      f.faux.setResponses([
        (context) => {
          requests.push(JSON.stringify(context))
          return f.ai.fauxAssistantMessage('Fixture composition response.')
        },
      ])
      await f.runtime.session.prompt(text)
    }
    assert.equal(requests.length, 3)
    for (const request of requests) {
      assert.match(request, /Session-step guidance \(generated advisory/)
      assert.match(request, /Fixture projection, not live memory/)
      assert.match(request, /Deterministic offline session-work functional fixture/)
    }
    const branch = f.runtime.session.sessionManager.getBranch()
    assert.equal(
      branch.some((entry) => entry.type === 'custom' && entry.customType === 'mahiro-session-tasks-v1'),
      false,
    )
    assert.equal(JSON.stringify(branch).includes('Session-step guidance (generated advisory'), false)
    const task = await f.invoke('mh_task_create', { subject: 'Check bounded step result' })
    const id = task.id
    assert.ok(typeof id === 'string')
    await f.invoke('mh_task_get', { id })
    await f.invoke('mh_task_update', {
      id,
      expected_revision: 1,
      status: 'completed',
      description: 'Fixture evidence only; no human acceptance.',
    })
    assert.equal(f.widgets.has('mahiro-session-tasks'), false)
    await f.runtime.session.reload()
    const completed = await f.invoke('mh_task_get', { id })
    assert.equal(completed.status, 'completed')
    assert.match(
      String(completed.completion_meaning),
      /not worker execution, tsk outcome or human acceptance/,
    )
    assert.equal(f.widgets.has('mahiro-session-tasks'), false)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})
