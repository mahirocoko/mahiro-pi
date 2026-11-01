import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setImmediate as yieldTurn } from 'node:timers/promises'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { activateAgentMemory } from '../extensions/mahiro-agent-memory.ts'
import { MemoryEngineController } from '../lib/agent-memory/engine/controller.ts'
import { MemoryDataEngine } from '../lib/agent-memory/engine/data.ts'
import { validatePlan } from '../lib/agent-memory/engine/operation.ts'
import type { Plan } from '../lib/agent-memory/engine/protocol.ts'
import { observedEpisode } from '../lib/agent-memory/engine/episodes.ts'
import { engineEnvironment } from '../lib/agent-memory/engine/io.ts'
import { verificationPartLimit } from '../lib/agent-memory/verification-evidence.ts'
import { createExperimentalMemoryRuntime } from '../lib/agent-memory/experimental-runtime.ts'
import type { EngineWorkerValue } from '../lib/agent-memory/experimental-contracts.ts'
import { createMemoryStore, type Episode } from '../lib/agent-memory/store.ts'
import { digest } from '../lib/continuity/records.ts'
import { syntheticCompaction } from './helpers/compaction.ts'

const registry = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')

function fixture() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'memory-reflection-'))
  const previous = { ...process.env }
  for (const key of Object.keys(process.env))
    if (/^(GIT_|PI_|MAHIRO_)/.test(key) || /API_KEY|TOKEN|SECRET|PASSWORD/i.test(key)) delete process.env[key]
  Object.assign(process.env, {
    HOME: directory,
    PI_CODING_AGENT_DIR: directory,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(directory, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: directory,
  })
  writeFileSync(
    join(directory, '.gitconfig'),
    '[user]\n name = Synthetic Reflection\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
  )
  mkdirSync(join(directory, 'agents'), { mode: 0o700 })
  writeFileSync(
    join(directory, 'agents/managed-memory-writer.md'),
    readFileSync(new URL('../agents/managed-memory-writer.md', import.meta.url)),
    { mode: 0o600 },
  )
  const cwd = join(directory, 'project')
  mkdirSync(cwd)
  const root = join(directory, 'memory')
  const store = createMemoryStore(root)
  store.initialize(
    {
      version: 1,
      projects: [{ cwd, id: 'project' }],
      coreBytes: 8192,
      indexBytes: 2048,
      fileBytes: 8192,
      totalBytes: 65536,
      automatic: true,
    },
    '# Core\nSynthetic reflection identity.\n',
  )
  const handlers = new Map<string, Function[]>()
  const listeners = new Map<string, Set<Function>>()
  const tools = [
    'agent_memory_read',
    'agent_memory_edit',
    'agent_memory_commit',
    'agent_memory_reflect',
    'agent_memory_manage',
  ].map((name) => ({ name }))
  const pi = {
    events: {
      on(name: string, fn: Function) {
        if (!listeners.has(name)) listeners.set(name, new Set())
        listeners.get(name)?.add(fn)
        return () => listeners.get(name)?.delete(fn)
      },
    },
    on(name: string, fn: Function) {
      if (!handlers.has(name)) handlers.set(name, [])
      handlers.get(name)?.push(fn)
    },
    getAllTools: () => tools,
  } as unknown as ExtensionAPI
  const branch: { id: string; type: string; parentId?: string | null; [key: string]: unknown }[] = []
  const manager = {
    getSessionId: () => 'primary',
    getLeafId: () => branch.at(-1)?.id ?? null,
    getBranch: () => branch,
    getEntry: (id: string) => branch.find((entry) => entry.id === id),
    getHeader: () => ({ type: 'session', id: 'primary' }),
    getSessionFile: () => undefined,
  }
  const physical = {
    provider: 'openai',
    id: 'gpt-6.1-sol',
    api: 'openai-responses',
    baseUrl: 'https://example.invalid',
    reasoning: true,
  }
  const ctx = {
    cwd,
    hasUI: true,
    mode: 'tui',
    sessionManager: manager,
    isIdle: () => true,
    modelRegistry: { getAll: () => [physical], getAvailable: () => [physical], find: () => physical },
  } as unknown as ExtensionContext
  let granted = true
  let authorizations = 0
  let blockAfter = Number.POSITIVE_INFINITY
  let gate: Promise<void> | undefined
  const holds: { count: number } = { count: 0 }
  const retirements = new Set<() => Promise<void>>()
  const records = new Map<string, { id: string; type: string; status: string; outputFile: string }>()
  const spawns: { id: string; name: string; prompt: string; options: { foreground?: boolean } }[] = []
  let binding: { id: string; value: EngineWorkerValue } | undefined
  const generation = {}
  const childManagers = new Set<ExtensionContext['sessionManager']>()
  const closeChildren: (() => Promise<void>)[] = []
  const service = {
    supportsInitialOutcomeClaim: true,
    getAgentType: () => ({
      name: 'managed-memory-writer',
      model: 'openai/gpt-6.1-sol',
      thinking: 'medium',
      locked: true,
      inheritContext: false,
      runInBackground: true,
      promptMode: 'replace',
      toolNames: ['agent_memory_read', 'agent_memory_edit', 'agent_memory_commit'],
    }),
    hasRunning: () => false,
    getRecord: (id: string) => records.get(id),
    abort(id: string) {
      const record = records.get(id)
      if (record) record.status = 'stopped'
      return true
    },
    spawn(name: string, prompt: string, options: { foreground?: boolean }) {
      const id = `job-${spawns.length + 1}`
      const record = { id, type: name, status: 'running', outputFile: 'authoritative-native-session-file' }
      records.set(id, record)
      spawns.push({ id, name, prompt, options })
      return id
    },
  }
  const abi = {
    version: 2 as const,
    generation,
    root,
    live: () => true,
    trustedTool: (tool: unknown) => tools.includes(tool as (typeof tools)[number]),
    isPrimarySession: (context: ExtensionContext) =>
      context.sessionManager === (manager as unknown as ExtensionContext['sessionManager']),
    hold() {
      return () => undefined
    },
    onRetire(fn: () => Promise<void>) {
      retirements.add(fn)
      return () => retirements.delete(fn)
    },
    assertAccess(_tool?: unknown, context?: ExtensionContext) {
      if (!granted) throw Error('Denied synthetic authority')
      if (context && childManagers.has(context.sessionManager)) {
        if (!binding) throw Error('Missing synthetic worker binding')
        return { kind: 'worker' as const, value: binding.value }
      }
      return { kind: 'primary' as const }
    },
    assertTargets(tool: unknown, context: ExtensionContext) {
      abi.assertAccess(tool, context)
    },
    maintenanceAccess() {
      return abi.assertAccess()
    },
    async authorize(tool?: unknown, context?: ExtensionContext) {
      authorizations += 1
      if (authorizations > blockAfter && gate) {
        holds.count += 1
        await gate
      }
      return abi.assertAccess(tool, context)
    },
    parentService: () => service,
    bindWorker(_tool: unknown, _ctx: unknown, _root: string, id: string, value: EngineWorkerValue) {
      const own = { id, value }
      binding = own
      return () => {
        if (binding === own) binding = undefined
      }
    },
  }
  const node = { generation, healthy: () => true, managedMemory: abi }
  const globals = globalThis as unknown as Record<symbol, unknown>
  const oldRegistry = globals[registry]
  const nodes = new Map([['primary', node]])
  globals[registry] = nodes
  const runtime = createExperimentalMemoryRuntime(pi)
  const emit = async (name: string, event: unknown = {}, context = ctx) => {
    if (name === 'session_compact') {
      const compact = event as ReturnType<typeof syntheticCompaction>
      const entries = context.sessionManager.getBranch()
      const leaf = entries.at(-1)?.id === compact.compactionEntry?.id ? entries.pop() : undefined
      try {
        const before = {
          reason: compact.reason,
          willRetry: compact.willRetry,
          signal: new AbortController().signal,
        }
        for (const handler of handlers.get('session_before_compact') ?? []) await handler(before, context)
      } finally {
        if (leaf) entries.push(leaf)
      }
    }
    const results = []
    for (const handler of handlers.get(name) ?? []) results.push(await handler(event, context))
    return results
  }
  const nativeEvent = (name: string, payload: { id: string; type: string }) => {
    for (const handler of listeners.get(name) ?? []) handler(payload)
  }
  return {
    store,
    root,
    runtime,
    ctx,
    branch,
    spawns,
    records,
    holds,
    revoke() {
      granted = false
    },
    grant() {
      granted = true
    },
    binding: () => binding,
    authorizations: () => authorizations,
    holdAuthorizations(after: number) {
      blockAfter = authorizations + after
      let release: () => void = () => undefined
      gate = new Promise<void>((resolve) => {
        release = () => resolve()
      })
      return () => {
        gate = undefined
        blockAfter = Number.POSITIVE_INFINITY
        release()
      }
    },
    emit,
    nativeEvent,
    async turn(text: string, assistantMessages: number) {
      await emit('input', { source: 'rpc', text })
      branch.push({
        id: `user-${text}`,
        type: 'message',
        parentId: branch.at(-1)?.id ?? null,
        message: { role: 'user', content: text },
      })
      await emit('before_agent_start', { systemPrompt: 'Base' })
      for (let index = 0; index < assistantMessages; index++)
        await emit('message_end', {
          message: { role: 'assistant', content: [{ type: 'text', text: `${text} assistant ${index}` }] },
        })
      await emit('agent_before_settle', { outcome: 'completed' })
      await emit('agent_settled', { aborted: false })
    },
    async compact() {
      const event = syntheticCompaction('compact-one')
      event.compactionEntry.parentId = branch.at(-1)?.id ?? null
      branch.push(event.compactionEntry as unknown as (typeof branch)[number])
      await emit('session_compact', event)
    },
    async finish(status: 'completed' | 'failed', markReady = true) {
      const spawned = spawns.at(-1)
      if (!spawned || !binding) throw Error('No writer to finish')
      if (status === 'completed' && markReady) {
        await binding.value.engine.request('ready', { view: binding.value.view }, { current: () => true })
        binding.value.ready = true
      }
      const record = records.get(spawned.id)
      if (!record) throw Error('Missing writer record')
      record.status = status
      nativeEvent(status === 'completed' ? 'subagents:completed' : 'subagents:failed', {
        id: spawned.id,
        type: 'managed-memory-writer',
      })
      await runtime.drain()
    },
    async child() {
      const own = binding
      if (!own) throw Error('No synthetic writer bound')
      const childHandlers = new Map<string, Function[]>()
      const registered = new Map<string, any>()
      const childPi = {
        on(name: string, fn: Function) {
          if (!childHandlers.has(name)) childHandlers.set(name, [])
          childHandlers.get(name)!.push(fn)
        },
        getAllTools: () => [...registered.values()],
        registerTool(tool: any) {
          registered.set(tool.name, tool)
          tools.push(tool)
        },
        registerCommand() {},
      } as unknown as ExtensionAPI
      const childManager = {
        ...manager,
        getSessionId: () => own.id,
        getHeader: () => ({ type: 'session', id: own.id }),
        getBranch: () => [],
        getLeafId: () => null,
      } as unknown as ExtensionContext['sessionManager']
      childManagers.add(childManager)
      nodes.set(own.id, node)
      const childCtx = {
        ...ctx,
        sessionManager: childManager,
        ui: { notify() {}, setWidget() {} },
      } as unknown as ExtensionContext
      activateAgentMemory(childPi)
      closeChildren.push(async () => {
        for (const handler of childHandlers.get('session_shutdown') ?? []) await handler({}, childCtx)
      })
      for (const handler of childHandlers.get('session_start') ?? []) await handler({}, childCtx)
      for (const handler of childHandlers.get('before_agent_start') ?? [])
        await handler({ systemPrompt: '<active_agent name="managed-memory-writer"/>' }, childCtx)
      const execute = async (name: string, args: Record<string, unknown>) => {
        const tool = registered.get(name)
        assert.ok(tool, 'registered native memory tool')
        for (const handler of childHandlers.get('tool_execution_start') ?? [])
          await handler({ toolCallId: 'synthetic-call', toolName: name, args }, childCtx)
        try {
          return (await tool.execute('synthetic-call', args, undefined, undefined, childCtx)).details
        } finally {
          for (const handler of childHandlers.get('tool_execution_end') ?? [])
            await handler({ toolCallId: 'synthetic-call', toolName: name }, childCtx)
        }
      }
      return Object.assign(execute, {
        async emit(name: string, event: unknown) {
          for (const handler of childHandlers.get(name) ?? []) await handler(event, childCtx)
        },
      })
    },
    async close() {
      for (const closeChild of closeChildren) await closeChild()
      await runtime.cancel()
      await runtime.drain()
      globals[registry] = oldRegistry
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

const episodeIds = (prompt: string) =>
  (JSON.parse(prompt) as { episodes: { id: string; kind?: string; actions?: unknown[] }[] }).episodes

async function until(ready: () => boolean) {
  const started = performance.now()
  while (!ready()) {
    if (performance.now() - started > 5000) assert.equal(ready(), true)
    await yieldTurn()
  }
}

for (const overflow of [false, true])
  test(`ABI2 bound child tool execute marks ready and parent genuinely integrates (overflow=${overflow})`, async () => {
    const f = fixture()
    try {
      if (overflow) {
        // Fill only this synthetic root's ordinary namespace with valid terminal manifests.
        const seed = new MemoryDataEngine(realpathSync(f.root), engineEnvironment(process.env))
        const created = await seed.execute(
          'create',
          { project: 'project', shared: true },
          async () => {},
          new AbortController().signal,
        )
        const folder = join(f.root, '.views/.engine-v2/drafts')
        const template = JSON.parse(readFileSync(join(folder, `${created.view}.json`), 'utf8'))
        rmSync(join(folder, `${created.view}.json`))
        for (let index = 0; index < 64; index++) {
          const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
          writeFileSync(join(folder, `${id}.json`), JSON.stringify({ ...template, id, state: 'cancelled' }), {
            mode: 0o600,
          })
        }
      }
      await f.emit('session_start')
      await f.turn('bound child handshake', 25)
      const binding = f.binding()
      assert.ok(binding)
      const selected = episodeIds(f.spawns[0]!.prompt)
      assert.equal(selected.length, 1)
      if (overflow)
        assert.ok(existsSync(join(f.root, '.views/.engine-v2/overflow-drafts', `${binding.value.view}.json`)))
      const execute = await f.child()
      const files = await execute('agent_memory_read', {})
      assert.equal(files.baseRevision, binding.value.base)
      assert.equal(files.revision, binding.value.base)
      for (let index = 0; index < 5; index++) await execute('agent_memory_read', { path: 'Core.md' })
      const before = f.store.snapshot().revision
      await execute('agent_memory_edit', {
        path: 'procedures/child-handshake.md',
        expectedHash: null,
        text: '# Synthetic child handshake\nRead, edit, ready, parent integration.\n',
        sources: selected.map((episode) => episode.id),
      })
      await assert.rejects(
        execute('agent_memory_commit', { revision: 'wrong-revision' }),
        (error: unknown) => {
          assert.ok(error instanceof Error)
          assert.equal(
            error.message,
            'Managed memory unavailable: revision or hash conflict; retained proposal preserved (reason: CAS)',
          )
          assert.ok(!error.message.includes(f.root))
          assert.ok(!error.message.includes('wrong-revision'))
          assert.ok(!error.message.includes(files.baseRevision))
          return true
        },
      )
      assert.equal(binding.value.ready, false)
      assert.equal(f.store.snapshot().revision, before)
      const preserved = await execute('agent_memory_read', { path: 'procedures/child-handshake.md' })
      assert.equal(preserved.text, '# Synthetic child handshake\nRead, edit, ready, parent integration.\n')
      const ready = await execute('agent_memory_commit', { revision: files.baseRevision })
      assert.deepEqual(ready, { readyForIntegration: true, activeContextChanged: false })
      assert.equal(binding.value.ready, true)
      const status = (await f.runtime.run('agent_memory_manage', { action: 'status' }, f.ctx)) as any
      assert.equal(status.latestAttempt.timing.complete, true, 'ready commit-end remains observable')
      assert.ok(status.latestAttempt.timing.observedToolWallMs > 0)
      f.revoke()
      await execute.emit('tool_execution_end', { toolCallId: 'unauthorized-unpaired' })
      f.grant()
      const afterRevoke = (await f.runtime.run('agent_memory_manage', { action: 'status' }, f.ctx)) as any
      assert.equal(afterRevoke.latestAttempt.timing.complete, true, 'revoked child event is ignored')
      assert.equal(
        afterRevoke.latestAttempt.timing.observedToolWallMs,
        status.latestAttempt.timing.observedToolWallMs,
      )
      assert.equal(f.store.snapshot().revision, before, 'child ready is not publication')
      await f.finish('completed', false)
      const after = f.store.snapshot()
      assert.notEqual(after.revision, before)
      assert.ok(after.files['procedures/child-handshake.md'])
      assert.deepEqual(
        after.reviewed,
        selected.map((episode) => episode.id),
      )
      assert.equal(f.runtime.status().worker, false)
      assert.equal(f.runtime.status().lastError, undefined)
      const terminal = (await f.runtime.run('agent_memory_manage', { action: 'status' }, f.ctx)) as any
      await execute.emit('tool_execution_end', { toolCallId: 'late-unpaired' })
      const late = (await f.runtime.run('agent_memory_manage', { action: 'status' }, f.ctx)) as any
      assert.deepEqual(late.latestAttempt.timing, terminal.latestAttempt.timing)
    } finally {
      await f.close()
    }
  })

test('native writer timer aborts at 240 seconds and fences late completion', async (t) => {
  const f = fixture()
  try {
    await f.emit('session_start')
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const started = Date.now()
    t.mock.method(Date, 'now', () => started)
    await f.turn('hard worker deadline', 25)
    const binding = f.binding()
    assert.ok(binding)
    assert.equal(binding.value.deadline, started + 240000)
    // Ready is not publication: completion must still arrive within the worker budget.
    await binding.value.engine.request('ready', { view: binding.value.view }, { current: () => true })
    binding.value.ready = true
    t.mock.timers.tick(120001)
    assert.equal(f.runtime.status().worker, true, 'the old deadline no longer cancels the worker')
    t.mock.timers.tick(119998)
    assert.equal(f.runtime.status().worker, true)
    t.mock.method(Date, 'now', () => started + 240000)
    t.mock.timers.tick(1)
    assert.equal(f.runtime.status().worker, false)
    assert.equal(f.records.get(binding.id)?.status, 'stopped')
    assert.equal(f.runtime.status().lastError, 'worker-deadline')
    const record = f.records.get(binding.id)!
    record.status = 'completed'
    f.nativeEvent('subagents:completed', { id: binding.id, type: 'managed-memory-writer' })
    await f.runtime.drain()
    assert.deepEqual(f.store.snapshot().reviewed, [])
    assert.equal(f.spawns.length, 1, 'late completion cannot revive or retry the writer')
  } finally {
    t.mock.restoreAll()
    t.mock.timers.reset()
    await f.close()
  }
})

for (const scenario of [
  'ample',
  'beyond-old-deadline',
  'near-expiry',
  'reserve-expired',
  'cancel',
  'revoke',
  'generation',
] as const) {
  test(`ready writer publication timing: ${scenario}`, async (t) => {
    const elapsed = scenario === 'ample' ? 10000 : scenario === 'beyond-old-deadline' ? 180000 : 238000
    const f = fixture()
    let release: (() => void) | undefined
    try {
      await f.emit('session_start')
      await f.turn('publication timing', 25)
      const binding = f.binding()
      assert.ok(binding)
      // Only the parent clock moves: the real engine runs against a fresh synthetic root.
      const started = binding.value.deadline - 240000
      let now = started + elapsed
      t.mock.method(Date, 'now', () => now)
      await binding.value.engine.request('ready', { view: binding.value.view }, { current: () => true })
      binding.value.ready = true
      const record = f.records.get(binding.id)
      assert.ok(record)
      record.status = 'completed'
      let entered = false
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const request = binding.value.engine.request.bind(binding.value.engine)
      const delayed: typeof binding.value.engine.request = async (method, input, context) => {
        if (method === 'config' && !entered) {
          entered = true
          await gate
        }
        return request(method, input, context)
      }
      t.mock.method(binding.value.engine, 'request', delayed)
      f.nativeEvent('subagents:completed', { id: binding.id, type: 'managed-memory-writer' })
      await until(() => entered)
      now += scenario === 'reserve-expired' ? 31000 : 3000
      const cancelling = scenario === 'cancel' ? f.runtime.cancel() : undefined
      if (scenario === 'revoke') f.revoke()
      if (scenario === 'generation') {
        const nodes = (globalThis as unknown as Record<symbol, Map<string, { generation: unknown }>>)[
          registry
        ]!
        nodes.get('primary')!.generation = {}
      }
      release!()
      await cancelling
      await f.runtime.drain()
      const expected = ['ample', 'beyond-old-deadline', 'near-expiry'].includes(scenario)
        ? episodeIds(f.spawns[0]!.prompt).map((e) => e.id)
        : []
      assert.deepEqual(f.store.snapshot().reviewed, expected)
      assert.equal(f.runtime.status().worker, false)
      assert.equal(f.spawns.length, 1, 'publication never retries or revives the writer')
    } finally {
      release?.()
      t.mock.restoreAll()
      await f.close()
    }
  })
}

test('foreground input after ABI2 prepare retires only the exact drained never-published intent', async (t) => {
  const f = fixture()
  let release: (() => void) | undefined
  try {
    await f.emit('session_start')
    await f.turn('prepare publication handoff', 25)
    const binding = f.binding()
    assert.ok(binding)
    const before = f.store.snapshot()
    const selected = episodeIds(f.spawns[0]!.prompt).map((episode) => episode.id)
    assert.equal(selected.length, 1)
    // This fixture omits native waitForAll; its existing diagnostic is not a handoff failure.
    assert.equal(f.runtime.status().lastError, 'native-drain-unavailable')
    await binding.value.engine.request('ready', { view: binding.value.view }, { current: () => true })
    binding.value.ready = true
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let prepared: Plan | undefined
    const methods: string[] = []
    const request = binding.value.engine.request.bind(binding.value.engine)
    const delayed: typeof binding.value.engine.request = async (method, input, context) => {
      methods.push(method)
      const result = await request(method, input, context)
      if (method === 'prepare') {
        assert.ok('plan' in result)
        validatePlan(result.plan)
        prepared = result.plan
        // Pause after the genuine durable prepare, before the parent can enter publish.
        await gate
      }
      return result
    }
    t.mock.method(binding.value.engine, 'request', delayed)
    const finishing = f.finish('completed', false)
    await until(() => prepared !== undefined)
    const operation = prepared!
    const pending = async () => {
      const status = (await f.runtime.run('agent_memory_manage', { action: 'status' }, f.ctx)) as any
      const entry = status.pendingOperations.find((entry: { id: string }) => entry.id === operation.id)
      assert.ok(entry, 'the exact synthetic durable operation remains discoverable')
      assert.ok(entry.recordBytes > 0)
      return { id: entry.id, digest: entry.digest, stage: entry.stage }
    }
    assert.deepEqual(await pending(), { id: operation.id, digest: operation.digest, stage: 'prepared' })
    await f.emit('input', { source: 'rpc', text: 'foreground interrupts prepared publication' })
    assert.equal(f.runtime.status().worker, false)
    assert.equal(f.binding(), undefined, 'foreground cancellation revokes the worker binding')
    release!()
    await finishing
    await f.runtime.drain()
    const status = (await f.runtime.run('agent_memory_manage', { action: 'status' }, f.ctx)) as any
    assert.equal(status.latestAttempt.outcome, 'cancelled')
    assert.equal(f.runtime.status().lastError, 'native-drain-unavailable')
    assert.equal(f.spawns.length, 1, 'the cancelled completion cannot retry the writer')
    assert.deepEqual(f.store.snapshot(), before, 'HEAD, files and reviewed episodes remain unchanged')
    assert.ok(selected.every((id) => !f.store.snapshot().reviewed.includes(id)))
    assert.ok(!status.pendingOperations.some((entry: { id: string }) => entry.id === operation.id))
    const recordPath = join(f.root, '.views/.engine-v2/journal', `${operation.id}.json`)
    const retired = JSON.parse(readFileSync(recordPath, 'utf8'))
    assert.equal(retired.receipt.stage, 'not_committed_dirty')
    assert.equal(retired.owner, null)
    assert.equal(retired.sequence, 1, 'fresh-authority retirement uses the existing operation CAS')
    assert.ok(!existsSync(join(f.root, '.lock')), 'publication never acquired a canonical lock')
    assert.ok(!methods.some((method) => ['fence', 'claim', 'journal', 'chunk'].includes(method)))
    // Inspect only this synthetic operation through the public same-operation recovery path.
    const reconciled = (await f.runtime.run(
      'agent_memory_manage',
      { action: 'reconcile', target: operation.id, revision: operation.digest },
      f.ctx,
    )) as any
    assert.equal(reconciled.operation, operation.id)
    assert.equal(reconciled.stage, 'not_committed_dirty')
    assert.equal(reconciled.lockRetained, false)
    assert.equal(binding.value.engine.ownsPlan(operation), false, 'the exact returned plan cannot replay')
    assert.deepEqual(f.store.snapshot(), before, 'reconciliation is not publication or episode review')
    await f.turn('a later foreground starts a fresh reflection window', 25)
    assert.equal(f.spawns.length, 2, 'only a later foreground window dispatches a new writer')
    await f.finish('completed')
    assert.ok(
      selected.every((id) => f.store.snapshot().reviewed.includes(id)),
      'the safely retired record does not block a fresh proposal and genuine publication',
    )
  } finally {
    release?.()
    t.mock.restoreAll()
    await f.close()
  }
})

test('foreground cancellation before prepare never creates or adopts an operation', async (t) => {
  const f = fixture()
  let release = () => {}
  try {
    await f.emit('session_start')
    await f.turn('before prepare', 25)
    const binding = f.binding()!
    const before = f.store.snapshot()
    const request = binding.value.engine.request.bind(binding.value.engine)
    let entered = false
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const delayed: typeof binding.value.engine.request = async (method, input, context) => {
      if (method === 'prepare') {
        entered = true
        await gate
      }
      return request(method, input, context)
    }
    t.mock.method(binding.value.engine, 'request', delayed)
    const finishing = f.finish('completed')
    await until(() => entered)
    await f.emit('input', { source: 'rpc', text: 'foreground before prepare' })
    assert.equal(f.runtime.status().worker, false)
    release()
    await finishing
    const status = await request('status', {}, { current: () => true })
    assert.deepEqual(status.pendingOperations, [])
    assert.deepEqual(f.store.snapshot(), before)
    assert.equal(f.spawns.length, 1)
  } finally {
    release()
    t.mock.restoreAll()
    await f.close()
  }
})

test('foreground cancellation loses the prepare reply but joins the actual durable operation before retirement', async (t) => {
  const f = fixture()
  let deliver = () => {}
  try {
    await f.emit('session_start')
    await f.turn('lost prepare response', 25)
    const binding = f.binding()!
    const before = f.store.snapshot()
    const engine = binding.value.engine
    const internal = engine as unknown as { receive(message: any): void }
    const receive = internal.receive.bind(engine)
    let operation: { id: string; digest: string } | undefined
    let returned = false
    const request = engine.request.bind(engine)
    const delayed: typeof engine.request = async (method, input, context) => {
      const result = await request(method, input, context)
      if (method === 'prepare') returned = true
      return result
    }
    t.mock.method(engine, 'request', delayed)
    t.mock.method(internal, 'receive', (message: any) => {
      if (message.result?.plan) {
        operation = message.result.plan
        // The real child has durably prepared and sent its terminal response, but
        // the controller has not joined it. Losing caller authority must not lose
        // pre-write ownership or treat the request promise as proof of drain.
        deliver = () => {
          deliver = () => {}
          receive(message)
        }
      } else receive(message)
    })
    const finishing = f.finish('completed')
    await until(() => operation !== undefined)
    const recordPath = join(f.root, '.views/.engine-v2/journal', `${operation!.id}.json`)
    const raw = readFileSync(recordPath, 'utf8')
    assert.equal(JSON.parse(raw).receipt.stage, 'prepared')
    const foreground = f.emit('input', { source: 'rpc', text: 'foreground while response is in flight' })
    await until(() => !f.runtime.status().worker)
    assert.equal(f.binding(), undefined)
    assert.equal(readFileSync(recordPath, 'utf8'), raw, 'no retirement before actual operation join')
    assert.equal(returned, false)
    deliver()
    await foreground
    await finishing
    assert.equal(returned, false, 'the stale final response is rejected, never exposed as a prepared plan')
    assert.equal(JSON.parse(readFileSync(recordPath, 'utf8')).receipt.stage, 'not_committed_dirty')
    assert.deepEqual(f.store.snapshot(), before)
    assert.equal(f.spawns.length, 1)
    assert.equal((await request('status', {}, { current: () => true })).pendingOperations.length, 0)
  } finally {
    deliver()
    t.mock.restoreAll()
    await f.close()
  }
})

for (const review of [false, true]) {
  test(`active prepare request cancellation joins the approved durable write (review=${review})`, async (t) => {
    const f = fixture()
    try {
      await f.emit('session_start')
      await f.turn('active request cancellation', 25)
      const binding = f.binding()!
      const engine = binding.value.engine
      const before = f.store.snapshot()
      const authority = { current: () => true }
      await engine.request('ready', { view: binding.value.view }, authority)
      const abort = new AbortController()
      const internal = engine as unknown as { receive(message: any): void }
      const receive = internal.receive.bind(engine)
      let plan: Plan | undefined
      let cancelled = false
      t.mock.method(internal, 'receive', (message: any) => {
        if (message.targets?.preparing) plan = message.targets.preparing
        const approvedWrite =
          plan &&
          message.targets &&
          !message.targets.preparing &&
          message.targets.physical.includes(join(f.root, '.views/.engine-v2/journal', `${plan.id}.json`))
        receive(message)
        if (approvedWrite && !cancelled) {
          // Send cancellation after the exact final write checkpoint was approved,
          // before its terminal response. The child must still join any started write.
          cancelled = true
          abort.abort()
        }
      })
      await assert.rejects(
        engine.request(
          'prepare',
          {
            view: binding.value.view,
            reviewed: review ? episodeIds(f.spawns[0]!.prompt).map((episode) => episode.id) : [],
          },
          { ...authority, signal: abort.signal },
        ),
        /abort|cancel/i,
      )
      assert.equal(cancelled, true)
      assert.ok(plan)
      const recordPath = join(f.root, '.views/.engine-v2/journal', `${plan.id}.json`)
      assert.equal(JSON.parse(readFileSync(recordPath, 'utf8')).receipt.stage, 'prepared')
      assert.equal(engine.ownsPlan(plan), false, 'no successful caller plan or replay capability was minted')
      const retired = await engine.retireUnpublished(binding.value.view, authority)
      assert.equal(retired?.receipt.stage, 'not_committed_dirty')
      assert.equal(JSON.parse(readFileSync(recordPath, 'utf8')).receipt.stage, 'not_committed_dirty')
      assert.deepEqual(f.store.snapshot(), before)
      assert.ok(!existsSync(join(f.root, '.lock')))
      assert.equal(f.spawns.length, 1)
    } finally {
      t.mock.restoreAll()
      await f.close()
    }
  })
}

for (const boundary of ['authority', 'generation', 'record', 'other-controller'] as const) {
  test(`cancelled prepare retains uncertainty at the ${boundary} boundary`, async (t) => {
    const f = fixture()
    let release = () => {}
    let other: MemoryEngineController | undefined
    try {
      await f.emit('session_start')
      await f.turn(`prepare boundary ${boundary}`, 25)
      const binding = f.binding()!
      const before = f.store.snapshot()
      const engine = binding.value.engine
      const request = engine.request.bind(engine)
      let operation: { id: string; digest: string } | undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const delayed: typeof engine.request = async (method, input, context) => {
        const result = await request(method, input, context)
        if (method === 'prepare') {
          assert.ok('plan' in result)
          validatePlan(result.plan)
          operation = result.plan
          await gate
        }
        return result
      }
      t.mock.method(engine, 'request', delayed)
      const finishing = f.finish('completed')
      await until(() => operation !== undefined)
      const recordPath = join(f.root, '.views/.engine-v2/journal', `${operation!.id}.json`)
      await f.emit('input', { source: 'rpc', text: 'foreground boundary' })
      if (boundary === 'authority') f.revoke()
      if (boundary === 'generation') {
        const nodes = (globalThis as unknown as Record<symbol, Map<string, { generation: unknown }>>)[
          registry
        ]!
        nodes.get('primary')!.generation = {}
      }
      if (boundary === 'record') {
        const record = JSON.parse(readFileSync(recordPath, 'utf8'))
        record.sequence++
        // Even a still-'prepared' record with an unexpected CAS revision is uncertain.
        writeFileSync(recordPath, `${JSON.stringify(record)}\n`)
      }
      if (boundary === 'other-controller') {
        other = new MemoryEngineController(f.root)
        const recovered = await other.request(
          'recover',
          { plan: operation!.id, digest: operation!.digest },
          { current: () => true },
        )
        assert.equal(recovered.receipt.stage, 'unknown', 'another controller cannot adopt prepare ownership')
      }
      release()
      await finishing
      assert.equal(
        JSON.parse(readFileSync(recordPath, 'utf8')).receipt.stage,
        boundary === 'authority' || boundary === 'generation' ? 'prepared' : 'unknown',
      )
      assert.deepEqual(f.store.snapshot(), before)
      assert.ok(!existsSync(join(f.root, '.lock')))
      assert.equal(f.spawns.length, 1)
    } finally {
      release()
      t.mock.restoreAll()
      await other?.close()
      await f.close()
    }
  })
}

test('foreground cancellation after publication admission does not use never-published proof', async (t) => {
  const f = fixture()
  let release = () => {}
  try {
    await f.emit('session_start')
    await f.turn('publication admitted', 25)
    const binding = f.binding()!
    const before = f.store.snapshot()
    const engine = binding.value.engine
    const request = engine.request.bind(engine)
    let operation: { id: string; digest: string } | undefined
    let entered = false
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const delayed: typeof engine.request = async (method, input, context) => {
      const result = await request(method, input, context)
      if (method === 'prepare' && 'plan' in result) {
        validatePlan(result.plan)
        operation = result.plan
      }
      if (method === 'fence' && !entered) {
        entered = true
        await gate
      }
      return result
    }
    t.mock.method(engine, 'request', delayed)
    const finishing = f.finish('completed')
    await until(() => entered)
    await f.emit('input', { source: 'rpc', text: 'foreground during publication' })
    assert.equal(f.runtime.status().worker, false)
    release()
    await finishing
    const recordPath = join(f.root, '.views/.engine-v2/journal', `${operation!.id}.json`)
    assert.equal(
      JSON.parse(readFileSync(recordPath, 'utf8')).receipt.stage,
      'prepared',
      'automatic never-published cleanup cannot consume a publisher reservation',
    )
    assert.deepEqual(f.store.snapshot(), before)
    const recovered = (await f.runtime.run(
      'agent_memory_manage',
      {
        action: 'reconcile',
        target: operation!.id,
        revision: operation!.digest,
      },
      f.ctx,
    )) as any
    assert.equal(recovered.stage, 'not_committed_dirty', 'explicit recovery still uses actual executor drain')
    assert.equal(f.spawns.length, 1)
  } finally {
    release()
    t.mock.restoreAll()
    await f.close()
  }
})

test('foreground cancellation after the real commit retains publication evidence for exact recovery', async (t) => {
  const f = fixture()
  let release = () => {}
  try {
    await f.emit('session_start')
    await f.turn('committed before foreground', 25)
    const binding = f.binding()!
    const engine = binding.value.engine
    const request = engine.request.bind(engine)
    let operation: Plan | undefined
    let entered = false
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const delayed: typeof engine.request = async (method, input, context) => {
      const result = await request(method, input, context)
      if (method === 'prepare' && 'plan' in result) {
        validatePlan(result.plan)
        operation = result.plan
      }
      if (method === 'journal' && 'receipt' in input && input.receipt.stage === 'head_observed') {
        entered = true
        await gate
      }
      return result
    }
    t.mock.method(engine, 'request', delayed)
    const finishing = f.finish('completed')
    await until(() => entered)
    const committed = f.store.snapshot()
    assert.deepEqual(
      committed.reviewed,
      episodeIds(f.spawns[0]!.prompt).map((episode) => episode.id),
    )
    await f.emit('input', { source: 'rpc', text: 'foreground after real commit' })
    assert.equal(f.runtime.status().worker, false)
    release()
    await finishing
    const recordPath = join(f.root, '.views/.engine-v2/journal', `${operation!.id}.json`)
    assert.equal(JSON.parse(readFileSync(recordPath, 'utf8')).receipt.stage, 'head_observed')
    assert.ok(existsSync(join(f.root, '.lock')), 'revoked publisher does not clean its lock')
    assert.deepEqual(f.store.snapshot(), committed, 'cancellation is not rollback or safe-unpublished proof')
    const recovered = (await f.runtime.run(
      'agent_memory_manage',
      {
        action: 'reconcile',
        target: operation!.id,
        revision: operation!.digest,
      },
      f.ctx,
    )) as any
    assert.equal(recovered.stage, 'reconciled_committed')
    assert.equal(recovered.lockRetained, false)
    assert.deepEqual(f.store.snapshot(), committed, 'recovery observes the exact commit without replay')
    assert.equal(f.spawns.length, 1)
  } finally {
    release()
    t.mock.restoreAll()
    await f.close()
  }
})

test('ready writer completed after its 240-second deadline is not revived', async (t) => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await f.turn('expired completion', 25)
    const binding = f.binding()
    assert.ok(binding)
    t.mock.method(Date, 'now', () => binding.value.deadline + 1)
    await f.finish('completed')
    assert.deepEqual(f.store.snapshot().reviewed, [])
    assert.equal(f.runtime.status().worker, false)
    assert.equal(f.spawns.length, 1)
  } finally {
    t.mock.restoreAll()
    await f.close()
  }
})

test('automatic runtime counts assistant messages, chains bounded chunks, and stops after failure', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const core = f.store.snapshot().files['Core.md']?.text
    await f.compact()
    assert.equal(f.spawns.length, 0)
    await f.turn('alpha', 4)
    await f.turn('beta', 4)
    await f.turn('gamma', 4)
    await f.turn('delta', 4)
    await f.turn('epsilon', 8)
    assert.equal(f.spawns.length, 0, 'truncated actions and compaction are not the 25 assistant messages')
    await f.turn('zeta', 1)
    assert.equal(f.spawns.length, 1)
    assert.equal(f.spawns[0]?.options.foreground, false)
    const first = episodeIds(f.spawns[0]?.prompt ?? '')
    assert.equal(first.length, 4)
    assert.equal(first[0]?.kind, 'compaction')
    assert.ok((first.find((episode) => episode.kind !== 'compaction')?.actions?.length ?? 0) <= 4)
    await f.finish('completed')
    assert.equal(f.spawns.length, 2)
    const second = episodeIds(f.spawns[1]?.prompt ?? '')
    assert.equal(second.length, 3)
    assert.equal(
      second.some((episode) => first.some((delivered) => delivered.id === episode.id)),
      false,
    )
    const reviewed = new Set(f.store.snapshot().reviewed)
    assert.deepEqual(
      first.map((episode) => episode.id).every((id) => reviewed.has(id)),
      true,
    )
    assert.equal(
      second.some((episode) => reviewed.has(episode.id)),
      false,
    )
    assert.equal(f.store.snapshot().files['Core.md']?.text, core)
    await f.finish('failed')
    const afterFailure = new Set(f.store.snapshot().reviewed)
    assert.deepEqual([...afterFailure], [...reviewed])
    assert.equal(f.runtime.status().worker, false)
    assert.equal(f.spawns.length, 2)
  } finally {
    await f.close()
  }
})

