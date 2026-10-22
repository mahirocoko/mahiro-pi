# Native utilities

[← Documentation](README.md)

## Realign

`/realign [focus]` asks the assistant to reorient around current repository rules
and evidence. The optional focus narrows that guidance. It uses native generated
custom guidance, not a forged human message, and does not edit memory, create a
Goal, change policy or authorize a commit.

Native busy delivery and conservative input/child skips retain their own
boundaries. Disable this resource's realign behavior with the native boolean flag
`--mahiro-realign-disable`.

## Run-start clock metadata

Host-local time/timezone metadata may accompany the start of an eligible native
run, separately from the original user's text and attachments. It is the
**run-start clock**, not keypress/receipt time, authenticated human identity,
instructional evidence or permission.

Disable it with `--mahiro-user-timestamps-disable`. No new global
configuration is created. Realign and clock metadata do not execute tools
or overwrite the user input.

## Copy code

`/mh-copy-code` lists assistant text on the current session branch and copies
one choice: the full response, or a single fenced code block. Closed and
unclosed fences are both listed. A response with no fence is still offered in
full. The list is built when the picker opens, including after branch
navigation.

The name is separate from native `/copy`. If the live command registry does not
contain exactly one extension command named `mh-copy-code`, nothing is copied.

In the interactive TUI, confirming a row copies that text through the public
clipboard API. Cancelling copies nothing. Outside the TUI, the command reports
only how many responses and code blocks are on the branch and does not touch
the clipboard. The copied text is not written to the editor, a log, or another
sink. The native editor, Shift+Enter newline, and image paste stay in place.
This command does not edit or steer the native queue. Syntax highlighting is
not applied.

Owners: `extensions/mahiro-native-utilities.ts`, `lib/native-utilities.ts` and
`lib/copy-code.ts`.

## Code Map

`mh_code_map` returns bounded repository-navigation guidance from caller-supplied
metadata. It does not search files, build an index, infer an outline or verify
source. It has no slash command.

```json
{"intent":"exact","query":"createWebActivityPublisher","path_hints":["lib/worker-activity-web.ts"]}
```

Intents are `semantic`, `exact` and `outline`. Guidance points to a subsequent
real search or bounded read. Path/language hints, navigation entries, optional
large-read guidance and Goal/Evidence references remain metadata, not proof a
file exists, permission to read it or evidence attachment. Formatting is bounded
to 3000 characters; registration/formatting do not scan workspace source.

Execution requires the exact named capability, healthy canonical source and
public winning-rule attestation. Family wildcards or an old unattested service
are insufficient. Feature DATA installation does not replace Code Map tool
authority. Canonical checks may read package/provenance/policy metadata, not
perform the proposed source search.

Owner: [registration](../extensions/mahiro-code-map.ts) and
[guidance formatter](../lib/code-map.ts). Source availability does not prove
that the running profile loaded these controls.
