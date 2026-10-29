import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { activateAgentMemory } from '../extensions/mahiro-agent-memory.ts'
import { MemoryEngineController, type OperationContext } from '../lib/agent-memory/engine/controller.ts'
import { engineEnvironment } from '../lib/agent-memory/engine/io.ts'
import { migrationExportSections } from '../lib/agent-memory/migration-export.ts'
import { validateInput } from '../lib/agent-memory/engine/protocol.ts'
import { createExperimentalMemoryRuntime } from '../lib/agent-memory/experimental-runtime.ts'
import { createAgentMemoryRuntime } from '../lib/agent-memory/runtime.ts'
import { createMemoryStore, type MemoryConfig } from '../lib/agent-memory/store.ts'
import { memoryFailureCode } from '../lib/agent-memory/reasons.ts'
import { digest } from '../lib/continuity/records.ts'

const keepText = '# Keep\nKEEP-SENTINEL\n'
const goneText = '# Gone\nGONE-SENTINEL\n'
const dropText = '# Drop\nDROP-SENTINEL\n'
const draftText = '# Draft\nDRAFT-SENTINEL\n'

function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-migration-export-'))
  const home = join(dir, 'home')
  const root = join(dir, 'memory')
  const project = join(dir, 'project')
  mkdirSync(home, { mode: 0o700 })
  mkdirSync(project, { mode: 0o700 })
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n name = Synthetic Fixture\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
    { mode: 0o600 },
  )
  const previous = { ...process.env }
  for (const key of Object.keys(process.env))
    if (key.startsWith('GIT_') || key === 'HOME' || key.startsWith('PI_') || key.includes('API_KEY'))
      delete process.env[key]
  Object.assign(process.env, {
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: dir,
    GIT_TERMINAL_PROMPT: '0',
  })
  const config: MemoryConfig = {
    version: 1,
    automatic: false,
    coreBytes: 8192,
    indexBytes: 2048,
    fileBytes: 8192,
    totalBytes: 65536,
    projects: [{ cwd: project, id: 'project' }],
  }
  const store = createMemoryStore(root, () => {}, 'primary')
  store.initialize(config, '# Core\nSynthetic identity.\n')
  const view = store.createView('project', 120000, true)
  store.edit(view, 'global/keep.md', null, keepText, ['source-keep'])
  store.edit(view, 'global/gone.md', null, goneText, ['source-gone'])
  store.edit(view, 'global/sourced.md', null, dropText, ['source-drop'])
  const integrated = store.integrate(view, ['episode-one'])
  assert.ok(!('conflict' in integrated))
  store.forget(integrated.revision, ['global/gone.md'], ['source-drop'], 'project')
  const draft = store.createView('project', 120000, true)
  store.edit(draft, 'global/draft.md', null, draftText, ['source-draft'])
  const env = engineEnvironment(process.env)
  const engine = new MemoryEngineController(root, env)
  const context: OperationContext = { current: () => true }
  return {
    dir,
    root,
    project,
    store,
    engine,
    context,
    close: async () => {
      const exit = await engine.close()
      assert.equal(exit.code, 0)
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

async function collect(
  revision: string,
  read: (section: string, offset: number) => Promise<Record<string, unknown>>,
) {
  const pages = []
  for (const section of migrationExportSections) {
    let offset = 0
    for (;;) {
      const page = await read(section, offset)
      pages.push(page)
      assert.equal(page.revision, revision)
      assert.ok(Array.isArray(page.entries))
      assert.ok((page.entries as unknown[]).length <= 2)
      if (page.nextOffset === undefined) break
      assert.equal(page.nextOffset, offset + (page.entries as unknown[]).length)
      offset = page.nextOffset as number
    }
  }
  return pages
}

test('public manage schema reserves migration-export as a bounded read', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-migration-schema-'))
  const previous = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = dir
  const tools: {
    name: string
    description: string
    parameters: { properties: { action: { enum: string[] } } }
  }[] = []
  const pi = {
    on: () => () => {},
    registerCommand: () => {},
    registerTool: (tool: (typeof tools)[number]) => {
      tools.push(tool)
    },
    getAllTools: () => tools,
  }
  try {
    activateAgentMemory(pi as unknown as ExtensionAPI)
    const manage = tools.find((tool) => tool.name === 'agent_memory_manage')
    assert.ok(manage)
    assert.ok(manage.parameters.properties.action.enum.includes('migration-export'))
    assert.match(manage.description, /migration-export/)
    assert.match(manage.description, /no file text/)
    assert.match(manage.description, /32/)
    assert.equal(
      manage.description.includes('migration-export') &&
        manage.parameters.properties.action.enum.includes('palace'),
      true,
    )
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ABI1 and ABI2 migration export pages stay on one revision and omit text', async () => {
  const f = fixture()
  try {
    const revision = f.store.snapshot().revision
    const ledgerText = execFileSync('git', ['--no-pager', 'show', `${revision}:.memory.json`], {
      cwd: f.root,
      encoding: 'utf8',
    })
    const hidden = ledgerText
    assert.match(hidden, /source-keep/)
    const readStore = async (section: string, offset: number) =>
      f.store.migrationExport('project', { revision, section, offset, limit: 2 }) as unknown as Record<
        string,
        unknown
      >
    const first = await collect(revision, readStore)
    const second = await collect(revision, readStore)
    assert.deepEqual(second, first)
    const encoded = JSON.stringify(first)
    for (const sentinel of [
      'KEEP-SENTINEL',
      'GONE-SENTINEL',
      'DROP-SENTINEL',
      'DRAFT-SENTINEL',
      f.root,
      f.project,
    ])
      assert.equal(encoded.includes(sentinel), false, sentinel)
    const digests = new Set(first.map((page) => page.ledgerDigest))
    const revisions = new Set(first.map((page) => page.revision))
    const hashes = new Set(first.map((page) => page.configHash))
    assert.equal(digests.size, 1)
    assert.equal(revisions.size, 1)
    assert.equal(hashes.size, 1)
    const binding = first.find((page) => page.section === 'binding')
    const counts = (binding?.entries as { activeFiles: number; forgottenPaths: number }[])[0]
    assert.equal(counts.forgottenPaths, 1)
    assert.ok(counts.activeFiles >= 3)
    const sources = first
      .filter((page) => page.section === 'sources')
      .flatMap((page) => page.entries as { path: string; sources: string[]; hash: string }[])
    assert.ok(
      sources.some((entry) => entry.path === 'global/keep.md' && entry.sources.includes('source-keep')),
    )
    assert.equal(sources.find((entry) => entry.path === 'global/keep.md')?.hash, digest(keepText))
    assert.ok(sources.every((entry) => /^[a-f0-9]{64}$/.test(entry.hash)))
    assert.equal(
      sources.some((entry) => entry.path === 'global/gone.md' || entry.path === 'global/sourced.md'),
      false,
    )
    assert.equal(
      sources.some((entry) => entry.path === 'global/draft.md'),
      false,
    )
    const forgotten = first
      .filter((page) => page.section === 'forgotten-paths')
      .flatMap((page) => page.entries as string[])
    assert.deepEqual(forgotten, ['global/gone.md'])
    const forgottenSources = first
      .filter((page) => page.section === 'forgotten-sources')
      .flatMap((page) => page.entries as { project: string | null; source: string }[])
    assert.ok(forgottenSources.some((entry) => entry.source === 'source-drop' && entry.project === null))
    assert.ok(forgottenSources.some((entry) => entry.source === 'source-drop' && entry.project === 'project'))
    const reviewed = first
      .filter((page) => page.section === 'reviewed')
      .flatMap((page) => page.entries as string[])
    assert.deepEqual(reviewed, ['episode-one'])
    const enginePages = await collect(revision, async (section, offset) => {
      const result = await f.engine.request(
        'manage',
        { action: 'migration-export', project: 'project', revision, section, offset, limit: 2 },
        f.context,
      )
      assert.ok('migrationExport' in result)
      return result.migrationExport as Record<string, unknown>
    })
    assert.deepEqual(enginePages, first)
    const palace = await f.engine.request('manage', { action: 'palace', project: 'project' }, f.context)
    assert.ok('palace' in palace)
    assert.equal('migrationExport' in palace, false)
    const tombstones = palace.palace.tombstones as { forgottenPaths: number }
    assert.equal(typeof tombstones.forgottenPaths, 'number')
    const unbound = f.store.migrationExport('project', { revision, section: 'binding' })
    assert.equal(unbound.limit, 32)
    assert.equal(unbound.entries.length, 1)
    const view = f.store.createView('project', 120000, true)
    f.store.edit(view, 'global/later.md', null, '# Later\nLATER-SENTINEL\n', ['source-later'])
    const moved = f.store.integrate(view)
    assert.ok(!('conflict' in moved))
    assert.notEqual(f.store.snapshot().revision, revision)
    await assert.rejects(
      async () => {
        f.store.migrationExport('project', { revision, section: 'sources', offset: 0, limit: 2 })
      },
      (error: unknown) => {
        assert.equal(memoryFailureCode(error).reason, 'CAS')
        return true
      },
    )
    await assert.rejects(
      () =>
        f.engine.request(
          'manage',
          {
            action: 'migration-export',
            project: 'project',
            revision,
            section: 'sources',
            offset: 0,
            limit: 2,
          },
          f.context,
        ),
      (error: unknown) => {
        assert.equal(memoryFailureCode(error).reason, 'CAS')
        assert.equal((error as Error).message.includes('LATER-SENTINEL'), false)
        return true
      },
    )
    assert.throws(
      () =>
        validateInput('manage', {
          action: 'migration-export',
          project: 'project',
          revision,
          section: 'sources',
          limit: 33,
        }),
      /Invalid memory migration export/,
    )
    assert.throws(
      () => validateInput('manage', { action: 'migration-export', project: 'project', section: 'binding' }),
      /Expected current memory revision/,
    )
  } finally {
    await f.close()
  }
})

test('full migration-export requests authorize as reads in ABI1 and ABI2', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'mahiro-migration-auth-'))
  const home = join(dir, 'home')
  const root = join(dir, 'memory')
  const project = join(dir, 'project')
  mkdirSync(home, { mode: 0o700 })
  mkdirSync(project, { mode: 0o700 })
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n name = Synthetic Fixture\n email = fixture@example.invalid\n[init]\n defaultBranch = main\n',
    { mode: 0o600 },
  )
  const previous = { ...process.env }
  for (const key of Object.keys(process.env))
    if (key.startsWith('GIT_') || key === 'HOME' || key.startsWith('PI_') || key.includes('API_KEY'))
      delete process.env[key]
  Object.assign(process.env, {
    HOME: home,
    PI_CODING_AGENT_DIR: dir,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    GIT_CEILING_DIRECTORIES: dir,
    GIT_TERMINAL_PROMPT: '0',
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
      projects: [{ cwd: project, id: 'project' }],
    },
    '# Core\nSynthetic identity.\n',
  )
  const revision = store.snapshot().revision
  const args = { action: 'migration-export', revision, section: 'binding', offset: 0, limit: 32 }
  const generation = {}
  const manager = {
    getSessionId: () => 'primary',
    getBranch: () => [{ id: 'a' }],
    getSessionFile: () => undefined,
  }
  const ctx = { cwd: project, sessionManager: manager, isIdle: () => true }
  const record = (operations: string[]) => ({
    trustedTool: (tool: { name?: string }) => tool.name === 'agent_memory_manage',
    isPrimarySession: () => true,
    assertAccess(_tool: unknown, _ctx: unknown, _root: unknown, operation: string) {
      operations.push(`access:${operation}`)
      if (operation !== 'read') throw Error('write authorization requested')
      return { kind: 'primary' }
    },
    async authorize(_tool: unknown, _ctx: unknown, _root: unknown, operation: string) {
      operations.push(`authorize:${operation}`)
      if (operation !== 'read') throw Error('write authorization requested')
      return { kind: 'primary' }
    },
    parentService: () => undefined,
    bindWorker: () => () => {},
  })
  const abi1Ops: string[] = []
  const tool = { name: 'agent_memory_manage' }
  const handlers = new Map<string, Function[]>()
  const pi1 = {
    on(name: string, fn: Function) {
      const list = handlers.get(name) ?? []
      list.push(fn)
      handlers.set(name, list)
    },
    getAllTools: () => [tool],
  }
  const nodes1 = new Map([
    [
      'primary',
      { generation, healthy: () => true, managedMemory: { version: 1, generation, ...record(abi1Ops) } },
    ],
  ])
  const abi1 = createAgentMemoryRuntime(pi1 as never, { root, nodes: nodes1 as never })
  const handlers2 = new Map<string, Function[]>()
  const pi2 = {
    on(name: string, fn: Function) {
      const list = handlers2.get(name) ?? []
      list.push(fn)
      handlers2.set(name, list)
    },
    getAllTools: () => [tool],
  }
  const abi2Ops: string[] = []
  const abi2Node = {
    generation,
    healthy: () => true,
    managedMemory: {
      version: 2,
      generation,
      root,
      live: () => true,
      hold: () => () => {},
      onRetire: () => () => {},
      assertTargets() {
        return { kind: 'primary' }
      },
      maintenanceAccess() {
        return { kind: 'primary' }
      },
      ...record(abi2Ops),
    },
  }
  const nodes2 = new Map([['primary', abi2Node]])
  const globals = globalThis as unknown as Record<symbol, unknown>
  const registry = Symbol.for('@mahirocoko/pi-guards:healthy-nodes')
  const oldRegistry = globals[registry]
  globals[registry] = nodes2
  const abi2 = createExperimentalMemoryRuntime(pi2 as never)
  try {
    for (const handler of handlers.get('session_start') ?? []) await handler(undefined, ctx)
    const page = (await abi1.run('agent_memory_manage', args, ctx as never)) as { section: string }
    assert.equal(page.section, 'binding')
    assert.ok(abi1Ops.includes('authorize:read'))
    assert.equal(
      abi1Ops.every((entry) => entry.endsWith(':read')),
      true,
    )
    for (const handler of handlers2.get('session_start') ?? []) await handler(undefined, ctx)
    const enginePage = (await abi2.run('agent_memory_manage', args, ctx as never)) as { section: string }
    assert.equal(enginePage.section, 'binding')
    assert.ok(abi2Ops.includes('authorize:read'))
    assert.equal(
      abi2Ops.some((entry) => entry.endsWith(':write')),
      false,
    )
  } finally {
    abi1.cancel()
    await abi2.cancel()
    await abi2.drain()
    globals[registry] = oldRegistry
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, previous)
    rmSync(dir, { recursive: true, force: true })
  }
})
