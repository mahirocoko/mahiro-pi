import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as yieldTurn } from 'node:timers/promises'
import test from 'node:test'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  compactionBoundary,
  compactionObservation as pairedCompactionObservation,
} from '../lib/agent-memory/compaction.ts'
import { createExperimentalMemoryRuntime } from '../lib/agent-memory/experimental-runtime.ts'
import { createAgentMemoryRuntime } from '../lib/agent-memory/runtime.ts'
import { MemoryEngineController } from '../lib/agent-memory/engine/controller.ts'
import { observedEpisode, serializeCompactionMetadata } from '../lib/agent-memory/engine/episodes.ts'
import { createPrivate, engineEnvironment, readPrivate } from '../lib/agent-memory/engine/io.ts'
import { validateReply } from '../lib/agent-memory/engine/replies.ts'
import { createMemoryStore, type CompactionEpisode, type Episode } from '../lib/agent-memory/store.ts'
import { digest } from '../lib/continuity/records.ts'
import { syntheticCompaction } from './helpers/compaction.ts'

const registry = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => (resolve = yes))
  return { promise, resolve }
}

const beforeCompaction = (event: ReturnType<typeof syntheticCompaction>) => ({
  reason: event.reason,
  willRetry: event.willRetry,
  signal: new AbortController().signal,
})
// Reconstruct a before/after pair only for the synthetic unit branch. Real SDK tests
// below use genuine host events and never remove/reinsert native session entries.
const compactionObservation = (event: ReturnType<typeof syntheticCompaction>, ctx: ExtensionContext) => {
  const branch = ctx.sessionManager.getBranch()
  const leaf = branch.pop()!
  let boundary: ReturnType<typeof compactionBoundary>
  try {
    boundary = compactionBoundary(beforeCompaction(event), ctx)
  } finally {
    branch.push(leaf)
  }
  return pairedCompactionObservation(event, ctx, boundary)
}

