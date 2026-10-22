import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { activateWith } from "../extensions/mahiro-continuity.ts";
import { createStore } from "../lib/continuity/store.ts";
import { createRuntime, type IGuardNode } from "../lib/continuity/runtime.ts";
import {
  bytes,
  digest,
  normalize,
  search,
  type IImport,
} from "../lib/continuity/records.ts";

function fixture() {
  const parent = resolve(".agent-state/runtime/continuity-tests");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(parent, "runtime-"));
  chmodSync(root, 0o700);
  const data = join(root, "data");
  const ctx: any = {
    cwd: root,
    mode: "tui",
    sessionManager: { getSessionId: () => "parent" },
  };
  const tool: any = { name: "recall_read", sourceInfo: { synthetic: true } };
  const paths: string[] = [];
  const generation = {};
  let healthy = true;
  const node: IGuardNode = {
    generation,
    healthy: () => healthy,
    host: { finalArgs: async (_name, args) => args },
    continuity: {
      version: 1,
      generation,
      // Synthetic canonical ABI fixture; automatic context explicitly attests root topology.
      isPrimarySession: () => true,
      trustedTool: (value) => value === tool,
      authorizeRead: async (_tool, path) => {
        paths.push(path);
      },
    },
  };
  const nodes = new Map([["parent", node]]);
  const runtime = createRuntime({ root: data, nodes });
  runtime.start(ctx);
  return {
    root,
    data,
    ctx,
    tool,
    node,
    nodes,
    runtime,
    paths,
    unhealthy: () => {
      healthy = false;
    },
    seed() {
      createStore(data, {
        excludedProjectIds: ["ExcludedProject"],
        excludedPaths: [],
      }).initialize({ session: "import", branch: "main", epoch: 0 }, [
        {
          id: "late",
          sourceKind: "letta_message",
          projectId: "demo",
          date: "2026-10-18T00:00:00Z",
          path: "/synthetic/evidence.md",
          message: {
            message_type: "user_message",
            content:
              "intro ".repeat(8000) + "ภาษาไทย actual-needle-specific-decision",
          },
        },
        {
          id: "foreign",
          sourceKind: "letta_memory",
          projectId: "other",
          markdown: "foreign decision",
        },
      ]);
      writeFileSync(
        join(data, "manifest.json"),
        JSON.stringify({
          version: 1,
          projects: [{ cwd: root, projectId: "demo" }],
        }),
        { mode: 0o600 },
      );
    },
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

const policy = {
  excludedProjectIds: ["excludedproject", "excluded-frontend"],
  excludedPaths: [],
};
const historicalInput = (
  id: string,
  projectId: string | null = "demo",
  text = "archive needle",
): IImport => ({
  id,
  projectId,
  sourceKind: "letta_message",
  messageId: id,
  message: { message_type: "user_message", content: text },
});
function historyFixture(f: ReturnType<typeof fixture>, inputs: IImport[]) {
  const root = join(f.data, "history");
  mkdirSync(root, { mode: 0o700 });
  const archives = inputs.map((input) => normalize([input], policy));
  const shards = archives.map((archive) => {
    const text = JSON.stringify(archive);
    const hash = digest(text);
    writeFileSync(join(root, `${hash}.json`), text, { mode: 0o600 });
    return {
      hash,
      bytes: bytes(text),
      projectId: archive.records[0].projectId,
    };
  });
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({
      version: 1,
      kind: "sanitized-letta-visible-history",
      shards,
    }),
    { mode: 0o600 },
  );
  const manifest = {
    version: 1,
    projects: [{ cwd: f.root, projectId: "demo" }],
    history: true,
  };
  writeFileSync(join(f.data, "manifest.json"), JSON.stringify(manifest), {
    mode: 0o600,
  });
  return { root, archives, shards, manifest };
}

