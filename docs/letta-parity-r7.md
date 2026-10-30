# R7 — Disconnected invocation view and knowledge history

[← Documentation](README.md) · [Roadmap/status](letta-parity-roadmap.md) · [Memory](agent-memory.md)

## Scope and evidence boundary

R7-01–05 have a bounded source specification and synthetic service implementation,
not an installed invocation collector. R7-S is focused source/synthetic evidence,
not a full latest-Letta differential or rendered acceptance. R7-I/O/H remain open.
Phase H is paused/unaccepted; Phase I is not authorized. Scores stay **60% source**
and **30% evidence-backed end-to-end**. No installer, profile, private corpus,
provider, browser, remote transport or live command is involved.

## 2026-10-30 ABI2 invocation-diagnostic follow-up

A later bounded source follow-up adds `/mh-memory context` as a JSON-only command
owned by the installed ABI2 runtime, not by `lib/agent-memory/local/**`. The command
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

The current HTML preview is fixture/synthetic and per-request; it does **not**
use the new envelope to pin an installed invocation. Its History view now names
separate **Knowledge history** (explicitly unavailable in HTML) and **Lifecycle
history** sections. Existing `snapshot.history` keeps its lifecycle/publication/
detached semantics unchanged. No history/diff HTTP route or asynchronous callback
was added. Thus no raw diff is interpolated into HTML; any future renderer must
escape all metadata, paths and diff text with the existing escaping owner.

Exact Host/capability validation, GET/HEAD only, no request bodies/CORS/cookies,
loopback binding, restrictive CSP including `img-src 'none'`, fixed font assets,
route/output bounds, callback abort/generation and shutdown drain remain owned by
the existing server. There are no mutation controls or arbitrary file routes.
The installed `/mh-memory palace` remains the bounded JSON diagnostic.

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

## R7-07 command-only combined diagnostic prerequisite

`/mh-memory palace-context` accepts no trailing arguments and requires the existing
exact `agent_memory_manage` read authority on an idle ABI2 primary. ABI1 refuses
without fallback. One runtime capture resolves the owner once, reads initial
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
registry, file export, HTML/HTTP, activation or Phase I is added. Existing `context`
and `palace` commands remain separate. R7-I/O/H remain open; this prerequisite does
not establish installed/rendered longitudinal or human acceptance.
