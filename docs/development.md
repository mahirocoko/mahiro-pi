# Development and release

[← Feature guide](README.md) · [v0.3.0 notes](releases/0.3.0.md)

## Local checks

Use Node ≥22.19.0 and pnpm **10.33.0** with explicitly installed declared public
dependencies. No sibling runtime, private corpus or Mods checkout is required.

```sh
pnpm check
pnpm check:docs
pnpm check:format
pnpm check:continuity-format
pnpm check:geometry -- /absolute/path/to/pi-coding-agent/package.json
git diff --check
```

`check` runs package/import/whitespace validation, serial source tests and the
required public SDK gate. It is not full TypeScript checking. The explicit
continuity format script covers the separate continuity roots; do not mass-format
the legacy footer. Geometry resolves public TUI helpers from an explicitly
supplied host manifest; it makes no model/auth calls and is not a rendered/human
acceptance check.

For offline source QA without modifying canonical `node_modules`, a reviewed
public package supply may be selected explicitly:

```sh
MAHIRO_PI_TEST_MODULES=/absolute/public/node_modules pnpm check
```

The test loader maps only canonical source imports. It never harvests another
runtime's installed state. Required SDK fixtures use genuine public packages,
guarded native dispatch and deterministic Faux transport, not provider inference.
Unpatched/unauthorized real owners still fail closed.

Serialize full tests/SDK/large format/geometry jobs and keep one product writer.
A fresh independent verifier should challenge semantic contracts, not just
repeat the writer's assertions. A source/Faux pass does not establish installed,
provider, browser, rendered, RAM or human product acceptance.

## Documentation ownership

The [feature index](README.md) points to current user-facing owners.
`check:docs` checks local links/anchors, the declared feature guide set and current
version references; it does not verify external websites or infer semantic truth.
`integrations.md` retains dated deployment/migration evidence. Its historical
source-only or pending gates must not be read as the current release's status.

## Release contract

The package is intentionally `private: true` / `UNLICENSED`, even though this
GitHub repository is public. The existing release channel is **GitHub source
releases**, not npm publication. A release request does not authorize auth,
profile, provider or runtime changes.

1. Obtain explicit commit/push/release authority and reconcile the pending source
   union, branch, index, remote and existing tags. Never reset somebody else's
   changes or force push.
2. Choose a version from actual release history. Keep root `package.json`,
   the exact package check, **all eight guard provenance version pins**, current
   feature-contract version references and release notes aligned. Do not broaden
   provenance to accept arbitrary versions.
3. Update navigable docs/limitations, preserve third-party notices, and run fresh
   combined gates plus independent release review against the final source.
4. Write a local RRR under ignored runtime evidence. Keep private state,
   credentials, profiles, transcripts, caches and installed copies out of commits
   and artifacts. Old tracked `.agent-state` notes are excluded from archives by
   `.gitattributes`; no history rewrite is implied.
5. Use the native [commit skill](../skills/git-commit/SKILL.md) and role for the
   exact approved safe path set. Verify the stored message and resulting commit.
   The role does not push, tag or release.
6. Push normally. Create a new annotated version tag at the verified commit and
   push it normally. Never replace an existing tag.
7. Publish the GitHub release with reviewed notes. Attach a source archive made
   from that tag and a SHA-256 checksum manifest; no `npm publish`.

For example, after the approved commit/push and new annotated tag:

```sh
git archive --format=tar.gz --prefix=mahiro-pi-0.3.0/ v0.3.0 > /private/artifacts/mahiro-pi-0.3.0.tar.gz
# Inspect the archive paths/content and generate SHA256SUMS before upload.
gh release create v0.3.0 /private/artifacts/mahiro-pi-0.3.0.tar.gz /private/artifacts/SHA256SUMS \
  --verify-tag --title "mahiro-pi v0.3.0" --notes-file /private/artifacts/release-notes.md
```

Use an actual private local artifact directory, not the literal example path.
Verify the remote branch/tag commit, published version/URLs, downloaded asset
hashes and archive inventory, including GitHub's automatic source archives.
Publishing source does not install it, reload a session, activate the Web observer
or close unrelated human-owned tasks. Report an actual blocker instead of claiming
a release from successful command submission.
