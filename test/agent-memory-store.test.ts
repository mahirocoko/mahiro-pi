import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
  existsSync,
  linkSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createMemoryStore,
  parseConfig,
  allowedPath,
  type MemoryConfig,
} from "../lib/agent-memory/store.ts";
import { digest } from "../lib/continuity/records.ts";

const parent = new URL("../.agent-state/runtime/", import.meta.url).pathname;
function fixture() {
  const dir = mkdtempSync(join(parent, "managed-memory-store-"));
  const root = join(dir, "memory");
  const cwd = join(dir, "project");
  mkdirSync(cwd);
  const config: MemoryConfig = {
    version: 1,
    projects: [{ cwd, id: "project" }],
    coreBytes: 8192,
    indexBytes: 2048,
    fileBytes: 8192,
    totalBytes: 65536,
    automatic: false,
  };
  const store = createMemoryStore(root);
  store.initialize(config, "# Core\nEstablished companion identity.\n");
  return {
    dir,
    root,
    cwd,
    config,
    store,
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}
test("primary shared authority is explicit; retained v1 views/conflicts stay scoped and cannot be promoted by omission or worker arguments", () => {
  const f = fixture();
  try {
    const primary = createMemoryStore(f.root, () => {}, "primary");
    const other = join(f.dir, "unmapped-project");
    mkdirSync(other);
    const id = primary.project(other);
    assert.equal(id, digest(other));
    assert.equal(primary.project(f.cwd), "project", "preserve mapped IDs");
    const config = readFileSync(join(f.root, "config.json"));
    const base = f.store.createView("project");
    assert.equal(base.scope, undefined, "v1 absent scope is project-scoped");
    f.store.edit(base, "deferred/project/legacy.md", null, "# Legacy\n", []);
    const winner = f.store.createView("project");
    f.store.edit(winner, "deferred/project/legacy.md", null, "# Winner\n", []);
    f.store.integrate(winner);
    assert.ok("conflict" in f.store.integrate(base));
    const shared = primary.createView(id, 120000, true);
    primary.edit(
      shared,
      "deferred/other/relevant.md",
      null,
      "# Shared detail\n",
      [],
    );
    primary.integrate(shared);
    const draft = primary.createView("project", 120000, true);
    assert.equal(
      primary.read(draft, "deferred/other/relevant.md").text,
      "# Shared detail\n",
    );
    assert.throws(
      () => f.store.read(draft, "deferred/other/relevant.md"),
      /metadata|scope/,
    );
    assert.throws(() => f.store.createView("project", 120000, true), /scope/);
    const legacy = f.store.createView("project");
    assert.throws(
      () => primary.read(legacy, "deferred/other/relevant.md"),
      /scope/,
    );
    assert.equal(
      f.store.conflicts("project", base.id, "deferred/project/legacy.md").text,
      "# Legacy\n",
    );
    assert.deepEqual(
      readFileSync(join(f.root, "config.json")),
      config,
      "identity derivation never mutates the existing map",
    );
    assert.equal(
      primary.snapshot().files["Core.md"].text,
      "# Core\nEstablished companion identity.\n",
    );
  } finally {
    f.close();
  }
});

test("shared deferred knowledge preserves full-size preferences, project isolation and global forgetting", () => {
  const f = fixture();
  try {
    const otherCwd = join(f.dir, "other");
    mkdirSync(otherCwd);
    f.config.projects.push({ cwd: otherCwd, id: "other" });
    f.config.fileBytes = 65536;
    f.config.totalBytes = 262144;
    writeFileSync(join(f.root, "config.json"), `${JSON.stringify(f.config)}\n`);
    const coding = `# Coding\n${"Use the current project owner. ".repeat(1900).slice(0, 54648)}\n`;
    const workflow = `# Workflow\n${"Keep facts and evidence distinct. ".repeat(1600).slice(0, 47420)}\n`;
    assert.ok(Buffer.byteLength(coding) > 32768);
    assert.ok(Buffer.byteLength(workflow) > 32768);
    const a = f.store.createView("project");
    f.store.edit(a, "global/human-coding.md", null, coding, ["shared-source"]);
    f.store.edit(a, "global/human-workflow.md", null, workflow, [
      "workflow-source",
    ]);
    f.store.integrate(a);
    const b = f.store.createView("other");
    assert.equal(f.store.read(b, "global/human-coding.md").text, coding);
    f.store.edit(
      b,
      "deferred/other/private.md",
      null,
      "# Other\nPrivate project knowledge.\n",
      ["shared-source"],
    );
    f.store.integrate(b);
    const beforeForget = f.store.snapshot().revision;
    const stale = f.store.createView("project");
    f.store.edit(
      stale,
      "global/human-coding.md",
      digest(coding),
      `${coding}A stale addition.\n`,
      ["shared-source"],
    );
    assert.throws(() => f.store.read(stale, "deferred/other/private.md"));
    const projection = f.store.projection("project");
    assert.ok(projection.discovery.topics.some((t) => t.topic === "global"));
    assert.ok(
      !projection.discovery.topics.some((t) => t.topic === "deferred/other"),
    );
    assert.ok(!JSON.stringify(projection).includes("human-coding.md"));
    assert.ok(
      !`${projection.core}${projection.index}`.includes(
        "Use the current project owner.",
      ),
    );
    const forgotten = f.store.forget(
      beforeForget,
      [],
      ["shared-source"],
      "project",
    );
    assert.equal(f.store.snapshot().files["global/human-coding.md"], undefined);
    assert.ok(f.store.snapshot().files["deferred/other/private.md"]);
    assert.ok("conflict" in f.store.integrate(stale));
    f.store.rollback(forgotten.revision, beforeForget, "other");
    assert.equal(f.store.snapshot().files["global/human-coding.md"], undefined);
    assert.equal(
      f.store.snapshot().files["global/human-workflow.md"].text,
      workflow,
    );
    const futureB = f.store.createView("other");
    const own = f.store.read(futureB, "deferred/other/private.md");
    f.store.edit(
      futureB,
      "deferred/other/private.md",
      own.hash,
      "# Other\nUpdated private knowledge.\n",
      ["shared-source"],
    );
    assert.ok("revision" in f.store.integrate(futureB));
    assert.equal(allowedPath("global/../other.md", "project"), false);
    assert.equal(allowedPath("global/nested/other.md", "project"), false);
  } finally {
    f.close();
  }
});

test("old views cannot read knowledge independently forgotten at current HEAD; proposals remain retained", () => {
  const f = fixture();
  try {
    const seed = f.store.createView("project");
    f.store.edit(
      seed,
      "global/fictional-compass.md",
      null,
      "# Fictional\nThe compass is violet.\n",
      ["fictional-source"],
    );
    f.store.integrate(seed);
    const a = f.store.createView("project");
    const b = f.store.createView("project");
    f.store.forget(b.base.revision, [], ["fictional-source"], "project");
    const before = readFileSync(join(f.root, ".views", `${a.id}.json`));
    assert.throws(
      () => f.store.read(a, "global/fictional-compass.md"),
      /unavailable.*forgotten/i,
    );
    assert.deepEqual(
      readFileSync(join(f.root, ".views", `${a.id}.json`)),
      before,
    );
    assert.equal(a.state, "open");
  } finally {
    f.close();
  }
});

test("ledger capacity rejects publication before changing working files, index or HEAD", () => {
  const f = fixture();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: f.root, encoding: "utf8" });
  try {
    // Bounded valid fixture seed, using ordinary Git and its validation hooks.
    const ledgerPath = join(f.root, ".memory.json");
    const state = JSON.parse(readFileSync(ledgerPath, "utf8"));
    state.forgottenSources = Array.from({ length: 4096 }, (_, i) => ({
      project: "p",
      source: i.toString(36),
    }));
    writeFileSync(ledgerPath, `${JSON.stringify(state)}\n`);
    git("add", "--", ".memory.json");
    git("commit", "-m", "Seed bounded ledger capacity fixture");
    const before = f.store.snapshot();
    const raw = readFileSync(ledgerPath, "utf8");
    assert.throws(
      () => f.store.forget(before.revision, [], ["overflow"]),
      /ledger/,
    );
    assert.equal(git("rev-parse", "HEAD").trim(), before.revision);
    assert.equal(readFileSync(ledgerPath, "utf8"), raw);
    assert.equal(git("status", "--porcelain"), "");
    assert.deepEqual(f.store.snapshot(), before);
    assert.equal(f.store.projection("project").revision, before.revision);

    state.forgottenSources = [];
    writeFileSync(ledgerPath, `${JSON.stringify(state)}\n`);
    git("add", "--", ".memory.json");
    git("commit", "-m", "Reset capacity fixture for review limit");
    // Also hit the exact 4097-entry publication boundary through integrate.
    const full = f.store.createView("project");
    f.store.integrate(
      full,
      Array.from({ length: 4096 }, (_, i) => `review-${i}`),
    );
    const readable = f.store.snapshot();
    const proposal = f.store.createView("project");
    f.store.edit(
      proposal,
      "Core.md",
      digest(proposal.files["Core.md"].text),
      "# Core\nMust not publish.\n",
    );
    assert.throws(
      () => f.store.integrate(proposal, ["review-overflow"]),
      /ledger/,
    );
    assert.deepEqual(f.store.snapshot(), readable);
    assert.equal(f.store.projection("project").revision, readable.revision);
    assert.equal(
      readFileSync(join(f.root, "Core.md"), "utf8"),
      readable.files["Core.md"].text,
    );
    assert.equal(git("status", "--porcelain"), "");
    assert.equal(proposal.state, "open");
  } finally {
    f.close();
  }
});

