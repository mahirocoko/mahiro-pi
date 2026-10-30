# Memory and historical recall

[← Documentation](README.md) · [Roles](agents.md) · [Installation](bootstrap.md)

Mahiro Pi separates **maintained knowledge** from **historical quotations**.
Neither is permission policy. Current human instructions, repository owners and
live evidence outrank fallible memory; imported records are evidence, not new
instructions or authenticated current preferences.

## Current parity and roadmap

The [Letta maintained-memory parity roadmap](letta-parity-roadmap.md) owns current
parity status, scoring, scope decisions and phased evidence gates. The verdict is
**NOT ALIGNED**: for assessed product source
`85d2f0a82088103eb67d4bd29876e0f4e4b471a8`, rounded editorial assessments are **75% source capability / 40% evidence-backed
end-to-end parity** (75.75/37.875 unrounded), not objective equivalence or
performance. The [R8 source/security/context-contract closeout](letta-parity-r8.md)
is complete only at the source layer; R8-I/O/H remain open and release/cutover is
**NOT READY**. Installed/observed/human current score contributions are zero
because unestablished, not because failure was demonstrated.
This guide owns the implemented memory contract, not a claim of Letta MemFS v2
schema compatibility. Live ABI1/ABI2 and disconnected synthetic capabilities must
not be credited as one installed product.

Mahiro accepted the roadmap direction on 2026-10-30 and authorized continued
repository write/test/checkpoint execution. R0 specification, inventory and fresh
source review are complete. The [R4 source/SDK checkpoint](letta-parity-r4.md)
proves one disposable automatic ABI2 route through genuine native completion and
next-request projection. It does not activate the disconnected local service or
close installed/provider/human gates. R1–R7 dated 60%/30% unchanged-score
statements and the B1 `f46cade7e3c984981b5eeb55eb68a4a610b45ba2` checkpoint
remain history; R8 above is the current assessment. R0-00 candidate evidence does
not retroactively identify B0's earlier audited dirty tree. No target-controlled
gates ran for R8 because no qualifying OS sandbox is established; earlier test
records are references, not rerun proof.

Next gates are a disposable installed R4/R5 journey only after authorization,
installed R6 operator rehearsal after its own authorization (the fixed-synthetic
source operator is disconnected), R7 installed collector and
rendered review, then longitudinal evaluation and a separate release decision.
Phase H continuation and Phase I remain paused until their own gates pass.
Direction acceptance does not authorize push, tag, release, profile/install
mutation, private migration, live cutover or Phase I, nor replace later human-only
product/visual/RAM acceptance.

## Maintained knowledge

