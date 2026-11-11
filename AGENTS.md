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

## Execution and session continuity

- Carry an authorized task through implementation and verification. Investigate
  and use available in-scope approaches rather than stopping at a plan, progress
  update, failed attempt, or checkpoint; do not require Mahiro to say continue.
  Do not invent extra gates or repeat an approval already granted. Decide and
  perform low-impact, in-scope maintenance without asking again, including
  non-destructive memory adjustments or reseeding an absent store when needed;
  assess actual impact rather than treating the action name as a blanket gate.
  Preserve existing knowledge and do not reset or overwrite an existing root.
  Stop for an explicit pause, a real blocker, a safety or permission boundary, or
  a consequential decision that changes scope; report what remains and why.
- When an authorized reload or restart is needed, first identify the exact owner
  session and its live pane. Use the current `herdr-cli` and `direct-cli` guidance
  where applicable, preserve the session ID, and restore that same session rather
  than silently starting a replacement. Verify the resulting session and operation;
  do not treat a submitted command as proof of completion.
- Updates to Pi dependencies/patches, bootstrap, guards, kernel or extension lifecycle
  must preserve installed Pi usability, not merely pass isolated source tests.
  Before replacing dependencies, inspect the relevant non-secret installed package
  registrations and child-extension exclusions. Do not invalidate an owner still
  referenced by a profile: preserve working locators or obtain approval for a
  backed-up, narrowly scoped reference repair before removing it. Registrations and
  matching child exclusions must remain consistent after the update.
  Before claiming installed readiness, verify startup diagnostics, native Read/Bash
  and a feature-status read in an explicitly authorized new Pi tab in the correct
  project; verify real native child tools when child/runtime ownership is affected.
  Keep the existing session unchanged unless its reload is separately authorized.
  Unexpected kernel/guard unavailability, including a reviewer unable to use ordinary
  tools, is a regression/blocker to investigate, not merely a verification caveat.
  If the live check cannot be performed, report the unmet gate; do not claim installed
  Pi is ready. Never disable guards or widen permissions to make the check pass.
  Existing authorization boundaries still apply. This gate does not require live
  checks for docs-only or other changes outside those runtime paths.

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
  file-operand rules and four standalone filtered inspectors. It has no tool
  dispatch allowlist, package realpath/version permission pins, commit rewriting,
  second commit permission checker or throwing PowerShell wrapper. Ordinary native
  execution does not require feature-kernel readiness. Public PSS alone resolves
  policy. File rules apply to recognized file operands, not arbitrary
  prompt/query/comment/content text. Preserve effective Bash approval
  binding/revocation; never replace it with unit decision/path caches.
- RTK is explicit non-executing rewrite preview only. It never intercepts native
  Bash execution and new installations default absent state to off. Existing
  compatibility mode state is preserved but grants no shell/helper authority.
- Source loading/startup provisions nothing. Explicit installation alone composes
  public owners, three package roles and narrow DATA grants. Default-deny removal
  requires explicit consent and removes only scalar `permission["*"]: "deny"`,
  never sets blanket allow. Preserve targeted restrictions and refuse missing
  required grants truthfully. See `docs/bootstrap.md`.
