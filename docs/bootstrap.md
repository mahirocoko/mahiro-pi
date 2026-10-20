# Explicit private local Pi bootstrap

## Scope and owners

`bootstrap.mjs` and `lib/bootstrap.ts` compose one explicitly selected private
profile. They are separate from the unchanged default-skill-only `setup` command,
package installation, extension startup and the real machine's activation state.
There is no install hook or automatic global configuration write.

This is a **private local flow, not a public portable installer**. The manifest
must name the actual canonical `mahiro-pi` checkout, its sibling `mods` and sibling
`mahiro-skills`. Mods' public provenance resolves this exact sibling Pi owner;
a same-name copied checkout is not equivalent. No publication is required. Plans
bind current Git revisions plus payload hashes, including uncommitted source bytes,
canonical factory files, lock/workspace/patch metadata and installed dependency
source/declarations. Optional native initialization also binds SDK/AI package
metadata, public entries and their complete bounded package-local `dist` trees
(including re-exported SDK/resource-loader/model-runtime implementations). These
selected executable payloads are not a claim to bind the entire transitive npm
closure. Hashes are cooperative freshness evidence, not signatures.

| Surface | Authoring/installation owner |
| --- | --- |
| Package resource registration | Pi's documented user `settings.json` boundary |
| Ordered guards, policy enforcement, pinned dependency/patch provenance | Canonical Mods `adapters/pi` |
| Three role source bodies | This repository's `agents/` |
| Reusable skill payload transforms, copying and receipts | Canonical `mahiro-skills` plan/install CLI |
| Default all-installed/future skill policy | Existing `inspectSetup` / `applySetup` |
| Optional private maintained knowledge | Existing managed-memory owner and guarded native `agent_memory_manage` |

There is no new dependency declaration or duplicate pin in this package. Mods
must already have its frozen installed subagents **23.4.1** (workspace-owned patch)
and permissions **40.2.2**. Missing dependencies fail closed and report only this
operator prerequisite, never execute it:

```sh
cd /absolute/canonical/mods/adapters/pi
pnpm install --frozen-lockfile
```

The plan checks package identity, exact local resolution through the Mods pnpm
workspace, ordered `bootstrap.mjs` then `index.ts`, canonical patch hash in the
lock, public initial-outcome/role-query declarations and a read-only reverse-patch
check of the installed patched files. Native initialization additionally checks
the actual healthy guard node, runtime patch marker and discovered role names.
Bun must already be available for the skill owner's CLI; nothing installs it.

The source contract also checks the authored permission-system 40.2.2
`matchedSurface` patch mapping/hash in the lock. The source snapshot already binds
both patch artifacts and workspace/lock bytes. This does not claim that an older
installed permission tree is patched: bootstrap memory/skill operations do not
need or grant Code Map/Goal authority, and their existing compatible runtime remains
usable. Both independently reject missing winning-surface metadata at actual
execution. Its separately approved frozen install/reload/grant is not performed
by planning, applying a bootstrap manifest or source tests. Positive Code Map proof
uses an isolated patched-source mirror; the old installed owner stays unchanged.
Goal uses the same authored owner metadata and isolated-source proof boundary.

## Goal configuration preview is separate and read-only

The package's seventh Goal resource does not add a bootstrap component, grant,
seed or default skill-policy expansion. `pnpm goal:preview --project /canonical/project
--agent-dir /private/profile` validates and prints only an opt-in source config and
derived state-root capability names. It has no apply option and writes nothing,
even when the profile is absent. Review [`goal.md`](goal.md) for native
profile/project/session schema adaptation and private modes. Actual configuration,
exact tool/root grants, patched-owner installation and fresh load are separately
scoped operator actions, not preview or bootstrap side effects.

Bootstrap's existing source snapshot binds complete `lib`/`extensions` trees,
manifest and both authored patch artifacts. It additionally binds
`goal-preview.mjs`; no Goal config/state is included as an installation payload.
Existing Core, skills, roles and maintained-memory ownership remain unchanged.

## Strict reviewed manifest

