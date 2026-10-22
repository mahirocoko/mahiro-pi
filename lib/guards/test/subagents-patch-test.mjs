import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { devNull } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { normalizeSubagentsCopy } from './subagents-supply-fixture.mjs'
import { gitFixtureEnv } from './git-isolation-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(root, '../../.agent-state/runtime/pi-ownership-repair/subagents')
fs.mkdirSync(workspace, { recursive: true })

test('Git apply fixture isolation preserves a staged parent under hostile inheritance', () => {
  const parent = fs.mkdtempSync(path.join(workspace, 'git-apply-parent-'))
  const processBefore = { ...process.env }
  const clean = gitFixtureEnv(parent)
  const git = (cwd, args, env = clean) => {
    const result = spawnSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 10000,
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result.stdout
  }
  git(parent, ['init', '--template='])
  git(parent, ['config', 'user.name', 'Disposable apply fixture'])
  git(parent, ['config', 'user.email', 'fixture@example.invalid'])
  git(parent, ['config', 'commit.gpgsign', 'false'])
  git(parent, ['config', 'core.hooksPath', devNull])
  const subject = path.join(parent, 'subject.txt')
  const sentinel = path.join(parent, 'sentinel.txt')
  fs.writeFileSync(subject, 'before\n')
  fs.writeFileSync(sentinel, 'initial\n')
  git(parent, ['add', '--', 'subject.txt', 'sentinel.txt'])
  git(parent, ['commit', '-m', 'Disposable apply parent'])
  fs.writeFileSync(sentinel, 'staged sentinel must survive\n')
  git(parent, ['add', '--', 'sentinel.txt'])
  const head = git(parent, ['rev-parse', 'HEAD'])
  assert.equal(git(parent, ['diff', '--cached', '--name-only']), 'sentinel.txt\n')
  const snapshot = () => {
    const files = {}
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) visit(file)
        else files[path.relative(parent, file)] = fs.readFileSync(file)
      }
    }
    visit(path.join(parent, '.git'))
    files['subject.txt'] = fs.readFileSync(subject)
    files['sentinel.txt'] = fs.readFileSync(sentinel)
    return files
  }
  const before = snapshot()
  const stage = path.join(parent, 'stage')
  fs.mkdirSync(stage)
  fs.writeFileSync(path.join(stage, 'subject.txt'), 'before\n')
  const patch = path.join(stage, 'fixture.patch')
  fs.writeFileSync(
    patch,
    'diff --git a/subject.txt b/subject.txt\n--- a/subject.txt\n+++ b/subject.txt\n@@ -1 +1 @@\n-before\n+after\n',
  )
  const hostile = {
    ...process.env,
    FIXTURE_UNRELATED_ENV: 'preserved',
    GIT_DIR: path.join(parent, '.git'),
    GIT_COMMON_DIR: path.join(parent, '.git'),
    GIT_WORK_TREE: parent,
    GIT_INDEX_FILE: path.join(parent, '.git/index'),
    GIT_OBJECT_DIRECTORY: path.join(parent, '.git/objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(parent, '.git/objects'),
    GIT_CEILING_DIRECTORIES: '/',
    GIT_CONFIG: path.join(parent, '.git/config'),
    GIT_CONFIG_GLOBAL: path.join(parent, '.git/config'),
    GIT_CONFIG_SYSTEM: path.join(parent, '.git/config'),
    GIT_CONFIG_NOSYSTEM: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: parent,
    GIT_CONFIG_PARAMETERS: "'core.worktree'='" + parent + "'",
    GIT_TERMINAL_PROMPT: '1',
  }
  const hostileBefore = { ...hostile }
  const env = gitFixtureEnv(parent, hostile)
  assert.equal(env.FIXTURE_UNRELATED_ENV, 'preserved')
  assert.equal(env.GIT_CEILING_DIRECTORIES, fs.realpathSync(parent))
  assert.equal(env.GIT_CONFIG_GLOBAL, devNull)
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1')
  assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  for (const args of [
    ['apply', '--check', patch],
    ['apply', patch],
  ])
    git(stage, args, env)
  assert.equal(fs.readFileSync(path.join(stage, 'subject.txt'), 'utf8'), 'after\n')
  assert.deepEqual(snapshot(), before, 'parent Git/index/files remain byte-identical')
  assert.equal(git(parent, ['rev-parse', 'HEAD']), head)
  git(stage, ['apply', '--reverse', '--check', patch], env)
  git(stage, ['apply', '--reverse', patch], env)
  assert.equal(fs.readFileSync(path.join(stage, 'subject.txt'), 'utf8'), 'before\n')
  assert.deepEqual(snapshot(), before)
  assert.deepEqual(hostile, hostileBefore, 'input environment is not mutated')
  assert.deepEqual({ ...process.env }, processBefore, 'parent environment is not mutated')
})

