# Letta parity R5 — synthetic recovery and lifecycle limits

[← Roadmap](letta-parity-roadmap.md) · [Memory contract](agent-memory.md) · [R3 trajectory](letta-parity-r3.md)

## Scope and evidence boundary

2026-10-30 source milestone, based on Mahiro `606ee196b2924ee434d651920eed7bf230946532`.
This appendix describes the disconnected service in `lib/agent-memory/local/`.
It does not add installed commands, connect the service to ABI1/ABI2, migrate
private memory, change reflection defaults, or establish installed, observed or
human acceptance. Scores remain **60% source / 30% evidence** under the roadmap.
R5-S remains open for fresh verification and the unresolved concurrency/helper
outcomes below. R5-I/O/H are not claimed.

Executable owners: `contracts.ts` defines records and public request types;
`jobs.ts` parses compatible version-1 records and preserves recovery evidence;
`service.ts` owns serialized coordinator turns and the public methods;
`repair.ts` constructs/verifies the exact reviewed candidate and publishes by CAS;
`trajectory.ts` alone settles progress. `migration.ts` owns quiescent shadow
rollback. `palace.ts` and `palace-page.ts` expose read-only recovery metadata,
never recovery controls or publication authority.

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
continues to block rollback. This is same-process synthetic quiescence, not a
cross-process exclusion guarantee.

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
| Lease/generation retirement | Installed owner retires admissions and waits for actual holds; local service has no installed generation lease. | `profile.ts`, kernel registry/memory lease and engine lifetime owners; not exercised as installed R5. |
| Worktree adding / added / ownership / path save | Recorded progress and exact registration/inode ownership are reconciled; unknown paths are not adopted as owned. | Existing lifecycle interruption fixtures; no cross-process safety claim. |
| Worker write, before commit | Partial/dirty owned work is retained; worker is not automatically rerun. | Lifecycle and failed-reflection tests. |
| Worker commit before job save | Exact single-parent worker commit can be recovered from the owned worktree. | Lifecycle commit interruption fixture. |
| Conflict recognition | repair-needed keeps original worker and conflict evidence; watermark stays put. | Recovery/trajectory tests; legacy original conflict head can be unavailable. |
| Repair tree/object creation before prepared record | Main is unchanged; unreachable Git objects may remain. | Source ordering; no injected OS/power-loss experiment. |
| Prepared record before CAS | Same resolutions reconstruct exact candidate; abandonment and other worker starts refuse. | `repair-prepared` seam, restart and stale-policy/head tests. |
| CAS before terminal save | Exact candidate at main is recognized; no second candidate or progress settlement. | `repair-published` seam. A different main remains unknown/refused. |
| Terminal save before response | Identical request returns same repaired record; abandon repeats unchanged. | `repair-terminal` and abandonment restart tests. |
| Ordinary publication before watermark save | Existing integrated/no-op settlement is job/digest-bound and idempotent. | R3 trajectory fixtures; recovery terminal states are never eligible. |
| Worktree cleanup/remove | Owned removal progress reconciles; foreign identity is not deleted. | Existing lifecycle cleanup interruption fixtures. |
| Shadow rollback rename | Migration turn then service turn, quiescence check, quarantine rename, process-local retirement. | Migration fixtures including public abandon; rename is not live authority cutover. |
| Drain/helper timeout | Installed executor seals only after joined operations; local Git currently rejects timeout before descendant settlement proof. | Source audit only for hung helpers; R5-05 stays open. |

## Concurrency and generation matrix — R5-03 remains open

