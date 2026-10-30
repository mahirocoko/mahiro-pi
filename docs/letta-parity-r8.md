# R8 — Source/security/context-contract closeout

[← Documentation](README.md) · [Canonical roadmap and scores](letta-parity-roadmap.md) ·
[Memory contract](agent-memory.md) · [Development](development.md)

## Mandate, mode and checkpoint

Task `8e8d2b82-d0cc-47a4-94ca-9aeab8b0a38f`, 2026-10-30. Assessed product-source
checkpoint: Mahiro `85d2f0a82088103eb67d4bd29876e0f4e4b471a8`, compared with Letta
Code v0.34.31 `a8900b882446d7aa99fedf2845d400743affd1b6` (previous comparison pin
`5dea67021b99810707ff753db35e4534f70ff1fd`). This R8 ledger is authored in a
later docs-only checkpoint and is not contained in the assessed product commit.
This docs-only closeout uses
**source-security guidance mode plus a context-contract audit**, not a full
penetration test or comprehensive security audit. No full security-audit artifact
directory is created. R8-01–05/R8-S mean this bounded source closeout only;
R8-I/O/H remain open.

**No confirmed vulnerability or severity is assigned from this source pass.**
That is not an assertion of security, complete coverage or absence of defects.
The matrix records intended source controls and needs-validation boundaries,
not reproduced exploit outcomes. There is no qualifying OS-enforced sandbox
established for this audit. **No target-controlled test, build, formatter, check,
fixture processor, browser or live probe ran.** Prior suite/SDK results in R0–R7
are evidence references, not rerun proof. No private state or corpus was examined.

Authority order: current human scope and `AGENTS.md`, executable source/public
contracts, then supporting checkpoint prose. `docs/letta-parity-roadmap.md` alone
owns current planning/scores; `docs/agent-memory.md` owns the live memory contract;
R0–R7 appendices preserve bounded decisions and checkpoint evidence. R8 is a
supporting ledger, not a new memory authority, security policy or installer.
Source inspection cannot establish installed grants, provider privacy, descendant
helper settlement, secure erasure, authenticated provenance or human acceptance.

## Threat/outcome matrix — R8-01

All regression owners below are **source-inspected references only**, not tests
run in R8. A control listed here is limited to its stated principal and boundary.
Paths under `local/` mean `lib/agent-memory/local/`; the service remains disconnected
from extension/kernel/installer/profile/live-prompt authority.

