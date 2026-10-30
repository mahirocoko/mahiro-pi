# Letta parity R0 — contracts, decisions and evidence

[← Roadmap](letta-parity-roadmap.md) · [Memory contract](agent-memory.md) · [Development](development.md)

## Mandate and baseline

Recorded **2026-10-30**. This appendix owns the detailed R0 owner map, selected
source directions and acceptance cases. The [roadmap](letta-parity-roadmap.md)
remains canonical for checklist status, dependencies and scoring. The implemented
[memory contract](agent-memory.md), executable source and observed runtime outrank
this specification. This is documentation-only: no new behavior, skill, profile,
permission, installation, private-memory mutation or live cutover is established.

| Boundary | Exact identity | What it establishes |
| --- | --- | --- |
| Current Mahiro checkpoint | `f46cade7e3c984981b5eeb55eb68a4a610b45ba2` | Immutable experimental Palace/context and roadmap source; not installed local-service integration. |
| Original B0 | `7c4169477fcacc472018678848f74342173de2b2` plus original audited dirty tree | Historical audit anchor only; original whole-dirty-tree identity is unavailable. |
| Current-candidate R0-00 | Base `7c4169477fcacc472018678848f74342173de2b2`; diff SHA-256 `f4513d4e32910885336d36d914e3b1f7ce24ed35d5a25a44d5ea4d7d8495f57a`; untracked manifest SHA-256 `bce6ac71e8b70a235a30495d506a7748dbdd0628d897b9b3552127528ebf8188` | Later sanitized capture; cannot retroactively identify B0. |
| Latest Letta comparator | `a8900b882446d7aa99fedf2845d400743affd1b6`, v0.34.31 | Frozen executable reference for this R0. |
| Previous Letta comparator | `5dea67021b99810707ff753db35e4534f70ff1fd`, v0.34.26 | Differential baseline, not latest-source authority. |

Supporting local records are
`.agent-state/runtime/memory-v012/letta-v03431-full-parity-audit.md` and
`.agent-state/runtime/memory-v012/r0-installed-observation.md`. They are ignored
operator evidence, not public prerequisites. No private body, root path, profile
payload or transcript is reproduced here. Upstream inspection was read-only;
no Letta-controlled test, installer, generator or provider workflow was run.

Keep two Mahiro systems distinct throughout this document:

- **Live:** `extensions/mahiro-agent-memory.ts` delegates through
  `lib/agent-memory/runtime-router.ts` to ABI1 `runtime.ts` or ABI2
  `experimental-runtime.ts` / `engine/**`. The observed selection is ABI2.
- **Disconnected local service:** `lib/agent-memory/local/**` contains the bare
  repository coordinator, trajectory, model worker, projection, forgetting,
  migration and HTML Palace. Its source and shadow proofs are not an installed
  session-to-learning product. No permanent third ABI is selected by this plan.

All Mahiro paths below are repository-relative. Letta paths are relative to the
pinned public Letta repository and identify executable owners, not imported
instructions. A means match closely; B means adapt the user outcome; C means
exclude exact copying. Mixed labels separate portable behavior from authority
or privacy exclusions, not partial approval of an unspecified implementation.

## Latest-source differential — R0-02

Most relevant contracts already exist at the previous pin: MemFS v2 selection,
root Markdown core projection, nested indexed discovery, `Memory(path)`,
reflection triggers/worktrees, repair, committed prompt compilation and Palace
collection/template. The 43-commit advance is not the explanation for Mahiro's
missing installed lifecycle or invented all-entry step counting.

Material latest deltas to carry into R5/R8:

- `src/utils/settings-path.ts` resolves the product config root, including
  `LETTA_CONFIG_DIR`; `src/settings-manager.ts`, `src/settings.ts`,
  `src/agent/memory-filesystem.ts`, `src/permissions/memory-paths.ts`,
  `src/permissions/agent-memory-prefixes.ts`, `src/permissions/sandbox-policy.ts`
  and `src/sandbox/**` keep settings, memory and protection roots consistent.
  Mahiro must audit its own profile/root invariant rather than copy the variable.
- `src/agent/memory-git-process.ts` and its `memory-git.ts` caller bound output,
  deadlines and helper teardown: POSIX process groups and Windows task trees.
  A bounded direct child alone does not establish helper settlement.
- The initialization skill's journal example changes from a hard-coded home
  path to `${LETTA_CONFIG_DIR:-$HOME/.letta}/workflows/executions/<id>/journal.jsonl`.
  This is a path-consistency update, not a new initialization product.
