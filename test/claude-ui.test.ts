import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ToolRenderers } from '@earendil-works/pi-coding-agent'
import {
  createBashToolDefinition,
  createCodemodeExtension,
  createEditToolDefinition,
  createPowerShellToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  ToolExecutionComponent,
} from '@earendil-works/pi-coding-agent'
import mahiroClaudeUI from '../extensions/mahiro-claude-ui.ts'
import {
  createToolPresentation,
  renderStartupHeader,
  storedDiff,
  type PresentationRenderers,
} from '../lib/claude-ui.ts'
import { fixture, geometry, native, renderContext, theme, themeFrom } from './claude-ui-fixture.ts'

const plain = (lines: string[]) => lines.map(geometry.stripTerminalSequences).join('\n')
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
function row(
  name = 'read',
  base: PresentationRenderers = createReadToolDefinition('/fixture'),
  nativeAPI = native,
) {
  return createToolPresentation(name, base, geometry, nativeAPI, (host) => host)
}
const result = (text = '', details: unknown = undefined) => ({
  content: [{ type: 'text' as const, text }],
  details,
})
const options = { expanded: false, isPartial: false }
function render(
  renderer: ToolRenderers,
  text = '',
  ctx = renderContext(),
  details: unknown = undefined,
  expanded = false,
) {
  return plain(
    renderer.renderResult!(result(text, details), { expanded, isPartial: ctx.isPartial }, theme, ctx).render(
      80,
    ),
  )
}

test('rendering is context/result/args neutral; missing/streaming args are safe', () => {
  const renderer = row()
  const ctx = freeze(renderContext({ args: undefined, argsComplete: false, isPartial: true }))
  const value = freeze(result('streaming text'))
  const before = JSON.stringify({ ctx, value })
  assert.match(plain(renderer.renderCall!(undefined, theme, ctx).render(40)), /Read …/)
  assert.match(
    plain(renderer.renderResult!(value, { expanded: true, isPartial: true }, theme, ctx).render(40)),
    /Running…/,
  )
  assert.equal(JSON.stringify({ ctx, value }), before)
})

test('partial with output is never successful; errors/empty output retain native expansion', () => {
  assert.match(render(row('bash'), 'progress', renderContext({ isPartial: true })), /Running…/)
  assert.doesNotMatch(render(row('bash'), 'progress', renderContext({ isPartial: true })), /progress|Done/)
  const live = createToolPresentation(
    'bash',
    createBashToolDefinition('/fixture'),
    geometry,
    native,
    (host) => host,
    () => ({
      toolStyle: 'transparent',
      diffView: 'split',
      extraDetail: false,
      liveTail: true,
    }),
  )
  const tail = render(live, ['one', 'two', 'three', 'FOUR'].join('\n'), renderContext({ isPartial: true }))
  assert.match(tail, /Running… · live tail/)
  assert.match(tail, /not a completed result/)
  assert.match(tail, /FOUR/)
  assert.doesNotMatch(tail, /Done|\bone\b/)
  assert.match(render(row('bash'), 'progress\nkept', renderContext()), /Done[\s\S]*progress[\s\S]*kept/)
  assert.doesNotMatch(
    render(
      row('write'),
      'progress',
      renderContext({ isPartial: true, args: { content: 'not yet written' } }),
    ),
    /Wrote|preview|Done/,
  )
  const errorCtx = renderContext({ isError: true })
  const output = 'failure\nline2\nline3\nline4\nLAST ERROR'
  assert.match(render(row('edit'), output, errorCtx), /Error[\s\S]*more rows/)
  assert.match(render(row('edit'), output, errorCtx, { diff: '+1 fake' }, true), /LAST ERROR/)
  assert.doesNotMatch(render(row('edit'), output, errorCtx, { diff: '+1 fake' }), /fake/)
  assert.match(render(row('bash')), /Done[\s\S]*no text output/)
})

test('truncation and captured-output path are visible collapsed; expansion retains all captured text', () => {
  const output = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n')
  const details = {
    truncation: { truncated: true, totalLines: 200 },
    fullOutputPath: '/captured/output.txt',
  }
  const collapsed = render(row('bash'), output, renderContext(), details)
  assert.match(collapsed, /more rows.*f6 to expand/)
  assert.match(collapsed, /Native output truncated/)
  assert.match(collapsed, /Full output: \/captured\/output.txt/)
  assert.match(render(row('bash'), output, renderContext(), details, true), /line 19/)
})

test('successful write previews only submitted content, not fabricated old/new diff; preserves native status', () => {
  const ctx = renderContext({
    args: {
      path: '/path/that/does/not/exist',
      content: '\ufefffirst\r\nsecond\r\n',
    },
  })
  const output = render(row('write'), 'Successfully wrote 19 bytes', ctx, undefined, true)
  assert.match(output, /submitted content preview · 2 lines/)
  assert.match(output, /create\/overwrite unknown/)
  assert.match(output, /1 .*first[\s\S]*2 second/)
  assert.doesNotMatch(output, /Created|Overwrote/)
  const fresh = render(
    row('write'),
    'Successfully wrote',
    renderContext({
      args: { path: 'brand-new.ts', content: 'alpha\n' },
    }),
    undefined,
    true,
  )
  const existing = render(
    row('write'),
    'Successfully wrote',
    renderContext({
      args: { path: 'already-there.ts', content: 'alpha\n' },
    }),
    undefined,
    true,
  )
  assert.equal(fresh, existing)
  assert.match(fresh, /1 .*alpha/)
  assert.match(output, /Successfully wrote 19 bytes/)
  assert.doesNotMatch(render(row('write'), 'failure', { ...ctx, isError: true }), /preview|first/)
})

