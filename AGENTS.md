# Mahiro Pi

## Source and boundaries

This repository is the sole authoring owner of the Pi extension. GitHub source
is public; the package remains private/UNLICENSED and runtime/profile data is private.
`docs/README.md` owns feature navigation; `docs/development.md` owns the GitHub
source-release process. `.gitattributes` excludes agent state from source archives.
The local runtime reference was switched and reloaded on 2026-10-17 without
changing the authored footer, model or native usage. Historical rollback material
is ignored runtime evidence, not another authoring copy.

- Use pnpm 10.33.0 and Node >=22.19.0. All Pi implementation, guard ABI, patches and dependency contracts are authored here; no Mods checkout is a prerequisite. Required offline SDK checks use declared public packages, installed explicitly or supplied as reviewed public copies via MAHIRO_PI_TEST_MODULES. Tests never harvest sibling runtime state.
- Use public Pi APIs only: static extension SDK imports are type-only; native guards defer loading public native-tool factories. Public Pi TUI geometry is deferred until interactive startup. No host internals or sibling runtime imports in extensions. The explicit offline-bootstrap subprocess may
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
- Actual `package.json` is guards-first13: bootstrap then one Root native guard, followed by the preserved ten features and the rendering-only Claude UI adapter. The optional theme resource never activates itself; `docs/claude-ui.md` owns the palette/header and conditional own-UI persistence contract. `/mh-ui` Apply/theme commands remain runtime-only; explicit Save uses only the Root-owned fixed `preferences/own-ui` DATA owner when authorized. Loading grants nothing, and unavailable/denied/corrupt storage is never reported saved. Disposable candidate declarations mirror this graph, never another live authoring owner. `install.mjs` composes required public packages/owned roles/narrow feature DATA grants once by explicit consent. Source loading/startup grants nothing. `install:profile --remove-default-deny` (typed bootstrap `components.removeDefaultDeny: true` with `featureData`) is explicit consent to delete only scalar top-level `permission["*"]: "deny"`, never set blanket allow; unset fallback belongs to public PSS (`ask`, with existing yolo unchanged). Without consent retained broad deny with missing selected exact grants refuses before writes; already explicitly provisioned profiles retain their default deny. Other wildcard restrictions conservatively block missing-grant insertion; specific required tool/DATA restrictions refuse truthfully rather than silently omitting grants. Receipts report retained restriction surfaces; runtime public policy remains authoritative. Specific restrictions and explicit offs stay intact. The separately approved prior private runtime remains historical activation evidence; no new real-profile apply/reload is implied.
- `lib/guards/` owns Pi-only final-execution enforcement and pure secret/commit guard ports; original Letta entries remain unchanged. The public permission service is the sole policy resolver. The mandatory custom secret-read checker is retired from that execution map; the secret port still supplies the four filtered helpers, and opt-in BASIC read defaults stay an explicit install choice. Final execution asks the public service again after a path or Bash mutation: a matched path deny blocks; a matched path ask passes only by consuming a same-turn public allow decision for that exact surface/path, so rewritten paths are refused. Saved Model Profiles is retired by the 2026-10-20 human decision; native `/model`, registry/auth, defaults and personal roles remain untouched. RTK-only private storage preserves exact authority/CAS/0700/0600 checks. Explicit profile installation defaults RTK to rewrite-rtk without overwriting an existing off state; uninstalled scopes remain off. Primary-only control is separate from native child execution under each child's own policy. Rewrite-rtk calls the bounded installed resolver with argv, never shell/helper auto-grants, and must authorize original, candidate and sanitizer-transformed final arguments before native spawn. Direct git commit bypasses the helper.
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
  Authenticated primary views share relevant deferred knowledge across canonical projects; workers and retained v1 views remain scoped. New unmapped projects derive collision-checked path identities without rewriting the map. Source registration alone must not migrate Core, install roles or enable policy. Explicit installation may initialize only an absent root with a neutral scaffold via the guarded native pipeline; existing config/ledger/Core/data are preserved.
- `lib/setup.ts` and `setup.mjs` own explicit default skill-policy preview/apply only.
  Separate `bootstrap.mjs` / `lib/bootstrap.ts` compose an explicitly reviewed
  private local profile manifest; `install.mjs` selects the coherent one-install composition and optional preview. `docs/bootstrap.md` owns the gates. Resource loading/startup never provisions a profile, roles or grants. Bootstrap tests
  use disposable ignored profiles, never the real profile or existing private Core.
- Repository-local dev-only Biome 2.5.14 includes voice source/tests, role tests,
  continuity, managed-memory and bootstrap source/tests/extensions, config and manifest: two
  spaces, double quotes and semicolons. Explicit format scripts include the new
  managed roots, guards/SDK fixtures, RTK state/resolver and prior voice/role/config/manifest set; check continuity separately.
  Do not mass-reformat the six legacy files. Checks are not full typechecking.
- No commits, publication, pushes, runtime/profile/auth changes or live probes
  without explicit authorization.
