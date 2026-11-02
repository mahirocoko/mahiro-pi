# Herdr integrations

[← Documentation](README.md) · [Status](status.md) · [Installation](getting-started.md)

The optional `extensions/mahiro-worker-activity.ts` resource is the single private
Web receipt producer for both original Herdr and Herdr App/core. It reads the
public exact-SessionManager subagent service; it never launches/stops children,
sends messages or makes the parent's completion depend on background work.

## One-time setup

With explicit profile-configuration approval, register this canonical extension
once in the intended Pi profile's public `settings.json` extension list, preserving
other entries. It stays outside the guards-first13 package manifest. Create a
regular, non-linked, owner-private (0600) `herdr-web.json` in the same Pi agent
directory (`~/.pi/agent` or explicit `PI_CODING_AGENT_DIR`):

```json
{ "version": 1, "root": "/absolute/canonical/path/to/herdr-web" }
```

The target is explicit, independent of session cwd and native runtime. It is the
Web checkout root, not a transcript path or arbitrary receipt directory. Separate
profiles require their own setup. Missing configuration leaves Web publication
off. Invalid/nonprivate configuration fails closed, without another target.

Activate only through an authorized fresh launch or reload. After activation,
**every TUI session using this profile automatically publishes**, including new,
resume, fork and reload. No per-session observer start is needed. RPC/print/SDK
children cannot replace or retire the TUI producer. The public
`getSubagentsServiceForSession(ctx.sessionManager)` lookup is mandatory; no legacy
global getter or caller-supplied session lookup substitutes for it.

```text
/mh-herdr-web-observer status
/mh-herdr-web-observer stop
```

Status describes local publication, not consumer acceptance. Stop suspends only
this session; next session/reload uses profile configuration again. The old start
command explains setup but grants no session-specific activation. To disable
future sessions, separately approve removal of the profile target/resource.
Neither loading source nor running Web writes configuration or reloads sessions.

Retire older installed observer copies when adopting this producer. Web's old
`scripts/pi-subagents-extension.ts` is a non-writing migration notice. Do not
leave an older, separately installed session-command producer active alongside
this resource. The original Herdr's native `herdr:pi` integration still owns its
identity/lifecycle reporting; it does not write these private receipts.

## Lifecycle and private wire

One existing worker poll supplies the sink. The writer uses no native CLI,
socket, subprocess or second timer; Web independently validates the current Pi
foreground PID against its selected native runtime. One process-global generation
owns publication. A replacement disposes its predecessor. Normal shutdown/reload
revokes only the receipt carrying its own producer token; a late predecessor
cannot erase the successor. A fresh foreign receipt (including an older installed
producer without a generation token) blocks publication rather than starting a
write race; only expired same-parent v1 wire may be replaced. Incompatible receipts
remain unavailable, never silently repaired. Crash/unsafe cleanup falls back to the eight-second
consumer lease. Public SessionManager persistence is lazy: an unwritten parent
publishes nothing until its first persisted response, without requiring restart.

Receipts are atomic owner-only files beneath the explicit target:

```text
.agent-state/runtime/upstream-v10700/pi-subagents/
  <sha256(canonical parent session file)>.json
```

Wire v1 contains parentFile, parentSessionId, pid, updatedAt, producer generation
and records. Native child metadata is whitelisted to id, type, description,
status, startedAt, optional completedAt, toolUses and optional outputFile. No
prompts, thinking, model/auth details, results or transcript contents are copied.
A path in metadata is not permission to read it. Missing exact child service
publishes parent-only `activity: "unavailable"`, never fabricated empty live
activity; malformed, duplicate or oversized snapshots publish no receipt.

| Bound | Value |
| --- | --- |
| Inspected source records | 256 |
| Published records | 24, active first |
| Serialized UTF-8 | 16 KiB including envelope |
| Poll / receipt heartbeat | One second / at most every two seconds |
| Consumer TTL | Eight seconds |

Web independently checks the exact parent file/session header, canonical Pi
store, foreground argv/PID and TTL. Conflicting active managers on one PID fail
closed. Unavailable observation is UNKNOWN, not zero, running or done. Web owns cards and
read-only child details; native subagents own terminal records and transcripts.

The writer is POSIX-only. Existing runtime nodes must be non-linked, owned by
the current UID and owner-private; regular receipts are 0600-equivalent. New
directories use 0700, exclusive temporary files 0600. No chmod, umask/ACL repair,
Windows fallback, credential access or hostile same-user isolation is promised.

## Worker counts

In an already validated inherited original Herdr environment, the same owner
also publishes counts-only display metadata. Before publication/clear the public
CLI confirms the exact Pi PID in the bound pane foreground. Core does not use
this old-runtime transport; its Web receipt lane is independent.

The schema-1 tuple contains running/queued counts and an opaque generation owner,
not child prompts, models, results, transcripts or identities. At most 256 valid
records are inspected. Polls are bounded to one second, unchanged heartbeat to
ten seconds and native token TTL to thirty seconds. One coalescing publication
lane, generation fencing, backoff and disposal prevent stale callbacks.

Herdr owns rendering/lifecycle. Display metadata does not change cwd/title,
focus, native ProgramStatusReporter/OSC 7501, Send/Stop, tasks or Goal truth.

Owners: [extension](../extensions/mahiro-worker-activity.ts),
[count/poll owner](../lib/worker-activity.ts),
[Web writer/config reader](../lib/worker-activity-web.ts). Source/offline checks
are not live profile activation, independent QA or human acceptance.
