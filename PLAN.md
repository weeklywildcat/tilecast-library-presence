# Library Presence implementation plan

**Status:** original implementation plan; current implementation and release status are in README.md.  
**Repository:** [weeklywildcat/tilecast-library-presence](https://github.com/weeklywildcat/tilecast-library-presence)  
**Package identity:** `weeklywildcat.library-presence`  
**Core repository:** [gbyo/tilecast](https://github.com/gbyo/tilecast)  
**Research baseline:** Tilecast `main` at [77ad2c227bb80f43b05f344d069d11ef0f8d0da4](https://github.com/gbyo/tilecast/commit/77ad2c227bb80f43b05f344d069d11ef0f8d0da4), verified on October 12, 2026.

This document is the implementation handoff. Library Presence will be a public, installable third-party Tilecast extension package. Generic host changes belong in Tilecast; the integration, source parsing, arrival logic, management page, and badge belong in this repository. Library Presence must never be compiled into Tilecast's `plugins/` directory.

The user should eventually paste this repository's URL into Tilecast's existing custom GitHub package installer, review its capabilities, and install it without rebuilding Tilecast Server. Marketplace publication is optional and separate.

## 1. Intended product

A persistent corner card shows the live Weekly Wildcat library occupancy:

```text
12   IN THE LIBRARY
```

A genuine new arrival temporarily changes the same card to:

```text
Welcome, Gibson!
```

It returns to the latest count after the greeting. A zero count hides the card and releases its surface. Default position is bottom-left; all four corners are supported. Personalized greetings default on.

The management page has only these settings:

- Enabled.
- Personalized greetings.
- Corner position.
- Tilecast target selection: individual screens, groups, locations, or all screens.

It also shows connection status, current occupancy, last successful refresh, and a 16:9 badge preview with local Count and Welcome preview modes. The preview controls never publish a greeting to real Players.

The source URL is fixed:

```text
GET https://signage.weeklywildcat.com/library/presence.json
```

No source URL, authentication, polling, timing, priority, raw JSON, or advanced styling controls are exposed.

## 2. Verified baseline and prerequisite gaps

The following findings come from the researched Tilecast main, not assumptions about Wasm support:

| Area | Current state | Required change |
| --- | --- | --- |
| External plugin contributions | Extraction recognizes `plugin` and qualifies its identity, but `extensions/contributions/service.go` explicitly skips its execution. | Activate external plugin contributions through a generic host catalog. |
| Package execution | Package API v3 supports server Wasm, network allowlists, KV, ordinary jobs, Studio UI, and versioned services. | Keep this server runtime separate from Player frame execution. |
| Job cadence | Ordinary jobs have `intervalMinutes` from 5 to 1440; the scheduler normally polls once a minute with a five-minute claim lease. | Add a separately declared realtime job class with seconds-based scheduling. |
| Native activation | Core's offline driver activates a different pending manifest digest through the presentation path. | Prove plugin-only revisions can update surfaces without activating playback again. |
| External Widgets | Verified hosted frames, opaque-origin sandbox execution, native frame grants, and CAS preparation already exist. | Reuse those security mechanisms for external plugin surfaces. |
| Plugin API | Plugin API v1 is frozen and assumes fixed bundled entrypoints. | Introduce an explicit versioned external descriptor rather than quietly changing v1. |
| Targets | `targets.resolve@1` exposes `screenIds` and `groupIds`. | Add a versioned target service supporting locations, explicit all, and a scoped picker. |
| Studio UI | A self-contained HTML page runs inside the existing sandbox and calls Wasm through the Studio bridge. | Build the integration's entire management UI in the package. |

Before coding, recheck main and reread the applicable AGENTS.md files. Preserve unrelated working-tree changes and use isolated branches/worktrees. Relevant references:

- [Extension packages](https://github.com/gbyo/tilecast/blob/main/docs/packages.md).
- [Package services](https://github.com/gbyo/tilecast/blob/main/docs/package-services.md).
- [Plugin API](https://github.com/gbyo/tilecast/blob/main/docs/plugin-api.md).
- [Content extension model](https://github.com/gbyo/tilecast/blob/main/docs/content-extension-model.md).
- [Player Core ownership](https://github.com/gbyo/tilecast/blob/main/docs/player-core.md).
- [Widget sandbox threat model](https://github.com/gbyo/tilecast/blob/main/docs/widget-sandbox-threat-model.md).
- `packages/package-sdk/`, `packages/package-guest-sdk/`, and `packages/package-samples/hello-services/`.
- `apps/server/internal/extensions/`, including extraction, contributions, sandbox assembly, Wasm lifecycle, jobs, and services.
- `packages/player-runtime/src/plugins/`, `src/widgets/`, and the Widget sandbox executor/bridge.
- Manifest preparation, CAS, frame transport, and renderer adapters on Edge, Windows, and Android.
- `crates/player-core/src/offline_driver.rs` and `offline_activation.rs`.

## 3. Delivery sequence

### Core PR 1: plugin-only manifest refresh

Implement and qualify this before external plugin runtime work.

Core must compare the full active and pending manifest documents. Only the top-level plugin state and an explicit, reviewed allowlist of unavoidable revision metadata may differ. The initial metadata candidates are `manifestVersion`, `generatedAt`, and `serverTime`; verify their actual producer semantics before including them. Schema version, identity, schedules, media claims, layouts, Widgets, data documents, content, presentation options, and synchronization inputs are never blanket exclusions. Unknown changed fields fail closed into normal activation.

An equal current `PresentationKey` is insufficient proof. Also compare the actual projected presentation and its resource bindings, timing, selection, viewport, and other renderer inputs, excluding only the independently delivered plugin channel and corrected clock metadata where justified. Keep Runtime presentation data opaque to Core: hosts supply complete opaque comparison values, while Core owns the decision and transition.

A qualified refresh must:

1. Require a healthy, accepted active server presentation with generation-bound evidence, matching the active stored manifest.
2. Confirm pending target identity, compatibility, exact verified resources, and required pins.
3. Send only the plugin-state update using the existing activation ID and generation.
4. Preserve playlist item/position, synchronized timeline, decoders, presentation evidence, recovery state, and playback Activity sessions.
5. Update the host's in-memory manifest identity and promote the still-current pending digest/version only after successful dispatch.
6. Retry a failed dispatch. Never fall back to full activation merely because delivery failed, or claim the failed state was promoted.
7. Recheck connection/generation and target fencing around asynchronous work. A superseded target or renderer reconnect must not inherit false acceptance.
8. Preserve safe crash recovery: a restart before durable promotion uses the last committed manifest. Promotion failures remain retryable without issuing a second presentation activation.

Edge uses `Event::PluginState`; Windows uses its separate `{type: "plugins"}` Runtime message. Android gains an equivalent narrow renderer operation through Rust/JNI/Kotlin and the trusted Runtime bridge. It must not call `activatePresentation` to update plugins.

Keep the fast path conservative. A plugin revision that also changes unrelated media/frame claims or any presentation input takes normal activation until a separately reviewed extension proves safe grant updates. PR 2 must support verified plugin frame grants independently where necessary; it must not weaken PR 1's equality proof.

Tests must demonstrate no second presentation activation, stable activation ID/generation, unchanged item/timing/evidence, dispatch failure and retry, durable promotion fencing, supersession, disconnects, and normal activation for real content/Layout/Widget/timing changes.

### Core PR 2A: package contracts, external contribution catalog, and state service

Introduce Package API v4 and an external Plugin API v2 descriptor. Preserve strict behavior of package v1–v3 and bundled Plugin API v1. Shared Go/TypeScript validators, JSON Schema, authoring tools, and fixtures must agree.

Package v4 retains existing capabilities and adds:

```json
{
  "capabilities": {
    "realtime": {
      "jobs": [
        { "id": "refresh_presence", "intervalSeconds": 5 }
      ]
    }
  }
}
```

Contract: at most one realtime job per package; integer interval 5–60 seconds; stable bounded ID; no ID collision with ordinary jobs; a server Wasm module and `run_job` export are required. Existing ordinary jobs remain unchanged.

The external Plugin API v2 descriptor declares a local ID, definition version, catalog metadata, `playerManifest: true`, surfaces, and tier. The external runtime artifact is conventionally `runtime/index.js` inside the contribution, not an arbitrary author-supplied path. Its server and Studio behavior comes from the package Wasm/Studio capabilities, not Go or React entrypoints. It cannot declare bundled-only routes, migrations, or executable host entrypoints.

The installer qualifies `library_presence` to `weeklywildcat.library-presence.library_presence`. Validate all declaration fields, contribution ownership, provenance, and artifact bounds before activation. Snapshot the verified bundle and deterministically assembled frame metadata alongside the contribution. Rebuild a complete immutable external plugin catalog on install/update/rollback/removal, with no partially visible activation.

Do not put third-party types into the built-in plugin type namespace.

### Core PR 2B: external Player surface ABI and verified delivery

Add one generic capability, `plugin.external-runtime@1`. Per-package native feature IDs are forbidden.

Use a generic manifest entry:

```json
{
  "type": "external_plugin",
  "version": 1,
  "package": {
    "packageId": "weeklywildcat.library-presence",
    "packageDigest": "sha256:<64 lowercase hex>",
    "contributionId": "weeklywildcat.library-presence.library_presence",
    "frame": {
      "sha256": "<64 lowercase hex>",
      "sizeBytes": 12345,
      "downloadPath": "/api/v1/player/packages/weeklywildcat.library-presence/plugins/weeklywildcat.library-presence.library_presence/frame"
    }
  },
  "runtime": {
    "surfaces": [
      "corner.top-left",
      "corner.top-right",
      "corner.bottom-left",
      "corner.bottom-right"
    ],
    "tier": "ambient"
  },
  "state": {},
  "validUntil": "2026-10-12T19:16:15.000Z"
}
```

This is the proposed wire contract; finalize names with Tilecast's schema conventions during the core review. The frame hash and size name the complete assembled HTML document, not just the JavaScript bundle. Runtime declarations come from the verified descriptor, never guest state.

Bounds: existing 1 MiB bundle limit and assembled-frame ceiling; bounded package/contribution identifiers; unique surface declarations from the existing finite surface registry; one existing tier; state at most 16 KiB as a JSON object; no unbounded nesting or entry lists. Apply shared manifest entry/frame count limits and define an installation-level enabled external-plugin ceiling.

Expose device-authenticated GET/HEAD for the frame. Disabled screens and revoked credentials fail before file access. Retained OCI bytes remain digest-verified, and assembly uses the same escaped-script interpolation and generated-template workflow as Widgets. Missing/corrupted frames must never displace the last playable manifest.

Extend native resource claim validation, origin path checks, compatibility checks, CAS preparation, pinning, and renderer authorization on Edge, Windows, and Android. Reuse the Widget frame resource domain and serving policy where compatible; carry explicit execution kind so the two bridge ABIs cannot be confused. Authorize only the required frame objects. Plugin updates must not retire presentation media grants or reset the decoder/timeline.

Players without the capability receive no executable external surface. Install compatibility and fleet support must be explicit; do not fake a bundled plugin capability for an unsupported Player.

### Core PR 2C: surface host and MessageChannel execution

Extend the shared Player Runtime surface host with external frame instances, keyed by canonical contribution identity and frame digest. State-only updates reuse the existing frame. Frame replacement/removal disposes its port, claims, timers, and grants. Tilecast continues to own surface containers, geometry, arbitration, tier, z-order, visibility, sleep/wake, corrected time, theme, and reduced motion.

Create a dedicated version 1 external-surface protocol, with document-bound nonce/attach token and monotonically increasing state revision:

- Frame hello is accepted only from its exact window at opaque origin, with the expected attach token.
- Host transfers exactly one MessageChannel for that document.
- Host sends `init`/`state` with declared surfaces/tier, bounded state, corrected clock offset, theme/motion hints, and awake status.
- Frame sends bounded `claims` for declared surfaces; host replies with `grant`/loss and geometry.
- Host sends `visibility` and `dispose`; stale revision/nonce messages are ignored.
- Reload/navigation destroys the channel. Never reattach a navigated document to the old grants.

The frame cannot elevate its tier, choose z-order, resize the stage, navigate the parent, or access credentials, parent DOM, filesystem, raw host APIs, or network. Reject undeclared surfaces, tier fields in claims, oversized messages, unknown operations, flooding, and malformed values. Use the existing deterministic arbitration rules; bound processing and diagnostics.

Execute only verified hosted frames at opaque origin under the Widget security model: `allow-scripts` only; restrictive host response CSP; no forms, workers, popups, top navigation, arbitrary subresources, or network. A document's own CSP is not sufficient. External plugin frames need no media grants, so the host policy for this ABI can be tighter than Widgets. Third-party JavaScript must never be imported into the trusted Runtime origin, including as blob/module code.

Keep idle content static. Frame clock correction updates locally without a playback activation. Freshness expiry is enforced by the trusted host as well as by the package UI, so a faulty frame cannot retain an expired surface.

Real-engine sandbox qualification on Edge/WPE, Windows/WebView2, and Android/WebView is a release gate. Browser/Electron tests alone do not establish native isolation.

### Core PR 2D: targets, state publishing, realtime scheduling, and Studio review

Add `targets.resolve@2`, preserving v1. Proposed target input:

```json
{
  "all": false,
  "screenIds": [],
  "groupIds": [],
  "locationIds": []
}
```

Require either explicit `all: true` with empty selector lists, or at least one selector. Never interpret empty selection as all. Validate and deduplicate bounded UUID lists and resolve their union through core targeting.

Provide `resolve` and a paginated, scoped `options` operation for screen/group/location labels needed by the sandbox picker. Reuse existing authorization and location/group membership logic. Avoid requesting a broad screen/content directory merely to draw a picker.

Add the generic service `plugin-runtime.state@1`:

| Operation | Context | Purpose |
| --- | --- | --- |
| `configure` | Studio, Owner/Administrator with scope checks | Enable/disable the owned contribution and replace authored targets. Audit atomically. |
| `publish` | Background or authorized Studio | Replace bounded Player state and validity for the owned contribution. System updates have no fabricated user actor. |
| `get` | Granted authorized contexts | Read the package's own configuration/state metadata. |
| `clear` | Authorized contexts | Remove the package's own published state; keep authored configuration unless explicitly changed. |

Every call checks active package digest/activation epoch, service grant, canonical contribution ownership, and `playerManifest`. Store authored target definitions and published state in host-owned tables; the guest cannot write Tilecast SQL or manufacture manifest revisions. One configuration/state row per contribution is enough for this integration. Use conditional revisions where configuration/publication races could overwrite newer data.

Separate targeting changes from state changes. State-only updates invalidate the current resolved affected screens; configuration changes invalidate the union of old and new screens. Membership/location changes re-resolve authored targets through core hooks so moved/new screens are updated correctly. Removal, disabled configuration, update, and rollback clear or reconcile stale state and invalidate prior screens. Do not resurrect transient greetings on rollback.

Use byte/semantic equality to suppress identical publication. Expiration metadata counts as a freshness change; it is intentionally refreshed periodically, not every source poll. Require a future validity deadline with a documented finite maximum (proposed 24 hours), and bound state depth, total bytes, and rows.

Realtime scheduler:

1. Run a dedicated due scan at approximately one-second cadence; do not use the minute scheduler for a five-second contract.
2. Claim jobs atomically with PostgreSQL locking/leases. Include the installed activation digest/epoch and unique claim token in each claim and completion update.
3. Use a four-second invocation deadline, shorter than the minimum interval; Library Presence uses a three-second bounded fetch inside it. Use a lease longer than that deadline, with documented crash recovery.
4. Never overlap executions of the same job. Bound server-wide workers, queue depth, and package work. Do not spawn unlimited polling goroutines.
5. Cancel on removal/update/rollback. Across replicas, check the authoritative activation fence before invocation and every mutating host call; reject stale results even if another replica's in-flight request cannot stop instantaneously.
6. A stale completion cannot reschedule a replaced job or overwrite new status. Clear lifecycle reconciliation gaps with transactional state/fencing and idempotent repair.
7. Use database due-time authority across replicas, at-least-once semantics, no catch-up storm, and a fixed cadence that approximates five seconds without overlapping runs.
8. Report job class, seconds interval, last outcome, next run, failures, and timeout/cancellation status.

Install/update review must visibly list approved network hosts, realtime background activity and interval, storage, Studio UI, service grants, and external executable Player surfaces. Add localized copy for every Studio locale. Capability changes need the existing fresh review/digest-confirmation path.

Optionally extend the Studio frame handshake with non-sensitive light/dark theme and reduced-motion hints. Keep document-bound bridge security unchanged. The package's self-contained UI uses these hints if present and safe defaults otherwise.

## 4. Third-party package implementation

Begin executable package work only after the required core support exists and the ABI is settled.

Proposed source tree:

```text
README.md
LICENSE
tilecast.package.json
plugin/
  tilecast.plugin.json
  runtime/
    src/
guest/
  Cargo.toml
  src/
studio/
  src/
tests/
scripts/
.github/workflows/
```

The build stages verified package inputs into an artifact directory with `plugin/runtime/index.js`, the Wasm server module, and one self-contained Studio HTML page. Follow Tilecast's actual OCI packaging tools; do not assume this source tree is already an artifact.

Use AGPL-3.0-only for the implementation and retain applicable SDK notices. Pin dependencies/toolchains and core SDK versions. Keep credentials and signing material out of source and artifacts.

Package v4 requests only:

- Network host `signage.weeklywildcat.com`.
- Package KV storage.
- One realtime job, `refresh_presence`, every five seconds.
- Sandboxed Studio UI.
- `targets.resolve@2`.
- `plugin-runtime.state@1`.

No arbitrary URLs, broad user/content access, display-control permissions, direct SQL, or Player HTTP are needed.

### Source validation and durable arrival detection

Accept only `schemaVersion === 1`; a bounded nonnegative integer `currentCount` (proposed maximum 100,000); valid RFC 3339 timestamps; and nullable `latestCheckIn` with a bounded nonempty cursor and nullable bounded first name. Proposed limits are 128 bytes for cursor, 80 Unicode characters/320 UTF-8 bytes for first name, and 16 KiB response bytes. Reject malformed/oversized input. Render names as text, never HTML. Reject control characters and unreasonable future timestamps; stale source snapshots do not extend display validity.

Persist versioned bookkeeping in KV:

- Whether a successful baseline exists.
- Previously observed cursor.
- Maximum check-in timestamp ever observed.
- Last valid source snapshot/refresh time.
- Last published visible state and freshness time.
- A recoverable pending publication event and configuration revision.

The first successful poll establishes a baseline and does not greet. A new arrival requires all three:

```text
latestCheckIn != null
AND latestCheckIn.cursor != previouslyObservedCursor
AND latestCheckIn.at > maximumCheckInAtEverSeen
```

Never decrease the maximum timestamp. Update observed cursor on every valid observation, including regressions, while retaining the maximum timestamp. Checkouts, older archived records, cursor regressions, and restored already-seen visits produce no welcome. A genuinely newer timestamp can greet even when occupancy is unchanged.

Use absolute, short greeting expiry derived from the arrival observation/source timestamp and corrected server time; retries cannot extend it. A missing first name produces "Welcome!". When personalized greetings are off, consume arrival bookkeeping but publish no greeting.

Persist a recoverable publication intent/bookkeeping record before publishing, then retry the same opaque event ID and original expiry after a crash. Repeated at-least-once jobs must not replay or extend greetings. A restart reads existing bookkeeping rather than resetting the baseline. On prolonged stale recovery, restore count and establish a recovery observation without replaying old arrivals. Serialize conflicting guest writes or use revision checks; test config/job races.

### Publication cadence and Player state

Poll every five seconds. Publish when visible state changes, and approximately every 30 seconds to refresh validity. Use about 75 seconds of validity, within the required 60–90 second range. Successful HTTP alone is not a reason for a new manifest revision.

Example bounded Player state:

```json
{
  "count": 12,
  "position": "bottom-left",
  "validUntil": "2026-10-12T19:16:15.000Z",
  "greeting": {
    "id": "2451@2026-10-12T19:14:58.000Z",
    "firstName": "Gibson",
    "expiresAt": "2026-10-12T19:15:05.000Z"
  }
}
```

Mirror `validUntil` into the generic host expiry envelope so the trusted host can release the surface. Keep them equal. Publish no last names, student IDs, roster, Flow URL, raw diagnostics, or secrets. An opaque greeting ID may incorporate a cursor; never publish the cursor separately.

Brief source failures preserve last good state without extending its validity. After expiry, hide locally. Recovery restores the current count without reviving expired greetings. Disabling the integration clears its state/surfaces immediately; continue consuming arrival baselines so re-enabling cannot replay old welcomes.

### Badge implementation

Build static DOM/CSS inside the external surface frame:

- About 48 px safe area at 1080p, owned/coordinated by the host.
- About 76–82 px tall and 230–270 px wide for count; wider for greeting.
- About 20 px radius, near-opaque dark background, white text, subtle border/shadow.
- Large bold tabular count and smaller uppercase "IN THE LIBRARY".
- One shell with overlapping count/greeting contents.
- Width/opacity/transform transitions of roughly 220–280 ms.
- Count continues updating underneath a greeting.
- Corrected host clock controls greeting and stale expiry.
- Zero or expired state animates away and releases its claim through the host's bounded visibility lifecycle.
- Reduced motion removes the morph animation.

No canvas, video, WebGL, backdrop blur, continuous animation, per-frame JavaScript, decorative icon requirement, or Player-side fetch. Greeting expiry and freshness use deadline timers, not animation loops.

### Sandboxed Studio page

Bundle all CSS/JS into one HTML artifact with no external network/subresources. Do not import React/Shadcn/`@tilecast/studio` or add integration React code to Tilecast Dashboard.

Use the existing Studio MessageChannel bridge to invoke Wasm `handle_ui_request`. The guest reads/writes package configuration and calls the target/state services. Return a polished, bounded view model, not raw KV or SQL. Distinguish last successful source refresh from last attempted job and from Player validity.

Provide a responsive theme-aware single-integration page, compact controls, visible save/error feedback, keyboard access, and the 16:9 local preview. Honor reduced motion. Use ordinary CSS consistent with Tilecast and localize public UI copy according to the finalized external-package localization approach.

## 5. Distribution and compatibility

The first executable release depends on all of these being shipped together in a supported Tilecast release:

- Plugin-only refresh on all three native Players.
- External contribution activation.
- External Player surface ABI and verified sandboxed delivery.
- Package API v4 realtime jobs.
- Target service v2 and plugin state service v1.

Set `tilecast.version` to the actual first compatible release and supported upper bound when those releases are known. Do not invent a minimum version now or claim compatibility with existing releases. Older servers fail clearly during manifest/service/compatibility validation; older Players are explicitly unsupported for executable surfaces.

Publish a normal Tilecast OCI artifact to `ghcr.io/weeklywildcat/tilecast-library-presence`. Preserve existing artifact/config/content media types unless the core contract actually requires a separately reviewed change. Align release tag, package version, manifest at the tag, OCI tag, immutable digest, and source revision.

GitHub Actions should validate, build, test, package, push, and produce the Sigstore provenance required by Tilecast's current verifier. Use GitHub OIDC and the exact supported signing/provenance identity, not a custom signature format. Do not move a released tag or republish a version with different bytes. Validate public anonymous GHCR pulls and resolver provenance verification.

End-to-end distribution gate: install through this public repository URL, review grants, activate without a server rebuild, receive state on targeted Players, update with a fresh review, rollback coherently, and remove with surfaces/jobs/state cleared.

## 6. Verification and acceptance matrix

| Requirement | Evidence required |
| --- | --- |
| No playback restart | Core and native-host tests capture dispatches and prove plugin revisions send no new presentation activation; ID/generation/item/timing/evidence stay stable. |
| Real changes still activate | Content, Layout, Widget, timing, resource, identity, unknown-field, and schema changes take normal activation. |
| Failure-safe promotion | Delivery failure, disconnected renderer, target supersession, DB promotion failure, and crash-point tests preserve the last committed playable state. |
| Plugin contributions active | Real extracted external package enters the catalog and publishes a surface; invalid descriptor/bundle fails activation. |
| Identity and provenance | Signature/digest checks and cross-package ownership attacks fail closed. |
| Frame integrity | Exact size/hash, missing/corrupt frame, CAS repair/pins, route containment, and authenticated GET/HEAD tests. |
| Sandbox containment | Real-engine tests for parent DOM, credentials, navigation, network/subresources, workers, undeclared surfaces, tier escalation, malformed/flooded bridge messages, reload, stale nonce/revision, and grant revocation. |
| Target scope | All/screen/group/location union, invalid IDs, empty selection, authorization scope, membership moves, old/new target fan-out, and unaffected screens. |
| Lifecycle | Install/update/rollback/removal revoke replaced jobs/frames/state, reject stale writes/completions, and clear affected surfaces. |
| Realtime jobs | Minimum/maximum interval and count validation; non-overlap; bounded timeout/workers; cancellation; multi-replica leases; crash recovery; no catch-up storm. |
| Install review | Network host, realtime interval, storage, Studio, service versions/operations, and Player execution declaration appear in review and update diff. |
| Arrival algorithm | Baseline, true arrival, unchanged count with new arrival, checkout, null check-in, cursor regression, equal/older timestamp, restored visit, missing name, malformed data, restart, and stale recovery fixtures. |
| Publication | No revision on identical polls; count/greeting/config changes publish; freshness refresh occurs; invalid source data does not renew validity; idempotent crash retry. |
| Badge | Four corners, zero hide/release, count updates during welcome, greeting deadline, stale deadline, lost grant, sleep/wake, reduced motion, safe text, and corrected clock. |
| Studio | Theme/motion handshake, self-contained artifact, bridge authorization/CSRF, scoped targets, save errors, and preview isolation. |
| Cross-player parity | Edge, Windows, and Android verify and host the same frame/bridge fixtures, including live plugin-only refresh over video and synchronized playback. |
| Distribution | Public repository URL resolves the signed immutable GHCR package and supports install/update/rollback/removal without rebuilding Tilecast. |

Run relevant unit/integration/build checks for each PR, including PostgreSQL integration paths for protocol/state/scheduler work. Use `make player-check`, `make player-test`, `make edge-check`, `make edge-test`, `make windows-check`, `make windows-test`, and `python3 scripts/ci/check-player-architecture.py` for native changes. Run Android JVM/lint/build and device tests where the bridge/sandbox changes require them. Run Runtime tests/build, package validator parity, plugin generation/checks, dashboard lint/i18n/build, and documentation checks.

Follow repository requirements for full handoff validation, packaged Linux tests, pairing, server restart reconnection, revocation, re-pairing, downloaded playback, and offline scheduling. Do not claim physical Fire TV or other hardware qualification from compilation or emulation alone.

## 7. Documentation and completion gates

Update engineering and public Tilecast docs in the same core PRs: package format/services, external plugin descriptor and surface protocol, manifest/frame delivery, native behavior, install review, realtime jobs, compatibility, backup/restore, and contributor publishing. Generated files must be produced by their tools. Run `make docs-check` and `npm run docs:build`.

This repository's final README should document settings, privacy-minimized Player state, source outage behavior, supported server/Player versions, install/update/remove steps, development/tests, and signed release publishing. Keep this implementation plan as `docs/implementation-plan.md` when the README becomes operator documentation.

The complete implementation is ready only when:

1. Separate core PRs are merged and a compatible release is identified.
2. The package builds and passes its parsing/bookkeeping/UI tests.
3. The signed public OCI release resolves through Tilecast's existing custom GitHub workflow.
4. Targeted state updates work on Edge, Windows, and Android without restarting playback.
5. Failure, stale expiry, zero count, and lifecycle cleanup pass the acceptance matrix.
6. Documentation and actual compatibility claims match verified releases and device evidence.

No implementation, PR, signed artifact, or compatibility is claimed by this planning-only repository.
