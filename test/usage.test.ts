import test from 'node:test'
import assert from 'node:assert/strict'
import { initUsage, renderUsagePanel, usageDetails, USAGE_TTL, USAGE_WIDGET } from '../lib/usage.ts'
import { quotaController } from '../lib/quota.ts'
import fs from 'node:fs'
import path from 'node:path'
import { createUsageOwner } from '../lib/kernel/usage.ts'
import { UsageStorageError } from '../lib/usage-state.ts'

const geometry = {
  visibleWidth: (value: string) => Array.from(value).length,
  truncateToWidth: (value: string, width: number, ellipsis = '') =>
    Array.from(value).length <= width
      ? value
      : Array.from(value)
          .slice(0, Math.max(0, width - ellipsis.length))
          .join('') + ellipsis,
}
function fixture(provider = 'openai', external?: any) {
  const widgets = new Map<string, any>()
  const commands = new Map<string, any>()
  const events = new Map<string, Array<(...args: any[]) => unknown>>()
  let auth = 0
  let requests = 0
  let changed = 0
  const ctx: any = {
    mode: 'tui',
    hasUI: true,
    cwd: '/synthetic',
    thinkingLevel: 'medium',
    model: { provider, id: 'synthetic', api: 'openai-responses' },
    sessionManager: {
      getSessionId: () => 'session',
      getHeader: () => ({}),
      getEntries: () => [],
      getBranch: () => [],
    },
    modelRegistry: {
      isUsingOAuth: () => true,
      getProviderAuthStatus: () => ({ configured: true }),
      getProvider: () => ({ auth: { oauth: { isSubscription: true } } }),
      getApiKeyAndHeaders: async () => {
        auth++
        return { ok: true, apiKey: 'synthetic' }
      },
    },
    getContextUsage: () => ({ tokens: 0, contextWindow: 100000, percent: 0 }),
    ui: {
      setWidget: (key: string, content: unknown) => {
        widgets.set(key, content)
      },
    },
  }
  const pi: any = {
    registerCommand: (name: string, command: unknown) => commands.set(name, command),
    on(name: string, handler: (...args: any[]) => unknown) {
      events.set(name, [...(events.get(name) ?? []), handler])
      return () => {}
    },
  }
  const quota = quotaController(ctx, () => {}, {
    external,
    fetch: async () => {
      requests++
      throw new Error('synthetic')
    },
  })
  const usage = initUsage(pi, () => Date.now())
  usage.attach(ctx, quota, () => changed++, geometry)
  const panel = (width = 100) =>
    widgets
      .get(USAGE_WIDGET)?.({}, { fg: (_tone: string, line: string) => line })
      .render(width)
      ?.join('\n') ?? ''
  return {
    ctx,
    quota,
    usage,
    commands,
    widgets,
    panel,
    async emit(name: string, context = ctx) {
      for (const handler of events.get(name) ?? []) await handler({}, context)
    },
    counts: () => [auth, requests, changed],
    dispose() {
      usage.dispose()
      quota.dispose()
    },
  }
}

test('command forms are cache-only and persistent opt-in fails closed without Root authority', async () => {
  const f = fixture()
  try {
    assert.equal(f.commands.get('mh-usage').handler, f.usage.handler)
    await f.usage.handler('', f.ctx)
    assert.match(f.panel(), /Mahiro Usage/)
    assert.match(f.panel(), /unsupported/)
    await f.usage.handler('codex on', f.ctx)
    assert.equal(f.usage.display().quota, false)
    assert.match(f.panel(), /not enabled|not saved/)
    await f.usage.handler('compact', f.ctx)
    assert.equal(f.usage.display().style, 'compact')
    assert.equal(f.usage.display().quota, false, 'style does not opt in')
    await f.usage.handler('bar', f.ctx)
    assert.equal(f.usage.display().style, 'bar')
    await f.usage.handler('status 0', f.ctx)
    assert.match(f.panel(), /Usage: \/mh-usage/)
    await f.usage.handler('status 9999', f.ctx)
    assert.match(f.panel(), /Page unavailable/)
    await f.usage.handler('off', f.ctx)
    assert.equal(f.usage.display().quota, false)
    await f.usage.handler('close', f.ctx)
    assert.equal(f.panel(), '')
    assert.deepEqual(f.counts().slice(0, 2), [0, 0])
  } finally {
    f.dispose()
  }
})

