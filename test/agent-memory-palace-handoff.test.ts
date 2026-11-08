import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildMemoryInvocationContext } from '../lib/agent-memory/invocation-context.ts'
import type { KnowledgeHistory } from '../lib/agent-memory/knowledge-history.ts'
import { buildPalaceDiagnostic } from '../lib/agent-memory/palace-diagnostic.ts'
import { buildPalaceHandoff } from '../lib/agent-memory/palace-handoff.ts'
import {
  snapshotDigest,
  utf8Preview,
  palaceScopedPath,
  structureDigest,
  type PalaceStructure,
} from '../lib/agent-memory/palace-structure.ts'
import { abi2PalaceStyle, renderAbi2PalacePage } from '../lib/palace-render/abi2-page.ts'

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
    pageSize: 32,
    windowSize: 128,
    nextOffset: null,
    windowLimitReached: false,
    metadata: 'commit-identity-time-subject-count',
    entries: [
      {
        revision,
        parent: null,
        committedAt: '2026-01-01T00:00:00.000Z',
        subject: '<script>Update</script>',
        changedFiles: 2,
      },
    ],
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

test('bounded committed previews survive immutable handoff and render escaped with truthful truncation', () => {
  const s = structure()
  s.bodyInspection = 'bounded-committed-preview'
  const text = '<script>😀</script>'.repeat(500)
  const body = utf8Preview(text, 4096)
  assert.ok(Buffer.byteLength(body) <= 4096)
  assert.equal(body, utf8Preview(text, 4096))
  assert.ok(!body.includes('\ufffd'))
  s.files[0] = { ...s.files[0], bytes: Buffer.byteLength(text), body, bodyTruncated: true }
  s.structureDigest = structureDigest(s.files)
  s.snapshotDigest = snapshotDigest(s)
  const h = history()
  h.entries[0].diff = '+<script>😀</script>\n'
  h.entries[0].diffTruncated = true
  const context = buildMemoryInvocationContext({
    revision,
    configHash,
    usage: { tokens: null, contextWindow: 4096, percent: null },
    systemPrompt: '',
    model: undefined,
    projection: undefined,
    now: new Date('2026-01-02T00:00:00.000Z'),
  })
  const value = buildPalaceHandoff({
    diagnostic: buildPalaceDiagnostic(context, s),
    history: h,
    expiresAt: new Date('2026-01-02T00:10:00.000Z'),
  })
  assert.equal(value.diagnostic.structure.files[0].body, body)
  assert.equal(value.history.entries[0].diff, h.entries[0].diff)
  assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 48 * 1024)
  const html = renderAbi2PalacePage(value)
  assert.doesNotMatch(html, /Committed body \(truncated\)/)
  assert.match(html, /Commit diff \(truncated\)/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>/)
  for (const path of [
    'projects/other/reference/private.md',
    'archives/other/private.md',
    'archives/legacy-v1-abcdef123456/deferred/other/private.md',
  ])
    assert.equal(palaceScopedPath(path, 'project'), true)
  for (const path of [
    'global/private.md',
    'archives/legacy-v1-pretend/global/private.md',
    'archives/legacy-v1-abcdef123456/unknown/private.md',
    'projects/project/../private.md',
  ])
    assert.equal(palaceScopedPath(path, 'project'), false)
})