test("activation/session start are IO-free and unavailable readers never create data roots", async () => {
  const f = fixture();
  try {
    const handlers = new Map();
    const tools: any[] = [];
    activateWith(
      {
        registerTool: (tool: any) => tools.push(tool),
        on: (name: string, fn: any) => handlers.set(name, fn),
        getAllTools: () => tools,
      } as any,
      { root: f.data, nodes: f.nodes },
    );
    handlers.get("session_start")({}, f.ctx);
    assert.equal(existsSync(f.data), false);
    await assert.rejects(
      f.runtime.run("recall_read", { recordId: "late" }, f.tool, f.ctx),
      /unavailable/,
    );
    assert.equal(existsSync(f.data), false);
    assert.equal(tools.length, 2);
  } finally {
    f.clean();
  }
});

test("synthetic child ABI blocks automatic injection before data IO but preserves explicit recall", async () => {
  const f = fixture();
  try {
    f.seed();
    const store = createStore(f.data, {
      excludedProjectIds: [],
      excludedPaths: [],
    });
    const snapshot = store.snapshot();
    store.accept(
      snapshot,
      {
        snapshot,
        cursor: 1,
        notes: [
          {
            id: "old-note",
            recordId: "late",
            projectId: "demo",
            quote: "actual-needle-specific-decision",
          },
        ],
      },
      "completed",
      ["old-note"],
    );
    const handlers = new Map<string, any>();
    const tools: any[] = [];
    activateWith(
      {
        registerTool: (tool: any) => tools.push(tool),
        getAllTools: () => tools,
        getActiveTools: () => [],
        on: (name: string, fn: any) => handlers.set(name, fn),
      } as any,
      { root: f.data, nodes: f.nodes },
    );
    f.node.continuity.trustedTool = () => true;
    handlers.get("session_start")({}, f.ctx);
    let primaryChecks = 0;
    f.node.continuity.isPrimarySession = () => {
      primaryChecks++;
      return false;
    };
    const before = f.paths.length;
    assert.equal(
      await handlers.get("before_agent_start")({}, f.ctx),
      undefined,
    );
    assert.ok(primaryChecks > 0);
    assert.equal(f.paths.length, before);
    const explicit: any = await f.runtime.run(
      "recall_read",
      { recordId: "late" },
      f.tool,
      f.ctx,
    );
    assert.equal(explicit.recordId, "late");
    delete f.node.continuity.isPrimarySession;
    const afterRead = f.paths.length;
    assert.equal(
      await handlers.get("before_agent_start")({}, f.ctx),
      undefined,
    );
    assert.equal(f.paths.length, afterRead);
    f.node.continuity.isPrimarySession = () => true;
    const primary = await handlers.get("before_agent_start")({}, f.ctx);
    const context = JSON.parse(primary.message.content);
    assert.equal(context.evidence, "UNTRUSTED");
    assert.deepEqual(
      context.notes.map((note: any) => note.id),
      ["old-note"],
    );
  } finally {
    f.clean();
  }
});

test("guarded reads preserve provenance, project isolation and late UTF8 query windows without writes", async () => {
  const f = fixture();
  try {
    f.seed();
    const before = readdirSync(f.data);
    const result: any = await f.runtime.run(
      "recall_read",
      { recordId: "late", query: "actual-needle-specific-decision" },
      f.tool,
      f.ctx,
    );
    assert.ok(result.quote.includes("actual-needle-specific-decision"));
    assert.equal(result.evidence, "UNTRUSTED");
    assert.equal(result.path, "/synthetic/evidence.md");
    assert.equal(result.date, "2026-10-18T00:00:00Z");
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 8192);
    const thai: any = await f.runtime.run(
      "recall_read",
      { recordId: "late", query: "ภาษาไทย" },
      f.tool,
      f.ctx,
    );
    assert.ok(thai.quote.includes("ภาษาไทย"));
    assert.ok(!thai.quote.includes("�"));
    assert.deepEqual(
      await f.runtime.run(
        "recall_read",
        { recordId: "foreign" },
        f.tool,
        f.ctx,
      ),
      { unavailable: true },
    );
    assert.ok(
      !(
        (await f.runtime.run(
          "recall_read",
          { recordId: "foreign", crossProject: true },
          f.tool,
          f.ctx,
        )) as any
      ).unavailable,
    );
    assert.deepEqual(readdirSync(f.data), before);
    assert.ok(f.paths.some((path) => path.endsWith("state.json")));
    assert.ok(f.paths.every((path) => !path.includes("/history")));
    const reader = createStore(
      f.data,
      { excludedProjectIds: [], excludedPaths: [] },
      { readOnly: true },
    );
    assert.throws(
      () => reader.forget(reader.snapshot(), ["late"]),
      /Read-only/,
    );
  } finally {
    f.clean();
  }
});

