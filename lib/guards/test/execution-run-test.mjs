// Executed only from disposable canonical-root source stages by execution-run-patch-test.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import * as sdk from "@earendil-works/pi-coding-agent";
import * as ai from "@earendil-works/pi-ai";
import { trustedExecutionRunTool } from "../provenance.mjs";

const adapter = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ),
  primary = path.resolve(adapter, "../..");
const stagedRoot = path.resolve(adapter, "../../..");
const patched = process.env.RUN_EXPECT_OWNER === "patched";
const sha = (value) => createHash("sha256").update(value).digest("hex");

test(`native ExecutionRun actual public SDK/Faux and ${patched ? "patched" : "old"} owner`, async () => {
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
  const root = path.join(agentDir, "workflow/execution-run", sha(cwd)),
    capability = `execution_run_state_${sha(root)}`;
  const config = path.join(
      agentDir,
      "extensions/pi-permission-system/config.json",
    ),
    runConfig = path.join(
      agentDir,
      "extensions/mahiro-execution-run/config.json",
    );
  for (const file of [config, runConfig])
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const runConfigBytes = JSON.stringify({
    version: 1,
    profile: agentDir,
    projects: [cwd],
  });
  fs.writeFileSync(runConfig, runConfigBytes, { mode: 0o600 });
  const rules = () =>
    Object.fromEntries(
      ["mh_execution_run", capability, "codemode"].map((name) => [
        name,
        "allow",
      ]),
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
  const untouched = [
    path.join(cwd, "opaque-artifact.txt"),
    ...["goals", "evidence", "ux-workflow"].map((kind) =>
      path.join(agentDir, "workflow", kind, sha(cwd), "state.json"),
    ),
  ];
  for (const file of untouched) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      file,
      `FROZEN OFFLINE FIXTURE ONLY ${path.basename(path.dirname(file))}`,
      { mode: 0o600 },
    );
  }
  const untouchedBytes = new Map(
    untouched.map((file) => [file, fs.readFileSync(file)]),
  );
  const originalRead = fs.readFileSync,
    originalOpen = fs.openSync;
  let forbiddenArtifactReads = 0;
  const assertNotArtifact = (file) => {
    if (untouched.includes(String(file))) {
      forbiddenArtifactReads++;
      throw Error("Opaque artifact/Goal/Evidence reads prohibited");
    }
  };
  fs.readFileSync = function (file, ...args) {
    assertNotArtifact(file);
    return originalRead.call(this, file, ...args);
  };
  fs.openSync = function (file, ...args) {
    assertNotArtifact(file);
    return originalOpen.call(this, file, ...args);
  };
  syncBuiltinESMExports();
  const settings = sdk.SettingsManager.create(cwd, agentDir);
  settings.setPackages([
    permissions,
    adapter,
    {
      source: primary,
      extensions: ["extensions/mahiro-execution-run.ts"],
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
    models: [{ id: "execution-run-offline-fixture", input: ["text", "image"] }],
  });
  runtime.registerNativeProvider(faux.provider);
  let ctx, tools, definition, node, session, service;
  const defs = new Map();
  const observer = path.join(stagedRoot, "execution-run-observer.ts");
  fs.symlinkSync(
    path.join(adapter, "node_modules"),
    path.join(stagedRoot, "node_modules"),
    "dir",
  );
  fs.writeFileSync(
    observer,
    `import {getPermissionsService} from '@gotgenes/pi-permission-system'; export default pi=>{pi.on('session_start',(_e,ctx)=>pi.events.emit('fixture:execution-run-context',{ctx,tools:pi.getAllTools(),service:()=>getPermissionsService(ctx.sessionManager.getSessionId())}));};`,
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
        pi.events.on("fixture:execution-run-context", (value) => {
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
    definition = defs.get("mh_execution_run");
    assert.ok(definition);
    assert.equal(fs.existsSync(root), false);
    ({ session } = await sdk.createAgentSession({
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
    service = service();
    node = globalThis[Symbol.for("@mahirocoko/pi-guards:healthy-nodes")].get(
      session.sessionId,
    );
    assert.ok(node.healthy());
    assert.equal(node.executionRun.version, 1);
    const execute = (args, context = ctx, signal) =>
      definition.execute("fixture", args, signal, undefined, context);
    const read = async () => (await execute({ operation: "get" })).details;
    const statePath = path.join(root, "state.json"),
      state = () => JSON.parse(fs.readFileSync(statePath)),
      current = () => state().runs[session.sessionId];
    const createArgs = {
      operation: "create",
      summary: "Offline bounded metadata",
      acceptance_criteria: ["caller criterion"],
      non_goals: [],
      protected_contracts: [],
      open_questions: [],
      suggested_checks: ["caller check"],
      targets: [
        {
          id: "t",
          path: "src",
          intent: "fixture",
          worktree_ref: "default",
          access: "write",
          writer_lane_id: "writer",
          reader_lane_ids: ["reader"],
        },
      ],
    };
    const update = async (args) => {
      await read();
      return execute({
        operation: "update",
        expected_run_id: current().id,
        expected_revision: current().revision,
        ...args,
      });
    };
    const dispatch = async (denied = false) => {
      let messages;
      faux.setResponses([
        ai.fauxAssistantMessage(
          [
            ai.fauxToolCall("mh_execution_run", { operation: "get" }),
            ai.fauxToolCall("codemode", {
              code: "try { text(await tools.mh_execution_run({operation:'get'})); } catch(e) { text('NESTED_RUN_DENIED'); }",
            }),
          ],
          { stopReason: "toolUse" },
        ),
        (context) => {
          messages = context.messages;
          return ai.fauxAssistantMessage("Offline metadata only");
        },
      ]);
      await session.prompt("Synthetic offline dispatch only");
      const results = messages.filter((m) => m.role === "toolResult").slice(-2);
      assert.equal(
        !!results.find((m) => m.toolName === "mh_execution_run").isError,
        denied,
      );
      if (denied)
        assert.match(
          JSON.stringify(results.find((m) => m.toolName === "codemode")),
          /NESTED_RUN_DENIED/,
        );
      else assert.doesNotMatch(JSON.stringify(results), /NESTED_RUN_DENIED/);
    };
    if (!patched) {
      await assert.rejects(read(), /attestation/);
      await assert.rejects(execute(createArgs));
      await dispatch(true);
      assert.equal(fs.existsSync(root), false);
      return;
    }
    assert.equal((await read()).run, null);
    assert.equal(fs.existsSync(root), false);
    fs.unlinkSync(runConfig);
    await assert.rejects(read(), /disabled/);
    fs.writeFileSync(runConfig, runConfigBytes, { mode: 0o600 });
    let confirmations = 0;
    confirm = async () => {
      confirmations++;
      return true;
    };
    await read();
    await execute(createArgs);
    await assert.rejects(update({ action: "set_stage", stage: "ready" }));
    await update({
      action: "add_lane",
      lane_id: "writer",
      required: true,
      executor_kind: "pi_subagent",
      role: "implement",
      summary: "metadata",
    });
    await update({
      action: "add_lane",
      lane_id: "reader",
      required: false,
      executor_kind: "human",
      role: "review",
      summary: "not a human receipt",
    });
    await update({ action: "set_goal_refs", goal_refs: [untouched[1]] });
    await update({ action: "set_stage", stage: "ready" });
    await assert.rejects(update({ action: "set_stage", stage: "active" }));
    await assert.rejects(
      update({
        action: "set_lane_sessions",
        lane_id: "writer",
        session_refs: ["letta:agent=fake;conversation=fake"],
      }),
    );
    await update({
      action: "set_lane_sessions",
      lane_id: "writer",
      session_refs: ["pi:session=native-caller-metadata"],
    });
    await update({ action: "set_stage", stage: "active" });
    await update({
      action: "set_lane_status",
      lane_id: "writer",
      status: "active",
    });
    await update({
      action: "set_lane_status",
      lane_id: "reader",
      status: "active",
    });
    await assert.rejects(update({ action: "set_stage", stage: "reported" }));
    for (const lane_id of ["writer", "reader"])
      for (const changed_paths of [
        ["../escape"],
        ["/absolute"],
        ["src/../../escape"],
        ["src\\escape"],
        ["foreign/file"],
        ["src/file"],
      ]) {
        if (lane_id === "writer" && changed_paths[0] === "src/file") continue;
        await assert.rejects(
          update({
            action: "add_report",
            lane_id,
            report_id: "bad",
            status: "reported",
            summary: "claimed passed",
            changed_paths,
          }),
        );
      }
    for (const injected of [
      { actor: "human" },
      { timestamp: "now" },
      { stage: "reported" },
      { other: 1 },
    ])
      await assert.rejects(
        update({ action: "set_goal_refs", goal_refs: ["g"], ...injected }),
      );
    await update({
      action: "add_report",
      lane_id: "writer",
      report_id: "w",
      status: "failed",
      summary: "caller failed, not success",
      changed_paths: ["src/file"],
      checks: ["caller passed"],
    });
    await update({
      action: "add_report",
      lane_id: "reader",
      report_id: "r",
      status: "cancelled",
      summary: "caller cancelled",
      changed_paths: [],
    });
    await update({ action: "set_stage", stage: "reported" });
    await update({
      action: "set_handoff",
      final_handoff: "Ownership metadata only",
      suggested_checks: ["caller check"],
      goal_refs: [untouched[1]],
      included: [],
      exceptions: ["writer", "reader"],
    });
    await update({ action: "set_stage", stage: "handed_off" });
    assert.equal(
      current().handoff.code_evidence_intake.revision,
      current().revision,
    );
    assert.equal(confirmations, 0);
    console.log(
      "CHEAP_FALSIFIER_PASS",
      JSON.stringify({
        actualPublicSDK: true,
        actualPatchedOwner: true,
        writeOwnership: true,
        readLaneDenied: true,
        requiredRefsAndReports: true,
        failedCancelledNotSuccess: true,
        ordinaryMetadataWithoutUI: true,
      }),
    );
    const commandDef = loader
      .getExtensions()
      .extensions.map((e) => e.commands.get("mh-run"))
      .find(Boolean);
    assert.ok(commandDef);
    const command = async (text) => {
      const episodes = JSON.stringify(session.messages);
      await session.prompt(`/mh-run ${text}`);
      assert.equal(JSON.stringify(session.messages), episodes);
    };
    const before = fs.readFileSync(statePath);
    for (const text of [
      "clear mh-run-missing 1",
      `clear ${current().id} 999`,
      `clear ${current().revision} extra`,
      "clear 0",
      "clear 1 2",
      `abandon ${current().revision}`,
      "unlock --force",
    ]) {
      const n = confirmations;
      await command(text);
      assert.equal(confirmations, n);
      assert.deepEqual(fs.readFileSync(statePath), before);
    }
    await commandDef.handler(`clear ${current().revision}`, {
      ...ctx,
      hasUI: false,
    });
    assert.deepEqual(fs.readFileSync(statePath), before);
    assert.match(notices.at(-1)[0], /no UI/);
    confirm = async () => false;
    await command(`clear ${current().revision}`);
    assert.deepEqual(fs.readFileSync(statePath), before);
    const realTool = tools.find((t) => t.name === "mh_execution_run");
    assert.equal(trustedExecutionRunTool(realTool), true);
    for (const candidate of [
      { ...realTool, name: "mh_run_alias" },
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
      assert.equal(trustedExecutionRunTool(candidate), false);
    const manifestPath = path.join(primary, "package.json"),
      manifestBytes = fs.readFileSync(manifestPath),
      manifest = JSON.parse(manifestBytes);
    try {
      for (const change of [
        { version: "0.2.1" },
        { name: "@foreign/copy" },
        { pi: { extensions: [] } },
        { pi: { extensions: ["extensions/mahiro-execution-run.ts"] } },
      ]) {
        fs.writeFileSync(
          manifestPath,
          JSON.stringify({ ...manifest, ...change }),
        );
        assert.equal(trustedExecutionRunTool(realTool), false);
        await assert.rejects(read());
      }
    } finally {
      fs.writeFileSync(manifestPath, manifestBytes);
    }
    for (const [field, value] of [
      ["baseDir", primary + "/../mahiro-pi"],
      ["path", path.join(primary, "extensions/alias.ts")],
    ]) {
      if (field === "path") fs.symlinkSync(realTool.sourceInfo.path, value);
      assert.equal(
        trustedExecutionRunTool({
          ...realTool,
          sourceInfo: { ...realTool.sourceInfo, [field]: value },
        }),
        false,
      );
    }
    const copied = path.join(stagedRoot, "copied-pi");
    fs.cpSync(primary, copied, { recursive: true });
    assert.equal(
      trustedExecutionRunTool({
        ...realTool,
        sourceInfo: {
          ...realTool.sourceInfo,
          baseDir: copied,
          path: path.join(copied, "extensions/mahiro-execution-run.ts"),
        },
      }),
      false,
    );
    let matrixCases = 0;
    for (const permission of [
      { "mh_*": "allow", [capability]: "allow" },
      { ...rules(), "mh_*": "allow" },
      { ...rules(), "execution_run_state_*": "allow" },
      { mh_execution_run: "allow" },
      { [capability]: "allow" },
      {
        managed_memory_fake: "allow",
        goal_state_fake: "allow",
        code_evidence_state_fake: "allow",
        ux_workflow_state_fake: "allow",
      },
      {},
    ]) {
      grant({ codemode: "allow", ...permission });
      await assert.rejects(read());
      await assert.rejects(execute(createArgs));
      await dispatch(true);
      assert.deepEqual(fs.readFileSync(statePath), before);
      matrixCases++;
    }
    grant(
      { mh_execution_run: "ask", [capability]: "ask", codemode: "allow" },
      true,
    );
    await assert.rejects(read());
    await dispatch(true);
    grant();
    const check = service.checkPermission;
    try {
      for (const corrupt of [
        (d) => {
          const { matchedSurface, ...rest } = d;
          return rest;
        },
        (d) => ({ ...d, matchedSurface: [] }),
        (d) => ({ ...d, source: "session" }),
        (d) => ({ ...d, source: "default" }),
        (d) => ({ ...d, toolName: "wrong" }),
      ]) {
        service.checkPermission = function (...args) {
          return corrupt(check.apply(this, args));
        };
        await assert.rejects(read());
      }
    } finally {
      service.checkPermission = check;
    }
    grant({ "mh_*": "allow", "execution_run_state_*": "allow", ...rules() });
    await read();
    grant();
    for (const target of [root, statePath, path.join(root, "state.lock")])
      for (const surface of ["read", "path_read", "path_write"]) {
        grant({ ...rules(), [surface]: { [target]: "deny" } });
        if (surface !== "path_write") await assert.rejects(read());
        else await assert.rejects(execute(createArgs));
        assert.deepEqual(fs.readFileSync(statePath), before);
        grant();
        matrixCases++;
      }
    const registry =
      globalThis[Symbol.for("@mahirocoko/pi-guards:healthy-nodes")];
    for (const replacement of [
      { ...node, generation: {} },
      { ...node, healthy: () => false },
      { ...node, executionRun: { ...node.executionRun, version: 2 } },
      { ...node, executionRun: undefined },
    ]) {
      registry.set(session.sessionId, replacement);
      await assert.rejects(read());
      registry.set(session.sessionId, node);
    }
    assert.throws(() =>
      node.executionRun.assertAccess(
        realTool,
        { ...ctx, sessionManager: { getSessionId: () => session.sessionId } },
        root,
      ),
    );
    assert.throws(() =>
      node.executionRun.assertAccess(realTool, ctx, root + "/other"),
    );
    const header = ctx.sessionManager.getHeader.bind(ctx.sessionManager),
      getHeader = ctx.sessionManager.getHeader;
    ctx.sessionManager.getHeader = () => ({
      ...header(),
      parentSession: "fork",
    });
    await assert.rejects(read());
    ctx.sessionManager.getHeader = getHeader;
    registry.nativeChildren.add(session.sessionId);
    await assert.rejects(read());
    registry.nativeChildren.delete(session.sessionId);
    await assert.rejects(
      execute({ operation: "get" }, ctx, AbortSignal.abort()),
    );
    await dispatch();
    let messages;
    const userText = "Unchanged raw Run metadata <user>";
    const image = {
      type: "image",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
      mimeType: "image/png",
    };
    faux.setResponses([
      (context) => {
        messages = context.messages;
        return ai.fauxAssistantMessage("Offline preservation");
      },
    ]);
    await session.prompt(userText, { images: [image] });
    const lastUser = messages.filter((m) => m.role === "user").at(-1);
    assert.equal(
      lastUser.content.find((c) => c.type === "text").text,
      userText,
    );
    assert.deepEqual(
      lastUser.content.find((c) => c.type === "image"),
      image,
    );
    const core = {
      cwd,
      customPrompt: "FIXTURE SYSTEM",
      contextFiles: [
        {
          path: path.join(agentDir, "memory/Core.md"),
          content: "FROZEN FIXTURE CORE",
        },
      ],
      sections: { fixture_owner: "UNCHANGED" },
    };
    const triggered = await session.extensionRunner.emitBeforeAgentStart(
      { messageType: "user", prompt: userText, images: [image] },
      structuredClone(core),
    );
    assert.deepEqual(
      triggered.systemPromptOptions.contextFiles,
      core.contextFiles,
    );
    assert.deepEqual(triggered.systemPromptOptions.sections, core.sections);
    assert.equal(triggered.messages.length, 0);
    const { transactRun, readRunState, stateTicket, resolveRunBinding } =
      await import(path.join(primary, "lib/execution-run/store.ts"));
    const { applyRun, runAt } = await import(
      path.join(primary, "lib/execution-run/model.ts")
    );
    let binding = { ...resolveRunBinding(cwd), sessionId: session.sessionId };
    const access = () =>
        node.executionRun.authorize(realTool, ctx, root, "write"),
      assertAccess = () =>
        node.executionRun.assertAccess(realTool, ctx, root, "write");
    const tx = (fn) =>
      transactRun(
        binding,
        stateTicket(readRunState(binding)),
        access,
        fn,
        assertAccess,
      );
    const fresh = async () => {
      confirm = async () => true;
      if (current()) {
        if (!["abandoned", "handed_off"].includes(current().stage))
          await command(`abandon ${current().revision}`);
        await command(`clear ${current().revision}`);
      }
      await read();
      await execute(createArgs);
    };
    await fresh();
    const foreign = { ...binding, sessionId: "other-native-session" };
    await tx((d) =>
      applyRun(
        d,
        foreign,
        "create",
        Object.fromEntries(
          Object.entries(createArgs).filter(([k]) => k !== "operation"),
        ),
      ),
    );
    const foreignRun = () => readRunState(binding).runs[foreign.sessionId];
    const localBefore = fs.readFileSync(statePath);
    const n = confirmations;
    await command(`abandon ${foreignRun().id} 999`);
    assert.equal(confirmations, n);
    assert.deepEqual(fs.readFileSync(statePath), localBefore);
    confirm = async (_title, label) => {
      assert.match(label, new RegExp(foreignRun().id));
      assert.match(label, /other-native-session/);
      return true;
    };
    await command(`abandon ${foreignRun().id} 1 exact cross-session metadata`);
    assert.equal(foreignRun().stage, "abandoned");
    assert.equal(current().stage, "plan");
    await command(`clear ${foreignRun().id} 2`);
    assert.equal(foreignRun(), undefined);
    const navigationEvents = [
      {
        type: "session_before_switch",
        reason: "resume",
        targetSessionFile: path.join(stagedRoot, "other.jsonl"),
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
      const old = fs.readFileSync(statePath);
      await session.extensionRunner.emit(event);
      await assert.rejects(
        execute({
          operation: "update",
          action: "add_blocker",
          expected_run_id: current().id,
          expected_revision: current().revision,
          summary: "stale",
        }),
        /Read mh_execution_run/,
      );
      assert.deepEqual(fs.readFileSync(statePath), old);
    }
    for (const race of [
      "revision",
      "ABA",
      "revoke",
      "config-replace",
      "navigation",
      "generation",
      "cancel",
    ]) {
      await fresh();
      const id = current().id,
        rev = current().revision;
      let release, label;
      const cancelled = new AbortController();
      confirm = async (_title, message) => {
        label = message;
        return new Promise((r) => (release = r));
      };
      const pending = commandDef.handler(`abandon ${rev} frozen target`, {
        ...ctx,
        signal: cancelled.signal,
      });
      while (!release) await new Promise((r) => setTimeout(r, 1));
      assert.match(label, new RegExp(id));
      assert.match(label, new RegExp(`revision ${rev}`));
      if (race === "revision")
        await update({ action: "add_blocker", summary: "concurrent" });
      if (race === "ABA")
        await tx((d) => {
          applyRun(d, binding, "abandon", {
            expected_run_id: id,
            expected_revision: rev,
          });
          applyRun(d, binding, "clear", {
            expected_run_id: id,
            expected_revision: rev + 1,
          });
          return applyRun(
            d,
            binding,
            "create",
            Object.fromEntries(
              Object.entries(createArgs).filter(([k]) => k !== "operation"),
            ),
          );
        });
      if (race === "revoke") grant({ ...rules(), [capability]: "deny" });
      if (race === "config-replace") {
        fs.renameSync(runConfig, runConfig + ".old");
        fs.writeFileSync(runConfig, runConfigBytes, { mode: 0o600 });
      }
      if (race === "navigation")
        await session.extensionRunner.emit(navigationEvents[0]);
      if (race === "generation")
        registry.set(session.sessionId, { ...node, generation: {} });
      if (race === "cancel") cancelled.abort();
      const after = fs.readFileSync(statePath);
      release(true);
      await pending;
      assert.deepEqual(fs.readFileSync(statePath), after, race);
      registry.set(session.sessionId, node);
      grant();
      binding = { ...resolveRunBinding(cwd), sessionId: session.sessionId };
    }
    await fresh();
    confirm = async () => true;
    await command(`abandon ${current().revision}`);
    let clearRelease;
    confirm = async () => new Promise((r) => (clearRelease = r));
    const clearId = current().id,
      clearRev = current().revision;
    const pending = command(`clear ${clearRev}`);
    while (!clearRelease) await new Promise((r) => setTimeout(r, 1));
    await tx((d) => {
      applyRun(d, binding, "clear", {
        expected_run_id: clearId,
        expected_revision: clearRev,
      });
      return applyRun(
        d,
        binding,
        "create",
        Object.fromEntries(
          Object.entries(createArgs).filter(([k]) => k !== "operation"),
        ),
      );
    });
    const recreated = fs.readFileSync(statePath);
    clearRelease(true);
    await pending;
    assert.deepEqual(fs.readFileSync(statePath), recreated);
    assert.notEqual(current().id, clearId);
    session.sessionManager.resetLeaf();
    assert.equal((await read()).run.id, current().id);
    assert.equal(
      runAt(readRunState(binding), { ...binding, sessionId: "brand-new" }),
      null,
    );
    assert.equal(forbiddenArtifactReads, 0);
    fs.readFileSync = originalRead;
    fs.openSync = originalOpen;
    syncBuiltinESMExports();
    for (const [file, bytes] of untouchedBytes)
      assert.deepEqual(fs.readFileSync(file), bytes);
    assert.deepEqual(fs.readdirSync(cwd), ["opaque-artifact.txt"]);
    assert.equal(requests, 0);
    fs.writeFileSync(
      path.join(stagedRoot, "run-receipt.json"),
      JSON.stringify(
        {
          actualPublicSDK: true,
          patchedOwner: true,
          requests,
          matrixCases,
          ordinaryMetadataWithoutUI: true,
          opaqueRefsNeverRead: true,
          exactCommandTargets: true,
          sourceOnly: true,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      if (session)
        await session.extensionRunner.emit({
          type: "session_shutdown",
          reason: "quit",
        });
    } finally {
      session?.dispose();
      globalThis.fetch = saved.fetch;
      fs.readFileSync = originalRead;
      fs.openSync = originalOpen;
      syncBuiltinESMExports();
    }
    if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved.agent;
  }
});
