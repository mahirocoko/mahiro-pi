import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MemoryEngineController, type OperationContext } from '../lib/agent-memory/engine/controller.ts'
import { offlineAssurance } from '../lib/agent-memory/engine/offline-maintenance.ts'
import { destroyNoBackup, offlineReset } from '../lib/agent-memory/engine/offline-reset.ts'
import { createMemoryStore } from '../lib/agent-memory/store.ts'
import { offlineResetFailureCode, type OfflineResetFailureCode } from '../lib/agent-memory/reasons.ts'

const rejection = (code: OfflineResetFailureCode) => (error: unknown) => {
  assert.equal(offlineResetFailureCode(error), code)
  return true
}

const kernelAvailable = existsSync(process.platform === 'darwin' ? '/usr/sbin/lsof' : '/usr/bin/lsof')
async function fixture() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-reset-'))
  const profile = join(directory, 'profile')
  const root = join(profile, 'memory')
  const project = join(directory, 'project')
  mkdirSync(profile, { mode: 0o700 })
  mkdirSync(project, { mode: 0o700 })
  mkdirSync(join(profile, 'sessions'), { mode: 0o700 })
  writeFileSync(join(profile, 'sessions/session.jsonl'), 'session fixture unchanged', { mode: 0o600 })
  writeFileSync(join(project, 'source.ts'), 'source fixture unchanged', { mode: 0o600 })
  writeFileSync(
    join(profile, '.mahiro-memory-engine.json'),
    JSON.stringify({ version: 2, mode: 'engine', root }),
    {
      mode: 0o600,
    },
  )
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ packages: ['fixture-owner'] }), {
    mode: 0o600,
  })
  const previous = { ...process.env }
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key]
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
  })
  const store = createMemoryStore(root, () => {}, 'primary')
  store.initialize(
    {
      version: 1,
      automatic: false,
      coreBytes: 8192,
      indexBytes: 2048,
      fileBytes: 8192,
      totalBytes: 65536,
      projects: [{ id: 'fixture', cwd: project }],
    },
    '# Synthetic private root\n',
  )
  const retained = store.createView('fixture', 120000, true)
  store.edit(retained, 'global/history.md', null, '# Historical bytes\n', [])
  store.integrate(retained)
  const context: OperationContext = { current: () => true }
  const preparing = new MemoryEngineController(root)
  const view = await preparing.request('create', { project: 'fixture', shared: true }, context)
  await preparing.request(
    'edit',
    {
      view: view.view,
      path: 'Core.md',
      expectedHash: createHash('sha256')
        .update(readFileSync(join(root, 'Core.md')))
        .digest('hex'),
      text: '# Prepared unpublished bytes\n',
      sources: [],
    },
    context,
  )
  await preparing.request('ready', { view: view.view }, context)
  const prepared = await preparing.request('prepare', { view: view.view, reviewed: [] }, context)
  assert.ok('plan' in prepared)
  mkdirSync(join(root, '.lock'), { mode: 0o700 })
  const stat = lstatSync(join(root, '.lock'))
  writeFileSync(
    join(root, '.lock/owner.json'),
    JSON.stringify({
      version: 1,
      operation: prepared.plan.id,
      digest: prepared.plan.digest,
      nonce: randomUUID(),
      directory: `${stat.dev}:${stat.ino}`,
    }),
    { mode: 0o600 },
  )
  await preparing.close()
  writeFileSync(join(root, '.hidden-untracked'), Buffer.from([0, 255, 1, 2]), { mode: 0o600 })
  mkdirSync(join(root, '.views/.maintenance/old'), { recursive: true, mode: 0o700 })
  writeFileSync(join(root, '.views/.maintenance/old/snapshot'), 'old recovery archive', { mode: 0o600 })
  const engine = new MemoryEngineController(root)
  const inspect = () => offlineReset(engine, context, { action: 'offline-reset-inspect' })
  const apply = (preview: Awaited<ReturnType<typeof inspect>>, selected = context) => {
    assert.ok('target' in preview)
    return offlineReset(engine, selected, {
      action: 'offline-reset',
      target: preview.target,
      revision: preview.revision,
      offline: offlineAssurance,
      destruction: destroyNoBackup,
    })
  }
  const snapshot = (folder: string) => {
    const entries: [string, string][] = []
    const walk = (path: string) => {
      for (const name of readdirSync(path).sort()) {
        const physical = join(path, name)
        const stat = lstatSync(physical)
        entries.push([
          physical.slice(folder.length),
          JSON.stringify({
            mode: stat.mode,
            ino: stat.ino,
            bytes: stat.isFile() ? readFileSync(physical).toString('base64') : null,
          }),
        ])
        if (stat.isDirectory()) walk(physical)
      }
    }
    walk(folder)
    return entries
  }
  return {
    directory,
    profile,
    root,
    engine,
    context,
    inspect,
    apply,
    snapshot,
    async close() {
      await engine.close()
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('reset inspection preserves every byte; exact apply destroys Git/lock/drafts/hidden bytes only, no backup or init', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture()
  try {
    const before = f.snapshot(f.directory)
    const preview = await f.inspect()
    assert.ok('target' in preview)
    assert.equal(preview.state, 'present-unvalidated-or-partial')
    assert.equal(preview.backupCreated, false)
    assert.ok(preview.counts.files > 10)
    assert.deepEqual(f.snapshot(f.directory), before)
    const serialized = JSON.stringify(preview)
    for (const privateValue of [f.root, f.profile, 'Core.md', 'snapshot', 'Prepared', 'history.md'])
      assert.equal(serialized.includes(privateValue), false)
    const siblings = before.filter(
      ([path]) => path !== '/profile/memory' && !path.startsWith('/profile/memory/'),
    )
    const applied = await f.apply(preview)
    assert.equal(applied.state, 'absent-uninitialized')
    assert.equal(applied.backupCreated, false)
    assert.equal(existsSync(f.root), false)
    assert.deepEqual(f.snapshot(f.directory), siblings)
    const absent = await f.inspect()
    assert.equal(absent.state, 'absent-uninitialized')
    assert.ok('counts' in absent)
    assert.deepEqual(absent.counts, { files: 0, directories: 0, bytes: 0 })
    await assert.rejects(f.apply(absent), /already absent/)
    assert.equal(existsSync(f.root), false)
  } finally {
    await f.close()
  }
})

test('reset refuses missing destructive assurance, changed bytes/settings/selection and revoked authority', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture()
  try {
    const preview = await f.inspect()
    assert.ok('target' in preview)
    await assert.rejects(
      offlineReset(f.engine, f.context, {
        action: 'offline-reset',
        target: preview.target,
        revision: preview.revision,
        offline: offlineAssurance,
      }),
      rejection('reset-request-shape'),
    )
    await assert.rejects(
      offlineReset(f.engine, f.context, {
        action: 'offline-reset',
        target: '0'.repeat(64),
        revision: preview.revision,
        offline: offlineAssurance,
        destruction: destroyNoBackup,
      }),
      rejection('fingerprint'),
    )
    writeFileSync(join(f.root, '.hidden-untracked'), 'changed hidden bytes', { mode: 0o600 })
    await assert.rejects(f.apply(preview), rejection('fingerprint'))
    const next = await f.inspect()
    writeFileSync(join(f.profile, 'settings.json'), JSON.stringify({ packages: ['different-owner'] }), {
      mode: 0o600,
    })
    await assert.rejects(f.apply(next), rejection('fingerprint'))
    const selected = await f.inspect()
    writeFileSync(
      join(f.profile, '.mahiro-memory-engine.json'),
      JSON.stringify({ version: 2, mode: 'off', root: f.root }),
      { mode: 0o600 },
    )
    await assert.rejects(f.apply(selected), /selection/)
    await assert.rejects(f.apply(selected, { current: () => false }), rejection('authority'))
    assert.ok(existsSync(join(f.root, '.git')))
  } finally {
    await f.close()
  }
})

