import test from 'node:test'
import assert from 'node:assert/strict'
import { visibleWidth, truncateToWidth } from '@earendil-works/pi-tui'
import { initUsage, USAGE_WIDGET } from '../lib/usage.ts'
import { renderFooter } from '../lib/footer.ts'
import { quotaController } from '../lib/quota.ts'
import { registerWorkflowHub } from '../lib/workflow-hub.ts'

const geometry = { visibleWidth, truncateToWidth }
const plain = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')

test('public hub delegates the real usage handler, widgets stay busy-safe, footer honors off/compact', async () => {
  const commands = new Map<string, any>()
  const events = new Map<string, Array<(...args: any[]) => unknown>>()
  let widget: any
  let emissions = 0
  const pi: any = {
    registerCommand: (name: string, command: unknown) => commands.set(name, command),
    on(name: string, handler: (...args: any[]) => unknown) {
      events.set(name, [...(events.get(name) ?? []), handler])
      return () => {}
    },
  }
  const ctx: any = {
    mode: 'tui',
    hasUI: true,
    cwd: '/synthetic/ทดสอบ👩‍💻',
    thinkingLevel: 'medium',
    model: { provider: 'openai-codex', id: 'synthetic', name: 'Synthetic', api: 'openai-codex-responses' },
    sessionManager: {
      getSessionId: () => 'synthetic-session',
      getHeader: () => ({}),
      getBranch: () => [],
      getEntries: () => [],
    },
    modelRegistry: {
      getProviderAuthStatus: () => ({ configured: true }),
      isUsingOAuth: () => true,
      getProvider: () => ({}),
    },
    getContextUsage: () => ({ tokens: 0, contextWindow: 100000, percent: 0 }),
    ui: {
      setWidget(key: string, content: unknown) {
        assert.equal(key, USAGE_WIDGET)
        widget = content
      },
      select: async (_title: string, entries: string[]) => {
        assert.ok(entries.includes('Usage'))
        return 'Usage'
      },
    },
    // Any accidental turn, idle wait or composer mutation fails immediately.
    waitForIdle: () => {
      throw new Error('must be busy safe')
    },
  }
  const usage = initUsage(pi)
  const quota = quotaController(ctx, () => {}, {
    fetch: async () => {
      throw new Error('no probes')
    },
  })
  usage.attach(ctx, quota, () => emissions++, geometry)
  registerWorkflowHub(pi)
  try {
    for (const event of events.get('session_start') ?? []) await event({}, ctx)
    await commands.get('mh').handler('', ctx)
    assert.equal(typeof widget, 'function')
    const component = widget({}, { fg: (_tone: string, line: string) => line })
    for (const width of [1, 12, 40, 100]) {
      assert.ok(component.render(width).every((line: string) => visibleWidth(line) <= width))
    }
    const state: any = {
      git: 'git main',
      activity: 'idle',
      hideContext: false,
      quota: [{ text: 'Codex 5h ▰▰▰▰▰▰▱▱▱▱ 62%', color: '#A5A8AB' }],
      quotaCompact: [{ text: 'Codex 5h 62%', color: '#A5A8AB' }],
    }
    const footer = () =>
      renderFooter(
        ctx,
        {},
        { getGitBranch: () => 'main', getExtensionStatuses: () => new Map() },
        { ...state, usageDisplay: usage.display() },
        100,
        geometry,
      ).map(plain)
    assert.equal(footer().length, 2)
    assert.match(footer()[1], /ctx .* \| Codex 5h ▰▰▰▰▰▰▱▱▱▱ 62%/)
    await commands.get('mh-usage').handler('compact', ctx)
    assert.equal(footer().length, 2)
    assert.match(footer()[1], /\| Codex 5h 62%/)
    assert.doesNotMatch(footer()[1], /Codex 5h [▰▱]/)
    await commands.get('mh-usage').handler('off', ctx)
    assert.equal(footer().length, 2)
    assert.match(footer()[1], /↑0 ↓0/, 'off does not reset or hide mandatory native usage')
    assert.ok(emissions > 0)
    usage.dispose()
    assert.equal(widget, undefined)
  } finally {
    usage.dispose()
    quota.dispose()
  }
})