test('input during automatic launch does not dispatch the stale batch', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const release = f.holdAuthorizations(3)
    const pending = f.turn('threshold', 25)
    await until(() => f.holds.count >= 1)
    const input = f.emit('input', { source: 'rpc', text: 'newer admission' })
    await until(() => f.holds.count >= 2)
    release()
    await pending
    await input
    assert.equal(f.spawns.length, 0)
    const originalId = digest('primary:user-threshold')
    await f.turn('recover-a', 25)
    assert.equal(f.spawns.length, 1)
    assert.deepEqual(
      episodeIds(f.spawns[0]?.prompt ?? '').map((episode) => episode.id),
      [originalId],
    )
    assert.deepEqual(f.store.snapshot().reviewed, [])
    await f.turn('recover-b', 25)
    assert.ok(f.spawns.length >= 1)
    assert.deepEqual(
      episodeIds(f.spawns[0]?.prompt ?? '').map((episode) => episode.id),
      [originalId],
    )
    assert.equal(f.store.snapshot().reviewed.includes(originalId), false)
    assert.equal(f.store.snapshot().reviewed.includes(digest('primary:user-recover-a')), false)
    assert.equal(f.store.snapshot().reviewed.includes(digest('primary:user-recover-b')), false)
  } finally {
    await f.close()
  }
})