- `src/web/generate-memory-viewer.ts` changes `VIEWERS_DIR` to use
  `resolveGlobalConfigDir()` instead of `homedir()/.letta`. The small viewer diff
  does not introduce the existing Context, reader or History architecture.

Reproduce the comparison in a public Letta checkout containing both objects:

```sh
OLD=5dea67021b99810707ff753db35e4534f70ff1fd
NEW=a8900b882446d7aa99fedf2845d400743affd1b6
git rev-parse "$OLD^{commit}" "$NEW^{commit}"
git show "$NEW:package.json"
git rev-list --count "$OLD..$NEW"
git diff --name-status "$OLD" "$NEW" -- src/agent src/permissions src/sandbox src/web
git diff "$OLD" "$NEW" -- src/utils/settings-path.ts src/settings-manager.ts
git diff "$OLD" "$NEW" -- src/agent/memory-git-process.ts src/agent/memory-git.ts
git diff "$OLD" "$NEW" -- src/skills/builtin/initializing-memory/SKILL.md
git diff "$OLD" "$NEW" -- src/web/generate-memory-viewer.ts
git show "$NEW:src/agent/memory-worktree.ts"
```

These commands read Git objects; they do not checkout, install or execute Letta.
Inspect the actual diff before generalizing from filenames. Large excerpts are
not needed in this appendix. Letta `AGENTS.md` says failed reflection integration
preserves pending work, but executable `src/agent/memory-worktree.ts` around
607–630 aborts the merge and attempts forced worktree/branch cleanup so trajectory
can retry. That executable path wins; retaining an unusable Mahiro conflict is
not equivalent to Letta recovery merely because guide prose sounds similar.

## Complete audit-gap map — R0-01

IDs below preserve the canonical audit's numbering, not the order of a prior
chat summary. Closure means the named roadmap gate has its evidence; this
appendix alone closes no implementation gap.

### G01 — Installed local-service integration · High · B

- **Outcome:** one session can learn, publish and use the result next request.
- **Mahiro:** `runtime-router.ts::createAgentMemoryRouter`, `runtime.ts`,
  `experimental-runtime.ts`, `local/service.ts`, `local/model-worker.ts` are
  separate paths; local completion is not live completion.
- **Letta:** `src/cli/helpers/post-turn-reflection.ts`, `reflection-launcher.ts`,
  `reflection-completion.ts`, `src/agent/memory-worktree.ts` connect the loop.
- **Close:** R4-01–04 and R5 safety exits; N fixture plus I/O receipt proving
  session → trajectory → worker → publication → next-request visibility.

### G02 — Schema mismatch · High · B

- **Outcome:** durable knowledge has a predictable home and discovery route.
- **Mahiro:** `store.ts`, `engine/schema.ts`, `retrieval.ts` assign fixed
  Core/index/persona/human/project roles.
- **Letta:** `src/agent/memory-format.ts`, `memory-filesystem.ts` select v2 with
  root `MEMORY.md`, root Markdown core and indexed nested deferred files.
- **Close:** R1-01/04; explicit mapping, collision and unsupported-path fixtures,
  preserving the private corpus rather than renaming it for a score.

### G03 — Projection semantics · High · B

- **Outcome:** compact automatic context leads to useful on-demand detail.
- **Mahiro:** `prompt.ts`, `retrieval.ts`, `local/projection.ts` select compact
  owners; local projection is disconnected from live prompt replacement.
- **Letta:** `src/backend/local/system-prompt-compilation.ts`,
  `src/agent/memory-format.ts` compile committed root blocks and deferred pointers.
- **Close:** R1-02–04 and R4; D trees plus N/I/O next-request projection proof.

### G04 — Episodes versus trajectory · High · B/C

- **Outcome:** maintenance sees enough experience to learn without private leakage.
- **Mahiro:** `runtime.ts`, `experimental-runtime.ts`, `store.ts`,
  `local/trajectory.ts` separate eligible episodes from caller-supplied arrays.
- **Letta:** `src/cli/helpers/reflection-launcher.ts`,
  `src/agent/subagents/memory-worker.ts` prepare trajectory/conversation inputs.
- **Close:** R3-03–05 and R8-01; redacted input fixtures and installed capture;
  raw reasoning, credentials and unrelated private corpus remain C exclusions.

### G05 — Entry count is not assistant-step count · High · A

- **Outcome:** tool-heavy turns do not accelerate reflection spuriously.
- **Mahiro:** `local/trajectory.ts::normalizeTrajectoryConfig` and range selection
  count supplied pending entries; local tests encode the mismatch.
