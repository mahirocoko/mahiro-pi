import assert from 'node:assert/strict'
import test from 'node:test'
import { initializeWorkflowUI, workflowRenderers, workflowSummary } from '../lib/workflow-ui.ts'

const theme = { fg: (_tone: string, text: string) => text } as any
const context = { isError: false, executionStarted: true, isPartial: false, outputPad: 0 } as any

test('combined identity/result lifecycle stays compact, neutral and truthful', async () => {
  await initializeWorkflowUI()
  const renderer = workflowRenderers('mh_execution_run')
  assert.equal(renderer.renderShell, 'self')
  const args = { operation: 'update', summary: 'Review implementation' }
  const result = { content: [{ type: 'text', text: 'captured' }], details: { status: 'reported' } } as any
  const tones: string[] = []
  const observedTheme = {
    fg: (tone: string, text: string) => {
      tones.push(tone)
      return text
    },
  } as any
  for (const step of [
    {
      executionStarted: false,
      isPartial: false,
      isError: false,
      call: 'requested',
      state: 'Returned · not acceptance',
    },
    { executionStarted: true, isPartial: true, isError: false, call: '', state: 'Partial · pending' },
    {
      executionStarted: true,
      isPartial: false,
      isError: false,
      call: '',
      state: 'Returned · not acceptance',
    },
    { executionStarted: true, isPartial: false, isError: true, call: '', state: 'Error' },
    {
      executionStarted: true,
      isPartial: true,
      isError: true,
      call: '',
      state: 'Partial · pending · Error',
    },
  ]) {
    const ctx = { ...context, ...step }
    const call = renderer.renderCall!(args, observedTheme, ctx).render(200)
    const output = renderer.renderResult!(
      result,
      { expanded: false, isPartial: step.isPartial },
      observedTheme,
      ctx,
    ).render(200)
    assert.equal(call.length, 1)
    assert.ok(call[0].startsWith('● Execution Run'))
    assert.ok(call[0].endsWith(' · Review implementation'))
    if (step.call) assert.ok(call[0].includes(` · ${step.call} · update · Review implementation`))
    else assert.doesNotMatch(call[0], /requested|running|pending/)
    assert.equal(output.length, 2)
    assert.equal(output[0], `⎿ ${step.state}`)
    assert.doesNotMatch(output.join('\n'), /Execution Run|Expand for|✓/)
    if (!step.isPartial) assert.doesNotMatch(output.join('\n'), /pending|running/)
  }
  assert.ok(tones.includes('toolTitle'))
  assert.ok(tones.includes('accent'))
  assert.ok(
    tones.every((tone) =>
      ['toolTitle', 'accent', 'muted', 'dim', 'warning', 'error', 'toolOutput'].includes(tone),
    ),
  )
  for (const details of [{ error: 'denied' }, { ok: false }]) {
    for (const isPartial of [false, true]) {
      const output = renderer.renderResult!(
        { ...result, details },
        { expanded: false, isPartial },
        theme,
        context,
      ).render(100)
      assert.equal(output[0], isPartial ? '⎿ Partial · pending · Error' : '⎿ Error')
    }
  }
})

test('summary priority is independent of property order and private fields are not traversed', () => {
  const fields = {
    id: 'optional-id',
    tasks: [1, 2],
    title: 'Ship inspector',
    next_action: 'Review diff',
    revision: '0123456789abcdef0123456789abcdef',
    status: 'blocked',
    blockers: [{ status: 'open', reason: 'review' }, { status: 'resolved' }],
    error: 'Needs attention',
    auth: { error: 'PRIVATE' },
  }
  const expected = [
    'error: Needs attention',
    'blockers: 1 · review',
    'status: blocked',
    'rev: 01234567…',
    'next_action: Review diff',
    'Ship inspector',
  ]
  assert.deepEqual(workflowSummary(fields), expected)
  assert.deepEqual(workflowSummary(Object.fromEntries(Object.entries(fields).reverse())), expected)
  assert.deepEqual(
    workflowSummary({ id: 'first', goal: { status: 'blocked', conflicts: ['resolve'] } }).slice(0, 2),
    ['conflicts: 1 · resolve', 'status: blocked'],
  )
  assert.deepEqual(workflowSummary('completed'), [])
  assert.deepEqual(workflowSummary({ goal: null }), ['goal: none'])
  assert.deepEqual(workflowSummary({ tasks: [1, 2], criteria: [1], evidence: [], lanes: [1, 2, 3] }), [
    'criteria: 1',
    'evidence: 0',
    'lanes: 3',
    'tasks: 2',
  ])
  const renderer = workflowRenderers('mh_get_goal')
  const output = renderer.renderResult!(
    { content: [], details: fields },
    { expanded: false, isPartial: false },
    theme,
    context,
  ).render(80)
  assert.equal(output.length, 2)
  assert.ok(output[1].startsWith('  error: Needs attention · blockers: 1 · review'))
})

