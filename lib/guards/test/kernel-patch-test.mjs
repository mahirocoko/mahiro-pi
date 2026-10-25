import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { productRoot, stagePermissionFixture } from './permission-patch-fixture.mjs'
import { runNaturalCheck } from './natural-check-runner.mjs'

test('independent kernel without Root on genuine public SDK', async () => {
  const stage = stagePermissionFixture({
    patched: true,
    evidenceBase: path.join(productRoot, '.agent-state/runtime/guard-redesign-A/phase-1/sdk'),
  })
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = await runNaturalCheck(
    process.execPath,
    ['--test', path.join(stage.adapter, 'test/kernel-sdk-test.mjs')],
    { env, logPath: path.join(stage.root, 'kernel-sdk.log') },
  )
  console.log(`Kernel SDK evidence: ${stage.root}`)
  assert.equal(result.status, 0, JSON.stringify(result))
  assert.equal(result.ok, true, JSON.stringify(result))
})
