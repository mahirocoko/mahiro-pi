# Historical recall and quoted-note continuity

[← Feature guide](README.md) · [Maintained memory](agent-memory.md) · [Roles](agents.md)

Continuity (C1) retrieves **historical evidence**. Managed memory maintains current,
fallible knowledge in a different private Markdown/Git owner. A retrieved quote
does not become an instruction, current preference, permission or verified live fact.

## Recall tools

- `recall_search` uses short literal keywords over the accepted, screened corpus,
  returning bounded quotes and citations. Try a shorter term or the other language
  when Thai/English naming differs; it is not semantic/vector search.
- `recall_read` opens a cited `recordId`, optionally locating a literal query.
  It does not provide arbitrary filesystem access.
- `includeGlobal` and `crossProject` are explicit scope options, not permission
  bypasses. Project routing and accepted-source/privacy filters still apply.

A genuinely fresh accepted archive can be empty. Missing/corrupt/revoked data or
an unavailable store must not be reported as a verified empty history.
Private source import is a separately reviewed operation; installing this package
does not import/reseed a personal corpus.

## Quoted notes and controls

Where explicitly configured, the native quote controller selects observed-primary
input for a locked, tool-free `memory-reflector`. It may retain only validated
literal source quotations as low-authority notes. It does not rewrite Core/persona
or promote generated user-role messages into authenticated human instructions.
Native background admission, primary/child separation, cancellation, revision
and privacy checks remain effective; a background duration is not proof of UI
blocking, RAM use or semantic learning.

```text
/memory-status
/memory-forget <existing-note-id>
/memory-correct <existing-note-id> <retained-record-id> <literal quote>
```

These controls affect current-project quoted notes, not the maintained Core or
historical archive. Correction needs a retained source and literal quote.
Forgetting a quote filters it from recall; it does not securely erase Git/source
history. Managed-memory correction/forgetting uses its own separate tools.

## Maintained-memory boundary

When managed automatic writing qualifies, its existing native service gets the
settled-handler opportunity first; C1 defers while that writer runs. This is not
a second write owner. Managed knowledge still requires its separate exact-root
authority and identity-bound private views. The [memory guide](agent-memory.md)
documents current retrieval, CAS, proposals, conflict handling and forget fences.

Owners: `extensions/mahiro-continuity.ts` and `lib/continuity/`.
[Integration history](integrations.md#memoryhistory-expansion--2026-10-18) records
dated native proofs and corpus constraints, not complete Letta parity, current
installation proof or authority to operate on excluded data.
