# Development and release

[← Documentation](README.md) · [Release record](releases/0.3.0.md)

## Dependencies and checks

Use Node ≥22.19.0 and pnpm **10.33.0**. Install declared public dependencies
explicitly with the frozen lockfile. No private corpus or sibling runtime is
required. This repository authors the guards, dependency patches and narrow ABIs.

```sh
pnpm check
pnpm check:docs
pnpm check:format
pnpm check:continuity-format
pnpm check:geometry -- /absolute/public/pi-coding-agent/package.json
git diff --check
```

`check` runs package/import/whitespace validation, documentation checks, serial
source tests and required public SDK fixtures. It is not full TypeScript checking.
Run scoped formatting, not a mass-format of legacy files. Geometry uses public
TUI helpers from an explicitly supplied host manifest; it makes no model/auth
calls and does not substitute for rendered testing.

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
