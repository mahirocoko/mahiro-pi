import assert from "node:assert/strict";
import test from "node:test";
import { applyGoal, emptyState, resolveGoalTarget } from "../lib/goal/model.ts";

const scope = {
  profile: "/offline/profile",
  project: "/offline/project",
  sessionId: "one",
};
const create = {
  objective: "Exact target",
  criteria: [{ text: "Proof", owner: "agent" }],
};

test("explicit Goal selectors never fall back; domain rejects before mutation", () => {
  const state = emptyState(scope.profile, scope.project);
  const one = applyGoal(state, scope, "create", create);
  const other = { ...scope, sessionId: "two" };
  const two = applyGoal(state, other, "create", create);
  const bytes = JSON.stringify(state);
  for (const goal_id of [
    "missing",
    "",
    " ",
    undefined,
    null,
    "__proto__",
    "constructor",
  ]) {
    assert.throws(() =>
      applyGoal(state, scope, "clear", { goal_id, expected_revision: 1 }),
    );
    assert.throws(() =>
      applyGoal(state, scope, "update", {
        goal_id,
        action: "set_phase",
        phase: "wrong",
        expected_revision: 1,
      }),
    );
    assert.throws(() =>
      applyGoal(state, scope, "human", {
        goal_id,
        action: "move_goal",
        expected_revision: 1,
      }),
    );
    assert.throws(() =>
      applyGoal(state, scope, "create", {
        ...create,
        replace: true,
        goal_id,
        action: "move_goal",
        expected_revision: 1,
      }),
    );
    assert.equal(JSON.stringify(state), bytes);
  }
  assert.throws(() =>
    applyGoal(state, scope, "clear", { goal_id: one.id, expected_revision: 2 }),
  );
  assert.equal(JSON.stringify(state), bytes);
  assert.equal(resolveGoalTarget(state, scope, {})?.id, one.id);
  assert.equal(
    applyGoal(state, scope, "clear", { goal_id: two.id, expected_revision: 1 })
      .id,
    two.id,
  );
  assert.deepEqual(state.goals[one.id], one);
  assert.equal(state.sessions.one, one.id);
  assert.equal(state.sessions.two, undefined);
  assert.equal(
    applyGoal(state, scope, "clear", { expected_revision: 1 }).id,
    one.id,
  );
  const empty = JSON.stringify(state);
  assert.throws(() =>
    applyGoal(state, scope, "clear", {
      goal_id: "missing",
      expected_revision: 1,
    }),
  );
  assert.equal(JSON.stringify(state), empty);
});
