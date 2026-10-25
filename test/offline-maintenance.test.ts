import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { MemoryEngineController, type OperationContext } from '../lib/agent-memory/engine/controller.ts'
import {
  offlineMaintenance,
  offlineAssurance,
  maintenanceMarker,
} from '../lib/agent-memory/engine/offline-maintenance.ts'
import { createMemoryStore } from '../lib/agent-memory/store.ts'
import { parseOperation } from '../lib/agent-memory/engine/operation.ts'

// Disposable source fixture only. Production current comes from the real Root-bound runtime.
async function fixture() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-offline-'))
  const root = join(directory, 'memory')
  const project = join(directory, 'project')
  mkdirSync(project, { mode: 0o700 })
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
    '# Fixture\nPreserved core.\n',
  )
  const historical = store.createView('fixture', 120000, true)
  store.edit(historical, 'global/history.md', null, '# Preserved historical knowledge\n', [])
  store.integrate(historical)
  const retained = store.createView('fixture', 120000, true)
  store.edit(retained, 'global/private-draft.md', null, '# Original private draft\nNever activate.\n', [])
  const context: OperationContext = { current: () => true }
  const preparing = new MemoryEngineController(root)
  const view = await preparing.request('create', { project: 'fixture', shared: true }, context)
  await preparing.request(
    'edit',
    {
      view: view.view,
      path: 'Core.md',
      expectedHash: createHash('sha256').update(store.snapshot().files['Core.md'].text).digest('hex'),
      text: '# Private proposal\nNot activated.\n',
      sources: [],
    },
    context,
  )
  await preparing.request('ready', { view: view.view }, context)
  const prepared = await preparing.request('prepare', { view: view.view, reviewed: [] }, context)
  assert.ok('plan' in prepared)
  const path = join(root, '.views/.engine-v2/journal', `${prepared.plan.id}.json`)
  const record = parseOperation(readFileSync(path, 'utf8'))
  mkdirSync(join(root, '.lock'), { mode: 0o700 })
  const stat = lstatSync(join(root, '.lock'))
  const owner = {
    version: 1 as const,
    operation: prepared.plan.id,
    digest: prepared.plan.digest,
    nonce: randomUUID(),
    directory: `${stat.dev}:${stat.ino}`,
  }
  writeFileSync(join(root, '.lock/owner.json'), JSON.stringify(owner), { mode: 0o600 })
  const uncertain = { ...record, sequence: 3, owner, receipt: { stage: 'unknown' as const } }
  parseOperation(JSON.stringify(uncertain))
  writeFileSync(path, `${JSON.stringify(uncertain)}\n`, { mode: 0o600 })
  const orphan = `.memory-engine-${randomUUID()}.tmp`
  writeFileSync(join(root, orphan), 'original orphan bytes', { mode: 0o600 })
  mkdirSync(`${path}.cas`, { mode: 0o700 })
  await preparing.close()
  const engine = new MemoryEngineController(root)
  const original = new Map<string, Buffer>()
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const physical = join(folder, name)
      if (lstatSync(physical).isDirectory()) walk(physical)
      else original.set(physical.slice(root.length + 1), readFileSync(physical))
    }
  }
  walk(root)
  const inspect = async () => {
    const result = await offlineMaintenance(engine, context, { action: 'offline-inspect' })
    assert.ok('revision' in result)
    return result
  }
  const apply = (preview: Awaited<ReturnType<typeof inspect>>, selected = context) =>
    offlineMaintenance(engine, selected, {
      action: 'offline-adopt',
      target: preview.target,
      revision: preview.revision,
      offline: offlineAssurance,
    })
  return {
    root,
    directory,
    project,
    engine,
    context,
    owner,
    orphan,
    path,
    original,
    inspect,
    apply,
    async close() {
      await engine.close()
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
const kernelAvailable =
  process.platform === 'darwin'
    ? existsSync('/usr/sbin/lsof')
    : process.platform === 'linux' && existsSync('/usr/bin/lsof')

test('offline adoption archives ALL original bytes, quarantines typed blockers, preserves HEAD/config/history and proposals', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture()
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root }).toString()
    const preview = await f.inspect()
    assert.equal('priorOutcome' in preview && preview.priorOutcome, 'unknown')
    assert.equal('counts' in preview && preview.counts?.journal, 2)
    assert.equal('counts' in preview && preview.counts?.drafts, 1)
    const output = JSON.stringify(preview)
    assert.ok(!output.includes('Preserved core') && !output.includes('Private proposal'))
    const result = await f.apply(preview)
    assert.equal('disposition' in result && result.disposition, 'manually-adopted-prior-outcome-unknown')
    assert.equal(existsSync(join(f.root, '.lock')), false)
    assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
    assert.equal(existsSync(join(f.root, f.orphan)), false)
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root }).toString(), head)
    const work = join(f.root, '.views/.maintenance', result.target!)
    for (const [path, bytes] of f.original) {
      assert.deepEqual(readFileSync(join(work, 'snapshot', path)), bytes, path)
      assert.equal(lstatSync(join(work, 'snapshot', path)).nlink, 1)
    }
    for (const path of ['Core.md', 'index.md', 'config.json', '.memory.json', '.git/index', '.git/config'])
      assert.deepEqual(readFileSync(join(f.root, path)), f.original.get(path), path)
    const draft = join(
      f.root,
      '.views/.engine-v2/drafts',
      `${'operation' in preview ? preview.operation?.view : ''}.json`,
    )
    assert.equal(JSON.parse(readFileSync(draft, 'utf8')).state, 'conflict')
    // Actual ordinary data-engine admission, not merely clean Git or absent .lock.
    const created = await f.engine.request('create', { project: 'fixture', shared: true }, f.context)
    assert.ok(created.view)
    await f.engine.request('cancel', { view: created.view }, f.context)
    await assert.rejects(
      f.apply(preview),
      /requires existing typed owner|requires complete typed|missing|existing typed/,
    )
  } finally {
    await f.close()
  }
})

