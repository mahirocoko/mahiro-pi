import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createController, decodeNotes } from "../lib/continuity/controller.ts";
import { normalize } from "../lib/continuity/records.ts";
import { createStore } from "../lib/continuity/store.ts";
import { createRuntime } from "../lib/continuity/runtime.ts";

const policy = { excludedProjectIds: ["excludedproject"], excludedPaths: [] };
function fixture() {
  const parent = resolve(".agent-state/runtime/continuity-tests");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(parent, "controller-"));
  chmodSync(root, 0o700);
  const store = createStore(root, policy);
  store.initialize(
    { session: "import", branch: "main", epoch: 0 },
    Array.from({ length: 314 }, (_, i) => ({
      id: `import-${i}`,
      sourceKind: "letta_memory",
      projectId: "demo",
      markdown: "Old imported quote",
    })),
  );
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({
      version: 1,
      projects: [{ cwd: root, projectId: "demo" }],
    }),
    { mode: 0o600 },
  );
  const handlers = new Map<string, Function[]>();
  const listeners = new Map<string, Function[]>();
  const commands = new Map<string, any>();
  const branch: any[] = [];
  const notices: string[] = [];
  const ctx: any = {
    cwd: root,
    mode: "rpc",
    sessionManager: { getSessionId: () => "root", getBranch: () => branch },
    ui: { notify: (s: string) => notices.push(s) },
  };
  let allow = true,
    primary = true,
    busy = false,
    fast = false;
  let spawned = 0,
    aborted = 0;
  let record: any;
  let sent: any;
  const role: any = {
    name: "memory-reflector",
    model: "openai/gpt-6.1-sol",
    thinking: "medium",
    locked: true,
    toolNames: [],
    promptMode: "replace",
    runInBackground: true,
    inheritContext: false,
  };
  const service: any = {
    supportsInitialOutcomeClaim: true,
    getAgentType: () => role,
    hasRunning: () => busy,
    spawn: (_type: string, prompt: string, options: any) => {
      spawned++;
      sent = { prompt: JSON.parse(prompt), options };
      record = {
        id: "worker",
        status: fast ? "completed" : "running",
        result: '{"notes":[]}',
      };
      if (fast) emitNative();
      return "worker";
    },
    getRecord: () => record,
    abort: () => {
      aborted++;
      return true;
    },
  };
  const generation = {};
  const targets: string[] = [];
  const node: any = {
    generation,
    healthy: () => true,
    continuity: {
      version: 1,
      generation,
      isPrimarySession: () => primary,
      authorizeLearning: (_ctx: any, _root: string, target: string) => {
        targets.push(target);
        if (!allow) throw new Error("Denied");
      },
      parentService: () => service,
    },
  };
  const pi: any = {
    on: (name: string, fn: Function) => {
      handlers.set(name, [...(handlers.get(name) ?? []), fn]);
    },
    events: {
      on: (name: string, fn: Function) => {
        listeners.set(name, [...(listeners.get(name) ?? []), fn]);
        return () =>
          listeners.set(
            name,
            (listeners.get(name) ?? []).filter((f) => f !== fn),
          );
      },
    },
    registerCommand: (name: string, command: any) =>
      commands.set(name, command),
  };
  const emit = (name: string, event: any = {}) => {
    for (const fn of handlers.get(name) ?? []) fn(event, ctx);
  };
  const emitNative = () => {
    for (const fn of [...(listeners.get("subagents:completed") ?? [])])
      fn({ id: "worker" });
  };
  const controller = createController(pi, {
    root,
    nodes: new Map([["root", node]]),
  });
  emit("session_start");
  const input = (text = "Chosen concrete project approach", source = "rpc") => {
    emit("input", { source, text });
    branch.push({
      type: "message",
      id: `entry-${branch.length}`,
      message: { role: "user", content: text },
    });
  };
  const settle = (outcome = "completed", aborted = false) => {
    emit("agent_before_settle", { outcome });
    emit("agent_settled", { aborted });
  };
  return {
    root,
    store,
    ctx,
    branch,
    commands,
    notices,
    role,
    service,
    targets,
    node,
    input,
    settle,
    emit,
    emitNative,
    get spawned() {
      return spawned;
    },
    get aborted() {
      return aborted;
    },
    get sent() {
      return sent;
    },
    allow: (v: boolean) => {
      allow = v;
    },
    primary: (v: boolean) => {
      primary = v;
    },
    busy: (v: boolean) => {
      busy = v;
    },
    fast: () => {
      fast = true;
    },
    complete(notes: any[]) {
      record = {
        ...record,
        status: "completed",
        result: JSON.stringify({ notes }),
      };
      emitNative();
    },
    clean() {
      controller.cancel();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("capped attested remainder precedes a new input in the next qualifying batch", () => {
  const f = fixture();
  try {
    const first = "First choice " + "a".repeat(10000);
    const second = "Second choice " + "b".repeat(10000);
    f.input(first);
    f.input(second);
    f.settle();
    assert.deepEqual(
      f.sent.prompt.records.map((r: any) => r.text),
      [first],
    );
    f.complete([]);
    assert.equal(f.store.snapshot().cursor, 315);
    assert.equal(f.spawned, 1); // No idle drain/retry loop.
    f.input("Third short choice");
    f.settle();
    assert.deepEqual(
      f.sent.prompt.records.map((r: any) => r.text),
      [second, "Third short choice"],
    );
    f.complete([]);
    assert.equal(f.store.snapshot().cursor, 317);
    assert.equal(f.spawned, 2);
  } finally {
    f.clean();
  }
});

test("new observed foreground input cancels only the old worker and remains eligible", () => {
  const f = fixture();
  try {
    f.input("Earlier observed choice");
    f.settle();
    const stale = f.sent.prompt.records[0];
    f.input("New foreground choice");
    assert.equal(f.aborted, 1);
    f.emit("agent_start");
    f.complete([{ recordId: stale.id, quote: "Earlier observed choice" }]);
    assert.equal(f.store.snapshot().cursor, 0);
    assert.equal(f.store.inspect().facts.length, 0);
    f.settle();
    assert.equal(f.spawned, 2);
    assert.deepEqual(
      f.sent.prompt.records.map((r: any) => r.text),
      ["Earlier observed choice", "New foreground choice"],
    );
    f.complete([]);
    assert.equal(f.store.snapshot().cursor, 316);
  } finally {
    f.clean();
  }
});

test("observed native RPC root is source attribution only; archive ordinal skips 314 imported rows", () => {
  const f = fixture();
  try {
    f.input();
    f.emit("agent_end");
    assert.equal(f.spawned, 0);
    f.settle();
    assert.equal(f.spawned, 1);
    assert.deepEqual(f.sent.options, {
      foreground: false,
      bypassQueue: false,
      inheritContext: false,
      maxTurns: 2,
      claimOutcome: true,
    });
    const source = f.sent.prompt.records[0];
    assert.equal(f.sent.prompt.records.length, 1);
    assert.equal(source.text, "Chosen concrete project approach");
    f.complete([{ recordId: source.id, quote: "concrete project approach" }]);
    f.emitNative();
    assert.equal(f.store.inspect().facts.length, 1);
    assert.equal(f.store.snapshot().cursor, 315);
    assert.ok(f.targets.includes(join(f.root, "state.json")));
  } finally {
    f.clean();
  }
});

test("child, unobserved DTO, extension, transformed/attached/ambiguous input and absent role/capability never dispatch", () => {
  for (const mode of [
    "child",
    "dto",
    "extension",
    "transformed",
    "attached",
    "ambiguous",
    "unknown",
    "capability",
    "overridden",
  ]) {
    const f = fixture();
    try {
      if (mode === "child") f.primary(false);
      if (mode === "unknown") f.service.getAgentType = () => undefined;
      if (mode === "capability") delete f.service.supportsInitialOutcomeClaim;
      if (mode === "overridden") f.role.toolNames = ["read"];
      if (mode === "dto") {
        f.store.ingest(f.store.snapshot(), [
          {
            id: "fake",
            sourceKind: "pi_message",
            projectId: "demo",
            message: {
              message_type: "user_message",
              content: "Fake unobserved input",
            },
          },
        ]);
      } else if (mode === "attached") {
        f.emit("input", { source: "rpc", text: "Attached", images: [{}] });
      } else f.input(undefined, mode === "extension" ? "extension" : "rpc");
      if (mode === "transformed")
        f.branch[0].message.content = "Different actual input";
      if (mode === "ambiguous") f.branch.push({ ...f.branch[0], id: "repeat" });
      f.settle();
      assert.equal(f.spawned, 0, mode);
    } finally {
      f.clean();
    }
  }
});

test("final settlement after error needs a new qualifying input; fast and double events consume once", () => {
  const f = fixture();
  try {
    f.input();
    f.settle("error");
    assert.equal(f.spawned, 0);
    f.fast();
    f.input("Retry project choice");
    f.settle();
    f.emitNative();
    f.settle();
    assert.equal(f.spawned, 1);
    assert.equal(f.store.snapshot().cursor, 315);
  } finally {
    f.clean();
  }
});

test("revocation, fork, immutable source mutation and CAS fail without review advancement; cancel aborts only own job", () => {
  for (const mode of ["revoke", "fork", "mutate", "cas", "cancel"]) {
    const f = fixture();
    try {
      f.input();
      f.settle();
      const source = f.sent.prompt.records[0];
      if (mode === "revoke") f.allow(false);
      if (mode === "fork") f.emit("session_before_fork");
      if (mode === "mutate")
        f.branch[0].message.content = "Changed after spawn";
      if (mode === "cas") {
        assert.throws(() => f.store.markReviewed(f.store.snapshot(), 1)); // Batch lease excludes another writer.
      }
      if (mode === "cancel") f.emit("session_shutdown");
      f.complete([{ recordId: source.id, quote: "concrete project approach" }]);
      if (mode !== "cas") {
        assert.equal(f.store.inspect().facts.length, 0);
        assert.equal(f.store.snapshot().cursor, 0);
      }
      if (["fork", "cancel"].includes(mode)) assert.equal(f.aborted, 1);
    } finally {
      f.clean();
    }
  }
});

test("timeout aborts only the owned job and leaves review state unchanged", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    f.input();
    f.settle();
    t.mock.timers.tick(120000);
    assert.equal(f.aborted, 1);
    f.complete([]);
    assert.equal(f.store.snapshot().cursor, 0);
    assert.equal(f.store.inspect().facts.length, 0);
  } finally {
    f.clean();
    t.mock.timers.reset();
  }
});

