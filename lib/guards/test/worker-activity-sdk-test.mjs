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

test("Root-first resources retain healthy Main through genuine Faux children and idle snapshots", async () => {
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const { workerCounts, workerOwner } = await import(
    path.join(primary, "lib/worker-activity.ts")
  );
  const { webActivitySnapshot } = await import(
    path.join(primary, "lib/worker-activity-web.ts")
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
  // Reproduce the installed legacy ordering: Root's session_start runs before
  // the public subagents owner binds its service. Do not reorder to hide it.
  const packages = [
    primary,
    fs.realpathSync(
      path.join(adapter, "node_modules/@gotgenes/pi-permission-system"),
    ),
    fs.realpathSync(path.join(adapter, "node_modules/@gotgenes/pi-subagents")),
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
  const declaration = JSON.parse(
    fs.readFileSync(
      path.join(primary, "test/candidate-extensions.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(primary, "package.json"), "utf8")).pi
      .extensions,
    declaration.candidate,
    "Owned candidate manifest retains the declared guards-first13 graph",
  );
  assert.deepEqual(
    loader
      .getExtensions()
      .extensions.filter(
        (e) =>
          e.path.startsWith(primary + path.sep) &&
          !e.path.startsWith(base + path.sep),
      )
      .map((e) => e.path),
    declaration.candidate.map((resource) => path.resolve(primary, resource)),
    "Root resources retain their declared order, including the appended UI adapter",
  );
  assert.equal(
    loader.getExtensions().extensions.filter((e) => e.path === extra).length,
    1,
    "The observed worker fixture adds exactly one resource to the thirteen owned resources",
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
  fs.writeFileSync(path.join(fixture, "safe.txt"), "GUARD_MAIN_READ_OK");
  fs.writeFileSync(
    path.join(fixture, ".env"),
    "SYNTHETIC_SECRET_MUST_NOT_LEAK",
  );
  let probing = false;
  let probeStage = 0;
  let childWaiting = false;
  const respond = async () => {
    if (probing) {
      const calls = [
        ["read", { path: path.join(fixture, "safe.txt") }],
        ["bash", { command: "printf GUARD_MAIN_BASH_OK" }],
        ["read", { path: path.join(fixture, ".env") }],
      ];
      const call = calls[probeStage++];
      return call
        ? ai.fauxAssistantMessage([ai.fauxToolCall(...call)], {
            stopReason: "toolUse",
          })
        : ai.fauxAssistantMessage("Main probe complete");
    }
    captureBoundServices();
    childWaiting = true;
    await gate;
    return ai.fauxAssistantMessage("offline");
  };
  faux.setResponses(Array.from({ length: 32 }, () => respond));
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
    sessionManager: sdk.SessionManager.create(
      fixture,
      path.join(fixture, "sessions"),
    ),
  });
  const probeParent = async (phase) => {
    const start = session.messages.length;
    probing = true;
    probeStage = 0;
    try {
      await session.prompt(`guard-main-probe ${phase}`);
    } finally {
      probing = false;
    }
    const results = session.messages
      .slice(start)
      .filter((m) => m.role === "toolResult");
    assert.equal(
      results.length,
      3,
      `${phase}: actual native tool dispatch ${JSON.stringify(session.messages.slice(start)).slice(-2400)}`,
    );
    assert.equal(results[0].isError, false, `${phase}: Main read works`);
    assert.match(JSON.stringify(results[0].content), /GUARD_MAIN_READ_OK/);
    assert.equal(results[1].isError, false, `${phase}: Main bash works`);
    assert.match(JSON.stringify(results[1].content), /GUARD_MAIN_BASH_OK/);
    assert.equal(
      results[2].isError,
      true,
      `${phase}: secret read still denied`,
    );
    assert.doesNotMatch(
      JSON.stringify(results),
      /SYNTHETIC_SECRET_MUST_NOT_LEAK/,
    );
  };
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
    const guardNodes =
      globalThis[Symbol.for("@mahirocoko/pi-guards:healthy-nodes")];
    const parentGuard = guardNodes.get(
      parent.ctx.sessionManager.getSessionId(),
    );
    assert.equal(parentGuard.healthy(), true, "Main is healthy before spawn");
    const boundBeforeSpawn =
      parentGuard.managedMemory.parentService() === service;
    await probeParent("before child");
    for (let i = 0; i < 6; i++)
      service.spawn("fixture-worker", "offline", { claimOutcome: true });
    const initial = service.listAgents().map((r) => r.status);
    assert.ok(initial.includes("running") && initial.includes("queued"));
    assert.equal(parent.ctx.isIdle(), true);
    assert.deepEqual(workerCounts(service.listAgents()), {
      running: 1,
      queued: 5,
    });
    const web = webActivitySnapshot(
      parent.ctx.sessionManager,
      service.listAgents(),
    );
    assert.ok(
      web,
      "wire accepts actual public SDK persistent parent and native records",
    );
    assert.equal(web.parentSessionId, parent.ctx.sessionManager.getSessionId());
    assert.equal(web.parentFile, parent.ctx.sessionManager.getSessionFile());
    assert.equal(web.records.length, 6);
    assert.equal(web.records.filter((r) => r.status === "running").length, 1);
    assert.equal(web.records.filter((r) => r.status === "queued").length, 5);
    assert.ok(web.records.every((r) => !Object.hasOwn(r, "prompt")));
    for (let i = 0; i < 500 && (nodes.length < 2 || !childWaiting); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(
      nodes.length >= 2 && childWaiting,
      "automatically spawned child binds extensions and enters its gated Faux request",
    );
    const child = nodes[1];
    assert.equal(
      parentGuard.healthy(),
      true,
      "Main stays healthy with a live child",
    );
    assert.equal(
      boundBeforeSpawn,
      true,
      "exact parent service resolves before spawn",
    );
    assert.ok(parentGuard.managedMemory.parentService() === service);
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
    await probeParent("during child");
    release();
    await service.waitForAll();
    assert.ok(service.listAgents().every((r) => r.status === "completed"));
    assert.ok(
      webActivitySnapshot(
        parent.ctx.sessionManager,
        service.listAgents(),
      ).records.every((r) => r.status === "completed"),
    );
    assert.equal(nodes.length, 7, "all six automatic children observed");
    assert.equal(
      parentGuard.healthy(),
      true,
      "Main stays healthy after children",
    );
    assert.ok(parentGuard.managedMemory.parentService() === service);
    await probeParent("after children");
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
