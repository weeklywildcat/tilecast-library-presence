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
        if (input.expectedConfigurationRevision !== shared.view.configurationRevision) return -2;
        shared.view = { ...shared.view, ...input, configurationRevision: shared.view.configurationRevision + 1, state: null, validUntil: null }; data = shared.view;
      } else if (operation === "targets.resolve@2/options") {
        data = { items: [{ id: "screen", name: "Library", kind: "screen" }], total: 1, page: 1, pageSize: 50, canSelectAll: true };
      } else return -7;
      return write(out, cap, JSON.stringify({ ok: true, data }));
    },
  } }); instance = result.instance;
  return { shared,
    run() { write(32768, 16384, "presence"); return instance.exports.run_job(32768, 8); },
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
