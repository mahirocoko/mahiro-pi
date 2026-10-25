import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, realpath, writeFile, chmod, rm, mkdir, symlink } from 'node:fs/promises'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexAuthPath, codexCliSource, codexReadAllowed } from '../lib/codex-cli-quota.ts'
import { quotaController, SUCCESS_TTL, STALE_BOUND } from '../lib/quota.ts'
import { initUsage, usageDetails } from '../lib/usage.ts'
import type { ExternalQuotaAuth } from '../lib/codex-cli-quota.ts'

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r))
}
const payload = { rate_limit: { primary_window: { used_percent: 38, limit_window_seconds: 18000 } } }
const fakeAuth = (token = 'FAKE-token', accountId = 'FAKE-account'): ExternalQuotaAuth => ({
  token,
  accountId,
  check: async () => {},
})
function fixture() {
  let clock = 1_800_000_000_000,
    native = 0,
    reads = 0,
    requests = 0
  let auth: () => Promise<ExternalQuotaAuth> = async () => fakeAuth()
  let fetcher: typeof fetch = async () => new Response(JSON.stringify(payload))
  const ctx: any = {
    mode: 'tui',
    hasUI: true,
    cwd: '/fake/project',
    model: { provider: 'openai', id: 'fake' },
    sessionManager: {
      getSessionId: () => 'fake-session',
      getBranch: () => [],
      getEntries: () => [],
      getHeader: () => ({}),
    },
    modelRegistry: {
      isUsingOAuth: () => true,
      getProviderAuthStatus: () => ({ configured: true }),
      getProvider: () => ({ auth: { oauth: { isSubscription: true } } }),
      getApiKeyAndHeaders: async () => {
        native++
        throw Error('no native credentials')
      },
    },
    getContextUsage: () => undefined,
    ui: { setWidget() {} },
  }
  const controller = quotaController(ctx, () => {}, {
    now: () => clock,
    external: {
      read: async () => {
        reads++
        return auth()
      },
    },
    fetch: async (url, init) => {
      requests++
      return fetcher(url, init)
    },
  })
  return {
    ctx,
    controller,
    counts: () => ({ native, reads, requests }),
    advance: (ms: number) => {
      clock += ms
    },
    auth: (next: typeof auth) => {
      auth = next
    },
    fetch: (next: typeof fetcher) => {
      fetcher = next
    },
  }
}

test('external defaults off, native direct stays credential-free; explicit source has fixed request/headers and cache-only labels', async () => {
  const f = fixture()
  try {
    f.controller.tick()
    await flush()
    assert.deepEqual(f.counts(), { native: 0, reads: 0, requests: 0 })
    f.fetch(async (url, init) => {
      assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage')
      assert.equal(init?.redirect, 'error')
      assert.deepEqual(init?.headers, {
        Authorization: 'Bearer FAKE-token',
        'ChatGPT-Account-Id': 'FAKE-account',
        Accept: 'application/json',
      })
      return new Response(JSON.stringify(payload))
    })
    f.controller.selectSource('codex-cli')
    assert.deepEqual(f.counts(), { native: 0, reads: 0, requests: 0 })
    f.controller.tick()
    await flush()
    assert.deepEqual(f.counts(), { native: 0, reads: 1, requests: 1 })
    assert.equal(f.controller.snapshot().windows[0].remaining, 62)
    assert.deepEqual(f.controller.view().tokens, {})
    assert.match(f.controller.view().segments[0].text, /Codex CLI/)
    assert.match(f.controller.view().footerSegments[0].text, /^Codex 5h ▰/)
    for (const segments of [
      f.controller.view().segments,
      f.controller.view().footerSegments,
      f.controller.view().footerCompact,
    ]) {
      assert.match(segments[0].text, /^Codex /)
      assert.doesNotMatch(segments[0].text, /external account|may differ from Pi/)
    }
    const details = usageDetails(f.ctx, f.controller.snapshot(), { quota: true, style: 'bar' }).join('\n')
    assert.match(details, /Quota source: Codex CLI\n/)
    assert.doesNotMatch(details, /external account|may differ from Pi/)
    assert.doesNotMatch(details, /FAKE-token|FAKE-account/)
    for (let i = 0; i < 10; i++) {
      f.controller.tick()
      f.controller.view()
      f.controller.snapshot()
    }
    await flush()
    assert.equal(f.counts().reads, 1)
    f.advance(SUCCESS_TTL)
    f.controller.tick()
    await flush()
    assert.equal(f.counts().reads, 2)
    f.controller.selectSource('pi')
    f.controller.tick()
    await flush()
    assert.equal(f.counts().native, 0)
    assert.equal(f.controller.snapshot().windows.length, 0)
  } finally {
    f.controller.dispose()
  }
})

