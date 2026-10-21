import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  applyRun,
  formatRunList,
  response,
  runAt,
  targetById,
  validateInput,
  type Run,
} from "./model.ts";
import {
  readRunState,
  resolveRunBinding,
  stateTicket,
  transactRun,
} from "./store.ts";

const name = "mh_execution_run";
const guardKey = Symbol.for("@mahirocoko/pi-guards:healthy-nodes");
export const help =
  "Execution Run metadata: status | get | list | abandon <revision> [note] | abandon <exact-run-id> <revision> [note] | clear <revision> | clear <exact-run-id> <revision>. Abandon/clear require public UI confirmation, not actor proof from command text. Clear is terminal-only; abandon nonterminal-only. No moves, unlock --force, executors or proof. Live TSK owns current tasks/outcomes/evidence/human acceptance.";
export function createRunRuntime(pi: ExtensionAPI) {
  let epoch = 0;
  const views = new Map<string, Awaited<ReturnType<typeof read>>>();
  const invalidate = () => {
    epoch++;
    views.clear();
  };
  for (const event of [
    "session_start",
    "session_shutdown",
    "session_before_switch",
    "session_before_fork",
    "session_before_tree",
  ] as const)
    pi.on(event, invalidate);
  function capture(
    ctx: ExtensionContext,
    operation: "read" | "write",
    signal?: AbortSignal,
  ) {
    const binding = resolveRunBinding(ctx.cwd);
    if (!binding)
      throw Error("Canonical Execution Run project binding unavailable");
    const sessionId = ctx.sessionManager.getSessionId();
    if (
      typeof sessionId !== "string" ||
      !sessionId.trim() ||
      sessionId.length > 240
    )
      throw Error("Concrete native session required");
    binding.sessionId = sessionId;
    const manager = ctx.sessionManager,
      capturedEpoch = epoch;
    const node = (globalThis as any)[guardKey]?.get(sessionId),
      abi = node?.executionRun;
    const assertCurrent = () => {
      if (
        signal?.aborted ||
        ctx.signal?.aborted ||
        epoch !== capturedEpoch ||
        manager !== ctx.sessionManager ||
        manager.getSessionId() !== sessionId ||
        ctx.cwd !== binding.project ||
        (globalThis as any)[guardKey]?.get(sessionId) !== node ||
        !node?.healthy?.() ||
        abi?.version !== 1 ||
        abi.generation !== node.generation ||
        typeof abi.assertAccess !== "function" ||
        typeof abi.authorize !== "function"
      )
        throw Error(
          "Execution Run context/generation cancelled or unavailable",
        );
      abi.assertAccess(
        pi.getAllTools().find((t) => t.name === name),
        ctx,
        binding.root,
        operation,
      );
    };
    const authorize = async () => {
      assertCurrent();
      await abi.authorize(
        pi.getAllTools().find((t) => t.name === name),
        ctx,
        binding.root,
        operation,
        signal,
      );
      assertCurrent();
    };
    return { binding, manager, node, capturedEpoch, assertCurrent, authorize };
  }
  async function read(ctx: ExtensionContext, signal?: AbortSignal) {
    const access = capture(ctx, "read", signal);
    await access.authorize();
    const state = readRunState(access.binding);
    const view = { ...access, state, ticket: stateTicket(state) };
    views.set(access.binding.sessionId, view);
    return view;
  }
  async function run(args: any, ctx: ExtensionContext, signal?: AbortSignal) {
    validateInput(args);
    if (args.workspace !== undefined && args.workspace !== ctx.cwd)
      throw Error("Workspace must select authorized current project");
    if (args.operation === "get") {
      const view = await read(ctx, signal);
      return response(runAt(view.state, view.binding));
    }
    const access = capture(ctx, "write", signal);
    await access.authorize();
    const view = views.get(access.binding.sessionId);
    if (
      !view ||
      view.capturedEpoch !== epoch ||
      view.manager !== access.manager ||
      view.node !== access.node ||
      view.binding.configHash !== access.binding.configHash ||
      view.binding.configIdentity !== access.binding.configIdentity ||
      view.binding.root !== access.binding.root
    )
      throw Error(
        "Read mh_execution_run operation get before mutation in this context",
      );
    const { operation, ...input } = args;
    const result = await transactRun(
      access.binding,
      view.ticket,
      access.authorize,
      (state) => applyRun(state, access.binding, operation, input),
      access.assertCurrent,
    );
    views.delete(access.binding.sessionId);
    return response(result as Run);
  }
  async function command(input: string, ctx: ExtensionContext) {
    const text = input.trim();
    if (["help", "-h", "--help"].includes(text)) return help;
    // Parse the entire selector before reads/UI. A wrong explicit ID NEVER falls back.
    let operation: "abandon" | "clear" | undefined,
      explicitId: string | undefined,
      revision: number | undefined,
      note: string | undefined;
    if (!["", "status", "get", "list"].includes(text)) {
      const match = text.match(
        /^(abandon|clear)\s+(?:(mh-run-[A-Za-z0-9_.:-]+)\s+)?([1-9]\d*)(?:\s+([^\r\n]+))?$/,
      );
      if (
        !match ||
        (match[1] === "clear" && match[4]) ||
        !Number.isSafeInteger(Number(match[3]))
      )
        throw Error(help);
      operation = match[1] as "abandon" | "clear";
      explicitId = match[2];
      revision = Number(match[3]);
      note = match[4];
    }
    const view = await read(ctx);
    if (text === "list") return formatRunList(Object.values(view.state.runs));
    const current = explicitId
      ? targetById(view.state, explicitId)
      : runAt(view.state, view.binding);
    if (!operation) return JSON.stringify(response(current), null, 2);
    if (!current) throw Error("No Execution Run target; no state initialized");
    const id = current.id,
      sessionId = current.sessionId;
    const targetScope = { ...view.binding, sessionId };
    const args = { expected_run_id: id, expected_revision: revision, note };
    // Dry-run all stage/revision/note checks BEFORE UI, freezing ID/session assignment.
    applyRun(structuredClone(view.state), targetScope, operation, args);
    const access = capture(ctx, "write");
    await access.authorize();
    view.assertCurrent();
    if (
      access.binding.configHash !== view.binding.configHash ||
      access.binding.configIdentity !== view.binding.configIdentity ||
      access.node !== view.node ||
      access.capturedEpoch !== view.capturedEpoch
    )
      throw Error("Execution Run command binding changed");
    if (!ctx.hasUI || typeof ctx.ui.confirm !== "function")
      throw Error(
        "Execution Run mutation requires public UI confirmation; no UI means no write",
      );
    if (
      !(await ctx.ui.confirm(
        "Confirm Execution Run metadata mutation",
        `${operation}\nRun: ${id} · revision ${revision} · stage ${current.stage}\nTarget session: ${sessionId}\nOperator session: ${view.binding.sessionId}\nProject: ${view.binding.project}\nNote: ${note ?? "none"}`,
      ))
    )
      throw Error("Execution Run mutation declined");
    const result = await transactRun(
      view.binding,
      view.ticket,
      access.authorize,
      (state) => {
        const target = targetById(state, id);
        if (
          target.id !== id ||
          target.sessionId !== sessionId ||
          target.revision !== revision
        )
          throw Error("Stale confirmed Execution Run target");
        return applyRun(state, targetScope, operation!, args);
      },
      access.assertCurrent,
    );
    views.delete(view.binding.sessionId);
    return operation === "clear"
      ? `Execution Run cleared: ${id} · revision ${revision}`
      : JSON.stringify(response(result as Run), null, 2);
  }
  return { run, command };
}
