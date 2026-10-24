import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  display,
  gitStatus,
  gitLineChanges,
  gitSnapshot,
  herdrBinding,
  metadataArgs,
  publishMetadata,
  start,
  text,
  TTL_MS,
  HEARTBEAT_MS,
  run,
} from '../lib/status.ts'
import extension from '../extensions/mahiro-status.ts'

const flush = () => new Promise((resolve) => setImmediate(resolve))
const env = {
  HERDR_ENV: '1',
  HERDR_PANE_ID: 'pane-test',
  HERDR_SOCKET_PATH: '/synthetic/herdr.sock',
  HERDR_SESSION_ID: 'session-test',
}

function fixture(extra = {}) {
  let clock = 0,
    stopped = 0
  const writes: (string | undefined)[] = []
  const jobs: any[] = []
  const owner = { seq: 100, dispose: undefined as undefined | (() => void) }
  const ctx = {
    cwd: '/synthetic/repo',
    mode: 'tui',
    model: { id: 'm1', name: 'Model 1', provider: 'p1' },
    thinkingLevel: 'high',
    getContextUsage: () => ({ percent: 0 as number | null }),
    isIdle: () => true,
    ui: {
      setStatus: (key: string, value: string | undefined) => {
        assert.equal(key, 'mahiro-status')
        writes.push(value)
      },
    },
  }
  const options = {
    env,
    owner,
    now: () => clock,
    publish: (execute: any, binding: any, args: string[]) => execute('herdr', args, undefined, binding),
    every: (_callback: () => void, ms: number) => {
      assert.equal(ms, 1000)
      return () => {
        stopped++
      }
    },
    run: (command: string, args: string[], cwd?: string, inherited?: object) => {
      let resolve!: (value: string) => void, reject!: (reason: Error) => void
      const job = {
        command,
        args,
        cwd,
        inherited,
        cancelled: false,
        promise: new Promise<string>((yes, no) => {
          resolve = yes
          reject = no
        }),
        cancel() {
          job.cancelled = true
        },
        resolve: (value = '') => resolve(value),
        reject: () => reject(new Error('synthetic failure')),
      }
      jobs.push(job)
      return job
    },
    ...extra,
  }
  const controller = start(ctx, options)
  return {
    ctx,
    options,
    controller,
    jobs,
    writes,
    owner,
    advance: (ms: number) => {
      clock += ms
    },
    stopped: () => stopped,
  }
}

test('porcelain -z counts changes, rename paths, arbitrary filenames and upstream state', () => {
  assert.equal(gitStatus('## main\0'), 'git clean')
  assert.equal(gitStatus('## HEAD (no branch)\0'), 'git clean')
  assert.equal(gitStatus('## No commits yet on main\0?? new\0'), 'git clean ?:1')
  assert.equal(
    gitStatus(
      '## main...origin/main [ahead 2, behind 3]\0 M line\nname\0R  renamed\0?? not-untracked\0?? real\nfile\0UU conflict\0',
    ),
    'git dirty:3 ?:1 ahead:2 behind:3',
  )
  assert.equal(gitStatus('## main\0C  copy\0## fake [ahead 99]\0 D deleted\0'), 'git dirty:2')
})

test('tracked numstat parses numeric net changes and rename paths, never binary/malformed as zero', () => {
  assert.deepEqual(gitLineChanges('247\t89\ttracked\0'), { added: 247, deleted: 89 })
  assert.deepEqual(gitLineChanges('2\t3\t\0old\nname\0new\tname\0'), { added: 2, deleted: 3 })
  assert.deepEqual(gitLineChanges(''), { added: 0, deleted: 0 })
  for (const value of ['-\t-\tbinary\0', 'bad\0', '1\t2\t\0old\0', '9007199254740992\t1\tx\0'])
    assert.equal(gitLineChanges(value), undefined)
})