test('split diff consumes stored results only; optional native mode uses the public renderer', () => {
  const calls: string[] = []
  const renderer = row('edit', createEditToolDefinition('/missing'), {
    ...native,
    renderDiff(diff) {
      calls.push(diff)
      return native.renderDiff(diff)
    },
  })
  const ctx = freeze(
    renderContext({
      args: {
        path: '/missing/file',
        oldText: 'untrusted old',
        newText: 'untrusted new',
      },
    }),
  )
  const diff = '-1 old\r\n+1 new\r\n 2 \ufeffcontext'
  assert.match(render(renderer, 'applied', ctx, freeze({ diff }), true), /old[\s\S]*new/)
  assert.deepEqual(calls, [] as string[])
  const nativeRenderer = createToolPresentation(
    'edit',
    createEditToolDefinition('/missing'),
    geometry,
    {
      ...native,
      renderDiff(diff) {
        calls.push(diff)
        return native.renderDiff(diff)
      },
    },
    (host) => host,
    () => ({
      toolStyle: 'transparent',
      diffView: 'native',
      extraDetail: false,
    }),
  )
  assert.match(render(nativeRenderer, 'applied', ctx, { diff }, true), /native\/plain fallback/)
  assert.deepEqual(calls, [diff.replace(/\r\n/g, '\n')])
  const patch =
    '--- a/file\n+++ b/file\n@@ -5,2 +5,2 @@\n-old\n+new\n context\n@@ -15 +15 @@\n-last\n+final\n'
  assert.match(storedDiff({ patch })!, /-5 old\n\+5 new\n 6 context/)
  assert.match(storedDiff({ patch })!, /-15 last\n\+15 final/)
  assert.match(render(renderer, 'applied', ctx, { patch }, true), /final/)
  assert.doesNotMatch(render(renderer, 'applied', ctx, undefined, true), /untrusted/)
  assert.equal(storedDiff(undefined), undefined)
})

test('historical edit/write without preview data retain native text once without unnecessary expansion', () => {
  for (const name of ['edit', 'write']) {
    const renderer = row(name)
    const ctx = renderContext({ args: { path: '/historical/file' } })
    const text = 'Native operation succeeded\nHistorical status retained'
    for (const expanded of [false, true]) {
      const output = render(renderer, text, ctx, undefined, expanded)
      assert.equal(output.match(/Native operation succeeded/g)?.length, 1)
      assert.equal(output.match(/Historical status retained/g)?.length, 1)
      assert.doesNotMatch(output, /more rows|to expand/)
      assert.doesNotMatch(output, /stored edit diff|submitted content preview/)
    }
  }
})

test('image/specialized results and image-path calls delegate to next, irrespective of inline image capability', () => {
  const seen: string[] = []
  const base = {
    renderCall() {
      seen.push('call')
      return { render: () => ['native image call'], invalidate() {} }
    },
    renderResult(value: unknown) {
      seen.push('result')
      assert.ok(value)
      return { render: () => ['native image result'], invalidate() {} }
    },
  }
  const renderer = createToolPresentation('read', base, geometry, native, (host) => host)
  for (const showImages of [true, false]) {
    const ctx = freeze(renderContext({ args: { path: 'image.png' }, showImages }))
    assert.match(plain(renderer.renderCall!(ctx.args, theme, ctx).render(60)), /native image call/)
    const value = freeze({
      content: [{ type: 'image' as const, data: 'fixture', mimeType: 'image/png' }],
      details: undefined,
    })
    assert.match(plain(renderer.renderResult!(value, options, theme, ctx).render(60)), /native image result/)
  }
  assert.deepEqual(seen, ['call', 'result', 'call', 'result'])
  // No guessed extension: content inspection must still delegate.
  const value = {
    content: [{ type: 'image' as const, data: 'fixture', mimeType: 'image/png' }],
    details: undefined,
  }
  assert.match(
    plain(renderer.renderResult!(value, options, theme, renderContext()).render(60)),
    /native image result/,
  )
})

test('public TUI geometry: width/outputPad, ANSI, Thai/CJK/ZWJ/combining, long lines and resize', () => {
  const content = '\u001b[31mภาษาไทย 中文 👩🏽‍💻 é\u001b[0m ' + 'long'.repeat(30)
  for (const width of [1, 2, 5, 12, 24, 40, 76, 110]) {
    for (const outputPad of [0, 1]) {
      const renderer = row('bash')
      const ctx = renderContext({ outputPad, args: { command: content } })
      for (const lines of [
        renderer.renderCall!(ctx.args, theme, ctx).render(width),
        renderer.renderResult!(result(content), { expanded: true, isPartial: false }, theme, ctx).render(
          width,
        ),
        fixture(width),
      ]) {
        for (const line of lines) assert.ok(geometry.visibleWidth(line) <= width, `${width}: ${line}`)
      }
    }
  }
  const rendered = render(row('bash'), content, renderContext(), undefined, true)
  assert.match(rendered, /ภาษาไทย 中文 👩🏽‍💻 é/)
  assert.equal(rendered.includes(String.fromCharCode(27)), false)
})

