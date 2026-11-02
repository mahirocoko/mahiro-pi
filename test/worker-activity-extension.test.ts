import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import workerActivity from '../extensions/mahiro-worker-activity.ts'
import { workerOwner } from '../lib/worker-activity.ts'

test('one profile setup automatically follows TUI replacement/reload; non-TUI and late startup cannot retire it', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-auto-web-')))
  const profile = join(root, 'profile')
  mkdirSync(profile, { mode: 0o700 })
  writeFileSync(join(profile, 'herdr-web.json'), JSON.stringify({ version: 1, root }), { mode: 0o600 })
  const previous = process.env.PI_CODING_AGENT_DIR
  const nativeEnv = Object.fromEntries(
    ['HERDR_ENV', 'HERDR_PANE_ID', 'HERDR_SOCKET_PATH'].map((key) => [key, process.env[key]]),
  )
  for (const key of Object.keys(nativeEnv)) delete process.env[key]
  process.env.PI_CODING_AGENT_DIR = profile
  const events = new Map<string, (e: unknown, ctx: unknown) => Promise<void>>()
  let commands = 0
  workerActivity({
    on(name: string, handler: (e: unknown, ctx: unknown) => Promise<void>) {
      events.set(name, handler)
    },
    registerCommand() {
      commands++
    },
  } as unknown as ExtensionAPI)
  const context = (id: string, mode = 'tui') => {
    const file = join(root, `${id}.jsonl`)
    writeFileSync(file, JSON.stringify({ type: 'session', id }) + '\n', { mode: 0o600 })
    return {
      mode,
      cwd: '/unrelated/cwd',
      sessionManager: { getSessionFile: () => file, getSessionId: () => id },
      ui: { notify() {} },
    }
  }
  const receipt = (ctx: ReturnType<typeof context>) =>
    join(
      root,
      '.agent-state/runtime/upstream-v10700/pi-subagents',
      `${createHash('sha256').update(ctx.sessionManager.getSessionFile()).digest('hex')}.json`,
    )
  const start = events.get('session_start')!
  const shutdown = events.get('session_shutdown')!
  const first = context('first'),
    second = context('second'),
    child = context('child', 'print')
  try {
    assert.equal(commands, 1)
    await start({}, first)
    assert.equal(existsSync(receipt(first)), true, 'automatic: no command invocation')
    const before = JSON.parse(readFileSync(receipt(first), 'utf8'))
    assert.equal(before.activity, 'unavailable', 'missing scoped service is parent-only, not live empty')
    await start({}, child)
    await shutdown({}, child)
    assert.equal(JSON.parse(readFileSync(receipt(first), 'utf8')).producer, before.producer)
    await shutdown({}, first)
    assert.equal(existsSync(receipt(first)), false)
    await start({}, first)
    assert.notEqual(
      JSON.parse(readFileSync(receipt(first), 'utf8')).producer,
      before.producer,
      'reload automatically owns a new generation',
    )
    await shutdown({}, first)
    await start({}, second)
    assert.equal(existsSync(receipt(first)), false)
    assert.equal(existsSync(receipt(second)), true)
    await shutdown({}, first)
    assert.equal(existsSync(receipt(second)), true, 'late former session shutdown preserves successor')
    await shutdown({}, second)
    const pending = start({}, first)
    await shutdown({}, first)
    await pending
    assert.equal(existsSync(receipt(first)), false, 'late async startup cannot resurrect retired generation')
    rmSync(join(profile, 'herdr-web.json'))
    const generation = workerOwner().generation
    await start({}, first)
    assert.equal(workerOwner().generation, generation, 'unconfigured core claims no poll/producer owner')
    assert.equal(existsSync(receipt(first)), false)
  } finally {
    await shutdown({}, first)
    await shutdown({}, second)
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
    for (const [key, value] of Object.entries(nativeEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true })
  }
})
