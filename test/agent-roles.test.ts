import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const directory = new URL("../agents/", import.meta.url);
test("the package owns its reflector and commit role, not a personal workflow roster", () => {
  assert.deepEqual(readdirSync(directory).sort(), [
    "git-commit.md",
    "memory-reflector.md",
  ]);
});

test("the commit agent remains native locked and Git-command-only", () => {
  const source = readFileSync(new URL("git-commit.md", directory), "utf8");
  assert.match(source, /^model: openai\/gpt-6-luna$/m);
  assert.match(source, /^thinking: low$/m);
  assert.match(source, /^locked: model, thinking$/m);
  assert.match(source, /^tools: bash$/m);
  assert.ok(source.includes("Use Git commands only"));
});

test("the commit skill is a native package resource with explicit permission boundaries", () => {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL("package.json", root), "utf8"),
  );
  assert.deepEqual(manifest.pi.skills, ["./skills"]);
  const source = readFileSync(
    new URL("skills/git-commit/SKILL.md", root),
    "utf8",
  );
  assert.match(source, /^name: git-commit$/m);
  assert.ok(source.includes("native `subagent` tool"));
  assert.ok(source.includes("is not commit authorization"));
  assert.ok(source.includes("Never create an empty commit"));
  assert.ok(!source.includes("Agent tool"));
});

test("the required reflector retains its locked native no-tool isolated contract", () => {
  const source = readFileSync(
    new URL("memory-reflector.md", directory),
    "utf8",
  );
  const header = source.match(/^---\n([\s\S]+?)\n---\n/);
  assert.ok(header);
  for (const field of [
    "model: openai/gpt-6.1-sol",
    "thinking: medium",
    "locked: true",
    "tools: none",
    "run_in_background: true",
    "inherit_context: false",
    "prompt_mode: replace",
    "max_turns: 2",
  ]) {
    assert.ok(header[1].split("\n").includes(field), field);
  }
});
