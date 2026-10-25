# RTK control and rewriting

[← Documentation](README.md) · [Guards](guards.md)

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
overwriting an existing explicit `off`. Unconfigured or unavailable scopes remain
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
the equivalent operation schema. Mode mutation requires primary identity,
standard PSS authority (including wildcard/yolo), the fresh expected sequence
and actual public UI confirmation.
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

Exit **0** produces a candidate; **3** marks approval-required
(`hostApprovalRequired`), not an auto-grant. Both need host policy checks.
Exit **1** preserves the original; **2** blocks. Timeout/error/unknown/oversized/malformed results fall back only to the
guarded original, never partial output. Pipelines/chains may be proposals, not
locally certified shell syntax. A direct `git commit` bypasses the RTK helper,
not the native commit guard.

Original public Bash policy and commit-attribution checks happen before the
helper. Proposed and final sanitizer-transformed arguments must also pass before
native spawn. Public PSS owns applicable file-access policy; the retired mandatory
custom secret checker is not a second policy resolver. Native children execute
under their own policy; primary RTK control does not transfer authority.

State uses the fixed `<profile>/preferences/rtk` owner, standard PSS authority,
0700/0600 private storage and sequence/CAS checks; no generic preference writer.
One fresh full binding is reused within each synchronous execution-read barrier;
no shared permission cache replaces live PSS or final argument authorization.
Small configuration reads allocate from the opened file size plus a growth
sentinel, retaining final identity, size, timestamp and ownership checks.
Public effective Bash approval can authorize only the identical approved command;
changed candidates/final commands require independent non-yolo allow. See the
[exact receipt contract](guards.md#effective-bash-approval). This does not add
arbitrary shell/interpreter file detection. Direct commands and mixed chains
remain subject to command policy, not a universal path sandbox.

Owners: [resolver](../lib/rtk.ts), [state](../lib/rtk-state.ts) and the Root guard.
Saved Model Profiles is retired; native `/model`, auth/defaults and local
roles are untouched.