function harness() {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>()
  const listeners = new Map<string, Array<(event: any, ctx: any) => any>>()
  let resolver: any
  let command: any
  let header: any
  let renders = 0
  let fixedAvailable = true
  let panel: any
  const notifications: string[] = []
  const ui = {
    theme: themeFrom('host-theme'),
    getTheme(name = 'mahiro-claude-dark') {
      return fixedAvailable ? themeFrom(name) : undefined
    },
    setHeader(value: any) {
      header = value?.(
        {
          requestRender() {
            renders++
          },
        },
        ui.theme,
      )
    },
    notify(value: string) {
      notifications.push(value)
    },
    async custom(factory: any) {
      panel = factory(
        {
          requestRender() {
            renders++
          },
        },
        ui.theme,
        geometry.getKeybindings(),
        () => {},
      )
    },
  }
  const pi = {
    on(name: string, handler: any) {
      const ordered = listeners.get(name) ?? []
      ordered.push(handler)
      listeners.set(name, ordered)
      handlers.set(name, async (event, ctx) => {
        for (const listener of ordered) await listener(event, ctx)
      })
    },
    registerToolRenderer(value: any) {
      resolver = value
    },
    registerCommand(name: string, value: any) {
      assert.equal(name, 'mh-ui')
      command = value
    },
    getActiveTools: () => ['read', 'write'],
    getAllTools: () => ['read', 'write', 'codemode'],
    getCommands: () => [{ name: 'mh-ui' }],
    getMcpServers: () => [],
    getThinkingLevel: () => 'low',
  }
  const ctx = {
    mode: 'tui',
    hasUI: true,
    sessionManager: {
      getSessionId: () => 'synthetic-ui-panel-only',
      getHeader: () => ({
        type: 'session' as const,
        version: 3,
        id: 'synthetic-ui-panel-only',
        timestamp: '2026-01-01T00:00:00.000Z',
        cwd: '/fixture/current',
      }),
    },
    cwd: '/fixture/current',
    model: { provider: 'test', id: 'actual-model' },
    thinkingLevel: 'high',
    ui,
  }
  mahiroClaudeUI(pi as never)
  return {
    pi,
    ui,
    ctx,
    handlers,
    notifications,
    resolve: (name: string, base: any) => resolver(name, () => base),
    command: (args: string) => command.handler(args, ctx),
    header: () => header,
    panel: () => panel,
    renders: () => renders,
    missingTheme: () => {
      fixedAvailable = false
    },
  }
}

test('UI harness delivers all public lifecycle listeners in registration order', async () => {
  const h = harness()
  const delivered: string[] = []
  h.pi.on('session_tree', async () => {
    delivered.push('first')
    await Promise.resolve()
    delivered.push('first settled')
  })
  h.pi.on('session_tree', () => delivered.push('second'))
  await h.handlers.get('session_tree')!({}, h.ctx)
  assert.deepEqual(delivered, ['first', 'first settled', 'second'])
  assert.equal(h.ctx.sessionManager.getHeader().id, h.ctx.sessionManager.getSessionId())
  assert.equal(h.ctx.sessionManager.getHeader().cwd, h.ctx.cwd)
  await h.handlers.get('session_shutdown')!({}, h.ctx)
})

function createCodemodeTool(): PresentationRenderers {
  let definition: PresentationRenderers = {}
  createCodemodeExtension()({
    registerTool(tool: PresentationRenderers) {
      definition = tool
    },
    on() {},
  } as never)
  return definition
}

test('resolver is native outside TUI; custom/specialized/codemode stay native; public builtins adapt', async () => {
  const h = harness()
  const read = createReadToolDefinition('/fixture')
  const beforeStartup = h.resolve('read', read)
  assert.equal(beforeStartup.renderResult, read.renderResult)
  await h.handlers.get('session_start')!({}, h.ctx)
  assert.equal(beforeStartup.renderShell, 'self')
  const custom = { renderCall() {}, renderResult() {}, renderShell: 'self' }
  assert.equal(h.resolve('codemode', custom), custom)
  const customDefaultShell = { renderCall() {}, renderResult() {} }
  assert.equal(h.resolve('codemode', customDefaultShell).renderCall, customDefaultShell.renderCall)
  assert.equal(h.resolve('codemode', customDefaultShell).renderShell, undefined)
  const builtinCodemode = h.resolve('codemode', createCodemodeTool())
  assert.equal(builtinCodemode.renderShell, 'self')
  assert.match(
    plain(builtinCodemode.renderCall!({ code: 'return 42' }, theme, renderContext()).render(80)),
    /codemode[\s\S]*return 42/,
  )
  assert.equal(h.resolve('subagent', custom), custom)
  assert.equal(h.resolve('mcp__docs__search', custom), custom)
  assert.equal(h.resolve('custom-tool', custom), custom)
  const powershell = createPowerShellToolDefinition('/other')
  assert.notEqual(powershell.renderCall, createPowerShellToolDefinition('/fixture').renderCall)
  const adapted = h.resolve('powershell', powershell)
  assert.equal(adapted.renderShell, 'self')
  assert.match(
    plain(adapted.renderCall!({ command: 'Get-Date' }, theme, renderContext()).render(80)),
    /PowerShell[\s\S]*Get-Date/,
  )
  assert.equal(h.resolve('powershell', custom).renderCall, custom.renderCall)
  const bash = h.resolve('bash', createBashToolDefinition('/fixture-b'))
  assert.equal(bash.renderShell, 'self')
  assert.match(
    plain(bash.renderCall!({ command: 'pwd' }, theme, renderContext()).render(40)),
    /Bash[\s\S]*pwd/,
  )
  assert.equal(h.resolve('bash', custom).renderCall, custom.renderCall)
  assert.equal(h.resolve('read', custom).renderResult, custom.renderResult)
  assert.equal(h.resolve('read', undefined), undefined)
  assert.equal(h.resolve('write', createWriteToolDefinition('/fixture')).renderShell, 'self')
  await h.handlers.get('session_shutdown')!({}, h.ctx)
  assert.equal(beforeStartup.renderResult, read.renderResult)
  assert.equal(h.header(), undefined)
})

