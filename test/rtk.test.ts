import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { rtkCandidate, registerRTK, resolveRTKRewrite } from '../lib/rtk.ts'
import fs from 'node:fs'
import path from 'node:path'
import { installRTKHelper } from '../lib/guards/test/rtk-helper-fixture.mjs'
import { createStateFixture } from '../test-state.mjs'

const synthetic = createStateFixture(
  path.resolve(import.meta.dirname, '..'),
  path.resolve('.agent-state/runtime/rtk-on-off-unit'),
  'unit-',
)
const environment = {
  HOME: process.env.HOME,
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
}
process.env.HOME = path.join(synthetic.root, 'home')
process.env.PI_CODING_AGENT_DIR = path.join(synthetic.root, 'profile')
process.env.XDG_CONFIG_HOME = path.join(synthetic.root, 'xdg')
for (const target of [process.env.HOME, process.env.PI_CODING_AGENT_DIR, process.env.XDG_CONFIG_HOME])
  fs.mkdirSync(target, { mode: 0o700 })
after(() => {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  synthetic.cleanup()
})

test('bounded deterministic RTK grammar: shell/control/env/quotes/options/write commands never rewritten', () => {
  for (const mode of ['rewrite-safe'] as const) {
    for (const command of [
      'git commit -m hi',
      'git push',
      'git reset --hard',
      'git branch new-branch',
      'git -c alias.status=bad status',
      'git diff --output=file',
      'git diff --ext-diff',
      'git log --exec=bad',
      'ls;cat .env',
      'ls\ncat .env',
      'ls\r',
      'ls\tfoo',
      'ls $(cat .env)',
      'ls `printenv`',
      'ls > file',
      'ls | cat',
      'A=secret ls',
      'env ls',
      "ls 'file'",
      'ls "file"',
      'ls \\x',
      'rtk ls',
      'ls --color=always',
      'find . -exec cat .env ;',
      'cat --help',
      'ls ' + 'x'.repeat(513),
      'ls ' + 'x '.repeat(65),
      'ls ' + 'x'.repeat(4096),
    ])
      assert.equal(rtkCandidate(command, mode), null, `${mode}: ${command.slice(0, 80)}`)
    assert.equal(rtkCandidate('ls -la safe', mode)?.command, 'rtk ls -la safe')
    assert.deepEqual(rtkCandidate('git diff --stat src', mode)?.paths, ['src'])
  }
  assert.equal(rtkCandidate('git show', 'rewrite-safe'), null)

  assert.equal(rtkCandidate('ls safe', 'off'), null)
})

function eventFixture() {
  const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>()
  return {
    on(name: string, handler: (...args: unknown[]) => unknown) {
      if (!handlers.has(name)) handlers.set(name, [])
      handlers.get(name)!.push(handler)
    },
    async emit(name: string, ...args: unknown[]) {
      for (const handler of handlers.get(name) ?? []) await handler(...args)
    },
  }
}

test('unavailable and disposed RTK transforms preserve native input without helper calls', async () => {
  const events = eventFixture()
  let touched = 0
  const unavailable = () => {
    touched++
    throw Error('Off must not touch owner')
  }
  const runtime = registerRTK(
    {
      on: events.on,
      registerTool() {},
      registerCommand() {},
    },
    {
      access: unavailable,
      finalArgs: unavailable,
      permission: unavailable,
      current: unavailable,
    },
  )
  const input = { command: 'ls safe' }
  assert.equal((await runtime.transform(input, {})).input, input)
  assert.equal(touched, 1)
  await events.emit('session_shutdown')
  assert.equal((await runtime.transform(input, {})).input, input)
  assert.equal(touched, 1)
})

