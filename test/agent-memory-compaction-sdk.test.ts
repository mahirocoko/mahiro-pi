import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const assertSubprocess = (result: ReturnType<typeof spawnSync>) => {
  assert.ifError(result.error)
  assert.equal(result.signal, null, String(result.stderr))
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
}
const runFixture = (args: string[] = []) => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      fileURLToPath(new URL('./public-dependency-loader.mjs', import.meta.url)),
      fileURLToPath(new URL('./fixtures/memory-compaction-sdk.mjs', import.meta.url)),
      ...args,
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 90000 },
  )
  assertSubprocess(result)
  return result
}

test('SDK subprocess deadline surfaces the original spawn error rather than a null exit status', () => {
  const result = spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    encoding: 'utf8',
    timeout: 50,
  })
  assert.equal((result.error as NodeJS.ErrnoException)?.code, 'ETIMEDOUT')
  assert.throws(() => assertSubprocess(result), /ETIMEDOUT/)
})

test('actual public SDK/Faux threshold compaction queues metadata only and makes no writer request', () => {
  const result = runFixture()
  assert.match(result.stdout, /"genuineAutomaticCompactions":1/)
  assert.match(result.stdout, /"metadataOnly":true/)
  assert.match(result.stdout, /"compactionWriterAttempts":0/)
})

test('actual public SDK identical-summary manual compactions persist distinct leaf-derived identities', () => {
  const result = runFixture(['--duplicate-summary'])
  assert.match(result.stdout, /"actualManualCompactions":2/)
  assert.match(result.stdout, /"duplicateSummaryResolved":true/)
  assert.match(result.stdout, /"episodes":2/)
  assert.match(result.stdout, /"compactionWriterAttempts":0/)
})

test('actual public PSS denies runtime compaction episode temp without blocking checkpoint continuation', () => {
  const result = runFixture(['--deny-episode-temp'])
  assert.match(result.stdout, /"genuineAutomaticCompactions":1/)
  assert.match(result.stdout, /"episodes":0/)
  assert.match(result.stdout, /"deniedEpisodeTemp":true/)
  assert.match(result.stdout, /"permissionCallOverflow":false/)
  assert.match(result.stdout, /"compactionWriterAttempts":0/)
})
