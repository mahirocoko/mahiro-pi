import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";

const base = path.resolve(
  ".agent-state/runtime/execution-run-port/persistence",
);
fs.mkdirSync(base, { recursive: true, mode: 0o700 });
async function fixture() {
  const root = fs.mkdtempSync(path.join(base, "private-"));
  const primary = path.join(root, "primary"),
    profile = path.join(root, "profile"),
    project = path.join(root, "project");
  for (const dir of [primary, profile, project])
    fs.mkdirSync(dir, { mode: 0o700 });
  fs.cpSync(path.resolve("lib"), path.join(primary, "lib"), {
    recursive: true,
  });
  const storeURL = pathToFileURL(
    path.join(primary, "lib/execution-run/store.ts"),
  ).href;
  const modelURL = pathToFileURL(
    path.join(primary, "lib/execution-run/model.ts"),
  ).href;
  const s = await import(storeURL),
    m = await import(modelURL);
  process.env.PI_CODING_AGENT_DIR = profile;
  const configPath = path.join(
    profile,
    "extensions/mahiro-execution-run/config.json",
  );
  assert.equal(s.resolveRunBinding(project), null);
  assert.equal(fs.existsSync(path.join(profile, "workflow")), false);
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const configBytes = JSON.stringify({
    version: 1,
    profile,
    projects: [project],
  });
  fs.writeFileSync(configPath, configBytes, { mode: 0o600 });
  const b = {
    ...s.resolveRunBinding(project),
    sessionId: "native-test-session",
  };
  return {
    root,
    primary,
    profile,
    project,
    s,
    m,
    b,
    configPath,
    configBytes,
    storeURL,
    modelURL,
  };
}
const createArgs = {
  summary: "fixture",
  acceptance_criteria: ["fixture"],
  non_goals: [],
  protected_contracts: [],
  open_questions: [],
  suggested_checks: ["fixture"],
  targets: [
    {
      id: "t",
      path: "src",
      intent: "fixture",
      worktree_ref: "default",
      access: "read",
      writer_lane_id: null,
      reader_lane_ids: [],
    },
  ],
};
const saved = process.env.PI_CODING_AGENT_DIR;
test.afterEach(() => {
  if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = saved;
});

test("disabled/read-no-init, private modes, monotonic clear/recreate ABA and stale whole-state tickets", async () => {
  const { s, m, b, profile } = await fixture();
  const empty = s.readRunState(b);
  assert.equal(empty.sequence, 0);
  assert.equal(fs.existsSync(b.root), false);
  const mutate = (op: string, args: any) =>
    s.transactRun(
      b,
      s.stateTicket(s.readRunState(b)),
      () => {},
      (draft: any) => m.applyRun(draft, b, op, args),
    );
  await mutate("create", { ...createArgs, summary: "first" });
  const first = s.readRunState(b),
    old = s.stateTicket(first),
    firstId = m.runAt(first, b).id;
  await mutate("abandon", { expected_run_id: firstId, expected_revision: 1 });
  await mutate("clear", { expected_run_id: firstId, expected_revision: 2 });
  assert.equal(s.readRunState(b).sequence, 3);
  await mutate("create", { ...createArgs, summary: "second" });
  const current = s.readRunState(b);
  assert.equal(current.sequence, 4);
  assert.equal(m.runAt(current, b).revision, 1);
  assert.notEqual(m.runAt(current, b).id, firstId);
  await assert.rejects(
    s.transactRun(
      b,
      old,
      () => {},
      (draft: any) => m.applyRun(draft, b, "clear", { expected_revision: 1 }),
    ),
    /Stale/,
  );
  for (const dir of [
    profile,
    path.join(profile, "workflow"),
    path.join(profile, "workflow/execution-run"),
    b.root,
  ])
    assert.equal(fs.statSync(dir).mode & 0o7777, 0o700);
  assert.equal(
    fs.statSync(path.join(b.root, "state.json")).mode & 0o7777,
    0o600,
  );
});

