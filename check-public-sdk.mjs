// Required offline SDK gate. Supply reviewed public packages explicitly; never harvest siblings.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { runNaturalCheck } from './lib/guards/test/natural-check-runner.mjs'
import {
  stagePermissionFixture,
  productRoot,
  publicModules,
} from './lib/guards/test/permission-patch-fixture.mjs'

for (const name of [
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-tui',
  '@gotgenes/pi-permission-system',
  '@gotgenes/pi-subagents',
  'typebox',
  'esbuild',
]) {
  assert.ok(
    fs.existsSync(path.join(publicModules, name, 'package.json')),
    `Required public SDK test supply missing: ${name}. Install declared dependencies explicitly, or set MAHIRO_PI_TEST_MODULES to reviewed public-package copies.`,
  )
}
// Standalone CLI uses the real root layout, not a mirrored whole-repo pnpm check.
const cli = stagePermissionFixture({ patched: false })
fs.unlinkSync(path.join(cli.primary, 'node_modules'))
fs.renameSync(path.join(cli.adapter, 'node_modules'), path.join(cli.primary, 'node_modules'))
const manifest = path.join(cli.root, 'bootstrap.json')
const profile = path.join(cli.root, 'preview-profile')
fs.writeFileSync(
  manifest,
  JSON.stringify({
    version: 1,
    agentDir: profile,
    sources: { pi: cli.primary },
    dependencyModules: path.join(cli.primary, 'node_modules'),
    components: { packages: true },
  }),
  { mode: 0o600 },
)
const preview = spawnSync(
  process.execPath,
  [path.join(cli.primary, 'bootstrap.mjs'), '--manifest', manifest, '--plan'],
  { encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024 },
)
fs.writeFileSync(path.join(cli.root, 'bootstrap-preview.log'), preview.stdout + preview.stderr)
assert.equal(preview.status, 0, preview.stderr)
assert.equal(fs.existsSync(profile), false, 'Root-only CLI preview writes no profile')
assert.ok(JSON.parse(preview.stdout).steps.some((s) => s.kind === 'packages'))
const stage = stagePermissionFixture({ patched: false })
const files = [
  'test.mjs',
  'native-mcp-sdk-test.mjs',
  'bootstrap-test.mjs',
  'managed-memory-test.mjs',
  'managed-memory-engine-test.mjs',
  'managed-memory-engine-operations-test.mjs',
  'managed-memory-install-test.mjs',
  'permission-patch-test.mjs',
  'bash-approval-patch-test.mjs',
  'code-map-blocked-test.mjs',
  'goal-patch-test.mjs',
  'evidence-patch-test.mjs',
  'ux-workflow-patch-test.mjs',
  'execution-run-patch-test.mjs',
  'subagents-patch-test.mjs',
  'subagents-owner-test.mjs',
  'child-controls-patch-test.mjs',
  'child-controls-owner-test.mjs',
  'task-provenance-patch-test.mjs',
  'worker-activity-sdk-test.mjs',
  'rtk-patch-test.mjs',
  'own-ui-patch-test.mjs',
  'candidate-patch-test.mjs',
]
const evidenceParent = path.join(productRoot, '.agent-state/runtime/candidate-isolation')
fs.mkdirSync(evidenceParent, { recursive: true, mode: 0o700 })
const proof = fs.mkdtempSync(path.join(evidenceParent, 'required-sdk-'))
fs.chmodSync(proof, 0o700)
console.log(`Public SDK receipts: ${proof}`)
const result = await runNaturalCheck(
  process.execPath,
  ['--test', '--test-concurrency=1', ...files.map((name) => path.join(stage.adapter, 'test', name))],
  {
    logPath: path.join(proof, 'required-sdk.log'),
    env: { ...process.env, MAHIRO_PI_TEST_MODULES: publicModules },
  },
)
const receipt = {
  ...result,
  bootstrapPreview: { pid: preview.pid, status: preview.status, signal: preview.signal, timeoutMs: 240000 },
  sourceOwner: productRoot,
  stage: stage.root,
  modsCheckoutPresent: fs.existsSync(path.join(stage.root, 'mods')),
  actualPublicSDK: true,
  liveInstall: false,
}
fs.writeFileSync(path.join(proof, 'required-sdk-exit.json'), JSON.stringify(receipt, null, 2), {
  mode: 0o600,
})
assert.equal(result.status, 0, JSON.stringify(receipt))
assert.equal(result.ok, true, JSON.stringify(receipt))
console.log('Required Root-owned public SDK suite completed with natural exit; no Mods checkout in fixture.')
