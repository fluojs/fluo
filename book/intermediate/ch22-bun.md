<!-- packages: @fluojs/platform-bun, @fluojs/runtime, @fluojs/websockets -->
<!-- project-state: FluoShop v2.4.0 -->

# Chapter 22. Porting to Bun

This chapter explains how to move FluoShop to the Bun runtime and take advantage of high throughput and an integrated toolchain. Chapter 21 covered choosing Node.js-family adapters. This chapter moves the same application into a lighter execution flow on top of Bun.

## Learning Objectives
- Understand the advantages Bun gives to fluo application portability.
- Learn how to switch bootstrap configuration with `@fluojs/platform-bun`.
- Review Bun's native WebSocket handling and how it connects to fluo gateways.
- Learn how to integrate fluo into an existing Bun server with `createBunFetchHandler`.
- Summarize compatibility items to check when moving from Node.js to Bun.
- Analyze the performance benefits you can expect when running FluoShop on Bun.

## Prerequisites
- Completion of Chapter 21.
- Experience installing Bun and using its basic run commands.
- Basic understanding of WebSocket gateways and runtime-specific entrypoint differences.

## 22.1 Why Bun for fluo?

- **Performance**: Bun's native HTTP server is designed for low latency and fast startup time.
- **Unified Toolchain**: You can run TypeScript entrypoints directly without `ts-node` or a separate execution wrapper.
- **Modern Standards**: Bun centers Web APIs such as `Request` and `Response`, which fits well with fluo's adapter philosophy.
- **Native WebSockets**: Bun's built-in WebSocket support is useful for operating lightweight gateway-based realtime features.
- **Dependency Management**: Bun's package manager can be used alongside `pnpm` and `npm` workflows, lowering the burden of CI/CD migration.

## 22.2 The Bun Adapter

The `@fluojs/platform-bun` package is designed around the Bun runtime's `Bun.serve()` model. fluo applications can use Bun's native HTTP processing path while keeping the same controller and service structure.

### 22.2.1 Installation

To get started, install the Bun adapter in your fluo project. This package connects fluo's HTTP dispatcher to Bun's native server model.

```bash
bun add @fluojs/platform-bun
```

### 22.2.2 Bootstrapping FluoShop on Bun

To run FluoShop on Bun, change the `main.ts` entrypoint to select `createBunAdapter`. Because fluo preserves request dispatch and the DI lifecycle, the migration scope stays focused on the runtime boundary.

```typescript
// apps/fluoshop-api/src/main.ts
import { createBunAdapter } from '@fluojs/platform-bun';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

async function bootstrap() {
  const adapter = createBunAdapter({ 
    port: 3000,
    // Bun-specific options
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

Bun provides a WebSocket implementation built into the runtime. When the Bun adapter is active, fluo's WebSocket module provides runtime-specific bindings so it can use this native path.

### 22.3.1 Setting Up Native WebSockets

In fluo, WebSockets are handled through Gateways. When running on Bun, the framework connects Bun's native `Upgrade` mechanism to the gateway contract.

```typescript
import { Module } from '@fluojs/core';
import { OnConnect, WebSocketGateway } from '@fluojs/websockets';
import { BunWebSocketModule } from '@fluojs/websockets/bun';

@WebSocketGateway({ path: '/events' })
export class NotificationGateway {
  @OnConnect()
  handleConnection(client: any) {
    console.log('Client connected via Bun native WebSockets');
  }
  // fluo handles Bun-specific upgrade logic internally.
}

@Module({
  imports: [BunWebSocketModule.forRoot()],
  providers: [NotificationGateway],
})
export class RealtimeModule {}
```

Internally, the Bun adapter detects the `Upgrade` header and calls `server.upgrade(request)` as required by the Bun runtime. Application code stays inside the gateway contract, and upgrade details remain at the adapter boundary.

## 22.4 Manual Fetch Handling

Sometimes you may want to integrate fluo into an existing Bun server or a more complex setup. With `createBunFetchHandler`, you can get a native `fetch` function that can be passed to `Bun.serve()`.

```typescript
import { createBunFetchHandler } from '@fluojs/platform-bun';

// ... app bootstrap ...

const handler = await createBunFetchHandler({
  dispatcher: app.getHttpDispatcher(),
});

