import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const adapter = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const primary = path.resolve(adapter, "../..");
const base = path.join(
  primary,
  ".agent-state/runtime/herdr-worker-activity/phase-b-pi",
);
fs.mkdirSync(base, { recursive: true });
const fixture = fs.mkdtempSync(path.join(base, "sdk-child-"));
process.env.HOME = path.join(fixture, "home");
process.env.PI_CODING_AGENT_DIR = path.join(fixture, "agent");
fs.mkdirSync(process.env.HOME);
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);
const sdk = await import("@earendil-works/pi-coding-agent");
const ai = await import("@earendil-works/pi-ai");

test("owned candidate13 plus additional inactive 14th resource: genuine Faux auto children and idle parent snapshots", async () => {
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const { workerCounts, workerOwner } = await import(
    path.join(primary, "lib/worker-activity.ts")
  );
  const metadataOwner = workerOwner();
  let ownerDisposals = 0;
  const sentinel = () => {
    ownerDisposals++;
  };
  metadataOwner.dispose = sentinel;
  process.env.HERDR_ENV = "1";
  process.env.HERDR_PANE_ID = "synthetic-inherited-pane";
  process.env.HERDR_SOCKET_PATH = "/synthetic/no-cli";
  const key = `worker-child-${path.basename(fixture)}`;
  const nodes = [];
  globalThis[Symbol.for(key)] = nodes;
  const observer = path.join(fixture, "observer.ts");
  const callbacks = [];
  const callbackKey = `${key}-actual-worker-callbacks`;
  globalThis[Symbol.for(callbackKey)] = callbacks;
  // Owned resource wraps registration, but invokes the unmodified production
  // handler with the SDK's real event/context. No mode or service substitution.
  const worker = path.join(primary, "extensions/mahiro-worker-activity.ts");
  const extra = path.join(fixture, "worker-observed.ts");
  fs.writeFileSync(
    extra,
    `import worker from ${JSON.stringify(worker)};
import * as api from '@gotgenes/pi-subagents';
export default pi => worker(new Proxy(pi, { get(target, key) {
  if (key !== 'on') return Reflect.get(target, key);
  return (event, handler) => target.on(event, async (e, ctx) => {
    const result = await handler(e, ctx);
    if (event === 'session_start') globalThis[Symbol.for(${JSON.stringify(callbackKey)})].push({ctx, service: api.getSubagentsServiceForSession(ctx.sessionManager)});
    return result;
  });
}}));`,
  );
  fs.symlinkSync(
    path.join(adapter, "node_modules"),
    path.join(fixture, "node_modules"),
    "dir",
  );
  fs.writeFileSync(
    observer,
    `import * as api from '@gotgenes/pi-subagents';
export default pi=>{pi.on('session_start',(_e,ctx)=>globalThis[Symbol.for(${JSON.stringify(key)})].push({ctx,api,get service(){return api.getSubagentsServiceForSession(ctx.sessionManager)}}));};`,
  );
  const packages = [
    fs.realpathSync(
      path.join(adapter, "node_modules/@gotgenes/pi-permission-system"),
    ),
    fs.realpathSync(path.join(adapter, "node_modules/@gotgenes/pi-subagents")),
    primary,
  ];
  const settings = {
    packages,
    extensions: [observer, extra],
    skills: [],
    prompts: [],
    themes: [],
    cacheWarming: "off",
    retry: { enabled: false },
    compaction: { enabled: false },
  };
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify(settings),
  );
  fs.writeFileSync(
    path.join(agentDir, "subagents.json"),
    JSON.stringify({ maxConcurrent: 1 }),
  );
  fs.mkdirSync(path.join(agentDir, "agents"));
  fs.writeFileSync(
    path.join(agentDir, "agents/fixture-worker.md"),
    "---\nname: fixture-worker\ntools: []\nprompt_mode: replace\n---\nReply offline only.\n",
  );
  const permissionDir = path.join(agentDir, "extensions/pi-permission-system");
  fs.mkdirSync(permissionDir, { recursive: true });
  fs.writeFileSync(
    path.join(permissionDir, "config.json"),
    JSON.stringify({ authorizerChain: [], permission: { "*": "allow" } }),
  );
  const settingsManager = sdk.SettingsManager.create(fixture, agentDir);
  const loader = new sdk.DefaultResourceLoader({
    cwd: fixture,
    agentDir,
    settingsManager,
    additionalExtensionPaths: [extra],
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    disabledBuiltinExtensions: ["mcp"],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.equal(
    loader
      .getExtensions()
      .extensions.filter(
        (e) =>
          e.path === extra ||
          (e.path.startsWith(primary + path.sep) &&
            !e.path.startsWith(base + path.sep)),
      ).length,
    14,
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(primary, "package.json"), "utf8")).pi
      .extensions.length,
    13,
    "owned candidate manifest unchanged",
  );
  const runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const faux = ai.fauxProvider({
    provider: "worker-offline",
    models: [{ id: "fixture" }],
  });
  runtime.registerNativeProvider(faux.provider);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  // Faux runs only after child bindExtensions/owner registration completes and
  // before shutdown removes its scoped service. Callback invocation may precede
  // the owner handler, so do not confuse registration order with absent service.
  const captureBoundServices = () => {
    for (const entry of callbacks) {
      const node = nodes.find(
        (node) => node.ctx.sessionManager === entry.ctx.sessionManager,
      );
      if (node?.service) entry.service = node.service;
    }
  };
  faux.setResponses([
    async () => {
      captureBoundServices();
      await gate;
      return ai.fauxAssistantMessage("offline");
    },
    ...Array.from({ length: 5 }, () => async () => {
      captureBoundServices();
      return ai.fauxAssistantMessage("offline");
    }),
  ]);
  const fetch = globalThis.fetch;
  let networkAttempts = 0;
  globalThis.fetch = async () => {
    networkAttempts++;
    throw new Error("network forbidden");
  };
  const { session } = await sdk.createAgentSession({
    cwd: fixture,
    agentDir,
    settingsManager,
    resourceLoader: loader,
    modelRuntime: runtime,
    model: faux.getModel(),
    sessionManager: sdk.SessionManager.inMemory(fixture),
  });
  try {
    await session.bindExtensions({
      onError: (e) => {
        throw new Error(JSON.stringify(e));
      },
    });
    const parent = nodes[0];
    assert.equal(callbacks.length, 1, "actual parent worker handler executes");
    assert.equal(callbacks[0].ctx.sessionManager, parent.ctx.sessionManager);
    const service = parent.service;
    captureBoundServices();
    assert.equal(callbacks[0].service === service, true);
    assert.ok(service);
    for (let i = 0; i < 6; i++)
      service.spawn("fixture-worker", "offline", { claimOutcome: true });
    const initial = service.listAgents().map((r) => r.status);
    assert.ok(initial.includes("running") && initial.includes("queued"));
    assert.equal(parent.ctx.isIdle(), true);
    assert.deepEqual(workerCounts(service.listAgents()), {
      running: 1,
      queued: 5,
    });
    for (let i = 0; i < 500 && nodes.length < 2; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(
      nodes.length >= 2,
      "automatically spawned child really binds extensions",
    );
    const child = nodes[1];
    assert.notEqual(child.ctx.sessionManager, parent.ctx.sessionManager);
    assert.ok(child.service);
    assert.notEqual(child.service, service);
    const firstCallback = callbacks.find(
      (entry) => entry.ctx.sessionManager === child.ctx.sessionManager,
    );
    assert.ok(
      firstCallback,
      "actual child worker session_start handler executes",
    );
    captureBoundServices();
    assert.equal(firstCallback.service === child.service, true);
    assert.equal(
      child.ctx.mode,
      "print",
      "actual native child is non-TUI, not a fabricated TUI context",
    );
    assert.equal(
      parent.api.getSubagentsServiceForSession(parent.ctx.sessionManager),
      service,
    );
    assert.notEqual(
      parent.api.getSubagentsService(),
      service,
      "actual child globally rebinds; parent scoped lookup does not follow it",
    );
    release();
    await service.waitForAll();
    assert.ok(service.listAgents().every((r) => r.status === "completed"));
    assert.equal(nodes.length, 7, "all six automatic children observed");
    assert.equal(
      callbacks.length,
      7,
      "actual worker handler executes for parent and all six children",
    );
    const managers = new Set();
    const services = new Set();
    for (const node of nodes) {
      const matches = callbacks.filter(
        (entry) => entry.ctx.sessionManager === node.ctx.sessionManager,
      );
      assert.equal(
        matches.length,
        1,
        "exactly one actual worker callback per real manager",
      );
      const entry = matches[0];
      assert.ok(
        entry.service,
        "capture actual scoped service before child teardown",
      );
      assert.equal(entry.ctx.mode, "print", "unmodified actual SDK context");
      managers.add(entry.ctx.sessionManager);
      services.add(entry.service);
    }
    assert.equal(
      managers.size,
      7,
      "parent and all six child managers are distinct",
    );
    assert.equal(
      services.size,
      7,
      "parent and all six child services are distinct",
    );
    assert.equal(
      parent.api.getSubagentsServiceForSession(parent.ctx.sessionManager),
      service,
      "parent retains exact scoped service after every child global rebind",
    );
    assert.equal(networkAttempts, 0);
    assert.deepEqual(workerCounts(service.listAgents()), {
      running: 0,
      queued: 0,
    });
    assert.equal(
      metadataOwner.dispose,
      sentinel,
      "native non-TUI children must not replace Main metadata owner",
    );
    assert.equal(ownerDisposals, 0);
    fs.writeFileSync(
      path.join(fixture, "receipt.json"),
      JSON.stringify(
        {
          actualSDK: true,
          actualAutomaticChildren: nodes.length - 1,
          childMode: child.ctx.mode,
          parentIdle: true,
          initial,
          terminal: service.listAgents().map((r) => r.status),
          additionalResource: extra,
          actualProductionResource: worker,
          actualWorkerCallbacks: callbacks.length,
          childCallbacks: callbacks.slice(1).map((entry, index) => ({
            child: index + 1,
            callbackCount: callbacks.filter(
              (other) => other.ctx.sessionManager === entry.ctx.sessionManager,
            ).length,
            mode: entry.ctx.mode,
            serviceCapturedBeforeTeardown: Boolean(entry.service),
            distinctManager:
              entry.ctx.sessionManager !== parent.ctx.sessionManager &&
              callbacks.every(
                (other) =>
                  other === entry ||
                  other.ctx.sessionManager !== entry.ctx.sessionManager,
              ),
            distinctService: callbacks.every(
              (other) => other === entry || other.service !== entry.service,
            ),
          })),
          distinctManagers: managers.size,
          distinctServices: services.size,
          parentScopedServiceRetained: true,
          ownerDisposals,
          networkAttempts,
          nativeTUI: false,
          navigationWithRunningChild: "not established",
        },
        null,
        2,
      ),
    );
    console.log(`Worker child receipt: ${fixture}`);
  } finally {
    release();
    await session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "quit",
    });
    session.dispose();
    globalThis.fetch = fetch;
    delete globalThis[Symbol.for(key)];
    delete globalThis[Symbol.for(callbackKey)];
    if (metadataOwner.dispose === sentinel) metadataOwner.dispose = undefined;
    delete process.env.HERDR_ENV;
    delete process.env.HERDR_PANE_ID;
    delete process.env.HERDR_SOCKET_PATH;
  }
});
