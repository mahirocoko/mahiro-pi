import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";

const base = path.resolve(".agent-state/runtime/ux-workflow-port/persistence");
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
    path.join(primary, "lib/ux-workflow/store.ts"),
  ).href;
  const modelURL = pathToFileURL(
    path.join(primary, "lib/ux-workflow/model.ts"),
  ).href;
  const s = await import(storeURL),
    m = await import(modelURL);
  process.env.PI_CODING_AGENT_DIR = profile;
  const configPath = path.join(
    profile,
    "extensions/mahiro-ux-workflow/config.json",
  );
  assert.equal(s.resolveUXBinding(project), null);
  assert.equal(fs.existsSync(path.join(profile, "workflow")), false);
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const configBytes = JSON.stringify({
    version: 1,
    profile,
    projects: [project],
  });
  fs.writeFileSync(configPath, configBytes, { mode: 0o600 });
  const b = {
    ...s.resolveUXBinding(project),
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
const saved = process.env.PI_CODING_AGENT_DIR;
test.afterEach(() => {
  if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = saved;
});

test("disabled/read-no-init, private modes, monotonic clear/recreate ABA and stale whole-state tickets", async () => {
  const { s, m, b, profile } = await fixture();
  const empty = s.readUXState(b);
  assert.equal(empty.sequence, 0);
  assert.equal(fs.existsSync(b.root), false);
  const mutate = (op: string, args: any) =>
    s.transactUX(
      b,
      s.stateTicket(s.readUXState(b)),
      () => {},
      (draft: any) => m.applyUX(draft, b, op, args),
    );
  await mutate("create", { summary: "first" });
  const first = s.readUXState(b),
    old = s.stateTicket(first),
    firstId = m.runAt(first, b).id;
  await mutate("clear", { expected_revision: 1 });
  assert.equal(s.readUXState(b).sequence, 2);
  await mutate("create", { summary: "second" });
  const current = s.readUXState(b);
  assert.equal(current.sequence, 3);
  assert.equal(m.runAt(current, b).revision, 1);
  assert.notEqual(m.runAt(current, b).id, firstId);
  await assert.rejects(
    s.transactUX(
      b,
      old,
      () => {},
      (draft: any) => m.applyUX(draft, b, "clear", { expected_revision: 1 }),
    ),
    /Stale/,
  );
  for (const dir of [
    profile,
    path.join(profile, "workflow"),
    path.join(profile, "workflow/ux-workflow"),
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
  await s.transactUX(
    b,
    s.stateTicket(s.readUXState(b)),
    () => {},
    (draft: any) => m.applyUX(draft, b, "create", { summary: "valid" }),
  );
  const target = path.join(b.root, "state.json"),
    bytes = fs.readFileSync(target);
  for (const bad of [
    Buffer.from([0xff, 0xfe]),
    Buffer.alloc(2 * 1024 * 1024 + 1, 32),
    Buffer.from("{ invalid"),
    Buffer.from(JSON.stringify({ schemaVersion: 2, runs: {} })),
  ]) {
    fs.writeFileSync(target, bad);
    assert.throws(() => s.readUXState(b));
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
    assert.throws(() => s.readUXState(b));
  }
  fs.writeFileSync(target, bytes);
  for (const mode of [0o644, 0o666]) {
    fs.chmodSync(target, mode);
    assert.throws(() => s.readUXState(b));
    fs.chmodSync(target, 0o600);
  }
  const link = path.join(b.root, "hardlink");
  fs.linkSync(target, link);
  assert.throws(() => s.readUXState(b));
  fs.unlinkSync(link);
  fs.renameSync(target, `${target}.original`);
  fs.symlinkSync(`${target}.original`, target);
  assert.throws(() => s.readUXState(b));
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
    assert.throws(() => s.resolveUXBinding(project));
    assert.deepEqual(fs.readFileSync(configPath), bad);
  }
  fs.writeFileSync(configPath, configBytes);
  fs.renameSync(configPath, `${configPath}.original`);
  fs.writeFileSync(configPath, configBytes, { mode: 0o600 });
  assert.throws(() => s.readUXState(b), /authority changed/);
  assert.equal(
    s.readUXState({ ...s.resolveUXBinding(project), sessionId: b.sessionId })
      .sequence,
    1,
  );
});

test("exclusive foreign lock is never stolen; queue is bounded and cancelled-before-init creates no folders", async () => {
  const { s, m, b } = await fixture();
  await assert.rejects(
    s.transactUX(
      b,
      s.stateTicket(s.readUXState(b)),
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
    s.transactUX(
      b,
      s.stateTicket(s.readUXState(b)),
      async () => {
        if (++calls === 1) await new Promise<void>((r) => (release = r));
      },
      (draft: any) =>
        m.applyUX(draft, b, "create", { summary: "bounded queue" }),
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
    s.transactUX(
      b,
      s.stateTicket(s.readUXState(b)),
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
  await s.transactUX(
    b,
    s.stateTicket(s.readUXState(b)),
    () => {},
    (draft: any) => m.applyUX(draft, b, "create", { summary: "race" }),
  );
  const code = `import * as s from ${JSON.stringify(storeURL)}; import * as m from ${JSON.stringify(modelURL)};
    const b = {...s.resolveUXBinding(${JSON.stringify(project)}),sessionId:${JSON.stringify(b.sessionId)}};
    const ticket=s.stateTicket(s.readUXState(b)); process.send({ready:true});
    process.once('message',async()=>{ try { await s.transactUX(b,ticket,()=>{},draft=>m.applyUX(draft,b,'update',{action:'add_blocker',summary:'process '+process.pid,expected_revision:1})); process.send({committed:true}); } catch(error) { process.send({committed:false,error:String(error)}); } finally { process.disconnect(); } });`;
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
    const state = s.readUXState(b);
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
