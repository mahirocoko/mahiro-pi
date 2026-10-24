import test from 'node:test'
import assert from 'node:assert/strict'
import { COLORS } from '../lib/footer.ts'
import {
  quotaController,
  quotaFooterSegments,
  quotaSegments,
  quotaBalances,
  SUCCESS_TTL,
  STALE_BOUND,
} from '../lib/quota.ts'

test('quota credit fields require real finite nonnegative support; missing is never fabricated zero', () => {
  assert.deepEqual(quotaBalances({}), { credits: null, resetCredits: null })
  assert.deepEqual(
    quotaBalances({ credits: { balance: '12.5' }, rate_limit_reset_credits: { available_count: 0 } }),
    { credits: 12.5, resetCredits: 0 },
  )
  for (const balance of [-1, Infinity, 'NaN', '', true, '1e5'])
    assert.equal(quotaBalances({ credits: { balance } }).credits, null)
})

const flush = () => new Promise((resolve) => setImmediate(resolve))
const joined = (segments: { text: string }[]) => segments.map((segment) => segment.text).join(' | ')

test('footer quota is a thin remaining-allowance projection, with compact fallback and full detail retained', () => {
  const windows = [
    { label: 'P:7d', remaining: 81, reset: 1_800_001_000_000 },
    { label: 'S:5h', remaining: 62, reset: null },
    { label: 'Code review P:7d', remaining: 0, reset: null },
  ]
  const snapshot = structuredClone(windows)
  const footer = quotaFooterSegments(windows, false)
  assert.equal(joined(footer.expanded), 'Codex 5h ▰▰▰▰▰▰▱▱▱▱ 62% | Codex Weekly ▰▰▰▰▰▰▰▰▱▱ 81% | +1 windows')
  assert.equal(joined(footer.compact), 'Codex 5h 62% | Codex Weekly 81% | +1 windows')
  assert.equal(footer.expanded[0].color, COLORS.git)
  assert.equal(quotaSegments(windows, false).length, 3)
  assert.match(quotaSegments(windows, false)[0].text, /resets .*Z/)
  assert.deepEqual(windows, snapshot, 'footer selection must not reorder or mutate the canonical cache')
})

test('zero remaining is genuine zero; stale is explicit, muted and never silently changed into fresh', () => {
  const windows = [
    { label: 'P:5h', remaining: 0, reset: null },
    { label: 'S:7d', remaining: 19, reset: null },
  ]
  const fresh = quotaFooterSegments(windows, false)
  assert.equal(fresh.expanded[0].text, 'Codex 5h ▱▱▱▱▱▱▱▱▱▱ 0%')
  assert.equal(fresh.expanded[0].color, COLORS.error)
  assert.equal(fresh.expanded[1].color, COLORS.error)
  const stale = quotaFooterSegments(windows, true)
  assert.match(joined(stale.compact), /^Codex 5h 0% stale \| Codex Weekly 19% stale$/)
  assert.ok(stale.expanded.every((segment) => segment.color === COLORS.label))
  assert.deepEqual(quotaFooterSegments([], false), { expanded: [], compact: [] })
  const additional = quotaFooterSegments([{ label: 'Spark P:1h', remaining: 25, reset: null }], false)
  assert.match(joined(additional.compact), /Spark P:1h 25%/)
  assert.equal(additional.expanded[0].color, COLORS.dirty)
})

function fixture(provider: string, subscription = true) {
  let clock = 1_800_000_000_000
  let resolutions = 0
  let requests = 0
  let failed = false
  let responseStatus = 200
  const model: any = { id: 'synthetic', provider }
  const ctx: any = {
    model,
    sessionManager: { getSessionId: () => 'synthetic-session' },
    modelRegistry: {
      isUsingOAuth: () => true,
      getProvider: () => ({ auth: { oauth: { isSubscription: subscription } } }),
      getProviderAuthStatus: () => ({ configured: true, source: 'stored', label: 'OAuth' }),
      getApiKeyAndHeaders: async () => {
        resolutions++
        return { ok: true, apiKey: 'synthetic-opaque-bearer' }
      },
    },
  }
  const controller = quotaController(ctx, () => {}, {
    now: () => clock,
    fetch: async () => {
      requests++
      if (failed) throw new Error('synthetic failure')
      return new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 38, limit_window_seconds: 18000, reset_at: clock / 1000 + 3600 },
            secondary_window: {
              used_percent: 19,
              limit_window_seconds: 604800,
              reset_at: clock / 1000 + 7200,
            },
          },
        }),
        { status: responseStatus },
      )
    },
  })
  return {
    controller,
    counts: () => [resolutions, requests],
    advance: (value: number) => {
      clock += value
    },
    fail: () => {
      failed = true
    },
    deny: () => {
      responseStatus = 403
    },
  }
}

