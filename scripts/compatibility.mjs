// Compatibility metadata rules shared by CI and the release gate.
//
// Qualification is recorded per Player family. Software qualification (the
// native host's automated tests against this package) and the physical
// production canary are separate facts; neither implies the other, and a
// family that is not listed as supported must not claim either.
const SHA = /^[a-f0-9]{40}$/;
const FAMILIES = ["edge", "windows", "android"];
const STABLE = /^\d+\.\d+\.\d+$/;
export const REQUIRED_CAPABILITY = "plugin.external-runtime@1";

export function validateShape(compatibility, manifest) {
  const problems = [];
  const add = (message) => problems.push(message);
  if (compatibility.minimumTilecastVersion !== null && !STABLE.test(compatibility.minimumTilecastVersion ?? "")) {
    add("minimumTilecastVersion must be null or the stable x.y.z release the gate checks for.");
  }
  if (!SHA.test(compatibility.sdkRevision ?? "")) add("sdkRevision must be a full commit SHA.");
  if (!SHA.test(compatibility.hostQualificationRevision ?? "")) add("hostQualificationRevision must be a full commit SHA.");
  if (compatibility.requiredPlayerCapability !== REQUIRED_CAPABILITY) add(`requiredPlayerCapability must be ${REQUIRED_CAPABILITY}.`);
  if ("nativeQualificationComplete" in compatibility) add("nativeQualificationComplete is ambiguous; record per-family qualification instead.");
  const supported = compatibility.supportedPlayerFamilies;
  if (!Array.isArray(supported) || supported.some((family) => !FAMILIES.includes(family)) || new Set(supported).size !== supported.length) {
    add("supportedPlayerFamilies must list distinct known Player families.");
  }
  const qualification = compatibility.qualification ?? {};
  for (const family of FAMILIES) {
    const record = qualification[family];
    if (!record || typeof record.software?.status !== "string" || typeof record.physicalCanary?.status !== "string") {
      add(`qualification.${family} needs software and physicalCanary records.`);
      continue;
    }
    if (Array.isArray(supported) && supported.includes(family)) {
      if (record.software.status !== "passed") add(`${family} is supported but its software qualification is not passed.`);
      if (!SHA.test(record.software.tilecastRevision ?? "")) add(`${family} software qualification must name the Tilecast revision it ran on.`);
      if (!Array.isArray(record.software.evidence) || record.software.evidence.length === 0 || record.software.evidence.some((item) => typeof item !== "string" || !item)) {
        add(`${family} software qualification needs concrete evidence.`);
      }
      if (!["pending", "passed"].includes(record.physicalCanary.status)) add(`${family} physical canary must be pending or passed.`);
      if (record.physicalCanary.status === "passed" && !(Number.isFinite(Date.parse(record.physicalCanary.recordedAt)) && record.physicalCanary.recordedBy)) {
        add(`${family} physical canary needs who recorded it and when.`);
      }
    } else {
      if (record.software.status !== "not-qualified" || record.physicalCanary.status !== "not-qualified") {
        add(`${family} is not supported and must not claim qualification.`);
      }
    }
  }
  if (manifest && !/^>=\d+\.\d+\.\d+ /.test(manifest.tilecast.version) && manifest.tilecast.version !== ">=0.0.0 <0.0.0") {
    add("The package range must start at a stable minimum or stay empty.");
  }
  return problems;
}

export function requireReleasable(compatibility, manifest, environment) {
  const problems = validateShape(compatibility, manifest);
  const minimum = compatibility.minimumTilecastVersion;
  if (typeof minimum !== "string") problems.push("A verified compatible Stable Tilecast release is required before publishing.");
  else if (!manifest.tilecast.version.startsWith(`>=${minimum} `)) problems.push("The package range must start at the verified compatible release.");
  if (JSON.stringify(compatibility.supportedPlayerFamilies) !== JSON.stringify(["edge"])) {
    problems.push("This release supports Edge only; Windows and Android need their own qualification first.");
  }
  const canary = compatibility.qualification?.edge?.physicalCanary;
  if (canary?.status !== "passed") problems.push("Record the passed physical Edge canary before publishing.");
  if (environment.GITHUB_REF_NAME !== `v${manifest.packageVersion}`) problems.push("Release tag and package version must agree.");
  if (environment.GITHUB_REPOSITORY !== "weeklywildcat/tilecast-library-presence") problems.push("Releases come only from the Library Presence repository.");
  return problems;
}

/** The public Tilecast release must be Stable, published, and contain the qualified host revision. */
export function requireTilecastRelease(minimum, hostRevision, release, comparison) {
  const problems = [];
  if (!release || release.draft !== false || release.prerelease !== false) problems.push("The coordinated Tilecast release must be a published Stable release.");
  if (release?.tag_name !== `v${minimum}`) problems.push("The release tag does not match the recorded minimum.");
  if (!comparison || !["identical", "ahead"].includes(comparison.status)) {
    problems.push("The Tilecast release must contain the host revision this package was qualified on.");
  }
  void hostRevision;
  return problems;
}
