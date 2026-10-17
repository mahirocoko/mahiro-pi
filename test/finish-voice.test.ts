import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { activateWith } from "../extensions/mahiro-finish-voice.ts";
import { createVoice, voiceOwner } from "../lib/finish-voice.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(overrides = {}) {
  const calls: { file: string; args: string[]; signal: AbortSignal }[] = [];
  const removed: string[] = [];
  let clock = 0;
  const voice = createVoice({
    platform: "darwin",
    now: () => clock,
    runner: async (file, args, signal) => {
      calls.push({ file, args, signal });
    },
    makeDirectory: async () => "/owned-generated-test-dir",
    removeDirectory: async (directory) => {
      removed.push(directory);
    },
    ...overrides,
  });
  return {
    voice,
    calls,
    removed,
    advance: () => {
      clock += 3000;
    },
  };
}
function host() {
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  return {
    pi: {
      on: (name: string, handler: any) => handlers.set(name, handler),
    } as unknown as ExtensionAPI,
    emit: (name: string, event = {}, mode = "tui", sessionId = "tui-parent") =>
      handlers.get(name)?.(event, {
        mode,
        hasUI: true,
        sessionManager: { getSessionId: () => sessionId },
      }),
  };
}

test("voice is inert until called and uses literal bounded argv plus owned cleanup", async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  await f.voice.play();
  assert.deepEqual(
    f.calls.map(({ file, args }) => [file, args]),
    [
      [
        "/usr/bin/say",
        [
          "-v",
          "Kanya",
          "-r",
          "300",
          "ทำงานเสร็จแล้วค่ะ",
          "-o",
          "/owned-generated-test-dir/speech.aiff",
        ],
      ],
      [
        "/usr/bin/afplay",
        ["-v", "0.4", "/owned-generated-test-dir/speech.aiff"],
      ],
    ],
  );
  assert.deepEqual(f.removed, ["/owned-generated-test-dir"]);
  await f.voice.play();
  assert.equal(f.calls.length, 2);
  f.advance();
  await f.voice.play();
  assert.equal(f.calls.length, 4);
});

test("non-Darwin and disposed voices are silent", async () => {
  const linux = fixture({ platform: "linux" });
  await linux.voice.play();
  assert.equal(linux.calls.length, 0);
  const f = fixture();
  f.voice.dispose();
  await f.voice.play();
  assert.equal(f.calls.length, 0);
});

test("one active request, abort suppresses late say and only cleans its directory", async () => {
  const gate = deferred();
  const f = fixture({
    makeDirectory: async () => {
      await gate.promise;
      return "/own-late-dir";
    },
  });
  const pending = f.voice.play();
  await f.voice.play();
  f.voice.dispose();
  gate.resolve();
  await pending;
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.removed, ["/own-late-dir"]);
});

test("disposal aborts an in-flight command without starting late playback", async () => {
  const started = deferred();
  const release = deferred();
  let signal: AbortSignal | undefined;
  let commands = 0;
  const f = fixture({
    runner: async (_file: string, _args: string[], value: AbortSignal) => {
      commands++;
      signal = value;
      started.resolve();
      await release.promise;
    },
  });
  const pending = f.voice.play();
  await started.promise;
  f.advance();
  await f.voice.play();
  assert.equal(commands, 1);
  f.voice.dispose();
  assert.equal(signal?.aborted, true);
  release.resolve();
  await pending;
  assert.equal(commands, 1);
  assert.deepEqual(f.removed, ["/owned-generated-test-dir"]);
});

test("replacement, command failure, and total deadline suppress afplay and clean up", async () => {
  for (const mode of ["replacement", "failure", "deadline"]) {
    let current = true;
    let signal: AbortSignal | undefined;
    const calls: string[] = [];
    const f = fixture({
      isCurrent: () => current,
      deadline: 5,
      runner: async (file: string, _args: string[], value: AbortSignal) => {
        calls.push(file);
        signal = value;
        if (mode === "replacement") current = false;
        if (mode === "failure") throw new Error("silent test failure");
        if (mode === "deadline")
          await new Promise((resolve) => setTimeout(resolve, 15));
      },
    });
    await f.voice.play();
    assert.deepEqual(calls, ["/usr/bin/say"]);
    assert.equal(signal?.aborted, mode === "deadline");
    assert.deepEqual(f.removed, ["/owned-generated-test-dir"]);
  }
});

