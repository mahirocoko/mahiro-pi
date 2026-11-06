import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  createInstalledMemoryOwner,
  memorySelectionPath,
  parseMemorySelection,
  readMemorySelection,
} from '../lib/agent-memory/profile.ts'
import {
  installedWriter,
  preflightWriterRoute,
  renderWriterTemplate,
  validateWriterTemplate,
} from '../lib/agent-memory/writer-route.ts'

const parent = new URL('../.agent-state/runtime/', import.meta.url).pathname
const template = readFileSync(new URL('../agents/managed-memory-writer.md', import.meta.url), 'utf8')

test('ordinary selection is bounded profile metadata, not a fixture capability or corpus migration', async () => {
  const dir = mkdtempSync(join(parent, 'memory-selection-'))
  try {
    assert.equal(readMemorySelection(dir), undefined, 'no record leaves ABI1 compatibility')
    const selection = { version: 2 as const, root: join(dir, 'memory'), mode: 'engine' as const }
    writeFileSync(memorySelectionPath(dir), JSON.stringify(selection), { mode: 0o600 })
    assert.deepEqual(readMemorySelection(dir), selection)
    for (const value of [
      { ...selection, extra: true },
      { ...selection, version: 1 },
      { ...selection, root: '/other' },
      { ...selection, mode: 'invented' },
    ])
      assert.throws(() => parseMemorySelection(JSON.stringify(value), dir), /Invalid memory engine/)
    for (const mode of ['off', 'legacy'])
      assert.equal(parseMemorySelection(JSON.stringify({ ...selection, mode }), dir).mode, mode)
    const owner = createInstalledMemoryOwner(selection)
    const release = owner.hold({})
    owner.retire()
    assert.equal(owner.live(), false, 'retirement fences synchronously')
    assert.throws(() => owner.hold({}), /retired/)
    let drained = false
    const drain = owner.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    assert.equal(drained, false)
    release()
    await drain
    assert.equal(drained, true)
    rmSync(memorySelectionPath(dir))
    writeFileSync(join(dir, 'target'), JSON.stringify(selection), { mode: 0o600 })
    symlinkSync(join(dir, 'target'), memorySelectionPath(dir))
    assert.throws(() => readMemorySelection(dir), /Unsafe/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('installed canonical descriptor alone owns portable route; every other byte remains strict', () => {
  const dir = mkdtempSync(join(parent, 'memory-route-'))
  try {
    mkdirSync(join(dir, 'agents'), { mode: 0o700 })
    const rendered = renderWriterTemplate({ model: 'faux/reviewed-v1', thinking: 'off' }, template)
    assert.deepEqual(validateWriterTemplate(rendered), { model: 'faux/reviewed-v1', thinking: 'off' })
    for (const text of [
      rendered + '\n',
      rendered.replace('max_turns: 8', 'max_turns: 9'),
      rendered.replace('locked: true', 'locked: false'),
      rendered.replace('You maintain', 'Please maintain'),
      rendered.replace('thinking: off', 'thinking: arbitrary'),
    ])
      assert.throws(() => validateWriterTemplate(text))
    const path = join(dir, 'agents/managed-memory-writer.md')
    writeFileSync(path, rendered, { mode: 0o600 })
    assert.equal(installedWriter(dir).model, 'faux/reviewed-v1')
    const role = {
      name: 'managed-memory-writer',
      model: 'faux/reviewed-v1',
      thinking: 'off',
      locked: true as const,
      promptMode: 'replace' as const,
      inheritContext: false,
      runInBackground: true,
      toolNames: ['agent_memory_read', 'agent_memory_edit', 'agent_memory_commit'],
    }
    assert.equal(installedWriter(dir, role).thinking, 'off')
    assert.throws(() => installedWriter(dir, { ...role, model: 'faux/other' }), /Locked native/)
    const inherited = renderWriterTemplate({ model: 'inherit', thinking: 'medium' }, rendered)
    assert.equal(inherited, template)
    assert.deepEqual(validateWriterTemplate(inherited), { model: 'inherit', thinking: 'medium' })
    writeFileSync(path, inherited)
    assert.equal(installedWriter(dir, { ...role, model: undefined, thinking: 'medium' }).model, 'inherit')
    assert.throws(() => installedWriter(dir, role), /Locked native/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('physical preflight rejects unavailable descriptor despite available parent/similar model and never resolves auth', () => {
  const physical = {
    provider: 'faux',
    id: 'writer',
    api: 'faux-api',
    baseUrl: 'https://invalid.example',
    reasoning: true,
  }
  let all = [physical],
    available = [physical],
    found = physical
  const registry = {
    getAll: () => all,
    getAvailable: () => available,
    find: () => found,
    getApiKeyAndHeaders: () => {
      throw Error('No credential lookup allowed')
    },
  }
  const ctx = { modelRegistry: registry } as unknown as ExtensionContext
  const route = { model: 'faux/writer', thinking: 'medium' as const }
  assert.equal(preflightWriterRoute(ctx, route), route)
  const parent = { ...physical, id: 'writer-similar' }
  available = [parent]
  assert.throws(() => preflightWriterRoute(ctx, route), /unavailable/)
  all = [parent]
  found = parent
  assert.throws(() => preflightWriterRoute(ctx, route), /unavailable/)
  all = [{ ...physical, api: 'pi-virtual' }]
  available = all
  found = all[0]
  assert.throws(() => preflightWriterRoute(ctx, route), /unavailable/)
  all = [{ ...physical, reasoning: false }]
  available = all
  found = all[0]
  assert.throws(() => preflightWriterRoute(ctx, route), /thinking/)
  assert.equal(preflightWriterRoute(ctx, { ...route, thinking: 'off' }).model, route.model)
  all = [physical]
  available = all
  found = physical
  assert.throws(() => preflightWriterRoute(ctx, { ...route, thinking: 'xhigh' }), /thinking/)
})

test('inherited writer resolves each current main model without changing fixed routes or resolving auth', () => {
  const first = {
    provider: 'faux',
    id: 'first',
    api: 'faux-api',
    baseUrl: 'https://invalid.example',
    reasoning: true,
  }
  const second = { ...first, id: 'second', reasoning: false }
  const models = [first, second]
  const ctx = {
    model: first,
    modelRegistry: {
      getAll: () => models,
      getAvailable: () => models,
      find: (provider: string, id: string) => models.find((m) => m.provider === provider && m.id === id),
      getApiKeyAndHeaders: () => {
        throw Error('No credential lookup allowed')
      },
    },
  } as unknown as ExtensionContext
  const inherited = { model: 'inherit', thinking: 'medium' as const }
  const pinned = preflightWriterRoute(ctx, inherited)
  assert.deepEqual(pinned, { model: 'faux/first', thinking: 'medium' })
  ctx.model = second as ExtensionContext['model']
  assert.deepEqual(preflightWriterRoute(ctx, inherited), { model: 'faux/second', thinking: 'off' })
  assert.deepEqual(preflightWriterRoute(ctx, pinned), pinned, 'explicit routes do not follow main changes')
  assert.deepEqual(pinned, { model: 'faux/first', thinking: 'medium' }, 'queued options stay pinned')
  ctx.model = undefined
  assert.throws(() => preflightWriterRoute(ctx, inherited), /Current primary/)
  ctx.model = { ...first, api: 'pi-virtual' } as ExtensionContext['model']
  // Virtual primary routes cannot gain authority from a matching physical ID.
  assert.throws(() => preflightWriterRoute(ctx, inherited), /unavailable/)
})
