# @fluojs/platform-express

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Express-backed HTTP adapter for the fluo runtime.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Adapter Contract](#adapter-contract)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/platform-express express
```

## When to Use

Use this package when you want to run a fluo application using Express as the underlying HTTP engine. This is useful for leveraging Express's robust ecosystem, mature Node.js server handling, and familiar request/response lifecycle within the fluo decorator-based architecture.

## Quick Start

```typescript
import { createExpressAdapter } from '@fluojs/platform-express';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await fluoFactory.create(AppModule, {
  adapter: createExpressAdapter({ port: 3000 }),
});

await app.listen();
```

`createExpressAdapter()` defaults to port `3000` and does not read `process.env.PORT`; invalid explicit numeric options such as `port`, `maxBodySize`, `retryDelayMs`, `retryLimit`, and `shutdownTimeoutMs` throw during adapter setup. `maxBodySize` and `shutdownTimeoutMs` are non-negative integer byte/time limits, so `0` is valid: `maxBodySize: 0` allows only empty request bodies, and `shutdownTimeoutMs: 0` force-closes connections as soon as shutdown yields to the timer queue.

## Common Patterns

### Handling Streaming Responses (SSE)
The Express adapter supports Server-Sent Events (SSE) via the shared `SseResponse` utility, abstracting away the Express-specific stream handling.

Express-backed response streams also honor the shared fluo backpressure contract: `response.stream.waitForDrain()` settles on `drain`, `close`, or `error`, so streaming writers do not hang when clients disconnect before backpressure clears.

```typescript
@Get('events')
async streamEvents(@Res() res: FrameworkResponse) {
  const events = new SseResponse();
  events.send({ data: 'hello' });
  return events;
}
```

### Body Parsing and Multipart
`rawBody` preservation is opt-in (`rawBody: true`), and multipart requests do not expose `rawBody`. When you construct the adapter directly, pass multipart limits as the second argument. `bootstrapExpressApplication(...)` and `runExpressApplication(...)` accept the same multipart settings under `options.multipart`. When `multipart.maxTotalSize` is not set, `maxBodySize` becomes the default total multipart payload cap so body-size limits stay portable across HTTP adapters.

```typescript
const adapter = createExpressAdapter(
  {
    port: 3000,
    rawBody: true,
  },
  {
    maxTotalSize: 10 * 1024 * 1024,
  },
);
```

### Native Route Registration with Safe Fallback
The adapter pre-registers semantically safe Express Router handlers for explicit `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `HEAD` routes and still dispatches those requests through the shared fluo dispatcher.

For semantically safe unversioned routes, Express hands the pre-matched descriptor and params to the shared dispatcher so eligible singleton-safe handlers can complete on the dispatcher fast path and other handlers can fall back without duplicate route matching, while guards, interceptors, observers, body parsing, raw body capture, SSE, and error responses stay on the same framework-owned execution path.

If app middleware rewrites the framework request method or path after the adapter attaches a native handoff, the dispatcher treats that handoff as stale and rematches the rewritten request instead of reusing the original Express match.

To avoid changing documented fluo semantics, overlapping same-shape param routes such as `/:id` and `/:slug`, `@All(...)` handlers, `OPTIONS` ownership, non-URI versioning, and requests that rely on fluo's duplicate-slash/trailing-slash normalization stay on the catch-all fallback path.

## Adapter Contract

- **Shared dispatcher ownership**: Native Express Router matches still hand off to the shared fluo dispatcher, so middleware, guards, interceptors, observers, params, and error envelopes remain framework-defined.
- **Safe fallback scope**: `@All(...)` handlers and overlapping same-shape param routes intentionally stay on the catch-all fallback path instead of being force-registered through Express Router.
- **OPTIONS ownership parity**: The adapter prevents Express Router from auto-answering `OPTIONS` for native routes, so unsupported methods still fall through to fluo dispatcher semantics and `@All(...)` handlers can continue to own `OPTIONS` when defined.
- **Path normalization parity**: Requests that Express Router does not normalize the same way as fluo, such as duplicate-slash variants, still resolve through fallback dispatch so fluo's normalized route contract is preserved.
- **Versioning parity**: Header/media-type/custom version selection remains dispatcher-owned even when Express Router handles the initial path match.
- **Middleware rewrite parity**: App middleware that rewrites method or path invalidates native handoff and rematches the rewritten request.
- **Response serialization parity**: String responses default to `text/plain`, objects/arrays serialize as JSON, binary payloads default to `application/octet-stream`, and `set-cookie` values are merged.
- **Startup and shutdown**: The adapter supports HTTP/HTTPS startup, retries `EADDRINUSE` according to retry options, drains sockets on close, and can force-close connections after shutdown timeout, including immediate force-close when `shutdownTimeoutMs` is `0`.

## Public API Overview

- `createExpressAdapter(options)`: Factory for the Express HTTP adapter.
- `bootstrapExpressApplication(module, options)`: Advanced bootstrap helper for manual control.
- `runExpressApplication(module, options)`: Compatibility helper for quick startup with signal wiring. On timeout/failure it reports the condition through logging and `process.exitCode`, while leaving final process termination to the surrounding host.
- `isExpressMultipartTooLargeError(error)`: Normalizes multipart limit detection across adapter error shapes.
- `ExpressHttpApplicationAdapter`: The core adapter implementation class.
- Option types: `ExpressAdapterOptions`, `BootstrapExpressApplicationOptions`, `RunExpressApplicationOptions`, `CorsInput`, `ExpressApplicationSignal`.

`createExpressAdapter(options, multipartOptions?)` supports `host`, `https`, `maxBodySize`, `port`, `rawBody`, `retryDelayMs`, `retryLimit`, and `shutdownTimeoutMs`. Direct `ExpressHttpApplicationAdapter` construction applies the same numeric validation as the factory. `bootstrapExpressApplication(...)` and `runExpressApplication(...)` also accept `cors`, `globalPrefix`, `globalPrefixExclude`, `logger`, `middleware`, `multipart`, `securityHeaders`, `forceExitTimeoutMs`, and `shutdownSignals`.

## Related Packages

- `@fluojs/runtime`: Core framework runtime.
- `@fluojs/platform-fastify`: Alternative high-performance adapter.
- `@fluojs/websockets`: Real-time gateway support for Express.

## Example Sources

- `packages/platform-express/src/adapter.test.ts`
- `examples/minimal/src/main.ts` (Fastify-based, but demonstrates the shared `fluoFactory` pattern)
