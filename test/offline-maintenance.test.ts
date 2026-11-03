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
import { retirePreparedPublication } from '../lib/agent-memory/engine/prepared-retirement.ts'
import { inspectPreparedPublication } from '../lib/agent-memory/engine/offline-maintenance.ts'
import { createMemoryRetirement } from '../lib/kernel/memory-retirement.ts'

// Disposable source fixture only. Production current comes from the real Root-bound runtime.
async function fixture(
  options: {
    partialMutation?: boolean
    ownerlessPrepared?: boolean
    lockedPrepared?: boolean
    excludeNativeOrphans?: boolean
    terminalDirty?: boolean
    largeOperation?: boolean
    overflow?: boolean
  } = {},
) {
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
  if (options.largeOperation) {
    const large = store.createView('fixture', 120000, true)
    for (let i = 0; i < 350; i++)
      store.edit(
        large,
        `global/${'x'.repeat(55)}${i.toString(36).padStart(3, '0')}.md`,
        null,
        `# Large ${i}\n`,
        [],
      )
    store.integrate(large)
  }
  const historical = store.createView('fixture', 120000, true)
  store.edit(historical, 'global/history.md', null, '# Preserved historical knowledge\n', [])
  store.integrate(historical)
  const retained = store.createView('fixture', 120000, true)
  store.edit(retained, 'global/private-draft.md', null, '# Original private draft\nNever activate.\n', [])
  if (options.largeOperation) {
    const ledgerPath = join(root, '.memory.json')
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    const sources = [
      's'.repeat(64),
      't'.repeat(64),
      'u'.repeat(64),
      'v'.repeat(64),
      'w'.repeat(64),
      'y'.repeat(64),
    ]
    for (const path of Object.keys(ledger.sources))
      if (path.startsWith('global/x')) ledger.sources[path] = sources
    writeFileSync(ledgerPath, `${JSON.stringify(ledger)}\n`, { mode: 0o600 })
    execFileSync('git', ['add', '.memory.json'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'Expand fixture provenance'], { cwd: root, stdio: 'ignore' })
  }
  if (options.excludeNativeOrphans) {
    const exclude = join(root, '.git/info/exclude')
    writeFileSync(exclude, `${readFileSync(exclude, 'utf8')}\n/.memory-engine-*.tmp\n`, { mode: 0o600 })
  }
  const context: OperationContext = { current: () => true }
  const preparing = new MemoryEngineController(root)
  if (options.overflow) {
    const initial = await preparing.request('create', { project: 'fixture', shared: true }, context)
    const folder = join(root, '.views/.engine-v2/drafts')
    const original = JSON.parse(readFileSync(join(folder, `${initial.view}.json`), 'utf8'))
    for (let index = 1; index < 64; index++) {
      const draft = { ...original, id: randomUUID(), state: 'cancelled' }
      writeFileSync(join(folder, `${draft.id}.json`), `${JSON.stringify(draft)}\n`, { mode: 0o600 })
    }
  }
  const view = await preparing.request('create', { project: 'fixture', shared: true }, context)
  await preparing.request(
    'edit',
    {
      view: view.view,
      path: 'Core.md',
      expectedHash: createHash('sha256')
        .update(readFileSync(join(root, 'Core.md')))
        .digest('hex'),
      text: '# Private proposal\nNot activated.\n',
      sources: [],
    },
    context,
  )
  await preparing.request(
    'edit',
    {
      view: view.view,
      path: 'global/history.md',
      expectedHash: createHash('sha256')
        .update(readFileSync(join(root, 'global/history.md')))
        .digest('hex'),
      text: null,
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
  if (options.partialMutation || options.terminalDirty) {
    writeFileSync(join(root, 'Core.md'), '# Private proposal\nNot activated.\n', { mode: 0o600 })
    rmSync(join(root, 'global/history.md'))
    const staging = join(root, '.views/.engine-v2/staging', prepared.plan.id)
    mkdirSync(staging, { recursive: true, mode: 0o700 })
    writeFileSync(join(staging, `${randomUUID()}.tmp`), 'interrupted staging bytes', { mode: 0o600 })
  }
  if (options.terminalDirty) {
    const terminal = {
      ...uncertain,
      sequence: 4,
      receipt: {
        stage: 'not_committed_dirty' as const,
        revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        indexDirty: false,
        worktreeDirty: true,
      },
    }
    parseOperation(JSON.stringify(terminal))
    writeFileSync(path, `${JSON.stringify(terminal)}\n`, { mode: 0o600 })
    rmSync(join(root, '.lock'), { recursive: true })
  }
  const orphan = `.memory-engine-${randomUUID()}.tmp`
  writeFileSync(join(root, orphan), 'original orphan bytes', { mode: 0o600 })
  mkdirSync(`${path}.cas`, { mode: 0o700 })
  if (options.ownerlessPrepared || options.lockedPrepared) {
    // Retain the actual prepare output, not a synthesized execution receipt.
    writeFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
    if (!options.lockedPrepared) rmSync(join(root, '.lock'), { recursive: true })
    rmSync(`${path}.cas`, { recursive: true })
    rmSync(join(root, orphan))
  }
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

test('prepared product handoff refuses unknown/policy-shaped legacy evidence before retiring anything', async () => {
  const f = await fixture()
  let retired = false
  try {
    await assert.rejects(
      retirePreparedPublication(f.root, f.context, async () => {
        retired = true
        return { state: 'drained', scope: 'memory-generation', globalQuiescence: false }
      }),
      /only strict|prepared retirement/i,
    )
    assert.equal(retired, false)
    assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
  } finally {
    await f.close()
  }
})

for (const lockedPrepared of [false, true]) {
  const preparedOptions = lockedPrepared ? { lockedPrepared: true } : { ownerlessPrepared: true }
  const preparedDisposition = lockedPrepared
    ? 'manually-retired-locked-prepared'
    : 'manually-retired-ownerless-prepared'

  test(`${lockedPrepared ? 'locked' : 'ownerless'} prepared product handoff drains the actual generation, creates no barrier and matches offline archive`, {
    skip: !kernelAvailable,
  }, async () => {
    const f = await fixture(preparedOptions)
    let release!: () => void
    const native = new Promise<void>((yes) => {
      release = yes
    })
    let fenced = false
    const kernel = createMemoryRetirement(
      () => {
        fenced = true
      },
      async () => {},
    )
    kernel.onRetire(() => native) // f.engine is the separate cold offline maintenance owner
    try {
      const preview = await inspectPreparedPublication(f.root, f.context)
      assert.equal(preview.onlineEligible, false)
      assert.equal(preview.legacyEvidence, true)
      let completed = false
      const retiring = retirePreparedPublication(f.root, f.context, kernel.retire).then((result) => {
        completed = true
        return result
      })
      // Wait for the real generation fence, not an elapsed-time drain inference.
      while (!fenced) await new Promise((done) => setImmediate(done))
      assert.equal(completed, false)
      assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
      release()
      const handoff = await retiring
      assert.equal(handoff.state, 'offline-required')
      assert.equal(handoff.globalQuiescence, false)
      assert.equal(handoff.barrier, 'not-created')
      assert.ok('target' in handoff)
      const offline = await f.inspect()
      assert.equal(handoff.target, offline.target)
      assert.equal(handoff.revision, offline.revision)
      assert.equal(readFileSync(f.path).equals(f.original.get(f.path.slice(f.root.length + 1))!), true)
      // Handoff does not invent assurance. Existing coordinated offline owner still publishes the archive.
      const adopted = await f.apply(offline)
      const work = join(f.root, '.views/.maintenance', adopted.target!)
      for (const [path, bytes] of f.original)
        assert.deepEqual(readFileSync(join(work, 'snapshot', path)), bytes, path)
      assert.equal('disposition' in adopted && adopted.disposition, preparedDisposition)
    } finally {
      release()
      await f.close()
    }
  })

  test(`${lockedPrepared ? 'locked' : 'ownerless'} prepared recovery retains original evidence without claiming executor ownership`, {
    skip: !kernelAvailable,
  }, async () => {
    const f = await fixture(preparedOptions)
    try {
      const preview = await f.inspect()
      assert.deepEqual('owner' in preview && preview.owner, lockedPrepared ? f.owner : null)
      assert.equal(
        'priorOutcome' in preview && preview.priorOutcome,
        lockedPrepared ? 'locked-prepared' : 'prepared',
      )
      assert.equal('operation' in preview && preview.operation?.sequence, 0)
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root })
      await assert.rejects(f.apply({ ...preview, revision: '0'.repeat(64) }), /fingerprint/)
      await assert.rejects(
        offlineMaintenance(f.engine, f.context, {
          action: 'offline-adopt',
          target: preview.target,
          revision: preview.revision,
        }),
        /assurance/,
      )
      const result = await f.apply(preview)
      assert.equal('disposition' in result && result.disposition, preparedDisposition)
      const work = join(f.root, '.views/.maintenance', result.target!)
      for (const [path, bytes] of f.original)
        assert.deepEqual(readFileSync(join(work, 'snapshot', path)), bytes, path)
      assert.deepEqual(
        readFileSync(join(work, 'quarantine', f.path.slice(f.root.length + 1))),
        f.original.get(f.path.slice(f.root.length + 1)),
      )
      assert.equal(existsSync(f.path), false)
      assert.equal(existsSync(join(f.root, '.lock')), false)
      assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
      assert.deepEqual(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root }), head)
      for (const path of ['Core.md', 'index.md', '.memory.json', '.git/index', '.git/config'])
        assert.deepEqual(readFileSync(join(f.root, path)), f.original.get(path), path)
      const view = 'operation' in preview ? preview.operation!.view : ''
      const draft = join(f.root, '.views/.engine-v2/drafts', `${view}.json`)
      assert.equal(JSON.parse(readFileSync(draft, 'utf8')).state, 'conflict')
      const admitted = await f.engine.request('create', { project: 'fixture', shared: true }, f.context)
      await f.engine.request('cancel', { view: admitted.view }, f.context)
    } finally {
      await f.close()
    }
  })

  test('ownerless prepared recovery refuses ambiguous dirty/index/lock/CAS/staging and multiple pending evidence', async () => {
    for (const scenario of [
      'dirty',
      'hidden-dirty',
      'index',
      'lock',
      'cas',
      'staging',
      'orphan',
      'multiple',
      'sequence',
      'proposal',
      'config',
      'ledger',
      ...(lockedPrepared
        ? [
            'owner-operation',
            'owner-digest',
            'owner-directory',
            'owner-malformed',
            'policy',
            'extra-lock',
            'typed-record',
          ]
        : []),
    ]) {
      const f = await fixture(preparedOptions)
      try {
        if (scenario === 'dirty' || scenario === 'hidden-dirty') {
          if (scenario === 'hidden-dirty')
            execFileSync('git', ['update-index', '--assume-unchanged', 'Core.md'], { cwd: f.root })
          writeFileSync(join(f.root, 'Core.md'), '# Unknown work\n')
        }
        if (scenario === 'index') {
          writeFileSync(join(f.root, 'Core.md'), '# Staged work\n')
          execFileSync('git', ['add', 'Core.md'], { cwd: f.root })
        }
        if (scenario === 'lock') {
          if (lockedPrepared) rmSync(join(f.root, '.lock/owner.json'))
          else mkdirSync(join(f.root, '.lock'), { mode: 0o700 })
        }
        if (scenario.startsWith('owner-')) {
          const owner = { ...f.owner }
          if (scenario === 'owner-operation') owner.operation = randomUUID()
          if (scenario === 'owner-digest') owner.digest = '0'.repeat(64)
          if (scenario === 'owner-directory') owner.directory = '0:0'
          writeFileSync(
            join(f.root, '.lock/owner.json'),
            scenario === 'owner-malformed' ? '{}' : JSON.stringify(owner),
          )
        }
        if (scenario === 'policy' || scenario === 'extra-lock')
          writeFileSync(join(f.root, '.lock', scenario === 'policy' ? 'policy.json' : 'extra'), '{}')
        if (scenario === 'cas') mkdirSync(`${f.path}.cas`, { mode: 0o700 })
        if (scenario === 'staging')
          mkdirSync(join(f.root, '.views/.engine-v2/staging', f.owner.operation), {
            recursive: true,
            mode: 0o700,
          })
        if (scenario === 'orphan') writeFileSync(join(f.root, f.orphan), 'unowned bytes')
        const record = parseOperation(readFileSync(f.path, 'utf8'))
        if (scenario === 'multiple') {
          const immutable = { ...record.immutable, plan: { ...record.immutable.plan, id: randomUUID() } }
          const { digest: _, ...metadata } = immutable.plan
          immutable.plan.digest = createHash('sha256').update(JSON.stringify(metadata)).digest('hex')
          const duplicate = {
            ...record,
            immutable,
            immutableHash: createHash('sha256').update(JSON.stringify(immutable)).digest('hex'),
          }
          writeFileSync(join(dirname(f.path), `${immutable.plan.id}.json`), JSON.stringify(duplicate))
        }
        if (scenario === 'sequence') writeFileSync(f.path, JSON.stringify({ ...record, sequence: 1 }))
        if (scenario === 'typed-record') writeFileSync(f.path, JSON.stringify({ ...record, owner: f.owner }))
        if (scenario === 'proposal') {
          const path = join(f.root, '.views/.engine-v2/drafts', `${record.immutable.plan.view}.json`)
          const draft = JSON.parse(readFileSync(path, 'utf8'))
          writeFileSync(path, JSON.stringify({ ...draft, state: 'conflict' }))
        }
        if (scenario === 'config' || scenario === 'ledger') {
          const file = scenario === 'config' ? 'config.json' : '.memory.json'
          const value = JSON.parse(readFileSync(join(f.root, file), 'utf8'))
          if (scenario === 'config') value.automatic = !value.automatic
          else value.sources['Core.md'] = ['changed-source']
          writeFileSync(join(f.root, file), `${JSON.stringify(value)}\n`)
          execFileSync('git', ['add', '-f', file], { cwd: f.root })
          execFileSync('git', ['commit', '-m', 'Changed synthetic baseline'], {
            cwd: f.root,
            stdio: 'ignore',
          })
        }
        const before = readFileSync(f.path)
        await assert.rejects(f.inspect(), { name: 'Error' }, scenario)
        assert.deepEqual(readFileSync(f.path), before, scenario)
        assert.equal(existsSync(join(f.root, maintenanceMarker)), false, scenario)
      } finally {
        await f.close()
      }
    }
  })

  test(`${lockedPrepared ? 'locked' : 'ownerless'} prepared inspection refuses native orphans hidden by a pre-prepare Git exclude`, async () => {
    const f = await fixture({ ...preparedOptions, excludeNativeOrphans: true })
    try {
      const journal = readFileSync(f.path)
      const orphan = join(f.root, f.orphan)
      const bytes = Buffer.from('unknown native work created after prepare\n')
      writeFileSync(orphan, bytes, { mode: 0o600 })
      assert.equal(
        execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: f.root })
          .length,
        0,
      )
      assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
      await assert.rejects(f.inspect(), /native orphan evidence/)
      assert.deepEqual(readFileSync(f.path), journal)
      assert.deepEqual(readFileSync(orphan), bytes)
      assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
      assert.equal(existsSync(join(f.root, '.views/.maintenance')), false)
    } finally {
      await f.close()
    }
  })

  test(`${lockedPrepared ? 'locked' : 'ownerless'} prepared archive interruption requires exact reviewed resume and preserves journal`, {
    skip: !kernelAvailable,
  }, async () => {
    const f = await fixture(preparedOptions)
    try {
      const preview = await f.inspect()
      let interrupted = false
      await assert.rejects(
        f.apply(preview, {
          current: (targets) => {
            if (
              !interrupted &&
              targets.physical.some((path) => path.includes('/snapshot/') && path.endsWith('/Core.md'))
            ) {
              interrupted = true
              return false
            }
            return true
          },
        }),
        /authority/,
      )
      assert.deepEqual(readFileSync(f.path), f.original.get(f.path.slice(f.root.length + 1)))
      assert.equal(existsSync(join(f.root, maintenanceMarker)), true)
      const checkpoint = await f.inspect()
      const result = await offlineMaintenance(f.engine, f.context, {
        action: 'offline-resume',
        target: checkpoint.target,
        revision: checkpoint.revision,
        offline: offlineAssurance,
      })
      assert.equal('disposition' in result && result.disposition, preparedDisposition)
      assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
    } finally {
      await f.close()
    }
  })

  test(`${lockedPrepared ? 'locked' : 'ownerless'} prepared resume after journal quarantine verifies original evidence before completing`, {
    skip: !kernelAvailable,
  }, async () => {
    const f = await fixture(preparedOptions)
    try {
      const preview = await f.inspect()
      let interrupted = false
      await assert.rejects(
        f.apply(preview, {
          current: () => {
            if (!interrupted && !existsSync(f.path)) {
              interrupted = true
              return false
            }
            return true
          },
        }),
        /authority/,
      )
      assert.equal(interrupted, true)
      const checkpoint = await f.inspect()
      assert.equal('phase' in checkpoint && checkpoint.phase, 'quarantining')
      const work = join(f.root, '.views/.maintenance', checkpoint.target!)
      const path = f.path.slice(f.root.length + 1)
      assert.deepEqual(readFileSync(join(work, 'snapshot', path)), f.original.get(path))
      assert.deepEqual(readFileSync(join(work, 'quarantine', path)), f.original.get(path))
      await offlineMaintenance(f.engine, f.context, {
        action: 'offline-resume',
        target: checkpoint.target,
        revision: checkpoint.revision,
        offline: offlineAssurance,
      })
      assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
    } finally {
      await f.close()
    }
  })
}

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
      /requires existing typed owner|requires complete typed|missing|existing typed|requires one exact terminal dirty/,
    )
  } finally {
    await f.close()
  }
})

