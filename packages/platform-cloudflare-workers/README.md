# @fluojs/platform-cloudflare-workers

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Cloudflare Workers HTTP adapter for the fluo runtime, optimized for the edge.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/platform-cloudflare-workers
```

This package is intended to run on Cloudflare Workers. The published manifest intentionally does not declare `engines.node`, so npm metadata stays aligned with the Workers runtime contract; the repository's Node.js 20+ requirement only applies to the maintainer build/test toolchain.

## When to Use

Use this package when deploying fluo applications to [Cloudflare Workers](https://workers.cloudflare.com/). It is designed for the serverless edge environment, providing a lightweight `fetch`-based adapter that respects Worker isolate constraints and native Web APIs.

The adapter binds each request lifecycle to `executionContext.waitUntil(...)` and keeps in-flight dispatches alive during `close()` so Worker shutdown does not drop active work mid-request.

## Quick Start

### Standard Adapter Usage
Bootstrap your application and export a standard Cloudflare Worker `fetch` handler.

```typescript
import { fluoFactory } from '@fluojs/runtime';
import { createCloudflareWorkerAdapter } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const adapter = createCloudflareWorkerAdapter();
const app = await fluoFactory.create(AppModule, { adapter });

await app.listen();

export default {
  fetch: (req, env, ctx) => adapter.fetch(req, env, ctx),
};
```

### Lazy Entrypoint (Zero-Config)
Use the entrypoint helper for an even simpler setup that bootstraps on the first request.

```typescript
import { createCloudflareWorkerEntrypoint } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const worker = createCloudflareWorkerEntrypoint(AppModule);

export default {
  fetch: worker.fetch,
};
```

## Common Patterns

### Working with WebSocketPairs
The adapter supports Cloudflare's native `WebSocketPair` for real-time communication via the `@fluojs/websockets/cloudflare-workers` binding.

```typescript
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

### Edge-Native Middleware
Standard fluo middleware (CORS, Global Prefix, etc.) is fully supported and optimized for the Cloudflare environment.

```typescript
const adapter = createCloudflareWorkerAdapter({
  globalPrefix: 'api/v1',
  cors: true,
});
```

## Public API Overview

- `createCloudflareWorkerAdapter(options)`: Factory for the Worker HTTP adapter.
- `createCloudflareWorkerEntrypoint(module, options)`: Creates a lazy-bootstrapping Worker entrypoint.
- `bootstrapCloudflareWorkerApplication(module, options)`: Async bootstrap helper for Workers.
- `CloudflareWorkerHttpApplicationAdapter`: The core adapter implementation.

## Related Packages

- `@fluojs/runtime`: Core framework runtime.
- `@fluojs/websockets`: Includes specific subpath `@fluojs/websockets/cloudflare-workers`.
- `@fluojs/http`: Shared HTTP decorators.

## Example Sources

- `packages/platform-cloudflare-workers/src/adapter.test.ts`
- `packages/websockets/src/cloudflare-workers/cloudflare-workers.test.ts`
