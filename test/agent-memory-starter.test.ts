import assert from 'node:assert/strict'
import { test } from 'node:test'
import { starterCore } from '../lib/agent-memory/starter.ts'
import { memoryCurationDoctrine } from '../lib/agent-memory/guidance.ts'
import { hasSecret } from '../lib/continuity/records.ts'

test('fresh starter is bounded, generic and explicitly customizable without changing authority', () => {
  assert.ok(Buffer.byteLength(starterCore) < 8192)
  assert.equal(hasSecret(starterCore), false)
  for (const field of ['Name', 'Language', 'Tone', 'Detail', 'Specialties'])
    assert.match(starterCore, new RegExp(`- ${field}: `))
  assert.match(starterCore, /No personal identity, preferences, project facts or imported corpus/)
  assert.match(
    starterCore,
    /does\nnot create a new identity\/store, erase knowledge or change permissions\/model routes/,
  )
  assert.doesNotMatch(starterCore, /Mahiro|Letta|mahirocoko|\/Users\//)
})

test('curation foundations are package-owned independently of editable persona', () => {
  const customizedCore = '# My own companion\n\nName: Nova; language: Thai.\n'
  const projection = `${memoryCurationDoctrine}\n${customizedCore}`
  assert.ok(projection.includes(customizedCore))
  assert.match(projection, /Current human instructions, repository owners and live task evidence beat/)
  assert.match(projection, /Use only root-bound agent_memory tools/)
  assert.match(projection, /ambiguous one-off does not establish an enduring preference/)
})