- **Letta:** `src/cli/helpers/reflection-transcript.ts::countAssistantRows`
  counts assistant entries and derives `steps_since_last_successful_reflection`;
  `post-turn-reflection.ts` and `reflection-runs.ts` own surrounding lifecycle.
- **Close:** R3-01/02; D case with user/tool rows and incomplete assistant rows
  must not advance the completed-step trigger.

### G06 — Effective trigger/defaults · High · A/B

- **Outcome:** cadence and off/compaction behavior are predictable.
- **Mahiro:** `runtime.ts`, `experimental-runtime.ts`, `local/trajectory.ts`
  have different launch policies; the local batch cap is eight entries.
- **Letta:** `src/settings-manager.ts` sets fresh `step-count: 25`;
  `src/reflection-settings.ts` helper fallback is not the effective default.
- **Close:** R3-01–05; decouple progress threshold from bounded range capacity;
  prove off, step 24/25, compaction and settlement without changing live defaults now.

### G07 — Conversation selection/replay · High · B

- **Outcome:** explicitly revisit prior experience without consuming normal progress.
- **Mahiro:** `local/trajectory.ts` retries an immutable failed job; live episode
  selection in `store.ts` is not cross-conversation replay.
- **Letta:** `src/cli/helpers/reflection-launcher.ts`,
  `src/cli/app/use-submit-handler.ts` handle auto/recent/conversation selections.
- **Close:** R3-03–05; captured selected-range, authorization, replay and normal
  watermark isolation fixtures before any historical-session producer is wired.

### G08 — Watermark equivalence unproven · High · A/B

- **Outcome:** no skipped experience, duplicate settlement or late-append loss.
- **Mahiro:** `local/trajectory.ts`, `local/jobs.ts`, `store.ts` use branch/order
  watermarks and reviewed episode IDs, not one installed state machine.
- **Letta:** `src/agent/reflection-runs.ts`,
  `src/cli/helpers/reflection-completion.ts` settle through captured message IDs.
- **Close:** R3-04/05; D late append, noop, failure, conflict, retry and replay
  transitions; I/O must later prove the same installed producer/consumer range.

### G09 — No repair/abandon exit · High · B

- **Outcome:** a retained conflict can become usable or terminal without manual edits.
- **Mahiro:** `local/service.ts`, `local/jobs.ts`, `local/migration.ts` retain
  `repair-needed` and block rollback; no public repair/abandon transition exists.
- **Letta:** `src/agent/memory-worktree.ts`, `memory-conflict-repair.ts` and
  `subagents/memory-worker.ts` implement cleanup/retry and repair claims.
- **Close:** R5-01–03; repair, abandon, restart and unknown-publication cases;
  never infer semantic conflict resolution or successful publication from cleanup.

### G10 — Crash/concurrency outcomes · High · B

- **Outcome:** restart resumes or explains uncertainty without wedging later work.
- **Mahiro:** `engine/controller.ts`, `engine/lifetime.ts`, `engine/recovery.ts`
  and single-process `local/service.ts` protect different lifetimes.
- **Letta:** `src/agent/memory-operation.ts::claimMemoryOperation`,
  `withMemoryOperation` and `memory-conflict-repair.ts` use process-bound claims.
- **Close:** R5-02/03; crash matrix and ownership replacement tests. Do not import
  separate-process coordination into the approved single-coordinator trust model.

### G11 — Config-root isolation audit missing · Medium–High · B

- **Outcome:** custom profile data and protection paths never disagree.
- **Mahiro:** `install.mjs`, `lib/bootstrap.ts`, `lib/kernel/index.ts`,
  memory runtimes and `lib/guards/**` resolve distinct profile/root inputs.
- **Letta:** `src/utils/settings-path.ts`, `settings-manager.ts`,
  `permissions/memory-paths.ts`, `permissions/sandbox-policy.ts`,
  `web/generate-memory-viewer.ts` resolve product-root-dependent surfaces.
- **Close:** R5 root-isolation and R8 matrix; two synthetic profiles, relative
  override refusal and no cross-root viewer/agent/permission fallback.

### G12 — Git helper teardown · Medium · A/B

- **Outcome:** timeout settles helper processes before cleanup claims success.
- **Mahiro:** `local/git.ts`, `engine/publication-executors.mjs` and `store.ts`
  must be audited separately; bounded output alone is insufficient.
- **Letta:** `src/agent/memory-git-process.ts`, `memory-git.ts` own process-tree
  termination and bounded execution.
- **Close:** R5 helper-lifecycle fixtures; N authorized synthetic helper/deadline
  probe and platform-specific unavailable labels where no proof exists.

