import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { setImmediate as yieldTurn } from 'node:timers/promises'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { activateAgentMemory } from '../extensions/mahiro-agent-memory.ts'
import { MemoryEngineController } from '../lib/agent-memory/engine/controller.ts'
import { MemoryDataEngine } from '../lib/agent-memory/engine/data.ts'
import { engineEnvironment } from '../lib/agent-memory/engine/io.ts'
import { createExperimentalMemoryRuntime } from '../lib/agent-memory/experimental-runtime.ts'
import { memoryFailureCode, publicMemoryError } from '../lib/agent-memory/reasons.ts'
import { createMemoryStore } from '../lib/agent-memory/store.ts'
import { digest } from '../lib/continuity/records.ts'

const registry = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

// Controlled ABI double for adversarial scheduling; real data child/store, not kernel/PSS proof.
function fixture(commandSurface = false, browserFailure?: 'sync' | 'async') {
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
  const commands = new Map<string, any>()
  const notifications: string[] = []
  const widgets: Array<{ key: string; content: string[] | undefined }> = []
  const statuses: Array<{ key: string; text: string | undefined }> = []
  const tools = ['agent_memory_read', 'agent_memory_manage', 'agent_memory_reflect'].map((name) => ({ name }))
  const pi = {
    on(name: string, fn: Function) {
      if (!handlers.has(name)) handlers.set(name, [])
      handlers.get(name)!.push(fn)
    },
    getAllTools: () => tools,
    registerCommand(name: string, command: unknown) {
      commands.set(name, command)
    },
    registerTool(tool: unknown) {
      tools.push(tool as (typeof tools)[number])
    },
  } as unknown as ExtensionAPI
  const branch: { id: string; parentId?: string | null; type?: string; timestamp?: string }[] = [
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
  ]
  const manager = {
    getSessionId: () => 'primary',
    getLeafId: () => branch.at(-1)?.id ?? null,
    getBranch: () => {
      if (branch.length > 8192) throw Error('synthetic getBranch refused')
      return branch
    },
    getEntry: (id: string) => branch.find((entry) => entry.id === id),
    getHeader: () => ({ type: 'session', id: 'primary' }),
    getSessionFile: () => undefined,
  }
  let idle = true
  let usage: unknown = { tokens: 320, contextWindow: 4096, percent: 7.8125 }
  let systemPrompt: unknown = 'Synthetic effective prompt'
  const ctx = {
    cwd,
    mode: 'tui',
    hasUI: true,
    sessionManager: manager,
    isIdle: () => idle,
    model: { provider: 'openai', id: 'synthetic-model' },
    getContextUsage: () => (typeof usage === 'function' ? (usage as () => unknown)() : usage),
    getSystemPrompt: () => systemPrompt,
    ui: {
      notify: (text: string) => notifications.push(text),
      setWidget: (key: string, content: string[] | undefined) => widgets.push({ key, content }),
      setStatus: (key: string, text: string | undefined) => statuses.push({ key, text }),
    },
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
  const openedUrls: string[] = []
  const openedFiles: string[] = []
  const openBrowser = (url: string, filePath?: string) => {
    openedUrls.push(url)
    if (filePath) openedFiles.push(filePath)
    if (browserFailure === 'sync') throw Error('Synthetic browser failure')
    if (browserFailure === 'async') return Promise.reject(Error('Synthetic browser failure'))
  }
  const runtime: any = commandSurface
    ? activateAgentMemory(pi, { root, nodes: nodes as any, openBrowser })
    : createExperimentalMemoryRuntime(pi, { openBrowser })
  const emit = async (name: string, event = {}, context = ctx) => {
    const results = []
    for (const handler of handlers.get(name) ?? []) results.push(await handler(event, context))
    return results
  }
  return {
    runtime,
    openedUrls,
    openedFiles,
    commands,
    notifications,
    widgets,
    statuses,
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
      if (commandSurface) await emit('session_shutdown')
      else {
        await runtime.cancel()
        await runtime.drain()
      }
      assert.equal(holds, 0)
      assert.equal(retirements.size, 0)
      globals[registry] = oldRegistry
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

for (const expired of [false, true]) {
  test(`primary draft survives ordinary next turn without rollover (expired=${expired})`, async () => {
    const f = fixture(true)
    const now = Date.now
    try {
      await f.emit('session_start')
      const args = {
        path: 'global/retained.md',
        expectedHash: null,
        text: '# Synthetic retained proposal\nNot published.\n',
        sources: [],
      }
      await f.runtime.run('agent_memory_edit', args, f.ctx)
      const draftDirectory = join(f.root, '.views/.engine-v2/drafts')
      const retained = new Map(
        readdirSync(draftDirectory).map((name) => [name, readFileSync(join(draftDirectory, name))]),
      )
      assert.equal(retained.size, 1)
      const revision = f.store.snapshot().revision
      if (expired) Date.now = () => now() + 600001
      await f.emit('input', { text: 'Continue the synthetic task', source: 'interactive' })
      await f.emit('before_agent_start', { systemPrompt: 'Synthetic next turn' })
      const read = () => f.runtime.run('agent_memory_read', { path: args.path }, f.ctx)
      if (expired) {
        for (const operation of [read, () => f.runtime.run('agent_memory_edit', args, f.ctx)])
          await assert.rejects(operation(), (error: unknown) => {
            assert.equal(memoryFailureCode(error).reason, 'draft')
            assert.match(publicMemoryError(error).message, /primary draft expired.*proposal preserved/)
            return true
          })
        Date.now = now
        assert.equal((await read()).text, args.text, 'the retained pointer still selects the original work')
      } else {
        assert.equal((await read()).text, args.text)
        await f.runtime.run('agent_memory_edit', { ...args, expectedHash: digest(args.text) }, f.ctx)
      }
      assert.equal(f.store.snapshot().revision, revision)
      assert.deepEqual(readdirSync(draftDirectory), [...retained.keys()])
      if (expired)
        for (const [name, bytes] of retained)
          assert.deepEqual(readFileSync(join(draftDirectory, name)), bytes)
      if (expired) {
        Date.now = () => now() + 600001
        await f.runtime.run('agent_memory_manage', { action: 'cancel' }, f.ctx)
        for (const [name, bytes] of retained)
          assert.deepEqual(JSON.parse(readFileSync(join(draftDirectory, name), 'utf8')), {
            ...JSON.parse(bytes.toString()),
            state: 'cancelled',
          })
        await f.runtime.run('agent_memory_edit', args, f.ctx)
        assert.equal((await read()).text, args.text)
        assert.equal(f.store.snapshot().revision, revision)
      }
    } finally {
      Date.now = now
      await f.close()
    }
  })
}

for (const changed of ['project', 'config']) {
  test(`primary draft ${changed} mismatch is diagnostic, never a replacement`, async () => {
    const f = fixture(true)
    try {
      const configPath = join(f.root, 'config.json')
      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      const other = join(f.root, '../other-project')
      mkdirSync(other)
      config.projects.push({ cwd: other, id: 'other' })
      writeFileSync(configPath, JSON.stringify(config))
      await f.emit('session_start')
      const args = { path: 'global/retained.md', expectedHash: null, text: '# Retained\n', sources: [] }
      await f.runtime.run('agent_memory_edit', args, f.ctx)
      const directory = join(f.root, '.views/.engine-v2/drafts')
      const before = readdirSync(directory).map(
        (name) => [name, readFileSync(join(directory, name))] as const,
      )
      if (changed === 'project') f.ctx.cwd = other
      else writeFileSync(configPath, JSON.stringify({ ...config, automatic: true }))
      for (const name of ['agent_memory_read', 'agent_memory_edit'])
        await assert.rejects(
          f.runtime.run(name, name === 'agent_memory_read' ? { path: args.path } : args, f.ctx),
          (error: unknown) => memoryFailureCode(error).reason === 'draft',
        )
      assert.deepEqual(
        readdirSync(directory),
        before.map(([name]) => name),
      )
      for (const [name, bytes] of before) assert.deepEqual(readFileSync(join(directory, name)), bytes)
      if (changed === 'config') {
        const revision = f.store.snapshot().revision
        await f.runtime.run('agent_memory_manage', { action: 'cancel' }, f.ctx)
        for (const [name, bytes] of before)
          assert.deepEqual(JSON.parse(readFileSync(join(directory, name), 'utf8')), {
            ...JSON.parse(bytes.toString()),
            state: 'cancelled',
          })
        await f.runtime.run('agent_memory_edit', args, f.ctx)
        assert.equal((await f.runtime.run('agent_memory_read', { path: args.path }, f.ctx)).text, args.text)
        assert.equal(f.store.snapshot().revision, revision)
      }
    } finally {
      await f.close()
    }
  })
}

test('concurrent primary first edits cannot replace the pending draft pointer', async () => {
  const f = fixture(true)
  const original = MemoryEngineController.prototype.request
  const entered = deferred()
  const release = deferred()
  let creates = 0
  MemoryEngineController.prototype.request = async function (this: MemoryEngineController, ...args) {
    if (args[0] === 'create') {
      creates++
      entered.resolve()
      await release.promise
    }
    return original.apply(this, args)
  }
  let first: Promise<unknown> | undefined
  try {
    await f.emit('session_start')
    const edit = (path: string) =>
      f.runtime.run(
        'agent_memory_edit',
        { path, expectedHash: null, text: '# Synthetic proposal\n', sources: [] },
        f.ctx,
      )
    first = edit('global/first.md')
    await entered.promise
    await assert.rejects(
      edit('global/second.md'),
      (error: unknown) => memoryFailureCode(error).reason === 'draft',
    )
    release.resolve()
    await first
    assert.equal(creates, 1)
    assert.equal(
      (await f.runtime.run('agent_memory_read', { path: 'global/first.md' }, f.ctx)).text,
      '# Synthetic proposal\n',
    )
  } finally {
    release.resolve()
    await first?.catch(() => {})
    MemoryEngineController.prototype.request = original
    await f.close()
  }
})

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

    await assert.rejects(
      f.runtime.run(
        'agent_memory_manage',
        { action: 'remember', path: 'projects/other/system/notes.md', text: 'Foreign project path' },
        f.ctx,
      ),
      /Memory path outside scope/,
    )
    const changed = (await f.runtime.run(
      'agent_memory_manage',
      { action: 'remember', text: 'New committed diagnostic revision' },
      f.ctx,
    )) as { revision: string }
    const rootIndexRead = (await f.runtime.run(
      'agent_memory_read',
      { path: 'index.md', offset: 0, limit: 4096 },
      f.ctx,
    )) as { text: string }
    assert.match(rootIndexRead.text, /\[\[system\/human\/notes\.md\]\]/)
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
        assert.equal(result.structure.bodyInspection, 'bounded-committed-preview')
        assert.equal(result.structure.configHash, result.context.binding.configHash)
        assert.equal(result.structure.revision, result.context.memoryProjection?.revision)
        assert.ok(
          result.structure.files.some(
            (file: { path: string; body?: string }) =>
              file.path === 'Core.md' && file.body?.includes('SYNTHETIC_TREE_CORE'),
          ),
        )
        assert.doesNotMatch(JSON.stringify(result), /memory-tree-|Synthetic effective prompt/)
      }
    } finally {
      release.resolve()
      await writer
      await f.close()
    }
  }
})

