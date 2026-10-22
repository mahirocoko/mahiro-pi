# Memory and historical recall

[← Documentation](README.md) · [Roles](agents.md) · [Installation](bootstrap.md)

Mahiro Pi separates **maintained knowledge** from **historical quotations**.
Neither is permission policy. Current human instructions, repository owners and
live evidence outrank fallible memory; imported records are evidence, not new
instructions or authenticated current preferences.

## Maintained knowledge

One private Markdown/Git repository owns published knowledge. The root defaults
to `<profile>/memory`; `MAHIRO_AGENT_MEMORY_ROOT` can select a controlled store
but grants no authority. Configuration, drafts and episode metadata stay private.
The standard installer initializes only an absent root with a neutral scaffold;
it never imports a personal corpus or overwrites existing Core/data.

| Path | Purpose |
| --- | --- |
| `Core.md` | Concise identity, confirmed preferences and reusable methods |
| `index.md` | Navigation to selectively read detail |
| `global/<name>.md` | Shared detailed knowledge |
| `deferred/<project-id>/<name>.md` | Project-owned detail |
| `procedures/<name>.md` | Reusable workflows |

Core/index project into eligible primary requests. Detailed files are read
selectively. Authenticated primary views share relevant deferred knowledge across
canonical projects; native workers and retained legacy views remain scoped.
Unmapped projects derive collision-checked path identities without rewriting
the project map. Source registration alone never migrates knowledge.

## Read and discover

`agent_memory_read` has mutually exclusive modes:

| Input | Result |
| --- | --- |
| `{}` | Legacy authorized file list |
| `{path, offset?, limit?}` | Original Unicode code-point paging, limit 1–4096 |
| `{topic: "", offset?, limit?}` | Namespace/count discovery, limit 1–32 |
| `{topic: "*", offset?, limit?}` | All authorized files, limit 1–32 |
| `{topic: "global"}`, `"procedures"`, `"deferred/<id>"` | A selected namespace |
| `{query, offset?, limit?}` | Lexical AND search, limit 1–8 results |

Queries are bounded to 256 UTF-8 bytes and 16 distinct word terms. English/Thai
segmentation and normalization are for matching only; returned snippets and
offsets refer to original text. Paths participate in matching. Results use sorted
path order, not semantic relevance ranking.

Search scans at most 1 MiB per page and returns at most 32 KiB, including revision
metadata. `nextOffset` and incomplete status mean more coverage remains; follow
the cursor. The projection's first eight topic entries are not an exhaustive
catalog. A successful no-match means exhaustion of that scan suffix, not all
unread pages. There are no embeddings, regex queries or persistent search index.

Path/query results include whole-file hashes and source IDs. `basis`,
`baseRevision`, `currentRevision` and `freshness` distinguish a private draft
or stale snapshot from committed truth. Read every path page before replacement.
Do not silently reset a draft to search newer state. Current forgetting,
revocation or a revision race makes an old view **unavailable**, not successfully
empty; proposals remain available for guarded recovery. Use only selectors the
loaded runtime actually advertises.

## Edit, commit and recover

1. Read Core/index and relevant detail through the authenticated view.
2. `agent_memory_edit` adds/replaces/removes a scoped file in a private draft.
   Supply its exact whole-file `expectedHash` (`null` for a new file), text and
   relevant observed episode source IDs. `text: null` removes a detail/procedure
   file; Core/index cannot be removed.
3. `agent_memory_commit` integrates against the base revision. Disjoint file
   edits merge; overlapping changes remain private conflicts, not semantic
   auto-merges. Git HEAD is the publication boundary.
4. Active primary context refreshes on the next request, not retroactively in an
   already running request.

`agent_memory_manage` provides primary-only status/cancel, explicit new-root
initialization, revision-guarded forgetting/rollback/discard and bounded conflict
inspection. Conflict lists page up to eight retained views; proposal text pages
by original code points. Read all pages before recovery; `proposalHash` describes
the complete proposal. Resolve through current hash/revision tools, then discard
the selected view explicitly. Never copy a proposal over newer knowledge blindly.