- Maintained knowledge has one private Markdown/Git owner, separate from historical
  recall. `docs/letta-parity-roadmap.md` owns the current direct-upstream direction;
  historical percentages and evidence ladders are records, not planning or release gates.
  Live publication is ABI1 or ABI2: exact-root authority is mandatory.
  Native writers use identity-bound private views and public prompt replacement, not
  cwd overrides, shell tools or inherited private corpus. Preserve existing memory;
  initialize only absent roots. Capacity fallback diagnostics remain exact-root,
  idle-primary and count-only, and must not depend on traversing an already-overflowed
  session branch: preserve leaf/binding/authority fences without returning names, paths,
  record bodies, corpus data or a cleanup handle. No diagnostic authorizes
  deletion/adoption/profile activation.
  The approved experimental local Git/worktree service
  under `lib/agent-memory/local/` is synthetic-only. One in-process coordinator
  creates and reopens its own bare repository. It does not adopt an arbitrary
  Git repository, synchronize a parent checkout, or claim resistance to another
  same-user process editing its metadata. It is not ABI3, is not selected by
  installation, and is not authorized to publish into a live profile, private
  root, prompt, or Palace surface. Synthetic Phase C adds a harness-supplied
  trajectory and a deterministic maintenance worker inside this same service.
  The trajectory owner reads only the explicit entry array passed by its caller.
  It does not read Pi sessions, private memory, transcripts, or live profiles.
  `off`, `compaction`, and `step-count` are synthetic constructor config and do
  not change installer defaults or live reflection policy. The worker may read
  and edit files only through the confined worktree adapter. It has no shell,
  Git, network, or credential handle. The coordinator remains the only publisher.
  Entry text is untrusted evidence. Phase D adds an optional public-SDK model
  maintenance adapter that a caller may pass as this callback. It launches one
  isolated session per job and exposes only the confined workspace tools.
  Extension, kernel, installer, and profile code do not import it. It is not an
  installed model worker and it does not publish. Its trajectory prompt cap is
  not the whole model context. Aggregate assistant, tool-call, argument, and
  tool-result caps plus a cooperative session abort stay inside that callback.
  Phase E adds a disconnected committed prompt projection and explicit
  Memory(path) reads on that same service. Each call resolves `refs/heads/main`
  once and reads only that commit. Compact Core, index, and persona text, plus
  the named project's overview and conventions when requested, stay distinct
  from deferred files. Extension, kernel, installer, and profile code do not
  import it, and it does not publish or replace the live prompt.
  Phase F adds coordinator-owned logical forgetting for that same service.
  A versioned checksummed record under service state stores exact imported
  path, blob, and source exclusions plus rollback metadata. Import can remove
  matching paths from current `main` without rewriting history. Tombstones
  filter worktree, workspace, publication, projection, and later seed inputs.
  Required `Core.md` and `index.md` stay in the tree. A tombstoned blob of
  either file is not shown.   Empty policy is created only during initial
  setup. This is not secure Git-history erasure, not a private-root
  migration, and not a live cutover.
  Phase G adds a read-only canonical `migration-export` manage action for ABI1
  and ABI2, plus a disconnected shadow adapter at `lib/agent-memory/local/migration.ts`.
  The export pages committed ledger metadata, including each active file's
  committed SHA-256 content hash, and returns no file text or root path.
  The adapter seeds only a caller-supplied in-memory bundle into a fresh shadow
  root and installs Phase F tombstones there. Rollback waits on the migration
  turn, then the service turn, and renames only a quiescent root. Extension, kernel, installer, and profile code do not import it.
  It does not publish, select installation, apply, reload, or switch live authority.
  Phase H adds a disconnected synthetic Palace HTML preview for that same
  service. The coordinator turn builds one metadata snapshot: relative corpus
  paths, canonical main, unpublished detached work, lifecycle, visible conflict
  paths, and read-only retry/resume guidance. Integrated and cleaned commits
  are not detached work. Forgotten conflict paths are counts only. The snapshot
  omits file text, reflection, summaries, raw errors, worktree paths, and the
  state root. A separate bounded document read returns one selected committed
  file from that same canonical commit. Document and read routes use a canonical
  base64url path token. A bounded corpus page lists later committed paths for
  that same commit, at most 32 entries. The snapshot itself stays at most 32
  entries and 48 KiB.   The loopback page has four read-only views: context,
  core memory, external memory, and history. Context renders one optional fixed
  session-context snapshot captured before startup. Omitted context is
  unavailable and is not corpus paging. It serves a fresh temporary
  synthetic service, is not live authority and does not own the public Palace
  command. Extension, kernel, installer, and profile code do not import it. It
  does not publish, select installation, or switch live authority.
  The separate installed-path ABI2 committed-preview handoff is owned by
  `lib/agent-memory/palace-handoff.ts` and rendering-only `lib/palace-render/`.
  It must not import `lib/agent-memory/local/**`, receive roots/Git/file readers,
  or grow mutation routes. It renders bounded owner-certified structure, invocation
  metadata and offset-zero history with sanitized subjects and in-scope changed-file
  counts supplied by the live ABI2 runtime, intersecting requested history scope
  with existing shared `allowedPath` authority (prefixes grant nothing).
  Any forgotten path or source refuses history; unknown changed
  paths redact the subject and empty the diff. `engine/data.ts` alone reads committed
  previews: strict shared allowedPath intersected with Core.md, index.md, system/,
  reference/, archives/ and projects/, with forgetting suppression.
  Legacy archives require canonical legacy-v1-<12 hex>/global/<slug>.md or
  deferred/<project>/<slug>.md attribution; arbitrary legacy-v1 prefixes
  are not shared authority.
  The bounded diagnostic DTO and owner `palaceStructure` retain their preview
  budgets; the separate installed file:// export uses owner-mediated metadata/body
  pages and includes every authorized committed Markdown body without viewer
  file-count, body, handoff or HTML truncation. The offset-zero history page stays
  scoped and bounded (32 diffs, 8 KiB each, 128 KiB aggregate); Git headers,
  rename/copy detection and external diff/textconv helpers remain omitted.
  Renderer receives only certified text/metadata, never roots, Git or file readers.
  The exported single HTML path is 0600 inside 0700 viewers/, atomically replaced
  on each command, persistent until replaced or removed by its owner. Browser
  opening is best effort and injectable in tests. No HTTP listener, sidecar,
  capability URL or expiry exists. Preserve primary/idle/revision/config/root,
  allowedPath, forgetting, generation and final authority checks before writing.
  `palace close` may cancel an in-progress export but never deletes previously
  exported bytes; it cannot revoke copies already opened or saved. The public
  façade is `/mh-memory palace` and `palace json`; hidden compatibility aliases
  may remain but are not separate product surfaces.
  For maintained-memory, reflection, migration and Palace parity, Letta Code is the
  implementation baseline. Before each new reference review, verify its checkout is
  clean and run `git pull --ff-only`; stop on unsafe or diverged state rather than
  resetting it. Start by following upstream code and behavior directly. Do not turn
  matching upstream behavior into a separate Mahiro specification, alternative design,
  extra edge-case contract or new test matrix. Adapt only where an existing Mahiro
  authority, privacy, security or transport contract actually conflicts, and keep that
  deviation narrow. Never copy Letta brand assets. Keep exact reference identity and
  necessary attribution in the owning parity guide or third-party notice.
  Browser opening, profile activation/reload, replay registries, Phase I and human
  acceptance remain separate scopes.
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

