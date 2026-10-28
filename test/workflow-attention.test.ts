import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  registerWorkflowAttention,
  workflowAttention,
  WORKFLOW_ATTENTION_WIDGET,
} from '../lib/workflow-attention.ts'

function harness(sharedUI?: any) {
  const events = new Map<string, ((...args: any[]) => any)[]>()
  let id = 'session-one'
  const manager = { getSessionId: () => id, getHeader: () => ({}) }
  const updates: { key: string; component: any; options: any }[] = []
  const ui = sharedUI ?? {
    setWidget(key: string, component: any, options: any) {
      updates.push({ key, component, options })
    },
  }
  const ctx = { mode: 'tui', hasUI: true, cwd: '/project', sessionManager: manager, ui } as any
  const pi = {
    on(name: string, handler: (...args: any[]) => any) {
      events.set(name, [...(events.get(name) ?? []), handler])
    },
    executeTool() {
      assert.fail('attention must never execute tools')
    },
    appendEntry() {
      assert.fail('attention must never persist state')
    },
    sendUserMessage() {
      assert.fail('attention must never send model messages')
    },
  } as any
  const emit = async (name: string, event = {}) => {
    for (const handler of events.get(name) ?? []) await handler(event, ctx)
  }
  const shown = () => updates.at(-1)?.component
  const lines = (width = 100) =>
    shown()?.({}, { fg: (_color: string, text: string) => text }).render(width) ?? []
  return {
    pi,
    ctx,
    updates,
    emit,
    shown,
    lines,
    setId: (value: string) => {
      id = value
    },
  }
}

test('attention uses actual nested owner output shapes and fixed safe wording only', () => {
  assert.equal(
    workflowAttention('goal', {
      goal: { blockers: [{ status: 'open', summary: 'PRIVATE' }, { status: 'resolved' }] },
    }),
    '1 open blocker',
  )
  assert.equal(workflowAttention('ux', { workflow: {}, open_blockers: [1, 2] }), '2 open blockers')
  assert.equal(workflowAttention('run', { run: {}, open_blockers: [1] }), '1 open blocker')
  assert.equal(
    workflowAttention('evidence', {
      status: 'ok',
      repository: { freshness: { isCurrent: false, reason: 'PRIVATE' } },
    }),
    'repository evidence stale or unassessed',
  )
  assert.equal(
    workflowAttention('memory', { readiness: 'Needs setup', causes: [{ cause: 'PRIVATE' }] }),
    'needs setup',
  )
  assert.equal(workflowAttention('memory', { readiness: 'Denied' }), 'readiness denied')
  assert.equal(workflowAttention('memory', { freshness: 'stale' }), 'retained view stale')
  assert.equal(
    workflowAttention('memory', { latestAttempt: { outcome: 'integration-unavailable' } }),
    'latest attempt: integration-unavailable',
  )
  assert.equal(workflowAttention('memory', { conflict: ['PRIVATE'] }), 'memory conflict retained')
  assert.equal(workflowAttention('rtk', { status: 'unavailable', executed: false }), 'preview unavailable')
  for (const feature of ['goal', 'evidence', 'ux', 'run', 'memory', 'rtk'] as const) {
    assert.equal(workflowAttention(feature, { status: 'empty' }), undefined)
    assert.equal(workflowAttention(feature, 'assistant Markdown says blocked'), undefined)
  }
  assert.equal(
    workflowAttention('memory', {
      worker: 'active',
      latestAttempt: { outcome: 'pending' },
      publication: 'private-draft-not-published',
    }),
    undefined,
  )
})

test('one bounded above-editor informational projection; healthy only clears its own feature', async () => {
  const h = harness()
  const attention = registerWorkflowAttention(h.pi)
  await h.emit('session_start')
  attention.capture(h.ctx)('goal', { goal: { blockers: [{ status: 'open' }] } })
  assert.equal(h.updates.at(-1)?.key, WORKFLOW_ATTENTION_WIDGET)
  assert.equal(h.updates.at(-1)?.options.placement, 'aboveEditor')
  assert.equal(h.lines().length, 2)
  const lines = h.lines().join('\n')
  assert.match(lines, /Goal · observed status: 1 open blocker/)
  assert.match(lines, /\/mh-goal status to review/)
  assert.match(lines, /informational, not a permission gate/)
  assert.doesNotMatch(lines, /\/mh · inspect current owner state/)
  attention.capture(h.ctx)('memory', { readiness: 'Ready' })
  assert.match(h.lines().join('\n'), /Goal/)
  attention.capture(h.ctx)('memory', { readiness: 'Needs setup' })
  assert.match(h.lines().join('\n'), /Managed Memory/)
  attention.capture(h.ctx)('goal', { goal: null })
  assert.match(h.lines().join('\n'), /Managed Memory/)
  attention.capture(h.ctx)('memory', { readiness: 'Ready' })
  assert.equal(h.shown(), undefined)
})

