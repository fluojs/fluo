# @fluojs/platform-fastify

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Fastify-backed HTTP adapter for the fluo runtime.

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
npm install @fluojs/platform-fastify fastify
```

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

## Common Patterns

### Multipart and Raw Body
The Fastify adapter includes built-in support for multipart form-data and raw body parsing via internal Fastify plugins, exposed through the standard fluo request interface. When you construct the adapter directly, pass multipart limits as the second argument. `bootstrapFastifyApplication(...)` and `runFastifyApplication(...)` accept the same multipart settings under `options.multipart`.

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

## Performance

fluo's Fastify adapter significantly outperforms the raw Node.js adapter in high-concurrency scenarios.

| Adapter | Requests/sec | Avg Latency |
| --- | ---: | ---: |
| Raw Node.js Adapter | ~31,000 | 4.0ms |
| Fastify Adapter | **~58,000** | **2.1ms** |

*Measured using `wrk` on a standard `/health` endpoint.*

## Public API Overview

- `createFastifyAdapter(options)`: Recommended factory for the Fastify adapter.
- `bootstrapFastifyApplication(module, options)`: advanced bootstrap without implicit listening.
- `runFastifyApplication(module, options)`: Quick-start helper with lifecycle management.
- `FastifyHttpApplicationAdapter`: The core adapter implementation.

## Related Packages

- `@fluojs/runtime`: Core framework runtime.
- `@fluojs/platform-express`: Alternative Express-based adapter.
- `@fluojs/websockets`: Real-time gateway support.

## Example Sources

- `packages/platform-fastify/src/adapter.test.ts`
- `examples/minimal/src/main.ts`
- `examples/realworld-api/src/main.ts`
