import type {
  Theme,
  ToolRenderContext,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import {
  prepareDiff,
  renderPreparedDiff,
  unifiedToNative,
} from "./claude-ui-diff.ts";
import type { UIPreferences } from "./claude-ui-settings.ts";

// Clean presentation implementation. Visual references and palette provenance:
// docs/claude-ui.md and THIRD_PARTY_NOTICES.md. No upstream entrypoints.
export const CLAUDE_THEME = "mahiro-claude-dark";
export type PaletteMode = "follow" | "claude";
export type Geometry = Pick<
  typeof import("@earendil-works/pi-tui"),
  | "visibleWidth"
  | "truncateToWidth"
  | "wrapTextWithAnsi"
  | "stripTerminalSequences"
>;
export type NativePresentation = {
  renderDiff: typeof import("@earendil-works/pi-coding-agent").renderDiff;
  keyHint: typeof import("@earendil-works/pi-coding-agent").keyHint;
};
const labels: Record<string, string> = {
  read: "Read",
  bash: "Bash",
  edit: "Update",
  write: "Write",
  grep: "Search",
  find: "Search",
  ls: "List",
};
export const supportedTools = Object.keys(labels);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const string = (value: unknown) => (typeof value === "string" ? value : "");
const normalize = (value: string) => value.replace(/\r\n?/g, "\n");
const countLines = (value: string) =>
  value === "" ? 0 : normalize(value).replace(/\n$/, "").split("\n").length;
const component = (render: (width: number) => string[]): Component => ({
  render,
  invalidate() {},
});

// Convert only a *stored* unified patch to native display-diff notation. No
// reconstruction from current files or call arguments (which are not old files).
function storedCapture(details: unknown) {
  const data = record(details);
  if (typeof data.diff === "string" && data.diff)
    return { text: normalize(data.diff), plainOnly: false };
  if (typeof data.patch !== "string" || !data.patch) return undefined;
  const converted = unifiedToNative(data.patch);
  // Keep the original capture on rejection, and carry that decision separately:
  // raw patch content can coincidentally look like numbered native display data.
  return { text: converted ?? data.patch, plainOnly: converted === undefined };
}
export function storedDiff(details: unknown): string | undefined {
  return storedCapture(details)?.text;
}

export function createToolPresentation(
  name: string,
  base: ToolRenderers,
  geometry: Geometry,
  native: NativePresentation,
  palette: (host: Theme) => Theme,
  preferences: () => Pick<
    UIPreferences,
    "toolStyle" | "diffView" | "extraDetail"
  > = () => ({
    toolStyle: "transparent",
    diffView: "split",
    extraDetail: false,
  }),
): ToolRenderers {
  const clean = (value: string) =>
    normalize(geometry.stripTerminalSequences(value)).replace(/\t/g, "   ");
  const oneLine = (value: string) => clean(value).replace(/\n/g, " ↵ ");
  const imagePath = (args: unknown) =>
    name === "read" &&
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(string(record(args).path));
  // Fallback state belongs to the adapter, never the host's shared context.
  const nativeStates = new WeakMap<object, Record<string, unknown>>();
  const fallbackContext = (ctx: ToolRenderContext): ToolRenderContext => {
    let state = nativeStates.get(ctx.state);
    if (!state) {
      state = {};
      nativeStates.set(ctx.state, state);
    }
    return { ...ctx, state, lastComponent: undefined };
  };
  const padded = (child: Component, pad: number) =>
    component((width) => {
      if (width <= 0) return [];
      const inset = Math.min(pad, Math.max(0, Math.floor((width - 1) / 2)));
      return child
        .render(Math.max(1, width - inset * 2))
        .map((line) =>
          geometry.truncateToWidth(`${" ".repeat(inset)}${line}`, width),
        );
    });
  const layout = (
    width: number,
    pad: number,
    lines: string[],
    prefix: string,
    continuation: string,
    cap?: number,
    hint?: string,
  ) => {
    if (width <= 0) return [];
    const inset = Math.min(pad, Math.max(0, Math.floor((width - 1) / 2)));
    const available = Math.max(1, width - inset * 2);
    // At very narrow widths, discard ornament before discarding content.
    const first = geometry.visibleWidth(prefix) < available ? prefix : "";
    const next =
      geometry.visibleWidth(continuation) < available ? continuation : "";
    const contentWidth = Math.max(
      1,
      available -
        Math.max(geometry.visibleWidth(first), geometry.visibleWidth(next)),
    );
    const rows = lines.flatMap((line) =>
      geometry.wrapTextWithAnsi(line, contentWidth),
    );
    const shown = cap === undefined ? rows : rows.slice(0, cap);
    if (shown.length === 0) shown.push("");
    if (cap !== undefined && rows.length > cap) {
      shown.push(`… ${rows.length - cap} more rows${hint ? ` · ${hint}` : ""}`);
    }
    return shown.map((line, index) =>
      geometry.truncateToWidth(
        `${" ".repeat(inset)}${index === 0 ? first : next}${line}`,
        width,
      ),
    );
  };
  return {
    renderShell: "self",
    renderCall(args, host, ctx) {
      // Native image rendering remains responsible for its own notes and images.
      if (imagePath(args) && base.renderCall) {
        return padded(
          base.renderCall(args, host, fallbackContext(ctx)),
          ctx.outputPad,
        );
      }
      return component((width) => {
        const theme = palette(host);
        const data = record(args);
        let argument =
          string(data.command) || string(data.path) || string(data.file_path);
        if (name === "grep" || name === "find") {
          argument = [string(data.pattern), string(data.path)]
            .filter(Boolean)
            .join(" · ");
        }
        if (name === "read") {
          if (typeof data.offset === "number")
            argument += ` · from ${data.offset}`;
          if (typeof data.limit === "number")
            argument += ` · limit ${data.limit}`;
        }
        const status = ctx.isError
          ? "error"
          : ctx.isPartial || !ctx.executionStarted
            ? "warning"
            : "success";
        const title = `${theme.bold(theme.fg("toolTitle", labels[name] ?? name))} ${theme.fg("accent", oneLine(argument) || (ctx.argsComplete ? "(no arguments)" : "…"))}`;
        return layout(
          width,
          ctx.outputPad,
          [title],
          theme.fg(status, "● "),
          "  ",
        );
      });
    },
    renderResult(result, options, host, ctx) {
      const specialized =
        imagePath(ctx.args) ||
        result.content.some((block) => block.type !== "text");
      if (specialized && base.renderResult) {
        return padded(
          base.renderResult(result, options, host, fallbackContext(ctx)),
          ctx.outputPad,
        );
      }
      const details = record(result.details);
      const capture = name === "edit" ? storedCapture(details) : undefined;
      const capturedDiff = capture?.text;
      // Parse/word alignment once per result component, not on each resize/theme
      // repaint. Keep only plain spans here; theme colors are applied at render.
      const cleanDiff =
        capturedDiff === undefined ? undefined : clean(capturedDiff);
      const diff =
        cleanDiff === undefined || capture?.plainOnly
          ? undefined
          : prepareDiff(cleanDiff);
      return component((width) => {
        const theme = palette(host);
        const prefs = preferences();
        const data = record(ctx.args);
        const partial = options.isPartial || ctx.isPartial;
        const error = ctx.isError;
        const output = result.content
          .filter((block) => block.type === "text")
          .map((block) => clean(block.text))
          .join("\n");
        const duration =
          prefs.extraDetail &&
          Number.isFinite(ctx.durationMs) &&
          ctx.durationMs !== undefined
            ? ` · ${ctx.durationMs} ms`
            : "";
        const status =
          (partial
            ? "Running…"
            : error
              ? "Error"
              : `Done (${countLines(output)} output lines)`) + duration;
        const color = error ? "error" : partial ? "warning" : "muted";
        const body = [theme.fg(color, status)];
        let cap = prefs.extraDetail ? 8 : 3;
        let previewReplacedOutput = false;
        if (!partial && !error && cleanDiff !== undefined) {
          body[0] = theme.fg("muted", `Applied${duration}`);
          const inset = Math.min(
            ctx.outputPad,
            Math.max(0, Math.floor((width - 1) / 2)),
          );
          const available = Math.max(1, width - inset * 2);
          const diffWidth = Math.max(1, available - (available > 5 ? 5 : 0));
          if (diff && prefs.diffView !== "native") {
            body.push(
              ...renderPreparedDiff(
                diff,
                diffWidth,
                theme,
                geometry,
                prefs.diffView === "split",
              ),
            );
          } else {
            body.push(
              theme.fg(
                "muted",
                "stored edit diff · native/plain fallback (all captured rows)",
              ),
            );
            // Native public diff has no palette or work-budget argument. Use it
            // only for bounded parsed captures with bounded token work. Large,
            // malformed or long-line inputs stay plain, never discarded.
            body.push(
              diff && !diff.highlightsLimited
                ? native.renderDiff(cleanDiff)
                : theme.fg("toolOutput", cleanDiff),
            );
          }
          previewReplacedOutput = true;
          cap = prefs.extraDetail ? 22 : 10;
        } else if (
          !partial &&
          !error &&
          name === "write" &&
          typeof data.content === "string"
        ) {
          body[0] = theme.fg(
            "muted",
            `Wrote ${countLines(data.content)} lines · submitted content preview (not an overwrite diff)`,
          );
          body.push(
            ...(data.content === ""
              ? [theme.fg("dim", "(empty submitted content)")]
              : clean(data.content)
                  .replace(/\n$/, "")
                  .split("\n")
                  .map(
                    (line, index) =>
                      `${theme.fg("dim", `${index + 1} `)}${theme.fg("toolOutput", line)}`,
                  )),
          );
          previewReplacedOutput = true;
          cap = prefs.extraDetail ? 22 : 11;
        } else {
          if (!partial && !error && name === "read") {
            body[0] = theme.fg("muted", `${countLines(output)} output lines`);
          }
          if (output)
            body.push(theme.fg(error ? "error" : "toolOutput", output));
          else if (!partial) body.push(theme.fg("dim", "(no text output)"));
        }
        // When a preview replaced generic output, retain native status too:
        // it can contain truncation notices, a captured path, or a write warning.
        if (previewReplacedOutput && output) {
          body.push(theme.fg("toolOutput", output));
        }
        const truncation = record(details.truncation);
        if (truncation.truncated) {
          body.push(
            theme.fg(
              "warning",
              "Native output truncated; expansion shows only captured output.",
            ),
          );
        }
        if (typeof details.fullOutputPath === "string") {
          body.push(
            theme.fg("muted", `Full output: ${clean(details.fullOutputPath)}`),
          );
        }
        // Notices remain visible even while collapsed (not buried after cap).
        const notices = body.splice(
          body.length -
            Number(!!truncation.truncated) -
            Number(typeof details.fullOutputPath === "string"),
        );
        const hint = native.keyHint("app.tools.expand", "to expand");
        const rendered = [
          ...layout(
            width,
            ctx.outputPad,
            body.flatMap((line) => line.split("\n")),
            theme.fg("dim", "  ⎿  "),
            "     ",
            options.expanded ? undefined : cap,
            hint,
          ),
          ...notices.flatMap((notice) =>
            layout(width, ctx.outputPad, [notice], "     ", "     "),
          ),
        ];
        if (prefs.toolStyle === "transparent") return rendered;
        return rendered.map((line) =>
          theme.bg(
            error
              ? "toolErrorBg"
              : partial
                ? "toolPendingBg"
                : "customMessageBg",
            line,
          ),
        );
      });
    },
  };
}

export type HeaderData = {
  version: string;
  model: string;
  effort: string;
  cwd: string;
  activeTools: number;
  registeredTools: number;
  commands: number;
  mcpServers: number;
  paletteMode: PaletteMode;
};

export function renderStartupHeader(
  data: HeaderData,
  width: number,
  theme: Theme,
  geometry: Geometry,
): string[] {
  if (width <= 0) return [];
  const text = (value: string) =>
    geometry.stripTerminalSequences(value).replace(/[\r\n\t]/g, " ");
  const fit = (value: string, size: number) => {
    const cut = geometry.truncateToWidth(value, Math.max(0, size));
    return cut + " ".repeat(Math.max(0, size - geometry.visibleWidth(cut)));
  };
  // Argon candidate 02, Neko-Stack; selected by Mahiro. Keep all six raw
  // 16-cell rows verbatim, including whitespace (not cc-my-pi palette art).
  const logo = [
    " ▄██▄    ▄██▄   ",
    " ████████████   ",
    "-██▄██████▄██-  ",
    " ████████████  ▄",
    " ████████████▄█▀",
    " ▀▀████████▀▀▀  ",
  ];
  const left = [
    theme.bold("Mahiro"),
    ...logo.map((line) => theme.fg("accent", line)),
    theme.fg("muted", text(data.model)),
    theme.fg("muted", `${text(data.effort)} effort`),
    theme.fg("dim", text(data.cwd)),
  ];
  const right = [
    theme.bold(theme.fg("accent", "Getting started")),
    theme.fg("muted", "/mh-ui theme status · follow · claude"),
    theme.bold(theme.fg("accent", "Available via public API")),
    theme.fg(
      "muted",
      `${data.activeTools} active / ${data.registeredTools} registered tools · ${data.commands} resource commands`,
    ),
    theme.fg(
      "muted",
      `${data.mcpServers} extension MCP registrations · palette: ${data.paletteMode}`,
    ),
    theme.fg("dim", "Skills / extensions / global-project totals unavailable"),
  ];
  if (width < 6) return [geometry.truncateToWidth("Mahiro", width)];
  const inside = width - 2;
  const title = ` Pi v${text(data.version)} `;
  const top = `╭${fit(theme.fg("accent", title), inside).replace(/ +$/, (spaces) => "─".repeat(spaces.length))}╮`;
  const border = (line: string) =>
    theme.fg("borderAccent", "│") +
    fit(line, inside) +
    theme.fg("borderAccent", "│");
  const rows: string[] = [];
  if (width >= 76) {
    const leftWidth = Math.min(38, Math.floor(inside / 3));
    for (let index = 0; index < left.length; index++) {
      rows.push(
        border(
          ` ${fit(left[index]!, leftWidth - 2)} ${theme.fg("borderMuted", "│")} ${fit(right[index] ?? "", inside - leftWidth - 3)}`,
        ),
      );
    }
  } else {
    for (const [index, line] of [...left, ...right].entries()) {
      const available = Math.max(1, inside - 2);
      // Crop art rather than wrapping/reflowing its pixels in narrow headers.
      const lines =
        index >= 1 && index <= logo.length
          ? [geometry.truncateToWidth(line, available, "")]
          : geometry.wrapTextWithAnsi(line, available);
      for (const wrapped of lines) {
        rows.push(border(` ${wrapped}`));
      }
    }
  }
  return [
    theme.fg("borderAccent", top),
    ...rows,
    theme.fg("borderAccent", `╰${"─".repeat(inside)}╯`),
  ];
}
