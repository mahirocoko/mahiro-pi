import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as sdk from "@earendil-works/pi-coding-agent";
import * as ai from "@earendil-works/pi-ai";

const adapter = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ),
  primary = path.resolve(adapter, "../.."),
  stage = path.resolve(primary, "..");
const patched = process.env.PREFERENCES_EXPECT_OWNER === "patched";
const sha = (value) => createHash("sha256").update(value).digest("hex");

test(`native persistent model presets and final RTK authorization: ${patched ? "patched" : "old"} public owner`, async () => {
  assert.match(stage, /\.agent-state\/runtime\/pi-ownership-repair\//);
  const cwd = path.join(stage, "project"),
    agentDir = path.join(stage, "profile"),
    bin = path.join(stage, "bin");
  for (const d of [cwd, agentDir, bin]) fs.mkdirSync(d, { mode: 0o700 });
  fs.writeFileSync(path.join(cwd, "safe.txt"), "SAFE_FIXTURE\n");
  fs.writeFileSync(path.join(cwd, ".env"), "FIXTURE_SECRET=DO_NOT_RETURN\n");
  const marker = path.join(stage, "rtk-spawns.txt");
  fs.writeFileSync(
    path.join(bin, "rtk"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${marker}'\nprintf 'FAKE_RTK_ONLY\\n'\n`,
    { mode: 0o700 },
  );
  const previous = {
    agent: process.env.PI_CODING_AGENT_DIR,
    path: process.env.PATH,
    fetch: globalThis.fetch,
    bash: process.env.BASH_ENV,
    home: process.env.HOME,
    xdg: process.env.XDG_CONFIG_HOME,
  };
  const home = path.join(stage, "synthetic-home");
  fs.mkdirSync(home, { mode: 0o700 });
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  process.env.BASH_ENV = "/dev/null";
  let external = 0;
  globalThis.fetch = () => {
    external++;
    throw Error("No external transport");
  };
  const permissionConfig = path.join(
    agentDir,
    "extensions/pi-permission-system/config.json",
  );
  const root = path.join(agentDir, "preferences/model-profiles"),
    rtkRoot = path.join(agentDir, "preferences/rtk");
  const names = [
    "mh_list_model_profiles",
    "mh_set_model_profile",
    "mh_delete_model_profile",
    "mh_switch_model_profile",
    "mh_rtk",
  ];
  const grants = () => ({
    "*": "deny",
    read: "allow",
    path_read: "allow",
    path_write: "allow",
    codemode: "allow",
    ...Object.fromEntries(names.map((n) => [n, "allow"])),
    [`model_profiles_state_${sha(root)}`]: "allow",
    [`rtk_state_${sha(rtkRoot)}`]: "allow",
    bash: { "*": "deny", "ls *": "allow", "rtk ls *": "allow" },
  });
  const grant = (value) =>
    fs.writeFileSync(
      permissionConfig,
      JSON.stringify({
        authorizerChain: [],
        yoloMode: false,
        permission: value,
      }),
      { mode: 0o600 },
    );
  fs.mkdirSync(path.dirname(permissionConfig), {
    recursive: true,
    mode: 0o700,
  });
  grant(grants());
  const configure = (feature) => {
    const f = path.join(agentDir, `extensions/mahiro-${feature}/config.json`);
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      f,
      JSON.stringify({ version: 1, profile: agentDir, projects: [cwd] }),
      { mode: 0o600 },
    );
    return f;
  };
  const untouched = ["auth.json", "models.json", "Core.md"];
  for (const f of untouched)
    fs.writeFileSync(path.join(agentDir, f), `SYNTHETIC_UNTOUCHED_${f}`, {
      mode: 0o600,
    });
  const before = untouched.map((f) => fs.readFileSync(path.join(agentDir, f)));
  const modelConfig = configure("model-profiles");
  configure("rtk");
  const permissions = fs.realpathSync(
    path.join(adapter, "node_modules/@gotgenes/pi-permission-system"),
  );
  const settings = sdk.SettingsManager.inMemory({
    packages: [
      permissions,
      adapter,
      {
        source: primary,
        extensions: ["extensions/mahiro-model-profiles.ts"],
        skills: [],
        prompts: [],
        themes: [],
      },
    ],
    defaultTools: ["+codemode"],
    cacheWarming: "off",
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const credentials = new ai.InMemoryCredentialStore();
  await credentials.modify("preset-fixture", async () => ({
    type: "api_key",
    key: "SYNTHETIC_FIXTURE_ONLY_NOT_A_CREDENTIAL",
  }));
  const runtime = await sdk.ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const faux = ai.fauxProvider({
    provider: "preset-fixture",
    models: [
      { id: "source", reasoning: true, contextWindow: 32000 },
      { id: "target", reasoning: true, contextWindow: 64000 },
    ],
  });
  runtime.registerNativeProvider(faux.provider);
  const refreshed = await runtime.refresh({ allowNetwork: false });
  assert.equal(refreshed.aborted, false);
  assert.equal(refreshed.errors.size, 0);
  const assertNativeAuth = async (phase) => {
    assert.equal(
      runtime.hasConfiguredAuth("preset-fixture"),
      true,
      `${phase}: configured auth`,
    );
    assert.ok(
      await runtime.checkAuth("preset-fixture"),
      `${phase}: public auth check`,
    );
    assert.ok(
      runtime
        .getAvailableSnapshot()
        .some((m) => m.provider === "preset-fixture" && m.id === "target"),
      `${phase}: available target`,
    );
    if (session)
      assert.equal(session.modelRuntime, runtime, `${phase}: runtime identity`);
  };
  let session,
    ctx,
    definitions,
    tools,
    confirm = async () => true,
    notices = [];
  const start = async () => {
    const loader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: settings,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ["mcp"],
      extensionFactories: [
        sdk.createCodemodeExtension(),
        (pi) => {
          pi.on("session_start", (_e, c) => {
            ctx = c;
            tools = pi.getAllTools();
          });
        },
      ],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    definitions = new Map();
    for (const extension of loader.getExtensions().extensions)
      for (const item of extension.tools.values())
        definitions.set(item.definition.name, item.definition);
    await assertNativeAuth("before SDK session creation");
    ({ session } = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager: settings,
      resourceLoader: loader,
      modelRuntime: runtime,
      model: faux.getModel("source"),
      sessionManager: sdk.SessionManager.inMemory(cwd),
    }));
    await session.bindExtensions({
      mode: "rpc",
      uiContext: {
        confirm: (...args) => confirm(...args),
        notify: (...args) => notices.push(args),
        setStatus() {},
        setWidget() {},
        setWorkingMessage() {},
      },
    });
    // Await the public all-provider snapshot barrier after SDK preparation.
    // A scoped refresh can race registration's asynchronous full refresh.
    const boundRefresh = await runtime.refresh({ allowNetwork: false });
    assert.equal(boundRefresh.aborted, false);
    assert.equal(boundRefresh.errors.size, 0);
    await assertNativeAuth("after SDK binding and full refresh");
  };
  const execute = (name, args = {}, context = ctx, signal) =>
    definitions.get(name).execute("fixture", args, signal, undefined, context);
  const list = async () => (await execute("mh_list_model_profiles")).details;
  const command = async (text) => {
    notices = [];
    await session.prompt(text);
    return notices;
  };
  const shutdown = async () => {
    if (session) {
      try {
        await session.extensionRunner.emit({
          type: "session_shutdown",
          reason: "quit",
        });
      } finally {
        session.dispose();
        session = undefined;
      }
    }
  };
  try {
    await start();
    assert.equal(fs.existsSync(root), false);
    assert.equal(fs.existsSync(rtkRoot), false);
    assert.equal(fs.existsSync(marker), false);
    if (!patched) {
      await assert.rejects(list(), /winning-surface/);
      await assert.rejects(execute("mh_rtk", { operation: "status" }));
      assert.equal(fs.existsSync(root), false);
      return;
    }
    assert.equal((await list()).sequence, 0);
    await command(
      "/mh-model-profile set 0 preset-fixture/target 12000 high across sessions",
    );
    assert.ok(
      notices.every((n) => n[1] !== "error"),
      JSON.stringify(notices),
    );
    assert.equal((await list()).sequence, 1);
    assert.equal(session.model.id, "source", "save never switches");
    const file = path.join(root, "state.json"),
      bytes = fs.readFileSync(file);
    assert.equal(fs.statSync(root).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    confirm = async () => false;
    await command("/mh-model-profile remove 1 across sessions");
    assert.deepEqual(fs.readFileSync(file), bytes);
    confirm = async () => {
      await assertNativeAuth("immediately before public model switch");
      return true;
    };
    await command("/mh-model-profile switch 1 across sessions");
    assert.ok(
      notices.every((n) => n[1] !== "error"),
      JSON.stringify(notices),
    );
    assert.equal(session.model.id, "target");
    assert.equal(session.model.contextWindow, 64000);
    assert.match(JSON.stringify(notices), /unsupported-public-api/);
    assert.equal((await list()).current.thinking, "high");
    assert.deepEqual(fs.readFileSync(file), bytes);
    const retained = definitions.get("mh_delete_model_profile"),
      oldCtx = ctx;
    await shutdown();
    await start();
    assert.equal(
      session.model.id,
      "source",
      "new session has no automatic preset switch",
    );
    assert.ok((await list()).profiles["preset-fixture/target"]);
    assert.equal((await list()).sequence, 1);
    await assert.rejects(
      retained.execute(
        "stale",
        { model: "across sessions", expected_sequence: 1 },
        undefined,
        undefined,
        oldCtx,
      ),
      /stale/i,
    );
    await assert.rejects(
      execute("mh_delete_model_profile", {
        model: "across sessions",
        expected_sequence: 0,
      }),
      /expected_sequence/,
    );
    await assert.rejects(
      execute("mh_delete_model_profile", {
        model: "missing",
        expected_sequence: 1,
      }),
      /missing/,
    );
    await assert.rejects(
      execute(
        "mh_list_model_profiles",
        {},
        { ...ctx, sessionManager: { getSessionId: () => session.sessionId } },
      ),
    );
    let release;
    confirm = async () => new Promise((r) => (release = r));
    const pending = execute("mh_delete_model_profile", {
      model: "across sessions",
      expected_sequence: 1,
    });
    while (!release) await new Promise((r) => setTimeout(r, 1));
    const changed = JSON.parse(bytes);
    changed.sequence++;
    fs.writeFileSync(file, JSON.stringify(changed), { mode: 0o600 });
    release(true);
    await assert.rejects(pending, /Stale/);
    fs.writeFileSync(file, bytes);
    confirm = async () => true;
    for (const permission of [
      { ...grants(), "mh_*": "allow" },
      { ...grants(), "model_profiles_state_*": "allow" },
      { ...grants(), path_read: { [root]: "deny" } },
    ]) {
      grant(permission);
      await assert.rejects(list());
    }
    grant(grants());
    fs.unlinkSync(modelConfig);
    await assert.rejects(list(), /disabled/);
    configure("model-profiles");
    await execute("bash", { command: "ls safe.txt" });
    assert.equal(fs.existsSync(marker), false, "RTK off spawns no helper");
    await command("/mh-rtk mode suggest 0");
    assert.ok(
      notices.every((n) => n[1] !== "error"),
      JSON.stringify(notices),
    );
    await execute("bash", { command: "ls safe.txt" });
    assert.equal(fs.existsSync(marker), false, "suggest executes raw only");
    await command("/mh-rtk mode rewrite-safe 1");
    assert.ok(
      notices.every((n) => n[1] !== "error"),
      JSON.stringify(notices),
    );
    assert.match(
      JSON.stringify(await execute("bash", { command: "ls safe.txt" })),
      /FAKE_RTK_ONLY/,
    );
    const spawns = fs.readFileSync(marker);
    grant({ ...grants(), bash: { "*": "deny", "ls *": "allow" } });
    await assert.rejects(
      execute("bash", { command: "ls safe.txt" }),
      /permission/,
    );
    assert.deepEqual(fs.readFileSync(marker), spawns);
    grant(grants());
    for (const command of [
      "cat .env",
      "printenv",
      "git commit -m bad",
      "ls safe.txt; cat .env",
      "ls $(cat .env)",
    ])
      await assert.rejects(execute("bash", { command }));
    assert.deepEqual(fs.readFileSync(marker), spawns);
    let messages;
    faux.setResponses([
      ai.fauxAssistantMessage(
        [
          ai.fauxToolCall("bash", { command: "ls safe.txt" }),
          ai.fauxToolCall("codemode", {
            code: "try { await tools.bash({command:'cat .env'}); text('WRONG'); } catch(e) { text('NESTED_DENIED'); }",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      (c) => {
        messages = c.messages;
        return ai.fauxAssistantMessage("Offline fixture complete");
      },
    ]);
    await session.prompt("Offline direct and nested final RTK check");
    assert.match(
      JSON.stringify(messages.filter((m) => m.role === "toolResult")),
      /NESTED_DENIED/,
    );
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      execute("bash", { command: "ls safe.txt" }, ctx, abort.signal),
    );
    await command("/mh-rtk mode off 2");
    const off = fs.readFileSync(marker);
    await execute("bash", { command: "ls safe.txt" });
    assert.deepEqual(fs.readFileSync(marker), off);
    for (let i = 0; i < untouched.length; i++)
      assert.deepEqual(
        fs.readFileSync(path.join(agentDir, untouched[i])),
        before[i],
      );
    assert.equal(external, 0);
  } finally {
    await shutdown();
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [
      ["PI_CODING_AGENT_DIR", previous.agent],
      ["PATH", previous.path],
      ["BASH_ENV", previous.bash],
      ["HOME", previous.home],
      ["XDG_CONFIG_HOME", previous.xdg],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
