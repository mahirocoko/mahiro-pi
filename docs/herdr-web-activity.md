# Herdr Web Pi child observer

[← Worker activity](worker-activity.md) · [Feature guide](README.md) ·
[Herdr Web v0.11.0](https://github.com/mahirocoko/herdr-web/releases/tag/v0.11.0)

An optional **Pi-owned metadata producer** for a compatible Herdr Web consumer.
Web owns Chat, inline activity/cards, read-only details, parent/PID/privacy
validation and Main Send/Stop. The native subagent service owns child lifecycle,
terminal records and transcripts. This producer reads no conversation content
and adds no child controls.

## Start and stop

The optional [worker-activity resource](worker-activity.md) must already be
explicitly configured from this checkout and fresh-loaded in the intended
interactive session.

```text
/mh-herdr-web-observer start
/mh-herdr-web-observer status
/mh-herdr-web-observer stop
```

Start opts in only that session and its canonical cwd. It is not persisted,
inherited by RPC/print/SDK children, or enabled by loading the resource.
Reload/shutdown stops it and requires another explicit start. There is no new
registry, model tool, configuration/grant, poll timer or default manifest entry.

## Exact owner and private v1 wire

The existing one-second worker poll obtains only the public
`getSubagentsServiceForSession(ctx.sessionManager)` service. Registry
`pi-subagents.session-owner-registry.v1`, protocol
`pi-subagents.session-owner`, version 1 remain the native owner.
No legacy global getter, caller-supplied manager or session-ID lookup substitutes.

After a bounded exact foreground Pi PID check, the sink rereads the service and
fences generation, service and parent identity before atomic rename. The output
is fixed beneath the session's current canonical working directory:

```text
.agent-state/runtime/upstream-v10700/pi-subagents/
  <sha256(canonical parent session file)>.json
```

Wire fields: `version`, `parentFile`, `parentSessionId`, `pid`, `updatedAt`,
`records`. Each record has `id`, `type`, `description`, native `status`,
`startedAt`, optional `completedAt`, `toolUses` and optional `outputFile`.
Prompts, thinking, model/auth details, results and transcript contents are not
read/copied. File paths are metadata, not authorization for arbitrary reads.

| Bound | Value |
| --- | --- |
| Source records inspected | 256 |
| Published records | 24, active first |
| Serialized UTF-8 | 16 KiB |
| Heartbeat | At most every 2 seconds, one foreground probe in flight |
| Web receipt TTL | 8 seconds |

More than 24 active records, malformed/duplicate records, oversize, revoked owner
or missing authority produces **no receipt**, not false zero/running/done.
Web independently validates exact parent/session, current foreground Pi PID and
TTL. Missing/incompatible/stale/denied means **UNKNOWN**. Persisted terminal
records and parent-scoped native paths remain Web's read-only fallback.
Stop leaves prior receipts to expire rather than deleting a newer runtime's file.

## Privacy and supported systems

The writer is **POSIX-only**. Existing runtime path components must be
directories, non-linked, current-UID-owned and 0700-equivalent private; existing
receipt files must be regular/non-linked, current-UID-owned and 0600-equivalent
private. Newly created components use 0700 and exclusive random temporary files
0600. Live or dangling symlinks reject.

Nothing repairs permissions, changes umask/ACLs, reads a secret/transcript,
grants policy or falls back to another directory. An existing non-private
`.agent-state` ancestor can block publication even when its children are private.
Ask that directory's owner to review privacy preparation; do not silently chmod
or relax the contract. Windows has **no live writer** until a separately reviewed
native-ACL writer exists. These checks are cooperating local privacy, not
isolation from hostile same-user code or administrators.

## Activation checklist

1. Confirm the exact optional Pi source/resource and native session owner; do not
   infer a loaded version from old metadata or add the Web repository's producer
   alongside this owner.
2. Inspect runtime directory privacy read-only. Stop on non-private or linked
   components; permissions preparation needs the directory owner's own approval.
3. If needed and explicitly authorized, reload only that ready existing session.
   Source tests, this release and a Web restart do not reload Pi.
4. Run `start`, then `status` after a poll. Unknown/unavailable command means
   stop and review provisioning, not launch another executor.
5. The Web owner verifies receipt binding and native/browser presentation under
   its own authorized runtime lane. No provider prompt or child launch is needed
   merely to enable the sink. Web server activation is separately Web-owned.
6. Stop or shut down when finished; allow eight seconds for the final receipt TTL.

Herdr Web v0.11.0 has separate human acceptance for inline Pi-child cards/loading
and read-only conversation details. Its compatible parent validation includes
argv0-only native Pi. That is Web-owned evidence, not this package's provider,
installation or human acceptance proof. Pi's source/Faux checks and explicit
session/privacy activation remain distinct.
