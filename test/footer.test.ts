import test from 'node:test'
import assert from 'node:assert/strict'
import {
  footerRepaint,
  pack,
  renderFooter,
  routeLabel,
  sessionTotals,
  usageStats,
  COLORS,
  type Segment,
} from '../lib/footer.ts'
import { parseQuota, quotaController, SUCCESS_TTL, STALE_BOUND, quotaSegments } from '../lib/quota.ts'
import { start, text } from '../lib/status.ts'

const plain = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
const graphemes = (value: string) =>
  Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(value), (s) => s.segment)
const widthOf = (value: string) =>
  graphemes(plain(value)).reduce((n, g) => n + (/\p{Extended_Pictographic}/u.test(g) ? 2 : 1), 0)
const geometry = {
  visibleWidth: widthOf,
  truncateToWidth(value: string, width: number) {
    let result = ''
    for (const g of graphemes(value)) {
      if (widthOf(result + g) > width) break
      result += g
    }
    return result + '\x1b[0m' // Pi TUI also emits a reset for plain input.
  },
}
const usage = (input = 10, cacheRead = 20) => ({
  input,
  output: 3,
  cacheRead,
  cacheWrite: 2,
  totalTokens: input + cacheRead + 5,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 },
})
function fixture(legacyQuota = false) {
  const entries: any[] = [
    {
      type: 'message',
      message: {
        role: 'assistant',
        model: 'gpt',
        provider: 'openai',
        api: 'openai-responses',
        stopReason: 'stop',
        usage: usage(),
      },
    },
  ]
  let account = 'account-A',
    oauth = true,
    clock = 1_800_000_000_000
  const model = {
    id: 'gpt-6.1-sol',
    provider: legacyQuota ? 'openai-codex' : 'openai',
    api: legacyQuota ? 'openai-codex-responses' : 'openai-responses',
    contextWindow: 272000,
  }
  const token = () =>
    `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url')}.signature`
  const ctx: any = {
    cwd: '/synthetic/งานไทย👩🏽‍💻',
    mode: 'tui',
    model,
    thinkingLevel: 'medium',
    isIdle: () => true,
    getContextUsage: () => ({ tokens: 0, percent: 0, contextWindow: 272000 }),
    sessionManager: {
      getEntries: () => entries,
      getBranch: () => entries,
      getSessionName: () => 'ชื่อเซสชัน',
      getSessionId: () => 'session-A',
    },
    modelRegistry: {
      isUsingOAuth: () => oauth,
      getProvider: () => ({ auth: { oauth: { isSubscription: true } } }),
      getProviderAuthStatus: () => ({
        configured: true,
        source: 'stored',
        label: oauth ? 'OAuth' : 'API key',
      }),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: token() }),
    },
  }
  const state = {
    git: 'git dirty:1 ?:2 ahead:3 behind:4',
    activity: 'tool read',
    hideContext: false,
    quota: [],
  }
  const data = {
    getGitBranch: () => 'main',
    getExtensionStatuses: () =>
      new Map([
        ['other', 'another extension'],
        ['mahiro-status', 'DUPLICATE'],
      ]),
  }
  return {
    ctx,
    entries,
    state,
    data,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms
    },
    account: (v: string) => {
      account = v
    },
    oauth: (v: boolean) => {
      oauth = v
    },
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve))
const payload = (reset: number) => ({
  rate_limit: {
    primary_window: { used_percent: 41, limit_window_seconds: 604800, reset_at: reset / 1000 },
    secondary_window: { used_percent: 90, limit_window_seconds: 18000, reset_at: reset / 1000 },
  },
})

test('full-session stats count each native usage type once across compaction, latest cache rate only', () => {
  const entries: any[] = [
    { type: 'usage', usage: usage() },
    { type: 'message', message: { role: 'assistant', usage: usage() } },
    { type: 'message', message: { role: 'toolResult', usage: usage() } },
    { type: 'compaction', usage: usage() },
    { type: 'branch_summary', usage: usage() },
    { type: 'message', message: { role: 'user', usage: usage() } },
    { type: 'message', message: { role: 'assistant', usage: usage(8, 0) } },
  ]
  assert.deepEqual(usageStats(entries), {
    input: 58,
    output: 18,
    cacheRead: 100,
    cacheWrite: 12,
    cost: 0.006,
    cacheHit: 0,
  })
  entries.push({ type: 'message', message: { role: 'assistant', usage: { ...usage(0, 0), cacheWrite: 0 } } })
  assert.equal(usageStats(entries).cacheHit, undefined)
})

