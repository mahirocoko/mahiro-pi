# Native worker activity

[← Feature guide](README.md) · [Herdr Web observer](herdr-web-activity.md)

The optional `extensions/mahiro-worker-activity.ts` publishes parent-scoped child
activity from the public native subagent service. It does not launch, stop or
own children, and Main's idle/done state remains independent of its children.
It is not the streaming activity line. That line is the [status](status.md)
working message for the current request.

## Enable the optional resource

This extension is outside the default 13-resource manifest. After the main
package/public owners are configured, explicitly register the exact canonical
worker-activity resource through Pi's public extension settings if you want it.
Fresh-load only your intended session. Loading a source release is not automatic
profile installation, and existing registrations do not prove the new code loaded.

Do not add a second subagent manager or a competing Web producer.
The public `getSubagentsServiceForSession(ctx.sessionManager)` getter and exact
manager identity remain the source of truth. An old package without that getter
means unavailable, not a fallback global owner.

## Herdr counts

Only an interactive TUI in a validated inherited Herdr environment acquires the
producer. Before publication/clear, the public CLI must confirm this exact Pi
PID in the bound pane's foreground process list. Unknown/lost ownership fails
closed. Headless/RPC/SDK children cannot replace the TUI parent.

A complete schema-1 token tuple publishes only running/queued counts and an
opaque generation owner. At most 256 well-formed native records are accepted;
completed/aborted/stopped/error records are not running. Missing, malformed or
oversized snapshots are unavailable, not clamped or fabricated as zero.

The poll is bounded to one second, unchanged heartbeat to ten seconds and token
TTL to thirty seconds. A single coalescing publication lane, generation fencing,
backoff and disposal prevent stale callbacks. No child descriptions, prompts,
models, results, transcripts or identities are published in these count tokens.

Herdr owns rendering/lifecycle. Its derived overlay cannot manufacture Main
completion or modify task-board, Goal, voice or Halo truth.
[Detailed token/consumer contract](integrations.md#pi-worker-activity--explicit-optional-metadata-resource).

## Herdr Web is a separate opt-in sink

The same existing owner/poll can supply a bounded private v1 JSON receipt after:

```text
/mh-herdr-web-observer start
/mh-herdr-web-observer status
/mh-herdr-web-observer stop
```

It is off merely on load, session-only, stops on reload/shutdown and never changes
child-control authority. Its receipt includes a different whitelisted metadata
subset; it is not the count-token wire. Read the
[privacy, exact binding, caps and activation guide](herdr-web-activity.md).

Compatible consumer: [Herdr Web v0.11.0](https://github.com/mahirocoko/herdr-web/releases/tag/v0.11.0).
That Web release and its human-accepted child cards do not install this Pi
resource, activate observation or establish acceptance of Pi's pending work.
