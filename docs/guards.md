# Guards and permissions

[← Feature guide](README.md) · [Installation](getting-started.md) · [RTK](rtk.md)

Mahiro Pi uses **one Root native guard** and the public permission-system as the
sole policy resolver. It does not run a second permission engine, borrow another
host's grants or replace native tool/subagent ownership.

## What is enforced

- Canonical healthy execution context and exact tool provenance.
- Existing public tool/path policy, including retained denies.
- Secret reads through that public policy, including the opt-in BASIC
  `path_read` defaults described in [the installation contract](bootstrap.md).
  The custom secret checker is not a second resolver. Its four filtered
  helpers remain, and an omitted helper path is still a native path decision.
- Commit-attribution checks at final execution.
- A second public path or Bash check after ordinary and codemode argument
  changes. A matched deny blocks. A matched ask passes only by consuming a
  public `permissions:decision` allow for the same surface and path from the
  current turn, so a one-time approval passes once and a path rewritten after
  the gate is refused without a second prompt. An unmatched universal fallback
  stays with the public gate, and an approval already recorded as allow still
  passes.
- RTK authorization for original, proposed and sanitizer-transformed final
  arguments before native spawn.
- Separate exact feature-DATA capabilities for private feature storage.

The manifest starts with `lib/guards/bootstrap.mjs`, then
`lib/guards/index.ts`; features follow. The authored dependency patches and
pinned public packages are part of this repository's contract. No Mods checkout
is required. Loading source grants no capability.

## Installation is explicit, not a bypass

`pnpm install:profile --preview` explains the intended composition.
A reviewed apply may register required owners, roles and narrow tool/DATA grants.
It preserves restrictions, explicit offs, existing private memory and unrelated
settings. Unsupported/restricted requirements refuse rather than silently
reporting usable installation.

The optional `--remove-default-deny` flag removes only scalar top-level
`permission["*"]: "deny"` by explicit consent. It neither sets blanket allow nor
overrides targeted restrictions. Public permission fallback remains `ask`;
existing yolo behavior is unchanged. See [the full policy contract](bootstrap.md).

## Failure and ownership

A denial, unhealthy canonical node, unsupported alias or missing provenance is
not permission to retry through a helper, changed command spelling or another
executor. Stop, preserve the actual state and resolve the named owner/contract.
Do not disable guards, copy credentials or add a second guard.

Native subagents keep their own policy and exact session owner. Primary control
does not automatically authorize a child or grant it maintained-memory writes.
The locked writer's narrow tools and scoped private view remain separate.

Commands and source tests do not prove actual profile activation. An upgrade
must align the version-bound source, dependencies and public factories before an
intentional fresh load; offline/Faux evidence is not provider or human proof.
Original Letta guards remain historical differential fixtures, not runtime
dependencies. Public source visibility does not expose private profiles or
managed-memory state.
