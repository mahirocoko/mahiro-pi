import assert from "node:assert/strict";
import test from "node:test";
import {
  readHistory,
  historyCandidates,
  searchHistory,
  validateHistoryManifest,
  type IHistoryManifest,
} from "../lib/continuity/history-reader.ts";
import {
  bytes,
  digest,
  normalize,
  search,
  type IArchive,
} from "../lib/continuity/records.ts";

const policy = {
  excludedProjectIds: ["excludedproject", "excluded-frontend"],
  excludedPaths: [],
};
const scope = { projectId: "demo" };
const root = "/fixtures/history";
const archive = (
  id: string,
  projectId: string | null = "demo",
  text = "Historical lexical evidence",
) =>
  normalize(
    [
      {
        id,
        projectId,
        sourceKind: "letta_message",
        agentId: "agent",
        conversationId: "conversation",
        messageId: id,
        message: { message_type: "user_message", content: text },
      },
    ],
    { excludedProjectIds: [], excludedPaths: [] },
  );

const fixture = (archives: IArchive[]) => {
  const files = new Map<string, string>();
  const calls: { path: string; max: number }[] = [];
  const manifest: IHistoryManifest = {
    version: 1,
    kind: "sanitized-letta-visible-history",
    shards: archives.map((value) => {
      const text = JSON.stringify(value);
      const hash = digest(text);
      files.set(`${root}/${hash}.json`, text);
      return {
        hash,
        bytes: bytes(text),
        projectId: value.records.length ? value.records[0].projectId : "demo",
      };
    }),
  };
  const save = () =>
    files.set(`${root}/manifest.json`, JSON.stringify(manifest));
  save();
  const access = {
    root,
    read: async (path: string, max: number) => {
      calls.push({ path, max });
      const text = files.get(path);
      if (text === undefined) throw new Error("PRIVATE-READER-DETAIL");
      return text;
    },
  };
  return { access, files, calls, manifest, save };
};
const rejects = async (run: () => Promise<unknown>) =>
  assert.rejects(run, { message: "Invalid historical continuity data" });

test("canonical late Latin/Thai recall and exact hidden-aware read", async () => {
  const f = fixture([
    archive("early", "demo", "unrelated material"),
    archive("late-latin", "demo", "Rareword historical evidence"),
    archive("late-thai", "demo", "ประวัติการทำงานภาษาไทย"),
  ]);
  assert.equal(
    (await searchHistory(f.access, policy, "Rareword", scope))[0].recordId,
    "late-latin",
  );
  assert.equal(
    (await searchHistory(f.access, policy, "ภาษาไทย", scope))[0].recordId,
    "late-thai",
  );
  assert.equal(
    (await readHistory(f.access, policy, "late-latin", scope))?.evidence,
    "imported-untrusted",
  );
  assert.equal(
    await readHistory(
      f.access,
      policy,
      "late-latin",
      scope,
      new Set(["late-latin"]),
    ),
    undefined,
  );
  assert.deepEqual(
    await searchHistory(
      f.access,
      policy,
      "Rareword",
      scope,
      new Set(["late-latin"]),
    ),
    [],
  );
  assert.equal(await readHistory(f.access, policy, "absent", scope), undefined);
  assert.ok(
    f.calls.every(({ max }) => max === 1024 * 1024 || max === 8 * 1024 * 1024),
  );
});

test("project, global and explicit cross-project scopes skip off-scope I/O", async () => {
  const f = fixture([
    archive("local"),
    archive("other", "elsewhere"),
    archive("global", null),
  ]);
  const paths = () => f.calls.map(({ path }) => path);
  assert.equal(
    (await searchHistory(f.access, policy, "evidence", scope)).length,
    1,
  );
  assert.ok(!paths().includes(`${root}/${f.manifest.shards[1].hash}.json`));
  assert.ok(!paths().includes(`${root}/${f.manifest.shards[2].hash}.json`));
  assert.equal(
    (
      await searchHistory(f.access, policy, "evidence", {
        ...scope,
        includeGlobal: true,
      })
    ).length,
    2,
  );
  assert.equal(
    (
      await searchHistory(f.access, policy, "evidence", {
        ...scope,
        crossProject: true,
      })
    ).length,
    2,
  );
  assert.equal(
    (
      await searchHistory(f.access, policy, "evidence", {
        ...scope,
        crossProject: true,
        includeGlobal: true,
      })
    ).length,
    3,
  );
});

