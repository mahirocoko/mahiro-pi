import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { applyBootstrap, inspectBootstrap } from '../lib/bootstrap.ts'
import { stageBootstrapCandidate } from './bootstrap-candidate-fixture.ts'
import { memorySelectionPath } from '../lib/agent-memory/profile.ts'
import { renderWriterTemplate } from '../lib/agent-memory/writer-route.ts'
import { setupTarget } from '../lib/setup.ts'

const supply = await stageBootstrapCandidate()
const product = resolve(import.meta.dirname, '..')
test('absent-root explicit off/legacy standard installation refuses before profile writes or initialization', () => {
  const dir = mkdtempSync(join(supply.root, 'preserved-off-'))
  try {
    for (const mode of ['off', 'legacy']) {
      const profile = join(dir, mode)
      mkdirSync(profile, { mode: 0o700 })
      const selected = JSON.stringify({ version: 2, root: join(profile, 'memory'), mode })
      writeFileSync(memorySelectionPath(profile), selected, { mode: 0o600 })
      const result = spawnSync(process.execPath, [join(product, 'install.mjs'), '--agent-dir', profile], {
        cwd: product,
        encoding: 'utf8',
      })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /legacy\/off.*no initialized root/)
      assert.match(result.stderr, /wrote nothing/)
      assert.deepEqual(readdirSync(profile), ['.mahiro-memory-engine.json'])
      assert.equal(readFileSync(memorySelectionPath(profile), 'utf8'), selected)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('standard engine/route installation preserves legacy/off and specific optional denies with reviewed byte CAS', () => {
  const dir = mkdtempSync(join(supply.root, 'ordinary-plan-'))
  try {
    const request = (profile: string, route?: { model: string; thinking: 'off' }) => ({
      version: 1 as const,
      agentDir: profile,
      dependencyModules: supply.modules,
      sources: { pi: product },
      components: {
        packages: true as const,
        roles: true as const,
        memoryEngine: true as const,
        featureData: true as const,
        ...(route ? { managedWriterRoute: route } : {}),
      },
    })
    const profile = join(dir, 'fresh')
    let plan = inspectBootstrap(request(profile))
    assert.deepEqual(JSON.parse(plan.changes.find((change) => change.kind === 'memory-engine')!.next), {
      version: 2,
      root: join(profile, 'memory'),
      mode: 'engine',
    })
    applyBootstrap(plan, plan.digest)
    const selectionPath = memorySelectionPath(profile)
    const descriptor = join(profile, 'agents/managed-memory-writer.md')
    const portable = renderWriterTemplate({ model: 'reviewed/writer-v1', thinking: 'off' })
    writeFileSync(descriptor, portable, { mode: 0o600 })
    for (const mode of ['legacy', 'off']) {
      const selected = JSON.stringify({ version: 2, root: join(profile, 'memory'), mode })
      writeFileSync(selectionPath, selected, { mode: 0o600 })
      plan = inspectBootstrap(request(profile))
      assert.equal(plan.changes.find((change) => change.path === descriptor)!.next, portable)
      applyBootstrap(plan, plan.digest)
      assert.equal(readFileSync(selectionPath, 'utf8'), selected)
    }
    const permissionPath = setupTarget(profile)
    const config = JSON.parse(readFileSync(permissionPath, 'utf8'))
    config.permission.agent_memory_reflect = 'deny'
    config.permission[`continuity_learning_${'b'.repeat(64)}`] = 'deny'
    writeFileSync(permissionPath, JSON.stringify(config), { mode: 0o600 })
    plan = inspectBootstrap(request(profile, { model: 'reviewed/writer-v2', thinking: 'off' }))
    const targetChange = plan.changes.find((change) => change.path === permissionPath)!
    assert.equal(JSON.parse(targetChange.next).permission.agent_memory_reflect, 'deny')
    assert.equal(JSON.parse(targetChange.next).permission[`continuity_learning_${'b'.repeat(64)}`], 'deny')
    assert.ok(!plan.featureInstallation!.capabilities.some((key) => key.startsWith('continuity_learning_')))
    assert.ok(!plan.featureInstallation!.capabilities.includes('agent_memory_reflect'))
    writeFileSync(descriptor, portable.replace('writer-v1', 'writer-concurrent'), { mode: 0o600 })
    assert.throws(() => applyBootstrap(plan, plan.digest), /stale/)
    assert.match(readFileSync(descriptor, 'utf8'), /writer-concurrent/)
    writeFileSync(descriptor, portable, { mode: 0o600 })
    plan = inspectBootstrap(request(profile, { model: 'reviewed/writer-v2', thinking: 'off' }))
    applyBootstrap(plan, plan.digest)
    assert.match(readFileSync(descriptor, 'utf8'), /model: reviewed\/writer-v2/)
    writeFileSync(descriptor, portable.replace('max_turns: 8', 'max_turns: 9'), { mode: 0o600 })
    assert.throws(() => inspectBootstrap(request(profile)), /canonical template/)
    writeFileSync(selectionPath, '{"version":2}', { mode: 0o600 })
    writeFileSync(descriptor, portable, { mode: 0o600 })
    assert.throws(() => inspectBootstrap(request(profile)), /Invalid memory engine/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
