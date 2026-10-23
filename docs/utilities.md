# Native utilities

[← Documentation](README.md)

## Realign

`/realign [focus]` asks the assistant to reorient around current repository rules
and evidence. The optional focus narrows that guidance. It uses native generated
custom guidance, not a forged human message, and does not edit memory, create a
Goal, change policy or authorize a commit.

Native busy delivery and conservative input/child skips retain their own
boundaries. Disable this resource's realign behavior with the native boolean flag
`--mahiro-realign-disable`.

## Run-start clock metadata

Host-local time/timezone metadata may accompany the start of an eligible native
run, separately from the original user's text and attachments. It is the
**run-start clock**, not keypress/receipt time, authenticated human identity,
instructional evidence or permission.

Disable it with `--mahiro-user-timestamps-disable`. No new global
configuration is created. Realign and clock metadata do not execute tools
or overwrite the user input.

## Copy code

`/mh-copy-code` lists assistant text on the current session branch and copies
one choice: the full response, or a single fenced code block. Closed and
unclosed fences are both listed. A response with no fence is still offered in
full. The list is built when the picker opens, including after branch
navigation.

The name is separate from native `/copy`. If the live command registry does not
contain exactly one extension command named `mh-copy-code`, nothing is copied.

In the interactive TUI, confirming a row copies that text through the public
clipboard API. Cancelling copies nothing. Outside the TUI, the command reports
only how many responses and code blocks are on the branch and does not touch
the clipboard. The copied text is not written to the editor, a log, or another
sink. The native editor, Shift+Enter newline, and image paste stay in place.
This command does not edit or steer the native queue. Syntax highlighting is
not applied.

Owners: `extensions/mahiro-native-utilities.ts`, `lib/native-utilities.ts` and
`lib/copy-code.ts`.

## Session steps

`/mh-tasks` opens branch-local lightweight tracking through the existing native
utilities feature. It is not a task-board replacement, worker scheduler, RPC
service, Goal or acceptance record. Loading creates no steps or configuration.
No separate upstream task package or executor is installed.

Four namespaced model tools provide the same core operations:

| Tool | Arguments and result |
| --- | --- |
| `mh_task_create` | `subject`, optional `description`, `owner`, string/null `metadata`; returns a stable ID and revision |
| `mh_task_get` | `id`; returns current fields, `blockedBy`, reciprocal `blocks` and `open_blockers` |
| `mh_task_list` | `{}`; returns this branch's steps and view configuration |
| `mh_task_update` | `id`, latest `expected_revision`, optional fields, `blockedBy`, `status` or `delete: true` |

Read before updating. Status is `pending`, `in_progress` or `completed`; setting
pending/in-progress reopens a completed step. Metadata null removes that key.
Dependencies must reference existing other steps; cycles reject. Starting despite
open blockers returns a warning, not a refusal or worker launch. Deletion,
completed-step clearing and expiration remove affected dependency edges and bump
surviving affected revisions. A completed step is only a session-step claim,
never model execution success, task-board completion or human acceptance.

The picker supports create, title/description edits, dependencies, status/reopen,
delete, clear completed and session-local settings:

- **View:** default `quiet` (up to three open steps), `compact` (up to five) or
  `off`. Completed/overflow steps are summarized; full records remain in the picker.
- **Retention:** default `never`. Optional `four-turns` expires a completed step
  at its fourth subsequent native `turn_start`, including the final assistant
  turn following a tool call. Explicit creation after a fully settled completed
  batch also clears that batch in this mode; within-run creation preserves it.
- **Reminders:** default off. When enabled, one transient request-only reminder
  follows a gap of two native turns for in-progress steps or four for pending-only
  steps. A tracking-tool call resets the gap. Titles are bounded untrusted data,
  not instructions. Reminders do not rewrite Core or persist as user messages.

## Editable staging queue

`/mh-queue` manages **extension-owned staging**, not atomic editing of Pi's
already-native queued messages. Capture defaults **off**. No automatic capture,
handoff, resend, native queue inspection or execution is enabled on load.

- Use **Stage text** for an isolated modal editor: Ctrl+S saves, Esc cancels.
  The underlying native draft, caret and attachments are never read or replaced.
