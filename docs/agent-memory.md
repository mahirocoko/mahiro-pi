# Native agent-managed memory contract

## Mission and approval

Mahiro's target is **Letta Code on Pi**, not Pi with a quote database. At 23:48
Asia/Bangkok on 2026-10-18, Mahiro approved the long design/implementation run
following the complete-agent contract and native cross-session proof plan.

This document owns the implemented managed-memory contract. A controlled native
provider proof passed on 2026-10-19. At 15:29 Asia/Bangkok Mahiro separately
approved reversible real migration; the default private root was seeded and
explicitly activated at 16:08. This is not human daily-primary acceptance.
`docs/integrations.md` owns actual activation/evidence; T190 owns progress and
human acceptance. Source basis: Letta Code `7be3c81`, the 2320 source study.

## Canonical owners

| Contract | Owner |
| --- | --- |
| Managed private knowledge, projection, maintenance and writer orchestration | This package's agent-memory implementation |
| Native sessions, LLM execution, tools and subagent scheduling | Public Pi SDK and registered native subagent service |
| Operation/path permissions and healthy-session identity | Root-owned `lib/guards/index.ts` narrow ABI; public permission-system is the sole policy resolver |
| Screened historical evidence and existing quote lifecycle | Existing continuity library/store/controller |
| Native bootstrap | Thin native global AGENTS; the seven confirmed facts now live in managed Core, with original snapshots retained |
| Status/footer, auth/model defaults and unrelated workflows | Existing owners; unchanged by this work |

There must be one authoring surface for maintained knowledge. Historical archives,
private worker changes and legacy bootstrap material are not competing current
knowledge. Product code remains separate from private user memory.

## Implementation lane (H1/H2 checked in native SDK fixtures)

H1 was confirmed with actual SDK 1.3.0/native service dispatch using injected Faux
transport, not a paid provider: public child session identity plus the native
service's outputFile binds a private view without cwd overrides. The canonical
guard owns the binding: child session_start captures its SessionManager; native
child lifecycle attests parentage; the parent's immutable service record must
match the captured session file and locked writer role before any scoped tool is
authorized. No model argument can choose a lease or claim to be a worker.

H2 exposed a concrete native counterexample: `prompt_mode: replace` retained a
portable parent preamble. The managed extension now replaces the whole bound
worker system prompt through public `before_agent_start`, reading the sole
package-owned role body. The native fixture checks both parent-context and
cross-project corpus markers are absent, while a forbidden project read fails.
It also verifies changed Core in the next primary request and a fresh SDK session,
and projection removal after revocation. These are native runtime/public-API
checks with synthetic content and transport, **not real-provider learning proof**.

The implementation uses one private Markdown/Git root, immutable committed
revisions, per-session drafts and per-job private views. Core/index are global;
deferred knowledge is project-scoped and procedural knowledge separately named.
Main and native writers use the same authoring operations. Integration is filewise
three-way CAS: disjoint edits merge automatically, overlapping edits preserve the
view as a conflict. A tracked monotonic forget ledger filters rollback and stale
views. A public before_agent_start projection reads committed Core/discovery
metadata on every primary request; private worker context never projects the
primary corpus. Permission and structural checks are not semantic truth checks.

Activation is explicit, default-off, and separate from C1 quote learning. The
separate reviewed private [`bootstrap`](bootstrap.md) command may initialize a
new explicitly selected root only through guarded native `agent_memory_manage`
with zero-external-inference Faux transport. Existing roots are read-validated and
preserved, never reseeded or automatically enabled; this is not corpus migration
or native default-provider proof. No real bootstrap, corpus, role registration or
HOME configuration is migrated by source installation. The existing no-tool quote reflector remains a distinct role.

