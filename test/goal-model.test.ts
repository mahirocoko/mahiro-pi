import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  applyGoal,
  completionIssues,
  emptyState,
  goalAt,
  validateState,
  validateGoalInput,
  CREATE_PARAMETERS,
} from "../lib/goal/model.ts";

const base = resolve(".agent-state/runtime/goal-port");
mkdirSync(base, { recursive: true, mode: 0o700 });
const fixture = mkdtempSync(join(base, "differential-"));
const project = join(fixture, "project");
mkdirSync(project, { mode: 0o700 });
const scope = {
  profile: "/isolated-native-profile",
  project,
  sessionId: "native-session-one",
};
const create = {
  objective: "Offline differential mission",
  criteria: [
    { text: "Agent proof", owner: "agent" },
    { text: "Human proof", owner: "human" },
  ],
  rules: [{ text: "Stay scoped", level: "must" }],
};

test("differential traces against actual canonical Letta source: create/replace/revise/claim/evidence/verify/blockers/complete/clear/move", async (t) => {
  const saved = {
    state: process.env.MAHIRO_GOAL_STATE_PATH,
    disable: process.env.MAHIRO_GOAL_DISABLE_PATH,
  };
  process.env.MAHIRO_GOAL_STATE_PATH = join(fixture, "original.state.json");
  process.env.MAHIRO_GOAL_DISABLE_PATH = join(fixture, "original.disabled");
  const original = resolve(import.meta.dirname, "oracles/letta/mahiro-goal.ts");
  const tools = new Map<string, any>();
  let command: any;
  let dispose: any;
  try {
    const module = await import(
      `${pathToFileURL(original).href}?goal-differential=${Date.now()}`
    );
    dispose = await module.default({
      signal: new AbortController().signal,
      capabilities: { tools: true, commands: true },
      tools: {
        register(t: any) {
          tools.set(t.name, t);
          return () => {};
        },
      },
      commands: {
        register(c: any) {
          if (c.id === "mh-goal") command = c.run;
          return () => {};
        },
      },
    });
    t.mock.timers.enable({
      apis: ["Date"],
      now: Date.parse("2026-10-19T12:00:00.000Z"),
    });
    let state = emptyState(scope.profile, project),
      currentScope = { ...scope };
    const ctx = (args: any = {}) => ({
      cwd: project,
      agent: { id: "original-agent" },
      conversation: { id: currentScope.sessionId },
      args,
    });
    const normalize = (value: any) => {
      const ids = new Map<string, string>();
      return JSON.parse(
        JSON.stringify(value, (key, item) => {
          if (
            ["profile", "sessionId", "agentId", "conversationId"].includes(key)
          )
            return undefined;
          if (
            [
              "createdAt",
              "updatedAt",
              "activeStartedAt",
              "resolvedAt",
              "at",
            ].includes(key)
          )
            return item === null ? null : "TIME";
          if (typeof item === "string") {
            if (/^(mh-goal-|rule-|plan-|blocker-|evidence-)/.test(item)) {
              if (!ids.has(item)) ids.set(item, `ID-${ids.size}`);
              return ids.get(item);
            }
            if (item.startsWith("Moved from "))
              return "MOVE-HOST-IDENTITY-ADAPTATION";
          }
          return item;
        }),
      );
    };
    const originalGoal = () =>
      JSON.parse(tools.get("mh_get_goal").run(ctx()).output).goal;
    const compare = () =>
      assert.deepEqual(
        normalize(goalAt(state, currentScope)),
        normalize(originalGoal()),
      );
    const act = (
      operation: "create" | "update" | "clear" | "human",
      args: any,
      originalCommand?: string,
    ) => {
      const draft = structuredClone(state),
        originalArgs = { ...args };
      for (const [field, collection] of [
        ["plan_id", "plan"],
        ["rule_id", "rules"],
        ["blocker_id", "blockers"],
      ]) {
        if (args[field]) {
          const index = (goalAt(state, currentScope) as any)?.[
            collection
          ].findIndex((entry: any) => entry.id === args[field]);
          if (index >= 0)
            originalArgs[field] = originalGoal()[collection][index].id;
        }
      }
      let next, leftError, rightError;
      try {
        next = applyGoal(draft, currentScope, operation, args);
      } catch (error) {
        leftError = error;
      }
      try {
        if (originalCommand) {
          const result = command(ctx(originalCommand));
          if (result.success === false) throw Error(result.output);
        } else
          tools
            .get(
              operation === "create"
                ? "mh_create_goal"
                : operation === "clear"
                  ? "mh_clear_goal"
                  : "mh_update_goal",
            )
            .run(ctx(originalArgs));
      } catch (error) {
        rightError = error;
      }
      assert.equal(
        !!leftError,
        !!rightError,
        `error parity ${JSON.stringify(args)}: ${leftError} / ${rightError}`,
      );
      if (!leftError) state = draft;
      compare();
      return next;
    };
    act("create", create);
    const firstId = goalAt(state, currentScope)!.id;
    act("update", {
      action: "claim_criterion",
      expected_revision: 1,
      criterion_id: "criterion-01",
    });
    act("update", {
      action: "claim_criterion",
      expected_revision: 1,
      criterion_id: "criterion-02",
    });
    act("update", { action: "complete", expected_revision: 1 });
    act("update", {
      action: "add_evidence",
      expected_revision: 1,
      criterion_id: "criterion-01",
      summary: "Actual offline test",
      kind: "test",
      reference: "fixture.log",
    });
    act("update", {
      action: "claim_criterion",
      expected_revision: 2,
      criterion_id: "criterion-01",
      summary: "proof attached",
    });
    act(
      "human",
      {
        action: "verify",
        expected_revision: 3,
        criterion_id: "criterion-02",
        summary: "confirmed",
      },
      "verify criterion-02 confirmed",
    );
    act("update", {
      action: "add_plan_item",
      expected_revision: 4,
      plan_text: "Pending plan is not a DoD gate",
    });
    act("update", {
      action: "add_blocker",
      expected_revision: 5,
      summary: "Blocking fixture",
    });
    act("update", { action: "complete", expected_revision: 6 });
    const blocker = goalAt(state, currentScope)!.blockers[0].id;
    const originalBlocker = originalGoal().blockers[0].id;
    // Dynamic opaque IDs are normalized, never replaced by mocks of original logic.
    tools.get("mh_update_goal").run(
      ctx({
        action: "resolve_blocker",
        expected_revision: 6,
        blocker_id: originalBlocker,
      }),
    );
    applyGoal(state, currentScope, "update", {
      action: "resolve_blocker",
      expected_revision: 6,
      blocker_id: blocker,
    });
    compare();
    act("update", { action: "complete", expected_revision: 7 });
    assert.equal(goalAt(state, currentScope)!.plan[0].status, "pending");
    act("update", {
      action: "set_phase",
      expected_revision: 8,
      phase: "forbidden ordinary completed edit",
    });
    act("update", {
      action: "revise_mission",
      expected_revision: 8,
      objective: "Explicit reopen",
    });
    assert.equal(goalAt(state, currentScope)!.criteria[0].evidence.length, 1);
    act("human", { action: "pause", expected_revision: 9 }, "pause");
    act("update", {
      action: "revise_mission",
      expected_revision: 10,
      phase: "reopened",
    });
    act("create", { ...create, replace: true, expected_revision: 11 });
    assert.equal(goalAt(state, currentScope)!.id, firstId);
    assert.deepEqual(goalAt(state, currentScope)!.plan, []);
    assert.deepEqual(goalAt(state, currentScope)!.blockers, []);
    currentScope = { ...scope, sessionId: "native-session-two" };
    compare();
    const sourceId = firstId,
      originalId = JSON.parse(
        readFileSync(process.env.MAHIRO_GOAL_STATE_PATH!, "utf8"),
      ).goals[JSON.stringify(["original-agent", scope.sessionId, ""])].id;
    tools.get("mh_update_goal").run(
      ctx({
        action: "move_goal",
        goal_id: originalId,
        expected_revision: 12,
      }),
    );
    applyGoal(state, currentScope, "update", {
      action: "move_goal",
      goal_id: sourceId,
      expected_revision: 12,
    });
    compare();
    assert.equal(state.sessions[scope.sessionId], undefined);
    assert.equal(goalAt(state, currentScope)!.id, firstId);
    act("clear", { expected_revision: 13 });
    act("create", create);
    assert.notEqual(goalAt(state, currentScope)!.id, firstId);
    assert.equal(goalAt(state, currentScope)!.revision, 1);
    const update = (args: any) =>
      act("update", {
        expected_revision: goalAt(state, currentScope)!.revision,
        ...args,
      });
    const human = (action: string, commandText: string) =>
      act(
        "human",
        { action, expected_revision: goalAt(state, currentScope)!.revision },
        commandText,
      );
    t.mock.timers.tick(3500);
    human("pause", "pause");
    assert.equal(goalAt(state, currentScope)!.activeTimeSeconds, 3);
    t.mock.timers.tick(5000);
    assert.equal(goalAt(state, currentScope)!.activeTimeSeconds, 3);
    human("resume", "resume");
    t.mock.timers.tick(2500);
    human("pause", "pause");
    assert.equal(goalAt(state, currentScope)!.activeTimeSeconds, 5);
    update({ action: "revise_mission", phase: "explicit reopen" });
    update({
      action: "revise_mission",
      criteria: [
        { text: "Required agent" },
        { text: "Optional human", owner: "human", required: false },
      ],
      non_goals: Array(20).fill("bounded"),
    });
    update({ action: "revise_mission", non_goals: Array(21).fill("overflow") });
    update({ action: "revise_mission", criteria: [{ text: "x".repeat(801) }] });
    update({ action: "revise_mission", objective: "x".repeat(4001) });
    for (let index = 0; index < 30; index++)
      update({
        action: "add_evidence",
        criterion_id: "criterion-01",
        summary: `evidence ${index}`,
        kind: "test",
      });
    update({
      action: "add_evidence",
      criterion_id: "criterion-01",
      summary: "overflow",
    });
    update({ action: "claim_criterion", criterion_id: "criterion-01" });
    for (let index = 0; index < 30; index++)
      update({ action: "add_plan_item", plan_text: `plan ${index}` });
    update({ action: "add_plan_item", plan_text: "overflow" });
    const planId = goalAt(state, currentScope)!.plan[0].id;
    update({
      action: "update_plan_item",
      plan_id: planId,
      plan_text: "edited",
      plan_status: "in_progress",
      plan_note: "note",
    });
    update({
      action: "update_plan_item",
      plan_id: planId,
      clear_plan_note: true,
    });
    update({
      action: "update_plan_item",
      plan_id: planId,
      plan_status: "unsupported",
    });
    update({ action: "remove_plan_item", plan_id: planId });
    while (goalAt(state, currentScope)!.rules.length < 8)
      update({
        action: "add_rule",
        rule_text: "bounded rule",
        rule_level: "must",
      });
    update({ action: "add_rule", rule_text: "overflow" });
    const ruleId = goalAt(state, currentScope)!.rules[0].id;
    update({
      action: "update_rule",
      rule_id: ruleId,
      rule_text: "edited",
      rule_level: "prefer",
    });
    update({
      action: "update_rule",
      rule_id: ruleId,
      rule_text: "x".repeat(501),
    });
    update({ action: "remove_rule", rule_id: ruleId });
    for (let index = 0; index < 30; index++)
      update({ action: "add_blocker", summary: `blocker ${index}` });
    update({ action: "add_blocker", summary: "overflow" });
    update({ action: "complete" });
    for (const blocker of [...goalAt(state, currentScope)!.blockers])
      update({ action: "resolve_blocker", blocker_id: blocker.id });
    update({ action: "complete" });
    assert.equal(goalAt(state, currentScope)!.status, "complete");
    assert.ok(
      goalAt(state, currentScope)!.plan.some(
        (item) => item.status === "pending",
      ),
    );
    assert.equal(
      goalAt(state, currentScope)!.criteria[1].status,
      "pending",
      "optional human is not an extra DoD gate",
    );
    update({ action: "set_phase", phase: "ordinary completed edit denied" });
  } finally {
    dispose?.();
    for (const [key, value] of [
      ["MAHIRO_GOAL_STATE_PATH", saved.state],
      ["MAHIRO_GOAL_DISABLE_PATH", saved.disable],
    ])
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
  }
});

