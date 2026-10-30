# Letta parity R5 — synthetic recovery and lifecycle limits

[← Roadmap](letta-parity-roadmap.md) · [Memory contract](agent-memory.md) · [R3 trajectory](letta-parity-r3.md)

## Scope and evidence boundary

2026-10-30 source milestone, extended from Mahiro
`72cf270094929c26a9485205f950334bced89a93`. This appendix describes the
disconnected service in `lib/agent-memory/local/`. It does not add installed
commands, connect the service to ABI1/ABI2, migrate private memory, change
reflection defaults, or establish installed, observed or human acceptance.
Scores remain **60% source / 30% evidence** under the roadmap. R5-S is complete
only for the bounded synthetic source contract below; R5-I/O/H remain open.

Executable owners: `contracts.ts` defines compatible version-1 records and public
request types; `jobs.ts` parses those records and preserves recovery evidence;
`coordination.ts` owns the cooperative root claim and capability identity;
`git-process.ts` owns drained-versus-uncertain direct-child disposition; `git.ts`
owns fixed local commands and repository configuration refusal; `service.ts` owns
coordinator turns and public methods; `repair.ts` constructs/verifies the exact
reviewed candidate and publishes by CAS; `trajectory.ts` alone settles progress.
`migration.ts` composes open/import/rollback under the same root claim. `palace.ts`
and `palace-page.ts` expose read-only recovery metadata, never recovery controls
or publication authority.

## Explicit recovery contract — R5-01

The public **synthetic local-service API**, not `agent_memory_manage`, exposes:

```ts
await service.repair({
  id: 'conflict',
  expectedHead, // explicitly reviewed current main
  workerCommit, // exact original worker commit
  resolutions: { 'Core.md': 'caller-reviewed replacement\n' },
})
await service.abandon('conflict')
```

| From | Operation | Result | Publication / progress |
| --- | --- | --- | --- |
| repair-needed, no pending candidate | repair with exact valid resolutions | repaired | Coordinator CAS publishes exact candidate; **no watermark settlement**. |
| repair-needed, prepared candidate | same repair request | repaired, or retained refusal | Reproduces exact tree and parents; recognizes already-published exact candidate. No worker rerun or progress. |
| repair-needed, no pending publication | abandon | abandoned | No publication, no progress, no evidence deletion or automatic cleanup. |
| repaired | identical repair | same repaired record | Idempotent, even if main subsequently changes. |
| abandoned | abandon | same abandoned record | Idempotent. |
| repaired / abandoned | resume or integrate | unchanged | Terminal. Retry is refused. |
| failed reflection | retry | queued, same snapshot | Existing failed-only retry; no launch or progress until later execution. |

Every resolution must cover exactly one recorded conflict path: no missing,
extra, traversal or duplicate recorded path; at most 32 paths. Each value is
UTF-8 round-trippable text, no NUL, at most 262,144 bytes, or explicit `null`
for deletion of a non-required file. A protected `Core.md` or `index.md` that
already exists in the reviewed canonical head cannot be deleted and must remain a
regular file. A legacy synthetic root that never had `index.md` remains supported; repair
does not invent that file. The candidate admits
only bounded regular UTF-8 blobs: at most 1,024 merged entries and 8 MiB total
text. Unsupported special modes, directory/file conflict shapes, oversized
corpora or missing required compact files fail closed. This is not a universal
Git conflict editor or a semantic quality judgment.

The coordinator verifies worker lineage, recomputes Git's non-conflicting tree
against the caller's expected head, and checks its conflict set matches the
recorded conflict set. All conflict-marker blobs are replaced with caller
resolutions. Non-conflicting edits are retained mechanically, not semantically
merged by a model. A newer head may be reviewed explicitly **only before** a
candidate is prepared and only if the same conflicts still apply. Original
`baseHead`, `workerCommit`, `conflictHead`, `conflictPaths` and reflection snapshot
remain immutable. A legacy record missing `conflictHead` stays unknown/null;
repair never invents a historical head.

