# Profile installation contract

[← Documentation](README.md) · [Quick start](getting-started.md) · [Permissions](guards.md)

## Standard installation

```sh
pnpm install:profile --preview
pnpm install:profile
```

`install.mjs` composes one canonical source checkout, pinned public owners,
three package roles, ordinary ABI2 memory selection, narrow feature-data authority
and the absent-state RTK `rewrite-rtk` default. The manifest is guards-first13:
bootstrap, one Root guard,
ten features and the rendering-only UI adapter. Worker activity is optional and
outside that default graph. No theme is automatically selected.

Dependencies must already be installed. This command does not install packages,
copy auth, change primary models, modify personal roles or reload Pi. Paired
[managed-writer route flags](agents.md#managed-writer-route) explicitly review only
that canonical descriptor's model/thinking slots. Loading resources
or starting a session never provisions a profile.

The target is `--agent-dir`, otherwise `PI_CODING_AGENT_DIR` (including `~/`
expansion), otherwise `~/.pi/agent`. Use the same target for preview and apply.
Source/profile paths must be canonical and non-symlinked, with safe ancestors;
profiles cannot overlap source roots. Safe profile containers may be 0755;
owned private data directories/files remain 0700/0600.

## Read-only memory blocker inspection

```sh
pnpm install:profile --preview --inspect-memory
```

`--inspect-memory` requires `--preview`; without it the command refuses before
creating a scaffold or writing a profile. Dependencies and the ordinary canonical,
private, initialized-store validators remain prerequisites. This is inspection,
not repair: an existing memory blocker still refuses installation with the same
message prefix and lock/publication/worktree facts. Ordinary previews do not print
additional metadata.

On that blocker, explicit inspection adds protocol-1 JSON with the observed snapshot
revision, those three facts, and read-only Git porcelain `-z` relative paths plus
index/worktree status (at most 64 entries, with total/truncated indicators). It may
also show the private lock directory's type and device/inode identity, fixed marker
presence (`owner.json`, `policy.json`, `config.next`), and a schema-validated owner
operation/digest/nonce/directory. Owner input must be a private regular 0600,
single-link, non-symlink file of at most 2048 bytes; unsafe, malformed or oversized
input yields only generic unavailable reasons, never raw payloads or parser errors.
No arbitrary lock contents, corpus text, config values or credentials are printed.
Filenames are untrusted diagnostic metadata, not command operands or authority;
review output privacy before sharing it. Marker presence does not prove marker
type, executor drain, lock ownership validity or recovery safety. Observations are
not an atomic recovery proof. No cleanup, archive, reset, Git write, permission
change, native operation or reload is performed by inspection.

## Offline memory operator

Installation never repairs uncertain memory. A separate explicit owner entry is
available for the exact operation-bound unknown or terminal-dirty incident described
in [offline maintenance recovery](agent-memory.md#explicit-offline-maintenance-recovery).
No actual operator window is implied by source installation, testing or these examples.

After explicitly closing known sessions/workers for the target profile and
assuring that no cooperative external writers will start during the window:

```sh
pnpm memory:maintenance --agent-dir /absolute/canonical/profile \
  --project /absolute/canonical/project --inspect
pnpm memory:maintenance --agent-dir /absolute/canonical/profile \
  --project /absolute/canonical/project --apply --offline \
  --target <reviewed-operation-UUID> --expect <exact-inspection-SHA256>
```

The target must already have the three canonical public owners installed, a
private standard ABI2 selection, and current exact DATA/tool authority. This CLI
writes no settings or grants and does not call installation. It starts one genuine
ephemeral headless public SDK primary with deterministic Faux transport and zero
external inference; ordinary persistent primaries and native children cannot
adopt. A live Main's data child is an **unexpected** Root holder to this new
operator and causes refusal. `--offline` is operator assurance, never permission,
PID-death evidence or an override for the fixed system `lsof` tree-FD/cwd check.

Inspect returns bounded metadata/fingerprints and admission counts, not corpus or
raw configuration. Review before apply; changed bytes or identity require a new
review, not blind refresh. A dirty index, work outside the selected immutable plan,
malformed evidence, foreign CAS, remaining namespace capacity blockers, unsafe
archive inputs, incomplete holder inspection or unexpected holders refuse. Do not
kill holders, reset memory or remove markers to make installation pass.

After interruption, retain the complete private archive/workspace and marker.
Run the same `--inspect`, review its transaction/checkpoint target and digest, then
explicitly select `--resume --offline --target <transaction-UUID> --expect <digest>`.
There is no automatic replay, lost-executor drain inference or rollback. A malformed
checkpoint remains unavailable. Even with an absent `.lock` and clean Git, a
maintenance marker blocks the installer until supported owner completion.
Completed receipts say prior outcome unknown; they do not claim human acceptance.
The explicit operator is completion-driven: it retains fixed resource, output,
Git-command and holder-inspection bounds but does not terminate a valid large
archive on an arbitrary whole-operation wall clock. Its dedicated cold
certification remains cancellable and fully fenced while ordinary engine requests
keep their 30-second deadline. Success is the validated maintenance receipt; a
separate profile reload/runtime check owns later projection and activation proof.

## Grants and retained restrictions

The public permission service (PSS) is the sole runtime resolver. Explicit
installation composes named tools and canonical feature DATA capabilities,
not generic filesystem, HOME, external-directory or Bash authority.

- Goal, Evidence, UX and Run receive separate namespace DATA grants. Projects
  derive private leaves without per-project configuration. Legacy leaf/tool/path
  restrictions still apply.
- RTK, own-UI and usage use separate fixed profile-wide preference roots. The exact
  `own_ui_state_data_<sha256(canonical profile/preferences/own-ui)>` capability
  covers appearance only, with no synthetic `mh_ui` tool grant or global theme write.
  Usage has its own exact `usage_state_data_<sha256(canonical profile/preferences/usage)>`
  grant, no synthetic command-tool grant and no own-UI/settings authority. Explicit
  installation alone composes it; loading source or reading absent preferences
  provisions nothing. Previously installed profiles may require an approved update.
- Continuity and managed memory retain separate capabilities; historical recall
  authority does not authorize maintained writes. Installation also grants the
  bounded `mh_code_map` tool; it does not grant access to workspace files.
- Reflection denial is retained without blocking manual-memory installation.
  Unrelated `continuity_learning` authority is neither granted nor required.
  A targeted deny changes only through supported public PSS configuration/approval
  under human authority, never via an installer bypass.
- Execution checks the applicable feature authority: workflow tools, Code Map and
  RTK use ordinary PSS decisions; maintained memory and certain preferences also
  require their exact DATA authority. A source declaration, installed role or
  successful receipt does not guarantee every call is permitted.

A retained scalar top-level `permission["*"]: "deny"` blocks installation
**before profile writes** when a selected required exact grant is missing.
A fully explicitly provisioned deny-by-default profile keeps that deny.

To remove only that scalar deny, explicitly review both commands with:

```sh
pnpm install:profile --remove-default-deny --preview
pnpm install:profile --remove-default-deny
```

The flag deletes that exact key/value; it never substitutes blanket allow.
An absent key is idempotent; an existing non-deny value with the flag rejects.
Unset fallback belongs to public PSS (`ask`); existing yolo settings are unchanged.
Specific required tool/DATA restrictions still refuse. Other uncertain wildcard
restrictions conservatively block insertion of missing grants. Unrelated targeted
restrictions remain intact and are reported by surface name.

## What is preserved

Unrelated settings/package entries, explicit RTK `off`, subagent configuration,
personal roles, existing Core/config/ledger/data and existing automatic-memory
policy are preserved. Missing package-owned roles are created; identical bodies
are no-op; differing bodies block rather than being overwritten, except the
managed writer's supported model/thinking slots. Its canonical selected route
survives ordinary upgrades; all other descriptor bytes remain fixed.

The installer registers public permission/subagent packages before this package.
Children retain guards and permission ownership; duplicate/conflicting owners,
unsupported aliases and required-resource exclusions refuse. A source path change
must align with public native-factory provenance, not be bypassed with a second guard.

Standard installation writes a private 0600 `<profile>/.mahiro-memory-engine.json`
with exactly `version: 2`, `root: <profile>/memory` and `mode: "engine"`. It is
separate from the closed memory config schema and grants no authority. An absent
record retains ABI1; explicit `legacy`/`off` records are preserved, invalid records refuse.
Absent-root off/legacy standard installation refuses before writes. Existing
Core/persona/policy/data stay intact; dirty or uncertain storage is not repaired.

An absent memory root receives an editable generic coding-companion starter and
automatic reflection policy through guarded public SDK initialization.
Faux is deterministic simulated
transport, **not provider inference**; no external model request occurs.
Existing memory is never reseeded, imported or repaired. Invalid existing storage
blocks. See [memory](agent-memory.md) for authority, Git hooks and retention limits.

## Optional BASIC read defaults

`--native-basic-file-policy` independently selects finite `path_read` deny
defaults. It is off by default and is not implied by feature data or default-deny
removal. The finite basenames are:

```text
.env .env.local .env.development .env.test .env.production .env.staging
.env.development.local .env.test.local .env.production.local .env.staging.local
.npmrc .pypirc .netrc auth.json
id_rsa id_dsa id_ecdsa id_ecdsa_sk id_ed25519 id_ed25519_sk
```

Each adds only its basename and `*/<basename>`. No `.env.*`, PEM, public-key,
template or catch-all pattern is added. Missing keys are prepended before
existing directional read rules, preserving their values and order; later user
rules can win, including a trailing allow that defeats the defaults.

Generic `permission.path`, scalar `path_read` or uncertain nonuniversal surface
wildcards skip automatic insertion unchanged with a reason. Unsupported ordering
or malformed configuration refuses. Write/tool/Bash/external-directory policy and
yolo are untouched. This is incomplete read-policy advice, **not write protection,
complete secret detection or a sandbox**. PSS recognizes a limited set of Bash
operands; arbitrary interpreter file access is not detected.

## Advanced reviewed bootstrap

`bootstrap.mjs` / `lib/bootstrap.ts` compose selected owners from an explicit
private JSON manifest. Unlike the standard installer, there is no implicit target.
The manifest must be a regular exactly 0600 UTF-8 file outside tracked source.
Paths are absolute, canonical and non-symlinked. Unknown fields and false/empty
component selections reject.

```json
{
  "version": 1,
  "agentDir": "/absolute/private/profile",
  "sources": {"pi": "/absolute/canonical/mahiro-pi"},
  "components": {"packages": true, "roles": true, "featureData": true}
}
```

```sh
pnpm run bootstrap --manifest /absolute/private/bootstrap.json --plan
pnpm run bootstrap --manifest /absolute/private/bootstrap.json \
  --apply --expect-plan <exact-reviewed-sha256>
```

Plan writes no profile state. It binds source revisions and payload hashes,
including dirty bytes, manifest/patch/lock metadata, public factories, installed
dependencies and target hashes. Apply recomputes the snapshot and rejects stale
plans before changes. The digest is freshness metadata, not human authorization
or a signature over the entire transitive dependency closure.

Optional components:

| Selection | Contract |
| --- | --- |
| `removeDefaultDeny: true` | Requires `featureData: true`; same scalar-only consent as above |
| `nativeBasicFilePolicy: true` | Independent finite BASIC read defaults |
| `skillPolicy: true` | Calls the existing default skill-policy owner |
| `skills: ["skill-name"]` | Requires explicit `sources.skills`; that skill owner's CLI handles copying/receipts, never implicit overwrite |
| `memoryEngine: true` | Selects the ordinary per-profile engine, preserving explicit off/legacy |
| `managedWriterRoute: {"model": "exact-provider/model-id", "thinking": "medium"}` | Requires roles; varies only canonical managed-writer route slots |
| `memory: {...}` | Requires packages/roles; guarded absent-root initialization with explicit root/project/projectId/seedFile and optional automatic flag |

An explicit memory seed is nonempty UTF-8, at most 8192 bytes and exactly 0600.
Its text is not printed or retained in receipts. Custom initialization defaults
`automatic` to false; existing storage ignores seed/policy requests and remains
unchanged. Git identity and hooks must already work; bootstrap does not configure
identity or skip hooks. Initialization enters the normal guarded native tool
pipeline, not a direct store mutation.

`pnpm run setup --plan` / `--apply` are separate default-skill-policy operations,
not package/role/memory installation. Bare `pnpm setup` is unrelated.

## Failure and recovery

Composition is sequential across owners, **not cross-owner atomicity**.
Private receipts live at `<profile>/.mahiro-bootstrap/receipts/<run-id>.json`.
Steps begin not-attempted, then running/completed/failed. First failure stops
later steps; already completed changes remain. Private original-byte backups,
exclusive temporaries and CAS protect publication, not a whole-profile rollback.

After failure, inspect the exact step receipt and current owner state. Retain
backups, proposals and any initialized memory revision. A receipt-write failure
or interruption can leave a running step. Do not delete/reseed memory, steal
locks or restore an entire old profile over concurrent edits. A runtime policy
interruption is separate from installer recovery: authorized policy status and
fresh explicit `policy-reconcile` can clean only verified owned files after actual
same-process drain, never replay/revert config. Restart/missing-reference or
mismatched evidence remains retained for owner review; see the
[policy interruption limit](agent-memory.md#policy-interruption-limit).
Resolve the named owner failure and review a fresh plan. Installed dependencies and cached sessions
remain separate: publication or offline tests do not prove runtime activation.
