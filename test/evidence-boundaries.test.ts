import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fixture, gitFixture, saveEnv } from './evidence-fixture.ts'

test('base/head changes and unsupported Git storage/config/ref boundaries fail conservatively', async () => {
  const restore = saveEnv()
  try {
    const f = await gitFixture(),
      authority = {
        assertCurrent() {},
        assertSources() {},
        async authorizeGit() {},
      }
    const inspect = new f.g.GitInspection(f.project, authority)
    try {
      await inspect.preflight(f.project)
      const first = await inspect.sample('HEAD')
      const state = f.m.emptyState(f.profile, f.project),
        report = f.m.collectReport(state, f.b, {
          ...first,
          collectionId: 'collection-base',
          requestedWorkspace: f.project,
          repositoryRoot: f.project,
          collectedAt: new Date().toISOString(),
        })
      assert.equal((await inspect.freshness(report)).freshness.isCurrent, true)
      f.git('update-ref', 'refs/heads/base-fixture', 'HEAD')
      const named = await inspect.sample('base-fixture'),
        namedReport = { ...report, ...named, baseReference: 'base-fixture' }
      fs.writeFileSync(path.join(f.project, 'tracked'), 'next\n')
      f.git('add', '.')
      f.git('commit', '-qm', 'next')
      f.git('update-ref', 'refs/heads/base-fixture', 'HEAD')
      assert.equal((await inspect.freshness(namedReport)).freshness.isCurrent, false)
      for (const ref of ['-x', 'HEAD\nsecret', 'HEAD\tsecret', 'HEAD secret'])
        assert.throws(() => f.m.validateBaseRef(ref))
      const alternates = path.join(f.project, '.git/objects/info/alternates')
      fs.writeFileSync(alternates, f.root)
      await assert.rejects(inspect.preflight(f.project), /storage/)
      fs.unlinkSync(alternates)
      for (const key of [
        'filter.fixture.clean',
        'filter.fixture.process',
        'remote.origin.promisor',
        'core.alternateRefsCommand',
      ]) {
        f.git('config', key, 'false')
        await assert.rejects(inspect.preflight(f.project), /filter\/promisor/)
        f.git('config', '--unset', key)
      }
      const refLink = path.join(f.project, '.git/refs/heads/foreign-symlink')
      fs.symlinkSync(path.join(f.project, '.git/HEAD'), refLink)
      await assert.rejects(inspect.preflight(f.project), /metadata/)
      fs.unlinkSync(refLink)
      const admin = path.join(f.project, '.git'),
        moved = path.join(f.root, 'external-git')
      fs.renameSync(admin, moved)
      fs.writeFileSync(admin, `gitdir: ${moved}\n`)
      await assert.rejects(inspect.preflight(f.project), /External Git directory/)
    } finally {
      inspect.close()
    }
  } finally {
    restore()
  }
})
test('actual owned Git cancellation/reap, revocation and output overflow publish no state', async () => {
  const restore = saveEnv()
  try {
    const f = await gitFixture()
    await f.seed()
    const original = fs.readFileSync(f.target)
    fs.writeFileSync(path.join(f.project, 'tracked'), randomBytes(12 * 1024 * 1024).toString('hex'))
    for (const mode of ['cancel', 'revoke', 'overflow'] as const) {
      const controller = new AbortController()
      let revoked = false
      const inspect = new f.g.GitInspection(
        f.project,
        {
          assertSources() {},
          assertCurrent() {
            if (revoked) throw Error('revoked')
          },
          async authorizeGit() {},
        },
        [controller.signal],
      )
      try {
        const operation = inspect.diff([])
        let pid: number | undefined
        if (mode !== 'overflow') {
          const until = Date.now() + 10000
          while (Date.now() < until) {
            const child = [...(inspect as any).children].find((item: any) =>
              item.spawnargs.includes('--binary'),
            ) as any
            if (child) {
              pid = child.pid
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 1))
          }
          assert.ok(pid, 'observed actual owned binary-diff process before cancellation')
          if (mode === 'cancel') controller.abort()
          else revoked = true
        }
        await assert.rejects(operation, mode === 'overflow' ? /bound/ : /cancel|revok/)
        assert.equal((inspect as any).children.size, 0, 'promise settles only after owned close/reap')
        if (pid)
          assert.throws(
            () => process.kill(pid!, 0),
            (error: any) => error.code === 'ESRCH',
          )
        assert.deepEqual(fs.readFileSync(f.target), original)
      } finally {
        inspect.close()
      }
    }
  } finally {
    restore()
  }
})
test('record bounds, retained last20 stale history, opaque references and no raw-patch payload', async () => {
  const restore = saveEnv()
  try {
    const f = await fixture(),
      state = f.m.emptyState(f.profile, f.project)
    f.m.collectReport(state, f.b, f.synthetic())
    for (let index = 1; index <= 50; index++)
      f.m.recordReport(state, f.b, {
        expected_revision: index,
        kind: 'manual',
        result: 'observed',
        summary: `metadata ${index}`,
        reference: 'Goal/Core/C1/opaque-reference-NOT-authority',
        criterion_ids: ['opaque'],
      })
    assert.throws(
      () =>
        f.m.recordReport(state, f.b, {
          expected_revision: 51,
          kind: 'test',
          result: 'passed',
          summary: 'overflow',
        }),
      /bound/,
    )
    const next = f.m.collectReport(state, f.b, {
      ...f.synthetic(),
      collectionId: 'collection-distinct',
    })
    assert.equal(next.records.length, 20)
    assert.equal(next.records[0].summary, 'metadata 31')
    const summary = f.m.reportSummary({
      ...next,
      freshness: {
        isCurrent: true,
        currentHead: next.headCommit,
        reason: 'fixture',
      },
    })
    assert.equal(
      summary.records.every((item: any) => item.stale),
      true,
    )
    assert.equal(summary.goalHandoff.criterionMappings.length, 0)
    assert.throws(
      () =>
        f.m.recordReport(state, f.b, {
          expected_revision: next.revision,
          kind: 'test',
          result: 'passed',
          summary: 'diff --git a/secret b/secret',
        }),
      /raw diff/,
    )
  } finally {
    restore()
  }
})
