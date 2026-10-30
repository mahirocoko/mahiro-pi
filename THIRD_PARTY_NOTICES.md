# Third-party notices

## cc-my-pi dark theme

`themes/mahiro-claude-dark.json` adapts only the optional palette from
[cc-my-pi](https://github.com/timvdhoorn/cc-my-pi),
commit `6746292ff4359b2bdca987109ff49c8da055bb23`,
`themes/cc-my-pi-dark.json`. Changes include a unique name, explicit dark appearance,
current public schema, retuned palette values and semantic token mappings. No entrypoints, diff implementation,
header scaffolding, mascot or vendored plugins are copied.

The following complete upstream root notice is retained (including its vendor
clarification; those vendored components are not included here):

```text
MIT License

Copyright (c) 2025-2026 FammasMaz (original pi-cc-tools)
Copyright (c) 2026 Tim van den Hoorn (cc-my-pi modifications)

Vendored components under extensions/queue-steer/ and extensions/esc-steer.ts
are Copyright (c) Thomas Mustier, MIT licensed — see VENDOR.md.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Manrope and Fira Code

`lib/agent-memory/local/palace-assets/` vendors two variable Latin WOFF2 files used
by the public Letta viewer, downloaded from Google Fonts. These font files do not
include Letta branding, marks, or viewer assets.

| File | Source | SHA-256 |
| --- | --- | --- |
| `manrope-latin.woff2` | Manrope v23, `https://fonts.gstatic.com/s/manrope/v23/xn7gYHE41ni1AdIRggexSvfedN4.woff2` | `8bd97e6bbbc1f602a8f791530eed1064c9a357d5731bbc76e3fc587fb068728f` |
| `firacode-latin.woff2` | Fira Code v27, `https://fonts.gstatic.com/s/firacode/v27/uU9NCBsR6Z2vfE9aq3bh3dSDqFGedA.woff2` | `d32d5b5a7c9720cf3812f7d1e3ebdb54116f8f656e7471a03a5a93bdd93c98b3` |

Both files begin with the `wOF2` signature and were served as `font/woff2`.
Manrope is used for Palace UI text. Fira Code is used for mono and code text.
The corresponding SIL Open Font License 1.1 texts are the canonical
[google/fonts](https://github.com/google/fonts) files
[`ofl/manrope/OFL.txt`](lib/agent-memory/local/palace-assets/manrope-OFL.txt)
and
[`ofl/firacode/OFL.txt`](lib/agent-memory/local/palace-assets/firacode-OFL.txt).
The upstream license lines that wrap with a trailing space are unchanged.

## Letta Code memory viewer stylesheet

The Palace preview stylesheet in `lib/agent-memory/local/palace-page.ts` adapts
the public Letta Code template
[`src/web/memory-viewer-template.txt`](https://github.com/letta-ai/letta-code/blob/5dea67021b99810707ff753db35e4534f70ff1fd/src/web/memory-viewer-template.txt)
at commit `5dea67021b99810707ff753db35e4534f70ff1fd`.

Copyright 2025, Letta authors.

Licensed under the Apache License, Version 2.0. The complete license text from
upstream `LICENSE` at that commit is bundled at
[`letta-code-Apache-2.0.txt`](lib/agent-memory/local/palace-assets/letta-code-Apache-2.0.txt).
The upstream work remains at <https://github.com/letta-ai/letta-code> and the
same license is also published at <https://www.apache.org/licenses/LICENSE-2.0>.

Mahiro modified that viewer source. The adaptation removes Letta branding,
name, logo, and private payload. It binds Mahiro's existing snapshot,
document, corpus, and history data, and changes authority labeling, security
headers, and responsive behavior. The Mahiro preview script, font files, and
capability routes are not copied from that template.
