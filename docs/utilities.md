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

Owners: `extensions/mahiro-native-utilities.ts` and `lib/native-utilities.ts`.
The [integration reference](integrations.md#native-utility-port--source-only-first-all-mods-slice)
contains native adaptation and fixture details; its original source-only slice
is dated history, not proof of the current session's loaded version.
