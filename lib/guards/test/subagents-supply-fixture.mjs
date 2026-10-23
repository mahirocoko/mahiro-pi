// Normalize only a newly owned public package copy. Unknown/drift supplies fail closed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { gitFixtureEnv } from './git-isolation-fixture.mjs'

export function normalizeSubagentsCopy({ product, supplied, target, ceiling, desired = 'current' }) {
  assert.ok(['unpatched', 'v1', 'v2', 'current'].includes(desired))
  assert.equal(fs.existsSync(target), false, 'target must be a new owned copy')
  const oracle = path.join(product, 'test/oracles/subagents')
  const states = JSON.parse(fs.readFileSync(path.join(oracle, 'states.json'), 'utf8'))
  const v1 = path.join(oracle, 'v1.patch')
  const origin = JSON.parse(fs.readFileSync(path.join(oracle, 'origin.json'), 'utf8'))
  const hash = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  assert.equal(hash(v1), origin.sha256)
  const fixtures = path.join(product, 'lib/guards/test/fixtures')
  const reviewed = JSON.parse(fs.readFileSync(path.join(fixtures, 'subagents-current.json'), 'utf8'))
  // Preserve the historical patch bytes without committing raw diff-context
  // whitespace. Decode only into the newly owned fixture's private directory.
  const encoded = fs.readFileSync(path.join(fixtures, 'subagents-v2.patch.base64'), 'ascii')
  const historical = Buffer.from(encoded, 'base64')
  assert.equal(historical.toString('base64'), encoded.replaceAll('\n', ''), 'Canonical Base64 fixture')
  assert.equal(createHash('sha256').update(historical).digest('hex'), reviewed.historicalPatchSha256)
  const v2 = `${target}.v2.patch`
  for (const name of Object.keys(states)) states[name] = { ...states[name], ...reviewed.historicalExtra }
  states.current = reviewed.current
  const current = path.join(product, 'patches/@gotgenes__pi-subagents@23.4.1.patch')
  const patches = { v1, v2, current }
  fs.cpSync(supplied, target, {
    recursive: true,
    filter: (p) => !p.startsWith(path.join(supplied, 'node_modules')),
  })
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version, '23.4.1')
  const detect = () => {
    const actual = Object.fromEntries(
      Object.keys(states.current)
        .sort()
        .map((n) => [n, fs.existsSync(path.join(target, n)) ? hash(path.join(target, n)) : null]),
    )
    const matches = Object.entries(states).filter(([, expected]) =>
      Object.keys(actual).every((name) => actual[name] === expected[name]),
    )
    assert.equal(matches.length, 1, 'Unknown/drift subagents supply (owned copy only)')
    return matches[0][0]
  }
  const apply = (patch, reverse = false, check = false) => {
    if (patch === v2) {
      if (!fs.existsSync(v2)) fs.writeFileSync(v2, historical, { flag: 'wx', mode: 0o600 })
      assert.equal(hash(v2), reviewed.historicalPatchSha256)
    }
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
    if (before !== 'unpatched') apply(patches[before], true)
    assert.equal(detect(), 'unpatched')
    if (desired !== 'unpatched') apply(patches[desired])
  }
  assert.equal(detect(), desired)
  if (desired !== 'unpatched') apply(patches[desired], true, true)
  return { before, after: desired, patchSha256: hash(current) }
}
