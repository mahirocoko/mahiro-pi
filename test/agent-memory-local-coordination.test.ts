import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { localMemoryClaimPath, withLocalMemoryClaim } from '../lib/agent-memory/local/coordination.ts'
import { createSyntheticLocalMemoryService, type LocalWorker } from '../lib/agent-memory/local/service.ts'
import { createMaintenanceWorkspace } from '../lib/agent-memory/local/workspace.ts'
import { rollbackShadowMigration } from '../lib/agent-memory/local/migration.ts'

function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'local-claim-'))
  const root = join(dir, 'state')
  mkdirSync(root)
  return { dir, root, close: () => rmSync(dir, { recursive: true, force: true }) }
}
function child(root: string, mode: string) {
  const process = fork(new URL('./fixtures/local-coordination-child.ts', import.meta.url), [root, mode], {
    execArgv: [],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  const messages: { type: string; message?: string }[] = []
  process.on('message', (message) => messages.push(message as (typeof messages)[number]))
  const next = async () => {
    if (!messages.length) await once(process, 'message')
    return messages.shift()!
  }
  return { process, next }
}
const options = (stateRoot: string, worker: LocalWorker = () => {}) => ({
  stateRoot,
  worker,
  initialFiles: { 'Core.md': 'base\n', 'index.md': 'index\n' },
})

test('competing process cannot initialize or reconcile a held root; distinct roots proceed', {
  timeout: 15000,
}, async () => {
  const fx = fixture()
  const holder = child(fx.root, 'worker')
  try {
    assert.equal((await holder.next()).type, 'ready')
    const running = readFileSync(join(fx.root, 'jobs/job.json'), 'utf8')
    const contender = child(fx.root, 'probe')
    const exit = once(contender.process, 'exit')
    assert.match((await contender.next()).message!, /claim blocked/)
    await exit
    await assert.rejects(createSyntheticLocalMemoryService(options(fx.root)), /claim blocked/)
    await assert.rejects(rollbackShadowMigration(fx.root), /claim blocked/)
    assert.equal(readFileSync(join(fx.root, 'jobs/job.json'), 'utf8'), running)
    const other = join(fx.dir, 'other')
    mkdirSync(other)
    const independent = await createSyntheticLocalMemoryService(options(other))
    assert.equal((await independent.enqueue({ id: 'separate', summary: 'independent' })).sequence, 1)
    const finished = once(holder.process, 'exit')
    holder.process.send('continue')
    assert.equal((await holder.next()).type, 'done')
    await finished
    assert.equal(existsSync(localMemoryClaimPath(fx.root)), false)
    const reopened = await createSyntheticLocalMemoryService(options(fx.root))
    assert.equal((await reopened.job('job')).status, 'committed')
    assert.equal((await reopened.enqueue({ id: 'later', summary: 'later' })).sequence, 2)
  } finally {
    holder.process.kill('SIGKILL')
    fx.close()
  }
})

test('partial and dead-owner claims are never stolen', { timeout: 15000 }, async () => {
  const fx = fixture()
  try {
    const path = localMemoryClaimPath(fx.root)
    writeFileSync(path, '')
    await assert.rejects(createSyntheticLocalMemoryService(options(fx.root)), /claim blocked/)
    assert.equal(readFileSync(path, 'utf8'), '')
    rmSync(path) // Only this synthetic fixture's exact partial claim.
    const holder = child(fx.root, 'claim')
    assert.equal((await holder.next()).type, 'ready')
    const record = readFileSync(path, 'utf8')
    const exited = once(holder.process, 'exit')
    holder.process.kill('SIGKILL')
    await exited
    await assert.rejects(createSyntheticLocalMemoryService(options(fx.root)), /claim blocked/)
    assert.equal(readFileSync(path, 'utf8'), record)
  } finally {
    fx.close()
  }
})

test('retained worker write is revoked and recursive service turns refuse without deadlock', async () => {
  const fx = fixture()
  let retained: Parameters<LocalWorker>[0] | undefined
  try {
    const service = await createSyntheticLocalMemoryService(
      options(fx.root, async (ctx) => {
        retained = ctx
        assert.equal('worktreeRoot' in ctx, false)
        await assert.rejects(service.head(), /recursive claim/)
        ctx.write('note.md', 'valid\n')
      }),
    )
    await service.enqueue({ id: 'one', summary: 'one' })
    const job = await service.start('one')
    assert.throws(() => retained!.write('note.md', 'escaped\n'), /revoked/)
    assert.equal(readFileSync(join(job.worktreePath!, 'note.md'), 'utf8'), 'valid\n')
    assert.equal(existsSync(localMemoryClaimPath(fx.root)), false)
  } finally {
    fx.close()
  }
})

test('every maintenance method checks capability before filesystem access', () => {
  let checks = 0
  const workspace = createMaintenanceWorkspace(
    '/does-not-exist',
    { reserve() {}, remember() {} },
    undefined,
    () => {
      checks += 1
      throw Error('revoked')
    },
  )
  const calls = [
    () => workspace.read('x'),
    () => workspace.list(),
    () => workspace.search('x'),
    () => workspace.write('x', 'x'),
    () => workspace.edit('x', 'x', 'y'),
    () => workspace.delete('x'),
    () => workspace.rename('x', 'y'),
  ]
  for (const call of calls) assert.throws(call, /revoked/)
  assert.equal(checks, 7)
})

test('root replacement during callback poisons the original sibling claim', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService(
      options(fx.root, (ctx) => {
        renameSync(fx.root, join(fx.dir, 'held'))
        mkdirSync(fx.root)
        assert.throws(() => ctx.write('note.md', 'escaped'), /identity refused/)
      }),
    )
    await service.enqueue({ id: 'one', summary: 'one' })
    await assert.rejects(service.start('one'), /claim blocked|identity refused/)
    assert.equal(existsSync(localMemoryClaimPath(fx.root)), true)
    assert.equal(existsSync(join(fx.root, 'note.md')), false)
    await assert.rejects(createSyntheticLocalMemoryService(options(fx.root)), /claim blocked/)
  } finally {
    fx.close()
  }
})