test('public status adds a bounded capacity subtype when ABI2 storage status is blocked', async () => {
  const f = fixture(true)
  try {
    const journal = join(f.root, '.views/.engine-v2/journal')
    mkdirSync(journal, { recursive: true, mode: 0o700 })
    for (let index = 0; index < 65; index++) {
      const hex = index.toString(16)
      const name = `${hex.padStart(8, '0')}-0000-4000-8000-${hex.padStart(12, '0')}.json`
      writeFileSync(join(journal, name), 'private-invalid-record')
    }
    await f.emit('session_start')
    const command = f.commands.get('mh-memory')
    assert.ok(command)
    await command.handler('status', f.ctx)
    const status = JSON.parse(f.notifications.at(-1)!)
    assert.equal(status.storage, 'unavailable')
    assert.equal(status.storageReason, 'capacity')
    assert.equal(status.storageCapacity.kind, 'abi2-capacity-diagnostic')
    assert.equal(status.storageCapacity.classification, 'status-namespace-capacity')
    assert.equal(status.storageCapacity.association, 'sequential-non-atomic')
    assert.deepEqual(status.storageCapacity.blockers.status, ['journal'])
    assert.deepEqual(status.storageCapacity.namespaces.journal, {
      entries: 65,
      matching: 65,
      exact: true,
      status: 'blocked',
      doctor: 'not-applicable',
      admission: 'blocked',
    })
    assert.equal(status.storageCapacity.corpusReturned, false)
    assert.doesNotMatch(JSON.stringify(status), /private-invalid-record|memory-tree-|\.views/)
  } finally {
    await f.close()
  }
})

