// Explicit bootstrap subprocess only; never imported by Pi startup.
// Uses only the installed package's declared public ESM entry, not host internals.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readBootstrapFile } from "./bootstrap.ts";

let modules = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../node_modules",
);
const publicImport = async (name) => {
  const root = join(modules, name);
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(metadata.name, name);
  assert.equal(metadata.version, "1.3.0");
  const entry = metadata.exports?.["."]?.import;
  assert.ok(
    typeof entry === "string" &&
      entry.startsWith("./") &&
      !entry.includes(".."),
  );
  return import(pathToFileURL(join(root, entry)).href);
};
let session;
try {
  const request = JSON.parse(process.env.MAHIRO_BOOTSTRAP_REQUEST ?? "null");
  assert.ok(request && process.cwd() === request.project);
  if (request.dependencyModules !== undefined) {
    assert.equal(resolve(request.dependencyModules), request.dependencyModules);
    modules = request.dependencyModules;
  }
  assert.equal(process.env.PI_CODING_AGENT_DIR, request.agentDir);
  assert.equal(process.env.MAHIRO_AGENT_MEMORY_ROOT, request.root);
  const selected = readBootstrapFile(request.seedFile);
  assert.ok(
    selected && selected.hash === request.seedHash && selected.mode === 0o600,
  );
  const core = selected.text;
  const sdk = await publicImport("@earendil-works/pi-coding-agent");
  const ai = await publicImport("@earendil-works/pi-ai");
  let externalRequests = 0;
  globalThis.fetch = () => {
    externalRequests++;
    throw new Error("Bootstrap forbids external transport");
  };
  const runtime = await sdk.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  // Deterministic transport to enter Pi's normal guarded tool pipeline, not inference.
  // This ephemeral synthetic model never changes profile/default/role routing.
  const faux = ai.fauxProvider({
    provider: "bootstrap-offline",
    models: [{ id: "bootstrap-offline" }],
  });
  runtime.registerNativeProvider(faux.provider);
  faux.setResponses([
    () =>
      ai.fauxAssistantMessage(
        [
          ai.fauxToolCall("agent_memory_manage", {
            action: "initialize",
            core,
            projectId: request.projectId,
            automatic: request.automatic,
          }),
        ],
        { stopReason: "toolUse" },
      ),
    () => ai.fauxAssistantMessage("Offline guarded bootstrap complete."),
    () => ai.fauxAssistantMessage("Offline projection checked."),
  ]);
  let node,
    result,
    projected = false;
  const settingsManager = sdk.SettingsManager.inMemory({
    packages: request.packages,
    skills: [],
    prompts: [],
    themes: [],
    cacheWarming: "off",
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const loader = new sdk.DefaultResourceLoader({
    cwd: request.project,
    agentDir: request.agentDir,
    settingsManager,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    disabledBuiltinExtensions: ["mcp"],
    systemPromptOverride: () =>
      "Explicit offline local bootstrap. No external inference.",
    extensionFactories: [
      (pi) => {
        pi.on("session_start", (_event, ctx) => {
          node = globalThis[
            Symbol.for("@mahirocoko/pi-guards:healthy-nodes")
          ]?.get(ctx.sessionManager.getSessionId());
        });
        pi.on("tool_result", (event) => {
          if (event.toolName === "agent_memory_manage") {
            assert.equal(
              event.isError,
              false,
              "Guarded initialization rejected",
            );
            result = JSON.parse(
              event.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n"),
            );
          }
        });
        pi.on("before_agent_start", (event) => {
          if (event.systemPrompt.includes("<mahiro-managed-memory>"))
            projected = true;
        });
      },
    ],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  ({ session } = await sdk.createAgentSession({
    cwd: request.project,
    agentDir: request.agentDir,
    modelRuntime: runtime,
    model: faux.getModel(),
    settingsManager,
    resourceLoader: loader,
    sessionManager: sdk.SessionManager.inMemory(request.project),
  }));
  await session.bindExtensions({});
  assert.ok(node?.healthy());
  const service = node.managedMemory?.parentService();
  assert.equal(service?.supportsInitialOutcomeClaim, true);
  for (const role of [
    "memory-reflector",
    "managed-memory-writer",
    "git-commit",
  ])
    assert.equal(service.getAgentType(role)?.name, role);
  await session.prompt(
    "Execute the one reviewed offline initialization operation.",
  );
  assert.equal(result?.initialized, true);
  await session.prompt(
    "Check next-request committed projection without inference.",
  );
  assert.equal(projected, true);
  assert.equal(externalRequests, 0);
  console.log(
    JSON.stringify({
      initialized: true,
      revision: result.revision,
      guardedNativeTool: "agent_memory_manage",
      nextRequestProjection: projected,
      transport: "synthetic-faux-zero-external-inference",
      externalRequests,
    }),
  );
} catch {
  // Never return a tool result or seed-containing SDK error/stack.
  console.error(
    "Offline guarded native initialization failed; inspect private root/status and replan. No seed details emitted.",
  );
  process.exitCode = 1;
} finally {
  try {
    if (session)
      await session.extensionRunner.emit({
        type: "session_shutdown",
        reason: "quit",
      });
  } finally {
    session?.dispose();
  }
}
