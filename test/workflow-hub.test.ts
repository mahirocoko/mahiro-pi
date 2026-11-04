import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createHubMenuPanel,
  registerWorkflowCommand,
  registerWorkflowHub,
  registerWorkflowSurface,
} from '../lib/workflow-hub.ts'

function harness() {
  const events = new Map<string, ((...args: any[]) => any)[]>()
  const commands = new Map<string, any>()
  let id = 'session-one'
  let parent: string | undefined
  const manager = { getSessionId: () => id, getHeader: () => ({ parentSession: parent }) }
  const ctx = {
    mode: 'tui',
    hasUI: true,
    cwd: '/project',
    sessionManager: manager,
    ui: { select: async (_title: string, options: string[]) => options[0], notify() {} },
  } as any
  const pi = {
    on(name: string, handler: (...args: any[]) => any) {
      events.set(name, [...(events.get(name) ?? []), handler])
    },
    registerCommand(name: string, command: any) {
      commands.set(name, command)
    },
  } as any
  const emit = async (name: string, event = {}) => {
    for (const handler of events.get(name) ?? []) await handler(event, ctx)
  }
  return {
    pi,
    ctx,
    commands,
    emit,
    setId: (value: string) => {
      id = value
    },
    child: () => {
      parent = 'parent'
    },
  }
}

test('hub delegates same registered owner status handler and never creates state', async () => {
  const h = harness()
  const calls: unknown[] = []
  const command = {
    handler: async (args: string, ctx: any) => {
      calls.push([args, ctx])
    },
  }
  registerWorkflowCommand(h.pi, 'mh-goal', command)
  registerWorkflowHub(h.pi)
  assert.equal(h.commands.get('mh-goal'), command)
  await h.emit('session_start')
  await h.commands.get('mh').handler('', h.ctx)
  assert.deepEqual(calls, [['status', h.ctx]])
  await h.emit('session_shutdown')
  await h.emit('session_start')
  await h.commands.get('mh').handler('', h.ctx)
  assert.equal(calls.length, 1, 'shutdown factories cannot rearm')
})

test('cancelled transitions retain future navigation but invalidate pending picks', async () => {
  for (const event of ['session_before_switch', 'session_before_fork', 'session_before_tree']) {
    const h = harness()
    let calls = 0
    registerWorkflowSurface(h.pi, {
      id: 'tasks',
      label: 'Tasks',
      open: () => {
        calls++
      },
    })
    registerWorkflowHub(h.pi)
    await h.emit('session_start')
    h.ctx.ui.select = async () => {
      await h.emit(event)
      return 'Tasks'
    }
    await h.commands.get('mh').handler('', h.ctx)
    assert.equal(calls, 0)
    // A later extension cancels the transition: no start/tree event follows.
    h.ctx.ui.select = async () => 'Tasks'
    await h.commands.get('mh').handler('', h.ctx)
    assert.equal(calls, 1)
  }
})

test('exact session identity, child contexts and explicit disposal fail closed', async () => {
  const h = harness()
  let calls = 0
  const dispose = registerWorkflowSurface(h.pi, {
    id: 'tasks',
    label: 'Tasks',
    open: async () => {
      calls++
    },
  })
  registerWorkflowHub(h.pi)
  await h.emit('session_start')
  h.ctx.ui.select = async () => {
    h.setId('other')
    return 'Tasks'
  }
  await h.commands.get('mh').handler('', h.ctx)
  assert.equal(calls, 0)
  dispose()
  await h.emit('session_start')
  h.ctx.ui.select = async () => 'Tasks'
  await h.commands.get('mh').handler('', h.ctx)
  assert.equal(calls, 0)
  h.child()
  await h.emit('session_start')
  await h.commands.get('mh').handler('', h.ctx)
  assert.equal(calls, 0)
})

