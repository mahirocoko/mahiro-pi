import assert from 'node:assert/strict'
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
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { localMemoryTurn } from '../lib/agent-memory/local/service.ts'
import { localMemoryClaimPath } from '../lib/agent-memory/local/coordination.ts'
import {
  rollbackShadowMigrationUnderClaim,
  shadowMigrationTurn,
} from '../lib/agent-memory/local/migration.ts'
import { runMemoryRehearsal, type RehearsalRequest } from '../lib/agent-memory/local/rehearsal.ts'
import {
  appendRehearsalEvent,
  parseRehearsalRecord,
  rehearsalState,
  type RehearsalQuarantineIdentity,
} from '../lib/agent-memory/local/rehearsal-receipt.ts'

function fixture() {
  const outer = mkdtempSync(join(realpathSync(tmpdir()), 'r6-source-'))
  const parent = join(outer, `mahiro-memory-rehearsal-${randomBytes(8).toString('hex')}`)
  const target = join(parent, 'shadow')
  mkdirSync(parent, { mode: 0o700 })
  mkdirSync(target, { mode: 0o700 })
  const recordPath = join(parent, 'rehearsal.json')
  const request = (command: RehearsalRequest['command']): RehearsalRequest => ({
    command,
    target,
    fixture: 'r6-basic-v1',
    ...(['apply', 'rollback'].includes(command)
      ? (() => {
          const record = parseRehearsalRecord(readFileSync(recordPath, 'utf8'))
          return { operation: record.operation, expect: record.expect }
        })()
      : {}),
  })
  return {
    outer,
    parent,
    target,
    recordPath,
    request,
    run: (command: RehearsalRequest['command']) => runMemoryRehearsal(request(command)),
    close: () => rmSync(outer, { recursive: true, force: true }),
  }
}

test('fixed rehearsal preview → shadow → status → exact quarantine, idempotent across calls', async () => {
  const fx = fixture()
  try {
    const preview = await fx.run('preview')
    assert.equal(preview.disposition, 'previewed')
    assert.deepEqual(readdirSync(fx.target), [])
    assert.deepEqual(await fx.run('preview'), preview)
    const [applied, duplicate] = await Promise.all([fx.run('apply'), fx.run('apply')])
    assert.equal(applied.disposition, 'shadow-verified')
    assert.deepEqual(duplicate, applied)
    assert.equal(JSON.parse(readFileSync(join(fx.target, 'migration.json'), 'utf8')).version, 1)
    const before = readFileSync(fx.recordPath, 'utf8')
    assert.deepEqual(await fx.run('status'), applied)
    assert.equal(readFileSync(fx.recordPath, 'utf8'), before)
    const forgotten = JSON.parse(readFileSync(join(fx.target, 'forgetting.json'), 'utf8'))
    assert.ok(JSON.stringify(forgotten).includes('global/forgotten.md'))
    const quarantined = await fx.run('rollback')
    assert.equal(quarantined.disposition, 'quarantined')
    assert.equal(existsSync(fx.target), false)
    assert.match(quarantined.quarantineId!, /^[a-f0-9]{12}$/)
    assert.equal(existsSync(`${fx.target}.quarantine-${quarantined.quarantineId}`), true)
    assert.equal(JSON.stringify(quarantined).includes(fx.parent), false)
    assert.equal(JSON.stringify(quarantined).includes(fx.target), false)
    assert.deepEqual(await fx.run('status'), quarantined)
    assert.deepEqual(await fx.run('rollback'), quarantined)
    assert.equal((await fx.run('apply')).disposition, 'refused')
    assert.deepEqual(
      quarantined.record!.events.map((event) => event.kind),
      ['previewed', 'applying', 'shadow-verified', 'quarantining', 'quarantined'],
    )
  } finally {
    fx.close()
  }
})

test('terminal replay refuses deleted, replaced or linked quarantine and changed migration identities', async () => {
  for (const change of ['deleted', 'replaced', 'linked', 'owner', 'receipt', 'meta'] as const) {
    const fx = fixture()
    try {
      await fx.run('preview')
      await fx.run('apply')
      const moved = await fx.run('rollback')
      assert.equal(moved.disposition, 'quarantined')
      const quarantine = `${fx.target}.quarantine-${moved.quarantineId}`
      const stored = readFileSync(fx.recordPath, 'utf8')
      const retained = join(fx.parent, 'retained-quarantine')
      if (change === 'deleted') rmSync(quarantine, { recursive: true })
      else if (change === 'replaced' || change === 'linked') {
        renameSync(quarantine, retained)
        if (change === 'replaced') cpSync(retained, quarantine, { recursive: true })
        else symlinkSync(retained, quarantine)
      } else {
        const path = join(
          quarantine,
          change === 'owner' ? 'migration-owner.json' : change === 'receipt' ? 'migration.json' : 'meta.json',
        )
        const value = JSON.parse(readFileSync(path, 'utf8'))
        if (change === 'receipt') value.initialHead = 'b'.repeat(40)
        else value.nonce = '0'.repeat(32)
        writeFileSync(path, JSON.stringify(value))
      }
      for (const command of ['status', 'rollback'] as const) {
        const replay = await fx.run(command)
        assert.ok(['unknown', 'refused'].includes(replay.disposition), `${change}: ${command}`)
        assert.equal(replay.quarantineId, undefined)
        assert.equal(JSON.stringify(replay).includes(fx.parent), false)
        assert.equal(JSON.stringify(replay).includes(fx.target), false)
        assert.equal(readFileSync(fx.recordPath, 'utf8'), stored)
        assert.equal(existsSync(fx.target), false)
        assert.equal(existsSync(localMemoryClaimPath(quarantine)), false)
        if (change === 'deleted') assert.equal(existsSync(quarantine), false)
      }
    } finally {
      fx.close()
    }
  }
})

