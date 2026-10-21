# Code Evidence — canonical project reports

[← Feature guide](README.md) · [Goals](goal.md) · [Installation](getting-started.md)

Use `/mh-evidence` for help/status/report and explicit collect/clear controls.
The model tool is `mh_code_evidence`; recorded external checks are metadata,
never commands to execute or automatic Goal evidence.

`extensions/mahiro-code-evidence.ts` is the **eighth feature** and **tenth
manifest resource**, after the two guards and seven preserved features. Pi owns `lib/evidence/`; canonical
Letta `mods/mahiro-code-evidence.ts` remains unchanged. Source publication is not
profile activation, verification of recorded external checks, human acceptance
or complete cross-host parity.

## Product contract

The model-callable `mh_code_evidence` has closed actions:

- `get`, optional `workspace`: read only this profile/project/native session's report.
- `collect`, optional `workspace`, `base_ref`: explicitly sample staged, unstaged,
  untracked and committed base-to-HEAD lanes separately. Recollection increments
  revision and retains the last 20 records as visibly stale history.
- `record`: requires `workspace`, positive `expected_revision`, `kind`, `result`
  and single-line `summary`; accepts optional `reference`, descriptive `command`
  and up to 20 opaque `criterion_ids`. Read/get or collect in the current native
  context first. At most 50 records; summaries/references are at most 500 code
  units, command metadata 300. **command is never executed**.

Kinds: file, command, test, browser, native, manual, other. Results: passed,
failed, observed, blocked. Results are caller metadata about an already-performed
check, not authenticated execution receipts. `needs_evidence`, `needs_work`,
`evidence_ready` retain original semantics; ready explicitly means metadata ready
for selection, **not verified execution or Goal completion**. Goal handoff is
reference-only. Only fresh passing/observed current records are candidates when
the verdict is ready. Opaque Goal/Evidence/Core/C1 references convey no permission.
This resource never attaches evidence, claims/verifies criteria, completes or
creates Goals, reads Goal state, imports Letta state, indexes source, collects
automatically, injects per-turn reminders or fabricates human episodes.

Human commands: `/mh-evidence help`, `status [workspace]`, `report [workspace]`,
`collect [workspace]`, `clear <revision> [workspace]`. Clear has no model-callable
action. It requires public UI confirmation naming exact collection, native session,
project and revision, followed by fresh whole-envelope CAS. Missing UI, decline,
revocation, navigation and stale approval never write. Ordinary collect/record do
not have a universal UI gate. Force-unlock and automatic cross-project/session moves
are unsupported.

## Canonical binding and authority

Explicit `install:profile` composes tool and canonical feature DATA namespace authority once, without a per-project whitelist. Authorized empty reads initialize nothing. Optional retained legacy configuration at
`<profile>/extensions/mahiro-code-evidence/config.json` has exactly:

```json
{ "version": 1, "profile": "/canonical/private/profile", "projects": ["/canonical/project"] }
```

Profile binding uses native `PI_CODING_AGENT_DIR`, otherwise `~/.pi/agent`, never
a tool-supplied state path. Safe host profile parents may be0755; optional config/data directories must be0700,
config 0600; canonical roots must exist, be non-symlinked and separate from profile,
source, memory and C1. Git collection requires **native cwd to equal
the canonical project and that project to equal Git worktree top-level**.
A workspace child selects that already-authorized root; it cannot widen a configured
subproject into a parent/sibling repository. Aliased workspace paths reject.
Missing-config and authorized-empty reads/startup/registration do not mkdir,
initialize, import or run Git. `install.mjs` composes existing bootstrap owners;
see [`bootstrap.md`](bootstrap.md). No ordinary per-project setup is required.
Legacy exact leaf/tool/path denials remain effective even with namespace allow.

State is derived only as `<profile>/workflow/evidence/<sha256(project UTF8)>/` with
`state.json` and `state.lock`. Native identity is profile + project + actual native
session ID, not Letta agent/conversation IDs and never a sole-report fallback.
New sessions get no implicit report. Native tree/branch navigation never rewinds
canonical state; before-switch/tree/fork and lifecycle events cancel owned work
and invalidate fresh tickets. The canonical guard currently permits only primary
unparented native sessions and excludes known children; this conservatively limits
human forks too.

