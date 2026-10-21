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
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import type { BootstrapRequest } from "../lib/bootstrap.ts";
import {
  inspectBootstrap as inspectActiveBootstrap,
  applyBootstrap as applyActiveBootstrap,
  readBootstrapFile as readActiveBootstrapFile,
} from "../lib/bootstrap.ts";
import { CONTINUITY_FILE_MAX_BYTES } from "../lib/continuity/store.ts";
import { stageBootstrapCandidate } from "./bootstrap-candidate-fixture.ts";
const candidate = await stageBootstrapCandidate({
  skillsSupply: resolve(import.meta.dirname, "../../mahiro-skills"),
});
const {
  applyBootstrap,
  assertBootstrapNativeContract: assertBootstrapModsContract,
  bootstrapSummary,
  hashBootstrapNativePayload,
  inspectBootstrap,
  readBootstrapFile,
  readBootstrapRequest,
} = candidate.bootstrap;
import { setupTarget } from "../lib/setup.ts";

const activeProduct = resolve(import.meta.dirname, "..");
const product = candidate.primary;
test("actual authoring graph previews guarded installation without profile writes", () => {
  const agentDir = join(candidate.root, "actual-root-preview");
  const plan = inspectActiveBootstrap({
    version: 1,
    dependencyModules: candidate.modules,
    agentDir,
    sources: { pi: activeProduct },
    components: { packages: true, roles: true, featureData: true },
  });
  assert.ok(plan.changes.some((c) => c.kind === "rtk-default"));
  assert.equal(existsSync(agentDir), false);
});
const fixtures = join(product, ".agent-state/runtime/bootstrap-tests");
mkdirSync(fixtures, { recursive: true, mode: 0o700 });
const fixture = (run: (root: string, request: BootstrapRequest) => void) => {
  const root = mkdtempSync(join(fixtures, "case-"));
  const request: BootstrapRequest = {
    version: 1,
    dependencyModules: candidate.modules,
    agentDir: join(root, "agent"),
    sources: {
      pi: product,
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
    join(
      process.env.MAHIRO_PI_TEST_MODULES ?? join(product, "node_modules"),
      "@gotgenes/pi-subagents",
    ),
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
    for (const exclusion of [product, "/stale/pi-subagents"])
      fixture((_root, r) => {
        put(join(r.agentDir, "extensions/pi-subagents/config.json"), {
          excludedExtensionPackages: [exclusion],
        });
        assert.throws(() => inspectBootstrap(r));
      });
  },
);

test("owned upgrade rejects filtered/unsupported aliases, guard exclusions, symlink owners and dual legacy guards", () => {
  fixture((root, r) => {
    r.components = { packages: true };
    const guard = join(product, "lib/guards");
    const alias = join(root, "neutral-owner");
    symlinkSync(product, alias);
    const settings = join(r.agentDir, "settings.json");
    for (const packages of [
      [{ source: product }],
      [{ source: product, extensions: [] }],
      [{ source: guard, extensions: [] }],
      [
        {
          source: join(candidate.modules, "@gotgenes/pi-subagents"),
          extensions: [],
        },
      ],
      [relative(r.agentDir, join(candidate.modules, "@gotgenes/pi-subagents"))],
      [`${guard}/../guards`],
      [alias],
      [guard, "/unreviewed/legacy/pi-guards"],
      ["npm:@mahirocoko/mahiro-pi"],
    ]) {
      put(settings, { packages });
      assert.throws(
        () => inspectBootstrap(r),
        undefined,
        JSON.stringify(packages),
      );
    }
    for (const entry of [
      `-${join(guard, "bootstrap.mjs")}`,
      `+${join(guard, "bootstrap.mjs")}`,
      join(guard, "index.ts"),
      relative(r.agentDir, join(guard, "bootstrap.mjs")),
      join(alias, "lib/guards/bootstrap.mjs"),
      `${product}-alternate/extension.ts`,
      "!**/guards/*",
    ]) {
      put(settings, { packages: [product, guard], extensions: [entry] });
      assert.throws(() => inspectBootstrap(r), /overrides/);
    }
    // Same-owner metadata is still subject to the bounded safe reader. A hard
    // link must not become an alternate proof of the reviewed guard package.
    const metadata = join(guard, "package.json");
    const hardlink = join(root, "guard-metadata-link");
    linkSync(metadata, hardlink);
    try {
      put(settings, { packages: [product, guard] });
      assert.throws(() => inspectBootstrap(r), /Unsafe/);
    } finally {
      fs.unlinkSync(hardlink);
    }
  });
});

test("bootstrap Mods preflight rejects wrong dependency pins, missing patch ownership and reversed guard order", () => {
  const metadata = {
    dependencies: {
      "@gotgenes/pi-subagents": "23.4.1",
      "@gotgenes/pi-permission-system": "40.2.2",
    },
    pi: { extensions: ["./lib/guards/bootstrap.mjs", "./lib/guards/index.ts"] },
  };
  const permissionHash = "c".repeat(64);
  const permissionMapping =
    "'@gotgenes/pi-permission-system@40.2.2': patches/@gotgenes__pi-permission-system@40.2.2.patch";
  const permissionLock = `hash: ${permissionHash}\n    path: patches/@gotgenes__pi-permission-system@40.2.2.patch`;
  const hash = "a".repeat(64),
    workspace =
      "'@gotgenes/pi-subagents@23.4.1': patches/@gotgenes__pi-subagents@23.4.1.patch",
    lock = `hash: ${hash}`;
  assert.doesNotThrow(() =>
    assertBootstrapModsContract(metadata, workspace, lock, hash),
  );
  assert.doesNotThrow(() =>
    assertBootstrapModsContract(
      metadata,
      `${workspace}\n${permissionMapping}`,
      `${lock}\n${permissionLock}`,
      hash,
      permissionHash,
    ),
  );
  assert.throws(
    () =>
      assertBootstrapModsContract(
        metadata,
        workspace,
        `${lock}\n${permissionLock}`,
        hash,
        permissionHash,
      ),
    /provenance/,
  );
  assert.throws(
    () =>
      assertBootstrapModsContract(
        metadata,
        `${workspace}\n${permissionMapping}`,
        lock,
        hash,
        permissionHash,
      ),
    /provenance/,
  );
  assert.throws(
    () =>
      assertBootstrapModsContract(
        metadata,
        `${workspace}\n${permissionMapping}`,
        `${lock}\n${permissionLock}`,
        hash,
        "d".repeat(64),
      ),
    /provenance/,
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
      `${root}/unsafe\u0000profile`,
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
      inspectBootstrap({
        ...r,
        sources: { ...r.sources, pi: resolve(product, "..") },
      }),
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

// Actual authoring root, synthetic owned DATA only; no installed profile lookup.
const continuityFixture = (
  run: (r: BootstrapRequest, generation: string, bytes: string) => void,
) => {
  const evidence = join(
    activeProduct,
    ".agent-state/runtime/rtk-rewrite-models-retirement/continuity-preservation-fix",
  );
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(evidence, "owned-"));
  const r: BootstrapRequest = {
    version: 1,
    dependencyModules: candidate.modules,
    agentDir: join(root, "profile"),
    sources: { pi: activeProduct },
    components: { packages: true, roles: true, featureData: true },
  };
  const continuity = join(r.agentDir, "continuity");
  const generation = join(continuity, "accepted-empty.json");
  const bytes =
    JSON.stringify({ archive: { records: [], quarantine: [] }, facts: [] }) +
    " ".repeat(2 * 1024 * 1024);
  put(join(continuity, "manifest.json"), { version: 1, projects: [] });
  put(join(continuity, "state.json"), {
    revision: 0,
    lifecycle: { session: "installation", branch: "installation", epoch: 0 },
    cursor: 0,
    generation: "accepted-empty",
    facts: [],
    controls: { forgotten: [], corrections: {} },
  });
  put(generation, bytes);
  try {
    run(r, generation, bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("owned large continuity generation: preview/apply/rerun preserve bytes, mode and inode; generic bound stays 1MiB", () =>
  continuityFixture((r, generation, bytes) => {
    const before = lstatSync(generation);
    const entries = readdirSync(resolve(generation, ".."));
    const unchanged = () => {
      assert.equal(readFileSync(generation, "utf8"), bytes);
      const after = lstatSync(generation);
      for (const key of [
        "dev",
        "ino",
        "mode",
        "size",
        "mtimeMs",
        "ctimeMs",
      ] as const)
        assert.equal(after[key], before[key], key);
      assert.deepEqual(
        readdirSync(resolve(generation, "..")),
        entries,
        "no backups or rewrites",
      );
    };
    assert.throws(
      () => readActiveBootstrapFile(generation),
      /Unsafe bootstrap file/,
    );
    for (let i = 0; i < 2; i++) {
      const plan = inspectActiveBootstrap(r);
      unchanged();
      const step = plan.changes.find(
        (c) => c.kind === "continuity-generation-preserve",
      )!;
      assert.equal(step.before?.text, bytes);
      assert.equal(step.next, bytes);
      const receipt = applyActiveBootstrap(plan, plan.digest);
      assert.equal(receipt.status, "completed");
      assert.deepEqual(
        receipt.steps.find((s: any) => s.kind === step.kind).result,
        { changed: false, backup: null },
      );
      unchanged();
    }
  }));

test("owned continuity generation rejects unsafe, invalid and over-owner-bound inputs", () => {
  for (const unsafe of [
    "mode",
    "hardlink",
    "symlink",
    "oversize",
    "invalid",
  ] as const)
    continuityFixture((r, generation, bytes) => {
      if (unsafe === "mode") chmodSync(generation, 0o644);
      if (unsafe === "hardlink") linkSync(generation, `${generation}.link`);
      if (unsafe === "symlink") {
        fs.renameSync(generation, `${generation}.original`);
        symlinkSync(`${generation}.original`, generation);
      }
      if (unsafe === "oversize")
        put(
          generation,
          bytes +
            " ".repeat(
              CONTINUITY_FILE_MAX_BYTES - Buffer.byteLength(bytes) + 1,
            ),
        );
      if (unsafe === "invalid")
        put(generation, " ".repeat(2 * 1024 * 1024) + "{}");
      assert.throws(() => inspectActiveBootstrap(r), undefined, unsafe);
    });
});

test("large continuity preservation rejects stale/tampered review and execution-time mutations", () => {
  for (const mutation of [
    "stale",
    "tamper",
    "content",
    "inode",
    "mode",
    "hardlink",
    "oversize",
  ] as const)
    continuityFixture((r, generation, bytes) => {
      const plan = inspectActiveBootstrap(r);
      if (mutation === "stale") put(generation, bytes + " ");
      if (mutation === "tamper")
        plan.changes.find(
          (c) => c.kind === "continuity-generation-preserve",
        )!.next += " ";
      const mutate = () => {
        if (mutation === "content") put(generation, bytes + " ");
        if (mutation === "inode") {
          fs.renameSync(generation, `${generation}.original`);
          put(generation, bytes);
        }
        if (mutation === "mode") chmodSync(generation, 0o644);
        if (mutation === "hardlink") linkSync(generation, `${generation}.link`);
        if (mutation === "oversize")
          put(
            generation,
            bytes +
              " ".repeat(
                CONTINUITY_FILE_MAX_BYTES - Buffer.byteLength(bytes) + 1,
              ),
          );
      };
      assert.throws(() =>
        applyActiveBootstrap(plan, plan.digest, {
          beforeStep: (kind) => {
            if (kind === "continuity-generation-preserve") mutate();
          },
        }),
      );
      assert.ok(
        !readdirSync(resolve(generation, "..")).some((name) =>
          /mahiro-bootstrap/.test(name),
        ),
        "never backs up or publishes a preserved generation",
      );
    });
});

const policyFixture = (run: (r: BootstrapRequest, target: string) => void) => {
  const root = join(
    activeProduct,
    ".agent-state/runtime/rtk-rewrite-models-retirement/no-blanket-deny-contract",
  );
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const agentDir = join(mkdtempSync(join(root, "policy-")), "profile");
  run(
    {
      version: 1,
      agentDir,
      sources: { pi: activeProduct },
      dependencyModules: candidate.modules,
      components: { packages: true, roles: true, featureData: true },
    },
    setupTarget(agentDir),
  );
};
const policyTree = (root: string): unknown =>
  existsSync(root)
    ? readdirSync(root)
        .sort()
        .map((name) => {
          const file = join(root, name),
            stat = lstatSync(file);
          return [
            name,
            stat.ino,
            stat.mode,
            stat.isDirectory() ? policyTree(file) : readFileSync(file, "utf8"),
          ];
        })
    : null;

test("explicit scalar default-deny consent is required before any writes and binds reviewed CAS", () => {
  policyFixture((r, target) => {
    const prior = {
      yoloMode: true,
      permission: {
        "*": "deny",
        read: "allow",
        bash: { "git commit *": "deny" },
        private_data: "deny",
      },
    };
    put(target, prior);
    const before = policyTree(r.agentDir);
    assert.throws(() => inspectActiveBootstrap(r), /--remove-default-deny/);
    assert.deepEqual(policyTree(r.agentDir), before);
    r.components.removeDefaultDeny = true;
    const plan = inspectActiveBootstrap(r);
    assert.deepEqual(policyTree(r.agentDir), before, "preview is read-only");
    const authority = plan.changes.find((c) => c.path === target)!;
    const next = JSON.parse(authority.next);
    assert.equal(Object.hasOwn(next.permission, "*"), false);
    assert.equal(next.yoloMode, true);
    for (const [key, value] of Object.entries(prior.permission))
      if (key !== "*") assert.deepEqual(next.permission[key], value);
    const tampered = structuredClone(plan);
    tampered.changes.find((c) => c.path === target)!.next += " ";
    assert.throws(
      () => applyActiveBootstrap(tampered, tampered.digest),
      /stale/,
    );
    assert.deepEqual(policyTree(r.agentDir), before);
    const stale = structuredClone(plan);
    delete stale.request.components.removeDefaultDeny;
    assert.throws(
      () => applyActiveBootstrap(stale, stale.digest),
      /--remove-default-deny|stale/,
    );
    assert.deepEqual(policyTree(r.agentDir), before);
    put(target, { ...prior, debugLog: false });
    const mutated = readFileSync(target, "utf8");
    assert.throws(() => applyActiveBootstrap(plan, plan.digest), /stale/);
    assert.equal(readFileSync(target, "utf8"), mutated);
    const reviewed = inspectActiveBootstrap(r);
    applyActiveBootstrap(reviewed, reviewed.digest);
    assert.deepEqual(parse(target), { ...next, debugLog: false });
    assert.equal(lstatSync(target).mode & 0o777, 0o600);
    assert.ok(
      readdirSync(resolve(target, "..")).some((n) => n.endsWith(".bak")),
      "normal reviewed private backup pipeline retained",
    );
    const bytes = readFileSync(target, "utf8"),
      ino = lstatSync(target).ino;
    const again = inspectActiveBootstrap(r);
    applyActiveBootstrap(again, again.digest);
    assert.equal(readFileSync(target, "utf8"), bytes);
    assert.equal(lstatSync(target).ino, ino, "absent star is idempotent");
  });
});

test("revocation cannot override required tool/DATA restrictions, ambiguous defaults or unsafe private files", () => {
  for (const restriction of [
    "tool",
    "data",
    "ask",
    "allow",
    "map",
    "wildcard",
    "mode",
    "link",
  ])
    policyFixture((r, target) => {
      r.components.removeDefaultDeny = true;
      const permission: Record<string, unknown> = { "*": "deny" };
      if (restriction === "tool") permission.mh_get_goal = "deny";
      if (restriction === "data") {
        // A genuine canonical required namespace, not a made-up capability.
        const clean = inspectActiveBootstrap({
          ...r,
          components: { ...r.components, removeDefaultDeny: undefined },
        });
        const p = JSON.parse(
          clean.changes.find((c) => c.path === target)!.next,
        ).permission;
        permission[
          Object.keys(p).find((k) => k.startsWith("goal_state_data_"))!
        ] = "deny";
      }
      if (["ask", "allow"].includes(restriction)) permission["*"] = restriction;
      if (restriction === "map") permission["*"] = { "*": "deny" };
      if (restriction === "wildcard") permission["mh_*"] = "deny";
      put(target, { permission });
      if (restriction === "mode") chmodSync(target, 0o666);
      if (restriction === "link") linkSync(target, `${target}.linked`);
      const before = policyTree(r.agentDir);
      assert.throws(() => inspectActiveBootstrap(r));
      assert.deepEqual(policyTree(r.agentDir), before, restriction);
      assert.equal(existsSync(join(r.agentDir, "settings.json")), false);
    });
});

test("already provisioned exact grants preserve legitimate default deny without revocation consent", () => {
  policyFixture((r, target) => {
    const clean = inspectActiveBootstrap(r);
    const permission = JSON.parse(
      clean.changes.find((c) => c.path === target)!.next,
    ).permission;
    put(target, {
      permission: { "*": "deny", ...permission, unrelated_future_tool: "deny" },
    });
    const bytes = readFileSync(target, "utf8");
    const plan = inspectActiveBootstrap(r);
    assert.equal(
      JSON.parse(plan.changes.find((c) => c.path === target)!.next).permission[
        "*"
      ],
      "deny",
    );
    assert.equal(plan.featureInstallation!.removedDefaultDeny, false);
    assert.ok(
      plan.featureInstallation!.retainedRestrictionSurfaces.includes("*"),
    );
    applyActiveBootstrap(plan, plan.digest);
    assert.equal(parse(target).permission["*"], "deny");
    assert.equal(parse(target).permission.unrelated_future_tool, "deny");
    // This is structural provisioning, not a claim cross-cutting runtime gates
    // will permit every operation. The public service remains authoritative.
    assert.deepEqual(parse(target), JSON.parse(bytes));
  });
});

test("revocation preserves explicit RTK off and execution-time policy mutation without clobbering", () => {
  policyFixture((r, target) => {
    r.components.removeDefaultDeny = true;
    put(target, { permission: { "*": "deny" } });
    const off = join(r.agentDir, "preferences/rtk/default.json");
    put(off, { version: 1, mode: "off" });
    const before = readFileSync(off, "utf8"),
      ino = lstatSync(off).ino;
    const plan = inspectActiveBootstrap(r);
    assert.equal(plan.featureInstallation!.rtkDefault, "existing-preserved");
    const receipt = applyActiveBootstrap(plan, plan.digest);
    assert.equal(receipt.featureInstallation.rtkDefault, "existing-preserved");
    assert.equal(readFileSync(off, "utf8"), before);
    assert.equal(lstatSync(off).ino, ino);
    assert.equal(lstatSync(off).mode & 0o777, 0o600);
  });
  policyFixture((r, target) => {
    r.components.removeDefaultDeny = true;
    put(target, { permission: { "*": "deny" } });
    const off = join(r.agentDir, "preferences/rtk/default.json");
    put(off, { version: 1, mode: "off" });
    const plan = inspectActiveBootstrap(r);
    assert.ok(!plan.changes.some((c) => c.path === off));
    const injected = JSON.stringify({ permission: { mh_get_goal: "deny" } });
    assert.throws(() =>
      applyActiveBootstrap(plan, plan.digest, {
        beforeStep: (kind) => {
          if (kind === "memory-authority") put(target, injected);
        },
      }),
    );
    assert.equal(readFileSync(target, "utf8"), injected);
    assert.deepEqual(parse(off), { version: 1, mode: "off" });
    assert.ok(
      !readdirSync(resolve(target, "..")).some((n) => /\.bak$|\.tmp$/.test(n)),
    );
  });
});
