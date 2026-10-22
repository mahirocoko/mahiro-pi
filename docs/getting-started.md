# Installation and upgrades

[← Feature guide](README.md) · [Advanced bootstrap contract](bootstrap.md)

## Requirements

- Node ≥22.19.0, pnpm **10.33.0**, and Pi ≥1.3.0.
- A canonical local checkout of this repository, not a symlinked alias.
- Explicitly installed declared dependencies. The repository pins public
  permission-system **40.2.2** and subagents **23.4.1**, including its authored
  patches; public Pi SDK/AI/TUI **1.3.0** are development dependencies.
- Your own Pi provider/auth setup. Installation never copies credentials, selects
  a provider/model or changes personal roles.

No Mods, Letta or sibling runtime checkout is required. Source releases are on
[GitHub](https://github.com/mahirocoko/mahiro-pi/releases), not npm.
The package remains `private: true` / `UNLICENSED`; public visibility is not a
license change. Palette attribution remains in
[third-party notices](../THIRD_PARTY_NOTICES.md).

## Install once

```sh
git clone https://github.com/mahirocoko/mahiro-pi.git
cd mahiro-pi
pnpm install --frozen-lockfile
pnpm install:profile --preview
pnpm install:profile
```

Read the preview before applying. This command is explicit consent to register
the canonical source and pinned public owners, install the three package-owned
roles and compose narrow feature-data authority. It is not a dependency installer
or startup hook. It does not reload an existing session.

The profile defaults to `PI_CODING_AGENT_DIR` when set, otherwise `~/.pi/agent`.
For another profile, select it explicitly on both commands:

```sh
pnpm install:profile --agent-dir /absolute/canonical/profile --preview
pnpm install:profile --agent-dir /absolute/canonical/profile
```

A fresh memory root receives only a neutral scaffold through the guarded native
SDK pipeline with deterministic Faux transport: **zero external inference**.
Existing Core/config/ledger/data are preserved, not imported or reseeded.
RTK defaults to `rewrite-rtk` only when no existing selection prevents it;
explicit `off` remains off. Review [memory](agent-memory.md) and [RTK](rtk.md).

Keep the checkout at that canonical path. Start Pi in the project where you want
to work. Goal/Evidence/UX/Run derive project state without per-repository feature
configuration. Existing sessions need an intentional fresh load; source
publication alone does not update their cached extensions.

## If installation refuses

Do not disable guards or add a blanket allow. Retained restrictions are real:

- A top-level scalar `permission["*"]: "deny"` with missing selected exact grants
  blocks installation before writes. Only if you explicitly intend to remove
  **that scalar deny**, preview then apply with `--remove-default-deny`.
  The public fallback becomes unset/`ask`, never blanket allow.
- Already provisioned exact grants retain default deny without needing that flag.
- Specific required tool/DATA restrictions and uncertain wildcard restrictions
  still refuse. The flag cannot override them.
- Different existing owned role bodies, unsafe filesystem paths or stale plans
  need review. No automatic chmod, role overwrite or auth repair is performed.

See [policy, preservation and recovery](bootstrap.md) for exact semantics.
Installation receipts describe applied owner steps, not a cross-owner atomic
transaction or proof that every later operation will be permitted.

## Appearance

The package registers a rendering-only UI adapter and the optional
`mahiro-claude-dark` theme. It does not select a global theme.

```text
/mh-ui settings
/mh-ui theme follow
/mh-ui theme claude
/mh-ui live-tail off
```

These choices are **runtime-only** and reset on reload. To keep the startup header
without resource listings, choose native `/settings` → Quiet startup → `header`
(`quietStartup: "header"`). That host setting persists independently.
See [UI details and limitations](claude-ui.md).

## Optional integrations

The main manifest has 13 ordered resources: bootstrap, one Root guard, ten
preserved features and the UI adapter. The worker-activity extension is separate.
Configure it only when you explicitly want native child metadata, using Pi's
public extension settings and the exact canonical resource. Do not load a second
child manager or Web producer alongside it. See [worker activity](worker-activity.md).

Even with that resource loaded, the Web observer stays off until
`/mh-herdr-web-observer start` in the intended interactive session.
Its directory privacy and parent/PID binding are required, not repaired for you.
[Web setup](herdr-web-activity.md) explains the separate consumer and TTL.

## Other setup commands

`pnpm run setup --plan` / `pnpm run setup --apply` configure only the default
skill policy; they do not install roles, memory or the full package. Use
`pnpm run setup`, not pnpm's unrelated bare `pnpm setup`.

Advanced composition uses `pnpm run bootstrap --manifest /private/manifest.json
--plan`, followed by an explicitly reviewed `--apply --expect-plan <digest>`.
Optional reusable-skill copying belongs to the separate skill owner.
See [bootstrap](bootstrap.md); source loading never provisions a profile.

## Upgrade safely

1. Read the target release notes and preserve existing local work.
2. Update the canonical checkout using an ordinary fast-forward when possible;
   resolve local differences instead of resetting them.
3. Explicitly refresh declared dependencies if the lock/patches changed.
4. Preview profile installation again. Review changed owned roles, restrictions
   and source identity before any apply.
5. Fresh-load only the session(s) you intend to update, then check their controls.

A cached old guard paired with a new package can correctly refuse version-bound
feature provenance. Align source/dependencies/profile and reload intentionally;
do not forge identity or relax the guard. Publication is not automatic activation.