test('cohesive palette, native metrics, context zero/unknown, auto off, API/subscription and other slots', () => {
  const f = fixture()
  let rows = renderFooter(f.ctx, {}, f.data, f.state, 160, geometry)
  const all = rows.map(plain).join('\n')
  for (const fragment of [
    '📁',
    '🌿 main +2 ~1 ↑3 ↓4',
    'ชื่อเซสชัน',
    '🔧 read',
    'Pi',
    '[gpt-6.1-sol r:med]',
    'openai',
    'ctx 0.0%/272k (auto)',
    '↑10 ↓3',
    'R20',
    'W2',
    'CH62.5%',
    '$0.001 (sub)',
    'another extension',
  ])
    assert.ok(all.includes(fragment), fragment)
  assert.ok(!all.includes('DUPLICATE'))
  assert.match(rows[0], /\x1b\[38;2;140;140;249m/)
  f.ctx.getContextUsage = () => ({ percent: null, contextWindow: 272000 })
  f.oauth(false)
  rows = renderFooter(f.ctx, { compaction: { enabled: false } }, f.data, f.state, 80, geometry)
  assert.match(rows.map(plain).join('\n'), /ctx \?\/272k \(auto off\)/)
  assert.ok(!rows.map(plain).join('\n').includes('(sub)'))
  f.ctx.getContextUsage = () => undefined
  f.ctx.model = undefined
  assert.match(renderFooter(f.ctx, {}, f.data, f.state, 80, geometry).map(plain).join('\n'), /ctx \?\/\?/)
})

test('40/60/80/120/160-column packing keeps native data, graphemes and ANSI resets', () => {
  const f = fixture()
  for (const width of [40, 60, 80, 120, 160]) {
    const rows = renderFooter(f.ctx, {}, f.data, f.state, width, geometry)
    assert.ok(rows.every((row) => geometry.visibleWidth(row) <= width))
    const all = rows.map(plain).join('\n')
    for (const fragment of [
      'gpt-6.1-sol',
      'ctx 0.0%/272k',
      '↑10 ↓3',
      'R20',
      'W2',
      'CH62.5%',
      '$0.001 (sub)',
      'งานไทย👩🏽‍💻',
    ])
      assert.ok(all.includes(fragment), `${width}: ${fragment}`)
    assert.ok(rows.every((row) => row.endsWith('\x1b[0m')))
  }
  const value = 'กิ👩🏽‍💻'.repeat(30)
  const rows = pack([{ text: value, color: COLORS.folder }], 4, geometry)
  assert.equal(rows.map(plain).join(''), value)
  assert.equal(text('กิ👩🏽‍💻', 1), 'กิ')
  assert.equal(text('\x1b[31mred\x1b[0m'), 'red')
})

test('route label requires virtual selection plus successful active-branch evidence', () => {
  const f = fixture()
  assert.equal(routeLabel(f.ctx), '')
  f.ctx.model.api = 'pi-virtual'
  assert.equal(routeLabel(f.ctx), '→ openai/gpt')
  f.entries.push({
    type: 'message',
    message: { role: 'assistant', model: 'wrong', provider: 'wrong', stopReason: 'error' },
  })
  assert.equal(routeLabel(f.ctx), '→ openai/gpt')
  f.entries.push({ type: 'model_change', modelId: 'new' })
  assert.equal(routeLabel(f.ctx), '→ route unknown')
})

test('quota parser matches remaining labels, durations, additional limits, reset times; rejects malformed values', () => {
  const f = fixture(),
    reset = f.now() + 3600000
  const windows = parseQuota({
    ...payload(reset),
    additional_rate_limits: [
      {
        limit_name: 'Spark',
        rate_limit: {
          primary_window: { used_percent: 0, limit_window_seconds: 3600, reset_at: reset / 1000 },
        },
      },
    ],
  })
  assert.deepEqual(
    windows.map((w) => [w.label, w.remaining, w.reset]),
    [
      ['P:7d', 59, reset],
      ['S:5h', 10, reset],
      ['Spark P:1h', 100, reset],
    ],
  )
  assert.match(quotaSegments(windows, false)[0].text, /P:7d ▰▰▰▰▰▱▱▱ 59% left resets .*Z/)
  for (const bad of [
    undefined,
    {},
    { rate_limit: { primary_window: { used_percent: -1, limit_window_seconds: 10 } } },
  ])
    assert.deepEqual(parseQuota(bad), [])
})

test('quota uses only current Pi OAuth and fixed endpoint/headers, success TTL, failure stale bound and backoff', async () => {
  const f = fixture(true)
  let count = 0,
    fail = false
  const controller = quotaController(f.ctx, () => {}, {
    now: f.now,
    fetch: async (url, options) => {
      count++
      assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage')
      assert.equal(options?.redirect, 'error')
      assert.equal(new Headers(options?.headers).get('ChatGPT-Account-Id'), 'account-A')
      if (fail) throw new Error('secret must never be shown')
      return new Response(JSON.stringify(payload(f.now() + 3600000)))
    },
  })
  controller.tick()
  await flush()
  assert.equal(count, 1)
  assert.match(controller.view().segments[0].text, /59% left/)
  assert.equal(controller.view().tokens.mahiro_sidebar_q1_ok, 'Codex P:7d 59% left')
  assert.equal(controller.view().tokens.mahiro_sidebar_q2_critical, 'Codex S:5h 10% left')
  controller.tick()
  await flush()
  assert.equal(count, 1)
  f.advance(SUCCESS_TTL)
  fail = true
  controller.tick()
  await flush()
  assert.equal(count, 2)
  assert.match(controller.view().segments[0].text, /stale/)
  assert.deepEqual(controller.view().tokens, {})
  controller.tick()
  await flush()
  assert.equal(count, 2)
  f.advance(STALE_BOUND)
  assert.equal(controller.view().segments[0].text, 'Codex unavailable (request failed)')
  controller.dispose()
  controller.tick()
  assert.equal(count, 2)
})

test('quota account/provider/auth/model/session changes clear old data, late results cannot revive it', async () => {
  const f = fixture(true)
  let resolve!: (value: Response) => void
  let delay = false,
    requests = 0
  const controller = quotaController(f.ctx, () => {}, {
    now: f.now,
    fetch: async () => {
      requests++
      return delay
        ? new Promise<Response>((yes) => {
            resolve = yes
          })
        : new Response(JSON.stringify(payload(f.now() + 3600000)))
    },
  })
  controller.tick()
  await flush()
  assert.ok(Object.keys(controller.view().tokens).length)
  f.account('account-B')
  delay = true
  controller.tick()
  await flush()
  assert.deepEqual(controller.view().tokens, {})
  assert.equal(requests, 2)
  f.ctx.model.provider = 'anthropic'
  controller.tick()
  assert.match(controller.view().segments[0].text, /unsupported/)
  resolve(new Response(JSON.stringify(payload(f.now() + 3600000))))
  await flush()
  assert.deepEqual(controller.view().tokens, {})
  delay = false
  f.ctx.model.provider = 'openai-codex'
  f.oauth(false)
  controller.tick()
  await flush()
  assert.equal(requests, 2)
  f.oauth(true)
  controller.tick()
  await flush()
  assert.ok(Object.keys(controller.view().tokens).length)
  f.ctx.model.id = 'new'
  controller.tick()
  assert.deepEqual(controller.view().tokens, {})
  await flush()
  f.ctx.sessionManager.getSessionId = () => 'session-B'
  controller.tick()
  assert.deepEqual(controller.view().tokens, {})
  await flush()
  controller.dispose()
  assert.deepEqual(controller.view().tokens, {})
})

test('quota missing windows/account, API keys, failed auth, expired resets and teardown are truthful', async () => {
  const f = fixture(true)
  let body: unknown = {},
    count = 0
  const controller = quotaController(f.ctx, () => {}, {
    now: f.now,
    fetch: async () => {
      count++
      return new Response(JSON.stringify(body))
    },
  })
  controller.tick()
  await flush()
  assert.equal(controller.view().segments[0].text, 'Codex unavailable (no quota windows)')
  body = payload(f.now() - 1)
  f.advance(SUCCESS_TTL)
  controller.tick()
  await flush()
  assert.match(controller.view().segments[0].text, /stale/)
  assert.deepEqual(controller.view().tokens, {})
  f.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: false, error: 'secret' })
  controller.tick()
  await flush()
  assert.equal(controller.view().segments[0].text, 'Codex unavailable (auth)')
  f.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: 'not-account-bearing' })
  controller.tick()
  await flush()
  assert.equal(count, 3)
  controller.dispose()
})

