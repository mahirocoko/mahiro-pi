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
  paint,
  type FooterState,
  type Segment,
} from '../lib/footer.ts'
import {
  parseQuota,
  quotaController,
  SUCCESS_TTL,
  STALE_BOUND,
  quotaSegments,
  quotaFooterSegments,
} from '../lib/quota.ts'
import { start, text } from '../lib/status.ts'

const plain = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
const graphemes = (value: string) =>
  Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(value), (s) => s.segment)
const widthOf = (value: string) =>
  graphemes(plain(value)).reduce((n, g) => n + (/\p{Extended_Pictographic}/u.test(g) ? 2 : 1), 0)
const geometry = {
  visibleWidth: widthOf,
  truncateToWidth(value: string, width: number, ellipsis = '') {
    let result = ''
    const source = plain(value)
    const limit = widthOf(source) > width ? Math.max(0, width - widthOf(ellipsis)) : width
    for (const g of graphemes(source)) {
      if (widthOf(result + g) > limit) break
      result += g
    }
    return result + (widthOf(source) > width && widthOf(ellipsis) <= width ? ellipsis : '') + '\x1b[0m' // Pi emits a reset too.
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

test('Git numeric line totals are distinct green/red cells; untracked remains a file count', () => {
  const f = fixture()
  f.state.git += ' added:247 deleted:89'
  const first = renderFooter(f.ctx, {}, f.data, f.state, 160, geometry)[0]
  assert.match(plain(first), /🌿 main \?2 ~1 ↑3 ↓4 \| \+247 \| −89/)
  assert.ok(first.includes('\x1b[38;2;82;196;125m+247\x1b[0m'))
  assert.ok(first.includes('\x1b[38;2;235;111;119m−89\x1b[0m'))
  f.state.git = 'git dirty:1 ?:247'
  const unknown = plain(renderFooter(f.ctx, {}, f.data, f.state, 160, geometry)[0])
  assert.match(unknown, /\?247/)
  assert.doesNotMatch(unknown, /\+247|−0|\+0/)
})

test('context USED and quota LEFT ten-cell bars have independent endpoints and rounding', () => {
  const f = fixture()
  for (const [percent, filled] of [
    [0, 0],
    [100, 10],
    [24.9, 2],
    [25, 3],
    [84, 8],
  ]) {
    f.ctx.getContextUsage = () => ({ percent })
    const quota = quotaFooterSegments([{ label: 'P:7d', remaining: 100 - percent, reset: null }], false)
    const state = { ...f.state, quota: quota.expanded, quotaCompact: quota.compact }
    const all = renderFooter(f.ctx, {}, f.data, state, 160, geometry).map(plain).join('\n')
    assert.ok(all.includes(`ctx ${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${percent.toFixed(1)}%`))
    const quotaFilled = Math.round(Math.round(100 - percent) / 10)
    assert.ok(
      all.includes(
        `Codex Weekly ${'▰'.repeat(quotaFilled)}${'▱'.repeat(10 - quotaFilled)} ${Math.round(100 - percent)}%`,
      ),
    )
    assert.deepEqual(
      all.match(/[▰▱]+/g)?.map((bar) => bar.length),
      [10, 10],
    )
  }
  f.ctx.getContextUsage = () => undefined
  const unknown = renderFooter(f.ctx, {}, f.data, f.state, 160, geometry).map(plain).join('\n')
  assert.match(unknown, /ctx \?/)
  assert.doesNotMatch(unknown, /[▰▱]|0\.0%/)
})

test('restrained highlights paint generated counts and suffix only, never lookalike names', () => {
  const f = fixture()
  const name = '?2 ~1 medium | ▱ กิשלום👩🏽‍💻'
  f.ctx.model.name = name
  f.data.getGitBranch = () => name
  f.ctx.getContextUsage = () => ({ percent: 84 })
  const quota = quotaFooterSegments([{ label: 'P:7d', remaining: 84, reset: null }], false)
  const state = { ...f.state, quota: quota.expanded, quotaCompact: quota.compact }
  const rows = renderFooter(f.ctx, {}, f.data, state, 160, geometry)
  assert.ok(rows[0].includes(paint(`🌿 ${name} `, COLORS.dirty)))
  assert.ok(rows[0].includes(paint(name, COLORS.dirty)))
  for (const count of ['?2', '~1']) {
    assert.ok(rows[0].includes(paint(count, COLORS.label)))
    assert.ok(!rows[0].includes(paint(count, COLORS.dirty)))
  }
  assert.ok(rows[0].includes(paint(' ↑3 ↓4', COLORS.dirty)))
  assert.ok(rows[0].includes(paint(' | ', COLORS.separator) + paint('medium', COLORS.label)))
  assert.ok(!rows[0].includes(paint('medium', COLORS.dirty)))
  assert.ok(!rows[0].includes(paint('▱', COLORS.label)), 'lookalike glyph in names keeps accent')
  assert.ok(rows[1].includes(paint('ctx ▰▰▰▰▰▰▰▰', COLORS.dirty)))
  assert.ok(rows[1].includes(paint('Codex Weekly ▰▰▰▰▰▰▰▰', COLORS.git)))
  assert.equal(rows[1].split(paint('▱▱', COLORS.label)).length - 1, 2)
  assert.ok(!rows[1].includes(paint('▱▱', COLORS.separator)))
  assert.ok(!rows[1].includes(paint('▱▱', COLORS.dirty)))
  assert.ok(!rows[1].includes(paint('▱▱', COLORS.git)))
  assert.deepEqual(
    quota.expanded,
    quotaFooterSegments([{ label: 'P:7d', remaining: 84, reset: null }], false).expanded,
  )
  f.state.git = 'git ahead:3 behind:4'
  const clean = renderFooter(f.ctx, {}, f.data, f.state, 160, geometry)[0]
  assert.ok(clean.includes(paint(`🌿 ${name} ↑3 ↓4`, COLORS.git)))
})

test('empty-bar paint leaves filled thresholds, stale and compact projections unchanged', () => {
  const f = fixture()
  for (const [percent, color] of [
    [25, COLORS.context],
    [84, COLORS.dirty],
    [94, COLORS.error],
  ] as const) {
    f.ctx.getContextUsage = () => ({ percent })
    const row = renderFooter(f.ctx, {}, f.data, f.state, 160, geometry)[1]
    const filled = Math.round(percent / 10)
    assert.ok(row.includes(paint(`ctx ${'▰'.repeat(filled)}`, color)))
    if (filled < 10) assert.ok(row.includes(paint('▱'.repeat(10 - filled), COLORS.label)))
  }
  for (const [remaining, color] of [
    [10, COLORS.error],
    [40, COLORS.dirty],
    [84, COLORS.git],
  ] as const) {
    for (const stale of [false, true]) {
      const quota = quotaFooterSegments([{ label: 'P:7d', remaining, reset: null }], stale)
      const state = { ...f.state, quota: quota.expanded, quotaCompact: quota.compact }
      const row = renderFooter(f.ctx, {}, f.data, state, 160, geometry)[1]
      const filled = Math.round(remaining / 10)
      assert.ok(row.includes(paint(`Codex Weekly ${'▰'.repeat(filled)}`, stale ? COLORS.label : color)))
      assert.ok(row.includes(paint('▱'.repeat(10 - filled), COLORS.label)))
      const compact = renderFooter(
        f.ctx,
        {},
        f.data,
        {
          ...state,
          usageDisplay: { quota: true, style: 'compact' },
        },
        160,
        geometry,
      )[1]
      assert.ok(
        compact.includes(
          paint(`Codex Weekly ${remaining}%${stale ? ' stale' : ''}`, stale ? COLORS.label : color),
        ),
      )
    }
  }
})

test('highlighted cells preserve plain geometry, sanitization and semantics at widths 1..160', () => {
  const f = fixture()
  f.ctx.model.name = 'กิשלום👩🏽‍💻 medium ?2 ~1 \x1b[31mname\x1b[0m\n\u202e'
  f.data.getGitBranch = () => 'กิשלום👩🏽‍💻 ?2 ~1 \x1b[31mbranch\x1b[0m\n\u2066'
  f.data.getExtensionStatuses = () => new Map([['other', 'NekoStack ▱ medium ?2 ~1']])
  for (const percent of [undefined, 0, 25, 84, 100]) {
    f.ctx.getContextUsage = () => (percent === undefined ? undefined : { percent })
    for (const stale of [false, true]) {
      const quota = quotaFooterSegments([{ label: 'P:7d', remaining: 84, reset: null }], stale)
      for (const style of ['bar', 'compact'] as const) {
        const state = {
          ...f.state,
          quota: quota.expanded,
          quotaCompact: quota.compact,
          usageDisplay: { quota: true, style },
        }
        for (let width = 1; width <= 160; width++) {
          const rows = renderFooter(f.ctx, {}, f.data, state, width, geometry)
          assert.ok(
            rows.every((row) => widthOf(row) <= width),
            `width ${width}`,
          )
          const visible = rows.map(plain).join('\n')
          assert.doesNotMatch(visible, /\x1b|\u202e|\u2066|�/)
          assert.ok(!rows.join('').includes('\x1b[31m'), 'source ANSI is sanitized before painting')
          if (width >= 80) {
            assert.ok(visible.includes('NekoStack ▱ medium ?2 ~1'))
            assert.ok(
              visible.includes(
                `Codex Weekly ${style === 'bar' ? '▰▰▰▰▰▰▰▰▱▱ ' : ''}84%${stale ? ' stale' : ''}`,
              ),
            )
            assert.ok(visible.includes(percent === undefined ? 'ctx ?' : `${percent.toFixed(1)}%`))
          }
        }
      }
    }
  }
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

test('minimal core rows retain native input/output, context semantics, palette and status ownership', () => {
  const f = fixture()
  f.data.getExtensionStatuses = () =>
    new Map([
      ['other', 'another extension'],
      ['mahiro-status', 'DUPLICATE'],
      ['mahiro-rtk', 'RTK rewrite-rtk'],
    ])
  const rows = renderFooter(f.ctx, {}, f.data, f.state, 160, geometry)
  const all = rows.map(plain).join('\n')
  assert.equal(rows.length, 3, 'two core rows plus the other extension')
  for (const fragment of [
    '🌿 main ?2 ~1 ↑3 ↓4',
    'gpt-6.1-sol | medium',
    'ctx ▱▱▱▱▱▱▱▱▱▱ 0.0%',
    '↑10 ↓3',
    'RTK rewrite-rtk',
    'another extension',
  ])
    assert.ok(all.includes(fragment), fragment)
  for (const removed of [
    '/synthetic/',
    'ชื่อเซสชัน',
    'read',
    'Pi',
    'openai',
    '/272k',
    '(auto)',
    'R20',
    'W2',
    'CH62.5%',
    '$0.001',
    'DUPLICATE',
  ])
    assert.ok(!all.includes(removed), removed)
  assert.equal(all.split('RTK rewrite-rtk').length - 1, 1)
  assert.equal(all.split('another extension').length - 1, 1)
  assert.match(rows[0], /\x1b\[38;2;140;140;249m/)
  assert.deepEqual(COLORS, {
    folder: '#8C8CF9',
    git: '#64CF64',
    diffAdded: '#52C47D',
    diffRemoved: '#EB6F77',
    dirty: '#FEE19C',
    activity: '#20B2AA',
    context: '#BEBEEE',
    separator: '#46484A',
    label: '#A5A8AB',
    error: '#F1689F',
  })
  f.ctx.modelRegistry = new Proxy(
    {},
    {
      get() {
        throw new Error('footer must not inspect auth')
      },
    },
  )
  renderFooter(f.ctx, {}, f.data, f.state, 160, geometry)
})

test('semantic rows, narrow fallback, unknown/hidden context and explicit compaction warning', () => {
  const f = fixture()
  f.data.getExtensionStatuses = () => new Map()
  for (const width of [40, 60, 80, 120, 160]) {
    const rows = renderFooter(f.ctx, {}, f.data, f.state, width, geometry)
    assert.equal(rows.length, width < 80 ? 3 : 2)
    assert.ok(
      rows.every((row) => geometry.visibleWidth(row) <= width),
      `${width}: overflow`,
    )
    assert.ok(plain(rows[0]).includes('งานไทย👩🏽‍💻'))
    assert.ok(plain(rows[width < 80 ? 1 : 0]).includes('gpt-6.1-sol | medium'))
    assert.ok(rows.map(plain).join('\n').includes('ctx ▱▱▱▱▱▱▱▱▱▱ 0.0%'))
    if (width >= 80) assert.ok(plain(rows[1]).includes('↑10 ↓3'))
    if (width < 80) assert.ok(plain(rows[0]).includes('🌿 main'))
  }
  f.ctx.getContextUsage = () => ({ percent: null, contextWindow: 272000 })
  assert.match(renderFooter(f.ctx, {}, f.data, f.state, 80, geometry).map(plain).join('\n'), /ctx \?/)
  f.ctx.getContextUsage = () => ({ percent: 72, contextWindow: 272000 })
  f.state.hideContext = true
  assert.match(renderFooter(f.ctx, {}, f.data, f.state, 80, geometry).map(plain).join('\n'), /ctx \?/)
  f.state.hideContext = false
  f.ctx.model = { ...f.ctx.model, id: 'long-model-'.repeat(30) }
  for (const width of [1, 2, 4, 8, 12, 20, 40, 60, 80, 120, 160]) {
    const rows = renderFooter(f.ctx, { compaction: { enabled: false } }, f.data, f.state, width, geometry)
    assert.ok(rows.length >= 2)
    assert.ok(
      rows.every((row) => geometry.visibleWidth(row) <= width),
      `${width}: overflow`,
    )
    if (width >= 12) assert.ok(rows.map(plain).join('\n').includes('auto off'), `${width}: warning`)
    if (width >= 20) assert.ok(rows.map(plain).join('\n').includes('long'), `${width}: identity`)
  }
  assert.deepEqual(renderFooter(f.ctx, {}, f.data, f.state, 0, geometry), [])
})

test('public geometry preserves Unicode pack round-trip and sanitizes core control input', () => {
  const f = fixture()
  const value = 'กิ👩🏽‍💻שלום'.repeat(30)
  const rows = pack([{ text: value, color: COLORS.folder }], 4, geometry)
  assert.equal(rows.map(plain).join(''), value)
  assert.equal(text('กิ👩🏽‍💻', 1), 'กิ')
  assert.equal(text('\x1b[31mred\x1b[0m'), 'red')
  f.ctx.cwd = '/synthetic/' + value + '\n\x1b[31mbad'
  f.ctx.model.name = value + '\r\x1b[2J'
  f.data.getGitBranch = () => value + '\t\x1b[31m'
  for (const width of [1, 4, 20, 40, 80, 160]) {
    const output = renderFooter(f.ctx, {}, f.data, f.state, width, geometry)
    assert.ok(output.every((row) => widthOf(row) <= width))
    assert.ok(output.every((row) => !/[\x00-\x1f]/.test(plain(row))))
  }
})

test('ctx precedes quota inline when wide; real 48-column fallback retains bars, percentages and native metrics', () => {
  const f = fixture()
  f.ctx.getContextUsage = () => ({ percent: 41.2 })
  f.data.getExtensionStatuses = () => new Map([['mahiro-rtk', 'RTK rewrite-rtk']])
  const quota = quotaFooterSegments([{ label: 'P:7d', remaining: 84, reset: null }], false)
  const state: FooterState = { ...f.state, quota: quota.expanded, quotaCompact: quota.compact }
  const wide = renderFooter(f.ctx, {}, f.data, state, 160, geometry).map(plain)
  assert.equal(wide.length, 2)
  assert.match(wide[0], /งานไทย👩🏽‍💻 \| 🌿 main/)
  assert.match(wide[0], /gpt-6.1-sol \| medium$/)
  assert.match(wide[1], /^ctx ▰▰▰▰▱▱▱▱▱▱ 41\.2% \| Codex Weekly ▰▰▰▰▰▰▰▰▱▱ 84% \| ↑10 ↓3 \| RTK rewrite-rtk$/)
  const narrow = renderFooter(f.ctx, {}, f.data, state, 48, geometry).map(plain)
  assert.ok(narrow.includes('ctx ▰▰▰▰▱▱▱▱▱▱ 41.2%'))
  assert.ok(narrow.some((row) => row.startsWith('Codex Weekly ▰▰▰▰▰▰▰▰▱▱ 84%')))
  assert.ok(narrow.some((row) => row.includes('↑10 ↓3')))
  assert.ok(narrow.some((row) => row.includes('RTK rewrite-rtk')))
  assert.ok(narrow.every((row) => widthOf(row) <= 48))
  for (const width of [1, 4, 20, 40, 80, 160]) {
    const rows = renderFooter(f.ctx, {}, f.data, state, width, geometry)
    assert.ok(rows.every((row) => widthOf(row) <= width))
    if (width >= 20) assert.ok(rows.map(plain).join('\n').includes('84%'))
    if (width === 20) assert.ok(rows.map(plain).join('\n').includes('Codex Weekly 84%'))
  }
  state.usageDisplay = { quota: false, style: 'bar' }
  assert.doesNotMatch(renderFooter(f.ctx, {}, f.data, state, 160, geometry).map(plain).join('\n'), /Codex/)
  state.usageDisplay.quota = true
  state.quota = [{ text: 'Codex CLI unavailable | sign-in denied', color: COLORS.label }]
  state.quotaCompact = state.quota
  const unavailable = renderFooter(f.ctx, {}, f.data, state, 48, geometry).map(plain).join('\n')
  assert.match(unavailable, /Codex CLI unavailable \| sign-in denied/)
  assert.doesNotMatch(unavailable, /Codex.*0%/)
})

test('route label requires virtual selection plus successful active-branch evidence', () => {
  const f = fixture()
  assert.equal(routeLabel(f.ctx), '')
  f.ctx.model.api = 'pi-virtual'
  assert.equal(routeLabel(f.ctx), '→ openai/gpt')
  assert.ok(
    renderFooter(f.ctx, {}, f.data, f.state, 80, geometry).map(plain).join('\n').includes('→ openai/gpt'),
  )
  f.entries.push({
    type: 'message',
    message: { role: 'assistant', model: 'wrong', provider: 'wrong', stopReason: 'error' },
  })
  assert.equal(routeLabel(f.ctx), '→ openai/gpt')
  f.entries.push({ type: 'model_change', modelId: 'new' })
  assert.equal(routeLabel(f.ctx), '→ route unknown')
  assert.ok(
    renderFooter(f.ctx, {}, f.data, f.state, 40, geometry).map(plain).join('\n').includes('→ route unknown'),
  )
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
  assert.equal(requests, 1, 'unpainted activity changes must not repaint')
  footer.render(100)
  footer.changed()
  assert.equal(requests, 1)
  // Quota staleness and context come from time/host state, not status events.
  quota = quotaSegments([{ label: 'P:7d', remaining: 59, reset: null }], true)
  footer.changed()
  assert.equal(requests, 2)
  footer.render(100)
  f.ctx.getContextUsage = () => ({ tokens: 1, percent: 42, contextWindow: 272000 })
  footer.changed()
  assert.equal(requests, 3)
  footer.render(80)
  footer.changed()
  assert.equal(requests, 3, 'comparison uses the last painted width')
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
  assert.equal(requests, 4, 'a footer that cannot be compared still repaints')
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
  assert.match(paint(), /ctx ▰▰▰▰▰▰▱▱▱▱ 55\.0%/)
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
