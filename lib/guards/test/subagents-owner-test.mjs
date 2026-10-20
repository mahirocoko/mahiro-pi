import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { normalizeSubagentsCopy } from "./subagents-supply-fixture.mjs";

const adapter = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const product = path.resolve(adapter, "../..");

test("public SDK factory bindings isolate exact SessionManager owners through reload and shutdown", async () => {
  const base = path.join(
    product,
    ".agent-state/runtime/herdr-worker-activity/phase-a",
  );
  fs.mkdirSync(base, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(base, "sdk-owner-"));
  process.env.PI_CODING_AGENT_DIR = path.join(fixture, "global-profile");
  fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);
  const sdk = await import("@earendil-works/pi-coding-agent");
  const ai = await import("@earendil-works/pi-ai");
  const subagents = fs.realpathSync(
    path.join(adapter, "node_modules/@gotgenes/pi-subagents"),
  );
  const t = { nodes: [], api: undefined };
  const key = `owner-proof-${path.basename(fixture)}`;
  globalThis[Symbol.for(key)] = t;
  const observer = path.join(fixture, "observer.ts");
  fs.symlinkSync(
    path.join(adapter, "node_modules"),
    path.join(fixture, "node_modules"),
    "dir",
  );
  fs.writeFileSync(
    observer,
    `import * as api from '@gotgenes/pi-subagents';
export default pi => {
 const t = globalThis[Symbol.for(${JSON.stringify(key)})];
 t.api = api;
 pi.on('session_start', (_e,ctx) => t.nodes.push({owner:ctx.sessionManager,service:api.getSubagentsService(),get scoped(){return api.getSubagentsServiceForSession(ctx.sessionManager)}}));
};`,
  );
  const runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const faux = ai.fauxProvider({
    provider: "owner-offline",
    models: [{ id: "fixture" }],
  });
  runtime.registerNativeProvider(faux.provider);
  let networkAttempts = 0;
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkAttempts++;
    throw new Error("network disabled");
  };
  const sessions = [];
  async function create() {
    const agentDir = fs.mkdtempSync(path.join(fixture, "profile-"));
    fs.writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({
        packages: [subagents],
        extensions: [observer],
        skills: [],
        prompts: [],
        themes: [],
        cacheWarming: "off",
      }),
    );
    const settingsManager = sdk.SettingsManager.create(fixture, agentDir);
    const loader = new sdk.DefaultResourceLoader({
      cwd: fixture,
      agentDir,
      settingsManager,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ["mcp"],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const manager = sdk.SessionManager.inMemory(fixture);
    const { session } = await sdk.createAgentSession({
      cwd: fixture,
      agentDir,
      modelRuntime: runtime,
      model: faux.getModel(),
      settingsManager,
      resourceLoader: loader,
      sessionManager: manager,
    });
    sessions.push(session);
    await session.bindExtensions({
      onError: (error) => {
        throw new Error(JSON.stringify(error));
      },
    });
    const node = t.nodes.at(-1);
    assert.equal(node.owner, manager, "real ctx exposes the exact SDK manager");
    assert.ok(
      node.scoped === node.service,
      "factory service and public getter must match",
    );
    assert.ok(node.scoped);
    return { session, ...node };
  }
  try {
    const a = await create();
    const b = await create();
    assert.notEqual(a.owner, b.owner);
    assert.notEqual(a.service, b.service);
    assert.equal(t.api.getSubagentsService(), b.service);
    assert.equal(t.api.getSubagentsServiceForSession(a.owner), a.service);
    assert.equal(
      t.api.getSubagentsServiceForSession({
        getSessionId: () => a.owner.getSessionId(),
      }),
      undefined,
    );
    assert.equal(t.api.getSubagentsServiceForSession({}), undefined);
    assert.deepEqual(a.service.listAgents(), []);
    assert.equal(typeof a.service.getAgentType, "function");
    assert.equal(a.service.supportsInitialOutcomeClaim, true);
    const stale = a.session.extensionRunner;
    await a.session.reload();
    const replacement = t.nodes.at(-1);
    assert.equal(replacement.owner, a.owner);
    assert.notEqual(replacement.service, a.service);
    assert.equal(
      t.api.getSubagentsServiceForSession(a.owner),
      replacement.service,
    );
    await stale.emit({ type: "session_shutdown", reason: "reload" });
    assert.equal(
      t.api.getSubagentsServiceForSession(a.owner),
      replacement.service,
      "stale factory cleanup cannot delete replacement A",
    );
    assert.equal(
      t.api.getSubagentsServiceForSession(b.owner),
      b.service,
      "A cleanup cannot delete B",
    );
    await b.session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "exit",
    });
    assert.equal(t.api.getSubagentsServiceForSession(b.owner), undefined);
    assert.equal(
      t.api.getSubagentsServiceForSession(a.owner),
      replacement.service,
      "B cleanup cannot clear A",
    );
    await a.session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "exit",
    });
    assert.equal(t.api.getSubagentsServiceForSession(a.owner), undefined);
    const declaration = fs.readFileSync(
      path.join(subagents, "dist/public.d.ts"),
      "utf8",
    );
    assert.match(
      declaration,
      /getSubagentsServiceForSession\(owner: object\): SubagentsService \| undefined/,
    );
    assert.equal(networkAttempts, 0);
    fs.writeFileSync(
      path.join(fixture, "receipt.json"),
      JSON.stringify(
        {
          actualSDK: true,
          actualPackageFactory: subagents,
          networkAttempts,
          ownersDistinct: true,
          reloadAndStaleCleanup: true,
        },
        null,
        2,
      ),
    );
    console.log(`Owner SDK receipt: ${fixture}`);
  } finally {
    globalThis.fetch = fetch;
    for (const session of sessions) session.dispose();
    delete globalThis[Symbol.for(key)];
  }
});

