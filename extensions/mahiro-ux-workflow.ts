import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  CREATE_PARAMETERS,
  GET_PARAMETERS,
  UPDATE_PARAMETERS,
  validateInput,
  validateUpdate,
} from "../lib/ux-workflow/model.ts";
import { createUXRuntime, uxTools } from "../lib/ux-workflow/runtime.ts";

/** Ordinary installed tools; workflow creation needs human direction. Registration never seeds state, policy, profile or grants. */
export default function mahiroUXWorkflow(pi: ExtensionAPI) {
  const runtime = createUXRuntime(pi);
  for (const name of uxTools)
    pi.registerTool({
      name,
      label: name,
      description:
        name === "mh_get_ux_workflow"
          ? "Read the current native session UX workflow/open blockers and coordinator boundary. Read before mutation; canonical binding and installed tool/feature-data authority required; empty reads never create a workflow."
          : name === "mh_create_ux_workflow"
            ? "Create frame-stage UX metadata only after an explicit actual human request. This is guidance, not mechanical requester proof. No research, executors, Goal/Evidence mutation or owner invocation."
            : "Revision-guarded UX metadata updates, always actor agent. Cannot approve human gates. Brief/owner/research/finding/evidence/Goal refs are opaque caller metadata, never proof or file reads. Ordinary metadata and eligible completion need no UI dialog.",
      parameters: (name === "mh_get_ux_workflow"
        ? GET_PARAMETERS
        : name === "mh_create_ux_workflow"
          ? CREATE_PARAMETERS
          : UPDATE_PARAMETERS) as any,
      executionMode: "sequential",
      annotations: {
        readOnlyHint: name === "mh_get_ux_workflow",
        destructiveHint: false,
        idempotentHint: name === "mh_get_ux_workflow",
        openWorldHint: false,
      },
      async execute(_id, args, signal, _update, ctx) {
        if (name === "mh_update_ux_workflow") validateUpdate(args);
        else
          validateInput(
            name === "mh_get_ux_workflow" ? GET_PARAMETERS : CREATE_PARAMETERS,
            args,
          );
        const result = await runtime.run(name, args, ctx, signal);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    });
  pi.registerCommand("mh-ux", {
    description:
      "UX metadata status/help and public-UI-confirmed human direction/review/reopen/clear gates; no force unlock or moves",
    async handler(args, ctx) {
      try {
        ctx.ui.notify(await runtime.command(args, ctx), "info");
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : "UX unavailable",
          "error",
        );
      }
    },
  });
}
