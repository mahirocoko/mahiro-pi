import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { createMemoryStore } from '../lib/agent-memory/store.ts'
import { MemoryEngineController } from '../lib/agent-memory/engine/controller.ts'
import { stageBootstrapCandidate } from './bootstrap-candidate-fixture.ts'

const candidate = await stageBootstrapCandidate()
copyFileSync(
  new URL('../memory-maintenance.mjs', import.meta.url),
  join(candidate.primary, 'memory-maintenance.mjs'),
)

test('reset CLI inspect stays fresh with automatic reflection and a locked prepared root; refuses holders without deletion or backups', {
  skip: !existsSync(process.platform === 'darwin' ? '/usr/sbin/lsof' : '/usr/bin/lsof'),
}, async () => {
  const base = join(candidate.primary, '.agent-state/runtime')
  mkdirSync(base, { recursive: true, mode: 0o700 })
  const directory = mkdtempSync(join(base, 'reset-cli-'))
  const agentDir = join(directory, 'agent')
  const project = join(directory, 'project')
  const root = join(agentDir, 'memory')
  mkdirSync(project, { mode: 0o700 })
  const { inspectBootstrap, applyBootstrap } = candidate.bootstrap
  const plan = inspectBootstrap({
    version: 1,
    dependencyModules: candidate.modules,
    agentDir,
    sources: { pi: candidate.primary },
    components: { packages: true, roles: true, featureData: true, memoryEngine: true },
  })
  applyBootstrap(plan, plan.digest)
  const previous = { ...process.env }
  let held: number | undefined
  try {
    process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Synthetic reset'
    process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'fixture@example.invalid'
    const store = createMemoryStore(root, () => {}, 'primary')
    store.initialize(
      {
        version: 1,
        automatic: true,
        coreBytes: 8192,
        indexBytes: 2048,
        fileBytes: 8192,
        totalBytes: 65536,
        projects: [{ id: 'fixture', cwd: project }],
      },
      '# Synthetic reset CLI core\n',
    )
    const preparing = new MemoryEngineController(root)
    try {
      const context = { current: () => true }
      const view = await preparing.request('create', { project: 'fixture', shared: true }, context)
      await preparing.request(
        'edit',
        {
          view: view.view,
          path: 'Core.md',
          expectedHash: createHash('sha256')
            .update(readFileSync(join(root, 'Core.md')))
            .digest('hex'),
          text: '# Synthetic unpublished proposal\n',
          sources: [],
        },
        context,
      )
      await preparing.request('ready', { view: view.view }, context)
      const prepared = await preparing.request('prepare', { view: view.view, reviewed: [] }, context)
      assert.ok('plan' in prepared)
      mkdirSync(join(root, '.lock'), { mode: 0o700 })
      const stat = lstatSync(join(root, '.lock'))
      writeFileSync(
        join(root, '.lock/owner.json'),
        JSON.stringify({
          version: 1,
          operation: prepared.plan.id,
          digest: prepared.plan.digest,
          nonce: randomUUID(),
          directory: `${stat.dev}:${stat.ino}`,
        }),
        { mode: 0o600 },
      )
    } finally {
      await preparing.close()
    }
    const policyPath = join(agentDir, 'extensions/pi-permission-system/config.json')
    const policy = JSON.parse(readFileSync(policyPath, 'utf8'))
    for (const tool of [
      'agent_memory_manage',
      'agent_memory_read',
      'agent_memory_edit',
      'agent_memory_commit',
      'agent_memory_reflect',
    ])
      policy.permission[tool] = 'allow'
    const capability = `managed_memory_${createHash('sha256').update(root).digest('hex')}`
    policy.permission[capability] = 'allow'
    writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 })
    writeFileSync(join(root, '.held-synthetic'), 'HELD_PRIVATE_FIXTURE', { mode: 0o600 })
    // Public PSS may append its own review log; it is not memory or a backup.
    const tree = (path: string): unknown =>
      readdirSync(path, { withFileTypes: true })
        .filter((entry) => join(path, entry.name) !== join(agentDir, 'extensions/pi-permission-system/logs'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => [
          entry.name,
          entry.isDirectory()
            ? tree(join(path, entry.name))
            : createHash('sha256')
                .update(readFileSync(join(path, entry.name)))
                .digest('hex'),
        ])
    const before = tree(directory)
    const run = (reset = true) =>
      spawnSync(
        process.execPath,
        [
          join(candidate.primary, 'memory-maintenance.mjs'),
          '--agent-dir',
          agentDir,
          '--project',
          project,
          ...(reset ? ['--reset'] : []),
          '--inspect',
        ],
        { encoding: 'utf8', timeout: 120000, maxBuffer: 131072, env: process.env },
      )
    const inspected = run()
    assert.equal(inspected.status, 0, inspected.stderr)
    const receipt = JSON.parse(inspected.stdout)
    assert.equal(receipt.guardedNativeTool, 'agent_memory_manage')
    assert.equal(receipt.externalRequests, 0)
    assert.equal(receipt.noNativeWorkersAdmitted, true)
    assert.equal(receipt.maintenanceProjectionSkipped, true)
    assert.match(receipt.maintenance.target, /^[a-f0-9]{64}$/)
    assert.equal(receipt.maintenance.backupCreated, false)
    assert.equal(receipt.maintenance.corpusReturned, false)
    assert.equal(inspected.stdout.includes('HELD_PRIVATE_FIXTURE'), false)
    assert.equal(inspected.stdout.includes(directory), false)
    assert.deepEqual(tree(directory), before)
    // Non-reset recovery reports the same branded, bounded owner diagnostics.
    const publication = run(false)
    assert.equal(publication.status, 1)
    const publicationDiagnostic = JSON.parse(publication.stderr.split('\n')[0])
    assert.equal(publicationDiagnostic.native.code, 'extension-rejected')
    assert.equal(publicationDiagnostic.native.ownerCode, 'fingerprint')
    assert.equal(publication.stdout, '')
    assert.equal(publication.stderr.includes(directory), false)
    assert.equal(publication.stderr.includes('HELD_PRIVATE_FIXTURE'), false)
    assert.deepEqual(tree(directory), before)
    const settingsPath = join(agentDir, 'settings.json')
    const settingsBytes = readFileSync(settingsPath)
    const settings = JSON.parse(settingsBytes.toString('utf8'))
    const locators = new Set([
      join(candidate.primary, 'node_modules/@gotgenes/pi-permission-system'),
      join(candidate.primary, 'node_modules/@gotgenes/pi-subagents'),
    ])
    const alias = join(directory, 'permissions-alias')
    symlinkSync(realpathSync([...locators][0]), alias, 'dir')
    try {
      settings.packages = settings.packages.map((source: string) =>
        locators.has(source) ? realpathSync(source) : source,
      )
      writeFileSync(settingsPath, JSON.stringify(settings), { mode: 0o600 })
      const legacy = run()
      assert.equal(legacy.status, 0, legacy.stderr)
      assert.equal(JSON.parse(legacy.stdout).externalRequests, 0)
      settings.packages[0] = alias
      writeFileSync(settingsPath, JSON.stringify(settings), { mode: 0o600 })
      const aliased = run()
      assert.equal(aliased.status, 1)
      assert.equal(JSON.parse(aliased.stderr.split('\n')[0]).stage, 'owner-preflight')
      assert.equal(aliased.stdout, '')
    } finally {
      writeFileSync(settingsPath, settingsBytes, { mode: 0o600 })
      rmSync(alias)
    }
    assert.deepEqual(tree(directory), before)
    for (const surface of ['agent_memory_manage', capability]) {
      policy.permission[surface] = 'deny'
      writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 })
      const deniedBefore = tree(directory)
      const denied = run()
      assert.equal(denied.status, 1)
      const diagnostic = JSON.parse(denied.stderr.split('\n')[0])
      assert.equal(
        diagnostic.native.code,
        surface === 'agent_memory_manage' ? 'pre-execution-rejected' : 'extension-rejected',
      )
      assert.equal(diagnostic.native.ownerCode, surface === capability ? 'maintenance-authority' : undefined)
      assert.equal(denied.stdout, '')
      assert.equal(denied.stderr.includes(directory), false)
      assert.deepEqual(tree(directory), deniedBefore)
      policy.permission[surface] = 'allow'
      writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 })
    }
    held = openSync(join(root, '.held-synthetic'), 'r')
    const refused = run()
    assert.equal(refused.status, 1)
    const diagnostic = JSON.parse(refused.stderr.split('\n')[0])
    assert.equal(diagnostic.native.code, 'extension-rejected')
    assert.equal(diagnostic.native.ownerCode, 'holder-present')
    assert.match(refused.stderr, /inspection does not delete memory/)
    assert.doesNotMatch(refused.stderr, /partially deleted|HELD_PRIVATE_FIXTURE/)
    assert.equal(refused.stderr.includes(directory), false)
    assert.equal(refused.stdout, '')
    assert.deepEqual(tree(directory), before)
  } finally {
    if (held !== undefined) closeSync(held)
    process.env = previous
    rmSync(directory, { recursive: true, force: true })
  }
})