test('real argv resolver: exit 0/3 broad candidates, 1/2/unknown/error/timeout/bounds/malformed, abort and option injection', async () => {
  const base = path.join(synthetic.root, 'resolver')
  fs.mkdirSync(base, { recursive: true })
  const cwd = fs.mkdtempSync(path.join(base, 'resolver-'))
  const helper = installRTKHelper(cwd),
    old = process.env.PATH
  process.env.PATH = `${helper.bin}:/usr/bin:/bin`
  try {
    for (const command of [
      'npm test -- --runInBand',
      'cargo test --lib',
      "printf 'prefix' && rtk git status --short",
      "rtk rg 'two words' src | head -n 3",
      '--help',
    ]) {
      for (const code of [0, 3]) {
        helper.set({ code, out: command + '\n' })
        const result = await resolveRTKRewrite(command, { cwd })
        assert.equal(result.command, command)
        assert.equal(result.status, code === 3 ? 'approval-required' : 'candidate')
        assert.deepEqual(helper.calls().at(-1).args, ['rewrite', '--', command])
      }
    }
    for (const [spec, status] of [
      [{ code: 1, out: 'rtk partial' }, 'unchanged'],
      [{ code: 2, out: 'rtk unsafe', err: 'rtk unsafe' }, 'denied'],
      [{ code: 9, out: 'rtk partial', err: 'rtk partial' }, 'unavailable'],
      [{ delay: 2000, out: 'rtk partial' }, 'timeout'],
      [{ bytes: 20000 }, 'oversize'],
      [{ out: 'rtk ls\nrtk read .env\n' }, 'malformed'],
      [{ out: '' }, 'malformed'],
      [{ out: 'rtk ls\0' }, 'malformed'],
      [{ invalidUtf8: true }, 'malformed'],
    ] as const) {
      helper.set(spec)
      assert.deepEqual(await resolveRTKRewrite('ls safe.txt', { cwd }), {
        status,
        command: null,
      })
    }
    const calls = helper.calls().length
    for (const command of ['x'.repeat(4097), 'ls\ncat .env', '', 'ls\0'])
      assert.equal((await resolveRTKRewrite(command, { cwd })).status, 'malformed')
    assert.equal(helper.calls().length, calls)
    helper.set({ delay: 1000 })
    const controller = new AbortController()
    const pending = resolveRTKRewrite('ls safe.txt', {
      cwd,
      signal: controller.signal,
    })
    while (helper.calls().length === calls) await new Promise((r) => setTimeout(r, 5))
    controller.abort()
    await assert.rejects(pending, /cancel/)
    process.env.PATH = cwd
    assert.equal((await resolveRTKRewrite('ls', { cwd })).status, 'unavailable')
    assert.equal(helper.spawns().length, 0, 'resolver never executes candidate')
  } finally {
    if (old === undefined) delete process.env.PATH
    else process.env.PATH = old
  }
})

test('synchronous helper launch failures release the real concurrency slots', async () => {
  const base = path.join(synthetic.root, 'launch')
  fs.mkdirSync(base, { recursive: true })
  const cwd = fs.mkdtempSync(path.join(base, 'launch-'))
  const helper = installRTKHelper(cwd)
  const previous = process.env.PATH
  process.env.PATH = `${helper.bin}:/usr/bin:/bin`
  try {
    const failures = []
    for (let n = 0; n < 6; n++) {
      failures.push(await Promise.allSettled([resolveRTKRewrite('ls safe.txt', { cwd: `${cwd}\0` })]))
    }
    helper.set({ code: 0, out: 'rtk ls safe.txt\n' })
    assert.equal(
      (await resolveRTKRewrite('ls safe.txt', { cwd })).status,
      'candidate',
      'no leaked helper slots',
    )
    for (const [failure] of failures)
      assert.deepEqual(failure, { status: 'fulfilled', value: { status: 'unavailable', command: null } })
    assert.equal(helper.calls().length, 1, 'bad launches spawn nothing; the subsequent real helper runs')
  } finally {
    if (previous === undefined) delete process.env.PATH
    else process.env.PATH = previous
  }
})

