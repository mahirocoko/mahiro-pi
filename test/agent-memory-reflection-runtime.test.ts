import assert from 'node:assert/strict'
import {
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
import { createExperimentalMemoryRuntime } from '../lib/agent-memory/experimental-runtime.ts'
import { MemoryEngineController } from '../lib/agent-memory/engine/controller.ts'
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
    assertAccess() {
      if (!granted) throw Error('Denied synthetic authority')
      return { kind: 'primary' as const }
    },
    assertTargets() {
      abi.assertAccess()
    },
    maintenanceAccess() {
      return abi.assertAccess()
    },
    async authorize() {
      authorizations += 1
      if (authorizations > blockAfter && gate) {
        holds.count += 1
        await gate
      }
      return abi.assertAccess()
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
    async finish(status: 'completed' | 'failed') {
      const spawned = spawns.at(-1)
      if (!spawned || !binding) throw Error('No writer to finish')
      if (status === 'completed') {
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
    async close() {
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
  const started = Date.now()
  while (!ready()) {
    if (Date.now() - started > 5000) assert.equal(ready(), true)
    await yieldTurn()
  }
}

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
