import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { stagePermissionFixture } from './permission-patch-fixture.mjs'

// Deliberately outside check:source/check:public-sdk and the shipped extension graph.
// Run explicitly with --test and the reviewed public-package supply.
const stage = stagePermissionFixture({ patched: true, extensions: 'active' })
try {
  const home = join(stage.root, 'orchestrator-home')
  const env = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    MAHIRO_PI_TEST_STATE_ROOT: process.env.MAHIRO_PI_TEST_STATE_ROOT,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    PI_CODING_AGENT_DIR: join(home, '.pi', 'agent'),
    PI_TELEMETRY: '0',
    PI_OFFLINE: '1',
  }
  mkdirSync(home)
  const probe = spawnSync(
    process.execPath,
    ['--test', '--test-force-exit', `${stage.adapter}/test/orchestrator-sdk-test.mjs`],
    {
      cwd: stage.primary,
      env,
      encoding: 'utf8',
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
    },
  )
  assert.equal(probe.status, 0, `${probe.error ?? ''}\n${probe.stdout}\n${probe.stderr}`)
  process.stdout.write(probe.stdout)
} finally {
  stage.cleanup()
}