test('on transform fences state/config, cancellation, current owner and checker again after preparation', async () => {
  const f = statusFixture()
  const helper = installRTKHelper(f.ctx.cwd)
  const previous = process.env.PATH
  process.env.PATH = `${helper.bin}:/usr/bin:/bin`
  try {
    f.state('on')
    let current = true,
      allowed = true
    const a = f.create({ executionCurrent: () => current })
    a.runtime.initialize(f.ctx)
    const original = { command: 'ls safe.txt', timeout: 10 }
    const prepare = () => a.runtime.transform(original, f.ctx, () => allowed)
    helper.set({ out: 'rtk ls safe.txt\n' })
    const configDir = path.join(path.dirname(path.dirname(f.file)), '../extensions/mahiro-rtk')
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 })
    const config = path.join(configDir, 'config.json')
    for (const mutate of [
      () => {
        allowed = false
      },
      () => {
        current = false
      },
      () => f.state('off', 1),
      () =>
        fs.writeFileSync(
          config,
          JSON.stringify({ version: 1, profile: process.env.PI_CODING_AGENT_DIR, projects: [] }),
          { mode: 0o600 },
        ),
    ]) {
      const prepared = await prepare()
      assert.equal(prepared.input.command, 'rtk ls safe.txt')
      assert.equal(prepared.input.timeout, 10)
      mutate()
      assert.throws(() => prepared.assertCurrent?.(), /stale|binding|permission/)
      allowed = current = true
      f.state('on')
      if (fs.existsSync(config)) fs.unlinkSync(config)
    }
    const prepared = await prepare()
    const abort = new AbortController()
    f.ctx.signal = abort.signal
    abort.abort()
    assert.throws(() => prepared.assertCurrent?.(), /cancel/)
    delete f.ctx.signal
    fs.unlinkSync(f.file)
    const defaults = path.join(path.dirname(f.file), 'default.json')
    fs.writeFileSync(defaults, JSON.stringify({ version: 1, mode: 'on' }), { mode: 0o600 })
    const defaultPrepared = await prepare()
    fs.writeFileSync(defaults, JSON.stringify({ version: 1, mode: 'off' }))
    assert.throws(() => defaultPrepared.assertCurrent?.(), /binding/)
    f.state('on')
    const final = await prepare()
    await a.emit('session_shutdown')
    assert.throws(() => final.assertCurrent?.(), /stale/)
    assert.equal(helper.spawns().length, 0, 'preparation never executes')
  } finally {
    if (previous === undefined) delete process.env.PATH
    else process.env.PATH = previous
    f.restore()
  }
})

// Disposable private storage only; no installed profile or live UI.
function statusFixture() {
  const base = path.join(synthetic.root, 'status')
  fs.mkdirSync(base, { recursive: true, mode: 0o700 })
  const dir = fs.mkdtempSync(path.join(base, 'status-'))
  const profile = path.join(dir, 'profile'),
    cwd = path.join(dir, 'project')
  for (const entry of [profile, cwd]) fs.mkdirSync(entry, { mode: 0o700 })
  const saved = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = profile
  const root = path.join(profile, 'preferences/rtk')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const file = path.join(root, 'state.json')
  const state = (mode: string, sequence = 0) =>
    fs.writeFileSync(file, JSON.stringify({ version: 1, sequence, mode }), {
      mode: 0o600,
    })
  state('rewrite-rtk')
  const statuses = new Map<string, string>()
  const calls: any[] = [],
    notifications: any[] = []
  const ctx: any = {
    cwd,
    mode: 'tui',
    hasUI: true,
    sessionManager: { getSessionId: () => 'fixture' },
    ui: {
      setStatus(key: string, value: string | undefined) {
        calls.push([key, value])
        if (value === undefined) statuses.delete(key)
        else statuses.set(key, value)
      },
      notify: (text: string, level: string) => notifications.push({ text, level }),
      confirm: async () => true,
    },
  }
  const create = (ownerOverrides: Record<string, any> = {}) => {
    const events = eventFixture(),
      commands = new Map()
    let allowed = true
    let tool: any
    const runtime = registerRTK(
      {
        on: events.on,
        registerCommand: (
          name: string,
          command: { handler: (input: string, context: typeof ctx) => unknown },
        ) => commands.set(name, command),
        registerTool(value: any) {
          tool = value
        },
      },
      {
        current: () => true,
        access() {
          if (!allowed) throw Error('denied')
        },
        permission: () => ({ state: 'allow' }),
        finalArgs: async (_name, args) => args,
        ...ownerOverrides,
      },
    )
    return {
      runtime,
      ...events,
      command: (input: string, context = ctx) => commands.get('mh-rtk').handler(input, context),
      tool: (args: any, context = ctx) =>
        tool.execute('stats-test', args, context.signal, undefined, context),
      deny() {
        allowed = false
      },
    }
  }
  return {
    ctx,
    create,
    calls,
    statuses,
    notifications,
    file,
    state,
    restore() {
      if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = saved
    },
  }
}

