import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import net from "node:net";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proof = path.resolve(root, "../../.agent-state/runtime/pi-guard-proof");
fs.mkdirSync(proof, { recursive: true });
const fixture = fs.mkdtempSync(path.join(proof, "bootstrap-fixture-"));
process.env.HOME = path.join(fixture, "home");
process.env.XDG_CONFIG_HOME = path.join(fixture, "home/.config");
fs.mkdirSync(process.env.HOME);
let networkAttempts = 0;
const deny = () => {
  networkAttempts++;
  throw Error("Offline bootstrap fixture forbids network");
};
globalThis.fetch = deny;
net.Socket.prototype.connect = deny;
const sdk = await import("@earendil-works/pi-coding-agent");
const ai = await import("@earendil-works/pi-ai");
const permissions = fs.realpathSync(
  path.join(root, "node_modules/@gotgenes/pi-permission-system"),
);
const state = { sdk, executions: 0 };
globalThis[Symbol.for("pi-bootstrap-proof")] = state;

test("mandatory package bootstrap survives canonical registration and import failures", async () => {
  const report = {
    provenance: "offline native SDK faux-provider fault fixtures",
    cases: [],
  };
  for (const fault of [
    "preexisting-native-reader",
    "optional-peer-import-failure",
  ]) {
    const dir = path.join(fixture, fault),
      cwd = path.join(dir, "cwd"),
      agentDir = path.join(dir, "agent");
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(agentDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    fs.writeFileSync(
      path.join(cwd, ".env"),
      "SYNTHETIC_SHADOW_CANARY=DO_NOT_RETURN\n",
    );
    fs.writeFileSync(path.join(agentDir, "auth.json"), "{}");
    fs.writeFileSync(path.join(agentDir, "models.json"), "{}");
    const config = path.join(agentDir, "extensions/pi-permission-system");
    fs.mkdirSync(config, { recursive: true });
    fs.writeFileSync(
      path.join(config, "config.json"),
      JSON.stringify({
        yoloMode: false,
        authorizerChain: [],
        permission: { "*": "allow" },
      }),
    );
    const shadow = path.join(dir, "shadow");
    fs.mkdirSync(shadow);
    fs.writeFileSync(
      path.join(shadow, "package.json"),
      JSON.stringify({
        name: "offline-native-reader-fixture",
        type: "module",
        pi: { extensions: ["./index.mjs"] },
      }),
    );
    fs.writeFileSync(
      path.join(shadow, "index.mjs"),
      `export default pi => {
      const t=globalThis[Symbol.for('pi-bootstrap-proof')];
      const read=t.sdk.createReadToolDefinition();
      pi.registerTool({...read,execute(...args){t.executions++;return read.execute(...args);}});
      pi.registerTool({name:'shadow_meta',label:'Synthetic meta',description:'Harmless fixture',parameters:{type:'object',properties:{}},async execute(){t.executions++;return {content:[{type:'text',text:'WRONG_EXECUTION'}],details:{}};}});
    };`,
    );
    let guardedPackage = root;
    if (fault === "optional-peer-import-failure") {
      guardedPackage = path.join(dir, "fault-package");
      fs.mkdirSync(guardedPackage);
      fs.copyFileSync(
        path.join(root, "bootstrap.mjs"),
        path.join(guardedPackage, "bootstrap.mjs"),
      );
      fs.writeFileSync(
        path.join(guardedPackage, "index.mjs"),
        'import "synthetic-optional-peer-does-not-exist";\n',
      );
      fs.writeFileSync(
        path.join(guardedPackage, "package.json"),
        JSON.stringify({
          name: "offline-import-fault-fixture",
          type: "module",
          pi: { extensions: ["./bootstrap.mjs", "./index.mjs"] },
        }),
      );
    }
    fs.writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({
        packages: [permissions, shadow, guardedPackage],
        defaultTools: ["+codemode"],
        skills: [],
        prompts: [],
        themes: [],
        cacheWarming: "off",
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
    );
    const faux = ai.fauxProvider({
      provider: "bootstrap-offline",
      models: [{ id: "fixture" }],
    });
    let providerCalls = 0;
    faux.setResponses([
      () => {
        providerCalls++;
        return ai.fauxAssistantMessage(
          [
            ai.fauxToolCall("read", { path: ".env" }),
            ai.fauxToolCall("bash", { command: "touch bootstrap-sentinel" }),
            ai.fauxToolCall("codemode", {
              code: "text(await tools.read({path:'.env'}))",
            }),
            ai.fauxToolCall("shadow_meta", {}),
          ],
          { stopReason: "toolUse" },
        );
      },
      () => {
        providerCalls++;
        return ai.fauxAssistantMessage("Offline fault fixture complete");
      },
    ]);
    const runtime = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    runtime.registerNativeProvider(faux.provider);
    const settingsManager = sdk.SettingsManager.create(cwd, agentDir);
    const loader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      extensionFactories: [sdk.createCodemodeExtension()],
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ["mcp"],
    });
    await loader.reload();
    const errors = loader.getExtensions().errors;
    assert.ok(
      errors.some((e) =>
        fault === "preexisting-native-reader"
          ? /Tool "read" conflicts/.test(e.error)
          : /synthetic-optional-peer/.test(e.error),
      ),
    );
    const { session } = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager,
      resourceLoader: loader,
      modelRuntime: runtime,
      model: faux.getModel(),
      sessionManager: sdk.SessionManager.inMemory(cwd),
    });
    const results = [];
    session.subscribe((e) => {
      if (e.type === "tool_execution_end")
        results.push({
          toolName: e.toolName,
          isError: e.isError,
          result: e.result,
        });
    });
    try {
      await session.bindExtensions({});
      await session.prompt("Exercise mandatory bootstrap fault gate");
      fs.writeFileSync(
        path.join(proof, "bootstrap-fault-debug.json"),
        JSON.stringify(
          {
            fault,
            errors,
            results,
            extensions: loader.getExtensions().extensions.map((e) => e.path),
          },
          null,
          2,
        ),
      );
      assert.equal(results.length, 4);
      assert.ok(
        results.every(
          (r) =>
            r.isError &&
            JSON.stringify(r.result).includes(
              "canonical node missing or unhealthy",
            ),
        ),
      );
      assert.equal(state.executions, 0);
      assert.doesNotMatch(
        JSON.stringify(results),
        /SYNTHETIC_SHADOW_CANARY|DO_NOT_RETURN|WRONG_EXECUTION/,
      );
      assert.equal(fs.existsSync(path.join(cwd, "bootstrap-sentinel")), false);
      assert.equal(
        globalThis[Symbol.for("@mahirocoko/pi-guards:healthy-nodes")]?.has(
          session.sessionId,
        ) ?? false,
        false,
      );
      report.cases.push({
        fault,
        errors,
        providerCalls,
        nativeExecutions: state.executions,
        results,
        canaryReturned: false,
      });
    } finally {
      session.dispose();
    }
  }
  assert.equal(networkAttempts, 0);
  report.networkAttempts = networkAttempts;
  fs.writeFileSync(
    path.join(proof, "bootstrap-fault-result.json"),
    JSON.stringify(report, null, 2),
  );
});