test("missing ABI, stale health, foreign tools, child ownership and final argument mutation fail before IO", async () => {
  const f = fixture();
  try {
    const call = () =>
      f.runtime.run("recall_search", { query: "tea" }, f.tool, f.ctx);
    f.nodes.clear();
    await assert.rejects(call());
    assert.equal(f.paths.length, 0);
    f.nodes.set("parent", f.node);
    f.node.continuity.version = 2;
    await assert.rejects(call());
    assert.equal(f.paths.length, 0);
    f.node.continuity.version = 1;
    await assert.rejects(
      f.runtime.run(
        "recall_read",
        { recordId: "late" },
        { ...f.tool } as any,
        f.ctx,
      ),
    );
    await assert.rejects(
      f.runtime.run(
        "recall_read",
        { recordId: "late", root: f.root },
        f.tool,
        f.ctx,
      ),
    );
    const child = {
      ...f.ctx,
      mode: "sdk",
      sessionManager: { getSessionId: () => "child" },
    };
    await assert.rejects(
      f.runtime.run("recall_read", { recordId: "late" }, f.tool, child),
    );
    f.node.host.finalArgs = async () => ({ query: "tea", root: "/unexpected" });
    await assert.rejects(call());
    assert.equal(f.paths.length, 0);
    f.node.host.finalArgs = async (_name, args) => {
      f.runtime.stop(f.ctx);
      return args;
    };
    await assert.rejects(call());
    assert.equal(f.paths.length, 0);
  } finally {
    f.clean();
  }
});

test("historical late UTF8 reads, scoped shard IO and canonical merged global ranking", async () => {
  const f = fixture();
  try {
    f.seed();
    const h = historyFixture(f, [
      historicalInput(
        "historic",
        "demo",
        "intro ".repeat(8000) + "ภาษาไทย actual-needle-specific-decision",
      ),
      historicalInput(
        "global",
        null,
        "actual-needle-specific-decision ภาษาไทย",
      ),
      historicalInput("offscope", "other", "actual-needle-specific-decision"),
    ]);
    const query = "actual-needle-specific-decision";
    const local: any = await f.runtime.run(
      "recall_search",
      { query },
      f.tool,
      f.ctx,
    );
    assert.ok(local.some((hit: any) => hit.recordId === "historic"));
    for (const shard of h.shards.slice(1))
      assert.ok(!f.paths.includes(join(h.root, `${shard.hash}.json`)));
    for (const query of ["ภาษาไทย", "actual-needle-specific-decision"]) {
      const read: any = await f.runtime.run(
        "recall_read",
        { recordId: "historic", query },
        f.tool,
        f.ctx,
      );
      assert.ok(read.quote.includes(query));
      assert.ok(!read.quote.includes("�"));
      assert.equal(read.hash, h.archives[0].records[0].hash);
    }
    const scope = {
      projectId: "demo",
      includeGlobal: true,
      crossProject: true,
    };
    const store = createStore(f.data, policy, { readOnly: true });
    const md = store
      .search(query, scope)
      .map((hit) => store.read(hit.recordId, scope)!);
    const expected = search(
      [...md, ...h.archives.flatMap((a) => a.records)],
      query,
      scope,
      { count: 6, perResultBytes: 1024, totalBytes: 6144 },
    );
    assert.deepEqual(
      await f.runtime.run(
        "recall_search",
        { query, includeGlobal: true, crossProject: true },
        f.tool,
        f.ctx,
      ),
      expected,
    );
    const writer = createStore(f.data, policy);
    writer.forget(writer.snapshot(), ["historic", "late"]);
    assert.deepEqual(
      await f.runtime.run(
        "recall_read",
        { recordId: "historic" },
        f.tool,
        f.ctx,
      ),
      { unavailable: true },
    );
    assert.deepEqual(
      await f.runtime.run("recall_search", { query }, f.tool, f.ctx),
      [],
    );
  } finally {
    f.clean();
  }
});

