import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { activateAgentMemory } from "../extensions/mahiro-agent-memory.ts";
import { createMemoryStore } from "../lib/agent-memory/store.ts";
import { digest } from "../lib/continuity/records.ts";

process.env.GIT_AUTHOR_NAME = "Memory fixture";
process.env.GIT_AUTHOR_EMAIL = "fixture@example.invalid";
process.env.GIT_COMMITTER_NAME = "Memory fixture";
process.env.GIT_COMMITTER_EMAIL = "fixture@example.invalid";
const parent = new URL("../.agent-state/runtime/", import.meta.url).pathname;
function fixture(twoProjects = false) {
  const dir = mkdtempSync(join(parent, "managed-memory-runtime-"));
  const root = join(dir, "memory");
  const cwd = join(dir, "project");
  mkdirSync(cwd);
  const cwdB = join(dir, "other");
  if (twoProjects) mkdirSync(cwdB);
  const store = createMemoryStore(root);
  store.initialize(
    {
      version: 1,
      projects: [
        { cwd, id: "project" },
        ...(twoProjects ? [{ cwd: cwdB, id: "other" }] : []),
      ],
      coreBytes: 8192,
      indexBytes: 2048,
      fileBytes: 8192,
      totalBytes: 65536,
      automatic: true,
    },
    "# Core\nEstablished companion identity.\n",
  );
  const events = new Map<string, Set<Function>>();
  const handlers = new Map<string, Function[]>();
  const tools: any[] = [];
  const bus = {
    on(name: string, fn: Function) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name)!.add(fn);
      return () => events.get(name)!.delete(fn);
    },
  };
  const pi: any = {
    events: bus,
    on(name: string, fn: Function) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name)!.push(fn);
    },
    registerTool(t: any) {
      tools.push(t);
    },
    getAllTools() {
      return tools;
    },
  };
  const branch: any[] = [];
  const sm = {
    getSessionId: () => "primary",
    getBranch: () => branch,
    getHeader: () => ({ type: "session", id: "primary" }),
  };
  const ctx: any = { cwd, sessionManager: sm };
  let granted = true,
    healthy = true,
    revoked = false,
    spawned: any,
    descriptor: any = {
      name: "managed-memory-writer",
      model: "openai/gpt-6.1-sol",
      thinking: "medium",
      locked: true,
      inheritContext: false,
      runInBackground: true,
      promptMode: "replace",
      toolNames: [
        "agent_memory_read",
        "agent_memory_edit",
        "agent_memory_commit",
      ],
    };
  let record: any;
  let binding: any;
  const generation = {};
  const service = {
    supportsInitialOutcomeClaim: true,
    getAgentType: () => descriptor,
    hasRunning: () => false,
    getRecord: () => record,
    abort(id: string) {
      record.status = "stopped";
      return true;
    },
    spawn(name: string, prompt: string, options: any) {
      spawned = { name, prompt, options };
      record = {
        id: "job-1",
        type: name,
        status: "running",
        outputFile: "authoritative-native-session-file",
      };
      return record.id;
    },
  };
  const abi: any = {
    version: 1,
    generation,
    trustedTool: (tool: any) => tools.includes(tool),
    isPrimarySession: (c: any) => c.sessionManager === sm,
    assertAccess(tool: any, c: any, r: string) {
      if (!granted || r !== root || revoked)
        throw new Error("permission unavailable");
      if (c.sessionManager === sm) return { kind: "primary" };
      if (!binding || c.sessionManager !== binding.sm || !binding.active())
        throw new Error("unbound child");
      return { kind: "worker", value: binding.value };
    },
    async authorize(...args: any[]) {
      return abi.assertAccess(...args);
    },
    parentService: () => service,
    bindWorker(
      _tool: any,
      _ctx: any,
      _root: string,
      id: string,
      value: any,
      active: Function,
    ) {
      binding = { id, value, active };
      return () => {
        binding = undefined;
      };
    },
  };
  const nodes = new Map<string, any>([
    ["primary", { generation, healthy: () => healthy, managedMemory: abi }],
  ]);
  const runtime = activateAgentMemory(pi, { root, nodes });
  const emit = async (name: string, event: any = {}, context = ctx) => {
    const result = [];
    for (const fn of handlers.get(name) ?? [])
      result.push(await fn(event, context));
    return result;
  };
  const nativeEvent = (name: string) => {
    for (const fn of events.get(name) ?? []) fn({});
  };
  const child = () => {
    const childSM = { getSessionId: () => "child" };
    binding.sm = childSM;
    nodes.set("child", {
      generation,
      healthy: () => healthy,
      managedMemory: abi,
    });
    return { cwd, sessionManager: childSM };
  };
  return {
    root,
    cwdB,
    store,
    ctx,
    runtime,
    pi,
    emit,
    nativeEvent,
    branch,
    tools,
    child,
    get spawned() {
      return spawned;
    },
    get binding() {
      return binding;
    },
    get record() {
      return record;
    },
    setGranted(v: boolean) {
      granted = v;
    },
    setHealthy(v: boolean) {
      healthy = v;
    },
    revoke() {
      revoked = true;
    },
    setRole(v: any) {
      descriptor = v;
    },
    setVersion(v: number) {
      abi.version = v;
    },
    close() {
      runtime.cancel();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("large Unicode detail is completely paged by code point with stable whole-file hashes after restart", async () => {
  const f = fixture();
  const started = performance.now();
  try {
    const configPath = join(f.root, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    writeFileSync(
      configPath,
      JSON.stringify({ ...config, fileBytes: 262144, totalBytes: 8388608 }),
    );
    const prefix = "# Unicode 😀 ไทย\n";
    const unit = '😀ไทย\\"\t\n';
    const target = 145763;
    const repeated = unit.repeat(
      Math.floor(
        (target - Buffer.byteLength(prefix) - 1) / Buffer.byteLength(unit),
      ),
    );
    const text = `${prefix}${repeated}${"x".repeat(target - Buffer.byteLength(prefix + repeated) - 1)}\n`;
    assert.equal(Buffer.byteLength(text), target);
    await f.emit("session_start");
    const listed: any = await f.runtime.run("agent_memory_read", {}, f.ctx);
    await f.runtime.run(
      "agent_memory_edit",
      { path: "global/unicode.md", expectedHash: null, text, sources: [] },
      f.ctx,
    );
    await f.runtime.run(
      "agent_memory_commit",
      { revision: listed.revision },
      f.ctx,
    );
    await f.emit("session_start");
    let offset = 0;
    let complete = "";
    let pages = 0;
    while (true) {
      const page: any = await f.runtime.run(
        "agent_memory_read",
        { path: "global/unicode.md", offset, limit: 4096 },
        f.ctx,
      );
      assert.equal(page.hash, digest(text));
      assert.equal(page.totalCharacters, [...text].length);
      assert.ok([...page.text].length <= 4096);
      complete += page.text;
      pages++;
      if (page.nextOffset === undefined) break;
      assert.ok(page.nextOffset > offset);
      offset = page.nextOffset;
    }
    assert.equal(complete, text);
    assert.equal(digest(complete), digest(text));
    console.log(
      JSON.stringify({
        fixture: "unicode-paging",
        utf8Bytes: target,
        codePoints: [...text].length,
        pages,
        wallMs: Math.round(performance.now() - started),
        processPeakRssKiB: process.resourceUsage().maxRSS,
      }),
    );
  } finally {
    f.close();
  }
});

test("project management preserves other projects now and through future source reuse and recovery", async () => {
  const f = fixture(true);
  try {
    await f.emit("session_start");
    const initial = f.store.snapshot().revision;
    const bPath = "deferred/other/b.md";
    const aPath = "deferred/project/a.md";
    const publish = (
      project: string,
      path: string,
      text: string,
      sources: string[],
    ) => {
      const v = f.store.createView(project);
      f.store.edit(
        v,
        path,
        v.files[path] ? digest(v.files[path].text) : null,
        text,
        sources,
      );
      f.store.integrate(v);
    };
    const manage = (ctx: any, action: string, extra: object) =>
      f.runtime.run(
        "agent_memory_manage",
        { action, revision: f.store.snapshot().revision, ...extra },
        ctx,
      );
    publish("other", bPath, "# B\nOriginal\n", ["b-source"]);
    const originalB = f.store.snapshot().files[bPath];
    await assert.rejects(
      () => f.runtime.run("agent_memory_read", { path: bPath }, f.ctx),
      /scope/,
    );
    await manage(f.ctx, "rollback", { target: initial });
    assert.deepEqual(f.store.snapshot().files[bPath], originalB);
    await manage(f.ctx, "forget", {
      paths: [],
      sources: ["b-source", "unknown"],
    });
    assert.deepEqual(f.store.snapshot().files[bPath], originalB);
    publish("other", bPath, "# B\nFuture edit\n", ["b-source", "unknown"]);
    const future = f.store.snapshot();
    const bCtx = { ...f.ctx, cwd: f.cwdB };
    await manage(bCtx, "rollback", { target: future.revision });
    assert.deepEqual(f.store.snapshot().files[bPath], future.files[bPath]);
    await manage(bCtx, "rollback", { target: initial });
    assert.equal(f.store.snapshot().files[bPath], undefined);
    await manage(bCtx, "rollback", { target: future.revision });
    assert.deepEqual(f.store.snapshot().files[bPath], future.files[bPath]);
    // Same ID is intentionally global only for Core/index/procedures, not B.
    publish("project", aPath, "# A\nForget me\n", ["a-source"]);
    publish("project", "procedures/shared.md", "# Shared\nForget me too\n", [
      "a-source",
    ]);
    const learned = f.store.snapshot();
    const stale = f.store.createView("project");
    f.store.edit(stale, "procedures/revival.md", null, "# Revival\n", [
      "a-source",
    ]);
    await manage(f.ctx, "forget", { paths: [aPath], sources: ["a-source"] });
    await manage(f.ctx, "rollback", { target: learned.revision });
    const restored = f.store.snapshot();
    assert.equal(restored.files[aPath], undefined);
    assert.equal(restored.files["procedures/shared.md"], undefined);
    assert.deepEqual(restored.files[bPath], future.files[bPath]);
    assert.ok("conflict" in f.store.integrate(stale));
    assert.equal(
      f.store.conflicts("project", stale.id, "procedures/revival.md")
        .suppressedByForgetting,
      true,
    );
    await manage(bCtx, "rollback", { target: learned.revision });
    assert.equal(f.store.snapshot().files["procedures/shared.md"], undefined);
    // A source reused in B remains valid, even after A's tombstone.
    publish("other", bPath, "# B\nIndependent source reuse\n", ["a-source"]);
    assert.equal(
      f.store.snapshot().files[bPath].text,
      "# B\nIndependent source reuse\n",
    );
    // Shared Core still requires explicit correction rather than identity deletion.
    publish(
      "other",
      "Core.md",
      "# Core\nIdentity and crosslinked preference\n",
      ["crosslinked"],
    );
    await assert.rejects(
      () => manage(f.ctx, "forget", { paths: [], sources: ["crosslinked"] }),
      /preserve established identity/,
    );
  } finally {
    f.close();
  }
});

test("primary tools edit maintained Markdown and refresh existing/fresh request system context by committed revision", async () => {
  const f = fixture();
  try {
    await f.emit("session_start");
    const before = (
      await f.emit("before_agent_start", {
        systemPrompt: "Existing native instructions",
      })
    )[0];
    assert.match(before.systemPrompt, /Established companion identity/);
    const core = await f.runtime.run(
      "agent_memory_read",
      { path: "Core.md" },
      f.ctx,
    );
    await f.runtime.run(
      "agent_memory_edit",
      {
        path: "Core.md",
        expectedHash: (core as any).hash,
        text: "# Core\nEstablished companion identity. Prefer B rather than A.\n",
        sources: ["e-1"],
      },
      f.ctx,
    );
    const unchanged = (
      await f.emit("before_agent_start", {
        systemPrompt: "Existing native instructions",
      })
    )[0];
    assert.doesNotMatch(unchanged.systemPrompt, /Prefer B/);
    const commit = await f.runtime.run(
      "agent_memory_commit",
      { revision: (core as any).revision },
      f.ctx,
    );
    assert.equal((commit as any).contextActivation, "next-primary-request");
    const next = (
      await f.emit("before_agent_start", { systemPrompt: before.systemPrompt })
    )[0];
    assert.match(next.systemPrompt, /Prefer B rather than A/);
    assert.equal(next.systemPrompt.match(/<mahiro-managed-memory>/g).length, 1);
    await f.emit("session_start");
    const fresh = (
      await f.emit("before_agent_start", {
        systemPrompt: "Fresh native instructions",
      })
    )[0];
    assert.match(fresh.systemPrompt, /Prefer B/);
  } finally {
    f.close();
  }
});

test("public conflict paging recovers complete Unicode proposals and rejects malformed or foreign selection", async () => {
  const f = fixture(true);
  try {
    const configPath = join(f.root, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.fileBytes = 262144;
    config.totalBytes = 8388608;
    writeFileSync(configPath, `${JSON.stringify(config)}\n`);
    const path = "global/proposal.md";
    const seed = f.store.createView("project");
    f.store.edit(seed, path, null, "# Base\n");
    f.store.integrate(seed);
    const winner = f.store.createView("project");
    const stale = f.store.createView("project");
    const proposal = `# Proposal\n${"ข้อมูล🪷\n".repeat(1700)}`;
    f.store.edit(winner, path, digest("# Base\n"), "# Winner\n");
    f.store.edit(stale, path, digest("# Base\n"), proposal);
    f.store.integrate(winner);
    assert.ok("conflict" in f.store.integrate(stale));
    await f.emit("session_start");
    let restored = "";
    let offset = 0;
    while (offset < [...proposal].length) {
      const result = (await f.runtime.run(
        "agent_memory_manage",
        {
          action: "conflicts",
          target: stale.id,
          path,
          offset,
          limit: 513,
        },
        f.ctx,
      )) as any;
      assert.equal(result.proposalHash, digest(proposal));
      assert.equal(result.currentHash, digest("# Winner\n"));
      assert.equal(result.offset, offset);
      assert.equal(result.totalCharacters, [...proposal].length);
      assert.ok([...result.text].length <= 513);
      restored += result.text;
      offset += [...result.text].length;
    }
    assert.equal(restored, proposal);
    const current = (await f.runtime.run(
      "agent_memory_read",
      { path },
      f.ctx,
    )) as any;
    await f.runtime.run(
      "agent_memory_edit",
      {
        path,
        expectedHash: current.hash,
        text: restored,
        sources: [],
      },
      f.ctx,
    );
    await f.runtime.run(
      "agent_memory_commit",
      {
        revision: current.revision,
      },
      f.ctx,
    );
    assert.equal(f.store.snapshot().files[path].text, proposal);
    for (const args of [
      { action: "status", offset: 0 },
      { action: "conflicts", target: stale.id, offset: 0 },
      { action: "conflicts", target: stale.id, path, offset: -1 },
      { action: "conflicts", target: stale.id, path, offset: 0.5 },
      { action: "conflicts", target: stale.id, path, limit: 4097 },
      {
        action: "conflicts",
        target: stale.id,
        path: "deferred/other/private.md",
        offset: 0,
      },
    ])
      await assert.rejects(f.runtime.run("agent_memory_manage", args, f.ctx));
    assert.throws(
      () => f.store.conflicts("other", stale.id, path, 0, 513),
      /Unknown scoped/,
    );
    f.store.forget(f.store.snapshot().revision, [path], [], "project");
    const forgotten = (await f.runtime.run(
      "agent_memory_manage",
      {
        action: "conflicts",
        target: stale.id,
        path,
        offset: 513,
      },
      f.ctx,
    )) as any;
    assert.equal(forgotten.suppressedByForgetting, true);
    assert.equal(forgotten.text, undefined);
  } finally {
    f.close();
  }
});

test("missing/revoked permission, obsolete ABI, cancellation and unknown arguments do not activate edits", async () => {
  const f = fixture();
  try {
    await f.emit("session_start");
    const original = f.store.snapshot().revision;
    f.setGranted(false);
    await assert.rejects(f.runtime.run("agent_memory_read", {}, f.ctx));
    f.setGranted(true);
    f.setVersion(0);
    await assert.rejects(f.runtime.run("agent_memory_read", {}, f.ctx));
    f.setVersion(1);
    const core: any = await f.runtime.run(
      "agent_memory_read",
      { path: "Core.md" },
      f.ctx,
    );
    await assert.rejects(
      f.runtime.run(
        "agent_memory_edit",
        {
          path: "Core.md",
          expectedHash: core.hash,
          text: "safe\n",
          sources: [],
          approved: true,
        },
        f.ctx,
      ),
    );
    await f.runtime.run(
      "agent_memory_edit",
      {
        path: "Core.md",
        expectedHash: core.hash,
        text: "# Core\nDraft\n",
        sources: [],
      },
      f.ctx,
    );
    f.revoke();
    await assert.rejects(
      f.runtime.run("agent_memory_commit", { revision: core.revision }, f.ctx),
    );
    assert.equal(f.store.snapshot().revision, original);
    const projection = await f.emit("before_agent_start", {
      systemPrompt: "Native",
    });
    assert.equal(projection[0], undefined);
    await assert.rejects(f.runtime.run("arbitrary", {}, f.ctx));
  } finally {
    f.close();
  }
});

test("explicit initialization creates only a new authorized root, with reversible source-only registration", async () => {
  const f = fixture();
  try {
    await f.emit("session_start");
    rmSync(f.root, { recursive: true });
    f.setGranted(false);
    await assert.rejects(
      f.runtime.run(
        "agent_memory_manage",
        {
          action: "initialize",
          core: "# Core\nEstablished identity.\n",
          projectId: "project",
        },
        f.ctx,
      ),
    );
    f.setGranted(true);
    const result: any = await f.runtime.run(
      "agent_memory_manage",
      {
        action: "initialize",
        core: "# Core\nEstablished identity.\n",
        projectId: "project",
      },
      f.ctx,
    );
    assert.equal(result.initialized, true);
    assert.equal(result.nativeBootstrapChanged, false);
    assert.equal(f.store.config().automatic, false);
    await assert.rejects(
      f.runtime.run(
        "agent_memory_manage",
        {
          action: "initialize",
          core: "# Wrong replacement\n",
          projectId: "project",
        },
        f.ctx,
      ),
      /New private root/,
    );
    assert.match(
      f.store.snapshot().files["Core.md"].text,
      /Established identity/,
    );
  } finally {
    f.close();
  }
});

test("native writer uses bound private view and automatic same-owner integration, not closed literal quotes", async () => {
  const f = fixture();
  try {
    await f.emit("session_start");
    const dispatch: any = await f.runtime.run(
      "agent_memory_reflect",
      {
        assignment:
          "Remember the correction as a reusable verification method.",
      },
      f.ctx,
    );
    assert.equal(dispatch.status, "native-dispatched");
    assert.equal(dispatch.providerProof, false);
    assert.equal(f.spawned.name, "managed-memory-writer");
    assert.deepEqual(f.spawned.options, {
      foreground: false,
      bypassQueue: false,
      inheritContext: false,
      maxTurns: 8,
      claimOutcome: true,
    });
    const child: any = f.child();
    await assert.rejects(
      f.runtime.run("agent_memory_manage", { action: "status" }, child),
    );
    await assert.rejects(
      f.runtime.run(
        "agent_memory_edit",
        {
          path: "deferred/other/leak.md",
          expectedHash: null,
          text: "# Wrong scope\n",
          sources: [],
        },
        child,
      ),
    );
    const files: any = await f.runtime.run("agent_memory_read", {}, child);
    assert.equal(files.project, "project");
    await f.runtime.run(
      "agent_memory_edit",
      {
        path: "procedures/evidence.md",
        expectedHash: null,
        text: "# Evidence\nA successful tool exit is not human acceptance; inspect the outcome before claiming completion.\n",
        sources: [],
      },
      child,
    );
    const before = f.store.snapshot().revision;
    await f.runtime.run(
      "agent_memory_commit",
      { revision: files.revision },
      child,
    );
    assert.equal(f.store.snapshot().revision, before);
    f.record.status = "completed";
    f.nativeEvent("subagents:completed");
    assert.ok(f.store.snapshot().files["procedures/evidence.md"]);
    assert.notEqual(f.store.snapshot().revision, before);
    assert.equal(f.binding, undefined);
    await assert.rejects(f.runtime.run("agent_memory_read", {}, child));
    f.nativeEvent("subagents:completed");
    assert.ok(f.store.snapshot().files["procedures/evidence.md"]);
  } finally {
    f.close();
  }
});

test("workers cannot obtain primary management, project escape or an unbound lease; role drift fails closed", async () => {
  const f = fixture();
  try {
    await f.emit("session_start");
    f.setRole({
      name: "managed-memory-writer",
      locked: true,
      toolNames: ["bash"],
    });
    await assert.rejects(
      f.runtime.run(
        "agent_memory_reflect",
        { assignment: "Learn a method" },
        f.ctx,
      ),
      /Locked native/,
    );
    assert.equal(f.spawned, undefined);
  } finally {
    f.close();
  }
});

test("semantic episode links observed input, assistant action, selected tool result and correction without human-authentication claims", async () => {
  const f = fixture();
  try {
    await f.emit("session_start");
    const text =
      "That check failed: inspect the actual result before reporting success.";
    await f.emit("input", { source: "rpc", text });
    f.branch.push({
      id: "entry-1",
      type: "message",
      message: { role: "user", content: text },
    });
    await f.emit("message_end", {
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "I will run and inspect the bounded check." },
          { type: "toolCall", name: "bash" },
        ],
      },
    });
    await f.emit("tool_execution_start", {
      toolName: "bash",
      toolCallId: "t-1",
      args: { command: "pnpm check" },
    });
    await f.emit("tool_execution_end", {
      toolName: "bash",
      toolCallId: "t-1",
      isError: true,
      result: {
        content: [{ type: "text", text: "1 failing check: stale context" }],
      },
    });
    await f.emit("agent_before_settle", { outcome: "completed" });
    await f.emit("agent_settled", { aborted: false });
    const prompt = JSON.parse(f.spawned.prompt);
    assert.equal(prompt.episodes[0].input.text, text);
    assert.equal(
      prompt.episodes[0].actions[0].text,
      "I will run and inspect the bounded check.",
    );
    assert.equal(prompt.episodes[0].results[0].error, true);
    assert.match(prompt.episodes[0].results[0].text, /stale context/);
    assert.equal(prompt.episodes[0].evidence, "observed-native-unverified");
    assert.doesNotMatch(JSON.stringify(prompt), /verified-human/);
    assert.equal(f.store.pendingEpisodes("project").length, 1);
  } finally {
    f.close();
  }
});

test("expired native job binding cannot publish even after the native service reports completed", async () => {
  const f = fixture();
  const now = Date.now;
  try {
    await f.emit("session_start");
    await f.runtime.run(
      "agent_memory_reflect",
      { assignment: "Maintain a method" },
      f.ctx,
    );
    const child: any = f.child();
    const files: any = await f.runtime.run("agent_memory_read", {}, child);
    await f.runtime.run(
      "agent_memory_edit",
      {
        path: "procedures/expired.md",
        expectedHash: null,
        text: "# Expired\n",
        sources: [],
      },
      child,
    );
    await f.runtime.run(
      "agent_memory_commit",
      { revision: files.revision },
      child,
    );
    const before = f.store.snapshot().revision;
    Date.now = () => now() + 120001;
    f.record.status = "completed";
    f.nativeEvent("subagents:completed");
    Date.now = now;
    assert.equal(f.store.snapshot().revision, before);
    assert.equal(f.binding, undefined);
    assert.equal(
      f.runtime.status().lastError,
      "worker-integration-unavailable",
    );
  } finally {
    Date.now = now;
    f.close();
  }
});

test("foreground/cancel/session lifecycle invalidates worker publication and failed jobs do not advance review progress", async () => {
  const f = fixture();
  try {
    await f.emit("session_start");
    await f.runtime.run(
      "agent_memory_reflect",
      { assignment: "Remember a durable method" },
      f.ctx,
    );
    const child: any = f.child();
    const files: any = await f.runtime.run("agent_memory_read", {}, child);
    await f.runtime.run(
      "agent_memory_edit",
      {
        path: "procedures/do-not-integrate.md",
        expectedHash: null,
        text: "# Pending\n",
        sources: [],
      },
      child,
    );
    const before = f.store.snapshot().revision;
    await f.emit("before_agent_start", { systemPrompt: "Foreground task" });
    assert.equal(f.record.status, "stopped");
    await assert.rejects(
      f.runtime.run("agent_memory_commit", { revision: files.revision }, child),
    );
    f.record.status = "completed";
    f.nativeEvent("subagents:completed");
    assert.equal(f.store.snapshot().revision, before);
    await f.emit("session_shutdown");
    await assert.rejects(f.runtime.run("agent_memory_read", {}, f.ctx));
  } finally {
    f.close();
  }
});
