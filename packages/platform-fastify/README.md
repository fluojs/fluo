# @konekti/platform-fastify

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Fastify-backed HTTP adapter for the Konekti runtime.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Performance](#performance)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @konekti/platform-fastify fastify
```

## When to Use

Use this package when you need a high-performance HTTP adapter for your Konekti application. Fastify is known for its low overhead and efficient request handling, making it the recommended choice for production Konekti applications requiring high throughput and concurrency.

## Quick Start

```typescript
import { createFastifyAdapter } from '@konekti/platform-fastify';
import { KonektiFactory } from '@konekti/runtime';
import { AppModule } from './app.module';

const app = await KonektiFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});

await app.listen();
```

## Common Patterns

### Multipart and Raw Body
The Fastify adapter includes built-in support for multipart form-data and raw body parsing via internal Fastify plugins, exposed through the standard Konekti request interface.

```typescript
const adapter = createFastifyAdapter({
  port: 3000,
  multipart: true,
  rawBody: true,
});
```

### Server-Backed Real-Time
Fastify provides a `server-backed` capability that allows `@konekti/websockets` to attach directly to the underlying Node.js HTTP server.

```typescript
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

## Performance

Konekti's Fastify adapter significantly outperforms the raw Node.js adapter in high-concurrency scenarios.

| Adapter | Requests/sec | Avg Latency |
| --- | ---: | ---: |
| Raw Node.js Adapter | ~31,000 | 4.0ms |
| Fastify Adapter | **~58,000** | **2.1ms** |

*Measured using `wrk` on a standard `/health` endpoint.*

## Public API Overview

- `createFastifyAdapter(options)`: Recommended factory for the Fastify adapter.
- `bootstrapFastifyApplication(module, options)`: advanced bootstrap without implicit listening.
- `runFastifyApplication(module, options)`: Quick-start helper with lifecycle management.
- `FastifyHttpAdapter`: The core adapter implementation.

## Related Packages

- `@konekti/runtime`: Core framework runtime.
- `@konekti/platform-express`: Alternative Express-based adapter.
- `@konekti/websockets`: Real-time gateway support.

## Example Sources

- `packages/platform-fastify/src/adapter.test.ts`
- `examples/minimal/src/main.ts`
- `examples/realworld-api/src/main.ts`

