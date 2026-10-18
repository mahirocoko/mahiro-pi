# Native Pi agent ownership

## Package-owned roles

`agents/memory-reflector.md` is the continuity-owned role. The
continuity controller requires this exact role and checks its current descriptor
before dispatch. An absent or overridden capability fails closed; there is no
fallback to a personal general-purpose agent.

The native orchestrator discovers runtime definitions in `~/.pi/agent/agents/`.
Pi packages do not automatically install this resource type. Registration of the
package-owned reflector remains an explicit operator action: compare the existing
runtime file before updating and never overwrite user edits silently.

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

## Personal workflow

Other roles, their model/effort preferences and native built-in overrides belong
to the user's local configuration, not this repository. The existing local
definitions remain in `~/.pi/agent/agents/`; removing the former repository copies
does not remove or modify them. This package neither installs, synchronizes nor
requires a particular personal roster. Do not restore those source copies or
add tests that enforce their names, prompts, models or tool lists.

Execution-guard semantics remain owned by the canonical Mods adapter, not role
prompts. Writer/QA independence and human acceptance remain workflow boundaries,
not a requirement to package the user's specialists here.

## Evidence boundaries

The controlled native transaction on 2026-10-18 exercised the locked reflector
on OpenAI `gpt-6.1-sol` / medium with no retained imported-note marker in its
provider payload. This proves that narrow role path, not all personal models,
general memory-management parity or human acceptance.

The 2026-10-17 exploration/implementation and MCP checks exercised then-installed
personal roles. At that time twelve repository copies matched the runtime. That
is historical registration evidence, superseded as ownership guidance by the
local-only separation approved on 2026-10-18. Current package tests intentionally
cover only the reflector/commit pair and do not inspect or mutate the user's HOME.
