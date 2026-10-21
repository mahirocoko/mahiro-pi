import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import {
  CLAUDE_THEME,
  createToolPresentation,
  type Geometry,
  type NativePresentation,
  renderStartupHeader,
  supportedTools,
} from "../lib/claude-ui.ts";
import {
  createSettingsPanel,
  PERSISTENCE_LIMIT,
  UI_DEFAULTS,
  type UIPreferences,
} from "../lib/claude-ui-settings.ts";

// Session-runtime-only controller. No settings, profile, transcript or filesystem
// writes; follow is the default for every new extension runtime (including reload).
export default function mahiroClaudeUI(pi: ExtensionAPI) {
  let generation = 0;
  let preferences: UIPreferences = { ...UI_DEFAULTS };
  let fixed: Theme | undefined;
  let geometry: Geometry | undefined;
  let native: NativePresentation | undefined;
  let version = "";
  let context: ExtensionContext | undefined;
  let requestRender = () => {};
  const originals = new Map<string, ToolRenderers>();
  const palette = (host: Theme) =>
    preferences.palette === "claude" && fixed ? fixed : host;

  // Register the resolver at load time, but do not import a runtime peer or
  // activate presentation until interactive startup. Keep custom same-name
  // renderers native too: compare public factory renderer identities, not names
  // alone, private tool registry fields, or guesses from descriptions.
  pi.registerToolRenderer((name, next) => {
    const base = next();
    if (!supportedTools.includes(name) || !base) return base;
    let adapted: ToolRenderers | undefined;
    const choose = () => {
      if (!context || !geometry || !native) return undefined;
      const original = originals.get(name);
      if (
        !original ||
        base.renderCall !== original.renderCall ||
        base.renderResult !== original.renderResult ||
        base.renderShell !== original.renderShell
      )
        return undefined;
      adapted ??= createToolPresentation(
        name,
        base,
        geometry,
        native,
        palette,
        () => preferences,
      );
      return adapted;
    };
    return {
      get renderShell() {
        return choose()?.renderShell ?? base.renderShell;
      },
      get renderCall() {
        return choose()?.renderCall ?? base.renderCall;
      },
      get renderResult() {
        return choose()?.renderResult ?? base.renderResult;
      },
    };
  });

  const installHeader = (ctx: ExtensionContext) => {
    if (!geometry) return;
    const currentGeometry = geometry;
    ctx.ui.setHeader((tui) => {
      requestRender = () => tui.requestRender();
      return {
        render(width) {
          // All data comes from public, read-only context/API snapshots. No
          // resource loader, settings file or filesystem access in rendering.
          const current = context ?? ctx;
          return renderStartupHeader(
            {
              version,
              cwd: current.cwd,
              model: current.model
                ? `${current.model.provider}/${current.model.id}`
                : "Model unavailable",
              effort:
                current.thinkingLevel ?? pi.getThinkingLevel() ?? "unavailable",
              activeTools: pi.getActiveTools().length,
              registeredTools: pi.getAllTools().length,
              commands: pi.getCommands().length,
              mcpServers: pi.getMcpServers().length,
              paletteMode: preferences.palette,
            },
            width,
            palette(current.ui.theme),
            currentGeometry,
          );
        },
        invalidate() {},
        dispose() {
          requestRender = () => {};
        },
      };
    });
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const revision = ++generation;
    context = undefined;
    geometry = undefined;
    native = undefined;
    originals.clear();
    const tui = await import("@earendil-works/pi-tui");
    const sdk = await import("@earendil-works/pi-coding-agent");
    if (revision !== generation) return;
    geometry = tui;
    native = { renderDiff: sdk.renderDiff, keyHint: sdk.keyHint };
    version = sdk.VERSION;
    // Factories only identify their public presentation functions. Never call
    // execute(), wrap tools, or register replacement definitions.
    originals.set("read", sdk.createReadToolDefinition(ctx.cwd));
    originals.set("bash", sdk.createBashToolDefinition(ctx.cwd));
    originals.set("edit", sdk.createEditToolDefinition(ctx.cwd));
    originals.set("write", sdk.createWriteToolDefinition(ctx.cwd));
    originals.set("grep", sdk.createGrepToolDefinition(ctx.cwd));
    originals.set("find", sdk.createFindToolDefinition(ctx.cwd));
    originals.set("ls", sdk.createLsToolDefinition(ctx.cwd));
    fixed = ctx.ui.getTheme(CLAUDE_THEME);
    if (preferences.palette === "claude" && !fixed)
      preferences = { ...preferences, palette: "follow" };
    context = ctx;
    installHeader(ctx);
  });
  pi.on("model_select", (_event, ctx) => {
    if (ctx.mode !== "tui" || !context) return;
    context = ctx;
    requestRender();
  });
  pi.on("thinking_level_select", (_event, ctx) => {
    if (ctx.mode !== "tui" || !context) return;
    context = ctx;
    requestRender();
  });
  pi.on("mcp_servers_change", (_event, ctx) => {
    if (ctx.mode === "tui") requestRender();
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    generation++;
    if (context && ctx.mode === "tui") ctx.ui.setHeader(undefined);
    context = undefined;
    geometry = undefined;
    native = undefined;
    fixed = undefined;
    originals.clear();
    requestRender = () => {};
  });
  pi.registerCommand("mh-ui", {
    description:
      "Mahiro UI settings with live preview; theme status | follow | claude (not persisted)",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui" || !context) return;
      const action = args.trim() || "settings";
      if (action === "settings") {
        if (!geometry || !native) return;
        const revision = generation;
        const tui = await import("@earendil-works/pi-tui");
        if (revision !== generation || !context || !geometry || !native) return;
        const panelGeometry = geometry;
        const panelNative = native;
        fixed = ctx.ui.getTheme(CLAUDE_THEME);
        if (preferences.palette === "claude" && !fixed) {
          preferences = { ...preferences, palette: "follow" };
          requestRender();
          ctx.ui.notify(
            "Fixed UI palette unavailable; following the host theme.",
            "warning",
          );
        }
        let expected = preferences;
        const current = () =>
          revision === generation && !!context && preferences === expected;
        await ctx.ui.custom<void>((screen, _theme, keybindings, done) =>
          createSettingsPanel({
            tui,
            geometry: panelGeometry,
            native: panelNative,
            keybindings,
            theme: () => palette(ctx.ui.theme),
            initial: preferences,
            current,
            change(value) {
              if (!current() || (value.palette === "claude" && !fixed))
                return false;
              preferences = { ...value };
              expected = preferences;
              requestRender();
              return true;
            },
            done: () => done(undefined),
            requestRender: () => screen.requestRender(),
          }),
        );
        return;
      }
      if (action === "theme claude") {
        // Public getTheme may load a resource: commands/startup only, never render.
        const candidate = ctx.ui.getTheme(CLAUDE_THEME);
        if (!candidate) {
          ctx.ui.notify(
            `Theme resource ${CLAUDE_THEME} unavailable; keeping ${preferences.palette}.`,
            "warning",
          );
          return;
        }
        fixed = candidate;
        preferences = { ...preferences, palette: "claude" };
      } else if (action === "theme follow") {
        preferences = { ...preferences, palette: "follow" };
      } else if (action !== "theme status" && action !== "theme") {
        ctx.ui.notify(
          "Usage: /mh-ui [settings] | theme status|follow|claude",
          "warning",
        );
        return;
      }
      context = ctx;
      requestRender();
      ctx.ui.notify(
        `Mahiro UI palette: ${preferences.palette} · ${palette(ctx.ui.theme).name}. ` +
          (preferences.palette === "follow"
            ? "Follows the current Pi theme."
            : "Fixed Claude palette for these tool rows/header and split/unified diff; native diff still follows Pi.") +
          ` Host theme/footer unchanged. ${PERSISTENCE_LIMIT}`,
        "info",
      );
    },
  });
}
