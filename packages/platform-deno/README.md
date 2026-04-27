# @fluojs/platform-deno

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Deno-backed HTTP adapter for the fluo runtime, built on native `Deno.serve`.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [HTTPS and Runtime Portability](#https-and-runtime-portability)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
deno add npm:@fluojs/platform-deno npm:@fluojs/runtime npm:@fluojs/http
```

This package is intended to run on Deno. The published manifest intentionally does not declare `engines.node`, so npm metadata stays aligned with the Deno runtime contract; the repository's Node.js 20+ requirement only applies to the maintainer build/test toolchain.

## When to Use

Use this package when running fluo applications on the [Deno](https://deno.com/) runtime. This adapter leverages Deno's native `fetch`-standard `Request` and `Response` objects, providing a secure and high-performance environment for TypeScript backend development.

During application shutdown, the adapter stops new ingress and gives active HTTP handlers a bounded drain window before the Deno server lifecycle completes.

When `runDenoApplication(...)` runs inside Deno with signal APIs available, it also registers `SIGINT`/`SIGTERM` listeners and removes them once the application closes.

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
For testing or custom `Deno.serve` implementations, you can use the adapter's `handle` method to dispatch native web requests manually. Bind the dispatcher first via `app.listen()` (or `runDenoApplication(...)`), because `handle(...)` only works after the runtime has been bootstrapped.

```typescript
import { fluoFactory } from '@fluojs/runtime';

const adapter = createDenoAdapter({ port: 3000 });
const app = await fluoFactory.create(AppModule, { adapter });

await app.listen();

const response = await adapter.handle(new Request('http://localhost:3000/health'));
```

### Deno-Native WebSocket Support
The adapter supports Deno's native `Deno.upgradeWebSocket` through the `@fluojs/websockets/deno` binding.

```typescript
// Gateways automatically use Deno's native upgrade when the Deno adapter is active
@WebSocketGateway({ path: '/ws' })
export class MyGateway {}
```

## HTTPS and Runtime Portability

Pass Deno TLS certificate material through the `https` option to start `Deno.serve` in HTTPS mode. The adapter forwards `https.cert` and `https.key` to Deno as `cert` and `key`, and startup logging reports an `https://` listen URL so the Deno package stays aligned with the shared HTTP adapter portability contract.

```typescript
await runDenoApplication(AppModule, {
  hostname: '127.0.0.1',
  https: {
    cert: await Deno.readTextFile('./cert.pem'),
    key: await Deno.readTextFile('./key.pem'),
  },
  port: 3443,
});
```

`hostname` remains the Deno-native option name. The adapter also accepts `host` as a portability alias for shared HTTP adapter tests and cross-runtime configuration helpers; when both are provided, `hostname` wins.

## Public API Overview

- `createDenoAdapter(options)`: Factory for the Deno HTTP adapter.
- `bootstrapDenoApplication(module, options)`: Advanced bootstrap for custom orchestration.
- `runDenoApplication(module, options)`: Recommended quick-start helper for Deno.
- `handle(request)`: Manual `Request` to `Response` dispatcher.
- `https: { cert, key }`: HTTPS startup options forwarded to `Deno.serve` and reflected in the reported listen URL.

## Related Packages

- `@fluojs/runtime`: Core framework runtime.
- `@fluojs/websockets`: Includes specific subpath `@fluojs/websockets/deno`.
- `@fluojs/http`: HTTP decorators and abstractions.

## Example Sources

- `packages/platform-deno/src/adapter.test.ts`
- `packages/websockets/src/deno/deno.test.ts`
