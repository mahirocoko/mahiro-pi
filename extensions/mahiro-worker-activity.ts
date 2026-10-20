import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { startWorkerActivity } from "../lib/worker-activity.ts";

/** Inactive resource: explicitly add only in owned review fixtures. */
export default function mahiroWorkerActivity(pi: ExtensionAPI) {
  const sessions = new WeakMap<
    object,
    ReturnType<typeof startWorkerActivity>
  >();
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    sessions.get(ctx.sessionManager)?.dispose();
    sessions.set(ctx.sessionManager, startWorkerActivity(ctx));
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    sessions.get(ctx.sessionManager)?.dispose();
    sessions.delete(ctx.sessionManager);
  });
}
