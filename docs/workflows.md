# Workflow tools

[← Documentation](README.md) · [Installation](getting-started.md) · [Permissions](guards.md)

These optional records help coordinate work. They do not replace a task board,
execute agents or authenticate human intent from command text. References to
artifacts, people, models, Goals or other workflows remain opaque caller metadata,
not automatic reads, invocations, evidence ingestion or permissions.

| Feature | Entry points | Purpose |
| --- | --- | --- |
| Goals | `/mh-goal`, `mh_get_goal`, `mh_create_goal`, `mh_update_goal`, `mh_clear_goal` | Explicit mission, criteria, evidence and blockers |
| Code Evidence | `/mh-evidence`, `mh_code_evidence` | Bounded Git collection and metadata about performed checks |
| UX workflow | `/mh-ux`, `mh_get_ux_workflow`, `mh_create_ux_workflow`, `mh_update_ux_workflow` | Frame, direction, handoff and human review gates |
| Execution Run | `/mh-run`, `mh_execution_run` | Optional lane/target/report coordination, never execution |

For lightweight branch-local steps and editable pre-handoff staging, use
[`/mh-todos` and `/mh-queue`](utilities.md#session-steps) in native utilities.
Those records use native session branch journals, not the canonical profile
workflow stores below. They do not execute workers or replace task-board/human
acceptance. The shared storage/primary-session rules in this guide apply to the
four workflow features above, not those session-local utilities.

## On-demand workflow inspector

`/mh` opens a bounded navigation picker in the primary interactive session. Session
steps, staging, usage, appearance and workflow entries delegate their existing
owner handlers. Goal, Code Evidence, UX, Execution Run, RTK and maintained-memory
status entries use the **same existing feature command handler** with `status`;
steps/staging open their existing picker and appearance opens its existing settings. The feature owner still
performs its own authorization/read path; the hub does not read state files,
execute tools, send slash strings to the model or maintain a second database.
Missing entries mean unavailable navigation, not empty or completed workflows.
Closing or selecting the picker creates nothing and does not accept human gates.
Callbacks are bound to exact session-manager/session/cwd ownership and checked
again after asynchronous selection. Before-navigation events invalidate pending
pickers, not future navigation if another extension cancels the transition.
Actual replacement rebinds surfaces; shutdown permanently retires old factories.

Tool cards use structured result details for bounded state, revision and blocker
summaries. Partial results remain pending and failures remain errors; neutral card framing
does not turn an ordinary returned result into green workflow success. A returned
result is not worker completion or human acceptance. Native expansion exposes
captured text and details without changing tool execution or stored raw results.
Public TUI geometry loads at session lifecycle; until available the renderer uses
a width-safe placeholder. No footer/header colors, persistent feature rows,
provider/auth lookup or appearance Save behavior are changed. Appearance Save
must never persist workflow, policy or memory state.

A single shared, at-most-two-row attention widget appears for meaningful structured
blocker, stale, setup or unavailable observations returned by an existing owner
operation. It labels the value as **observed status**, links to that feature's exact
status command and explicitly identifies the row as informational rather than a
permission gate. It is not a live state monitor, worker signal or acceptance record.
It does not poll, perform additional reads, parse command prose, or persist another
workflow store. Plain
text responses and thrown exceptions are not converted into invented metadata.
A healthy/empty observation clears only that feature's own displayed attention.
The next agent run, navigation and shutdown expire the projection; generation,
manager/session/cwd and observation ordering prevent stale callbacks from
replacing or clearing a newer owner's projection. Task and staging widgets
retain their own existing bounded owners.

Integration owners can use `registerWorkflowSurface(pi, { id, label, open })` from
`lib/workflow-hub.ts`; `open` must delegate an existing owner-authorized handler.
The returned disposer permanently retires that registration. The public command
API exposes discovery metadata, not a command invoker, so this explicit callback
registration is deliberate. Tools can spread `workflowRenderers(name)` from
`lib/workflow-ui.ts` and register `registerWorkflowPresentation(pi)` for lazy
geometry initialization. These are presentation APIs, not execution wrappers.

## Shared authority and storage

Read the current native-session record before mutation. Updates use fresh
internal read tickets and expected revisions; arguments cannot fabricate a human
actor or override canonical identity. Authorized empty reads create nothing.
Creation requires explicit human direction, not merely loading a skill or resource.

Explicit profile installation provisions the named tools and their canonical
feature-data namespaces. No per-repository configuration is required. The
independently bootstrapped feature kernel checks current registered tool identity,
SessionManager/header/generation and ordinary public PSS decisions. Wildcard and
yolo allows apply according to PSS precedence; exact DATA winning-surface
attestation is not an additional requirement for these workflow tools. Explicit
tool and applicable path restrictions remain in force. Memory and UI preferences
have separate authority contracts; see [guards](guards.md#feature-authority-and-failures).

State lives beneath the private profile, never a caller-selected path:

```text
<profile>/workflow/{goals,evidence,ux-workflow,execution-run}/
  <sha256(canonical-project-UTF8)>/{state.json,state.lock}
```

Each feature has its own closed native v1 envelope, revision/sequence and session
ownership. Optional retained legacy config under `<profile>/extensions/<feature>/`
is validated freshness metadata, not a required project whitelist. Profile binding
uses `PI_CODING_AGENT_DIR`, otherwise `~/.pi/agent`. Canonical profile, source,
project and protected storage must respect separation checks; aliases reject.

Primary unparented native sessions are supported. Known children are excluded;
parent-linked human forks conservatively reject too. Branch/tree navigation does
not rewind canonical state. New sessions do not auto-attach an existing record.
Lifecycle/navigation changes invalidate retained mutation and UI tickets.

Transactions use owned private 0700 directories and single-link 0600 regular files,
bounded queues, exclusive never-stolen locks, whole-state CAS, validated temporaries,
fsync and atomic rename. Sequences survive clear/recreate to prevent ABA.
Cleanup removes only owned identities. These are cooperative local checks, not
hostile same-user/extension isolation or network-filesystem guarantees. A failure
after rename may leave published bytes with unconfirmed durability. Do not force
unlock or overwrite newer state; recovery requires reviewed owner work.

## Goals

Use `/mh-goal help` for command syntax and `/mh-goal-status` for a read-only alias.

- `mh_get_goal` reads this session's canonical Goal and establishes a ticket.
- `mh_create_goal` creates an explicitly requested mission. `replace: true`
  requires the current revision, preserves Goal ID/history and resets plan/blockers.
- `mh_update_goal` updates phase/next action, plan, rules, evidence and blockers,
  or performs audited completion. Explicit revision/movement needs human direction.
- `mh_clear_goal` destructively removes the current or exact selected same-project
  Goal only after public UI confirmation of its actual ID/revision.

Agent criteria require concrete evidence before claiming. Agents cannot verify
human criteria. Completion requires no open blockers, every required human
criterion verified and every required agent criterion claimed **with evidence**.
Optional criteria, plan completion and rules are not extra completion gates.
Ordinary edits of completed Goals reject; explicit revision can reopen them.
Pause stops the active clock; resume refuses open blockers or blocked criteria.
Duration is host-clock accumulation, not provider usage or execution proof.

`move_goal` preserves ID/history and moves only within the same profile/project
to an empty native session. There is no cross-project move or automatic import.
An explicit invalid/missing Goal ID never falls back to the current one.

Every `/mh-goal` command mutation, including creation, verification and force
completion, requires public UI confirmation. Ordinary model plan/evidence/phase
updates and eligible audited completion do not acquire a universal new UI gate.
Create/revise/move guidance is not mechanical requester authentication.
No UI, decline or a changed target after confirmation means no write.

An authorized active primary Goal projects a bounded owned reminder into the
next request. It is subordinate metadata, not a fake user instruction, Core
rewrite, permission or automatic continuation.

Optional `pnpm goal:preview --project /canonical/project --agent-dir /private/profile`
prints legacy configuration and capability names only; it has no apply option.
Source: [registration](../extensions/mahiro-goal.ts), [model](../lib/goal/model.ts)
and [runtime](../lib/goal/runtime.ts).

## Code Evidence

`mh_code_evidence` has three actions:

- `get`: this native session's report, with optional current-workspace assertion.
- `collect`: explicitly sample staged, unstaged, untracked and committed
  base-to-HEAD lanes separately; optional `base_ref` selects a validated base.
- `record`: metadata about an **already performed** external check. Requires
  workspace, current revision, kind, result and summary. `command` is descriptive
  and **never executed**. Criterion references do not attach anything to Goals.

Results `passed`, `failed`, `observed` and `blocked` are caller metadata, not
verified receipts. `evidence_ready` means metadata ready for explicit selection,
not execution truth or Goal completion. Recollection makes prior records visibly
stale. Reports retain at most 50 records and 20 historical records.

Use `/mh-evidence help`, `status`, `report` or `collect`. Destructive
`clear <revision> [workspace]` has no model action and requires public UI confirmation
of the exact report/session/project/revision plus fresh CAS. Ordinary collect/record
do not require a universal confirmation. No automatic collection or Goal mutation occurs.

### Git collection limits

Collection requires native cwd = canonical project = Git top-level. A child
workspace assertion cannot widen scope. Linked worktrees, external Git/common
storage, alternates, promisor/partial clones, symlink metadata and unsafe sources
are unsupported. Large repositories may exceed conservative discovery limits.

The fixed executable is `/usr/bin/git` with structured argv, no shell, caller
executable or arbitrary switches. Fixed flags/environment suppress hooks,
external diff/textconv/fsmonitor, prompts, lazy fetch and protocols. Selected
configuration-presence checks reject filters and unsafe storage before content
inspection. Repository ignores remain; global ignore patterns are intentionally
not applied. Git may still read ordinary global/include and administrative
configuration internally: this is not an all-transitive-read sandbox.

Logical source paths from index/HEAD/base/worktree inventories and safe ancestors
must pass applicable public read/path policy before inspection. A denied unchanged
or ignored path conservatively rejects the operation, not a filtered complete
report. Bound literal pathspecs prevent new names from widening a sampled content
read. Rename detection is off, so renames appear as delete/add.

Tracked lanes digest transient patches; **raw patches and source contents are
never returned or persisted**. Untracked fingerprints use metadata, with known
same-size/same-mtime blind spots and bounded coverage. Two freshness samples are
not an atomic snapshot; concurrent later changes remain possible.

Bounds include 4096 worktree entries, 8192 authorized paths, one Git child at a
time, 2 MiB combined command output, 30 seconds/command and 90 seconds/collection.
Errors, cancellation or exceeded bounds reject without publishing an unconfirmed
report. Only owned children are terminated and reaped.

Source: [registration](../extensions/mahiro-code-evidence.ts),
[Git collector](../lib/evidence/git.ts) and [model](../lib/evidence/model.ts).

## UX workflow

Read with `mh_get_ux_workflow`. Explicit `mh_create_ux_workflow {summary}` creates
revision 1 at `frame`, always actor agent. Updates use `mh_update_ux_workflow` with
`expected_revision`; no model action can approve a human gate.

1. `set_frame` advances to discovery. Research references are optional metadata,
   not a mandatory count or proof of research execution.
2. Discovery → design requires a brief `{owner, mode, reference, summary}`.
   Recording an owner does not invoke or authenticate it.
3. Record concepts, then `propose_direction` selects an existing concept and
   enters direction approval. Human approval advances to handoff; rejection
   returns to design and discards direction.
4. Handoff must match the brief and include acceptance-criteria strings and a
   target matrix. Either prototype-ready or implementation-ready can advance;
   blocking open questions prevent implementation.
5. Review records a verdict/findings and opaque references, at most three iterations.
   Only Ready can receive human review approval. Agent `complete` separately
   requires Ready, human approval and no open blockers.

`/mh-ux help` lists status/show and approve/reject direction/review, reopen and
clear. Every human mutation requires public UI confirmation of the actual workflow
ID/revision/gate. No UI, decline, revocation or stale target writes nothing.
Ordinary agent metadata/create/eligible completion do not require a dialog.
Completed runs cannot reopen; clear is separate. No automatic artifact reads,
Goal/Evidence mutation, executor launch, workflow move or force-unlock exists.

Source: [registration](../extensions/mahiro-ux-workflow.ts),
[model](../lib/ux-workflow/model.ts) and [runtime](../lib/ux-workflow/runtime.ts).

## Execution Run

`mh_execution_run` supports `operation: get | create | update`. It never launches
workers, CLI, Git or worktrees, controls native children, reads artifacts or
mutates a task board, Goal, UX or Evidence record. Targets, worktrees, sessions,
checks, reports and handoff intake are caller metadata only. `reported` and
`handed_off` do not mean verified, merged, accepted or complete.

Stages are plan → ready → active → reported → handed_off; abandoned is terminal.

- Ready needs lanes, Goal refs, no open blockers/blocking questions and valid
  ownership. Each write target has exactly one required implement lane;
  overlapping writable prefixes in the same declared worktree reject.
- Active requires required lane session refs and no open blockers. Reported needs
  required terminal lanes with matching latest reports.
- Handoff needs all terminal/matching lanes, no unresolved items, exact declared
  Goal refs, included lanes and failed/cancelled exceptions.
- Terminal records are immutable except explicit replacement using exact expected
  ID/revision. Replacement gets a new ID and records the replaced run.

Updates cover lanes/sessions/status/reports, blockers, questions, Goal refs,
handoff and stage. `pi_subagent` session refs use `pi:session=<nativeSessionId>`;
external `letta_subagent` refs remain supported data, not authenticated native
bindings. Bounds include 16 lanes/worktrees, 64 targets, four session refs and
four reports/lane. Changed paths must be safe relative lexical paths under the
writer's declared target; read lanes cannot claim changes.

`/mh-run status|get|list` reads metadata. Human `abandon` is nonterminal-only;
`clear` is terminal-only. Both require public UI confirmation of the resolved
ID/revision/session/project and post-confirmation CAS. Optional exact IDs select
only within the same profile/project; missing IDs never retarget current state.
No force-unlock, move, sole-run fallback or automatic attachment is supported.

Source: [registration](../extensions/mahiro-execution-run.ts),
[model](../lib/execution-run/model.ts) and [runtime](../lib/execution-run/runtime.ts).

Offline source/SDK/Faux tests validate only their exercised contracts. They do
not prove live installation, provider behavior, rendered workflow quality or
human product acceptance.