test('ordinary input then before_agent_start observes the turn and can reach the writer threshold', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await f.emit('input', { source: 'rpc', text: 'ordinary' })
    f.branch.push({
      id: 'user-ordinary',
      type: 'message',
      parentId: null,
      message: { role: 'user', content: 'ordinary' },
    })
    await f.emit('before_agent_start', { systemPrompt: 'Base' })
    await f.emit('message_end', {
      message: { role: 'assistant', content: [{ type: 'text', text: 'ordinary assistant' }] },
    })
    await f.emit('agent_before_settle', { outcome: 'completed' })
    await f.emit('agent_settled', { aborted: false })
    assert.equal(f.spawns.length, 0)
    assert.ok(readdirSync(join(f.root, '.episodes')).includes(`${digest('primary:user-ordinary')}.json`))
    await f.emit('input', { source: 'rpc', text: 'threshold' })
    f.branch.push({
      id: 'user-threshold',
      type: 'message',
      parentId: 'user-ordinary',
      message: { role: 'user', content: 'threshold' },
    })
    await f.emit('before_agent_start', { systemPrompt: 'Base' })
    for (let index = 0; index < 24; index++)
      await f.emit('message_end', {
        message: { role: 'assistant', content: [{ type: 'text', text: `threshold assistant ${index}` }] },
      })
    await f.emit('agent_before_settle', { outcome: 'completed' })
    await f.emit('agent_settled', { aborted: false })
    assert.equal(f.spawns.length, 1)
    const ids = episodeIds(f.spawns[0]?.prompt ?? '').map((episode) => episode.id)
    assert.deepEqual(ids, [digest('primary:user-ordinary'), digest('primary:user-threshold')])
    assert.deepEqual(f.store.snapshot().reviewed, [])
  } finally {
    await f.close()
  }
})

