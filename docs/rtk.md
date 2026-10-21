# RTK control and rewriting

[← Feature guide](README.md) · [Guards](guards.md)

RTK can propose shorter command/output routes while the native guard retains
final execution authority. It is not an auto-grant, usage-quota collector or
verified savings dashboard.

## Modes and defaults

| Mode | Behavior |
| --- | --- |
| `off` | Untouched execution fast path: no helper, filesystem read or log work |
| `suggest` | Ask the installed RTK resolver for a proposal; execute the authorized original |
| `rewrite-safe` | Separate conservative rewrites for supported `git status` / `git diff` / `ls` cases |
| `rewrite-rtk` | Use the installed resolver's candidate only after required native checks |

Explicit profile installation selects absent-state `rewrite-rtk` without
overwriting an existing explicit `off`. Uninstalled/unattested scopes remain
disabled. The footer status cell shows the current mode, explicit off or
unavailability; unavailable authority is not a claim that rewriting is active.

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
the equivalent operation schema. Mode mutation requires primary identity, exact
tool/DATA authority, the fresh expected sequence and actual public UI confirmation.
Do not invent a sequence or bypass a declined/stale confirmation.

`rewrite` explicitly invokes the resolver for a preview, but does not execute its
candidate. Status/doctor/gain do not probe the binary or read history. Logs are
bounded in-memory hashes; savings remain unverified. Preview is not execution
approval.

## Resolver and failure behavior

The resolver uses argv-only
`execFile("rtk", ["rewrite", "--", original])` in the current working directory,
with no shell/helper auto-grant. Bounds: 4,096-byte input, 16,384-byte output,
1,500 ms and at most four helpers. The helper must already be installed through
your separately chosen RTK installation; this package does not install it.

Exit 0/3 produce candidates requiring host checks; 1 preserves the original;
2 blocks. Timeout/error/unknown/oversized/malformed results fall back only to the
guarded original, never partial output. Pipelines/chains may be proposals, not
locally certified shell syntax. A direct `git commit` bypasses the RTK helper,
not the native commit guard.

Original policy and secret/attribution checks happen before the helper.
Proposed and final sanitizer-transformed arguments must also pass before native
spawn. Native children execute under their own policy; primary RTK control does
not transfer authority.

Owners: `lib/rtk.ts`, `lib/rtk-state.ts` and the Root guard.
[Detailed integration record](integrations.md#rtk-resolver-and-saved-models-retirement--2026-10-20).
Saved Model Profiles is retired; native `/model`, auth/defaults and personal
roles are untouched.
