import { planSetup } from "./setup.ts";

export interface NativeBasicFilePolicyPlan {
  next: string | null;
  changed: boolean;
  addedPatterns: string[];
  retainedSurfaces: string[];
  warnings: string[];
  status: "added" | "unchanged" | "skipped";
  runtimePolicy: "public-service-authoritative";
}

// Finite BASIC read defaults only; deliberately not a secret matcher or resolver.
const names = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.test",
  ".env.production",
  ".env.staging",
  ".env.development.local",
  ".env.test.local",
  ".env.production.local",
  ".env.staging.local",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "auth.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ecdsa_sk",
  "id_ed25519",
  "id_ed25519_sk",
];
const defaults = names.flatMap((name) => [name, `*/${name}`]);

// Pure opt-in advisor: reuse strict bounded validation, discard skill output.
// Public PSS is the only runtime resolver, including project overrides and yolo.
export const planNativeBasicFilePolicy = (
  previous: string | null,
): NativeBasicFilePolicyPlan => {
  planSetup(previous);
  const config = previous === null ? {} : JSON.parse(previous);
  const permission = config.permission ?? {};
  const retainedSurfaces = Object.keys(permission);
  const warnings = [
    "BASIC read defaults are incomplete, not write protection or a sandbox. Public runtime policy, project overrides and yolo remain authoritative.",
  ];
  const unchanged = (
    status: "unchanged" | "skipped",
  ): NativeBasicFilePolicyPlan => ({
    next: previous,
    changed: false,
    addedPatterns: [],
    retainedSurfaces,
    warnings,
    status,
    runtimePolicy: "public-service-authoritative",
  });
  if (Object.hasOwn(permission, "path")) {
    warnings.push(
      "Generic path policy retained; adding directional policy could override existing decisions. Automatic insertion skipped.",
    );
    return unchanged("skipped");
  }
  if (
    Object.keys(permission).some((key) => key !== "*" && /[*?\[]/.test(key))
  ) {
    warnings.push(
      "Nonuniversal permission surface wildcard retained; interaction is unsupported. Automatic insertion skipped.",
    );
    return unchanged("skipped");
  }
  const read = permission.path_read;
  if (typeof read === "string") {
    warnings.push(
      "Scalar path_read retained without conversion; automatic insertion skipped.",
    );
    return unchanged("skipped");
  }
  const entries = Object.entries(read ?? {});
  if (
    entries.some(
      ([key]) => String(Number(key) >>> 0) === key && key !== "4294967295",
    )
  )
    throw new Error("Unsupported integer-like path_read pattern order");
  if (entries.some(([, value]) => value === "allow" || value === "ask"))
    warnings.push(
      "Existing path_read allow/ask decisions remain later in order and may override BASIC defaults, including broad allows. No protection guarantee is made.",
    );
  const addedPatterns = defaults.filter(
    (key) => !Object.hasOwn(read ?? {}, key),
  );
  if (!addedPatterns.length) return unchanged("unchanged");
  const next = `${JSON.stringify({ ...config, permission: { ...permission, path_read: { ...Object.fromEntries(addedPatterns.map((key) => [key, "deny"])), ...read } } }, null, 2)}\n`;
  // Enforce the same output bound/schema without retaining any skill transform.
  planSetup(next);
  return {
    next,
    changed: true,
    addedPatterns,
    retainedSurfaces,
    warnings,
    status: "added",
    runtimePolicy: "public-service-authoritative",
  };
};
