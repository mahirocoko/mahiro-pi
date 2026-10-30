# R3 — Synthetic trajectory and progress contract

Source/synthetic adaptation record, 2026-10-30. Current implementation owner:
`lib/agent-memory/local/trajectory.ts`; coordinator execution/publication remains
`lib/agent-memory/local/service.ts`. This is disconnected local-service behavior,
not a live ABI, installed reflection route, default-policy change or activation.
The [roadmap](letta-parity-roadmap.md#r3--reflection-trajectory-watermark-and-replay-semantics)
owns status and scoring. Fresh source review completed R3-S; R3-I/O/H remain
open. Overall scores remain **60% source capability / 30% evidence-backed
end-to-end**.

## Comparator and policy choice — R3-01–02

The comparator is Letta Code **v0.34.31**: `settings-manager.ts` supplies the
effective fresh threshold **25**; `reflection-transcript.ts::countAssistantRows`
counts completed assistant rows. Captured boundaries and success/no_changes
settlement inform this adaptation. This records source comparison, not execution
of the upstream product or a claim of differential acceptance.

The caller supplies a bounded array of finalized synthetic rows. An `assistant`
row is one finalized step; `user` and `tool` rows never contribute to the trigger.
There is no streaming, unfinished or reasoning role, and no native Pi session or
transcript reader. A caller passing unfinished assistant text violates this input
contract; the service cannot independently establish finalization.

Constructor policy remains explicit: `off`, `compaction`, or `step-count` with an
explicit integer threshold from 1 through 128. Threshold 25 is supported but is
not a new default. No per-conversation live setting is added. With policy off no
new chunk is queued; an existing captured job can still be inspected/resumed.

The states are separate:

1. **Observation:** normalize at most 128 entries for exactly one session/branch.
2. **Eligibility:** count assistant entries strictly after the settled order, or
   require a supplied compaction marker. No job exists below the threshold.
3. **Capture/queue:** persist the selected chunk plus the captured omitted IDs.
   Queueing is not worker launch; the harness explicitly calls `start(jobId)`.
4. **Holding:** repeated callbacks and late tails return the same job/digest.
5. **Settlement:** only integrated or verified no-op jobs advance their branch.
6. **Continuation:** a settled job's omitted IDs authorize the next bounded chunk
   without a second threshold/compaction trigger. Only that captured prefix drains.
   A later appended tail waits for a fresh trigger after the prefix finishes.

## Captured ranges, privacy and retention — R3-03

Each worker chunk contains at most **8 entries**, **1024 UTF-8 bytes**, and
**256 UTF-8 bytes per entry**. Input text is hard-bounded to 65536 bytes per row.
Before truncation, native `hasSecret` examines the whole row. A matching row is
replaced in full by the fixed inert marker `[Secret-bearing entry withheld]`.
Then UTF-8-safe truncation runs. There is no reasoning ingestion or raw-secret
fallback. User, assistant and tool error text are equally untrusted evidence;
text does not grant tools, preferences or permissions.

For compatibility the existing `truncated` flag and `truncatedEntryCount` mean
**redacted or truncated**, not truncation alone. They do not distinguish the two.
This is a recognizable-pattern filter, not a guarantee that arbitrary secrets
are detected. Existing persisted snapshots are not rewritten or migrated by R3.

The selected IDs followed by omitted IDs must exactly match the supplied pending
prefix. Missing IDs, insertions and reorderings fail closed; only a later tail is
ignored. Selected role/order/timestamp/identity and projected text are checked.
Compatibility limitation: old and new snapshots persist **only IDs** for omitted
rows. They cannot prove omitted text/metadata was unchanged before its later
selection, nor detect changes beyond a selected row's sanitized/truncated view.
No raw omitted corpus or new persisted hash schema is introduced. Callers must
retain the immutable source array; this is not full-transcript integrity proof.

Job snapshots and branch watermarks retain the existing local-service schema and
retention. There is no new corpus, transcript archive or persisted progress
record. A compaction marker never discards the unreviewed earlier prefix.

## Progress, settlement, replay and retry — R3-04

Every reflection receipt has bounded, non-persisted `progress` metadata:

| Field | Meaning |
| --- | --- |
| `observedEntryCount` | Number of normalized caller rows, at most 128. |
| `pendingAssistantStepCount` | Finalized synthetic assistant rows after the settled watermark, including any later tail. |
| `settledOrder` | Current branch watermark order, or zero. |
| `configuredThreshold` | Explicit step threshold, otherwise null. |
| `capturedEntryCount` | Selected plus omitted count for the returned chunk, otherwise zero. |

This is observation, not learning quality, execution status or human acceptance.
No text, paths, secrets or progress history are added to it.

Watermarks remain job/digest/session/branch-bound and monotonic. Duplicate
settlement is idempotent; stale completions cannot rewind a later watermark.
Failed, committed-but-unintegrated, conflicted and explicitly retried jobs do not
settle. `retry(jobId)` reuses only a failed reflection's immutable snapshot and
never launches a worker. [R5 recovery](letta-parity-r5.md) adds explicit synthetic
repair/abandon; neither transition settles progress. Repaired/abandoned snapshots
release the held range for a fresh eligible job only with captured-range coverage.
Resume and retry cannot repair conflicts or reopen either terminal state.

Ordinary selection is the pending prefix of the explicit caller array. Replay
requires an exact job ID and digest from the same session/branch; it returns
immutable captured evidence without queueing, launching, settling or draining.
It does not change ordinary progress. Cross-conversation selection and hosted
recent/automatic/manual transcript discovery are unsupported. Replay is not a
retry and cannot grant historical text current authority.

## Source regression evidence — R3-05

`test/agent-memory-local-trajectory-r3.test.ts` directly targets:

- threshold 25 with 75 mixed user/assistant/tool rows (all-entry counting would
  trigger too early), independent of the eight-entry worker cap;
- ten bounded no-op chunks draining exactly the captured prefix, with a late
  assistant tail left below threshold;
- held/failed snapshots under append, deletion, insertion, selected rewrite and
  reorder; explicit retry and immutable replay without watermark movement;
- full-row secret scanning before UTF-8 truncation, inert replacement and the
  intentionally shared metadata flag.

`test/agent-memory-local-trajectory.test.ts` retains integrated/no-op, failure,
conflict, restart, branch isolation, compaction overlap, bounded bytes, retry and
persisted-record rejection cases. Its step-count fixtures now supply assistant
steps where they intend a trigger. Model-worker companion tests cover the
isolated callback and failure/abort budgets, not live reflection delivery.

Reproduce the narrow source tests:

```sh
node --import ./test/public-dependency-loader.mjs --test \
  test/agent-memory-local-trajectory.test.ts \
  test/agent-memory-local-trajectory-r3.test.ts
```

Fresh independent source review passed the counting, captured-prefix, privacy,
watermark, retry/replay and compatibility claims with no blocking finding. These
remain synthetic source tests, not upstream runtime, installed, observed
daily-primary or human evidence. In particular no installed
producer, cancellation lifecycle, live provider outage, private-root migration,
longitudinal usefulness or rendered progress acceptance is established here.