The package registers managed memory before continuity, after the unchanged
status/voice entries. Public SDK 1.3.0 package resolution preserves these declared
file entries (including stable equal-precedence resource ordering); extension
loading and event dispatch preserve that order and await each handler. Both memory
owners use `agent_settled`, not `agent_end`. A qualifying managed automatic writer
therefore claims the shared native service first and C1 defers on `hasRunning()`.
If managed memory is inactive, unavailable or configured `automatic: false`, it
claims no automatic job and C1 can retain its legacy behavior. This does not disable
C1 grants, roles, history, recall or forget controls, nor enable automatic policy.
The manifest regression guards registration order only; focused runtime fixtures
are not a native two-controller coexistence or real-default activation proof.
Main must verify automatic coexistence through the actual default native SDK after
explicit root/role/permission activation, separately from earlier controlled proofs.

## Required behavior

1. **Maintained memory:** readable Markdown Core, an index, deferred project/domain
   knowledge and separately owned procedural memory. Core may include identity,
   user preferences and learned methods; do not restrict the target to operational
   lessons. Preserve established identity and current user/repository instructions.
2. **Main self-edit:** the primary agent can read, add, revise, remove and commit
   maintained knowledge through root-scoped operations. Existing entries should
   be updated rather than accumulating contradictory instructions.
3. **Background writing:** native memory/reflection workers maintain that same
   knowledge through isolated, leased views and integration. They are real
   writers, not literal-quote extractors. Automatic nonconflicting integration is
   supported; semantic Main approval is not mandatory for every edit.
4. **Episode evidence:** reflection can use bounded observed input, assistant
   action, selected tool result, correction and outcome, with durable progress.
   No imported transcript becomes a current instruction or authenticated human
   statement merely because it has a user role.
5. **Context feedback:** a committed memory revision changes subsequent primary
   requests and fresh sessions through public hooks. Do not claim saving or Git
   success alone proves active context. Load Core and discovery metadata, not
   the complete archive or every deferred file.
6. **Maintenance/recovery:** version checks, deduplication/replacement support,
   source-linked forgetting, conflict preservation, cancellation/revocation and
   bounded retry/checkpoint behavior. No recovery may silently resurrect forgotten
   active knowledge. Logical forgetting is not secure erasure of Git/history.

## Public capability and authority

The existing continuity grant authorizes quoted-note learning, not curated Core
writing. Add a separate, exact-root managed-memory capability at the canonical
guard owner. Revocation, missing/obsolete guards, excluded projects, stale
generations, malformed tool arguments and escaping paths must fail closed.

The pinned public subagent `SpawnOptions` has no cwd override. Do not invent one
or import host internals. Scoped memory tools can bind a native worker to its
private view without granting arbitrary product/HOME writes. Memory workers may
not obtain broader authority by submitting caller-selected flags or role names.
Their lifecycle and initial outcome must be tracked using supported native APIs.

Core changes are model-maintained knowledge, not new permission policy. Prompts
guide factual/semantic quality; structural validation must not be presented as
proof of truth. Use filesystem and Git bounds for enforceable guarantees.

## Layout, tools and lifecycle

Implementation owners are `lib/agent-memory/store.ts`, `runtime.ts`,
`extensions/mahiro-agent-memory.ts` and the package-owned writer role. There is no
runtime import from Mods, installed host internals, or a separate SDK LLM driver.
Root `lib/guards/index.ts` authors the candidate's separate `managedMemory`
ABI1 on healthy nodes; public subagents alone runs children and the public
permission service alone resolves policy. The approved private memory activation
is distinct from the still-pending Root guard cutover: the current live
compatibility profile still uses the legacy guard package.

The private root defaults to `~/.pi/agent/memory`; `MAHIRO_AGENT_MEMORY_ROOT` is an
explicit controlled-store override, not authority. `config.json` is private,
untracked configuration with exact canonical CWD/project mappings, budgets and
`automatic`. Core/index are always-loaded global shared knowledge;
`global/<name>.md` is selectively read shared detailed knowledge;
`deferred/<project>/<name>.md` is scoped project knowledge;
`procedures/<name>.md` is shared procedural knowledge. Global detail and procedures
use the same explicit shared scope as Core/index, not another project's scope.
The initial identity must be supplied explicitly. No bootstrap or archives are
imported automatically. Core supports persona, preferences and learned methods.

