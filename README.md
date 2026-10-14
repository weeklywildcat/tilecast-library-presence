# Library Presence

Library Presence is a third-party Tilecast extension for Weekly Wildcat's library. It shows occupancy in a corner badge and briefly welcomes new arrivals. The integration lives in this repository, outside Tilecast's bundled plugins.

**Status: implementation in progress, no published installable release.** Generic hosting support is under review in Tilecast. Native external-frame qualification and a coordinated compatible release remain required. The draft manifest uses an empty compatibility range (`>=0.0.0 <0.0.0`) so it cannot claim support for an existing release. Publishing fails until `compatibility.json` identifies the actual stable release and records completed native qualification.

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

`build/` contains package files, a standard OCI image layout, and its immutable digest. Tests cover arrival detection, freshness, durable retry, local deadlines, claims, and actual compiled Wasm calls through the host ABI. These checks do not qualify native browser isolation or production installation.

For the browser contract checks, install Chromium with `npx playwright install chromium` and set `TILECAST_SDK_ROOT` to a checkout of the exact SDK revision from `compatibility.json` when running `npm test`. CI checks out that immutable revision. Screenshots go to ignored `test-artifacts/`.

CI also checks out `hostQualificationRevision` and runs `tests/tilecast-scenario.json` through Tilecast's real Wasm host and PostgreSQL services. Locally, set `TILECAST_EXTERNAL_PACKAGE_FIXTURE` to this repository's `build/oci`, `TILECAST_EXTERNAL_PACKAGE_SCENARIO` to that scenario, and `TEST_DATABASE_URL` to an isolated test PostgreSQL instance, then run `go test -race ./internal/extensions/wasm -run TestExternalPackageFixture -v` from the pinned host's `apps/server`. The database role must be able to create temporary databases. This deliberately uses a local compatibility variant and does not claim that the unreleased package installs on an existing Tilecast release.

## Installation after a compatible release

Give Tilecast's custom GitHub installer this public repository URL:

`https://github.com/weeklywildcat/tilecast-library-presence`

Review the fixed network host, storage, five-second realtime activity, Studio interface, target service, runtime state service, four corner surfaces, and ambient tier. Configure targets and enable the integration. Players must report `plugin.external-runtime@1`. Older hosts fail compatibility checks and unsupported Players receive no executable plugin surface.

## Release preparation

1. Complete native qualification and identify the first coordinated stable Tilecast release containing all required APIs.
2. Replace the empty compatibility range with the actual minimum and appropriate upper bound. Record that minimum and `nativeQualificationComplete: true` in `compatibility.json` with qualification evidence.
3. Confirm source version, `v<version>` tag, and package version agree. Keep tags immutable.
4. Publish the reviewed tag. The workflow builds the package, refuses an existing registry tag, checks the pushed digest, creates GitHub/Sigstore provenance, and then creates the public GitHub release.
5. Ensure the GHCR package is public and verify anonymous pulling and custom repository installation. Package visibility may require owner setup on the first publication.

Distribution uses `ghcr.io/weeklywildcat/tilecast-library-presence`. Marketplace listing is optional. No release, registry upload, or compatible minimum has been invented or published during implementation.

See [VALIDATION.md](VALIDATION.md) for remaining qualification work. Source is licensed AGPL-3.0-only.
