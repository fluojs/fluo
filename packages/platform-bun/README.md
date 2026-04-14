# @fluojs/platform-bun

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Bun-backed HTTP adapter for the fluo runtime, built on native `Bun.serve()`.

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
npm install @fluojs/platform-bun
```

This package is intended to run on Bun. The published manifest intentionally does not declare `engines.node`, so npm metadata stays aligned with the Bun runtime contract; the repository's Node.js 20+ requirement only applies to the maintainer build/test toolchain.

## When to Use

Use this package when running fluo applications on the [Bun](https://bun.sh/) runtime. This adapter leverages Bun's high-performance `Request`/`Response` bridge and native `fetch`-style architecture, providing a seamless and fast experience for Bun users.

During application shutdown, the adapter stops new ingress and gives active HTTP handlers a bounded drain window before Bun forcefully tears the server down. If signal-driven shutdown exceeds `forceExitTimeoutMs` or fails, fluo reports that condition through logging and `process.exitCode` while leaving final process termination to Bun or the surrounding host.

## Quick Start

```typescript
import { createBunAdapter } from '@fluojs/platform-bun';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await fluoFactory.create(AppModule, {
  adapter: createBunAdapter({ port: 3000 }),
});

await app.listen();
```

## Common Patterns

### Manual Fetch Handling
If you prefer to manage the Bun server yourself, you can use the fetch handler directly.

```typescript
import { createBunFetchHandler } from '@fluojs/platform-bun';

const handler = await createBunFetchHandler({
  dispatcher: app.getHttpDispatcher(),
});

Bun.serve({
  fetch: handler,
  port: 3000,
});
```

### Native WebSocket Upgrade
The adapter supports Bun's native `server.upgrade()` through the `@fluojs/websockets/bun` binding.

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

- `@fluojs/runtime`: Core framework runtime.
- `@fluojs/websockets`: Includes specific subpath `@fluojs/websockets/bun`.
- `@fluojs/socket.io`: Supports the native Bun engine.

## Example Sources

- `packages/platform-bun/src/adapter.test.ts`
- `packages/websockets/src/bun/bun.test.ts`
