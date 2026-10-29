import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { activateAgentMemory } from '../extensions/mahiro-agent-memory.ts'
import { createAgentMemoryRuntime } from '../lib/agent-memory/runtime.ts'
import { createMemoryStore } from '../lib/agent-memory/store.ts'
import { digest } from '../lib/continuity/records.ts'
import { memoryCurationDoctrine } from '../lib/agent-memory/guidance.ts'
import { memoryFailure, memoryFailureCode } from '../lib/agent-memory/reasons.ts'

process.env.GIT_AUTHOR_NAME = 'Memory fixture'
process.env.GIT_AUTHOR_EMAIL = 'fixture@example.invalid'
process.env.GIT_COMMITTER_NAME = 'Memory fixture'
process.env.GIT_COMMITTER_EMAIL = 'fixture@example.invalid'
const parent = new URL('../.agent-state/runtime/', import.meta.url).pathname
// Native before_agent_start observers may return nothing. Only prompt-bearing
// results replace the prompt; a later observer must not erase that replacement.
function promptResult(results: unknown[]) {
  return results.findLast(
    (result): result is { systemPrompt: string } =>
      typeof result === 'object' &&
      result !== null &&
      'systemPrompt' in result &&
      typeof result.systemPrompt === 'string',
  )
}

function fixture(twoProjects = false) {
  const dir = mkdtempSync(join(parent, 'managed-memory-runtime-'))
  const previousProfile = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = dir
  mkdirSync(join(dir, 'agents'), { mode: 0o700 })
  writeFileSync(
    join(dir, 'agents/managed-memory-writer.md'),
    readFileSync(new URL('../agents/managed-memory-writer.md', import.meta.url)),
    { mode: 0o600 },
  )
  const root = join(dir, 'memory')
  const cwd = join(dir, 'project')
  mkdirSync(cwd)
  const cwdB = join(dir, 'other')
  if (twoProjects) mkdirSync(cwdB)
  const store = createMemoryStore(root)
  store.initialize(
    {
      version: 1,
      projects: [{ cwd, id: 'project' }, ...(twoProjects ? [{ cwd: cwdB, id: 'other' }] : [])],
      coreBytes: 8192,
      indexBytes: 2048,
      fileBytes: 8192,
      totalBytes: 65536,
      automatic: true,
    },
    '# Core\nEstablished companion identity.\n',
  )
  const events = new Map<string, Set<Function>>()
  const handlers = new Map<string, Function[]>()
  const tools: any[] = []
  const commands = new Map<string, any>()
  const bus = {
    on(name: string, fn: Function) {
      if (!events.has(name)) events.set(name, new Set())
      events.get(name)!.add(fn)
      return () => events.get(name)!.delete(fn)
    },
  }
  const pi: any = {
    events: bus,
    on(name: string, fn: Function) {
      if (!handlers.has(name)) handlers.set(name, [])
      handlers.get(name)!.push(fn)
    },
    registerCommand(name: string, definition: any) {
      commands.set(name, definition)
    },
    registerTool(t: any) {
      tools.push(t)
    },
    getAllTools() {
      return tools
    },
  }
  const branch: any[] = []
  const sm = {
    getSessionId: () => 'primary',
    getBranch: () => branch,
    getHeader: () => ({ type: 'session', id: 'primary' }),
  }
  const physical = {
    provider: 'openai',
    id: 'gpt-6.1-sol',
    api: 'openai-responses',
    baseUrl: 'https://example.invalid',
    reasoning: true,
  }
  const ctx: any = {
    cwd,
    sessionManager: sm,
    modelRegistry: { getAll: () => [physical], getAvailable: () => [physical], find: () => physical },
  }
  let granted = true,
    healthy = true,
    revoked = false,
    spawned: any,
    descriptor: any = {
      name: 'managed-memory-writer',
      model: 'openai/gpt-6.1-sol',
      thinking: 'medium',
      locked: true,
      inheritContext: false,
      runInBackground: true,
      promptMode: 'replace',
      toolNames: ['agent_memory_read', 'agent_memory_edit', 'agent_memory_commit'],
    }
  let record: any
  let sequence = 0
  let binding: any
  const generation = {}
  const service = {
    supportsInitialOutcomeClaim: true,
    getAgentType: () => descriptor,
    hasRunning: () => false,
    getRecord: () => record,
    abort(id: string) {
      record.status = 'stopped'
      return true
    },
    spawn(name: string, prompt: string, options: any) {
      spawned = { name, prompt, options }
      record = {
        id: `job-${++sequence}`,
        type: name,
        status: 'running',
        outputFile: 'authoritative-native-session-file',
      }
      return record.id
    },
  }
  const abi: any = {
    version: 1,
    generation,
    trustedTool: (tool: any) => tools.includes(tool),
    isPrimarySession: (c: any) => c.sessionManager === sm,
    assertAccess(tool: any, c: any, r: string) {
      if (!granted || r !== root || revoked) throw new Error('permission unavailable')
      if (c.sessionManager === sm) return { kind: 'primary' }
      if (!binding || c.sessionManager !== binding.sm || !binding.active()) throw new Error('unbound child')
      return { kind: 'worker', value: binding.value }
    },
    async authorize(...args: any[]) {
      return abi.assertAccess(...args)
    },
    parentService: () => service,
    bindWorker(_tool: any, _ctx: any, _root: string, id: string, value: any, active: Function) {
      const ownBinding = { id, value, active }
      binding = ownBinding
      return () => {
        if (binding === ownBinding) binding = undefined
      }
    },
  }
  const nodes = new Map<string, any>([
    ['primary', { generation, healthy: () => healthy, managedMemory: abi }],
  ])
  const runtime = activateAgentMemory(pi, { root, nodes })
  const emit = async (name: string, event: any = {}, context = ctx) => {
    const result = []
    for (const fn of handlers.get(name) ?? []) result.push(await fn(event, context))
    return result
  }
  const nativeEvent = (name: string, payload: any = { id: record?.id, type: record?.type }) => {
    for (const fn of events.get(name) ?? []) fn(payload)
  }
  const child = () => {
    const childSM = {
      getSessionId: () => 'child',
      getHeader: () => ({ type: 'session', id: 'child', parentSession: 'primary' }),
    }
    binding.sm = childSM
    nodes.set('child', {
      generation,
      healthy: () => healthy,
      managedMemory: abi,
    })
    // Deliberate context double: memory binds by SessionManager identity, while
    // workflow lifecycle observers also inspect the native child-session header.
    // Full public host contexts are exercised by the separate SDK fixtures.
    return { cwd, sessionManager: childSM } as ExtensionContext
  }
  return {
    root,
    cwdB,
    store,
    ctx,
    runtime,
    pi,
    emit,
    async prompt(systemPrompt: string, context = ctx) {
      return promptResult(await emit('before_agent_start', { systemPrompt }, context))
    },
    nativeEvent,
    branch,
    tools,
    commands,
    child,
    get spawned() {
      return spawned
    },
    get binding() {
      return binding
    },
    get record() {
      return record
    },
    setGranted(v: boolean) {
      granted = v
    },
    setHealthy(v: boolean) {
      healthy = v
    },
    revoke() {
      revoked = true
    },
    setRole(v: any) {
      descriptor = v
    },
    setVersion(v: number) {
      abi.version = v
    },
    get abi() {
      return abi
    },
    service,
    nodes,
    close() {
      runtime.cancel()
      if (previousProfile === undefined) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = previousProfile
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('memory help identifies Palace as JSON-only diagnostics and distinguishes ABI1/ABI2 doctor fields', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const notifications: string[] = []
    f.ctx.ui = { notify: (text: string) => notifications.push(text) }
    await f.commands.get('mh-memory').handler('help', f.ctx)
    const help = notifications.at(-1)!
    assert.match(help, /doctor returns engine-specific JSON diagnostics/)
    assert.match(help, /ABI2 reports budget, missing-description, unmigrated-path and conflict state/)
    assert.match(help, /legacy ABI1 also reports Git-entry and broken-link findings/)
    assert.match(help, /palace returns a JSON-only structural\/link\/view\/episode report/)
    assert.match(help, /no HTML page, dashboard or file export/)
    assert.doesNotMatch(help, /doctor runs health, budget and link checks/)
  } finally {
    f.close()
  }
})

test('safe memory reasons sanitize registered tools and every command including status without trusting error text', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const notifications: string[] = []
    f.ctx.ui = { notify: (text: string) => notifications.push(text) }
    const command = f.commands.get('mh-memory')
    const tool = f.tools.find((entry) => entry.name === 'agent_memory_read')
    const privateText = '/private/fixture/path # Secret heading stderr: dangerous output'
    const failures = [
      new Error(`Memory read unavailable: current forgotten knowledge; ${privateText}`),
      Object.assign(new Error(privateText), { reason: 'capacity', readInvalidation: 'forgetting' }),
      {
        get message() {
          throw new Error('getter must not run')
        },
        reason: 'deadline',
      },
      memoryFailure('capacity', privateText),
      memoryFailure('deadline', privateText),
      memoryFailure('branch', privateText),
      memoryFailure('CAS', privateText),
      memoryFailure('retention', privateText),
    ]
    for (const [index, failure] of failures.entries()) {
      f.abi.assertAccess = () => {
        throw failure
      }
      await assert.rejects(tool.execute('read', {}, undefined, undefined, f.ctx), (error: Error) => {
        assert.ok(!error.message.includes(privateText))
        assert.ok(!error.message.includes('current forgetting'))
        assert.match(
          error.message,
          new RegExp(`reason: ${index < 3 ? 'unknown' : memoryFailureCode(failure).reason}`),
        )
        return true
      })
      for (const action of ['doctor', 'palace', 'remember synthetic', 'init', 'dream']) {
        await command.handler(action, f.ctx)
        assert.equal(
          notifications.at(-1),
          (await import('../lib/agent-memory/reasons.ts')).publicMemoryError(failure).message,
        )
      }
    }
    // A failure before diagnose can inspect storage must also use the command boundary.
    f.ctx.sessionManager.getSessionId = () => {
      throw new Error(privateText)
    }
    await command.handler('status', f.ctx)
    assert.match(notifications.at(-1)!, /reason: unknown/)
    assert.ok(notifications.every((text) => !text.includes(privateText)))
  } finally {
    f.close()
  }
})

test('safe memory reasons expose authentic registered CAS and retention, never permission as CAS', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const execute = (name: string, args: object) =>
      f.tools.find((tool) => tool.name === name).execute('test', args, undefined, undefined, f.ctx)
    const read = await execute('agent_memory_read', { path: 'Core.md' })
    await assert.rejects(
      execute('agent_memory_edit', {
        path: 'Core.md',
        expectedHash: '0'.repeat(64),
        text: '# Core\nReplacement\n',
        sources: [],
      }),
      /reason: CAS/,
    )
    assert.deepEqual(
      (await execute('agent_memory_read', { path: 'Core.md' })).details,
      read.details,
      'stale hash refusal leaves the current view unchanged and readable',
    )
    const text =
      '# Identity\n- Stable fact\n# Private heading never echoed\n' + 'Retained fact. '.repeat(30) + '\n'
    await execute('agent_memory_edit', {
      path: 'Core.md',
      expectedHash: read.details.hash,
      text,
      sources: [],
    })
    await execute('agent_memory_commit', { revision: read.details.baseRevision })
    const next = await execute('agent_memory_read', { path: 'Core.md' })
    const published = f.store.snapshot()
    assert.equal(published.files['Core.md'].text, text)
    await execute('agent_memory_edit', {
      path: 'Core.md',
      expectedHash: next.details.hash,
      text: '# Identity\nShort.\n',
      sources: [],
    })
    await assert.rejects(
      execute('agent_memory_commit', { revision: next.details.baseRevision }),
      (error: Error) => {
        assert.match(error.message, /reason: retention/)
        assert.ok(!error.message.includes('Private heading'))
        return true
      },
    )
    assert.deepEqual(f.store.snapshot(), published, 'retention refusal never replaces published knowledge')
    const retained = await execute('agent_memory_read', { path: 'Core.md' })
    assert.equal(retained.details.text, '# Identity\nShort.\n')
    f.setGranted(false)
    await assert.rejects(execute('agent_memory_read', { path: 'Core.md' }), /reason: unknown/)
    assert.deepEqual(f.store.snapshot(), published)
    f.setGranted(true)
    assert.deepEqual(
      (await execute('agent_memory_read', { path: 'Core.md' })).details,
      retained.details,
      'the same retained view is readable only after current permission is restored',
    )
  } finally {
    f.close()
  }
})

test('writer preflight forbids fallback and pins explicit reviewed options before delayed queue admission', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const physical = f.ctx.modelRegistry.getAll()[0]
    const similar = { ...physical, id: 'gpt-6.1-sol-similar' }
    f.ctx.modelRegistry.getAvailable = () => [similar]
    await assert.rejects(
      f.runtime.run('agent_memory_reflect', { assignment: 'A synthetic explicit request.' }, f.ctx),
      /unavailable/,
    )
    assert.equal(Boolean(f.spawned), false, 'available parent/similar is never a fallback')
    f.ctx.modelRegistry.getAvailable = () => [physical]
    const spawn = f.service.spawn.bind(f.service)
    f.service.spawn = (name, prompt, options) => {
      const id = spawn(name, prompt, options)
      f.record.status = 'queued'
      return id
    }
    await f.runtime.run('agent_memory_reflect', { assignment: 'Queue the reviewed synthetic route.' }, f.ctx)
    assert.equal(f.record.status, 'queued')
    f.ctx.modelRegistry.getAvailable = () => [similar]
    f.setRole({ ...f.service.getAgentType(), model: 'openai/gpt-6.1-sol-similar' })
    assert.equal(f.spawned.options.model, 'openai/gpt-6.1-sol')
    assert.equal(
      f.spawned.options.thinkingLevel,
      'medium',
      'native queue receives explicit options, not a late descriptor default',
    )
    assert.equal(f.spawned.options.bypassQueue, false)
    await f.runtime.run('agent_memory_manage', { action: 'cancel' }, f.ctx)
    assert.equal(f.record.status, 'stopped')
  } finally {
    f.close()
  }
})

