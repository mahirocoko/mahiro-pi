import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as yieldTurn } from 'node:timers/promises'
import test from 'node:test'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createExperimentalMemoryRuntime } from '../lib/agent-memory/experimental-runtime.ts'
import { createMemoryStore } from '../lib/agent-memory/store.ts'

const registry = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

// Controlled ABI double for adversarial scheduling; real data child/store, not kernel/PSS proof.
function fixture() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'memory-tree-'))
  const root = join(directory, 'memory')
  const previous = { ...process.env }
  for (const key of Object.keys(process.env))
    if (/^(GIT_|PI_|MAHIRO_)/.test(key) || key.includes('API_KEY')) delete process.env[key]
  Object.assign(process.env, {
    HOME: directory,
    PI_CODING_AGENT_DIR: directory,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(directory, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: directory,
  })
  writeFileSync(
    join(directory, '.gitconfig'),
    '[user]\n name = Synthetic Tree\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
  )
  mkdirSync(join(directory, 'project'))
  const cwd = join(directory, 'project')
  const store = createMemoryStore(root)
  store.initialize(
    {
      version: 1,
      projects: [{ cwd, id: 'synthetic' }],
      coreBytes: 8192,
      indexBytes: 2048,
      fileBytes: 8192,
      totalBytes: 65536,
      automatic: false,
    },
    '# Core\nSYNTHETIC_TREE_CORE\n',
  )
  const handlers = new Map<string, Function[]>()
  const tools = ['agent_memory_read', 'agent_memory_manage', 'agent_memory_reflect'].map((name) => ({ name }))
  const pi = {
    on(name: string, fn: Function) {
      if (!handlers.has(name)) handlers.set(name, [])
      handlers.get(name)!.push(fn)
    },
    getAllTools: () => tools,
  } as unknown as ExtensionAPI
  const branch = [{ id: 'a' }, { id: 'b' }]
  const manager = {
    getSessionId: () => 'primary',
    getBranch: () => branch,
    getSessionFile: () => undefined,
  }
  let idle = true
  let usage: unknown = { tokens: 320, contextWindow: 4096, percent: 7.8125 }
  let systemPrompt: unknown = 'Synthetic effective prompt'
  const ctx = {
    cwd,
    sessionManager: manager,
    isIdle: () => idle,
    model: { provider: 'openai', id: 'synthetic-model' },
    getContextUsage: () => (typeof usage === 'function' ? (usage as () => unknown)() : usage),
    getSystemPrompt: () => systemPrompt,
  } as unknown as ExtensionContext
  let holds = 0
  let granted = true
  let authorize = async () => {}
  const retirements = new Set<() => Promise<void>>()
  const generation = {}
  const abi = {
    version: 2,
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
      await authorize()
      return abi.assertAccess()
    },
  }
  const node = { generation, healthy: () => true, managedMemory: abi }
  const globals = globalThis as unknown as Record<symbol, unknown>
  const oldRegistry = globals[registry]
  const nodes = new Map([['primary', node]])
  globals[registry] = nodes
  const runtime = createExperimentalMemoryRuntime(pi)
  const emit = async (name: string, event = {}, context = ctx) => {
    const results = []
    for (const handler of handlers.get(name) ?? []) results.push(await handler(event, context))
    return results
  }
  return {
    runtime,
    abi,
    node,
    nodes,
    ctx,
    branch,
    store,
    root,
    emit,
    holds: () => holds,
    setIdle: (value: boolean) => (idle = value),
    setGranted: (value: boolean) => (granted = value),
    setUsage: (value: unknown) => (usage = value),
    setSystemPrompt: (value: unknown) => (systemPrompt = value),
    authorize: (fn: () => Promise<void>) => (authorize = fn),
    read: (context = ctx) => runtime.run('agent_memory_read', { path: 'Core.md' }, context),
    async close() {
      await runtime.cancel()
      await runtime.drain()
      assert.equal(holds, 0)
      assert.equal(retirements.size, 0)
      globals[registry] = oldRegistry
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('tree retires old engine; completed tree and cancelled idle read/input each bind fresh', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await f.read()
    const oldPid = f.runtime.status().pid
    assert.ok(oldPid)
    f.setIdle(false)
    assert.deepEqual(await f.emit('session_before_tree'), [undefined])
    assert.equal(f.runtime.status().active, false)
    await assert.rejects(f.read())
    f.branch.splice(1)
    await f.emit('session_tree')
    assert.equal(f.runtime.status().active, true)
    assert.equal(f.runtime.status().pid, undefined, 'rebind never reuses retired data controller')
    await f.read()
    assert.notEqual(f.runtime.status().pid, oldPid)
    await f.emit('session_before_tree') // cancellation: deliberately no session_tree
    f.setIdle(true)
    await f.read()
    assert.equal(f.runtime.status().active, true)
    f.setIdle(false)
    await f.emit('session_before_tree')
    f.setIdle(true)
    await f.emit('input', { text: 'ordinary continuation', source: 'interactive' })
    f.setIdle(false)
    const [projection] = await f.emit('before_agent_start', { systemPrompt: 'Base' })
    assert.match(projection.systemPrompt, /SYNTHETIC_TREE_CORE/)
  } finally {
    await f.close()
  }
})

