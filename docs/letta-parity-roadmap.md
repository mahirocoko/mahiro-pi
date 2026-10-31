# Letta maintained-memory roadmap

[← Documentation](README.md) · [Memory contract](agent-memory.md) · [Development](development.md)

This is the current direction for Mahiro Pi maintained memory. The detailed R0–R8
pages are retained as dated implementation records; they no longer define a growing
proof ladder, percentage target or mandatory test matrix.

## Scope and authority

Letta Code is the implementation baseline for maintained memory, reflection,
migration and Palace. Before a new comparison, verify the reference checkout is
clean and update it with `git pull --ff-only`. If it cannot fast-forward safely,
stop rather than reset it. Record the exact inspected commit/version when source is
copied or materially compared.

Current references:

- full-product audit baseline: Letta Code `a8900b882446d7aa99fedf2845d400743affd1b6`
  / v0.34.31;
- latest pulled visual reference: `8f72222dec142dfc2316692d68ada3ab2e439d46`
  / v0.34.36;
- the memory-viewer template is unchanged between those two references.

Executable source and observed product behavior outrank documentation, tests,
reports and old roadmap language. Current human direction outranks every historical
appendix.

## Current direction

Follow Letta Code directly instead of designing a parallel Mahiro interpretation:

1. locate the current upstream owner;
2. copy or adapt its behavior with the smallest practical change;
3. keep an existing Mahiro authority, privacy, security or transport difference only
   when it actually conflicts with upstream behavior;
4. run the smallest focused check or smoke that can catch the likely regression;
5. stop when the feature works and no real failure remains.

Do not create a new local specification, gap taxonomy, score, evidence worksheet,
edge-case contract or verifier/browser loop for behavior that already matches Letta.
Synthetic fixtures and receipts may help debug a defect, but they are not product
quality and must not create more work by themselves.

## Current product state

- ABI2 remains the live maintained-memory authority and preserves the existing
  private corpus.
- Source now includes bounded automatic reflection scheduling: 25 eligible assistant
  messages trigger a frozen backlog, delivered in chunks of at most four episodes.
  Only delivered episodes can be reviewed. Outstanding assistant credit is the
  sum of optional `assistantSteps` on turn episodes in the bounded episode
  directory, excluding committed reviewed and forgotten ids. Legacy episodes
  count as zero and compaction episodes have none. Admission is that one
  episode file; it does not take the publication lock. A crashed publication
  lock therefore does not block later observations. `createPrivate` can leave a
  second hard link if cleanup does not run; readers refuse that file while two
  links remain, and nothing deletes either name. Two controllers can both pass
  the 255-file check and admit two more files. The directory then fails closed
  above 256. Neither case is repaired by deleting files or taking over a lock.
  Source checks do not by themselves establish installation or live behavior.
  Exact `pnpm check` and `pnpm test` may store the command. Older
  `pnpm check:*`, `pnpm test:*`, and `node --test` results stay result-only.
  Commandless records keep the previous read check. The recognizer does not
  prove that unlabeled text or other labeled credentials are free of secrets.
- The disconnected `lib/agent-memory/local/**` Git/worktree service remains source
  experimentation. It is not silently combined with ABI2 or activated by this roadmap.
- `/mh-memory palace`, `palace close` and `palace json` remain the public Palace
  façade. The installed page now follows the pulled Letta memory-viewer visual grammar.
- Palace visual work is complete for the current scope. Do not resume screenshot,
  zoom, score or taste-review loops unless Mahiro reports a real defect.
- Existing migration/recovery experiments remain available as source history. They
  are not prerequisites that must be repeatedly reproven before ordinary development.
- Profile mutation, private migration, live authority cutover, tag and release remain
  separate explicit actions because they change user state or publication, not because
  a percentage or evidence gate is missing.

## Next implementation

Continue one real upstream behavior at a time:

1. pull the current Letta reference before inspection;
2. inspect the relevant upstream implementation, not its issue title or tests alone;
3. port the behavior when Mahiro does not already have it;
4. keep a no-op when current Mahiro behavior already matches the outcome;
5. add only a focused regression for Mahiro-specific adaptation or an observed bug.

The next source change should be selected from a concrete current Letta memory delta
with visible product value. Do not spend a phase proving that a no-op, screenshot,
percentage or synthetic journey is complete. If the next useful change requires
private-profile mutation or live cutover, stop at that action boundary and request
that scope directly.

## Verification

Default verification is narrow:

- docs-only change: documentation check and diff/whitespace check;
- direct source port: exact focused regression or smoke for the changed behavior;
- several owned contracts changed together: `check:fast`;
- release: the separately authorized release tier.

A fresh verifier, broad suite, browser pass, resource study or longitudinal run is
not a routine prerequisite. Use one only for a material authority/security/recovery
risk, a real regression, an unresolved finding or an explicit release decision.
Mahiro still owns subjective product acceptance; do not try to manufacture it from
more automated evidence.

