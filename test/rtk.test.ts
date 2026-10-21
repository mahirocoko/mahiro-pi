import assert from "node:assert/strict";
import test from "node:test";
import { rtkCandidate, registerRTK, resolveRTKRewrite } from "../lib/rtk.ts";
import fs from "node:fs";
import path from "node:path";
import { installRTKHelper } from "../lib/guards/test/rtk-helper-fixture.mjs";

test("bounded deterministic RTK grammar: shell/control/env/quotes/options/write commands never rewritten", () => {
  for (const mode of ["rewrite-safe"] as const) {
    for (const command of [
      "git commit -m hi",
      "git push",
      "git reset --hard",
      "git branch new-branch",
      "git -c alias.status=bad status",
      "git diff --output=file",
      "git diff --ext-diff",
      "git log --exec=bad",
      "ls;cat .env",
      "ls\ncat .env",
      "ls\r",
      "ls\tfoo",
      "ls $(cat .env)",
      "ls `printenv`",
      "ls > file",
      "ls | cat",
      "A=secret ls",
      "env ls",
      "ls 'file'",
      'ls "file"',
      "ls \\x",
      "rtk ls",
      "ls --color=always",
      "find . -exec cat .env ;",
      "cat --help",
      "ls " + "x".repeat(513),
      "ls " + "x ".repeat(65),
      "ls " + "x".repeat(4096),
    ])
      assert.equal(
        rtkCandidate(command, mode),
        null,
        `${mode}: ${command.slice(0, 80)}`,
      );
    assert.equal(rtkCandidate("ls -la safe", mode)?.command, "rtk ls -la safe");
    assert.deepEqual(rtkCandidate("git diff --stat src", mode)?.paths, ["src"]);
  }
  assert.equal(rtkCandidate("git show", "rewrite-safe"), null);

  assert.equal(rtkCandidate("ls safe", "off"), null);
});

test("RTK off transform touches no filesystem-owner/helper/probe/log collaborator, including disposed state", async () => {
  const handlers = new Map();
  let touched = 0;
  const unavailable = () => {
    touched++;
    throw Error("Off must not touch owner");
  };
  const runtime = registerRTK(
    {
      on: (name, fn) => handlers.set(name, fn),
      registerTool() {},
      registerCommand() {},
    },
    {
      access: unavailable,
      finalArgs: unavailable,
      permission: unavailable,
      current: unavailable,
    },
  );
  const input = { command: "ls safe" };
  assert.equal(await runtime.transform(input, {}), input);
  assert.equal(touched, 0);
  handlers.get("session_shutdown")();
  assert.equal(await runtime.transform(input, {}), input);
  assert.equal(touched, 0);
});

test("real argv resolver: exit 0/3 broad candidates, 1/2/unknown/error/timeout/bounds/malformed, abort and option injection", async () => {
  const base = path.resolve(
    ".agent-state/runtime/rtk-rewrite-models-retirement/implementation/unit",
  );
  fs.mkdirSync(base, { recursive: true });
  const cwd = fs.mkdtempSync(path.join(base, "resolver-"));
  const helper = installRTKHelper(cwd),
    old = process.env.PATH;
  process.env.PATH = `${helper.bin}:/usr/bin:/bin`;
  try {
    for (const command of [
      "npm test -- --runInBand",
      "cargo test --lib",
      "printf 'prefix' && rtk git status --short",
      "rtk rg 'two words' src | head -n 3",
      "--help",
    ]) {
      for (const code of [0, 3]) {
        helper.set({ code, out: command + "\n" });
        const result = await resolveRTKRewrite(command, { cwd });
        assert.equal(result.command, command);
        assert.equal(
          result.status,
          code === 3 ? "approval-required" : "candidate",
        );
        assert.deepEqual(helper.calls().at(-1).args, [
          "rewrite",
          "--",
          command,
        ]);
      }
    }
    for (const [spec, status] of [
      [{ code: 1, out: "rtk partial" }, "unchanged"],
      [{ code: 2, out: "rtk unsafe", err: "rtk unsafe" }, "denied"],
      [{ code: 9, out: "rtk partial", err: "rtk partial" }, "unavailable"],
      [{ delay: 2000, out: "rtk partial" }, "timeout"],
      [{ bytes: 20000 }, "oversize"],
      [{ out: "rtk ls\nrtk read .env\n" }, "malformed"],
      [{ out: "" }, "malformed"],
      [{ out: "rtk ls\0" }, "malformed"],
      [{ invalidUtf8: true }, "malformed"],
    ] as const) {
      helper.set(spec);
      assert.deepEqual(await resolveRTKRewrite("ls safe.txt", { cwd }), {
        status,
        command: null,
      });
    }
    const calls = helper.calls().length;
    for (const command of ["x".repeat(4097), "ls\ncat .env", "", "ls\0"])
      assert.equal(
        (await resolveRTKRewrite(command, { cwd })).status,
        "malformed",
      );
    assert.equal(helper.calls().length, calls);
    helper.set({ delay: 1000 });
    const controller = new AbortController();
    const pending = resolveRTKRewrite("ls safe.txt", {
      cwd,
      signal: controller.signal,
    });
    while (helper.calls().length === calls)
      await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    await assert.rejects(pending, /cancel/);
    process.env.PATH = cwd;
    assert.equal(
      (await resolveRTKRewrite("ls", { cwd })).status,
      "unavailable",
    );
    assert.equal(
      helper.spawns().length,
      0,
      "resolver never executes candidate",
    );
  } finally {
    if (old === undefined) delete process.env.PATH;
    else process.env.PATH = old;
  }
});