test('foreground during settled resolve cannot dispatch that continuation', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const release = f.holdAuthorizations(2)
    const pending = f.turn('threshold', 25)
    await until(() => f.holds.count >= 1)
    const foreground = f.emit('before_agent_start', { systemPrompt: 'Custom trigger' })
    await until(() => f.holds.count >= 2)
    release()
    await pending
    await foreground
    assert.equal(f.spawns.length, 0)
    assert.ok(readdirSync(join(f.root, '.episodes')).includes(`${digest('primary:user-threshold')}.json`))
  } finally {
    await f.close()
  }
})

test('before_agent_start invalidates a pending automatic launch before authorization resumes', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const release = f.holdAuthorizations(3)
    const pending = f.turn('threshold', 25)
    await until(() => f.holds.count >= 1)
    const foreground = f.emit('before_agent_start', { systemPrompt: 'Base' })
    await until(() => f.holds.count >= 2)
    release()
    await pending
    await foreground
    assert.equal(f.spawns.length, 0)
    await f.compact()
    assert.equal(f.spawns.length, 0)
    assert.ok(
      readdirSync(join(f.root, '.episodes')).includes(`${digest('primary:compact:compact-one')}.json`),
    )
    await f.runtime.startWriter(f.ctx, 'Explicit assignment')
    assert.equal(f.spawns.length, 1)
    assert.match(f.spawns[0]?.prompt ?? '', /Explicit assignment/)
  } finally {
    await f.close()
  }
})