test('ABI2 invocation context separates current revision, public estimates and owner projection receipt', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const beforeProjection = await f.runtime.captureInvocation(f.ctx)
    assert.equal(beforeProjection.memoryProjection, null)
    assert.deepEqual(beforeProjection.usage, {
      available: true,
      source: 'pi-public-estimate',
      tokens: 320,
      contextWindow: 4096,
      percent: 7.8125,
    })
    assert.deepEqual(beforeProjection.effectiveSystemPrompt, {
      available: true,
      source: 'pi-current-effective-system-prompt',
      utf8Bytes: Buffer.byteLength('Synthetic effective prompt'),
    })
    const [prompt] = await f.emit('before_agent_start', { systemPrompt: 'Base' })
    assert.match(prompt.systemPrompt, /SYNTHETIC_TREE_CORE/)
    const projected = await f.runtime.captureInvocation(f.ctx)
    assert.equal(projected.binding.revision, projected.memoryProjection?.revision)
    assert.equal(projected.binding.configHash, projected.memoryProjection?.configHash)
    assert.ok((projected.memoryProjection?.emittedBlockUtf8Bytes ?? 0) > 0)
    assert.equal(projected.providerPrompt, 'unavailable')
    assert.equal(projected.categoryTokenAccounting, 'unavailable')
    assert.doesNotMatch(JSON.stringify(projected), /SYNTHETIC_TREE_CORE|memory-tree-|\/memory/)

    const changed = (await f.runtime.run(
      'agent_memory_manage',
      { action: 'remember', text: 'New committed diagnostic revision' },
      f.ctx,
    )) as { revision: string }
    const staleProjection = await f.runtime.captureInvocation(f.ctx)
    assert.equal(staleProjection.binding.revision, changed.revision)
    assert.notEqual(staleProjection.binding.revision, staleProjection.memoryProjection?.revision)
    f.setUsage({ tokens: null, contextWindow: 4096, percent: null })
    const unknownUsage = await f.runtime.captureInvocation(f.ctx)
    assert.deepEqual(unknownUsage.usage, {
      available: true,
      source: 'pi-public-estimate',
      tokens: null,
      contextWindow: 4096,
      percent: null,
    })
    const [nextPrompt] = await f.emit('before_agent_start', { systemPrompt: prompt.systemPrompt })
    assert.equal(nextPrompt.systemPrompt.match(/<mahiro-managed-memory>/g)?.length, 1)
    const refreshed = await f.runtime.captureInvocation(f.ctx)
    assert.equal(refreshed.binding.revision, refreshed.memoryProjection?.revision)
  } finally {
    await f.close()
  }
})

test('ABI2 invocation context fails closed on malformed public data, revocation and failed projection', async () => {
  const f = fixture()
  const reached = deferred()
  const release = deferred()
  try {
    await f.emit('session_start')
    await f.emit('before_agent_start', { systemPrompt: 'Base' })
    f.setUsage({ tokens: -1, contextWindow: 0, percent: 999 })
    f.setSystemPrompt(42)
    const malformed = await f.runtime.captureInvocation(f.ctx)
    assert.deepEqual(malformed.usage, {
      available: false,
      source: 'pi-public-estimate',
      reason: 'invalid',
    })
    assert.deepEqual(malformed.effectiveSystemPrompt, {
      available: false,
      source: 'pi-current-effective-system-prompt',
      reason: 'invalid',
    })

    f.setGranted(false)
    const [failedPrompt] = await f.emit('before_agent_start', {
      systemPrompt: 'Base\n<mahiro-managed-memory>old</mahiro-managed-memory>',
    })
    assert.equal(failedPrompt.systemPrompt, 'Base')
    f.setGranted(true)
    assert.equal((await f.runtime.captureInvocation(f.ctx)).memoryProjection, null)

    f.authorize(async () => {
      reached.resolve()
      await release.promise
    })
    const pending = f.runtime.captureInvocation(f.ctx)
    await reached.promise
    f.setGranted(false)
    release.resolve()
    await assert.rejects(pending)
  } finally {
    release.resolve()
    await f.close()
  }
})

