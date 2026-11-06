# Agents and skills

[← Documentation](README.md) · [Memory](agent-memory.md) · [Installation](bootstrap.md)

The package owns three role descriptors, a commit skill, and six built-in memory
and skill-authoring skills ([`maintaining-core-memory`](../skills/maintaining-core-memory/SKILL.md),
[`maintaining-deferred-memory`](../skills/maintaining-deferred-memory/SKILL.md),
[`initializing-memory`](../skills/initializing-memory/SKILL.md),
[`context-doctor`](../skills/context-doctor/SKILL.md),
[`syncing-memory-filesystem`](../skills/syncing-memory-filesystem/SKILL.md), and
[`creating-skills`](../skills/creating-skills/SKILL.md)).
Other workflow roles and their model preferences belong to the user's local
configuration. Pi package resource loading does not automatically install agent roles.

## Package roles

| Role | Route and limits | Responsibility |
| --- | --- | --- |
| [memory-reflector](../agents/memory-reflector.md) | OpenAI gpt-6.1-sol / medium; locked; no tools; background; no inherited context; replace prompt; two turns | Literal low-authority quotes only |
| [managed-memory-writer](../agents/managed-memory-writer.md) | Current primary model / medium (off for non-reasoning models); explicit fixed model/thinking slots selectable; locked; read/edit/commit only; background; replace prompt; eight turns | Scoped maintained knowledge in the same private store |
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
optional `model` and required `thinking` slots may vary; lock, tools, prompt,
isolation and all other bytes must match the package template. New descriptors
omit `model`, following the current primary agent model on each dispatch, including
normal model changes. Thinking stays at the descriptor's level (default `medium`)
for reasoning models and becomes `off` for inherited non-reasoning models; it does
not follow the primary thinking setting. Ordinary upgrades preserve existing
canonical routes, including previously installed fixed models. To opt into following
the primary model, explicitly review `--managed-writer-model inherit` together with
`--managed-writer-thinking medium`. No installed profile is changed by source updates.
Review both flags together on preview and apply for a fixed route:

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
similar models and implicit fallback from a fixed route are rejected. Inherited
routes require a current primary model and pass the same physical availability
checks; unsupported reasoning levels still refuse rather than selecting a different
model. The final native spawn pins resolved model/thinking options and rechecks
the loaded canonical role. Already queued or running writers keep that dispatch's
route when the primary model changes. After descriptor route changes, start a fresh
session; ordinary primary model changes need no writer descriptor edit or reload. Local **Ready** is not a provider
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

## Memory guidance and selective skill admission

The repository ships the `git-commit` skill plus six built-in memory and
skill-authoring skills (`maintaining-core-memory`, `maintaining-deferred-memory`,
`initializing-memory`, `context-doctor`, `syncing-memory-filesystem`, and
`creating-skills`) admitted under
`G-SKILL` to guide in-place core curation (`system/human/identity.md`,
`system/human/prefs/*.md`, `projects/<id>/system/*.md`), indexed deferred
reference storage (`reference/**`, `projects/<id>/reference/**`), memory
initialization (`/mh-memory init`), context auditing (`/mh-memory doctor`),
CAS/draft conflict repair, and reusable skill authoring (`~/.pi/agent/skills` or
`.pi/skills`). User-local skills
do not establish what this package ships.

Do not bulk-import every Letta skill or over-customize useful upstream guidance
until it becomes weaker. Prefer close adoption or minimal adaptation when a
recurring job is genuinely underserved; existing role/runtime/docs ownership and
zero new skills are valid outcomes. Preserve reasons, contradictions, examples,
synthesis-not-logs and future-request discoverability rather than counting files.

The [roadmap admission rule](letta-parity-roadmap.md#g-skill-admission-gate) requires
explicit Mahiro direction for a distinct reusable workflow that existing owners
cannot cover. Matching upstream behavior alone does not justify another skill or
proof matrix. The R2 source decision on 2026-10-30 admitted **zero new package
skills**. Its six job dispositions below record the existing delivery owners,
not a new admission checklist:

| Job / representative request | Disposition and delivery boundary |
| --- | --- |
| Compact core / "remember this correction" | Existing writer, shared package doctrine, and [`maintaining-core-memory`](../skills/maintaining-core-memory/SKILL.md): synthesize reasons, resolve contradictions, shrink before growth and replace examples, not logs. |
| Deferred detail / "find our rollback constraints" | Existing writer, root-bound reads, index owners, and [`maintaining-deferred-memory`](../skills/maintaining-deferred-memory/SKILL.md): one home, request-shaped cues and future-request discovery checks; an uncued file is discoverability debt, not proof of absent storage. |
| Initialization / "set up memory" | Existing installer/manage/docs owners and [`initializing-memory`](../skills/initializing-memory/SKILL.md): explicit initialization only for absent roots; no overwrite or personal corpus import. |
| Sync/repair / "why is publication pending?" | Existing runtime/manage/recovery/docs owners and [`syncing-memory-filesystem`](../skills/syncing-memory-filesystem/SKILL.md): distinguish drafts, committed and published state; hosted/shared sync is excluded. A diagnosis is not repair authorization. |
| Context diagnosis / "why was this memory not used?" | Existing source/runtime diagnostics, [`context-doctor`](../skills/context-doctor/SKILL.md), and the [bounded procedure](agent-memory.md#curation-guidance-and-bounded-context-diagnosis): separate structural from causal evidence, require successful controls, and allow healthy, inconclusive and no-edit outcomes. |
| Reusable procedures / "make this a skill" | Separate native procedure/skill owner and [`creating-skills`](../skills/creating-skills/SKILL.md); a separately authorized proposal, not writer authoring/install authority. |

The delivery gaps remain explicit: source guidance cannot prove installed
triggers, historical projection, causal behavior or future-request utility.
External `skill-doctor` references do not register a missing tool or delegate its
transcript-review job to memory writers. Cloud/shared guidance is excluded unless
separately requested. No skill-mutation authority is inherited.

The historical R2 guidance update left `agents/managed-memory-writer.md` unchanged.
The current source default omits its model slot; installer validation still requires
descriptor byte-match except the explicitly paired model/thinking route slots.
R2 did not change installed role bytes, package discovery, installer/profile state
or selected routes. See the
[roadmap direction](letta-parity-roadmap.md#candidate-dispositions) for current
follow/adapt/exclude choices. Historical R2 evidence labels do not impose new
verification phases.

## Commit skill

The [native commit skill](../skills/git-commit/SKILL.md) dispatches the approved
role for an exact path/diff scope. Loading, discussing or editing the skill is
**not authorization to commit**. Commits require an explicit request and scope;
push, amend, release and destructive Git need their own approval.

Execution policy belongs to Root/public PSS, not role prompts. Primary workflow
or RTK control never transfers a grant to a child. See [permissions](guards.md)
and [workflow session boundaries](workflows.md#shared-authority-and-storage).