function journalId(index: number) {
  const hex = index.toString(16)
  return `${hex.padStart(8, '0')}-0000-4000-8000-${hex.padStart(12, '0')}`
}

function terminalJournal(root: string, revision: string) {
  const ledger = {
    forgottenPaths: [],
    forgottenSources: [],
    reviewed: [],
    sources: { 'Core.md': [], 'index.md': [] },
    version: 2,
  }
  const ledgerText = JSON.stringify(ledger)
  const blob = 'a'.repeat(64)
  const planMeta = {
    id: '00000000-0000-4000-8000-000000000001',
    view: '00000000-0000-4000-8000-000000000002',
    base: revision,
    current: revision,
    configHash: blob,
    ledgerHash: digest(ledgerText),
    changes: [],
  }
  const plan = { ...planMeta, digest: digest(JSON.stringify(planMeta)) }
  const immutable = {
    root,
    rootIdentity: '1:1',
    plan,
    next: {
      'Core.md': { hash: blob, size: 1, sources: [] },
      'index.md': { hash: blob, size: 1, sources: [] },
    },
    ledger,
    ledgerText,
    proposalHash: blob,
    tree: [`100644 blob ${blob}\tCore.md`, `100644 blob ${blob}\tindex.md`],
  }
  return JSON.stringify({
    version: 1,
    immutable,
    immutableHash: digest(JSON.stringify(immutable)),
    sequence: 0,
    owner: null,
    receipt: { stage: 'reconciled_committed', observedCommit: revision },
  })
}

test('terminal journal limit and overflow cutoff/full slots leave status Ready but block reflect before spawn', async () => {
  for (const cutoff of ['journal', 'overflow-journal', 'overflow-slots'] as const) {
    const kind = cutoff === 'journal' ? 'journal' : 'drafts'
    const f = fixture(true)
    const spawns: string[] = []
    try {
      mkdirSync(join(f.root, '../agents'), { recursive: true })
      writeFileSync(
        join(f.root, '../agents/managed-memory-writer.md'),
        readFileSync(new URL('../agents/managed-memory-writer.md', import.meta.url)),
      )
      const physical = {
        provider: 'openai',
        id: 'gpt-6.1-sol',
        api: 'openai-responses',
        baseUrl: 'https://example.invalid',
        reasoning: true,
      }
      Object.assign(f.ctx, {
        modelRegistry: {
          getAll: () => [physical],
          getAvailable: () => [physical],
          find: () => physical,
        },
      })
      ;(f.abi as { parentService?: () => unknown }).parentService = () => ({
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
        spawn(_name: string, prompt: string) {
          spawns.push(prompt)
          return `job-${spawns.length}`
        },
      })
      const folder = join(f.root, '.views/.engine-v2', kind)
      mkdirSync(folder, { recursive: true, mode: 0o700 })
      if (kind === 'journal') {
        const body = terminalJournal(realpathSync(f.root), f.store.snapshot().revision)
        for (let index = 0; index < 64; index++)
          writeFileSync(join(folder, `${journalId(index)}.json`), body, { mode: 0o600 })
      } else {
        const seed = new MemoryDataEngine(realpathSync(f.root), engineEnvironment(process.env))
        const created = await seed.execute(
          'create',
          { project: 'synthetic', shared: true },
          async () => {},
          new AbortController().signal,
        )
        const template = JSON.parse(readFileSync(join(folder, `${created.view}.json`), 'utf8'))
        rmSync(join(folder, `${created.view}.json`))
        for (let index = 0; index < 64; index++) {
          const id = journalId(index)
          writeFileSync(join(folder, `${id}.json`), JSON.stringify({ ...template, id, state: 'cancelled' }), {
            mode: 0o600,
          })
        }
        const available = await seed.execute(
          'capacityDiagnostic',
          {},
          async () => {},
          new AbortController().signal,
        )
        assert.equal(available.namespaces.drafts.admission, 'available')
        if (cutoff === 'overflow-journal') {
          const journal = join(f.root, '.views/.engine-v2/journal')
          mkdirSync(journal, { recursive: true, mode: 0o700 })
          for (let index = 0; index < 32; index++)
            writeFileSync(
              join(journal, `${journalId(index)}.json`),
              terminalJournal(realpathSync(f.root), f.store.snapshot().revision),
              { mode: 0o600 },
            )
        } else {
          const slots = join(f.root, '.views/.engine-v2/overflow-drafts/slots')
          for (let index = 0; index < 32; index++)
            mkdirSync(join(slots, String(index).padStart(2, '0')), { recursive: true, mode: 0o700 })
        }
      }
      await f.emit('session_start')
      const command = f.commands.get('mh-memory')
      assert.ok(command)
      await command.handler('status', f.ctx)
      const status = JSON.parse(f.notifications.at(-1)!)
      assert.equal(status.readiness, 'Ready', kind)
      assert.equal(status.storage, 'authorized', kind)
      assert.equal(Object.hasOwn(status, 'storageCapacity'), false, kind)
      await assert.rejects(
        f.runtime.run('agent_memory_reflect', { assignment: 'Inspect retained capacity' }, f.ctx),
        (error: unknown) => {
          assert.equal(memoryFailureCode(error).reason, 'capacity')
          assert.doesNotMatch(String(error), /users|journal|drafts|\.views/)
          return true
        },
      )
      assert.equal(spawns.length, 0, kind)
      const diagnostic = await f.runtime.run('agent_memory_manage', { action: 'capacity' }, f.ctx)
      assert.equal(diagnostic.kind, 'abi2-capacity-diagnostic')
      assert.equal(diagnostic.corpusReturned, false)
      assert.equal(diagnostic.classification, 'non-namespace-status-capacity')
      assert.deepEqual(diagnostic.blockers.status, [])
      assert.deepEqual(diagnostic.blockers.admission, [kind])
      assert.equal(diagnostic.namespaces[kind].entries, 64)
      assert.equal(diagnostic.namespaces[kind].admission, 'blocked')
      assert.doesNotMatch(JSON.stringify(diagnostic), /SYNTHETIC_TREE_CORE|memory-tree-|\.views|users/)
    } finally {
      await f.close()
    }
  }
})