test('native direct OpenAI and unsupported routes omit the quota row without auth or network calls', () => {
  for (const provider of ['openai', 'anthropic']) {
    const f = fixture(provider)
    assert.deepEqual(f.controller.view().footerSegments, [])
    f.controller.tick()
    f.controller.tick()
    assert.deepEqual(f.controller.view().footerSegments, [])
    assert.deepEqual(f.controller.view().footerCompact, [])
    assert.deepEqual(f.counts(), [0, 0])
    assert.equal(f.controller.snapshot().source, 'unsupported')
    assert.deepEqual(f.controller.snapshot().windows, [])
    assert.equal(f.controller.snapshot().credits, null)
    assert.deepEqual(f.counts(), [0, 0], 'snapshot never resolves native-direct auth')
    f.controller.dispose()
  }
})

test('legacy cached footer views perform no extra collection and preserve stale/unavailable boundaries', async () => {
  const f = fixture('openai-codex')
  try {
    f.controller.tick()
    await flush()
    const fresh = f.controller.view()
    assert.match(joined(fresh.footerSegments), /^Codex 5h ▰/)
    assert.equal(joined(fresh.footerCompact), 'Codex 5h 62% | Codex Weekly 81%')
    assert.match(joined(fresh.segments), /resets .*Z/)
    const snapshot = f.controller.snapshot()
    assert.equal(snapshot.source, 'legacy')
    assert.equal(snapshot.stale, false)
    assert.equal(snapshot.windows.length, 2)
    snapshot.windows[0].remaining = 0
    assert.equal(f.controller.snapshot().windows[0].remaining, 62, 'snapshot cannot mutate collector cache')
    const counts = f.counts()
    for (let i = 0; i < 10; i++) {
      f.controller.view()
      f.controller.snapshot()
    }
    assert.deepEqual(f.counts(), counts, 'render-time cache reads must not resolve auth or fetch')
    f.advance(SUCCESS_TTL)
    f.fail()
    f.controller.tick()
    await flush()
    assert.match(joined(f.controller.view().footerCompact), /^Codex 5h 62% stale/)
    assert.deepEqual(f.controller.view().tokens, {})
    assert.equal(f.controller.snapshot().stale, true)
    f.advance(STALE_BOUND)
    assert.deepEqual(f.controller.snapshot().windows, [])
    assert.equal(joined(f.controller.view().footerSegments), 'Codex unavailable (request failed)')
    assert.equal(joined(f.controller.view().footerCompact), 'Codex unavailable (request failed)')
  } finally {
    f.controller.dispose()
  }
})

test('legacy quota denial shows an explicit unavailable state, not a zero-percent graph', async () => {
  const f = fixture('openai-codex')
  try {
    f.deny()
    f.controller.tick()
    await flush()
    assert.equal(joined(f.controller.view().footerSegments), 'Codex unavailable | sign-in denied')
    assert.equal(joined(f.controller.view().footerCompact), 'Codex unavailable | sign-in denied')
    assert.deepEqual(f.controller.view().tokens, {})
  } finally {
    f.controller.dispose()
  }
})

test('off invalidates pending auth; late old generations cannot fetch or release replacement ownership', async () => {
  const resolutions: Array<(value: unknown) => void> = []
  let requests = 0
  const ctx: any = {
    model: { provider: 'openai-codex', id: 'synthetic' },
    sessionManager: { getSessionId: () => 'synthetic' },
    modelRegistry: {
      getProviderAuthStatus: () => ({ configured: true }),
      isUsingOAuth: () => true,
      getApiKeyAndHeaders: () => new Promise((resolve) => resolutions.push(resolve)),
    },
  }
  const controller = quotaController(ctx, () => {}, {
    fetch: async () => {
      requests++
      return new Response('{}')
    },
  })
  try {
    controller.tick()
    controller.setEnabled(false)
    controller.tick()
    assert.equal(resolutions.length, 1)
    controller.setEnabled(true)
    controller.tick()
    assert.equal(resolutions.length, 2)
    resolutions[0]({ ok: true, apiKey: 'old-synthetic' })
    await flush()
    assert.equal(requests, 0)
    controller.tick()
    assert.equal(resolutions.length, 2, 'old finally cannot release the new pending owner')
    resolutions[1]({ ok: true, apiKey: 'new-synthetic' })
    await flush()
    assert.equal(requests, 1)
    controller.setEnabled(false)
    assert.deepEqual(controller.view().footerSegments, [])
    assert.deepEqual(controller.snapshot().windows, [])
    assert.equal(controller.snapshot().state, 'off')
  } finally {
    controller.dispose()
  }
})
