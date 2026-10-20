import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  applyUX,
  emptyState,
  runAt,
  validateState,
} from "../lib/ux-workflow/model.ts";

const base = path.resolve(".agent-state/runtime/ux-workflow-port/differential");
fs.mkdirSync(base, { recursive: true, mode: 0o700 });
const root = fs.mkdtempSync(path.join(base, "original-"));
const original = path.join(root, "original.ts");
fs.copyFileSync(
  path.resolve(import.meta.dirname, "oracles/letta/mahiro-ux-workflow.ts"),
  original,
);
const statePath = path.join(root, "letta-state.json");
process.env.MAHIRO_UX_WORKFLOW_STATE_PATH = statePath;
process.env.MAHIRO_UX_WORKFLOW_DISABLE_PATH = path.join(root, "disabled");
const { default: activate } = await import(pathToFileURL(original).href);
delete process.env.MAHIRO_UX_WORKFLOW_STATE_PATH;
delete process.env.MAHIRO_UX_WORKFLOW_DISABLE_PATH;
const tools = new Map<string, any>(),
  commands = new Map<string, any>();
await activate({
  capabilities: { tools: true, commands: true },
  tools: {
    register(t: any) {
      tools.set(t.name, t);
      return () => {};
    },
  },
  commands: {
    register(c: any) {
      commands.set(c.id, c);
      return () => {};
    },
  },
});
const scope = {
  profile: "/fixture-profile",
  project: root,
  sessionId: "native-session",
};
const ctx = {
  cwd: root,
  agentId: "original-agent",
  conversationId: "original-conversation",
};
const brief = {
  owner: "opaque-owner",
  mode: "metadata",
  reference: "/never/read",
  summary: "caller brief",
};
const handoff = (readiness = "prototype_ready") => ({
  readiness,
  brief,
  acceptance_criteria: ["ordinary strings, not Goal records"],
  non_goals: [],
  constraints: [],
  open_questions: [],
  protected_contracts: [],
  target_matrix: [{ target: "opaque target", intent: "metadata" }],
  suggested_checks: [],
  goal_criterion_refs: ["opaque goal"],
});
let state = emptyState(scope.profile, scope.project);
const current = () => runAt(state, scope)!;
let cases = 0;
function normalized(value: any): any {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            !["profile", "sessionId", "agentId", "conversationId"].includes(k),
        )
        .map(([k, v]) => [k, normalized(v)]),
    );
  if (typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value))
    return "<time>";
  if (typeof value === "string" && /^(mh-ux-|research-|blocker-)/.test(value))
    return "<generated-id>";
  return value;
}
function reset() {
  fs.rmSync(statePath, { force: true });
  state = emptyState(scope.profile, scope.project);
}
function op(
  operation: "create" | "update" | "approve" | "reject" | "reopen" | "clear",
  input: any = {},
) {
  const args =
    operation === "create"
      ? input
      : { expected_revision: current()?.revision, ...input };
  const before = structuredClone(state);
  let native: any, legacy: any, a: unknown, b: unknown;
  try {
    native = applyUX(state, scope, operation, args);
    validateState(state, scope.profile, scope.project);
  } catch (e) {
    a = e;
    state = before;
  }
  try {
    if (operation === "create" || operation === "update")
      legacy = tools
        .get(`mh_${operation}_ux_workflow`)
        .run({ ...ctx, args }).workflow;
    else {
      const text =
        operation === "clear"
          ? `clear ${args.expected_revision}`
          : operation === "reopen"
            ? `reopen ${args.expected_revision}${args.note ? ` ${args.note}` : ""}`
            : `${operation} ${args.gate} ${args.expected_revision}${args.gate === "direction" ? ` ${args.concept_id}` : ""}${args.note ? ` ${args.note}` : ""}`;
      const result = commands.get("mh-ux").run({ ...ctx, args: text });
      if (!result.success) throw Error(result.output);
      legacy =
        operation === "clear"
          ? true
          : tools.get("mh_get_ux_workflow").run(ctx).workflow;
    }
  } catch (e) {
    b = e;
  }
  cases++;
  assert.equal(
    !!a,
    !!b,
    `differential ${operation}/${args.action ?? args.gate ?? ""}: native=${a} original=${b}`,
  );
  if (!a) assert.deepEqual(normalized(native), normalized(legacy));
  return !a;
}
function frame() {
  op("create", { summary: "fixture" });
  op("update", {
    action: "set_frame",
    problem: "p",
    audience: "a",
    desired_outcome: "d",
  });
}
function design() {
  frame();
  op("update", { action: "set_brief", brief });
  op("update", { action: "set_phase", phase: "design" });
  op("update", {
    action: "add_concept",
    concept_id: "a",
    title: "A",
    summary: "A",
  });
}
function direction() {
  design();
  op("update", { action: "propose_direction", concept_id: "a", summary: "A" });
}
function implementation(readiness?: string) {
  direction();
  op("approve", { gate: "direction", concept_id: "a" });
  op("update", { action: "set_handoff", handoff: handoff(readiness) });
  op("update", { action: "set_phase", phase: "implementation" });
}
function review(verdict = "Ready") {
  op("update", {
    action: "set_review",
    verdict,
    summary: "opaque review",
    findings: [
      { severity: "low", summary: "finding", reference: "opaque finding" },
    ],
    evidence_refs: ["opaque evidence"],
    code_evidence_refs: ["opaque code"],
  });
}

