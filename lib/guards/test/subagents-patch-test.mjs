import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { normalizeSubagentsCopy } from "./subagents-supply-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.resolve(
  root,
  "../../.agent-state/runtime/pi-ownership-repair/subagents",
);
fs.mkdirSync(workspace, { recursive: true });

// Reapply from the canonical manifest and frozen lock, never the live package.
// SUBAGENTS_UNPATCHED falsifies the same behavioral contract against upstream.
test("initial outcome claims use native queue, notifications, events and resume lifecycle", async () => {
  const fixture = fs.mkdtempSync(
    path.join(workspace, "subagents-patch-proof-"),
  );
  const product = path.resolve(root, "../..");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(product, "package.json"), "utf8"),
  );
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: {
        "@gotgenes/pi-subagents":
          manifest.dependencies["@gotgenes/pi-subagents"],
      },
    }),
  );
  // This minimal fixture contains only subagents, not the newly patched
  // permission owner. Keep its one relevant canonical patch mapping.
  const workspaceSource = fs.readFileSync(
    path.join(product, "pnpm-workspace.yaml"),
    "utf8",
  );
  const mapping = workspaceSource.match(
    /^  '@gotgenes\/pi-subagents@23\.4\.1': .+$/m,
  )?.[0];
  assert.ok(mapping);
  fs.writeFileSync(
    path.join(fixture, "pnpm-workspace.yaml"),
    `patchedDependencies:\n${mapping}\n`,
  );
  fs.cpSync(path.join(product, "patches"), path.join(fixture, "patches"), {
    recursive: true,
  });
  // Test only a supplied public copy. No installer, registry or live owner mutation.
  const supplied = fs.realpathSync(
    path.join(root, "node_modules/@gotgenes/pi-subagents"),
  );
  const packageRoot = path.join(fixture, "subagents");
  normalizeSubagentsCopy({
    product,
    supplied,
    target: packageRoot,
    ceiling: fixture,
  });
  fs.symlinkSync(
    path.resolve(supplied, "../.."),
    path.join(packageRoot, "node_modules"),
    "dir",
  );
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(fixture, "node_modules"),
    "dir",
  );
  const patch = path.join(
    product,
    "patches/@gotgenes__pi-subagents@23.4.1.patch",
  );
  const verify = spawnSync(
    "git",
    [
      "apply",
      "--reverse",
      ...(process.env.SUBAGENTS_UNPATCHED ? [] : ["--check"]),
      patch,
    ],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: { ...process.env, GIT_CEILING_DIRECTORIES: fixture },
    },
  );
  assert.equal(verify.status, 0, verify.stderr);
  const exports = {
    SubagentsServiceAdapter: "service/service-adapter.ts",
    SubagentManager: "lifecycle/subagent-manager.ts",
    ConcurrencyLimiter: "lifecycle/concurrency-limiter.ts",
    NotificationManager: "observation/notification.ts",
    SubagentEventsObserver: "observation/subagent-events-observer.ts",
  };
  const bundle = path.join(fixture, "native.mjs");
  await build({
    stdin: {
      contents: Object.entries(exports)
        .map(
          ([name, file]) =>
            `export { ${name} } from ${JSON.stringify(path.join(packageRoot, "src", file))};`,
        )
        .join("\n"),
      resolveDir: packageRoot,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: bundle,
    plugins: [
      {
        name: "native-typescript-import-map",
        setup(builder) {
          builder.onResolve({ filter: /^#src\// }, ({ path: specifier }) => ({
            path: path.join(packageRoot, "src", `${specifier.slice(5)}.ts`),
          }));
        },
      },
    ],
  });
  const {
    SubagentsServiceAdapter,
    SubagentManager,
    ConcurrencyLimiter,
    NotificationManager,
    SubagentEventsObserver,
  } = await import(pathToFileURL(bundle).href);
  const sent = [],
    events = [],
    persisted = [],
    created = [],
    started = [];
  const notifications = new NotificationManager((message, options) =>
    sent.push({ message, options }),
  );
  const observer = new SubagentEventsObserver({
    emit: (channel, data) => events.push({ channel, data }),
    appendEntry: (type, data) => persisted.push({ type, data }),
    notifications,
  });
  let cancelOnCreate = false;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const budget = { used: 1, phase: "within" };
  let active = 0,
    peak = 0;
  const manager = new SubagentManager({
    baseCwd: fixture,
    limiter: new ConcurrencyLimiter(() => 1),
    registry: {
      resolveType: (type) =>
        ["worker", "Reflect", "wrong", "general-purpose"].includes(type)
          ? type
          : undefined,
      isValidType: () => true,
      resolveAgentConfig: (type) =>
        type === "Reflect"
          ? {
              name: "Reflect",
              model: "fixture/model",
              thinking: "low",
              toolNames: [],
              runInBackground: true,
              promptMode: "replace",
              locked: ["model", "thinking"],
            }
          : { name: type, promptMode: "append" },
    },
    observer: {
      onSubagentCreated(record) {
        created.push({ id: record.id, claimed: record.claimed });
        observer.onSubagentCreated(record);
        if (cancelOnCreate) manager.abort(record.id);
      },
      onSubagentStarted: (record) => observer.onSubagentStarted(record),
      onSubagentCompleted: (record) => observer.onSubagentCompleted(record),
      onSubagentResuming: (record) => observer.onSubagentResuming(record),
      onSubagentResumed: (record) => observer.onSubagentResumed(record),
      onSubagentCompacted: (record, info) =>
        observer.onSubagentCompacted(record, info),
    },
    createSubagentSession: async () => ({
      subscribe: () => () => {},
      dispose: async () => {},
      getContextPercent: () => null,
      runTurnLoop: async (prompt, { signal }) => {
        started.push(prompt);
        active++;
        peak = Math.max(peak, active);
        try {
          if (prompt === "hold") await gate;
          if (prompt === "cancel-running")
            await new Promise((resolve) =>
              signal.addEventListener("abort", resolve, { once: true }),
            );
          if (prompt === "error") throw new Error("synthetic failure");
          return { responseText: `result:${prompt}`, turnBudget: budget };
        } finally {
          active--;
        }
      },
      resumeTurnLoop: async (prompt) => ({
        responseText: `resume:${prompt}`,
        turnBudget: budget,
      }),
    }),
  });
  const service = new SubagentsServiceAdapter(
    manager,
    () => {
      throw new Error("No provider allowed");
    },
    {
      currentCtx: {},
      buildSnapshot: () => ({}),
      getSessionInfo: () => ({ parentSessionFile: "", parentSessionId: "" }),
    },
  );
  try {
    assert.equal(
      service.supportsInitialOutcomeClaim,
      process.env.SUBAGENTS_UNPATCHED ? undefined : true,
      "runtime capability must distinguish stale upstream from the patched service",
    );
    console.log(
      `Runtime initial-claim capability: ${service.supportsInitialOutcomeClaim}`,
    );
    if (!process.env.SUBAGENTS_UNPATCHED) {
      assert.equal(typeof service.getAgentType, "function");
      assert.equal(service.getAgentType("missing"), undefined);
      const role = service.getAgentType("Reflect");
      assert.deepEqual(role, {
        name: "Reflect",
        model: "fixture/model",
        thinking: "low",
        toolNames: [],
        runInBackground: true,
        inheritContext: undefined,
        promptMode: "replace",
        locked: ["model", "thinking"],
      });
      assert.ok(
        Object.isFrozen(role) &&
          Object.isFrozen(role.toolNames) &&
          Object.isFrozen(role.locked),
      );
      const eligible = (name) => {
        const config = service.getAgentType(name);
        return (
          config?.model === "fixture/model" &&
          config.thinking === "low" &&
          config.toolNames?.length === 0
        );
      };
      assert.equal(eligible("missing"), false);
      assert.equal(eligible("wrong"), false);
      assert.equal(manager.listAgents().length, 0);
    } else assert.equal(service.getAgentType, undefined);
    const hold = service.spawn("worker", "hold");
    const owned = service.spawn("worker", "fast", { claimOutcome: true });
    assert.equal(service.getRecord(owned).status, "queued");
    assert.equal(service.getRecord(owned).isBackground, true);
    assert.equal(
      created.find((entry) => entry.id === owned).claimed,
      true,
      "claim must precede synchronous CREATED observers",
    );
    const cancelled = service.spawn("worker", "never", { claimOutcome: true });
    assert.equal(service.abort(cancelled), true);
    assert.equal(service.getRecord(cancelled).status, "stopped");
    release();
    await service.waitForAll();
    assert.equal(peak, 1);
    assert.deepEqual(started, ["hold", "fast"]);
    assert.equal(service.getRecord(owned).result, "result:fast");
    assert.deepEqual(
      sent.map((entry) => entry.message.details.id),
      [hold],
    );
    assert.equal(sent[0].options.triggerTurn, true);
    assert.equal(persisted.length, 3);
    assert.ok(
      events.some(
        (entry) =>
          entry.channel === "subagents:completed" && entry.data.id === owned,
      ),
    );
    const failed = service.spawn("worker", "error", { claimOutcome: true });
    await service.waitForAll();
    assert.equal(service.getRecord(failed).status, "error");
    assert.ok(
      events.some(
        (entry) =>
          entry.channel === "subagents:failed" && entry.data.id === failed,
      ),
    );
    const running = service.spawn("worker", "cancel-running", {
      claimOutcome: true,
    });
    while (!started.includes("cancel-running"))
      await new Promise((resolve) => setImmediate(resolve));
    service.abort(running);
    await service.waitForAll();
    assert.equal(service.getRecord(running).status, "stopped");
    cancelOnCreate = true;
    const immediate = service.spawn("worker", "never-at-create", {
      claimOutcome: true,
    });
    cancelOnCreate = false;
    await service.waitForAll();
    assert.equal(service.getRecord(immediate).status, "stopped");
    assert.equal(sent.length, 1, "owned error/cancel must not nudge");
    const resumed = await service.resume(owned, "ordinary");
    assert.equal(resumed.kind, "resumed");
    assert.equal(resumed.record.result, "resume:ordinary");
    assert.equal(
      sent.length,
      2,
      "initial claim must not leak into unclaimed resume",
    );
    await service.resume(failed, "after-error");
    await service.resume(running, "after-cancel");
    assert.equal(
      sent.length,
      4,
      "error/cancel claims must not leak into resume",
    );
    const ordinary = service.spawn("worker", "ordinary", {
      claimOutcome: false,
    });
    await service.waitForAll();
    assert.equal(sent.at(-1).message.details.id, ordinary);
    notifications.onParentAgentStart();
    service.spawn("worker", "withheld-owned", { claimOutcome: true });
    await service.waitForAll();
    notifications.onParentAgentSettled();
    assert.equal(
      sent.length,
      5,
      "parent-run queue flush must not publish claimed completion",
    );
    const publicTypes = fs.readFileSync(
      path.join(packageRoot, "dist/public.d.ts"),
      "utf8",
    );
    assert.match(
      publicTypes.match(/interface SpawnOptions \{[\s\S]*?\n\}/)[0],
      /claimOutcome\?: boolean/,
    );
    assert.match(publicTypes, /readonly supportsInitialOutcomeClaim: true/);
    console.log(`Reapplied frozen patch fixture: ${fixture}`);
  } finally {
    release();
    manager.abortAll();
    await manager.waitForAll();
    await manager.dispose();
    notifications.dispose();
  }
});