test('offline overflow adoption resolves actual reserved proposal, archives all evidence and resumes without freeing slots', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ partialMutation: true, overflow: true })
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root }).toString()
    const preview = await f.inspect()
    assert.equal('adoptionAvailable' in preview && preview.adoptionAvailable, true)
    const view = 'operation' in preview ? preview.operation!.view : ''
    const draft = `.views/.engine-v2/overflow-drafts/${view}.json`
    const slots = join(f.root, '.views/.engine-v2/overflow-drafts/slots')
    const slotOwner = readFileSync(join(slots, '00/owner'))
    let interrupted = false
    await assert.rejects(
      f.apply(preview, {
        current(targets) {
          if (!interrupted && targets.physical.some((path) => path.endsWith('/quarantine/.lock'))) {
            const marker = JSON.parse(readFileSync(join(f.root, maintenanceMarker), 'utf8'))
            const state = JSON.parse(
              readFileSync(join(f.root, '.views/.maintenance', marker.id, 'state.json'), 'utf8'),
            )
            if (state.phase === 'quarantining') {
              interrupted = true
              return false
            }
          }
          return true
        },
      }),
      /authority/,
    )
    assert.equal(interrupted, true)
    assert.equal(existsSync(join(f.root, '.lock')), true)
    const checkpoint = await f.inspect()
    assert.equal('phase' in checkpoint && checkpoint.phase, 'quarantining')
    const result = await offlineMaintenance(f.engine, f.context, {
      action: 'offline-resume',
      target: checkpoint.target,
      revision: checkpoint.revision,
      offline: offlineAssurance,
    })
    assert.equal('disposition' in result && result.disposition, 'manually-adopted-prior-outcome-unknown')
    const work = join(f.root, '.views/.maintenance', result.target!)
    for (const [path, bytes] of f.original)
      assert.deepEqual(readFileSync(join(work, 'snapshot', path)), bytes, path)
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root }).toString(), head)
    assert.equal(JSON.parse(readFileSync(join(f.root, draft), 'utf8')).state, 'conflict')
    assert.equal(readdirSync(slots).length, 1)
    assert.deepEqual(readFileSync(join(slots, '00/owner')), slotOwner)
    assert.equal(readdirSync(join(f.root, '.views/.engine-v2/drafts')).length, 64)
    assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
    assert.equal(existsSync(join(f.root, '.lock')), false)
    assert.equal(execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: f.root }).length, 0)
    const created = await f.engine.request('create', { project: 'fixture', shared: true }, f.context)
    assert.ok(existsSync(join(f.root, '.views/.engine-v2/overflow-drafts', `${created.view}.json`)))
    assert.equal(readdirSync(slots).length, 2)
  } finally {
    await f.close()
  }
})

