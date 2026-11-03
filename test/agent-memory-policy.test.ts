import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  chmodSync,
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

test('lock observation distinguishes absent, malformed directory, file and symlink without recovery', async () => {
  const f = fixture()
  const lock = join(f.root, '.lock')
  try {
    const absent = await memoryPolicyStatus(f.engine, f.current)
    assert.equal(absent.lockObservation, 'absent')
    assert.equal('lockShape' in absent, false)
    assert.equal(absent.state, 'idle')
    assert.equal(absent.lockRetained, false)
    for (const kind of ['directory', 'file', 'symlink'] as const) {
      if (kind === 'directory') {
        mkdirSync(lock, { mode: 0o700 })
        writeFileSync(join(lock, 'policy.json'), 'malformed', { mode: 0o600 })
      } else if (kind === 'file') writeFileSync(lock, 'untouched', { mode: 0o600 })
      else symlinkSync(f.path, lock)
      const before = lstatSync(lock)
      const status = await memoryPolicyStatus(f.engine, f.current)
      assert.equal(status.lockObservation, kind === 'directory' ? 'directory-present' : 'other-entry-present')
      assert.equal(status.state, 'unknown/unavailable')
      assert.equal(status.lockRetained, true)
      if (kind === 'directory') assert.equal(status.lockShape, 'other')
      else assert.equal('lockShape' in status, false)
      await assert.rejects(reconcileMemoryPolicy(f.engine, f.current, randomUUID(), 'a'.repeat(64)))
      assert.equal(lstatSync(lock).ino, before.ino)
      if (kind === 'directory') assert.equal(readFileSync(join(lock, 'policy.json'), 'utf8'), 'malformed')
      else if (kind === 'file') assert.equal(readFileSync(lock, 'utf8'), 'untouched')
      assert.equal(f.automatic(), false)
      rmSync(lock, { recursive: true, force: true })
    }
  } finally {
    await f.close()
  }
})

test('owner comparison uses full pending UUID and digest, without granting recovery', async () => {
  const f = fixture()
  const lock = join(f.root, '.lock')
  const operation = randomUUID()
  const owner = { version: 1, operation, digest: 'a'.repeat(64), nonce: randomUUID(), directory: '1:2' }
  try {
    mkdirSync(lock, { mode: 0o700 })
    writeFileSync(join(lock, 'owner.json'), JSON.stringify(owner), { mode: 0o600 })
    for (const [pending, expected] of [
      [[{ id: operation, digest: owner.digest }], 'match'],
      [[{ id: operation, digest: 'b'.repeat(64) }], 'mismatch'],
      [[{ id: randomUUID(), digest: owner.digest }], 'mismatch'],
      [[], 'mismatch'],
    ] as const) {
      const status = await memoryPolicyStatus(f.engine, f.current, pending)
      assert.equal(status.lockOwnerPendingComparison, expected)
      assert.equal(status.lockShape, 'owner-only')
      // No policy journal/executor exists even when the comparison matches.
      assert.equal(status.state, 'unknown/unavailable')
      assert.equal(status.next, 'explicit-owner-review-no-lock-stealing')
      assert.equal(status.lockRetained, true)
      for (const secret of [owner.nonce, owner.directory, f.root, 'owner.json'])
        assert.equal(JSON.stringify(status).includes(secret), false)
    }
    for (const raw of ['{', JSON.stringify({ ...owner, nonce: 'invalid' }), 'x'.repeat(2049)]) {
      writeFileSync(join(lock, 'owner.json'), raw, { mode: 0o600 })
      assert.equal(
        (await memoryPolicyStatus(f.engine, f.current, [])).lockOwnerPendingComparison,
        'unavailable',
      )
    }
    rmSync(join(lock, 'owner.json'))
    assert.equal(
      (await memoryPolicyStatus(f.engine, f.current, [])).lockOwnerPendingComparison,
      'unavailable',
    )
  } finally {
    await f.close()
  }
})