test('non-TUI events cannot displace an existing TUI presentation; late startup cannot resurrect shutdown', async () => {
  const h = harness()
  await h.handlers.get('session_start')!({}, h.ctx)
  const header = h.header()
  const renderer = h.resolve('read', createReadToolDefinition('/fixture'))
  const child = {
    mode: 'rpc',
    cwd: '/fixture/child',
    sessionManager: {
      getSessionId: () => 'synthetic-ui-child',
      getHeader: () => ({
        type: 'session' as const,
        version: 3,
        id: 'synthetic-ui-child',
        timestamp: '2026-01-01T00:00:00.000Z',
        cwd: '/fixture/child',
        parentSession: '/fixture/parent.jsonl',
      }),
    },
    ui: new Proxy(
      {},
      {
        get() {
          throw Error('child UI accessed')
        },
      },
    ),
  }
  for (const event of ['session_start', 'model_select', 'thinking_level_select', 'session_shutdown']) {
    await h.handlers.get(event)!({}, child)
  }
  assert.equal(h.header(), header)
  assert.equal(renderer.renderShell, 'self')
  const next = harness()
  const pending = next.handlers.get('session_start')!({}, next.ctx)
  await next.handlers.get('session_shutdown')!({}, next.ctx)
  await pending
  assert.equal(next.header(), undefined)
})

test('runtime palette controls follow/fixed, missing theme, invalid args, redraw and no host theme mutation', async () => {
  const h = harness()
  await h.handlers.get('session_start')!({}, h.ctx)
  const original = h.ui.theme
  await h.command('theme status')
  assert.match(h.notifications.at(-1)!, /follow · host-theme/)
  await h.command('theme claude')
  assert.match(h.notifications.at(-1)!, /claude · mahiro-claude-dark/)
  assert.match(h.notifications.at(-1)!, /native diff still follows Pi/)
  assert.equal(h.ui.theme, original)
  for (const [mode, expectedTheme] of [
    ['obsidian', 'mahiro-obsidian-dark'],
    ['ember', 'mahiro-ember-dark'],
    ['nordic', 'mahiro-nordic-dark'],
  ] as const) {
    await h.command(`theme ${mode}`)
    assert.match(h.notifications.at(-1)!, new RegExp(`${mode} · ${expectedTheme}`))
    assert.equal(h.ui.theme, original)
  }
  await h.command('theme follow')
  h.missingTheme()
  await h.command('theme claude')
  assert.match(h.notifications.at(-1)!, /unavailable; keeping follow/)
  await h.command('theme obsidian')
  assert.match(h.notifications.at(-1)!, /mahiro-obsidian-dark unavailable; keeping follow/)
  await h.command('theme on')
  assert.match(h.notifications.at(-1)!, /Usage:/)
  assert.ok(h.renders() >= 3)
  const renderer = h.resolve('read', createReadToolDefinition('/fixture'))
  const component = renderer.renderCall({ path: 'file.ts' }, original, renderContext())
  const first = component.render(80).join('\n')
  h.ui.theme = themeFrom('different-host')
  // Palette is derived at render time, not cached as colored application state.
  assert.ok(first.includes('file.ts'))
  await h.handlers.get('model_select')!({}, { ...h.ctx, model: { provider: 'new', id: 'current' } })
  assert.match(plain(h.header().render(110)), /new\/current/)
})

test('settings command integrates live preview, cancel, missing theme and generation/CAS without native defaults', async () => {
  const h = harness()
  await h.handlers.get('session_start')!({}, h.ctx)
  await h.command('settings')
  const first = h.panel()
  assert.match(plain(first.render(110)), /Not persisted/)
  first.handleInput('\r')
  await h.command('theme status')
  assert.match(h.notifications.at(-1)!, /claude · mahiro-claude-dark/)
  first.handleInput('\x1b')
  await h.command('theme status')
  assert.match(h.notifications.at(-1)!, /follow · host-theme/)
  await h.command('') // default command opens panel
  const stale = h.panel()
  await h.command('theme claude') // another runtime owner wins CAS
  stale.handleInput('\x1b')
  await h.command('theme status')
  assert.match(h.notifications.at(-1)!, /claude · mahiro-claude-dark/)
  await h.command('theme follow')
  h.missingTheme()
  await h.command('settings')
  h.panel().handleInput('\r')
  assert.match(plain(h.panel().render(110)), /Choice unavailable/)
  await h.command('theme status')
  assert.match(h.notifications.at(-1)!, /follow · host-theme/)
  await h.command('settings')
  const shutdownPanel = h.panel()
  await h.handlers.get('session_shutdown')!({}, h.ctx)
  shutdownPanel.handleInput('\r')
  shutdownPanel.dispose()
  assert.equal(h.header(), undefined)
})

