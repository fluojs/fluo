# @fluojs/diagnostics

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Portable contracts for reading shared diagnostic data without installing runtime implementation or Studio UI. The public root and every public subpath perform no host builtin import, environment lookup, metadata installation, I/O, timer registration or resource creation on import. The package declares no package-wide `engines.node`.

## Installation

```bash
pnpm add @fluojs/diagnostics
```

Type-only applications may use a development dependency. Deployed code executing JSON readers should declare a regular dependency. No module registration or service configuration is required.

## Public API and ownership

| Import | Responsibility |
| --- | --- |
| `@fluojs/diagnostics` | All data types below plus `parseStudioPayload`, `parseStudioLiveEvent`, `validateStudioLiveEvent`, `isStudioLiveEvent` |
| `@fluojs/diagnostics/platform-contract` | State, checks, health/readiness reports, resource ownership, snapshots, diagnostic issues, validation results and `PlatformStatusSnapshot<TDetails>` |
| `@fluojs/diagnostics/studio-contracts` | Static/report/live wire and parsed types, graphs, routes, request traces, timing and readers; also re-exports platform types |

`RuntimeDiagnosticsGraph` and its module/provider/relationship types are available from the root. This is a serialized DI graph, not DI execution. `RuntimeDiagnosticsScope` is `singleton | request | transient`.

Diagnostics owns shared declarations and wire discrimination/validation. Runtime owns actual snapshot/timing production, bootstrap, PlatformShell start/stop, probes and resource management. Studio owns public reader facades, filters, Mermaid and the viewer. CLI owns inspect bootstrap/close, artifact writing and sidecar transport. Prometheus, counter/histogram backends and general logging execution are excluded.

Each feature continues to own its lifecycle union, health/readiness decisions, critical/reason/code, dependency metadata and details. `PlatformStatusSnapshot<TDetails>` retains narrow details types, including Notifications' concrete members and readonly dependencies. Resource ownership flags describe actual connect/disconnect responsibility; diagnostic severity is not health/readiness or traffic admission. Follow the [Health and Readiness Contract](../../docs/contracts/health-and-readiness.md).

## Usage

```ts
import { parseStudioPayload, type StudioInspectionSnapshot } from '@fluojs/diagnostics';

const snapshot: StudioInspectionSnapshot = {
  generatedAt: '2026-10-08T00:00:00.000Z',
  readiness: { status: 'ready', critical: false },
  health: { status: 'healthy' },
  components: [],
  diagnostics: [],
  routes: [{ id: 'GET /posts', controller: 'Posts', handler: 'list', method: 'GET', path: '/posts' }],
};
const { payload } = parseStudioPayload(JSON.stringify(snapshot));
const route = payload.snapshot?.routes?.[0];
// route: graphNodeId = 'route:GET__posts', kind = 'http', params = []
```

## Wire and parsed contracts

- Reads raw platform snapshots, standalone timing, snapshot-plus-timing envelopes and version-1 reports. `parseStudioPayload(rawJson)` returns typed `payload` and the original `rawJson`; malformed JSON or unsupported formats throw. Static inspect is a successful-bootstrap platform/route artifact, not a compiled DI graph.
- Persisted `StudioRouteDescriptor` has optional `graphNodeId`, `kind`, `params`. Parsed routes require them and supply `route:<sanitized-id>` (`anonymous` for an empty sanitized id), `http`, `[]` when omitted. Explicit graphNodeId and arbitrary string kind are preserved; malformed supplied values are rejected. Runtime producer routes still require all three fields.
- Timing/report/live version is `1`. Timing accepts only the five phases `bootstrap_module`, `register_runtime_tokens`, `resolve_lifecycle_instances`, `run_bootstrap_lifecycle`, `create_dispatcher` and finite numbers. Omitted timing differs from explicitly malformed timing. Three-decimal rounding remains a runtime producer responsibility.
- Report componentCount, diagnosticCount, errorCount, healthStatus, readinessStatus, timingTotalMs, warningCount must match snapshot/timing.
- Live events preserve snapshot/request/timing/diagnostic/restart/disconnect/heartbeat variants and emittedAt, epoch, eventId, sequence, source. Source runtime is node/bun/deno/worker/unknown. `validateStudioLiveEvent(unknown)` and `parseStudioLiveEvent(string)` validate and normalize complete wire payloads, throwing on invalid input. `isStudioLiveEvent` is the same decision as a boolean facade and does not mutate input.
- Request traces reject body, headers, payload, rawBody, requestBody, responseBody fields. Runtime does not expose bodies/cookies/headers/query/fragment or raw errors. CLI sidecar accepts partial ingress, retains payload as unknown and generates its own epoch/sequence. Its recursive body-like-field rejection is a separate transport boundary from the complete wire reader.

Existing loose static acceptance is not replaced with a stricter schema. This package does not replace transport or security redaction execution.

## Compatibility and evidence

Existing runtime root/devtools, core/internal, Studio root and feature status imports remain available, referring to the shared declarations. The removed `@fluojs/studio/contracts` is not restored. See the [optional import migration](../../docs/getting-started/migrate-diagnostics.md). Studio's Node `>=24.0.0 <27` and CLI's Node `>=24.11.0 <27` policies remain unchanged.

Execution evidence: `src/contracts.test.ts`, `src/portable-boundary.test.ts`, `../runtime/src/diagnostics-conformance.test.ts`, `../studio/src/contracts.test.ts`, `../cli/src/cli.test.ts` and feature `src/status.test.ts` suites. Isolated consumer tests install built dist and verify public imports and declarations with diagnostics alone.

```bash
pnpm --filter @fluojs/diagnostics build
pnpm exec vitest run packages/diagnostics/src packages/runtime/src/diagnostics-conformance.test.ts packages/studio/src/contracts.test.ts --maxWorkers=1
```
