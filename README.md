# Mahiro Pi

A native Pi extension for a persistent coding companion: a readable terminal UI,
maintained project knowledge, guarded execution and explicit workflow tools.
It keeps Pi's own model, authentication, tools and subagent lifecycle in charge.

**v0.3.0 · Pi ≥1.3.0 · Node ≥22.19.0 · pnpm 10.33.0**

[Get started](docs/getting-started.md) · [Feature guide](docs/README.md) ·
[Releases](https://github.com/mahirocoko/mahiro-pi/releases) ·
[Development and release](docs/development.md)

## Start here

```sh
git clone https://github.com/mahirocoko/mahiro-pi.git
cd mahiro-pi
pnpm install --frozen-lockfile
pnpm install:profile --preview
# Review the target profile, actions and retained restrictions, then explicitly apply:
pnpm install:profile
```

The installer registers this canonical checkout, the pinned public permission and
subagent packages, three owned roles and narrow feature-data grants. It does not
install dependencies, copy authentication, select a model, import private memory
or reload a running session. A new memory root gets a neutral scaffold; existing
Core/data and explicit RTK `off` are preserved. Start a fresh Pi session in your
project after installation, or reload an existing session only when you intend to
activate the updated source. See [setup and upgrades](docs/getting-started.md).

The repository is public; the package remains `private: true` and `UNLICENSED`.
Releases are GitHub source releases, **not npm publication**. No Mods or Letta
checkout is required. Private profiles, memory and runtime evidence are not
release payloads.

## What you get

| Feature | What it does | Guide |
| --- | --- | --- |
| Terminal UI and Neko-Stack header | Individual tool rows, bounded split/word edit diffs, submitted-content write preview and runtime settings | [UI and theme](docs/claude-ui.md) |
| Authored footer | Project/Git, model/effort, native usage, context, extension status and a separate streaming activity line; foreground-gated Herdr display metadata | [Status and usage](docs/status.md) |
| RTK | `off`, `suggest`, conservative rewrite and installed RTK resolver modes; visible mode status and policy-checked execution | [RTK](docs/rtk.md) |
| Maintained memory | Private Markdown/Git knowledge, CAS drafts/commits, bounded lexical retrieval/discovery and scoped native writers | [Managed memory](docs/agent-memory.md) |
| Historical recall | Screened, cited history and literal low-authority quotation notes; correction and forgetting controls | [Continuity](docs/continuity.md) |
| Execution guards | One Root guard and the public permission owner; public secret-read policy, attribution and final-argument checks | [Guards and permissions](docs/guards.md) |
| Native utilities | `/realign [focus]` guidance, `/mh-copy-code` and separate run-start clock metadata | [Utilities](docs/utilities.md) |
| Code Map | Bounded navigation guidance from caller metadata, not a search/indexing engine | [Code Map](docs/code-map.md) |
| Goal Mode | Explicit objectives, criteria, evidence, blockers and revision-guarded session ownership | [Goals](docs/goal.md) |
| Code Evidence | Four bounded read-only Git lanes or metadata about an external check; never executes a recorded command | [Evidence](docs/evidence.md) |
| UX Workflow | Frame, research references, concepts, human direction, handoff and review metadata | [UX workflow](docs/ux-workflow.md) |
| Execution Run | Optional lane/report coordination; never launches workers, CLI or Git | [Execution runs](docs/execution-run.md) |
| Worker visibility | Optional native parent-scoped child counts for Herdr; separately opt-in private receipts for Herdr Web | [Worker activity](docs/worker-activity.md) |
| Completion voice | A bounded macOS notification after successful native settlement | [Completion voice](docs/finish-voice.md) |
| System roles and commit skill | Locked quote reflector, maintained-memory writer and explicitly authorized native commit role | [Agents and skills](docs/agents.md) |

## Everyday controls

```text
/mh-ui settings          Live synthetic preview; runtime Apply or authorized explicit Save
/mh-ui theme follow      Follow Pi's theme (default)
/mh-ui theme claude      Use the optional palette for these rows/header only
/mh-ui live-tail on|off  Running-output tail for this TUI session; off is the stable default. Not saved
/mh-rtk                  Show RTK status (does not change mode)
/mh-goal                 Goal help/status and explicit human controls
/mh-evidence             Evidence help/report/collection controls
/mh-ux                   UX workflow help and human gates
/mh-run                  Execution coordination help and human controls
/realign [focus]         Generate bounded guidance without a fake user message
/mh-copy-code            Copy a current-branch response or one code block
```

For a quieter startup that keeps the header, use native **`/settings` → Quiet
startup → `header`** (`quietStartup: "header"`). That host setting persists.
`/mh-ui` live preview, **Apply** and theme commands change this runtime only.
**Save preferences** is separate: when the Root owner and one exact own-UI DATA
capability are available, it durably saves only UI appearance to the fixed profile
`preferences/own-ui` root. Authorized TUI startup/resume/reload loads those choices;
unavailable storage leaves runtime controls usable and never reports saved. Source
loading provisions nothing. This source contract is not a release, real-profile
activation or human acceptance claim.

## Important boundaries

- Tool rendering does not execute or wrap tools. Edit diffs use captured historical
  native details. Write preview shows **submitted content only** and does not claim
  create versus overwrite; there is no before/after diff and the renderer does not
  preread files. PowerShell uses the public factory renderer. Codemode, subagents
  and MCP/custom tools stay on their native renderers. `/mh-ui live-tail` is
  runtime-only.
- Resource loading grants nothing. Missing permission/identity/provenance fails
  closed. Retained denies may prevent installation or use; a reviewed
  `--remove-default-deny` removes only scalar `permission["*"]: "deny"`, never
  grants blanket allow. See [installation policy](docs/bootstrap.md).
- Managed knowledge and historical quotes have different owners. Retrieval is
  bounded lexical matching, not embeddings or proof of semantic learning.
- Workflow records and worker counts are metadata, not execution proof or human
  acceptance. The live task board owns task outcomes. Creating a Goal or Run is
  explicit, never automatic.
- Native direct OpenAI quota is intentionally omitted: no borrowed credentials,
  speculative quota request or fallback usage link. Native session usage remains.
- Herdr Web observation is optional, session-only and privacy-gated; publication
  does not activate it or relax directory permissions. Unavailable observation is
  **UNKNOWN**, not zero children or completed work.

The UI work was explicitly human-closed on 21 October 2026. That does not establish
exhaustive rendered testing, acceptance of unrelated work, installed activation of
new memory retrieval, or activation of the optional Web observer. See the
[release notes](docs/releases/0.3.0.md) for delivered scope and remaining gates.

## Contribute and verify

```sh
pnpm check                 # Package + serial source tests + required public SDK fixtures
pnpm check:docs            # Local documentation links and feature coverage
pnpm check:format          # Repo-scoped formatting (not full typechecking)
```

[Development](docs/development.md) covers public dependency supply, continuity
formatting, host geometry, safe source archives and the release sequence.
[Integration reference](docs/integrations.md) retains dated deployment/provenance
records; it is not an installation checklist or permission to change a profile.
Third-party palette attribution is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
