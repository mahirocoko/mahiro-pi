import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { applyUX, response, runAt, type UXRun } from "./model.ts";
import {
  readUXState,
  resolveUXBinding,
  stateTicket,
  transactUX,
} from "./store.ts";

export const uxTools = [
  "mh_get_ux_workflow",
  "mh_create_ux_workflow",
  "mh_update_ux_workflow",
] as const;
type Tool = (typeof uxTools)[number];
const guardKey = Symbol.for("@mahirocoko/pi-guards:healthy-nodes");
const safe = (v: unknown) => String(v).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
export const help =
  "Mahiro UX metadata coordinator: status | show | help | approve direction <revision> <concept-id> [note] | reject direction <revision> <concept-id> [note] | approve review <revision> [note] | reject review <revision> [note] | reopen <revision> [note] | clear <revision>. Human commands require public UI confirmation. unlock --force and session moves unsupported. References are opaque metadata, never execution or visual proof; Goal/Evidence remain separate owners.";
export function createUXRuntime(pi: ExtensionAPI) {
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
  function capture(name: Tool, ctx: ExtensionContext, signal?: AbortSignal) {
    const binding = resolveUXBinding(ctx.cwd);
    if (!binding) throw Error("Canonical UX project binding unavailable");
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
      abi = node?.uxWorkflow;
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
        throw Error("UX context/generation cancelled or unavailable");
      abi.assertAccess(
        pi.getAllTools().find((t) => t.name === name),
        ctx,
        binding.root,
        name === "mh_get_ux_workflow" ? "read" : "write",
      );
    };
    const authorize = async () => {
      assertCurrent();
      await abi.authorize(
        pi.getAllTools().find((t) => t.name === name),
        ctx,
        binding.root,
        name === "mh_get_ux_workflow" ? "read" : "write",
        signal,
      );
      assertCurrent();
    };
    return { binding, manager, node, capturedEpoch, assertCurrent, authorize };
  }
  async function read(ctx: ExtensionContext, signal?: AbortSignal) {
    const access = capture("mh_get_ux_workflow", ctx, signal);
    await access.authorize();
    const state = readUXState(access.binding);
    const view = { ...access, state, ticket: stateTicket(state) };
    views.set(access.binding.sessionId, view);
    return view;
  }
  async function run(
    name: Tool,
    args: any,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ) {
    if (name === "mh_get_ux_workflow") {
      const view = await read(ctx, signal);
      return response(runAt(view.state, view.binding));
    }
    const access = capture(name, ctx, signal);
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
      throw Error("Read mh_get_ux_workflow before mutation in this context");
    const result = await transactUX(
      access.binding,
      view.ticket,
      access.authorize,
      (state) =>
        applyUX(
          state,
          access.binding,
          name === "mh_create_ux_workflow" ? "create" : "update",
          args,
        ),
      access.assertCurrent,
    );
    views.delete(access.binding.sessionId);
    return response(result as UXRun);
  }
  async function command(input: string, ctx: ExtensionContext) {
    const text = input.trim();
    if (["help", "-h", "--help"].includes(text.toLowerCase())) return help;
    if (/^unlock\b/i.test(text))
      throw Error(
        "Force unlock unsupported: never steal foreign or live locks",
      );
    const view = await read(ctx),
      current = runAt(view.state, view.binding);
    if (!text || ["status", "show"].includes(text.toLowerCase()))
      return JSON.stringify(response(current), null, 2);
    let operation: "approve" | "reject" | "reopen" | "clear", args: any;
    let match: RegExpMatchArray | null;
    if (
      (match = text.match(
        /^(approve|reject)\s+direction\s+(\d+)\s+(\S+)(?:\s+([\s\S]+))?$/i,
      ))
    ) {
      operation = match[1].toLowerCase() as "approve" | "reject";
      args = {
        gate: "direction",
        expected_revision: Number(match[2]),
        concept_id: match[3],
        note: match[4],
      };
    } else if (
      (match = text.match(
        /^(approve|reject)\s+review\s+(\d+)(?:\s+([\s\S]+))?$/i,
      ))
    ) {
      operation = match[1].toLowerCase() as "approve" | "reject";
      args = {
        gate: "review",
        expected_revision: Number(match[2]),
        note: match[3],
      };
    } else if ((match = text.match(/^(reopen)\s+(\d+)(?:\s+([\s\S]+))?$/i))) {
      operation = "reopen";
      args = { expected_revision: Number(match[2]), note: match[3] };
    } else if ((match = text.match(/^clear\s+(\d+)$/i))) {
      operation = "clear";
      args = { expected_revision: Number(match[1]) };
    } else throw Error(help);
    if (!current || current.revision !== args.expected_revision)
      throw Error("No current UX target or stale revision");
    // Dry-run against a clone validates exact gate/concept/bounds before asking.
    applyUX(structuredClone(view.state), view.binding, operation, args);
    const id = current.id,
      revision = current.revision,
      concept = current.direction?.conceptId;
    const access = capture("mh_update_ux_workflow", ctx);
    await access.authorize();
    view.assertCurrent();
    if (
      access.binding.configHash !== view.binding.configHash ||
      access.binding.configIdentity !== view.binding.configIdentity ||
      access.node !== view.node ||
      access.capturedEpoch !== view.capturedEpoch
    )
      throw Error("UX command binding changed");
    if (!ctx.hasUI || typeof ctx.ui.confirm !== "function")
      throw Error(
        "UX human command requires public UI confirmation; no UI means no write",
      );
    if (
      !(await ctx.ui.confirm(
        "Confirm Mahiro UX mutation",
        safe(
          `${text}\nRun: ${id} · revision ${revision} · stage ${current.stage}\nConcept: ${concept ?? "none"}\nSession: ${view.binding.sessionId}\nProject: ${view.binding.project}`,
        ),
      ))
    )
      throw Error("UX mutation declined");
    const result = await transactUX(
      view.binding,
      view.ticket,
      access.authorize,
      (state) => {
        const target = runAt(state, view.binding);
        if (
          !target ||
          target.id !== id ||
          target.revision !== revision ||
          target.direction?.conceptId !== concept
        )
          throw Error("Stale UX confirmed target");
        return applyUX(state, view.binding, operation, args);
      },
      access.assertCurrent,
    );
    views.delete(view.binding.sessionId);
    return operation === "clear"
      ? `UX cleared: ${id} · revision ${revision}`
      : JSON.stringify(response(result as UXRun), null, 2);
  }
  return { run, command };
}
