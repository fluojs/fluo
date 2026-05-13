# @fluojs/platform-deno

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Deno-backed HTTP adapter for the fluo runtime, built on native `Deno.serve`.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [HTTPS and Runtime Portability](#https-and-runtime-portability)
- [Conformance Coverage](#conformance-coverage)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
deno add npm:@fluojs/platform-deno npm:@fluojs/runtime npm:@fluojs/http
```

This package is intended to run on Deno. The published manifest intentionally does not declare `engines.node`, so npm metadata stays aligned with the Deno runtime contract; the repository's Node.js 20+ requirement only applies to the maintainer build/test toolchain.

## When to Use

Use this package when running fluo applications on the [Deno](https://deno.com/) runtime. This adapter leverages Deno's native `fetch`-standard `Request` and `Response` objects, providing a secure and high-performance environment for TypeScript backend development.

During application shutdown, the adapter stops new ingress and gives active HTTP handlers a bounded drain window before the Deno server lifecycle completes.

When `runDenoApplication(...)` runs inside Deno with signal APIs available, it also registers `SIGINT`/`SIGTERM` listeners and removes them once the application closes.

## Quick Start

```typescript
import { runDenoApplication } from '@fluojs/platform-deno';
import { AppModule } from './app.module.ts';

await runDenoApplication(AppModule, {
  port: 3000,
});
```

## Common Patterns

### Manual Request Dispatching
For testing or custom `Deno.serve` implementations, you can use the adapter's `handle` method to dispatch native web requests manually. Bind the dispatcher first via `app.listen()` (or `runDenoApplication(...)`), because `handle(...)` only works after the runtime has been bootstrapped.

```typescript
import { fluoFactory } from '@fluojs/runtime';

const adapter = createDenoAdapter({ port: 3000 });
const app = await fluoFactory.create(AppModule, { adapter });

await app.listen();

const response = await adapter.handle(new Request('http://localhost:3000/health'));
```

### Deno-Native WebSocket Support
The adapter supports Deno's native `Deno.upgradeWebSocket` after the application imports and configures the `@fluojs/websockets/deno` binding. Without that binding, websocket upgrade requests continue through normal HTTP dispatch instead of being upgraded implicitly.

```typescript
import { Module } from '@fluojs/core';
import { WebSocketGateway } from '@fluojs/websockets';
import { DenoWebSocketModule } from '@fluojs/websockets/deno';

@WebSocketGateway({ path: '/ws' })
export class MyGateway {}

@Module({
  imports: [DenoWebSocketModule.forRoot()],
  providers: [MyGateway],
})
export class RealtimeModule {}
```

## HTTPS and Runtime Portability

Pass Deno TLS certificate material through the `https` option to start `Deno.serve` in HTTPS mode. The adapter forwards `https.cert` and `https.key` to Deno as `cert` and `key`, and startup logging reports an `https://` listen URL so the Deno package stays aligned with the shared HTTP adapter portability contract.

```typescript
await runDenoApplication(AppModule, {
  hostname: '127.0.0.1',
  https: {
    cert: await Deno.readTextFile('./cert.pem'),
    key: await Deno.readTextFile('./key.pem'),
  },
  port: 3443,
});
```

`hostname` remains the Deno-native option name. The adapter also accepts `host` as a portability alias for shared HTTP adapter tests and cross-runtime configuration helpers; when both are provided, `hostname` wins.

Advanced options include injectable `serve` and `upgradeWebSocket` seams for tests or non-hosted runtimes, `rawBody`, `maxBodySize`, `multipart`, and `shutdownSignals`. When a seam is not injected, the adapter falls back to `globalThis.Deno.serve` and `globalThis.Deno.upgradeWebSocket` at listen/upgrade time. `runDenoApplication(...)` wires `SIGINT`/`SIGTERM` by default, `shutdownSignals: false` disables signal registration, and close waits up to 10 seconds for active requests to drain before aborting the Deno serve signal. `handle(...)` returns a JSON `500` before `listen()` binds the dispatcher and a JSON `503` while shutdown is in progress.

## Conformance Coverage

`packages/platform-deno/src/adapter.test.ts` is the package-local regression target for the documented Deno contract. It covers shared Web dispatch delegation, HTTPS startup forwarding, `SIGINT`/`SIGTERM` signal listener registration and cleanup, websocket upgrade binding, global Deno serve/upgrade fallback seams, pre-listen `500` handling, shutdown `503` handling, in-flight request drain before serve-signal abort, and the bounded 10-second close timeout.

The shared edge portability suite in `packages/testing/src/portability/web-runtime-adapter-portability.test.ts` exercises Deno beside Bun and Cloudflare Workers for malformed cookie preservation, query decoding, JSON/text raw-body capture, multipart raw-body exclusion, and SSE framing. The README parity assertion in the package test keeps these documented edge-runtime coverage claims synchronized with the Korean mirror.

## Public API Overview

- `createDenoAdapter(options)`: Factory for the Deno HTTP adapter.
- `bootstrapDenoApplication(module, options)`: Advanced bootstrap for custom orchestration.
- `runDenoApplication(module, options)`: Recommended quick-start helper for Deno.
- `DenoHttpApplicationAdapter`: Core adapter implementation with `handle(...)`, `getListenTarget()`, `getRealtimeCapability()`, `getServer()`, and `configureWebSocketBinding(...)`.
- `handle(request)`: Manual `Request` to `Response` dispatcher.
- `https: { cert, key }`: HTTPS startup options forwarded to `Deno.serve` and reflected in the reported listen URL.
- Option and seam types: `DenoServeOptions`, `DenoServeController`, `DenoServerWebSocket`, websocket binding interfaces, bootstrap/run options, and listen-target helpers.

## Related Packages

- `@fluojs/runtime`: Core framework runtime.
- `@fluojs/websockets`: Includes specific subpath `@fluojs/websockets/deno`.
- `@fluojs/http`: HTTP decorators and abstractions.

## Example Sources

- `packages/platform-deno/src/adapter.test.ts`
- `packages/websockets/src/deno/deno.test.ts`