test('a full unreviewed directory launches one bounded backlog writer without new assistant steps', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const seeded: Episode[] = Array.from({ length: 256 }, (_, index) => ({
      id: digest(`capacity-${index}`),
      project: 'project',
      session: 'synthetic-session',
      evidence: 'observed-native-unverified',
      observedAt: `2026-01-01T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      entryHash: digest(`capacity-entry-${index}`),
      input: { text: `Settled note ${index}`, source: 'rpc' },
      actions: [{ text: 'Verified outcome' }],
      results: [],
      outcome: 'completed',
    }))
    for (const episode of seeded) f.store.recordEpisode(episode.id, episode)
    await f.turn('blocked', 1)
    assert.equal(f.spawns.length, 1)
    const delivered = episodeIds(f.spawns[0]?.prompt ?? '')
    assert.equal(delivered.length, 4)
    assert.deepEqual(
      delivered.map((episode) => episode.id),
      seeded.slice(0, 4).map((episode) => episode.id),
    )
    assert.deepEqual(f.store.snapshot().reviewed, [])
    assert.equal(f.spawns.length, 1)
  } finally {
    await f.close()
  }
})

test('a cancelled capacity writer can launch one later backlog drain without reviewing old episodes', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const seeded: Episode[] = Array.from({ length: 256 }, (_, index) => ({
      id: digest(`capacity-retry-${index}`),
      project: 'project',
      session: 'synthetic-session',
      evidence: 'observed-native-unverified',
      observedAt: `2026-02-01T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      entryHash: digest(`capacity-retry-entry-${index}`),
      input: { text: `Settled note ${index}`, source: 'rpc' },
      actions: [{ text: 'Verified outcome' }],
      results: [],
      outcome: 'completed',
    }))
    for (const episode of seeded) f.store.recordEpisode(episode.id, episode)
    const before = readdirSync(join(f.root, '.episodes'))
      .filter((name) => name.endsWith('.json'))
      .sort()
    await f.turn('blocked', 1)
    assert.equal(f.spawns.length, 1)
    await f.emit('input', { source: 'rpc', text: 'cancel the capacity writer' })
    await f.runtime.drain()
    await f.turn('later', 50)
    assert.equal(f.spawns.length, 2)
    const recovered = episodeIds(f.spawns[1]?.prompt ?? '')
    assert.deepEqual(
      recovered.map((episode) => episode.id),
      seeded.slice(0, 4).map((episode) => episode.id),
    )
    assert.deepEqual(f.store.snapshot().reviewed, [])
    assert.deepEqual(
      readdirSync(join(f.root, '.episodes'))
        .filter((name) => name.endsWith('.json'))
        .sort(),
      before,
    )
  } finally {
    await f.close()
  }
})

