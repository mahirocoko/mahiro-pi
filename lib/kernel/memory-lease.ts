// Identity selection only, not permission or a reusable permit. Root retains the exact
// returned object on its current synchronous stack and still performs live parent/PSS checks.
interface Candidate {
  ownerId: string
  generation: object
  root: string
  version: number
  jobId: string
  active(): unknown
  service: {
    getRecord(id: string): { type: string; status: string; outputFile?: string } | undefined
  }
}
export function selectMemoryLease<T extends Candidate>(
  entries: Iterable<T>,
  expected: { ownerId: string; generation: object; root: string; version: 1 | 2; outputFile: string },
): T {
  const matches = [...entries].filter((item) => {
    if (
      item.ownerId !== expected.ownerId ||
      item.generation !== expected.generation ||
      item.root !== expected.root ||
      item.version !== expected.version ||
      (expected.version === 2 ? item.active() !== true : !item.active())
    )
      return false
    const record = item.service.getRecord(item.jobId)
    return (
      record?.type === 'managed-memory-writer' &&
      record.status === 'running' &&
      typeof record.outputFile === 'string' &&
      record.outputFile === expected.outputFile
    )
  })
  if (matches.length !== 1) throw Error('Native memory binding unavailable')
  return matches[0]
}