Path/blob tombstones and exact source/project-path exclusions are checked;
forbidden inherited non-required entries are omitted, forbidden required files
refuse, and a forbidden explicit resolution refuses. Forgetting remains logical
non-resurrection, not secure history erasure. Existing tombstone imports admit
one immutable snapshot; an initial import after preparation also changes the
policy identity and blocks the stale candidate.

Before publication the coordinator durably saves `repair` evidence: reviewed
head, worker commit, canonical resolution digest, forgetting digest, exact tree
and candidate commit. `pendingIntegration`/`expectedParent` bind that candidate.
The candidate has exactly two ordered parents: reviewed head and original worker.
Restart reproduces the tree and verifies parents, candidate and policy identity;
then it CAS-updates `refs/heads/main` or recognizes that exact candidate already
at main. Terminal save clears the pending pair but retains all repair evidence
and conflict paths. No resolution text is duplicated into job JSON; the exact
candidate tree retains it in Git. A crash before candidate persistence may leave
unreachable objects, but cannot publish. This is restart safety at the tested
record/CAS boundaries, not a power-loss/fsync durability proof.

If main or forgetting policy changes after preparation, the service refuses
rather than changing the reviewed candidate, deleting evidence or guessing
whether publication occurred. Abandon refuses **every** pending publication,
including legacy pending records without repair evidence. There is currently no
public supersede/discard operation for a stranded prepared candidate. Keep it
for a separately reviewed recovery design; do not edit job files to pass gates.

### Trajectory and rollback

**Conflict, repair attempt, failed repair, successful repair and abandonment do
not advance or settle a trajectory watermark.** `settleReflection` still accepts
only `integrated` and verified `noop`. Repaired/abandoned snapshots no longer
hold the selection window indefinitely. A later eligible `reflect` may create a
fresh job from the unchanged watermark, but must cover the released snapshot's
captured IDs/content under R3's existing selected/omitted integrity limits.
Deletion, selected-prefix rewrites or mismatched identity refuse. Explicit replay
remains evidence selection only. A fresh job can later settle through ordinary
integration/no-op; recovery itself never consumes experience. Job capacity still
bounds retained history at 32 records; abandonment is not automatic history GC.

Shadow rollback accepts repaired/abandoned as terminal **only** with no pending
pair, owned worktree, ownership/progress/worktrees residue, or repair index/lock.
Abandon does not clean anything. Call the existing exact ownership-bound cleanup
separately; changed/foreign/dirty residue may still refuse. Migration now parses
full job records rather than trusting a status string. Pending/ambiguous repair
continues to block rollback. Quiescence and rollback now use the same cooperative
sibling claim as ordinary service operations. A competing current-version process
cannot enter or reconcile
the root during the check or rename. This is not hostile same-user resistance,
mixed-version safety or automatic stale-claim recovery.

Palace reports repaired/abandoned, refused retry, unchanged resume, retained
conflict paths, original conflict head and reviewed/candidate commit IDs. Terminal
historical conflicts are not new active repair requests. Forgetting filters still
hide conflict paths; bodies, resolution text, private roots and raw errors remain
absent. The HTML labels conflict evidence and unconsumed progress without adding
controls. No rendered/human acceptance is claimed.

## Pinned comparison and crash matrix — R5-02

Read-only comparison against Letta Code **0.34.31**,
`a8900b882446d7aa99fedf2845d400743affd1b6`, confirmed these source owners;
no Letta tests, builds, installers or provider workflows were executed:

- `src/agent/memory-operation.ts::claimMemoryOperation` uses process-bound
  operation claims; `memory-conflict-repair.ts` binds updates/removal to a unique
  attempt token. **Adapt token discipline:** a late completion must not modify a
  newer attempt. A process token alone is not permission or publication proof.
- `memory-worktree.ts` lines 607–630 aborts a failed merge and attempts forced
  worktree/branch cleanup to enable transcript retry. Other integration failure
  paths also force cleanup. Executable behavior outranks upstream guide wording.
  **Reject destructive cleanup as recovery authority:** Mahiro preserves worker,
  conflict and exact publication evidence until explicitly reviewed disposition.
