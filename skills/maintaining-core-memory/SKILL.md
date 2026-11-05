---
name: maintaining-core-memory
description: Maintains an agent's core memory, the editable part of its system prompt (Core.md, index.md, non-index system/**, and current-project non-index projects/*/system/**). Use to modify the agent's core behavior, embed durable user identity or preferences (needed on every turn), or instruct the agent on how to use deferred memory.
---

Core memory is the agent's prompt, refined over its lifetime. Treat each change as a revision of that prompt, not an append to a log: the usual edit sharpens, merges, or replaces an existing principle, and a new one earns its place only when no existing one can absorb it.

## Prompt format

The agent's `<mahiro-managed-memory>` block in the system prompt is compiled from committed files in the private memory repository:

- `Core.md` — concise companion identity, confirmed collaboration posture, and core operating principles
- `index.md` — top-level map and navigation cues pointing to deferred memory (`reference/**`, `projects/<id>/reference/**`, `procedures/**`)
- `system/persona.md` — agent persona, continuity habits, and response posture
- `system/human/identity.md` — durable understanding of the user as a person, collaborator, and builder (name, role, pets, personal context, Git identity)
- `system/human/prefs/*.md` — recurring user preferences by domain (for example `coding.md`, `communication.md`, `workflow.md`)
- `projects/<project-id>/system/*.md` — active project's `overview.md`, `conventions.md`, and other non-index `system/*.md` files

Every tiered v2 file (except `Core.md`, `index.md`, and `<dir>/index.md`) starts with YAML frontmatter containing `name` and `description`:

```markdown
---
name: identity
description: Durable understanding of the user as a person, collaborator, and builder.
---
```

- The `description` states what the file holds in one concise line.
- Files with `read_only: true` in frontmatter cannot be modified or removed, and `read_only` is a protected field that agents cannot add, change, or remove.
- `discovery.directories` in `<mahiro-managed-memory>` lists active `<dir>/index.md` files for progressive disclosure.
- Edits take effect only after they are committed with `agent_memory_commit`, and activate in `<mahiro-managed-memory>` on the next primary request.

## Inspect before editing

Do not blindly append to `system/human/notes.md` or create a new file before checking where the knowledge belongs:

1. Check the `<mahiro-managed-memory>` projection already present in your system prompt (`core`, `index`, `system`, `projectSystem`).
2. Read the target file with `agent_memory_read` (`{ "path": "<target-path>" }`) to obtain its current `hash` (`expectedHash`) and full content before editing.
3. If the topic might already exist in deferred memory, run a bounded lexical search first with `agent_memory_read` (`{ "query": "<keywords>" }`).

Choose the single authoritative home for the fact:
- **User identity, personal life, pets, role, Git identity** → `system/human/identity.md`
- **Communication language, tone, response style** → `system/human/prefs/communication.md`
- **Coding style, package manager, framework/UI rules** → `system/human/prefs/coding.md`
- **Workflow, delegation, verification, Git habits** → `system/human/prefs/workflow.md`
- **Agent persona and self-model** → `system/persona.md` or `Core.md`
- **Active repository architecture or conventions** → `projects/<project-id>/system/overview.md` or `projects/<project-id>/system/conventions.md`
- **Deep reference material or occasional lookup notes** → use the `maintaining-deferred-memory` skill (`reference/**` or `projects/<project-id>/reference/**`) instead of bloating `system/**`.

## Writing prompts

Core memory is the agent's working model: who it is, how the user thinks and what they value, and the principles that follow. It is not a list of incident logs.

