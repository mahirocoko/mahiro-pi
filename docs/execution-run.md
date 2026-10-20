# Native Execution Run — source-only, default disabled

`extensions/mahiro-execution-run.ts` is the tenth manifest resource, after the
accepted nine in unchanged order. It registers **one** `mh_execution_run` tool
with `operation: get | create | update`, and `/mh-run`. The pure model is locally
adapted from canonical Mods `mods/mahiro-execution-run.ts`; the Letta entry is
unchanged. No legacy state is read, imported or synchronized.

## Ownership and meaning

This is an optional bounded coordination record, **not a private task board**.
Live TSK owns current tasks, outcomes, evidence and human acceptance. Every target,
lane, status, report, changed path, check, worktree, session and Goal/UX/Evidence
reference is caller-supplied metadata. `reported` does not mean successful,
verified, accepted, merged or Goal complete. `handed_off` means ownership metadata
moved forward, not acceptance. Failed/cancelled reports can be valid terminal
reports; executor kind `human` conveys no authenticated-human or verified flag.

The engine never launches agents, CLI, processes, Git or worktrees; reads project
sources/artifacts/other application state; controls workers, prompts or callbacks;
or mutates Goal, UX, Evidence, TSK or native subagent state. References remain opaque
and are never dereferenced. The generated `code_evidence_intake` is proposed
handoff metadata only, never automatic Evidence ingestion or collected evidence.

## Explicit private native configuration

The public native profile convention is `PI_CODING_AGENT_DIR` (including `~/`
expansion), otherwise `~/.pi/agent`, resolved by `lib/setup.ts#resolveAgentDir`.
There is no SDK runtime import, cwd override, role or profile provisioning.
An operator must separately author this canonical private file:

```text
<profile>/extensions/mahiro-execution-run/config.json
```

```json
{"version":1,"profile":"/canonical/private/profile","projects":["/canonical/project"]}
```

Only these keys are accepted. Config is strict UTF-8/JSON, at most 16 KiB, owned
single-link regular 0600; profile/config directories must be private 0700.
Projects are explicit existing canonical directories (at most 32), separate from
the private profile and excluded Letta/OneDee paths. The profile/state owner stays
separate from authored source owners and managed-memory/continuity roots. A tool's optional `workspace` selects only the authorized current
project, never an arbitrary storage scope. Missing configuration is disabled:
imports, registration, startup, status/get/list and empty clear initialize nothing.
No new installer, grant command or bootstrap subsystem is added; the existing
recursive source binding already includes these files.

State is `<profile>/workflow/execution-run/<sha256(project UTF8)>/state.json`,
with sibling `state.lock`. The closed native v1 envelope binds canonical profile,
project, monotonic sequence and native-session-keyed runs. Native Run identity uses
`profile`/`sessionId`, not fabricated Letta agent/conversation IDs. New sessions
never attach a sole existing run. Tree navigation does not rewind canonical state;
start/shutdown/before-switch/fork/tree invalidate retained read/UI tickets.
Root `lib/guards/index.ts` conservatively rejects native children and parent-linked human
forks; an unsupported fork needs a fresh primary session, not an auto-move.

## Canonical authority

Root `lib/guards/index.ts` alone exposes the candidate ABI `executionRun: {version:1, generation, assertAccess,
authorize}` on its healthy-node registry. Both outer dispatch and execute/direct,
hook-free and nested execution require a healthy current primary manager/header,
matching node/generation, uncancelled context, canonical configured project and
actual public ToolInfo provenance: sole Pi source root, package
`@mahirocoko/mahiro-pi@0.2.0`, exact declared extension and exact tool name.

Both `mh_execution_run` and `execution_run_state_<sha256(stateRoot UTF8)>` need
actual public permission-owner winning decisions with state `allow`, source
`tool`, matching `toolName` and **exact** `matchedSurface`, not yolo origin.
Family/default/session/yolo-only, old unpatched owner, absent/malformed metadata,
tool-only/root-only, unrelated memory/Goal/Evidence/UX grants, aliases, inline or
foreign copies all deny. Applicable `read`/`path_read` denials on root/state/lock
also gate mutations; writes additionally honor `path_write`. No second permission
parser, owner, factory or generic framework is introduced. The existing authored
40.2.2 patch is used only in disposable offline fixtures; canonical installed
assets remain unchanged in this phase; any old service lacking winning-surface
attestation continues to fail closed. Earlier installed-root repair is separate
history, not new runtime activation.

## Model contract and bounds

Stages are `plan → ready → active → reported → handed_off`, with `abandoned`
terminal. Ready requires lanes, Goal refs, no open blockers/blocking questions and
valid write ownership. Each write target needs exactly one existing **required
implement** lane; writer/worktree ownership and declared readers must agree.
Writable same-worktree targets cannot overlap by equal/parent prefix. Worktree
refs describe caller metadata, not filesystem writes or authorization.

Active requires every required lane's session refs and no open blockers. Reported
requires required lanes terminal with matching latest reports. Handoff requires
all lanes terminal/matching, no open blockers/unresolved items, exact declared Goal
refs, exact included reported/handed-off lanes and failed/cancelled exceptions.
Intake binds ID, current revision, workspace and exact targets. Terminal records
are immutable except explicit `replace_terminal` with exact expected ID/revision;
replacement gets a new ID, revision 1 and `replaces_run_id`.

