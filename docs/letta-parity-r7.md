# R7 — Disconnected invocation view and knowledge history

[← Documentation](README.md) · [Roadmap/status](letta-parity-roadmap.md) · [Memory](agent-memory.md)

## Scope and evidence boundary

R7-01–05 retain the disconnected synthetic service contract. Later bounded ABI2
source slices add command-time context, committed structure, identity/time-only
history and an immutable metadata HTML handoff outside `lib/agent-memory/local/**`.
Those source slices did not establish current-profile installation, provider
consumption, rendered acceptance or Phase I. A later bounded current-profile/browser
observation now completes R7-I only; R7-O/H remain open. The dated **60% source / 30%
evidence-backed** statement belongs to the original R7 checkpoint; current scoring
remains owned by the roadmap and is not recalculated here. No private corpus,
provider, remote transport, profile activation or browser opening is authorized.

## 2026-10-30 ABI2 invocation-diagnostic follow-up

A later bounded source follow-up adds invocation-metadata diagnosis owned by the
installed ABI2 runtime, not by `lib/agent-memory/local/**`. The compatibility route
requires the current idle primary binding and existing `agent_memory_manage` read
authority. It returns only bounded metadata: current committed revision/config
identity, public Pi context estimates with explicit unknown/invalid states, current
effective-system-prompt byte size and the most recent receipt emitted by the real
ABI2 `before_agent_start` projection owner. The receipt records revision, config,
time and emitted block bytes; it contains no prompt/file text, root/session path or
transcript payload.

This diagnostic deliberately separates current committed revision from the last
owner-produced projection revision. It labels provider prompt consumption and
category token accounting unavailable. It is not a new management action or model
callable tool, does not import the disconnected service, opens no HTML route and
persists no invocation history. Source tests cover A→B revision drift, next-request
refresh, null usage, malformed public data, failed projection, authority revocation,
config identity changes and writer-admission races. A disposable ordinary public-SDK
installation now invokes the real registered command before and after a genuine Faux
parent request, proving installed command wiring, null-before-projection behavior and
the matching projection receipt without current-profile mutation. This advances an
installed-collector prerequisite only: the harness does not open a Palace snapshot or
establish provider-backed/longitudinal/rendered behavior, so R7-I/O/H and Mahiro
acceptance remain open. No activation/reload is implied by this evidence.

`palace-invocation.ts` owns the new strict version-1
`synthetic-local-invocation-view` envelope; it is not an extension of either
existing strict v1 context or metadata snapshot DTO. `palaceCapture` resolves
canonical main and forgetting policy inside the coordinator turn, compiles the
real `compileLocalMemoryPrompt` result, and retains at most 16 capture identities.
It records a capture UUID/time, exact committed OID, policy digest/revision,
working-tree **unavailable**, and separate context and projection provenance.
Caller context is parsed with the existing context validator. Fixture context
is labelled `fixture`; other supplied context is `caller-supplied`, never proof
of live collection. Usage remains estimated/owner-supplied; omitted context is
unavailable. A supplied context's time is the envelope time, not a claim that
this service observed a session at that time. No raw root/session payload is stored.
Corpus bytes are never context usage.

The projection receipt records exact selected roles/paths, source/returned bytes,
clipping flags, reply bytes, absent owners, deferred and blocked lists. Requested
project overview/conventions come from that committed projection. It contains no
prompt/file text and always says `synthetic-local-projection`, never installed
active memory. Compact projection is not the whole corpus or model context.

## Committed-at-capture API

- `palaceCapturedSnapshot(captureId)` returns the existing metadata snapshot only
  while its head/policy still match the retained capture.
- `palaceKnowledgeHistory(captureId, offset)` returns up to eight first-parent
  commits per page, bounded to 128 commits from captured head. Each row includes
  OID, first parent, date and filtered replacement-change stats. Bounded
  control-stripped author/subject are available only while no path/blob exclusion
  is active; otherwise both are `null` with `metadataUnavailable: true`, because
  commit metadata has no safe knowledge attribution. Pagination and depth
  truncation are explicit.