test('/mh-memory capacity dispatches the idle count-only diagnostic', async () => {
  const f = fixture(true)
  try {
    await f.emit('session_start')
    const command = f.commands.get('mh-memory')
    assert.ok(command)
    await command.handler('capacity extra', f.ctx)
    assert.match(f.notifications.at(-1)!, /Usage: \/mh-memory capacity/)
    await command.handler('capacity', f.ctx)
    const diagnostic = JSON.parse(f.notifications.at(-1)!)
    assert.equal(diagnostic.kind, 'abi2-capacity-diagnostic')
    assert.equal(diagnostic.corpusReturned, false)
    assert.doesNotMatch(JSON.stringify(diagnostic), /SYNTHETIC_TREE_CORE|memory-tree-|\.views/)
  } finally {
    await f.close()
  }
})

test('explicit capacity AbortSignal rejects before work and during a direct idle call', async () => {
  const f = fixture(true)
  try {
    await f.emit('session_start')
    const command = f.commands.get('mh-memory')
    assert.ok(command)
    await command.handler('capacity', f.ctx)
    const dispatched = JSON.parse(f.notifications.at(-1)!)
    assert.equal(dispatched.kind, 'abi2-capacity-diagnostic')
    await assert.rejects(
      f.runtime.run('agent_memory_manage', { action: 'capacity' }, f.ctx, AbortSignal.abort()),
      (error: unknown) => {
        assert.equal(error instanceof Error && error.name, 'AbortError')
        return true
      },
    )
    const controller = new AbortController()
    const original = MemoryEngineController.prototype.request
    MemoryEngineController.prototype.request = async function (this: MemoryEngineController, ...args) {
      if (args[0] === 'capacityDiagnostic') controller.abort()
      return original.apply(this, args)
    }
    try {
      await assert.rejects(f.runtime.capacityDiagnostic(f.ctx, controller.signal), (error: unknown) => {
        assert.equal(error instanceof Error && error.name, 'AbortError')
        return true
      })
    } finally {
      MemoryEngineController.prototype.request = original
    }
  } finally {
    await f.close()
  }
})

test('a denied capacity read leaves the Palace viewer open', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await f.emit('before_agent_start', { systemPrompt: 'Base' })
    const opened = await f.runtime.openPalaceViewer(f.ctx)
    assert.equal(f.runtime.status().palaceViewer, 'open')
    f.setGranted(false)
    await assert.rejects(f.runtime.run('agent_memory_manage', { action: 'capacity' }, f.ctx))
    assert.equal(f.runtime.status().palaceViewer, 'open')
    f.setGranted(true)
    const response = await fetch(opened.url)
    assert.equal(response.status, 200)
  } finally {
    await f.close()
  }
})

test('explicit capacity diagnostic stays bounded and fails closed when the idle fence moves', async () => {
  for (const race of ['none', 'leaf', 'revocation', 'idle', 'busy', 'cancel', 'generation'] as const) {
    const f = fixture(true)
    try {
      await f.emit('session_start')
      const command = f.commands.get('mh-memory')
      assert.ok(command)
      await command.handler('status', f.ctx)
      const status = JSON.parse(f.notifications.at(-1)!)
      assert.equal(status.storage, 'authorized')
      assert.equal(Object.hasOwn(status, 'storageCapacity'), false)
      const diagnose = () => f.runtime.run('agent_memory_manage', { action: 'capacity' }, f.ctx)
      if (race === 'none') {
        const diagnostic = await diagnose()
        assert.equal(diagnostic.kind, 'abi2-capacity-diagnostic')
        assert.equal(diagnostic.corpusReturned, false)
        assert.deepEqual(diagnostic.blockers.admission, [])
        assert.doesNotMatch(JSON.stringify(diagnostic), /SYNTHETIC_TREE_CORE|memory-tree-|\.views/)
      } else if (race === 'idle') {
        f.setIdle(false)
        await assert.rejects(diagnose(), /Idle ABI2 primary capacity diagnostic required/)
      } else {
        const original = MemoryEngineController.prototype.request
        MemoryEngineController.prototype.request = async function (this: MemoryEngineController, ...args) {
          if (args[0] === 'capacityDiagnostic') {
            if (race === 'leaf')
              f.branch.push({
                id: 'moved',
                parentId: f.branch.at(-1)?.id ?? null,
                type: 'message',
                timestamp: 't',
              })
            if (race === 'revocation') f.setGranted(false)
            if (race === 'busy') f.setIdle(false)
            if (race === 'cancel') void f.runtime.cancel()
            if (race === 'generation') f.abi.generation = {}
          }
          return original.apply(this, args)
        }
        try {
          await assert.rejects(diagnose())
        } finally {
          MemoryEngineController.prototype.request = original
        }
      }
    } finally {
      await f.close()
    }
  }
})

const longBranch = (
  branch: { id: string; parentId?: string | null; type?: string; timestamp?: string }[],
) => {
  branch[0] = { ...branch[0], parentId: null }
  for (let index = 1; index < branch.length; index++)
    branch[index] = { ...branch[index], parentId: branch[index - 1]?.id ?? null }
  while (branch.length < 8194)
    branch.push({
      id: `branch-${branch.length}`,
      parentId: branch.at(-1)?.id ?? null,
      type: 'message',
      timestamp: 't',
    })
}
const duringConfig = async (mutate: () => void, body: () => Promise<void>) => {
  const original = MemoryEngineController.prototype.request
  let pending = true
  MemoryEngineController.prototype.request = async function (this: MemoryEngineController, ...args) {
    if (pending && args[0] === 'config') {
      pending = false
      mutate()
    }
    return original.apply(this, args)
  }
  try {
    await body()
  } finally {
    MemoryEngineController.prototype.request = original
  }
}