- `memory-git-process.ts` uses detached POSIX children, group SIGKILL, Windows
  `taskkill.exe` fallback and waits for child close after timeout. Useful direction,
  not evidence that Mahiro's current helpers drain. PID/start-time or dead-parent
  evidence must never erase an unknown publication outcome.

| Boundary | Current source disposition after interruption / restart | Evidence / remaining limit |
| --- | --- | --- |
| Lease/generation retirement | Installed owner retires admissions and waits for actual holds; the disconnected local service now uses one exclusive sibling claim bound to root identity, v1 service nonce and a random operation token. | No PID/age takeover, mixed-version protocol or installed generation lease. A dead/partial/uncertain claim stays blocking. |
| Worktree adding / added / ownership / path save | Recorded progress and exact registration/inode ownership are reconciled; unknown paths are not adopted as owned. | Current-version competing processes are excluded by the root claim; hostile external metadata mutation remains unsupported. |
| Worker write, before commit | Partial/dirty owned work is retained; worker is not automatically rerun. | Lifecycle and failed-reflection tests. |
| Worker commit before job save | Exact single-parent worker commit can be recovered from the owned worktree. | Lifecycle commit interruption fixture. |
| Conflict recognition | repair-needed keeps original worker and conflict evidence; watermark stays put. | Recovery/trajectory tests; legacy original conflict head can be unavailable. |
| Repair tree/object creation before prepared record | Main is unchanged; unreachable Git objects may remain. | Source ordering; no injected OS/power-loss experiment. |
| Prepared record before CAS | Same resolutions reconstruct exact candidate; abandonment and other worker starts refuse. | `repair-prepared` seam, restart and stale-policy/head tests. |
| CAS before terminal save | Exact candidate at main is recognized; no second candidate or progress settlement. | `repair-published` seam. A different main remains unknown/refused. |
| Terminal save before response | Identical request returns same repaired record; abandon repeats unchanged. | `repair-terminal` and abandonment restart tests. |
| Ordinary publication before watermark save | Existing integrated/no-op settlement is job/digest-bound and idempotent. | R3 trajectory fixtures; recovery terminal states are never eligible. |
| Worktree cleanup/remove | Owned removal progress reconciles; foreign identity is not deleted. | Existing lifecycle cleanup interruption fixtures. |
| Shadow rollback rename | Migration turn plus the same root claim, two quiescence checks, quarantine rename, moved-inode verification and process-local retirement. | Competing current-version open/recovery is refused until the original sibling claim is released; rename is not live authority cutover. |
| Drain/helper timeout | Fixed local Git commands return normally only after child `close`. Timeout or stdout/stderr overflow first poisons the claim, requests direct-child termination and returns `LocalGitUncertainty`; cleanup/reopen stays blocked. | This retained-uncertainty disposition does not claim universal descendant settlement or arbitrary HTTP/SSH support. |

## Cooperative concurrency and generation — R5-03 source-supported

Every synthetic operation, including startup, reconciliation performed by reads,
worker execution, repair/publication, cleanup, tombstone import, migration open
and rollback, acquires one sibling `<stateRoot>.operation-claim`. Acquisition uses
direct exclusive/no-follow creation. The bounded record names a random token,
root device/inode, operation, diagnostic PID and the existing v1 service nonce
when present. The existing process-local turn remains only an ordering
optimization. Version-1 meta, job, trajectory and watermark records remain
compatible.

An existing, empty, partial, malformed or dead-owner claim is never removed or
stolen by PID, parent death, age or timeout. Only the exact holder verifies the
claim file identity/token and removes it. Each existing service handle also pins
the original root device/inode and service nonce; replacement or nonce changes
poison the operation and leave the sibling claim blocking. Startup holds one
claim through repository seed and forgetting-policy readiness. Migration composes
startup and tombstone import under that same non-reentrant claim; rollback keeps
it through both quiescence checks, rename and moved-inode verification, then
releases the original sibling path.

