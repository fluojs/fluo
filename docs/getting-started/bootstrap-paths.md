# bootstrap paths

<p><strong><kbd>English</kbd></strong> <a href="./bootstrap-paths.ko.md"><kbd>한국어</kbd></a></p>

Konekti is built on a **runtime-agnostic core**. This means you can write your business logic once and deploy it to virtually any TypeScript-capable environment using dedicated platform adapters.

### who this is for
Developers moving beyond the local Fastify starter who need to target specific environments like Bun, Deno, or Edge functions.

### 1. the adapter pattern
Every Konekti app starts with `KonektiFactory.create()`. The second argument is a **Platform Adapter**, which bridges the framework to the underlying runtime's HTTP server.

```ts
import { KonektiFactory } from '@konekti/runtime';
import { AppModule } from './app.module';
import { createFastifyAdapter } from '@konekti/platform-fastify'; // or another adapter

const app = await KonektiFactory.create(AppModule, createFastifyAdapter());
await app.listen(3000);
```

### 2. standard node.js paths
- **Fastify (`@konekti/platform-fastify`)**: The default and recommended path for Node.js. High performance and compatible with the vast Fastify plugin ecosystem.
- **Express (`@konekti/platform-express`)**: Best for projects that rely heavily on legacy Express middleware.
- **Raw Node (`@konekti/platform-nodejs`)**: Use this for the absolute lowest overhead on Node.js using native `http.createServer`.

### 3. modern runtimes
Targeting something other than Node.js? Swap the adapter and keep your code.

- **Bun (`@konekti/platform-bun`)**: Uses Bun's native high-speed HTTP server.
- **Deno (`@konekti/platform-deno`)**: Fully compatible with Deno's standard library and security model.

### 4. edge & serverless
For "zero-cold-start" environments, Konekti provides specialized adapters that handle the specific fetch-event lifecycle of Edge runtimes.

- **Cloudflare Workers (`@konekti/platform-cloudflare-workers`)**: Integrated with the Workers environment and KV/Durable Objects.

### choosing your runtime
| adapter | package | best for |
| :--- | :--- | :--- |
| **Fastify** | `@konekti/platform-fastify` | Production-grade Node.js apps, default choice. |
| **Express** | `@konekti/platform-express` | Legacy migration, maximum middleware compatibility. |
| **Bun** | `@konekti/platform-bun` | Maximum local performance and developer speed. |
| **Deno** | `@konekti/platform-deno` | Secure-by-default, no-node_modules environments. |
| **Cloudflare** | `@konekti/platform-cloudflare-workers` | Global edge distribution, zero-cold-start. |

### next steps
- **Master the CLI**: See how the [Generator Workflow](./generator-workflow.md) works across all runtimes.
- **Deep Dive**: Read the [Package Surface](../reference/package-surface.md) for a full matrix of available adapters and their capabilities.
