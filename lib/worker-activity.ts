import { randomUUID } from "node:crypto";
import {
  herdrBinding,
  type Job,
  publishMetadata,
  type Run,
  run,
} from "./status.ts";

export const WORKER_CAP = 256;
export const WORKER_TTL_MS = 30_000;
export const WORKER_HEARTBEAT_MS = 10_000;
export const WORKER_TOKENS = [
  "mahiro_pi_workers_schema",
  "mahiro_pi_workers_running",
  "mahiro_pi_workers_queued",
  "mahiro_pi_workers_owner",
] as const;
export interface WorkerCounts {
  running: number;
  queued: number;
}
export interface WorkerService {
  listAgents(): unknown;
}
export interface WorkerAPI {
  getSubagentsServiceForSession?: (
    manager: object,
  ) => WorkerService | undefined;
}
export function workerCounts(snapshot: unknown): WorkerCounts | undefined {
  if (!Array.isArray(snapshot) || snapshot.length > WORKER_CAP) return;
  let running = 0;
  let queued = 0;
  for (const record of snapshot) {
    if (!record || typeof record !== "object") return;
    switch (record.status) {
      case "running":
        running++;
        break;
      case "queued":
        queued++;
        break;
      case "completed":
      case "aborted":
      case "stopped":
      case "error":
        break;
      default:
        return;
    }
  }
  return { running, queued };
}
export function workerArgs(
  pane: string,
  counts: WorkerCounts | undefined,
  epoch: string,
  seq: number,
): string[] {
  if (!/^[0-9a-f-]{36}$/.test(epoch)) throw new Error("Invalid worker epoch");
  if (
    counts &&
    ![counts.running, counts.queued].every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n <= WORKER_CAP,
    )
  )
    throw new Error("Invalid worker counts");
  const args = [
    "pane",
    "report-metadata",
    pane,
    "--source",
    "mahiro:pi-workers",
    "--agent",
    "pi",
    "--seq",
    String(seq),
    "--ttl-ms",
    String(WORKER_TTL_MS),
  ];
  const values = counts
    ? ["1", String(counts.running), String(counts.queued), epoch]
    : [];
  WORKER_TOKENS.forEach((key, i) => {
    args.push(
      ...(counts ? ["--token", `${key}=${values[i]}`] : ["--clear-token", key]),
    );
  });
  return args;
}
export interface WorkerOwner {
  seq: number;
  generation?: object;
  dispose?: () => void;
}
const key = Symbol.for("mahirocoko.pi-workers.owner.v1");
export function workerOwner(): WorkerOwner {
  const root = globalThis as typeof globalThis & { [key]?: WorkerOwner };
  return (root[key] ??= { seq: Date.now() * 1000 });
}
interface Context {
  mode: string;
  sessionManager: object;
}
interface Options {
  env?: NodeJS.ProcessEnv;
  run?: Run;
  owner?: WorkerOwner;
  load?: () => Promise<WorkerAPI>;
  now?: () => number;
  every?: (callback: () => void, ms: number) => () => void;
  // Optional explicitly enabled consumer. Same scoped service/poll/generation,
  // never a second registry or a caller-supplied substitute service.
  observe?: (read: () => unknown, current: () => boolean) => void;
}