test('external read failures back off, denied credentials stay denied until identity changes or explicit reset', async () => {
  const f = fixture()
  try {
    f.controller.selectSource('codex-cli')
    f.auth(async () => {
      throw Error('private path token metadata must not escape')
    })
    f.controller.tick()
    await flush()
    for (let i = 0; i < 20; i++) f.controller.tick()
    assert.equal(f.counts().reads, 1)
    assert.doesNotMatch(JSON.stringify(f.controller.snapshot()), /private path|metadata/)
    f.advance(30_000)
    f.auth(async () => fakeAuth())
    f.fetch(async () => new Response('', { status: 401 }))
    f.controller.tick()
    await flush()
    assert.match(f.controller.snapshot().state, /sign-in denied/)
    f.advance(30_000)
    f.controller.tick()
    await flush()
    assert.equal(f.counts().requests, 1)
    f.advance(SUCCESS_TTL)
    f.auth(async () => fakeAuth('FAKE-replacement', 'FAKE-new-account'))
    f.fetch(async () => new Response(JSON.stringify(payload)))
    f.controller.tick()
    await flush()
    assert.equal(f.counts().requests, 2)
    assert.equal(f.controller.snapshot().windows.length, 1)
    f.advance(STALE_BOUND + 1)
    assert.equal(f.controller.snapshot().windows.length, 0)
  } finally {
    f.controller.dispose()
  }
})

test('late auth, cancellation, source/model changes and disposal cannot publish or release a replacement owner', async () => {
  const f = fixture()
  let release!: (auth: ExternalQuotaAuth) => void
  try {
    f.auth(
      () =>
        new Promise((r) => {
          release = r
        }),
    )
    f.controller.selectSource('codex-cli')
    f.controller.tick()
    await flush()
    f.controller.setEnabled(false)
    f.auth(async () => fakeAuth('FAKE-replacement'))
    f.controller.setEnabled(true)
    f.controller.tick()
    await flush()
    assert.equal(f.counts().requests, 1)
    release(fakeAuth('FAKE-old'))
    await flush()
    assert.equal(f.counts().requests, 1)
    f.controller.invalidate()
    f.controller.tick()
    await flush()
    f.controller.selectSource('pi')
    f.controller.tick()
    await flush()
    assert.equal(f.counts().native, 0)
    f.controller.selectSource('codex-cli')
    f.auth(
      () =>
        new Promise((r) => {
          release = r
        }),
    )
    f.controller.tick()
    await flush()
    f.ctx.model = { provider: 'openai', id: 'different' }
    release(fakeAuth())
    await flush()
    assert.equal(f.counts().requests, 2)
    f.controller.dispose()
    f.controller.tick()
  } finally {
    f.controller.dispose()
  }
})

test('bounded responses, revoked authority and late fetch cannot publish external snapshots', async () => {
  const f = fixture()
  try {
    f.controller.selectSource('codex-cli')
    let allowed = true
    f.auth(async () => ({
      ...fakeAuth(),
      check: async () => {
        if (!allowed) throw Error('revoked')
      },
    }))
    f.fetch(async () => {
      allowed = false
      return new Response(JSON.stringify(payload))
    })
    f.controller.tick()
    await flush()
    assert.equal(f.controller.snapshot().windows.length, 0)
    f.advance(30_000)
    allowed = true
    f.fetch(async () => new Response(' '.repeat(262145)))
    f.controller.tick()
    await flush()
    assert.equal(f.controller.snapshot().windows.length, 0)
    f.advance(60_000)
    let release!: (response: Response) => void
    f.fetch(
      () =>
        new Promise((r) => {
          release = r
        }),
    )
    f.controller.tick()
    await flush()
    f.controller.setEnabled(false)
    release(new Response(JSON.stringify(payload)))
    await flush()
    assert.equal(f.controller.snapshot().windows.length, 0)
    assert.equal(f.controller.snapshot().state, 'off')
  } finally {
    f.controller.dispose()
  }
})

