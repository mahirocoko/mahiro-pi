import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";
import {
  assertArchive,
  bytes,
  hasSecret,
  type IArchive,
  type IImport,
  type IPolicy,
  type IReadScope,
  type IRecord,
  inScope,
  normalize,
  objectShape,
  search,
  validId,
} from "./records.ts";

export interface ILifecycle {
  session: string;
  branch: string;
  epoch: number;
}
export interface ISnapshot {
  revision: number;
  lifecycle: ILifecycle;
  cursor: number;
}
export interface IFact {
  id: string;
  recordId: string;
  sourceRecordIds: string[];
  projectId: string;
  quote: string;
  authority: "quoted-user-note";
}
interface IControls {
  forgotten: string[];
  corrections: Record<string, IFact>;
}
interface IState extends ISnapshot {
  generation: string;
  facts: IFact[];
  controls: IControls;
}
interface IGeneration {
  archive: IArchive;
  facts: IFact[];
}
export interface IProposal {
  snapshot: ISnapshot;
  cursor: number;
  notes: { id: string; recordId: string; projectId: string; quote: string }[];
}

// Fail closed on every existing ancestor, including the configured root itself.
export function assertPrivatePath(path: string) {
  if (!isAbsolute(path) || resolve(path) !== path)
    throw new Error("Absolute canonical path required");
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part);
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error("Symlink refused");
    } else {
      // existsSync follows dangling symlinks, so lstat must also check missing paths.
      try {
        if (lstatSync(current).isSymbolicLink())
          throw new Error("Symlink refused");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}
const same = (a: ISnapshot, b: ISnapshot) =>
  a.revision === b.revision &&
  a.cursor === b.cursor &&
  a.lifecycle.session === b.lifecycle.session &&
  a.lifecycle.branch === b.lifecycle.branch &&
  a.lifecycle.epoch === b.lifecycle.epoch;
const lifecycleValid = (value: unknown): value is ILifecycle =>
  objectShape(value, ["session", "branch", "epoch"]) &&
  validId(value.session) &&
  validId(value.branch) &&
  typeof value.epoch === "number" &&
  Number.isSafeInteger(value.epoch) &&
  value.epoch >= 0;
const clone = <T>(value: T): T => structuredClone(value);
const counter = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value < Number.MAX_SAFE_INTEGER;
const idList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 10000 &&
  value.every(validId) &&
  new Set(value).size === value.length;
// A deny-list screen is not semantic validation or proof of a user's enduring preference.
export const safeQuote = (quote: unknown): quote is string =>
  typeof quote === "string" &&
  !!quote.trim() &&
  bytes(quote) <= 2048 &&
  !hasSecret(quote) &&
  !/\b(?:system|instruction|policy|persona|ignore|must|always|never|execute|tool|core)\b/i.test(
    quote,
  );
const factValid = (fact: unknown): fact is IFact =>
  objectShape(fact, [
    "id",
    "recordId",
    "sourceRecordIds",
    "projectId",
    "quote",
    "authority",
  ]) &&
  validId(fact.id) &&
  validId(fact.recordId) &&
  idList(fact.sourceRecordIds) &&
  fact.sourceRecordIds.includes(fact.recordId) &&
  validId(fact.projectId) &&
  safeQuote(fact.quote) &&
  fact.authority === "quoted-user-note";
const factsValid = (facts: unknown): facts is IFact[] =>
  Array.isArray(facts) &&
  facts.length <= 10000 &&
  facts.every(factValid) &&
  new Set(facts.map((fact) => fact.id)).size === facts.length;
const snapshotValid = (value: unknown): value is ISnapshot =>
  objectShape(value, [
    "revision",
    "cursor",
    "lifecycle",
    "generation",
    "facts",
    "controls",
  ]) &&
  counter(value.revision) &&
  counter(value.cursor) &&
  lifecycleValid(value.lifecycle);
const stateValid = (value: unknown): value is IState => {
  if (
    !snapshotValid(value) ||
    !objectShape(value, [
      "revision",
      "cursor",
      "lifecycle",
      "generation",
      "facts",
      "controls",
    ]) ||
    !validId(value.generation) ||
    !factsValid(value.facts) ||
    !objectShape(value.controls, ["forgotten", "corrections"]) ||
    !idList(value.controls.forgotten) ||
    !objectShape(
      value.controls.corrections,
      Object.keys(value.controls.corrections ?? {}),
    ) ||
    Object.keys(value.controls.corrections).length > 10000
  )
    return false;
  return Object.entries(value.controls.corrections).every(
    ([id, fact]) => validId(id) && factValid(fact) && fact.id === id,
  );
};

export function createStore(
  root: string,
  policy: IPolicy,
  options: {
    beforePointer?: () => void;
    beforeWrite?: (path: string) => void;
    readOnly?: boolean;
    beforeRead?: (path: string) => void;
  } = {},
) {
  assertPrivatePath(root);
  if (!options.readOnly) {
    options.beforeWrite?.(root);
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  if ((lstatSync(root).mode & 0o077) !== 0)
    throw new Error("Private directory permissions required");
  const pointer = join(root, "state.json");
  const lock = join(root, "writer.lock");
  const readJson = (path: string): unknown => {
    options.beforeRead?.(path);
    assertPrivatePath(path);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const text = readFileSync(fd, "utf8");
      if (bytes(text) > 16 * 1024 * 1024)
        throw new Error("State bound exceeded");
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("Invalid continuity data");
      }
    } finally {
      closeSync(fd);
    }
  };
  const generation = (id: string): IGeneration => {
    if (!validId(id)) throw new Error("Invalid continuity data");
    const value = readJson(join(root, `${id}.json`));
    try {
      if (!objectShape(value, ["archive", "facts"]) || !factsValid(value.facts))
        throw new Error();
      assertArchive(value.archive, policy);
      for (const fact of value.facts) {
        if (
          !value.archive.records.some(
            (record) =>
              record.id === fact.recordId &&
              record.projectId === fact.projectId &&
              record.authority === "historical-user" &&
              record.text.includes(fact.quote),
          )
        )
          throw new Error();
      }
      return value as unknown as IGeneration;
    } catch {
      throw new Error("Invalid continuity data");
    }
  };
  const state = (): IState => {
    const value = readJson(pointer);
    try {
      if (!stateValid(value)) throw new Error();
      const current = generation(value.generation);
      const allFacts = [
        ...value.facts,
        ...Object.values(value.controls.corrections),
      ];
      if (
        allFacts.some(
          (fact) =>
            !current.archive.records.some(
              (record) =>
                record.id === fact.recordId &&
                record.projectId === fact.projectId &&
                record.authority === "historical-user" &&
                record.text.includes(fact.quote),
            ),
        )
      )
        throw new Error();
      return value;
    } catch {
      throw new Error("Invalid continuity data");
    }
  };
  const write = (path: string, value: unknown) => {
    options.beforeWrite?.(path);
    assertPrivatePath(path);
    const fd = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, JSON.stringify(value));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };
  let leased = false;
  let leaseIdentity: { dev: number; ino: number } | undefined;
  const checkLease = () => {
    if (!leased) return;
    const stat = lstatSync(lock);
    if (
      !leaseIdentity ||
      stat.dev !== leaseIdentity.dev ||
      stat.ino !== leaseIdentity.ino ||
      !stat.isDirectory()
    )
      throw new Error("Lost writer lease");
  };
  const locked = <T>(operation: () => T): T => {
    if (leased) {
      checkLease();
      options.beforeWrite?.(lock);
      return operation();
    }
    if (options.readOnly) throw new Error("Read-only continuity store");
    assertPrivatePath(root);
    assertPrivatePath(lock);
    options.beforeWrite?.(lock);
    mkdirSync(lock, { mode: 0o700 });
    try {
      return operation();
    } finally {
      rmdirSync(lock);
    }
  };
  const commit = (next: IState, archive: IArchive) => {
    const previous = existsSync(pointer)
      ? readFileSync(pointer, "utf8")
      : undefined;
    next.generation = randomUUID();
    if (!stateValid(next)) throw new Error("Invalid continuity data");
    assertArchive(archive, policy);
    write(join(root, `${next.generation}.json`), {
      archive,
      facts: next.facts,
    });
    const temporary = join(root, `pointer-${randomUUID()}.tmp`);
    write(temporary, next);
    try {
      options.beforePointer?.();
      options.beforeWrite?.(pointer);
      checkLease();
      if (
        (existsSync(pointer) ? readFileSync(pointer, "utf8") : undefined) !==
        previous
      )
        throw new Error("Stale pointer");
      assertPrivatePath(pointer);
      renameSync(temporary, pointer);
      const fd = openSync(root, constants.O_RDONLY);
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
    return clone(next);
  };
  const expect = (expected: ISnapshot) => {
    const current = state();
    if (!snapshotValid(expected) || !same(expected, current))
      throw new Error("Stale revision or lifecycle");
    return current;
  };
  const activeRecords = (current: IState, archive: IArchive) =>
    archive.records.filter(
      (record) => !current.controls.forgotten.includes(record.id),
    );
  const activeFacts = (current: IState, facts: IFact[]) => {
    const merged = new Map(facts.map((fact) => [fact.id, fact]));
    for (const fact of Object.values(current.controls.corrections))
      merged.set(fact.id, fact);
    return [...merged.values()].filter(
      (fact) =>
        !fact.sourceRecordIds.some((id) =>
          current.controls.forgotten.includes(id),
        ) && !current.controls.forgotten.includes(fact.id),
    );
  };
  const mergeRecords = (
    archive: IArchive,
    incoming: readonly IRecord[],
  ): IArchive => {
    const records = new Map(
      archive.records.map((record) => [record.id, record]),
    );
    const signature = (record: IRecord) =>
      JSON.stringify([
        record.sourceKind,
        record.projectId,
        record.agentId,
        record.conversationId,
        record.messageId,
        record.date,
        record.path,
        record.hash,
        record.authority,
        record.evidence,
        record.text,
      ]);
    for (const record of incoming) {
      const old = records.get(record.id);
      if (old && signature(old) !== signature(record))
        throw new Error("Conflicting duplicate identity");
      if (!old) records.set(record.id, record);
    }
    const merged = { ...archive, records: [...records.values()] };
    assertArchive(merged, policy);
    return merged;
  };
  return {
    acquireLease() {
      if (options.readOnly || leased) throw new Error("Writer unavailable");
      options.beforeWrite?.(lock);
      assertPrivatePath(lock);
      mkdirSync(lock, { mode: 0o700 });
      leaseIdentity = lstatSync(lock);
      leased = true;
      return () => {
        if (!leased) return;
        try {
          checkLease();
        } catch {
          leased = false;
          return;
        }
        leased = false;
        leaseIdentity = undefined;
        rmdirSync(lock);
      };
    },
    delta(
      expected: ISnapshot,
      eligible: ReadonlySet<string>,
      maxBytes = 16384,
    ) {
      const s = expect(expected);
      const archive = generation(s.generation).archive;
      const records: IRecord[] = [];
      let cursor = s.cursor;
      for (let i = s.cursor; i < archive.records.length; i++) {
        const record = archive.records[i];
        if (
          eligible.has(record.id) &&
          !s.controls.forgotten.includes(record.id)
        ) {
          if (bytes(JSON.stringify([...records, record])) > maxBytes) break;
          records.push(clone(record));
        }
        cursor = i + 1;
      }
      return { records, cursor };
    },
    initialize(lifecycle: ILifecycle, inputs: readonly IImport[] = []) {
      if (!lifecycleValid(lifecycle)) throw new Error("Invalid lifecycle");
      const archive = normalize(inputs, policy);
      return locked(() => {
        if (existsSync(pointer)) throw new Error("Already initialized");
        return commit(
          {
            revision: 0,
            lifecycle: clone(lifecycle),
            cursor: 0,
            generation: "",
            facts: [],
            controls: { forgotten: [], corrections: {} },
          },
          archive,
        );
      });
    },
    snapshot(): ISnapshot {
      const s = state();
      return {
        revision: s.revision,
        lifecycle: clone(s.lifecycle),
        cursor: s.cursor,
      };
    },
    inspect() {
      const s = state();
      return { ...clone(s), facts: activeFacts(s, s.facts) };
    },
    read(
      recordId: string,
      scope: IReadScope,
      oldGeneration?: string,
    ): IRecord | undefined {
      if (!validId(recordId) || !validId(scope.projectId))
        throw new Error("Invalid read identity");
      const s = state();
      return clone(
        activeRecords(
          s,
          generation(oldGeneration ?? s.generation).archive,
        ).find((r) => r.id === recordId && inScope(r, scope)),
      );
    },
    search(
      query: string,
      scope: IReadScope,
      limits?: Parameters<typeof search>[3],
    ) {
      const s = state();
      return search(
        activeRecords(s, generation(s.generation).archive),
        query,
        scope,
        limits,
      );
    },
    // Cooperative local DTO ingestion; sourceKind is not proof of SDK provenance.
    ingest(expected: ISnapshot, inputs: readonly IImport[]): ISnapshot {
      return locked(() => {
        const s = expect(expected);
        const archive = generation(s.generation).archive;
        if (
          !Array.isArray(inputs) ||
          inputs.some((input) => input?.sourceKind !== "pi_message")
        )
          throw new Error("Invalid ingestion source");
        const incoming = normalize(inputs, policy);
        const records = new Map(
          archive.records.map((record) => [record.id, record]),
        );
        const retainedIds = new Set([
          ...records.keys(),
          ...incoming.records.map((record) => record.id),
        ]);
        // The normalizer intentionally skips tools and excluded sources. A skipped
        // input must not silently mask a conflicting reuse of a retained identity.
        for (const input of inputs) {
          if (
            retainedIds.has(input.id) &&
            normalize([input], policy).records.length !== 1
          )
            throw new Error("Conflicting duplicate identity");
        }
        // Rejected payloads are never retained, nor accumulated as an unbounded log.
        // A rejected reuse of an existing identity cannot overwrite its source.
        if (incoming.quarantine.some((item) => records.has(item.id)))
          throw new Error("Conflicting duplicate identity");
        const merged = mergeRecords(archive, incoming.records);
        if (merged.records.length === archive.records.length) return clone(s);
        return commit({ ...s, revision: s.revision + 1 }, merged);
      });
    },
    // Only the guarded runtime caller may establish successful worker completion.
    markReviewed(expected: ISnapshot, cursor: number): ISnapshot {
      return locked(() => {
        const s = expect(expected);
        const archive = generation(s.generation).archive;
        if (
          !Number.isSafeInteger(cursor) ||
          cursor <= s.cursor ||
          cursor > archive.records.length
        )
          throw new Error("Invalid reflection completion");
        return commit({ ...s, revision: s.revision + 1, cursor }, archive);
      });
    },
    changeLifecycle(expected: ISnapshot, lifecycle: ILifecycle) {
      if (!lifecycleValid(lifecycle)) throw new Error("Invalid lifecycle");
      return locked(() => {
        const s = expect(expected);
        return commit(
          { ...s, revision: s.revision + 1, lifecycle: clone(lifecycle) },
          generation(s.generation).archive,
        );
      });
    },
    forget(expected: ISnapshot, ids: string[]) {
      if (!ids.length || ids.length > 1000 || !ids.every(validId))
        throw new Error("Invalid forget identities");
      return locked(() => {
        const s = expect(expected);
        // Fact forgetting also suppresses its archive source and old-generation reads.
        const sourceIds = s.facts
          .filter((fact) => ids.includes(fact.id))
          .flatMap((fact) => fact.sourceRecordIds);
        s.controls.forgotten = [
          ...new Set([...s.controls.forgotten, ...ids, ...sourceIds]),
        ];
        s.facts = activeFacts(s, s.facts);
        for (const [id, fact] of Object.entries(s.controls.corrections)) {
          if (
            s.controls.forgotten.includes(id) ||
            fact.sourceRecordIds.some((source) =>
              s.controls.forgotten.includes(source),
            )
          )
            delete s.controls.corrections[id];
        }
        return commit(
          { ...s, revision: s.revision + 1 },
          generation(s.generation).archive,
        );
      });
    },
    // Confirmation is supplied by the guarded caller, never evidence a worker may self-assert.
    // Even confirmed notes remain quoted, low-authority evidence, not Core preferences.
    accept(
      expected: ISnapshot,
      proposal: IProposal,
      outcome: "completed" | "error" | "aborted",
      confirmedNoteIds: readonly string[],
    ) {
      return locked(() => {
        const s = expect(expected);
        if (
          outcome !== "completed" ||
          !same(proposal.snapshot, s) ||
          !Number.isSafeInteger(proposal.cursor) ||
          proposal.cursor <= s.cursor ||
          proposal.notes.length < 1 ||
          proposal.notes.length > 16
        )
          throw new Error("Invalid reflection completion");
        const archive = generation(s.generation).archive;
        if (proposal.cursor > archive.records.length)
          throw new Error("Invalid reflection cursor");
        const records = activeRecords(s, archive);
        const notes: IFact[] = proposal.notes.map((note) => {
          const source = records.find(
            (r) =>
              r.id === note.recordId &&
              r.projectId === note.projectId &&
              r.authority === "historical-user",
          );
          if (
            !validId(note.id) ||
            !validId(note.projectId) ||
            !confirmedNoteIds.includes(note.id) ||
            !source ||
            !safeQuote(note.quote) ||
            !source.text.includes(note.quote) ||
            s.controls.forgotten.includes(note.id)
          )
            throw new Error("Unconfirmed or unsafe quoted note");
          return {
            id: note.id,
            recordId: note.recordId,
            sourceRecordIds: [note.recordId],
            projectId: note.projectId,
            quote: note.quote,
            authority: "quoted-user-note",
          };
        });
        const ids = new Set(s.facts.map((fact) => fact.id));
        for (const note of notes) {
          if (ids.has(note.id))
            throw new Error("Existing note requires explicit correction");
          ids.add(note.id);
        }
        return commit(
          {
            ...s,
            revision: s.revision + 1,
            cursor: proposal.cursor,
            facts: [...s.facts, ...notes],
          },
          archive,
        );
      });
    },
    correct(
      expected: ISnapshot,
      factId: string,
      recordId: string,
      quote: string,
    ) {
      return locked(() => {
        const s = expect(expected);
        const old = s.facts.find((fact) => fact.id === factId);
        const source = activeRecords(s, generation(s.generation).archive).find(
          (r) =>
            r.id === recordId &&
            r.authority === "historical-user" &&
            r.projectId === old?.projectId,
        );
        if (
          !validId(factId) ||
          !validId(recordId) ||
          !old ||
          !source ||
          !safeQuote(quote) ||
          !source.text.includes(quote)
        )
          throw new Error("Invalid correction citation");
        const fact: IFact = {
          ...old,
          recordId,
          quote,
          sourceRecordIds: [...new Set([...old.sourceRecordIds, recordId])],
        };
        delete s.controls.corrections[factId];
        s.controls.corrections[factId] = fact;
        s.facts = [
          ...activeFacts(s, s.facts).filter((item) => item.id !== factId),
          fact,
        ];
        return commit(
          { ...s, revision: s.revision + 1 },
          generation(s.generation).archive,
        );
      });
    },
    rollback(expected: ISnapshot, target: string) {
      return locked(() => {
        const s = expect(expected);
        const old = generation(target);
        // Keep the current archive prefix: the cursor is an archive ordinal, not
        // a historical branch position. Recovery cannot drop newer fact sources.
        const archive = mergeRecords(
          generation(s.generation).archive,
          old.archive.records,
        );
        const facts = activeFacts(s, [...old.facts, ...s.facts]);
        return commit({ ...s, revision: s.revision + 1, facts }, archive);
      });
    },
  };
}
