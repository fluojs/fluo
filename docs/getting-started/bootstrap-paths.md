# bootstrap paths

<p><strong><kbd>English</kbd></strong> <a href="./bootstrap-paths.ko.md"><kbd>한국어</kbd></a></p>

fluo is built on a **runtime-agnostic core**. This means you can write your business logic once and deploy it to virtually any TypeScript-capable environment using dedicated platform adapters.

> This page describes the broader adapter ecosystem after bootstrapping. For the exact starter choices that `fluo new` scaffolds today, see the [fluo new support matrix](../reference/fluo-new-support-matrix.md).

### who this is for
Developers moving beyond the local Fastify starter who need to target specific environments like Bun, Deno, or Edge functions.

### 1. the adapter pattern
Every fluo app starts with `fluoFactory.create()`. The second argument is a **Platform Adapter**, which bridges the framework to the underlying runtime's HTTP server.

```ts
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';
import { createFastifyAdapter } from '@fluojs/platform-fastify'; // or another adapter

const app = await fluoFactory.create(AppModule, createFastifyAdapter());
await app.listen(3000);
```

### 2. standard node.js paths
- **Fastify (`@fluojs/platform-fastify`)**: The default and recommended path for Node.js. High performance and compatible with the vast Fastify plugin ecosystem.
- **Express (`@fluojs/platform-express`)**: Best for projects that rely heavily on legacy Express middleware.
- **Raw Node (`@fluojs/platform-nodejs`)**: Use this for the absolute lowest overhead on Node.js using native `http.createServer`.

### 3. modern runtimes
Targeting something other than Node.js? Swap the adapter and keep your code.

- **Bun (`@fluojs/platform-bun`)**: Uses Bun's native high-speed HTTP server.
- **Deno (`@fluojs/platform-deno`)**: Fully compatible with Deno's standard library and security model.

### 4. edge & serverless
For "zero-cold-start" environments, fluo provides specialized adapters that handle the specific fetch-event lifecycle of Edge runtimes.

- **Cloudflare Workers (`@fluojs/platform-cloudflare-workers`)**: Integrated with the Workers environment and KV/Durable Objects.

### choosing your runtime
The table below is an adapter ecosystem guide, not a list of current `fluo new` starter presets.

| adapter | package | best for |
| :--- | :--- | :--- |
| **Fastify** | `@fluojs/platform-fastify` | Production-grade Node.js apps, default choice. |
| **Express** | `@fluojs/platform-express` | Legacy migration, maximum middleware compatibility. |
| **Bun** | `@fluojs/platform-bun` | Maximum local performance and developer speed. |
| **Deno** | `@fluojs/platform-deno` | Secure-by-default, no-node_modules environments. |
| **Cloudflare** | `@fluojs/platform-cloudflare-workers` | Global edge distribution, zero-cold-start. |

### next steps
- **Master the CLI**: See how the [Generator Workflow](./generator-workflow.md) works across all runtimes.
- **Check starter reality first**: Review the [fluo new support matrix](../reference/fluo-new-support-matrix.md) before assuming an adapter already has a starter preset.
- **Deep Dive**: Read the [Package Surface](../reference/package-surface.md) for a full matrix of available adapters and their capabilities.
