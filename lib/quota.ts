import { createHash } from 'node:crypto'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { COLORS, type Segment } from './footer.ts'

export const SUCCESS_TTL = 120_000
export const STALE_BOUND = 300_000
export const QUOTA_KEYS = [1, 2].flatMap((i) =>
  ['ok', 'warn', 'critical'].map((s) => `mahiro_sidebar_q${i}_${s}`),
)
export interface Window {
  label: string
  remaining: number
  reset: number | null
}
class QuotaFailure extends Error {
  readonly code: string
  constructor(code: string) {
    super('Quota unavailable')
    this.code = code
  }
}
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
export function parseQuota(payload: unknown): Window[] {
  const data = object(payload)
  const limits = [
    { label: '', rate: data.rate_limit },
    ...(Array.isArray(data.additional_rate_limits)
      ? data.additional_rate_limits.slice(0, 30).map((item, i) => {
          const limit = object(item)
          const name = limit.limit_name ?? limit.metered_feature
          return {
            label:
              typeof name === 'string'
                ? name
                    .replace(/[^a-zA-Z0-9 ._:/()-]/g, ' ')
                    .slice(0, 64)
                    .trim()
                : `Additional ${i + 1}`,
            rate: limit.rate_limit,
          }
        })
      : []),
    { label: 'Code review', rate: data.code_review_rate_limit },
  ]
  const windows: Window[] = []
  for (const limit of limits)
    for (const [key, prefix] of [
      ['primary_window', 'P'],
      ['secondary_window', 'S'],
    ]) {
      const value = object(object(limit.rate)[key])
      const used = value.used_percent,
        seconds = value.limit_window_seconds,
        reset = value.reset_at
      if (!number(used) || used < 0 || used > 100 || !number(seconds) || seconds <= 0) continue
      const duration =
        seconds % 86400 === 0
          ? `${seconds / 86400}d`
          : seconds % 3600 === 0
            ? `${seconds / 3600}h`
            : `${seconds}s`
      windows.push({
        label: `${limit.label ? `${limit.label} ` : ''}${prefix}:${duration}`,
        remaining: 100 - used,
        reset: number(reset) && reset > 0 && reset < 8.64e12 ? reset * 1000 : null,
      })
    }
  return windows
}
export const severity = (remaining: number) => (remaining < 20 ? 'critical' : remaining < 50 ? 'warn' : 'ok')
const tone = (remaining: number) =>
  remaining < 20 ? COLORS.error : remaining < 50 ? COLORS.dirty : COLORS.git
export function quotaSegments(windows: Window[], stale: boolean): Segment[] {
  return windows.map((window) => {
    const percent = Math.round(window.remaining),
      filled = Math.round((percent / 100) * 8)
    const reset =
      window.reset === null
        ? ''
        : ` resets ${new Date(window.reset).toISOString().slice(5, 16).replace('T', ' ')}Z`
    return {
      text: `Codex ${window.label} ${'▰'.repeat(filled)}${'▱'.repeat(8 - filled)} ${percent}% left${stale ? ' stale' : ''}${reset}`,
      color: stale ? COLORS.label : tone(window.remaining),
    }
  })
}

