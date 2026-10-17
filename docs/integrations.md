# Pi integrations and ownership

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

The SDK peer and public Pi TUI peer target >=1.3.0 and are optional for source
verification. The host must resolve its own public TUI package at interactive
startup. Do not install another global SDK merely to satisfy nested dependency
checks. SDK imports are type-only and TUI import is deferred; non-TUI modes never
start status producers or resolve quota auth.

## Compatibility owner map

| Surface | Owner / boundary |
| --- | --- |
| Session tree, forks, templates and native usage data | Pi core; footer presents public data with native counting semantics. |
| Footer, Git/activity and Pi Herdr display tokens | This repository; Herdr remains sidebar renderer and Pi lifecycle producer. |
| Skills / five core aliases | `mahiro-skills` installs skills and thin native extension aliases. `/recap`, `/rrr`, `/forward`, `/mahiro-style` and `/working-tasks` dispatch `/skill:name` with native expansion; generic prompt instructions were insufficient in the live probe. |
| Timestamps, realign and model profiles | Existing Letta owner remains separate; native Pi selection is not named-profile or per-turn timestamp parity. |
| Goal, UX, Code Evidence, Code Map, Execution Run | Existing focused owners and human gates; no Pi port/shared framework claimed. |
| Secret/commit guards, RTK, MCP | Letta remains unchanged. The canonical Mods Pi guard adapter and native MCP are active with scoped evidence below; no automatic RTK activation. |
| Tasks | Existing tsk board, no competing session ledger. |
| Subagents | Pinned native orchestrator/permissions plus canonical guard package active; owned role bindings live-tested within the scope below. |
| Memory, recall, reflection | Native curated user context is active for prospective confirmed facts; guarded core tools own updates. Native resume/bounded requested journal reads own history. No corpus import, index or background reflection daemon. |
| Agent Halo / completion voice | Separate owners. This package owns Pi finish voice only; no Halo audio bridge or Letta change. |
| HiroHiro / browser QA | HiroHiro owns transport; Pi registration and rendered QA remain separate verification. |

This is an owner inventory, not a claim that all daily workflows migrated.

## Current disposition of the 15 Letta entries

Keep native Pi behavior where it already owns the job. A deferred row is not an
invitation to install a broad replacement bundle or copy Letta state.

| Letta entry | Pi disposition |
| --- | --- |
| `mahiro-user-timestamps` | Not ported. Per-turn Bangkok timestamp parity is not established. |
| `mahiro-realign` | Not ported. Task-backed `/recap` is available; it is not the same injection mechanism. |
| `mahiro-model-profiles` | Native `/model` and thinking selection remain authoritative; the saved-profile mod is not ported. Owned native role files explicitly preserve model/effort bindings; they do not implement saved-profile parity or silent remapping. |
| `mahiro-herdr-lifecycle` | Keep Pi's native Herdr lifecycle. This package publishes only its owned display metadata. |
| `mahiro-goal` | Deferred; preserve explicit human approval. No Goal/state import or automatic creation. |
| `mahiro-code-evidence` | Deferred; local validation receipts do not imply a native Code Evidence API. |
| `mahiro-ux-workflow` | Deferred; no copied coordination state or invented design approval. |
| `mahiro-code-map` | Use filename/exact search and bounded reads. No retired semantic indexer. |
| `mahiro-execution-run` | Deferred. Existing tsk remains the task owner, not a new competing execution ledger. |
| `mahiro-commit-attribution-guard` | Active through the canonical Mods Pi adapter; final execution uses the unchanged default factory. Synthetic Git argv and nested calls are tested; no real commit was created. |
| `rtk-control` | Not ported. No automatic prefix, hook or package activation. |
| `statusline` | Authored footer/status/native metrics implemented here. Unavailable native quota stays omitted. |
| `mahiro-mcp-proxy` | Native Pi MCP is registered. Actual Pi model/tool traces passed HiroHiro schema and one headless Chrome fixture transaction, including interaction, console checks and PNG output. Other authenticated/browser workflows are not implied. |
| `mahiro-secret-read-guard` | Active through the canonical Mods Pi adapter, including native final arguments, filtered readers, nested calls and parent/child gates. The ordered bootstrap denies dispatch if canonical initialization/ownership fails. Unknown tools and PowerShell are denied; this is not an OS sandbox. |
| `mahiro-finish-voice` | Pi-owned successful-settlement adapter here; no Halo audio relay or Letta change. |

## Native agents and curated continuity active

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

The active daily continuity owner is native `~/.pi/agent/AGENTS.md`, created only
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

The package manifest loads both `extensions/mahiro-status.ts` and
`extensions/mahiro-finish-voice.ts`. The single status-only CLI route above does
not enable voice; loading the package enables both after Main's authorized reload.
No runtime reload is performed by source development.

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

`pnpm check` runs package/import/whitespace checks, the original 26 synthetic
Node tests and focused silent completion-voice tests. They cover full native usage, cache/subscription, geometry widths,
quota/auth/account invalidation, PID/non-TUI isolation, global ownership,
sequence/freshness, cleanup and late callbacks without live auth/model calls.
`pnpm check:geometry -- /absolute/path/to/host/package.json` separately resolves
public host geometry and checks five widths plus Thai/ZWJ round-trip. No installed
compiler or bundle tool is required; these checks are not typechecking. The local
pinned Biome formatter is scoped to new voice source/tests, config and manifest;
`pnpm check:format` checks those files without reformatting the legacy footer.

Main inspected actual terminal text and metadata after the 2026-10-17 reference
switch: one authored footer, the same model and usage values, and no quota row.
Synthetic geometry is not a real rendering matrix, virtual-route/provider matrix,
numeric native quota proof, or human visual/daily-workflow acceptance. T190 owns
fresh independent checks and remaining workflow proof; Mahiro retains acceptance.