- `palaceKnowledgeDiff(captureId, commit)` accepts only a full OID reachable on
  that bounded first-parent chain, not a ref, path, detached commit or worktree.
  It returns full-side replacement text (`before`/`after`) for at most 16 safe
  regular UTF-8 `.md`/`.txt` paths. Added/removed counts describe replacement
  lines, not a minimal edit algorithm or rename detector. Each side is at most
  4096 bytes, with a 32 KiB aggregate path/text budget. Oversize, nontext,
  forbidden and special entries are omitted with counts/truncation, not read
  partially as misleading complete text. Existing Git object/output caps also apply.

The coordinator certifies identity and checks current canonical head and policy
before and after captured reads. Main/policy advancement refuses **stale**;
unknown, evicted or reopened-service captures refuse stale too. It never silently
substitutes newer head B for capture A. Reads can reconcile/recover before the
body under the service owner; this is not a promise that reads cannot mutate
service state. Capture receipts are copied so caller mutation cannot rebind them.

Current path and blob exclusions apply to both historical sides, including
removals; an exact-content move from/to a forbidden path is suppressed on both
sides. No historical source-attribution ledger exists. Therefore a nonempty
source exclusion policy makes capture/history/diff **unavailable: source
exclusions**, rather than guessing source identity from a filename. Logical
forgetting is not secure Git-history erasure or retroactive browser erasure.

## HTML and transport boundary

Two HTML owners remain deliberately separate:

- `lib/agent-memory/local/**` retains its fixture/private-shadow, per-request
  synthetic preview with document/corpus callbacks and lifecycle-oriented views.
  Extension, kernel, installer and profile code still do not import it.
- The later source-only ABI2 handoff uses `lib/palace-render/**` with one frozen,
  metadata-only page. It receives no root, Git handle, file reader, document
  callback or disconnected-service DTO.

The ABI2 page renders only invocation metadata, returned committed structure and
one eight-row first-parent identity/time page. It has no JavaScript, remote asset,
font, diff/body route, JSON API, lifecycle tab, replay control or mutation control.
Every metadata string is escaped. Semantic headings, landmarks, definition lists
and tables remain keyboard-scrollable at narrow widths. This is not visual parity
with the disconnected four-view Palace and is not Mahiro acceptance.

The new transport binds only `127.0.0.1:0` and generates one 32-byte base64url
capability path. It requires exact Host/path, accepts only GET/HEAD without a body,
refuses foreign Origin/cross-site Fetch Metadata, and grants no CORS or cookies.
A hash-only fixed style CSP keeps `default-src`, scripts, connections, images,
fonts, workers and objects denied. `no-store`, `no-referrer`, `nosniff`, frame
denial, same-origin resource policy and disabled unused permissions accompany each
response. Requests, headers, URL length and validation concurrency are bounded.

## Focused verification and remaining gates

`test/agent-memory-local-invocation.test.ts` exercises real synthetic commits:
fixture/caller/unavailable context, corpus/context separation, exact projection
receipt/project selection, caller-mutation isolation, A→B stale refusal,
first-parent paging/depth/merge exclusion, filtered stats/replacement diffs,
detached/ref/path rejection, separate path/blob alias and deleted-side forgetting,
forgotten commit-metadata suppression, source uncertainty, normalized context,
UTF-8 BOM/symlink/oversize/file/byte truncation. Existing Palace, projection and
forgetting suites remain the compatibility/security regression owners.

The 128-commit depth cap intentionally makes deeper history unavailable. The later
ABI2 diagnostic supplies bounded primary/revision/config binding, public Pi usage
metadata and memory-owner output evidence, but it still does not open an authorized
Palace snapshot or prove provider prompt consumption. HTML history/diff navigation,
asynchronous latest-intent tests for any future routes, installed command execution,
observed runtime and Mahiro's visual/product/RAM acceptance remain open. Synthetic
and source tests do not establish those gates.

## R7-07 internal combined diagnostic prerequisite