Tracked Markdown and `.memory.json` form a standalone private Git repository.
HEAD is the publication boundary. Config, `.views`, `.episodes` and `.lock` are
ignored there. Draft views contain actual scoped Markdown files plus private CAS
metadata. Files/root use 0600/0700; symlinks, hardlinks, escaping paths, secret
patterns, malformed metadata and linked Git metadata fail closed. Git uses fixed
argv, shell=false, exact cwd, 10-second per-command bounds and inherited identity/
hooks. It never changes Git configuration or bypasses hooks. Dirty/staged tracked
work and colliding untracked files block integration instead of being overwritten.
Hook failures preserve the proposal/worktree and leave committed context unchanged;
inspect and recover explicitly rather than bypassing validation.

Default budgets remain Core 8192 bytes, index 2048, each global/deferred/procedure
8192, all knowledge 65536. Explicit private configuration can raise these to
32768/8192/262144/8388608 respectively; 4 KiB is not a native SDK limit. At most
**512 maintained files including Core and index**, across all mapped projects,
are supported. The project-mapping cap remains 128, with 32 source links/file,
4096 forget/review entries, 64 retained views and 256 episode files. The serialized
ledger has an independent 131072-byte ceiling: maximum file/source/tombstone counts
are not a promise that every combination fits that metadata budget.

A private view contains both scoped base and proposed knowledge. Its fixed
**40-MiB serialized ceiling** is checked before any view-file write and by every
full reader and lightweight header reader. Both copies and their ledger metadata
are validated. Allowed text expands by at most 2x in JSON; the executable bound
is `4 * 8388608 + 2 * 131072 + 64 * 512 + 1024 = 33850368` bytes, below the fixed
ceiling. Exact serialized-byte rejection remains authoritative. Publication also
preflights the committed-state view before changing Git; capacity rejection does
not publish an unreadable revision or overwrite the prior proposal.

Inspection and cleanup retain bounded lightweight headers, hydrating only one
selected body at a time. Older view ordering falls back to one validated body,
not a retained array of corpora. A header never authorizes deletion: cleanup
rehydrates and checks the selected full proposal first. Closed/expired nonconflict
views are reclaimed at 32 views; conflicts remain until explicit discard and block
capacity rather than being lost. Fixed ceilings, rather than shrunken current
budgets, validate retained conflicts for listing/discard; stale config hashes
still block active use/publication. Reviewed/forgotten episodes are reclaimed at
capacity; unreviewed evidence is not evicted. Git metadata retains its 8192-entry
ceiling. These are bounded cooperative limits, not secure erasure or an OS sandbox.
Operator maintenance is required at ledger/history capacity; there is no infinite
unattended retention promise.

Main tools:

- `agent_memory_read`: list scoped files or page one Markdown file (Unicode
  offsets, max 4096 characters); returns whole-file hash and committed base revision.
- `agent_memory_edit`: add/replace/remove in a private draft with exact file hash
  (`null` for a new file), text and episode source IDs. Core/index cannot be removed.
- `agent_memory_commit`: filewise three-way CAS against the base revision. Disjoint
  file edits merge; overlapping edits preserve a conflict, not a semantic auto-merge.
- `agent_memory_manage`: new-root `initialize` with explicit core/projectId and
  optional automatic flag; status/cancel; revision-guarded forget/rollback/discard;
  bounded conflict listing/proposal inspection. Initialization still requires the
  separate existing exact-root permission and refuses any existing root.
- `agent_memory_reflect`: a bounded explicit assignment to the same native writer
  used by configured automatic reflection. No caller role/model/root/lease flag.

Automatic reflection is opt-in (`automatic: true`). Observed interactive/RPC input
must still match one newly appended native user entry; it is not authenticated
human identity. Episodes retain bounded assistant text/tool names, selected local
check outcomes/results, branch-linked entry hash and observation time. They omit
reasoning, tool arguments, arbitrary reads/recall payloads and imported transcripts.
Only narrow `pnpm check/test` and `node --test` commands contribute selected result
text. Sensitive/oversized/uncertain capture is rejected or omitted. Source screening
is not semantic truth or complete secret detection. Pending episodes survive
sessions; only successful native completion/integration advances reviewed IDs.