test('UI controller loads authorized preferences on startup/resume, explicit Save only, missing theme never rewrites disk', async () => {
  // UI-unit bridge only. The real Root/public-PSS positive and denial gate is
  // lib/guards/test/own-ui-sdk-test.mjs, never this synthetic owner.
  const key = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
  const previous = (globalThis as any)[key]
  const nodes = new Map()
  ;(globalThis as any)[key] = nodes
  const generation = {}
  let reads = 0,
    saves = 0,
    denied = false
  let disk = {
    palette: 'claude',
    toolStyle: 'tinted',
    diffView: 'unified',
    extraDetail: true,
  }
  let ticket = Object.freeze({ version: 1 })
  const owner = {
    version: 1,
    generation,
    read() {
      reads++
      return { preferences: { ...disk }, ticket }
    },
    save(_ctx: unknown, expected: object, prefs: typeof disk) {
      saves++
      if (denied) throw Error('PRIVATE_CANARY')
      assert.equal(expected, ticket)
      disk = { ...prefs }
      ticket = Object.freeze({ version: 1 })
      return { preferences: { ...disk }, ticket }
    },
  }
  nodes.set('synthetic-ui-panel-only', {
    generation,
    ownUI: owner,
    healthy: () => true,
  })
  try {
    const h = harness()
    h.missingTheme()
    await h.handlers.get('session_start')!({}, h.ctx)
    await h.command('theme status')
    assert.match(h.notifications.at(-1)!, /follow · host-theme/)
    assert.equal(disk.palette, 'claude')
    assert.equal(saves, 0)
    await h.command('settings')
    const p = h.panel()
    assert.match(plain(p.render(110)), /Tool style\s+tinted/)
    p.handleInput('\x1b[B')
    p.handleInput('\r') // transparent runtime preview
    for (let i = 0; i < 3; i++) p.handleInput('\x1b[B')
    p.handleInput('\r') // Apply, not Save
    assert.equal(saves, 0)
    await h.command('theme follow')
    assert.equal(saves, 0)
    await h.handlers.get('session_start')!({}, h.ctx) // fresh startup/resume reloads canonical state
    await h.command('settings')
    assert.match(plain(h.panel().render(110)), /Tool style\s+tinted/)
    for (let i = 0; i < 8; i++) h.panel().handleInput('\x1b[B')
    denied = true
    h.panel().handleInput('\r')
    assert.equal(saves, 1)
    assert.match(h.notifications.at(-1)!, /not saved/)
    assert.doesNotMatch(h.notifications.at(-1)!, /PRIVATE_CANARY/)
    denied = false
    h.panel().handleInput('\r')
    assert.equal(saves, 1, 'failed Save requires reopen/read, no blind retry')
    await h.command('settings')
    for (let i = 0; i < 8; i++) h.panel().handleInput('\x1b[B')
    h.panel().handleInput('\r')
    assert.equal(saves, 2)
    assert.match(h.notifications.at(-1)!, /saved durably/)
    assert.equal(disk.palette, 'follow')
    assert.ok(reads >= 4)
    await h.handlers.get('session_shutdown')!({}, h.ctx)
  } finally {
    if (previous === undefined) delete (globalThis as any)[key]
    else (globalThis as any)[key] = previous
  }
})

test('startup header uses actual public model/effort/cwd and counts, never fabricated skills/extensions/totals', async () => {
  const h = harness()
  await h.handlers.get('session_start')!({}, h.ctx)
  const wide = plain(h.header().render(150))
  for (const value of [
    'Mahiro',
    ' ▄██▄    ▄██▄   ',
    'test/actual-model',
    'high effort',
    '/fixture/current',
    '2 active / 3 registered tools',
    '1 resource commands',
    '0 extension MCP registrations',
  ])
    assert.ok(wide.includes(value), value)
  assert.match(wide, /Skills \/ extensions \/ global-project totals unavailable/)
  assert.ok(wide.includes('│'))
  assert.match(plain(h.header().render(40)), /Getting started/)
  const noModel = renderStartupHeader(
    {
      version: '1.3.0',
      model: 'Model unavailable',
      effort: 'unavailable',
      cwd: '/fixture',
      activeTools: 0,
      registeredTools: 0,
      commands: 0,
      mcpServers: 0,
      paletteMode: 'follow',
    },
    60,
    theme,
    geometry,
  )
  assert.match(plain(noModel), /Model unavailable/)
})

test('selected Argon 02 Neko-Stack retains six exact 16-cell rows; narrow headers crop without overflow', () => {
  const logo = [
    ' ▄██▄    ▄██▄   ',
    ' ████████████   ',
    '-██▄██████▄██-  ',
    ' ████████████  ▄',
    ' ████████████▄█▀',
    ' ▀▀████████▀▀▀  ',
  ]
  const data = {
    version: '1.3.0',
    model: '模型/ภาษาไทย/👩🏽‍💻/é',
    effort: 'low',
    cwd: '/ภาษาไทย/界/👩🏽‍💻/é',
    activeTools: 4,
    registeredTools: 8,
    commands: 3,
    mcpServers: 0,
    paletteMode: 'follow' as const,
  }
  assert.deepEqual(logo.map(geometry.visibleWidth), [16, 16, 16, 16, 16, 16])
  for (const width of [0, 1, 2, 5, 6, 10, 19, 20, 40, 75, 76, 110]) {
    const rows = renderStartupHeader(data, width, theme, geometry).map(geometry.stripTerminalSequences)
    assert.ok(
      rows.every((line) => geometry.visibleWidth(line) <= width),
      `width ${width}`,
    )
    if (width === 0) assert.deepEqual(rows, [])
    else if (width < 6) {
      assert.equal(rows.length, 1)
      assert.equal(rows[0], geometry.stripTerminalSequences(geometry.truncateToWidth('Mahiro', width)))
    } else {
      // Branding may wrap; the following six art rows never do.
      const logoStart = width >= 76 ? 2 : 1 + geometry.wrapTextWithAnsi('Mahiro', width - 4).length
      assert.deepEqual(
        rows.slice(logoStart, logoStart + 6).map((line) => line.slice(2, 2 + Math.min(16, width - 4))),
        logo.map((line) =>
          geometry.stripTerminalSequences(geometry.truncateToWidth(line, Math.min(16, width - 4), '')),
        ),
      )
      assert.doesNotMatch(rows.join('\n'), /undefined/)
    }
  }
})

