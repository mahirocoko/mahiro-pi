# RTK: on/off native Bash execution

[← Documentation](README.md) · [Guards](guards.md)

This guide owns RTK's current source behavior. Source checks are not installed
acceptance: installation, profile changes, reloads and
[installed-readiness checks](getting-started.md#upgrade-safely) remain separate
explicit scopes. This change does not activate an installed profile.

## Modes and defaults

| Mode | Bash behavior |
| --- | --- |
| `off` | Run the original command without invoking the RTK helper. |
| `on` | Use RTK command filters when the resolver finds a supported equivalent; otherwise run the original command. |

On means actual native execution of the selected equivalent and its filtered
output, not just a preview. Upstream `rtk rewrite` owns command support; Mahiro Pi
does not maintain another support whitelist. An already-RTK command is not
wrapped twice. A conservative whole-line `rtk` token bypass also forgoes rewriting
quoted RTK mentions. Direct `git commit` is unchanged and bypasses the helper;
there is no custom commit rewriting or attribution parser.

New explicit profile installations default to `off`. Existing explicit state and
installed defaults are preserved, including legacy `suggest`, `rewrite-safe` and
`rewrite-rtk`. Legacy values never enable execution: status/footer normalize them
to `off`, status retains `storedMode`, and the next explicit confirmed mode write
stores only `off` or `on`. Startup does not migrate or provision files.

The existing footer status cell reports the effective mode or unavailability,
not helper availability or verified savings. Status includes the initialized
`activeThisGeneration` value and current `automaticInterception` mode intent;
individual commands still require feature/data access, a current native receipt,
resolver support and PSS authorization. Status/doctor do not invoke the CLI or
read tracking. Mahiro's `log` remains empty; Mahiro does not collect an
interception history. Explicit `gain` reads the separately installed RTK CLI's
tracking estimates, not Pi-session history or provider billing.

## Native approval and execution

Root consumes the aggregate native Bash approval before awaiting host checks.
Original public Bash policy and bounded host checks happen before the helper.
Only the current, context-owning kernel node may resolve a replacement. Public
permission-system (PSS), including ordinary wildcard/yolo semantics, remains the
sole policy owner; RTK state and helper exit verdicts never grant execution.
The helper's Claude Code permission verdict is not a Pi PSS verdict.

The execution-local PSS checker retains the actual gate principal and revocation.
It rechecks the original command and requires independent current **non-yolo
allow** for a changed command. Original once/yolo approval cannot authorize an
unallowed replacement. A checker rejection is never overridden by a generic
permission query. Missing execution-local receipts or older owners keep ordinary
native Bash authorization but disable automatic interception: a generic query
cannot prove the gate's principal. Missing feature-kernel readiness or unavailable
RTK data authority never becomes a global native Bash gate.

After resolution, Root applies host checks to the actual arguments and rechecks
original and actual command authority immediately before exactly one native
execution. Generation/context, state revision, config binding, cancellation and
revocation are fenced after the helper and again after awaited host checks.
A helper denial or an unallowed replacement blocks the call; neither becomes an
unsupported-command fallback. Once execution starts, there is **no automatic
retry of the original**, even after failure or an unknown outcome.
See [the native receipt contract](guards.md#effective-bash-approval).

## Commands

```text
/mh-rtk
/mh-rtk status
/mh-rtk menu
/mh-rtk mode on <sequence-from-status>
/mh-rtk mode off <sequence-from-status>
/mh-rtk log
/mh-rtk doctor
/mh-rtk guidance
/mh-rtk gain [project|all]
/mh-rtk projects
/mh-rtk rewrite git status --short
```

Bare or spaces/tabs-only input opens the usage dashboard in TUI, never a mode
write. `/mh-rtk gain [project|all]` opens the same dashboard; `/mh-rtk menu`
opens controls, which also has a usage entry. Status and doctor remain explicit
structured diagnostics without CLI access. `mh_rtk` exposes the equivalent
operation schema, with `scope: project|all` and `view: overview|daily|commands`
accepted only for `gain` (defaults: project and overview). Non-TUI gain returns
structured evidence without custom UI. Mode mutation requires primary identity,
standard PSS authority (including wildcard/yolo), the fresh expected sequence
and actual public UI confirmation. Do not invent a sequence or bypass a
declined/stale confirmation. Native children execute under their own policy;
primary RTK control does not transfer authority.

`rewrite` explicitly invokes the resolver for a non-executing preview, regardless
of stored mode. It never executes the candidate or grants permission to execute
it later. The preview input requires current PSS allow;
previews do not consume native execution receipts. Binding, generation and state
are rechecked after the helper. Submitting a proposal later as Bash goes through
the ordinary native permission pipeline. Explicit denies remain in force.

## Usage dashboard and upstream evidence

The temporary native Pi screen uses the active theme. Overview shows command
count, estimated raw/filtered/saved output tokens and output reduction. Daily
shows up to seven recent dates from that same JSON snapshot. `1`/`o`, `2`/`d`
and `3`/`c` select Overview, Daily and CLI report; `r` explicitly refreshes,
`p` or `s` toggles project/all, arrows scroll, `m` opens controls and Escape
closes. There is no polling or automatic mode change. Close/disposal cancels the
request and stale scope/generation results are discarded. Human visual
acceptance and installed readiness remain separate.

The fixed argv-only JSON command is
`rtk gain --daily --format json --text -p`; all-project scope omits `-p`.
Upstream `-p` uses canonical current working directory and its descendants,
not an automatically discovered Git root. Tracking can include other RTK
clients: this is not this Pi session's usage. Input/output/saved in the upstream
schema mean raw/filtered/saved **output-token estimates (bytes/4)**, not provider
input/output tokens, billed tokens, dollars or native quota. Output reduction
comes directly from RTK, not a reconstructed formula. RTK headline/day totals
exclude oversized commands; a nonzero `oversized_excluded` count appears in
Overview. Empty data is distinguished from missing or inaccessible data.

Upstream JSON does not export command groups or recent history. Selecting
**CLI report** explicitly runs `rtk gain --text -p` (all omits `-p`). This view
preserves the complete original plain static report, including its By Command
table, rather than parsing a fragile table. Any upstream proxy sections are
opaque upstream information, may be global even with project scope, and are not
Pi-specific or provider billing measurements. No watch, quota, reset, API or raw
history requests are added. `--text` avoids upstream dashboard/proxy auto-dispatch.

Statistics children use no shell and accept only the fixed scope/view enums.
Bounds are 128 KiB JSON or 256 KiB report stdout, 3 seconds and at most two
children. Strict UTF-8, bounded JSON, dates and finite nonnegative safe numeric
values are validated; unused additive fields are ignored. CLI report ANSI/OSC
and remaining terminal controls are removed before rendering or tool return.
Missing binary, timeout, oversize, malformed output and busy states never return
partial data or fake zero counters; stderr/private launch errors are not shown.
Each child sets `RTK_TELEMETRY_DISABLED=1` and `NO_COLOR=1` without persistent
configuration changes. Mahiro does not open SQLite; the upstream CLI itself may
initialize or migrate its tracking database, so invoking gain is not a promise
of zero upstream-owned filesystem writes.

Feature/data authority, current primary context/session, generation, binding and
state revision remain fenced before launch and after awaits. The exact fixed
command requires current public PSS Bash allow (including wildcard/yolo) and
existing final host argument validation; modified command text is refused,
never executed. Late evidence is withheld if authority changes. These explicit
statistics commands do not consume or bypass automatic-interception receipts
and never execute resolver candidates.

## Resolver and failure behavior

The resolver uses argv-only
`execFile("rtk", ["rewrite", "--", original])` in the current working directory,
with no shell/helper auto-grant. Bounds: 4,096-byte input, 16,384-byte output,
1,500 ms and at most four helpers. The helper must already be installed through
your separately chosen RTK installation; this package does not install it.

Exit **0** produces a candidate; **3** marks approval-required
(`hostApprovalRequired`), not an auto-grant. Exit **1** returns unchanged with no
candidate; **2** returns denied with no candidate. Timeout/error/unknown/oversized/
malformed results return no candidate, never partial output. Missing/failed helpers
before execution retain the original on its normal native permission path.
Pipelines/chains can be proposals, not locally certified shell syntax; the actual
proposal still needs the native checker's independent allow and final host checks.

Biome command lines return unchanged instead of a helper candidate: RTK can
otherwise turn `pnpm exec biome --version` or
`pnpm exec biome format --write ...` into `rtk lint`, changing their meaning.
This conservative `biome` token check covers the whole line, including chains,
pipelines and quoted mentions. The resolver still consults the helper;
exit **2** still returns denied. The veto preserves both preview and execution
semantics rather than maintaining a second command-support list.

State uses the fixed `<profile>/preferences/rtk` owner, standard PSS authority,
0700/0600 private storage and sequence/CAS checks; no generic preference writer.
Small configuration reads allocate from the opened file size plus a growth
sentinel, retaining final identity, size, timestamp and ownership checks.
RTK state permissions never become Bash authority. Direct commands
and mixed chains remain subject to command policy, not a universal path sandbox.
This covers CLI filters, not provider API proxy activation, account/config changes
or billed-savings measurement.

Owners: [resolver and controls](../lib/rtk.ts), [statistics](../lib/rtk-stats.ts),
[native usage panel](../lib/rtk-panel.ts), [state](../lib/rtk-state.ts) and the
[Root guard](../lib/guards/index.ts). Saved Model Profiles is retired; native
`/model`, auth/defaults and local roles are untouched.
