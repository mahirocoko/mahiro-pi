/**
 * Mahiro Model Profiles — keep per-model context and reasoning preferences.
 *
 * Adapted from @letta-ai/model-profiles. The public surface is namespaced to
 * this bundle and the state is owned by the current agent's MemFS directory.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface IModelProfile {
  contextWindow: number;
  reasoningEffort?: ReasoningEffort;
  label?: string;
  updatedAt?: string;
}

export interface IProfilesState {
  version: number;
  profiles: Record<string, IModelProfile>;
}

interface IProfilesContext {
  memfs?: { memoryDir?: string | null };
  model?: { id?: string | null; reasoningEffort?: string | null };
  contextWindow?: { size?: number | null };
  conversation?: {
    id?: string | null;
    updateLlmConfig?: (options: Record<string, unknown>) => Promise<void>;
  };
  agent?: { id?: string | null };
  cwd?: string;
}

interface ISwitchOptions {
  model: string;
  contextWindow?: number;
  reasoningEffort?: ReasoningEffort;
  scope?: "conversation" | "agent";
}

const FILE_NAME = "mahiro-model-profiles.json";
const MAX_PROFILES = 64;
const MAX_HANDLE_LENGTH = 240;
const MAX_LABEL_LENGTH = 160;

let reportWarning: (message: string) => void = () => {};

function statePathOverride(): string | null {
  const configured = process.env.MAHIRO_MODEL_PROFILES_STATE_PATH?.trim();
  return configured || null;
}

export function getProfilesPath(ctx?: IProfilesContext): string {
  const override = statePathOverride();
  if (override) return override;

  const memDir = ctx?.memfs?.memoryDir || process.env.MEMORY_DIR;
  if (memDir) return join(memDir, "mods", FILE_NAME);

  const agentId = ctx?.agent?.id?.trim();
  if (!agentId) {
    throw new Error("Mahiro Model Profiles requires agent-scoped MemFS or an agent identity; refusing shared global profile state.");
  }
  const agentScope = createHash("sha256").update(agentId).digest("hex").slice(0, 32);
  return join(homedir(), ".letta", "mods", "mahiro-model-profiles", agentScope, FILE_NAME);
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function isProfile(value: unknown): value is IModelProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<IModelProfile>;
  return Number.isSafeInteger(profile.contextWindow) && profile.contextWindow > 0;
}

function normalizeState(data: unknown): IProfilesState | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as Partial<IProfilesState>).profiles;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const profiles: Record<string, IModelProfile> = {};
  for (const [handle, value] of Object.entries(raw).slice(0, MAX_PROFILES)) {
    if (!isSafeText(handle, MAX_HANDLE_LENGTH) || !isProfile(value)) continue;
    const profile = value as IModelProfile;
    profiles[handle] = {
      contextWindow: profile.contextWindow,
      ...(isReasoningEffort(profile.reasoningEffort) ? { reasoningEffort: profile.reasoningEffort } : {}),
      ...(isSafeText(profile.label, MAX_LABEL_LENGTH) ? { label: profile.label.trim() } : {}),
      ...(typeof profile.updatedAt === "string" && profile.updatedAt.length <= 64 ? { updatedAt: profile.updatedAt } : {}),
    };
  }

  return { version: 1, profiles };
}

/** Preserve unreadable state as recovery material instead of overwriting it. */
export function readProfiles(ctx?: IProfilesContext): IProfilesState {
  const filePath = getProfilesPath(ctx);
  if (!existsSync(filePath)) return { version: 1, profiles: {} };

  let state: IProfilesState | null = null;
  try {
    state = normalizeState(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    state = null;
  }
  if (state) return state;

  const backup = `${filePath}.corrupt-${Date.now()}`;
  try {
    renameSync(filePath, backup);
    reportWarning(`Mahiro Model Profiles: ${filePath} was unreadable and moved to ${backup}. Starting with no profiles.`);
  } catch {
    reportWarning(`Mahiro Model Profiles: ${filePath} is unreadable and could not be moved aside.`);
  }
  return { version: 1, profiles: {} };
}

export function writeProfiles(ctx: IProfilesContext | undefined, state: IProfilesState): string {
  const filePath = getProfilesPath(ctx);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, filePath);
  return filePath;
}

