# UI, theme and Neko-Stack header

[← Feature guide](README.md) · [Status/footer](status.md) · [Release notes](releases/0.3.0.md)

Mahiro explicitly closed the requested UI work on **21 October 2026**. This is
acceptance of that scope, not proof of exhaustive regular/fullscreen raster tests,
activation in every session or acceptance of unrelated memory/observer work.
The Neko-Stack selection and authored footer are preserved.

`extensions/mahiro-claude-ui.ts` is a presentation-only public-API adapter, appended
as resource 13 after bootstrap, the Root guard and the preserved ten features.
`lib/claude-ui.ts` owns tool/header presentation and geometry;
`lib/claude-ui-diff.ts` owns bounded historical diff pairing/word spans, and
`lib/claude-ui-settings.ts` owns the live settings panel and actual-renderer samples.
`lib/claude-ui-preferences.ts` owns the closed UI data contract;
`lib/claude-ui-state.ts` and `lib/guards/own-ui.ts` own fixed-root storage behind
Root's generation-bound `read(ctx)` / `save(ctx, ticket, prefs)` bridge. Source registration does
not authorize installation, reload, real-profile activation or human acceptance.
The Mahiro footer, quota, RTK, permissions, tool execution, model context and
session history retain their existing owners. No task/group/silent mode, spinner,
queue, key/Esc interception or host-private patch is included.

## Palette ownership and runtime controls

`themes/mahiro-claude-dark.json` is an **optional** dark theme resource. Merely
loading the package does not select it, change Pi's host theme, or write settings.
Selecting it through native Pi settings is a separate human decision; this
source release does not apply a global theme or change a profile.

The extension controller owns **in-memory, UI-only** runtime preferences. Explicit
Save can additionally persist them through the authorized own-UI owner:

- `/mh-ui` (or `/mh-ui settings`) opens a public `SelectList` with a focus-follow
  preview from the **actual tool/diff renderer** and the controller's retained
  public native factory products, labeled synthetic rather than execution.
  Up/down focus changes the preview **before any value changes**, without publishing
  preferences: palette shows Read/Edit/Write, tool style shows Bash/pending/error,
  edit diff shows Edit, and extra detail shows a long Read. An additional **Preview
  scenario** row cycles focus-default / Read / Bash / Edit / Write / pending / error;
  choosing a sample never changes runtime preferences. Enter (the public configurable
  confirm binding) or Space activates a setting. There is no search or mirrored
  private selection index. Fullscreen mouse press/wheel follows public selection;
  click activates, with coordinates translated from the actual rendered list offset.
  Palette, tool style (`transparent` / `tinted`), edit diff (`split` / `unified` /
  `native`) and extra detail update the preview and runtime presentation immediately.
  **Apply for this runtime** keeps changes and closes; **Cancel** (including native
  selection cancellation) restores the opening choices. **Reset runtime defaults**
  previews `follow`, `transparent`, `split`, detail off, and remains cancellable.
  Selection uses the public component's native configurable bindings; the injected
  native tool-expansion binding also expands/collapses the sample locally. There is
  no global key interceptor. Stale generation or competing runtime changes cannot be
  overwritten by an old panel or its cancellation/disposal.
- `/mh-ui theme status` (or `/mh-ui theme`) reports the mode, palette
  name, native-diff exception, and storage availability. Theme commands never autosave.
- `/mh-ui theme follow` uses the current Pi theme for these tool rows and header.
  This is the unsaved default; native theme changes invalidate/rebuild components.
- `/mh-ui theme claude` uses the loaded `mahiro-claude-dark` palette for these tool
  rows and header, independent of the host theme. Missing theme leaves the mode
  unchanged and reports unavailability. **This does not disable the application
  theme or activate a global theme.** The clean split/unified diff uses the selected
  UI palette; optional native `renderDiff` and native fallback/key hints retain the
  current Pi theme because the public diff API has no palette argument.

### Conditional durable own-UI preferences

**Save preferences** is the only durable publication action. Apply keeps the live
choices for this runtime; Cancel restores the opening runtime choices, and Reset
only previews the defaults until an explicit Save. A stale/closed/busy panel,
concurrent disk change or revoked owner never reports a successful Save. Any failed
Save requires reopening settings and a fresh read; no automatic retry occurs.