test('non-TUI startup imports no runtime SDK/TUI, publishes nothing and handles shutdown', () => {
  const source = `import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.startsWith('@earendil-works/')) throw Error('unexpected runtime import '+specifier);
      return next(specifier, context);
    }});
    const extension = (await import('./extensions/mahiro-claude-ui.ts')).default;
    for (const mode of ['rpc','json','print']) {
      const handlers = new Map(); let command;
      const pi = { on(n,h){
        const ordered = handlers.get(n) ?? [];
        ordered.push(h); handlers.set(n,ordered);
      }, registerToolRenderer(){}, registerCommand(n,c){command=c} };
      const emit = async (n,e,c) => {for (const h of handlers.get(n) ?? []) await h(e,c)};
      extension(pi);
      const header = {type:'session', version:3, id:'non-tui-'+mode,
        timestamp:'2026-01-01T00:00:00.000Z', cwd:process.cwd()};
      const ctx = {mode, hasUI:false, cwd:header.cwd,
        sessionManager:{getHeader:()=>header, getSessionId:()=>header.id},
        ui: new Proxy({}, {get(){throw Error('non-TUI UI access')}})};
      await emit('session_start',{},ctx);
      await command.handler('theme claude',ctx);
      await command.handler('settings',ctx);
      await emit('session_shutdown',{},ctx);
    }`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    timeout: 15000,
  })
  assert.equal(child.status, 0, child.stderr)
})

test('public native tool component preserves partial/error/expansion, without executing tools or reading edited paths', async () => {
  const h = harness()
  await h.handlers.get('session_start')!({}, h.ctx)
  for (const outputPad of [0, 1]) {
    const renderer = h.resolve('edit', createEditToolDefinition('/does-not-exist'))
    const component = new ToolExecutionComponent(
      'edit',
      'native-fixture',
      {
        path: '/does-not-exist/file',
        edits: [
          { oldText: 'old', newText: 'new' },
          { oldText: 'second old', newText: 'second new' },
        ],
      },
      { outputPad, showImages: false },
      renderer,
      { requestRender() {} } as never,
      '/does-not-exist',
    )
    component.setArgsComplete()
    component.markExecutionStarted()
    component.updateResult({ ...result('streaming output'), isError: false }, true)
    assert.match(plain(component.render(80)), /Running…/)
    component.updateResult({ ...result('Applied', { diff: '-1 old\n+1 new' }), isError: false }, false)
    assert.match(plain(component.render(80)), /stored edit diff[\s\S]*old[\s\S]*new/)
    const longError = Array.from({ length: 20 }, (_, index) => `error ${index}`).join('\n')
    component.updateResult({ ...result(longError), isError: true }, false)
    assert.match(plain(component.render(80)), /Error[\s\S]*more rows/)
    component.setExpanded(true)
    assert.match(plain(component.render(80)), /error 19/)
    for (const width of [20, 80]) {
      for (const line of component.render(width)) assert.ok(geometry.visibleWidth(line) <= width)
    }
    const rawCodemode = createCodemodeTool()
    let callFactoryRuns = 0
    let resultFactoryRuns = 0
    const spiedCodemode: PresentationRenderers = {
      renderShell: rawCodemode.renderShell,
      renderCall: Object.assign(
        (...args: Parameters<NonNullable<PresentationRenderers['renderCall']>>) => {
          callFactoryRuns++
          return rawCodemode.renderCall!(...args)
        },
        { toString: () => rawCodemode.renderCall!.toString() },
      ),
      renderResult: Object.assign(
        (...args: Parameters<NonNullable<PresentationRenderers['renderResult']>>) => {
          resultFactoryRuns++
          return rawCodemode.renderResult!(...args)
        },
        { toString: () => rawCodemode.renderResult!.toString() },
      ),
    }
    const codemodeRenderer = createToolPresentation(
      'codemode',
      spiedCodemode,
      geometry,
      native,
      (host) => host,
    )
    assert.equal(h.resolve('codemode', rawCodemode).renderShell, 'self')
    const originalNow = Date.now
    let now = 1_000_000
    Date.now = () => now
    try {
      const codemodeComponent = new ToolExecutionComponent(
        'codemode',
        'codemode-fixture',
        { code: 'const out = await tools.read({ path: "README.md" });\nreturn out;' },
        { outputPad, showImages: false },
        codemodeRenderer,
        { requestRender() {} } as never,
        '/does-not-exist',
      )
      codemodeComponent.setArgsComplete()
      codemodeComponent.markExecutionStarted()
      // 5 seconds elapse before final result without durationMs; render() was not called at start.
      now += 5000
      codemodeComponent.updateResult(
        {
          content: [{ type: 'text', text: 'Script completed\nWall time 5.0 seconds\nOutput:\nok' }],
          details: {
            calls: [{ name: 'read', args: '{"path":"README.md"}', status: 'ok', durationMs: 12 }],
          },
          isError: false,
        },
        false,
      )
      const callRunsBeforeRender = callFactoryRuns
      const resultRunsBeforeRender = resultFactoryRuns
      assert.ok(callRunsBeforeRender > 0 && resultRunsBeforeRender > 0)
      const callWrapper = (codemodeComponent as any).callRendererComponent
      const resultWrapper = (codemodeComponent as any).resultRendererComponent
      const callChildrenBefore = [...callWrapper.children]
      const resultChildrenBefore = [...resultWrapper.children]
      assert.ok(callChildrenBefore.length > 0)
      assert.ok(resultChildrenBefore.length > 0)
      const codemodeLines = codemodeComponent.render(80)
      const codemodeSecondFrame = codemodeComponent.render(80)
      assert.deepEqual(codemodeSecondFrame, codemodeLines)
      assert.equal(callFactoryRuns, callRunsBeforeRender, 'render() does not re-run native renderCall')
      assert.equal(resultFactoryRuns, resultRunsBeforeRender, 'render() does not re-run native renderResult')
      assert.deepEqual(callWrapper.children, callChildrenBefore, 'call children retained across frames')
      assert.deepEqual(resultWrapper.children, resultChildrenBefore, 'result children retained across frames')
      const codemodePlain = plain(codemodeLines)
      assert.match(codemodePlain, /codemode[\s\S]*✓ read[\s\S]*ok[\s\S]*Took 5\.0s/)
      assert.ok(
        !codemodeLines.join('\n').includes('\x1b[48;'),
        'completed codemode does not fill a green box surface',
      )
      // Update args/result: native lastComponent and wrapper must be reused.
      codemodeComponent.updateArgs({ code: 'return "updated";' })
      assert.equal((codemodeComponent as any).callRendererComponent, callWrapper, 'call container reused')
      // Malformed details.calls without args must be caught by ToolExecutionComponent.updateDisplay()
      // try/catch and fall back to native text output rather than throwing during render().
      codemodeComponent.updateResult(
        {
          content: [{ type: 'text', text: 'Fallback output on malformed calls' }],
          details: {
            calls: [{ name: 'read', status: 'ok' }],
          },
          isError: false,
        },
        false,
      )
      assert.equal((codemodeComponent as any).resultRendererComponent, undefined)
      assert.match(plain(codemodeComponent.render(80)), /Fallback output on malformed calls/)
    } finally {
      Date.now = originalNow
    }
  }
  await h.handlers.get('session_shutdown')!({}, h.ctx)
})

