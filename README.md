# Mahiro Pi

A native [Pi](https://pi.dev) extension for a persistent coding companion:
terminal presentation, private maintained knowledge, guarded command rewriting
and explicit workflow tools. Pi keeps ownership of models, authentication,
native tools and subagent lifecycle.

**v0.3.0 · Pi ≥1.3.0 · Node ≥22.19.0 · pnpm 10.33.0**

[Install and upgrade](docs/getting-started.md) · [Documentation](docs/README.md) ·
[Source releases](https://github.com/mahirocoko/mahiro-pi/releases) ·
[Development](docs/development.md)

## Install

```sh
git clone https://github.com/mahirocoko/mahiro-pi.git
cd mahiro-pi
pnpm install --frozen-lockfile
pnpm install:profile --preview
# Review the target profile, proposed changes and retained restrictions.
pnpm install:profile
```

The explicit installer registers the canonical checkout, pinned public permission
and subagent packages, three package-owned roles and narrow feature-data grants.
It preserves existing memory, unrelated settings and explicit RTK `off`.
A new memory root gets a neutral scaffold, not an imported persona or corpus.

Installation does not copy credentials, select a model or reload Pi. Start a
fresh session in your project when ready. Source changes alone do not activate
in an already running session. See [installation](docs/getting-started.md) for
profile selection, restriction failures and upgrades.

## Features

| Area | What it provides |
| --- | --- |
| [UI and theme](docs/claude-ui.md) | Neko-Stack header, individual tool rows, historical edit diffs, submitted-content write previews and explicit appearance controls |
| [Status and notifications](docs/status.md) | Native usage, Git/context/RTK status, a streaming activity line and macOS completion voice |
| [RTK](docs/rtk.md) | Visible modes, bounded resolver proposals and policy checks before execution |
| [Memory and recall](docs/agent-memory.md) | Private Markdown/Git knowledge, scoped drafts, bounded lexical retrieval and separately screened historical quotations |
| [Guards and permissions](docs/guards.md) | One Root guard, public permission resolution, final-argument checks and filtered configuration helpers |
| [Workflow tools](docs/workflows.md) | Goals, Code Evidence, UX handoffs and optional execution coordination metadata |
| [Utilities](docs/utilities.md) | Realignment guidance, branch-aware response copying, run-start clock metadata and Code Map navigation guidance |
| [Integrations](docs/integrations.md) | Optional parent-scoped Herdr worker counts and session-opt-in private Web receipts |

## Useful controls

```text
/mh-ui settings          Preview appearance; runtime Apply or explicit Save
/mh-ui theme follow      Follow Pi's theme
/mh-rtk                  Show mode and availability
/mh-goal help            Goal controls
/mh-evidence help        Evidence collection and report controls
/mh-ux help              UX direction and review gates
/mh-run help             Execution coordination controls
/realign [focus]         Reorient around current rules and evidence
/mh-copy-code            Copy a response or code block from this branch
```

Apply and theme commands are runtime-only. Appearance Save requires the exact
authorized own-UI data owner; unavailable storage is never reported saved.
The native `/settings` → Quiet startup → `header` setting persists independently.

## Boundaries

- Loading resources grants nothing. Public PSS is the sole policy resolver.
  Retained tool/path/Bash restrictions remain effective. These guards are
  **not an OS sandbox** or general shell/interpreter file-access detector.
- Renderers do not execute tools. Write preview shows submitted content, not
  create/overwrite detection or an unauthorized before-image.
- Workflow records, reported checks and worker counts are metadata, not execution
  proof, task-board acceptance or automatic Goal completion.
- Native direct OpenAI quota is intentionally omitted; native session usage
  remains available. No borrowed credentials or speculative quota calls.
- Public source does not include private profiles, memory or runtime evidence.

This package remains `private: true` and `UNLICENSED`. GitHub source releases
are not npm publication or a license grant. See [third-party notices](THIRD_PARTY_NOTICES.md)
for palette attribution and [v0.3.0 notes](docs/releases/0.3.0.md) for the dated
release scope; current contracts live in the guides above.
