import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const directory = new URL("../agents/", import.meta.url);
const expected = {
  "repo-scout": ["gpt-6-luna", "max"],
  researcher: ["gpt-6.1-sol", "medium"],
  implementer: ["gpt-6.1-sol", "medium"],
  advisor: ["gpt-6-astra", "high"],
  verifier: ["gpt-6.1-sol", "medium"],
  "ui-review": ["gpt-6.1-sol", "medium"],
  "thai-copy-review": ["gpt-5.6-terra", "medium"],
  "long-task-executor": ["gpt-6.1-sol", "high"],
  "git-commit": ["gpt-6-luna", "low"],
  "general-purpose": ["gpt-6.1-sol", "medium"],
  Explore: ["gpt-6-luna", "max"],
  Plan: ["gpt-6-astra", "high"],
};

test("native role sources preserve approved model/effort bindings without provider fallback", () => {
  assert.deepEqual(
    readdirSync(directory).sort(),
    Object.keys(expected)
      .map((name) => `${name}.md`)
      .sort(),
  );
  for (const [name, [model, thinking]] of Object.entries(expected)) {
    const source = readFileSync(new URL(`${name}.md`, directory), "utf8");
    const header = source.match(/^---\n([\s\S]+?)\n---\n/);
    assert.ok(header, name);
    assert.match(
      header[1],
      new RegExp(`^model: openai/${model.replaceAll(".", "\\.")}$`, "m"),
      name,
    );
    assert.match(header[1], new RegExp(`^thinking: ${thinking}$`, "m"), name);
    assert.match(header[1], /^locked: model, thinking$/m, name);
  }
});

test("discovery/copy roles do not expose file mutation tools; commit role stays Git-command-only", () => {
  for (const name of [
    "repo-scout",
    "Explore",
    "advisor",
    "Plan",
    "thai-copy-review",
  ]) {
    const source = readFileSync(new URL(`${name}.md`, directory), "utf8");
    const tools = source.match(/^tools: (.+)$/m)?.[1].split(", ") ?? [];
    assert.ok(tools.length, name);
    for (const forbidden of ["bash", "edit", "write", "powershell"])
      assert.ok(!tools.includes(forbidden), name);
  }
  assert.match(
    readFileSync(new URL("git-commit.md", directory), "utf8"),
    /^tools: bash$/m,
  );
});