Authorized TUI startup (new session, resume or reload) loads the saved choices.
Uninstalled, denied, invalid or corrupt storage is shown as unavailable/not saved,
not as an empty successful store; runtime appearance controls remain usable. A saved
`claude` palette whose theme is unavailable falls back to `follow` **without rewriting
the stored preferences**. Theme commands never autosave.

The Root guard exposes a versioned, generation-bound closed bridge, not arbitrary
paths, caller services or caller-supplied provenance. It checks the healthy current
Root generation, exact public SDK manager, primary non-native-child header, TUI and
cancellation, plus the fresh public command registry's sole exact bare `mh-ui`
registration. All bare-name collisions are counted before filtering. Only the exact
canonical authored package/manifest extension identity is accepted. This is registered
owner identity, **not invocation-origin or human-Save attestation, cryptography or a
same-UID sandbox**.

One exact winning `own_ui_state_data_<sha256(canonical profile/preferences/own-ui)>`
allow is required from the public permission service, including exact source/tool/
matched-surface attestation and no yolo substitution. There is no synthetic `mh_ui`
tool or control permission, no RTK/native-preference borrowing, and applicable explicit
read/path-read/path-write restrictions remain effective (writes also require reading).
Only future explicitly reviewed feature-DATA installation composes this exact DATA
capability; loading source, startup and preview grant nothing and seed no UI state.
Existing restrictions, explicit offs, consent and reviewed-plan CAS remain intact.

The fixed owned data folders are 0700; state/lock/temp are no-follow, owned,
single-link 0600 regular files. Reads are descriptor-bounded to 4 KiB, strict UTF-8,
closed version 1 appearance state and a monotonic sequence. Authorized absent reads
return defaults plus an absence ticket **without creation or mode repair**. Raw-byte
CAS distinguishes absence and every external byte change. Publication uses an
exclusive cooperative lock (never stolen), fsynced temp, identity/authority/CAS
rechecks, atomic rename and directory fsync including newly created directories.
A failure after rename says **written, durability unknown** rather than not-written
or saved; it requires a fresh read. Fixed errors never echo stored JSON/parser values.

This describes the **source** contract, not a release, installed
policy, production activation, completed independent security review or human acceptance.
No real profile was modified. Native/global model, auth, grants, settings and session
entries are untouched. Neither palette recolors or replaces the Mahiro footer. Theme
resources load through public APIs at startup/on command, never filesystem reads in
rendering; all own-UI I/O stays behind Root.

## Persistent native startup setting

To keep the header while hiding startup resource listings, choose native
`/settings` → Quiet startup → `header`, equivalent to `quietStartup: "header"`.
Pi owns and persists this setting. `false` is the native default; `true` hides
both the startup header and resource listing. The `header` mode also hides the
native model scope line. This host setting is distinct from `/mh-ui`'s
UI-only choices and separately authorized explicit Save. No own-UI action writes
native settings.

## Individual tool rows and native fallback

Only matching public built-in presentation functions for `read`, `bash`, `edit`,
`write`, `grep`, `find` and `ls` are adapted. Identity comparison uses public native
factories without executing them. Custom same-name renderers, other tools,
PowerShell, native codemode/task tools and specialized tools remain with `next()`.
There are no replacement tool definitions, execution wrappers or event-result
mutations. The resolver is inert before TUI startup and in RPC/JSON/print modes;
runtime SDK/TUI imports are deferred until interactive startup.

Each call has its own dot/title/path or command and a result arm. Pending and
partial results (even with output) are never reported successful. Collapsed output
shows a bounded number of **wrapped rows**, plus a native expansion key hint.
Completed generic results show captured output-line counts; optional extra detail
shows captured duration and more collapsed rows, never inferred execution status.
The optional tint uses semantic pending/success/error backgrounds without changing
native status or output.
Native expansion retains all captured output and errors. Truncation/full-output
notices remain visible collapsed; expansion cannot recover data the native tool
already truncated. Image-bearing results and image-path read calls delegate to
native rendering, including when inline images are disabled. The public host
retains image display, clicking and expansion behavior; the self-rendered fallback
adds horizontal padding rather than importing private shell/image machinery.

