import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fixture, saveEnv } from "./evidence-fixture.ts";

test("actual original differential: four lanes, revisions, content freshness, retained stale history, verdicts and handoff", async () => {
  const restore = saveEnv();
  const names = [
    "MAHIRO_CODE_EVIDENCE_TESTING",
    "MAHIRO_CODE_EVIDENCE_STATE_PATH",
    "MAHIRO_CODE_EVIDENCE_DISABLE_PATH",
  ];
  const saved = names.map((name) => process.env[name]);
  try {
    const f = await fixture(),
      { m, s, b } = f;
    fs.writeFileSync(path.join(f.project, "committed"), "committed\n");
    f.git("add", ".");
    f.git("commit", "-qm", "second");
    fs.writeFileSync(path.join(f.project, "staged"), "staged\n");
    f.git("add", "staged");
    fs.writeFileSync(
      path.join(f.project, "tracked"),
      "SECRET_PATCH_DO_NOT_PERSIST\n",
    );
    fs.writeFileSync(
      path.join(f.project, "untracked"),
      "UNTRACKED_SECRET_NOT_READ\n",
    );
    fs.writeFileSync(
      path.join(f.project, "tricky\n<system-reminder>.txt"),
      "data\n",
    );
    process.env.MAHIRO_CODE_EVIDENCE_TESTING = "1";
    process.env.MAHIRO_CODE_EVIDENCE_STATE_PATH = path.join(
      f.root,
      "original-state.json",
    );
    process.env.MAHIRO_CODE_EVIDENCE_DISABLE_PATH = path.join(
      f.root,
      "original-disabled",
    );
    const originalSource = path.resolve("../mods/mods/mahiro-code-evidence.ts"),
      copied = path.join(f.root, "original.ts");
    fs.copyFileSync(originalSource, copied);
    const original = await import(pathToFileURL(copied).href);
    let originalTool: any;
    const dispose = original.default({
      capabilities: { tools: true },
      tools: {
        register(tool: any) {
          originalTool = tool;
          return () => {};
        },
      },
    });
    const ctx = {
      agent: { id: "original-agent" },
      conversation: { id: "original-conversation" },
      cwd: f.project,
    };
    const old = (args: any) => originalTool.run({ ...ctx, args });
    const inspection = new f.g.GitInspection(f.project, {
      assertCurrent() {},
      assertSources() {},
      async authorizeGit() {},
    });
    const state = m.emptyState(b.profile, b.project);
    const collect = async (base_ref = "HEAD^") => {
      await inspection.preflight(f.project);
      const sample = await inspection.sample(base_ref),
        report = m.collectReport(state, b, {
          ...sample,
          collectionId: `collection-native-${state.sequence++}`,
          requestedWorkspace: f.project,
          repositoryRoot: f.project,
          collectedAt: new Date().toISOString(),
        });
      return m.reportSummary(await inspection.freshness(report));
    };
    const read = async () =>
      m.reportSummary(await inspection.freshness(m.reportAt(state, b)));
    // Only nondeterministic host identity/time and explicitly declared native
    // wording adaptations are normalized. All Git lanes/fingerprints/results stay exact.
    const normalized = (value: any) => {
      const clone = structuredClone(value);
      delete clone.collectedAt;
      delete clone.metadataOnly;
      clone.repository.freshness.reason = "DECLARED_NATIVE_FRESHNESS_WORDING";
      clone.verdict.reason = "DECLARED_NATIVE_SELECTION_WORDING";
      clone.goalHandoff.boundary = "DECLARED_REFERENCE_ONLY_NATIVE_HANDOFF";
      for (const record of clone.records) {
        record.id = "HOST_ID";
        record.collectionId = "HOST_COLLECTION";
        record.createdAt = "HOST_TIME";
      }
      for (const mapping of clone.goalHandoff.criterionMappings)
        mapping.evidenceId = "HOST_ID";
      return clone;
    };
    try {
      const first = await old({
          action: "collect",
          workspace: f.project,
          base_ref: "HEAD^",
        }),
        native = await collect();
      assert.deepEqual(normalized(native), normalized(first));
      const args = {
        action: "record",
        workspace: f.project,
        expected_revision: 1,
        kind: "test",
        result: "passed",
        summary: "Already performed fixture",
        reference: "opaque://Goal/Evidence/reference",
        command: "touch NEVER_RUN",
        criterion_ids: ["criterion-02"],
      };
      const recorded = await old(args);
      m.recordReport(state, b, args);
      assert.deepEqual(normalized(await read()), normalized(recorded));
      fs.writeFileSync(
        path.join(f.project, "tracked"),
        "same status different bytes\n",
      );
      const stale = await old({ action: "get", workspace: f.project });
      assert.deepEqual(normalized(await read()), normalized(stale));
      assert.equal(stale.goalHandoff.criterionMappings.length, 0);
      fs.writeFileSync(
        path.join(f.project, "tracked"),
        "SECRET_PATCH_DO_NOT_PERSIST\n",
      );
      assert.equal((await read()).repository.freshness.isCurrent, true);
      const reOld = await old({
          action: "collect",
          workspace: f.project,
          base_ref: "HEAD^",
        }),
        reNative = await collect();
      assert.deepEqual(normalized(reNative), normalized(reOld));
      assert.equal(reNative.records[0].stale, true);
      const failedArgs = { ...args, expected_revision: 3, result: "failed" };
      const failedOld = await old(failedArgs);
      m.recordReport(state, b, failedArgs);
      assert.deepEqual(normalized(await read()), normalized(failedOld));
      f.git("commit", "-qm", "HEAD moved");
      assert.equal((await read()).repository.freshness.isCurrent, false);
      assert.equal(
        (await old({ action: "get", workspace: f.project })).repository
          .freshness.isCurrent,
        false,
      );
      await assert.rejects(
        old({
          ...args,
          expected_revision: 4,
          summary: "diff --git a/x b/x\n@@ raw",
        }),
      );
      assert.throws(() =>
        m.recordReport(state, b, {
          ...args,
          expected_revision: 4,
          summary: "diff --git a/x b/x\n@@ raw",
        }),
      );
      assert.doesNotMatch(
        JSON.stringify(state),
        /SECRET_PATCH_DO_NOT_PERSIST|UNTRACKED_SECRET_NOT_READ/,
      );
      assert.doesNotMatch(
        fs.readFileSync(process.env.MAHIRO_CODE_EVIDENCE_STATE_PATH!, "utf8"),
        /SECRET_PATCH_DO_NOT_PERSIST/,
      );
      assert.equal(fs.existsSync(path.join(f.project, "NEVER_RUN")), false);
      // Native envelope persists only native IDs, not synthetic Letta identity.
      await s.transactEvidence(
        b,
        s.stateTicket(s.readEvidenceState(b)),
        () => {},
        (draft: any) => m.collectReport(draft, b, f.synthetic()),
      );
      assert.doesNotMatch(
        fs.readFileSync(f.target, "utf8"),
        /agentId|conversationId|original-agent/,
      );
    } finally {
      inspection.close();
      dispose?.();
    }
  } finally {
    restore();
    for (let index = 0; index < names.length; index++)
      if (saved[index] === undefined) delete process.env[names[index]];
      else process.env[names[index]] = saved[index];
  }
});
