import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { display, gitStatus, herdrBinding, metadataArgs, publishMetadata, start, text, TTL_MS, HEARTBEAT_MS, run } from "../lib/status.ts";
import extension from "../extensions/mahiro-status.ts";

const flush = () => new Promise(resolve => setImmediate(resolve));
const env = { HERDR_ENV: "1", HERDR_PANE_ID: "pane-test", HERDR_SOCKET_PATH: "/synthetic/herdr.sock", HERDR_SESSION_ID: "session-test" };

function fixture(extra = {}) {
  let clock = 0, stopped = 0;
  const writes: (string | undefined)[] = [];
  const jobs: any[] = [];
  const owner = { seq: 100, dispose: undefined as undefined | (() => void) };
  const ctx = {
    cwd: "/synthetic/repo", mode: "tui", model: { id: "m1", name: "Model 1", provider: "p1" },
    thinkingLevel: "high", getContextUsage: () => ({ percent: 0 as number | null }),
    isIdle: () => true, ui: { setStatus: (key: string, value: string | undefined) => {
      assert.equal(key, "mahiro-status"); writes.push(value);
    } },
  };
  const options = {
    env, owner, now: () => clock,
    publish: (execute: any, binding: any, args: string[]) => execute("herdr", args, undefined, binding),
    every: (_callback: () => void, ms: number) => { assert.equal(ms, 1000); return () => { stopped++; }; },
    run: (command: string, args: string[], cwd?: string, inherited?: object) => {
      let resolve!: (value: string) => void, reject!: (reason: Error) => void;
      const job = { command, args, cwd, inherited, cancelled: false,
        promise: new Promise<string>((yes, no) => { resolve = yes; reject = no; }),
        cancel() { job.cancelled = true; }, resolve: (value = "") => resolve(value), reject: () => reject(new Error("synthetic failure")),
      };
      jobs.push(job); return job;
    },
    ...extra,
  };
  const controller = start(ctx, options);
  return { ctx, options, controller, jobs, writes, owner, advance: (ms: number) => { clock += ms; }, stopped: () => stopped };
}

test("porcelain -z counts changes, rename paths, arbitrary filenames and upstream state", () => {
  assert.equal(gitStatus("## main\0"), "git clean");
  assert.equal(gitStatus("## HEAD (no branch)\0"), "git clean");
  assert.equal(gitStatus("## No commits yet on main\0?? new\0"), "git clean ?:1");
  assert.equal(gitStatus("## main...origin/main [ahead 2, behind 3]\0 M line\nname\0R  renamed\0?? not-untracked\0?? real\nfile\0UU conflict\0"), "git dirty:3 ?:1 ahead:2 behind:3");
  assert.equal(gitStatus("## main\0C  copy\0## fake [ahead 99]\0 D deleted\0"), "git dirty:2");
});

test("context distinguishes unknown from zero; controls and effort are bounded", () => {
  assert.equal(text("hi\x1b\n\u202e there"), "hi there");
  assert.deepEqual(display({ getContextUsage: () => undefined }), ["", "", ""]);
  const f = fixture({ env: {} });
  assert.deepEqual(display(f.ctx), ["Model 1 · high", "p1", "ctx ▱▱▱▱▱▱ 0%"]);
  f.ctx.getContextUsage = () => ({ percent: null });
  assert.equal(display(f.ctx)[2], "");
  for (const value of [NaN, Infinity, -1, 101]) {
    f.ctx.getContextUsage = () => ({ percent: value });
    assert.equal(display(f.ctx)[2], "");
  }
  f.controller.dispose();
});

test("binding is inherited only, outside-Herdr publication disabled", () => {
  assert.equal(herdrBinding({ ...env, HERDR_ENV: "0" }), undefined);
  assert.equal(herdrBinding({ ...env, HERDR_SOCKET_PATH: "" }), undefined);
  assert.equal(herdrBinding({ ...env, HERDR_PANE_ID: "bad\nvalue" }), undefined);
  const f = fixture({ env: {} });
  assert.deepEqual(f.jobs.map(j => j.command), ["git"]);
  f.controller.dispose();
});

