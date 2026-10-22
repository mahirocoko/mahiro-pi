# Profile installation contract

[← Feature guide](README.md) · [Installation](getting-started.md)

This is the detailed profile installation/policy contract. For the shortest
setup and upgrade path, start with [getting started](getting-started.md).

## One-install composition (historical active10 hold retired)

The actual manifest is now guards-first13: bootstrap, one Root guard, the preserved ten features and the rendering-only [Claude UI adapter](claude-ui.md). Its optional theme is not auto-activated. Disposable candidates mirror this graph, not another live owner. The earlier active10 refusal is historical. Source changes do not reload the cached real profile.

```sh
pnpm install:profile [--agent-dir /absolute/canonical/profile] [--preview] [--remove-default-deny] [--native-basic-file-policy]
```

`install.mjs` explicitly composes required public packages, the three owned system roles, narrow `featureData` grants and RTK's rewrite-rtk default once. Preview is optional. Startup grants nothing. It never installs dependencies, copies auth, changes personal roles/models, reloads a session or grants generic filesystem/HOME/Bash authority. Existing role differences block; restrictions and explicit RTK off remain effective.

Goal/Evidence/UX/Run derive separate canonical project leaves without per-repo config. Exact `<feature>_state_data_<sha256(canonical-namespace)>` public grants cover only structurally derived feature DATA, with exact named tools. Explicit legacy leaf/tool/path denials still reject; no alternate public-policy resolver exists. When any selected required exact tool/DATA grant is missing under retained universal scalar `permission["*"]: "deny"`, preview/apply refuses **before profile writes**, naming `--remove-default-deny`. If every selected exact grant already explicitly allows, that legitimate deny-by-default profile succeeds structurally without consent and preserves `*`; it is not a claim that cross-cutting runtime policy permits every call. That explicit consent (typed manifest `components.removeDefaultDeny: true`, requiring `featureData: true`) deletes only that exact key/value, never substitutes blanket allow. Absent `*` is idempotent; with the flag, any existing non-deny `*` rejects unchanged for separate review. Public PSS 40.2.2 owns resolution: unset fallback is `ask`; existing `yoloMode` is unchanged and can promote asks, never denies. Other uncertain top-level wildcard restrictions refuse insertion of missing grants as conservative unknown coverage; specific required tool/DATA restrictions refuse installation with named unprovisioned capabilities instead of silently skipping grants or reporting usable completion. Unrelated targeted and legacy leaf/path restrictions remain preserved and reported by surface name, not treated as denial of all features. No flag can override those restrictions. Runtime path/legacy-leaf denials and explicit feature offs remain effective; installation is not a claim that every operation is permitted. Safe 0755 profile parents are accepted, owned data remains0700/files0600 and unsafe ancestors reject.

A truly fresh memory root gets only a neutral scaffold through guarded native SDK/Faux initialization (zero external inference); existing Core/config/ledger/views/conflicts/corpus are read-validated and never reseeded. Scoped subprocess Git metadata is not personal Git config; hooks remain active. A fresh accepted C1 archive is truthfully empty, not an empty fallback for corrupt/revoked data. Main shares relevant knowledge across canonical projects; actual workers remain lease-scoped. `test/install-ready.test.ts` owns the actual-root regression. Real profile activation, human acceptance and the old live recall/reflection/launcher cause remain separate boundaries.

An explicit runtime cutover must align the public subagents factory's canonical source with the single guard owner's provenance resolver. Healthy read/bash/codemode alone do not establish that alignment: preflight actual meta-tool dispatch as well as secret denial, then verify a real child after the fresh load. A changed factory path with the legacy guard can correctly fail closed as an unsupported alias even while ordinary tools remain healthy. Never disable that check, forge ToolInfo or append a second guard to work around it.

Earlier offline installed-root repair and the 2026-10-19 managed-memory activation are separate historical operations. The source-only audit preserved its 318 inventoried assets and settings. The separately approved 2026-10-20 runtime operation deliberately updated the pinned subagents package offline and changed only private resource registrations, retaining rollback evidence. That operator cutover alone did not establish install readiness. The subsequent source graph/installer repair is separate from those dated observations.

## Scope and owners

