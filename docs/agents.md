# Agents and skills

[← Documentation](README.md) · [Memory](agent-memory.md) · [Installation](bootstrap.md)

The package owns three role descriptors and a commit skill. Other workflow
roles and their model preferences belong to the user's local configuration.
Pi package resource loading does not automatically install agent roles.

## Package roles

| Role | Route and limits | Responsibility |
| --- | --- | --- |
| [memory-reflector](../agents/memory-reflector.md) | OpenAI gpt-6.1-sol / medium; locked; no tools; background; no inherited context; replace prompt; two turns | Literal low-authority quotes only |
| [managed-memory-writer](../agents/managed-memory-writer.md) | Default OpenAI gpt-6.1-sol / medium; explicit model/thinking slots selectable; locked; read/edit/commit only; background; replace prompt; eight turns | Scoped maintained knowledge in the same private store |
| [git-commit](../agents/git-commit.md) | OpenAI gpt-6-luna / low; model/thinking locked; Bash only | One explicitly authorized scoped commit |

These are authored role contracts, not authority to borrow credentials or fall
back to another provider. Reflector and git-commit source routes remain unchanged.
They use your configured Pi authentication profile; each role's route availability
is a separate prerequisite when you use it. Unrelated local roles are preserved.

`install:profile` or reviewed bootstrap explicitly registers the three bodies
beneath `<profile>/agents/`. Missing files are created; identical files are no-op.
Differences block except the managed writer's explicitly supported route slots.

## Managed writer route

The installed canonical `managed-memory-writer.md` is the route owner. Only its
`model` and `thinking` slots may vary; lock, tools, prompt, isolation and all other
bytes must match the package template. Ordinary upgrades preserve that selected
canonical route. Review both flags together on preview and apply:

```sh
pnpm install:profile --managed-writer-model exact-provider/model-id --managed-writer-thinking medium --preview
pnpm install:profile --managed-writer-model exact-provider/model-id --managed-writer-thinking medium
```

Replace the placeholder with your actual exact provider/model ID and a supported
thinking level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Not every
model supports every level. Choose deliberately for provider authorization,
cost and privacy; use your own Pi provider setup. This does not change your primary
model or the other package roles, and copies no credentials.

Readiness and final spawn preflight require the exact physical registry entry,
matching public availability and supported thinking. Virtual aliases, fuzzy or
similar models and parent-model fallback are rejected. The final native spawn
pins explicit model/thinking options and rechecks the loaded canonical role.
After route changes, start a fresh session. Local **Ready** is not a provider
request, successful execution or semantic learning.

## Memory isolation

The continuity controller checks its exact reflector descriptor before dispatch.
An absent or overridden capability fails closed, not over to a general agent.

The managed writer uses an identity-bound leased private view. The extension's
public `before_agent_start` replacement supplies the entire bound worker prompt;
a known unbound writer receives a stop prompt instead of private inherited context.
Caller flags cannot select a lease or become a worker. The public native service
owns lifecycle; the healthy parent integrates only successful ready proposals.

Prompt replacement is an isolation mechanism, not proof of semantic correctness.
Reflection and foreground memory assignments share the same writer and store.
Historical quotation and maintained-knowledge authority remain separate.

## Commit skill

The [native commit skill](../skills/git-commit/SKILL.md) dispatches the approved
role for an exact path/diff scope. Loading, discussing or editing the skill is
**not authorization to commit**. Commits require an explicit request and scope;
push, amend, release and destructive Git need their own approval.

Execution policy belongs to Root/public PSS, not role prompts. Primary workflow
or RTK control never transfers a grant to a child. See [permissions](guards.md)
and [workflow session boundaries](workflows.md#shared-authority-and-storage).
