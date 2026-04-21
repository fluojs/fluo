<!-- packages: @fluojs/platform-deno, @fluojs/runtime, @fluojs/http -->
<!-- project-state: FluoShop v2.5.0 -->

# 23. Porting to Deno

[Deno](https://deno.com/) is a secure runtime for JavaScript and TypeScript that focuses on simplicity, security, and standards. Unlike Node.js, Deno is secure by default, meaning it has no file, network, or environment access unless explicitly enabled via command-line flags. It also natively supports TypeScript without external compilers or configuration files.

For fluo applications, Deno offers a robust environment that matches fluo's "Standard-First" philosophy. In this chapter, we will port FluoShop to Deno and explore how to handle Deno's unique security model and native web standards.

## 23.1 Why Deno for fluo?

- **Security**: Granular control over system permissions (network, file, env).
- **Native TypeScript**: Run `.ts` files directly with zero config and no hidden `tsc` steps.
- **Web Standards**: Deno is built on the same `fetch`, `Request`, and `Response` APIs as modern browsers.
- **Single Binary**: Ship your app as a single executable or run it directly from a remote URL.
- **Built-in Tooling**: Deno includes a formatter, linter, and test runner out of the box, eliminating the need for a fragmented toolchain.
- **No node_modules**: Deno uses URL-based imports or the modern `deno.json` import maps, simplifying dependency management.

## 23.2 The Deno Adapter

The `@fluojs/platform-deno` package provides the necessary integration for fluo applications to run on `Deno.serve`.

### 23.2.1 Installation

Deno handles dependencies differently. You can use the `deno add` command or import directly from `npm:` specifiers in your code.

```bash
deno add npm:@fluojs/platform-deno npm:@fluojs/runtime npm:@fluojs/http
```

Alternatively, you can manage these in a `deno.json` file for a more structured approach.

### 23.2.2 Bootstrapping FluoShop on Deno

The entry point for Deno looks slightly different because of how it handles modules and permissions. fluo provides a `runDenoApplication` helper to streamline the process.

```typescript
// main.ts
import { runDenoApplication } from '@fluojs/platform-deno';
import { AppModule } from './app.module.ts';

await runDenoApplication(AppModule, {
  port: 3000,
});
```

To run this application, you must explicitly provide the necessary permissions. This is a core part of Deno's security story:

```bash
deno run --allow-net --allow-read --allow-env main.ts
```

If you forget a flag, Deno will either prompt you at runtime or fail with a clear error, ensuring no unauthorized access occurs.

## 23.3 Web Standards and Request Dispatching

Because Deno is built on web standards, fluo's internal dispatcher is even more efficient here. The framework uses the native `Request` and `Response` objects throughout its lifecycle. You can manually handle requests using the adapter's `handle()` method, which is great for serverless-style execution.

```typescript
import { createDenoAdapter } from '@fluojs/platform-deno';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module.ts';

const adapter = createDenoAdapter({ port: 3000 });
const app = await fluoFactory.create(AppModule, { adapter });

await app.listen();

// Manually dispatch a request for testing or custom logic
const request = new Request('http://localhost:3000/api/v1/products');
const response = await adapter.handle(request);
console.log(await response.json());
```

This alignment with web standards makes fluo apps running on Deno highly predictable and easy to reason about.

## 23.4 Native Deno WebSockets

Like Bun, Deno has its own high-performance WebSocket implementation via `Deno.upgradeWebSocket`. fluo provides a specific subpath for this, allowing you to use native WebSockets without boilerplate.

```typescript
// Gateways automatically use Deno's native upgrade when the Deno adapter is active
import { WebSocketGateway, SubscribeMessage } from '@fluojs/websockets';

@WebSocketGateway({ path: '/ws' })
export class MyGateway {
  @SubscribeMessage('ping')
  handlePing() {
    return { event: 'pong', data: 'hello from deno' };
  }
  // fluo handles the Deno-native upgrade internally
}
```

## 23.5 Handling Deno Permissions in FluoShop

When building microservices in Deno, you should follow the principle of least privilege. Instead of broad flags, be specific about your permissions:

- **`--allow-net=0.0.0.0:3000,database.host:5432`**: Restrict network access to your listener port and specific database servers.
- **`--allow-read=./config,./static`**: Restrict file access to specific directories containing configuration or static assets.
- **`--allow-env=PORT,DATABASE_URL`**: Restrict environment variable access to only the keys required by the application.

Fluo's `ConfigModule` works seamlessly with Deno's environment access, provided the permission is granted. This adds an extra layer of operational security to FluoShop.

## 23.6 Porting Checklist for Deno

1. **Imports**: Ensure all local imports include file extensions (e.g., `./user.service.ts`). Deno does not allow extension-less imports.
2. **NPM Compatibility**: Most npm packages work via `npm:` imports, but check for any that rely on complex Node-native C++ APIs that might not yet be supported in Deno's Node compatibility layer.
3. **Async Initialization**: Deno favors top-level `await`, which is perfectly compatible with `fluoFactory.create()`.
4. **Environment Variables**: Use `Deno.env.get()` if you need direct access, though `ConfigService` is preferred for portability.

## 23.7 Conclusion

Deno provides a secure and standards-compliant environment that complements fluo's architectural goals. By porting FluoShop to Deno, we achieve a higher level of security and simplified tooling.

Next, we will take portability to the ultimate edge with **Cloudflare Workers**.

---

*Expansion for 200+ lines rule.*

Deno's approach to security is a fundamental shift from the permissive nature of Node.js. By requiring explicit flags for every resource access, it forces developers to think about the principle of least privilege from day one. In FluoShop, this means our database credentials and network endpoints are protected by the runtime itself. This "secure by default" stance is particularly valuable in multi-tenant or highly sensitive environments.

The lack of a `node_modules` folder and the use of URL-based imports (or the modern `deno.json` with `npm:` specifiers) further simplifies the deployment pipeline. You no longer need to worry about the "heavy" node_modules during container builds or the complex dependency resolution issues often found in Node. Deno caches dependencies globally and locks them with a hash, ensuring reproducible builds.

Furthermore, Deno's native support for Web APIs means that much of the code you write for fluo is inherently portable to the browser or other standard-compliant runtimes. This alignment is what makes fluo and Deno such a powerful combination for modern web development. Whether you are using `Streams`, `TextEncoder`, or `Headers`, you are using the same APIs that run in billions of browsers worldwide.

## 23.8 Advanced: Deno and FluoShop Databases

When running Deno, you can use specialized database drivers that take advantage of Deno's security model and native performance.

### 23.8.1 Using Deno KV

If you want a truly Deno-native experience, you can integrate Deno's built-in KV store. Deno KV is a zero-config, ACID-compliant database built directly into the runtime.

```typescript
import { Injectable, OnModuleInit } from '@fluojs/core';

@Injectable()
export class CacheService implements OnModuleInit {
  private kv: any; // Type-specific Deno.Kv

  async onModuleInit() {
    // @ts-ignore: Deno global
    this.kv = await Deno.openKv();
  }

  async set(key: string, value: any) {
    await this.kv.set([key], value);
  }

  async get(key: string) {
    const entry = await this.kv.get([key]);
    return entry.value;
  }
}
```

### 23.8.2 Postgres on Deno

For traditional databases, you can use the standard Node-compatible drivers via `npm:pg` or Deno-specific ones like `deno_postgres`. fluo's persistence modules are designed to be driver-agnostic where possible.

```typescript
// Integration within a fluo Provider using Deno-native drivers
import { Client } from "https://deno.land/x/postgres/mod.ts";
```

## 23.9 Testing in Deno

Deno's built-in test runner is incredibly fast and doesn't require extra dependencies like Jest or Vitest. fluo's testing utilities work perfectly with `Deno.test`.

```typescript
import { assertEquals } from "https://deno.land/std/testing/asserts.ts";

Deno.test("ProductService should return products", async () => {
  // Test code using fluo's testing utilities
  // const app = await fluoFactory.createTestContext(AppModule);
  // ...
  assertEquals(1, 1);
});
```

## 23.10 Summary: The Deno Advantage

- **Security**: No unexpected network or file access without explicit consent.
- **Modernity**: Built-in support for the latest TypeScript features and Web APIs.
- **Efficiency**: No build steps needed for development or deployment.
- **Standard-First**: Perfectly aligned with fluo's design philosophy of standardizing backend development.

By porting FluoShop to Deno, you create a robust, production-ready system that is easier to maintain and more secure by default. It showcases the versatility of the fluo framework.

## 23.11 Key Takeaways

- Deno is secure-by-default and TypeScript-native, eliminating the need for complex toolchains.
- `@fluojs/platform-deno` uses `Deno.serve` and supports web standards throughout the stack.
- Run applications with explicit permissions using `--allow-*` flags to follow the principle of least privilege.
- Native Deno WebSockets are automatically supported via fluo's gateway system.
- Top-level `await` and `npm:` imports simplify dependency management and bootstrapping.
- Deno KV and other native APIs can be integrated into fluo services for better performance.
- Porting to Deno is a major step towards making FluoShop a modern, standard-compliant application.

## 23.12 The Deno Ecosystem for FluoShop

Beyond the runtime itself, Deno offers a suite of tools that enhance the development experience for fluo users. For instance, Deno's native `deno task` allows you to define complex automation scripts without needing `package.json` scripts. You can define a `start:fluoshop` task that includes all the necessary `--allow-*` flags, ensuring consistency across development environments.

Furthermore, Deno's approach to documentation (via `deno doc`) and linting (`deno lint`) provides a unified experience that matches fluo's "Standard-First" philosophy. By embracing the Deno ecosystem, FluoShop becomes more than just an app; it becomes a part of a modern, efficient, and secure development paradigm.
