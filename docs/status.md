# Status, usage and Herdr display

[← Documentation](README.md) · [Herdr integrations](integrations.md)

The authored footer groups project/Git, model/thinking, context and supported
account quota into two rows when space permits. Narrow widths add semantic rows
rather than hiding known quota percentages. It uses public footer/TUI APIs and
the authored palette, with separately colored Git additions and deletions. The [UI adapter](claude-ui.md)
does not recolor or replace it; the Neko-Stack header is unchanged. The streaming
activity line is a separate public working message, not a repeated footer cell.

## Compact footer

At wider widths, project/Git is left-aligned opposite model/thinking on the first
row. The second row puts context used immediately before supported Codex quota,
then native input/output totals and RTK's existing status. Logical fields use
` | ` separators; context and quota bars use ten `▰` / `▱` cells, not a colored
background. Git file counts (`?N` / `~N`), thinking effort and empty `▱` cells
use the existing secondary-text color. Branch/model accents, filled-bar semantic
colors and green/red line totals remain distinct; this changes paint, not text,
geometry or thresholds. For example, with synthetic values:

```text
📁 mahiro-pi | 🌿 main ?2 ~1 | +247 | −89             GPT-6.1 Sol | medium
ctx ▰▰▰▰▱▱▱▱▱▱ 42.0% | Codex Weekly ▰▰▰▰▰▰▰▰▱▱ 81% | ↑128k ↓12k | RTK rewrite-rtk
```

The quota field is optional; this example does not imply current account support
or actual remaining allowance. Context means **used**; account quota means
**left**. They never share one unlabeled percentage.

Narrow widths place model identity, context, quota and native metrics on additional
semantic rows as needed. A 48-column layout retains known quota percentages;
compact or exceptionally tiny widths may drop bars before truncating values.
Compaction-off warnings and exceptional virtual-route evidence retain priority. Very small widths truncate with public grapheme-aware geometry rather
than splitting Thai marks, emoji or ANSI sequences. Other extensions' status
cells are retained once and may add rows beyond the two core rows.

Full paths, session names, activity, ordinary provider labels, capacity/default
compaction labels, cache details and cost no longer crowd the main footer. Native
usage accounting and session history are unchanged; hiding a metric here does
not reset it or change its meaning. `/mh-usage` exposes that detail separately
and identifies the selected account-quota source.

