# Mahiro Pi

Private `@mahirocoko/mahiro-pi` 0.2.0 for Pi >=1.3.0: native continuity,
scoped managed-memory authoring, focused system roles, completion voice, the
authored footer and foreground-gated Herdr metadata. Source installation never
activates managed memory automatically. Mahiro explicitly approved the reversible
native-default cutover on 2026-10-19; current deployment and remaining provider/
human gates belong to `docs/integrations.md`, not source availability alone.

This repository owns the Pi package independently of the Letta mods repository.
The existing local Pi session was switched and reloaded on 2026-10-17 with its
authored footer and native metrics unchanged. This is not whole-workflow or human
visual acceptance; see the integration document for remaining boundaries.

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
provider settings are installed/imported. Canonical Mods enforces guards;
`mahiro-skills` owns copying reusable skill bodies. Active sessions still need
Main's separately authorized reload. See the integration document for recovery
and the remaining private deployment/provenance boundaries.

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
