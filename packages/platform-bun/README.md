# @konekti/platform-bun

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Bun-backed HTTP adapter for Konekti runtime applications, built on the shared `@konekti/runtime/web` fetch-style adapter seam.

## See also

- `../runtime/README.md`
- `../../docs/concepts/http-runtime.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/reference/package-surface.md`

## Installation

```bash
npm install @konekti/platform-bun
```

## Quick Start

```typescript
import { createBunAdapter } from '@konekti/platform-bun';
import { KonektiFactory } from '@konekti/runtime';

const app = await KonektiFactory.create(AppModule, {
  adapter: createBunAdapter({ port: 3000 }),
});

await app.listen();
```

## API

- `createBunAdapter(options)` - create a Bun `HttpApplicationAdapter`
- `createBunFetchHandler({ dispatcher, ...options })` - create a Bun `fetch(request)` handler backed by the shared fetch-style adapter seam
- `bootstrapBunApplication(rootModule, options)` - advanced bootstrap helper without implicit startup logging
- `runBunApplication(rootModule, options)` - compatibility helper for bootstrap + listen + startup logging + shutdown signal wiring

### Supported options

`createBunAdapter()`, `bootstrapBunApplication()`, and `runBunApplication()` support these Bun-oriented adapter options:

- `port`
- `hostname`
- `tls`
- `idleTimeout`
- `development`
- `maxBodySize`
- `rawBody`
- `multipart`

`runBunApplication()` also supports:

- `shutdownSignals`
- `forceExitTimeoutMs`

## supported operations

- Bridges native Bun `Request` handling into Konekti `FrameworkRequest` / `FrameworkResponse` by reusing the shared `@konekti/runtime/web` fetch-style adapter seam.
- Preserves shared fetch-style request semantics for query strings, cookies, JSON/text body parsing, multipart parsing, and canonical error envelopes.
- Exposes `FrameworkResponse.stream` through that shared seam so SSE and streamed responses stay transport-owned instead of depending on raw Node writers.
- Exposes the shared fetch-style raw websocket expansion capability as `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', mode: 'request-upgrade', support: 'supported', version: 1, reason }` for Bun-native request-upgrade hosting through `Bun.serve()` + `server.upgrade()`.
- Supports adapter-first startup via `KonektiFactory.create(..., { adapter: createBunAdapter(...) })` and Bun-oriented compatibility helpers via `runBunApplication()`.

## runtime invariants

- `rawBody` is opt-in and remains unset for multipart requests.
- If the dispatcher does not commit a response, the shared fetch-style adapter seam finalizes the Bun response with an empty payload.
- SSE framing and streamed response behavior reuse the same shared seam that powers other fetch-style runtime adapters.
- Startup errors caused by missing `globalThis.Bun.serve()` fail fast with an explicit adapter error.

## lifecycle guarantees

- `listen(dispatcher)` creates exactly one Bun server instance for the adapter lifecycle.
- `close(signal?)` stops the active Bun server and releases the adapter-owned server handle.
- `runBunApplication()` mirrors the runtime startup log format and can register shutdown signal cleanup for Bun environments that expose Node-compatible process signals.

## intentional limitations

- This adapter does not replace `@konekti/runtime`; runtime bootstrap, DI, middleware, guards, and shutdown ownership remain in the runtime package.
- No standalone Bun app builder is provided beyond Bun's native `fetch` + `Bun.serve()` contract; framework integration still flows through the Konekti runtime facade.
- No Node-specific writable response escape hatch is exposed; streamed responses must use `FrameworkResponse.stream`.
- Other fetch-style runtimes such as Deno and Cloudflare Workers remain separate adapter concerns.
- Raw websocket hosting for Bun is provided through the dedicated `@konekti/websockets/bun` binding. `@konekti/websockets/node` still remains Node-upgrade-listener-specific and is not claimed for Bun.
