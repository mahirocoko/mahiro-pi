# Development and release

[← Documentation](README.md) · [Source release record](releases/0.6.0.md)

## Dependencies and checks

Use Node ≥22.19.0 and pnpm **10.33.0**. Install declared public dependencies
explicitly with the frozen lockfile. No private corpus or sibling runtime is
required. This repository authors the guards, dependency patches and narrow ABIs.

```sh
pnpm check
pnpm check:docs
pnpm check:types
pnpm format # writes the owned formatter surface
pnpm check:format
pnpm check:continuity-format
pnpm check:geometry -- /absolute/public/pi-coding-agent/package.json
git diff --check
```

`check` runs the strict TypeScript and formatting gates, package/import/whitespace
validation, documentation checks, serial source tests and required public SDK
fixtures. `check:types` uses the pinned public TypeScript **6.0.3** and Node 22
**22.19.19** declarations with strict NodeNext resolution, explicit Node types,
TypeScript-extension imports and `noEmit`. The inventory check verifies every
authored TS file under `lib/`, `extensions/`, `test/` and root TS tooling against
the actual compiler program, including imported inputs. Private evidence and
immutable `test/oracles/` never enter that program. `allowJs: true` permits existing
JS interoperability/inference with `checkJs: false`; this does not claim all JS
is typechecked. `skipLibCheck: true` skips dependency declaration diagnostics,
not owned TS errors. No emit, baseline suppression or fake SDK declarations.

Biome **2.5.14** owns all authored JS/TS/JSON, including root check scripts,
configuration, fixtures and previously unformatted owned legacy files. Its
contract is two spaces, single JS/TS quotes, semicolons only as needed for ASI
safety, 110 columns, trailing commas, LF, always-parenthesized arrow parameters,
spaced object braces and property quotes only as needed. JSON remains valid JSON:
double quotes and no trailing commas; JSX quote defaults are unchanged. Run
`pnpm format` after each completed change phase, then the read-only format gates.
`check:continuity-format` remains a compatible subset of `check:format`.
`biome.json` positively owns source/tooling roots and hard-excludes private state,
`node_modules`, immutable upstream oracles and the two original Letta factories
(`lib/guards/mahiro-secret-read-guard.js` and
`lib/guards/mahiro-commit-attribution-guard.js`). Those factory bytes are SHA-pinned
by `lib/guards/provenance.json`; patch files also remain byte-exact upstream
evidence, outside the authored formatter contract.

