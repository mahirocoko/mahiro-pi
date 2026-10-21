import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { createToolPresentation, storedDiff } from "../lib/claude-ui.ts";
import {
  DIFF_LIMITS,
  prepareDiff,
  renderPreparedDiff,
  unifiedToNative,
} from "../lib/claude-ui-diff.ts";
import {
  createSettingsPanel,
  PERSISTENCE_LIMIT,
  renderSettingsPreview,
  UI_DEFAULTS,
  type UIPreferences,
} from "../lib/claude-ui-settings.ts";
import {
  geometry,
  native,
  renderContext,
  theme,
  themeFrom,
} from "./claude-ui-fixture.ts";

const plain = (lines: string[]) =>
  lines.map(geometry.stripTerminalSequences).join("\n");
const sample =
  " 1 // ภาษาไทย 中文 👩🏽‍💻 é\n-2 const first = 'old word';\n-3 const second = false;\n+2 const first = 'new word';\n+3 const second = true;\n 4 export { first };";

test("paired multi-line edits highlight words, keep all text, and do not mutate input", () => {
  const model = prepareDiff(sample)!;
  assert.equal(model.added, 2);
  assert.equal(model.removed, 2);
  assert.equal(model.rows.length, 4);
  for (const row of model.rows.filter((r) => !r.context)) {
    assert.ok(row.old!.spans!.some((s) => s.changed));
    assert.ok(row.next!.spans!.some((s) => s.changed));
    assert.equal(row.old!.spans!.map((s) => s.text).join(""), row.old!.text);
    assert.equal(row.next!.spans!.map((s) => s.text).join(""), row.next!.text);
  }
  const before = JSON.stringify(model);
  const wide = renderPreparedDiff(model, 110, theme, geometry);
  assert.match(plain(wide), /old\s+│ new/);
  assert.ok(
    wide.join("\n").includes("\x1b[7m"),
    "changed words have inverse style",
  );
  assert.match(plain(wide), /ภาษาไทย 中文 👩🏽‍💻 é/);
  assert.equal(JSON.stringify(model), before);
});

test("new/deleted lines, unequal blocks and explicit patch hunks retain correct old/new numbers", () => {
  for (const [diff, added, removed] of [
    ["+1 new\n+2 file", 2, 0],
    ["-1 deleted\n-2 file", 0, 2],
  ] as const) {
    const model = prepareDiff(diff)!;
    assert.equal(model.added, added);
    assert.equal(model.removed, removed);
    assert.match(
      plain(renderPreparedDiff(model, 90, theme, geometry)),
      added ? /new[\s\S]*file/ : /deleted[\s\S]*file/,
    );
  }
  const patch =
    "--- a/file\r\n+++ b/file\r\n@@ -5,2 +7,3 @@\r\n-\ufeffold\r\n+\ufeffnew\r\n+extra\r\n context\r\n@@ -20,2 +23,1 @@\r\n-last\r\n unchanged\r\n\\ No newline at end of file\r\n";
  const model = prepareDiff(storedDiff({ patch })!)!;
  const contexts = model.rows.filter((r) => r.context);
  assert.deepEqual(
    contexts.map((r) => [r.old!.number, r.next!.number]),
    [
      [6, 9],
      [21, 23],
    ],
  );
  const output = plain(renderPreparedDiff(model, 40, theme, geometry));
  assert.match(output, /6\/9.*context/);
  assert.match(output, /\ufeffold[\s\S]*\ufeffnew/);
  assert.match(output, /No newline/);
});

test("stored unified grammar validates counts; rejected captures stay entire plain in actual renderer", () => {
  const twoFiles =
    "--- a/one\n+++ b/one\n@@ -1 +1 @@\n-old\n+new\n--- a/two\n+++ b/two\n@@ -1 +1 @@\n-before\n+after\n";
  const malformed =
    "--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-old\n+new\n+EXTRA OUTSIDE DECLARED HUNK\n";
  for (const patch of [
    twoFiles,
    malformed,
    "@@ -1 +1 @@\n-old\n", // underfilled
    "@@ -1,0 +1,0 @@\n+1 EXTRA\n", // raw body mimics native numbering
    "@@ -0 +1 @@\n-old\n+new\n",
    "@@ -9007199254740991,2 +1 @@\n-old\n-old\n+new\n",
    "@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-again\n+again\n",
    "@@ -1 +1 @@\n\\ No newline at end of file\n-old\n+new\n",
  ]) {
    assert.equal(unifiedToNative(patch), undefined);
    assert.equal(storedDiff({ patch }), patch, "original bytes retained");
    for (const diffView of ["split", "unified", "native"] as const) {
      let nativeCalls = 0;
      const renderer = createToolPresentation(
        "edit",
        {},
        geometry,
        {
          ...native,
          renderDiff() {
            nativeCalls++;
            throw Error("rejected patch reached native diff");
          },
        },
        (h) => h,
        () => ({ ...UI_DEFAULTS, diffView }),
      );
      const output = plain(
        renderer.renderResult!(
          {
            content: [{ type: "text", text: "Historical native result" }],
            details: { patch },
          },
          { expanded: true, isPartial: false },
          theme,
          renderContext(),
        ).render(160),
      );
      assert.match(output, /native\/plain fallback \(all captured rows\)/);
      assert.doesNotMatch(output, /\+\d+ −\d+|old\s+│ new/);
      for (const line of patch.trimEnd().split("\n"))
        assert.ok(output.includes(line), line);
      assert.match(output, /Historical native result/);
      assert.equal(nativeCalls, 0);
    }
  }
});

