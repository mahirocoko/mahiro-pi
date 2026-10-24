import assert from 'node:assert/strict'
import test from 'node:test'
import { registerWorkflowCommand, registerWorkflowHub, registerWorkflowSurface } from '../lib/workflow-hub.ts'

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