test('ABI2 invocation context refuses config or writer admission races', async () => {
  {
    const f = fixture()
    try {
      await f.emit('session_start')
      f.setUsage(() => {
        const config = f.store.config()
        writeFileSync(join(f.root, 'config.json'), `${JSON.stringify({ ...config, automatic: true })}\n`)
        return { tokens: 320, contextWindow: 4096, percent: 7.8125 }
      })
      await assert.rejects(f.runtime.captureInvocation(f.ctx), /configuration changed during capture/)
    } finally {
      await f.close()
    }
  }

  {
    const f = fixture()
    const release = deferred()
    let writer: Promise<unknown> | undefined
    try {
      await f.emit('session_start')
      f.setUsage(() => {
        f.authorize(() => release.promise)
        writer = f.runtime.startWriter(f.ctx, 'Synthetic concurrent writer').catch(() => undefined)
        return { tokens: 320, contextWindow: 4096, percent: 7.8125 }
      })
      await assert.rejects(f.runtime.captureInvocation(f.ctx), /context changed during capture/)
    } finally {
      release.resolve()
      await writer
      await f.close()
    }
  }
})

test('ABI2 Palace context observes real Palace and rejects sampling races without retry', async () => {
  for (const race of ['none', 'revision', 'config', 'branch', 'revocation', 'writer']) {
    const f = fixture()
    const release = deferred()
    let writer: Promise<unknown> | undefined
    try {
      await f.emit('session_start')
      await f.emit('before_agent_start', { systemPrompt: 'Base' })
      f.setUsage(() => {
        if (race === 'revision') {
          const view = f.store.createView('synthetic')
          f.store.edit(view, 'projects/synthetic/reference/race.md', null, '# Race\n')
          f.store.integrate(view)
        }
        if (race === 'config')
          writeFileSync(join(f.root, 'config.json'), JSON.stringify({ ...f.store.config(), automatic: true }))
        if (race === 'branch') f.branch.push({ id: 'new' })
        if (race === 'revocation') f.setGranted(false)
        if (race === 'writer') {
          f.authorize(() => release.promise)
          writer = f.runtime.startWriter(f.ctx, 'Concurrent writer').catch(() => undefined)
        }
        return { tokens: 320, contextWindow: 4096, percent: 7.8125 }
      })
      if (race !== 'none') await assert.rejects(f.runtime.capturePalaceContext(f.ctx))
      else {
        const result = await f.runtime.capturePalaceContext(f.ctx)
        assert.equal(result.kind, 'abi2-palace-context-diagnostic')
        if (result.kind !== 'abi2-palace-context-diagnostic') throw Error('Wrong result')
        assert.equal(result.version, 2)
        assert.equal(result.consistency.atomic, false)
        assert.equal(result.consistency.committedSnapshot, 'owner-certified')
        assert.equal(result.consistency.invocationAssociation, 'observed-non-atomic')
        assert.equal(result.structure.bodyInspection, 'not-requested')
        assert.equal(result.structure.configHash, result.context.binding.configHash)
        assert.equal(result.structure.revision, result.context.memoryProjection?.revision)
        assert.ok(result.structure.files.some((file) => file.path === 'Core.md'))
        assert.doesNotMatch(
          JSON.stringify(result),
          /SYNTHETIC_TREE_CORE|memory-tree-|Synthetic effective prompt/,
        )
      }
    } finally {
      release.resolve()
      await writer
      await f.close()
    }
  }
})

test('cancelled tree: busy custom-trigger boundary does not speculate; later idle read recovers', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    f.setIdle(false)
    await f.emit('session_before_tree')
    const [result] = await f.emit('before_agent_start', {
      messageType: 'custom',
      systemPrompt: 'Base\n<mahiro-managed-memory>old</mahiro-managed-memory>',
    })
    assert.equal(result.systemPrompt, 'Base')
    assert.equal(f.runtime.status().active, false)
    await assert.rejects(f.read())
    f.setIdle(true)
    await f.read()
  } finally {
    await f.close()
  }
})