// Disposable private storage only; no installed profile, helper or live UI.
function statusFixture() {
  const base = path.resolve(".agent-state/runtime/rtk-status/unit");
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(base, "status-"));
  const profile = path.join(dir, "profile"),
    cwd = path.join(dir, "project");
  for (const entry of [profile, cwd]) fs.mkdirSync(entry, { mode: 0o700 });
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = profile;
  const root = path.join(profile, "preferences/rtk");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, "state.json");
  const state = (mode: string, sequence = 0) =>
    fs.writeFileSync(file, JSON.stringify({ version: 1, sequence, mode }), {
      mode: 0o600,
    });
  state("rewrite-rtk");
  const statuses = new Map<string, string>();
  const calls: any[] = [],
    notifications: any[] = [];
  const ctx: any = {
    cwd,
    mode: "tui",
    hasUI: true,
    sessionManager: { getSessionId: () => "fixture" },
    ui: {
      setStatus(key: string, value: string | undefined) {
        calls.push([key, value]);
        if (value === undefined) statuses.delete(key);
        else statuses.set(key, value);
      },
      notify: (text: string, level: string) =>
        notifications.push({ text, level }),
      confirm: async () => true,
    },
  };
  const create = () => {
    const handlers = new Map(),
      commands = new Map();
    let allowed = true;
    const runtime = registerRTK(
      {
        on: (name, fn) => handlers.set(name, fn),
        registerCommand: (name, command) => commands.set(name, command),
        registerTool() {},
      },
      {
        current: () => true,
        access() {
          if (!allowed) throw Error("denied");
        },
        permission: () => ({ state: "allow" }),
        finalArgs: async (_name, args) => args,
      },
    );
    return {
      runtime,
      handlers,
      command: (input: string, context = ctx) =>
        commands.get("mh-rtk").handler(input, context),
      deny() {
        allowed = false;
      },
    };
  };
  return {
    ctx,
    create,
    calls,
    statuses,
    notifications,
    file,
    state,
    restore() {
      if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = saved;
    },
  };
}

test("RTK bare and whitespace commands report status, not an empty operation", async () => {
  const f = statusFixture();
  try {
    const a = f.create();
    a.runtime.initialize(f.ctx);
    for (const input of ["", "   ", "\t \t"]) {
      await a.command(input);
      const notice = f.notifications.at(-1);
      assert.equal(notice.level, "info");
      assert.equal(JSON.parse(notice.text).activeThisGeneration, "rewrite-rtk");
    }
    for (const input of ["status\n", "\n", "\r", "\v", "\f", "\0", "\x7f"]) {
      await a.command(input);
      assert.equal(
        f.notifications.at(-1).level,
        "error",
        "controls other than a blank spaces/tabs command stay rejected",
      );
    }
    a.handlers.get("session_shutdown")();
  } finally {
    f.restore();
  }
});

