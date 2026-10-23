import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { productRoot, stagePermissionFixture } from './permission-patch-fixture.mjs'

test('task tools cross actual public SDK production Root/PSS with canonical package provenance', () => {
  const stage = stagePermissionFixture({
    patched: true,
    evidenceBase: path.join(productRoot, '.agent-state/runtime/t237-t236-delivery/task-provenance/sdk'),
  })
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(
    process.execPath,
    ['--test', path.join(stage.adapter, 'test/task-provenance-sdk-test.mjs')],
    { env, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
  )
  fs.writeFileSync(path.join(stage.root, 'sdk.log'), result.stdout + result.stderr)
  fs.writeFileSync(
    path.join(stage.root, 'sdk-exit.json'),
    JSON.stringify(
      {
        pid: result.pid,
        status: result.status,
        signal: result.signal,
        error: String(result.error ?? ''),
        externalWait: 'spawnSync returned',
        stage: stage.root,
      },
      null,
      2,
    ),
  )
  assert.equal(result.status, 0, `${stage.root}\n${result.stdout}${result.stderr}`)
})
