// Explicit installation consent. Loading resources never invokes this command.
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAgentDir } from "./lib/setup.ts";
import {
  applyBootstrap,
  bootstrapSummary,
  inspectBootstrap,
} from "./lib/bootstrap.ts";

let scaffoldDirectory;
try {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      'Usage: pnpm install:profile [--agent-dir /canonical/profile] [--preview] [--remove-default-deny] [--native-basic-file-policy]\nExplicitly compose one Root guard owner, pinned public permission/subagents resources, three owned system roles, ordinary feature DATA authority and rewrite-rtk default. Retains restrictions, existing RTK off, Core/data and unrelated settings. --remove-default-deny explicitly deletes ONLY scalar permission["*"]="deny" (unset falls back to public ask, never blanket allow). Retained required tool/DATA restrictions refuse before writes; this flag cannot override them. Fresh memory gets a minimal neutral scaffold through guarded native initialization; existing memory is never reseeded. No dependency install, provider call or reload. Startup grants nothing. --native-basic-file-policy independently opts in to finite BASIC read-deny defaults; not a sandbox or complete secret protection. Public runtime policy, project overrides and yolo remain authoritative.',
    );
  } else {
    let agentDir,
      preview = false,
      removeDefaultDeny = false,
      nativeBasicFilePolicy = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--preview" && !preview) preview = true;
      else if (args[i] === "--remove-default-deny" && !removeDefaultDeny)
        removeDefaultDeny = true;
      else if (
        args[i] === "--native-basic-file-policy" &&
        !nativeBasicFilePolicy
      )
        nativeBasicFilePolicy = true;
      else if (args[i] === "--agent-dir" && !agentDir && args[i + 1])
        agentDir = args[++i];
      else throw Error("Invalid install arguments; use --help");
    }
    const profile = resolveAgentDir(agentDir);
    const root = join(profile, "memory");
    const project = realpathSync(process.cwd());
    const fresh = !existsSync(root);
    let seedFile;
    if (fresh) {
      scaffoldDirectory = mkdtempSync(
        join(realpathSync(tmpdir()), "mahiro-install-"),
      );
      seedFile = join(scaffoldDirectory, "scaffold.md");
      writeFileSync(
        seedFile,
        "# Core\n\nAgent-maintained, fallible knowledge. Current human and repository instructions take precedence. No personal identity or imported corpus has been assumed.\n",
        { mode: 0o600, flag: "wx" },
      );
    }
    const plan = inspectBootstrap({
      version: 1,
      agentDir: profile,
      sources: {
        pi: fileURLToPath(new URL("./", import.meta.url)).replace(/\/$/, ""),
      },
      components: {
        packages: true,
        roles: true,
        featureData: true,
        ...(removeDefaultDeny ? { removeDefaultDeny: true } : {}),
        ...(nativeBasicFilePolicy ? { nativeBasicFilePolicy: true } : {}),
        ...(fresh
          ? {
              memory: {
                root,
                project,
                projectId: createHash("sha256").update(project).digest("hex"),
                seedFile,
                automatic: true,
              },
            }
          : {}),
      },
    });
    console.log(
      JSON.stringify(
        preview ? bootstrapSummary(plan) : applyBootstrap(plan, plan.digest),
        null,
        2,
      ),
    );
  }
} catch (error) {
  console.error(
    error instanceof SyntaxError
      ? "Invalid JSON; contents withheld"
      : error.message,
  );
  if (error.receipt) console.error(JSON.stringify(error.receipt));
  process.exitCode = 1;
} finally {
  if (scaffoldDirectory)
    rmSync(scaffoldDirectory, { recursive: true, force: true });
}
