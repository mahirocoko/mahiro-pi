import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { stagePermissionFixture } from './permission-patch-fixture.mjs'

test('full candidate12 single-owner session and rejected dual-owner regression', () => {
  const stage = stagePermissionFixture()
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(
    process.execPath,
    ['--test', path.join(stage.adapter, 'test/candidate-session-test.mjs')],
    { env, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
  )
  fs.writeFileSync(path.join(stage.root, 'candidate-session.log'), result.stdout + result.stderr)
  fs.writeFileSync(
    path.join(stage.root, 'candidate-session-exit.json'),
    JSON.stringify(
      {
        status: result.status,
        signal: result.signal,
        error: String(result.error ?? ''),
        timeoutMs: 60000,
      },
      null,
      2,
    ),
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
