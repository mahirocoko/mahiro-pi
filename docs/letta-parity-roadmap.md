# Letta maintained-memory parity roadmap

[← Documentation](README.md) · [Memory contract](agent-memory.md) · [Development](development.md)

[R0 contract appendix](letta-parity-r0.md) owns detailed pins, the 28-gap owner map,
selected source directions and evidence worksheets; this roadmap owns status and scores.

## Scope and authority

This is the canonical **current planning, parity status and scoring owner** for
Mahiro Pi's full maintained-memory product: storage, discovery, reflection,
publication, recovery, operator workflows, Palace and guidance. It is not a plan
to reproduce the whole Letta app, hosted backend or every command and skill.
[Memory](agent-memory.md) still owns the implemented live contract;
[agents](agents.md) owns roles and skill boundaries. Source and observed runtime
outrank prose, phase names, green test counts and percentages.

Current checkpoint baseline: **2026-10-30**, Mahiro commit
`f46cade7e3c984981b5eeb55eb68a4a610b45ba2`. It freezes the experimental
Palace/context source and this roadmap without claiming installed integration,
rendered acceptance or parity. Scores remain unchanged pending a differential
re-audit and completed evidence gates.

The original B0 baseline was **2026-10-29**, Mahiro commit
`7c4169477fcacc472018678848f74342173de2b2` plus the audited dirty working tree.
B0's dirty-source identity remains **unfrozen/unavailable**: the original audit
did not capture an immutable whole-dirty-tree manifest. That commit alone is
insufficient to reproduce the audited dirty Palace/context/identity work. A
later manifest or checkpoint cannot retroactively identify that earlier tree.
The read-only 28-gap audit is supporting local evidence at
`.agent-state/runtime/memory-v012/letta-v03431-full-parity-audit.md`; it is ignored
operator evidence, not a public prerequisite or a new authority. The durable gap
mapping and gates below preserve its actionable conclusions without copying
private corpus or runtime payloads into source.

Reference: Letta Code **v0.34.31**, commit
`a8900b882446d7aa99fedf2845d400743affd1b6`; previous comparison pin
`5dea67021b99810707ff753db35e4534f70ff1fd`. Most MemFS v2, reflection and Palace
architecture predates the latest pin. The material latest-source deltas are
config-root isolation/security consistency and Git child/helper termination.
Executable source wins over source-guide contradictions, including failed
reflection integration cleanup.

A means **match closely**, B means **adapt the outcome**, C means **do not copy
exactly**. R0's [selected source directions](letta-parity-r0.md#selected-source-directions--r0-03)
record dispositions on 2026-10-30; implementation and later acceptance remain gated.
Mahiro's exact-root authority, fallible-memory doctrine, private worker views,
bounded tools, logical forgetting and preserved uncertainty are intentional
constraints, not obstacles to remove for a score. No section authorizes Phase I,
a live cutover, profile changes, a commit, release or new skill installation.

## Current verdict

**NOT ALIGNED.** Current editorial assessments are **60% source-capability
coverage** and **30% evidence-backed end-to-end parity**. Both are rounded,
weighted planning summaries, not objective equivalence, benchmark results,
performance, learning quality or human acceptance.

The live ABI1/ABI2 product has substantial authority, projection and writer
infrastructure. The local Git/worktree, trajectory, model-worker, projection,
forgetting, migration and Palace experiments remain disconnected from installed
routing. Synthetic completion is not an installed end-to-end product. The checkpointed
Palace context DTO is a partial repair with fixture/unavailable context, not
command-time capture from the invoking session. `/mh-memory palace` remains a
bounded JSON diagnostic. Mahiro accepted the roadmap direction on 2026-10-30
and authorized continued repository write/test/checkpoint execution. R0 is active;
Phase H continuation and Phase I remain paused until their own gates pass.

## Scoring method

There are two views of the same nine weighted domains:

- **Source capability** estimates implemented behavior against the agreed user
  outcomes. Similar names, planned work and test quantity earn no points.
- **Displayed/evidence parity** weights evidence layers: source **50%**, installed
  integration **20%**, observed runtime **20%**, human acceptance **10%**. For a
  domain, sum layer coverage times those weights. Source includes contract review,
  local regressions and latest-source differential; these are distinct evidence
  types within that layer, not extra installed credit.
- Missing evidence earns **zero credit**, but means unestablished, not automatic
  behavioral failure. Documentation and tests cannot claim installed, observed
  runtime or human credit. Faux integration is source/SDK evidence unless the
  claimed installed seam itself is independently established.
- Aggregate with the domain weights below, then round to the nearest **5
  percentage points**. Do not round intermediate calculations when recalculating.
  Baseline source values total 61.5%; half-source evidence totals 30.75%; these
  display as 60% and 30%. The per-domain displayed baseline is source × 50%.
