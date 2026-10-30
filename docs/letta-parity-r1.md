# Maintained-memory R1 schema, projection and discovery contract

[← Memory](agent-memory.md) · [Roadmap](letta-parity-roadmap.md) · [R0 baseline](letta-parity-r0.md)

This page freezes the R1 source decision against Letta Code `0.34.31`, commit
`a8900b882446d7aa99fedf2845d400743affd1b6`. It is a **documented native
adaptation**, not MemFS v2 wire, path or runtime compatibility. Installed and
observed gates remain open.

## Selected schema

Mahiro retains its current private Markdown/Git schema. The Letta comparator uses
root `MEMORY.md` as a frontmatter-free overview, other root Markdown as core prompt
memory, and indexed child directories as deferred memory read through
`Memory(path)`. Mahiro maps those jobs as follows:

| Letta v0.34.31 contract | Mahiro owner | Placement | Decision |
| --- | --- | --- | --- |
| Root `MEMORY.md` overview/index | `index.md` | Baseline prompt | Adapt the discovery job; do not rename the private corpus. |
| Root `persona.md` and other root core Markdown | `Core.md` plus optional `system/persona.md` | Baseline prompt | Adapt identity/core ownership while preserving required Core. |
| Indexed child `MEMORY.md` and descendant Markdown | `system/human/**`, `reference/**`, `projects/<id>/reference/**`, `procedures/**` and compatible legacy detail | Deferred | Adapt to bounded path/topic/query discovery; Mahiro does not accept arbitrary nested Markdown. |
| Project context discovered from indexes | Current project's `system/overview.md` and `system/conventions.md` | Baseline prompt | Intentional native project tier; other project files remain deferred. |
| Attached shared-memory repositories | No equivalent maintained-memory path | Excluded | Intentional non-parity; no hosted/shared authority by analogy. |
| Agent-owned skills under memory | Package/runtime skill owners | Separate | Skills are not memory files and R2 selected zero new package skills. |

`test/fixtures/agent-memory/letta-v03431-schema.json` records the executable
comparison sources and representative mapping. `test/agent-memory-schema-parity.test.ts`
checks the mapped Mahiro paths against the actual allowlist and always-loaded rules.
It does not execute upstream code or prove installed parity.

### Path and collision rules

Mahiro paths are portable relative paths with explicit `Core.md`/`index.md`
owners and lowercase namespace rules selected by `engine/schema.ts::allowedPath`.
Unsupported examples include Letta's literal
`MEMORY.md`, uppercase project IDs, arbitrary directory depth and shared-memory
mount paths. There is no automatic reverse conversion from an arbitrary Letta
repository. Import requires a separately reviewed mapping and must preserve
frontmatter, source IDs, forgetting and authority boundaries.

Legacy `global/<name>.md` maps to `system/human/<name>.md` and
`deferred/<project>/<name>.md` maps to
`projects/<project>/system/<name>.md`. Migration first preserves the original at
`archives/legacy-v1-<source-revision-prefix>/...`. An existing archive path may be
reused only when body hash, UTF-8 byte size and ordered source IDs are identical;
a mismatch fails with `Legacy migration archive collision` before the legacy
source is removed. An existing target path remains authoritative, while the legacy
body is retained in its verified archive. Migration never merges two meanings
silently.

## Projection and state identity

The automatic set for one project is exactly:

1. required committed `Core.md`;
2. required committed `index.md`;
3. optional committed `system/persona.md`;
4. optional committed `projects/<project>/system/overview.md`;
5. optional committed `projects/<project>/system/conventions.md`.

Everything else is deferred or excluded. Archives are retained evidence and are
never automatic prompt content. Skills remain separate. The numbered list defines
membership, not a serialized Git-batch order: tiered paths are sorted for the
bounded read and returned in separate system/project-system fields. Owner-specific
byte ceilings and the total configured memory ceiling still apply. The projection
resolves one committed revision and reads one bounded Git batch. Project identity
is the configured canonical project ID or a collision-checked digest of the
canonical checkout path without rewriting the project map.

Use these terms precisely:

| State | Meaning |
| --- | --- |
| Committed | Published Git revision and ledger; publication truth. |
| Draft/view | Private proposal bound to a base revision; not prompt truth. |
| Integrated | A successful publication result whose commit is now reachable as the canonical head. |
| Projected | Immutable data returned from one committed revision by the projection owner. |
| Active prompt | Projection actually supplied to a later eligible Pi request. Source projection tests alone cannot prove this state. |

A memory edit cannot change the already-running request. A later request may
refresh from the new committed revision. The disconnected local
`compilePrompt()` result identifies its local commit only; it is not evidence that
Pi used those bytes.

## Deferred discovery outcomes

Mahiro uses exact path reads, bounded namespace/topic listing and bounded lexical
AND search. Directory indexes and frontmatter descriptions are discovery cues, not
semantic ranking. Callers must follow `nextOffset` until the selected result set is
exhausted. A successful no-match applies only to the scanned selection and pages;
it does not prove the whole authorized corpus lacks the concept.

Every path/query result carries snapshot basis, base/current revision, freshness,
whole-file hash and source IDs. A private draft is labeled as such. A stale view or
changed committed revision is reported rather than rebased silently. Unicode path
reads page by code point; directory/topic pages use entry offsets. Missing,
unsupported, forgotten or foreign-project paths fail or disappear according to
their current authority and forgetting state; tombstones prevent later rollback or
seed inputs from resurrecting excluded knowledge.

Representative future-request trace:

1. `index.md` advertises “deployments and rollbacks” and links the relevant owner.
2. A later request asks how rollback is handled without naming a memory path.
3. The agent follows that cue or uses bounded lexical search for `rollback`.
4. It reads only the selected deferred file and verifies revision/freshness.
5. It applies current repository/runtime evidence above remembered detail.

A valid file that no natural request can discover remains discovery debt. Whole-
corpus injection, embeddings and hidden semantic ranking are not part of R1.

## Differential fixture matrix

| Case | Required result |
| --- | --- |
| Required Core/index | Missing either owner refuses projection or retained-layout certification. |
| Optional persona/project owners | Absence is explicit and does not invent content. |
| Root/nested Letta paths | Mapping fixture labels adapted or unsupported paths; names alone do not establish compatibility. |
| Mixed legacy layout | Global/deferred originals are archived, target collisions preserve the target and archive-identity collisions fail closed. |
| Forgotten path/source/blob | Omitted from reads, projection, rollback and later synthetic seeds; required-owner exclusion fails closed. |
| Stale revision/view | Returns stale/conflict identity; never relabels a draft as active prompt. |
| Unicode/paging | Code-point and entry paging preserve exact text/path identity and expose continuation. |
| Contradictions | Stored conflict or supersession evidence remains explicit; mechanical retention does not decide semantic truth. |
| Future-request discovery | Finds deferred detail through advertised cues or bounded search without knowing the path first. |

Local schema, retrieval, projection, forgetting, migration and the pinned mapping
fixture provide source regression coverage. Archive-collision regressions directly
exercise the shared identity guard; source review traces both ABI1 and ABI2
migration call paths before source removal. They do not establish installed
routing, observed next-request refresh, longitudinal discoverability or Mahiro's
human acceptance. R1-I/O/H remain open and scores do not move from this source
checkpoint alone.
