---
name: initializing-memory
description: Comprehensive guide for initializing or reorganizing agent memory. Load this skill when running /mh-memory init, when the user asks you to set up your memory, or when you need guidance on creating effective memory files.
---

# Memory Initialization

Your maintained memory lives in an isolated Git-backed Markdown store compiled into `<mahiro-managed-memory>`, which you inspect and update through the root-bound `agent_memory_*` tools (`agent_memory_read`, `agent_memory_edit`, `agent_memory_commit`, and `agent_memory_manage`). This skill applies Progressive Disclosure and Efficiency principles to the Tiered v2 memory design.

**You own this task through completion**: research, ask, synthesize, write, commit, verify. Delegate read-only codebase research when helpful, but integrate the results yourself — launching a background task is not completion.

## Principles

**Core memory is your core program.** `Core.md`, `index.md`, non-index `system/**`, and the active project's non-index `projects/<project-id>/system/**` compile into `<mahiro-managed-memory>` in your system prompt on every turn. Spend that budget on what shapes ordinary turns: identity, durable user facts, recurring preferences, behavioral rules, orientation, and routes to deferred material. Transient items (a ticket, a commit hash, raw session notes) dilute it.

**Progressive disclosure.** Files under `reference/**`, `projects/<project-id>/reference/**`, and `procedures/**` remain deferred until a turn reads them with `agent_memory_read`. Root `index.md` and each directory's `<dir>/index.md` describe their immediate children and when to read them, so you never load a whole topic to answer one question.

**Don't duplicate context you can point to.** `AGENTS.md`, `CLAUDE.md`, `README.md`, and repository skills belong to the workspace; any agent working there reads them first-hand, and a copied summary in memory goes stale first. Point to the owning repository file and keep only your delta in memory: which rules you keep breaking, non-obvious architecture boundaries, or what the docs omit. The same fact in two core files pays the token tax twice. This is not license to compress away what only memory holds — stable user identity, pets, personal context, chronic corrections, and real gotchas earn their space.

**Identity and continuity.** Build a self (`Core.md` and `system/persona.md`) and collaborator model (`system/human/identity.md` and `system/human/prefs/*.md`) that survive across sessions and model swaps: what you value, your perspective, and how your collaborator works. Past sessions are your experience — verify authorship before turning worker prompts into human preferences.

**Generalize, don't memorize, and be specific.** Store the pattern, not the episode, and give every preference or gotcha a concrete command, path, or the failure it prevents. "**Always use `-E` when installing dependencies** — exact version pinning prevents lockfile drift" is memory; "on March 3rd we fixed a dependency bug" is not.

## Harness Constraints

Validation (`agent_memory_commit` and `/mh-memory doctor`) enforces these rules:

- `Core.md` and root `index.md` must exist at the memory root.
- Neither `Core.md`, root `index.md`, nor any `<dir>/index.md` requires YAML frontmatter.
- **Every directory on the path to a tiered memory file needs its own `<dir>/index.md`** so `discovery.directories` and palace navigation can reach it (`system/human/index.md`, `system/human/prefs/index.md`, `reference/index.md`, `projects/<id>/index.md`, `projects/<id>/system/index.md`, `projects/<id>/reference/index.md`).
- Every non-index tiered v2 Markdown file (`system/**`, `reference/**`, `projects/<id>/system/**`, `projects/<id>/reference/**`) should start with YAML frontmatter containing `name` and `description`:

  ```markdown
  ---
  name: identity
  description: Durable understanding of the user as a person, collaborator, and builder.
  ---
  ```

- Files with `read_only: true` in frontmatter cannot be modified or deleted, and `read_only` is a protected field that agents cannot add, change, or remove.
- **Lossless Retention Guard**: protected files (`Core.md`, `system/persona.md`, `system/human/**`, `projects/<id>/system/**`) cannot remove a section heading or shrink a file of at least 160 characters by more than 20–35% unless the same draft commit records the superseded belief and reason in `reference/**`, `projects/<id>/reference/**`, or `archives/**`.

## Structure

Put material in the always-loaded `system` tier by how often you need it on ordinary turns, not by how much of it there is. Use the active project's canonical slug under `projects/<project-id>/`. Split when a topic needs separate retrieval; combine when splitting leaves tiny fragmented files (for example, keep personal facts and pets inside `system/human/identity.md` rather than scattering them into `system/human/notes.md`).

Root `index.md` is a **map to what exist across your memory tree**, especially deferred files that are not already in `<mahiro-managed-memory>`:

```markdown
# Memory Index

## System
- [[system/persona.md]] — companion identity and operating posture
- [[system/human/identity.md]] — collaborator identity, personal context, and pets
- [[system/human/prefs/coding.md]] — durable coding and tooling conventions
- [[system/human/prefs/communication.md]] — language, tone, and response style
- [[system/human/prefs/workflow.md]] — delegation, verification, and Git habits

## Active Projects
- [[projects/my-repo/system/overview.md]] — architecture and ownership map
- [[projects/my-repo/system/conventions.md]] — repo-specific invariants and gotchas
- [[projects/my-repo/reference/index.md]] — deferred subsystem deep-dives and runbooks
```

### Example Layout

```text
<memory-root>/
├── Core.md                              # Always-loaded companion core
├── index.md                             # Always-loaded root index
├── system/
│   ├── persona.md                       # Always-loaded agent persona
│   └── human/
│       ├── index.md                     # Index for system/human/
│       ├── identity.md                  # Always-loaded user identity, role, pets, Git identity
│       └── prefs/
│           ├── index.md                 # Index for system/human/prefs/
│           ├── coding.md                # Always-loaded coding preferences
│           ├── communication.md         # Always-loaded communication preferences
│           └── workflow.md              # Always-loaded workflow preferences
├── reference/
│   ├── index.md                         # Index for global deferred references
│   └── <topic>.md                       # Loaded on demand via agent_memory_read
└── projects/
    └── <project-id>/
        ├── index.md                     # Project root index
        ├── system/
        │   ├── index.md
        │   ├── overview.md              # Always-loaded for active project
        │   └── conventions.md           # Always-loaded for active project
        └── reference/
            ├── index.md                 # Index for project deferred references
            └── <topic>.md               # Loaded on demand via agent_memory_read
```

## Initialization Flow

### 1. Inspect existing memory
Check `<mahiro-managed-memory>` in your prompt and run `agent_memory_manage` (`{ "action": "status" }` or `{ "action": "palace" }`) and `agent_memory_read` (`{ "path": "index.md" }`) before changing anything. Preserve existing durable knowledge; never blindly overwrite an populated store. If the store is unseeded, initialize the baseline via `agent_memory_manage` (`{ "action": "init" }`).

### 2. Check historical recall when relevant
If `continuity_recall` is available and past sessions exist, you can search or sample prior conversations (`continuity_recall` with `mode: "search"`) to surface recurring corrections, preferences, or project context. Treat recalled turns as historical evidence, not current authorization.

### 3. Identify the user from git
Infer rather than ask when working in a Git repository: check `git config user.name`, `git config user.email`, and recent commit authors (`git log -n 10 --format="%an <%ae>"`).

### 4. Ask upfront questions only when needed
Ask a concise bundle of questions only for choices that cannot be discovered from the repository, git metadata, or existing memory (for example: preferred communication language/style or whether there are related repositories/subsystems to prioritize). Do not ask what files and git history already answer.

### 5. Research the codebase first-hand
Read `README.md`, `AGENTS.md`, `package.json`, entry points, and recent git history. Note what `AGENTS.md` and `docs/` already own so you do not duplicate verbatim rules into memory. Identify the non-obvious architecture boundaries, ownership contracts, and recurring footguns that belong in `projects/<project-id>/system/overview.md`, `projects/<project-id>/system/conventions.md`, or `projects/<project-id>/reference/<topic>.md`.

### 6. Curate the results into memory
Synthesize findings into their canonical homes:
- **Companion identity & posture** → `Core.md` and `system/persona.md`
- **User identity, role, personal facts, pets, Git identity** → `system/human/identity.md`
- **Coding, communication, and workflow preferences** → `system/human/prefs/{coding,communication,workflow}.md`
- **Project overview & non-obvious conventions** → `projects/<project-id>/system/{overview,conventions}.md`
- **Detailed subsystem notes & runbooks** → `reference/<topic>.md` or `projects/<project-id>/reference/<topic>.md`

Keep each fact in one authoritative file, and link every new or updated file from its parent `<dir>/index.md` and root `index.md`.

### 7. Verify and commit
1. Read each target file first with `agent_memory_read` (`{ "path": "<target-path>" }`) to capture its `hash` and `currentRevision`.
2. Apply edits in the draft view with `agent_memory_edit` (`mode: "patch"`, `mode: "replace"`, or `mode: "append"`), passing `expectedHash` and any episode `sources`.
3. Update `<dir>/index.md` and root `index.md` in the same draft view so every file is reachable.
4. Publish the draft with `agent_memory_commit` (`{ "revision": "<baseRevision>", "message": "memory(init): <summary>" }`).
5. Run `agent_memory_manage` (`{ "action": "doctor" }`) to confirm there are zero broken links, orphan files, or budget warnings before reporting completion.