test("generation replacement and actual pointer-target denial prevent publish", () => {
  for (const mode of ["generation", "target"]) {
    const f = fixture();
    try {
      f.input();
      f.settle();
      const source = f.sent.prompt.records[0];
      if (mode === "generation") f.node.generation = {};
      else
        f.node.continuity.authorizeLearning = (
          _ctx: unknown,
          _root: string,
          target: string,
        ) => {
          if (target === join(f.root, "state.json"))
            throw new Error("path_write denied");
        };
      f.complete([{ recordId: source.id, quote: "concrete project approach" }]);
      assert.equal(f.store.snapshot().cursor, 0);
      assert.equal(f.store.inspect().facts.length, 0);
    } finally {
      f.clean();
    }
  }
});

test("extension input cannot admit learning; ordinary named projects remain eligible", () => {
  const f = fixture();
  try {
    f.ctx.cwd = join(f.root, "NeutralProject");
    mkdirSync(f.ctx.cwd, { mode: 0o700 });
    f.input("Synthetic extension text", "extension");
    f.settle();
    assert.equal(f.spawned, 0);
    assert.equal(f.store.snapshot().cursor, 0);
    f.input("Concrete ordinary project choice");
    f.settle();
    assert.equal(f.spawned, 1);
    f.complete([]);
    assert.ok(f.store.snapshot().cursor > 0);
  } finally {
    f.clean();
  }
});

