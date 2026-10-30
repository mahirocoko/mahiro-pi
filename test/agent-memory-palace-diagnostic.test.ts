import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMemoryInvocationContext } from '../lib/agent-memory/invocation-context.ts'
import { buildPalaceDiagnostic } from '../lib/agent-memory/palace-diagnostic.ts'
import {
  snapshotDigest,
  structureDigest,
  type PalaceStructure,
} from '../lib/agent-memory/palace-structure.ts'
import { validateInput } from '../lib/agent-memory/engine/protocol.ts'
import { validateReply } from '../lib/agent-memory/engine/replies.ts'
import { engineRequestDeadline } from '../lib/agent-memory/engine/controller.ts'

const input = { project: 'project', expectedConfigHash: 'b'.repeat(64) }
const context = () =>
  buildMemoryInvocationContext({
    revision: 'a'.repeat(40),
    configHash: input.expectedConfigHash,
    model: undefined,
    usage: undefined,
    systemPrompt: 'PRIVATE_PROMPT',
    projection: undefined,
  })
const palace = (n: number, long = false): PalaceStructure => {
  const files = Array.from({ length: n }, (_, i) => ({
    path: long
      ? `archives/${'x'.repeat(60)}/${'y'.repeat(60)}/${'z'.repeat(60)}/${String(i).padStart(4, '0')}.md`
      : `global/entry-${String(i).padStart(4, '0')}.md`,
    layer: long ? 'archives' : 'legacy',
    bytes: 42,
    protectedRetention: false,
    alwaysLoaded: false,
    sourcesCount: 2,
  }))
  const s: PalaceStructure = {
    version: 1,
    revision: 'a'.repeat(40),
    configHash: input.expectedConfigHash,
    project: input.project,
    basis: 'committed-head',
    currentness: 'config-and-head-matched-at-final-checks',
    bodyInspection: 'not-requested',
    structureDigest: structureDigest(files),
    snapshotDigest: '',
    output: { total: n, returned: n, omitted: 0, truncated: false },
    files,
  }
  s.snapshotDigest = snapshotDigest(s)
  return s
}

test('Palace structure accepts only exact internal input and closed deeply validated replies', () => {
  validateInput('palaceStructure', input)
  assert.equal(engineRequestDeadline('palaceStructure'), undefined)
  for (const bad of [
    {},
    { project: 'project' },
    { ...input, root: '/private' },
    { ...input, revision: 'a'.repeat(40) },
    { ...input, expectedConfigHash: 'bad' },
  ])
    assert.throws(() => validateInput('palaceStructure', bad))
  validateReply('palaceStructure', input, palace(2))
  const mutations = [
    (s: any) => {
      s.root = '/private'
    },
    (s: any) => {
      s.files[0].body = 'PRIVATE'
    },
    (s: any) => {
      s.files[0].sources = ['PRIVATE']
    },
    (s: any) => {
      s.files[0].path = '../secret.md'
    },
    (s: any) => {
      s.files.reverse()
    },
    (s: any) => {
      s.files[0].bytes = -1
    },
    (s: any) => {
      s.files[0].protectedRetention = true
    },
    (s: any) => {
      s.output.omitted = 1
    },
    (s: any) => {
      s.configHash = 'c'.repeat(64)
    },
    (s: any) => {
      s.bodyInspection = 'complete'
    },
    (s: any) => {
      s.structureDigest = 'd'.repeat(64)
    },
    (s: any) => {
      s.revision = 'c'.repeat(40)
    },
  ]
  for (const mutate of mutations) {
    const s = palace(2)
    mutate(s)
    assert.throws(() => validateReply('palaceStructure', input, s))
  }
  for (const malformed of [
    (s: any) => {
      s.revision = ['a'.repeat(40)]
    },
    (s: any) => {
      s.structureDigest = ['d'.repeat(64)]
      s.output = { total: 3, returned: 2, omitted: 1, truncated: true }
    },
  ]) {
    const s: any = palace(2)
    malformed(s)
    s.snapshotDigest = snapshotDigest(s)
    assert.throws(() => validateReply('palaceStructure', input, JSON.parse(JSON.stringify(s))))
  }
})

test('Palace diagnostic copies certified structure and labels combined association non-atomic', () => {
  const c = context()
  const p = palace(2)
  Object.assign(c, { private: 'PRIVATE_EXTRA' })
  const d = buildPalaceDiagnostic(c, p)
  assert.doesNotMatch(JSON.stringify(d), /PRIVATE_/)
  p.files[0].path = 'mutated.md'
  c.binding.revision = 'c'.repeat(40)
  assert.equal(d.structure.files[0].path, 'global/entry-0000.md')
  assert.equal(d.context.binding.revision, 'a'.repeat(40))
  assert.equal(d.version, 2)
  assert.equal(d.replay, 'unsupported')
  assert.equal(d.consistency.atomic, false)
  assert.equal(d.consistency.committedSnapshot, 'owner-certified')
  assert.equal(d.consistency.invocationAssociation, 'observed-non-atomic')
})

test('Palace diagnostic bounds encoded JSON independently of upstream coverage', () => {
  for (const long of [false, true]) {
    const p = palace(128, long)
    const d = buildPalaceDiagnostic(context(), p)
    assert.ok(Buffer.byteLength(JSON.stringify(d)) <= 32768)
    assert.deepEqual(d.structure.upstreamOutput, p.output)
    assert.equal(d.structure.output.omitted, 128 - d.structure.files.length)
    if (long) assert.ok(d.structure.files.length < 128)
  }
  assert.equal(buildPalaceDiagnostic(context(), palace(0)).structure.output.truncated, false)
  const p = palace(1)
  p.revision = 'c'.repeat(40)
  p.snapshotDigest = snapshotDigest(p)
  assert.throws(() => buildPalaceDiagnostic(context(), p), /revision mismatch/)
})
