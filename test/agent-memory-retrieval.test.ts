import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  createMemoryStore,
  type MemoryFile,
} from "../lib/agent-memory/store.ts";
import {
  memoryReadSchema,
  parseMemoryRead,
  retrieveMemory,
  retrievalLimits,
} from "../lib/agent-memory/retrieval.ts";
import { bytes, digest } from "../lib/continuity/records.ts";

process.env.GIT_AUTHOR_NAME = "Fictional retrieval fixture";
process.env.GIT_AUTHOR_EMAIL = "fixture@example.invalid";
process.env.GIT_COMMITTER_NAME = "Fictional retrieval fixture";
process.env.GIT_COMMITTER_EMAIL = "fixture@example.invalid";
const parent = new URL("../.agent-state/runtime/", import.meta.url).pathname;
function fixture() {
  const dir = mkdtempSync(join(parent, "memory-retrieval-"));
  const root = join(dir, "memory");
  const cwd = join(dir, "project");
  mkdirSync(cwd);
  let available = true;
  const store = createMemoryStore(
    root,
    () => {
      if (!available) throw new Error("Revoked fixture authority");
    },
    "primary",
  );
  store.initialize(
    {
      version: 1,
      projects: [{ cwd, id: "project" }],
      coreBytes: 8192,
      indexBytes: 2048,
      fileBytes: 262144,
      totalBytes: 8388608,
      automatic: false,
    },
    "# Core\nFictional established identity.\n",
  );
  const seed = store.createView("project", 120000, true);
  for (const [path, text, sources] of [
    [
      "global/compass.md",
      "# Fictional compass\nCurrent owner says violet; an old quote says amber.\n",
      ["fictional-source"],
    ],
    [
      "deferred/foreign/hidden.md",
      "# Fictional foreign\nThe zephyr planet is green.\n",
      ["foreign-source"],
    ],
    [
      "deferred/project/local.md",
      "# Fictional local\nA violet compass.\n",
      ["local-source"],
    ],
  ] as const)
    store.edit(seed, path, null, text, [...sources]);
  store.integrate(seed);
  return {
    root,
    dir,
    store,
    revoke: () => {
      available = false;
    },
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}
const select = (args: unknown) => {
  const s = parseMemoryRead(args);
  assert.ok(s.mode === "topic" || s.mode === "query");
  return s;
};
test("selector parser retains legacy modes and rejects mixed, invalid, oversized or unbounded modes", () => {
  assert.deepEqual(parseMemoryRead({}), { mode: "list" });
  assert.deepEqual(parseMemoryRead({ path: "Core.md" }), {
    mode: "path",
    path: "Core.md",
    offset: 0,
    limit: 4096,
  });
  assert.ok(memoryReadSchema.oneOf.length === 4);
  for (const args of [
    null,
    [],
    { root: "/foreign" },
    { offset: 0 },
    { path: "Core.md", query: "violet" },
    { query: "violet", topic: "*" },
    { topic: "*", limit: 33 },
    { query: "violet", limit: 9 },
    { query: "violet", offset: -1 },
    { query: "violet", offset: 0.5 },
    { query: "😀" },
    { query: "..." },
    { query: "ไทย".repeat(100) },
    { query: "x\ny" },
    { query: Array.from({ length: 17 }, (_, i) => `term${i}`).join(" ") },
    { topic: "deferred/../other" },
    { topic: "core" },
  ])
    assert.throws(() => parseMemoryRead(args), /Invalid|Selector|mutually/);
});
test("paging defaults only undefined values; all selectors reject explicit null against integer schema", () => {
  for (const selector of [
    { path: "Core.md" },
    { query: "violet" },
    { topic: "*" },
  ]) {
    for (const key of ["offset", "limit"] as const) {
      assert.equal(memoryReadSchema.properties[key].type, "integer");
      assert.throws(
        () => parseMemoryRead({ ...selector, [key]: null }),
        /Invalid memory read paging/,
      );
      assert.deepEqual(
        parseMemoryRead({ ...selector, [key]: undefined }),
        parseMemoryRead(selector),
      );
    }
  }
});
test("literal English/Thai/multiword/path search gives late original Unicode excerpts, not normalized offsets", () => {
  const text = `# Fictional\n${"prefix 😀 ".repeat(800)}Cafe\u0301 İSTANBUL 😀 ชอบกาแฟเย็น violet compass\n`;
  const files = {
    "global/thai-compass.md": { text, sources: ["fictional-untrusted-quote"] },
  };
  for (const query of [
    "VIOLET compass",
    "ชอบกาแฟเย็น",
    "global thai compass",
    "café",
    "i\u0307stanbul",
  ]) {
    const r = retrieveMemory(files, select({ query }));
    assert.equal(r.complete, true);
    assert.equal(r.results!.length, 1, query);
    const hit = r.results![0];
    assert.equal(hit.hash, digest(text));
    assert.deepEqual(hit.sources, ["fictional-untrusted-quote"]);
    assert.equal(
      hit.text,
      [...text]
        .slice(hit.offset, hit.offset + retrievalLimits.snippetCharacters)
        .join(""),
    );
    if (!query.startsWith("global")) {
      assert.ok(hit.offset > 1000, query);
      assert.match(hit.text, /Cafe\u0301/);
    }
  }
  const miss = retrieveMemory(files, select({ query: "nonexistent" }));
  assert.equal(miss.outcome, "no-match");
  assert.equal(miss.complete, true);
  assert.deepEqual(
    retrieveMemory(files, select({ query: "compass missing" })).results,
    [],
  );
});
test("bounded work/result/output pages distinguish incomplete coverage from successful no-match", () => {
  const files: Record<string, MemoryFile> = {};
  for (let i = 0; i < 12; i++)
    files[`global/f${i.toString().padStart(2, "0")}.md`] = {
      text: `${"x".repeat(250000)}\nlate violet\n`,
      sources: Array.from({ length: 32 }, (_, s) => `แ${s}${"ก".repeat(150)}`),
    };
  let offset = 0;
  const found: string[] = [];
  for (let page = 0; page < 20; page++) {
    const result = retrieveMemory(files, select({ query: "violet", offset }));
    assert.ok(
      bytes(JSON.stringify(result)) < retrievalLimits.outputBytes - 1024,
    );
    assert.ok(result.workBytes! <= retrievalLimits.workBytes);
    found.push(...result.results!.map((r) => r.path));
    if (result.complete) break;
    assert.equal(result.outcome, "incomplete");
    assert.ok(result.nextOffset! > offset);
    offset = result.nextOffset!;
  }
  assert.equal(found.length, 12);
  assert.equal(new Set(found).size, 12);
  const miss = retrieveMemory(files, select({ query: "absent" }));
  assert.equal(miss.outcome, "incomplete");
  assert.ok(miss.nextOffset! > 0);
  const final = retrieveMemory(files, select({ query: "absent", offset: 12 }));
  assert.equal(final.outcome, "no-match");
});
test("old-view path/source forgetting blocks query/topic/list metadata and retains unchanged proposal bytes", () => {
  for (const source of [false, true]) {
    const f = fixture();
    try {
      const a = f.store.createView("project", 120000, true);
      const before = readFileSync(join(f.root, ".views", `${a.id}.json`));
      const b = createMemoryStore(f.root).createView("project");
      f.store.forget(
        b.base.revision,
        source ? [] : ["global/compass.md"],
        source ? ["fictional-source"] : [],
        "project",
      );
      for (const args of [
        { query: "violet" },
        { topic: "*" },
        { topic: "" },
        { topic: "global" },
      ])
        assert.throws(
          () =>
            f.store.inspect(a, (files) => retrieveMemory(files, select(args))),
          /unavailable.*forgotten/,
        );
      assert.throws(
        () => f.store.inspect(a, (files) => ({ files: Object.keys(files) })),
        /unavailable.*forgotten/,
      );
      assert.deepEqual(
        readFileSync(join(f.root, ".views", `${a.id}.json`)),
        before,
      );
      assert.equal(a.state, "open");
      assert.ok(
        "conflict" in
          (() => {
            f.store.edit(
              a,
              "global/compass.md",
              digest(a.files["global/compass.md"].text),
              "# Violet proposal\n",
              ["fictional-source"],
            );
            return f.store.integrate(a);
          })(),
      );
    } finally {
      f.close();
    }
  }
});
test("shared Primary discovers foreign topics but scoped legacy and leased-shaped views reveal no foreign metadata", () => {
  const f = fixture();
  try {
    const primary = f.store.createView("project", 120000, true);
    const scoped = createMemoryStore(f.root).createView("project");
    const p = f.store.inspect(primary, (files) =>
      retrieveMemory(files, select({ query: "zephyr" })),
    );
    assert.equal(p.results!.length, 1);
    for (const args of [
      { query: "zephyr" },
      { topic: "deferred/foreign" },
      { topic: "" },
      { topic: "*" },
    ]) {
      const local = f.store.inspect(scoped, (files) =>
        retrieveMemory(files, select(args)),
      );
      assert.doesNotMatch(
        JSON.stringify({ entries: local.entries, results: local.results }),
        /foreign|zephyr|hidden\.md/,
      );
    }
  } finally {
    f.close();
  }
});
test("draft query/path coherence and moved HEAD/rollback are explicit, never discarded or relabeled current truth", () => {
  const f = fixture();
  try {
    const a = f.store.createView("project", 120000, true);
    const text = "# Draft\nA silver fictional compass.\n";
    f.store.edit(
      a,
      "global/compass.md",
      digest(a.files["global/compass.md"].text),
      text,
      ["draft-source"],
    );
    const b = f.store.createView("project");
    f.store.edit(
      b,
      "procedures/separate.md",
      null,
      "# Separate\nA fictional disjoint change.\n",
    );
    const moved = f.store.integrate(b);
    const result = f.store.inspect(a, (files) =>
      retrieveMemory(files, select({ query: "silver" })),
    );
    const path = f.store.read(a, "global/compass.md");
    assert.equal(result.basis, "private-draft");
    assert.equal(result.freshness, "stale");
    assert.equal(result.baseRevision, a.base.revision);
    assert.equal(result.currentRevision, moved.revision);
    assert.equal(result.results![0].hash, path.hash);
    assert.equal(result.results![0].text, path.text);
    assert.deepEqual(result.results![0].sources, path.sources);
    f.store.rollback(moved.revision!, a.base.revision, "project");
    assert.equal(f.store.read(a, "global/compass.md").text, text);
    assert.ok("revision" in f.store.integrate(a));
  } finally {
    f.close();
  }
});
test("512-file progressive discovery is bounded, pageable and includes omitted foreign Primary topics without view hydration", (t) => {
  const f = fixture();
  try {
    const seed = f.store.createView("project", 120000, true);
    seed.files = {
      "Core.md": seed.files["Core.md"],
      "index.md": seed.files["index.md"],
    };
    for (let i = 0; i < 510; i++) {
      const path = `deferred/p${Math.floor(i / 4)
        .toString()
        .padStart(3, "0")}/file${i}.md`;
      seed.files[path] = {
        text: `# Fictional file ${i}\nNot projected body.\n`,
        sources: [],
      };
    }
    for (const [path, file] of Object.entries(seed.files)) {
      const full = join(f.root, ".views", seed.id, path);
      mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
      writeFileSync(full, file.text, { mode: 0o600 });
    }
    writeFileSync(
      join(f.root, ".views", `${seed.id}.json`),
      `${JSON.stringify(seed)}\n`,
      { mode: 0o600 },
    );
    f.store.integrate(seed);
    const start = performance.now();
    const p = createMemoryStore(
      f.root,
      (path) => {
        if (path?.includes("/.views"))
          throw new Error("Projection hydrated a view");
      },
      "primary",
    ).projection("project", true);
    assert.equal(p.discovery.version, 2);
    assert.equal(p.discovery.topics.length, 8);
    assert.equal(p.discovery.totalTopics, 128);
    assert.equal(p.discovery.nextOffset, 8);
    assert.ok(bytes(JSON.stringify(p)) < 2048);
    assert.doesNotMatch(JSON.stringify(p), /file509|Not projected body/);
    const view = f.store.createView("project", 120000, true);
    const paths: string[] = [];
    for (let offset = 0; ; ) {
      const page = f.store.inspect(view, (files) =>
        retrieveMemory(files, select({ topic: "*", offset })),
      );
      paths.push(
        ...page.entries!.map((entry) => (entry as { path: string }).path),
      );
      if (page.complete) break;
      offset = page.nextOffset!;
    }
    assert.equal(paths.length, 512);
    assert.equal(new Set(paths).size, 512);
    assert.ok(paths.includes("deferred/p127/file509.md"));
    const late = f.store.inspect(view, (files) =>
      retrieveMemory(files, select({ topic: "", offset: 120 })),
    );
    assert.ok(
      late.entries!.some(
        (entry) => (entry as { topic: string }).topic === "deferred/p127",
      ),
    );
    const scoped = createMemoryStore(f.root).projection("project");
    assert.equal(scoped.discovery.totalTopics, 0);
    t.diagnostic(
      JSON.stringify({
        files: paths.length,
        projectionBytes: bytes(JSON.stringify(p)),
        topics: p.discovery.totalTopics,
        initialTopics: 8,
        elapsedMs: Math.round(performance.now() - start),
      }),
    );
  } finally {
    f.close();
  }
});

test("final config I/O and authority callbacks cannot return forgotten content or discovery; proposals survive", (t) => {
  // Observe real descriptor-based private reads, not a replacement config/authority
  // implementation. The independent mutator uses the production store throughout.
  const descriptors = new Map<number, unknown>();
  const open = fs.openSync;
  const close = fs.closeSync;
  const read = fs.readFileSync;
  let afterConfig: ((path: unknown) => void) | undefined;
  t.mock.method(fs, "openSync", function (path, ...args) {
    const fd = open(path, ...args);
    descriptors.set(fd, path);
    return fd;
  });
  t.mock.method(fs, "closeSync", function (fd, ...args) {
    descriptors.delete(fd);
    return close(fd, ...args);
  });
  t.mock.method(fs, "readFileSync", function (path, ...args) {
    const value = read(path, ...args);
    afterConfig?.(typeof path === "number" ? descriptors.get(path) : path);
    return value;
  });
  syncBuiltinESMExports();
  try {
    for (const boundary of ["config", "authority"] as const) {
      for (const mode of [
        "path",
        "list",
        "query",
        "topic",
        "projection",
      ] as const) {
        const f = fixture();
        try {
          const view = f.store.createView("project", 120000, true);
          f.store.edit(
            view,
            "procedures/proposal.md",
            null,
            "# Retain proposal\n",
          );
          const proposal = readFileSync(
            join(f.root, ".views", `${view.id}.json`),
          );
          let count = 0;
          let target = -1;
          let armed = false;
          let mutating = false;
          let changed = false;
          const observe = () => {
            if (mutating) return;
            const index = count++;
            if (!armed || index !== target) return;
            mutating = true;
            try {
              f.store.forget(
                view.base.revision,
                [],
                ["fictional-source"],
                "project",
              );
              changed = true;
            } finally {
              mutating = false;
            }
          };
          const reader =
            boundary === "authority"
              ? createMemoryStore(f.root, observe, "primary")
              : f.store;
          afterConfig =
            boundary === "config"
              ? (path) => {
                  if (path === join(f.root, "config.json")) observe();
                }
              : undefined;
          const call = () => {
            if (mode === "projection")
              return reader.projection("project", true);
            if (mode === "path") return reader.read(view, "global/compass.md");
            return reader.inspect(view, (files) =>
              mode === "list"
                ? { files: Object.keys(files) }
                : retrieveMemory(
                    files,
                    select(
                      mode === "query" ? { query: "violet" } : { topic: "" },
                    ),
                  ),
            );
          };
          call();
          target = count - 1;
          assert.ok(target >= 0);
          count = 0;
          armed = true;
          assert.throws(
            call,
            /unavailable.*(revision|state) changed/,
            `${boundary}/${mode}`,
          );
          afterConfig = undefined;
          assert.equal(
            changed,
            true,
            `${boundary}/${mode}: last validation reached`,
          );
          assert.notEqual(f.store.snapshot().revision, view.base.revision);
          assert.deepEqual(
            readFileSync(join(f.root, ".views", `${view.id}.json`)),
            proposal,
          );
          assert.equal(view.state, "open");
        } finally {
          afterConfig = undefined;
          f.close();
        }
      }
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("return-boundary HEAD/config/backing/authority changes fail closed without changing proposals", () => {
  for (const change of [
    "head",
    "forget",
    "config",
    "backing",
    "authority",
    "deadline",
    "cancel",
  ] as const) {
    const f = fixture();
    try {
      const a = f.store.createView("project", 120000, true);
      const raw = readFileSync(join(f.root, ".views", `${a.id}.json`));
      assert.throws(
        () =>
          f.store.inspect(a, (files) => {
            const result = retrieveMemory(files, select({ query: "violet" }));
            if (change === "head") {
              const b = f.store.createView("project");
              f.store.edit(b, "procedures/race.md", null, "# Fictional race\n");
              f.store.integrate(b);
            } else if (change === "forget")
              f.store.forget(
                a.base.revision,
                [],
                ["fictional-source"],
                "project",
              );
            else if (change === "config") {
              const path = join(f.root, "config.json");
              const c = JSON.parse(readFileSync(path, "utf8"));
              writeFileSync(
                path,
                JSON.stringify({ ...c, automatic: !c.automatic }),
              );
            } else if (change === "backing")
              writeFileSync(
                join(f.root, ".views", a.id, "global/compass.md"),
                "# Tampered\n",
              );
            else if (change === "authority") f.revoke();
            else if (change === "deadline") a.deadline = Date.now() - 1;
            else f.store.cancel(a);
            return result;
          }),
        /unavailable|inactive|externally|Revoked|Stale/,
      );
      if (change !== "cancel")
        assert.deepEqual(
          readFileSync(join(f.root, ".views", `${a.id}.json`)),
          raw,
        );
    } finally {
      f.close();
    }
  }
});