test("validated unified new/deleted/zero/multiple hunks and header-like bodies preserve split/word spans", () => {
  const cases = [
    {
      patch: "--- /dev/null\n+++ b/file\n@@ -0,0 +1,2 @@\n+first\n+second\n",
      added: 2,
      removed: 0,
    },
    {
      patch: "--- a/file\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-first\n-second\n",
      added: 0,
      removed: 2,
    },
    { patch: "@@ -0,0 +0,0 @@\n", added: 0, removed: 0 },
    {
      patch: "@@ -1 +1 @@\n--- old word\n+++ new word\n",
      added: 1,
      removed: 1,
    },
    {
      patch:
        "@@ -1 +1 @@\n--- old word\n\\ No newline at end of file\n+++ new word\n\\ No newline at end of file\n@@ -5,2 +5,3 @@\n same\n-old tail\n+new tail\n+extra\n",
      added: 3,
      removed: 2,
    },
  ];
  for (const { patch, added, removed } of cases) {
    const converted = unifiedToNative(patch);
    assert.ok(converted);
    assert.equal(storedDiff({ patch }), converted);
    const model = prepareDiff(converted)!;
    assert.equal(model.added, added);
    assert.equal(model.removed, removed);
    for (const row of model.rows) {
      if (row.old && row.next && !row.context) {
        assert.equal(row.old.spans!.map((s) => s.text).join(""), row.old.text);
        assert.equal(
          row.next.spans!.map((s) => s.text).join(""),
          row.next.text,
        );
        assert.ok(row.old.spans!.some((s) => s.changed));
        assert.ok(row.next.spans!.some((s) => s.changed));
      }
    }
    const renderer = createToolPresentation(
      "edit",
      {},
      geometry,
      native,
      (h) => h,
    );
    const output = plain(
      renderer.renderResult!(
        { content: [], details: { patch } },
        { expanded: true, isPartial: false },
        theme,
        renderContext(),
      ).render(110),
    );
    assert.match(
      output,
      new RegExp(`\\+${added} −${removed} · stored edit diff`),
    );
    assert.match(output, /old\s+│ new/);
    assert.doesNotMatch(output, /fallback/);
    if (patch.includes("--- old word")) {
      assert.ok(model.rows.some((r) => r.old?.text === "-- old word"));
      assert.ok(model.rows.some((r) => r.next?.text === "++ new word"));
      assert.match(output, /-- old word/);
      assert.match(output, /\+\+ new word/);
      if (patch.includes("No newline")) assert.match(output, /No newline/);
    }
  }
});

test("native display gaps preserve offset; malformed and huge inputs choose full fallback", () => {
  const model = prepareDiff(" 1 a\n-2 b\n+2 c\n+3 d\n    ...\n 40 later")!;
  const last = model.rows.at(-1)!;
  assert.deepEqual([last.old!.number, last.next!.number], [40, 41]);
  for (const text of [
    "garbage",
    "-9007199254740999 bad",
    "-1 old\nunknown",
    "x".repeat(DIFF_LIMITS.chars + 1),
    "+1 x\n".repeat(DIFF_LIMITS.lines + 1),
  ])
    assert.equal(prepareDiff(text), undefined);
  assert.equal(prepareDiff(""), undefined);
});

test("word work and long-line limits are bounded, never discard captured data", () => {
  const long = "x".repeat(DIFF_LIMITS.line + 10) + "LAST";
  const start = performance.now();
  const model = prepareDiff(`-1 ${long}\n+1 ${long} changed`)!;
  assert.ok(model.highlightsLimited);
  assert.match(plain(renderPreparedDiff(model, 110, theme, geometry)), /LAST/);
  const repeated = Array.from(
    { length: 150 },
    (_, i) =>
      `-${i + 1} ${"a b c ".repeat(30)}\n+${i + 1} ${"d e f ".repeat(30)}`,
  ).join("\n");
  const bounded = prepareDiff(repeated)!;
  assert.ok(bounded.highlightsLimited);
  assert.ok(
    performance.now() - start < 3000,
    "bounded work, not an unbounded quadratic diff",
  );
});

