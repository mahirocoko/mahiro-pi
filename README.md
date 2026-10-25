# Mahiro Pi

A native [Pi](https://pi.dev) extension for a persistent coding companion:
terminal presentation, private maintained knowledge, guarded command rewriting
and explicit workflow tools. Pi keeps ownership of models, authentication,
native tools and subagent lifecycle.

**v0.7.0 · Pi ≥1.3.0 · Node ≥22.19.0 · pnpm 10.33.0**

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
It selects the ordinary memory engine (ABI2) per profile, preserving explicit
engine `off`/`legacy`, existing memory, unrelated settings and RTK `off`.
A new memory root gets an editable generic coding-companion starter, never
Mahiro's persona or corpus. [Customize it through memory tools](docs/agent-memory.md#customize-the-starter).

Provide your own provider/auth setup and an available exact managed-writer route.
The canonical default is documented under [role prerequisites](docs/agents.md#managed-writer-route);
paired installer flags can explicitly select its model/thinking slots only.
Installation does not copy credentials, change your primary model or reload Pi. Start a
fresh session in your project when ready. Source changes alone do not activate
in an already running session. See [installation](docs/getting-started.md) for
profile selection, restriction failures and upgrades.

## Features

| Area | What it provides |
| --- | --- |
| [UI and theme](docs/claude-ui.md) | Neko-Stack header, individual tool rows, historical edit diffs, submitted-content write previews and explicit appearance controls |
| [Status and notifications](docs/status.md) | Compact statusline, cache-only usage inspector, Git/context/RTK status, streaming activity and completion voice |
| [RTK](docs/rtk.md) | Visible modes, bounded resolver proposals and policy checks before execution |
| [Memory and recall](docs/agent-memory.md) | Private Markdown/Git knowledge, scoped drafts, bounded lexical retrieval and separately screened historical quotations |
| [Guards and permissions](docs/guards.md) | One Root guard, public permission resolution, final-argument checks and filtered configuration helpers |
| [Workflow tools](docs/workflows.md) | Readable tool cards, owner-delegating inspector, Goals, Code Evidence, UX handoffs and execution coordination metadata |
| [Utilities](docs/utilities.md) | Naturally chosen multi-step tracking, branch-local steps, editable staging, response copying, realignment, clock and Code Map |
| [Integrations](docs/integrations.md) | Optional parent-scoped Herdr worker counts and session-opt-in private Web receipts |

## Useful controls

```text
/mh                     Inspect workflows through their existing owners
/mh-usage               Session usage and supported cached account detail
/mh-ui settings          Preview appearance; runtime Apply or explicit Save
/mh-ui theme follow      Follow Pi's theme
/mh-rtk                  Show mode and availability
/mh-memory status        Memory readiness, automatic policy and authorized lifecycle
/mh-memory help          Setup and draft/publication boundaries
/mh-goal help            Goal controls
/mh-evidence help        Evidence collection and report controls
/mh-ux help              UX direction and review gates
/mh-run help             Execution coordination controls
/realign [focus]         Reorient around current rules and evidence
/mh-copy-code            Copy a response or code block from this branch
/mh-tasks                Session steps, dependencies and session-local settings
/mh-queue                Editable staging, explicit handoff and receipt inspection
/mh-queue capture off    Keep future busy interactive submissions native (default)
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
- Session steps are not task-board acceptance. Editable staging does not edit
  already-native pending rows; recorded handoff is not model completion. Capture
  defaults off and unconfirmed attempts never auto-resend.
- Native direct OpenAI quota is intentionally omitted; native session usage
  remains available. No borrowed credentials or speculative quota calls.
- Public source does not include private profiles, memory or runtime evidence.

This package remains `private: true` and `UNLICENSED`. GitHub source releases
are not npm publication or a license grant. See [third-party notices](THIRD_PARTY_NOTICES.md)
for palette attribution and [v0.7.0 source release notes](docs/releases/0.7.0.md) for the dated
source scope and verification boundaries; current contracts live in the guides above.
Existing memory retains bounded [policy interruption recovery and retained-evidence limits](docs/agent-memory.md#policy-interruption-limit).
Source publication does not install or activate memory in an existing profile.