test("manifest exact schema, hashes, positive finite byte bounds and array bounds", () => {
  const f = fixture([archive("valid")]);
  assert.deepEqual(validateHistoryManifest(f.manifest), f.manifest);
  const invalid = [
    null,
    [],
    { ...f.manifest, version: 2 },
    { ...f.manifest, kind: "native-pi" },
    { ...f.manifest, filename: "../escape" },
    { ...f.manifest, shards: [...f.manifest.shards, ...f.manifest.shards] },
    { ...f.manifest, shards: Array(4097).fill(f.manifest.shards[0]) },
    Object.assign(Object.create({ inherited: true }), f.manifest),
    ...["../escape", "A".repeat(64), "a".repeat(63)].map((hash) => ({
      ...f.manifest,
      shards: [{ ...f.manifest.shards[0], hash }],
    })),
    ...[0, -1, NaN, Infinity, 1.5, 8 * 1024 * 1024 + 1].map((size) => ({
      ...f.manifest,
      shards: [{ ...f.manifest.shards[0], bytes: size }],
    })),
    {
      ...f.manifest,
      shards: [{ ...f.manifest.shards[0], projectId: "../escape" }],
    },
    { ...f.manifest, shards: [{ ...f.manifest.shards[0], name: "escape" }] },
  ];
  for (const value of invalid)
    assert.throws(() => validateHistoryManifest(value), /Invalid historical/);
});

test("root must already be canonical absolute; no reader call on invalid roots", async () => {
  for (const invalidRoot of [
    "relative",
    "/fixtures/../history",
    "/fixtures/./history",
    "/fixtures//history",
    "/fixtures/history/",
    "/fixtures/\0history",
    "/fixtures/\\history",
  ]) {
    const f = fixture([]);
    await rejects(() =>
      searchHistory({ ...f.access, root: invalidRoot }, policy, "word", scope),
    );
    assert.equal(f.calls.length, 0);
  }
});

test("shard digest and UTF8 length verified before parse; reader errors sanitized", async () => {
  for (const corrupt of ["not JSON PRIVATE-PARSE-DETAIL", "{}", "ภาษาไทย"]) {
    const f = fixture([archive("valid")]);
    f.files.set(`${root}/${f.manifest.shards[0].hash}.json`, corrupt);
    await rejects(() => searchHistory(f.access, policy, "word", scope));
  }
  const f = fixture([archive("valid")]);
  f.manifest.shards[0].bytes++;
  f.save();
  await rejects(() => readHistory(f.access, policy, "valid", scope));
  await rejects(() =>
    searchHistory(
      {
        root,
        read: async () => {
          throw new Error("symlink PRIVATE");
        },
      },
      policy,
      "word",
      scope,
    ),
  );
  await rejects(() =>
    searchHistory({ root, read: async () => "{" }, policy, "word", scope),
  );
});

test("untrusted archives fail closed on secrets, metadata, schema, roles, project and prototypes", async () => {
  const mutations: ((a: IArchive) => void)[] = [
    (a) => {
      a.records[0].text = "-----BEGIN PRIVATE KEY-----";
      a.records[0].hash = digest(a.records[0].text);
    },
    (a) => {
      a.records[0].agentId = "sk-" + "Z".repeat(24);
    },
    (a) => {
      a.records[0].conversationId = "EXCLUDEDPROJECT";
    },
    (a) => {
      a.records[0].text = "Historical EXCLUDED-FRONTEND evidence";
      a.records[0].hash = digest(a.records[0].text);
    },
    (a) => {
      a.quarantine.push({
        id: "ExcludedProject",
        reason: "automated-or-empty",
      });
    },
    (a) => {
      a.records[0].projectId = "elsewhere";
    },
    (a) => {
      a.records[0].sourceKind = "pi_message";
    },
    (a) => {
      a.records[0].authority = "imported-memory";
    },
    (a) => {
      a.records[0].hash = "0".repeat(64);
    },
    (a) => {
      Object.assign(a.records[0], { unknown: "field" });
    },
    (a) => {
      Object.defineProperty(a.records[0], "__proto__", {
        value: {},
        enumerable: true,
      });
    },
    (a) => {
      a.records = Array(10001).fill(a.records[0]);
    },
  ];
  for (const mutate of mutations) {
    const a = archive("invalid");
    mutate(a);
    const f = fixture([a]);
    f.manifest.shards[0].projectId = "demo";
    f.save();
    await rejects(() => searchHistory(f.access, policy, "evidence", scope));
  }
  for (const project of ["ExcludedProject", "EXCLUDED-FRONTEND"]) {
    const f = fixture([archive("excluded", project)]);
    await rejects(() =>
      searchHistory(f.access, policy, "evidence", {
        ...scope,
        crossProject: true,
      }),
    );
    assert.equal(f.calls.length, 1);
  }
});