test('lifecycle invalidates old async observations and cleans projection without rearming shutdown', async () => {
  for (const event of [
    'agent_start',
    'session_before_switch',
    'session_before_fork',
    'session_before_tree',
    'session_tree',
    'session_shutdown',
  ]) {
    const h = harness()
    const attention = registerWorkflowAttention(h.pi)
    await h.emit('session_start')
    attention.capture(h.ctx)('ux', { open_blockers: [1] })
    const pending = attention.capture(h.ctx)
    await h.emit(event)
    pending('ux', { open_blockers: [1, 2] })
    assert.equal(h.shown(), undefined, event)
    if (event === 'session_shutdown') {
      await h.emit('session_start')
      attention.capture(h.ctx)('ux', { open_blockers: [1] })
      assert.equal(h.shown(), undefined)
    }
  }
})

test('exact manager/session/cwd, non-TUI and known children are fenced', async () => {
  const h = harness()
  const attention = registerWorkflowAttention(h.pi)
  await h.emit('session_start')
  for (const ctx of [
    { ...h.ctx, sessionManager: { ...h.ctx.sessionManager } },
    { ...h.ctx, cwd: '/other' },
    { ...h.ctx, mode: 'rpc' },
  ])
    attention.capture(ctx)('memory', { readiness: 'Needs setup' })
  assert.equal(h.shown(), undefined)
  const pending = attention.capture(h.ctx)
  h.setId('different')
  pending('memory', { readiness: 'Needs setup' })
  assert.equal(h.shown(), undefined)
  await h.emit('session_start')
  await h.emit('before_agent_start', { systemPrompt: '<active_agent name="worker"/>' })
  attention.capture(h.ctx)('memory', { readiness: 'Needs setup' })
  assert.equal(h.shown(), undefined)
})

test('old completion/cleanup cannot clear a newer feature or replacement-manager widget', async () => {
  const h = harness()
  const first = registerWorkflowAttention(h.pi)
  await h.emit('session_start')
  const stale = first.capture(h.ctx)
  first.capture(h.ctx)('goal', { goal: { blockers: [{ status: 'open' }] } })
  stale('goal', { goal: null })
  assert.match(h.lines().join('\n'), /Goal/)
  const other = harness(h.ctx.ui)
  const second = registerWorkflowAttention(other.pi)
  await other.emit('session_start')
  second.capture(other.ctx)('memory', { readiness: 'Needs setup' })
  const count = h.updates.length
  await h.emit('session_shutdown')
  assert.equal(h.updates.length, count)
  assert.match(h.lines().join('\n'), /Managed Memory/)
})

test('source registrations observe only returned authorized owner results, not extra reads or wrappers', () => {
  const sources = [
    ['extensions/mahiro-goal.ts', 'goal', 'runtime.run'],
    ['extensions/mahiro-code-evidence.ts', 'evidence', 'runtime.run'],
    ['extensions/mahiro-ux-workflow.ts', 'ux', 'runtime.run'],
    ['extensions/mahiro-execution-run.ts', 'run', 'runtime.run'],
    ['extensions/mahiro-agent-memory.ts', 'memory', 'runtime.run'],
    ['lib/rtk.ts', 'rtk', 'run'],
  ]
  for (const [path, feature, operation] of sources) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    const match = source.match(
      new RegExp(
        `const (result|details) = await ${operation.replace('.', '\\.')}\\([^\\n]+\\)\\n\\s+observe\\('${feature}', \\1\\)`,
      ),
    )
    assert.ok(match, path)
    assert.match(source, /const observe = attention\.capture\(ctx\)/)
  }
  const helper = readFileSync(new URL('../lib/workflow-attention.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(
    helper,
    /node:fs|readFile|writeFile|executeTool\(|sendUserMessage\(|appendEntry\(|setInterval\(|setTimeout\(/,
  )
})