export function findProfile(state: IProfilesState, query: string): { handle: string; profile: IModelProfile } | null {
  const normalized = query.trim();
  if (!normalized) return null;
  if (state.profiles[normalized]) return { handle: normalized, profile: state.profiles[normalized] };

  const lower = normalized.toLowerCase();
  for (const [handle, profile] of Object.entries(state.profiles)) {
    if (handle.toLowerCase() === lower || profile.label?.toLowerCase() === lower) {
      return { handle, profile };
    }
  }
  return null;
}

function saveProfile(ctx: IProfilesContext | undefined, model: string, profile: Omit<IModelProfile, "updatedAt">) {
  const state = readProfiles(ctx);
  state.profiles[model] = { ...profile, updatedAt: new Date().toISOString() };
  return { state, path: writeProfiles(ctx, state) };
}

function removeProfile(ctx: IProfilesContext | undefined, query: string) {
  const state = readProfiles(ctx);
  const match = findProfile(state, query);
  if (!match) return null;
  delete state.profiles[match.handle];
  return { handle: match.handle, path: writeProfiles(ctx, state) };
}

export function resolveSwitch(
  state: IProfilesState,
  query: string,
  overrides: { contextWindow?: number; reasoningEffort?: ReasoningEffort; scope?: string },
): ISwitchOptions & { fromProfile: boolean } {
  const match = findProfile(state, query);
  const handle = match ? match.handle : query.trim();
  return {
    model: handle,
    fromProfile: Boolean(match),
    contextWindow: overrides.contextWindow ?? match?.profile.contextWindow,
    reasoningEffort: overrides.reasoningEffort ?? match?.profile.reasoningEffort,
    scope: overrides.scope === "agent" ? "agent" : "conversation",
  };
}

async function applySwitch(ctx: IProfilesContext, options: ISwitchOptions) {
  const updateLlmConfig = ctx.conversation?.updateLlmConfig;
  if (typeof updateLlmConfig !== "function") {
    throw new Error("ctx.conversation.updateLlmConfig is not available in this Letta Code runtime.");
  }

  const scope = options.scope === "agent" ? "agent" : "conversation";
  const payload: Record<string, unknown> = { model: options.model, scope };
  if (Number.isSafeInteger(options.contextWindow) && options.contextWindow > 0) {
    payload.contextWindow = options.contextWindow;
  }
  if (options.reasoningEffort !== undefined) payload.reasoningEffort = options.reasoningEffort;
  await updateLlmConfig.call(ctx.conversation, payload);
  return {
    model: options.model,
    context_window: (payload.contextWindow as number | undefined) ?? null,
    reasoning_effort: options.reasoningEffort ?? null,
    scope,
    effective: "next turn",
  };
}

function describeSwitch(result: Awaited<ReturnType<typeof applySwitch>>, fromProfile: boolean): string {
  const parts = [
    `context: ${result.context_window ? `${result.context_window.toLocaleString()} tokens` : "provider default"}`,
    ...(result.reasoning_effort ? [`reasoning: ${result.reasoning_effort}`] : []),
    `scope: ${result.scope}`,
  ];
  const note = fromProfile ? "" : " No saved profile matched, so unspecified settings use provider defaults.";
  return `Switched model to ${result.model} (${parts.join(", ")}). Takes effect on the next turn.${note}`;
}

