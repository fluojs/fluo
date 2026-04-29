# @fluojs/platform-bun

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Bun-backed HTTP adapter for the fluo runtime, built on native `Bun.serve()`.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API Overview](#public-api-overview)
- [Adapter Contract](#adapter-contract)
- [Conformance Coverage](#conformance-coverage)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/platform-bun
```

This package is intended to run on Bun. The published manifest intentionally does not declare `engines.node`, so npm metadata stays aligned with the Bun runtime contract; the repository's Node.js 20+ requirement only applies to the maintainer build/test toolchain.

## When to Use

Use this package when running fluo applications on the [Bun](https://bun.sh/) runtime. This adapter leverages Bun's high-performance `Request`/`Response` bridge and native `fetch`-style architecture, providing a seamless and fast experience for Bun users.

During application shutdown, the adapter stops new ingress and gives active HTTP handlers a bounded drain window before Bun forcefully tears the server down. If signal-driven shutdown exceeds `forceExitTimeoutMs` or fails, fluo reports that condition through logging and `process.exitCode` while leaving final process termination to Bun or the surrounding host.

## Quick Start

```typescript
import { createBunAdapter } from '@fluojs/platform-bun';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await fluoFactory.create(AppModule, {
  adapter: createBunAdapter({ port: 3000 }),
});

await app.listen();
```

## Common Patterns

### Manual Fetch Handling
If you prefer to manage the Bun server yourself, you can use the fetch handler directly.

```typescript
import { createBunFetchHandler } from '@fluojs/platform-bun';

const handler = await createBunFetchHandler({
  dispatcher: app.getHttpDispatcher(),
});

Bun.serve({
  fetch: handler,
  port: 3000,
});
```

### Native WebSocket Upgrade
The adapter supports Bun's native `server.upgrade()` through the `@fluojs/websockets/bun` binding.

```typescript
// gateways automatically use Bun's native upgrade when the Bun adapter is active
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

### Native `routes` Object Acceleration
On Bun `>=1.2.3`, the adapter opportunistically registers safe static and parameterized fluo routes through `Bun.serve({ routes })` while still routing matched requests back through the shared fluo dispatcher.

This keeps raw body, multipart, SSE, error responses, shutdown drain behavior, and websocket upgrade delegation on the same shared execution path. If route shape parity is unsafe, such as same-shape parameter routes with different param names or `ALL`-method handlers, the adapter falls back to fetch-only dispatch for those routes instead of changing fluo semantics.

## Public API Overview

- `createBunAdapter(options)`: Recommended factory for the Bun adapter.
- `createBunFetchHandler(options)`: Creates a native `fetch(request)` handler for custom `Bun.serve()` setups.
- `bootstrapBunApplication(module, options)`: Advanced bootstrap without implicit startup logging.
- `runBunApplication(module, options)`: Compatibility helper for quick startup with signal wiring.

The adapter also exports the typed Bun integration seams used by realtime packages:

- `BunHttpApplicationAdapter`: `HttpApplicationAdapter` implementation backed by `Bun.serve()`.
- `BunAdapterOptions`: host, port, TLS, raw-body, multipart, and shutdown options accepted by `createBunAdapter()`.
- `BootstrapBunApplicationOptions` and `RunBunApplicationOptions`: application bootstrap/run options for Bun-hosted apps.
- `BunWebSocketBinding` and `BunRealtimeBindingHost`: binding contracts used by `@fluojs/websockets/bun` before normal HTTP dispatch.

## Adapter Contract

- **Runtime host**: This package requires `globalThis.Bun.serve()` at listen time. Tests may provide a Bun-compatible test double, but production use is Bun-only.
- **Request portability**: Fetch requests are translated through the shared web dispatcher, preserving malformed cookie values, query arrays, JSON/text raw bodies when `rawBody: true`, and SSE framing.
- **Native route acceleration**: When Bun's `routes` object is available and a fluo route shape is semantically safe to pre-register, the adapter lets Bun short-circuit path matching before handing the request back to the shared dispatcher. Unsupported or ambiguous route shapes fall back to the regular `fetch` path.
- **Multipart behavior**: Multipart requests never expose `rawBody`, and multipart limits continue to flow through the shared runtime parser.
- **Startup target**: `hostname`, `port`, and `tls` are forwarded to `Bun.serve()`. Startup logs report the configured HTTP or HTTPS listen URL.
- **Shutdown ownership**: `close()` stops new ingress, waits for in-flight HTTP handlers, clears adapter state after drain settles, and removes signal listeners registered by `runBunApplication()`.
- **Realtime seam**: Bun websocket bindings must be configured before `listen()` starts the server. Upgrade requests are offered to the configured binding before falling back to HTTP dispatch.

## Conformance Coverage

`packages/platform-bun/src/adapter.test.ts` is the package-local regression target for the documented contract. It includes Bun fetch-style portability assertions for malformed cookies, JSON/text raw-body preservation, multipart raw-body exclusion, SSE framing, native-route param parity, and same-shape route fallback, plus focused tests for startup logging, shutdown listener cleanup, in-flight drain behavior, timeout reporting, and websocket binding delegation.

The broader repository suite also exercises Bun through `createWebRuntimeHttpAdapterPortabilityHarness(...)` alongside Deno and Cloudflare Workers in `packages/testing/src/portability/web-runtime-adapter-portability.test.ts`, keeping the shared web-runtime portability baseline aligned across fetch-style platforms.

## Related Packages

- `@fluojs/runtime`: Core framework runtime.
- `@fluojs/websockets`: Includes specific subpath `@fluojs/websockets/bun`.
- `@fluojs/socket.io`: Supports the native Bun engine.

## Example Sources

- `packages/platform-bun/src/adapter.test.ts`
- `packages/websockets/src/bun/bun.test.ts`
