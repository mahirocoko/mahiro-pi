import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import {
  UI_DEFAULTS,
  decodeUIState,
  nextUIState,
  uiStateTicket,
  validateUIPreferences,
  validateUIState,
} from "../lib/claude-ui-preferences.ts";
import {
  featureCapability,
  featureGrants,
  featureNamespaces,
} from "../lib/feature-data.ts";
import { trustedOwnUICommand } from "../lib/guards/provenance.mjs";

test("own-UI closed state: absence, raw-byte CAS, bounded strict UTF-8 and fixed errors", () => {
  const initial = decodeUIState(null);
  assert.deepEqual(initial.state, { version: 1, sequence: 0, ...UI_DEFAULTS });
  const next = nextUIState(initial, { ...UI_DEFAULTS, palette: "claude" });
  assert.equal(next.sequence, 1);
  const bytes = Buffer.from(JSON.stringify(next));
  assert.deepEqual(decodeUIState(bytes).state, next);
  assert.notEqual(
    uiStateTicket(bytes),
    uiStateTicket(Buffer.concat([bytes, Buffer.from("\n")])),
  );
  assert.notEqual(uiStateTicket(null), uiStateTicket(Buffer.alloc(0)));
  for (const invalid of [
    { ...next, unknown: "secret" },
    { ...next, version: 2 },
    { ...next, sequence: -1 },
    { ...next, sequence: 1.1 },
    { ...next, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...next, extraDetail: "false" },
    { ...next, palette: "host" },
    [],
    null,
  ])
    assert.throws(
      () => validateUIState(invalid),
      /^Error: Invalid own-UI state$/,
    );
  for (const invalid of [
    Buffer.from("{secret"),
    Buffer.from([0xff]),
    Buffer.from("{}"),
  ])
    assert.throws(
      () => decodeUIState(invalid),
      /^Error: Invalid own-UI state$/,
    );
  assert.throws(() => decodeUIState(Buffer.alloc(4097)), /byte limit/);
  assert.throws(
    () => validateUIPreferences(next),
    /Invalid own-UI preferences/,
  );
  assert.throws(
    () =>
      nextUIState(
        { ...initial, state: { ...next, sequence: Number.MAX_SAFE_INTEGER } },
        UI_DEFAULTS,
      ),
    /exhausted/,
  );
});

test("own-UI DATA grant hashes the exact profile-wide root and has no model tool", () => {
  const profile = "/canonical/profile";
  const root = join(profile, "preferences/own-ui");
  const namespace = featureNamespaces(profile).find(
    (item) => item.prefix === "own_ui_state",
  )!;
  assert.deepEqual(namespace, { prefix: "own_ui_state", root, tools: [] });
  const cap = `own_ui_state_data_${createHash("sha256").update(root).digest("hex")}`;
  assert.equal(featureCapability("own_ui_state", root), cap);
  assert.equal(featureGrants(profile).filter((item) => item === cap).length, 1);
  assert.equal(featureGrants(profile).includes("mh_ui"), false);
});

test("own-UI registered command: sole canonical package identity, all bare-name collisions deny", () => {
  const baseDir = fileURLToPath(new URL("../", import.meta.url)).replace(
    /\/$/,
    "",
  );
  const good = {
    name: "mh-ui",
    source: "extension",
    sourceInfo: {
      origin: "package",
      scope: "temporary",
      baseDir,
      path: join(baseDir, "extensions/mahiro-claude-ui.ts"),
    },
  };
  assert.equal(trustedOwnUICommand([good]), true);
  assert.equal(
    trustedOwnUICommand([
      { ...good, name: "skill:mh-ui", source: "skill" },
      good,
    ]),
    true,
  );
  for (const commands of [
    [],
    [
      { ...good, name: "mh-ui:1" },
      { ...good, name: "mh-ui:2" },
    ],
    [good, { name: "mh-ui", source: "prompt" }],
    [{ name: "mh-ui", source: "prompt" }, good],
    [{ ...good, source: "prompt" }],
    [{ ...good, sourceInfo: { ...good.sourceInfo, origin: "top-level" } }],
    [{ ...good, sourceInfo: { ...good.sourceInfo, baseDir: `${baseDir}/.` } }],
    [
      {
        ...good,
        sourceInfo: {
          ...good.sourceInfo,
          path: join(baseDir, "extensions/mahiro-status.ts"),
        },
      },
    ],
  ])
    assert.equal(trustedOwnUICommand(commands), false);
});