test("executable actual Letta differential: all eleven actions, stages, actor/revision/ref gates, approval/rejection/reopen/completion", () => {
  reset();
  frame();
  op("update", { action: "set_phase", phase: "design" }); // brief, not research, is mandatory
  op("update", { action: "set_brief", brief });
  assert.equal(current().research.length, 0);
  op("update", { action: "set_phase", phase: "design" });
  op("update", { action: "set_handoff", handoff: handoff() });
  op("update", {
    action: "add_concept",
    concept_id: "a",
    title: "A",
    summary: "A",
  });
  op("update", {
    action: "propose_direction",
    concept_id: "missing",
    summary: "A",
  });
  op("update", { action: "propose_direction", concept_id: "a", summary: "A" });
  op("approve", { gate: "direction", concept_id: "wrong" });
  op("reopen");
  op("update", { action: "propose_direction", concept_id: "a", summary: "A" });
  op("reject", { gate: "direction", concept_id: "a", note: "no" });
  assert.equal(current().direction, null);
  op("update", { action: "propose_direction", concept_id: "a", summary: "A" });
  op("approve", { gate: "direction", concept_id: "a" });
  op("update", {
    action: "set_handoff",
    handoff: { ...handoff(), brief: { ...brief, owner: "different" } },
  });
  op("update", {
    action: "set_handoff",
    handoff: {
      ...handoff(),
      open_questions: [{ question: "blocking", blocking: true }],
    },
  });
  op("update", { action: "set_phase", phase: "implementation" });
  op("update", { action: "set_handoff", handoff: handoff() });
  op("update", { action: "set_phase", phase: "implementation" });
  review();
  op("update", { action: "set_phase", phase: "implementation" });
  op("update", { action: "complete" });
  op("reject", { gate: "review", note: "revise" });
  review("Needs Revision");
  op("approve", { gate: "review" });
  op("update", { action: "set_phase", phase: "implementation" });
  review();
  op("reopen");
  op("reject", { gate: "review" });
  op("approve", { gate: "review" });
  op("update", { action: "add_blocker", summary: "open blocker" });
  op("update", { action: "complete" });
  const blocker = current().blockers[0].id;
  // Generated blocker IDs differ across hosts; select each host's concrete generated ID.
  const legacyBlocker = tools.get("mh_get_ux_workflow").run(ctx).workflow
    .blockers[0].id;
  const originalResolve = tools.get("mh_update_ux_workflow").run;
  tools.get("mh_update_ux_workflow").run = (c: any) =>
    originalResolve({
      ...c,
      args:
        c.args.action === "resolve_blocker"
          ? { ...c.args, blocker_id: legacyBlocker }
          : c.args,
    });
  op("update", { action: "resolve_blocker", blocker_id: blocker });
  op("update", { action: "complete" });
  op("reopen");
  op("update", { action: "add_blocker", summary: "immutable" });
  op("clear");
  tools.get("mh_update_ux_workflow").run = originalResolve;
  for (const readiness of ["prototype_ready", "implementation_ready"]) {
    reset();
    implementation(readiness);
    assert.equal(current().stage, "implementation");
    review("Not Ready");
    op("reopen");
    review();
    op("approve", { gate: "review" });
    op("update", { action: "complete" });
  }
  console.log("UX_DIFFERENTIAL_CASES", cases);
});

