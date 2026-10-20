// Trusted configuration must load this package's ordered two-entry manifest,
// not index.ts alone. A physically absent/disabled package cannot enforce itself;
// this is tool-dispatch protection, not universal inference/resource containment.
// Mandatory presence gate. Keep independent of SDK imports, optional peers and
// canonical factories so a later adapter import/registration failure cannot
// silently leave a previously registered native tool executable.
export default function bootstrap(pi) {
  const key = Symbol.for("@mahirocoko/pi-guards:healthy-nodes");
  pi.on("session_start", (_event, ctx) => {
    // This manifest entry runs first; only the completed index generation may
    // republish this session's health during the following session_start hook.
    globalThis[key]?.delete(ctx.sessionManager.getSessionId());
  });
  pi.on("tool_call", (_event, ctx) => {
    try {
      const node = globalThis[key]?.get(ctx.sessionManager.getSessionId());
      if (node?.healthy?.() === true) return;
    } catch {
      // A broken health callback is absence of assurance, never approval.
    }
    return {
      block: true,
      reason:
        "Pi guard unavailable: canonical node missing or unhealthy; all tools blocked.",
    };
  });
}
