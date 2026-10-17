import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createVoice, voiceOwner } from "../lib/finish-voice.ts";

export function activateWith(pi: ExtensionAPI, factory = createVoice) {
  let current: ReturnType<typeof createVoice> | undefined;
  let generation: symbol | undefined;
  let sessionId: string | undefined;
  let running = false;
  let outcome: "completed" | "aborted" | "error" | undefined;
  const owns = (ctx: ExtensionContext) =>
    ctx.mode === "tui" &&
    !!current &&
    !!generation &&
    voiceOwner().current?.generation === generation &&
    ctx.sessionManager.getSessionId() === sessionId;
  function dispose() {
    running = false;
    outcome = undefined;
    current?.dispose();
    current = undefined;
    if (generation && voiceOwner().current?.generation === generation) {
      voiceOwner().current = undefined;
    }
    generation = undefined;
    sessionId = undefined;
  }
  pi.on("session_start", (_event, ctx) => {
    // Gate before global ownership: SDK children cannot dispose a TUI parent.
    if (ctx.mode !== "tui") return;
    const id = ctx.sessionManager.getSessionId();
    if (!id) return;
    dispose();
    const owner = voiceOwner();
    owner.current?.dispose();
    const token = Symbol("finish-voice-generation");
    generation = token;
    sessionId = id;
    current = factory({ isCurrent: () => owner.current?.generation === token });
    owner.current = { generation: token, dispose };
  });
  pi.on("agent_start", (_event, ctx) => {
    if (!owns(ctx)) return;
    running = true;
    outcome = undefined;
  });
  pi.on("agent_before_settle", (event, ctx) => {
    if (owns(ctx) && running) outcome = event.outcome;
  });
  pi.on("agent_settled", (event, ctx) => {
    if (!owns(ctx) || !running) return;
    running = false;
    const completed = outcome === "completed" && !event.aborted;
    outcome = undefined;
    if (completed) void current?.play();
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (owns(ctx)) dispose();
  });
  return dispose;
}

export default function mahiroFinishVoice(pi: ExtensionAPI) {
  activateWith(pi);
}
