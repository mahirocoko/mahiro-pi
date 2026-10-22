import assert from 'node:assert/strict'
import test from 'node:test'
import { assertArchive, normalize, search } from '../lib/continuity/records.ts'

test('excluded project aliases and case variants cannot enter cross-project recall', () => {
  const policy = {
    excludedProjectIds: ['ExcludedProject', 'excluded-frontend'],
    excludedPaths: [],
  }
  for (const projectId of [
    'ExcludedProject',
    'excludedproject',
    'EXCLUDEDPROJECT',
    'eXcLuDeDpRoJeCt',
    'excluded-frontend',
    'EXCLUDED-FRONTEND',
  ]) {
    const input = {
      id: 'excluded-record',
      sourceKind: 'letta_memory' as const,
      projectId,
      path: '/fixtures/excluded.md',
      markdown: 'outside-scope evidence',
    }
    const result = normalize([input], policy)
    assert.equal(result.records.length, 0)
    assert.equal(
      search(result.records, 'outside-scope', {
        projectId: 'demo',
        crossProject: true,
      }).length,
      0,
    )
    const disallowedArchive = normalize([input], {
      excludedProjectIds: [],
      excludedPaths: [],
    })
    assert.throws(() => assertArchive(disallowedArchive, policy))
  }
})