for (const denial of ['exact', 'revoke', 'fallback'] as const) {
  test(`owner comparison retains exact target authority (${denial})`, async () => {
    const f = fixture()
    const lock = join(f.root, '.lock')
    const ownerPath = join(lock, 'owner.json')
    let reads = 0
    let fallback = false
    try {
      mkdirSync(lock, { mode: 0o700 })
      // Keep owner absent so the shape scan cannot supply its target binding.
      const context: OperationContext = {
        current: (targets) => {
          if (targets.physical.includes(join(lock, 'policy.json'))) fallback = true
          if (targets.physical.includes(ownerPath) && targets.physical.includes(f.root)) {
            assert.equal(targets.physical.includes(lock), true)
            reads++
            return denial === 'exact' ? false : denial === 'revoke' ? reads < 5 : !fallback
          }
          return true
        },
      }
      await assert.rejects(memoryPolicyStatus(f.engine, context, []), /authority required/)
      assert.ok(reads > 0)
      if (denial === 'fallback') assert.equal(fallback, true)
    } finally {
      await f.close()
    }
  })
}

test('bounded lock shape is name-only, read-only and never recovery evidence', async () => {
  const f = fixture()
  const lock = join(f.root, '.lock')
  try {
    mkdirSync(lock, { mode: 0o700 })
    for (const shape of ['empty', 'owner-only', 'other'] as const) {
      if (shape === 'owner-only') symlinkSync(f.path, join(lock, 'owner.json'))
      if (shape === 'other') {
        for (let i = 0; i < 5; i++) writeFileSync(join(lock, `extra-${i}`), 'not read', { mode: 0o600 })
      }
      const before = lstatSync(lock)
      const status = await memoryPolicyStatus(f.engine, f.current)
      assert.equal(status.lockObservation, 'directory-present')
      assert.equal(status.lockShape, shape)
      assert.equal(status.state, 'unknown/unavailable')
      assert.equal(status.lockRetained, true)
      assert.equal(status.next, 'explicit-owner-review-no-lock-stealing')
      assert.equal(lstatSync(lock).ino, before.ino)
      assert.equal(lstatSync(lock).mtimeMs, before.mtimeMs)
      assert.equal(JSON.stringify(status).includes('owner.json'), false)
      assert.equal(JSON.stringify(status).includes(f.root), false)
      await assert.rejects(reconcileMemoryPolicy(f.engine, f.current, randomUUID(), 'a'.repeat(64)))
    }
  } finally {
    await f.close()
  }
})

for (const name of ['owner.json', 'nonowner']) {
  for (const denial of ['exact', 'late-scan', 'late-status'] as const) {
    test(`shape cannot expose an exact denied ${name} child (${denial})`, async () => {
      const f = fixture()
      const lock = join(f.root, '.lock')
      const child = join(lock, name)
      let childChecks = 0
      let evidenceSeen = false
      try {
        mkdirSync(lock, { mode: 0o700 })
        writeFileSync(child, 'not read by shape', { mode: 0o600 })
        const context: OperationContext = {
          current: (targets) => {
            if (targets.physical.includes(join(lock, 'policy.json'))) evidenceSeen = true
            // Match shape/status fences rather than the pre-existing evidence read's
            // independent targets. Denying only a child must still block the fallback.
            if (targets.physical.includes(f.root) && targets.physical.includes(child)) {
              childChecks++
              assert.equal(targets.physical.includes(lock), true)
              return denial === 'exact' ? false : denial === 'late-scan' ? childChecks < 3 : !evidenceSeen
            }
            return true
          },
        }
        await assert.rejects(memoryPolicyStatus(f.engine, context), /authority required/)
        assert.ok(childChecks > 0)
        if (denial === 'late-status') assert.equal(evidenceSeen, true)
        assert.equal(readFileSync(child, 'utf8'), 'not read by shape')
      } finally {
        await f.close()
      }
    })
  }
}

test('both discovered child targets remain bound through the status fallback', async () => {
  const f = fixture()
  const lock = join(f.root, '.lock')
  const children = [join(lock, 'owner.json'), join(lock, 'extra')]
  let bothSeen = false
  let finalTargets: string[] = []
  try {
    mkdirSync(lock, { mode: 0o700 })
    for (const child of children) writeFileSync(child, 'not read by shape', { mode: 0o600 })
    const context: OperationContext = {
      current: (targets) => {
        if (targets.physical.includes(f.root) && targets.physical.includes(lock)) {
          finalTargets = targets.physical
          if (children.every((child) => targets.physical.includes(child))) bothSeen = true
          if (bothSeen) assert.ok(children.every((child) => targets.physical.includes(child)))
        }
        return true
      },
    }
    const status = await memoryPolicyStatus(f.engine, context)
    assert.equal(status.lockShape, 'other')
    assert.equal(status.state, 'unknown/unavailable')
    assert.equal(bothSeen, true)
    assert.deepEqual(new Set(finalTargets), new Set([f.root, lock, ...children]))
  } finally {
    await f.close()
  }
})