test('five-second timeout backs off external auth and late resolution cannot start HTTP', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  let release!: (auth: ExternalQuotaAuth) => void
  try {
    f.auth(
      () =>
        new Promise((r) => {
          release = r
        }),
    )
    f.controller.selectSource('codex-cli')
    f.controller.tick()
    await flush()
    t.mock.timers.tick(5000)
    await flush()
    release(fakeAuth())
    await flush()
    f.controller.tick()
    await flush()
    assert.deepEqual(f.counts(), { native: 0, reads: 1, requests: 0 })
  } finally {
    f.controller.dispose()
    t.mock.timers.reset()
  }
})

test('PSS effective ordinary read and external grants, recorded standing allow, matched restrictions; unmatched fallback is skipped', () => {
  const path = '/fake/codex/auth.json',
    cwd = '/fake/project'
  const service = (overrides: Record<string, any> = {}) => ({
    checkPermission: (surface: string) => overrides[surface] ?? { state: 'allow', origin: 'config' },
  })
  assert.equal(codexReadAllowed(undefined, path, cwd), false)
  assert.equal(codexReadAllowed(service(), path, cwd), true)
  for (const surface of ['read', 'external_directory_read', 'path_read']) {
    assert.equal(
      codexReadAllowed(
        service({ [surface]: { state: 'allow', origin: 'yolo', matchedPattern: '/fake/**' } }),
        path,
        cwd,
      ),
      true,
    )
  }
  for (const surface of ['read', 'external_directory_read'])
    for (const decision of [
      { state: 'deny' },
      { state: 'ask' },
      { state: 'deny', origin: 'yolo' },
      { state: 'ask', origin: 'yolo' },
    ])
      assert.equal(codexReadAllowed(service({ [surface]: decision }), path, cwd), false)
  for (const state of ['deny', 'ask']) {
    assert.equal(codexReadAllowed(service({ path_read: { state } }), path, cwd), true)
    assert.equal(
      codexReadAllowed(service({ path_read: { state, matchedPattern: '/fake/**' } }), path, cwd),
      false,
    )
  }
  assert.equal(codexReadAllowed(service({ external_directory_read: { state: 'deny' } }), path, '/fake'), true)
})