A writer has an isolated 120-second view and eight native turns. Its tools cannot
read another project, run Bash or write product/HOME files. Commit marks readiness;
the parent integrates only after actual completed service status, healthy matching
generation/permissions/branch/config and native session-file binding. Foreground
input, session navigation/shutdown, cancellation, expiry and revocation invalidate
publication. Failed/conflicting jobs do not advance review progress. There is no
idle retry/inference loop; pending evidence is retried on a later qualifying turn
or explicit assignment. Main drafts have ten-minute leases and per-file CAS.

Forget and rollback affect only the mapped current project plus intentionally global
Core/index/procedures; other projects' deferred files are preserved. Managed ledger
version 2 stores source tombstones as `{project, source}` pairs: a project ID applies
only to that project's deferred files/episodes, and `null` applies only to global
files. Unknown or reused source IDs do not grant cross-project authority. A source
crosslinked to a global file intentionally affects that shared file, including when
another project later recovers it. Version 1 managed ledgers fail closed; this
new-root format does not automatically migrate existing roots or change the C1 store.
The full proposed ledger is reader-validated before worktree/index/HEAD mutation.

Forgetting records monotonic path/source tombstones. Global/deferred/procedure files linked
to forgotten sources are removed conservatively. For Core/index, Main first revises
the knowledge and removes that source link, preserving identity; forgetting otherwise
refuses rather than blanking identity. Rollback filters all current tombstones and
retains the current safe Core/index instead of restoring a source-forgotten version.
Stale views cannot restore forgotten paths or linked sources. Unlinked paraphrases
cannot be proven forgotten structurally; model maintenance and human privacy review
remain necessary. Old Git revisions, proposals and evidence are not secure erasure.

Every primary `before_agent_start` rereads committed Core, index and filename
metadata only, not all deferred bodies. The latest system projection replaces the
old managed block; a missing/revoked capability removes that block. Committing is
not reported as an already-updated provider request. Worker prompts are replaced
independently and never receive the primary projection automatically.

## Explicit activation/migration and remaining proof

Source installation registers tools, not write authority. Nothing in this source
run modifies the real curated bootstrap, real corpus, runtime roles, profile,
authentication, provider defaults or active apps. No default root is created.

For a controlled proof, use a new ignored private store and a project-owned native
fixture profile. The canonical node's `managedMemory.permission(root)` supplies
`managed_memory_<sha256(exact canonical root UTF-8)>`; grant that scalar explicitly
and grant only the five scoped tools. Do not grant arbitrary external writes or
reuse `continuity_learning_*`. Register the reviewed writer in that fixture's
native agents directory, with the existing subagents package excluded from children
but guards/permissions/memory extension retained. Initialize with a reviewed seed.
Removing that permission immediately disables memory access/projection and cancels
publication on subsequent guarded activity; no blanket external-write grant remains.

Before real default activation, Main must preserve a private bootstrap snapshot,
compare the full current identity/preferences, choose one canonical authoring copy,
review project mappings, initialize a **new** root, explicitly register the role and
grant its exact permission, then prove existing/fresh native context behavior.
Only then may an explicitly approved bootstrap migration remove duplicate current
knowledge. Rollback removes the new grant/role activation and restores the preserved
bootstrap; do not silently overwrite an existing root or alter real data in tests.

Offline commands: `node --test --test-concurrency=1 test/agent-memory-*.test.ts`;
from this repository, `pnpm check:public-sdk` (also required by `pnpm check`). The latter uses actual public
SDK/native subagent dispatch and project fixtures, with injected Faux transport and
zero external inference. It does not use a fake HOME or real credentials, and keeps
receipts only under this project's ignored runtime directory.

For **real-provider** proofs, keep the real `sdk.getAgentDir()` and authenticated
HOME unchanged. Capture native default provider/model/thinking settings and create
the ordinary `sdk.ModelRuntime`; omit `createAgentSession` model/thinking overrides.
Use controlled in-memory parent settings and project-local `.pi/settings.json`,
`.pi/agents/`, `.pi/subagents.json` and
`.pi/extensions/pi-permission-system/config.json` for fixture resources. Exclude
unrelated packages and the subagent extension from children, retaining guards,
permissions and the memory package. Match the owned CLI process cwd to the SDK
fixture cwd: the pinned role registry and settings resolve `process.cwd()`.