Edit previews use **only historical native** `details.diff` or `details.patch`.
A clean implementation pairs contiguous removed/added lines, adds distinct old/new
line numbers and semantic backgrounds, and highlights changed word spans. At 72
available content columns or more, split mode renders old/new panes with a separator;
less space automatically uses wrapped unified rows. Unified context displays both
old/new numbers, including after insertions/deletions. Patch hunk offsets, gaps,
CRLF and BOM content are retained. Word segmentation uses public `Intl.Segmenter`
for Thai/combining/emoji-safe spans; all column geometry uses public Pi TUI helpers.
No upstream diff helper source was copied and no new dependency is installed.

Preparation is capped at 128 Ki characters / 2,000 lines, with a shared 131,072-cell
word alignment budget, 256 tokens per side and 8,192 characters per paired line.
When word work is exhausted, full lines remain visible and the summary says word
highlights are limited. Oversized or malformed captures use an explicitly labeled
full plain historical fallback, not omitted content or a fabricated success.
Optional `native` mode uses public `renderDiff` only for bounded parsed captures;
otherwise it also falls back to all captured plain rows. Parsed spans cache plain
data only, never theme ANSI. Native result text/warnings and full-output notices
remain available through native expansion. There is no current-file read or
speculative preview from old/new call arguments.
Normal writes do not provide an old-file snapshot: successful writes show a
**submitted content preview**, explicitly not an overwrite/new-file diff. Native
result text is also retained, including warnings and write status. Errors/partial
writes show no successful content preview. No claim that a write created a new
file is inferred from its name. An overwrite before/after diff is infeasible in
this rendering-only scope: ordinary event contexts have no `executeTool`, guarded
nested calls belong only to `ExtensionToolContext`, and native write provides no
before-image. No filesystem preread, native read factory execution, history cache,
helper tool, execution wrapper or context/result mutation is used to work around
that boundary.

All geometry uses public TUI visible-width/wrap/truncate helpers. Ornament yields
space to content at tiny widths. ANSI tool sequences are stripped; native diff
styling is retained. Thai, CJK, combining characters and emoji/ZWJ are exercised.
No cached colored strings survive a palette-mode switch.

## Startup header and truthful data limits

The boxed, two-column wide layout was implemented after directly reading
cc-my-pi's `assets/screenshots/startup-header.png`. It stacks at widths below 76
columns and reduces to text branding at fewer than 6 columns. The header now
pairs `Mahiro` with **Neko-Stack**, Argon-created candidate `02`, explicitly
selected by Mahiro (replacing the earlier static `π`). Its six 16-cell block-art
rows are preserved verbatim, including leading/trailing spaces; narrow stacked
headers crop the art with public TUI geometry rather than wrapping its pixels.
The logo selection alone did not establish full-UI acceptance; the later
explicit closeout of the requested UI scope is recorded above.

Art provenance: Argon-created Neko-Stack candidate `02`, explicitly selected by
Mahiro. Its six authored rows are retained in `lib/claude-ui.ts`; local selection
hashes/render evidence stay outside release artifacts.
The Argon-created, human-selected art is separate from the cc-my-pi palette
attribution below; no originality or trademark-clearance claim is made.

Current provider/model, effort and cwd come from public context. Counts mean
**active tools / registered tools**, **resource commands** (extension/prompt/skill
commands, not all built-in slash commands), and **extension MCP registrations**
(`getMcpServers()`, not the full mcp.json configuration or connected-server totals). Missing model/effort is unavailable. Loaded skills/extensions
and global/project totals are not exposed by these public extension APIs and are
explicitly unavailable, never fabricated by scanning files or private loaders.
Long fields can be clipped in the two-column layout; narrow stacked text wraps.

## Provenance and deliberate differences

Direct visual/source references inspected, never executed:

