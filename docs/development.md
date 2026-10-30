# Development and release

[← Documentation](README.md) · [Source release record](releases/0.11.0.md)

## Dependencies and checks

Use Node ≥22.19.0 and pnpm **10.33.0**. Install declared public dependencies
explicitly with the frozen lockfile. No private corpus or sibling runtime is
required. This repository authors the guards, dependency patches and narrow ABIs.

```sh
pnpm check:fast # default static tier; pnpm check is an alias
pnpm check:state # read-only whole-state budget
pnpm check:docs
pnpm check:types
pnpm format # writes the owned formatter surface
pnpm check:format
pnpm check:continuity-format
pnpm check:geometry -- /absolute/public/pi-coding-agent/package.json
git diff --check
```

`check` / `check:fast` run strict TypeScript, formatting, package/import/whitespace,
documentation and read-only state-budget checks, without behavioral suites.
For behavior changes, select exact relevant test files, for example:

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/candidate-isolation.test.ts
```

For the disconnected [R7 invocation-view/history slice](letta-parity-r7.md), run the
focused source fixtures (not an installed/provider/browser acceptance probe):

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/agent-memory-local-invocation.test.ts test/agent-memory-local-palace.test.ts test/agent-memory-local-projection.test.ts test/agent-memory-local-forgetting.test.ts
```

The disconnected HTML remains per-request fixture/private-shadow with separate
lifecycle/document owners. The later ABI2 metadata handoff has its own focused
source fixtures and does not import that service:

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/agent-memory-engine.test.ts test/agent-memory-palace-handoff.test.ts test/palace-immutable-server.test.ts test/agent-memory-tree-lifecycle.test.ts test/agent-memory-runtime.test.ts
```

These tests cover the frozen DTO/renderer, capability-scoped immutable server,
runtime authority/lifecycle revocation, command/ABI1 grammar and count-only ABI2
capacity fallback without parsing retained record bodies. They do not open
a browser, mutate a current profile, prove provider consumption, complete R7-I/O/H
or establish Mahiro visual/product/RAM acceptance.

Heavy tiers require explicit scope and run serially:

- `check:source`: the full serial source-test suite followed by whole-state accounting.
- `check:public-sdk`: the offline public-SDK integration suite with owned-stage cleanup.
- `check:release`: fast, source, public-SDK, then final state accounting; the explicit combined release gate.

These commands describe gates, not evidence that any full gate was run.

The **whole** `.agent-state` must remain strictly below **1,073,741,824 bytes** (1 GiB),
not just `runtime/`. `check:state` reports bounded tree bytes without following
stable symlinks and fails closed on unsafe root identity or excessive entry count. It is
read-only: no automatic blanket cleanup. This is checkpoint accounting at gate/staging
boundaries, not an OS quota against arbitrary concurrent writes; every test owner must
still bound its writes and cleanup. Never prune memory, retrospectives, learnings, inbox,
metrics, unknown directories or live paths.

Disposable staged fixtures under `.agent-state/runtime/` register exact newly-created
roots, return idempotent `cleanup()` and have a process-exit fallback. Prefer explicit
`finally` cleanup; forced termination can prevent fallback. Staging checks the whole
state before and after copying, removes its own new root on failure, and propagates
`MAHIRO_PI_TEST_STATE_ROOT` to child/staged processes so accounting stays bound to
the original checkout. Do not override this binding in nested jobs. The SDK gate
captures suite failures, measures state, then cleans its three stages before rethrowing;
only three marked, completed `required-sdk-*` receipt directories with known flat
contents are retained, with bounded log capture.
Unknown or unmarked proof directories are not automatically removed. `check:types` uses the pinned public TypeScript **6.0.3** and Node 22
**22.19.19** declarations with strict NodeNext resolution, explicit Node types,
TypeScript-extension imports and `noEmit`. The inventory check verifies every
authored TS file under `lib/`, `extensions/`, `test/` and root TS tooling against
the actual compiler program, including imported inputs. Private evidence and
immutable `test/oracles/` never enter that program. `allowJs: true` permits existing
JS interoperability/inference with `checkJs: false`; this does not claim all JS
is typechecked. `skipLibCheck: true` skips dependency declaration diagnostics,
not owned TS errors. No emit, baseline suppression or fake SDK declarations.

Biome **2.5.14** owns all authored JS/TS/JSON, including root check scripts,
configuration, fixtures and previously unformatted owned legacy files. Its
contract is two spaces, single JS/TS quotes, semicolons only as needed for ASI
safety, 110 columns, trailing commas, LF, always-parenthesized arrow parameters,
spaced object braces and property quotes only as needed. JSON remains valid JSON:
double quotes and no trailing commas; JSX quote defaults are unchanged. Run
`pnpm format` after each completed change phase, then the read-only format gates.
`check:continuity-format` remains a compatible subset of `check:format`.
`biome.json` positively owns source/tooling roots and hard-excludes private state,
`node_modules` and immutable upstream `test/oracles/`. The original Letta guard
factories live only in `test/oracles/letta/`; `lib/guards/provenance.json` points
to those SHA-pinned test originals. `check-package.mjs` checks their hashes against
the frozen oracle manifest and verifies that neither legacy factory has a runtime
copy. Patch files remain byte-exact upstream evidence outside the authored
formatter contract.

When a security-audit execution constraint applies, do not run target-controlled
checks, builds or formatters without the required sandbox. Limit verification to
source/diff inspection and report the unrun checks explicitly.

The [R8 source/security/context-contract closeout](letta-parity-r8.md), assessing
product source at `85d2f0a82088103eb67d4bd29876e0f4e4b471a8`, ran no target-controlled gates:
no qualifying OS sandbox was established. Its prior R0–R7 test/SDK records are
evidence references, not R8 rerun proof. Native Git diff/whitespace inspection
does not replace the normal checks above or establish release readiness.

Focused session-work checks (serialize with other SDK/heavy jobs):

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/task-panel.test.ts test/session-work-model.test.ts test/session-task-adoption.test.ts test/session-work-native.test.ts test/workflow-integration.test.ts
```