test('persistent intent cannot silently fall back to legacy opt-in; off always stops polling', async () => {
  const f = fixture('openai-codex')
  try {
    await f.usage.handler('codex off', f.ctx)
    f.quota.tick()
    assert.deepEqual(f.counts().slice(0, 2), [0, 0])
    await f.usage.handler('codex on', f.ctx)
    assert.equal(f.usage.display().quota, false)
    assert.deepEqual(f.counts().slice(0, 2), [0, 0])
    await f.usage.handler('status 1', f.ctx)
    assert.match(f.panel(), /details 1/)
    await f.usage.handler('off', f.ctx)
    await f.usage.handler('compact', f.ctx)
    assert.equal(f.usage.display().quota, false)
  } finally {
    f.dispose()
  }
})

test('snapshot contains native session totals, latest hit, honest costs, zero context and unavailable credits', () => {
  const f = fixture()
  try {
    f.ctx.sessionManager.getEntries = () => [
      {
        type: 'message',
        message: {
          role: 'assistant',
          usage: {
            input: 100,
            output: 20,
            cacheRead: 300,
            cacheWrite: 0,
            cost: { total: 0.25 },
          },
        },
      },
    ]
    const details = usageDetails(f.ctx, f.quota.snapshot(), f.usage.display()).join('\n')
    assert.match(details, /input 100 · output 20/)
    assert.match(details, /read 300 · write 0/)
    assert.match(details, /cache hit: 75.0%/)
    assert.match(details, /\$0.2500 estimated native total; not a bill \(current route: subscription\)/)
    assert.match(details, /Context used: 0 \/ 100,000 tokens · 0.0%/)
    assert.match(details, /Credits: unavailable; reset credits: unavailable/)
    assert.match(details, /external-auth source: off \(explicit \/mh-usage codex on/)
    const hidden = usageDetails(f.ctx, f.quota.snapshot(), f.usage.display(), false).join('\n')
    assert.match(hidden, /Context used: unavailable \/ unavailable tokens · unavailable/)
  } finally {
    f.dispose()
  }
})

test('panel resize is bounded and sanitized, pages never read collectors or session', () => {
  const details = [
    'Presentation: test',
    'Codex unsupported',
    'Session tokens: 123',
    '\x1b[31munsafe\ncontrol',
    ...Array(40).fill('detail'),
  ]
  for (const width of [1, 10, 80]) {
    for (const page of [0, 1, 2, 9999]) {
      const lines = renderUsagePanel(details, page, width, geometry)
      assert.ok(lines.length <= 8)
      assert.ok(lines.every((line) => geometry.visibleWidth(line) <= width))
      assert.ok(lines.every((line) => !/[\x00-\x1f]/.test(line)))
    }
  }
})

test('10s timeout is replacement-fenced and lifecycle clears old timers/widgets', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  try {
    await f.usage.handler('', f.ctx)
    t.mock.timers.tick(9000)
    await f.usage.handler('status 1', f.ctx)
    t.mock.timers.tick(1000)
    assert.match(f.panel(), /details 1/)
    t.mock.timers.tick(USAGE_TTL - 1000)
    assert.equal(f.panel(), '')
    await f.usage.handler('', f.ctx)
    f.usage.dispose()
    assert.equal(f.panel(), '')
    f.usage.attach(f.ctx, f.quota, () => {}, geometry)
    await f.usage.handler('status', f.ctx)
    t.mock.timers.tick(USAGE_TTL - 1)
    assert.match(f.panel(), /Mahiro Usage/)
    t.mock.timers.tick(1)
    assert.equal(f.panel(), '')
    f.usage.dispose()
    await f.usage.handler('', f.ctx)
    assert.equal(f.panel(), '')
  } finally {
    f.dispose()
  }
})

test('cancelled before-navigation closes only the snapshot and fences the old timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  try {
    for (const event of ['session_before_switch', 'session_before_fork', 'session_before_tree']) {
      await f.usage.handler('', f.ctx)
      t.mock.timers.tick(9000)
      await f.emit(event)
      assert.equal(f.panel(), '', `${event} must close even when transition is cancelled`)
      await f.usage.handler('status 1', f.ctx)
      t.mock.timers.tick(1000)
      assert.match(f.panel(), /details 1/, 'old timer cannot close the replacement snapshot')
      await f.emit(event, { ...f.ctx, cwd: '/unrelated' })
      assert.match(f.panel(), /details 1/, 'unrelated lifecycle contexts cannot dismiss this owner')
      t.mock.timers.tick(USAGE_TTL - 1000)
      assert.equal(f.panel(), '')
    }
    assert.deepEqual(f.counts().slice(0, 2), [0, 0])
  } finally {
    f.dispose()
  }
})