test('Palace uses native radio workspaces, inert Markdown/raw, and honest context categories', () => {
  const value = handoff()
  const s = structure()
  const body =
    '---\ndescription: "A <friend>"\nread_only: false\nlimit: 999\n---\n# Hello\n\n**bold** and *soft* and `code`\n\n- one\n- two\n\n1. first\n2. second\n\n> quote\n\n```html\n<img src=x onerror=alert(1)>\n```\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))\n# \n```'
  s.files = [
    { ...s.files[0], body, bodyTruncated: false, bytes: Buffer.byteLength(body) },
    {
      ...s.files[0],
      path: 'projects/other/reference/guide.md',
      layer: 'projectReference',
      alwaysLoaded: false,
      protectedRetention: false,
      body: '## Deferred\n\nText',
      bodyTruncated: false,
      bytes: 17,
    },
    {
      ...s.files[0],
      path: 'projects/project/system/conventions.md',
      layer: 'projectSystem',
      alwaysLoaded: true,
      protectedRetention: true,
      body: '## Project System\n\nText',
      bodyTruncated: false,
      bytes: 23,
    },
  ]
  s.bodyInspection = 'bounded-committed-preview'
  s.output = { total: 3, returned: 3, omitted: 0, truncated: false }
  s.structureDigest = structureDigest(s.files)
  s.snapshotDigest = snapshotDigest(s)
  const html = renderAbi2PalacePage(
    buildPalaceHandoff({
      diagnostic: buildPalaceDiagnostic(value.diagnostic.context, s),
      history: value.history,
      expiresAt: new Date(value.delivery.expiresAt),
    }),
  )
  assert.equal((html.match(/class="view-radio" type="radio"/g) ?? []).length, 4)
  assert.match(html, /id="view-context" checked/)
  assert.match(
    html,
    /for="view-context">Context<\/label><\/li><li><label class="tab" for="view-core">Core Memory \(1\)<\/label><\/li><li><label class="tab" for="view-external">External Memory \(2\)<\/label><\/li><li><label class="tab" for="view-history">History<\/label>/,
  )
  assert.match(html, /<span class="tree-file-name">project\/<\/span>/)
  assert.match(html, /<span class="tree-file-name">other\/<\/span>/)
  assert.doesNotMatch(html, /<span class="tree-file-name">projects\/<\/span>/)
  assert.match(html, /class="header-brand"/)
  assert.match(html, /class="product-mark"[^>]*><svg /)
  assert.match(html, /<span class="product-name">Mahiro Pi<\/span>/)
  assert.match(html, /<h1 class="agent-name">project's Memory Palace<\/h1>/)
  assert.match(html, /id="core-file-0" checked/)
  assert.match(html, /for="core-file-0"/)
  assert.match(html, /id="raw-core-0"/)
  assert.match(html, /\.raw-toggle-input:checked/)
  assert.match(html, /\[id="core-file-0"\]:checked/)
  assert.match(html, /<details class="tree-dir" open>/)
  assert.match(html, /<h1>Hello<\/h1>/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /<em>soft<\/em>/)
  assert.match(html, /<code>code<\/code>/)
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/)
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/)
  assert.match(html, /<blockquote>quote<\/blockquote>/)
  assert.match(html, /description: <strong>A &lt;friend&gt;<\/strong>/)
  assert.doesNotMatch(html, /<(?:script|img|link)\b/i)
  assert.equal((html.match(/class="block ctx-/g) ?? []).length, 480)
  assert.match(html, /for="view-core" data-legend="core"/)
  assert.match(html, /for="view-external" data-legend="external"/)
  assert.match(html, /<details class="commit-item" open>/)
  assert.doesNotMatch(html, /id="invocation"|id="structure"|Document-authored frontmatter/)
})

test('Palace Raw view preserves initial LF and CR/CRLF text without a script', () => {
  const value = JSON.parse(JSON.stringify(handoff()))
  value.diagnostic.structure.files[0].body = '\nFirst\r\nSecond\rThird\n'
  const html = renderAbi2PalacePage(value)
  assert.match(
    html,
    /<div class="file-body-raw"><pre><code>\nFirst&#13;\nSecond&#13;Third\n<\/code><\/pre><\/div>/,
  )
  assert.doesNotMatch(html, /<script\b/)
})

test('Palace polish keeps clean Letta views and applies document, context and diff styling', () => {
  const html = renderAbi2PalacePage(handoff())
  const contextStart = html.indexOf('<div class="view view-context"')
  const coreStart = html.indexOf('<div class="view view-core"')
  const externalStart = html.indexOf('<div class="view view-external"')
  const historyStart = html.indexOf('<div class="view view-history"')
  assert.ok(
    contextStart > 0 && contextStart < coreStart && coreStart < externalStart && externalStart < historyStart,
  )
  assert.match(html, /<div class="panel context-panel"><div class="context-layout">/)
  for (const rule of [
    '.header-brand {',
    '.product-mark {',
    '.file-body, .file-body-raw { padding: 20px 28px;',
    '.file-body { font-family: var(--serif); font-size: 16px; line-height: 1.65;',
    'margin: 18px 0 8px; font-family: var(--serif);',
    '.file-body h1 { font-size: 28px; }',
    '.file-body h2 { font-size: 22px; border-bottom: 1px solid var(--border); }',
    '.file-body h3 { font-size: 18px; }',
    '.file-body code { font-family: var(--mono); font-size: 13px;',
    'border-radius: 4px; padding: 1px 5px;',
    '.file-body pre { background: var(--surface-2); border-radius: 8px; padding: 12px; overflow: auto; }',
    '.file-body pre code { background: transparent; border: 0; padding: 0; }',
    '.file-meta { position: relative; padding: 10px 14px; background: var(--surface);',
    '.meta-pill { font-size: 12px; color: var(--text-muted); padding: 2px 8px; background: var(--panel);',
    'border-radius: 999px;',
    '.raw-toggle { position: absolute; top: 8px; right: 10px; font-size: 11px; padding: 3px 8px;',
    '.raw-toggle:hover { background: var(--accent-light); color: var(--accent); }',
    '.raw-toggle-input:checked + .raw-toggle { background: var(--accent); color: #fff; }',
    '.context-panel { margin-bottom: 0; }',
    '.context-grid-area { flex: 1; padding: 20px;',
    '.context-sidebar { width: 280px; min-width: 280px; padding: 20px; border-left: 1px solid var(--border); background: var(--surface); }',
    '.ctx-system { color: rgb(224, 112, 80); }',
    '.ctx-core { color: rgb(224, 160, 64); }',
    '.ctx-external { color: rgb(32, 178, 170); }',
    '.ctx-messages, .ctx-unattributed { color: rgb(140, 140, 249); }',
    '.ctx-free { color: var(--text-dim); opacity: .35; }',
    '.diff-line { display: block; padding: 0 12px; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }',
    '.diff-line.add { background: #dafbe1; color: #1a7f37; }',
    '.diff-line.del { background: #ffebe9; color: #cf222e; }',
    '.diff-line.hunk { background: #ddf4ff; color: var(--accent); }',
    '.diff-line.hunk, .diff-file-header { padding: 2px 12px; }',
    '.diff-line.add { background: hsl(140, 30%, 14%); color: #7ee787; }',
    '.diff-line.del { background: hsl(0, 40%, 16%); color: #ffa198; }',
    '.diff-line.hunk { background: hsl(210, 30%, 16%); color: hsl(210, 40%, 70%); }',
    '.db-block.add { background: #2da44e; }',
    '.db-block.del { background: #cf222e; }',
  ])
    assert.ok(abi2PalaceStyle.includes(rule), rule)
})

test('Palace diff blocks reflect owner-returned additions/deletions, excluding file headers', () => {
  const value = handoff()
  const h = history()
  h.entries = ['--- old\n+++ new\n@@ hunk @@\n+a\n+b\n+c\n-d\n-e', '+a', '-a', ''].map((diff, index) => ({
    ...h.entries[0],
    revision: index ? String(index).repeat(40) : revision,
    parent: index === 3 ? null : String(index + 1).repeat(40),
    diff,
    diffTruncated: false,
  }))
  const html = renderAbi2PalacePage(
    buildPalaceHandoff({
      diagnostic: value.diagnostic,
      history: h,
      expiresAt: new Date(value.delivery.expiresAt),
    }),
  )
  const cards = html.split('<details class="commit-item"').slice(1)
  for (const [index, [added, removed]] of [
    [3, 2],
    [5, 0],
    [0, 5],
    [0, 0],
  ].entries()) {
    const card = cards[index].split('</details>')[0]
    assert.equal((card.match(/class="db-block add"/g) ?? []).length, added)
    assert.equal((card.match(/class="db-block del"/g) ?? []).length, removed)
    assert.equal((card.match(/class="db-block"/g) ?? []).length, added + removed ? 0 : 5)
  }
  assert.match(cards[0], /class="db-plus">\+3/)
  assert.match(cards[0], /class="db-minus">−2/)
  assert.match(cards[0], /class="diff-line diff-file-header">--- old/)
  assert.match(cards[0], /class="diff-line hunk">@@ hunk @@/)

  const mixed = history()
  mixed.entries = [
    {
      revision,
      parent: '1'.repeat(40),
      committedAt: '2026-01-01T00:01:00.000Z',
      subject: 'Update memory',
      changedFiles: 0,
      diff: '',
      diffTruncated: false,
    },
    {
      revision: '1'.repeat(40),
      parent: null,
      committedAt: '2026-01-01T00:00:00.000Z',
      subject: 'Curate Core.md',
      changedFiles: 1,
      diff: '+Core update\n',
      diffTruncated: false,
    },
  ]
  const filteredHtml = renderAbi2PalacePage(
    buildPalaceHandoff({
      diagnostic: value.diagnostic,
      history: mixed,
      expiresAt: new Date(value.delivery.expiresAt),
    }),
  )
  assert.match(filteredHtml, /1 recent commit/)
  assert.match(filteredHtml, /Curate Core\.md/)
  assert.match(
    filteredHtml,
    /<span class="lc-hash">1111111<\/span><span class="lc-msg">Curate Core\.md<\/span>/,
  )
  assert.doesNotMatch(filteredHtml, /Update memory/)
  assert.doesNotMatch(filteredHtml, /0 files changed/)
})

test('Palace deterministically budgets repeated workspace previews within 256 KiB', () => {
  const value = handoff()
  const s = structure()
  s.files = Array.from({ length: 32 }, (_, index) => ({
    ...s.files[0],
    path: `reference/file-${String(index).padStart(3, '0')}.md`,
    layer: 'reference',
    alwaysLoaded: false,
    protectedRetention: false,
    bytes: 256,
    body: '&'.repeat(256),
    bodyTruncated: false,
  }))
  s.bodyInspection = 'bounded-committed-preview'
  s.output = { total: 32, returned: 32, omitted: 0, truncated: false }
  s.structureDigest = structureDigest(s.files)
  s.snapshotDigest = snapshotDigest(s)
  const h = history()
  h.entries = Array.from({ length: 8 }, (_, index) => ({
    ...h.entries[0],
    revision: index === 0 ? revision : String(index).repeat(40),
    parent: index === 7 ? null : String(index + 1).repeat(40),
    diff: '+&\n'.repeat(341),
    diffTruncated: true,
  }))
  const input = buildPalaceHandoff({
    diagnostic: buildPalaceDiagnostic(value.diagnostic.context, s),
    history: h,
    expiresAt: new Date(value.delivery.expiresAt),
  })
  const html = renderAbi2PalacePage(input)
  assert.equal(html, renderAbi2PalacePage(input))
  assert.match(html, /id="view-context" checked/)
  assert.match(html, /for="view-external">External Memory \(32\)/)
  assert.match(html, new RegExp('&amp;'.repeat(256)))
  assert.match(html, /reference\/file-031\.md/)
})

test('Palace archive scope recognizes canonical shared and cross-project migrations', () => {
  const collision = 'legacy-v1-abcdef123456'
  assert.equal(palaceScopedPath(`archives/${collision}/deferred/other/private.md`, collision), true)
  assert.equal(palaceScopedPath(`archives/${collision}/unknown/private.md`, collision), false)
  assert.equal(palaceScopedPath('archives/legacy-v1-pretend/global/private.md', 'legacy-v1-pretend'), false)
  assert.equal(palaceScopedPath(`archives/${collision}/deferred/${collision}/own.md`, collision), true)
  for (const path of [
    'archives/legacy-v1-abcdef123456/global/pref.md',
    'archives/legacy-v1-abcdef123456/deferred/project/pref.md',
    'archives/project/retained.md',
  ])
    assert.equal(palaceScopedPath(path, 'project'), true)
})

test('installed Palace HTML boundary does not import the disconnected local service', () => {
  for (const path of [
    '../lib/agent-memory/experimental-runtime.ts',
    '../lib/agent-memory/palace-handoff.ts',
    '../lib/palace-render/abi2-page.ts',
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
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<html lang="en">/)
  assert.match(html, /<main id="content" class="main">/)
  assert.match(html, /<header class="header">\s*<div class="header-brand">/)
  assert.match(html, /<span class="product-name">Mahiro Pi<\/span>/)
  assert.match(html, /<h1 class="agent-name">project's Memory Palace<\/h1>/)
  assert.match(html, /<nav aria-label="Page sections"><ul class="tabs">/)
  assert.match(html, /<meta name="color-scheme" content="light dark">/)
  assert.doesNotMatch(html, /<img|<link|@import|url\(/i)
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;script&gt;Update&lt;\/script&gt;/)
  assert.match(html, /2 files changed/)
  assert.doesNotMatch(html, /private prompt/i)
  assert.doesNotMatch(html, /<script\b/i)
  assert.match(html, /Persistent private snapshot/)
  assert.doesNotMatch(html, /\/mh-memory palace-html close/)
})
