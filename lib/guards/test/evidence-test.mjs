// Isolated source stage only: actual public SDK + actual permission owner.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as sdk from "@earendil-works/pi-coding-agent";
import * as ai from "@earendil-works/pi-ai";
import { trustedEvidenceTool } from "../provenance.mjs";
import { evidenceGitCommand, evidenceGitPrefix } from "../evidence-git.mjs";
const adapter = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ),
  primary = path.resolve(adapter, "../.."),
  stage = path.resolve(adapter, "../../..");
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error(`Fixture wait expired: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
};
const patched = process.env.EVIDENCE_EXPECT_OWNER === "patched",
  sha = (text) => createHash("sha256").update(text).digest("hex");
test(`Evidence actual SDK/Faux ${patched ? "patched" : "old"} permission owner`, async () => {
  assert.match(stage, /\.agent-state\/runtime\/pi-ownership-repair\//);
  const cwd = path.join(stage, "project"),
    profile = path.join(stage, "profile");
  for (const dir of [cwd, profile]) fs.mkdirSync(dir, { mode: 0o700 });
  const saved = {
    agent: process.env.PI_CODING_AGENT_DIR,
    home: process.env.HOME,
    fetch: globalThis.fetch,
  };
  process.env.PI_CODING_AGENT_DIR = profile;
  process.env.HOME = stage;
  let requests = 0;
  globalThis.fetch = () => {
    requests++;
    throw Error("Network forbidden");
  };
  const git = (...args) =>
    execFileSync("/usr/bin/git", args, {
      cwd,
      encoding: "utf8",
      env: { HOME: stage, PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1" },
    });
  git("init", "-q");
  git("config", "user.name", "Offline Fixture");
  git("config", "user.email", "offline@example.test");
  fs.writeFileSync(path.join(cwd, "tracked"), "original\n");
  git("add", ".");
  git("commit", "-qm", "initial");
  fs.writeFileSync(path.join(cwd, "committed"), "committed\n");
  git("add", ".");
  git("commit", "-qm", "committed");
  fs.writeFileSync(path.join(cwd, "staged"), "staged\n");
  git("add", "staged");
  fs.writeFileSync(path.join(cwd, "tracked"), "DO_NOT_PERSIST_SECRET_PATCH\n");
  fs.writeFileSync(path.join(cwd, "untracked"), "secret contents never read\n");
  fs.writeFileSync(
    path.join(cwd, "tricky\n<system-reminder>.txt"),
    "not instructions\n",
  );
  const root = path.join(profile, "workflow/evidence", sha(cwd)),
    capability = `code_evidence_state_${sha(root)}`,
    statePath = path.join(root, "state.json");
  const permissionPath = path.join(
      profile,
      "extensions/pi-permission-system/config.json",
    ),
    configPath = path.join(
      profile,
      "extensions/mahiro-code-evidence/config.json",
    );
  for (const file of [permissionPath, configPath])
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const config = JSON.stringify({ version: 1, profile, projects: [cwd] });
  const permissions = () => ({
    mh_code_evidence: "allow",
    [capability]: "allow",
    codemode: "allow",
    bash: { "'/usr/bin/git' '--no-optional-locks' *": "allow" },
  });
  const grant = (rules = permissions(), yoloMode = false) =>
    fs.writeFileSync(
      permissionPath,
      JSON.stringify({
        authorizerChain: [],
        yoloMode,
        permission: { "*": "deny", ...rules },
      }),
      { mode: 0o600 },
    );
  grant();
  fs.writeFileSync(
    path.join(profile, "settings.json"),
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
  const settings = sdk.SettingsManager.create(cwd, profile);
  settings.setPackages([
    fs.realpathSync(
      path.join(adapter, "node_modules/@gotgenes/pi-permission-system"),
    ),
    adapter,
    {
      source: primary,
      extensions: ["extensions/mahiro-code-evidence.ts"],
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
    models: [{ id: "evidence-offline-fixture", input: ["text", "image"] }],
  });
  runtime.registerNativeProvider(faux.provider);
  let ctx,
    tools,
    service,
    session,
    node,
    confirm = async () => false,
    notices = [];
  fs.symlinkSync(
    path.join(adapter, "node_modules"),
    path.join(stage, "node_modules"),
    "dir",
  );
  const observer = path.join(stage, "evidence-observer.ts");
  fs.writeFileSync(
    observer,
    `import { getPermissionsService } from '@gotgenes/pi-permission-system'; export default pi=>pi.on('session_start',(_e,ctx)=>pi.events.emit('fixture:evidence',{ctx,tools:pi.getAllTools(),service:()=>getPermissionsService(ctx.sessionManager.getSessionId())}));`,
  );
  const loader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir: profile,
    settingsManager: settings,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    disabledBuiltinExtensions: ["mcp"],
    additionalExtensionPaths: [observer],
    extensionFactories: [
      sdk.createCodemodeExtension(),
      (pi) =>
        pi.events.on("fixture:evidence", (value) => {
          ctx = value.ctx;
          tools = value.tools;
          service = value.service;
        }),
    ],
  });
  const defs = new Map();
  try {
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    for (const extension of loader.getExtensions().extensions)
      for (const item of extension.tools.values())
        defs.set(item.definition.name, item.definition);
    assert.ok(defs.has("mh_code_evidence"));
    assert.equal(fs.existsSync(root), false);
    ({ session } = await sdk.createAgentSession({
      cwd,
      agentDir: profile,
      settingsManager: settings,
      resourceLoader: loader,
      modelRuntime: runtime,
      model: faux.getModel(),
      sessionManager: sdk.SessionManager.create(
        cwd,
        path.join(stage, "sessions"),
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
    assert.equal(node.evidence.version, 1);
    const execute = (args, context = ctx, signal) =>
      defs
        .get("mh_code_evidence")
        .execute("fixture", args, signal, undefined, context)
        .then((result) => result.details);
    await assert.rejects(execute({ action: "get" }), /disabled/);
    assert.equal(fs.existsSync(root), false);
    fs.writeFileSync(configPath, config, { mode: 0o600 });
    const deniedDispatch = async () => {
      let messages;
      faux.setResponses([
        ai.fauxAssistantMessage(
          [
            ai.fauxToolCall("mh_code_evidence", { action: "get" }),
            ai.fauxToolCall("codemode", {
              code: "try { text(await tools.mh_code_evidence({action:'get'})); } catch(e) { text('NESTED_EVIDENCE_DENIED'); }",
            }),
          ],
          { stopReason: "toolUse" },
        ),
        (context) => {
          messages = context.messages;
          return ai.fauxAssistantMessage("offline denied");
        },
      ]);
      await session.prompt("Synthetic denied fixture only");
      const results = messages
        .filter((item) => item.role === "toolResult")
        .slice(-2);
      assert.equal(
        results.find((item) => item.toolName === "mh_code_evidence").isError,
        true,
      );
      assert.match(
        JSON.stringify(results.find((item) => item.toolName === "codemode")),
        /NESTED_EVIDENCE_DENIED/,
      );
    };
    if (!patched) {
      await assert.rejects(execute({ action: "get" }), /attestation/);
      await deniedDispatch();
      assert.equal(fs.existsSync(root), false);
      assert.equal(requests, 0);
      return;
    }
    assert.equal((await execute({ action: "get" })).status, "empty");
    assert.equal(fs.existsSync(root), false);
    // P1: actual public policy owner, hook-free execute. A denied source must
    // stop BEFORE even name-status/shortstat (both can inspect/hash contents).
    const originalGitAuthority = node.evidence.authorizeGit;
    let contentCalls = [];
    node.evidence.authorizeGit = async (...args) => {
      const tail = args[5].slice(evidenceGitPrefix.length);
      if (
        tail[0] === "diff" ||
        (tail[0] === "ls-files" && tail.includes("--others"))
      )
        contentCalls.push(tail);
      return originalGitAuthority(...args);
    };
    try {
      for (const file of ["tracked", "staged", "committed", "untracked"]) {
        const deniedPath = path.join(cwd, file);
        grant({ ...permissions(), path_read: { [deniedPath]: "deny" } });
        const decision = service.checkPermission("path_read", deniedPath);
        assert.equal(decision.state, "deny");
        assert.equal(decision.matchedPattern, deniedPath);
        contentCalls = [];
        await assert.rejects(
          execute({ action: "collect", base_ref: "HEAD^" }),
          /source read path denied/,
        );
        assert.equal(contentCalls.length, 0);
        assert.equal(fs.existsSync(root), false);
      }
    } finally {
      grant();
      node.evidence.authorizeGit = originalGitAuthority;
    }
    const actual = tools.find((tool) => tool.name === "mh_code_evidence");
    assert.equal(trustedEvidenceTool(actual), true);
    for (const change of [
      { name: "mh_evidence_alias" },
      { sourceInfo: undefined },
      { sourceInfo: { ...actual.sourceInfo, origin: "top-level" } },
      { sourceInfo: { ...actual.sourceInfo, path: "inline" } },
      { sourceInfo: { ...actual.sourceInfo, baseDir: stage } },
    ])
      assert.equal(trustedEvidenceTool({ ...actual, ...change }), false);
    const manifestPath = path.join(primary, "package.json"),
      manifestBytes = fs.readFileSync(manifestPath),
      manifest = JSON.parse(manifestBytes);
    try {
      for (const change of [
        { version: "0.2.1" },
        { name: "foreign" },
        { pi: { extensions: [] } },
        { pi: { extensions: ["extensions/mahiro-code-evidence.ts"] } },
      ]) {
        fs.writeFileSync(
          manifestPath,
          JSON.stringify({ ...manifest, ...change }),
        );
        await assert.rejects(execute({ action: "get" }));
      }
    } finally {
      fs.writeFileSync(manifestPath, manifestBytes);
    }
    for (const rules of [
      { mh_code_evidence: "allow" },
      { [capability]: "allow" },
      { "mh_*": "allow", [capability]: "allow" },
      { mh_code_evidence: "allow", "code_evidence_state_*": "allow" },
      { ...permissions(), "mh_*": "allow" },
      { ...permissions(), "code_evidence_state_*": "allow" },
      { mh_code_evidence: "allow", managed_memory_fake: "allow" },
    ]) {
      grant({ codemode: "allow", ...rules });
      await assert.rejects(execute({ action: "get" }), /exact named/);
      await deniedDispatch();
    }
    grant(
      { mh_code_evidence: "ask", [capability]: "ask", codemode: "allow" },
      true,
    );
    await assert.rejects(execute({ action: "get" }));
    await deniedDispatch();
    grant();
    const check = service.checkPermission;
    try {
      service.checkPermission = function (...args) {
        const { matchedSurface, ...decision } = check.apply(this, args);
        return decision;
      };
      await assert.rejects(execute({ action: "get" }));
      await deniedDispatch();
    } finally {
      service.checkPermission = check;
    }
    const originalHeader = ctx.sessionManager.getHeader;
    ctx.sessionManager.getHeader = () => ({
      ...originalHeader.call(ctx.sessionManager),
      parentSession: "fork",
    });
    await assert.rejects(execute({ action: "get" }));
    ctx.sessionManager.getHeader = originalHeader;
    const children =
      globalThis[Symbol.for("@mahirocoko/pi-guards:healthy-nodes")]
        .nativeChildren;
    children.add(session.sessionId);
    await assert.rejects(execute({ action: "get" }));
    children.delete(session.sessionId);
    assert.throws(() =>
      node.evidence.assertAccess(
        actual,
        { ...ctx, sessionManager: { getSessionId: () => session.sessionId } },
        root,
      ),
    );
    assert.throws(() =>
      node.evidence.assertAccess(actual, ctx, `${root}/foreign`),
    );
    await assert.rejects(
      execute({
        action: "collect",
        workspace: cwd,
        base_ref: "--output=/tmp/escape",
      }),
    );
    await assert.rejects(execute({ action: "collect", workspace: stage }));
    await assert.rejects(
      execute({ action: "collect", workspace: cwd }, ctx, AbortSignal.abort()),
    );
    assert.equal(fs.existsSync(root), false);
    // ABI cannot authorize general commands/options, and host transformations are rejected.
    for (const tail of [
      ["status"],
      ["config", "--list"],
      ["diff", "--no-ext-diff", "--no-textconv", "--binary", "--", "secret"],
      ["merge-base", "HEAD", "main"],
    ])
      await assert.rejects(
        node.evidence.authorizeGit(actual, ctx, root, "read", "/usr/bin/git", [
          ...evidenceGitPrefix,
          ...tail,
        ]),
      );
    const originalFinal = node.host.finalArgs;
    try {
      node.host.finalArgs = async () => ({ command: "rewritten" });
      await assert.rejects(execute({ action: "collect" }), /transformation/);
    } finally {
      node.host.finalArgs = originalFinal;
    }
    grant({ ...permissions(), bash: "deny" });
    await assert.rejects(execute({ action: "collect" }), /Bash permission/);
    grant();
    // Prove repository-configured helpers really execute when unguarded, then
    // exercise the same actual authorized collector with every helper suppressed.
    const helperMarker = path.join(stage, "hostile-helper-ran"),
      helper = path.join(stage, "hostile-helper.sh");
    fs.writeFileSync(
      helper,
      `#!/bin/sh\nprintf called > '${helperMarker}'\ncat\n`,
      { mode: 0o700 },
    );
    fs.writeFileSync(
      path.join(cwd, ".gitattributes"),
      "tracked diff=hostile filter=hostile\n",
    );
    git("config", "diff.external", helper);
    git("diff", "--ext-diff", "--", "tracked");
    assert.ok(fs.existsSync(helperMarker));
    fs.unlinkSync(helperMarker);
    git("config", "diff.hostile.textconv", helper);
    git("diff", "--no-ext-diff", "--textconv", "--", "tracked");
    assert.ok(fs.existsSync(helperMarker));
    fs.unlinkSync(helperMarker);
    git("config", "core.fsmonitor", helper);
    git("status", "--porcelain");
    assert.ok(fs.existsSync(helperMarker));
    fs.unlinkSync(helperMarker);
    const first = await execute({ action: "collect", base_ref: "HEAD^" });
    assert.equal(
      fs.existsSync(helperMarker),
      false,
      "fixed diff/textconv/fsmonitor controls suppress proven helpers",
    );
    // Same-length original counterexample, now rejected with byte-identical
    // canonical report. Also include missing old/tree rename and deletion paths.
    git("config", "--unset", "core.fsmonitor");
    git("config", "--unset", "diff.external");
    git("config", "--unset", "diff.hostile.textconv");
    const canonicalBeforeDenial = fs.readFileSync(statePath);
    for (const change of [false, true]) {
      if (change)
        fs.writeFileSync(
          path.join(cwd, "tracked"),
          "XX_NOT_PERSIST_SECRET_PATCH\n",
        );
      grant({
        ...permissions(),
        path_read: { [path.join(cwd, "tracked")]: "deny" },
      });
      await assert.rejects(
        execute({ action: "collect" }),
        /source read path denied/,
      );
      assert.deepEqual(fs.readFileSync(statePath), canonicalBeforeDenial);
    }
    grant();
    fs.writeFileSync(
      path.join(cwd, "tracked"),
      "DO_NOT_PERSIST_SECRET_PATCH\n",
    );
    for (const mode of [
      "staged-rename",
      "committed-rename",
      "committed-delete",
    ]) {
      git("mv", "committed", "renamed");
      if (mode !== "staged-rename") git("commit", "-qm", "offline rename");
      if (mode === "committed-delete") {
        git("rm", "renamed");
        git("commit", "-qm", "offline delete");
      }
      for (const name of ["committed", "renamed"]) {
        grant({
          ...permissions(),
          path_read: { [path.join(cwd, name)]: "deny" },
        });
        contentCalls = [];
        node.evidence.authorizeGit = async (...args) => {
          if (args[5].includes("diff")) contentCalls.push(args[5]);
          return originalGitAuthority(...args);
        };
        await assert.rejects(
          execute({
            action: "collect",
            base_ref:
              "HEAD~" +
              (mode === "committed-delete" && name === "committed" ? "2" : "1"),
          }),
          /source read path denied/,
        );
        assert.equal(contentCalls.length, 0);
        assert.deepEqual(fs.readFileSync(statePath), canonicalBeforeDenial);
      }
      node.evidence.authorizeGit = originalGitAuthority;
      grant();
      if (mode === "staged-rename") git("reset", "--hard", "HEAD");
      else
        git(
          "reset",
          "--hard",
          "HEAD~" + (mode === "committed-delete" ? "2" : "1"),
        );
      fs.writeFileSync(path.join(cwd, "staged"), "staged\n");
      git("add", "staged");
      fs.writeFileSync(
        path.join(cwd, "tracked"),
        "DO_NOT_PERSIST_SECRET_PATCH\n",
      );
    }
    // Filters are not merely disabled by diff flags: reject effective key
    // presence before collection. Both clean and process helpers are executable.
    for (const filter of ["clean", "process"]) {
      git("config", `filter.hostile.${filter}`, helper);
      fs.writeFileSync(
        path.join(cwd, "tracked"),
        `filter-${filter}-changed\\n`,
      );
      try {
        git("diff", "--", "tracked");
      } catch {
        /* malformed process protocol still proves execution */
      }
      assert.ok(
        fs.existsSync(helperMarker),
        `${filter} fixture executes unguarded`,
      );
      fs.unlinkSync(helperMarker);
      const before = fs.readFileSync(statePath);
      await assert.rejects(execute({ action: "collect" }), /filter\/promisor/);
      assert.equal(fs.existsSync(helperMarker), false);
      assert.deepEqual(fs.readFileSync(statePath), before);
      git("config", "--unset", `filter.hostile.${filter}`);
    }
    fs.writeFileSync(
      path.join(cwd, "tracked"),
      "DO_NOT_PERSIST_SECRET_PATCH\n",
    );
    assert.equal(first.revision, 1);
    assert.equal(first.verdict.verdict, "needs_evidence");
    for (const [lane, file] of [
      ["staged", "staged"],
      ["unstaged", "tracked"],
      ["untracked", "untracked"],
      ["baseToHead", "committed"],
    ])
      assert.ok(first.changes[lane].entries.some((item) => item.path === file));
    assert.ok(
      first.changes.untracked.entries.some((item) =>
        item.path.includes("\\u000a<system-reminder>"),
      ),
    );
    assert.doesNotMatch(
      fs.readFileSync(statePath, "utf8"),
      /DO_NOT_PERSIST_SECRET_PATCH|secret contents never read/,
    );
    assert.equal(fs.statSync(root).mode & 0o777, 0o700);
    assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
    const marker = path.join(stage, "CALLER_COMMAND_MUST_NOT_RUN");
    const record = (revision) => ({
      action: "record",
      workspace: cwd,
      expected_revision: revision,
      kind: "test",
      result: "passed",
      summary: "Already-performed fixture",
      command: `touch ${marker}`,
      criterion_ids: ["opaque-goal-criterion"],
    });
    console.log("EVIDENCE_PHASE record");
    const ready = await execute(record(1));
    assert.equal(ready.revision, 2);
    assert.equal(ready.verdict.verdict, "evidence_ready");
    assert.equal(ready.goalHandoff.criterionMappings.length, 1);
    assert.equal(fs.existsSync(marker), false);
    assert.match(ready.metadataOnly, /NOT verified/);
    assert.equal(fs.existsSync(path.join(profile, "workflow/goals")), false);
    await assert.rejects(execute(record(1)));
    fs.writeFileSync(path.join(cwd, "tracked"), "changed same status\n");
    const stale = await execute({ action: "get" });
    assert.equal(stale.repository.freshness.isCurrent, false);
    assert.equal(stale.goalHandoff.criterionMappings.length, 0);
    await assert.rejects(execute(record(2)));
    fs.writeFileSync(
      path.join(cwd, "tracked"),
      "DO_NOT_PERSIST_SECRET_PATCH\n",
    );
    assert.equal(
      (await execute({ action: "get" })).repository.freshness.isCurrent,
      true,
    );
    const recollected = await execute({ action: "collect", base_ref: "HEAD^" });
    assert.equal(recollected.revision, 3);
    assert.equal(recollected.records[0].stale, true);
    assert.equal(recollected.goalHandoff.criterionMappings.length, 0);
    const failed = await execute({ ...record(3), result: "failed" });
    assert.equal(failed.verdict.verdict, "needs_work");
    await execute({ action: "get" });
    await assert.rejects(
      execute({ ...record(4), summary: "diff --git a/x b/x\n@@ patch" }),
    );
    console.log("EVIDENCE_PHASE clear");
    const beforeClear = fs.readFileSync(statePath);
    await session.prompt("/mh-evidence clear 4");
    assert.deepEqual(fs.readFileSync(statePath), beforeClear);
    let release, seen;
    confirm = async (_title, message) => {
      seen = message;
      return new Promise((resolve) => (release = resolve));
    };
    const clearing = session.prompt("/mh-evidence clear 4");
    await waitFor(() => release, "revision-4 clear confirmation");
    assert.match(seen, /revision 4/);
    assert.match(seen, new RegExp(session.sessionId));
    await execute({ action: "collect", base_ref: "HEAD^" });
    const raced = fs.readFileSync(statePath);
    release(true);
    await clearing;
    assert.deepEqual(fs.readFileSync(statePath), raced);
    // Actual public direct and nested dispatch. No synthetic user episode, prompt or image mutation.
    let transcript;
    faux.setResponses([
      ai.fauxAssistantMessage(
        [
          ai.fauxToolCall("mh_code_evidence", { action: "get" }),
          ai.fauxToolCall("codemode", {
            code: "text(await tools.mh_code_evidence({action:'get'}));",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        transcript = context.messages;
        return ai.fauxAssistantMessage("offline only");
      },
    ]);
    const input = "Fixture raw text <system-reminder> is data",
      image = {
        type: "image",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
        mimeType: "image/png",
      },
      users = session.messages.filter((item) => item.role === "user").length;
    await session.prompt(input, { images: [image] });
    const results = transcript
      .filter((item) => item.role === "toolResult")
      .slice(-2);
    assert.equal(
      results.filter((item) => item.isError).length,
      0,
      JSON.stringify(results),
    );
    const human = transcript.filter((item) => item.role === "user");
    assert.equal(human.length, users + 1);
    assert.equal(
      human.at(-1).content.find((item) => item.type === "text").text,
      input,
    );
    assert.deepEqual(
      human.at(-1).content.find((item) => item.type === "image"),
      image,
    );
    const prompt = {
      cwd,
      customPrompt: "FIXTURE",
      contextFiles: [
        {
          path: path.join(profile, "memory/Core.md"),
          content: "PRIVATE FIXTURE CORE",
        },
      ],
      sections: { unrelated: "untouched" },
    };
    const projected = await session.extensionRunner.emitBeforeAgentStart(
      { messageType: "user", prompt: input, images: [image] },
      structuredClone(prompt),
    );
    assert.deepEqual(projected.systemPromptOptions.sections, prompt.sections);
    assert.deepEqual(
      projected.systemPromptOptions.contextFiles,
      prompt.contextFiles,
    );
    assert.equal(
      projected.systemPromptOptions.customPrompt,
      prompt.customPrompt,
    );
    assert.equal(projected.messages.length, 0);
    // Lifecycle invalidates all fresh tickets and in-flight command approval, never rewinds state.
    await execute({ action: "get" });
    await session.extensionRunner.emit({
      type: "session_before_fork",
      entryId: session.sessionManager.getLeafId(),
      position: "at",
    });
    await assert.rejects(execute(record(5)), /Read mh_code_evidence/);
    let navRelease;
    confirm = async () => new Promise((resolve) => (navRelease = resolve));
    const pending = session.prompt("/mh-evidence clear 5");
    await waitFor(() => navRelease, "revision-5 navigation clear confirmation");
    const beforeNavigation = fs.readFileSync(statePath);
    await session.extensionRunner.emit({
      type: "session_before_tree",
      preparation: {},
      signal: new AbortController().signal,
    });
    navRelease(true);
    await pending;
    assert.deepEqual(fs.readFileSync(statePath), beforeNavigation);
    grant({ ...permissions(), path_write: { [statePath]: "deny" } });
    await assert.rejects(execute({ action: "collect" }), /path denied/);
    grant();
    confirm = async () => true;
    await session.prompt("/mh-evidence clear 5");
    assert.equal((await execute({ action: "get" })).status, "empty");
    const emptySequence = JSON.parse(fs.readFileSync(statePath)).sequence;
    await execute({ action: "collect" });
    assert.ok(JSON.parse(fs.readFileSync(statePath)).sequence > emptySequence);
    // Actual native definition owns real Git children; abort/revocation/overflow
    // all reject and preserve canonical bytes. The source resource test also
    // observes owned PIDs and proves ESRCH after the close/reap boundary.
    const beforeResource = fs.readFileSync(statePath),
      normalTracked = fs.readFileSync(path.join(cwd, "tracked"));
    fs.writeFileSync(
      path.join(cwd, "tracked"),
      randomBytes(12 * 1024 * 1024).toString("hex"),
    );
    const authorizeGit = node.evidence.authorizeGit;
    try {
      for (const mode of ["cancel", "revoke", "overflow"]) {
        const controller = new AbortController();
        let binary = false,
          timer;
        node.evidence.authorizeGit = async (...args) => {
          await authorizeGit(...args);
          if (!binary && args[5].includes("--binary")) {
            binary = true;
            if (mode !== "overflow")
              timer = setTimeout(
                () =>
                  mode === "cancel"
                    ? controller.abort()
                    : grant({ ...permissions(), [capability]: "deny" }),
                0,
              );
          }
        };
        await assert.rejects(
          execute({ action: "collect" }, ctx, controller.signal),
          mode === "overflow" ? /bound/ : /cancel|revok|exact named/,
        );
        clearTimeout(timer);
        assert.equal(binary, true);
        assert.deepEqual(fs.readFileSync(statePath), beforeResource);
        grant();
      }
    } finally {
      node.evidence.authorizeGit = authorizeGit;
      fs.writeFileSync(path.join(cwd, "tracked"), normalTracked);
      grant();
    }
    assert.equal(requests, 0);
    assert.equal(fs.existsSync(marker), false);
    fs.writeFileSync(
      path.join(stage, "evidence-receipt.json"),
      JSON.stringify(
        {
          actualPublicSDK: true,
          patchedOwner: true,
          liveInstalledPatch: false,
          requests,
          directNestedExecute: true,
          defaultDisabled: true,
          metadataNotExecution: true,
          goalUnchanged: true,
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
    }
    for (const [key, value] of [
      ["PI_CODING_AGENT_DIR", saved.agent],
      ["HOME", saved.home],
    ])
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
