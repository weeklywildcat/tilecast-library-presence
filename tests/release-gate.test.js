import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { requireReleasable, requireTilecastRelease, validateShape } from "../scripts/compatibility.mjs";

const read = async (name) => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url)));
const manifest = await read("tilecast.package.json"), shipped = await read("compatibility.json");
const sha = "a".repeat(40), environment = { GITHUB_REF_NAME: "v0.1.0", GITHUB_REPOSITORY: "weeklywildcat/tilecast-library-presence" };
const releasable = () => {
  const compatibility = structuredClone(shipped);
  compatibility.minimumTilecastVersion = "0.27.0"; compatibility.qualification.edge.physicalCanary = { status: "passed", recordedAt: "2026-10-20T12:00:00Z", recordedBy: "operator" };
  const range = structuredClone(manifest); range.tilecast.version = ">=0.27.0 <0.28.0";
  return { compatibility, range };
};

test("the committed metadata is well formed, Edge-only, and not yet releasable", () => {
  assert.deepEqual(validateShape(shipped, manifest), []);
  assert.deepEqual(shipped.supportedPlayerFamilies, ["edge"]);
  assert.equal(shipped.qualification.windows.software.status, "not-qualified");
  assert.equal(shipped.qualification.android.software.status, "not-qualified");
  assert.equal(shipped.qualification.edge.physicalCanary.status, "pending", "the canary is recorded by the operator, never assumed");
  const problems = requireReleasable(shipped, manifest, environment);
  assert.ok(problems.some((problem) => problem.includes("Stable Tilecast release")));
  assert.ok(problems.some((problem) => problem.includes("physical Edge canary")));
});
test("a complete Edge-only record with a Stable minimum passes the local gate", () => {
  const { compatibility, range } = releasable();
  assert.deepEqual(requireReleasable(compatibility, range, environment), []);
});
test("claiming Windows or Android without qualification is refused", () => {
  for (const family of ["windows", "android"]) {
    const { compatibility, range } = releasable();
    compatibility.supportedPlayerFamilies.push(family);
    assert.ok(requireReleasable(compatibility, range, environment).length > 0, family);
    const sneaky = releasable(); sneaky.compatibility.qualification[family].software = { status: "passed", tilecastRevision: sha, evidence: ["claimed"] };
    assert.ok(validateShape(sneaky.compatibility, sneaky.range).some((problem) => problem.includes("not supported")), family);
  }
});
test("software qualification needs a revision and concrete evidence, and the old ambiguous flag is refused", () => {
  const { compatibility, range } = releasable();
  compatibility.qualification.edge.software.evidence = [];
  assert.ok(validateShape(compatibility, range).some((problem) => problem.includes("concrete evidence")));
  const flagged = releasable(); flagged.compatibility.nativeQualificationComplete = true;
  assert.ok(validateShape(flagged.compatibility, flagged.range).some((problem) => problem.includes("ambiguous")));
  const unpinned = releasable(); unpinned.compatibility.qualification.edge.software.tilecastRevision = "main";
  assert.ok(validateShape(unpinned.compatibility, unpinned.range).length > 0);
});
test("a prerelease minimum, a pending canary, and mismatched tags or repositories are refused", () => {
  const prerelease = releasable(); prerelease.compatibility.minimumTilecastVersion = "0.27.0-beta.4";
  assert.ok(validateShape(prerelease.compatibility, prerelease.range).some((problem) => problem.includes("stable x.y.z")));
  const pending = releasable(); pending.compatibility.qualification.edge.physicalCanary = { status: "pending" };
  assert.ok(requireReleasable(pending.compatibility, pending.range, environment).some((problem) => problem.includes("canary")));
  const { compatibility, range } = releasable();
  assert.ok(requireReleasable(compatibility, range, { ...environment, GITHUB_REF_NAME: "v0.1.1" }).some((problem) => problem.includes("tag")));
  assert.ok(requireReleasable(compatibility, range, { ...environment, GITHUB_REPOSITORY: "someone/else" }).length > 0);
  const range2 = structuredClone(range); range2.tilecast.version = ">=0.26.0 <0.28.0";
  assert.ok(requireReleasable(compatibility, range2, environment).some((problem) => problem.includes("range")));
});
test("the public Tilecast release must be Stable, published, and contain the qualified host revision", () => {
  const good = { draft: false, prerelease: false, tag_name: "v0.27.0" };
  assert.deepEqual(requireTilecastRelease("0.27.0", sha, good, { status: "ahead" }), []);
  assert.deepEqual(requireTilecastRelease("0.27.0", sha, good, { status: "identical" }), []);
  assert.ok(requireTilecastRelease("0.27.0", sha, { ...good, prerelease: true }, { status: "ahead" }).length > 0);
  assert.ok(requireTilecastRelease("0.27.0", sha, { ...good, draft: true }, { status: "ahead" }).length > 0);
  assert.ok(requireTilecastRelease("0.27.0", sha, good, { status: "diverged" }).length > 0);
  assert.ok(requireTilecastRelease("0.27.0", sha, good, { status: "behind" }).length > 0);
  assert.ok(requireTilecastRelease("0.27.0", sha, good, null).length > 0);
  assert.ok(requireTilecastRelease("0.27.0", sha, null, { status: "ahead" }).length > 0);
  assert.ok(requireTilecastRelease("0.27.0", sha, { ...good, tag_name: "v0.27.1" }, { status: "ahead" }).length > 0);
});
