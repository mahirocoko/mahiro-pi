import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { fixture, saveEnv } from "./evidence-fixture.ts";
const child = (file: string) =>
  new Promise<{ code: number | null; out: string }>((done, reject) => {
    const process = spawn(globalThis.process.execPath, [file], {
      env: globalThis.process.env,
    });
    let out = "";
    process.stdout.on("data", (data) => (out += data));
    process.stderr.on("data", (data) => (out += data));
    process.on("error", reject);
    process.on("close", (code) => done({ code, out }));
  });
test("private read-only empty; whole-envelope CAS empty/create-clear ABA and exact native scopes", async () => {
  const restore = saveEnv();
  try {
    const f = await fixture(),
      { s, m, b } = f,
      empty = s.stateTicket(s.readEvidenceState(b));
    assert.equal(fs.existsSync(b.root), false);
    assert.equal(fs.existsSync(path.join(f.project, ".git")), false);
    await f.seed();
    assert.equal(fs.existsSync(path.join(f.project, ".git")), false);
    assert.equal(m.reportAt(s.readEvidenceState(b), b).revision, 1);
    assert.equal(
      m.reportAt(s.readEvidenceState(b), {
        ...b,
        sessionId: "other-native-session",
      }),
      null,
    );
    const clear = (draft: any) =>
      delete draft.reports[m.scopeKey(b.profile, b.sessionId, b.project)];
    await s.transactEvidence(
      b,
      s.stateTicket(s.readEvidenceState(b)),
      () => {},
      clear,
    );
    assert.equal(s.readEvidenceState(b).sequence, 2);
    await assert.rejects(
      s.transactEvidence(
        b,
        empty,
        () => {},
        () => {},
      ),
      /Stale/,
    );
    await f.seed();
    assert.equal(m.reportAt(s.readEvidenceState(b), b).revision, 1);
    assert.equal(fs.statSync(f.target).mode & 0o777, 0o600);
    assert.equal(fs.statSync(b.root).mode & 0o777, 0o700);
    fs.unlinkSync(f.config);
    assert.throws(() => s.readEvidenceState(b), /authority/);
  } finally {
    restore();
  }
});
test("two-process stale CAS race; foreign crashed lock is never automatically stolen", async () => {
  const restore = saveEnv();
  try {
    const f = await fixture(),
      { s, m, b } = f;
    await f.seed();
    const ticket = s.stateTicket(s.readEvidenceState(b)),
      worker = path.join(f.root, "worker.mjs");
    fs.writeFileSync(
      worker,
      `import {transactEvidence} from ${JSON.stringify(pathToFileURL(path.join(f.primary, "lib/evidence/store.ts")).href)};import {recordReport} from ${JSON.stringify(pathToFileURL(path.join(f.primary, "lib/evidence/model.ts")).href)};try{await transactEvidence(${JSON.stringify(b)},${JSON.stringify(ticket)},()=>{},draft=>recordReport(draft,${JSON.stringify(b)},{expected_revision:1,kind:'test',result:'passed',summary:'process fixture'}));console.log('COMMITTED')}catch(e){console.log('DENIED:'+e.message);process.exitCode=2}`,
    );
    const results = await Promise.all([child(worker), child(worker)]);
    assert.deepEqual(
      results.map((item) => item.code).sort(),
      [0, 2],
      JSON.stringify(results),
    );
    assert.equal(m.reportAt(s.readEvidenceState(b), b).revision, 2);
    const lock = path.join(b.root, "state.lock");
    fs.writeFileSync(
      lock,
      JSON.stringify({ token: "crashed foreign owner", pid: process.pid }),
      { mode: 0o600 },
    );
    const before = fs.readFileSync(f.target);
    await assert.rejects(
      s.transactEvidence(
        b,
        s.stateTicket(s.readEvidenceState(b)),
        () => {},
        () => {},
      ),
      /no automatic/,
    );
    assert.deepEqual(fs.readFileSync(f.target), before);
    assert.match(fs.readFileSync(lock, "utf8"), /foreign owner/);
  } finally {
    restore();
  }
});
for (const attack of [
  "symlink",
  "hardlink",
  "mode",
  "bytes",
  "cancel-replaced",
  "target-identity",
  "lock-replaced",
  "continuation-cancel",
  "parent-same-mode",
  "temp-directory",
  "target-mode",
  "config-revoked",
  "lock-mode",
] as const) {
  test(`private FD ${attack}: canonical bytes preserved, foreign cleanup ownership respected`, async () => {
    const restore = saveEnv();
    try {
      const f = await fixture(),
        { s, m, b } = f;
      await f.seed();
      const before = fs.readFileSync(f.target),
        foreign = path.join(f.root, "foreign"),
        lock = path.join(b.root, "state.lock");
      fs.writeFileSync(foreign, "FOREIGN", { mode: 0o600 });
      let calls = 0,
        temp = "",
        continuationCancelled = false,
        moved = "";
      const mutation = s.transactEvidence(
        b,
        s.stateTicket(s.readEvidenceState(b)),
        () => {
          if (++calls !== 2) return;
          temp = path.join(
            b.root,
            fs
              .readdirSync(b.root)
              .find((name: string) => name.endsWith(".tmp"))!,
          );
          if (attack === "symlink" || attack === "cancel-replaced") {
            fs.unlinkSync(temp);
            fs.symlinkSync(foreign, temp);
          } else if (attack === "hardlink") {
            fs.unlinkSync(temp);
            fs.linkSync(foreign, temp);
          } else if (attack === "mode") fs.chmodSync(temp, 0o644);
          else if (attack === "bytes") fs.writeFileSync(temp, "INVALID JSON");
          else if (attack === "temp-directory") {
            fs.unlinkSync(temp);
            fs.mkdirSync(temp, { mode: 0o700 });
          } else if (attack === "target-identity") {
            fs.unlinkSync(f.target);
            fs.writeFileSync(f.target, before, { mode: 0o600 });
          } else if (attack === "target-mode") fs.chmodSync(f.target, 0o644);
          else if (attack === "lock-replaced") {
            fs.unlinkSync(lock);
            fs.writeFileSync(
              lock,
              JSON.stringify({ token: "FOREIGN-LOCK", pid: process.pid }),
              { mode: 0o600 },
            );
          } else if (attack === "lock-mode") fs.chmodSync(lock, 0o644);
          else if (attack === "config-revoked")
            fs.writeFileSync(
              f.config,
              JSON.stringify({ version: 1, profile: f.profile, projects: [] }),
            );
          else if (attack === "parent-same-mode") {
            moved = b.root + "-original";
            fs.renameSync(b.root, moved);
            fs.mkdirSync(b.root, { mode: 0o700 });
            for (const file of fs.readdirSync(moved))
              fs.copyFileSync(path.join(moved, file), path.join(b.root, file));
          } else if (attack === "continuation-cancel")
            queueMicrotask(() => {
              continuationCancelled = true;
            });
          if (attack === "cancel-replaced")
            throw Error("cancelled after foreign replacement");
        },
        (draft: any) =>
          m.recordReport(draft, b, {
            expected_revision: 1,
            kind: "test",
            result: "passed",
            summary: "must not publish",
          }),
        () => {
          if (continuationCancelled) throw Error("cancelled in continuation");
        },
      );
      await assert.rejects(mutation);
      assert.deepEqual(fs.readFileSync(f.target), before);
      assert.equal(fs.readFileSync(foreign, "utf8"), "FOREIGN");
      if (
        [
          "symlink",
          "hardlink",
          "cancel-replaced",
          "temp-directory",
          "parent-same-mode",
        ].includes(attack)
      )
        assert.ok(fs.lstatSync(temp), "foreign temp never unlinked");
      else
        assert.equal(fs.existsSync(temp), false, "owned corrupt temp cleaned");
      if (attack === "parent-same-mode") {
        assert.deepEqual(
          fs.readFileSync(path.join(moved, "state.json")),
          before,
        );
        assert.ok(
          fs.existsSync(lock),
          "substituted same-mode parent lock retained",
        );
      } else if (attack === "lock-replaced")
        assert.match(fs.readFileSync(lock, "utf8"), /FOREIGN-LOCK/);
      else if (attack !== "lock-mode") assert.equal(fs.existsSync(lock), false);
    } finally {
      restore();
    }
  });
}
test("invalid UTF8/oversize/schema/fingerprint/private metadata and config paths fail closed", async () => {
  const restore = saveEnv();
  try {
    const f = await fixture(),
      { s, b } = f;
    await f.seed();
    const before = fs.readFileSync(f.target);
    for (const bytes of [
      Buffer.from([255]),
      Buffer.from("{"),
      Buffer.alloc(2 * 1024 * 1024 + 1),
      Buffer.from(JSON.stringify({ schemaVersion: 2 })),
    ]) {
      fs.writeFileSync(f.target, bytes);
      assert.throws(() => s.readEvidenceState(b));
      fs.writeFileSync(f.target, before);
    }
    const state = JSON.parse(before.toString()),
      report = Object.values(state.reports)[0] as any;
    report.staged.total++;
    fs.writeFileSync(f.target, JSON.stringify(state));
    assert.throws(() => s.readEvidenceState(b));
    fs.writeFileSync(f.target, before);
    fs.chmodSync(f.target, 0o644);
    assert.throws(() => s.readEvidenceState(b));
    fs.chmodSync(f.target, 0o600);
    const link = path.join(f.root, "link");
    fs.linkSync(f.target, link);
    assert.throws(() => s.readEvidenceState(b));
    fs.unlinkSync(link);
    fs.unlinkSync(f.target);
    fs.symlinkSync(f.config, f.target);
    assert.throws(() => s.readEvidenceState(b));
    fs.unlinkSync(f.target);
    fs.writeFileSync(f.target, before, { mode: 0o600 });
    assert.throws(() => s.resolveEvidenceBinding(`${f.project}/../project`));
    // Refuse a missing directory, not a particular project name.
    assert.throws(() =>
      s.resolveEvidenceBinding(path.join(f.root, "missing-project")),
    );
    fs.chmodSync(f.config, 0o644);
    assert.throws(() => s.resolveEvidenceBinding(f.project));
  } finally {
    restore();
  }
});