test('early model selection suppresses old-account requests; disposal aborts and ignores in-flight quota', async () => {
  const f = fixture(true)
  let count = 0,
    signal: AbortSignal | undefined,
    resolve!: (response: Response) => void
  const controller = quotaController(f.ctx, () => {}, {
    now: f.now,
    fetch: async (_url, options) => {
      count++
      signal = options?.signal as AbortSignal
      return new Promise<Response>((yes) => {
        resolve = yes
      })
    },
  })
  controller.invalidate({ id: 'new-model', provider: 'openai-codex' })
  controller.tick()
  await flush()
  assert.equal(count, 0)
  f.ctx.model.id = 'new-model'
  controller.tick()
  await flush()
  assert.equal(count, 1)
  controller.tick()
  assert.equal(count, 1)
  controller.dispose()
  assert.equal(signal?.aborted, true)
  resolve(new Response(JSON.stringify(payload(f.now() + 3600000))))
  await flush()
  assert.deepEqual(controller.view().tokens, {})
  assert.equal(controller.view().segments[0].text, 'Codex unavailable')
})

test('opaque current Pi OAuth uses its native default scope without inventing an account selector', async () => {
  const f = fixture(true)
  f.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({
    ok: true,
    apiKey: 'synthetic-native-opaque-bearer',
  })
  const controller = quotaController(f.ctx, () => {}, {
    now: f.now,
    fetch: async (_url, options) => {
      const headers = new Headers(options?.headers)
      assert.equal(headers.get('Authorization'), 'Bearer synthetic-native-opaque-bearer')
      assert.equal(headers.get('ChatGPT-Account-Id'), null)
      return new Response(JSON.stringify(payload(f.now() + 3600000)))
    },
  })
  controller.tick()
  await flush()
  assert.match(controller.view().segments[0].text, /59% left/)
  controller.dispose()
})

