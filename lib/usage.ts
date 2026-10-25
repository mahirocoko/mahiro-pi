import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { routeLabel, sessionTotals, type Geometry } from './footer.ts'
import { quotaSegments, type quotaController, type QuotaSnapshot } from './quota.ts'
import { text } from './status.ts'
import { registerWorkflowSurface } from './workflow-hub.ts'
import { usageOwner, type UsageOwner, type UsageStoredPreferences } from './usage-owner.ts'
import { UsageStorageError } from './usage-state.ts'

export const USAGE_WIDGET = 'mahiro-usage-status'
export const USAGE_TTL = 10_000
export interface UsageDisplay {
  quota: boolean
  style: 'bar' | 'compact'
}
type Quota = ReturnType<typeof quotaController>
const help = 'Usage: /mh-usage [status [page]|close|off|codex on/off|source pi/codex-cli|bar|compact]'

/** Pure, cache-only snapshot. Public native totals are estimates, not subscription balance. */
export function usageDetails(
  ctx: ExtensionContext,
  quota: QuotaSnapshot,
  display: UsageDisplay,
  contextVisible = true,
): string[] {
  const { stats, context: measuredContext } = sessionTotals()(ctx)
  const context = contextVisible ? measuredContext : undefined
  let subscription = false
  try {
    subscription =
      !!ctx.model &&
      ctx.modelRegistry.isUsingOAuth(ctx.model) &&
      ctx.modelRegistry.getProvider(ctx.model.provider)?.auth?.oauth?.isSubscription === true
  } catch {
    /* Unavailable metadata is not billing evidence. */
  }
  const value = (n: number | undefined) => (n === undefined ? 'unavailable' : n.toLocaleString('en-US'))
  const stale = quota.stale && quota.fetched !== null ? ' (stale)' : ''
  const quotaLabel = quota.source === 'codex-cli' ? 'Codex CLI' : 'Codex'
  const windows = quota.windows.length
    ? quotaSegments(quota.windows, quota.stale).map((segment) => {
        const line = segment.text.replace(/^Codex/, quotaLabel)
        return display.style === 'compact' ? line.replace(/ [▰▱]+/g, '') : line
      })
    : [`${quotaLabel} ${quota.state}`]
  return [
    `Presentation: codex ${display.quota ? 'on' : 'off'} · ${display.style} · style runtime only`,
    `Model: ${text(ctx.model?.provider)}/${text(ctx.model?.id)} · thinking ${text(ctx.thinkingLevel) || 'off'}`,
    ...(routeLabel(ctx) ? [`Route: ${routeLabel(ctx)}`] : []),
    `Session tokens: input ${value(stats.input)} · output ${value(stats.output)}`,
    `Session cache: read ${value(stats.cacheRead)} · write ${value(stats.cacheWrite)}`,
    `Latest assistant cache hit: ${stats.cacheHit === undefined ? 'unavailable' : `${stats.cacheHit.toFixed(1)}%`}`,
    `Session cost: $${stats.cost.toFixed(4)} estimated native total; not a bill${subscription ? ' (current route: subscription)' : ''}`,
    `Context used: ${context?.tokens === undefined || context.tokens === null ? 'unavailable' : value(context.tokens)} / ${value(context?.contextWindow)} tokens · ${context?.percent === undefined || context.percent === null ? 'unavailable' : `${context.percent.toFixed(1)}%`}`,
    `Quota source: ${quota.source === 'codex-cli' ? 'Codex CLI' : quota.source === 'legacy' ? 'selected Pi openai-codex OAuth' : 'unsupported; native-direct quota omitted'}`,
    'Quota is remaining account capacity, not session tokens. Independent P/S windows use actual durations.',
    ...windows,
    `Credits: ${quota.credits ?? 'unavailable'}${stale}; reset credits: ${quota.resetCredits ?? 'unavailable'}${stale}`,
    ...quota.windows.map(
      (window) =>
        `${window.label} resets ${window.reset === null ? 'unavailable' : new Date(window.reset).toISOString()}${stale}`,
    ),
    `Fetched: ${quota.fetched === null ? 'never' : new Date(quota.fetched).toISOString()}${stale}. Absolute limits unavailable.`,
    ...(quota.source === 'codex-cli'
      ? []
      : ['Codex CLI external-auth source: off (explicit /mh-usage codex on to select and save).']),
  ]
}

