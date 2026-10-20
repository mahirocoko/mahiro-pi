import activateSecrets from "./mahiro-secret-read-guard.js";
import activateAttribution from "./mahiro-commit-attribution-guard.js";

// A focused implementation of the two canonical factories' registration ABI.
export function createGuardHost() {
  const controller = new AbortController();
  const checks = new Map();
  const tools = new Map();
  const transforms = new Set();
  const diagnostics = [];
  const register = (map, key, value) => {
    if (map.has(key)) throw new Error(`Duplicate guard registration: ${key}`);
    map.set(key, value);
    return () => map.delete(key);
  };
  const host = {
    signal: controller.signal,
    capabilities: { permissions: true, tools: true, events: { tools: true } },
    permissions: {
      register: (entry) => register(checks, entry.id, entry.check),
    },
    tools: { register: (tool) => register(tools, tool.name, tool) },
    events: {
      on(name, handler) {
        if (name !== "tool_start")
          throw new Error(`Unsupported guard event: ${name}`);
        transforms.add(handler);
        return () => transforms.delete(handler);
      },
    },
    diagnostics: { report: (entry) => diagnostics.push(entry) },
  };
  const disposers = [];
  try {
    disposers.push(activateSecrets(host), activateAttribution(host));
    if (
      checks.size !== 2 ||
      tools.size !== 4 ||
      transforms.size !== 1 ||
      diagnostics.length
    ) {
      throw new Error("Canonical guard ABI incomplete");
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose?.();
    controller.abort();
    throw error;
  }
  return {
    tools,
    get healthy() {
      return (
        !controller.signal.aborted && checks.size === 2 && tools.size === 4
      );
    },
    async finalArgs(name, input, ctx) {
      if (controller.signal.aborted)
        throw new Error("Pi guard generation disposed; tool blocked");
      let args = structuredClone(input);
      const context = { cwd: ctx.cwd, memfs: { enabled: false } };
      for (const transform of transforms) {
        const result = await transform(
          { toolName: name, args, cwd: ctx.cwd },
          context,
        );
        if (result?.args) args = result.args;
      }
      for (const check of checks.values()) {
        const verdict = await check(
          { phase: "execution", toolName: name, args, cwd: ctx.cwd },
          context,
        );
        if (verdict !== undefined)
          throw new Error(verdict.reason || "Canonical guard blocked tool");
      }
      if (controller.signal.aborted)
        throw new Error("Pi guard generation disposed; tool blocked");
      return args;
    },
    dispose() {
      if (controller.signal.aborted) return;
      for (const dispose of disposers.reverse()) dispose?.();
      controller.abort();
    },
  };
}