test('offline overflow inspection refuses duplicate, unreserved, changed-hash, root-binding and authority evidence', {
  skip: !kernelAvailable,
}, async () => {
  for (const scenario of ['duplicate', 'unreserved', 'proposal-hash', 'root', 'authority']) {
    const f = await fixture({ overflow: true })
    try {
      const record = parseOperation(readFileSync(f.path, 'utf8'))
      const view = record.immutable.plan.view
      const proposal = join(f.root, '.views/.engine-v2/overflow-drafts', `${view}.json`)
      if (scenario === 'duplicate')
        writeFileSync(join(f.root, '.views/.engine-v2/drafts', `${view}.json`), readFileSync(proposal), {
          mode: 0o600,
        })
      if (scenario === 'unreserved') rmSync(join(f.root, '.views/.engine-v2/overflow-drafts/slots/00/owner'))
      if (scenario === 'proposal-hash')
        writeFileSync(proposal, `${readFileSync(proposal, 'utf8')}\n`, { mode: 0o600 })
      if (scenario === 'root') {
        record.immutable.root = f.directory
        record.immutableHash = createHash('sha256').update(JSON.stringify(record.immutable)).digest('hex')
        writeFileSync(f.path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
      }
      const selected =
        scenario === 'authority'
          ? {
              current: (targets: { physical: string[] }) =>
                !targets.physical.some((path) => path.endsWith('/slots/00/owner')),
            }
          : f.context
      await assert.rejects(offlineMaintenance(f.engine, selected, { action: 'offline-inspect' }))
      assert.equal(existsSync(join(f.root, '.lock')), true, scenario)
      assert.equal(existsSync(f.path), true, scenario)
      assert.equal(existsSync(proposal), true, scenario)
      assert.equal(existsSync(join(f.root, maintenanceMarker)), false, scenario)
    } finally {
      await f.close()
    }
  }
})

test('offline overflow terminal-dirty recovery and exhausted-slot HOLD retain typed evidence', {
  skip: !kernelAvailable,
}, async () => {
  for (const exhausted of [false, true]) {
    const f = await fixture({ terminalDirty: true, overflow: true })
    try {
      const slots = join(f.root, '.views/.engine-v2/overflow-drafts/slots')
      if (exhausted)
        for (let index = 1; index < 32; index++)
          mkdirSync(join(slots, String(index).padStart(2, '0')), { mode: 0o700 })
      const preview = await f.inspect()
      assert.equal('priorOutcome' in preview && preview.priorOutcome, 'not_committed_dirty')
      assert.equal('adoptionAvailable' in preview && preview.adoptionAvailable, !exhausted)
      if (exhausted) {
        await assert.rejects(f.apply(preview), /capacity/)
        assert.equal(existsSync(f.path), true)
        assert.equal(existsSync(join(f.root, maintenanceMarker)), false)
        assert.equal(readdirSync(slots).length, 32)
      } else {
        const result = await f.apply(preview)
        assert.equal('disposition' in result && result.disposition, 'manually-recovered-not-committed-dirty')
        assert.equal(existsSync(f.path), false)
        assert.equal(readdirSync(slots).length, 1)
        assert.equal(execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: f.root }).length, 0)
      }
    } finally {
      await f.close()
    }
  }
})

