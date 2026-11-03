import type { MemoryRetirementResult } from '../agent-memory/experimental-contracts.ts'

// Kernel-local lifetime only. No filesystem, worker service or permission authority.
// Every hold wraps the actual source hold, including inherited native child owners.
export function createMemoryRetirement(fence: () => void, releaseRoot: () => Promise<void>) {
  let retiring = false
  let retirement: Promise<MemoryRetirementResult> | undefined
  const callbacks = new Set<() => Promise<void>>()
  const holds = new Set<object>()
  const waiters = new Set<() => void>()
  return {
    hold(acquire: () => () => void) {
      if (retiring) throw Error('Memory Root retiring')
      const release = acquire()
      const token = {}
      holds.add(token)
      return () => {
        if (!holds.has(token)) return
        release()
        holds.delete(token)
        if (!holds.size) {
          for (const done of waiters) done()
          waiters.clear()
        }
      }
    },
    onRetire(callback: () => Promise<void>) {
      if (retiring) throw Error('Memory Root retiring')
      callbacks.add(callback)
      return () => {
        callbacks.delete(callback)
      }
    },
    retire(): Promise<MemoryRetirementResult> {
      if (retirement) return retirement
      retiring = true
      // Reserve before callbacks: reentrant retirement joins the exact same turn.
      let resolve!: (value: MemoryRetirementResult) => void
      let reject!: (error: unknown) => void
      retirement = new Promise((yes, no) => {
        resolve = yes
        reject = no
      })
      try {
        fence() // synchronous, before invoking any callback or awaiting its drain
        const joins = [...callbacks].map((callback) => {
          try {
            const join = callback()
            if (!join || typeof join.then !== 'function')
              throw Error('Memory retirement join promise required')
            return join
          } catch (error) {
            return Promise.reject(error)
          }
        })
        void (async () => {
          const results = await Promise.allSettled(joins)
          const failed = results.find((result) => result.status === 'rejected')
          if (failed?.status === 'rejected') throw failed.reason
          if (holds.size) await new Promise<void>((done) => waiters.add(done))
          await releaseRoot()
          callbacks.clear()
          return {
            state: joins.length ? 'drained' : 'unsupported',
            scope: 'memory-generation',
            globalQuiescence: false,
          } as const
        })().then(resolve, reject)
      } catch (error) {
        reject(error)
      }
      return retirement
    },
  }
}