test('fixed CLI path rejects relative/controls; reader uses bounded private regular fake files only', async () => {
  assert.equal(codexAuthPath(undefined, '/fake/home'), '/fake/home/.codex/auth.json')
  assert.equal(codexAuthPath('/fake/codex'), '/fake/codex/auth.json')
  for (const home of ['relative', '/fake/../codex', '/fake/\nsecret'])
    assert.throws(() => codexAuthPath(home), /unavailable/)
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'mahiro-fake-codex-')))
  const path = join(dir, 'auth.json')
  let checks = 0
  const source = codexCliSource({ sessionManager: { getSessionId: () => 'fake' } } as any, {
    path: () => path,
    authorize: async () => async () => {
      checks++
    },
    descriptor: { platform: 'linux', readlink: async () => path },
  })
  const read = () => source.read(new AbortController().signal, () => true)
  const put = async (value: string) => {
    await writeFile(path, value, { mode: 0o600 })
    await chmod(path, 0o600)
  }
  try {
    await put(JSON.stringify({ tokens: { access_token: 'FAKE-bearer', account_id: 'FAKE-account' } }))
    const auth = await read()
    assert.equal(auth.token, 'FAKE-bearer')
    assert.ok(checks > 2)
    for (const data of [
      '{',
      '{}',
      JSON.stringify({ OPENAI_API_KEY: 'FAKE-api-key' }),
      JSON.stringify({ auth_mode: 'apikey', tokens: { access_token: 'FAKE-unsupported-mode' } }),
      JSON.stringify({ tokens: { access_token: 'FAKE', account_id: 'bad\u202e' } }),
      JSON.stringify({ tokens: { id_token: 'FAKE-id', refresh_token: 'FAKE-refresh' } }),
      JSON.stringify({ tokens: { access_token: 'FAKE\ncontrol' } }),
      JSON.stringify({ tokens: { access_token: 'FAKE', account_id: 'bad\u007f' } }),
      ' '.repeat(65537),
    ]) {
      await put(data)
      await assert.rejects(read(), /^Error: Codex CLI unavailable$/)
    }
    await put(JSON.stringify({ tokens: { access_token: 'FAKE' } }))
    await chmod(path, 0o644)
    await assert.rejects(read(), /unavailable/)
    await rm(path)
    await mkdir(path)
    await assert.rejects(read(), /unavailable/)
    await rm(path, { recursive: true })
    const target = join(dir, 'fake-target')
    await writeFile(target, '{}', { mode: 0o600 })
    await symlink(target, path)
    await assert.rejects(read(), /unavailable/)
    let touched = false
    const blocked = codexCliSource({ sessionManager: { getSessionId: () => 'fake' } } as any, {
      path: () => {
        touched = true
        return '/nonexistent/fake/auth.json'
      },
      authorize: async () => {
        throw Error('denied')
      },
    })
    await assert.rejects(
      blocked.read(new AbortController().signal, () => true),
      /unavailable/,
    )
    assert.equal(touched, true)
    const unguarded = codexCliSource(
      { mode: 'tui', hasUI: true, cwd: dir, sessionManager: { getSessionId: () => 'fake-no-root' } } as any,
      { path: () => path },
    )
    await assert.rejects(
      unguarded.read(new AbortController().signal, () => true),
      /^Error: Codex CLI unavailable$/,
    )
    const aborted = new AbortController()
    aborted.abort()
    await assert.rejects(
      source.read(aborted.signal, () => true),
      /unavailable/,
    )
    await assert.rejects(
      source.read(new AbortController().signal, () => false),
      /unavailable/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('fake ordinary recorded PSS allow reads; explicit deny/ask/missing service stop before filesystem calls', async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'mahiro-fake-policy-')))
  const path = join(dir, 'auth.json')
  await writeFile(path, JSON.stringify({ tokens: { access_token: 'FAKE-policy-token' } }), { mode: 0o600 })
  let filesystemCalls = 0
  const originalLstat = fsPromises.lstat,
    originalOpen = fsPromises.open
  t.mock.method(fsPromises, 'lstat', (...args: Parameters<typeof fsPromises.lstat>) => {
    filesystemCalls++
    return originalLstat(...args)
  })
  t.mock.method(fsPromises, 'open', (...args: Parameters<typeof fsPromises.open>) => {
    filesystemCalls++
    return originalOpen(...args)
  })
  syncBuiltinESMExports()
  let state = 'allow',
    missing = false,
    blockedSurface = 'read'
  const service = {
    checkPermission: (surface: string) => ({
      state: surface === blockedSurface ? state : 'allow',
      origin: 'yolo',
      matchedPattern: surface === 'path_read' ? '/fake/**' : undefined,
    }),
  }
  const source = codexCliSource({ sessionManager: { getSessionId: () => 'fake' } } as any, {
    path: () => path,
    authorize: async () => {
      const check = async () => {
        if (!codexReadAllowed(missing ? undefined : service, path, '/fake/project')) throw Error('blocked')
      }
      await check()
      return check
    },
    descriptor: { platform: 'linux', readlink: async () => path },
  })
  const read = () => source.read(new AbortController().signal, () => true)
  try {
    assert.equal((await read()).token, 'FAKE-policy-token')
    assert.ok(filesystemCalls > 0)
    for (const surface of ['read', 'path_read', 'external_directory_read']) {
      blockedSurface = surface
      for (const decision of ['deny', 'ask']) {
        state = decision
        const before = filesystemCalls
        await assert.rejects(read(), /^Error: Codex CLI unavailable$/)
        assert.equal(filesystemCalls, before)
      }
    }
    missing = true
    state = 'allow'
    const before = filesystemCalls
    await assert.rejects(read(), /unavailable/)
    assert.equal(filesystemCalls, before)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    await rm(dir, { recursive: true, force: true })
  }
})

