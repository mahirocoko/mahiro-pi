# Installation and upgrades

[← Documentation](README.md) · [Advanced bootstrap contract](bootstrap.md)

## Requirements

- Node ≥22.19.0, pnpm **10.33.0**, and Pi ≥1.3.0.
- A canonical local checkout of this repository, not a symlinked alias.
- Explicitly installed declared dependencies. The repository pins public
  permission-system **40.2.2** and subagents **23.4.1**, including its authored
  patches; public Pi SDK/AI/TUI **1.3.0** are development dependencies.
- Your own Pi provider/auth setup, including an available exact physical model
  for the [managed writer](agents.md#managed-writer-route). Review provider access,
  cost and privacy intentionally. Local readiness is not provider execution.
  Installation never copies credentials or changes personal roles/primary models.

No sibling runtime or legacy checkout is required. Source releases are on
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

Standard installation explicitly selects the ordinary ABI2 memory engine in
`<profile>/.mahiro-memory-engine.json`, separate from the closed memory-store
configuration. An absent selection record retains ABI1 compatibility; explicit `off`
or `legacy` selections are preserved. Invalid selection fails closed. For an
absent root with explicit off/legacy, standard installation refuses before writes;
review that selection or use an authorized legacy initializer, not a silent reset.
Selection is not a permission grant.

A fresh memory root receives a generic editable coding-companion starter through
the guarded native SDK pipeline with deterministic Faux transport:
**zero external inference**. Standard installation sets automatic reflection true
for that new root only; existing Core/persona/config/ledger/data and automatic
policy are preserved, not imported or reseeded.
[Customize the starter](agent-memory.md#customize-the-starter) using root-bound tools.
RTK defaults to `rewrite-rtk` only when no existing selection prevents it;
explicit `off` remains off. Review [memory](agent-memory.md) and [RTK](rtk.md).

Keep the checkout at that canonical path. Start Pi in the project where you want
to work. Goal/Evidence/UX/Run derive project state without per-repository feature
configuration. Existing sessions need an intentional fresh load; source
publication alone does not update their cached extensions.

## Check memory readiness

After a fresh load, run `/mh-memory status` (or `/mh-memory help`). **Ready** means
local prerequisites are satisfied, not that a provider ran or learning succeeded.
**Needs setup** identifies missing selection/route/native resources; **Denied**
identifies unavailable memory authority. When permitted, status also merges the
storage lifecycle: automatic on/off, draft/publication and latest observed attempt.
Unknown storage or attempt state is not idle or zero. Automatic policy is separate
from readiness and from engine off. See [lifecycle](agent-memory.md#readiness-and-lifecycle).

## If installation refuses

Do not disable guards or add a blanket allow. Retained restrictions are real:

- A top-level scalar `permission["*"]: "deny"` with missing selected exact grants
  blocks installation before writes. Only if you explicitly intend to remove
  **that scalar deny**, preview then apply with `--remove-default-deny`.
  The public fallback becomes unset/`ask`, never blanket allow.
- Already provisioned exact grants retain default deny without needing that flag.
- Specific required tool/DATA restrictions and uncertain wildcard restrictions
  still refuse. The flag cannot override them.
- A managed writer may vary only its canonical model/thinking slots. Other role
  body differences, unsafe filesystem paths or stale plans need review. No
  automatic chmod, unrelated role overwrite or auth repair is performed.
- Reflection denial is preserved and does not prevent manual-memory installation.
  Change a targeted deny only through supported public PSS configuration/approval
  under human authority. Historical quote-learning is not required or granted.
- An unavailable writer route needs your provider setup or an explicitly reviewed
  [paired route selection](agents.md#managed-writer-route), never fuzzy fallback.
- After an interrupted policy change, read authorized `policyOperation` status.
  `retained+recoverable` supports a fresh explicit primary `policy-reconcile`;
  active work must drain first and unknown/restarted operations stay retained for
  owner review. See the [policy interruption limit](agent-memory.md#policy-interruption-limit).

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

Live preview, **Apply for this runtime** and `/mh-ui theme` commands are
**runtime-only**; they never autosave. **Save preferences** explicitly persists
only the supported own-UI appearance choices after the installer provisions the
exact own-UI DATA grant and the Root owner authorizes access. Authorized TUI
startup/resume/reload loads that record. Missing, denied or corrupt storage is
unavailable, never reported saved. `/mh-ui live-tail` is not saved, and own-UI
Save does not persist the host's global theme selection or arbitrary themes.

To keep the startup header without resource listings, choose native `/settings`
→ Quiet startup → `header` (`quietStartup: "header"`). That host setting persists
independently. See [UI details and limitations](claude-ui.md).

## Optional integrations

The main manifest has 13 ordered resources: bootstrap, one Root guard, ten
preserved features and the UI adapter. The worker-activity extension is separate.
Configure it only when you explicitly want native child metadata, using Pi's
public extension settings and the exact canonical resource. Do not load a second
child manager or Web producer alongside it. See [Herdr integrations](integrations.md).

Even with that resource loaded, the Web observer stays off until
`/mh-herdr-web-observer start` in the intended interactive session.
Its directory privacy and parent/PID binding are required, not repaired for you.
[Web setup](integrations.md#web-observer) explains the separate consumer and TTL.

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
4. Preview profile installation again. Review source identity, engine selection,
   role prerequisites and restrictions before apply. Ordinary upgrades preserve
   an installed canonical writer's selected route, Core/customization, data,
   automatic policy and explicit engine off/legacy. Non-route role differences block.
5. Fresh-load only intended sessions; run `/mh-memory status`. A prior cached
   session or an installation receipt is not proof of activation. Read the
   [candidate limitations](releases/0.5.0.md) before relying on the new policy action.

A cached old guard paired with a new package can correctly refuse version-bound
feature provenance. Align source/dependencies/profile and reload intentionally;
do not forge identity or relax the guard. Publication is not automatic activation.
