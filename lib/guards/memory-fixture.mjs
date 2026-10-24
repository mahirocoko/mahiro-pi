// Native MJS singleton: canonical Root requires this exact file via node:createRequire.
// Selection is construction only, never a DATA/PSS permission or a live-root selector.
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fixtures = new WeakMap()
const selections = new WeakMap()
const bound = new WeakSet()
const diagnostics = new Map()

// Explicit owned-fixture diagnostics only: no installed selector, callbacks or authority.
export function recordMemoryDiagnostic(root, event, fields = {}, error) {
  const record = diagnostics.get(root)
  if (!record) return
  const item = { ms: performance.now() - record.start, event, ...fields }
  if (error) {
    const message = error instanceof Error ? error.message : 'Non-Error rejection'
    item.error =
      /^[A-Za-z0-9 .;:()_→/=-]{1,160}$/.test(message) && !message.includes(root)
        ? message
        : 'Underlying error withheld (nonstructural)'
    item.name = error instanceof Error ? error.name : 'unknown'
  }
  record.count++
  if (record.events.length === 256) record.events.shift()
  record.events.push(item)
  if (error && !record.firstError) record.firstError = item
}

export async function createDisposableMemoryFixture() {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'mahiro-memory-v2-'))
  const home = join(directory, 'home')
  const agentDir = join(directory, 'profile')
  const cwd = join(directory, 'project')
  for (const path of [home, agentDir, cwd]) await mkdir(path, { mode: 0o700 })
  const capability = Object.freeze({})
  const holds = new Set()
  const record = {
    directory,
    home,
    agentDir,
    cwd,
    root: join(directory, 'memory'),
    retired: false,
    hold(owner) {
      if (record.retired || !owner || typeof owner !== 'object') throw Error('Live fixture owner required')
      const token = { owner }
      holds.add(token)
      return () => {
        holds.delete(token)
      }
    },
  }
  fixtures.set(capability, record)
  return Object.freeze({
    capability,
    directory,
    home,
    agentDir,
    cwd,
    root: record.root,
    startDiagnostics() {
      if (record.retired) throw Error('Live fixture required')
      const evidence = { start: performance.now(), count: 0, events: [], firstError: undefined }
      diagnostics.set(record.root, evidence)
      return () => structuredClone(evidence)
    },
    async dispose() {
      if (holds.size) throw Error('Disposable memory fixture still held by active owners')
      diagnostics.delete(record.root)
      record.retired = true // close admission synchronously before the first deletion await
      await rm(directory, { recursive: true, force: true })
    },
  })
}

export function selectManagedMemoryFixture(manager, capability) {
  const fixture = fixtures.get(capability)
  if (
    !fixture ||
    fixture.retired ||
    !manager ||
    typeof manager.getSessionId !== 'function' ||
    typeof manager.getCwd !== 'function' ||
    manager.getCwd() !== fixture.cwd ||
    bound.has(manager) ||
    selections.has(manager)
  )
    throw Error('Fresh owned disposable memory fixture and pre-bind manager required')
  const release = fixture.hold(manager)
  const selection = Object.freeze({
    version: 2,
    root: fixture.root,
    agentDir: fixture.agentDir,
    live: () => !fixture.retired,
    hold: (owner) => fixture.hold(owner),
    release,
  })
  selections.set(manager, selection)
  return () => {
    if (selections.get(manager) === selection) {
      selections.delete(manager)
      release()
    }
  }
}

// Canonical Root calls for EVERY manager, including unselected ABI1, so late selection rejects.
export function consumeManagedMemoryFixture(manager, profile) {
  if (bound.has(manager)) return undefined
  bound.add(manager)
  const selection = selections.get(manager)
  selections.delete(manager)
  if (!selection) return undefined
  if (!selection.live() || profile !== selection.agentDir) {
    selection.release()
    throw Error('Disposable memory profile mismatch')
  }
  // Pending selection hold transfers to Root; Root releases only after its drain.
  return selection
}