test("widths, native outputPad, wrap, theme changes, ANSI sanitization and expansion are truthful", () => {
  let fixed = false;
  const other = themeFrom("different-palette");
  // Pick another public palette with different concrete colors, no host mutation.
  const light = new (
    theme.constructor as typeof import("@earendil-works/pi-coding-agent").Theme
  )(
    Object.fromEntries(
      Object.keys(theme.colors).map((k) => [k, "#111111"]),
    ) as never,
    Object.fromEntries(
      Object.keys(theme.colors).map((k) => [k, "#eeeeee"]),
    ) as never,
    "truecolor",
    { name: other.name, appearance: "light" },
  );
  const prefs = { ...UI_DEFAULTS };
  const renderer = createToolPresentation(
    "edit",
    {},
    geometry,
    native,
    (host) => (fixed ? light : host),
    () => prefs,
  );
  const captured = Object.freeze({
    content: Object.freeze([
      { type: "text" as const, text: "NATIVE STATUS LAST" },
    ]),
    details: Object.freeze({ diff: sample + "\n+5 \x1b[31mANSI\x1b[0m" }),
  });
  for (const outputPad of [0, 1]) {
    const ctx = Object.freeze(
      renderContext({
        outputPad,
        args: Object.freeze({
          path: "/missing/secret.env",
          oldText: "DO NOT USE BEFORE",
          newText: "DO NOT USE AFTER",
        }),
      }),
    );
    const before = JSON.stringify({ ctx, captured });
    const component = renderer.renderResult!(
      captured as never,
      { expanded: true, isPartial: false },
      theme,
      ctx,
    );
    for (const width of [1, 2, 5, 12, 40, 76, 110]) {
      const lines = component.render(width);
      for (const line of lines)
        assert.ok(
          geometry.visibleWidth(line) <= width,
          `width ${width}: ${line}`,
        );
      assert.doesNotMatch(plain(lines), /DO NOT USE/);
    }
    const first = component.render(110).join("\n");
    fixed = true;
    component.invalidate();
    assert.notEqual(component.render(110).join("\n"), first);
    fixed = false;
    assert.match(plain(component.render(110)), /NATIVE STATUS LAST/);
    assert.equal(JSON.stringify({ ctx, captured }), before);
    prefs.diffView = "unified";
    assert.match(plain(component.render(110)), /old \/ new · unified/);
    prefs.diffView = "split";
  }
  const raw = "-1 old\nMALFORMED\n+1 new\nCAPTURE LAST";
  const fallback = renderer.renderResult!(
    {
      content: [{ type: "text", text: "native status" }],
      details: { diff: raw },
    },
    { expanded: true, isPartial: false },
    theme,
    renderContext(),
  );
  assert.match(
    plain(fallback.render(80)),
    /MALFORMED[\s\S]*CAPTURE LAST[\s\S]*native status/,
  );
});

test("oversized diff bypasses native word work, retains captured tail/status and notices on expansion", () => {
  let nativeCalls = 0;
  const renderer = createToolPresentation(
    "edit",
    {},
    geometry,
    {
      ...native,
      renderDiff() {
        nativeCalls++;
        throw Error("unbounded native diff");
      },
    },
    (host) => host,
  );
  const details = {
    diff: `-1 ${"x".repeat(DIFF_LIMITS.chars)}\n+1 CAPTURED DIFF TAIL`,
    truncation: { truncated: true },
    fullOutputPath: "/preserved/secret.env",
  };
  const captured = {
    content: [{ type: "text" as const, text: "NATIVE OUTPUT TAIL" }],
    details,
  };
  const expanded = plain(
    renderer.renderResult!(
      captured,
      { expanded: true, isPartial: false },
      theme,
      renderContext(),
    ).render(110),
  );
  assert.match(expanded, /native\/plain fallback/);
  assert.match(expanded, /CAPTURED DIFF TAIL[\s\S]*NATIVE OUTPUT TAIL/);
  assert.match(expanded, /Full output: \/preserved\/secret.env/);
  const collapsed = plain(
    renderer.renderResult!(
      captured,
      { expanded: false, isPartial: false },
      theme,
      renderContext(),
    ).render(110),
  );
  assert.match(
    collapsed,
    /more rows[\s\S]*Native output truncated[\s\S]*Full output/,
  );
  assert.equal(nativeCalls, 0);
});

