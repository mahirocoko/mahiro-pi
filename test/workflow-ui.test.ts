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

test('memory tool renderers display path, mode and readable diff/written content preview', async () => {
  await initializeWorkflowUI()
  const editRenderer = workflowRenderers('agent_memory_edit')
  const patchArgs = {
    path: 'system/human/prefs/coding.md',
    mode: 'patch',
    commit: true,
    oldText: '- Design authority: Only Gemini 3.1 Pro, Kimi K2.6, or Grok 4.2 may make visual decisions.',
    newText:
      '- Design authority: Only Gemini 3.1 Pro, Kimi K2.6, Grok 4.2, or Claude Opus 4.7 may make visual decisions.',
  }
  const patchDetails = {
    path: 'system/human/prefs/coding.md',
    hash: '7368352ddca6c6f60000000000000000',
    draft: false,
    committed: true,
    revision: '3236ad96d544f0001111222233334444',
    changed: 1,
    contextActivation: 'next_request',
  }
  const patchResult = {
    content: [{ type: 'text', text: JSON.stringify(patchDetails) }],
    details: patchDetails,
  } as any
  const callLines = editRenderer.renderCall!(patchArgs, theme, context).render(120)
  assert.deepEqual(callLines, ['● Memory · Edit · patch + commit · system/human/prefs/coding.md'])

  const tones: string[] = []
  const observedTheme = {
    fg: (tone: string, text: string) => {
      tones.push(tone)
      return text
    },
  } as any
  const collapsed = editRenderer.renderResult!(
    patchResult,
    { expanded: false, isPartial: false },
    observedTheme,
    { ...context, args: patchArgs },
  ).render(120)
  assert.equal(collapsed[0], '⎿ Returned · not acceptance')
  assert.equal(collapsed[1], '  path: system/human/prefs/coding.md · committed: true · rev: 3236ad96…')
  assert.ok(collapsed.some((line) => line.startsWith('  - - Design authority:')))
  assert.ok(
    collapsed.some((line) => line.startsWith('  + - Design authority:') && line.includes('Claude Opus 4.7')),
  )
  assert.ok(
    tones.every((tone) =>
      ['toolTitle', 'accent', 'muted', 'dim', 'warning', 'error', 'toolOutput'].includes(tone),
    ),
  )

  const expanded = editRenderer.renderResult!(patchResult, { expanded: true, isPartial: false }, theme, {
    ...context,
    args: patchArgs,
  }).render(120)
  assert.ok(expanded.includes('  Changes'))
  assert.ok(expanded.some((line) => line.startsWith('  + - Design authority:')))

  const styleCalls: Array<{ text: string; options: Record<string, unknown> }> = []
  const richTheme = {
    appearance: 'dark',
    colors: {
      toolPendingBg: { kind: 'rgb', r: 30, g: 34, b: 42 },
      toolDiffRemoved: { kind: 'rgb', r: 210, g: 80, b: 80 },
      toolDiffAdded: { kind: 'rgb', r: 70, g: 180, b: 100 },
    },
    fg: (_tone: string, text: string) => text,
    getFgAnsi: () => '\u001b[38;2;230;230;230m',
    getColorMode: () => 'truecolor',
    style: (text: string, options: Record<string, unknown>) => {
      styleCalls.push({ text, options })
      return options.bold ? `[W:${text}]` : `[R:${text}]`
    },
  } as any
  const richRows = editRenderer.renderResult!(patchResult, { expanded: false, isPartial: false }, richTheme, {
    ...context,
    args: patchArgs,
  }).render(120)
  assert.ok(richRows.some((line) => line.includes('[R:- - Design authority:')))
  assert.ok(richRows.some((line) => line.includes('[W:Claude]') && line.includes('[W:Opus]')))
  assert.ok(styleCalls.some((entry) => entry.options.bold === true && entry.options.bg !== undefined))
  assert.ok(styleCalls.some((entry) => entry.options.fg === 'text' && entry.options.bg !== undefined))

  const appendArgs = {
    path: 'system/human/prefs/coding.md',
    mode: 'append',
    section: 'Notes',
    text: '- Always use -E when installing dependencies',
  }
  assert.deepEqual(editRenderer.renderCall!(appendArgs, theme, context).render(120), [
    '● Memory · Edit · append · system/human/prefs/coding.md #Notes',
  ])
  const appendOut = editRenderer.renderResult!(
    { content: [], details: { path: 'system/human/prefs/coding.md', draft: true } } as any,
    { expanded: false, isPartial: false },
    theme,
    { ...context, args: appendArgs },
  ).render(120)
  assert.ok(appendOut.includes('  § Notes'))
  assert.ok(appendOut.includes('  + - Always use -E when installing dependencies'))

  const removeArgs = { path: 'reference/obsolete.md', text: null, commit: true }
  assert.deepEqual(editRenderer.renderCall!(removeArgs, theme, context).render(120), [
    '● Memory · Edit · remove + commit · reference/obsolete.md',
  ])
  const removeOut = editRenderer.renderResult!(
    { content: [], details: { path: 'reference/obsolete.md', committed: true } } as any,
    { expanded: false, isPartial: false },
    theme,
    { ...context, args: removeArgs },
  ).render(120)
  assert.ok(removeOut.includes('  - (removed reference/obsolete.md)'))

  const readRenderer = workflowRenderers('agent_memory_read')
  assert.deepEqual(
    readRenderer.renderCall!({ path: 'system/human/prefs/coding.md', offset: 4096 }, theme, context).render(
      120,
    ),
    ['● Memory · Read · from 4096 · system/human/prefs/coding.md'],
  )
  assert.deepEqual(readRenderer.renderCall!({ query: 'design authority' }, theme, context).render(120), [
    '● Memory · Read · query: design authority',
  ])

  const manageRenderer = workflowRenderers('agent_memory_manage')
  const rememberArgs = { action: 'remember', text: 'Prefer exact dependency versions' }
  assert.deepEqual(manageRenderer.renderCall!(rememberArgs, theme, context).render(120), [
    '● Memory · Manage · remember · Prefer exact dependency versions',
  ])
  const rememberOut = manageRenderer.renderResult!(
    {
      content: [],
      details: { path: 'system/human/notes.md', remembered: true, revision: 'abcd1234567890ef' },
    } as any,
    { expanded: false, isPartial: false },
    theme,
    { ...context, args: rememberArgs },
  ).render(120)
  assert.equal(rememberOut[1], '  path: system/human/notes.md · remembered: true · rev: abcd1234…')
  assert.ok(rememberOut.includes('  + Prefer exact dependency versions'))

  const reflectRenderer = workflowRenderers('agent_memory_reflect')
  assert.deepEqual(
    reflectRenderer.renderCall!({ assignment: 'Consolidate coding preferences' }, theme, context).render(120),
    ['● Memory · Reflect · Consolidate coding preferences'],
  )

  const commitRenderer = workflowRenderers('agent_memory_commit')
  assert.deepEqual(
    commitRenderer.renderCall!(
      { revision: '3236ad96d544f0001111222233334444', allowShrink: true },
      theme,
      context,
    ).render(120),
    ['● Memory · Integrate · allowShrink · rev 3236ad96…'],
  )
  const commitOut = commitRenderer.renderResult!(
    {
      content: [],
      details: {
        committed: true,
        revision: '3236ad96d544f0001111222233334444',
        files: ['system/human/prefs/coding.md', 'system/human/notes.md'],
      },
    } as any,
    { expanded: false, isPartial: false },
    theme,
    context,
  ).render(120)
  assert.equal(commitOut[1], '  committed: true · rev: 3236ad96…')
  assert.ok(commitOut.includes('  + system/human/prefs/coding.md'))
  assert.ok(commitOut.includes('  + system/human/notes.md'))
})

