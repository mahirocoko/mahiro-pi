import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  realpathSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createMemoryRetirement } from '../lib/kernel/memory-retirement.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createMemoryAdmission,
  beginMemoryBarrier,
  joinMemoryBarrier,
  cancelMemoryBarrier,
  admissionDirectory,
} from '../lib/agent-memory/engine/admission.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

test('barrier cannot validate until the actual paused admitted continuation drains', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-admission-'))
  mkdirSync(join(root, '.views'), { mode: 0o700 })
  const context = { current: () => true }
  const paused = deferred()
  const entered = deferred()
  let mutations = 0
  const participant = createMemoryAdmission(root, context, async () => {})
  try {
    const publication = participant.run(async () => {
      entered.resolve()
      await paused.promise
      participant.assertCurrent()
      mutations++
    })
    await entered.promise
    const barrier = await beginMemoryBarrier(root, context, {
      id: '11111111-1111-4111-8111-111111111111',
      digest: 'a'.repeat(64),
    })
    let validated = false
    const joined = joinMemoryBarrier(root, context, barrier).then(() => {
      validated = true
    })
    await new Promise((done) => setImmediate(done))
    assert.equal(validated, false)
    paused.resolve()
    await assert.rejects(publication, /admission.*retired|epoch|barrier/i)
    await joined
    assert.equal(mutations, 0)
    assert.equal(validated, true)
    const state = JSON.parse(readFileSync(join(root, admissionDirectory, 'state.json'), 'utf8'))
    assert.equal(state.participants[0].acknowledgement, barrier.id)
  } finally {
    paused.resolve()
    rmSync(root, { recursive: true, force: true })
  }
})

const target = { id: '11111111-1111-4111-8111-111111111111', digest: 'a'.repeat(64) }
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-admission-'))
  mkdirSync(join(root, '.views'), { mode: 0o700 })
  const context = { current: () => true }
  const path = join(root, admissionDirectory, 'state.json')
  return { root, context, path, close: () => rmSync(root, { recursive: true, force: true }) }
}

test('construction and unregistered read checks provision nothing', () => {
  const f = fixture()
  try {
    const participant = createMemoryAdmission(f.root, f.context, async () => {})
    participant.assertCurrent()
    assert.equal(existsSync(join(f.root, admissionDirectory)), false)
  } finally {
    f.close()
  }
})

test('barrier wins registration; cancellation admits a fresh epoch but never resurrects the old one', async () => {
  const f = fixture()
  try {
    const old = createMemoryAdmission(f.root, f.context, async () => {})
    await old.run(async () => {})
    const barrier = await beginMemoryBarrier(f.root, f.context, target)
    let started = false
    const racing = createMemoryAdmission(f.root, f.context, async () => {})
    await assert.rejects(
      racing.run(async () => {
        started = true
      }),
      /barrier/,
    )
    assert.equal(started, false)
    await assert.rejects(
      old.run(async () => {
        started = true
      }),
      /epoch|barrier/,
    )
    await assert.rejects(cancelMemoryBarrier(f.root, f.context, { ...barrier, id: target.id }), /transaction/)
    await cancelMemoryBarrier(f.root, f.context, barrier)
    assert.throws(() => old.assertCurrent(), /epoch/)
    const fresh = createMemoryAdmission(f.root, f.context, async () => {})
    await fresh.run(async () => {
      started = true
    })
    assert.equal(started, true)
    assert.equal(JSON.parse(readFileSync(f.path, 'utf8')).barrier, null)
    assert.equal(existsSync(join(f.root, admissionDirectory, 'turn')), false)
  } finally {
    f.close()
  }
})

for (const seam of ['persistence', 'final-unwind'] as const) {
  test(`barrier cancellation abort at ${seam} releases only its owned turn`, async () => {
    const f = fixture()
    try {
      await createMemoryAdmission(f.root, f.context, async () => {}).run(async () => {})
      const barrier = await beginMemoryBarrier(f.root, f.context, target)
      const abort = new AbortController()
      let temporaryChecks = 0
      const context = {
        signal: abort.signal,
        current(request: { physical: readonly string[] }) {
          const temporary = request.physical.some((path) => path.endsWith('.tmp'))
          if (temporary) temporaryChecks++
          if (
            (seam === 'persistence' && temporaryChecks === 2 && temporary) ||
            (seam === 'final-unwind' && request.physical.at(-1) === join(f.root, admissionDirectory))
          )
            abort.abort(Error('test cancellation'))
          return true
        },
      }
      const cancellation = cancelMemoryBarrier(f.root, context, barrier)
      if (seam === 'persistence') await assert.rejects(cancellation, /test cancellation/)
      else await cancellation
      assert.equal(abort.signal.aborted, true)
      assert.equal(existsSync(join(f.root, admissionDirectory, 'turn')), false)
      assert.deepEqual(
        JSON.parse(readFileSync(f.path, 'utf8')).barrier,
        seam === 'persistence' ? barrier : null,
      )
      if (seam === 'persistence') await cancelMemoryBarrier(f.root, f.context, barrier)
      await createMemoryAdmission(f.root, f.context, async () => {}).run(async () => {})
    } finally {
      f.close()
    }
  })
}

