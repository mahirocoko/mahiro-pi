// Disposable installation topology; never activate a copied owner in a real profile.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  productRoot,
  stagePermissionFixture,
} from "../lib/guards/test/permission-patch-fixture.mjs";

export async function stageBootstrapCandidate(
  options: { skillsSupply?: string } = {},
) {
  const stage = stagePermissionFixture({
    evidenceBase: path.join(
      productRoot,
      ".agent-state/runtime/candidate-isolation/bootstrap",
    ),
  });
  // Proven standalone CLI topology: no dependency symlinks inside hashed lib/.
  fs.unlinkSync(path.join(stage.primary, "node_modules"));
  fs.renameSync(
    path.join(stage.adapter, "node_modules"),
    path.join(stage.primary, "node_modules"),
  );
  if (options.skillsSupply) {
    const skills = path.join(stage.root, "mahiro-skills");
    const skillOwner = options.skillsSupply;
    fs.mkdirSync(skills);
    for (const name of [
      "package.json",
      "src",
      "skills/recap",
      ".claude-plugin/marketplace.json",
    ]) {
      fs.mkdirSync(path.dirname(path.join(skills, name)), { recursive: true });
      fs.cpSync(path.join(skillOwner, name), path.join(skills, name), {
        recursive: true,
      });
    }
    fs.symlinkSync(
      path.join(skillOwner, "node_modules"),
      path.join(skills, "node_modules"),
      "dir",
    );
  }
  const bootstrap = await import(
    pathToFileURL(path.join(stage.primary, "lib/bootstrap.ts")).href
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(productRoot, "package.json"), "utf8"))
      .pi.extensions.length,
    12,
  );
  return {
    ...stage,
    bootstrap,
    modules: path.join(stage.primary, "node_modules"),
  };
}
