// Deterministic raw public-TUI evidence; no provider, profile or terminal probe.
import { pathToFileURL } from "node:url";
import { prepareDiff, renderPreparedDiff } from "../lib/claude-ui-diff.ts";
import {
  createSettingsPanel,
  UI_DEFAULTS,
  type UIPreferences,
} from "../lib/claude-ui-settings.ts";
import { geometry, native, theme } from "./claude-ui-fixture.ts";

export function polishFixture(
  kind: string,
  width: number,
  changed = false,
): string[] {
  if (kind === "diff")
    return renderPreparedDiff(
      prepareDiff(
        " 3 // Historical native edit result · ภาษาไทย 中文 👩🏽‍💻\n-4 const title = 'old story';\n-5 const enabled = false;\n+4 const title = 'new story';\n+5 const enabled = true;\n 6 export { title, enabled };\n    ...\n-20 removed();\n 21 keep();\n+21 added();",
      )!,
      width,
      theme,
      geometry,
    );
  let value: UIPreferences = { ...UI_DEFAULTS };
  const panel = createSettingsPanel({
    tui: geometry,
    geometry,
    native,
    keybindings: geometry.getKeybindings(),
    theme: () => theme,
    initial: value,
    current: () => true,
    change(next) {
      value = next;
      return true;
    },
    done() {},
    requestRender() {},
  });
  if (changed) {
    panel.handleInput!("\r"); // palette
    panel.handleInput!("\x1b[B");
    panel.handleInput!("\r"); // tinted
    panel.handleInput!("\x1b[B");
    panel.handleInput!("\r"); // unified
    panel.handleInput!("\x1b[B");
    panel.handleInput!("\r"); // detail on
  }
  return panel.render(width);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const lines = polishFixture(
    process.argv[2] ?? "diff",
    Number(process.argv[3] ?? "110"),
    process.argv.includes("--changed"),
  );
  console.log(
    (process.argv.includes("--plain")
      ? lines.map(geometry.stripTerminalSequences)
      : lines
    ).join("\n"),
  );
}
