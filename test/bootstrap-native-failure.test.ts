import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  applyBootstrap,
  inspectBootstrap,
  type BootstrapRequest,
} from "../lib/bootstrap.ts";

const product = resolve(import.meta.dirname, "..");
const available = existsSync(
  join(
    process.env.MAHIRO_PI_TEST_MODULES ?? join(product, "node_modules"),
    "@earendil-works/pi-coding-agent/package.json",
  ),
);

test("native seed preflight requires exact 0600 before loading public SDK", () => {
  const base = join(product, ".agent-state/runtime");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const fixture = mkdtempSync(join(base, "bootstrap-native-seed-"));
  const seedFile = join(fixture, "seed.md");
  const seed = "# Core\nSynthetic preflight.\n";
  writeFileSync(seedFile, seed, { mode: 0o600 });
  // Intercept only metadata reads: 0600 must reach the public SDK load boundary,
  // while private-but-nonexact and special modes reject before it.
  // Never import or alter installed code.
  const preload = `import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
const saved = fs.readFileSync;
fs.readFileSync = (path, ...args) => {
  if (String(path).endsWith("/pi-coding-agent/package.json")) process.exit(42);
  return saved(path, ...args);
};
syncBuiltinESMExports();`;
  try {
    for (const mode of [0o400, 0o700, 0o4600, 0o2600, 0o1600, 0o600]) {
      chmodSync(seedFile, mode);
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          `data:text/javascript,${encodeURIComponent(preload)}`,
          join(product, "lib/bootstrap-native.mjs"),
        ],
        {
          cwd: fixture,
          encoding: "utf8",
          timeout: 30000,
          env: {
            ...process.env,
            PI_CODING_AGENT_DIR: join(fixture, "agent"),
            MAHIRO_AGENT_MEMORY_ROOT: join(fixture, "memory"),
            MAHIRO_BOOTSTRAP_REQUEST: JSON.stringify({
              project: fixture,
              agentDir: join(fixture, "agent"),
              root: join(fixture, "memory"),
              seedFile,
              dependencyModules: process.env.MAHIRO_PI_TEST_MODULES,
              seedHash: createHash("sha256").update(seed).digest("hex"),
            }),
          },
        },
      );
      assert.equal(result.status, mode === 0o600 ? 42 : 1, result.stderr);
      assert.equal(readFileSync(seedFile, "utf8"), seed);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("guarded native initialization hook failure reports partial progress and invalid existing root blocks retry without reseeding", {
  skip: !available && "private canonical SDK prerequisites absent",
}, () => {
  const base = join(product, ".agent-state/runtime");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const fixture = mkdtempSync(join(base, "bootstrap-native-failure-"));
  const project = join(fixture, "project"),
    hooks = join(fixture, "hooks"),
    seedFile = join(fixture, "seed.md"),
    memory = join(fixture, "memory");
  mkdirSync(project, { mode: 0o700 });
  mkdirSync(hooks, { mode: 0o700 });
  writeFileSync(seedFile, "# Core\nSynthetic hook failure identity.\n", {
    mode: 0o600,
  });
  writeFileSync(
    join(hooks, "pre-commit"),
    `#!/bin/sh\nprintf hook-ran > '${join(fixture, "hook-ran")}'\nexit 1\n`,
    { mode: 0o700 },
  );
  const request: BootstrapRequest = {
    version: 1,
    dependencyModules: process.env.MAHIRO_PI_TEST_MODULES,
    agentDir: join(fixture, "agent"),
    sources: {
      pi: product,
      skills: resolve(product, "../mahiro-skills"),
    },
    components: {
      packages: true,
      roles: true,
      memory: { root: memory, project, projectId: "fixture", seedFile },
    },
  };
  const keys = [
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "GIT_CONFIG_GLOBAL",
  ];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME =
      "Synthetic fixture";
    process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL =
      "fixture@example.invalid";
    const fixtureConfig = join(fixture, "gitconfig");
    writeFileSync(fixtureConfig, `[core]\n  hooksPath = ${hooks}\n`, {
      mode: 0o600,
    });
    process.env.GIT_CONFIG_GLOBAL = fixtureConfig;
    const plan = inspectBootstrap(request);
    let caught: any;
    try {
      applyBootstrap(plan, plan.digest);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught?.receipt);
    assert.equal(caught.receipt.status, "partial-or-failed");
    assert.equal(caught.receipt.steps.at(-1).kind, "memory-initialize-native");
    assert.equal(caught.receipt.steps.at(-1).status, "failed");
    assert.ok(
      caught.receipt.steps
        .slice(0, -1)
        .every((step: any) => step.status === "completed"),
    );
    assert.equal(
      existsSync(join(fixture, "hook-ran")),
      true,
      "native store honored inherited hook",
    );
    assert.equal(
      existsSync(memory),
      true,
      "partial private root retained for inspection",
    );
    assert.equal(
      JSON.stringify(caught.receipt).includes(
        "Synthetic hook failure identity",
      ),
      false,
    );
    assert.throws(() => inspectBootstrap(request));
    assert.equal(
      readFileSync(seedFile, "utf8"),
      "# Core\nSynthetic hook failure identity.\n",
    );
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});
