# UI, theme and Neko-Stack header

[← Documentation](README.md) · [Status](status.md) · [Attribution](../THIRD_PARTY_NOTICES.md)

This public-API adapter changes presentation only: header and matching native
tool rows. It does not wrap execution, mutate tool results, replace the footer
or take over queues, shortcuts, permissions, models or session history.

## Appearance controls

```text
/mh-ui settings
/mh-ui theme status
/mh-ui theme follow
/mh-ui theme claude
/mh-ui theme obsidian
/mh-ui theme ember
/mh-ui theme nordic
/mh-ui live-tail status|on|off
```

The settings panel previews actual renderers with synthetic examples, not tool
execution. Focus changes the preview before changing a value. Enter/Space
activates a setting; public selection/expansion bindings remain configurable.
Fullscreen mouse coordinates use the actual rendered list position.

| Setting | Choices/default |
| --- | --- |
| Palette | Follow Pi (default), `claude` (`mahiro-claude-dark`), `obsidian` (`mahiro-obsidian-dark`), `ember` (`mahiro-ember-dark`), or `nordic` (`mahiro-nordic-dark`) |
| Tool style | Transparent (default), tinted |
| Edit diff | Split (default), unified, native |
| Extra detail | Off (default), on |
| Preview scenario | Focus-default, Read, Bash, Edit, Write, pending, error; not a preference |

Changes preview immediately. **Apply for this runtime** keeps them and closes;
**Cancel** restores opening runtime choices. **Reset runtime defaults** previews
defaults and remains cancellable. Old panels cannot overwrite competing runtime
changes or a replaced generation.

The optional dark theme resources (`mahiro-claude-dark`, `mahiro-obsidian-dark`,
`mahiro-ember-dark`, `mahiro-nordic-dark`) are never automatically selected as a
global host theme. `theme follow` follows Pi for these rows/header; `theme claude`,
`theme obsidian`, `theme ember`, and `theme nordic` apply that loaded palette to
Mahiro tool rows, header, and split/unified diffs without calling `setTheme()` or
changing the global host theme. Missing palette resources report unavailability
without changing mode. None recolors the authored footer. Optional native
diff/fallback keeps Pi's global theme because that public API has no palette
argument; users who want a shipped theme across the entire Pi host chrome can
select it explicitly through Pi's own theme setting.

## Explicit appearance Save

Apply and theme commands are **runtime-only** and never autosave.
**Save preferences** separately persists only supported appearance choices to
the fixed `<profile>/preferences/own-ui` owner. Live-tail and the native/global
theme selection are not saved there. Older versions accept `follow` and `claude`
but may reject saved `obsidian`, `ember` or `nordic` choices after a downgrade.

Save requires live current kernel ownership, one current public extension `mh-ui`
registration with no bare-name collision, primary TUI context and the exact
public winning own-UI DATA allow. Source loading grants nothing. This checks
registered owner identity, not cryptographic human-Save/invocation-origin proof
or hostile same-user isolation. See [installation authority](bootstrap.md).

Authorized TUI startup/resume/reload loads saved choices. Missing/denied/corrupt
storage is unavailable, never reported successfully empty or saved; runtime
controls remain usable. A saved Claude choice with a missing theme falls back
to follow without rewriting storage.

Storage uses 0700 folders, owned single-link 0600 state/lock/temp files, strict
closed v1 data, a 4-KiB read ceiling, monotonic sequence and raw-byte CAS.
Absent reads return defaults and an absence ticket without creating state.
Locks are never stolen. Stale/busy panels, disk races, revocation or failed
publication require reopening settings for a fresh read; there is no automatic
retry. A post-rename durability failure reports **written, durability unknown**,
not saved or not-written. Fixed errors do not echo stored JSON.

## Tool rows and native fallback

