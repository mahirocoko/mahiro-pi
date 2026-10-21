import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  bytes,
  digest,
  hasSecret,
  objectShape,
  validId,
} from "../continuity/records.ts";
import { assertPrivatePath } from "../continuity/store.ts";

export interface MemoryConfig {
  version: 1;
  projects: { cwd: string; id: string }[];
  coreBytes: number;
  indexBytes: number;
  fileBytes: number;
  totalBytes: number;
  automatic: boolean;
}
export interface MemoryFile {
  text: string;
  sources: string[];
}
export interface Snapshot {
  revision: string;
  files: Record<string, MemoryFile>;
  forgottenPaths: string[];
  forgottenSources: { project: string | null; source: string }[];
  reviewed: string[];
}
export interface View {
  id: string;
  project: string;
  /** Absent on retained v1 views means project-scoped, NEVER shared. */
  scope?: "primary";
  configHash: string;
  base: Snapshot;
  files: Record<string, MemoryFile>;
  state: "open" | "committed" | "conflict" | "cancelled";
  deadline: number;
}
export const memoryLimits = Object.freeze({
  files: 512,
  fileBytes: 256 * 1024,
  totalBytes: 8 * 1024 * 1024,
  ledgerBytes: 131072,
  viewBytes: 40 * 1024 * 1024,
});
// Valid text has at most 2 JSON bytes per UTF-8 byte (quotes, backslashes,
// tabs/newlines and lone surrogates). Two 8-MiB copies therefore use <=32 MiB;
// independently bounded ledgers/path/source metadata fit in the remaining 8 MiB.
// Exact serialized-byte preflight below is authoritative, including all metadata.
export const memoryViewDerivedBytes =
  4 * memoryLimits.totalBytes +
  2 * memoryLimits.ledgerBytes +
  64 * memoryLimits.files +
  1024;