test('offline adoption archives and restores exact interrupted operation worktree and staging only', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ partialMutation: true })
  try {
    const committedCore = execFileSync('git', ['show', 'HEAD:Core.md'], { cwd: f.root })
    const committedHistory = execFileSync('git', ['show', 'HEAD:global/history.md'], { cwd: f.root })
    const preview = await f.inspect()
    assert.equal('counts' in preview && preview.counts?.staging, 1)
    const result = await f.apply(preview)
    assert.deepEqual(readFileSync(join(f.root, 'Core.md')), committedCore)
    assert.equal(lstatSync(join(f.root, 'Core.md')).mode & 0o777, 0o600)
    assert.deepEqual(readFileSync(join(f.root, 'global/history.md')), committedHistory)
    assert.equal(lstatSync(join(f.root, 'global/history.md')).mode & 0o777, 0o600)
    assert.equal(execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: f.root }).length, 0)
    assert.equal(existsSync(join(f.root, '.views/.engine-v2/staging', f.owner.operation)), false)
    assert.equal(
      existsSync(
        join(
          f.root,
          '.views/.maintenance',
          result.target!,
          'quarantine/.views/.engine-v2/staging',
          f.owner.operation,
        ),
      ),
      true,
    )
    assert.equal(
      readFileSync(join(f.root, '.views/.maintenance', result.target!, 'snapshot/Core.md'), 'utf8'),
      '# Private proposal\nNot activated.\n',
    )
  } finally {
    await f.close()
  }
})