test("late failure is atomic for search/read; all duplicate IDs strictly rejected", async () => {
  const f = fixture([archive("found"), archive("late")]);
  f.files.delete(`${root}/${f.manifest.shards[1].hash}.json`);
  await rejects(() => searchHistory(f.access, policy, "evidence", scope));
  await rejects(() => readHistory(f.access, policy, "found", scope));
  for (const text of ["Historical lexical evidence", "conflicting evidence"]) {
    const first = archive("duplicate");
    const second = archive("duplicate", "demo", text);
    // Distinct archive serialization permits an identical-record duplicate fixture.
    second.quarantine.push({ id: "quarantined", reason: "automated-or-empty" });
    const duplicate = fixture([first, second]);
    await rejects(() =>
      searchHistory(duplicate.access, policy, "evidence", scope),
    );
    await rejects(() =>
      readHistory(
        duplicate.access,
        policy,
        "duplicate",
        scope,
        new Set(["duplicate"]),
      ),
    );
  }
});

test("selected declared budget fails before shard I/O, not off-scope declarations", async () => {
  const f = fixture([]);
  f.manifest.shards = Array.from({ length: 33 }, (_, i) => ({
    hash: digest(String(i)),
    bytes: 8 * 1024 * 1024,
    projectId: "demo",
  }));
  f.save();
  await rejects(() => searchHistory(f.access, policy, "word", scope));
  assert.equal(f.calls.length, 1);
  f.calls.length = 0;
  f.manifest.shards.forEach((shard) => {
    shard.projectId = "elsewhere";
  });
  f.save();
  assert.deepEqual(await searchHistory(f.access, policy, "word", scope), []);
  assert.equal(f.calls.length, 1);
});

test("sequential bounded candidate reduction matches canonical full-corpus scorer", async () => {
  const archives = Array.from({ length: 12 }, (_, shard) => {
    const result: IArchive = { records: [], quarantine: [] };
    for (let i = 0; i < 12; i++) {
      const a = archive(
        `rank-${shard}-${i}`,
        "demo",
        i === 11 ? "alpha beta gamma" : "alpha",
      );
      if (i % 2 === 0) a.records[0].authority = "historical-assistant";
      result.records.push(...a.records);
    }
    return result;
  });
  const f = fixture(archives);
  let active = 0;
  let peak = 0;
  const guarded = {
    root,
    read: async (path: string, max: number) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      try {
        return await f.access.read(path, max);
      } finally {
        active--;
      }
    },
  };
  const expected = search(
    archives.flatMap((a) => a.records),
    "alpha beta gamma",
    scope,
    { count: 6, perResultBytes: 1024, totalBytes: 6144 },
  );
  assert.deepEqual(
    await searchHistory(guarded, policy, "alpha beta gamma", scope),
    expected,
  );
  assert.equal(peak, 1);
  const candidates = await historyCandidates(
    f.access,
    policy,
    "alpha beta gamma",
    scope,
  );
  assert.ok(candidates.length <= 6);
  assert.deepEqual(
    search(candidates, "alpha beta gamma", scope, {
      count: 6,
      perResultBytes: 1024,
      totalBytes: 6144,
    }),
    expected,
  );
  for (const candidate of candidates)
    assert.deepEqual(
      candidate,
      JSON.parse(
        JSON.stringify(
          archives
            .flatMap((a) => a.records)
            .find((record) => record.id === candidate.id),
        ),
      ),
    );
});

test("manifest read bounded; result caps preserve lexical ranking and UNTRUSTED citations", async () => {
  const f = fixture(
    Array.from({ length: 20 }, (_, i) =>
      archive(
        `r-${i.toString().padStart(2, "0")}`,
        "demo",
        `word ${"ไทย".repeat(2000)}`,
      ),
    ),
  );
  const hits = await searchHistory(f.access, policy, "word", scope);
  assert.equal(hits.length, 6);
  assert.deepEqual(
    hits.map((h) => h.recordId),
    ["r-00", "r-01", "r-02", "r-03", "r-04", "r-05"],
  );
  assert.ok(bytes(JSON.stringify(hits)) <= 6144);
  assert.ok(
    hits.every(
      (h) => bytes(JSON.stringify(h)) <= 1024 && h.evidence === "UNTRUSTED",
    ),
  );
  f.files.set(`${root}/manifest.json`, " ".repeat(1024 * 1024 + 1));
  await rejects(() => searchHistory(f.access, policy, "word", scope));
});
