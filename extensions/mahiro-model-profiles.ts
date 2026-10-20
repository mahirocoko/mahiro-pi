import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  modelProfileToolNames,
  registerModelProfiles,
  thinkingLevels,
} from "../lib/model-profiles.ts";

export default function activate(pi: ExtensionAPI) {
  const runtime = registerModelProfiles(pi);
  const properties = {
    provider: { type: "string", maxLength: 240 },
    model: { type: "string", maxLength: 240 },
    context_window: { type: "integer", minimum: 1 },
    thinking: { type: "string", enum: [...thinkingLevels] },
    label: { type: "string", maxLength: 160 },
    expected_sequence: { type: "integer", minimum: 0 },
  };
  for (const name of modelProfileToolNames) {
    const keys =
      name === "mh_list_model_profiles"
        ? []
        : name === "mh_set_model_profile"
          ? Object.keys(properties)
          : ["model", "expected_sequence"];
    const required =
      name === "mh_list_model_profiles"
        ? []
        : name === "mh_set_model_profile"
          ? ["provider", "model", "context_window", "expected_sequence"]
          : ["model", "expected_sequence"];
    pi.registerTool({
      name,
      label: name,
      description:
        "Private persistent native model presets. Read before mutation; exact expected_sequence and actual human UI required. /model, auth and modelRegistry remain authoritative. Context window is an unsupported requested hint, never an effective override. No startup switch or default settings writes.",
      parameters: {
        type: "object",
        properties: Object.fromEntries(keys.map((k) => [k, properties[k]])),
        required,
        additionalProperties: false,
      } as any,
      async execute(_id, args, signal, _update, ctx) {
        if (signal?.aborted) throw Error("Model profile cancelled");
        const details = await runtime.run(name, args, {
          ...ctx,
          signal: signal ?? ctx.signal,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(details) }],
          details,
        };
      },
    });
  }
  pi.registerCommand("mh-model-profile", {
    description:
      "Persistent native presets: list | set <sequence> <provider/model> <context-hint> <thinking|-> [alias...] | remove|switch <sequence> <handle-or-alias...>",
    handler: async (input, ctx) => {
      try {
        if (input.length > 2048 || /[\x00-\x1f\x7f]/.test(input))
          throw Error("Bounded single-line command required");
        const [action = "list", sequence, handle, context, thinking, ...label] =
          input.trim().split(/\s+/);
        let name = "mh_list_model_profiles",
          args: any = {};
        if (action !== "list") {
          if (!/^\d+$/.test(sequence ?? ""))
            throw Error("Read list, then provide expected sequence");
          args.expected_sequence = Number(sequence);
          if (action === "set") {
            const split = handle?.indexOf("/") ?? -1;
            if (split < 1)
              throw Error(
                "Explicit provider/model required; no provider inference",
              );
            name = "mh_set_model_profile";
            Object.assign(args, {
              provider: handle.slice(0, split),
              model: handle.slice(split + 1),
              context_window: Number(context),
            });
            if (thinking && thinking !== "-") args.thinking = thinking;
            if (label.length) args.label = label.join(" ");
          } else if (["remove", "delete", "switch"].includes(action)) {
            name =
              action === "switch"
                ? "mh_switch_model_profile"
                : "mh_delete_model_profile";
            args.model = [handle, context, thinking, ...label]
              .filter((v) => v !== undefined)
              .join(" ");
          } else throw Error("Unknown model-profile command");
        }
        ctx.ui.notify(
          JSON.stringify(await runtime.run(name, args, ctx)),
          "info",
        );
      } catch (e) {
        ctx.ui.notify(
          e instanceof Error ? e.message : "Model profile failed",
          "error",
        );
      }
    },
  });
}
