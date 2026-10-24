// Disposable core-tier OS fault actor, never an installed entry or authority proof.
import assert from 'node:assert/strict'
import { lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryEngineController } from '../../lib/agent-memory/engine/controller.ts'
import { MemoryPublisher } from '../../lib/agent-memory/engine/publisher.ts'
import { parseOperation } from '../../lib/agent-memory/engine/operation.ts'

const [root, control, stop] = process.argv.slice(2)
assert.ok(['prepared', 'index_staged', 'head_observed'].includes(stop))
assert.equal(lstatSync(join(root, '.git')).isDirectory(), true)
const engine = new MemoryEngineController(root)
const plain = { current: () => true }
const { view } = await engine.request('create', { project: 'project' }, plain)
const core = await engine.request('read', { view, selection: { path: 'Core.md' } }, plain)
await engine.request(
  'edit',
  { view, path: 'Core.md', expectedHash: core.hash, text: '# Separate process proposal\n', sources: [] },
  plain,
)
await engine.request('ready', { view }, plain)
const { plan } = await engine.request('prepare', { view, reviewed: [] }, plain)
const journal = join(root, '.views/.engine-v2/journal', `${plan.id}.json`)
const crash = () => {
  // Synchronous structural receipt survives abrupt parent exit; no content or replay capability.
  writeFileSync(
    control,
    JSON.stringify({ pid: process.pid, engine: engine.pid, plan: plan.id, digest: plan.digest, stage: stop }),
    { mode: 0o600 },
  )
  process.exit(23)
}
if (stop === 'prepared') crash() // no canonical action, Git or hook has started
await new MemoryPublisher(engine).publish(plan, {
  current(targets) {
    // Lose the parent observation after the child has completed the journal/CAS action,
    // but before the parent consumes its reply. Earlier CAS crashes are separately fail-closed.
    if (!targets.physical.length && parseOperation(readFileSync(journal, 'utf8')).receipt.stage === stop)
      crash()
    return true
  },
})
throw Error('Fault boundary was not reached')
