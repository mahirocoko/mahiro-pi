import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setImmediate as yieldTurn } from 'node:timers/promises'
import { initializeMemoryRoot, prepareInitialization } from '../lib/agent-memory/engine/initializer.ts'
import { MemoryEngineController, type OperationContext } from '../lib/agent-memory/engine/controller.ts'
import { engineEnvironment } from '../lib/agent-memory/engine/io.ts'
import { validateReply } from '../lib/agent-memory/engine/replies.ts'
import { createMemoryStore } from '../lib/agent-memory/store.ts'

// Core-tier callback mocks exercise initializer ordering, not native Root/branch authority.
const coreTierContext = () => ({ current: () => true, barrier: async () => {} })

function fixture() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-init-v2-'))
  const cwd = join(directory, 'project')
  const home = join(directory, 'home')
  const root = join(directory, 'memory')
  mkdirSync(cwd, { mode: 0o700 })
  mkdirSync(home, { mode: 0o700 })
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n name = Synthetic initializer\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
    { mode: 0o600 },
  )
  const previous = { ...process.env }
  for (const key of Object.keys(process.env))
    if (key.startsWith('GIT_') || key.startsWith('PI_') || key.includes('API_KEY')) delete process.env[key]
  Object.assign(process.env, {
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: directory,
  })
  const plan = prepareInitialization(cwd, {
    action: 'initialize',
    projectId: 'project',
    core: '# Core\nSynthetic established identity.\n',
  })
  return {
    root,
    directory,
    plan,
    environment: engineEnvironment(),
    close() {
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
test('parent-exclusive initializer matches legacy scaffold/config/ledger and committed projection', async () => {
  const f = fixture()
  const engine = new MemoryEngineController(f.root, f.environment)
  try {
    assert.equal(engine.pid, undefined)
    const result = await initializeMemoryRoot(f.root, f.plan, coreTierContext(), f.environment)
    assert.equal(result.initialized, true)
    assert.equal(engine.pid, undefined, 'no child canonical bootstrap')
    const oracle = createMemoryStore(join(f.directory, 'oracle'))
    oracle.initialize(f.plan.config, f.plan.files['Core.md'])
    for (const path of Object.keys(f.plan.files))
      assert.equal(readFileSync(join(f.root, path), 'utf8'), readFileSync(join(oracle.root, path), 'utf8'))
    assert.deepEqual(createMemoryStore(f.root).snapshot().files, oracle.snapshot().files)
    assert.equal(existsSync(join(f.root, '.bootstrap-v2.json')), false)
    assert.equal(
      (await engine.request('projection', { project: 'project', shared: true }, { current: () => true }))
        .core,
      f.plan.files['Core.md'],
    )
    await assert.rejects(initializeMemoryRoot(f.root, f.plan, coreTierContext(), f.environment), /EEXIST/)
  } finally {
    await engine.close()
    f.close()
  }
})
for (const boundary of ['intent', 'config', 'git-init', 'git-add', 'commit', 'post-head']) {
  test(`initializer interrupted at ${boundary} preserves existing partial root and refuses reseed`, async () => {
    const f = fixture()
    let stopped = false
    const context: OperationContext & { barrier: () => Promise<void> } = {
      barrier: async () => {},
      current(targets) {
        const paths = targets.physical
        const hasRoot = existsSync(f.root)
        const index = existsSync(join(f.root, '.git/index'))
        const head = existsSync(join(f.root, '.git/refs/heads/main'))
        if (
          !stopped &&
          hasRoot &&
          ((boundary === 'intent' && paths.includes(join(f.root, '.bootstrap-v2.json'))) ||
            (boundary === 'config' && paths.includes(join(f.root, 'config.json'))) ||
            (boundary === 'git-init' &&
              paths.includes(join(f.root, '.git')) &&
              !existsSync(join(f.root, '.git'))) ||
            (boundary === 'git-add' && paths.includes(join(f.root, '.git/index')) && !index) ||
            (boundary === 'commit' && index && !head) ||
            (boundary === 'post-head' && head))
        )
          stopped = true
        return !stopped
      },
    }
    try {
      await assert.rejects(initializeMemoryRoot(f.root, f.plan, context, f.environment), /authority/)
      assert.equal(stopped, true)
      assert.equal(existsSync(f.root), true)
      await assert.rejects(initializeMemoryRoot(f.root, f.plan, coreTierContext(), f.environment), /EEXIST/)
    } finally {
      f.close()
    }
  })
}
test('core-tier bootstrap rejects missing or initially rejecting branch barrier with current true and no root', async () => {
  const f = fixture()
  try {
    await assert.rejects(
      Reflect.apply(initializeMemoryRoot, undefined, [
        f.root,
        f.plan,
        { current: () => true },
        f.environment,
      ]),
      /Bootstrap branch barrier required/,
    )
    await assert.rejects(
      initializeMemoryRoot(
        f.root,
        f.plan,
        {
          current: () => true,
          barrier: async () => {
            throw Error('Synthetic bootstrap branch lost')
          },
        },
        f.environment,
      ),
      /branch lost/,
    )
    assert.equal(existsSync(f.root), false)
  } finally {
    f.close()
  }
})
for (const boundary of ['root', 'intent', 'config', 'git-init', 'git-add', 'commit']) {
  test(`core-tier branch lost across await at ${boundary}: current true, no further starts or reseed`, async () => {
    const f = fixture()
    const snapshot = () =>
      readdirSync(f.root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => [
          join(entry.parentPath, entry.name),
          readFileSync(join(entry.parentPath, entry.name)).toString('hex'),
        ])
        .sort(([a], [b]) => a.localeCompare(b))
    let retained: ReturnType<typeof snapshot> | undefined
    let lost = false
    const reached = () => {
      if (boundary === 'root') return existsSync(f.root)
      if (boundary === 'intent') return existsSync(join(f.root, '.bootstrap-v2.json'))
      if (boundary === 'config') return existsSync(join(f.root, 'config.json'))
      if (boundary === 'git-init') return existsSync(join(f.root, '.git'))
      if (boundary === 'git-add') return existsSync(join(f.root, '.git/index'))
      return existsSync(join(f.root, '.git/refs/heads/main'))
    }
    try {
      await assert.rejects(
        initializeMemoryRoot(
          f.root,
          f.plan,
          {
            current: () => true,
            barrier: async () => {
              if (reached()) {
                // Eligibility changes while the independent asynchronous fence is pending.
                retained ??= snapshot()
                await yieldTurn()
                lost = true
              }
              if (lost) throw Error('Synthetic bootstrap branch lost')
            },
          },
          f.environment,
        ),
        /branch lost/,
      )
      assert.equal(lost, true)
      assert.deepEqual(snapshot(), retained, 'no subsequent write, Git start, or cleanup')
      assert.equal(existsSync(f.root), true)
      await assert.rejects(initializeMemoryRoot(f.root, f.plan, coreTierContext(), f.environment), /EEXIST/)
      assert.deepEqual(snapshot(), retained, 'partial root is never repaired or reseeded')
    } finally {
      f.close()
    }
  })
}
test('deep replies reject malformed nested state, mismatched input, invalid chunks and forged plan before ownership', () => {
  for (const [method, input, reply] of [
    ['create', {}, { view: 'not-a-view', base: 'a'.repeat(40) }],
    ['prepare', { view: 'a'.repeat(36) }, { plan: { changes: [] } }],
    ['chunk', { offset: 0 }, { data: '%%%%', hash: 'a'.repeat(64), total: 5 }],
    [
      'chunk',
      { offset: 0 },
      { data: Buffer.alloc(65537).toString('base64'), hash: 'a'.repeat(64), total: 65537 },
    ],
    [
      'projection',
      {},
      {
        revision: 'a'.repeat(40),
        core: '# Core\n',
        index: '# index\n',
        discovery: { version: 2, topics: [{ topic: '../escape', files: 1 }], totalTopics: 1, routes: {} },
      },
    ],
    ['status', {}, { revision: 'a'.repeat(40), files: ['../escape'] }],
    ['offlineCertify', { revision: 'a'.repeat(40) }, { revision: 'b'.repeat(40) }],
  ] as const)
    assert.throws(() => validateReply(method, input, reply))
})

test('deep replies accept exact offline certification and tiered projection namespaces', () => {
  const revision = 'a'.repeat(40)
  validateReply('offlineCertify', { revision }, { revision })
  validateReply(
    'projection',
    { project: 'project' },
    {
      revision,
      core: '# Core\n',
      index: '# index\n',
      system: { 'system/persona.md': '# Persona\n' },
      projectSystem: { 'projects/project/system/overview.md': '# Project\n' },
      discovery: {
        version: 2,
        topics: [
          { topic: 'system', files: 1 },
          { topic: 'system/human', files: 1 },
          { topic: 'projects/project/system', files: 1 },
        ],
        totalTopics: 3,
        routes: {
          namespaces: { topic: '' },
          allFiles: { topic: '*' },
          lexical: 'agent_memory_read query',
        },
      },
    },
  )
})