Root `lib/guards/index.ts` owns the candidate narrow ABI `evidence: {version:1,generation,assertAccess,
authorize,authorizeGit,assertSources}`. Both exact `mh_code_evidence` and exact
`code_evidence_state_data_<sha256(canonical-Evidence-namespace UTF8)>` (or retained exact legacy leaf authority) must be actual public-service
winning allows: source tool, non-yolo origin, toolName and matchedSurface exactly
equal the queried surface. Family/default/wildcard winners, memory-only,
root-only/tool-only, aliases, foreign copies, stale/unhealthy generations, malformed
or old-owner results deny. Applicable explicit root/state/lock path denials remain.
Actual canonical Pi package 0.3.0, exact entry and manifest provenance, actual
SessionManager, primary context and cancellation are checked in outer dispatch,
nested/direct execution and publication. The existing authored permission-owner
patch is reused **only in offline staged-owner fixtures**. An old service without winning-surface attestation fails closed. The earlier
installed-root offline repair is separate history; this phase changes no installed
assets, grants or runtime load.

## Git boundary and conservative freshness

The source/operator-bound executable is `/usr/bin/git`, never a caller executable
or PATH lookup. Structured argv uses shell:false; no caller pathspec/switch/shell.
The exact fixed prefix disables optional locks, fsmonitor, hooks, submodule recurse,
long submodule diff, external/global excludes files and all protocols. Global ignore
patterns are intentionally not applied; repository `.gitignore` and `.git/info/exclude`
remain effective. This is a conservative coverage adaptation, not exact ignore parity. Environment is allowlisted, removes Git
storage/config injection overrides and disables prompts, askpass, SSH and lazy
fetch. Git may internally read ordinary global/include configuration; this is
not a malicious same-UID/configuration sandbox or universal Git security proof.

Only top-level discovery precedes exact configured-project equality. `.git` must
be an in-project real directory; linked worktrees, external git/common dirs,
alternates, metadata symlinks/special files and promisor/partial-clone storage are
unsupported. A bounded (20,000-entry) administrative metadata walk refuses Git
metadata indirection without reading source content. Effective Git config is
queried by **selected presence names only**, never raw values/full config:
clean/process/smudge filters, promisor/partialclone, worktree/alternate-ref commands
and worktree config are rejected before diff or untracked collection. Proven
executable external diff/textconv/fsmonitor fixtures are suppressed by fixed flags;
proven clean/process helpers are rejected before execution. No network is tested
or attempted.

Root `lib/guards/index.ts` `authorizeGit` accepts only the fixed executable/prefix/tail grammar. It sends
the fully quoted representation through the **existing** canonical
`host.finalArgs('bash', {command}, ctx)`, rejects any transformation, applies public
existing Bash/read/path decisions, then rechecks authority. Execution still uses
the original structured argv, never the quoted/rewritten shell string. Exact app
and root grants do not bypass existing Bash policy. A positive fixture permits
only the quoted `/usr/bin/git` fixed-prefix command family; it does not grant a
broad shell executor. This ABI cannot authorize arbitrary git config/commands.

Full 40/64-hex OIDs are validated before diff/merge-base. Refs reject option-like
and control/space input; refs are verified with --end-of-options and commit peeling.
Only the exact C-locale absent-upstream diagnostic permits a missing base; timeouts,
cancellation, overflow and other Git errors never masquerade as absence. Existing
report inspection errors fail closed, rather than publishing an unconfirmed report.
Before any content-capable Git operation (including name-status and shortstat),
metadata-only `ls-files --cached -z` and recursive `ls-tree` inventories supply index,
HEAD and selected-base logical paths. A bounded worktree name walk authorizes each
entry before lstat, including ignored/untracked files, directories and missing
`.gitignore`/`.gitattributes` dependencies. The actual public permission owner checks
applicable `read` and cross-surface `path_read` rules on every logical source path
and safe ancestor; a missing historical path retains its own lexical permission
check. Any applicable non-allow rejects the entire operation without publication,
not a silently filtered complete report. Unchanged or ignored denied paths also
reject conservatively. Symlink/special worktree sources and tree symlinks/submodules
are unsupported. Discovery is bounded to 4,096 worktree entries, 8,192 authorized
paths and 120,000 pathspec code units; exceeding these rejects rather than truncating
authorization. This may reject large repositories, even with otherwise valid grants.