test("global top six are canonical across both sources rather than source biased", async () => {
  const f = fixture();
  try {
    f.seed();
    const writer = createStore(f.data, policy);
    writer.ingest(
      writer.snapshot(),
      Array.from({ length: 8 }, (_, i) => ({
        ...historicalInput(`md-${i}`, "demo", "alpha"),
        sourceKind: "pi_message" as const,
      })),
    );
    const h = historyFixture(
      f,
      Array.from({ length: 8 }, (_, i) =>
        historicalInput(
          `history-${i}`,
          i % 2 ? null : "demo",
          "alpha beta gamma",
        ),
      ),
    );
    const scope = { projectId: "demo", includeGlobal: true };
    const md = writer
      .search("alpha beta gamma", scope)
      .map((hit) => writer.read(hit.recordId, scope)!);
    const expected = search(
      [...md, ...h.archives.flatMap((a) => a.records)],
      "alpha beta gamma",
      scope,
      { count: 6, perResultBytes: 1024, totalBytes: 6144 },
    );
    assert.equal(expected.length, 6);
    assert.ok(expected.every((hit) => hit.recordId.startsWith("history-")));
    assert.deepEqual(
      await f.runtime.run(
        "recall_search",
        { query: "alpha beta gamma", includeGlobal: true },
        f.tool,
        f.ctx,
      ),
      expected,
    );
  } finally {
    f.clean();
  }
});

test("history flag is literal true; absent flag has no history dependency", async () => {
  const f = fixture();
  try {
    f.seed();
    const call = () =>
      f.runtime.run(
        "recall_search",
        { query: "actual-needle-specific-decision" },
        f.tool,
        f.ctx,
      );
    await call();
    assert.ok(f.paths.every((path) => !path.includes("/history")));
    for (const extra of [
      { history: false },
      { history: "true" },
      { history: true },
      { unknown: true },
    ]) {
      writeFileSync(
        join(f.data, "manifest.json"),
        JSON.stringify({
          version: 1,
          projects: [{ cwd: f.root, projectId: "demo" }],
          ...extra,
        }),
        { mode: 0o600 },
      );
      await assert.rejects(call(), /unavailable/);
    }
  } finally {
    f.clean();
  }
});

test("denied, symlinked, oversized, corrupt or late-failing shards never return partial MD", async () => {
  for (const mode of [
    "deny",
    "symlink",
    "oversize",
    "corrupt",
    "late",
    "private",
    "stale-health",
  ]) {
    const f = fixture();
    try {
      f.seed();
      const h = historyFixture(f, [
        historicalInput("historic"),
        historicalInput("later"),
      ]);
      const path = join(
        h.root,
        `${h.shards[mode === "late" ? 1 : 0].hash}.json`,
      );
      if (mode === "symlink") {
        rmSync(path);
        symlinkSync(join(f.data, "state.json"), path);
      } else if (mode === "oversize")
        writeFileSync(path, " ".repeat(8 * 1024 * 1024 + 1));
      else if (mode === "corrupt") writeFileSync(path, "{}");
      else if (mode === "late") rmSync(path);
      else if (mode === "private") chmodSync(path, 0o644);
      const authorize = f.node.continuity.authorizeRead;
      f.node.continuity.authorizeRead = async (tool, file, ctx, signal) => {
        await authorize(tool, file, ctx, signal);
        if (file === path && mode === "deny") throw new Error("denied");
        if (file === path && mode === "stale-health") f.unhealthy();
      };
      await assert.rejects(
        f.runtime.run(
          "recall_search",
          { query: "actual-needle-specific-decision" },
          f.tool,
          f.ctx,
        ),
        /unavailable/,
      );
    } finally {
      f.clean();
    }
  }
});

