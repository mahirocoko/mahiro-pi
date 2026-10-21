# Native Pi agent ownership

[← Feature guide](README.md) · [Installation](getting-started.md)

The package owns three roles and the native commit skill; personal workflow
rosters/models remain local. Source loading alone does not install role bodies.

## Package-owned roles

`agents/memory-reflector.md` is the continuity-owned role. The
continuity controller requires this exact role and checks its current descriptor
before dispatch. An absent or overridden capability fails closed; there is no
fallback to a personal general-purpose agent.

The native orchestrator discovers runtime definitions in `~/.pi/agent/agents/`.
Pi packages do not automatically install this resource type. Registration of the
package-owned reflector remains an explicit operator action: compare the existing
runtime file before updating and never overwrite user edits silently. The separate
reviewed private [`bootstrap`](bootstrap.md) command can create only this role,
managed-memory-writer and git-commit; identical files are no-op and differing files
block. It does not package or synchronize the personal roster.

The reflector uses native OpenAI `gpt-6.1-sol` / medium, `locked: true`,
`tools: none`, `run_in_background: true`, `inherit_context: false`,
`prompt_mode: replace` and a two-turn cap. It selects literal low-authority quotes;
it does not infer human identity, rewrite Core or define personal workflow.
Its configured route uses the existing Pi authentication profile, not a new API
key or provider fallback.

`agents/git-commit.md` is the explicit workflow exception approved on 2026-10-18.
It pairs with `skills/git-commit/SKILL.md`, uses native OpenAI `gpt-6-luna` / low,
locks model/thinking and exposes only Bash for Git commands. It requires an
explicit commit request and approved scope; packaging it does not authorize a
commit. The skill uses native Pi subagent dispatch, not a Letta tool interface.
Package `pi.skills` loads the skill; it does not register the role automatically.

## Managed knowledge writer

The canonical role was explicitly registered in this machine's native role
directory during the approved 2026-10-19 cutover. Its 2,370-byte body matches the
packaged source; all thirteen pre-existing role files remain byte-identical.
This per-machine registration is not an automatic package-install behavior.

`agents/managed-memory-writer.md` is an additional system memory role authorized
by the full managed-memory run. It is not a restored personal specialist. It uses
native OpenAI `gpt-6.1-sol` / medium, `locked: true`, `prompt_mode: replace`,
`inherit_context: false`, background scheduling and an eight-turn ceiling. Its
only tools are `agent_memory_read`, `agent_memory_edit`, `agent_memory_commit`.
Main checks the immutable descriptor before dispatch, claims the initial outcome
and never bypasses the queue. Canonical authority binds the native service's
outputFile to the child's captured SessionManager and a private leased view.
Caller arguments cannot select a lease or become a worker.

The pinned native host retains a portable parent preamble even under replace
mode. The managed extension therefore uses public `before_agent_start` to replace
the **entire** bound worker prompt with this authored role body. A known unbound
writer gets a minimal stop prompt, not inherited private context. Native SDK
fixtures verify parent-context/cross-project markers are absent; this is not
real-provider proof. The role maintains synthesized knowledge and corrections,
not exact quotes. Successful completion integrates nonconflicting changes into
the same store Main edits; conflicts remain private proposals. Automatic
reflection and foreground assignments share this role and authoring owner.

Register it explicitly only after reviewing the runtime role; packages do not
auto-register agents. The original source/fixture run did not touch the roster;
the later approved cutover added only this managed role.
The old no-tool reflector remains a separate C1 evidence capability, unchanged.

## Personal workflow

Other roles, their model/effort preferences and native built-in overrides belong
to the user's local configuration, not this repository. The existing local
definitions remain in `~/.pi/agent/agents/`; removing the former repository copies
does not remove or modify them. This package neither installs, synchronizes nor
requires a particular personal roster. Do not restore those source copies or
add tests that enforce their names, prompts, models or tool lists.

Execution-guard semantics are authored in Root `lib/guards/`, not role prompts.
The public permission service alone resolves policy and public subagents alone
run children. The separately approved 2026-10-20 private runtime now registers one
Root guard owner and Root public packages, with the legacy guard removed. Source
ownership alone never authorizes this cutover. Writer/QA independence and human
acceptance remain workflow boundaries,
not a requirement to package the user's specialists here.

## Goal primary-session boundary

The canonical native Goal feature adds no role, worker, provider or model route. One explicit `install:profile` command composes only the three package-owned system roles; it never rewrites personal roles. Normal children may use installed RTK execution policy under their own public Bash decisions; mode mutation remains primary-only.
Root `lib/guards/index.ts` checks actual primary SessionManager/header and native-child
ownership. Known children receive neither primary Goal tools' authority nor its
reminder. Public parentSession also conservatively rejects human forks; absence
of an observable parent is not authenticated human identity. All command-side
human mutations require public UI confirmation, not a command string or an
`actor: human` tool argument. Ordinary agent updates keep their separate audited
semantics. [`goal.md`](goal.md) owns the exact capability/state/confirmation
contract. Source registration does not install roles, grants or Goal state.

## Evidence boundaries

The controlled native transaction on 2026-10-18 exercised the locked reflector
on OpenAI `gpt-6.1-sol` / medium with no retained imported-note marker in its
provider payload. This proves that narrow role path, not all personal models,
general memory-management parity or human acceptance.

The 2026-10-17 exploration/implementation and MCP checks exercised then-installed
personal roles. At that time twelve repository copies matched the runtime. That
is historical registration evidence, superseded as ownership guidance by the
local-only separation approved on 2026-10-18. Current package tests intentionally
cover the two system memory roles and commit exception, without inspecting or
mutating the user's personal roster. Managed-memory native fixtures use a
project-owned agent directory and injected transport; they do not mutate HOME.
