import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createGuardHost } from "./host.mjs";
import { isAbsolute, relative, resolve, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { evidenceGitCommand } from "./evidence-git.mjs";
import { preferenceBinding } from "../model-profiles.ts";
import { registerRTK } from "../rtk.ts";

const registryKey = Symbol.for("@mahirocoko/pi-guards:healthy-nodes");
const nodes = (globalThis[registryKey] ??= new Map());
// Shared across extension instances: session-created precedes child binding.
// Keep identities for the process lifetime so disposed children cannot become roots.
const nativeChildren = (nodes.nativeChildren ??= new Set());
const nativeParents = (nodes.nativeParents ??= new Map());
const memoryLeases = (nodes.memoryLeases ??= new Map());
const memoryPermission = (root) => {
  if (typeof root !== "string" || !isAbsolute(root) || root !== resolve(root))
    throw new Error("Canonical managed-memory root required");
  return `managed_memory_${createHash("sha256").update(root).digest("hex")}`;
};

// A scoped scalar permission: native unknown-surface maps do not match paths.
const learningPermission = (root) => {
  if (typeof root !== "string" || !isAbsolute(root) || root !== resolve(root))
    throw new Error("Continuity learning root must be canonical and absolute");
  return `continuity_learning_${createHash("sha256").update(root).digest("hex")}`;
};

const resolveGoalProfile = () => {
  const override = process.env.PI_CODING_AGENT_DIR;
  const value =
    override === "~"
      ? homedir()
      : override?.startsWith("~/")
        ? join(homedir(), override.slice(2))
        : override || join(homedir(), ".pi/agent");
  if (
    !isAbsolute(value) ||
    resolve(value) !== value ||
    realpathSync(value) !== value
  )
    throw new Error("Canonical Goal profile required");
  return value;
};

// Execution Run's outer dispatch also requires explicit native configuration.
// This is not a permission parser or grant: the public policy owner remains sole authority.
const assertExecutionRunConfigured = (profile, project) => {
  const file = join(profile, "extensions/mahiro-execution-run/config.json");
  for (const dir of [
    profile,
    join(profile, "extensions"),
    join(profile, "extensions/mahiro-execution-run"),
  ]) {
    const stat = lstatSync(dir);
    if (
      !stat.isDirectory() ||
      realpathSync(dir) !== dir ||
      (stat.mode & 0o7777) !== 0o700 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw Error("Execution Run private configuration required");
  }
  const before = lstatSync(file);
  if (
    !before.isFile() ||
    before.nlink !== 1 ||
    before.size > 16384 ||
    (before.mode & 0o7777) !== 0o600 ||
    (process.getuid && before.uid !== process.getuid())
  )
    throw Error("Execution Run private configuration required");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(16385);
    let size = 0,
      count;
    do {
      count = readSync(fd, buffer, size, buffer.length - size, size);
      size += count;
    } while (count && size < buffer.length);
    const bytes = buffer.subarray(0, size),
      after = fstatSync(fd),
      pathStat = lstatSync(file);
    if (
      bytes.length > 16384 ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.nlink !== 1 ||
      after.mode !== before.mode ||
      after.uid !== before.uid ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      pathStat.ino !== after.ino ||
      pathStat.dev !== after.dev
    )
      throw Error("Execution Run configuration changed");
    const text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes))
      throw Error("Execution Run configuration UTF8 required");
    const config = JSON.parse(text);
    if (
      !config ||
      config.version !== 1 ||
      config.profile !== profile ||
      Object.keys(config).some(
        (k) => !["version", "profile", "projects"].includes(k),
      ) ||
      !Array.isArray(config.projects) ||
      config.projects.length > 32 ||
      new Set(config.projects).size !== config.projects.length ||
      !config.projects.includes(project)
    )
      throw Error("Execution Run explicit project configuration required");
  } finally {
    closeSync(fd);
  }
};

