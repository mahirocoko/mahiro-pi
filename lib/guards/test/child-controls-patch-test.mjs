import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { stagePermissionFixture } from './permission-patch-fixture.mjs'

test('child-control attestation uses real public SDK/Faux with production Root and PSS', () => {
  for (const subagentsState of ['current', 'v2']) {
    const stage = stagePermissionFixture({ patched: true, subagentsState })
    const env = { ...process.env, CHILD_CONTROL_LEGACY: subagentsState === 'v2' ? '1' : '0' }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(
      process.execPath,
      ['--test', path.join(stage.adapter, 'test/child-controls-sdk-test.mjs')],
      {
        env,
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
      },
    )
    fs.writeFileSync(path.join(stage.root, 'child-controls-sdk.log'), result.stdout + result.stderr)
    fs.writeFileSync(
      path.join(stage.root, 'child-controls-sdk-exit.json'),
      JSON.stringify(
        {
          pid: result.pid,
          status: result.status,
          signal: result.signal,
          error: String(result.error ?? ''),
          subagentsState,
          actualPublicSDK: true,
          liveInstall: false,
          timeoutMs: 60000,
          externalWait: 'spawnSync returned',
        },
        null,
        2,
      ),
    )
    assert.equal(result.status, 0, result.stdout + result.stderr)
    console.log(`Child-control ${subagentsState} SDK receipts: ${stage.root}`)
  }
})
