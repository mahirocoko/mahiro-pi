import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  CLEAR_PARAMETERS,
  CREATE_PARAMETERS,
  GET_PARAMETERS,
  UPDATE_PARAMETERS,
  validateGoalInput,
} from "../lib/goal/model.ts";
import { createGoalRuntime, goalTools } from "../lib/goal/runtime.ts";

/** Ordinary installed tools; Goal creation needs human direction. Registration grants nothing and has no profile, state, policy or network I/O. */
export default function mahiroGoal(pi: ExtensionAPI) {
  const runtime = createGoalRuntime(pi);
  const parameters = {
    mh_get_goal: GET_PARAMETERS,
    mh_create_goal: CREATE_PARAMETERS,
    mh_update_goal: UPDATE_PARAMETERS,
    mh_clear_goal: CLEAR_PARAMETERS,
  };
  for (const name of goalTools)
    pi.registerTool({
      name,
      label: name,
      description: {
        mh_get_goal:
          "Read the canonical Goal assigned to this native session and obtain an internal revision ticket before mutation. Canonical project binding; explicit installation grants narrow tool/feature-data authority. Empty reads never create Goals. Branches do not rewind state; new/fork sessions have no Goal until explicitly moved.",
        mh_create_goal:
          "Create a Goal ONLY after Mahiro directly requests or approves it, not from loading skills. Read mh_get_goal first. replace=true explicitly replaces the plan in place preserving the Goal ID, resets blockers/plan, and requires expected_revision. This is requester guidance, not mechanical requester attestation; ordinary model mutations need no new UI approval.",
        mh_update_goal:
          "Update a freshly read canonical Goal using expected_revision. Create/revise/move require explicit human direction. move_goal preserves ID/history and moves only within this profile/project to an empty native session. Add evidence before claiming agent criteria; never verify or claim human criteria. Completion audits required criteria and open blockers, not plan/rules. Ordinary completed edits reject; revise_mission explicitly reopens.",
        mh_clear_goal:
          "Destructively clear the current Goal (or optional exact goal_id in this profile/project) only after explicit human request AND public UI confirmation of its exact Goal ID/revision. Unknown or invalid explicit IDs reject; they never select the current Goal. Read mh_get_goal first. No UI/decline/stale approval writes nothing; revision tickets protect clear/recreate ABA.",
      }[name],
      parameters: parameters[name],
      executionMode: "sequential",
      annotations: {
        readOnlyHint: name === "mh_get_goal",
        destructiveHint: name === "mh_clear_goal",
        idempotentHint: name === "mh_get_goal",
        openWorldHint: false,
      },
      async execute(_id, args, signal, _update, ctx) {
        validateGoalInput(parameters[name], args);
        const result = await runtime.run(name, args, ctx, signal);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      },
    });
  const handler = async (args: string, ctx: any) => {
    try {
      ctx.ui.notify(await runtime.command(args, ctx), "info");
    } catch (error) {
      ctx.ui.notify(
        error instanceof Error ? error.message : "Goal unavailable",
        "error",
      );
    }
  };
  pi.registerCommand("mh-goal", {
    description:
      "Native Goal: status/list; human-directed create/revise/move, plan/rules and confirmed human gates",
    handler,
  });
  pi.registerCommand("mh-goal-status", {
    description: "Read native Goal status (no busy panel or Herdr publication)",
    handler: (_args, ctx) => handler("status", ctx),
  });
}