test("fresh Jiti copies refuse incompatible owner registries without breaking global service lifecycle", async () => {
  const require = createRequire(
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  );
  const { createJiti } = require("jiti");
  const supplied = fs.realpathSync(
    path.join(adapter, "node_modules/@gotgenes/pi-subagents"),
  );
  const entry = path.join(supplied, "src/service/session-owner.ts");
  const key = Symbol.for("pi-subagents.session-owner-registry.v1");
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  const load = () =>
    createJiti(import.meta.url, { moduleCache: false, fsCache: false }).import(
      entry,
    );
  const owner = {},
    foreign = {},
    service = {};
  const protocol = { protocol: "pi-subagents.session-owner", version: 1 };
  let calls = 0;
  const get = () => {
    calls++;
    return foreign;
  };
  try {
    delete globalThis[key];
    const first = await load();
    const binding = first.createSessionServiceBinding(service);
    binding.start(owner);
    const canonical = globalThis[key];
    const second = await load();
    assert.notEqual(
      first.createSessionServiceBinding,
      second.createSessionServiceBinding,
      "moduleCache:false really evaluates another closure",
    );
    assert.equal(
      second.getSubagentsServiceForSession(owner),
      service,
      "supported registry shares across fresh copies",
    );
    assert.equal(globalThis[key], canonical);
    const globalAPI = await createJiti(import.meta.url, {
      moduleCache: false,
      fsCache: false,
    }).import(path.join(supplied, "src/service/service.ts"));
    const cases = [
      ["ordinary Map", new Map([[owner, foreign]])],
      ["missing deleteIf", { ...protocol, get, set() {} }],
      ["missing set", { ...protocol, get, deleteIf() {} }],
      ["missing get", { ...protocol, set() {}, deleteIf() {} }],
      [
        "unsupported version",
        { ...protocol, version: 2, get, set() {}, deleteIf() {} },
      ],
      [
        "wrong protocol",
        { ...protocol, protocol: "unknown", get, set() {}, deleteIf() {} },
      ],
      ["plain object", {}],
      ["null", null],
      ["number", 42],
      ["undefined slot", undefined],
    ];
    for (const [name, slot] of cases) {
      globalThis[key] = slot;
      const fresh = await load();
      assert.notEqual(
        fresh.createSessionServiceBinding,
        first.createSessionServiceBinding,
        name,
      );
      assert.equal(fresh.getSubagentsServiceForSession(owner), undefined, name);
      const refused = fresh.createSessionServiceBinding(service);
      assert.doesNotThrow(() => {
        refused.start(owner);
        refused.shutdown();
      }, name);
      assert.equal(fresh.getSubagentsServiceForSession(owner), undefined, name);
      assert.equal(globalThis[key], slot, `${name}: unknown slot preserved`);
      globalAPI.publishSubagentsService(service);
      assert.equal(globalAPI.getSubagentsService(), service, name);
      globalAPI.unpublishSubagentsService();
      assert.equal(globalAPI.getSubagentsService(), undefined, name);
    }
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get() {
        throw new Error("unavailable slot");
      },
    });
    const inaccessible = await load();
    assert.equal(inaccessible.getSubagentsServiceForSession(owner), undefined);
    assert.doesNotThrow(() =>
      inaccessible.createSessionServiceBinding(service).shutdown(),
    );
    assert.equal(calls, 0, "incompatible methods must never be invoked");
  } finally {
    delete globalThis[key];
    if (previous) Object.defineProperty(globalThis, key, previous);
  }
});

test("owned supply normalization accepts only known upstream/V1/V2; internal binding refuses manager transfer", async () => {
  const base = path.join(
    product,
    ".agent-state/runtime/herdr-worker-activity/phase-a",
  );
  fs.mkdirSync(base, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(base, "supply-"));
  const supplied = fs.realpathSync(
    path.join(adapter, "node_modules/@gotgenes/pi-subagents"),
  );
  for (const desired of ["unpatched", "v1", "v2"]) {
    const target = path.join(fixture, desired);
    normalizeSubagentsCopy({
      product,
      supplied,
      target,
      ceiling: fixture,
      desired,
    });
    const normalized = path.join(fixture, `${desired}-v2`);
    assert.equal(
      normalizeSubagentsCopy({
        product,
        supplied: target,
        target: normalized,
        ceiling: fixture,
      }).before,
      desired,
    );
  }
  const drift = path.join(fixture, "v1/src/service/service.ts");
  fs.appendFileSync(drift, "\n// unknown drift\n");
  assert.throws(
    () =>
      normalizeSubagentsCopy({
        product,
        supplied: path.join(fixture, "v1"),
        target: path.join(fixture, "drift"),
        ceiling: fixture,
      }),
    /Unknown\/drift/,
  );
  const module = path.join(fixture, "binding.mjs");
  await build({
    entryPoints: [path.join(supplied, "src/service/session-owner.ts")],
    outfile: module,
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const { createSessionServiceBinding, getSubagentsServiceForSession: get } =
    await import(module);
  // Injected unit-only state machine, not the genuine SDK binding proof above.
  const service = {},
    a = {},
    b = {};
  const binding = createSessionServiceBinding(service);
  binding.start(a);
  binding.start(a);
  assert.equal(get(a), service);
  binding.start(b);
  assert.equal(get(a), undefined);
  assert.equal(get(b), undefined);
  binding.start(a);
  assert.equal(get(a), undefined);
  binding.shutdown();
});