test('turn unwind never removes a replaced foreign directory even on abort', async () => {
  const f = fixture()
  try {
    await createMemoryAdmission(f.root, f.context, async () => {}).run(async () => {})
    const barrier = await beginMemoryBarrier(f.root, f.context, target)
    const turn = join(f.root, admissionDirectory, 'turn')
    const held = join(f.root, admissionDirectory, 'held-turn')
    const abort = new AbortController()
    await assert.rejects(
      cancelMemoryBarrier(
        f.root,
        {
          signal: abort.signal,
          current(request) {
            if (request.physical.at(-1) === join(f.root, admissionDirectory)) {
              renameSync(turn, held)
              mkdirSync(turn, { mode: 0o700 })
              abort.abort()
            }
            return true
          },
        },
        barrier,
      ),
      /turn identity changed/,
    )
    assert.equal(existsSync(turn), true)
    assert.equal(existsSync(held), true)
    assert.equal(JSON.parse(readFileSync(f.path, 'utf8')).barrier, null)
  } finally {
    f.close()
  }
})

test('registration in flight cannot race past barrier enumeration', async () => {
  const f = fixture()
  try {
    const participant = createMemoryAdmission(f.root, f.context, async () => {})
    let continuation = false
    const registered = participant.run(async () => {
      continuation = true
    })
    // An overlapping process/turn is refused, never treated as an empty inventory.
    const attempted = beginMemoryBarrier(f.root, f.context, target).catch((error: Error) => error)
    await registered
    const result = await attempted
    const barrier = result instanceof Error ? await beginMemoryBarrier(f.root, f.context, target) : result
    if (result instanceof Error) assert.match(result.message, /busy|ENOENT/)
    await joinMemoryBarrier(f.root, f.context, barrier)
    assert.equal(continuation, true)
    assert.throws(() => participant.assertCurrent(), /retired/)
  } finally {
    f.close()
  }
})

test('foreign process participant and forged durable acknowledgement never stand in for a join', async () => {
  const f = fixture()
  try {
    const source = fileURLToPath(new URL('../lib/agent-memory/engine/admission.ts', import.meta.url))
    const child = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `import { createMemoryAdmission } from ${JSON.stringify(source)}; await createMemoryAdmission(${JSON.stringify(f.root)}, { current: () => true }, async () => {}).run(async () => {});`,
      ],
      { encoding: 'utf8', timeout: 10000 },
    )
    assert.equal(child.status, 0, child.stderr)
    const barrier = await beginMemoryBarrier(f.root, f.context, target)
    const state = JSON.parse(readFileSync(f.path, 'utf8'))
    state.participants[0].acknowledgement = barrier.id
    writeFileSync(f.path, JSON.stringify(state), { mode: 0o600 })
    await assert.rejects(joinMemoryBarrier(f.root, f.context, barrier), /cross-process|legacy/)
    await cancelMemoryBarrier(f.root, f.context, barrier)
  } finally {
    f.close()
  }
})

test('malformed, duplicate and root-rebound records fail closed without removing evidence', async () => {
  const f = fixture()
  try {
    await createMemoryAdmission(f.root, f.context, async () => {}).run(async () => {})
    const original = readFileSync(f.path, 'utf8')
    for (const change of [
      (state: any) => {
        state.participants[0].unexpected = true
      },
      (state: any) => {
        state.participants.push(state.participants[0])
      },
      (state: any) => {
        state.rootIdentity = '1:2'
      },
    ]) {
      const state = JSON.parse(original)
      change(state)
      const bytes = JSON.stringify(state)
      writeFileSync(f.path, bytes)
      await assert.rejects(beginMemoryBarrier(f.root, f.context, target), /Malformed/)
      assert.equal(readFileSync(f.path, 'utf8'), bytes)
    }
  } finally {
    f.close()
  }
})

test('kernel acknowledgement follows actual native join and inherited hold release', async () => {
  const f = fixture()
  const native = deferred()
  let fenced = false
  const kernel = createMemoryRetirement(
    () => {
      fenced = true
    },
    async () => {},
  )
  kernel.onRetire(() => native.promise)
  const release = kernel.hold(() => () => {})
  try {
    const participant = createMemoryAdmission(f.root, f.context, async () => {
      const result = await kernel.retire()
      assert.equal(result.state, 'drained')
      assert.equal(result.globalQuiescence, false)
    })
    await participant.run(async () => {})
    const barrier = await beginMemoryBarrier(f.root, f.context, target)
    const joined = joinMemoryBarrier(f.root, f.context, barrier)
    assert.equal(fenced, true)
    assert.equal(JSON.parse(readFileSync(f.path, 'utf8')).participants[0].acknowledgement, null)
    native.resolve()
    await new Promise((done) => setImmediate(done))
    assert.equal(JSON.parse(readFileSync(f.path, 'utf8')).participants[0].acknowledgement, null)
    release()
    const result = await joined
    assert.equal(result.globalQuiescence, false)
    assert.equal(JSON.parse(readFileSync(f.path, 'utf8')).participants[0].acknowledgement, barrier.id)
    assert.deepEqual(
      await joinMemoryBarrier(f.root, f.context, barrier),
      result,
      'same-process resume rejoins exact actual references',
    )
  } finally {
    native.resolve()
    release()
    f.close()
  }
})

test('denied admission paths create no registry', async () => {
  const f = fixture()
  try {
    const participant = createMemoryAdmission(f.root, { current: () => false }, async () => {})
    await assert.rejects(
      participant.run(async () => {}),
      /authority/,
    )
    assert.equal(existsSync(join(f.root, admissionDirectory)), false)
  } finally {
    f.close()
  }
})

test.todo('online quarantine completion: blocked until a real complete-cohort enrollment owner exists')
test.todo('cross-process post-crash join/resume: blocked without an actual remote generation join channel')
