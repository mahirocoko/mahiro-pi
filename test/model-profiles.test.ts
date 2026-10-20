import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  preferenceBinding,
  readProfiles,
  publishPreference,
  validateProfiles,
  findProfile,
} from "../lib/model-profiles.ts";

test("persistent native model-profile private store: no read init, closed JSON, alias, CAS, no corrupt repair, locks and symlinks", () => {
  const base = path.resolve(
    ".agent-state/runtime/pi-ownership-repair/models-unit",
  );
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const fixture = fs.mkdtempSync(path.join(base, "case-")),
    profile = path.join(fixture, "profile"),
    project = path.join(fixture, "project");
  fs.mkdirSync(profile, { mode: 0o700 });
  fs.mkdirSync(project, { mode: 0o700 });
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = profile;
  try {
    assert.equal(preferenceBinding(project, "model-profiles"), null);
    assert.equal(fs.readdirSync(profile).length, 0);
    const config = path.join(
      profile,
      "extensions/mahiro-model-profiles/config.json",
    );
    fs.mkdirSync(path.dirname(config), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      config,
      JSON.stringify({ version: 1, profile, projects: [project] }),
      { mode: 0o600 },
    );
    const b = preferenceBinding(project, "model-profiles")!;
    const initial = readProfiles(b);
    assert.equal(fs.existsSync(b.root), false);
    const p = {
      provider: "explicit-provider",
      model: "model/id",
      contextWindow: 12000,
      thinking: "high" as const,
      label: "Across sessions",
    };
    const next = {
      version: 1,
      sequence: 1,
      profiles: { "explicit-provider/model/id": p },
    };
    publishPreference(b, initial.ticket, next, () => {}, validateProfiles);
    const saved = readProfiles(b);
    assert.equal(saved.state.sequence, 1);
    assert.deepEqual(findProfile(saved.state, "across SESSIONS").profile, p);
    assert.throws(
      () =>
        publishPreference(b, initial.ticket, next, () => {}, validateProfiles),
      /Stale/,
    );
    assert.equal(fs.existsSync(path.join(b.root, "state.lock")), false);
    assert.throws(() => validateProfiles({ ...next, unknown: true }));
    assert.throws(
      () =>
        validateProfiles({
          ...next,
          profiles: {
            ...next.profiles,
            "another/model": { ...p, provider: "another", model: "model" },
          },
        }),
      /Ambiguous/,
    );
    const file = path.join(b.root, "state.json"),
      bytes = fs.readFileSync(file);
    fs.writeFileSync(file, "{corrupt");
    assert.throws(() => readProfiles(b));
    assert.equal(fs.readFileSync(file, "utf8"), "{corrupt");
    fs.writeFileSync(file, bytes);
    fs.chmodSync(file, 0o644);
    assert.throws(() => readProfiles(b), /0600/);
    fs.chmodSync(file, 0o600);
    fs.writeFileSync(path.join(b.root, "state.lock"), "NO_AUTO_STEAL", {
      mode: 0o600,
    });
    assert.throws(() =>
      publishPreference(b, saved.ticket, next, () => {}, validateProfiles),
    );
    assert.equal(
      fs.readFileSync(path.join(b.root, "state.lock"), "utf8"),
      "NO_AUTO_STEAL",
    );
    fs.unlinkSync(path.join(b.root, "state.lock"));
    fs.renameSync(file, `${file}.saved`);
    fs.symlinkSync(`${file}.saved`, file);
    assert.throws(() => readProfiles(b), /Symlink/);
    fs.unlinkSync(file);
    fs.renameSync(`${file}.saved`, file);
    assert.throws(
      () =>
        publishPreference(
          b,
          saved.ticket,
          next,
          () => {
            throw Error("revoked");
          },
          validateProfiles,
        ),
      /revoked/,
    );
    assert.deepEqual(fs.readFileSync(file), bytes);
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
  }
});
