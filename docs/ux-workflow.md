# Native UX Workflow — source-only, default disabled

`extensions/mahiro-ux-workflow.ts` is the **ninth** package resource, appended after
the accepted eight without changing their order. Its focused owners are
`lib/ux-workflow/{model,store,runtime}.ts`. Canonical Letta semantics come from
`mods/mods/mahiro-ux-workflow.ts`; that original entry remains unchanged. This is
a bounded metadata coordinator, not a design/research engine, executor, artifact
reader, acceptance verifier or new activation path.

## API and semantics

- `mh_get_ux_workflow {}` selects **only the current native session**, returning
  `status`, `workflow`, `open_blockers` and `coordinator_boundary`.
- `mh_create_ux_workflow {summary}` creates revision 1 at `frame`, actor agent.
  Create only after an explicit actual human request; this is requester guidance,
  not mechanical requester authentication.
- `mh_update_ux_workflow {action, expected_revision, ...actionFields}` always
  records actor agent. The eleven actions are `set_frame`, `add_research`,
  `set_brief`, `add_concept`, `propose_direction`, `set_handoff`, `set_phase`,
  `set_review`, `add_blocker`, `resolve_blocker`, `complete`.

Input is closed at execution as well as public dispatch. Unknown IDs, selectors,
actor/approval/timestamp/authority fields and irrelevant action fields reject.
The upstream combined update schema lists all action properties; the native body
additionally rejects properties belonging to another action. No explicit workflow
selector, session movement, attachment, sole-workflow fallback or legacy import
exists. Read the get tool in the current context before an agent mutation; its
internal whole-state ticket is consumed on success. This extra native read-ticket
requirement protects clear/recreate ABA without adding caller booleans.

`set_frame` advances to discovery. Research records are **optional metadata**;
there is no mandatory count or research execution proof. Discovery → design needs
a recorded brief `{owner, mode, reference, summary}`. An owner string never invokes
or authenticates the named person/model/procedure. Design concepts are recorded,
then an existing concept may be proposed, entering `direction_approval/pending`.
Human approval advances to handoff; rejection discards direction and returns to
design. Reopen also discards a pending direction.

Handoff must exactly match the recorded brief, have nonempty string acceptance
criteria and target matrix, and retain all original bounded collections. Both
`prototype_ready` and `implementation_ready` permit implementation. Blocking open
questions prevent it. Acceptance criteria are **strings**, not Goal criterion
records and not invented human-verification criteria.

Implementation can record a verdict/findings/opaque reference review, at most
three iterations. Pending Ready review cannot agent-transition back to
implementation; non-Ready can return within the bound. Human rejection/reopen
returns review to implementation only within that bound. Only Ready may be human
approved. Approval **does not complete** the workflow: the agent `complete`
action separately requires Ready + human review approval + no open blockers.
Completed runs are immutable except clear; reopen is only for direction approval
or review, never completed runs. These are the original coordinator semantics,
not a stricter invented design/research FSM.

Bounds retain 256 scopes, 1,200-character ordinary / 4,000-character long text,
24-item lists, 30 research records, 12 concepts, 30 blockers, 80 history records,
and 3 review iterations. Stored objects/envelopes are closed and validated too.
Brief/research/finding references, `goal_criterion_refs`, `evidenceRefs` and
`codeEvidenceRefs` are opaque metadata: never read as filesystem/resource/Goal/
Evidence artifacts, proof, permissions or execution requests. Goal/Evidence have
separate owners and must be updated explicitly through their own APIs.

## Human command boundary

`/mh-ux status`, `show`, `help`, `approve|reject direction <revision> <concept-id>
[note]`, `approve|reject review <revision> [note]`, `reopen <revision> [note]`,
and `clear <revision>` retain the original command surface. **`unlock --force`
is unsupported**; locks are never automatically stolen or forcibly removed.

Every human mutation requires `ctx.hasUI` and public `ctx.ui.confirm`. Before the
dialog, the command resolves and validates the current exact run ID/revision,
gate/concept, session/project and whole-state ticket. The dialog displays that
actual target, including existing-run clears, never an empty-session label for
an existing run. After await it rechecks authority/config identity/context and
CAS; it never refreshes the expected revision or retargets a new run. No UI,
decline, cancellation, stale target, config replacement or revocation writes no
canonical state. Command text or model booleans alone never record a human actor.
Ordinary agent metadata/create/eligible complete do **not** require confirmation.
This is public-host UI attestation, not protection against a malicious host UI.

## Opt-in configuration and guard ownership

Missing config disables, without initializing storage. Configuration is strict
UTF-8, at most 16 KiB, owner-private and exactly:

```json
{"version":1,"profile":"/canonical/private/profile","projects":["/explicit/canonical/project"]}
```