test('Git snapshot is sequential, bounded, readonly and cancellable across both jobs', async () => {
  for (const cancelAt of ['status', 'diff', 'none', 'failure', 'binary']) {
    const jobs: any[] = []
    const execute: any = (command: string, args: string[], cwd: string) => {
      let resolve!: (value: string) => void, reject!: (error: Error) => void
      const job = {
        command,
        args,
        cwd,
        cancelled: false,
        promise: new Promise<string>((yes, no) => {
          resolve = yes
          reject = no
        }),
        cancel() {
          job.cancelled = true
        },
        resolve: (value: string) => resolve(value),
        reject: () => reject(new Error('unborn HEAD')),
      }
      jobs.push(job)
      return job
    }
    const snapshot = gitSnapshot(execute, '/synthetic/repo')
    const result = snapshot.promise.then(
      (value) => value,
      () => 'cancelled',
    )
    assert.equal(jobs.length, 1)
    if (cancelAt === 'status') snapshot.cancel()
    jobs[0].resolve('## main\0 M tracked\0?? untracked\0')
    await flush()
    if (cancelAt === 'status') {
      assert.equal(await result, 'cancelled')
      assert.equal(jobs.length, 1, 'late status cannot spawn diff')
      assert.equal(jobs[0].cancelled, true)
      continue
    }
    assert.equal(jobs.length, 2)
    assert.deepEqual(jobs[1].args, [
      '--no-optional-locks',
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--numstat',
      '-z',
      'HEAD',
      '--',
    ])
    assert.equal(jobs[1].cwd, '/synthetic/repo')
    if (cancelAt === 'diff') snapshot.cancel()
    if (cancelAt === 'failure') jobs[1].reject()
    else jobs[1].resolve(cancelAt === 'binary' ? '-\t-\tbinary\0' : '247\t89\ttracked\0')
    assert.equal(
      await result,
      cancelAt === 'diff'
        ? 'cancelled'
        : `git dirty:1 ?:1${cancelAt === 'none' ? ' added:247 deleted:89' : ''}`,
    )
    if (cancelAt === 'diff') assert.equal(jobs[1].cancelled, true)
  }
})

test('Git cwd changes and disposal cancel diff and reject late old-cwd snapshots', async () => {
  const f = fixture({ env: {} })
  f.jobs[0].resolve('## main\0 M tracked\0')
  await flush()
  const diff = f.jobs[1]
  f.ctx.cwd = '/synthetic/other'
  f.controller.tick()
  assert.equal(diff.cancelled, true)
  diff.resolve('247\t89\ttracked\0')
  await flush()
  assert.ok(!f.writes.some((value) => value?.includes('added:247')))
  const status = f.jobs[2]
  status.resolve('## other\0')
  await flush()
  const nextDiff = f.jobs[3]
  f.controller.dispose()
  assert.equal(nextDiff.cancelled, true)
  nextDiff.resolve('9\t9\tx\0')
  const count = f.writes.length
  await flush()
  assert.equal(f.writes.length, count)
})

test('context distinguishes unknown from zero; controls and effort are bounded', () => {
  assert.equal(text('hi\x1b\n\u202e there'), 'hi there')
  assert.deepEqual(display({ getContextUsage: () => undefined }), ['', '', ''])
  const f = fixture({ env: {} })
  assert.deepEqual(display(f.ctx), ['Model 1 · high', 'p1', 'ctx ▱▱▱▱▱▱ 0%'])
  f.ctx.getContextUsage = () => ({ percent: null })
  assert.equal(display(f.ctx)[2], '')
  for (const value of [NaN, Infinity, -1, 101]) {
    f.ctx.getContextUsage = () => ({ percent: value })
    assert.equal(display(f.ctx)[2], '')
  }
  f.controller.dispose()
})

test('binding is inherited only, outside-Herdr publication disabled', () => {
  assert.equal(herdrBinding({ ...env, HERDR_ENV: '0' }), undefined)
  assert.equal(herdrBinding({ ...env, HERDR_SOCKET_PATH: '' }), undefined)
  assert.equal(herdrBinding({ ...env, HERDR_PANE_ID: 'bad\nvalue' }), undefined)
  const f = fixture({ env: {} })
  assert.deepEqual(
    f.jobs.map((j) => j.command),
    ['git'],
  )
  f.controller.dispose()
})

test('one request per producer, fixed TTL, heartbeat, exact pane/session binding', async () => {
  const f = fixture()
  f.controller.tick()
  f.controller.tick()
  assert.equal(f.jobs.length, 2)
  const [git, metadata] = f.jobs
  assert.equal(git.cwd, f.ctx.cwd)
  assert.ok(git.args.includes('-z'))
  assert.equal(metadata.cwd, undefined)
  assert.deepEqual(metadata.inherited, env)
  assert.deepEqual(metadata.args.slice(0, 7), [
    'pane',
    'report-metadata',
    'pane-test',
    '--source',
    'mahiro:pi-display',
    '--agent',
    'pi',
  ])
  assert.ok(metadata.args.includes(String(TTL_MS)))
  assert.ok(!metadata.args.includes('--applies-to-source'))
  git.resolve('## main\0')
  metadata.resolve()
  await flush()
  f.advance(HEARTBEAT_MS - 1)
  f.controller.tick()
  assert.equal(f.jobs.filter((j) => j.command === 'herdr').length, 1)
  f.advance(1)
  f.controller.tick()
  assert.equal(f.jobs.filter((j) => j.command === 'herdr').length, 2)
  assert.equal(f.owner.seq, 102)
  f.controller.dispose()
})