test('expanded output preserves all captured data, exact revisions and honest non-text placeholders', () => {
  const renderer = workflowRenderers('mh_get_goal')
  const text = Array.from({ length: 40 }, (_, i) => `ข้อความ 👩‍💻 ${i}`).join('\n')
  const revision = 'abcdef0123456789abcdef0123456789'
  const details = { goal: { status: 'blocked', revision, blockers: [{ status: 'open', reason: 'review' }] } }
  const result = {
    content: [
      { type: 'text', text },
      { type: 'image', data: 'untouched', mimeType: 'image/png' },
    ],
    details,
  } as any
  const before = JSON.stringify(result)
  const expanded = renderer.renderResult!(result, { expanded: true, isPartial: false }, theme, context)
  const lines = expanded.render(200)
  assert.equal(lines[0], '⎿ Returned · not acceptance')
  assert.match(lines.join('\n'), /ข้อความ 👩‍💻 39/)
  assert.ok(lines.join('\n').includes(`"revision": "${revision}"`))
  assert.match(lines.join('\n'), /\[image content retained in native result\]/)
  assert.doesNotMatch(lines.join('\n'), /Goal · Read/)
  for (const isPartial of [false, true]) {
    const output = renderer.renderResult!(result, { expanded: true, isPartial }, theme, {
      ...context,
      isError: true,
    }).render(100)
    assert.equal(output[0], isPartial ? '⎿ Partial · pending · Error' : '⎿ Error')
  }
  assert.equal(JSON.stringify(result), before)
  expanded.invalidate()
})

test('fallback, Unicode, ANSI/OSC and padding stay sanitized and width-safe', async () => {
  const { visibleWidth } = await import('@earendil-works/pi-tui')
  const renderer = workflowRenderers('mh_create_goal')
  const raw =
    '\u001b]8;;https://invalid.example\u0007linked\u001b]8;;\u0007\u001b[31mred\u001b[0m\u0000\nภาษาไทย 中文 👩🏽‍💻 é'
  const result = { content: [{ type: 'text', text: raw }], details: undefined } as any
  const before = JSON.stringify(result)
  const styled = {
    fg: (_tone: string, text: string) => {
      assert.doesNotMatch(text, /\u001b|\u0000|https:\/\//)
      return `\u001b[90m${text}\u001b[0m`
    },
  } as any
  for (const outputPad of [0, 1, 8, 100]) {
    const ctx = { ...context, outputPad, isPartial: true }
    const components = [renderer.renderCall!({ title: raw, operation: raw }, styled, ctx)]
    for (const expanded of [false, true])
      components.push(renderer.renderResult!(result, { expanded, isPartial: false }, styled, ctx))
    for (const component of components) {
      assert.deepEqual(component.render(0), [])
      for (const width of [1, 2, 3, 7, 19, 80]) {
        for (const line of component.render(width))
          assert.ok(visibleWidth(line) <= width, `${width}: ${line}`)
      }
    }
  }
  const fallback = renderer.renderResult!(
    result,
    { expanded: false, isPartial: false },
    theme,
    context,
  ).render(200)
  assert.equal(fallback.length, 2)
  assert.match(fallback[1], /linkedred ภาษาไทย 中文 👩🏽‍💻 é/)
  const empty = renderer.renderResult!(
    { content: [] } as any,
    { expanded: false, isPartial: false },
    theme,
    context,
  ).render(100)
  assert.deepEqual(empty, ['⎿ Returned · not acceptance'])
  assert.equal(JSON.stringify(result), before)
})

test('requested state precedes long subjects, while HTML-like replay calls stay neutral', () => {
  const renderer = workflowRenderers('mh_execution_run')
  const args = { operation: 'get', summary: 'Long subject '.repeat(20) }
  const markers: [string, string][] = []
  const styled = {
    fg: (tone: string, text: string) => {
      markers.push([tone, text])
      return text
    },
  } as any
  const requested = renderer.renderCall!(args, styled, {
    ...context,
    executionStarted: false,
    isPartial: true,
  })
  for (const width of [29, 40, 60]) assert.ok(requested.render(width)[0].includes(' · requested'))
  assert.ok(markers.some(([tone, text]) => text === '●' && tone === 'muted'))
  assert.ok(!requested.render(29)[0].includes('●'))

  // Pi HTML export replays completed calls with executionStarted/isPartial both true.
  // The call row must not claim running when its separately rendered result is final.
  const replayed = renderer.renderCall!(args, theme, {
    ...context,
    executionStarted: true,
    isPartial: true,
    argsComplete: true,
  })
  assert.doesNotMatch(replayed.render(80).join('\n'), /requested|running|pending/)

  const details = { run: { stage: 'reported', revision: 4, blockers: [] } }
  const result = { content: [], details } as any
  const output = renderer.renderResult!(result, { expanded: false, isPartial: false }, theme, context)
  assert.deepEqual(output.render(60), [
    '⎿ Returned · not acceptance',
    '  stage: reported · rev: 4 · blockers: 0',
  ])
  const narrow = renderer.renderResult!(result, { expanded: false, isPartial: false }, theme, {
    ...context,
    outputPad: 8,
  })
  assert.equal(narrow.render(25)[0], 'Returned · not acceptance')
  assert.ok(narrow.render(19).every((line) => !line.startsWith(' ') && !line.includes('⎿')))
  assert.deepEqual(
    workflowSummary({
      status: 'blocked',
      revision: 4,
      run: { status: 'blocked', revision: 4, currentRevision: 5, baseRevision: 3 },
      goal: { status: 'blocked', revision: 4, blockers: ['review'] },
    }),
    ['blockers: 1 · review', 'status: blocked', 'rev: 4', 'base rev: 3', 'current rev: 5'],
  )
})
