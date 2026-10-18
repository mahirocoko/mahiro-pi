# Mahiro Pi

## Source and boundaries

This private repository is the sole authoring owner of the Pi extension.
The local runtime reference was switched and reloaded on 2026-10-17 without
changing the authored footer, model or native usage. Historical rollback material
is ignored runtime evidence, not another authoring copy.

- Use pnpm 10.33.0 and Node >=22.19.0. No install is needed for source tests.
- Use public Pi APIs only: SDK imports are type-only; public Pi TUI geometry is
  deferred until interactive startup. No host internals or sibling runtime imports.
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
- Native role definitions live in `agents/`; `docs/agents.md` owns registration
  and evidence boundaries. Preserve native OpenAI routing and explicit role locks.
- Repository-local dev-only Biome 2.5.14 includes voice source/tests, the role test,
  `lib/continuity/**`, `test/continuity*.ts`, the continuity extension, its config
  and package manifest: two spaces, double quotes and semicolons. The explicit
  `pnpm check:format` / `pnpm format` scripts still cover only voice/role/config/
  manifest; check continuity separately with the installed Biome binary. Do not
  mass-reformat the six legacy files. Package checks are not full typechecking.
- No commits, publication, pushes, runtime/profile/auth changes or live probes
  without explicit authorization.