### G13 — Deferred navigation · Medium · B

- **Outcome:** a future request finds detail without knowing its exact path.
- **Mahiro:** `retrieval.ts`, `store.ts`, `engine/data.ts`, `local/projection.ts`
  offer topic/query/path/list and bounded pages.
- **Letta:** `src/tools/impl/memory.ts`, `src/agent/memory-format.ts` expose index,
  immediate children, descriptions, suggestions and core/skills routing.
- **Close:** R1-03/04; D request-shaped discovery, absent index, typo, paging and
  root/skills refusal cases; H evaluates usefulness, not filename matching.

### G14 — Viewed state versus prompt truth · Medium · A/B

- **Outcome:** viewing a draft never implies it is active session knowledge.
- **Mahiro:** `prompt.ts`, `engine/data.ts::headRead`, `local/projection.ts`,
  `local/palace-document.ts` have distinct committed/private-view owners.
- **Letta:** `src/backend/local/system-prompt-compilation.ts` reads committed
  state; `src/tools/impl/memory.ts` and viewer collection can read working files.
- **Close:** R1-02, R4 and R7; default committed snapshot with explicit draft,
  integrated and active-prompt identities; concurrent publication cannot hybridize.

### G15 — HTML Palace not installed · High · B

- **Outcome:** Palace answers what the invoking companion can actually use.
- **Mahiro:** `extensions/mahiro-agent-memory.ts` invokes JSON management;
  `local/palace-server.ts`, `local/preview.ts` serve disconnected HTML.
- **Letta:** `src/cli/app/use-submit-handler.ts`,
  `src/web/generate-memory-viewer.ts` collect and open actual memory/context.
- **Close:** R7-01–05 after R4/R6; I/O command/session/revision-bound preview,
  explicit unavailable handling and separate H visual/product acceptance.

### G16 — Lifecycle is not Git knowledge history · High · A/B

- **Outcome:** explain what knowledge changed, when and why.
- **Mahiro:** `local/palace.ts`, `local/palace-page.ts`, `local/jobs.ts` display
  bounded jobs/publication lifecycle, not a Git knowledge-history collector.
- **Letta:** `src/web/generate-memory-viewer.ts` collects up to 500 first-parent
  commits and 50 recent diffs; `memory-viewer-template.txt` renders/searches them.
- **Close:** R7 history gates; bounded knowledge commit metadata/diffs, forgetting
  filters and truthful incomplete coverage; keep maintenance as a separate view.

### G17 — Context capture remains disconnected · High · B

- **Outcome:** Context represents the invoking session at button/command time.
- **Mahiro:** `local/palace-context.ts`, `local/palace-page.ts`,
  `local/palace-server.ts` freeze a DTO; installed command does not supply it.
- **Letta:** `src/cli/app/use-submit-handler.ts`, `src/web/context-usage.ts`,
  `local-memory-context.ts`, `generate-memory-viewer.ts` capture invocation data.
- **Close:** R7-02/03; public Pi capture, immutable timing, unavailable/estimate
  labels; no corpus counts substituted for occupancy or fabricated token split.

### G18 — Delivery architecture differs · Medium · B

- **Outcome:** opening Palace yields a stable, private snapshot, not a live dashboard.
- **Mahiro:** `local/palace-server.ts` provides capability-scoped document/corpus
  routes with CSP, bounds and close-drain; `palace-context.ts` freezes context.
- **Letta:** `src/web/generate-memory-viewer.ts` writes a self-contained HTML file
  and handles browser opening based on terminal environment.
- **Close:** R7 snapshot/delivery cases; retain capability delivery if every read
  binds the invocation snapshot or reports stale, and context never silently refreshes.

### G19 — Shadow proof is not cutover/backup · Medium–High · B

- **Outcome:** export, shadow, backup, restore and active rollback have distinct truth.
- **Mahiro:** `migration-export.ts`, `local/migration.ts`, `local/service.ts`
  seed/reconcile a fresh shadow; `runtime-router.ts` still selects live ABI1/ABI2.
- **Letta:** `src/cli/app/use-submit-handler.ts`, `src/agent/memory-filesystem.ts`,
  `memory-git.ts` own memory operator and synchronization flows.
- **Close:** R6 operator fixtures, installed receipt and rollback drill; shadow
  completion cannot close live migration or backup/restore acceptance.

### G20 — Forgetting versus deletion · Low–Medium · B

- **Outcome:** correction/deletion is useful without promising history erasure.
- **Mahiro:** `store.ts`, `engine/data.ts`, `local/forgetting.ts` filter logical
  path/blob/source tombstones, including rollback and later seed/publication.