test('actual tree navigation closes the snapshot, rebinds matching public context and guards manager/id/cwd', async () => {
  const f = fixture()
  try {
    await f.usage.handler('', f.ctx)
    const freshWidgets = new Map<string, any>()
    const fresh = {
      ...f.ctx,
      ui: { setWidget: (key: string, value: unknown) => freshWidgets.set(key, value) },
    }
    await f.emit('session_tree', fresh)
    assert.equal(f.panel(), '')
    await f.usage.handler('status', fresh)
    assert.equal(typeof freshWidgets.get(USAGE_WIDGET), 'function')
    await f.emit('session_before_tree', fresh)
    assert.equal(freshWidgets.get(USAGE_WIDGET), undefined, 'cleanup uses the fresh tree UI context')
    const mismatches = [
      { ...fresh, cwd: '/other' },
      { ...fresh, sessionManager: { ...fresh.sessionManager } },
    ]
    for (const mismatch of mismatches) {
      await f.usage.handler('', mismatch)
      assert.equal(freshWidgets.get(USAGE_WIDGET), undefined)
    }
    f.ctx.sessionManager.getSessionId = () => 'replacement'
    await f.usage.handler('', fresh)
    assert.equal(freshWidgets.get(USAGE_WIDGET), undefined, 'captured session id is exact')
    await f.emit('session_tree', fresh)
    f.ctx.sessionManager.getSessionId = () => 'session'
    await f.usage.handler('', fresh)
    assert.equal(
      freshWidgets.get(USAGE_WIDGET),
      undefined,
      'mismatched actual transition detaches old authority',
    )
  } finally {
    f.dispose()
  }
})

test('real shutdown permanently retires retained factory; stale attach and commands cannot rearm', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  try {
    await f.usage.handler('', f.ctx)
    await f.emit('session_shutdown')
    assert.equal(f.panel(), '')
    f.usage.attach(f.ctx, f.quota, () => {}, geometry)
    await f.usage.handler('', f.ctx)
    assert.equal(f.panel(), '')
    // Another owner can publish this key; old shutdown callbacks/timers must not clear it.
    const replacement = () => ({ render: () => ['replacement'] })
    f.widgets.set(USAGE_WIDGET, replacement)
    f.usage.dispose()
    await f.emit('session_tree')
    await f.emit('session_before_switch')
    t.mock.timers.tick(USAGE_TTL)
    assert.equal(f.widgets.get(USAGE_WIDGET), replacement)
  } finally {
    f.dispose()
  }
})

// Unit orchestration only: real Root/PSS authority is covered by usage-sdk-test.mjs.
function profileFixture(
  work: (
    owner: ReturnType<typeof createUsageOwner>,
    bind: (f: ReturnType<typeof fixture>) => void,
    deny: () => void,
    restore: () => void,
  ) => Promise<void>,
) {
  const base = path.resolve('.agent-state/runtime/t291-usage-profile/implementation/usage-unit')
  fs.mkdirSync(base, { recursive: true, mode: 0o700 })
  const profile = fs.mkdtempSync(path.join(base, 'profile-'))
  const previous = process.env.PI_CODING_AGENT_DIR
  const key = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
  const previousNodes = (globalThis as any)[key]
  const nodes = new Map()
  const generation = {}
  let allowed = true
  const owner = createUsageOwner(generation, (ctx) => {
    if (!allowed || ctx.mode !== 'tui' || !ctx.hasUI) throw Error('unit denial')
  })
  process.env.PI_CODING_AGENT_DIR = profile
  ;(globalThis as any)[key] = nodes
  const bind = (f: ReturnType<typeof fixture>) => {
    nodes.set(f.ctx.sessionManager.getSessionId(), { usage: owner, generation, healthy: () => true })
    f.usage.attach(f.ctx, f.quota, () => {}, geometry)
  }
  return work(
    owner,
    bind,
    () => {
      allowed = false
    },
    () => {
      allowed = true
    },
  ).finally(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
    ;(globalThis as any)[key] = previousNodes
  })
}

