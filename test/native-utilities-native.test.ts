import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  registerNativeUtilities,
  REALIGN_KIND,
  TIMESTAMP_KIND,
} from "../lib/native-utilities.ts";

const product = resolve(import.meta.dirname, "..");
const modules = resolve(product, "../mods/adapters/pi/node_modules");
const available = existsSync(
  join(modules, "@earendil-works/pi-coding-agent/package.json"),
);
const publicImport = async (name: string) => {
  const root = join(modules, name);
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(metadata.version, "1.3.0");
  return import(pathToFileURL(join(root, metadata.exports["."].import)).href);
};

test("native SDK/Faux: retained disposed API fails closed; fresh-loader new/switch works; child realign and clock blocked", {
  skip: !available && "canonical public SDK fixture prerequisites absent",
}, async () => {
  const base = join(product, ".agent-state/runtime");
  mkdirSync(base, { recursive: true });
  const fixture = mkdtempSync(join(base, "utilities-repair-native-"));
  const cwd = join(fixture, "project");
  const agentDir = join(fixture, "agent");
  mkdirSync(cwd);
  mkdirSync(agentDir);
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const savedFetch = globalThis.fetch;
  let runtime: any;
  let externalRequests = 0;
  let factories = 0;
  let extensionAPI: any;
  const errors: any[] = [];
  try {
    process.env.PI_CODING_AGENT_DIR = agentDir;
    globalThis.fetch = () => {
      externalRequests++;
      throw new Error("No external transport allowed");
    };
    const sdk = await publicImport("@earendil-works/pi-coding-agent");
    const ai = await publicImport("@earendil-works/pi-ai");
    const modelRuntime = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const faux = ai.fauxProvider({
      provider: "utilities-offline",
      models: [{ id: "fixture" }],
    });
    modelRuntime.registerNativeProvider(faux.provider);
    faux.setResponses(
      Array.from({ length: 20 }, () =>
        ai.fauxAssistantMessage("Synthetic utility repair only."),
      ),
    );
    const settingsManager = sdk.SettingsManager.inMemory({
      cacheWarming: "off",
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const loader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      noThemes: true,
      noPromptTemplates: true,
      disabledBuiltinExtensions: ["mcp"],
      systemPromptOverride: () =>
        "Synthetic utility composition fixture, not a default-provider test.",
      extensionFactories: [
        (pi: any) => {
          factories++;
          extensionAPI = pi;
          registerNativeUtilities(pi);
        },
      ],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const createRuntime = async (options: any) => {
      const result = await sdk.createAgentSession({
        cwd,
        agentDir,
        settingsManager,
        resourceLoader: loader,
        sessionManager: options.sessionManager,
        sessionStartEvent: options.sessionStartEvent,
        modelRuntime,
        model: faux.getModel(),
        noTools: true,
      });
      await result.session.bindExtensions({
        onError: (error: any) => errors.push(error),
      });
      return { ...result, services: { cwd, agentDir } };
    };
    runtime = await sdk.createAgentSessionRuntime(createRuntime, {
      cwd,
      agentDir,
      sessionManager: sdk.SessionManager.create(cwd, join(fixture, "sessions")),
    });
    const count = (kind: string) =>
      runtime.session.sessionManager
        .getBranch()
        .filter(
          (entry: any) =>
            entry.type === "custom_message" && entry.customType === kind,
        ).length;
    const checkPrimary = async (text: string) => {
      const beforeClock = count(TIMESTAMP_KIND);
      await runtime.session.prompt(text);
      assert.equal(count(TIMESTAMP_KIND), beforeClock + 1);
      const beforeRealign = count(REALIGN_KIND);
      const users = () =>
        runtime.session.sessionManager
          .getBranch()
          .filter(
            (entry: any) =>
              entry.type === "message" && entry.message.role === "user",
          );
      const userCount = users().length;
      await runtime.session.prompt("/realign primary fixture focus");
      await runtime.session.waitForIdle();
      assert.equal(count(REALIGN_KIND), beforeRealign + 1);
      assert.equal(count(TIMESTAMP_KIND), beforeClock + 1);
      assert.equal(
        users().length,
        userCount,
        "custom guidance must not become observed user evidence",
      );
      assert.deepEqual(users().at(-1).message.content, [
        { type: "text", text },
      ]);
    };
    await checkPrimary("first manager");
    const originalManager = runtime.session.sessionManager;
    await runtime.newSession();
    assert.notEqual(runtime.session.sessionManager, originalManager);
    assert.throws(
      () => extensionAPI.getFlag("mahiro-realign-disable"),
      /stale after session replacement or reload/i,
      "SDK 1.3 retained public ExtensionAPI is unavailable after shutdown",
    );
    assert.throws(
      () =>
        extensionAPI.sendMessage({
          customType: "fixture",
          content: "not sent",
          display: false,
        }),
      /stale after session replacement or reload/i,
    );
    await runtime.session.prompt("unsupported reused loader composition");
    await runtime.session.prompt("/realign unavailable handle");
    await runtime.session.waitForIdle();
    assert.equal(count(TIMESTAMP_KIND), 0);
    assert.equal(count(REALIGN_KIND), 0);
    assert.deepEqual(
      errors,
      [],
      "unsupported retained factory must fail closed without handler errors",
    );
    await runtime.dispose();
    // Supported stock composition: a fresh loader supplies fresh public API handles.
    const freshCreateRuntime = async (options: any) => {
      await loader.reload();
      return createRuntime(options);
    };
    runtime = await sdk.createAgentSessionRuntime(freshCreateRuntime, {
      cwd,
      agentDir,
      sessionManager: sdk.SessionManager.create(
        cwd,
        join(fixture, "fresh-sessions"),
      ),
    });
    await checkPrimary("fresh loader supported");
    const freshOriginal = runtime.session.sessionManager.getSessionFile();
    await runtime.newSession();
    await checkPrimary("fresh loader after new");
    await runtime.switchSession(freshOriginal);
    await checkPrimary("fresh loader after switch");
    await runtime.newSession({ parentSession: "synthetic-parent" });
    await runtime.session.prompt("child ordinary input");
    assert.equal(count(TIMESTAMP_KIND), 0);
    await runtime.session.prompt("/realign child focus");
    await runtime.session.waitForIdle();
    assert.equal(
      count(REALIGN_KIND),
      0,
      "known child command must stay blocked",
    );
    assert.equal(
      factories,
      5,
      "one retained factory plus fresh-loader primary/new/switch/child factories",
    );
    assert.deepEqual(errors, []);
    assert.equal(externalRequests, 0);
  } finally {
    await runtime?.dispose();
    globalThis.fetch = savedFetch;
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(fixture, { recursive: true, force: true });
  }
});
