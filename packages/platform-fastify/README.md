# @fluojs/platform-fastify

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Fastify-backed HTTP adapter for the fluo runtime.

## Table of Contents

- [Installation](#installation)
- [Runtime Requirements](#runtime-requirements)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Performance](#performance)
- [Conformance Coverage](#conformance-coverage)
- [Public API Overview](#public-api-overview)
- [Troubleshooting](#troubleshooting)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/platform-fastify
```

`fastify`, `@fastify/multipart`, and raw-body support are bundled as runtime dependencies of this adapter package, so application projects do not need a separate `fastify` dependency unless they use Fastify APIs directly outside fluo.

## Runtime Requirements

`@fluojs/platform-fastify` is a Node.js HTTP adapter and declares `engines.node >=20.19.3 <21 || >=22.2.0 <27`. Run local development, CI, containers, and production hosts on a version in that exact range when this package owns the HTTP server so listener-level RFC `QUERY` requests reach Fastify wildcard fallback and fluo dispatch. Node 21, Node 22 before 22.2.0, and unverified Node 27+ are excluded. Use `@fluojs/platform-bun`, `@fluojs/platform-deno`, or `@fluojs/platform-cloudflare-workers` for non-Node runtimes instead of importing this Node-specific adapter.

The adapter owns a Fastify-backed Node `http` or `https` listener. Keep process-specific values such as ports, certificate material, and hostnames at the application boundary, then pass the final options into the adapter explicitly.

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

`createFastifyAdapter()` defaults to port `3000` and does not read `process.env.PORT`; invalid explicit numeric options such as `port`, `maxBodySize`, `retryDelayMs`, `retryLimit`, and `shutdownTimeoutMs` throw during adapter setup. `maxBodySize` and `shutdownTimeoutMs` are non-negative integer byte/time limits, so `0` is valid: `maxBodySize: 0` allows only empty request bodies, and `shutdownTimeoutMs: 0` starts Fastify close immediately. The zero value bounds only the wait: if close has not settled, the wait may time out on the next timer turn while the underlying Fastify close and cleanup continue.

## Common Patterns

### Early Hints

Fastify responses expose the optional `context.response.earlyHints` capability through `reply.raw`. Await one `write(...)` per `103`; multiple informational responses precede the independently configured final response. Early fields never populate Fastify final headers or mark the Fluo facade committed. Late/native failures and client disconnects reject deterministically.

### Byte Ranges and Cache Validation

Fastify preserves the shared `@fluojs/http` single-byte-range and `If-Range` contract. After conditional-request evaluation selects cache validators, a valid `Range: bytes=` request yields the portable `206` identity-byte response; `If-Range` reuses those selected validators, while malformed or multi-range fields retain the full response and an unsatisfiable range yields bodyless `416`. `HEAD` mirrors GET metadata without consuming a stream.

### HTTPS/TLS Startup
When the Fastify process owns TLS directly, pass Node.js `https.ServerOptions` through the `https` option on `createFastifyAdapter(...)`, `bootstrapFastifyApplication(...)`, or `runFastifyApplication(...)`. The adapter starts Fastify with an HTTPS listener, and startup logs report the `https://host:port` URL.

```typescript
const app = await fluoFactory.create(AppModule, {
  adapter: createFastifyAdapter({
    host: '0.0.0.0',
    port: 3443,
    https: {
      cert: tlsCertificate,
      key: tlsPrivateKey,
    },
  }),
});

await app.listen();
```

Load certificates from your application configuration or secret-management boundary before constructing the adapter; the package does not read certificate files, `process.env`, or `PORT` by itself. If a load balancer, ingress, or API gateway terminates TLS, leave `https` unset and run the Fastify adapter as plain HTTP behind that infrastructure.

`bootstrapFastifyApplication(...)` and `runFastifyApplication(...)` accept the same `https`, `host`, and `port` options. `runFastifyApplication(...)` starts listening before it resolves, installs shutdown registration, and returns the running application shell:

```typescript
const app = await runFastifyApplication(AppModule, {
  host: '127.0.0.1',
  https: {
    cert: tlsCertificate,
    key: tlsPrivateKey,
  },
  port: 3443,
});
```

### Multipart and Raw Body
The Fastify adapter includes built-in support for multipart form-data and raw body parsing via internal Fastify plugins, exposed through the standard fluo request interface. Multipart files are attached to the runtime-neutral `FrameworkRequest.files` seam as adapter-provided values; Fastify requests populate it with fluo `UploadedFile` objects after body materialization. When `rawBody: true` is enabled, `FrameworkRequest.rawBody` preserves the original request bytes for non-multipart requests so webhook signature verification and other byte-sensitive flows can replay the exact payload. When you construct the adapter directly, pass multipart limits as the second argument. `bootstrapFastifyApplication(...)` and `runFastifyApplication(...)` accept the same multipart settings under `options.multipart`.

Raw-body capture is skipped for multipart requests, including mixed-case `Content-Type` media values such as `Multipart/Form-Data`. When `multipart.maxTotalSize` is omitted, it defaults to `maxBodySize` so size limits stay portable across HTTP adapters.

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
fluo uses its own logging system. The adapter creates the Fastify instance with its native logger disabled, and `bootstrapFastifyApplication(...)` / `runFastifyApplication(...)` select the framework console logger by default so startup and shutdown diagnostics stay consistent with the active runtime. Pass `logger` when a test harness or host application needs to capture those diagnostics through an injected `ApplicationLogger` instead of the default console logger.

### Middleware
You can register runtime-level middleware that runs before the request reaches the handlers. Note that these are standard `MiddlewareLike` functions, not Fastify-specific plugins.

```typescript
await bootstrapFastifyApplication(AppModule, {
  middleware: [myCustomMiddleware],
  port: 3000,
});
```

### Native Fastify Configuration
Use portable fluo middleware by default. When a migration must retain a Fastify-native plugin, hook, or instance customization, configure it through the construction-time `configureFastify` seam:

```typescript
const adapter = createFastifyAdapter({
  configureFastify: async (fastify) => {
    fastify.addHook('onRequest', async (request, reply) => {
      reply.header('x-native-request-id', request.id);
    });
    fastify.setReplySerializer((payload) => JSON.stringify(payload) ?? '');
  },
  port: 3000,
});
```

`configureFastify` runs once for each Fastify instance that the adapter creates, before fluo registers its multipart, raw-body, native-route, and wildcard-route handling. `bootstrapFastifyApplication(...)` and `runFastifyApplication(...)` accept the same option. A thrown or rejected configuration prevents that `listen()` call from starting; the failed instance is not configured again, while a later `listen()` after a successful `close()` configures the newly created instance once. Although this seam can call `setReplySerializer(...)`, the adapter serializes fluo response payloads before handing them to Fastify, so an instance serializer does not customize fluo responses.

The adapter continues to own routing, CORS, logging, multipart and raw-body behavior, response semantics, and shutdown. Do not retain or mutate the Fastify instance after bootstrap, adopt an existing Fastify instance, or use this hook as a native-route bypass. Move portable request behavior to fluo `middleware` instead.

### Native Route Registration with Safe Fallback
When fluo route metadata can be translated directly, the adapter registers Fastify-native per-route handlers for explicit `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `HEAD` routes instead of sending every request through a single wildcard route. For semantically safe unversioned routes, those native handlers hand a pre-matched descriptor and params to the shared fluo dispatcher so duplicate route matching is skipped without changing framework-owned guards, interceptors, observers, SSE, multipart, raw body, streaming, or error handling.

When multiple routes share the same method and normalized param shape (for example `/:id` and `/:slug`), use `@All(...)`, depend on non-URI versioning, or arrive through duplicate-slash / trailing-slash variants, the adapter intentionally leaves those requests on the wildcard fallback path so Fastify registration cannot boot-fail or narrow fluo's matching semantics. If app middleware rewrites the framework request method or path after a native handoff was attached, the dispatcher ignores that stale handoff and rematches the rewritten request.

Validated custom methods such as `QUERY` and `PURGE` also stay on wildcard fallback dispatch instead of receiving native fluo route handoffs. Fastify must know a method name before its wildcard route can accept that request, so the adapter registers descriptor custom methods with Fastify as body-bearing methods while still leaving route selection to fluo. `ALL` is never registered as a wire method, and `CONNECT` remains outside ordinary controller routing conformance.

The adapter keeps a wildcard fallback route for unmatched paths and portability-sensitive cases, including multipart requests that must preserve the shared body/materialization path, and enables Fastify trailing-slash / duplicate-slash normalization so native selection stays aligned with fluo's documented route path contract. CORS handling remains owned by fluo's shared middleware path rather than Fastify plugins, and unsupported methods such as `OPTIONS` continue through the fallback dispatcher path unless a fluo route explicitly owns them.

Concurrent `listen()` calls share one startup promise and preserve the dispatcher from the first call. After startup, repeated `listen()` calls are no-ops that keep the live listener and dispatcher unchanged. A `listen()` call made while `close()` is in flight waits for shutdown to settle, starts a fresh listener, and resolves only after that listener is ready. Calling `close()` while startup is retrying a busy port cancels the retry loop and waits for it to settle before reporting shutdown completion, so a closed adapter cannot bind later after the caller believes shutdown finished. If an adapter instance is listened again after close, native route handlers refresh their dispatcher descriptors before serving traffic so request handoff metadata cannot point at a previous application graph.

## Performance

fluo's Fastify adapter significantly outperforms the raw Node.js adapter in high-concurrency scenarios.

| Adapter | Requests/sec | Avg Latency |
| --- | ---: | ---: |
| Raw Node.js Adapter | ~31,000 | 4.0ms |
| Fastify Adapter | **~58,000** | **2.1ms** |

*Measured using `wrk` on a standard `/health` endpoint.*

## Conformance Coverage

`packages/platform-fastify/src/adapter.test.ts` is the package-local regression target for the documented Fastify adapter contract. It runs the shared `createHttpAdapterPortabilityHarness(...)` checks for conditional requests, single-byte ranges and `If-Range`, custom `QUERY`/extension-method fallback, malformed cookie preservation, JSON/text raw-body capture, byte-exact raw-body capture, multipart raw-body exclusion, multipart total-size defaults, SSE framing, response stream drain settlement, host and HTTPS startup logging, and shutdown signal listener cleanup.

The same file also covers Fastify-specific native route registration with wildcard fallback, duplicate shape route fallback, concurrent and repeated `listen()` idempotency, startup retry cancellation during shutdown, native descriptor refresh on adapter reuse, explicit `OPTIONS` route ownership, middleware/guard/interceptor/observer ordering, CORS ownership, global prefix behavior, malformed cookie preservation, response serialization parity, raw-body pre-parsing behavior, zero-valued body/shutdown limits, close wait timeouts that leave the underlying Fastify close in flight, case-insensitive multipart detection, and multipart limit handling. Keep README example pointers aligned with that test file and the custom adapter book chapter when changing startup, routing, or adapter portability behavior.

## Public API Overview

- `createFastifyAdapter(options, multipartOptions?)`: Recommended factory for the Fastify adapter. `options` includes transport startup knobs such as `host`, `port`, and Node.js `https` server options. The optional second argument configures multipart limits such as `maxFileSize`, `maxFiles`, and `maxTotalSize` for direct adapter construction.
- `bootstrapFastifyApplication(module, options)`: advanced bootstrap without implicit listening; accepts the same Fastify startup options, including `https`, when the host wants to construct the app before binding it.
- `runFastifyApplication(module, options)`: Bootstraps the application, starts listening, installs shutdown registration, and returns the running shell with the same `https` startup surface. On signal-driven shutdown timeout/failure it reports the condition through logging and `process.exitCode`, while leaving final process termination to the surrounding host.
- `isFastifyMultipartTooLargeError(error)`: Detects multipart limit errors across Fastify error shapes.
- `FastifyHttpApplicationAdapter`: The core adapter implementation.
- Option types: `FastifyAdapterOptions`, `BootstrapFastifyApplicationOptions`, `RunFastifyApplicationOptions`, `CorsInput`, `FastifyApplicationSignal`.

## Troubleshooting

- **CORS Errors**: Ensure you're using the `cors` bootstrap option. Since Fastify's native CORS plugin is not registered, only the fluo-managed CORS logic applies.
- **Middleware Issues**: The `middleware` option accepts runtime-level `MiddlewareLike[]` functions. These are not Fastify plugins and follow the standard middleware interface used across fluo adapters.
- **Logging**: The native Fastify logger is disabled to prevent duplicate log streams. `runFastifyApplication` and `bootstrapFastifyApplication` select the framework console logger by default and accept `logger` for hosts or tests that need an injected `ApplicationLogger`.
- **Global Prefix**: Use `globalPrefixExclude` to prevent the prefix from being applied to internal routes or health check endpoints.
- **Malformed Cookies**: Malformed cookie headers are preserved rather than failing the request.
- **HTTPS startup**: Use Node.js `>=20.19.3 <21 || >=22.2.0 <27` and pass certificate material under the adapter `https` option when the Fastify process owns TLS. If TLS is terminated by infrastructure, keep the adapter on plain HTTP behind that boundary.
- **Startup and shutdown failures**: When startup and Fastify `onClose` both fail, callers receive the original startup rejection with the close failure in `cause` only when `cause` can be read, written, and read back. Otherwise, callers receive a startup-first `AggregateError` whose `errors[0]` is the startup rejection and whose `errors[1]` is the close failure.

## Multipart streaming

Set `multipart: { strategy: 'stream' }` when bootstrapping Fastify to expose multipart parts through `RequestContext.request.body` as an `AsyncIterable`. Fastify creates the iterator without pre-reading or buffering it; consuming a file part pulls its bytes on demand. In this mode file parts are not materialized as `UploadedFile` values in `request.files`. Buffered multipart parsing remains the default and cannot be combined with stream consumption for the same request body.

## Related Packages

- `@fluojs/runtime`: Core framework runtime.
- `@fluojs/platform-express`: Alternative Express-based adapter.
- `@fluojs/websockets`: Real-time gateway support.

## Example Sources

- `packages/platform-fastify/src/adapter.test.ts`
- `examples/minimal/src/main.ts`
- `examples/realworld-api/src/main.ts`