`bootstrap.mjs` and `lib/bootstrap.ts` compose one explicitly selected private
profile. They are separate from the unchanged default-skill-only `setup` command,
package installation, extension startup and the real machine's activation state.
There is no install hook or automatic global configuration write.

This is an explicit local flow, not automatic activation. The manifest names this canonical `mahiro-pi` checkout. No Mods checkout, runtime adapter or Letta source is required. `sources.skills` names the separate canonical `mahiro-skills` owner only when skill copying is selected; package-only preview needs no skill checkout. No publication is required. Plans
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
| Ordered native guards, narrow ABI, pinned dependency/patch provenance | This repository: `lib/guards/`, root manifest/workspace/lock and `patches/`; public permission-system alone resolves policy |
| Three role source bodies | This repository's `agents/` |
| Reusable skill payload transforms, copying and receipts | Canonical `mahiro-skills` plan/install CLI |
| Default all-installed/future skill policy | Existing `inspectSetup` / `applySetup` |
| Optional private maintained knowledge | Existing managed-memory owner and guarded native `agent_memory_manage` |

Root declares pinned subagents **23.4.1** and permissions **40.2.2**, with both authored patches bound by its workspace and lock. Public host packages are peers, with SDK/AI/TUI **1.3.0** pinned for development. Future dependency installation is an explicit operator action in this repository, never performed by bootstrap. `dependencyModules` may explicitly select a reviewed public-package supply; otherwise the plan uses this package's `node_modules`. There is no sibling lookup, credential copy or path fallback.

The plan checks public package identity, ordered `lib/guards/bootstrap.mjs` then `lib/guards/index.ts`, canonical patch hashes in the lock, public initial-outcome/role-query declarations and a read-only reverse-patch check of supplied patched subagents. Native initialization additionally checks
the actual healthy guard node, runtime patch marker and discovered role names.
Bun must already be available for the skill owner's CLI **only when selected skill copying needs that owner**; package-only candidate preview needs neither a skill checkout nor that CLI. Nothing installs it.

The source contract also checks the authored permission-system 40.2.2
`matchedSurface` patch mapping/hash in the lock. The source snapshot already binds
both patch artifacts and workspace/lock bytes. This does not claim that an older
installed permission tree is patched merely because source declares it. Memory/skill-only
bootstrap selections do not grant Code Map or Goal authority. Selecting `featureData`
in an explicit apply intentionally composes named Goal tools and its canonical DATA
namespace; Code Map authority remains separate. Actual execution still rejects
missing winning-surface metadata. Planning and source tests do not activate the real
profile, and a fresh load remains separately authorized. Positive Code Map proof
uses an isolated patched-source mirror; an old service lacking attestation remains denied. Current installed-asset preservation is phase-specific, not a claim that earlier repair never occurred.
Goal uses the same authored owner metadata; actual-root installation tests supplement the isolated-source historical proof boundary.

## Optional BASIC native file read defaults

`--native-basic-file-policy` independently opts in to `components.nativeBasicFilePolicy: true`.
It is **not enabled by default**, by `featureData`, by `removeDefaultDeny`, or by
package/role installation. It does not select skills or change the skill-only
`setup` owner. The pure `planNativeBasicFilePolicy(previous)` advisor validates a
bounded strict public config without filesystem discovery or policy evaluation.
Only public PSS 40.2.2 resolves runtime policy; project overrides and existing
`yoloMode` remain authoritative. A source load or startup never seeds these defaults.