- Planned work earns zero. A deliberate C exclusion earns no implementation
  points and needs explicit approval. Do not silently drop its denominator;
  record any approved scope/denominator change as a new baseline.

### Domain scorecard

Confidence labels are qualitative evidence confidence, not statistical intervals:
**moderate/low** means credible audited source with unestablished end-to-end
proof; **limited/low** also signals unresolved semantic or integration choices.
No high-confidence installed or human claim is made by this baseline.

| Domain | Weight | Source | Displayed/evidence | Confidence (source/end-to-end) | Rationale | Next-band condition |
| --- | --- | --- | --- | --- | --- | --- |
| Storage/schema/forgetting | 10 | 70% | 35% | Moderate/low | Revisioned Markdown/Git and tombstones exist; tiered schema is not Letta root/index semantics. | R1 mapping and R6 non-resurrection fixtures establish another source band; installed seed/rollback proof needed above source-only credit. |
| Projection/retrieval | 15 | 80% | 40% | Moderate/low | Committed projection and bounded reads exist; selection and deferred navigation differ. | R1 differential fixtures prove core selection and future-request discovery; R4 proves next-request visibility. |
| Reflection/trajectory/progress | 20 | 40% | 20% | Limited/low | Filtered episodes differ from trajectory; synthetic step-count counts entries; replay/watermarks diverge. | R3 proves assistant-step, captured-range, no-op/failure/replay semantics; R4 observes the installed route. |
| Writer/publication | 15 | 80% | 40% | Moderate/low | Identity-bound native writer and guarded publication exist; local coordinator is disconnected. | R4 proves one authorized session-to-writer-to-publication slice, including conflict and no-learning outcomes. |
| Recovery/concurrency/lifecycle | 10 | 60% | 30% | Moderate/low | Generation/drain and uncertainty preservation exist; repair-needed has no terminal recovery. | R5 proves repair/abandon, crash outcomes, root isolation and helper settlement without weakening uncertainty. |
| Commands/migration/operator workflows | 5 | 50% | 25% | Limited/low | Shadow export/seed is not active migration, backup/restore or cutover. | R6 demonstrates distinct operator jobs, truthful state labels and tested rollback; installed proof separately cited. |
| Palace/context/history | 10 | 40% | 20% | Limited/low | Synthetic preview and context DTO are not live invocation context or Git knowledge history. | R7 binds a read-only invocation snapshot, active-memory attribution and separate knowledge/lifecycle history. |
| Memory skills/guidance | 10 | 60% | 30% | Moderate/low | Writer has substantial curation guidance; dedicated job delivery is uneven and admission undecided. | R2 G-SKILL job evaluations improve guidance and access without authority expansion; human longitudinal quality remains separate. |
| Authority/privacy/isolation | 5 | 80% | 40% | Moderate/low | Exact-root private views and narrow tools are strong; threat models differ and live integration is absent. | R8 matrix plus R4/R5 negative installed evidence prove effective boundaries, not optional sandbox assumptions. |
| **Overall** | **100** | **60%** | **30%** | **Limited end-to-end evidence** | **Rounded editorial weighted assessment.** | **Only cited layer evidence and fresh verification can move the baseline.** |

### Maintained update protocol

1. Freeze a baseline with date, Mahiro commit plus dirty-diff identity if relevant,
   Letta commit/version and previous pin. Retain old baselines in Git; do not
   overwrite historical release records or pretend the initial dirty tree was
   committed evidence.
2. Record checklist IDs, exact source owners/lines or symbols, fixture/test names,
   command/result/date and immutable revision or receipt identity for every
   completed gate. Public evidence summaries must omit private paths, corpus,
   credentials and transcripts. Local runtime receipts stay private/ignored.
3. Maintain a per-domain evidence worksheet: accepted outcome, A/B/C decision,
   source coverage, installed coverage, observed-runtime coverage, human coverage,
   confidence, missing/failed evidence and next-band condition. Missing and failed
   evidence must be distinguishable. Checkboxes alone never supply credit.
4. Recalculate after an approved contract change, material implementation or new
   layer evidence, or a new upstream pin/differential. No automatic increase for a
   phase name, doc edit, suite count or planned delivery. Regressions and revoked
   evidence can reduce scores. Keep weights fixed absent explicit scope approval.
5. Show old/new domain values, unrounded weighted totals, rounded totals, reasons,
   checklist IDs and evidence references in the revision record. No silent
   percentage edits; update this owner before summaries in other docs.
6. A **fresh verifier** must challenge material score movement against the actual
   final source and cited layers. Mahiro alone supplies human acceptance. Resolve
   contradictions before claiming a higher band; record unresolved disputes.

