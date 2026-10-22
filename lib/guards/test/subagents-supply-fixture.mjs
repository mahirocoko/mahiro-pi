// Normalize only a newly owned public package copy. Unknown/drift supplies fail closed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { gitFixtureEnv } from './git-isolation-fixture.mjs'

export function normalizeSubagentsCopy({ product, supplied, target, ceiling, desired = 'v2' }) {
  assert.ok(['unpatched', 'v1', 'v2'].includes(desired))
  assert.equal(fs.existsSync(target), false, 'target must be a new owned copy')
  const oracle = path.join(product, 'test/oracles/subagents')
  const states = JSON.parse(fs.readFileSync(path.join(oracle, 'states.json'), 'utf8'))
  const v1 = path.join(oracle, 'v1.patch')
  const origin = JSON.parse(fs.readFileSync(path.join(oracle, 'origin.json'), 'utf8'))
  const hash = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  assert.equal(hash(v1), origin.sha256)
  const v2 = path.join(product, 'patches/@gotgenes__pi-subagents@23.4.1.patch')
  fs.cpSync(supplied, target, {
    recursive: true,
    filter: (p) => !p.startsWith(path.join(supplied, 'node_modules')),
  })
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version, '23.4.1')
  const detect = () => {
    const actual = Object.fromEntries(
      Object.keys(states.v2).map((n) => [
        n,
        fs.existsSync(path.join(target, n)) ? hash(path.join(target, n)) : null,
      ]),
    )
    const matches = Object.entries(states).filter(
      ([, expected]) => JSON.stringify(actual) === JSON.stringify(expected),
    )
    assert.equal(matches.length, 1, 'Unknown/drift subagents supply (owned copy only)')
    return matches[0][0]
  }
  const apply = (patch, reverse = false, check = false) => {
    const result = spawnSync(
      'git',
      ['apply', ...(reverse ? ['--reverse'] : []), ...(check ? ['--check'] : []), patch],
      {
        cwd: target,
        encoding: 'utf8',
        env: gitFixtureEnv(ceiling),
      },
    )
    assert.equal(result.status, 0, result.stdout + result.stderr)
  }
  const before = detect()
  if (before !== desired) {
    if (before !== 'unpatched') apply(before === 'v1' ? v1 : v2, true)
    assert.equal(detect(), 'unpatched')
    if (desired !== 'unpatched') apply(desired === 'v1' ? v1 : v2)
  }
  assert.equal(detect(), desired)
  if (desired !== 'unpatched') apply(desired === 'v1' ? v1 : v2, true, true)
  return { before, after: desired, patchSha256: hash(v2) }
}