export function positiveInteger(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  if (typeof value !== "string" || !/^\d+$/u.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Parse flags anywhere while preserving multi-word model labels. */
export function parseCommandArgs(argv: string[]): {
  sub: string;
  positional: string[];
  scope: "conversation" | "agent";
  error?: string;
} {
  const positional: string[] = [];
  let scope: "conversation" | "agent" = "conversation";
  let error: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--agent") scope = "agent";
    else if (token === "--conversation") scope = "conversation";
    else if (token === "--scope" || token.startsWith("--scope=")) {
      const value = token === "--scope" ? argv[++index] : token.slice("--scope=".length);
      if (value === "agent" || value === "conversation") scope = value;
      else error = `Unknown scope "${value ?? ""}". Use conversation or agent.`;
    } else if (token.startsWith("--")) error = `Unknown flag "${token}".`;
    else positional.push(token);
  }

  const sub = (positional.shift() || "list").toLowerCase();
  return { sub, positional, scope, error };
}

function commandOutput(output: string, success = true) {
  return { type: "output" as const, output, success };
}

function jsonResult(obj: Record<string, unknown>, status: "success" | "error" = "success") {
  return { status, output: JSON.stringify(obj, null, 2) };
}

const REASONING_DESCRIPTION = `Reasoning effort tier: ${REASONING_EFFORTS.join(", ")}.`;

export const __testing = process.env.MAHIRO_MODEL_PROFILES_TESTING === "1"
  ? Object.freeze({ readProfiles, writeProfiles, findProfile, resolveSwitch, parseCommandArgs, positiveInteger, getProfilesPath })
  : null;

export default function activate(letta: any) {
  const disablePath = process.env.MAHIRO_MODEL_PROFILES_DISABLE_PATH
    || join(homedir(), ".letta", "mods", "mahiro-model-profiles.disabled");
  if (existsSync(disablePath)) return;

  const disposers: Array<() => void> = [];
  if (typeof letta?.diagnostics?.report === "function") {
    reportWarning = (message) => letta.diagnostics.report({ message, severity: "warning" });
  }

  if (letta.capabilities?.tools) {
    disposers.push(letta.tools.register({
      name: "mh_list_model_profiles",
      description: "List saved Mahiro model profiles and the current active model settings.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      requiresApproval: false,
      parallelSafe: true,
      run(ctx: IProfilesContext) {
        const state = readProfiles(ctx);
        return jsonResult({
          storage_path: getProfilesPath(ctx),
          current: {
            model: ctx.model?.id ?? null,
            context_window: ctx.contextWindow?.size ?? null,
            reasoning_effort: ctx.model?.reasoningEffort ?? null,
            conversation_id: ctx.conversation?.id ?? null,
            agent_id: ctx.agent?.id ?? null,
          },
          profiles: state.profiles,
        });
      },
    }));

    disposers.push(letta.tools.register({
      name: "mh_set_model_profile",
      description: "Save or update a preferred context window and reasoning effort for a model.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "Model handle, for example openai-codex/gpt-6-sol." },
          context_window: { type: "number", description: "Positive context window limit in tokens." },
          reasoning_effort: { type: "string", enum: [...REASONING_EFFORTS], description: `Optional. ${REASONING_DESCRIPTION}` },
          label: { type: "string", description: "Optional human-readable alias." },
        },
        required: ["model", "context_window"],
        additionalProperties: false,
      },
      requiresApproval: false,
      parallelSafe: false,
      run(ctx: IProfilesContext & { args: Record<string, unknown> }) {
        const model = typeof ctx.args.model === "string" ? ctx.args.model.trim() : "";
        if (!isSafeText(model, MAX_HANDLE_LENGTH)) return jsonResult({ error: "model must be a non-empty safe string." }, "error");
        const contextWindow = positiveInteger(ctx.args.context_window);
        if (!contextWindow) return jsonResult({ error: "context_window must be a positive integer." }, "error");
        const reasoningEffort = ctx.args.reasoning_effort;
        if (reasoningEffort !== undefined && reasoningEffort !== null && !isReasoningEffort(reasoningEffort)) {
          return jsonResult({ error: `reasoning_effort must be one of: ${REASONING_EFFORTS.join(", ")}.` }, "error");
        }
        const label = typeof ctx.args.label === "string" ? ctx.args.label.trim() : "";
        if (label && !isSafeText(label, MAX_LABEL_LENGTH)) return jsonResult({ error: "label is too long or contains control characters." }, "error");
        const { state, path } = saveProfile(ctx, model, {
          contextWindow,
          ...(isReasoningEffort(reasoningEffort) ? { reasoningEffort } : {}),
          ...(label ? { label } : {}),
        });
        return jsonResult({ message: `Saved profile for ${model}.`, storage_path: path, profile: state.profiles[model] });
      },
    }));

    disposers.push(letta.tools.register({
      name: "mh_switch_model_profile",
      description: "Switch model and apply its saved context window and reasoning effort in one update.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "Model handle or saved profile label." },
          scope: { type: "string", enum: ["conversation", "agent"], description: "conversation (default) or agent." },
          context_window: { type: "number", description: "Optional context window override." },
          reasoning_effort: { type: "string", enum: [...REASONING_EFFORTS], description: `Optional override. ${REASONING_DESCRIPTION}` },
        },
        required: ["model"],
        additionalProperties: false,
      },
      requiresApproval: false,
      parallelSafe: false,
      async run(ctx: IProfilesContext & { args: Record<string, unknown> }) {
        const query = typeof ctx.args.model === "string" ? ctx.args.model.trim() : "";
        if (!isSafeText(query, MAX_HANDLE_LENGTH)) return jsonResult({ error: "model must be a non-empty safe string." }, "error");
        const hasContextOverride = Object.prototype.hasOwnProperty.call(ctx.args, "context_window");
        if (hasContextOverride && !positiveInteger(ctx.args.context_window)) {
          return jsonResult({ error: "context_window must be a positive integer when provided." }, "error");
        }
        if (ctx.args.reasoning_effort !== undefined && !isReasoningEffort(ctx.args.reasoning_effort)) {
          return jsonResult({ error: `reasoning_effort must be one of: ${REASONING_EFFORTS.join(", ")}.` }, "error");
        }
        const target = resolveSwitch(readProfiles(ctx), query, {
          contextWindow: positiveInteger(ctx.args.context_window),
          reasoningEffort: ctx.args.reasoning_effort as ReasoningEffort | undefined,
          scope: typeof ctx.args.scope === "string" ? ctx.args.scope : undefined,
        });
        try {
          const applied = await applySwitch(ctx, target);
          return jsonResult({ message: describeSwitch(applied, target.fromProfile), applied });
        } catch (error) {
          return jsonResult({ error: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}` }, "error");
        }
      },
    }));

    disposers.push(letta.tools.register({
      name: "mh_delete_model_profile",
      description: "Remove a saved Mahiro model profile by handle or label.",
      parameters: {
        type: "object",
        properties: { model: { type: "string", description: "Model handle or profile label." } },
        required: ["model"],
        additionalProperties: false,
      },
      requiresApproval: false,
      parallelSafe: false,
      run(ctx: IProfilesContext & { args: Record<string, unknown> }) {
        const query = typeof ctx.args.model === "string" ? ctx.args.model.trim() : "";
        if (!isSafeText(query, MAX_HANDLE_LENGTH)) return jsonResult({ error: "model must be a non-empty safe string." }, "error");
        const removed = removeProfile(ctx, query);
        if (!removed) return jsonResult({ error: `Profile "${query}" not found.` }, "error");
        return jsonResult({ message: `Deleted profile for ${removed.handle}.`, storage_path: removed.path });
      },
    }));
  }

  if (letta.capabilities?.commands) {
    const usage = [
      "Usage:",
      "  /mh-model-profile list",
      `  /mh-model-profile set <model> <context-window> [${REASONING_EFFORTS.join("|")}] [label...]`,
      "  /mh-model-profile switch <model-or-label...> [--scope conversation|agent]",
      "  /mh-model-profile remove <model-or-label...>",
    ].join("\n");

    const handleCommand = async (ctx: IProfilesContext & { args: string; argv?: string[] }) => {
      const argv = Array.isArray(ctx.argv) ? ctx.argv : (ctx.args || "").trim().split(/\s+/u).filter(Boolean);
      const { sub, positional, scope, error } = parseCommandArgs(argv);
      if (error) return commandOutput(`${error}\n${usage}`, false);

      if (sub === "list") {
        const state = readProfiles(ctx);
        const size = ctx.contextWindow?.size;
        const contextText = typeof size === "number" && size > 0 ? `${size.toLocaleString()} tokens` : "unknown";
        const reasoningText = ctx.model?.reasoningEffort ? `, reasoning: ${ctx.model.reasoningEffort}` : "";
        const current = `${ctx.model?.id || "unknown"} (context: ${contextText}${reasoningText})`;
        const rows = Object.entries(state.profiles).map(([handle, profile]) => {
          const label = profile.label ? ` (${profile.label})` : "";
          const reasoning = profile.reasoningEffort ? ` [reasoning: ${profile.reasoningEffort}]` : "";
          return `  - ${handle}${label}: ${profile.contextWindow.toLocaleString()} tokens${reasoning}`;
        });
        return commandOutput([
          `Mahiro Model Profiles (${getProfilesPath(ctx)})`,
          `Current: ${current}`,
          "Saved profiles:",
          ...(rows.length > 0 ? rows : ["  (no profiles saved yet)"]),
          "",
          usage,
        ].join("\n"));
      }

      if (sub === "set") {
        const [model, rawWindow, ...rest] = positional;
        const contextWindow = positiveInteger(rawWindow);
        if (!model || !contextWindow || !isSafeText(model, MAX_HANDLE_LENGTH)) return commandOutput(usage, false);
        const first = rest[0]?.toLowerCase();
        const reasoningEffort = isReasoningEffort(first) ? first : undefined;
        const label = (reasoningEffort ? rest.slice(1) : rest).join(" ").trim();
        if (label && !isSafeText(label, MAX_LABEL_LENGTH)) return commandOutput("Label is too long or contains control characters.", false);
        const { path } = saveProfile(ctx, model, {
          contextWindow,
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(label ? { label } : {}),
        });
        const detail = `${contextWindow.toLocaleString()} tokens${reasoningEffort ? ` [${reasoningEffort}]` : ""}${label ? ` (${label})` : ""}`;
        return commandOutput(`Saved profile for ${model}: ${detail}\nStorage: ${path}`);
      }

      if (sub === "switch") {
        const query = positional.join(" ").trim();
        if (!isSafeText(query, MAX_HANDLE_LENGTH)) return commandOutput(usage, false);
        const target = resolveSwitch(readProfiles(ctx), query, { scope });
        try {
          const applied = await applySwitch(ctx, target);
          return commandOutput(describeSwitch(applied, target.fromProfile));
        } catch (error) {
          return commandOutput(`Failed to switch model: ${error instanceof Error ? error.message : String(error)}`, false);
        }
      }

      if (sub === "remove" || sub === "delete") {
        const query = positional.join(" ").trim();
        if (!isSafeText(query, MAX_HANDLE_LENGTH)) return commandOutput(usage, false);
        const removed = removeProfile(ctx, query);
        if (!removed) return commandOutput(`Profile "${query}" not found.`, false);
        return commandOutput(`Removed profile for ${removed.handle}.\nStorage: ${removed.path}`);
      }

      return commandOutput(`Unknown subcommand "${sub}".\n${usage}`, false);
    };

    disposers.push(letta.commands.register({
      id: "mh-model-profile",
      description: "Manage per-model context window and reasoning profiles",
      args: "[list|set|switch|remove]",
      run: handleCommand,
    }));
  }

  return () => {
    if (letta.signal?.aborted) {
      reportWarning = () => {};
      return;
    }
    disposers.reverse().forEach((dispose) => {
      try {
        dispose();
      } catch {}
    });
    reportWarning = () => {};
  };
}