Content-capable Git commands bind to paired top-level literal include and literal
trailing-slash exclusion pathspecs from that inventory. The exclusion prevents a
file replaced by a directory from widening into new descendants. No caller pathspec
is accepted; repository-generated option/control/magic-looking names remain data.
Rename detection is disabled: renames appear as deletion plus addition, with both
old and new paths authorized via index/HEAD/base inventories. Newly indexed names
inserted after discovery cannot enter the bound diff; a later inventory can reject
them before inspection. The source set is rechecked after awaited Git authorization,
before each spawn and before publication, including final synchronous store checks.
Untracked discovery is likewise restricted to inventoried worktree files. A new file
appearing after inventory may be absent from that sample, never silently a new
content-read operand. This is still non-atomic sampling, not protection against
external same-UID swaps between synchronous checks and OS pathname resolution.
Git's administrative object/index/config reads (including `.git/info/attributes`)
are **not** individually authorized as source blobs; ordinary global/include
configuration can still be read internally.
The boundary is logical project source inspection, not all transitive OS reads.

Each tracked lane performs names, shortstat and transient binary-patch digest reads.
**Raw patches and secret/source contents are never persisted or returned**. Untracked
fingerprints use name/size/mtime/mode, lstat without following symlinks, first 512
entries only; same-size/same-mtime metadata changes are a known blind spot.
Omitted paths make verdicts conservative. The two consecutive freshness samples
also compare HEAD, branch, selected base and all lane fingerprints. This remains
sampling, not atomic snapshot proof: concurrent changes after sampling remain
possible. Refs/base/HEAD changes invalidate candidates; stale records remain history.

One Git child at a time; per-command 2 MiB combined output and 30-second deadline,
whole operation 90 seconds. Cancellation/revocation terminates **owned** children
and waits for close/reap before rejection; no publication follows. No unrelated
process is killed. Administrative walk and source metadata are bounded. These
ceilings are not a product RAM acceptance claim.

## Private publication

`lib/evidence/store.ts` locally adapts the proven Goal transaction pattern without
importing Goal internals or refactoring shared transactions. Private files require
owned regular type, nlink 1, 0600, bounded lossless UTF-8 (2 MiB state); directories
0700 and canonical safe ancestors. Reads never create. A bounded per-root queue
enters explicit authorization, exclusive owned cross-process lock (no auto-stale
steal), fresh read and whole-envelope digest CAS. Monotonic envelope sequence
survives clear and prevents absent/create/clear ABA and collect-vs-record races.

The temp's original FD stays held across final awaited authorization. Afterwards,
authority/configuration, parent **inode/device identity** (including same-mode
substitution), target descriptor/path identity, lock token/inode, temp type/nlink/
mode/owner and exact serialized bytes are rechecked. Final synchronous validation
and rename have no JS await; directory fsync follows. Cleanup removes only owned
inodes/tokens, never foreign replacements. Public pathname APIs retain a residual
external same-UID race; post-rename directory-fsync failure cannot undo publication.
This is cooperative integrity, not same-UID tamper containment or cross-owner atomicity.

## Offline evidence and deferred gates

`node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/evidence-*.test.ts` exercises the first child-root
falsifier, original executable differential (normalizing host IDs/time and declared
native wording only), four lanes, content/HEAD/base changes, record/stale bounds,
secret non-persistence, whole-envelope/two-process races and local private-FD
adversarial patterns including same-mode parent replacement. Real owned Git
cancellation/revocation/overflow tests observe PIDs and check reap.

Root `pnpm check` includes `check-public-sdk.mjs`, which runs
`lib/guards/test/evidence-patch-test.mjs` and its `evidence-test.mjs` fixture
against copied patched and old public permission owners. Actual public SDK/Faux
direct+nested+hook-free dispatch covers exact grant negatives/provenance, real
Git/helper controls, UI/CAS/navigation and unchanged raw text/images/Core, with
zero external inference. Run `pnpm check` then `pnpm check:format` serially; no
Mods command or checkout is a prerequisite, and no duplicate SDK run is needed.
Earlier adapter receipts under ignored `.agent-state/runtime/evidence-port/`
retain dated provenance only; current candidate receipts use unique
`.agent-state/runtime/candidate-isolation/required-sdk-*/` directories. Source tests do not establish installed/live readiness, daily
human acceptance, provider behavior, linked-worktree support or full Letta parity.
Fresh independent QA remains a separate gate.
