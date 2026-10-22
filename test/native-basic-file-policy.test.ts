import assert from "node:assert/strict";
import { test } from "node:test";
import { planNativeBasicFilePolicy } from "../lib/native-basic-file-policy.ts";

const names = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.test",
  ".env.production",
  ".env.staging",
  ".env.development.local",
  ".env.test.local",
  ".env.production.local",
  ".env.staging.local",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "auth.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ecdsa_sk",
  "id_ed25519",
  "id_ed25519_sk",
];
const patterns = names.flatMap((name) => [name, `*/${name}`]);
const encode = (permission: unknown, extra = {}) =>
  JSON.stringify({ ...extra, permission });

test("native basic finite defaults, incomplete input and byte idempotence", () => {
  const fresh = planNativeBasicFilePolicy(null);
  assert.equal(fresh.status, "added");
  assert.equal(fresh.runtimePolicy, "public-service-authoritative");
  assert.deepEqual(fresh.addedPatterns, patterns);
  const read = JSON.parse(fresh.next!).permission.path_read;
  assert.deepEqual(Object.keys(read), patterns);
  assert.ok(Object.values(read).every((value) => value === "deny"));
  for (const absent of [
    ".env.*",
    ".env.example",
    ".env.custom",
    "*.pem",
    "id_rsa.pub",
  ])
    assert.equal(Object.hasOwn(read, absent), false);
  const again = planNativeBasicFilePolicy(fresh.next);
  assert.equal(again.next, fresh.next);
  assert.equal(again.changed, false);
  assert.equal(again.status, "unchanged");
  const partial = planNativeBasicFilePolicy(
    encode({ path_read: { ".env": "ask" } }),
  );
  assert.deepEqual(
    partial.addedPatterns,
    patterns.filter((key) => key !== ".env"),
  );
  assert.equal(JSON.parse(partial.next!).permission.path_read[".env"], "ask");
});

test("native basic prepends without changing old decisions, reasons or order", () => {
  const old = {
    "*/.env": "allow",
    ".env": { action: "deny", reason: "my reason" },
    "*": "allow",
  };
  const previous = encode(
    {
      "*": "deny",
      path_read: old,
      path_write: "allow",
      bash: "ask",
      external_directory: "deny",
      read: "allow",
    },
    { yoloMode: true },
  );
  const plan = planNativeBasicFilePolicy(previous);
  const config = JSON.parse(plan.next!);
  assert.deepEqual(
    Object.entries(config.permission.path_read).slice(-3),
    Object.entries(old),
  );
  assert.deepEqual(
    { ...config.permission, path_read: old },
    JSON.parse(previous).permission,
  );
  assert.equal(config.yoloMode, true);
  assert.ok(plan.warnings.length > 0);
});

test("native basic skips generic path, scalar directional and wildcard surfaces byte exactly", () => {
  for (const permission of [
    { path: { ".env": "allow" } },
    { path: "deny", path_read: {} },
    { path_read: "ask" },
    { path_read: "allow" },
    { path_read: "deny" },
    { "path*": "allow" },
    { "r?ad": "deny" },
    { "[p]ath": "ask" },
  ]) {
    const previous = encode(permission);
    const plan = planNativeBasicFilePolicy(previous);
    assert.equal(plan.status, "skipped");
    assert.equal(plan.next, previous);
    assert.equal(plan.changed, false);
    assert.deepEqual(plan.addedPatterns, []);
    assert.ok(plan.retainedSurfaces.length > 0);
    assert.ok(plan.warnings.length > 0);
  }
});

test("native basic refuses unsupported schema, bounds and integer pattern ordering", () => {
  for (const previous of [
    "{",
    "[]",
    '{"unknown":true}',
    encode({ path_read: { "0": "allow" } }),
    " ".repeat(1048577),
  ])
    assert.throws(() => planNativeBasicFilePolicy(previous));
  assert.equal(planNativeBasicFilePolicy(null).changed, true);
});
