import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  applyRun,
  emptyState,
  response,
  runAt,
  validateInput,
  validateState,
} from "../lib/execution-run/model.ts";

const target = {
  id: "t",
  path: "src",
  intent: "fixture",
  worktree_ref: "default",
  access: "write",
  writer_lane_id: "writer",
  reader_lane_ids: ["reader"],
};
const creation = {
  summary: "Fixture",
  acceptance_criteria: ["caller criterion"],
  non_goals: [],
  protected_contracts: [],
  open_questions: [],
  suggested_checks: ["caller check"],
  targets: [target],
};
const scope = {
  profile: "/fixture-profile",
  project: "/fixture-project",
  sessionId: "native-fixture",
};
const normalize = (value: any): any => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            !["agent_id", "conversation_id", "profile", "sessionId"].includes(
              k,
            ),
        )
        .map(([k, v]) => [
          k,
          ["id", "run_id", "replaces_run_id"].includes(k) &&
          typeof v === "string" &&
          /^(mh-run-|blocker-)/.test(v)
            ? "<generated>"
            : ["at", "created_at", "updated_at", "resolved_at"].includes(k) && v
              ? "<time>"
              : normalize(v),
        ]),
    );
  return value;
};

test("executable original Letta differential: all ten actions, legal/illegal transitions, handoff revision and replacement", async () => {
  const base = path.resolve(
    ".agent-state/runtime/execution-run-port/differential",
  );
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  const saved = {
    testing: process.env.MAHIRO_EXECUTION_RUN_TESTING,
    state: process.env.MAHIRO_EXECUTION_RUN_STATE_PATH,
    disabled: process.env.MAHIRO_EXECUTION_RUN_DISABLE_PATH,
  };
  process.env.MAHIRO_EXECUTION_RUN_TESTING = "1";
  process.env.MAHIRO_EXECUTION_RUN_STATE_PATH = path.join(root, "state.json");
  process.env.MAHIRO_EXECUTION_RUN_DISABLE_PATH = path.join(
    root,
    "absent-disabled",
  );
  let dispose: any;
  try {
    const upstream = await import(
      `${pathToFileURL(path.resolve(import.meta.dirname, "oracles/letta/mahiro-execution-run.ts")).href}?execution-run=${Date.now()}`
    );
    let tool: any;
    dispose = upstream.default({
      capabilities: { tools: true },
      tools: {
        register: (t: any) => {
          tool = t;
          return () => {};
        },
      },
    });
    let native = emptyState(scope.profile, scope.project),
      cases = 0;
    const ctx = {
      agent: { id: "letta-fixture" },
      conversation: { id: "conversation-fixture" },
      cwd: scope.project,
    };
    const oldRun = () =>
      Object.values(upstream.__testing.readState().runs)[0] as any;
    const reset = () => {
      upstream.__testing.writeState({ schema_version: 1, runs: {} });
      native = emptyState(scope.profile, scope.project);
    };
    const pair = (operation: string, args: any = {}, success?: boolean) => {
      const originalArgs = { ...args },
        nativeArgs = { ...args };
      if (
        ["update", "create"].includes(operation) &&
        oldRun() &&
        args.expected_revision === undefined
      ) {
        originalArgs.expected_revision = oldRun().revision;
        nativeArgs.expected_revision = runAt(native, scope)!.revision;
        originalArgs.expected_run_id = oldRun().id;
        nativeArgs.expected_run_id = runAt(native, scope)!.id;
      }
      let a: any, b: any, ae: any, be: any;
      try {
        a = tool.run({ ...ctx, args: { operation, ...originalArgs } });
      } catch (e) {
        ae = e;
      }
      try {
        b =
          operation === "get"
            ? response(runAt(native, scope))
            : response(
                applyRun(native, scope, operation as any, nativeArgs) as any,
              );
      } catch (e) {
        be = e;
      }
      cases++;
      assert.equal(
        !!ae,
        !!be,
        `case ${cases} ${operation}/${args.action}: original ${ae}, native ${be}`,
      );
      if (success !== undefined)
        assert.equal(!ae, success, `case ${cases}: ${String(ae ?? be)}`);
      if (!ae)
        assert.deepEqual(
          normalize(b),
          normalize(a),
          `case ${cases} ${args.action}`,
        );
      validateState(native, scope.profile, scope.project);
      return !ae;
    };
    const lane = (id: string, required = true, role = "implement") =>
      pair(
        "update",
        {
          action: "add_lane",
          lane_id: id,
          required,
          executor_kind: "main_agent",
          role,
          worktree_ref: "default",
          summary: "metadata",
        },
        true,
      );
    reset();
    pair("get", {}, true);
    pair("create", creation, true);
    for (const stage of [
      "plan",
      "ready",
      "active",
      "reported",
      "handed_off",
      "abandoned",
    ])
      pair("update", { action: "set_stage", stage }, false);
    lane("writer");
    lane("reader", false, "review");
    pair(
      "update",
      {
        action: "set_open_questions",
        open_questions: [{ question: "blocking?", blocking: true }],
      },
      true,
    );
    pair(
      "update",
      { action: "set_goal_refs", goal_refs: ["goal:metadata"] },
      true,
    );
    pair("update", { action: "set_stage", stage: "ready" }, false);
    pair("update", { action: "set_open_questions", open_questions: [] }, true);
    pair(
      "update",
      {
        action: "add_blocker",
        lane_id: "writer",
        summary: "planned to blocked",
      },
      true,
    );
    // Original special case: resolving planned→blocked restores active even without session refs.
    const originalBlocker = oldRun().blockers[0].id,
      nativeBlocker = runAt(native, scope)!.blockers[0].id;
    const a = tool.run({
      ...ctx,
      args: {
        operation: "update",
        action: "resolve_blocker",
        blocker_id: originalBlocker,
        expected_run_id: oldRun().id,
        expected_revision: oldRun().revision,
      },
    });
    const b = response(
      applyRun(native, scope, "update", {
        action: "resolve_blocker",
        blocker_id: nativeBlocker,
        expected_run_id: runAt(native, scope)!.id,
        expected_revision: runAt(native, scope)!.revision,
      }) as any,
    );
    assert.deepEqual(normalize(b), normalize(a));
    cases++;
    assert.equal(runAt(native, scope)!.lanes[0].status, "active");
    assert.deepEqual(runAt(native, scope)!.lanes[0].session_refs, []);
    pair("update", { action: "set_stage", stage: "ready" }, true);
    pair("update", { action: "set_stage", stage: "active" }, false);
    pair(
      "update",
      {
        action: "set_lane_sessions",
        lane_id: "writer",
        session_refs: ["opaque-main-ref"],
      },
      true,
    );
    pair("update", { action: "set_stage", stage: "active" }, true);
    for (const action of [
      "set_open_questions",
      "set_goal_refs",
      "set_lane_sessions",
      "add_lane",
    ])
      pair(
        "update",
        {
          action,
          open_questions: [],
          goal_refs: ["g"],
          lane_id: "writer",
          session_refs: ["x"],
        },
        false,
      );
    pair("update", { action: "set_stage", stage: "reported" }, false);
    pair(
      "update",
      { action: "set_lane_status", lane_id: "reader", status: "active" },
      true,
    );
    for (const changed_paths of [
      ["../escape"],
      ["/absolute"],
      ["src/../escape"],
      ["src\\escape"],
      ["src/\u202efile"],
      ["other/file"],
    ])
      pair(
        "update",
        {
          action: "add_report",
          lane_id: "writer",
          report_id: "bad",
          status: "reported",
          summary: "claim",
          changed_paths,
        },
        false,
      );
    pair(
      "update",
      {
        action: "add_report",
        lane_id: "reader",
        report_id: "bad",
        status: "reported",
        summary: "claim",
        changed_paths: ["src/file"],
      },
      false,
    );
    pair(
      "update",
      {
        action: "add_report",
        lane_id: "writer",
        report_id: "w",
        status: "failed",
        summary: "failed metadata",
        changed_paths: ["src/./file"],
        checks: ["caller passed"],
        refs: ["opaque"],
      },
      true,
    );
    pair(
      "update",
      {
        action: "add_report",
        lane_id: "reader",
        report_id: "r",
        status: "cancelled",
        summary: "cancelled metadata",
      },
      true,
    );
    pair("update", { action: "set_stage", stage: "reported" }, true);
    const handoff = {
      action: "set_handoff",
      final_handoff: "ownership only",
      suggested_checks: ["metadata"],
      goal_refs: ["goal:metadata"],
      included: [],
      exceptions: ["writer", "reader"],
    };
    pair("update", { ...handoff, included: ["writer"] }, false);
    pair("update", { ...handoff, exceptions: [] }, false);
    pair("update", { ...handoff, goal_refs: ["wrong"] }, false);
    pair("update", { ...handoff, unresolved_items: ["pending"] }, true);
    pair("update", { action: "set_stage", stage: "handed_off" }, false);
    pair("update", handoff, true);
    pair("update", { action: "set_stage", stage: "handed_off" }, true);
    pair("update", { action: "add_blocker", summary: "immutable" }, false);
    pair("create", creation, false);
    pair(
      "create",
      {
        ...creation,
        replace_terminal: true,
        expected_run_id: "wrong",
        expected_revision: 1,
      },
      false,
    );
    pair("create", { ...creation, replace_terminal: true }, true);
    assert.equal(runAt(native, scope)!.revision, 1);
    assert.ok(runAt(native, scope)!.replaces_run_id);
    for (const [field, length] of [
      ["summary", 501],
      ["summary", 4001],
      ["acceptance_criteria", 25],
      ["worktree_refs", 17],
      ["targets", 65],
      ["open_questions", 25],
      ["suggested_checks", 25],
    ]) {
      reset();
      const bad = {
        ...creation,
        [field]:
          field === "summary"
            ? "x".repeat(length as number)
            : Array.from({ length: length as number }, (_, i) =>
                field === "targets"
                  ? { ...target, id: `t${i}`, path: `src${i}` }
                  : field === "open_questions"
                    ? { question: `q${i}`, blocking: false }
                    : `item${i}`,
              ),
      };
      pair("create", bad, false);
    }
    for (const collision of ["src", "src/child"]) {
      reset();
      pair(
        "create",
        {
          ...creation,
          targets: [target, { ...target, id: "second", path: collision }],
        },
        false,
      );
    }
    for (const badTarget of [
      { ...target, writer_lane_id: "missing" },
      { ...target, reader_lane_ids: ["missing"] },
      { ...target, reader_lane_ids: ["writer"] },
      { ...target, access: "read", writer_lane_id: "writer" },
    ]) {
      reset();
      pair(
        "create",
        { ...creation, goal_refs: ["g"], targets: [badTarget] },
        true,
      );
      lane("writer");
      pair("update", { action: "set_stage", stage: "ready" }, false);
    }
    reset();
    pair(
      "create",
      { ...creation, targets: [{ ...target, reader_lane_ids: [] }] },
      true,
    );
    for (let i = 0; i < 16; i++) lane(`lane${i}`, false, "review");
    pair(
      "update",
      {
        action: "add_lane",
        lane_id: "overflow",
        required: false,
        executor_kind: "other",
        role: "other",
        summary: "overflow",
      },
      false,
    );
    for (let i = 0; i < 30; i++)
      pair("update", { action: "add_blocker", summary: `b${i}` }, true);
    pair("update", { action: "add_blocker", summary: "overflow" }, false);
    for (let i = 0; i < 90; i++)
      pair("update", { action: "set_goal_refs", goal_refs: [`g${i}`] }, true);
    assert.equal(runAt(native, scope)!.history.length, 80);
    // Exhaustive original lane transition table via valid persisted fixture seeds.
    reset();
    pair(
      "create",
      { ...creation, targets: [{ ...target, reader_lane_ids: [] }] },
      true,
    );
    lane("writer");
    const originalSeed = structuredClone(upstream.__testing.readState()),
      nativeSeed = structuredClone(native);
    const oldKey = Object.keys(originalSeed.runs)[0];
    const seed = (edit: (r: any) => void) => {
      const a = structuredClone(originalSeed),
        b = structuredClone(nativeSeed);
      edit(a.runs[oldKey]);
      edit(b.runs[scope.sessionId]);
      upstream.__testing.writeState(a);
      native = b;
    };
    for (const from of [
      "planned",
      "active",
      "blocked",
      "reported",
      "handed_off",
      "failed",
      "cancelled",
    ])
      for (const to of [
        "planned",
        "active",
        "blocked",
        "reported",
        "handed_off",
        "failed",
        "cancelled",
      ]) {
        seed((r) => {
          r.stage = "active";
          r.lanes[0].status = from;
          r.lanes[0].session_refs = ["metadata"];
        });
        if (["reported", "failed", "cancelled"].includes(to))
          pair("update", {
            action: "add_report",
            lane_id: "writer",
            report_id: "matrix",
            status: to,
            summary: "metadata",
            changed_paths: [],
          });
        else
          pair("update", {
            action: "set_lane_status",
            lane_id: "writer",
            status: to,
          });
      }
    for (const count of [4, 5]) {
      seed((r) => {});
      pair(
        "update",
        {
          action: "set_lane_sessions",
          lane_id: "writer",
          session_refs: Array.from({ length: count }, (_, i) => `ref${i}`),
        },
        count === 4,
      );
    }
    for (const [field, max] of [
      ["changed_paths", 64],
      ["checks", 24],
      ["refs", 24],
    ] as const)
      for (const count of [max, max + 1]) {
        seed((r) => {
          r.stage = "active";
          r.lanes[0].status = "active";
        });
        pair(
          "update",
          {
            action: "add_report",
            lane_id: "writer",
            report_id: "bound",
            status: "reported",
            summary: "metadata",
            [field]: Array.from({ length: count }, (_, i) =>
              field === "changed_paths" ? `src/f${i}` : `item${i}`,
            ),
          },
          count === max,
        );
      }
    // Successful reported→handed_off latest-report exception and included matching.
    seed((r) => {
      r.stage = "active";
      r.lanes[0].status = "active";
      r.goal_refs = ["g"];
    });
    pair(
      "update",
      {
        action: "add_report",
        lane_id: "writer",
        report_id: "reported",
        status: "reported",
        summary: "metadata",
      },
      true,
    );
    pair(
      "update",
      { action: "set_lane_status", lane_id: "writer", status: "handed_off" },
      true,
    );
    pair("update", { action: "set_stage", stage: "reported" }, true);
    pair(
      "update",
      {
        action: "set_handoff",
        final_handoff: "metadata",
        suggested_checks: ["c"],
        goal_refs: ["g"],
        included: ["writer"],
      },
      true,
    );
    pair("update", { action: "set_stage", stage: "handed_off" }, true);
    // Persisted collection limits use the original executable validator as oracle.
    const persistedPair = (edit: (r: any) => void, valid: boolean) => {
      const a = structuredClone(originalSeed),
        b = structuredClone(nativeSeed);
      edit(a.runs[oldKey]);
      edit(b.runs[scope.sessionId]);
      let ae = false,
        be = false;
      try {
        upstream.__testing.writeState(a);
      } catch {
        ae = true;
      }
      try {
        validateState(b, scope.profile, scope.project);
      } catch {
        be = true;
      }
      cases++;
      assert.equal(ae, be);
      assert.equal(!ae, valid);
    };
    const report = (i: number) => ({
      id: `r${i}`,
      status: "reported",
      summary: "metadata",
      changed_paths: [],
      checks: [],
      refs: [],
      created_at: "2026-01-01T00:00:00.000Z",
    });
    for (const count of [4, 5])
      persistedPair(
        (r) =>
          (r.lanes[0].reports = Array.from({ length: count }, (_, i) =>
            report(i),
          )),
        count === 4,
      );
    for (const count of [512, 513])
      persistedPair((r) => {
        r.lanes = Array.from({ length: 9 }, (_, i) => ({
          ...r.lanes[0],
          id: `lane${i}`,
          reports: [
            {
              ...report(i),
              changed_paths: Array.from(
                { length: Math.min(64, Math.max(0, count - i * 64)) },
                (_, j) => `src${i}/f${j}`,
              ),
            },
          ],
        }));
        r.targets = r.lanes.map((l: any, i: number) => ({
          ...target,
          id: `t${i}`,
          path: `src${i}`,
          writer_lane_id: l.id,
          reader_lane_ids: [],
        }));
      }, count === 512);
    for (const count of [256, 257]) {
      const a = structuredClone(originalSeed),
        b = structuredClone(nativeSeed);
      a.runs = {};
      b.runs = {};
      for (let i = 0; i < count; i++) {
        const ar = {
          ...structuredClone(originalSeed.runs[oldKey]),
          id: `run${i}`,
          conversation_id: `c${i}`,
        };
        a.runs[JSON.stringify([ar.agent_id, ar.conversation_id, ""])] = ar;
        const br = {
          ...structuredClone(nativeSeed.runs[scope.sessionId]),
          id: `run${i}`,
          sessionId: `s${i}`,
        };
        b.runs[br.sessionId] = br;
      }
      let ae = false,
        be = false;
      try {
        upstream.__testing.writeState(a);
      } catch {
        ae = true;
      }
      try {
        validateState(b, scope.profile, scope.project);
      } catch {
        be = true;
      }
      cases++;
      assert.equal(ae, be);
      assert.equal(!ae, count === 256);
    }
    fs.writeFileSync(
      path.join(root, "receipt.json"),
      JSON.stringify(
        {
          executableOriginal: true,
          cases,
          normalizedOnly: [
            "generated IDs",
            "timestamps",
            "native envelope identity",
          ],
          intentionalAdaptations: [
            "closed inputs/storage",
            "pi_subagent native reference metadata",
            "public-UI human commands",
            "private persistence",
          ],
        },
        null,
        2,
      ),
    );
    console.log(`EXECUTION_RUN_DIFFERENTIAL_CASES=${cases}`);
  } finally {
    dispose?.();
    for (const [key, value] of [
      ["MAHIRO_EXECUTION_RUN_TESTING", saved.testing],
      ["MAHIRO_EXECUTION_RUN_STATE_PATH", saved.state],
      ["MAHIRO_EXECUTION_RUN_DISABLE_PATH", saved.disabled],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});

test("closed operation/action inputs and persisted unknown keys; native refs are data only", () => {
  const state = emptyState(scope.profile, scope.project);
  applyRun(state, scope, "create", creation);
  const update = (args: any) =>
    applyRun(state, scope, "update", {
      expected_run_id: runAt(state, scope)!.id,
      expected_revision: runAt(state, scope)!.revision,
      ...args,
    });
  for (const args of [
    { operation: "get", actor: "human" },
    { operation: "get", summary: "extra" },
    { operation: "create", ...creation, actor: "human" },
    {
      operation: "update",
      expected_run_id: "x",
      expected_revision: 1,
      action: "set_stage",
      stage: "abandoned",
    },
    {
      operation: "update",
      expected_run_id: "x",
      expected_revision: 1,
      action: "add_blocker",
      summary: "b",
      goal_refs: ["bypass"],
    },
  ])
    assert.throws(() => validateInput(args));
  update({
    action: "add_lane",
    lane_id: "writer",
    required: true,
    executor_kind: "pi_subagent",
    role: "implement",
    summary: "native metadata",
  });
  assert.throws(() =>
    update({
      action: "set_lane_sessions",
      lane_id: "writer",
      session_refs: ["letta:agent=a;conversation=c"],
    }),
  );
  update({
    action: "set_lane_sessions",
    lane_id: "writer",
    session_refs: ["pi:session=native-session"],
  });
  for (const mutate of [
    (s: any) => (s.extra = 1),
    (s: any) => (s.runs[scope.sessionId].agent_id = "fake"),
    (s: any) => (s.runs[scope.sessionId].targets[0].verified = true),
    (s: any) => (s.runs[scope.sessionId].lanes[0].receipt = true),
    (s: any) => (s.runs[scope.sessionId].history[0].actor = "human"),
  ]) {
    const draft = structuredClone(state);
    mutate(draft);
    assert.throws(() => validateState(draft, scope.profile, scope.project));
  }
});
