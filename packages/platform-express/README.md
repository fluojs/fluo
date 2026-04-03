# @konekti/platform-express

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Express-backed HTTP adapter for Konekti runtime applications.

## See also

- `../runtime/README.md`
- `../../docs/concepts/http-runtime.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/concepts/observability.md`
- `../../docs/reference/package-chooser.md`
- `../../docs/reference/package-surface.md`

## Installation

```bash
npm install @konekti/platform-express express
```

## Quick Start

```typescript
import { createExpressAdapter } from '@konekti/platform-express';
import { KonektiFactory } from '@konekti/runtime';

const app = await KonektiFactory.create(AppModule, {
  adapter: createExpressAdapter({ port: 3000 }),
});

await app.listen();
```

## API

- `createExpressAdapter(options)` - create an Express `HttpApplicationAdapter`
- `bootstrapExpressApplication(rootModule, options)` - advanced bootstrap helper without implicit shutdown signal wiring
- `runExpressApplication(rootModule, options)` - compatibility helper for bootstrap + listen + startup logging + shutdown signal wiring

### Supported options

`createExpressAdapter()`, `runExpressApplication()`, and `bootstrapExpressApplication()` all remain supported. New application startup examples should prefer `KonektiFactory.create(..., { adapter: createExpressAdapter(...) })` so the public startup story stays centered on the runtime facade.

`runExpressApplication()` and `bootstrapExpressApplication()` support the same runtime option shapes as `runNodeApplication()` for:

- `rawBody`
- `multipart`
- `https`
- `host`
- `cors` (`false | string | string[] | CorsOptions`)
- `shutdownTimeoutMs`

`runExpressApplication()` also supports:

- `shutdownSignals`
- `forceExitTimeoutMs`

## supported operations

- Bridges Express requests and responses into `FrameworkRequest` / `FrameworkResponse`.
- Dispatches every incoming request through the Konekti HTTP dispatcher.
- Supports `rawBody` opt-in for non-multipart requests.
- Supports multipart form-data parsing and exposes uploaded files as `UploadedFile[]`.
- Supports startup retry (`EADDRINUSE`) and HTTPS listener options.

## runtime invariants

- `rawBody` is never populated for multipart requests.
- If the dispatcher does not commit a response, the adapter sends an empty payload to finalize the response.
- Startup logs follow runtime conventions (`Listening on ...`) and include bind-target detail for wildcard hosts.
- Response serialization behavior mirrors runtime/fastify adapter expectations for string, JSON, and binary payloads.

## lifecycle guarantees

- `close(signal?)` performs graceful shutdown and enforces `shutdownTimeoutMs`.
- Signal-driven shutdown (`SIGINT` / `SIGTERM` by default) is supported through `runExpressApplication()`.
- `forceExitTimeoutMs` can terminate the process when shutdown does not complete in time.

## intentional limitations

- This adapter does not replace `@konekti/runtime`; runtime bootstrap, lifecycle, DI, and shutdown ownership stay in the runtime package.
- No Express plugin/middleware passthrough layer is provided; middleware/guards/interceptors run through Konekti dispatcher contracts.
- No standalone Express mode; this adapter is designed for runtime-managed startup.
- No WebSocket upgrade handling in this package.
