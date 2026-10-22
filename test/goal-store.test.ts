import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import test from 'node:test'

const base = path.resolve('.agent-state/runtime/goal-port')
fs.mkdirSync(base, { recursive: true, mode: 0o700 })
async function fixture() {
  const root = fs.mkdtempSync(path.join(base, 'store-'))
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
  const store = await import(pathToFileURL(path.join(primary, 'lib/goal/store.ts')).href)
  const model = await import(pathToFileURL(path.join(primary, 'lib/goal/model.ts')).href)
  process.env.PI_CODING_AGENT_DIR = profile
  const binding = {
    ...store.resolveGoalBinding(project),
    sessionId: 'native-session',
  }
  return {
    root,
    primary,
    profile,
    project,
    config,
    store,
    model,
    binding,
    statePath: path.join(binding.root, 'state.json'),
  }
}
const create = {
  objective: 'Offline store test',
  criteria: [{ text: 'proof' }],
}
const child = (file: string, env: any) =>
  new Promise<{ code: number | null; out: string }>((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [file], { env })
    let out = ''
    process.stdout.on('data', (data) => (out += data))
    process.stderr.on('data', (data) => (out += data))
    process.on('error', reject)
    process.on('close', (code) => resolve({ code, out }))
  })

test('private persistence: authorized missing empty, no initialization on read, versioned canonical envelope and session pointers', async () => {
  const saved = process.env.PI_CODING_AGENT_DIR
  try {
    const f = await fixture(),
      { store: s, model: m, binding: b } = f
    const state = s.readGoalState(b)
    assert.equal(fs.existsSync(b.root), false)
    await s.transactGoal(
      b,
      s.stateTicket(state),
      () => {},
      (draft: any) => m.applyGoal(draft, b, 'create', create),
    )
    const reread = s.readGoalState(b)
    assert.equal(reread.sequence, 1)
    assert.equal(Object.keys(reread.goals).length, 1)
    assert.equal(reread.sessions[b.sessionId], m.goalAt(reread, b).id)
    assert.equal(m.goalAt(reread, { ...b, sessionId: 'new-or-fork' }), null)
    assert.equal(fs.statSync(f.statePath).mode & 0o777, 0o600)
    assert.equal(fs.statSync(b.root).mode & 0o777, 0o700)
    assert.equal(fs.existsSync(path.join(b.root, 'state.lock')), false)
    const ticket = s.stateTicket(reread)
    await s.transactGoal(
      b,
      ticket,
      () => {},
      (draft: any) => m.applyGoal(draft, b, 'clear', { expected_revision: 1 }),
    )
    await assert.rejects(
      s.transactGoal(
        b,
        ticket,
        () => {},
        () => {},
      ),
      /Stale/,
    )
    assert.equal(s.readGoalState(b).sequence, 2)
    const emptyTicket = s.stateTicket(s.readGoalState(b))
    await s.transactGoal(
      b,
      emptyTicket,
      () => {},
      (draft: any) => m.applyGoal(draft, b, 'create', create),
    )
    const newGoal = m.goalAt(s.readGoalState(b), b)
    assert.equal(newGoal.revision, 1)
    await assert.rejects(
      s.transactGoal(
        b,
        ticket,
        () => {},
        (draft: any) => m.applyGoal(draft, b, 'clear', { expected_revision: 1 }),
      ),
      /Stale/,
    )
    assert.equal(m.goalAt(s.readGoalState(b), b).id, newGoal.id)
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = saved
  }
})

test('two-process CAS race, lock contention/crash persistence and no automatic steal', async () => {
  const saved = process.env.PI_CODING_AGENT_DIR
  try {
    const f = await fixture(),
      { store: s, model: m, binding: b } = f
    await s.transactGoal(
      b,
      s.stateTicket(s.readGoalState(b)),
      () => {},
      (draft: any) => m.applyGoal(draft, b, 'create', create),
    )
    const ticket = s.stateTicket(s.readGoalState(b)),
      worker = path.join(f.root, 'race.mjs')
    fs.writeFileSync(
      worker,
      `import {transactGoal} from ${JSON.stringify(pathToFileURL(path.join(f.primary, 'lib/goal/store.ts')).href)};import {applyGoal} from ${JSON.stringify(pathToFileURL(path.join(f.primary, 'lib/goal/model.ts')).href)};try{await transactGoal(${JSON.stringify(b)},${JSON.stringify(ticket)},()=>{},state=>applyGoal(state,${JSON.stringify(b)},'update',{action:'set_phase',phase:process.env.WORKER,expected_revision:1}));console.log('COMMITTED');}catch(e){console.log('DENIED:'+e.message);process.exitCode=2;}`,
    )
    const results = await Promise.all([
      child(worker, { ...process.env, WORKER: 'one' }),
      child(worker, { ...process.env, WORKER: 'two' }),
    ])
    assert.deepEqual(results.map((r) => r.code).sort(), [0, 2], JSON.stringify(results))
    assert.equal(m.goalAt(s.readGoalState(b), b).revision, 2)
    const crash = path.join(f.root, 'crash.mjs'),
      lockPath = path.join(b.root, 'state.lock')
    fs.writeFileSync(
      crash,
      `import fs from 'node:fs';const fd=fs.openSync(${JSON.stringify(lockPath)},'wx',0o600);fs.writeFileSync(fd,JSON.stringify({token:'crashed-owner',pid:process.pid}));fs.fsyncSync(fd);process.exit(0);`,
    )
    assert.equal((await child(crash, { ...process.env })).code, 0)
    const bytes = fs.readFileSync(f.statePath)
    await assert.rejects(
      s.transactGoal(
        b,
        s.stateTicket(s.readGoalState(b)),
        () => {},
        () => {},
      ),
      /no automatic/,
    )
    assert.deepEqual(fs.readFileSync(f.statePath), bytes)
    assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).token, 'crashed-owner')
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = saved
  }
})

