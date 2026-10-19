import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createAgentMemoryRuntime,
  memoryTools,
  type RuntimeConfig,
} from "../lib/agent-memory/runtime.ts";

export function activateAgentMemory(
  pi: ExtensionAPI,
  config: RuntimeConfig = {},
) {
  const runtime = createAgentMemoryRuntime(pi, config);
  const string = { type: "string" };
  const schemas = {
    agent_memory_read: {
      properties: {
        path: string,
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 4096 },
      },
      required: [],
    },
    agent_memory_edit: {
      properties: {
        path: string,
        expectedHash: { type: ["string", "null"] },
        text: { type: ["string", "null"] },
        sources: { type: "array", items: string, maxItems: 32 },
      },
      required: ["path", "expectedHash", "text", "sources"],
    },
    agent_memory_commit: {
      properties: { revision: string },
      required: ["revision"],
    },
    agent_memory_manage: {
      properties: {
        action: {
          type: "string",
          enum: [
            "status",
            "cancel",
            "forget",
            "rollback",
            "initialize",
            "conflicts",
            "discard",
          ],
        },
        revision: string,
        paths: { type: "array", items: string, maxItems: 128 },
        sources: { type: "array", items: string, maxItems: 128 },
        target: string,
        path: string,
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 4096 },
        core: { type: "string", maxLength: 8192 },
        projectId: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,63}$" },
        automatic: { type: "boolean" },
      },
      required: ["action"],
    },
    agent_memory_reflect: {
      properties: {
        assignment: { type: "string", minLength: 1, maxLength: 4096 },
      },
      required: ["assignment"],
    },
  };
  for (const name of memoryTools)
    pi.registerTool({
      name,
      label: name,
      description: {
        agent_memory_read:
          "Read scoped maintained Markdown knowledge (or list files). Pages by Unicode character offset/limit (4096 max); read all pages before a full replacement. Returns whole-file CAS hash and committed base revision; no arbitrary filesystem access. Missing separate managed-memory permission fails closed.",
        agent_memory_edit:
          "Add, replace or remove scoped Markdown in a private draft. expectedHash is from read (null for a new file); text=null removes a global/deferred/procedure file. Sources link observed episode IDs. No context changes until commit. Revise contradictory knowledge at its existing owner instead of appending it.",
        agent_memory_commit:
          "Commit/integrate the current private memory draft against its base revision. Disjoint edits merge automatically; overlapping edits preserve a conflict. Native workers mark ready; the healthy parent integrates only after successful completion. Active primary context refreshes on the next request.",
        agent_memory_manage:
          "Primary-only new-store initialization (explicit core/projectId, optional automatic), bounded memory status, cancellation, source/path forgetting and rollback. conflicts lists up to 8 retained views; target selects a view, path selects a proposal file. Read all pages with Unicode offset/limit (4096 maximum) before recovery; proposalHash covers the full text. Resolve manually through current CAS tools, then discard that view with current revision. Initialization never overwrites an existing root or native bootstrap; separate root permission must already exist. Requires current revision for changes. Logical forgetting filters recovery, not secure Git/history erasure. Revise Core/index to remove the forgotten knowledge and its source link before source-forgetting, preserving identity. Global/deferred/procedure source-forgetting conservatively removes entire affected files.",
        agent_memory_reflect:
          "Assign a locked native background writer to maintain the SAME private memory using current scoped episodes. No caller-chosen role/model/path. Registration, authority and native identity binding must already exist. Does not claim provider proof or semantic correctness.",
      }[name],
      promptGuidelines: [
        "Memory is fallible maintained knowledge, not permission policy. Preserve established identity and current instructions. Read before editing; consolidate/revise existing knowledge, cite observed evidence, avoid speculative preferences and archive-to-instruction promotion. Core includes concise durable identity/preferences/methods; global holds shared detailed knowledge; deferred holds project detail; procedures hold reusable workflows. Commit only appropriate durable knowledge. Never copy secrets or excluded project data.",
      ],
      parameters: {
        type: "object",
        additionalProperties: false,
        ...schemas[name],
      },
      executionMode: "sequential",
      async execute(_id, args, signal, _update, ctx) {
        try {
          const result = await runtime.run(name, args, ctx, signal);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            details: result,
          };
        } catch {
          // Never return private paths, provider errors, payloads or raw subprocess stderr.
          throw new Error(
            "Managed memory unavailable: valid scope, CAS, separate permission and healthy native binding required",
          );
        }
      },
    });
  return runtime;
}
export default function mahiroAgentMemory(pi: ExtensionAPI) {
  activateAgentMemory(pi);
}
