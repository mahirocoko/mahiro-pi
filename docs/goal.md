# Native Goal — opt-in source contract

## Status and owners

This is the third source-only ALL-Mods slice, not live activation or human
acceptance. `extensions/mahiro-goal.ts` is the **seventh** declared Pi resource,
after the unchanged original six. `lib/goal/model.ts`, `store.ts` and `runtime.ts`
own native state semantics, private persistence and public Pi lifecycle integration.
Canonical Mods `adapters/pi` owns tool provenance and permission decisions.
Letta's original `mods/mahiro-goal.ts` remains unchanged and independently owned.

Source registration, skill loading, installation and session startup do not read
or initialize Goal state, enable projects, import Letta/MemFS state, grant access
or create an actual Goal. Missing configuration means disabled. An authorized
read of a configured scope with no state returns empty without creating anything.
No Goal state is written to Core, maintained memory, C1, session tool details as a
competing owner, source files or a caller-selected storage path.

## Explicit configuration preview only

```sh
pnpm goal:preview --project /canonical/project \
  --agent-dir /canonical/private/pi-profile
```

Repeat `--project` for additional exact roots (maximum 32, no duplicates). There
is no implicit current project and **no apply option**. The command validates
canonical paths and prints a proposed configuration and derived scope/capability
names; it creates no profile, directory, configuration, grant or state. The same
source validator is used by runtime binding. The profile uses `resolveAgentDir`
from `lib/setup.ts`: explicit preview profile, otherwise public
`PI_CODING_AGENT_DIR` including `~/` expansion, otherwise `~/.pi/agent`.
Runtime uses that public environment/default binding; SDK embedders must align
their explicit `agentDir` with it. An unrelated SDK-only profile override is not
a second supported runtime configuration source.

A separately authorized operator may review a private strict JSON configuration at:

```text
<canonical-profile>/extensions/mahiro-goal/config.json
```

```json
{
  "version": 1,
  "profile": "/canonical/private/pi-profile",
  "projects": ["/canonical/project"]
}
```

The profile, Goal config directory and existing workflow directories must be
owned, canonical, nonsymlink directories exactly 0700. Config/state/lock files
must be regular, singly linked, current-user owned and exactly 0600. Ancestors
must not be symlinks or group/other-writable; trusted system-owned ancestors are
allowed. Profiles cannot overlap the project or this package's source root.
Letta and excluded OneDee paths reject. Goal roots are derived beneath the private
profile, separate from maintained memory and C1. Config is capped at 16 KiB and
state at 2 MiB; invalid JSON, invalid UTF-8, unknown schema fields, oversized data,
unsafe types/ownership/modes, symlinks, hardlinks and noncanonical paths reject.
Config changes invalidate retained tickets rather than silently rebinding them.

This is a private canonical-sibling integration, not portable cold-machine
readiness. No dependency is installed or fetched by preview, registration or tests.

## Storage, native identity and state machine

```text
<profile>/workflow/goals/<sha256(canonical-project-UTF8)>/
  state.json
  state.lock
```

Native envelope schema version 1 contains `profile`, `project`, monotonic
`sequence`, a stable-Goal-ID-keyed `goals` map and `sessions` pointers only.
Goal `profile` and native `sessionId` deliberately replace Letta `agentId` and
`conversationId`; these are **adapted host fields, not an unchanged Letta schema**.
No fabricated Letta identity is used. Goal revision/history and active clock are
preserved across native sessions. Session branches do not rewind canonical state.
A new session has no assigned Goal until an explicit `move_goal` into its empty
destination. Moves initially support the same profile/project only; they are one
atomic mutation, preserve Goal ID/history, update the session pointer and increase
revision. Cross-project moves and automatic copies/imports are unsupported.

- Create starts at revision 1 with bounded DoD, non-goals and rules.
- `replace: true` requires the current revision and revises the existing Goal in
  place: preserves ID/history, resets plan and blockers, and starts an active plan.
- `revise_mission` preserves omitted fields. Completed or paused Goals explicitly
  reopen; ordinary edits of completed Goals reject.
