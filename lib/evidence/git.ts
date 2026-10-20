import { spawn } from "node:child_process";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  boundedGitPath,
  type CodeEvidenceReport,
  capLane,
  collectionFingerprint,
  parseNameStatus,
  validateBaseRef,
} from "./model.ts";

// Operator/source bound, never caller input or PATH lookup.
export const GIT = "/usr/bin/git";
export const PREFIX = [
  "--no-optional-locks",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.excludesFile=/dev/null",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "submodule.recurse=false",
  "-c",
  "diff.submodule=short",
  "-c",
  "protocol.allow=never",
];
export const PREFLIGHT = [
  "config",
  "--name-only",
  "--get-regexp",
  "^(filter\\..*\\.(clean|process|smudge)|remote\\..*\\.promisor|extensions\\.partialclone|core\\.(worktree|alternaterefscommand)|extensions\\.worktreeconfig)$",
];
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export function oid(text: string) {
  if (!OID.test(text)) throw Error("Git full object identity required");
  return text;
}
export interface GitAuthority {
  assertCurrent(): void;
  assertSources(paths: readonly string[]): void;
  authorizeGit(
    executable: string,
    args: string[],
    signal: AbortSignal,
  ): Promise<void>;
}
export class GitInspection {
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout>;
  private removers: (() => void)[] = [];
  private active = 0;
  private children = new Set<ReturnType<typeof spawn>>();
  private sources = new Set<string>();
  private trees = new Set<string>();
  private tracked: string[] = [];
  private workFiles: string[] = [];
  private selection(paths: string[]) {
    if (!paths.length) throw Error("Empty source selection unsupported");
    const selection = paths.flatMap((path) => [
      `:(top,literal)${path}`,
      `:(top,literal,exclude)${path}/`,
    ]);
    if (selection.join("\0").length > 120000)
      throw Error("Evidence pathspec bound exceeded");
    return selection;
  }
  assertSources() {
    this.authority.assertSources([...this.sources]);
  }
  readonly project: string;
  readonly authority: GitAuthority;
  constructor(
    project: string,
    authority: GitAuthority,
    signals: (AbortSignal | undefined)[] = [],
  ) {
    this.project = project;
    this.authority = authority;
    this.timer = setTimeout(() => this.controller.abort(), 90000);
    for (const signal of signals)
      if (signal) {
        const abort = () => this.controller.abort();
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
        this.removers.push(() => signal.removeEventListener("abort", abort));
      }
  }
  close() {
    clearTimeout(this.timer);
    for (const remove of this.removers) remove();
    this.controller.abort();
  }
  assert() {
    if (this.controller.signal.aborted)
      throw Error("Git inspection cancelled/deadline");
    this.authority.assertCurrent();
  }
  async run(
    tail: string[],
    absent?: "config" | "upstream",
  ): Promise<string | null> {
    this.assert();
    const args = [...PREFIX, ...tail];
    await this.authority.authorizeGit(GIT, args, this.controller.signal);
    this.assert();
    this.assertSources(); // fresh public-owner decision after await, before spawn
    if (++this.active > 1) {
      this.active--;
      throw Error("Git concurrency bound");
    }
    try {
      return await new Promise<string | null>((accept, reject) => {
        const env: NodeJS.ProcessEnv = {};
        // Allowlist rather than trying to enumerate every Git override.
        for (const key of ["HOME", "XDG_CONFIG_HOME", "TMPDIR", "SYSTEMROOT"])
          if (process.env[key]) env[key] = process.env[key];
        Object.assign(env, {
          PATH: "/usr/bin:/bin",
          LC_ALL: "C",
          GIT_TERMINAL_PROMPT: "0",
          GIT_NO_LAZY_FETCH: "1",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_ASKPASS: "/usr/bin/false",
          SSH_ASKPASS: "/usr/bin/false",
          GIT_SSH_COMMAND: "/usr/bin/false",
        });
        const child = spawn(GIT, args, {
          cwd: this.project,
          env,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        this.children.add(child);
        const chunks: Buffer[] = [];
        let size = 0,
          failure: Error | undefined,
          stderr = "";
        const stop = (error: Error) => {
          failure ??= error;
          child.kill("SIGKILL");
        };
        const cancel = () => stop(Error("Git inspection cancelled/deadline"));
        this.controller.signal.addEventListener("abort", cancel, {
          once: true,
        });
        const poll = setInterval(() => {
          try {
            this.assert();
          } catch {
            stop(Error("Git authority revoked"));
          }
        }, 20);
        const timer = setTimeout(
          () => stop(Error("Git command deadline")),
          30000,
        );
        child.stdout.on("data", (data: Buffer) => {
          size += data.length;
          if (size > 2 * 1024 * 1024) stop(Error("Git output bound exceeded"));
          else chunks.push(data);
        });
        // Never include raw stderr/patch/config values in error messages.
        child.stderr.on("data", (data: Buffer) => {
          size += data.length;
          if (size > 2 * 1024 * 1024) stop(Error("Git output bound exceeded"));
          else if (absent === "upstream") stderr += data.toString("utf8");
        });
        child.on("error", () => {
          failure ??= Error("Git process unavailable");
        });
        child.on("close", (code) => {
          this.children.delete(child);
          clearInterval(poll);
          clearTimeout(timer);
          this.controller.signal.removeEventListener("abort", cancel);
          try {
            this.assert();
          } catch {
            failure ??= Error("Git authority cancelled/revoked");
          }
          if (failure) return reject(failure);
          const bytes = Buffer.concat(chunks),
            text = bytes.toString("utf8");
          if (!Buffer.from(text).equals(bytes))
            return reject(Error("Git UTF-8 output required"));
          if (code === 0) return accept(text);
          if (absent === "config" && code === 1 && !text) return accept(null);
          if (
            absent === "upstream" &&
            code === 128 &&
            !text &&
            /^fatal: (?:no upstream configured for branch '[^'\r\n]+'|HEAD does not point to a branch)\n$/.test(
              stderr,
            )
          )
            return accept(null);
          reject(Error(`Fixed Git inspection failed (exit ${code})`));
        });
      });
    } finally {
      this.active--;
    }
  }
  async preflight(workspace: string) {
    this.assert();
    if (
      realpathSync(this.project) !== this.project ||
      realpathSync(workspace) !== workspace ||
      !(workspace === this.project || workspace.startsWith(this.project + sep))
    )
      throw Error("Workspace outside configured project");
    // Only the top-level identity query is allowed before exact root equality.
    const root = (await this.run(["rev-parse", "--show-toplevel"]))!.trim();
    if (root !== this.project)
      throw Error(
        "Configured project must equal Git worktree top-level; subproject collection denied",
      );
    const gitDir = join(root, ".git"),
      stat = lstatSync(gitDir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(gitDir) !== gitDir
    )
      throw Error("External Git directory/linked worktree unsupported");
    for (const path of [
      join(gitDir, "commondir"),
      join(gitDir, "objects/info/alternates"),
      join(gitDir, "objects/info/http-alternates"),
    ]) {
      try {
        lstatSync(path);
        throw Error("External Git storage unsupported");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    for (const dir of [
      gitDir,
      join(gitDir, "objects"),
      join(gitDir, "objects/info"),
      join(gitDir, "objects/pack"),
      join(gitDir, "refs"),
    ]) {
      try {
        if (!lstatSync(dir).isDirectory() || realpathSync(dir) !== dir)
          throw Error("External Git storage unsupported");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    for (const file of [
      "config",
      "config.worktree",
      "index",
      "HEAD",
      "packed-refs",
      "shallow",
    ]) {
      try {
        const path = join(gitDir, file);
        if (!lstatSync(path).isFile() || realpathSync(path) !== path)
          throw Error("External Git metadata unsupported");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    // Bounded administrative metadata walk, not source/content indexing. Ref,
    // object, exclude and other Git metadata symlinks cannot redirect reads.
    const pending = [gitDir];
    let entries = 0;
    while (pending.length) {
      const directory = pending.pop()!;
      for (const name of readdirSync(directory)) {
        if (++entries > 20000)
          throw Error("Git administrative metadata bound exceeded");
        const path = join(directory, name),
          info = lstatSync(path);
        if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
          throw Error("External/special Git metadata unsupported");
        if (info.isDirectory()) pending.push(path);
      }
    }
    if ((await this.run(PREFLIGHT, "config"))?.trim())
      throw Error(
        "Execution-capable filter/promisor/external-storage Git configuration unsupported",
      );
  }
  async base(explicit: string | null, head: string) {
    if (explicit)
      return {
        commit: oid(
          (await this.run([
            "rev-parse",
            "--verify",
            "--end-of-options",
            `${explicit}^{commit}`,
          ]))!.trim(),
        ),
        source: "explicit" as const,
        reference: explicit,
      };
    // Only Git's explicit C-locale absent-upstream diagnostic is absence;
    // timeout, cancellation, output overflow and every other failure propagate.
    const upstream = (
      await this.run(
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        "upstream",
      )
    )?.trim();
    if (!upstream)
      return { commit: null, source: "none" as const, reference: null };
    validateBaseRef(upstream);
    const upstreamOid = oid(
      (await this.run([
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${upstream}^{commit}`,
      ]))!.trim(),
    );
    return {
      commit: oid((await this.run(["merge-base", head, upstreamOid]))!.trim()),
      source: "upstream" as const,
      reference: upstream,
    };
  }
  // Metadata-only discovery: never diff/status (even name-only may hash source).
  // Conservative: authorize unchanged, ignored and historical paths too. No silent
  // filtering of denied files. Tree/index names never become arbitrary argv.
  async inventory() {
    const paths = new Set<string>();
    const add = (name: string) => {
      if (
        !name ||
        name.startsWith("/") ||
        name.split("/").some((p) => !p || p === "." || p === "..") ||
        name.includes("\0")
      )
        throw Error("Invalid Git source path");
      const absolute = resolve(this.project, name);
      if (!absolute.startsWith(this.project + sep))
        throw Error("Git source escape");
      paths.add(name);
      this.sources.add(absolute);
      const parts = name.split("/");
      parts.pop();
      let parent = this.project;
      for (const part of ["", ...parts]) {
        if (part) parent = join(parent, part);
        this.sources.add(join(parent, ".gitattributes"));
        this.sources.add(join(parent, ".gitignore"));
      }
    };
    for (const name of (await this.run(["ls-files", "--cached", "-z", "--"]))!
      .split("\0")
      .filter(Boolean))
      add(name);
    for (const tree of this.trees) {
      for (const entry of (await this.run(["ls-tree", "-r", "-z", tree]))!
        .split("\0")
        .filter(Boolean)) {
        const tab = entry.indexOf("\t");
        if (
          tab < 0 ||
          !/^100(?:644|755) blob [a-f0-9]+$/.test(entry.slice(0, tab))
        )
          throw Error("Symlink/submodule tree sources unsupported");
        add(entry.slice(tab + 1));
      }
    }
    this.tracked = [...paths].sort();
    const pending = [this.project];
    this.workFiles = [];
    let count = 0;
    while (pending.length) {
      const directory = pending.pop()!;
      this.sources.add(directory);
      this.sources.add(join(directory, ".gitignore"));
      this.sources.add(join(directory, ".gitattributes"));
      this.authority.assertSources([
        directory,
        join(directory, ".gitignore"),
        join(directory, ".gitattributes"),
      ]);
      for (const name of readdirSync(directory)) {
        if (directory === this.project && name === ".git") continue;
        if (++count > 4096)
          throw Error("Evidence source inventory bound exceeded");
        const absolute = join(directory, name);
        this.sources.add(absolute);
        this.authority.assertSources([absolute]); // BEFORE source lstat, including untracked/ignored
        const info = lstatSync(absolute);
        if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
          throw Error("Symlink/special source unsupported");
        if (info.isDirectory()) pending.push(absolute);
        else this.workFiles.push(absolute.slice(this.project.length + 1));
      }
    }
    for (const name of [".git/info/exclude", ".git/config"])
      this.sources.add(join(this.project, name));
    if (this.sources.size > 8192)
      throw Error("Evidence source authorization bound exceeded");
    this.assert();
    this.assertSources();
  }
  async diff(args: string[], inventoried = false) {
    if (!inventoried) await this.inventory();
    // Exact literal file selection, no rename candidate expansion. The paired
    // trailing-slash exclusions prevent a file replaced by a directory widening
    // into newly indexed descendants. New index names cannot enter this diff.
    const selection = this.selection(this.tracked);
    const fixed = [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      ...args,
    ];
    const names = parseNameStatus(
      (await this.run([...fixed, "--name-status", "-z", "--", ...selection]))!,
    );
    const stat =
      (await this.run([...fixed, "--shortstat", "--", ...selection]))!.trim() ||
      null;
    const transientPatch = (await this.run([
      ...fixed,
      "--binary",
      "--",
      ...selection,
    ]))!;
    return capLane(names, stat, transientPatch);
  }
  async untracked(inventoried = false) {
    if (!inventoried) await this.inventory();
    if (!this.workFiles.length) return capLane([], null, "\0");
    const output = (await this.run([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...this.selection(this.workFiles),
    ]))!;
    const paths = output.split("\0").filter(Boolean);
    for (const path of paths) this.sources.add(resolve(this.project, path));
    this.assert();
    const metadata = paths
      .slice(0, 512)
      .map((path) => {
        const absolute = resolve(this.project, path);
        if (!absolute.startsWith(this.project + sep))
          throw Error("Git path escape");
        const parent = realpathSync(join(absolute, ".."));
        if (!(parent === this.project || parent.startsWith(this.project + sep)))
          throw Error("Untracked parent symlink escape");
        const stat = lstatSync(absolute);
        return `${path}\0${stat.size}\0${stat.mtimeMs}\0${stat.mode}`;
      })
      .join("\0");
    return capLane(
      paths.map((path) => ({
        status: "??",
        path: boundedGitPath(path),
        previousPath: null,
      })),
      null,
      `${output}\0${metadata}`,
    );
  }
  async sample(baseReference: string | null) {
    const head = oid(
      (await this.run([
        "rev-parse",
        "--verify",
        "--end-of-options",
        "HEAD^{commit}",
      ]))!.trim(),
    );
    const branch =
      (await this.run(["branch", "--show-current"]))!.trim() || null;
    const base = await this.base(baseReference, head);
    this.trees = new Set([head, ...(base.commit ? [base.commit] : [])]);
    // One immutable operand set per sample: later index additions cannot widen
    // any lane. Permission decisions themselves are never cached across spawns.
    await this.inventory();
    const staged = await this.diff(["--cached"], true),
      unstaged = await this.diff([], true),
      untracked = await this.untracked(true);
    const baseToHead = base.commit
      ? await this.diff([base.commit, head], true)
      : null;
    const after = oid(
      (await this.run([
        "rev-parse",
        "--verify",
        "--end-of-options",
        "HEAD^{commit}",
      ]))!.trim(),
    );
    this.assert();
    return {
      branch,
      headCommit: head,
      baseCommit: base.commit,
      baseSource: base.source,
      baseReference: base.reference,
      staged,
      unstaged,
      untracked,
      baseToHead,
      stableHead: head === after,
      fingerprint: collectionFingerprint(
        head,
        base.commit,
        staged,
        unstaged,
        untracked,
        baseToHead,
      ),
    };
  }
  async freshness(report: CodeEvidenceReport, requireMatching = false) {
    await this.preflight(report.requestedWorkspace);
    const base = report.baseSource === "explicit" ? report.baseReference : null;
    const first = await this.sample(base),
      second = await this.sample(base);
    const matching =
      first.stableHead &&
      second.stableHead &&
      first.fingerprint === second.fingerprint &&
      second.fingerprint === report.fingerprint &&
      first.branch === second.branch &&
      second.branch === report.branch &&
      second.baseReference === report.baseReference &&
      second.baseSource === report.baseSource;
    if (requireMatching && !matching)
      throw Error("Repository changed during collection; retry when quiet");
    const current = matching && !second.untracked.omitted;
    return {
      ...structuredClone(report),
      freshness: {
        isCurrent: current,
        currentHead: second.headCommit,
        reason: current
          ? "Two consecutive bounded samples match; not an atomic Git snapshot."
          : "Repository HEAD/base/Git lanes changed or bounded sample incomplete; recollect before selection.",
      },
    };
  }
}
