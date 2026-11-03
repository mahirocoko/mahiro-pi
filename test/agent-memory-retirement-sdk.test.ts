import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('real offline SDK/kernel: retirement drains locally and public same-session replacement restores memory', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      fileURLToPath(new URL('./public-dependency-loader.mjs', import.meta.url)),
      fileURLToPath(new URL('./fixtures/memory-retirement-sdk.mjs', import.meta.url)),
    ],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 },
  )
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.signal, null, result.stderr)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /"passed":true/)
  assert.match(result.stdout, /"sameSessionNewGenerationRecovery":true/)
  assert.match(result.stdout, /"publicLifecycle":"AgentSessionRuntime.switchSession"/)
  assert.match(result.stdout, /"liveReloadProven":false/)
})
