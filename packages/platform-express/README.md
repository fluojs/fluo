# @fluojs/platform-express

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Express-backed HTTP adapter for the fluo runtime.

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
npm install @fluojs/platform-express express
```

## When to Use

Use this package when you want to run a fluo application using Express as the underlying HTTP engine. This is useful for leveraging Express's robust ecosystem, mature Node.js server handling, and familiar request/response lifecycle within the fluo decorator-based architecture.

## Quick Start

```typescript
import { createExpressAdapter } from '@fluojs/platform-express';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await fluoFactory.create(AppModule, {
  adapter: createExpressAdapter({ port: 3000 }),
});

await app.listen();
```

## Common Patterns

### Handling Streaming Responses (SSE)
The Express adapter supports Server-Sent Events (SSE) via the shared `SseResponse` utility, abstracting away the Express-specific stream handling.

```typescript
@Get('events')
async streamEvents(@Res() res: FrameworkResponse) {
  const events = new SseResponse();
  events.send({ data: 'hello' });
  return events;
}
```

### Body Parsing and Multipart
The adapter handles `rawBody` and multipart form-data parsing out of the box. When you construct the adapter directly, pass multipart limits as the second argument. `bootstrapExpressApplication(...)` and `runExpressApplication(...)` accept the same multipart settings under `options.multipart`. When `multipart.maxTotalSize` is not set, `maxBodySize` becomes the default total multipart payload cap so body-size limits stay portable across HTTP adapters.

```typescript
const adapter = createExpressAdapter(
  {
    port: 3000,
    rawBody: true,
  },
  {
    maxTotalSize: 10 * 1024 * 1024,
  },
);
```

## Public API Overview

- `createExpressAdapter(options)`: Factory for the Express HTTP adapter.
- `bootstrapExpressApplication(module, options)`: Advanced bootstrap helper for manual control.
- `runExpressApplication(module, options)`: Compatibility helper for quick startup with signal wiring. On timeout/failure it reports the condition through logging and `process.exitCode`, while leaving final process termination to the surrounding host.
- `ExpressHttpApplicationAdapter`: The core adapter implementation class.

## Related Packages

- `@fluojs/runtime`: Core framework runtime.
- `@fluojs/platform-fastify`: Alternative high-performance adapter.
- `@fluojs/websockets`: Real-time gateway support for Express.

## Example Sources

- `packages/platform-express/src/adapter.test.ts`
- `examples/minimal/src/main.ts` (Fastify-based, but demonstrates the shared `fluoFactory` pattern)