test('profile on selects CLI across new managers/projects; bounded adoption preserves unchanged runtime overrides', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  await profileFixture(async (_owner, bind, deny) => {
    const first = fixture('openai'),
      other = fixture('anthropic')
    try {
      bind(first)
      bind(other)
      assert.equal(first.quota.snapshot().source, 'unsupported')
      await first.usage.handler('codex on', first.ctx)
      assert.equal(first.quota.snapshot().source, 'codex-cli')
      assert.equal(first.usage.display().quota, true)
      assert.match(first.panel(), /Profile Codex CLI: on \(saved\)/)
      other.usage.syncPreference()
      assert.equal(other.quota.snapshot().source, 'unsupported', 'no immediate fanout')
      t.mock.timers.tick(5_000)
      other.usage.syncPreference()
      assert.equal(other.quota.snapshot().source, 'codex-cli')
      await other.usage.handler('source pi', other.ctx)
      t.mock.timers.tick(5_000)
      other.usage.syncPreference()
      assert.equal(
        other.quota.snapshot().source,
        'unsupported',
        'unchanged revision preserves runtime override',
      )
      const newSession = fixture('google')
      try {
        newSession.ctx.cwd = '/another-project'
        bind(newSession)
        assert.equal(newSession.quota.snapshot().source, 'codex-cli')
        await first.usage.handler('codex off', first.ctx)
        t.mock.timers.tick(5_000)
        newSession.usage.syncPreference()
        assert.equal(newSession.quota.snapshot().state, 'off')
        await first.usage.handler('codex on', first.ctx)
        deny()
        t.mock.timers.tick(5_000)
        first.usage.syncPreference()
        assert.equal(first.quota.snapshot().state, 'off', 'withdrawal cancels automatic CLI, not Pi fallback')
      } finally {
        newSession.dispose()
      }
      assert.deepEqual(first.counts().slice(0, 2), [0, 0], 'preference commands never collect auth/network')
    } finally {
      first.dispose()
      other.dispose()
    }
  })
})

test('authoritative absence cancels previous automatic CLI and subsequent denied reads stay off', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  await profileFixture(async (_owner, bind, deny) => {
    let reads = 0
    const f = fixture('openai', {
      read: async () => {
        reads++
        throw Error('collector must remain stopped')
      },
    })
    try {
      bind(f)
      await f.usage.handler('codex on', f.ctx)
      assert.equal(f.usage.display().quota, true)
      fs.unlinkSync(path.join(process.env.PI_CODING_AGENT_DIR!, 'preferences/usage/state.json'))
      t.mock.timers.tick(5_000)
      f.usage.syncPreference()
      assert.equal(f.quota.snapshot().source, 'codex-cli', 'absence never falls back to Pi')
      assert.equal(f.quota.snapshot().state, 'off')
      assert.equal(f.usage.display().quota, false)
      f.quota.tick()
      deny()
      t.mock.timers.tick(5_000)
      f.usage.syncPreference()
      f.quota.tick()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(f.quota.snapshot().state, 'off')
      assert.equal(reads, 0)
      assert.deepEqual(f.counts().slice(0, 2), [0, 0])
    } finally {
      f.dispose()
    }
  })
})

test('changed authoritative absence cancels runtime CLI but preserves runtime Pi', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  for (const source of ['codex-cli', 'pi']) {
    await profileFixture(async (_owner, bind) => {
      const f = fixture('openai-codex')
      try {
        bind(f)
        await f.usage.handler('codex on', f.ctx)
        await f.usage.handler(`source ${source}`, f.ctx)
        fs.unlinkSync(path.join(process.env.PI_CODING_AGENT_DIR!, 'preferences/usage/state.json'))
        t.mock.timers.tick(5_000)
        f.usage.syncPreference()
        assert.equal(f.quota.snapshot().source, source === 'pi' ? 'legacy' : 'codex-cli')
        assert.equal(f.quota.snapshot().state === 'off', source === 'codex-cli')
        assert.equal(f.usage.display().quota, source === 'pi')
        assert.deepEqual(f.counts().slice(0, 2), [0, 0])
      } finally {
        f.dispose()
      }
    })
  }
})

test('initial and unchanged authoritative absence preserve explicit runtime CLI', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  await profileFixture(async (_owner, bind) => {
    const f = fixture()
    try {
      await f.usage.handler('source codex-cli', f.ctx)
      bind(f)
      assert.equal(f.quota.snapshot().source, 'codex-cli')
      assert.notEqual(f.quota.snapshot().state, 'off', 'initial absence preserves manual collection')
      await f.usage.handler('source codex-cli', f.ctx)
      t.mock.timers.tick(5_000)
      f.usage.syncPreference()
      assert.notEqual(f.quota.snapshot().state, 'off', 'unchanged absence is not withdrawal')
      assert.equal(f.usage.display().quota, true)
      assert.deepEqual(f.counts().slice(0, 2), [0, 0])
    } finally {
      f.dispose()
    }
  })
})

