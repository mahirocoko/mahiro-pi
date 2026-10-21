import type {
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, SettingItem } from "@earendil-works/pi-tui";
import {
  createToolPresentation,
  type Geometry,
  type NativePresentation,
  type PaletteMode,
} from "./claude-ui.ts";

export type UIPreferences = {
  palette: PaletteMode;
  toolStyle: "transparent" | "tinted";
  diffView: "split" | "unified" | "native";
  extraDetail: boolean;
};
export const UI_DEFAULTS: Readonly<UIPreferences> = Object.freeze({
  palette: "follow",
  toolStyle: "transparent",
  diffView: "split",
  extraDetail: false,
});
export const PERSISTENCE_LIMIT =
  "Not persisted: no authorized own-UI DATA storage owner is exposed. Reload resets defaults. Host settings and grants are unchanged.";

// A panel instance owns a copy, never a session entry or native settings object.
// No filesystem/permission fallback: runtime Apply is deliberately not Save.
export function createSettingsPanel(options: {
  tui: Pick<typeof import("@earendil-works/pi-tui"), "SettingsList" | "Text">;
  geometry: Geometry;
  native: NativePresentation;
  keybindings: Pick<KeybindingsManager, "matches">;
  theme: () => Theme;
  initial: UIPreferences;
  current: () => boolean;
  change: (value: UIPreferences) => boolean;
  done: () => void;
  requestRender: () => void;
}): Component & { dispose(): void } {
  const original = { ...options.initial };
  let draft = { ...original };
  let closed = false;
  let expanded = false;
  let message =
    "Changes apply live; Cancel restores the original runtime choices.";
  const current = () => !closed && options.current();
  const finish = (cancel: boolean) => {
    if (closed) return;
    if (cancel && options.current()) options.change({ ...original });
    closed = true;
    options.done();
  };
  const items: SettingItem[] = [
    {
      id: "palette",
      label: "Palette",
      currentValue: draft.palette,
      values: ["follow", "claude"],
      description:
        "Only Mahiro tool rows and header; never the host theme or footer.",
    },
    {
      id: "toolStyle",
      label: "Tool style",
      currentValue: draft.toolStyle,
      values: ["transparent", "tinted"],
      description:
        "Transparent output or a subtle state background. No grouping or execution changes.",
    },
    {
      id: "diffView",
      label: "Edit diff",
      currentValue: draft.diffView,
      values: ["split", "unified", "native"],
      description:
        "Split at wide widths, unified when narrow. Only captured native edit details; writes show submitted content.",
    },
    {
      id: "extraDetail",
      label: "Extra detail",
      currentValue: draft.extraDetail ? "on" : "off",
      values: ["off", "on"],
      description:
        "More collapsed output rows plus captured duration. Expansion always keeps all captured text.",
    },
    {
      id: "apply",
      label: "Apply for this runtime",
      currentValue: "select",
      values: ["select", "apply"],
      description: "Keep these live choices and close. Not saved to disk.",
    },
    {
      id: "reset",
      label: "Reset runtime defaults",
      currentValue: "select",
      values: ["select", "reset"],
      description:
        "Preview follow / transparent / split / detail off. Cancel can still restore your original choices.",
    },
    {
      id: "cancel",
      label: "Cancel changes",
      currentValue: "select",
      values: ["select", "cancel"],
      description: "Restore the choices from when this panel opened.",
    },
  ];
  const sync = () => {
    for (const key of [
      "palette",
      "toolStyle",
      "diffView",
      "extraDetail",
    ] as const)
      list.updateValue(
        key,
        key === "extraDetail"
          ? draft.extraDetail
            ? "on"
            : "off"
          : String(draft[key]),
      );
    for (const id of ["reset", "apply", "cancel"])
      list.updateValue(id, "select");
  };
  const list = new options.tui.SettingsList(
    items,
    items.length,
    {
      label: (s, selected) =>
        options.theme().fg(selected ? "accent" : "text", s),
      value: (s, selected) =>
        options.theme().fg(selected ? "accent" : "muted", s),
      description: (s) => options.theme().fg("dim", s),
      cursor: "→ ",
      hint: (s) => options.theme().fg("dim", s),
    },
    (id, value) => {
      if (!current()) {
        message = "Stale panel: no runtime changes applied.";
        return;
      }
      if (id === "apply") {
        finish(false);
        return;
      }
      if (id === "cancel") {
        finish(true);
        return;
      }
      const candidate =
        id === "reset"
          ? { ...UI_DEFAULTS }
          : ({
              ...draft,
              [id]: id === "extraDetail" ? value === "on" : value,
            } as UIPreferences);
      if (options.change({ ...candidate })) {
        draft = candidate;
        message =
          id === "reset"
            ? "Previewing documented runtime defaults."
            : `Changed ${id} → ${value}. Preview below uses the actual renderer.`;
      } else
        message =
          "Choice unavailable or stale; previous runtime choices retained.";
      sync();
      options.requestRender();
    },
    () => finish(true),
  );
  const text = (s: string, width: number) =>
    new options.tui.Text(s, 0, 0).render(Math.max(1, width));
  return {
    render(width) {
      if (width <= 0) return [];
      const theme = options.theme();
      return [
        ...text(
          theme.bold(theme.fg("accent", "Mahiro UI settings · runtime only")),
          width,
        ),
        "",
        ...list.render(Math.max(8, width)),
        "",
        ...text(theme.fg("warning", PERSISTENCE_LIMIT), width),
        "",
        ...text(
          theme.fg(
            "muted",
            current() ? message : "Stale panel: close and reopen settings.",
          ),
          width,
        ),
        "",
        ...text(
          theme.bold("Preview · synthetic sample, not tool execution"),
          width,
        ),
        ...renderSettingsPreview(
          draft,
          width,
          theme,
          options.geometry,
          options.native,
          expanded,
        ),
      ].map((line) => options.geometry.truncateToWidth(line, width, ""));
    },
    invalidate() {
      list.invalidate();
    },
    handleInput(data) {
      if (!current()) {
        finish(false);
        return;
      }
      if (options.keybindings.matches(data, "app.tools.expand"))
        expanded = !expanded;
      else list.handleInput(data);
      options.requestRender();
    },
    dispose() {
      if (!closed) finish(true);
    },
  };
}

/** Real presentation path shared by panel and deterministic fixtures. */
export function renderSettingsPreview(
  preferences: UIPreferences,
  width: number,
  theme: Theme,
  geometry: Geometry,
  native: NativePresentation,
  expanded = false,
): string[] {
  const renderer = createToolPresentation(
    "edit",
    {},
    geometry,
    native,
    (host) => host,
    () => preferences,
  );
  const ctx = {
    args: { path: "sample.ts" },
    state: {},
    outputPad: 0,
    isPartial: false,
    isError: false,
    argsComplete: true,
    executionStarted: true,
    durationMs: 24,
  } as Parameters<NonNullable<typeof renderer.renderCall>>[2];
  const result = {
    content: [
      {
        type: "text" as const,
        text: "Applied sample edit.\nCaptured status retained.",
      },
    ],
    details: {
      diff: " 1 // ภาษาไทย 中文 👩🏽‍💻\n-2 const title = 'old word';\n-3 const enabled = false;\n+2 const title = 'new word';\n+3 const enabled = true;\n 4 export { title };",
    },
  };
  return [
    ...renderer.renderCall!(ctx.args, theme, ctx).render(width),
    ...renderer.renderResult!(
      result,
      { expanded, isPartial: false },
      theme,
      ctx,
    ).render(width),
  ];
}