| Actor/binding | Established limit | Unresolved / refusal boundary |
| --- | --- | --- |
| Two service handles, same canonical root and process | Shared module turn serializes operations; prepared repair blocks new worker starts, Git CAS binds exact main. | A second process does not share this queue. No filesystem transaction/claim has been added. |
| Different local roots | Turn keys and job/index paths are root-scoped. | Not hostile same-user metadata resistance; do not reuse roots across concurrent processes. |
| Cross-process initialization, enqueue, repair, cleanup or rollback | **Unsupported** as mutually exclusive operations. CAS only protects a ref update, not all side effects. | Metadata sequence/job overwrite and premature recovery/cleanup can race. R4 activation remains blocked. |
| Local worker callback | Callback is awaited inside its coordinator turn. | No independent cancellation/generation token for escaped or malicious callbacks; ordinary worker has a trusted test harness filesystem handle. |
| Installed ABI1/ABI2 generation | Native-MJS registry, actual manager/primary identity, revision/root binding, exact lease object and conditional retirement remain separate owners. | Not reused to imply an installed local-service lease. No PID/dead-parent lock stealing. |
| Publication executor | `engine/publication-executors.mjs` uses operation ID/digest plus process-local nonce and explicit drain seal. | No disk reconstruction of executor authority. This is not cross-process local-service ownership. |
| Revocation/stale callback | Kernel/engine revalidate their own live bindings; unknown results retain uncertainty. | Synthetic recovery does not grant a worker publication or profile authority. Installed R5 overlap/revocation tests remain pending. |

No new cross-process claim/lock protocol is introduced in this bounded milestone.
The limitation is explicit rather than papered over by process-death heuristics.

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

## Git/helper lifecycle audit — R5-05 remains open

| Owner / OS | Bounded behavior | Settlement limit |
| --- | --- | --- |
| `local/git.ts`, all current Node platforms | shell false; sanitized environment, no credential helper/hooks/fsmonitor; 1 MiB ordinary stdout, 64 KiB diagnostics, 10 s timeout; bounded blob prefix capture. | Timeout/output failure sends direct-child SIGTERM and rejects immediately. No detached group, escalation or descendant join. Successful child close is not universal helper-tree proof. |
| `agent-memory/store.ts` | Synchronous Git, shell false, deadline-clamped ≤10 s, 2 MiB maxBuffer; authority fences before Git operations. | `execFileSync` timeout is not an audited HTTP/SSH descendant drain contract. |
| Engine executor locks | Exact executor ID/digest/nonce and explicit drain seal protect lock removal. | Executor bookkeeping is not evidence every Git helper has settled. |
| POSIX HTTP/SSH helpers | Local service exposes no remote fetch/push API and disables credential helpers. | Git can still create internal children; no group settlement fixture or production change here. |
| Windows helper trees | No new implementation claimed. | No taskkill/process-tree fixture; timeout cannot be labeled drained. |

Do not authorize cleanup or lock release solely because a timeout promise
returned. Proving a portable process-tree owner needs its own bounded helper
fixtures, cancellation and close/escalation design; it is deliberately not
attempted here. R5-05 and R5-S remain open, blocking a full R5 safety exit.

## Focused source evidence

Primary new suite: `test/agent-memory-local-repair.test.ts` covers exact explicit
repair, stale/malformed/missing/extra/protected/content refusals, retained original
and reviewed heads, candidate parents, three restart seams, pending abandonment
refusal, terminal idempotency, unchanged progress, fresh covered reflection,
forgotten bytes and policy/head changes after preparation. Migration fixtures now
use **public abandon**, not synthetic job-file status rewriting, to unblock
rollback after exact cleanup; repair index/lock residue still blocks. Palace
fixtures check current guidance; new service tests check repaired/abandoned
metadata and retained conflicts.

Companion gates: local lifecycle, trajectory and R3, model-worker, forgetting,
migration, Palace, projection and setup source tests; `pnpm format`,
`pnpm check:format`, `pnpm check:docs`, `pnpm check:fast`, `git diff --check`.
The milestone handoff records actual results. Tests and source review do not
establish Letta runtime equivalence, helper-tree settlement, installed generation
safety, semantic learning quality, R5-S independent acceptance or R5-I/O/H.