test('offline recovery archives and restores a terminal dirty operation after its lock was released', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ terminalDirty: true })
  try {
    const committedCore = execFileSync('git', ['show', 'HEAD:Core.md'], { cwd: f.root })
    const committedHistory = execFileSync('git', ['show', 'HEAD:global/history.md'], { cwd: f.root })
    const preview = await f.inspect()
    assert.equal('priorOutcome' in preview && preview.priorOutcome, 'not_committed_dirty')
    assert.equal('artifacts' in preview && preview.artifacts?.includes('.lock'), false)
    const result = await f.apply(preview)
    assert.equal('disposition' in result && result.disposition, 'manually-recovered-not-committed-dirty')
    assert.deepEqual(readFileSync(join(f.root, 'Core.md')), committedCore)
    assert.equal(lstatSync(join(f.root, 'Core.md')).mode & 0o777, 0o600)
    assert.deepEqual(readFileSync(join(f.root, 'global/history.md')), committedHistory)
    assert.equal(lstatSync(join(f.root, 'global/history.md')).mode & 0o777, 0o600)
    assert.equal(execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: f.root }).length, 0)
    assert.equal(existsSync(f.path), false)
  } finally {
    await f.close()
  }
})

test('reviewed resume repairs tracked privacy after interruption between Git restore and chmod', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ partialMutation: true })
  try {
    let stopped = false
    const committedCore = execFileSync('git', ['show', 'HEAD:Core.md'], { cwd: f.root })
    const interrupted: OperationContext = {
      current(targets) {
        const core = join(f.root, 'Core.md')
        if (
          !stopped &&
          existsSync(join(f.root, maintenanceMarker)) &&
          targets.physical.includes(core) &&
          readFileSync(core).equals(committedCore) &&
          (lstatSync(core).mode & 0o777) !== 0o600
        ) {
          stopped = true
          return false
        }
        return true
      },
    }
    const preview = await f.inspect()
    await assert.rejects(f.apply(preview, interrupted), /authority/)
    assert.equal(stopped, true)
    assert.equal(lstatSync(join(f.root, 'Core.md')).mode & 0o777, 0o644)
    const checkpoint = await f.inspect()
    assert.equal('phase' in checkpoint && checkpoint.phase, 'quarantining')
    await offlineMaintenance(f.engine, f.context, {
      action: 'offline-resume',
      target: checkpoint.target,
      revision: checkpoint.revision,
      offline: offlineAssurance,
    })
    assert.equal(lstatSync(join(f.root, 'Core.md')).mode & 0o777, 0o600)
    assert.equal(lstatSync(join(f.root, 'global/history.md')).mode & 0o777, 0o600)
    assert.equal(execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: f.root }).length, 0)
  } finally {
    await f.close()
  }
})

