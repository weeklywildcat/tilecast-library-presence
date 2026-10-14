import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const code = await readFile(new URL("../build/runtime/library_presence.wasm", import.meta.url));
const base = 1800000000000, iso = (ms) => new Date(ms).toISOString();
const contributionId = "weeklywildcat.library-presence.library_presence";
async function host(shared = {}) {
  shared.now ??= base; shared.kv ??= new Map(); shared.publications ??= [];
  shared.view ??= { contributionId, enabled: true, configuration: { position: "bottom-left", personalizedGreetings: true },
    targets: { mode: "all", screenIds: [], groupIds: [], locationIds: [] }, configurationRevision: 1,
    state: null, validUntil: null, publishedAt: null };
  shared.source ??= { schemaVersion: 1, currentCount: 12, generatedAt: iso(base), latestCheckIn: { cursor: "100", at: iso(base - 1000), firstName: "Gibson" } };
  let instance;
  const bytes = (ptr, len) => new Uint8Array(instance.exports.memory.buffer, ptr, len);
  const text = (ptr, len) => new TextDecoder().decode(bytes(ptr, len));
  const write = (ptr, cap, value) => { const raw = typeof value === "string" ? new TextEncoder().encode(value) : value;
    if (raw.length > cap) return -3; bytes(ptr, raw.length).set(raw); return raw.length; };
  const result = await WebAssembly.instantiate(code, { tilecast: {
    now_ms: () => BigInt(shared.now),
    kv_get: (ptr, len, out, cap) => { const value = shared.kv.get(text(ptr, len)); return value ? write(out, cap, value) : -2; },
    kv_set: (ptr, len, value, size) => {
      if (shared.failSaveAfterPublish && shared.publications.length > 0) { shared.failSaveAfterPublish = false; return -4; }
      shared.kv.set(text(ptr, len), new Uint8Array(bytes(value, size))); return 0;
    },
    http_fetch: (ptr, len, out, cap) => {
      assert.equal(text(ptr, len), "https://signage.weeklywildcat.com/library/presence.json");
      assert.equal(cap, 8192); if (shared.failFetch) return -4;
      return write(out, cap, JSON.stringify(shared.source));
    },
    call_v1: (op, olen, ptr, len, out, cap) => {
      const operation = text(op, olen), input = JSON.parse(text(ptr, len)); let data;
      if (operation === "plugin-runtime.state@1/get") { assert.equal(input.contributionId, contributionId); data = shared.view; }
      else if (operation === "plugin-runtime.state@1/publish") {
        assert.equal(input.contributionId, contributionId);
        assert.equal(input.configurationRevision, shared.view.configurationRevision);
        if (shared.failPublish) return -2;
        shared.publications.push(input); shared.view.state = input.state; shared.view.validUntil = input.validUntil; data = shared.view;
      } else if (operation === "plugin-runtime.state@1/configure") {
        (shared.configureCalls ??= []).push(input);
        if (input.expectedConfigurationRevision !== shared.view.configurationRevision) return -2;
        shared.view = { ...shared.view, ...input, configurationRevision: shared.view.configurationRevision + 1, state: null, validUntil: null }; data = shared.view;
      } else if (operation === "targets.resolve@2/options") {
        (shared.optionsCalls ??= []).push(input);
        data = shared.optionsData?.(input) ?? { items: [{ id: "screen", name: "Library", kind: "screen" }], total: 1, page: 1, pageSize: 50, canSelectAll: true };
      } else return -7;
      return write(out, cap, JSON.stringify({ ok: true, data }));
    },
  } }); instance = result.instance;
  return { shared,
    run() { write(32768, 16384, "presence"); return instance.exports.run_job(32768, 8); },
    raw(value) { const length = write(32768, 16384, JSON.stringify(value));
      const status = instance.exports.handle_ui_request(32768, length, 16384, 16384);
      return status > 0 ? JSON.parse(text(16384, status)) : status; },
    ui(value) { const length = write(32768, 16384, JSON.stringify(value));
      const status = instance.exports.handle_ui_request(32768, length, 16384, 16384);
      assert.ok(status > 0, `UI failed with ${status}`); return JSON.parse(text(16384, status)); },
  };
}
test("compiled Wasm publishes a baseline, ignores identical polls and greets a real arrival", async () => {
  const h = await host(); assert.equal(h.run(), 0); assert.equal(h.shared.publications[0].state.greeting, null);
  h.shared.now += 5000; h.shared.source.generatedAt = iso(h.shared.now);
  assert.equal(h.run(), 0); assert.equal(h.shared.publications.length, 1);
  h.shared.now += 5000; h.shared.source.generatedAt = iso(h.shared.now);
  h.shared.source.latestCheckIn = { cursor: "101", at: iso(h.shared.now - 1000), firstName: "Gibson" };
  assert.equal(h.run(), 0); const publication = h.shared.publications.at(-1);
  assert.equal(publication.state.greeting.firstName, "Gibson"); assert.equal(publication.validUntil, publication.state.validUntil);
  assert.deepEqual(Object.keys(publication.state).sort(), ["count", "greeting", "position", "validUntil"]);
});
test("restart after publication but before bookkeeping acknowledgement retries the original intent", async () => {
  const h = await host(); h.run(); h.shared.publications = []; h.shared.now += 5000;
  h.shared.source.generatedAt = iso(h.shared.now); h.shared.source.latestCheckIn = { cursor: "101", at: iso(h.shared.now - 1000), firstName: null };
  h.shared.failSaveAfterPublish = true; assert.equal(h.run(), -1);
  const first = structuredClone(h.shared.publications[0]); h.shared.now += 1000; h.shared.source.generatedAt = iso(h.shared.now);
  const restarted = await host(h.shared); assert.equal(restarted.run(), 0);
  assert.deepEqual(h.shared.publications[1], first);
});
test("invalid fetch preserves display without renewing and UI exposes only the bounded view", async () => {
  const h = await host(); h.run(); const deadline = h.shared.view.validUntil;
  h.shared.failFetch = true; h.shared.now += 5000; assert.equal(h.run(), -1);
  assert.equal(h.shared.view.validUntil, deadline); assert.equal(h.shared.publications.length, 1);
  const answer = h.ui({ action: "get" }); assert.equal(answer.data.connection, "reconnecting");
  for (const privateName of ["observedCursor", "maximumCheckInAtMs", "pending", "sourceUrl"]) assert.equal(privateName in answer.data, false);
  assert.equal(h.ui({ action: "options", kind: "screen", page: 1, query: null }).data.items[0].name, "Library");
  const config = h.ui({ action: "save", enabled: false, configuration: { position: "top-right", personalizedGreetings: false },
    targets: { mode: "all", screenIds: [], groupIds: [], locationIds: [] }, revision: 1 });
  assert.equal(config.ok, true); assert.equal(config.data.enabled, false); assert.equal(config.data.revision, 2);
});