| Revision | Date | Baseline and reference | Score/source → evidence | Evidence and disposition |
| --- | --- | --- | --- | --- |
| B0 | 2026-10-29 | Mahiro `7c4169477fcacc472018678848f74342173de2b2` + audited dirty tree; Letta `a8900b882446d7aa99fedf2845d400743affd1b6` / v0.34.31 | 60% → 30% | 28-gap read-only audit; source-only credit. B0 dirty-source identity unfrozen/unavailable: no immutable whole-dirty-tree manifest was captured; the commit alone is insufficient. Roadmap direction and phase exits were not accepted at B0. |
| B1 | 2026-10-30 | Mahiro `f46cade7e3c984981b5eeb55eb68a4a610b45ba2`; same Letta pins | 60% → 30% | Immutable experimental Palace/context and roadmap checkpoint. R0-00 candidate evidence and R0-H direction acceptance recorded. No score movement: latest-source re-audit, installed/runtime evidence and later phase exits remain open. |

## Roadmap and evidence gates

Stable IDs identify outcomes, not current progress. Unchecked boxes remain open;
writing the plan alone does not complete them. R0 decisions precede implementation;
R1–R3 specify semantics before R4; R5 safety blocks any live R4 activation;
R6 and R7 build on a proven integration seam; R8 evaluates the complete system.
Specification and source fixtures may precede installed authorization. For every
phase, **S/I/O/H** means source, installed integration, observed runtime and human
exit evidence. An unapproved I/O/H gate stays pending; a source exit is not a full
phase exit. C/non-applicable exits require an explicit reason and approval, not a
passing checkbox.

### R0 — Canonical contract and latest-source differential

Dependencies: none. Moves: all domains' evidence accuracy; no implementation
credit for this specification. Audit gaps: 1–28, especially 11, 12 and 28.

- [x] **R0-00** 2026-10-30: captured current-candidate evidence, excluding private
  corpus, at base HEAD `7c4169477fcacc472018678848f74342173de2b2`.
  Tracked diff SHA-256:
  `f4513d4e32910885336d36d914e3b1f7ce24ed35d5a25a44d5ea4d7d8495f57a`.
  Untracked manifest SHA-256:
  `bce6ac71e8b70a235a30495d506a7748dbdd0628d897b9b3552127528ebf8188`.
  Ignored manifest: `.agent-state/runtime/memory-v012/checkpoint-2026-10-30/manifest.json`.
  This does not retroactively identify B0's earlier audited dirty tree; its
  provenance limitation remains. Semantic changes require re-audit against the
  frozen source before material score movement.
