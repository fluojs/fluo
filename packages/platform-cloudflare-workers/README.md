# @konekti/platform-cloudflare-workers

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Cloudflare Workers HTTP adapter for Konekti runtime applications, built on the shared `@konekti/runtime/web` fetch-style adapter seam.

## See also

- `../runtime/README.md`
- `../../docs/concepts/http-runtime.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/reference/package-surface.md`

## Installation

```bash
npm install @konekti/platform-cloudflare-workers
```

## Quick Start

### Canonical adapter-first bootstrap

```typescript
import { KonektiFactory } from '@konekti/runtime';
import { createCloudflareWorkerAdapter } from '@konekti/platform-cloudflare-workers';

const adapter = createCloudflareWorkerAdapter({ rawBody: true });
const app = await KonektiFactory.create(AppModule, {
  adapter,
});

await app.listen();

export default {
  fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    return adapter.fetch(request, env, ctx);
  },
};
```

### Lazy Worker entrypoint

```typescript
import { createCloudflareWorkerEntrypoint } from '@konekti/platform-cloudflare-workers';

const worker = createCloudflareWorkerEntrypoint(AppModule, {
  rawBody: true,
});

export default {
  fetch: worker.fetch,
};
```

## API

- `createCloudflareWorkerAdapter(options)` - creates a Cloudflare Workers `HttpApplicationAdapter` with an adapter-owned `fetch()` entrypoint.
- `bootstrapCloudflareWorkerApplication(rootModule, options)` - bootstraps a ready-to-serve Worker application and returns `{ app, adapter, fetch, close }`.
- `createCloudflareWorkerEntrypoint(rootModule, options)` - lazily bootstraps the application on first request and reuses the same runtime instance for subsequent fetches in the same Worker isolate.

### Supported options

Worker bootstrap helpers accept the shared HTTP adapter middleware/runtime options from `@konekti/runtime/internal/http-adapter` plus the shared Web bridge options:

- `cors` (`false | string | string[] | CorsOptions`)
- `globalPrefix`
- `globalPrefixExclude`
- `middleware`
- `securityHeaders`
- `rawBody`
- `multipart`
- `maxBodySize`

## supported operations

- Reuses `dispatchWebRequest(...)` from the shared `@konekti/runtime/web` fetch-style adapter seam instead of forking Request/Response translation logic.
- Bridges native Worker `Request` objects into Konekti `FrameworkRequest` / `FrameworkResponse` contracts.
- Exposes the shared fetch-style raw websocket expansion capability as `{ kind: 'fetch-style', contract: 'raw-websocket-expansion', mode: 'request-upgrade', support: 'contract-only', version: 1, reason }` so Worker platforms do not imply Node-style listener ownership while still documenting the future expansion seam honestly.
- Preserves `rawBody` opt-in behavior for non-multipart requests.
- Supports multipart parsing and `request.files` exposure through the shared Web core.
- Supports SSE and other streamed responses through the shared Web `FrameworkResponse.stream` implementation.
- Applies shared runtime HTTP middleware (`cors`, `globalPrefix`, `securityHeaders`) during Worker bootstrap helpers.

## runtime invariants

- Response serialization, error envelopes, malformed-cookie handling, multipart parsing, and SSE framing follow the shared `@konekti/runtime/web` contract.
- `fetch()` never opens a socket or owns a process listener; it only dispatches the incoming Worker request through the already-bootstrapped runtime dispatcher.
- `app.listen()` in Worker setups binds the dispatcher to the adapter and marks the application ready, but it does not create a network listener.
- `close()` clears the bound dispatcher and runs normal runtime shutdown hooks when you call it manually (typically in tests or custom isolate teardown paths).

## lifecycle guarantees

- `createCloudflareWorkerAdapter().listen(dispatcher)` is deterministic and idempotently replaces the current dispatcher binding.
- `createCloudflareWorkerEntrypoint()` caches the bootstrapped application per Worker isolate and reuses it across requests until `close()` is called.
- `bootstrapCloudflareWorkerApplication()` returns an already-listening Worker application so the exported `fetch()` handler can serve requests immediately.

## intentional limitations

- This package does not emulate Node listener lifecycle, startup logs, or shutdown-signal wiring. Cloudflare Workers has no process-owned `listen()`/`SIGTERM` contract to mirror.
- Worker `env` and `ExecutionContext` values are accepted at the `fetch()` boundary but are not injected into Konekti `RequestContext` automatically.
- No Node-only options such as `port`, `host`, `https`, `shutdownSignals`, or `forceExitTimeoutMs` are supported.
- This package does not add Bun- or Deno-specific behavior; it stays focused on Cloudflare Workers over the shared Web core.
- The fetch-style websocket capability exposed here is contract-only. Raw websocket support remains out of scope until a Worker-specific host and tests land in a dedicated issue.