test("one request per producer, fixed TTL, heartbeat, exact pane/session binding", async () => {
  const f = fixture();
  f.controller.tick(); f.controller.tick();
  assert.equal(f.jobs.length, 2);
  const [git, metadata] = f.jobs;
  assert.equal(git.cwd, f.ctx.cwd);
  assert.ok(git.args.includes("-z"));
  assert.equal(metadata.cwd, undefined);
  assert.deepEqual(metadata.inherited, env);
  assert.deepEqual(metadata.args.slice(0, 7), ["pane", "report-metadata", "pane-test", "--source", "mahiro:pi-display", "--agent", "pi"]);
  assert.ok(metadata.args.includes(String(TTL_MS)));
  assert.ok(!metadata.args.includes("--applies-to-source"));
  git.resolve("## main\0"); metadata.resolve(); await flush();
  f.advance(HEARTBEAT_MS - 1); f.controller.tick();
  assert.equal(f.jobs.filter(j => j.command === "herdr").length, 1);
  f.advance(1); f.controller.tick();
  assert.equal(f.jobs.filter(j => j.command === "herdr").length, 2);
  assert.equal(f.owner.seq, 102);
  f.controller.dispose();
});

test("model/provider changes clear context and missing tokens; old acknowledgements cannot cache stale values", async () => {
  const f = fixture();
  f.ctx.model = { id: "m2", name: "Model 2", provider: "p2" };
  f.controller.modelChanged();
  f.jobs[1].resolve(); await flush();
  f.controller.tick();
  const next = f.jobs.at(-1);
  assert.ok(next.args.includes("mahiro_sidebar_model=Model 2 · high"));
  assert.ok(next.args.includes("mahiro_sidebar_provider=p2"));
  assert.ok(next.args.includes("--clear-token"));
  assert.ok(!next.args.includes("mahiro_sidebar_context=ctx ▱▱▱▱▱▱ 0%"));
  next.resolve(); await flush();
  f.controller.contextFresh({ model: "m2", provider: "p2", stopReason: "stop",
    usage: { input: 20, output: 1, cacheRead: 0, cacheWrite: 0 } });
  assert.ok(f.jobs.at(-1).args.includes("mahiro_sidebar_context=ctx ▱▱▱▱▱▱ 0%"));
  f.jobs.at(-1).resolve(); await flush();
  f.ctx.model = undefined as any;
  f.controller.tick();
  const cleared = f.jobs.at(-1).args;
  for (const key of ["mahiro_sidebar_model", "mahiro_sidebar_provider", "mahiro_sidebar_context"]) assert.ok(cleared.includes(key));
  f.controller.dispose();
});

test("failure retries without disrupting native status; Git failure is unknown", async () => {
  const f = fixture();
  f.jobs.forEach(job => job.reject()); await flush();
  assert.match(f.writes.at(-1)!, /git unknown/);
  f.controller.tick();
  assert.equal(f.jobs.filter(j => j.command === "herdr").length, 2);
  f.controller.toolStart("a", "read\x1b\n");
  f.controller.toolStart("b", "bash");
  assert.match(f.writes.at(-1)!, /tool read, bash/);
  f.controller.toolEnd("a");
  assert.match(f.writes.at(-1)!, /tool bash/);
  f.controller.settled();
  assert.match(f.writes.at(-1)!, /idle/);
  f.controller.dispose();
});

test("dispose/reload cancels producers, timers, and late callbacks; sequence belongs to process owner", async () => {
  const f = fixture();
  const replacement = start(f.ctx, f.options);
  assert.equal(f.stopped(), 1);
  assert.ok(f.jobs[0].cancelled && f.jobs[1].cancelled);
  const count = f.writes.length;
  f.jobs[0].resolve("## main\0 M stale\0"); f.jobs[1].resolve(); await flush();
  assert.equal(f.writes.length, count);
  assert.equal(f.owner.seq, 102);
  f.controller.dispose(); // Cannot clear the replacement status.
  assert.equal(f.writes.length, count);
  replacement.dispose(); replacement.dispose();
  assert.equal(f.stopped(), 2);
  assert.equal(f.writes.at(-1), undefined);
  const after = f.writes.length;
  f.jobs.slice(2).forEach(j => j.resolve()); await flush();
  replacement.tick();
  assert.equal(f.writes.length, after);
});

