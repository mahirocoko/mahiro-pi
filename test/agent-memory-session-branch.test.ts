import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent'
import {
  appendedSuffix,
  appendedSuffixSync,
  sessionAnchor,
  sessionSuffixBound,
  type SuffixVerdict,
} from '../lib/agent-memory/session-branch.ts'

const entry = (id: string, parentId: string | null): SessionEntry =>
  ({
    type: 'custom',
    id,
    parentId,
    timestamp: 't',
    customType: 'synthetic',
    data: {},
  }) as SessionEntry
const chain = (length: number) =>
  Array.from({ length }, (_, index) => entry(`e${index}`, index === 0 ? null : `e${index - 1}`))
const manager = (entries: SessionEntry[], sessionId = 'primary') => {
  const ctx = {
    sessionManager: {
      getSessionId: () => sessionId,
      getLeafId: () => entries.at(-1)?.id ?? null,
      getEntry: (id: string) => entries.find((item) => item.id === id),
      getBranch: () => {
        throw Error('getBranch refused')
      },
    },
  } as unknown as ExtensionContext
  return ctx
}
const anchorAt = (ctx: ExtensionContext, leafId: string | null) => ({
  manager: ctx.sessionManager,
  sessionId: ctx.sessionManager.getSessionId(),
  leafId,
})

test('suffix walk accepts an append and rejects sibling, rewind, cycle, and a missing parent', () => {
  const entries = chain(3)
  const ctx = manager(entries)
  const anchor = sessionAnchor(ctx)
  entries.push(entry('e3', 'e2'))
  const appended = appendedSuffixSync(ctx, anchor)
  assert.equal(appended.ok, true)
  if (appended.ok)
    assert.deepEqual(
      appended.suffix.map((item) => item.id),
      ['e3'],
    )
  entries.pop()
  entries.push(entry('sibling', 'e0'))
  assert.equal(appendedSuffixSync(ctx, anchor).ok, false)
  entries.pop()
  entries.push(entry('rewound', 'e0'))
  assert.equal(appendedSuffixSync(ctx, anchor).ok, false)
  const cyclic = chain(2)
  const cyclicCtx = manager(cyclic)
  cyclic[1]!.parentId = cyclic[1]!.id
  assert.equal(appendedSuffixSync(cyclicCtx, anchorAt(cyclicCtx, 'e0')).ok, false)
  const missing = chain(2)
  const missingCtx = manager(missing)
  missing[1]!.parentId = 'absent'
  assert.equal(appendedSuffixSync(missingCtx, anchorAt(missingCtx, 'e0')).ok, false)
})

test('suffix walk stops at the bound without calling getBranch', () => {
  const entries = chain(sessionSuffixBound + 2)
  const ctx = manager(entries)
  assert.equal(appendedSuffixSync(ctx, anchorAt(ctx, 'e0')).ok, false)
  assert.equal(appendedSuffixSync(ctx, sessionAnchor(ctx)).ok, true)
})

const counted = (entries: SessionEntry[]) => {
  let reads = 0
  const ctx = manager(entries)
  const read = ctx.sessionManager.getEntry.bind(ctx.sessionManager)
  ctx.sessionManager.getEntry = (id: string) => {
    reads += 1
    return read(id)
  }
  return { ctx, reads: () => reads }
}

const finished = async (pending: Promise<SuffixVerdict>, limit = 500) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error('walk did not finish')), limit)
  })
  try {
    return await Promise.race([pending, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

test('async suffix refuses 65 entries appended during yield', async () => {
  const entries = chain(66)
  const { ctx, reads } = counted(entries)
  const pending = appendedSuffix(ctx, anchorAt(ctx, 'e0'))
  let parent = entries.at(-1)?.id ?? null
  for (let index = 0; index < 65; index++) {
    const id = `extra-${index}`
    entries.push(entry(id, parent))
    parent = id
  }
  const verdict = await finished(pending)
  assert.equal(verdict.ok, false)
  assert.ok(reads() < 200, `getEntry calls ${reads()}`)
})

test('async suffix rejects a deep sibling in a bounded walk', async () => {
  const entries = [entry('anchor', null)]
  let parent: string | null = null
  for (let index = 0; index < 200; index++) {
    const id = `side-${index}`
    entries.push(entry(id, parent))
    parent = id
  }
  const { ctx, reads } = counted(entries)
  const verdict = await finished(appendedSuffix(ctx, anchorAt(ctx, 'anchor')))
  assert.equal(verdict.ok, false)
  assert.ok(reads() < 200 * 3, `getEntry calls ${reads()}`)
})

test('async suffix fails closed on manager, session, leaf, and anchor changes during yield', async () => {
  const run = async (change: 'manager' | 'session' | 'leaf' | 'anchor') => {
    const entries = chain(66)
    let sessionId = 'primary'
    const ctx = {
      sessionManager: {
        getSessionId: () => sessionId,
        getLeafId: () => entries.at(-1)?.id ?? null,
        getEntry: (id: string) => entries.find((item) => item.id === id),
        getBranch: () => {
          throw Error('getBranch refused')
        },
      },
    } as unknown as ExtensionContext
    const anchor = anchorAt(ctx, 'e0')
    const pending = appendedSuffix(ctx, anchor)
    if (change === 'manager') ctx.sessionManager = manager(chain(1)).sessionManager
    if (change === 'session') sessionId = 'other'
    if (change === 'leaf') entries.push(entry('sibling', 'e0'))
    if (change === 'anchor') entries[0] = entry('replaced-anchor', null)
    assert.equal((await pending).ok, false, change)
  }
  await run('manager')
  await run('session')
  await run('leaf')
  await run('anchor')
})

test('async suffix accepts exactly 8192 links on one manager and rejects 8193', async () => {
  const entries = chain(sessionSuffixBound + 2)
  const { ctx, reads } = counted(entries)
  const anchor = anchorAt(ctx, 'e0')
  assert.equal((await finished(appendedSuffix(ctx, anchor), 2000)).ok, false)
  const before = reads()
  entries.pop()
  const accepted = await finished(appendedSuffix(ctx, anchor), 2000)
  assert.equal(accepted.ok, true)
  if (accepted.ok) assert.equal(accepted.suffix.length, sessionSuffixBound)
  const delta = reads() - before
  assert.ok(delta < sessionSuffixBound * 3, `getEntry calls ${delta}`)
})

test('async suffix lets the caller guard reject without rewriting the error', async () => {
  const entries = chain(66)
  const ctx = manager(entries)
  await assert.rejects(
    () =>
      appendedSuffix(ctx, anchorAt(ctx, 'e0'), sessionSuffixBound, () => {
        throw Error('Current parent authority required (strict boolean)')
      }),
    (error: unknown) =>
      error instanceof Error && error.message === 'Current parent authority required (strict boolean)',
  )
})

test('async suffix does not re-read an ancestor behind the anchor', async () => {
  const entries = chain(80)
  const ctx = manager(entries)
  const anchor = anchorAt(ctx, 'e10')
  const pending = appendedSuffix(ctx, anchor)
  entries[0] = entry('changed-prefix', null)
  const verdict = await pending
  assert.equal(verdict.ok, true)
  if (verdict.ok) assert.equal(verdict.suffix[0]?.id, 'e11')
})
