import { isAbsolute, join, normalize as normalizePath } from "node:path";
import {
  assertArchive,
  bytes,
  digest,
  hasSecret,
  inScope,
  search,
  validId,
  type IHit,
  type IPolicy,
  type IReadScope,
  type IRecord,
} from "./records.ts";

const manifestLimit = 1024 * 1024;
const shardLimit = 8 * 1024 * 1024;
const selectedLimit = 256 * 1024 * 1024;
const limits = { count: 6, perResultBytes: 1024, totalBytes: 6144 };
const fail = (): never => {
  throw new Error("Invalid historical continuity data");
};

export interface IHistoryShard {
  hash: string;
  bytes: number;
  projectId: string | null;
}
export interface IHistoryManifest {
  version: 1;
  kind: "sanitized-letta-visible-history";
  shards: IHistoryShard[];
}
export interface IHistoryAccess {
  root: string;
  // The caller must authorize EVERY path and perform a symlink-safe bounded read,
  // checking its current healthy ABI/token both before and after I/O.
  read: (absolutePath: string, maxBytes: number) => Promise<string>;
}

const exactObject = (
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export const validateHistoryManifest = (value: unknown): IHistoryManifest => {
  if (
    !exactObject(value, ["version", "kind", "shards"]) ||
    value.version !== 1 ||
    value.kind !== "sanitized-letta-visible-history" ||
    !Array.isArray(value.shards) ||
    value.shards.length > 4096
  )
    fail();
  const manifest = value as unknown as IHistoryManifest;
  const seen = new Set<string>();
  for (const shard of manifest.shards) {
    if (
      !exactObject(shard, ["hash", "bytes", "projectId"]) ||
      typeof shard.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(shard.hash) ||
      !Number.isInteger(shard.bytes) ||
      shard.bytes < 1 ||
      shard.bytes > shardLimit ||
      (shard.projectId !== null && !validId(shard.projectId)) ||
      seen.has(shard.hash)
    )
      fail();
    seen.add(shard.hash);
  }
  return manifest;
};

// JSON prototypes/poison keys are rejected before canonical archive validation.
const plainJson = (value: unknown): void => {
  if (value === null || typeof value !== "object") return;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail();
  for (const key of Object.keys(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) fail();
    plainJson((value as Record<string, unknown>)[key]);
  }
};
const forbidden = (text: string, policy: IPolicy) =>
  hasSecret(text) ||
  policy.excludedProjectIds.some((id) =>
    text.toLowerCase().includes(id.toLowerCase()),
  );
const checkedRead = async (
  access: IHistoryAccess,
  path: string,
  maxBytes: number,
) => {
  const text = await access.read(path, maxBytes);
  if (typeof text !== "string" || bytes(text) > maxBytes) fail();
  return text;
};
const selectedShards = async (
  access: IHistoryAccess,
  policy: IPolicy,
  scope: IReadScope,
) => {
  if (
    typeof access.root !== "string" ||
    !isAbsolute(access.root) ||
    normalizePath(access.root) !== access.root ||
    (access.root !== "/" && access.root.endsWith("/")) ||
    access.root.includes("\0") ||
    access.root.includes("\\") ||
    !validId(scope.projectId) ||
    (scope.includeGlobal !== undefined &&
      typeof scope.includeGlobal !== "boolean") ||
    (scope.crossProject !== undefined &&
      typeof scope.crossProject !== "boolean") ||
    forbidden(scope.projectId, policy)
  )
    fail();
  const manifest = validateHistoryManifest(
    JSON.parse(
      await checkedRead(
        access,
        join(access.root, "manifest.json"),
        manifestLimit,
      ),
    ),
  );
  // Even off-scope descriptors must not declare excluded/sensitive metadata.
  for (const shard of manifest.shards)
    if (shard.projectId !== null && forbidden(shard.projectId, policy)) fail();
  const selected = manifest.shards.filter((shard) =>
    inScope(shard as IRecord, scope),
  );
  if (selected.reduce((sum, shard) => sum + shard.bytes, 0) > selectedLimit)
    fail();
  return selected;
};

const visit = async (
  access: IHistoryAccess,
  policy: IPolicy,
  scope: IReadScope,
  hiddenIds: ReadonlySet<string>,
  consume: (records: IRecord[]) => void,
) => {
  const selected = await selectedShards(access, policy, scope);
  const seen = new Set<string>();
  for (const shard of selected) {
    const text = await checkedRead(
      access,
      join(access.root, `${shard.hash}.json`),
      shardLimit,
    );
    if (bytes(text) !== shard.bytes || digest(text) !== shard.hash) fail();
    const archive: unknown = JSON.parse(text);
    plainJson(archive);
    assertArchive(archive, policy);
    if (archive.quarantine.some((item) => forbidden(item.id, policy))) fail();
    for (const record of archive.records) {
      if (
        record.projectId !== shard.projectId ||
        record.sourceKind !== "letta_message" ||
        Object.values(record).some(
          (value) => typeof value === "string" && forbidden(value, policy),
        ) ||
        seen.has(record.id)
      )
        fail();
      // Strictly reject ALL duplicate IDs, including identical/hidden duplicates.
      seen.add(record.id);
    }
    consume(archive.records.filter((record) => !hiddenIds.has(record.id)));
  }
};

// Imported untrusted history only; no filesystem I/O, native Pi provenance,
// signatures, current-fact correction semantics, or same-UID security claims.
// Sequential shard validation is atomic: late errors never return partial results.
export const historyCandidates = async (
  access: IHistoryAccess,
  policy: IPolicy,
  query: string,
  scope: IReadScope,
  hiddenIds: ReadonlySet<string> = new Set(),
): Promise<IRecord[]> => {
  try {
    search([], query, scope, limits);
    let candidates: IRecord[] = [];
    await visit(access, policy, scope, hiddenIds, (records) => {
      const ids = new Set(
        search(records, query, scope, limits).map((hit) => hit.recordId),
      );
      const merged = [
        ...candidates,
        ...records.filter((record) => ids.has(record.id)),
      ];
      // Same scorer/tie-breaker at every stage: retain at most six records,
      // with at most twelve candidate records during each merge.
      const top = new Set(
        search(merged, query, scope, limits).map((hit) => hit.recordId),
      );
      candidates = merged.filter((record) => top.has(record.id));
    });
    return candidates;
  } catch {
    return fail();
  }
};

export const searchHistory = async (
  access: IHistoryAccess,
  policy: IPolicy,
  query: string,
  scope: IReadScope,
  hiddenIds: ReadonlySet<string> = new Set(),
): Promise<IHit[]> =>
  search(
    await historyCandidates(access, policy, query, scope, hiddenIds),
    query,
    scope,
    limits,
  );

export const readHistory = async (
  access: IHistoryAccess,
  policy: IPolicy,
  recordId: string,
  scope: IReadScope,
  hiddenIds: ReadonlySet<string> = new Set(),
): Promise<IRecord | undefined> => {
  try {
    if (!validId(recordId)) fail();
    let found: IRecord | undefined;
    await visit(access, policy, scope, hiddenIds, (records) => {
      found = records.find((record) => record.id === recordId) ?? found;
    });
    return found;
  } catch {
    return fail();
  }
};