Do not change `PI_CODING_AGENT_DIR` for a live fixture and assume passing the parent
ModelRuntime shares its credentials with children. The pinned native service
constructs a fresh child runtime from `<agentDir>/auth.json` and `models.json`.
The earlier recipe failed before child inference for precisely this reason. The
project-layer route reuses native credential resolution/refresh without copying
credentials, creating another auth profile or requesting a new login. Verify
exact write authority, locked role descriptor and native service with zero
inference before submitting paid prompts. Do not relabel the Faux fixture as live.

Retain actual transport/model metadata, pre/post memory revisions and failed
attempts. Have Main or the real native writer revise a supported preference/method,
then run a neutral task in a fresh native session without a
recall cue. Compare a genuine pre-learning baseline; if it already succeeds, claim
persistence/context only. Verify correction A→B, forgetting/rollback, no parent
corpus inheritance, cleanup and unchanged real Core/corpus/profile hashes. A local
Faux receipt cannot be relabelled live. Independent QA and Mahiro acceptance remain
outside the implementation lane; T190 is not marked done by these source checks.

### Controlled native proof — 2026-10-19

Main and an independent read-only verifier inspected the local ignored receipts
under `.agent-state/runtime/managed-memory-live-mvIyAX/`. `receipt.json` retains
the genuine baseline **45.2**, Main's natural correction and its Markdown/Git
publication (`d348644…`), plus the failed child-auth attempt. The second
`continuation-receipt.json` retains the failed project-role discovery attempt;
neither failure is counted as a completed writer. `preflight-receipt.json` then
verified authority/role/service with zero network requests.

The successful `cwd-aligned-continuation-receipt.json` records ordinary native
OpenAI `gpt-6.1-sol` / medium, eleven Responses HTTP-200 requests, a completed native
writer with ten tool uses and publication at `3cdd225…`. Main dispatched but did
not edit the worker's revision. The writer moved the private policy into
`deferred/project/billing.md`, replaced the index with discovery links and wrote
a generic verification procedure. Its symbolic rule is
`7 * ceil((unit_price * quantity) / 7) + 2`.

A new native session with no prior chat read that deferred file and answered
**51** to the identical neutral baseline query. The exact target 51 was absent
from maintained Markdown before the query, so this is not a stored-answer echo.
Seven named source/package hashes and the real bootstrap/settings hashes were
unchanged during this proof. Native OAuth refresh occurred; auth-byte invariance
is not claimed. Receipts are cooperative local evidence, not provider signatures.
The baseline predates harness resource repairs, so this is not a perfectly
configuration-matched causal experiment.

This demonstrates controlled Main maintenance, real native background revision
and fresh-session policy use. It does not establish unrestricted automatic
learning, within-loop prompt refresh, complete corpus migration, real default
activation or Mahiro's daily-primary acceptance. Those boundaries remain open.

### Existing-memory compatibility before activation

Metadata-only inspection of six named active Letta memory files found, among
others, coding preferences of 54,658 bytes and workflow of 47,432 bytes. A 32-KiB
Core ceiling cannot preserve either verbatim. `global/` therefore owns substantial
cross-project detail rather than misclassifying it as procedures, duplicating it
per project or dropping rules to fit a tiny demonstration seed. This additive
namespace was added after the controlled project-policy provider proof above.

The earlier shared-detail fixtures used explicit private budgets of 65,536 bytes
per detailed file and 262,144 bytes total; those fixtures remain regression checks,
not today's configured ceilings. They preserve the two full input sizes and prove
discovery without body injection, cross-project shared reads, foreign-project denial,
global source forget/non-revival and preservation of another project's reused source.
This is storage/scope compatibility evidence, not proof of a completed semantic migration.
At that pre-activation checkpoint no real memory content had been copied. The
subsequent explicit approval, mapping and real cutover are recorded in
`docs/integrations.md`; these earlier fixtures are not its deployment evidence.