test("RTK publishes initialized and committed active modes; decline/cancel never publishes", async () => {
  const f = statusFixture();
  try {
    const a = f.create();
    assert.equal(f.calls.length, 0, "registration has no UI side effects");
    a.runtime.initialize(f.ctx);
    assert.equal(f.statuses.get("mahiro-rtk"), "RTK rewrite-rtk");
    let sequence = 0;
    for (const mode of ["suggest", "rewrite-safe", "off", "rewrite-rtk"]) {
      await a.command(`mode ${mode} ${sequence++}`);
      assert.equal(f.statuses.get("mahiro-rtk"), `RTK ${mode}`);
      assert.equal(JSON.parse(fs.readFileSync(f.file, "utf8")).mode, mode);
    }
    const calls = f.calls.length,
      bytes = fs.readFileSync(f.file, "utf8");
    f.ctx.ui.confirm = async () => false;
    await a.command(`mode off ${sequence}`);
    assert.match(f.notifications.at(-1).text, /declined/);
    const controller = new AbortController();
    f.ctx.signal = controller.signal;
    f.ctx.ui.confirm = async () => {
      controller.abort();
      return true;
    };
    await a.command(`mode off ${sequence}`);
    assert.match(f.notifications.at(-1).text, /replaced/);
    assert.equal(f.calls.length, calls);
    assert.equal(fs.readFileSync(f.file, "utf8"), bytes);
    a.handlers.get("session_shutdown")();
    assert.equal(f.statuses.has("mahiro-rtk"), false);
    const cleared = f.calls.length;
    a.handlers.get("session_shutdown")();
    a.runtime.initialize(f.ctx);
    assert.equal(f.calls.length, cleared, "shutdown is final and idempotent");
  } finally {
    f.restore();
  }
});

test("RTK unavailable initialization replaces old mode; off is explicit; non-TUI never publishes", async () => {
  const f = statusFixture();
  try {
    const a = f.create();
    a.runtime.initialize(f.ctx);
    a.deny();
    a.runtime.initialize(f.ctx);
    assert.equal(f.statuses.get("mahiro-rtk"), "RTK unavailable");
    a.handlers.get("session_shutdown")();
    f.state("off");
    const off = f.create();
    off.runtime.initialize(f.ctx);
    assert.equal(f.statuses.get("mahiro-rtk"), "RTK off");
    off.handlers.get("session_shutdown")();
    const count = f.calls.length;
    for (const mode of ["rpc", "json", "print"]) {
      const b = f.create(),
        ctx = { ...f.ctx, mode };
      b.runtime.initialize(ctx);
      if (mode === "rpc") await b.command("mode suggest 0", ctx);
      b.handlers.get("session_shutdown")();
    }
    const noUI = f.create();
    noUI.runtime.initialize({ ...f.ctx, hasUI: false });
    noUI.handlers.get("session_shutdown")();
    assert.equal(f.calls.length, count);
  } finally {
    f.restore();
  }
});

test("RTK stale shutdown and pending confirmation cannot clear or replace newer status", async () => {
  const f = statusFixture();
  try {
    const old = f.create();
    old.runtime.initialize(f.ctx);
    let confirm!: (value: boolean) => void;
    f.ctx.ui.confirm = () =>
      new Promise<boolean>((resolve) => {
        confirm = resolve;
      });
    const pending = old.command("mode off 0");
    f.state("suggest");
    const replacement = f.create();
    replacement.runtime.initialize(f.ctx);
    const calls = f.calls.length;
    old.handlers.get("session_shutdown")();
    confirm(true);
    await pending;
    assert.equal(f.calls.length, calls);
    assert.equal(f.statuses.get("mahiro-rtk"), "RTK suggest");
    assert.equal(JSON.parse(fs.readFileSync(f.file, "utf8")).mode, "suggest");
    replacement.handlers.get("session_shutdown")();
    assert.equal(f.statuses.size, 0);
    // Two still-healthy managers sharing a UI need a presentation-sink lease.
    const a = f.create();
    a.runtime.initialize(f.ctx);
    const b = f.create();
    b.runtime.initialize({
      ...f.ctx,
      sessionManager: { getSessionId: () => "new" },
    });
    a.handlers.get("session_shutdown")();
    assert.equal(f.statuses.get("mahiro-rtk"), "RTK suggest");
    b.handlers.get("session_shutdown")();
    assert.equal(f.statuses.size, 0);

    const independentStatuses = new Map();
    const independentUI = {
      ...f.ctx.ui,
      setStatus(key: string, value: string | undefined) {
        if (value === undefined) independentStatuses.delete(key);
        else independentStatuses.set(key, value);
      },
    };
    const c = f.create(),
      d = f.create();
    c.runtime.initialize(f.ctx);
    d.runtime.initialize({ ...f.ctx, ui: independentUI });
    c.handlers.get("session_shutdown")();
    assert.equal(f.statuses.size, 0);
    assert.equal(independentStatuses.get("mahiro-rtk"), "RTK suggest");
    d.handlers.get("session_shutdown")();
    assert.equal(independentStatuses.size, 0);
  } finally {
    f.restore();
  }
});
