// Executed only from disposable canonical-root source stages by goal-patch-test.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as sdk from "@earendil-works/pi-coding-agent";
import * as ai from "@earendil-works/pi-ai";
import { trustedGoalTool, goalToolNames } from "../provenance.mjs";

const adapter = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ),
  primary = path.resolve(adapter, "../..");
const stagedRoot = path.resolve(adapter, "../../..");
const patched = process.env.GOAL_EXPECT_OWNER === "patched";
const sha = (value) => createHash("sha256").update(value).digest("hex");

test(`native Goal actual public SDK/Faux and ${patched ? "patched" : "old"} owner`, async () => {
  assert.match(
    stagedRoot,
    /\.agent-state\/runtime\/pi-ownership-repair\//,
    "fixture only, never real profile or installed sources",
  );
  const cwd = path.join(stagedRoot, "project"),
    agentDir = path.join(stagedRoot, "profile");
  for (const dir of [cwd, agentDir]) fs.mkdirSync(dir, { mode: 0o700 });
  const saved = {
    agent: process.env.PI_CODING_AGENT_DIR,
    fetch: globalThis.fetch,
  };
  process.env.PI_CODING_AGENT_DIR = agentDir;
  let requests = 0;
  globalThis.fetch = () => {
    requests++;
    throw Error("External requests prohibited");
  };
  const root = path.join(agentDir, "workflow/goals", sha(cwd)),
    capability = `goal_state_${sha(root)}`;
  const config = path.join(
      agentDir,
      "extensions/pi-permission-system/config.json",
    ),
    goalConfig = path.join(agentDir, "extensions/mahiro-goal/config.json");
  for (const file of [config, goalConfig])
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const goalConfigBytes = JSON.stringify({
    version: 1,
    profile: agentDir,
    projects: [cwd],
  });
  fs.writeFileSync(goalConfig, goalConfigBytes, { mode: 0o600 });
  const rules = () =>
    Object.fromEntries(
      [...goalToolNames, capability, "codemode"].map((name) => [name, "allow"]),
    );
  const grant = (permission = rules(), yoloMode = false) =>
    fs.writeFileSync(
      config,
      JSON.stringify({
        authorizerChain: [],
        yoloMode,
        permission: { "*": "deny", ...permission },
      }),
      { mode: 0o600 },
    );
  grant();
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      defaultTools: ["+codemode"],
      skills: [],
      prompts: [],
      themes: [],
      cacheWarming: "off",
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
    { mode: 0o600 },
  );
  const permissions = fs.realpathSync(
    path.join(adapter, "node_modules/@gotgenes/pi-permission-system"),
  );
  const settings = sdk.SettingsManager.create(cwd, agentDir);
  settings.setPackages([
    permissions,
    adapter,
    {
      source: primary,
      extensions: ["extensions/mahiro-goal.ts"],
      skills: [],
      prompts: [],
      themes: [],
    },
  ]);
  const runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const faux = ai.fauxProvider({
    provider: "openai",
    models: [{ id: "goal-offline-fixture", input: ["text", "image"] }],
  });
  runtime.registerNativeProvider(faux.provider);
  let ctx, tools, definition, node, session, service;
  const defs = new Map();
  const observer = path.join(stagedRoot, "goal-observer.ts");
  fs.symlinkSync(
    path.join(adapter, "node_modules"),
    path.join(stagedRoot, "node_modules"),
    "dir",
  );
  fs.writeFileSync(
    observer,
    `import {getPermissionsService} from '@gotgenes/pi-permission-system'; export default pi=>{pi.on('session_start',(_e,ctx)=>pi.events.emit('fixture:goal-context',{ctx,tools:pi.getAllTools(),service:()=>getPermissionsService(ctx.sessionManager.getSessionId())}));};`,
  );
  const loader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: settings,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    disabledBuiltinExtensions: ["mcp"],
    additionalExtensionPaths: [observer],
    extensionFactories: [
      sdk.createCodemodeExtension(),
      (pi) => {
        pi.events.on("fixture:goal-context", (value) => {
          ctx = value.ctx;
          tools = value.tools;
          service = value.service;
        });
      },
    ],
  });
  let confirm = async () => false,
    notices = [];
  try {
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    for (const extension of loader.getExtensions().extensions) {
      for (const item of extension.tools.values())
        defs.set(item.definition.name, item.definition);
    }
    definition = defs.get("mh_create_goal");
    assert.ok(definition);
    assert.equal(
      fs.existsSync(root),
      false,
      "import/registration reads or writes no Goal state",
    );
    const result = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager: settings,
      resourceLoader: loader,
      modelRuntime: runtime,
      model: faux.getModel(),
      sessionManager: sdk.SessionManager.create(
        cwd,
        path.join(stagedRoot, "sessions"),
      ),
    });
    session = result.session;
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
    service = service();
    node = globalThis[Symbol.for("@mahirocoko/pi-guards:healthy-nodes")].get(
      session.sessionId,
    );
    assert.ok(node.healthy());
    assert.equal(node.goal.version, 1);
    const execute = (name, args = {}, context = ctx, signal) =>
      defs.get(name).execute("fixture", args, signal, undefined, context);
    const read = async () => (await execute("mh_get_goal")).details;
    const statePath = path.join(root, "state.json"),
      state = () => JSON.parse(fs.readFileSync(statePath));
    const current = () => Object.values(state().goals)[0];
    const create = {
      objective: "Offline SDK fixture",
      criteria: [
        { text: "agent test", owner: "agent" },
        { text: "human confirmation", owner: "human" },
      ],
    };
    if (!patched) {
      await assert.rejects(read(), /attestation/);
      await assert.rejects(execute("mh_create_goal", create));
      let messages;
      faux.setResponses([
        ai.fauxAssistantMessage(
          [
            ai.fauxToolCall("mh_get_goal", {}),
            ai.fauxToolCall("codemode", {
              code: "try { text(await tools.mh_get_goal({})); } catch(e) { text('OLD_OWNER_NESTED_DENIED'); }",
            }),
          ],
          { stopReason: "toolUse" },
        ),
        (context) => {
          messages = context.messages;
          return ai.fauxAssistantMessage("Old owner offline denial");
        },
      ]);
      await session.prompt("Synthetic old-owner Goal denial only");
      const results = messages.filter((m) => m.role === "toolResult").slice(-2);
      assert.equal(
        results.find((m) => m.toolName === "mh_get_goal").isError,
        true,
      );
      assert.match(
        JSON.stringify(results.find((m) => m.toolName === "codemode")),
        /OLD_OWNER_NESTED_DENIED/,
      );
      assert.equal(fs.existsSync(root), false);
      assert.equal(requests, 0);
      return;
    }
    assert.equal((await read()).goal, null);
    assert.equal(
      fs.existsSync(root),
      false,
      "authorized read never initializes",
    );
    fs.unlinkSync(goalConfig);
    await assert.rejects(read(), /disabled/);
    assert.equal(fs.existsSync(root), false);
    fs.writeFileSync(goalConfig, goalConfigBytes, { mode: 0o600 });
    let targetConfirmations = 0;
    confirm = async () => {
      targetConfirmations++;
      return true;
    };
    await session.prompt("/mh-goal clear NONEXISTENT-GOAL-ID 1");
    assert.equal(
      fs.existsSync(root),
      false,
      "unknown explicit ID on empty state never initializes",
    );
    assert.equal(targetConfirmations, 0, "missing ID rejects before UI");
    await read();
    await execute("mh_create_goal", create);
    assert.equal(current().revision, 1);
    const firstId = current().id;
    const originalTargetBytes = fs.readFileSync(statePath);
    await session.prompt("/mh-goal clear NONEXISTENT-GOAL-ID 1");
    await session.prompt(`/mh-goal clear ${firstId} 2`);
    assert.equal(targetConfirmations, 0);
    assert.deepEqual(fs.readFileSync(statePath), originalTargetBytes);
    for (const goal_id of [
      "NONEXISTENT-GOAL-ID",
      "",
      " ",
      undefined,
      null,
      "__proto__",
    ]) {
      await read();
      await assert.rejects(
        execute("mh_clear_goal", { goal_id, expected_revision: 1 }),
      );
      await assert.rejects(execute("mh_get_goal", { goal_id }));
      await assert.rejects(
        execute("mh_update_goal", {
          goal_id,
          action: "set_phase",
          phase: "wrong target",
          expected_revision: 1,
        }),
      );
      await assert.rejects(
        execute("mh_update_goal", {
          goal_id,
          action: "move_goal",
          expected_revision: 1,
        }),
      );
      assert.deepEqual(fs.readFileSync(statePath), originalTargetBytes);
    }
    assert.equal(targetConfirmations, 0);
    confirm = async () => false;
    const realTool = tools.find((t) => t.name === "mh_get_goal");
    for (const candidate of [
      { ...realTool, name: "mh_goal_alias" },
      { ...realTool, sourceInfo: undefined },
      {
        ...realTool,
        sourceInfo: { ...realTool.sourceInfo, origin: "top-level" },
      },
      { ...realTool, sourceInfo: { ...realTool.sourceInfo, path: "<inline>" } },
      {
        ...realTool,
        sourceInfo: { ...realTool.sourceInfo, baseDir: stagedRoot },
      },
    ])
      assert.equal(trustedGoalTool(candidate), false);
    assert.equal(trustedGoalTool(realTool), true);
    for (const surface of [...goalToolNames, capability])
      assert.equal(service.checkPermission(surface).matchedSurface, surface);
    const manifestPath = path.join(primary, "package.json"),
      manifestBytes = fs.readFileSync(manifestPath),
      manifest = JSON.parse(manifestBytes);
    try {
      for (const change of [
        { version: "0.2.1" },
        { name: "@foreign/copy" },
        { pi: { extensions: [] } },
        { pi: { extensions: ["extensions/mahiro-goal.ts"] } },
      ]) {
        fs.writeFileSync(
          manifestPath,
          JSON.stringify({ ...manifest, ...change }),
        );
        assert.equal(trustedGoalTool(realTool), false);
        await assert.rejects(read());
      }
    } finally {
      fs.writeFileSync(manifestPath, manifestBytes);
    }
    const alias = path.join(primary, "extensions/goal-alias.ts");
    fs.symlinkSync(path.join(primary, "extensions/mahiro-goal.ts"), alias);
    assert.equal(
      trustedGoalTool({
        ...realTool,
        sourceInfo: { ...realTool.sourceInfo, path: alias },
      }),
      false,
    );
    const copied = path.join(stagedRoot, "copied-pi");
    fs.cpSync(primary, copied, { recursive: true });
    assert.equal(
      trustedGoalTool({
        ...realTool,
        sourceInfo: {
          ...realTool.sourceInfo,
          baseDir: copied,
          path: path.join(copied, "extensions/mahiro-goal.ts"),
        },
      }),
      false,
    );
    assert.throws(() =>
      node.goal.assertAccess(
        realTool,
        { ...ctx, sessionManager: { getSessionId: () => session.sessionId } },
        root,
      ),
    );
    assert.throws(() =>
      node.goal.assertAccess(realTool, ctx, `${root}/foreign`),
    );
    const deniedDispatch = async () => {
      let transcript;
      faux.setResponses([
        ai.fauxAssistantMessage(
          [
            ai.fauxToolCall("mh_get_goal", {}),
            ai.fauxToolCall("codemode", {
              code: "try { text(await tools.mh_get_goal({})); } catch(e) { text('NESTED_GOAL_DENIED'); }",
            }),
          ],
          { stopReason: "toolUse" },
        ),
        (context) => {
          transcript = context.messages;
          return ai.fauxAssistantMessage("Offline denied fixture");
        },
      ]);
      await session.prompt("Synthetic denied Goal dispatch only");
      const results = transcript
        .filter((m) => m.role === "toolResult")
        .slice(-2);
      assert.equal(
        results.find((m) => m.toolName === "mh_get_goal").isError,
        true,
      );
      assert.match(
        JSON.stringify(results.find((m) => m.toolName === "codemode")),
        /NESTED_GOAL_DENIED/,
      );
    };
    for (const permission of [
      { mh_get_goal: "allow" },
      { [capability]: "allow" },
      { mh_get_goal: "allow", managed_memory_fake: "allow" },
      { "mh_*": "allow", [capability]: "allow" },
      { mh_get_goal: "allow", "goal_state_*": "allow" },
      { ...rules(), "mh_*": "allow" },
      { ...rules(), "goal_state_*": "allow" },
    ]) {
      grant({ codemode: "allow", ...permission });
      await assert.rejects(read(), /exact named/);
      await deniedDispatch();
    }
    grant({ codemode: "allow", mh_get_goal: "ask", [capability]: "ask" }, true);
    await assert.rejects(read(), /exact named/);
    await deniedDispatch();
    grant();
    // Negative-only malformed public metadata, never a forged positive grant.
    const actualCheck = service.checkPermission;
    try {
      service.checkPermission = function (...args) {
        const { matchedSurface, ...decision } = actualCheck.apply(this, args);
        return decision;
      };
      await assert.rejects(read(), /attestation/);
      await deniedDispatch();
    } finally {
      service.checkPermission = actualCheck;
    }
    // The actual last winning rule, not the existence of another exact allow, owns authority.
    grant({ "mh_*": "allow", "goal_state_*": "allow", ...rules() });
    await read();
    grant({ ...rules(), mh_get_goal: "deny" });
    await assert.rejects(read());
    grant();
    const header = ctx.sessionManager.getHeader.bind(ctx.sessionManager);
    // Negative-only public manager header mutation: no forged successful authority.
    const originalHeader = ctx.sessionManager.getHeader;
    ctx.sessionManager.getHeader = () => ({
      ...header(),
      parentSession: "human-fork-or-native-child",
    });
    await assert.rejects(read(), /unavailable/);
    ctx.sessionManager.getHeader = originalHeader;
    globalThis[
      Symbol.for("@mahirocoko/pi-guards:healthy-nodes")
    ].nativeChildren.add(session.sessionId);
    await assert.rejects(read());
    globalThis[
      Symbol.for("@mahirocoko/pi-guards:healthy-nodes")
    ].nativeChildren.delete(session.sessionId);
    await read();
    await assert.rejects(
      execute(
        "mh_update_goal",
        { action: "set_phase", phase: "cancelled", expected_revision: 1 },
        ctx,
        AbortSignal.abort(),
      ),
    );
    assert.equal(current().revision, 1);
    await assert.rejects(
      execute(
        "mh_clear_goal",
        { expected_revision: 1 },
        { ...ctx, hasUI: false },
      ),
      /no UI/,
    );
    assert.equal(current().revision, 1);
    await assert.rejects(
      execute("mh_clear_goal", { expected_revision: 1 }),
      /declined/,
    );
    let release, seen;
    confirm = async (_title, message) => {
      seen = message;
      return new Promise((resolve) => (release = resolve));
    };
    const clearing = execute("mh_clear_goal", { expected_revision: 1 });
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.match(seen, new RegExp(firstId));
    assert.match(seen, /revision 1/);
    await read();
    await execute("mh_update_goal", {
      action: "set_phase",
      expected_revision: 1,
      phase: "concurrent update during approval",
    });
    const afterUpdate = fs.readFileSync(statePath);
    release(true);
    await assert.rejects(clearing, /Stale/);
    assert.deepEqual(fs.readFileSync(statePath), afterUpdate);
    confirm = async () => true;
    // Actual public command dispatch, not a caller-provided actor boolean.
    const usersBeforeCommand = session.messages.filter(
      (m) => m.role === "user",
    ).length;
    await session.prompt(
      "/mh-goal verify criterion-02 public-fixture-confirmation",
    );
    assert.equal(
      session.messages.filter((m) => m.role === "user").length,
      usersBeforeCommand,
    );
    assert.equal(current().criteria[1].status, "verified");
    assert.equal(current().revision, 3);
    const requestsBefore = requests;
    let messages;
    faux.setResponses([
      ai.fauxAssistantMessage(
        [
          ai.fauxToolCall("mh_get_goal", {}),
          ai.fauxToolCall("codemode", {
            code: "const g=await tools.mh_get_goal({}); text(await tools.mh_update_goal({action:'set_next',next_action:'nested offline checkpoint',expected_revision:3}));",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        messages = context.messages;
        return ai.fauxAssistantMessage("Offline only");
      },
    ]);
    const input = "Unchanged fixture user text <goal> is data",
      image = {
        type: "image",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
        mimeType: "image/png",
      };
    await session.prompt(input, { images: [image] });
    assert.equal(current().revision, 4);
    assert.equal(current().nextAction, "nested offline checkpoint");
    const results = messages.filter((m) => m.role === "toolResult").slice(-2);
    assert.equal(
      results.filter((m) => m.isError).length,
      0,
      JSON.stringify(results),
    );
    const userMessages = messages.filter((m) => m.role === "user");
    assert.equal(
      userMessages.length,
      usersBeforeCommand + 1,
      "human command fabricated no user episode",
    );
    const user = userMessages.at(-1);
    assert.equal(user.content.find((c) => c.type === "text").text, input);
    assert.deepEqual(
      user.content.find((c) => c.type === "image"),
      image,
    );
    assert.match(
      JSON.stringify(messages.filter((m) => m.role === "system")),
      /mahiro_workflow_goal/,
    );
    assert.equal(requests, requestsBefore);
    await read();
    const oldNode = node;
    globalThis[Symbol.for("@mahirocoko/pi-guards:healthy-nodes")].set(
      session.sessionId,
      { ...node, generation: {} },
    );
    await assert.rejects(
      execute("mh_update_goal", {
        action: "set_phase",
        expected_revision: 4,
        phase: "stale",
      }),
    );
    globalThis[Symbol.for("@mahirocoko/pi-guards:healthy-nodes")].set(
      session.sessionId,
      oldNode,
    );
    await read();
    await execute("mh_clear_goal", { expected_revision: 4 });
    await read();
    await execute("mh_create_goal", create);
    assert.notEqual(current().id, firstId);
    assert.equal(current().revision, 1);
    await assert.rejects(
      execute("mh_clear_goal", { expected_revision: 1 }),
      /Read mh_get_goal/,
    );
    await read();
    grant({ ...rules(), path_write: { [statePath]: "deny" } });
    await assert.rejects(
      execute("mh_update_goal", {
        action: "set_phase",
        phase: "denied",
        expected_revision: 1,
      }),
      /path denied/,
    );
    grant();
    assert.equal(current().revision, 1);
    assert.equal(requests, 0);
    // Revocation while approval waits must prevent a write without changing state.
    await read();
    let revokeResolve;
    confirm = async () => new Promise((resolve) => (revokeResolve = resolve));
    const revokeClear = execute("mh_clear_goal", {
      expected_revision: current().revision,
    });
    while (!revokeResolve)
      await new Promise((resolve) => setTimeout(resolve, 1));
    const beforeRevocation = fs.readFileSync(statePath);
    grant({ ...rules(), [capability]: "deny" });
    revokeResolve(true);
    await assert.rejects(revokeClear, /exact named/);
    assert.deepEqual(fs.readFileSync(statePath), beforeRevocation);
    grant();
    // Actual command human verification reacquires CAS after its own confirmation.
    let commandResolve;
    confirm = async () => new Promise((resolve) => (commandResolve = resolve));
    const verifying = session.prompt(
      "/mh-goal verify criterion-02 stale-confirmation",
    );
    while (!commandResolve)
      await new Promise((resolve) => setTimeout(resolve, 1));
    await read();
    await execute("mh_update_goal", {
      action: "set_phase",
      phase: "command confirmation raced",
      expected_revision: current().revision,
    });
    const afterCommandRace = fs.readFileSync(statePath);
    commandResolve(true);
    await verifying;
    assert.deepEqual(fs.readFileSync(statePath), afterCommandRace);
    assert.equal(current().criteria[1].status, "pending");
    // Public lifecycle events invalidate both read tickets and in-flight approvals.
    const navigationEvents = [
      {
        type: "session_before_switch",
        reason: "resume",
        targetSessionFile: path.join(stagedRoot, "other-session.jsonl"),
      },
      {
        type: "session_before_fork",
        entryId: session.sessionManager.getLeafId(),
        position: "at",
      },
      {
        type: "session_before_tree",
        preparation: {
          targetId: session.sessionManager.getLeafId(),
          oldLeafId: session.sessionManager.getLeafId(),
          commonAncestorId: null,
          entriesToSummarize: [],
          userWantsSummary: false,
        },
        signal: new AbortController().signal,
      },
    ];
    for (const event of navigationEvents) {
      await read();
      const bytes = fs.readFileSync(statePath);
      await session.extensionRunner.emit(event);
      await assert.rejects(
        execute("mh_update_goal", {
          action: "set_phase",
          phase: "stale navigation",
          expected_revision: current().revision,
        }),
        /Read mh_get_goal/,
      );
      assert.deepEqual(fs.readFileSync(statePath), bytes);
    }
    session.sessionManager.resetLeaf();
    assert.equal(
      (await read()).goal.id,
      current().id,
      "branch reset never rewinds canonical Goal",
    );
    let pendingResolve;
    confirm = async () => new Promise((resolve) => (pendingResolve = resolve));
    const pendingClear = execute("mh_clear_goal", {
      expected_revision: current().revision,
    });
    while (!pendingResolve)
      await new Promise((resolve) => setTimeout(resolve, 1));
    const beforeNavigation = fs.readFileSync(statePath);
    await session.extensionRunner.emit(navigationEvents[1]);
    pendingResolve(true);
    await assert.rejects(pendingClear, /context|cancelled/);
    assert.deepEqual(fs.readFileSync(statePath), beforeNavigation);
    // Owned prompt-section replacement preserves actual supplied Core/context and attachments.
    const core =
      "PRIVATE FIXTURE CORE — byte-preserved, not real maintained memory";
    const trigger = { messageType: "user", prompt: input, images: [image] };
    const basePrompt = {
      cwd,
      customPrompt: "FIXTURE PRIMARY SYSTEM",
      contextFiles: [
        { path: path.join(agentDir, "memory/Core.md"), content: core },
      ],
      sections: {
        fixture_other_owner: "EXACT OTHER SECTION",
        mahiro_workflow_goal: "STALE OWNED GOAL",
      },
    };
    const triggerBytes = JSON.stringify(trigger),
      coreBytes = JSON.stringify(basePrompt.contextFiles);
    const reminder = async (expectGoal) => {
      const result = await session.extensionRunner.emitBeforeAgentStart(
        trigger,
        structuredClone(basePrompt),
      );
      assert.equal(
        !!result.systemPromptOptions.sections.mahiro_workflow_goal,
        expectGoal,
      );
      assert.equal(
        result.systemPromptOptions.sections.fixture_other_owner,
        "EXACT OTHER SECTION",
      );
      assert.equal(
        result.systemPromptOptions.customPrompt,
        basePrompt.customPrompt,
      );
      assert.equal(
        JSON.stringify(result.systemPromptOptions.contextFiles),
        coreBytes,
      );
      assert.equal(JSON.stringify(trigger), triggerBytes);
      assert.equal(result.messages.length, 0);
      if (expectGoal)
        assert.ok(
          result.systemPromptOptions.sections.mahiro_workflow_goal.length <=
            6000,
        );
    };
    await reminder(true);
    fs.unlinkSync(goalConfig);
    await reminder(false);
    fs.writeFileSync(goalConfig, goalConfigBytes, { mode: 0o600 });
    grant({ codemode: "allow" });
    await reminder(false);
    grant();
    const nativeChildren =
      globalThis[Symbol.for("@mahirocoko/pi-guards:healthy-nodes")]
        .nativeChildren;
    nativeChildren.add(session.sessionId);
    await reminder(false);
    nativeChildren.delete(session.sessionId);
    confirm = async () => true;
    await session.prompt("/mh-goal pause");
    await reminder(false);
    await session.prompt("/mh-goal resume");
    await reminder(true);
    // Human override requires a public confirmation; ordinary agent edits do not.
    confirm = async () => false;
    const beforeDecline = fs.readFileSync(statePath);
    await session.prompt("/mh-goal complete --force");
    assert.deepEqual(fs.readFileSync(statePath), beforeDecline);
    let confirmations = 0;
    confirm = async () => {
      confirmations++;
      return true;
    };
    await read();
    await execute("mh_update_goal", {
      action: "set_phase",
      phase: "ordinary agent",
      expected_revision: current().revision,
    });
    assert.equal(confirmations, 0);
    await read();
    await assert.rejects(
      execute("mh_update_goal", {
        action: "complete",
        expected_revision: current().revision,
      }),
      /cannot complete/,
    );
    assert.equal(confirmations, 0);
    await session.prompt("/mh-goal complete --force");
    assert.equal(confirmations, 1);
    assert.equal(current().status, "complete");
    await read();
    await assert.rejects(
      execute("mh_update_goal", {
        action: "set_phase",
        phase: "completed edit",
        expected_revision: current().revision,
      }),
      /complete/,
    );
    await read();
    await execute("mh_update_goal", {
      action: "revise_mission",
      objective: "Explicit fixture reopen",
      expected_revision: current().revision,
    });
    assert.equal(current().status, "active");
    await read();
    await execute("mh_update_goal", {
      action: "add_evidence",
      criterion_id: "criterion-01",
      summary: "actual offline SDK evidence",
      kind: "test",
      expected_revision: current().revision,
    });
    await read();
    await execute("mh_update_goal", {
      action: "claim_criterion",
      criterion_id: "criterion-01",
      expected_revision: current().revision,
    });
    await session.prompt(
      "/mh-goal verify criterion-02 explicit-confirmed-gate",
    );
    const confirmedBeforeAgentCompletion = confirmations;
    await read();
    await execute("mh_update_goal", {
      action: "complete",
      expected_revision: current().revision,
    });
    assert.equal(current().status, "complete");
    assert.equal(
      confirmations,
      confirmedBeforeAgentCompletion,
      "audited agent completion has no new human approval",
    );
    await read();
    await execute("mh_update_goal", {
      action: "revise_mission",
      phase: "explicit next plan",
      expected_revision: current().revision,
    });
    const sourceGoal = structuredClone(current()),
      sourceSession = session.sessionId;
    // New session + fresh loader: no implicit copy. Explicit move preserves ID/history/revision.
    await session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "new",
    });
    session.dispose();
    session = undefined;
    const secondLoader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: settings,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      disabledBuiltinExtensions: ["mcp"],
      additionalExtensionPaths: [observer],
      extensionFactories: [
        (pi) =>
          pi.events.on("fixture:goal-context", (value) => {
            ctx = value.ctx;
            tools = value.tools;
            service = value.service;
          }),
      ],
    });
    await secondLoader.reload();
    assert.deepEqual(secondLoader.getExtensions().errors, []);
    defs.clear();
    for (const extension of secondLoader.getExtensions().extensions)
      for (const item of extension.tools.values())
        defs.set(item.definition.name, item.definition);
    ({ session } = await sdk.createAgentSession({
      cwd,
      agentDir,
      settingsManager: settings,
      resourceLoader: secondLoader,
      modelRuntime: runtime,
      model: faux.getModel(),
      sessionManager: sdk.SessionManager.create(
        cwd,
        path.join(stagedRoot, "sessions"),
      ),
    }));
    await session.bindExtensions({
      mode: "rpc",
      uiContext: {
        confirm: (...args) => confirm(...args),
        notify() {},
        setStatus() {},
        setWidget() {},
        setWorkingMessage() {},
      },
    });
    assert.equal((await read()).goal, null);
    assert.equal(current().id, sourceGoal.id);
    await execute("mh_update_goal", {
      action: "move_goal",
      goal_id: sourceGoal.id,
      expected_revision: sourceGoal.revision,
    });
    assert.equal(current().id, sourceGoal.id);
    assert.equal(current().revision, sourceGoal.revision + 1);
    assert.equal(current().sessionId, session.sessionId);
    assert.equal(state().sessions[sourceSession], undefined);
    // Recreate-at-revision-1 and reassignment while a real command UI waits must
    // preserve the new state, not delete a new current Goal or a moved target.
    let targetRelease, targetLabel;
    confirm = async (_title, message) => {
      targetLabel = message;
      return new Promise((resolve) => (targetRelease = resolve));
    };
    const movedId = current().id,
      movedRevision = current().revision;
    const pendingTarget = session.prompt(
      `/mh-goal clear ${movedId} ${movedRevision}`,
    );
    while (!targetRelease)
      await new Promise((resolve) => setTimeout(resolve, 1));
    assert.match(targetLabel, new RegExp(movedId));
    assert.match(targetLabel, new RegExp(`revision ${movedRevision}`));
    assert.match(targetLabel, new RegExp(session.sessionId));
    assert.doesNotMatch(targetLabel, /empty session/);
    // Fixture-only concurrent domain transaction, retaining real permission-owner
    // authorization and exact store CAS; no fake successful authority.
    const { transactGoal, readGoalState, stateTicket, resolveGoalBinding } =
      await import(path.join(primary, "lib/goal/store.ts"));
    const { applyGoal } = await import(path.join(primary, "lib/goal/model.ts"));
    const binding = resolveGoalBinding(cwd);
    binding.sessionId = session.sessionId;
    const access = async () =>
      node.goal.authorize(
        tools.find((t) => t.name === "mh_clear_goal"),
        ctx,
        root,
        "write",
      );
    const assertAccess = () =>
      node.goal.assertAccess(
        tools.find((t) => t.name === "mh_clear_goal"),
        ctx,
        root,
        "write",
      );
    // 'node' belongs to the previous session above: use the current registered node.
    node = globalThis[Symbol.for("@mahirocoko/pi-guards:healthy-nodes")].get(
      session.sessionId,
    );
    await transactGoal(
      binding,
      stateTicket(readGoalState(binding)),
      access,
      (draft) => {
        applyGoal(draft, binding, "clear", {
          goal_id: movedId,
          expected_revision: movedRevision,
        });
        return applyGoal(draft, binding, "create", create);
      },
      assertAccess,
    );
    const recreatedBytes = fs.readFileSync(statePath),
      recreatedId = current().id;
    assert.notEqual(recreatedId, movedId);
    assert.equal(current().revision, 1);
    targetRelease(true);
    await pendingTarget;
    assert.deepEqual(fs.readFileSync(statePath), recreatedBytes);
    // A second assigned Goal at the same revision is never selected accidentally.
    const otherScope = { ...binding, sessionId: sourceSession };
    await transactGoal(
      binding,
      stateTicket(readGoalState(binding)),
      access,
      (draft) => applyGoal(draft, otherScope, "create", create),
      assertAccess,
    );
    const otherId = state().sessions[sourceSession];
    targetRelease = undefined;
    const pendingAssignment = session.prompt(`/mh-goal clear ${recreatedId} 1`);
    while (!targetRelease)
      await new Promise((resolve) => setTimeout(resolve, 1));
    await transactGoal(
      binding,
      stateTicket(readGoalState(binding)),
      access,
      (draft) => {
        const left = draft.goals[recreatedId],
          right = draft.goals[otherId];
        left.sessionId = sourceSession;
        right.sessionId = binding.sessionId;
        draft.sessions[sourceSession] = left.id;
        draft.sessions[binding.sessionId] = right.id;
        return left;
      },
      assertAccess,
    );
    const reassignedBytes = fs.readFileSync(statePath);
    targetRelease(true);
    await pendingAssignment;
    assert.deepEqual(fs.readFileSync(statePath), reassignedBytes);
    const unaffected = structuredClone(state().goals[otherId]);
    confirm = async (_title, message) => {
      targetLabel = message;
      return true;
    };
    await session.prompt(`/mh-goal clear ${recreatedId} 1`);
    assert.match(targetLabel, new RegExp(recreatedId));
    assert.match(targetLabel, /revision 1/);
    console.log(
      "EXACT_TARGET_HUMAN_PROOF",
      JSON.stringify({
        requestedId: recreatedId,
        revision: 1,
        confirmation: targetLabel,
        unrelatedCurrentId: otherId,
      }),
    );
    assert.equal(state().goals[recreatedId], undefined);
    assert.deepEqual(state().goals[otherId], unaffected);
    assert.equal(state().sessions[binding.sessionId], otherId);
    await session.prompt("/mh-goal clear");
    assert.deepEqual(state().goals, {});
    assert.deepEqual(state().sessions, {});
    assert.equal(requests, 0);
    fs.writeFileSync(
      path.join(stagedRoot, "goal-receipt.json"),
      JSON.stringify(
        {
          actualPublicSDK: true,
          patchedOwner: true,
          liveInstalledPatch: false,
          requests,
          staleApprovalProductionStore: "no write",
          directNestedAndExecute: true,
          defaultDisabled: true,
          humanCommandPublicUI: true,
          originalLettaUnmodified: true,
        },
        null,
        2,
      ),
    );
  } finally {
    // Public lifecycle must precede disposal so permission-owner UI forwarding
    // polling and every registered extension disposer are shut down, even on a failed assertion.
    try {
      if (session)
        await session.extensionRunner.emit({
          type: "session_shutdown",
          reason: "quit",
        });
    } finally {
      session?.dispose();
      globalThis.fetch = saved.fetch;
    }
    if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved.agent;
  }
});