test('workflow tool renderers surface specific call metadata and result summaries across tools', async () => {
  await initializeWorkflowUI()

  const taskUpdate = workflowRenderers('mh_task_update')
  assert.deepEqual(
    taskUpdate.renderCall!(
      { id: 'task-1234567890', status: 'in_progress', description: 'Verify memory UI' },
      theme,
      context,
    ).render(120),
    ['● task update · in_progress · Verify memory UI'],
  )
  assert.deepEqual(
    taskUpdate.renderCall!({ id: 'task-1234567890', delete: true }, theme, context).render(120),
    ['● task update · delete · task-123'],
  )
  const deletedOut = taskUpdate.renderResult!(
    { content: [], details: { deleted: 'task-123' } } as any,
    { expanded: false, isPartial: false },
    theme,
    context,
  ).render(120)
  assert.equal(deletedOut[1], '  deleted: task-123')

  const updateGoal = workflowRenderers('mh_update_goal')
  assert.deepEqual(
    updateGoal.renderCall!({ action: 'set_phase', phase: 'verification' }, theme, context).render(120),
    ['● Goal · Update · set_phase · verification'],
  )
  assert.deepEqual(
    updateGoal.renderCall!(
      { action: 'add_plan_item', plan_status: 'in_progress', plan_text: 'Audit all registered tools' },
      theme,
      context,
    ).render(120),
    ['● Goal · Update · add_plan_item · in_progress: Audit all registered tools'],
  )
  assert.deepEqual(
    updateGoal.renderCall!(
      { action: 'add_rule', rule_level: 'must', rule_text: 'Preserve existing tests' },
      theme,
      context,
    ).render(120),
    ['● Goal · Update · add_rule · must: Preserve existing tests'],
  )
  assert.deepEqual(workflowSummary({ goal: { plan: [1, 2], rules: [1] } }), ['plan: 2', 'rules: 1'])

  const clearGoal = workflowRenderers('mh_clear_goal')
  assert.deepEqual(clearGoal.renderCall!({ goal_id: 'goal-alpha' }, theme, context).render(120), [
    '● Goal · Clear · goal-alpha',
  ])

  const evidence = workflowRenderers('mh_code_evidence')
  assert.deepEqual(
    evidence.renderCall!(
      { action: 'record', kind: 'test', result: 'passed', command: 'pnpm test' },
      theme,
      context,
    ).render(120),
    ['● Code Evidence · record · test · passed · pnpm test'],
  )
  const evidenceOut = evidence.renderResult!(
    {
      content: [],
      details: {
        status: 'recorded',
        summary: { verdict: { verdict: 'incomplete', reason: 'Missing manual review' } },
      },
    } as any,
    { expanded: false, isPartial: false },
    theme,
    context,
  ).render(120)
  assert.equal(evidenceOut[1], '  reason: Missing manual review · status: recorded · verdict: incomplete')

  const uxUpdate = workflowRenderers('mh_update_ux_workflow')
  assert.deepEqual(
    uxUpdate.renderCall!(
      { action: 'record_review', verdict: 'Ready', summary: 'Clean hierarchy' },
      theme,
      context,
    ).render(120),
    ['● UX · Update · record_review · Ready · Clean hierarchy'],
  )
  assert.deepEqual(
    uxUpdate.renderCall!(
      { action: 'set_handoff', handoff: { readiness: 'Ready for implementation' } },
      theme,
      context,
    ).render(120),
    ['● UX · Update · set_handoff · Ready for implementation'],
  )

  const execRun = workflowRenderers('mh_execution_run')
  assert.deepEqual(
    execRun.renderCall!(
      { operation: 'update', action: 'set_lane_status', lane_id: 'lane-1', status: 'completed' },
      theme,
      context,
    ).render(120),
    ['● Execution Run · update · set_lane_status · lane-1 · completed'],
  )

  const rtk = workflowRenderers('mh_rtk')
  assert.deepEqual(
    rtk.renderCall!({ operation: 'rewrite', command: 'git status --short' }, theme, context).render(120),
    ['● RTK · rewrite · git status --short'],
  )
  const rtkOut = rtk.renderResult!(
    {
      content: [],
      details: {
        mode: 'suggest',
        rewrite: { status: 'rewritten', candidate: 'rtk git status --short' },
      },
    } as any,
    { expanded: false, isPartial: false },
    theme,
    context,
  ).render(120)
  assert.equal(rtkOut[1], '  candidate: rtk git status --short · status: rewritten · mode: suggest')

  const codeMap = workflowRenderers('mh_code_map')
  assert.deepEqual(
    codeMap.renderCall!({ intent: 'outline', query: 'workflowRenderers' }, theme, context).render(120),
    ['● Code Map · outline · workflowRenderers'],
  )

  const recallSearch = workflowRenderers('recall_search')
  assert.deepEqual(
    recallSearch.renderCall!(
      { query: 'design authority', includeGlobal: true, crossProject: true },
      theme,
      context,
    ).render(120),
    ['● Recall · Search · global + cross-project · design authority'],
  )
  const searchOut = recallSearch.renderResult!(
    {
      content: [],
      details: [
        {
          recordId: 'rec-1',
          sourceKind: 'letta_message',
          quote: 'Only Gemini 3.1 Pro or Claude Opus 4.7',
        },
        { recordId: 'rec-2', sourceKind: 'pi_message', quote: 'Secondary match' },
      ],
    } as any,
    { expanded: false, isPartial: false },
    theme,
    context,
  ).render(120)
  assert.equal(searchOut[1], '  hits: 2 · rec-1')
  assert.ok(searchOut.includes('  • rec-1: Only Gemini 3.1 Pro or Claude Opus 4.7'))

  const recallRead = workflowRenderers('recall_read')
  assert.deepEqual(
    recallRead.renderCall!({ recordId: 'rec-1', query: 'Opus 4.7' }, theme, context).render(120),
    ['● Recall · Read · query: Opus 4.7 · rec-1'],
  )
  const readOut = recallRead.renderResult!(
    {
      content: [],
      details: {
        evidence: 'UNTRUSTED',
        recordId: 'rec-1',
        sourceKind: 'letta_message',
        path: 'history/session.json',
        quote: 'Line 1 quote\nLine 2 quote',
      },
    } as any,
    { expanded: false, isPartial: false },
    theme,
    context,
  ).render(120)
  assert.equal(readOut[1], '  path: history/session.json · recordId: rec-1 · sourceKind: letta_message')
  assert.ok(readOut.includes('  │ Line 1 quote'))
})