- Agent criteria need concrete evidence before `claim_criterion`; agents cannot
  claim human criteria or verify them through model tools.
- Completion requires no open blockers, every required human criterion verified,
  and every required agent criterion claimed **with evidence**. Optional criteria,
  plan completion and rules are not additional DoD gates. Human force completion
  is an explicit confirmed override, not an agent completion shortcut.
- Pause stops the active clock; resume refuses open blockers or blocked criteria.
  Clock duration uses the host clock with nonnegative elapsed accumulation, not
  provider usage or a task execution ledger.

Bounds retain the original foundation: objective 4000 code units; 20 criteria,
800 each; 20 non-goals; eight rules, 500 each; 30 evidence items per criterion;
30 blockers and plan items; 80 history entries. Text fields retain upstream
trimming/truncation where applicable. Direct execution additionally validates the
closed tool input schema, a bounded nesting depth and 4096-code-unit transport
strings unless a smaller bound is declared. No Evidence/UX/Execution Run API,
RTK/model profile integration, busy panel, footer geometry or Herdr publication
is added.

## Tools, commands and human authority

Four sequential model-callable tools are registered:

| Tool | Behavior |
| --- | --- |
| `mh_get_goal` | Read this native session's canonical Goal and establish an internal revision ticket. |
| `mh_create_goal` | Create only on explicit human request/approval; `replace` explicitly resets the current plan in place. Read first. |
| `mh_update_goal` | Revision-guarded phase/next/plan/rules/evidence/claims/blockers/audited completion; explicit revision/move on human direction. Read first. |
| `mh_clear_goal` | Revision-guarded destructive removal, only after public UI confirmation of the exact Goal ID/revision. |

Create/revise/move's explicit-request requirement is an instruction contract,
**not mechanical proof of the actual requester**. Ordinary model plan/evidence/
phase updates and audited completion do not acquire a universal new UI approval.
Model arguments cannot select a human actor, attest authority or supply revision
tickets. Clear requires public `ctx.hasUI` and `ctx.ui.confirm`; no UI or decline
means no write. The transaction reacquires its lock and checks fresh state/CAS
*after* confirmation. Actor/session/root/generation cannot change while waiting.
Omitting `goal_id` on clear intentionally selects the current session's Goal;
providing it selects only that exact same-profile/project Goal. Missing, empty or
invalid explicit IDs reject before confirmation and never fall back to current.
The command's `clear <id> <revision>` uses the same domain resolver and deletion
path. Approval displays the resolved ID, revision, assigned session and project;
the resolved identity is frozen and whole-state CAS rejects deletion/recreation
or reassignment during approval. Get and ordinary updates remain current-session
only and reject explicit selectors; `move_goal` requires an exact existing ID.

`/mh-goal` supports status/list, a simple objective, `revise`/legacy `replace`,
move, pause/resume, next/phase, evidence/verify, resolve, rule add/update/remove,
complete/`complete --force`, and current or ID/revision-addressed same-project
clear. `/mh-goal-status` is a read-only native status alias, not a busy panel.
Use `/mh-goal help` for syntax. **Every command mutation**, including creating,
verifying and force-completing, requires public UI confirmation because command
source is not authenticated human identity. Commands do not fabricate a human
user episode. `unlock --force` is explicitly unsupported: no stale/live lock is
stolen. Owner recovery needs a separately reviewed offline procedure.

## Permission and primary-session boundary

The healthy canonical Mods node exposes only `goal: {version: 1, generation,
assertAccess, authorize}` for this slice. Outer dispatch and every execute body
independently check current actual ToolInfo, session-manager identity, primary
ownership and generation. The trust algorithm accepts only the exact four names,
canonical Pi root, package identity/version 0.2.0 and exact declared Goal entry.
Aliases, copied/foreign/inline tools and stale/missing metadata fail closed.

The actual public permission owner must return an existing scalar allow for:

1. The **exact queried tool name**; and
2. `goal_state_<sha256(canonical-project-state-root-UTF8)>`.

