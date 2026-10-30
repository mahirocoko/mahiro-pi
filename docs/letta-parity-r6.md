# Letta parity R6 — operator outcomes and disconnected shadow safety

[← Roadmap](letta-parity-roadmap.md) · [Memory contract](agent-memory.md) · [R5 recovery](letta-parity-r5.md)

## Checkpoint and owners

Source/synthetic checkpoint against Mahiro `f240b89`, task
`ebe33d2f-2c33-4e90-a6ae-65ecb0149e41`. **R6-01–04 source specification and
R6-S are complete only within the explicit unavailable states below.** This is
not completion of migration, backup/restore or cutover. R6-I/O/H remain open;
roadmap scores remain **60% source / 30% evidence**. No Phase I is added.

That specification checkpoint introduced no operator executor. The subsequent
bounded source slice, task `4135aadb-95bf-4bd4-986d-5651cef2ec5a`, adds only the
[fixed-synthetic rehearsal](#fixed-synthetic-rehearsal-operator) below, implemented
from Mahiro base `d0a55716347179ef127812ddb6fe12492a9b4eae`.
`docs/agent-memory.md` owns current memory use; this appendix owns the bounded
R6 outcome specification and disconnected rehearsal contract.
`migration-export.ts`, ABI1 `store.ts` and ABI2 engine management own committed
metadata export. `local/migration.ts` owns disconnected bundle validation,
shadow receipt and target quarantine; `local/forgetting.ts` and `local/service.ts`
own logical exclusions. R5 remains the recovery/lifecycle owner, including its
cooperative process and uncertainty limits. None of these local owners is wired
into the extension, kernel, installer, profile or live prompt.

## User-job inventory — R6-01

“Supported” below names an existing source-level product owner, not new installed
acceptance. “Synthetic-only” never means a live command is available.

| User job | Availability | Existing owner / limit |
| --- | --- | --- |
| Inspect memory readiness/reflection status | Supported | `/mh-memory status/help`, authorized `agent_memory_manage` status/doctor; unknown remains unknown. |
| Configure reflection | Supported through existing policy/setup ownership | Private automatic policy and explicit installation choices; startup does not enable it. No new R6 configuration surface. |
| Request bounded maintenance | Supported | `agent_memory_reflect`, exact-root authority and locked writer; not arbitrary transcript replay. |
| Select/replay conversations | Unavailable | R3 has synthetic captured-prefix/non-executing replay semantics, not an operator conversation replay command. |
| Inspect knowledge structure | Supported, bounded | Manage `palace` metadata inspection is not knowledge history or a text diff. |
| Diff knowledge / browse knowledge history | Unavailable | Internal Git and lifecycle records do not constitute this user workflow. Prospective R7 work. |
| Export committed migration metadata | Metadata-only | Manage `migration-export`, ABI1/ABI2, five paged sections and active SHA-256 hashes; no file text or backup. |
| Assemble a content bundle | Synthetic-only, caller-supplied | `ShadowMigrationBundle` carries supplied bytes, pages and read envelopes; not authenticated source capture. |
| Verify/seed a disconnected shadow | Synthetic-only | `openShadowMigration`, fresh owned target and version-1 receipt; no source access or live publication. |
| Roll back a managed revision | Supported by existing manage owner | Revision rollback under current forgetting policy, not source-route restoration or shadow quarantine. |
| Quarantine a shadow target | Synthetic-only | `rollbackShadowMigration`, exact identity and quiescence; rename only, not revision rollback. |
| Backup / restore | Unavailable | Neither metadata pages, caller bytes nor quarantine provide a validated disaster-recovery product. |
| Active migration | Unavailable | No live import, switching of active memory or operator migration command. |
| Authority cutover / restore prior route | Unavailable | No live authority replacement, profile change or route restoration. Separate future approval required. |

## Six distinct outcomes — R6-02

1. **Metadata export:** committed pages, hashes, source associations, forgetting
   metadata and reviewed IDs. It cannot reconstruct content on its own.
2. **Content bundle:** caller-supplied active file bytes with hashes and committed
   read envelopes. This is an in-memory input contract, not a source acquisition
   tool or a backup format with a restore guarantee.
3. **Shadow verification:** a fresh disconnected local target, exact seed
   reconciliation and a receipt. Success proves local self-consistency only.
4. **Active migration:** unavailable; shadow success does not move the source or
   make the target active.
5. **Backup/restore:** unavailable; no completeness, custody, recovery-point or
   restore validation contract is executed here.
6. **Authority cutover:** unavailable; no active-root selection, permission,
   prompt, installation or prior-route restoration is performed.

The similarly named rollbacks are not interchangeable. Managed revision rollback
changes maintained knowledge through its existing revision owner and must honor
current exclusions. Shadow rollback retires handles and renames only its exact
quiescent target into quarantine. It neither restores a managed revision nor
restores an earlier route. Quarantine is retained evidence, not secure deletion.

### Paging, freshness and provenance

All five sections (`binding`, `sources`, `forgotten-paths`, `forgotten-sources`,
`reviewed`) must be complete, including one empty page for an empty section.
Pages repeat the same revision/config hash/ledger digest and section total.
Starting at offset zero, each page has `min(limit, total - offset)` entries and
continues at its exact end; the terminal page is unique. Missing first, middle
or final pages, duplicate/overlapping pages, gaps and extra empty terminal pages
refuse. Limits remain at most 32 entries. Every exported active row needs matching
supplied bytes, whole-file SHA-256 and ordered source IDs. Required `Core.md` and
`index.md` must survive filtering. Malformed input refuses before writing an owner.

The read envelope must agree on `revision`, `currentRevision`,
`basis: "view-snapshot"`, `freshness: "current"`, path, hash and sources.
These are **caller assertions**, not authenticated evidence that the adapter
read a source or that the source remains current. Even a wholly fabricated but
self-consistent bundle can pass. A source change after collection is not observable
by this disconnected adapter. The caller must perform a **final canonical
revision/currentRevision check immediately before shadow open**, using the
source's authorized owner, and abandon/recollect on mismatch. That check does not
create an atomic cross-owner source lock or attest human consent. The adapter
cannot enforce it, authenticate provenance, or grant access to a private root.
Export/read authority and target creation consent remain separate requirements.

## Forgetting and resumability — R6-03

Forgetting is logical non-resurrection, **not secure Git-history erasure**.
Import filters excluded paths/sources before seeding and carries exclusions into
workspace access, publication, projection and later seeds. Only bytes already
explicitly supplied can contribute blob exclusions. Do not retrieve forgotten
content merely to infer historical blob tombstones; path/source exclusions do
not imply exhaustive knowledge of historical aliases or blobs.

Protected Core/index path exclusions refuse. A source exclusion that suppresses
either required owner also refuses before creating a target: revise compact
owners through their authorized owner first, removing excluded knowledge and
source links while preserving a valid identity/index. Blob filtering may hide
required compact content without deleting its required tree entry under Phase F;
that is not permission to expose an excluded blob.

The version-1 migration receipt binds the **initial** forgetting digest. If policy
later evolves, reopening an old bundle refuses rather than resetting the policy
or reseeding forgotten bytes. It does not rewrite the receipt to pretend the old
import is current. Ordinary local service operations remain their own owner;
there is no new policy-upgrade/rebase workflow here. Current exclusions continue
to govern conflict recovery and managed rollback under existing contracts.

Owner and seeded interruption checkpoints resume only for the same export digest,
root device/inode and exact seed manifest. Changed bundles, changed equal-length
content, replaced repositories or changed root inode at the same pathname refuse.
No path-only adoption or automatic cleanup of uncertain roots is permitted.
Reopen after a completed import verifies the original receipt and initial tree;
later legitimate commits may descend from that initial head. It is not a reset.

## Future preview/apply contract — R6-04 (specification only)

No **active migration** preview/apply executor is provided. The fixed-synthetic
rehearsal below implements only disconnected target review and receipts. A future
active migration proposal must separately obtain scope approval and specify at least:

- A non-mutating preview identifying the exact canonical source owner, revision,
  config/ledger hashes and forgetting-policy identity, and exact target identity,
  including device/inode plus owned repository/nonces once created.
- An operation identity binding the reviewed manifest, file/byte totals, source
  acquisition provenance, exclusions, destination, intended outcome and consent.
  Content/hash agreement is not consent or source authenticity.
- Apply-time revalidation of source freshness, target identity, policy and grants;
  stale/mixed/replaced inputs refuse, with no silent source or target substitution.
  Prior route/profile choices must be preserved explicitly; a shadow receipt is
  not a cutover token.
- Durable bounded receipts distinguishing previewed, interrupted, refused,
  shadow-verified, applied and quarantined states. Refusal/failure must identify
  the stage and reviewed operation without content/credentials. Current errors
  are not durable failure receipts; existing owner records mark partial creation
  and version-1 receipts mark successful shadow verification only.
- Exact idempotent resume, no rerun with changed inputs, and retained evidence on
  uncertain publication. Quiescent target quarantine must not be advertised as
  managed revision rollback or prior-route restoration. Any future restore must
  reapply current forgetting and prove non-resurrection before publication.

This source specification preserves original memory and unrelated profile choices
by performing no live operation. Installed rehearsal, actual-command observation,
post-rollback next-request projection and Mahiro's clarity/safety acceptance remain
R6-I/O/H, not inferred from these fixtures.

## Fixed-synthetic rehearsal operator

`node memory-rehearsal.mjs` is a standalone source operator, not an installed Pi
command, migration product or live authority selector. It accepts exactly
`preview|apply|status|rollback`, `--target` and `--fixture r6-basic-v1`.
`apply` and `rollback` additionally require the exact `--operation` and `--expect`
returned by preview. Unknown, duplicate, missing and alternate-authority flags
refuse. There is no source root, agent directory, content/bundle file, URL,
provider, shell, private shadow or profile fallback. One repository-authored
synthetic bundle supplies Core, index and a logically excluded synthetic file.

Create a **new disposable parent**, named `mahiro-memory-rehearsal-` followed by
16 lowercase hexadecimal characters, and its empty `shadow` child. Pass that
child's canonical absolute path explicitly; no cwd, home or default target exists.
All components must be unlinked canonical directories. Initial preview requires
that dedicated parent to contain only `shadow` (plus the held sibling claim).
It does not create a directory for you or adopt a populated shadow.

```text
node memory-rehearsal.mjs preview --target <canonical-disposable-parent>/shadow --fixture r6-basic-v1
node memory-rehearsal.mjs apply --target <same-target> --fixture r6-basic-v1 --operation <preview-operation> --expect <preview-expect>
node memory-rehearsal.mjs status --target <same-target> --fixture r6-basic-v1
node memory-rehearsal.mjs rollback --target <same-target> --fixture r6-basic-v1 --operation <preview-operation> --expect <preview-expect>
```

Preview is **non-mutating for target contents**, not globally read-only: it
creates/uses the existing sibling cooperative claim and writes bounded review
metadata at `<parent>/rehearsal.json`. Status normally uses that same claim but
does not open/reconcile the service or edit the receipt. Terminal quarantine
status/exact retry is read-only, but success requires revalidating the exact
canonical non-symlink moved directory, recorded device/inode and migration
owner/receipt identities and digests. Deleted, replaced or linked quarantines
return unknown/refused without adoption, mutation or rewriting terminal evidence.
The public result/stdout exposes only a bounded opaque `quarantineId`, never the
absolute target, parent or quarantine path. Exit 0 reports a verified
preview/shadow/quarantine result; exit 1 reports refused/unknown, and exit 2 is a
strict CLI usage refusal.

The version-1 rehearsal record is separate from unchanged `migration.json` v1.
It binds operation identity, target-path digest, reviewed parent/root device and
inode, and the existing migration validator's fixed-fixture review digest.
Apply compares these **inside the existing migration turn and cooperative root
claim**, before creating a migration owner. Replacing reviewed empty target A
with empty target B at the same pathname refuses without rewriting the plan.
Narrow internal migration helpers validate their exact turn/claim capability;
there is no second lock or nested claim. Seeding, forgetting import, receipt
verification, quiescence and quarantine remain their existing owners.

The record is strictly shaped, checksummed and digest-chained, at most 64 KiB
and 16 events. Its progression is `previewed → applying → shadow-verified →
quarantining → quarantined`. Intent is saved and read back before mutation;
terminal evidence is saved and read back before success. Refused/unknown attempt
events do not replace earlier terminal truth. Exact successful retries are
idempotent; attempts deduplicate, and exhausted event capacity refuses new
mutation. The verified shadow event binds the existing migration receipt digest;
rollback rechecks it and the migration owner's exact identities/quiescence.
Terminal quarantine evidence strictly encodes the relative suffix, moved device
and inode, and migration owner/receipt digests, with that receipt digest bound to
the verified shadow event. It is captured and verified after rename before
terminal success, then revalidated on status and exact rollback retry. These
checks do not claim resistance to concurrent hostile same-user metadata edits.
Records contain only bounded opaque metadata, never absolute paths,
corpus/prompt text, credentials, transcripts or raw exceptions.

Durability is **process-restart durability at verified record boundaries**, not
whole-service power-loss atomicity. Interrupted `applying` or `quarantining`
stays unknown; this smallest operator has no resume/reconcile/takeover command.
Even if a migration receipt was written, an absent rehearsal terminal event is
not success. A crash after rename without a terminal quarantine receipt remains
unknown; missing original target is not evidence of success. Dead, partial,
retained or poisoned claims block automatic takeover and are never age/PID-cleared.
If the claim or receipt cannot be safely accessed, the result is unknown without
a claim of durable failure recording. Retain the disposable evidence for separate
review rather than deleting claims, guessing identity or retrying another target.

Rollback means **exact disconnected target quarantine only**. It neither rolls
back a managed revision, restores an earlier route, activates memory, provides
backup/restore nor securely deletes anything. There is no extension, router,
kernel, installer, profile, bootstrap, maintenance CLI, manifest, role or live
ABI1/ABI2 wiring. R6-I/O/H, Phase I, installed/provider/browser/network operation
and Mahiro's acceptance remain outside this source slice. Scores are unchanged
pending independent assessment, not increased by adding the operator's name.

## Source evidence — R6-S

`test/agent-memory-local-migration.test.ts` directly covers missing sections and
first/middle/final pages; duplicates, overlap and empty terminal duplication;
mixed revision/config/ledger/totals; absent active bytes; inode replacement for
owner-only, seeded and completed targets; protected path/source exclusions;
old-bundle reopening after policy evolution; exact owner/seed resume; changed
hashes, corpus-scale seed reconciliation, learning/retrieval/restart, conflict
retention and quiescent quarantine ordering.

The cheap falsifier initially accepted a duplicate empty terminal `reviewed` page.
The bounded `groupPages` fix rejects pages after termination and noncanonical
page lengths, without changing export schemas, version-1 receipts/records or
claiming source freshness. Adjacent migration-export, local-forgetting, store,
engine and runtime tests retain the live metadata-only and logical-forgetting
contracts. Source/synthetic checks are not independent installed or human acceptance.

`test/agent-memory-local-rehearsal.test.ts` and
`test/memory-rehearsal-cli.test.ts` add fixed-fixture process-restart journeys,
exact idempotence, strict flags, the A/B target replacement falsifier, reviewed
receipt checks, bounded/tampered records, retained claims, under-claim capability
refusal and intent/post-rename unknown cases. Terminal replay regressions also
cover deleted/replaced/symlink quarantine paths, changed owner/receipt/service
identities, strict malformed moved evidence and fresh/replay path-free output.
These remain source/synthetic
rehearsals, not R6-I/O/H completion.
