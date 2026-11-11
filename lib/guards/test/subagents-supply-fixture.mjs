// Normalize only a newly owned copy of a declared or explicitly reviewed public package.
// Patch-state and hash checks cover reviewed patch-touched files, not whole-package provenance.
// The caller remains responsible for the trusted public-package supply.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { gitFixtureEnv } from './git-isolation-fixture.mjs'

export function normalizeSubagentsCopy({ product, supplied, target, ceiling, desired = 'current' }) {
  assert.ok(['unpatched', 'current'].includes(desired), 'Historical 23.x patch states are not 25.x supplies')
  assert.equal(fs.existsSync(target), false, 'target must be a new owned copy')
  const reviewed = JSON.parse(
    fs.readFileSync(path.join(product, 'lib/guards/test/fixtures/subagents-current.json'), 'utf8'),
  ).current
  const current = path.join(product, 'patches/@gotgenes__pi-subagents@25.0.5.patch')
  const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  fs.cpSync(supplied, target, {
    recursive: true,
    filter: (file) => !file.startsWith(path.join(supplied, 'node_modules')),
  })
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version, '25.0.5')
  const apply = (reverse = false, check = false) =>
    spawnSync('git', ['apply', ...(reverse ? ['--reverse'] : []), ...(check ? ['--check'] : []), current], {
      cwd: target,
      encoding: 'utf8',
      env: gitFixtureEnv(ceiling),
    })
  const detect = () => {
    const forward = apply(false, true)
    const reverse = apply(true, true)
    assert.notEqual(forward.status === 0, reverse.status === 0, 'Unknown/drift subagents supply')
    if (reverse.status !== 0) return 'unpatched'
    for (const [file, expected] of Object.entries(reviewed)) {
      const entry = path.join(target, file)
      assert.equal(fs.existsSync(entry) ? hash(entry) : null, expected, `Drift in ${file}`)
    }
    return 'current'
  }
  const before = detect()
  if (before !== desired) {
    const result = apply(before === 'current')
    assert.equal(result.status, 0, result.stdout + result.stderr)
  }
  assert.equal(detect(), desired)
  return { before, after: desired, patchSha256: hash(current) }
}