// Only isolated private Git feature actions. Never modify repository/global Git identity.
process.env.GIT_AUTHOR_NAME = "Memory fixture";
process.env.GIT_AUTHOR_EMAIL = "fixture@example.invalid";
process.env.GIT_COMMITTER_NAME = "Memory fixture";
process.env.GIT_COMMITTER_EMAIL = "fixture@example.invalid";

test("managed Core/deferred/procedure files share one CAS authoring owner and committed projection", () => {
  const f = fixture();
  try {
    const before = f.store.snapshot();
    const v = f.store.createView("project");
    assert.equal(
      f.store.read(v, "Core.md").hash,
      digest(before.files["Core.md"].text),
    );
    f.store.edit(
      v,
      "Core.md",
      digest(before.files["Core.md"].text),
      "# Core\nEstablished companion identity. Prefer concise explanations.\n",
      ["episode-1"],
    );
    f.store.edit(
      v,
      "deferred/project/build.md",
      null,
      "# Build\nUse the bounded check for this project.\n",
      ["episode-1"],
    );
    f.store.edit(
      v,
      "procedures/checks.md",
      null,
      "# Checks\nRead command outcomes before claiming completion.\n",
      ["episode-1"],
    );
    assert.ok(
      readFileSync(join(f.root, ".views", v.id, "Core.md"), "utf8").includes(
        "concise",
      ),
    );
    assert.equal(f.store.snapshot().revision, before.revision);
    assert.ok(!f.store.projection("project").core.includes("concise"));
    const result = f.store.integrate(v, ["episode-1"]);
    assert.ok("revision" in result && result.revision !== before.revision);
    assert.ok(f.store.projection("project").core.includes("concise"));
    assert.deepEqual(f.store.projection("project").discovery.topics, [
      { topic: "deferred/project", files: 1 },
      { topic: "procedures", files: 1 },
    ]);
    assert.ok(
      !JSON.stringify(f.store.projection("project")).includes(
        "Use the bounded check",
      ),
    );
    assert.equal(f.store.snapshot().reviewed[0], "episode-1");
    assert.equal(
      readFileSync(join(f.root, "Core.md"), "utf8"),
      f.store.snapshot().files["Core.md"].text,
    );
  } finally {
    f.close();
  }
});