test('registered query/topic and legacy paths describe the same private draft and reject old-view current forgetting', async () => {
  const f = fixture(true)
  try {
    const seed = f.store.createView('project')
    f.store.edit(seed, 'global/fictional.md', null, '# Fictional\nA violet compass.\n', ['fictional-source'])
    f.store.integrate(seed)
    await f.emit('session_start')
    const read = (args: any) => f.runtime.run('agent_memory_read', args, f.ctx)
    const first = await read({ query: 'violet' })
    assert.ok('results' in first)
    assert.ok(Array.isArray(first.results))
    await f.runtime.run(
      'agent_memory_edit',
      {
        path: 'global/fictional.md',
        expectedHash: first.results[0].hash,
        text: '# Fictional draft\nA silver compass.\n',
        sources: ['fictional-source'],
      },
      f.ctx,
    )
    const queried = await read({ query: 'silver' })
    const path = await read({ path: 'global/fictional.md' })
    assert.ok('results' in queried && 'basis' in queried)
    assert.ok(Array.isArray(queried.results))
    assert.ok('hash' in path && 'text' in path && 'sources' in path)
    assert.equal(queried.basis, 'private-draft')
    assert.equal(queried.results[0].hash, path.hash)
    assert.equal(queried.results[0].text, path.text)
    assert.deepEqual(queried.results[0].sources, path.sources)
    const foreign = f.store.createView('project')
    f.store.forget(foreign.base.revision, [], ['fictional-source'], 'project')
    const definition = f.tools.find((t) => t.name === 'agent_memory_read')
    for (const args of [
      { query: 'silver' },
      { topic: '*' },
      { topic: '' },
      {},
      { path: 'global/fictional.md' },
    ]) {
      await assert.rejects(read(args), /unavailable.*forgotten/)
      await assert.rejects(
        definition.execute('fictional-read', args, undefined, undefined, f.ctx),
        /current forgetting.*proposal preserved/,
      )
    }
    assert.equal(f.runtime.status().draft, 'open')
  } finally {
    f.close()
  }
})

test('registered read execution rejects all six null paging inputs as its integer schema requires', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const definition = f.tools.find((t) => t.name === 'agent_memory_read')
    for (const selector of [{ path: 'Core.md' }, { query: 'identity' }, { topic: '*' }]) {
      for (const key of ['offset', 'limit']) {
        assert.equal(definition.parameters.properties[key].type, 'integer')
        const args = { ...selector, [key]: null }
        await assert.rejects(f.runtime.run('agent_memory_read', args, f.ctx), /Invalid memory read paging/)
        await assert.rejects(
          definition.execute('null-paging', args, undefined, undefined, f.ctx),
          /Managed memory unavailable/,
        )
      }
    }
  } finally {
    f.close()
  }
})

test('ABI1 directory reads page descendant metadata at 32 entries and preserve total/next offsets', async () => {
  const f = fixture()
  try {
    const seed = f.store.createView('project')
    for (let i = 0; i < 70; i++)
      f.store.edit(
        seed,
        `reference/group/file-${i.toString().padStart(2, '0')}.md`,
        null,
        `---\nname: File ${i}\ndescription: Description ${i}\n---\n# File ${i}\n`,
      )
    f.store.integrate(seed)
    await f.emit('session_start')
    const first: any = await f.runtime.run('agent_memory_read', { path: 'reference', limit: 4096 }, f.ctx)
    assert.equal(first.directory, 'reference')
    assert.equal(first.offset, 0)
    assert.equal(first.limit, 32)
    assert.equal(first.entries.length, 32)
    assert.equal(first.total, 70)
    assert.equal(first.nextOffset, 32)
    const second: any = await f.runtime.run(
      'agent_memory_read',
      { path: 'reference', offset: first.nextOffset, limit: 32 },
      f.ctx,
    )
    assert.equal(second.entries.length, 32)
    assert.equal(second.nextOffset, 64)
    assert.ok(
      first.entries.every((entry: any) => !second.entries.some((next: any) => next.path === entry.path)),
    )
    const final: any = await f.runtime.run(
      'agent_memory_read',
      { path: 'reference', offset: second.nextOffset, limit: 32 },
      f.ctx,
    )
    assert.equal(final.entries.length, 6)
    assert.equal(final.nextOffset, undefined)
    assert.equal(final.truncated, true)
  } finally {
    f.close()
  }
})

test('runtime and registered read return fail closed on source-forget in final authority validation', async () => {
  for (const registered of [false, true]) {
    const f = fixture()
    try {
      const seed = f.store.createView('project')
      f.store.edit(seed, 'global/fictional.md', null, '# Fictional\nA violet compass.\n', [
        'fictional-source',
      ])
      const base = f.store.integrate(seed).revision!
      await f.emit('session_start')
      let count = 0,
        target = -1,
        armed = false,
        mutating = false,
        changed = false
      const original = f.abi.assertAccess
      f.abi.assertAccess = (...args: any[]) => {
        const access = original(...args)
        if (!mutating && armed && count++ === target) {
          mutating = true
          try {
            f.store.forget(base, [], ['fictional-source'], 'project')
            changed = true
          } finally {
            mutating = false
          }
        } else if (!armed) count++
        return access
      }
      const definition = f.tools.find((t) => t.name === 'agent_memory_read')
      const call = () =>
        registered
          ? definition.execute('return-fence', { query: 'violet' }, undefined, undefined, f.ctx)
          : f.runtime.run('agent_memory_read', { query: 'violet' }, f.ctx)
      // Warm the same draft and then calibrate only a retained-view read.
      await call()
      count = 0
      await call()
      target = count - 1
      assert.ok(target >= 0)
      count = 0
      armed = true
      await assert.rejects(
        call(),
        registered ? /current revision changed.*proposal preserved/ : /unavailable.*revision changed/,
      )
      assert.equal(changed, true)
      assert.notEqual(f.store.snapshot().revision, base)
      assert.equal(f.runtime.status().draft, 'open')
    } finally {
      f.close()
    }
  }
})

test('query/topic reject cancellation, unhealthy/obsolete bindings and scope revocation', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    for (const args of [{ query: 'identity' }, { topic: '*' }]) {
      const controller = new AbortController()
      controller.abort()
      await assert.rejects(f.runtime.run('agent_memory_read', args, f.ctx, controller.signal), /unavailable/)
      f.setHealthy(false)
      await assert.rejects(f.runtime.run('agent_memory_read', args, f.ctx), /unavailable/)
      f.setHealthy(true)
      f.setVersion(0)
      await assert.rejects(f.runtime.run('agent_memory_read', args, f.ctx), /unavailable/)
      f.setVersion(1)
      f.setGranted(false)
      await assert.rejects(f.runtime.run('agent_memory_read', args, f.ctx), /permission/)
      f.setGranted(true)
    }
  } finally {
    f.close()
  }
})

test('large Unicode detail is completely paged by code point with stable whole-file hashes after restart', async () => {
  const f = fixture()
  const started = performance.now()
  try {
    const configPath = join(f.root, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    writeFileSync(configPath, JSON.stringify({ ...config, fileBytes: 262144, totalBytes: 8388608 }))
    const prefix = '# Unicode 😀 ไทย\n'
    const unit = '😀ไทย\\"\t\n'
    const target = 145763
    const repeated = unit.repeat(
      Math.floor((target - Buffer.byteLength(prefix) - 1) / Buffer.byteLength(unit)),
    )
    const text = `${prefix}${repeated}${'x'.repeat(target - Buffer.byteLength(prefix + repeated) - 1)}\n`
    assert.equal(Buffer.byteLength(text), target)
    await f.emit('session_start')
    const listed: any = await f.runtime.run('agent_memory_read', {}, f.ctx)
    await f.runtime.run(
      'agent_memory_edit',
      { path: 'global/unicode.md', expectedHash: null, text, sources: [] },
      f.ctx,
    )
    await f.runtime.run('agent_memory_commit', { revision: listed.revision }, f.ctx)
    await f.emit('session_start')
    let offset = 0
    let complete = ''
    let pages = 0
    while (true) {
      const page: any = await f.runtime.run(
        'agent_memory_read',
        { path: 'global/unicode.md', offset, limit: 4096 },
        f.ctx,
      )
      assert.equal(page.hash, digest(text))
      assert.equal(page.totalCharacters, [...text].length)
      assert.ok([...page.text].length <= 4096)
      complete += page.text
      pages++
      if (page.nextOffset === undefined) break
      assert.ok(page.nextOffset > offset)
      offset = page.nextOffset
    }
    assert.equal(complete, text)
    assert.equal(digest(complete), digest(text))
    console.log(
      JSON.stringify({
        fixture: 'unicode-paging',
        utf8Bytes: target,
        codePoints: [...text].length,
        pages,
        wallMs: Math.round(performance.now() - started),
        processPeakRssKiB: process.resourceUsage().maxRSS,
      }),
    )
  } finally {
    f.close()
  }
})

test('project management preserves other projects now and through future source reuse and recovery', async () => {
  const f = fixture(true)
  try {
    await f.emit('session_start')
    const initial = f.store.snapshot().revision
    const bPath = 'deferred/other/b.md'
    const aPath = 'deferred/project/a.md'
    const publish = (project: string, path: string, text: string, sources: string[]) => {
      const v = f.store.createView(project)
      f.store.edit(v, path, v.files[path] ? digest(v.files[path].text) : null, text, sources)
      f.store.integrate(v)
    }
    const manage = (ctx: any, action: string, extra: object) =>
      f.runtime.run('agent_memory_manage', { action, revision: f.store.snapshot().revision, ...extra }, ctx)
    publish('other', bPath, '# B\nOriginal\n', ['b-source'])
    const originalB = f.store.snapshot().files[bPath]
    const shared: any = await f.runtime.run('agent_memory_read', { path: bPath }, f.ctx)
    assert.equal(shared.text, originalB.text)
    await manage(f.ctx, 'rollback', { target: initial })
    assert.deepEqual(f.store.snapshot().files[bPath], originalB)
    await manage(f.ctx, 'forget', {
      paths: [],
      sources: ['b-source', 'unknown'],
    })
    assert.deepEqual(f.store.snapshot().files[bPath], originalB)
    publish('other', bPath, '# B\nFuture edit\n', ['b-source', 'unknown'])
    const future = f.store.snapshot()
    const bCtx = { ...f.ctx, cwd: f.cwdB }
    await manage(bCtx, 'rollback', { target: future.revision })
    assert.deepEqual(f.store.snapshot().files[bPath], future.files[bPath])
    await manage(bCtx, 'rollback', { target: initial })
    assert.equal(f.store.snapshot().files[bPath], undefined)
    await manage(bCtx, 'rollback', { target: future.revision })
    assert.deepEqual(f.store.snapshot().files[bPath], future.files[bPath])
    // Same ID is intentionally global only for Core/index/procedures, not B.
    publish('project', aPath, '# A\nForget me\n', ['a-source'])
    publish('project', 'procedures/shared.md', '# Shared\nForget me too\n', ['a-source'])
    const learned = f.store.snapshot()
    const stale = f.store.createView('project')
    f.store.edit(stale, 'procedures/revival.md', null, '# Revival\n', ['a-source'])
    await manage(f.ctx, 'forget', { paths: [aPath], sources: ['a-source'] })
    await manage(f.ctx, 'rollback', { target: learned.revision })
    const restored = f.store.snapshot()
    assert.equal(restored.files[aPath], undefined)
    assert.equal(restored.files['procedures/shared.md'], undefined)
    assert.deepEqual(restored.files[bPath], future.files[bPath])
    assert.ok('conflict' in f.store.integrate(stale))
    assert.equal(f.store.conflicts('project', stale.id, 'procedures/revival.md').suppressedByForgetting, true)
    await manage(bCtx, 'rollback', { target: learned.revision })
    assert.equal(f.store.snapshot().files['procedures/shared.md'], undefined)
    // A source reused in B remains valid, even after A's tombstone.
    publish('other', bPath, '# B\nIndependent source reuse\n', ['a-source'])
    assert.equal(f.store.snapshot().files[bPath].text, '# B\nIndependent source reuse\n')
    // Shared Core still requires explicit correction rather than identity deletion.
    publish('other', 'Core.md', '# Core\nIdentity and crosslinked preference\n', ['crosslinked'])
    await assert.rejects(
      () => manage(f.ctx, 'forget', { paths: [], sources: ['crosslinked'] }),
      /preserve established identity/,
    )
  } finally {
    f.close()
  }
})

test('prompt fixture retains memory owner results across no-op and message-only observers', async () => {
  const f = fixture()
  try {
    let observed = 0
    f.pi.on('before_agent_start', () => {
      observed++
    })
    f.pi.on('before_agent_start', () => ({ message: { content: 'Observer only' } }))
    await f.emit('session_start')
    const result = await f.prompt('Native authority')
    assert.ok(result)
    assert.match(result.systemPrompt, /Established companion identity/)
    assert.equal(observed, 1)
    f.setGranted(false)
    const revoked = await f.prompt(result.systemPrompt)
    assert.ok(revoked)
    assert.equal(revoked.systemPrompt, 'Native authority')
    assert.equal(await f.prompt('Native authority'), undefined)
    assert.equal(observed, 3)
  } finally {
    f.close()
  }
})

test('primary tools edit maintained Markdown and refresh existing/fresh request system context by committed revision', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const before = await f.prompt('Existing native instructions')
    assert.ok(before)
    assert.match(before.systemPrompt, /Established companion identity/)
    const assertDelegation = (prompt: string, native: string) => {
      assert.equal(prompt.split('\n<mahiro-managed-memory>')[0], native)
      assert.equal(prompt.match(/Primary delegation guidance:/g)?.length, 1)
      const paragraph = prompt.match(/Primary delegation guidance:[^\n]+/)![0]
      assert.ok(Buffer.byteLength(paragraph) < 1024)
      for (const pattern of [
        /Before dispatch.*role, tools and capabilities.*actually available and permitted for the scope/,
        /concise brief: outcome, constraints.*relevant decisions\/conventions with provenance.*expected result/,
        /missing or uncertain, say so; never assume ask_parent, notify_parent or other parent helpers exist/,
        /ordinary terminal results.*failed execution honestly/,
        /Do not broaden permissions.*primary private corpus.*dump private memory/,
        /Current user\/repository authorities remain controlling/,
        /not automatic context delivery or enforcement/,
      ])
        assert.match(paragraph, pattern)
      assert.ok(prompt.indexOf(paragraph) > prompt.indexOf('<mahiro-managed-memory>'))
      assert.ok(prompt.indexOf(paragraph) < prompt.indexOf('</mahiro-managed-memory>'))
    }
    assertDelegation(before.systemPrompt, 'Existing native instructions')
    const core = await f.runtime.run('agent_memory_read', { path: 'Core.md' }, f.ctx)
    await f.runtime.run(
      'agent_memory_edit',
      {
        path: 'Core.md',
        expectedHash: (core as any).hash,
        text: '# Core\nEstablished companion identity. Prefer B rather than A.\n',
        sources: ['e-1'],
      },
      f.ctx,
    )
    const unchanged = await f.prompt('Existing native instructions')
    assert.ok(unchanged)
    assert.doesNotMatch(unchanged.systemPrompt, /Prefer B/)
    assertDelegation(unchanged.systemPrompt, 'Existing native instructions')
    const commit = await f.runtime.run('agent_memory_commit', { revision: (core as any).revision }, f.ctx)
    assert.equal((commit as any).contextActivation, 'next-primary-request')
    const next = await f.prompt(before.systemPrompt)
    assert.ok(next)
    assert.match(next.systemPrompt, /Prefer B rather than A/)
    assert.equal(next.systemPrompt.match(/<mahiro-managed-memory>/g)?.length, 1)
    assertDelegation(next.systemPrompt, 'Existing native instructions')
    await f.emit('session_start')
    const fresh = await f.prompt('Fresh native instructions')
    assert.ok(fresh)
    assert.match(fresh.systemPrompt, /Prefer B/)
    assertDelegation(fresh.systemPrompt, 'Fresh native instructions')
  } finally {
    f.close()
  }
})

