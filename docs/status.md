# Status, usage and Herdr display

[← Feature guide](README.md) · [Worker activity](worker-activity.md)

The authored footer presents project/Git/session/activity alongside Pi's model,
effort/provider, context and native usage. It uses public footer/TUI APIs and
preserves other extensions' status cells once. The [UI adapter](claude-ui.md)
does not recolor or replace it.

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
  of completion, success or human acceptance.
- RTK's current mode is an extension status cell; missing authority shows
  unavailable rather than fabricating an enabled mode.

Narrow layouts prioritize model identity and wrap semantic cells. Public visible
width/truncation preserves Thai and emoji graphemes.

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
The renderer and Halo remain separate products. Optional child counts are covered
in [worker activity](worker-activity.md), not inferred from the footer.

Owners: `extensions/mahiro-status.ts`, `lib/status.ts`, `lib/footer.ts` and
`lib/herdr.ts`. The [integration reference](integrations.md#preserved-presentation-and-public-data)
retains detailed palette, quota, heartbeat and cleanup contracts.