test('same-porcelain changed orphan/config/index bytes invalidate reviewed fingerprint; no blind refresh', {
  skip: !kernelAvailable,
}, async () => {
  for (const changed of ['orphan', 'config-raw', 'index-raw']) {
    const f = await fixture()
    try {
      const preview = await f.inspect()
      const porcelain = () => execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: f.root })
      const before = porcelain()
      if (changed === 'orphan') writeFileSync(join(f.root, f.orphan), 'changed orphan bytes', { mode: 0o600 })
      if (changed === 'config-raw') {
        const path = join(f.root, 'config.json')
        writeFileSync(path, `${readFileSync(path, 'utf8')}\n`, { mode: 0o600 })
      }
      if (changed === 'index-raw') {
        const index = readFileSync(join(f.root, '.git/index'))
        execFileSync('git', ['update-index', '--index-version=4'], { cwd: f.root })
        assert.notDeepEqual(readFileSync(join(f.root, '.git/index')), index)
      }
      assert.deepEqual(porcelain(), before, changed)
      await assert.rejects(f.apply(preview), /reviewed offline target\/fingerprint/)
      assert.equal(existsSync(join(f.root, '.lock')), true)
      assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
    } finally {
      await f.close()
    }
  }
})

test('malformed lock, incomplete journal, dirty tracked work, links and full draft capacity never remove blockers', {
  skip: !kernelAvailable,
}, async () => {
  for (const scenario of ['lock', 'journal', 'dirty', 'symlink', 'hardlink', 'capacity']) {
    const f = await fixture()
    try {
      if (scenario === 'lock') writeFileSync(join(f.root, '.lock/owner.json'), '{}')
      if (scenario === 'journal') rmSync(f.path)
      if (scenario === 'dirty') writeFileSync(join(f.root, 'Core.md'), '# Unreviewed tracked WIP\n')
      if (scenario === 'symlink') symlinkSync(join(f.root, 'Core.md'), join(f.root, '.views/foreign'))
      if (scenario === 'hardlink') linkSync(join(f.root, 'Core.md'), join(f.root, '.views/linked'))
      if (scenario === 'capacity') {
        const drafts = join(f.root, '.views/.engine-v2/drafts')
        for (let i = 0; i < 63; i++)
          writeFileSync(join(drafts, `${randomUUID()}.json`), 'retained', { mode: 0o600 })
        const preview = await f.inspect()
        assert.equal('counts' in preview && preview.counts?.drafts, 64)
        assert.equal('adoptionAvailable' in preview && preview.adoptionAvailable, false)
        await assert.rejects(f.apply(preview), /capacity/)
      } else await assert.rejects(f.inspect())
      assert.equal(existsSync(join(f.root, '.lock')), true, scenario)
      assert.equal(existsSync(join(f.root, f.orphan)), true, scenario)
    } finally {
      await f.close()
    }
  }
})

