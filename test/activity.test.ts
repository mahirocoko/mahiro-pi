import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import extension from "../extensions/mahiro-status.ts";
import {
  ACTIVITY_FRAME_MS,
  ACTIVITY_FRAMES,
  ACTIVITY_INDICATOR_COLUMNS,
  ACTIVITY_TICK_MS,
  activityColumns,
  activityPhase,
  activityText,
  fitActivity,
  indicatorFrames,
  startActivity,
  type ActivityPhase,
} from "../lib/activity.ts";

function line(phase: ActivityPhase, tools: number, elapsedMs: number, interrupt = "escape") {
  return activityText({ phase, tools, elapsedMs, interrupt });
}

function harness() {
  let now = 10_000;
  let columns = 80;
  let label = "escape";
  let accent = "\x1b[38;2;32;178;170m";
  let tick: (() => void) | undefined;
  let resize: (() => void) | undefined;
  let starts = 0;
  let stops = 0;
  let unbinds = 0;
  const messages: Array<string | undefined> = [];
  const indicators: Array<{ frames?: string[]; intervalMs?: number } | undefined> = [];
  const ui = {
    setWorkingMessage(message?: string) { messages.push(message); },
    setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }) { indicators.push(options); },
    theme: { fg: (_color: "accent", text: string) => `${accent}${text}\x1b[39m` },
  };
  const activity = startActivity({ mode: "tui", ui }, {
    now: () => now,
    every(callback, ms) {
      assert.equal(ms, ACTIVITY_TICK_MS);
      starts++;
      tick = callback;
      return () => {
        stops++;
        if (tick === callback) tick = undefined;
      };
    },
    width: () => columns,
    interrupt: () => label,
    onResize(callback) {
      resize = callback;
      return () => {
        unbinds++;
        resize = undefined;
      };
    },
  });
  return {
    activity,
    messages,
    indicators,
    advance(ms: number) { now += ms; tick?.(); },
    pulse() { tick?.(); },
    resize() { resize?.(); },
    starts: () => starts,
    stops: () => stops,
    unbinds: () => unbinds,
    setColumns(value: number) { columns = value; },
    setLabel(value: string) { label = value; },
    setAccent(value: string) { accent = value; },
  };
}

test("the activity line keeps one width across verb, count, elapsed and interrupt", () => {
  const widths = new Set<number>();
  for (const phase of ["working", "thinking", "responding", "reading", "running"] as const) {
    for (const tools of [0, 1, 12, 99, 150]) {
      for (const elapsedMs of [0, 999, 1_000, 59_000, 3_599_000, 3_600_000, 36_000_000, 400_000_000]) {
        for (const interrupt of ["escape", "ctrl+c", "super+escape"]) {
          const text = line(phase, tools, elapsedMs, interrupt);
          widths.add(activityColumns(text));
          assert.equal(text.includes("\n"), false);
          assert.doesNotMatch(text, /token|character|billed|git |worker|queued|plan/i);
        }
      }
    }
  }
  assert.equal(widths.size, 1);
  assert.equal(activityColumns(line("responding", 2, 12_000)), 59);
  assert.equal(line("running", 2, 12_000).includes("02 tools"), true);
  assert.equal(line("reading", 150, 0).includes("99 tools"), true);
  assert.equal(line("working", 0, 400_000_000).includes("99:59:59"), true);
  assert.equal(line("working", 0, 0).includes(" 0:00:00"), true);
  assert.equal(line("responding", 0, 3_600_000).includes(" 1:00:00"), true);
  assert.equal(line("thinking", 0, 36_000_000).includes("10:00:00"), true);
  assert.equal(activityText({ phase: "idle", tools: 3, elapsedMs: 1, interrupt: "escape" }), "");
});

test("classification is one verb and does not copy tool names into the line", () => {
  assert.equal(activityPhase(false, ["bash"], "text"), "idle");
  assert.equal(activityPhase(true, [], "none"), "working");
  assert.equal(activityPhase(true, [], "thinking"), "thinking");
  assert.equal(activityPhase(true, [], "text"), "responding");
  assert.equal(activityPhase(true, ["read", "grep", "find", "ls"], "text"), "reading");
  assert.equal(activityPhase(true, ["read", "edit"], "text"), "working");
  assert.equal(activityPhase(true, ["bash", "read"], "thinking"), "running");
  assert.equal(activityPhase(true, [" Bash "], "none"), "running");
  const shown = line("reading", 1, 1_000);
  assert.equal(shown.startsWith("Reading"), true);
  assert.equal(/\bread\b/i.test(shown), false);
});

