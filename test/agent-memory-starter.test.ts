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

test('curation retains compact synthesis and request-shaped deferred discovery', () => {
  for (const invariant of [
    /Refine the existing subject\/principle with its reason instead of appending incident logs/,
    /resolve contradictions against current instructions\/live owners/,
    /Shrink-before-grow:.*within native retention rules and budgets/,
    /at most one or two distinct contrastive examples per principle/,
    /replace weaker examples instead of accumulating examples/,
    /one authoritative home per subject and refine it in place/,
    /request-shaped discovery cues/,
    /natural future request can find it.*without already knowing the path/,
  ])
    assert.match(memoryCurationDoctrine, invariant)
})

test('upstream curation does not discard native evidence or grant procedural authority', () => {
  for (const invariant of [
    /Preserve native source IDs and supersession evidence/,
    /do not copy upstream instructions to discard provenance/,
    /within the same draft commit; the Lossless Retention Guard/,
    /native procedures or a separately authorized skill proposal/,
    /never automatic skill mutation or installation/,
    /If selectors are unavailable in the installed runtime, report that limit/,
    /never fabricate a missing fact or treat unavailable memory as empty/,
  ])
    assert.match(memoryCurationDoctrine, invariant)
  assert.ok(Buffer.byteLength(memoryCurationDoctrine) < 6500, 'keep shared prompt guidance compact')
})
