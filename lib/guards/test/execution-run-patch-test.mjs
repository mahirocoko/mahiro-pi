import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { productRoot, adapterRoot, stagePermissionFixture } from './permission-patch-fixture.mjs'

test('Execution Run actual public SDK and isolated patched/old permission owner', () => {
  for (const patched of [true, false]) {
    const stage = stagePermissionFixture({
      patched,
      evidenceBase: path.join(productRoot, '.agent-state/runtime/pi-ownership-repair/execution-run'),
    })
    fs.copyFileSync(
      path.join(adapterRoot, 'test/execution-run-test.mjs'),
      path.join(stage.adapter, 'test/execution-run-test.mjs'),
    )
    const env = {
      ...process.env,
      RUN_EXPECT_OWNER: patched ? 'patched' : 'old',
    }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-reporter=tap', path.join(stage.adapter, 'test/execution-run-test.mjs')],
      { env, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
    )
    fs.writeFileSync(path.join(stage.root, 'sdk.log'), result.stdout + result.stderr)
    fs.writeFileSync(
      path.join(stage.root, 'sdk-exit.json'),
      JSON.stringify(
        {
          status: result.status,
          signal: result.signal,
          error: String(result.error ?? ''),
          timeoutMs: 60000,
          provenance: stage.provenance,
          liveInstalledPatch: false,
        },
        null,
        2,
      ),
    )
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /# pass 1/)
    if (patched) assert.match(result.stdout, /CHEAP_FALSIFIER_PASS/)
  }
})