test("display-only argv never touches native lifecycle; factory subscribes before interactive footer setup", async () => {
  const args = metadataArgs("pane", ["", "", ""], 2);
  assert.equal(args.filter(value => value === "--clear-token").length, 3);
  assert.ok(!args.some(value => /quota|account|state-label|report-agent/.test(value)));
  const handlers = new Map<string, Function>();
  extension({ on: (name: string, handler: Function) => { handlers.set(name, handler); } } as any);
  assert.ok(handlers.has("session_start"));
  handlers.get("session_shutdown")!({});
  const source = await readFile(new URL("../extensions/mahiro-status.ts", import.meta.url), "utf8");
  const helper = await readFile(new URL("../lib/status.ts", import.meta.url), "utf8");
  assert.match(source, /ctx\.ui\.setFooter\(/);
  assert.match(source, /ctx\.mode !== "tui"/);
  assert.doesNotMatch(source + helper, /report-agent|streamSimple\(|fetch\(/);
});

test("real bounded runner handles executable failure without shell interpretation", async () => {
  await assert.rejects(run("/nonexistent-mahiro-pi-test", ["; not a shell"]).promise);
});

test("foreground owner gate blocks inherited child environments and malformed/unavailable identity", async () => {
  for (const info of [
    { pane_id: env.HERDR_PANE_ID, foreground_processes: [{ pid: 1 }] },
    { pane_id: "another-pane", foreground_processes: [{ pid: 42 }] },
    { pane_id: env.HERDR_PANE_ID },
  ]) {
    const calls: string[][] = [];
    const execute = (_command: string, args: string[]) => {
      calls.push(args);
      return { promise: Promise.resolve(JSON.stringify({ result: { process_info: info } })), cancel() {} };
    };
    await assert.rejects(publishMetadata(execute, env, metadataArgs(env.HERDR_PANE_ID, [], 1), 42).promise);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["pane", "process-info", "--pane", env.HERDR_PANE_ID]);
  }
});

test("foreground owner gate publishes only matching process and cancellation prevents late publication", async () => {
  let resolve!: (value: string) => void;
  let cancelled = false;
  const calls: string[][] = [];
  const execute = (_command: string, args: string[]) => {
    calls.push(args);
    return { promise: calls.length === 1 ? new Promise<string>(yes => { resolve = yes; }) : Promise.resolve(""),
      cancel() { cancelled = true; } };
  };
  const args = metadataArgs(env.HERDR_PANE_ID, ["M", "P", ""], 1);
  const output = JSON.stringify({ result: { process_info: { pane_id: env.HERDR_PANE_ID, foreground_processes: [{ pid: 42 }] } } });
  const job = publishMetadata(execute, env, args, 42);
  resolve(output); await job.promise;
  assert.deepEqual(calls[1], args);
  calls.length = 0;
  const late = publishMetadata(execute, env, args, 42);
  late.cancel(); resolve(output);
  await assert.rejects(late.promise);
  assert.equal(cancelled, true);
  assert.equal(calls.length, 1);
});

test("non-TUI sessions run no Git or Herdr producers even with inherited pane identity", () => {
  const f = fixture({ env: {} });
  const ownerDispose = f.owner.dispose;
  const before = f.jobs.length;
  const controller = start({ ...f.ctx, mode: "print" }, f.options);
  controller.tick(); controller.contextFresh();
  assert.equal(f.jobs.length, before);
  controller.dispose();
  assert.equal(f.owner.dispose, ownerDispose);
  assert.equal(f.stopped(), 0);
  f.controller.dispose();
});

test("failed, aborted, zero-usage and wrong-model responses cannot revive old-model context", async () => {
  const f = fixture();
  f.ctx.getContextUsage = () => ({ percent: 37 });
  f.ctx.model = { id: "m2", name: "Model 2", provider: "p2" };
  f.controller.modelChanged();
  f.jobs[1].resolve(); await flush();
  f.controller.tick();
  f.jobs.at(-1).resolve(); await flush();
  const before = f.jobs.length;
  const usage = { input: 20, output: 1, cacheRead: 0, cacheWrite: 0 };
  for (const message of [
    { model: "m2", provider: "p2", stopReason: "error", usage },
    { model: "m2", provider: "p2", stopReason: "aborted", usage },
    { model: "m2", provider: "p2", stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { model: "m1", provider: "p2", stopReason: "stop", usage },
    { model: "m2", provider: "p1", stopReason: "stop", usage },
    { model: "m2", provider: "p2", stopReason: "stop", usage: { ...usage, input: NaN } },
  ]) f.controller.contextFresh(message);
  assert.equal(f.jobs.length, before);
  f.controller.contextFresh({ model: "m2", provider: "p2", stopReason: "stop", usage });
  assert.ok(f.jobs.at(-1).args.includes("mahiro_sidebar_context=ctx ▰▰▱▱▱▱ 37%"));
  f.controller.dispose();
});
