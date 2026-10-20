import assert from "node:assert/strict";
import test from "node:test";
import { rtkCandidate, registerRTK } from "../lib/rtk.ts";

test("bounded deterministic RTK grammar: shell/control/env/quotes/options/write commands never rewritten", () => {
  for (const mode of ["suggest", "rewrite-safe", "rewrite-rtk"] as const) {
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
  assert.equal(
    rtkCandidate("git show", "rewrite-rtk")?.command,
    "rtk git show",
  );
  assert.equal(
    rtkCandidate("cat safe.txt", "rewrite-rtk")?.command,
    "rtk read safe.txt",
  );
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
