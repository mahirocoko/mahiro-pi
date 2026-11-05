---
name: syncing-memory-filesystem
description: Diagnose and repair maintained memory repository state, uncommitted draft views, CAS revision/hash conflicts, Lossless Retention Guard rejections, or broken directory indexes. Do not load for routine memory reads or edits.
---

# Memory Repository & Draft Sync Repair

Use this skill when maintained memory edits fail to commit, when a draft view encounters a revision or content-hash conflict, or when `/mh-memory doctor` reports structural/index drift. Before editing memory content, follow the rules in `maintaining-core-memory` for always-loaded files (`Core.md`, `index.md`, `system/**`, `projects/<id>/system/**`) and `maintaining-deferred-memory` for deferred files (`reference/**`, `projects/<id>/reference/**`, `procedures/**`). Verify the repair before reporting success.

## Current Model

Maintained memory is a private local Git-backed Markdown repository managed by the active memory runtime (`ABI1` or `ABI2`). Agents never run raw `bash` `git` commands inside the private memory directory; all reads, draft edits, commits, and diagnostics go through the root-bound `agent_memory_*` tools:

```text
<memory-root>/
├── Core.md                              # Always-loaded companion core
├── index.md                             # Always-loaded root index
├── system/                              # Always-loaded global memory
│   ├── persona.md
│   └── human/
│       ├── index.md
│       ├── identity.md
│       └── prefs/
│           ├── index.md
│           ├── coding.md
│           ├── communication.md
│           └── workflow.md
├── reference/                           # Deferred global memory
│   └── index.md
└── projects/
    └── <project-id>/
        ├── index.md
        ├── system/                      # Always-loaded for active project
        │   ├── index.md
        │   ├── overview.md
        │   └── conventions.md
        └── reference/                   # Deferred for active project
            └── index.md
```

Edits staged via `agent_memory_edit` live in an isolated draft view bound to the session/worker identity until `agent_memory_commit` publishes them. Uncommitted draft edits do not alter `<mahiro-managed-memory>`. Once `agent_memory_commit` succeeds, the new revision activates on the next primary turn.

## Start With the Harness Diagnostics

Inspect the current memory status and health through `agent_memory_manage` (or the user-facing `/mh-memory` command):

```text
/mh-memory status    # show active revision, scope, and runtime status
/mh-memory init      # seed an absent memory root without overwriting existing files
/mh-memory doctor    # validate links, orphan files, indexes, frontmatter, and budgets
/mh-memory palace    # inspect the committed memory structure
```

From tool calls, run:

1. `agent_memory_manage({ "action": "status" })` to inspect `revision`, `active`, and runtime state.
2. `agent_memory_manage({ "action": "doctor" })` to list any broken `[[...]]` links, orphan files, missing `<dir>/index.md` files, or frontmatter issues.

## Resolving CAS & Draft Conflicts

### 1. `Content hash mismatch` or `expectedHash required`
Every `agent_memory_edit` call on an existing file requires the file's current `expectedHash` (and `null` when creating a new file).
- **Repair**: Call `agent_memory_read({ "path": "<target-path>" })` to read the latest content and its `hash`, merge your intended change into that latest text, and call `agent_memory_edit` with the fresh `hash`.

### 2. `Revision conflict` on `agent_memory_commit`
If another turn or reflection job committed a new revision while your draft view was open, `agent_memory_commit` rejects the stale base `revision`.
- **Repair**:
  1. Read the latest committed state of your target file(s) with `agent_memory_read({ "path": "<target-path>" })` to capture the new `currentRevision` and `hash`.
  2. Re-apply your edits cleanly on top of the latest file content using `agent_memory_edit` with the updated `expectedHash`.
  3. Call `agent_memory_commit({ "revision": "<latestRevision>", "message": "memory(self): <summary>" })`.

### 3. `Lossless Retention Guard` rejection
Protected files (`Core.md`, `system/persona.md`, `system/human/**`, `projects/<id>/system/**`) reject edits that remove a section heading or shrink a file of at least 160 characters by more than 20–35% unless the same draft commit records the superseded belief in `reference/**`, `projects/<id>/reference/**`, or `archives/**`.
- **Repair**:
  1. In the **same draft view** before calling `agent_memory_commit`, write or append the superseded detail/history and rationale into an appropriate `reference/<topic>.md`, `projects/<id>/reference/<topic>.md`, or `archives/<topic>.md` file (and link it in `<dir>/index.md` and `index.md`).
  2. Or, if the edit was only meant to add/refine a fact, keep the existing sections intact and use `mode: "patch"` or `mode: "append"` rather than replacing the whole file with a shorter draft.

### 4. Missing `<dir>/index.md` or Orphan File Warnings
In Tiered v2, every directory containing memory files must have its own `<dir>/index.md` (and every indexable ancestor directory must also have an `index.md`), and every non-index file must be linked via `[[path/to/file.md]]`.
- **Repair**:
  1. Run `agent_memory_manage({ "action": "doctor" })` to see the exact `orphanFiles`, `brokenLinks`, or missing ancestor indexes.
  2. Create or update the missing `<dir>/index.md` and root `index.md` entries in one draft view, then commit with `agent_memory_commit`.

## Failure Checklist

1. Run `agent_memory_manage({ "action": "status" })` and `agent_memory_manage({ "action": "doctor" })`.
2. If the store is uninitialized, run `agent_memory_manage({ "action": "init" })`.
3. Always `agent_memory_read` each target file immediately before `agent_memory_edit` so `expectedHash` and `revision` are current.
4. Preserve `name` + `description` frontmatter on non-index tiered files and never modify `read_only` files or fields.
5. Link every new or moved file in both `<dir>/index.md` and root `index.md` before calling `agent_memory_commit`.
6. Re-run `agent_memory_manage({ "action": "doctor" })` after committing to confirm `healthy: true`.
