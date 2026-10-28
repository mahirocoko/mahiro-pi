# Guards and permissions

[← Documentation](README.md) · [Installation policy](bootstrap.md) · [RTK](rtk.md)

Mahiro Pi has an independently bootstrapped **feature kernel**, an optional
**Root native guard**, and the public permission-system (PSS) as the sole policy
resolver. It does not add a second permission engine, borrow another host's
grants or replace native subagent ownership.

## Feature kernel and lifecycle

The first existing manifest entry is now `lib/guards/bootstrap.ts`: TypeScript
keeps kernel and public-owner imports inside Pi's supported extension loader,
not Node's native `.mjs` strip-types path. It activates `lib/kernel/index.ts`
before Root. The manifest still has thirteen entries in the same logical order:
bootstrap, Root, ten features, then the rendering-only UI adapter. No extra entry
or automatically activated theme is added.

`lib/kernel/registry.mjs` owns the one process-wide service registry shared by
native ESM and Jiti. Its historical `healthy-nodes` symbol is retained as the same
object, not a second registry. Kernel readiness means a live bound generation,
not a healthy guard host, provenance classifier or permission grant. Actual
SessionManager identity, unparented-primary checks, scoped native parent service,
child tracking and memory leases/retirement/drain stay together in the kernel.
Root neither publishes feature nodes nor releases their memory holds.

Features call their kernel ABI at the actual operation boundary. Current public
registration, context and PSS decisions are checked there, without importing
Root provenance or its executable host. Status remains available under the
existing PSS authority when Root is omitted; native argument checks are
separate from feature readiness. Argument copying for recall/memory is a kernel
context boundary, not a secret checker or guard-health dependency.

Bootstrap does not intercept tool calls. Missing kernel readiness produces a
warning, not a global lockout. Individual state features refuse a missing or
retired context at their own ABI boundary; ordinary native tools do not need a
kernel node. Source loading/startup provisions nothing.

Genuine offline SDK/Faux regressions separately omit Root from kernel resources
and omit the kernel from native Root resources. They exercise Goal status,
wildcard/yolo policy, live PSS revocation, native child/fork refusal, generation
cleanup and ordinary read/grep/Bash execution. These are source tests, not proof
of an installed session, private-memory recovery or human acceptance.

## File access and command policy are different

File-access policy concerns actual recognized file-path operands, not arbitrary
text in a comment, prompt, query, patch or submitted content. Such text is not
itself a file read. Explicit tool/path/Bash rules and managed-memory content
screening have separate contracts.

PSS's Bash path gate checks the **first recognized operand**, using its supported
command grammar. It is not an exhaustive traversal of every operand, chain,
redirection, wrapper or interpreter program. Root's final Bash recheck evaluates
**command policy**, not general shell/interpreter file-access inference.
An allowed command is not proof that every file it might access was inspected.

These are cooperating native execution checks, **not an OS sandbox** or
protection against hostile same-user extensions. Root does not register a
PowerShell wrapper: normal host support and PSS own its availability. Removing
an always-throwing wrapper is not a claim that a Bash classifier understands
PowerShell.

## Native final execution

The manifest loads `lib/guards/bootstrap.ts`, then `lib/guards/index.ts`,
before features. When loaded, Root checks its live native host, public PSS,
cancellation, recognized secret file operands and final arguments before spawn. It does not require kernel presence or package provenance for ordinary
native execution. Root applies only `host.finalArgs`, checks current PSS
Bash authority and receipt validity again, then invokes native execution. It does
not call RTK or require RTK state authority. All stored RTK modes are compatibility
state only; explicit `mh_rtk rewrite` is a non-executing preview. Loading source
grants no capability.

For path tools, final execution queries public policy again after argument
changes. A matched deny blocks. A matched ask requires consuming a same-turn
public `permissions:decision` allow for that exact surface/path; a rewritten
path cannot borrow it. Unmatched universal path fallback stays with the public gate.

### Native MCP registry admission

Pi, codemode, the MCP owner and the public subagent package own their actual
registrations, exposure rules, role tools and execution lifecycle. Root has no
second dispatch allowlist, alias classifier or exact package realpath/version
permission plane. Normal PSS decisions still apply to built-ins, tasks, recall,
memory, subagents, other extensions and native MCP. A tool-looking name does not
create a registration or bypass the host's own dispatch semantics.

### Owner-installed child controls

The native parent service still owns child-manager identity and creator-installed
controls such as `ask_parent` / `notify_parent`. Kernel child tracking preserves
that relationship, generation fencing and private-memory leases; it does not
turn communication into generic execution authority. Root neither reconstructs
these names nor supplies a second permission grant.

