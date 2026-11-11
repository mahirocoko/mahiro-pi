import assert from 'node:assert/strict'
import test from 'node:test'
import { createRTKPanel } from '../lib/rtk-panel.ts'
import type { RTKStatsResult } from '../lib/rtk-stats.ts'

const native = await import('@earendil-works/pi-tui')
const theme: any = { fg: (_: string, s: string) => s, bold: (s: string) => s }
const result = (scope = 'project'): RTKStatsResult => ({
  scope: scope as any,
  view: 'overview',
  source: 'RTK',
  fetchedAt: '2026-11-11T00:00:00Z',
  status: 'ok',
  snapshot: {
    summary: {
      total_commands: 1,
      total_input: 1200,
      total_output: 200,
      total_saved: 1000,
      avg_savings_pct: 83.33,
      total_time_ms: 6,
      avg_time_ms: 6,
      oversized_excluded: 1,
    },
    daily: [
      {
        date: '2026-11-11',
        commands: 1,
        input_tokens: 1200,
        output_tokens: 200,
        saved_tokens: 1000,
        savings_pct: 83.33,
        total_time_ms: 6,
        avg_time_ms: 6,
      },
    ],
  },
})
const tick = () => new Promise<void>((r) => setImmediate(r))
function panel(fetch: any, options: Record<string, any> = {}) {
  const choices: any[] = []
  let renders = 0
  const component = createRTKPanel({
    native,
    theme: () => theme,
    keys: {
      matches: (data, action) =>
        data ===
        ({ 'tui.select.cancel': 'ESC', 'tui.select.up': 'UP', 'tui.select.down': 'DOWN' } as any)[action],
    },
    requestRender: () => {
      renders++
    },
    height: () => 30,
    project: '日本語 ภาษาไทย long project name',
    scope: 'project',
    fetch,
    done: (choice) => choices.push(choice),
    ...options,
  })
  return {
    component,
    choices,
    renders: () => renders,
    text: (width = 80) => component.render(width).join('\n'),
  }
}

test('native usage hierarchy, shared JSON, explicit report, refresh/scope and current theme', async () => {
  const calls: any[] = []
  let currentTheme = theme
  const p = panel(
    async (scope: any, view: any) => {
      calls.push({ scope, view })
      return view === 'commands'
        ? {
            ...result(scope),
            snapshot: undefined,
            report: `By Command\n${'ไทย command '.repeat(100)}\nProxy summary`,
          }
        : result(scope)
    },
    { theme: () => currentTheme },
  )
  await tick()
  assert.equal(calls.length, 1)
  assert.match(p.text(), /1 commands tracked/)
  assert.match(p.text(), /1,000 estimated output tokens saved/)
  assert.match(p.text(), /oversized commands excluded/)
  for (const width of [32, 40, 80, 120]) {
    const lines = p.component.render(width)
    assert.ok(lines.every((s) => native.visibleWidth(s) <= width))
    assert.match(lines.join('\n'), /Esc/)
  }
  p.component.handleInput!('2')
  assert.match(p.text(), /2026-11-11/)
  assert.equal(calls.length, 1)
  p.component.handleInput!('3')
  await tick()
  assert.equal(calls.length, 2)
  assert.match(p.text(), /Original RTK CLI report/)
  assert.match(p.text(), /proxy sections may be global/)
  const beforeScroll = p.text(32)
  for (let i = 0; i < 10; i++) p.component.handleInput!('DOWN')
  assert.notEqual(p.text(32), beforeScroll)
  p.component.handleInput!('1')
  assert.equal(calls.length, 2)
  p.component.handleInput!('r')
  await tick()
  assert.equal(calls.length, 3)
  p.component.handleInput!('p')
  await tick()
  assert.equal(calls.at(-1).scope, 'all')
  assert.match(p.text(), /All RTK projects/)
  currentTheme = { ...theme, fg: (_: string, s: string) => `NEW ${s}` }
  p.component.invalidate()
  assert.match(p.text(), /NEW RTK/)
  p.component.handleInput!('m')
  p.component.dispose()
  assert.deepEqual(p.choices, ['controls'])
})

test('loading, empty, missing/error and permission failure never fabricate counters; small heights', async () => {
  for (const state of ['empty', 'missing-binary', 'malformed', 'denied']) {
    const p = panel(
      async () => {
        if (state === 'denied') throw Error('/private/path')
        if (state === 'empty') {
          const value: any = result()
          value.snapshot.daily = []
          value.snapshot.summary.total_commands = 0
          return value
        }
        return { ...result(), status: state, snapshot: undefined }
      },
      { height: () => 7 },
    )
    assert.match(p.text(), /Reading RTK/)
    await tick()
    assert.ok(p.component.render(32).length <= 7)
    assert.match(p.text(32), /Esc/)
    assert.doesNotMatch(p.text(), /commands tracked|private\/path/)
    if (state === 'empty') assert.match(p.text(), /No tracked commands/)
    else if (state === 'denied') assert.match(p.text(), /Access unavailable/)
    else assert.match(p.text(), new RegExp(state))
    p.component.dispose()
  }
})

test('abort on refresh/scope/close and discard late results; pending overview/daily share request', async () => {
  const pending: { signal: AbortSignal; resolve: (r: any) => void }[] = []
  const p = panel(
    (_scope: any, _view: any, signal: AbortSignal) =>
      new Promise((resolve) => pending.push({ signal, resolve })),
  )
  p.component.handleInput!('2')
  assert.equal(pending.length, 1)
  p.component.handleInput!('p')
  assert.equal(pending[0].signal.aborted, true)
  pending[0].resolve(result())
  await tick()
  assert.match(p.text(), /Reading RTK/)
  pending[1].resolve(result('all'))
  await tick()
  assert.match(p.text(), /All RTK projects/)
  p.component.handleInput!('r')
  const count = p.renders()
  p.component.handleInput!('ESC')
  assert.equal(pending[2].signal.aborted, true)
  pending[2].resolve(result())
  await tick()
  assert.equal(p.renders(), count)
  p.component.dispose()
  assert.deepEqual(p.choices, [undefined])
})