| Actor/binding | Established source contract | Deliberate limit |
| --- | --- | --- |
| Same root, current-version cooperative processes | Exactly one holder can initialize, reconcile, enqueue, write job/meta state, repair, clean or roll back. Losers refuse before mutation. | No waiting/takeover protocol; a crash can strand the root indefinitely. |
| Different roots | Claim, process-local turn, job state and Git repository are root-scoped and can progress independently. | Network filesystems and hostile same-user replacement are unsupported. |
| Worker callback | Ordinary workers receive only `jobId` and a fenced `write`; maintenance workers receive the confined workspace. Every adapter method checks an active capability before I/O. | Arbitrary JavaScript with independently acquired filesystem authority is not sandboxed. |
| Revocation/stale callback | Capability revokes in an inner `finally` before staging, failure save or claim release. Retained methods refuse. Claim/root/meta identity is rechecked before durable transitions and publication. | No forced cancellation of a callback that never settles; it continues to hold the claim. |
| Publication | Worker has no Git/ref/claim authority. Coordinator retains exact candidate/parent checks and expected-old-ref CAS. | CAS is publication evidence, not permission to steal or clear a claim. |
| Installed ABI1/ABI2 generation | Remains owned by the native registry, primary identity, revision/root binding and lease lifecycle. | The sibling claim is disconnected synthetic coordination, not an installed ABI3 or profile lease. |

The guarantee applies only when every actor uses this current protocol. Older
binaries that ignore the sibling claim, hostile same-user mutation, power-loss
atomicity and automatic recovery of retained claims remain unsupported. The
availability trade-off is intentional: uncertainty may strand a synthetic root,
but it cannot silently become mutation, publication, cleanup or rollback
authority.

## Config-root audit — R5-04

| Owner | Current root resolution / protection contract |
| --- | --- |
| `install.mjs`, `setup.mjs`, `lib/setup.ts` | Shared `resolveAgentDir`: explicit path wins, then `PI_CODING_AGENT_DIR`, then home `.pi/agent`; expands `~`/`~/`; rejects relative/non-normalized roots. Empty override uses default. Explicit installer composition passes reviewed agentDir into children. |
| `lib/kernel/index.ts` | Now uses **the same `resolveAgentDir()`** for Goal/feature profile selection, retaining its additional absolute/normal/realpath check. Separate environment parsing removed; no permissions or default-root fallback added. |
| Memory runtime/profile | `runtime.ts` uses explicit config/root override or profile memory; profile selection (`profile.ts`) binds exactly `<profile>/memory`, rejects invalid/mismatched selection and does not fall back. ABI1 explicit custom root remains an independently permission-bound input, not an alternate profile bypass. |
| Agent descriptors/routes | `writer-route.ts` receives the resolved profile; kernel/runtime resolve through `resolveAgentDir`. Role bytes/route locks and paired selection remain unchanged. |
| Viewer | `palace-preview.mjs` accepts no state-root argument; local service requires an explicit canonical synthetic directory. Migration/shadow and preview do not select a live profile. |
| Guards | `guards/host.mjs` has no profile parser or maintained-memory authority. Recognized secret operands resolve from tool cwd; public PSS owns permissions and kernel owns memory binding. Relocation does not disable secret-operand filtering. |
| Tests | `setup.test.ts` covers explicit, override, home, tilde, empty, relative and legacy-normalization refusals and asserts kernel wiring plus retained realpath validation. Fixtures use explicitly owned roots and remove only their newly created state. |

This is a source inventory and smallest shared-resolver correction, not installed
alternate-root security acceptance. Public native loader/PSS root behavior and
rendered viewer use must be established at the installed R4/R5 gates. The default
legacy location is only a default input, never an authority fallback after a
selected root fails. No profile, auth, permission or private root was changed.

## Local Git settlement and unsupported helper trees — R5-05 source-supported