Focused session-work checks (serialize with other SDK/heavy jobs):

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/native-utilities.test.ts test/session-work-model.test.ts test/session-work-native.test.ts
```

The session-work native fixture runs genuine public SDK/Faux factories across
reload/fork/resume/new, native input and correlated custom-message journaling.
Its public UI selectors/editor keys and terminal object are scripted, not a
live CLI/TTY. Model tests cover bounds, dependency cleanup, missing/delayed and
duplicate receipt correlation. A fresh reviewer and native TUI checks must still
assess composer/attachments, native queue coexistence and rendered narrow layouts.
No provider inference or execution/RPC package interoperability is established.

Focused maintained-memory checks (also serialize with SDK/heavy jobs):

```sh
node --import ./test/public-dependency-loader.mjs --test --test-concurrency=1 test/agent-memory*.test.ts
```

Standard explicit installation selects ordinary memory ABI2 through private
per-profile selection metadata; an absent record retains ABI1 compatibility and
explicit off/legacy are preserved. Disposable fixtures additionally exercise
controlled lifecycle failures. Core tests include isolated lease
resolver inputs, separate OS fault actors and native directory-fsync fault
injection; these do not substitute for canonical Root/PSS authority proof. The
required public SDK suite separately exercises genuine Faux native children,
actual output/launch-context binding, physical policy flips and retirement with
replacement-generation overlap. Conservative external-quiescence and orphan-CAS
unavailability remain documented limits, not automatic recovery promises. See
[maintained memory](agent-memory.md#ordinary-memory-engine) for its boundary.
Policy-only interruption recovery has its own typed identity and actual
process-local drain reference, status classification and explicit primary
`policy-reconcile`; publication reconciliation remains separate. Focused policy
fixtures cover abort/revoke/retire at acquisition/staging/pre/post-rename,
paused-recovery refusal, identity/state tampering and restart-without-reference
refusal. The ordinary SDK journey directly exercises registered runtime-tool
AbortController cancellation, fresh status and reconciliation under actual
Root/PSS. Bounded synthetic correction/no-learning/forgetting controls are not
real-model semantic efficacy. See the [policy interruption limit](agent-memory.md#policy-interruption-limit)
for retained unknown/incomplete/restart limits; these focused checks do not replace
fresh independent QA or the final aggregate gates.

Geometry uses public TUI helpers from an explicitly supplied host manifest; it
makes no model/auth calls and does not substitute for rendered testing.

For offline QA without modifying this checkout's `node_modules`, select an
explicit reviewed public-package supply:

```sh
MAHIRO_PI_TEST_MODULES=/absolute/public/node_modules pnpm check
```

The loader maps canonical source imports and required public packages; it never
harvests another runtime's state. SDK fixtures use genuine public packages,
guarded native dispatch, disposable profiles and deterministic Faux transport,
not provider inference. Missing required supply fails, rather than counting as a
successful skip. Old or unattested owners remain fail-closed.
The required SDK suite has no supervisor timeout or output-overflow termination:
its asynchronous runner drains both pipes until natural close, then flushes bounded
private logs and console writes. Capture truncation or I/O failure fails the gate
only after settlement; the private receipt records status/signal, PID/available
PGID, drain certainty and a null timeout. The nonmutating standalone `--plan`
preview retains its separate bounded timeout and absent-profile assertion.

Keep one writer per checkout and serialize heavy tests/SDK/format/geometry jobs.
Independent verification must use a fresh reviewer, not only writer assertions.
Source/Faux passes do not establish installed activation, provider behavior,
rendered quality, memory-use performance or human acceptance.

## Documentation maintenance

[Documentation navigation](README.md) points to one current guide per concern.
Prefer correcting that owner over adding migration summaries or duplicate API
matrices. Remove obsolete pages only after checking incoming references and
preserving necessary contracts; Git retains superseded prose. Keep private
operator paths, project-only policy and runtime incident reports out of public
guides. Local reports belong only under ignored `.agent-state/runtime/`.

`check:docs` checks local links/anchors, navigability, manifest-to-guide ownership,
version/provenance alignment, public-document hygiene and selected security
boundaries. It does not validate external websites or prove semantic truth.
Source/test changes still require contract review. Dated release notes remain
source records, not rewritten histories or current activation instructions.

## Source releases

The package is intentionally `private: true` / `UNLICENSED`. The release channel
is **GitHub source releases**, not npm publication or a license grant. A release
request does not authorize authentication, profile, model or runtime changes.

1. Obtain explicit commit/push/release scope. Inspect branch, index, remote and
   existing tags; preserve local work and reconcile concurrent changes normally.
   Do not reset others' work, rewrite history or force push.
2. Choose a version from actual release history. Align `package.json`, package
   validation, every exact guard provenance pin, README and a dated release note.
   Do not widen provenance to accept arbitrary versions.
3. Update current guides and third-party notices as needed. Run combined gates
   and independent review against the final source, not an earlier checkpoint.
4. Inspect the exact approved diff/artifact inventory. Keep profiles, credentials,
   transcripts, caches, installed copies and runtime reports out of source payloads.
   `.gitattributes` excludes `.agent-state` and `.pi` from source archives; this is
   not history erasure or permission to commit private state.
5. Use the [commit skill](../skills/git-commit/SKILL.md) for an authorized scoped
   commit; verify the resulting stored message and commit. That role does not push,
   tag or release.
6. Push normally. Create a new annotated version tag at the verified commit;
   never replace an existing tag. Publish reviewed notes through GitHub.
7. Create a source archive from that tag, inspect its paths/content and attach a
   SHA-256 checksum manifest. Do not use `npm publish`.
8. Verify remote branch/tag identity, published URLs, downloaded asset hashes and
   archive inventory, including GitHub's automatic source archives. Command
   submission alone is not a release receipt.

Publication does not install dependencies, update profiles, reload sessions,
select themes, activate Web observation or close human-owned tasks. Follow the
[upgrade guide](getting-started.md#upgrade-safely) for intentional activation.