test('offline inspection accepts operation and ledger records above retired bounds', {
  skip: !kernelAvailable,
}, async () => {
  const f = await fixture({ largeOperation: true })
  try {
    assert.ok(lstatSync(f.path).size > 512 * 1024)
    assert.ok(lstatSync(join(f.root, '.memory.json')).size > 128 * 1024)
    const preview = await f.inspect()
    assert.equal('operation' in preview && preview.operation?.view.length, 36)
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

for (const seam of ['marker-linked', 'lock-quarantined', 'journal-quarantined']) {
  test(`locked prepared process crash at ${seam} retains barrier and exact resumable evidence`, {
    skip: !kernelAvailable,
  }, async () => {
    const f = await fixture({ lockedPrepared: true })
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
          import { existsSync, lstatSync } from 'node:fs';
          import { offlineMaintenance, offlineAssurance } from ${JSON.stringify(moduleURL)};
          import { MemoryEngineController } from ${JSON.stringify(controllerURL)};
          const root = ${JSON.stringify(f.root)};
          const journal = ${JSON.stringify(f.path)};
          const seam = ${JSON.stringify(seam)};
          const marker = root + '/.views/.maintenance-active.json';
          const context = { current() {
            if (existsSync(marker) && (
              (seam === 'marker-linked' && lstatSync(marker).nlink === 2) ||
              (seam === 'lock-quarantined' && !existsSync(root + '/.lock') && existsSync(journal)) ||
              (seam === 'journal-quarantined' && !existsSync(journal))
            )) process.exit(73);
            return true;
          }};
          await offlineMaintenance(new MemoryEngineController(root), context, {
            action: 'offline-adopt', target: ${JSON.stringify(preview.target)},
            revision: ${JSON.stringify(preview.revision)}, offline: offlineAssurance,
          });
        `,
        ],
        { cwd: '/', env: process.env, encoding: 'utf8', timeout: 30000 },
      )
      assert.equal(child.status, 73, child.stderr)
      const markerPath = join(f.root, maintenanceMarker)
      assert.equal(existsSync(markerPath), true)
      const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
      const work = join(f.root, '.views/.maintenance', marker.id)
      const publication = join(work, 'marker-publication.json')
      const unknown = join(work, 'unknown-publication.tmp')
      if (seam === 'marker-linked') {
        assert.equal(lstatSync(markerPath).nlink, 2)
        assert.equal(lstatSync(publication).ino, lstatSync(markerPath).ino)
        assert.deepEqual(readFileSync(f.path), f.original.get(f.path.slice(f.root.length + 1)))
        writeFileSync(unknown, 'retain unknown evidence', { mode: 0o600 })
      }
      const checkpoint = await f.inspect()
      assert.equal(existsSync(markerPath), true, 'inspection never releases admission')
      assert.equal(lstatSync(markerPath).nlink, seam === 'marker-linked' ? 2 : 1)
      assert.ok('interruptedPublication' in checkpoint)
      assert.equal(checkpoint.interruptedPublication, seam === 'marker-linked')
      if (seam === 'marker-linked') {
        assert.equal(existsSync(publication), true)
        assert.equal(lstatSync(publication).nlink, 2)
        assert.equal(lstatSync(publication).ino, lstatSync(markerPath).ino)
        assert.equal(readFileSync(unknown, 'utf8'), 'retain unknown evidence')
        await assert.rejects(
          offlineMaintenance(f.engine, f.context, {
            action: 'offline-resume',
            target: checkpoint.target,
            revision: '0'.repeat(64),
            offline: offlineAssurance,
          }),
          /Explicit reviewed offline checkpoint resume required/,
        )
        assert.equal(lstatSync(markerPath).nlink, 2, 'unreviewed resume cannot settle either name')
        assert.equal(lstatSync(publication).nlink, 2)
      }
      await offlineMaintenance(f.engine, f.context, {
        action: 'offline-resume',
        target: checkpoint.target,
        revision: checkpoint.revision,
        offline: offlineAssurance,
      })
      assert.equal(existsSync(markerPath), false)
      assert.equal(existsSync(publication), false, 'authorized resume settles the publication pair')
      if (seam === 'marker-linked') assert.equal(readFileSync(unknown, 'utf8'), 'retain unknown evidence')
      assert.equal(existsSync(f.path), false)
      for (const [path, bytes] of f.original)
        assert.deepEqual(readFileSync(join(work, 'snapshot', path)), bytes, path)
      assert.deepEqual(
        readFileSync(join(work, 'quarantine/.lock/owner.json')),
        f.original.get('.lock/owner.json'),
      )
    } finally {
      await f.close()
    }
  })
}

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