/** Snapshot pagination is computed by supplied public geometry; resize never reads session/auth. */
export function renderUsagePanel(
  details: readonly string[],
  page: number,
  width: number,
  geometry: Geometry,
): string[] {
  if (width <= 0) return []
  const clean = details.slice(0, 160).map((line) => text(line, 4096))
  const wrapped: string[] = []
  for (let line of clean) {
    while (line) {
      const chunk = geometry.truncateToWidth(line, width, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      if (!chunk) break
      wrapped.push(chunk)
      line = line.slice(chunk.length)
    }
  }
  const pages = Math.max(1, Math.ceil(wrapped.length / 6))
  const summary = clean
    .slice(0, 1)
    .concat(clean.filter((line) => /^Session tokens:|^Codex |^Quota source:/.test(line)))
    .slice(0, 4)
  const body =
    page === 0
      ? summary
      : page <= pages
        ? wrapped.slice((page - 1) * 6, page * 6)
        : [`Page unavailable; choose 1-${pages}.`]
  return [
    `Mahiro Usage · ${page ? `details ${page}/${pages}` : 'summary'}`,
    ...body,
    `/mh-usage status ${page && page < pages ? page + 1 : 1} · ${pages} pages · close · closes 10s`,
  ].map((line) => geometry.truncateToWidth(line, width, '…'))
}

/** One owner per status initializer. Profile selection uses only the closed Root bridge. */
export function initUsage(pi: ExtensionAPI, clock: () => number = () => performance.now()) {
  let active:
    | {
        ctx: ExtensionContext
        quota: Quota
        changed: () => void
        geometry: Geometry
        session: string
        cwd: string
        contextVisible: () => boolean
      }
    | undefined
  let display: UsageDisplay = { quota: true, style: 'bar' }
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let retired = false
  let preferenceOwner: UsageOwner | undefined
  let preferenceRevision: string | undefined
  let preferenceAt = -Infinity
  let automatic = false
  let automaticStopped = false
  let suspended = false
  let preferenceNotice = ''
  const stop = () => {
    if (!active) return
    display = { ...display, quota: false }
    active.quota.setEnabled(false)
  }
  const apply = (stored: UsageStoredPreferences) => {
    const withdrawn = preferenceRevision !== undefined && preferenceRevision !== stored.revision
    preferenceRevision = stored.revision
    preferenceNotice = stored.present
      ? `Profile Codex CLI: ${stored.preferences.codex ? 'on' : 'off'} (saved). Other eligible sessions adopt on their next bounded lifecycle check.`
      : ''
    // A new absence withdraws previously observed proof even after runtime CLI selection.
    // Initial/unchanged absence and explicit runtime Pi remain independent choices.
    if (!stored.present && (automatic || (withdrawn && active?.quota.snapshot().source === 'codex-cli')))
      stop()
    automatic = stored.present
    automaticStopped = false
    if (!stored.present || !active) return
    if (stored.preferences.codex) {
      active.quota.selectSource('codex-cli')
      display = { ...display, quota: true }
    } else stop()
  }
  // Runs inside the existing status lifecycle, before its collector tick. No watcher/producer.
  const syncPreference = (force = false) => {
    if (!active || retired) return
    if (!matches(active.ctx)) {
      stop()
      return
    }
    const now = clock()
    if (!force && now >= preferenceAt && now - preferenceAt < 5_000) return
    preferenceAt = now
    const attachment = active
    const revision = generation
    try {
      const owner = usageOwner(attachment.ctx)
      if (!owner) throw new UsageStorageError('unavailable')
      const stored = owner.read(attachment.ctx)
      if (
        active !== attachment ||
        generation !== revision ||
        !matches(attachment.ctx) ||
        usageOwner(attachment.ctx) !== owner
      )
        return
      const changed = owner !== preferenceOwner || stored.revision !== preferenceRevision
      // Suspension vetoes automatic on, not a newly proved off/withdrawal.
      if (!suspended || (changed && (!stored.present || !stored.preferences.codex))) {
        preferenceNotice = stored.present
          ? `Profile Codex CLI: ${stored.preferences.codex ? 'on' : 'off'} (saved). Other eligible sessions adopt on their next bounded lifecycle check.`
          : ''
        if (changed || (automatic && automaticStopped)) apply(stored)
      }
      preferenceOwner = owner
      // Remember authorized proof even when suspension vetoes automatic ON.
      preferenceRevision = stored.revision
    } catch {
      if (active !== attachment || generation !== revision) return
      if (automatic) {
        stop()
        // Preserve the last valid baseline independently of producer recovery.
        // A later explicit runtime choice cancels this same-revision recovery.
        automaticStopped = true
      }
      preferenceNotice =
        'Profile usage preference unavailable; not saved. Exact usage DATA authority may require an approved installation update.'
    }
  }
  const savePreference = (codex: boolean) => {
    if (!active) return ''
    const attachment = active
    const revision = generation
    const current = () => active === attachment && generation === revision && matches(attachment.ctx)
    // Explicit off always cancels here, including denied/stale/ambiguous saves.
    if (!codex) stop()
    try {
      const owner = usageOwner(attachment.ctx)
      if (!owner) throw new UsageStorageError('unavailable')
      const stored = owner.read(attachment.ctx)
      if (!current() || usageOwner(attachment.ctx) !== owner) return 'Usage selection changed; not saved.'
      preferenceOwner = owner
      preferenceRevision = stored.revision
      const saved = owner.save(attachment.ctx, stored.ticket, { codex })
      if (!current() || usageOwner(attachment.ctx) !== owner)
        return 'Usage selection changed; inspect the saved profile preference.'
      suspended = false
      apply(saved)
      return preferenceNotice
    } catch (error) {
      if (!current()) return 'Usage selection changed; persistence not confirmed.'
      stop() // Failed on never implicitly authorizes external collection.
      suspended = true // An uncertain publication cannot enable this session on a later reread.
      const detail =
        error instanceof UsageStorageError
          ? error.message
          : 'Usage storage unavailable; preferences not saved.'
      preferenceNotice = `${detail} ${codex ? 'Codex CLI not enabled.' : 'Off here; not confirmed saved profile-wide.'} An approved installation update may be required for exact usage DATA authority. No automatic retry.`
      return preferenceNotice
    }
  }
  const close = () => {
    generation++
    if (timer) clearTimeout(timer)
    timer = undefined
    active?.ctx.ui.setWidget(USAGE_WIDGET, undefined)
  }
  const matches = (ctx: ExtensionContext) =>
    !!active &&
    ctx.mode === 'tui' &&
    ctx.sessionManager === active.ctx.sessionManager &&
    ctx.sessionManager.getSessionId() === active.session &&
    ctx.cwd === active.cwd
  // Before-events may be cancelled. Only dismiss the snapshot, not its attachment.
  const dismiss = (_event: unknown, ctx: ExtensionContext) => {
    if (!retired && matches(ctx)) close()
  }
  pi.on('session_before_switch', dismiss)
  pi.on('session_before_fork', dismiss)
  pi.on('session_before_tree', dismiss)
  pi.on('session_tree', (_event, ctx) => {
    close()
    if (retired || !matches(ctx)) active = undefined
    else if (active) {
      active.quota.invalidate()
      active.ctx = ctx
      preferenceRevision = undefined
      syncPreference(true)
    }
  })
  pi.on('session_shutdown', () => {
    retired = true
    close()
    active = undefined
  })
  const handler = async (raw: string, ctx: ExtensionCommandContext) => {
    if (retired || !active || !matches(ctx)) return
    close()
    const args = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (args === 'close') return
    let page = 0
    let notice = ''
    const match = args.match(/^status(?:\s+([1-9]\d{0,3}))?$/)
    if (!args || match) page = Number(match?.[1] ?? 0)
    else if (args === 'off' || args === 'codex off') {
      notice = savePreference(false)
    } else if (args === 'codex on') {
      notice = savePreference(true)
    } else if (args === 'source codex-cli' || args === 'source pi') {
      automatic = false // Advanced runtime selection is not profile-persistence intent.
      automaticStopped = false
      active.quota.selectSource(args === 'source pi' ? 'pi' : 'codex-cli')
      display = { ...display, quota: active.quota.snapshot().source !== 'unsupported' }
    } else if (args === 'bar' || args === 'compact') display = { ...display, style: args }
    else notice = help
    active.changed()
    const snapshot = usageDetails(ctx, active.quota.snapshot(), display, active.contextVisible())
    if (notice || preferenceNotice) snapshot.unshift(notice || preferenceNotice)
    const geometry = active.geometry
    const revision = generation
    ctx.ui.setWidget(
      USAGE_WIDGET,
      (_tui, theme) => ({
        render: (width) =>
          renderUsagePanel(snapshot, page, width, geometry).map((line, i) =>
            theme.fg(i === 0 ? 'accent' : 'muted', line),
          ),
        invalidate() {},
      }),
      { placement: 'aboveEditor' },
    )
    timer = setTimeout(() => {
      if (generation === revision) close()
    }, USAGE_TTL)
    timer.unref?.()
  }
  pi.registerCommand('mh-usage', {
    description:
      'Cached usage; codex on/off saves profile-wide Codex CLI selection; runtime source/style controls',
    handler,
  })
  registerWorkflowSurface(pi, { id: 'usage', label: 'Usage', open: (ctx) => handler('status', ctx) })
  return {
    handler,
    display: () => ({ ...display }),
    syncPreference,
    attach(
      ctx: ExtensionContext,
      quota: Quota,
      changed: () => void,
      geometry: Geometry,
      contextVisible = () => true,
    ) {
      if (retired) return
      close()
      display = { quota: quota.snapshot().source === 'legacy', style: 'bar' }
      active = {
        ctx,
        quota,
        changed,
        geometry,
        session: ctx.sessionManager.getSessionId(),
        cwd: ctx.cwd,
        contextVisible,
      }
      preferenceOwner = undefined
      preferenceRevision = undefined
      preferenceAt = -Infinity
      automatic = false
      automaticStopped = false
      suspended = false
      preferenceNotice = ''
      syncPreference(true)
    },
    dispose() {
      close()
      active = undefined
    },
  }
}
