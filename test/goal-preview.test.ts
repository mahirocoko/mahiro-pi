import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import activate from "../extensions/mahiro-goal.ts";

const base = path.resolve(".agent-state/runtime/goal-port/repair");
fs.mkdirSync(base, { recursive: true, mode: 0o700 });

test("Goal registration is inert; exactly four closed model tools and two native commands", () => {
  const tools: any[] = [],
    commands: string[] = [],
    events: string[] = [];
  activate({
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: (name: string) => commands.push(name),
    on: (name: string) => events.push(name),
  } as any);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["mh_get_goal", "mh_create_goal", "mh_update_goal", "mh_clear_goal"],
  );
  assert.deepEqual(commands, ["mh-goal", "mh-goal-status"]);
  for (const tool of tools) {
    assert.equal(tool.parameters.additionalProperties, false);
    assert.equal(tool.executionMode, "sequential");
  }
  assert.ok(events.includes("session_before_tree"));
});

test("source-only Goal preview validates explicit native scope and writes no profile/config/grant/state", async () => {
  const root = fs.mkdtempSync(path.join(base, "preview-")),
    primary = path.join(root, "primary"),
    profile = path.join(root, "absent-profile"),
    project = path.join(root, "project");
  for (const dir of [primary, project]) fs.mkdirSync(dir, { mode: 0o700 });
  fs.cpSync(path.resolve("lib"), path.join(primary, "lib"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.resolve("goal-preview.mjs"),
    path.join(primary, "goal-preview.mjs"),
  );
  const s = await import(
    pathToFileURL(path.join(primary, "lib/goal/store.ts")).href
  );
  const preview = s.previewGoalConfiguration([project], profile);
  assert.equal(preview.applied, false);
  assert.equal(preview.permissionsGranted, false);
  assert.equal(preview.stateInitialized, false);
  assert.equal(fs.existsSync(profile), false);
  assert.match(preview.scopes[0].capability, /^goal_state_[a-f0-9]{64}$/);
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      [path.join(primary, "goal-preview.mjs"), ...args],
      {
        encoding: "utf8",
        env: { ...process.env, PI_CODING_AGENT_DIR: profile },
        timeout: 10000,
      },
    );
  const result = run(["--project", project]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), preview);
  for (const args of [
    [],
    ["--apply", project],
    ["--project", `${project}/../project`],
    ["--project", project, "--project", project],
    ["--project", project, "--agent-dir", "relative"],
  ])
    assert.equal(run(args).status, 1);
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = profile;
  try {
    assert.equal(s.resolveGoalBinding(project), null);
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
  }
  assert.equal(fs.existsSync(profile), false);
  assert.deepEqual(fs.readdirSync(root).sort(), ["primary", "project"]);
});
