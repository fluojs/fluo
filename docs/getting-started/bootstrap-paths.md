# bootstrap paths

<p><strong><kbd>English</kbd></strong> <a href="./bootstrap-paths.ko.md"><kbd>한국어</kbd></a></p>

fluo is built on a **runtime-agnostic core**. This means you can write your business logic once and deploy it to virtually any TypeScript-capable environment using dedicated platform adapters.

> This page describes the broader adapter ecosystem after bootstrapping. For the exact starter choices that `fluo new` scaffolds today, see the [fluo new support matrix](../reference/fluo-new-support-matrix.md).

### who this is for
Developers moving beyond the local Fastify starter who need to target specific environments like Bun, Deno, or Edge functions.

### 1. the adapter pattern
Every fluo app starts with `FluoFactory.create()`. The second argument includes a **Platform Adapter**, which bridges the framework to the underlying runtime's HTTP server.

```ts
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app';
import { createFastifyAdapter } from '@fluojs/platform-fastify';

const app = await FluoFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});
await app.listen();
```

Switching runtimes is a one-line change — replace the adapter import and call, and everything else stays the same.

### 2. standard node.js paths

**Fastify** (`@fluojs/platform-fastify`) — the default and recommended path for Node.js. High performance and compatible with the vast Fastify plugin ecosystem.

```ts
import { createFastifyAdapter } from '@fluojs/platform-fastify';

const app = await FluoFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});
```

**Express** (`@fluojs/platform-express`) — best for projects that rely heavily on legacy Express middleware.

```ts
import { createExpressAdapter } from '@fluojs/platform-express';

const app = await FluoFactory.create(AppModule, {
  adapter: createExpressAdapter({ port: 3000 }),
});
```

**Raw Node** (`@fluojs/platform-nodejs`) — use this for the absolute lowest overhead on Node.js using native `http.createServer`.

```ts
import { createNodeAdapter } from '@fluojs/platform-nodejs';

const app = await FluoFactory.create(AppModule, {
  adapter: createNodeAdapter({ port: 3000 }),
});
```

### 3. modern runtimes
Targeting something other than Node.js? Swap the adapter and keep your code.

**Bun** (`@fluojs/platform-bun`) — uses Bun's native high-speed HTTP server.

```ts
import { createBunAdapter } from '@fluojs/platform-bun';

const app = await FluoFactory.create(AppModule, {
  adapter: createBunAdapter({ port: 3000 }),
});
```

**Deno** (`@fluojs/platform-deno`) — fully compatible with Deno's standard library and security model.

```ts
import { createDenoAdapter } from '@fluojs/platform-deno';

const app = await FluoFactory.create(AppModule, {
  adapter: createDenoAdapter({ port: 3000 }),
});
```

### 4. edge & serverless
For "zero-cold-start" environments, fluo provides specialized adapters that handle the specific fetch-event lifecycle of Edge runtimes.

**Cloudflare Workers** (`@fluojs/platform-cloudflare-workers`) — integrated with the Workers environment and KV/Durable Objects.

```ts
import { createWorkersAdapter } from '@fluojs/platform-cloudflare-workers';

const app = await FluoFactory.create(AppModule, {
  adapter: createWorkersAdapter(),
});
export default app.handler;
```

### choosing your runtime
The table below is an adapter ecosystem guide, not a list of current `fluo new` starter presets.

| adapter | package | best for |
| :--- | :--- | :--- |
| **Fastify** | `@fluojs/platform-fastify` | Production-grade Node.js apps, default choice. |
| **Express** | `@fluojs/platform-express` | Legacy migration, maximum middleware compatibility. |
| **Raw Node** | `@fluojs/platform-nodejs` | Minimum overhead, native `http.createServer`. |
| **Bun** | `@fluojs/platform-bun` | Maximum local performance and developer speed. |
| **Deno** | `@fluojs/platform-deno` | Secure-by-default, no-node_modules environments. |
| **Cloudflare** | `@fluojs/platform-cloudflare-workers` | Global edge distribution, zero-cold-start. |

### what stays the same across runtimes
Your `AppModule`, controllers, services, DI wiring, guards, interceptors, and middleware all remain identical regardless of which adapter you choose. The adapter only changes the HTTP ingress layer — everything above it is portable.

```ts
// This module works on every runtime without modification
@Module({
  imports: [RuntimeHealthModule, UsersModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

### next steps
- **Master the CLI**: See how the [Generator Workflow](./generator-workflow.md) works across all runtimes.
- **Check starter reality first**: Review the [fluo new support matrix](../reference/fluo-new-support-matrix.md) before assuming an adapter already has a starter preset.
- **Deep Dive**: Read the [Package Surface](../reference/package-surface.md) for a full matrix of available adapters and their capabilities.