test("whole-run latest outcome plus settled abort is the only completion truth", () => {
  const h = host();
  let plays = 0;
  const dispose = activateWith(h.pi, () => ({
    play: async () => {
      plays++;
    },
    dispose() {},
  }));
  h.emit("session_start");
  for (const [outcome, aborted] of [
    ["completed", false],
    ["error", false],
    ["aborted", false],
    ["completed", true],
  ]) {
    h.emit("agent_start");
    h.emit("agent_before_settle", { outcome: "completed" });
    assert.equal(plays, outcome === "completed" && !aborted ? 0 : 1);
    h.emit("agent_before_settle", { outcome });
    h.emit("agent_settled", { aborted });
    h.emit("agent_settled", { aborted });
  }
  h.emit("agent_start");
  h.emit("agent_settled", { aborted: false });
  assert.equal(plays, 1);
  dispose();
});

test("headless children cannot take ownership; replacement and every shutdown invalidate generation", () => {
  const parent = host();
  let disposed = 0;
  let plays = 0;
  let isCurrent = () => false;
  const factory = (options: Parameters<typeof createVoice>[0]) => {
    isCurrent = options!.isCurrent!;
    return {
      play: async () => {
        plays++;
      },
      dispose: () => {
        disposed++;
      },
    };
  };
  const stopParent = activateWith(parent.pi, factory);
  parent.emit("session_start");
  const token = voiceOwner().current?.generation;
  for (const mode of ["rpc", "sdk", "headless"]) {
    const child = host();
    activateWith(child.pi, factory);
    child.emit("session_start", {}, mode);
    child.emit("session_shutdown", { reason: "quit" }, mode);
    assert.equal(voiceOwner().current?.generation, token);
  }
  assert.equal(disposed, 0);
  const oldCurrent = isCurrent;
  const replacement = host();
  activateWith(replacement.pi, factory);
  replacement.emit("session_start");
  assert.equal(oldCurrent(), false);
  assert.equal(disposed, 1);
  stopParent();
  assert.equal(isCurrent(), true);
  for (const reason of ["quit", "reload", "new", "resume", "fork"]) {
    replacement.emit("session_start");
    const current = isCurrent;
    replacement.emit("agent_start");
    replacement.emit("agent_before_settle", { outcome: "completed" });
    replacement.emit("session_shutdown", { reason });
    replacement.emit("agent_settled", { aborted: false });
    assert.equal(current(), false);
  }
  assert.equal(plays, 0);
});

test("every callback rejects foreign contexts within the same handler set", () => {
  const parent = host();
  let plays = 0;
  let disposed = 0;
  const stop = activateWith(parent.pi, () => ({
    play: async () => {
      plays++;
    },
    dispose: () => {
      disposed++;
    },
  }));
  parent.emit("session_start");
  const generation = voiceOwner().current?.generation;
  try {
    for (const [mode, id] of [
      ["sdk", "tui-parent"],
      ["rpc", "tui-parent"],
      ["tui", "foreign-session"],
    ]) {
      parent.emit("agent_start", {}, mode, id);
      parent.emit("agent_before_settle", { outcome: "completed" }, mode, id);
      parent.emit("agent_settled", { aborted: false }, mode, id);
      parent.emit("session_shutdown", { reason: "quit" }, mode, id);
      assert.equal(plays, 0);
      assert.equal(disposed, 0);
      assert.equal(voiceOwner().current?.generation, generation);
    }
    parent.emit("agent_start");
    parent.emit("agent_before_settle", { outcome: "completed" });
    parent.emit("agent_settled", { aborted: false }, "sdk");
    parent.emit("session_shutdown", { reason: "quit" }, "rpc");
    assert.equal(plays, 0);
    assert.equal(disposed, 0);
    parent.emit("agent_settled", { aborted: false });
    assert.equal(plays, 1);
  } finally {
    stop();
  }
});
