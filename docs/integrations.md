# Herdr integrations

[← Documentation](README.md) · [Status](status.md) · [Installation](getting-started.md)

The optional `extensions/mahiro-worker-activity.ts` resource reads the public
parent-scoped native subagent service. It never launches/stops children, owns
their lifecycle or makes the parent's idle/completed state depend on them.

## Enable the optional resource

Worker activity is outside the default manifest. After installing the required
public owners, explicitly register the exact canonical extension through Pi's
public extension settings and intentionally fresh-load the intended session.
Do not add a second subagent manager or competing Web producer.

`getSubagentsServiceForSession(ctx.sessionManager)` and exact manager identity
are required. A legacy global getter or caller-supplied session lookup is not a
fallback. Missing capability means unavailable, not no children. Counts are
separate from the current request's [streaming activity line](status.md).

## Worker counts

Only a TUI in a validated inherited Herdr environment acquires the producer.
Before publication/clear, the public CLI must confirm the exact Pi PID in the
bound pane's foreground process list. Unknown/lost ownership fails closed;
headless/RPC/SDK children cannot replace their TUI parent.

A complete schema-1 token tuple publishes only running/queued counts and an
opaque generation owner. At most 256 well-formed records are accepted.
Completed/aborted/stopped/error records are not running. Missing, malformed or
oversized snapshots are unavailable, never clamped or fabricated as zero.

The poll is bounded to one second, unchanged heartbeat to ten seconds and token
TTL to thirty seconds. One coalescing publication lane, generation fencing,
backoff and disposal prevent stale callbacks. Tokens contain no child prompts,
descriptions, models, results, transcripts or identities.

Herdr owns rendering and lifecycle. Display metadata does not change cwd/title,
focus a pane, replace native ProgramStatusReporter/OSC 7501, complete work or
mutate task-board/Goal/voice truth.

## Web observer

The same owner/poll can supply a separate bounded private v1 JSON receipt:

```text
/mh-herdr-web-observer start
/mh-herdr-web-observer status
/mh-herdr-web-observer stop
```

The observer is **off merely on load**. Start opts in only the current interactive
session and canonical cwd; it is not persisted or inherited by children.
Reload/shutdown stops it and requires a new explicit start. No new model tool,
grant, registry, poll timer or default manifest entry is added.

After exact foreground PID validation, the writer rereads and fences service,
generation and parent identity before atomic publication beneath the current cwd:

```text
.agent-state/runtime/upstream-v10700/pi-subagents/
  <sha256(canonical parent session file)>.json
```

The fixed path is the consumer protocol, not an evidence directory chosen by the
caller. Envelope fields are version, parentFile, parentSessionId, pid, updatedAt
and records. Each record contains id, type, description, native status, startedAt,
optional completedAt, toolUses and optional outputFile. Prompts, thinking,
model/auth details, results and transcript contents are not read/copied.
A path in metadata is not permission to read it.

| Bound | Value |
| --- | --- |
| Inspected source records | 256 |
| Published records | 24, active first |
| Serialized UTF-8 | 16 KiB |
| Receipt heartbeat | At most every two seconds; one foreground probe in flight |
| Consumer TTL | Eight seconds |

Too many active records, malformed/duplicate records, oversize or revoked/missing
ownership produces no receipt. Missing/incompatible/stale/denied observation is
**UNKNOWN**, not zero, running or done. Stop leaves prior receipts to expire
rather than deleting a newer runtime's file.

### Privacy and compatible consumer

The writer is POSIX-only. Existing path components must be non-linked,
current-UID-owned private directories (0700-equivalent); receipt files must be
regular/non-linked, owned and 0600-equivalent. New directories use 0700 and
exclusive temporary files 0600. Live/dangling symlinks reject.

Nothing repairs permissions, changes umask/ACLs, grants access or falls back to
another directory. A non-private ancestor can block publication even if its
children are private. Privacy preparation needs that directory owner's approval,
not silent chmod. Windows has no live writer. These are local cooperative
privacy checks, not hostile same-user/admin isolation.

A compatible [Herdr Web v0.11.0 consumer](https://github.com/mahirocoko/herdr-web/releases/tag/v0.11.0)
independently validates parent/session, foreground PID and TTL. Web owns cards,
read-only details and Main Send/Stop; native subagents own terminal records and
transcripts. Those records remain the consumer's separate read-only fallback.
Installing or restarting Web does not load this Pi resource or enable observation.

For activation, confirm the exact optional resource/native owner, inspect directory
privacy read-only, fresh-load only if authorized, then start/status after a poll.
Unavailable controls mean review provisioning, not launch another executor.
Stop when finished and allow the TTL to expire. Provider prompts and child
launches are unnecessary merely to enable this sink.

Owners: [extension](../extensions/mahiro-worker-activity.ts),
[count producer](../lib/worker-activity.ts) and
[Web writer](../lib/worker-activity-web.ts). Source/offline checks establish
neither live activation nor browser/native/human acceptance.