test('primary delegation leaves native authorities intact and disappears with unavailable Root authority', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const native = 'Native default prompt\nCurrent repository authority\nCurrent human instruction'
    const projection = await f.prompt(native)
    assert.ok(projection)
    const projected = projection.systemPrompt
    assert.equal(projected.split('\n<mahiro-managed-memory>')[0], native)
    const node = f.nodes.get('primary')
    for (const unavailable of ['permission', 'Root', 'health', 'ABI', 'foreign']) {
      if (unavailable === 'permission') f.setGranted(false)
      if (unavailable === 'Root') f.nodes.delete('primary')
      if (unavailable === 'health') f.setHealthy(false)
      if (unavailable === 'ABI') f.setVersion(0)
      const foreign = {
        ...f.ctx,
        sessionManager: { getSessionId: () => 'foreign' },
      }
      if (unavailable === 'foreign') f.nodes.set('foreign', node)
      const context = unavailable === 'foreign' ? foreign : f.ctx
      const result = await f.prompt(projected, context)
      assert.ok(result, unavailable)
      assert.equal(result.systemPrompt, native, unavailable)
      assert.doesNotMatch(
        result.systemPrompt,
        /Primary delegation guidance|Established companion identity|mahiro-managed-memory/,
      )
      assert.equal(await f.prompt(native, context), undefined)
      f.setGranted(true)
      f.setHealthy(true)
      f.setVersion(1)
      f.nodes.set('primary', node)
    }
  } finally {
    f.close()
  }
})

test('bound writer replacement keeps its exact separate prompt and never receives primary delegation or inherited private context', async () => {
  const f = fixture()
  let worker: ReturnType<typeof activateAgentMemory> | undefined
  try {
    await f.emit('session_start')
    const projection = await f.prompt('Native default and repository authorities\nPRIVATE_PARENT_CONTEXT')
    assert.ok(projection)
    const parentPrompt = projection.systemPrompt
    await dispatchWriter(f)
    const child = f.child()
    // Real workers have their own extension runtime, but share this same Root ABI,
    // tool provenance, native binding and SessionManager identity checks.
    const handlers = new Map<string, Function[]>()
    worker = activateAgentMemory(
      {
        ...f.pi,
        on(name: string, fn: Function) {
          if (!handlers.has(name)) handlers.set(name, [])
          handlers.get(name)!.push(fn)
        },
      },
      { root: f.root, nodes: f.nodes },
    )
    // A trailing lifecycle observer cannot erase the identity-bound replacement.
    handlers.get('before_agent_start')!.push(() => undefined)
    const emit = async (name: string, event = {}) => {
      const results: unknown[] = []
      for (const handler of handlers.get(name) ?? []) results.push(await handler(event, child))
      return promptResult(results)
    }
    await emit('session_start')
    const body = readFileSync(join(process.cwd(), 'agents/managed-memory-writer.md'), 'utf8').replace(
      /^---\n[\s\S]*?\n---\n/,
      '',
    )
    const expected = `${body}\n${memoryCurationDoctrine}\nPrivate project scope: project. Read only your leased memory view. No primary transcript, bootstrap or corpus is inherited.`
    const marker = '<active_agent name="managed-memory-writer"/>'
    for (const inherited of [parentPrompt, `${parentPrompt}\n${marker}`]) {
      const result = await emit('before_agent_start', {
        systemPrompt: inherited,
      })
      assert.ok(result)
      assert.equal(result.systemPrompt, expected)
      assert.doesNotMatch(
        result.systemPrompt,
        /Primary delegation guidance|PRIVATE_PARENT_CONTEXT|Established companion identity|mahiro-managed-memory/,
      )
      assert.equal(f.binding.active(), true)
    }
    // A marker never grants identity or permission. Revoked bound workers and
    // unbound foreign workers get the existing conservative replacement only.
    f.setGranted(false)
    const denied = await emit('before_agent_start', {
      systemPrompt: `${parentPrompt}\n${marker}`,
    })
    assert.ok(denied)
    assert.equal(
      denied.systemPrompt,
      'Managed memory worker unavailable. Do not access memory or infer from inherited context. Report the missing binding/permission and stop.',
    )
    f.setGranted(true)
    const foreign = {
      ...child,
      sessionManager: { getSessionId: () => 'foreign-worker' },
    }
    f.nodes.set('foreign-worker', f.nodes.get('primary'))
    const unboundResults: unknown[] = []
    for (const handler of handlers.get('before_agent_start') ?? [])
      unboundResults.push(await handler({ systemPrompt: `${parentPrompt}\n${marker}` }, foreign))
    const unbound = promptResult(unboundResults)
    assert.ok(unbound)
    assert.equal(unbound.systemPrompt, denied.systemPrompt)
    assert.equal(f.binding.active(), true)
  } finally {
    worker?.cancel()
    f.close()
  }
})

test('public conflict paging recovers complete Unicode proposals and rejects malformed or foreign selection', async () => {
  const f = fixture(true)
  try {
    const configPath = join(f.root, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.fileBytes = 262144
    config.totalBytes = 8388608
    writeFileSync(configPath, `${JSON.stringify(config)}\n`)
    const path = 'global/proposal.md'
    const seed = f.store.createView('project')
    f.store.edit(seed, path, null, '# Base\n')
    f.store.integrate(seed)
    const winner = f.store.createView('project')
    const stale = f.store.createView('project')
    const proposal = `# Proposal\n${'ข้อมูล🪷\n'.repeat(1700)}`
    f.store.edit(winner, path, digest('# Base\n'), '# Winner\n')
    f.store.edit(stale, path, digest('# Base\n'), proposal)
    f.store.integrate(winner)
    assert.ok('conflict' in f.store.integrate(stale))
    await f.emit('session_start')
    let restored = ''
    let offset = 0
    while (offset < [...proposal].length) {
      const result = (await f.runtime.run(
        'agent_memory_manage',
        {
          action: 'conflicts',
          target: stale.id,
          path,
          offset,
          limit: 513,
        },
        f.ctx,
      )) as any
      assert.equal(result.proposalHash, digest(proposal))
      assert.equal(result.currentHash, digest('# Winner\n'))
      assert.equal(result.offset, offset)
      assert.equal(result.totalCharacters, [...proposal].length)
      assert.ok([...result.text].length <= 513)
      restored += result.text
      offset += [...result.text].length
    }
    assert.equal(restored, proposal)
    const current = (await f.runtime.run('agent_memory_read', { path }, f.ctx)) as any
    await f.runtime.run(
      'agent_memory_edit',
      {
        path,
        expectedHash: current.hash,
        text: restored,
        sources: [],
      },
      f.ctx,
    )
    await f.runtime.run(
      'agent_memory_commit',
      {
        revision: current.revision,
      },
      f.ctx,
    )
    assert.equal(f.store.snapshot().files[path].text, proposal)
    for (const args of [
      { action: 'status', offset: 0 },
      { action: 'conflicts', target: stale.id, offset: 0 },
      { action: 'conflicts', target: stale.id, path, offset: -1 },
      { action: 'conflicts', target: stale.id, path, offset: 0.5 },
      { action: 'conflicts', target: stale.id, path, limit: 4097 },
      {
        action: 'conflicts',
        target: stale.id,
        path: 'deferred/other/private.md',
        offset: 0,
      },
    ])
      await assert.rejects(f.runtime.run('agent_memory_manage', args, f.ctx))
    assert.throws(() => f.store.conflicts('other', stale.id, path, 0, 513), /Unknown scoped/)
    f.store.forget(f.store.snapshot().revision, [path], [], 'project')
    const forgotten = (await f.runtime.run(
      'agent_memory_manage',
      {
        action: 'conflicts',
        target: stale.id,
        path,
        offset: 513,
      },
      f.ctx,
    )) as any
    assert.equal(forgotten.suppressedByForgetting, true)
    assert.equal(forgotten.text, undefined)
  } finally {
    f.close()
  }
})

test('missing/revoked permission, obsolete ABI, cancellation and unknown arguments do not activate edits', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const original = f.store.snapshot().revision
    f.setGranted(false)
    await assert.rejects(f.runtime.run('agent_memory_read', {}, f.ctx))
    f.setGranted(true)
    f.setVersion(0)
    await assert.rejects(f.runtime.run('agent_memory_read', {}, f.ctx))
    f.setVersion(1)
    const core: any = await f.runtime.run('agent_memory_read', { path: 'Core.md' }, f.ctx)
    await assert.rejects(
      f.runtime.run(
        'agent_memory_edit',
        {
          path: 'Core.md',
          expectedHash: core.hash,
          text: 'safe\n',
          sources: [],
          approved: true,
        },
        f.ctx,
      ),
    )
    await f.runtime.run(
      'agent_memory_edit',
      {
        path: 'Core.md',
        expectedHash: core.hash,
        text: '# Core\nDraft\n',
        sources: [],
      },
      f.ctx,
    )
    f.revoke()
    await assert.rejects(f.runtime.run('agent_memory_commit', { revision: core.revision }, f.ctx))
    assert.equal(f.store.snapshot().revision, original)
    const projection = await f.emit('before_agent_start', {
      systemPrompt: 'Native',
    })
    assert.equal(promptResult(projection), undefined)
    await assert.rejects(f.runtime.run('arbitrary', {}, f.ctx))
  } finally {
    f.close()
  }
})

test('explicit initialization creates only a new authorized root, with reversible source-only registration', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    rmSync(f.root, { recursive: true })
    f.setGranted(false)
    await assert.rejects(
      f.runtime.run(
        'agent_memory_manage',
        {
          action: 'initialize',
          core: '# Core\nEstablished identity.\n',
          projectId: 'project',
        },
        f.ctx,
      ),
    )
    f.setGranted(true)
    const result: any = await f.runtime.run(
      'agent_memory_manage',
      {
        action: 'initialize',
        core: '# Core\nEstablished identity.\n',
        projectId: 'project',
      },
      f.ctx,
    )
    assert.equal(result.initialized, true)
    assert.equal(result.nativeBootstrapChanged, false)
    assert.equal(f.store.config().automatic, false)
    await assert.rejects(
      f.runtime.run(
        'agent_memory_manage',
        {
          action: 'initialize',
          core: '# Wrong replacement\n',
          projectId: 'project',
        },
        f.ctx,
      ),
      /New private root/,
    )
    assert.match(f.store.snapshot().files['Core.md'].text, /Established identity/)
  } finally {
    f.close()
  }
})