test("permission awaits invalidate results after forget, lifecycle rebase or root remap", async () => {
  for (const mode of ["forget", "rebase", "remap"]) {
    const f = fixture();
    try {
      f.seed();
      const h = historyFixture(f, [historicalInput("historic")]);
      const writer = createStore(f.data, policy);
      const authorize = f.node.continuity.authorizeRead;
      let changed = false;
      f.node.continuity.authorizeRead = async (tool, path, ctx, signal) => {
        await authorize(tool, path, ctx, signal);
        if (changed || path !== join(h.root, `${h.shards[0].hash}.json`))
          return;
        changed = true;
        await Promise.resolve();
        if (mode === "forget") writer.forget(writer.snapshot(), ["historic"]);
        else if (mode === "rebase")
          writer.changeLifecycle(writer.snapshot(), {
            session: "next",
            branch: "other",
            epoch: 1,
          });
        else
          writeFileSync(
            join(f.data, "manifest.json"),
            JSON.stringify({
              ...h.manifest,
              projects: [{ cwd: f.root, projectId: "other" }],
            }),
            { mode: 0o600 },
          );
      };
      await assert.rejects(
        f.runtime.run("recall_read", { recordId: "historic" }, f.tool, f.ctx),
        /unavailable/,
      );
      assert.ok(changed);
    } finally {
      f.clean();
    }
  }
});

test("async authorization shutdown/generation replacement, ambiguous maps and symlinks fail closed", async () => {
  const f = fixture();
  try {
    f.seed();
    f.node.continuity.authorizeRead = async () => {
      f.runtime.stop(f.ctx);
    };
    await assert.rejects(
      f.runtime.run("recall_read", { recordId: "late" }, f.tool, f.ctx),
    );
    f.runtime.start(f.ctx);
    f.node.continuity.authorizeRead = async () => {};
    writeFileSync(
      join(f.data, "manifest.json"),
      JSON.stringify({
        version: 1,
        projects: [
          { cwd: f.root, projectId: "demo" },
          { cwd: f.root, projectId: "other" },
        ],
      }),
      { mode: 0o600 },
    );
    await assert.rejects(
      f.runtime.run("recall_read", { recordId: "late" }, f.tool, f.ctx),
    );
    writeFileSync(
      join(f.data, "manifest.json"),
      JSON.stringify({
        version: 1,
        projects: [{ cwd: f.root, projectId: "unmapped-project" }],
      }),
      { mode: 0o600 },
    );
    assert.deepEqual(
      await f.runtime.run("recall_read", { recordId: "late" }, f.tool, f.ctx),
      { unavailable: true },
    ); // An ordinary unmapped project is not a guard failure; its record is absent.
    rmSync(join(f.data, "manifest.json"));
    symlinkSync(join(f.root, "missing"), join(f.data, "manifest.json"));
    await assert.rejects(
      f.runtime.run("recall_read", { recordId: "late" }, f.tool, f.ctx),
    );
    f.unhealthy();
    await assert.rejects(
      f.runtime.run("recall_read", { recordId: "late" }, f.tool, f.ctx),
    );
  } finally {
    f.clean();
  }
});