test("actual original bounds: text/long/list/research/concepts/blockers/history and three review iterations", () => {
  reset();
  op("create", { summary: "x".repeat(4001) });
  op("create", { summary: "x".repeat(4000) });
  op("update", {
    action: "set_frame",
    problem: "p",
    audience: "x".repeat(1201),
    desired_outcome: "d",
  });
  op("update", {
    action: "set_frame",
    problem: "p",
    audience: "x".repeat(1200),
    desired_outcome: "d",
    constraints: Array(25).fill("c"),
  });
  op("update", {
    action: "set_frame",
    problem: "p",
    audience: "x".repeat(1200),
    desired_outcome: "d",
    constraints: Array(24).fill("c"),
  });
  for (let i = 0; i < 31; i++)
    op("update", {
      action: "add_research",
      kind: "metadata",
      summary: "optional",
      reference: "opaque",
    });
  assert.equal(current().research.length, 30);
  op("update", { action: "set_brief", brief });
  op("update", { action: "set_phase", phase: "design" });
  for (let i = 0; i < 13; i++)
    op("update", {
      action: "add_concept",
      concept_id: `a-${i}`,
      title: "A",
      summary: "A",
    });
  assert.equal(current().concepts.length, 12);
  for (let i = 0; i < 31; i++)
    op("update", { action: "add_blocker", summary: "bounded" });
  assert.equal(current().blockers.length, 30);
  for (let i = 0; i < 85; i++) op("update", { action: "set_brief", brief });
  assert.equal(current().history.length, 80);
  op("update", {
    action: "set_phase",
    phase: "implementation",
    expected_revision: 1,
  });
  reset();
  implementation();
  for (let i = 0; i < 3; i++) {
    review("Needs Revision");
    op("update", { action: "set_phase", phase: "implementation" });
  }
  assert.equal(current().stage, "review");
  assert.equal(current().reviewIterations, 3);
  op("reopen");
  op("reject", { gate: "review" });
  console.log("UX_DIFFERENTIAL_TOTAL", cases);
});

test("actual original and native both bound 256 session scopes without sole-workflow fallback", () => {
  reset();
  for (let i = 0; i <= 256; i++) {
    const sessionId = `session-${i}`,
      args = { summary: "bounded scope" };
    if (i < 256) {
      const native = applyUX(state, { ...scope, sessionId }, "create", args);
      const legacy = tools
        .get("mh_create_ux_workflow")
        .run({ ...ctx, conversationId: sessionId, args }).workflow;
      assert.deepEqual(normalized(native), normalized(legacy));
    } else {
      assert.throws(
        () => applyUX(state, { ...scope, sessionId }, "create", args),
        /256/,
      );
      assert.throws(
        () =>
          tools
            .get("mh_create_ux_workflow")
            .run({ ...ctx, conversationId: sessionId, args }),
        /256/,
      );
    }
  }
  validateState(state, scope.profile, scope.project);
  console.log("UX_SCOPE_DIFFERENTIAL_CASES", 257);
});

test("native adaptation: closed fields, native-only identity, envelope bounds and no session fallback", () => {
  const s = emptyState(scope.profile, scope.project);
  applyUX(s, scope, "create", { summary: "native only" });
  assert.equal(runAt(s, { ...scope, sessionId: "new-session" }), null);
  for (const extra of [
    { actor: "human" },
    { approval: true },
    { workflow_id: "other" },
    { goal_id: "other" },
    { timestamp: "now" },
  ])
    assert.throws(() =>
      applyUX(s, scope, "update", {
        action: "add_blocker",
        expected_revision: 1,
        summary: "x",
        ...extra,
      }),
    );
  for (const mutate of [
    (v: any) => (v.runs[scope.sessionId].agentId = "fabricated"),
    (v: any) => (v.runs[scope.sessionId].history[0].authority = true),
    (v: any) => (v.sequence = -1),
    (v: any) => (v.extra = true),
  ]) {
    const draft = structuredClone(s);
    mutate(draft);
    assert.throws(() => validateState(draft, scope.profile, scope.project));
  }
});
