# Pi integrations and ownership

## Native ownership and one-install repair — source, 2026-10-20

This repository is the sole authoring owner of every Pi-specific implementation: `lib/guards/` owns the native bridge, narrow app ABIs, provenance and pure secret/commit guard ports; root `patches/`, workspace, lock and package manifest own the declared public dependency contracts. No Mods checkout is a runtime/build/bootstrap/test prerequisite. Its original Letta entries and historical Pi adapter remain unchanged; their cleanup or activation is separate scope. Dated deployment/provider/QA records below retain their original owners and evidence dates, not current source instructions.

**Current source:** actual `package.json` is guards-first12: bootstrap, one Root native guard, preserved ten features. Disposable candidate declarations mirror this graph. `pnpm install:profile` composes pinned public permission/subagents packages, the three owned system roles and narrow feature DATA authority once with explicit consent; see [`bootstrap.md`](bootstrap.md). Ordinary canonical projects require no whitelist/config. Goal/Evidence/UX/Run state remains separate by project, private and CAS-protected; empty reads create nothing. Main shares relevant managed knowledge across canonical projects; actual workers and retained v1 views remain scoped. A new root gets only a neutral scaffold through guarded native SDK/Faux, never a private corpus import; an existing migrated root/config/ledger/Core is preserved. Future project/import filtering has no OneDee-only ban; old quarantine/forget history is not restored.

**Dated runtime evidence, not new activation:** the separately approved 2026-10-20 private cutover used Root public packages and one explicit Root guard, bootstrap first, plus the optional worker resource. Earlier installed-root repair, migration and its 318-asset preservation are retained historical evidence. This source repair does not apply/reload the actual profile or claim its cached process adopted new behavior. Public policy remains the sole resolver; public subagents remains the sole child runner. The previous recall/reflection errors and rejected nohup launch have no newly established live root cause. In particular, the rejected controller was never armed and is not retried through another channel.

### RTK resolver and Saved Models retirement — 2026-10-20

Saved Model Profiles is **RETIRED/removed by the current human decision on 20 October 2026**. No packaged Models extension, library, command, tools, guard ABI or provenance allowance remains. Native `/model`, public native registry/auth, model defaults and personal roles are unchanged. Frozen Letta originals/provenance remain dated historical references only; they are not executable compatibility stubs. This source retirement does not edit the live profile or claim its cached runtime has reloaded.

`lib/rtk.ts` owns `/mh-rtk` and `mh_rtk`; `lib/rtk-state.ts` owns only RTK's private binding and CAS publication. Storage is `<profile>/preferences/rtk/state.json`. One-install grants `rtk_state_data_<sha256(canonical-rtk-root)>` and named `mh_rtk`, and installs an absent-state `default.json` of rewrite-rtk. Existing explicit off wins. Optional legacy config remains validated/CAS-bound, not a project whitelist. Primary SessionManager/provenance/generation and exact named tool/data authority gate mode control; normal native children may read installed execution policy under their own public original/candidate/final Bash decisions, never mutate primary mode. Explicit legacy leaf/tool/path denials remain effective. Memory/Core/C1 grants cannot substitute. Private preferences/data directories remain0700/files0600, while safe standard host profile parents may be0755. Canonical separation, unsafe ancestors, symlink/hardlink rejection, closed JSON and CAS remain mandatory. Startup grants nothing; no automatic repair/force unlock exists.

Modes are off/suggest/rewrite-safe/rewrite-rtk. `mode <mode> <sequence>` requires the exact fresh sequence, existing capability, actual public RPC/TUI confirmation and fresh post-await session/config/authority checks. Off's execution fast path touches no RTK filesystem, helper, permission collaborator or log. Authorized startup may read-only restore installed/default mode; only the explicit installer selects the absent-state default, never resource loading. Suggest previews the real helper but executes the guarded original. Rewrite-safe keeps a separate conservative grammar (git status/diff and ls, with operand read-denial checks). **Rewrite-rtk uses the installed `rtk rewrite` resolver**, not that grammar: Node `execFile("rtk", ["rewrite", "--", original])`, `shell: false`, `ctx.cwd` and the operation abort signal. Direct `git commit` remains native/raw after host sanitization and never reaches the helper. No skip-permission environment flags or late tool hook are used.

The resolver bounds input to 4096 UTF-8 bytes, stdout/stderr each to 16384 bytes, duration to 1500 ms with SIGKILL, and concurrent helpers to four. Output is a nonempty UTF-8 single command line (one trailing newline allowed); embedded controls/multiline/invalid output is rejected. Exit **0** proposes a candidate; **3** proposes a candidate requiring host approval, never an RTK grant; **1** means unchanged; **2** blocks execution regardless of stdout/stderr (its message is never executable). Unavailable binary, unknown exit, timeout, oversize and malformed output preserve the guarded original. Partial stdout and all stderr are never candidates. Abort, stale epoch/session/binding/config/CAS or lost authority fail closed after awaits. Quotes, pipelines, npm/cargo and mixed chains such as `pnpm test && rtk git status --short` are not restricted by a hidden local DSL; the host still decides whether they are allowed.

The native factory wrapper checks the original public Bash policy and original secret/attribution guards **before** any helper. RTK checks the sanitized original policy, proposed candidate policy, final sanitizer/secret/attribution transform, then all original/proposed/final permissions again before actual native spawn; the wrapper also checks final public Bash policy. Final RTK read/proxy/nested wrapper projections cannot hide sensitive reads or environment dumps. Direct, nested and hook-free dispatch use this same final boundary, not an event-only rewrite. Helper exit 0 or 3 never substitutes for policy or UI authority.

`status`, `doctor`, `guidance`, `gain` and `projects` report configured/current-generation state and resolver bounds, not binary/version availability or RTK history. Explicit `rewrite <command>` uses the same real resolver after original host authorization, reports its outcome with `executed: false` and `hostApprovalRequired: true`, and never executes the candidate. `log` exposes only at most 20 in-memory action/command-hash records, no raw command history or RTK database. Savings stay unverified; native usage/quota, Letta settings, RTK global hooks and history DBs remain untouched. Required source and actual SDK fixtures use owned fake executable transports, not live RTK/profile probes. Main owns separately approved setup, reload and runtime acceptance after independent QA.

Required verification is canonical `pnpm check` then `pnpm check:format` serially. `pnpm check` already includes Root-owned `check-public-sdk.mjs`; no duplicate SDK run is needed. With no installed dev SDK, explicitly supply reviewed public package copies via `MAHIRO_PI_TEST_MODULES`; there is no runtime harvesting or Mods fallback. The required suite executes Root-only CLI preview and actual public SDK/Faux tools with no Mods sibling. Frozen dated test-only Letta oracles retain source hashes under `test/oracles/letta/`; they are neither runtime entries nor a second owner. Source QA is not independent final QA, live activation, human/RAM acceptance, full typechecking or full Letta parity.

## Pi worker activity — explicit optional metadata resource

`extensions/mahiro-worker-activity.ts` and `lib/worker-activity.ts` remain outside
the actual guards-first12 graph and its disposable mirror. The owned public-SDK fixture adds a thirteenth
resource; the separately approved 2026-10-20 private runtime now explicitly adds
this same worker resource alongside bootstrap-first Root guard/public owners.
Neither installation nor source startup provisions that profile automatically.
The separate Herdr consumer owner and bounded live evidence are described below;
rendered all-Space and human/daily/RAM acceptance remain separate.

The producer requires public `ctx.mode === "tui"` and a validated inherited Herdr
binding before accessing its separate process-global owner, timers, service or
CLI. Embedded native non-TUI children sharing PID/environment cannot dispose or
replace Main's owner. Public namespace import plus a `typeof` capability check
supports installed V1 lacking `getSubagentsServiceForSession`: missing/unavailable
metadata clears owned tokens rather than publishing a false zero. Lookup uses
only the exact `ctx.sessionManager` object after the owner factory's public
`session_start`; no global getter, guard parent fallback or identifier matching.
The captured service is rechecked on polls and after the foreground check await;
a replacement permanently invalidates that producer rather than being adopted.
Same-manager navigation can retain its service; running-child navigation has not
been established by this fixture.

The wire is one complete atomic token patch with source `mahiro:pi-workers`,
agent `pi`, and a separate monotonic process-global sequence/generation owner:

| Flat pane token | Value |
| --- | --- |
| `mahiro_pi_workers_schema` | exact string `1` |
| `mahiro_pi_workers_running` | canonical decimal string 0–256 |
| `mahiro_pi_workers_queued` | canonical decimal string 0–256 |
| `mahiro_pi_workers_owner` | fresh opaque generation UUID (not a job/session ID) |

Only actual public `listAgents()` arrays of at most 256 records are accepted.
Every record must have a recognized status: queued/running count; completed,
aborted, stopped and error do not. Missing/malformed/oversized whole snapshots
are unavailable, never clamped or fabricated as zero. No prompt, description,
role, model, usage, result, transcript or identity is published. Main's idle state
is independent of positive worker counts. This is display metadata, not execution,
completion, voice, Halo, task-board or Goal truth.

The owned full patch refreshes changed counts on bounded 1-second snapshot polls,
with a 10-second unchanged heartbeat and 30-second TTL. A single publication job
coalesces latest counts; failures back off exponentially from 1 to 10 seconds.
The existing unchanged public transport uses bounded argv-only exec, a 1500ms
command timeout and 256KiB output limit. Every publish and clear first checks the
exact bound pane and actual foreground PID using `pane process-info`; there is no
focus/cwd/socket inference. Disposal/unknown/lost-service clears only these four
tokens; cancellation, lost foreground, replacement or transport failure can leave
TTL expiry as the fallback. Separate generation checks block stale callbacks and
old clears after reload. Footer/status metadata and its owner remain unchanged.

The separate consumer source is owned by `mahiro-herdr/src/agent-renderer.mjs`,
with its contract in that repository's `docs/integration.md`. It reads only flat
`pane.tokens` on exact `pane.agent === "pi"`, requiring schema `1`, both canonical
count strings with individual and combined bounds of 256, and a lowercase grouped
36-character hexadecimal owner UUID. Current native inventory owns token expiry;
there is no wire timestamp or consumer freshness clock. Missing, cleared,
expired/omitted or invalid tuples leave the original display unchanged. Flattened
tokens establish compatibility, not cryptographic source provenance.

The working overlay is derived display only when raw Main is idle/done:
blocked/unknown attention wins, and raw status, completionSeq and heldDone remain
unchanged. Worker end cannot create completion. Existing one-row 16-token/glyph/
layout/header nativeName ownership stays Herdr's. The registered Herdr plugin
uses its enabled source checkout, so approved source edits may affect normal
future invocations; an existing daemon may still hold old code. This source contract alone implies no restart or activation. The separately
approved runtime operation restarted the owned updater and loaded the Pi producer
with a fresh exact-session process; no native Space highlight/lifecycle mutation
or human acceptance is implied.

