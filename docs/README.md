# Feature guide

[← Mahiro Pi](../README.md)

Start with [installation and upgrades](getting-started.md). Each feature below has
one guide; deeper contracts stay with their owning implementation, not this index.

## Presentation

- [UI and theme](claude-ui.md) — Neko-Stack header, individual tool rows,
  split/word edit diffs, submitted-content write previews and runtime-only settings.
- [Status and usage](status.md) — authored footer, one streaming activity line,
  Git, native usage and Herdr display metadata; native direct OpenAI quota is
  deliberately absent.
- [Completion voice](finish-voice.md) — macOS-only successful-settlement notification.

## Knowledge and execution safety

- [Managed memory](agent-memory.md) — maintained Markdown/Git knowledge, discovery,
  lexical queries, private drafts/CAS and scoped writers.
- [Continuity](continuity.md) — historical recall, literal quotation notes,
  correction/forget controls and the distinction from maintained knowledge.
- [Guards and permissions](guards.md) — single Root guard, public policy owner,
  exact grants, secret/attribution checks and native execution.
- [RTK](rtk.md) — visible mode, bounded resolver, guarded proposals and explicit control.
- [Agents and skills](agents.md) — three owned roles, local personal roles and
  the native [commit skill](../skills/git-commit/SKILL.md).

## Workflow tools

| Guide | Main entry point | Not its responsibility |
| --- | --- | --- |
| [Utilities](utilities.md) | `/realign`, run-start metadata | Human identity, permission or automatic state changes |
| [Code Map](code-map.md) | `mh_code_map` | Executing searches or indexing source |
| [Goals](goal.md) | `/mh-goal`, four Goal tools | Automatic missions or claiming human criteria |
| [Code Evidence](evidence.md) | `/mh-evidence`, `mh_code_evidence` | Executing recorded commands or verifying their claims |
| [UX workflow](ux-workflow.md) | `/mh-ux`, three UX tools | Design execution or approving human gates |
| [Execution runs](execution-run.md) | `/mh-run`, `mh_execution_run` | Launching workers, CLI, Git or worktrees |

The live task board owns tasks and acceptance. These optional metadata features
do not replace it or create one another.

## Integrations and operations

- [Worker activity](worker-activity.md) — optional Herdr counts from the native
  parent-scoped service, not a second child lifecycle.
- [Herdr Web observer](herdr-web-activity.md) — explicit session opt-in,
  private v1 receipts, bounded metadata and UNKNOWN when unavailable.
- [Installation contract](bootstrap.md) — advanced reviewed composition,
  default-deny consent, exact DATA grants and preservation/recovery.
- [Development and release](development.md) — checks, artifact safety and
  ordinary GitHub source publication.
- [v0.3.0 release notes](releases/0.3.0.md) — delivered changes and evidence limits.
- [Integration reference](integrations.md) — dated deployment, provenance and
  upstream ownership records; historical slices are not current activation steps.