- **Letta:** `src/agent/memory-git.ts`, `memory-filesystem.ts` commit current-file
  changes/deletion; no equivalent tombstone policy was established by this audit.
- **Close:** R1/R6 non-resurrection, rename/copy/restart and rollback fixtures;
  explicitly retain logical-forgetting versus secure-erasure distinction.

### G21 — Skill/non-Markdown ownership · Medium · B/C

- **Outcome:** useful procedures are discoverable without silent installation authority.
- **Mahiro:** `agents/managed-memory-writer.md` is guidance, enforced by memory
  runtimes; `engine/schema.ts` restricts paths; `install.mjs` owns package roles.
- **Letta:** `src/agent/subagents/builtin/reflection-v2.md` informs the executable
  `memory-worker.ts`; `memory-format.ts` and prompt compilation separate skills.
- **Close:** R2 G-SKILL and R8; preserve core/deferred guidance quality, zero new
  skills now, no automatic skill mutation or broad non-Markdown worker access.

### G22 — Different confinement threats · Medium · B

- **Outcome:** admitted tools cannot cross the intended memory/session boundary.
- **Mahiro:** `lib/kernel/index.ts`, memory runtimes, `local/workspace.ts`,
  `local/confine.ts`, `local/model-worker.ts`, `lib/guards/**` enforce capabilities.
- **Letta:** `src/permissions/cross-agent-guard.ts`, `sandbox-policy.ts`,
  `memory-write-allowance.ts`, `src/sandbox/**` enforce file/process boundaries.
- **Close:** R8 threat matrix and R4/R5 negative cases; capability confinement
  must not be represented as an OS sandbox or optional sandbox as universal.

### G23 — Hosted/shared authority · Medium · C

- **Outcome:** private knowledge is not silently synchronized to a second owner.
- **Mahiro:** `runtime-router.ts`, `local/service.ts`, `local/model-worker.ts`
  provide no hosted organization/shared-repository authority.
- **Letta:** `src/agent/memory-git.ts`, `src/backend/api/**`,
  `src/cli/helpers/reflection-launcher.ts` support hosted/shared flows.
- **Close:** R0 exclusions and R8-02 record deliberate non-parity. No cloud
  implementation credit or denominator change follows from this exclusion.

### G24 — Context attribution gap · Medium · B

- **Outcome:** know estimated session usage and which memory projection contributed.
- **Mahiro:** `prompt.ts`, `local/projection.ts`, `local/palace-context.ts`
  expose bytes/projection/DTOs, not installed exact provider category accounting.
- **Letta:** `src/web/context-usage.ts`, `local-memory-context.ts`,
  `src/backend/local/system-prompt-compilation.ts` collect context estimates.
- **Close:** R7-02/03 and R8 resource accounting; quality/source labels, residual
  unknowns and unavailable values, never fabricated exact token categories.

### G25 — Operator command gaps · Medium · B

- **Outcome:** inspect/configure/recover without undocumented internal calls.
- **Mahiro:** `extensions/mahiro-agent-memory.ts`, `runtime.ts`,
  `experimental-runtime.ts` expose fewer operator jobs.
- **Letta:** `src/cli/app/use-submit-handler.ts`,
  `src/cli/helpers/reflection-launcher.ts`, `src/reflection-settings.ts` implement
  selection, configuration and memory-operation commands.
- **Close:** R3/R6/R7 command cases, help/argument refusal and outcome labels;
  prioritize jobs, not command-name cloning or excluded shared/cloud features.

### G26 — Companion doctrine · Medium · B/C

- **Outcome:** useful continuity remains fallible and subordinate to current authority.
- **Mahiro:** `guidance.ts`, `prompt.ts`, runtime writer dispatch and
  `agents/managed-memory-writer.md` define curation and authority delivery.
- **Letta:** `src/agent/prompts/letta_root_memfs.md`,
  `src/agent/subagents/memory-worker.ts` deliver experiential companion doctrine.
- **Close:** R2/R8 behavioral cases for correction and untrusted instructions;
  do not import identity prose or permission promotion for apparent parity.

### G27 — Mechanical retention is not semantic retention · Medium · B

- **Outcome:** preserve useful reasons while allowing obsolete beliefs to be corrected.
- **Mahiro:** `store.ts`, `engine/data.ts`, `guidance.ts` enforce shrink/reference
  heuristics and curation; passing them does not establish semantic preservation.
- **Letta:** `src/agent/memory-constraints.ts`, `src/memory-constraints.ts` enforce
  layout/size/read-only rules, not a proof of synthesis quality.
