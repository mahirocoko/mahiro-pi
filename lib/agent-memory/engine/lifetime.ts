// A private join set, not authority. Register before invoking work (and its first await).
// Retirement callers fence their actual generation before awaiting drain.
export class MemoryLifetime {
  private pending = new Set<Promise<unknown>>()
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
  }
}
