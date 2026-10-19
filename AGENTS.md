# Mahiro Pi

## Source and boundaries

This private repository is the sole authoring owner of the Pi extension.
The local runtime reference was switched and reloaded on 2026-10-17 without
changing the authored footer, model or native usage. Historical rollback material
is ignored runtime evidence, not another authoring copy.

- Use pnpm 10.33.0 and Node >=22.19.0. No install is needed for source tests.
- Use public Pi APIs only: runtime extension SDK imports are type-only; public Pi
  TUI geometry is deferred until interactive startup. No host internals or sibling
  runtime imports in extensions. The explicit offline-bootstrap subprocess may
  runtime-import the installed SDK's declared public entry solely for guarded
  initialization; its deterministic Faux transport is not provider inference.
- Preserve authored colors, spacing, footer cells and native usage semantics.
- Native direct OpenAI quota stays omitted: no fallback link, auth lookup or
  speculative native quota request. Never borrow another host's credentials.
- Preserve foreground PID gating, non-TUI isolation, shared generation ownership,
  monotonic sequence, bounded producers and stale-callback protections.
- Herdr owns sidebar rendering/lifecycle; Halo and completion voice have separate
  owners. This extension publishes display metadata, not completion truth.
- Keep credentials, caches, installed copies and runtime evidence out of source.
  Project evidence belongs only under ignored `.agent-state/runtime/`.
- Run `pnpm check` after changes. Run the explicit host geometry smoke when geometry
  changes; synthetic tests are not rendered/human acceptance.
- System memory roles `memory-reflector` (C1 quotes) and `managed-memory-writer`
  (scoped maintained knowledge), plus the explicitly approved `git-commit` role,
  are authored in `agents/`;
  `docs/agents.md` owns registration and evidence boundaries. Personal workflow
  roles and model preferences stay local, not packaged or enforced by repo tests.
  Preserve the reflector's native OpenAI routing and explicit role lock.
  The paired native commit skill lives in `skills/git-commit/`; discussing or
  editing that skill/agent is not authorization to create a commit.
- Managed knowledge has one private Markdown/Git owner, distinct from C1 archives
  and the human-curated bootstrap. `docs/agent-memory.md` owns its contract. The
  separate exact-root canonical capability is mandatory; C1/read grants do not
  permit managed writes. Native workers use identity-bound private views and public
  per-run prompt replacement, never cwd overrides, shell tools or inherited corpus.
  Source registration alone must not migrate Core, install roles or enable policy.
- `lib/setup.ts` and `setup.mjs` own explicit default skill-policy preview/apply only.
  Separate `bootstrap.mjs` / `lib/bootstrap.ts` compose an explicitly reviewed
  private local profile manifest; `docs/bootstrap.md` owns its gates. Neither source
  installation nor startup provisions a profile, roles or grants. Bootstrap tests
  use disposable ignored profiles, never the real profile or existing private Core.
- Repository-local dev-only Biome 2.5.14 includes voice source/tests, role tests,
  continuity, managed-memory and bootstrap source/tests/extensions, config and manifest: two
  spaces, double quotes and semicolons. Explicit format scripts include the new
  managed roots and prior voice/role/config/manifest set; check continuity separately.
  Do not mass-reformat the six legacy files. Checks are not full typechecking.
- No commits, publication, pushes, runtime/profile/auth changes or live probes
  without explicit authorization.