test('existing components rebuild palette output on runtime mode change and invalidate, not cached ANSI', () => {
  const other = {
    ...theme,
    fg: (_token: string, text: string) => `<fixed>${text}</fixed>`,
    bold: (text: string) => text,
  } as never
  let fixed = false
  const renderer = createToolPresentation(
    'read',
    createReadToolDefinition('/fixture'),
    geometry,
    native,
    (host) => (fixed ? other : host),
  )
  const call = renderer.renderCall!({ path: 'file.ts' }, theme, renderContext())
  const output = renderer.renderResult!(result('captured'), options, theme, renderContext())
  assert.doesNotMatch(call.render(120).join('\n'), /<fixed>/)
  fixed = true
  call.invalidate()
  output.invalidate()
  assert.match(call.render(120).join('\n'), /<fixed>/)
  assert.match(output.render(120).join('\n'), /<fixed>/)
  fixed = false
  assert.doesNotMatch(output.render(120).join('\n'), /<fixed>/)
})

test('repeated host frames reuse wrapped result rows until width, content, palette or expansion change', () => {
  let wraps = 0
  const counted = {
    ...geometry,
    wrapTextWithAnsi: (text: string, width: number) => {
      wraps++
      return geometry.wrapTextWithAnsi(text, width)
    },
  }
  let fixed = false
  const other = {
    ...theme,
    fg: (_token: string, text: string) => `<fixed>${text}</fixed>`,
    bold: (text: string) => text,
  } as never
  const renderer = createToolPresentation(
    'read',
    createReadToolDefinition('/fixture'),
    counted,
    native,
    (host) => (fixed ? other : host),
  )
  const output = Array.from({ length: 400 }, (_, i) => `ไทย 👩🏽‍💻 line ${i}`).join('\n')
  const view = { expanded: false, isPartial: false }
  const component = renderer.renderResult!(result(output), view, theme, renderContext())
  const first = component.render(80)
  const work = wraps
  assert.ok(work >= 400)
  for (let frame = 0; frame < 5; frame++) assert.deepEqual(component.render(80), first)
  assert.equal(wraps, work, 'identical frames must not re-wrap the output')
  component.render(60)
  assert.ok(wraps > work, 'resize re-wraps')
  const resized = wraps
  fixed = true
  assert.match(component.render(60).join('\n'), /<fixed>/)
  assert.ok(wraps > resized, 'palette change re-wraps')
  const recolored = wraps
  view.expanded = true
  assert.match(plain(component.render(60)), /line 399/)
  assert.ok(wraps > recolored, 'expansion is part of the layout input')
  const call = renderer.renderCall!({ path: 'file.ts' }, theme, renderContext())
  const title = call.render(80)
  const callWork = wraps
  for (let frame = 0; frame < 5; frame++) assert.deepEqual(call.render(80), title)
  assert.equal(wraps, callWork, 'identical call rows are not re-wrapped')
  fixed = false
  assert.doesNotMatch(call.render(80).join('\n'), /<fixed>/)
  assert.ok(wraps > callWork)
})

