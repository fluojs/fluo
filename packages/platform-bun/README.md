# @konekti/platform-bun

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Bun-backed HTTP adapter for the Konekti runtime, built on native `Bun.serve()`.

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
npm install @konekti/platform-bun
```

## When to Use

Use this package when running Konekti applications on the [Bun](https://bun.sh/) runtime. This adapter leverages Bun's high-performance `Request`/`Response` bridge and native `fetch`-style architecture, providing a seamless and fast experience for Bun users.

During application shutdown, the adapter stops new ingress and gives active HTTP handlers a bounded drain window before Bun forcefully tears the server down.

## Quick Start

```typescript
import { createBunAdapter } from '@konekti/platform-bun';
import { KonektiFactory } from '@konekti/runtime';
import { AppModule } from './app.module';

const app = await KonektiFactory.create(AppModule, {
  adapter: createBunAdapter({ port: 3000 }),
});

await app.listen();
```

## Common Patterns

### Manual Fetch Handling
If you prefer to manage the Bun server yourself, you can use the fetch handler directly.

```typescript
import { createBunFetchHandler } from '@konekti/platform-bun';

const handler = await createBunFetchHandler({ 
  dispatcher: app.getHttpDispatcher(),
  port: 3000 
});

Bun.serve({
  fetch: handler,
  port: 3000,
});
```

### Native WebSocket Upgrade
The adapter supports Bun's native `server.upgrade()` through the `@konekti/websockets/bun` binding.

```typescript
// gateways automatically use Bun's native upgrade when the Bun adapter is active
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

## Public API Overview

- `createBunAdapter(options)`: Recommended factory for the Bun adapter.
- `createBunFetchHandler(options)`: Creates a native `fetch(request)` handler for custom `Bun.serve()` setups.
- `bootstrapBunApplication(module, options)`: Advanced bootstrap without implicit startup logging.
- `runBunApplication(module, options)`: Compatibility helper for quick startup with signal wiring.

## Related Packages

- `@konekti/runtime`: Core framework runtime.
- `@konekti/websockets`: Includes specific subpath `@konekti/websockets/bun`.
- `@konekti/socket.io`: Supports the native Bun engine.

## Example Sources

- `packages/platform-bun/src/adapter.test.ts`
- `packages/websockets/src/bun/bun.test.ts`