test('suspended read remembers ambiguous ON proof so later absence cancels runtime CLI', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  await profileFixture(async (owner, bind) => {
    const f = fixture()
    const key = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
    try {
      bind(f)
      const node = (globalThis as any)[key].get('session')
      node.usage = {
        ...owner,
        save(ctx: any, ticket: any, prefs: any) {
          owner.save(ctx, ticket, prefs)
          throw new UsageStorageError('durability-unknown')
        },
      }
      await f.usage.handler('codex on', f.ctx)
      t.mock.timers.tick(5_000)
      f.usage.syncPreference()
      assert.equal(f.quota.snapshot().state, 'off', 'observed ON must not lift suspension')
      await f.usage.handler('source codex-cli', f.ctx)
      assert.notEqual(f.quota.snapshot().state, 'off')
      fs.unlinkSync(path.join(process.env.PI_CODING_AGENT_DIR!, 'preferences/usage/state.json'))
      t.mock.timers.tick(5_000)
      f.usage.syncPreference()
      assert.equal(f.quota.snapshot().state, 'off')
      assert.equal(f.usage.display().quota, false)
      assert.equal(f.quota.snapshot().source, 'codex-cli', 'no Pi fallback')
      assert.deepEqual(f.counts().slice(0, 2), [0, 0])
    } finally {
      f.dispose()
    }
  })
})

test('fresh authorized proof restores automatic CLI and saved notice after transient read denial', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  await profileFixture(async (_owner, bind, deny, restore) => {
    const f = fixture()
    try {
      bind(f)
      await f.usage.handler('codex on', f.ctx)
      const file = path.join(process.env.PI_CODING_AGENT_DIR!, 'preferences/usage/state.json')
      const bytes = fs.readFileSync(file)
      deny()
      t.mock.timers.tick(5_000)
      f.usage.syncPreference()
      assert.equal(f.quota.snapshot().state, 'off')
      await f.usage.handler('status', f.ctx)
      assert.match(f.panel(), /preference unavailable/)
      restore()
      t.mock.timers.tick(5_000)
      f.usage.syncPreference()
      assert.equal(f.quota.snapshot().source, 'codex-cli')
      assert.equal(f.usage.display().quota, true)
      assert.notEqual(f.quota.snapshot().state, 'off')
      await f.usage.handler('status', f.ctx)
      assert.match(f.panel(), /Profile Codex CLI: on \(saved\)/)
      assert.doesNotMatch(f.panel(), /preference unavailable/)
      assert.deepEqual(
        fs.readFileSync(file),
        bytes,
        'recovery reauthorizes without rewriting or retrying Save',
      )
      assert.deepEqual(f.counts().slice(0, 2), [0, 0])
    } finally {
      f.dispose()
    }
  })
})

test('same-revision read recovery clears errors without overwriting an advanced runtime Pi override', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  await profileFixture(async (_owner, bind, deny, restore) => {
    const f = fixture('openai-codex')
    try {
      bind(f)
      await f.usage.handler('codex on', f.ctx)
      await f.usage.handler('source pi', f.ctx)
      assert.equal(f.quota.snapshot().source, 'legacy')
      deny()
      t.mock.timers.tick(5_000)
      f.usage.syncPreference()
      await f.usage.handler('status', f.ctx)
      assert.match(f.panel(), /preference unavailable/)
      restore()
      t.mock.timers.tick(5_000)
      f.usage.syncPreference()
      assert.equal(f.quota.snapshot().source, 'legacy')
      await f.usage.handler('status', f.ctx)
      assert.match(f.panel(), /Profile Codex CLI: on \(saved\)/)
      assert.doesNotMatch(f.panel(), /preference unavailable/)
      assert.deepEqual(f.counts().slice(0, 2), [0, 0])
    } finally {
      f.dispose()
    }
  })
})