test('native writer uses bound private view and automatic same-owner integration, not closed literal quotes', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const dispatch: any = await f.runtime.run(
      'agent_memory_reflect',
      {
        assignment: 'Remember the correction as a reusable verification method.',
      },
      f.ctx,
    )
    assert.equal(dispatch.status, 'native-dispatched')
    assert.equal(dispatch.providerProof, false)
    assert.equal(f.spawned.name, 'managed-memory-writer')
    assert.deepEqual(f.spawned.options, {
      model: 'openai/gpt-6.1-sol',
      thinkingLevel: 'medium',
      foreground: false,
      bypassQueue: false,
      inheritContext: false,
      maxTurns: 8,
      claimOutcome: true,
    })
    const child: any = f.child()
    await assert.rejects(f.runtime.run('agent_memory_manage', { action: 'status' }, child))
    await assert.rejects(
      f.runtime.run(
        'agent_memory_edit',
        {
          path: 'deferred/other/leak.md',
          expectedHash: null,
          text: '# Wrong scope\n',
          sources: [],
        },
        child,
      ),
    )
    const files: any = await f.runtime.run('agent_memory_read', {}, child)
    assert.equal(files.project, 'project')
    await f.runtime.run(
      'agent_memory_edit',
      {
        path: 'procedures/evidence.md',
        expectedHash: null,
        text: '# Evidence\nA successful tool exit is not human acceptance; inspect the outcome before claiming completion.\n',
        sources: [],
      },
      child,
    )
    const before = f.store.snapshot().revision
    await f.runtime.run('agent_memory_commit', { revision: files.revision }, child)
    assert.equal(f.store.snapshot().revision, before)
    f.record.status = 'completed'
    f.nativeEvent('subagents:completed')
    assert.ok(f.store.snapshot().files['procedures/evidence.md'])
    assert.notEqual(f.store.snapshot().revision, before)
    assert.equal(f.binding, undefined)
    await assert.rejects(f.runtime.run('agent_memory_read', {}, child))
    f.nativeEvent('subagents:completed')
    assert.ok(f.store.snapshot().files['procedures/evidence.md'])
  } finally {
    f.close()
  }
})

test('workers cannot obtain primary management, project escape or an unbound lease; role drift fails closed', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    f.setRole({
      name: 'managed-memory-writer',
      locked: true,
      toolNames: ['bash'],
    })
    await assert.rejects(
      f.runtime.run('agent_memory_reflect', { assignment: 'Learn a method' }, f.ctx),
      /Locked native/,
    )
    assert.equal(f.spawned, undefined)
  } finally {
    f.close()
  }
})

test('semantic episode links observed input, assistant action, selected tool result and correction without human-authentication claims', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const text = 'That check failed: inspect the actual result before reporting success.'
    await f.emit('input', { source: 'rpc', text })
    f.branch.push({
      id: 'entry-1',
      type: 'message',
      message: { role: 'user', content: text },
    })
    await f.emit('message_end', {
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will run and inspect the bounded check.' },
          { type: 'toolCall', name: 'bash' },
        ],
      },
    })
    await f.emit('tool_execution_start', {
      toolName: 'bash',
      toolCallId: 't-1',
      args: { command: 'pnpm check' },
    })
    await f.emit('tool_execution_end', {
      toolName: 'bash',
      toolCallId: 't-1',
      isError: true,
      result: {
        content: [{ type: 'text', text: '1 failing check: stale context' }],
      },
    })
    await f.emit('agent_before_settle', { outcome: 'completed' })
    await f.emit('agent_settled', { aborted: false })
    const prompt = JSON.parse(f.spawned.prompt)
    assert.equal(prompt.episodes[0].input.text, text)
    assert.equal(prompt.episodes[0].actions[0].text, 'I will run and inspect the bounded check.')
    assert.equal(prompt.episodes[0].results[0].error, true)
    assert.match(prompt.episodes[0].results[0].text, /stale context/)
    assert.equal(prompt.episodes[0].evidence, 'observed-native-unverified')
    assert.doesNotMatch(JSON.stringify(prompt), /verified-human/)
    assert.equal(f.store.pendingEpisodes('project').length, 1)
  } finally {
    f.close()
  }
})

async function beginEpisode(
  f: ReturnType<typeof fixture>,
  text = 'Inspect the final correction and actual outcome.',
) {
  await f.emit('session_start')
  await f.emit('input', { source: 'rpc', text })
  const entry = {
    id: 'episode-input',
    type: 'message',
    message: { role: 'user', content: text },
  }
  f.branch.push(entry)
  return entry
}
async function action(f: ReturnType<typeof fixture>, text: string, extra: any[] = []) {
  await f.emit('message_end', {
    message: { role: 'assistant', content: [{ type: 'text', text }, ...extra] },
  })
}
async function verification(f: ReturnType<typeof fixture>, id: string, text: string, isError = false) {
  await f.emit('tool_execution_start', {
    toolName: 'bash',
    toolCallId: id,
    args: { command: 'pnpm check' },
  })
  await f.emit('tool_execution_end', {
    toolName: 'bash',
    toolCallId: id,
    isError,
    result: { content: [{ type: 'text', text }] },
  })
}
async function settleEpisode(f: ReturnType<typeof fixture>) {
  await f.emit('agent_before_settle', { outcome: 'completed' })
  await f.emit('agent_settled', { aborted: false })
}

test('episode retains first and latest three eligible actions/results in stored and writer order', async () => {
  const f = fixture()
  try {
    const entry = await beginEpisode(f)
    for (let i = 1; i <= 6; i++) {
      await action(f, i === 6 ? 'Action 6: correction, inspect before claiming success' : `Action ${i}`)
      await verification(
        f,
        `check-${i}`,
        i === 6 ? 'Result 6: PASS after correction' : `Result ${i}: FAIL`,
        i !== 6,
      )
    }
    await settleEpisode(f)
    const stored: any = f.store.pendingEpisodes('project')[0]
    assert.ok(stored)
    assert.deepEqual(
      stored.actions.map((a: any) => a.text),
      ['Action 1', 'Action 4', 'Action 5', 'Action 6: correction, inspect before claiming success'],
    )
    assert.deepEqual(
      stored.results.map((r: any) => [r.text, r.error]),
      [
        ['Result 1: FAIL', true],
        ['Result 4: FAIL', true],
        ['Result 5: FAIL', true],
        ['Result 6: PASS after correction', false],
      ],
    )
    assert.equal(stored.entryHash, digest(JSON.stringify(entry)))
    assert.equal(stored.id, digest(`primary:${entry.id}`))
    assert.equal(stored.input.source, 'rpc')
    assert.equal(stored.input.text, entry.message.content)
    assert.equal(stored.evidence, 'observed-native-unverified')
    assert.deepEqual(JSON.parse(f.spawned.prompt).episodes, [stored])
  } finally {
    f.close()
  }
})

test('rejected late aggregate text never evicts safe evidence or salvages metadata/blocks', async () => {
  const f = fixture()
  try {
    await beginEpisode(f)
    for (let i = 1; i <= 4; i++) {
      await action(f, `Safe action ${i}`)
      await verification(f, `safe-${i}`, `Safe result ${i}`)
    }
    const rejected = [
      [{ type: 'text', text: 'x'.repeat(2049) }],
      [
        { type: 'text', text: 'safe prefix' },
        { type: 'text', text: `ghp_${'a'.repeat(24)}` },
      ],
      [
        { type: 'text', text: 'safe prefix' },
        { type: 'text', text: '<system-reminder>imported</system-reminder>' },
      ],
      [
        { type: 'text', text: 'x'.repeat(1024) },
        { type: 'text', text: 'y'.repeat(1024) },
      ],
      [{ type: 'text', text: 'x'.repeat(2048) + `ghp_${'b'.repeat(24)}` }],
      [
        {
          type: 'text',
          text: 'x'.repeat(2048) + '<skill_content>imported</skill_content>',
        },
      ],
    ]
    for (const [i, content] of rejected.entries()) {
      await f.emit('message_end', {
        message: {
          role: 'assistant',
          content: [...content, { type: 'toolCall', name: 'bash' }],
        },
      })
      await f.emit('tool_execution_start', {
        toolName: 'bash',
        toolCallId: `bad-${i}`,
        args: { command: 'pnpm test' },
      })
      await f.emit('tool_execution_end', {
        toolName: 'bash',
        toolCallId: `bad-${i}`,
        isError: false,
        result: { content },
      })
    }
    await settleEpisode(f)
    const stored: any = f.store.pendingEpisodes('project')[0]
    assert.deepEqual(
      stored.actions,
      [1, 2, 3, 4].map((i) => ({ text: `Safe action ${i}` })),
    )
    assert.deepEqual(
      stored.results,
      [1, 2, 3, 4].map((i) => ({
        tool: 'bash',
        error: false,
        text: `Safe result ${i}`,
      })),
    )
    assert.deepEqual(JSON.parse(f.spawned.prompt).episodes, [stored])
  } finally {
    f.close()
  }
})

test('text-absent metadata stays eligible; tool names are typed, screened before the eight-name bound', async () => {
  const f = fixture()
  try {
    await beginEpisode(f)
    const safe = ['bash', 'read', 'recall_read', 'recall_search', 'edit', 'write', 'grep', 'find']
    await f.emit('message_end', {
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'PRIVATE_REASONING' },
          ...[
            null,
            7,
            ['bash'],
            { name: 'bash' },
            'BadName',
            'bad-name',
            `ghp_${'a'.repeat(24)}`,
            ...safe,
            `ghp_${'b'.repeat(24)}`,
            'ninth',
          ].map((name) => ({
            type: 'toolCall',
            name,
            arguments: { raw: 'PRIVATE_ARGUMENTS' },
          })),
        ],
      },
    })
    await f.emit('tool_execution_start', {
      toolName: 'bash',
      toolCallId: 'metadata',
      args: { command: 'pnpm check', raw: 'PRIVATE_ARGUMENTS' },
    })
    await f.emit('tool_execution_end', {
      toolName: 'bash',
      toolCallId: 'metadata',
      isError: true,
      result: { content: [{ type: 'image', data: 'PRIVATE_IMAGE' }] },
    })
    for (const toolName of ['read', 'recall_read', 'recall_search']) {
      await f.emit('tool_execution_start', {
        toolName,
        toolCallId: toolName,
        args: { command: 'pnpm check' },
      })
      await f.emit('tool_execution_end', {
        toolName,
        toolCallId: toolName,
        isError: false,
        result: { content: 'PRIVATE_READ_RECALL' },
      })
    }
    await settleEpisode(f)
    const stored: any = f.store.pendingEpisodes('project')[0]
    assert.deepEqual(stored.actions, [{ tools: safe }])
    assert.deepEqual(stored.results, [{ tool: 'bash', error: true }])
    assert.doesNotMatch(f.spawned.prompt, /PRIVATE_|ghp_|ninth|BadName|bad-name/)
    assert.deepEqual(JSON.parse(f.spawned.prompt).episodes, [stored])
  } finally {
    f.close()
  }
})

test('verification endings require allowlisted matching bash IDs and consume each match once', async () => {
  const f = fixture()
  try {
    await beginEpisode(f)
    await action(f, 'Inspect only selected verification results.')
    const end = (id: string, toolName = 'bash', text = 'REJECTED_RESULT') =>
      f.emit('tool_execution_end', {
        toolCallId: id,
        toolName,
        isError: false,
        result: { content: text },
      })
    await end('unmatched')
    for (const command of ['pnpm check && echo unsafe', 'cat fixture', 'pnpm install', 'node script.js']) {
      await f.emit('tool_execution_start', {
        toolName: 'bash',
        toolCallId: command,
        args: { command },
      })
      await end(command)
    }
    await f.emit('tool_execution_start', {
      toolName: 'bash',
      toolCallId: 'mismatch',
      args: { command: 'pnpm check' },
    })
    await end('mismatch', 'read')
    await end('mismatch')
    for (let i = 1; i <= 6; i++) {
      await verification(f, `valid-${i}`, `Result ${i}`)
      await end(`valid-${i}`)
    }
    await settleEpisode(f)
    const stored: any = f.store.pendingEpisodes('project')[0]
    assert.deepEqual(
      stored.results.map((r: any) => r.text),
      [1, 4, 5, 6].map((i) => `Result ${i}`),
    )
    assert.doesNotMatch(f.spawned.prompt, /REJECTED_RESULT/)
  } finally {
    f.close()
  }
})

test('pending verification IDs skip new starts at 64 and free capacity on matching endings', async () => {
  const f = fixture()
  try {
    await beginEpisode(f)
    await action(f, 'Bound verification bookkeeping.')
    for (let i = 0; i < 65; i++)
      await f.emit('tool_execution_start', {
        toolName: 'bash',
        toolCallId: `cap-${i}`,
        args: { command: 'pnpm check' },
      })
    const end = (i: number) =>
      f.emit('tool_execution_end', {
        toolName: 'bash',
        toolCallId: `cap-${i}`,
        isError: false,
        result: { content: `Result ${i}` },
      })
    await end(64)
    for (let i = 0; i < 64; i++) await end(i)
    await f.emit('tool_execution_start', {
      toolName: 'bash',
      toolCallId: 'cap-65',
      args: { command: 'node --test test/example.test.ts' },
    })
    await end(65)
    await settleEpisode(f)
    const stored: any = f.store.pendingEpisodes('project')[0]
    assert.deepEqual(
      stored.results.map((r: any) => r.text),
      [0, 62, 63, 65].map((i) => `Result ${i}`),
    )
  } finally {
    f.close()
  }
})

function expectedEpisode(entry: any, input: string, actions: any[], results: any[]) {
  return {
    id: digest(`primary:${entry.id}`),
    project: 'project',
    session: 'primary',
    evidence: 'observed-native-unverified',
    observedAt: '2000-01-01T00:00:00.000Z',
    entryHash: digest(JSON.stringify(entry)),
    input: { text: input, source: 'rpc' },
    actions,
    results,
    outcome: 'completed',
  }
}

