import { bytes } from '../continuity/records.ts'
import type { PalaceHandoff } from '../agent-memory/palace-handoff.ts'

export const abi2PalaceStyle = `
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #0a0a0c;
  color: #f4f1ff;
}
* { box-sizing: border-box; }
html { min-inline-size: 20rem; background: #0a0a0c; }
body { margin: 0; min-block-size: 100vh; background: radial-gradient(circle at 85% 0%, #241a3a 0, transparent 34rem), #0a0a0c; }
a { color: #c8b5ff; text-underline-offset: 0.18em; }
a:hover { color: #e7deff; }
a:focus-visible { outline: 3px solid #c8b5ff; outline-offset: 3px; border-radius: 0.2rem; }
code, time, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
code { overflow-wrap: anywhere; }
.shell { inline-size: min(100% - 2rem, 76rem); margin-inline: auto; padding-block: clamp(1.5rem, 4vw, 4rem); }
.hero { display: grid; gap: 1rem; padding: clamp(1.25rem, 3vw, 2.5rem); border: 1px solid #342a48; border-radius: 1.5rem; background: rgba(18, 15, 24, 0.92); box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.32); }
.eyebrow { margin: 0; color: #b5a3d8; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
h1 { margin: 0; max-inline-size: 18ch; font-size: clamp(2rem, 7vw, 4.75rem); line-height: 0.95; letter-spacing: -0.055em; }
.lede { margin: 0; max-inline-size: 70ch; color: #c9c2d5; line-height: 1.65; }
.notice { margin: 0; padding: 0.9rem 1rem; border-inline-start: 0.25rem solid #9d7cff; background: #171220; color: #ddd4eb; }
nav ul { display: flex; flex-wrap: wrap; gap: 0.55rem; margin: 0; padding: 0; list-style: none; }
nav a { display: inline-flex; min-block-size: 2.75rem; align-items: center; padding-inline: 0.9rem; border: 1px solid #44365d; border-radius: 999px; background: #141019; text-decoration: none; }
main { display: grid; gap: 1rem; margin-block-start: 1rem; }
section { scroll-margin-block-start: 1rem; padding: clamp(1.1rem, 2.5vw, 2rem); border: 1px solid #2d2638; border-radius: 1.25rem; background: rgba(16, 14, 20, 0.94); }
h2 { margin-block: 0 1rem; font-size: clamp(1.35rem, 3vw, 2rem); letter-spacing: -0.025em; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 0.75rem; margin: 0; }
.meta div { min-inline-size: 0; padding: 0.9rem; border: 1px solid #2f283b; border-radius: 0.85rem; background: #0d0b10; }
dt { color: #a99eba; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
dd { margin: 0.45rem 0 0; color: #f3effa; overflow-wrap: anywhere; }
.table-region { max-inline-size: 100%; overflow: auto; border: 1px solid #31283e; border-radius: 0.85rem; container-type: inline-size; }
.table-region:focus-visible { outline: 3px solid #c8b5ff; outline-offset: 3px; }
table { inline-size: 100%; min-inline-size: 42rem; border-collapse: separate; border-spacing: 0; font-size: 0.9rem; }
caption { padding: 0.85rem 1rem; color: #bdb2cb; text-align: start; }
th, td { padding: 0.75rem 0.85rem; border-block-start: 1px solid #292231; text-align: start; vertical-align: top; }
thead th { position: sticky; inset-block-start: 0; z-index: 1; border-block-start: 0; background: #191320; color: #d9cfff; }
tbody th { position: sticky; inset-inline-start: 0; background: #100d14; }
tbody tr:nth-child(even) td, tbody tr:nth-child(even) th { background: #131018; }
.status { display: inline-flex; align-items: center; min-block-size: 1.75rem; padding-inline: 0.55rem; border-radius: 999px; background: #282033; color: #d8c8ff; font-size: 0.78rem; font-weight: 700; }
footer { padding: 1.25rem 0.25rem 0; color: #948a9f; font-size: 0.85rem; line-height: 1.6; }
@container (width < 38rem) {
  table { min-inline-size: 36rem; font-size: 0.82rem; }
  th, td { padding: 0.65rem; }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
@media (forced-colors: active) { section, .hero, .table-region, .meta div, nav a { border: 1px solid CanvasText; } }
`