test('reset refuses symlink roots/children, nonstandard roots and own or external holders', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture()
  try {
    symlinkSync(join(f.profile, 'settings.json'), join(f.root, '.linked'))
    await assert.rejects(f.inspect(), rejection('unsafe-entry'))
    rmSync(join(f.root, '.linked'))
    linkSync(join(f.root, 'Core.md'), join(f.root, '.hardlinked'))
    await assert.rejects(f.inspect(), rejection('unsafe-entry'))
    rmSync(join(f.root, '.hardlinked'))
    const settings = readFileSync(join(f.profile, 'settings.json'))
    writeFileSync(join(f.profile, 'settings.json'), '{ malformed', { mode: 0o600 })
    await assert.rejects(f.inspect(), rejection('scan'))
    writeFileSync(join(f.profile, 'settings.json'), settings, { mode: 0o600 })
    const preview = await f.inspect()
    const fd = openSync(join(f.root, 'Core.md'), 'r')
    try {
      await assert.rejects(f.apply(preview), rejection('holder-present'))
    } finally {
      closeSync(fd)
    }
    const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready");setInterval(()=>{},1000)'], {
      cwd: f.root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()))
    try {
      await assert.rejects(f.apply(preview), rejection('holder-present'))
    } finally {
      child.kill()
      await new Promise((resolve) => child.once('close', resolve))
    }
    rmSync(f.root, { recursive: true })
    symlinkSync(join(f.profile, 'sessions'), f.root)
    await assert.rejects(f.inspect(), rejection('unsafe-entry'))
    const nonstandard = new MemoryEngineController(join(f.profile, 'sessions'))
    try {
      await assert.rejects(
        offlineReset(nonstandard, f.context, { action: 'offline-reset-inspect' }),
        /standard/,
      )
    } finally {
      await nonstandard.close()
    }
  } finally {
    await f.close()
  }
})