// Load this exact local package root, alongside the exact local upstream roots.
// Child excludedExtensionPackages must contain the subagents package SOURCE,
// never this adapter or permission-system. Upstream's default exclusion is empty.
export default async function activate(pi) {
  let sdk;
  try {
    sdk = await import("@earendil-works/pi-coding-agent");
  } catch (cause) {
    throw new Error(
      "Pi guards inactive: public Pi SDK 1.3.0 peer unavailable; do not run unguarded",
      {
        cause,
      },
    );
  }
  // Root is also a live local package. Public owners may not have been explicitly
  // installed yet: absence must register real denial, not fail module discovery
  // or silently leave native definitions executable. No cache/sibling fallback.
  const require = createRequire(import.meta.url);
  const missing = [];
  for (const name of [
    "@gotgenes/pi-subagents",
    "@gotgenes/pi-permission-system",
  ]) {
    try {
      require.resolve(name);
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
      missing.push(name);
    }
  }
  if (missing.length) {
    const reason = `Mahiro native guards unavailable: missing declared public owners ${missing.join(", ")}. All tool execution is blocked. Explicit dependency installation in the mahiro-pi checkout requires operator approval; see /mh-guards-status.`;
    pi.on("tool_call", () => ({ block: true, reason }));
    pi.on("session_start", (_event, ctx) => {
      nodes.delete(ctx.sessionManager.getSessionId());
      if (ctx.hasUI) ctx.ui.notify(reason, "error");
    });
    pi.registerCommand("mh-guards-status", {
      description: "Explain fail-closed native guard dependency availability",
      handler: async (_args, ctx) => {
        ctx.ui.notify(
          reason +
            " Required after operator approval: pnpm install --offline --frozen-lockfile --ignore-scripts (pnpm 10.33.0); permission-system 40.2.2 + subagents 23.4.1 and both authored patches. No install or activation has been performed.",
          "error",
        );
      },
    });
    for (const name of [
      "Read",
      "Bash",
      "Grep",
      "Find",
      "Ls",
      "Write",
      "Edit",
      "PowerShell",
    ]) {
      const factory = sdk[`create${name}ToolDefinition`];
      if (typeof factory !== "function")
        throw Error(
          "Public native tool factory unavailable; startup cannot assure denial",
        );
      pi.registerTool({
        ...factory(process.cwd()),
        async execute() {
          throw Error(reason);
        },
      });
    }
    return;
  }
  const { getSubagentsService, SUBAGENT_EVENTS } = await import(
    "@gotgenes/pi-subagents"
  );
  const { getPermissionsService } = await import(
    "@gotgenes/pi-permission-system"
  );
  const {
    trustedMetaTool,
    trustedRecallTool,
    trustedMemoryTool,
    trustedCodeMapTool,
    trustedGoalTool,
    goalToolNames,
    trustedEvidenceTool,
    uxWorkflowToolNames,
    trustedUXWorkflowTool,
    trustedExecutionRunTool,
    trustedPreferenceTool,
  } = await import("./provenance.mjs");
  const host = createGuardHost();
  let sessionId,
    sessionManager,
    parentService,
    latched = false;
  const generation = {};
  const children = new Set();
  const unsubscribes = [];
  let registered = false;
  const healthy = (id) => nodes.get(id)?.healthy?.() === true;
  const ownsContext = (ctx) =>
    sessionId &&
    ctx.sessionManager.getSessionId() === sessionId &&
    nodes.get(sessionId)?.generation === generation &&
    healthy(sessionId) &&
    !latched;
  const isPrimarySession = (ctx) => {
    if (
      !ownsContext(ctx) ||
      ctx.signal?.aborted ||
      ctx.sessionManager !== sessionManager ||
      nativeChildren.has(sessionId)
    )
      return false;
    const header = ctx.sessionManager.getHeader?.();
    return (
      header?.type === "session" &&
      header.id === sessionId &&
      header.parentSession === undefined
    );
  };
  const abortOwned = () => {
    latched = true;
    if (!parentService) return;
    // Conservative cancellation includes healthy siblings and queued work.
    for (const record of parentService.listAgents()) {
      if (["running", "queued"].includes(record.status))
        parentService.abort(record.id);
    }
  };
  const preferenceAccess = (feature, tool, ctx, root, operation = "read") => {
    const actual = pi.getAllTools().find((item) => item.name === tool?.name);
    const binding = preferenceBinding(ctx.cwd, feature);
    if (
      !isPrimarySession(ctx) ||
      !binding ||
      root !== binding.root ||
      !trustedPreferenceTool(actual, feature) ||
      !trustedPreferenceTool(tool, feature) ||
      tool.sourceInfo.path !== actual.sourceInfo.path ||
      tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
      !["read", "write"].includes(operation)
    )
      throw Error("Native preference guard unavailable");
    const service = getPermissionsService(sessionId);
    for (const surface of [
      tool.name,
      `${feature.replaceAll("-", "_")}_state_${createHash("sha256").update(root).digest("hex")}`,
    ]) {
      const d = service?.checkPermission(surface);
      if (
        d?.state !== "allow" ||
        d.source !== "tool" ||
        d.toolName !== surface ||
        d.matchedSurface !== surface ||
        d.origin === "yolo"
      )
        throw Error(
          "Preferences require exact tool/root owner winning-surface permissions",
        );
    }
    for (const path of [
      root,
      join(root, "state.json"),
      join(root, "state.lock"),
    ])
      for (const surface of operation === "read"
        ? ["read", "path_read"]
        : ["read", "path_read", "path_write"]) {
        const d = service?.checkPermission(surface, path);
        if (d?.matchedPattern !== undefined && d.state !== "allow")
          throw Error("Preference path denied");
      }
  };
  const rtk = registerRTK(pi, {
    access: (ctx, root, operation) =>
      preferenceAccess(
        "rtk",
        pi.getAllTools().find((t) => t.name === "mh_rtk"),
        ctx,
        root,
        operation,
      ),
    finalArgs: (name, args, ctx) => host.finalArgs(name, args, ctx),
    permission: (ctx, surface, value) =>
      ownsContext(ctx)
        ? getPermissionsService(sessionId)?.checkPermission(surface, value)
        : undefined,
    current: isPrimarySession,
  });
  const names = [
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "write",
    "edit",
    "powershell",
  ];
  for (const name of names) {
    const nativeName =
      name === "powershell"
        ? "PowerShell"
        : name[0].toUpperCase() + name.slice(1);
    const factory = sdk[`create${nativeName}ToolDefinition`];
    if (typeof factory !== "function") {
      host.dispose();
      throw new Error(
        `Pi guards inactive: missing public native ${name} factory`,
      );
    }
    // Native definitions retain parameters, results, renderers and structured output.
    const native = factory(process.cwd());
    pi.registerTool({
      ...native,
      async execute(id, input, signal, update, ctx) {
        if (!ownsContext(ctx))
          throw new Error("Pi guard node unhealthy; execution blocked");
        if (name === "powershell")
          throw new Error(
            "Pi guard: PowerShell classifier unsupported; execution blocked",
          );
        const classifierName =
          { find: "find_files", ls: "list_dir" }[name] ?? name;
        if (
          name === "bash" &&
          getPermissionsService(sessionId)?.checkPermission(
            "bash",
            input.command,
          )?.state !== "allow"
        )
          throw Error("Native final Bash permission denied");
        const args = await host.finalArgs(classifierName, input, ctx);
        const final = name === "bash" ? await rtk.transform(args, ctx) : args;
        if (signal?.aborted || !ownsContext(ctx))
          throw new Error("Pi guard node unavailable; execution blocked");
        if (
          name === "bash" &&
          getPermissionsService(sessionId)?.checkPermission(
            "bash",
            final.command,
          )?.state !== "allow"
        )
          throw Error("Native final Bash permission denied");
        return native.execute(id, final, signal, update, ctx);
      },
    });
  }
  for (const tool of host.tools.values()) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_id, input, signal, _update, ctx) {
        if (!ownsContext(ctx))
          throw new Error("Pi guard node unhealthy; execution blocked");
        const args = await host.finalArgs(tool.name, input, ctx);
        if (signal?.aborted || !ownsContext(ctx))
          throw new Error("Pi guard node unavailable; execution blocked");
        const result = await tool.run({ cwd: ctx.cwd, args, signal });
        if (result.status === "error")
          throw new Error(
            result.error || "Filtered configuration read failed.",
          );
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    });
  }
  const supported = new Set([...names, ...host.tools.keys(), "codemode"]);
  unsubscribes.push(
    pi.on("tool_call", (event, ctx) => {
      const tool = pi
        .getAllTools()
        .find((tool) => tool.name === event.toolName);
      if (
        [
          "mh_list_model_profiles",
          "mh_set_model_profile",
          "mh_delete_model_profile",
          "mh_switch_model_profile",
          "mh_rtk",
        ].includes(event.toolName)
      ) {
        try {
          const feature =
            event.toolName === "mh_rtk" ? "rtk" : "model-profiles";
          const binding = preferenceBinding(ctx.cwd, feature);
          if (!binding) throw Error("Preference feature disabled");
          const read =
            event.toolName === "mh_list_model_profiles" ||
            (event.toolName === "mh_rtk" && event.input?.operation !== "mode");
          preferenceAccess(
            feature,
            tool,
            ctx,
            binding.root,
            read ? "read" : "write",
          );
        } catch {
          return {
            block: true,
            reason:
              "Pi guard: native preferences require canonical primary context and exact tool/root permissions",
          };
        }
        return;
      }
      if (event.toolName === "mh_execution_run") {
        try {
          const root = join(
            resolveGoalProfile(),
            "workflow/execution-run",
            createHash("sha256").update(ctx.cwd).digest("hex"),
          );
          const abi = nodes.get(sessionId)?.executionRun;
          if (!abi) throw Error("Execution Run unavailable");
          abi.assertAccess(
            tool,
            ctx,
            root,
            event.input?.operation === "get" ? "read" : "write",
          );
        } catch {
          return {
            block: true,
            reason:
              "Pi guard: Execution Run requires canonical primary context and exact tool/root permission",
          };
        }
        return;
      }
      if (uxWorkflowToolNames.includes(event.toolName)) {
        try {
          const root = join(
            resolveGoalProfile(),
            "workflow/ux-workflow",
            createHash("sha256").update(ctx.cwd).digest("hex"),
          );
          const abi = nodes.get(sessionId)?.uxWorkflow;
          if (!abi) throw Error("UX workflow unavailable");
          abi.assertAccess(
            tool,
            ctx,
            root,
            event.toolName === "mh_get_ux_workflow" ? "read" : "write",
          );
        } catch {
          return {
            block: true,
            reason:
              "Pi guard: UX workflow requires canonical primary context and exact tool/root permission",
          };
        }
        return;
      }
      if (event.toolName === "mh_code_evidence") {
        try {
          const root = join(
            resolveGoalProfile(),
            "workflow/evidence",
            createHash("sha256").update(ctx.cwd).digest("hex"),
          );
          const abi = nodes.get(sessionId)?.evidence;
          if (!abi) throw Error("Evidence unavailable");
          abi.assertAccess(
            tool,
            ctx,
            root,
            event.input?.action === "get" ? "read" : "write",
          );
        } catch {
          return {
            block: true,
            reason:
              "Pi guard: Evidence requires canonical primary context and exact tool plus project-root permission",
          };
        }
        return;
      }
      if (goalToolNames.includes(event.toolName)) {
        try {
          const profile = resolveGoalProfile();
          const root = join(
            profile,
            "workflow/goals",
            createHash("sha256").update(ctx.cwd).digest("hex"),
          );
          const abi = nodes.get(sessionId)?.goal;
          if (!abi) throw new Error("Goal unavailable");
          abi.assertAccess(
            tool,
            ctx,
            root,
            event.toolName === "mh_get_goal" ? "read" : "write",
          );
        } catch {
          return {
            block: true,
            reason:
              "Pi guard: Goal requires canonical primary context and exact tool plus project-root permission",
          };
        }
        return;
      }
      if (event.toolName === "mh_code_map") {
        try {
          nodes.get(sessionId)?.codeMap?.assertAccess(tool, ctx);
        } catch {
          return {
            block: true,
            reason:
              "Pi guard: Code Map requires canonical provenance, healthy context and named permission",
          };
        }
        if (!nodes.get(sessionId)?.codeMap)
          return { block: true, reason: "Pi guard: Code Map unavailable" };
        return;
      }
      if (
        !supported.has(event.toolName) &&
        !trustedMetaTool(tool) &&
        !trustedRecallTool(tool) &&
        !trustedMemoryTool(tool)
      ) {
        return {
          block: true,
          reason: "Pi guard: unsupported tool/alias dispatch blocked",
        };
      }
    }),
  );
  unsubscribes.push(
    pi.on("session_start", (_event, ctx) => {
      const id = ctx.sessionManager.getSessionId();
      if (sessionId && sessionId !== id)
        throw new Error("Pi guard session ownership changed; reload required");
      sessionId = id;
      sessionManager = ctx.sessionManager;
      // Capture once. A child's singleton publication must not replace this service.
      parentService ??= getSubagentsService();
      if (!registered) return;
      // Pi may reject a conflicting tool after its factory has returned while
      // retaining the extension's event handlers. Confirm actual public tool
      // ownership before publishing any health assurance.
      const owner = realpathSync(fileURLToPath(import.meta.url));
      const actualTools = pi.getAllTools();
      const complete = [...names, ...host.tools.keys()].every((name) => {
        const tool = actualTools.find((tool) => tool.name === name);
        // Child tool restrictions can make a registration unreachable. Only
        // publicly dispatchable names need an executable owner in this node.
        if (!tool) return true;
        try {
          return realpathSync(tool.sourceInfo.path) === owner;
        } catch {
          return false;
        }
      });
      if (!complete) {
        registered = false;
        host.dispose();
        return;
      }
      nodes.set(id, {
        generation,
        host,
        modelProfiles: {
          version: 1,
          generation,
          assertAccess: (tool, ctx, root, operation) =>
            preferenceAccess("model-profiles", tool, ctx, root, operation),
        },
        codeMap: {
          version: 1,
          generation,
          assertAccess(tool, ctx) {
            const actual = pi
              .getAllTools()
              .find((item) => item.name === "mh_code_map");
            if (
              !ownsContext(ctx) ||
              ctx.sessionManager !== sessionManager ||
              ctx.signal?.aborted ||
              !trustedCodeMapTool(actual) ||
              !trustedCodeMapTool(tool) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir
            )
              throw new Error("Code Map guard unavailable");
            const grant =
              getPermissionsService(sessionId)?.checkPermission("mh_code_map");
            // Only the policy owner's ACTUAL winning surface is authority.
            // Old/unpatched services lack this optional attestation and fail closed.
            if (
              grant?.state !== "allow" ||
              grant.source !== "tool" ||
              grant.toolName !== "mh_code_map" ||
              grant.origin === "yolo" ||
              grant.matchedSurface !== "mh_code_map"
            )
              throw new Error(
                "Code Map requires existing named permission and owner winning-surface attestation",
              );
          },
        },
        goal: {
          version: 1,
          generation,
          assertAccess(tool, ctx, root, operation = "read") {
            const actual = pi
              .getAllTools()
              .find((item) => item.name === tool?.name);
            const profile = resolveGoalProfile();
            const expected = join(
              profile,
              "workflow/goals",
              createHash("sha256").update(ctx.cwd).digest("hex"),
            );
            if (
              !isPrimarySession(ctx) ||
              !trustedGoalTool(actual) ||
              !trustedGoalTool(tool) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              realpathSync(ctx.cwd) !== ctx.cwd ||
              /(?:^|[^a-z0-9])one[-_ ]?deex?(?:$|[^a-z0-9])/i.test(ctx.cwd) ||
              root !== expected ||
              !["read", "write"].includes(operation)
            )
              throw new Error("Goal guard unavailable");
            const service = getPermissionsService(sessionId);
            const capability = `goal_state_${createHash("sha256").update(root).digest("hex")}`;
            for (const surface of [tool.name, capability]) {
              const grant = service?.checkPermission(surface);
              if (
                grant?.state !== "allow" ||
                grant.source !== "tool" ||
                grant.toolName !== surface ||
                grant.origin === "yolo" ||
                grant.matchedSurface !== surface
              )
                throw new Error(
                  "Goal requires exact named tool and root permissions with owner winning-surface attestation",
                );
            }
            for (const target of [
              root,
              join(root, "state.json"),
              join(root, "state.lock"),
            ]) {
              const decision = service?.checkPermission(
                operation === "read" ? "path_read" : "path_write",
                target,
              );
              if (
                decision?.matchedPattern !== undefined &&
                decision.state !== "allow"
              )
                throw new Error("Goal path denied");
            }
          },
          async authorize(tool, ctx, root, operation = "read", signal) {
            nodes.get(sessionId)?.goal.assertAccess(tool, ctx, root, operation);
            if (signal?.aborted || !ownsContext(ctx))
              throw new Error("Goal cancelled");
            // No fallback approval or policy parser: existing exact scalar decisions
            // and applicable path denials above are the sole permission owner.
            nodes.get(sessionId)?.goal.assertAccess(tool, ctx, root, operation);
          },
        },
        uxWorkflow: {
          version: 1,
          generation,
          assertAccess(tool, ctx, root, operation = "read") {
            const actual = pi
              .getAllTools()
              .find((item) => item.name === tool?.name);
            const expected = join(
              resolveGoalProfile(),
              "workflow/ux-workflow",
              createHash("sha256").update(ctx.cwd).digest("hex"),
            );
            if (
              !isPrimarySession(ctx) ||
              !trustedUXWorkflowTool(actual) ||
              !trustedUXWorkflowTool(tool) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              realpathSync(ctx.cwd) !== ctx.cwd ||
              /(?:^|[^a-z0-9])one[-_ ]?deex?(?:$|[^a-z0-9])/i.test(ctx.cwd) ||
              root !== expected ||
              !["read", "write"].includes(operation)
            )
              throw Error("UX workflow guard unavailable");
            const service = getPermissionsService(sessionId),
              capability = `ux_workflow_state_${createHash("sha256").update(root).digest("hex")}`;
            for (const surface of [tool.name, capability]) {
              const grant = service?.checkPermission(surface);
              if (
                grant?.state !== "allow" ||
                grant.source !== "tool" ||
                grant.toolName !== surface ||
                grant.origin === "yolo" ||
                grant.matchedSurface !== surface
              )
                throw Error(
                  "UX workflow requires exact named tool/root permissions and owner winning-surface attestation",
                );
            }
            for (const target of [
              root,
              join(root, "state.json"),
              join(root, "state.lock"),
            ]) {
              // Every operation reads the old state; a read denial also gates writes.
              for (const surface of operation === "read"
                ? ["read", "path_read"]
                : ["read", "path_read", "path_write"]) {
                const decision = service?.checkPermission(surface, target);
                if (
                  decision?.matchedPattern !== undefined &&
                  decision.state !== "allow"
                )
                  throw Error("UX workflow path denied");
              }
            }
          },
          async authorize(tool, ctx, root, operation = "read", signal) {
            nodes
              .get(sessionId)
              ?.uxWorkflow.assertAccess(tool, ctx, root, operation);
            if (signal?.aborted || !ownsContext(ctx))
              throw Error("UX workflow cancelled");
            nodes
              .get(sessionId)
              ?.uxWorkflow.assertAccess(tool, ctx, root, operation);
          },
        },
        executionRun: {
          version: 1,
          generation,
          assertAccess(tool, ctx, root, operation = "read") {
            const actual = pi
              .getAllTools()
              .find((item) => item.name === "mh_execution_run");
            const profile = resolveGoalProfile();
            const expected = join(
              profile,
              "workflow/execution-run",
              createHash("sha256").update(ctx.cwd).digest("hex"),
            );
            if (
              !isPrimarySession(ctx) ||
              !trustedExecutionRunTool(actual) ||
              !trustedExecutionRunTool(tool) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              realpathSync(ctx.cwd) !== ctx.cwd ||
              /(?:^|[^a-z0-9])one[-_ ]?deex?(?:$|[^a-z0-9])/i.test(ctx.cwd) ||
              root !== expected ||
              !["read", "write"].includes(operation)
            )
              throw Error("Execution Run guard unavailable");
            assertExecutionRunConfigured(profile, ctx.cwd);
            const service = getPermissionsService(sessionId),
              capability = `execution_run_state_${createHash("sha256").update(root).digest("hex")}`;
            for (const surface of ["mh_execution_run", capability]) {
              const grant = service?.checkPermission(surface);
              if (
                grant?.state !== "allow" ||
                grant.source !== "tool" ||
                grant.toolName !== surface ||
                grant.origin === "yolo" ||
                grant.matchedSurface !== surface
              )
                throw Error(
                  "Execution Run requires exact named tool/root permissions and owner winning-surface attestation",
                );
            }
            for (const target of [
              root,
              join(root, "state.json"),
              join(root, "state.lock"),
            ]) {
              for (const surface of operation === "read"
                ? ["read", "path_read"]
                : ["read", "path_read", "path_write"]) {
                const decision = service?.checkPermission(surface, target);
                if (
                  decision?.matchedPattern !== undefined &&
                  decision.state !== "allow"
                )
                  throw Error("Execution Run path denied");
              }
            }
          },
          async authorize(tool, ctx, root, operation = "read", signal) {
            nodes
              .get(sessionId)
              ?.executionRun.assertAccess(tool, ctx, root, operation);
            if (signal?.aborted || !ownsContext(ctx))
              throw Error("Execution Run cancelled");
            nodes
              .get(sessionId)
              ?.executionRun.assertAccess(tool, ctx, root, operation);
          },
        },
        evidence: {
          version: 1,
          generation,
          assertAccess(tool, ctx, root, operation = "read") {
            const actual = pi
              .getAllTools()
              .find((item) => item.name === "mh_code_evidence");
            const expected = join(
              resolveGoalProfile(),
              "workflow/evidence",
              createHash("sha256").update(ctx.cwd).digest("hex"),
            );
            if (
              !isPrimarySession(ctx) ||
              !trustedEvidenceTool(actual) ||
              !trustedEvidenceTool(tool) ||
              tool.sourceInfo.path !== actual.sourceInfo.path ||
              tool.sourceInfo.baseDir !== actual.sourceInfo.baseDir ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              realpathSync(ctx.cwd) !== ctx.cwd ||
              /(?:^|[^a-z0-9])one[-_ ]?deex?(?:$|[^a-z0-9])/i.test(ctx.cwd) ||
              root !== expected ||
              !["read", "write"].includes(operation)
            )
              throw Error("Evidence guard unavailable");
            const service = getPermissionsService(sessionId),
              capability = `code_evidence_state_${createHash("sha256").update(root).digest("hex")}`;
            for (const surface of ["mh_code_evidence", capability]) {
              const grant = service?.checkPermission(surface);
              if (
                grant?.state !== "allow" ||
                grant.source !== "tool" ||
                grant.toolName !== surface ||
                grant.origin === "yolo" ||
                grant.matchedSurface !== surface
              )
                throw Error(
                  "Evidence requires exact named tool/root permissions and owner winning-surface attestation",
                );
            }
            for (const target of [
              root,
              join(root, "state.json"),
              join(root, "state.lock"),
            ]) {
              const decision = service?.checkPermission(
                operation === "read" ? "path_read" : "path_write",
                target,
              );
              if (
                decision?.matchedPattern !== undefined &&
                decision.state !== "allow"
              )
                throw Error("Evidence path denied");
            }
          },
          async authorize(tool, ctx, root, operation = "read", signal) {
            nodes
              .get(sessionId)
              ?.evidence.assertAccess(tool, ctx, root, operation);
            if (signal?.aborted || !ownsContext(ctx))
              throw Error("Evidence cancelled");
            nodes
              .get(sessionId)
              ?.evidence.assertAccess(tool, ctx, root, operation);
          },
          assertSources(tool, ctx, root, operation, paths) {
            nodes
              .get(sessionId)
              ?.evidence.assertAccess(tool, ctx, root, operation);
            if (!Array.isArray(paths) || paths.length > 8192)
              throw Error("Evidence source set unavailable");
            const service = getPermissionsService(sessionId);
            if (!service) throw Error("Evidence source owner unavailable");
            const targets = new Set();
            for (const target of paths) {
              if (
                typeof target !== "string" ||
                !isAbsolute(target) ||
                resolve(target) !== target ||
                (target !== ctx.cwd && !target.startsWith(ctx.cwd + "/"))
              )
                throw Error("Evidence source outside project");
              // Check the lexical historical path even if missing; never replace
              // it with only a parent decision. Existing ancestors must be canonical.
              const chain = [ctx.cwd];
              let current = ctx.cwd;
              for (const part of relative(ctx.cwd, target)
                .split("/")
                .filter(Boolean)) {
                current = join(current, part);
                chain.push(current);
              }
              for (const path of chain) targets.add(path);
            }
            for (const path of targets) {
              for (const surface of ["read", "path_read"]) {
                const decision = service.checkPermission(surface, path);
                if (
                  decision?.matchedPattern !== undefined &&
                  decision.state !== "allow"
                )
                  throw Error("Evidence source read path denied");
              }
              try {
                if (
                  lstatSync(path).isSymbolicLink() ||
                  realpathSync(path) !== path
                )
                  throw Error("Evidence source symlink unsupported");
              } catch (error) {
                if (error.code !== "ENOENT") throw error;
              }
            }
          },
          async authorizeGit(
            tool,
            ctx,
            root,
            operation,
            executable,
            args,
            signal,
          ) {
            const assert = () => {
              nodes
                .get(sessionId)
                ?.evidence.assertAccess(tool, ctx, root, operation);
              if (signal?.aborted || !ownsContext(ctx))
                throw Error("Evidence Git cancelled");
            };
            assert();
            const command = evidenceGitCommand(executable, args);
            const transformed = await host.finalArgs("bash", { command }, ctx);
            if (
              transformed.command !== command ||
              Object.keys(transformed).some((key) => key !== "command")
            )
              throw Error("Evidence Git transformation rejected");
            assert();
            const service = getPermissionsService(sessionId);
            if (service?.checkPermission("bash", command).state !== "allow")
              throw Error(
                "Evidence Git requires existing narrow Bash permission",
              );
            for (const target of [ctx.cwd, join(ctx.cwd, ".git")]) {
              for (const surface of ["read", "path_read"]) {
                const decision = service?.checkPermission(surface, target);
                if (
                  decision?.matchedPattern !== undefined &&
                  decision.state !== "allow"
                )
                  throw Error("Evidence Git read path denied");
              }
            }
            assert();
          },
        },
        managedMemory: {
          version: 1,
          generation,
          permission: memoryPermission,
          trustedTool: trustedMemoryTool,
          isPrimarySession,
          parentService: () =>
            isPrimarySession({ sessionManager, cwd: process.cwd() })
              ? parentService
              : undefined,
          assertAccess(tool, ctx, root, operation = "read", target = root) {
            const expected =
              process.env.MAHIRO_AGENT_MEMORY_ROOT ??
              join(homedir(), ".pi/agent/memory");
            if (
              !ownsContext(ctx) ||
              ctx.sessionManager !== sessionManager ||
              ctx.signal?.aborted ||
              !trustedMemoryTool(tool) ||
              !["read", "write"].includes(operation) ||
              !isAbsolute(root) ||
              root !== resolve(root) ||
              !isAbsolute(expected) ||
              root !== resolve(expected) ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              /(?:^|[^a-z0-9])one[-_ ]?deex?(?:$|[^a-z0-9])/i.test(ctx.cwd)
            )
              throw new Error("Managed memory unavailable");
            if (
              typeof target !== "string" ||
              !isAbsolute(target) ||
              target !== resolve(target) ||
              (target !== root && !target.startsWith(`${root}/`))
            )
              throw new Error("Managed memory path unavailable");
            const primary = isPrimarySession(ctx);
            let ownerId = sessionId;
            let lease;
            if (!primary) {
              if (
                ["agent_memory_manage", "agent_memory_reflect"].includes(
                  tool.name,
                )
              )
                throw new Error("Managed worker operation unavailable");
              ownerId = nativeParents.get(sessionId);
              const owner = nodes.get(ownerId);
              const outputFile = sessionManager.getSessionFile?.();
              if (
                !ownerId ||
                !owner?.healthy() ||
                typeof outputFile !== "string"
              )
                throw new Error("Native memory binding unavailable");
              const matches = [...memoryLeases.values()].filter((item) => {
                if (
                  item.ownerId !== ownerId ||
                  item.generation !== owner.generation ||
                  item.root !== root ||
                  !item.active()
                )
                  return false;
                const record = item.service.getRecord(item.jobId);
                return (
                  record?.type === "managed-memory-writer" &&
                  record.status === "running" &&
                  typeof record.outputFile === "string" &&
                  record.outputFile === outputFile
                );
              });
              if (matches.length !== 1)
                throw new Error("Native memory binding unavailable");
              lease = matches[0];
            }
            const service = getPermissionsService(ownerId);
            const grant = service?.checkPermission(memoryPermission(root));
            const toolGrant = getPermissionsService(sessionId)?.checkPermission(
              tool.name,
            );
            const path = service?.checkPermission(
              operation === "read" ? "path_read" : "path_write",
              target,
            );
            if (
              !service ||
              grant?.state !== "allow" ||
              grant.source === "default" ||
              toolGrant?.state !== "allow" ||
              (path?.matchedPattern !== undefined && path.state !== "allow")
            )
              throw new Error(
                "Managed memory requires separate existing permission",
              );
            return primary
              ? { kind: "primary" }
              : { kind: "worker", value: lease.value };
          },
          async authorize(tool, ctx, root, operation = "read", signal) {
            const access = nodes
              .get(sessionId)
              .managedMemory.assertAccess(tool, ctx, root, operation);
            const args = await host.finalArgs(
              operation === "read" ? "read" : "write",
              { path: root },
              ctx,
            );
            if (args.path !== root || signal?.aborted)
              throw new Error("Managed memory blocked");
            nodes
              .get(sessionId)
              .managedMemory.assertAccess(tool, ctx, root, operation);
            return access;
          },
          bindWorker(tool, ctx, root, jobId, value, active) {
            nodes
              .get(sessionId)
              .managedMemory.assertAccess(tool, ctx, root, "write");
            if (
              !isPrimarySession(ctx) ||
              typeof active !== "function" ||
              !parentService ||
              parentService.supportsInitialOutcomeClaim !== true
            )
              throw new Error("Managed memory binding unavailable");
            const record = parentService.getRecord(jobId);
            const role = parentService.getAgentType("managed-memory-writer");
            const tools = [
              "agent_memory_read",
              "agent_memory_edit",
              "agent_memory_commit",
            ];
            if (
              !record ||
              record.type !== "managed-memory-writer" ||
              !["running", "queued"].includes(record.status) ||
              !role ||
              role.name !== "managed-memory-writer" ||
              role.locked !== true ||
              role.inheritContext !== false ||
              role.promptMode !== "replace" ||
              role.runInBackground !== true ||
              role.model !== "openai/gpt-6.1-sol" ||
              role.thinking !== "medium" ||
              role.toolNames?.length !== tools.length ||
              tools.some((name) => !role.toolNames.includes(name)) ||
              memoryLeases.has(jobId)
            )
              throw new Error("Managed memory role binding unavailable");
            const lease = {
              ownerId: sessionId,
              generation,
              root,
              jobId,
              service: parentService,
              value,
              active,
            };
            memoryLeases.set(jobId, lease);
            return () => {
              if (memoryLeases.get(jobId) === lease) memoryLeases.delete(jobId);
            };
          },
        },
        continuity: {
          version: 1,
          generation,
          trustedTool: trustedRecallTool,
          isPrimarySession,
          learningPermission,
          authorizeLearning(ctx, root, target = root) {
            const expected =
              process.env.MAHIRO_CONTINUITY_ROOT ??
              join(homedir(), ".pi/agent/continuity");
            if (
              !isPrimarySession(ctx) ||
              !isAbsolute(root) ||
              root !== resolve(root) ||
              !isAbsolute(expected) ||
              root !== resolve(expected) ||
              !isAbsolute(target) ||
              target !== resolve(target) ||
              (target !== root && !target.startsWith(`${root}/`)) ||
              !isAbsolute(ctx.cwd) ||
              ctx.cwd !== resolve(ctx.cwd) ||
              /(?:^|[^a-z0-9])one[-_ ]?deex?(?:$|[^a-z0-9])/i.test(ctx.cwd)
            )
              throw new Error("Continuity learning unavailable");
            const service = getPermissionsService(sessionId);
            const pathWrite = service?.checkPermission("path_write", target);
            const learning = service?.checkPermission(learningPermission(root));
            if (
              !service ||
              learning.state !== "allow" ||
              learning.source === "default" ||
              (pathWrite.matchedPattern !== undefined &&
                pathWrite.state !== "allow")
            )
              throw new Error(
                "Continuity learning requires existing permission",
              );
          },
          async authorizeRead(tool, path, ctx, signal) {
            if (
              !ownsContext(ctx) ||
              !trustedRecallTool(tool) ||
              signal?.aborted ||
              !isAbsolute(path)
            )
              throw new Error("Continuity guard unavailable");
            const args = await host.finalArgs("read", { path }, ctx);
            if (
              args.path !== path ||
              Object.keys(args).some((key) => key !== "path") ||
              !ownsContext(ctx) ||
              signal?.aborted
            )
              throw new Error("Continuity read blocked");
            const service = getPermissionsService(sessionId);
            const outside = relative(ctx.cwd, path);
            const pathRead = service?.checkPermission("path_read", path);
            if (
              !service ||
              service.checkPermission(tool.name).state !== "allow" ||
              service.checkPermission("read", path).state !== "allow" ||
              // Native path gate skips only an unmatched universal fallback.
              (pathRead.matchedPattern !== undefined &&
                pathRead.state !== "allow") ||
              ((outside === ".." ||
                outside.startsWith("../") ||
                isAbsolute(outside)) &&
                service.checkPermission("external_directory_read", path)
                  .state !== "allow")
            )
              throw new Error("Continuity read requires existing permission");
          },
          // Future orchestrators may only obtain this node's captured service while healthy.
          parentService: () =>
            ownsContext({ sessionManager: { getSessionId: () => id } })
              ? parentService
              : undefined,
        },
        healthy: () =>
          registered &&
          nodes.get(id)?.generation === generation &&
          host.healthy &&
          !!getPermissionsService(id) &&
          !latched,
      });
      rtk.initialize(ctx);
    }),
  );
  unsubscribes.push(
    pi.events.on("subagents:child:session-created", (event) => {
      if (typeof event.sessionId === "string") {
        nativeChildren.add(event.sessionId);
        if (typeof event.parentSessionId === "string")
          nativeParents.set(event.sessionId, event.parentSessionId);
      }
    }),
  );
  unsubscribes.push(
    pi.events.on("subagents:child:bound", (event) => {
      if (typeof event.sessionId === "string")
        nativeChildren.add(event.sessionId);
      if (event.parentSessionId !== sessionId) return;
      children.add(event.sessionId);
      if (!parentService || !healthy(event.sessionId) || latched) abortOwned();
    }),
  );
  unsubscribes.push(
    pi.events.on("subagents:child:disposed", (event) => {
      children.delete(event.sessionId);
    }),
  );
  unsubscribes.push(
    pi.events.on(SUBAGENT_EVENTS.RESUMING, (event) => {
      if (!parentService?.getRecord(event.id)) return;
      if ([...children].some((id) => !healthy(id))) latched = true;
      if (latched) abortOwned();
    }),
  );
  const dispose = () => {
    registered = false;
    if (nodes.get(sessionId)?.generation === generation)
      nodes.delete(sessionId);
    for (const [jobId, lease] of memoryLeases)
      if (lease.ownerId === sessionId && lease.generation === generation)
        memoryLeases.delete(jobId);
    host.dispose();
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe?.();
  };
  unsubscribes.push(pi.on("session_shutdown", dispose));
  registered = true;
}
