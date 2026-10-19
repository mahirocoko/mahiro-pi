import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertPrivatePath } from "./continuity/store.ts";
import { createMemoryStore } from "./agent-memory/store.ts";
import { hasSecret } from "./continuity/records.ts";
import {
  applySetup,
  inspectSetup,
  planSetup,
  setupSummary,
  setupTarget,
} from "./setup.ts";

const product = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roles = ["memory-reflector", "managed-memory-writer", "git-commit"];
const tools = [
  "agent_memory_read",
  "agent_memory_edit",
  "agent_memory_commit",
  "agent_memory_manage",
  "agent_memory_reflect",
];
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const inside = (root: string, path: string) =>
  path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
const canonical = (path: unknown, existing = false): string => {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    /[\x00-\x1f]|one[-_ ]?deex?/i.test(path)
  )
    throw new Error("Canonical absolute nonexcluded path required");
  assertPrivatePath(path);
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (
    realpathSync(ancestor) !== ancestor ||
    (!lstatSync(ancestor).isDirectory() && ancestor !== path)
  )
    throw new Error("Unsafe path ancestor");
  if (existing && (!existsSync(path) || realpathSync(path) !== path))
    throw new Error("Existing canonical path required");
  return path;
};
export const readBootstrapFile = (
  path: string,
): { text: string; hash: string; mode: number } | null => {
  canonical(path);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size > 1024 * 1024 ||
    stat.mode & 0o7022 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error("Unsafe bootstrap file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(
        fd,
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!count) break;
      length += count;
    }
    const bytes = buffer.subarray(0, length);
    const after = fstatSync(fd);
    if (
      bytes.length > 1024 * 1024 ||
      after.ino !== stat.ino ||
      after.dev !== stat.dev ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      after.mode !== stat.mode ||
      after.uid !== stat.uid ||
      after.gid !== stat.gid ||
      after.nlink !== 1 ||
      !after.isFile()
    )
      throw new Error("File changed during bootstrap read");
    const text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes)) throw new Error("UTF-8 required");
    return { text, hash: sha(bytes), mode: stat.mode & 0o777 };
  } finally {
    closeSync(fd);
  }
};
const readJson = (path: string) => {
  const file = readBootstrapFile(path);
  if (!file) return null;
  let value;
  try {
    value = JSON.parse(file.text);
  } catch {
    throw new Error("Invalid strict JSON bootstrap input; contents withheld");
  }
  if (!object(value)) throw new Error("JSON object required");
  return value;
};
const run = (
  command: string,
  args: string[],
  cwd: string,
  env = process.env,
) => {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
  });
  // Never relay arbitrary child stderr: an owner may include seed/config bodies.
  if (result.error || result.status !== 0) {
    const error = new Error(
      `Bootstrap owner command failed (${command}, status ${result.status ?? "unavailable"})`,
    );
    // The skill owner emits a bounded structured progress suffix. Retain only
    // reviewed target/status/recovery fields, never arbitrary stderr/error text.
    const marker = "Install progress: ";
    const start = result.stderr?.lastIndexOf(marker) ?? -1;
    if (start >= 0)
      try {
        const evidence = JSON.parse(result.stderr.slice(start + marker.length));
        if (
          evidence.agent === "pi" &&
          evidence.scope === "global" &&
          Array.isArray(evidence.targets)
        )
          Object.assign(error, {
            receipt: {
              owner: "mahiro-skills",
              receiptSync: evidence.receiptSync,
              targets: evidence.targets.map((target: any) => ({
                name: target.name,
                kind: target.kind,
                target: target.target,
                status: target.status,
                ...(typeof target.recoveryPath === "string"
                  ? { recoveryPath: target.recoveryPath }
                  : {}),
              })),
            },
          });
      } catch {
        /* Unrecognized stderr is deliberately withheld. */
      }
    throw error;
  }
  return result.stdout;
};
const treeHash = (root: string, missing = false) => {
  if (!existsSync(root)) {
    canonical(root);
    if (missing) return null;
    throw new Error("Required payload missing");
  }
  const rows: unknown[] = [];
  let bytes = 0;
  const walk = (path: string) => {
    canonical(path);
    const stat = lstatSync(path);
    if (
      rows.length >= 8192 ||
      stat.mode & 0o022 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error("Unsafe or oversized payload");
    if (stat.isDirectory()) {
      rows.push([relative(root, path), "directory", stat.mode & 0o777]);
      for (const name of readdirSync(path).sort()) walk(join(path, name));
    } else if (stat.isFile() && stat.nlink === 1) {
      bytes += stat.size;
      if (bytes > 64 * 1024 * 1024 || stat.size > 16 * 1024 * 1024)
        throw new Error("Payload bound exceeded");
      rows.push([
        relative(root, path),
        "file",
        stat.mode & 0o777,
        (() => {
          const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const buffer = Buffer.alloc(stat.size + 1);
            let length = 0;
            while (length < buffer.length) {
              const count = readSync(
                fd,
                buffer,
                length,
                buffer.length - length,
                length,
              );
              if (!count) break;
              length += count;
            }
            const after = fstatSync(fd);
            if (
              length !== stat.size ||
              after.ino !== stat.ino ||
              after.dev !== stat.dev ||
              after.size !== stat.size ||
              after.mtimeMs !== stat.mtimeMs ||
              after.ctimeMs !== stat.ctimeMs ||
              after.mode !== stat.mode ||
              after.uid !== stat.uid ||
              after.gid !== stat.gid ||
              !after.isFile() ||
              after.nlink !== 1
            )
              throw new Error("Payload changed during bounded read");
            return sha(buffer.subarray(0, length));
          } finally {
            closeSync(fd);
          }
        })(),
      ]);
    } else throw new Error("Symlink or nonregular payload rejected");
  };
  walk(root);
  return sha(JSON.stringify(rows));
};
// These pinned public exports execute their package-local dist implementations.
// Bind the whole bounded tree, not just the re-exporting index. This deliberately
// does not claim to bind the transitive npm dependency closure.
export const hashBootstrapNativePayload = (root: string, entry: string) => {
  if (entry !== "./dist/index.js")
    throw new Error("Unsupported native public implementation layout");
  canonical(root, true);
  if (!lstatSync(join(root, "dist")).isDirectory())
    throw new Error("Native public implementation tree required");
  return {
    root,
    metadata: treeHash(join(root, "package.json")),
    publicEntry: treeHash(join(root, entry)),
    implementation: treeHash(join(root, "dist")),
  };
};
const sourceState = (root: string, names: string[]) => {
  const revision = run("git", ["rev-parse", "HEAD"], root).trim();
  return {
    root,
    revision,
    payloads: names.map((name) => ({
      path: name,
      hash: treeHash(join(root, name)),
    })),
  };
};