test("bounds, closed direct-execute inputs and native envelope invariants", () => {
  for (const args of [
    { ...create, objective: "x".repeat(4001) },
    { ...create, criteria: [] },
    { ...create, criteria: Array.from({ length: 21 }, () => ({ text: "x" })) },
    { ...create, rules: Array.from({ length: 9 }, () => ({ text: "x" })) },
  ])
    assert.throws(() =>
      applyGoal(emptyState(scope.profile, project), scope, "create", args),
    );
  assert.throws(() =>
    validateGoalInput(CREATE_PARAMETERS, { ...create, actor: "human" }),
  );
  assert.throws(() =>
    validateGoalInput(CREATE_PARAMETERS, {
      ...create,
      criteria: [{ text: "x", owner: "system" }],
    }),
  );
  const state = emptyState(scope.profile, project);
  applyGoal(state, scope, "create", create);
  for (let index = 1; index < 100; index++)
    applyGoal(state, scope, "update", {
      action: "set_phase",
      phase: "phase",
      expected_revision: index,
    });
  assert.equal(goalAt(state, scope)!.history.length, 80);
  const bad = structuredClone(state);
  bad.sessions.foreign = goalAt(state, scope)!.id;
  assert.throws(() => validateState(bad, scope.profile, project));
  assert.ok(completionIssues(goalAt(state, scope)!).length);
  applyGoal(state, scope, "update", {
    action: "add_evidence",
    expected_revision: 100,
    criterion_id: "criterion-01",
    summary: "bounded",
  });
  applyGoal(state, scope, "update", {
    action: "add_plan_item",
    expected_revision: 101,
    plan_text: "bounded",
  });
  applyGoal(state, scope, "update", {
    action: "add_blocker",
    expected_revision: 102,
    summary: "bounded",
  });
  for (const change of [
    (goal: any) => (goal.criteria[0].extra = "hidden"),
    (goal: any) => (goal.criteria[0].evidence[0].extra = "hidden"),
    (goal: any) => (goal.plan[0].extra = "hidden"),
    (goal: any) => (goal.blockers[0].extra = "hidden"),
    (goal: any) => (goal.history[0].extra = "hidden"),
    (goal: any) => (goal.rules[0].extra = "hidden"),
    (goal: any) => goal.criteria.push(structuredClone(goal.criteria[0])),
    (goal: any) => (goal.blockers[0].resolvedAt = "not-an-ISO-time"),
    (goal: any) => (goal.history[0].revision = goal.revision + 1),
    (goal: any) => (goal.activeStartedAt = null),
  ]) {
    const malformed = structuredClone(state);
    change(goalAt(malformed, scope));
    assert.throws(() => validateState(malformed, scope.profile, project));
  }
});
