# Mahiro Pi

Private `@mahirocoko/mahiro-pi` 0.2.0 for Pi >=1.3.0: native continuity,
scoped managed-memory authoring, focused system roles, completion voice, the
authored footer and foreground-gated Herdr metadata. Managed-memory activation is
explicit and default-off; source availability is not deployed/provider proof.

This repository owns the Pi package independently of the Letta mods repository.
The existing local Pi session was switched and reloaded on 2026-10-17 with its
authored footer and native metrics unchanged. This is not whole-workflow or human
visual acceptance; see the integration document for remaining boundaries.

## Development

Use Node >=22.19.0 and pnpm 10.33.0. No dependency installation is required:

```sh
pnpm check
```

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
config/manifest subset; check continuity explicitly with the installed Biome binary. Do not mass-format the legacy footer. Optional host peers remain
excluded by the repository configuration.

`node check-package.mjs --compare-source /absolute/path/to/old/pi` optionally
checks byte equivalence of the copied extension, libraries and original tests.
That comparison is a migration check, not a permanent sibling dependency.

`memory-reflector`, `managed-memory-writer` and the approved `git-commit` exception
are authored system/workflow roles; personal rosters stay in local Pi configuration. See `docs/agents.md` for
the package/local ownership split, reflector registration and evidence boundaries.
The paired `skills/git-commit/SKILL.md` loads through the native package skill
resource as `/skill:git-commit`; no bare slash-command alias is generated.
Execution-guard semantics remain owned by the separate canonical Mods adapter,
not duplicated in this package or in the role prompts.

`docs/agent-memory.md` documents the private Markdown/Git layout, Main CAS tools,
leased native writers, semantic episode evidence, committed-revision context bridge,
conflict/forget recovery, explicit migration gates and proof boundaries.
See `docs/integrations.md` for setup, compatibility owners and safety boundaries.
No public registry release is configured or authorized.
