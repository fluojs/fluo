<!-- packages: @fluojs/platform-deno, @fluojs/runtime, @fluojs/http -->
<!-- project-state: FluoShop v2.5.0 -->

# Chapter 23. Porting to Deno

This chapter explains how to move FluoShop to the Deno runtime and work with its security permission model and Web-standard execution environment. Chapter 22 showed Bun's high-performance runtime port. This chapter validates the standard-first philosophy on top of a stricter security model.

## Learning Objectives
- Understand why Deno fits well with the fluo architecture.
- Learn how to run an application with `@fluojs/platform-deno` and `runDenoApplication`.
- Learn how to interpret Deno permission flags in relation to FluoShop operational requirements.
- Review the Web-standard `Request` and `Response` based dispatch flow.
- Confirm how Deno-native WebSockets integrate with fluo gateways.
- Summarize import rules, permissions, and driver compatibility checks for a Deno port.

## Prerequisites
- Completion of Chapter 21 and Chapter 22.
- Experience installing Deno and using the basic `deno run` command.
- Operational awareness of managing environment variables, file access, and network permissions separately.

## 23.1 Why Deno for fluo?

- **Security**: Network, file, and environment variable access are controlled with explicit permissions.
- **Native TypeScript**: You can run `.ts` files directly without a hidden `tsc` step.
- **Web Standards**: Browser-like `fetch`, `Request`, and `Response` APIs sit at the center of the server runtime.
- **Single Binary**: You can bundle an app into a single executable or run it directly from a remote URL.
- **Built-in Tooling**: A formatter, linter, and test runner are included by default, reducing separate tool combinations.
- **No node_modules**: URL-based imports or `deno.json` import maps make dependency boundaries explicit.

## 23.2 The Deno Adapter

The `@fluojs/platform-deno` package provides the integration needed for fluo applications to run on `Deno.serve`.

### 23.2.1 Installation

Deno handles dependencies differently. You can use the `deno add` command or import directly in code with `npm:` specifiers.

```bash
deno add npm:@fluojs/platform-deno npm:@fluojs/runtime npm:@fluojs/http
```

Alternatively, you can manage them in a `deno.json` file for a more structured approach. The important point is that dependency boundaries are expressed more clearly through imports and configuration files than through an installation folder.

### 23.2.2 Bootstrapping FluoShop on Deno

Because of Deno's module resolution and permission model, its entrypoint looks different from a Node.js entrypoint. Rather than hiding that difference, fluo provides the `runDenoApplication` helper so it can be treated as an explicit execution boundary.

```typescript
// main.ts
import { runDenoApplication } from '@fluojs/platform-deno';
import { AppModule } from './app.module.ts';

await runDenoApplication(AppModule, {
  port: 3000,
});
```

To run this application, you must explicitly provide the required permissions. In Deno, this permission list becomes part of the operational contract.

```bash
deno run --allow-net --allow-read --allow-env main.ts
```

If a flag is missing, Deno prompts at runtime or exits with a clear error. It is safer to treat missing permissions as configuration problems that should surface before deployment. The run command itself becomes documentation for the resources the application is allowed to access.

## 23.3 Web Standards and Request Dispatching

Deno is built on Web standards, so it fits naturally with fluo's internal Dispatcher. The framework handles native `Request` and `Response` objects throughout the lifecycle, and you can also manually process requests with the adapter's `handle()` method. This approach is useful when configuring tests or serverless-style execution.

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

Alignment with Web standards makes the runtime boundary of fluo apps running on Deno easier to read.

## 23.4 Native Deno WebSockets

Like Bun, Deno provides its own WebSocket implementation through `Deno.upgradeWebSocket`. fluo provides a runtime-specific path for this so gateway code does not become tied to platform upgrade details.

```typescript
// When the Deno adapter is active, gateways automatically use Deno's native upgrade.
import { Module } from '@fluojs/core';
import { OnMessage, WebSocketGateway } from '@fluojs/websockets';
import { DenoWebSocketModule } from '@fluojs/websockets/deno';

@WebSocketGateway({ path: '/ws' })
export class MyGateway {
  @OnMessage('ping')
  handlePing() {
    return { event: 'pong', data: 'hello from deno' };
  }
  // fluo handles Deno-native upgrades internally.
}

@Module({
  imports: [DenoWebSocketModule.forRoot()],
  providers: [MyGateway],
})
export class RealtimeModule {}
```

## 23.5 Handling Deno Permissions in FluoShop

When building microservices on Deno, follow the principle of least privilege. Specify concrete permissions instead of broad flags.

- **`--allow-net=0.0.0.0:3000,database.host:5432`**: Restricts network access to the listener port and a specific database server.
- **`--allow-read=./config,./static`**: Restricts file access to specific directories that contain configuration files or static assets.
- **`--allow-env=PORT,DATABASE_URL`**: Restricts access to only the environment variable keys the application needs.

