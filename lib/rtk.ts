// Native, opt-in RTK control. No Letta settings, history DB, probes or rewrite subprocess.
// Deterministic bounded command grammar; authorization remains the public policy owner.
import { join, resolve } from "node:path";
import {
  assertPreferenceBinding,
  preferenceBinding,
  preferenceHash,
  publishPreference,
  readPreferenceFile,
} from "./model-profiles.ts";

export const rtkModes = [
  "off",
  "suggest",
  "rewrite-safe",
  "rewrite-rtk",
] as const;
export type RTKMode = (typeof rtkModes)[number];
export function rtkCandidate(command: unknown, mode: RTKMode) {
  if (
    mode === "off" ||
    typeof command !== "string" ||
    command.length > 4096 ||
    !command ||
    command !== command.trim() ||
    !/^[A-Za-z0-9_./:@%+,= -]+$/.test(command)
  )
    return null;
  const words = command.split(/ +/);
  if (words.length > 64 || words.some((w) => w.length > 512)) return null;
  const [executable, sub, ...rest] = words;
  let paths: string[] = [],
    rewritten: string;
  if (executable === "git") {
    const commands =
      mode === "rewrite-rtk"
        ? ["status", "diff", "log", "show"]
        : ["status", "diff"];
    if (!commands.includes(sub)) return null;
    const flags = new Set([
      "--short",
      "--branch",
      "--porcelain",
      "--stat",
      "--shortstat",
      "--name-only",
      "--name-status",
      "--oneline",
      "--no-color",
      "--",
      "-s",
      "-b",
    ]);
    if (rest.some((w) => w.startsWith("-") && !flags.has(w))) return null;
    paths = rest.filter((w) => !w.startsWith("-"));
    rewritten = `rtk ${words.join(" ")}`;
  } else if (executable === "ls") {
    const args = words.slice(1);
    if (
      args.some((w) => w.startsWith("-") && !/^-[alh1]+$/.test(w) && w !== "--")
    )
      return null;
    paths = args.filter((w) => !w.startsWith("-"));
    rewritten = `rtk ${words.join(" ")}`;
  } else if (executable === "cat" && mode === "rewrite-rtk") {
    const args = words.slice(1);
    if (!args.length || args.some((w) => w.startsWith("-"))) return null;
    paths = args;
    rewritten = `rtk read ${args.join(" ")}`;
  } else return null;
  return { command: rewritten, paths };
}
const validate = (s: any) => {
  if (
    !s ||
    s.version !== 1 ||
    !Number.isSafeInteger(s.sequence) ||
    s.sequence < 0 ||
    !rtkModes.includes(s.mode) ||
    Object.keys(s).some((k) => !["version", "sequence", "mode"].includes(k))
  )
    throw Error("Invalid private RTK state");
};
export function registerRTK(
  pi: any,
  owner: {
    access: (ctx: any, root: string, operation: string) => void;
    finalArgs: (name: string, args: any, ctx: any) => Promise<any>;
    permission: (ctx: any, surface: string, value?: string) => any;
    current: (ctx: any) => boolean;
  },
) {
  let mode: RTKMode = "off",
    binding: ReturnType<typeof preferenceBinding> = null,
    epoch = 0,
    alive = true;
  const recent: any[] = [];
  const read = (ctx: any, operation = "read") => {
    const b = preferenceBinding(ctx.cwd, "rtk");
    if (!b)
      throw Error(
        "RTK disabled; explicit private project configuration required",
      );
    owner.access(ctx, b.root, operation);
    assertPreferenceBinding(b);
    const text = readPreferenceFile(join(b.root, "state.json"));
    const state =
      text === null
        ? { version: 1, sequence: 0, mode: "off" }
        : JSON.parse(text);
    validate(state);
    return { b, state, ticket: preferenceHash(text ?? "<absent>") };
  };
  pi.on("session_shutdown", () => {
    alive = false;
    epoch++;
    mode = "off";
    binding = null;
    recent.length = 0;
  });
  const run = async (args: any, ctx: any) => {
    if (
      !args ||
      Array.isArray(args) ||
      Object.keys(args).some(
        (k) =>
          !["operation", "mode", "expected_sequence", "command"].includes(k),
      )
    )
      throw Error("Closed RTK arguments required");
    if (!alive || !owner.current(ctx) || ctx.signal?.aborted)
      throw Error("RTK generation unavailable");
    const { b, state, ticket } = read(
      ctx,
      args.operation === "mode" ? "write" : "read",
    );
    if (args.operation === "mode") {
      if (
        !rtkModes.includes(args.mode) ||
        args.expected_sequence !== state.sequence ||
        !ctx.hasUI ||
        !["rpc", "tui"].includes(ctx.mode)
      )
        throw Error("RTK mode requires exact sequence and actual UI");
      const captured = epoch,
        manager = ctx.sessionManager,
        session = manager.getSessionId();
      if (
        !(await ctx.ui.confirm(
          "Mahiro RTK mode",
          `${args.mode}\nSequence: ${state.sequence}\nSession: ${session}\nProject: ${b.project}\nProfile: ${b.profile}\nNo settings hooks, history access or binary probe. Final original and rewritten authorization required.`,
        ))
      )
        throw Error("RTK mode declined");
      const assert = () => {
        if (
          !alive ||
          captured !== epoch ||
          ctx.sessionManager !== manager ||
          manager.getSessionId() !== session ||
          !owner.current(ctx)
        )
          throw Error("RTK session replaced");
        owner.access(ctx, b.root, "write");
        assertPreferenceBinding(b);
      };
      assert();
      const next = {
        version: 1,
        sequence: state.sequence + 1,
        mode: args.mode,
      };
      publishPreference(b, ticket, next, assert, validate);
      mode = next.mode;
      binding = b;
      epoch++;
      return { mode, sequence: next.sequence, hooksChanged: false };
    }
    if (
      ![
        "status",
        "log",
        "rewrite",
        "doctor",
        "guidance",
        "gain",
        "projects",
      ].includes(args.operation)
    )
      throw Error("Unknown RTK operation");
    if (args.operation === "rewrite")
      return {
        candidate: rtkCandidate(args.command, "rewrite-rtk")?.command ?? null,
        executed: false,
        binarySyntaxVerified: false,
      };
    return {
      mode: state.mode,
      sequence: state.sequence,
      activeThisGeneration: mode,
      recent: args.operation === "log" ? structuredClone(recent) : undefined,
      savings: "unverified; no history reads or native usage/quota changes",
      binaryProbe: false,
      supported:
        "bounded git status/diff; rewrite-rtk additionally git log/show and cat->rtk read; no arbitrary RTK helper evaluation",
    };
  };
  pi.registerTool({
    name: "mh_rtk",
    label: "Mahiro RTK",
    description:
      "Native opt-in RTK control and preview. Off by default; no probes/history or savings claims. Mode writes require exact sequence and actual UI.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "status",
            "mode",
            "log",
            "rewrite",
            "doctor",
            "guidance",
            "gain",
            "projects",
          ],
        },
        mode: { type: "string", enum: [...rtkModes] },
        expected_sequence: { type: "integer", minimum: 0 },
        command: { type: "string", maxLength: 4096 },
      },
      required: ["operation"],
      additionalProperties: false,
    },
    async execute(
      _id: string,
      args: any,
      signal: AbortSignal,
      _update: any,
      ctx: any,
    ) {
      if (signal?.aborted) throw Error("RTK cancelled");
      const details = await run(args, { ...ctx, signal: signal ?? ctx.signal });
      return {
        content: [{ type: "text", text: JSON.stringify(details) }],
        details,
      };
    },
  });
  pi.registerCommand("mh-rtk", {
    description:
      "Native RTK status | mode <off|suggest|rewrite-safe|rewrite-rtk> <sequence> | rewrite <command> | log | doctor | guidance",
    handler: async (input: string, ctx: any) => {
      try {
        if (input.length > 8192 || /[\x00-\x1f\x7f]/.test(input))
          throw Error("Bounded RTK command required");
        const [operation = "status", requested, sequence] = input
          .trim()
          .split(/\s+/);
        const args =
          operation === "mode"
            ? {
                operation,
                mode: requested,
                expected_sequence: /^\d+$/.test(sequence ?? "")
                  ? Number(sequence)
                  : -1,
              }
            : operation === "rewrite"
              ? { operation, command: input.slice(input.indexOf(" ") + 1) }
              : { operation };
        ctx.ui.notify(JSON.stringify(await run(args, ctx)), "info");
      } catch (e) {
        ctx.ui.notify(e instanceof Error ? e.message : "RTK failed", "error");
      }
    },
  });
  return {
    initialize(ctx: any) {
      epoch++;
      mode = "off";
      binding = null;
      try {
        const current = read(ctx);
        mode = current.state.mode;
        binding = current.b;
      } catch {
        /* Unconfigured/unattested is disabled, never a grant. */
      }
    },
    async transform(input: any, ctx: any) {
      // The disabled fast path performs no filesystem read, probe, helper or log work.
      if (mode === "off") return input;
      const captured = epoch;
      const assert = () => {
        if (
          !alive ||
          captured !== epoch ||
          !owner.current(ctx) ||
          ctx.signal?.aborted ||
          !binding ||
          binding.project !== ctx.cwd
        )
          throw Error("RTK stale/cancelled");
        const current = read(ctx);
        if (current.state.mode !== mode)
          throw Error("RTK configuration changed");
      };
      assert();
      // Always inspect the original BEFORE considering any rewrite, even unsupported syntax.
      const original = await owner.finalArgs("bash", input, ctx);
      assert();
      const candidate = rtkCandidate(original.command, mode);
      if (!candidate) return original;
      const authorize = (command: string) => {
        const d = owner.permission(ctx, "bash", command);
        if (d?.state !== "allow" || d.origin === "yolo")
          throw Error("RTK original/final Bash permission required");
      };
      authorize(input.command);
      authorize(original.command);
      for (const operand of candidate.paths.length ? candidate.paths : ["."]) {
        const path = resolve(ctx.cwd, operand);
        if (path !== ctx.cwd && !path.startsWith(`${ctx.cwd}/`))
          throw Error("RTK external operand unsupported");
        for (const surface of ["read", "path_read"]) {
          const d = owner.permission(ctx, surface, path);
          if (d?.matchedPattern !== undefined && d.state !== "allow")
            throw Error("RTK operand read denied");
        }
      }
      const final = await owner.finalArgs(
        "bash",
        { ...original, command: candidate.command },
        ctx,
      );
      assert();
      if (final.command !== candidate.command)
        throw Error("RTK final transformation changed");
      authorize(input.command);
      authorize(final.command);
      assert();
      recent.unshift({
        action: mode === "suggest" ? "suggested" : "rewritten",
        commandHash: preferenceHash(input.command),
        savingsVerified: false,
      });
      recent.length = Math.min(recent.length, 20);
      return mode === "suggest" ? original : final;
    },
  };
}
