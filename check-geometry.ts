import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pack, renderFooter, COLORS } from './lib/footer.ts'

const args = process.argv.slice(2).filter((arg) => arg !== '--')
assert.ok(
  args.length === 1 && isAbsolute(args[0]),
  'Pass an absolute existing host package.json path; no host is auto-installed',
)
const host = createRequire(args[0])
const geometry = await import(pathToFileURL(host.resolve('@earendil-works/pi-tui')).href)
assert.equal(typeof geometry.visibleWidth, 'function')
assert.equal(typeof geometry.truncateToWidth, 'function')
const plain = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
const ctx: any = {
  cwd: '/synthetic/งานไทย👩🏽‍💻',
  model: { id: 'gpt-6.1-sol', provider: 'openai', contextWindow: 272000 },
  thinkingLevel: 'medium',
  getContextUsage: () => ({ percent: 0, contextWindow: 272000 }),
  sessionManager: {
    getEntries: () => [
      {
        type: 'message',
        message: {
          role: 'assistant',
          usage: {
            input: 10,
            output: 3,
            cacheRead: 20,
            cacheWrite: 2,
            cost: { total: 0.001 },
          },
        },
      },
    ],
    getBranch: () => [],
    getSessionName: () => 'ชื่อเซสชัน',
  },
  modelRegistry: {
    isUsingOAuth: () => true,
    getProvider: () => ({ auth: { oauth: { isSubscription: true } } }),
  },
}
const data = { getGitBranch: () => 'main', getExtensionStatuses: () => new Map() }
const state = {
  git: 'git dirty:1 ?:2 ahead:3 behind:4',
  activity: 'tool read',
  hideContext: false,
  quota: [],
}
for (const width of [40, 60, 80, 120, 160]) {
  const rows = renderFooter(ctx, {}, data, state, width, geometry)
  assert.ok(
    rows.every((row) => geometry.visibleWidth(row) <= width),
    `${width}: overflow`,
  )
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
  ]) {
    assert.ok(all.includes(fragment), `${width}: missing ${fragment}`)
  }
}
const value = 'กิ👩🏽‍💻'.repeat(30)
const rows = pack([{ text: value, color: COLORS.folder }], 4, geometry)
assert.ok(rows.every((row) => geometry.visibleWidth(row) <= 4))
assert.equal(rows.map(plain).join(''), value)
console.log(
  'Public host TUI geometry passed: 40/60/80/120/160 columns and Thai/ZWJ round-trip (not rendered acceptance).',
)