export interface BootstrapRequest {
  version: 1;
  agentDir: string;
  sources: { pi: string; mods: string; skills: string };
  components: {
    packages?: true;
    roles?: true;
    skills?: string[];
    skillPolicy?: true;
    memory?: {
      root: string;
      project: string;
      projectId: string;
      seedFile: string;
      automatic?: boolean;
    };
  };
}
interface Change {
  path: string;
  before: ReturnType<typeof readBootstrapFile>;
  next: string;
  kind: string;
}
export interface BootstrapPlan {
  digest: string;
  request: BootstrapRequest;
  sources: unknown[];
  dependencies: { subagents: string; permissions: string; patchHash: string };
  changes: Change[];
  skillPolicy: ReturnType<typeof inspectSetup> | null;
  skills: any;
  memory: {
    action: "initialize" | "preserve-existing";
    root: string;
    seedHash: string | null;
    stateHash: string | null;
  } | null;
}
const validateRequest = (value: unknown): BootstrapRequest => {
  if (
    !object(value) ||
    value.version !== 1 ||
    Object.keys(value).some(
      (key) => !["version", "agentDir", "sources", "components"].includes(key),
    ) ||
    !object(value.sources) ||
    Object.keys(value.sources).sort().join() !== "mods,pi,skills" ||
    !object(value.components)
  )
    throw new Error("Unsupported bootstrap manifest");
  const r = value as BootstrapRequest;
  canonical(r.agentDir);
  if (
    existsSync(r.agentDir) &&
    (!lstatSync(r.agentDir).isDirectory() || lstatSync(r.agentDir).mode & 0o077)
  )
    throw new Error("Existing agent directory must be private 0700");
  for (const root of Object.values(r.sources)) canonical(root, true);
  if (
    r.sources.pi !== product ||
    r.sources.mods !== join(dirname(product), "mods") ||
    r.sources.skills !== join(dirname(product), "mahiro-skills")
  )
    throw new Error("Private canonical sibling topology required");
  for (const root of Object.values(r.sources))
    if (
      (inside(root, r.agentDir) &&
        !inside(join(product, ".agent-state/runtime"), r.agentDir)) ||
      inside(r.agentDir, root)
    )
      throw new Error("Profile/source overlap rejected");
  const c = r.components;
  if (
    !Object.keys(c).length ||
    Object.keys(c).some(
      (key) =>
        !["packages", "roles", "skills", "skillPolicy", "memory"].includes(key),
    )
  )
    throw new Error("Explicit components required");
  for (const key of ["packages", "roles", "skillPolicy"] as const)
    if (c[key] !== undefined && c[key] !== true)
      throw new Error("Unsupported component selection");
  if (
    c.skills !== undefined &&
    (!Array.isArray(c.skills) ||
      !c.skills.length ||
      c.skills.length > 64 ||
      new Set(c.skills).size !== c.skills.length ||
      c.skills.some(
        (name) =>
          typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name),
      ))
  )
    throw new Error("Explicit skill names required");
  if (c.memory !== undefined) {
    const m = c.memory;
    if (
      !object(m) ||
      Object.keys(m).some(
        (key) =>
          !["root", "project", "projectId", "seedFile", "automatic"].includes(
            key,
          ),
      ) ||
      typeof m.projectId !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.projectId) ||
      (m.automatic !== undefined && typeof m.automatic !== "boolean")
    )
      throw new Error("Invalid memory selection");
    canonical(m.root);
    canonical(m.project, true);
    canonical(m.seedFile);
    for (const root of [...Object.values(r.sources), r.agentDir, m.project])
      if (
        inside(m.root, root) ||
        (inside(root, m.root) &&
          root !== r.agentDir &&
          !(
            Object.values(r.sources).includes(root) &&
            inside(join(product, ".agent-state/runtime"), m.root)
          ))
      )
        throw new Error("Memory/source/project overlap rejected");
    if (!c.packages || !c.roles)
      throw new Error("Memory requires explicit packages and roles");
  }
  return r;
};
export const readBootstrapRequest = (path: string) => {
  const file = readBootstrapFile(path);
  if (!file || file.mode !== 0o600)
    throw new Error("Private 0600 bootstrap manifest required");
  let value;
  try {
    value = JSON.parse(file.text);
  } catch {
    throw new Error(
      "Invalid strict JSON bootstrap manifest; contents withheld",
    );
  }
  return validateRequest(value);
};
const existingMemoryState = (root: string) => {
  canonical(root, true);
  if (!lstatSync(root).isDirectory() || lstatSync(root).mode & 0o077)
    throw new Error("Existing memory root must be private directory");
  const config = readBootstrapFile(join(root, "config.json"));
  const core = readBootstrapFile(join(root, "Core.md"));
  const index = readBootstrapFile(join(root, "index.md"));
  canonical(join(root, ".git"), true);
  if (
    !config ||
    !core ||
    !index ||
    !lstatSync(join(root, ".git")).isDirectory()
  )
    throw new Error(
      "Existing root is not an initialized private managed store",
    );
  // Read-only owner validation: a directory or arbitrary Git repository is not readiness.
  // No direct initialize/repair/write path exists here; only the guarded native tool initializes.
  const store = createMemoryStore(root);
  const snapshot = store.snapshot();
  return sha(
    JSON.stringify({
      config: config.hash,
      core: core.hash,
      index: index.hash,
      revision: snapshot.revision,
      files: Object.entries(snapshot.files).map(([path, file]) => [
        path,
        sha(file.text),
      ]),
    }),
  );
};
const skillsEnv = (r: BootstrapRequest) => ({
  ...process.env,
  PI_CODING_AGENT_DIR: r.agentDir,
  MAHIRO_SKILLS_REPO_ROOT: r.sources.skills,
});
const skillCommand = (r: BootstrapRequest, mode: string, items: string[]) =>
  JSON.parse(
    run(
      "bun",
      [
        join(r.sources.skills, "src/cli.ts"),
        mode,
        ...items,
        "--agent",
        "pi",
        "--scope",
        "global",
      ],
      r.sources.skills,
      skillsEnv(r),
    ),
  );
