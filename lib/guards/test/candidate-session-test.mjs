import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import test from "node:test";

const adapter = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const primary = path.resolve(adapter, "../..");
const stage = path.resolve(primary, "..");
const fixture = fs.mkdtempSync(path.join(stage, "candidate-session-"));
process.env.HOME = path.join(fixture, "home");
process.env.XDG_CONFIG_HOME = path.join(process.env.HOME, ".config");
fs.mkdirSync(process.env.HOME);
let networkAttempts = 0;
const deny = () => {
  networkAttempts++;
  throw Error("Candidate fixture forbids network");
};
globalThis.fetch = deny;
net.Socket.prototype.connect = deny;
const sdk = await import("@earendil-works/pi-coding-agent");
const ai = await import("@earendil-works/pi-ai");

test("candidate13 actual single-owner tools are healthy; dual guard collision stays fail closed", async () => {
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
  );
  for (const dual of [false, true]) {
    const dir = path.join(fixture, dual ? "dual" : "single");
    const cwd = path.join(dir, "project"),
      agentDir = path.join(dir, "agent");
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(agentDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    fs.writeFileSync(path.join(cwd, "safe.txt"), "CANDIDATE_SAFE_READ_OK\n");
    fs.writeFileSync(
      path.join(cwd, ".env"),
      "SYNTHETIC_KEY=CANARY_DO_NOT_OUTPUT\n",
    );
    const permissionDir = path.join(
      agentDir,
      "extensions/pi-permission-system",
    );
    fs.mkdirSync(permissionDir, { recursive: true });
    fs.writeFileSync(
      path.join(permissionDir, "config.json"),
      JSON.stringify({
        yoloMode: false,
        authorizerChain: [],
        permission: { "*": "allow" },
      }),
    );
    const packages = [
      fs.realpathSync(
        path.join(adapter, "node_modules/@gotgenes/pi-permission-system"),
      ),
      primary,
    ];
    if (dual) {
      const duplicate = path.join(dir, "duplicate-guard");
      fs.mkdirSync(duplicate);
      for (const name of ["lib", "extensions", "package.json"])
        fs.cpSync(path.join(primary, name), path.join(duplicate, name), {
          recursive: true,
          filter: (file) => !file.split(path.sep).includes("node_modules"),
        });
      fs.symlinkSync(
        path.join(adapter, "node_modules"),
        path.join(duplicate, "node_modules"),
        "dir",
      );
      packages.splice(1, 0, path.join(duplicate, "lib/guards"));
    }
    const settingsManager = sdk.SettingsManager.inMemory({
      packages,
      defaultTools: ["+codemode"],
      cacheWarming: "off",
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const loader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ["mcp"],
      extensionFactories: [sdk.createCodemodeExtension()],
    });
    const faux = ai.fauxProvider({
      provider: `candidate-${dual ? "dual" : "single"}`,
      models: [{ id: "fixture" }],
    });
    const runtime = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    runtime.registerNativeProvider(faux.provider);
    await runtime.refresh({ allowNetwork: false });
    let session, messages;
    faux.setResponses([
      ai.fauxAssistantMessage(
        [
          ai.fauxToolCall("read", { path: "safe.txt" }),
          ai.fauxToolCall("bash", { command: "printf CANDIDATE_BASH_OK" }),
          ai.fauxToolCall("codemode", {
            code: "text(await tools.read({path:'safe.txt'}));",
          }),
          ai.fauxToolCall("read", { path: ".env" }),
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        messages = context.messages;
        return ai.fauxAssistantMessage("Candidate synthetic checks complete");
      },
    ]);
    try {
      await loader.reload();
      const loaded = loader.getExtensions();
      if (dual)
        assert.ok(
          loaded.errors.length > 0 &&
            loaded.errors.every((e) => e.error.includes("conflicts with")),
          JSON.stringify(loaded.errors),
        );
      else {
        assert.deepEqual(loaded.errors, []);
        assert.equal(
          loaded.extensions.filter((e) => e.path.startsWith(primary + path.sep))
            .length,
          13,
        );
      }
      ({ session } = await sdk.createAgentSession({
        cwd,
        agentDir,
        settingsManager,
        resourceLoader: loader,
        modelRuntime: runtime,
        model: faux.getModel(),
        sessionManager: sdk.SessionManager.inMemory(cwd),
      }));
      await session.bindExtensions({});
      const node = globalThis[
        Symbol.for("@mahirocoko/pi-guards:healthy-nodes")
      ]?.get(session.sessionId);
      assert.equal(node?.healthy?.() === true, !dual);
      await session.prompt("Run only the synthetic candidate checks");
      const results = messages.filter((m) => m.role === "toolResult");
      assert.equal(
        results.length,
        4,
        "Run reaches all tool results and natural completion",
      );
      if (dual)
        assert.ok(
          results.every(
            (m) =>
              m.isError &&
              JSON.stringify(m).includes("canonical node missing or unhealthy"),
          ),
        );
      else {
        for (const [name, text] of [
          ["read", "CANDIDATE_SAFE_READ_OK"],
          ["bash", "CANDIDATE_BASH_OK"],
          ["codemode", "CANDIDATE_SAFE_READ_OK"],
        ])
          assert.ok(
            results.some(
              (m) =>
                m.toolName === name &&
                !m.isError &&
                JSON.stringify(m).includes(text),
            ),
          );
        assert.ok(results.some((m) => m.toolName === "read" && m.isError));
      }
      assert.doesNotMatch(JSON.stringify(results), /CANARY_DO_NOT_OUTPUT/);
      fs.writeFileSync(
        path.join(dir, "receipt.json"),
        JSON.stringify(
          {
            dual,
            resources: loaded.extensions.map((e) => e.path),
            errors: loaded.errors,
            healthy: node?.healthy?.() === true,
            results,
            networkAttempts,
            naturalCompletion: true,
          },
          null,
          2,
        ),
      );
      assert.equal(networkAttempts, 0);
    } finally {
      if (session) {
        await session.extensionRunner?.emit({
          type: "session_shutdown",
          reason: "quit",
        });
        session.dispose();
      }
      await runtime.dispose?.();
    }
  }
});
