# Guards and permissions

[← Documentation](README.md) · [Installation policy](bootstrap.md) · [RTK](rtk.md)

Mahiro Pi uses **one Root native guard** and the public permission-system (PSS)
as the sole policy resolver. It does not add a second permission engine, borrow
another host's grants or replace native subagent ownership.

## File access and command policy are different

File-access policy concerns actual recognized file-path operands, not arbitrary
text in a comment, prompt, query, patch or submitted content. Such text is not
itself a file read. Explicit tool/path/Bash rules still apply; commit-attribution
and managed-memory content screening have separate contracts.

PSS's Bash path gate checks the **first recognized operand**, using its supported
command grammar. It is not an exhaustive traversal of every operand, chain,
redirection, wrapper or interpreter program. Root's final Bash recheck evaluates
**command policy**, not general shell/interpreter file-access inference.
An allowed command is not proof that every file it might access was inspected.

These are cooperating native execution checks, **not an OS sandbox** or
protection against hostile same-user extensions. PowerShell execution is currently
blocked by Root because its classifier is unsupported; preserving its renderer
does not imply execution support.

## Native final execution

The manifest loads `lib/guards/bootstrap.mjs`, then `lib/guards/index.ts`,
before features. Root checks healthy canonical context, public native-tool
provenance, cancellation, commit attribution and final arguments before spawn.
Loading source grants no capability.

For path tools, final execution queries public policy again after argument
changes. A matched deny blocks. A matched ask requires consuming a same-turn
public `permissions:decision` allow for that exact surface/path; a rewritten
path cannot borrow it. Unmatched universal path fallback stays with the public gate.

### Native MCP registry admission

Root admits native MCP calls from a fresh public tool-registry snapshot, not a
per-server tool-name list. The exact dispatched name must have one current
registration with the runtime-assigned built-in MCP owner provenance. Caller
input, MCP-looking names, namespace aliases and copied definition metadata do
not supply that provenance. Root does not reconstruct names from prefixes;
legitimate shortened or hash-suffixed native names remain opaque identities.

Admission also preserves public exposure semantics: hidden, withdrawn, missing
and unknown-exposure entries fail closed. Direct tools require active membership;
registered codemode/deferred tools can be called by another tool while inactive.
Model-issued calls require active membership, and model-only tools are never
nested-callable. Nested identity comes from the host's tool-call event, not input.
The native MCP owner still checks current server/tool availability at execution.

This classification only lets the ordinary PSS pipeline continue. It does not
approve a call, override targeted deny/ask decisions, grant a child role tools or
skip normal codemode dispatch. There is no positive name/provenance cache.
Public registry metadata assumes a trusted Pi host and loaded extension set; it
is not cryptographic factory attestation against hostile in-process code or an
OS sandbox. Source/SDK regressions do not prove that an existing session loaded
the fix: intentional fresh loading and an appropriate read-only native check remain
separate gates. See the [upgrade procedure](getting-started.md#upgrade-safely)
when a same-process reload leaves native tool health unavailable.

### Owner-installed child controls

The public subagent creator can install bare `ask_parent` and `notify_parent`
controls independently of a role's tool list. Root recognizes these only when
its current healthy parent factory attests the exact child SDK manager and the
actual currently registered definition through public `AgentSession` APIs.
The creator separately captures the original execute function; copied names,
schemas, synthetic SDK source metadata, session IDs or lifecycle events are not
ownership proof. Events locate a candidate parent only.

This narrow classification exception is **not a grant**: the ordinary public
PSS pipeline still resolves allow, ask and deny. Missing/legacy attestation,
failed binding, child disposal or parent replacement fails closed. Stale cleanup
cannot revoke a replacement registration. Aliases such as
`functions.notify_parent` are not normalized or admitted. These controls remain
package-owned communication, not generic child execution or RPC authority.

### Filtered configuration reads

Secret reads use public policy, not a mandatory parallel secret resolver.
Optional [BASIC read defaults](bootstrap.md#optional-basic-read-defaults) are
finite and incomplete. Four filtered helpers remain for inspecting configuration
without exposing values: `mh_npm_config`, `mh_env_config`, `mh_pypi_config`
and `mh_certificate_info`. Their explicit or default paths still undergo
native path decisions; a filtered helper is not a policy bypass.

## Effective Bash approval

The authored PSS patch exposes optional `consumeBashApproval`. Only the
**aggregate successful native Bash pipeline** mints a bounded one-shot receipt,
bound before awaiting to:

- Exact SessionManager object and native session ID;
- Full toolCallId and complete original command, including heredoc body;
- Current cwd and the PSS-selected principal.

Root consumes the receipt **before asynchronous transformations**. The returned
execution-local checker re-queries current Bash policy under that principal.
Deny always vetoes. Only the identical effectively approved command may lift an
ask/yolo floor; a changed original, RTK candidate or sanitizer-transformed final
command needs independent **non-yolo allow**. Approval of one command is not
authority for a rewrite.

Unit decision events and path caches never supply Bash authority. Completion,
cancellation, turn end, reload and shutdown revoke receipts and retained
checkers; late approvals from old generations cannot restore them. Without the
capability or valid receipt, Root retains raw allow checks and refuses asks.
This is not a second prompt or a replacement for other PSS pipeline gates.

RTK checks the original, proposal and final sanitized command before native
spawn. Direct `git commit` bypasses the RTK helper, not commit-attribution checks.

## Feature authority and failures

Private feature data uses separate exact capabilities with public winning-rule
attestation. Missing, old, malformed, wildcard-only or yolo-substituted authority
does not become an exact DATA grant. Primary control does not transfer policy to
a native child or authorize maintained-memory writes.

Memory engine selection and automatic policy are not grants. ABI2 retains the
canonical Root/PSS, exact-root DATA authority, actual native output binding and
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

A denial, unsupported alias, unhealthy context or missing provenance is not
permission to retry through a helper or another executor. Resolve the named
owner rather than disabling guards or forging metadata.

Owners: [Root guard](../lib/guards/index.ts) and the authored
[PSS patch](../patches/@gotgenes__pi-permission-system@40.2.2.patch), with child-control
attestation in the authored [subagents patch](../patches/@gotgenes__pi-subagents@23.4.1.patch).
Source declarations and offline SDK/Faux fixtures do not prove that installed
dependencies are patched or a running session loaded them. Installation and an
intentional fresh load must align source, public factories and version-bound
provenance.