test('off and preserved legacy state never enable execution or consult the Bash checker', async () => {
  const f = statusFixture()
  try {
    for (const mode of ['off', 'suggest', 'rewrite-safe', 'rewrite-rtk']) {
      f.state(mode)
      const a = f.create()
      a.runtime.initialize(f.ctx)
      const input = { command: 'ls safe.txt', timeout: 10 }
      const check = () => assert.fail('inactive mode consulted Bash authority')
      assert.equal((await a.runtime.transform(input, f.ctx, check)).input, input)
      await a.command('status')
      assert.equal(JSON.parse(f.notifications.at(-1).text).mode, 'off')
      assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).mode, mode)
      await a.emit('session_shutdown')
      assert.equal((await a.runtime.transform(input, f.ctx, check)).input, input)
    }
  } finally {
    f.restore()
  }
})

test('Biome version/format resolver preview preserves semantics; transform never consults helper', async () => {
  const f = statusFixture()
  const helper = installRTKHelper(f.ctx.cwd)
  const previous = process.env.PATH
  process.env.PATH = `${helper.bin}:/usr/bin:/bin`
  try {
    const checks: string[] = []
    const a = f.create({
      permission: (_ctx: unknown, _surface: string, command: string) => {
        checks.push(command)
        return { state: 'allow' }
      },
    })
    a.runtime.initialize(f.ctx)
    for (const command of [
      'pnpm exec biome --version',
      'pnpm exec biome format --write src/example.ts',
      'pnpm exec biome --version; node --version; git status --short',
      'pnpm exec biome format --write src/example.ts && node --version',
      'node --version && pnpm exec biome --version',
      'node --version || pnpm exec biome format --write src/example.ts',
      './node_modules/.bin/biome --version | head -n 1',
      'pnpm exec "biome" --version',
    ]) {
      for (const code of [0, 3]) {
        const rewritten = command.replace(/(?:pnpm exec |\.\/node_modules\/\.bin\/)"?biome"?/, 'rtk lint')
        helper.set({ code, out: rewritten + '\n' })
        assert.deepEqual(await resolveRTKRewrite(command, f.ctx), { status: 'unchanged', command: null })
        const input = { command, timeout: 10 }
        assert.deepEqual((await a.runtime.transform(input, f.ctx)).input, input, command)
        assert.equal(checks.length, 0, 'compatibility transform performs no authorization')
        assert.deepEqual(helper.calls().at(-1).args, ['rewrite', '--', command])
      }
    }
    const command = 'pnpm exec biome --version; node --version'
    helper.set({ code: 2, out: 'rtk lint --version; node --version\n' })
    assert.deepEqual(await resolveRTKRewrite(command, f.ctx), { status: 'denied', command: null })
    assert.deepEqual((await a.runtime.transform({ command }, f.ctx)).input, { command })
    const denied = f.create({ permission: () => ({ state: 'deny' }) })
    denied.runtime.initialize(f.ctx)
    helper.set({ out: 'rtk lint --version\n' })
    const calls = helper.calls().length
    assert.deepEqual((await denied.runtime.transform({ command }, f.ctx)).input, { command })
    assert.equal(helper.calls().length, calls, 'no-op transform ignores RTK preview permission')
    assert.equal(helper.spawns().length, 0, 'neither version nor format candidate is executed')
  } finally {
    if (previous === undefined) delete process.env.PATH
    else process.env.PATH = previous
    f.restore()
  }
})