- **Close:** R2/R8 contrastive curation fixtures and H longitudinal review;
  label heuristics precisely and record inconclusive/no-edit outcomes.

### G28 — Local tests are not parity oracles · High · A

- **Outcome:** a green test cannot conceal the wrong user contract.
- **Mahiro:** `test/agent-memory-local-*.test.ts`, live memory tests and
  `check-public-sdk.mjs` cover distinct local and host seams.
- **Letta:** executable owners in G01–G27, with their adjacent tests, define the
  reference behavior; test names alone do not establish production wiring.
- **Close:** R0-04 and R8; label every claim L/D/N/I/O/H and include a plausible
  broken implementation that the exact probe would reject.

## Selected source directions — R0-03

These selections follow delegated repository execution on 2026-10-30. They are
source design decisions, not installed approval, human visual acceptance or a
claim that implementation exists. Follow this dependency order; later gates
remain open in the roadmap.

| Order / decision | Selected direction | Rejected alternative and risk | Next closure |
| --- | --- | --- | --- |
| 1 / D-SCHEMA · B | Retain Mahiro schema; explicitly map Core/index/persona/project owners to automatic/deferred outcomes and indexed discovery cues. | Bulk rename to Letta `MEMORY.md` for terminology would risk corpus collisions without delivering discovery. A mapping can still be wrong; differential trees must disprove it. | R1-01–04, R1-H. |
| 2 / D-PROJECTION · B | Compact automatic projection; defer detail with request-shaped discovery and separate excluded skills. | Whole-corpus injection or treating all `system/**` as core increases context and hides missing discovery. | R1-02/03 and R4 next-request proof. |
| 3 / D-TRAJECTORY · B/C | Bounded redacted evidence with stable IDs and captured ranges; exclude raw reasoning, credentials and unrelated private corpus. | Copying every tool payload or inheriting private context broadens authority; over-redaction can make learning ineffective. | R3-03–05, R8 privacy and human learning evaluation. |
| 4 / D-TRIGGER · A/B | Count finalized completed assistant steps closely; target future threshold 25 independently of the eight-entry batch cap. Support explicit off/compaction policy. | All-entry counting and deriving the threshold from batch capacity are rejected. The target is not today's installer default; chunking must not skip unreviewed entries. | R3-01–05; later settings/activation approval. |
| 5 / D-PROGRESS · A/B | Settle only captured range; late append remains pending; replay has separate progress from normal cadence. | Advancing to current tail or equating retry with deliberate replay loses evidence or duplicates progress. | R3 watermark/replay D fixtures then R4 I/O. |
| 6 / D-RECOVERY · B | Add explicit repair/abandon outcomes while preserving unknown publication and ownership evidence. | Inert conflict forever and automatic semantic merge are both rejected. Abandon must not erase an unresolved publication outcome. | R5-01–03 before live R4 activation. |
| 7 / D-SEAM · B | One ABI2-preserving installed slice, with a sole publication owner, generation drain and rollback proof. | Immediate replacement or a permanent third ABI compounds competing authority; local source completion is not installation. | R4 and R5, then R6 cutover gate. |
| 8 / D-PALACE · B | Committed snapshots by default; distinguish draft, integrated and active-prompt identity. Freeze invocation context. | Unlabeled live worktree reads or silently refreshing a fixed snapshot misrepresent session truth. | R1-02 and R7-01–05. |
| 9 / D-CONTEXT / D-HISTORY · B/A | Public Pi invocation-time Context with estimated/unavailable labels; separate bounded Git knowledge history from maintenance lifecycle. | Corpus coverage as Context, fabricated token splits and relabeling jobs as Git commits are rejected. | R7 context/history source, I/O and H gates. |
| 10 / D-SKILLS / D-EXCLUSIONS · B/C | Zero new package skills now, pending G-SKILL per recurring job. Preserve core/deferred/context-doctor quality through minimal adaptation only where admitted. Bulk/cloud skill adoption is excluded. | Copy-all, weak rewrites and scoring by file count are rejected. Existing roles may still fail to deliver guidance at the right moment. | R2 G-SKILL, packaging/install review and R8 exclusions. |

No C exclusion earns implementation points. Scope/denominator changes and any
new shared/network authority require a separate explicit decision. Human gates
for discoverability, learning quality, privacy trade-offs, visual/product quality
and longitudinal usefulness are not delegated to this document.

## Evidence classes and acceptance worksheet — R0-04

