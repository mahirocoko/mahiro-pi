// Closed public bridge: no caller paths, policy services, or provenance objects.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { UIPreferences } from "./claude-ui-preferences.ts";
export interface UITicket {
  readonly version: 1;
}
export interface UIStoredPreferences {
  readonly preferences: UIPreferences;
  readonly ticket: UITicket;
}
export interface OwnUIOwner {
  readonly version: 1;
  readonly generation: object;
  read(ctx: ExtensionContext): UIStoredPreferences;
  save(
    ctx: ExtensionContext,
    ticket: UITicket,
    preferences: UIPreferences,
  ): UIStoredPreferences;
}
const guardKey = Symbol.for("@mahirocoko/pi-guards:healthy-nodes");
export function ownUIOwner(ctx: ExtensionContext): OwnUIOwner | undefined {
  const id = ctx.sessionManager?.getSessionId?.();
  if (!id) return undefined;
  const node = (globalThis as any)[guardKey]?.get(id);
  const owner = node?.ownUI;
  return node?.healthy?.() === true &&
    owner?.version === 1 &&
    owner.generation === node.generation &&
    typeof owner.read === "function" &&
    typeof owner.save === "function"
    ? owner
    : undefined;
}