Save an owner-private **exactly 0600** JSON manifest outside tracked source.
Read-only 0400 and executable 0700 inputs reject; bootstrap does not chmod them. Paths must be
absolute, normalized, canonical, non-symlink and nonexcluded. Profiles cannot
contain or overlap source roots; ignored `.agent-state/runtime/` disposable
fixtures are the sole source-tree exception. No implicit default profile is used.

```json
{
  "version": 1,
  "agentDir": "/absolute/private/pi-agent",
  "sources": {
    "pi": "/absolute/canonical/mahiro-pi",
    "mods": "/absolute/canonical/mods",
    "skills": "/absolute/canonical/mahiro-skills"
  },
  "components": {
    "packages": true,
    "roles": true,
    "skills": ["recap", "working-tasks"],
    "skillPolicy": true
  }
}
```

Omitted components are not requested. Unknown fields, false selections, untyped
identifiers and empty/duplicate skill lists reject. Skill names may select the
canonical owner's bundles/dependencies; the plan reports the expanded concrete
skill names. Commands/aliases are not installed. Unsupported legacy skill receipts
or owned alias migration require the skill owner's explicit review first.

```sh
pnpm run bootstrap --manifest /absolute/private/bootstrap.json --plan
# Review sources, expanded skills, target hashes, actions and policy restrictions.
pnpm run bootstrap --manifest /absolute/private/bootstrap.json \
  --apply --expect-plan <exact-reviewed-sha256>
```

Preview writes nothing. Apply recomputes the complete source/target snapshot and
rejects stale or tampered plans before any profile change. Use a new plan after
source changes, target edits or partial execution. The digest is not approval by
itself: only an explicitly authorized operator should execute apply.

## Applied behavior and preservation

- Append the exact installed permission and patched subagent roots, the complete
  Mods adapter package and this Pi package to `settings.json`. Preserve unrelated
  settings and package entries. Filtered/aliased/conflicting required sources,
  direct required-extension overrides and broad exclusion globs block rather than
  being silently rewritten. No package manager or network is invoked.
- Preserve subagent configuration and unrelated exclusions; add the **exact
  configured subagent source** to `excludedExtensionPackages`. Stale subagent
  exclusions or any guards/permissions/memory exclusion block. Children retain
  the complete guards and permissions package.
- Register **only** `memory-reflector`, `managed-memory-writer`, `git-commit`:
  missing creates, byte-identical is no-op, different blocks before apply. Personal
  roles and authored routes/locks are never rewritten. Registering git-commit is
  not authorization to commit.
- Ask `mahiro-skills` to plan/install with explicit Pi root and global scope.
  Bootstrap never copies skill bodies or passes `--overwrite`. Existing selected
  targets require a current matching owner receipt; source/target drift blocks.
  Only missing selected skills are installed; no-op reruns retain owner receipts.
- Compose existing setup behavior only when `skillPolicy` is selected. This is
  the approved default all-installed/future skill policy, retaining scalar and
  ordered named restrictions, deny reasons and unrelated surfaces. Readiness is
  not claimed when retained restrictions remain. In particular **existing
  `yoloMode: true` is preserved**, never reverted or set by bootstrap.

No default provider/model/thinking, authentication, MCP, personal roles, identity
bootstrap, C1 archives, corpus import or external-directory permissions are
provisioned. New config/role/backup/bootstrap-receipt files are private; existing
config modes are preserved. The skill owner retains payload/executable bits and
its own receipt semantics beneath the private profile root.

## Optional guarded memory initialization

Add an explicit `memory` selection inside `components`, with `packages` and
`roles` also selected:

```json
{
  "root": "/absolute/private/new-managed-memory",
  "project": "/absolute/canonical/project",
  "projectId": "project",
  "seedFile": "/absolute/private/reviewed-core.md",
  "automatic": false
}
```

The seed must be a private regular **exactly 0600** UTF-8 file (0400 and 0700
reject in both coordinator and native preflight), nonempty and at most 8192
bytes. Seed text is never printed or retained in bootstrap receipts. `automatic`
defaults to false. Initialization uses the current bounded managed-memory defaults,
not a corpus migration, budget expansion or bootstrap rewrite. Git identity/hooks
must already work; bootstrap neither configures identity nor bypasses hooks.

