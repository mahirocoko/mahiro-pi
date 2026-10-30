# R4 — Bounded ABI2 source/SDK checkpoint

[← Roadmap](letta-parity-roadmap.md) · [Memory contract](agent-memory.md)

## Scope and decision

R4-01–04 and R4-S are complete at the deterministic disposable source/SDK
layer. R4-I, R4-O and R4-H remain open. The verdict remains **NOT ALIGNED**;
60% source capability / 30% end-to-end parity are unchanged. This checkpoint
is not installation, provider-backed inference, daily-primary acceptance or a
live cutover. Production required no change.

**R4-02:** `lib/agent-memory/local/**` stays disconnected synthetic/shadow
code. Extension, kernel, profile and runtime do not import it. There is no ABI3,
fallback, second publication owner or installer/default/profile/private change.

## R4-01: selected owners and executable receipt

`lib/guards/test/managed-memory-route-sdk-test.mjs` uses the public SDK loader,
package extension, kernel, PSS and subagents in a newly owned disposable
profile/project/session/root. Its canonical writer descriptor is copied
byte-for-byte from `agents/managed-memory-writer.md`; no role is rewritten.
Only the in-memory Faux provider/transport supplies the declared route. Network
fetch is forbidden; no credential or provider inference is performed.

The actual ABI2 controller (`lib/agent-memory/experimental-runtime.ts`) owns
admission and parent completion handling. Kernel owns primary/child identity,
generation and root-bound leases. The ABI2 data engine owns observations,
private views and committed reads. `MemoryPublisher` and its real controller
own integration/reconciliation. `before_agent_start` owns later committed
projection through public prompt replacement. The local service owns none of
this route.

The fixture proves:

1. Loading does not create an absent root. Explicit initialize sets automatic=true.
2. Eligible source=`rpc` input genuinely settles and records one native
   unverified observation; one automatic managed-memory writer starts without
   manual reflection or fabricated observation/completion/publication.
3. The genuine child executes confined Memory read/edit/commit calls. At its
   post-ready response gate it is still running, is not primary, and cannot
   advance committed revision/Core or the reviewed cursor.
4. Releasing its native response produces actual completion. The parent's
   completion wakeup drives real publication/reconciliation: revision/Core
   change, the episode becomes reviewed and child access expires.
5. The already-started run's prompt is unchanged. A later source=`extension`
   request sees exactly one updated managed-memory block plus native preamble,
   without creating a second automatic worker.

## R4-03: focused negative evidence, not a duplicate matrix

| Boundary | Executable owner |
| --- | --- |
| Child is not primary; ready while running is not publication; expired lease | New route fixture |
| Completed-but-not-ready never publishes; parent launch permission loss and native root/generation replacement block adoption | `lib/guards/test/managed-memory-engine-operations-test.mjs` |
| Conflicts, lower-level config/current-authority fences and no-learning reviewed metadata | `test/agent-memory-engine.test.ts` |
| Real running ready worker retired on completed/cancelled/shutdown navigation | `lib/guards/test/managed-memory-tree-sdk-test.mjs` |
| Lifetime joins and exact identity resolution | `test/agent-memory-engine-lifetime.test.ts` |
| Locked descriptor and physical route preflight without auth resolution | `test/agent-memory-profile.test.ts` |
| Compaction metadata-only admission; usability and local denials | `test/agent-memory-compaction-sdk.test.ts`, `test/agent-memory-usability-sdk.test.ts` |

These suites own their existing negatives; the new fixture does not claim to
re-exercise every boundary. Faux proves route binding, not provider authorization,
model quality or rendered TUI/RPC acceptance. Independent QA remains a separate
review of this source checkpoint.

## R4-04: bounded cleanup and rollback

The fixture uses `createDisposableMemoryFixture` and its exact owned capability.
It releases the response gate, aborts only its service's children, waits for
native work, emits session shutdown, disposes the session and then calls the
owned fixture disposer. It verifies root deletion and registry retirement,
restores environment/fetch and never force-removes an unknown or active root.
The ready wait has a 30-second deadline. Public-SDK staging uses the existing
`stagePermissionFixture` owner and cleans only its newly allocated stage.
The whole-state gate remains below 1 GiB; no pruning of unknown/live state.

Rollback here is removal of disposable fixtures and source changes through
ordinary reviewed Git workflow. There is no live rollback: nothing was
installed, activated, reloaded, migrated or published into a private root.
Any future live activation needs separate authorization and R5 safety gates.

## Reproduce the source checkpoint

Run the new fixture with the declared public dependency loader:

```sh
node --import ./test/public-dependency-loader.mjs --test lib/guards/test/managed-memory-route-sdk-test.mjs
```

The existing engine SDK fixtures require the existing public-package staging
owner (`stagePermissionFixture({ patched: false })`), because they resolve
`lib/guards/node_modules` in that owned stage. Do not create a sibling-runtime
supply or change their contract to mask missing staging. The new fixture is
also in the explicit `check-public-sdk.mjs` inventory, but aggregate suites
are not required for this bounded checkpoint.