test("spinner frames stay one column at a modest interval, including theme color", () => {
  assert.equal(ACTIVITY_FRAME_MS, 160);
  assert.ok(ACTIVITY_FRAME_MS > 80 && ACTIVITY_FRAME_MS < 500);
  assert.equal(ACTIVITY_FRAMES.length > 1, true);
  const plain = indicatorFrames();
  const colored = indicatorFrames((frame) => `\x1b[38;2;1;2;3m${frame}\x1b[39m`);
  const rejected = indicatorFrames(() => "WIDE");
  for (const frame of [...plain.frames, ...colored.frames, ...rejected.frames]) {
    assert.equal(activityColumns(frame), 1);
  }
  assert.equal(plain.intervalMs, ACTIVITY_FRAME_MS);
  assert.equal(colored.intervalMs, ACTIVITY_FRAME_MS);
  assert.deepEqual(rejected.frames, [...ACTIVITY_FRAMES]);
});

test("narrow widths stay one truncated row and reserve the spinner columns", () => {
  const full = line("responding", 4, 4_000);
  assert.equal(fitActivity(full, 80 - ACTIVITY_INDICATOR_COLUMNS), full);
  const narrow = fitActivity(full, 40 - ACTIVITY_INDICATOR_COLUMNS);
  assert.equal(narrow.includes("\n"), false);
  assert.equal(activityColumns(narrow), 38);
  assert.equal(narrow.endsWith("…"), true);
  assert.equal(fitActivity(full, 0), "");
  assert.equal(fitActivity(full, 1), "…");
});

test("idle publishes nothing and active updates publish only when the line changes", () => {
  const view = harness();
  assert.equal(view.indicators.length, 1);
  assert.equal(view.indicators[0]?.intervalMs, ACTIVITY_FRAME_MS);
  assert.equal(view.messages.length, 0);
  assert.equal(view.starts(), 0);
  for (let i = 0; i < 30; i++) view.advance(ACTIVITY_TICK_MS);
  view.resize();
  view.activity.stream("text_delta");
  view.activity.toolStart("early", "read");
  assert.equal(view.messages.length, 0, "idle ticks, resize and early events do not paint");
  assert.equal(view.starts(), 0, "no elapsed timer while idle");

  view.activity.begin();
  assert.equal(view.starts(), 1);
  assert.equal(view.messages.length, 1);
  assert.match(view.messages[0] ?? "", /Working +· 00 tools · {1,2}0:00:00 · escape to interrupt/);
  for (let i = 0; i < 100; i++) view.activity.stream(i % 2 ? "text_delta" : "text_start");
  assert.equal(view.messages.length, 2, "streaming deltas do not republish an unchanged line");
  assert.match(view.messages[1] ?? "", /^Responding · 00 tools/);
  assert.equal(view.indicators.length, 1, "a stable accent does not restart the spinner");

  view.activity.toolStart("a", "read");
  view.activity.toolStart("b", "grep");
  assert.match(view.messages.at(-1) ?? "", /^Reading +· 02 tools/);
  assert.equal((view.messages.at(-1) ?? "").includes("grep"), false);
  view.activity.toolStart("c", "secret-tool-name");
  assert.match(view.messages.at(-1) ?? "", /^Working +· 03 tools/);
  assert.equal((view.messages.at(-1) ?? "").includes("secret-tool-name"), false);
  view.activity.toolEnd("c");
  view.activity.toolStart("d", "bash");
  assert.match(view.messages.at(-1) ?? "", /^Running +· 03 tools/);
  const painted = view.messages.length;
  view.pulse();
  assert.equal(view.messages.length, painted, "the same elapsed second is not a new paint");

  for (let i = 0; i < 5; i++) view.advance(ACTIVITY_TICK_MS);
  assert.equal(view.messages.length, painted + 5);
  assert.match(view.messages.at(-1) ?? "", /0:00:05/);
  assert.equal(view.starts(), 1, "one elapsed timer for the whole run");
  view.activity.turn();
  assert.match(view.messages.at(-1) ?? "", /Running +· 03 tools · {1,2}0:00:05/);
  view.activity.toolEnd("a");
  view.activity.toolEnd("b");
  view.activity.toolEnd("d");
  view.activity.stream("thinking_delta");
  assert.match(view.messages.at(-1) ?? "", /^Thinking +· 00 tools · {1,2}0:00:05/);

  view.setColumns(40);
  view.resize();
  assert.equal(activityColumns(view.messages.at(-1) ?? ""), 40 - ACTIVITY_INDICATOR_COLUMNS);
  view.resize();
  const narrowPaints = view.messages.length;
  view.resize();
  assert.equal(view.messages.length, narrowPaints, "an unchanged width does not repaint");

  view.setAccent("\x1b[38;2;9;9;9m");
  view.pulse();
  assert.equal(view.indicators.length, 2, "an accent change republishes frames once");
  assert.equal(view.indicators[1]?.frames?.every((frame) => frame.startsWith("\x1b[38;2;9;9;9m")), true);
  view.pulse();
  assert.equal(view.indicators.length, 2);

  view.activity.assistantEnd("stop");
  view.activity.assistantEnd("toolUse");
  assert.equal(view.stops(), 0, "a normal turn end keeps the run clock");
  view.activity.assistantEnd("error");
  assert.equal(view.messages.at(-1), undefined);
  assert.equal(view.stops(), 1);
  for (let i = 0; i < 10; i++) view.advance(ACTIVITY_TICK_MS);
  assert.equal(view.starts(), 1, "idle after error does not start another timer");
  const cleared = view.messages.length;
  view.activity.finish();
  assert.equal(view.messages.length, cleared, "a second finish does not publish again");
});