The session-work native fixture runs genuine public SDK/Faux factories across
reload/fork/resume/new, native input and correlated custom-message journaling.
Its public UI selectors/editor keys and terminal object are scripted, not a
live CLI/TTY. The focused panel, adoption, native and integration tests independently
assert completed → active → pending ordering, initial selection, sole-command
registration, RPC fallback, shared-journal behavior and the Todos hub entry. The
explicit public-host geometry smoke also renders
TaskPanel at 40/60/80/120/160
columns and tiny widths with Thai/CJK/ZWJ labels, overflow and empty states.
Geometry checks establish column bounds, not human rendered acceptance.
Model tests cover bounds, dependency cleanup, missing/delayed and
duplicate receipt correlation. A fresh reviewer and native TUI checks must still
assess composer/attachments, native queue coexistence and rendered narrow layouts.
No provider inference or execution/RPC package interoperability is established.

Focused maintained-memory checks (also serialize with SDK/heavy jobs):

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/agent-memory*.test.ts
```

`test/agent-memory-local-lifecycle.test.ts` is the synthetic local Git/worktree
lifecycle check. It is included by the glob above and can be run alone:

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/agent-memory-local-lifecycle.test.ts
```

`test/agent-memory-local-trajectory.test.ts` is the synthetic trajectory and
deterministic maintenance-worker check:

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/agent-memory-local-trajectory.test.ts
```

`test/agent-memory-local-model-worker.test.ts` is the optional public-SDK model
maintenance adapter check. It uses Faux transport. It does not select
installation or import the adapter from the extension, kernel, or profile:

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/agent-memory-local-model-worker.test.ts
```

`test/agent-memory-local-projection.test.ts` is the disconnected committed
projection and explicit `Memory(path)` read check. It does not select
installation or read a live private root:

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/agent-memory-local-projection.test.ts
```

`test/agent-memory-local-forgetting.test.ts` is the synthetic logical
forgetting check. It imports an in-memory tombstone snapshot and does not
read a live private root:

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/agent-memory-local-forgetting.test.ts
```

`test/agent-memory-migration-export.test.ts` pages the read-only canonical
`migration-export` action through ABI1 and ABI2. It does not read a live private
root or apply a migration:

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/agent-memory-migration-export.test.ts
```

`test/agent-memory-local-migration.test.ts` is the disconnected shadow adapter.
It seeds an in-memory bundle into a fresh state root and does not select
installation or read a live private root:

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/agent-memory-local-migration.test.ts
```

