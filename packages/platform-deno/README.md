# @konekti/platform-deno

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Deno-backed HTTP adapter for Konekti runtime applications, built on the shared `@konekti/runtime/web` fetch-style adapter seam.

## See also

- `../runtime/README.md`
- `../../docs/concepts/http-runtime.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/reference/package-surface.md`

## Installation

```bash
deno add npm:@konekti/platform-deno npm:@konekti/runtime npm:@konekti/http
```

## Quick Start

```typescript
import { Controller, Get } from '@konekti/http';
import { runDenoApplication } from '@konekti/platform-deno';

@Controller('/health')
class HealthController {
  @Get('/')
  check() {
    return { status: 'ok' };
  }
}

class AppModule {}

await runDenoApplication(AppModule, {
  port: 3000,
});
```

## API

- `createDenoAdapter(options)` - create a Deno `HttpApplicationAdapter`
- `bootstrapDenoApplication(rootModule, options)` - advanced bootstrap helper without implicit OS signal wiring
- `runDenoApplication(rootModule, options)` - compatibility helper for bootstrap + listen + startup logging
- `DenoHttpApplicationAdapter.handle(request)` - dispatch a native Web `Request` manually and receive a native Web `Response`

### Supported options

`createDenoAdapter()`, `bootstrapDenoApplication()`, and `runDenoApplication()` support:

- `port`
- `hostname`
- `rawBody`
- `multipart`
- `maxBodySize`
- `cors` (`false | string | string[] | CorsOptions`) via the bootstrap helpers
- `globalPrefix` / `globalPrefixExclude` via the bootstrap helpers
- `securityHeaders` via the bootstrap helpers
- `serve` for explicit `Deno.serve` injection during tests or custom hosting shells
- `onListen` to observe Deno's bound address callback

## supported operations

- Bridges native Web `Request` / `Response` handling through the shared `@konekti/runtime/web` fetch-style adapter seam so Deno shares the same request parsing, raw-body, multipart, error-envelope, and SSE semantics as the other fetch-style adapters.
- Exposes `handle(request)` for direct request dispatch in tests and custom `Deno.serve(...)` composition.
- Supports `rawBody` opt-in for non-multipart requests.
- Supports multipart form-data parsing and exposes uploaded files as `UploadedFile[]`.
- Exposes the shared fetch-style raw websocket expansion capability as `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', mode: 'request-upgrade', support: 'supported', version: 1, reason }` for Deno-native request-upgrade hosting through `Deno.upgradeWebSocket(request)`.
- Logs runtime-style listen messages through `runDenoApplication()`.

## runtime invariants

- `rawBody` is never populated for multipart requests.
- SSE and other streamed responses flow through native Web `Response` streaming rather than Node-only response objects.
- If the dispatcher has not been bound yet, incoming requests are serialized through the canonical framework error envelope instead of hanging.
- The adapter keeps request/response translation in the shared fetch-style adapter seam instead of forking Deno-specific parsing logic.

## lifecycle guarantees

- `listen()` starts `Deno.serve(...)` and binds the Konekti dispatcher before requests are handled.
- `close()` aborts the active serve signal, calls the underlying server `shutdown()`, and waits for `finished` before resolving.
- `runDenoApplication()` adds startup logging but does not install implicit OS signal handlers.

## intentional limitations

- This package does not replace `@konekti/runtime`; module graph compilation, DI, lifecycle hooks, and application orchestration remain in the runtime package.
- No Bun-, Cloudflare-, or Deno Deploy-specific bootstrap helpers are provided here.
- No Deno-native HTTPS/TLS passthrough is exposed yet; add that in a dedicated issue when the public contract is defined.
- The adapter targets native Web `Request` / `Response` semantics and does not provide a Node compatibility layer.
- Raw websocket hosting for Deno is provided through the dedicated `@konekti/websockets/deno` binding. `@konekti/websockets/node` still remains Node-upgrade-listener-specific and is not claimed for Deno.
