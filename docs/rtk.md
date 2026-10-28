# RTK compatibility state and explicit previews

[← Documentation](README.md) · [Guards](guards.md)

Automatic RTK Bash interception is retired. Root applies its native argument
checks and current public PSS authorization, then executes the native command.
No RTK mode invokes a helper, rewrites arguments or adds authorization barriers
to that execution path. RTK is not an auto-grant, usage-quota collector or
verified savings dashboard.

## Modes and defaults

New explicit profile installations default to `off`. Existing explicit state
and installed defaults are preserved, including `suggest`, `rewrite-safe` and
`rewrite-rtk`. All four values remain accepted compatibility state only; none
intercepts Bash. Changing a mode does not enable automatic rewriting.

The existing footer status cell reports the stored compatibility mode or
unavailability, not active interception or helper availability. The legacy
`activeThisGeneration` status field reports the initialized compatibility value;
`automaticInterception` is always false. `transform` remains a no-op compatibility
API: it returns its input without owner checks, state reads, helpers or logging,
even after shutdown. Root does not call it.

## Commands

```text
/mh-rtk
/mh-rtk status
/mh-rtk log
/mh-rtk doctor
/mh-rtk guidance
/mh-rtk gain
/mh-rtk projects
/mh-rtk rewrite git status --short
/mh-rtk mode off <sequence-from-status>
```

Bare or spaces/tabs-only input means status, never a mode write. `mh_rtk` exposes
the equivalent operation schema. Mode mutation requires primary identity,
standard PSS authority (including wildcard/yolo), the fresh expected sequence
and actual public UI confirmation. Do not invent a sequence or bypass a
declined/stale confirmation.

`rewrite` explicitly invokes the resolver for a non-executing preview, regardless
of stored mode. It never executes the candidate or grants permission to execute
it later. Original public Bash policy and bounded host checks happen before the helper.
The preview input requires current PSS allow;
previews do not consume native execution receipts. Binding, generation and state
are rechecked after the helper. A returned proposal is data, not host approval:
submitting it later as Bash goes through the ordinary native permission pipeline.
Explicit denies remain in force.

Status/doctor/gain do not probe the binary or read history. No automatic rewrite
logs are produced; `log` returns the generation's empty compatibility log.
Savings remain unverified.

## Resolver and failure behavior

The resolver uses argv-only
`execFile("rtk", ["rewrite", "--", original])` in the current working directory,
with no shell/helper auto-grant. Bounds: 4,096-byte input, 16,384-byte output,
1,500 ms and at most four helpers. The helper must already be installed through
your separately chosen RTK installation; this package does not install it.

Exit **0** produces a candidate; **3** marks approval-required
(`hostApprovalRequired`), not an auto-grant. Exit **1** returns unchanged with no
candidate; **2** returns denied with no candidate. Timeout/error/unknown/oversized/
malformed results return no candidate, never partial output. These are preview
results, not native execution decisions or fallback execution. Pipelines/chains
may be proposals, not locally certified shell syntax. Direct `git commit` preview input bypasses the helper after policy and host checks.

Biome command lines return unchanged instead of a helper candidate: RTK can
otherwise turn `pnpm exec biome --version` or
`pnpm exec biome format --write ...` into `rtk lint`, changing their meaning.
This conservative `biome` token check covers the whole line, including chains,
pipelines and quoted mentions. The explicit preview still consults the helper;
exit **2** still returns denied. It does not affect ordinary Bash execution.

State uses the fixed `<profile>/preferences/rtk` owner, standard PSS authority,
0700/0600 private storage and sequence/CAS checks; no generic preference writer.
Small configuration reads allocate from the opened file size plus a growth
sentinel, retaining final identity, size, timestamp and ownership checks.
RTK state permissions never become Bash authority. Native children execute under
their own policy; primary RTK control does not transfer authority. Direct commands
and mixed chains remain subject to command policy, not a universal path sandbox.
See the [native receipt contract](guards.md#effective-bash-approval) for raw
approval, revocation and the final current check.

Owners: [preview resolver](../lib/rtk.ts), [state](../lib/rtk-state.ts) and the
[Root guard](../lib/guards/index.ts). Saved Model Profiles is retired; native
`/model`, auth/defaults and local roles are untouched.
