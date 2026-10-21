# Completion voice

[← Feature guide](README.md)

On macOS, the TUI extension can announce a successfully completed native run with
the fixed phrase **“ทำงานเสร็จแล้วค่ะ”**. It does not speak the transcript or forward
audio through Halo.

## When it speaks

The extension observes public `agent_start`, `agent_before_settle` and
`agent_settled` events. The latest whole-run outcome must be completed and final
settlement must not be aborted. Before-settle alone never speaks: retries,
compaction and queued continuations must finish first. Duplicate settlement,
missing/error/aborted outcomes do not speak.

Only interactive TUI ownership participates. Headless/RPC/SDK children cannot
displace a TUI parent's voice owner. No startup audio occurs, and shutdown/reload
aborts owned work. Terminal foreground focus is not required for this notification.

## Local playback and limits

Argv-only macOS `say` synthesizes the literal phrase using Kanya at rate 300 into
an owned temporary AIFF; `afplay` plays it at volume 0.4. Operations have command
and overall deadlines, a three-second cooldown, one active operation and no queue.
Cleanup removes only the generated temporary directory. Non-macOS and notification
failures are silent.

There is no package voice-settings slash command or new provider call. Native
settlement remains the execution truth; hearing a notification is not a verified
task outcome or human acceptance. Tests inject silent runners and do not prove
your speakers, installed Kanya voice or native audio E2E.

Owners: `extensions/mahiro-finish-voice.ts` and `lib/finish-voice.ts`.
[Detailed lifecycle reference](integrations.md#pi-completion-voice).
