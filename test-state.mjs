// Tooling-only state accounting and exact disposable fixture ownership.
import fs from 'node:fs'
import path from 'node:path'

export const STATE_MAX_BYTES = 1024 ** 3
export const STATE_MAX_ENTRIES = 100000
export const STATE_ROOT_ENV = 'MAHIRO_PI_TEST_STATE_ROOT'

function assertDirectoryChain(target) {
  let cursor = path.parse(target).root
  for (const part of target.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part)
    if (!fs.existsSync(cursor)) {
      // lstat also rejects dangling symlinks.
      try {
        fs.lstatSync(cursor)
        throw new Error(`Unsafe state path: ${cursor}`)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      continue
    }
    const stat = fs.lstatSync(cursor)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe state path: ${cursor}`)
  }
}

export function stateRoot(checkoutRoot) {
  const root = process.env[STATE_ROOT_ENV] || path.join(fs.realpathSync(checkoutRoot), '.agent-state')
  if (!path.isAbsolute(root) || path.normalize(root) !== root || path.basename(root) !== '.agent-state')
    throw new Error('Unsafe test state-root identity')
  assertDirectoryChain(root)
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(root), 'package.json'), 'utf8'))
  if (manifest.name !== '@mahirocoko/mahiro-pi') throw new Error('Unsafe test state-root owner')
  return root
}

// lstat counts link bytes, never the linked target. Streaming traversal bounds entry memory too.
export function measureState(root, { maxBytes = STATE_MAX_BYTES, maxEntries = STATE_MAX_ENTRIES } = {}) {
  assertDirectoryChain(root)
  let bytes = 0
  let entries = 0
  function visit(target) {
    const stat = fs.lstatSync(target)
    if (++entries > maxEntries) throw new Error('State entry budget exceeded')
    bytes += stat.size
    if (bytes >= maxBytes) throw new Error(`State byte budget exceeded: ${bytes} >= ${maxBytes}`)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return
    const directory = fs.opendirSync(target)
    try {
      let entry
      while ((entry = directory.readSync())) visit(path.join(target, entry.name))
    } finally {
      directory.closeSync()
    }
  }
  if (fs.existsSync(root)) visit(root)
  return { bytes, entries, maxBytes }
}

const owned = new Set()
process.once('exit', () => {
  for (const cleanup of owned) {
    try {
      cleanup()
    } catch {
      // Unsafe/replaced paths are deliberately not removed by fallback cleanup.
    }
  }
})

export function stateRuntimeDirectory(checkoutRoot, directory) {
  const bound = stateRoot(checkoutRoot)
  const runtime = path.join(bound, 'runtime')
  const base = path.resolve(directory)
  if (base !== runtime && !base.startsWith(`${runtime}${path.sep}`))
    throw new Error('Fixture must be under bound state runtime')
  assertDirectoryChain(base)
  fs.mkdirSync(base, { recursive: true, mode: 0o700 })
  return base
}

export function createStateFixture(checkoutRoot, evidenceBase, prefix) {
  const bound = stateRoot(checkoutRoot)
  process.env[STATE_ROOT_ENV] = bound
  measureState(bound)
  if (!/^[a-z][a-z0-9-]*-$/.test(prefix)) throw new Error('Unsafe fixture prefix')
  const base = stateRuntimeDirectory(checkoutRoot, evidenceBase)
  const root = fs.mkdtempSync(path.join(base, prefix))
  const identity = fs.lstatSync(root)
  let removed = false
  const cleanup = () => {
    if (removed) return
    assertDirectoryChain(base)
    if (fs.existsSync(root)) {
      const current = fs.lstatSync(root)
      if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino)
        throw new Error('Owned fixture identity changed; refusing cleanup')
      fs.rmSync(root, { recursive: true, force: true })
    } else {
      try {
        fs.lstatSync(root)
        throw new Error('Owned fixture replaced with dangling link')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    removed = true
    owned.delete(cleanup)
  }
  owned.add(cleanup)
  return { root, cleanup, check: () => measureState(bound) }
}

export function cleanupStateFixtures(checkoutRoot, fixtures) {
  const failures = []
  try {
    measureState(stateRoot(checkoutRoot))
  } catch (error) {
    failures.push(error)
  }
  for (const fixture of [...fixtures].reverse()) {
    try {
      fixture.cleanup()
    } catch (error) {
      failures.push(error)
    }
  }
  let result
  try {
    result = measureState(stateRoot(checkoutRoot))
  } catch (error) {
    failures.push(error)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Fixture cleanup or state budget failed')
  return result
}