test('archive resource/revocation failure retains all blockers; reviewed inspect/resume after checkpoint only', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture()
  try {
    const preview = await f.inspect()
    let fail = true
    const interrupted: OperationContext = {
      current: (targets) => {
        if (
          fail &&
          targets.physical.some((path) => path.includes('/snapshot/') && path.endsWith('/Core.md'))
        ) {
          fail = false
          return false
        }
        return true
      },
    }
    await assert.rejects(f.apply(preview, interrupted), /authority/)
    assert.equal(existsSync(join(f.root, maintenanceMarker)), true)
    assert.equal(existsSync(join(f.root, '.lock')), true)
    const checkpoint = await f.inspect()
    assert.equal('phase' in checkpoint && checkpoint.phase, 'prepared')
    await assert.rejects(
      offlineMaintenance(f.engine, f.context, {
        action: 'offline-resume',
        target: checkpoint.target,
        revision: '0'.repeat(64),
        offline: offlineAssurance,
      }),
      /reviewed offline checkpoint/,
    )
    await offlineMaintenance(f.engine, f.context, {
      action: 'offline-resume',
      target: checkpoint.target,
      revision: checkpoint.revision,
      offline: offlineAssurance,
    })
    assert.equal(existsSync(join(f.root, '.lock')), false)
    assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
  } finally {
    await f.close()
  }
})

test('real detached child retaining a Root directory FD rejects even after launcher exits and cwd changes', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture()
  let childPid: number | undefined
  try {
    const launcher = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { spawn } from 'node:child_process';
      const c = spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(`
        import { openSync, writeFileSync } from 'node:fs';
        openSync(${JSON.stringify(join(f.root, '.git'))}, 'r');
        process.chdir('/');
        writeFileSync(${JSON.stringify(join(f.directory, 'holder-ready'))}, String(process.pid));
        setInterval(() => {}, 1000);
      `)}], { detached: true, stdio: 'ignore', cwd: '/' }); c.unref();
    `,
      ],
      { stdio: 'ignore', cwd: '/' },
    )
    await new Promise<void>((resolve) => launcher.once('exit', () => resolve()))
    for (let i = 0; i < 100 && !existsSync(join(f.directory, 'holder-ready')); i++)
      await new Promise((resolve) => setTimeout(resolve, 20))
    childPid = Number(readFileSync(join(f.directory, 'holder-ready'), 'utf8'))
    assert.ok(childPid > 0)
    await assert.rejects(f.inspect(), /Unexpected kernel Root holder/)
    assert.equal(existsSync(join(f.root, '.lock')), true)
    assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
  } finally {
    if (childPid) process.kill(childPid, 'SIGTERM') // fixture-owned disposable holder only
    await f.close()
  }
})

test('real process exit after first quarantine rename retains independent archive and requires reviewed checkpoint resume', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture()
  try {
    const preview = await f.inspect()
    const moduleURL = new URL('../lib/agent-memory/engine/offline-maintenance.ts', import.meta.url).href
    const controllerURL = new URL('../lib/agent-memory/engine/controller.ts', import.meta.url).href
    const child = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `
      import { existsSync } from 'node:fs';
      import { offlineMaintenance, offlineAssurance } from ${JSON.stringify(moduleURL)};
      import { MemoryEngineController } from ${JSON.stringify(controllerURL)};
      const root=${JSON.stringify(f.root)};
      const context={ current() {
        if (existsSync(root+'/.views/.maintenance-active.json') && !existsSync(root+'/.lock')) process.exit(73);
        return true;
      }};
      await offlineMaintenance(new MemoryEngineController(root), context, {
        action:'offline-adopt', target:${JSON.stringify(preview.target)},
        revision:${JSON.stringify(preview.revision)}, offline:offlineAssurance,
      });
    `,
      ],
      { cwd: '/', env: process.env, encoding: 'utf8', timeout: 30000 },
    )
    assert.equal(child.status, 73, child.stderr)
    assert.equal(existsSync(join(f.root, '.lock')), false)
    assert.equal(existsSync(join(f.root, maintenanceMarker)), true)
    assert.equal(existsSync(f.path), true, 'unknown journal not silently reclassified terminal')
    const checkpoint = await f.inspect()
    assert.equal('phase' in checkpoint && checkpoint.phase, 'quarantining')
    const archive = join(f.root, '.views/.maintenance', checkpoint.target!, 'snapshot')
    for (const [path, bytes] of f.original) assert.deepEqual(readFileSync(join(archive, path)), bytes, path)
    await assert.rejects(f.apply(preview), /checkpoint resume/)
    await offlineMaintenance(f.engine, f.context, {
      action: 'offline-resume',
      target: checkpoint.target,
      revision: checkpoint.revision,
      offline: offlineAssurance,
    })
    assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
    assert.equal(existsSync(f.path), false)
  } finally {
    await f.close()
  }
})

test('fixed archive inventory resource ceilings refuse before marker or blocker removal', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture()
  try {
    const huge = join(f.root, '.views/oversized-private-evidence')
    writeFileSync(huge, '', { mode: 0o600 })
    truncateSync(huge, 256 * 1024 * 1024 + 1)
    await assert.rejects(f.inspect(), /resource bound/)
    assert.equal(existsSync(join(f.root, '.lock')), true)
    assert.equal(existsSync(f.path), true)
    assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
  } finally {
    await f.close()
  }
})
