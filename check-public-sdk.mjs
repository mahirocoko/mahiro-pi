// Required offline SDK gate. Supply reviewed public packages explicitly; never harvest siblings.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { cleanupStateFixtures, stateRoot, measureState, stateRuntimeDirectory } from './test-state.mjs'
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
// Only marked completed receipts with known flat contents are eligible for retention.
measureState(stateRoot(productRoot))
const evidenceParent = stateRuntimeDirectory(
  productRoot,
  path.join(stateRoot(productRoot), 'runtime/candidate-isolation'),
)
function retainReceipts() {
  const receipts = fs
    .readdirSync(evidenceParent)
    .filter((name) => {
      if (!/^required-sdk-[A-Za-z0-9]{6}$/.test(name)) return false
      const directory = path.join(evidenceParent, name)
      if (!fs.lstatSync(directory).isDirectory()) return false
      const names = fs.readdirSync(directory).sort()
      if (names.join(',') !== 'receipt-owner.json,required-sdk-exit.json,required-sdk.log') return false
      if (names.some((file) => !fs.lstatSync(path.join(directory, file)).isFile())) return false
      if (fs.lstatSync(path.join(directory, 'receipt-owner.json')).size !== 25) return false
      return (
        fs.readFileSync(path.join(directory, 'receipt-owner.json'), 'utf8') === 'mahiro-pi-sdk-receipt-v1\n'
      )
    })
    .sort(
      (a, b) =>
        fs.statSync(path.join(evidenceParent, b)).mtimeMs - fs.statSync(path.join(evidenceParent, a)).mtimeMs,
    )
  for (const name of receipts.slice(3)) fs.rmSync(path.join(evidenceParent, name), { recursive: true })
}
retainReceipts()
const fixtures = []
const failures = []
function stageOwned(options) {
  const fixture = stagePermissionFixture(options)
  fixtures.push(fixture)
  return fixture
}
try {
  // Standalone CLI uses the real root layout, not a mirrored whole-repo gate.
  const cli = stageOwned({ patched: false })
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
  const stage = stageOwned({ patched: false })
  // Offline adoption requires the existing public owner's winning-surface attestation.
  // Keep ordinary targets on their unchanged fixture and scope the attested supply to this target.
  const maintenanceStage = stageOwned({ patched: true })
  fs.copyFileSync(
    path.join(productRoot, 'memory-maintenance.mjs'),
    path.join(maintenanceStage.primary, 'memory-maintenance.mjs'),
  )
  const files = [
    'kernel-patch-test.mjs',
    'thin-native-patch-test.mjs',
    'test.mjs',
    'native-mcp-sdk-test.mjs',
    'bootstrap-test.mjs',
    'managed-memory-test.mjs',
    'managed-memory-engine-test.mjs',
    'managed-memory-engine-operations-test.mjs',
    'managed-memory-tree-sdk-test.mjs',
    'managed-memory-route-sdk-test.mjs',
    'managed-memory-install-test.mjs',
    'offline-maintenance-sdk-test.mjs',
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
    'usage-patch-test.mjs',
    'candidate-patch-test.mjs',
  ]
  const proof = fs.mkdtempSync(path.join(evidenceParent, 'required-sdk-'))
  fs.chmodSync(proof, 0o700)
  console.log(`Public SDK receipts: ${proof}`)
  const result = await runNaturalCheck(
    process.execPath,
    [
      '--test',
      '--test-concurrency=1',
      ...files.map((name) =>
        path.join(
          name === 'offline-maintenance-sdk-test.mjs' ? maintenanceStage.adapter : stage.adapter,
          'test',
          name,
        ),
      ),
    ],
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
  fs.writeFileSync(path.join(proof, 'receipt-owner.json'), 'mahiro-pi-sdk-receipt-v1\n', { mode: 0o600 })
  retainReceipts()
  assert.equal(result.status, 0, JSON.stringify(receipt))
  assert.equal(result.ok, true, JSON.stringify(receipt))
  console.log(
    'Required Root-owned public SDK suite completed with natural exit; no Mods checkout in fixture.',
  )
} catch (error) {
  failures.push(error)
}
try {
  cleanupStateFixtures(productRoot, fixtures)
} catch (error) {
  failures.push(error)
}
if (failures.length === 1) throw failures[0]
if (failures.length > 1) throw new AggregateError(failures, 'Public SDK gate or cleanup failed')