test("replacement and removal do not accumulate contradictory active files", () => {
  const f = fixture();
  try {
    const first = f.store.createView("project");
    f.store.edit(
      first,
      "deferred/project/preference.md",
      null,
      "# Preference\nA\n",
      ["a"],
    );
    f.store.integrate(first);
    const second = f.store.createView("project");
    f.store.edit(
      second,
      "deferred/project/preference.md",
      digest("# Preference\nA\n"),
      "# Preference\nB\n",
      ["b"],
    );
    f.store.integrate(second);
    assert.equal(
      f.store.snapshot().files["deferred/project/preference.md"].text,
      "# Preference\nB\n",
    );
    const third = f.store.createView("project");
    f.store.edit(
      third,
      "deferred/project/preference.md",
      digest("# Preference\nB\n"),
      null,
    );
    f.store.integrate(third);
    assert.equal(
      f.store.snapshot().files["deferred/project/preference.md"],
      undefined,
    );
  } finally {
    f.close();
  }
});

test("stale hashes, traversal, symlinks, hardlinks, secrets and unsafe project mappings fail closed", () => {
  const f = fixture();
  try {
    const v = f.store.createView("project");
    for (const path of [
      "../Core.md",
      "/tmp/Core.md",
      "deferred/other/file.md",
      "deferred/project/../../Core.md",
      ".git/config",
      "auth.json",
      "procedures/.env.md",
    ])
      assert.throws(() => f.store.edit(v, path, null, "safe\n"));
    assert.throws(
      () => f.store.edit(v, "Core.md", "stale", "replacement\n"),
      /Stale/,
    );
    assert.throws(
      () =>
        f.store.edit(
          v,
          "procedures/private.md",
          null,
          "password=DO_NOT_STORE\n",
        ),
      /Unsafe/,
    );
    assert.throws(() =>
      f.store.edit(v, "Core.md", digest(v.files["Core.md"].text), null),
    );
    const hardlink = join(f.dir, "linked-config.json");
    linkSync(join(f.root, "config.json"), hardlink);
    assert.throws(() => f.store.config(), /Private/);
    unlinkSync(hardlink);
    const link = join(f.root, ".views", v.id, "procedures");
    symlinkSync(f.dir, link);
    assert.throws(
      () => f.store.edit(v, "procedures/file.md", null, "safe\n"),
      /Symlink/,
    );
    // The mapping is refused because it targets a symlink, not its project name.
    assert.throws(
      () =>
        parseConfig(
          JSON.stringify({
            ...f.config,
            projects: [{ cwd: link, id: "x" }],
          }),
        ),
      /Symlink/,
    );
    assert.throws(() =>
      parseConfig(
        JSON.stringify({
          ...f.config,
          projects: [{ cwd: f.cwd, id: "__proto__" }],
        }),
      ),
    );
    assert.equal(allowedPath("deferred/other/file.md", "project"), false);
  } finally {
    f.close();
  }
});