- cc-my-pi `6746292ff4359b2bdca987109ff49c8da055bb23`: startup header, tool rendering,
  diff and new-file screenshots; supplied runtime-control screenshot. Its palette
  alone is adapted, with complete root MIT notice in
  [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
- pi-compact-tools `8be1a8de1a7003c436a11256a5f65943148e09b0`: public resolver,
  Claude labels/output, stored edit diff and successful write-content approaches
  studied. No source was extracted; no upstream entrypoint is imported.
- cc-my-pi `VENDOR.md` identifies header scaffolding ancestry as Phoobobo's
  pi-claude-code-tui `e5061f0` (MIT), with its layout/mascot/stats forked locally.
  This adapter copies neither header source/scaffolding nor mascot. It is a clean
  public `setHeader` component, not an unresolved-license source transplant.
- cc-my-pi's embedded diff ancestry remains unresolved; none is copied. Its four
  raw screenshots (`tool-rendering.png`, `diff-rendering.png`, `new-file-create.png`,
  `settings-panel.png`) were read directly again for this polish. The bounded
  split/word-diff implementation is clean authored source, not that embedded code.
  Public native `renderDiff` was tried first: it exposes no width/palette/split
  options and highlights only a single removed/added pair, so it remains optional.

This candidate deliberately lacks grouped tool trees, animated status, the large
cc-my-pi reference mascot and private loaded-resource totals. Overwrite before-images
remain deliberately unavailable for the API reasons above; own-UI persistence is
conditional on the separately guarded DATA owner described above. Split diff and runtime settings are now present but
are not a claim of pixel-exact recreation. The
selected Neko-Stack art is not that reference mascot. The theme's
optional global effect has not been activated. These are disclosed differences,
**not pixel-exact fidelity or exhaustive visual evidence**. The requested UI
scope was explicitly human-closed; that does not authorize a later redesign.

## Bounded verification and remaining gates

Targeted tests: `test/claude-ui.test.ts`, `test/claude-ui-polish.test.ts` plus
resource-order/RTK/footer regressions. New behavioral coverage includes paired
multi-line word changes, patch offsets, created/deleted historical diffs, bounds,
wide/narrow geometry, ANSI/graphemes, theme/mode changes, actual public selector
interaction, preview/cancel/reset/apply/unavailable choices, stale generation/CAS,
immutable input and non-TUI isolation. Own-UI storage/controller coverage is authored in
`test/claude-ui-state.test.ts`, `test/claude-ui-storage.test.ts`, and the actual
Root/public-SDK gate `lib/guards/test/own-ui-{patch,sdk}-test.mjs`; results and independent
review remain evidence-specific, not inferred from source. Phase 1 adds focused deterministic public-UI tests for
up/down focus without writes, independent six-scenario selection, mouse coordinate
translation, pending/error distinction, retained native products without execution
access, and panel widths 1/20/60/110/160. Serial focused results for this candidate
belong under ignored `.agent-state/runtime/claude-workflow-v2/`; full SDK, terminal
geometry and human visual acceptance are separate, not inferred from these tests.
`test/claude-ui-fixture.ts` emits deterministic raw ANSI or plain output using
public TUI geometry and public native diff, without a live profile or provider:

```sh
node test/claude-ui-fixture.ts 110 --plain
node test/claude-ui-fixture.ts 40 --plain
node test/claude-ui-fixture.ts 110
```

`test/claude-ui-polish-fixture.ts` adds standalone diff and settings views:

```sh
node test/claude-ui-polish-fixture.ts diff 110 --plain
node test/claude-ui-polish-fixture.ts diff 40
node test/claude-ui-polish-fixture.ts settings 110 --changed --plain
```

Raw ANSI/plain wide/narrow candidate previews and immutable before/final source
proof for this pass belong under ignored `.agent-state/runtime/t220-polish/`.
These are deterministic presentation samples, not an interaction with the parent's
live preview context, a rendered screenshot comparison or human visual acceptance.

The fixture initializes only a built-in test-process theme with its watcher off
and an explicit fixture-only F6 expansion binding (to prove hints are not hardcoded).
It is not a regular/fullscreen live terminal or human acceptance test. Raw local
initial-candidate evidence remains under ignored `.agent-state/runtime/t220-ui/`;
this polish uses `.agent-state/runtime/t220-polish/`.

Bootstrap source fingerprints and disposable source staging already cover the
entire `lib/` directory (including both new narrow modules), the theme directory
and third-party notice. Scoped Biome paths include the new module/test glob. This
only binds resources for later explicit installation; it does not grant or write
profile authority.

Before this polish, the reservation records the prior combined 326 checks and
20 SDK checks as baseline evidence only, not proof for these new changes. This
polish passed 59 scoped tests (Claude UI + polish + footer/status/RTK contract),
scoped direct Biome formatting/error diagnostics and diff whitespace checks.
Those initial counts are historical, not the combined release gates. Later
independent renderer/parser review and serialized checks covered the repaired
source; this release reruns its own final combined gates. Actual outcomes belong
in the [release record](releases/0.3.0.md), not these earlier fixture counts.
Synthetic previews do not establish exhaustive regular/fullscreen rendered tests.
Publication does not change profiles, reload sessions, select a global theme or
alter model/auth settings.
