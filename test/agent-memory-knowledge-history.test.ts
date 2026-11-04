import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseHistoryRows,
  assertKnowledgeHistory,
  historyDetails,
} from '../lib/agent-memory/knowledge-history.ts'
import { validateInput } from '../lib/agent-memory/engine/protocol.ts'
import { validateReply } from '../lib/agent-memory/engine/replies.ts'
import { engineRequestDeadline } from '../lib/agent-memory/engine/controller.ts'
const a = 'a'.repeat(40)
const b = 'b'.repeat(40)
const c = 'c'.repeat(40)
const input = { project: 'project', expectedRevision: a, expectedConfigHash: 'd'.repeat(64), offset: 0 }
const reply = () => ({
  version: 1,
  project: input.project,
  revision: a,
  configHash: input.expectedConfigHash,
  ledgerDigest: 'e'.repeat(64),
  basis: 'committed-head-first-parent',
  currentness: 'config-head-ledger-matched-at-final-checks',
  offset: 0,
  pageSize: 8,
  windowSize: 128,
  nextOffset: null,
  windowLimitReached: false,
  metadata: 'commit-identity-time-subject-count',
  entries: [
    {
      revision: a,
      parent: null,
      committedAt: '2026-01-01T00:00:00.000Z',
      subject: 'Update',
      changedFiles: 1,
    },
  ],
})
test('history has exact bounded protocol and deep identity/time/subject/count reply validation', () => {
  validateInput('knowledgeHistory', input)
  assert.equal(engineRequestDeadline('knowledgeHistory'), undefined)
  for (const bad of [
    {},
    { ...input, limit: 8 },
    { ...input, root: '/private' },
    { ...input, expectedRevision: 'a'.repeat(41) },
    { ...input, expectedRevision: 'A'.repeat(40) },
    { ...input, expectedConfigHash: 'x' },
    ...[-1, 128, 0.5, '0', NaN].map((offset) => ({ ...input, offset })),
  ])
    assert.throws(() => validateInput('knowledgeHistory', bad))
  validateReply('knowledgeHistory', input, reply())
  for (const mutate of [
    (r: any) => {
      r.author = 'PRIVATE'
    },
    (r: any) => {
      r.entries[0].path = 'PRIVATE'
    },
    (r: any) => {
      r.entries[0].subject = 'PRIVATE\nCONTROL'
    },
    (r: any) => {
      r.entries[0].subject = '😀'.repeat(65)
    },
    (r: any) => {
      r.entries[0].changedFiles = -1
    },
    (r: any) => {
      r.entries[0].changedFiles = 32769
    },
    (r: any) => {
      r.entries[0].revision = 'a'.repeat(41)
    },
    (r: any) => {
      r.entries[0].parent = a
    },
    (r: any) => {
      r.entries[0].committedAt = '2026-02-30T00:00:00.000Z'
    },
    (r: any) => {
      r.entries[0].committedAt = '2026-01-01T00:00:00+00:00'
    },
    (r: any) => {
      r.offset = 1
    },
    (r: any) => {
      r.nextOffset = 8
    },
    (r: any) => {
      r.windowLimitReached = true
    },
    (r: any) => {
      r.pageSize = 9
    },
    (r: any) => {
      r.ledgerDigest = null
    },
    (r: any) => {
      r.entries = []
    },
  ]) {
    const r = reply()
    mutate(r)
    assert.throws(() => assertKnowledgeHistory(r, input))
  }
  const falseWindow = reply() as any
  const revisions = [a, ...Array.from({ length: 7 }, (_, i) => (i + 1).toString(16).padStart(40, '0'))]
  falseWindow.entries = revisions.map((revision, i) => ({
    revision,
    parent: revisions[i + 1] ?? null,
    committedAt: '2026-01-01T00:00:00.000Z',
    subject: 'Update',
    changedFiles: 0,
  }))
  falseWindow.windowLimitReached = true
  assert.throws(() => assertKnowledgeHistory(falseWindow, input))
})
test('history details sanitize and byte-bound subjects, count only scoped paths and redact unknown paths', () => {
  const details = (subject: string, paths: string[]) =>
    historyDetails(Buffer.from(subject), Buffer.from(paths.length ? `${paths.join('\0')}\0` : ''), 'project')
  assert.deepEqual(
    details('Safe\n\r\t\u001b\u0085\u202e\u2028 subject', [
      'Core.md',
      'index.md',
      'system/persona.md',
      'reference/a.md',
      'archives/project/a.md',
      'archives/other/a.md',
      'projects/project/reference/a.md',
      'projects/other/reference/a.md',
      '.memory.json',
      '.gitignore',
    ]),
    { subject: 'Safe subject', changedFiles: 8 },
  )
  assert.equal(details('😀'.repeat(100), []).subject, '😀'.repeat(64))
  assert.deepEqual(details('ledger', ['.memory.json', '.gitignore']), { subject: 'ledger', changedFiles: 0 })
  for (const path of [
    'system/private.txt',
    'projects/project/arbitrary.bin',
    'projects/project/reference/arbitrary.bin',
    'unknown/PRIVATE.md',
    'projects/project/../PRIVATE.md',
    'global/valid-but-outside-requested-scope.md',
    'deferred/project/valid-but-outside-requested-scope.md',
  ]) {
    assert.deepEqual(details('PRIVATE subject', ['Core.md', path]), {
      subject: 'Out-of-scope project update',
      changedFiles: 1,
    })
  }
  assert.deepEqual(details('Archive update', ['archives/legacy-v1-abcdef123456/global/note.md']), {
    subject: 'Archive update',
    changedFiles: 1,
  })
  assert.throws(() => historyDetails(Buffer.from('Update'), Buffer.from('Core.md'), 'project'))
})

test('fixed history rows validate every merge parent, chain, framing, time and bounded octopus cardinality', () => {
  const parse = (text: string) => parseHistoryRows(Buffer.from(text), a)
  assert.deepEqual(
    parse(`1 ${a} ${b} ${c}\n0 ${b}\n`).map((e) => e.revision),
    [a, b],
  )
  for (const bad of [
    '',
    `1 ${a}`,
    `1 ${a}\r\n`,
    `1 ${a}\0\n`,
    `1  ${a}\n`,
    `01 ${a}\n`,
    `-1 ${a}\n`,
    `9007199254740991 ${a}\n`,
    `1 ${a} ${b}\n`,
    `1 ${a} ${c}\n0 ${b}\n`,
    `1 ${a} ${b} PRIVATE\n0 ${b}\n`,
    `1 ${a} ${b} ${b}\n0 ${b}\n`,
    `1 ${a} ${a}\n`,
    `1 ${a} ${Array.from({ length: 33 }, (_, i) => (i + 1).toString(16).padStart(40, '0')).join(' ')}\n`,
    `1 ${'a'.repeat(41)}\n`,
    `1 ${a}\n\n`,
  ])
    assert.throws(() => parse(bad), bad)
})