All ten update actions are retained: `add_lane`, `set_lane_sessions`,
`set_lane_status`, `add_report`, `add_blocker`, `resolve_blocker`,
`set_open_questions`, `set_goal_refs`, `set_handoff`, `set_stage`. Original legal
transitions are preserved, including the special blocker-resolution restoration
to active without session refs; readiness/activation still enforce their separate
requirements. Nonsecurity transitions are not silently strengthened. Inputs are
closed per operation/action, rejecting actor/timestamp/stage bypasses and extras;
persisted objects are recursively closed.

Executors retain `main_agent`, `letta_subagent`, `direct_cli`, `human`, `other`.
`letta_subagent` retains `letta:agent=<id>;conversation=<id>` for external caller
coordination. Added `pi_subagent` requires `pi:session=<nativeSessionId>` as **data
only**, not a binding, authenticated receipt or worker discovery/telemetry.

Bounds: state 8 MiB; 256 session scopes; ordinary text 1,200 and long text 4,000
JavaScript code units; 16 lanes/worktrees; 64 targets; 30 blockers; 80 retained
history entries; 24 refs/checks; four session refs and four reports per lane;
64 changed paths/report and 512/run. Original shorter history-summary constraints
also remain (for example create summary is capped by its 500-unit history entry).
Report paths must be relative lexical paths: no absolute/drive/backslash,
traversal, controls or bidi. Read lanes cannot claim changes; writer changes must
fall under their owned target prefix in the same declared worktree.

## Operator commands and public UI

- `/mh-run status` or `get`: current native-session metadata.
- `/mh-run list`: read-only current-project nonterminal inventory across sessions;
  an operator-facing command, **not** authenticated-human identity proof.
- `/mh-run abandon <revision> [note]` or `abandon <exact-run-id> <revision> [note]`:
  nonterminal only.
- `/mh-run clear <revision>` or `clear <exact-run-id> <revision>`: terminal only.

Every mutation requires public `ctx.ui.confirm`, showing resolved ID, revision,
action, target/operator sessions and project. Missing UI or decline means no write.
Explicit ID lookup may select another session **only in the same profile/project**;
a missing explicit ID never falls back to current. Wrong revision never substitutes
the current revision. An omitted ID selects current once and freezes its identity
and assignment before UI. Unknown/extra selectors reject before UI. Fresh whole
state CAS, exact ID/revision/assignment and config/context authority are rechecked
after UI. Clear/recreate ABA, assignment change, revocation, branch/generation or
cancellation during confirmation cannot retarget a write. Model calls cannot
abandon via forged actor, unsupported operation or `stage: abandoned`.
`unlock --force`, moves, sole-run fallback and auto-attachment are unsupported.

## Persistence and limits of the guarantee

This local adaptation does not import/refactor accepted workflow stores. Private
owned directories/files, strict bounded UTF-8, exclusive never-stolen lock, bounded
local queue and whole-envelope CAS protect observed concurrency. A whole-state
sequence survives clear/recreate. The original temp FD stays open across awaited
authorization. Immediately before rename, synchronous checks cover config identity,
authority, all ancestor identities (including same-mode higher-ancestor replacement
with preserved child inodes), target/lock/temp inode, lock token, metadata and exact
serialized bytes; then fsync/rename/directory fsync. Cleanup removes only owned
identity-matching files, never foreign lock/temp replacements.

Public pathname APIs do not eliminate an external same-UID path race. A failure
after rename can leave published bytes with unconfirmed durability; no automatic
rollback is attempted. This is not Unix sandbox proof, hostile-extension isolation,
network storage support or automatic lock recovery.

## Source/offline verification only

`test/execution-run-*.test.ts` exercises the executable original Letta differential,
closed schemas/native refs, private modes/UTF-8/bounds, ABA, foreign cleanup,
FD/inode/bytes attacks, higher-ancestor identity, cancellation, two real
processes/same-ticket race and different-session fresh-CAS retry without lost state.
Root `pnpm check` includes `check-public-sdk.mjs`, which runs
`lib/guards/test/execution-run-patch-test.mjs` / `execution-run-test.mjs` against isolated actual
patched and old public permission owners with public SDK/Faux dispatch. It covers
ordinary valid metadata without universal UI, write/read ownership and required
refs/reports, provenance/grant/path matrices, direct/nested/hook-free execution,
UI wrong-ID/revision/no-UI/decline/pending ABA/revocation/config/navigation/
generation/cancel, Core/raw user text/valid-PNG preservation and opaque-state traps.
Public `session_shutdown` precedes disposal to close the owner UI poller.

Run `pnpm check` then `pnpm check:format` serially; no Mods checkout or adapter
command is required. Current SDK receipts are unique directories under ignored
`.agent-state/runtime/candidate-isolation/required-sdk-*/`; earlier
`.agent-state/runtime/execution-run-port/` receipts retain dated provenance only.
No real Run, Goal, UX, Evidence, profile config/grant, role/model/Core/auth,
installed dependency, provider/network/browser or Herdr state is created or changed
by this port. Source checks are not full typechecking, independent final QA,
provider/live/rendered/human/RAM acceptance or full Letta/ALL-Mods parity.
