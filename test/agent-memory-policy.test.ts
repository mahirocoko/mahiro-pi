import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  lstatSync,
  linkSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MemoryEngineController, type OperationContext } from '../lib/agent-memory/engine/controller.ts'
import { engineEnvironment } from '../lib/agent-memory/engine/io.ts'
import {
  memoryPolicyStatus,
  reconcileMemoryPolicy,
  setMemoryAutomatic,
} from '../lib/agent-memory/engine/policy.ts'
import { parseConfig } from '../lib/agent-memory/engine/schema.ts'
import { createMemoryStore, type MemoryConfig } from '../lib/agent-memory/store.ts'
import { digest } from '../lib/continuity/records.ts'

function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-policy-'))
  const root = join(dir, 'memory'),
    home = join(dir, 'home')
  mkdirSync(home, { mode: 0o700 })
  const previous = { ...process.env }
  for (const key of Object.keys(process.env))
    if (/^(GIT_|PI_|MAHIRO_)/.test(key) || key === 'HOME' || key.includes('API_KEY')) delete process.env[key]
  Object.assign(process.env, {
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: dir,
  })
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n name = Synthetic Policy\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
    { mode: 0o600 },
  )
  const config: MemoryConfig = {
    version: 1,
    automatic: false,
    coreBytes: 8192,
    indexBytes: 2048,
    fileBytes: 262144,
    totalBytes: 8388608,
    projects: [{ id: 'synthetic', cwd: dir }],
  }
  createMemoryStore(root, () => {}, 'primary').initialize(config, '# Core\nSynthetic policy test.\n')
  const env = engineEnvironment(process.env)
  const engines: MemoryEngineController[] = []
  const controller = () => {
    const engine = new MemoryEngineController(root, env)
    engines.push(engine)
    return engine
  }
  const engine = controller()
  const current: OperationContext = { current: () => true }
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, env, encoding: 'utf8' }).trim()
  const path = join(root, 'config.json')
  const configHash = digest(JSON.stringify(config))
  return {
    dir,
    root,
    path,
    revision,
    configHash,
    engine,
    current,
    controller,
    env,
    automatic: () => JSON.parse(readFileSync(path, 'utf8')).automatic,
    async close() {
      for (const engine of engines) {
        const result = await engine.close()
        assert.equal(result.signal, null)
      }
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

// Pause only via the existing caller-owned branch barrier. No production selector,
// injected filesystem or caller-supplied drain boolean exists.
async function paused(
  f: ReturnType<typeof fixture>,
  boundary: number,
  reflection?: { trigger: 'off' | 'step-count' | 'compaction-event'; stepCount: number },
) {
  let calls = 0,
    allowed = true,
    holds = 0
  const abort = new AbortController()
  let reached!: () => void, resume!: () => void
  const ready = new Promise<void>((resolve) => {
    reached = resolve
  })
  const continuation = new Promise<void>((resolve) => {
    resume = resolve
  })
  const context: OperationContext = {
    signal: abort.signal,
    current: () => allowed,
    hold: () => {
      holds++
      return () => {
        holds--
      }
    },
    barrier: async () => {
      if (++calls === boundary) {
        reached()
        await continuation
      }
    },
  }
  const completion = setMemoryAutomatic(f.engine, context, f.revision, f.configHash, true, reflection).then(
    (value) => ({ value, error: undefined }),
    (error: Error) => ({ error, value: undefined }),
  )
  await ready
  const record = JSON.parse(readFileSync(join(f.root, '.lock/policy.json'), 'utf8'))
  return {
    completion,
    record,
    resume,
    abort,
    holds: () => holds,
    revoke: () => {
      allowed = false
    },
    retire: () => {
      allowed = false
      f.engine.retireAdmission()
    },
  }
}

for (const [name, boundary] of [
  ['acquired', 2],
  ['staged', 3],
  ['before rename', 4],
  ['after rename', 5],
] as const) {
  for (const mode of ['abort', 'revoke', 'retire'] as const) {
    test(`policy ${mode} ${name}: truthful observed outcome, real drain, fresh cleanup only`, async () => {
      const f = fixture()
      try {
        const p = await paused(f, boundary)
        assert.equal(p.holds(), 1)
        const actual = boundary === 5
        assert.equal(f.automatic(), actual)
        assert.equal((await memoryPolicyStatus(f.engine, f.current)).state, 'active/draining')
        await assert.rejects(
          reconcileMemoryPolicy(f.engine, f.current, p.record.identity.operation, p.record.identity.digest),
          /Actual drained policy executor/,
        )
        assert.equal(existsSync(join(f.root, '.lock/owner.json')), true)
        if (mode === 'abort') p.abort.abort()
        else if (mode === 'revoke') p.revoke()
        else p.retire()
        // Cancellation/retirement is NOT quiescence while the actual continuation is paused.
        assert.equal(p.holds(), 1)
        p.resume()
        const result = await p.completion
        assert.ok(result.error)
        assert.equal(p.holds(), 0, 'all started native work/close joined before lifetime releases')
        assert.equal(f.automatic(), actual, 'never replays or reverts policy')
        assert.equal(existsSync(join(f.root, '.lock/owner.json')), true)
        const fresh = mode === 'retire' ? f.controller() : f.engine
        const status = await memoryPolicyStatus(fresh, f.current)
        assert.equal(status.state, 'retained+recoverable')
        assert.ok('automatic' in status)
        assert.equal(status.automatic, actual)
        assert.equal(status.outcome, actual ? 'intended' : 'original')
        await assert.rejects(
          reconcileMemoryPolicy(
            fresh,
            { current: () => false },
            p.record.identity.operation,
            p.record.identity.digest,
          ),
          /Current parent authority/,
        )
        const before = readFileSync(f.path)
        const recovered = await reconcileMemoryPolicy(
          fresh,
          f.current,
          p.record.identity.operation,
          p.record.identity.digest,
        )
        assert.equal(recovered.configChanged, false)
        assert.deepEqual(readFileSync(f.path), before)
        assert.equal(existsSync(join(f.root, '.lock')), false)
        assert.equal((await memoryPolicyStatus(fresh, f.current)).state, 'idle')
      } finally {
        await f.close()
      }
    })
  }
}

test('normal on/off and authorized stale HEAD/config CAS remove only their owned lock', async () => {
  const f = fixture()
  try {
    const on = await setMemoryAutomatic(f.engine, f.current, f.revision, f.configHash, true)
    assert.equal(f.automatic(), true)
    assert.equal(existsSync(join(f.root, '.lock')), false)
    await setMemoryAutomatic(f.engine, f.current, f.revision, on.configHash, false)
    assert.equal(f.automatic(), false)
    await assert.rejects(
      setMemoryAutomatic(f.engine, f.current, 'a'.repeat(40), f.configHash, true),
      /CAS conflict/,
    )
    assert.equal(existsSync(join(f.root, '.lock')), false)
    await assert.rejects(
      setMemoryAutomatic(f.engine, f.current, f.revision, 'a'.repeat(64), true),
      /CAS conflict/,
    )
    assert.equal(existsSync(join(f.root, '.lock')), false)
  } finally {
    await f.close()
  }
})

for (const attack of [
  'inode',
  'nonce',
  'staging',
  'stage bytes',
  'symlink',
  'hardlink',
  'HEAD',
  'config',
  'missing evidence',
  'corrupt evidence',
] as const) {
  test(`policy recovery retains unknown on changed ${attack}, deletes no staging before owner verification`, async () => {
    const f = fixture()
    try {
      const p = await paused(f, 3)
      p.abort.abort()
      p.resume()
      assert.ok((await p.completion).error)
      const lock = join(f.root, '.lock'),
        stage = join(lock, 'config.next')
      const before = readFileSync(f.path)
      if (attack === 'inode') {
        renameSync(lock, join(f.root, '.old-lock'))
        mkdirSync(lock, { mode: 0o700 })
        for (const name of ['owner.json', 'policy.json', 'config.next'])
          writeFileSync(join(lock, name), readFileSync(join(f.root, '.old-lock', name)), { mode: 0o600 })
      } else if (attack === 'nonce') {
        const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'))
        writeFileSync(join(lock, 'owner.json'), JSON.stringify({ ...owner, nonce: randomUUID() }), {
          mode: 0o600,
        })
      } else if (attack === 'staging') {
        renameSync(stage, `${stage}.old`)
        writeFileSync(stage, readFileSync(`${stage}.old`), { mode: 0o600 })
      } else if (attack === 'stage bytes') writeFileSync(stage, '{}\n', { mode: 0o600 })
      else if (attack === 'symlink') {
        renameSync(stage, `${stage}.old`)
        symlinkSync(`${stage}.old`, stage)
      } else if (attack === 'hardlink') {
        renameSync(stage, `${stage}.old`)
        linkSync(`${stage}.old`, stage)
      } else if (attack === 'HEAD')
        execFileSync(
          'git',
          [
            '-c',
            'user.name=Synthetic',
            '-c',
            'user.email=fixture@example.invalid',
            'commit',
            '--allow-empty',
            '-m',
            'Synthetic external HEAD change',
          ],
          { cwd: f.root, env: f.env },
        )
      else if (attack === 'config') {
        const config = JSON.parse(readFileSync(f.path, 'utf8'))
        writeFileSync(f.path, JSON.stringify({ ...config, coreBytes: 4096 }), { mode: 0o600 })
      } else if (attack === 'missing evidence') rmSync(join(lock, 'policy.json'))
      else writeFileSync(join(lock, 'policy.json'), '{malformed', { mode: 0o600 })
      const stageIdentity = lstatSync(stage).ino
      assert.equal((await memoryPolicyStatus(f.engine, f.current)).state, 'unknown/unavailable')
      await assert.rejects(
        reconcileMemoryPolicy(f.engine, f.current, p.record.identity.operation, p.record.identity.digest),
      )
      assert.equal(lstatSync(stage).ino, stageIdentity, 'foreign/mismatched staging not removed')
      assert.equal(existsSync(join(lock, 'owner.json')), true)
      if (attack !== 'config') assert.deepEqual(readFileSync(f.path), before)
    } finally {
      await f.close()
    }
  })
}

test('fresh branch change/current target denial during recovery retains owned files', async () => {
  const f = fixture()
  try {
    const p = await paused(f, 3)
    p.abort.abort()
    p.resume()
    await p.completion
    let branch = true
    const context: OperationContext = {
      current: () => branch,
      barrier: async () => {
        branch = false
      },
    }
    await assert.rejects(
      reconcileMemoryPolicy(f.engine, context, p.record.identity.operation, p.record.identity.digest),
    )
    assert.equal(existsSync(join(f.root, '.lock/config.next')), true)
    const denyStage: OperationContext = {
      current: (targets) => !targets.physical.includes(join(f.root, '.lock/config.next')),
    }
    await assert.rejects(
      reconcileMemoryPolicy(f.engine, denyStage, p.record.identity.operation, p.record.identity.digest),
    )
    assert.equal(existsSync(join(f.root, '.lock/config.next')), true)
  } finally {
    await f.close()
  }
})

for (const change of ['HEAD', 'config'] as const) {
  test(`fresh policy reconciliation rechecks ${change} during cleanup before deleting staging`, async () => {
    const f = fixture()
    try {
      const p = await paused(f, 3)
      p.abort.abort()
      p.resume()
      await p.completion
      let calls = 0
      const context: OperationContext = {
        current: () => true,
        barrier: async () => {
          if (++calls !== 6) return
          if (change === 'HEAD')
            execFileSync(
              'git',
              [
                '-c',
                'user.name=Synthetic',
                '-c',
                'user.email=fixture@example.invalid',
                'commit',
                '--allow-empty',
                '-m',
                'Synthetic late HEAD change',
              ],
              { cwd: f.root, env: f.env },
            )
          else {
            const config = JSON.parse(readFileSync(f.path, 'utf8'))
            writeFileSync(f.path, JSON.stringify({ ...config, coreBytes: 4096 }), { mode: 0o600 })
          }
        },
      }
      await assert.rejects(
        reconcileMemoryPolicy(f.engine, context, p.record.identity.operation, p.record.identity.digest),
        /state changed during cleanup/,
      )
      assert.equal(existsSync(join(f.root, '.lock/config.next')), true)
      assert.equal(existsSync(join(f.root, '.lock/policy.json')), true)
      assert.equal(existsSync(join(f.root, '.lock/owner.json')), true)
    } finally {
      await f.close()
    }
  })
}

test('incomplete acquisition is unknown, never idle or PID-recoverable', async () => {
  const f = fixture()
  try {
    const context: OperationContext = { current: () => !existsSync(join(f.root, '.lock')) }
    await assert.rejects(setMemoryAutomatic(f.engine, context, f.revision, f.configHash, true))
    assert.equal(existsSync(join(f.root, '.lock')), true)
    assert.equal((await memoryPolicyStatus(f.engine, f.current)).state, 'unknown/unavailable')
    await assert.rejects(reconcileMemoryPolicy(f.engine, f.current, randomUUID(), 'a'.repeat(64)))
    assert.equal(existsSync(join(f.root, '.lock')), true)
  } finally {
    await f.close()
  }
})

test('restart has durable evidence but no actual ref; same-process source replacement retains actual drain', async () => {
  const f = fixture()
  try {
    const p = await paused(f, 3)
    p.abort.abort()
    p.resume()
    await p.completion
    const moduleURL = new URL('../lib/agent-memory/engine/policy.ts', import.meta.url).href
    const child = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `
      import { memoryPolicyStatus, reconcileMemoryPolicy } from ${JSON.stringify(moduleURL)};
      const root=${JSON.stringify(f.root)}, context={ current:()=>true }, engine={root};
      const status=await memoryPolicyStatus(engine,context);
      if(status.state!=='unknown/unavailable') throw Error('Restart falsely recovered');
      try { await reconcileMemoryPolicy(engine,context,${JSON.stringify(p.record.identity.operation)},${JSON.stringify(p.record.identity.digest)}); throw Error('Unexpected recovery') }
      catch(error) { if(!/executor unavailable/.test(error.message)) throw error }
      console.log('restart-unknown-retained');
    `,
      ],
      { env: f.env, encoding: 'utf8' },
    )
    assert.equal(child.status, 0, child.stderr)
    assert.match(child.stdout, /restart-unknown-retained/)
    assert.equal(existsSync(join(f.root, '.lock/config.next')), true)
    const replacement = await import(`${moduleURL}?replacement=${randomUUID()}`)
    assert.equal((await replacement.memoryPolicyStatus(f.engine, f.current)).state, 'retained+recoverable')
    await replacement.reconcileMemoryPolicy(
      f.engine,
      f.current,
      p.record.identity.operation,
      p.record.identity.digest,
    )
    assert.equal(existsSync(join(f.root, '.lock')), false)
  } finally {
    await f.close()
  }
})

