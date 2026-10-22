import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const base = path.resolve('.agent-state/runtime/ux-workflow-port/integrity')
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
  'same-mode-parent',
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
      const config = path.join(profile, 'extensions/mahiro-ux-workflow/config.json')
      fs.mkdirSync(path.dirname(config), { recursive: true, mode: 0o700 })
      fs.writeFileSync(config, JSON.stringify({ version: 1, profile, projects: [project] }), { mode: 0o600 })
      process.env.PI_CODING_AGENT_DIR = profile
      const s = await import(pathToFileURL(path.join(primary, 'lib/ux-workflow/store.ts')).href)
      const m = await import(pathToFileURL(path.join(primary, 'lib/ux-workflow/model.ts')).href)
      const b = {
        ...s.resolveUXBinding(project),
        sessionId: 'fixture-native-session',
      }
      await s.transactUX(
        b,
        s.stateTicket(s.readUXState(b)),
        () => {},
        (state: any) =>
          m.applyUX(state, b, 'create', {
            summary: 'Isolated integrity fixture',
          }),
      )
      const target = path.join(b.root, 'state.json'),
        before = fs.readFileSync(target)
      const foreign = path.join(root, 'foreign')
      fs.writeFileSync(foreign, 'FOREIGN UNVALIDATED BYTES', { mode: 0o600 })
      let calls = 0,
        temp = '',
        continuationCancelled = false
      const mutation = s.transactUX(
        b,
        s.stateTicket(s.readUXState(b)),
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
          } else if (attack === 'same-mode-parent') {
            fs.renameSync(b.root, `${b.root}-original`)
            fs.mkdirSync(b.root, { mode: 0o700 })
            // Preserve every child inode (target, lock and held temp) so ONLY
            // the same-mode parent identity distinguishes this interference.
            for (const name of fs.readdirSync(`${b.root}-original`))
              fs.renameSync(path.join(`${b.root}-original`, name), path.join(b.root, name))
          } else if (attack === 'continuation-cancel')
            queueMicrotask(() => {
              continuationCancelled = true
            })
          else {
            const bytes = fs.readFileSync(temp)
            bytes[0] = bytes[0] === 123 ? 91 : 123
            fs.writeFileSync(temp, bytes) // same size/mode/inode: requires exact-byte check
          }
          if (attack === 'cancel-replaced') throw new Error('cancel after foreign replacement')
        },
        (state: any) =>
          m.applyUX(state, b, 'update', {
            action: 'add_blocker',
            expected_revision: 1,
            summary: 'must not commit',
          }),
        () => {
          if (continuationCancelled) throw new Error('cancelled in final continuation')
        },
      )
      if (attack === 'same-mode-parent') await assert.rejects(mutation, /parent identity changed/)
      else if (attack === 'bytes') await assert.rejects(mutation, /serialized bytes changed/)
      else await assert.rejects(mutation)
      assert.deepEqual(fs.readFileSync(target), before)
      assert.equal(m.runAt(s.readUXState(b), b).revision, 1)
      assert.equal(fs.readFileSync(foreign, 'utf8'), 'FOREIGN UNVALIDATED BYTES')
      if (['symlink', 'hardlink', 'cancel-replaced'].includes(attack)) {
        assert.ok(fs.lstatSync(temp), 'foreign replacement must not be unlinked by cleanup')
        assert.equal(fs.lstatSync(temp).isSymbolicLink(), attack !== 'hardlink')
      } else assert.equal(fs.existsSync(temp), false, 'still-owned corrupted temp can be cleaned')
      if (attack === 'same-mode-parent') assert.equal(fs.statSync(b.root).mode & 0o7777, 0o700)
      if (attack === 'lock-replaced') {
        assert.equal(
          JSON.parse(fs.readFileSync(path.join(b.root, 'state.lock'), 'utf8')).token,
          'foreign-lock',
        )
        return
      }
      assert.equal(fs.existsSync(path.join(b.root, 'state.lock')), false)
      await s.transactUX(
        b,
        s.stateTicket(s.readUXState(b)),
        () => {},
        (state: any) =>
          m.applyUX(state, b, 'update', {
            action: 'add_blocker',
            expected_revision: 1,
            summary: 'genuine next write',
          }),
      )
      assert.equal(m.runAt(s.readUXState(b), b).revision, 2)
    } finally {
      if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = saved
    }
  })
}
