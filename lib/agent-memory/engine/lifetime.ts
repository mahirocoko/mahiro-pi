// A private join set, not authority. Register before invoking work (and its first await).
// Retirement callers fence their actual generation before awaiting drain.
export class MemoryLifetime {
  private pending = new Set<Promise<unknown>>()
  private joinFailure: { error: unknown } | undefined
  // Unlike an ordinary cancelled tool request, failure of a native join loses drain proof.
  join(start: () => Promise<void>): Promise<void> {
    return this.track(async () => {
      try {
        const joined = start()
        if (!joined || typeof joined.then !== 'function') throw Error('Native memory join promise required')
        await joined
      } catch (error) {
        this.joinFailure ??= { error }
        throw error
      }
    })
  }
  track<T>(start: () => Promise<T>): Promise<T> {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (error: unknown) => void
    const result = new Promise<T>((yes, no) => {
      resolve = yes
      reject = no
    })
    this.pending.add(result)
    const remove = () => {
      this.pending.delete(result)
    }
    void result.then(remove, remove)
    try {
      resolve(start())
    } catch (error) {
      reject(error)
    }
    return result
  }
  async drain() {
    while (this.pending.size) await Promise.allSettled([...this.pending])
    if (this.joinFailure) throw this.joinFailure.error
  }
}