Bun.serve({
  fetch: handler,
  port: 3001,
});
```

This approach is useful when you need to place Bun features such as static file serving or custom routing alongside the fluo API.

## 22.5 Portability Checklist

When moving from Node.js to Bun, check these items first.

1. **Native Dependencies**: Bun supports many Node.js packages, but low-level packages that use C++ bindings require separate verification.
2. **FileSystem**: For paths where platform-specific optimization matters, review whether `Bun.file()` can be used. It is safer to keep shared service code behind fluo abstractions whenever possible.
3. **Environment Variables**: Bun loads `.env` files automatically, so you can keep `ConfigModule` configuration simpler.
4. **Testing**: You can use Bun's built-in test runner (`bun test`), but you must confirm that existing fluo contract tests preserve the same meaning.

## 22.6 FluoShop on Bun: Performance Review

After switching to Bun, FluoShop can expect these operational benefits.
- **Faster Startup**: Bun's native TS execution reduces startup time by removing a separate runtime compilation layer.
- **Higher Throughput**: The native `fetch` processing path can reduce latency under high-concurrency request traffic.
- **Simplified Deployment**: The execution model centered on a single `bun` binary can simplify container images and deployment scripts.

## 22.7 Conclusion

Bun broadens the set of JavaScript runtime choices. fluo's standard-first architecture lets you evaluate and apply these runtime characteristics without rewriting core logic.

Next, we'll look at **Deno**, another modern runtime that takes security and standards to the next level.

---

*The following sections supplement the data, Provider, and operational differences you should review during a Bun port.*

Bun's advantages are not limited to HTTP processing. With the native sqlite module, you can build shorter persistence paths for local development, testing, and small edge deployments. However, production database choices must consider not only performance but also backup, recovery, and migration policies.

When used with Drizzle, you can compare Node-based Postgres configuration and Bun-based SQLite configuration inside the same repository pattern. In fluo, it is important to keep driver-specific logic at Provider boundaries and design domain services to focus on schema and query contracts.

The Bun adapter's core responsibility is converting Bun's `Request` and `Response` objects into fluo's internal context. Thanks to this boundary, Decorators such as `@Body()` and `@Headers()` keep the same meaning even when the runtime changes. When evaluating performance, measure both the cost of the conversion layer and the cost of the actual business logic.

Bun also centers the `fetch` API in server-side logic. fluo naturally uses this model by aligning its internal Dispatcher with Web-standard `Request` and `Response` objects. As a result, porting to Bun is not just a performance experiment; it is a process for validating standard-based runtime boundaries.

## 22.8 Advanced Bun Features in fluo

Bun runtime features are worth reviewing for data paths beyond HTTP as well.

### 22.8.1 Bun SQL with Drizzle

If you use Drizzle (covered in Chapter 20), you can evaluate `bun:sqlite` or native SQL drivers by wrapping them as separate Providers.

```typescript
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

const sqlite = new Database('fluoshop.db');
const db = drizzle(sqlite);
```

Injecting this driver into a fluo Provider lets you keep type safety and repository boundaries while using Bun's SQLite implementation.

### 22.8.2 Environment-Specific Providers

If you need to swap Providers by runtime, use fluo's DI system. Platform-specific features such as Bun's file system API preserve portability when kept behind this kind of boundary. Service code can express the file operation it needs, while the actual implementation is chosen for the runtime.

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

The process for moving FluoShop to Bun can be summarized as follows.
1. Install Bun and the `@fluojs/platform-bun` package.
2. Replace `@fluojs/platform-fastify` or `@fluojs/platform-express` with `@fluojs/platform-bun` in `main.ts`.
3. Update the `bootstrap()` function to use the new adapter.
4. Start the application with the `bun run src/main.ts` command.

This procedure stays short because fluo's **Behavioral Contract Policy** keeps the meaning of core Decorators and services outside the runtime. If GET request handling and service injection mean the same thing, switching to Bun becomes a matter of verifying the adapter and operational settings rather than the entire codebase.

## 22.10 Key Takeaways

- Bun provides high performance and a modern development experience by unifying the toolchain.
- `@fluojs/platform-bun` connects Bun's native `Bun.serve()` model to the fluo lifecycle.
- Bun WebSockets are connected through a runtime-specific path via fluo's gateway system.
- Thanks to the adapter pattern, standard fluo code remains unchanged when moving to Bun.
- Use `createBunFetchHandler` to embed fluo in custom server setups or other apps.
- Bun's native SQLite and FileSystem support is safer to use behind runtime-aware Providers.
- Portability is not a later add-on in fluo; it is a core feature.

## 22.11 Troubleshooting Common Bun Issues

Bun provides high compatibility with Node.js, but differences can appear around legacy modules or low-level APIs. When moving an app with many dependencies, such as FluoShop, check these items separately.

1. **Top-Level Await**: Bun supports this natively, but when mixing it with old CommonJS modules, you must verify initialization order.
2. **Buffer vs Uint8Array**: Bun prefers `Uint8Array` for performance. It supports `Buffer` for compatibility, but using the Web-standard `Uint8Array` where possible can give fluo handlers better performance.
3. **Signal Handling**: Bun's `process.on('SIGINT', ...)` works, but make sure shutdown handlers can finish asynchronous cleanup.

Checking these differences in advance makes a Bun deployment a stable operational option rather than just a performance experiment.