test('RTK fixture delivers every ordered lifecycle listener without crossing events', async () => {
  const f = statusFixture()
  try {
    const a = f.create()
    const observed: string[] = []
    a.on('session_start', () => {
      assert.fail('shutdown must not deliver another event')
    })
    a.on('session_shutdown', async () => {
      assert.equal(f.statuses.has('mahiro-rtk'), false, 'canonical cleanup ran before later observers')
      await Promise.resolve()
      observed.push('first')
    })
    a.on('session_shutdown', () => {
      observed.push('second')
    })
    a.runtime.initialize(f.ctx)
    assert.equal(f.statuses.get('mahiro-rtk'), 'RTK off')
    await a.emit('session_shutdown')
    assert.deepEqual(observed, ['first', 'second'])
    assert.equal(f.statuses.size, 0)
  } finally {
    f.restore()
  }
})

test('gain reads actual evidence under fixed-command authority; status/doctor never invoke CLI', async () => {
  const f = statusFixture()
  const savedPath = process.env.PATH
  const helper = installRTKHelper(path.dirname(f.file))
  process.env.PATH = `${helper.bin}${path.delimiter}${savedPath ?? ''}`
  helper.set({
    nativeOut: JSON.stringify({
      summary: {
        total_commands: 1,
        total_input: 1200,
        total_output: 200,
        total_saved: 1000,
        avg_savings_pct: 83.33333333333334,
        total_time_ms: 6,
        avg_time_ms: 6,
        oversized_excluded: 0,
      },
      daily: [],
    }),
  })
  try {
    let checks = 0
    const a = f.create({
      finalArgs: async (_name: string, args: any) => {
        checks++
        return args
      },
    })
    for (const operation of ['status', 'doctor', 'log']) await a.tool({ operation })
    assert.equal(checks, 0)
    assert.equal(helper.spawns().length, 0)
    const gain = await a.tool({ operation: 'gain' })
    assert.equal(gain.details.snapshot.summary.total_saved, 1000)
    assert.deepEqual(helper.spawns(), [['gain', '--daily', '--format', 'json', '--text', '-p']])
    await assert.rejects(a.tool({ operation: 'status', scope: 'all' }), /require gain/)
    await assert.rejects(a.tool({ operation: 'gain', scope: '../private' }), /Invalid RTK statistics/)
    await assert.rejects(a.tool({ operation: 'gain', view: '--watch' }), /Invalid RTK statistics/)
    helper.set({ nativeOut: '\x1b[31mBy Command\x1b[0m\nOpaque table\0' })
    const report = await a.tool({ operation: 'gain', scope: 'all', view: 'commands' })
    assert.equal(report.details.report, 'By Command\nOpaque table\n')
    assert.deepEqual(helper.spawns().at(-1), ['gain', '--text'])
    f.ctx.mode = 'rpc'
    await a.command('gain all')
    assert.equal(JSON.parse(f.notifications.at(-1).text).scope, 'all')
  } finally {
    process.env.PATH = savedPath
    f.restore()
  }
})

