# Mahiro Pi

Private `@mahirocoko/mahiro-pi` 0.2.0 for Pi >=1.3.0: native continuity,
scoped managed-memory authoring, focused system roles, native realign/run-clock utilities, completion voice, the
authored footer and foreground-gated Herdr metadata. Source installation never
activates managed memory automatically. Mahiro explicitly approved the reversible
managed-memory native-default cutover on 2026-10-19 and the separate Root guard cutover on 2026-10-20; current deployment and remaining provider/
human gates belong to `docs/integrations.md`, not source availability alone.

This repository owns **all Pi-specific implementation**, including native final-execution guards, ABI/provenance, bootstrap, authored public-owner patches, RTK resolver/control. No Mods checkout is a build, runtime, bootstrap or test prerequisite. The original Letta entries and historical adapter remain unchanged in their original repository. The **actual root manifest is guards-first12**, with bootstrap and one native guard before the preserved ten features. The separately approved 2026-10-20 private runtime explicitly loads Root public permission/subagents packages, one Root guard owner, bootstrap first and the additional worker resource; the legacy guard registration was removed. `test/candidate-extensions.json` mirrors that actual graph in disposable tests, not a second runtime owner. Source ownership alone never authorizes a runtime cutover; this private cutover had separate human approval. [`docs/integrations.md`](docs/integrations.md#current-disposition-of-the-15-letta-entries) is the complete 15-entry owner map; feature ordinals below refer to that preserved ten-feature sequence, not guard-inclusive manifest slots.
The existing local Pi session was switched and reloaded on 2026-10-17 with its
authored footer and native metrics unchanged. This is not whole-workflow or human
visual acceptance; see the integration document for remaining boundaries.

## Install once, use across canonical projects

```sh
pnpm install:profile
# Optional disposable/custom profile or non-mutating profile preview:
pnpm install:profile --agent-dir /absolute/canonical/profile --preview
```

This is explicit installation consent, not a startup hook. It composes Root's
pinned public permission/subagents owners, one guards-first resource graph, three
package-owned system roles, narrow tool/feature DATA grants and rewrite-rtk's
installed default. It never installs dependencies, copies auth, changes personal
roles/models, reloads a session or grants generic HOME/Bash access. Retained denies
stay effective. A retained universal `permission["*"]: "deny"` with missing selected
exact tool/DATA grants refuses before writes; already provisioned exact grants
preserve that default without consent (runtime policy still decides calls).
Reviewed explicit `--remove-default-deny` consent removes only that scalar key,
leaving the public default unset (`ask`), never blanket allow. Other required
tool/DATA restrictions refuse with named unprovisioned capabilities; the flag
cannot override them. See the [policy contract](docs/bootstrap.md#one-install-composition-historical-active10-hold-retired).
Existing RTK off and memory config/ledger/Core/data are preserved.
An absent memory root gets only a neutral scaffold through guarded native SDK/Faux
initialization (zero external inference); no private corpus is imported/reseeded.
Goal/Evidence/UX/Run derive separate project state without per-repo config. Empty
reads create no Goal/Run. Main shares relevant maintained knowledge across projects;
real workers remain leased/project-scoped. Safe standard 0755 host parents are
accepted; owned data remains 0700/0600. See [bootstrap](docs/bootstrap.md).
Source/native fixture proof is not actual profile activation or human acceptance.

## Explicit default skill activation

Source installation and profile activation are separate. From this checkout, with
Node >=22.19.0 and pnpm 10.33.0:

```sh
pnpm run setup --plan
pnpm run setup --apply
# Optional: select another existing or new profile explicitly:
pnpm run setup --plan --agent-dir /absolute/canonical/agent-directory
```

Use `pnpm run setup`: bare `pnpm setup` is pnpm's own shell-setup command,
not this package's activation script.

No flag defaults to preview, never apply. The directory defaults to native Pi's
`PI_CODING_AGENT_DIR` override (including `~/` expansion), otherwise
`~/.pi/agent`. Explicit paths must be absolute and canonical; symlinks are refused.
The command configures only `permission.skill` in
`extensions/pi-permission-system/config.json` beneath that directory. A missing
surface becomes scalar `allow`, covering all discovered and future installed
skills without per-name grants. Existing scalar `ask`/`deny` and existing `*`
rules stay unchanged. Ordered maps without `*` receive a leading wildcard allow;
existing pattern exceptions keep their order and restrictions are reported.
It does not claim unrestricted activation when restrictions remain.

Apply uses a reviewed hash, private backup for an existing file, and atomic
publication; reruns that need no change create no backup. The receipt contains
hashes and restriction counts, not policy contents. Unsupported config or unsafe
filesystem targets fail closed. No policy is written at extension startup, and
no install hook is added. This is **default skill activation configured**, not a
complete machine bootstrap: no skills, roles, guards, grants, memory, packages or
provider settings are installed/imported. Root-owned native guards enforce Pi execution through the sole public permission-policy owner;
`mahiro-skills` owns copying reusable skill bodies. Active sessions still need
Main's separately authorized reload. See the integration document for recovery
and the remaining private deployment/provenance boundaries.

## Explicit private local bootstrap

The earlier active10 bootstrap refusal was a historical compatibility hold. The actual guards-first graph now supports the explicit one-install command above. Advanced reviewed manifests remain available; no skill checkout is needed unless skill copying is selected. No real-profile activation is implied.

`pnpm run bootstrap --manifest /absolute/private/bootstrap.json --plan` previews
an explicit private local profile composition. Apply requires the exact reviewed
`--expect-plan <digest>`. This separate command registers the canonical local
packages, only the three package-owned roles, explicitly selected skills through
`mahiro-skills`, and optional skill policy / guarded new-memory initialization.
It preserves unrelated settings, personal roles, denies and existing `yoloMode`;
it does not choose a provider or copy authentication. Existing memory is validated
read-only and preserved, never reseeded or automatically enabled.

This is explicit local composition, not automatic activation: only this checkout and declared public dependencies are required for package bootstrap. The separate skill owner is required only for explicitly selected skill copying. It never installs
missing dependencies or runs at startup. Receipts describe sequential owner steps,
not cross-owner atomicity. Optional initialization enters the actual guarded native
tool pipeline using deterministic **Faux simulated transport**, with zero external
inference; it does not prove native default-model behavior or human acceptance.
See [the bootstrap contract](docs/bootstrap.md) for the strict manifest, prerequisites,
review/apply procedure, recovery and exact test boundaries. No real profile apply
or reload is implied by source/fixture tests.

## Native utility port (source only)

The first ALL-Mods slice adds `/realign [focus]` and host-local **run-start** clock
metadata through `extensions/mahiro-native-utilities.ts`, appended after the four
existing resources. Realign uses generated custom guidance, not a fake user entry;
clock metadata is separate from original user text and attachments. Neither grants
identity, permissions, memory edits or commits. Opt out with the native boolean
flags `--mahiro-user-timestamps-disable` / `--mahiro-realign-disable`; no Letta
sentinels or global configuration are consulted or created. See the current
[utility contract](docs/integrations.md#native-utility-port--source-only-first-all-mods-slice)
for conservative input/child skips, busy delivery, native differences and fixture
boundaries. No live reload/activation or full ALL-Mods/Goal/state completion is claimed.

## Code Map port (source only)

The sixth resource, `extensions/mahiro-code-map.ts`, adds the model-callable
`mh_code_map` after the accepted utility resource. `lib/code-map.ts` preserves
canonical Letta's closed schema, three intents, bounds and 3000-character
caller-input guidance formatter. It is **not** a search engine, indexer, scanner,
outline generator or Goal/Evidence integration. Opaque references and navigation
entries remain caller metadata, never proof or permission.

**Source-only permission-owner repair:** the Root-authored permission-system
40.2.2 patch exposes optional `matchedSurface` from the actual winning rule. The
restored Code Map assertion requires that exact surface to be `mh_code_map`, an
existing affirmative non-yolo tool-source grant, canonical provenance and healthy
native context. Both family wildcards fail, including a later wildcard overriding
an earlier exact allow. Old/unpatched services lack attestation and remain denied.
The installed scoped assets are preserved in this phase; an earlier offline installed-root repair is historical, not a new change here. Positive SDK/Faux
evidence uses isolated patched source mirrors, not a live installation. Separate
dependency installation, fresh load and named grant approval are still required.
Source approval does not apply grants or activate the resource. Use native
package resource exclusion to opt out, not a Letta sentinel. Import/registration
and the formatter perform no I/O; execution's intentional canonical guard check
reads package/provenance metadata and existing permission policy, not workspace
source. See [the integration contract](docs/integrations.md#code-map--source-only-second-all-mods-slice).

## Native Goal port (source only)

The seventh resource, `extensions/mahiro-goal.ts`, adds `mh_get_goal`,
`mh_create_goal`, `mh_update_goal`, `mh_clear_goal`, `/mh-goal` and a status alias.
It derives the canonical project binding under the explicitly installed private profile, without a project whitelist.
Private profile/project state persists across native sessions with CAS, explicit
moves and bounded history; there is no Letta-state import or automatic Goal.
Clear and all human-command mutations require public UI confirmation. Ordinary
model updates retain audited agent semantics, not universal human approval.

`pnpm goal:preview --project /canonical/project --agent-dir /private/profile`
prints proposed source configuration/capability names only. It does not apply,
grant, initialize, import or reload anything. The existing authored permission
owner patch must be separately installed/loaded before exact tool/root grants can
work; this phase preserves installed assets without negating the earlier offline installed-root repair. See [the Goal contract](docs/goal.md)
for schema adaptations, transaction/privacy boundaries, conservative fork limits,
commands and isolated tests. Source completion is not live or human acceptance.

## Native Code Evidence port (source only)

The eighth resource, `extensions/mahiro-code-evidence.ts`, adds opt-in
`mh_code_evidence` (`get`, `collect`, `record`) and `/mh-evidence`
(help/status/report/collect/confirmed clear). Four bounded Git lanes, native
profile/project/session scope, private whole-envelope CAS and conservative
freshness retain stale history. Recorded commands are descriptive and **never
executed**; `evidence_ready` means metadata ready for explicit selection, not
verified execution or Goal completion. Handoff is reference-only, without Goal
mutation, automatic collection, source indexing or reminders.

Canonical projects require no feature configuration; authorized empty reads return empty. The Root-owned native guard requires exact tool/root grants and fixed-argv Git authorization through
the existing guards and public permission owner. Any service lacking winning-surface attestation stays denied; offline positive
fixtures stage the existing authored patch. Earlier installed-root repair is
separate history, not a change by this documentation phase.
See [the Evidence contract](docs/evidence.md) for Git storage/config-execution,
private FD/CAS, native fork limits and verification boundaries. No live config,
install, grant, reload or human acceptance is implied.

## Native UX Workflow port (source only)

The ninth resource, `extensions/mahiro-ux-workflow.ts`, appends the three tools
`mh_get_ux_workflow`, `mh_create_ux_workflow`, `mh_update_ux_workflow` and `/mh-ux`
after the accepted eight in unchanged order. It coordinates bounded frame,
optional research, brief, concept, direction, handoff, implementation and review
metadata. Public-UI-confirmed human direction/review gates remain distinct from
ordinary agent updates and eligible completion. Opaque references never read
artifacts or mutate Goal/Evidence; no executor or design engine is added.

Canonical projects require no feature configuration. Exact actual-owner
tool/feature-data grants, current native primary context, private whole-envelope CAS and
stable-ID tickets are required; any service lacking winning-surface attestation stays denied.
No state import, automatic session attachment/move, force unlock, new installer,
profile apply or live reload exists. See [the UX contract](docs/ux-workflow.md) for
semantics, deliberate native adaptations, storage/UI limits and offline evidence.
Fresh independent QA and human acceptance remain separate from source checks.

## Native Execution Run port (source only)

The tenth resource, `extensions/mahiro-execution-run.ts`, appends one
`mh_execution_run` operation tool (`get/create/update`) and `/mh-run` after the
accepted nine in unchanged order. This optional bounded coordination record never
executes agents/CLI/Git/worktrees or reads project artifacts/other workflow state.
Reports, checks, paths, sessions and Goal/UX/Evidence refs are caller metadata,
not proof or acceptance; live TSK retains current task/outcome/evidence ownership.

Ordinary canonical binding requires no private project config. Explicit installation
composes actual-owner exact tool/feature-data grants once for the profile. Private CAS/tickets and public-UI-confirmed
nonterminal abandon/terminal clear freeze exact ID/revision/session assignment;
there is no wrong-ID fallback, move, force unlock or native worker discovery.
An old permission service without winning-surface attestation remains denied. See
[the Execution Run contract](docs/execution-run.md) for original FSM semantics,
native session-ref adaptation, persistence limits and offline evidence. No real
Run, profile apply, install/reload, independent QA or human acceptance is implied.

## RTK resolver and Saved Models retirement (source only)

Saved Model Profiles was **retired/removed by the current human decision on 20 October 2026**: no packaged Models command, tools, library, extension or guard/provenance ABI remains. Native `/model`, public registry/auth, defaults and personal roles are unchanged. Dated Letta oracles remain historical, not compatibility shims.

`/mh-rtk` and `mh_rtk` expose off/suggest/rewrite-safe/rewrite-rtk, status/log/rewrite preview/doctor/guidance/gain/projects. Explicit profile installation selects the absent-state rewrite-rtk default and preserves an existing explicit off. Without an installed default or explicit selection, mode stays off. Off remains an untouched execution fast path. Rewrite-rtk calls the installed resolver with Node `execFile("rtk", ["rewrite", "--", original])`, no shell, in `ctx.cwd`, with abort, 4096-byte input, 16384-byte output, 1500-ms and four-helper concurrency bounds. Exit 0/3 are candidates requiring host policy; 1 preserves original; 2 blocks. Error/timeout/unknown/oversize/malformed output falls back only to guarded original, never partial stdout/stderr. Quoted commands, pipelines and mixed chains are accepted as proposals without a local DSL; direct `git commit` bypasses the helper. Suggest executes original; rewrite-safe remains separate and conservative.

Original public Bash allowance and secret/attribution checks precede helper invocation. Proposed and final sanitizer-transformed arguments must pass policy/secret/attribution checks before actual native spawn, including RTK read/proxy and nested/hook-free execution. Mode writes require primary identity, exact named tool/data capability, fresh CAS sequence and actual public UI confirmation; no fake approval or helper auto-grant. Preview uses the same resolver without executing its candidate. Status/doctor/gain do not probe or read history; logs are bounded in-memory hashes, savings unverified. See [the integration contract](docs/integrations.md#rtk-resolver-and-saved-models-retirement--2026-10-20) for storage, helper outcomes and authority details. Source changes/tests do not activate the live cached service; Main owns separate setup/reload after independent QA.

## Development

Use Node >=22.19.0 and pnpm 10.33.0. With explicitly installed declared dependencies:

```sh
pnpm check
pnpm check:format
```

For offline source QA without changing canonical `node_modules`, explicitly supply reviewed **public package copies** via `MAHIRO_PI_TEST_MODULES=/absolute/public/node_modules pnpm check`. The test-only loader maps only canonical source imports; production has no supply harvesting or sibling fallback. `pnpm check` includes the required Root-owned SDK suite and Root-only CLI preview. Its isolated fixtures apply patches only to copied public owners; unpatched installed permission owners continue to deny unattested exact capabilities. Frozen dated Letta originals under `test/oracles/letta/` preserve behavior differentials without a checkout dependency. They are not runtime owners or instructions.

The host provides the optional Pi SDK and public TUI peer. Peers are not
implicitly installed by this repository. Tests use injected synthetic geometry;
for real host geometry, provide an existing host package manifest explicitly:

```sh
pnpm check:geometry -- /absolute/path/to/pi-coding-agent/package.json
```

This resolves the public TUI package from that host, imports geometry only and
makes no model/auth calls. It is not a browser, live rendering or visual-acceptance
check. No TypeScript compiler is installed; `check` is source/package validation
plus tests, not typechecking. Repository-local dev-only Biome 2.5.14 includes
voice source/tests, role tests, continuity and managed-memory roots, config
and manifest. Format scripts include managed-memory and the prior voice/role/
config/manifest subset plus RTK state/resolver, guard/SDK fixtures, bootstrap, native utility, Code Map, Goal, Evidence, UX Workflow and Execution Run source/tests/preview; check continuity explicitly with the installed Biome binary. Do not mass-format the legacy footer. Optional host peers remain
excluded by the repository configuration.

`node check-package.mjs --compare-source /absolute/path/to/old/pi` optionally
checks byte equivalence of the copied extension, libraries and original tests.
That comparison is a migration check, not a permanent sibling dependency.

`memory-reflector`, `managed-memory-writer` and the approved `git-commit` exception
are authored system/workflow roles; personal rosters stay in local Pi configuration. See `docs/agents.md` for
the package/local ownership split, reflector registration and evidence boundaries.
The paired `skills/git-commit/SKILL.md` loads through the native package skill
resource as `/skill:git-commit`; no bare slash-command alias is generated.
Execution-guard semantics for Pi are owned by `lib/guards/` here, not role prompts. The public permission system remains the only policy resolver; original Letta factories stay owned by their original host.

`docs/agent-memory.md` documents the private Markdown/Git layout, Main CAS tools,
leased native writers, semantic episode evidence, committed-revision context bridge,
conflict/forget recovery, explicit migration gates and proof boundaries.
See `docs/integrations.md` for setup, compatibility owners and safety boundaries.
No public registry release is configured or authorized.
