import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Deliberately one serial subprocess: disposable installation + native SDK/Faux dispatch.
// Full-suite, live-provider, rendered-TUI and human acceptance are separate gates.
test('first-use public installation and feature matrix preserves authorization controls', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      fileURLToPath(new URL('./public-dependency-loader.mjs', import.meta.url)),
      fileURLToPath(new URL('./fixtures/first-use-sdk.mjs', import.meta.url)),
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 180000 },
  )
  assert.ifError(result.error)
  assert.equal(result.signal, null, String(result.stderr))
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const summary = JSON.parse(result.stdout.trim().split('\n').at(-1)!)
  assert.equal(summary.fatal, null, JSON.stringify(summary))
  assert.equal(summary.externalFetches, 0)
  assert.equal(summary.unexpected.length, 0, JSON.stringify(summary.unexpected))
  assert.ok(summary.successes >= 30, JSON.stringify(summary))
  const expectedControls = [
    'tasks.stale-revision',
    'goal.stale-revision',
    'goal.clear-no-ui',
    'evidence.denied-source',
    'pss.tool-deny',
    'pss.code-map-deny',
    'pss.memory-exact-root-deny',
    'pss.file-deny',
    'rtk.original-denied',
    'rtk.candidate-denied',
    'rtk.sanitized-final-denied',
    'wildcard.memory-no-exact-root',
    'yolo.memory-no-exact-root',
  ]
  assert.equal(summary.controls, expectedControls.length, JSON.stringify(summary))
  assert.deepEqual(summary.controlIds.toSorted(), expectedControls.toSorted())
})