test("closed native persisted schema/strict UTF8/bounds and unsafe config/state refuse without repair", async () => {
  const { s, m, b, configPath, configBytes, project, profile } =
    await fixture();
  await s.transactRun(
    b,
    s.stateTicket(s.readRunState(b)),
    () => {},
    (draft: any) =>
      m.applyRun(draft, b, "create", { ...createArgs, summary: "valid" }),
  );
  const target = path.join(b.root, "state.json"),
    bytes = fs.readFileSync(target);
  for (const bad of [
    Buffer.from([0xff, 0xfe]),
    Buffer.alloc(8 * 1024 * 1024 + 1, 32),
    Buffer.from("{ invalid"),
    Buffer.from(JSON.stringify({ schemaVersion: 2, runs: {} })),
  ]) {
    fs.writeFileSync(target, bad);
    assert.throws(() => s.readRunState(b));
    assert.deepEqual(fs.readFileSync(target), bad);
  }
  fs.writeFileSync(target, bytes);
  for (const mutate of [
    (v: any) => (v.extra = true),
    (v: any) =>
      (v.runs[b.sessionId].frame = {
        problem: "p",
        audience: "a",
        desiredOutcome: "d",
        constraints: [],
        extra: true,
      }),
    (v: any) => (v.runs[b.sessionId].research = Array(31).fill({})),
    (v: any) => (v.runs[b.sessionId].summary = "x".repeat(4001)),
    (v: any) => (v.runs[b.sessionId].agentId = "fake"),
    (v: any) => (v.runs[b.sessionId].history[0].approval = true),
  ]) {
    const draft = JSON.parse(bytes.toString());
    mutate(draft);
    fs.writeFileSync(target, JSON.stringify(draft));
    assert.throws(() => s.readRunState(b));
  }
  fs.writeFileSync(target, bytes);
  for (const mode of [0o644, 0o666]) {
    fs.chmodSync(target, mode);
    assert.throws(() => s.readRunState(b));
    fs.chmodSync(target, 0o600);
  }
  const link = path.join(b.root, "hardlink");
  fs.linkSync(target, link);
  assert.throws(() => s.readRunState(b));
  fs.unlinkSync(link);
  fs.renameSync(target, `${target}.original`);
  fs.symlinkSync(`${target}.original`, target);
  assert.throws(() => s.readRunState(b));
  fs.unlinkSync(target);
  fs.renameSync(`${target}.original`, target);
  for (const bad of [
    Buffer.from([0xff]),
    Buffer.alloc(16385, 32),
    Buffer.from(JSON.stringify({ version: 2, profile, projects: [project] })),
    Buffer.from(
      JSON.stringify({
        version: 1,
        profile,
        projects: [project],
        enabled: true,
      }),
    ),
  ]) {
    fs.writeFileSync(configPath, bad);
    assert.throws(() => s.resolveRunBinding(project));
    assert.deepEqual(fs.readFileSync(configPath), bad);
  }
  fs.writeFileSync(configPath, configBytes);
  fs.renameSync(configPath, `${configPath}.original`);
  fs.writeFileSync(configPath, configBytes, { mode: 0o600 });
  assert.throws(() => s.readRunState(b), /authority changed/);
  assert.equal(
    s.readRunState({ ...s.resolveRunBinding(project), sessionId: b.sessionId })
      .sequence,
    1,
  );
});

test("exclusive foreign lock is never stolen; queue is bounded and cancelled-before-init creates no folders", async () => {
  const { s, m, b } = await fixture();
  await assert.rejects(
    s.transactRun(
      b,
      s.stateTicket(s.readRunState(b)),
      () => {},
      () => {},
      () => {
        throw Error("cancelled before init");
      },
    ),
  );
  assert.equal(fs.existsSync(b.root), false);
  let release: (() => void) | undefined,
    calls = 0;
  const pending = Array.from({ length: 33 }, () =>
    s.transactRun(
      b,
      s.stateTicket(s.readRunState(b)),
      async () => {
        if (++calls === 1) await new Promise<void>((r) => (release = r));
      },
      (draft: any) =>
        m.applyRun(draft, b, "create", {
          ...createArgs,
          summary: "bounded queue",
        }),
    ),
  );
  const settled = Promise.allSettled(pending);
  while (!release) await new Promise((r) => setTimeout(r, 1));
  release();
  const results = await settled;
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(
    results.some(
      (r) => r.status === "rejected" && /queue bound/.test(String(r.reason)),
    ),
  );
  const lock = path.join(b.root, "state.lock"),
    foreign = JSON.stringify({ token: "foreign-live", pid: process.pid });
  fs.writeFileSync(lock, foreign, { mode: 0o600 });
  const before = fs.readFileSync(path.join(b.root, "state.json"));
  await assert.rejects(
    s.transactRun(
      b,
      s.stateTicket(s.readRunState(b)),
      () => {},
      () => {},
    ),
    /lock unavailable/,
  );
  assert.equal(fs.readFileSync(lock, "utf8"), foreign);
  assert.deepEqual(fs.readFileSync(path.join(b.root, "state.json")), before);
});