| Class | Meaning | Does not establish |
| --- | --- | --- |
| **L** | Local contract regression against Mahiro source, including deterministic synthetic cases. | Letta behavior, installed routing or product usefulness. |
| **D** | Latest-source differential tied to both exact pins, executable owner and falsifying case. | Execution of Letta or installed Mahiro equivalence. |
| **N** | Native/public-host integration through the real Pi SDK/lifecycle seam; Faux transport remains explicit. | Installation or provider-backed learning unless separately observed. |
| **I** | Read-only installed inventory or authorized installed integration, bound to package/profile/receipt identities. | Successful execution just because grants exist. |
| **O** | Observed bounded runtime behavior with command/result/time/session/revision identity. | Unobserved writer health or human acceptance. |
| **H** | Mahiro's explicit acceptance of a named product criterion and evidence scope. | Automatic approval of other criteria, activation or release. |

L/D/N belong to the source layer when that is all they exercise; they do not
stack extra credit. I and O contribute only their established outcomes. H is
human-owned. The roadmap's 50/20/20/10 weighting and 60%/30% baseline remain
unchanged by this documentation or the narrow R0 inventory.

For every case below retain a sanitized evidence identity: checklist/case ID,
Mahiro commit, Letta pin for D, test/symbol and command, date/result, fixture
identity; add package/receipt for I and session/revision/captured range for O.
Keep private receipts locally, not bodies or absolute roots in public worksheets.
Missing and failed evidence must remain distinct.

| Domain / dependencies | Positive case | Negative/refusal case | Fault/privacy case | Likely owners and evidence | Scoring eligibility / unclaimed boundary |
| --- | --- | --- | --- | --- | --- |
| Storage/schema/forgetting · R1/R6 | Map a synthetic corpus without losing useful owners; deleted knowledge remains excluded after restart. | Reject mapping collisions, unsupported paths and stale import. | Rename/copy/rollback cannot resurrect forbidden blob/source; interrupted import reconciles exact manifest. | `store.ts`, `engine/schema.ts`, `local/forgetting.ts`, `local/migration.ts`; L/D tree and policy IDs, later I/O root/revision receipt. | Source only after fixtures; no real-corpus migration, secure erasure or active rollback inferred. |
| Projection/retrieval · R1/R4 | Next request sees integrated core and finds deferred detail from a novel request cue. | Draft/private/foreign scope cannot appear as committed active context. | Publication during read yields one OID, not a hybrid; stale page and Unicode exhaustion are truthful. | `prompt.ts`, `retrieval.ts`, `engine/data.ts`, `local/projection.ts`; L/D fixtures, N prompt seam, I/O prompt/revision identity. | Source and later installed/runtime separately; no whole-corpus quality or exact token claim. |
| Reflection/trajectory/progress · R3/R4 | Completed assistant step 25 schedules bounded contiguous work; noop settles captured end. | User/tool/incomplete assistant rows do not count; off and replay cannot consume normal progress. | Late append, failure, retry and redaction preserve pending range without leaking raw reasoning/secrets. | `local/trajectory.ts`, `local/jobs.ts`, live runtimes; L/D transition IDs, N event trace, I/O range/digest. | No live defaults, cross-session access or learning efficacy credited from synthetic callbacks. |
| Writer/publication · R4/R5 | One authorized writer edits, integrates and becomes visible next request. | No Git/publication handle for worker; stale generation or unauthorized root refuses mutation. | Provider failure/cancel/timeout and conflict do not become false success or advance progress. | `local/model-worker.ts`, `local/service.ts`, runtimes, kernel; L/N job/commit IDs, I/O publication/prompt receipt. | Source SDK proof is not installed/provider proof; H learning review remains open. |
| Recovery/concurrency/lifecycle · R5 | Restart resumes a known outcome and a repair/abandon path leaves later work usable. | Replaced worktree/unknown owner is not deleted or adopted. | Crash at publication, helper timeout and custom-profile isolation retain uncertainty and settle resources. | `engine/recovery.ts`, `engine/lifetime.ts`, `local/service.ts`, `local/git.ts`; L/N fault IDs and platform, later I/O reconciliation. | No multi-process or OS-sandbox guarantee from single-process fixtures. |
| Commands/migration/operators · R3/R6 | Help/config/export/shadow/restore jobs return distinct actionable states. | Invalid arguments, foreign scope and stale revision refuse; shadow never claims authority switch. | Interrupted migration resumes exact manifest; rollback refuses non-quiescent state. | Extension, runtimes, `migration-export.ts`, `local/migration.ts`; L/N commands, I receipt, O operation/revision. | Shadow proof is not backup/restore, reverse migration or cutover acceptance. |
| Palace/context/history · R7 | Invocation captures frozen session usage and committed knowledge/history; separate lifecycle view. | Missing context is unavailable, not corpus-derived; hidden/forgotten path cannot be fetched. | Latest-intent race, stale commit, 320px/200% zoom, script body and shutdown drain. | `palace-context.ts`, `palace-server.ts`, `palace-page.ts`, future extension seam; L/D/N payload IDs, I/O command identity, rendered evidence, H verdict. | Rendered preview is not installed Palace; provider-exact category breakdown and visual acceptance unclaimed. |
| Memory guidance/skills · R2 | Core synthesis keeps reasons; deferred one-home/request cues support future discovery. | Wrong trigger, unavailable tool or inconclusive diagnosis returns no-edit/refusal. | Contradictory/noisy inputs cannot promote historical instructions into authority or silently install skills. | `guidance.ts`, writer/reflector roles, admitted skills only; L/D job rubrics, later I discoverability, O task outcome, H review. | Zero new skills now; no quality credit for prose volume or installed skill assumptions. |
| Authority/privacy/isolation · R8/R4/R5 | Authorized primary/child scopes complete the intended maintenance task. | Cross-root, stale identity, secret operand and ungranted capability refuse at real boundary. | Config relocation, worker escape, hostile entry text and teardown cannot expose private corpus/profile data. | Kernel, guards, runtimes, `local/confine.ts`, workspace/model worker; L/D threat IDs, N/I/O denied/allowed cases. | No blanket security superiority, universal sandbox or hosted/shared equivalence; C boundaries remain explicit. |