test("nonconflicting concurrent native views merge; same-file conflicts preserve proposals", () => {
  const f = fixture();
  try {
    const a = f.store.createView("project"),
      b = f.store.createView("project");
    f.store.edit(a, "procedures/a.md", null, "# A\n", ["ea"]);
    f.store.edit(b, "procedures/b.md", null, "# B\n", ["eb"]);
    f.store.integrate(a);
    const merged = f.store.integrate(b);
    assert.ok("revision" in merged);
    assert.ok(f.store.snapshot().files["procedures/a.md"]);
    assert.ok(f.store.snapshot().files["procedures/b.md"]);
    const c = f.store.createView("project"),
      d = f.store.createView("project");
    f.store.edit(c, "Core.md", digest(c.files["Core.md"].text), "# Core\nA\n");
    f.store.edit(d, "Core.md", digest(d.files["Core.md"].text), "# Core\nB\n");
    f.store.integrate(c);
    const conflict = f.store.integrate(d);
    assert.deepEqual("conflict" in conflict && conflict.conflict, ["Core.md"]);
    assert.equal(d.state, "conflict");
    assert.ok(
      readFileSync(join(f.root, ".views", `${d.id}.json`), "utf8").includes(
        "B\\n",
      ),
    );
    assert.equal(f.store.snapshot().files["Core.md"].text, "# Core\nA\n");
    assert.equal(f.store.conflicts("project").total, 1);
    assert.equal(
      f.store.conflicts("project", d.id, "Core.md").text,
      "# Core\nB\n",
    );
    assert.throws(() => f.store.conflicts("other", d.id), /Unknown/);
    f.store.discardConflict("project", d.id);
    assert.equal(f.store.conflicts("project").total, 0);
  } finally {
    f.close();
  }
});