test('public status reads a long session from the leaf without calling getBranch', async () => {
  const f = fixture(true)
  try {
    longBranch(f.branch)
    assert.throws(() => f.ctx.sessionManager.getBranch(), /getBranch refused/)
    await f.emit('session_start')
    const command = f.commands.get('mh-memory')
    assert.ok(command)
    await command.handler('status', f.ctx)
    const status = JSON.parse(f.notifications.at(-1)!)
    assert.equal(status.storage, 'authorized')
    assert.equal(Object.hasOwn(status, 'storageCapacity'), false)
    assert.equal(f.branch.length, 8194)
    assert.doesNotMatch(JSON.stringify(status), /branch-8193|memory-tree-|\.views/)
  } finally {
    await f.close()
  }
})

test('public status accepts one appended child and rejects a sibling, rewind, or revoked grant', async () => {
  for (const change of ['append', 'sibling', 'rewind', 'revocation'] as const) {
    const f = fixture(true)
    try {
      longBranch(f.branch)
      const before = f.branch.length
      await f.emit('session_start')
      const command = f.commands.get('mh-memory')
      assert.ok(command)
      await duringConfig(
        () => {
          const leaf = f.branch.at(-1)
          if (change === 'append')
            f.branch.push({ id: 'appended', parentId: leaf?.id ?? null, type: 'message', timestamp: 't' })
          if (change === 'sibling')
            f.branch.push({
              id: 'sibling',
              parentId: f.branch.at(-2)?.id ?? null,
              type: 'message',
              timestamp: 't',
            })
          if (change === 'rewind') f.branch.pop()
          if (change === 'revocation') f.setGranted(false)
        },
        () => command.handler('status', f.ctx),
      )
      const status = JSON.parse(f.notifications.at(-1)!)
      if (change === 'append') {
        assert.equal(status.storage, 'authorized')
        assert.equal(f.branch.length, before + 1)
      } else {
        assert.equal(status.storage, 'unavailable')
        assert.equal(Object.hasOwn(status, 'storageCapacity'), false)
        assert.equal(
          f.branch.length,
          change === 'sibling' ? before + 1 : change === 'rewind' ? before - 1 : before,
        )
      }
      assert.doesNotMatch(JSON.stringify(status), /branch-8193|memory-tree-|\.views/)
    } finally {
      await f.close()
    }
  }
})

test('exact invocation capture on a long session rejects a moved leaf', async () => {
  const childOfLeaf = (
    branch: { id: string; parentId?: string | null; type?: string; timestamp?: string }[],
  ) => {
    const leaf = branch.at(-1)
    assert.ok(leaf)
    branch.push({ id: 'child', parentId: leaf.id, type: 'message', timestamp: 't' })
  }
  for (const change of ['same', 'sibling', 'rewind', 'append'] as const) {
    const f = fixture(true)
    try {
      longBranch(f.branch)
      await f.emit('session_start')
      await f.emit('before_agent_start', { systemPrompt: 'Base' })
      f.setUsage(() => {
        if (change === 'sibling')
          f.branch.push({
            id: 'sibling',
            parentId: f.branch.at(-2)?.id ?? null,
            type: 'message',
            timestamp: 't',
          })
        if (change === 'rewind') f.branch.pop()
        if (change === 'append') childOfLeaf(f.branch)
        return { tokens: 320, contextWindow: 4096, percent: 7.8125 }
      })
      if (change === 'same') {
        const captured = await f.runtime.captureInvocation(f.ctx)
        assert.equal(typeof captured, 'object')
        assert.equal(f.branch.length, 8194)
      } else await assert.rejects(f.runtime.captureInvocation(f.ctx), /context changed during capture/)
    } finally {
      await f.close()
    }
  }
  const f = fixture(true)
  try {
    longBranch(f.branch)
    await f.emit('session_start')
    const command = f.commands.get('mh-memory')
    assert.ok(command)
    await duringConfig(
      () => childOfLeaf(f.branch),
      () => command.handler('status', f.ctx),
    )
    const status = JSON.parse(f.notifications.at(-1)!)
    assert.equal(status.storage, 'authorized')
    assert.equal(f.branch.at(-1)?.id, 'child')
    assert.equal(f.branch.at(-1)?.parentId, f.branch.at(-2)?.id)
  } finally {
    await f.close()
  }
})

test('public capacity fallback fails closed when idle eligibility changes during authorization', async () => {
  const f = fixture(true)
  try {
    const journal = join(f.root, '.views/.engine-v2/journal')
    mkdirSync(journal, { recursive: true, mode: 0o700 })
    for (let index = 0; index < 65; index++) {
      const hex = index.toString(16)
      writeFileSync(
        join(journal, `${hex.padStart(8, '0')}-0000-4000-8000-${hex.padStart(12, '0')}.json`),
        'private-invalid-record',
      )
    }
    let authorizations = 0
    f.authorize(async () => {
      authorizations++
      if (authorizations === 2) f.setIdle(false)
    })
    await f.emit('session_start')
    const command = f.commands.get('mh-memory')
    assert.ok(command)
    await command.handler('status', f.ctx)
    const status = JSON.parse(f.notifications.at(-1)!)
    assert.equal(status.storage, 'unavailable')
    assert.equal(status.storageReason, 'capacity')
    assert.equal(Object.hasOwn(status, 'storageCapacity'), false)
  } finally {
    await f.close()
  }
})

test('public capacity fallback fails closed when the current leaf changes during authorization', async () => {
  const f = fixture(true)
  try {
    const journal = join(f.root, '.views/.engine-v2/journal')
    mkdirSync(journal, { recursive: true, mode: 0o700 })
    for (let index = 0; index < 65; index++) {
      const hex = index.toString(16)
      writeFileSync(
        join(journal, `${hex.padStart(8, '0')}-0000-4000-8000-${hex.padStart(12, '0')}.json`),
        'private-invalid-record',
      )
    }
    let authorizations = 0
    f.authorize(async () => {
      authorizations++
      if (authorizations === 2) f.branch[f.branch.length - 1] = { id: 'changed-leaf', parentId: 'a' }
    })
    await f.emit('session_start')
    const command = f.commands.get('mh-memory')
    assert.ok(command)
    await command.handler('status', f.ctx)
    const status = JSON.parse(f.notifications.at(-1)!)
    assert.equal(status.storage, 'unavailable')
    assert.equal(status.storageReason, 'capacity')
    assert.equal(Object.hasOwn(status, 'storageCapacity'), false)
  } finally {
    await f.close()
  }
})