The only path is `<profile>/extensions/mahiro-ux-workflow/config.json`. Profile
resolution reuses `resolveAgentDir`: `PI_CODING_AGENT_DIR` with `~/` expansion,
otherwise `~/.pi/agent`; no runtime SDK import is needed. Existing canonical
projects are explicit, profile/project/source/protected-memory overlap rejects.
Source registration/startup provisions no profile, grants, config, seed or import.
No extra preview/installer/top-level bootstrap option is needed: the existing
bootstrap recursively binds the extension/library/Mods adapter source trees.

Root-owned `lib/guards/index.ts` owns the narrow healthy-node ABI:
`uxWorkflow: {version:1, generation, assertAccess, authorize}`. Actual public
`getAllTools` provenance must identify exactly one of the three tool names at the
canonical `@mahirocoko/mahiro-pi` 0.2.0 root, exact declared
`extensions/mahiro-ux-workflow.ts` entry and manifest membership. Both the outer
dispatch and execute body enforce the captured native SessionManager, matching
primary header, healthy generation, native-child exclusion and cancellation.
Parent-linked **human forks conservatively reject too**.

The actual public permission owner must return non-yolo-origin `allow`,
`source: tool`, `toolName` and winning `matchedSurface` exactly equal to **both**
the invoked tool and `ux_workflow_state_<sha256(stateRoot UTF8)>`. Wildcard winners,
old/malformed/missing owner metadata, default/session/yolo-only authority,
memory/Goal/Evidence-only, tool-only or root-only grants deny. Applicable read /
path-read denials on root/state/lock gate every operation; writes also retain
path-write denials. No second policy parser, security-factory copy, generic auth
framework, fallback approval or new permission provisioning exists. The existing
authored 40.2.2 owner patch is reused only in isolated offline positive fixtures;
canonical installed dependencies remain old and fail closed.

## Private persistence and limitations

Native envelope schema **1** is separate from upstream Letta schema **2** and from
config version 1. It contains canonical profile/project, monotonic whole-state
sequence and native-session-keyed runs with stable IDs/revisions; there are no
fabricated Letta agent/conversation IDs. State is never reconstructed/rewound from
session trees. New sessions do not attach an old workflow. Before-switch/fork/
tree/start/shutdown invalidates read/mutation/approval tickets.

The fixed private state root is
`<profile>/workflow/ux-workflow/<sha256(project UTF8)>/{state.json,state.lock}`.
Directories are 0700, owned regular single-link files 0600. Strict UTF-8 state is
bounded to 2 MiB. Authorized missing-state reads return empty **without mkdir**.
Only an explicit authorized mutation creates private folders. A bounded 32-entry
local queue, exclusive owned lock and fresh whole-envelope CAS protect writers;
sequence survives clear, preventing revision-1 recreation ABA across processes.

The focused store locally adapts the proven Evidence transaction pattern without
importing/refactoring Goal/Evidence internals. It holds original temp/target/lock
FDs across awaited authorization. In the final synchronous continuation it checks
current authority/config/context, parent and target identities, lock token/exact
bounded bytes, whole-state CAS, and temp dev/inode/type/nlink/owner/private mode/
exact serialized bytes, then fsyncs and renames without another JS yield. Cleanup
unlinks only still-owned identities, never foreign replacements. Same-mode parent
identity replacement is tested, not inferred from a mode check alone.

This is not a same-UID sandbox: public pathname APIs retain an external race
between final checks and rename. A post-rename directory-fsync failure can mean
publication happened without confirmed durability; no automatic rollback or
foreign-lock recovery occurs. Failed mutations may leave newly created empty
private directories. Crash recovery is separately reviewed offline owner work,
not `/mh-ux unlock --force`.

## Verification boundary

`pnpm check` includes executable original-Letta differential tests (normalizing
only generated IDs/times/native identity), native closed-schema tests, private-FD
interference, read-no-init, bounds, queue/foreign lock, clear/recreate tickets and
a real two-process CAS race. Root required `pnpm check:public-sdk` (also in `pnpm check`) also runs
`ux-workflow-patch-test.mjs` / `ux-workflow-test.mjs`: actual public SDK/Faux with
isolated patched and old owners, direct/nested/hook-free execution, permission/
provenance denials, public UI gates/races/navigation/new-session isolation,
ordinary no-confirm updates, strict user text/valid-PNG preservation and public
shutdown before disposal. Fixture artifact/Goal/Evidence reads are trapped and
fixture state/project bytes stay unchanged. Evidence is only under ignored
`.agent-state/runtime/ux-workflow-port/`; prior proof remains untouched.

These checks do not install, configure, grant, import, reload, infer through a
provider, modify real memory/roles/auth/models, mutate live UX/Goal/Evidence or
publish Herdr state. Source checks are not full typechecking, rendered UX,
independent final QA, human daily/RAM acceptance or complete Letta parity.
Fresh independent QA is the next owner before accepting this source port.
