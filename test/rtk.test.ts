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