test('model/provider changes clear context and missing tokens; old acknowledgements cannot cache stale values', async () => {
  const f = fixture()
  f.ctx.model = { id: 'm2', name: 'Model 2', provider: 'p2' }
  f.controller.modelChanged()
  f.jobs[1].resolve()
  await flush()
  f.controller.tick()
  const next = f.jobs.at(-1)
  assert.ok(next.args.includes('mahiro_sidebar_model=Model 2 · high'))
  assert.ok(next.args.includes('mahiro_sidebar_provider=p2'))
  assert.ok(next.args.includes('--clear-token'))
  assert.ok(!next.args.includes('mahiro_sidebar_context=ctx ▱▱▱▱▱▱ 0%'))
  next.resolve()
  await flush()
  f.controller.contextFresh({
    model: 'm2',
    provider: 'p2',
    stopReason: 'stop',
    usage: { input: 20, output: 1, cacheRead: 0, cacheWrite: 0 },
  })
  assert.ok(f.jobs.at(-1).args.includes('mahiro_sidebar_context=ctx ▱▱▱▱▱▱ 0%'))
  f.jobs.at(-1).resolve()
  await flush()
  f.ctx.model = undefined as any
  f.controller.tick()
  const cleared = f.jobs.at(-1).args
  for (const key of ['mahiro_sidebar_model', 'mahiro_sidebar_provider', 'mahiro_sidebar_context'])
    assert.ok(cleared.includes(key))
  f.controller.dispose()
})

test('direct OpenAI heartbeat, model changes and reload never overwrite shared sidebar quota', async () => {
  const presentation = { render() {}, tick() {}, tokens: () => ({}), invalidate() {}, dispose() {} }
  const f = fixture({ presentation })
  f.ctx.model = { id: 'native', name: 'Native', provider: 'openai' }
  // Discard the fixture's initial non-native publication.
  f.jobs[1].resolve()
  await flush()
  f.controller.modelChanged(f.ctx.model)
  const assertSharedUntouched = (args: string[]) => {
    assert.ok(args.includes('mahiro_sidebar_provider=openai'))
    assert.ok(args.some((value) => value.startsWith('mahiro_sidebar_model=')))
    assert.ok(!args.some((value) => /^mahiro_sidebar_q[12]_(ok|warn|critical)(=|$)/.test(value)))
  }
  let report = f.jobs.filter((job) => job.command === 'herdr').at(-1)
  assertSharedUntouched(report.args)
  report.resolve()
  await flush()
  f.advance(HEARTBEAT_MS)
  f.controller.tick()
  report = f.jobs.filter((job) => job.command === 'herdr').at(-1)
  assertSharedUntouched(report.args)
  report.resolve()
  await flush()
  f.controller.contextFresh({
    model: 'native',
    provider: 'openai',
    stopReason: 'stop',
    usage: { input: 20, output: 1, cacheRead: 0, cacheWrite: 0 },
  })
  report = f.jobs.filter((job) => job.command === 'herdr').at(-1)
  assertSharedUntouched(report.args)
  assert.ok(report.args.includes('mahiro_sidebar_context=ctx ▱▱▱▱▱▱ 0%'))
  report.resolve()
  await flush()
  f.ctx.model = { ...f.ctx.model, id: 'native-2', name: 'Native 2' }
  f.controller.modelChanged(f.ctx.model)
  report = f.jobs.filter((job) => job.command === 'herdr').at(-1)
  assertSharedUntouched(report.args)
  report.resolve()
  await flush()
  const replacement = start(f.ctx, f.options)
  assertSharedUntouched(f.jobs.filter((job) => job.command === 'herdr').at(-1).args)
  const before = f.jobs.length
  replacement.dispose()
  assert.equal(f.jobs.length, before, 'dispose must not emit quota clears')
})