const skillsInspect = (r: BootstrapRequest) => {
  if (!r.components.skills) return null;
  const plan = skillCommand(r, "plan", r.components.skills);
  if (
    plan.root !== r.agentDir ||
    plan.commands.length ||
    plan.skipped.length ||
    !plan.skills.length
  )
    throw new Error("Incomplete skill owner plan");
  const receiptPath = join(
    r.agentDir,
    ".mahiro-skills/receipts/global-pi.json",
  );
  const receipt = readJson(receiptPath);
  if (
    receipt &&
    (receipt.schemaVersion !== 2 ||
      receipt.root !== r.agentDir ||
      receipt.agent !== "pi" ||
      receipt.scope !== "global" ||
      receipt.sourceRepoPath !== r.sources.skills ||
      !Array.isArray(receipt.installedSkills) ||
      receipt.installedSkills.some(
        (name: unknown) =>
          typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name),
      ) ||
      !Array.isArray(receipt.installedCommands) ||
      receipt.installedCommands.length ||
      !Array.isArray(receipt.targetStates) ||
      receipt.targetStates.some(
        (state: any) =>
          !object(state) ||
          state.kind !== "skill" ||
          typeof state.name !== "string" ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.name) ||
          typeof state.sourceHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(state.sourceHash) ||
          typeof state.installedHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(state.installedHash),
      ))
  )
    throw new Error(
      "Unsupported skill receipt or legacy aliases; review with skill owner first",
    );
  // Owner doctor reports inventory presence; the hash bridge below uses the owner's
  // exact payload transforms and fingerprints. Bootstrap never copies skills.
  const doctor = receipt ? skillCommand(r, "doctor", []) : [];
  const targets = plan.skills.map((target: any) => {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.name) ||
      target.source !== join(r.sources.skills, "skills", target.name) ||
      target.target !== join(r.agentDir, "skills", target.name)
    )
      throw new Error("Unexpected skill owner target");
    const targetHash = treeHash(target.target, true);
    const recorded = receipt?.targetStates?.find(
      (state: any) => state.kind === "skill" && state.name === target.name,
    );
    if (
      targetHash &&
      (!recorded || !receipt.installedSkills.includes(target.name))
    )
      throw new Error("Unowned skill collision");
    return {
      name: target.name,
      sourceHash: treeHash(target.source),
      targetHash,
      recorded: !!recorded,
    };
  });
  // A tiny owner-local Bun bridge returns the owner's canonical receipt/hash verdict.
  if (receipt) {
    const verdict = JSON.parse(
      run(
        "bun",
        [
          "-e",
          `import {hashPath,hashSkillPayload} from ${JSON.stringify(join(r.sources.skills, "src/content-hash.ts"))}; const targets=${JSON.stringify(plan.skills)}; console.log(JSON.stringify(targets.map(t=>({name:t.name,installed:hashPath(t.target),source:hashSkillPayload(t.source)}))));`,
        ],
        r.sources.skills,
        skillsEnv(r),
      ),
    );
    for (const target of verdict) {
      const state = receipt.targetStates?.find(
        (s: any) => s.kind === "skill" && s.name === target.name,
      );
      if (
        target.installed &&
        (!state ||
          state.installedHash !== target.installed ||
          state.sourceHash !== target.source)
      )
        throw new Error(
          "Skill source/target conflicts with canonical receipt; use skill owner update explicitly",
        );
    }
  }
  return {
    targets,
    receiptHash: readBootstrapFile(receiptPath)?.hash ?? null,
    doctor,
  };
};

