# @konekti/platform-nodejs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Raw Node.js HTTP adapter package for Konekti runtime applications.

## See also

- `../runtime/README.md`
- `../../docs/concepts/http-runtime.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/reference/package-chooser.md`
- `../../docs/reference/package-surface.md`

## Installation

```bash
npm install @konekti/platform-nodejs
```

## Quick Start

```typescript
import { createNodejsAdapter } from '@konekti/platform-nodejs';
import { KonektiFactory } from '@konekti/runtime';

const app = await KonektiFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
});

await app.listen();
```

## API

- `createNodejsAdapter(options)` - create the raw Node.js `HttpApplicationAdapter`
- `bootstrapNodejsApplication(rootModule, options)` - compatibility bootstrap helper without implicit listen
- `runNodejsApplication(rootModule, options)` - compatibility helper for bootstrap + listen + startup logging + shutdown signal wiring

### Supported options

`createNodejsAdapter()`, `bootstrapNodejsApplication()`, and `runNodejsApplication()` preserve the current raw-Node option shape:

- `port`
- `host`
- `https`
- `maxBodySize`
- `rawBody`
- `retryDelayMs`
- `retryLimit`
- `shutdownTimeoutMs`

`bootstrapNodejsApplication()` and `runNodejsApplication()` also continue to accept the runtime-owned HTTP options documented in `@konekti/runtime`, such as `cors`, `globalPrefix`, `filters`, `converters`, `middleware`, and versioning.

## supported operations

- Selects the raw Node.js HTTP listener through the adapter-first runtime facade (`KonektiFactory.create(..., { adapter: createNodejsAdapter(...) })`).
- Preserves the current Node request/response bridge, startup logging, graceful shutdown, HTTPS, and retry semantics by delegating to the existing runtime-owned implementation.
- Keeps compatibility bootstrap helpers available for users who still want the helper-wrapper path.

## runtime invariants

- `rawBody` remains opt-in and is not populated for multipart requests.
- Startup logs and bind-target reporting stay aligned with the current raw Node listener behavior.
- The adapter keeps the same graceful shutdown drain window semantics and HTTPS binding behavior as the existing `@konekti/runtime/node` implementation.

## lifecycle guarantees

- `listen(dispatcher)` starts exactly one Node HTTP/HTTPS server for the adapter lifecycle.
- `close(signal?)` stops accepting new connections, drains existing requests for up to `shutdownTimeoutMs`, then clears remaining sockets.
- `runNodejsApplication()` continues to register and remove shutdown signal listeners around the application lifecycle.

## intentional limitations

- This package normalizes the public package boundary for raw Node startup; it does not yet migrate the underlying implementation ownership out of `@konekti/runtime/node`.
- No new adapterless startup semantics are introduced here. If you omit an adapter entirely, use `createApplicationContext()` for DI/lifecycle-only bootstraps instead of expecting HTTP serving behavior.
- Advanced Node-only internals such as compression helpers and shutdown-registration utilities remain on `@konekti/runtime/node` for now.