test('legacy quota still publishes and clears, while pending direct OpenAI selection preserves shared slots', async () => {
  let quota: Record<string, string> = { mahiro_sidebar_q1_warn: 'Codex 7d 34%' }
  const f = fixture({
    presentation: {
      render() {},
      tick() {},
      tokens: () => quota,
      invalidate() {
        quota = {}
      },
      dispose() {},
    },
  })
  f.jobs[1].resolve()
  await flush()
  f.ctx.model = { id: 'legacy', name: 'Legacy', provider: 'openai-codex' }
  f.controller.tick()
  let report = f.jobs.filter((job) => job.command === 'herdr').at(-1)
  assert.ok(report.args.includes('mahiro_sidebar_q1_warn=Codex 7d 34%'))
  report.resolve()
  await flush()
  quota = {}
  f.advance(HEARTBEAT_MS)
  f.controller.tick()
  report = f.jobs.filter((job) => job.command === 'herdr').at(-1)
  assert.equal(
    report.args.filter((value: string) => /^mahiro_sidebar_q[12]_(ok|warn|critical)$/.test(value)).length,
    6,
  )
  report.resolve()
  await flush()
  const native = { id: 'native', name: 'Native', provider: 'openai' }
  f.controller.modelChanged(native) // ctx still holds legacy identity.
  report = f.jobs.filter((job) => job.command === 'herdr').at(-1)
  assert.ok(!report.args.some((value: string) => /^mahiro_sidebar_q[12]_/.test(value)))
  report.resolve()
  await flush()
  f.advance(HEARTBEAT_MS)
  f.controller.tick()
  report = f.jobs.filter((job) => job.command === 'herdr').at(-1)
  assert.ok(!report.args.some((value: string) => /^mahiro_sidebar_q[12]_/.test(value)))
  report.resolve()
  await flush()
  f.ctx.model = native
  f.controller.tick()
  report = f.jobs.filter((job) => job.command === 'herdr').at(-1)
  assert.ok(report.args.includes('mahiro_sidebar_provider=openai'))
  assert.ok(!report.args.some((value: string) => /^mahiro_sidebar_q[12]_/.test(value)))
  report.resolve()
  await flush()
  f.ctx.model = { id: 'legacy', name: 'Legacy', provider: 'openai-codex' }
  f.controller.modelChanged(f.ctx.model)
  report = f.jobs.filter((job) => job.command === 'herdr').at(-1)
  assert.equal(
    report.args.filter((value: string) => /^mahiro_sidebar_q[12]_(ok|warn|critical)$/.test(value)).length,
    6,
  )
  f.controller.dispose()
})

test('external quota owns no shared q slots on legacy routes; source changes cancel deferred native publication', async () => {
  let ownsQuota = false
  const f = fixture({ env: {} })
  f.ctx.model = { id: 'legacy', name: 'Legacy', provider: 'openai-codex' }
  const controller = start(f.ctx, {
    ...f.options,
    env,
    publish: publishMetadata,
    presentation: {
      render() {},
      tick() {},
      dispose() {},
      tokens: () => ({ mahiro_sidebar_q1_warn: 'must never publish external account' }),
      ownsQuotaTokens: () => ownsQuota,
    },
  })
  const checks = () => f.jobs.filter((job) => job.args[1] === 'process-info')
  const reports = () => f.jobs.filter((job) => job.args[1] === 'report-metadata')
  const foreground = JSON.stringify({
    result: { process_info: { pane_id: env.HERDR_PANE_ID, foreground_processes: [{ pid: process.pid }] } },
  })
  checks().at(-1).resolve(foreground)
  await flush()
  assert.ok(
    !reports()
      .at(-1)
      .args.some((value: string) => /^mahiro_sidebar_q[12]_/.test(value)),
  )
  reports().at(-1).resolve()
  await flush()
  ownsQuota = true
  controller.tick()
  const old = checks().at(-1)
  ownsQuota = false
  controller.tick()
  assert.equal(old.cancelled, true)
  const replacement = checks().at(-1)
  assert.notEqual(replacement, old)
  old.resolve(foreground)
  await flush()
  assert.equal(reports().length, 1, 'old native source cannot publish after source invalidation')
  replacement.resolve(foreground)
  await flush()
  assert.equal(reports().length, 2)
  assert.ok(
    !reports()
      .at(-1)
      .args.some((value: string) => /^mahiro_sidebar_q[12]_/.test(value)),
  )
  controller.dispose()
})