The finite list emits exactly each basename and `*/<basename>` as `path_read`
deny entries: `.env`, `.env.local`, `.env.development`, `.env.test`,
`.env.production`, `.env.staging`, `.env.development.local`, `.env.test.local`,
`.env.production.local`, `.env.staging.local`, `.npmrc`, `.pypirc`, `.netrc`,
`auth.json`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ecdsa_sk`, `id_ed25519`, and
`id_ed25519_sk`. It adds no `.env.*`, extension/PEM/public-key patterns, template
or example blanket, allow exceptions, or catch-all allows. BASIC is incomplete
by design: this is read-only policy advice, **not write protection, a sandbox,
or coverage of all secret formats**.

Only missing keys are prepended before all existing `path_read` entries. Existing
keys, values, deny reasons and order remain intact, so later user decisions can
win. Existing allow/ask entries produce a generic warning, not a private decision
dump; a trailing `path_read["*"]: "allow"` remains and can defeat all inserted
defaults. No protected-state claim is made. Generic `permission.path` (map or
scalar), scalar `path_read`, or nonuniversal surface wildcards conservatively skip
automatic insertion with unchanged bytes and a reason. Generic path preservation
is essential because public directional sugar prioritizes explicit directional
policy over generic policy. Integer-like read-pattern keys refuse unsupported
ordering; malformed/unsupported config refuses before writes. Universal `*`,
write/tool/Bash/external-directory policy and yolo are untouched.

The advisor composes after selected skill, memory and feature transformations.
Bootstrap updates or creates one config-target change, publishes those composed
bytes exactly once through existing CAS/private backup handling, and never follows
that publication with stale skill output. Plan digest, preview and apply receipts
include nullable status, added patterns, retained surface names, warnings and
`runtimePolicy: "public-service-authoritative"`; preview/receipts omit config
bodies. Existing default-deny removal consent is unchanged. Real profile apply,
reload and human acceptance remain separate authorized actions.

## Goal configuration preview is separate and read-only

Goal is the seventh feature and ninth guard-inclusive manifest resource.
`pnpm goal:preview --project /canonical/project --agent-dir /private/profile`
validates and prints only an optional legacy config and derived capability names.
It has no apply option and writes nothing, even when the profile is absent.
Review [`goal.md`](goal.md) for native profile/project/session semantics and private
modes. Preview and resource startup never grant authority or seed Goal state.
By contrast, explicit `install:profile` or bootstrap apply with `featureData`
intentionally composes named tool and canonical Goal DATA grants once, without
per-project configuration. Dependencies must already be available; real profile
activation/fresh load remains a separately authorized operator action.

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

- Append the exact installed permission and patched subagent roots and
  this complete candidate Pi package to `settings.json`. Preserve unrelated
  settings and package entries. The reviewed same-owner upgrade canonicalizes an
  unfiltered local Root path only when it resolves lexically to the exact canonical
  source (no symlink ancestors). Only the two declared public dependency links may
  canonicalize through their already-verified exact realpath owners; arbitrary
  symlink aliases are not accepted. Unrelated packages retain their order, followed
  by exactly one permissions/subagents/Root sequence so public parent services
  register before Root. It removes the exact canonical `Root/lib/guards`
  package only after safe metadata/source checks prove its bootstrap/index pair is
  already first in Root's manifest. Exact canonical direct bootstrap and optional
  worker entries remain: public SDK resource identity deduplicates bootstrap and
  worker stays additive. Filtered required sources, other aliases/conflicting
  owners, direct required-extension overrides and broad exclusion globs still
  block rather than being silently rewritten. No package manager or network is invoked.
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
- `featureData` installation provisions the nine ordinary Goal/Evidence/UX/Run tool names and four canonical DATA namespaces, plus the existing RTK, continuity and managed-memory capabilities. Registration/startup grants nothing; installed tool availability does not authorize human-owned workflow creation. Explicit `removeDefaultDeny` consent is included in reviewed digest/CAS checks and uses the same private backup/publication pipeline as other config edits. Without it a retained universal deny with missing selected exact grants refuses before writes; a fully explicitly provisioned profile keeps that deny. Specific required restrictions are never silently overridden. Preview/apply receipts report provisioned capabilities, retained restriction surface names, removal consent outcome and whether the existing RTK default (including off) was preserved; runtime permission service remains authoritative.
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
SDK/AI entries from the declared Root dependencies or explicitly reviewed public-package supply. It constructs an
in-memory credential/model runtime, disables network/model refresh, loads the
three required package sources with context/skills/MCP disabled, checks healthy
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
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/bootstrap*.test.ts
pnpm check
pnpm check:format
git diff --check
```

Source tests use disposable profiles only under ignored runtime state. The required Root-owned public SDK suite fails if its public-package supply is missing; it never treats absence of Mods as a successful skip. The standalone fixture executes CLI preview and public SDK dispatch without a Mods sibling. Canonical source checks run in the actual checkout, not a mirrored whole-repository topology. No dependency
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