// Boundary evidence, NOT an active-session reset success case. This deliberately violates
// offlineAssurance on a disposable root to prove why lsof/epochs cannot certify old writers.
test('offline reset cannot fence a paused legacy writer with no open root handle', {
  skip: !kernelAvailable,
  timeout: 45000,
}, async () => {
  const f = await fixture()
  const release = join(f.directory, 'release-writer')
  const child = spawn(
    process.execPath,
    [
      '--import',
      new URL('./public-dependency-loader.mjs', import.meta.url).pathname,
      '--input-type=module',
      '-e',
      `
        import { existsSync, writeSync } from 'node:fs'
        import { join } from 'node:path'
        import { createMemoryStore } from ${JSON.stringify(new URL('../lib/agent-memory/store.ts', import.meta.url).href)}
        const [root, release] = process.argv.slice(1)
        let target
        const wait = new Int32Array(new SharedArrayBuffer(4))
        const store = createMemoryStore(root, (path) => {
          if (target === undefined || path !== target) return
          // saveView -> write has authorized this exact path; atomic has not opened it yet.
          writeSync(1, 'paused\\n')
          const deadline = Date.now() + 30000
          while (!existsSync(release)) {
            if (Date.now() >= deadline) throw Error('Synthetic writer release timed out')
            Atomics.wait(wait, 0, 0, 10)
          }
          target = undefined
        }, 'primary')
        const view = store.createView('fixture', 120000, true)
        target = join(root, '.views', view.id, 'global/late.md')
        store.edit(view, 'global/late.md', null, '# Late synthetic proposal\\n', [])
        writeSync(1, 'resumed\\n')
      `,
      f.root,
      release,
    ],
    { cwd: f.directory, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  let diagnostic = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    diagnostic += chunk.toString()
  })
  const closed = new Promise<number | null>((resolve) => child.once('close', resolve))
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Synthetic writer did not pause')), 15000)
      child.stdout.on('data', () => {
        if (output.includes('paused\n')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', () => {
        clearTimeout(timer)
        reject(Error(`Writer exited: ${diagnostic}`))
      })
    })
    // Both real fixed lsof checks pass while the process retains the old callback and bytes.
    const preview = await f.inspect()
    const result = await f.apply(preview)
    assert.equal(result.state, 'absent-uninitialized')
    assert.equal(existsSync(f.root), false)
    writeFileSync(release, 'resume', { mode: 0o600 })
    assert.equal(await closed, 0, diagnostic)
    assert.ok(output.includes('resumed\n'))
    const views = readdirSync(join(f.root, '.views'))
    const draft = views.find((name) => !name.endsWith('.json'))
    assert.ok(draft)
    assert.equal(
      readFileSync(join(f.root, '.views', draft, 'global/late.md'), 'utf8'),
      '# Late synthetic proposal\n',
    )
    assert.equal(existsSync(join(f.root, '.git')), false)
    assert.equal(existsSync(join(f.root, 'config.json')), false)
  } finally {
    child.kill('SIGKILL')
    await closed
    await f.close()
  }
})

test('revocation during deletion leaves an honest partial tree; fresh exact review completes without journals/config or init', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture()
  try {
    const preview = await f.inspect()
    let interrupted = false
    const selected: OperationContext = {
      current: () => {
        // Revokes only after a reviewed leaf is actually gone, not at a guessed call count.
        if (!existsSync(join(f.root, '.git/hooks/applypatch-msg.sample'))) {
          interrupted = true
          return false
        }
        return true
      },
    }
    assert.ok(existsSync(join(f.root, '.git/hooks/applypatch-msg.sample')))
    await assert.rejects(f.apply(preview, selected), /authority/)
    assert.equal(interrupted, true)
    assert.equal(existsSync(f.root), true)
    await assert.rejects(f.apply(preview), /fingerprint|reviewed/)
    // Model a later crash after deletion of the config and journal. Reset does not replay either.
    rmSync(join(f.root, '.memory.json'), { force: true })
    rmSync(join(f.root, '.views/.engine-v2/journal'), { recursive: true, force: true })
    const partial = await f.inspect()
    assert.equal(partial.state, 'present-unvalidated-or-partial')
    await f.apply(partial)
    assert.equal(existsSync(f.root), false)
    assert.equal((await f.inspect()).state, 'absent-uninitialized')
  } finally {
    await f.close()
  }
})