test("two real processes race one read ticket: exactly one commit, no lost update", async () => {
  const { s, m, b, storeURL, modelURL, profile, project, root } =
    await fixture();
  await s.transactRun(
    b,
    s.stateTicket(s.readRunState(b)),
    () => {},
    (draft: any) =>
      m.applyRun(draft, b, "create", { ...createArgs, summary: "race" }),
  );
  const code = `import * as s from ${JSON.stringify(storeURL)}; import * as m from ${JSON.stringify(modelURL)};
    const b = {...s.resolveRunBinding(${JSON.stringify(project)}),sessionId:${JSON.stringify(b.sessionId)}};
    const ticket=s.stateTicket(s.readRunState(b)); process.send({ready:true});
    process.once('message',async()=>{ try { await s.transactRun(b,ticket,()=>{},draft=>m.applyRun(draft,b,'update',{action:'add_blocker',summary:'process '+process.pid,expected_revision:1,expected_run_id:m.runAt(s.readRunState(b),b).id})); process.send({committed:true}); } catch(error) { process.send({committed:false,error:String(error)}); } finally { process.disconnect(); } });`;
  const children: ReturnType<typeof spawn>[] = [];
  try {
    const runs = Array.from({ length: 2 }, () => {
      const env = { ...process.env, PI_CODING_AGENT_DIR: profile };
      delete env.NODE_TEST_CONTEXT;
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", code],
        { env, stdio: ["ignore", "pipe", "pipe", "ipc"] },
      );
      children.push(child);
      const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
      timer.unref();
      child.once("exit", () => clearTimeout(timer));
      let log = "",
        outcome: any;
      child.stdout!.on("data", (d) => (log += d));
      child.stderr!.on("data", (d) => (log += d));
      const ready = new Promise<void>((resolve, reject) => {
        child.on("message", (message: any) => {
          if (message.ready) resolve();
          else outcome = message;
        });
        child.on("error", reject);
        child.once("exit", () =>
          reject(Error("owned child exited before ready")),
        );
      });
      const done = new Promise<any>((resolve, reject) => {
        child.on("exit", (status, signal) => {
          fs.writeFileSync(path.join(root, `race-${child.pid}.log`), log);
          if (status !== 0)
            reject(Error(`owned child failed ${status}/${signal}: ${log}`));
          else resolve(outcome);
        });
      });
      return { child, ready, done };
    });
    await Promise.all(runs.map((r) => r.ready));
    for (const run of runs) run.child.send!("start");
    const outcomes = await Promise.all(runs.map((r) => r.done));
    assert.equal(
      outcomes.filter((o) => o.committed).length,
      1,
      JSON.stringify(outcomes),
    );
    const state = s.readRunState(b);
    assert.equal(state.sequence, 2);
    assert.equal(m.runAt(state, b).revision, 2);
    assert.equal(m.runAt(state, b).blockers.length, 1);
    fs.writeFileSync(
      path.join(root, "two-process-receipt.json"),
      JSON.stringify(outcomes, null, 2),
    );
  } finally {
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null)
              return resolve();
            child.once("exit", () => resolve());
            child.kill("SIGKILL");
          }),
      ),
    );
  }
});

test("two processes different sessions retry fresh whole-state CAS without losing either scope", async () => {
  const { s, b, storeURL, modelURL, profile, project } = await fixture();
  const children: ReturnType<typeof spawn>[] = [];
  const code = `import * as s from ${JSON.stringify(storeURL)}; import * as m from ${JSON.stringify(modelURL)};
 const b={...s.resolveRunBinding(${JSON.stringify(project)}),sessionId:process.env.FIXTURE_SESSION};
 for(let attempt=0;attempt<30;attempt++) { try { const ticket=s.stateTicket(s.readRunState(b)); await s.transactRun(b,ticket,()=>{},d=>m.applyRun(d,b,'create',${JSON.stringify(createArgs)}));process.exit(0); } catch(e) {if(!/lock unavailable|Stale/.test(String(e)))throw e;await new Promise(r=>setTimeout(r,5));} } throw Error('bounded fixture retries exhausted');`;
  try {
    const runs = ["process-one", "process-two"].map(
      (sessionId) =>
        new Promise<void>((resolve, reject) => {
          const env = {
            ...process.env,
            PI_CODING_AGENT_DIR: profile,
            FIXTURE_SESSION: sessionId,
          };
          delete env.NODE_TEST_CONTEXT;
          const child = spawn(
            process.execPath,
            ["--input-type=module", "-e", code],
            { env, stdio: ["ignore", "pipe", "pipe"] },
          );
          children.push(child);
          let log = "";
          child.stdout!.on("data", (d) => (log += d));
          child.stderr!.on("data", (d) => (log += d));
          const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
          timer.unref();
          child.once("error", reject);
          child.once("exit", (status) => {
            clearTimeout(timer);
            status === 0 ? resolve() : reject(Error(log));
          });
        }),
    );
    await Promise.all(runs);
    const state = s.readRunState(b);
    assert.equal(state.sequence, 2);
    assert.deepEqual(Object.keys(state.runs).sort(), [
      "process-one",
      "process-two",
    ]);
  } finally {
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null)
              return resolve();
            child.once("exit", () => resolve());
            child.kill("SIGKILL");
          }),
      ),
    );
  }
});
