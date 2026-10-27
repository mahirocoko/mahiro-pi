import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

for (const denied of [false, true]) {
  test(`public SDK/Faux memory usability: ${denied ? 'explicit note-write denial stays local' : 'init-project then remember remains usable'}`, () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        fileURLToPath(new URL('./public-dependency-loader.mjs', import.meta.url)),
        fileURLToPath(new URL('./fixtures/memory-usability-sdk.mjs', import.meta.url)),
        ...(denied ? ['--deny-note'] : []),
      ],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 60000 },
    )
    assert.ifError(result.error)
    assert.equal(result.signal, null, result.stderr)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /"externalFetches":0/)
    if (denied) {
      assert.match(result.stdout, /"deniedNote":true/)
      assert.match(result.stdout, /"storageStillAuthorized":true/)
    } else {
      assert.match(result.stdout, /"initProjectThenRemember":true/)
      assert.match(result.stdout, /"postRememberReadSearchTopics":true/)
      assert.match(result.stdout, /"fauxCalls":1/)
    }
  })
}