test("forgetting blocks stale integration, source revival and rollback revival", () => {
  const f = fixture();
  try {
    const v = f.store.createView("project");
    f.store.edit(
      v,
      "deferred/project/old.md",
      null,
      "# Old\nForgotten fact\n",
      ["source-old"],
    );
    const original = f.store.integrate(v);
    assert.ok("revision" in original);
    const stale = f.store.createView("project");
    f.store.edit(
      stale,
      "deferred/project/old.md",
      digest(stale.files["deferred/project/old.md"].text),
      "# Old\nChanged\n",
      ["source-old"],
    );
    const forgotten = f.store.forget(
      f.store.snapshot().revision,
      ["deferred/project/old.md"],
      ["source-old"],
    );
    assert.ok("conflict" in f.store.integrate(stale));
    const fresh = f.store.createView("project");
    f.store.edit(
      fresh,
      "procedures/new-name.md",
      null,
      "# Old fact elsewhere\n",
      ["source-old"],
    );
    assert.ok("conflict" in f.store.integrate(fresh));
    const restored = f.store.rollback(
      forgotten.revision,
      (original as { revision: string }).revision,
    );
    assert.equal(restored.files["deferred/project/old.md"], undefined);
    assert.ok(
      restored.forgottenSources.some(
        (entry) => entry.project === "project" && entry.source === "source-old",
      ),
    );
    assert.throws(
      () =>
        f.store.rollback(
          (original as { revision: string }).revision,
          forgotten.revision,
        ),
      /Stale/,
    );
  } finally {
    f.close();
  }
});

test("Core source forgetting preserves identity and cannot revive knowledge through rollback", () => {
  const f = fixture();
  try {
    const learned = f.store.createView("project");
    f.store.edit(
      learned,
      "Core.md",
      digest(learned.files["Core.md"].text),
      "# Core\nEstablished companion identity. Learned old preference.\n",
      ["old-core-source"],
    );
    const old = f.store.integrate(learned) as { revision: string };
    assert.throws(
      () => f.store.forget(old.revision, [], ["old-core-source"]),
      /preserve established identity/,
    );
    const corrected = f.store.createView("project");
    f.store.edit(
      corrected,
      "Core.md",
      digest(corrected.files["Core.md"].text),
      "# Core\nEstablished companion identity.\n",
      [],
    );
    f.store.integrate(corrected);
    const forgotten = f.store.forget(
      f.store.snapshot().revision,
      [],
      ["old-core-source"],
    );
    const restored = f.store.rollback(forgotten.revision, old.revision);
    assert.match(
      restored.files["Core.md"].text,
      /Established companion identity/,
    );
    assert.doesNotMatch(restored.files["Core.md"].text, /old preference/);
  } finally {
    f.close();
  }
});

test("config remaps, linked Git metadata and failed hooks cannot publish or overwrite a revision", () => {
  const f = fixture();
  try {
    const v = f.store.createView("project");
    writeFileSync(
      join(f.root, "config.json"),
      JSON.stringify({ ...f.config, automatic: true }),
      { mode: 0o600 },
    );
    assert.throws(() => f.store.read(v, "Core.md"), /inactive/);
    writeFileSync(join(f.root, "config.json"), JSON.stringify(f.config), {
      mode: 0o600,
    });
    const link = join(f.root, ".git", "linked");
    symlinkSync(f.dir, link);
    assert.throws(() => f.store.snapshot(), /Linked/);
    unlinkSync(link);
    const clean = f.store.createView("project");
    f.store.edit(
      clean,
      "procedures/hook.md",
      null,
      "# Retain this pending proposal\n",
    );
    const before = f.store.snapshot().revision;
    writeFileSync(
      join(f.root, ".git/hooks/pre-commit"),
      "#!/bin/sh\nexit 1\n",
      { mode: 0o700 },
    );
    assert.throws(() => f.store.integrate(clean));
    assert.equal(f.store.snapshot().revision, before);
    assert.ok(
      readFileSync(
        join(f.root, ".views", clean.id, "procedures/hook.md"),
        "utf8",
      ).includes("pending proposal"),
    );
    assert.throws(() => f.store.integrate(clean), /Uncommitted/);
  } finally {
    f.close();
  }
});

test("cancelled/deadline views, root revocation and budgets reject publication", () => {
  const f = fixture();
  try {
    const cancelled = f.store.createView("project");
    f.store.cancel(cancelled);
    assert.throws(() => f.store.integrate(cancelled), /inactive/);
    const expired = f.store.createView("project");
    expired.deadline = Date.now() - 1;
    assert.throws(() => f.store.read(expired, "Core.md"), /inactive/);
    const v = f.store.createView("project");
    assert.throws(
      () =>
        f.store.edit(
          v,
          "Core.md",
          digest(v.files["Core.md"].text),
          `${"x".repeat(8192)}\n`,
        ),
      /budget/,
    );
    let permitted = true;
    const guarded = createMemoryStore(f.root, () => {
      if (!permitted) throw new Error("revoked");
    });
    const own = guarded.createView("project");
    permitted = false;
    assert.throws(() => guarded.integrate(own), /revoked/);
    chmodSync(f.root, 0o755);
    assert.throws(() => f.store.snapshot(), /Private/);
  } finally {
    f.close();
  }
});

