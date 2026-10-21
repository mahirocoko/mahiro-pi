import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWebActivityPublisher } from "../lib/worker-activity-web.ts";
import { startWorkerActivity } from "../lib/worker-activity.ts";

/** Optional explicit resource, separate from the guards-first13 manifest. */
export default function mahiroWorkerActivity(pi: ExtensionAPI) {
  const sessions = new WeakMap<
    object,
    {
      activity: ReturnType<typeof startWorkerActivity>;
      web?: ReturnType<typeof createWebActivityPublisher>;
    }
  >();
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const previous = sessions.get(ctx.sessionManager);
    previous?.web?.dispose();
    previous?.activity.dispose();
    const state: {
      activity: ReturnType<typeof startWorkerActivity>;
      web?: ReturnType<typeof createWebActivityPublisher>;
    } = {
      activity: startWorkerActivity(ctx, {
        observe: (read, current) => state.web?.publish(read, current),
      }),
    };
    sessions.set(ctx.sessionManager, state);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const state = sessions.get(ctx.sessionManager);
    state?.web?.dispose();
    state?.activity.dispose();
    sessions.delete(ctx.sessionManager);
  });
  // Interactive opt-in only, no tools/prompts, persisted configuration or grants.
  pi.registerCommand("mh-herdr-web-observer", {
    description:
      "Explicit session-only Herdr Web activity receipt: start | stop | status",
    handler: async (args, ctx) => {
      const state =
        ctx.mode === "tui" ? sessions.get(ctx.sessionManager) : undefined;
      if (!state) {
        ctx.ui.notify(
          "Observer unavailable: no foreground Herdr TUI worker owner",
          "warning",
        );
        return;
      }
      switch (args.trim()) {
        case "start":
          if (!state.web) {
            try {
              state.web = createWebActivityPublisher(ctx);
            } catch {
              ctx.ui.notify(
                "Observer unavailable; no fallback or configuration change",
                "warning",
              );
              return;
            }
          }
          state.activity.tick();
          ctx.ui.notify(state.web.status(), "info");
          break;
        case "stop":
          state.web?.dispose();
          state.web = undefined;
          ctx.ui.notify(
            "Observer stopped; prior receipt expires within 8s",
            "info",
          );
          break;
        case "status":
          ctx.ui.notify(
            state.web?.status() ??
              "Observer disabled (session-only explicit opt-in)",
            "info",
          );
          break;
        default:
          ctx.ui.notify(
            "Usage: /mh-herdr-web-observer start | stop | status",
            "warning",
          );
      }
    },
  });
}