test('gain fences feature/Bash, fixed host command, identity/state/generation before and after awaits', async () => {
  const f = statusFixture()
  const savedPath = process.env.PATH
  const helper = installRTKHelper(path.dirname(f.file))
  process.env.PATH = `${helper.bin}${path.delimiter}${savedPath ?? ''}`
  helper.set({
    nativeOut: JSON.stringify({
      summary: {
        total_commands: 1,
        total_input: 1200,
        total_output: 200,
        total_saved: 1000,
        avg_savings_pct: 83.3,
        total_time_ms: 6,
        avg_time_ms: 6,
        oversized_excluded: 0,
      },
      daily: [],
    }),
  })
  try {
    for (const permission of ['ask', 'deny']) {
      let host = false
      const a = f.create({
        permission: () => ({ state: permission }),
        finalArgs: async () => {
          host = true
        },
      })
      await assert.rejects(a.tool({ operation: 'gain' }), /access unavailable/)
      assert.equal(host, false)
    }
    assert.equal(helper.spawns().length, 0)
    const changed = f.create({ finalArgs: async () => ({ command: 'rtk gain --quota' }) })
    await assert.rejects(changed.tool({ operation: 'gain' }), /access unavailable/)
    assert.equal(helper.spawns().length, 0)
    for (const mutation of ['state', 'session', 'generation', 'feature', 'bash']) {
      const originalSessionId = f.ctx.sessionManager.getSessionId
      let allowed = true,
        current = true
      const a = f.create({
        current: () => current,
        permission: () => ({ state: allowed ? 'allow' : 'deny' }),
        finalArgs: async (_name: string, args: any) => {
          if (mutation === 'state') f.state('off', 30)
          if (mutation === 'session') f.ctx.sessionManager.getSessionId = () => 'replacement'
          if (mutation === 'generation') current = false
          if (mutation === 'feature') a.deny()
          if (mutation === 'bash') allowed = false
          return args
        },
      })
      await assert.rejects(a.tool({ operation: 'gain' }), /access unavailable/)
      assert.equal(helper.spawns().length, 0)
      f.ctx.sessionManager.getSessionId = originalSessionId
      f.state('off')
    }
    for (const mutation of ['bash', 'feature', 'session', 'state', 'generation']) {
      let permissions = 0,
        current = true
      const originalSessionId = f.ctx.sessionManager.getSessionId
      const a = f.create({
        current: () => current,
        permission: () => {
          permissions++
          if (permissions === 3) {
            if (mutation === 'bash') return { state: 'deny' }
            if (mutation === 'feature') a.deny()
            if (mutation === 'session') f.ctx.sessionManager.getSessionId = () => 'replaced'
            if (mutation === 'state') f.state('on', 77)
            if (mutation === 'generation') current = false
          }
          return { state: 'allow' }
        },
      })
      const before = helper.spawns().length
      // Revoke during the final permission query, then require a final complete fence.
      await assert.rejects(a.tool({ operation: 'gain' }), /access unavailable/)
      assert.equal(helper.spawns().length, before + 1)
      f.ctx.sessionManager.getSessionId = originalSessionId
      f.state('off')
    }
  } finally {
    process.env.PATH = savedPath
    f.restore()
  }
})

test('RTK bare and whitespace commands open usage, not controls or a mode write', async () => {
  const f = statusFixture()
  try {
    const a = f.create()
    let opened = 0
    f.ctx.ui.custom = async () => {
      opened++
    }
    a.runtime.initialize(f.ctx)
    for (const input of ['', '   ', '\t \t']) {
      await a.command(input)
      assert.equal(opened, ['', '   ', '\t \t'].indexOf(input) + 1)
      assert.equal(f.notifications.length, 0)
      assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).sequence, 0)
    }
    for (const input of ['status\n', '\n', '\r', '\v', '\f', '\0', '\x7f']) {
      await a.command(input)
      assert.equal(
        f.notifications.at(-1).level,
        'error',
        'controls other than a blank spaces/tabs command stay rejected',
      )
    }
    await a.emit('session_shutdown')
  } finally {
    f.restore()
  }
})

test('RTK publishes initialized and committed active modes; decline/cancel never publishes', async () => {
  const f = statusFixture()
  try {
    const a = f.create()
    assert.equal(f.calls.length, 0, 'registration has no UI side effects')
    a.runtime.initialize(f.ctx)
    assert.equal(f.statuses.get('mahiro-rtk'), 'RTK off')
    let sequence = 0
    for (const mode of ['on', 'off', 'on', 'off']) {
      await a.command(`mode ${mode} ${sequence++}`)
      assert.equal(f.statuses.get('mahiro-rtk'), `RTK ${mode}`)
      assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).mode, mode)
    }
    const calls = f.calls.length,
      bytes = fs.readFileSync(f.file, 'utf8')
    f.ctx.ui.confirm = async () => false
    await a.command(`mode off ${sequence}`)
    assert.match(f.notifications.at(-1).text, /declined/)
    const controller = new AbortController()
    f.ctx.signal = controller.signal
    f.ctx.ui.confirm = async () => {
      controller.abort()
      return true
    }
    await a.command(`mode off ${sequence}`)
    assert.match(f.notifications.at(-1).text, /replaced/)
    assert.equal(f.calls.length, calls)
    assert.equal(fs.readFileSync(f.file, 'utf8'), bytes)
    await a.emit('session_shutdown')
    assert.equal(f.statuses.has('mahiro-rtk'), false)
    const cleared = f.calls.length
    await a.emit('session_shutdown')
    a.runtime.initialize(f.ctx)
    assert.equal(f.calls.length, cleared, 'shutdown is final and idempotent')
  } finally {
    f.restore()
  }
})