test('model invalidation cancels deferred foreground checks before stale legacy quota can publish', async () => {
  for (const change of ['selection', 'poll', 'usage']) {
    const f = fixture({ env: {} })
    f.ctx.model = { id: 'legacy', name: 'Legacy', provider: 'openai-codex' }
    const controller = start(f.ctx, {
      ...f.options,
      env,
      publish: publishMetadata,
      presentation: { render() {}, tick() {}, tokens: () => ({}), invalidate() {}, dispose() {} },
    })
    const checks = () => f.jobs.filter((job) => job.args[1] === 'process-info')
    const reports = () => f.jobs.filter((job) => job.args[1] === 'report-metadata')
    const old = checks().at(-1)
    const native = { id: 'native', name: 'Native', provider: 'openai' }
    if (change === 'selection') controller.modelChanged(native) // Host context is still legacy.
    f.ctx.model = native
    if (change === 'usage')
      controller.contextFresh({
        model: native.id,
        provider: native.provider,
        stopReason: 'stop',
        usage: { input: 20, output: 1, cacheRead: 0, cacheWrite: 0 },
      })
    else controller.tick()
    assert.equal(old.cancelled, true)
    const current = checks().at(-1)
    assert.notEqual(current, old)
    const foreground = JSON.stringify({
      result: { process_info: { pane_id: env.HERDR_PANE_ID, foreground_processes: [{ pid: process.pid }] } },
    })
    for (const job of checks().slice(0, -1)) job.resolve(foreground)
    await flush()
    assert.equal(reports().length, 0, 'cancelled legacy PID callbacks must not submit reports')
    const count = checks().length
    controller.tick()
    assert.equal(checks().length, count, 'old finalizers must not release the current job')
    current.resolve(foreground)
    await flush()
    assert.equal(reports().length, 1)
    const report = reports()[0]
    assert.ok(report.args.includes('mahiro_sidebar_provider=openai'))
    assert.ok(!report.args.some((value: string) => /^mahiro_sidebar_q[12]_/.test(value)))
    report.resolve()
    await flush()
    f.advance(HEARTBEAT_MS)
    controller.tick()
    checks().at(-1).resolve(foreground)
    await flush()
    assert.equal(reports().length, 2)
    assert.ok(!reports()[1].args.some((value: string) => /^mahiro_sidebar_q[12]_/.test(value)))
    controller.dispose()
  }
})

test('failure retries without disrupting native status; Git failure is unknown', async () => {
  const f = fixture()
  f.jobs.forEach((job) => job.reject())
  await flush()
  assert.match(f.writes.at(-1)!, /git unknown/)
  f.controller.tick()
  assert.equal(f.jobs.filter((j) => j.command === 'herdr').length, 2)
  f.controller.toolStart('a', 'read\x1b\n')
  f.controller.toolStart('b', 'bash')
  assert.match(f.writes.at(-1)!, /tool read, bash/)
  f.controller.toolEnd('a')
  assert.match(f.writes.at(-1)!, /tool bash/)
  f.controller.settled()
  assert.match(f.writes.at(-1)!, /idle/)
  f.controller.dispose()
})

test('dispose/reload cancels producers, timers, and late callbacks; sequence belongs to process owner', async () => {
  const f = fixture()
  const replacement = start(f.ctx, f.options)
  assert.equal(f.stopped(), 1)
  assert.ok(f.jobs[0].cancelled && f.jobs[1].cancelled)
  const count = f.writes.length
  f.jobs[0].resolve('## main\0 M stale\0')
  f.jobs[1].resolve()
  await flush()
  assert.equal(f.writes.length, count)
  assert.equal(f.owner.seq, 102)
  f.controller.dispose() // Cannot clear the replacement status.
  assert.equal(f.writes.length, count)
  replacement.dispose()
  replacement.dispose()
  assert.equal(f.stopped(), 2)
  assert.equal(f.writes.at(-1), undefined)
  const after = f.writes.length
  f.jobs.slice(2).forEach((j) => j.resolve())
  await flush()
  replacement.tick()
  assert.equal(f.writes.length, after)
})