export const assertBootstrapModsContract = (
  metadata: unknown,
  workspace: string,
  lock: string,
  patchHash: string,
) => {
  if (
    !object(metadata) ||
    metadata.dependencies?.["@gotgenes/pi-subagents"] !== "23.4.1" ||
    metadata.dependencies?.["@gotgenes/pi-permission-system"] !== "40.2.2" ||
    JSON.stringify(metadata.pi?.extensions) !==
      JSON.stringify(["./bootstrap.mjs", "./index.ts"])
  )
    throw new Error("Canonical Mods pins/ordered guards mismatch");
  if (
    !/^[a-f0-9]{64}$/.test(patchHash) ||
    !workspace.includes(
      "'@gotgenes/pi-subagents@23.4.1': patches/@gotgenes__pi-subagents@23.4.1.patch",
    ) ||
    !lock.includes(`hash: ${patchHash}`)
  )
    throw new Error("Canonical patch provenance mismatch");
};

export const inspectBootstrap = (input: BootstrapRequest): BootstrapPlan => {
  const r = validateRequest(input);
  const adapter = join(r.sources.mods, "adapters/pi");
  const meta = readJson(join(adapter, "package.json"));
  const patch = readBootstrapFile(
    join(adapter, "patches/@gotgenes__pi-subagents@23.4.1.patch"),
  );
  const lock = readBootstrapFile(join(adapter, "pnpm-lock.yaml"));
  const workspace = readBootstrapFile(join(adapter, "pnpm-workspace.yaml"));
  if (!patch || !lock || !workspace)
    throw new Error("Canonical patch provenance missing");
  assertBootstrapModsContract(meta, workspace.text, lock.text, patch.hash);
  const dependencies: BootstrapPlan["dependencies"] = {
    subagents: "",
    permissions: "",
    patchHash: patch.hash,
  };
  for (const [name, version, key] of [
    ["@gotgenes/pi-subagents", "23.4.1", "subagents"],
    ["@gotgenes/pi-permission-system", "40.2.2", "permissions"],
  ] as const) {
    const link = join(adapter, "node_modules", name);
    if (!existsSync(link))
      throw new Error(
        `Missing owner prerequisite: cd ${adapter} && pnpm install --frozen-lockfile`,
      );
    const root = realpathSync(link);
    if (!inside(join(adapter, "node_modules/.pnpm"), root))
      throw new Error(
        "Dependency must resolve through canonical Mods workspace",
      );
    const installed = readJson(join(root, "package.json"));
    if (
      installed?.name !== name ||
      installed.version !== version ||
      JSON.stringify(installed.pi?.extensions) !==
        JSON.stringify(["./src/index.ts"])
    )
      throw new Error("Installed dependency identity mismatch");
    if (key === "subagents") {
      const declarations =
        readBootstrapFile(join(root, "dist/public.d.ts"))?.text ?? "";
      const service =
        readBootstrapFile(join(root, "src/service/service.ts"))?.text ?? "";
      if (
        !declarations.includes("supportsInitialOutcomeClaim: true") ||
        !declarations.includes("getAgentType(") ||
        !declarations.includes("claimOutcome?: boolean") ||
        !service.includes("supportsInitialOutcomeClaim") ||
        !root.includes(`patch_hash=${patch.hash.slice(0, 16)}`)
      )
        throw new Error("Installed public patch capability missing");
    }
    if (key === "subagents")
      run(
        "git",
        [
          "apply",
          "--reverse",
          "--check",
          join(adapter, "patches/@gotgenes__pi-subagents@23.4.1.patch"),
        ],
        root,
      );
    dependencies[key] = root;
  }
  const nativePrerequisites: unknown[] = [];
  if (r.components.memory)
    for (const name of [
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-ai",
    ]) {
      const link = join(adapter, "node_modules", name);
      if (!existsSync(link))
        throw new Error(
          `Missing native owner prerequisite: cd ${adapter} && pnpm install --frozen-lockfile`,
        );
      const root = realpathSync(link),
        metadata = readJson(join(root, "package.json"));
      const entry = metadata?.exports?.["."]?.import;
      if (
        !inside(join(adapter, "node_modules/.pnpm"), root) ||
        metadata?.name !== name ||
        metadata.version !== "1.3.0" ||
        typeof entry !== "string" ||
        !entry.startsWith("./") ||
        entry.includes("..")
      )
        throw new Error(
          "Native bootstrap requires canonical public SDK/AI 1.3.0 entries",
        );
      nativePrerequisites.push(hashBootstrapNativePayload(root, entry));
    }
  const changes: Change[] = [];
  const change = (
    path: string,
    next: string,
    kind: string,
    createOnly = false,
  ) => {
    const before = readBootstrapFile(path);
    if (createOnly && before && before.text !== next)
      throw new Error("Existing role differs; explicit owner review required");
    changes.push({ path, before, next, kind });
  };
  if (r.components.packages) {
    const path = join(r.agentDir, "settings.json");
    const settings = readJson(path) ?? {};
    const packages = settings.packages ?? [];
    if (
      !Array.isArray(packages) ||
      packages.some(
        (p: any) =>
          typeof p !== "string" && (!object(p) || typeof p.source !== "string"),
      )
    )
      throw new Error("Unsupported package settings");
    const required = [
      dependencies.permissions,
      dependencies.subagents,
      adapter,
      product,
    ];
    const explicitExtensions = settings.extensions ?? [];
    if (
      !Array.isArray(explicitExtensions) ||
      explicitExtensions.some((entry: any) => typeof entry !== "string")
    )
      throw new Error("Unsupported extension settings");
    // Do not silently override direct-entry loading or exclusion filters. Package
    // resource enable/disable migration needs review through its existing owner.
    if (
      explicitExtensions.some(
        (entry: string) =>
          /^[!-].*[*?\[]/.test(entry) ||
          required.some((root) => entry.replace(/^[+!-]/, "").startsWith(root)),
      )
    )
      throw new Error(
        "Required package has explicit extension overrides; review first",
      );
    for (const entry of packages) {
      const source = typeof entry === "string" ? entry : entry.source;
      const absolute = source.startsWith(".")
        ? resolve(r.agentDir, source)
        : source;
      if (
        required.includes(absolute) &&
        (typeof entry !== "string" || source !== absolute)
      )
        throw new Error(
          "Filtered or aliased required package; explicit owner review required",
        );
      if (
        !required.includes(absolute) &&
        /pi-(?:guards|subagents|permission-system)|mahiro-pi/.test(source)
      )
        throw new Error("Conflicting package source");
    }
    const next = [...packages];
    for (const source of required)
      if (!next.includes(source)) next.push(source);
    change(
      path,
      next.length === packages.length
        ? readBootstrapFile(path)!.text
        : json({ ...settings, packages: next }),
      "packages",
    );
    const subpath = join(r.agentDir, "extensions/pi-subagents/config.json");
    const config = readJson(subpath) ?? {};
    const excludes = config.excludedExtensionPackages ?? [];
    if (
      !Array.isArray(excludes) ||
      excludes.some((p: any) => typeof p !== "string") ||
      excludes.some(
        (p: string) =>
          [adapter, dependencies.permissions, product].includes(p) ||
          /pi-(guards|permission-system)/.test(p),
      )
    )
      throw new Error("Guards/permissions/memory must remain in children");
    if (
      excludes.some(
        (p: string) => p !== dependencies.subagents && /pi-subagents/.test(p),
      )
    )
      throw new Error("Stale subagents exclusion; explicit review required");
    change(
      subpath,
      excludes.includes(dependencies.subagents)
        ? readBootstrapFile(subpath)!.text
        : json({
            ...config,
            excludedExtensionPackages: [...excludes, dependencies.subagents],
          }),
      "children",
    );
  }
  if (r.components.roles)
    for (const role of roles)
      change(
        join(r.agentDir, "agents", `${role}.md`),
        readBootstrapFile(join(product, "agents", `${role}.md`))!.text,
        "role",
        true,
      );
  const skillPolicy = r.components.skillPolicy
    ? inspectSetup(r.agentDir)
    : null;
  let memory: BootstrapPlan["memory"] = null;
  if (r.components.memory) {
    const m = r.components.memory;
    const existing = existsSync(m.root);
    if (existing) {
      memory = {
        action: "preserve-existing",
        root: m.root,
        seedHash: null,
        stateHash: existingMemoryState(m.root),
      };
    } else {
      const seed = readBootstrapFile(m.seedFile);
      if (
        !seed ||
        seed.mode !== 0o600 ||
        Buffer.byteLength(seed.text) > 8192 ||
        !seed.text.trim() ||
        hasSecret(seed.text)
      )
        throw new Error("Explicit bounded private seed required");
      memory = {
        action: "initialize",
        root: m.root,
        seedHash: seed.hash,
        stateHash: null,
      };
      const path = setupTarget(r.agentDir);
      const previous = readBootstrapFile(path);
      planSetup(previous?.text ?? null); // Validate without silently repairing malformed prior permission.
      const config = JSON.parse(skillPolicy?.next ?? previous?.text ?? "{}");
      const permission = config.permission ?? {};
      for (const key of [...tools, `managed_memory_${sha(m.root)}`]) {
        if (permission[key] !== undefined && permission[key] !== "allow")
          throw new Error("Memory grant conflicts with existing restriction");
        permission[key] = "allow";
      }
      // Reuse setup validation without adding skill activation unless selected.
      const next = json({ ...config, permission });
      planSetup(next);
      change(path, next, "memory-authority");
    }
  }
  const sources = [
    ...nativePrerequisites,
    sourceState(product, [
      "package.json",
      "bootstrap.mjs",
      "setup.mjs",
      "agents",
      "skills",
      "extensions",
      "lib",
    ]),
    sourceState(r.sources.mods, [
      "adapters/pi/package.json",
      "adapters/pi/bootstrap.mjs",
      "adapters/pi/index.ts",
      "adapters/pi/host.mjs",
      "adapters/pi/provenance.mjs",
      "adapters/pi/pnpm-workspace.yaml",
      "adapters/pi/pnpm-lock.yaml",
      "adapters/pi/patches",
      "mods/mahiro-secret-read-guard.js",
      "mods/mahiro-commit-attribution-guard.js",
    ]),
    sourceState(r.sources.skills, [
      "package.json",
      "src",
      ".claude-plugin/marketplace.json",
    ]),
    {
      root: dependencies.subagents,
      metadata: treeHash(join(dependencies.subagents, "package.json")),
      hash: treeHash(join(dependencies.subagents, "src")),
      declarations: treeHash(join(dependencies.subagents, "dist")),
    },
    {
      root: dependencies.permissions,
      metadata: treeHash(join(dependencies.permissions, "package.json")),
      hash: treeHash(join(dependencies.permissions, "src")),
      declarations: treeHash(join(dependencies.permissions, "dist")),
    },
  ];
  const body = {
    request: r,
    sources,
    dependencies,
    changes,
    skillPolicy,
    skills: skillsInspect(r),
    memory,
  };
  return { digest: sha(JSON.stringify(body)), ...body };
};

export const bootstrapSummary = (plan: BootstrapPlan) => ({
  digest: plan.digest,
  agentDir: plan.request.agentDir,
  sources: plan.sources,
  dependencies: plan.dependencies,
  steps: plan.changes.map((c) => ({
    kind: c.kind,
    path: c.path,
    action: c.before?.text === c.next ? "noop" : c.before ? "update" : "create",
    beforeHash: c.before?.hash ?? null,
    afterHash: sha(c.next),
  })),
  skillPolicy: plan.skillPolicy ? setupSummary(plan.skillPolicy) : null,
  skills: plan.skills,
  memory: plan.memory,
  atomicAcrossOwners: false,
});
const mkdirPrivate = (path: string) => {
  canonical(path);
  if (!existsSync(path)) {
    mkdirPrivate(dirname(path));
    mkdirSync(path, { mode: 0o700 });
  }
};
const publish = (change: Change) => {
  const current = readBootstrapFile(change.path);
  if (JSON.stringify(current) !== JSON.stringify(change.before))
    throw new Error("Target changed after review");
  if (current?.text === change.next) return { changed: false, backup: null };
  mkdirPrivate(dirname(change.path));
  const backup = current
    ? `${change.path}.mahiro-bootstrap-${randomUUID()}.bak`
    : null;
  const temp = `${change.path}.mahiro-bootstrap-${randomUUID()}.tmp`;
  let created = false;
  let published = false;
  let backedUp = false;
  try {
    if (backup) {
      const backupFd = openSync(
        backup,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      backedUp = true;
      try {
        fchmodSync(backupFd, 0o600);
        writeFileSync(backupFd, current!.text);
        fsyncSync(backupFd);
      } finally {
        closeSync(backupFd);
      }
    }
    const fd = openSync(
      temp,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      current?.mode ?? 0o600,
    );
    created = true;
    try {
      fchmodSync(fd, current?.mode ?? 0o600);
      writeFileSync(fd, change.next);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (
      JSON.stringify(readBootstrapFile(change.path)) !== JSON.stringify(current)
    )
      throw new Error("Concurrent bootstrap target change");
    if (current) {
      renameSync(temp, change.path);
      published = true;
      created = false;
    } else {
      linkSync(temp, change.path);
      published = true;
      unlinkSync(temp);
      created = false;
    }
    const directoryFd = openSync(dirname(change.path), constants.O_RDONLY);
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
    return { changed: true, backup };
  } catch (cause) {
    let residualTemporary: string | null = null;
    if (created)
      try {
        unlinkSync(temp);
      } catch {
        residualTemporary = temp;
      }
    throw Object.assign(
      new Error("Bootstrap publication failed; retain recovery evidence", {
        cause,
      }),
      {
        receipt: {
          path: change.path,
          changed: published,
          publication: published
            ? "published-durability-unconfirmed"
            : "not-published",
          backup: backedUp ? backup : null,
          residualTemporary,
        },
      },
    );
  }
};
export const applyBootstrap = (
  reviewed: BootstrapPlan,
  expected: string,
  hooks: { beforeStep?: (kind: string) => void } = {},
) => {
  if (
    !/^[a-f0-9]{64}$/.test(expected) ||
    expected !== reviewed.digest ||
    JSON.stringify(inspectBootstrap(reviewed.request)) !==
      JSON.stringify(reviewed)
  )
    throw new Error("Reviewed bootstrap plan is stale");
  const plannedSteps = [
    ...reviewed.changes
      .filter((c) => c.kind !== "memory-authority")
      .map((c) => ({
        kind: c.kind,
        path: c.path,
        beforeHash: c.before?.hash ?? null,
        afterHash: sha(c.next),
      })),
    ...reviewed.changes
      .filter((c) => c.kind === "memory-authority")
      .map((c) => ({
        kind: c.kind,
        path: c.path,
        beforeHash: c.before?.hash ?? null,
        afterHash: sha(c.next),
      })),
    ...(!reviewed.changes.some((c) => c.kind === "memory-authority") &&
    reviewed.skillPolicy
      ? [{ kind: "skill-policy", path: setupTarget(reviewed.request.agentDir) }]
      : []),
    ...(reviewed.skills
      ? [{ kind: "skills", path: join(reviewed.request.agentDir, "skills") }]
      : []),
    ...(reviewed.memory
      ? [
          {
            kind:
              reviewed.memory.action === "initialize"
                ? "memory-initialize-native"
                : "memory-preserve-existing",
            path: reviewed.memory.root,
          },
        ]
      : []),
  ];
  const receipt: any = {
    version: 1,
    digest: expected,
    status: "running",
    atomicAcrossOwners: false,
    steps: plannedSteps.map((step) => ({ ...step, status: "not-attempted" })),
    receiptPath: join(
      reviewed.request.agentDir,
      ".mahiro-bootstrap/receipts",
      `${randomUUID()}.json`,
    ),
  };
  mkdirPrivate(dirname(receipt.receiptPath));
  const save = () =>
    writeFileSync(receipt.receiptPath, json(receipt), { mode: 0o600 });
  save();
  const step = (kind: string, fn: () => any) => {
    const entry = receipt.steps.find(
      (item: any) => item.kind === kind && item.status === "not-attempted",
    );
    entry.status = "running";
    save();
    try {
      hooks.beforeStep?.(kind);
      entry.result = fn();
      entry.status = "completed";
      save();
    } catch (error) {
      entry.status = "failed";
      if ((error as any)?.receipt) entry.ownerReceipt = (error as any).receipt;
      save();
      throw error;
    }
  };
  try {
    for (const change of reviewed.changes.filter(
      (c) => c.kind !== "memory-authority",
    ))
      step(change.kind, () => publish(change));
    // If memory authority composes the policy bytes, publish that combined result once.
    const authority = reviewed.changes.find(
      (c) => c.kind === "memory-authority",
    );
    if (authority) step("memory-authority", () => publish(authority));
    else if (reviewed.skillPolicy)
      step("skill-policy", () =>
        applySetup(reviewed.request.agentDir, reviewed.skillPolicy!),
      );
    if (reviewed.skills)
      step("skills", () => {
        if (
          JSON.stringify(skillsInspect(reviewed.request)) !==
          JSON.stringify(reviewed.skills)
        )
          throw new Error("Skill target/source/receipt changed");
        const missing = reviewed.skills.targets
          .filter((t: any) => !t.targetHash)
          .map((t: any) => t.name);
        if (!missing.length)
          return {
            changed: false,
            receipt: join(
              reviewed.request.agentDir,
              ".mahiro-skills/receipts/global-pi.json",
            ),
          };
        const result = skillCommand(reviewed.request, "install", missing);
        return {
          changed: true,
          status: result.status,
          receipt: join(
            reviewed.request.agentDir,
            ".mahiro-skills/receipts/global-pi.json",
          ),
        };
      });
    if (reviewed.memory?.action === "initialize")
      step("memory-initialize-native", () => {
        const m = reviewed.request.components.memory!;
        if (
          existsSync(m.root) ||
          readBootstrapFile(m.seedFile)?.hash !== reviewed.memory!.seedHash
        )
          throw new Error("Memory root/seed changed");
        const output = run(
          process.execPath,
          [join(product, "lib/bootstrap-native.mjs")],
          m.project,
          {
            ...process.env,
            PI_CODING_AGENT_DIR: reviewed.request.agentDir,
            MAHIRO_AGENT_MEMORY_ROOT: m.root,
            MAHIRO_BOOTSTRAP_REQUEST: JSON.stringify({
              agentDir: reviewed.request.agentDir,
              project: m.project,
              root: m.root,
              projectId: m.projectId,
              seedFile: m.seedFile,
              seedHash: reviewed.memory!.seedHash,
              automatic: m.automatic === true,
              packages: [
                reviewed.dependencies.permissions,
                reviewed.dependencies.subagents,
                join(reviewed.request.sources.mods, "adapters/pi"),
                product,
              ],
            }),
          },
        );
        return JSON.parse(output);
      });
    else if (reviewed.memory)
      step("memory-preserve-existing", () => {
        if (
          existingMemoryState(reviewed.memory!.root) !==
          reviewed.memory!.stateHash
        )
          throw new Error(
            "Existing memory changed after review; preserved but not verified unchanged",
          );
        return { changed: false };
      });
    receipt.status = "completed";
    save();
    return receipt;
  } catch (cause) {
    receipt.status = "partial-or-failed";
    save();
    throw Object.assign(
      new Error(
        "Bootstrap stopped; inspect sequential receipt and replan; no automatic rollback",
        { cause },
      ),
      { receipt },
    );
  }
};
