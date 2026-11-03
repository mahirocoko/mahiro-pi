import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryRetirement } from '../lib/kernel/memory-retirement.ts'
import { MemoryLifetime } from '../lib/agent-memory/engine/lifetime.ts'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

test('memory-only retirement fences synchronously, joins callbacks and holds, leaves foreground owner intact', async () => {
  const continuation = deferred()
  const foreground = { healthy: true, ticks: 0, aborted: false }
  let fenced = false
  let released = false
  const owner = createMemoryRetirement(
    () => {
      fenced = true
    },
    async () => {
      released = true
    },
  )
  const release = owner.hold(() => () => {})
  owner.onRetire(() => {
    assert.equal(fenced, true)
    return continuation.promise
  })
  let joined = false
  const retiring = owner.retire().then((value) => {
    joined = true
    return value
  })
  assert.equal(fenced, true)
  assert.throws(() => owner.hold(() => () => {}), /retir/)
  assert.throws(() => owner.onRetire(async () => {}), /retir/)
  foreground.ticks++
  await Promise.resolve()
  assert.equal(joined, false)
  continuation.resolve()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(joined, false, 'callback completion does not release another actual hold')
  assert.equal(released, false)
  release()
  assert.deepEqual(await retiring, { state: 'drained', scope: 'memory-generation', globalQuiescence: false })
  assert.deepEqual(foreground, { healthy: true, ticks: 1, aborted: false })
  assert.throws(() => owner.hold(() => () => {}), /retir/, 'same owner cannot reactivate')
})

test('no callback is unsupported; rejected retirement callback never certifies drain or releases owner', async () => {
  const missing = createMemoryRetirement(
    () => {},
    async () => {},
  )
  assert.equal((await missing.retire()).state, 'unsupported')
  let released = false
  const failed = createMemoryRetirement(
    () => {},
    async () => {
      released = true
    },
  )
  failed.onRetire(() => Promise.reject(Error('join unavailable')))
  await assert.rejects(failed.retire(), /join unavailable/)
  await assert.rejects(failed.retire(), /join unavailable/)
  assert.equal(released, false)
  const invalid = createMemoryRetirement(
    () => {},
    async () => {},
  )
  invalid.onRetire((() => undefined) as any)
  await assert.rejects(invalid.retire(), /join promise/)
})

test('critical native join rejection is sticky even when the caller handles it', async () => {
  const lifetime = new MemoryLifetime()
  await assert.rejects(
    lifetime.join(async () => {
      throw Error('native join rejected')
    }),
    /native join/,
  )
  await assert.rejects(lifetime.drain(), /native join/)
  await assert.rejects(lifetime.drain(), /native join/)
  const unsupported = new MemoryLifetime()
  await assert.rejects(unsupported.join((() => undefined) as any), /join promise/)
  await assert.rejects(unsupported.drain(), /join promise/)
})

test('an observer timeout never turns a pending native retirement into drain', async () => {
  const native = deferred()
  const owner = createMemoryRetirement(
    () => {},
    async () => {},
  )
  owner.onRetire(() => native.promise)
  const retirement = owner.retire()
  assert.equal(await Promise.race([retirement, Promise.resolve('observer-timeout')]), 'observer-timeout')
  assert.equal(owner.retire(), retirement, 'retry still joins the original pending turn')
  native.resolve()
  assert.equal((await retirement).state, 'drained')
})