test('native direct OpenAI subscription hides unavailable quota without fallback links, auth resolution or legacy probes', () => {
  const f = fixture()
  let resolutions = 0,
    requests = 0
  f.ctx.modelRegistry.getApiKeyAndHeaders = async () => {
    resolutions++
    throw new Error('must not resolve native quota auth')
  }
  const controller = quotaController(f.ctx, () => {}, {
    now: f.now,
    fetch: async () => {
      requests++
      throw new Error('must not probe native quota')
    },
  })
  controller.tick()
  controller.tick()
  assert.deepEqual(controller.view().segments, [])
  assert.deepEqual(controller.view().tokens, {})
  assert.equal(resolutions, 0)
  assert.equal(requests, 0)
  controller.dispose()
})

test('quota authorization denial is truthful and stops requests until current Pi credential changes', async () => {
  for (const status of [401, 403]) {
    const f = fixture(true)
    let count = 0
    const controller = quotaController(f.ctx, () => {}, {
      now: f.now,
      fetch: async () => {
        count++
        return count === 1
          ? new Response('', { status })
          : new Response(JSON.stringify(payload(f.now() + 3600000)))
      },
    })
    controller.tick()
    await flush()
    assert.equal(
      controller.view().segments[0].text,
      'OpenAI subscription · quota unavailable for this sign-in',
    )
    assert.deepEqual(controller.view().tokens, {})
    f.advance(SUCCESS_TTL * 2)
    controller.tick()
    await flush()
    assert.equal(count, 1)
    f.account('account-B')
    controller.tick()
    await flush()
    assert.equal(count, 2)
    assert.match(controller.view().segments[0].text, /59% left/)
    controller.dispose()
  }
})