### Sanitized installed/runtime observations — R0-I / R0-O

Observation date: **2026-10-30**, from the active native Pi session. The exact
ignored record is `r0-installed-observation.md` named above.

- The current repository is registered as an installed Pi package. Direct
  extension entries are the Root guard bootstrap and worker-activity extension;
  the package manifest owns other entries. Inventory is not proof of activation
  of every source module in this checkout.
- Completed bootstrap receipt digest:
  `36bc0dc128c5fb091f8375bacb93e18eda75e6a7c8a46c74a1f7b0926eb1d023`.
  Its 31 capability names include the five `agent_memory_*` tools and managed
  memory DATA capability. Only sanitized names/presence were inspected.
- Selection reports schema 2, mode `engine`; `runtime-router.ts` maps ABI2/engine
  to `experimental-runtime.ts`. Sanitized permission inspection reports `allow`
  for DATA and all five memory tools. The exact root is intentionally omitted.
- Discovery v2 `agent_memory_read` namespace pages at offsets 0 and 32 succeeded,
  reporting 45 namespaces and current view-snapshot metadata. Committed/base/
  current revision was `5a3eb75235fb6cf13c30e3e662d1ff4e1cdc5e48`.
- `agent_memory_manage({ action: 'status' })` was unavailable, reason `unknown`,
  despite valid shape. This is unavailable health evidence, not empty state,
  success, a proven root cause or writer/publication health.
- No private file body, credential or profile payload was exported. No profile,
  permission, model, installation, memory, Palace or authority mutation occurred.
- Local-service and HTML Palace installation are **not established**. This
  observation identifies the selected ABI2 tool surface and one working bounded
  read only. It supplies no end-to-end parity increase or later I/O gate closure.

## Residual choices and cheapest falsification

R0-S completed on **2026-10-30** through fresh read-only verification of the
owner map, pins, differential, selected semantics, worksheets and sanitized
installed claims. The review found no high/medium issue; one low owner-reference
precision issue was corrected above. Human gates remain open for R1 discoverability/compactness, R2
skill admission, R3 privacy and cadence, R4 end-to-end usefulness, R5 recovery
operator burden, R6 migration/cutover, R7 visual/product direction and R8 learning/
resource acceptance. Any filesystem/network authority expansion, live profile
change or release still needs its actual scope gate; source selection is not a
substitute. No scores change here.

The cheapest next falsifying probe is a synthetic R3 differential: keep the
current eight-entry range cap, supply user/tool rows plus finalized assistant
steps across batches, and ask whether threshold 25 can be represented without
counting non-assistant rows or skipping unreviewed entries. Current
`normalizeTrajectoryConfig()` couples threshold to the range cap, so the proposed
contract is not implemented. Record that failure before editing the implementation;
then prove captured-end settlement, late append and replay isolation. This costs
no private corpus access, provider call, installation, live cutover or browser
polish. R1 mapping fixtures and R5 recovery design can proceed as source work;
installed R4 activation waits for their required gates.