test('RTK unavailable initialization replaces old mode; off is explicit; non-TUI never publishes', async () => {
  const f = statusFixture()
  try {
    const a = f.create()
    a.runtime.initialize(f.ctx)
    a.deny()
    a.runtime.initialize(f.ctx)
    assert.equal(f.statuses.get('mahiro-rtk'), 'RTK unavailable')
    await a.emit('session_shutdown')
    f.state('off')
    const off = f.create()
    off.runtime.initialize(f.ctx)
    assert.equal(f.statuses.get('mahiro-rtk'), 'RTK off')
    await off.emit('session_shutdown')
    const count = f.calls.length
    for (const mode of ['rpc', 'json', 'print']) {
      const b = f.create(),
        ctx = { ...f.ctx, mode }
      b.runtime.initialize(ctx)
      if (mode === 'rpc') await b.command('mode on 0', ctx)
      await b.emit('session_shutdown')
    }
    const noUI = f.create()
    noUI.runtime.initialize({ ...f.ctx, hasUI: false })
    await noUI.emit('session_shutdown')
    assert.equal(f.calls.length, count)
  } finally {
    f.restore()
  }
})

test('RTK stale shutdown and pending confirmation cannot clear or replace newer status', async () => {
  const f = statusFixture()
  try {
    const old = f.create()
    old.runtime.initialize(f.ctx)
    let confirm!: (value: boolean) => void
    f.ctx.ui.confirm = () =>
      new Promise<boolean>((resolve) => {
        confirm = resolve
      })
    const pending = old.command('mode off 0')
    f.state('suggest')
    const replacement = f.create()
    replacement.runtime.initialize(f.ctx)
    const calls = f.calls.length
    await old.emit('session_shutdown')
    confirm(true)
    await pending
    assert.equal(f.calls.length, calls)
    assert.equal(f.statuses.get('mahiro-rtk'), 'RTK off')
    assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).mode, 'suggest')
    await replacement.emit('session_shutdown')
    assert.equal(f.statuses.size, 0)
    // Two still-healthy managers sharing a UI need a presentation-sink lease.
    const a = f.create()
    a.runtime.initialize(f.ctx)
    const b = f.create()
    b.runtime.initialize({
      ...f.ctx,
      sessionManager: { getSessionId: () => 'new' },
    })
    await a.emit('session_shutdown')
    assert.equal(f.statuses.get('mahiro-rtk'), 'RTK off')
    await b.emit('session_shutdown')
    assert.equal(f.statuses.size, 0)

    const independentStatuses = new Map()
    const independentUI = {
      ...f.ctx.ui,
      setStatus(key: string, value: string | undefined) {
        if (value === undefined) independentStatuses.delete(key)
        else independentStatuses.set(key, value)
      },
    }
    const c = f.create(),
      d = f.create()
    c.runtime.initialize(f.ctx)
    d.runtime.initialize({ ...f.ctx, ui: independentUI })
    await c.emit('session_shutdown')
    assert.equal(f.statuses.size, 0)
    assert.equal(independentStatuses.get('mahiro-rtk'), 'RTK off')
    await d.emit('session_shutdown')
    assert.equal(independentStatuses.size, 0)
  } finally {
    f.restore()
  }
})