Matching public factory renderers for read, bash, powershell, edit, write, grep,
find and ls are adapted; built-in codemode keeps its native call/result renderer
inside the self-rendered shell so completed scripts do not inherit the host's
default green box surface. Same-name custom renderers, subagents and MCP/custom
tools deliberately retain their own renderers.
Image-bearing results and image-path reads also delegate to native rendering.
Own session/workflow tools supply their separate
[structured cards and inspector](workflows.md#on-demand-workflow-inspector);
this native-tool adapter does not replace those renderers or execute their actions.
PowerShell presentation does not override [Root's execution restriction](guards.md).

Each call has its own title/path or command and result arm. Pending/partial
results never display success. Completed output remains stable, including
history replay. Collapsed output is bounded by wrapped rows; native expansion
retains all captured output, warnings and full-output notices. Expansion cannot
recover content the native tool already truncated. Extra detail shows more rows
and captured duration, never inferred status.

Live-tail starts off in each TUI session. When enabled it shows the last three
lines (eight with extra detail) from at most the last 4 KiB, labeled
`Running… · live tail` and `not a completed result`. It never persists.

### Historical edit diffs

Edit previews use captured native `details.diff` or `details.patch`, not current
file reads or speculative old/new call arguments. Contiguous removed/added lines
are paired with old/new line numbers and bounded word highlighting. Split and
unified changes use neutral theme text on a quiet code-span removal/addition tint
(leaving trailing cell padding uncolored so short lines do not form full-width
blocks), with a stronger background and bold type for changed words instead of
inversion.
Terminal-default colors may be approximated, and 256-color palettes can reduce
the difference between shades; the word and `+`/`−` cues remain available.
Split mode needs at least 72 content columns and a fitting bounded 256-cell
prefix; narrow/overflowing content uses wrapped unified rows. Unified context
retains both line numbers, patch offsets, gaps, CRLF and BOM.

Preparation is capped at 128 Ki characters / 2000 lines, with a 131072-cell
alignment budget, 256 tokens/side and 8192 characters/paired line. Exhausted word
work retains full lines and labels limited highlights. Malformed/oversized or
unsupported captures fall back to all captured plain historical rows, not
fabricated edits. Optional native mode uses public `renderDiff` only for bounded
parsed captures. Unicode geometry uses public TUI helpers and word segmentation,
not UTF-16 width.

### Submitted-content write previews

Native writes have no old-file snapshot. Successful writes show submitted
content with line numbers and **create/overwrite unknown**; the path and success
text cannot distinguish creation from overwrite. Errors/partial results do not
show a successful content preview. Native status/warnings remain visible.

There is no before/after write diff, filesystem preread, read-factory execution,
helper or execution wrapper to manufacture a before-image.

## Pasted image paths

When native Ctrl+V inserts a generated PNG path into the draft, that path is
**not a direct prompt attachment**. Submitting the path text alone does not
supply image context. Ask the assistant to use native `read` on that exact image
path, subject to file permissions; the read result supplies the actual image
for inspection. Do not substitute a text-only description of the path or claim
that direct attachment succeeded. Clipboard behavior belongs to the native host,
not this rendering adapter.

## Header and host settings

The header pairs Mahiro branding with Neko-Stack block art. Wide two-column
layout stacks below 76 columns and reduces to text below six. Long fields can
clip; narrow text wraps while art is cropped with public geometry, not wrapped.

Provider/model, effort and cwd come from public context. Counts mean active /
registered tools, resource commands and extension MCP registrations, **not**
all built-in commands, connected-server totals or private loaded-resource counts.
Unavailable data stays unavailable; no private loader/filesystem scanning fills it.

Native `/settings` → Quiet startup → `header`
(`quietStartup: "header"`) keeps the header while hiding resource listings and
model scope. Pi persists that host setting independently. Native true hides both
header/listing; false is the host default. Own-UI Save never writes native settings.

## Attribution and verification

The optional palette adapts cc-my-pi; its MIT notice is retained in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Header/tool screenshots and
pi-compact-tools informed the implementation; no upstream entrypoint or embedded
diff source is imported. Neko-Stack is separate authored, selected art, not the
reference mascot. No pixel-exact fidelity or trademark-clearance claim is made.

Owners: [adapter](../extensions/mahiro-claude-ui.ts),
[renderer](../lib/claude-ui.ts), [diff](../lib/claude-ui-diff.ts),
[settings](../lib/claude-ui-settings.ts) and [storage](../lib/claude-ui-state.ts).
Deterministic plain/ANSI samples are available through
`node test/claude-ui-fixture.ts 110 --plain` and
`node test/claude-ui-polish-fixture.ts diff 40`. Source/synthetic geometry is not
an exhaustive live-terminal, screenshot or human-acceptance test. Publication
does not activate a palette, install grants or reload a profile.
