import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const base = path.resolve('.agent-state/runtime/goal-port/repair')
fs.mkdirSync(base, { recursive: true, mode: 0o700 })
for (const attack of [
  'symlink',
  'hardlink',
  'mode',
  'bytes',
  'cancel-replaced',
  'target-identity',
  'lock-replaced',
  'continuation-cancel',
] as const) {
  test(`precommit ${attack}: preserve previous canonical bytes; cleanup only owned temp`, async () => {
    const saved = process.env.PI_CODING_AGENT_DIR
    try {
      const root = fs.mkdtempSync(path.join(base, `temp-${attack}-`))
      const primary = path.join(root, 'primary'),
        profile = path.join(root, 'profile'),
        project = path.join(root, 'project')
      for (const dir of [primary, profile, project]) fs.mkdirSync(dir, { mode: 0o700 })
      fs.cpSync(path.resolve('lib'), path.join(primary, 'lib'), {
        recursive: true,
      })
      const config = path.join(profile, 'extensions/mahiro-goal/config.json')
      fs.mkdirSync(path.dirname(config), { recursive: true, mode: 0o700 })
      fs.writeFileSync(config, JSON.stringify({ version: 1, profile, projects: [project] }), { mode: 0o600 })
      process.env.PI_CODING_AGENT_DIR = profile
      const s = await import(pathToFileURL(path.join(primary, 'lib/goal/store.ts')).href)
      const m = await import(pathToFileURL(path.join(primary, 'lib/goal/model.ts')).href)
      const b = {
        ...s.resolveGoalBinding(project),
        sessionId: 'fixture-native-session',
      }
      await s.transactGoal(
        b,
        s.stateTicket(s.readGoalState(b)),
        () => {},
        (state: any) =>
          m.applyGoal(state, b, 'create', {
            objective: 'Isolated integrity fixture',
            criteria: [{ text: 'proof' }],
          }),
      )
      const target = path.join(b.root, 'state.json'),
        before = fs.readFileSync(target)
      const foreign = path.join(root, 'foreign')
      fs.writeFileSync(foreign, 'FOREIGN UNVALIDATED BYTES', { mode: 0o600 })
      let calls = 0,
        temp = '',
        continuationCancelled = false
      const mutation = s.transactGoal(
        b,
        s.stateTicket(s.readGoalState(b)),
        () => {
          if (++calls !== 2) return
          temp = path.join(b.root, fs.readdirSync(b.root).find((name: string) => name.endsWith('.tmp'))!)
          if (attack === 'symlink' || attack === 'cancel-replaced') {
            fs.unlinkSync(temp)
            fs.symlinkSync(foreign, temp)
          } else if (attack === 'hardlink') {
            fs.unlinkSync(temp)
            fs.linkSync(foreign, temp)
          } else if (attack === 'mode') fs.chmodSync(temp, 0o644)
          else if (attack === 'target-identity') {
            fs.unlinkSync(target)
            fs.writeFileSync(target, before, { mode: 0o600 })
          } else if (attack === 'lock-replaced') {
            const lock = path.join(b.root, 'state.lock')
            fs.unlinkSync(lock)
            fs.writeFileSync(lock, JSON.stringify({ token: 'foreign-lock', pid: process.pid }), {
              mode: 0o600,
            })
          } else if (attack === 'continuation-cancel')
            queueMicrotask(() => {
              continuationCancelled = true
            })
          else fs.writeFileSync(temp, 'INVALID JSON')
          if (attack === 'cancel-replaced') throw new Error('cancel after foreign replacement')
        },
        (state: any) =>
          m.applyGoal(state, b, 'update', {
            action: 'set_phase',
            expected_revision: 1,
            phase: 'must not commit',
          }),
        () => {
          if (continuationCancelled) throw new Error('cancelled in final continuation')
        },
      )
      await assert.rejects(mutation)
      assert.deepEqual(fs.readFileSync(target), before)
      assert.equal(m.goalAt(s.readGoalState(b), b).revision, 1)
      assert.equal(fs.readFileSync(foreign, 'utf8'), 'FOREIGN UNVALIDATED BYTES')
      if (['symlink', 'hardlink', 'cancel-replaced'].includes(attack)) {
        assert.ok(fs.lstatSync(temp), 'foreign replacement must not be unlinked by cleanup')
        assert.equal(fs.lstatSync(temp).isSymbolicLink(), attack !== 'hardlink')
      } else assert.equal(fs.existsSync(temp), false, 'still-owned corrupted temp can be cleaned')
      if (attack === 'lock-replaced') {
        assert.equal(
          JSON.parse(fs.readFileSync(path.join(b.root, 'state.lock'), 'utf8')).token,
          'foreign-lock',
        )
        return
      }
      assert.equal(fs.existsSync(path.join(b.root, 'state.lock')), false)
      await s.transactGoal(
        b,
        s.stateTicket(s.readGoalState(b)),
        () => {},
        (state: any) =>
          m.applyGoal(state, b, 'update', {
            action: 'set_phase',
            expected_revision: 1,
            phase: 'genuine next write',
          }),
      )
      assert.equal(m.goalAt(s.readGoalState(b), b).revision, 2)
    } finally {
      if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = saved
    }
  })
}