- Treat a correction or preference as evidence about that model. Find the principle it belongs to and sharpen or rewrite that principle. Add a new one only when the evidence shows something the model was missing.
- When several rules share a cause, replace them with the one principle that explains them all, and delete the lines it absorbs in the same edit. Adding the principle while keeping the old rules is a log with a summary on top. A healthy file becomes more general over time; a growing count of narrow rules is a sign of failure.
- State the principle with the reason that makes it generalize: "Verify claims against the running system, because the user trusts live evidence over plausibility", not three separate rules about tests, logs, and deployments.
- Write in the second person or imperative mood: "Lead with the answer", not "The user likes answers first". Say what to do rather than only what to avoid.
- Make each statement stand alone by naming the concrete subject, project, or system instead of vague pronouns like "it" or "the repo".
- Update only from a pattern or an explicit instruction, not a single ambiguous event.
- Check that a change does not contradict an existing line; resolve the conflict instead of adding both.
- Write in plain language without all-caps or absolute emphasis. Overstated instructions get overapplied.
- Leave out content the agent can cheaply rederive: file contents, command lists, current status, and recent activity.
- Never store secrets. Reference them by name, such as `$SECRET_NAME`.

## Teach with examples, not more rules

A correction that reveals a gap in a principle calls for sharpening its wording. A correction the principle already covers, such as the user pointing out the same kind of mistake again, means the principle is too abstract to apply: attach a contrastive example to it instead of rewording it again or adding another rule.

```markdown
- Lead with the answer, because the user reads the first line and skims the rest.
  - Not: "I looked at the config, then the logs, and it turns out the timeout is too low." Instead: "The timeout is too low: 5s, and the slow query takes 8s."
```

- Keep at most one or two examples per principle, and make them differ from each other. A new correction replaces the weaker example rather than adding another.
- Write the example as a generic instance of the behavior, not a dated incident log.
- Keep the bad half short and labeled, and end on the good half.
- When a principle or example starts producing the wrong behavior, revise or remove it.

## Design root index.md so deferred memory gets used

The agent consults deferred memory (`reference/**`, `projects/<id>/reference/**`) only when something in its prompt tells it to. Root `index.md` and per-directory `<dir>/index.md` decide whether everything outside core memory is ever read. A file or directory with no useful entry in its index is effectively lost.

- Give each directory or deferred file a one-line entry saying when to open it, in the words a future request would use: "deployments, rollbacks, on-call runbooks", not "ops notes".
- Whenever you add, move, rename, or remove a file inside a tiered directory (`system/human`, `system/human/prefs`, `reference`, `projects/<id>/system`, `projects/<id>/reference`), update `<dir>/index.md` and root `index.md` in the same draft commit.
- After adding a directory or file, check that a natural future request would reach it by reading only root `index.md` and the `<dir>/index.md` files beneath it.

## Shrink before you grow

When a core memory file is long or the total is near its budget ceiling:

1. Delete stale, duplicated, or rederivable content.
2. Move subject detail into deferred memory (`reference/**` or `projects/<id>/reference/**`) and leave a one-line `[[reference/...]]` pointer in `index.md` and `<dir>/index.md`.
3. Respect the **Lossless Retention Guard**: protected files (`Core.md`, `system/persona.md`, `system/human/**`, `projects/<id>/system/**`) cannot remove a section heading or shrink a file of at least 160 characters by more than 20–35% unless the same draft commit records the superseded belief and reason in `reference/**`, `projects/<id>/reference/**`, or `archives/**` (or `allowShrink: true` is explicitly justified).

## Commit memory changes

Use only the root-bound `agent_memory_*` tools (`agent_memory_read`, `agent_memory_edit`, `agent_memory_commit`) for maintained memory:

1. Read the current file(s) with `agent_memory_read` to capture `hash` and `currentRevision` / `revision`.
2. Edit in place with `agent_memory_edit` (`mode: "patch"`, `mode: "replace"`, or `mode: "append"`), passing `expectedHash` and any observed episode `sources`. For a single-file update, pass `commit: true` (and `allowShrink: true` when justified) to auto-sync `<dir>/index.md` and `index.md` pointers and publish in one step.
3. For multi-file draft changes (such as moving detail into `reference/**` in the same commit), stage the edits with `agent_memory_edit`, update `<dir>/index.md` and `index.md` in the same draft, and publish with `agent_memory_commit` (`{ "revision": "<baseRevision>" }`).