The disconnected service supports only its own fixed local Git commands against
a service-created repository. The environment disables protocols, lazy fetch,
replace objects, prompts and ambient system/global configuration. Every command
also disables hooks, attributes, alternates commands, credentials, askpass, SSH,
external diff, fsmonitor and signing. Before use, the repository config is parsed
through a narrow `core`/`extensions` allowlist; include, remote, filter, alias,
merge-driver and other helper-bearing sections refuse before the command.

| Outcome | Coordinator disposition | Authority consequence |
| --- | --- | --- |
| Child closes with an allowed code | Drained fixed-command result. | Claim may continue and later release after all coordinator work completes. |
| Child closes with an ordinary disallowed code | Drained command failure. | Error may be recorded while the exact claim remains valid. |
| Child closes by signal or without a code | `LocalGitUncertainty`. | Claim is poisoned and retained; no cleanup/reopen authority. |
| 10 s timeout, >1 MiB stdout or >64 KiB stderr | Poison claim, request direct-child TERM then KILL, observe for a bounded second, return `LocalGitUncertainty` whether or not the direct child closes. | Evidence/index/worktree and sibling claim remain; catch/finally cleanup and failed-job rewriting are suppressed. |
| Blob prefix read | Size is checked first, blobs above 8 MiB refuse, and the process drains/discards the suffix while retaining only the requested prefix. | Reaching the prefix is no longer a termination event. |

Public Node APIs cannot prove settlement of arbitrary descendants that escape a
process group, close inherited pipes, or use Windows helper trees. This source
exit therefore does **not** claim portable HTTP/SSH/helper-tree drainage. Instead,
those protocols/configurations are outside the supported local-service surface,
and every forced interruption is classified unknown rather than drained. No
process-group kill, `taskkill`, PID death or child `close` after forced termination
is promoted to cleanup authority. Installed ABI1/ABI2 Git owners retain their
separate contracts.

R5-05 is complete only as this narrower support/refusal decision: normal fixed
local commands settle; interruption retains ownership. Linux/Windows observation,
universal descendants, automatic retained-claim recovery and installed helper
behavior remain open at R5-I/O/H rather than being inferred from Darwin fixtures.

## Focused source evidence

`test/agent-memory-local-repair.test.ts` covers exact explicit repair,
stale/malformed/missing/extra/protected/content refusals, retained original and
reviewed heads, candidate parents, three restart seams, pending abandonment
refusal, terminal idempotency, unchanged progress, fresh covered reflection,
forgotten bytes and policy/head changes after preparation. Migration fixtures use
**public abandon**, not job-file status rewriting, to unblock rollback after exact
cleanup; repair index/lock residue still blocks.

`test/agent-memory-local-coordination.test.ts` uses child-process barriers to
exercise a held root versus a competing opener/rollback, independent roots,
partial and dead-owner claims, recursive refusal, retained ordinary and maintenance
capabilities, root/meta replacement, rollback exclusion and release of the
original sibling after rename. `test/agent-memory-local-git-process.test.ts`
exercises normal and nonzero child close, bounded prefix drainage, stdout/stderr
overflow, timeout retention, callback-reported uncertainty and helper-bearing
config/protocol refusal. The fixtures own and clean only their disposable roots;
they never contact a remote or read private state.

Companion gates: local lifecycle, trajectory and R3, model-worker, forgetting,
migration, Palace, projection and setup source tests; `pnpm format`,
`pnpm check:format`, `pnpm check:docs`, `pnpm check:fast`, `git diff --check`.
The milestone handoff records actual results. Fresh source QA passed the bounded
claim/settlement contract with no material finding; low unexercised event-order
branches include spawn failure, stdin EPIPE, unexpected signal and descendants
holding inherited pipes through the one-second observation deadline. These are not
known defects, but the test set is not exhaustive process-tree certification.
Tests and source review do not establish Letta runtime equivalence, universal
helper-tree settlement, installed generation safety, semantic learning quality,
cross-platform observation or R5-I/O/H.
