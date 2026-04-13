# @fluojs/platform-nodejs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Raw Node.js HTTP adapter package for the fluo runtime.

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

```typescript
import { runNodejsApplication } from '@fluojs/platform-nodejs';
import { AppModule } from './app.module';

await runNodejsApplication(AppModule, {
  port: 3000,
  globalPrefix: 'api',
});
```

## Public API Overview

- `createNodejsAdapter(options)`: Primary factory for the raw Node.js HTTP adapter.
- `bootstrapNodejsApplication(module, options)`: Creates an application instance without starting the listener.
- `runNodejsApplication(module, options)`: Bootstraps and starts the application with lifecycle management.
- `NodejsHttpApplicationAdapter`: Type-only alias describing the adapter instances returned by `createNodejsAdapter(...)`.

## Related Packages

- `@fluojs/runtime`: The core runtime facade.
- `@fluojs/websockets`: Real-time gateway support.
- `@fluojs/http`: Shared HTTP abstractions and decorators.

## Example Sources

- `packages/platform-nodejs/src/index.test.ts`
- `examples/minimal/src/main.ts` (Fastify-based, but structurally similar)