test('serialized episode pruning preserves exact fields/endpoints or rejects an oversized protected subset', async () => {
  for (const [label, unit, inputBudget, fieldBudget] of [
    ['ascii', 'a', 1950, 2000],
    ['quotes', '"', 1950, 1200],
    ['backslashes', '\\', 1950, 1200],
    ['thai', 'ไทย', 1950, 2000],
    ['astral', '😀', 1950, 2000],
    ['control', '\u0001', 100, 400],
    ['protected-overflow', '\u0001', 1950, 2000],
  ] as const) {
    const f = fixture()
    try {
      const text = `Input ${label}: ${unit.repeat(Math.floor(inputBudget / Buffer.byteLength(unit)))}`
      const entry = await beginEpisode(f, text)
      const actions = [],
        results = []
      for (let i = 1; i <= 4; i++) {
        const a = `Action ${i}: ${unit.repeat(Math.floor(fieldBudget / Buffer.byteLength(unit)))}`
        const r = `Result ${i}: ${unit.repeat(Math.floor(fieldBudget / Buffer.byteLength(unit)))}`
        actions.push({ text: a })
        results.push({ tool: 'bash', error: false, text: r })
        await action(f, a)
        await verification(f, `size-${i}`, r)
      }
      const expected = expectedEpisode(entry, text, [...actions], [...results])
      const size = () => Buffer.byteLength(JSON.stringify(expected) + '\n')
      assert.ok(size() > 16384, label)
      let removedResults = 0,
        removedActions = 0
      while (size() > 16384 && expected.results.length > 2) {
        expected.results.splice(1, 1)
        removedResults++
      }
      while (size() > 16384 && expected.actions.length > 2) {
        expected.actions.splice(1, 1)
        removedActions++
      }
      await settleEpisode(f)
      const stored: any = f.store.pendingEpisodes('project')[0]
      if (size() > 16384) {
        assert.equal(stored, undefined, label)
        assert.equal(f.spawned, undefined, label)
      } else {
        assert.ok(stored, label)
        assert.equal(stored.input.text, text)
        assert.equal(stored.actions[0].text, actions[0].text)
        assert.equal(stored.actions.at(-1).text, actions.at(-1)!.text)
        assert.equal(stored.results[0].text, results[0].text)
        assert.equal(stored.results.at(-1).text, results.at(-1)!.text)
        assert.deepEqual(stored, {
          ...expected,
          observedAt: stored.observedAt,
        })
        const raw = readFileSync(join(f.root, '.episodes', `${stored.id}.json`), 'utf8')
        assert.equal(raw, JSON.stringify(stored) + '\n')
        assert.ok(Buffer.byteLength(raw) <= 16384, label)
        assert.deepEqual(JSON.parse(f.spawned.prompt).episodes, [stored])
        // A second store instance uses the same bounded reader, not a fixture cache.
        assert.deepEqual(createMemoryStore(f.root).pendingEpisodes('project'), [stored])
        assert.ok(removedResults > 0)
        if (removedActions) assert.equal(stored.results.length, 2)
      }
    } finally {
      f.close()
    }
  }
})

test('exact 16384-byte JSON payload is pruned because the persisted newline also counts', async () => {
  const f = fixture()
  try {
    const actions = [1, 2, 3, 4].map((i) => ({ text: `Action ${i}` }))
    const results = [1, 2, 3, 4].map((i) => ({
      tool: 'bash',
      error: false,
      text: `Result ${i}`,
    }))
    const input = 'Input exact boundary'
    const placeholder = {
      id: 'episode-input',
      type: 'message',
      message: { role: 'user', content: input },
    }
    const expected = expectedEpisode(placeholder, input, actions, results)
    let remaining = 16384 - Buffer.byteLength(JSON.stringify(expected))
    for (const field of [expected.input, ...actions, ...results]) {
      const count = Math.min(2048 - Buffer.byteLength(field.text), remaining)
      field.text += 'x'.repeat(count)
      remaining -= count
    }
    assert.equal(remaining, 0)
    const entry = await beginEpisode(f, expected.input.text)
    expected.entryHash = digest(JSON.stringify(entry))
    assert.equal(Buffer.byteLength(JSON.stringify(expected)), 16384)
    for (const [i, a] of actions.entries()) {
      await action(f, a.text)
      await verification(f, `boundary-${i}`, results[i].text)
    }
    await settleEpisode(f)
    const stored: any = f.store.pendingEpisodes('project')[0]
    assert.ok(stored)
    assert.deepEqual(stored.actions, actions)
    assert.deepEqual(stored.results, [results[0], results[2], results[3]])
    assert.equal(stored.input.text, expected.input.text)
    assert.ok(Buffer.byteLength(readFileSync(join(f.root, '.episodes', `${stored.id}.json`))) <= 16384)
    assert.deepEqual(JSON.parse(f.spawned.prompt).episodes, [stored])
  } finally {
    f.close()
  }
})

test('episode exact-input/unique-entry/branch and completion/authority fences remain fail closed', async () => {
  for (const scenario of [
    'mismatch',
    'duplicate',
    'branch',
    'abort',
    'noncompletion',
    'revoked',
    'unhealthy',
    'cancel',
    'long-input',
  ]) {
    const f = fixture()
    try {
      f.branch.push({
        id: 'existing',
        type: 'message',
        message: { role: 'user', content: 'old' },
      })
      const entry = await beginEpisode(
        f,
        scenario === 'long-input' ? 'x'.repeat(2049) : 'Exact observed input',
      )
      await action(f, 'Safe completed action')
      if (scenario === 'mismatch') entry.message.content += ' changed'
      if (scenario === 'duplicate') f.branch.push({ ...entry, id: 'duplicate-entry' })
      if (scenario === 'branch') f.branch[0] = { ...f.branch[0], id: 'replacement' }
      if (scenario === 'revoked') f.revoke()
      if (scenario === 'unhealthy') f.setHealthy(false)
      if (scenario === 'cancel') await f.emit('session_before_tree')
      await f.emit('agent_before_settle', {
        outcome: scenario === 'noncompletion' ? 'failed' : 'completed',
      })
      await f.emit('agent_settled', { aborted: scenario === 'abort' })
      assert.deepEqual(f.store.pendingEpisodes('project'), [], scenario)
      assert.equal(f.spawned, undefined, scenario)
    } finally {
      f.close()
    }
  }
})

function workerObserver(f: ReturnType<typeof fixture>) {
  const handlers = new Map<string, Function>()
  const runtime = createAgentMemoryRuntime(
    {
      ...f.pi,
      on: (name: string, fn: Function) => handlers.set(name, fn),
    } as any,
    { root: f.root, nodes: f.nodes },
  )
  handlers.get('session_start')!()
  return {
    runtime,
    end: (event: any, ctx: any) => handlers.get('tool_execution_end')!(event, ctx),
  }
}

test('automatic latestToolEnd starts null and bridges a separate authenticated worker runtime', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    seedEpisodes(f, 1)
    f.runtime.startWriter(f.ctx)
    assert.equal((await managedStatus(f)).latestAttempt.latestToolEnd, null)
    const child = f.child()
    const observer = workerObserver(f)
    observer.end({ toolName: 'agent_memory_read', isError: false }, child)
    const status = await managedStatus(f)
    assert.deepEqual(status.latestAttempt.latestToolEnd, {
      tool: 'read',
      isError: false,
    })
    status.latestAttempt.latestToolEnd.tool = 'commit'
    assert.deepEqual((await managedStatus(f)).latestAttempt.latestToolEnd, {
      tool: 'read',
      isError: false,
    })
  } finally {
    f.close()
  }
})

test('tool-end metadata is authenticated, bounded, getter-safe and never a readiness claim', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    seedEpisodes(f, 1)
    f.runtime.startWriter(f.ctx)
    const child = f.child()
    const observer = workerObserver(f)
    const sample = async () => (await managedStatus(f)).latestAttempt.latestToolEnd
    const privateEvent = (name: unknown, error: unknown) => {
      const event: any = { toolName: name, isError: error }
      for (const field of [
        'args',
        'result',
        'input',
        'content',
        'details',
        'error',
        'toolCallId',
        'id',
        'output',
        'rawError',
      ])
        Object.defineProperty(event, field, {
          get() {
            assert.fail(`private field ${field}`)
          },
        })
      return event
    }
    for (const [name, tool, error, expected] of [
      ['agent_memory_read', 'read', false, false],
      ['agent_memory_edit', 'edit', true, true],
      ['agent_memory_commit', 'commit', 'bad', null],
      ['unretained-raw-name', 'other', undefined, null],
    ]) {
      observer.end(privateEvent(name, error), child)
      assert.deepEqual(await sample(), { tool, isError: expected })
    }
    const previous = await sample()
    observer.end(
      {
        toolName: 42,
        get isError() {
          return assert.fail('nonstring kind reads error')
        },
      },
      child,
    )
    observer.end(
      {
        get toolName() {
          throw Error('metadata')
        },
      },
      child,
    )
    observer.end(
      {
        toolName: 'agent_memory_read',
        get isError() {
          throw Error('metadata')
        },
      },
      child,
    )
    for (const ctx of [f.ctx, { ...child, sessionManager: { getSessionId: () => 'unknown' } }])
      observer.end(
        {
          get toolName() {
            return assert.fail('unauthenticated metadata')
          },
        },
        ctx,
      )
    assert.deepEqual(await sample(), previous)
    observer.end(
      {
        get toolName() {
          observer.end(privateEvent('agent_memory_edit', true), child)
          return 'agent_memory_read'
        },
        isError: false,
      },
      child,
    )
    assert.deepEqual(await sample(), { tool: 'edit', isError: true })
    const files: any = await f.runtime.run('agent_memory_read', {}, child)
    await f.runtime.run('agent_memory_commit', { revision: files.revision }, child)
    observer.end(
      {
        get toolName() {
          return assert.fail('ready metadata')
        },
      },
      child,
    )
    assert.deepEqual(await sample(), { tool: 'edit', isError: true })
    assert.equal((await managedStatus(f)).latestAttempt.outcome, 'pending')
  } finally {
    f.close()
  }
})

for (const fence of [
  'manual',
  'ready',
  'sealed',
  'reset',
  'revoked',
  'generation',
  'replacement',
  'unhealthy',
  'expired',
  'closed',
  'foreign',
  'child-reset',
] as const) {
  test(`tool-end bridge rejects ${fence} without reading metadata`, async () => {
    const f = fixture()
    try {
      await f.emit('session_start')
      seedEpisodes(f, 1)
      f.runtime.startWriter(f.ctx, fence === 'manual' ? 'Explicit assignment' : undefined)
      const child = f.child()
      const observer = workerObserver(f)
      observer.end({ toolName: 'agent_memory_read', isError: false }, child)
      const value = f.binding.value
      if (fence === 'ready') value.ready = true
      if (fence === 'closed') value.view.state = 'cancelled'
      if (fence === 'expired') value.view.deadline = 0
      if (fence === 'foreign') value.root = 'foreign'
      if (fence === 'revoked') f.revoke()
      if (fence === 'unhealthy') f.setHealthy(false)
      if (fence === 'generation') f.abi.generation = {}
      if (fence === 'child-reset') observer.runtime.cancel()
      if (fence === 'reset') f.runtime.cancel()
      if (fence === 'sealed') {
        f.record.status = 'completed'
        f.nativeEvent('subagents:completed')
      }
      if (fence === 'replacement') {
        f.runtime.cancel()
        f.runtime.startWriter(f.ctx)
        f.child()
      }
      // A child reset is not a revoked Root lease: it becomes active on the next
      // session_start only. cancel invalidates in-flight frames, not future events.
      if (fence === 'child-reset') {
        observer.end(
          {
            get toolName() {
              observer.runtime.cancel()
              return 'agent_memory_edit'
            },
            get isError() {
              return assert.fail('post-reset error')
            },
          },
          child,
        )
      } else {
        observer.end(
          {
            get toolName() {
              return assert.fail(`rejected ${fence} metadata`)
            },
          },
          child,
        )
      }
      if (fence === 'manual' || fence === 'replacement')
        assert.equal((await managedStatus(f)).latestAttempt.latestToolEnd, null)
      if (fence === 'ready' || fence === 'sealed' || fence === 'child-reset')
        assert.deepEqual((await managedStatus(f)).latestAttempt.latestToolEnd, {
          tool: 'read',
          isError: false,
        })
    } finally {
      f.close()
    }
  })
}

for (const getter of ['toolName', 'isError'] as const) {
  test(`reentrant ${getter} cannot steal replacement ownership or suppress abort`, async () => {
    const f = fixture()
    try {
      await f.emit('session_start')
      seedEpisodes(f, 1)
      f.runtime.startWriter(f.ctx)
      const child = f.child()
      const observer = workerObserver(f)
      let aborts = 0
      const abort = f.service.abort
      f.service.abort = (id) => {
        aborts++
        return abort(id)
      }
      const event: any = { toolName: 'agent_memory_read', isError: false }
      Object.defineProperty(event, getter, {
        get() {
          f.runtime.cancel()
          f.runtime.startWriter(f.ctx)
          const replacement = f.child()
          observer.end({ toolName: 'agent_memory_edit', isError: true }, replacement)
          throw Error('old frame')
        },
      })
      observer.end(event, child)
      assert.equal(aborts, 1)
      assert.equal(f.runtime.status().worker, true)
      assert.deepEqual((await managedStatus(f)).latestAttempt.latestToolEnd, {
        tool: 'edit',
        isError: true,
      })
    } finally {
      f.close()
    }
  })
}

const managedStatus = (f: ReturnType<typeof fixture>, ctx = f.ctx) =>
  f.runtime.run('agent_memory_manage', { action: 'status' }, ctx) as Promise<any>
const dispatchWriter = (f: ReturnType<typeof fixture>) =>
  f.runtime.run('agent_memory_reflect', { assignment: 'Maintain a durable fictional method.' }, f.ctx)
function seedEpisodes(f: ReturnType<typeof fixture>, count: number) {
  for (let i = 0; i < count; i++) {
    const id = digest(`fictional-episode-${i}`)
    f.store.recordEpisode(id, {
      ...expectedEpisode({ id: `entry-${i}` }, 'Fictional input', [{ text: 'Observed action' }], []),
      id,
      entryHash: digest(`entry-${i}`),
    })
  }
}

