import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

function fixture() {
  const outer = mkdtempSync(join(realpathSync(tmpdir()), 'r6-cli-'))
  const parent = join(outer, `mahiro-memory-rehearsal-${randomBytes(8).toString('hex')}`)
  const target = join(parent, 'shadow')
  mkdirSync(parent)
  mkdirSync(target)
  const base = ['--target', target, '--fixture', 'r6-basic-v1']
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['memory-rehearsal.mjs', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 131072,
    })
  return { outer, parent, target, base, run, close: () => rmSync(outer, { recursive: true, force: true }) }
}

test('CLI process-restart journey uses exact reviewed operation; no target writes during preview', () => {
  const fx = fixture()
  try {
    const preview = fx.run('preview', ...fx.base)
    assert.equal(preview.status, 0, preview.stderr)
    const review = JSON.parse(preview.stdout)
    assert.equal(review.scope, 'fixed-synthetic-disconnected')
    assert.deepEqual(readdirSync(fx.target), [])
    const mutation = [...fx.base, '--operation', review.record.operation, '--expect', review.record.expect]
    const apply = fx.run('apply', ...mutation)
    assert.equal(apply.status, 0, apply.stdout + apply.stderr)
    assert.equal(JSON.parse(apply.stdout).disposition, 'shadow-verified')
    assert.equal(fx.run('apply', ...mutation).stdout, apply.stdout)
    const status = fx.run('status', ...fx.base)
    assert.equal(status.status, 0)
    assert.equal(status.stdout, apply.stdout)
    const rollback = fx.run('rollback', ...mutation)
    assert.equal(rollback.status, 0, rollback.stdout + rollback.stderr)
    const moved = JSON.parse(rollback.stdout)
    assert.equal(moved.disposition, 'quarantined')
    assert.match(moved.quarantineId, /^[a-f0-9]{12}$/)
    assert.equal(moved.quarantined, undefined)
    assert.equal(existsSync(fx.target), false)
    const replay = fx.run('rollback', ...mutation)
    const terminalStatus = fx.run('status', ...fx.base)
    assert.equal(replay.stdout, rollback.stdout)
    assert.equal(terminalStatus.stdout, rollback.stdout)
    for (const output of [preview, apply, status, rollback, replay, terminalStatus]) {
      assert.equal(output.stdout.includes(fx.target), false)
      assert.equal(output.stdout.includes(fx.parent), false)
      assert.equal(output.stderr.includes(fx.parent), false)
    }
    const record = readFileSync(join(fx.parent, 'rehearsal.json'), 'utf8')
    assert.ok(Buffer.byteLength(record) <= 65536)
    assert.equal(JSON.parse(record).events.length, 5)
    for (const forbidden of [
      'Synthetic rehearsal',
      'Synthetic excluded example',
      'prompt',
      'credential',
      'transcript',
    ])
      assert.equal(record.includes(forbidden), false)
  } finally {
    fx.close()
  }
})

test('CLI terminal replay rejects deleted, replaced and symlink quarantines without leaking absolute paths', () => {
  for (const change of ['deleted', 'replaced', 'linked'] as const) {
    const fx = fixture()
    try {
      const preview = JSON.parse(fx.run('preview', ...fx.base).stdout)
      const mutation = [
        ...fx.base,
        '--operation',
        preview.record.operation,
        '--expect',
        preview.record.expect,
      ]
      assert.equal(fx.run('apply', ...mutation).status, 0)
      const rollback = fx.run('rollback', ...mutation)
      assert.equal(rollback.status, 0)
      const quarantine = `${fx.target}.quarantine-${JSON.parse(rollback.stdout).quarantineId}`
      const stored = readFileSync(join(fx.parent, 'rehearsal.json'), 'utf8')
      if (change === 'deleted') rmSync(quarantine, { recursive: true })
      else {
        const retained = join(fx.parent, 'retained-quarantine')
        renameSync(quarantine, retained)
        if (change === 'replaced') cpSync(retained, quarantine, { recursive: true })
        else symlinkSync(retained, quarantine)
      }
      for (const args of [
        ['status', ...fx.base],
        ['rollback', ...mutation],
      ]) {
        const replay = fx.run(...args)
        assert.equal(replay.status, 1, `${change}: ${args[0]}`)
        const result = JSON.parse(replay.stdout)
        assert.ok(['unknown', 'refused'].includes(result.disposition))
        assert.equal(result.quarantineId, undefined)
        assert.equal(replay.stdout.includes(fx.parent), false)
        assert.equal(replay.stdout.includes(fx.target), false)
        assert.equal(replay.stdout.includes(quarantine), false)
        assert.equal(replay.stderr.includes(fx.parent), false)
        assert.equal(readFileSync(join(fx.parent, 'rehearsal.json'), 'utf8'), stored)
        assert.equal(existsSync(fx.target), false)
      }
    } finally {
      fx.close()
    }
  }
})

test('CLI refuses replaced target before owner creation and does not rewrite reviewed identity', () => {
  const fx = fixture()
  try {
    const preview = JSON.parse(fx.run('preview', ...fx.base).stdout)
    renameSync(fx.target, join(fx.parent, 'retained-A'))
    mkdirSync(fx.target)
    const apply = fx.run(
      'apply',
      ...fx.base,
      '--operation',
      preview.record.operation,
      '--expect',
      preview.record.expect,
    )
    assert.equal(apply.status, 1)
    const refused = JSON.parse(apply.stdout)
    assert.equal(refused.disposition, 'refused')
    assert.deepEqual(refused.record.plan, preview.record.plan)
    assert.deepEqual(readdirSync(fx.target), [])
    assert.equal(existsSync(join(fx.target, 'migration-owner.json')), false)
  } finally {
    fx.close()
  }
})

test('CLI strict grammar: unknown/duplicate/missing flags and alternate authorities are usage errors', () => {
  const fx = fixture()
  try {
    const cases = [
      [],
      ['unknown', ...fx.base],
      ['preview'],
      ['preview', ...fx.base, '--target', fx.target],
      ['preview', ...fx.base, '--source-root', fx.outer],
      ['preview', ...fx.base, '--agent-dir', fx.outer],
      ['preview', ...fx.base, '--bundle', 'content.json'],
      ['preview', ...fx.base, '--url', 'https://invalid.example'],
      ['preview', ...fx.base, '--provider', 'none'],
      ['preview', ...fx.base, '--shell', 'false'],
      ['preview', ...fx.base, '--operation', 'a'.repeat(32)],
      ['status', ...fx.base, '--expect', 'b'.repeat(64)],
      ['apply', ...fx.base],
      ['rollback', ...fx.base, '--operation', 'a'.repeat(32), '--expect', 'bad'],
      ['preview', '--target', fx.target, '--fixture', 'other'],
      ['preview', ...fx.base, '--fixture'],
      ['preview', `--target=${fx.target}`, '--fixture', 'r6-basic-v1'],
    ]
    for (const args of cases) {
      const run = fx.run(...args)
      assert.equal(run.status, 2, JSON.stringify(args))
      assert.equal(run.stdout, '')
      assert.match(run.stderr, /^Usage:/)
      assert.deepEqual(readdirSync(fx.target), [])
      assert.equal(existsSync(join(fx.parent, 'rehearsal.json')), false)
    }
  } finally {
    fx.close()
  }
})
