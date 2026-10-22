import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { rtkBinding, readRTKFile, rtkHash, publishRTKState } from '../lib/rtk-state.ts'
import { validateRTKState } from '../lib/rtk.ts'

test('RTK private binding/publication: no read init, closed state, CAS, corrupt/lock/symlink/hardlink/revocation/nonoverlap', () => {
  const base = path.resolve('.agent-state/runtime/rtk-rewrite-models-retirement/implementation/unit')
  fs.mkdirSync(base, { recursive: true, mode: 0o700 })
  const fixture = fs.mkdtempSync(path.join(base, 'state-'))
  const profile = path.join(fixture, 'profile'),
    project = path.join(fixture, 'project')
  for (const p of [profile, project]) fs.mkdirSync(p, { mode: 0o700 })
  const old = process.env.PI_CODING_AGENT_DIR,
    memory = process.env.MAHIRO_AGENT_MEMORY_ROOT
  process.env.PI_CODING_AGENT_DIR = profile
  try {
    assert.ok(rtkBinding(project))
    assert.deepEqual(fs.readdirSync(profile), [])
    const config = path.join(profile, 'extensions/mahiro-rtk/config.json')
    fs.mkdirSync(path.dirname(config), { recursive: true, mode: 0o700 })
    const configBytes = JSON.stringify({
      version: 1,
      profile,
      projects: [project],
    })
    fs.writeFileSync(config, configBytes, { mode: 0o600 })
    const b = rtkBinding(project)!
    const file = path.join(b.root, 'state.json')
    const read = () => {
      const text = readRTKFile(file)
      const state = text === null ? { version: 1, sequence: 0, mode: 'off' } : JSON.parse(text)
      validateRTKState(state)
      return { state, ticket: rtkHash(text ?? '<absent>') }
    }
    const initial = read()
    assert.equal(fs.existsSync(b.root), false)
    const next = { version: 1, sequence: 1, mode: 'rewrite-rtk' }
    publishRTKState(b, initial.ticket, next, () => {})
    const saved = read(),
      bytes = fs.readFileSync(file)
    assert.equal(saved.state.mode, 'rewrite-rtk')
    assert.equal(fs.statSync(b.root).mode & 0o777, 0o700)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    assert.throws(() => publishRTKState(b, initial.ticket, next, () => {}), /Stale/)
    assert.equal(fs.existsSync(path.join(b.root, 'state.lock')), false)
    for (const state of [
      { ...next, unknown: true },
      { ...next, mode: 'invalid' },
      { ...next, sequence: -1 },
    ])
      assert.throws(() => validateRTKState(state))
    fs.writeFileSync(file, '{corrupt')
    assert.throws(read)
    assert.equal(fs.readFileSync(file, 'utf8'), '{corrupt')
    fs.writeFileSync(file, bytes)
    fs.chmodSync(file, 0o644)
    assert.throws(read, /0600/)
    fs.chmodSync(file, 0o600)
    fs.writeFileSync(path.join(b.root, 'state.lock'), 'NO_AUTO_STEAL', {
      mode: 0o600,
    })
    assert.throws(() => publishRTKState(b, saved.ticket, next, () => {}))
    assert.equal(fs.readFileSync(path.join(b.root, 'state.lock'), 'utf8'), 'NO_AUTO_STEAL')
    fs.unlinkSync(path.join(b.root, 'state.lock'))
    fs.renameSync(file, `${file}.saved`)
    fs.symlinkSync(`${file}.saved`, file)
    assert.throws(read, /Symlink/)
    fs.unlinkSync(file)
    fs.linkSync(`${file}.saved`, file)
    assert.throws(read, /Unsafe bootstrap file/)
    fs.unlinkSync(file)
    fs.renameSync(`${file}.saved`, file)
    assert.throws(
      () =>
        publishRTKState(b, saved.ticket, next, () => {
          throw Error('revoked')
        }),
      /revoked/,
    )
    assert.deepEqual(fs.readFileSync(file), bytes)
    fs.chmodSync(profile, 0o755)
    assert.ok(rtkBinding(project), 'standard host parent mode is safe')
    fs.chmodSync(profile, 0o777)
    assert.throws(() => rtkBinding(project), /Unsafe/)
    fs.chmodSync(profile, 0o700)
    process.env.MAHIRO_AGENT_MEMORY_ROOT = b.root
    assert.throws(() => rtkBinding(project), /overlap/)
    if (memory === undefined) delete process.env.MAHIRO_AGENT_MEMORY_ROOT
    else process.env.MAHIRO_AGENT_MEMORY_ROOT = memory
    fs.writeFileSync(config, configBytes.replace(project, `${project}/other`))
    assert.throws(() => publishRTKState(b, saved.ticket, next, () => {}), /configuration changed/)
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = old
    if (memory === undefined) delete process.env.MAHIRO_AGENT_MEMORY_ROOT
    else process.env.MAHIRO_AGENT_MEMORY_ROOT = memory
  }
})