- [x] **R0-01** 2026-10-30: [28-gap owner map](letta-parity-r0.md#complete-audit-gap-map--r0-01)
  records executable owners in both repositories, user outcomes, selected A/B/C
  dispositions, dependencies and closure evidence; executable cleanup wins over guide prose.
- [x] **R0-02** 2026-10-30: [latest-source differential](letta-parity-r0.md#latest-source-differential--r0-02)
  separates pre-existing contracts from config-root/helper deltas and provides
  reproducible read-only Git commands; no upstream execution claimed.
- [x] **R0-03** 2026-10-30: [selected source directions](letta-parity-r0.md#selected-source-directions--r0-03)
  record schema, ABI2-preserving seam, trajectory, assistant-step policy, recovery,
  snapshot and zero-new-skill decisions with rejected alternatives and risks.
  This is source selection, not installed or human product acceptance.
- [x] **R0-04** 2026-10-30: [nine-domain worksheet](letta-parity-r0.md#evidence-classes-and-acceptance-worksheet--r0-04)
  defines L/D/N/I/O/H, falsifiable cases, evidence identity and scoring boundaries.
- [x] **R0-S** 2026-10-30: fresh read-only verification passed the owner map,
  pins, differential, gap coverage, selected semantics, worksheets and sanitized
  installed claims with no high/medium finding. One low assistant-step owner
  reference was corrected; implementation and human gates remain open.
- [x] **R0-I** 2026-10-30: [sanitized installed inventory](letta-parity-r0.md#sanitized-installedruntime-observations--r0-i--r0-o)
  identifies package, completed receipt, selected ABI2 surface and grants;
  disconnected local-service/HTML installation is not established.
- [x] **R0-O** 2026-10-30: same record reports successful bounded Discovery v2
  namespace/revision reads and manage/status unavailable, reason `unknown`.
  Observation completeness is not status-health success or writer/publication proof.
- [x] **R0-H** 2026-10-30: Mahiro accepted the roadmap direction and authorized
  continued repository write/test/checkpoint execution after reviewing the
  checkpoint plan. Specific A/B/C decisions remain tracked under R0-03. This does
  not authorize push, tag, release, profile/install mutation, live cutover or
  Phase I, nor supply later human-only product/visual acceptance.

Non-goals: code changes, private-corpus migration, activation, upstream execution,
release or acceptance by percentage.

### R1 — Schema, projection and discovery decision

Dependencies: R0 schema/authority decisions. Moves: storage/schema/forgetting,
projection/retrieval. Audit gaps: 2, 3, 13, 14, 20, 27.

- [ ] **R1-01** Choose retained Mahiro Core/index/persona/project schema or a
  reviewed Letta root `MEMORY.md`/root-Markdown/nested-index mapping. Specify
  bidirectional mapping, unsupported paths and collisions; never call tiered v2
  Letta-compatible merely because both use the name v2.
- [ ] **R1-02** Define automatically projected versus deferred versus excluded
  content, project identity, ancestor discovery cues, ordering and byte budgets.
  Keep skills separate; distinguish committed, draft, integrated and active prompt.
- [ ] **R1-03** Specify directory/read/search outcomes with bounded paging,
  descriptions, stale handling and exhaustion. Build future-request discovery
  examples where relevant detail is found without injecting the whole corpus.
- [ ] **R1-04** Design synthetic differential trees for root/nested files, absent
  indexes, mixed legacy layouts, forgotten path/blob/source, stale revisions,
  Unicode/paging and contradictions. Mechanical retention is not semantic proof.
- [ ] **R1-S** Source fixtures compare the chosen outcomes against both pinned
  owners, including deliberate deviations and non-resurrection.
- [ ] **R1-I** An authorized installed synthetic root projects exactly the agreed
  subset and refuses unauthorized/stale reads with unchanged private memory.
- [ ] **R1-O** Observe discovery and next-request refresh on approved surfaces;
  confirm a viewed draft is never mislabeled active prompt truth.
- [ ] **R1-H** Mahiro accepts discoverability, compactness and schema trade-offs
  using representative request tasks, not matching filenames alone.

Non-goals: renaming or migrating the private corpus for terminology, embeddings,
whole-corpus injection or broad worker filesystem access.

### R2 — Selective memory-skill admission and guidance quality

Dependencies: R0 scope and R1 discovery contract for deferred guidance. Moves:
memory skills/guidance; projection/retrieval only with separate behavioral proof.
Audit gaps: 21, 26, 27. Apply [G-SKILL](#g-skill-admission-gate) per candidate.

- [ ] **R2-01** Evaluate the six user jobs below against existing writer, role,
  runtime, docs and skill owners; identify delivery/trigger gaps before new files.
- [ ] **R2-02** Review upstream guidance closely, preserving useful constraints
  and examples. Name each minimal adaptation and why the native contract needs it;
  reject customization that weakens the original job.
- [ ] **R2-03** Decide each candidate through G-SKILL, including existing-owner
  and exclude outcomes. Obtain explicit scope before creating or installing any
  skill; zero new skills is a valid result.
- [ ] **R2-04** Specify trigger/refusal fixtures for synthesis-not-logs,
  contradictions, reasons, examples, shrink-before-grow, one-home placement,
  request-shaped cues, unavailable tools and inconclusive/no-edit diagnosis.
- [ ] **R2-S** Review guidance and negative fixtures by job, with preserved
  upstream contracts and explicit tool/authority deltas; do not score file count.
- [ ] **R2-I** Verify only approved guidance is discoverable at the intended job
  boundary and actual tools/routes exist; no inherited skill-mutation authority.
- [ ] **R2-O** Observe bounded job delivery, correct refusal and useful no-edit
  outcomes without broad filesystem, cloud or profile changes.
- [ ] **R2-H** Mahiro reviews longitudinal synthesis and future-request utility;
  source text quality and test passes alone do not prove learning.

Non-goals: copying all Letta skills, automatic skill installation or allowing the
memory writer to create procedures in another owner's skill namespace.

### R3 — Reflection, trajectory, watermark and replay semantics

Dependencies: R0 trigger/privacy decisions; R1 projection expectations; R2 quality
criteria inform worker output. Moves: reflection/trajectory/progress,
writer/publication. Audit gaps: 4–8, 26–28.

- [ ] **R3-01** Specify observation, eligibility, launch, settlement and progress
  as separate states. Letta's effective fresh default is step-count **25** from
  settings-manager, not the compaction-event helper fallback; explicitly choose
  Mahiro's policy, off behavior and per-session/conversation settings.
- [ ] **R3-02** Count completed assistant steps, not every trajectory entry, or
  explicitly rename the policy entry-count and record the parity departure.
  Cover user/assistant/tool-heavy sequences and repeated callbacks.
- [ ] **R3-03** Define canonical IDs/ranges, captured end snapshot, bounded
  user/assistant/tool/error evidence, redaction, reasoning privacy and retention.
  Do not equate filtered eligible episodes with a full Letta trajectory.
- [ ] **R3-04** Specify recent/automatic/manual/cross-conversation selection,
  deliberate replay and retry separately. Historical text remains untrusted;
  replay must not advance ordinary progress or grant preferences/permissions.
- [ ] **R3-05** Build state-machine cases for late append, compaction overlap,
  no-learning/no-op, cancellation, provider failure, conflict, restart, duplicate
  settlement and replay; advance only through the captured accepted range.
- [ ] **R3-S** Differential fixtures expose the all-entry counting defect and
  prove selection/watermark semantics, privacy filtering and bounded payloads.
- [ ] **R3-I** An approved installed synthetic journey proves actual hooks select
  and launch the intended writer exactly once under the chosen settings.
- [ ] **R3-O** Observe progress before/after success, no-op, failure and replay,
  showing no skipped late experience or duplicate consumption.
- [ ] **R3-H** Mahiro accepts cadence, privacy and experiential usefulness,
  including honest limitations of omitted evidence.

Non-goals: collecting arbitrary transcripts, exposing reasoning, adopting hosted
reflection or treating replay as current authenticated instruction.

### R4 — One installed end-to-end integration slice

Dependencies: R0–R3 source contracts; R5 safety design/source gates before live
activation; explicit installed scope and rollback approval. Moves:
writer/publication, reflection/trajectory/progress, projection/retrieval,
authority/privacy/isolation. Audit gap: 1 and cross-cutting 28.

- [ ] **R4-01** Select one primary/session/revision/root-bound seam: Pi settled
  session → eligible trajectory → confined writer/worktree → coordinator
  integration → committed projection → next primary request. Name each owner.
- [ ] **R4-02** Decide whether/how the local service joins the product; preserve
  ABI2 authority until an explicitly approved replacement and rollback exist.
  Do not add a parallel knowledge owner or imply ABI3 from experiments.
- [ ] **R4-03** Specify readiness, permission loss, locked route, private view,
  no-learning, conflicting proposal, revocation and stale-generation behavior.
  Record provider authorization separately from Faux transport.
- [ ] **R4-04** Prepare disposable synthetic roots and an exact rollback plan;
  bound state and cleanup only newly owned fixtures. Define success receipts
  without storing private corpus in public source.
- [ ] **R4-S** Source/SDK tests prove dispatch binding and negative boundaries;
  a fresh verifier checks the seam is actually imported/selected where claimed.
- [ ] **R4-I** Explicitly install and verify routing/grants in an authorized
  disposable profile; prove the complete slice, not isolated component APIs.
- [ ] **R4-O** Observe actual success/no-op/failure/conflict journeys and next
  request visibility on each claimed TUI/RPC/headless surface; untested surfaces
  remain unclaimed. Record provider-backed versus deterministic runs separately.
- [ ] **R4-H** Mahiro accepts the bounded outcome and rollback demonstration;
  no daily-primary or complete parity acceptance is implied.

Non-goals: broad live migration, default changes, profile edits without separate
approval, release or connecting every experimental feature at once.

### R5 — Repair, recovery, concurrency and helper lifecycle

Dependencies: R0 recovery decisions; R3 progress state machine. Safety source gates
block R4 activation; installed exercises use R4's approved seam. Moves:
recovery/concurrency/lifecycle, authority/privacy/isolation, writer/publication.
Audit gaps: 9–12.

- [ ] **R5-01** Define authority-reviewed repair-needed → repaired/abandoned
  terminal transitions, retry eligibility and retained conflict evidence. Never
  auto-merge semantic conflicts or equate abandoned work with consumed trajectory.
- [ ] **R5-02** Compare Letta abort/cleanup/retry behavior against Mahiro
  uncertainty retention. Specify crash matrices at lease, worktree, write,
  publication, rename, watermark and drain boundaries, including restart.
- [ ] **R5-03** Define same-process and cross-process concurrency limits,
  generation identity, revocation, tokenized claims and stale callbacks. PID or
  dead-parent evidence alone must not erase unknown publication outcomes.
- [ ] **R5-04** Audit config-root resolution across installer, kernel, memory,
  agents, viewer, guards and test owners: relocated data/protection roots agree,
  relative/legacy-root behavior is explicit and alternate roots do not bypass policy.
- [ ] **R5-05** Audit bounded Git output/deadlines and HTTP/SSH child/helper
  teardown per supported OS; prove settlement before cleanup or lock release.
  A timeout return alone is not proof all descendants terminated.
- [ ] **R5-S** Fault/state-machine fixtures establish recovery disposition,
  root-isolation negatives and helper-tree outcomes without weakened invariants.
- [ ] **R5-I** Authorized disposable installed fault actors exercise actual
  execution, permissions, generation overlap and recovery commands.
- [ ] **R5-O** Observe crash/restart/conflict/abandon and hung-helper outcomes;
  distinguish drained, retained and unknown states with bounded receipts.
- [ ] **R5-H** Mahiro accepts operator burden and uncertain-state handling;
  unavailable recovery must be honest rather than aggressively automatic.

Non-goals: hostile same-user tamper resistance claims for the local coordinator,
PID-based certainty, silent conflict deletion or blanket process killing.

### R6 — Migration, operator workflows and rollback

Dependencies: R1 mapping, R4 proven seam and R5 recovery. Moves:
commands/migration/operator workflows, storage/schema/forgetting,
recovery/concurrency/lifecycle. Audit gaps: 19, 20, 25.

- [ ] **R6-01** Inventory user jobs: inspect/configure reflection, select/replay,
  diff knowledge, export, backup, restore, migrate and rollback. Choose native
  command ownership by outcome, not Letta command spelling.
- [ ] **R6-02** Separate metadata export, content bundle, shadow verification,
  active migration, backup/restore and authority cutover. Define revision/hash
  consistency, paging completeness and refusal of stale or mixed bundles.
- [ ] **R6-03** Preserve forgetting policy across import, later seed, rollback
  and conflict recovery; tombstones are logical non-resurrection, not secure
  history erasure. Required compact files remain valid without exposing excluded blobs.
- [ ] **R6-04** Specify preview/apply consent, exact source/target identities,
  resumability, quiescent rollback and failure receipts. Preserve original memory
  and unrelated profile choices; never claim shadow completion as live migration.
- [ ] **R6-S** Synthetic fixtures cover partial seed, changed hashes, missing
  pages, root replacement, interrupted operations and forgotten material.
- [ ] **R6-I** An explicitly approved disposable installed rehearsal proves
  operator commands use the intended authority and can restore the prior route.
- [ ] **R6-O** Observe migration and rollback through the actual command path,
  including a refusal case and post-rollback next-request projection.
- [ ] **R6-H** Mahiro accepts clarity, safety and recovery instructions before
  any private-root migration or live cutover is separately considered.

Non-goals: automatic real-corpus migration, hosted pull/sync, treating a Git
archive as secure deletion or allowing rollback to resurrect forgotten knowledge.

### R7 — Live Palace, context and knowledge history

Dependencies: R1 snapshot semantics, R4 seam, R5 lifecycle and R6 operator labels.
Moves: Palace/context/history, projection/retrieval and operator workflows only
where directly evidenced. Audit gaps: 14–18, 24.

- [ ] **R7-01** Specify read-only installed invocation from the primary command
  context with session/revision/root binding, no ambient private-corpus lookup
  and no change to publication authority.
- [ ] **R7-02** Capture one immutable invocation context snapshot with model,
  session identity and public Pi context usage. Preserve unavailable states;
  never derive context usage from corpus bytes or preview fixtures.
- [ ] **R7-03** Attribute active memory from the actual projection owner;
  distinguish estimates from exact counts, deferred corpus from active prompt,
  committed/integrated state from working tree, and freshness from liveness.
- [ ] **R7-04** Add bounded Git **knowledge-change history** with commit identity,
  author/date/message, stats and safe diffs; separately retain job/publication/
  recovery lifecycle diagnostics. Do not rename job rows into Git history.
- [ ] **R7-05** Decide committed versus working-tree snapshot semantics and
  freshness at invocation. Preserve capability-loopback security, bounded paging,
  forgetting filters, CSP, drain and no arbitrary asset/file routes.
- [ ] **R7-S** Synthetic/differential fixtures prove DTO provenance, estimates,
  unavailable states, bounded history/diffs, lifecycle separation and stale refusal.
- [ ] **R7-I** Explicitly authorized installed command captures the invoking
  session rather than synthetic context and opens only its authorized snapshot.
- [ ] **R7-O** Observe active memory and real knowledge changes, forgotten-data
  filtering, stale/revoked requests, shutdown and no leaked capability/file access.
- [ ] **R7-H** Mahiro reviews rendered Context, core/deferred memory and both
  histories; accepts usefulness, visual behavior and RAM separately from tests.

Non-goals: continuing Phase H polish before roadmap approval, reproducing Letta's
HTML transport exactly, mutating memory from the viewer or claiming exact provider
token accounting from estimates.

### R8 — Threat model, verification and acceptance readiness

Dependencies: R0 decisions and source exits; installed/runtime exits R4–R7 for
complete-product readiness. Moves: authority/privacy/isolation and any domain
with newly established layers, never by blanket suite credit. Audit gaps: 22,
23, 26–28 and all unresolved evidence gaps.

- [ ] **R8-01** Publish a threat/outcome matrix for private views, tool/path
  confinement, native enforcement, subprocesses, optional OS sandbox, loopback
  access, untrusted trajectory and same-user limits. Identify tested enforcement
  and unsupported threats; a data subprocess is not an OS sandbox.
- [ ] **R8-02** Map every accepted A/B outcome to local regression, latest-source
  differential, SDK, installed, observed and human evidence. Track exclusions,
  untested surfaces, failures and residual risks explicitly.
- [ ] **R8-03** Obtain fresh verification against final source and receipts,
  recalculate scores by layer, challenge contradictions and retain old baselines.
- [ ] **R8-04** Define longitudinal synthesis/contradiction/discovery evaluations
  plus performance/RAM/I/O and context-estimate measurements with named workloads;
  do not invent efficacy from structural retention tests.
- [ ] **R8-05** Prepare a separate release-readiness decision with unresolved
  risks, rollback, installation and human gates. Release checks and any commit,
  push, tag, publish, profile activation or Phase I require new explicit scope.
- [ ] **R8-S** Fresh source/security review and explicitly authorized scoped
  checks verify the agreed matrix; report unrun heavy gates truthfully.
- [ ] **R8-I** Verify actual grants, routing and confinement for the claimed
  installed package/profile rather than source defaults alone.
- [ ] **R8-O** Collect bounded longitudinal and failure observations on the
  claimed surfaces; state provider, workload and environment limitations.
- [ ] **R8-H** Mahiro alone accepts daily-primary, product/visual quality, RAM
  and roadmap completion. Acceptance is recorded separately from score/release.

Non-goals: source tests as human acceptance, optional sandbox as universal safety,
whole-Letta parity or automatic release once a percentage is reached.

## Memory guidance and selective skill admission

The repository currently ships only the `git-commit` skill. The managed writer
already contains substantial curation guidance; roles, runtime and docs are valid
existing delivery owners. Installed user skills elsewhere are not package skills.
Do not copy every Letta skill. Equally, do not over-customize useful guidance until
it loses its reasons, examples or effectiveness. Close adoption or minimal
adaptation is preferable where the job and authority fit.

### G-SKILL admission gate

Apply all items to each proposed candidate; link the decision to R2 evidence.

- [ ] **G-SKILL-01 — User job:** Name the recurring request, intended user benefit
  and a representative future request that must succeed.
- [ ] **G-SKILL-02 — Existing owner:** Check writer, role, docs, runtime and skill
  owners first; demonstrate the underserved delivery/trigger gap.
- [ ] **G-SKILL-03 — Disposition:** Choose adopt closely, adapt minimally,
  existing owner or exclude. Zero new skills is valid; no bulk-import presumption.
- [ ] **G-SKILL-04 — Preserved upstream contract:** Record upstream pin, useful
  constraints, reasons, examples and intended outcomes that must survive.
- [ ] **G-SKILL-05 — Named deltas:** List only necessary native changes with
  rationale; review whether any adaptation weakens guidance quality.
- [ ] **G-SKILL-06 — Trigger/refusal tests:** Specify positive jobs, non-triggers,
  unsafe/unavailable-tool refusals and inconclusive/no-edit outcomes.
- [ ] **G-SKILL-07 — Tool/authority truth:** Verify actual native tools, owners,
  permissions and delivery path; no shell, cloud, profile or skill-mutation
  authority may be inferred from upstream prose.
- [ ] **G-SKILL-08 — Explicit scope approval:** Obtain Mahiro's approval of exact
  authoring/install scope and preserve separate role, skill and memory owners.

### Candidate dispositions

These are planning candidates, not authorization or claims that files exist.

| Upstream candidate | Proposed disposition | Contract to preserve / boundary |
| --- | --- | --- |
| `maintaining-core-memory` | Minimal adaptation candidate | Synthesis, not logs; reasons, contradictions, concrete examples and shrink-before-grow. Keep current instructions above memory. |
| `maintaining-deferred-memory` | Minimal adaptation candidate | One home, progressive disclosure, request-shaped discovery cues and verification against future requests. |
| `initializing-memory` | Existing agent/docs for now | Reconsider only if a recurring initialization job remains underserved; no overwrite of existing memory. |
| `syncing-memory-filesystem` | Existing runtime/docs owner | Native publication/recovery truth; no hosted sync implication or second authority. |
| `context-doctor` | Minimal adaptation candidate | Current external `skill-doctor` guidance points to an unavailable context-doctor; preserve bounded behavioral/structural diagnosis and inconclusive/no-edit outcomes, without changing that separate skill here. |
| `creating-skills` | Separate owner | No automatic memory-writer authority to author/install skills. |
| `managing-shared-memory` and cloud skills | Exclude unless separately requested | No organization repository, hosted authority or network grants by analogy. |

### Six-job guidance scorecard

Source percentages are editorial job coverage, **not file counts**. The six-job
mean is 63.33%; it is diagnostic input, not the mathematical basis of the
separately adjudicated 60% skills source domain, another weighted domain or an
extra evidence layer. Quality includes preserved
reasoning/examples and useful synthesis; delivery includes correct triggers,
available tools, discoverability and refusal behavior. Installed/runtime/human
delivery remains unestablished in this baseline.

| User job | Current source | Quality/delivery gap to evaluate |
| --- | --- | --- |
| Curate compact core knowledge | 80% | Writer guidance is substantial; demonstrate synthesis, contradictions, reasons and shrink-before-grow over time. |
| Place and discover deferred detail | 60% | Preserve one home and cues that succeed on a later request, not only valid paths. |
| Initialize useful memory safely | 40% | Starter and docs exist; verify recurring setup needs before proposing another skill. |
| Maintain/synchronize the native memory filesystem | 50% | Runtime publication/recovery exists; disconnected local stack and operator delivery are incomplete, not hosted sync. |
| Diagnose context and memory behavior | 70% | Diagnostics/guidance exist; bounded diagnosis and honest inconclusive/no-edit delivery need review, including the unavailable context-doctor reference. |
| Maintain reusable procedural guidance within proper ownership | 80% | Substantial writer/role guidance exists; skill creation remains separately authorized and cannot be inferred from procedural memory. |

## Behaviors not to copy 100%

- Cloud/shared organization repositories, hosted APIs, server context authority
  and cross-machine synchronization: no second private knowledge authority by default.
- Identity doctrine that makes experiential memory outrank current human,
  repository or runtime evidence; memory remains fallible.
- Broad worker filesystem access, non-Markdown mutation or skill creation without
  the separate owner's explicit authorization.
- Working-tree Palace snapshots if Mahiro chooses committed snapshots: match
  user-visible truth and label freshness, not Letta's storage access mechanically.
- PID-based dead-owner recovery when it weakens preserved uncertainty,
  generation ownership or actual drain guarantees.
- Optional/degraded sandbox behavior presented as universal enforcement. Tool
  confinement and OS sandboxing protect different threats and need separate proof.
- Source-guide contradictions: executable behavior wins, then record deliberate
  adaptation. C exclusions require approval and earn no implementation points.

## Decision log and open questions

Selected source directions were recorded on **2026-10-30** under the delegated
repository scope. The [R0 decision appendix](letta-parity-r0.md#selected-source-directions--r0-03)
owns dependency order, rejected alternatives and risks. Selection does not close
implementation, installed/runtime or human-only gates.

| Decision ID | Selected source direction | Remaining dependent gates |
| --- | --- | --- |
| D-SCHEMA | B: retain Mahiro schema with explicit automatic/deferred mapping, no bulk private-corpus rename. | R1-01–04 and R1-H. |
| D-SEAM | B: one ABI2-preserving installed slice, sole publication owner and rollback proof; not a permanent third ABI. | R4-01–04 and R5 safety exits; no activation authorized here. |
| D-TRAJECTORY | B/C: bounded redacted trajectory, captured ranges and explicit privacy exclusions. | R3-03–05, R8-01; installed producer and quality remain unproven. |
| D-CONTEXT | B: command-time public Pi session capture, estimated/unavailable labels; separate Git knowledge history from maintenance. | R7-02–03 and history gates; exact attribution owner still needs implementation proof. |
| D-RECOVERY | B: repair/abandon transitions preserving unknown publication and ownership evidence. | R5-01–03; no automatic semantic conflict resolution. |
| D-PALACE | B: committed default snapshot; distinguish drafts, integrated state and current active prompt. | R1-02, R7-01–05 and human visual/product acceptance. |
| D-SKILLS | B/C: zero new package skills now; preserve core/deferred/context-doctor quality, admit only through G-SKILL. | R2 and G-SKILL; no bulk/cloud adoption or silent skill mutation. |
| D-TRIGGER | A/B: finalized assistant steps, future threshold 25 independent of batch cap; captured-range watermark and separate replay. | R3-01–05; no live default change established. |
| D-EXCLUSIONS | C: no hosted/shared authority, bulk skill adoption, raw private payload copying or conflicting companion doctrine. | R8-02; no free implementation credit or denominator change. |

## Immediate next milestone

**R0 specification, inventory and source review are complete.** Continued
repository write/test/checkpoint execution was authorized on 2026-10-30. Next,
specify R1–R3 and R5 semantics, then implement only approved
synthetic/differential source fixtures and narrowly approved corrections. Define
R4's smallest integration slice on paper; do not install or activate it in that
milestone.

Phase H continuation and Phase I remain paused until their own gates pass. This
roadmap-direction acceptance does not authorize push, tag, release, profile/install
mutation, live cutover or Phase I, nor replace later human-only product/visual
acceptance. Later source, installed, observed-runtime and human exits each require
their own evidence and scope. The useful next result is a falsifiable behavioral
contract, not a larger preview or a higher unsupported percentage.
