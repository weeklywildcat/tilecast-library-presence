import test from "node:test";
import assert from "node:assert/strict";
import { createController, validateState } from "../player/badge.js";
const base = 1800000000000, iso = (ms) => new Date(ms).toISOString();
function harness() {
  let now = base, serial = 0, disposed = false;
  const jobs = new Map(), claims = [], paints = [];
  const controller = createController({ paint: (...args) => paints.push(args), dispose: () => { disposed = true; } }, {
    set(fn, delay) { const id = ++serial; jobs.set(id, { at: now + delay, fn }); return id; },
    clear(id) { jobs.delete(id); },
  });
  const bridge = { now: () => now, claim: (value) => claims.push(value) };
  const state = (count = 12, greeting = null, position = "bottom-left") => ({ count, greeting, position, validUntil: iso(base + 75000) });
  const hints = { awake: true, reducedMotion: false };
  return { controller, claims, paints, jobs, bridge, state, hints,
    update(value, context = hints) { controller.update(value, context, bridge); },
    advance(ms) { const end = now + ms; while (true) {
      const due = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break; now = due[1].at; jobs.delete(due[0]); due[1].fn();
    } now = end; }, get disposed() { return disposed; },
  };
}
test("all four corners claim the matching surface and zero exits before releasing", () => {
  const h = harness();
  for (const position of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    h.update(h.state(12, null, position)); assert.deepEqual(h.claims.at(-1), { slot: `corner.${position}`, priority: 0 });
  }
  h.controller.grant({ shown: true }); const before = h.claims.length;
  h.update(h.state(0)); assert.equal(h.paints.at(-1)[2], false); assert.equal(h.claims.length, before);
  h.advance(239); assert.equal(h.claims.length, before);
  h.advance(1); assert.equal(h.claims.at(-1), null);
});
test("greeting expires locally while the latest count continues underneath", () => {
  const h = harness(), greeting = { id: "a".repeat(64), firstName: "Gibson", expiresAt: iso(base + 7000) };
  h.update(h.state(12, greeting)); h.controller.grant({ shown: true });
  h.advance(4000); h.update(h.state(13, greeting)); assert.equal(h.paints.at(-1)[0].count, 13);
  h.advance(3000); assert.equal(h.paints.at(-1)[0].greeting, null); assert.equal(h.paints.at(-1)[0].count, 13);
  assert.equal(h.paints.at(-1)[2], true);
});
test("corrected clock governs validity and sleep, grant loss and reduced motion fail closed", () => {
  const h = harness(); h.update(h.state()); h.controller.grant({ shown: true });
  h.controller.grant({ shown: false }); assert.equal(h.paints.at(-1)[2], false);
  h.update(h.state(), { awake: false, reducedMotion: false }); assert.equal(h.claims.at(-1), null);
  assert.equal(h.jobs.size, 0);
  h.update(h.state()); h.controller.grant({ shown: true }); h.advance(75000);
  assert.equal(h.claims.at(-1), null); assert.equal(h.paints.at(-1)[2], false);
  const next = harness(); next.update(next.state()); next.controller.grant({ shown: true });
  next.update(next.state(0), { awake: true, reducedMotion: true }); assert.equal(next.claims.at(-1), null);
  next.controller.dispose(); assert.equal(next.jobs.size, 0); assert.equal(next.disposed, true);
  next.update(next.state()); assert.equal(next.jobs.size, 0);
});
test("malformed state is refused and names remain text rather than markup", () => {
  const h = harness();
  for (const value of [null, {}, h.state(-1), h.state(1.5), h.state(100001), h.state(12, null, "overlay"), { ...h.state(), validUntil: "invalid" }]) {
    assert.equal(validateState(value, base), null);
  }
  const greeting = { id: "a".repeat(64), firstName: "<img onerror=x>", expiresAt: iso(base + 7000) };
  assert.equal(validateState(h.state(12, greeting), base).greeting.firstName, "<img onerror=x>");
  assert.equal(validateState(h.state(12, { ...greeting, firstName: "a\u202eb" }), base), null);
});