test('legacy presentation owns footer cleanup, shared q keys clear when invalid; non-TUI never invokes hooks', async () => {
  const f = fixture()
  f.ctx.model.provider = 'openai-codex'
  const jobs: string[][] = []
  let disposed = 0,
    renders = 0
  let quota: Record<string, string> = { mahiro_sidebar_q1_ok: 'Codex P:7d 59% left' }
  const options = {
    owner: { seq: 1 },
    env: { HERDR_ENV: '1', HERDR_PANE_ID: 'p', HERDR_SOCKET_PATH: '/s' },
    run: (_cmd: string, args: string[]) => ({ promise: Promise.resolve(''), cancel() {} }),
    publish: (_run: unknown, _env: unknown, args: string[]) => {
      jobs.push(args)
      return { promise: Promise.resolve(''), cancel() {} }
    },
    every: () => () => {},
    presentation: {
      render() {
        renders++
      },
      tick() {},
      tokens: () => quota,
      dispose() {
        disposed++
      },
    },
  }
  const controller = start(f.ctx, options)
  await flush()
  assert.ok(jobs[0].includes('mahiro_sidebar_q1_ok=Codex P:7d 59% left'))
  quota = {}
  controller.tick()
  await flush()
  for (const severity of ['ok', 'warn', 'critical'])
    assert.ok(jobs.at(-1)!.includes(`mahiro_sidebar_q1_${severity}`))
  const before = renders
  const child = start({ ...f.ctx, mode: 'print' }, options)
  child.tick()
  child.dispose()
  assert.equal(renders, before)
  assert.equal(disposed, 0)
  controller.dispose()
  controller.dispose()
  assert.equal(disposed, 1)
})

test('idle polls request a whole-TUI repaint only when the rendered footer changes', () => {
  const f = fixture()
  let requests = 0,
    quota: Segment[] = []
  const footer = footerRepaint(
    (width) => renderFooter(f.ctx, {}, f.data, { ...f.state, quota }, width, geometry),
    () => {
      requests++
    },
  )
  footer.changed()
  assert.equal(requests, 1, 'nothing painted yet')
  footer.render(100)
  for (let i = 0; i < 10; i++) footer.changed()
  assert.equal(requests, 1, 'unchanged idle ticks must not repaint the transcript')
  f.state.activity = 'idle'
  footer.changed()
  assert.equal(requests, 2)
  footer.render(100)
  footer.changed()
  assert.equal(requests, 2)
  // Quota staleness and context come from time/host state, not status events.
  quota = quotaSegments([{ label: 'P:7d', remaining: 59, reset: null }], true)
  footer.changed()
  assert.equal(requests, 3)
  footer.render(100)
  f.ctx.getContextUsage = () => ({ tokens: 1, percent: 42, contextWindow: 272000 })
  footer.changed()
  assert.equal(requests, 4)
  footer.render(80)
  footer.changed()
  assert.equal(requests, 4, 'comparison uses the last painted width')
  let fail = false
  const fragile = footerRepaint(
    () => {
      if (fail) throw new Error('synthetic')
      return ['row']
    },
    () => {
      requests++
    },
  )
  fragile.render(10)
  fail = true
  fragile.changed()
  assert.equal(requests, 5, 'a footer that cannot be compared still repaints')
})

test('append-only session totals are recomputed only for new entries, leaf moves, model or session changes', () => {
  const f = fixture()
  let estimates = 0,
    leaf = 'leaf-A',
    session = 'session-A',
    percent = 10,
    fail = false
  f.ctx.getContextUsage = () => {
    estimates++
    if (fail) throw new Error('synthetic')
    return { tokens: 1, percent, contextWindow: 272000 }
  }
  f.ctx.sessionManager.getLeafId = () => leaf
  f.ctx.sessionManager.getSessionId = () => session
  const totals = sessionTotals()
  const paint = () => renderFooter(f.ctx, {}, f.data, f.state, 100, geometry, totals).map(plain).join('\n')
  const first = paint()
  for (let i = 0; i < 5; i++) assert.equal(paint(), first)
  assert.equal(estimates, 1, 'identical frames reuse the host context estimate')
  assert.deepEqual(renderFooter(f.ctx, {}, f.data, f.state, 100, geometry).map(plain).join('\n'), first)
  estimates = 0
  percent = 55
  f.entries.push({
    type: 'message',
    message: {
      role: 'assistant',
      model: 'gpt',
      provider: 'openai',
      api: 'openai-responses',
      stopReason: 'stop',
      usage: usage(40, 0),
    },
  })
  assert.match(paint(), /ctx 55\.0%/)
  assert.match(paint(), /↑50/)
  assert.equal(estimates, 1, 'an appended entry recomputes once')
  percent = 60
  leaf = 'leaf-B'
  paint()
  f.ctx.model = { ...f.ctx.model }
  paint()
  session = 'session-B'
  paint()
  assert.equal(estimates, 4)
  fail = true
  f.entries.push({ type: 'custom', customType: 'x' })
  paint()
  paint()
  assert.equal(estimates, 6, 'an unavailable estimate is retried rather than cached')
})
