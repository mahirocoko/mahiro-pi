// Explicit offline public-package supply. No Mods lookup or installed-owner writes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { normalizeSubagentsCopy } from "./subagents-supply-fixture.mjs";

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
  extensions = "candidate",
  supplyState,
} = {}) {
  assert.ok(["active", "candidate"].includes(extensions));
  assert.ok(supplyState === undefined || typeof supplyState === "boolean");
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
    "install.mjs",
    "patches",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
  ])
    fs.cpSync(path.join(productRoot, name), path.join(primary, name), {
      recursive: true,
      filter: (name) => !name.split(path.sep).includes("node_modules"),
    });
  const declaration = JSON.parse(
    fs.readFileSync(
      path.join(productRoot, "test/candidate-extensions.json"),
      "utf8",
    ),
  );
  fs.mkdirSync(path.join(primary, "test"), { recursive: true });
  fs.copyFileSync(
    path.join(productRoot, "test/candidate-extensions.json"),
    path.join(primary, "test/candidate-extensions.json"),
  );
  fs.cpSync(
    path.join(productRoot, "test/oracles/subagents"),
    path.join(primary, "test/oracles/subagents"),
    { recursive: true },
  );
  const manifestPath = path.join(primary, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.deepEqual(
    manifest.pi.extensions,
    productRoot.includes(
      `${path.sep}.agent-state${path.sep}runtime${path.sep}`,
    ) && manifest.pi.extensions.length === declaration.candidate.length
      ? declaration.candidate
      : declaration.active,
    "Only the disposable candidate source may already declare candidate12",
  );
  manifest.pi.extensions = declaration[extensions];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
  const subagentsHash = createHash("sha256")
    .update(
      fs.readFileSync(
        path.join(productRoot, "patches/@gotgenes__pi-subagents@23.4.1.patch"),
      ),
    )
    .digest("hex");
  const subagents = path.join(
    root,
    `pi-subagents@23.4.1(patch_hash=${subagentsHash})`,
  );
  const subagentsAttestation = normalizeSubagentsCopy({
    product: productRoot,
    supplied: fs.realpathSync(
      path.join(publicModules, "@gotgenes/pi-subagents"),
    ),
    target: subagents,
    ceiling: root,
  });
  fs.symlinkSync(
    path.resolve(
      fs.realpathSync(path.join(publicModules, "@gotgenes/pi-subagents")),
      "../..",
    ),
    path.join(subagents, "node_modules"),
    "dir",
  );
  fs.symlinkSync(
    subagents,
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
  // Only the newly created owned copy may be normalized. Both probes must
  // identify exactly one reviewed patch state; drift fails closed.
  const git = (...args) =>
    spawnSync("git", ["apply", ...args, permissionPatch], {
      cwd: permissions,
      encoding: "utf8",
      env: { ...process.env, GIT_CEILING_DIRECTORIES: root },
    });
  const detect = () => {
    const forward = git("--check"),
      reverse = git("--reverse", "--check");
    assert.notEqual(
      forward.status === 0,
      reverse.status === 0,
      `Unknown permission owner patch state: ${forward.stderr}\n${reverse.stderr}`,
    );
    return reverse.status === 0;
  };
  const normalize = (desired) => {
    if (detect() !== desired) {
      const applied = desired ? git() : git("--reverse");
      assert.equal(applied.status, 0, applied.stdout + applied.stderr);
    }
    assert.equal(detect(), desired);
  };
  const installedPatched = detect();
  if (supplyState !== undefined) normalize(supplyState);
  const suppliedPatched = detect();
  normalize(patched);
  const ownerSource = fs.readFileSync(
    path.join(permissions, "src/policy/permission-manager.ts"),
    "utf8",
  );
  assert.equal(/matchedSurface: rule\.surface/.test(ownerSource), patched);
  const patchSource = fs.readFileSync(permissionPatch, "utf8");
  const hashes = Object.fromEntries(
    [...patchSource.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(([, name]) => [
      name,
      createHash("sha256")
        .update(fs.readFileSync(path.join(permissions, name)))
        .digest("hex"),
    ]),
  );
  const attestation = {
    subagents: subagentsAttestation,
    installedPatched,
    suppliedPatched,
    patched,
    hashes,
    extensions,
  };
  fs.writeFileSync(
    path.join(root, "fixture-attestation.json"),
    JSON.stringify(attestation, null, 2),
  );
  assert.equal(fs.existsSync(path.join(root, "mods")), false);
  return {
    root,
    adapter,
    primary,
    permissions,
    installed,
    patched,
    attestation,
    provenance:
      "root-only-public-package-fixture-no-mods-checkout-no-live-install",
  };
}
