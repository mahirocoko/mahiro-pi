import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { devNull } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'
import { installRTKHelper } from './rtk-helper-fixture.mjs'
import { gitFixtureEnv } from './git-isolation-fixture.mjs'

const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  primary = path.resolve(adapter, '../..'),
  stage = path.resolve(primary, '..')
const patched = process.env.RTK_EXPECT_OWNER === 'patched'
const sha = (value) => createHash('sha256').update(value).digest('hex')

// Native Bash inherits this process environment. A non-repository cwd alone does
// not prevent Git from discovering the source checkout above an ignored stage.
const isolateGit = (ceiling, inherited = {}) => {
  const previous = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('GIT_')))
  const clear = () => {
    for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key]
  }
  // Optional hostile inheritance is used by the native regression below, not by
  // a mocked shell. Scrub all Git overrides, including config-injected redirects.
  const isolated = gitFixtureEnv(ceiling, { ...process.env, ...inherited })
  clear()
  Object.assign(process.env, isolated)
  return () => {
    clear()
    Object.assign(process.env, previous)
  }
}

const snapshotFiles = (root) => {
  const files = {}
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else files[path.relative(root, file)] = fs.readFileSync(file)
    }
  }
  visit(root)
  return files
}

test(`RTK resolver and actual factory native transform authorization: ${patched ? 'patched' : 'old'} public owner`, async (t) => {
  assert.match(
    stage,
    /\.agent-state\/runtime\/(?:pi-ownership-repair|rtk-rewrite-models-retirement|native-permission-secret-retirement\/phase-a)\//,
  )
  // This parent is newly owned fixture data, never the caller's checkout/index.
  const gitParent = fs.mkdtempSync(path.join(stage, 'git-parent-'))
  t.after(isolateGit(gitParent))
  const cwd = path.join(gitParent, 'project'),
    agentDir = path.join(stage, 'profile'),
    bin = path.join(stage, 'bin')
  for (const d of [cwd, agentDir]) fs.mkdirSync(d, { mode: 0o700 })
  fs.writeFileSync(path.join(cwd, 'safe.txt'), 'SAFE_FIXTURE\n')
  fs.writeFileSync(path.join(cwd, '.env'), 'FIXTURE_SECRET=DO_NOT_RETURN\n')
  const helper = installRTKHelper(stage)
  const previous = {
    agent: process.env.PI_CODING_AGENT_DIR,
    path: process.env.PATH,
    fetch: globalThis.fetch,
    bash: process.env.BASH_ENV,
    home: process.env.HOME,
    xdg: process.env.XDG_CONFIG_HOME,
  }
  const home = path.join(stage, 'synthetic-home')
  fs.mkdirSync(home, { mode: 0o700 })
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = path.join(home, '.config')
  process.env.PI_CODING_AGENT_DIR = agentDir
  process.env.PATH = `${bin}:/usr/bin:/bin`
  process.env.BASH_ENV = devNull
  let external = 0
  globalThis.fetch = () => {
    external++
    throw Error('No external transport')
  }
  const permissionConfig = path.join(agentDir, 'extensions/pi-permission-system/config.json')
  const rtkRoot = path.join(agentDir, 'preferences/rtk')
  const names = ['mh_rtk']
  // Explicit disposable policy; native permission is not a shell sandbox.
  const shellPolicy = {
    '*': 'allow',
    'cat .env': 'deny',
    printenv: 'deny',
    'ls safe.txt; cat .env': 'deny',
    'ls $(cat .env)': 'deny',
    'rtk read .env': 'deny',
    'rtk proxy *': 'deny',
  }
  const grants = () => ({
    '*': 'deny',
    read: 'allow',
    path_read: { '*': 'allow', [path.join(cwd, '.env')]: 'deny' },
    path_write: 'allow',
    codemode: 'allow',
    ...Object.fromEntries(names.map((n) => [n, 'allow'])),
    [`rtk_state_${sha(rtkRoot)}`]: 'allow',
    bash: { '*': 'deny', 'ls *': 'allow', 'rtk ls *': 'allow' },
  })
  const grant = (value) =>
    fs.writeFileSync(
      permissionConfig,
      JSON.stringify({
        authorizerChain: [],
        yoloMode: false,
        permission: value,
      }),
      { mode: 0o600 },
    )
  fs.mkdirSync(path.dirname(permissionConfig), {
    recursive: true,
    mode: 0o700,
  })
  grant(grants())
  const configure = (feature) => {
    const f = path.join(agentDir, `extensions/mahiro-${feature}/config.json`)
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 })
    fs.writeFileSync(f, JSON.stringify({ version: 1, profile: agentDir, projects: [cwd] }), { mode: 0o600 })
    return f
  }
  const untouched = ['auth.json', 'models.json', 'Core.md']
  for (const f of untouched)
    fs.writeFileSync(path.join(agentDir, f), `SYNTHETIC_UNTOUCHED_${f}`, {
      mode: 0o600,
    })
  const before = untouched.map((f) => fs.readFileSync(path.join(agentDir, f)))
  const config = configure('rtk')
  const permissions = fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-permission-system'))
  const settings = sdk.SettingsManager.inMemory({
    packages: [permissions, adapter],
    defaultTools: ['+codemode'],
    cacheWarming: 'off',
    compaction: { enabled: false },
    retry: { enabled: false },
  })
  const credentials = new ai.InMemoryCredentialStore()
  await credentials.modify('preset-fixture', async () => ({
    type: 'api_key',
    key: 'SYNTHETIC_FIXTURE_ONLY_NOT_A_CREDENTIAL',
  }))
  const runtime = await sdk.ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const faux = ai.fauxProvider({
    provider: 'preset-fixture',
    models: [
      { id: 'source', reasoning: true, contextWindow: 32000 },
      { id: 'target', reasoning: true, contextWindow: 64000 },
    ],
  })
  runtime.registerNativeProvider(faux.provider)
  const refreshed = await runtime.refresh({ allowNetwork: false })
  assert.equal(refreshed.aborted, false)
  assert.equal(refreshed.errors.size, 0)
  const assertNativeAuth = async (phase) => {
    assert.equal(runtime.hasConfiguredAuth('preset-fixture'), true, `${phase}: configured auth`)
    assert.ok(await runtime.checkAuth('preset-fixture'), `${phase}: public auth check`)
    assert.ok(
      runtime.getAvailableSnapshot().some((m) => m.provider === 'preset-fixture' && m.id === 'target'),
      `${phase}: available target`,
    )
    if (session) assert.equal(session.modelRuntime, runtime, `${phase}: runtime identity`)
  }
  let session,
    ctx,
    definitions,
    tools,
    confirm = async () => true,
    notices = []
  const start = async () => {
    const loader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: settings,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ['mcp'],
      extensionFactories: [
        { name: 'codemode', builtin: true, factory: sdk.createCodemodeExtension() },
        (pi) => {
          pi.on('session_start', (_e, c) => {
            ctx = c
            tools = pi.getAllTools()
          })
        },
      ],
    })
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    definitions = new Map()
    for (const extension of loader.getExtensions().extensions)
      for (const item of extension.tools.values()) definitions.set(item.definition.name, item.definition)
    await assertNativeAuth('before SDK session creation')
    ;({ session } = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager: settings,
      resourceLoader: loader,
      modelRuntime: runtime,
      model: faux.getModel('source'),
      sessionManager: sdk.SessionManager.inMemory(cwd),
    }))
    await session.bindExtensions({
      mode: 'rpc',
      uiContext: {
        confirm: (...args) => confirm(...args),
        notify: (...args) => notices.push(args),
        setStatus() {},
        setWidget() {},
        setWorkingMessage() {},
      },
    })
    // Await the public all-provider snapshot barrier after SDK preparation.
    // A scoped refresh can race registration's asynchronous full refresh.
    const boundRefresh = await runtime.refresh({ allowNetwork: false })
    assert.equal(boundRefresh.aborted, false)
    assert.equal(boundRefresh.errors.size, 0)
    await assertNativeAuth('after SDK binding and full refresh')
  }
  const execute = (name, args = {}, context = ctx, signal) =>
    definitions.get(name).execute('fixture', args, signal, undefined, context)
  const status = async () => (await execute('mh_rtk', { operation: 'status' })).details
  const command = async (text) => {
    notices = []
    await session.prompt(text)
    return notices
  }
  const shutdown = async () => {
    if (session) {
      try {
        await session.extensionRunner.emit({
          type: 'session_shutdown',
          reason: 'quit',
        })
      } finally {
        session.dispose()
        session = undefined
      }
    }
  }
  try {
    await start()
    assert.equal(fs.existsSync(rtkRoot), false)
    assert.equal(helper.calls().length, 0)
    if (!patched) {
      assert.equal((await status()).sequence, 0)
      grant({ ...grants(), mh_rtk: 'deny' })
      await assert.rejects(status(), /PSS permission/)
      assert.equal(fs.existsSync(rtkRoot), false)
      return
    }
    assert.equal((await status()).sequence, 0)
    const waitForHelper = async (previous) => {
      for (let i = 0; i < 1000; i++) {
        if (helper.calls().length > previous) return
        await new Promise((r) => setTimeout(r, 5))
      }
      throw Error('Expected helper was not started within fixture bound')
    }
    grant({ ...grants(), bash: shellPolicy })
    helper.set({ code: 3, out: "printf 'prefix' && rtk npm test\n" })
    const preview = (await execute('mh_rtk', { operation: 'rewrite', command: '--help' })).details
    assert.equal(preview.status, 'approval-required')
    assert.equal(preview.executed, false)
    assert.equal(preview.hostApprovalRequired, true)
    assert.deepEqual(helper.calls().at(-1).args, ['rewrite', '--', '--help'])
    assert.equal(helper.spawns().length, 0)
    const previewCalls = helper.calls().length
    await assert.rejects(execute('mh_rtk', { operation: 'rewrite', command: 'cat .env' }))
    assert.equal(helper.calls().length, previewCalls)
    // Start ordinary execution evidence with a clean helper marker.
    fs.unlinkSync(helper.marker)
    helper.set({})
    grant(grants())
    await execute('bash', { command: 'ls safe.txt' })
    assert.equal(helper.calls().length, 0, 'off does not resolve')
    assert.equal(helper.spawns().length, 0)
    const mode = async (value, sequence) => {
      await command(`/mh-rtk mode ${value} ${sequence}`)
      assert.ok(
        notices.every((n) => n[1] !== 'error'),
        JSON.stringify(notices),
      )
    }
    await mode('suggest', 0)
    await execute('bash', { command: 'ls safe.txt' })
    assert.equal(helper.calls().length, 1)
    assert.equal(helper.spawns().length, 0, 'suggest executes raw only')
    await mode('rewrite-safe', 1)
    assert.match(JSON.stringify(await execute('bash', { command: 'ls safe.txt' })), /FAKE_RTK_NATIVE/)
    assert.equal(helper.calls().length, 1, 'safe remains independent of resolver')
    await mode('rewrite-rtk', 2)
    for (const code of [0, 3]) {
      helper.set({ code, out: "rtk ls 'safe.txt'\n" })
      const before = helper.spawns().length
      await execute('bash', { command: 'ls safe.txt' })
      assert.equal(helper.spawns().length, before + 1)
      assert.deepEqual(helper.calls().at(-1).args, ['rewrite', '--', 'ls safe.txt'])
      assert.equal(helper.calls().at(-1).cwd, cwd)
    }
    // Mixed, quoted, pipeline output cannot be restricted to an rtk-prefix DSL.
    grant({ ...grants(), bash: shellPolicy })
    for (const candidate of [
      "printf 'prefix' && rtk npm test",
      'rtk cargo test --lib | head -n 1',
      "rtk read 'safe.txt'",
    ]) {
      helper.set({ code: 3, out: candidate + '\n' })
      const before = helper.spawns().length
      await execute('bash', { command: 'ls safe.txt' })
      assert.equal(helper.spawns().length, before + 1, candidate)
    }
    // Helper proposal and transformed final command need host policy, not exit-code trust.
    helper.set({ code: 3, out: 'rtk ls safe.txt\n' })
    grant({ ...grants(), bash: { '*': 'deny', 'ls *': 'allow' } })
    let calls = helper.calls().length,
      spawns = helper.spawns().length
    await assert.rejects(execute('bash', { command: 'ls safe.txt' }), /permission/i)
    assert.equal(helper.calls().length, calls + 1)
    assert.equal(helper.spawns().length, spawns)
    grant({ ...grants(), bash: { '*': 'deny', 'rtk *': 'allow' } })
    calls = helper.calls().length
    await assert.rejects(execute('bash', { command: 'ls safe.txt' }), /permission/i)
    assert.equal(helper.calls().length, calls, 'denied original never calls helper')
    grant({ ...grants(), bash: shellPolicy })
    for (const original of ['cat .env', 'printenv', 'ls safe.txt; cat .env', 'ls $(cat .env)']) {
      calls = helper.calls().length
      await assert.rejects(execute('bash', { command: original }))
      assert.equal(helper.calls().length, calls, original)
    }
    for (const candidate of [
      'rtk read .env',
      'rtk proxy cat .env',
      'rtk proxy rtk read .env',
      'rtk proxy printenv',
      "rtk proxy bash -c 'cat .env'",
      "rtk git commit -m 'Co-Authored-By: Letta Code <noreply@letta.com>'",
    ]) {
      helper.set({ out: candidate + '\n' })
      spawns = helper.spawns().length
      await assert.rejects(execute('bash', { command: 'ls safe.txt' }), undefined, candidate)
      assert.equal(helper.spawns().length, spawns, candidate)
    }
    for (const spec of [
      { code: 1, out: 'rtk forbidden' },
      { code: 9, out: 'rtk forbidden', err: 'rtk forbidden' },
      { delay: 2000, out: 'rtk forbidden' },
      { bytes: 20000 },
      { out: 'rtk ls safe.txt\nrtk forbidden\n' },
      { out: '' },
      { invalidUtf8: true },
    ]) {
      helper.set(spec)
      spawns = helper.spawns().length
      assert.match(JSON.stringify(await execute('bash', { command: 'ls safe.txt' })), /safe.txt/)
      assert.equal(helper.spawns().length, spawns, JSON.stringify(spec))
    }
    helper.set({ code: 2, out: 'rtk ls safe.txt', err: 'DENIED' })
    spawns = helper.spawns().length
    await assert.rejects(execute('bash', { command: 'ls safe.txt' }), /exit 2/)
    assert.equal(helper.spawns().length, spawns)
    // Real factory path sanitizer: candidate sanitizes to a native direct git commit,
    // then final policy denies it. No git or RTK execution is reached.
    helper.set({
      out: "git commit -m 'message\nCo-Authored-By: Letta Code <noreply@letta.com>'",
    })
    // Multiline proposals are malformed, tested above; use a single-line trailer.
    helper.set({
      out: "git commit -m 'Co-Authored-By: Letta Code <noreply@letta.com>'\n",
    })
    grant({ ...grants(), bash: { '*': 'allow', "git commit -m ''": 'deny' } })
    await assert.rejects(execute('bash', { command: 'ls safe.txt' }), /permission/)
    assert.equal(helper.spawns().length, spawns)
    grant({ ...grants(), bash: shellPolicy })
    calls = helper.calls().length
    // A real staged parent makes the old discovery assumption fail visibly,
    // without ever staging anything in the caller's repository.
    const git = (...args) => {
      const result = spawnSync('git', args, {
        cwd: gitParent,
        env: process.env,
        encoding: 'utf8',
        timeout: 10000,
      })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      return result.stdout
    }
    git('init', '--template=')
    git('config', 'user.name', 'Disposable isolation fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    git('config', 'commit.gpgsign', 'false')
    git('config', 'core.hooksPath', devNull)
    const sentinel = path.join(gitParent, 'staged-sentinel.txt')
    fs.writeFileSync(sentinel, 'initial fixture\n')
    git('add', '--', 'staged-sentinel.txt')
    git('commit', '-m', 'Disposable initial fixture')
    fs.writeFileSync(sentinel, 'staged fixture must survive\n')
    git('add', '--', 'staged-sentinel.txt')
    const parentHead = git('rev-parse', 'HEAD')
    assert.equal(git('diff', '--cached', '--name-only'), 'staged-sentinel.txt\n')
    const parentFiles = snapshotFiles(gitParent)
    for (const [scenario, inherited] of [
      ['ordinary inheritance', {}],
      [
        'hostile Git redirects',
        {
          GIT_DIR: path.join(gitParent, '.git'),
          GIT_COMMON_DIR: path.join(gitParent, '.git'),
          GIT_WORK_TREE: gitParent,
          GIT_INDEX_FILE: path.join(gitParent, '.git/index'),
          GIT_OBJECT_DIRECTORY: path.join(gitParent, '.git/objects'),
          GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(gitParent, '.git/objects'),
          GIT_CEILING_DIRECTORIES: '/',
          GIT_CONFIG: path.join(gitParent, '.git/config'),
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'core.worktree',
          GIT_CONFIG_VALUE_0: gitParent,
          GIT_CONFIG_PARAMETERS: "'core.worktree'='" + gitParent + "'",
        },
      ],
    ]) {
      const gitEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.startsWith('GIT_')),
      )
      const restoreGit = isolateGit(gitParent, inherited)
      try {
        // Preserve actual native factory execution and direct-commit helper
        // bypass. Assert native Git's error result, not a policy/mock rejection.
        const result = await execute('bash', {
          command: 'git commit -m fixture',
        })
        assert.equal(result.isError, true, scenario)
        assert.equal(result.structuredContent.exit_code, 128, scenario)
        assert.match(result.structuredContent.output, /fatal: not a git repository/i, scenario)
        assert.equal(helper.calls().length, calls, scenario)
        assert.deepEqual(snapshotFiles(gitParent), parentFiles, scenario)
        assert.equal(git('rev-parse', 'HEAD'), parentHead, scenario)
      } finally {
        restoreGit()
        assert.deepEqual(
          Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('GIT_'))),
          gitEnvironment,
          `${scenario}: restore inherited Git environment`,
        )
      }
    }
    helper.set({ delay: 500, out: 'rtk ls safe.txt\n' })
    const abort = new AbortController()
    const pending = execute('bash', { command: 'ls safe.txt' }, ctx, abort.signal)
    await waitForHelper(calls)
    abort.abort()
    await assert.rejects(pending, /cancel/i)
    assert.equal(helper.spawns().length, spawns)
    const file = path.join(rtkRoot, 'state.json'),
      bytes = fs.readFileSync(file)
    for (const mutate of [
      () => fs.writeFileSync(file, JSON.stringify({ version: 1, sequence: 4, mode: 'rewrite-rtk' })),
      () => fs.appendFileSync(config, ' '),
      () => grant({ ...grants(), mh_rtk: 'deny' }),
    ]) {
      calls = helper.calls().length
      const configBytes = fs.readFileSync(config)
      const pending = execute('bash', { command: 'ls safe.txt' })
      await waitForHelper(calls)
      mutate()
      await assert.rejects(pending, /configuration|guard|permission|authority/i)
      assert.equal(helper.spawns().length, spawns)
      fs.writeFileSync(file, bytes)
      fs.writeFileSync(config, configBytes)
      grant({ ...grants(), bash: shellPolicy })
    }
    assert.equal(fs.statSync(rtkRoot).mode & 0o777, 0o700)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    for (const context of [
      { ...ctx, hasUI: false },
      { ...ctx, mode: 'print' },
    ]) {
      await assert.rejects(
        execute('mh_rtk', { operation: 'mode', mode: 'off', expected_sequence: 3 }, context),
        /actual UI/,
      )
    }
    await assert.rejects(
      execute('mh_rtk', {
        operation: 'mode',
        mode: 'off',
        expected_sequence: 3,
        approved: true,
      }),
      /Closed/,
    )
    confirm = async () => false
    await assert.rejects(
      execute('mh_rtk', {
        operation: 'mode',
        mode: 'off',
        expected_sequence: 3,
      }),
      /declined/,
    )
    assert.deepEqual(fs.readFileSync(file), bytes)
    confirm = async () => true
    await assert.rejects(
      execute('mh_rtk', {
        operation: 'mode',
        mode: 'off',
        expected_sequence: 2,
      }),
      /sequence/,
    )
    await assert.rejects(
      execute(
        'mh_rtk',
        { operation: 'status' },
        { ...ctx, sessionManager: { getSessionId: () => session.sessionId } },
      ),
    )
    let release
    confirm = async () => new Promise((r) => (release = r))
    const write = execute('mh_rtk', {
      operation: 'mode',
      mode: 'off',
      expected_sequence: 3,
    })
    while (!release) await new Promise((r) => setTimeout(r, 1))
    fs.writeFileSync(file, JSON.stringify({ version: 1, sequence: 4, mode: 'rewrite-rtk' }))
    release(true)
    await assert.rejects(write, /Stale/)
    fs.writeFileSync(file, bytes)
    confirm = async () => true
    const { mh_rtk: _omitted, ...withoutRtk } = grants()
    grant({ ...withoutRtk, 'mh_*': 'allow' })
    assert.equal((await status()).sequence, 3)
    for (const permission of [
      { ...withoutRtk, 'mh_*': 'allow', mh_rtk: 'deny' },
      { ...withoutRtk, mh_rtk: 'ask' },
      { ...grants(), path_read: { [rtkRoot]: 'deny' } },
    ]) {
      grant(permission)
      await assert.rejects(status())
    }
    grant(grants())
    fs.unlinkSync(config)
    assert.equal((await status()).sequence, 3)
    assert.equal((await status()).mode, 'rewrite-rtk')
    configure('rtk')
    helper.set({ out: 'rtk ls safe.txt\n' })
    let messages
    faux.setResponses([
      ai.fauxAssistantMessage(
        [
          ai.fauxToolCall('bash', { command: 'ls safe.txt' }),
          ai.fauxToolCall('codemode', {
            code: "try { await tools.bash({command:'cat .env'}); text('WRONG'); } catch(e) { text('NESTED_DENIED'); }",
          }),
        ],
        { stopReason: 'toolUse' },
      ),
      (c) => {
        messages = c.messages
        return ai.fauxAssistantMessage('Offline fixture complete')
      },
    ])
    await session.prompt('Offline direct and nested final RTK check')
    const toolResults = JSON.stringify(messages.filter((m) => m.role === 'toolResult'))
    assert.match(toolResults, /NESTED_DENIED/)
    assert.match(toolResults, /FAKE_RTK_NATIVE/)
    // Stale generation while helper is pending: never reach native factory spawn.
    helper.set({ delay: 500, out: 'rtk ls safe.txt\n' })
    calls = helper.calls().length
    spawns = helper.spawns().length
    const stale = execute('bash', { command: 'ls safe.txt' })
    await waitForHelper(calls)
    await shutdown()
    await assert.rejects(stale, /stale|unavailable/i)
    assert.equal(helper.spawns().length, spawns)
    await start()
    await mode('off', 3)
    const off = helper.calls().length
    await execute('bash', { command: 'ls safe.txt' })
    assert.equal(helper.calls().length, off)
    for (let i = 0; i < untouched.length; i++)
      assert.deepEqual(fs.readFileSync(path.join(agentDir, untouched[i])), before[i])
    assert.equal(external, 0)
  } finally {
    await shutdown()
    globalThis.fetch = previous.fetch
    for (const [key, value] of [
      ['PI_CODING_AGENT_DIR', previous.agent],
      ['PATH', previous.path],
      ['BASH_ENV', previous.bash],
      ['HOME', previous.home],
      ['XDG_CONFIG_HOME', previous.xdg],
    ]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
