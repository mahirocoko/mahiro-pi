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
resolver support and PSS authorization. Status/doctor/gain do not probe the
binary or read history. Mahiro's `log` remains empty; Mahiro does not collect an
interception history. The separately installed RTK CLI may maintain its own
tracking database. Savings remain unverified.

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
/mh-rtk gain
/mh-rtk projects
/mh-rtk rewrite git status --short
```

Bare or spaces/tabs-only input means status, never a mode write. `mh_rtk` exposes
the equivalent operation schema. Mode mutation requires primary identity,
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

Owners: [resolver and controls](../lib/rtk.ts), [state](../lib/rtk-state.ts) and the
[Root guard](../lib/guards/index.ts). Saved Model Profiles is retired; native
`/model`, auth/defaults and local roles are untouched.
