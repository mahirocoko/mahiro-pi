import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { RTK_HELPER_BOUNDS, rtkModes } from "../lib/rtk.ts";

const root = path.resolve(import.meta.dirname, "..");
const text = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const files = (dir: string): string[] =>
  fs
    .readdirSync(path.join(root, dir), { withFileTypes: true })
    .filter((e) => e.name !== "node_modules" && e.name !== "test")
    .flatMap((e) =>
      e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
    );

test("retired Saved Models has no executable, manifest, guard ABI, provenance or format surface; actual/mirrored guards-first13 retain exact order", () => {
  const declaration = JSON.parse(text("test/candidate-extensions.json"));
  const pkg = JSON.parse(text("package.json"));
  assert.equal(declaration.active.length, 13);
  assert.deepEqual(pkg.pi.extensions, declaration.active);
  assert.equal(declaration.candidate.length, 13);
  assert.deepEqual(declaration.candidate, declaration.active);
  assert.deepEqual(declaration.active.slice(0, 2), [
    "./lib/guards/bootstrap.mjs",
    "./lib/guards/index.ts",
  ]);
  assert.equal(declaration.active.slice(2, 12).length, 10);
  assert.equal(declaration.active[12], "./extensions/mahiro-claude-ui.ts");
  for (const file of [
    "lib/model-profiles.ts",
    "extensions/mahiro-model-profiles.ts",
    "test/model-profiles.test.ts",
  ])
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  const retired =
    /model-profiles|modelProfiles|model_profiles|mh-model-profile|registerModelProfiles|trustedPreferenceTool/;
  for (const file of [
    ...files("lib"),
    ...files("extensions"),
    "package.json",
    "biome.json",
    "check-package.mjs",
    "check-public-sdk.mjs",
    "test/candidate-extensions.json",
  ])
    assert.doesNotMatch(text(file), retired, file);
  assert.ok(
    fs.existsSync(
      path.join(root, "test/oracles/letta/mahiro-model-profiles.ts"),
    ),
    "historical oracle must not be erased",
  );
  assert.match(
    text("lib/guards/provenance.mjs"),
    /export function trustedRTKTool/,
  );
  assert.match(text("package.json"), /lib\/rtk-state\.ts/);
  assert.match(text("biome.json"), /test\/rtk\*\.test\.ts/);
});

test("current context owns real RTK helper semantics and retirement, not the historical grammar-only candidate13 contract", () => {
  assert.deepEqual(rtkModes, ["off", "suggest", "rewrite-safe", "rewrite-rtk"]);
  assert.deepEqual(RTK_HELPER_BOUNDS, {
    inputBytes: 4096,
    outputBytes: 16384,
    timeoutMs: 1500,
    concurrent: 4,
  });
  const integration = text("docs/integrations.md");
  const current = integration.slice(
    0,
    integration.indexOf("## Pi worker activity"),
  );
  // Architecture contracts retain the exact graph label; the product README
  // navigates to those owners instead of repeating an internal migration token.
  for (const owner of ["AGENTS.md", "docs/bootstrap.md"])
    assert.match(text(owner), /guards-first13/, owner);
  assert.match(text("README.md"), /\(docs\/guards\.md\)/);
  assert.match(text("README.md"), /\(docs\/rtk\.md\)/);
  assert.match(text("docs/README.md"), /\(rtk\.md\)/);
  for (const owner of ["AGENTS.md", "README.md", "docs/bootstrap.md"])
    assert.doesNotMatch(
      text(owner),
      /candidate13|thirteen-resource|No rewrite helper|Both rewrite modes use a bounded deterministic grammar/,
      owner,
    );
  assert.doesNotMatch(
    current,
    /candidate13|saved Models last|no .*rewrite.*subprocess|Both rewrite modes use a bounded deterministic grammar/,
  );
  for (const claim of [
    "RETIRED/removed",
    "lib/rtk-state.ts",
    "execFile",
    '["rewrite", "--", original]',
    "4096",
    "16384",
    "1500",
    "SIGKILL",
    "Exit **0**",
    "**3**",
    "**1**",
    "**2**",
    "guarded original",
    "CAS",
    "0700",
    "0600",
    "hostApprovalRequired",
    "Direct `git commit`",
    "mixed chains",
    "Savings",
  ])
    assert.ok(current.includes(claim), claim);
  const table = integration.slice(
    integration.indexOf("## Current disposition of the 15 Letta entries"),
    integration.indexOf("### Remaining ecosystem gate"),
  );
  assert.equal(
    table.split("\n").filter((line) => /^\| `/.test(line)).length,
    15,
  );
  assert.match(
    table,
    /mahiro-model-profiles.*RETIRED\/removed.*20 October 2026/,
  );
  assert.match(table, /rtk-control.*rtk-patch-test\.mjs/);
  assert.match(text("check-public-sdk.mjs"), /rtk-patch-test\.mjs/);
});