/** Optional display metadata only. No UI, task, completion or provider mutation. */
export function startWorkerActivity(ctx: Context, options: Options = {}) {
  const noop = () => {};
  // Must precede even touching the shared owner: embedded RPC children share PID/env.
  if (ctx.mode !== "tui") return { tick: noop, dispose: noop };
  const binding = herdrBinding(options.env ?? process.env);
  if (!binding) return { tick: noop, dispose: noop };
  const owner = options.owner ?? workerOwner();
  owner.dispose?.();
  const generation = {};
  owner.generation = generation;
  const epoch = randomUUID();
  const manager = ctx.sessionManager;
  const execute = options.run ?? run;
  const now = options.now ?? Date.now;
  let alive = true;
  let invalidated = false;
  let api: WorkerAPI | undefined;
  let loading = false;
  let service: WorkerService | undefined;
  let job: Job | undefined;
  let last = "";
  let at = -Infinity;
  let retryAt = -Infinity;
  let failures = 0;
  let desired: WorkerCounts | undefined;
  let stop = noop;
  const owned = () => owner.generation === generation;
  const scoped = () => {
    if (ctx.sessionManager !== manager) return undefined;
    return typeof api?.getSubagentsServiceForSession === "function"
      ? api.getSubagentsServiceForSession(manager)
      : undefined;
  };
  function valid() {
    if (!alive || !owned() || invalidated) return false;
    try {
      if (service && scoped() !== service) {
        invalidated = true;
        desired = undefined;
        return false;
      }
    } catch {
      invalidated = true;
      desired = undefined;
      return false;
    }
    return true;
  }
  function flush() {
    if (!owned() || job || now() < retryAt) return;
    const counts = alive && !invalidated ? desired : undefined;
    const serialized = JSON.stringify(counts ?? null);
    if (serialized === last && now() - at < WORKER_HEARTBEAT_MS) return;
    // Recheck after process-info's await, immediately before spawning report-metadata.
    const guarded: Run = (command, args, cwd, env) => {
      if (!owned()) throw new Error("Stale worker generation");
      if (args[1] === "report-metadata" && counts && !valid())
        throw new Error("Worker owner changed");
      return execute(command, args, cwd, env);
    };
    try {
      const current = publishMetadata(
        guarded,
        binding!,
        workerArgs(binding!.HERDR_PANE_ID!, counts, epoch, ++owner.seq),
      );
      job = current;
      current.promise
        .then(
          () => {
            if (!owned()) return;
            if (counts && !valid()) return;
            last = serialized;
            at = now();
            failures = 0;
          },
          () => {
            if (!owned()) return;
            failures = Math.min(failures + 1, 5);
            retryAt = now() + Math.min(10_000, 1000 * 2 ** (failures - 1));
          },
        )
        .finally(() => {
          if (job === current) job = undefined;
          // One latest-state follow-up; no unbounded backlog, including disposal clears.
          if (
            owned() &&
            JSON.stringify(
              (alive && !invalidated ? desired : undefined) ?? null,
            ) !== serialized
          )
            flush();
        });
    } catch {
      retryAt = now() + 1000;
    }
  }
  function tick() {
    if (!alive || !owned()) return;
    desired = undefined;
    try {
      if (valid()) {
        const next = scoped();
        if (next && !service) service = next;
        if (next && next === service && typeof next.listAgents === "function") {
          desired = workerCounts(next.listAgents());
          if (!valid()) desired = undefined;
        }
      }
    } catch {
      desired = undefined;
    }
    flush();
    try {
      if (service && valid()) {
        options.observe?.(() => {
          if (!valid()) return undefined;
          const snapshot = service?.listAgents();
          return valid() ? snapshot : undefined;
        }, valid);
      }
    } catch {
      // An optional display consumer cannot break the native count publisher.
    }
    if (!api && !loading && !invalidated) {
      loading = true;
      const load = options.load ?? (() => import("@gotgenes/pi-subagents"));
      Promise.resolve()
        .then(load)
        .then(
          (module) => {
            if (alive && owned()) {
              api = module;
              tick();
            }
          },
          () => {
            /* Old/missing optional package: unknown, TTL/clear rather than zero. */
          },
        );
    }
  }
  function dispose() {
    if (!alive) return;
    alive = false;
    stop();
    desired = undefined;
    job?.cancel();
    // Keep the single-flight slot until cancellation settles. A replacement owns
    // a new generation and old callbacks cannot publish its clear or resurrect it.
    if (owned()) {
      if (owner.dispose === dispose) owner.dispose = undefined;
      last = "";
      flush();
    }
  }
  owner.dispose = dispose;
  const every =
    options.every ??
    ((callback, ms) => {
      const timer = setInterval(callback, ms);
      timer.unref();
      return () => clearInterval(timer);
    });
  stop = every(tick, 1000);
  tick();
  return { tick, dispose };
}
