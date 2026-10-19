import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  applyBootstrap,
  assertBootstrapModsContract,
  bootstrapSummary,
  hashBootstrapNativePayload,
  inspectBootstrap,
  readBootstrapFile,
  readBootstrapRequest,
  type BootstrapRequest,
} from "../lib/bootstrap.ts";
import { setupTarget } from "../lib/setup.ts";

const product = resolve(import.meta.dirname, "..");
const fixtures = join(product, ".agent-state/runtime/bootstrap-tests");
mkdirSync(fixtures, { recursive: true, mode: 0o700 });
const fixture = (run: (root: string, request: BootstrapRequest) => void) => {
  const root = mkdtempSync(join(fixtures, "case-"));
  const request: BootstrapRequest = {
    version: 1,
    agentDir: join(root, "agent"),
    sources: {
      pi: product,
      mods: resolve(product, "../mods"),
      skills: resolve(product, "../mahiro-skills"),
    },
    components: {
      packages: true,
      roles: true,
      skills: ["recap"],
      skillPolicy: true,
    },
  };
  try {
    run(root, request);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const put = (path: string, value: unknown) => {
  mkdirSync(resolve(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(
    path,
    typeof value === "string" ? value : JSON.stringify(value),
    { mode: 0o600 },
  );
};
const parse = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const prerequisites =
  existsSync(
    resolve(product, "../mods/adapters/pi/node_modules/@gotgenes/pi-subagents"),
  ) && spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0;
const localTest = (name: string, fn: () => void) =>
  test(
    name,
    {
      skip: !prerequisites && "private canonical Mods/Bun prerequisites absent",
    },
    fn,
  );

localTest(
  "bootstrap actually applies an empty disposable profile; rerun is byte-idempotent except explicit receipts",
  () =>
    fixture((root, r) => {
      const plan = inspectBootstrap(r);
      assert.equal(existsSync(r.agentDir), false, "plan writes nothing");
      assert.ok(plan.dependencies.subagents.includes("patch_hash="));
      const summary = bootstrapSummary(plan);
      assert.equal(summary.atomicAcrossOwners, false);
      const receipt = applyBootstrap(plan, plan.digest);
      assert.equal(receipt.status, "completed");
      assert.ok(receipt.steps.every((s: any) => s.status === "completed"));
      const settings = parse(join(r.agentDir, "settings.json"));
      assert.deepEqual(settings.packages, [
        plan.dependencies.permissions,
        plan.dependencies.subagents,
        join(r.sources.mods, "adapters/pi"),
        product,
      ]);
      assert.deepEqual(
        parse(join(r.agentDir, "extensions/pi-subagents/config.json"))
          .excludedExtensionPackages,
        [plan.dependencies.subagents],
      );
      assert.deepEqual(parse(setupTarget(r.agentDir)), {
        permission: { skill: "allow" },
      });
      assert.equal(
        readFileSync(
          join(r.agentDir, "agents/managed-memory-writer.md"),
          "utf8",
        ),
        readFileSync(join(product, "agents/managed-memory-writer.md"), "utf8"),
      );
      assert.equal(
        parse(
          join(r.agentDir, ".mahiro-skills/receipts/global-pi.json"),
        ).installedSkills.includes("recap"),
        true,
      );
      for (const path of [r.agentDir, join(r.agentDir, "agents")])
        assert.equal(lstatSync(path).mode & 0o777, 0o700);
      for (const path of [
        join(r.agentDir, "settings.json"),
        join(r.agentDir, "agents/memory-reflector.md"),
        receipt.receiptPath,
      ])
        assert.equal(lstatSync(path).mode & 0o777, 0o600);
      const before = readFileSync(
        join(r.agentDir, ".mahiro-skills/receipts/global-pi.json"),
        "utf8",
      );
      const rerun = inspectBootstrap(r);
      const again = applyBootstrap(rerun, rerun.digest);
      assert.ok(again.steps.every((s: any) => s.result.changed === false));
      assert.equal(
        readFileSync(
          join(r.agentDir, ".mahiro-skills/receipts/global-pi.json"),
          "utf8",
        ),
        before,
      );
      assert.equal(readdirSync(join(r.agentDir, "agents")).length, 3);
      assert.equal(existsSync(join(r.agentDir, "auth.json")), false);
      assert.equal(existsSync(join(r.agentDir, "AGENTS.md")), false);
      assert.equal(existsSync(join(r.agentDir, "memory")), false);
    }),
);

localTest(
  "bootstrap preserves defaults, personal roster, unrelated settings, denies, ordered skill rules and yolo=true",
  () =>
    fixture((_root, r) => {
      const settings = {
        defaultProvider: "unchanged",
        defaultModel: "unchanged-model",
        defaultThinkingLevel: "high",
        packages: ["/unrelated/local-package"],
        customProperty: { untouched: true },
      };
      put(join(r.agentDir, "settings.json"), settings);
      chmodSync(join(r.agentDir, "settings.json"), 0o640);
      put(join(r.agentDir, "agents/personal.md"), "personal role unchanged\n");
      put(join(r.agentDir, "extensions/pi-subagents/config.json"), {
        maxConcurrentAgents: 2,
        excludedExtensionPackages: ["/unrelated/package"],
      });
      const permission = {
        yoloMode: true,
        authorizerChain: [],
        permission: {
          "*": "deny",
          bash: "deny",
          skill: { "dangerous-*": { action: "deny", reason: "keep reason" } },
        },
      };
      put(setupTarget(r.agentDir), permission);
      const plan = inspectBootstrap(r);
      const receipt = applyBootstrap(plan, plan.digest);
      const next = parse(join(r.agentDir, "settings.json"));
      delete next.packages;
      const { packages: _packages, ...rest } = settings;
      assert.deepEqual(next, rest);
      assert.equal(
        lstatSync(join(r.agentDir, "settings.json")).mode & 0o777,
        0o640,
      );
      assert.equal(
        readFileSync(join(r.agentDir, "agents/personal.md"), "utf8"),
        "personal role unchanged\n",
      );
      const policy = parse(setupTarget(r.agentDir));
      assert.equal(policy.yoloMode, true);
      assert.equal(policy.permission["*"], "deny");
      assert.equal(policy.permission.bash, "deny");
      assert.deepEqual(Object.keys(policy.permission.skill), [
        "*",
        "dangerous-*",
      ]);
      assert.equal(
        policy.permission.skill["dangerous-*"].reason,
        "keep reason",
      );
      assert.ok(receipt.steps.some((s: any) => s.result.backup));
      assert.ok(
        receipt.steps
          .filter((s: any) => s.result.backup)
          .every(
            (s: any) => (lstatSync(s.result.backup).mode & 0o777) === 0o600,
          ),
      );
    }),
);

localTest(
  "bootstrap refuses stale target/config/role/skill receipt and tampered reviewed bytes before writes",
  () => {
    for (const kind of ["settings", "config", "role", "skill", "tampered"])
      fixture((_root, r) => {
        const plan = inspectBootstrap(r);
        if (kind === "settings")
          put(join(r.agentDir, "settings.json"), { theme: "new-user-edit" });
        if (kind === "config") put(setupTarget(r.agentDir), { yoloMode: true });
        if (kind === "role")
          put(join(r.agentDir, "agents/git-commit.md"), "different role\n");
        if (kind === "skill")
          put(join(r.agentDir, "skills/recap/SKILL.md"), "unowned skill\n");
        if (kind === "tampered") plan.changes[0].next = "{}\n";
        assert.throws(() => applyBootstrap(plan, plan.digest));
        assert.equal(existsSync(join(r.agentDir, ".mahiro-bootstrap")), false);
      });
  },
);

localTest(
  "bootstrap detects post-review target races and records completed/failed/not-attempted steps",
  () =>
    fixture((_root, r) => {
      const plan = inspectBootstrap(r);
      let caught: any;
      try {
        applyBootstrap(plan, plan.digest, {
          beforeStep: (kind) => {
            if (kind === "children")
              put(join(r.agentDir, "extensions/pi-subagents/config.json"), {
                concurrentEdit: true,
              });
          },
        });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught?.receipt);
      assert.equal(caught.receipt.status, "partial-or-failed");
      assert.equal(caught.receipt.steps[0].status, "completed");
      assert.equal(caught.receipt.steps[1].status, "failed");
      assert.ok(
        caught.receipt.steps
          .slice(2)
          .every((s: any) => s.status === "not-attempted"),
      );
      assert.equal(
        parse(join(r.agentDir, "extensions/pi-subagents/config.json"))
          .concurrentEdit,
        true,
      );
      assert.deepEqual(parse(caught.receipt.receiptPath), caught.receipt);
    }),
);

localTest(
  "bootstrap temporary-write/fsync failure cleans owned temporary and retains accurate private backup evidence",
  () =>
    fixture((_root, r) => {
      put(join(r.agentDir, "settings.json"), { theme: "preserved" });
      const plan = inspectBootstrap(r),
        original = readFileSync(join(r.agentDir, "settings.json"), "utf8");
      const saved = fs.fsyncSync;
      let calls = 0;
      let caught: any;
      try {
        fs.fsyncSync = (fd) => {
          if (++calls === 2)
            throw new Error("Injected temporary fsync failure");
          return saved(fd);
        };
        syncBuiltinESMExports();
        try {
          applyBootstrap(plan, plan.digest);
        } catch (error) {
          caught = error;
        }
      } finally {
        fs.fsyncSync = saved;
        syncBuiltinESMExports();
      }
      assert.equal(caught.receipt.steps[0].status, "failed");
      const recovery = caught.receipt.steps[0].ownerReceipt;
      assert.equal(recovery.publication, "not-published");
      assert.equal(recovery.changed, false);
      assert.equal(readFileSync(recovery.backup, "utf8"), original);
      assert.equal(lstatSync(recovery.backup).mode & 0o777, 0o600);
      assert.equal(recovery.residualTemporary, null);
      assert.equal(
        readFileSync(join(r.agentDir, "settings.json"), "utf8"),
        original,
      );
      assert.ok(!readdirSync(r.agentDir).some((name) => name.endsWith(".tmp")));
    }),
);

localTest(
  "bootstrap rejects role/skill collisions and modified receipt-managed skills without overwrite",
  () => {
    fixture((_root, r) => {
      put(join(r.agentDir, "agents/memory-reflector.md"), "edited role\n");
      assert.throws(() => inspectBootstrap(r), /role differs/);
    });
    fixture((_root, r) => {
      put(join(r.agentDir, "skills/recap/SKILL.md"), "unowned skill\n");
      assert.throws(() => inspectBootstrap(r), /collision/);
    });
    fixture((_root, r) => {
      const p = inspectBootstrap(r);
      applyBootstrap(p, p.digest);
      put(join(r.agentDir, "skills/recap/SKILL.md"), "edited skill\n");
      assert.throws(() => inspectBootstrap(r), /conflicts/);
    });
  },
);

localTest(
  "bootstrap blocks filtered packages, alternate provenance and child exclusions of guards/permissions",
  () => {
    for (const packages of [
      [{ source: product, extensions: [] }],
      ["npm:@gotgenes/pi-subagents@23.4.1"],
      ["../mahiro-pi"],
    ])
      fixture((_root, r) => {
        put(join(r.agentDir, "settings.json"), { packages });
        assert.throws(() => inspectBootstrap(r));
      });
    for (const exclusion of [
      join(resolve(product, "../mods"), "adapters/pi"),
      "/stale/pi-subagents",
    ])
      fixture((_root, r) => {
        put(join(r.agentDir, "extensions/pi-subagents/config.json"), {
          excludedExtensionPackages: [exclusion],
        });
        assert.throws(() => inspectBootstrap(r));
      });
  },
);

test("bootstrap Mods preflight rejects wrong dependency pins, missing patch ownership and reversed guard order", () => {
  const metadata = {
    dependencies: {
      "@gotgenes/pi-subagents": "23.4.1",
      "@gotgenes/pi-permission-system": "40.2.2",
    },
    pi: { extensions: ["./bootstrap.mjs", "./index.ts"] },
  };
  const hash = "a".repeat(64),
    workspace =
      "'@gotgenes/pi-subagents@23.4.1': patches/@gotgenes__pi-subagents@23.4.1.patch",
    lock = `hash: ${hash}`;
  assert.doesNotThrow(() =>
    assertBootstrapModsContract(metadata, workspace, lock, hash),
  );
  for (const name of Object.keys(metadata.dependencies)) {
    const changed = structuredClone(metadata);
    changed.dependencies[name] = "wrong";
    assert.throws(
      () => assertBootstrapModsContract(changed, workspace, lock, hash),
      /pins/,
    );
  }
  assert.throws(
    () =>
      assertBootstrapModsContract(
        { ...metadata, pi: { extensions: ["./index.ts", "./bootstrap.mjs"] } },
        workspace,
        lock,
        hash,
      ),
    /ordered/,
  );
  assert.throws(
    () => assertBootstrapModsContract(metadata, "", lock, hash),
    /provenance/,
  );
  assert.throws(
    () =>
      assertBootstrapModsContract(
        metadata,
        workspace,
        `hash: ${"b".repeat(64)}`,
        hash,
      ),
    /provenance/,
  );
});

localTest(
  "bootstrap binds source state; falsified source hashes/revisions/patch or dependency paths reject",
  () =>
    fixture((_root, r) => {
      for (const mutate of [
        (p: any) => {
          p.sources[0].revision = "0".repeat(40);
        },
        (p: any) => {
          p.sources[0].payloads[0].hash = "0".repeat(64);
        },
        (p: any) => {
          p.dependencies.patchHash = "0".repeat(64);
        },
        (p: any) => {
          p.dependencies.subagents = "/wrong/dependency";
        },
      ]) {
        const p = inspectBootstrap(r);
        mutate(p);
        assert.throws(() => applyBootstrap(p, p.digest), /stale/);
      }
      assert.equal(existsSync(r.agentDir), false);
    }),
);

test("bootstrap strict manifest and bounded safe reader reject unsafe/private path inputs", () =>
  fixture((root, r) => {
    for (const agentDir of [
      "relative/path",
      `${r.agentDir}/../elsewhere`,
      "/",
      `${root}/onedeex-profile`,
    ])
      assert.throws(() => inspectBootstrap({ ...r, agentDir }));
    const target = join(root, "safe.json");
    put(target, r);
    const original = readBootstrapFile(target)!;
    assert.equal(readBootstrapRequest(target).agentDir, r.agentDir);
    for (const mode of [0o400, 0o700, 0o644]) {
      chmodSync(target, mode);
      assert.throws(() => readBootstrapRequest(target), /Private/);
      assert.equal(lstatSync(target).mode & 0o777, mode);
    }
    chmodSync(target, 0o600);
    assert.equal(readBootstrapRequest(target).agentDir, r.agentDir);
    const linked = join(root, "linked.json");
    symlinkSync(target, linked);
    assert.throws(() => readBootstrapFile(linked));
    const hard = join(root, "hard.json");
    linkSync(target, hard);
    assert.throws(() => readBootstrapFile(hard));
    rmSync(hard);
    put(target, " ".repeat(1024 * 1024 + 1));
    assert.throws(() => readBootstrapFile(target));
    put(target, original.text);
    chmodSync(target, 0o666);
    assert.throws(() => readBootstrapFile(target));
    assert.throws(() => inspectBootstrap({ ...r, components: {} }));
    assert.throws(() =>
      inspectBootstrap({ ...r, sources: { ...r.sources, mods: product } }),
    );
    for (const projectId of [undefined, null, 123, {}, true])
      assert.throws(
        () =>
          inspectBootstrap({
            ...r,
            components: {
              ...r.components,
              memory: {
                root: join(root, "memory"),
                project: root,
                seedFile: join(root, "seed.md"),
                projectId,
              } as any,
            },
          }),
        /Invalid memory/,
      );
    for (const memory of [null, false, "memory", 1])
      assert.throws(
        () => inspectBootstrap({ ...r, components: { memory } as any }),
        /Invalid memory/,
      );
    for (const skills of [[123], [null], [true]])
      assert.throws(
        () => inspectBootstrap({ ...r, components: { skills } as any }),
        /skill names/,
      );
  }));

localTest(
  "bootstrap never treats an empty or malformed existing memory directory as initialized",
  () =>
    fixture((root, r) => {
      const memory = join(root, "memory");
      mkdirSync(memory, { mode: 0o700 });
      const project = join(root, "project");
      mkdirSync(project, { mode: 0o700 });
      r.components.memory = {
        root: memory,
        project,
        projectId: "fixture",
        seedFile: join(root, "not-read-seed.md"),
      };
      assert.throws(() => inspectBootstrap(r), /Existing|canonical/);
      assert.equal(readdirSync(memory).length, 0);
      assert.equal(existsSync(r.agentDir), false);
    }),
);

localTest(
  "bootstrap memory preflight rejects restricted grants, unsafe seeds and malformed prior policy without writes",
  () => {
    for (const kind of [
      "secret",
      "public-seed",
      "readonly-seed",
      "executable-seed",
      "grant",
      "invalid-policy",
    ])
      fixture((root, r) => {
        const project = join(root, "project"),
          seedFile = join(root, "seed.md");
        mkdirSync(project, { mode: 0o700 });
        put(
          seedFile,
          kind === "secret"
            ? "# Core\npassword=DO_NOT_STORE\n"
            : "# Core\nSynthetic identity.\n",
        );
        r.components.memory = {
          root: join(root, "memory"),
          project,
          projectId: "fixture",
          seedFile,
        };
        if (kind === "public-seed") chmodSync(seedFile, 0o644);
        if (kind === "readonly-seed") chmodSync(seedFile, 0o400);
        if (kind === "executable-seed") chmodSync(seedFile, 0o700);
        if (kind === "grant")
          put(setupTarget(r.agentDir), {
            permission: { agent_memory_edit: "deny" },
          });
        if (kind === "invalid-policy") {
          delete r.components.skillPolicy;
          put(setupTarget(r.agentDir), { permission: null });
        }
        assert.throws(() => inspectBootstrap(r));
        assert.equal(existsSync(join(root, "memory")), false);
        assert.equal(existsSync(join(r.agentDir, "settings.json")), false);
      });
  },
);

test("bootstrap rejects special mode bits before reporting private permissions", () =>
  fixture((root, request) => {
    const manifest = join(root, "special-mode.json");
    put(manifest, request);
    for (const mode of [0o4600, 0o2600, 0o1600]) {
      chmodSync(manifest, mode);
      assert.equal(lstatSync(manifest).mode & 0o7777, mode);
      assert.throws(() => readBootstrapFile(manifest), /Unsafe/);
      assert.throws(() => readBootstrapRequest(manifest), /Unsafe/);
      assert.equal(lstatSync(manifest).mode & 0o7777, mode);
    }
    chmodSync(manifest, 0o600);
    assert.equal(readBootstrapRequest(manifest).agentDir, request.agentDir);
  }));

test("bootstrap read rejects metadata races before returning stale permissions", () =>
  fixture((root) => {
    for (const mutation of ["chmod", "link", "both"]) {
      const path = join(root, `${mutation}.json`);
      put(path, "safe bytes");
      const saved = fs.readSync;
      let injected = false;
      try {
        fs.readSync = (...args: any[]) => {
          if (!injected) {
            injected = true;
            if (mutation !== "link") chmodSync(path, 0o644);
            if (mutation !== "chmod") linkSync(path, `${path}.hard`);
          }
          return (saved as any)(...args);
        };
        syncBuiltinESMExports();
        assert.throws(() => readBootstrapFile(path), /changed during/);
        assert.equal(injected, true);
      } finally {
        fs.readSync = saved;
        syncBuiltinESMExports();
      }
    }
    for (const field of ["mode", "uid", "gid", "ctimeMs"]) {
      const path = join(root, `${field}.json`);
      put(path, "safe bytes");
      const saved = fs.fstatSync;
      try {
        fs.fstatSync = ((fd: number) => {
          const stat = saved(fd);
          (stat as any)[field] += 1;
          return stat;
        }) as typeof fs.fstatSync;
        syncBuiltinESMExports();
        assert.throws(() => readBootstrapFile(path), /changed during/);
      } finally {
        fs.fstatSync = saved;
        syncBuiltinESMExports();
      }
    }
  }));

test("bootstrap native public payload binds nested executable implementations with safe bounds", () =>
  fixture((root) => {
    put(join(root, "package.json"), { name: "synthetic-public-package" });
    put(join(root, "dist/index.js"), 'export * from "./core/sdk.js";');
    for (const name of ["sdk", "resource-loader", "model-runtime"])
      put(join(root, `dist/core/${name}.js`), "export const value = 1;");
    const original = hashBootstrapNativePayload(root, "./dist/index.js");
    for (const name of ["sdk", "resource-loader", "model-runtime"]) {
      put(join(root, `dist/core/${name}.js`), "export const value = 2;");
      const changed = hashBootstrapNativePayload(root, "./dist/index.js");
      assert.equal(changed.publicEntry, original.publicEntry);
      assert.equal(changed.metadata, original.metadata);
      assert.notEqual(changed.implementation, original.implementation);
      put(join(root, `dist/core/${name}.js`), "export const value = 1;");
    }
    assert.throws(() => hashBootstrapNativePayload(root, "./other/index.js"));
    symlinkSync(join(root, "package.json"), join(root, "dist/linked.js"));
    assert.throws(() => hashBootstrapNativePayload(root, "./dist/index.js"));
    rmSync(join(root, "dist/linked.js"));
    chmodSync(join(root, "dist/core/sdk.js"), 0o666);
    assert.throws(() => hashBootstrapNativePayload(root, "./dist/index.js"));
  }));

localTest(
  "bootstrap native nested source changes invalidate digest before profile writes",
  () =>
    fixture((root, r) => {
      const project = join(root, "project"),
        seedFile = join(root, "seed.md");
      mkdirSync(project, { mode: 0o700 });
      put(seedFile, "# Core\nSynthetic identity.\n");
      r.components.memory = {
        root: join(root, "memory"),
        project,
        projectId: "fixture",
        seedFile,
      };
      const plan = inspectBootstrap(r); // Exact 0600 seed is accepted.
      const savedOpen = fs.openSync,
        savedRead = fs.readSync;
      const targets = new Set<number>();
      let injected = false;
      try {
        fs.openSync = ((path: any, ...args: any[]) => {
          const fd = (savedOpen as any)(path, ...args);
          targets.delete(fd);
          if (String(path).endsWith("/dist/core/sdk.js")) targets.add(fd);
          return fd;
        }) as typeof fs.openSync;
        fs.readSync = ((fd: number, buffer: Buffer, ...args: any[]) => {
          const count = (savedRead as any)(fd, buffer, ...args);
          if (targets.has(fd) && count > 0) {
            buffer[0] ^= 1; // In-memory hash-reader fault only; installed files stay untouched.
            injected = true;
          }
          return count;
        }) as typeof fs.readSync;
        syncBuiltinESMExports();
        assert.notEqual(inspectBootstrap(r).digest, plan.digest);
        assert.throws(() => applyBootstrap(plan, plan.digest), /stale/);
        assert.equal(injected, true);
        assert.equal(existsSync(r.agentDir), false);
        assert.equal(existsSync(r.components.memory.root), false);
      } finally {
        fs.openSync = savedOpen;
        fs.readSync = savedRead;
        syncBuiltinESMExports();
      }
    }),
);

localTest(
  "bootstrap CLI requires explicit digest, emits no seed or policy body, and stale digest rejects",
  () =>
    fixture((root, r) => {
      const manifest = join(root, "bootstrap.json");
      put(manifest, r);
      const cli = (...args: string[]) =>
        spawnSync(
          process.execPath,
          [join(product, "bootstrap.mjs"), "--manifest", manifest, ...args],
          { cwd: product, encoding: "utf8", timeout: 30000 },
        );
      assert.notEqual(cli("--apply").status, 0);
      const preview = cli("--plan");
      assert.equal(preview.status, 0, preview.stderr);
      const summary = JSON.parse(preview.stdout);
      assert.equal(summary.steps[0].next, undefined);
      assert.notEqual(
        cli("--apply", "--expect-plan", "0".repeat(64)).status,
        0,
      );
      const applied = cli("--apply", "--expect-plan", summary.digest);
      assert.equal(applied.status, 0, applied.stderr);
      assert.equal(JSON.parse(applied.stdout).status, "completed");
      put(setupTarget(r.agentDir), "PRIVATE_POLICY_CANARY_INVALID_JSON");
      const malformed = cli("--plan");
      assert.notEqual(malformed.status, 0);
      assert.equal(
        `${malformed.stdout}${malformed.stderr}`.includes(
          "PRIVATE_POLICY_CANARY",
        ),
        false,
      );
    }),
);
