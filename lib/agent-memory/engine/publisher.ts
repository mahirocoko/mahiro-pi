import { createHash, randomUUID } from 'node:crypto'
import { publicMemoryError, publicReceipt } from '../reasons.ts'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MemoryEngineController, assertCurrent, type OperationContext } from './controller.ts'
import { engineEnvironment, gitSafety, privateDirectory, runGit, safePath } from './io.ts'
import type { Plan, Receipt, Stage } from './protocol.ts'
import { startGitMutation } from './native-git.ts'
import { allowedPath, limits } from './schema.ts'
import { reserveExecutor, executorOwnsLock } from './executor.ts'
import { acquireOperationLock, releaseOperationLock } from './owned-lock.ts'
import type { LockOwner } from './operation.ts'
import { recordMemoryDiagnostic } from '../../guards/memory-fixture.mjs'

export interface PublicationResult extends Receipt {
  mutated: boolean
  commitStarted: boolean
  lockRetained: boolean
}
// Only fixed native actions. No child permit, command endpoint, shell, Git config override,
// identity override, hook bypass, force cleanup, lock stealing or uncertain replay.
export class MemoryPublisher {
  private busy = false
  private engine: MemoryEngineController
  private environment: NodeJS.ProcessEnv
  constructor(engine: MemoryEngineController, environment: NodeJS.ProcessEnv = engineEnvironment()) {
    this.engine = engine
    this.environment = environment
  }
  async publish(plan: Plan, context: OperationContext): Promise<PublicationResult> {
    if (this.busy) throw Error('Publication already in progress')
    if (!this.engine.ownsPlan(plan)) throw Error('Parent-owned prepared plan required')
    assertCurrent(context)
    const executor = reserveExecutor(this.engine.root, plan)
    const release = context.hold?.({ publisher: this, plan })
    this.busy = true // reserve before the first await
    const root = this.engine.root
    const lock = join(root, '.lock')
    let locked = false
    let lockAttempted = false // acquisition can create an anonymous lock before a durability error
    let lockOwner: LockOwner | undefined
    let output: PublicationResult | undefined
    let mutated = false
    let commitStarted = false
    let stage: Stage = 'prepared'
    let receipt: Receipt = { stage }
    const request = <M extends 'journal' | 'fence' | 'chunk' | 'reconcile'>(
      method: M,
      input: Parameters<MemoryEngineController['request']>[1],
    ) => this.engine.request(method, input as never, context)
    const journal = async (next: Receipt) => {
      await request('journal', { plan: plan.id, digest: plan.digest, receipt: next })
      stage = next.stage
      recordMemoryDiagnostic(root, 'publisher-stage', { stage })
    }
    const current = (physical: string[], logical: string[] = []) =>
      assertCurrent(context, { physical, logical, kind: 'data' })
    const syncDirectory = async (path: string, logical: string[] = []) => {
      current([path], logical)
      const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        current([path], logical)
        await fd.sync()
      } finally {
        await fd.close()
      }
    }
    const gitCheck = () =>
      gitSafety(
        root,
        async (targets) => {
          assertCurrent(context, targets)
        },
        plan.changes.map((change) => change.path),
      )
    const fence = async () => {
      const started = performance.now()
      await context.barrier?.()
      await request('fence', { plan: plan.id, digest: plan.digest })
      await context.barrier?.()
      assertCurrent(context)
      recordMemoryDiagnostic(root, 'publisher-fence', { duration: performance.now() - started })
    }
    try {
      if (
        plan.changes.length > limits.changes ||
        plan.changes.some(
          (item) =>
            !(item.path === '.memory.json' || allowedPath(item.path)) ||
            !Number.isSafeInteger(item.size) ||
            item.size < 0 ||
            item.size > (item.path === '.memory.json' ? limits.ledger : limits.file),
        )
      )
        throw Error('Invalid fixed publication plan')
      await fence()
      await gitCheck()
      await safePath(lock)
      lockAttempted = true
      lockOwner = await acquireOperationLock(root, plan.id, plan.digest, executor.nonce, context)
      locked = true
      await this.engine.request('claim', { plan: plan.id, digest: plan.digest, owner: lockOwner }, context)
      await fence()
      // The child preflight is advisory data; repeat dirty/index check under cross-process lock.
      await gitCheck()
      current([root, join(root, '.git')])
      const dirty = await runGit(
        root,
        ['status', '--porcelain', '--untracked-files=no'],
        engineEnvironment(this.environment),
      )
      if (dirty.toString().trim()) throw Error('Uncommitted work blocks publication')
      await fence()
      const pathBatches: string[][] = []
      for (const change of plan.changes) {
        const batch = pathBatches.at(-1)
        const size = Buffer.byteLength(change.path) + 1
        if (
          !batch ||
          batch.length >= 256 ||
          batch.reduce((n, path) => n + Buffer.byteLength(path) + 1, 0) + size > 65536
        )
          pathBatches.push([change.path])
        else batch.push(change.path)
      }
      const trackedPaths = new Set<string>()
      for (const batch of pathBatches) {
        current([root, join(root, '.git')], batch)
        const output = await runGit(
          root,
          ['ls-files', '-z', '--', ...batch],
          engineEnvironment(this.environment),
        )
        for (const path of output.toString('utf8').split('\0').filter(Boolean)) trackedPaths.add(path)
      }
      const writes = plan.changes.filter((change) => change.hash !== null)
      const engineDirectory = join(root, '.views', '.engine-v2')
      const staging = join(engineDirectory, 'staging', plan.id)
      if (writes.length) {
        for (const parent of [join(root, '.views'), engineDirectory]) {
          current(
            [parent],
            writes.map((change) => change.path),
          )
          await privateDirectory(parent)
        }
        for (const parent of [dirname(staging), staging]) {
          current(
            [parent],
            writes.map((change) => change.path),
          )
          await privateDirectory(parent, true)
          await syncDirectory(
            dirname(parent),
            writes.map((change) => change.path),
          )
        }
        assertCurrent(context, {
          physical: [root, join(root, '.git'), staging],
          logical: writes.map((change) => change.path),
          kind: 'git',
        })
        await runGit(root, ['check-ignore', '-q', '--', staging], engineEnvironment(this.environment))
      }
      if (plan.changes.length) await journal({ stage: 'worktree_mutating' })
      for (let index = 0; index < plan.changes.length; index++) {
        if (index % 32 === 0) await fence()
        const change = plan.changes[index]
        const path = join(root, change.path)
        await safePath(path)
        let existing = false
        try {
          const stat = await lstat(path)
          if (!stat.isFile() || stat.nlink !== 1 || (change.hash !== null && stat.mode & 0o077))
            throw Error('Unsafe canonical file')
          existing = true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        current([root, join(root, '.git'), path], [change.path])
        if (existing && !trackedPaths.has(change.path)) throw Error('Untracked collision blocks publication')
        if (change.hash === null) {
          current([path], [change.path])
          mutated = true
          await unlink(path)
          await syncDirectory(dirname(path), [change.path])
          continue
        }
        const directory = dirname(path)
        await safePath(directory)
        current([directory], [change.path])
        mutated = true
        await mkdir(directory, { mode: 0o700, recursive: true })
        for (let parent = directory; parent !== root; parent = dirname(parent))
          await syncDirectory(dirname(parent), [change.path])
        const temp = join(staging, `${randomUUID()}.tmp`)
        current([directory, staging, temp], [change.path])
        if ((await lstat(directory)).dev !== (await lstat(staging)).dev)
          throw Error('Publication staging must share canonical filesystem')
        await safePath(temp)
        current([path, temp], [change.path])
        const fd = await open(
          temp,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        )
        try {
          const hash = createHash('sha256')
          let offset = 0
          do {
            const chunk = await this.engine.request(
              'chunk',
              { plan: plan.id, digest: plan.digest, path: change.path, offset },
              context,
            )
            const data = Buffer.from(chunk.data, 'base64')
            if (
              data.length > 65536 ||
              chunk.total !== change.size ||
              chunk.hash !== change.hash ||
              offset + data.length > change.size ||
              (!data.length && offset < change.size)
            )
              throw Error('Corrupt prepared chunk')
            hash.update(data)
            let written = 0
            while (written < data.length) {
              current([path, temp], [change.path])
              const result = await fd.write(data, written, data.length - written, offset + written)
              if (!result.bytesWritten) throw Error('Short publication write')
              written += result.bytesWritten
            }
            offset += data.length
          } while (offset < change.size)
          if (hash.digest('hex') !== change.hash) throw Error('Publication hash mismatch')
          current([path, temp], [change.path])
          await fd.sync()
        } finally {
          await fd.close()
        }
        await safePath(path)
        current([path, temp], [change.path])
        await rename(temp, path)
        await syncDirectory(staging, [change.path])
        await syncDirectory(directory, [change.path])
      }
      if (plan.changes.length) {
        await fence()
        await gitCheck()
        current(
          [root, join(root, '.git')],
          plan.changes.map((change) => change.path),
        )
        await startGitMutation(
          root,
          ['add', '--', ...plan.changes.map((change) => change.path)],
          engineEnvironment(this.environment),
        ).completed
        await journal({ stage: 'index_staged' })
        await fence()
        await journal({ stage: 'commit_start_intent' })
        await fence()
        await gitCheck()
        // Decisive boundary: actual current callback immediately followed by exact spawn.
        current(
          [root, join(root, '.git')],
          plan.changes.map((change) => change.path),
        )
        const commit = startGitMutation(
          root,
          ['commit', '-m', 'Maintain private agent memory'],
          engineEnvironment(this.environment),
        )
        commitStarted = commit.started
        recordMemoryDiagnostic(root, 'native-commit-start', { started: commitStarted })
        const completed = commit.completed
        // Observe completion even if a revoked journal write fails. Never unhandled/replayed.
        const result = completed.then(
          () => undefined,
          (error: Error) => error,
        )
        if (commitStarted) {
          try {
            await journal({ stage: 'commit_started' })
          } catch {
            await result
            throw Error('Commit started but live journal authority unavailable')
          }
        }
        const error = await result
        if (error) throw error
      }
      executor.seal() // all canonical/native work has joined; no further publication starts
      await journal({ stage: 'head_observed' })
      receipt = await this.engine.request('reconcile', { plan: plan.id, digest: plan.digest }, context)
      await journal(receipt)
      return (output = { ...publicReceipt(receipt), mutated, commitStarted, lockRetained: locked })
    } catch (error) {
      recordMemoryDiagnostic(root, 'publisher-error', { stage, mutated, commitStarted }, error)
      executor.seal()
      // Reconcile only with still-current authority. No safe-cancel claim after native start.
      try {
        assertCurrent(context)
        receipt = await this.engine.request('reconcile', { plan: plan.id, digest: plan.digest }, context)
        if (receipt.stage === 'reconciled_committed' && (stage as Stage) !== 'head_observed')
          await journal({ stage: 'head_observed' })
        await journal(receipt)
      } catch {
        receipt = {
          stage: 'unknown',
          detail: 'Current-authority reconciliation unavailable; retain intent and lock',
        }
      }
      return (output = {
        ...publicReceipt(receipt),
        detail:
          receipt.detail === undefined ? publicMemoryError(error).message : publicReceipt(receipt).detail,
        mutated,
        commitStarted,
        lockRetained: locked || lockAttempted,
      })
    } finally {
      executor.seal()
      if (locked && lockOwner && receipt.stage !== 'unknown') {
        // A revoked owner does not bypass policy to clean up; leave lock for explicit recovery.
        try {
          await releaseOperationLock(root, lockOwner, context)
          if (output) output.lockRetained = false
        } catch {
          /* retain exact lock, never steal */
        }
      }
      this.busy = false
      release?.()
    }
  }
  async reconcileExisting(id: string, digest: string, context: OperationContext) {
    assertCurrent(context)
    const release = context.hold?.({ reconciliation: this, id })
    try {
      await context.barrier?.()
      const result = await this.engine.request('recover', { plan: id, digest }, context)
      assertCurrent(context)
      let lockRetained = result.lockPresent
      // Observed commit is NOT executor quiescence or authority to remove its lock.
      if (
        result.receipt.stage !== 'unknown' &&
        result.owner &&
        executorOwnsLock(this.engine.root, id, digest, result.owner.nonce)
      ) {
        try {
          await releaseOperationLock(this.engine.root, result.owner, context)
          lockRetained = false
        } catch {
          /* retain */
        }
      }
      return { ...publicReceipt(result.receipt), operation: id, sequence: result.sequence, lockRetained }
    } finally {
      release?.()
    }
  }
}
