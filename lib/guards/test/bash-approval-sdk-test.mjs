import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import test from 'node:test'
import * as sdk from '@earendil-works/pi-coding-agent'
import * as ai from '@earendil-works/pi-ai'
import { installRTKHelper } from './rtk-helper-fixture.mjs'

const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const primary = path.resolve(adapter, '../..')
const stage = path.resolve(primary, '..')
// Benign synthetic full heredoc: never the incident command, never network/compute.
const heredoc = "env T240_FIXTURE=1 /bin/sh - <<'T240'\nprintf 'T240_SAFE\\n'\nT240"
// Exact harmless screenshot smoke shape; no files, network or compute workload.
const pythonSmoke =
  "env MAHIRO_GUARD_SMOKE=1 /usr/bin/python3 - <<'PY'\nimport os\nassert os.environ.get('MAHIRO_GUARD_SMOKE') == '1'\nprint('MAHIRO_GUARD_SMOKE_OK')\nPY"

test('aggregate Bash receipts bind exact invocation, lifecycle and full heredoc', async () => {
  assert.match(stage, /\.agent-state\/runtime\//)
  const home = path.join(stage, 'bash-home')
  fs.mkdirSync(home)
  const previous = {
    home: process.env.HOME,
    agent: process.env.PI_CODING_AGENT_DIR,
    xdg: process.env.XDG_CONFIG_HOME,
    bash: process.env.BASH_ENV,
    fetch: globalThis.fetch,
    path: process.env.PATH,
  }
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = path.join(home, '.config')
  process.env.BASH_ENV = '/dev/null'
  let network = 0
  globalThis.fetch = () => {
    network++
    throw Error('offline only')
  }
  const results = []
  let n = 0
  try {
    for (const scenario of process.env.BASH_EXPECT_OWNER === 'old'
      ? ['old-yolo']
      : [
          'yolo',
          'once',
          'yolo-rtk',
          'once-rtk',
          'yolo-python',
          'once-python',
          'yolo-python-rtk',
          'once-python-rtk',
          'changed-rtk',
          'deny',
          'absent',
          'stale',
          'completed',
          'reloaded',
          'cross-session',
          'same-id-manager',
          'full-id',
          'body-mutation',
          'final-mutation',
          'cancel',
          'late',
          'replay',
          'policy-deny',
        ]) {
      const original =
        scenario === 'changed-rtk'
          ? 'env T240_FIXTURE=1 /bin/echo T240_SAFE'
          : scenario.includes('python')
            ? pythonSmoke
            : heredoc
      const changed = original.replace('T240_SAFE', 'T240_CHANGED')
      const base = path.join(stage, `bash-${++n}`),
        cwd = path.join(base, 'cwd'),
        agentDir = path.join(base, 'profile')
      fs.mkdirSync(cwd, { recursive: true })
      const helper = scenario === 'changed-rtk' ? installRTKHelper(base) : undefined
      if (helper) {
        process.env.PATH = `${helper.bin}:/usr/bin:/bin`
        helper.set({ code: 3, out: changed + '\n' })
      }
      process.env.PI_CODING_AGENT_DIR = agentDir
      const config = path.join(agentDir, 'extensions/pi-permission-system/config.json')
      fs.mkdirSync(path.dirname(config), { recursive: true })
      fs.writeFileSync(
        config,
        JSON.stringify({
          yoloMode: !scenario.startsWith('once') && scenario !== 'late',
          authorizerChain: ['fixture-once'],
          permission: {
            '*': 'allow',
            bash: scenario === 'deny' ? 'deny' : 'allow',
            mh_rtk: 'allow',
            [`rtk_state_${createHash('sha256').update(path.join(agentDir, 'preferences/rtk')).digest('hex')}`]:
              'allow',
          },
        }),
      )
      if (scenario.endsWith('-rtk')) {
        const rtkConfig = path.join(agentDir, 'extensions/mahiro-rtk/config.json')
        fs.mkdirSync(path.dirname(rtkConfig), { recursive: true, mode: 0o700 })
        fs.writeFileSync(rtkConfig, JSON.stringify({ version: 1, profile: agentDir, projects: [cwd] }), {
          mode: 0o600,
        })
      }
      let ctx,
        getService,
        approveCalls = 0,
        captured,
        gateCommand
      const probe = path.join(primary, `test/bash-probe-${n}.ts`)
      fs.writeFileSync(
        probe,
        `import {getPermissionsService} from '@gotgenes/pi-permission-system';
export default pi => {
  pi.on('session_start', (_e,ctx) => pi.events.emit('fixture:bash', {ctx, getService:()=>getPermissionsService(ctx.sessionManager.getSessionId())}));
  pi.on('tool_call', (e,c) => { if(e.toolName==='bash') pi.events.emit('fixture:bash-observed',{e,c}); });
};`,
      )
      const settings = sdk.SettingsManager.inMemory({
        packages: [
          fs.realpathSync(path.join(adapter, 'node_modules/@gotgenes/pi-permission-system')),
          adapter,
        ],
        extensions: [probe],
        cacheWarming: 'off',
        compaction: { enabled: false },
        retry: { enabled: false },
      })
      const credentials = new ai.InMemoryCredentialStore()
      await credentials.modify('bash-fixture', async () => ({
        type: 'api_key',
        key: 'SYNTHETIC_ONLY',
      }))
      const runtime = await sdk.ModelRuntime.create({
        credentials,
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      })
      const faux = ai.fauxProvider({
        provider: 'bash-fixture',
        models: [{ id: 'offline' }],
      })
      runtime.registerNativeProvider(faux.provider)
      await runtime.refresh({ allowNetwork: false })
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
          (pi) => {
            pi.events.on('fixture:bash', (value) => {
              ;({ ctx, getService } = value)
            })
            pi.events.on('fixture:bash-observed', ({ e }) => {
              captured = e.toolCallId
              gateCommand = e.input.command
            })
          },
        ],
      })
      await loader.reload()
      assert.deepEqual(loader.getExtensions().errors, [])
      const definitions = new Map()
      for (const ext of loader.getExtensions().extensions)
        for (const t of ext.tools.values()) definitions.set(t.definition.name, t.definition)
      const { session } = await sdk.createAgentSession({
        cwd,
        agentDir,
        settingsManager: settings,
        resourceLoader: loader,
        modelRuntime: runtime,
        model: faux.getModel(),
        sessionManager: sdk.SessionManager.inMemory(cwd),
      })
      try {
        await session.bindExtensions({
          mode: 'rpc',
          uiContext: {
            notify() {},
            setStatus() {},
            setWidget() {},
            confirm: async () => true,
          },
        })
        await runtime.refresh({ allowNetwork: false })
        assert.ok(ctx && getService())
        faux.setResponses([ai.fauxAssistantMessage('Warm offline parser')])
        await session.prompt('Initialize synthetic offline turn')
        for (
          let attempt = 0;
          attempt < 200 &&
          scenario !== 'deny' &&
          getService().checkPermission('bash', original).state !== 'ask';
          attempt++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        assert.equal(
          getService().checkPermission('bash', original).state,
          scenario === 'deny' ? 'deny' : 'ask',
          'real synthetic indirection floor required',
        )
        getService().registerAuthorizer('fixture-once', async () => {
          approveCalls++
          if (scenario === 'late')
            await session.extensionRunner.emit({
              type: 'turn_end',
              turnIndex: 0,
              message: ai.fauxAssistantMessage('expiry'),
              toolResults: [],
            })
          return { kind: 'allow' }
        })
        if (scenario.endsWith('-rtk')) {
          await session.prompt('/mh-rtk mode rewrite-rtk 0')
          assert.equal(
            (
              await definitions
                .get('mh_rtk')
                .execute('status', { operation: 'status' }, undefined, undefined, ctx)
            ).details.mode,
            'rewrite-rtk',
          )
        }
        const execute = (id, command = original, context = ctx, signal) =>
          definitions.get('bash').execute(id, { command }, signal, undefined, context)
        if (scenario === 'absent') {
          // Warm the actual parser through an unrelated gate. Its approval must
          // not cover a different unapproved invocation (cold advisory is raw).
          await session.extensionRunner.emitToolCall({
            type: 'tool_call',
            toolName: 'bash',
            toolCallId: 'unrelated',
            input: { command: original },
          })
          await assert.rejects(execute('absent/full/id'), /permission/)
        } else if (
          [
            'stale',
            'completed',
            'reloaded',
            'cross-session',
            'same-id-manager',
            'full-id',
            'cancel',
            'replay',
            'policy-deny',
            'body-mutation',
            'final-mutation',
          ].includes(scenario)
        ) {
          const id = 'native/full/tool/id'
          const gate = await session.extensionRunner.emitToolCall({
            type: 'tool_call',
            toolName: 'bash',
            toolCallId: id,
            input: { command: original },
          })
          assert.notEqual(gate?.block, true, JSON.stringify(gate))
          assert.equal(gateCommand, original)
          if (scenario === 'body-mutation') {
            assert.equal(getService().checkPermission('bash', changed).state, 'ask')
            await assert.rejects(execute(id, changed), /permission/)
          } else if (scenario === 'final-mutation') {
            const check = getService().consumeBashApproval({
              sessionManager: ctx.sessionManager,
              toolCallId: id,
              command: original,
            })
            assert.equal(check(original), true)
            assert.equal(check(changed), false)
            await assert.rejects(execute(id), /permission/)
          } else if (['stale', 'completed', 'reloaded'].includes(scenario)) {
            const check = getService().consumeBashApproval({
              sessionManager: ctx.sessionManager,
              toolCallId: id,
              command: original,
            })
            assert.equal(check(original), true)
            if (scenario === 'completed')
              await session.extensionRunner.emit({
                type: 'tool_execution_end',
                toolCallId: id,
                toolName: 'bash',
                result: { content: [], details: undefined },
                isError: false,
              })
            else if (scenario === 'reloaded')
              await session.extensionRunner.emit({
                type: 'resources_discover',
                reason: 'reload',
                cwd,
              })
            else
              await session.extensionRunner.emit({
                type: 'turn_end',
                turnIndex: 0,
                message: ai.fauxAssistantMessage('expiry'),
                toolResults: [],
              })
            assert.equal(check(original), false)
            await assert.rejects(execute(id), /permission/)
          } else if (['cross-session', 'same-id-manager'].includes(scenario)) {
            assert.equal(
              getService().consumeBashApproval({
                sessionManager:
                  scenario === 'same-id-manager'
                    ? { getSessionId: () => ctx.sessionManager.getSessionId() }
                    : sdk.SessionManager.inMemory(cwd),
                toolCallId: id,
                command: original,
              }),
              undefined,
            )
            await assert.rejects(execute(id), /permission/)
          } else if (scenario === 'full-id') {
            await assert.rejects(execute('id'), /permission/)
          } else if (scenario === 'cancel') {
            const controller = new AbortController()
            controller.abort()
            await assert.rejects(execute(id, original, ctx, controller.signal), /cancel/)
            await assert.rejects(execute(id), /permission/)
          } else if (scenario === 'replay') {
            assert.match(JSON.stringify(await execute(id)), /T240_SAFE/)
            await assert.rejects(execute(id), /permission/)
          } else {
            // A deny introduced after effective approval still wins, without
            // relying on turn expiry to revoke the retained checker.
            const check = getService().consumeBashApproval({
              sessionManager: ctx.sessionManager,
              toolCallId: id,
              command: original,
            })
            assert.equal(check(original), true)
            fs.writeFileSync(
              config,
              JSON.stringify({
                yoloMode: true,
                permission: { '*': 'allow', bash: 'deny' },
              }),
            )
            assert.equal(getService().checkPermission('bash', original).state, 'deny')
            assert.equal(check(original), false)
            await assert.rejects(execute(id), /permission/)
          }
        } else {
          faux.setResponses([
            ai.fauxAssistantMessage([ai.fauxToolCall('bash', { command: original })], {
              stopReason: 'toolUse',
            }),
            ai.fauxAssistantMessage('done'),
          ])
          await session.prompt('Synthetic offline Bash receipt test')
          const result = session.messages.filter((m) => m.role === 'toolResult').at(-1)
          assert.ok(result, scenario)
          const success = scenario.startsWith('yolo') || scenario.startsWith('once')
          assert.equal(!!result.isError, !success, JSON.stringify(result))
          if (success)
            assert.match(
              JSON.stringify(result),
              scenario.includes('python') ? /MAHIRO_GUARD_SMOKE_OK/ : /T240_SAFE/,
            )
          if (helper) {
            assert.match(JSON.stringify(result), /RTK original\/final Bash permission/)
            assert.equal(helper.calls().length, 1)
            assert.equal(helper.spawns().length, 0)
          }
          if (scenario.startsWith('once')) assert.equal(approveCalls, 1)
          assert.equal(
            getService().consumeBashApproval?.({
              sessionManager: ctx.sessionManager,
              toolCallId: captured,
              command: original,
            }),
            undefined,
          )
        }
        assert.equal(
          getService().checkPermission('bash', original).state === 'ask',
          scenario !== 'deny' && scenario !== 'policy-deny',
        )
        results.push({ scenario, passed: true })
      } finally {
        await session.extensionRunner.emit({
          type: 'session_shutdown',
          reason: 'quit',
        })
        session.dispose()
      }
    }
    assert.equal(network, 0)
    fs.writeFileSync(
      path.join(stage, 'bash-approval-results.json'),
      JSON.stringify({ results, network, live: false }, null, 2),
    )
  } finally {
    for (const [key, value] of [
      ['HOME', previous.home],
      ['PI_CODING_AGENT_DIR', previous.agent],
      ['XDG_CONFIG_HOME', previous.xdg],
      ['BASH_ENV', previous.bash],
      ['PATH', previous.path],
    ]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    globalThis.fetch = previous.fetch
  }
})
