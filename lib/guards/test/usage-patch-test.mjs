import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { productRoot, stagePermissionFixture } from './permission-patch-fixture.mjs'

for (const patched of [true, false])
  test(`usage actual Root/public SDK ${patched ? 'positive and denial gates' : 'unattested owner denies'}`, () => {
    const stage = stagePermissionFixture({
      patched,
      extensions: 'active',
      evidenceBase: path.join(
        productRoot,
        '.agent-state/runtime/t291-usage-profile/implementation/sdk-wrapper',
      ),
    })
    // Preserve the authored root's public dependency graph, not a whole-module symlink.
    fs.unlinkSync(path.join(stage.primary, 'node_modules'))
    fs.renameSync(path.join(stage.adapter, 'node_modules'), path.join(stage.primary, 'node_modules'))
    const env = { ...process.env, USAGE_EXPECT_OWNER: patched ? 'patched' : 'old' }
    delete env.NODE_TEST_CONTEXT
    const logPath = path.join(stage.root, 'sdk.log')
    const fd = fs.openSync(logPath, 'wx', 0o600)
    let result
    try {
      result = spawnSync(
        process.execPath,
        ['--test', '--test-concurrency=1', path.join(stage.adapter, 'test/usage-sdk-test.mjs')],
        { env, stdio: ['ignore', fd, fd], timeout: 60000 },
      )
    } finally {
      fs.closeSync(fd)
    }
    fs.writeFileSync(
      path.join(stage.root, 'sdk-exit.json'),
      JSON.stringify(
        {
          status: result.status,
          signal: result.signal,
          error: String(result.error ?? ''),
          provenance: stage.provenance,
          patched,
          productionProfile: false,
          logPath,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    )
    assert.equal(result.status, 0, `Usage SDK failed; full output: ${logPath}`)
    assert.match(fs.readFileSync(logPath, 'utf8'), /# pass 1/)
  })