test('public status does not attach capacity metadata to a non-capacity storage failure', async () => {
  const f = fixture(true)
  try {
    const journal = join(f.root, '.views/.engine-v2/journal')
    mkdirSync(journal, { recursive: true, mode: 0o700 })
    writeFileSync(join(journal, '00000000-0000-4000-8000-000000000000.json'), 'private-invalid-record')
    await f.emit('session_start')
    const command = f.commands.get('mh-memory')
    assert.ok(command)
    await command.handler('status', f.ctx)
    const status = JSON.parse(f.notifications.at(-1)!)
    assert.equal(status.storage, 'unavailable')
    assert.equal(status.storageReason, 'unknown')
    assert.equal(Object.hasOwn(status, 'storageCapacity'), false)
    assert.doesNotMatch(JSON.stringify(status), /private-invalid-record|memory-tree-|\.views/)
  } finally {
    await f.close()
  }
})

test('public Palace façade dispatches viewer, close and structural JSON on ABI2', async () => {
  const f = fixture(true)
  try {
    await f.emit('session_start')
    const command = f.commands.get('mh-memory')
    assert.ok(command)

    await command.handler('palace json', f.ctx)
    const diagnostic = JSON.parse(f.notifications.at(-1)!)
    assert.equal(typeof diagnostic, 'object')
    assert.equal('url' in diagnostic, false)

    await command.handler('palace', f.ctx)
    const opened = f.notifications.at(-1)!
    const url = f.openedUrls.at(-1)!
    const palaceWidgets = f.widgets.filter((entry) => entry.key === 'mahiro-palace')
    const palaceStatuses = f.statuses.filter((entry) => entry.key === 'mahiro-palace')
    assert.ok(palaceWidgets.length >= 2)
    assert.match(palaceWidgets[0]?.content?.[0] ?? '', /Generating Memory viewer\.\.\./)
    assert.equal(palaceWidgets.at(-1)?.content, undefined)
    assert.deepEqual(palaceStatuses, [
      { key: 'mahiro-palace', text: '⏳ Generating Memory viewer...' },
      { key: 'mahiro-palace', text: undefined },
    ])
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}$/)
    assert.match(opened, /Memory viewer opened in browser/)
    assert.match(opened, /File: .*\/viewers\/memory-synthetic\.html/)
    assert.match(opened, /Close: \/mh-memory palace close/)
    const response = await fetch(url)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /\/mh-memory palace close/)

    await command.handler('palace close', f.ctx)
    assert.equal(f.notifications.at(-1), 'Palace viewer closed.')
    await assert.rejects(fetch(url))
  } finally {
    await f.close()
  }
})

test('ABI2 Palace HTML serves one frozen page and revokes on authority or new work', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await f.emit('before_agent_start', { systemPrompt: 'Base' })
    const opened = await f.runtime.openPalaceViewer(f.ctx)
    assert.equal(opened.kind, 'abi2-palace-html-viewer')
    assert.equal(opened.atomic, false)
    assert.equal(opened.closeCommand, '/mh-memory palace close')
    assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}$/)
    assert.equal(opened.filePath, join(dirname(f.root), 'viewers', 'memory-synthetic.html'))
    assert.deepEqual(f.openedUrls, [opened.url])
    assert.deepEqual(f.openedFiles, [opened.filePath])
    assert.equal(statSync(dirname(opened.filePath)).mode & 0o777, 0o700)
    assert.equal(statSync(opened.filePath).mode & 0o777, 0o600)
    const response = await fetch(opened.url)
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.equal(readFileSync(opened.filePath, 'utf8'), html)
    assert.match(html, /Memory Palace/)
    assert.match(html, /Mahiro Pi/)
    assert.match(html, /SYNTHETIC_TREE_CORE/)
    assert.doesNotMatch(html, /Synthetic effective prompt|memory-tree-/)
    assert.equal(f.runtime.status().palaceViewer, 'open')

    f.setGranted(false)
    const stale = await fetch(opened.url)
    assert.equal(stale.status, 409)
    assert.notEqual(f.runtime.status().palaceViewer, 'open')
    f.setGranted(true)

    const view = f.store.createView('synthetic')
    f.store.edit(
      view,
      'projects/synthetic/system/round-two.md',
      null,
      '---\ndescription: Round two system note\n---\n# Round Two\nROUND_TWO_CORE\n',
    )
    f.store.integrate(view)
    const replacement = await f.runtime.openPalaceViewer(f.ctx)
    assert.equal(replacement.filePath, opened.filePath)
    assert.equal(f.runtime.status().palaceViewer, 'open')
    await f.emit('input', { text: 'new work', source: 'interactive' })
    assert.equal(f.runtime.status().palaceViewer, undefined)
    await assert.rejects(fetch(replacement.url))
    assert.match(readFileSync(replacement.filePath, 'utf8'), /ROUND_TWO_CORE/)

    const closeResult = await f.runtime.closePalaceViewer()
    assert.equal(closeResult.closed, false)
    const nonTui = { ...(f.ctx as unknown as Record<string, unknown>), mode: 'print', hasUI: false }
    await assert.rejects(f.runtime.openPalaceViewer(nonTui as unknown as ExtensionContext), /TUI/)
  } finally {
    await f.close()
  }
})

test('ABI2 Palace browser failures are nonfatal after viewer publication, including router injection', async () => {
  for (const commandSurface of [false, true]) {
    for (const failure of ['sync', 'async'] as const) {
      const f = fixture(commandSurface, failure)
      try {
        await f.emit('session_start')
        await f.emit('before_agent_start', { systemPrompt: 'Base' })
        const opened = await f.runtime.openPalaceViewer(f.ctx)
        assert.deepEqual(f.openedUrls, [opened.url])
        assert.equal(f.runtime.status().palaceViewer, 'open')
        assert.equal((await fetch(opened.url)).status, 200)
        await f.runtime.closePalaceViewer()
        await assert.rejects(fetch(opened.url))
      } finally {
        await f.close()
      }
    }
  }
})

