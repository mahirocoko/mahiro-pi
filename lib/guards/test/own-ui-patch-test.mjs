import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  productRoot,
  stagePermissionFixture,
} from "./permission-patch-fixture.mjs";

for (const patched of [true, false])
  test(`own-UI actual Root/public SDK ${patched ? "positive and denial gates" : "unattested owner denies"}`, () => {
    const stage = stagePermissionFixture({
      patched,
      extensions: "active",
      evidenceBase: path.join(
        productRoot,
        ".agent-state/runtime/claude-workflow-v2/t232-storage/sdk",
      ),
    });
    // Match the authored root's resolution graph, not a whole-node_modules symlink.
    fs.unlinkSync(path.join(stage.primary, "node_modules"));
    fs.renameSync(
      path.join(stage.adapter, "node_modules"),
      path.join(stage.primary, "node_modules"),
    );
    const env = {
      ...process.env,
      OWN_UI_EXPECT_OWNER: patched ? "patched" : "old",
    };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        path.join(stage.adapter, "test/own-ui-sdk-test.mjs"),
      ],
      { env, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
    );
    fs.writeFileSync(
      path.join(stage.root, "sdk.log"),
      result.stdout + result.stderr,
    );
    fs.writeFileSync(
      path.join(stage.root, "sdk-exit.json"),
      JSON.stringify(
        {
          status: result.status,
          signal: result.signal,
          error: String(result.error ?? ""),
          provenance: stage.provenance,
          patched,
          productionProfile: false,
        },
        null,
        2,
      ),
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# pass 1/);
  });