Fluo's `ConfigModule` works with Deno environment variable access when permission is granted. The important point is that environment variable access itself appears in the deployment command's permission list. Because reading configuration is part of the permission contract, operators can see which environment values the application depends on directly in the deploy command.

## 23.6 Porting Checklist for Deno

1. **Imports**: Include file extensions in all local imports, for example `./user.service.ts`. Deno does not allow extensionless imports.
2. **NPM Compatibility**: Most npm packages work through `npm:` imports, but packages that depend on complex Node-native C++ APIs that Deno's Node compatibility layer may not support yet require verification.
3. **Async Initialization**: Deno favors top-level `await`, which fits well with `fluoFactory.create()`.
4. **Environment Variables**: Use `Deno.env.get()` if direct access is required, but `ConfigService` is recommended for portability.

## 23.7 Conclusion

Deno provides a security-centered, standards-centered execution environment that complements fluo's architectural goals. Porting FluoShop to Deno lets you operate permission models and tooling boundaries more explicitly.

Next, we'll extend the same portability principle to edge execution environments with **Cloudflare Workers**.

---

*The following sections supplement the security, data, and testing boundaries operators should review during a Deno port.*

Deno's security approach differs from Node.js's default-allow model. It requires explicit flags for every resource access, so you include the principle of least privilege in the design from the start of development and deployment. In FluoShop, database connection information, network endpoints, and file access scopes can be checked again as runtime permissions. This default security model is especially valuable in multi-tenant environments or environments that handle sensitive data.

Using URL-based imports or `deno.json` with `npm:` specifiers instead of a `node_modules` folder changes the shape of the deployment pipeline. Instead of copying a large dependency tree during container builds, you manage reproducibility around Deno's cache and lockfile. This approach can become simpler, but you must also decide on a cache strategy and external registry access policy.

Deno's Web API support also reduces conceptual friction when fluo code moves to other standards-compliant runtimes. Using APIs such as `Streams`, `TextEncoder`, and `Headers` narrows the model gap between server and browser, and makes the transformations the adapter must own clearer.

## 23.8 Advanced: Deno and FluoShop Databases

When running Deno, database driver choices need to account for the security model and native runtime characteristics.

### 23.8.1 Using Deno KV

If you need Deno-native storage, you can review Deno's built-in KV store. Deno KV is a key-value store included in the runtime and can be a suitable option for small state or cache-like data. For core order data where relationships and transaction policy matter, compare it carefully with the existing database choices.

```typescript
import { OnModuleInit } from '@fluojs/core';

declare const Deno: {
  openKv(): Promise<{
    set(key: string[], value: unknown): Promise<void>;
    get(key: string[]): Promise<{ value: unknown }>;
  }>;
};

export class CacheService implements OnModuleInit {
  private kv!: Awaited<ReturnType<typeof Deno.openKv>>;

  async onModuleInit() {
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

If you need a traditional database, you can review a Node-compatible driver through `npm:pg` or a Deno-specific driver such as `deno_postgres`. fluo persistence modules should be designed to separate driver selection from service logic.

```typescript
// Integration inside a fluo Provider using a Deno-native driver
import { Client } from "https://deno.land/x/postgres/mod.ts";
```

## 23.9 Testing in Deno

Deno's built-in test runner can be used without separate Jest or Vitest dependencies. When using fluo testing utilities with `Deno.test`, include permission flags and import paths in the test environment as well.

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
- **Modernity**: Built-in support for modern TypeScript features and Web APIs.
- **Efficiency**: No build step is required for development or deployment.
- **Standard-First**: Fits well with fluo's design philosophy of organizing backend development around standard APIs.

Porting FluoShop to Deno gives you an operational model that manages permissions, imports, and testing boundaries more explicitly. This shows that fluo portability is not just adapter replacement; it is runtime contract validation.

## 23.11 Key Takeaways

- Deno has stronger default security and native TypeScript support, so complex toolchains are not required.
- `@fluojs/platform-deno` uses `Deno.serve` and supports Web standards across the stack.
- Run the application with explicit permissions through `--allow-*` flags to follow the principle of least privilege.
- Native Deno WebSockets are automatically supported through fluo's gateway system.
- Top-level `await` and `npm:` imports simplify dependency management and bootstrap.
- Deno KV and other native APIs are safer to integrate behind Provider boundaries in fluo services.
- Porting to Deno is an important step toward making FluoShop a modern, standards-compliant application.

## 23.12 The Deno Ecosystem for FluoShop

Beyond the runtime, Deno provides tools that tie development and operations together. For example, `deno task` lets you define automation commands without `package.json` scripts. A `start:fluoshop` task that includes the required `--allow-*` flags makes it easier to align execution conditions between development and deployment environments.

Deno documentation (`deno doc`) and linting (`deno lint`) also run inside the same tool system. Adopting Deno for FluoShop is not just changing the runtime; it is organizing permissions, documentation, and verification into one operational model.