test('ABI2 Palace HTML opening is abortable and joined before it can publish a server', async () => {
  const f = fixture()
  const reached = deferred()
  const release = deferred()
  try {
    await f.emit('session_start')
    f.authorize(async () => {
      reached.resolve()
      await release.promise
    })
    const opening = f.runtime.openPalaceViewer(f.ctx)
    const rejected = assert.rejects(opening)
    await reached.promise
    const closing = f.runtime.closePalaceViewer()
    release.resolve()
    assert.equal((await closing).closed, true)
    await rejected
    assert.equal(f.runtime.status().palaceViewer, undefined)
    assert.deepEqual(f.openedUrls, [])
  } finally {
    release.resolve()
    await f.close()
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

function draftManifest(id: string, revision: string, state: string, dirty = false) {
  const hash = 'a'.repeat(64)
  return JSON.stringify({
    version: 2,
    id,
    project: 'synthetic',
    shared: false,
    configHash: hash,
    base: {
      revision,
      refs: {
        'Core.md': { oid: revision, hash, size: 1, sources: [] },
        'index.md': { oid: revision, hash, size: 1, sources: [] },
      },
      ledger: {
        forgottenPaths: [],
        forgottenSources: [],
        reviewed: [],
        sources: { 'Core.md': [], 'index.md': [] },
        version: 2,
      },
    },
    overlay: dirty
      ? {
          'global/notes.md': {
            blob: '00000000-0000-4000-8000-000000000099',
            hash,
            size: 1,
            sources: [],
            identity: '1:1',
          },
        }
      : {},
    state,
    deadline: 0,
  })
}

function referencingJournal(root: string, revision: string, view: string) {
  const record = JSON.parse(terminalJournal(root, revision))
  const { digest: _previous, ...metadata } = { ...record.immutable.plan, view }
  record.immutable.plan = { ...metadata, digest: digest(JSON.stringify(metadata)) }
  record.immutableHash = digest(JSON.stringify(record.immutable))
  return JSON.stringify(record)
}

test('retained draft preview reports terminal manifests and never archives them', async () => {
  const f = fixture(true)
  try {
    const revision = f.store.snapshot().revision
    const root = realpathSync(f.root)
    const drafts = join(root, '.views/.engine-v2/drafts')
    const journal = join(root, '.views/.engine-v2/journal')
    mkdirSync(drafts, { recursive: true, mode: 0o700 })
    mkdirSync(journal, { recursive: true, mode: 0o700 })
    const ids = {
      cancelled: journalId(1),
      committed: journalId(2),
      referenced: journalId(3),
      open: journalId(4),
      ready: journalId(5),
      conflict: journalId(6),
      dirty: journalId(7),
      unknown: journalId(8),
    }
    const bodies = new Map<string, string>([
      [ids.cancelled, draftManifest(ids.cancelled, revision, 'cancelled')],
      [ids.committed, draftManifest(ids.committed, revision, 'committed')],
      [ids.referenced, draftManifest(ids.referenced, revision, 'cancelled')],
      [ids.open, draftManifest(ids.open, revision, 'open')],
      [ids.ready, draftManifest(ids.ready, revision, 'ready')],
      [ids.conflict, draftManifest(ids.conflict, revision, 'conflict')],
      [ids.dirty, draftManifest(ids.dirty, revision, 'cancelled', true)],
      [ids.unknown, '{'],
    ])
    for (const [id, body] of bodies) writeFileSync(join(drafts, `${id}.json`), body, { mode: 0o600 })
    writeFileSync(join(journal, `${journalId(9)}.json`), referencingJournal(root, revision, ids.referenced), {
      mode: 0o600,
    })
    const before = new Map([...bodies].map(([id]) => [id, readFileSync(join(drafts, `${id}.json`))]))
    await f.emit('session_start')
    const viewsBefore = readdirSync(join(root, '.views')).sort()
    const command = f.commands.get('mh-memory')
    assert.ok(command)
    await command.handler('retained-preview extra', f.ctx)
    assert.match(f.notifications.at(-1)!, /Usage: \/mh-memory retained-preview/)
    await command.handler('retained-preview', f.ctx)
    const preview = JSON.parse(f.notifications.at(-1)!)
    assert.equal(preview.kind, 'abi2-retained-draft-preview')
    assert.equal(preview.safeCandidates, 0)
    assert.equal(preview.quiescence, 'unproven')
    assert.equal(preview.mutation, 'not-performed')
    assert.equal(preview.reason, 'cross-controller-exclusion-unproven')
    assert.equal(preview.corpusReturned, false)
    assert.equal(preview.observed.exact, true)
    assert.equal(preview.observed.terminal, 2)
    assert.equal(preview.observed.open, 1)
    assert.equal(preview.observed.ready, 1)
    assert.equal(preview.observed.conflict, 1)
    assert.equal(preview.observed.dirty, 1)
    assert.equal(preview.observed.journalReferenced, 1)
    assert.equal(preview.observed.unknown, 1)
    assert.equal(preview.observed.locallyActive, 0)
    assert.equal(preview.observed.unstable, 0)
    assert.equal(Object.hasOwn(preview, 'hypothetical'), false)
    assert.equal(readdirSync(drafts).length, 8)
    assert.deepEqual(readdirSync(join(root, '.views')).sort(), viewsBefore)
    for (const [id, body] of before) assert.deepEqual(readFileSync(join(drafts, `${id}.json`)), body)
    assert.doesNotMatch(JSON.stringify(preview), /SYNTHETIC_TREE_CORE|memory-tree-|\.views|global\/notes/)
  } finally {
    await f.close()
  }
})

test('an unreadable journal keeps every terminal draft uncertain and still writes nothing', async () => {
  const f = fixture(true)
  try {
    const revision = f.store.snapshot().revision
    const root = realpathSync(f.root)
    const drafts = join(root, '.views/.engine-v2/drafts')
    const journal = join(root, '.views/.engine-v2/journal')
    mkdirSync(drafts, { recursive: true, mode: 0o700 })
    mkdirSync(journal, { recursive: true, mode: 0o700 })
    const id = journalId(1)
    const body = draftManifest(id, revision, 'cancelled')
    writeFileSync(join(drafts, `${id}.json`), body, { mode: 0o600 })
    writeFileSync(join(journal, `${journalId(2)}.json`), '{', { mode: 0o600 })
    await f.emit('session_start')
    const viewsBefore = readdirSync(join(root, '.views')).sort()
    const preview = await f.runtime.run('agent_memory_manage', { action: 'retained-preview' }, f.ctx)
    assert.equal(preview.safeCandidates, 0)
    assert.equal(preview.mutation, 'not-performed')
    assert.equal(preview.observed.exact, false)
    assert.equal(preview.observed.terminal, 0)
    assert.equal(preview.observed.unknown, 1)
    assert.equal(readFileSync(join(drafts, `${id}.json`), 'utf8'), body)
    assert.deepEqual(readdirSync(join(root, '.views')).sort(), viewsBefore)
  } finally {
    await f.close()
  }
})

test('retained draft preview interruption and a concurrent writer leave the original bytes in place', async () => {
  const f = fixture(true)
  const other = new MemoryEngineController(realpathSync(f.root), engineEnvironment(process.env))
  const original = MemoryEngineController.prototype.request
  try {
    const revision = f.store.snapshot().revision
    const root = realpathSync(f.root)
    const drafts = join(root, '.views/.engine-v2/drafts')
    mkdirSync(drafts, { recursive: true, mode: 0o700 })
    const id = journalId(1)
    const body = draftManifest(id, revision, 'cancelled')
    writeFileSync(join(drafts, `${id}.json`), body, { mode: 0o600 })
    await f.emit('session_start')
    const viewsBefore = readdirSync(join(root, '.views')).sort()
    await assert.rejects(
      f.runtime.run('agent_memory_manage', { action: 'retained-preview' }, f.ctx, AbortSignal.abort()),
      (error: unknown) => {
        assert.equal(error instanceof Error && error.name, 'AbortError')
        return true
      },
    )
    assert.equal(readFileSync(join(drafts, `${id}.json`), 'utf8'), body)
    const controller = new AbortController()
    MemoryEngineController.prototype.request = async function (this: MemoryEngineController, ...args) {
      if (args[0] === 'retainedDraftPreview') controller.abort()
      return original.apply(this, args)
    }
    await assert.rejects(f.runtime.retainedDraftPreview(f.ctx, controller.signal), (error: unknown) => {
      assert.equal(error instanceof Error && error.name, 'AbortError')
      return true
    })
    assert.equal(readFileSync(join(drafts, `${id}.json`), 'utf8'), body)
    assert.deepEqual(readdirSync(join(root, '.views')).sort(), viewsBefore)
    MemoryEngineController.prototype.request = async function (this: MemoryEngineController, ...args) {
      if (args[0] === 'retainedDraftPreview')
        await original.call(other, 'create', { project: 'synthetic' }, { current: () => true })
      return original.apply(this, args)
    }
    const preview = await f.runtime.run('agent_memory_manage', { action: 'retained-preview' }, f.ctx)
    assert.equal(preview.safeCandidates, 0)
    assert.equal(preview.mutation, 'not-performed')
    assert.equal(preview.quiescence, 'unproven')
    assert.equal(readFileSync(join(drafts, `${id}.json`), 'utf8'), body)
    const names = readdirSync(drafts)
    assert.equal(names.length, 2)
    assert.ok(names.includes(`${id}.json`))
    assert.deepEqual(readdirSync(join(root, '.views')).sort(), viewsBefore)
  } finally {
    MemoryEngineController.prototype.request = original
    await other.close()
    await f.close()
  }
})

test('a denied retained draft preview leaves the Palace viewer open', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await f.emit('before_agent_start', { systemPrompt: 'Base' })
    const opened = await f.runtime.openPalaceViewer(f.ctx)
    assert.equal(f.runtime.status().palaceViewer, 'open')
    f.setGranted(false)
    await assert.rejects(f.runtime.run('agent_memory_manage', { action: 'retained-preview' }, f.ctx))
    assert.equal(f.runtime.status().palaceViewer, 'open')
    f.setGranted(true)
    const response = await fetch(opened.url)
    assert.equal(response.status, 200)
  } finally {
    await f.close()
  }
})

test('automatic off stays off and explicit reflect does not wait for assistant steps', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    assert.deepEqual(await f.runtime.startWriter(f.ctx), { skipped: 'automatic-off' })
    await assert.rejects(f.runtime.startWriter(f.ctx, 'Keep the synthetic tree note'), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.doesNotMatch(error.message, /automatic-off|assistant step|reflection/)
      return true
    })
  } finally {
    await f.close()
  }
})

