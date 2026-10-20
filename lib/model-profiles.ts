// Native adaptation of the dated Letta model-profile oracle in test/oracles/letta.
// Presets belong to the private Pi profile, not a transient session, Core or MemFS.
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { resolveAgentDir } from "./setup.ts";
import { readBootstrapFile } from "./bootstrap.ts";
import { assertPrivatePath } from "./continuity/store.ts";

export const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const preferenceHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
const inside = (a: string, b: string) => b === a || b.startsWith(`${a}/`);
export function privateDirectory(path: string, optional = false): boolean {
  assertPrivatePath(path);
  try {
    const s = lstatSync(path);
    if (
      !s.isDirectory() ||
      (s.mode & 0o7777) !== 0o700 ||
      (process.getuid && s.uid !== process.getuid()) ||
      realpathSync(path) !== path
    )
      throw Error("Private owned 0700 preference directory required");
    return true;
  } catch (e) {
    if (optional && missing(e)) return false;
    throw e;
  }
}
export function readPreferenceFile(path: string): string | null {
  const f = readBootstrapFile(path);
  if (!f) return null;
  if (
    (lstatSync(path).mode & 0o7777) !== 0o600 ||
    Buffer.byteLength(f.text) > 65536
  )
    throw Error("Bounded private 0600 preference file required");
  return f.text;
}
export interface PreferenceBinding {
  profile: string;
  project: string;
  root: string;
  configHash: string;
  feature: "model-profiles" | "rtk";
}
export function preferenceBinding(
  project: string,
  feature: PreferenceBinding["feature"],
): PreferenceBinding | null {
  const profile = resolveAgentDir();
  for (const p of [profile, project]) {
    assertPrivatePath(p);
    if (
      !isAbsolute(p) ||
      p !== resolve(p) ||
      /[\x00-\x1f\x7f]|(?:^|\/)\.letta(?:\/|$)|one[-_ ]?deex?/i.test(p)
    )
      throw Error("Canonical nonexcluded preference scope required");
  }
  if (
    inside(profile, project) ||
    inside(project, profile) ||
    realpathSync(project) !== project ||
    !lstatSync(project).isDirectory()
  )
    throw Error("Separate canonical profile/project required");
  const file = join(profile, `extensions/mahiro-${feature}/config.json`),
    text = readPreferenceFile(file);
  if (text === null) return null;
  for (const p of [profile, join(profile, "extensions"), dirname(file)])
    privateDirectory(p);
  const c = JSON.parse(text);
  if (
    !c ||
    c.version !== 1 ||
    c.profile !== profile ||
    Object.keys(c).some(
      (k) => !["version", "profile", "projects"].includes(k),
    ) ||
    !Array.isArray(c.projects) ||
    c.projects.length > 32 ||
    c.projects.some((p) => typeof p !== "string") ||
    new Set(c.projects).size !== c.projects.length
  )
    throw Error("Invalid explicit preference configuration");
  if (!c.projects.includes(project)) return null;
  const root = join(profile, "preferences", feature);
  for (const p of [
    process.env.MAHIRO_AGENT_MEMORY_ROOT ?? join(profile, "memory"),
    process.env.MAHIRO_CONTINUITY_ROOT ?? join(profile, "continuity"),
  ]) {
    assertPrivatePath(p);
    if (inside(p, root) || inside(root, p))
      throw Error("Preferences overlap memory or continuity");
  }
  for (const p of [join(profile, "preferences"), root])
    privateDirectory(p, true);
  return { profile, project, root, configHash: preferenceHash(text), feature };
}
export function assertPreferenceBinding(b: PreferenceBinding) {
  if (
    JSON.stringify(preferenceBinding(b.project, b.feature)) !==
    JSON.stringify(b)
  )
    throw Error("Preference configuration changed");
}
export interface Profile {
  provider: string;
  model: string;
  contextWindow: number;
  thinking?: (typeof thinkingLevels)[number];
  label?: string;
}
export interface Profiles {
  version: 1;
  sequence: number;
  profiles: Record<string, Profile>;
}
export const safeText = (s: unknown, max = 240): s is string =>
  typeof s === "string" &&
  s.length > 0 &&
  s.length <= max &&
  s === s.trim() &&
  !/[\x00-\x1f\x7f]/.test(s) &&
  !["__proto__", "constructor", "prototype"].includes(s);
