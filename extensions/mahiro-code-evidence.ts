import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CODE_EVIDENCE_PARAMETERS } from "../lib/evidence/model.ts";
import { createEvidenceRuntime } from "../lib/evidence/runtime.ts";
/** Registration only. No Git, profile mutation, prompt injection or automatic collection. */
export default function mahiroCodeEvidence(pi: ExtensionAPI) {
  const runtime = createEvidenceRuntime(pi);
  pi.registerTool({
    name: "mh_code_evidence",
    label: "Code Evidence",
    description:
      "Opt-in Code Evidence: get exact native-session report, collect four bounded read-only Git lanes, or record metadata about an already-performed external check. command is descriptive and NEVER executed. evidence_ready means metadata ready for explicit selection, not verified execution or Goal completion. No automatic Goal attachment, human verification, import or collection. Requires separate exact tool and derived project-state-root permissions.",
    parameters: CODE_EVIDENCE_PARAMETERS,
    executionMode: "sequential",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async execute(_id, args, signal, _update, ctx) {
      const result = await runtime.run(args, ctx, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
  pi.registerCommand("mh-evidence", {
    description:
      "Opt-in Code Evidence help/status/report/collect/clear with exact-report public UI confirmation for clear",
    async handler(input, ctx) {
      try {
        ctx.ui.notify(await runtime.command(input, ctx), "info");
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : "Code Evidence unavailable",
          "error",
        );
      }
    },
  });
}