test('tree drains actual old continuation, fences stale write, and terminal overlap revokes pending rebind', async () => {
  for (const terminal of ['session_shutdown', 'session_before_switch', 'session_before_fork', 'overlap']) {
    const f = fixture()
    const reached = deferred()
    const release = deferred()
    try {
      await f.emit('session_start')
      await f.read() // actual engine already running when retirement starts
      const revision = f.store.snapshot().revision
      f.authorize(async () => {
        reached.resolve()
        await release.promise
      })
      const stale = f.runtime
        .run('agent_memory_manage', { action: 'remember', text: 'Never publish stale' }, f.ctx)
        .then(
          () => false,
          () => true,
        )
      await reached.promise
      f.setIdle(false)
      let drained = false
      const navigating = f.emit('session_before_tree').then((result) => {
        drained = true
        return result
      })
      await yieldTurn()
      assert.equal(drained, false, 'retirement is not quiescence')
      assert.equal(f.runtime.status().active, false)
      f.setIdle(true)
      const waitingRead = f.read().then(
        () => false,
        () => true,
      )
      const shutdown = f.emit(terminal === 'overlap' ? 'session_before_tree' : terminal)
      await yieldTurn()
      assert.equal(drained, false)
      release.resolve()
      assert.equal(await stale, true)
      assert.equal(await waitingRead, true)
      assert.deepEqual(await navigating, [{ cancel: true }])
      await shutdown
      await f.emit('session_tree') // late completion cannot resurrect terminal owner
      assert.equal(f.runtime.status().active, false)
      assert.equal(f.store.snapshot().revision, revision)
      assert.equal(f.holds(), 0)
    } finally {
      release.resolve()
      await f.close()
    }
  }
})

test('sequential tree may carry only a drained ticket with unchanged exact owner', async () => {
  for (const changed of ['none', 'generation', 'root', 'terminal']) {
    const f = fixture()
    try {
      await f.emit('session_start')
      await f.emit('session_before_tree') // cancelled; ticket is now genuinely drained
      if (changed === 'generation') f.node.generation = {}
      if (changed === 'root') f.abi.root = join(f.abi.root, 'changed')
      if (changed === 'terminal') await f.emit('session_shutdown')
      assert.deepEqual(
        await f.emit('session_before_tree'),
        changed === 'none' ? [undefined] : [{ cancel: true }],
      )
      await f.emit('session_tree')
      if (changed === 'none') await f.read()
      else await assert.rejects(f.read())
    } finally {
      await f.close()
    }
  }
})

test('concurrent idle admissions cannot revive after terminal retirement; rebind failure stays closed', async () => {
  for (const failure of ['terminal', 'hold', 'subscription', 'transition-check']) {
    const f = fixture()
    try {
      await f.emit('session_start')
      if (failure === 'transition-check')
        f.abi.isPrimarySession = () => {
          throw Error('Synthetic primary check failure')
        }
      assert.deepEqual(
        await f.emit('session_before_tree'),
        failure === 'transition-check' ? [{ cancel: true }] : [undefined],
      )
      if (failure === 'hold')
        f.abi.hold = () => {
          throw Error('Synthetic hold failure')
        }
      if (failure === 'subscription')
        f.abi.onRetire = () => {
          throw Error('Synthetic subscription failure')
        }
      const first = f.read().then(
        () => false,
        () => true,
      )
      const second = f.read().then(
        () => false,
        () => true,
      )
      if (failure === 'terminal') await f.emit('session_shutdown')
      assert.equal(await first, true, failure)
      assert.equal(await second, true, failure)
      assert.equal(f.runtime.status().active, false)
      assert.equal(f.holds(), 0)
      await assert.rejects(f.read())
    } finally {
      await f.close()
    }
  }
})

test('lazy rebind checks exact manager/session/node/ABI/generation/root and current authority', async () => {
  for (const changed of [
    'manager',
    'session',
    'node',
    'abi',
    'generation',
    'root',
    'primary',
    'live',
    'permission',
  ]) {
    const f = fixture()
    try {
      await f.emit('session_start')
      await f.emit('session_before_tree')
      let context = f.ctx
      if (changed === 'manager')
        context = { ...f.ctx, sessionManager: { ...f.ctx.sessionManager } } as ExtensionContext
      if (changed === 'session') f.ctx.sessionManager.getSessionId = () => 'other'
      if (changed === 'node') f.nodes.set('primary', { ...f.node })
      if (changed === 'abi') f.node.managedMemory = { ...f.abi }
      if (changed === 'generation') f.node.generation = {}
      if (changed === 'root') f.abi.root = join(f.abi.root, 'other')
      if (changed === 'primary') f.abi.isPrimarySession = () => false
      if (changed === 'live') f.abi.live = () => false
      if (changed === 'permission') f.setGranted(false)
      await assert.rejects(f.read(context), { name: 'Error' }, changed)
      if (changed !== 'permission') assert.equal(f.runtime.status().active, false, changed)
    } finally {
      await f.close()
    }
  }
})