export function validateProfiles(s: any): asserts s is Profiles {
  if (
    !s ||
    s.version !== 1 ||
    !Number.isSafeInteger(s.sequence) ||
    s.sequence < 0 ||
    Object.keys(s).some(
      (k) => !["version", "sequence", "profiles"].includes(k),
    ) ||
    !s.profiles ||
    Array.isArray(s.profiles) ||
    typeof s.profiles !== "object" ||
    Object.keys(s.profiles).length > 64
  )
    throw Error("Invalid bounded model profiles");
  const aliases = new Set<string>();
  for (const [key, value] of Object.entries(s.profiles)) {
    const p = value as Profile;
    if (
      !safeText(key) ||
      !p ||
      Object.keys(p).some(
        (k) =>
          !["provider", "model", "contextWindow", "thinking", "label"].includes(
            k,
          ),
      ) ||
      !safeText(p.provider) ||
      p.provider.includes("/") ||
      !safeText(p.model) ||
      key !== `${p.provider}/${p.model}` ||
      !Number.isSafeInteger(p.contextWindow) ||
      p.contextWindow <= 0 ||
      (p.thinking !== undefined && !thinkingLevels.includes(p.thinking)) ||
      (p.label !== undefined && !safeText(p.label, 160))
    )
      throw Error("Invalid model profile");
    if (p.label) {
      const alias = p.label.toLowerCase();
      if (
        aliases.has(alias) ||
        Object.keys(s.profiles).some(
          (k) => k.toLowerCase() === alias && k !== key,
        )
      )
        throw Error("Ambiguous profile alias");
      aliases.add(alias);
    }
  }
}
export function readProfiles(b: PreferenceBinding): {
  state: Profiles;
  ticket: string;
} {
  assertPreferenceBinding(b);
  const text = readPreferenceFile(join(b.root, "state.json"));
  const state =
    text === null
      ? { version: 1, sequence: 0, profiles: {} }
      : JSON.parse(text);
  validateProfiles(state);
  return { state, ticket: preferenceHash(text ?? "<absent>") };
}
export function findProfile(state: Profiles, query: string) {
  if (!safeText(query)) throw Error("Safe model handle or alias required");
  const matches = Object.entries(state.profiles).filter(
    ([key, p]) =>
      key === query ||
      key.toLowerCase() === query.toLowerCase() ||
      p.label?.toLowerCase() === query.toLowerCase(),
  );
  if (matches.length !== 1)
    throw Error("Saved model profile missing or ambiguous");
  return { key: matches[0][0], profile: matches[0][1] };
}
// A bounded synchronous publication after the final synchronous owner check.
// UI awaits happen before this boundary. No stale-lock steal or read-time repair.
export function publishPreference(
  b: PreferenceBinding,
  ticket: string,
  next: unknown,
  assertCurrent: () => void,
  validate: (s: any) => void,
) {
  assertCurrent();
  assertPreferenceBinding(b);
  validate(next);
  const bytes = `${JSON.stringify(next)}\n`;
  if (Buffer.byteLength(bytes) > 65536)
    throw Error("Preference byte bound exceeded");
  for (const p of [join(b.profile, "preferences"), b.root]) {
    if (!privateDirectory(p, true)) mkdirSync(p, { mode: 0o700 });
    privateDirectory(p);
  }
  const lock = join(b.root, "state.lock"),
    file = join(b.root, "state.json"),
    temp = join(b.root, `.state-${randomUUID()}.tmp`);
  const fd = openSync(
    lock,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  const lockStat = fstatSync(fd);
  let tempFd: number | undefined;
  let published = false;
  try {
    writeFileSync(fd, randomUUID());
    fsyncSync(fd);
    if (preferenceHash(readPreferenceFile(file) ?? "<absent>") !== ticket)
      throw Error("Stale preference revision; read again");
    tempFd = openSync(
      temp,
      constants.O_RDWR |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(tempFd, bytes);
    fsyncSync(tempFd);
    const original = fstatSync(tempFd);
    assertCurrent();
    assertPreferenceBinding(b);
    for (const p of [b.profile, join(b.profile, "preferences"), b.root])
      privateDirectory(p);
    if (preferenceHash(readPreferenceFile(file) ?? "<absent>") !== ticket)
      throw Error("Stale preference revision; read again");
    const actual = lstatSync(temp);
    const checked = Buffer.alloc(Buffer.byteLength(bytes) + 1);
    const checkedSize = readSync(tempFd, checked, 0, checked.length, 0);
    if (
      !actual.isFile() ||
      actual.ino !== original.ino ||
      actual.dev !== original.dev ||
      actual.nlink !== 1 ||
      actual.mode !== original.mode ||
      actual.size !== Buffer.byteLength(bytes) ||
      checkedSize !== Buffer.byteLength(bytes) ||
      !checked.subarray(0, checkedSize).equals(Buffer.from(bytes))
    )
      throw Error("Preference temporary changed");
    renameSync(temp, file);
    published = true;
    const d = openSync(b.root, constants.O_RDONLY);
    try {
      fsyncSync(d);
    } finally {
      closeSync(d);
    }
  } finally {
    if (tempFd !== undefined) closeSync(tempFd);
    if (!published) {
      try {
        unlinkSync(temp);
      } catch (e) {
        if (!missing(e)) throw e;
      }
    }
    closeSync(fd);
    const actual = lstatSync(lock);
    if (actual.ino !== lockStat.ino || actual.dev !== lockStat.dev)
      throw Error("Preference lock changed; manual recovery required");
    unlinkSync(lock);
  }
}

export const modelProfileToolNames = [
  "mh_list_model_profiles",
  "mh_set_model_profile",
  "mh_delete_model_profile",
  "mh_switch_model_profile",
];
export function registerModelProfiles(pi: any) {
  let manager: any,
    generation = 0,
    alive = true;
  pi.on("session_start", (_e: any, ctx: any) => {
    manager = ctx.sessionManager;
    generation++;
  });
  pi.on("session_shutdown", () => {
    alive = false;
    generation++;
    manager = undefined;
  });
  const access = (
    ctx: any,
    name: string,
    b: PreferenceBinding,
    operation: string,
  ) => {
    if (!alive || ctx.sessionManager !== manager || ctx.signal?.aborted)
      throw Error("Stale model-profile session");
    const node = (globalThis as any)[
      Symbol.for("@mahirocoko/pi-guards:healthy-nodes")
    ]?.get(manager.getSessionId());
    const tool = pi.getAllTools().find((t: any) => t.name === name);
    if (!node?.modelProfiles)
      throw Error("Native model-profile guard unavailable");
    node.modelProfiles.assertAccess(tool, ctx, b.root, operation);
    assertPreferenceBinding(b);
  };
  const run = async (name: string, args: any, ctx: any) => {
    const allowed =
      name === "mh_list_model_profiles"
        ? []
        : name === "mh_set_model_profile"
          ? [
              "provider",
              "model",
              "context_window",
              "thinking",
              "label",
              "expected_sequence",
            ]
          : ["model", "expected_sequence"];
    if (
      !modelProfileToolNames.includes(name) ||
      !args ||
      Array.isArray(args) ||
      Object.keys(args).some((k) => !allowed.includes(k))
    )
      throw Error("Closed model-profile arguments required");
    const b = preferenceBinding(ctx.cwd, "model-profiles");
    if (!b)
      throw Error(
        "Model profiles disabled; explicit private configuration required",
      );
    const write = name !== modelProfileToolNames[0];
    access(ctx, name, b, write ? "write" : "read");
    const { state, ticket } = readProfiles(b);
    if (!write)
      return {
        profiles: state.profiles,
        sequence: state.sequence,
        current: {
          provider: ctx.model?.provider ?? null,
          model: ctx.model?.id ?? null,
          effectiveContextWindow: ctx.model?.contextWindow ?? null,
          thinking: pi.getThinkingLevel(),
        },
        contextOverride:
          "unsupported-public-api; saved contextWindow is a requested hint only",
        storage: b.root,
      };
    const expected = args.expected_sequence;
    if (expected !== state.sequence)
      throw Error("Exact expected_sequence required");
    let key: string, p: Profile;
    if (name === "mh_set_model_profile") {
      p = {
        provider: args.provider,
        model: args.model,
        contextWindow: args.context_window,
        ...(args.thinking !== undefined ? { thinking: args.thinking } : {}),
        ...(args.label !== undefined ? { label: args.label } : {}),
      };
      key = `${p.provider}/${p.model}`;
      state.profiles[key] = p;
    } else {
      const match = findProfile(state, args.model);
      key = match.key;
      p = match.profile;
      if (name === "mh_delete_model_profile") delete state.profiles[key];
    }
    validateProfiles(state);
    let target: any;
    // Exact public registry lookup; setModel below remains the native availability/auth validator.
    const available = () => ctx.modelRegistry.find(p.provider, p.model);
    if (name === "mh_switch_model_profile") {
      target = available();
      if (!target) throw Error("Native model unavailable");
      if (!ctx.isIdle()) throw Error("Native session busy");
    }
    if (!ctx.hasUI || !["rpc", "tui"].includes(ctx.mode))
      throw Error("Actual public UI confirmation required");
    const epoch = generation,
      session = manager.getSessionId(),
      identity = manager;
    const yes = await ctx.ui.confirm(
      "Mahiro model profile",
      `${name}: ${key}\nSequence: ${expected}\nSession: ${session}\nProject: ${b.project}\nProfile: ${b.profile}\nRequested context hint: ${p.contextWindow}; override unsupported by public API. Requested thinking: ${p.thinking ?? "unchanged"}`,
    );
    if (!yes) throw Error("Model profile declined");
    if (
      generation !== epoch ||
      manager !== identity ||
      manager.getSessionId() !== session
    )
      throw Error("Model-profile session replaced");
    const assert = () => {
      if (generation !== epoch || manager !== identity)
        throw Error("Model-profile generation changed");
      access(ctx, name, b, "write");
      if (readProfiles(b).ticket !== ticket)
        throw Error("Stale model-profile confirmation");
    };
    assert();
    if (name === "mh_switch_model_profile") {
      if (!ctx.isIdle() || available() !== target)
        throw Error("Native model availability changed");
      if (!(await pi.setModel(target)))
        throw Error("Native model selection refused");
      assert();
      if (p.thinking !== undefined) pi.setThinkingLevel(p.thinking);
      return {
        selected: key,
        requestedContextWindow: p.contextWindow,
        effectiveContextWindow: target.contextWindow,
        contextOverride: "unsupported-public-api",
        requestedThinking: p.thinking ?? null,
        effectiveThinking: pi.getThinkingLevel(),
        scope: "native-current-session",
        defaultsChanged: false,
      };
    }
    state.sequence++;
    publishPreference(b, ticket, state, assert, validateProfiles);
    return {
      saved: name === "mh_set_model_profile",
      removed: name === "mh_delete_model_profile",
      key,
      sequence: state.sequence,
    };
  };
  return { run };
}
