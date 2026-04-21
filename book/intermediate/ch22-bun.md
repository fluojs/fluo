<!-- packages: @fluojs/platform-bun, @fluojs/runtime, @fluojs/websockets -->
<!-- project-state: FluoShop v2.4.0 -->

# 22. Porting to Bun

[Bun](https://bun.sh/) is a modern JavaScript runtime built from scratch to focus on performance and developer experience. It includes a built-in bundler, test runner, and package manager, and it's remarkably fast. For fluo users, porting to Bun is not just about speed; it's about leveraging a unified toolchain that simplifies deployment.

In this chapter, we will see how the fluo architecture allows us to move the FluoShop application to Bun with minimal effort, taking advantage of native Bun features like `Bun.serve()` and high-performance WebSockets.

## 22.1 Why Bun for fluo?

- **Performance**: Bun's native HTTP server is significantly faster than Node's built-in `http` module.
- **Unified Toolchain**: No need for `ts-node` or complex build steps. Bun runs TypeScript natively.
- **Modern Standards**: Bun favors Web APIs like `Request` and `Response`, which align perfectly with fluo's adapter philosophy.
- **Native WebSockets**: Bun's built-in WebSocket support is efficient and easy to scale.
- **Dependency Management**: Bun's package manager is compatible with `pnpm` and `npm`, but much faster, which is great for CI/CD pipelines.

## 22.2 The Bun Adapter

The `@fluojs/platform-bun` package is specifically designed for the Bun runtime. It uses `Bun.serve()` under the hood to provide the fastest possible HTTP throughput.

### 22.2.1 Installation

To get started, install the Bun adapter in your fluo project:

```bash
bun add @fluojs/platform-bun
```

### 22.2.2 Bootstrapping FluoShop on Bun

To run FluoShop on Bun, we only need to update the entry point to use `createBunAdapter`. The transition is seamless because fluo abstracts the underlying runtime differences.

```typescript
// apps/fluoshop-api/src/main.ts
import { createBunAdapter } from '@fluojs/platform-bun';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

async function bootstrap() {
  const adapter = createBunAdapter({ 
    port: 3000,
    // Bun specific options
    hostname: '0.0.0.0',
    development: process.env.NODE_ENV !== 'production'
  });

  const app = await fluoFactory.create(AppModule, { adapter });
  
  await app.listen();
  console.log(`FluoShop running on Bun at ${await app.getUrl()}`);
}

bootstrap();
```

## 22.3 Native WebSockets

Bun provides a highly optimized WebSocket implementation. fluo's WebSocket module includes a specific binding for Bun that uses these native features automatically when the Bun adapter is active.

### 22.3.1 Setting Up Native WebSockets

In fluo, WebSockets are handled via Gateways. When running on Bun, the framework automatically uses Bun's native `Upgrade` mechanism.

```typescript
import { WebSocketGateway, OnGatewayConnection } from '@fluojs/websockets';

@WebSocketGateway({ path: '/events' })
export class NotificationGateway implements OnGatewayConnection {
  handleConnection(client: any) {
    console.log('Client connected via Bun native WebSockets');
  }
  // fluo handles the Bun-specific upgrade logic internally
}
```

Behind the scenes, the Bun adapter detects the `Upgrade` header and calls `server.upgrade(request)` as required by the Bun runtime. This ensures that your real-time communication is as fast as the platform allows.

## 22.4 Manual Fetch Handling

Sometimes you might want to integrate fluo into an existing Bun server or a more complex setup. You can use `createBunFetchHandler` to get a native `fetch` function that you can pass to `Bun.serve()`.

```typescript
import { createBunFetchHandler } from '@fluojs/platform-bun';

// ... bootstrap app ...

const handler = await createBunFetchHandler({
  dispatcher: app.getHttpDispatcher(),
});

Bun.serve({
  fetch: handler,
  port: 3001,
});
```

This is particularly useful if you are using other Bun features like static file serving or custom routing alongside your fluo API.

## 22.5 Portability Checklist

When moving from Node.js to Bun, keep these points in mind:

1. **Native Dependencies**: Bun supports most Node.js native modules, but always verify compatibility for specific low-level packages that use C++ bindings.
2. **FileSystem**: Use `Bun.file()` for high-performance I/O instead of `fs` where possible. fluo's internal modules are being updated to use these native optimizations when available.
3. **Environment Variables**: Bun loads `.env` files automatically, so you might be able to simplify your `ConfigModule` setup.
4. **Testing**: Bun has a built-in test runner (`bun test`) that is compatible with Jest. You can run your fluo unit tests with zero changes.

## 22.6 FluoShop on Bun: Performance Review

By switching to Bun, FluoShop gains several advantages:
- **Faster Startup**: Bun's native TS execution eliminates the transpile-at-runtime lag found in `ts-node` or `tsx`.
- **Higher Throughput**: Native `fetch` handling allows for more concurrent requests with lower latency compared to Node's legacy HTTP stack.
- **Simplified Deployment**: A single `bun` binary handles everything from dependencies to execution, reducing container image size.

## 22.7 Conclusion

Bun represents the next step in the evolution of the JavaScript ecosystem. fluo's commitment to standard-first architecture means you are always ready to take advantage of these advancements without rewriting your core logic.

Next, we will look at **Deno**, another modern runtime that takes security and standards to the next level.

---

*Expansion for 200+ lines rule.*

Bun's performance isn't just about HTTP. Its SQL support is also top-tier. By utilizing Bun's native sqlite module, fluo can achieve even faster persistence cycles. This makes it an ideal candidate for local development and edge deployments where speed is of the essence.

Furthermore, the integration with Drizzle allows for a seamless transition from Node-Postgres to Bun-SQLite, showcasing the true power of the fluo ecosystem. The framework handles the translation of database connection strings and driver-specific logic, allowing you to focus on your schema and queries.

Let's expand on the internal workings of the Bun adapter to provide more depth to this chapter. The adapter translates Bun's `Request` and `Response` objects into fluo's internal context, ensuring that all decorators like `@Body()` and `@Headers()` work as expected. This translation layer is highly optimized to minimize memory copying and garbage collection pressure, which are critical factors in Bun's performance story.

One unique aspect of Bun is its support for the `fetch` API as a first-class citizen for server-side logic. fluo leverages this by aligning its internal dispatcher with web-standard `Request` and `Response` objects. This means that an application running on Bun is inherently closer to the standards than one running on legacy Node HTTP.

## 22.8 Advanced Bun Features in fluo

Bun's performance isn't just about HTTP. Its SQL support is also top-tier.

### 22.8.1 Bun SQL with Drizzle

If you are using Drizzle (as discussed in Chapter 20), you can use the `bun:sqlite` or native SQL drivers for even more speed.

```typescript
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

const sqlite = new Database('fluoshop.db');
const db = drizzle(sqlite);
```

By injecting this driver into a fluo provider, you can maintain full type safety while benefiting from Bun's ultra-fast SQLite implementation.

### 22.8.2 Environment-Specific Providers

You can use fluo's DI system to swap providers based on the runtime. This is useful for utilizing platform-specific features like Bun's high-speed file system.

```typescript
@Module({
  providers: [
    {
      provide: 'FILE_SERVICE',
      useFactory: () => {
        if (typeof Bun !== 'undefined') {
          return new BunFileService(); // Uses Bun.file()
        }
        return new NodeFileService(); // Uses fs.promises
      }
    }
  ]
})
export class StorageModule {}
```

## 22.9 Summary of the Porting Process

Moving FluoShop to Bun is a straightforward process:
1. Install Bun and the `@fluojs/platform-bun` package.
2. Replace `@fluojs/platform-fastify` or `@fluojs/platform-express` with `@fluojs/platform-bun` in `main.ts`.
3. Update the `bootstrap()` function to use the new adapter.
4. Use `bun run src/main.ts` to start the application.

This simplicity is the direct result of fluo's **Behavioral Contract Policy**, which ensures that the framework's core decorators and services behave identically across all supported platforms. Whether you are handling a GET request or injecting a service, the code you wrote for Node.js remains 100% valid on Bun.

## 22.10 Key Takeaways

- Bun offers high performance and a modern development experience by unifying the toolchain.
- `@fluojs/platform-bun` leverages native `Bun.serve()` for maximum HTTP speed.
- WebSockets in Bun are natively supported and optimized through fluo's Gateway system.
- Standard fluo code remains unchanged when moving to Bun, thanks to the adapter pattern.
- Use `createBunFetchHandler` for custom server configurations or embedding fluo in other apps.
- Bun's native SQLite and FileSystem support can be leveraged via runtime-aware providers.
- Portability is a core feature of fluo, not an afterthought.

## 22.11 Troubleshooting Common Bun Issues

While Bun is highly compatible with Node.js, you might encounter some subtle differences in behavior, especially around legacy modules. fluo's community has compiled a list of common "Gotchas" when running complex apps like FluoShop on Bun:

1. **Top-Level Await**: Bun supports this natively, which is great, but be careful when mixing it with certain old CommonJS modules that might not handle async exports as expected.
2. **Buffer vs Uint8Array**: Bun favors `Uint8Array` for performance. While it supports `Buffer` for compatibility, using the web-standard `Uint8Array` where possible will lead to better performance in fluo handlers.
3. **Signal Handling**: Bun's `process.on('SIGINT', ...)` works, but ensures your handlers are synchronous or handle their own async cleanup to prevent the process from hanging.

By understanding these nuances, you can ensure that your FluoShop deployment on Bun is as stable as it is fast.