test("Core/index/deferred/total budgets apply and projection never reads deferred bodies", () => {
  const f = fixture();
  try {
    const v = f.store.createView("project");
    assert.throws(
      () =>
        f.store.edit(
          v,
          "index.md",
          digest(v.files["index.md"].text),
          `${"i".repeat(2048)}\n`,
        ),
      /budget/,
    );
    assert.throws(
      () =>
        f.store.edit(
          v,
          "deferred/project/large.md",
          null,
          `${"d".repeat(8192)}\n`,
        ),
      /budget/,
    );
    f.store.edit(
      v,
      "deferred/project/detail.md",
      null,
      "# Deferred detail\nNot automatically read.\n",
    );
    f.store.integrate(v);
    // Authority callbacks include metadata paths, not just body I/O. Removing
    // the deferred blob in this owned malformed fixture detects hydration:
    // snapshot/createView would fail, whereas metadata projection still works.
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: f.root, encoding: "utf8" });
    git("rm", "--", "deferred/project/detail.md");
    git("commit", "-m", "Fictional missing deferred blob projection probe");
    const projected = createMemoryStore(f.root).projection("project");
    assert.ok(
      projected.discovery.topics.some((t) => t.topic === "deferred/project"),
    );
    assert.doesNotMatch(JSON.stringify(projected), /Not automatically read/);
    git("revert", "--no-edit", "HEAD");
    writeFileSync(
      join(f.root, "config.json"),
      JSON.stringify({ ...f.config, totalBytes: 256 }),
      { mode: 0o600 },
    );
    const small = f.store.createView("project");
    assert.throws(
      () =>
        f.store.edit(
          small,
          "procedures/total.md",
          null,
          `${"x".repeat(255)}\n`,
        ),
      /total budget/,
    );
    assert.throws(
      () => parseConfig(JSON.stringify({ ...f.config, coreBytes: 32769 })),
      /ceiling/,
    );
  } finally {
    f.close();
  }
});

test("uncommitted working-file changes never activate context; retained episodes have durable progress", () => {
  const f = fixture();
  try {
    const revision = f.store.snapshot().revision;
    writeFileSync(join(f.root, "Core.md"), "# Core\nNot committed\n", {
      mode: 0o600,
    });
    assert.equal(f.store.snapshot().revision, revision);
    assert.ok(!f.store.projection("project").core.includes("Not committed"));
    const dirtyView = f.store.createView("project");
    f.store.edit(dirtyView, "procedures/new.md", null, "# New\n");
    assert.throws(() => f.store.integrate(dirtyView), /Uncommitted/);
    assert.ok(
      readFileSync(join(f.root, "Core.md"), "utf8").includes("Not committed"),
    );
    writeFileSync(
      join(f.root, "Core.md"),
      f.store.snapshot().files["Core.md"].text,
      { mode: 0o600 },
    );
    const id = digest("episode");
    f.store.recordEpisode(id, {
      id,
      project: "project",
      session: "fixture-session",
      observedAt: "2026-10-18T17:00:00.000Z",
      entryHash: digest("entry"),
      outcome: "completed",
      actions: [{ text: "Ran bounded check" }],
      results: [{ tool: "bash", error: true, text: "Check failed" }],
      input: { text: "Please correct this", source: "rpc" },
      evidence: "observed-native-unverified",
    });
    const reopened = createMemoryStore(f.root).pendingEpisodes("project");
    assert.equal(reopened.length, 1);
    assert.throws(
      () => f.store.recordEpisode(id, { ...reopened[0], evidence: "live" }),
      /provenance/,
    );
    assert.throws(
      () =>
        f.store.recordEpisode(id, {
          ...reopened[0],
          provenance: "native-live",
        }),
      /provenance/,
    );
    assert.throws(
      () =>
        f.store.recordEpisode(id, {
          ...reopened[0],
          input: { text: "Changed source", source: "rpc" },
        }),
      /changed/,
    );
    const v = f.store.createView("project");
    f.store.integrate(v, [id]);
    assert.equal(f.store.pendingEpisodes("project").length, 0);
    assert.ok(existsSync(join(f.root, ".episodes", `${id}.json`)));
  } finally {
    f.close();
  }
});