test('display-only argv never touches native lifecycle; factory subscribes before interactive footer setup', async () => {
  const args = metadataArgs('pane', ['', '', ''], 2)
  assert.equal(args.filter((value) => value === '--clear-token').length, 3)
  assert.ok(!args.some((value) => /quota|account|state-label|report-agent/.test(value)))
  const handlers = new Map<string, Function>()
  const commands = new Map<string, unknown>()
  extension({
    on: (name: string, handler: Function) => {
      handlers.set(name, handler)
    },
    registerCommand: (name: string, definition: unknown) => commands.set(name, definition),
  } as any)
  assert.ok(commands.has('mh-usage'))
  assert.ok(handlers.has('session_start'))
  handlers.get('session_shutdown')!({})
  const source = await readFile(new URL('../extensions/mahiro-status.ts', import.meta.url), 'utf8')
  const helper = await readFile(new URL('../lib/status.ts', import.meta.url), 'utf8')
  assert.match(source, /ctx\.ui\.setFooter\(/)
  assert.match(source, /ctx\.mode\s*!==\s*(['"])tui\1/)
  assert.doesNotMatch(source + helper, /report-agent|streamSimple\(|fetch\(/)
})

test('real bounded runner handles executable failure without shell interpretation', async () => {
  await assert.rejects(run('/nonexistent-mahiro-pi-test', ['; not a shell']).promise)
})

test('foreground owner gate blocks inherited child environments and malformed/unavailable identity', async () => {
  for (const info of [
    { pane_id: env.HERDR_PANE_ID, foreground_processes: [{ pid: 1 }] },
    { pane_id: 'another-pane', foreground_processes: [{ pid: 42 }] },
    { pane_id: env.HERDR_PANE_ID },
  ]) {
    const calls: string[][] = []
    const execute = (_command: string, args: string[]) => {
      calls.push(args)
      return { promise: Promise.resolve(JSON.stringify({ result: { process_info: info } })), cancel() {} }
    }
    await assert.rejects(publishMetadata(execute, env, metadataArgs(env.HERDR_PANE_ID, [], 1), 42).promise)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], ['pane', 'process-info', '--pane', env.HERDR_PANE_ID])
  }
})

test('foreground owner gate publishes only matching process and cancellation prevents late publication', async () => {
  let resolve!: (value: string) => void
  let cancelled = false
  const calls: string[][] = []
  const execute = (_command: string, args: string[]) => {
    calls.push(args)
    return {
      promise:
        calls.length === 1
          ? new Promise<string>((yes) => {
              resolve = yes
            })
          : Promise.resolve(''),
      cancel() {
        cancelled = true
      },
    }
  }
  const args = metadataArgs(env.HERDR_PANE_ID, ['M', 'P', ''], 1)
  const output = JSON.stringify({
    result: { process_info: { pane_id: env.HERDR_PANE_ID, foreground_processes: [{ pid: 42 }] } },
  })
  const job = publishMetadata(execute, env, args, 42)
  resolve(output)
  await job.promise
  assert.deepEqual(calls[1], args)
  calls.length = 0
  const late = publishMetadata(execute, env, args, 42)
  late.cancel()
  resolve(output)
  await assert.rejects(late.promise)
  assert.equal(cancelled, true)
  assert.equal(calls.length, 1)
})

test('non-TUI sessions run no Git or Herdr producers even with inherited pane identity', () => {
  const f = fixture({ env: {} })
  const ownerDispose = f.owner.dispose
  const before = f.jobs.length
  const controller = start({ ...f.ctx, mode: 'print' }, f.options)
  controller.tick()
  controller.contextFresh()
  assert.equal(f.jobs.length, before)
  controller.dispose()
  assert.equal(f.owner.dispose, ownerDispose)
  assert.equal(f.stopped(), 0)
  f.controller.dispose()
})

test('failed, aborted, zero-usage and wrong-model responses cannot revive old-model context', async () => {
  const f = fixture()
  f.ctx.getContextUsage = () => ({ percent: 37 })
  f.ctx.model = { id: 'm2', name: 'Model 2', provider: 'p2' }
  f.controller.modelChanged()
  f.jobs[1].resolve()
  await flush()
  f.controller.tick()
  f.jobs.at(-1).resolve()
  await flush()
  const before = f.jobs.length
  const usage = { input: 20, output: 1, cacheRead: 0, cacheWrite: 0 }
  for (const message of [
    { model: 'm2', provider: 'p2', stopReason: 'error', usage },
    { model: 'm2', provider: 'p2', stopReason: 'aborted', usage },
    {
      model: 'm2',
      provider: 'p2',
      stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    { model: 'm1', provider: 'p2', stopReason: 'stop', usage },
    { model: 'm2', provider: 'p1', stopReason: 'stop', usage },
    { model: 'm2', provider: 'p2', stopReason: 'stop', usage: { ...usage, input: NaN } },
  ])
    f.controller.contextFresh(message)
  assert.equal(f.jobs.length, before)
  f.controller.contextFresh({ model: 'm2', provider: 'p2', stopReason: 'stop', usage })
  assert.ok(f.jobs.at(-1).args.includes('mahiro_sidebar_context=ctx ▰▰▱▱▱▱ 37%'))
  f.controller.dispose()
})
