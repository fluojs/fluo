# @konekti/platform-fastify

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Fastify-backed HTTP adapter for Konekti runtime applications.

## See also

- `../runtime/README.md`
- `../../docs/concepts/http-runtime.md`
- `../../docs/concepts/lifecycle-and-shutdown.md`
- `../../docs/concepts/observability.md`
- `../../docs/reference/package-chooser.md`
- `../../docs/reference/package-surface.md`

## Installation

```bash
npm install @konekti/platform-fastify fastify
```

## Quick Start

```typescript
import { createFastifyAdapter } from '@konekti/platform-fastify';
import { KonektiFactory } from '@konekti/runtime';

const app = await KonektiFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});

await app.listen();
```

## API

- `createFastifyAdapter(options)` - create a Fastify `HttpApplicationAdapter`
- `bootstrapFastifyApplication(rootModule, options)` - advanced bootstrap helper without implicit shutdown signal wiring
- `runFastifyApplication(rootModule, options)` - compatibility helper for bootstrap + listen + startup logging + shutdown signal wiring

### Supported options

`createFastifyAdapter()`, `runFastifyApplication()`, and `bootstrapFastifyApplication()` all remain supported. New application startup examples should prefer `KonektiFactory.create(..., { adapter: createFastifyAdapter(...) })` so the public startup story stays centered on the runtime facade.

`runFastifyApplication()` and `bootstrapFastifyApplication()` support the same runtime option shapes as `runNodeApplication()` for:

- `rawBody`
- `multipart`
- `https`
- `host`
- `cors` (`false | string | string[] | CorsOptions`)
- `shutdownTimeoutMs`

`runFastifyApplication()` also supports:

- `shutdownSignals`
- `forceExitTimeoutMs`

## Parity notes

- `rawBody` is opt-in and only populated for non-multipart requests.
- Multipart requests expose `request.body` fields and `request.files` (`UploadedFile[]`).
- The adapter exposes `FrameworkResponse.stream` so SSE and other streamed responses do not depend on raw Node response duck-typing.
- Startup logs mirror runtime conventions and include bind-target details for wildcard hosts.
- Signal-driven shutdown follows the same runtime-owned graceful-close path as `runNodeApplication()`, including an optional force-exit watchdog via `forceExitTimeoutMs`.
- If `forceExitTimeoutMs` is shorter than `shutdownTimeoutMs`, the watchdog can intentionally terminate the process before the full drain window completes.

## Benchmark

The table below compares the Node built-in adapter and Fastify adapter on the same `/health` endpoint using `wrk` against 16 threads / 128 connections for 30s.

| Adapter | Requests/sec | Avg latency | Notes |
| --- | ---: | ---: | --- |
| `@konekti/runtime` Node adapter | 31,412 | 4.03ms | baseline |
| `@konekti/platform-fastify` | 58,927 | 2.14ms | higher throughput under concurrency |

Reproduce with the same app module by running one adapter at a time and using:

```bash
wrk -t16 -c128 -d30s http://127.0.0.1:3000/health
```

Treat these numbers as directional; validate in your deployment topology and payload profile.

## non-goals and intentional limitations

- This adapter does not replace `@konekti/runtime` — it replaces only the HTTP transport layer while the Konekti runtime still owns bootstrap, lifecycle, DI, and shutdown
- No Fastify plugin passthrough — framework middleware and guards run through the Konekti dispatcher, not Fastify's hook system; native Fastify plugins are not automatically bridged
- rawBody is opt-in and excluded for multipart requests — this matches the Node adapter behavior
- No standalone Fastify mode — the adapter requires the Konekti runtime bootstrap path; it cannot be used as a standalone Fastify server

#### 0.x migration note

- Custom Fastify-adjacent extensions that previously reached through `FrameworkResponse.raw` for SSE should move to `FrameworkResponse.stream`.
