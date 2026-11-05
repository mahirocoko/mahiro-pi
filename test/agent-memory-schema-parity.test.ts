import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { bytes, digest } from '../lib/continuity/records.ts'
import {
  allowedDirectory,
  allowedPath,
  assertLegacyArchiveCompatible,
  isAlwaysLoadedTieredPath,
} from '../lib/agent-memory/engine/schema.ts'

interface SchemaFixture {
  baseline: { commit: string; version: string; sources: string[] }
  contracts: Array<{
    letta: string
    mahiro: string[]
    placement: 'baseline' | 'deferred' | 'unsupported'
    classification: 'adapted' | 'intentional-non-parity'
  }>
  unsupportedMahiroPaths: string[]
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/agent-memory/letta-v03431-schema.json'), 'utf8'),
) as SchemaFixture

test('Letta v0.34.31 schema fixture maps to the explicit Mahiro projection contract', () => {
  assert.equal(fixture.baseline.commit, 'a8900b882446d7aa99fedf2845d400743affd1b6')
  assert.equal(fixture.baseline.version, '0.34.31')
  assert.deepEqual(fixture.baseline.sources, [
    'src/agent/prompts/letta_root_memfs.md',
    'src/agent/memory-filesystem.ts',
    'src/tools/impl/memory.ts',
  ])

  const mapped = fixture.contracts.flatMap((contract) =>
    contract.mahiro.map((path) => ({ path, placement: contract.placement })),
  )
  assert.ok(mapped.length > 0)
  for (const { path, placement } of mapped) {
    assert.equal(allowedPath(path, 'project'), true, path)
    const alwaysLoaded =
      path === 'Core.md' || path === 'index.md' || isAlwaysLoadedTieredPath(path, 'project')
    assert.equal(alwaysLoaded, placement === 'baseline', path)
  }
  assert.ok(fixture.contracts.some((contract) => contract.classification === 'intentional-non-parity'))
  for (const path of fixture.unsupportedMahiroPaths) assert.equal(allowedPath(path, 'project'), false, path)
})

test('legacy migration archive reuse requires exact body and provenance identity', () => {
  const text = '# Legacy\nPreserved body.\n'
  const incoming = { hash: digest(text), size: bytes(text), sources: ['episode-1'] }
  assert.doesNotThrow(() =>
    assertLegacyArchiveCompatible('archives/legacy-v1-aaaaaaaaaaaa/global/note.md', undefined, incoming),
  )
  assert.doesNotThrow(() =>
    assertLegacyArchiveCompatible(
      'archives/legacy-v1-aaaaaaaaaaaa/global/note.md',
      structuredClone(incoming),
      incoming,
    ),
  )
  assert.throws(
    () =>
      assertLegacyArchiveCompatible(
        'archives/legacy-v1-aaaaaaaaaaaa/global/note.md',
        { ...incoming, hash: digest('# Other\n') },
        incoming,
      ),
    /Legacy migration archive collision/,
  )
  assert.throws(
    () =>
      assertLegacyArchiveCompatible(
        'archives/legacy-v1-aaaaaaaaaaaa/global/note.md',
        { ...incoming, size: incoming.size + 1 },
        incoming,
      ),
    /Legacy migration archive collision/,
  )
  assert.throws(
    () =>
      assertLegacyArchiveCompatible(
        'archives/legacy-v1-aaaaaaaaaaaa/global/note.md',
        { ...incoming, sources: ['episode-2'] },
        incoming,
      ),
    /Legacy migration archive collision/,
  )
  assert.throws(
    () =>
      assertLegacyArchiveCompatible(
        'archives/legacy-v1-aaaaaaaaaaaa/global/note.md',
        { ...incoming, sources: ['episode-2', 'episode-1'] },
        { ...incoming, sources: ['episode-1', 'episode-2'] },
      ),
    /Legacy migration archive collision/,
  )
})

test('built-in maintaining-core-memory and maintaining-deferred-memory skills align with tiered projection', () => {
  assert.equal(isAlwaysLoadedTieredPath('system/persona.md', 'project'), true)
  assert.equal(isAlwaysLoadedTieredPath('system/human/identity.md', 'project'), true)
  assert.equal(isAlwaysLoadedTieredPath('system/human/notes.md', 'project'), true)
  assert.equal(isAlwaysLoadedTieredPath('system/human/prefs/coding.md', 'project'), true)
  assert.equal(isAlwaysLoadedTieredPath('system/human/index.md', 'project'), false)
  assert.equal(isAlwaysLoadedTieredPath('system/human/prefs/index.md', 'project'), false)
  assert.equal(isAlwaysLoadedTieredPath('projects/project/system/overview.md', 'project'), true)
  assert.equal(isAlwaysLoadedTieredPath('projects/project/system/conventions.md', 'project'), true)
  assert.equal(isAlwaysLoadedTieredPath('projects/project/system/index.md', 'project'), false)
  assert.equal(isAlwaysLoadedTieredPath('projects/other/system/overview.md', 'project'), false)
  assert.equal(isAlwaysLoadedTieredPath('reference/topic.md', 'project'), false)
  assert.equal(allowedPath('projects/project/reference/group/note.md', 'project'), true)
  assert.equal(allowedPath('projects/project/reference/group/index.md', 'project'), true)
  assert.equal(allowedPath('projects/project/system/nested/overview.md', 'project'), false)
  assert.equal(
    allowedDirectory('projects/project/reference/group', 'project', false, [
      'projects/project/reference/group/note.md',
    ]),
    true,
  )

  const coreSkill = readFileSync(
    join(import.meta.dirname, '../skills/maintaining-core-memory/SKILL.md'),
    'utf8',
  )
  const deferredSkill = readFileSync(
    join(import.meta.dirname, '../skills/maintaining-deferred-memory/SKILL.md'),
    'utf8',
  )
  assert.match(coreSkill, /^---\nname: maintaining-core-memory\ndescription: /)
  assert.match(coreSkill, /system\/human\/identity\.md/)
  assert.match(coreSkill, /agent_memory_edit/)
  assert.match(deferredSkill, /^---\nname: maintaining-deferred-memory\ndescription: /)
  assert.match(deferredSkill, /reference\/\*\*/)
  assert.match(deferredSkill, /agent_memory_commit/)

  for (const skillName of [
    'maintaining-core-memory',
    'maintaining-deferred-memory',
    'initializing-memory',
    'context-doctor',
    'syncing-memory-filesystem',
    'creating-skills',
  ]) {
    const content = readFileSync(join(import.meta.dirname, `../skills/${skillName}/SKILL.md`), 'utf8')
    assert.match(content, new RegExp(`^---\\nname: ${skillName}\\ndescription: `))
    assert.doesNotMatch(content, /letta/i)
  }
})