test('hub groups multiple workflow surfaces under Workflows and supports Back to /mh navigation', async () => {
  const h = harness()
  const calls: string[] = []
  let terminalListener: ((data: string) => { data?: string; consume?: boolean } | undefined) | undefined
  h.ctx.ui.onTerminalInput = (fn: typeof terminalListener) => {
    terminalListener = fn
    return () => {
      if (terminalListener === fn) terminalListener = undefined
    }
  }
  registerWorkflowCommand(
    h.pi,
    'mh-goal',
    {
      handler: async (args: string) => {
        calls.push(`goal:${args}`)
      },
    },
    {
      open: async (ctx) => {
        calls.push('goal:open')
        const pick = await ctx.ui.select('Goal', ['Inspect', '← Back'])
        if (pick === 'Inspect') calls.push('goal:inspect')
        return !pick || pick === '← Back'
      },
    },
  )
  registerWorkflowCommand(h.pi, 'mh-evidence', {
    handler: async (args: string) => {
      calls.push(`evidence:${args}`)
    },
  })
  registerWorkflowSurface(h.pi, {
    id: 'tasks',
    label: 'Todos',
    open: async () => {
      calls.push('todos:open')
    },
  })
  registerWorkflowHub(h.pi)
  await h.emit('session_start')
  const picks: Array<string | undefined> = [
    'Workflows (Goal / Evidence / UX / Run) ▸',
    'Goal · /mh-goal',
    undefined, // Esc/← inside Goal steps back to Workflows
    undefined, // Esc/← inside Workflows steps back to /mh
    'Todos',
  ]
  h.ctx.ui.select = async (_title: string, options: string[]) => {
    if (terminalListener) {
      assert.deepEqual(terminalListener('\x1b[D'), { data: '\x1b' })
      assert.deepEqual(terminalListener('\x7f'), { data: '\x1b' })
    }
    const next = picks.shift()
    if (next !== undefined) assert.ok(options.includes(next), `Expected ${next} in ${options.join(', ')}`)
    return next
  }
  await h.commands.get('mh').handler('', h.ctx)
  assert.deepEqual(calls, ['goal:open', 'todos:open'])
  assert.equal(picks.length, 0)
  assert.equal(terminalListener, undefined, 'terminal input listener is cleaned up after select')
})

test('createHubMenuPanel renders two-column SelectList spacing, focused description and Left/Backspace back', async () => {
  const tui = await import('@earendil-works/pi-tui')
  let result: string | undefined = 'unset'
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as any
  const panel = createHubMenuPanel({
    tui,
    title: 'Mahiro Control Center · owner-authorized status & controls',
    items: [
      {
        value: 'Managed Memory · /mh-memory',
        label: 'Managed Memory  open',
        description: 'Project memory, pending proposals, Palace preview and Letta sync · /mh-memory',
      },
      {
        value: 'Usage',
        label: 'Usage  open',
        description: 'Native usage bar, compact footer and quota status panel · /mh-usage',
      },
    ],
    hint: '↑/↓ focus · Enter/Space select · Esc close',
    theme: () => theme,
    done: (value) => {
      result = value
    },
    requestRender: () => {},
  })
  const lines = panel.render(110)
  assert.equal(lines[0].trimEnd(), 'Mahiro Control Center · owner-authorized status & controls')
  assert.equal(lines[1], '')
  assert.match(lines[2], /^→ Managed Memory  open\s+Project memory, pending proposals/)
  assert.match(lines[3], /^  Usage  open\s+Native usage bar, compact footer/)
  assert.equal(
    lines[2].indexOf('Project memory'),
    lines[3].indexOf('Native usage'),
    'right-hand descriptions align at the exact same column',
  )
  assert.equal(
    lines[4].trimEnd(),
    'Project memory, pending proposals, Palace preview and Letta sync · /mh-memory',
  )
  assert.equal(lines[5].trimEnd(), '↑/↓ focus · Enter/Space select · Esc close')
  panel.handleInput?.('\x1b[B')
  const moved = panel.render(110)
  assert.equal(moved[4].trimEnd(), 'Native usage bar, compact footer and quota status panel · /mh-usage')
  panel.handleInput?.('\x1b[D')
  assert.equal(result, undefined, 'Left Arrow cancels/steps back')
})
