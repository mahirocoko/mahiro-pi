import {
  applySetup,
  inspectSetup,
  resolveAgentDir,
  setupSummary,
} from "./lib/setup.ts";

const help =
  "Usage: pnpm run setup [--plan | --apply] [--agent-dir /absolute/canonical/path]\nDefault: preview only. Configures only the default skill permission; installs nothing.";
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(help);
  } else {
    let mode = "plan";
    let selected = false;
    let explicit;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (["--plan", "--apply"].includes(arg) && !selected) {
        mode = arg.slice(2);
        selected = true;
      } else if (
        arg === "--agent-dir" &&
        explicit === undefined &&
        args[index + 1] &&
        !args[index + 1].startsWith("--")
      ) {
        explicit = args[++index];
      } else {
        throw new Error("Invalid setup arguments; use --help");
      }
    }
    const agentDir = resolveAgentDir(explicit);
    const plan = inspectSetup(agentDir);
    console.log(
      JSON.stringify(
        {
          mode,
          ...(mode === "apply"
            ? applySetup(agentDir, plan)
            : setupSummary(plan)),
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Setup failed");
  if (error?.receipt) console.error(JSON.stringify(error.receipt));
  process.exitCode = 1;
}
