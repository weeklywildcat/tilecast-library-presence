# Library Presence

Library Presence is a third-party Tilecast extension for Weekly Wildcat's library. It shows occupancy in a corner badge and briefly welcomes new arrivals. The integration lives in this repository, outside Tilecast's bundled plugins.

**Status: Edge-first, no published installable release.** Library Presence needs the generic `plugin.external-runtime@1` Player capability. Tilecast Edge (WPE) is the only Player family this release targets, and it reports that capability from the first coordinated Tilecast release that contains Edge enablement. Tilecast Player for Windows and Android contain the generic frame code but do not report the capability yet, so they receive no Library Presence surface. This package does not claim support for them. The draft manifest keeps an empty compatibility range (`>=0.0.0 <0.0.0`) so it cannot claim support for an existing release. Publishing fails until `compatibility.json` records a Stable coordinated Tilecast minimum, Edge software qualification, and the passed physical Edge canary.

The original specification is preserved in [PLAN.md](PLAN.md).

## Behavior

The server polls the fixed public presence endpoint every five seconds. The Player receives only occupancy, corner position, validity, and an optional opaque greeting ID, first name, and greeting deadline. It receives no roster, cursor, source URL, or diagnostics.

The first successful poll establishes a baseline. A welcome requires both a changed cursor and a timestamp later than every check-in previously observed. Checkout, archive regressions, and restored old visits never welcome. Disabled and nonpersonalized modes continue consuming arrival baselines. Durable publication intents keep the same event ID and deadline through retries and restarts. Stale recovery restores count without replaying arrivals.

Identical successful polls do not publish new state. Visible changes publish immediately; freshness renews about every thirty seconds with seventy-five-second validity. Failed or stale data cannot renew validity. The host and badge hide expired state locally.

The badge uses one static DOM shell, four corners, short CSS transitions, and corrected Tilecast clock deadlines. Zero occupancy animates away and releases its surface. It honors reduced motion. It performs no Player-side HTTP, canvas rendering, video, WebGL, blur, or animation loop.

Studio contains enabled state, personalized greetings, corner, and target selection. It shows real connection status, occupancy, last successful refresh, and a local 16:9 Count/Welcome preview. Its self-contained page invokes package Wasm through the Studio bridge and imports no Tilecast React code.

## Build and test

Use Node.js 26, Python 3, and the pinned Rust toolchain. The guest SDK is pinned to an immutable Tilecast commit in `guest/Cargo.toml` and `compatibility.json`.

```sh
npm ci
cargo fmt --manifest-path guest/Cargo.toml --check
cargo clippy --manifest-path guest/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path guest/Cargo.toml --locked
cargo build --manifest-path guest/Cargo.toml --release --locked --target wasm32-unknown-unknown
npm run build
npm test
python3 scripts/oci.py
```

`build/` contains package files, a standard OCI image layout, and its immutable digest. Tests cover arrival detection, freshness, durable retry, local deadlines, claims, and actual compiled Wasm calls through the host ABI. The Chromium checks cover the Studio bridge and the assembled Player frame (including paging, stale-revision conflicts, color scheme, and reduced motion). These checks do not qualify native browser isolation or production installation.

For the browser contract checks, install Chromium with `npx playwright install chromium` and set `TILECAST_SDK_ROOT` to a checkout of the exact SDK revision from `compatibility.json` when running `npm test`. CI checks out that immutable revision. Screenshots go to ignored `test-artifacts/`.

CI also checks out `hostQualificationRevision` and runs `tests/tilecast-scenario.json` through Tilecast's real Wasm host and PostgreSQL services. Locally, set `TILECAST_EXTERNAL_PACKAGE_FIXTURE` to this repository's `build/oci`, `TILECAST_EXTERNAL_PACKAGE_SCENARIO` to that scenario, and `TEST_DATABASE_URL` to an isolated test PostgreSQL instance, then run `go test -race ./internal/extensions/wasm -run TestExternalPackageFixture -v` and `go test -race ./internal/extensions/pipeline -run TestPublicInstallPathAcceptsExternalPackageFixture -v` from the pinned host's `apps/server`. The second test runs this package through Tilecast's public custom-repository resolver, release-tag cross-check, OCI client, provenance check, compatibility gate, install review, and install against local fakes for GitHub and the registry (only Sigstore bundle verification is replaced). The database role must be able to create temporary databases. This deliberately uses a local compatibility variant and does not claim that the unreleased package installs on an existing Tilecast release.

## Installation after a compatible release

Give Tilecast's custom GitHub installer this public repository URL:

`https://github.com/weeklywildcat/tilecast-library-presence`

Review the fixed network host, storage, five-second realtime activity, Studio interface, target service, runtime state service, four corner surfaces, and ambient tier. Configure targets and enable the integration. Players must report `plugin.external-runtime@1`; today that is Tilecast Edge. Older hosts fail compatibility checks, and Windows and Android Players receive no executable plugin surface until they are qualified.

## Release preparation

Qualification is recorded per Player family in `compatibility.json`. Software qualification (automated host tests that ran this package on a named Tilecast revision) and the physical production canary are separate records. A family that is not in `supportedPlayerFamilies` must stay `not-qualified`. Today only `edge` is supported.

1. Run the physical Edge canary on one real screen with a Tilecast build that contains Edge enablement. Record `qualification.edge.physicalCanary` as `passed` with `recordedBy` and `recordedAt`. The canary is never marked complete by tooling.
2. After a Stable coordinated Tilecast release contains the qualified host revision, set `minimumTilecastVersion` to that release and set the package range in `tilecast.package.json` to start there. A Tilecast Beta of the same core version (for example `0.27.0-beta.4` for a `>=0.27.0` range) satisfies the range on the installing Server, but the installer only resolves a published, non-prerelease Library Presence release, and the release gate below requires the Tilecast release it names to be Stable.
3. Confirm source version, `v<version>` tag, and package version agree. Keep tags immutable.
4. Publish the reviewed tag. The release gate (`scripts/release-gate.mjs`) refuses unless the Tilecast release is public and Stable, the release contains `hostQualificationRevision`, Edge is the only supported family, and the canary is recorded. The workflow then builds the package, refuses an existing registry tag, checks the pushed digest, creates GitHub/Sigstore provenance, and creates the public GitHub release.
5. Ensure the GHCR package is public and verify anonymous pulling and custom repository installation. Package visibility may require owner setup on the first publication.

Distribution uses `ghcr.io/weeklywildcat/tilecast-library-presence`. Marketplace listing is optional. No release, registry upload, or compatible minimum has been invented or published during implementation. `npm run build` followed by `python3 scripts/oci.py` produces a local test layout in `build/oci` that is not a release; the public installer cannot install it.

See [VALIDATION.md](VALIDATION.md) for remaining qualification work. Source is licensed AGPL-3.0-only.
