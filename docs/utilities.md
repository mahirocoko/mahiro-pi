# Native utilities

[← Feature guide](README.md)

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

Disable it with `--mahiro-user-timestamps-disable`. No Letta sentinel or new
global configuration is created. Realign and clock metadata do not execute tools
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

The [integration reference](integrations.md#native-utility-port--source-only-first-all-mods-slice)
contains native adaptation and fixture details; its original source-only slice
is dated history, not proof of the current session's loaded version.