One private Markdown/Git repository owns published knowledge. Standard ABI2
installation binds `<profile>/memory` through its per-profile selection record.
The legacy path supports `MAHIRO_AGENT_MEMORY_ROOT` for a controlled store; it is
not the ordinary ABI2 selector and grants no authority. Configuration, drafts and
episode metadata stay private.
The standard installer initializes only an absent root with a generic editable starter;
it never imports a personal corpus or overwrites existing Core/data.
Live publication remains ABI1 or ABI2. The approved
[experimental local Git/worktree service](#experimental-local-gitworktree-service)
is a synthetic scaffold and is not the installed writer, live prompt, or Palace surface.

| Path | Purpose |
| --- | --- |
| `Core.md` | Concise identity, confirmed preferences and reusable methods |
| `index.md` | Navigation to selectively read detail |
| `system/persona.md` | Tiered v2 always-loaded agent identity |
| `system/human/<name>.md` | On-demand human context and `prefs/<name>.md`; protected retention |
| `projects/<project-id>/system/<name>.md` | Protected project context; only current-project `overview.md` and `conventions.md` are always loaded |
| `projects/<project-id>/reference/<name>.md` | Tiered v2 on-demand project reference detail |
| `reference/<name>.md` | Tiered v2 on-demand global reference detail |
| `archives/<slug>/<name>.md` | Historical provenance material (never projected into prompt) |
| `global/<name>.md` | Shared detailed knowledge (legacy compatible) |
| `deferred/<project-id>/<name>.md` | Project-owned detail (legacy compatible) |
| `procedures/<name>.md` | Reusable workflows (legacy compatible) |

The exact automatic set is committed `Core.md`, `index.md`, optional
`system/persona.md`, and optional current-project `system/overview.md` plus
`system/conventions.md`, read from one revision in a single batched Git object
read. Every other maintained-memory path is deferred or excluded; archives are
never automatic prompt content and skills remain separate. Authenticated primary
views can discover authorized deferred knowledge across canonical projects; native
workers and retained legacy views remain scoped. Unmapped projects derive
collision-checked path identities without rewriting the project map. Source
registration alone never migrates knowledge.

The [R1 schema contract](letta-parity-r1.md) records the bidirectional Letta
v0.34.31 job mapping, unsupported paths, precise committed/draft/integrated/
projected/active-prompt terms, discovery outcomes and differential fixture matrix.
It deliberately retains the Mahiro schema rather than claiming MemFS v2 path or
wire compatibility.

Legacy migration archives each `global/**` or `deferred/**` source before removing
it. An already-present archive path is reusable only when body hash, UTF-8 byte
size and ordered source IDs match exactly; otherwise migration fails with a legacy
archive collision. An existing tiered target remains authoritative while the
verified archive preserves the legacy body. No collision is merged silently.

## Customize the starter

A fresh Core starts as **Companion** with editable name, language, tone, detail
and specialties. It follows the user's language, defaults to concise evidence-backed
coding help and assumes no personal preferences or project facts. No Mahiro corpus
or personal persona is shipped. Existing Core/customization is never reseeded.

Read `Core.md` completely with `agent_memory_read`, edit the selected fields using
`agent_memory_edit` with the current whole-file hash, then publish with
`agent_memory_commit` against the current revision. Use these root-bound tools,
not generic filesystem writes. Style changes do not reset knowledge, alter policy,
select models or create a new store. Package-owned guidance retains procedural,
authority and curation fundamentals separately from editable persona.

## Curation guidance and bounded context diagnosis

R2 source decision (2026-10-30): use the existing package-owned
`memoryCurationDoctrine` in `lib/agent-memory/guidance.ts`, not new package skills.
The native adaptation preserves upstream core/deferred synthesis: shrink before
adding, replace weaker examples, keep one authoritative home per subject, and
write request-shaped index cues. Trace a natural future request from the advertised
indexes/selectors to deferred detail without knowing its path first. A valid path
alone is not proof of discoverability. Native source IDs, supersession evidence,
root-bound tools and retention rules remain required; upstream advice to omit
provenance or move procedures into skills grants no native mutation authority.
[Role dispositions](agents.md#memory-guidance-and-selective-skill-admission) own
the six-job assignment; the [roadmap](letta-parity-roadmap.md#r2--selective-memory-skill-admission-and-guidance-quality)
owns review and delivery gates.

For a request to diagnose memory/context behavior, use this bounded procedure:

1. Name one reported behavior, one expected outcome and the relevant request or
   revision. Inspect only the authorized source/metadata/read surfaces needed to
   test that claim; do not dump the corpus or transcripts.
2. Separate **stored** knowledge, **retrieved** read results, **projected** prompt
   input, **requested** actions and **executed** outcomes. A stored fact does not
   prove retrieval, projection does not prove use, and a request is not execution.
3. Separate structural checks (paths, indexes, budgets, available tools, revision
   envelopes) from causal diagnosis of behavior. Today's state is not proof of a
   historical prompt. Record observations, inferences and missing evidence apart.
4. Compare a successful control request at the same relevant boundary, when
   existing authorized evidence permits it. If either the historical input or a
   meaningful control is missing, return **inconclusive**, not a guessed cause.
5. Return **healthy**, a supported defect, or **inconclusive**. **No-edit** is valid
   for healthy/inconclusive cases and when no proportional authorized repair is
   supported. A defect report does not itself authorize a repair. Recheck the same
   narrow defect and control after an explicitly scoped repair.
6. Do not replay live/provider requests or run paid evaluations by default. This
   procedure grants no profile, permission, model, skill or installed-role mutation
   authority. An unavailable tool is a reported limit, not permission to bypass it.

Source fixtures for R2-04: repeated corrections refine one reasoned principle
instead of adding incident logs; a stronger example replaces a weaker one;
a later "rollback" request must discover deferred deployment detail without its
path. Refuse unavailable-tool bypass and automatic skill/profile changes. A
missing historical projection yields inconclusive/no-edit even when current
storage is healthy; a successful control is evidence, not permission for live
replay. `test/agent-memory-starter.test.ts` guards the shared doctrine text against
these specific omissions; it does not execute a model, prove future retrieval or
establish installed/human outcomes. Those remain R2-S/I/O/H gates.

## Read and discover

`agent_memory_read` has mutually exclusive modes:

| Input | Result |
| --- | --- |
| `{}` | Legacy authorized file list |
| `{path, offset?, limit?}` | Original Unicode code-point paging (limit 1–4096) or tiered directory-entry paging (at most 32 entries per page) for `system`, `system/human`, `reference`, `projects/<id>/system`, and `projects/<id>/reference` |
| `{topic: "", offset?, limit?}` | Namespace/count discovery, limit 1–32 |
| `{topic: "*", offset?, limit?}` | All authorized files with YAML frontmatter `name`/`description` and `[[wiki-links]]`, limit 1–32 |
| `{topic: "global"}`, `"procedures"`, `"deferred/<id>"`, `"system"`, `"reference"` | A selected namespace |
| `{query, offset?, limit?}` | Lexical AND search, limit 1–8 results |

Queries are bounded to 256 UTF-8 bytes and 16 distinct word terms. English/Thai
segmentation and normalization are for matching only; returned snippets and
offsets refer to original text. Paths participate in matching. Results use sorted
path order, not semantic relevance ranking.

Search scans at most 1 MiB per page and returns at most 32 KiB, including revision
metadata. `nextOffset` and incomplete status mean more coverage remains; follow
the cursor. The projection's first eight topic entries are not an exhaustive
catalog. A successful no-match means exhaustion of that scan suffix, not all
unread pages. There are no embeddings, regex queries or persistent search index.

Path/query results include whole-file hashes and source IDs. `basis`,
`baseRevision`, `currentRevision` and `freshness` distinguish a private draft
or stale snapshot from committed truth. Read every path page before replacement.
Do not silently reset a draft to search newer state. Current forgetting,
revocation or a revision race makes an old view **unavailable**, not successfully
empty; proposals remain available for guarded recovery. Use only selectors the
loaded runtime actually advertises.

## Edit, commit and recover

1. Read Core/index and relevant detail through the authenticated view.
2. `agent_memory_edit` adds/replaces/removes or surgically patches/appends a scoped file in a private draft.
   Supply its exact whole-file `expectedHash` (`null` for a new file), text and
   relevant observed episode source IDs. Optional `mode: "replace" | "patch" | "append"`
   supports surgical edits (`oldText`/`newText` for `patch`, optional `section` heading for `append`).
   `text: null` removes a detail/procedure file; Core/index cannot be removed.
3. `agent_memory_commit` integrates against the base revision. A Lossless Retention Guard
   rejects commits that remove protected files (`Core.md`, `system/persona.md`, `system/human/**`,
   `projects/<id>/system/**`), drop a Markdown heading in a protected file, or shrink a
   protected file of at least 160 JS characters by more than 20% (`reason: retention`), except
   that a small `Core.md` with fewer than two Markdown headings and under 160 JS characters is
   exempt from the heading-drop and shrink check so starter bootstrap/customization can be
   replaced. The guard also exempts commits that grow any `reference/**`,
   `projects/<id>/reference/**` or `archives/**` file in the same commit (`after.length > before.length`
   in JS characters) or pass `allowShrink: true` explicitly. That same-commit growth bypass is a
   mechanical length check, not semantic verification that the superseded belief and reason are
   preserved in the reference or archive file; cooperative supersession tests demonstrate the
   intended workflow rather than semantic enforcement. Disjoint file
   edits merge; overlapping changes remain private conflicts, not semantic
   auto-merges. Git HEAD is the publication boundary.
4. Active primary context refreshes on the next request, not retroactively in an
   already running request. During context compaction (`session_before_compact` / `session_compact`),
   a bounded, unverified continuity checkpoint is preserved for the next turn. This
   one-shot prompt context is separate from the metadata-only review records below.

`agent_memory_manage` provides primary-only status/cancel, engine-specific `doctor` diagnostics (ABI2 budget/missing-description/unmigrated-path/conflict state; legacy ABI1 additionally reports Git-entry and broken-link findings), `palace` read-only structural/link/view/episode inspection (inspecting frontmatter and `[[wiki-links]]` across all non-archive active files, ordering non-archive file metadata ahead of `archives/**` within a bounded reply, and reporting `coverage` so `healthy` is never asserted over uninspected content), `init-project` and `migrate-v2` tiered v2 transitions, `remember` surgical note appending, explicit new-root initialization, revision-guarded forgetting/rollback/discard and bounded conflict inspection. The command façade is separate from that model-callable action: `/mh-memory palace` opens the immutable ABI2 metadata viewer, `/mh-memory palace close` stops it and `/mh-memory palace json` returns the bounded structural report. The experimental local preview remains a separate synthetic page and does not own this command. A hidden compatibility diagnostic reports current committed revision/config identity, bounded public Pi context estimates, effective-system-prompt byte size and the last ABI2 projection-owner output receipt; it never returns prompt/memory text, root/session paths, exact provider consumption or fabricated category accounting. A projection receipt proves owner output only. Legacy migration keeps byte-exact originals under segmented `archives/legacy-v1-<revision>/global/` and `archives/legacy-v1-<revision>/deferred/<project>/` paths before replacing v1 locations. Missing or malformed frontmatter gets deterministic safe metadata without rewriting archived bytes. Repeated migration or project initialization at the same state is a true no-op: it returns the current revision without preparing a publication or retaining a new view. Public help exposes `status`, `help`, `doctor`, `palace [close|json]`, `init`, `remember <text>` and `dream`; earlier context/history/HTML checkpoint commands remain hidden aliases. Conflict lists page up to eight retained views; proposal text pages by original code points. Read all pages before recovery; `proposalHash` describes the complete proposal. Resolve through current hash/revision tools, then discard the selected view explicitly. Never copy a proposal over newer knowledge blindly.

Discovery is path/index-driven: committed `Core.md` and `index.md` remain loaded alongside
`system/persona.md` and only the current project's `system/overview.md` and
`system/conventions.md`. Other human/project details are read on demand, not injected automatically.
Palace exhaustively counts broken wiki links, with `criticalBrokenLinksTotal` for those discovery
surfaces and `advisoryBrokenLinksTotal` for all other non-archive files. `healthy` requires complete
inspection, total bytes within budget, and zero critical broken links; advisory detail links do not
block health. Archives are retained evidence, not inspected or authoritative discovery surfaces.
The diagnostic list remains bounded; totals cover every inspected link, even outside the sample.

Palace presentation is capped at 240 KiB for the complete encoded JSON reply, including
escaped/multibyte metadata and the `palace` wrapper, leaving room for the engine transport
envelope. Paths are never shortened. `layers` indexes exactly the returned `files`, not the
entire active corpus; `coverage.layersTruncated` equals `coverage.filesTruncated`. Presentation
truncation does not stop inspection of any non-archive active file: coverage counts and broken-link
totals still describe the full inspection, while `brokenLinksTruncated` identifies a bounded sample.
`healthy` requires complete inspection, zero critical broken links and total usage within the configured ceiling.

Forgetting is logical filtering, **not secure Git/history erasure**. Revise
Core/index to remove the forgotten knowledge/source link while preserving identity
before source-forgetting. Source-linked global/deferred/procedure files may be
removed conservatively as whole files. Rollback and conflicts still honor current
forgetting; retained views are not a way to resurrect forgotten material.

`agent_memory_manage {action: "migration-export", revision, section, offset, limit}`
is a primary read of the current committed revision on both ABI1 and ABI2. `section`
is `binding`, `sources`, `forgotten-paths`, `forgotten-sources` or `reviewed`.
Each page has at most 32 entries and repeats the committed revision, config hash
and whole ledger digest. `total` and `nextOffset` describe that section. A revision
that is no longer current fails stale. The page carries active source IDs, each
active file's committed SHA-256 content hash (the same whole-file hash as
`agent_memory_read`), forgotten paths, forgotten sources and reviewed IDs. It does
not carry file text, credentials, root paths, draft or conflict bodies, or any other
private corpus. Hashing reads that commit only and does not require a healthy
mutation journal. `/mh-memory` does not call it, and loading this source does not
apply, reload or migrate a live root. This is metadata-only export, not content
capture or backup. The [R6 operator contract](letta-parity-r6.md) inventories current
user jobs and explicitly unavailable backup/restore, active migration, authority
cutover and conversation replay workflows. R7 now has a disconnected synthetic
knowledge-history/diff service API, but user/operator/HTML history remains
unavailable. The standalone fixed-synthetic rehearsal described below is not a
live parity CLI or active migration API.

## Compaction provenance and compatibility

With existing automatic reflection enabled, successful compaction can admit an
`observed-native-unverified` episode with `kind: "compaction"` to the existing
bounded review queue. Its closed `compaction` object contains only `entryId`,
`parentId`, `firstKeptEntryId`, `tokensBefore`, `reason` (`manual`, `threshold` or
`overflow`), `fromExtension` and `willRetry`, plus the ordinary episode identity,
project, session, native timestamp (`observedAt`) and a metadata-only `entryHash`.
It has **no** input, actions, results, outcome, summary, tool arguments, details,
usage or system prompt. Native lifecycle evidence is not authority or authenticated
human intent. A native event alone cannot admit data: current primary identity,
root/generation, branch, exact-root permission and automatic policy must pass.

Both ABI1 and ABI2 readers, including ABI2 engine replies, accept legacy turn
records and this new variant together. Legacy files are not migrated, rewritten,
relabelled or backfilled. The ID remains
`sha256(sessionId + ':compact:' + compactionEntry.id)`, including for legacy
summary-shaped records: existing tombstones still suppress that ID, and differing
bytes at the same ID are rejected, never overwritten. A later replay of identical
metadata is accepted without rewriting; a concurrent replay may fail closed during
publication. Older parsers cannot read the new shape; **downgrading or running old
and new writers against one root is unsupported** once such records exist. There
is no automatic downgrade/schema migration or destructive cleanup procedure.

Compaction does **not** launch a writer or retry/backfill a failed admission. A
one-use before/after boundary pairs the event with a unique newly appended branch
leaf; an ambiguous, interrupted or unpaired observation is dropped. This also
handles a host event that reports an older compaction (including on a sibling branch)
with the same summary: the report must match an entry in the same session manager,
while only the anchored new active-branch leaf supplies persisted metadata. The
summary comparison is transient; no summary is persisted. ABI2 allows only one tracked compaction admission per
runtime at a time; overlapping notifications are dropped rather than queued.
Retirement drains admitted work while fencing stale continuations. Policy/permission/branch checks before publication
narrow the race window; revocation cannot roll back a filesystem write already
started. A rejected completion is not proof that no file was published.

The existing 256-file capacity is shared by turn and compaction records across
projects, not a new compaction allowance. Existing reviewed/forgotten cleanup rules
are unchanged. Both kinds compete for the same oldest-four selection (timestamp,
then ID) within a project, so metadata-only records can delay turn review and consume
capacity until reviewed. A later ordinary reflection or explicit authorized reflection
may review them with no knowledge changes. `automatic: false` disables new compaction
admission, not retained-file reading, and does not trigger a writer when re-enabled.

Updated writers publish complete private bytes using exclusive no-replace creation;
concurrent same-ID collisions cannot replace the winner. During the brief temporary
hard-link window a reader may fail closed; interruption or denied cleanup may leave a
temporary file or a final file with multiple links. An unreviewed multiple-link final
file can block shared queue selection across projects even after authority returns;
different-ID admissions below capacity may still succeed. There is no automatic
recovery or lock to steal. Queue capacity checks and cleanup are **not** a root-wide
transaction across independent controllers: simultaneous different-ID admissions can
race the 256 check. The reader then rejects an over-capacity backlog. This change does
not claim cross-controller capacity, forgetting or policy transactions; it introduces
no new global lock, retention policy or permission grant.

## Native writing and automatic reflection

Five tools share this owner: read, edit, commit, manage and
`agent_memory_reflect`. Reflect accepts a bounded assignment, not a caller-selected
role, root, lease or model. It uses the same locked
[managed-memory-writer](agents.md) as configured automatic reflection.

The separate exact-root `managed_memory_<sha256(canonical-root)>` capability
is mandatory. C1/read grants do not authorize writes. The public native service
binds the child's exact identity and output to a leased private view. The writer
gets only read/edit/commit and public per-run prompt replacement, never inherited
primary private corpus, shell tools or a cwd override. The installed template is
validated byte-for-byte except its explicit model/thinking slots. The public loaded
role descriptor exposes routing/lock/tools/prompt mode/inheritance/background, not
body or max-turn fields: the runtime checks the exposed fields, replaces the worker
prompt from canonical installed source, and passes an explicit eight-turn native
budget plus a 120-second lease deadline. A project body/budget override does not
replace those runtime controls. Its commit marks the view ready; a healthy parent
integrates only after successful native completion.

Automatic writing depends on private `automatic` policy and bounded eligible,
settled interactive/RPC observed episodes, not every turn. Standard installation
selects true for a new starter root and preserves existing policy; startup never enables it. Observations omit reasoning,
tool arguments, arbitrary read/recall payloads and imported transcripts. A native
user entry is not authenticated human identity. Failed or cancelled attempts do
not establish successful learning or integration.

Curation should refine an existing subject and its reason, not append incident
logs. Preserve useful provenance, current owners and uncertainty. An ambiguous
one-off is not an enduring preference. Structural screening and prompt delivery
do not prove factual truth, complete secret detection or provider compliance.

## Readiness and lifecycle

`/mh-memory status` diagnoses local prerequisites without reading denied corpus
content. `/mh-memory help` explains setup and lifecycle. Status merges authorized
`agent_memory_manage {action: "status"}` storage results when permitted:

- **Ready**: local Root/native writer/route/authority prerequisites satisfied.
- **Needs setup**: engine off, missing resources or unavailable exact writer route.
- **Denied**: required memory authority is denied or awaiting explicit permission.

Readiness is independent of automatic on/off. An installed manual memory can
remain usable with reflection denied. Unknown storage, automatic or attempt state
is reported as unknown, not a successful empty/idle result. Status does not resolve
credentials or prove provider execution.

Memory tool errors and `/mh-memory` failures use source-owned, closed diagnostic
reasons: `capacity`, `deadline`, `branch`, `CAS`, `retention` or `unknown`.
Unrecognized failures use fixed `unknown` text; exception messages and caller-supplied
tags do not determine a reason. Read invalidation keeps its distinct current-forgetting
or revision-race message in both ABIs, without returning partial content or discarding
the proposal. Child error replies carry only correlated closed metadata, never private
paths, headings or subprocess output. Publication/reconciliation receipts withhold
arbitrary detail prose while preserving stage, revision, dirty and lock facts.
A diagnostic is not authority, successful publication, completed drain or permission
to retry, restart or reclaim retained data.

A private draft is not published knowledge. A native worker's commit marks its
view ready; only a healthy parent can publish after successful native completion
and current authority checks. Projection activates on the next primary request.
Failed/cancelled/retired attempts and conflicts are not successful integration.
`latestAttempt` reflects newly observed native metadata, not historical private
attempt inspection or proof of semantic learning.

ABI2 tree navigation invalidates the pre-tree memory epoch before the leaf can
change, cancels its writer and joins actual native-worker/engine continuations.
Completed `session_tree` navigation rebinds the same healthy primary owner with a
fresh, lazily created data controller. A current-leaf no-op dispatches no tree
hooks and does not retire memory. Drafts and pending observations from the old
epoch are not resumed or automatically published.

Cancelled navigation emits no `session_tree`. Memory therefore remains retired
until an **idle** input or direct memory-tool admission can verify the unchanged
manager, session, kernel node, ABI, generation and exact root after real drain.
A subsequent SDK tree navigation may carry forward only an already-drained ticket
whose exact binding is still valid; it does not reactivate memory before the leaf
changes. Current permissions are still required for every operation. Shutdown,
switch, fork, overlapping admitted transitions or changed binding invalidate a
pending rebind; failed or ambiguous reactivation stays unavailable, not
successfully empty. The public SDK itself rejects concurrent tree navigation
before dispatching a second tree event.

A first custom `triggerTurn` request after cancellation, with no intervening idle
input/read, is a deliberate limitation: `before_agent_start` is already busy and
cannot distinguish a completed cancellation from navigation still in flight.
That request receives **no managed-memory projection**, and busy memory calls
remain unavailable. A subsequent ordinary idle input/read can recover the valid
owner. This is not a promise of projection for every custom-trigger request or a
navigation sandbox for concurrently misused embedder operations.

ABI2 supports explicit automatic admission control through
`agent_memory_manage {action: "policy", revision, configHash, automatic: false}`
(or `true`), using the current status revision/configHash. It changes only the
existing automatic policy, not permissions, engine selection, writer route or
persona. Stale revision/configHash fails CAS. Off is preserved on upgrade and does
not revoke manual authority. An explicit policy action cancels pending/current
writer admission; it does not publish or reset retained drafts. Read the recovery
limits below before using the action.

### Policy interruption limit

Cancellation, retirement or permission loss can retain the exact policy lock,
`.lock/policy.json` typed evidence and possibly `.lock/config.next`. **Abort does
not mean unchanged:** a config rename may already have completed. Authorized
status adds `policyOperation`, separate from publication/worker readiness:

- `idle`: no lock was observed.
- `active/draining`: the actual process-local executor or a recovery continuation
  is still active. Wait for actual drain, then read status again; cancellation or
  an ID is not proof of quiescence.
- `retained+recoverable`: the typed identity, actual drained executor reference,
  exact owned lock/staging, expected HEAD and original/intended config state match.
  Status includes bounded `target`, `digest`, `expectedRevision`, observed
  `automatic`, `configHash`, `outcome` (`original`/`intended`) and a supported next step.
- `unknown/unavailable`: missing/corrupt/incomplete evidence, changed state or
  ownership, or no actual executor reference. Retain evidence for explicit owner
  review; never treat this as idle or use PID/session/dead-parent recovery.

After `retained+recoverable`, a **fresh explicit primary** call may use:

```json
{"action":"policy-reconcile","target":"<status.policyOperation.target>","revision":"<status.policyOperation.digest>"}
```

Here `revision` carries the policy SHA-256 digest, not a Git revision. Arguments
locate the operation; they grant no authority. Normal current Root/PSS authority,
exact physical targets, current-call branch stability, expected HEAD and either
original or intended config are rechecked. Recovery verifies lock owner identity
before any staging deletion and removes only verified owned staging/evidence and
that exact lock. It **never renames/reapplies/reverts config**, resumes an old
request, publishes corpus/Git or changes Core/persona/history. Read status again
afterward; observed config remains as-is and activates on the next primary request.
Publication `reconcile` remains a separate unchanged API.

Revocation permits no cleanup. Restored authority can recover only while the actual
same-process drained executor reference survives; a native singleton retains it
across supported source/runtime generations. A process restart or incomplete
acquisition/cleanup can leave unknown retained evidence without a supported tool
repair. Durable records are diagnostic, never drain authority. The registry is
bounded to 64 unresolved policy attempts per root and never evicts uncertain
owners to admit another attempt. No universal crash repair, lock stealing,
automatic replay or cancellation-safe multi-file atomic cleanup is claimed.

## Storage limits and failures

Private directories/files use 0700/0600. Symlinks, hardlinks, escaping paths,
unsafe Git metadata, malformed state and secret-pattern violations reject.
Fixed-argv Git retains existing identity/hooks; it never changes Git config or
bypasses hooks. Dirty/staged tracked work and colliding untracked files block
integration. Hook failures preserve proposals and leave committed context unchanged.

Default byte budgets: Core 8192, index 2048, each detail/procedure 8192 and all
knowledge 65536. Reviewed private configuration can raise these to 32768, 8192,
262144 and 8388608 respectively. Other bounds include 1,024 final maintained files,
2,049 operation changes, 2,048 persisted overlay entries, 128 project mappings,
32 source links/file, 64 views, 256 episodes, a 512-KiB ledger, an 8-MiB durable
operation record and a fixed 40-MiB serialized view ceiling. Final corpus, delta
and overlay limits are independent so a valid transition between two maximum-sized
snapshots can represent deletions and writes without raising the final-file bound.

Capacity requires maintenance; unreviewed episodes and conflict proposals are not
silently evicted to make space. Unsafe/corrupt/revoked data is unavailable, not an
empty store to reseed. These are cooperative local protections, not isolation
from hostile same-user code, unlimited retention or an OS sandbox.

## Ordinary memory engine

Standard explicit installation selects ABI2 through the per-profile private
`.mahiro-memory-engine.json` record, separate from the closed store configuration.
The record has exactly `version: 2`, `root: <profile>/memory` and `mode: "engine"`.
Explicit `off`/`legacy` survive upgrades; an absent record retains ABI1 compatibility.
Invalid selection fails closed, not to a fallback. Standard installation refuses
an absent root selected off/legacy before writes. Source loading alone does not
select the engine, migrate a corpus or grant authority. Fresh loading is required.
The canonical Root, public PSS, exact-root DATA capability, native manager,
output binding and current execution/publication barriers remain authoritative.
Synthetic tests are not installed or human acceptance.

ABI2 runs bounded data work in an owned Node child. Model workers remain
in-process native Pi workers; the data child is not an OS sandbox. Only the parent
starts fixed canonical filesystem/Git publication actions, immediately after current authority
checks. The child cannot publish, initialize canonical files, select argv or
receive a reusable publish grant. Initializing an absent root uses a
parent-exclusive create and durable intent; interrupted existing roots are
unavailable, never automatically repaired or reseeded. Normal Git identity and
hooks remain in effect. Already-started mutating Git/hooks drain on retirement;
retirement is not permission to finish journals or remove uncertain locks.

The shared management schema additionally advertises **ABI2-only**
`{action: "reconcile", target: "<operation UUID>", revision: "<plan SHA-256 digest>"}`.
ABI1 refuses this action and does not start ABI2. A fresh
primary owner can inspect/reconcile only that persisted operation: exact HEAD
ancestry/tree/ledger and index/worktree matter, not command exit or a stored stage.
Recovered plans never gain publish, chunk or resume capability. Unknown outcomes
retain evidence and block new mutation; no commit replay, lock stealing or
uncertain eviction is provided. A same-process executor drain reference, not a
PID or parent death, is required to establish quiescence. Observing the expected
commit alone does not authorize removal of its exact lock. Revocation/crash during
an operation-record CAS update can also retain its private `.cas` directory;
subsequent reconciliation refuses that collision rather than stealing it, even
when the expected commit is observable. There is no automatic CAS repair or
universal crash-recovery claim. Authorized committed reads and projection remain
HEAD-only while uncertain worktree/index, operation locks or orphan CAS entries
block mutation admission. A fresh primary read does not create a draft or obtain
a publication capability; an existing private draft retains its explicit snapshot
semantics and never reads partially published worktree bytes.

Ordinary read-only engine requests (`projection`, `config`, `status`, `episodes`,
`conflicts`, `read`, `headRead`, `stats`, and `manage` with `doctor` or `palace`)
are completion-driven and caller-cancellable, without a fixed whole-request
30-second deadline. Explicit `offlineCertify` remains completion-driven too.
All other engine methods retain their 30-second deadline, including mutation and
publication helpers (`chunk` and `fence` included). Cancellation of an active
request still waits for the child to drain; it does not restart/replay the channel
or prove quiescence immediately. A slow read can therefore delay queued work.
Current authority, revision/branch fencing, resource/transport limits and per-Git
bounds remain in effect. This changes no stored data, capacity, publication rule,
permission or native writer's separate 120-second lease.

Engine status reports only newly observed native attempt metadata.
`latestAttempt` is null when absent or invalidated; unknown progress and
unobserved tool ends remain null. It does not inspect historical private attempts,
prove provider execution or establish successful semantic learning.

Disposable fixtures cover representative abrupt parent exits before canonical
start, after staging and after HEAD observation; late-journal authority loss,
parent-directory fsync failure, and genuine running native-child retirement with
an overlapping replacement generation. These are finite source/SDK fault cases,
not arbitrary OS/hardware crash guarantees or orphan-lock repair. Final aggregate
checks, independent QA and responsiveness/I/O measurements are separate gates. Facade blob counters do not prove zero unchanged
OS/Git body reads: index refresh and ordinary hooks may read worktree content.
No installed activation, latency/RAM improvement, rendered quality, full Letta
parity or learning acceptance follows from these source contracts.

## Explicit offline maintenance recovery

This separate ABI2 owner operation handles one exact interrupted publication: a
typed `unknown` operation with its retained lock or a terminal
`not_committed_dirty` operation whose lock has already been released. The Git index
must remain clean. Every worktree mutation, deletion and staging path must bind to
the selected operation's immutable plan, expected hash and size; unrelated dirty
paths refuse recovery. Ordinary publication, policy and same-process reconciliation
retain their existing rules. Recovery never replays the commit or claims executor
drain. Its durable disposition records either **“manually adopted; prior outcome
unknown”** or **“manually recovered; not committed dirty”** without fabricating a
committed outcome.

Use the explicit [offline operator CLI](bootstrap.md#offline-memory-operator), not
an ordinary persistent Main/model session. Root requires a genuine bound native
primary with no UI and no session file, current generation, canonical management
tool provenance, and existing exact winning-surface `agent_memory_manage` plus
`managed_memory_<sha256(root)>` authority. Wildcard/yolo alone, children and denied
physical paths cannot authorize it. Loading or calling it grants nothing. The CLI
uses public SDK `SessionManager.inMemory`, empty in-memory credentials and Faux
transport with external fetch forbidden; it changes no profile, route, role,
auth, model, permission, session or Git identity/hook settings.

The operator must explicitly assure that known sessions for this profile are
closed and no cooperative external writers will start during the window.
`--offline` records that assurance, **not proof**. A fixed public system `lsof`
is an additional optional maintenance prerequisite: `/usr/sbin/lsof` on macOS,
`/usr/bin/lsof` on Linux. Bounded kernel Root-tree FD/cwd inspection includes
`.git` and detached holders even when their launcher is gone or their cwd moved
elsewhere. Unexpected holders, warnings, unsupported systems, incomplete output
or changing inventory stop the operation; it never kills holders. Only its actual
operator process and actual data-controller child are exempt, not caller PID
lists. This is cooperative offline maintenance, not a hostile same-user OS sandbox
or a new way to infer lost executor drain.

Read-only `offline-inspect` returns bounded fingerprints, full HEAD, typed owner
identity, operation immutable hash/sequence, artifact paths and active journal,
draft, legacy-view, staging and uncertain-admission counts; never corpus, raw
configuration or proposal bodies. Apply requires that exact reviewed target and
fingerprint. All Root file bytes (including raw Git index/config, Core/index,
ledger, drafts/blobs, journals/CAS, ignored/untracked files and complete Git
objects/refs/reflogs) participate, not merely porcelain/status. Capacity is not GC:
64 remaining journal entries or 64 active draft-directory entries block recovery.
Pending views are never evicted to pass an admission limit. Operation journals use
the same 8-MiB record bound as the online engine and ledger reads use the configured
512-KiB ledger limit.

Before any restoration or quarantine, the owner durably creates and independently
verifies a streamed, copied (not hardlinked) **full private byte archive** under
`<root>/.views/.maintenance/<transaction>/snapshot`. Only that transaction's own
workspace and coordination marker are excluded from recursion; existing archives
are included. Fixed ceilings are 131,072 inventory entries, 8 GiB total, 256 MiB
per file and 64 MiB for the private recovery plan. Links, special files,
external/incomplete Git object storage, resource failure, revocation or changed
source bytes refuse. It rechecks the full source fingerprint and kernel holders
after archive verification and before mutation. No sibling-directory grant,
`git archive` or private corpus stdout is used.

The durable `<root>/.views/.maintenance-active.json` marker blocks new ordinary
memory writes/admissions at Root, including installation after `.lock` moves.
Authorized status, committed reads and projection remain possible. Only the
validated ephemeral maintenance owner bypasses that coordination barrier, not
PSS or current-generation/branch checks. Exact reviewed lock, journal/CAS and operation staging are moved into the private
workspace's inert `quarantine`, outside active namespaces. Tracked operation paths
are restored from HEAD; only untracked writes introduced by the exact plan are
removed. Every reviewed tracked path is revalidated, set to private mode and
fsynced on each recovery or resume, including paths Git already reports clean.
This closes interruptions between content restoration and permission repair.
Original interrupted bytes remain in the verified archive. A ready proposal stays
private and its active manifest becomes `conflict` for ordinary explicit
recertified recovery; no proposal or memory HEAD is activated.

The owner verifies archive/quarantine completeness, unchanged canonical bytes,
HEAD and raw index/config, clean active Git state, remaining typed terminal
journals/capacity, and cold committed certification through the existing data
engine. That dedicated offline certification remains cancellable and
revision/permission fenced and completion-driven, like the ordinary read-only
engine methods; mutation/publication engine methods retain their 30-second deadline. The explicit operator also has
no fixed wall-clock kill: resource ceilings, per-Git and holder-inspection bounds,
process/output bounds and operator cancellation remain, while a valid large
archive is allowed to finish naturally. It persists `completed` before releasing
the marker. The operator returns that validated maintenance receipt directly; it
does not add a post-operation ordinary status/projection request that could turn
a completed mutation into an ambiguous timeout. Loaded-runtime verification is a
separate gate. A crash, unknown checkpoint or permission loss retains evidence and
the barrier. Inspect again,
review the new checkpoint fingerprint, then explicitly `offline-resume`; there is
no automatic replay or rollback. Incomplete/malformed checkpoints that cannot be
verified stay blocked for owner review. Maintenance never deletes archives
automatically; any later owner-authorized snapshot cleanup is a separate destructive
operation after HEAD, Git cleanliness and doctor health are reverified. Receipts
are source-operation evidence, not semantic recovery, installed activation or
human acceptance.

## Experimental local Git/worktree service

Live publication remains the ABI1 and ABI2 behavior documented above. Installation
still selects ABI2 only through the private per-profile record, and an absent
record still retains ABI1. This section describes an approved experimental
replacement scaffold. It is not the live writer, live prompt, doctor,
Palace command, or installer path.

`createSyntheticLocalMemoryService` in `lib/agent-memory/local/service.ts` is a
single in-process coordinator. It creates its own bare repository at
`stateRoot/canonical.git` and may reopen only that repository when its identity
manifest matches. It does not adopt an arbitrary pre-existing Git repository.
Worker worktrees are linked to that bare repository. There is no parent checkout
and no `read-tree` reset. `initialFiles` seeds `main` only while the service is
creating that repository. An open that finds that bare repository and its identity
manifest, but not a seeded `refs/heads/main`, fails closed. The service does not
reseed it. Restoring that repository is an explicit repair by its owner. A
private-root import is a separate authorized step
and is not implemented here.

The trust boundary is a cooperative current-version service process. Every
startup, recovery-bearing read, mutation, callback, publication, cleanup and
migration operation first creates one exclusive sibling
`<stateRoot>.operation-claim`. It binds a random operation token to the root's
device/inode and existing version-1 service nonce. Another current-version
process refuses before reconciliation or mutation. Existing, partial, malformed
or dead-owner claims are never stolen by PID, age or parent death. Only the exact
holder removes the claim; root/meta replacement, forced Git interruption or a
failed release leaves it blocking. Different roots remain independent. A crash
can therefore make a synthetic root unavailable until a separately reviewed
recovery mechanism exists.

Another same-user process that ignores the protocol or edits `canonical.git`,
service state, claim or worktree metadata remains outside the product contract.
This is not mixed-version or hostile same-user protection. Transcript text and
worker file writes stay untrusted: paths are checked with `lstat` and
`O_NOFOLLOW`, Git commands use a fixed argument list and bounded output, and
publication is the bare `refs/heads/main` ref. Refusing a symlink or hard link
that is already present is not protection against an ancestor directory being
swapped during the write. Public Node has no `openat`, so that race is outside
this contract. A pending commit is published only when its parent count and tree
match the worker commit and expected parent. Durable job records still support
restart only after the root has no retained claim; no automatic stale-claim
recovery is provided.

Synthetic Phase C adds a trajectory owner and a deterministic maintenance
worker on that coordinator. The harness passes an explicit public-session entry
array. The service does not read Pi session files, private memory, transcripts,
reasoning, credentials, `.agent-state`, or a live profile. Each entry carries a
session id, branch id, ordered entry id, role (`user`, `assistant`, or `tool`),
bounded text, and timestamp. One contiguous review range starts after that
branch's watermark. The immutable snapshot, digest, and job kind (`ordinary` or
`reflection`) are stored on the job record itself. Duplicate ids, non-monotonic
order, and a branch or session mismatch are refused. Text past the entry bound
is truncated explicitly. The first entry that does not fit the range budget, and
every entry after it, stays deferred. The watermark never advances past omitted
text. A compaction boundary does not drop an unreviewed pre-compaction prefix.
Forks keep separate watermarks. Settlement of one branch does not gate committed
reads or ordinary jobs.

`off`, `compaction`, and `step-count` are synthetic constructor config. They do
not change installer defaults or the live reflection policy. The branch
watermark advances only after the matching maintenance job is `integrated` or a
verified `noop`. A failed reflection job can be retried explicitly with the same
snapshot. `repair-needed` keeps that snapshot; resume/retry cannot resolve it.
[R5 recovery](letta-parity-r5.md) adds explicit synthetic `repair`/`abandon`
methods with terminal `repaired`/`abandoned` records, retained conflict evidence
and **no watermark advancement**, including successful repair. A fresh eligible
reflection can review the released range from the unchanged watermark only with
captured-range coverage. A no-op advances once. Restart reads the stored snapshot
and digest; it does not duplicate a still-held attempt.

The deterministic worker receives the bounded range as untrusted data and a
worktree adapter for read, list, search, write, edit, delete, and rename. It
has no shell, Git handle, network, credentials, absolute path or claim token.
Ordinary workers receive only the job id and the same fenced write operation;
the production callback no longer receives a raw worktree path. Every adapter
method checks a per-callback capability before filesystem I/O. The capability
is revoked in an inner `finally` before staging, failure recording, publication
or claim release, so a retained method cannot mutate after its callback settles.
This confines the supplied API; arbitrary JavaScript that independently obtains
filesystem authority is not an operating-system sandbox. The adapter refuses
`.git`, symlink traversal and paths outside the worktree. The coordinator remains
the only Git publisher. There is no installed role descriptor. Reopening this
service for reflection requires the same synthetic policy and maintenance
callback. This path is not live and is not selected by installation.

The [R3 trajectory contract](letta-parity-r3.md) refines this synthetic path:
`step-count` counts only caller-finalized assistant rows after the settled
watermark. Threshold 25 is supported independently of eight-entry/1024-byte
worker chunks, within a 128-entry input bound. Settled chunks drain only their
captured omitted-ID prefix without retriggering; late tails wait for a fresh
trigger. Held snapshots ignore later tails but reject captured-prefix identity
changes. Native secret detection replaces a whole matching row before UTF-8
truncation; the existing `truncated` metadata means redacted **or** truncated.
Omitted bodies are not persisted or integrity-bound, only their IDs. Receipts
add bounded, non-persisted progress counts. Replay is immutable, branch/job/digest
bound and non-executing; it never settles or launches work. None of this changes
live settings, installed reflection or the roadmap's parity scores.

Phase D adds an optional model maintenance adapter in
`lib/agent-memory/local/model-worker.ts`. A caller may pass it as the synthetic
maintenance callback. Each job launches one isolated public SDK session with an
in-memory transcript, an empty disposable working directory, and only the
confined workspace tools. The adapter does not read credentials, provider
catalogs, Pi sessions, or a live profile. Extension, kernel, installer, and
package-manifest code do not import it. It does not use a subagent role
descriptor. `maxPromptBytes` counts only the rendered trajectory prompt, not the
whole model context. Assistant text, tool-call count, serialized tool
arguments, complete call bytes (tool name plus arguments), and tool-result
text have separate aggregate caps. A bounded
deadline aborts that public session cooperatively; it is not an operating-system
kill, and the supplied runtime is expected to honor the abort. The worker waits
until that prompt settles before it returns. Final classification uses the
session's authoritative messages. Timeout outranks overflow, provider, and
cancelled, and those outrank a later generic tool error. The fixed categories
are malformed, overflow, cancelled, timeout, provider, and cleanup. Thinking
content in a thinking-off session is malformed. Ordinary final text with no file writes remains a no-op.
Those failures throw, so the existing job becomes `failed` and the watermark
stays put until an explicit retry of that same snapshot. `repair-needed`
requires explicit coordinator repair or abandonment; neither consumes trajectory.
Synthetic function
callbacks remain valid. This adapter is not selected by installation and does
not publish.

Phase E adds a disconnected committed projection and explicit `Memory(path)`
reads on this same coordinator. `compilePrompt`, `readMemory`, and `listMemory`
resolve `refs/heads/main` to one commit, then read only that commit's objects.
They do not read a reflection worktree, an unintegrated job, a private draft,
or the process working directory. A later integration is visible on the next
call. A prompt string that has already been returned stays as it was. Reopening
the service and compiling the same commit returns the same prompt bytes. There
is no cache and no profile reload.

The automatic prompt keeps exact text for committed `Core.md`, `index.md`, and,
when that blob is a regular file, `system/persona.md`. Passing a project id also
includes that project's `system/overview.md` and `system/conventions.md` when
those regular blobs exist. This matches the live always-loaded set: Core, index,
persona, and only the named project's overview and conventions. `system/human/**`,
reference files, other project files, and every other committed file stay
deferred. The projection does not summarize them. It lists at most 32 deferred
paths and reports the true total when more remain. Missing `Core.md` or
`index.md`, or a compact owner that is a symlink, submodule, or non-regular
file, fails the projection. An optional compact owner that is simply absent is
named in `absent`.

| Bound | Value |
| --- | --- |
| Prompt file text | 8192 source bytes |
| Prompt JSON | 48 KiB |
| Deferred and blocked path lists | 32 |
| Directory page | 32 immediate children |
| `Memory(path)` text | 8192 bytes |
| `Memory(path)` byte offset | at most 262144, and not past the blob |

Truncation keeps an exact UTF-8 prefix and reports `bytes`, `returnedBytes`, and
`truncated: true`. A directory page is sorted by relative path. `nextOffset` is
present only when later entries remain. `truncated` on that page means the same
thing. Only mode `100644` blobs are text. Symlinks, submodules, and any other
mode fail a read and are not followed. A directory listing may name them with
kind `symlink`, `submodule`, or `special`, without a target or blob id. Paths
are portable and relative: an absolute path, a `..` segment, NUL, or a backslash
is refused. With a project id, another project's `projects/`, `deferred/`, or
non-legacy `archives/` path is refused. Results carry the commit id and relative
paths. They do not carry absolute paths, blob ids, or symlink targets.

A tree listing that exceeds the existing 1 MiB Git output bound fails closed.
Missing paths, a non-commit or malformed object, a replaced service identity, and
an interrupted integration that has not moved `refs/heads/main` also fail closed
or continue to show the last published commit. Errors stay on fixed sentences
such as `Local memory path refused`, `Local memory projection refused`,
`Local memory repository refused`, and `Local Git object refused`.

Extension, kernel, installer, and profile code do not import this layer. It does
not call a provider, publish, or select installation.

Phase F adds logical forgetting on this same coordinator. The durable record
is `forgetting.json` in the service state directory. Workers cannot edit it.
The record is version 1, bounded to 4096 paths, 4096 blob ids, and 4096
sources, and at most 512 KiB. Its digest is a SHA-256 of the canonical
policy. An empty record is written only during the constructor's initial
setup of a new repository. After that setup, a missing record fails closed
on the same service instance and on reopen. It is not recreated empty.
A malformed or digest-mismatched record also fails closed with
`Local memory forgetting refused`. A well-formed replacement by another
same-user process remains outside this trust boundary.

`importTombstones` accepts one snapshot shaped for a later canonical import:
source revision, digest, exact relative paths, Git blob ids, and source
identities. The snapshot digest is checked. The same snapshot is idempotent.
A different snapshot with a stale expected policy revision or digest throws
`Local memory forgetting stale`. A different snapshot presented with the
current revision and digest throws `Local memory forgetting conflict`.
`Core.md` and `index.md` cannot be path exclusions, and publication does not
delete them. A blob id that is the current text of either required owner is
refused. An older blob id may be imported after those files change. The call
does not read a private memory root.

When matching files are on current `main`, import writes a removal commit
whose parent is that `main`, then moves `refs/heads/main` to it. The parent
stays reachable. There is no history rewrite and no claim of secure erasure.
The record stores the source revision, source digest, prior `main`, and
removal commit. If the process stops after that record is durable and before
the ref moves, the next call on that service, including a reopen, finishes
the same removal. Forgotten
paths and exact blob ids are then absent from published `main`.

The same policy filters later reads. Worktrees hide matching files before a
worker or model maintenance callback runs. A required owner whose blob is
forbidden is not deleted. The worktree file is replaced with a non-forbidden
blob from the import's removal commit or prior `main` when that blob exists.
Decoding keeps a leading U+FEFF. The reconstructed text is written only when
its Git blob id matches that selected blob.
Otherwise the worker is not started. Workspace read, list, and search omit
forbidden bytes, including former Core and index text. Write, edit, and
rename of a tombstoned path, or of the exact tombstoned bytes, fail with
`Local memory forgetting refused`. While a tombstone policy is active, delete
and rename cannot remove `Core.md` or `index.md`. A worker may delete other
visible files. Deleting or renaming does not remove a tombstone. Staging
drops a forbidden path before commit, and a worker that tried to add one
fails without publishing it. Integration strips those paths and blob ids
from the published tree, including a merge of a commit made before the
import. If that cleaning leaves the current `main` tree unchanged, the
service still publishes a two-parent integration commit with that tree
through the pending update, so the worker commit stays an ancestor of the
recorded integration. `compilePrompt`, `readMemory`, `listMemory`, and
`readCommitted` apply the same filter even when `refs/heads/main` is moved
back to an older commit. A required owner whose current blob is forbidden
fails the projection or read closed instead of returning that text. Forgotten
paths are not listed as deferred, blocked, or absent. Results include policy
revision, digest, phase, and counts, not the forgotten paths or text.

Turns on one service stay serialized, and cooperative current-version processes
also share the root claim, so an import and a later integration do not publish a
mix of old and new policy. Extension, kernel, installer, and profile code do not
import this record. It does not call a provider or select installation.

This owner is not ABI3. Source loading does not construct it. Profiles, kernel
bindings, role descriptors, private memory roots, and `/mh-memory` commands do
not call it. Live adoption remains unauthorized. The lifecycle source test is
not installed or human acceptance.

Phase G adds a disconnected shadow adapter in `lib/agent-memory/local/migration.ts`.
It consumes one in-memory bundle assembled from `migration-export` pages plus the
active file bytes those pages identify. It checks the shared revision and ledger
digest, complete pages of at most 32 entries, portable unique paths, Core and index,
exact content hashes, and file-count and byte totals that fit the current corpus
(about 293 files and 3.8 MiB, inside the existing 1024-file and 8 MiB ceilings).
Every file also carries a committed-read envelope: `revision`, `currentRevision`,
`basis: "view-snapshot"` and `freshness: "current"`. The supplied text must hash
to that committed hash and to the export row. A private draft, stale read, mixed
revision, or altered text is refused. These envelopes and pages are caller-supplied
assertions, not authenticated source capture. The adapter validates self-consistency
only; it cannot observe a later source change. The caller must perform a final
canonical revision/currentRevision check immediately before shadow open through
the authorized source owner, refusing/recollecting on mismatch. This is not an
atomic cross-owner lock, provenance attestation or consent grant. Complete section
paging rejects gaps, overlaps, duplicates and extra empty terminal pages.
Forgotten paths and sources are removed before seed, including when the export
also listed them as active. Ambiguous, stale, or incomplete bundles fail closed.

The adapter creates only a fresh shadow state root. It seeds the remaining
committed files, installs the Phase F tombstone snapshot, and writes a
coordinator-owned receipt with the source revision, ledger and export digests,
config hash, file count, bytes, manifest hash, initial head, forgetting digest,
reviewed IDs, and the exact rollback identity. The receipt does not contain file
text or a private memory root. Before the receipt is written, the sorted path and
Git blob manifest of the seed must match the prepared bundle exactly. Reopening
the same complete bundle verifies that receipt, including the manifest, and returns
it unchanged. A different bundle, a replaced repository, an equal-length content
change, or a partial root that is not the recorded owner fails closed. An
interrupted create can be resumed when the owner identity and manifest still match.
Changing the root inode at the same path refuses open and rollback. Later forgetting
policy evolution makes the old bundle's receipt verification refuse rather than
resetting the policy or reseeding excluded bytes; version-1 receipts remain unchanged.
Do not retrieve forgotten content merely to infer historical blob tombstones.
Rollback waits on the migration turn and then holds the same sibling root claim
used by service operations. It renames only a quiescent owned root after two
checks: no queued, running, committed or repair-needed job, no pending publication,
and no ownership, progress or worktree residue, including a repair index/lock.
The claim remains held through quarantine rename and moved-inode verification,
then releases its original sibling path. A competing current-version opener
cannot reconcile the root mid-rollback. Integrated, noop, failed, repaired and
abandoned jobs may remain only after residue is gone. Public abandonment retains
evidence and publishes nothing; exact cleanup is separate. Existing service
handles then fail. A dead or poisoned claim blocks rollback rather than being
stolen. This is target quarantine only: not managed revision rollback, backup/restore,
prior-route restoration or authority cutover. Those active migration workflows remain
unavailable. The [R6 contract](letta-parity-r6.md) records prospective active
preview/apply identity, consent and receipt requirements, not an executable live
procedure.

A separate `memory-rehearsal.mjs` source operator now provides only a fixed-synthetic
`preview → apply shadow → status → rollback/quarantine` journey using these owners.
See the [exact command/target/receipt contract](letta-parity-r6.md#fixed-synthetic-rehearsal-operator).
It requires a canonical explicit empty `shadow` child of a new dedicated disposable
parent and `--fixture r6-basic-v1`; no source/content/private-root/provider inputs or
profile fallback exist. Preview writes bounded sibling review metadata but leaves
target contents empty. Apply and rollback require exact reviewed operation/expect
identities inside the existing migration turn and root claim. A separate strict
64-KiB/16-event digest-chained record persists intent and terminal evidence without
changing migration.json v1. Terminal quarantine success and exact status/rollback
replay require the canonical non-symlink moved directory, its recorded device/inode
and matching migration owner/receipt identities and digests. Missing, replaced or
linked quarantines return unknown/refused without adoption or mutation. Public
results expose only an opaque `quarantineId`, not absolute paths. Exact retries
are idempotent when identity still agrees; interrupted intent and
post-rename-without-terminal evidence remain unknown. Retained claims block
automatic takeover. This promises only process-restart durability at verified
record boundaries, not whole-service power-loss atomicity, backup/restore or live
cutover. It is not installed R6-I/O/H or human acceptance.

Extension, kernel, installer, and profile code do not import this adapter. It
does not call a provider, publish, or select installation.

The existing Phase H work is a disconnected synthetic Palace HTML preview on this same
coordinator. `palacePreview` builds one metadata snapshot inside the service
turn, after that turn's recovery. The snapshot lists relative corpus paths,
canonical `refs/heads/main`, unpublished detached job work, job lifecycle,
visible conflict paths, synthetic publication, and read-only retry/resume
guidance. It does not include file text, excerpts, prompts, frontmatter, diffs,
reflection or trajectory text, job summaries, raw errors, ownership records,
worktree paths, or the state root. Forgotten corpus paths and forgotten
conflict paths stay omitted; a hidden conflict count may remain. Detached rows are unpublished `committed`, `repair-needed`, or `abandoned`
worker commits, or a running worktree that is still present. Abandonment keeps
the unpublished commit as historical evidence even after exact worktree cleanup.
Integrated, noop, repaired, and failed jobs are not detached work, and detached
work is not a Git branch or canonical Git commit history.
`repair-needed` cannot be advanced by resume/retry. The synthetic coordinator's
explicit repair/abandon methods are not controls in this read-only preview.
Repaired/abandoned status, retained historical conflicts and reviewed publication
IDs remain visible, with explicit unchanged-trajectory guidance. Each collection
returns at most 32 entries. The serialized
snapshot is at most 48 KiB, and counts say when a page is truncated.
`palaceDocument` is a separate read for one relative path at the canonical
commit resolved for that call. The HTTP document and read routes carry a
canonical base64url token for that path, not the raw path. It returns bounded
UTF-8 text for a regular file that is still visible, and it refuses a forgotten
path, blob, or source. `palaceCorpusPage` returns the next metadata page for
that same commit, at most 32 entries and 48 KiB, with the same forgetting
filter and no file text. The snapshot stays metadata-only and at most 48 KiB.

`pnpm memory:palace-preview` creates a fresh temporary synthetic service and
serves that snapshot on `127.0.0.1` at an unguessable path. It does not accept
a state path and does not read a private memory root. The HTTP surface is
GET/HEAD only. The page, snapshot, document, corpus, and two fixed font routes are
capability-scoped. Those font routes serve only the repository-vendored Manrope and
Fira Code Latin variable WOFF2 files. Arbitrary external and user-controlled assets
stay refused.
The page has four read-only views: context, core memory, external memory,
and history. Context renders one optional fixed session-context snapshot
captured before startup. Omitted context is unavailable and is not corpus
paging. Its stylesheet adapts the public Letta Code memory viewer
template at commit `5dea67021b99810707ff753db35e4534f70ff1fd` (Apache-2.0);
Mahiro changes branding, authority, data binding, security, and responsive
behavior. See `THIRD_PARTY_NOTICES.md`. Committed files can be opened.
History separates an explicitly unavailable Knowledge history section from bounded
Lifecycle history and publication facts. Reload is a link. There are no mutation
controls, but reads may reconcile/recover under the service owner. This synthetic
preview does not own the installed command. The public `/mh-memory palace` façade
uses the separate ABI2 metadata handoff described below.

The [R7 disconnected invocation-view contract](letta-parity-r7.md) adds a separate
strict envelope and service-only captured snapshot/first-parent knowledge-history/
safe replacement-diff APIs. Real committed projection receipts carry explicit
synthetic-local-projection provenance; context is fixture/caller-supplied/unavailable,
not corpus-derived. Captured APIs refuse changed main or forgetting policy. Source
exclusion uncertainty is unavailable, not guessed; active path/blob exclusions also
withhold historical author/subject metadata because it lacks safe knowledge attribution.
Working-tree state is unavailable.
The HTML preview remains fixture/synthetic and per-request: it does not use this
new envelope or expose history/diff routes. This is source/synthetic evidence only,
not installed active-prompt capture or acceptance.
Extension, kernel, installer, and profile code do not import this preview. It
does not publish, select installation, or become live authority. The preview
is labelled not live authority. Its provenance defaults to synthetic. A caller
may pass `private-shadow` so the same page says it shows migrated real memory
in a private shadow; that label does not read private state or change live
authority. Live publication remains ABI2. Any wiring to the live coordinator
requires the roadmap's separately approved integration and evidence gates; an
accepted preview alone does not authorize it. Roadmap direction was accepted on
2026-10-30 for continued repository write/test/checkpoint execution. R0–R7 bounded
source milestones and the [R8 source audit](letta-parity-r8.md) are recorded;
installed/observed/human gates remain open, not an active R0 implementation plan.
Phase H continuation and Phase I remain paused until their own gates pass. Push,
tag, release, profile/install mutation, live cutover, Phase I and later human-only
product/visual acceptance are not authorized by that direction acceptance.

## Historical recall and quoted notes

Continuity (C1) searches a separately accepted, screened archive:

- `recall_search` uses short literal keywords and returns bounded quotes/citations.
  Try a shorter term or Thai/English alias when needed.
- `recall_read` opens a cited `recordId`, optionally locating a literal query.
  It does not grant arbitrary filesystem access.
- `includeGlobal` / `crossProject` select permitted scope, never bypass filters.

Where configured, a locked tool-free reflector selects validated literal
quotations from bounded observed-primary input as low-authority notes. It does
not rewrite Core or infer lasting preferences. Managed automatic writing gets
the existing settled-handler opportunity first; C1 defers while that writer runs.

```text
/recall <keywords>
/memory-status
/memory-forget <existing-note-id>
/memory-correct <existing-note-id> <retained-record-id> <literal quote>
```

Settled primary turns also ingest bounded redacted assistant responses (`historical-assistant`) into the continuity archive alongside user messages (`historical-user`) so `/recall` and `recall_search` can retrieve past technical explanations and fixes as `UNTRUSTED` evidence, while reflector note promotion remains strictly restricted to `historical-user` sources.

These controls affect current-project quoted notes, not maintained Core or the
archive itself. Correction requires a retained source and literal quote;
forgetting is not secure source-history erasure. A genuinely fresh archive may
be empty, but missing/corrupt/revoked data must not be reported as verified empty.

Implementation: [managed memory](../extensions/mahiro-agent-memory.ts),
[retrieval](../lib/agent-memory/retrieval.ts), [store](../lib/agent-memory/store.ts)
and [continuity](../extensions/mahiro-continuity.ts).
Source/SDK fixtures do not establish installed activation, semantic learning,
memory-use performance or human acceptance.

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
registry, file export, HTML/HTTP, activation or Phase I is added. The internal
context and structure owners remain separate even though the final public command
surface is consolidated below. R7-I/O/H remain open; this prerequisite does not
establish installed/rendered longitudinal or human acceptance.

## R7-08 internal first-parent history prerequisite

The bounded first-parent history owner is ABI2-only. It accepts only a canonical
offset from 0 through 127 through its internal compatibility route, uses existing
idle-primary `agent_memory_manage` read authority and invokes a dedicated internal
`knowledgeHistory` engine RPC; ABI1 refuses without fallback. The RPC binds the
mapped project, expected current revision and config hash, reads the committed
current ledger, and walks at most 128 commits from that exact HEAD along Git's
first-parent chain. Pages are fixed at eight rows.

The result is intentionally identity/time-only. Each row contains only the commit
OID, its first parent or `null`, and a canonical UTC commit timestamp. Author,
subject, email, changed paths/counts, patch text, file bodies, historical ledgers,
refs and arbitrary commit selectors are unavailable. Any current forgotten source
makes history unavailable because historical source attribution is absent. Path
forgetting does not reveal path-shaped metadata because that metadata is never
collected or returned. Replacement refs, grafts and shallow history are refused.

Before return the engine rechecks repository semantics, current config hash, HEAD
and the exact committed ledger digest, then the runtime rechecks status, branch,
idle/writer state, generation, binding and current authority. These are sequential
endpoint observations, not atomic or ABA-proof history capture. The compact reply
is bounded to 32 KiB, the 128-entry condition means only that the bounded window
was reached, and no persistent replay or diff handle is created. The command adds
no model-callable management action, HTML/HTTP route, `local/**` authority, profile
activation or Phase I wiring. Source and disposable SDK evidence remain a
prerequisite only; provider-backed, rendered, longitudinal and Mahiro-owned R7
acceptance remain open.

## R7-09 source-only immutable Palace HTML handoff

The immutable handoff is exposed publicly by `/mh-memory palace`. It is ABI2-only
and TUI-only in source. It does not use or
import the disconnected `lib/agent-memory/local/**` Palace. One idle-primary
operation captures the existing owner-certified committed structure, public
invocation metadata and exactly the offset-zero eight-row knowledge-history page,
then checks revision, config, branch, writer/draft state, generation, binding and
current read authority. The combined association remains explicitly non-atomic;
provider prompt consumption, category token accounting, lifecycle, bodies, diffs,
authors, subjects, changed paths and replay remain unavailable.

The allowlisted handoff DTO is deeply copied/frozen and bounded to 48 KiB. Its
static semantic HTML is bounded to 256 KiB, contains no script or remote asset,
and exposes only invocation metadata, returned committed structure and the latest
bounded first-parent identity/time rows. The runtime serves those exact frozen
bytes for at most ten minutes on one random capability path at `127.0.0.1:0`.
It does not open a browser or write an HTML file. Only exact Host + capability
GET/HEAD requests without a body are accepted. CSP uses one fixed inline-style
hash with `default-src 'none'`, `script-src 'none'`, `connect-src 'none'`,
`img-src 'none'` and `font-src 'none'`; responses also disable caching, referrers,
framing, MIME sniffing and unused camera/location/microphone features. There is no
CORS grant, cookie, JSON/document route, remote host or mutation control.

Every valid retrieval reauthorizes the current ABI2 owner and rechecks the captured
revision/config, committed structure/snapshot digests, exact offset-zero history,
branch, idle state and authority. It never rerenders from newer data. Drift or
denial returns a generic unavailable response and revokes the viewer; new agent
work, compaction, memory mutation/writer admission, navigation, shutdown,
replacement, explicit `/mh-memory palace close` (or the hidden legacy close alias) and expiry also revoke it and
close its transport. Timeout/close aborts current validation and generation-fences
late results; arbitrary third-party Promise work is not claimed to be synchronously
cancellable. A URL already delivered to a browser cannot be retroactively erased, and another
same-user process holding that URL is outside the loopback bearer contract.

This is source implementation and focused fixture evidence only. No current-profile
installation/reload, browser opening, rendered review, provider-backed inference,
longitudinal observation, Phase I wiring or Mahiro visual/product/RAM acceptance is
claimed; R7-I/O/H remain open.

## R7-10 consolidated Palace command surface

The product-facing command is intentionally smaller than the implementation seams:

- `/mh-memory palace` opens the immutable ABI2 metadata viewer;
- `/mh-memory palace close` closes the current capability viewer;
- `/mh-memory palace json` returns the legacy bounded structural/link/view/episode
  diagnostic.

Earlier checkpoint routes remain accepted only as hidden compatibility aliases for
source and operator evidence. They are omitted from public help and are not separate
product features. Their underlying runtime/RPC owners stay separate so the
façade cannot mislabel sequential context, structure and history checks as one
atomic snapshot. This consolidation changes command UX only: it does not open a
browser, activate a profile, add data routes, expand authority, establish R7-I/O/H
or alter the live ABI2 publication owner.
