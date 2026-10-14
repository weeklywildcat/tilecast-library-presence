import { readFile } from "node:fs/promises";
import { requireReleasable, requireTilecastRelease } from "./compatibility.mjs";
const manifest = JSON.parse(await readFile(new URL("../tilecast.package.json", import.meta.url)));
const compatibility = JSON.parse(await readFile(new URL("../compatibility.json", import.meta.url)));
const problems = requireReleasable(compatibility, manifest, process.env);
if (problems.length === 0) {
  const minimum = compatibility.minimumTilecastVersion, headers = { Accept: "application/vnd.github+json" };
  const get = async (path) => { const response = await fetch(`https://api.github.com/repos/gbyo/tilecast/${path}`, { headers }); return response.status === 200 ? response.json() : null; };
  const release = await get(`releases/tags/v${minimum}`);
  const comparison = await get(`compare/${compatibility.hostQualificationRevision}...v${minimum}`);
  problems.push(...requireTilecastRelease(minimum, compatibility.hostQualificationRevision, release, comparison));
}
if (problems.length) { for (const problem of problems) console.error(`release gate: ${problem}`); process.exit(1); }
console.log("Coordinated Stable compatibility, Edge qualification, canary record and immutable package tag confirmed.");