test('descriptor inspection is fail-closed before first content read and always closes the retained fd', async (t) => {
  const path = '/fake/private/auth.json'
  const fd = 47
  const record = `p${process.pid}\0\nf${fd}\0n${path}\0\n`
  const scenarios = [
    'correct',
    'mismatch',
    'wrong-pid',
    'wrong-fd',
    'duplicate-process',
    'duplicate-file',
    'duplicate-name',
    'decorated',
    'malformed',
    'truncated',
    'empty',
    'extra-field',
    'invalid-utf8',
    'timeout',
    'stdout-overflow',
    'stderr-overflow',
    'stderr',
    'exit',
    'signal',
    'error',
    'cancel',
    'revoked',
    'stale',
    'unsupported',
    'linux-correct',
    'linux-mismatch',
    'linux-deleted',
    'linux-error',
  ]
  for (const scenario of scenarios)
    await t.test(scenario, async (t) => {
      let reads = 0,
        closes = 0,
        kills = 0,
        allowed = true,
        current = true
      const controller = new AbortController()
      const content = Buffer.from(JSON.stringify({ tokens: { access_token: 'FAKE-descriptor' } }))
      t.mock.method(fsPromises, 'lstat', async () => ({
        isDirectory: () => true,
        isSymbolicLink: () => false,
        uid: process.getuid?.(),
        mode: 0o700,
      }))
      t.mock.method(fsPromises, 'open', async () => ({
        fd,
        stat: async () => ({
          isFile: () => true,
          uid: process.getuid?.(),
          mode: 0o600,
          size: content.length,
        }),
        read: async (buffer: Buffer, offset: number) => {
          reads++
          if (reads > 1) return { bytesRead: 0 }
          content.copy(buffer, offset)
          return { bytesRead: content.length }
        },
        close: async () => {
          closes++
        },
      }))
      syncBuiltinESMExports()
      const fakeSpawn = ((executable: string, args: readonly string[], options: SpawnOptions) => {
        assert.equal(executable, '/usr/sbin/lsof')
        assert.deepEqual(args, ['-nP', '-a', '-p', String(process.pid), '-d', String(fd), '-F0fn'])
        assert.deepEqual(options, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
        const child = Object.assign(new EventEmitter(), {
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          kill: (signal: string) => {
            assert.equal(signal, 'SIGKILL')
            kills++
            return true
          },
        })
        queueMicrotask(() => {
          if (scenario === 'timeout') return
          if (scenario === 'cancel') controller.abort()
          if (scenario === 'revoked') allowed = false
          if (scenario === 'stale') current = false
          if (scenario === 'error') {
            child.emit('error', Error('PRIVATE metadata'))
            return
          }
          const outputs: Record<string, string | Buffer> = {
            mismatch: record.replace(path, '/fake/other/auth.json'),
            'wrong-pid': record.replace(`p${process.pid}`, `p${process.pid + 1}`),
            'wrong-fd': record.replace(`f${fd}`, `f${fd + 1}`),
            'duplicate-process': record + record,
            'duplicate-file': record + `f${fd}\0n${path}\0\n`,
            'duplicate-name': record.replace(`${path}\0`, `${path}\0n${path}\0`),
            decorated: record.replace(path, `${path} (deleted)`),
            malformed: record.replaceAll('\0', '\n'),
            truncated: record.slice(0, -1),
            empty: '',
            'extra-field': record.replace(`f${fd}\0`, `f${fd}\0aR\0`),
            'invalid-utf8': Buffer.concat([Buffer.from(record.slice(0, -2)), Buffer.from([255, 0, 10])]),
            'stdout-overflow': 'x'.repeat(16385),
          }
          child.stdout.write(outputs[scenario] ?? record)
          if (scenario.startsWith('stderr'))
            child.stderr.write('x'.repeat(scenario === 'stderr-overflow' ? 16385 : 1))
          child.emit('close', scenario === 'exit' ? 1 : 0, scenario === 'signal' ? 'SIGTERM' : null)
        })
        return child
      }) as unknown as typeof spawn
      if (scenario === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] })
      const source = codexCliSource({ sessionManager: { getSessionId: () => 'fake' } } as any, {
        path: () => path,
        authorize: async () => async () => {
          if (!allowed) throw Error('PRIVATE policy')
        },
        descriptor: {
          platform: scenario === 'unsupported' ? 'other' : scenario.startsWith('linux-') ? 'linux' : 'darwin',
          spawn: fakeSpawn,
          readlink: async (operand) => {
            assert.equal(operand, `/proc/self/fd/${fd}`)
            if (scenario === 'linux-error') throw Error('PRIVATE metadata')
            return scenario === 'linux-mismatch'
              ? '/fake/other/auth.json'
              : scenario === 'linux-deleted'
                ? `${path} (deleted)`
                : path
          },
        },
      })
      try {
        const result = source.read(controller.signal, () => current)
        const success = scenario === 'correct' || scenario === 'linux-correct'
        const outcome = success
          ? result.then((auth) => assert.equal(auth.token, 'FAKE-descriptor'))
          : assert.rejects(result, /^Error: Codex CLI unavailable$/)
        if (scenario === 'timeout') {
          await flush()
          t.mock.timers.tick(1500)
        }
        await outcome
        assert.equal(reads, success ? 2 : 0)
        assert.equal(closes, 1)
        if (['timeout', 'stdout-overflow', 'stderr-overflow', 'cancel', 'error'].includes(scenario))
          assert.equal(kills, 1)
      } finally {
        t.mock.restoreAll()
        syncBuiltinESMExports()
        if (scenario === 'timeout') t.mock.timers.reset()
      }
    })
})

