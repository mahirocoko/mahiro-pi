import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { stagePermissionFixture } from "./permission-patch-fixture.mjs";

test("Bash aggregate approval through public SDK/Faux, offline", () => {
  for (const patched of [true, false]) {
    const stage = stagePermissionFixture({ patched });
    const env = {
      ...process.env,
      BASH_EXPECT_OWNER: patched ? "patched" : "old",
    };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(
      process.execPath,
      ["--test", path.join(stage.adapter, "test/bash-approval-sdk-test.mjs")],
      { env, encoding: "utf8", timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
    );
    fs.writeFileSync(
      path.join(stage.root, "bash-approval-sdk.log"),
      r.stdout + r.stderr,
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
});