for (const nativeStatus of ['queued', 'running']) {
  test(`latest attempt retains ${nativeStatus} before unchanged deadline abort and ignores late completion`, async (t) => {
    const f = fixture()
    try {
      seedEpisodes(f, 6)
      t.mock.timers.enable({
        apis: ['Date', 'setTimeout'],
        now: 2000000000000,
      })
      await f.emit('session_start')
      const originalSpawn = f.service.spawn
      f.service.spawn = (...args) => {
        const id = originalSpawn(...args)
        f.record.status = 'queued'
        f.record.startedAt = -999999
        f.record.toolUses = 7
        f.record.turnBudget = { used: 3, maxTurns: 8, phase: 'within' }
        return id
      }
      const before = f.store.snapshot()
      await dispatchWriter(f)
      if (nativeStatus === 'running') {
        t.mock.timers.tick(1000)
        f.record.status = 'running'
        f.nativeEvent('subagents:started')
      }
      const pending = (await managedStatus(f)).latestAttempt
      assert.equal(pending.phase, nativeStatus)
      assert.equal(pending.outcome, 'pending')
      assert.equal(pending.dispatchedAt, 2000000000000)
      assert.equal(pending.observedAt, nativeStatus === 'running' ? 2000000001000 : 2000000000000)
      assert.equal(pending.deadlineAt, pending.dispatchedAt + 120000)
      t.mock.timers.tick(nativeStatus === 'running' ? 119000 : 120000)
      const status = await managedStatus(f)
      assert.equal(status.worker, 'idle')
      assert.equal(status.lastError, 'worker-deadline')
      assert.deepEqual(status.latestAttempt, {
        phase: 'terminal',
        nativeStatus,
        outcome: 'deadline',
        dispatchedAt: 2000000000000,
        observedAt: 2000000120000,
        deadlineAt: 2000000120000,
        selectedEpisodeCount: 4,
        latestToolEnd: null,
        progress: {
          toolUses: 7,
          turnBudget: { used: 3, maxTurns: 8, phase: 'within' },
        },
        backlog: {
          total: null,
          selectedLowerBound: 4,
          selectionLimit: 4,
          fileCapacityLimit: 256,
        },
      })
      assert.equal(f.record.status, 'stopped')
      assert.equal(f.binding, undefined)
      f.record.status = 'completed'
      f.nativeEvent('subagents:completed')
      assert.deepEqual((await managedStatus(f)).latestAttempt, status.latestAttempt)
      assert.equal(f.store.snapshot().revision, before.revision)
      assert.deepEqual(f.store.snapshot().reviewed, before.reviewed)
    } finally {
      f.close()
      t.mock.timers.reset()
    }
  })
}

test('native progress sanitizes every field independently and distinguishes unknown from zero', async () => {
  const f = fixture()
  const unknown = {
    toolUses: null,
    turnBudget: { used: null, maxTurns: null, phase: null },
  }
  try {
    await f.emit('session_start')
    await dispatchWriter(f)
    assert.deepEqual((await managedStatus(f)).latestAttempt.progress, unknown)
    const valid = {
      toolUses: 7,
      turnBudget: { used: 3, maxTurns: 8, phase: 'within' },
    }
    const fields = ['toolUses', 'used', 'maxTurns', 'phase', 'turnBudget']
    for (const field of fields) {
      for (const value of [
        undefined,
        null,
        -1,
        0.5,
        NaN,
        Infinity,
        -Infinity,
        Number.MAX_SAFE_INTEGER + 1,
        '7',
        {},
        [],
        'throw',
      ]) {
        const record = {
          ...f.record,
          ...valid,
          turnBudget: { ...valid.turnBudget },
        }
        const target = ['toolUses', 'turnBudget'].includes(field) ? record : record.turnBudget
        Object.defineProperty(target, field, {
          get() {
            if (value === 'throw') throw new Error('PRIVATE_PROGRESS')
            return value
          },
        })
        f.service.getRecord = () => record
        const status = await managedStatus(f)
        const expected: any = { ...valid, turnBudget: { ...valid.turnBudget } }
        if (field === 'toolUses') expected.toolUses = null
        else if (field === 'turnBudget') expected.turnBudget = unknown.turnBudget
        else expected.turnBudget[field] = null
        assert.deepEqual(status.latestAttempt.progress, expected, `${field}:${String(value)}`)
        assert.equal(status.latestAttempt.nativeStatus, 'running')
        assert.doesNotMatch(JSON.stringify(status), /PRIVATE_PROGRESS/)
      }
    }
    for (const phase of ['within', 'warned', 'exhausted']) {
      f.service.getRecord = () => ({
        ...f.record,
        toolUses: 0,
        turnBudget: { used: 0, maxTurns: 0, phase },
      })
      assert.deepEqual((await managedStatus(f)).latestAttempt.progress, {
        toolUses: 0,
        turnBudget: { used: 0, maxTurns: 0, phase },
      })
    }
    f.service.getRecord = () => ({
      ...f.record,
      toolUses: Number.MAX_SAFE_INTEGER,
      turnBudget: {
        used: Number.MAX_SAFE_INTEGER,
        maxTurns: 0,
        phase: 'warned',
      },
    })
    assert.deepEqual((await managedStatus(f)).latestAttempt.progress, {
      toolUses: Number.MAX_SAFE_INTEGER,
      turnBudget: {
        used: Number.MAX_SAFE_INTEGER,
        maxTurns: 0,
        phase: 'warned',
      },
    })
  } finally {
    f.close()
  }
})

test('deadline progress replaces missing current fields, retains no aliases and never trusts forged wakeups', async (t) => {
  const f = fixture()
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 2000000000000 })
  try {
    await f.emit('session_start')
    await dispatchWriter(f)
    f.record.toolUses = 7
    const budget = { used: 3, maxTurns: 8, phase: 'within' }
    f.record.turnBudget = budget
    const getRecord = f.service.getRecord
    let reads = 0
    f.service.getRecord = () => {
      reads++
      return getRecord()
    }
    const first = (await managedStatus(f)).latestAttempt
    assert.equal(reads, 1)
    first.progress.toolUses = 999
    first.progress.turnBudget.used = 999
    assert.equal((await managedStatus(f)).latestAttempt.progress.turnBudget.used, 3)
    assert.equal((await managedStatus(f)).latestAttempt.progress.toolUses, 7)
    const beforeEvents = reads
    f.nativeEvent('subagents:started', {
      id: 'foreign',
      type: f.record.type,
      toolUses: 999,
      turnBudget: { used: 999 },
    })
    f.nativeEvent('subagents:completed', { id: f.record.id, type: 'foreign' })
    assert.equal(reads, beforeEvents)
    for (const field of ['id', 'type']) {
      const original = f.record[field]
      f.record[field] = 'foreign'
      assert.deepEqual((await managedStatus(f)).latestAttempt.progress, {
        toolUses: null,
        turnBudget: { used: null, maxTurns: null, phase: null },
      })
      f.record[field] = original
    }
    assert.equal((await managedStatus(f)).latestAttempt.progress.toolUses, 7)
    delete f.record.toolUses
    Object.defineProperty(budget, 'used', {
      get() {
        throw new Error('PRIVATE_PROGRESS')
      },
    })
    t.mock.timers.tick(120000)
    const terminal = (await managedStatus(f)).latestAttempt
    assert.equal(terminal.outcome, 'deadline')
    assert.equal(terminal.nativeStatus, 'running')
    assert.deepEqual(terminal.progress, {
      toolUses: null,
      turnBudget: { used: null, maxTurns: 8, phase: 'within' },
    })
    const frozen = structuredClone(terminal)
    budget.maxTurns = 999
    terminal.progress.turnBudget.maxTurns = 999
    terminal.progress.toolUses = 999
    f.record.status = 'completed'
    f.nativeEvent('subagents:completed')
    assert.deepEqual((await managedStatus(f)).latestAttempt, frozen)
  } finally {
    f.close()
    t.mock.timers.reset()
  }
})

test('optional progress getters cannot steal captured abort, publish, or replace the new owner', async (t) => {
  for (const field of ['toolUses', 'turnBudget', 'used', 'maxTurns', 'phase']) {
    for (const trigger of ['deadline', 'cancel', 'dispatch-failed']) {
      for (const replacement of [false, true]) {
        const f = fixture()
        t.mock.timers.enable({
          apis: ['Date', 'setTimeout'],
          now: 2000000000000,
        })
        try {
          await f.emit('session_start')
          const before = f.store.snapshot().revision
          const records = new Map<string, any>()
          const spawn = f.service.spawn
          f.service.spawn = (...args) => {
            const id = spawn(...args)
            records.set(id, f.record)
            return id
          }
          const aborted: string[] = []
          f.service.abort = (id) => {
            aborted.push(id)
            records.get(id).status = 'stopped'
            f.nativeEvent('subagents:completed', {
              id,
              type: 'managed-memory-writer',
            })
            return true
          }
          let once = true
          const arm = () => {
            const old = f.record
            old.toolUses = 7
            old.turnBudget = { used: 3, maxTurns: 8, phase: 'within' }
            Object.defineProperty(['toolUses', 'turnBudget'].includes(field) ? old : old.turnBudget, field, {
              get() {
                if (once) {
                  once = false
                  f.runtime.cancel()
                  if (replacement) f.runtime.startWriter(f.ctx, 'Fictional new owner.')
                }
                throw new Error('PRIVATE_REENTRY')
              },
            })
            f.service.getRecord = (id?: string) => records.get(id!)
          }
          if (trigger === 'dispatch-failed') {
            const bind = f.abi.bindWorker
            f.abi.bindWorker = (...args: any[]) => {
              f.abi.bindWorker = bind
              arm()
              throw new Error('Fictional dispatch failure')
            }
            await assert.rejects(dispatchWriter(f))
          } else {
            await dispatchWriter(f)
            arm()
            if (trigger === 'deadline') t.mock.timers.tick(120000)
            else await f.runtime.run('agent_memory_manage', { action: 'cancel' }, f.ctx)
          }
          assert.equal(once, false, `${field}/${trigger}/${replacement}`)
          assert.deepEqual(aborted, ['job-1'])
          const status = await managedStatus(f)
          assert.equal(status.worker, replacement ? 'active' : 'idle')
          if (replacement) {
            assert.equal(f.binding.id, 'job-2')
            assert.equal(f.binding.active(), true)
            assert.equal(status.latestAttempt.outcome, 'pending')
            assert.equal(records.get('job-2').status, 'running')
            f.nativeEvent('subagents:completed', {
              id: 'job-1',
              type: 'managed-memory-writer',
            })
            assert.equal((await managedStatus(f)).latestAttempt.outcome, 'pending')
          } else assert.equal(status.latestAttempt, null)
          assert.equal(f.store.snapshot().revision, before)
          f.runtime.cancel()
          assert.deepEqual(aborted, replacement ? ['job-1', 'job-2'] : ['job-1'])
        } finally {
          f.close()
          t.mock.timers.reset()
        }
      }
    }
  }
})

test('throwing progress does not block ready publication or overwrite valid native status', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await dispatchWriter(f)
    await readyWriter(f)
    for (const key of ['toolUses', 'turnBudget'])
      Object.defineProperty(f.record, key, {
        get() {
          throw new Error('PRIVATE_PROGRESS')
        },
      })
    f.record.status = 'completed'
    f.nativeEvent('subagents:completed')
    const status = await managedStatus(f)
    assert.equal(status.latestAttempt.nativeStatus, 'completed')
    assert.equal(status.latestAttempt.outcome, 'integrated')
    assert.deepEqual(status.latestAttempt.progress, {
      toolUses: null,
      turnBudget: { used: null, maxTurns: null, phase: null },
    })
    assert.ok(f.store.snapshot().files['procedures/method.md'])
  } finally {
    f.close()
  }
})

test('reentrant deadline observation cannot steal the captured native abort', async (t) => {
  const f = fixture()
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 2000000000000 })
  try {
    await f.emit('session_start')
    await dispatchWriter(f)
    const before = f.store.snapshot()
    let once = true
    const aborted: string[] = []
    const abort = f.service.abort
    f.service.abort = (id) => {
      aborted.push(id)
      return abort(id)
    }
    f.service.getRecord = () => {
      if (once) {
        once = false
        f.nativeEvent('subagents:completed')
        return { ...f.record, status: 'running' }
      }
      return { ...f.record, status: 'completed' }
    }
    t.mock.timers.tick(120000)
    const status = await managedStatus(f)
    assert.deepEqual(aborted, ['job-1'])
    assert.equal(status.latestAttempt.outcome, 'deadline')
    assert.equal(status.latestAttempt.nativeStatus, 'running')
    assert.equal(status.worker, 'idle')
    assert.equal(f.binding, undefined)
    f.nativeEvent('subagents:completed')
    assert.deepEqual(aborted, ['job-1'])
    assert.equal(f.store.snapshot().revision, before.revision)
    assert.deepEqual(f.store.snapshot().reviewed, before.reviewed)
  } finally {
    f.close()
    t.mock.timers.reset()
  }
})

test('reentrant completion during cancellation reset and dispatch failure aborts its owner once', async () => {
  for (const action of ['cancel', 'reset', 'dispatch-failed']) {
    const f = fixture()
    try {
      await f.emit('session_start')
      let once = true
      const aborted: string[] = []
      const abort = f.service.abort
      f.service.abort = (id) => {
        aborted.push(id)
        return abort(id)
      }
      const arm = () => {
        f.service.getRecord = () => {
          if (once) {
            once = false
            f.nativeEvent('subagents:completed')
          }
          return { ...f.record, status: 'completed' }
        }
      }
      if (action === 'dispatch-failed') {
        f.abi.bindWorker = () => {
          arm()
          throw new Error('Fictional dispatch failure')
        }
        await assert.rejects(dispatchWriter(f))
      } else {
        await dispatchWriter(f)
        arm()
        if (action === 'reset') f.runtime.cancel()
        else await f.runtime.run('agent_memory_manage', { action: 'cancel' }, f.ctx)
      }
      assert.deepEqual(aborted, ['job-1'], action)
      assert.equal(f.binding, undefined, action)
      const status = await managedStatus(f)
      assert.equal(status.worker, 'idle', action)
      assert.equal(
        status.latestAttempt?.outcome ?? null,
        action === 'reset' ? null : action === 'cancel' ? 'cancelled' : action,
        action,
      )
      f.runtime.cancel()
      f.nativeEvent('subagents:completed')
      assert.deepEqual(aborted, ['job-1'], action)
    } finally {
      f.close()
    }
  }
})

