# Mahiro Pi — contributor contract

## Owners and scope

This repository is the sole authoring owner of the extension, guards, patches
and dependency contracts. Public source is not private runtime/profile state.
`docs/README.md` owns navigation; each linked guide owns its user-facing contract.
`docs/development.md` owns checks and GitHub source releases. Release notes are
dated source records, not current installation instructions.

- Use Node ≥22.19.0 and pnpm 10.33.0. Use declared public dependencies or an
  explicitly reviewed public supply via `MAHIRO_PI_TEST_MODULES`; never harvest
  sibling runtime state. No other checkout is a prerequisite.
- Use public Pi APIs only. Static extension SDK imports are type-only; native
  factories and public TUI geometry load lazily. The explicit offline-bootstrap
  subprocess may runtime-import declared public SDK entries for guarded
  initialization with deterministic Faux transport, not provider inference.
- Keep credentials, profiles, caches, installed copies and runtime evidence out
  of source. Local evidence belongs under ignored `.agent-state/runtime/`.
  `.gitattributes` excludes agent state from source archives.
- Do not commit, push, publish, change profiles/auth/models/permissions, reload
  sessions or run live probes without explicit authorization.

## Protected contracts

- Preserve the manifest's 13-entry order: the existing bootstrap (TypeScript,
  for Pi's public loader), one Root guard, ten features, then the rendering-only
  UI adapter. Bootstrap activates `lib/kernel/` independently before optional
  Root enforcement. The optional theme never
  activates itself. See `docs/claude-ui.md` for runtime Apply versus explicit
  authorized Save to the fixed `preferences/own-ui` owner.
- Preserve authored colors, spacing, footer cells and native usage semantics.
  Native direct OpenAI quota stays omitted: no fallback link, credential lookup
  or speculative native quota request.
- Preserve foreground PID gating, non-TUI isolation, shared generation ownership,
  monotonic sequence, bounded producers and stale-callback protection.
  Herdr owns its renderer/lifecycle; display metadata is not completion truth.
- `lib/kernel/` alone owns the shared feature registry/ABIs, actual manager and
  primary/child identity, generation readiness and memory retirement/drain. Root
  consumes it, never initializes or removes its nodes. Kernel readiness is not
  guard-host health or provenance; feature policy checks belong to their real
  ABI boundaries. Keep one native-MJS shared registry across Jiti/native loaders,
  generation-conditional cleanup and exact private-memory authority. Startup
  provisions nothing. Missing kernel readiness is a diagnostic, never a global
  tool-call gate. Goal, Evidence, UX, Execution Run, Code Map and RTK use ordinary
  public PSS permissions, including wildcard/yolo, not exact DATA attestation.
  Preserve primary-session, revision, root binding and owner-lock invariants.
- `lib/guards/` owns thin final native execution enforcement: lightweight secret
  file-operand rules, four standalone filtered inspectors, commit-attribution
  stripping and RTK final-argument authorization. It has no tool dispatch
  allowlist, package realpath/version permission pins or throwing PowerShell
  wrapper. Ordinary native execution does not require feature-kernel readiness.
  Public PSS alone resolves policy. File rules apply to recognized file operands, not arbitrary
  prompt/query/comment/content text. PSS's first recognized Bash operand gate
  and Root's final command-policy recheck are distinct, not a universal sandbox.
  Preserve effective Bash approval binding/revocation and exact-command rewrite
  rules in `docs/guards.md`; never replace them with unit decision/path caches.
- RTK authorizes original, candidate and sanitizer-transformed final arguments
  before spawn. Direct git commit bypasses the helper, not the commit guard.
  Explicit installation defaults absent state to rewrite-rtk, preserves explicit
  off, and never grants shell/helper authority.
- Source loading/startup provisions nothing. Explicit installation alone composes
  public owners, three package roles and narrow DATA grants. Default-deny removal
  requires explicit consent and removes only scalar `permission["*"]: "deny"`,
  never sets blanket allow. Preserve targeted restrictions and refuse missing
  required grants truthfully. See `docs/bootstrap.md`.
- Maintained knowledge has one private Markdown/Git owner, separate from historical
  recall. Exact-root authority is mandatory. Native writers use identity-bound
  private views and public prompt replacement, not cwd overrides, shell tools or
  inherited private corpus. Preserve existing memory; initialize only absent roots.
- `agents/` owns memory-reflector, managed-memory-writer and git-commit.
  Preserve their authored route/lock/tool contracts; only the canonical installed
  managed-memory-writer model/thinking slots may vary through explicit paired
  installer route selection. Preserve that selected route on ordinary upgrades;
  other descriptor differences block. Reflector/git-commit defaults and other
  local roles remain unchanged.
  Loading or discussing the paired commit skill never authorizes a commit.
- Workflow state is revision-guarded metadata, not worker execution or human
  acceptance. Preserve primary-session checks, read-before-write, explicit
  creation and public UI human gates.

## Verification and style

Run `pnpm check` after changes when the authorized test window is available;
run the explicit public-host geometry smoke for geometry changes. Serialize heavy
checks. Synthetic/source checks are not rendered, installed or human acceptance.
Use a fresh verifier for independent QA.

Follow repository-local Biome: two spaces, single JavaScript/TypeScript quotes,
ASI-safe semicolons only as needed, 110 columns, trailing commas, LF, parenthesized
arrow parameters and spaced object braces. JSON retains required double quotes
and no trailing commas. Run `pnpm format` (writes) after each completed change
phase, then verify with `pnpm check:format`; `check:continuity-format` remains a
compatible subset. All authored JS/TS/JSON, including root tooling and legacy
owned files, share this contract. Private state/node_modules are hard-excluded.
The two SHA-pinned original Letta guard factories, `test/oracles/` and patch bytes
are immutable upstream evidence, not formatter omissions.

`pnpm check` includes `check:types` and formatting before the existing source/SDK
gates. `tsconfig.json` owns strict NodeNext/noEmit checking with explicit Node 22
types; `check-types.mjs` verifies every authored TS file under lib/extensions/test
and root TS tooling is actually in the compiler program, and refuses private or
oracle inputs. JS interoperability uses inference with `checkJs: false`; this is
not full JS checking. `skipLibCheck: true` skips external declaration diagnostics,
not authored TypeScript. Use the pinned public TypeScript/Node types devDependencies;
never host internals, fake SDK declarations or blanket source suppressions.
