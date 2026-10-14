# Validation and release gates

Implemented checks:

- Rust arrival fixtures: baseline, new arrival at unchanged count, checkout, null arrival, regressions, restored visits, missing name, restart, stale recovery, disabled/nonpersonalized modes, malformed source, and thirty-second publication cadence.
- JavaScript badge fixtures: four corners, zero exit/release, count updates during a welcome, exact greeting/stale deadlines, reduced motion, sleep, grant loss, disposal, and malformed state.
- Compiled Wasm ABI: baseline publication, identical-poll suppression, real arrival, durable retry after publication before KV acknowledgement, failed fetch without renewal, bounded private Studio view, target picker, and configuration.
- Release gate rejects publication while no compatible coordinated release exists.
- Local build produces a self-contained Studio page, Player bundle, Wasm module, and standard OCI layout.
- Chromium browser checks exercise the actual opaque Studio bridge, preview, target selection and save; the SDK-assembled Player frame proves text safety, parent and native bridge isolation, zero release, and local deadlines under its deny-all response policy. These are browser checks, not native platform qualification.
- The built artifact passes 15 race-enabled steps through Tilecast's real verifier, installer, contribution catalog, compiled Wasm service, dispatcher, PostgreSQL KV/state services and realtime scheduler. Coverage includes the real target picker, baseline/arrival, failed fetch without renewal, screen/group/location/all targets, update/rollback epoch fencing and retained baselines, removal stopping jobs/surfaces, and same-digest reinstall with clean storage/configuration. The draft's real compatibility range refuses installation; execution uses an explicitly local test variant. CI pins the host qualification revision independently of the SDK revision.

Qualification status by Player family:

| Family  | Software qualification                                                                                    | Physical canary | Supported by this release |
| ------- | --------------------------------------------------------------------------------------------------------- | --------------- | ------------------------- |
| Edge    | Passed on the Tilecast revision recorded in `compatibility.json` (WPE surface test, plain and synchronized video, daemon scenario, Wasm/PostgreSQL package fixture) | Pending         | Yes, after the canary     |
| Windows | Not qualified                                                                                             | Not qualified   | No                        |
| Android | Not qualified                                                                                             | Not qualified   | No                        |

Edge software qualification was run in Linux containers with software rendering. The WPE end-to-end lane disables WebKit's process sandbox; a separate lane runs the same scenario with a renderer built without that opt-out. Neither proves physical display or DRM output, which is what the canary covers.

Implemented since the first draft:

- Studio browser checks for target paging (selection kept across pages, search restarts at page one, empty results), stale configuration revisions (the edit survives and the conflict is explained), required selection, light and dark color schemes, and reduced motion.
- Player frame checks under every theme and reduced-motion hint: the badge card is theme independent, motion follows the hint, and a zero count releases the surface at once under reduced motion.
- Compiled Wasm checks for stale revisions, malformed Studio requests refused before they reach the host, and the bounded target option calls.
- Rust boundary checks for every source limit (count, freshness window, cursor, name, byte size, unknown fields).
- Release gate tests for per-family qualification, Stable-only minimums, canary recording, and the public Tilecast release and host-revision containment checks.

Still required before publishing:

- Run the physical Edge canary on a school screen and record it in `compatibility.json`.
- Wait for a Stable coordinated Tilecast release that contains the qualified Edge enablement, then set the actual minimum and package range.
- Complete the public GitHub resolver, provenance, and custom-install path with the actual signed release. Tilecast's installer tests cover the resolver against fixtures; the real path first runs when this package is published.
- Publish with verified GitHub Actions provenance, ensure anonymous GHCR access, and test the custom GitHub installer. No public artifact has been published yet.
- Windows and Android qualification is not required for this release. Each needs its own real WebView qualification and a compatibility update before this package may claim it.

Tilecast support merged in gbyo/tilecast#1663, #1664, #1665, #1667, #1674, #1676, #1677, #1679 and #1680.
