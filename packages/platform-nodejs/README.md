# @fluojs/platform-nodejs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Raw Node.js HTTP adapter package for the fluo runtime.

Preparing for the coordinated Node 24 release? Follow the [consumer migration guide](../../docs/getting-started/migrate-node24.md) before upgrading packages.

## Table of Contents

- [Installation](#installation)
- [Runtime Node Import Migration](#runtime-node-import-migration)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Behavioral Contracts](#behavioral-contracts)
- [Conformance Coverage](#conformance-coverage)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/platform-nodejs
```

This package targets Node.js `>=24.0.0 <27` and declares that exact `engines.node` range. The Node 24 LTS floor is a support-policy decision; listener-level RFC `QUERY` remains verified on the supported runtimes. The package owns the Node listener, filesystem, logger, compression, and process-signal implementations used by raw Node, Express, and Fastify hosts.

## Runtime Node Import Migration

The former mixed-runtime entrypoints have no compatibility shim. Update imports directly, then apply the adapter-creation migration below:

| Removed import | Replacement |
| :--- | :--- |
| `@fluojs/runtime/node` | `@fluojs/platform-nodejs` |
| `@fluojs/runtime/internal-node` | `@fluojs/platform-nodejs/internal` |

Adapter creation is consolidated in `NodeHttpApplicationAdapter.create(options)`. Follow the [Node adapter creation migration](../../docs/getting-started/migrate-node-adapter-create.md) for both removed factories and type aliases. The `NodeHttpApplicationAdapter` class and public positional constructor remain. Bootstrap/run helpers and Nodejs aliases are removed; logger, shutdown registration, and filesystem utilities remain.

## When to Use

Use this package when you want to run a fluo application directly on the Node.js built-in `http` or `https` modules without the overhead of an intermediate framework like Express or Fastify. It is ideal for minimal footprints, custom low-level optimizations, or environments where standard Node APIs are preferred.

## Quick Start

```typescript
import { NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await FluoFactory.create(AppModule, {
  adapter: NodeHttpApplicationAdapter.create({ port: 3000 }),
});

await app.listen();
```

## Common Patterns

### Early Hints

Raw Node responses expose `context.response.earlyHints`. Check that optional capability, then await `write(...)` once per HTTP `103`; multiple writes are supported. Each write requires a non-empty `link` value and may include other Node-permitted informational fields. The native write does not commit the final response or copy early fields into final headers. Late/native failures reject with `EarlyHintsWriteError`, and a disconnect before settlement rejects with `RequestAbortedError`.

### Customizing Server Options
The adapter exposes the documented Node.js transport options: host/port binding, plain HTTP or HTTPS construction configuration, request body limits, raw-body preservation, listen retry settings, and shutdown drain bounds.

```typescript
const adapter = NodeHttpApplicationAdapter.create({
  port: 3000,
  http: {
    maxHeaderSize: 16_384,
    joinDuplicateHeaders: true,
  },
  maxBodySize: 1_048_576,
  compression: true,
  multipart: { maxTotalSize: 2_097_152 },
});
```

`http` accepts Node's `node:http` `ServerOptions` and passes them to `createServer(options, handler)` before the listener starts. Use it for construction-time settings such as `maxHeaderSize`, `insecureHTTPParser`, `joinDuplicateHeaders`, or `highWaterMark`. For TLS, provide `https` with Node's HTTPS server options instead. `http` and `https` are mutually exclusive; supplying both throws before the adapter creates a server, so no option is silently ignored.

`maxBodySize` accepts a byte count number. It is enforced while the raw Node request body is still streaming, and the same limit becomes the default total multipart payload cap unless you override `multipart.maxTotalSize` in the same adapter options object.

`NodeHttpApplicationAdapter.create()` defaults to port `3000`, ignores `process.env.PORT`, and throws when `port`, `maxBodySize`, `retryDelayMs`, `retryLimit`, or adapter-level `shutdownTimeoutMs` are invalid. The default request body cap is `1 MiB`.

Defaults are `compression: false`, `rawBody: false`, `retryDelayMs: 150`, `retryLimit: 20`, and `shutdownTimeoutMs: 10_000`. Node chooses the bind address when `host` is omitted. Multipart defaults to buffered parsing, and omitted `multipart.maxTotalSize` inherits the effective `maxBodySize` (`1_048_576` bytes when both are omitted). Explicit `0` is preserved. Even with compression enabled, range responses retain identity representation bytes and range metadata without recompression.

### Direct Application Execution
Creation neither binds the port nor registers process signals.

Create through `FluoFactory.create(AppModule, { adapter })` and start through `app.listen()`. The Node logger and shutdown callback below are explicit selections at this host boundary.

```typescript
import { FluoFactory } from '@fluojs/runtime';
import { NodeHttpApplicationAdapter, createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { AppModule } from './app.module';

const app = await FluoFactory.create(AppModule, {
  adapter: NodeHttpApplicationAdapter.create({
    port: 3000,
    shutdownTimeoutMs: 10_000,
  }),
  globalPrefix: 'api',
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(['SIGINT', 'SIGTERM']),
});
await app.listen();
```

To configure before listening, create through the same Factory, finish configuration, then call `app.listen()`. Omitting the signal callback leaves `app.close()` with the host.

```typescript
import { FluoFactory } from '@fluojs/runtime';
import { createConsoleApplicationLogger, NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
const app = await FluoFactory.create(AppModule, {
  adapter: NodeHttpApplicationAdapter.create({
    port: 3000,
  }),
  logger: createConsoleApplicationLogger(),
});
await app.listen();

// When the host requests shutdown:
await app.close();
```

Create the adapter with `NodeHttpApplicationAdapter.create(options)`, create the app with `FluoFactory.create(...)`, then call `app.listen()`. Explicitly select the Node console logger and `createNodeShutdownSignalRegistration()` callback. Signal shutdown timeout or failure is reported through logs and `process.exitCode`; the host owns final process termination. Adapter `shutdownTimeoutMs` is the separate connection-drain bound.

## Behavioral Contracts

- `NodeHttpApplicationAdapter.create(options)` is the adapter-first entrypoint for running fluo directly on Node's built-in `http` or `https` server primitives.
- `http` accepts Node `node:http` `ServerOptions` for plain HTTP server construction, while `https` keeps its existing TLS construction options; callers must supply at most one of those fields.
- `maxBodySize` accepts a non-negative integer byte count, is enforced while raw Node request bytes are still streaming, and becomes the default multipart total-size cap unless `multipart.maxTotalSize` is explicitly provided in the adapter options object.
- The raw Node adapter normalizes mixed-case JSON and multipart `content-type` values, returns `413` when request bodies exceed `maxBodySize`, propagates `x-request-id` with `x-correlation-id` fallback into the request context and error responses, and exposes a server-backed realtime capability through `getServer()` / `getRealtimeCapability()`.
- Supported Node logger, shutdown, filesystem, and raw adapter helpers live on the package root; lower-level request/response/compression plumbing lives on `@fluojs/platform-nodejs/internal`.

## Conformance Coverage

`packages/platform-nodejs/src/adapter-create.test.ts`, `packages/platform-nodejs/src/published-declaration-surface.test.ts`, `packages/platform-nodejs/src/index.test.ts`, `packages/platform-nodejs/src/lifecycle.test.ts`, and `packages/platform-nodejs/src/lifecycle.integration.test.ts` are the package-local regression targets for the documented Node.js contract. The adapter portability suite runs the shared `HttpAdapterPortabilityHarness.create(...)` checks for malformed cookie preservation, JSON/text raw-body capture, byte-exact raw-body capture, single byte-range status/header/body semantics, multipart raw-body exclusion, multipart total-size defaults, SSE framing, response stream drain settlement, host and HTTPS startup logging, and shutdown signal listener cleanup.

This package exposes an `HttpApplicationAdapter`; it is not a runtime-managed `PlatformComponent` registered under `platform.components`. Therefore the generic `PlatformConformanceHarness.create(...)` component lifecycle checks are outside this package's supported contract, while `HttpAdapterPortabilityHarness.create(...)` is the applicable shared harness.

The same regression targets also cover the package-specific public surface, canonical static creation, adapter-first startup, plain HTTP construction options and their HTTPS conflict boundary, lifecycle option validation, observed listen retries, active-request bounded drain, normal and failed signal-driven shutdown, `process.env.PORT` isolation, zero and default `maxBodySize` boundaries, idle keep-alive shutdown, mixed-case JSON and multipart content-type parsing, `x-correlation-id` request ID fallback, and server-backed realtime capability exposure. Keep README example pointers aligned with those test files and the Node.js chapter examples below when changing startup behavior.

## Public API Overview

- `NodeHttpApplicationAdapter.create(options)`: Primary factory for the raw Node.js HTTP adapter.
- `NodeHttpAdapterOptions`: Transport-level options for `NodeHttpApplicationAdapter.create(...)`, including `compression`, `multipart`, `port`, `host`, mutually exclusive `http` or `https` construction options, `maxBodySize`, retry settings, raw body preservation, and shutdown timeout.
- `app.listen()` retries honor `retryLimit`/`retryDelayMs`. Adapter close stops idle keep-alive connections before bounded drain.
- `NodeShutdownSignal`: The `SIGINT` and `SIGTERM` names accepted by the Node shutdown callback.
- `NodeHttpApplicationAdapter`: The concrete `create(...)` return type and existing DI class token. `instanceof`, inheritance, the public positional constructor, and instance `listen`/`close` remain supported.
- Node logger, signal registration, and filesystem exports remain. Bootstrap/run exports, duplicate adapter factories, and their type aliases are removed; follow the migration guide.
- `@fluojs/platform-nodejs/internal`: First-party Node adapter integration seam replacing `@fluojs/runtime/internal-node`; it includes lower-level compression and request/response helpers.

## Multipart streaming

`multipart` remains adapter-owned; Factory itself has no `multipart` option.

Set `multipart: { strategy: 'stream' }` in `NodeHttpApplicationAdapter.create(...)` to expose multipart parts through `RequestContext.request.body` as an `AsyncIterable`. The Node listener creates the iterator without pre-reading or buffering it; consuming a file part pulls its bytes on demand. Buffered multipart parsing remains the default, exposes fields and `request.files`, and cannot be combined with stream consumption for the same request body.

Runtime route dispatch owns an iterator created for a route and automatically calls `return()` after the handler finishes, cancelling and releasing an active source. Standalone `parseMultipartStream(...)` consumers own that responsibility: consume the iterator to completion or call `return()` when ending early.

## Related Packages

- `@fluojs/runtime`: The core runtime facade.
- `@fluojs/websockets`: Real-time gateway support.
- `@fluojs/http`: Shared HTTP abstractions and decorators.

## Example Sources

- `packages/platform-nodejs/src/index.test.ts`
- `packages/platform-nodejs/src/lifecycle.test.ts`
- `packages/platform-nodejs/src/lifecycle.integration.test.ts`
- `book/intermediate/ch21-express-node.md`

`createNodeShutdownSignalRegistration(...)` rolls back partially installed handlers on registration failure and attempts every removal after an individual failure. Factory close retains unregistration failure for concurrent/later callers without skipping runtime cleanup; `factory-signals.test.ts` covers this boundary. New apps use the Factory recipe above and the [migration guide](../../docs/getting-started/migrate-http-factory.md).
