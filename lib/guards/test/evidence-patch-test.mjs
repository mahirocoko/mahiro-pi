import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { productRoot, stagePermissionFixture } from './permission-patch-fixture.mjs'
test('Evidence actual public SDK patched exact owner and old-owner denial', () => {
  for (const patched of [true, false]) {
    const stage = stagePermissionFixture({
      patched,
      evidenceBase: path.join(productRoot, '.agent-state/runtime/pi-ownership-repair/evidence'),
    })
    const env = {
      ...process.env,
      EVIDENCE_EXPECT_OWNER: patched ? 'patched' : 'old',
    }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-reporter=tap', path.join(stage.adapter, 'test/evidence-test.mjs')],
      { env, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024 },
    )
    fs.writeFileSync(path.join(stage.root, 'sdk.log'), result.stdout + result.stderr)
    fs.writeFileSync(
      path.join(stage.root, 'sdk-exit.json'),
      JSON.stringify(
        {
          status: result.status,
          signal: result.signal,
          error: String(result.error ?? ''),
          timeoutMs: 240000,
          provenance: stage.provenance,
          liveInstalledPatch: false,
        },
        null,
        2,
      ),
    )
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /# pass 1/)
  }
})
