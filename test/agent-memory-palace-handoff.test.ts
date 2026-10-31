import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildMemoryInvocationContext } from '../lib/agent-memory/invocation-context.ts'
import type { KnowledgeHistory } from '../lib/agent-memory/knowledge-history.ts'
import { buildPalaceDiagnostic } from '../lib/agent-memory/palace-diagnostic.ts'
import { buildPalaceHandoff } from '../lib/agent-memory/palace-handoff.ts'
import {
  snapshotDigest,
  structureDigest,
  type PalaceStructure,
} from '../lib/agent-memory/palace-structure.ts'
import { renderAbi2PalacePage } from '../lib/palace-render/abi2-page.ts'

const revision = 'a'.repeat(40)
const configHash = 'b'.repeat(64)

function structure(): PalaceStructure {
  const files = [
    {
      path: 'Core.md',
      layer: 'core',
      bytes: 42,
      protectedRetention: true,
      alwaysLoaded: true,
      sourcesCount: 1,
    },
  ]
  const value: PalaceStructure = {
    version: 1,
    revision,
    configHash,
    project: 'project',
    basis: 'committed-head',
    currentness: 'config-and-head-matched-at-final-checks',
    bodyInspection: 'not-requested',
    structureDigest: structureDigest(files),
    snapshotDigest: '',
    output: { total: 1, returned: 1, omitted: 0, truncated: false },
    files,
  }
  value.snapshotDigest = snapshotDigest(value)
  return value
}

function history(): KnowledgeHistory {
  return {
    version: 1,
    project: 'project',
    revision,
    configHash,
    ledgerDigest: 'c'.repeat(64),
    basis: 'committed-head-first-parent',
    currentness: 'config-head-ledger-matched-at-final-checks',
    offset: 0,
    pageSize: 8,
    windowSize: 128,
    nextOffset: null,
    windowLimitReached: false,
    metadata: 'commit-identity-time-only',
    entries: [{ revision, parent: null, committedAt: '2026-01-01T00:00:00.000Z' }],
  }
}

function handoff() {
  const context = buildMemoryInvocationContext({
    revision,
    configHash,
    model: { provider: 'openai', id: 'model' },
    usage: { tokens: null, contextWindow: 4096, percent: null },
    systemPrompt: 'private prompt',
    projection: undefined,
    now: new Date('2026-01-02T00:00:00.000Z'),
  })
  return buildPalaceHandoff({
    diagnostic: buildPalaceDiagnostic(context, structure()),
    history: history(),
    expiresAt: new Date('2026-01-02T00:10:00.000Z'),
  })
}

test('installed Palace HTML boundary does not import the disconnected local service', () => {
  for (const path of [
    '../lib/agent-memory/experimental-runtime.ts',
    '../lib/agent-memory/palace-handoff.ts',
    '../lib/palace-render/abi2-page.ts',
    '../lib/palace-render/immutable-server.ts',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /agent-memory\/local|\/local\//)
  }
})

test('Palace HTML handoff is closed, frozen, bounded and identity matched', () => {
  const value = handoff()
  assert.equal(value.version, 1)
  assert.equal(value.kind, 'abi2-palace-html-handoff')
  assert.equal(value.diagnostic.consistency.atomic, false)
  assert.equal(value.history.entries.length, 1)
  assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 48 * 1024)
  assert.ok(Object.isFrozen(value))
  assert.ok(Object.isFrozen(value.diagnostic.structure.files[0]))
  assert.throws(() => {
    ;(value.history.entries[0] as { revision: string }).revision = 'd'.repeat(40)
  })

  const mismatched = history()
  mismatched.revision = 'd'.repeat(40)
  mismatched.entries[0].revision = mismatched.revision
  assert.throws(() =>
    buildPalaceHandoff({
      diagnostic: value.diagnostic,
      history: mismatched,
      expiresAt: new Date('2026-01-02T00:10:00.000Z'),
    }),
  )

  for (const mutate of [
    (diagnostic: any) => {
      diagnostic.context.effectiveSystemPrompt.body = 'PRIVATE'
    },
    (diagnostic: any) => {
      diagnostic.context.usage.tokens = '1'
    },
    (diagnostic: any) => {
      diagnostic.context.usage.available = { private: 'PRIVATE' }
    },
    (diagnostic: any) => {
      diagnostic.context.effectiveSystemPrompt.available = { private: 'PRIVATE' }
    },
    (diagnostic: any) => {
      diagnostic.structure.upstreamOutput.private = true
    },
  ]) {
    const diagnostic = JSON.parse(JSON.stringify(value.diagnostic))
    mutate(diagnostic)
    assert.throws(() =>
      buildPalaceHandoff({
        diagnostic,
        history: history(),
        expiresAt: new Date('2026-01-02T00:10:00.000Z'),
      }),
    )
  }
})

test('ABI2 Palace page escapes metadata and keeps semantic bounded static sections', () => {
  const value = handoff()
  const mutable = JSON.parse(JSON.stringify(value))
  mutable.diagnostic.structure.files[0].path = 'global/<script>alert(1)</script>.md'
  mutable.diagnostic.structure.files[0].layer = 'legacy'
  mutable.diagnostic.structure.files[0].protectedRetention = false
  mutable.diagnostic.structure.files[0].alwaysLoaded = false
  const html = renderAbi2PalacePage(mutable)
  assert.ok(Buffer.byteLength(html) <= 256 * 1024)
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<html lang="en">/)
  assert.match(html, /<main id="content" class="main">/)
  assert.match(html, /<header class="header">\s*<h1>Mahiro Palace/)
  assert.match(html, /<nav aria-label="Page sections"><ul class="tabs">/)
  assert.match(html, /<section class="panel" id="invocation"/)
  assert.match(html, /<meta name="color-scheme" content="light dark">/)
  assert.doesNotMatch(html, /<svg|<img|<link|@import|url\(/i)
  assert.match(html, /<caption id="structure-caption">/)
  assert.match(html, /scope="col"/)
  assert.match(html, /role="region"[^>]+tabindex="0"/)
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /private prompt/i)
  assert.doesNotMatch(html, /<script\b/i)
  assert.match(html, /Non-atomic capture/)
  assert.match(html, /Latest up to 8 first-parent commits/)
  assert.match(html, /\/mh-memory palace close/)
  assert.doesNotMatch(html, /\/mh-memory palace-html close/)
})