- `/mh-queue capture off|steer|followUp` explicitly controls capture of future
  **busy interactive** submissions. Idle input, slash commands, RPC and extension
  submissions remain native. Captured text/images are recorded in the staging
  journal before the input is consumed; a failed append leaves the original native path.
- Select a staged row to edit text, explicitly remove images, move/change lane,
  hand off once or discard. Text editing retains images; it never repeats their
  base64 in unrelated edits or task operations. New rows append at the tail;
  movement explicitly selects a 1-based position across staged rows. Each lane's
  unattempted rows hand off in displayed FIFO order; move a row first to change
  that order. Native lane scheduling/steering priority remains Pi-owned.
- **Hand off once** requires confirmation and records a stable attempt ID before
  calling public `sendMessage`. The row locks against editing/retry immediately.
  The void return and aggregate native pending state are **not acknowledgements**.
- **Unconfirmed** means retained intent without a matching native branch entry.
  **Recorded** means an observed native custom-message entry with this exact row
  and attempt ID. Neither means model receipt, completion, execution or acceptance.
  Unrelated pending messages cannot acknowledge a staged row. Duplicate matching
  observations are idempotent. Recorded rows leave the compact widget but remain
  available for receipt inspection/discard in the picker.
- Missing/delayed receipts stay retained and locked across reload/fork; no timeout
  deletes or resends them. There is deliberately no force-retry command. Discard
  of an attempted row does not cancel native work; manually recreating/resending
  it can duplicate delivery. Native Esc and native queue commands retain ownership
  of already-native pending work, which this feature cannot edit or cancel.

### Storage, lifecycle and limits

Both features use public session custom-entry **operation journals**, replayed
from the current branch. Reload/resume rehydrates; native forks inherit only the
branch prefix at the fork point and then diverge independently. New sessions are
empty. In-memory sessions survive same-manager reload only, not process loss.
Normal native session persistence is host-owned, not a separate filesystem
transaction/durability guarantee. Historical image payloads remain in the native
session history after removal/discard; those actions are not secure erasure.

All writes revalidate current manager/generation and journal revision after
asynchronous UI boundaries. A stale modal or failed append rejects without
rewriting a newer row. No automatic repair overwrites malformed journals. The
journals stop at 10,000 operations each; start a new session at capacity. Steps
are bounded to 64, with 32 dependencies, 16 metadata keys, 500-character subjects
and 8,000-character descriptions. Staging retains at most 32 rows, 32,000 text
characters and eight images/row: roughly 2 MiB decoded images/row, 16 MiB live
and 32 MiB cumulative staged image history per branch (base64 limits apply).

Configuration stays in this native session branch, not `/mh-ui`, own-UI
preferences or global profile state. Explicit profile installation adds the four
named tracking-tool grants; loading source provisions no permissions. Model
calls remain under normal native permission enforcement. The interactive pickers
require UI and text modals require native TUI mode; headless loading never takes
over the composer. Widgets are above-editor, muted and width-bounded; they do
not change the authored header, footer, colors or native usage cells.

Owners: `lib/session-work/{journal,task-model,tasks,queue-model,queue,view}.ts`,
registered only through `lib/native-utilities.ts`. Source/model and real public
SDK/Faux fixtures cover exercised lifecycle and correlation behavior; scripted
public UI is not actual native terminal, provider or human visual acceptance.

## Code Map

`mh_code_map` returns bounded repository-navigation guidance from caller-supplied
metadata. It does not search files, build an index, infer an outline or verify
source. It has no slash command.

```json
{"intent":"exact","query":"createWebActivityPublisher","path_hints":["lib/worker-activity-web.ts"]}
```

Intents are `semantic`, `exact` and `outline`. Guidance points to a subsequent
real search or bounded read. Path/language hints, navigation entries, optional
large-read guidance and Goal/Evidence references remain metadata, not proof a
file exists, permission to read it or evidence attachment. Formatting is bounded
to 3000 characters; registration/formatting do not scan workspace source.

Execution requires the exact named capability, healthy canonical source and
public winning-rule attestation. Family wildcards or an old unattested service
are insufficient. Feature DATA installation does not replace Code Map tool
authority. Canonical checks may read package/provenance/policy metadata, not
perform the proposed source search.

Owner: [registration](../extensions/mahiro-code-map.ts) and
[guidance formatter](../lib/code-map.ts). Source availability does not prove
that the running profile loaded these controls.
