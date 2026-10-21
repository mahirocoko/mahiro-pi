import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Unit-level state-machine checks execute the actual production closure/prefix,
// not a copied implementation. This is not SDK dispatch or native assurance;
// worker-activity-sdk-test.mjs owns the genuine Root-first positive regression.
const source = readFileSync(
  new URL("../lib/guards/index.ts", import.meta.url),
  "utf8",
);
const getterStart = source.indexOf("  const getParentService = () => {");
const getterEnd = source.indexOf("  // Public policy remains", getterStart);
const startAt = source.indexOf(
  "      const id = ctx.sessionManager.getSessionId();",
);
const startEnd = source.indexOf("      if (!registered) return;", startAt);
assert.ok(
  getterStart >= 0 &&
    getterEnd > getterStart &&
    startAt >= 0 &&
    startEnd > startAt,
);
const getter = source.slice(getterStart, getterEnd);
const start = source.slice(startAt, startEnd);
const harness = () => {
  const services = new Map<object, object>();
  const owner = { getSessionId: () => "unit-session" };
  // Substitute the metadata lookup and abort callback. These unit checks prove
  // invalidation/latching decisions, not cancellation of native queued work.
  const state = new Function(
    "getSubagentsServiceForSession",
    `
    let sessionId, sessionManager, parentService, latched = false, aborts = 0;
    const abortOwned = () => { latched = true; aborts++; };
    ${getter}
    const start = ctx => { ${start} };
    return { start, get: getParentService, aborts: () => aborts, latched: () => latched };
  `,
  )((manager: object) => services.get(manager));
  return { services, owner, state };
};

test("guard owner: absent initial peer can bind late without adopting another manager", () => {
  const { services, owner, state } = harness();
  state.start({ sessionManager: owner });
  assert.equal(state.get(), undefined);
  assert.equal(state.latched(), false);
  services.set({ getSessionId: () => "unit-session" }, { foreign: true });
  assert.equal(
    state.get(),
    undefined,
    "session-id equality is not manager identity",
  );
  const service = {};
  services.set(owner, service);
  assert.equal(state.get(), service);
  state.start({ sessionManager: owner });
  assert.equal(
    state.get(),
    service,
    "same-owner repeated start retains the pin",
  );
  assert.equal(state.aborts(), 0);
});

test("guard owner: acquired service revocation is terminal, even when restored", () => {
  const { services, owner, state } = harness();
  const service = {};
  services.set(owner, service);
  state.start({ sessionManager: owner });
  assert.equal(state.get(), service);
  services.delete(owner);
  assert.equal(state.get(), undefined);
  assert.equal(state.latched(), true);
  services.set(owner, service);
  assert.equal(
    state.get(),
    undefined,
    "restoration cannot rearm a latched generation",
  );
  assert.equal(state.aborts(), 1);
});

test("guard owner: repeated start cannot repin a replacement service", () => {
  const { services, owner, state } = harness();
  services.set(owner, {});
  state.start({ sessionManager: owner });
  services.set(owner, {});
  state.start({ sessionManager: owner });
  assert.equal(state.get(), undefined);
  assert.equal(state.latched(), true);
  assert.equal(state.aborts(), 1);
});

test("guard owner: same-ID different manager repeated start rejects and invalidates", () => {
  const { services, owner, state } = harness();
  services.set(owner, {});
  state.start({ sessionManager: owner });
  const other = { getSessionId: () => "unit-session" };
  services.set(other, {});
  assert.throws(
    () => state.start({ sessionManager: other }),
    /ownership changed/,
  );
  assert.equal(state.get(), undefined);
  assert.equal(state.aborts(), 1);
});