The metadata inventory is **281 tracked Markdown files / 3,607,826 bytes**, largest
145,763 bytes; the six active system files total 123,717 bytes. These counts do not
classify every document as current knowledge. Its count/byte shape now fits the
explicitly configured envelope, as synthetic tests below demonstrate; no real-tree
semantic mapping or import is implied. Preserve
the existing screened C1 history/reference corpus without re-promoting it as current
instructions. A real migration must map each current owner and resolve links,
budgets and current-versus-historical provenance before copying; do not silently
truncate, mass-summarize or drop data to fit. The supported initial active-system
mapping is concise identity/safety/routes in Core and complete detailed shared
preferences in `global/`, with project knowledge promoted at its owned scope.
Broader maintained-tree migration still needs a reviewed current-owner/link/provenance
mapping and explicit activation approval.

### Synthetic capacity proof — 2026-10-19

The opt-in scale checks use generated Markdown only, never the actual Letta tree.
The realistic shape is **281 maintained files / 3,607,826 UTF-8 bytes**, including
Core/index, with a 145,763-byte largest detail. This deliberately tests the known
inventory's count/size shape, not its semantic disposition. The maximum shape is
**512 files / 8,388,608 bytes**, including Core/index, with a 262,144-byte detail.
Both use escape-heavy valid Markdown, publish through the real store/Git owner,
restart and compare every whole-file hash, correct at constant byte size, roll back,
preserve an overlapping large proposal, then explicitly recover/discard it. Ordinary
regressions cover 513 files, one-byte file/total/ledger overflow, exact 40-MiB view
reads and one byte over, both-copy validation, stale config and privacy/authority
behavior. A runtime fixture reads all 145,763 bytes of mixed astral/Thai detail in
17 Unicode-code-point pages (68,606 code points) with stable whole-file hashes.

Git snapshot loading now preflights immutable blob sizes and reads at most 1 MiB
per `cat-file --batch`, retaining the 2-MiB output bound. Every command still checks
Git metadata and permissions; no metadata-security result is cached. The overall
snapshot deadline remains 15 seconds, including metadata walks, and each command
uses the smaller of the remaining deadline and the unchanged 10-second Git bound.
No hooks, symlink/hardlink checks or provider/worker limits are disabled.

Serial Node 22.22.3 stress measurements on the implementation host (phase times
exclude fixture teardown; RSS is the cumulative process high-water mark, not a
per-operation allocation claim):

| Synthetic run | Snapshot | View creation | Integration | Scenario wall time | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Realistic, including conflict recovery | 118 ms | 278 ms | 906 ms | 7.993 s | 634,656 KiB |
| Maximum, including conflict recovery | 216 ms | 546 ms | 1,696 ms | 15.583 s | 1,188,080 KiB |
| Maximum plus 64 retained proposals | 218 ms | 532 ms | 1,763 ms | 14.262 s | 1,477,648 KiB |

The retained-view run stores 64 complete serialized base/proposal conflicts, with
one selected physical draft directory; it is not 64 fully materialized draft trees.
Inspection hydrates up to eight selected conflicts serially (1,251 ms); refusal at
65 takes 7 ms; explicit discard then cleanup takes 452/739 ms and preserves the
other 63 conflicts. The maximum canonical serialized view is 33,586,387 bytes
(realistic 14,448,937). RSS is substantial even without retaining 64 parsed corpora:
there is **no hard product RSS guarantee**. A separate 384-MiB V8-old-space run
passes the same retained-proposal scenario at 885,088 KiB peak process RSS; that
process-local test flag is not a production setting, nor an RSS cap.