// Reapply from the canonical manifest and frozen lock, never the live package.
// SUBAGENTS_UNPATCHED falsifies the same behavioral contract against upstream.
test('initial outcome claims use native queue, notifications, events and resume lifecycle', async () => {
  const fixture = fs.mkdtempSync(path.join(workspace, 'subagents-patch-proof-'))
  const product = path.resolve(root, '../..')
  const manifest = JSON.parse(fs.readFileSync(path.join(product, 'package.json'), 'utf8'))
  fs.writeFileSync(
    path.join(fixture, 'package.json'),
    JSON.stringify({
      private: true,
      dependencies: {
        '@gotgenes/pi-subagents': manifest.dependencies['@gotgenes/pi-subagents'],
      },
    }),
  )
  // This minimal fixture contains only subagents, not the newly patched
  // permission owner. Keep its one relevant canonical patch mapping.
  const workspaceSource = fs.readFileSync(path.join(product, 'pnpm-workspace.yaml'), 'utf8')
  const mapping = workspaceSource.match(/^  '@gotgenes\/pi-subagents@23\.4\.1': .+$/m)?.[0]
  assert.ok(mapping)
  fs.writeFileSync(path.join(fixture, 'pnpm-workspace.yaml'), `patchedDependencies:\n${mapping}\n`)
  fs.cpSync(path.join(product, 'patches'), path.join(fixture, 'patches'), {
    recursive: true,
  })
  // Test only a supplied public copy. No installer, registry or live owner mutation.
  const supplied = fs.realpathSync(path.join(root, 'node_modules/@gotgenes/pi-subagents'))
  const packageRoot = path.join(fixture, 'subagents')
  normalizeSubagentsCopy({
    product,
    supplied,
    target: packageRoot,
    ceiling: fixture,
  })
  fs.symlinkSync(path.resolve(supplied, '../..'), path.join(packageRoot, 'node_modules'), 'dir')
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir')
  const patch = path.join(product, 'patches/@gotgenes__pi-subagents@23.4.1.patch')
  const verify = spawnSync(
    'git',
    ['apply', '--reverse', ...(process.env.SUBAGENTS_UNPATCHED ? [] : ['--check']), patch],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      env: gitFixtureEnv(fixture),
    },
  )
  assert.equal(verify.status, 0, verify.stderr)
  const exports = {
    SubagentsServiceAdapter: 'service/service-adapter.ts',
    SubagentManager: 'lifecycle/subagent-manager.ts',
    ConcurrencyLimiter: 'lifecycle/concurrency-limiter.ts',
    NotificationManager: 'observation/notification.ts',
    SubagentEventsObserver: 'observation/subagent-events-observer.ts',
  }
  const bundle = path.join(fixture, 'native.mjs')
  await build({
    stdin: {
      contents: Object.entries(exports)
        .map(
          ([name, file]) => `export { ${name} } from ${JSON.stringify(path.join(packageRoot, 'src', file))};`,
        )
        .join('\n'),
      resolveDir: packageRoot,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: bundle,
    plugins: [
      {
        name: 'native-typescript-import-map',
        setup(builder) {
          builder.onResolve({ filter: /^#src\// }, ({ path: specifier }) => ({
            path: path.join(packageRoot, 'src', `${specifier.slice(5)}.ts`),
          }))
        },
      },
    ],
  })
  const {
    SubagentsServiceAdapter,
    SubagentManager,
    ConcurrencyLimiter,
    NotificationManager,
    SubagentEventsObserver,
  } = await import(pathToFileURL(bundle).href)
  const sent = [],
    events = [],
    persisted = [],
    created = [],
    started = []
  const notifications = new NotificationManager((message, options) => sent.push({ message, options }))
  const observer = new SubagentEventsObserver({
    emit: (channel, data) => events.push({ channel, data }),
    appendEntry: (type, data) => persisted.push({ type, data }),
    notifications,
  })
  let cancelOnCreate = false
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const budget = { used: 1, phase: 'within' }
  let active = 0,
    peak = 0
  const manager = new SubagentManager({
    baseCwd: fixture,
    limiter: new ConcurrencyLimiter(() => 1),
    registry: {
      resolveType: (type) =>
        ['worker', 'Reflect', 'wrong', 'general-purpose'].includes(type) ? type : undefined,
      isValidType: () => true,
      resolveAgentConfig: (type) =>
        type === 'Reflect'
          ? {
              name: 'Reflect',
              model: 'fixture/model',
              thinking: 'low',
              toolNames: [],
              runInBackground: true,
              promptMode: 'replace',
              locked: ['model', 'thinking'],
            }
          : { name: type, promptMode: 'append' },
    },
    observer: {
      onSubagentCreated(record) {
        created.push({ id: record.id, claimed: record.claimed })
        observer.onSubagentCreated(record)
        if (cancelOnCreate) manager.abort(record.id)
      },
      onSubagentStarted: (record) => observer.onSubagentStarted(record),
      onSubagentCompleted: (record) => observer.onSubagentCompleted(record),
      onSubagentResuming: (record) => observer.onSubagentResuming(record),
      onSubagentResumed: (record) => observer.onSubagentResumed(record),
      onSubagentCompacted: (record, info) => observer.onSubagentCompacted(record, info),
    },
    createSubagentSession: async () => ({
      subscribe: () => () => {},
      dispose: async () => {},
      getContextPercent: () => null,
      runTurnLoop: async (prompt, { signal }) => {
        started.push(prompt)
        active++
        peak = Math.max(peak, active)
        try {
          if (prompt === 'hold') await gate
          if (prompt === 'cancel-running')
            await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
          if (prompt === 'error') throw new Error('synthetic failure')
          return { responseText: `result:${prompt}`, turnBudget: budget }
        } finally {
          active--
        }
      },
      resumeTurnLoop: async (prompt) => ({
        responseText: `resume:${prompt}`,
        turnBudget: budget,
      }),
    }),
  })
  const service = new SubagentsServiceAdapter(
    manager,
    () => {
      throw new Error('No provider allowed')
    },
    {
      currentCtx: {},
      buildSnapshot: () => ({}),
      getSessionInfo: () => ({ parentSessionFile: '', parentSessionId: '' }),
    },
  )
  try {
    assert.equal(
      service.supportsInitialOutcomeClaim,
      process.env.SUBAGENTS_UNPATCHED ? undefined : true,
      'runtime capability must distinguish stale upstream from the patched service',
    )
    console.log(`Runtime initial-claim capability: ${service.supportsInitialOutcomeClaim}`)
    if (!process.env.SUBAGENTS_UNPATCHED) {
      assert.equal(typeof service.getAgentType, 'function')
      assert.equal(service.getAgentType('missing'), undefined)
      const role = service.getAgentType('Reflect')
      assert.deepEqual(role, {
        name: 'Reflect',
        model: 'fixture/model',
        thinking: 'low',
        toolNames: [],
        runInBackground: true,
        inheritContext: undefined,
        promptMode: 'replace',
        locked: ['model', 'thinking'],
      })
      assert.ok(Object.isFrozen(role) && Object.isFrozen(role.toolNames) && Object.isFrozen(role.locked))
      const eligible = (name) => {
        const config = service.getAgentType(name)
        return (
          config?.model === 'fixture/model' && config.thinking === 'low' && config.toolNames?.length === 0
        )
      }
      assert.equal(eligible('missing'), false)
      assert.equal(eligible('wrong'), false)
      assert.equal(manager.listAgents().length, 0)
    } else assert.equal(service.getAgentType, undefined)
    const hold = service.spawn('worker', 'hold')
    const owned = service.spawn('worker', 'fast', { claimOutcome: true })
    assert.equal(service.getRecord(owned).status, 'queued')
    assert.equal(service.getRecord(owned).isBackground, true)
    assert.equal(
      created.find((entry) => entry.id === owned).claimed,
      true,
      'claim must precede synchronous CREATED observers',
    )
    const cancelled = service.spawn('worker', 'never', { claimOutcome: true })
    assert.equal(service.abort(cancelled), true)
    assert.equal(service.getRecord(cancelled).status, 'stopped')
    release()
    await service.waitForAll()
    assert.equal(peak, 1)
    assert.deepEqual(started, ['hold', 'fast'])
    assert.equal(service.getRecord(owned).result, 'result:fast')
    assert.deepEqual(
      sent.map((entry) => entry.message.details.id),
      [hold],
    )
    assert.equal(sent[0].options.triggerTurn, true)
    assert.equal(persisted.length, 3)
    assert.ok(events.some((entry) => entry.channel === 'subagents:completed' && entry.data.id === owned))
    const failed = service.spawn('worker', 'error', { claimOutcome: true })
    await service.waitForAll()
    assert.equal(service.getRecord(failed).status, 'error')
    assert.ok(events.some((entry) => entry.channel === 'subagents:failed' && entry.data.id === failed))
    const running = service.spawn('worker', 'cancel-running', {
      claimOutcome: true,
    })
    while (!started.includes('cancel-running')) await new Promise((resolve) => setImmediate(resolve))
    service.abort(running)
    await service.waitForAll()
    assert.equal(service.getRecord(running).status, 'stopped')
    cancelOnCreate = true
    const immediate = service.spawn('worker', 'never-at-create', {
      claimOutcome: true,
    })
    cancelOnCreate = false
    await service.waitForAll()
    assert.equal(service.getRecord(immediate).status, 'stopped')
    assert.equal(sent.length, 1, 'owned error/cancel must not nudge')
    const resumed = await service.resume(owned, 'ordinary')
    assert.equal(resumed.kind, 'resumed')
    assert.equal(resumed.record.result, 'resume:ordinary')
    assert.equal(sent.length, 2, 'initial claim must not leak into unclaimed resume')
    await service.resume(failed, 'after-error')
    await service.resume(running, 'after-cancel')
    assert.equal(sent.length, 4, 'error/cancel claims must not leak into resume')
    const ordinary = service.spawn('worker', 'ordinary', {
      claimOutcome: false,
    })
    await service.waitForAll()
    assert.equal(sent.at(-1).message.details.id, ordinary)
    notifications.onParentAgentStart()
    service.spawn('worker', 'withheld-owned', { claimOutcome: true })
    await service.waitForAll()
    notifications.onParentAgentSettled()
    assert.equal(sent.length, 5, 'parent-run queue flush must not publish claimed completion')
    const publicTypes = fs.readFileSync(path.join(packageRoot, 'dist/public.d.ts'), 'utf8')
    assert.match(publicTypes.match(/interface SpawnOptions \{[\s\S]*?\n\}/)[0], /claimOutcome\?: boolean/)
    assert.match(publicTypes, /readonly supportsInitialOutcomeClaim: true/)
    console.log(`Reapplied frozen patch fixture: ${fixture}`)
  } finally {
    release()
    manager.abortAll()
    await manager.waitForAll()
    await manager.dispose()
    notifications.dispose()
  }
})