Both require `source: tool`, non-yolo origin and `matchedSurface` exactly equal
to the queried surface. Root-only, tool-only, memory/C1 authority, default/session,
family wildcard winners, yolo-transformed asks and old/unpatched owners deny.
An exact rule already allowing before yolo remains an exact allow; yolo itself
is not authority. Applicable explicitly matched `path_read`/`path_write` denials
for the root, state and lock remain enforced. Config authorization and root
binding do not prove human intent. No second policy parser or copied security
factory is introduced.

The public primary guard rejects missing/mismatched headers, any public
`parentSession`, known native child ownership, foreign managers and cancelled or
retired generations. This conservatively also rejects human forks when the host
exposes a parentSession. It does **not** claim every parent-linked session is a
subagent or that unavailable header ancestry can be authenticated. Workers never
receive the primary Goal projection. No new worker role or model route is added.

The existing authored permission-owner `matchedSurface` patch is reused, not
installed here. Canonical installed dependencies remain unchanged and the old
owner intentionally remains fail-closed. Separate installation, fresh load,
configuration and exact grants require their own scope approval.

## Transactions and limits of filesystem protection

Transactions use a bounded local queue (32) then an exclusive cross-process
lock, fresh validated whole-state read, internal state/ID/revision CAS, mutation,
bounded validation, exclusive NOFOLLOW 0600 temp, file fsync, atomic rename and
directory fsync. Before switch/tree/fork, runtime invalidates in-flight work and
last-read tickets. A fresh read is required before mutation. Monotonic envelope
sequence protects absent/create/clear ABA even if the recreated Goal is revision 1.

The original temp descriptor remains open across the final awaited authorization.
Immediately before rename, synchronous checks bind the original dev/inode,
regular-file type, single link, exact private mode/owner/group, exact bounded
serialized bytes, lock token/identity, canonical parents/target identity and fresh
context/config/CAS. There is no awaited JS work between final integrity checks
and rename. Cleanup unlinks only the still-owned temp identity, never a foreign
replacement or symlink target; lock release likewise requires the owned identity
and token. A crash leaves a lock and denies future mutations rather than stealing
it. Handled failures may leave private parent directories or deliberately retained
foreign replacement files; reads/startup never create them.

This defends deterministic cooperative/local-interference cases. Public Node
pathname checks plus rename retain an external same-UID TOCTOU interval; **this is
not a malicious same-UID, hostile-extension or OS sandbox**. A post-rename fsync
failure cannot promise rollback of a published file. Keep recoverable canonical
state and investigate durability failures rather than automatically overwriting it.

## Reminder and evidence

`before_agent_start` refreshes only the owned `mahiro_workflow_goal` structured
system section, at most 6000 code units, for an authorized active primary Goal.
It is subordinate metadata, not new human instructions, permission or automatic
continuation. Disabled, unauthorized, paused, missing or worker scopes remove a
stale owned section. Original user text/images, context files/Core, unrelated
sections and other hook owners are preserved. No fake user message, Core rewrite,
session-history truth or auto-Goal from skills is introduced.

`test/goal-*.test.ts` covers source model/store/preview and deterministic temp
substitutions. Differential traces execute the actual unchanged original Letta
source under isolated state paths, normalize generated IDs/times and explicit
host identity adaptations, and compare elapsed clocks using deterministic time.
`mods/adapters/pi`'s `pnpm test:goal` (also `pnpm test`) stages the real patched and
old owners under fixture-canonical roots, exercises public SDK direct/nested/
hook-free execute, commands, lifecycle, reminder and strict image assertions with
Faux transport, and uses public shutdown before disposal. All fixture state is
under ignored `.agent-state/runtime/goal-port/`; original failures and independent
QA controls remain retained. A valid PNG fixes the original invalid-IDAT fixture;
no product image behavior or preservation assertion was relaxed.

These are source and offline public-host proofs, not provider requests, live
profile activation, full memory-reflection scheduling parity, independent final
QA, complete Letta parity or human product/daily acceptance. Fresh independent QA
is mandatory after the sole product writer stops.
