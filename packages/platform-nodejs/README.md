# @konekti/platform-nodejs

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Raw Node.js HTTP adapter package for the Konekti runtime.

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
npm install @konekti/platform-nodejs
```

## When to Use

Use this package when you want to run a Konekti application directly on the Node.js built-in `http` or `https` modules without the overhead of an intermediate framework like Express or Fastify. It is ideal for minimal footprints, custom low-level optimizations, or environments where standard Node APIs are preferred.

## Quick Start

```typescript
import { createNodejsAdapter } from '@konekti/platform-nodejs';
import { KonektiFactory } from '@konekti/runtime';
import { AppModule } from './app.module';

const app = await KonektiFactory.create(AppModule, {
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

### Direct Application Execution
You can use `runNodejsApplication` for a zero-boilerplate startup that includes graceful shutdown and logging.

```typescript
import { runNodejsApplication } from '@konekti/platform-nodejs';
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
- `NodejsHttpAdapter`: The underlying adapter class implementing `HttpApplicationAdapter`.

## Related Packages

- `@konekti/runtime`: The core runtime facade.
- `@konekti/websockets`: Real-time gateway support.
- `@konekti/http`: Shared HTTP abstractions and decorators.

## Example Sources

- `packages/platform-nodejs/src/index.test.ts`
- `examples/minimal/src/main.ts` (Fastify-based, but structurally similar)

