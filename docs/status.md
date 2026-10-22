# Status, usage and Herdr display

[← Documentation](README.md) · [Herdr integrations](integrations.md)

The authored footer presents project/Git/session/activity alongside Pi's model,
effort/provider, context and native usage. It uses public footer/TUI APIs and
preserves other extensions' status cells once. The [UI adapter](claude-ui.md)
does not recolor or replace it. The streaming activity line is a separate
public working message, not a second footer cell.

## What the numbers mean

- Git uses local porcelain records: `+N` untracked entries, `~N` tracked changes
  and locally known upstream `↑N` / `↓N`. It never fetches. Untracked directories
  count once.
- Input/output/cache/cost totals come from native usage-bearing session entries,
  counted once across compaction. Cache-hit rate is for the latest assistant
  prompt, not a whole-session average.
- Context keeps zero distinct from unknown. Public model capacity is only a
  fallback; model switches suppress old context until valid matching usage.
- Subscription/route labels use public provider/model evidence. Unavailable is
  not guessed from private host internals.
- Native idle state and bounded active-tool names are display hints, not proof
  of completion, success or human acceptance. The footer keeps that short name
  hint. The streaming line below is the request narrative.
- RTK's current mode is an extension status cell; missing authority shows
  unavailable rather than fabricating an enabled mode.

Narrow layouts prioritize model identity and wrap semantic cells. Public visible
width/truncation preserves Thai and emoji graphemes.

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

Only the legacy `openai-codex` route has the bounded optional account-quota
collector using that selected Pi credential through public auth APIs.
It uses deadlines, account invalidation, backoff and stale bounds; raw credentials
and responses are not persisted. This is not support for arbitrary provider
quota. A separate Herdr renderer may own its own account projection; that is not
Pi-native allowance or proof of matching accounts.

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
[footer](../lib/footer.ts), [Herdr publisher](../lib/status.ts) and
[completion voice](../lib/finish-voice.ts).