Initial grouping references include
[Two-Line Cockpit](https://statusline.sh/community/two-line-cockpit-pY2p) and
[Ekkoh 2-Line Minimal](https://statusline.sh/community/ekkoh-2-line-minimal-fork-mChm).
Their colors, scripts and runtime integration are not imported.

## What the numbers mean

- Git uses local porcelain records: `?N` untracked entries, `~N` tracked file
  changes and locally known upstream `↑N` / `↓N`. Green `+N` and red `−N` are
  textual added/deleted lines from the net tracked staged-plus-unstaged diff
  against HEAD, not file counts. Untracked content is excluded from these line
  totals. Binary, malformed, unborn-HEAD or failed diff output leaves line totals
  unknown rather than inventing zeros; file counts remain available. Collection
  is bounded, sequential and read-only, disables external diff/textconv, and never
  fetches. Untracked directories count once.
- Input/output/cache/cost totals come from native usage-bearing session entries,
  counted once across compaction. Cache-hit rate is for the latest assistant
  prompt, not a whole-session average.
- Context keeps zero distinct from unknown. Public model capacity is only a
  fallback; model switches suppress old context until valid matching usage.
- Subscription/route labels use public provider/model evidence. Unavailable is
  not guessed from private host internals.
- Native idle state and bounded active-tool names are display hints, not proof
  of completion, success or human acceptance. They remain available to the Herdr
  display publisher; the separate streaming line below owns visible activity.
- RTK's current mode is an extension status cell; missing authority shows
  unavailable rather than fabricating an enabled mode.

Model identity and safety warnings take priority over optional detail. Public
visible width/truncation preserves Thai and emoji graphemes.

## Current activity line

`lib/activity.ts` owns the one streaming activity line. `extensions/mahiro-status.ts`
attaches it with Pi's public `setWorkingMessage` and `setWorkingIndicator`.
The footer, the optional [worker-count widget](integrations.md#worker-counts), the native
queue and any plan stay separate. This line does not copy their contents.

While a request is running the loader row is one fixed line, for example:

```text
Responding · 00 tools ·  0:00:12 · escape to interrupt
```

- The verb is Working, Thinking, Responding, Reading or Running. Reading is only
  read, grep, find and ls. Running is bash, including when other tools are in
  flight. Any other tool, or a mix of read-like tools with anything else, stays
  Working. Thinking and Responding describe the assistant stream when no tool
  is in flight.
- The count is in-flight tool executions for this request, shown as two digits
  and capped at 99. It is not a worker or subagent count.
- Elapsed time starts with the agent run and continues across later turns of
  that run. It is `h:mm:ss`, capped at `99:59:59`.
- The interrupt hint uses the public `app.interrupt` label when that lookup
  succeeds, otherwise `escape`.

Idle, error, abort, shutdown and a replaced session clear the line and stop the
elapsed timer. Startup, reload, new, resume and fork all begin from that idle
line. The timer is not running while idle. Spinner frames are one column and use
a 160ms interval only while Pi is showing the working loader. Narrow terminals
truncate the text and leave two columns for that frame and its space. The
message follows Pi's working-message color. Frames take the current accent
color when the line is published.

Measured usage stays on the footer. This line has no text-length estimate and
does not present one as provider or billed usage.

## Quota is not session usage

**Native direct OpenAI quota is omitted entirely.** There is no fallback Usage
link, speculative quota call, native-direct auth lookup or borrowed credential.
Tokens/cost do not measure remaining subscription allowance.

There are two separately selected account-quota sources:

- **Pi source (default):** only the legacy `openai-codex` OAuth route uses its
  selected Pi credential through public auth APIs. Native direct OpenAI and other
  unsupported routes add no quota row and do not resolve native credentials.
- **Codex CLI source (explicit opt-in):** `/mh-usage codex on` selects and saves
  the existing CLI login independently of the model/provider selected in Pi.
  The usage inspector identifies this source as **Codex CLI**; the compact footer
  uses **Codex** plus the actual window label. Its account may differ from Pi's;
  this is not native OpenAI quota or an auth fallback.
  `/mh-usage source pi` returns to the Pi source for this runtime only.
  Advanced `source codex-cli` also remains a runtime-only selection.

The CLI adapter supports the file-token layout used by the Mods implementation:
`tokens.access_token` and an optional `tokens.account_id` in the one existing
`auth.json` beneath a lexically normalized absolute `CODEX_HOME`, or `~/.codex` when unset. It does not
search alternate stores, invoke the CLI/keychain, use API-key fallback, refresh a
login or write authentication. Other storage modes can remain unavailable even
when `codex` itself is logged in. Credentials, account identifiers, raw JSON and
response bodies are never exposed by the inspector or persisted as quota state.

A CLI read requires the current primary TUI/Root ownership and effective public
PSS authorization for the exact file. Existing read/path/external-directory
restrictions still veto it; ask/deny/missing authority means unavailable, not a
silent permission change. Before reading content, the reader validates a retained
regular-file descriptor and its observed physical pathname: Linux uses its own
`/proc/self/fd` link; macOS requires the fixed system `/usr/sbin/lsof` metadata
inspector. Missing, ambiguous or mismatching descriptor evidence fails closed.
This is a descriptor observation, not a permanent filesystem namespace lock or a
promise against every same-user concurrent content change. Requests use only the
fixed Codex quota endpoint, allowlisted
headers, a five-second deadline and a bounded response; redirects are refused.
There is no login/refresh subprocess or generic credential-read tool.

The collector keeps source/account invalidation, backoff, success TTL and stale
bounds. One cache feeds reset/detail views and the compact footer; rendering and
status panels never resolve auth or fetch. The footer selects at most two core
windows, shows extra-window count where applicable, and drops bars before
truncating. Stale values are labeled and muted; expired stale bounds become
unavailable, never 0%. CLI quota does not populate shared Herdr account slots as
if it belonged to the selected Pi account.

A separate Herdr renderer may own its own account projection; that is not
Pi-native allowance or proof of matching accounts.

## Usage inspector

`/mh-usage [status [page]|close|off|codex on/off|bar|compact|source pi/codex-cli]` opens a temporary
public widget above the editor. `/mh` → **Usage** calls the same status handler.
Commands do not wait for idle, send model turns, append transcript entries, replace
the editor, or read/change composer contents. The snapshot closes after ten seconds;
`close` dismisses it immediately. A replacement panel owns a fresh timer. Before
switch/fork/tree navigation closes the snapshot even if navigation is cancelled,
without disabling later usage commands. Actual tree navigation closes/rebinds only
the matching manager/session/cwd context; shutdown permanently retires the old owner
so retained callbacks cannot reattach it. Non-TUI sessions do not attach it.

- No argument or `status` shows a compact summary. `status 1`, `status 2`, etc.
  show width-bounded detail pages; invalid or unavailable pages report that fact.
  Resize uses public TUI geometry against the captured snapshot, never a new poll.
- Detail includes full-session native input/output/cache read/cache write totals,
  latest assistant cache-hit rate, native estimated cost, current public model and
  thinking identity, exceptional virtual-route evidence, and public context usage.
  Cost is an estimate, not an invoice or remaining subscription balance; a current
  subscription route is labeled separately from the accumulated session total.
- Supported account details show actual remaining windows/durations, reset timestamps,
  cache fetch time and stale state. Credits and reset credits appear only if supplied
  as valid nonnegative values by that same response. Unsupported/missing fields are
  `unavailable`, not zero. After the stale bound, old balances/windows are unavailable.
- `codex on` explicitly selects **Codex CLI** and saves that selection profile-wide,
  independently of the Pi model/provider. No separate source command is needed.
  `off` or `codex off` stops/hides the collector here immediately and saves profile-wide
  off. Native input/output totals are unchanged. A failed off still cancels here,
  but reports that profile-wide persistence is not confirmed. Failed on never starts
  external collection; stale or durability-unknown publication is not retried.
- New eligible primary TUI sessions in the same profile, across projects, restore
  the selection. Existing sessions running this code adopt changed revisions on
  their existing lifecycle check, bounded to five seconds between reads with a
  monotonic clock; there is no watcher, immediate cross-process broadcast or old-code
  refresh. Children and non-TUI sessions never restore it. Missing/denied/corrupt
  storage stops a previously automatic CLI collector, without falling back to Pi.
  Removing its stored preference also stops that automatic selection. A fresh
  authorized read can restore the same valid revision after a transient read failure;
  it clears the unavailable notice without overwriting an unchanged runtime override.
- `source codex-cli` and `source pi` remain advanced runtime-only overrides. An
  unchanged preference reread does not overwrite them; a changed revision or rebind
  applies the profile selection. `bar` and `compact` remain runtime-only formatting.
- Root owns only `<profile>/preferences/usage/state.json`: schema version, revision
  sequence and the boolean CLI selection. No credentials, account IDs, quota windows
  or host settings are saved. Exact `usage_state_data_<sha256(canonical root)>`
  authority comes only from explicit installation. Existing installations may need
  an approved update; commands report unavailable/not saved rather than weakening
  policy. Absent storage keeps the default Pi source with external collection off.
  An ambiguous/failed save blocks automatic on here until an explicit successful save
  or rebind; no automatic save retry occurs. A newly proved off or preference withdrawal
  still stops collection, including after an advanced runtime CLI selection.

The existing collector lifecycle alone reads authentication and fetches quota after
selection; preference reads, commands and rendering never fetch credentials or quota.
Loading source does not provision storage or grants. An existing CLI login does not
prove that its file format, path authorization, token or quota endpoint is usable.
Unavailable/denied/expired responses remain visible as such, with no automatic
login refresh or borrowed account. Source/SDK checks alone do not establish actual
installed activation, live account behavior or human rendered acceptance.

## Herdr display metadata

In an inherited Herdr environment, publication first checks the exact Pi PID in
the exact pane's foreground process list. Unknown ownership fails closed.
It publishes bounded display metadata through public Herdr CLI calls; it does
not change cwd/title, focus a pane, report completion or take lifecycle ownership.
Native ProgramStatusReporter/OSC 7501 remains untouched.

Generation fencing, monotonic sequence, bounded producers and disposal prevent
stale work from reviving a replaced owner. Failures do not fail Pi operations.
Other renderers remain separate products. Optional child counts are covered
in [integrations](integrations.md#worker-counts), not inferred from the footer.

## Completion voice

On macOS, the interactive TUI can announce a successfully settled native run
with the fixed phrase **“ทำงานเสร็จแล้วค่ะ”**. It does not speak the transcript
or forward audio to another application. The latest whole-run outcome must be
completed and final settlement not aborted. Before-settle alone, duplicate
settlement, errors and cancelled runs do not speak.

Argv-only `say` synthesizes the phrase with Kanya at rate 300 into an owned
temporary AIFF; `afplay` plays at volume 0.4. Deadlines, a three-second cooldown,
one active operation and no queue bound playback. Shutdown/reload aborts owned
work; cleanup removes only its generated temporary directory. Headless/RPC/SDK
children cannot displace the TUI owner. Foreground terminal focus is not required.
Non-macOS and notification failures are silent; there is no voice-settings command.

Native settlement remains execution truth. Hearing audio is not task acceptance.
Silent injected test runners do not prove speakers, voice availability or live audio.

Owners: [status](../extensions/mahiro-status.ts), [activity](../lib/activity.ts),
[footer](../lib/footer.ts), [usage inspector](../lib/usage.ts),
[quota cache](../lib/quota.ts), [CLI credential boundary](../lib/codex-cli-quota.ts),
[Herdr publisher](../lib/status.ts) and
[completion voice](../lib/finish-voice.ts).
