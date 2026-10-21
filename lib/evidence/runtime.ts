import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { GitInspection } from "./git.ts";
import {
  CODE_EVIDENCE_PARAMETERS,
  type CodeEvidenceReport,
  collectReport,
  formatReport,
  recordReport,
  reportAt,
  reportSummary,
  scopeKey,
  validateBaseRef,
} from "./model.ts";
import {
  type EvidenceBinding,
  type EvidenceTicket,
  readEvidenceState,
  resolveEvidenceBinding,
  stateTicket,
  transactEvidence,
} from "./store.ts";

const key = Symbol.for("@mahirocoko/pi-guards:healthy-nodes");
export function validateInput(args: any) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    !["get", "collect", "record"].includes(args.action) ||
    Object.keys(args).some(
      (k) => !Object.hasOwn(CODE_EVIDENCE_PARAMETERS.properties, k),
    )
  )
    throw Error(
      "Code Evidence action must be get, collect or record with closed arguments",
    );
  for (const name of [
    "workspace",
    "base_ref",
    "summary",
    "reference",
    "command",
    "kind",
    "result",
  ])
    if (args[name] != null && typeof args[name] !== "string")
      throw Error("Evidence string field required");
  if (args.action !== "collect" && args.base_ref !== undefined)
    throw Error("base_ref is collect-only");
  if (args.action === "record") {
    for (const name of [
      "workspace",
      "expected_revision",
      "kind",
      "result",
      "summary",
    ])
      if (args[name] == null || args[name] === "")
        throw Error(`Evidence record requires ${name}`);
    if (
      !Number.isSafeInteger(args.expected_revision) ||
      args.expected_revision < 1 ||
      (args.criterion_ids !== undefined && !Array.isArray(args.criterion_ids))
    )
      throw Error("Invalid Evidence revision/criteria");
  }
}
export function createEvidenceRuntime(pi: ExtensionAPI) {
  let epoch = 0;
  const operations = new Set<AbortController>();
  const views = new Map<
    string,
    {
      ticket: EvidenceTicket;
      binding: EvidenceBinding;
      epoch: number;
      manager: any;
      node: any;
    }
  >();
  const invalidate = () => {
    epoch++;
    views.clear();
    for (const operation of operations) operation.abort();
  };
  for (const event of [
    "session_before_switch",
    "session_before_tree",
    "session_before_fork",
    "session_start",
    "session_shutdown",
  ] as const)
    pi.on(event, invalidate);
  function capture(
    ctx: ExtensionContext,
    operation: "read" | "write",
    workspace: unknown,
    signal?: AbortSignal,
  ) {
    const binding = resolveEvidenceBinding(ctx.cwd);
    if (!binding)
      throw Error("Canonical Code Evidence project binding unavailable");
    const sessionId = ctx.sessionManager.getSessionId();
    if (
      typeof sessionId !== "string" ||
      !sessionId.trim() ||
      sessionId.length > 240
    )
      throw Error("Explicit native session identity required");
    binding.sessionId = sessionId;
    const requested =
      workspace == null || workspace === ""
        ? binding.project
        : String(workspace);
    if (requested.length > 4096 || /[\x00-\x1f\x7f]/.test(requested))
      throw Error("Invalid Evidence workspace");
    const absolute = resolve(requested),
      selected = realpathSync(absolute);
    if (
      selected !== absolute ||
      !(
        selected === binding.project ||
        selected.startsWith(binding.project + "/")
      )
    )
      throw Error(
        "Workspace must select the current canonical project; no widening or automatic moves",
      );
    const node = (globalThis as any)[key]?.get(sessionId),
      abi = node?.evidence,
      manager = ctx.sessionManager,
      capturedEpoch = epoch;
    const controller = new AbortController();
    operations.add(controller);
    let git: GitInspection | undefined;
    const assertContext = () => {
      if (
        signal?.aborted ||
        ctx.signal?.aborted ||
        controller.signal.aborted ||
        epoch !== capturedEpoch ||
        manager !== ctx.sessionManager ||
        manager.getSessionId() !== sessionId ||
        ctx.cwd !== binding.project ||
        (globalThis as any)[key]?.get(sessionId) !== node ||
        !node?.healthy?.() ||
        abi?.version !== 1 ||
        abi.generation !== node.generation ||
        typeof abi.assertAccess !== "function" ||
        typeof abi.authorize !== "function" ||
        typeof abi.authorizeGit !== "function" ||
        typeof abi.assertSources !== "function"
      )
        throw Error(
          "Code Evidence context/generation cancelled or unavailable",
        );
      abi.assertAccess(
        pi.getAllTools().find((t) => t.name === "mh_code_evidence"),
        ctx,
        binding.root,
        operation,
      );
      // Configuration may be revoked during an owned process, not only at publication.
      const current = resolveEvidenceBinding(binding.project);
      if (
        !current ||
        current.configHash !== binding.configHash ||
        current.root !== binding.root
      )
        throw Error("Evidence configuration authority changed");
    };
    const assertCurrent = () => {
      assertContext();
      git?.assertSources();
    };
    const authorize = async () => {
      assertCurrent();
      await abi.authorize(
        pi.getAllTools().find((t) => t.name === "mh_code_evidence"),
        ctx,
        binding.root,
        operation,
        signal,
      );
      assertCurrent();
    };
    git = new GitInspection(
      binding.project,
      {
        assertCurrent: assertContext,
        assertSources(paths) {
          abi.assertSources(
            pi.getAllTools().find((t) => t.name === "mh_code_evidence"),
            ctx,
            binding.root,
            operation,
            paths,
          );
        },
        async authorizeGit(executable, args, gitSignal) {
          assertContext();
          await abi.authorizeGit(
            pi.getAllTools().find((t) => t.name === "mh_code_evidence"),
            ctx,
            binding.root,
            operation,
            executable,
            args,
            gitSignal,
          );
          assertContext();
        },
      },
      [signal, ctx.signal, controller.signal],
    );
    return {
      binding,
      workspace: selected,
      node,
      manager,
      epoch: capturedEpoch,
      assertCurrent,
      authorize,
      git,
      close() {
        git.close();
        operations.delete(controller);
      },
    };
  }
  async function run(args: any, ctx: ExtensionContext, signal?: AbortSignal) {
    validateInput(args);
    const access = capture(
      ctx,
      args.action === "get" ? "read" : "write",
      args.workspace,
      signal,
    );
    try {
      await access.authorize();
      const state = readEvidenceState(access.binding),
        ticket = stateTicket(state),
        report = reportAt(state, access.binding);
      const remember = (
        fresh: CodeEvidenceReport | null,
        currentTicket = ticket,
      ) => {
        access.assertCurrent();
        views.set(access.binding.sessionId, {
          ticket: currentTicket,
          binding: access.binding,
          epoch,
          manager: access.manager,
          node: access.node,
        });
        return fresh
          ? reportSummary(fresh)
          : {
              status: "empty",
              message:
                "No report for this exact profile/project/native session. Collect explicitly; no sole-report fallback.",
            };
      };
      if (args.action === "get") {
        // A new authorized empty store is a pure read: no Git, mkdir or state seed.
        return remember(report ? await access.git.freshness(report) : null);
      }
      if (args.action === "collect") {
        await access.git.preflight(access.workspace);
        const sample = await access.git.sample(validateBaseRef(args.base_ref));
        const collected = {
          ...sample,
          collectionId: `collection-${randomUUID().slice(0, 12)}`,
          requestedWorkspace: access.workspace,
          repositoryRoot: access.binding.project,
          collectedAt: new Date().toISOString(),
        };
        const fresh = await access.git.freshness(
          {
            ...collected,
            revision: 1,
            profile: access.binding.profile,
            sessionId: access.binding.sessionId,
            updatedAt: collected.collectedAt,
            records: [],
          },
          true,
        );
        const saved = await transactEvidence(
          access.binding,
          ticket,
          access.authorize,
          (draft) => collectReport(draft, access.binding, collected),
          access.assertCurrent,
        );
        return remember(
          { ...saved, freshness: fresh.freshness },
          stateTicket(readEvidenceState(access.binding)),
        );
      }
      const view = views.get(access.binding.sessionId);
      if (
        !view ||
        view.epoch !== epoch ||
        view.manager !== access.manager ||
        view.node !== access.node ||
        view.binding.configHash !== access.binding.configHash ||
        view.binding.root !== access.binding.root ||
        view.ticket.digest !== ticket.digest
      )
        throw Error(
          "Read mh_code_evidence get/collect in this native context before recording; stale ticket",
        );
      if (!report || args.expected_revision !== report.revision)
        throw Error("Stale Code Evidence revision");
      const before = await access.git.freshness(report);
      if (!before.freshness.isCurrent) throw Error(before.freshness.reason);
      // Validate caller metadata before opening any mutation resource. Descriptive command NEVER executes.
      recordReport(structuredClone(state), access.binding, args);
      const authorizeRecord = async () => {
        await access.authorize();
        const fresh = await access.git.freshness(report);
        if (!fresh.freshness.isCurrent) throw Error(fresh.freshness.reason);
      };
      const saved = await transactEvidence(
        access.binding,
        view.ticket,
        authorizeRecord,
        (draft) => recordReport(draft, access.binding, args),
        access.assertCurrent,
      );
      views.delete(access.binding.sessionId);
      return reportSummary({ ...saved, freshness: before.freshness });
    } finally {
      access.close();
    }
  }
  async function command(input: string, ctx: ExtensionContext) {
    const [sub = "status", ...rest] = input.trim().split(/\s+/);
    if (["help", "-h", "--help"].includes(sub))
      return "/mh-evidence status|report|collect [workspace]; clear <revision> [workspace]. Opt-in bounded metadata. No command execution, Goal mutation or force-unlock.";
    if (["status", "report", "collect"].includes(sub))
      return JSON.stringify(
        await run(
          {
            action: sub === "collect" ? "collect" : "get",
            workspace: rest.join(" ") || undefined,
          },
          ctx,
        ),
        null,
        2,
      );
    if (sub !== "clear")
      throw Error("Usage: /mh-evidence status|report|collect|clear|help");
    const revision = Number(rest.shift());
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw Error("Exact positive report revision required");
    const access = capture(ctx, "write", rest.join(" ") || undefined);
    try {
      await access.authorize();
      const state = readEvidenceState(access.binding),
        ticket = stateTicket(state),
        report = reportAt(state, access.binding);
      if (!report)
        return "No Code Evidence report for this exact native session.";
      if (report.revision !== revision)
        throw Error("Stale Code Evidence revision");
      if (!ctx.hasUI || typeof ctx.ui.confirm !== "function")
        throw Error(
          "Code Evidence clear requires public UI; no UI means no write",
        );
      if (
        !(await ctx.ui.confirm(
          "Clear Code Evidence?",
          `Report ${report.collectionId}\nSession ${access.binding.sessionId}\nProject ${access.binding.project}\nrevision ${revision}`,
        ))
      )
        throw Error("Code Evidence clear declined");
      access.assertCurrent();
      await transactEvidence(
        access.binding,
        ticket,
        access.authorize,
        (draft) => {
          const current = reportAt(draft, access.binding);
          if (
            !current ||
            current.collectionId !== report.collectionId ||
            current.revision !== revision
          )
            throw Error("Stale exact report target");
          delete draft.reports[
            scopeKey(
              access.binding.profile,
              access.binding.sessionId,
              access.binding.project,
            )
          ];
        },
        access.assertCurrent,
      );
      views.delete(access.binding.sessionId);
      return "Code Evidence report cleared.";
    } finally {
      access.close();
    }
  }
  return { run, command };
}
