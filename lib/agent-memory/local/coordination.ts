import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { constants, lstatSync, openSync, closeSync, fstatSync, readFileSync, realpathSync } from 'node:fs'
import { open, unlink } from 'node:fs/promises'
import { join } from 'node:path'

// Cooperative current-version exclusion, not a stale-lock recovery or hostile-user protocol.
const active = new AsyncLocalStorage<LocalMemoryClaim>()

export class LocalGitUncertainty extends Error {
  constructor(reason: string) {
    super(`Local Git uncertain (${reason})`)
    this.name = 'LocalGitUncertainty'
  }
}

export function hasLocalMemoryClaim(): boolean {
  return active.getStore() !== undefined
}

export function localMemoryClaimPath(root: string): string {
  return `${root}.operation-claim`
}

function readRecord(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) throw Error('Local memory claim refused')
    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}

function nonceAt(root: string): string | null {
  let text: string
  try {
    text = readRecord(join(root, 'meta.json'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const meta = JSON.parse(text)
  if (meta.version !== 1 || !/^[a-f0-9]{32}$/.test(meta.nonce)) throw Error('Local memory state refused')
  return meta.nonce
}

export class LocalMemoryClaim {
  private poisoned = false
  private held = true
  private nonce: string | null
  private root: string
  private readonly dev: string
  private readonly ino: string
  readonly stateRoot: string
  private readonly path: string
  private readonly token: string
  private readonly fileDev: string
  private readonly fileIno: string

  constructor(
    stateRoot: string,
    path: string,
    token: string,
    fileDev: string,
    fileIno: string,
    rootIdentity: { dev: string; ino: string; nonce: string | null },
  ) {
    this.stateRoot = stateRoot
    this.path = path
    this.token = token
    this.fileDev = fileDev
    this.fileIno = fileIno
    this.root = stateRoot
    this.dev = rootIdentity.dev
    this.ino = rootIdentity.ino
    this.nonce = rootIdentity.nonce
  }

  poison(): void {
    this.poisoned = true
  }

  verify(): void {
    if (!this.held || this.poisoned) throw Error('Local memory claim blocked')
    try {
      const file = lstatSync(this.path)
      if (
        !file.isFile() ||
        file.isSymbolicLink() ||
        file.nlink !== 1 ||
        String(file.dev) !== this.fileDev ||
        String(file.ino) !== this.fileIno ||
        JSON.parse(readRecord(this.path)).token !== this.token
      )
        throw Error('claim')
      const root = lstatSync(this.root)
      if (
        !root.isDirectory() ||
        root.isSymbolicLink() ||
        realpathSync(this.root) !== this.root ||
        String(root.dev) !== this.dev ||
        String(root.ino) !== this.ino
      )
        throw Error('root')
      const nonce = nonceAt(this.root)
      if (this.nonce !== null && nonce !== this.nonce) throw Error('nonce')
      // Startup may create v1 meta exactly once while this claim is held.
      if (this.nonce === null && nonce !== null) this.nonce = nonce
    } catch {
      this.poison()
      throw Error('Local memory claim identity refused')
    }
  }

  pin(): () => void {
    this.verify()
    const dev = this.dev
    const ino = this.ino
    const nonce = this.nonce
    return () => {
      const current = requireLocalMemoryClaim(this.stateRoot)
      current.verify()
      if (current.dev !== dev || current.ino !== ino || current.nonce !== nonce) {
        current.poison()
        throw Error('Local memory repository refused')
      }
    }
  }

  movedTo(path: string): void {
    this.root = path
    this.verify()
  }

  cleanupAllowed(): boolean {
    if (this.poisoned || !this.held) return false
    this.verify()
    return true
  }

  async release(): Promise<void> {
    if (this.poisoned) {
      this.held = false
      return
    }
    this.verify()
    await unlink(this.path)
    this.held = false
  }
}

export function requireLocalMemoryClaim(root: string): LocalMemoryClaim {
  const claim = active.getStore()
  if (!claim || claim.stateRoot !== root) throw Error('Local memory claim required')
  claim.verify()
  return claim
}

// Shared low-level helpers also serve standalone synthetic fixtures. Within a service
// transaction every mutation/Git admission rechecks the exact holder, root and nonce.
export function verifyLocalMemoryClaim(): void {
  active.getStore()?.verify()
}

export function localMemoryCleanupAllowed(): boolean {
  return active.getStore()?.cleanupAllowed() ?? true
}

export function poisonLocalMemoryClaim(): void {
  active.getStore()?.poison()
}

export async function withLocalMemoryClaim<T>(
  root: string,
  operation: string,
  body: (claim: LocalMemoryClaim) => Promise<T>,
): Promise<T> {
  if (active.getStore()) throw Error('Local memory recursive claim refused')
  const path = localMemoryClaimPath(root)
  // Deliberately no exists/read/PID/age check before the exclusive create.
  const handle = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
    0o600,
  ).catch(() => {
    throw Error('Local memory claim blocked')
  })
  let claim: LocalMemoryClaim | undefined
  try {
    const file = await handle.stat()
    const stat = lstatSync(root)
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root)
      throw Error('Local memory claim refused')
    const identity = { dev: String(stat.dev), ino: String(stat.ino), nonce: nonceAt(root) }
    const token = randomBytes(24).toString('hex')
    await handle.writeFile(
      `${JSON.stringify({ version: 1, token, ...identity, operation, pid: process.pid })}\n`,
    )
    claim = new LocalMemoryClaim(root, path, token, String(file.dev), String(file.ino), identity)
    return await active.run(claim, async () => {
      try {
        return await body(claim!)
      } catch (error) {
        if (error instanceof LocalGitUncertainty) claim!.poison()
        throw error
      }
    })
  } finally {
    await handle.close()
    // A partial acquisition remains blocking too; never guess whether it is safe.
    if (claim) await claim.release()
  }
}