Forgetting is logical filtering, **not secure Git/history erasure**. Revise
Core/index to remove the forgotten knowledge/source link while preserving identity
before source-forgetting. Source-linked global/deferred/procedure files may be
removed conservatively as whole files. Rollback and conflicts still honor current
forgetting; retained views are not a way to resurrect forgotten material.

## Native writing and automatic reflection

Five tools share this owner: read, edit, commit, manage and
`agent_memory_reflect`. Reflect accepts a bounded assignment, not a caller-selected
role, root, lease or model. It uses the same locked
[managed-memory-writer](agents.md) as configured automatic reflection.

The separate exact-root `managed_memory_<sha256(canonical-root)>` capability
is mandatory. C1/read grants do not authorize writes. The public native service
binds the child's exact identity and output to a leased private view. The writer
gets only read/edit/commit and public per-run prompt replacement, never inherited
primary private corpus, shell tools or a cwd override. Its commit marks the view
ready; a healthy parent integrates only after successful native completion.

Automatic writing depends on private `automatic` policy and bounded eligible
observed episodes. Standard installation selects true for a new scaffold and
preserves existing policy; startup never enables it. Observations omit reasoning,
tool arguments, arbitrary read/recall payloads and imported transcripts. A native
user entry is not authenticated human identity. Failed or cancelled attempts do
not establish successful learning or integration.

Curation should refine an existing subject and its reason, not append incident
logs. Preserve useful provenance, current owners and uncertainty. An ambiguous
one-off is not an enduring preference. Structural screening and prompt delivery
do not prove factual truth, complete secret detection or provider compliance.

## Storage limits and failures

Private directories/files use 0700/0600. Symlinks, hardlinks, escaping paths,
unsafe Git metadata, malformed state and secret-pattern violations reject.
Fixed-argv Git retains existing identity/hooks; it never changes Git config or
bypasses hooks. Dirty/staged tracked work and colliding untracked files block
integration. Hook failures preserve proposals and leave committed context unchanged.

Default byte budgets: Core 8192, index 2048, each detail/procedure 8192 and all
knowledge 65536. Reviewed private configuration can raise these to 32768, 8192,
262144 and 8388608 respectively. Other bounds include 512 maintained files,
128 project mappings, 32 source links/file, 64 views, 256 episodes, a 131072-byte
ledger and a fixed 40-MiB serialized view ceiling. These independent caps do not
promise every maximum combination fits.

Capacity requires maintenance; unreviewed episodes and conflict proposals are not
silently evicted to make space. Unsafe/corrupt/revoked data is unavailable, not an
empty store to reseed. These are cooperative local protections, not isolation
from hostile same-user code, unlimited retention or an OS sandbox.

## Historical recall and quoted notes

Continuity (C1) searches a separately accepted, screened archive:

- `recall_search` uses short literal keywords and returns bounded quotes/citations.
  Try a shorter term or Thai/English alias when needed.
- `recall_read` opens a cited `recordId`, optionally locating a literal query.
  It does not grant arbitrary filesystem access.
- `includeGlobal` / `crossProject` select permitted scope, never bypass filters.

Where configured, a locked tool-free reflector selects validated literal
quotations from bounded observed-primary input as low-authority notes. It does
not rewrite Core or infer lasting preferences. Managed automatic writing gets
the existing settled-handler opportunity first; C1 defers while that writer runs.

```text
/memory-status
/memory-forget <existing-note-id>
/memory-correct <existing-note-id> <retained-record-id> <literal quote>
```

These controls affect current-project quoted notes, not maintained Core or the
archive itself. Correction requires a retained source and literal quote;
forgetting is not secure source-history erasure. A genuinely fresh archive may
be empty, but missing/corrupt/revoked data must not be reported as verified empty.

Implementation: [managed memory](../extensions/mahiro-agent-memory.ts),
[retrieval](../lib/agent-memory/retrieval.ts), [store](../lib/agent-memory/store.ts)
and [continuity](../extensions/mahiro-continuity.ts).
Source/SDK fixtures do not establish installed activation, semantic learning,
memory-use performance or human acceptance.