export interface QuotaView {
  segments: Segment[]
  tokens: Record<string, string>
}
export function quotaController(
  ctx: Pick<ExtensionContext, 'model' | 'modelRegistry' | 'sessionManager'>,
  changed: () => void,
  options: { now?: () => number; fetch?: typeof fetch } = {},
) {
  const now = options.now ?? Date.now,
    request = options.fetch ?? fetch
  let alive = true,
    generation = 0,
    identity = '',
    account = '',
    fetched = -Infinity,
    retry = -Infinity,
    failures = 0
  let windows: Window[] = [],
    failed = false,
    pending = false,
    denied = false
  let abort: AbortController | undefined
  let state = 'unavailable'
  let expectedModel = ''
  function reset(next: string) {
    identity = next
    account = ''
    windows = []
    fetched = retry = -Infinity
    failures = 0
    failed = false
    denied = false
    generation++
    abort?.abort()
    state = 'unavailable'
    changed()
  }
  function view(): QuotaView {
    if (state === 'native-direct') return { segments: [], tokens: {} }
    if (denied)
      return {
        segments: [{ text: 'OpenAI subscription · quota unavailable for this sign-in', color: COLORS.label }],
        tokens: {},
      }
    const age = now() - fetched
    if (!windows.length || age > STALE_BOUND)
      return { segments: [{ text: `Codex ${state}`, color: COLORS.label }], tokens: {} }
    const expired = windows.some((w) => w.reset !== null && w.reset <= now())
    const stale = failed || age >= SUCCESS_TTL || expired
    const tokens: Record<string, string> = {}
    if (!stale)
      windows
        .filter((w) => /^[PS]:/.test(w.label) && w.reset !== null && w.reset > now() + 35_000)
        .slice(0, 2)
        .forEach((w, i) => {
          tokens[`mahiro_sidebar_q${i + 1}_${severity(w.remaining)}`] =
            `Codex ${w.label} ${Math.round(w.remaining)}% left`
        })
    return { segments: quotaSegments(windows, stale), tokens }
  }
  function tick() {
    if (!alive) return
    const model = ctx.model
    if (expectedModel && expectedModel !== JSON.stringify([model?.provider, model?.id])) return
    expectedModel = ''
    let next: string
    let supported = false
    let nativeDirect = false
    try {
      const status = model ? ctx.modelRegistry.getProviderAuthStatus(model.provider) : undefined
      const oauth = !!model && !!status?.configured && ctx.modelRegistry.isUsingOAuth(model)
      nativeDirect =
        !!model &&
        model.provider === 'openai' &&
        oauth &&
        ctx.modelRegistry.getProvider(model.provider)?.auth?.oauth?.isSubscription === true
      supported = !!model && model.provider === 'openai-codex' && oauth
      next = JSON.stringify([
        ctx.sessionManager.getSessionId(),
        model?.provider,
        model?.id,
        status,
        supported,
        nativeDirect,
      ])
    } catch {
      next = 'unavailable'
    }
    if (identity !== next) reset(next)
    // Native Pi 1.3 direct-token OAuth targets api.openai.com/v1. It is not a
    // Codex legacy grant: wham rejects it (401). Omit unavailable native quota,
    // including fallback links, auth resolution, probes and borrowed accounts.
    if (nativeDirect) {
      state = 'native-direct'
      return
    }
    if (!supported || !model) {
      state = 'unsupported (current provider/auth)'
      return
    }
    if (pending) return
    pending = true
    const revision = generation
    const controller = (abort = new AbortController())
    const timeout = setTimeout(() => controller.abort(), 5000)
    timeout.unref?.()
    const valid = () => alive && generation === revision && !controller.signal.aborted
    let authenticated = false
    const operation = async () => {
      // Public request-time auth only. No auth files, external caches, fallback
      // accounts, provider mutation or model calls. Resolve each poll to notice
      // same-provider account replacement even when AuthStatus is unchanged.
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
      if (!valid()) return
      if (!auth.ok || !ctx.modelRegistry.isUsingOAuth(model)) throw new QuotaFailure('auth')
      const headers = new Headers()
      for (const [key, value] of Object.entries(auth.headers ?? {})) {
        if (typeof value === 'string') headers.set(key, value)
      }
      const token = auth.apiKey ?? headers.get('authorization')?.replace(/^Bearer /i, '')
      if (!token) throw new QuotaFailure('missing bearer')
      let accountId = headers.get('chatgpt-account-id')
      if (!accountId) {
        try {
          // Same JWT claim used by Pi's OpenAI Codex request adapter. This is
          // routing metadata, not token verification; never log/store payload.
          const claim = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
          const value = claim?.['https://api.openai.com/auth']?.chatgpt_account_id
          if (typeof value === 'string' && value.length <= 256 && !/[\x00-\x20\x7f]/.test(value))
            accountId = value
        } catch {
          /* Opaque native OAuth uses its credential-scoped default. */
        }
      }
      // The current native OpenAI OAuth flow can return an opaque bearer with
      // no account claim/header. Match native request routing: omit the optional
      // selector, never invent/borrow an account from another credential store.
      const fingerprint = createHash('sha256')
        .update(token)
        .update(accountId ?? '')
        .digest('hex')
      if (account !== fingerprint) {
        account = fingerprint
        windows = []
        fetched = retry = -Infinity
        failed = false
        denied = false
        failures = 0
        changed()
      }
      authenticated = true
      if (denied) return
      if (now() < retry || (now() - fetched < SUCCESS_TTL && !failed)) return
      // Only allowlisted headers go to the fixed allowlisted endpoint.
      const response = await request('https://chatgpt.com/backend-api/wham/usage', {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
          Accept: 'application/json',
        },
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response.ok) throw new QuotaFailure(`HTTP ${response.status}`)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('unavailable')
      let body = '',
        bytes = 0
      const decoder = new TextDecoder()
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.byteLength
          if (bytes > 262144) throw new Error('unavailable')
          body += decoder.decode(chunk.value, { stream: true })
        }
        const parsed = parseQuota(JSON.parse(body + decoder.decode()))
        if (!valid()) return
        windows = parsed
        fetched = now()
        failed = false
        failures = 0
        retry = now() + SUCCESS_TTL
        state = parsed.length ? 'unavailable' : 'unavailable (no quota windows)'
        changed()
      } finally {
        await reader.cancel().catch(() => {})
      }
    }
    // Public auth resolution does not accept a signal. Race its result as well
    // as fetch; late resolutions cannot start requests or update the generation.
    const cancelled = new Promise<void>((resolve) =>
      controller.signal.addEventListener('abort', () => resolve(), { once: true }),
    )
    const work = operation().finally(() => {
      pending = false
    })
    void Promise.race([work, cancelled])
      .catch((error) => {
        if (alive && generation === revision) {
          if (error instanceof QuotaFailure && ['HTTP 401', 'HTTP 403'].includes(error.code)) {
            denied = true
            windows = []
            fetched = -Infinity
          }
          if (!authenticated) {
            windows = []
            account = ''
          }
          failed = true
          state = `unavailable (${error instanceof QuotaFailure ? error.code : 'request failed'})`
          retry = now() + Math.min(120000, 30000 * 2 ** Math.min(failures++, 2))
          changed()
        }
      })
      .finally(() => {
        clearTimeout(timeout)
        if (alive && generation === revision && controller.signal.aborted) {
          if (!authenticated) {
            windows = []
            account = ''
          }
          failed = true
          state = 'unavailable'
          retry = now() + 30000
          changed()
        }
      })
  }
  return {
    tick,
    view,
    invalidate(model?: { id: string; provider: string }) {
      reset('')
      expectedModel = model ? JSON.stringify([model.provider, model.id]) : ''
    },
    dispose() {
      alive = false
      generation++
      abort?.abort()
      windows = []
      account = ''
    },
  }
}
