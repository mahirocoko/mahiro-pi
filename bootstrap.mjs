import {
  applyBootstrap,
  bootstrapSummary,
  inspectBootstrap,
  readBootstrapRequest,
} from "./lib/bootstrap.ts";

const help =
  "Usage: pnpm run bootstrap --manifest /absolute/private/bootstrap.json --plan\n       pnpm run bootstrap --manifest /absolute/private/bootstrap.json --apply --expect-plan <sha256>\nPrivate canonical sibling bootstrap only. No network/dependency-install/auth/default-provider changes. Preview writes nothing.";
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0]))
    console.log(help);
  else {
    let mode, manifest, expected;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (["--plan", "--apply"].includes(arg) && !mode) mode = arg.slice(2);
      else if (
        ["--manifest", "--expect-plan"].includes(arg) &&
        args[index + 1] &&
        !args[index + 1].startsWith("--")
      ) {
        if (arg === "--manifest" && !manifest) manifest = args[++index];
        else if (arg === "--expect-plan" && !expected) expected = args[++index];
        else throw new Error("Duplicate bootstrap argument");
      } else throw new Error("Invalid bootstrap arguments; use --help");
    }
    if (
      !manifest ||
      !mode ||
      (mode === "apply" && !expected) ||
      (mode === "plan" && expected)
    )
      throw new Error(
        "Explicit manifest/mode/reviewed digest required; use --help",
      );
    const plan = inspectBootstrap(readBootstrapRequest(manifest));
    console.log(
      JSON.stringify(
        mode === "plan"
          ? bootstrapSummary(plan)
          : applyBootstrap(plan, expected),
        null,
        2,
      ),
    );
  }
} catch (error) {
  console.error(
    error instanceof SyntaxError
      ? "Invalid strict JSON input; contents withheld"
      : error instanceof Error
        ? error.message
        : "Bootstrap failed",
  );
  if (error?.receipt) console.error(JSON.stringify(error.receipt));
  process.exitCode = 1;
}
