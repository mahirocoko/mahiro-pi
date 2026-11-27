import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { RpcCommand, RpcExtensionUIRequest, RpcResponse } from '@earendil-works/pi-coding-agent'
import { isTaskOperation } from '../lib/session-work/task-model.ts'
import { sessionWorkFixture } from './session-work-fixture.ts'

const flag = '--todos-rpc-fixture'

if (process.argv[2] === flag) {
  const rpcRoot = process.argv[3]
  assert.ok(rpcRoot)
  const fixture: Awaited<ReturnType<typeof sessionWorkFixture>> = await sessionWorkFixture({
    rpcRoot,
    extensions: [
      (pi) => {
        // Test-only driver for SDK lifecycle commands not exposed as RPC verbs.
        pi.registerCommand('fixture-tree', {
          handler: async (args, ctx) => {
            assert.equal((await ctx.navigateTree(args, { summarize: false })).cancelled, false)
          },
        })
        pi.registerCommand('fixture-reload', { handler: (_args, ctx) => ctx.reload() })
        pi.on('input', (event) => {
          const prefix = 'fixture tool '
          const reply = fixture.ai.fauxAssistantMessage('Fixture turn complete.')
          if (!event.text.startsWith(prefix)) {
            fixture.faux.setResponses([reply])
            return
          }
          const { name, args } = JSON.parse(event.text.slice(prefix.length))
          fixture.faux.setResponses([
            fixture.ai.fauxAssistantMessage([fixture.ai.fauxToolCall(name, args)], { stopReason: 'toolUse' }),
            reply,
          ])
        })
      },
    ],
  })
  await fixture.sdk.runRpcMode(fixture.runtime)
} else {
  test('native RPC Todos sends bounded read-only notices and follows mutation and branch lifecycle', {
    timeout: 30_000,
  }, async (t) => {
    const base = resolve('.agent-state/runtime')
    mkdirSync(base, { recursive: true })
    const root = mkdtempSync(join(base, 'session-work-rpc-'))
    const child = spawn(
      process.execPath,
      ['--import', './test/public-dependency-loader.mjs', fileURLToPath(import.meta.url), flag, root],
      { signal: t.signal },
    )
    // The child owns SDK shutdown. The parent owns cleanup of the exact fixture root.
    const closed = once(child, 'close')
    child.on('error', () => {})
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000)
    })
    const reader = createInterface({ input: child.stdout })
    const lines = reader[Symbol.asyncIterator]()
    let id = 0
    let status: string | undefined
    const notifications: string[] = []
    type WireEvent =
      | RpcExtensionUIRequest
      | RpcResponse
      | { type: 'agent_settled' | 'extension_error'; error?: string }
    async function receive(dialog: string[] = []): Promise<WireEvent> {
      const next = await lines.next()
      assert.ok(!next.done, `RPC exited early: ${stderr}`)
      const event = JSON.parse(next.value) as WireEvent
      assert.notEqual(event.type, 'extension_error', next.value)
      if (event.type === 'extension_ui_request') {
        if (event.method === 'setStatus' && event.statusKey === 'mahiro-todos') status = event.statusText
        if (event.method === 'notify') notifications.push(event.message)
        if (event.method === 'input' || event.method === 'select') {
          const value = dialog.shift()
          assert.notEqual(value, undefined, `Unexpected RPC dialog: ${next.value}`)
          child.stdin.write(`${JSON.stringify({ type: 'extension_ui_response', id: event.id, value })}\n`)
        }
      }
      return event
    }
    async function rpc<Type extends RpcCommand['type']>(
      command: Extract<RpcCommand, { type: Type }>,
      dialog: string[] = [],
    ) {
      const requestId = `request-${++id}`
      child.stdin.write(`${JSON.stringify({ ...command, id: requestId })}\n`)
      while (true) {
        const event = await receive(dialog)
        if (event.type !== 'response' || event.id !== requestId) continue
        assert.equal(event.command, command.type)
        assert.ok(event.success, JSON.stringify(event))
        assert.deepEqual(dialog, [])
        return event as Extract<RpcResponse, { success: true; command: Type }>
      }
    }
    async function prompt(message: string, dialog: string[] = [], disposition = 'handled') {
      const response = await rpc<'prompt'>({ type: 'prompt', message }, dialog)
      assert.equal(response.data.disposition, disposition)
      if (disposition === 'started') while ((await receive()).type !== 'agent_settled') {}
    }
    const entries = async () => (await rpc<'get_entries'>({ type: 'get_entries' })).data
    async function tool(name: string, args: Record<string, unknown>) {
      await prompt(`fixture tool ${JSON.stringify({ name, args })}`, [], 'started')
      const result = (await entries()).entries.findLast(
        (entry) => entry.type === 'message' && entry.message.role === 'toolResult',
      )
      assert.ok(result?.type === 'message' && result.message.role === 'toolResult')
      assert.ok(!result.message.isError, JSON.stringify(result.message.content))
      const text = result.message.content[0]
      assert.ok(text?.type === 'text')
      return JSON.parse(text.text) as { id: string; revision: number }
    }
    try {
      await prompt('/mh-todos', ['Create step', 'First step'])
      assert.equal(status, 'Todos 0/1 · 1 pending')
      const before = await entries()
      assert.ok(before.leafId)
      const task = await tool('mh_task_create', {
        subject: `\x1b[31mActive\n\u202e title ${'x'.repeat(100)}\x1b[0m`,
        description: 'not for status',
        metadata: { secret: 'never included' },
      })
      const firstEntry = (await entries()).entries.find(
        (entry) => entry.type === 'custom' && entry.customType === 'mahiro-session-tasks-v1',
      )
      assert.ok(firstEntry?.type === 'custom')
      const operation = (firstEntry.data as { operation?: unknown }).operation
      assert.ok(isTaskOperation(operation) && operation.kind === 'put')
      const firstId = operation.task.id
      const active = await tool('mh_task_update', {
        id: task.id,
        expected_revision: task.revision,
        status: 'in_progress',
        blockedBy: [firstId],
      })
      const activeTitle = `Active  title ${'x'.repeat(65)}…`
      assert.equal(status, `Todos 0/2 · ${activeTitle}`)
      const activeBranch = await entries()
      assert.ok(activeBranch.leafId)
      await prompt('/mh-todos status')
      assert.deepEqual(notifications.splice(0), [
        `Todos 0/2 · 1 pending · 1 in_progress · 0 completed\npending · First step · 0 open dependencies\nin_progress · ${activeTitle} · 1 open dependencies`,
      ])
      assert.deepEqual(
        await entries(),
        activeBranch,
        'native handled command writes no transcript or journal entry',
      )
      await prompt('Quoted `/mh-todos status` is not a command.', [], 'started')
      assert.deepEqual(notifications, [])

      await prompt('/mh-todos', ['View mode', 'off'])
      assert.equal(status, undefined)
      await prompt('/mh-todos status')
      assert.match(notifications.pop() ?? '', /^Todos 0\/2/)
      await prompt('/mh-todos', ['View mode', 'quiet'])
      assert.equal(status, `Todos 0/2 · ${activeTitle}`)
      await prompt(`/fixture-tree ${before.leafId}`)
      assert.equal(status, 'Todos 0/1 · 1 pending')
      await prompt(`/fixture-tree ${activeBranch.leafId}`)
      assert.equal(status, `Todos 0/2 · ${activeTitle}`)
      status = undefined // Simulate a host clearing its status map before extension reload.
      await prompt('/fixture-reload')
      assert.equal(status, `Todos 0/2 · ${activeTitle}`)

      const parent = (await rpc<'get_state'>({ type: 'get_state' })).data
      assert.ok(parent.sessionFile)
      await rpc<'clone'>({ type: 'clone' })
      assert.equal(status, `Todos 0/2 · ${activeTitle}`)
      await tool('mh_task_update', { id: active.id, expected_revision: active.revision, status: 'completed' })
      assert.equal(status, 'Todos 1/2 · 1 pending')
      await prompt('/mh-todos', [firstId, 'completed'])
      assert.equal(status, undefined)
      await rpc<'new_session'>({ type: 'new_session' })
      assert.equal(status, undefined)
      await rpc<'switch_session'>({ type: 'switch_session', sessionPath: parent.sessionFile })
      assert.equal(status, `Todos 0/2 · ${activeTitle}`)
      await rpc<'new_session'>({ type: 'new_session' })
      assert.equal(status, undefined, 'new session clears the outgoing open branch status')
    } finally {
      reader.close()
      child.stdin.end()
      try {
        await closed
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })
}
