import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { codeMapParameters, formatCodeMap } from "../lib/code-map.ts";

// Versioned, Code-Map-only contract published by the Root-owned native Pi guard.
// This is not a policy copy or authority derived from caller metadata.
const guardKey = Symbol.for("@mahirocoko/pi-guards:healthy-nodes");

export default function mahiroCodeMap(pi: ExtensionAPI) {
  pi.registerTool({
    name: "mh_code_map",
    label: "Code Map",
    description:
      "Return bounded repository navigation guidance from caller metadata only. No search, indexing, source reads, outlines, inference or workflow state. Navigation is not verification; large-read and opaque Goal/Evidence references are not authorization. Requires existing named permission and canonical healthy guard.",
    parameters: codeMapParameters,
    executionMode: "parallel",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(_id, args, signal, _update, ctx) {
      const nodes = (globalThis as any)[guardKey];
      const node = nodes?.get(ctx.sessionManager.getSessionId());
      const abi = node?.codeMap;
      const tool = pi.getAllTools().find((item) => item.name === "mh_code_map");
      if (
        signal?.aborted ||
        ctx.signal?.aborted ||
        !node?.healthy?.() ||
        abi?.version !== 1 ||
        abi.generation !== node.generation ||
        typeof abi.assertAccess !== "function"
      )
        throw new Error(
          "Code Map unavailable: healthy canonical guard and named permission required",
        );
      // Every execution, including codemode/nested calls, checks current provenance,
      // exact native context ownership and the existing permission service.
      abi.assertAccess(tool, ctx);
      const text = formatCodeMap(ctx.cwd, args);
      return { content: [{ type: "text", text }], details: undefined };
    },
  });
}