test('version-1 policy stays automatic-only and version-2 selection uses exact CAS', async () => {
  const f = fixture()
  try {
    const on = await setMemoryAutomatic(f.engine, f.current, f.revision, f.configHash, true)
    const v1 = JSON.parse(readFileSync(f.path, 'utf8'))
    assert.equal(v1.version, 1)
    assert.equal(Object.hasOwn(v1, 'reflectionTrigger'), false)
    const selected = await setMemoryAutomatic(f.engine, f.current, f.revision, on.configHash, true, {
      trigger: 'compaction-event',
      stepCount: 25,
    })
    const v2 = JSON.parse(readFileSync(f.path, 'utf8'))
    assert.equal(v2.version, 2)
    assert.equal(v2.reflectionTrigger, 'compaction-event')
    assert.equal(v2.reflectionStepCount, 25)
    assert.equal(v2.automatic, true)
    await assert.rejects(
      setMemoryAutomatic(f.engine, f.current, f.revision, on.configHash, true, {
        trigger: 'step-count',
        stepCount: 1,
      }),
      /CAS conflict/,
    )
    assert.equal(JSON.parse(readFileSync(f.path, 'utf8')).reflectionTrigger, 'compaction-event')
    await assert.rejects(
      setMemoryAutomatic(f.engine, f.current, f.revision, selected.configHash, false, {
        trigger: 'compaction-event',
        stepCount: 25,
      }),
      /disagree/,
    )
    const off = await setMemoryAutomatic(f.engine, f.current, f.revision, selected.configHash, false)
    const stored = JSON.parse(readFileSync(f.path, 'utf8'))
    assert.equal(stored.version, 2)
    assert.equal(stored.automatic, false)
    assert.equal(stored.reflectionTrigger, 'off')
    assert.equal(stored.reflectionStepCount, 25)
    assert.equal(off.automatic, false)
    assert.throws(() =>
      parseConfig(JSON.stringify({ ...v1, reflectionTrigger: 'compaction-event', reflectionStepCount: 25 })),
    )
    const abort = new AbortController()
    abort.abort()
    await assert.rejects(
      setMemoryAutomatic(f.engine, { ...f.current, signal: abort.signal }, f.revision, off.configHash, true, {
        trigger: 'step-count',
        stepCount: 1,
      }),
      /abort|Current parent authority/,
    )
    assert.equal(existsSync(join(f.root, '.lock')), false)
    assert.equal(JSON.parse(readFileSync(f.path, 'utf8')).reflectionTrigger, 'off')
  } finally {
    await f.close()
  }
})

