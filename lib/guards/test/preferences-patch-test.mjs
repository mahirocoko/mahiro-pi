import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { stagePermissionFixture } from "./permission-patch-fixture.mjs";

test("native Models + RTK actual public SDK, patched exact grants and unpatched-owner denial, no Mods checkout", () => {
  for (const patched of [true, false]) {
    const stage = stagePermissionFixture({ patched });
    const env = {
      ...process.env,
      PREFERENCES_EXPECT_OWNER: patched ? "patched" : "old",
    };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(
      process.execPath,
      ["--test", path.join(stage.adapter, "test/preferences-test.mjs")],
      { env, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
    );
    fs.writeFileSync(
      path.join(stage.root, "preferences-sdk.log"),
      r.stdout + r.stderr,
    );
    fs.writeFileSync(
      path.join(stage.root, "preferences-sdk-exit.json"),
      JSON.stringify(
        {
          status: r.status,
          signal: r.signal,
          patched,
          modsCheckoutPresent: fs.existsSync(path.join(stage.root, "mods")),
          live: false,
        },
        null,
        2,
      ),
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
});