| Surface / lower-trust principal, resource and intended control | Source enforcement / owner | Regression owner (inspection only) | Unsupported threat / needs validation | Residual outcome and future probe |
| --- | --- | --- | --- | --- |
| ABI2 private views/root/PSS: child, stale session or cross-root request targets private corpus/publication; require exact-root, primary/child, revision and generation authority. | `lib/kernel/`, `experimental-runtime.ts` admission/authorization/barrier, `engine/data.ts`, `engine/publisher.ts`; public PSS is permission owner, guards are final native enforcement, not a second policy engine. R4 names the actual ABI2 completion/publication route. | R4 route, engine-operations and tree SDK fixtures; `test/agent-memory-engine.test.ts`, engine-lifetime/profile tests. | Installed effective grants/routes and alternate-root behavior unestablished; private views are not an OS sandbox against arbitrary same-user code. | Preserve sole ABI1/ABI2 authority. Authorized disposable R4/R5 journey must deny foreign/stale/root-replaced/revoked access while permitting the exact intended route. |
| Data subprocess: malformed/oversize requests target engine state, resources and pending operations; constrain protocol and current-authority fences. | `engine/controller.ts`, `engine/entry.ts`, `engine/data.ts`, `engine/io.ts` own process/protocol and bounded I/O; publisher fences actual publication. Construction/loading provisions nothing. | Engine/controller and engine-operations fixtures referenced by R4; engine lifetime tests. | A data subprocess is not an OS security sandbox, provider isolation or universal descendant containment. No R8 process execution or resource measurements. | Protocol/process separation is source capability only. Future sandboxed malformed-input/abort/drain probes need dummy roots and bounded process/resource receipts. |
| Model workers: untrusted model output/tool arguments target a worktree and runtime resources; expose only confined memory tools, never publication. | `local/model-worker.ts`, `workspace.ts`, `confine.ts`: isolated session per callback, seven workspace tools, aggregate output/call/argument/result caps and cooperative abort; coordinator alone publishes. Native writer separately retains descriptor/route/private-view locks. | `test/agent-memory-local-model-worker*.test.ts`, workspace tests; R4 profile/route fixtures for native writer, not the same worker. | No installed model worker; prompt cap is not whole model context. Cooperative abort depends on provider/session cooperation. No provider privacy, inference quality or arbitrary JavaScript sandbox guarantee. | A callback with independent same-user filesystem authority is outside this confinement model. Future approved dummy worker tests must distinguish tool denial, budget failure, provider cancellation and cleanup settlement. |
| Local coordinator/worktrees/Git: cooperative competing process or retained callback targets owned root/main/worktree; serialize and bind exact identity/publication. | `local/coordination.ts`, `service.ts`, `confine.ts`, `repair.ts`, `git.ts`, `git-process.ts`: exclusive sibling claim, root inode/nonce/token, adapter revocation, exact candidate CAS, fixed local Git/config refusal; uncertain direct-child termination poisons and retains claim. | R5 coordination, lifecycle, recovery and git-process fixtures; `test/agent-memory-local-migration.test.ts`. | Hostile same-user metadata mutation, mixed versions, network filesystems, fsync/power-loss durability, remote Git and universal helper-tree settlement unsupported. No automatic dead-claim takeover. | Retained uncertainty can strand a root. Future authorized fault journey must report drained/retained/unknown separately, never infer safety from PID death or clear a claim to pass a test. |
| Forgetting: stale seed, rollback, conflict/history read or blob alias targets excluded knowledge; prevent logical resurrection. | `local/forgetting.ts`, service/workspace/projection/repair/migration and R7 history filters; versioned checksummed policy, required Core/index entries preserved while excluded blobs are withheld. Live store/engine have their own forgetting owners. | Local forgetting, projection, recovery, migration and invocation fixtures; R1 schema matrix. | Logical filtering is not secure Git-history erasure, removal from backups/provider retention/browser caches, or exhaustive historical alias/source attribution. | Unknown historical source attribution makes R7 history unavailable, not guessed safe. Future dummy path/blob/source rollback and history probes must honor current exclusions without fetching forgotten data. |
| Migration: caller-supplied pages/read envelopes/content target a fresh shadow; require internal consistency, exact target identity and quiescent quarantine. | `migration-export.ts`, ABI1 store/ABI2 manage, `local/migration.ts`: metadata-only export, complete paged bundle/hash validation, immutable receipt, root identity and same cooperative claim for rollback. R6 separates six outcomes. | `test/agent-memory-local-migration.test.ts`, export/engine fixtures cited by R6. | Self-consistent invented bundles can pass; hashes are not provenance authentication or consent. Final source freshness is caller-owned, not atomic cross-owner locking. Backup/restore and live migration unavailable. | Shadow verification is not activation. Future approved rehearsal needs canonical final revision check, explicit source/target consent, exact owned quarantine and retained original memory/route. |
| Palace/browser: URL holder or hostile document/metadata targets loopback file access and rendered content; read only bounded capability-scoped routes. | `local/palace-server.ts`, `palace-page.ts`, `palace.ts`: exact Host/capability checks, loopback, GET/HEAD, no arbitrary file route/body/CORS/cookies, escaping, CSP/fixed assets and shutdown drain. | Local Palace/server/security fixtures referenced by R7; no browser run here. | Capability possession is access, not user authentication. No live Palace, same-user/browser compromise protection, retroactive browser erasure or rendered/human acceptance established. | Installed `/mh-memory palace` stays JSON diagnostic. Future authorized rendered review needs script-like dummy text, stale/revoked routes, safe navigation and shutdown receipts without private corpus. |
| Invocation/history: caller context, mutable head/policy or history text targets truthful context/knowledge attribution. | `local/palace-invocation.ts` and service captured APIs: separate envelope, committed projection receipt, one capture identity, head/policy fences, bounded first-parent history/replacement diffs and forgetting filters. | `test/agent-memory-local-invocation.test.ts`, existing Palace/projection/forgetting fixtures. | Context is fixture/caller-supplied/unavailable, not installed collection or exact provider usage. Working tree unavailable; source exclusions can withhold history. No HTML history/diff routes or installed collector. | Synthetic knowledge history exists; user/operator/HTML history does not. Future R7 collector must bind invoking primary/session/revision/root and actual prompt owner before any live attribution claim. |
| Trajectory/untrusted input: caller entries, historical quotations, tool errors or model suggestions target policy, preferences and learning progress. | `local/trajectory.ts`, `jobs.ts`, `model-worker.ts`, shared `guidance.ts` and locked roles: explicit caller array, assistant-only threshold, bounded captured prefix, pre-truncation recognizable-secret filter, monotonic settlement; text grants no authority. R2 requires reasons/contradictions/no-edit. | R3 trajectory and trajectory-r3 tests; R2 starter/guidance and model-worker fixtures. | Finalization is caller assertion; omitted rows persist IDs, not body integrity. Secret filtering is not arbitrary-secret detection, and retention tests do not prove semantic prompt-injection resistance or useful learning. | Preserve uncertainty and instruction precedence. Future synthetic hostile-entry/no-learning evaluations must measure behavior separately from deterministic caps/replay correctness. |
| Installer/profile/cutover: stale or unapproved setup proposal targets grants, selected root, roles and live authority. | `install.mjs`, `setup.mjs`, `lib/setup.ts`, memory profile/writer-route and kernel shared `resolveAgentDir`; explicit composition only, absent-root initialization, preserve existing corpus/paired route, narrow DATA grants and scalar default-deny consent. | `test/setup.test.ts`, `test/agent-memory-profile.test.ts`, bootstrap fixtures and R0/R4 inventories. | Source defaults do not prove installed package/grants, profile isolation, rollback or live migration. Startup must not provision. No Phase I, install/reload or profile mutation in this pass. | Require separate preview/apply authorization, exact package/root/grant/route receipt and rollback plan. Disposable installed R4/R5 comes first; private migration/cutover requires its own later decision. |