Unit TUI contexts and fake transport are not rendered native TUI proof. The required
public SDK gate separately exercises real package factories, InMemory credentials,
Faux offline automatic children, exact different SessionManager bindings, global
child rebind without scoped parent drift, and actual idle-parent queued/running
and terminal snapshots. Actual SDK children in this fixture use print mode; RPC
inherited-environment isolation is separately falsified by unit fixtures. No live
provider, browser, Herdr CLI, all-Space visual or RAM acceptance is implied by that
fixture.

Dated live observation, 2026-10-20: after the approved single-owner Root cutover,
actual native subagent dispatch succeeded. An independent child observed three
samples with Main raw `done`, one running child and changing published Space
spinner tokens, retaining the same parent generation despite child factory load.
A separate bounded observer then recorded `0/0` after child termination, the same
native completion receipt, and restoration of the native Done glyph before the
next Main run's normal working display. No raw lifecycle/status was injected.
These are genuine TUI-producer/public-Herdr transport and resolved token observations,
not screenshots, backend busy flags, all-Space or human/RAM acceptance. Local ignored
receipts live under `.agent-state/runtime/herdr-worker-activity/runtime-activation/`;
source-only QA and the failed first controller remain preserved, not relabeled.

## Native Execution Run — source-only sixth ALL-Mods slice

The tenth feature (twelfth guard-inclusive resource),
`extensions/mahiro-execution-run.ts`, appends one `mh_execution_run`
get/create/update tool and `/mh-run` after the accepted nine features in
unchanged order. [`execution-run.md`](execution-run.md) owns the bounded native
metadata FSM, private persistent state/CAS, exact canonical tool/root authority,
public-UI-confirmed exact-target abandon/terminal clear and explicit session-ref
adaptation. Ordinary canonical bindings need no project config after explicit installation; empty reads create nothing. Runs are optional coordination metadata, not a
competing task board: live TSK owns tasks/outcomes/evidence/human acceptance.
No executor, artifact reader, worker discovery, Goal/UX/Evidence mutation or intake
collection is added. The original Letta model and accepted owners stay frozen.
Existing bootstrap recursive binding needs no new subsystem; isolated SDK/Faux
fixtures reuse the source owner patch without installation. Source-only evidence
is not live activation, independent final QA, human/RAM acceptance or full parity.

## Native UX Workflow — source-only fifth ALL-Mods slice

The ninth feature (eleventh guard-inclusive resource),
`extensions/mahiro-ux-workflow.ts`, appends exactly
`mh_get_ux_workflow`, `mh_create_ux_workflow`, `mh_update_ux_workflow` and `/mh-ux`
after the accepted eight features in unchanged order. [`ux-workflow.md`](ux-workflow.md)
owns its bounded metadata FSM, optional research, opaque references, public UI
human direction/review/reopen/clear gates and native private CAS/tickets. This is
not a design/research engine, artifact reader, Goal/Evidence mutation or executor.

Canonical projects require no private feature config after one explicit installation. Root-owned native guards expose only the narrow `uxWorkflow` version-1 ABI, requiring the actual
public owner's exact invoked-tool and exact hashed UX-state-root winning surfaces,
canonical provenance/current primary manager/generation and applicable path denies.
The existing source patch is reused in isolated fixtures, not installed. New
sessions never attach a sole workflow; navigation invalidates pending tickets but
does not rewind state. No moves or force unlock are added. Resource startup grants
nothing; explicit profile installation reuses bootstrap's shared `featureData`
composition, not a separate UX installer. Source/offline SDK evidence is not live activation, independent QA,
visual/human/RAM acceptance or complete ALL-Mods/Letta parity. The separate
Execution Run source slice is above; existing bootstrap recursive source binding
needs no UX-specific option.

## Native Code Evidence — source-only fourth ALL-Mods slice

The eighth feature (tenth guard-inclusive resource),
`extensions/mahiro-code-evidence.ts`, appends `mh_code_evidence` and
`/mh-evidence` after the accepted seven features. It collects four
bounded Git lanes, persists native profile/project/session reports with private
whole-envelope CAS, and records descriptive external-check metadata. It never runs
caller command strings, mutates Goal state or injects automatic reminders.
[`evidence.md`](evidence.md) owns configuration, exact tool/root permission ABI,
Git fixed-argv/config-execution boundary, conservative freshness, confirmed clear,
private FD integrity and unsupported storage/fork limits. Canonical empty reads require no per-project config;
owned native SDK fixtures may compose fixture grants, but do not install or
activate the real profile or establish human acceptance.

## Native Goal — source-only third ALL-Mods slice

The seventh feature (ninth guard-inclusive resource) is
`extensions/mahiro-goal.ts`, after the existing six features without changing
managed-memory/C1 ordering. [`goal.md`](goal.md) owns the
native schema, four model-callable tools, confirmed human commands, scoped private
persistence/CAS and bounded subordinate reminder. Native profile/project/session
identity deliberately adapts Letta's agent/conversation schema; no old state is
imported. Missing config is supported, startup initializes nothing, and new sessions
need an explicit same-profile/project move into an empty destination.

Root-owned `lib/guards/index.ts` owns the narrow version-1 Goal ABI. Exact tool and canonical feature DATA namespace decisions (or retained legacy
leaf grants) require actual `matchedSurface` attestation; explicit legacy
leaf/tool/path denials remain effective; memory/C1 capabilities, wildcard winners, yolo-only and old owners
deny. The existing source patch is reused, **not installed**. Human clear and all
command mutations require public UI confirmation, while ordinary model updates
and audited completion do not acquire universal approval. Request guidance is not
mechanical requester authentication. Conservative parentSession/native-child
exclusion also limits human forks. No role/model, footer, busy panel or Herdr
surface is added; the separate Execution Run and UX source ports are above. The separately scoped
Code Evidence source port is described above and never mutates Goal.

`pnpm goal:preview --project /canonical/project [--agent-dir /private/profile]`
prints validated source configuration only; no apply/grant/import/Goal creation
exists in that command. Source approval and offline patched-owner SDK/Faux tests
are not runtime configuration, dependency installation, live activation, independent
final QA or human acceptance. Original failed PNG/teardown evidence is retained;
QA isolated invalid IDAT CRC and the permission-owner UI shutdown poller. The
corrected fixture keeps strict preservation assertions and uses public shutdown.
Temporary-file integrity is checked after final awaited authorization, with owned
FD/inode/metadata/bytes and identity-only cleanup. Public pathname rename retains
an external same-UID race; this is not an adversarial sandbox.

## Code Map — source-only second ALL-Mods slice

**Source-only owner patch; not live activation:** independent QA found that
unpatched permission-system 40.2.2 discards the winning rule surface: `toolName`
is the query name, and `source: tool` includes `mh_*` / `mh_code_*`. The temporary
safe quarantine is superseded in source by an approved versioned owner patch.
It exposes optional public `matchedSurface` from the actual winning rule. The
restored adapter assertion requires exact `mh_code_map` attestation. An old service without winning-surface metadata still fails closed; current
phase preservation does not negate the earlier installed-root offline repair;
no install, grant or profile reload is implied by isolated source-fixture success.

The Pi package's sixth feature (eighth guard-inclusive manifest resource) is
`./extensions/mahiro-code-map.ts`, after the two guards and original five features
in unchanged feature order (managed memory before C1, accepted utilities fifth). The native owner is
`lib/code-map.ts`; canonical `mods/mods/mahiro-code-map.ts` remains unchanged for
Letta. This source slice does not activate a running profile or complete ALL-Mods.

`mh_code_map` formats caller metadata for `semantic`, `exact` and `outline`
intents, using `ctx.cwd` only as host workspace metadata unless a workspace was
provided. It does not resolve that path. The original closed schema, trim/control/
bidi checks, list/string/line bounds, default 2 × 6000 read guidance, explicit
3–12 × 6000–20000 advisory guidance and 3000 JavaScript-code-unit text cap are
preserved. Navigation includes omission counts and angle-bracket escaping;
Goal criterion / Code Evidence references are opaque caller strings, not queries,
proof, state import or authority. The inherited 3000-code-unit fallback can omit
the not-proof trust boundary, Goal metadata-only suffix, Code Evidence section
and side-effect footer. Independent QA found byte-identical upstream behavior in
297 differential cases plus three saturated-intent cases. The large-read advisory
not-permission disclaimer survived those tested maxima; universal footer retention
is not claimed. The formatter is unchanged by the permission-owner repair.

The formatter, import and registration perform zero I/O. Tool execution makes
one deliberate exception: Root-owned provenance realpath/package checks and
its existing permission-service policy reads. It does not read workspace sources,
scan/index/search, generate outlines, spawn processes or inference, append session
entries, persist workflow state, create Goals/evidence or schedule reminders.
Native results contain bounded `content` and `details: undefined`, not raw input.
Parallel execution uses no per-call shared state. Native resource filtering is the
opt-out; no `.letta` sentinel, environment override or profile is consulted by Pi.

Root-owned native guards own the separately approved private runtime's Pi execution
boundary since 2026-10-20; the legacy guard is no longer registered. The restored
version-1 `codeMap.assertAccess` checks current canonical ToolInfo, actual native
SessionManager and healthy generation, then the existing public permission service.
Only `state: allow`, `source: tool`, non-yolo origin and `matchedSurface` exactly
`mh_code_map` pass. Missing/wrong-type/ambiguous metadata fails. Both family
wildcards fail even when an exact grant exists but the later wildcard won. An
already-allowing exact rule remains valid with yolo enabled because no ask-to-allow
rewrite supplied its authority; yolo-only/transformed asks remain invalid.

The authored owner patch adds optional metadata only, without changing decisions:
session/default/yolo rules retain their actual surfaces; restrictive composition
returns its winning result, and forwarded floor copies retain the base rule's
metadata while state/origin continue to describe the floor. Attestation alone
is never a grant. No external config parser or second policy service is added.
`trustedCodeMapTool` checks canonical Pi realroot, name/version 0.2.0 and the exact
declared entry/name. Independent bootstrap, secret/commit factories, C1 and managed
memory stay unchanged. No generic capability framework or unknown-tool allowlist
is introduced. A trusted extension can still alter process memory; this is not an
OS or hostile-extension sandbox.

