// Explicit offline public-package supply. No Mods lookup or installed-owner writes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const adapterRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const productRoot = path.resolve(adapterRoot, "../..");
export const evidenceRoot = path.join(
  productRoot,
  ".agent-state/runtime/pi-ownership-repair/sdk",
);
export const permissionPatch = path.join(
  productRoot,
  "patches/@gotgenes__pi-permission-system@40.2.2.patch",
);
export const publicModules =
  process.env.MAHIRO_PI_TEST_MODULES || path.join(productRoot, "node_modules");

export function stagePermissionFixture({
  patched = true,
  evidenceBase = evidenceRoot,
} = {}) {
  fs.mkdirSync(evidenceBase, { recursive: true });
  const root = fs.mkdtempSync(
    path.join(evidenceBase, patched ? "patched-" : "unpatched-"),
  );
  const primary = path.join(root, "mahiro-pi"),
    adapter = path.join(primary, "lib/guards");
  fs.mkdirSync(primary);
  for (const name of [
    "package.json",
    "extensions",
    "lib",
    "agents",
    "skills",
    "bootstrap.mjs",
    "setup.mjs",
    "goal-preview.mjs",
    "patches",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
  ])
    fs.cpSync(path.join(productRoot, name), path.join(primary, name), {
      recursive: true,
      filter: (name) => !name.split(path.sep).includes("node_modules"),
    });
  const permissions = path.join(root, "permission-owner");
  const installed = fs.realpathSync(
    path.join(publicModules, "@gotgenes/pi-permission-system"),
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8"))
      .version,
    "40.2.2",
  );
  fs.cpSync(installed, permissions, {
    recursive: true,
    filter: (name) => !name.startsWith(path.join(installed, "node_modules")),
  });
  const ownerParent = path.resolve(installed, "../..");
  fs.mkdirSync(path.join(permissions, "node_modules"));
  for (const name of fs.readdirSync(ownerParent)) {
    if (name === "@gotgenes") continue;
    fs.symlinkSync(
      path.join(ownerParent, name),
      path.join(permissions, "node_modules", name),
      "dir",
    );
  }
  fs.mkdirSync(path.join(adapter, "node_modules/@gotgenes"), {
    recursive: true,
  });
  fs.symlinkSync(
    permissions,
    path.join(adapter, "node_modules/@gotgenes/pi-permission-system"),
    "dir",
  );
  fs.symlinkSync(
    fs.realpathSync(path.join(publicModules, "@gotgenes/pi-subagents")),
    path.join(adapter, "node_modules/@gotgenes/pi-subagents"),
    "dir",
  );
  for (const name of ["@earendil-works", "typebox", "esbuild"])
    fs.symlinkSync(
      path.join(publicModules, name),
      path.join(adapter, "node_modules", name),
      "dir",
    );
  // Feature source resolves public packages from its own declared root, not a sibling checkout.
  fs.symlinkSync(
    path.join(adapter, "node_modules"),
    path.join(primary, "node_modules"),
    "dir",
  );
  if (patched) {
    const apply = spawnSync("git", ["apply", permissionPatch], {
      cwd: permissions,
      encoding: "utf8",
      env: { ...process.env, GIT_CEILING_DIRECTORIES: root },
    });
    assert.equal(apply.status, 0, apply.stdout + apply.stderr);
    assert.match(
      fs.readFileSync(
        path.join(permissions, "src/policy/permission-manager.ts"),
        "utf8",
      ),
      /matchedSurface: rule\.surface/,
    );
  }
  assert.equal(fs.existsSync(path.join(root, "mods")), false);
  return {
    root,
    adapter,
    primary,
    permissions,
    installed,
    patched,
    provenance:
      "root-only-public-package-fixture-no-mods-checkout-no-live-install",
  };
}
