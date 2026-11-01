import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDraft } from '../lib/agent-memory/engine/manifest.ts'
import { classifyRetainedManifest } from '../lib/agent-memory/engine/retained-preview.ts'

const revision = 'a'.repeat(40)
const hash = 'b'.repeat(64)
const id = '00000000-0000-4000-8000-000000000001'

function manifest(state: string, dirty = false) {
  return JSON.stringify({
    version: 2,
    id,
    project: 'synthetic',
    shared: false,
    configHash: hash,
    base: {
      revision,
      refs: {
        'Core.md': { oid: revision, hash, size: 1, sources: [] },
        'index.md': { oid: revision, hash, size: 1, sources: [] },
      },
      ledger: {
        forgottenPaths: [],
        forgottenSources: [],
        reviewed: [],
        sources: { 'Core.md': [], 'index.md': [] },
        version: 2,
      },
    },
    overlay: dirty
      ? {
          'global/notes.md': {
            blob: '00000000-0000-4000-8000-000000000099',
            hash,
            size: 1,
            sources: [],
            identity: '1:1',
          },
        }
      : {},
    state,
    deadline: 0,
  })
}

test('retained draft classification keeps non-terminal and unstable manifests out of the terminal count', () => {
  const cancelled = manifest('cancelled')
  const committed = manifest('committed')
  assert.equal(parseDraft(cancelled).state, 'cancelled')
  assert.equal(
    classifyRetainedManifest({
      id,
      first: cancelled,
      second: cancelled,
      referenced: false,
      locallyActive: false,
    }),
    'terminal',
  )
  assert.equal(
    classifyRetainedManifest({
      id,
      first: committed,
      second: committed,
      referenced: false,
      locallyActive: false,
    }),
    'terminal',
  )
  assert.equal(
    classifyRetainedManifest({
      id,
      first: cancelled,
      second: cancelled,
      referenced: true,
      locallyActive: false,
    }),
    'journalReferenced',
  )
  assert.equal(
    classifyRetainedManifest({
      id,
      first: cancelled,
      second: cancelled,
      referenced: false,
      locallyActive: true,
    }),
    'locallyActive',
  )
  assert.equal(
    classifyRetainedManifest({
      id,
      first: manifest('conflict'),
      second: manifest('conflict'),
      referenced: false,
      locallyActive: false,
    }),
    'conflict',
  )
  assert.equal(
    classifyRetainedManifest({
      id,
      first: manifest('open'),
      second: manifest('open'),
      referenced: false,
      locallyActive: false,
    }),
    'open',
  )
  assert.equal(
    classifyRetainedManifest({
      id,
      first: manifest('ready'),
      second: manifest('ready'),
      referenced: false,
      locallyActive: false,
    }),
    'ready',
  )
  assert.equal(
    classifyRetainedManifest({
      id,
      first: manifest('cancelled', true),
      second: manifest('cancelled', true),
      referenced: false,
      locallyActive: false,
    }),
    'dirty',
  )
  assert.equal(
    classifyRetainedManifest({
      id,
      first: cancelled,
      second: committed,
      referenced: false,
      locallyActive: false,
    }),
    'unstable',
  )
  assert.equal(
    classifyRetainedManifest({ id, first: '{', second: '{', referenced: false, locallyActive: false }),
    'unknown',
  )
})