test('cancellation and changing authority immediately before commit write no canonical state', async () => {
  const saved = process.env.PI_CODING_AGENT_DIR
  try {
    const f = await fixture(),
      { store: s, model: m, binding: b } = f
    let calls = 0
    await assert.rejects(
      s.transactGoal(
        b,
        s.stateTicket(s.readGoalState(b)),
        () => {
          if (++calls === 2) throw Error('cancelled before commit')
        },
        (draft: any) => m.applyGoal(draft, b, 'create', create),
      ),
      /cancelled/,
    )
    assert.equal(fs.existsSync(f.statePath), false)
    assert.equal(fs.existsSync(path.join(b.root, 'state.lock')), false)
    assert.equal(fs.readdirSync(b.root).length, 0)
    await assert.rejects(
      s.transactGoal(
        b,
        s.stateTicket(s.readGoalState(b)),
        () => {
          fs.writeFileSync(f.config, JSON.stringify({ version: 1, profile: f.profile, projects: [] }))
        },
        () => {},
      ),
      /authority changed/,
    )
    assert.equal(fs.existsSync(f.statePath), false)
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = saved
  }
})

test('invalid/oversized JSON, symlinks, hardlinks, modes, traversal, conflicting profile and excluded paths reject', async () => {
  const saved = process.env.PI_CODING_AGENT_DIR
  try {
    const f = await fixture(),
      { store: s, model: m, binding: b } = f
    await s.transactGoal(
      b,
      s.stateTicket(s.readGoalState(b)),
      () => {},
      (draft: any) => m.applyGoal(draft, b, 'create', create),
    )
    const original = fs.readFileSync(f.statePath),
      restore = () => {
        try {
          fs.unlinkSync(f.statePath)
        } catch {}
        fs.writeFileSync(f.statePath, original, { mode: 0o600 })
      }
    for (const bytes of ['{', JSON.stringify({ schemaVersion: 2 }), 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      fs.writeFileSync(f.statePath, bytes)
      assert.throws(() => s.readGoalState(b))
      restore()
    }
    fs.chmodSync(f.statePath, 0o644)
    assert.throws(() => s.readGoalState(b))
    restore()
    const foreign = path.join(f.root, 'foreign.json')
    fs.writeFileSync(foreign, original, { mode: 0o600 })
    fs.unlinkSync(f.statePath)
    fs.symlinkSync(foreign, f.statePath)
    assert.throws(() => s.readGoalState(b))
    restore()
    const link = path.join(f.root, 'hardlink.json')
    fs.linkSync(f.statePath, link)
    assert.throws(() => s.readGoalState(b))
    fs.unlinkSync(link)
    fs.chmodSync(b.root, 0o755)
    assert.throws(() => s.readGoalState(b))
    fs.chmodSync(b.root, 0o700)
    assert.throws(() => s.resolveGoalBinding(`${f.project}/../project`))
    // Refuse a missing directory, not a particular project name.
    assert.throws(() => s.resolveGoalBinding(path.join(f.root, 'missing-project')))
    const config = fs.readFileSync(f.config)
    fs.writeFileSync(
      f.config,
      JSON.stringify({
        version: 1,
        profile: '/foreign',
        projects: [f.project],
      }),
    )
    assert.throws(() => s.resolveGoalBinding(f.project))
    fs.writeFileSync(f.config, config)
    fs.chmodSync(f.config, 0o644)
    assert.throws(() => s.resolveGoalBinding(f.project))
    fs.chmodSync(f.config, 0o600)
    const alias = path.join(f.root, 'profile-alias')
    fs.symlinkSync(f.profile, alias)
    process.env.PI_CODING_AGENT_DIR = alias
    assert.throws(() => s.resolveGoalBinding(f.project))
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = saved
  }
})
