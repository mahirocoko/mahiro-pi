import { createRequire } from 'node:module'
import type { Plan } from './protocol.ts'

// Native MJS owns actual references across query-loaded TypeScript generations.
// Never reconstruct an executor from durable state or an asserted caller flag.
const require = createRequire(import.meta.url)
const native = require('./publication-executors.mjs') as {
  reserveExecutor(
    root: string,
    plan: Plan,
  ): Readonly<{ nonce: string; beginLock(): void; lockContended(): void; seal(): void }>
  executorOwnsLock(root: string, id: string, digest: string, nonce: string): boolean
  executorDrained(root: string, id: string, digest: string): boolean
  executorNeverStarted(root: string, id: string, digest: string): boolean
}
export const { reserveExecutor, executorOwnsLock, executorDrained, executorNeverStarted } = native
