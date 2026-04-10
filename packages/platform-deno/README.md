# @fluojs/platform-deno

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Deno-backed HTTP adapter for the fluo runtime, built on native `Deno.serve`.

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
deno add npm:@fluojs/platform-deno npm:@fluojs/runtime npm:@fluojs/http
```

## When to Use

Use this package when running fluo applications on the [Deno](https://deno.com/) runtime. This adapter leverages Deno's native `fetch`-standard `Request` and `Response` objects, providing a secure and high-performance environment for TypeScript backend development.

During application shutdown, the adapter stops new ingress and gives active HTTP handlers a bounded drain window before the Deno server lifecycle completes.

## Quick Start

```typescript
import { runDenoApplication } from '@fluojs/platform-deno';
import { AppModule } from './app.module.ts';

await runDenoApplication(AppModule, {
  port: 3000,
});
```

## Common Patterns

### Manual Request Dispatching
For testing or custom `Deno.serve` implementations, you can use the adapter's `handle` method to dispatch native web requests manually.

```typescript
const adapter = createDenoAdapter({ port: 3000 });
const response = await adapter.handle(new Request('http://localhost:3000/health'));
```

### Deno-Native WebSocket Support
The adapter supports Deno's native `Deno.upgradeWebSocket` through the `@fluojs/websockets/deno` binding.

```typescript
// Gateways automatically use Deno's native upgrade when the Deno adapter is active
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

## Public API Overview

- `createDenoAdapter(options)`: Factory for the Deno HTTP adapter.
- `bootstrapDenoApplication(module, options)`: Advanced bootstrap for custom orchestration.
- `runDenoApplication(module, options)`: Recommended quick-start helper for Deno.
- `handle(request)`: Manual `Request` to `Response` dispatcher.

## Related Packages

- `@fluojs/runtime`: Core framework runtime.
- `@fluojs/websockets`: Includes specific subpath `@fluojs/websockets/deno`.
- `@fluojs/http`: HTTP decorators and abstractions.

## Example Sources

- `packages/platform-deno/src/adapter.test.ts`
- `packages/websockets/src/deno/deno.test.ts`
