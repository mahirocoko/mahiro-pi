import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Type } from 'typebox'
import { registerWorkflowAttention, WORKFLOW_ATTENTION_WIDGET } from '../lib/workflow-attention.ts'
import { registerWorkflowHub } from '../lib/workflow-hub.ts'
import { registerWorkflowPresentation } from '../lib/workflow-ui.ts'
import { initUsage, USAGE_WIDGET } from '../lib/usage.ts'
import { quotaController } from '../lib/quota.ts'
import { sessionWorkFixture } from './session-work-fixture.ts'

// Genuine public SDK/Faux command interception and owner callback delegation.
// Scripted public UI is not an installed/native-terminal or human visual test.
const fixture = () =>
  sessionWorkFixture({
    extensions: [
      (pi) => {
        registerWorkflowHub(pi)
        registerWorkflowPresentation(pi)
        const attention = registerWorkflowAttention(pi)
        pi.registerTool({
          name: 'fixture_workflow_observation',
          label: 'Synthetic workflow observation',
          description: 'Offline test-only returned blocker metadata, not a canonical workflow mutation.',
          parameters: Type.Object({}),
          async execute(_id, _args, _signal, _update, ctx) {
            const result = { goal: { blockers: [{ status: 'open' }] } }
            attention.capture(ctx)('goal', result)
            return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result }
          },
        })
        const usage = initUsage(pi)
        let quota: ReturnType<typeof quotaController> | undefined
        pi.on('session_start', async (_event, ctx) => {
          const geometry = await import('@earendil-works/pi-tui')
          quota = quotaController(ctx, () => {}, {
            fetch: async () => {
              throw new Error('Workflow fixture forbids external quota requests')
            },
          })
          usage.attach(ctx, quota, () => {}, geometry)
        })
        pi.on('session_shutdown', () => {
          usage.dispose()
          quota?.dispose()
        })
      },
    ],
  })

test('public SDK file-loaded owner is discoverable across independent extension module loaders', async () => {
  const f = await sessionWorkFixture({
    extensionPaths: [fileURLToPath(new URL('../extensions/mahiro-goal.ts', import.meta.url))],
    extensions: [registerWorkflowHub],
  })
  try {
    for (let generation = 0; generation < 2; generation++) {
      if (generation) await f.runtime.session.reload()
      const before = f.runtime.session.sessionManager.getEntries().length
      // The real Goal owner remains denied without its canonical Root authority.
      await f.command('mh-goal status', [])
      assert.ok(f.notices.some((notice) => /Goal.*unavailable/.test(notice)))
      const notices = f.notices.length
      await f.command('mh', ['Goal · /mh-goal'])
      assert.deepEqual(f.errors, [])
      assert.equal(f.notices.length, notices + 1, 'hub invokes the same denied canonical owner')
      assert.equal(f.runtime.session.sessionManager.getEntries().length, before)
      assert.equal(f.composerTouches, 0)
    }
  } finally {
    await f.dispose()
  }
})