test('terminal moved evidence rejects malformed identities and binds the verified receipt', async () => {
  const fx = fixture()
  try {
    await fx.run('preview')
    const applied = await fx.run('apply')
    const moved = await fx.run('rollback')
    const identity = moved.record!.events.at(-1)!.evidence as RehearsalQuarantineIdentity
    const pending = appendRehearsalEvent(applied.record!, 'rollback', 'quarantining')
    for (const malformed of [
      identity.suffix,
      { ...identity, suffix: '../escape' },
      { ...identity, dev: 1 },
      { ...identity, ino: null },
      { ...identity, ino: `0${identity.ino}` },
      { ...identity, ino: '0' },
      { ...identity, dev: '99999999999999999999999999999999999' },
      { ...identity, ownerDigest: 'bad' },
      { ...identity, receiptDigest: '0'.repeat(64) },
      { ...identity, absolutePath: fx.target },
    ])
      assert.throws(() =>
        appendRehearsalEvent(pending, 'rollback', 'quarantined', malformed as RehearsalQuarantineIdentity),
      )
    assert.deepEqual(appendRehearsalEvent(pending, 'rollback', 'quarantined', identity), moved.record)
    assert.ok(Buffer.byteLength(JSON.stringify(moved.record)) <= 65536)
    assert.ok(moved.record!.events.length <= 16)
  } finally {
    fx.close()
  }
})

test('cheap falsifier: replaced empty root refuses before owner and keeps reviewed identity', async () => {
  const fx = fixture()
  try {
    const preview = await fx.run('preview')
    const request = fx.request('apply')
    renameSync(fx.target, join(fx.parent, 'retained-A'))
    mkdirSync(fx.target)
    const refused = await runMemoryRehearsal(request)
    assert.equal(refused.disposition, 'refused')
    assert.equal(refused.reason, 'identity')
    assert.deepEqual(readdirSync(fx.target), [])
    assert.deepEqual(refused.record!.plan, preview.record!.plan)
    assert.equal(refused.record!.operation, preview.record!.operation)
    assert.equal(refused.record!.expect, preview.record!.expect)
    assert.equal(rehearsalState(refused.record!), 'previewed')
    assert.deepEqual(await runMemoryRehearsal(request), refused)
  } finally {
    fx.close()
  }
})

test('refused attempts preserve terminal truth; wrong tokens never mutate a target', async () => {
  const fx = fixture()
  try {
    await fx.run('preview')
    const request = { ...fx.request('apply'), expect: '0'.repeat(64) }
    const refused = await runMemoryRehearsal(request)
    assert.equal(refused.disposition, 'refused')
    assert.deepEqual(readdirSync(fx.target), [])
    assert.equal(rehearsalState(refused.record!), 'previewed')
    const shadow = await fx.run('apply')
    const badRollback = await runMemoryRehearsal({ ...fx.request('rollback'), operation: '0'.repeat(32) })
    assert.equal(badRollback.disposition, 'refused')
    assert.equal(rehearsalState(badRollback.record!), 'shadow-verified')
    assert.equal(
      badRollback.record!.events.find((event) => event.kind === 'shadow-verified')!.digest,
      shadow.record!.events.at(-1)!.digest,
    )
    assert.equal(existsSync(fx.target), true)
    assert.equal((await fx.run('rollback')).disposition, 'quarantined')
  } finally {
    fx.close()
  }
})

test('intent boundaries and post-rename interruption remain unknown, never inferred success', async () => {
  for (const stopAfter of ['applying', 'shadow', 'quarantining', 'renamed'] as const) {
    const fx = fixture()
    try {
      await fx.run('preview')
      const rollback = ['quarantining', 'renamed'].includes(stopAfter)
      if (rollback) await fx.run('apply')
      const command = rollback ? 'rollback' : 'apply'
      const interrupted = await runMemoryRehearsal(fx.request(command), { stopAfter })
      assert.equal(interrupted.disposition, 'unknown', stopAfter)
      const stored = readFileSync(fx.recordPath, 'utf8')
      const record = parseRehearsalRecord(stored)
      assert.equal(rehearsalState(record), rollback ? 'quarantining' : 'applying')
      assert.equal(record.events.at(-1)!.kind, 'unknown')
      assert.equal((await fx.run('status')).disposition, 'unknown')
      assert.equal((await fx.run(command)).disposition, 'unknown')
      assert.equal(readFileSync(fx.recordPath, 'utf8'), stored)
      if (stopAfter === 'renamed') {
        assert.equal(existsSync(fx.target), false)
        assert.ok(readdirSync(fx.parent).some((name) => name.startsWith('shadow.quarantine-')))
      }
    } finally {
      fx.close()
    }
  }
})