test('captured cancellation never clears or aborts a reentrant replacement owner', async (t) => {
  for (const action of ['deadline', 'cancel', 'reset', 'dispatch-failed']) {
    const f = fixture()
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 2000000000000 })
    try {
      await f.emit('session_start')
      const records = new Map<string, any>()
      const spawn = f.service.spawn
      f.service.spawn = (...args) => {
        const id = spawn(...args)
        records.set(id, f.record)
        return id
      }
      const aborted: string[] = []
      let once = true
      const replace = () => {
        if (!once) return
        once = false
        f.runtime.cancel()
        f.runtime.startWriter(f.ctx, 'Fictional replacement assignment.')
      }
      f.service.abort = (id) => {
        aborted.push(id)
        records.get(id).status = 'stopped'
        // Reset clears its own state before external cancellation callbacks.
        if (action === 'reset' && once) replace()
        return true
      }
      const getRecord = f.service.getRecord
      const arm = () => {
        f.service.getRecord = (id?: string) => {
          if (once) replace()
          return records.get(id!)
        }
      }
      if (action === 'dispatch-failed') {
        const bind = f.abi.bindWorker
        f.abi.bindWorker = (...args: any[]) => {
          if (once) {
            f.abi.bindWorker = bind
            arm()
            throw new Error('Fictional dispatch failure')
          }
          return bind(...args)
        }
        await assert.rejects(dispatchWriter(f))
      } else {
        await dispatchWriter(f)
        if (action !== 'reset') arm()
        if (action === 'deadline') t.mock.timers.tick(120000)
        else if (action === 'reset') f.runtime.cancel()
        else await f.runtime.run('agent_memory_manage', { action: 'cancel' }, f.ctx)
      }
      f.service.getRecord = getRecord
      const status = await managedStatus(f)
      assert.deepEqual(aborted, ['job-1'], action)
      assert.equal(status.worker, 'active', action)
      assert.equal(status.latestAttempt.outcome, 'pending', action)
      assert.equal(f.record.id, 'job-2', action)
      assert.equal(f.record.status, 'running', action)
      assert.equal(f.binding.id, 'job-2', action)
      assert.equal(f.binding.active(), true, action)
      f.nativeEvent('subagents:completed', {
        id: 'job-1',
        type: 'managed-memory-writer',
      })
      assert.equal((await managedStatus(f)).latestAttempt.outcome, 'pending', action)
      await f.runtime.run('agent_memory_manage', { action: 'cancel' }, f.ctx)
      assert.deepEqual(aborted, ['job-1', 'job-2'], action)
    } finally {
      f.close()
      t.mock.timers.reset()
    }
  }
})

test('spawn-time cancellation aborts once when its native ID becomes available', async (t) => {
  const f = fixture()
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 2000000000000 })
  try {
    await f.emit('session_start')
    const aborted: string[] = []
    const abort = f.service.abort
    f.service.abort = (id) => {
      aborted.push(id)
      return abort(id)
    }
    const spawn = f.service.spawn
    f.service.spawn = (...args) => {
      const id = spawn(...args)
      f.runtime.cancel()
      return id
    }
    await dispatchWriter(f)
    assert.deepEqual(aborted, ['job-1'])
    assert.equal(f.binding, undefined)
    assert.equal((await managedStatus(f)).latestAttempt, null)
    assert.equal(f.runtime.status().worker, false)
    t.mock.timers.tick(120000)
    assert.deepEqual(aborted, ['job-1'])
  } finally {
    f.close()
    t.mock.timers.reset()
  }
})

test('completed native record without ready transaction is not-ready, never integrated', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await dispatchWriter(f)
    const before = f.store.snapshot().revision
    f.record.status = 'completed'
    f.nativeEvent('subagents:completed')
    const status = await managedStatus(f)
    assert.equal(status.worker, 'idle')
    assert.equal(status.latestAttempt.outcome, 'not-ready')
    assert.equal(status.latestAttempt.phase, 'terminal')
    assert.equal(f.store.snapshot().revision, before)
  } finally {
    f.close()
  }
})

async function readyWriter(f: ReturnType<typeof fixture>, text = '# Method\nFictional learned method.\n') {
  const child: any = f.child()
  const files: any = await f.runtime.run('agent_memory_read', {}, child)
  await f.runtime.run(
    'agent_memory_edit',
    {
      path: 'procedures/method.md',
      expectedHash: null,
      text,
      sources: [],
    },
    child,
  )
  await f.runtime.run('agent_memory_commit', { revision: files.revision }, child)
}

test('no attempt is null only on authorized status; record and event secrets never spread', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    assert.equal((await managedStatus(f)).latestAttempt, null)
    assert.deepEqual(f.runtime.startWriter(f.ctx), {
      skipped: 'no-unreviewed-episodes',
    })
    assert.equal((await managedStatus(f)).latestAttempt, null)
    assert.equal('latestAttempt' in f.runtime.status(), false)
    await dispatchWriter(f)
    const child: any = f.child()
    await assert.rejects(managedStatus(f, child))
    for (const key of ['result', 'outputFile', 'startedAt', 'error', 'prompt', 'description'])
      Object.defineProperty(f.record, key, {
        configurable: true,
        get() {
          throw new Error('PRIVATE_NATIVE')
        },
      })
    const event = { id: f.record.id, type: f.record.type }
    Object.defineProperty(event, 'result', {
      get() {
        throw new Error('PRIVATE_EVENT')
      },
    })
    f.nativeEvent('subagents:started', event)
    const originalGet = f.service.getRecord
    let reads = 0
    f.service.getRecord = () => {
      reads++
      return originalGet()
    }
    const status = await managedStatus(f)
    assert.equal(reads, 1)
    assert.equal(status.latestAttempt.nativeStatus, 'running')
    assert.equal(status.latestAttempt.selectedEpisodeCount, 0)
    assert.deepEqual(status.latestAttempt.backlog, {
      total: null,
      selectedLowerBound: 0,
      selectionLimit: 4,
      fileCapacityLimit: 256,
    })
    assert.deepEqual(
      Object.keys(status.latestAttempt).sort(),
      [
        'phase',
        'nativeStatus',
        'outcome',
        'dispatchedAt',
        'observedAt',
        'deadlineAt',
        'selectedEpisodeCount',
        'progress',
        'latestToolEnd',
        'backlog',
      ].sort(),
    )
    assert.doesNotMatch(
      JSON.stringify(status.latestAttempt),
      /PRIVATE_|job-|managed-memory-writer|project|memory|prompt|result|error/,
    )
    status.latestAttempt.backlog.selectedLowerBound = 200
    assert.equal((await managedStatus(f)).latestAttempt.backlog.selectedLowerBound, 0)
    f.setGranted(false)
    const denied = await managedStatus(f)
    assert.equal(denied.readiness, 'Denied')
    assert.equal(denied.storage, 'unavailable')
    assert.equal(denied.latestAttempt, 'unknown')
  } finally {
    f.close()
  }
})

test('foreign wakeups and wrong native identity/type cannot finish or authorize publication', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await dispatchWriter(f)
    await readyWriter(f)
    const before = f.store.snapshot().revision
    f.record.status = 'completed'
    for (const payload of [
      undefined,
      {},
      { id: 'foreign', type: 'managed-memory-writer' },
      { id: f.record.id, type: 'foreign' },
      {
        get id() {
          throw new Error('untrusted')
        },
      },
    ])
      f.nativeEvent('subagents:completed', payload ?? {})
    assert.equal(f.runtime.status().worker, true)
    assert.equal(f.store.snapshot().revision, before)
    const id = f.record.id
    f.record.id = 'foreign'
    f.nativeEvent('subagents:completed', { id, type: 'managed-memory-writer' })
    assert.equal((await managedStatus(f)).latestAttempt.nativeStatus, 'unknown')
    f.record.id = id
    f.record.type = 'foreign'
    f.nativeEvent('subagents:completed', { id, type: 'managed-memory-writer' })
    assert.equal((await managedStatus(f)).latestAttempt.nativeStatus, 'unknown')
    assert.equal(f.store.snapshot().revision, before)
    f.record.type = 'managed-memory-writer'
    f.nativeEvent('subagents:completed')
    assert.equal((await managedStatus(f)).latestAttempt.outcome, 'integrated')
    assert.notEqual(f.store.snapshot().revision, before)
  } finally {
    f.close()
  }
})

test('missing malformed and throwing native getters remain unknown without blocking deadline abort', async (t) => {
  for (const kind of ['missing', 'throwing', 'absent', 'malformed', 'status-getter']) {
    const f = fixture()
    try {
      t.mock.timers.enable({
        apis: ['Date', 'setTimeout'],
        now: 2000000000000,
      })
      await f.emit('session_start')
      await dispatchWriter(f)
      f.record.toolUses = 7
      f.record.turnBudget = { used: 3, maxTurns: 8, phase: 'within' }
      assert.equal((await managedStatus(f)).latestAttempt.progress.toolUses, 7)
      const originalGet = f.service.getRecord
      if (kind === 'missing') (f.service as any).getRecord = undefined
      else
        f.service.getRecord = () => {
          if (kind === 'throwing') throw new Error('PRIVATE_EXCEPTION')
          if (kind === 'absent') return undefined
          if (kind === 'status-getter')
            return {
              id: f.record.id,
              type: f.record.type,
              get status() {
                throw new Error('PRIVATE_EXCEPTION')
              },
            }
          return {
            id: f.record.id,
            type: f.record.type,
            status: 'PRIVATE_UNKNOWN_STATUS',
          }
        }
      f.nativeEvent('subagents:failed')
      assert.equal((await managedStatus(f)).latestAttempt.phase, 'unknown', kind)
      t.mock.timers.tick(120000)
      assert.equal(f.record.status, 'stopped', kind)
      assert.equal(f.binding, undefined, kind)
      f.service.getRecord = originalGet
      const status = await managedStatus(f)
      assert.equal(status.worker, 'idle', kind)
      assert.equal(status.latestAttempt.nativeStatus, 'unknown', kind)
      assert.equal(status.latestAttempt.outcome, 'deadline', kind)
      assert.deepEqual(
        status.latestAttempt.progress,
        {
          toolUses: null,
          turnBudget: { used: null, maxTurns: null, phase: null },
        },
        kind,
      )
      assert.doesNotMatch(JSON.stringify(status), /PRIVATE_/)
    } finally {
      f.close()
      t.mock.timers.reset()
    }
  }
})

test('synchronous spawn started/completion and binding completion races retain exact ownership and dispose', async () => {
  for (const where of ['spawn-running', 'spawn-completed', 'binding-completed']) {
    const f = fixture()
    try {
      await f.emit('session_start')
      const spawn = f.service.spawn
      f.service.spawn = (...args) => {
        const id = spawn(...args)
        f.nativeEvent('subagents:started')
        if (where === 'spawn-completed') {
          f.record.status = 'completed'
          f.nativeEvent('subagents:completed')
        }
        return id
      }
      const bind = f.abi.bindWorker
      f.abi.bindWorker = (...args: any[]) => {
        const dispose = bind(...args)
        if (where === 'binding-completed') {
          f.binding.value.ready = true
          f.record.status = 'completed'
          f.nativeEvent('subagents:completed')
        }
        return dispose
      }
      await dispatchWriter(f)
      const status = await managedStatus(f)
      assert.equal(
        status.latestAttempt.outcome,
        where === 'spawn-running' ? 'pending' : where === 'spawn-completed' ? 'not-ready' : 'integrated',
        where,
      )
      assert.equal(status.worker, where === 'spawn-running' ? 'active' : 'idle', where)
      if (where !== 'spawn-running') assert.equal(f.binding, undefined, where)
    } finally {
      f.close()
    }
  }
})

test('dispatch failure is sanitized and does not claim native failure or integration', async () => {
  for (const where of ['spawn', 'binding']) {
    const f = fixture()
    try {
      await f.emit('session_start')
      if (where === 'spawn')
        f.service.spawn = () => {
          throw new Error('PRIVATE_DISPATCH')
        }
      else
        f.abi.bindWorker = () => {
          throw new Error('PRIVATE_BINDING')
        }
      await assert.rejects(dispatchWriter(f))
      const status = await managedStatus(f)
      assert.equal(status.latestAttempt.outcome, 'dispatch-failed')
      assert.equal(status.latestAttempt.phase, 'terminal')
      assert.equal(status.worker, 'idle')
      assert.doesNotMatch(JSON.stringify(status), /PRIVATE_/)
      if (where === 'binding') assert.equal(f.record.status, 'stopped')
    } finally {
      f.close()
    }
  }
})

