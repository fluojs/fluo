# @fluojs/platform-fastify

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Fastify-backed HTTP adapter for the fluo runtime.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Performance](#performance)
- [Public API Overview](#public-api-overview)
- [Troubleshooting](#troubleshooting)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/platform-fastify fastify
```

## When to Use

Use this package when you need a high-performance HTTP adapter for your fluo application. Fastify is known for its low overhead and efficient request handling, making it the recommended choice for production fluo applications requiring high throughput and concurrency.

## Quick Start

```typescript
import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await fluoFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});

await app.listen();
```

## Common Patterns

### Multipart and Raw Body
The Fastify adapter includes built-in support for multipart form-data and raw body parsing via internal Fastify plugins, exposed through the standard fluo request interface. When `rawBody: true` is enabled, `FrameworkRequest.rawBody` preserves the original request bytes for non-multipart requests so webhook signature verification and other byte-sensitive flows can replay the exact payload. When you construct the adapter directly, pass multipart limits as the second argument. `bootstrapFastifyApplication(...)` and `runFastifyApplication(...)` accept the same multipart settings under `options.multipart`.

```typescript
const adapter = createFastifyAdapter(
  {
    port: 3000,
    rawBody: true,
  },
  {
    maxTotalSize: 10 * 1024 * 1024,
  },
);
```

### Server-Backed Real-Time
Fastify provides a `server-backed` capability that allows `@fluojs/websockets` to attach directly to the underlying Node.js HTTP server.

```typescript
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

### Streaming Responses
Fastify-backed response streams support the shared fluo stream contract used by SSE and other streaming writers. `response.stream.waitForDrain()` settles when the underlying response emits `drain`, `close`, or `error`, so writers do not hang when a client disconnects or the stream closes before backpressure clears.

### CORS Configuration
CORS is handled via bootstrap options. fluo manages the underlying CORS logic rather than relying on a separate Fastify plugin.

```typescript
// Simple origin string
await bootstrapFastifyApplication(AppModule, {
  cors: 'https://my-frontend.com',
  port: 3000,
});

// Fine-grained control
await bootstrapFastifyApplication(AppModule, {
  cors: {
    origin: ['https://a.com', 'https://b.com'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
  port: 3000,
});

// Explicitly disabled
await bootstrapFastifyApplication(AppModule, {
  cors: false,
  port: 3000,
});
```

### Global Prefix
Configure a global routing prefix and exclude specific paths like health checks.

```typescript
await bootstrapFastifyApplication(AppModule, {
  globalPrefix: '/api',
  globalPrefixExclude: ['/health'],
  port: 3000,
});
```

### Logging
fluo uses its own logging system. The adapter creates the Fastify instance with its native logger disabled and pipes through the fluo logger provided in the bootstrap options.

```typescript
await runFastifyApplication(AppModule, {
  logger: myLogger,
  port: 3000,
});
```

### Middleware
You can register runtime-level middleware that runs before the request reaches the handlers. Note that these are standard `MiddlewareLike` functions, not Fastify-specific plugins.

```typescript
await bootstrapFastifyApplication(AppModule, {
  middleware: [myCustomMiddleware],
  port: 3000,
});
```

### Native Route Registration with Safe Fallback
When fluo route metadata can be translated directly, the adapter registers Fastify-native per-route handlers instead of sending every request through a single wildcard route. For semantically safe unversioned routes, those native handlers hand a pre-matched descriptor and params to the shared fluo dispatcher so duplicate route matching is skipped without changing framework-owned guards, interceptors, observers, SSE, multipart, raw body, streaming, or error handling.

When multiple routes share the same method and normalized param shape (for example `/:id` and `/:slug`), use `@All(...)`, depend on non-URI versioning, or arrive through duplicate-slash / trailing-slash variants, the adapter intentionally leaves those requests on the wildcard fallback path so Fastify registration cannot boot-fail or narrow fluo's matching semantics. If app middleware rewrites the framework request method or path after a native handoff was attached, the dispatcher ignores that stale handoff and rematches the rewritten request.

The adapter keeps a wildcard fallback route for unmatched paths and portability-sensitive cases, and enables Fastify trailing-slash / duplicate-slash normalization so native selection stays aligned with fluo's documented route path contract. CORS handling remains owned by fluo's shared middleware path rather than Fastify plugins, and unsupported methods such as `OPTIONS` continue through the fallback dispatcher path unless a fluo route explicitly owns them.

## Performance

fluo's Fastify adapter significantly outperforms the raw Node.js adapter in high-concurrency scenarios.

| Adapter | Requests/sec | Avg Latency |
| --- | ---: | ---: |
| Raw Node.js Adapter | ~31,000 | 4.0ms |
| Fastify Adapter | **~58,000** | **2.1ms** |

*Measured using `wrk` on a standard `/health` endpoint.*

## Public API Overview

- `createFastifyAdapter(options)`: Recommended factory for the Fastify adapter.
- `bootstrapFastifyApplication(module, options)`: advanced bootstrap without implicit listening.
- `runFastifyApplication(module, options)`: Quick-start helper with lifecycle management. On timeout/failure it reports the condition through logging and `process.exitCode`, while leaving final process termination to the surrounding host.
- `FastifyHttpApplicationAdapter`: The core adapter implementation.

## Troubleshooting

- **CORS Errors**: Ensure you're using the `cors` bootstrap option. Since Fastify's native CORS plugin is not registered, only the fluo-managed CORS logic applies.
- **Middleware Issues**: The `middleware` option accepts runtime-level `MiddlewareLike[]` functions. These are not Fastify plugins and follow the standard middleware interface used across fluo adapters.
- **Logging**: The native Fastify logger is disabled to prevent duplicate log streams. All logging should be configured via the fluo `logger` option in `runFastifyApplication` or `bootstrapFastifyApplication`.
- **Global Prefix**: Use `globalPrefixExclude` to prevent the prefix from being applied to internal routes or health check endpoints.

## Related Packages

- `@fluojs/runtime`: Core framework runtime.
- `@fluojs/platform-express`: Alternative Express-based adapter.
- `@fluojs/websockets`: Real-time gateway support.

## Example Sources

- `packages/platform-fastify/src/adapter.test.ts`
- `examples/minimal/src/main.ts`
- `examples/realworld-api/src/main.ts`