test('foreground during episode credit refresh cannot dispatch the stale continuation', async () => {
  const original = MemoryEngineController.prototype.request
  let release = () => {}
  let held = false
  let arm = false
  MemoryEngineController.prototype.request = async function (
    this: MemoryEngineController,
    method,
    input,
    context,
  ) {
    const result = await original.call(this, method, input, context)
    if (method === 'episodeCredit' && arm) {
      held = true
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
    return result
  } as typeof original
  const f = fixture()
  try {
    await f.emit('session_start')
    for (const name of ['one', 'two', 'three', 'four', 'five']) await f.turn(name, 5)
    assert.equal(f.spawns.length, 1)
    arm = true
    const pending = f.finish('completed')
    await until(() => held)
    await f.emit('before_agent_start', { systemPrompt: 'Base' })
    release()
    await pending
    assert.equal(f.spawns.length, 1)
  } finally {
    release()
    MemoryEngineController.prototype.request = original
    await f.close()
  }
})

test('retired runtime keeps credited steps below threshold and launches when a later observation crosses it', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    for (const name of ['one', 'two', 'three', 'four']) await f.turn(name, 5)
    assert.equal(f.spawns.length, 0)
    await f.emit('session_start')
    assert.equal(f.spawns.length, 0)
    await f.turn('five', 5)
    assert.equal(f.spawns.length, 1)
    assert.equal(
      episodeIds(f.spawns[0]?.prompt ?? '').some((episode) => episode.id === digest('primary:user-one')),
      true,
    )
  } finally {
    await f.close()
  }
})

test('reflection observes one new turn after more than 8193 historical entries', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    let parent: string | null = null
    for (let index = 0; index < 8194; index++) {
      const id = `history-${index}`
      f.branch.push({
        id,
        type: 'message',
        parentId: parent,
        message: { role: 'user', content: 'old' },
      })
      parent = id
    }
    f.ctx.sessionManager.getBranch = () => {
      throw Error('getBranch refused')
    }
    await f.turn('after-history', 1)
    assert.ok(readdirSync(join(f.root, '.episodes')).includes(`${digest('primary:user-after-history')}.json`))
  } finally {
    await f.close()
  }
})

const selectReflection = async (
  f: ReturnType<typeof fixture>,
  trigger: 'off' | 'step-count' | 'compaction-event',
  stepCount: number,
  automatic: boolean,
) => {
  const revision = f.store.snapshot().revision
  const configHash = digest(JSON.stringify(f.store.config()))
  await f.runtime.run(
    'agent_memory_manage',
    {
      action: 'policy',
      revision,
      configHash,
      automatic,
      reflectionTrigger: trigger,
      reflectionStepCount: stepCount,
    },
    f.ctx,
  )
}

test('compaction-event launches from a paired compaction and not from assistant steps', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await selectReflection(f, 'compaction-event', 25, true)
    await f.turn('alpha', 5)
    assert.equal(f.spawns.length, 0)
    await f.emit('session_before_compact', {
      reason: 'manual',
      willRetry: false,
      signal: new AbortController().signal,
      preparation: { tokensBefore: 10 },
    })
    assert.equal(f.spawns.length, 0)
    await f.compact()
    await until(() => f.spawns.length === 1)
    const delivered = episodeIds(f.spawns[0]?.prompt ?? '').map((episode) => episode.id)
    const turnId = digest('primary:user-alpha')
    const compactId = digest('primary:compact:compact-one')
    assert.ok(delivered.includes(turnId))
    assert.ok(delivered.includes(compactId))
    await f.finish('completed')
    const reviewed = new Set(f.store.snapshot().reviewed)
    assert.equal(
      delivered.every((id) => reviewed.has(id)),
      true,
    )
    assert.equal(
      [...reviewed].every((id) => delivered.includes(id)),
      true,
    )
  } finally {
    await f.close()
  }
})

test('compaction-event does not open the ordinary capacity drain', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await selectReflection(f, 'compaction-event', 25, true)
    const seeded: Episode[] = Array.from({ length: 256 }, (_, index) => ({
      id: digest(`capacity-event-${index}`),
      project: 'project',
      session: 'synthetic-session',
      evidence: 'observed-native-unverified',
      observedAt: `2026-01-01T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      entryHash: digest(`capacity-event-entry-${index}`),
      input: { text: `Settled note ${index}`, source: 'rpc' },
      actions: [{ text: 'Verified outcome' }],
      results: [],
      outcome: 'completed',
    }))
    for (const episode of seeded) f.store.recordEpisode(episode.id, episode)
    await f.turn('blocked', 1)
    assert.equal(f.spawns.length, 0)
  } finally {
    await f.close()
  }
})

test('paired compaction at capacity delivers the stored backlog and not the unwritten compaction', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await selectReflection(f, 'compaction-event', 25, true)
    const seeded: Episode[] = Array.from({ length: 256 }, (_, index) => ({
      id: digest(`capacity-compact-${index}`),
      project: 'project',
      session: 'synthetic-session',
      evidence: 'observed-native-unverified',
      observedAt: `2026-03-01T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      entryHash: digest(`capacity-compact-entry-${index}`),
      input: { text: `Settled note ${index}`, source: 'rpc' },
      actions: [{ text: 'Verified outcome' }],
      results: [],
      outcome: 'completed',
    }))
    for (const episode of seeded) f.store.recordEpisode(episode.id, episode)
    await f.turn('blocked', 1)
    assert.equal(f.spawns.length, 0)
    await f.compact()
    await until(() => f.spawns.length === 1)
    const delivered = episodeIds(f.spawns[0]?.prompt ?? '').map((episode) => episode.id)
    const compactId = digest('primary:compact:compact-one')
    assert.deepEqual(
      delivered,
      seeded.slice(0, 4).map((episode) => episode.id),
    )
    assert.equal(delivered.includes(compactId), false)
    assert.equal(readdirSync(join(f.root, '.episodes')).includes(`${compactId}.json`), false)
    assert.deepEqual(f.store.snapshot().reviewed, [])
    await f.finish('completed')
    assert.deepEqual(f.store.snapshot().reviewed.slice().sort(), delivered.slice().sort())
  } finally {
    await f.close()
  }
})

