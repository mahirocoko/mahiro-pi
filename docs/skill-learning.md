# Project skill-learning pilot

[← Documentation](README.md) · [Agents and skills](agents.md) · [Permissions](guards.md)

The pilot starts off. It learns one Markdown-only project procedure using Pi's
existing `subagent` and `get_subagent_result` routes. It does not use maintained
memory as a skills store, add a mailbox, or install tools in children.

## Enable one project

From an installed checkout with the pinned, patched Subagents dependency:

```sh
node skill-learning.mjs enable /canonical/profile /canonical/project
node skill-learning.mjs status /canonical/profile /canonical/project
```

Use the exact root of one trusted Git project. Other worktrees and projects are
not enrolled. `enable` writes the scope record only; it is not a readiness check.
Open a new Main session in that root and run `mh_skill_learning` with
`action: status`. Before relying on unattended learning, check the existing PSS
policy for that project:

- Main needs an effective `allow` for `mh_skill_learning`, native dispatch and
  collection, and directional read/write access for the scoped store (including
  the catalogue, revision, lock, and sibling staging files). The default profile
  installer does not add these grants. A missing or non-allowed tool does not
  advertise the pilot.
- Existing `implementer` and `verifier` roles need their exact configured models.
  Recipients need `skill` and `read` access for the selected skill, including the
  directional rules for the profile path outside the project. They do not need
  write access to that store.

An unresolved path approval or explicit denial blocks unattended learning or
discovery. Enabling the pilot does not edit permissions; do not add a blanket
allow to make a trial pass.

## From result to skill

1. Main delegates ordinary project work through the exact-role native route and
   collects the completed implementer report. It proposes a short procedure only
   if the report reveals a checked, reusable lesson. Skipping is normal.
2. `mh_skill_learning review` dispatches the exact native verifier. The verifier
   receives the bounded proposed procedure and checks it against the repository;
   the source transcript, private memory, and full source report are not sent.
3. Main collects the verifier's result and calls `publish`. Only the exact
   approval for the bound draft can advance the active revision. Rejecting a
   candidate leaves the active revision alone. No per-revision user action is
   needed. A failed launch is not retried automatically.
4. Fresh `implementer` and `verifier` sessions in the enrolled root discover the
   selected `SKILL.md` through Pi's native catalogue. The actual role and cwd
   come from the child creator, not a name claimed in a prompt. A skill is read
   only on use, through the recipient's existing tool. The Main catalogue is
   unchanged; the pilot tool reports active revision IDs to Main instead.

Catalogue changes and content-addressed revisions live under
`preferences/agent-skill-learning` in the selected profile, outside the default
skill directories. Only selected revisions are advertised. There is one
procedure, one pending review per Main session, and a bounded publication
history. Plain Markdown constraints and an independent model review are
admission checks, not proof that every learned instruction is correct. Learned
procedures remain subordinate to the user, repository and permission policy.
Already-permitted filesystem access is not revoked. An open or resumed child
may still hold the contents or a previously indexed skill path.

## View the active skill

In an idle Main TUI session in the enabled project, run `/mh-memory palace`
with ABI2 memory and open **Learned Skills**. The tab shows the active skill's
description, eligible roles, exact revision and rendered Markdown. The pilot
tool and read policy must already allow access. No drafts, superseded revisions
or review reports are included. This is a private snapshot, not a live view;
run the command again after publication, rollback or disable. Existing exported
copies are not revoked. The skill remains in its own catalogue, separate from memory.

## Recovery

If a fresh checked implementer result finds the selected revision is wrong,
Main can use `review_rollback`. The same independent verification and exact
revision checks apply. An operator can also recover without asking a model:

```sh
node skill-learning.mjs rollback /canonical/profile /canonical/project slug exact-current-revision
node skill-learning.mjs disable /canonical/profile /canonical/project
```

Rollback switches back to the preceding revision (or removes the initial
selection), after checking the exact current revision. It preserves immutable
revision files. Disable suspends learning and fresh discovery without deleting the
catalogue. Neither operation can unsend content already read by a child.

## Verification

`node --test test/agent-skill-learning.test.ts` uses the public Pi SDK and native
Subagents and permission extensions with offline Faux transport. It exercises a
checked result, review and publication, a fresh eligible role reading the exact
revision and using it on a later task, a rejected proposal, revision and rollback,
and exclusion of Main, another role and another project. The test does not prove
live provider judgment or the readiness of an installed profile.
