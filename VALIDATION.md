# Validation and release gates

Implemented checks:

- Rust arrival fixtures: baseline, new arrival at unchanged count, checkout, null arrival, regressions, restored visits, missing name, restart, stale recovery, disabled/nonpersonalized modes, malformed source, and thirty-second publication cadence.
- JavaScript badge fixtures: four corners, zero exit/release, count updates during a welcome, exact greeting/stale deadlines, reduced motion, sleep, grant loss, disposal, and malformed state.
- Compiled Wasm ABI: baseline publication, identical-poll suppression, real arrival, durable retry after publication before KV acknowledgement, failed fetch without renewal, bounded private Studio view, target picker, and configuration.
- Release gate rejects publication while no compatible coordinated release exists.
- Local build produces a self-contained Studio page, Player bundle, Wasm module, and standard OCI layout.
- Chromium browser checks exercise the actual opaque Studio bridge, preview, target selection and save; the SDK-assembled Player frame proves text safety, parent and native bridge isolation, zero release, and local deadlines under its deny-all response policy. These are browser checks, not native platform qualification.

Still required before claiming the complete feature or publishing:

- Validate the built artifact with Tilecast's real verifier, catalog, dispatcher, and PostgreSQL state service. Exercise install, targeting, update, rollback, removal, and reinstall through the real host.
- Broaden Studio browser coverage for target pagination, stale configuration conflicts, and theme/motion hints.
- Exercise the external surface MessageChannel ABI in Edge/WPE, Windows/WebView2, and Android. Verify sandbox policy, bridge isolation, navigation refusal, arbitration, sleep/wake, and local deadlines.
- Capture frame add/replacement/removal during ordinary and synchronized video without a new presentation activation, timeline reset, or media grant changes.
- Verify corrupt/missing frame preparation preserves the last playable manifest and cleanup removes removed package surfaces.
- Complete physical platform validation, including Fire TV and Google TV. Headless tests and compilation cannot replace it.
- Assign the first compatible coordinated Tilecast release, set the actual minimum, and enable generic Player capability reporting after qualification.
- Publish with verified GitHub Actions provenance, ensure anonymous GHCR access, and test the custom GitHub installer. No public artifact has been published yet.

Tilecast draft support PRs: [server runtime](https://github.com/gbyo/tilecast/pull/1663), [shared Runtime](https://github.com/gbyo/tilecast/pull/1664), [native frame authority and Windows](https://github.com/gbyo/tilecast/pull/1665), [Edge](https://github.com/gbyo/tilecast/pull/1667), and [Android](https://github.com/gbyo/tilecast/pull/1674). The plugin-only refresh and realtime scheduler foundations were merged separately by the repository maintainer.
