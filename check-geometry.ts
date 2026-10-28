import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pack, renderFooter, COLORS } from './lib/footer.ts'
import { quotaFooterSegments } from './lib/quota.ts'
import type { Theme } from '@earendil-works/pi-coding-agent'
import { TaskPanel, TaskWidget } from './lib/session-work/task-panel.ts'
import { emptyTasks, type Task } from './lib/session-work/task-model.ts'

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
  assert.equal(rows.length, width < 80 ? 3 : 2, `${width}: semantic core rows`)
  for (const fragment of ['gpt-6.1-sol | medium', 'ctx ▱▱▱▱▱▱▱▱▱▱ 0.0%', 'งานไทย👩🏽‍💻']) {
    assert.ok(all.includes(fragment), `${width}: missing ${fragment}`)
  }
  if (width >= 80) assert.ok(all.includes('↑10 ↓3'))
  else {
    assert.ok(plain(rows[0]).includes('🌿 main'))
    assert.ok(plain(rows[1]).includes('gpt-6.1-sol'))
  }
  for (const removed of ['/synthetic/', 'ชื่อเซสชัน', 'R20', 'W2', 'CH62.5%', '$0.001', '/272k'])
    assert.ok(!all.includes(removed), `${width}: removed ${removed}`)
}
for (const width of [1, 2, 4, 8, 12, 20, 40, 60, 80, 120, 160]) {
  const long = { ...ctx, model: { ...ctx.model, id: 'long-model-'.repeat(30) } }
  const output = renderFooter(long, { compaction: { enabled: false } }, data, state, width, geometry)
  const expectedRows: Record<number, number> = {
    1: 24,
    2: 13,
    4: 8,
    8: 5,
    12: 5,
    20: 5,
    40: 3,
    60: 3,
    80: 2,
    120: 2,
    160: 2,
  }
  assert.equal(output.length, expectedRows[width])
  assert.ok(
    output.every((row) => geometry.visibleWidth(row) <= width),
    `${width}: tiny/long overflow`,
  )
  if (width >= 12) assert.ok(output.map(plain).join('\n').includes('auto off'), `${width}: warning`)
}
const quota = quotaFooterSegments([{ label: 'P:7d', remaining: 84, reset: null }], false)
const quotaState = { ...state, quota: quota.expanded, quotaCompact: quota.compact }
for (const width of [48, 160]) {
  const output = renderFooter(ctx, {}, data, quotaState, width, geometry)
  assert.ok(output.every((row) => geometry.visibleWidth(row) <= width))
  const lines = output.map(plain)
  assert.ok(lines.some((row) => row.includes('Codex Weekly ▰▰▰▰▰▰▰▰▱▱ 84%')))
  assert.ok(lines.some((row) => row.includes('ctx ▱▱▱▱▱▱▱▱▱▱ 0.0%')))
  assert.ok(lines.some((row) => row.includes('↑10 ↓3')))
  if (width === 160) assert.match(lines[1], /ctx .* \| Codex Weekly/)
}
const value = 'กิ👩🏽‍💻שלום'.repeat(30)
const rows = pack([{ text: value, color: COLORS.folder }], 4, geometry)
assert.ok(rows.every((row) => geometry.visibleWidth(row) <= 4))
assert.equal(rows.map(plain).join(''), value)
const taskTheme = {
  fg: (_tone: string, text: string) => `\x1b[90m${text}\x1b[39m`,
  strikethrough: (text: string) => `\x1b[9m${text}\x1b[29m`,
} as unknown as Theme
for (const count of [0, 3, 24]) {
  const taskState = {
    ...emptyTasks(),
    tasks: Array.from(
      { length: count },
      (_, index): Task => ({
        id: String(index),
        revision: 1,
        subject: `ตรวจสอบงานที่ ${index} ภาษาไทย 中文 👩🏽‍💻 👨‍👩‍👧‍👦 `.repeat(5),
        description: 'กำลังทดสอบความกว้าง 中文 👩🏽‍💻'.repeat(5),
        status: index % 3 === 0 ? 'completed' : index % 3 === 1 ? 'in_progress' : 'pending',
        blockedBy: index % 3 === 2 ? ['1'] : [],
        completedTurn: index % 3 === 0 ? 0 : null,
        owner: '',
        metadata: {},
      }),
    ),
  }
  const panel = new TaskPanel({
    state: taskState,
    tui: { requestRender() {} },
    theme: taskTheme,
    keys: { matches: (data, action) => data === action },
    done() {},
    geometry,
  })
  const widget = new TaskWidget(taskState, taskTheme, geometry, () => true)
  for (let step = 0; step < Math.max(1, count); step++) {
    for (const width of [1, 2, 8, 11, 12, 24, 40, 60, 80, 120, 160]) {
      const rows = panel.render(width)
      assert.ok(rows.length <= 20, `${width}: task panel bounded height`)
      assert.ok(
        rows.every((row) => geometry.visibleWidth(row) <= width),
        `${width}: task panel overflow`,
      )
      if (width >= 12)
        assert.ok(
          rows.every((row) => geometry.visibleWidth(row) === width),
          `${width}: task panel right edge`,
        )
      const widgetRows = widget.render(width)
      assert.ok(widgetRows.length <= 14, `${width}: task widget bounded height`)
      assert.ok(
        widgetRows.every((row) => geometry.visibleWidth(row) <= (width >= 12 ? width - 1 : width)),
        `${width}: task widget overflow`,
      )
      assert.doesNotMatch(widgetRows.map(plain).join('\n'), /[┌┐┘│]|└─+┘/, `${width}: frameless task widget`)
    }
    panel.handleInput('tui.select.down')
  }
}
console.log(
  'Public host footer + TaskPanel/TaskWidget geometry passed: 40/60/80/120/160 and tiny columns, Thai/CJK/ZWJ labels (not human rendered acceptance).',
)