References above use `lib/agent-memory/` for unprefixed memory source files.
No matrix row establishes a concrete cross-boundary exploit result or severity.
Optional OS sandboxing is a distinct control needing actual platform evidence,
not an assumption that upgrades these source-level tool restrictions.

## Evidence and coverage ledger — R8-02

R0's [L/D/N/I/O/H worksheet](letta-parity-r0.md#evidence-classes-and-acceptance-worksheet--r0-04)
remains the evidence taxonomy. Direct means a named fixture targets the defect
shape **by source inspection**, not that R8 executed it; indirect means adjacent
coverage can pass despite that defect. Missing means the claimed seam has no
established proof here; human-only means automation cannot supply acceptance.

| Layer | Evidence reference / covered outcomes | Coverage and falsifier | Limit / next owner |
| --- | --- | --- | --- |
| Source/local (L) | R1 mapped schema/projection/discovery; R2 six guidance jobs; R3 captured-prefix progress; R5 recovery/cooperative claims; R6 shadow/forgetting; R7 capture/history. | Direct fixture intent: wrong assistant-role counting, stale candidate publication, duplicate export page, forbidden historical blob or capture A returning head B must fail. Guidance string assertions are indirect for actual synthesis/discovery. | Current source review plus recorded prior tests, not reruns. Longitudinal learning, performance and installed seams remain missing. |
| Latest-source differential (D) | R0-01/02/03 28-gap map/A-B-C decisions and exact Letta pins; R1 mapping fixture, R3 assistant threshold, R5 config-root/token/helper comparison. | Direct source comparison for named owners; indirect for behavioral equivalence. A guide's cleanup claim conflicting with executable forced cleanup must not override code. | No Letta execution, full differential suite or whole-product equivalence. C exclusions (hosted/shared authority, broad skill adoption, conflicting identity doctrine) stay explicit with no denominator bonus. |
| Public SDK (N) | R4 route/engine/tree fixtures: genuine deterministic native completion, private child proposal, parent publication and next-request projection. | Direct fixture intent for ready-but-running child not publishing and later eligible prompt refresh; indirect for real providers and installed host surfaces. | Faux/SDK route is source-layer evidence only. No provider authorization/privacy, TTY rendering or daily-primary proof. |
| Installed (I) | R0 sanitized package/receipt/ABI2/grant inventory is a narrower historical observation. R4–R8 installed journeys remain open. | Missing for current complete-product routing, effective alternate-root grants and confinement; source defaults cannot falsify installed misrouting. | Zero current score credit. Exact authorized disposable profile/package/root/grant/route receipts needed; no private payload in source. |
| Observed runtime (O) | R0 bounded Discovery v2 revision reads and unavailable manage/status reason `unknown` remain history, not a health/publication pass. | Missing for later success/no-op/failure/conflict/restart/provider/browser and longitudinal outcomes; source fixture success cannot falsify wrong live cadence. | Zero current score credit. Future bounded receipts must name surface/provider/workload/environment and distinguish refused, failed and unestablished. |
| Human (H) | R0 roadmap-direction acceptance only; no later daily-primary, learning, product, visual or RAM acceptance. | Human-only: usefulness, meaningful synthesis, acceptable burden, composition and comfort. | Zero current score credit. Mahiro alone records acceptance; neither this ledger nor a verifier can substitute. |

