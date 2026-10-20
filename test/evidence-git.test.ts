import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { GitInspection } from "../lib/evidence/git.ts";

const base = path.resolve(".agent-state/runtime/evidence-port/git");
fs.mkdirSync(base, { recursive: true, mode: 0o700 });
function repo() {
  const root = fs.mkdtempSync(path.join(base, "repo-"));
  const git = (...args: string[]) =>
    execFileSync("/usr/bin/git", args, {
      cwd: root,
      encoding: "utf8",
      env: { HOME: root, PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1" },
    });
  git("init", "-q");
  git("config", "user.name", "Offline Fixture");
  git("config", "user.email", "offline@example.test");
  fs.writeFileSync(path.join(root, "tracked"), "first\n");
  git("add", ".");
  git("commit", "-qm", "first");
  return { root, git };
}
test("FIRST FALSIFIER: configured child denies before parent-wide inspection", async () => {
  const { root } = repo(),
    child = path.join(root, "child"),
    sibling = path.join(root, "changed-sibling");
  fs.mkdirSync(child);
  fs.writeFileSync(sibling, "sibling private");
  const tails: string[][] = [];
  const inspection = new GitInspection(child, {
    assertCurrent() {},
    assertSources() {},
    async authorizeGit(_exe, args) {
      tails.push(args);
    },
  });
  try {
    await assert.rejects(inspection.preflight(child), /top-level/);
    assert.equal(tails.length, 1);
    assert.deepEqual(tails[0].slice(-2), ["rev-parse", "--show-toplevel"]);
  } finally {
    inspection.close();
  }
});

test("bound literal diff cannot inspect newly indexed denied names or directory descendants", async () => {
  for (const replaceDirectory of [false, true]) {
    const { root, git } = repo();
    const home = process.env.HOME;
    process.env.HOME = root;
    fs.writeFileSync(path.join(root, "tracked"), "changed\n");
    let injected = false;
    const inspected: string[] = [];
    const inspection = new GitInspection(root, {
      assertCurrent() {},
      assertSources(paths) {
        if (paths.some((p) => p.endsWith("/denied")))
          throw Error("fixture denied source");
      },
      async authorizeGit(_exe, args) {
        if (!injected && args.includes("diff")) {
          injected = true;
          if (replaceDirectory) {
            fs.unlinkSync(path.join(root, "tracked"));
            fs.mkdirSync(path.join(root, "tracked"));
          }
          const denied = replaceDirectory ? "tracked/denied" : "denied";
          fs.writeFileSync(path.join(root, denied), "MUST_NOT_BE_INSPECTED\n");
          git("add", "--", denied);
        }
        if (args.includes("diff")) inspected.push(args.join("\0"));
      },
    });
    try {
      await inspection.preflight(root);
      // Inspect this one bound lane. Next inventory must reject the added source.
      const lane = await inspection.diff([]);
      assert.equal(injected, true);
      assert.equal(
        lane.entries.some((item) => item.path.includes("denied")),
        false,
      );
      assert.ok(
        inspected.every((argv) =>
          argv.includes(":(top,literal,exclude)tracked/"),
        ),
      );
      await assert.rejects(inspection.diff([]), /fixture denied source/);
    } finally {
      inspection.close();
      if (home === undefined) delete process.env.HOME;
      else process.env.HOME = home;
    }
  }
});

test("repository-generated magic, leading-option and control names stay literal data", async () => {
  const { root, git } = repo();
  const home = process.env.HOME;
  process.env.HOME = root;
  const names = ["-option", ":(glob)**", "line\nname"];
  for (const name of names)
    fs.writeFileSync(path.join(root, name), "original\n");
  git("add", ".");
  git("commit", "-qm", "literal names");
  for (const name of names)
    fs.writeFileSync(path.join(root, name), "changed\n");
  const inspection = new GitInspection(root, {
    assertCurrent() {},
    assertSources() {},
    async authorizeGit() {},
  });
  try {
    await inspection.preflight(root);
    const sample = await inspection.sample(null);
    assert.equal(sample.unstaged.entries.length, 3);
    assert.ok(
      sample.unstaged.entries.some((item) => item.path === ":(glob)**"),
    );
  } finally {
    inspection.close();
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
  }
});
export { repo };