test("closed output rejects unknown/import IDs, duplicate sources, unsafe quotes, extra keys and prose", () => {
  const records = normalize(
    [
      {
        id: "observed",
        sourceKind: "pi_message",
        projectId: "demo",
        message: {
          message_type: "user_message",
          content: "Concrete choice always core",
        },
      },
    ],
    policy,
  ).records;
  for (const raw of [
    "prose",
    "```json\n{}\n```",
    JSON.stringify({ notes: [], extra: true }),
    JSON.stringify({ notes: [{ recordId: "import-0", quote: "Concrete" }] }),
    JSON.stringify({ notes: [{ recordId: "observed", quote: "always core" }] }),
    JSON.stringify({
      notes: [{ recordId: "observed", quote: "Concrete", extra: true }],
    }),
    JSON.stringify({
      notes: Array(2).fill({ recordId: "observed", quote: "Concrete" }),
    }),
  ])
    assert.throws(() => decodeNotes(raw, records));
});

test("new runtime shows latest multi-notes and corrections, and cannot revive forgotten notes", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 6; i++) {
      f.input(`Concrete project choice ${i}`);
      f.settle();
      const source = f.sent.prompt.records[0];
      f.complete([{ recordId: source.id, quote: source.text }]);
    }
    const first = f.store.inspect().facts[0];
    await f.commands
      .get("memory-correct")
      .handler(`${first.id} ${first.recordId} project choice 0`, f.ctx);
    f.node.continuity.trustedTool = () => true;
    f.node.continuity.authorizeRead = async () => {};
    const runtime = createRuntime({
      root: f.root,
      nodes: new Map([["root", f.node]]),
    });
    runtime.start(f.ctx);
    const context: any = await runtime.run(
      "context",
      {},
      { name: "recall_read" } as any,
      f.ctx,
    );
    assert.equal(context.evidence, "UNTRUSTED");
    assert.equal(context.notes.length, 4);
    assert.equal(context.notes[0].quote, "project choice 0");
    assert.ok(
      context.notes.some(
        (note: any) => note.quote === "Concrete project choice 5",
      ),
    );
    await f.commands.get("memory-forget").handler(first.id, f.ctx);
    const fresh = createRuntime({
      root: f.root,
      nodes: new Map([["root", f.node]]),
    });
    fresh.start(f.ctx);
    const after: any = await fresh.run(
      "context",
      {},
      { name: "recall_read" } as any,
      f.ctx,
    );
    assert.ok(after.notes.every((note: any) => note.id !== first.id));
  } finally {
    f.clean();
  }
});

test("unrelated native queue activity does not veto bounded learning; lifecycle controls retain current-project citations", async () => {
  const f = fixture();
  try {
    f.busy(true);
    f.input("Second concrete choice");
    f.settle();
    assert.equal(f.spawned, 1);
    f.settle();
    assert.equal(f.spawned, 1, "own in-flight job stays single-flight");
    f.busy(false);
    const source = f.sent.prompt.records[0];
    f.complete([{ recordId: source.id, quote: "Second concrete choice" }]);
    const note = f.store.inspect().facts[0];
    await f.commands
      .get("memory-correct")
      .handler(`${note.id} ${source.id} concrete choice`, f.ctx);
    assert.equal(f.store.inspect().facts[0].quote, "concrete choice");
    await f.commands.get("memory-forget").handler(note.id, f.ctx);
    assert.equal(f.store.inspect().facts.length, 0);
  } finally {
    f.clean();
  }
});