test('pinned handle rejects a changed v1 meta nonce and retains claim', async () => {
  const fx = fixture()
  try {
    const service = await createSyntheticLocalMemoryService(options(fx.root))
    const path = join(fx.root, 'meta.json')
    const meta = JSON.parse(readFileSync(path, 'utf8'))
    meta.nonce = 'a'.repeat(32)
    writeFileSync(path, JSON.stringify(meta))
    await assert.rejects(service.head(), /repository refused/)
    assert.equal(existsSync(localMemoryClaimPath(fx.root)), true)
  } finally {
    fx.close()
  }
})

test('rollback quiescence excludes competing process until rename and original claim release', {
  timeout: 15000,
}, async () => {
  const fx = fixture()
  const identity = lstatSync(fx.root)
  writeFileSync(
    join(fx.root, 'migration-owner.json'),
    JSON.stringify({
      version: 1,
      nonce: 'a'.repeat(32),
      exportDigest: 'b'.repeat(64),
      dev: String(identity.dev),
      ino: String(identity.ino),
    }),
  )
  const holder = child(fx.root, 'rollback')
  try {
    assert.equal((await holder.next()).type, 'ready')
    const contender = child(fx.root, 'probe')
    const exited = once(contender.process, 'exit')
    assert.match((await contender.next()).message!, /claim blocked/)
    await exited
    const done = once(holder.process, 'exit')
    holder.process.send('continue')
    assert.equal((await holder.next()).type, 'done')
    await done
    assert.equal(existsSync(fx.root), false)
    assert.equal(existsSync(`${fx.root}.quarantine-${'a'.repeat(12)}`), true)
    assert.equal(existsSync(localMemoryClaimPath(fx.root)), false)
  } finally {
    holder.process.kill('SIGKILL')
    fx.close()
  }
})

test('renamed root releases the original sibling claim, not a quarantine sibling', async () => {
  const fx = fixture()
  try {
    const moved = join(fx.dir, 'quarantine')
    await withLocalMemoryClaim(fx.root, 'synthetic rename', async (claim) => {
      renameSync(fx.root, moved)
      claim.movedTo(moved)
      assert.equal(existsSync(localMemoryClaimPath(fx.root)), true)
      await assert.rejects(
        withLocalMemoryClaim(moved, 'recursive', async () => {}),
        /recursive/,
      )
    })
    assert.equal(existsSync(localMemoryClaimPath(fx.root)), false)
    assert.equal(existsSync(localMemoryClaimPath(moved)), false)
  } finally {
    fx.close()
  }
})