`test/code-map.test.ts` checks pure behavior/bounds and no-guard execution failure.
Root `pnpm check` includes the required public SDK suite.
`lib/guards/test/permission-patch-test.mjs` stages the authored patch offline without installation,
compares real old/new engine decisions, checks public declarations and lock binding,
and runs the original positive `code-map-test.mjs` in an isolated sibling-layout
mirror. That actual public SDK/Faux fixture proves exact and later-exact success,
both family/later-family denials through assertion, hook-free definition.execute
and SDK direct/codemode nested dispatch, with existing provenance/context/revocation
negatives. Mirror roots are clearly fixture-canonical, not live configured roots;
foreign/copied/inline tools remain rejected under the same source algorithm.
`code-map-blocked-test.mjs` separately proves an old copied owner cannot
authorize even exact grants without attestation. This is a negative fixture, not
a diagnosis that today's installed root is unpatched; positive fixtures use the
isolated patched owner, without changing live grants or runtime loads.

Evidence and failed attempts remain under `.agent-state/runtime/code-map-port/`,
with new owner-patch evidence under `owner-patch/`. Lock metadata was generated by
pinned pnpm's offline lockfile-only mode in a disposable mirror, without installing
packages at that dated checkpoint. Those earlier fingerprint receipts do not
negate subsequent installed-root repair; current-phase preservation is separate. The owner
build toolchain is not shipped/installed here; the narrow public declaration patch
is kept consistent with the source type and checked explicitly, not claimed as a
full upstream declaration build. No live grant, reload, provider acceptance or
independent QA is inferred.

## Native utility port — source-only first ALL-Mods slice

`extensions/mahiro-native-utilities.ts` and `lib/native-utilities.ts` now own the
native `/realign [focus]` and user-run clock metadata utilities. The single new
resource is appended after the original four entries; managed memory still runs
before C1. The utility slice itself does not port Goal/state or complete ALL-Mods;
the separately scoped Goal source slice is described above.
No profile apply, reload, provider inference or live utility acceptance is implied.
The Letta source entries remain unchanged, independent owners on that host.

`/realign` accepts at most 500 JavaScript string code units before stripping C0/C1
controls and trimming. Focus is literal JSON data, never added authority. Generated
custom guidance asks for the actual prior correction, current authorized task and
canonical contract, native managed-memory discovery and a safe disconfirming probe;
it grants no writes, commits, repair, cancellation or context reset. It uses public
`pi.sendMessage` with `triggerTurn`, not `sendUserMessage`. One busy command may
wait at the public command idle boundary (additional commands are refused), then
rechecks session/generation before custom follow-up delivery. Reload/replacement,
shutdown and navigation invalidate retained waiting callbacks. Known child sessions
are rejected both before and after the idle wait, using the public session header
and current system prompt. The command does not **directly** cancel workers;
normal native memory/run lifecycle effects may still apply when guidance starts a
run. This is not a universal no-cancellation guarantee or a trusted-extension sandbox.

Ownership checks bind the actual public SessionManager object as well as its ID.
Shutdown and takeover permanently retire a factory: replayed starts cannot rearm
it, even with a new manager or colliding session ID. Only active sessions are held
in the ownership registry; shutdown removes their entries and known child starts
are excluded. No per-session tombstones accumulate. Replacement retires only the
prior owner of the same ID, never an unrelated parent.

**SDK 1.3 composition limitation:** reusing the exact already-loaded
`DefaultResourceLoader` through successive `createAgentSession` calls inside
`createAgentSessionRuntime` is unsupported for these utilities after shutdown.
The SDK retires that factory's public `ExtensionAPI`: both `getFlag` and
`sendMessage` reject access as stale even though lifecycle handlers are replayed.
A replayed start therefore fails closed without claiming a reactivation. Use a
fresh loader/reload before constructing the next session, as the stock composition
does. Fresh-loader new/switch sessions work; this is not a whole-TUI regression.
A fresh factory is required after shutdown even if a mock API remains callable;
retained old contexts and replaced factories cannot take ownership.

Clock metadata is a separate hidden custom `before_agent_start` message, not a
prefix or rewrite of the original user text, attachments, system prompt or Core.
It reports the **host/runtime clock at agent run start**, not receipt/keypress time,
authenticated human identity, or permission. Formatting retains the original OS
local zone/locale behavior (Bangkok only when the host uses it), not a fixed zone.
Only matching fresh interactive/RPC input observed by the public input hook can
qualify. Custom/extension-origin and synthetic reminder/old timestamp wrappers,
slash commands, changed/expanded prompts, known parent-linked/active-agent children
and the managed-writer replacement prompt are conservatively skipped. Unknown
third-party wrappers are not universally authenticated or detected. Up to sixteen
in-memory candidates are retained; overflow drops the oldest. Nothing is added to
original user content or persisted as observed-human evidence by this utility.

Native opt-outs are `--mahiro-user-timestamps-disable` and
`--mahiro-realign-disable` boolean flags, or exclusion of this utility resource.
They replace the old Letta disable-sentinel behavior: no `.letta` state, old path
overrides, disable files or global configuration are read/written or provisioned.
Disabling one utility leaves the other available. No new model-callable tool or
guard allowlist/policy exception is introduced.

Direct fixtures cover bounds, literal focus, custom kind, busy/stale delivery,
OS-zone clock, input/attachment/Core immutability, skip/disposal and disable paths.
The existing disposable bootstrap **native SDK/Faux** fixture additionally checks
clock plus managed projection coexistence, unchanged native user bytes/count,
custom `/realign` without an added user entry, unchanged Core and native writer
clock omission. A separate native SDK/Faux regression checks fresh-loader new/switch,
child realign exclusion and the exact reused-loader public-API retirement boundary.
Direct regressions also check child gating after an idle wait, manager identity,
old-context rejection and replaced-factory non-reactivation. Original independent
QA repro files/logs remain unchanged under ignored runtime evidence.
This is deterministic zero-external-inference evidence, not real
provider learning, full automatic C1/managed scheduling coverage, independent QA,
human acceptance or proof of the currently running profile. Fresh QA remains Main-owned.

## Managed agent memory — approved memory cutover, 2026-10-19

This dated memory activation is distinct from the still-pending Root guard cutover.
The private maintained root remains the knowledge owner; the new candidate does
not establish a replacement live guard deployment.

At 15:29 Asia/Bangkok Mahiro explicitly approved reversible real-memory migration,
role registration and exact-root activation. Main seeded the previously absent
`~/.pi/agent/memory`: **271 maintained Markdown files / 3,702,585 bytes**, including
7,598-byte Core and 1,028-byte index, with forty canonical project mappings. The
import used initialization plus **forty** scoped integrations (41 recorded
revisions), ending at `437f7c650b37efa27b7a0f8f8ee75663f29724d3` before native learning.

All 281 source entries are accounted for: 280 original bodies have private
byte-identical backups; the protected OneDee reference body was not read,
hashed or copied. Ten historical/retired sources remain retained evidence, not
new procedures or current instructions. Twelve imported details have narrowly
reviewed public auth-prose/placeholder formatting adaptations; no real credential
was imported or encoded to evade the unchanged scanner. Complete detail, links,
persona, identity and all seven former native continuity facts survive. This is
an operator migration, not model learning or live cross-host synchronization.