test('version-2 policy revoke after rename keeps the selected trigger and reconciles the owned lock', async () => {
  const f = fixture()
  try {
    const p = await paused(f, 5, { trigger: 'compaction-event', stepCount: 25 })
    assert.equal(p.record.version, 2)
    assert.equal(p.record.identity.reflectionTrigger, 'compaction-event')
    assert.equal(JSON.parse(readFileSync(f.path, 'utf8')).reflectionTrigger, 'compaction-event')
    p.revoke()
    p.resume()
    const result = await p.completion
    assert.ok(result.error)
    const fresh = f.engine
    const status = await memoryPolicyStatus(fresh, f.current)
    assert.equal(status.state, 'retained+recoverable')
    assert.equal(status.outcome, 'intended')
    const recovered = await reconcileMemoryPolicy(
      fresh,
      f.current,
      p.record.identity.operation,
      p.record.identity.digest,
    )
    assert.equal(recovered.configChanged, false)
    const stored = JSON.parse(readFileSync(f.path, 'utf8'))
    assert.equal(stored.version, 2)
    assert.equal(stored.reflectionTrigger, 'compaction-event')
    assert.equal(stored.automatic, true)
    assert.equal(existsSync(join(f.root, '.lock')), false)
  } finally {
    await f.close()
  }
})
