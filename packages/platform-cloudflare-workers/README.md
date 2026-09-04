# @fluojs/platform-cloudflare-workers

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Cloudflare Workers HTTP adapter for the fluo runtime, optimized for the edge.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Lifecycle and Public Seam Notes](#lifecycle-and-public-seam-notes)
- [Conformance Coverage](#conformance-coverage)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/platform-cloudflare-workers
```

This package is intended to run on Cloudflare Workers. The published manifest intentionally does not declare `engines.node`, so npm metadata stays aligned with the Workers runtime contract; the repository's Node.js 20+ requirement only applies to the maintainer build/test toolchain.

## When to Use

Use this package when deploying fluo applications to [Cloudflare Workers](https://workers.cloudflare.com/). It is designed for the serverless edge environment, providing a lightweight `fetch`-based adapter that respects Worker isolate constraints and native Web APIs.

The adapter binds each request lifecycle to `executionContext.waitUntil(...)` after the dispatcher is bound and keeps in-flight dispatches, WebSocket upgrades through the upgraded server socket's terminal close, and SSE (`text/event-stream`) response bodies alive during `close()` so Worker shutdown does not drop active work mid-request.

During application shutdown, the adapter stops accepting new ingress immediately and gives active HTTP handlers a bounded 10-second drain window before `close()` fails with a timeout instead of hanging indefinitely. While that drain is still in progress, a concurrent `listen()` call rejects with `Cloudflare Workers adapter cannot listen while shutdown is still draining.` instead of reopening the Worker. Once closed, follow-up HTTP and WebSocket upgrade requests receive the same JSON `503` shutdown response until the adapter is explicitly listened again. Lazy entrypoints keep returning shutdown responses while a timed-out close is still draining, but they clear that temporary gate once the underlying close eventually settles so a later request can bootstrap a fresh Worker application.

## Quick Start

### Standard Adapter Usage
Bootstrap your application and export a standard Cloudflare Worker `fetch` handler.

```typescript
import { fluoFactory } from '@fluojs/runtime';
import { createCloudflareWorkerAdapter } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const adapter = createCloudflareWorkerAdapter();
const app = await fluoFactory.create(AppModule, { adapter });

await app.listen();

export default {
  fetch: (req, env, ctx) => adapter.fetch(req, env, ctx),
};
```

### Lazy Entrypoint (Zero-Config)
Use the entrypoint helper for an even simpler setup that bootstraps on the first request.

```typescript
import { createCloudflareWorkerEntrypoint } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const worker = createCloudflareWorkerEntrypoint(AppModule);

export default {
  fetch: worker.fetch,
};
```

### Close Ownership and Lazy Restart

Cloudflare Workers does not provide a host-invoked shutdown callback to the exported `fetch` handler. When migrating NestJS shutdown hooks, choose an application-owned close trigger. An out-of-band lifecycle trigger, running outside any `worker.fetch` invocation, may call `await worker.close()` directly. A management route handled inside the same `worker.fetch` invocation must return its current response without awaiting `close()`, then observe it with `executionContext.waitUntil(worker.close())` or an equivalent non-self-awaiting mechanism; otherwise `close()` waits for that active request to drain and reaches the shutdown timeout. Exporting `worker.fetch` alone does not arrange a close call.

A successful `worker.close()` is intentionally restartable. It releases the current lazy application; a later `worker.fetch(...)` bootstraps a new application in the isolate, rerunning bootstrap lifecycle hooks and reconstructing application singleton providers. For an env-aware entrypoint, that new application generation uses the cached configuration from the first environment without calling its factory again. Do not treat `close()` as a terminal Worker shutdown signal. If an application needs terminal behavior, it must own and enforce that state explicitly.

### Env-Aware Lazy Entrypoint
Use `createCloudflareWorkerEnvEntrypoint(...)` when the first Worker `env` must select the root module or bootstrap options. Its factory runs once per isolate before module registration; the returned root module and options remain cached for that isolate, while each running application generation reuses them.

```typescript
import { createCloudflareWorkerEnvEntrypoint } from '@fluojs/platform-cloudflare-workers';
import { createAppModule } from './app.module';

interface WorkerEnv {
  API_PREFIX: string;
  DB: D1Database;
}

const worker = createCloudflareWorkerEnvEntrypoint<WorkerEnv>((env) => ({
  rootModule: createAppModule({ database: env.DB }),
  options: {
    globalPrefix: env.API_PREFIX,
  },
}));

export default {
  fetch: worker.fetch,
};
```

`worker.ready(env)` requires an explicit `env` for the same reason. The first supplied environment determines the singleton bootstrap configuration; later request environments still attach to `request.cloudflare.env`, but do not reconfigure it. A successful `worker.close()` releases only the current application generation: the next `ready(env)` or `fetch(...)` creates a fresh application from the retained first-environment module and options without calling the factory again. Use the existing `createCloudflareWorkerEntrypoint(module, options)` when bootstrap configuration is already available before the first Worker request.

For the standard `createCloudflareWorkerEntrypoint(...)` request-bound `env` path, fetch-time bindings cannot supply `ConfigModule.forRoot(...)` or singleton bootstrap providers. Read, validate, and narrow request-varying bindings, then pass application-shaped values to provider methods. Choose the env-aware entrypoint only when the first environment must configure the application before module registration.

## Common Patterns

### Early Hints are unsupported

The Workers `Response` API does not provide a request-handler write primitive for an informational response before the final response, so `context.response.earlyHints` is absent. Check for capability presence before use. Cloudflare deployment/cache features that may generate Early Hints are host configuration and are not exposed as a Fluo response writer.

### Streaming multipart consumption

Set `multipart: { strategy: 'stream' }` at application bootstrap to receive multipart data incrementally. For
multipart routes, `RequestContext.request.body` is an `AsyncIterableIterator<MultipartPart>`: field parts expose
`kind: 'field'`, `name`, `value`, and `headers`; file parts expose `kind: 'file'`, `name`, `filename`,
`contentType`, `headers`, and a single-consumer `ReadableStream<Uint8Array>` at `stream`. Finish or cancel each file
stream before requesting the next part.

Runtime route dispatch owns an iterator created for a route and automatically calls `return()` after the handler
finishes, cancelling and releasing an active source. Standalone `parseMultipartStream(...)` consumers own that
responsibility: consume the iterator to completion or call `return()` when ending early.

### Byte Ranges and Cache Validation

Workers preserves the shared `@fluojs/http` single-byte-range and `If-Range` contract through fetch dispatch. After conditional-request evaluation selects cache validators, a valid `Range: bytes=` request yields the portable `206` identity-byte response; `If-Range` reuses those selected validators, while malformed or multi-range fields retain the full response and an unsatisfiable range yields bodyless `416`. `HEAD` mirrors GET metadata without consuming a stream.

### Working with WebSocketPairs
The adapter supports Cloudflare's native `WebSocketPair` for real-time communication via the `@fluojs/websockets/cloudflare-workers` binding. Upgrade handling is opt-in through that binding, and `createWebSocketPair` can be injected for non-hosted runtime tests. Configure the binding before `listen()` starts the Worker dispatch boundary; once `listen()` has run, the binding identity is frozen for that adapter instance. Replacing or clearing it is rejected even after `close()`, so upgrade ownership cannot change underneath an isolate that has already crossed the public listen boundary.

```typescript
import { Module } from '@fluojs/core';
import {
  CloudflareWorkersWebSocketModule,
  WebSocketGateway,
} from '@fluojs/websockets/cloudflare-workers';

@WebSocketGateway({ path: '/ws' })
export class EdgeGateway {}

@Module({
  imports: [CloudflareWorkersWebSocketModule.forRoot()],
  providers: [EdgeGateway],
})
export class RealtimeModule {}
```

Import `RealtimeModule` into the application module graph before bootstrap. During application bootstrap, `CloudflareWorkersWebSocketModule` discovers the gateway and installs the Worker adapter binding through its versioned realtime capability before `app.listen()` freezes it; `configureWebSocketBinding()` remains a compatibility facade. Do not add or replace the binding after the listen boundary.

### Edge-Native Middleware
Standard fluo middleware (CORS, Global Prefix, etc.) is fully supported through Worker bootstrap helpers and optimized for the Cloudflare environment. `createCloudflareWorkerAdapter(...)` only accepts adapter-owned parsing and websocket-pair options; pass routing and middleware options to `bootstrapCloudflareWorkerApplication(...)` or `createCloudflareWorkerEntrypoint(...)` instead.

```typescript
const worker = createCloudflareWorkerEntrypoint(AppModule, {
  globalPrefix: 'api/v1',
  cors: true,
});
```

### Behavior Notes

- The public concrete `CloudflareWorkerHttpApplicationAdapter.fetch(request, env, executionContext)` contract requires the Worker `executionContext`; direct callers must pass the real third `ctx` argument so every HTTP, SSE, and WebSocket ingress registers active work with `executionContext.waitUntil(...)`. Migration: replace direct two-argument adapter calls with `adapter.fetch(request, env, ctx)`.
- `fetch()` registers active work with `executionContext.waitUntil(...)` after `listen()` or the lazy entrypoint binds the dispatcher; upgraded server WebSockets keep that lifecycle and the close drain open until their terminal `close` event, while SSE (`text/event-stream`) responses keep them open until the body finishes or is canceled. Synchronous SSE reader or tracked-stream setup failures release the lifecycle before propagating. Before that lifecycle boundary, upgrade requests and HTTP dispatch do not reach application handlers.
- Adapter options such as `maxBodySize` are validated when the Worker adapter is created; bootstrap-only options such as `globalPrefix`, `cors`, `middleware`, and `securityHeaders` belong on Worker bootstrap helpers rather than `createCloudflareWorkerAdapter(...)`.
- WebSocket upgrades are owned by the same listen boundary as HTTP dispatch; upgrade requests before `listen()` do not reach the configured binding, and attempts to replace or clear a defined binding after the adapter has ever listened fail fast instead of mutating Worker upgrade ownership. Create a new adapter when a host needs a different websocket binding.
- `close()` returns JSON `503` responses for new HTTP and WebSocket upgrade requests during and after shutdown and times out after 10 seconds if active requests never settle. Calling `listen()` while that close drain is still active rejects with the Cloudflare Workers adapter shutdown-draining error. Lazy entrypoints do not permanently cache that timeout once the adapter's underlying drain later finishes.
- The Worker `fetch(...)` dispatch path preserves body-bearing RFC `QUERY` routes and uppercase extension methods such as `PURGE`; their method token and parsed body reach the registered route through the same fetch dispatch seam.
- Multipart requests do not preserve `rawBody`.
- The Worker `env` object is attached to each `FrameworkRequest` as `request.cloudflare.env`, with the Worker execution context available as `request.cloudflare.executionContext`. `bootstrapCloudflareWorkerApplication(...)` completes module registration before its exported `fetch(...)` handles traffic. `createCloudflareWorkerEntrypoint(...)` keeps its predeclared root module and options, so its fetch-time `env` attaches only during request dispatch. `createCloudflareWorkerEnvEntrypoint(...)` is the opt-in alternative when the first explicit Worker environment must select the root module or final bootstrap options before module registration. Its `ready(env)` method requires that environment, caches the first environment's module and options once per isolate, and builds one application per application generation from that configuration. A successful close restarts the application without rerunning the factory or accepting later environments as bootstrap configuration. In either path, use request-bound `request.cloudflare.env` for bindings that are intentionally per-request.

## Lifecycle and Public Seam Notes

The root `@fluojs/platform-cloudflare-workers` export owns the Worker public seam for application code and first-party Worker websocket integrations. Worker-specific public types such as `CloudflareWorkerExecutionContext`, `CloudflareWorkerRequestContext`, `CloudflareWorkerWebSocketBinding`, `CloudflareWorkerWebSocketPair`, `CloudflareWorkerWebSocketPairFactory`, `CloudflareWorkerWebSocketUpgradeHost`, and `CloudflareWorkerWebSocketUpgradeResult` are exported from this package instead of asking consumers to import `@fluojs/http/internal` or `@fluojs/runtime/internal*` subpaths.

The listen, shutdown, SSE drain, and websocket binding rules above are public lifecycle behavior. Changes to those public seam types or lifecycle semantics are release-governed for `@fluojs/platform-cloudflare-workers`; user-impacting updates must be tracked with Changesets alongside the implementation, docs, and tests.

<!-- fluo-contract: realtime-capability -->
```json
{
  "closeOwnership": {
    "inFetchManagement": "wait-until",
    "outOfBand": "await",
    "restart": "restartable"
  },
  "realtimeCapability": {
    "bindingInstallationVersion": 1,
    "contract": "raw-websocket-expansion",
    "kind": "fetch-style",
    "mode": "request-upgrade",
    "support": "supported",
    "version": 1
  }
}
```

## Conformance Coverage

`packages/platform-cloudflare-workers/src/adapter.test.ts` and `packages/platform-cloudflare-workers/src/adapter-lifecycle.test.ts` are the package-local regression targets for the documented Worker contract. They cover shared Web dispatch delegation, Worker `env` request attachment, `executionContext.waitUntil(...)` SSE (`text/event-stream`) body tracking, body-cancellation and synchronous setup-failure drains, websocket upgrade binding, upgraded server-socket close tracking, pre-listen HTTP and websocket lifecycle guards, websocket binding freeze after the listen boundary, zero-config and env-aware lazy entrypoint reuse, explicit env-aware readiness, first-environment configuration retention across successful lazy restarts, timeout recovery, shutdown gating, drain-time `listen()` rejection, JSON `503` responses while closing and after close for both HTTP and websocket upgrades, reliable fake-timer cleanup, public seam source imports, the structured realtime capability contract, and the bounded 10-second close timeout.

The shared edge portability suite in `packages/testing/src/portability/web-runtime-adapter-portability.test.ts` exercises Cloudflare Workers beside Bun and Deno for conditional requests, single-byte ranges and `If-Range`, body-bearing `QUERY` and `PURGE` fetch dispatch, malformed cookie preservation, query decoding, JSON/text raw-body capture, multipart raw-body exclusion, and SSE framing. The package test parses the structured realtime capability contract in both README locales and compares its machine-consumed values with the adapter capability.

## Public API Overview

- `createCloudflareWorkerAdapter(options)`: Factory for the Worker HTTP adapter.
- `createCloudflareWorkerEntrypoint(module, options)`: Creates a lazy-bootstrapping Worker entrypoint.
- `createCloudflareWorkerEnvEntrypoint(factory)`: Creates a lazy Worker entrypoint from the first explicit Worker environment.
- `bootstrapCloudflareWorkerApplication(module, options)`: Async bootstrap helper for Workers.
- `CloudflareWorkerHttpApplicationAdapter`: The core adapter implementation.
- `CloudflareWorkerHandler`: Fetch handler interface shared by Worker application wrappers and lazy entrypoints.
- `CloudflareWorkerApplication`: Fully bootstrapped Worker application wrapper with `adapter`, `app`, `fetch(...)`, and `close(...)`.
- `CloudflareWorkerEntrypoint`: Lazy entrypoint with `fetch`, `ready()`, and `close()` lifecycle methods.
- `CloudflareWorkerEnvEntrypoint`: Env-aware lazy entrypoint with `fetch`, `ready(env)`, and `close()` lifecycle methods.
- Options and types: `CloudflareWorkerAdapterOptions`, `BootstrapCloudflareWorkerApplicationOptions`, `CloudflareWorkerEnvBootstrap`, `CloudflareWorkerEnvEntrypointFactory`, `CloudflareWorkerExecutionContext`, `CloudflareWorkerRequestContext`, `CloudflareWorkerWebSocketBinding`, `CloudflareWorkerWebSocketBindingHost`, `CloudflareWorkerWebSocket`, `CloudflareWorkerWebSocketMessage`, `CloudflareWorkerWebSocketPair`, `CloudflareWorkerWebSocketPairFactory`, `CloudflareWorkerWebSocketUpgradeHost`, and `CloudflareWorkerWebSocketUpgradeResult`.

## Related Packages

- `@fluojs/runtime`: Core framework runtime.
- `@fluojs/websockets`: Includes specific subpath `@fluojs/websockets/cloudflare-workers`.
- `@fluojs/http`: Shared HTTP decorators.

## Example Sources

- `packages/platform-cloudflare-workers/src/adapter.test.ts`
- `packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts`