For an absent root, the reviewed plan grants **only** the exact-root
`managed_memory_<sha256(canonical-root)>` scalar and five named managed-memory
tools. Conflicting existing restrictions block. No generic filesystem, external
write or C1 authority is added. When selected together, skill-policy and memory
authority are composed into one validated config publication.

The explicit `lib/bootstrap-native.mjs` subprocess loads only the public declared
SDK/AI entries from the existing canonical Mods installation. It constructs an
in-memory credential/model runtime, disables network/model refresh, loads the
four required package sources with context/skills/MCP disabled, checks healthy
canonical guards and public patched service/role discovery, and enters Pi's
normal native tool pipeline with exactly one `agent_memory_manage initialize`.
The store's own validation, secret screening, private modes and Git hooks remain
active. It never calls the store's initialize method directly. It checks the next
primary request's committed projection before returning a hash/revision receipt.

**Faux is deterministic simulated transport, not inference**. The ephemeral
synthetic model used to enter native dispatch does not change profile defaults,
authentication or role routing, and is not proof of native default-provider/model
behavior. No external provider requests are allowed. Seeds/tool arguments exist
only in this in-memory session, not a persisted bootstrap transcript.

An existing root is never reseeded, repaired, imported or automatically enabled.
An empty/invalid directory blocks. A valid existing store is read-validated through
the owned store reader (config, ledger, committed snapshot and private Git layout),
bound by hashes and rechecked at its execution step. Its seed and requested
`automatic` flag are ignored. A completed preserve step means validated unchanged
storage, **not a new grant, fresh native activation or live-context proof**. The
bootstrap does not modify or remove an existing grant to make it appear ready.

## Failure and manual recovery

This is sequential composition across owners, **not cross-owner atomicity**, a
filesystem lock, crash-recovery journal or same-UID security sandbox. Each apply
writes a private receipt under:

```text
<agentDir>/.mahiro-bootstrap/receipts/<run-id>.json
```

All planned steps begin `not-attempted`; attempted steps become `running`, then
`completed` or `failed`. First failure stops later steps. Completed changes remain;
there is no rollback over concurrent user edits. Config/role publication keeps
private original-byte backups, exclusive temporary files and final CAS rechecks.
Publication failures retain whether replacement occurred, completed backup paths
and any residual temporary path. Atomic rename and fsync do not establish atomic
success across skill receipts, settings, roles and memory Git.

After failure: inspect the exact step receipt, current target hashes, owner skill
receipt and private memory state. Retain backups/proposals and any newly initialized
memory revision. Never delete/reseed an existing memory directory to retry. Fix the
specific owner failure and obtain a fresh reviewed plan. Restore only reviewed
owned fields/files after comparing current content; do not restore a whole profile
or overwrite later human edits. Process interruption or receipt-write failure can
leave the last recorded step `running`; inspect actual owner state before retrying.

## Verification and remaining boundaries

```sh
node --test --test-concurrency=1 test/bootstrap*.test.ts
pnpm check
pnpm check:format
git diff --check
```

Source tests use disposable profiles only under ignored runtime state. Private
integration tests skip explicitly when canonical local prerequisites are absent;
this does not establish bootstrap readiness on a public checkout. No dependency
installation, global-profile change or provider inference occurs during tests.

The native SDK/Faux fixture exercises actual bootstrap-created packages/roles,
guarded new-root initialization, skills discovery from the disposable profile,
public patched service capability, fresh-session projection, revocation and
valid-existing-root no-op. It also dispatches one actual locked native memory
child with simulated transport, verifies child bound identity/session output,
private prompt replacement and successful procedure integration. This is native
runtime/public-API evidence with synthetic data, not paid-provider behavior,
interactive reload, full personal-roster coverage or human daily/RAM acceptance.
Fresh independent QA follows the product writer's handoff; writer-run green
checks are not independent QA. Real profile apply, package/dependency install,
reload, commits, publication and human acceptance require their own scope approval.