Source tests do not prove that a long-lived process loaded changed factories.
Fresh declared-SDK subprocess checks and live runtime acceptance are distinct.
See [safe upgrades](getting-started.md#upgrade-safely); reload/profile changes
still require their own human authorization.

### Filtered configuration reads

`secret-paths.mjs` blocks recognized native read operands for `.env*`, npm/PyPI
and common credential/key paths, including aliases resolving to those paths.
It inspects operands, not arbitrary query or file-content text. This finite list
is not recursive shell/interpreter analysis or a universal data-loss-prevention
sandbox; PSS's supported Bash/file policy remains a separate boundary.

Four standalone bounded inspectors preserve filtered configuration reads:
`mh_npm_config`, `mh_env_config`, `mh_pypi_config` and `mh_certificate_info`.
They do not load or instantiate the old secret checker. Their explicit/default
paths still undergo PSS decisions; only filtered metadata is returned.

Both original Letta guard factories remain frozen test-only evidence under
`test/oracles/letta/`. Neither has a runtime copy in `lib/`: the secret factory
was superseded by the bounded path/inspector implementation, and the commit
factory was retired rather than retaining a parser that could rewrite command
meaning. Runtime commit arguments are not rewritten. Optional
[BASIC read defaults](bootstrap.md#optional-basic-read-defaults) remain finite and
incomplete.

## Effective Bash approval

The authored PSS patch exposes optional `consumeBashApproval`. Only the
**aggregate successful native Bash pipeline** mints a bounded one-shot receipt,
bound before awaiting to:

- Exact SessionManager object and native session ID;
- Full toolCallId and complete original command, including heredoc body;
- Current cwd and the PSS-selected principal.

Root consumes the receipt before awaiting final host checks and rechecks that
same original invocation immediately before native execution. The execution-local
checker re-queries current Bash policy under the captured principal. Deny always
vetoes; revocation or lifecycle replacement also blocks execution. Root does not run a
second transformed-command permission algorithm.

Unit decision events and path caches never supply Bash authority. Completion,
cancellation, turn end, reload and shutdown revoke receipts and retained
checkers; late approvals from old generations cannot restore them. Without the
capability or valid receipt, Root retains raw allow checks and refuses asks.
This is not a second prompt or a replacement for other PSS pipeline gates.

Automatic RTK interception is retired: no helper proposal or RTK authorization
runs in native execution. Root retains original approval, revocation and the
final current check after its bounded host checks. Explicit denies still veto.
Direct `git commit` never needs the RTK helper and remains under ordinary PSS
authorization without custom command rewriting. An explicit RTK rewrite preview
also bypasses the helper for direct `git commit`; it never executes any candidate.

## Feature authority and failures

Goal, Evidence, UX Workflow, Execution Run, Code Map and `mh_rtk` use standard
public PSS allow decisions, including wildcard and yolo according to the policy
owner's precedence. Exact named/DATA winning-surface attestation is not an extra
permission plane for these tools. Explicit tool and applicable path denials stay
in force. Direct owner access requires an existing PSS allow; an unresolved ask
is reported as such rather than treated as an implicit grant.

Policy is distinct from state ownership: actual primary-session restrictions,
canonical project/root bindings, revisions, public human gates and exclusive
owner locks remain. Primary control does not transfer to a native child or
supply private maintained-memory authority. Permission and context failures
report the relevant tool/owner instead of claiming missing package provenance.

Usage selection has a separate kernel-owned fixed `preferences/usage` namespace.
Each read/save requires the current live kernel generation and exact primary TUI
SessionManager, plus the actual registered extension `mh-usage` command. Public PSS must attest the exact usage-root DATA allow;
wildcard/yolo/other namespaces cannot substitute. Explicit read/path-read/path-write
restrictions still veto. Authority is checked before binding/filesystem inspection
and again before publication. The boolean-only bounded record uses private modes,
no links, one-use manager-bound CAS tickets, exclusive lock, temp file, atomic rename
and qualified durability. No stale-lock stealing, automatic retry, read-time repair
or native settings write occurs. This assumes trusted same-UID code, not cryptographic
isolation from hostile loaded extensions. Selection never supplies credential-read
permission; the existing guarded CLI collector remains a separate boundary.

Memory engine selection and automatic policy are not grants. ABI2 retains the
canonical kernel/PSS binding, exact-root DATA authority, actual native output binding and
fresh current execution/publication barriers. Data work runs in a Node child;
model workers remain in-process, not an OS sandbox. A canonical installed writer
route must pass exact physical model/availability checks and is explicitly pinned
at spawn; no virtual/fuzzy/parent-model fallback or credential copying occurs.

Installation may register reviewed owners and grants but preserves targeted
restrictions. Reflection denial permits manual-memory installation; unrelated
historical quote-learning authority is neither required nor granted. Targeted
denies must be changed only through supported public PSS configuration/approval
under human authority. The memory automatic-policy tool changes no permissions;
its current [interruption limitation](agent-memory.md#policy-interruption-limit)
must not be confused with publication reconciliation.
`--remove-default-deny` removes only scalar
`permission["*"]: "deny"` with explicit consent; it never grants blanket allow.
See [bootstrap](bootstrap.md) for refusal and recovery behavior.

A real PSS denial or invalid state-owner context is not permission to retry
through a helper or another executor. Resolve the named
owner rather than disabling guards or forging metadata.

Owners: [feature kernel](../lib/kernel/index.ts), [Root guard](../lib/guards/index.ts) and the authored
[PSS patch](../patches/@gotgenes__pi-permission-system@40.2.2.patch), with child-control
attestation in the authored [subagents patch](../patches/@gotgenes__pi-subagents@23.4.1.patch).
Source declarations and offline SDK/Faux fixtures do not prove that installed
dependencies are patched or a running session loaded them. Installation and an
intentional fresh load must align source and public factories. Retired provenance
classifiers are not runtime authority.