test('retained claims block takeover; status and mutation neither clear claims nor update review', async () => {
  const fx = fixture()
  try {
    await fx.run('preview')
    const stored = readFileSync(fx.recordPath, 'utf8')
    writeFileSync(localMemoryClaimPath(fx.target), 'uncertain retained claim\n')
    for (const command of ['preview', 'apply', 'status', 'rollback'] as const) {
      assert.equal((await fx.run(command)).disposition, 'unknown')
      assert.equal(readFileSync(fx.recordPath, 'utf8'), stored)
      assert.equal(readFileSync(localMemoryClaimPath(fx.target), 'utf8'), 'uncertain retained claim\n')
    }
    assert.deepEqual(readdirSync(fx.target), [])
  } finally {
    fx.close()
  }
})

test('receipt digest, shape, event order, chain and bounds refuse tampering', async () => {
  const fx = fixture()
  try {
    const preview = await fx.run('preview')
    const record = preview.record!
    assert.throws(() => parseRehearsalRecord(JSON.stringify({ ...record, text: 'not allowed' })))
    assert.throws(() => parseRehearsalRecord(JSON.stringify({ ...record, operation: '0'.repeat(32) })))
    assert.throws(() => appendRehearsalEvent(record, 'rollback', 'quarantined', 'a'.repeat(12)))
    assert.throws(() => appendRehearsalEvent(record, 'apply', 'applying', 'raw exception'))
    assert.throws(() => parseRehearsalRecord(`${' '.repeat(65536)}${JSON.stringify(record)}`))
    let bounded = record
    for (let i = 1; i < 16; i += 1) bounded = appendRehearsalEvent(bounded, 'apply', 'refused')
    assert.throws(() => appendRehearsalEvent(bounded, 'apply', 'refused'))
    writeFileSync(fx.recordPath, JSON.stringify(bounded))
    assert.equal((await fx.run('apply')).disposition, 'refused')
    assert.deepEqual(readdirSync(fx.target), [])
    const request = fx.request('apply')
    writeFileSync(fx.recordPath, JSON.stringify({ ...record, checksum: '0'.repeat(64) }))
    const bytes = readFileSync(fx.recordPath, 'utf8')
    assert.equal((await runMemoryRehearsal(request)).disposition, 'unknown')
    assert.equal(readFileSync(fx.recordPath, 'utf8'), bytes)
  } finally {
    fx.close()
  }
})

test('mutation checks reviewed migration receipt before quarantine intent', async () => {
  const fx = fixture()
  try {
    await fx.run('preview')
    await fx.run('apply')
    const path = join(fx.target, 'migration.json')
    const receipt = JSON.parse(readFileSync(path, 'utf8'))
    receipt.rollback.serviceNonce = '0'.repeat(32)
    writeFileSync(path, JSON.stringify(receipt))
    assert.equal((await fx.run('status')).disposition, 'unknown')
    const refused = await fx.run('rollback')
    assert.equal(refused.disposition, 'refused')
    assert.equal(rehearsalState(refused.record!), 'shadow-verified')
    assert.equal(existsSync(fx.target), true)
  } finally {
    fx.close()
  }
})

test('empty canonical dedicated disposable target only; no arbitrary, linked, or nonempty adoption', async () => {
  const fx = fixture()
  try {
    writeFileSync(join(fx.target, 'unrelated'), 'keep')
    assert.equal((await fx.run('preview')).disposition, 'refused')
    assert.equal(existsSync(fx.recordPath), false)
    rmSync(join(fx.target, 'unrelated'))
    const other = join(fx.outer, 'private-shadow')
    mkdirSync(other)
    assert.equal(
      (await runMemoryRehearsal({ ...fx.request('preview'), target: other })).disposition,
      'unknown',
    )
    const linked = join(fx.parent, 'link')
    symlinkSync(fx.target, linked)
    assert.equal(
      (await runMemoryRehearsal({ ...fx.request('preview'), target: linked })).disposition,
      'unknown',
    )
    assert.equal(
      (await runMemoryRehearsal({ ...fx.request('preview'), target: `${fx.target}/../shadow` })).disposition,
      'unknown',
    )
    assert.deepEqual(readdirSync(fx.target), [])
  } finally {
    fx.close()
  }
})

test('under-claim helpers reject a service-only claim and recursive migration turns', async () => {
  const fx = fixture()
  try {
    await localMemoryTurn(fx.target, async (claim) => {
      await assert.rejects(
        () => rollbackShadowMigrationUnderClaim(fx.target, claim),
        /migration claim required/,
      )
    })
    await shadowMigrationTurn(fx.target, async () => {
      await assert.rejects(() => shadowMigrationTurn(fx.target, async () => {}), /recursive claim refused/)
    })
    assert.deepEqual(readdirSync(fx.target), [])
  } finally {
    fx.close()
  }
})
