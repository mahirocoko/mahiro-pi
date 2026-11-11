import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { sanitizeRTKReport, type RTKScope, type RTKView, type RTKStatsResult } from './rtk-stats.ts'

type Native = Pick<typeof import('@earendil-works/pi-tui'), 'Text' | 'ScrollView' | 'truncateToWidth'>
export function createRTKPanel(options: {
  native: Native
  theme: () => Theme
  keys: { matches(data: string, action: string): boolean }
  requestRender: () => void
  height: () => number
  project: string
  scope: RTKScope
  fetch: (scope: RTKScope, view: RTKView, signal: AbortSignal) => Promise<RTKStatsResult>
  done: (choice: 'controls' | undefined) => void
}): Component & { dispose(): void } {
  let scope = options.scope
  let view: RTKView = 'overview'
  let snapshot: RTKStatsResult | undefined
  let report: RTKStatsResult | undefined
  let loading = false
  let failed = false
  let closed = false
  let turn = 0
  let controller: AbortController | undefined
  const text = new options.native.Text('', 0, 0)
  const scroll = new options.native.ScrollView(text, { scrollbar: 'hidden', follow: 'none' })
  const changed = () => {
    if (!closed) options.requestRender()
  }
  const fetch = async () => {
    controller?.abort()
    controller = new AbortController()
    const captured = ++turn
    const target = view === 'commands' ? 'commands' : 'overview'
    loading = true
    failed = false
    // Refresh never presents a previous snapshot as fresh evidence.
    if (target === 'commands') report = undefined
    else snapshot = undefined
    changed()
    try {
      const result = await options.fetch(scope, target, controller.signal)
      if (closed || captured !== turn) return
      if (target === 'commands') report = result
      else snapshot = result
    } catch {
      if (closed || captured !== turn) return
      failed = true
      snapshot = report = undefined
    }
    if (closed || captured !== turn) return
    loading = false
    changed()
  }
  const finish = (choice: 'controls' | undefined) => {
    if (closed) return
    closed = true
    turn++
    controller?.abort()
    options.done(choice)
  }
  void fetch()
  return {
    render(width) {
      if (width <= 0) return []
      const theme = options.theme()
      const result = view === 'commands' ? report : snapshot
      const lines: string[] = []
      if (loading) lines.push('Reading RTK tracking…')
      else if (failed)
        lines.push('Access unavailable or changed.', 'Check feature/data and Bash permissions; r retries.')
      else if (!result || result.status !== 'ok') {
        const status = result?.status ?? 'unavailable'
        lines.push(`Statistics unavailable · ${status}`)
        lines.push(
          status === 'missing-binary'
            ? 'Install RTK separately and ensure it is on PATH.'
            : 'No partial data shown. Check RTK and permissions; r retries.',
        )
      } else if (view === 'commands' && result.report !== undefined) {
        lines.push(
          'Original RTK CLI report',
          'Opaque upstream report; proxy sections may be global.',
          'Not Pi-specific or provider billing measurement.',
          '',
          result.report,
        )
      } else if (result.snapshot) {
        const { summary, daily } = result.snapshot
        if (summary.total_commands === 0 && daily.length === 0)
          lines.push(
            'No tracked commands in this scope yet.',
            'RTK tracking is separate from Mahiro’s empty rewrite log.',
          )
        else if (view === 'daily') {
          lines.push('Recent days · estimated output tokens', '')
          for (const row of [...daily].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7))
            lines.push(
              `${row.date}  ·  ${row.commands} commands`,
              `  ${row.saved_tokens.toLocaleString('en-US')} saved  ·  ${row.savings_pct.toFixed(1)}% reduction`,
            )
          if (!daily.length) lines.push('No daily rows supplied by RTK.')
        } else {
          const n = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 })
          lines.push(
            theme.bold(`${n(summary.total_commands)} commands tracked`),
            '',
            theme.fg('success', `${n(summary.total_saved)} estimated output tokens saved`),
            `${summary.avg_savings_pct.toFixed(1)}% output reduction`,
            '',
            `Raw output       ${n(summary.total_input)}`,
            `Filtered output  ${n(summary.total_output)}`,
            '',
            'Estimates: bytes/4, not provider or billed tokens.',
            ...(summary.oversized_excluded > 0
              ? [`${n(summary.oversized_excluded)} oversized commands excluded by RTK`]
              : []),
          )
        }
      }
      if (result && !loading) lines.push('', `Fetched ${result.fetchedAt}`)
      lines.push(
        '',
        'Source: RTK CLI tracking, including other RTK clients.',
        'Not this Pi session; no dollars or provider quota.',
      )
      text.setText(lines.join('\n'))
      const heading = [
        theme.bold(theme.fg('accent', 'RTK · Usage')),
        theme.fg(
          'muted',
          scope === 'all'
            ? 'All RTK projects'
            : `Project · ${sanitizeRTKReport(options.project).replace(/\s+/g, ' ')}`,
        ),
        theme.fg(
          'accent',
          `${view === 'overview' ? '●' : '1'} Overview  ${view === 'daily' ? '●' : '2'} Daily  ${view === 'commands' ? '●' : '3'} CLI report`,
        ),
      ]
      const hints =
        width < 50
          ? ['1/2/3 view · ↑↓ scroll', 'r refresh · p scope · m controls', 'Esc close']
          : ['1/2/3 view · r refresh · p project/all · m controls · ↑↓ scroll · Esc close']
      if (options.height() < 8) {
        heading.splice(1)
        hints.splice(0, hints.length, '1/2/3 view · r/p/m · ↑↓ · Esc')
      }
      const height = Math.max(1, Math.min(20, options.height() - heading.length - hints.length - 1))
      const body = scroll.render(width)
      scroll.updateLayout(body.length, height, changed)
      return [
        ...heading,
        '',
        ...body.slice(scroll.scrollTop, scroll.scrollTop + height),
        ...hints.map((s) => theme.fg('dim', s)),
      ].map((s) => options.native.truncateToWidth(s, width, '…'))
    },
    invalidate() {
      text.invalidate()
    },
    handleInput(data) {
      if (closed) return
      if (options.keys.matches(data, 'tui.select.cancel')) return finish(undefined)
      if (data === 'm') return finish('controls')
      if (options.keys.matches(data, 'tui.select.up')) scroll.scrollBy(-1)
      else if (options.keys.matches(data, 'tui.select.down')) scroll.scrollBy(1)
      else if (data === 'r') {
        void fetch()
      } else if (data === 'p' || data === 's') {
        scope = scope === 'project' ? 'all' : 'project'
        snapshot = report = undefined
        scroll.scrollToStart()
        void fetch()
      } else {
        const next: RTKView | undefined =
          data === '1' || data === 'o'
            ? 'overview'
            : data === '2' || data === 'd'
              ? 'daily'
              : data === '3' || data === 'c'
                ? 'commands'
                : undefined
        if (!next || next === view) return
        const samePendingJSON = loading && view !== 'commands' && next !== 'commands'
        view = next
        scroll.scrollToStart()
        if (samePendingJSON) {
          changed()
          return
        }
        if (!(view === 'commands' ? report : snapshot)) void fetch()
        else {
          // A pending request for the other view must not overwrite this one.
          turn++
          controller?.abort()
          loading = false
          failed = false
        }
      }
      changed()
    },
    dispose() {
      finish(undefined)
    },
  }
}

export async function openRTKPanel(
  ctx: any,
  scope: RTKScope,
  fetch: (scope: RTKScope, view: RTKView, signal: AbortSignal) => Promise<RTKStatsResult>,
) {
  const native = await import('@earendil-works/pi-tui')
  return ctx.ui.custom((screen: any, theme: Theme, keys: any, done: any) =>
    createRTKPanel({
      native,
      theme: () => ctx.ui.theme ?? theme,
      keys,
      requestRender: () => screen.requestRender(),
      height: () => screen.terminal.rows,
      project: ctx.cwd.split(/[\\/]/).pop() ?? 'Current project',
      scope,
      fetch,
      done,
    }),
  )
}
