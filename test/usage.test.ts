import test from 'node:test'
import assert from 'node:assert/strict'
import { initUsage, renderUsagePanel, usageDetails, USAGE_TTL, USAGE_WIDGET } from '../lib/usage.ts'
import { quotaController } from '../lib/quota.ts'

const geometry = {
  visibleWidth: (value: string) => Array.from(value).length,
  truncateToWidth: (value: string, width: number, ellipsis = '') =>
    Array.from(value).length <= width
      ? value
      : Array.from(value)
          .slice(0, Math.max(0, width - ellipsis.length))
          .join('') + ellipsis,
}
function fixture(provider = 'openai') {
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
    fetch: async () => {
      requests++
      throw new Error('synthetic')
    },
  })
  const usage = initUsage(pi)
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

test('all command forms are cache-only and unsupported opt-in stays off without auth or model turns', async () => {
  const f = fixture()
  try {
    assert.equal(f.commands.get('mh-usage').handler, f.usage.handler)
    await f.usage.handler('', f.ctx)
    assert.match(f.panel(), /Mahiro Usage/)
    assert.match(f.panel(), /unsupported/)
    await f.usage.handler('codex on', f.ctx)
    assert.equal(f.usage.display().quota, false)
    assert.match(f.panel(), /not enabled/)
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

test('legacy opt-in is presentation-only; off stops polling; disabled style cannot reenable it', async () => {
  const f = fixture('openai-codex')
  try {
    await f.usage.handler('codex off', f.ctx)
    f.quota.tick()
    assert.deepEqual(f.counts().slice(0, 2), [0, 0])
    await f.usage.handler('codex on', f.ctx)
    assert.equal(f.usage.display().quota, true)
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
    assert.match(details, /external-auth source: off \(explicit \/mh-usage source codex-cli/)
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
