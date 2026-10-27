# Memory and historical recall

[← Documentation](README.md) · [Roles](agents.md) · [Installation](bootstrap.md)

Mahiro Pi separates **maintained knowledge** from **historical quotations**.
Neither is permission policy. Current human instructions, repository owners and
live evidence outrank fallible memory; imported records are evidence, not new
instructions or authenticated current preferences.

## Maintained knowledge

One private Markdown/Git repository owns published knowledge. Standard ABI2
installation binds `<profile>/memory` through its per-profile selection record.
The legacy path supports `MAHIRO_AGENT_MEMORY_ROOT` for a controlled store; it is
not the ordinary ABI2 selector and grants no authority. Configuration, drafts and
episode metadata stay private.
The standard installer initializes only an absent root with a generic editable starter;
it never imports a personal corpus or overwrites existing Core/data.

| Path | Purpose |
| --- | --- |
| `Core.md` | Concise identity, confirmed preferences and reusable methods |
| `index.md` | Navigation to selectively read detail |
| `system/persona.md` | Tiered v2 always-loaded agent identity |
| `system/human/<name>.md` | Tiered v2 always-loaded human context and `prefs/<name>.md` |
| `projects/<project-id>/system/<name>.md` | Tiered v2 always-loaded project system context |
| `projects/<project-id>/reference/<name>.md` | Tiered v2 on-demand project reference detail |
| `reference/<name>.md` | Tiered v2 on-demand global reference detail |
| `archives/<slug>/<name>.md` | Historical provenance material (never projected into prompt) |
| `global/<name>.md` | Shared detailed knowledge (legacy compatible) |
| `deferred/<project-id>/<name>.md` | Project-owned detail (legacy compatible) |
| `procedures/<name>.md` | Reusable workflows (legacy compatible) |

Core/index and active tiered `system/**` + `projects/<project-id>/system/**` files project into eligible primary requests via a single batched Git object read. Detailed reference/deferred/global files are read selectively. Authenticated primary views share relevant deferred knowledge across canonical projects; native workers and retained legacy views remain scoped. Unmapped projects derive collision-checked path identities without rewriting the project map. Source registration alone never migrates knowledge.

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

## Read and discover

`agent_memory_read` has mutually exclusive modes:

| Input | Result |
| --- | --- |
| `{}` | Legacy authorized file list |
| `{path, offset?, limit?}` | Original Unicode code-point paging (limit 1–4096) or tiered directory index (`system`, `system/human`, `reference`, `projects/<id>/system`, `projects/<id>/reference`) |
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

`agent_memory_manage` provides primary-only status/cancel, `doctor` health/budget/broken-link auditing, `palace` read-only structural/link/view/episode inspection (inspecting frontmatter and `[[wiki-links]]` across all non-archive active files, ordering non-archive file metadata ahead of `archives/**` within a bounded reply, and reporting `coverage` so `healthy` is never asserted over uninspected content), `init-project` and `migrate-v2` tiered v2 transitions, `remember` surgical note appending, explicit new-root initialization, revision-guarded forgetting/rollback/discard and bounded conflict inspection. Legacy migration keeps byte-exact originals under segmented `archives/legacy-v1-<revision>/global/` and `archives/legacy-v1-<revision>/deferred/<project>/` paths before replacing v1 locations. Missing or malformed frontmatter gets deterministic safe metadata without rewriting archived bytes. Repeated migration or project initialization at the same state is a true no-op: it returns the current revision without preparing a publication or retaining a new view. `/mh-memory` exposes `status`, `help`, `doctor`, `palace`, `init`, `remember <text>` and `dream`. Conflict lists page up to eight retained views; proposal text pages by original code points. Read all pages before recovery; `proposalHash` describes the complete proposal. Resolve through current hash/revision tools, then discard the selected view explicitly. Never copy a proposal over newer knowledge blindly.

Palace presentation is capped at 240 KiB for the complete encoded JSON reply, including
escaped/multibyte metadata and the `palace` wrapper, leaving room for the engine transport
envelope. Paths are never shortened. `layers` indexes exactly the returned `files`, not the
entire active corpus; `coverage.layersTruncated` equals `coverage.filesTruncated`. Presentation
truncation does not stop inspection of any non-archive active file: coverage counts and broken-link
totals still describe the full inspection, while `brokenLinksTruncated` identifies a bounded sample.
`healthy` requires complete inspection, zero broken links and total usage within the configured ceiling.

Forgetting is logical filtering, **not secure Git/history erasure**. Revise
Core/index to remove the forgotten knowledge/source link while preserving identity
before source-forgetting. Source-linked global/deferred/procedure files may be
removed conservatively as whole files. Rollback and conflicts still honor current
forgetting; retained views are not a way to resurrect forgotten material.

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
revision/permission fenced, but is completion-driven rather than inheriting the
ordinary 30-second interactive request deadline. The explicit operator also has
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