test('a launch fence change after compaction capacity does not dispatch that backlog', async () => {
  const original = MemoryEngineController.prototype.request
  let release = () => {}
  let held = false
  MemoryEngineController.prototype.request = async function (
    this: MemoryEngineController,
    method,
    input,
    context,
  ) {
    if (method === 'episodeBacklog' && !held) {
      held = true
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
    return original.call(this, method, input, context)
  } as typeof original
  const f = fixture()
  try {
    await f.emit('session_start')
    await selectReflection(f, 'compaction-event', 25, true)
    for (const episode of Array.from({ length: 256 }, (_, index) => ({
      id: digest(`capacity-fence-${index}`),
      project: 'project',
      session: 'synthetic-session',
      evidence: 'observed-native-unverified' as const,
      observedAt: `2026-04-01T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      entryHash: digest(`capacity-fence-entry-${index}`),
      input: { text: `Settled note ${index}`, source: 'rpc' },
      actions: [{ text: 'Verified outcome' }],
      results: [] as [],
      outcome: 'completed' as const,
    })))
      f.store.recordEpisode(episode.id, episode)
    const pending = f.compact()
    await until(() => held)
    await f.emit('before_agent_start', { systemPrompt: 'Base' })
    release()
    await pending
    await f.runtime.drain()
    assert.equal(f.spawns.length, 0)
    assert.equal(f.store.snapshot().reviewed.length, 0)
    assert.equal(
      readdirSync(join(f.root, '.episodes')).includes(`${digest('primary:compact:compact-one')}.json`),
      false,
    )
  } finally {
    release()
    MemoryEngineController.prototype.request = original
    await f.close()
  }
})

test('configured step-count launches at that positive threshold', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await selectReflection(f, 'step-count', 1, true)
    await f.turn('one', 1)
    await until(() => f.spawns.length === 1)
    assert.equal(f.spawns.length, 1)
  } finally {
    await f.close()
  }
})

test('cancellation during compaction-event admission does not launch', async () => {
  const f = fixture()
  let release: () => void = () => undefined
  try {
    await f.emit('session_start')
    await selectReflection(f, 'compaction-event', 25, true)
    const start = f.authorizations()
    release = f.holdAuthorizations(0)
    const pending = f.compact()
    await until(() => f.authorizations() > start)
    const cancel = f.runtime.run('agent_memory_manage', { action: 'cancel' }, f.ctx)
    await until(() => f.authorizations() > start + 1)
    release()
    await pending
    await cancel
    await f.runtime.drain()
    assert.equal(f.spawns.length, 0)
  } finally {
    release()
    await f.close()
  }
})

test('a high step threshold recovers tracked episodes after the directory fills', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await selectReflection(f, 'step-count', 1000, true)
    const ids: string[] = []
    for (let index = 0; index < 256; index++) {
      const name = `n${index}`
      await f.turn(name, 1)
      ids.push(digest(`primary:user-${name}`))
    }
    assert.equal(f.spawns.length, 0)
    await f.turn('blocked', 1)
    assert.equal(f.spawns.length, 1)
    const delivered = episodeIds(f.spawns[0]?.prompt ?? '').map((episode) => episode.id)
    assert.deepEqual(delivered, ids.slice(0, 4))
    assert.deepEqual(f.store.snapshot().reviewed, [])
    await f.emit('input', { source: 'rpc', text: 'cancel the capacity writer' })
    await f.runtime.drain()
    await f.turn('later', 1)
    assert.equal(f.spawns.length, 2)
    const recovered = episodeIds(f.spawns[1]?.prompt ?? '').map((episode) => episode.id)
    // The first capture freezes pending ids 0..31. Cancellation retires that drain
    // without reviewing them, so the next capture continues at the following pending ids.
    assert.deepEqual(recovered, ids.slice(32, 36))
    assert.deepEqual(f.store.snapshot().reviewed, [])
    const files = readdirSync(join(f.root, '.episodes')).filter((name) => name.endsWith('.json'))
    assert.equal(files.length, 256)
    await f.finish('completed')
    assert.deepEqual(f.store.snapshot().reviewed.slice().sort(), recovered.slice().sort())
    assert.equal(readdirSync(join(f.root, '.episodes')).filter((name) => name.endsWith('.json')).length, 256)
  } finally {
    await f.close()
  }
})

test('matched verification command stays with its result and recognized secrets stay out of the queue and writer prompt', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await selectReflection(f, 'step-count', 1, true)
    const text = 'run the check'
    const secret = `ghp_${'c'.repeat(24)}`
    const malformed = 'Bea%72er%2Z synthetic-token-value'
    const composed = '\\u0026#66;earer\\u0026#32;synthetic-token-value'
    const quoted = '{"password":"synthetic-value"}'
    const quotedEncoded = '%7B%22password%22%3A%22synthetic-value%22%7D'
    const excerpt = `${'Q'.repeat(2048)}${secret}`
    await f.emit('input', { source: 'rpc', text })
    f.branch.push({
      id: `user-${text}`,
      type: 'message',
      parentId: f.branch.at(-1)?.id ?? null,
      message: { role: 'user', content: text },
    })
    await f.emit('before_agent_start', { systemPrompt: 'Base' })
    await f.emit('message_end', {
      message: { role: 'assistant', content: [{ type: 'text', text: 'I will run the check.' }] },
    })
    const bash = async (id: string, command: string, result: string, extra: Record<string, string> = {}) => {
      await f.emit('tool_execution_start', {
        toolName: 'bash',
        toolCallId: id,
        args: { command, ...extra },
      })
      await f.emit('tool_execution_end', {
        toolName: 'bash',
        toolCallId: id,
        isError: false,
        result: { content: [{ type: 'text', text: result }] },
      })
    }
    await bash('excerpt', 'pnpm check', excerpt)
    await bash('malformed', 'pnpm test', malformed)
    await bash('composed', 'pnpm check', composed)
    await bash('quoted', 'pnpm test', quoted)
    await bash('quoted-encoded', 'pnpm check', quotedEncoded)
    await bash('newline', 'pnpm check\n', 'NEWLINE_COMMAND')
    await bash('newline-node', 'node --test test/example.test.ts\n', 'NEWLINE_NODE')
    await bash('colon', 'pnpm check:fast', 'coverage 100%')
    await bash('private-command', 'cat profile', 'PRIVATE_COMMAND_RESULT')
    await bash('shell', 'node --test test/foo.test.ts;id', 'SHELL_META')
    const many = Array.from({ length: verificationPartLimit + 1 }, (_, index) => ({
      type: 'text',
      text: index === verificationPartLimit ? secret : 'part',
    }))
    await f.emit('tool_execution_start', {
      toolName: 'bash',
      toolCallId: 'many',
      args: { command: 'pnpm check' },
    })
    await f.emit('tool_execution_end', {
      toolName: 'bash',
      toolCallId: 'many',
      isError: false,
      result: { content: many },
    })
    const wide = Array.from({ length: 3 }, (_, index) => ({
      type: 'text',
      text: index === 2 ? `${'W'.repeat(800)}${secret}` : 'W'.repeat(800),
    }))
    await f.emit('tool_execution_start', {
      toolName: 'bash',
      toolCallId: 'wide',
      args: { command: 'pnpm test' },
    })
    await f.emit('tool_execution_end', {
      toolName: 'bash',
      toolCallId: 'wide',
      isError: false,
      result: { content: wide },
    })
    await f.emit('tool_execution_start', {
      toolName: 'bash',
      toolCallId: 'error-echo',
      args: { command: 'pnpm check', raw: 'PRIVATE_ARGUMENTS' },
    })
    await f.emit('tool_execution_end', {
      toolName: 'bash',
      toolCallId: 'error-echo',
      isError: `echo ${secret}`,
      result: { content: [{ type: 'text', text: 'should not echo' }] },
    })
    await f.emit('tool_execution_start', {
      toolName: 'bash',
      toolCallId: 'keep',
      args: { command: 'pnpm check' },
    })
    await f.emit('tool_execution_end', {
      toolName: 'bash',
      toolCallId: 'other',
      isError: false,
      result: { content: [{ type: 'text', text: 'MISMATCHED_RESULT' }] },
    })
    await f.emit('tool_execution_end', {
      toolName: 'bash',
      toolCallId: 'keep',
      isError: false,
      result: { content: [{ type: 'text', text: 'format ok' }] },
    })
    for (const toolName of ['agent_memory_read', 'agent_memory_edit', 'profile', 'unknown_tool']) {
      await f.emit('tool_execution_start', {
        toolName,
        toolCallId: toolName,
        args: { command: 'pnpm check', path: 'PRIVATE_PROFILE' },
      })
      await f.emit('tool_execution_end', {
        toolName,
        toolCallId: toolName,
        isError: false,
        result: { content: [{ type: 'text', text: `${toolName} PRIVATE_CALL` }] },
      })
    }
    await bash('literal', 'pnpm test', 'omit')
    await bash('legacy-node', 'node --test secrets/token', '1 passed')
    await f.emit('agent_before_settle', { outcome: 'completed' })
    await f.emit('agent_settled', { aborted: false })
    await until(() => f.spawns.length === 1)
    const id = digest(`primary:user-${text}`)
    const queued = readFileSync(join(f.root, '.episodes', `${id}.json`), 'utf8')
    const prompt = f.spawns[0]?.prompt ?? ''
    const stored = JSON.parse(queued) as {
      results: { tool: string; error: boolean; command: string; text: string }[]
    }
    assert.deepEqual(
      stored.results.map((result) => [result.command, result.text]),
      [
        [undefined, 'coverage 100%'],
        ['pnpm check', 'format ok'],
        ['pnpm test', 'omit'],
        [undefined, '1 passed'],
      ],
    )
    assert.equal(JSON.parse(prompt).episodes[0].results[2].text, 'omit')
    for (const marker of [
      secret,
      malformed,
      composed,
      quoted,
      quotedEncoded,
      'synthetic-value',
      'NEWLINE_COMMAND',
      'NEWLINE_NODE',
      'PRIVATE_COMMAND_RESULT',
      'SHELL_META',
      'MISMATCHED_RESULT',
      'PRIVATE_ARGUMENTS',
      'PRIVATE_PROFILE',
      'PRIVATE_CALL',
      'should not echo',
      'Q'.repeat(64),
      'W'.repeat(64),
      'secrets/token',
      'pnpm check:fast',
      'node --test',
    ]) {
      assert.equal(queued.includes(marker), false, marker)
      assert.equal(prompt.includes(marker), false, marker)
    }
  } finally {
    await f.close()
  }
})

test('explicit ABI2 reflection selects no pending turn before agent_settled and one after settlement', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await f.emit('input', { source: 'rpc', text: 'Synthetic capture boundary' })
    f.branch.push({
      id: 'capture-boundary-user',
      type: 'message',
      parentId: null,
      message: { role: 'user', content: 'Synthetic capture boundary' },
    })
    await f.emit('before_agent_start', { systemPrompt: 'Base' })
    await f.emit('message_end', {
      message: { role: 'assistant', content: [{ type: 'text', text: 'Short synthetic answer.' }] },
    })
    await f.emit('agent_before_settle', { outcome: 'completed' })
    await f.runtime.run('agent_memory_reflect', { assignment: 'Review synthetic capture' }, f.ctx)
    assert.equal(f.spawns.length, 1)
    assert.deepEqual(episodeIds(f.spawns[0]!.prompt), [], 'pending evidence is not yet selectable')
    assert.equal(f.runtime.status().worker, true, 'explicit empty selection still dispatches a writer')
    await f.finish('completed')
    assert.equal(f.runtime.status().worker, false)
    assert.deepEqual(f.store.snapshot().reviewed, [])

    await f.emit('agent_settled', { aborted: false })
    assert.equal(f.spawns.length, 1, 'one assistant event does not reach the automatic trigger')
    await f.runtime.run('agent_memory_reflect', { assignment: 'Review synthetic capture' }, f.ctx)
    assert.equal(f.spawns.length, 2)
    const selected = episodeIds(f.spawns[1]!.prompt)
    assert.equal(selected.length, 1)
    assert.equal(selected[0]!.id, digest('primary:capture-boundary-user'))
    assert.deepEqual(selected[0]!.actions, [{ text: 'Short synthetic answer.' }])
    await f.finish('completed')
    assert.equal(f.runtime.status().worker, false)
    assert.deepEqual(
      f.store.snapshot().reviewed,
      selected.map((episode) => episode.id),
    )
    assert.equal(f.runtime.status().lastError, undefined)
  } finally {
    await f.close()
  }
})

for (const assistantText of ['Short synthetic answer.', 'A'.repeat(2049)])
  test(`explicit ABI2 reflection after settlement selects ${assistantText.length > 2048 ? 0 : 1} episodes for ${assistantText.length}-byte ASCII assistant text`, async () => {
    const f = fixture()
    try {
      await f.emit('session_start')
      // Only assistant text varies: no tools, verification results, or other actions can retain the turn.
      await f.emit('input', { source: 'rpc', text: 'Synthetic text boundary' })
      f.branch.push({
        id: 'text-boundary-user',
        type: 'message',
        parentId: null,
        message: { role: 'user', content: 'Synthetic text boundary' },
      })
      await f.emit('before_agent_start', { systemPrompt: 'Base' })
      await f.emit('message_end', {
        message: { role: 'assistant', content: [{ type: 'text', text: assistantText }] },
      })
      await f.emit('agent_before_settle', { outcome: 'completed' })
      await f.emit('agent_settled', { aborted: false })
      assert.equal(f.spawns.length, 0)
      await f.runtime.run('agent_memory_reflect', { assignment: 'Review synthetic capture' }, f.ctx)
      assert.equal(f.spawns.length, 1)
      const selected = episodeIds(f.spawns[0]!.prompt)
      // Current capture rejects the over-limit action, rather than truncating it. With no remaining
      // actions, the settled turn is not recorded. This does not diagnose a live empty selection.
      if (assistantText.length > 2048) assert.deepEqual(selected, [])
      else {
        assert.equal(selected.length, 1)
        assert.equal(selected[0]!.id, digest('primary:text-boundary-user'))
        assert.deepEqual(selected[0]!.actions, [{ text: assistantText }])
      }
      await f.finish('completed')
      assert.equal(f.runtime.status().worker, false)
      assert.deepEqual(
        f.store.snapshot().reviewed,
        selected.map((episode) => episode.id),
      )
      assert.equal(f.runtime.status().lastError, undefined)
    } finally {
      await f.close()
    }
  })

test('legacy episodes without a verification command still deliver', async () => {
  const f = fixture()
  try {
    const legacy = {
      id: digest('primary:legacy-evidence'),
      project: 'project',
      session: 'primary',
      evidence: 'observed-native-unverified' as const,
      observedAt: '2026-08-01T00:00:00.000Z',
      entryHash: digest('legacy-evidence'),
      input: { text: 'legacy input', source: 'rpc' as const },
      actions: [{ text: 'legacy action' }],
      results: [{ tool: 'bash' as const, error: false, text: 'legacy result' }],
      outcome: 'completed' as const,
    }
    const parsed = observedEpisode(legacy)
    if ('kind' in parsed) throw Error('legacy turn was read as compaction')
    assert.equal('command' in parsed.results[0], false)
    f.store.recordEpisode(legacy.id, legacy)
    await f.emit('session_start')
    await f.runtime.run('agent_memory_reflect', { assignment: 'Review the legacy episode' }, f.ctx)
    await until(() => f.spawns.length === 1)
    const delivered = JSON.parse(f.spawns[0]?.prompt ?? '').episodes[0]
    assert.equal(delivered.results[0].text, 'legacy result')
    assert.equal(delivered.results[0].command, undefined)
    assert.equal(f.spawns[0]?.prompt.includes('legacy result'), true)
  } finally {
    await f.close()
  }
})

test('delivery revalidation rejects a recognized secret without echoing it', async () => {
  const f = fixture()
  try {
    const malformed = 'Bea%72er%2Z synthetic-token-value'
    const poisoned = {
      id: digest('primary:poisoned-evidence'),
      project: 'project',
      session: 'primary',
      evidence: 'observed-native-unverified' as const,
      observedAt: '2026-08-01T00:00:00.000Z',
      entryHash: digest('poisoned-evidence'),
      input: { text: 'poison input', source: 'rpc' as const },
      actions: [{ text: 'poison action' }],
      results: [{ tool: 'bash' as const, error: false, command: 'pnpm check', text: malformed }],
      outcome: 'completed' as const,
    }
    assert.throws(
      () => observedEpisode(poisoned),
      (error: unknown) => {
        assert.doesNotMatch(String(error), /Bearer|%2Z|pnpm check|malformed/)
        return true
      },
    )
    assert.throws(
      () =>
        observedEpisode({
          ...poisoned,
          id: digest('primary:bad-command'),
          results: [{ tool: 'bash', error: false, command: 'cat profile', text: 'omitted' }],
        }),
      (error: unknown) => {
        assert.doesNotMatch(String(error), /cat profile|omitted/)
        return true
      },
    )
    assert.throws(
      () =>
        observedEpisode({
          ...poisoned,
          id: digest('primary:absolute-command'),
          results: [
            {
              tool: 'bash',
              error: false,
              command: 'node --test /tmp/secret.test.ts',
              text: 'ABSOLUTE_STORED',
            },
          ],
        }),
      (error: unknown) => {
        assert.doesNotMatch(String(error), /\/tmp\/secret|ABSOLUTE_STORED/)
        return true
      },
    )
    assert.throws(
      () =>
        observedEpisode({
          ...poisoned,
          id: digest('primary:composed-evidence'),
          results: [
            {
              tool: 'bash',
              error: false,
              command: 'pnpm test',
              text: '\\u0026#66;earer\\u0026#32;synthetic-token-value',
            },
          ],
        }),
      (error: unknown) => {
        assert.doesNotMatch(String(error), /Bearer|synthetic-token|\\u0026/)
        return true
      },
    )
    mkdirSync(join(f.root, '.episodes'), { mode: 0o700 })
    writeFileSync(join(f.root, '.episodes', `${poisoned.id}.json`), `${JSON.stringify(poisoned)}\n`, {
      mode: 0o600,
    })
    await f.emit('session_start')
    await assert.rejects(
      () => f.runtime.run('agent_memory_reflect', { assignment: 'Do not deliver the secret' }, f.ctx),
      (error: unknown) => {
        assert.doesNotMatch(String(error), /Bearer|%2Z|synthetic-token/)
        return true
      },
    )
    assert.equal(f.spawns.length, 0)
  } finally {
    await f.close()
  }
})

test('cancellation and revocation drop an in-flight verification capture', async () => {
  for (const mode of ['cancel', 'revoke'] as const) {
    const f = fixture()
    try {
      await f.emit('session_start')
      await selectReflection(f, 'step-count', 1, true)
      const text = mode
      await f.emit('input', { source: 'rpc', text })
      f.branch.push({
        id: `user-${text}`,
        type: 'message',
        parentId: null,
        message: { role: 'user', content: text },
      })
      await f.emit('before_agent_start', { systemPrompt: 'Base' })
      await f.emit('message_end', {
        message: { role: 'assistant', content: [{ type: 'text', text: 'stop before writing' }] },
      })
      await f.emit('tool_execution_start', {
        toolName: 'bash',
        toolCallId: mode,
        args: { command: 'pnpm check' },
      })
      await f.emit('tool_execution_end', {
        toolName: 'bash',
        toolCallId: mode,
        isError: false,
        result: { content: [{ type: 'text', text: `${mode}-marker` }] },
      })
      if (mode === 'cancel') await f.runtime.cancel()
      else f.revoke()
      await f.emit('agent_before_settle', { outcome: 'completed' })
      await f.emit('agent_settled', { aborted: false })
      await f.runtime.drain()
      assert.equal(f.spawns.length, 0, mode)
      const folder = join(f.root, '.episodes')
      const written =
        existsSync(folder) &&
        readdirSync(folder).some((name) => name === `${digest(`primary:user-${text}`)}.json`)
      assert.equal(written, false, mode)
      assert.equal(
        f.spawns.some((spawn) => spawn.prompt.includes(`${mode}-marker`) || spawn.prompt.includes('%2Z')),
        false,
      )
    } finally {
      await f.close()
    }
  }
})

test('commandless coverage and Windows-path results still enumerate another project', async () => {
  const f = fixture()
  const engine = new MemoryEngineController(f.root, engineEnvironment(process.env))
  try {
    const folder = join(f.root, '.episodes')
    mkdirSync(folder, { mode: 0o700 })
    const write = (name: string, project: string, text: string, steps: number) => {
      const episode = {
        id: digest(`primary:${name}`),
        project,
        session: 'primary',
        evidence: 'observed-native-unverified' as const,
        observedAt: '2026-08-01T00:00:00.000Z',
        entryHash: digest(name),
        input: { text: name, source: 'rpc' as const },
        actions: [{ text: 'kept' }],
        results: [{ tool: 'bash' as const, error: false, text }],
        outcome: 'completed' as const,
        assistantSteps: steps,
      }
      writeFileSync(join(folder, `${episode.id}.json`), `${JSON.stringify(episode)}\n`, { mode: 0o600 })
      return episode.id
    }
    const coverage = write('coverage', 'project', '100%', 2)
    const windows = write('windows', 'project', 'C:\\users\\test', 3)
    const sibling = write('sibling', 'other', 'other project ok', 4)
    const before = readdirSync(folder).sort()
    const context = { current: () => true }
    const projectBacklog = await engine.request('episodeBacklog', { project: 'project', limit: 32 }, context)
    const otherBacklog = await engine.request('episodeBacklog', { project: 'other', limit: 32 }, context)
    const projectCredit = await engine.request(
      'episodeCredit',
      { project: 'project', session: 'primary' },
      context,
    )
    const otherCredit = await engine.request(
      'episodeCredit',
      { project: 'other', session: 'primary' },
      context,
    )
    assert.deepEqual(projectBacklog.ids.slice().sort(), [coverage, windows].sort())
    assert.deepEqual(otherBacklog.ids, [sibling])
    assert.deepEqual(projectCredit, { steps: 5 })
    assert.deepEqual(otherCredit, { steps: 4 })
    assert.deepEqual(readdirSync(folder).sort(), before)
    const stored = JSON.parse(readFileSync(join(folder, `${coverage}.json`), 'utf8')) as {
      results: { command?: string; text: string }[]
    }
    assert.equal(stored.results[0]?.text, '100%')
    assert.equal(stored.results[0]?.command, undefined)
    const pathText = JSON.parse(readFileSync(join(folder, `${windows}.json`), 'utf8')) as {
      results: { text: string }[]
    }
    assert.equal(pathText.results[0]?.text, 'C:\\users\\test')
  } finally {
    await engine.close()
    await f.close()
  }
})
