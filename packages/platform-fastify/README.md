# @konekti/platform-fastify

<p><strong><kbd>English</kbd></strong></p>

Fastify-backed HTTP adapter for Konekti runtime applications.

## Installation

```bash
npm install @konekti/platform-fastify fastify
```

## Quick Start

```typescript
import { runFastifyApplication } from '@konekti/platform-fastify';

await runFastifyApplication(AppModule, {
  mode: 'prod',
  port: 3000,
});
```

## API

- `createFastifyAdapter(options)` - create a Fastify `HttpApplicationAdapter`
- `bootstrapFastifyApplication(rootModule, options)` - bootstrap without implicit shutdown signal wiring
- `runFastifyApplication(rootModule, options)` - bootstrap + listen + startup logging + shutdown signal wiring

### Supported options

`runFastifyApplication()` and `bootstrapFastifyApplication()` support the same runtime option shapes as `runNodeApplication()` for:

- `rawBody`
- `multipart`
- `https`
- `host`
- `cors` (`false | string | string[] | CorsOptions`)

## Parity notes

- `rawBody` is opt-in and only populated for non-multipart requests.
- Multipart requests expose `request.body` fields and `request.files` (`UploadedFile[]`).
- Startup logs mirror runtime conventions and include bind-target details for wildcard hosts.

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