const targets = { mode: "all", screenIds: [], groupIds: [], locationIds: [] };
const settings = { enabled: true, configuration: { position: "top-left", personalizedGreetings: true }, targets };
test("a stale configuration revision is refused and leaves the saved settings alone", async () => {
  const h = await host();
  const first = h.ui({ action: "save", ...settings, revision: 1 });
  assert.equal(first.ok, true); assert.equal(first.data.revision, 2);
  // A second Studio tab still holds revision 1.
  const stale = h.ui({ action: "save", ...settings, configuration: { position: "bottom-right", personalizedGreetings: false }, revision: 1 });
  assert.equal(stale.ok, false); assert.equal(typeof stale.message, "string");
  assert.equal(stale.message.includes("revision"), false, "the answer is a user-facing sentence, not host detail");
  const current = h.ui({ action: "get" });
  assert.equal(current.data.revision, 2); assert.equal(current.data.configuration.position, "top-left");
  // Saving a configuration clears published state, so the next poll must not publish under the old revision.
  assert.equal(h.shared.view.state, null);
  h.run();
  assert.equal(h.shared.publications.at(-1).configurationRevision, 2);
});
test("malformed Studio requests are refused before they reach the host", async () => {
  const h = await host();
  const invalid = [
    { action: "unknown" },
    { action: "save", ...settings, revision: "1" }, { action: "save", ...settings, revision: 1.5 },
    { action: "save", ...settings, enabled: "yes", revision: 1 },
    { action: "save", ...settings, configuration: { position: "center", personalizedGreetings: true }, revision: 1 },
    { action: "save", ...settings, configuration: { position: "top-left", personalizedGreetings: "yes" }, revision: 1 },
    { action: "save", ...settings, configuration: { position: "top-left", personalizedGreetings: true, color: "red" }, revision: 1 },
    { action: "save", ...settings, configuration: {}, revision: 1 },
    { action: "save", enabled: true, configuration: settings.configuration, revision: 1 },
    { action: "save", ...settings, targets: { mode: "all", screenIds: [], groupIds: [], locationIds: [], extra: 1 }, revision: 1 },
    { action: "options", kind: "display", page: 1, query: null },
    { action: "options", kind: "screen", page: 0, query: null },
    { action: "options", kind: "screen", page: 1001, query: null },
    { action: "options", kind: "screen", page: 1.5, query: null },
    { action: "options", kind: "screen", page: 1, query: "x".repeat(101) },
  ];
  for (const request of invalid) {
    const answer = h.raw(request);
    assert.ok(answer < 0 || answer.ok === false, `accepted ${JSON.stringify(request).slice(0, 80)}`);
  }
  assert.equal(h.shared.configureCalls ?? undefined, undefined, "no invalid save reached the state service");
  assert.equal(h.shared.optionsCalls ?? undefined, undefined, "no invalid lookup reached the target service");
});
test("target option pages and search stay within the bounded host contract", async () => {
  const h = await host();
  h.shared.optionsData = (input) => ({ items: [{ id: `screen-${input.page}`, name: `Screen ${input.page}`, kind: "screen" }],
    total: 120, page: input.page, pageSize: 50, canSelectAll: false });
  const last = h.ui({ action: "options", kind: "screen", page: 3, query: "reading room" });
  assert.equal(last.data.items[0].id, "screen-3"); assert.equal(last.data.canSelectAll, false);
  const forwarded = h.shared.optionsCalls.at(-1);
  assert.equal(forwarded.page, 3); assert.equal(forwarded.pageSize, 50); assert.equal(forwarded.search, "reading room");
  assert.equal(forwarded.kind, "screen");
  assert.equal(h.raw({ action: "options", kind: "group", page: 1000, query: "x".repeat(100) }).ok, true);
});
test("saving accepts every selected-target kind within the service bounds", async () => {
  const h = await host();
  const selected = { mode: "selected", screenIds: ["a"], groupIds: ["b"], locationIds: ["c"] };
  const saved = h.ui({ action: "save", ...settings, targets: selected, revision: 1 });
  assert.deepEqual(saved.data.targets, selected);
  assert.deepEqual(h.shared.configureCalls.at(-1).targets, selected);
  assert.equal(h.shared.configureCalls.at(-1).expectedConfigurationRevision, 1);
});