const hash = /^[a-f0-9]{40,64}$/;
const name = /^[a-z0-9][a-z0-9-]{0,63}$/;
const copy = <T>(value: T): T => structuredClone(value);
const equal = isDeepStrictEqual;
export const allowedPath = (path: string, project?: string) => {
  if (typeof path !== "string") return false;
  if (["Core.md", "index.md"].includes(path)) return true;
  if (/^(global|procedures)\/[a-z0-9][a-z0-9-]{0,63}\.md$/.test(path))
    return true;
  const match =
    /^deferred\/([a-z0-9][a-z0-9-]{0,63})\/[a-z0-9][a-z0-9-]{0,63}\.md$/.exec(
      path,
    );
  return !!match && (!project || match[1] === project);
};
const privateRead = (path: string, max: number, prefixBytes?: number) => {
  assertPrivatePath(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.mode & 0o077 ||
      stat.size > max
    )
      throw new Error("Private file unavailable");
    if (prefixBytes !== undefined) {
      const prefix = Buffer.alloc(Math.min(stat.size, prefixBytes));
      const length = readSync(fd, prefix, 0, prefix.length, 0);
      return prefix.subarray(0, length).toString("utf8");
    }
    const raw = readFileSync(fd, "utf8");
    if (bytes(raw) > max) throw new Error("Private file bound exceeded");
    return raw;
  } finally {
    closeSync(fd);
  }
};
const privateDirectory = (path: string) => {
  assertPrivatePath(path);
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.mode & 0o077)
    throw new Error("Private directory required");
};
const atomic = (path: string, value: string) => {
  assertPrivatePath(path);
  privateDirectory(dirname(path));
  if (
    existsSync(path) &&
    (!lstatSync(path).isFile() || lstatSync(path).nlink !== 1)
  )
    throw new Error("Unsafe file");
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, value, { mode: 0o600, flag: "wx" });
  renameSync(temp, path);
};
export function parseConfig(raw: string): MemoryConfig {
  const c = JSON.parse(raw);
  if (
    !c ||
    Object.keys(c).sort().join() !==
      "automatic,coreBytes,fileBytes,indexBytes,projects,totalBytes,version" ||
    c.version !== 1 ||
    typeof c.automatic !== "boolean" ||
    !Array.isArray(c.projects) ||
    !c.projects.length ||
    c.projects.length > 128
  )
    throw new Error("Invalid memory configuration");
  for (const key of ["coreBytes", "indexBytes", "fileBytes", "totalBytes"])
    if (!Number.isSafeInteger(c[key]) || c[key] < 256)
      throw new Error("Invalid memory budget");
  if (
    c.coreBytes > 32768 ||
    c.indexBytes > 8192 ||
    c.fileBytes > memoryLimits.fileBytes ||
    c.totalBytes > memoryLimits.totalBytes
  )
    throw new Error("Memory configured budget ceiling exceeded");
  const seen = new Set();
  for (const p of c.projects) {
    if (
      !p ||
      Object.keys(p).sort().join() !== "cwd,id" ||
      !isAbsolute(p.cwd) ||
      resolve(p.cwd) !== p.cwd ||
      typeof p.id !== "string" ||
      !name.test(p.id) ||
      seen.has(p.cwd)
    )
      throw new Error("Invalid memory project");
    assertPrivatePath(p.cwd);
    seen.add(p.cwd);
  }
  return c;
}
export function createMemoryStore(
  root: string,
  current: (path?: string) => void = () => {},
  authority: "scoped" | "primary" = "scoped",
) {
  if (!isAbsolute(root) || resolve(root) !== root)
    throw new Error("Canonical memory root required");
  const safe = (deadline?: number) => {
    const withinDeadline = () => {
      if (deadline !== undefined && Date.now() >= deadline)
        throw new Error("Memory snapshot deadline");
    };
    current();
    withinDeadline();
    assertPrivatePath(root);
    if (
      existsSync(root) &&
      (!lstatSync(root).isDirectory() || lstatSync(root).mode & 0o077)
    )
      throw new Error("Private root required");
    // Git metadata is private too. Refuse linked repositories/worktrees and hostile hooks.
    if (existsSync(join(root, ".git"))) {
      assertPrivatePath(join(root, ".git"));
      if (!lstatSync(join(root, ".git")).isDirectory())
        throw new Error("Standalone memory repository required");
      current(join(root, ".git"));
      const pending = [join(root, ".git")];
      let count = 0;
      while (pending.length) {
        const path = pending.pop()!;
        let entries;
        try {
          entries = readdirSync(path, { withFileTypes: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        for (const entry of entries) {
          withinDeadline();
          if (++count > 8192)
            throw new Error("Memory Git metadata capacity exceeded");
          const child = join(path, entry.name);
          let stat;
          try {
            stat = lstatSync(child);
          } catch (error) {
            // Git may remove transient locks after directory enumeration.
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw error;
          }
          if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1))
            throw new Error("Linked Git metadata refused");
          if (stat.isDirectory()) pending.push(child);
        }
      }
    }
  };
  const git = (args: string[], input?: string, deadline?: number) => {
    safe(deadline);
    return execFileSync("git", ["--no-pager", ...args], {
      cwd: root,
      shell: false,
      encoding: "utf8",
      timeout:
        deadline === undefined
          ? 10000
          : Math.max(1, Math.min(10000, deadline - Date.now())),
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
        GIT_INDEX_FILE: undefined,
        GIT_OBJECT_DIRECTORY: undefined,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
        GIT_CONFIG_COUNT: undefined,
        GIT_TERMINAL_PROMPT: "0",
      },
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
  };
  const read = (path: string, max: number) => {
    current(path);
    return privateRead(path, max);
  };
  const write = (path: string, text: string) => {
    current(path);
    atomic(path, text);
  };
  const config = (deadline?: number) => {
    safe(deadline);
    return parseConfig(read(join(root, "config.json"), 65536));
  };
  const validate = (files: Record<string, MemoryFile>, c = config()) => {
    const paths = Object.keys(files);
    if (
      paths.length > memoryLimits.files ||
      !files["Core.md"] ||
      !files["index.md"]
    )
      throw new Error("Memory layout required");
    let total = 0;
    for (const path of paths) {
      const file = files[path];
      if (
        !allowedPath(path) ||
        !file ||
        Object.keys(file).sort().join() !== "sources,text" ||
        typeof file.text !== "string" ||
        !file.text.endsWith("\n") ||
        hasSecret(file.text) ||
        /[\x00-\x08\x0b-\x1f\x7f]/.test(file.text) ||
        !Array.isArray(file.sources) ||
        file.sources.length > 32 ||
        file.sources.some((s) => !validId(s)) ||
        new Set(file.sources).size !== file.sources.length
      )
        throw new Error("Unsafe memory content");
      const max =
        path === "Core.md"
          ? c.coreBytes
          : path === "index.md"
            ? c.indexBytes
            : c.fileBytes;
      if (bytes(file.text) > max)
        throw new Error("Memory file budget exceeded");
      total += bytes(file.text);
    }
    if (total > c.totalBytes) throw new Error("Memory total budget exceeded");
  };
  const head = (deadline?: number) => {
    const rev = git(
      ["rev-parse", "--verify", "HEAD"],
      undefined,
      deadline,
    ).trim();
    if (!hash.test(rev)) throw new Error("Invalid revision");
    return rev;
  };
  const parseLedger = (raw: string) => {
    if (bytes(raw) > memoryLimits.ledgerBytes)
      throw new Error("Memory ledger budget exceeded");
    const state = JSON.parse(raw);
    if (
      !state ||
      Object.keys(state).sort().join() !==
        "forgottenPaths,forgottenSources,reviewed,sources,version" ||
      state.version !== 2 ||
      !state.sources ||
      typeof state.sources !== "object" ||
      Array.isArray(state.sources) ||
      Object.keys(state.sources).length > memoryLimits.files ||
      !Object.hasOwn(state.sources, "Core.md") ||
      !Object.hasOwn(state.sources, "index.md")
    )
      throw new Error("Invalid memory ledger");
    for (const [path, sources] of Object.entries(state.sources))
      if (
        !allowedPath(path) ||
        !Array.isArray(sources) ||
        sources.length > 32 ||
        new Set(sources).size !== sources.length ||
        sources.some((s) => !validId(s))
      )
        throw new Error("Invalid memory source metadata");
    for (const key of ["forgottenPaths", "forgottenSources", "reviewed"])
      if (
        !Array.isArray(state[key]) ||
        state[key].length > 4096 ||
        state[key].some((s: unknown) =>
          key === "forgottenPaths"
            ? typeof s !== "string" || !allowedPath(s)
            : key === "reviewed"
              ? !validId(s)
              : !objectShape(s, ["project", "source"]) ||
                Object.keys(s).length !== 2 ||
                !(
                  s.project === null ||
                  (typeof s.project === "string" && name.test(s.project))
                ) ||
                !validId(s.source),
        )
      )
        throw new Error("Invalid memory ledger");
    for (const key of ["forgottenPaths", "forgottenSources", "reviewed"])
      if (
        new Set(state[key].map((value: unknown) => JSON.stringify(value)))
          .size !== state[key].length
      )
        throw new Error("Duplicate memory ledger entry");
    return state;
  };
  const ledger = (revision: string, deadline?: number) => {
    if (!hash.test(revision)) throw new Error("Invalid revision");
    current(join(root, ".memory.json"));
    return parseLedger(
      git(["show", `${revision}:.memory.json`], undefined, deadline),
    );
  };
  const sourceForgotten = (
    s: Snapshot,
    source: string,
    project: string | null,
  ) =>
    s.forgottenSources.some(
      (entry) => entry.project === project && entry.source === source,
    );
  const suppressed = (s: Snapshot, path: string, file: MemoryFile) =>
    s.forgottenPaths.includes(path) ||
    file.sources.some((source) =>
      sourceForgotten(
        s,
        source,
        path.startsWith("deferred/") ? path.split("/")[1] : null,
      ),
    );
  const managementProject = (project?: string) => {
    const projects = config().projects;
    const selected =
      project ?? (projects.length === 1 ? projects[0].id : undefined);
    if (
      !selected ||
      !name.test(selected) ||
      (authority !== "primary" && !projects.some((p) => p.id === selected))
    )
      throw new Error("Explicit mapped management scope required");
    return selected;
  };
  const load = (requested?: string): Snapshot => {
    const deadline = Date.now() + 15000;
    const withinDeadline = () => {
      if (Date.now() >= deadline) throw new Error("Memory snapshot deadline");
    };
    const revision = requested ?? head(deadline);
    if (!hash.test(revision)) throw new Error("Invalid revision");
    const state = ledger(revision, deadline);
    const c = config(deadline);
    const files: Record<string, MemoryFile> = {};
    // Fixed-argv Git remains the object owner. Inspect immutable blob sizes first,
    // then read <=1 MiB batches under the unchanged 2-MiB command output bound.
    // Each command still walks/checks Git metadata; no cached security decision.
    const entries = git(
      ["ls-tree", "-rlz", revision],
      undefined,
      deadline,
    ).split("\0");
    const objects: { path: string; oid: string; size: number }[] = [];
    let total = 0;
    for (const entry of entries) {
      if (!entry) continue;
      const match =
        /^(100644|100755) blob ([a-f0-9]{40,64}) +([0-9]+)\t(.+)$/.exec(entry);
      if (!match || !Object.hasOwn(state.sources, match[4])) continue;
      const [, , oid, length, path] = match;
      current(join(root, path));
      const size = Number(length);
      const max =
        path === "Core.md"
          ? c.coreBytes
          : path === "index.md"
            ? c.indexBytes
            : c.fileBytes;
      if (!allowedPath(path) || size > max)
        throw new Error("Memory file budget exceeded");
      total += size;
      objects.push({ path, oid, size });
    }
    if (objects.length !== Object.keys(state.sources).length)
      throw new Error("Missing tracked memory blob");
    if (total > c.totalBytes) throw new Error("Memory total budget exceeded");
    for (let start = 0; start < objects.length; ) {
      withinDeadline();
      const batch: typeof objects = [];
      let size = 0;
      while (
        start < objects.length &&
        size + objects[start].size <= 1024 * 1024
      ) {
        const object = objects[start++];
        batch.push(object);
        size += object.size;
      }
      const raw = Buffer.from(
        git(
          ["cat-file", "--batch"],
          batch.map((o) => o.oid).join("\n") + "\n",
          deadline,
        ),
        "utf8",
      );
      let offset = 0;
      for (const object of batch) {
        const end = raw.indexOf(10, offset);
        if (
          end < 0 ||
          raw.subarray(offset, end).toString() !==
            `${object.oid} blob ${object.size}` ||
          raw[end + 1 + object.size] !== 10
        )
          throw new Error("Invalid memory Git object");
        files[object.path] = {
          text: raw.subarray(end + 1, end + 1 + object.size).toString("utf8"),
          sources: state.sources[object.path],
        };
        offset = end + object.size + 2;
      }
      if (offset !== raw.length) throw new Error("Invalid memory Git batch");
    }
    validate(files, c);
    withinDeadline();
    return {
      revision,
      files,
      forgottenPaths: state.forgottenPaths,
      forgottenSources: state.forgottenSources,
      reviewed: state.reviewed,
    };
  };
  const lock = <T>(run: () => T): T => {
    safe();
    const path = join(root, ".lock");
    mkdirSync(path, { mode: 0o700 });
    try {
      current();
      return run();
    } finally {
      rmdirSync(path);
    }
  };
  const writeRevision = (
    previous: Snapshot | undefined,
    next: Omit<Snapshot, "revision">,
    message: string,
  ) => {
    validate(next.files);
    if (previous && head() !== previous.revision)
      throw new Error("Stale memory revision");
    if (
      previous &&
      git(["status", "--porcelain", "--untracked-files=no"]).trim()
    )
      throw new Error(
        "Uncommitted memory work requires explicit recovery; draft retained",
      );
    for (const path of Object.keys(next.files))
      if (previous && !previous.files[path] && existsSync(join(root, path)))
        throw new Error("Untracked memory file would be overwritten");
    if (
      previous &&
      equal(previous.files, next.files) &&
      equal(previous.forgottenPaths, next.forgottenPaths) &&
      equal(previous.forgottenSources, next.forgottenSources) &&
      equal(previous.reviewed, next.reviewed)
    )
      return previous;
    const ledger = {
      version: 2,
      sources: Object.fromEntries(
        Object.entries(next.files).map(([p, f]) => [p, f.sources]),
      ),
      forgottenPaths: next.forgottenPaths,
      forgottenSources: next.forgottenSources,
      reviewed: next.reviewed,
    };
    // Use exactly the reader's complete validator before touching worktree/index/HEAD.
    const ledgerText = `${JSON.stringify(ledger)}\n`;
    parseLedger(ledgerText);
    // HEAD is the publication boundary. Failed commits leave recoverable work, not active context.
    for (const path of Object.keys(previous?.files ?? {}))
      if (!next.files[path]) {
        const full = join(root, path);
        current(full);
        assertPrivatePath(full);
        if (existsSync(full)) {
          if (!lstatSync(full).isFile() || lstatSync(full).nlink !== 1)
            throw new Error("Unsafe file");
          unlinkSync(full);
        }
      }
    for (const [path, file] of Object.entries(next.files)) {
      current();
      write(join(root, path), file.text);
    }
    write(join(root, ".memory.json"), ledgerText);
    current();
    const paths = [
      ...new Set([
        ".memory.json",
        ...Object.keys(previous?.files ?? {}),
        ...Object.keys(next.files),
      ]),
    ];
    git(["add", "--", ...paths]);
    current();
    git(["commit", "-m", message]);
    return load();
  };
  const validateView = (v: View) => {
    if (
      !objectShape(v, [
        "id",
        "project",
        "scope",
        "configHash",
        "base",
        "files",
        "state",
        "deadline",
      ]) ||
      ![7, 8].includes(Object.keys(v).length) ||
      (v.scope !== undefined &&
        (v.scope !== "primary" || authority !== "primary")) ||
      typeof v.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(v.id) ||
      typeof v.project !== "string" ||
      !name.test(v.project) ||
      typeof v.configHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(v.configHash) ||
      !["open", "committed", "conflict", "cancelled"].includes(v.state) ||
      !Number.isSafeInteger(v.deadline) ||
      !objectShape(v.base, [
        "revision",
        "files",
        "forgottenPaths",
        "forgottenSources",
        "reviewed",
      ]) ||
      Object.keys(v.base).length !== 5 ||
      !hash.test(v.base.revision)
    )
      throw new Error("Invalid private view metadata");
    // Retained conflicts must remain inspectable/discardable after budget shrink.
    // Use fixed supported ceilings here; active use separately checks configHash.
    const ceiling = {
      coreBytes: 32768,
      indexBytes: 8192,
      fileBytes: memoryLimits.fileBytes,
      totalBytes: memoryLimits.totalBytes,
    } as MemoryConfig;
    for (const files of [v.base.files, v.files]) {
      if (!files || typeof files !== "object" || Array.isArray(files))
        throw new Error("Invalid private view files");
      validate(files, ceiling);
      if (
        Object.keys(files).some(
          (p) => !allowedPath(p, v.scope === "primary" ? undefined : v.project),
        )
      )
        throw new Error("Invalid private view scope");
      parseLedger(
        JSON.stringify({
          version: 2,
          sources: Object.fromEntries(
            Object.entries(files).map(([p, f]) => [p, f.sources]),
          ),
          forgottenPaths: v.base.forgottenPaths,
          forgottenSources: v.base.forgottenSources,
          reviewed: v.base.reviewed,
        }),
      );
    }
  };
  const serializeView = (v: View) => {
    validateView(v);
    // Stable bounded prefix supports lightweight enumeration without parsing bodies.
    const raw = `${JSON.stringify({
      id: v.id,
      project: v.project,
      state: v.state,
      deadline: v.deadline,
      ...(v.scope === "primary" ? { scope: v.scope } : {}),
      configHash: v.configHash,
      base: v.base,
      files: v.files,
    })}\n`;
    if (bytes(raw) > memoryLimits.viewBytes)
      throw new Error("Private view budget exceeded");
    return raw;
  };
  const readView = (id: string): View => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid private view id");
    const v = JSON.parse(
      read(join(root, ".views", `${id}.json`), memoryLimits.viewBytes),
    ) as View;
    validateView(v);
    if (v.id !== id) throw new Error("Invalid private view metadata");
    return v;
  };
  const saveView = (v: View) => {
    // Complete reader-equivalent validation and exact serialization BEFORE writes.
    const raw = serializeView(v);
    for (const [path, file] of Object.entries(v.files))
      write(join(root, ".views", v.id, path), file.text);
    write(join(root, ".views", `${v.id}.json`), raw);
  };
  const checkView = (v: View) => {
    safe();
    if (
      !/^[a-f0-9-]{36}$/.test(v.id) ||
      !name.test(v.project) ||
      v.state !== "open" ||
      Date.now() >= v.deadline ||
      digest(JSON.stringify(config())) !== v.configHash
    )
      throw new Error("Memory view inactive");
    if (!equal(readView(v.id), v)) throw new Error("Stale memory view");
    const c = config();
    validate(v.base.files, c);
    validate(v.files, c);
    for (const [path, file] of Object.entries(v.files))
      if (
        read(
          join(root, ".views", v.id, path),
          Math.max(c.fileBytes, c.coreBytes, c.indexBytes),
        ) !== file.text
      )
        throw new Error("Memory view changed externally");
  };
  const filter = (s: Snapshot, project?: string) =>
    Object.fromEntries(
      Object.entries(s.files).filter(([p]) => allowedPath(p, project)),
    );
  const episode = (value: unknown) => {
    if (
      !objectShape(value, [
        "id",
        "project",
        "session",
        "evidence",
        "observedAt",
        "entryHash",
        "input",
        "actions",
        "results",
        "outcome",
      ]) ||
      typeof value.id !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.id) ||
      typeof value.project !== "string" ||
      !name.test(value.project) ||
      !validId(value.session) ||
      value.evidence !== "observed-native-unverified" ||
      value.outcome !== "completed" ||
      typeof value.observedAt !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.observedAt) ||
      typeof value.entryHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.entryHash) ||
      !objectShape(value.input, ["text", "source"]) ||
      typeof value.input.text !== "string" ||
      !["rpc", "interactive"].includes(value.input.source as string) ||
      !Array.isArray(value.actions) ||
      value.actions.length > 4 ||
      !Array.isArray(value.results) ||
      value.results.length > 4
    )
      throw new Error(
        "Invalid observed episode; caller provenance labels are not accepted",
      );
    for (const action of value.actions)
      if (
        !objectShape(action, ["text", "tools"]) ||
        (action.text !== undefined && typeof action.text !== "string") ||
        (action.tools !== undefined &&
          (!Array.isArray(action.tools) ||
            action.tools.length > 8 ||
            action.tools.some(
              (n: unknown) =>
                typeof n !== "string" || !/^[a-z_]{1,64}$/.test(n),
            )))
      )
        throw new Error("Invalid observed action");
    for (const result of value.results)
      if (
        !objectShape(result, ["tool", "error", "text"]) ||
        result.tool !== "bash" ||
        typeof result.error !== "boolean" ||
        (result.text !== undefined && typeof result.text !== "string")
      )
        throw new Error("Invalid selected result");
    const raw = JSON.stringify(value);
    if (bytes(raw) > 16384 || hasSecret(raw))
      throw new Error("Episode rejected");
    return value;
  };
  const views = () => {
    const folder = join(root, ".views");
    if (!existsSync(folder)) return [];
    current(folder);
    assertPrivatePath(folder);
    const names = readdirSync(folder).filter((p) =>
      /^[a-f0-9-]{36}\.json$/.test(p),
    );
    if (names.length > 64) throw new Error("Private view capacity exceeded");
    // Only bounded headers are retained. Older serialization falls back to one
    // full validated view at a time; no proposal is dropped for a format change.
    return names
      .map((p) => {
        const path = join(folder, p);
        current(path);
        const prefix = privateRead(path, memoryLimits.viewBytes, 1024);
        const match =
          /^(\{"id":"[a-f0-9-]{36}","project":"[a-z0-9][a-z0-9-]{0,63}","state":"(?:open|committed|conflict|cancelled)","deadline":[0-9]+(?:,"scope":"primary")?),"configHash":"[a-f0-9]{64}","base":/.exec(
            prefix,
          );
        const v = match ? JSON.parse(`${match[1]}}`) : readView(p.slice(0, -5));
        if (v.id !== p.slice(0, -5) || !Number.isSafeInteger(v.deadline))
          throw new Error("Invalid private view metadata");
        return {
          id: v.id as string,
          project: v.project as string,
          scope: v.scope as View["scope"],
          state: v.state as View["state"],
          deadline: v.deadline as number,
        };
      })
      .filter((v) => authority === "primary" || v.scope !== "primary");
  };
  return {
    root,
    config,
    snapshot: load,
    initialize(c: MemoryConfig, core: string, index = "# Memory index\n") {
      parseConfig(JSON.stringify(c));
      if (existsSync(root))
        throw new Error(
          "New private root required; existing bootstrap is never overwritten",
        );
      current();
      privateDirectory(root);
      chmodSync(root, 0o700);
      write(join(root, "config.json"), `${JSON.stringify(c)}\n`);
      write(
        join(root, ".gitignore"),
        "config.json\n.views/\n.episodes/\n.lock/\n",
      );
      git(["init", "--quiet"]);
      // Product code never writes identity or bypasses commit hooks.
      git(["add", "--", ".gitignore"]);
      return lock(() =>
        writeRevision(
          undefined,
          {
            files: {
              "Core.md": { text: core, sources: [] },
              "index.md": { text: index, sources: [] },
            },
            forgottenPaths: [],
            forgottenSources: [],
            reviewed: [],
          },
          "Initialize private managed memory",
        ),
      );
    },
    createView(project: string, ttlMs = 120000, shared = false): View {
      if (
        !name.test(project) ||
        (shared && authority !== "primary") ||
        !Number.isSafeInteger(ttlMs) ||
        ttlMs < 1000 ||
        ttlMs > 600000
      )
        throw new Error("Invalid view scope");
      const retained = views();
      let remaining = retained.length;
      if (retained.length >= 32)
        for (const old of retained)
          if (
            ["committed", "cancelled"].includes(old.state) ||
            (old.state === "open" && old.deadline <= Date.now())
          ) {
            // A header is discovery only, never deletion authority. Hydrate and
            // validate the selected body before reclaiming any proposal.
            const selected = readView(old.id);
            if (
              selected.state !== old.state ||
              selected.deadline !== old.deadline ||
              selected.project !== old.project
            )
              throw new Error("Stale private view summary; proposal retained");
            const folder = join(root, ".views", old.id);
            current(folder);
            assertPrivatePath(folder);
            rmSync(folder, { recursive: true, force: true });
            const metadata = join(root, ".views", `${old.id}.json`);
            current(metadata);
            unlinkSync(metadata);
            remaining--;
          }
      if (remaining >= 64)
        throw new Error(
          "Private conflicts require manual resolution before more views",
        );
      const base = load();
      const v: View = {
        id: randomUUID(),
        project,
        configHash: digest(JSON.stringify(config())),
        ...(shared ? { scope: "primary" as const } : {}),
        base: { ...base, files: filter(base, shared ? undefined : project) },
        files: copy(filter(base, shared ? undefined : project)),
        state: "open",
        deadline: Date.now() + ttlMs,
      };
      saveView(v);
      return v;
    },
    read(v: View, path: string) {
      checkView(v);
      if (!allowedPath(path, v.scope === "primary" ? undefined : v.project))
        throw new Error("Memory path outside scope");
      const f = v.files[path];
      return f
        ? { ...copy(f), hash: digest(f.text) }
        : { missing: true, hash: null };
    },
    edit(
      v: View,
      path: string,
      expectedHash: string | null,
      text: string | null,
      sources: string[] = [],
    ) {
      checkView(v);
      if (
        !allowedPath(path, v.scope === "primary" ? undefined : v.project) ||
        (v.files[path] ? digest(v.files[path].text) : null) !== expectedHash
      )
        throw new Error("Stale file or path outside scope");
      if (text === null && ["Core.md", "index.md"].includes(path))
        throw new Error("Core and index cannot be removed");
      const next = copy(v);
      if (text === null) delete next.files[path];
      else next.files[path] = { text, sources: [...sources].sort() };
      validate(next.files);
      saveView(next);
      Object.assign(v, next);
      return text === null ? null : digest(text);
    },
    cancel(v: View) {
      checkView(v);
      const next = { ...v, state: "cancelled" as const };
      saveView(next);
      Object.assign(v, next);
    },
    integrate(v: View, reviewed: string[] = []) {
      checkView(v);
      return lock(() => {
        checkView(v);
        const now = load();
        const next = copy(now);
        const changed = [
          ...new Set([...Object.keys(v.base.files), ...Object.keys(v.files)]),
        ].filter((p) => !equal(v.base.files[p], v.files[p]));
        if (
          !changed.length &&
          reviewed.every((id) => now.reviewed.includes(id))
        ) {
          v.state = "committed";
          saveView(v);
          return { revision: now.revision, changed: 0 };
        }
        const conflicts = changed.filter(
          (p) =>
            !allowedPath(p, v.scope === "primary" ? undefined : v.project) ||
            (v.files[p]
              ? suppressed(now, p, v.files[p])
              : now.forgottenPaths.includes(p)) ||
            (!equal(v.base.files[p], now.files[p]) &&
              !equal(v.files[p], now.files[p])),
        );
        if (conflicts.length) {
          v.state = "conflict";
          saveView(v);
          return { conflict: conflicts, view: v.id };
        }
        for (const p of changed) {
          if (v.files[p]) next.files[p] = copy(v.files[p]);
          else delete next.files[p];
        }
        if (reviewed.some((id) => !validId(id)))
          throw new Error("Invalid episode cursor");
        next.reviewed = [...new Set([...now.reviewed, ...reviewed])];
        serializeView({ ...v, state: "committed" });
        const committed = writeRevision(
          now,
          next,
          "Maintain private agent memory",
        );
        v.state = "committed";
        saveView(v);
        return { revision: committed.revision, changed: changed.length };
      });
    },
    forget(
      expected: string,
      paths: string[],
      sources: string[],
      project?: string,
    ) {
      const scope = managementProject(project);
      if (
        !Array.isArray(paths) ||
        !Array.isArray(sources) ||
        (!paths.length && !sources.length) ||
        paths.length > 128 ||
        sources.length > 128 ||
        paths.some(
          (p) => !allowedPath(p, scope) || ["Core.md", "index.md"].includes(p),
        ) ||
        sources.some((s) => !validId(s))
      )
        throw new Error(
          "Invalid forgetting scope; revise Core/index explicitly",
        );
      return lock(() => {
        const now = load();
        if (now.revision !== expected) throw new Error("Stale memory revision");
        const next = copy(now);
        next.forgottenPaths = [...new Set([...now.forgottenPaths, ...paths])];
        // Source IDs are caller-supplied and may be unknown or reused in another
        // project. Tombstone only this project and the intentionally shared files.
        for (const source of sources)
          for (const project of [scope, null])
            if (!sourceForgotten(next, source, project))
              next.forgottenSources.push({ project, source });
        for (const [p, file] of Object.entries(next.files))
          if (
            allowedPath(p, scope) &&
            (paths.includes(p) || file.sources.some((s) => sources.includes(s)))
          ) {
            if (["Core.md", "index.md"].includes(p))
              throw new Error(
                "Revise Core/index and remove the source link before forgetting; preserve established identity",
              );
            else delete next.files[p];
          }
        return writeRevision(
          now,
          next,
          "Forget active managed knowledge (history retained)",
        );
      });
    },
    rollback(expected: string, revision: string, project?: string) {
      const scope = managementProject(project);
      return lock(() => {
        const now = load();
        if (now.revision !== expected) throw new Error("Stale memory revision");
        const old = load(revision);
        const next = copy(now);
        for (const p of Object.keys(next.files))
          if (allowedPath(p, scope)) delete next.files[p];
        Object.assign(next.files, copy(filter(old, scope)));
        for (const [p, file] of Object.entries(next.files))
          if (allowedPath(p, scope) && suppressed(now, p, file)) {
            if (["Core.md", "index.md"].includes(p))
              next.files[p] = copy(now.files[p]);
            else delete next.files[p];
          }
        return writeRevision(
          now,
          next,
          "Restore memory revision without reviving forgotten knowledge",
        );
      });
    },
    conflicts(
      project: string,
      id?: string,
      path?: string,
      offset = 0,
      limit = 4096,
    ) {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 4096 ||
        (path === undefined && (offset !== 0 || limit !== 4096))
      )
        throw new Error("Invalid conflict paging");
      const matches = views().filter(
        (v) => v.project === project && v.state === "conflict",
      );
      if (id === undefined)
        return {
          conflicts: matches.slice(0, 8).map((summary) => {
            const v = readView(summary.id);
            if (v.project !== project || v.state !== "conflict")
              throw new Error("Stale private view summary");
            return {
              id: v.id,
              baseRevision: v.base.revision,
              fileCount: Object.keys(v.files).length,
            };
          }),
          total: matches.length,
        };
      const selected = matches.find((v) => v.id === id);
      if (!selected) throw new Error("Unknown scoped conflict");
      const v = readView(selected.id);
      if (v.project !== project || v.state !== "conflict")
        throw new Error("Stale private view summary");
      if (path === undefined)
        return {
          id,
          files: Object.keys(v.files)
            .filter((p) =>
              allowedPath(p, v.scope === "primary" ? undefined : project),
            )
            .sort(),
        };
      if (!allowedPath(path, v.scope === "primary" ? undefined : project))
        throw new Error("Path outside conflict scope");
      const now = load();
      const file = v.files[path];
      if (!file) return { id, path, removed: true };
      if (suppressed(now, path, file))
        return { id, path, suppressedByForgetting: true };
      const characters = [...file.text];
      return {
        id,
        path,
        text: characters.slice(offset, offset + limit).join(""),
        offset,
        totalCharacters: characters.length,
        truncated: offset > 0 || offset + limit < characters.length,
        sources: file.sources,
        proposalHash: digest(file.text),
        currentHash: now.files[path] ? digest(now.files[path].text) : null,
        baseRevision: v.base.revision,
      };
    },
    discardConflict(project: string, id: string) {
      const selected = views().find(
        (v) => v.id === id && v.project === project && v.state === "conflict",
      );
      if (!selected) throw new Error("Unknown scoped conflict");
      const v = readView(selected.id);
      if (v.project !== project || v.state !== "conflict")
        throw new Error("Stale private view summary");
      v.state = "cancelled";
      saveView(v);
      return { discarded: id };
    },
    project(cwd: string) {
      assertPrivatePath(cwd);
      if (!lstatSync(cwd).isDirectory())
        throw Error("Canonical memory project required");
      const c = config();
      const mapped = c.projects.find((p) => p.cwd === cwd)?.id;
      if (mapped) return mapped;
      // Full 256-bit path identity; retain every existing mapped ID unchanged.
      const id = digest(cwd);
      if (c.projects.some((p) => p.id === id && p.cwd !== cwd))
        throw Error("Derived memory project identity collision");
      return id;
    },
    projection(project: string, shared = false) {
      if (!name.test(project) || (shared && authority !== "primary"))
        throw new Error("Invalid memory project authority");
      const revision = head();
      const state = ledger(revision);
      const c = config();
      const selected: Record<string, MemoryFile> = {};
      for (const path of ["Core.md", "index.md"]) {
        current(join(root, path));
        selected[path] = {
          text: git(["show", `${revision}:${path}`]),
          sources: state.sources[path],
        };
      }
      validate(selected, c);
      return {
        revision,
        core: selected["Core.md"].text,
        index: selected["index.md"].text,
        deferred: Object.keys(state.sources)
          .filter(
            (p) =>
              allowedPath(p, shared ? undefined : project) &&
              p !== "Core.md" &&
              p !== "index.md",
          )
          .sort(),
      };
    },
    pendingEpisodes(project: string) {
      const s = load();
      const folder = join(root, ".episodes");
      if (!existsSync(folder)) return [];
      assertPrivatePath(folder);
      const names = readdirSync(folder).filter((p) =>
        /^[a-f0-9]{64}\.json$/.test(p),
      );
      if (names.length > 256) throw new Error("Episode backlog full");
      return names
        .filter(
          (p) =>
            !s.reviewed.includes(p.slice(0, -5)) &&
            !sourceForgotten(s, p.slice(0, -5), project),
        )
        .sort()
        .map((p) => episode(JSON.parse(read(join(folder, p), 16384))))
        .filter((e) => e.project === project)
        .sort(
          (a, b) =>
            String(a.observedAt).localeCompare(String(b.observedAt)) ||
            String(a.id).localeCompare(String(b.id)),
        )
        .slice(0, 4);
    },
    recordEpisode(id: string, value: unknown) {
      const e = episode(value);
      if (e.id !== id || !name.test(e.project as string))
        throw new Error("Invalid episode scope");
      const raw = JSON.stringify(e);
      const target = join(root, ".episodes", `${id}.json`);
      if (sourceForgotten(load(), id, e.project as string))
        throw new Error("Forgotten episode cannot be re-admitted");
      if (existsSync(target)) {
        if (read(target, 16384) !== `${raw}\n`)
          throw new Error("Observed episode changed");
        return;
      }
      safe();
      const folder = join(root, ".episodes");
      if (existsSync(folder)) {
        assertPrivatePath(folder);
        const names = readdirSync(folder).filter((p) =>
          /^[a-f0-9]{64}\.json$/.test(p),
        );
        if (names.length >= 256) {
          const s = load();
          for (const file of names)
            if (
              s.reviewed.includes(file.slice(0, -5)) ||
              sourceForgotten(
                s,
                file.slice(0, -5),
                episode(JSON.parse(read(join(folder, file), 16384)))
                  .project as string,
              )
            ) {
              const path = join(folder, file);
              current(path);
              assertPrivatePath(path);
              unlinkSync(path);
            }
          if (
            readdirSync(folder).filter((p) => /^[a-f0-9]{64}\.json$/.test(p))
              .length >= 256
          )
            throw new Error("Unreviewed episode capacity exceeded");
        }
      }
      write(join(root, ".episodes", `${id}.json`), `${raw}\n`);
    },
  };
}
