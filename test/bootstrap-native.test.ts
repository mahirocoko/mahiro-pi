import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import {
  applyBootstrap,
  bootstrapSummary,
  inspectBootstrap,
  type BootstrapRequest,
} from "../lib/bootstrap.ts";
import { setupTarget } from "../lib/setup.ts";
import { createMemoryStore } from "../lib/agent-memory/store.ts";

const product = resolve(import.meta.dirname, "..");
const adapter = resolve(product, "../mods/adapters/pi");
const available = existsSync(
  join(adapter, "node_modules/@earendil-works/pi-coding-agent/package.json"),
);
const publicImport = async (name: string) => {
  const root = join(adapter, "node_modules", name);
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(metadata.version, "1.3.0");
  return import(pathToFileURL(join(root, metadata.exports["."].import)).href);
};

test("private bootstrap native SDK/Faux smoke: guarded initialize, role/skill discovery, fresh projection and revocation; zero external inference", {
  skip: !available && "private canonical SDK prerequisites absent",
}, async () => {
  const base = join(product, ".agent-state/runtime");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const fixture = mkdtempSync(join(base, "bootstrap-native-test-"));
  const project = join(fixture, "project");
  mkdirSync(project, { mode: 0o700 });
  const agentDir = join(fixture, "agent"),
    root = join(fixture, "memory"),
    seedFile = join(fixture, "seed.md");
  const seed =
    "# Core\nSYNTHETIC_BOOTSTRAP_IDENTITY: retain approved boundaries.\n";
  writeFileSync(seedFile, seed, { mode: 0o600 });
  const request: BootstrapRequest = {
    version: 1,
    agentDir,
    sources: {
      pi: product,
      mods: resolve(product, "../mods"),
      skills: resolve(product, "../mahiro-skills"),
    },
    components: {
      packages: true,
      roles: true,
      skills: ["recap"],
      skillPolicy: true,
      memory: { root, project, projectId: "fixture", seedFile },
    },
  };
  const previous = {
    cwd: process.cwd(),
    agentDir: process.env.PI_CODING_AGENT_DIR,
    memoryRoot: process.env.MAHIRO_AGENT_MEMORY_ROOT,
    author: process.env.GIT_AUTHOR_NAME,
    authorEmail: process.env.GIT_AUTHOR_EMAIL,
    committer: process.env.GIT_COMMITTER_NAME,
    committerEmail: process.env.GIT_COMMITTER_EMAIL,
  };
  const savedFetch = globalThis.fetch;
  let session: any;
  let requests = 0;
  try {
    process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME =
      "Synthetic bootstrap fixture";
    process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL =
      "fixture@example.invalid";
    const plan = inspectBootstrap(request);
    assert.equal(JSON.stringify(bootstrapSummary(plan)).includes(seed), false);
    const receipt = applyBootstrap(plan, plan.digest);
    const initialization = receipt.steps.find(
      (s: any) => s.kind === "memory-initialize-native",
    ).result;
    assert.equal(initialization.initialized, true);
    assert.equal(initialization.externalRequests, 0);
    assert.equal(
      initialization.transport,
      "synthetic-faux-zero-external-inference",
    );
    assert.equal(readFileSync(join(root, "Core.md"), "utf8"), seed);
    assert.equal(
      JSON.parse(readFileSync(join(root, "config.json"), "utf8")).automatic,
      false,
    );
    assert.equal(JSON.stringify(receipt).includes(seed), false);
    const key = `managed_memory_${createHash("sha256").update(root).digest("hex")}`;
    const policy = JSON.parse(readFileSync(setupTarget(agentDir), "utf8"));
    assert.equal(policy.permission[key], "allow");
    assert.deepEqual(
      Object.keys(policy.permission)
        .filter((name) => name.startsWith("agent_memory_"))
        .sort(),
      [
        "agent_memory_commit",
        "agent_memory_edit",
        "agent_memory_manage",
        "agent_memory_read",
        "agent_memory_reflect",
      ],
    );
    process.chdir(project);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.MAHIRO_AGENT_MEMORY_ROOT = root;
    const sdk = await publicImport("@earendil-works/pi-coding-agent");
    const ai = await publicImport("@earendil-works/pi-ai");
    globalThis.fetch = () => {
      requests++;
      throw new Error("No external transport allowed");
    };
    const runtime = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    // Locked native child routing remains authored; only this process's transport is Faux.
    const faux = ai.fauxProvider({
      provider: "openai",
      models: [{ id: "gpt-6.1-sol" }],
    });
    runtime.registerNativeProvider(faux.provider);
    const captured: string[] = [];
    const bindings: any[] = [];
    let reflect = false;
    faux.setResponses(
      Array.from({ length: 32 }, () => (context: any) => {
        const raw = JSON.stringify(context.messages);
        captured.push(raw);
        if (raw.includes("You maintain the primary companion")) {
          const results = context.messages.filter(
            (m: any) => m.role === "toolResult",
          );
          if (!results.length)
            return ai.fauxAssistantMessage(
              [ai.fauxToolCall("agent_memory_read", { path: "Core.md" })],
              { stopReason: "toolUse" },
            );
          if (results.length === 1)
            return ai.fauxAssistantMessage(
              [
                ai.fauxToolCall("agent_memory_edit", {
                  path: "procedures/bootstrap-check.md",
                  expectedHash: null,
                  text: "# Bootstrap verification\nInspect explicit owner receipts before reporting completion.\n",
                  sources: [],
                }),
              ],
              { stopReason: "toolUse" },
            );
          if (results.length === 2)
            return ai.fauxAssistantMessage(
              [
                ai.fauxToolCall("agent_memory_commit", {
                  revision: JSON.parse(results[0].content[0].text).revision,
                }),
              ],
              { stopReason: "toolUse" },
            );
          return ai.fauxAssistantMessage("Synthetic native child completed.");
        }
        if (reflect) {
          reflect = false;
          return ai.fauxAssistantMessage(
            [
              ai.fauxToolCall("agent_memory_reflect", {
                assignment:
                  "Maintain a generic bootstrap verification procedure from this explicit assignment.",
              }),
            ],
            { stopReason: "toolUse" },
          );
        }
        return ai.fauxAssistantMessage("Synthetic only.");
      }),
    );
    const settingsManager = sdk.SettingsManager.inMemory({
      packages: JSON.parse(
        readFileSync(join(agentDir, "settings.json"), "utf8"),
      ).packages,
      cacheWarming: "off",
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    let node: any;
    const open = async () => {
      const loader = new sdk.DefaultResourceLoader({
        cwd: project,
        agentDir,
        settingsManager,
        noSkills: true,
        noContextFiles: true,
        noThemes: true,
        noPromptTemplates: true,
        disabledBuiltinExtensions: ["mcp"],
        skillsOverride: () =>
          sdk.loadSkillsFromDir({
            dir: join(agentDir, "skills"),
            source: "user",
          }),
        systemPromptOverride: () =>
          "Synthetic bootstrap smoke, not a native default-provider test.",
        extensionFactories: [
          (pi: any) => {
            pi.on("session_start", (_event: any, ctx: any) => {
              node = globalThis[
                Symbol.for("@mahirocoko/pi-guards:healthy-nodes")
              ]?.get(ctx.sessionManager.getSessionId());
            });
            pi.events.on("subagents:child:bound", (event: any) =>
              bindings.push(event),
            );
          },
        ],
      });
      await loader.reload();
      assert.deepEqual(loader.getExtensions().errors, []);
      assert.ok(
        loader.getSkills().skills.some((skill: any) => skill.name === "recap"),
      );
      const created = await sdk.createAgentSession({
        cwd: project,
        agentDir,
        settingsManager,
        resourceLoader: loader,
        modelRuntime: runtime,
        model: faux.getModel(),
        sessionManager: sdk.SessionManager.create(
          project,
          join(fixture, "sessions"),
        ),
      });
      await created.session.bindExtensions({});
      return created.session;
    };
    session = await open();
    assert.equal(node.healthy(), true);
    const service = node.managedMemory.parentService();
    assert.equal(service.supportsInitialOutcomeClaim, true);
    const writer = service.getAgentType("managed-memory-writer");
    assert.equal(writer.locked, true);
    assert.equal(writer.inheritContext, false);
    assert.equal(writer.promptMode, "replace");
    assert.deepEqual([...writer.toolNames].sort(), [
      "agent_memory_commit",
      "agent_memory_edit",
      "agent_memory_read",
    ]);
    assert.equal(service.getAgentType("memory-reflector").locked, true);
    assert.deepEqual(
      [...service.getAgentType("git-commit").locked],
      ["model", "thinking"],
    );
    await session.prompt("Synthetic fresh-session projection check.");
    assert.ok(captured.at(-1)!.includes("SYNTHETIC_BOOTSTRAP_IDENTITY"));
    policy.permission[key] = "deny";
    writeFileSync(setupTarget(agentDir), JSON.stringify(policy));
    await session.prompt("Synthetic revocation check.");
    assert.ok(!captured.at(-1)!.includes("<mahiro-managed-memory>"));
    policy.permission[key] = "allow";
    writeFileSync(setupTarget(agentDir), JSON.stringify(policy));
    session.dispose();
    session = await open();
    await session.prompt("Synthetic second fresh-session check.");
    assert.ok(captured.at(-1)!.includes("SYNTHETIC_BOOTSTRAP_IDENTITY"));
    reflect = true;
    await session.prompt(
      "Synthetic explicit native writer assignment; no external inference.",
    );
    const childService = node.managedMemory.parentService();
    await childService.waitForAll();
    const records = childService.listAgents();
    assert.equal(records.length, 1);
    assert.equal(records[0].type, "managed-memory-writer");
    assert.equal(records[0].status, "completed", records[0].error);
    assert.ok(records[0].outputFile.startsWith(`${fixture}/`));
    const childHeader = JSON.parse(
      readFileSync(records[0].outputFile, "utf8").split("\n")[0],
    );
    assert.ok(
      bindings.some(
        (event) =>
          event.sessionId === childHeader.id &&
          event.parentSessionId === session.sessionId,
      ),
    );
    assert.ok(
      createMemoryStore(root).snapshot().files["procedures/bootstrap-check.md"],
    );
    const childRequests = captured.filter((raw) =>
      raw.includes("You maintain the primary companion"),
    );
    assert.ok(childRequests.length >= 4);
    assert.ok(
      childRequests.every(
        (raw) =>
          !raw.includes(
            "Synthetic bootstrap smoke, not a native default-provider test.",
          ),
      ),
    );
    session.dispose();
    session = undefined;
    process.chdir(previous.cwd);
    // Existing store is preserved even when a different (or missing) seed/automatic value is selected.
    writeFileSync(seedFile, "# Core\nDo not reseed existing memory.\n");
    request.components.memory!.automatic = true;
    const before = readFileSync(join(root, "Core.md"), "utf8");
    const rerun = inspectBootstrap(request);
    assert.equal(rerun.memory!.action, "preserve-existing");
    const again = applyBootstrap(rerun, rerun.digest);
    assert.equal(again.status, "completed");
    assert.equal(readFileSync(join(root, "Core.md"), "utf8"), before);
    assert.equal(
      JSON.parse(readFileSync(join(root, "config.json"), "utf8")).automatic,
      false,
    );
    const stale = inspectBootstrap(request);
    assert.throws(
      () =>
        applyBootstrap(stale, stale.digest, {
          beforeStep: (kind) => {
            if (kind === "memory-preserve-existing")
              writeFileSync(
                join(root, "config.json"),
                `${readFileSync(join(root, "config.json"), "utf8")}\n`,
              );
          },
        }),
      /Bootstrap stopped/,
    );
    assert.equal(requests, 0);
    // The native child may create empty credential-store metadata in this disposable
    // profile. No real auth is resolved/copied, and no profile model default is set.
    const finalSettings = JSON.parse(
      readFileSync(join(agentDir, "settings.json"), "utf8"),
    );
    assert.equal(finalSettings.defaultModel, undefined);
    assert.equal(finalSettings.defaultProvider, undefined);
    assert.equal(finalSettings.defaultThinkingLevel, undefined);
  } finally {
    session?.dispose();
    globalThis.fetch = savedFetch;
    process.chdir(previous.cwd);
    for (const [key, value] of Object.entries({
      PI_CODING_AGENT_DIR: previous.agentDir,
      MAHIRO_AGENT_MEMORY_ROOT: previous.memoryRoot,
      GIT_AUTHOR_NAME: previous.author,
      GIT_AUTHOR_EMAIL: previous.authorEmail,
      GIT_COMMITTER_NAME: previous.committer,
      GIT_COMMITTER_EMAIL: previous.committerEmail,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});