test('explicit RTK preview needs original permission; preserved legacy transform stays inactive', async () => {
  const f = statusFixture()
  const helper = installRTKHelper(f.ctx.cwd)
  const previousPath = process.env.PATH
  process.env.PATH = `${helper.bin}:/usr/bin:/bin`
  try {
    let evaluate = (_surface: string, _value?: string): any => ({ state: 'allow', origin: 'yolo' })
    const events = eventFixture(),
      commands = new Map()
    const runtime = registerRTK(
      {
        on: events.on,
        registerCommand: (
          name: string,
          command: { handler: (input: string, context: typeof f.ctx) => unknown },
        ) => commands.set(name, command),
        registerTool() {},
      },
      {
        current: () => true,
        access() {},
        permission: (_ctx, surface, value) => evaluate(surface, value),
        finalArgs: async (_name, args) => args,
      },
    )
    runtime.initialize(f.ctx)
    helper.set({ code: 3, out: 'rtk ls safe.txt\n' })
    // 1. YOLO permits explicit preview, while transform remains unchanged.
    await commands.get('mh-rtk').handler('rewrite ls safe.txt', f.ctx)
    assert.equal(f.notifications.at(-1).level, 'info')
    assert.equal(JSON.parse(f.notifications.at(-1).text).command, 'rtk ls safe.txt')
    assert.equal(
      (await runtime.transform({ command: 'ls safe.txt' }, f.ctx)).input.command,
      'ls safe.txt',
      'yolo transform is a no-op',
    )
    // 2. Command-specific config rule (original allowed by 'ls *', candidate falls through to default ask)
    evaluate = (surface, value) => {
      if (surface !== 'bash') return { state: 'allow' }
      if (value === 'ls safe.txt') return { state: 'allow', matchedPattern: 'ls *', origin: 'config' }
      return {
        state: 'ask',
        matchedSurface: '*',
        matchedPattern: undefined,
        source: 'default',
        askingUnits: [{ command: value ?? '' }],
      }
    }
    await commands.get('mh-rtk').handler('rewrite ls safe.txt', f.ctx)
    assert.equal(f.notifications.at(-1).level, 'info')
    assert.equal(
      (await runtime.transform({ command: 'ls safe.txt' }, f.ctx)).input.command,
      'ls safe.txt',
      'mode state does not rewrite command-specific grants',
    )
    // 3. A specific ask rule on an unsolicited candidate is never consulted.
    helper.set({ code: 3, out: 'rtk proxy ls safe.txt\n' })
    evaluate = (surface, value) => {
      if (surface !== 'bash') return { state: 'allow' }
      if (value === 'ls safe.txt') return { state: 'allow', matchedPattern: 'ls *', origin: 'config' }
      return {
        state: 'ask',
        matchedSurface: 'bash',
        matchedPattern: 'rtk proxy *',
        source: 'config',
        askingUnits: [{ command: value ?? '' }],
      }
    }
    assert.deepEqual((await runtime.transform({ command: 'ls safe.txt' }, f.ctx)).input, {
      command: 'ls safe.txt',
    })
    // 4. Candidate wrapper floors likewise have no automatic execution effect.
    helper.set({ code: 3, out: 'env FOO=1 rtk ls safe.txt\n' })
    evaluate = (surface, value) => {
      if (surface !== 'bash') return { state: 'allow' }
      if (value === 'ls safe.txt') return { state: 'allow', origin: 'yolo' }
      return {
        state: 'ask',
        matchedSurface: 'bash',
        matchedPattern: '<indirection-bash-wrapper>',
        floor: '<indirection-bash-wrapper>',
        askingUnits: [{ command: value ?? '', floor: '<indirection-bash-wrapper>' }],
      }
    }
    assert.deepEqual((await runtime.transform({ command: 'ls safe.txt' }, f.ctx)).input, {
      command: 'ls safe.txt',
    })
    evaluate = () => ({ state: 'deny' })
    const calls = helper.calls().length
    await commands.get('mh-rtk').handler('rewrite ls safe.txt', f.ctx)
    assert.equal(f.notifications.at(-1).level, 'error')
    assert.equal(helper.calls().length, calls, 'explicit denial precedes preview helper')
    await events.emit('session_shutdown')
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    f.restore()
  }
})