function panel(initial: UIPreferences = { ...UI_DEFAULTS }) {
  let value = { ...initial },
    current = true,
    done = 0,
    renders = 0;
  let palette = theme;
  const instance = createSettingsPanel({
    tui: geometry,
    geometry,
    native,
    keybindings: geometry.getKeybindings(),
    theme: () => palette,
    initial: Object.freeze({ ...initial }),
    current: () => current,
    change(v) {
      value = { ...v };
      return true;
    },
    done() {
      done++;
    },
    requestRender() {
      renders++;
    },
  });
  const down = () => instance.handleInput!("\x1b[B");
  const enter = () => instance.handleInput!("\r");
  return {
    instance,
    down,
    enter,
    value: () => value,
    done: () => done,
    renders: () => renders,
    stale() {
      current = false;
    },
    theme(v: typeof theme) {
      palette = v;
    },
  };
}

test("real SettingsList keyboard interaction changes actual preview; cancel restores original", () => {
  const p = panel();
  const before = p.instance.render(110).join("\n");
  assert.match(plain(p.instance.render(40)), /more rows.*f6 to expand/);
  p.instance.handleInput!("\x1b[17~"); // public fixture expansion binding F6
  assert.doesNotMatch(plain(p.instance.render(40)), /more rows/);
  p.enter(); // follow -> claude
  assert.equal(p.value().palette, "claude");
  p.down();
  p.enter(); // transparent -> tinted
  assert.equal(p.value().toolStyle, "tinted");
  assert.notEqual(p.instance.render(110).join("\n"), before);
  p.down();
  p.enter(); // split -> unified
  assert.match(plain(p.instance.render(110)), /old \/ new · unified/);
  p.down();
  p.enter(); // extra detail
  assert.match(plain(p.instance.render(110)), /24 ms/);
  assert.ok(p.renders() >= 7);
  p.instance.handleInput!("\x1b");
  assert.deepEqual(p.value(), UI_DEFAULTS);
  assert.equal(p.done(), 1);
  p.instance.dispose();
  assert.equal(p.done(), 1);
});

test("reset previews documented defaults, apply is runtime only; no fake Save or storage", () => {
  const initial: UIPreferences = {
    palette: "claude",
    toolStyle: "tinted",
    diffView: "unified",
    extraDetail: true,
  };
  const p = panel(initial);
  for (let i = 0; i < 5; i++) p.down();
  p.enter(); // reset
  assert.deepEqual(p.value(), UI_DEFAULTS);
  assert.match(
    plain(p.instance.render(110)),
    /Previewing documented runtime defaults/,
  );
  assert.match(plain(p.instance.render(110)), /Not persisted/);
  p.instance.handleInput!("\x1b");
  assert.deepEqual(p.value(), initial);
  const apply = panel();
  apply.enter();
  for (let i = 0; i < 4; i++) apply.down();
  apply.enter();
  assert.equal(apply.value().palette, "claude");
  assert.equal(apply.done(), 1);
  apply.instance.dispose();
  assert.equal(apply.value().palette, "claude");
  assert.match(PERSISTENCE_LIMIT, /no authorized own-UI DATA/);
});

test("stale panel/disposal cannot roll back a later owner; unavailable choices fail truthfully", () => {
  const p = panel();
  p.enter();
  p.stale();
  p.instance.handleInput!("\x1b");
  p.instance.dispose();
  assert.equal(p.value().palette, "claude"); // no write after stale
  let writes = 0;
  const instance = createSettingsPanel({
    tui: geometry,
    geometry,
    native,
    keybindings: geometry.getKeybindings(),
    theme: () => theme,
    initial: { ...UI_DEFAULTS },
    current: () => true,
    change() {
      writes++;
      return false;
    },
    done() {},
    requestRender() {},
  });
  instance.handleInput!("\r");
  assert.equal(writes, 1);
  assert.match(plain(instance.render(110)), /Choice unavailable/);
  assert.match(plain(instance.render(110)), /Palette\s+follow/);
});

test("public remapped selection bindings work locally; preview resize and theme invalidation", () => {
  const original = geometry.getKeybindings();
  geometry.setKeybindings(
    new geometry.KeybindingsManager(geometry.TUI_KEYBINDINGS, {
      "tui.select.confirm": "f2",
      "tui.select.cancel": "f3",
    }),
  );
  try {
    const p = panel();
    p.instance.handleInput!("\x1bOQ"); // F2
    assert.equal(p.value().palette, "claude");
    p.instance.handleInput!("\x1bOR"); // F3
    assert.deepEqual(p.value(), UI_DEFAULTS);
  } finally {
    geometry.setKeybindings(original);
  }
  const p = panel();
  for (const width of [0, 1, 5, 20, 40, 110])
    for (const line of p.instance.render(width))
      assert.ok(geometry.visibleWidth(line) <= width);
  for (const pref of [
    { ...UI_DEFAULTS },
    { ...UI_DEFAULTS, extraDetail: true },
  ])
    assert.match(
      plain(renderSettingsPreview(pref, 110, theme, geometry, native)),
      /const title/,
    );
});