test('native unsuccessful conflict actual integration failure and success have separate observations', async () => {
  for (const result of ['error', 'aborted', 'stopped', 'conflict', 'integration-failure', 'integrated']) {
    const f = fixture()
    try {
      seedEpisodes(f, 2)
      await f.emit('session_start')
      await dispatchWriter(f)
      if (!['error', 'aborted', 'stopped'].includes(result)) await readyWriter(f)
      if (result === 'conflict') {
        const winner = f.store.createView('project')
        f.store.edit(winner, 'procedures/method.md', null, '# Winner\nDifferent method.\n', [])
        f.store.integrate(winner)
      }
      const before = f.store.snapshot()
      // A synthetic invalidated view makes store.integrate itself reject.
      if (result === 'integration-failure') f.binding.value.view.state = 'cancelled'
      f.record.status = ['error', 'aborted', 'stopped'].includes(result) ? result : 'completed'
      f.nativeEvent('subagents:failed')
      const status = await managedStatus(f)
      assert.equal(
        status.latestAttempt.outcome,
        ['error', 'aborted', 'stopped'].includes(result)
          ? 'native-unsuccessful'
          : result === 'integration-failure'
            ? 'integration-unavailable'
            : result,
        result,
      )
      assert.equal(status.latestAttempt.phase, 'terminal')
      assert.equal(status.worker, 'idle')
      const after = f.store.snapshot()
      if (result === 'integrated') {
        assert.notEqual(after.revision, before.revision)
        assert.equal(after.reviewed.length, 2)
        assert.equal(status.latestAttempt.selectedEpisodeCount, 2)
        assert.equal(f.store.pendingEpisodes('project').length, 0)
        assert.equal((await managedStatus(f)).latestAttempt.backlog.selectedLowerBound, 2)
      } else {
        assert.equal(after.revision, before.revision, result)
        assert.deepEqual(after.reviewed, before.reviewed, result)
      }
    } finally {
      f.close()
    }
  }
})

test('cancellation seals before abort; replacement and late old events cannot overwrite latest attempt', async () => {
  const f = fixture()
  try {
    seedEpisodes(f, 1)
    await f.emit('session_start')
    await dispatchWriter(f)
    const old = f.record
    await f.runtime.run('agent_memory_manage', { action: 'cancel' }, f.ctx)
    const cancelled = (await managedStatus(f)).latestAttempt
    assert.equal(cancelled.outcome, 'cancelled')
    assert.equal(cancelled.nativeStatus, 'running')
    old.status = 'completed'
    f.nativeEvent('subagents:completed')
    assert.deepEqual((await managedStatus(f)).latestAttempt, cancelled)
    seedEpisodes(f, 3)
    await dispatchWriter(f)
    assert.equal((await managedStatus(f)).latestAttempt.selectedEpisodeCount, 3)
    f.record.status = 'completed'
    f.nativeEvent('subagents:completed', { id: old.id, type: old.type })
    assert.equal(f.runtime.status().worker, true)
    assert.equal((await managedStatus(f)).latestAttempt.outcome, 'pending')
    f.nativeEvent('subagents:completed')
    assert.equal((await managedStatus(f)).latestAttempt.outcome, 'not-ready')
  } finally {
    f.close()
  }
})

test('reset project identity node generation and revocation suppress observation; revoked completion cannot publish', async () => {
  for (const change of [
    'reset',
    'project',
    'identity',
    'node',
    'generation',
    'revocation',
    'permission',
    'unhealthy',
  ]) {
    const f = fixture(true)
    try {
      await f.emit('session_start')
      await dispatchWriter(f)
      await readyWriter(f)
      const before = f.store.snapshot().revision
      if (change === 'reset') {
        await f.emit('session_before_tree')
      }
      if (change === 'project') f.ctx.cwd = f.cwdB
      if (change === 'identity') {
        f.ctx.sessionManager.getSessionId = () => 'replacement'
        f.nodes.set('replacement', f.nodes.get('primary'))
      }
      if (change === 'node') f.nodes.set('primary', { ...f.nodes.get('primary') })
      if (change === 'generation') {
        const generation = {}
        f.nodes.get('primary').generation = generation
        f.abi.generation = generation
      }
      if (['revocation', 'permission', 'unhealthy'].includes(change)) {
        if (change === 'revocation') f.revoke()
        if (change === 'permission') f.setGranted(false)
        if (change === 'unhealthy') f.setHealthy(false)
        f.record.status = 'completed'
        f.nativeEvent('subagents:completed')
        const deniedStatus = await managedStatus(f)
        assert.equal(deniedStatus.storage, 'unavailable')
        assert.equal(
          deniedStatus.latestAttempt,
          'unknown',
          'public prerequisites do not expose denied observations',
        )
        assert.notEqual(deniedStatus.readiness, 'Ready')
        assert.equal(f.runtime.status().worker, false)
        assert.equal(f.store.snapshot().revision, before)
        if (change !== 'revocation') {
          f.setGranted(true)
          f.setHealthy(true)
          assert.equal((await managedStatus(f)).latestAttempt, null)
        }
      } else {
        assert.equal((await managedStatus(f)).latestAttempt, null, change)
      }
      if (change === 'project') {
        f.ctx.cwd = join(f.cwdB, '..', 'project')
        assert.equal((await managedStatus(f)).latestAttempt, null)
        await f.runtime.run('agent_memory_manage', { action: 'cancel' }, f.ctx)
      }
    } finally {
      f.close()
    }
  }
})

test('expired native job binding cannot publish even after the native service reports completed', async () => {
  const f = fixture()
  const now = Date.now
  try {
    await f.emit('session_start')
    await f.runtime.run('agent_memory_reflect', { assignment: 'Maintain a method' }, f.ctx)
    const child: any = f.child()
    const files: any = await f.runtime.run('agent_memory_read', {}, child)
    await f.runtime.run(
      'agent_memory_edit',
      {
        path: 'procedures/expired.md',
        expectedHash: null,
        text: '# Expired\n',
        sources: [],
      },
      child,
    )
    await f.runtime.run('agent_memory_commit', { revision: files.revision }, child)
    const before = f.store.snapshot().revision
    Date.now = () => now() + 120001
    f.record.status = 'completed'
    f.nativeEvent('subagents:completed')
    Date.now = now
    assert.equal(f.store.snapshot().revision, before)
    assert.equal(f.binding, undefined)
    assert.equal(f.runtime.status().lastError, 'worker-integration-unavailable')
  } finally {
    Date.now = now
    f.close()
  }
})

test('foreground/cancel/session lifecycle invalidates worker publication and failed jobs do not advance review progress', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    await f.runtime.run('agent_memory_reflect', { assignment: 'Remember a durable method' }, f.ctx)
    const child: any = f.child()
    const files: any = await f.runtime.run('agent_memory_read', {}, child)
    await f.runtime.run(
      'agent_memory_edit',
      {
        path: 'procedures/do-not-integrate.md',
        expectedHash: null,
        text: '# Pending\n',
        sources: [],
      },
      child,
    )
    const before = f.store.snapshot().revision
    await f.emit('before_agent_start', { systemPrompt: 'Foreground task' })
    assert.equal(f.record.status, 'stopped')
    await assert.rejects(f.runtime.run('agent_memory_commit', { revision: files.revision }, child))
    f.record.status = 'completed'
    f.nativeEvent('subagents:completed')
    assert.equal(f.store.snapshot().revision, before)
    await f.emit('session_shutdown')
    await assert.rejects(f.runtime.run('agent_memory_read', {}, f.ctx))
  } finally {
    f.close()
  }
})

test('same-runtime ABI1 worker before_agent_start preserves active worker job while palace remains read-only', async () => {
  const f = fixture()
  try {
    await f.emit('session_start')
    const revBefore = f.store.snapshot().revision
    const palace: any = await f.runtime.run('agent_memory_manage', { action: 'palace' }, f.ctx)
    assert.equal(palace.revision, revBefore)
    assert.equal(palace.project, 'project')
    assert.ok(palace.layers.core.includes('Core.md'))
    assert.equal(f.store.snapshot().revision, revBefore)

    await f.runtime.run('agent_memory_reflect', { assignment: 'Maintain a durable method' }, f.ctx)
    const child: any = f.child()
    const workerStart = await f.emit(
      'before_agent_start',
      { systemPrompt: 'Parent preamble\n<active_agent name="managed-memory-writer"/>' },
      child,
    )
    const workerPrompt = promptResult(workerStart)
    assert.match(
      typeof workerPrompt === 'string' ? workerPrompt : (workerPrompt?.systemPrompt ?? ''),
      /Curation doctrine v1/,
    )
    assert.notEqual(f.record.status, 'stopped', 'worker before_agent_start must not self-cancel its own job')
    const files: any = await f.runtime.run('agent_memory_read', {}, child)
    await f.runtime.run(
      'agent_memory_edit',
      {
        path: 'procedures/worker-survived.md',
        expectedHash: null,
        text: '# Worker Survived\n\n- Same-runtime before_agent_start did not self-cancel.\n',
        sources: [],
      },
      child,
    )
    const ready: any = await f.runtime.run('agent_memory_commit', { revision: files.revision }, child)
    assert.equal(ready.readyForIntegration, true)
    f.record.status = 'completed'
    f.nativeEvent('subagents:completed')
    assert.notEqual(f.store.snapshot().revision, revBefore)
    assert.ok(f.store.snapshot().files['procedures/worker-survived.md'])
  } finally {
    f.close()
  }
})

test('deferred worker A before_agent_start cannot cancel replacement worker B on reject or stale/revoked current', async () => {
  for (const mode of ['reject', 'revoked-distinct-child', 'revoked-reused-child'] as const) {
    const f = fixture()
    try {
      await f.emit('session_start')
      const records = new Map<string, any>()
      const spawn = f.service.spawn
      f.service.spawn = (...args) => {
        const id = spawn(...args)
        records.set(id, f.record)
        return id
      }
      f.service.getRecord = (id?: string) => records.get(id!)
      const aborted: string[] = []
      f.service.abort = (id) => {
        aborted.push(id)
        records.get(id).status = 'stopped'
        return true
      }

      // 1. Dispatch worker A (job-1)
      await f.runtime.run('agent_memory_reflect', { assignment: 'Worker A assignment' }, f.ctx)
      assert.equal(f.record.id, 'job-1')
      const childA: any = f.child()
      const valueA = f.binding.value

      // Defer worker A's asynchronous authorize inside before_agent_start
      let resolveA!: (value: any) => void
      let rejectA!: (reason?: any) => void
      const deferredA = new Promise((resolve, reject) => {
        resolveA = resolve
        rejectA = reject
      })
      let markEnteredA!: () => void
      const enteredA = new Promise<void>((resolve) => {
        markEnteredA = resolve
      })
      const originalAuthorize = f.abi.authorize
      let intercepted = false
      f.abi.authorize = (...args: any[]) => {
        if (!intercepted) {
          intercepted = true
          markEnteredA()
          return deferredA
        }
        return originalAuthorize(...args)
      }

      const startAPromise = f.emit(
        'before_agent_start',
        { systemPrompt: 'Parent preamble\n<active_agent name="managed-memory-writer"/>' },
        childA,
      )
      await enteredA
      assert.equal(intercepted, true, 'worker A entered async authorize')

      // 2. Cancel worker A and start replacement worker B (job-2) while A's authorize is still pending
      await f.runtime.run('agent_memory_manage', { action: 'cancel' }, f.ctx)
      assert.deepEqual(aborted, ['job-1'])
      await f.runtime.run('agent_memory_reflect', { assignment: 'Worker B replacement assignment' }, f.ctx)
      assert.equal(f.record.id, 'job-2')

      let childB: any
      if (mode === 'revoked-distinct-child') {
        const childBSM = {
          getSessionId: () => 'child-b',
          getHeader: () => ({ type: 'session', id: 'child-b', parentSession: 'primary' }),
        }
        f.binding.sm = childBSM
        f.nodes.set('child-b', {
          generation: f.abi.generation,
          healthy: () => true,
          managedMemory: f.abi,
        })
        childB = { cwd: f.ctx.cwd, sessionManager: childBSM }
      } else {
        childB = f.child()
      }

      // 3. Settle stale worker A's authorize after replacement B is active
      if (mode === 'reject') {
        rejectA(new Error('stale worker A authorize rejected'))
      } else {
        resolveA({ kind: 'worker', value: valueA })
      }
      const startAResult = promptResult(await startAPromise)
      assert.equal(
        startAResult?.systemPrompt,
        'Managed memory worker unavailable. Do not access memory or infer from inherited context. Report the missing binding/permission and stop.',
        `stale worker A must fail closed in mode=${mode}`,
      )

      // 4. Verify replacement worker B was NOT cancelled (even if revoked worker A emits another before_agent_start) and can complete and integrate
      if (mode === 'revoked-distinct-child') {
        const lateStartA = promptResult(
          await f.emit(
            'before_agent_start',
            { systemPrompt: 'Parent preamble\n<active_agent name="managed-memory-writer"/>' },
            childA,
          ),
        )
        assert.match(lateStartA?.systemPrompt ?? '', /Managed memory worker unavailable/)
      }
      assert.deepEqual(aborted, ['job-1'], `replacement worker B must not be aborted in mode=${mode}`)
      assert.equal(f.runtime.status().worker, true, `replacement worker B must stay active in mode=${mode}`)
      assert.equal(f.binding?.id, 'job-2')
      assert.equal(f.binding?.active(), true)
      assert.equal(records.get('job-2').status, 'running')

      const startBResult = promptResult(
        await f.emit(
          'before_agent_start',
          { systemPrompt: 'Parent preamble\n<active_agent name="managed-memory-writer"/>' },
          childB,
        ),
      )
      assert.match(startBResult?.systemPrompt ?? '', /Curation doctrine v1/)
      const filesB: any = await f.runtime.run('agent_memory_read', {}, childB)
      await f.runtime.run(
        'agent_memory_edit',
        {
          path: `procedures/replacement-${mode}.md`,
          expectedHash: null,
          text: `# Replacement ${mode}\n\n- Replacement worker B survived delayed worker A failure.\n`,
          sources: [],
        },
        childB,
      )
      const commitB: any = await f.runtime.run('agent_memory_commit', { revision: filesB.revision }, childB)
      assert.equal(commitB.readyForIntegration, true)
      records.get('job-2').status = 'completed'
      f.nativeEvent('subagents:completed', { id: 'job-2', type: 'managed-memory-writer' })
      assert.ok(f.store.snapshot().files[`procedures/replacement-${mode}.md`])
    } finally {
      f.close()
    }
  }
})
