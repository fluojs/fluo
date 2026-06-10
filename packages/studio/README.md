# @fluojs/studio

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

CLI sidecar and React viewer workflow for fluo diagnostics, with a Node dev-runner live MVP and backward-compatible static/report artifact loading.

## Table of Contents

- [Installation](#installation)
- [Release Policy](#release-policy)
- [Quick Start: Live Devtool](#quick-start-live-devtool)
- [Static/Report Compatibility](#staticreport-compatibility)
- [Local Security Model](#local-security-model)
- [Runtime Support Matrix](#runtime-support-matrix)
- [Public API](#public-api)
- [Future Direction](#future-direction)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

Most application projects install Studio as a development-only dependency. The CLI resolves it for `fluo dev --studio`, `fluo inspect --mermaid`, and packaged viewer access, while the application runtime itself does not import Studio.

```bash
pnpm add -D @fluojs/studio
```

Use a regular dependency only when a published package or runtime automation imports `@fluojs/studio` or `@fluojs/studio/contracts` at runtime:

```bash
pnpm add @fluojs/studio
```

The published package serves these caller-facing entrypoints:

- `@fluojs/studio` / `@fluojs/studio/contracts` for canonical snapshot parsing, filtering, Mermaid graph rendering helpers, and runtime-connected Studio live event contracts.
- `@fluojs/studio/viewer` for the packaged React browser viewer HTML entry file.

## Release Policy

- `@fluojs/studio` is part of the intended public publish surface for fluo.
- The app-side CLI/viewer contract is development-only installation (`pnpm add -D @fluojs/studio`); runtime tooling that imports Studio helpers should declare a normal dependency (`pnpm add @fluojs/studio`). Local repo development still uses `pnpm --dir packages/studio dev`.
- The public package surface is additive: live devtool contracts are added while file-first parsing, filtering, graph rendering, and report artifacts remain supported.

## Quick Start: Live Devtool

Run a local app with the runtime-connected Studio sidecar:

```bash
fluo dev --studio
```

`fluo dev --studio` starts the normal dev process, starts a token-protected local sidecar, injects explicit Studio runtime config into the Node app child before it imports `@fluojs/runtime`, and prints a URL such as:

```text
[fluo] Studio listening at http://127.0.0.1:51234/?token=...
```

Open that URL to inspect the live React Studio dashboard. The dashboard is built with Feature-Sliced Design layers under `src/app`, `src/pages`, `src/widgets`, `src/features`, `src/entities`, and `src/shared`.

Studio is launched as a CLI-owned sidecar/viewer workflow. It is not an application module to mount inside your fluo runtime. The live MVP targets the Node dev-runner path; non-Node projects should use the static/report inspect workflow until dedicated Bun, Deno, or Workers bridges are implemented and verified.

Live mode shows:

- connection state (`connecting`, `connected`, `restarting`, `reconnecting`, `stale`, `disconnected`, `error`);
- module/provider/controller/route graph nodes and import/export/ownership/dependency edges;
- HTTP method/path/controller handler route descriptors;
- recent request flow with route/handler correlation, success/error, status code, and duration;
- bootstrap/restart/request timing summaries;
- runtime/request diagnostics with severity, target, message, and fix hints where available.

MVP request flow intentionally means route/handler and dependency-graph correlation, not full method-level service call-chain tracing.

## Static/Report Compatibility

Studio still accepts JSON exports from the fluo CLI. Runtime produces snapshots, the CLI owns artifact export/write/delegation, and Studio owns the public helpers and viewer surface that parse, filter, inspect, and render those snapshots for people and automation callers. Supported inspect artifacts include raw snapshots, snapshot-plus-timing envelopes, report artifacts produced by `fluo inspect --report`, and legacy standalone timing diagnostics.

This file-first path is the compatibility and migration fallback for CI, support handoffs, architecture reviews, and non-Node runtime targets. Bun, Deno, and Cloudflare Workers projects should generate inspect/static artifacts and open them with the packaged viewer instead of expecting live sidecar events in the MVP.

1. **Export a snapshot**:
   ```bash
   fluo inspect ./src/app.module.ts --json > snapshot.json
   ```

2. **Open the packaged Studio viewer**:
   ```bash
   pnpm add -D @fluojs/studio
   node -p "require.resolve('@fluojs/studio/viewer')"
   ```

   Open the printed `dist/index.html` path in a browser. For repo-local Studio development, use:
   ```bash
   pnpm --dir packages/studio dev
   ```

3. **Load the file**: Drag and drop `snapshot.json` into the Studio web interface. Search and filter controls preserve focus while the graph, connection explorer, diagnostics, and summary update.

## Local Security Model

- The Studio sidecar binds `127.0.0.1` by default.
- Runtime ingestion and browser state/SSE APIs require generated per-run tokens.
- The sidecar does not enable CORS by default.
- Request bodies are not captured by default. Live request events include method/path/url/request id/route/handler/status/duration/error metadata only.
- Runtime Studio instrumentation is activated only by explicit CLI-provided Studio config. Runtime package source does not read `process.env` directly; without valid injected config, runtime behavior is a no-op.

## Runtime Support Matrix

| Runtime target | MVP expectation |
| --- | --- |
| Node dev-runner | Live sidecar support target through `fluo dev --studio`; the CLI injects explicit Studio runtime config into the Node app child and streams snapshot/request/timing/diagnostic lifecycle events. Static inspect artifacts remain supported. |
| Bun | Live sidecar events are not enabled for this MVP; `fluo dev --studio` rejects Bun projects until a dedicated bridge is implemented and verified. Use `fluo inspect` JSON/report artifacts, Mermaid output, and the packaged viewer as the migration fallback. |
| Deno | Live sidecar events are not enabled for this MVP; `fluo dev --studio` rejects Deno projects until a dedicated bridge is implemented and verified. Use `fluo inspect` JSON/report artifacts, Mermaid output, and the packaged viewer as the migration fallback. |
| Cloudflare Workers | Live sidecar events are unsupported for this MVP unless a dedicated worker bridge is implemented and tested. Use static inspect/report artifacts and the packaged viewer as the migration fallback. |

## Public API

Studio is primarily a CLI-launched sidecar and browser viewer, but the published package also exposes documented contracts used by tooling and automation. Treat `@fluojs/studio` as the canonical owner of snapshot parsing, filtering, Mermaid graph rendering, and live Studio event validation semantics. The root `@fluojs/studio` export re-exports the helper functions and public types from `@fluojs/studio/contracts`.

| Contract | Description |
|---|---|
| `parseStudioPayload(rawJson)` | Accepts raw snapshot JSON, standalone timing JSON, snapshot+timing envelopes, and `fluo inspect --report` artifacts; returns the parsed payload plus the original JSON string. |
| `applyFilters(snapshot, filter)` | Applies readiness/severity/query filters without mutating the source snapshot. |
| `renderMermaid(snapshot)` | Produces Mermaid graph text from the loaded platform graph, including internal component dependency edges and external dependency nodes. |
| `parseStudioLiveEvent(rawJson)` / `validateStudioLiveEvent(value)` | Validate runtime-connected sidecar/SSE envelopes before UI state consumes them. |
| `isStudioLiveEvent(value)` | Runtime-safe type guard for checking sidecar/SSE envelopes before parsing or dispatch. |
| `StudioLiveSnapshot` | Live graph/routes/requests/timing/diagnostics snapshot consumed by the React UI. |
| `StudioLiveEvent` | Versioned live event envelope for `snapshot`, `request`, `timing`, `diagnostic`, `restart`, `disconnect`, and `heartbeat`. |
| `StudioPayload` / `StudioReportArtifact` / `StudioReportSummary` | Static/report compatibility contracts. |

### Root type exports

| Type export | Description |
|---|---|
| `FilterState` | Query, readiness status, and diagnostic severity filters applied by Studio without mutating the source snapshot. |
| `ParsedPayload` | Return shape from `parseStudioPayload(rawJson)`, including the parsed `StudioPayload` and original JSON string. |
| `PlatformDiagnosticIssue` | Runtime diagnostic issue type re-exported from `@fluojs/runtime` for Studio consumers. |
| `PlatformDiagnosticSeverity` | Diagnostic severity union used by filters and live diagnostics. |
| `PlatformReadinessStatus` | Readiness status union used by filters and graph annotations. |
| `PlatformShellSnapshot` | Runtime-produced snapshot type re-exported from `@fluojs/runtime` for inspect artifacts. |
| `StudioPayload` | Static artifact envelope containing a snapshot, timing diagnostics, and/or report artifact. |
| `StudioReportArtifact` | CI/support report artifact produced by `fluo inspect --report`. |
| `StudioReportSummary` | Stable summary fields embedded in a report artifact. |
| `StudioConnectionState` | UI-side connection state for live or static Studio sessions. |
| `StudioConnectionStatus` | Connection status union, including live lifecycle states and `static`. |
| `StudioDisconnectPayload` | Live disconnect lifecycle payload. |
| `StudioGraphEdge` | Serializable edge in the runtime-connected Studio dependency graph. |
| `StudioGraphEdgeKind` | Edge kind union for imports, ownership, route exposure, dependency, and export relationships. |
| `StudioGraphNode` | Serializable node in the runtime-connected Studio dependency graph. |
| `StudioGraphNodeKind` | Node kind union for modules, providers, controllers, routes, platform nodes, and external dependencies. |
| `StudioHeartbeatPayload` | Live heartbeat payload used to keep sidecar/UI sessions fresh. |
| `StudioLiveDiagnostic` | Runtime diagnostic shape surfaced by the live diagnostics panel. |
| `StudioLiveEvent` | Versioned sidecar/SSE event union for snapshots, requests, timing, diagnostics, restarts, disconnects, and heartbeats. |
| `StudioLiveEventBase` | Generic base envelope shared by all live Studio events. |
| `StudioLiveEventSource` | App/runtime source metadata attached to live Studio events. |
| `StudioLiveSnapshot` | Live graph/routes/requests/timing/diagnostics snapshot consumed by the React UI. |
| `StudioRequestStatus` | Request lifecycle status union used by live request traces. |
| `StudioRequestTrace` | Request trace metadata emitted without request or response bodies. |
| `StudioRestartPayload` | Runtime/app restart lifecycle payload emitted by CLI-owned dev supervision. |
| `StudioRouteDescriptor` | Route descriptor projected into the live Studio UI. |

### Published package entrypoints

- `@fluojs/studio`: root helper barrel for snapshot parsing/filtering/rendering and live contracts.
- `@fluojs/studio/contracts`: explicit helper subpath for tooling that wants the contract helpers directly.
- `@fluojs/studio/viewer`: packaged `dist/index.html` entrypoint for the React browser viewer bundle.

`@fluojs/studio/viewer` is an asset-only manifest subpath: callers resolve the packaged HTML file path, not a JavaScript module or TypeScript declaration entrypoint.

## Future Direction

The MVP is local and runtime-connected. Future releases should consider, but do not yet ship, cloud-hosted Studio, accounts/auth, team sharing, production monitoring dashboards, richer bidirectional commands, and a possible VS Code extension.

## Related Packages

- **[@fluojs/cli](../cli/README.md)**: Provides `fluo dev --studio` and inspect/export commands.
- **[@fluojs/runtime](../runtime/README.md)**: Produces live snapshots, request traces, timing, and diagnostics.

## Example Sources

- [main.ts](./src/main.ts) - Test-compatible application entry point.
- [main.tsx](./src/main.tsx) - React browser viewer entry point.
- [contracts.ts](./src/contracts.ts) - Static and live Studio contract definitions.