export function renderAbi2PalacePage(handoff: PalaceHandoff): string {
  const context = handoff.diagnostic.context
  const structure = handoff.diagnostic.structure
  const history = handoff.history
  const usage = context.usage.available
    ? `${displayCount(context.usage.tokens)} / ${displayCount(context.usage.contextWindow)} tokens (${displayPercent(context.usage.percent)})`
    : `Unavailable (${context.usage.reason})`
  const prompt = context.effectiveSystemPrompt.available
    ? `${displayCount(context.effectiveSystemPrompt.utf8Bytes)} UTF-8 bytes`
    : `Unavailable (${context.effectiveSystemPrompt.reason})`
  const projection = context.memoryProjection
    ? `${context.memoryProjection.revision} · ${displayCount(context.memoryProjection.emittedBlockUtf8Bytes)} bytes · ${context.memoryProjection.capturedAt}`
    : 'No current owner receipt associated with this invocation'
  const files = structure.files
    .map(
      (file) => `<tr>
<th scope="row"><code>${escape(file.path)}</code></th>
<td>${escape(file.layer)}</td>
<td>${displayCount(file.bytes)}</td>
<td>${file.alwaysLoaded ? 'Yes' : 'No'}</td>
<td>${file.protectedRetention ? 'Yes' : 'No'}</td>
<td>${displayCount(file.sourcesCount)}</td>
</tr>`,
    )
    .join('')
  const historyRows = history.entries
    .map(
      (entry) => `<tr>
<th scope="row"><code>${escape(entry.revision)}</code></th>
<td>${entry.parent ? `<code>${escape(entry.parent)}</code>` : 'Root'}</td>
<td><time datetime="${escape(entry.committedAt)}">${escape(entry.committedAt)}</time></td>
</tr>`,
    )
    .join('')
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Committed memory metadata | Mahiro Palace</title>
<style>${abi2PalaceStyle}</style>
</head>
<body>
<div class="shell">
<header class="hero">
<p class="eyebrow">Mahiro Palace · ABI2 metadata handoff</p>
<h1>Committed memory, frozen for review.</h1>
<p class="lede">This immutable page combines one owner-certified committed structure, one observed invocation association and the latest bounded first-parent history page. It contains metadata only.</p>
<p class="notice"><strong>Non-atomic capture.</strong> Invocation association is observed, not a provider-consumption receipt. Replay, lifecycle history, document bodies, diffs and mutation controls are unavailable.</p>
<nav aria-label="Page sections"><ul>
<li><a href="#invocation">Invocation</a></li>
<li><a href="#structure">Committed structure</a></li>
<li><a href="#history">Knowledge history</a></li>
</ul></nav>
</header>
<main id="content">
<section id="invocation" aria-labelledby="invocation-heading">
<h2 id="invocation-heading">Invocation</h2>
<dl class="meta">
<div><dt>Captured</dt><dd><time datetime="${escape(context.capturedAt)}">${escape(context.capturedAt)}</time></dd></div>
<div><dt>Expires</dt><dd><time datetime="${escape(handoff.delivery.expiresAt)}">${escape(handoff.delivery.expiresAt)}</time></dd></div>
<div><dt>Capture ID</dt><dd><code>${escape(handoff.diagnostic.captureId)}</code></dd></div>
<div><dt>Current revision</dt><dd><code>${escape(context.binding.revision)}</code></dd></div>
<div><dt>Configuration</dt><dd><code>${escape(context.binding.configHash)}</code></dd></div>
<div><dt>Public context estimate</dt><dd>${escape(usage)}</dd></div>
<div><dt>Effective system prompt</dt><dd>${escape(prompt)}</dd></div>
<div><dt>Last memory projection</dt><dd>${escape(projection)}</dd></div>
<div><dt>Provider prompt</dt><dd><span class="status">Unavailable</span></dd></div>
<div><dt>Category token accounting</dt><dd><span class="status">Unavailable</span></dd></div>
</dl>
</section>
<section id="structure" aria-labelledby="structure-heading">
<h2 id="structure-heading">Committed structure</h2>
<dl class="meta">
<div><dt>Project</dt><dd><code>${escape(structure.project)}</code></dd></div>
<div><dt>Snapshot basis</dt><dd>${escape(structure.basis)}</dd></div>
<div><dt>Currentness</dt><dd>${escape(structure.currentness)}</dd></div>
<div><dt>Coverage</dt><dd>${displayCount(structure.output.returned)} of ${displayCount(structure.output.total)} entries; ${displayCount(structure.output.omitted)} omitted</dd></div>
<div><dt>Structure digest</dt><dd><code>${escape(structure.structureDigest)}</code></dd></div>
<div><dt>Snapshot digest</dt><dd><code>${escape(structure.snapshotDigest)}</code></dd></div>
</dl>
<div class="table-region" role="region" aria-labelledby="structure-caption" tabindex="0">
<table>
<caption id="structure-caption">Returned committed memory structure${structure.output.truncated ? '; bounded output is truncated' : ''}</caption>
<thead><tr><th scope="col">Path</th><th scope="col">Layer</th><th scope="col">Bytes</th><th scope="col">Always loaded</th><th scope="col">Protected</th><th scope="col">Sources</th></tr></thead>
<tbody>${files || '<tr><td colspan="6">No returned structure entries.</td></tr>'}</tbody>
</table>
</div>
</section>
<section id="history" aria-labelledby="history-heading">
<h2 id="history-heading">Knowledge history</h2>
<p class="lede">Latest up to 8 first-parent commits from the bounded 128-entry observation window. This page does not expose authors, subjects, paths, counts, diffs or document bodies.</p>
<dl class="meta">
<div><dt>Ledger digest</dt><dd><code>${escape(history.ledgerDigest)}</code></dd></div>
<div><dt>History basis</dt><dd>${escape(history.basis)}</dd></div>
<div><dt>More observed</dt><dd>${history.nextOffset === null ? 'No additional page advertised' : `Yes, from offset ${history.nextOffset}; this handoff is not paginated`}</dd></div>
<div><dt>Window limit reached</dt><dd>${history.windowLimitReached ? 'Yes' : 'No'}</dd></div>
</dl>
<div class="table-region" role="region" aria-labelledby="history-caption" tabindex="0">
<table>
<caption id="history-caption">Identity and canonical UTC time only</caption>
<thead><tr><th scope="col">Revision</th><th scope="col">First parent</th><th scope="col">Committed at</th></tr></thead>
<tbody>${historyRows || '<tr><td colspan="3">No returned history entries.</td></tr>'}</tbody>
</table>
</div>
</section>
</main>
<footer>This page is served from a capability URL on <code>127.0.0.1</code>. Anyone holding the URL can read this frozen metadata while it remains valid. Refresh requires current ABI2 authority; use <code>/mh-memory palace-html close</code> to stop serving it.</footer>
</div>
</body>
</html>`
  if (bytes(html) > 256 * 1024) throw Error('Palace HTML exceeds bound')
  return html
}

function displayCount(value: number | null): string {
  return value === null ? 'Unknown' : new Intl.NumberFormat('en-US').format(value)
}

function displayPercent(value: number | null): string {
  return value === null ? 'unknown' : `${value.toFixed(2).replace(/\.00$/, '')}%`
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;'
    if (character === '<') return '&lt;'
    if (character === '>') return '&gt;'
    if (character === '"') return '&quot;'
    return '&#39;'
  })
}
