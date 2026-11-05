# Investigating behavior

Identify the target incident from the user's symptom, session/message reference,
or time window. For a general health check, start with a bounded sample of
recent session history via `continuity_recall`.

1. **Locate the incident.** Use the supplied symptom or session reference, or
   findings from the general health check. Look for user corrections, repeated
   failed attempts, unsupported success claims, or missing memory recall across
   projects. Include a successful control example when one exists; do not select
   only failures and claim the pattern is universal.
2. **Expand around the failure.** Use `continuity_recall` (`mode: "search"` and
   `mode: "session"`) to read the request, relevant preceding messages, tool
   arguments and results, the user correction, and the eventual outcome. Never
   correlate merely by finding a session ID quoted inside unrelated prompt text.
3. **Follow the evidence.** Form a specific hypothesis and retrieve the next
   record needed to test it. Inspect relevant memory files (`agent_memory_read`),
   projection diagnostics (`agent_memory_manage` with `action: "status"` or
   `action: "palace"`), and commit history (`agent_memory_manage` with
   `action: "history"`). Separate what was stored, what was projected into
   `<mahiro-managed-memory>`, what was retrieved on demand, and what the tool
   actually did.
4. **Identify the responsible component.** The cause may be stale or unindexed
   memory, a fact written to an on-demand file instead of an always-loaded
   `system/**` owner, conflicting instructions, failed retrieval, a skill, tool
   execution, or compaction. Do not add a behavioral rule to memory to compensate
   for a harness or schema bug.

## Available evidence

### Historical session recall (`continuity_recall`)

Use `continuity_recall` to search and inspect prior Pi sessions:

- Search across sessions with distinctive terms from the incident:
  `continuity_recall({ "mode": "search", "query": "<distinctive words>", "limit": 10 })`
- Inspect a specific session's bounded transcript entries:
  `continuity_recall({ "mode": "session", "sessionId": "<session-id>", "limit": 20 })`

Start with a compact search, then read only the session span relevant to the
hypothesis. Stop collecting when the causal chain and its remaining uncertainty
are clear.

### Memory projection and commit history (`agent_memory_manage`)

- `agent_memory_manage({ "action": "status" })` — current revision, active scope,
  draft state, and health summary.
- `agent_memory_manage({ "action": "doctor" })` — broken links, orphan files,
  missing indexes, frontmatter warnings, and budget checks.
- `agent_memory_manage({ "action": "palace", "mode": "json" })` — structural map
  showing which files are in the always-loaded `system` tier versus `onDemand`.
- `agent_memory_manage({ "action": "history", "limit": 8 })` — recent committed
  memory revisions, subjects, and changed file counts.

### Historical context limits

The current memory files are not necessarily what a past request contained.
Check `agent_memory_manage({ "action": "history" })` to see when a memory file
was actually committed relative to the incident timestamp. If a fact was still
sitting in an uncommitted draft view or was committed after the target session
started, `<mahiro-managed-memory>` in that earlier turn did not contain it.

## Worked examples

- **Fact remembered in one project but missing in another:** Check whether the
  fact was written to `projects/<old-project>/...` (project-scoped) or an
  unindexed/deferred file instead of `system/human/identity.md` or
  `system/human/prefs/*.md` (global always-loaded tier), or whether the writer
  left edits in a draft view without calling `agent_memory_commit`.
- **Confusing people or authorship:** Check whether a quoted prompt in a session
  came from the human user or from a delegated worker/subagent prompt. Do not
  promote worker dispatch instructions into `system/human/**`.
- **Repeated tool or CAS failures:** Distinguish `Revision conflict` / `Content
  hash mismatch` (stale `expectedHash` or concurrent commit) from `Lossless
  Retention Guard` rejections (shrinking a protected file without archiving the
  superseded belief).

## Verify a proposed fix

Recheck the original failure against the proposed change and run
`agent_memory_manage({ "action": "doctor" })`. Do not claim a fix was applied
merely because you recommended it.