Historical 2026-10-19 migration scope only; the later explicit installation/default-deny revocation contract is owned by [`bootstrap.md`](bootstrap.md#one-install-composition-historical-active10-hold-retired), not this retained receipt.

The new canonical managed writer is registered. Permission changes are exactly
the default root's hashed capability plus five named managed-memory tool allows;
deny-by-default, C1 authority and ordinary filesystem/external permissions remain
unchanged. One stale subagent-package exclusion was replaced with the exact
configured source. Model settings and all thirteen existing role files are
unchanged. The root is 0700 and maintained files are 0600; standard Git-internal
modes remain protected by that private root, not an OS/same-UID sandbox.

Two fresh actual SDK sessions with injected Faux transport first verified real
Core projection, shared detail reads and foreign-project denial, without external
inference. Only afterward, at 16:08, the 3,993-byte bootstrap was reduced to a
2,272-byte loader and root `automatic` explicitly enabled. The current and
previous 3,691-byte bootstrap snapshots remain retained. A post-cutover zero-
inference rerun additionally asserts unchanged managed episode names and C1
revision, closing the first receipt's weaker revision-only episode assertion.

Fresh independent inspection reconstructed all imported body adaptations and
links and verified minimal configuration/role deltas. The subsequent **real
default-provider transaction passed** on native OpenAI `gpt-6.1-sol` / medium,
with ordinary OAuth refresh, no credential copy and no provider registration.
Primary sessions exposed only `agent_memory_read`: Main could neither edit nor
call reflection explicitly. A qualifying observed RPC input automatically started
the locked managed writer; it completed seventeen tool uses and published changes
to the project migration detail, new activation checkpoint and index. No C1
reflector claimed that transaction's slot. This proves one bounded real automatic
coexistence case, not every busy/error scheduling state.

The baseline correctly lacked the new approval time. A fresh primary session
then recovered 15:29 and distinguished the unverified operator relay from
authenticated-human identity or a new permission grant. Core remained identical.
The resulting maintained root has **272 files / 3,679,035 bytes**, at revision
`42c8df2a616686f1a90a44fa448c5b1a3295b30f`. Independent semantic review found no
concrete load-bearing loss in the migration-note consolidation; removed material
was superseded chronology, duplicated lessons and transient evidence, with raw
originals retained. This is maintained knowledge, not append-only archival text.

The post-cutover Faux probe explicitly measured no managed episodes and C1
revision zero before/after; following the real transaction C1 still has revision
zero, no accepted quoted facts and no forget/correction controls. Its screened
historical store was not migrated into maintained memory. Real controlled-process
peak RSS was 282,096 KiB (about 275 MiB), versus 263,408 KiB for the post-cutover
Faux probe; neither measurement establishes daily product RAM acceptance.
Final serial `pnpm check`: **136 passed / 3 opt-in stress cases skipped**; touched
code/manifest formatting and whitespace checks passed. Earlier explicit stress
runs remain their own evidence, not this real-provider transaction.

The controlled SDK sessions loaded the critical memory/guard/subagent packages
with unrelated skills, themes and MCP disabled; they are not full interactive-app
or complete personal-roster proof. These checks do not reload or prove the module/environment state of an
already-running user Pi process. No matching native Pi CLI process was found at
closeout; no user process was killed, moved or restarted.
Human daily-primary/RAM acceptance and T190 completion remain open. No push or
release was authorized by the migration.

Private originals, plans, receipts and rollback instructions live under the
ignored `.agent-state/runtime/managed-memory-migration-20261019/`. Restore only
the exact backed-up profile fields/bootstrap and unchanged added role after
stopping owned sessions; retain or rename the new root rather than deleting
unique learned revisions. Never roll back over concurrent user edits.

### Historical implementation/provider/capacity lanes — before real cutover

The managed-memory extension implements one private Markdown/Git knowledge owner:
Core/persona/preferences/methods, index discovery, shared global detailed knowledge,
scoped deferred knowledge and
procedural files. Main's read/edit/remove/commit tools and an isolated native writer
converge on that owner. Configured automatic reflection captures bounded observed
input, assistant action and selected local-check results, not merely literal user
quotes. Native workers integrate nonconflicting files after successful completion;
conflicts, source-linked forget controls, CAS, cancellation/revocation and rollback
are covered by focused fixtures. Full details and activation gates belong to
`docs/agent-memory.md`, not the historical quote-controller paragraphs below.

The canonical Mods adapter owns a **separate** exact-root managed-memory capability
and native child-session/service-outputFile binding. Existing C1 or read grants do
not authorize Core writing. The new system role is `managed-memory-writer`; the
old no-tool quote reflector and its deployed permission remain unchanged. Package
registration does not register the new role, create a root, migrate bootstrap or
grant authority. At that source/fixture checkpoint the real 3993-byte curated
Core and corpus had not been migrated;
no credentials were copied or authentication/profile settings manually changed.
The native-provider proof below can perform ordinary OAuth refresh; this is not
a blanket auth-byte or whole-profile invariance claim.

The owned SDK 1.3.0 fixture exercises actual native public tool/subagent dispatch
with injected Faux transport and no external provider inference. It verifies
separate grants, outputFile/session identity binding, a real Markdown draft→Git
integration, changed Core in the next request and a fresh SDK session, revocation
and project isolation. It exposed native replace-mode portable-parent-preamble
inheritance; the public before_agent_start whole-worker-prompt replacement closes
that concrete counterexample. These synthetic runtime receipts are **not** live
provider learning, default deployment or independent acceptance.

On 2026-10-19, fresh independent QA exposed project-management scope and ledger
capacity/publication defects. The repairs use ledger V2 scoped/global source
tombstones and complete pre-publication validation. Independent counterexample
reruns verify cross-project preservation, own-source non-revival and unchanged
readable files/index/HEAD on overflow; a fresh native SDK/Faux probe also passed.
V1 managed ledgers fail closed; no real managed root existed and C1 is unchanged.

The subsequent actual default-provider proof used native OpenAI `gpt-6.1-sol` /
medium with no model/thinking flags, credential copy or fake HOME. Main committed
a corrected project policy; a completed native background writer revised it in
private deferred knowledge and added a generic procedure. A new session read that
file and answered 51 to the identical query whose pre-learning answer was 45.2;
51 was not stored as an answer. Independent receipt review supports this narrow
loop. Seven source/package hashes and the real bootstrap/settings hashes were
unchanged; normal native OAuth refresh is not auth-byte invariance.

The failed auth/resource and project-role-discovery attempts remain dated in
ignored local receipts, not successes. Live fixtures must keep the real agent
directory, use project-scoped resources and align the owned CLI process cwd;
the full contract documents the public API reasons. This is controlled provider
evidence, not a perfectly configuration-matched experiment or complete automatic
learning proof. Real-root/bootstrap/role/permission activation was still pending
at that checkpoint; the later cutover is above. Mahiro's daily-companion acceptance
remains pending and T190 remains active.

A subsequent **synthetic, zero-provider capacity lane** raises only explicit
configured ceilings to 512 maintained files (including Core/index), 256 KiB per
shared/deferred/procedural detail and 8 MiB total; defaults and Core/index maxima
are unchanged. A 40-MiB serialized private-view ceiling covers both base/proposed
copies with reader-equivalent preflight before writes. Retention uses lightweight
summaries and one selected body at a time; conflicts are not silently reclaimed.
Bounded Git-object batches preserve the 15-second snapshot/10-second command limits.
The 281-file / 3,607,826-byte synthetic inventory shape and the full envelope pass
publication/hash-preserving restart, correction, rollback and conflict recovery.
A 64-serialized-proposal retention stress passes inspection, refusal and explicit cleanup;
peak process RSS is substantial (up to 1,477,648 KiB in the selected default-V8 run),
not a hard runtime guarantee. Independent 131072-byte ledger capacity still limits
metadata combinations. Main also closed the truncated-proposal recovery gap:
management conflict selection supports complete Unicode paging and full hashes;
independent registered-tool reconstruction, current-CAS publication, scope,
revocation and forgotten-data counterchecks pass. Exact commands, measurements, bounds and
unsupported combinations are documented in the managed-memory contract. These
checks do not replay the earlier provider proof against the changed source, copy
real content, activate the default managed root or satisfy daily-companion acceptance.
Fresh independent QA and current native SDK/Faux dispatch passed. That native smoke
uses zero external inference and does not specifically exercise conflict paging;
registered-tool execution and native-wrapper passthrough evidence cover its args.
Neither stress nor QA proves acceptable steady-state product RAM or 64 complete
physical draft trees. Those results did not establish real migration or default
activation; the separate cutover is above. Human acceptance remains open.

## Memory/history expansion — 2026-10-18

T190 includes the existing Letta memory corpus, historical recall, reflection and
agent-owned fresh Letta/Pi project comparisons. Mahiro requested these checks
before switching, rather than waiting for his daily trial. At the 2026-10-18
checkpoint daily continuity used native `~/.pi/agent/AGENTS.md` plus the corpus at
`~/.pi/agent/continuity`. Main explicitly curated the existing primary persona and
seven confirmed human decisions into native context: the file is 3,993 bytes,
with 1,456 bytes of retained facts under the 4 KiB editorial budget. This is an
operator Core migration, not an automatic persona rewrite. The separate default-root
quoted-note learning controller was enabled as described below. A fresh native default session
recalled all seven decisions without tools. After human native reauthentication,
`pi-defaults-20261018T203418` also verified the primary Mahiro Code identity and
existing work/safety boundaries without tools or model/thinking/root overrides.
Actual provider-request metadata remains OpenAI `gpt-6.1-sol` / medium; settings,
archive and native context were unchanged during that successful case. The one
private snapshot preserves the previous context.
The dated 2026-10-17 baseline below is historical deployment evidence, not the
complete current migration target.

The owned read-only recall/continuity extension is now the package's fourth
registered entry, after managed memory. Public SDK 1.3.0 preserves manifest order
and awaits settled handlers: qualifying managed automatic writing gets the shared
native service first; C1 defers while it is running. When managed automatic writing
does not start, C1 retains its legacy behavior. C1 authority, history, recall and
forget controls remain intact. This source-order fix and its manifest regression
alone are not real-default automatic coexistence evidence; the later actual
native transaction in the current cutover section supplies that bounded proof.
Independent canonical guard ABI/tool-identity verification and the actual
relative-reference regression passed after canonical SDK `baseDir` resolution was
fixed; that source-alias fix is separate from policy activation. Global policy
allows `recall_search` and `recall_read`, plus exactly the default data directory
and its slash-delimited descendants under native `external_directory_read`.
Default `*` denial, generic external-directory/write rules and other tool
permissions remain unchanged. The canonical ABI now checks the actual recall
tool grant, native read permission, explicitly matched `path_read` restrictions
and directional external-read permission, while retaining provenance, lifecycle,
cancellation and secret checks. A bare external-directory grant was rejected:
the native family folds both directions and must not widen writes. Independent
offline SDK counterexamples verified native write/edit/classified shell writes
remain denied/non-auto-approved even when tool-level permissions allow them.
This read grant also permits otherwise-authorized generic read-only tools to
read the corpus; recall quote limits are not a universal filesystem boundary.
It does not activate background learning.

The private inert MD snapshot normalized 280 documents into 314 records; the
receipt identifies 13 redacted **documents**, not 13 secrets. The streamed legacy
history export read 12.27 GB and validated 615 conversation-start headers: 604
accepted origin entries, including one zero-record entry (603 nonempty), produced
68,806 normalized visible-only historical user/assistant records in 70 SHA-bound
shards totaling 71,622,202 bytes. Eleven whole conversations were withheld for
excluded-project markers; 87 missing-header origins were skipped. The 4,743
sensitive-or-uncertain rows are not a secret count. Fifty-seven unknown-CWD origins
(6,241 records) remain distinct unassigned scopes, never global. Conversation-start
CWD is not verified per-message CWD. Sampled maximum RSS was 554,441,152 bytes, not
a continuously measured peak; export code did not modify the original source.
Independent read-only metadata/schema/privacy-fixture and 70-shard validation
passed with these caveats. This is not semantic secret-free clearance, complete
coverage, native Pi provenance or cryptographic signatures.

The combined private inert trial root is recorded in
`.agent-state/runtime/letta-harness-study/combined-history-receipt.json`.
Its 75 files, totaling 75,457,833 bytes, were copied byte-identically into the
fixed default runtime root; the original trial/export authorities were preserved.
Files/directories retain private 600/700 modes. Deployment is recorded in
`.agent-state/runtime/letta-harness-study/default-corpus-deployment.json`.
Optional root-manifest `history: true` selects a fixed history subtree; unknown
fields and false history flags reject. Without the flag, the old fast path makes
no extra history IO. Runtime/scoped-reader integration passed 19 focused tests.
Every read requires canonical ABI authorization, private/symlink-safe paths and
pre-open bounds. Selected history is capped at 256 MiB; search returns at most
six hits, 1,024 bytes each and 6,144 bytes total. Recall-read quotes are capped at
2,048 bytes; the serialized runtime result is capped at 8,192 bytes. Snapshot and
root-manifest post-await checks prevent forgotten records, lifecycle changes or
scope remaps from reviving stale results. These are cooperative runtime guards,
not same-UID tamper containment.

Actual native OpenAI `gpt-6.1-sol` / medium provider-request metadata and autonomous
nested codemode `recall_search`/`recall_read` succeeded in a neutral `mahiro-skills`
memory quiz; the exact accepted MD citation was verified. Evidence is under
`.agent-state/runtime/letta-harness-study/fresh-session-pilot/pi-skills-policy-20261018T183211`.
A second-project `haabiz-ui` controlled record-ID anchor read a historical-user
`letta_message` record with its exact hash; its receipt is under the same pilot
parent in `pi-history-anchor-20261018T185947`. This second test is not a neutral
quiz or generalized cross-project parity. Defaults, accepted dataset and source
repositories were byte-identical at each test's time; raw provider streams were
not retained. Those historical preservation checks do not freeze today's defaults.

The deployed default was then verified without provider/model/thinking flags or
`MAHIRO_CONTINUITY_ROOT`: `pi-defaults-20261018T195453` repeated the neutral skills
question through native search/read and cited the exact accepted MD record;
`pi-defaults-20261018T200028` read the second-project historical-user ID and exact
hash. Both receipts are under the same pilot parent. Actual provider-request
metadata is OpenAI `gpt-6.1-sol` / medium. Settings, archive and target source
hashes remained identical during each case. The second case is still an ID
anchor, not a neutral second-project quiz. The skills answer supported a past
rejection but explicitly lacked its reason; do not report complete semantic
equivalence to Letta. Normal SDK-owned OAuth refresh remains native behavior;
the operator does not read, copy or substitute credentials. A diagnostic showed
that freezing the auth file in the test sandbox blocks that normal refresh;
that test-only restriction was removed, not the model/data/source write fences.
After removal, native authentication initially still failed before the provider callback
with zero input/output tokens. The exact credential/provider reason is not
established from the retained safe signatures. Main stopped model retries and
prepared native login with the human, without substituting another host's auth.
The visible `Pi · reauth` tab in Herdr's existing workspace is `wA9:t4`, pane
`wA9:p5`, with the expected cwd, OpenAI `gpt-6.1-sol` / medium and unchanged focus.
Opening the native provider menu alone was not login proof. Mahiro confirmed
login completed at 20:34; the subsequent actual default-provider identity case
above succeeded and cleared the authentication blocker. Earlier failures remain
dated diagnostic evidence, not a current auth failure. The dependency continuation
was approved at 20:37; the bounded native quoted-note transaction and activation below
subsequently cleared the technical reflection gate. Human daily-work acceptance remains pending.

On 2026-10-18 at 19:11 Bangkok time, Mahiro explicitly requested the Pi global
default `gpt-6.1-sol` / medium. Main changed only `defaultModel` and
`defaultThinkingLevel`, preserving OpenAI routing, the existing target thinking
override and other settings. At 19:13 a fresh `pi --mode rpc --no-session`, with no
model/thinking flags, reported that default through `get_state` without inference.
This is not a change to role definitions or Letta models.

The source now wires a fail-closed quoted-note controller. Mahiro approved the
bounded native dependency continuation at 20:37 on 2026-10-18. Deployment is now
**enabled for the configured default memory root**, after independent counterprobes,
the 99-test serial repository check, frozen patched dependency installation, role
registration and the real native transaction below. The explicit grant is the scalar
`continuity_learning_<SHA-256 of canonical root UTF-8 bytes>: allow`; the owned ABI's
`learningPermission(root)` supplies its exact name. Native arbitrary-tool surfaces do
not match a path-valued permission map, so an unscoped scalar or a path map is not
accepted. Generic/external write rules are unchanged; read grants are not write authority.
The controller requires healthy canonical ABI1 primary-session attribution, the
public initial-outcome-claim marker and an exact locked, no-tool reflector role.
It never uses foreground/queue bypass, private APIs, parent nudges or Core writes.

Only observed interactive/RPC input hooks can admit newly appended, unambiguous
native user entries. SDK/RPC root attribution is not verified human identity.
Attachments, transformed inputs, imported DTOs, assistant/tool rows and old resume
history cannot establish observation. Final successful native settlement starts
at most one claimed background batch, with a 120-second deadline, two-turn cap,
16 KiB source and 8 KiB/eight-note closed JSON result bounds. Parent validation
confirms literal observed-source quotes only: notes remain UNTRUSTED low-authority
historical evidence, never durable human preferences. Permission, immutable source,
branch ancestry, generation, root mapping, lease and store snapshot checks precede
publication. Failure does not advance the review cursor; source ingestion may
already have persisted the observed native user record. Imported rows are skipped
by archive ordinal without being promoted to observed evidence. Capped, still-attested
remainders remain eligible before new inputs on the next qualifying turn; no idle
drain loop runs. New foreground input cancels only the owned worker, not its observation.

`/memory-status`, `/memory-forget <noteId>` and
`/memory-correct <noteId> <retainedRecordId> <literal quote>` require current-project
mapping and explicit learning permission. Correction uses an existing source, not
a synthetic slash-command user record. Forgetting suppresses active notes/source
reads; original historical archives and old generation files are not erased.
Latest new/corrected notes receive bounded context visibility. No semantic
correction, automatic retry, automatic rebase, Core/backup edit or second memory
service is introduced. Offline source fixtures are not native/provider live proof.

At 21:46 Bangkok, `native-reflection-live/run-20261018T214536` completed a real
controlled RPC transaction using the existing authenticated profile, without model,
thinking or provider flags. A primary turn and one claimed background worker both
requested OpenAI `gpt-6.1-sol` / medium. The worker received the new observed canary,
not the package's retained imported-note marker, and committed one low-authority
quote. A new native session recalled that canary; learning was disabled in that
second phase to separate persistent recall from another write. No parent inference
occurred after settlement. This is actual runtime-controlled user-role evidence,
not proof that an automated RPC sender is human. Temporary observer/permissions
were restored, Core was unchanged and the canary stayed in the isolated proof store.
The sole subsequent permission change enabled the real default root. The existing
idle Herdr Pi pane was reloaded without focus or model changes; `/memory-status`
reported the expected empty default quoted-note collection with zero model usage.
Actual native `/memory-correct` and `/memory-forget` also applied successfully with
zero provider requests over a disposable clone of that runtime-derived fixture;
this verifies command wiring, not a second native-origin capture. A separate
recovery counterprobe found rollback to an older generation discarded newer source
references. The repaired canonical merge preserves current archive order, newer
sources/facts, cursor and privacy controls; independent clone replay and fresh-store
reopening pass. That rollback evidence is offline, not provider-backed.

Letta's ordinary `--new` attempt at 17:21 failed at startup with EPERM. A bounded
constant-size fence then allowed only one predicted new conversation while
protecting old conversations, original agent and MemFS. The first real answer
used the wrong repository because inherited `USER_CWD` overrode native tool cwd,
despite a correct conversation header. Setting that child variable to the target
fixed the harness: `letta-native-metadata-20261018T194237` answered the identical
neutral skills question with current repository evidence and a cited historical
rejection. The requested case question is shared; byte-identical runtime user
envelopes were not established by the native-journal audit. Original agent,
sampled core files, Git HEAD/refs and global settings
remained unchanged; Git config writes stayed denied. The stream uses `message`
events, so an old Pi-shaped inference counter's false value is not no-inference
evidence; the final answer is independently matched against its owned native
conversation journal. Pi and Letta chose different supported rejections; Pi
reported an unknown reason. This is a bounded comparison, not generalized parity.
The actual fresh CLI and pinned read-only study source are 0.34.16, commit
`7be3c81f9cfce481994fe4484d59a5bf17cdb48a`; the long-lived parent Letta TUI is
0.34.15. The unchanged Letta default is also `gpt-6.1-sol` / medium, but its OAuth
provider route is not identical to Pi's route. A second identical neutral question
was executed in Haabiz UI at 21:58/21:59 with existing read-only runners: Pi used
scoped search/read and cited a hash-bound historical-assistant Docs CSS diagnosis
(not a human acceptance record); Letta
chose the current AGENTS granular-reset contract and its recorded reason. The
answers were audited against their cited sources, and Letta's visible answer
matched its owned native assistant journal entry. Source files, corpus, original
agent, sampled core and settings were preserved. This establishes two bounded
project comparisons with different supported choices, not equal user envelopes,
equal information access or generalized semantic parity. T190 owns permissions
and next action; human daily-workflow/product acceptance remains open.

Repository package/source validation and 101 sequential tests passed; formatting
and whitespace checks passed. The directional Mods adapter passed five sequential
tests and its canonical repository check, followed by independent native public-API
and controlled transaction probes.
These gates are distinct from the actual provider-backed default cases above
and cannot substitute for the scoped native reflection proof or human acceptance.

## Migration status — 2026-10-17

`@mahirocoko/mahiro-pi` owns the authored Pi footer, status and completion voice,
extracted from the earlier private nested package. Halo's adapter stays with
Agent Halo; reusable workflow installation stays with `mahiro-skills`.
The six original extension, library and test files were verified
byte-identical before the old authoring copy was removed. The existing Pi session
was reloaded on 2026-10-17 after replacing its one local package reference; model,
thinking level, native metrics and Herdr metadata remained unchanged. An ignored
source-only snapshot preserves rollback material. Letta's 15 entries were not
changed; no provider, billing route or credentials were migrated.

## Load and setup (human/Main owned)

Choose one route, using the absolute path of this checkout:

```sh
pi --extension /absolute/path/to/mahiro-pi/extensions/mahiro-status.ts
# OR persist the package checkout, not a second extension reference:
pi install /absolute/path/to/mahiro-pi
```

Inspect `pi list`, remove the old persisted package reference, and reload each
active Pi session only under Main's runtime-switch procedure. Do not load both
copies. `pi remove /absolute/path/to/mahiro-pi` removes the new reference.
Pi loads the checkout rather than an authoring copy. Loading grants the extension
Pi's local execution permissions. No setup command is run by source tests.

Host SDK/AI/TUI packages retain public peer bounds >=1.3.0; typebox is >=1.3.27. Development pins SDK/AI/TUI 1.3.0 and typebox 1.3.27. Required SDK verification needs an explicit public-package supply. The host must resolve its own public TUI package at interactive
startup. Do not install another global SDK merely to satisfy nested dependency
checks. SDK imports are type-only and TUI import is deferred; non-TUI modes never
start status producers or resolve quota auth.

### Explicit setup authority — default skill policy only

`mahiro-pi` owns the explicit source command `pnpm run setup --plan` (also the
no-flag default) and `pnpm run setup --apply`. This is a separate activation step,
not `pi install`, a manifest install hook, data import or startup side effect.
Node >=22.19.0 runs the source TypeScript directly; no SDK internals are imported.
Use `--agent-dir /absolute/canonical/path` to select a profile, otherwise native
Pi's `PI_CODING_AGENT_DIR` override is used (with `~/` expansion), then
`~/.pi/agent`. Relative or noncanonical directories are rejected rather than
silently targeting another profile. Pi 1.3's public config source establishes
that override; the command does not import or initialize Pi to discover it.

Only `extensions/pi-permission-system/config.json` under that agent directory is
eligible. The public pinned permission-system 40.2.2 schema defines singular
`skill`, scalar `allow`/`ask`/`deny` or an ordered pattern map with last-match-wins
semantics. A missing file creates only `{ "permission": { "skill": "allow" } }`;
a missing surface gets scalar allow. That covers all discovered and future
installed skills, not just a named list. Existing scalar restrictions and existing
literal `*` rules are retained. A map lacking `*` receives a leading wildcard
allow with the remaining entries in the same order. Named restrictions and deny
reasons survive, with counts in the receipt; readiness is conservative when any
restriction remains. Integer-like map keys that would defeat wildcard-prepend
order are unsupported and fail closed. The raw skill input gate is not a tool
session-rule grant: there is no session workaround or manual-read bypass.

All other JSON semantics and runtime settings are preserved. Setup validates the
bounded supported 40.2.2 config shape; malformed JSON, unknown schema fields,
unsupported values, symlink ancestors/targets, nonregular or hardlinked targets,
foreign-owned or group/other-writable files and data above 1 MiB fail closed.
Setup accepts strict JSON only. The upstream loader also supports comments;
JSONC profiles remain unsupported here and are refused without rewriting them.
Existing file modes are preserved. New config files and byte-identical backups
are owner-private 0600; newly needed directories use 0700. Preview writes nothing.
Apply recomputes the pure reviewed plan, checks its hash again before publication,
then atomically replaces the existing target (or exclusively links a new target).
A no-op rerun creates no duplicate backup. No full policy or credentials are
printed. The CLI's plan/apply invocations each take a fresh snapshot; callers of
the pure plan/apply API can retain the reviewed plan and stale plans are rejected.

On failure, the small error receipt distinguishes unpublished changes from
published-but-durability-unconfirmed changes and names any completed private
backup. Owned temporary files are cleaned on handled failures; newly created
empty directories may remain. Recovery is manual: compare current content with
the receipt's hashes, retain third-party edits, and restore only the intended
skill field from the backup after review. Never automatically restore an entire
profile over subsequent edits. Hash checks and atomic publication protect against
observed concurrent edits, not hostile same-UID races between the final check and
rename; this is not an OS sandbox or a general transaction framework.

When explicitly selected, `mahiro-skills` owns copying reusable `SKILL.md` files only; this repository's native guards own Pi execution enforcement and no skill-policy grants. There is no
canonical complete default profile. This setup command installs neither owner,
roles, memory, dependencies nor their capabilities. The original four extension
entries retain their order; the source-only utility resource is appended afterward. The separate explicit private-local bootstrap
command is documented in [`bootstrap.md`](bootstrap.md); its candidate contract composes reviewed
Root/public dependency sources, optional selected skill owner, roles and
optional guarded new-root initialization. It is not a public portable installer,
source-install/startup hook, real-profile activation or corpus migration. Root-only source/bootstrap/public-SDK readiness is checked without a Mods checkout. Public dependencies and separately approved runtime activation remain required; source tests never install or enable them. Historical
activation receipts below retain their dates and scope; they are not evidence
that source installation alone enables the whole workflow.

## Compatibility owner map

| Surface | Owner / boundary |
| --- | --- |
| Session tree, forks, templates and native usage data | Pi core; footer presents public data with native counting semantics. |
| Footer, Git/activity and Pi Herdr display tokens | This repository; Herdr remains sidebar renderer and Pi lifecycle producer. |
| Skills | `mahiro-skills` copies reusable cross-host skill bodies; this package owns explicit default skill-policy setup separately from source installation. Root-owned native guards enforce Pi execution, not these grants. This package additionally owns the native git-commit skill/agent pair. Invoke native `/skill:git-commit`, `/skill:recap`, `/skill:rrr`, `/skill:forward`, `/skill:mahiro-style` and `/skill:working-tasks`; no redundant command aliases are generated. Other hosts retain their own command contracts. |
| Timestamps / realign | Native source utilities here; run-start metadata and generated custom guidance differ deliberately from Letta input rewriting. No live activation claimed; see the utility contract above. |
| Saved Model Profiles | RETIRED/removed by the current human decision, 2026-10-20. Native `/model` and registry/auth remain unchanged; no compatibility runtime surface. |
| Code Map | Pure native formatter/schema port here; model-callable resource requires the authored permission-owner winning-surface patch and exact named grant; services lacking winning-surface attestation fail closed. Old/unpatched-owner fixtures do not diagnose today's installed or live owner. No new live activation or workflow state is claimed. |
| Goal | Seventh feature/ninth manifest resource, available after explicit profile installation; private project/session state, four guarded tools, confirmed human commands and subordinate reminder. Source-only, no state import or live activation; `goal.md` owns the contract. |
| Code Evidence | Eighth feature/tenth manifest resource, available after explicit profile installation; four bounded Git lanes, scoped persistent reports, descriptive records and reference-only Goal handoff. Canonical bindings; `evidence.md` owns the contract. No live activation claimed. |
| UX Workflow | Ninth feature/eleventh manifest resource, available after explicit profile installation; bounded metadata coordinator, exact tool/root authority, private CAS and confirmed human direction/review gates. Canonical bindings; `ux-workflow.md` owns the contract. No live activation or Goal/Evidence mutation. |
| Execution Run | Tenth feature/twelfth manifest resource, available after explicit profile installation; one operation tool and confirmed exact-target operator commands, private CAS and caller-only coordination refs. Canonical bindings; `execution-run.md` owns the contract. No execution, proof, live activation or competing TSK ledger. |
| Secret/commit guards, RTK, MCP | Root-owned pure guard ports/final ABI and bounded RTK control; explicit profile installation selects rewrite-rtk default while preserving explicit off; native Pi owns MCP. Letta is unchanged; dated runtime deployment below is not new activation. |
| Tasks | Existing tsk board, no competing session ledger. |
| Subagents | Public subagents alone owns execution and public permissions alone resolves policy. Root authors the guard bridge and, after the separately approved 2026-10-20 cutover, is the single live guard owner. This package authors memory-reflector, managed-memory-writer and the explicitly approved git-commit exception; the other personal workflow roles/model bindings remain local. Earlier personal-role runtime checks below are historical evidence, not package ownership. |
| Memory, recall, reflection | The private native managed-memory root owns maintained Core/persona/preferences and scoped details, separately from the curated bootstrap and C1's untrusted archives/quoted notes. Exact-root authority and locked native writers remain required. Current cutover evidence is above and `agent-memory.md` owns the contract; utility metadata grants no identity or write authority. Human daily-work acceptance remains open. |
| Agent Halo / completion voice | Separate owners. This package owns Pi finish voice only; no Halo audio bridge or Letta change. |
| HiroHiro / browser QA | HiroHiro owns transport; Pi registration and rendered QA remain separate verification. |

This is an owner inventory, not a claim that all daily workflows migrated.

## Current disposition of the 15 Letta entries

Keep native Pi behavior where it already owns the job. A deferred row is not an
invitation to install a broad replacement bundle or copy Letta state.

Original source paths are `mods/<entry>.ts` unless shown explicitly below; `statusline` is `mods/statusline.tsx`, MCP is `mods/mahiro-mcp-proxy.js`, and finish voice is `mods/mahiro-finish-voice.js`. These are dated original-reference owners, not runtime imports or prerequisites.

The proof column names executable source probes, not newly established live parity.
`lib/guards/test/` paths below are run by the required public SDK gate inside
`pnpm check`; `test/*.test.ts` are source fixtures. Frozen Letta oracles under
`test/oracles/letta/` are dated **test-only** metadata/behavior references, not
runtime imports or instructions. Native equivalents are not missing just because
an original entry was not cloned. All rows retain human daily/RAM acceptance;
provider/rendered/all-Space acceptance cannot be inferred from source tests.

| Original entry / capability | Native equivalent or port / current owner | Meaningful source or SDK proof | Active-runtime / acceptance limit |
| --- | --- | --- | --- |
| `mahiro-user-timestamps` — clock context | Adapted port: `lib/native-utilities.ts`, `extensions/mahiro-native-utilities.ts`; host-local run-start metadata, not user-text rewriting or fixed Bangkok time | `test/native-utilities.test.ts`, `test/native-utilities-native.test.ts`: input/attachment immutability, clock skips and public SDK lifecycle | In the guards-first12 source list; current live utility behavior not re-probed. No human identity or memory authority. |
| `mahiro-realign` — correction guidance | Adapted port in the same native utility owners; bounded literal focus, public custom message and fresh idle delivery | Same source/native fixtures: busy/stale/child rejection and fresh-loader boundary | No live activation inferred; not a user message, cancellation guarantee or permission. `/skill:recap` is separate. |
| `mahiro-model-profiles` — saved presets | **RETIRED/removed by current human decision, 20 October 2026**; no Pi Models runtime owner or compatibility stub | `test/rtk-contract.test.ts`: executable/manifest/ABI retirement; RTK storage/security coverage retained separately in `test/rtk-state.test.ts` and `lib/guards/test/rtk-patch-test.mjs` | Native `/model`, native registry/auth, defaults and personal roles unchanged. Frozen dated Letta oracle/provenance retained as history only; no live profile cleanup or reload claimed. |
| `mahiro-herdr-lifecycle` — host activity | Native Pi owns raw lifecycle; `lib/status.ts` owns existing display metadata and `lib/worker-activity.ts` / `extensions/mahiro-worker-activity.ts` own separate exact-service worker counts. `mahiro-herdr/src/agent-renderer.mjs` owns the derived Space status-cell overlay | `test/status.test.ts`, `test/worker-activity.test.ts`, `lib/guards/test/worker-activity-sdk-test.mjs`: PID/generation/sequence controls and actual print-mode automatic children; Herdr `test/agent-renderer.test.mjs` checks strict tuple parsing and unchanged raw state | **Producer, consumer and approved Root-only runtime active.** Fresh Pi TUI/owned updater and independent live child established raw settled Main plus positive worker counts and real published spinner tokens, then terminal `0/0`. This is resolved runtime-token evidence, not rendered all-Space/human/daily/RAM acceptance. |
| `mahiro-goal` — objective metadata | Canonical installed feature: `lib/goal/`, `extensions/mahiro-goal.ts`; Root guard `goal` ABI, public permission decisions | `test/goal-*.test.ts`, `lib/guards/test/goal-patch-test.mjs` → `goal-test.mjs`: schema/CAS, exact tool/root and UI/direct/nested gates | Resource declaration/startup is not installation consent or live activation. No import, automatic Goal, executor or TSK replacement; metadata is not completion truth. `goal.md` owns semantics. |
| `mahiro-code-evidence` — bounded Git evidence metadata | Canonical installed feature: `lib/evidence/`, `extensions/mahiro-code-evidence.ts`; Root guard `evidence` ABI | `test/evidence-*.test.ts`, `lib/guards/test/evidence-patch-test.mjs` → `evidence-test.mjs`: four Git lanes, authorization/helper controls, CAS and direct/nested dispatch | No live enablement; recorded commands are never executed, `evidence_ready` is metadata, not verified Goal completion. `evidence.md` owns semantics. |
| `mahiro-ux-workflow` — design coordination | Canonical installed feature: `lib/ux-workflow/`, `extensions/mahiro-ux-workflow.ts`; Root guard `uxWorkflow` ABI | `test/ux-workflow-*.test.ts`, `lib/guards/test/ux-workflow-patch-test.mjs` → `ux-workflow-test.mjs`: FSM, exact authority, public UI gates/CAS | No design engine, artifact reader, executor or live/human direction acceptance. Metadata does not mutate Goal/Evidence. `ux-workflow.md` owns semantics. |
| `mahiro-code-map` — bounded navigation formatter | Pure port: `lib/code-map.ts`, `extensions/mahiro-code-map.ts`; Root guard exact `mh_code_map` winning-surface assertion | `test/code-map.test.ts`, `lib/guards/test/permission-patch-test.mjs` → `code-map-test.mjs`, plus `code-map-blocked-test.mjs`: exact vs later wildcard and old-owner negatives | Caller metadata only, not search/index/outline generation. Actual winning `matchedSurface` is required, not merely an existing exact grant. No live parity inferred. |
| `mahiro-execution-run` — lane/run coordination | Canonical installed feature: `lib/execution-run/`, `extensions/mahiro-execution-run.ts`; Root `executionRun` ABI | `test/execution-run-*.test.ts`, `lib/guards/test/execution-run-patch-test.mjs` → `execution-run-test.mjs`: FSM/private CAS and exact-target UI controls | No executor, worker discovery, artifact reading or competing TSK board. Reports/refs are metadata, not proof/acceptance. `execution-run.md` owns semantics. |
| `mahiro-commit-attribution-guard` — commit final-argument enforcement | Pure local port `lib/guards/mahiro-commit-attribution-guard.js`; `host.mjs` / `index.ts` final native boundary | `lib/guards/test/test.mjs`, `bootstrap-test.mjs`, `candidate-patch-test.mjs`: guard/final dispatch and single-vs-dual owner coverage | Root-only cutover separately approved and loaded on 2026-10-20; one guard owner, no legacy duplicate. Native Core is not Letta MemFS. No original entry or real commit changed; not an OS sandbox. |
| `rtk-control` — command rewriting | Real installed `rtk rewrite -- <original>` resolver in `lib/rtk.ts`, private RTK-only storage in `lib/rtk-state.ts`, Root native guard before final spawn | `test/rtk.test.ts`, `test/rtk-state.test.ts`, `lib/guards/test/rtk-patch-test.mjs` → `rtk-sdk-test.mjs`: exit 0–3/error/timeout/bounds, off no-op, original/final policy, secret/attribution, abort/stale and actual native transform | Explicit profile installation selects absent-state rewrite-rtk and preserves existing explicit off; without an installed default or explicit selection, mode stays off. Off remains a no-op fast path. Exit 3 is a host-authorized candidate, exit 2 blocks. No helper before original guard/policy allowance. Main owns private setup/reload; no new live activation, history access, global hooks or verified savings. |
| `statusline` — presentation/native metrics | Native equivalent plus authored port: `extensions/mahiro-status.ts`, `lib/footer.ts`, `lib/status.ts`, `lib/quota.ts`; Pi owns native usage | `test/footer.test.ts`, `test/status.test.ts`: native usage, geometry, PID/generation/sequence/stale protections | Authored palette/spacing/native usage unchanged. Direct OpenAI quota omitted; synthetic tests are not rendered/default-provider or human acceptance. |
| `mahiro-mcp-proxy` — tool transport | Native Pi MCP equivalent; HiroHiro owns browser transport, not a cloned Root proxy | Dated 2026-10-17 actual native model/MCP schema + one Chrome transaction below; **no new source test of that external transport in this phase** | Existing registration/proof is bounded historical evidence, not all authenticated browser workflows or current provider acceptance. No new browser/live probe. |
| `mahiro-secret-read-guard` — sensitive read enforcement | Pure local port `lib/guards/mahiro-secret-read-guard.js`; Root host/final ABI plus four filtered helpers | `lib/guards/test/test.mjs`, `bootstrap-test.mjs`, `candidate-patch-test.mjs`: final direct/nested guards, secret-denied read and dual-owner fail-closed | Root-only cutover separately approved and loaded on 2026-10-20; legacy registration removed. Ordered bootstrap required; unsupported aliases/PowerShell denied. Not hostile-extension/OS isolation. |
| `mahiro-finish-voice` — completion notification | Native settlement adaptation: `extensions/mahiro-finish-voice.ts`, `lib/finish-voice.ts`; Halo separate | `test/finish-voice.test.ts`: silent injected runner, successful whole-run settlement, duplicate/error/abort/child/stale cases | No Halo relay or Letta change. Real Kanya/audio and rendered/native settled E2E remain separately owned; process receipts are not human-heard acceptance. |

### Remaining ecosystem gate — Pi ↔ Herdr worker activity

The source integration now publishes Pi-owned **public-service** running/queued
counts and consumes their complete tuple in Herdr's existing Space status cell.
It does not infer execution from Run records or completion voice. Raw Main status,
held Done and attention remain native; no Agents layout or Space header change is
part of this contract. Source/SDK and isolated renderer checks alone were not
deployment evidence. The separately approved Root-only profile and owned updater
are now loaded; an actual independent child and bounded observer established TUI
publication, settled Main with positive counts/animated tokens and terminal `0/0`.
**Rendered human/all-Space and daily/RAM acceptance remain pending.** Real TTL
expiry timing and all attention/focus combinations were not live-probed; malformed,
expiry-omission, raw-state and geometry regressions retain their source fixtures.
No future install, reload/restart or configuration change is automatically authorized.
C1 archives remain untrusted historical evidence; the private maintained-memory
root and its separate exact-root capability remain the knowledge/write owner.
Neither memory capability substitutes for any app tool/root authority above.

## Native agents and curated continuity active — 2026-10-17 baseline

This section records the scoped 17 October deployment. The current expansion and
18 October default change are described above; Main owns runtime activation.

The pinned subagent/permission pair and complete ordered Mods guard package were
registered in the existing native Pi profile on 2026-10-17. Twelve owned role
definitions preserve the established OpenAI model/effort bindings, including
overrides for upstream built-in provider defaults; see `agents.md`. Concurrency is
bounded to two; Main still serializes writers per checkout and browser/heavy jobs.
The existing Pi TUI was reloaded without changing its active model/provider,
authored footer, cwd or focus. An actual installed `implementer` child read the
approved source README successfully and returned its heading on OpenAI
`gpt-6.1-sol` / medium. This is not live proof of every roster model.

The public-API parent gate synchronously aborts missing-service
children on bound and resume events: zero new provider calls, with stopped rather
than successful status. Its conservative fault policy cancels healthy/queued
siblings too; no guessed child-ID mapping or vendor patch is used.

The original idle trusted-extension custom-message counterexample remains:
it can start provider work outside that orchestrated path. This disproves a
universal pre-inference veto, not the observed tool-denial boundary, and is not
evidence of a secret leak. Arbitrary trusted executable extensions are not an
operation-policy sandbox. Independent offline checks cover final execution,
aliases/provenance, nested calls, parent/child policy, filtered-error translation,
real retention/disposal and initialization/import-failure denial. Separate native
OpenAI child plus HiroHiro schema/Chrome list-pages calls passed. Load the whole
ordered guard package: raw index-only loading and a physically absent package are
not protected configurations.

Native policy uses the current nested `mcp` surface, explicit known-tool allows,
unknown-tool denial and no yolo. Outside-CWD access asks by default, with narrow
grants for the two approved T190 source roots. The first live cross-root read was
denied by the missing directory grant; the corrected scoped policy passed without
loosening canonical secret/commit guards. Role tool-result details are rendered
UI metadata, not necessarily text visible to the parent model.

At this 2026-10-17 checkpoint the daily continuity owner was native
`~/.pi/agent/AGENTS.md` (superseded for maintained knowledge by the private managed
root after the separate 2026-10-19 memory cutover), created only
after all native user-context filename candidates were confirmed absent. One
bounded Durable continuity section holds prospective, confirmed current facts;
repository instructions and tsk remain their respective owners. Corrections and
forgetting replace/remove the authoritative entry. Reload or a fresh session
refreshes context; native resume or bounded requested journal reads supply detail,
not an automatic all-history recall index. The 4 KiB editorial budget is not an
enforced security boundary.

Existing guarded core tools update the file and its one private
`~/.pi/agent/continuity-backup.md` snapshot. Both are mode `0600`; native external
access grants name those two files exactly, not their parent profile directory.
Snapshots are not auto-loaded, and removal from current facts does not erase old
history/snapshots. Auto-loaded context reaches the provider without a model-issued
read: never use these files for credentials, raw logs or unapproved sensitive data.
No existing personal-memory corpus was copied; the retained-facts section starts
empty.

Native-context evidence is separate from candidate-package research: four
model-issued guarded mutations and fresh correction/removal/restoration discovery
passed offline, including an actual failed-callback negative control. A fresh
native OpenAI `gpt-6.1-sol`, requested-medium session then answered the corrected
fixture exactly: one turn, no tools, successful stop, 1,231 input / 14 output
tokens. Deployment additionally exercised the actual two global files through
guarded snapshot/write/edit operations with zero native inference/network and
removed its test marker. Fresh discovery found only the active file, not its
snapshot. The existing user TUI reported a new context/extensions reload; its
footer, native usage, model/provider, cwd and focus were preserved. Human daily
workflow/product acceptance remains pending.

The unchanged, **isolated/non-adopted** durable-memory candidate passed synthetic write, correction,
fresh-process context injection and recovery rollback through SDK1.3. A separate
fresh native SDK session then recalled the unique corrected canary exactly via
normal OpenAI / `gpt-6.1-sol`, requested medium: one prompt/turn, no tools,
successful stop, 313 input / 20 output tokens, no lifecycle errors. The answer was
only in the injected memory, not the neutral question or prior session history.
This proves bounded behavioral recall **from injected synthetic context**, not
autonomous learning, generalized recall, global package adoption or data import.

The full guard profile stayed healthy while all seven foreign memory tools were
withheld. Those tools remain denied: their raw I/O follows symlinks, and explicit
status/search plus session-start can perform qmd setup/probing despite update-off.
Validated dates, recovery UUIDs and empty-match rejection are not traversal defects.
The native path above avoids this executable/lifecycle authority rather than
building a second memory adapter or requiring a qmd-free machine.
Summary inference stayed disabled; qmd was absent from the restricted PATH,
because update/search flags alone do not disable its setup. The native process
used the existing authenticated HOME without inherited API-key/provider overrides;
the existing user TUI was preserved. No real memory or credentials were copied.

The first offline capture was rejected: SDK1.3 provider callbacks receive a
normalized transcript, not legacy `context.systemPrompt/tools` fields. A callback
assertion becomes an assistant error rather than necessarily rejecting `prompt()`.
The corrected preflight uses public transcript resolvers, requires completed
callback assertions plus a successful assistant, validates serialized proof fields
and rejects the observed failure shape. Independent recheck approved the bounded
native call only after those gates passed. Entry/store hashes are cooperative
local evidence, not full transitive or same-UID tamper containment.

## Live verification boundary — 2026-10-17

The command-alias probe below predates Mahiro's 20:25 skills-only decision.
It is historical invocation evidence, not the current command contract; use
native `/skill:recap` now, as described in the owner map above.

The existing Pi TUI kept native OpenAI `gpt-6.1-sol` / medium and subscription
semantics. Its native `/recap --quick` read the same T190 UUID as Letta, called
HiroHiro's `read: schema`, and completed without product/task/config writes.
Halo accepted its real Pi PID and whole-run lifecycle. One `say` and one `afplay`
child were observed and exited; this is process evidence, not human-heard proof.

A separate ephemeral native Pi print-mode run exercised Chrome through native
codemode and MCP, not a direct-client substitute: input/focus/keyboard/click,
zero initial and post-interaction console errors/warnings/issues, and a saved
PNG were checked. Its browser, GPU helpers, test MCP servers and process exited.
The existing TUI and its legitimate MCP servers were preserved. This is bounded
technical integration evidence, not complete daily-workflow or product acceptance.

## Preserved presentation and public data

The authored footer uses public `ctx.ui.setFooter`, clears its superseded own
status slot and preserves other extensions' sorted status slots once. Palette:
folder/Pi `#8C8CF9`, branch `#64CF64`, changes/effort `#FEE19C`, activity `#20B2AA`,
context `#BEBEEE`, separators `#46484A`, labels `#A5A8AB`, errors `#F1689F`.
Project/branch/changes/session/activity oppose Pi/model/effort/provider when room
permits. Narrow widths prioritize model identity, wrap semantic cells and retain
native usage. Public Pi TUI width/truncation preserves Thai/emoji graphemes.

Git uses local porcelain v1 NUL records, consumes rename/copy paths and shows
`+N` untracked entries, `~N` tracked changes and local-upstream `↑N`/`↓N` commits.
No fetch occurs; untracked directories count once. Native `isIdle()` and bounded
tool names are display hints, never completion or approval truth.

Public session entries supply whole-session input/output/cache/cost, counting
native usage-bearing entries once even across compaction. Cache-hit rate is the
latest assistant prompt only. Context preserves zero versus unknown and uses
public model capacity only as fallback. Public settings supply auto-compaction.
Subscription labels use public OAuth/provider flags and native `kimi-coding`
semantics. Virtual route labels require a successful physical response after the
latest selection on the public active branch, otherwise unknown; no private
`AgentSession.routedModel` or fabricated session is used.

## Account quota boundary

Native Pi 1.3 OpenAI subscription uses the direct API grant, not legacy Codex.
Prior local evidence found HTTP 401 at the legacy endpoint; no numeric quota API
for this native grant is established. **Its quota row is omitted entirely**, with
no fallback Usage link, native auth resolution or speculative quota request.
Session cost/tokens are never treated as remaining allowance.

Only optional legacy `openai-codex` uses public `getProviderAuthStatus` and serialized
`getApiKeyAndHeaders(model)`. It uses the selected Pi credential and explicit
account header/JWT claim, otherwise the bearer-scoped default. No Codex-home auth,
Letta cache, arbitrary provider or borrowed account is read. A one-way in-memory
fingerprint invalidates account data; credentials and raw responses are never
persisted/logged. Public auth may refresh via Pi's existing machinery; this
extension never writes auth files itself.

The sole legacy endpoint is `https://chatgpt.com/backend-api/wham/usage`, with no
redirects, Authorization/account/Accept headers only, a 5-second total deadline,
256 KiB cap, 120-second success TTL, 30/60/120-second failure backoff and 300-second
stale bound. HTTP 401/403 clears quota and stops requests until credential change.
A hanging public auth promise cannot be cancelled: UI times out and no second
auth operation starts until it settles. Late results cannot revive old ownership.

Legacy rows show actual P/S durations, eight-cell remaining bars, `% left` and UTC
resets. Additional windows are parsed when present. Missing/expired windows are
not fresh allowance. Failed/stale/near-reset data is not valid sidebar quota.

## Herdr ownership and cleanup

Only inherited `HERDR_ENV=1`, pane and socket identity enable display publication.
Before every publish, public `herdr pane process-info` must confirm this exact Pi
PID in that exact pane's foreground process list; unknown ownership fails closed.
Public `herdr pane report-metadata` uses source `mahiro:pi-display`, agent `pi`,
inherited routing and model/provider/context tokens. Unknown values are cleared;
0% is valid. No focus lookup, cwd/title override, `report-agent`, lifecycle or
completion report occurs. Controls/bidi overrides are removed from display text.

Account-valid legacy quota can publish the six shared q1/q2 severity tokens via
the same PID gate; unused severities are cleared. Remaining <20 is critical,
<50 warning, otherwise OK. The sibling Herdr renderer remains a separate owner,
not a runtime import. Native ProgramStatusReporter/OSC 7501 remains untouched.

As approved on 2026-10-17, Mahiro Herdr separately displays its existing shared
Codex account cache for `agent=pi` with provider token `openai`, using the same
labels, severity and freshness rules as Letta. That sidebar projection is owned
by `mahiro-herdr/src/core.mjs`, not this Pi quota collector. It is not Pi-native
allowance or proof of matching accounts. This package still makes no native-direct
quota/auth requests and its footer quota row remains omitted.
For exact native `openai`, Pi display publications omit all six quota token sets
and clears, including heartbeats, reloads and a pending model selection before
context refresh. Metadata source IDs do not protect shared token keys from clears.
Legacy `openai-codex` quota publication and expiry clears remain unchanged.

Model switches suppress old context until finite positive matching successful
assistant usage arrives. Errors, aborts, zero/wrong-model usage cannot revive it.
A 1-second context poll observes public invalidation. Git polls at most every
5 seconds; metadata uses a 10-second heartbeat and 30-second TTL. Each producer
has at most one outstanding request; subprocesses use argv, 1.5-second deadlines,
SIGKILL and 256 KiB caps. Failures never fail Pi operations.

Shutdown/reload/replacement stops timers, subprocesses and network work. Global
in-process ownership disposes prior generations and maintains monotonic metadata
sequence; late acknowledgements cannot cache superseded state. No final write
races replacement: metadata expires by TTL. Epoch-based sequence reduces restart
collisions; clock rollback and independent Pi processes sharing a pane are not
supported arbitration scenarios. Disposal restores native footer and unsubscribes
branch notifications. No extra model calls or invented backend statuses occur.

## Pi completion voice

The actual package manifest is guards-first12: bootstrap and one Root native guard,
then the ten feature entries from `extensions/mahiro-status.ts` through
`extensions/mahiro-execution-run.ts` in preserved feature order. The disposable
candidate declaration mirrors that graph. Saved Models is retired. The single
status-only CLI route above does not compose the full package or grant feature
authority. Source development itself authorizes no real reload or cutover.

One explicit `install:profile` composes required public packages, owned system
roles, named tools and canonical feature DATA grants. Goal/Evidence/UX/Run then
bind ordinary canonical projects without per-repo configuration; explicit
restrictions remain effective. Code Map authority remains separate. Recall needs
healthy canonical guards and valid accepted data; a known fresh archive is empty,
not a fallback for corrupt data. Managed memory additionally requires its separate
exact-root capability; the installer scaffolds only an absent root and preserves
existing Core/config/ledger/corpus. Actual profile activation/fresh load remains
separately authorized. These installation boundaries do not change voice's
independent lifecycle below.

Voice uses only public `agent_start`, `agent_before_settle` and `agent_settled`:
latest whole-run outcome must be completed and final settled must not be aborted.
Before-settle itself never speaks; automatic retry, compaction and queued
continuations must finish first. Duplicate settlement and missing/error/aborted
outcomes cannot speak. Only `ctx.mode === "tui"` acquires independent global voice
generation ownership; headless/RPC/SDK children cannot displace a TUI parent.
Every session shutdown reason aborts its own voice and invalidates late callbacks.
This notification does not require terminal focus or Herdr foreground ownership.

On macOS, argv-only `say` uses Kanya at rate 300 to synthesize the literal
“ทำงานเสร็จแล้วค่ะ” into an owned temporary AIFF, then `afplay` uses volume 0.4.
Commands have 10-second deadlines and the operation has a 20-second abort deadline,
a 3-second cooldown, one active operation and no queue. Cleanup removes only the
operation's generated temporary directory. Non-macOS and notification failures
are silent. No import/startup audio, transcript speech, Halo relay, sibling runtime
imports or external Letta helper exists. Tests inject silent runners and temporary
storage; actual Kanya/audio and native settled-event E2E remain Main-owned checks.

## Verification boundaries

`pnpm check` runs package/import/whitespace checks and the Node test suite,
including status, silent completion voice, native roles and continuity. Tests cover
native usage, cache/subscription, geometry widths, quota/auth/account invalidation,
PID/non-TUI isolation, generation ownership, freshness, cleanup, scoped imports,
recall and stale-result rejection without live auth/model calls. For serialized
execution, use `pnpm check` (the source suite and required public SDK gate are
already serialized); the direct source-only command is
`node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/*.test.ts`
and is not a substitute for the full gate.
`pnpm check:geometry -- /absolute/path/to/host/package.json` separately resolves
public host geometry and checks five widths plus Thai/ZWJ round-trip. No installed
compiler or bundle tool is required; these checks are not typechecking.

Biome 2.5.14 includes voice source/tests, role tests, continuity and managed-memory
source/tests/extensions, its config and the package manifest. Format scripts now
include managed-memory, bootstrap, native utilities, Code Map, Goal, Evidence, UX Workflow and Execution Run alongside the prior voice/role/config/manifest set; check
continuity explicitly with the installed Biome binary. Neither route
should mass-reformat the six legacy files. No Markdown formatter is installed.

Main inspected actual terminal text and metadata after the 2026-10-17 reference
switch: one authored footer, the same model and usage values, and no quota row.
Synthetic geometry is not a real rendering matrix, virtual-route/provider matrix,
numeric native quota proof, or human visual/daily-workflow acceptance. T190 owns
fresh independent checks and remaining workflow proof; Mahiro retains acceptance.