Reproduce serially with `MAHIRO_MEMORY_SCALE=realistic`, `max`, or `retention`
prefixed to `node --test --test-concurrency=1 test/agent-memory-capacity.test.ts`.
The opt-in runs write dated, source/test-SHA-bound local JSON receipts under ignored
runtime state and remove their synthetic stores; ordinary checks skip these three
heavy cases. Selected receipts are `managed-memory-scale-realistic-5846.json`,
`managed-memory-scale-max-11118.json`, `managed-memory-scale-retention-17908.json`
and the bounded-old-space `managed-memory-scale-retention-23281.json`, all under
`.agent-state/runtime/`. The existing provider receipts remain historical evidence for their
recorded old source hashes, not capacity/provider replays.

The 131072-byte ledger still rejects excessive metadata combinations even when
content fits 8 MiB; no maximum-every-axis promise is made. Main closed the former
4096-only conflict preview: `agent_memory_manage` with `action: conflicts`,
`target` and `path` accepts Unicode `offset` and `limit` (1–4096). Each page returns
the offset, total character count and whole-proposal hash. Paging without a selected
conflict file or with malformed bounds fails closed; scope, node authority and
forget controls still apply. Read every page before reconstructing the proposal,
then obtain the current file CAS hash, edit/commit and explicitly discard the old
conflict. No direct access to private draft filesystem paths is required.

A fresh independent verifier reconstructed a 136,012-byte / 64,012-code-point
proposal in sixteen pages through registered tool execution and published it using
current CAS, with snapshot equality afterward. Foreign selection, revocation,
unhealthy/replaced nodes and forgotten-proposal paging were rejected. The permanent
runtime regression includes reconstruction and actual CAS recovery. Current native
SDK/Faux dispatch also passed with zero external requests; that smoke did not
specifically invoke conflict paging through Faux. Registered execution and inspected
native-wrapper passthrough cover the new fields, not a paid-provider paging replay.

The independent maximum-retention run measured 216-ms snapshots and 1,378,736-KiB
peak RSS (1,411,825,664 bytes from the OS timing tool). It covers 64 serialized
proposals, not 64 complete physical draft trees. Synthetic snapshots/text and
serialized backing strings contribute to that peak; the implementation does not
retain 64 parsed corpora. This is scoped functionality/performance evidence, not
steady-state product RAM acceptance or a hard memory guarantee. RAM-sensitive
daily-companion acceptance remains explicitly open.
Those synthetic capacity runs did not change real content, default root,
bootstrap, profile or roles. The later approved real cutover is a separate lane
owned by the current activation section in `docs/integrations.md`.

## Delivery gates

- Preserve existing imports, privacy controls, correction/forget/rollback, authored
  UI, provider/account settings and personal role definitions.
- Prove store operations, layout/budgets, traversal/symlink rejection, stale writes,
  authority separation, revocation, writer isolation/conflicts and recovery.
- Prove public native context/tool and worker integration without inference first.
- Then run a bounded native default-provider transaction: Main or a real worker
  writes maintained knowledge; a fresh session performs a different task using
  it without a recall cue. Preserve pre/post revisions and actual transport/model
  evidence. A synthetic runtime test cannot be relabelled as live provider proof.
- A baseline already succeeding does not establish learning. Show a real behavioral
  contrast, or report the narrower persistence/context result honestly.
- Run repository formatting, relevant tests and one final serial canonical suite
  per touched repo; obtain fresh independent verification from a separate session.
- Human primary-companion acceptance remains Mahiro-owned. Do not mark T190 done
  or imply complete Letta parity from one controlled example.

## Boundaries for this run

Implement all Pi source and narrow authority capabilities in this repository's `lib/guards/`. Do not require or modify the historical Mods Pi adapter, original Letta entries, upstream host internals or installed dependencies. Keep
one writer across these source boundaries and serialize heavy checks.

Keep experiments and receipts under ignored project runtime state. Reuse the
existing authenticated HOME read-preserved, never copy credentials or invent a
different auth profile. Do not overwrite real Core/bootstrap/corpus or silently
enable a new global write permission during fixture proofs. Any default-root
migration/activation must be explicit, reversible and supported by current data
and permission evidence, not inferred from a test-store success.

No product commit, push, tag, release, provider substitution, broad installation
or destructive cleanup is authorized by the long-run request. Internal commits
inside an explicitly authorized private memory store are memory revisions, not
product-source commit permission.