test('runtime Pi selected after automatic read denial wins recovery of the same saved revision', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  await profileFixture(async (_owner, bind, deny, restore) => {
    const f = fixture('openai-codex')
    try {
      bind(f)
      await f.usage.handler('codex on', f.ctx)
      const file = path.join(process.env.PI_CODING_AGENT_DIR!, 'preferences/usage/state.json')
      const bytes = fs.readFileSync(file)
      deny()
      t.mock.timers.tick(5_000)
      f.usage.syncPreference()
      assert.equal(f.quota.snapshot().state, 'off')
      await f.usage.handler('source pi', f.ctx)
      assert.equal(f.quota.snapshot().source, 'legacy')
      restore()
      t.mock.timers.tick(5_000)
      f.usage.syncPreference()
      assert.equal(f.quota.snapshot().source, 'legacy', 'the newer explicit runtime Pi choice must win')
      await f.usage.handler('status', f.ctx)
      assert.match(f.panel(), /Profile Codex CLI: on \(saved\)/)
      assert.doesNotMatch(f.panel(), /preference unavailable/)
      assert.deepEqual(fs.readFileSync(file), bytes)
      assert.deepEqual(f.counts().slice(0, 2), [0, 0])
    } finally {
      f.dispose()
    }
  })
})

test('failed off hides locally; uncertain on never auto-enables from its ambiguous publication', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  await profileFixture(async (owner, bind, deny) => {
    const f = fixture()
    try {
      bind(f)
      await f.usage.handler('codex on', f.ctx)
      deny()
      await f.usage.handler('codex off', f.ctx)
      assert.equal(f.quota.snapshot().state, 'off')
      assert.match(f.panel(), /not confirmed saved profile-wide/)
    } finally {
      f.dispose()
    }
  })
  await profileFixture(async (owner, bind) => {
    const f = fixture()
    const key = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
    try {
      bind(f)
      const node = (globalThis as any)[key].get('session')
      node.usage = {
        ...owner,
        save(ctx: any, ticket: any, prefs: any) {
          owner.save(ctx, ticket, prefs)
          throw new UsageStorageError('durability-unknown')
        },
      }
      await f.usage.handler('codex on', f.ctx)
      assert.equal(f.quota.snapshot().state, 'off')
      assert.match(f.panel(), /durability is unknown/)
      t.mock.timers.tick(5_000)
      f.usage.syncPreference()
      assert.equal(
        f.quota.snapshot().state,
        'off',
        'reread does not convert unknown durability into collection',
      )
    } finally {
      f.dispose()
    }
  })
})

test('save-failure suspension still adopts a changed authoritative off or absence after runtime CLI override', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  for (const withdrawal of ['off', 'absence']) {
    await profileFixture(async (owner, bind) => {
      const f = fixture()
      const key = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
      try {
        bind(f)
        await f.usage.handler('codex on', f.ctx)
        const node = (globalThis as any)[key].get('session')
        node.usage = {
          ...owner,
          save() {
            throw new UsageStorageError('unavailable')
          },
        }
        await f.usage.handler('codex on', f.ctx)
        assert.equal(f.quota.snapshot().state, 'off')
        await f.usage.handler('source codex-cli', f.ctx)
        t.mock.timers.tick(5_000)
        f.usage.syncPreference()
        assert.notEqual(
          f.quota.snapshot().state,
          'off',
          'unchanged preference preserves explicit runtime choice',
        )
        if (withdrawal === 'off') {
          const other = { ...f.ctx, sessionManager: {} }
          owner.save(other, owner.read(other).ticket, { codex: false })
        } else fs.unlinkSync(path.join(process.env.PI_CODING_AGENT_DIR!, 'preferences/usage/state.json'))
        t.mock.timers.tick(5_000)
        f.usage.syncPreference()
        assert.equal(f.quota.snapshot().state, 'off', withdrawal)
        assert.equal(f.usage.display().quota, false)
        assert.equal(f.quota.snapshot().source, 'codex-cli', 'no Pi fallback')
        assert.deepEqual(f.counts().slice(0, 2), [0, 0])
      } finally {
        f.dispose()
      }
    })
  }
})

test('advanced CLI selection remains runtime-only without profile grant and works on native-direct model', async () => {
  let reads = 0
  const f = fixture('openai', {
    read: async () => {
      reads++
      throw Error('synthetic CLI unavailable')
    },
  })
  try {
    await f.usage.handler('source codex-cli', f.ctx)
    f.usage.syncPreference(true)
    f.quota.tick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(reads, 1)
    assert.deepEqual(f.counts().slice(0, 2), [0, 0], 'no native auth or fallback request')
  } finally {
    f.dispose()
  }
})