Accepted A/B outcomes are accounted for through the domain owners above and R0's
28-gap map: schema/projection (R1), guidance (R2), trigger/trajectory (R3), sole
ABI2 publication seam (R4), repair/root/helper uncertainty (R5), operator separation
(R6), committed Palace/invocation/history (R7), authority/privacy/evidence (R8).
Unsupported hosted/shared, broad-worker, secure-erasure and automatic skill/cutover
outcomes remain exclusions or open gaps, never silent implementation points.

## Current editorial assessment — R8-03

The [roadmap](letta-parity-roadmap.md#domain-scorecard) owns the current values.
At `85d2f0a82088103eb67d4bd29876e0f4e4b471a8` versus the Letta pin above:

| Domain | Source | Domain weight | Evidence (source × 50%) |
| --- | --- | --- | --- |
| Storage/schema/forgetting | 80% | 10 | 40% |
| Projection/retrieval | 85% | 15 | 42.5% |
| Reflection/trajectory/progress | 70% | 20 | 35% |
| Writer/publication | 90% | 15 | 45% |
| Recovery/concurrency/lifecycle | 80% | 10 | 40% |
| Commands/migration/operator workflows | 50% | 5 | 25% |
| Palace/context/history | 60% | 10 | 30% |
| Memory skills/guidance | 70% | 10 | 35% |
| Authority/privacy/isolation | 80% | 5 | 40% |

Weighted source: `(80×10 + 85×15 + 70×20 + 90×15 + 80×10 + 50×5 + 60×10 +
70×10 + 80×5) / 100 = 75.75%`, rounded to nearest five points = **75%**.
Layer weights are source 50%, installed 20%, observed 20%, human 10%.
Current evidence arithmetic: `75.75×0.50 + 0×0.20 + 0×0.20 + 0×0.10 = 37.875%`,
rounded to **40%**. Source contributes **37.875 percentage points**, not 50
percentage points of achieved parity. Installed/observed/human current claims
are zero: **unestablished, not demonstrated failures**. These are editorial
planning estimates, not benchmark/efficacy/security percentages.

**NOT ALIGNED** remains the verdict. Source gains recognize existing bounded
R1–R7 implementation/SDK work, not new R8 execution or installed integration.
R5 has synthetic terminal repair/abandon and restart/CAS evidence; the old claim
that no terminal recovery exists is no longer current. R7 has a disconnected
knowledge-history/diff service, but neither an installed invocation collector nor
HTML knowledge history. These distinctions explain the recovery/Palace values
without upgrading evidence layers. Fresh independent QA must challenge the final
docs/source references separately; this authoring pass is not independent QA.

Historical B0 (2026-10-29, `7c4169477fcacc472018678848f74342173de2b2` plus an
unfrozen/unavailable dirty-tree identity) and B1 (2026-10-30,
`f46cade7e3c984981b5eeb55eb68a4a610b45ba2`) remain **60%/30%**. Their unrounded
values were 61.5/30.75. Dated R1–R7 unchanged-score statements remain checkpoint
history, not current scoring authority. This checkpoint does not retroactively
freeze B0, rerun old receipts or establish a new upstream comparison pin.

## Longitudinal evaluation plan — R8-04

These are **named future workloads and metrics**, not executed evaluations or
promised efficacy. Use explicit synthetic inputs first, predeclared expected
outcomes, repeated comparable runs and bounded receipts. Any target execution
requires the security sandbox and separate scope; paid/provider or installed
work requires its own authorization. Never ingest private transcripts by default.

| Workload | Outcome and measurements | Required layer / remaining decision |
| --- | --- | --- |
| W-SYNTH — repeated correction → reusable principle | Correct reasons/contrastive examples retained; incident-log growth, redundant facts, unsupported inference and no-learning rate across repeated episodes. | Model/observed evaluation plus Mahiro's human judgment of useful synthesis, not token retention. |
| W-CONTRA — conflicting preference and supersession | Explicit unresolved contradiction, source attribution and instruction precedence; unsupported preference promotion, lost uncertainty and stale-fact use rates. | Synthetic negative cases first; human decides semantic truth and acceptable handling. |
| W-DISCOVER — novel rollback request | Discover deferred owner without supplied path; success/exhaustion accuracy, irrelevant reads, pages/bytes and request-to-answer latency. | R1 source discovery is indirect for real future-request utility; installed/observed and human gates remain. |
| W-CADENCE — mixed-role threshold 25 and late tails | Launch count, duplicate/omitted captured IDs, watermark movement under success/no-op/failure/replay; queue/settlement latency and tool-call counts. | Deterministic R3/R4 source intent exists; actual installed producer/provider cadence unestablished. |
| W-RECOVER — conflict, interruption and retained claim | Exact published head, retained/unknown classification, no resurrection, recovery/rollback completion and operator steps/time; no forced cleanup to manufacture success. | Authorized R4/R5 faults first; R6 rehearsal only after operator product exists. Human accepts uncertainty/burden. |
| W-CONTEXT — Core/index/project plus large deferred corpus | Actual prompt-owner bytes versus receipt, clipping/deferred accuracy, estimate versus public usage where available; label estimate error/unavailable, never infer whole context from corpus size. | R7 installed collector then bounded observed evidence; exact provider accounting stays unclaimed. |
| W-RESOURCE — bounded corpus/history and idle/active preview | Baseline/peak/settled RSS, growth per repeated turn, p50/p95 latency, CPU time, I/O bytes/operations, Git/process count and retained state bytes; name OS/provider/corpus size and caps. | No current measurements. Authorized harness/observation and separately rendered review; Mahiro owns RAM acceptance. |
| W-PALACE — stale/revoked view, paging and knowledge/lifecycle separation | Correct capture/head/policy identity, filtering and no capability/file leakage; 320px/200% zoom navigation, clipping, keyboard/focus and shutdown behavior. | Source DTO/server checks do not prove browser behavior. Rendered review and human product/visual acceptance required. |

Human-only criteria include whether memory improves later daily work rather than
merely storing it; appropriate privacy/cadence; sound reasons and contradictions;
compact discoverable guidance; clear recovery burden; useful Palace composition,
visual behavior and acceptable RAM. A test, agent score or roadmap-direction
approval cannot satisfy these. Record refusals, no-op outcomes and inconclusive
results alongside successes to avoid cherry-picking.

## Release and cutover decision — R8-05

**NOT READY for release or live cutover.** R8 source audit completion does not
close R8-I/O/H or make the disconnected stack an installed product.

Blocking gates, in dependency order:

1. Explicit authorization for a disposable installed **R4/R5** journey, exact
   package/profile/root/grants/routes and owned synthetic fixtures. Establish the
   required execution sandbox before running target-controlled gates under this
   audit boundary. Exercise publication/no-op/failure/conflict, revocation,
   alternate roots, restart and retained uncertainty; untested surfaces stay open.
2. **R6** needs an operator product before rehearsal. Metadata export, content
   bundle, shadow verification, managed revision rollback and target quarantine
   must not be sold as backup/restore, prior-route restoration or active cutover.
3. **R7** needs an installed invoking-session collector and safe rendered
   review. Service-only history is not HTML/user history or active-prompt proof.
4. Run separately authorized longitudinal/failure/resource workloads and collect
   bounded receipts at their actual layer. Obtain independent verification and
   Mahiro's human-only daily-primary/product/visual/RAM acceptance.
5. Make a new release-readiness decision with explicit source/SDK/release gates,
   unresolved risks and scope. All normal heavy/formatter/check gates were unrun
   in R8; prior records cannot discharge a future release gate.

Rollback/install requirements: preview exact source/target identities and grants;
retain existing memory/profile/route choices; authorize apply separately; prove
post-rollback next-request projection through the intended authority. Dispose only
newly owned synthetic roots after actual worker/process settlement. Unknown,
live or retained-claim roots must not be pruned. Shadow quarantine is not a live
route rollback. A future private migration needs its own consent, provenance and
freshness acquisition, forgetting/non-resurrection proof, restore/rollback plan
and authority decision; self-consistent bundles are insufficient.

No commit, push, tag, release/publish, profile/auth/model/permission change,
installation/reload, private migration, live probe, cutover or **Phase I** is
authorized by this closeout. Phase H remains paused/unaccepted. The release and
human decision remain separate even if a future editorial score rises.

## Context-contract disposition and verification boundary

Corrected active owners: roadmap checkpoint/score arithmetic and next gates;
memory summary and synthetic-versus-operator history; navigation to this ledger.
Retained: B0/B1 provenance limitations, dated R1–R7 unchanged-score statements,
release records and ordinary development instructions. No source, test, generated
contract, private state or release history was rewritten. This is additive
closeout, not a documentation-volume cleanup.

Bounded consistency inspection covers `AGENTS.md`, R0–R7 references and the five
changed documentation paths. Searches for `R0 is active`, old/current scores,
checkpoint IDs, R8 gate states and history availability are location aids, not a
semantic/exhaustive audit. Verification is limited to read/grep inspection and
native `git diff --check`, `git status --short`, `git diff --stat`/diff inspection.
No formatter, package/docs checker, test, build, SDK gate, rendered probe or state
budget script ran. Independent QA and all installed/observed/human gates remain
separate; **NOT ALIGNED / NOT READY** is the truthful closeout, not full security
coverage or accepted parity.