The combined diagnostic owner requires existing exact `agent_memory_manage` read
authority on an idle ABI2 primary; ABI1 refuses without fallback. One runtime
capture resolves the owner once, reads initial
status/config, invokes the dedicated internal `palaceStructure` engine RPC, samples public context and
the projection-owner receipt, then checks final status/config, branch, activity,
authority and binding. Revision/config mismatches refuse without silent retry.
The engine certifies one committed HEAD against the expected config hash and mapped
project, derives active suppression-aware metadata, explicitly reauthorizes every
active path even on warm certificates, then rereads config and HEAD sequentially.
Drift fails closed without retry. These are final observations, not simultaneous
sampling or proof that config/HEAD stayed unchanged throughout. The committed
snapshot is owner-certified; its association with invocation context remains
observed-non-atomic (`atomic: false`), not a linearizable combined capture or viewer.
Lifecycle is omitted; captureId is correlation only and replay is unsupported.

The closed JSON DTO retains context's 4 KiB bound, at most 128 structural files,
a versioned committed-head basis, config/revision/project binding, deterministic
full-structure and snapshot digests, body inspection explicitly not requested,
and separate upstream and returned/omitted/truncated output
accounting. The engine result is bounded to 64 KiB; diagnostic version 2 preserves
the command-only surface. Cold certification may validate bodies internally; no
body inspection/report is requested or returned. The final compact object and compact command notification are bounded
to 32 KiB including UTF-8 and JSON escaping. It omits bodies, frontmatter names and
descriptions, links, views, episodes, operations, budget ceilings, overall healthy,
source IDs, history/diffs and private root/profile/session paths. A prior projection
receipt remains separately labelled from current committed revision until the next
request (when its binding/config remains applicable). Public Pi estimates are not
provider consumption or category accounting. No model-callable action, persistent
registry, file export, HTML/HTTP, activation or Phase I is added. The invocation
and structure owners remain separate beneath the consolidated façade. R7-I/O/H
remain open; this prerequisite does
not establish installed/rendered longitudinal or human acceptance.

## R7-08 internal first-parent history prerequisite

The bounded first-parent history owner is a second ABI2-only diagnostic prerequisite.
Its internal route accepts only canonical offsets from 0 through 127 and uses
the existing idle-primary `agent_memory_manage` read authority. The dedicated
internal `knowledgeHistory` RPC binds the mapped project, expected current revision
and config hash, then reads the committed current ledger and walks only that HEAD's
first-parent chain. The retained window is at most 128 commits and pages are fixed
at eight rows; there is no caller-selected ref, commit, path, limit, search or sort.

Rows contain only commit OID, first parent or `null`, and canonical UTC commit time.
Author, subject, email, changed paths/counts, diff/body text and historical ledgers
are never collected for the reply. Any current forgotten source refuses the whole
request because historical source attribution is unavailable. Current path
forgetting cannot leak path-shaped metadata through this surface because no path or
change metadata exists. Replacement refs, grafts and shallow history refuse rather
than silently changing chain semantics.

The engine final-checks repository semantics, config hash, HEAD and committed ledger
digest; the runtime separately final-checks status, branch, idle/writer state,
generation, binding and current authority. Endpoint checks are sequential and do
not claim atomicity or ABA resistance. Output is compact JSON bounded to 32 KiB.
The 128-entry flag reports only that the bounded window was reached, not that older
history definitely exists. ABI1 refuses without fallback. There is no replay
registry, arbitrary Git browser, model-callable action, HTML/history route,
`local/**` authority, profile activation or Phase I wiring. This advances source
and disposable installed-command evidence only; R7-I/O/H, provider, rendered,
longitudinal and Mahiro acceptance remain open.

## R7-09 source-only immutable ABI2 metadata viewer

The immutable handoff is now exposed through `/mh-memory palace` and
`/mh-memory palace close`. The handoff stays outside the model-callable management
schema. Opening requires
TUI mode, an idle ABI2 primary and existing `agent_memory_manage` read authority.
One tracked operation captures current status, committed `palaceStructure`, the
exact offset-zero `knowledgeHistory` page, public context/effective-prompt metadata
and the applicable projection-owner receipt, then rechecks config, revision,
branch, writer/draft state, generation, binding and authority. Cross-component
revision/config/project identity must match. The combined association stays
`atomic: false`; there is no replay ID or persistent capture registry.

