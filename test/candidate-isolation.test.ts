import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  cleanupStateFixtures,
  createStateFixture,
  measureState,
  stateRoot,
  STATE_MAX_BYTES,
  STATE_ROOT_ENV,
} from '../test-state.mjs'
import { stageBootstrapCandidate } from './bootstrap-candidate-fixture.ts'
import { stagePermissionFixture, productRoot } from '../lib/guards/test/permission-patch-fixture.mjs'

test('package-only candidate preview needs no skills supply and rejects opaque owner identities before writes', async () => {
  const candidate = await stageBootstrapCandidate()
  assert.equal(fs.existsSync(path.join(candidate.root, 'mahiro-skills')), false)
  const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'mh-owner-'))
  try {
    const agentDir = path.join(root, 'profile')
    fs.mkdirSync(agentDir, { mode: 0o700 })
    const opaque = path.join(agentDir, 'opaque')
    fs.mkdirSync(opaque, { mode: 0o700 })
    const settings = path.join(agentDir, 'settings.json')
    const request = {
      version: 1,
      agentDir,
      sources: { pi: candidate.primary },
      dependencyModules: candidate.modules,
      components: { packages: true },
    }
    for (const name of [
      '@mahirocoko/pi-guards',
      '@gotgenes/pi-permission-system',
      '@gotgenes/pi-subagents',
      '@mahirocoko/mahiro-pi',
      'unrelated-local-tools',
    ]) {
      fs.writeFileSync(
        path.join(opaque, 'package.json'),
        JSON.stringify({
          name,
          pi: { extensions: ['./must-not-execute.mjs'] },
        }),
      )
      fs.writeFileSync(
        path.join(opaque, 'must-not-execute.mjs'),
        'throw Error("Package code must never execute");',
      )
      for (const entry of ['./opaque', opaque, { source: './opaque' }, { source: opaque, extensions: [] }]) {
        fs.writeFileSync(settings, JSON.stringify({ packages: [entry] }), {
          mode: 0o600,
        })
        const before = fs.readFileSync(settings)
        if (name === 'unrelated-local-tools') {
          const plan = candidate.bootstrap.inspectBootstrap(request)
          const change = plan.changes.find((item: any) => item.path === settings)
          assert.deepEqual(JSON.parse(change.next).packages[0], entry)
        } else {
          assert.throws(() => candidate.bootstrap.inspectBootstrap(request), /Conflicting package source/)
        }
        assert.deepEqual(fs.readFileSync(settings), before)
        assert.deepEqual(fs.readdirSync(agentDir).sort(), ['opaque', 'settings.json'])
      }
    }
    assert.equal(fs.existsSync(path.join(candidate.root, 'mahiro-skills')), false)
  } finally {
    candidate.cleanup()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('candidate12 is staged only in owned copies; copied patch owner supports both supply states', () => {
  const manifest = path.join(productRoot, 'package.json')
  const before = fs.readFileSync(manifest)
  const declaration = JSON.parse(
    fs.readFileSync(path.join(productRoot, 'test/candidate-extensions.json'), 'utf8'),
  )
  const hashes = new Map()
  for (const supplyState of [false, true]) {
    for (const patched of [false, true]) {
      const fixture = stagePermissionFixture({
        patched,
        supplyState,
        evidenceBase: path.join(productRoot, '.agent-state/runtime/candidate-isolation/matrix'),
      })
      try {
        assert.deepEqual(
          JSON.parse(fs.readFileSync(path.join(fixture.primary, 'package.json'), 'utf8')).pi.extensions,
          declaration.candidate,
        )
        assert.equal(fixture.attestation.suppliedPatched, supplyState)
        assert.equal(fixture.attestation.patched, patched)
        assert.ok(Object.keys(fixture.attestation.hashes).length > 0)
        if (hashes.has(patched)) assert.deepEqual(fixture.attestation.hashes, hashes.get(patched))
        hashes.set(patched, fixture.attestation.hashes)
        assert.deepEqual(fs.readFileSync(manifest), before)
      } finally {
        fixture.cleanup()
        fixture.cleanup()
        assert.equal(fs.existsSync(fixture.root), false)
      }
    }
  }
  assert.deepEqual(JSON.parse(before.toString()).pi.extensions, declaration.active)
  assert.notDeepEqual(hashes.get(true), hashes.get(false))

  const failedBase = path.join(productRoot, '.agent-state/runtime/candidate-isolation/failure-cleanup')
  fs.mkdirSync(failedBase, { recursive: true })
  const failedBefore = fs.readdirSync(failedBase)
  assert.throws(() =>
    stagePermissionFixture({
      evidenceBase: failedBase,
      subagentsState: 'unsupported',
    }),
  )
  assert.deepEqual(fs.readdirSync(failedBase), failedBefore)
})

test('state accounting is bounded, does not follow links, and cleans only exact owned roots', () => {
  const bound = stateRoot(productRoot)
  const fixture = createStateFixture(productRoot, path.join(bound, 'runtime/state-budget-test'), 'owned-')
  const sibling = createStateFixture(productRoot, path.join(bound, 'runtime/state-budget-test'), 'sibling-')
  try {
    fs.writeFileSync(path.join(fixture.root, 'bytes'), '12345678')
    const before = measureState(fixture.root)
    fs.symlinkSync(productRoot, path.join(fixture.root, 'external'))
    const after = measureState(fixture.root)
    assert.equal(after.entries, before.entries + 1)
    assert.equal(after.bytes, fs.lstatSync(fixture.root).size + 8 + Buffer.byteLength(productRoot))
    assert.throws(() => measureState(fixture.root, { maxBytes: after.bytes }), /byte budget/)
    assert.throws(() => measureState(fixture.root, { maxEntries: 1 }), /entry budget/)
    assert.throws(() => createStateFixture(productRoot, path.dirname(bound), 'bad-'), /bound state/)
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { stateRoot } from ${JSON.stringify(path.join(productRoot, 'test-state.mjs'))}
      console.log(stateRoot(${JSON.stringify(fixture.root)}))
    `,
      ],
      { encoding: 'utf8', env: { ...process.env, [STATE_ROOT_ENV]: bound } },
    )
    assert.equal(child.status, 0, child.stderr)
    assert.equal(child.stdout.trim(), bound)
    const exitChild = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { createStateFixture } from ${JSON.stringify(path.join(productRoot, 'test-state.mjs'))}
      const fixture = createStateFixture(
        ${JSON.stringify(productRoot)},
        ${JSON.stringify(path.join(bound, 'runtime/state-budget-exit'))},
        'child-'
      )
      console.log(fixture.root)
    `,
      ],
      { encoding: 'utf8', env: { ...process.env, [STATE_ROOT_ENV]: bound } },
    )
    assert.equal(exitChild.status, 0, exitChild.stderr)
    assert.equal(fs.existsSync(exitChild.stdout.trim()), false)
    const previous = process.env[STATE_ROOT_ENV]
    try {
      process.env[STATE_ROOT_ENV] = path.join(fixture.root, 'not-state')
      assert.throws(() => stateRoot(productRoot), /identity/)
    } finally {
      if (previous === undefined) delete process.env[STATE_ROOT_ENV]
      else process.env[STATE_ROOT_ENV] = previous
    }
    const moved = `${fixture.root}-moved`
    fs.renameSync(fixture.root, moved)
    try {
      fs.symlinkSync(sibling.root, fixture.root)
      assert.throws(() => fixture.cleanup(), /identity changed/)
      assert.equal(fs.existsSync(sibling.root), true)
    } finally {
      fs.unlinkSync(fixture.root)
      fs.renameSync(moved, fixture.root)
    }
    fixture.cleanup()
    fixture.cleanup()
    assert.equal(fs.existsSync(fixture.root), false)
    assert.equal(fs.existsSync(sibling.root), true)

    const oversized = createStateFixture(
      productRoot,
      path.join(bound, 'runtime/state-budget-test'),
      'oversized-',
    )
    const sparse = path.join(oversized.root, 'sparse')
    fs.writeFileSync(sparse, '')
    fs.truncateSync(sparse, STATE_MAX_BYTES)
    assert.throws(() => cleanupStateFixtures(productRoot, [oversized]), /byte budget/)
    assert.equal(fs.existsSync(oversized.root), false)
  } finally {
    fixture.cleanup()
    sibling.cleanup()
  }
})