## Domain scorecard

Percentage scoring is retired as an active planning mechanism. Historical 60/30 and
75/40 assessments remain in Git and the dated R8 record, but they do not determine
what to build next, authorize activation or require additional proof work.

## Roadmap and evidence gates

The former S/I/O/H ladder is historical vocabulary, not a mandatory phase machine.
Use the evidence layer that answers the actual question. A source change needs source
verification; a live-state change needs its real action receipt; a visual preference
needs Mahiro's review. Do not collect every layer for every change.

### R0 — Canonical contract and latest-source differential

Historical owner map and baseline record: [R0 appendix](letta-parity-r0.md). Reopen
only when an upstream owner materially changes.

### R1 — Schema, projection and discovery decision

Historical native schema/projection adaptation: [R1 appendix](letta-parity-r1.md).
Current code owns current behavior.

### R2 — Selective memory-skill admission and guidance quality

The dated guidance review remains in Git history. Do not create a new skill or
guidance layer when direct upstream behavior or existing owners are enough.

### R3 — Reflection, trajectory, watermark and replay semantics

Historical synthetic trajectory work: [R3 appendix](letta-parity-r3.md). Future
reflection changes should follow current Letta behavior directly.

### R4 — One installed end-to-end integration slice

Historical SDK route proof: [R4 appendix](letta-parity-r4.md). Do not repeat it as a
routine prerequisite.

### R5 — Repair, recovery, concurrency and helper lifecycle

Historical recovery/concurrency work: [R5 appendix](letta-parity-r5.md). Add recovery
logic only for an actual failure mode or direct upstream behavior.

### R6 — Migration, operator workflows and rollback

Historical migration/rehearsal work: [R6 appendix](letta-parity-r6.md). Private
migration or authority cutover still requires explicit action scope.

### R7 — Live Palace, context and knowledge history

Historical Palace/context work: [R7 appendix](letta-parity-r7.md). The current Palace
visual direction follows Letta Code and is complete unless a real product defect is
reported.

### R8 — Threat model, verification and acceptance readiness

Historical source/security closeout: [R8 appendix](letta-parity-r8.md). It is not the
current planning owner and its score arithmetic is not an active release gate.

## Memory guidance and selective skill admission

Prefer current upstream behavior and existing owners. Do not add a skill, role,
reminder or doctrine merely to explain work that the implementation can perform
directly.

### G-SKILL admission gate

Add a memory-specific skill only when Mahiro explicitly wants a distinct reusable
workflow and existing repository guidance cannot own it. Matching Letta behavior alone
is not a reason to add another skill.

### Candidate dispositions

- **Follow:** direct current Letta behavior.
- **Adapt narrowly:** only an existing Mahiro authority/privacy/security/transport
  conflict.
- **Do not copy:** Letta brand assets, hosted-account business logic, credentials or
  actions that mutate private/profile state without explicit scope.

### Six-job guidance scorecard

Retired. Job-by-job guidance scores are not a product target. Fix a guidance problem
when it appears in real use.

## Behaviors not to copy 100%

- Letta names, logos, wordmarks, images or other excluded brand assets;
- hosted-service/account behavior that Mahiro Pi does not own;
- credential, profile, private-memory, cutover or publication actions without their
  explicit scope;
- behavior that directly violates an existing Mahiro authority or privacy boundary.

## Decision log and open questions

- 2026-10-30: ABI2 remains live authority; disconnected local work is not silently
  activated.
- 2026-10-31: Letta Code becomes the direct implementation baseline. Percentage-driven
  parity work, mandatory evidence ladders and speculative proof loops are retired.
- 2026-10-31: Reflection scheduling follows the upstream step-count direction within
  ABI2's bounded episode and authority model; it does not claim durable transcript parity.
- 2026-10-31: Letta reflection modes at `59df542` are selectable on ABI2 through
  version-2 config and policy evidence. Version-1 records stay automatic-only:
  false is off and true is step-count 25. ABI1 still follows `automatic` and
  does not dispatch step-count or compaction-event.
- 2026-10-31: ABI2 session checks keep an operation-local leaf anchor and walk at
  most 8192 appended parent links, 64 per yield. A leaf change during a yielded
  chunk refuses that check. They do not call `getBranch` or freeze older
  ancestry. Append-only parent links are a public-session assumption. Exact
  capture still rejects a moved leaf.
- Open questions should be resolved when they block a concrete implementation, not
  expanded into a standalone audit phase.

## Next authorized-scope gates

No generic proof gate is next. Continue direct source work against current Letta Code.
Stop only at an actual permission boundary: private/profile mutation, live authority
cutover, tag, release, destructive cleanup or another explicitly protected action.
