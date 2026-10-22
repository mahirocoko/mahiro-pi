# Profile installation contract

[← Documentation](README.md) · [Quick start](getting-started.md) · [Permissions](guards.md)

## Standard installation

```sh
pnpm install:profile --preview
pnpm install:profile
```

`install.mjs` composes one canonical source checkout, pinned public owners,
three package roles, narrow feature-data authority and the absent-state RTK
`rewrite-rtk` default. The manifest is guards-first13: bootstrap, one Root guard,
ten features and the rendering-only UI adapter. Worker activity is optional and
outside that default graph. No theme is automatically selected.

Dependencies must already be installed. This command does not install packages,
copy auth, select models, modify personal roles or reload Pi. Loading resources
or starting a session never provisions a profile.

The target is `--agent-dir`, otherwise `PI_CODING_AGENT_DIR` (including `~/`
expansion), otherwise `~/.pi/agent`. Use the same target for preview and apply.
Source/profile paths must be canonical and non-symlinked, with safe ancestors;
profiles cannot overlap source roots. Safe profile containers may be 0755;
owned private data directories/files remain 0700/0600.

## Grants and retained restrictions

The public permission service (PSS) is the sole runtime resolver. Explicit
installation composes named tools and canonical feature DATA capabilities,
not generic filesystem, HOME, external-directory or Bash authority.

- Goal, Evidence, UX and Run receive separate namespace DATA grants. Projects
  derive private leaves without per-project configuration. Legacy leaf/tool/path
  restrictions still apply.
- RTK and own-UI use fixed profile-wide preference roots. The exact
  `own_ui_state_data_<sha256(canonical profile/preferences/own-ui)>` capability
  covers appearance only, with no synthetic `mh_ui` tool grant or global theme write.
- Continuity and managed memory retain separate capabilities; historical recall
  authority does not authorize maintained writes. Code Map tool authority is
  separate from feature-data installation.
- Exact winning-surface attestation is required at execution. A source declaration,
  installed role or successful receipt does not guarantee every call is permitted.

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
are no-op; differing bodies block rather than being overwritten.

The installer registers public permission/subagent packages before this package.
Children retain guards and permission ownership; duplicate/conflicting owners,
unsupported aliases and required-resource exclusions refuse. A source path change
must align with public native-factory provenance, not be bypassed with a second guard.

An absent memory root receives a neutral scaffold and automatic reflection policy
through guarded public SDK initialization. Faux is deterministic simulated
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
locks or restore an entire old profile over concurrent edits. Resolve the named
owner failure and review a fresh plan. Installed dependencies and cached sessions
remain separate: publication or offline tests do not prove runtime activation.
