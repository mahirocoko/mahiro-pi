import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { stageBootstrapCandidate } from "./bootstrap-candidate-fixture.ts";
import {
  stagePermissionFixture,
  productRoot,
} from "../lib/guards/test/permission-patch-fixture.mjs";

test("package-only candidate preview needs no skills supply and rejects opaque owner identities before writes", async () => {
  const candidate = await stageBootstrapCandidate();
  assert.equal(
    fs.existsSync(path.join(candidate.root, "mahiro-skills")),
    false,
  );
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(tmpdir()), "mh-owner-"),
  );
  try {
    const agentDir = path.join(root, "profile");
    fs.mkdirSync(agentDir, { mode: 0o700 });
    const opaque = path.join(agentDir, "opaque");
    fs.mkdirSync(opaque, { mode: 0o700 });
    const settings = path.join(agentDir, "settings.json");
    const request = {
      version: 1,
      agentDir,
      sources: { pi: candidate.primary },
      dependencyModules: candidate.modules,
      components: { packages: true },
    };
    for (const name of [
      "@mahirocoko/pi-guards",
      "@gotgenes/pi-permission-system",
      "@gotgenes/pi-subagents",
      "@mahirocoko/mahiro-pi",
      "unrelated-local-tools",
    ]) {
      fs.writeFileSync(
        path.join(opaque, "package.json"),
        JSON.stringify({
          name,
          pi: { extensions: ["./must-not-execute.mjs"] },
        }),
      );
      fs.writeFileSync(
        path.join(opaque, "must-not-execute.mjs"),
        'throw Error("Package code must never execute");',
      );
      for (const entry of [
        "./opaque",
        opaque,
        { source: "./opaque" },
        { source: opaque, extensions: [] },
      ]) {
        fs.writeFileSync(settings, JSON.stringify({ packages: [entry] }), {
          mode: 0o600,
        });
        const before = fs.readFileSync(settings);
        if (name === "unrelated-local-tools") {
          const plan = candidate.bootstrap.inspectBootstrap(request);
          const change = plan.changes.find(
            (item: any) => item.path === settings,
          );
          assert.deepEqual(JSON.parse(change.next).packages[0], entry);
        } else {
          assert.throws(
            () => candidate.bootstrap.inspectBootstrap(request),
            /Conflicting package source/,
          );
        }
        assert.deepEqual(fs.readFileSync(settings), before);
        assert.deepEqual(fs.readdirSync(agentDir).sort(), [
          "opaque",
          "settings.json",
        ]);
      }
    }
    assert.equal(
      fs.existsSync(path.join(candidate.root, "mahiro-skills")),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("candidate12 is staged only in owned copies; copied patch owner supports both supply states", () => {
  const manifest = path.join(productRoot, "package.json");
  const before = fs.readFileSync(manifest);
  const declaration = JSON.parse(
    fs.readFileSync(
      path.join(productRoot, "test/candidate-extensions.json"),
      "utf8",
    ),
  );
  const hashes = new Map();
  for (const supplyState of [false, true]) {
    for (const patched of [false, true]) {
      const fixture = stagePermissionFixture({
        patched,
        supplyState,
        evidenceBase: path.join(
          productRoot,
          ".agent-state/runtime/candidate-isolation/matrix",
        ),
      });
      assert.deepEqual(
        JSON.parse(
          fs.readFileSync(path.join(fixture.primary, "package.json"), "utf8"),
        ).pi.extensions,
        declaration.candidate,
      );
      assert.equal(fixture.attestation.suppliedPatched, supplyState);
      assert.equal(fixture.attestation.patched, patched);
      assert.ok(Object.keys(fixture.attestation.hashes).length > 0);
      if (hashes.has(patched))
        assert.deepEqual(fixture.attestation.hashes, hashes.get(patched));
      hashes.set(patched, fixture.attestation.hashes);
      assert.deepEqual(fs.readFileSync(manifest), before);
    }
  }
  assert.deepEqual(
    JSON.parse(before.toString()).pi.extensions,
    declaration.active,
  );
  assert.notDeepEqual(hashes.get(true), hashes.get(false));
});