test('ABI2 agent_memory_edit with commit=true auto-syncs parent and root index.md and publishes in one step', async () => {
  const f = fixture(true)
  try {
    await f.emit('session_start')
    const committed: any = await f.runtime.run(
      'agent_memory_edit',
      {
        path: 'projects/synthetic/reference/api/rollbacks.md',
        expectedHash: null,
        text: '---\nname: rollbacks\ndescription: API deployment rollback playbook and checks.\n---\n# Rollbacks\nVerify migration state before rolling back.\n',
        sources: [],
        commit: true,
      },
      f.ctx,
    )
    assert.equal(committed.path, 'projects/synthetic/reference/api/rollbacks.md')
    assert.ok(typeof committed.revision === 'string' && committed.revision.length > 0)

    const snapshot = f.store.snapshot()
    assert.match(
      snapshot.files['projects/synthetic/reference/api/rollbacks.md']?.text ?? '',
      /Verify migration state before rolling back/,
    )
    assert.match(
      snapshot.files['projects/synthetic/reference/api/index.md']?.text ?? '',
      /\[\[projects\/synthetic\/reference\/api\/rollbacks\.md\]\] — API deployment rollback playbook and checks\./,
    )
    assert.match(
      snapshot.files['index.md']?.text ?? '',
      /\[\[projects\/synthetic\/reference\/api\/rollbacks\.md\]\] — API deployment rollback playbook and checks\./,
    )
    const projection = f.store.projection('synthetic')
    assert.ok(
      projection.discovery.directories?.some((d) => d.index === 'projects/synthetic/reference/api/index.md'),
    )
  } finally {
    await f.close()
  }
})