test('public SDK separately file-loaded attention owners share one sink across a batch and reload', async () => {
  const base = fileURLToPath(new URL('../.agent-state/runtime/', import.meta.url))
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'workflow-files-'))
  const helper = fileURLToPath(new URL('../lib/workflow-attention.ts', import.meta.url))
  const paths = ['goal', 'memory'].map((feature) => {
    const path = join(dir, `${feature}.ts`)
    writeFileSync(
      path,
      `import { Type } from 'typebox'
import { registerWorkflowAttention } from ${JSON.stringify(helper)}
export default function fixture(pi) {
  const attention = registerWorkflowAttention(pi)
  pi.registerTool({
    name: 'fixture_file_${feature}', label: 'File-loaded observation fixture',
    description: 'Synthetic returned metadata only, not canonical mutation or acceptance.',
    parameters: Type.Object({ attention: Type.Boolean() }), executionMode: 'sequential',
    async execute(_id, args, _signal, _update, ctx) {
      const result = ${feature === 'goal' ? "{ goal: { blockers: args.attention ? [{ status: 'open' }] : [] } }" : "{ readiness: args.attention ? 'Needs setup' : 'Ready' }"}
      attention.capture(ctx)('${feature}', result)
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result }
    },
  })
}
`,
    )
    return path
  })
  const f = await sessionWorkFixture({ extensionPaths: paths })
  try {
    for (let generation = 0; generation < 2; generation++) {
      if (generation) await f.runtime.session.reload()
      f.faux.setResponses([
        f.ai.fauxAssistantMessage(
          [
            f.ai.fauxToolCall('fixture_file_goal', { attention: true }),
            f.ai.fauxToolCall('fixture_file_memory', { attention: true }),
            f.ai.fauxToolCall('fixture_file_goal', { attention: false }),
          ],
          { stopReason: 'toolUse' },
        ),
        f.ai.fauxAssistantMessage('Offline observation batch complete.'),
      ])
      await f.runtime.session.prompt('Exercise independent file-loaded observation owners')
      const widget = f.widgets.get(WORKFLOW_ATTENTION_WIDGET)
      assert.ok(widget, 'healthy Goal cannot clear the newer Managed Memory projection')
      assert.match(widget.render(80).join('\n'), /Managed Memory.*last observed: needs setup/)
      assert.deepEqual(f.errors, [])
    }
  } finally {
    await f.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('public SDK hub opens the same task/queue owners without a model turn or composer mutation', async () => {
  const f = await fixture()
  try {
    const task = await f.invoke('mh_task_create', { subject: 'Hub owner integration ภาษาไทย 👩🏽‍💻' })
    assert.equal(typeof task.id, 'string')
    const composer = structuredClone(f.composer)
    const draft = f.composerEditor.getText()
    const before = f.runtime.session.sessionManager.getEntries().length
    await f.command('mh', ['Todos', undefined])
    await f.command('mh', ['Queue / staging', undefined])
    assert.equal(
      f.runtime.session.sessionManager.getEntries().length,
      before,
      'navigation is not a user/model turn',
    )
    assert.deepEqual(f.composer, composer)
    assert.equal(f.composerEditor.getText(), draft)
    assert.equal(f.composerTouches, 0)
    const list = await f.invoke('mh_task_list')
    assert.ok(Array.isArray(list.tasks))
    assert.equal(list.tasks.length, 1)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('public SDK reload rebinds hub surfaces to fresh task/queue owners, preserving one branch journal', async () => {
  const f = await fixture()
  try {
    const task = await f.invoke('mh_task_create', { subject: 'Retained step before genuine reload' })
    const old = f.current()
    const prior = f.runtime.session.sessionManager
      .getEntries()
      .filter((entry) => entry.type === 'custom')
      .map((entry) => entry.id)
    await f.runtime.session.reload()
    await f.command('mh', ['Todos', undefined])
    await f.command('mh', ['Queue / staging', undefined])
    const list = await f.invoke('mh_task_list')
    assert.ok(Array.isArray(list.tasks))
    assert.equal(list.tasks.length, 1)
    assert.equal(list.tasks[0].id, task.id)
    assert.deepEqual(
      f.runtime.session.sessionManager
        .getEntries()
        .filter((entry) => entry.type === 'custom')
        .map((entry) => entry.id),
      prior,
    )
    assert.throws(() => old.queue.view(old.ctx), /retired/)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('public SDK usage command and hub are cache-only UI, not transcript/model turns', async () => {
  const f = await fixture()
  try {
    await f.textTurn('ordinary native usage fixture turn')
    const before = f.runtime.session.sessionManager.getEntries().length
    await f.command('mh', ['Usage'])
    assert.ok(f.widgets.has(USAGE_WIDGET))
    const rows = f.widgets.get(USAGE_WIDGET)!.render(80)
    assert.ok(rows.some((row) => row.includes('Mahiro Usage')))
    assert.equal(f.runtime.session.sessionManager.getEntries().length, before)
    await f.command('mh-usage status 1', [])
    assert.ok(f.widgets.has(USAGE_WIDGET))
    await f.command('mh-usage close', [])
    assert.equal(f.widgets.has(USAGE_WIDGET), false)
    assert.equal(f.runtime.session.sessionManager.getEntries().length, before)
    assert.equal(f.composerTouches, 0)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('public SDK tree navigation clears a captured usage panel and keeps fresh usage available', async () => {
  const f = await fixture()
  try {
    await f.textTurn('before usage tree checkpoint')
    const target = f.runtime.session.sessionManager
      .getBranch()
      .find((entry) => entry.type === 'message' && entry.message.role === 'assistant')
    assert.ok(target)
    await f.textTurn('after usage tree checkpoint')
    await f.command('mh-usage', [])
    assert.ok(f.widgets.has(USAGE_WIDGET))
    const result = await f.runtime.session.navigateTree(target.id, { summarize: false })
    assert.notEqual(result.cancelled, true)
    assert.equal(f.widgets.has(USAGE_WIDGET), false, 'captured pre-navigation snapshot must close')
    await f.command('mh-usage', [])
    assert.ok(f.widgets.has(USAGE_WIDGET), 'same-session attachment remains usable after tree navigation')
    assert.equal(f.composerTouches, 0)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})

test('public SDK returned observation produces bounded last-observed attention and expires next run', async () => {
  const f = await fixture()
  try {
    await f.invoke('fixture_workflow_observation')
    assert.ok(f.widgets.has(WORKFLOW_ATTENTION_WIDGET))
    const widget = f.widgets.get(WORKFLOW_ATTENTION_WIDGET)!
    const rows = widget.render(80)
    assert.equal(rows.length, 2)
    assert.ok(rows.some((row) => row.includes('last observed: 1 open blocker')))
    assert.ok(rows.some((row) => row.includes('not acceptance')))
    for (const width of [4, 20, 40, 80]) {
      assert.ok(widget.render(width).every((row) => f.tui.visibleWidth(row) <= width))
    }
    await f.textTurn('next actual SDK run clears previous observation')
    assert.equal(f.widgets.has(WORKFLOW_ATTENTION_WIDGET), false)
    assert.equal(f.composerTouches, 0)
    assert.deepEqual(f.errors, [])
  } finally {
    await f.dispose()
  }
})
