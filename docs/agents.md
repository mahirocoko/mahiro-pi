# Native Pi agents

`agents/*.md` is the authoring owner for Pi-specific role definitions. The selected
orchestrator discovers runtime copies in `~/.pi/agent/agents/`; Pi packages do not
automatically install this resource type. Compare existing copies before updating;
never overwrite user edits silently.

The role names and model/effort pairs preserve the established Letta roster.
Models use native `openai` with the existing Pi authentication profile, not a new
API key, another provider, or a fallback. Model and thinking fields are locked
against model-facing overrides; an explicit human routing change must update the
owned definition. Catalog availability is not proof of every model's live access.

`Explore` and `Plan` retain the upstream built-in names intentionally. Their owned
overrides prevent the default Explore route from silently choosing Anthropic.
Prefer the named specialist for new work; `general-purpose` remains a fallback.

Guard semantics belong to the canonical Mods factories and their separate Pi
adapter. These Markdown files define role behavior and tool loadouts, not an OS
sandbox or a substitute for execution guards. Writer self-tests are not independent
acceptance; Main assigns verification, and Mahiro owns product/visual acceptance.

The 2026-10-17 native proof exercised one locked read-only role on actual OpenAI
`gpt-6.1-sol` / medium, plus HiroHiro schema and Chrome list-pages through native
MCP. It did not exercise all roster models or establish whole-migration acceptance.
After registration/reload, the existing Pi TUI also ran the installed `implementer`
role successfully on the same model/effort, with one read of the approved source
README. All twelve runtime role copies matched their owned sources.