test("later turns keep the run clock; abort, dispose and replacement go idle", () => {
  const first = harness();
  first.activity.begin();
  first.advance(5_000);
  first.activity.turn();
  assert.match(first.messages.at(-1) ?? "", /0:00:05/);
  assert.equal((first.messages.at(-1) ?? "").includes(" 0:00:00"), false);
  first.activity.assistantEnd("aborted");
  assert.equal(first.messages.at(-1), undefined);
  assert.equal(first.stops(), 1);
  first.activity.dispose();
  assert.equal(first.unbinds(), 1);
  assert.equal(first.indicators.at(-1), undefined);
  first.activity.dispose();
  first.activity.begin();
  assert.equal(first.starts(), 1, "a disposed line cannot start again");

  for (const reason of ["startup", "reload", "new", "resume", "fork"]) {
    const next = harness();
    assert.equal(reason.length > 0, true);
    assert.equal(next.messages.length, 0);
    assert.equal(next.starts(), 0);
    next.activity.begin();
    assert.equal(next.starts(), 1);
    next.activity.finish();
    assert.equal(next.stops(), 1);
    next.activity.dispose();
    assert.equal(next.unbinds(), 1);
    assert.equal(next.indicators.at(-1), undefined);
  }
});

test("non-TUI sessions never touch the working message or indicator", () => {
  for (const mode of ["print", "rpc"]) {
    const messages: string[] = [];
    const activity = startActivity({
      mode,
      ui: {
        setWorkingMessage() { messages.push("message"); },
        setWorkingIndicator() { messages.push("indicator"); },
      },
    });
    activity.begin();
    activity.turn();
    activity.stream("text_delta");
    activity.toolStart("a", "bash");
    activity.toolEnd("a");
    activity.assistantEnd("error");
    activity.finish();
    activity.dispose();
    assert.deepEqual(messages, []);
  }
});

test("status owns the activity line and does not register a new resource or usage estimate", async () => {
  const handlers = new Map<string, Function>();
  extension({ on: (name: string, handler: Function) => { handlers.set(name, handler); return () => {}; } } as never);
  for (const name of [
    "session_start", "session_shutdown", "agent_start", "agent_end", "agent_settled",
    "turn_start", "message_update", "message_end", "tool_execution_start", "tool_execution_end",
  ]) assert.ok(handlers.has(name), name);
  await handlers.get("session_start")!({ reason: "startup" }, {
    mode: "print",
    ui: {
      setWorkingMessage() { throw new Error("activity message"); },
      setWorkingIndicator() { throw new Error("activity indicator"); },
      setStatus() { throw new Error("status"); },
      setFooter() { throw new Error("footer"); },
    },
  });
  handlers.get("agent_start")!();
  handlers.get("turn_start")!({ turnIndex: 0, timestamp: 0 });
  handlers.get("message_update")!({ assistantMessageEvent: { type: "text_delta" } });
  handlers.get("tool_execution_start")!({ toolCallId: "a", toolName: "read", args: {} });
  handlers.get("tool_execution_end")!({ toolCallId: "a" });
  handlers.get("agent_end")!({ messages: [] });
  handlers.get("agent_settled")!({ aborted: true });
  handlers.get("message_end")!({ message: { role: "assistant", stopReason: "aborted" } });
  handlers.get("session_shutdown")!({ reason: "quit" });

  const activitySource = await readFile(new URL("../lib/activity.ts", import.meta.url), "utf8");
  const extensionSource = await readFile(new URL("../extensions/mahiro-status.ts", import.meta.url), "utf8");
  assert.match(extensionSource, /startActivity/);
  assert.match(extensionSource, /keyText\("app\.interrupt"\)/);
  assert.match(extensionSource, /ctx\.mode !== "tui"/);
  assert.match(activitySource, /setWorkingMessage/);
  assert.match(activitySource, /setWorkingIndicator/);
  assert.doesNotMatch(activitySource, /\/\s*4|characters|setWidget|setFooter|getSubagents|hasPendingMessages|worker-activity/);
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.pi.extensions.length, 13);
  assert.equal(pkg.pi.extensions.at(-1), "./extensions/mahiro-claude-ui.ts");
  assert.equal(pkg.pi.extensions.includes("./extensions/mahiro-status.ts"), true);
});