test('repeated diff and stable partial frames do not redo wrap or width measurement', () => {
  let wraps = 0
  let widths = 0
  const counted = {
    ...geometry,
    visibleWidth: (text: string) => {
      widths++
      return geometry.visibleWidth(text)
    },
    wrapTextWithAnsi: (text: string, width: number) => {
      wraps++
      return geometry.wrapTextWithAnsi(text, width)
    },
  }
  const edit = createToolPresentation(
    'edit',
    createEditToolDefinition('/fixture'),
    counted,
    native,
    (host) => host,
  )
  const diff = `-1 ${'中'.repeat(30)}\n+1 ${'中'.repeat(30)} changed`
  const component = edit.renderResult!(
    result('applied', { diff }),
    { expanded: true, isPartial: false },
    theme,
    renderContext(),
  )
  const first = component.render(110)
  const wrapWork = wraps
  const widthWork = widths
  assert.ok(wrapWork > 0)
  assert.ok(widthWork > 0)
  for (let frame = 0; frame < 5; frame++) assert.deepEqual(component.render(110), first)
  assert.equal(wraps, wrapWork, 'identical diff frames must not re-wrap')
  assert.equal(widths, widthWork, 'identical diff frames must not remeasure')
  const streaming = createToolPresentation(
    'bash',
    createBashToolDefinition('/fixture'),
    counted,
    native,
    (host) => host,
  )
  const hidden = Array.from({ length: 400 }, (_, i) => `stream ${i}`).join('\n')
  const partial = streaming.renderResult!(
    result(hidden),
    { expanded: false, isPartial: true },
    theme,
    renderContext({ isPartial: true }),
  )
  const stable = partial.render(80)
  const stableWork = wraps
  assert.match(plain(stable), /Running…/)
  assert.doesNotMatch(plain(stable), /stream 399|Done/)
  for (let frame = 0; frame < 5; frame++) assert.deepEqual(partial.render(80), stable)
  assert.equal(wraps, stableWork)
  assert.ok(wraps - wrapWork < 40, 'hidden partial output is not wrapped')
})

test('live-tail command stays off the saved preference record and resets on the next TUI session', async () => {
  const h = harness()
  await h.handlers.get('session_start')!({}, h.ctx)
  await h.command('live-tail on')
  assert.match(h.notifications.at(-1)!, /live output tail: on/)
  assert.match(h.notifications.at(-1)!, /Not saved/)
  const bash = h.resolve('bash', createBashToolDefinition('/fixture'))
  assert.match(render(bash, 'hidden\nVISIBLE', renderContext({ isPartial: true })), /live tail[\s\S]*VISIBLE/)
  assert.doesNotMatch(render(bash, 'hidden\nVISIBLE', renderContext({ isPartial: true })), /Done/)
  await h.command('live-tail off')
  assert.doesNotMatch(render(bash, 'hidden\nVISIBLE', renderContext({ isPartial: true })), /VISIBLE|Done/)
  await h.handlers.get('session_start')!({}, h.ctx)
  await h.command('live-tail status')
  assert.match(h.notifications.at(-1)!, /live output tail: off/)
})

test('source contract: no execution/context/history/private hooks, settings writes, footer or rendering filesystem', () => {
  const source = [
    '../extensions/mahiro-claude-ui.ts',
    '../lib/claude-ui.ts',
    '../lib/claude-ui-diff.ts',
    '../lib/claude-ui-settings.ts',
  ]
    .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
    .join('\n')
  assert.doesNotMatch(
    source,
    /from ["'](?:node:)?fs|readFile|writeFile|\/dist\/|\.prototype|Object\.defineProperty/,
  )
  assert.doesNotMatch(
    source,
    /pi\.(?:registerTool\(|setActiveTools|sendMessage|sendUserMessage|appendEntry|setModel|setThinkingLevel|exec\()|\.execute\(/,
  )
  assert.doesNotMatch(
    source,
    /\.setTheme\(|\.setFooter\(|\.setStatus\(|onTerminalInput|registerShortcut|setInterval|setTimeout|setWorking/,
  )
  assert.doesNotMatch(source, /pi\.on\(\s*(['"])(?:context|tool_call|tool_result|before_agent_start|input)\1/)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(pkg.pi.themes, [
    './themes/mahiro-claude-dark.json',
    './themes/mahiro-obsidian-dark.json',
    './themes/mahiro-ember-dark.json',
    './themes/mahiro-nordic-dark.json',
  ])
  assert.equal(pkg.pi.extensions.at(-1), './extensions/mahiro-claude-ui.ts')
  assert.equal(pkg.pi.extensions.length, 13)
  const bootstrap = readFileSync(new URL('../lib/bootstrap.ts', import.meta.url), 'utf8')
  assert.match(
    bootstrap,
    /sourceState\(\s*product\s*,\s*\[[\s\S]*?(['"])themes\1\s*,\s*(['"])THIRD_PARTY_NOTICES\.md\2/,
  )
  const fixtureSource = readFileSync(
    new URL('../lib/guards/test/permission-patch-fixture.mjs', import.meta.url),
    'utf8',
  )
  assert.match(fixtureSource, /(['"])themes\1\s*,\s*(['"])THIRD_PARTY_NOTICES\.md\2/)
  const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8')
  for (const text of [
    '6746292ff4359b2bdca987109ff49c8da055bb23',
    'FammasMaz',
    'Tim van den Hoorn',
    'Permission is hereby granted',
    'THE SOFTWARE IS PROVIDED',
  ])
    assert.ok(notices.includes(text))
})