Use the smallest check that can catch the likely regression: a targeted formatter,
type/docs check, or exact focused test. Do not default every ordinary or Letta-following
change to `check:fast`, a broad test matrix, browser loops and a fresh verifier together.
Use `check:fast` when a change crosses several owned contracts or before an authorized
checkpoint; use geometry smoke only for geometry behavior that is actually changed.
Fresh verification is for material authority/security/recovery/release risk, an observed
regression or a genuinely unresolved finding. Full source/SDK suites and combined
`check:release` require explicit scope; serialize heavy checks. The whole `.agent-state`
must remain strictly below 1 GiB. State gates are bounded checkpoint accounting, not an
OS quota; test owners must bound writes and cleanup exact newly-created runtime roots.
Never prune unknown/live state or private knowledge. Synthetic/source checks are not
rendered, installed or human acceptance. Under an explicit security-audit execution
constraint, do not run target-controlled tests, builds or formatters without the required
sandbox; report source/diff checks and unrun gates instead.

Follow repository-local Biome: two spaces, single JavaScript/TypeScript quotes,
ASI-safe semicolons only as needed, 110 columns, trailing commas, LF, parenthesized
arrow parameters and spaced object braces. JSON retains required double quotes
and no trailing commas. Run `pnpm format` (writes) after each completed change
phase, then verify with `pnpm check:format`; `check:continuity-format` remains a
compatible subset. All authored JS/TS/JSON, including root tooling and legacy
owned files, share this contract. Private state/node_modules are hard-excluded.
`test/oracles/` (including both SHA-pinned original Letta guard factories) and
patch bytes are immutable upstream evidence, not formatter omissions. Neither
legacy guard factory is a runtime dependency; do not restore production copies
or pin maintained runtime code as original upstream bytes.

`pnpm check` / `check:fast` include types, formatting, package/docs and read-only
state-budget gates, not behavioral suites. `check:source` and `check:public-sdk`
are separate heavy tiers; `check:release` explicitly combines all tiers. `tsconfig.json` owns strict NodeNext/noEmit checking with explicit Node 22
types; `check-types.mjs` verifies every authored TS file under lib/extensions/test
and root TS tooling is actually in the compiler program, and refuses private or
oracle inputs. JS interoperability uses inference with `checkJs: false`; this is
not full JS checking. `skipLibCheck: true` skips external declaration diagnostics,
not authored TypeScript. Use the pinned public TypeScript/Node types devDependencies;
never host internals, fake SDK declarations or blanket source suppressions.
