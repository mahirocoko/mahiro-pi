import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMemoryInvocationContext } from '../lib/agent-memory/invocation-context.ts'
import { buildPalaceDiagnostic } from '../lib/agent-memory/palace-diagnostic.ts'

const context = () =>
  buildMemoryInvocationContext({
    revision: 'a'.repeat(40),
    configHash: 'b'.repeat(64),
    model: undefined,
    usage: undefined,
    systemPrompt: 'PRIVATE_PROMPT',
    projection: undefined,
  })
const palace = (n: number, long = false) => ({
  revision: 'a'.repeat(40),
  healthy: true,
  root: '/PRIVATE_ROOT',
  coverage: { complete: true, inspectedFiles: n, nonArchiveFiles: n, totalFiles: n, filesReturned: n },
  files: Array.from({ length: n }, (_, i) => ({
    path: `global/${long ? '界'.repeat(300) : 'entry'}-${i}.md`,
    layer: 'legacy',
    bytes: 42,
    protectedRetention: false,
    alwaysLoaded: false,
    sourcesCount: 2,
    name: 'PRIVATE_NAME',
    description: 'PRIVATE_DESCRIPTION',
    links: ['PRIVATE_LINK'],
    body: 'PRIVATE_BODY',
  })),
  views: ['PRIVATE_VIEW'],
  episodes: ['PRIVATE_EPISODE'],
  pendingOperations: ['PRIVATE_OPERATION'],
})

test('Palace diagnostic reconstructs closed fields without aliases or private metadata', () => {
  const c = context()
  const p = palace(2)
  Object.assign(c, { private: 'PRIVATE_EXTRA' })
  const d = buildPalaceDiagnostic(c, p)
  assert.deepEqual(Object.keys(d.structure.files[0]), [
    'path',
    'layer',
    'bytes',
    'protectedRetention',
    'alwaysLoaded',
    'sourcesCount',
  ])
  assert.doesNotMatch(JSON.stringify(d), /PRIVATE_/)
  p.files[0].path = 'mutated.md'
  c.binding.revision = 'c'.repeat(40)
  assert.equal(d.structure.files[0].path, 'global/entry-0.md')
  assert.equal(d.context.binding.revision, 'a'.repeat(40))
  assert.equal(d.replay, 'unsupported')
  assert.equal(d.consistency.atomic, false)
})

test('Palace diagnostic charges complete encoded UTF-8 JSON and accounts truncation independently', () => {
  for (const long of [false, true]) {
    const p = palace(180, long)
    p.files.forEach((f) => {
      f.layer = 'legacy'
    })
    const d = buildPalaceDiagnostic(context(), p)
    assert.ok(d.structure.files.length <= 128)
    assert.ok(Buffer.byteLength(JSON.stringify(d)) <= 32768)
    assert.deepEqual(d.structure.upstreamOutput, { returned: 180, omitted: 0, truncated: false })
    assert.equal(d.structure.output.omitted, 180 - d.structure.files.length)
    assert.equal(d.structure.output.truncated, true)
    assert.deepEqual(JSON.parse(JSON.stringify(d)), d)
    if (long) assert.ok(d.structure.files.length < 128)
  }
  const p = palace(0)
  assert.equal(buildPalaceDiagnostic(context(), p).structure.output.truncated, false)
  p.revision = 'c'.repeat(40)
  assert.throws(() => buildPalaceDiagnostic(context(), p), /revision mismatch/)
})