The closed DTO is allowlisted, deeply copied/frozen and at most 48 KiB. Static HTML
is at most 256 KiB. One runtime-owned viewer replaces any predecessor and expires
after ten minutes. Every exact capability GET/HEAD reauthorizes the owner and
rechecks captured revision/config, structure/snapshot digests, offset-zero history,
branch, idle state and authority. New data is never substituted into the frozen
page. Denial/drift, new work, compaction, writes/writer admission, navigation,
shutdown, replacement, explicit close and expiry revoke the viewer and close its
transport. One request gets at most 15 seconds to complete the full status,
structure, history, config, branch and authority revalidation. Timeout/close returns
the generic unavailable response, aborts the current validation and fences any late
result by generation; it does not claim that arbitrary third-party Promise work is
synchronously cancellable.

Focused source fixtures cover DTO identity/freezing/bounds and malformed/extra-field
refusal, escaping/semantic markup, exact Host/path/method/body/origin rules, security
headers, byte-identical GET/HEAD delivery, concurrent-validation refusal, bounded
transport close when validation ignores abort, authority revocation, new-work
closure and ABI1 refusal. This does not prove installed current-profile behavior,
browser rendering, provider-backed consumption, longitudinal reliability, same-user
bearer resistance or Mahiro visual/product/RAM acceptance. A narrow current-profile
probe found the earlier three-second request bound insufficient for real structure
and history validation; candidate source with the 15-second bound served the frozen
page in about seven seconds with the expected privacy headers, then explicit close
revoked the capability. A later owned-browser observation completes R7-I; this
paragraph's command/transport probe alone did not establish R7-O/H.

## R7-10 product command consolidation

Mahiro intentionally exposes one Palace product façade rather than each evidence
checkpoint as a separate feature:

- `/mh-memory palace` opens the immutable metadata viewer;
- `/mh-memory palace close` stops it;
- `/mh-memory palace json` returns the earlier structural JSON diagnostic.

Earlier checkpoint routes remain hidden compatibility aliases so existing source
and operator evidence keeps working. Public help and user documentation do not
advertise them. Runtime owners remain separate and
keep their independent bounds and final checks; consolidation does not make their
sequential observations atomic. It adds no browser opener, profile activation,
provider proof, authority expansion or R7-I/O/H credit by itself.

## R7-12 installed technical rendered observation

R7-I requires the installed command to capture its invoking session rather than
synthetic context and open only that session's authorized snapshot. At source commit
`7b673a65785597c4a42ebec3fa8d5a8c2271c683`, an explicitly authorized fresh Pi
invoked the current-profile façade while the original owner session remained selected.
The live ABI2 route consumes that command's `ExtensionContext`, samples public
invocation metadata and conditionally associates its owner projection receipt before
final binding/authority checks; it has no `local/**` or ambient synthetic-context
fallback. The command did not open a browser automatically. An
owned background browser then loaded the capability-scoped frozen handoff at a
1272×902 CSS-pixel viewport and at 200% browser zoom (636×451). At 200%, computed
shell and hero width was 604 CSS pixels, with the heading and lede contained inside
their content boxes.

Source/browser inspection observed one main landmark, sequential h1/h2 sections,
labelled native navigation links, captioned tables with scoped row and column
headers, named focusable overflow regions and a synthetic `:focus-visible` result
of a 3px solid accent outline with 3px offset. Declared solid text/background pairs
measured above their applicable WCAG AA thresholds. The page remained script-free
and remote-asset-free; known browser sessions closed, explicit Palace close revoked
the viewer, the temporary Pi exited and only its owned pane was removed.

An owned 400% session could not establish document stability, so this is not
320px/400%, real keyboard table-scrolling, accessibility-tree/screen-reader,
active-change/stale/shutdown, provider, longitudinal, resource/RAM or human visual
acceptance evidence. The roadmap's ten equal Palace outcomes credit this installed
journey for invoking-session context, committed structure, first-parent identity/time
history, immutable transport and explicit close/revocation: 50%. A matching current
projection receipt (outcome 2) and the four later outcomes (7–10) remain
unestablished. R7-I is boundedly complete; R7-O/H remain open. Unrounded evidence
moves to 38.875 while the displayed
75% source / 40% evidence bands remain unchanged.