test('non-private lock shape is unavailable and a sole non-owner entry is other', async () => {
  const f = fixture()
  const lock = join(f.root, '.lock')
  try {
    mkdirSync(lock, { mode: 0o700 })
    writeFileSync(join(lock, 'unrecognized'), 'untouched', { mode: 0o600 })
    assert.equal((await memoryPolicyStatus(f.engine, f.current)).lockShape, 'other')
    chmodSync(lock, 0o755)
    const status = await memoryPolicyStatus(f.engine, f.current)
    assert.equal(status.lockObservation, 'directory-present')
    assert.equal(status.lockShape, 'unavailable')
    assert.equal(status.state, 'unknown/unavailable')
    assert.equal(readFileSync(join(lock, 'unrecognized'), 'utf8'), 'untouched')
  } finally {
    await f.close()
  }
})

for (const replacement of ['lock', 'root', 'symlink', 'revoke'] as const) {
  test(`shape scan fails closed on observed ${replacement} during the open-directory boundary`, async () => {
    const f = fixture()
    const lock = join(f.root, '.lock')
    let calls = 0
    let replaced = false
    try {
      mkdirSync(lock, { mode: 0o700 })
      const context: OperationContext = {
        current: (targets) => {
          // The thirteenth exact-target check is just after opendir resolves,
          // before its first read. No production hook or injectable fs exists.
          if (++calls === 13) {
            assert.deepEqual(targets.physical, [f.root, lock])
            replaced = true
            if (replacement === 'root') {
              renameSync(f.root, join(f.dir, 'old-root'))
              mkdirSync(f.root, { mode: 0o700 })
              mkdirSync(lock, { mode: 0o700 })
            } else if (replacement !== 'revoke') {
              renameSync(lock, join(f.root, '.old-lock'))
              if (replacement === 'symlink') symlinkSync(join(f.root, '.old-lock'), lock)
              else mkdirSync(lock, { mode: 0o700 })
            }
          }
          return !(replacement === 'revoke' && replaced)
        },
      }
      if (replacement === 'revoke')
        await assert.rejects(memoryPolicyStatus(f.engine, context), /authority required/)
      else {
        const status = await memoryPolicyStatus(f.engine, context)
        assert.equal(status.lockObservation, 'directory-present')
        assert.equal(status.lockShape, 'unavailable')
        assert.equal(status.state, 'unknown/unavailable')
        assert.equal(status.lockRetained, true)
      }
      assert.equal(replaced, true)
    } finally {
      await f.close()
    }
  })
}

test('lock observation fails closed on unavailable root and revoked bound authority', async () => {
  const f = fixture()
  try {
    mkdirSync(join(f.root, '.lock'), { mode: 0o700 })
    for (const allowedChecks of [1, 3]) {
      let calls = 0
      const revoked: OperationContext = {
        current: (targets) => {
          assert.deepEqual(targets.physical, [f.root, join(f.root, '.lock')])
          return ++calls <= allowedChecks
        },
      }
      await assert.rejects(memoryPolicyStatus(f.engine, revoked), /authority required/)
    }
    const missingRoot = join(f.dir, 'missing')
    const missing = new MemoryEngineController(missingRoot, f.env)
    try {
      const status = await memoryPolicyStatus(missing, f.current)
      assert.equal(status.lockObservation, 'unavailable')
      assert.equal(status.state, 'unknown/unavailable')
      assert.equal(status.lockRetained, true)
      assert.equal(existsSync(missingRoot), false)
    } finally {
      await missing.close()
    }
  } finally {
    await f.close()
  }
})

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
      if(status.lockObservation!=='directory-present') throw Error('Executor failure lost observation');
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
