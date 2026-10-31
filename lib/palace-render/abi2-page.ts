import { bytes } from '../continuity/records.ts'
import type { PalaceHandoff } from '../agent-memory/palace-handoff.ts'

export const abi2PalaceStyle = `
/* Letta Code src/web/memory-viewer-template.txt, Apache-2.0.
 * v0.34.36 / 8f72222dec142dfc2316692d68ada3ab2e439d46.
 * Unchanged from audited v0.34.31 / a8900b882446d7aa99fedf2845d400743affd1b6.
 * See THIRD_PARTY_NOTICES.md. No branding, remote fonts, scripts or asset routes.
 */
:root {
  color-scheme: light dark;
  --accent: hsl(240, 93%, 35%);
  --accent-light: hsl(240, 67%, 98%);
  --accent-light-border: hsl(240, 62%, 94%);
  --bg: #ffffff;
  --panel: #ffffff;
  --border: hsl(210, 10%, 92.2%);
  --text: hsl(0, 0%, 8%);
  --text-muted: hsl(210, 3%, 28%);
  --text-dim: hsl(210, 3%, 66%);
  --mono: 'Fira Code', Menlo, Courier, monospace;
  --sans: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif;
  --serif: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
  --radius: 6px;
  --max-w: 1180px;
  --surface: hsl(0, 0%, 98%);
  --surface-2: hsl(0, 0%, 96%);
  --hover: hsl(0, 0%, 96%);
  --hover-accent: hsl(240, 67%, 98%);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--mono);
  color: var(--text);
  background: var(--bg);
  line-height: 1.55;
  font-weight: 400;
  font-size: 13px;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.app-shell {
  max-width: var(--max-w);
  margin: 22px auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 6px 16px rgba(0, 0, 0, 0.04);
}
.header {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  display: flex;
  gap: 12px;
  align-items: center;
}
/* Upstream agent-name typography replaces the hidden h1/brand SVG. */
.header h1 {
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
}
.tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.tab {
  padding: 10px 16px;
  cursor: pointer;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-muted);
  user-select: none;
}
.tab:hover { color: var(--text); }
.main { padding: 16px; }
.panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--panel);
}
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #ddd; padding: 6px 10px; }
th { background: var(--surface); text-align: left; }
.status {
  margin-left: 6px;
  font-size: 10px;
  color: var(--accent);
  background: var(--accent-light);
  border: 1px solid var(--accent-light-border);
  border-radius: 999px;
  padding: 0 6px;
}
footer {
  margin-top: 14px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
/* Minimal mappings for static anchors, metadata dl, captions and focusable regions.
 * Spacing/type values reuse upstream main, file-meta, meta-row and tree-desc rules.
 */
nav ul { flex-wrap: wrap; list-style: none; }
.tab { display: block; }
section { margin-bottom: 16px; }
h2, caption {
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  text-align: left;
}
.lede, .notice, .meta { padding: 10px 14px; color: var(--text-muted); }
.notice { border-bottom: 1px solid var(--border); background: var(--surface); }
.meta { display: flex; flex-wrap: wrap; gap: 10px; }
.meta div { min-width: 0; max-width: 100%; }
dt { font-size: 12px; }
dd { color: var(--text); overflow-wrap: anywhere; }
code, time { font-family: var(--mono); }
code { overflow-wrap: anywhere; }
.table-region { max-width: 100%; overflow: auto; }
table { min-width: 42rem; }
td, th { vertical-align: top; }
a:focus-visible, .table-region:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
/* No JS theme toggle: exact upstream dark tokens/overrides follow OS preference. */
@media (prefers-color-scheme: dark) {
  :root {
    --accent: hsl(240, 80%, 68%);
    --accent-light: hsl(240, 20%, 18%);
    --accent-light-border: hsl(240, 15%, 25%);
    --bg: hsl(0, 0%, 11%);
    --panel: hsl(0, 0%, 13%);
    --surface: hsl(0, 0%, 15%);
    --surface-2: hsl(0, 0%, 18%);
    --hover: hsl(0, 0%, 18%);
    --hover-accent: hsl(240, 15%, 20%);
    --border: hsl(210, 3%, 20%);
    --text: hsl(210, 7%, 84%);
    --text-muted: hsl(210, 3%, 60%);
    --text-dim: hsl(210, 3%, 42%);
  }
  .app-shell { box-shadow: 0 1px 3px rgba(0,0,0,0.2), 0 6px 16px rgba(0,0,0,0.3); }
  .tabs { background: var(--surface-2); }
  .status { background: var(--surface); border-color: var(--border); }
  th { background: var(--surface); color: var(--text); }
  th, td { border-color: var(--border); }
}
@media (forced-colors: active) { .panel, .app-shell { border: 1px solid CanvasText; } }
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
<meta name="color-scheme" content="light dark">
<title>Committed memory metadata | Mahiro Palace</title>
<style>${abi2PalaceStyle}</style>
</head>
<body>
<div class="app-shell">
<header class="header">
<h1>Mahiro Palace · ABI2 metadata handoff</h1>
</header>
<p class="lede">This immutable page combines one owner-certified committed structure, one observed invocation association and the latest bounded first-parent history page. It contains metadata only.</p>
<p class="notice"><strong>Non-atomic capture.</strong> Invocation association is observed, not a provider-consumption receipt. Replay, lifecycle history, document bodies, diffs and mutation controls are unavailable.</p>
<nav aria-label="Page sections"><ul class="tabs">
<li><a class="tab" href="#invocation">Invocation</a></li>
<li><a class="tab" href="#structure">Committed structure</a></li>
<li><a class="tab" href="#history">Knowledge history</a></li>
</ul></nav>
<main id="content" class="main">
<section class="panel" id="invocation" aria-labelledby="invocation-heading">
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
<section class="panel" id="structure" aria-labelledby="structure-heading">
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
<section class="panel" id="history" aria-labelledby="history-heading">
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
<footer>This page is served from a capability URL on <code>127.0.0.1</code>. Anyone holding the URL can read this frozen metadata while it remains valid. Refresh requires current ABI2 authority; use <code>/mh-memory palace close</code> to stop serving it.</footer>
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