test('fixed macOS lsof resolves only the current test Node retained nonsecret tempfile descriptor', {
  skip: process.platform !== 'darwin',
}, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'mahiro-fd-metadata-')))
  const path = join(dir, 'nonsecret-fixture')
  let inspections = 0
  try {
    await writeFile(path, JSON.stringify({ tokens: { access_token: 'FAKE-nonsecret' } }), { mode: 0o600 })
    const source = codexCliSource({ sessionManager: { getSessionId: () => 'fake' } } as any, {
      path: () => path,
      authorize: async () => async () => {},
      descriptor: {
        spawn: ((executable, args, options) => {
          inspections++
          assert.equal(executable, '/usr/sbin/lsof')
          assert.equal(args?.[3], String(process.pid))
          assert.deepEqual(args?.slice(0, 3), ['-nP', '-a', '-p'])
          assert.equal(args?.[4], '-d')
          assert.match(String(args?.[5]), /^\d+$/)
          assert.equal(args?.[6], '-F0fn')
          return spawn(executable, args!, options!)
        }) as typeof spawn,
      },
    })
    assert.equal((await source.read(new AbortController().signal, () => true)).token, 'FAKE-nonsecret')
    assert.equal(inspections, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('commands select explicitly and cache-only; off/on, tree and shutdown never initiate IO', async () => {
  const f = fixture(),
    events = new Map<string, Function[]>()
  const pi: any = {
    registerCommand() {},
    on(name: string, handler: Function) {
      events.set(name, [...(events.get(name) ?? []), handler])
      return () => {}
    },
  }
  const usage = initUsage(pi)
  usage.attach(f.ctx, f.controller, () => {}, {
    visibleWidth: (s: string) => s.length,
    truncateToWidth: (s: string, w: number) => s.slice(0, w),
  })
  try {
    await usage.handler('codex on', f.ctx)
    assert.equal(f.controller.snapshot().source, 'unsupported')
    await usage.handler('source codex-cli', f.ctx)
    assert.equal(f.controller.snapshot().source, 'codex-cli')
    assert.equal(usage.display().quota, true)
    await usage.handler('codex off', f.ctx)
    assert.equal(f.controller.snapshot().state, 'off')
    await usage.handler('codex on', f.ctx)
    assert.equal(f.controller.snapshot().state, 'off', 'profile on requires the separate Root save owner')
    await usage.handler('source codex-cli', f.ctx)
    assert.notEqual(f.controller.snapshot().state, 'off', 'advanced runtime source selection stays supported')
    for (const event of ['session_before_tree', 'session_tree', 'session_shutdown'])
      for (const handler of events.get(event) ?? []) await handler({}, f.ctx)
    assert.deepEqual(f.counts(), { native: 0, reads: 0, requests: 0 })
  } finally {
    usage.dispose()
    f.controller.dispose()
  }
})