// Controlled ABI/permission doubles + real private store/data child. Not kernel/PSS proof.
function fixture(version: 1 | 2 = 2) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'memory-compaction-'))
  const root = join(directory, 'memory')
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
    '[user]\n name = Synthetic\n email = fixture@example.invalid\n',
  )
  const cwd = join(directory, 'project')
  mkdirSync(cwd)
  const store = createMemoryStore(root)
  const config = {
    version: 1 as const,
    projects: [{ cwd, id: 'synthetic' }],
    coreBytes: 8192,
    indexBytes: 2048,
    fileBytes: 8192,
    totalBytes: 65536,
    automatic: true,
  }
  store.initialize(config, '# Core\nSYNTHETIC_COMPACTION_CORE\n')
  const handlers = new Map<string, Function[]>()
  const tools = ['agent_memory_read', 'agent_memory_reflect', 'agent_memory_manage'].map((name) => ({ name }))
  const pi = {
    on(name: string, fn: Function) {
      if (!handlers.has(name)) handlers.set(name, [])
      handlers.get(name)!.push(fn)
    },
    getAllTools: () => tools,
  } as unknown as ExtensionAPI
  const event = syntheticCompaction()
  const branch: any[] = [{ id: 'parent-one' }, event.compactionEntry]
  let sessionId = 'primary'
  const siblings: any[] = []
  const manager = {
    getSessionId: () => sessionId,
    getLeafId: () => branch.at(-1)?.id ?? null,
    getBranch: () => branch,
    getEntry: (id: string) => [...branch, ...siblings].find((entry) => entry.id === id),
    getSessionFile: () => undefined,
  }
  const ctx = { cwd, sessionManager: manager, isIdle: () => true } as unknown as ExtensionContext
  let holds = 0
  let granted = true
  let authorize = async () => {}
  let spawns = 0
  let authorizations = 0
  const retirements = new Set<() => Promise<void>>()
  const generation = {}
  const abi = {
    version,
    generation,
    root,
    live: () => true,
    trustedTool: (tool: unknown) => tools.includes(tool as (typeof tools)[number]),
    isPrimarySession: (context: ExtensionContext) => context.sessionManager === manager,
    hold() {
      holds++
      return () => holds--
    },
    onRetire(fn: () => Promise<void>) {
      retirements.add(fn)
      return () => retirements.delete(fn)
    },
    assertAccess() {
      if (!granted) throw Error('Denied synthetic authority')
      return { kind: 'primary' }
    },
    assertTargets() {
      abi.assertAccess()
    },
    async authorize() {
      authorizations++
      await authorize()
      return abi.assertAccess()
    },
    parentService: () => {
      spawns++
      throw Error('No compaction writer allowed')
    },
  }
  const node = { generation, healthy: () => true, managedMemory: abi }
  const globals = globalThis as unknown as Record<symbol, unknown>
  const oldRegistry = globals[registry]
  const nodes = new Map([['primary', node]])
  globals[registry] = nodes
  const runtime =
    version === 2
      ? createExperimentalMemoryRuntime(pi)
      : createAgentMemoryRuntime(pi, { root, nodes: nodes as any })
  const emit = async (name: string, payload: any = {}, context = ctx) => {
    if (name === 'session_compact') {
      // Simulate exactly the native ordering: before hook, one append, after hook.
      const entries = context.sessionManager.getBranch()
      const leaf = entries.at(-1)?.id === payload.compactionEntry?.id ? entries.pop() : undefined
      try {
        for (const handler of handlers.get('session_before_compact') ?? [])
          await handler(beforeCompaction(payload), context)
      } finally {
        if (leaf) entries.push(leaf)
      }
    }
    const results = []
    for (const handler of handlers.get(name) ?? []) results.push(await handler(payload, context))
    return results
  }
  const configPath = join(root, 'config.json')
  return {
    root,
    store,
    config,
    runtime,
    event,
    branch,
    siblings,
    ctx,
    node,
    abi,
    nodes,
    emit,
    async emitRaw(name: string, payload: any, context = ctx) {
      for (const handler of handlers.get(name) ?? []) await handler(payload, context)
    },
    spawns: () => spawns,
    authorizations: () => authorizations,
    holds: () => holds,
    authorize: (fn: () => Promise<void>) => (authorize = fn),
    grant: (value: boolean) => (granted = value),
    session: (value: string) => (sessionId = value),
    automatic(value: boolean) {
      writeFileSync(configPath, JSON.stringify({ ...config, automatic: value }), { mode: 0o600 })
    },
    files: () => {
      try {
        return readdirSync(join(root, '.episodes')).filter((name) => name.endsWith('.json'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        return []
      }
    },
    async close() {
      await runtime.cancel()
      if ('drain' in runtime) await runtime.drain()
      assert.equal(holds, 0)
      assert.equal(retirements.size, 0)
      globals[registry] = oldRegistry
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

const withMetadata = (
  episode: CompactionEpisode,
  patch: Partial<CompactionEpisode['compaction']>,
): CompactionEpisode => {
  const compaction = { ...episode.compaction, ...patch }
  return {
    ...episode,
    id: digest(`${episode.session}:compact:${compaction.entryId}`),
    entryHash: digest(serializeCompactionMetadata(compaction)),
    compaction,
  }
}
const nativeEpisode = (f: ReturnType<typeof fixture>, entryId: string) => {
  const event = syntheticCompaction(entryId)
  event.compactionEntry.parentId = f.branch.at(-1)?.id ?? null
  f.branch.push(event.compactionEntry)
  return compactionObservation(event, f.ctx).episode('synthetic')
}

for (const version of [1, 2] as const) {
  test(`ABI${version}: metadata only, legacy ID, replay, no writer and no fabricated interactive input`, async () => {
    const f = fixture(version)
    try {
      await f.emit('session_start')
      const id = digest('primary:compact:compact-one')
      // Sensitive/oversized native fields do not enter persistence or its hash.
      const entry = f.event.compactionEntry
      entry.summary = 'Bearer synthetic-sensitive-value'
      entry.details = { huge: 'S'.repeat(50000) }
      Object.defineProperty(entry, 'systemMessage', {
        get() {
          throw Error('Never inspect native system prompt')
        },
      })
      await f.emit('session_compact', f.event)
      assert.deepEqual(f.files(), [`${id}.json`])
      const path = join(f.root, '.episodes', `${id}.json`)
      const raw = readFileSync(path, 'utf8')
      const episode = JSON.parse(raw)
      assert.equal(episode.kind, 'compaction')
      assert.equal(episode.observedAt, entry.timestamp)
      assert.equal(episode.entryHash, digest(JSON.stringify(episode.compaction)))
      assert.deepEqual(Object.keys(episode).sort(), [
        'compaction',
        'entryHash',
        'evidence',
        'id',
        'kind',
        'observedAt',
        'project',
        'session',
      ])
      assert.equal(episode.compaction.reason, 'threshold')
      assert.equal(episode.compaction.entryId, entry.id)
      assert.equal(episode.evidence, 'observed-native-unverified')
      assert.doesNotMatch(raw, /Bearer|sensitive|huge|summary|input|actions|results|outcome|systemMessage/)
      await f.emit('session_compact', f.event)
      assert.equal(readFileSync(path, 'utf8'), raw)
      await f.emit('session_compact', { ...f.event, reason: 'manual' })
      assert.equal(readFileSync(path, 'utf8'), raw, 'same ID different bytes never overwrite')
      assert.equal(f.spawns(), 0)
      assert.equal(f.runtime.status().worker, false)
    } finally {
      await f.close()
    }
  })

  test(`ABI${version}: off, absent native branch, child context and permission deny admit nothing`, async () => {
    const f = fixture(version)
    try {
      await f.emit('session_start')
      f.automatic(false)
      await f.emit('session_compact', f.event)
      assert.deepEqual(f.files(), [])
      f.automatic(true)
      f.branch.pop()
      await f.emit('session_compact', f.event)
      f.branch.push(f.event.compactionEntry)
      await f.emit('session_compact', f.event, {
        ...f.ctx,
        sessionManager: { ...f.ctx.sessionManager },
      } as ExtensionContext)
      f.grant(false)
      await f.emit('session_compact', f.event)
      assert.deepEqual(f.files(), [])
      f.grant(true)
      // Re-enabling alone cannot backfill anything or start a writer.
      assert.deepEqual(f.files(), [])
      assert.equal(f.spawns(), 0)
    } finally {
      await f.close()
    }
  })
}

test('paired append resolves ancestral duplicate-summary event to leaf metadata only and rejects ambiguity', async () => {
  const f = fixture()
  try {
    const event = syntheticCompaction('second-identical-summary')
    event.compactionEntry.parentId = f.event.compactionEntry.id
    event.compactionEntry.timestamp = '2026-07-25T00:00:00.000Z'
    event.compactionEntry.tokensBefore = 99
    const before = beforeCompaction(event)
    const boundary = compactionBoundary(before, f.ctx)
    assert.throws(() => pairedCompactionObservation(event, f.ctx, boundary), /append ambiguous/)
    f.branch.push(event.compactionEntry)
    const reported = { ...event, compactionEntry: f.event.compactionEntry }
    const observation = pairedCompactionObservation(reported, f.ctx, boundary)
    const episode = observation.episode('synthetic')
    assert.equal(episode.id, digest(`primary:compact:${event.compactionEntry.id}`))
    assert.equal(episode.compaction.entryId, event.compactionEntry.id)
    assert.equal(episode.compaction.parentId, f.event.compactionEntry.id)
    assert.equal(episode.compaction.tokensBefore, 99)
    assert.equal(episode.observedAt, event.compactionEntry.timestamp)
    assert.equal(episode.entryHash, digest(serializeCompactionMetadata(episode.compaction)))
    assert.doesNotMatch(JSON.stringify(episode), /SYNTHETIC_SUMMARY|"summary"|"details"|"systemMessage"/)
    assert.equal(observation.current(), true)
    const oldSummary = f.event.compactionEntry.summary
    f.event.compactionEntry.summary = 'Unrelated historical summary'
    assert.throws(() => pairedCompactionObservation(reported, f.ctx, boundary), /does not match/)
    f.event.compactionEntry.summary = oldSummary
    assert.throws(
      () => pairedCompactionObservation({ ...reported, reason: 'manual' }, f.ctx, boundary),
      /Unpaired/,
    )
    assert.throws(
      () => pairedCompactionObservation({ ...reported, willRetry: true }, f.ctx, boundary),
      /Unpaired/,
    )
    assert.throws(
      () => pairedCompactionObservation({ ...reported, fromExtension: true }, f.ctx, boundary),
      /paired native/,
    )
    const leaf = f.branch.at(-1)
    f.branch.push({ id: 'extra-append' })
    assert.equal(observation.current(), false)
    assert.throws(() => pairedCompactionObservation(reported, f.ctx, boundary), /append ambiguous/)
    f.branch.pop()
    leaf.tokensBefore++
    assert.equal(observation.current(), false, 'same-ID leaf metadata mutation invalidates observation')
    leaf.tokensBefore--
    const hiddenPrefix = f.branch[0]
    f.branch[0] = { id: 'changed-prefix' }
    assert.equal(
      observation.current(),
      true,
      'ancestry behind the anchor is not re-read; append-only links are assumed',
    )
    assert.doesNotThrow(() => pairedCompactionObservation(reported, f.ctx, boundary))
    f.branch[0] = hiddenPrefix
    const anchor = f.branch[1]
    f.branch[1] = { id: 'missing-anchor', parentId: 'parent-one' }
    assert.throws(() => pairedCompactionObservation(reported, f.ctx, boundary), /append ambiguous/)
    f.branch[1] = anchor
    const abort = new AbortController()
    abort.abort()
    assert.throws(
      () => pairedCompactionObservation(reported, f.ctx, { ...boundary, signal: abort.signal }),
      /Unpaired/,
    )
    assert.throws(
      () => pairedCompactionObservation(reported, f.ctx, { ...boundary, manager: { ...boundary.manager } }),
      /Unpaired/,
    )
    f.store.forget(f.store.snapshot().revision, [], [episode.id], 'synthetic')
    assert.throws(() => f.store.recordEpisode(episode.id, episode), /Forgotten/)
  } finally {
    await f.close()
  }
})

test('paired append resolves sibling-branch duplicate summary but rejects fake or mismatched reports', async () => {
  const f = fixture()
  try {
    const sibling = syntheticCompaction('sibling-compaction').compactionEntry
    f.siblings.push(sibling)
    const event = syntheticCompaction('active-leaf')
    event.compactionEntry.parentId = f.branch.at(-1).id
    const boundary = compactionBoundary(beforeCompaction(event), f.ctx)
    f.branch.push(event.compactionEntry)
    const reported = { ...event, compactionEntry: { ...sibling } }
    const observation = pairedCompactionObservation(reported, f.ctx, boundary)
    assert.equal(observation.episode('synthetic').compaction.entryId, 'active-leaf')
    assert.equal(observation.current(), true)
    for (const patch of [
      { id: 'foreign-session-entry' },
      { timestamp: '2026-07-26T00:00:00.000Z' },
      { parentId: 'fake-parent' },
      { firstKeptEntryId: 'fake-kept' },
      { tokensBefore: sibling.tokensBefore + 1 },
      { summary: 'fake-summary' },
      { fromHook: !sibling.fromHook },
    ])
      assert.throws(
        () =>
          pairedCompactionObservation(
            { ...reported, compactionEntry: { ...sibling, ...patch } },
            f.ctx,
            boundary,
          ),
        /paired native/,
      )
    f.siblings.length = 0
    assert.throws(() => pairedCompactionObservation(reported, f.ctx, boundary), /paired native/)
  } finally {
    await f.close()
  }
})

for (const version of [1, 2] as const) {
  test(`ABI${version}: compaction boundaries are required, one-use and cleared on failure`, async () => {
    const f = fixture(version)
    try {
      await f.emit('session_start')
      await f.emitRaw('session_compact', f.event)
      assert.deepEqual(f.files(), [], 'unanchored historical event is not backfilled')
      const entry = f.branch.pop()
      await f.emitRaw('session_before_compact', beforeCompaction(f.event))
      await f.emitRaw('session_compact_failed', { reason: 'manual' })
      f.branch.push(entry)
      await f.emitRaw('session_compact', f.event)
      assert.deepEqual(f.files(), [], 'failed lifecycle consumes the boundary')
      await f.emit('session_compact', f.event)
      assert.equal(f.files().length, 1, 'fresh paired lifecycle remains eligible')
      const original = readFileSync(join(f.root, '.episodes', f.files()[0]))
      await f.emitRaw('session_compact', { ...f.event, reason: 'manual' })
      assert.deepEqual(readFileSync(join(f.root, '.episodes', f.files()[0])), original)
      assert.equal(f.spawns(), 0)
    } finally {
      await f.close()
    }
  })
}

test('ABI2: bounded synchronous admission; retirement joins and fences queued compaction', async () => {
  const f = fixture()
  const reached = deferred()
  const release = deferred()
  try {
    await f.emit('session_start')
    f.authorize(async () => {
      reached.resolve()
      await release.promise
    })
    const capture = f.emit('session_compact', f.event)
    await reached.promise
    await Promise.all(Array.from({ length: 64 }, () => f.emit('session_compact', f.event)))
    assert.equal(f.authorizations(), 1, 'no hidden unbounded controller/config tail')
    let drained = false
    const retirement = Promise.resolve(f.runtime.cancel()).then(() => (drained = true))
    await yieldTurn()
    assert.equal(drained, false)
    release.resolve()
    await capture
    await retirement
    assert.deepEqual(f.files(), [])
    assert.equal(f.holds(), 0)
  } finally {
    release.resolve()
    await f.close()
  }
})

test('ABI2: revocation at async admission fences policy, permission, manager, branch and generation', async () => {
  for (const change of ['automatic', 'permission', 'manager', 'branch', 'generation', 'root', 'registry']) {
    const f = fixture()
    const reached = deferred()
    const release = deferred()
    try {
      await f.emit('session_start')
      f.authorize(async () => {
        reached.resolve()
        await release.promise
      })
      const capture = f.emit('session_compact', f.event)
      await reached.promise
      if (change === 'automatic') f.automatic(false)
      if (change === 'permission') f.grant(false)
      if (change === 'manager') f.session('replacement')
      if (change === 'branch') f.branch.splice(0, 1, { id: 'other-branch' })
      if (change === 'generation') f.node.generation = {}
      if (change === 'root') f.abi.root = `${f.root}-changed`
      if (change === 'registry') f.nodes.delete('primary')
      release.resolve()
      await capture
      assert.deepEqual(f.files(), [], change)
      assert.equal(f.spawns(), 0)
    } finally {
      release.resolve()
      await f.close()
    }
  }
})

test('ABI2: accepted cancel and policy off/on fence an already-admitted compaction locally', async () => {
  for (const action of ['cancel', 'policy'] as const) {
    const f = fixture()
    const reached = deferred()
    const release = deferred()
    try {
      await f.emit('session_start')
      let calls = 0
      f.authorize(async () => {
        if (++calls !== 1) return
        reached.resolve()
        await release.promise
      })
      const capture = f.emit('session_compact', f.event)
      await reached.promise
      if (action === 'cancel') await f.runtime.run('agent_memory_manage', { action: 'cancel' }, f.ctx)
      else
        for (const automatic of [false, true])
          await f.runtime.run(
            'agent_memory_manage',
            {
              action: 'policy',
              revision: f.store.snapshot().revision,
              configHash: digest(JSON.stringify(f.store.config())),
              automatic,
            },
            f.ctx,
          )
      release.resolve()
      await capture
      assert.deepEqual(f.files(), [], action)
      // A new native event after the accepted action is still eligible.
      const event = syntheticCompaction(`after-${action}`)
      event.compactionEntry.parentId = f.branch.at(-1)?.id ?? null
      f.branch.push(event.compactionEntry)
      await f.emit('session_compact', event)
      assert.equal(f.files().length, 1)
      assert.equal(f.spawns(), 0)
    } finally {
      release.resolve()
      await f.close()
    }
  }
})

test('closed compaction schema is shared by both readers and engine replies', async () => {
  const f = fixture()
  try {
    const episode = compactionObservation(f.event, f.ctx).episode('synthetic')
    assert.deepEqual(observedEpisode(episode), episode)
    validateReply('episodes', { project: 'synthetic' }, [episode])
    const invalid: unknown[] = [
      { ...episode, id: digest('forged-id') },
      { ...episode, entryHash: digest('forged-metadata-hash') },
      { ...episode, compaction: { ...episode.compaction, tokensBefore: 42 } },
      { ...episode, session: 'different-session' },
      { ...episode, input: { text: 'masquerade', source: 'interactive' } },
      { ...episode, summary: 'no' },
      { ...episode, outcome: 'completed' },
      { ...episode, kind: 'turn' },
      { ...episode, compaction: { ...episode.compaction, details: 'no' } },
      { ...episode, compaction: { ...episode.compaction, tokensBefore: -1 } },
      { ...episode, compaction: { ...episode.compaction, fromExtension: 'false' } },
      { ...episode, compaction: { ...episode.compaction, reason: 'native-authority' } },
      { ...episode, compaction: { ...episode.compaction, entryId: 'Bearer synthetic-sensitive-value' } },
    ]
    const reordered = {
      ...episode,
      compaction: Object.fromEntries(Object.entries(episode.compaction).reverse()),
    }
    assert.deepEqual(
      observedEpisode(reordered),
      episode,
      'metadata hashing is independent of key insertion order',
    )
    assert.throws(() => validateReply('episodes', { project: 'other-project' }, [episode]))
    for (const value of invalid) {
      assert.throws(() => observedEpisode(value))
      assert.throws(() => f.store.recordEpisode(episode.id, value))
      assert.throws(() => validateReply('episodes', { project: 'synthetic' }, [value]))
    }
  } finally {
    await f.close()
  }
})

test('ABI1: copied tombstoned body under another filename fails closed; correctly named records remain readable', async () => {
  const f = fixture(1)
  try {
    const compact = compactionObservation(f.event, f.ctx).episode('synthetic')
    const legacy: Episode = {
      id: digest('filename-legacy'),
      project: 'synthetic',
      session: 'primary',
      evidence: 'observed-native-unverified',
      observedAt: '2026-07-23T00:00:00.000Z',
      entryHash: digest('legacy'),
      input: { text: 'Synthetic legacy exchange', source: 'rpc' },
      actions: [{ text: 'Synthetic action' }],
      results: [],
      outcome: 'completed',
    }
    f.store.recordEpisode(legacy.id, legacy)
    f.store.recordEpisode(compact.id, compact)
    assert.deepEqual(f.store.pendingEpisodes('synthetic'), [legacy, compact], 'positive mixed-reader control')
    f.store.forget(f.store.snapshot().revision, [], [legacy.id, compact.id], 'synthetic')
    assert.deepEqual(f.store.pendingEpisodes('synthetic'), [], 'correct filenames honor both tombstones')
    const valid = nativeEpisode(f, 'filename-positive')
    const alias = valid.id
    const path = join(f.root, '.episodes', `${alias}.json`)
    for (const forgotten of [legacy, compact]) {
      // Deliberately corrupt disposable storage, not a normal-admission exploit:
      // tombstoned body A copied beneath untombstoned filename B must not surface A.
      writeFileSync(path, `${JSON.stringify(forgotten)}\n`, { mode: 0o600 })
      assert.throws(() => f.store.pendingEpisodes('synthetic'), /Invalid episode filename identity/)
    }
    writeFileSync(path, `${JSON.stringify(valid)}\n`, { mode: 0o600 })
    assert.deepEqual(f.store.pendingEpisodes('synthetic'), [valid], 'correctly named B is readable')
  } finally {
    await f.close()
  }
})

test('ABI1: authorize actual episode directory and target even when absent, before discovery', async () => {
  const f = fixture(1)
  try {
    const episode = compactionObservation(f.event, f.ctx).episode('synthetic')
    const folder = join(f.root, '.episodes')
    const target = join(folder, `${episode.id}.json`)
    for (const denied of [folder, target]) {
      const store = createMemoryStore(f.root, (path) => {
        if (path === denied) throw Error('Denied actual episode target')
      })
      if (denied === folder)
        assert.throws(() => store.pendingEpisodes('synthetic'), /Denied actual episode target/)
      assert.throws(() => store.recordEpisode(episode.id, episode), /Denied actual episode target/)
      assert.equal(existsSync(folder), false, 'absent target denial provisions nothing')
    }
    f.store.recordEpisode(episode.id, episode)
    const original = readFileSync(target)
    for (const denied of [folder, target]) {
      const store = createMemoryStore(f.root, (path) => {
        if (path === denied) throw Error('Denied actual episode target')
      })
      assert.throws(() => store.pendingEpisodes('synthetic'), /Denied actual episode target/)
      assert.throws(() => store.recordEpisode(episode.id, episode), /Denied actual episode target/)
      assert.deepEqual(readFileSync(target), original)
    }
    assert.deepEqual(f.store.pendingEpisodes('synthetic'), [episode])
  } finally {
    await f.close()
  }
})

// Target callbacks and direct OperationContext exercise real I/O/checkpoints, not real PSS policy resolution.
for (const version of [1, 2] as const) {
  for (const boundary of ['temp-deny', 'before-link', 'cleanup', 'allow'] as const) {
    test(`ABI${version}: episode physical authority at ${boundary}`, async () => {
      const f = fixture(version)
      const engine = new MemoryEngineController(f.root, engineEnvironment(process.env))
      try {
        const episode = compactionObservation(f.event, f.ctx).episode('synthetic')
        const folder = join(f.root, '.episodes')
        const target = join(folder, `${episode.id}.json`)
        let revoked = false
        let tempSeen = false
        let parentSeen = false
        let finalSeen = false
        const check = (paths: string[]) => {
          parentSeen ||= paths.includes(folder)
          finalSeen ||= paths.includes(target)
          const temps = paths.filter((path) => path.startsWith(`${target}.`) && path.endsWith('.tmp'))
          tempSeen ||= temps.length > 0
          if (temps.length && boundary === 'temp-deny') throw Error('Synthetic temp deny')
          if (
            boundary === 'before-link' &&
            paths.includes(target) &&
            readdirSync(folder).some((p) => p.endsWith('.tmp'))
          )
            revoked = true
          if (boundary === 'cleanup' && temps.length && existsSync(target)) revoked = true
          if (revoked) throw Error('Synthetic authority revoked')
        }
        // The folder must exist for the before-link probe; initialization itself grants no episode permission.
        mkdirSync(folder, { mode: 0o700 })
        const store = createMemoryStore(f.root, (path) => check(path ? [path] : []))
        const operation = async () => {
          if (version === 1) store.recordEpisode(episode.id, episode)
          else
            await engine.request(
              'observe',
              { episode },
              {
                current: (targets) => {
                  check(targets.physical)
                  return true
                },
              },
            )
        }
        if (boundary === 'allow') await operation()
        else await assert.rejects(operation())
        assert.equal(tempSeen, true, 'actual randomized temp path reaches the authority owner')
        assert.equal(parentSeen, true, 'episode parent reaches the authority owner')
        if (boundary !== 'temp-deny')
          assert.equal(finalSeen, true, 'final episode path reaches the authority owner before link')
        const temps = readdirSync(folder).filter((path) => path.endsWith('.tmp'))
        if (boundary === 'temp-deny') {
          assert.equal(existsSync(target), false)
          assert.deepEqual(temps, [], 'denial before open creates no residue')
        } else if (boundary === 'before-link') {
          assert.equal(existsSync(target), false, 'revocation fences final link')
          assert.equal(temps.length, 1, 'revoked cleanup does not unlink')
          assert.equal(statSync(join(folder, temps[0])).nlink, 1)
        } else if (boundary === 'cleanup') {
          assert.equal(temps.length, 1, 'revoked cleanup retains its temp link')
          assert.equal(statSync(target).nlink, 2)
          assert.throws(() => f.store.pendingEpisodes('synthetic'), /Linked|Private file/)
          await assert.rejects(readPrivate(target, 16384), /Linked|Private file/)
          // Restored permissions do not make the stranded shared backlog readable,
          // even for a different project. No read/unlink exception is introduced.
          const otherEpisode = { ...episode, project: 'other-project' }
          const otherId = digest('other-project-legacy-turn')
          f.store.recordEpisode(otherId, {
            id: otherId,
            project: 'other-project',
            session: 'other-session',
            evidence: 'observed-native-unverified',
            observedAt: episode.observedAt,
            entryHash: digest('other-turn'),
            input: { text: 'Synthetic other project', source: 'rpc' },
            actions: [],
            results: [],
            outcome: 'completed',
          })
          assert.throws(() => f.store.pendingEpisodes(otherEpisode.project), /Linked|Private file/)
          await assert.rejects(
            engine.request('episodes', { project: otherEpisode.project }, { current: () => true }),
          )
          assert.throws(() => f.store.recordEpisode(episode.id, episode), /Private file|Linked/)
          assert.equal(statSync(target).nlink, 2, 'no silent repair after authority returns')
        } else {
          assert.deepEqual(temps, [])
          assert.equal(statSync(target).nlink, 1)
          assert.deepEqual(f.store.pendingEpisodes('synthetic'), [episode])
        }
      } finally {
        await engine.close()
        await f.close()
      }
    })
  }
}

test('createPrivate preserves original publication error when revoked cleanup also fails', async () => {
  const f = fixture()
  try {
    const target = join(f.root, '.episodes', `${digest('original-error')}.json`)
    const original = Error('Original beforePublish failure')
    let revoked = false
    await assert.rejects(
      createPrivate(
        target,
        'complete bytes\n',
        async () => {
          revoked = true
          throw original
        },
        async () => {
          if (revoked) throw Error('Cleanup authority revoked')
        },
      ),
      (error) => error === original,
    )
    assert.equal(existsSync(target), false)
    const [temp] = readdirSync(join(f.root, '.episodes'))
    assert.equal(readFileSync(join(f.root, '.episodes', temp), 'utf8'), 'complete bytes\n')
  } finally {
    await f.close()
  }
})

test('exclusive publication races do not replace same-ID bytes or leave an admission lock', async () => {
  const f = fixture()
  try {
    const target = join(f.root, '.episodes', `${digest('collision')}.json`)
    const reached = deferred()
    const release = deferred()
    const allow = async () => {}
    const first = createPrivate(
      target,
      'first\n',
      async () => {
        reached.resolve()
        await release.promise
      },
      allow,
    )
    await reached.promise
    assert.equal(await createPrivate(target, 'second\n', async () => {}, allow), true)
    release.resolve()
    assert.equal(await first, false)
    assert.equal(readFileSync(target, 'utf8'), 'second\n')
    assert.deepEqual(readdirSync(join(f.root, '.episodes')), [`${digest('collision')}.json`])
  } finally {
    await f.close()
  }
})

test('mixed legacy/new oldest four, byte preservation, tombstones, policy enforcement and cross-controller collision', async () => {
  const f = fixture()
  const engine = new MemoryEngineController(f.root, engineEnvironment(process.env))
  const other = new MemoryEngineController(f.root, engineEnvironment(process.env))
  const context = { current: () => true }
  try {
    const compact = compactionObservation(f.event, f.ctx).episode('synthetic')
    const legacy: Episode = {
      id: digest('legacy-turn'),
      project: 'synthetic',
      session: 'primary',
      evidence: 'observed-native-unverified',
      observedAt: '2026-07-23T00:00:00.000Z',
      entryHash: digest('legacy'),
      input: { text: '[compaction:manual] Legacy bytes preserved', source: 'interactive' },
      actions: [{ text: 'Legacy summary' }],
      results: [],
      outcome: 'completed',
    }
    f.store.recordEpisode(legacy.id, legacy)
    const legacyPath = join(f.root, '.episodes', `${legacy.id}.json`)
    const original = readFileSync(legacyPath)
    f.store.recordEpisode(compact.id, compact)
    for (let index = 0; index < 4; index++) {
      const value = {
        ...nativeEpisode(f, `later-${index}`),
        observedAt: `2026-07-2${5 + index}T00:00:00.000Z`,
      }
      await engine.request('observe', { episode: value }, context)
    }
    const pending = f.store.pendingEpisodes('synthetic')
    assert.equal(pending.length, 4)
    assert.deepEqual(pending.slice(0, 2), [legacy, compact])
    assert.deepEqual(await engine.request('episodes', { project: 'synthetic' }, context), pending)
    assert.deepEqual(readFileSync(legacyPath), original)
    const collisionEvent = syntheticCompaction('legacy-compact-collision')
    collisionEvent.compactionEntry.parentId = f.branch.at(-1)?.id ?? null
    f.branch.push(collisionEvent.compactionEntry)
    const collision = compactionObservation(collisionEvent, f.ctx).episode('synthetic')
    const legacyCollision = { ...legacy, id: collision.id }
    f.store.recordEpisode(collision.id, legacyCollision)
    const collisionPath = join(f.root, '.episodes', `${collision.id}.json`)
    const collisionBytes = readFileSync(collisionPath)
    await assert.rejects(engine.request('observe', { episode: collision }, context))
    assert.throws(() => f.store.recordEpisode(collision.id, collision), /changed/)
    assert.deepEqual(readFileSync(collisionPath), collisionBytes, 'legacy same-ID bytes remain untouched')
    const changed = withMetadata(compact, { reason: 'manual' })
    await assert.rejects(engine.request('observe', { episode: changed }, context))
    assert.throws(() => f.store.recordEpisode(compact.id, changed), /changed/)
    // Real separate data children race an absent ID; only one byte shape can win.
    const race = nativeEpisode(f, 'cross-controller')
    const different = withMetadata(race, { tokensBefore: 42 })
    const results = await Promise.allSettled([
      engine.request('observe', { episode: race }, context),
      other.request('observe', { episode: different }, context),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const winner = readFileSync(join(f.root, '.episodes', `${race.id}.json`), 'utf8')
    assert.ok([`${JSON.stringify(race)}\n`, `${JSON.stringify(different)}\n`].includes(winner))
    f.automatic(false)
    const off = nativeEpisode(f, 'off')
    assert.throws(() => f.store.recordEpisode(off.id, off), /disabled/)
    await assert.rejects(engine.request('observe', { episode: off }, context))
    f.automatic(true)
    const revision = f.store.snapshot().revision
    f.store.forget(revision, [], [compact.id], 'synthetic')
    assert.throws(() => f.store.recordEpisode(compact.id, compact), /Forgotten/)
    await assert.rejects(engine.request('observe', { episode: compact }, context))
    assert.ok(!f.store.pendingEpisodes('synthetic').some((value) => value.id === compact.id))
    assert.deepEqual(readFileSync(legacyPath), original)
  } finally {
    await engine.close()
    await other.close()
    await f.close()
  }
})

test('mixed records share the 256 capacity; oldest-four review permits existing cleanup only', async () => {
  const f = fixture()
  const engine = new MemoryEngineController(f.root, engineEnvironment(process.env))
  const context = { current: () => true }
  try {
    const compact = compactionObservation(f.event, f.ctx).episode('synthetic')
    const folder = join(f.root, '.episodes')
    mkdirSync(folder, { mode: 0o700 })
    // Seed a bounded full synthetic backlog without 256 unrelated Git round trips.
    const values: Episode[] = Array.from({ length: 256 }, (_, index) => {
      const identity = withMetadata(compact, { entryId: `capacity-${index}` })
      if (index % 2 === 0) return identity
      const { kind: _kind, compaction: _metadata, ...base } = identity
      return {
        ...base,
        input: { text: 'Synthetic legacy exchange', source: 'rpc' },
        actions: [{ text: 'Synthetic action' }],
        results: [],
        outcome: 'completed',
      }
    })
    for (const value of values)
      writeFileSync(join(folder, `${value.id}.json`), `${JSON.stringify(value)}\n`, { mode: 0o600 })
    const before = f.files().sort()
    const incoming = nativeEpisode(f, 'capacity-incoming')
    assert.throws(() => f.store.recordEpisode(incoming.id, incoming), /capacity/)
    await assert.rejects(engine.request('observe', { episode: incoming }, context))
    assert.deepEqual(f.files().sort(), before, 'full unreviewed backlog is not evicted')
    assert.equal(f.store.pendingEpisodes('synthetic').length, 4)
    assert.deepEqual(
      await engine.request('episodes', { project: 'synthetic' }, context),
      f.store.pendingEpisodes('synthetic'),
    )
    const selected = f.store.pendingEpisodes('synthetic').map((value) => value.id)
    const view = f.store.createView('synthetic', 120000)
    f.store.integrate(view, selected)
    await engine.request('observe', { episode: incoming }, context)
    assert.equal(f.files().length, 253, 'only four reviewed records cleaned, then one admission')
    for (const id of selected) assert.ok(!f.files().includes(`${id}.json`))
    assert.equal(f.store.pendingEpisodes('synthetic').length, 4)
    assert.ok(!f.store.pendingEpisodes('synthetic').some((value) => selected.includes(value.id)))
  } finally {
    await engine.close()
    await f.close()
  }
})

test('ABI1: capacity cleanup validates all bodies and filename identities before deleting reviewed records', async () => {
  const f = fixture(1)
  try {
    const compact = compactionObservation(f.event, f.ctx).episode('synthetic')
    const folder = join(f.root, '.episodes')
    mkdirSync(folder, { mode: 0o700 })
    const values = Array.from({ length: 256 }, (_, index) =>
      withMetadata(compact, { entryId: `corrupt-capacity-${index}` }),
    ).sort((a, b) => a.id.localeCompare(b.id))
    for (const value of values)
      writeFileSync(join(folder, `${value.id}.json`), `${JSON.stringify(value)}\n`, { mode: 0o600 })
    const selected = values[0]
    const view = f.store.createView('synthetic')
    f.store.integrate(view, [selected.id])
    const incoming = nativeEpisode(f, 'corrupt-capacity-incoming')
    const corruptions = [
      { value: selected, raw: '{malformed' },
      { value: selected, raw: JSON.stringify(values[1]) },
      // Corruption late in the scan must not permit earlier reviewed deletion.
      { value: values.at(-1)!, raw: JSON.stringify(selected) },
      { value: values.at(-1)!, raw: JSON.stringify({ ...values.at(-1)!, entryHash: digest('malicious') }) },
    ]
    for (const { value, raw } of corruptions) {
      const path = join(folder, `${value.id}.json`)
      writeFileSync(path, raw, { mode: 0o600 })
      assert.throws(() => f.store.recordEpisode(incoming.id, incoming))
      assert.equal(f.files().length, 256, 'corrupt backlog fails before any cleanup')
      assert.equal(existsSync(join(folder, `${selected.id}.json`)), true)
      assert.equal(existsSync(join(folder, `${incoming.id}.json`)), false)
      writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 })
    }
    f.store.recordEpisode(incoming.id, incoming)
    assert.equal(f.files().length, 256, 'valid reviewed cleanup frees exactly one slot')
    assert.equal(existsSync(join(folder, `${selected.id}.json`)), false)
  } finally {
    await f.close()
  }
})

test('revocation after publication rejects completion but does not roll back already-published bytes', async () => {
  const f = fixture()
  const engine = new MemoryEngineController(f.root, engineEnvironment(process.env))
  try {
    const episode = compactionObservation(f.event, f.ctx).episode('synthetic')
    const target = join(f.root, '.episodes', `${episode.id}.json`)
    await assert.rejects(engine.request('observe', { episode }, { current: () => !existsSync(target) }))
    assert.equal(readFileSync(target, 'utf8'), `${JSON.stringify(episode)}\n`)
  } finally {
    await engine.close()
    await f.close()
  }
})

test('data-operation automatic and final target revocation are checked before publication, without rollback claims', async () => {
  for (const change of ['automatic', 'permission']) {
    const f = fixture()
    const engine = new MemoryEngineController(f.root, engineEnvironment(process.env))
    try {
      const episode = compactionObservation(f.event, f.ctx).episode('synthetic')
      const target = join(f.root, '.episodes', `${episode.id}.json`)
      let writes = 0
      const context = {
        current: (targets: { kind: string; physical: string[] }) => {
          if (targets.kind === 'view' && targets.physical.includes(target)) {
            writes++
            // First target gate precedes private-temp preparation; second gate is
            // immediately before publication. Neither can undo an already-started link.
            if (change === 'automatic' && writes === 1) f.automatic(false)
            if (change === 'permission' && writes === 2) return false
          }
          return true
        },
      }
      await assert.rejects(engine.request('observe', { episode }, context))
      assert.ok(writes > 0)
      assert.deepEqual(f.files(), [], change)
      assert.deepEqual(readdirSync(join(f.root, '.episodes')), [], 'private temp is cleaned on rejection')
    } finally {
      await engine.close()
      await f.close()
    }
  }
})

test('ABI2 compaction admits one append after more than 8193 historical entries', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const history = []
    let parent: string | null = null
    for (let index = 0; index < 8194; index++) {
      const id = `history-${index}`
      history.push({ id, parentId: parent, type: 'message', timestamp: 't' })
      parent = id
    }
    const event = syntheticCompaction('after-history')
    event.compactionEntry.parentId = history.at(-1)?.id ?? null
    f.branch.splice(0, f.branch.length, ...history, event.compactionEntry)
    let branchReads = 0
    const original = f.ctx.sessionManager.getBranch.bind(f.ctx.sessionManager)
    f.ctx.sessionManager.getBranch = () => {
      branchReads += 1
      return original()
    }
    await f.emit('session_compact', event)
    assert.equal(branchReads, 1)
    assert.equal(f.files().length, 1)
  } finally {
    await f.close()
  }
})
