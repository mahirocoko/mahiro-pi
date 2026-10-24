import assert from 'node:assert/strict'
import test from 'node:test'
import { initializeWorkflowUI, workflowRenderers, workflowSummary } from '../lib/workflow-ui.ts'

const theme = { fg: (_tone: string, text: string) => text } as any
const context = { isError: false, executionStarted: true } as any

test('workflow cards retain captured text/details on expand and bound collapsed output', async () => {
  await initializeWorkflowUI()
  const renderer = workflowRenderers('mh_get_goal')
  const text = Array.from({ length: 40 }, (_, i) => `ข้อความ 👩‍💻 ${i}`).join('\n')
  const details = {
    goal: { status: 'blocked', revision: 4, blockers: [{ status: 'open', reason: 'review' }] },
  }
  const result = { content: [{ type: 'text', text }], details } as any
  const before = JSON.stringify(result)
  const collapsed = renderer.renderResult!(result, { expanded: false, isPartial: false }, theme, context)
  assert.ok(collapsed.render(80).length <= 9)
  assert.match(collapsed.render(80).join('\n'), /revision: 4/)
  assert.match(collapsed.render(80).join('\n'), /blockers: 1/)
  const expanded = renderer.renderResult!(result, { expanded: true, isPartial: false }, theme, context)
  assert.match(expanded.render(120).join('\n'), /ข้อความ 👩‍💻 39/)
  assert.match(expanded.render(120).join('\n'), /"revision": 4/)
  assert.equal(JSON.stringify(result), before)
  expanded.invalidate()
  const { visibleWidth } = await import('@earendil-works/pi-tui')
  for (const width of [1, 2, 7, 19]) {
    for (const line of expanded.render(width)) assert.ok(visibleWidth(line) <= width)
  }
})

test('error and streaming never claim green success; summary only trusts structured fields', () => {
  const renderer = workflowRenderers('mh_execution_run')
  const result = {
    content: [{ type: 'text', text: 'assistant says completed' }],
    details: { status: 'pending' },
  } as any
  const partial = renderer.renderResult!(result, { expanded: false, isPartial: true }, theme, context)
  assert.match(partial.render(100).join('\n'), /partial · pending/)
  const failed = renderer.renderResult!(result, { expanded: false, isPartial: false }, theme, {
    ...context,
    isError: true,
  })
  assert.match(failed.render(100).join('\n'), /error/)
  assert.deepEqual(workflowSummary('completed'), [])
  assert.deepEqual(workflowSummary({ goal: null }), ['goal: none'])
})

test('human feature/subject labels, bounded counts and next action exclude private field traversal', () => {
  const summary = workflowSummary({
    title: 'Ship inspector',
    tasks: [1, 2],
    criteria: [1],
    evidence: [],
    lanes: [1, 2, 3],
    next_action: 'Review the diff',
    auth: { status: 'PRIVATE' },
  })
  assert.match(summary.join('\n'), /Ship inspector/)
  assert.match(summary.join('\n'), /tasks: 2/)
  assert.match(summary.join('\n'), /lanes: 3/)
  assert.match(summary.join('\n'), /next_action: Review the diff/)
  assert.doesNotMatch(summary.join('\n'), /PRIVATE/)
  const renderer = workflowRenderers('mh_create_goal')
  assert.equal(renderer.renderShell, 'self')
  const call = renderer.renderCall!({ mission: 'Goal subject' }, theme, context)
  assert.match(call.render(100).join('\n'), /Goal · Create/)
  assert.match(call.render(100).join('\n'), /Goal subject/)
  const unsafe = {
    content: [
      {
        type: 'text',
        text: '\u001b]8;;https://invalid.example\u0007linked\u001b]8;;\u0007\u001b[31mred\u001b[0m',
      },
    ],
    details: undefined,
  } as any
  const output = renderer.renderResult!(unsafe, { expanded: true, isPartial: false }, theme, context)
    .render(100)
    .join('\n')
  assert.doesNotMatch(output, /\u001b|https:\/\//)
  assert.match(output, /linkedred/)
})
