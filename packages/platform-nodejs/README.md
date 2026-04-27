# @fluojs/platform-nodejs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Raw Node.js HTTP adapter package for the fluo runtime.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Behavioral Contracts](#behavioral-contracts)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/platform-nodejs
```

## When to Use

Use this package when you want to run a fluo application directly on the Node.js built-in `http` or `https` modules without the overhead of an intermediate framework like Express or Fastify. It is ideal for minimal footprints, custom low-level optimizations, or environments where standard Node APIs are preferred.

## Quick Start

```typescript
import { createNodejsAdapter } from '@fluojs/platform-nodejs';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

const app = await fluoFactory.create(AppModule, {
  adapter: createNodejsAdapter({ port: 3000 }),
});

await app.listen();
```

## Common Patterns

### Customizing Server Options
The adapter accepts standard Node.js server options including HTTPS configuration and body size limits.

```typescript
const adapter = createNodejsAdapter({
  port: 443,
  https: {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem'),
  },
  maxBodySize: '1mb',
});
```

`maxBodySize` is enforced while the raw Node request body is still streaming, and the same limit becomes the default total multipart payload cap unless you override `multipart.maxTotalSize` during bootstrap.

### Direct Application Execution
You can use `runNodejsApplication` for a zero-boilerplate startup that includes graceful shutdown and logging.

When signal-driven shutdown exceeds `forceExitTimeoutMs` or fails, the helper logs the condition and sets `process.exitCode`, but leaves final process termination to the host process owner.

```typescript
import { runNodejsApplication } from '@fluojs/platform-nodejs';
import { AppModule } from './app.module';

await runNodejsApplication(AppModule, {
  port: 3000,
  globalPrefix: 'api',
  shutdownSignals: ['SIGINT', 'SIGTERM'],
});
```

## Behavioral Contracts

- `createNodejsAdapter(options)` is the adapter-first entrypoint for running fluo directly on Node's built-in `http` or `https` server primitives.
- `maxBodySize` is enforced while raw Node request bytes are still streaming, and it becomes the default multipart total-size cap unless `multipart.maxTotalSize` is explicitly provided through the bootstrap/run helpers.
- `bootstrapNodejsApplication(module, options)` creates an application with the raw Node adapter but does not start listening, so the caller owns the subsequent `app.listen()` and `app.close()` lifecycle.
- `runNodejsApplication(module, options)` bootstraps, starts, and wires graceful shutdown. When signal-driven shutdown times out or fails, it logs the condition and sets `process.exitCode`; final process termination remains owned by the host process.
- Advanced compression and shutdown utility functions remain on `@fluojs/runtime/node` or internal runtime seams rather than this primary platform startup surface.

## Public API Overview

- `createNodejsAdapter(options)`: Primary factory for the raw Node.js HTTP adapter.
- `bootstrapNodejsApplication(module, options)`: Creates an application instance without starting the listener.
- `runNodejsApplication(module, options)`: Bootstraps and starts the application with lifecycle management.
- `BootstrapNodejsApplicationOptions`: Options for bootstrap-only Node.js application creation.
- `NodejsAdapterOptions`: Transport-level options for `createNodejsAdapter(...)`, including `port`, `host`, `https`, `maxBodySize`, retry settings, raw body preservation, and shutdown timeout.
- `NodejsApplicationSignal`: Supported signal names for `runNodejsApplication(...)` shutdown registration.
- `NodejsHttpApplicationAdapter`: Type-only alias describing the adapter instances returned by `createNodejsAdapter(...)`, while preserving the public adapter surface exported from `@fluojs/runtime/node`.
- `RunNodejsApplicationOptions`: Options for one-call bootstrap, listen, and graceful shutdown wiring.

## Related Packages

- `@fluojs/runtime`: The core runtime facade.
- `@fluojs/websockets`: Real-time gateway support.
- `@fluojs/http`: Shared HTTP abstractions and decorators.

## Example Sources

- `packages/platform-nodejs/src/index.test.ts`
- `examples/minimal/src/main.ts` (Fastify-based, but structurally similar)