`test/agent-memory-local-palace.test.ts` is the disconnected synthetic Palace
preview. It checks the metadata snapshot, bounded document read, corpus paging,
loopback page,
and `pnpm memory:palace-preview`. It does not read a live private root or own the
installed `/mh-memory palace` façade:

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/agent-memory-local-palace.test.ts
```

The installed command surface is intentionally smaller: `/mh-memory palace`
opens the immutable ABI2 metadata viewer, `palace close` stops it and `palace json`
returns the legacy structural diagnostic. Earlier context/history/HTML command
names remain hidden compatibility aliases and are covered by runtime/lifecycle
fixtures rather than advertised as product commands.

Those files do not select an installed engine, bind the kernel, or change
profile records. They exercise one in-process coordinator and a service-owned
bare repository. Live maintained memory remains ABI1/ABI2.

Standard explicit installation selects ordinary memory ABI2 through private
per-profile selection metadata; an absent record retains ABI1 compatibility and
explicit off/legacy are preserved. Disposable fixtures additionally exercise
controlled lifecycle failures. Core tests include isolated lease
resolver inputs, separate OS fault actors and native directory-fsync fault
injection; these do not substitute for canonical Root/PSS authority proof. The
required public SDK suite separately exercises genuine Faux native children,
actual output/launch-context binding, physical policy flips and retirement with
replacement-generation overlap. Conservative external-quiescence and orphan-CAS
unavailability remain documented limits, not automatic recovery promises. See
[maintained memory](agent-memory.md#ordinary-memory-engine) for its boundary.
Policy-only interruption recovery has its own typed identity and actual
process-local drain reference, status classification and explicit primary
`policy-reconcile`; publication reconciliation remains separate. Focused policy
fixtures cover abort/revoke/retire at acquisition/staging/pre/post-rename,
paused-recovery refusal, identity/state tampering and restart-without-reference
refusal. The ordinary SDK journey directly exercises registered runtime-tool
AbortController cancellation, fresh status and reconciliation under actual
Root/PSS. Bounded synthetic correction/no-learning/forgetting controls are not
real-model semantic efficacy. See the [policy interruption limit](agent-memory.md#policy-interruption-limit)
for retained unknown/incomplete/restart limits; these focused checks do not replace
fresh independent QA or the final aggregate gates.

Geometry uses public TUI helpers from an explicitly supplied host manifest; it
makes no model/auth calls and does not substitute for rendered testing.

For offline QA without modifying this checkout's `node_modules`, select an
explicit reviewed public-package supply:

```sh
MAHIRO_PI_TEST_MODULES=/absolute/public/node_modules pnpm check:public-sdk
```

The loader maps canonical source imports and required public packages; it never
harvests another runtime's state. SDK fixtures use genuine public packages,
guarded native dispatch, disposable profiles and deterministic Faux transport,
not provider inference. Missing required supply fails, rather than counting as a
successful skip. Old or unattested owners remain fail-closed.
The required SDK suite has no supervisor timeout or output-overflow termination:
its asynchronous runner drains both pipes until natural close, then flushes bounded
private logs and console writes. Capture truncation or I/O failure fails the gate
only after settlement; the private receipt records status/signal, PID/available
PGID, drain certainty and a null timeout. The nonmutating standalone `--plan`
preview retains its separate bounded timeout and absent-profile assertion.

Keep one writer per checkout and serialize heavy tests/SDK/format/geometry jobs.
Independent verification must use a fresh reviewer, not only writer assertions.
Source/Faux passes do not establish installed activation, provider behavior,
rendered quality, memory-use performance or human acceptance.

## Documentation maintenance

[Documentation navigation](README.md) points to one current guide per concern.
Prefer correcting that owner over adding migration summaries or duplicate API
matrices. Remove obsolete pages only after checking incoming references and
preserving necessary contracts; Git retains superseded prose. Keep private
operator paths, project-only policy and runtime incident reports out of public
guides. Local reports belong only under ignored `.agent-state/runtime/`.

`check:docs` checks local links/anchors, navigability, manifest-to-guide ownership,
version/provenance alignment, public-document hygiene and selected security
boundaries. It does not validate external websites or prove semantic truth.
Source/test changes still require contract review. Dated release notes remain
source records, not rewritten histories or current activation instructions.

### Parity score and evidence maintenance

The [Letta parity roadmap](letta-parity-roadmap.md) is the current planning/scoring
owner. Its percentages are rounded editorial evidence summaries, not equivalence,
activation, performance or human acceptance. Keep the baseline date, Mahiro commit
and any audited dirty-diff identity, Letta version/pins, checklist IDs and evidence
references together. Retain old baselines in Git and explain old/new domain values
and weighted totals in the roadmap revision table; never silently edit a score.
The [R0 contract appendix](letta-parity-r0.md) owns the detailed gap/owner map,
selected directions, read-only differential commands and L/D/N/I/O/H worksheets;
the roadmap remains the status/scoring owner.

Scores move only with cited evidence layers: source 50%, installed integration
20%, observed runtime 20%, human acceptance 10%. Missing evidence earns no credit
but is not automatic behavioral failure. Documentation, local regressions and
Faux/SDK checks cannot earn installed/runtime/human credit by assertion. Planned
work and approved C exclusions earn no implementation points; any scope or
weight/denominator change needs explicit approval. Recalculate after material
contract/implementation changes, new layer evidence or a new upstream differential,
including downward corrections. A fresh verifier must challenge material score
movement against final source and receipts; human acceptance stays Mahiro-owned.

### Latest-source differential verification

For a parity claim, record both exact Letta pins and compare executable owners,
not just upstream guides or matching names. The baseline comparison is previous
`5dea67021b99810707ff753db35e4534f70ff1fd` to v0.34.31
`a8900b882446d7aa99fedf2845d400743affd1b6`. Distinguish existing architecture
from latest config-root isolation and Git-helper termination changes. Follow R0's
owner map and A/B/C decisions before changing behavior; upstream source-guide
contradictions must be resolved in favor of executable evidence.

Record read-only source-diff commands, symbols, chosen outcome and deliberate
deltas. Design defect-specific synthetic fixtures for schema/projection,
assistant-step counting, captured-range watermarks/replay, recovery disposition,
root isolation and helper teardown. Label local regression, latest-source
differential, SDK, installed, observed/runtime and human evidence separately.
Running upstream tests, installers or generators is not required or implicitly
authorized. Do not import private runtime, corpus or credentials for a fixture.
Keep sensitive receipts ignored and publish only sanitized evidence summaries.

A specification/source-test milestone does not reopen Phase H/Phase I, install an
engine, migrate memory or authorize a release. Use explicit scoped checks; full
source/SDK/release tiers and live probes retain their separate approval gates.

## Source releases

The package is intentionally `private: true` / `UNLICENSED`. The release channel
is **GitHub source releases**, not npm publication or a license grant. A release
request does not authorize authentication, profile, model or runtime changes.

1. Obtain explicit commit/push/release scope. Inspect branch, index, remote and
   existing tags; preserve local work and reconcile concurrent changes normally.
   Do not reset others' work, rewrite history or force push.
2. Choose a version from actual release history. Align `package.json`, package
   validation, every exact guard provenance pin, README and a dated release note.
   Do not widen provenance to accept arbitrary versions.
3. Update current guides and third-party notices as needed. With explicit release-gate
   authorization, run `pnpm check:release` serially and obtain independent review against
   the final source, not an earlier checkpoint. Report any suspended/unrun tier truthfully;
   focused checks are not a passing combined release gate.
4. Inspect the exact approved diff/artifact inventory. Keep profiles, credentials,
   transcripts, caches, installed copies and runtime reports out of source payloads.
   `.gitattributes` excludes `.agent-state` and `.pi` from source archives; this is
   not history erasure or permission to commit private state.
5. Use the [commit skill](../skills/git-commit/SKILL.md) for an authorized scoped
   commit; verify the resulting stored message and commit. That role does not push,
   tag or release.
6. Push normally. Create a new annotated version tag at the verified commit;
   never replace an existing tag. Publish reviewed notes through GitHub.
7. Create a source archive from that tag, inspect its paths/content and attach a
   SHA-256 checksum manifest. Do not use `npm publish`.
8. Verify remote branch/tag identity, published URLs, downloaded asset hashes and
   archive inventory, including GitHub's automatic source archives. Command
   submission alone is not a release receipt.

Publication does not install dependencies, update profiles, reload sessions,
select themes, activate Web observation or close human-owned tasks. Follow the
[upgrade guide](getting-started.md#upgrade-safely) for intentional activation.
