<!-- packages: @fluojs/platform-express, @fluojs/platform-nodejs, @fluojs/runtime -->
<!-- project-state: FluoShop v2.3.0 -->

# Chapter 21. Express and Node.js Adapters

This chapter explains how to choose between the Express and raw Node.js adapters when moving FluoShop onto Node.js-family runtimes. Chapter 20 finished the data-layer choices. This chapter organizes which HTTP engine should host that application.

## Learning Objectives
- Understand the roles of the Express Adapter and raw Node.js Adapter in fluo.
- Learn how to change bootstrap configuration with `@fluojs/platform-express` and `@fluojs/platform-nodejs`.
- Confirm the portability principle that keeps business logic unchanged after swapping adapters.
- Review situations where you need access to platform-native request and response objects.
- Learn how to model HTTP middleware and Node.js streams through the fluo flow.
- Distinguish runtime-owned diagnostic snapshots from Studio-owned graph and Mermaid presentation.
- Summarize the checklist for moving FluoShop to an Express-based runtime environment.

## Prerequisites
- Completion of Chapter 18, Chapter 19, and Chapter 20.
- Node.js 20 or newer for both `@fluojs/platform-express` and `@fluojs/platform-nodejs`.
- Basic understanding of Node.js HTTP servers and Express middleware.
- TypeScript familiarity with reading application entrypoints and runtime adapter configuration.

## 21.1 The Express Adapter

Express is still the most widely used framework in the Node.js ecosystem. If existing Express infrastructure is part of your operational path, or if you need to move a legacy Express app into fluo gradually, `@fluojs/platform-express` is a practical entry point.

The Express adapter targets Node.js 20 or newer and its package manifest declares `engines.node >=20.0.0`.

### 21.1.1 Installation

To use Express, you need both the fluo adapter and the `express` package. The adapter connects fluo's HTTP contract to the Express execution model, while `express` provides the actual Node.js server behavior.

```bash
npm install @fluojs/platform-express express
```

### 21.1.2 Bootstrapping with Express

Switch to Express only after the application layer has moved off NestJS metadata semantics. Controllers and providers must use TC39 standard decorators, class-level `@Inject(...)`, and explicit DI/module wiring before the entrypoint changes its HTTP adapter. Once that migration is complete, business logic can stay unchanged while only the host engine boundary is replaced; changing the adapter alone does not preserve NestJS legacy decorators, reflection metadata, or implicit dependency discovery.

```typescript
import {
  createExpressAdapter,
  ExpressHttpApplicationAdapter,
} from '@fluojs/platform-express';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

async function bootstrap() {
  const adapter = createExpressAdapter({ 
    port: 3000,
    rawBody: true 
  });

  const app = await fluoFactory.create(AppModule, { adapter });
  
  await app.listen();

  if (!(adapter instanceof ExpressHttpApplicationAdapter)) {
    throw new TypeError('Expected the Express adapter factory to return the Express implementation');
  }

  // Resolve the actual target after startup, including an OS-assigned port.
  const { bindTarget, url } = adapter.getListenTarget();
  console.log(`Listening on ${url} (${bindTarget})`);
}
bootstrap();
```

`createExpressAdapter()` intentionally exposes the shared `HttpApplicationAdapter` return type. Narrow it with the exported `ExpressHttpApplicationAdapter` class before accessing the Express-only `getListenTarget()` helper. The helper reports the resolved bind target and public URL after startup. Keep it, `getServer()`, and `getRealtimeCapability()` at infrastructure boundaries such as startup logging, probes, or realtime integration; ordinary controllers and providers should stay on portable fluo contracts.

### 21.1.3 Handling Middleware

One of the biggest reasons to choose Express is its proven operational ecosystem. In fluo, that compatibility is an adapter and hosting boundary: Express owns the underlying Node.js request listener, but the application pipeline remains dispatcher-owned. fluo's application-level `middleware` option still expects fluo middleware: an object or provider that implements `handle(context, next)` over the shared `MiddlewareContext`. Do not pass an Express/Connect `(req, res, next)` function such as `compression()` directly to `fluoFactory.create(...)`; wrap that behavior behind the fluo contract or keep it in an Express-owned integration layer.

```typescript
import type { Middleware } from '@fluojs/http';

const compressionHeaders: Middleware = {
  async handle(context, next) {
    context.response.setHeader('vary', 'Accept-Encoding');
    await next();
  },
};

const adapter = createExpressAdapter();
const app = await fluoFactory.create(AppModule, {
  adapter,
  middleware: [compressionHeaders],
});
```

For long-term portability, prefer middleware written to the fluo contract or registered through the fluo Module system. If a migration must keep a native Express/Connect handler, put it on the adapter's explicit pre-router seam:

```typescript
import type { RequestHandler } from 'express';

const legacyHeaders: RequestHandler = (_request, response, next) => {
  response.setHeader('x-legacy-host', 'express');
  next();
};

const adapter = createExpressAdapter({
  nativeMiddleware: [legacyHeaders],
  port: 3000,
});
```

Handlers in `nativeMiddleware` run in array order before Express Router and the catch-all fluo dispatcher. Calling `next()` enters the ordinary fluo pipeline; ending the response skips fluo dispatch. Native throws, rejected promises, and `next(error)` stay in the Express error chain, so put a native error handler after the middleware it handles when needed. The adapter closes its Node listener and connections, but resources captured by native handlers remain application-owned and need explicit cleanup. Keep request-context mutation, auth, and route behavior in fluo middleware, guards, or interceptors so the platform-specific boundary remains clear when moving to another runtime.

## 21.2 The Raw Node.js Adapter

When you need to minimize footprint as much as possible, or when you need to design operational boundaries directly on top of the Node.js standard library, `@fluojs/platform-nodejs` is the right fit. This adapter provides an HTTP/HTTPS bridge with the framework layer kept minimal.

`@fluojs/platform-nodejs` targets Node.js 20 or newer. Its package manifest declares `engines.node >=20.0.0`, so use one of the fetch-style runtime adapters instead when the host is Bun, Deno, or Cloudflare Workers.

### 21.2.1 Why Go Raw?

- **Zero Overhead**: It does not add a separate routing layer or request/response wrapping beyond the boundaries fluo requires.
- **Security**: You can manage `https` options and TLS certificates directly without depending on framework-specific abstractions.
- **Size**: It fits micro-container environments where image size and cold starts matter.

### 21.2.2 Setup

```typescript
import { createNodejsAdapter } from '@fluojs/platform-nodejs';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';
import * as fs from 'fs';

async function bootstrap() {
  const adapter = createNodejsAdapter({
    port: 443,
    https: {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem'),
    },
    maxBodySize: 2_097_152,
  });

  const app = await fluoFactory.create(AppModule, { adapter });
  await app.listen();
}
```

## 21.3 Platform-Specific Responses

Sometimes you need to work a little more directly with fluo abstractions to handle streaming or specific platform behavior. In that case, it is safer to cross the platform boundary through the `RequestContext` and `FrameworkResponse` contracts instead of spreading raw request objects through handler signatures.

### 21.3.1 SSE (Server-Sent Events) in Express

The Express Adapter supports SSE through `@Sse()` and the `SseResponse` utility. For notifications or status updates that only need one-way streaming, SSE can be enough with a simpler operational model than WebSockets. `@Sse()` registers a `GET` route with `text/event-stream` metadata. Return `SseResponse` when you need manual stream ownership, or return an `AsyncIterable` when the dispatcher should encode yielded values as SSE frames. Observable return values are not converted automatically.

```typescript
import { Sse, SseResponse, type RequestContext } from '@fluojs/http';

@Sse('notifications')
async stream(_input: undefined, ctx: RequestContext) {
  const sse = new SseResponse(ctx);

  const interval = setInterval(() => {
    sse.send({ message: 'New order received!' }, { event: 'order.created' });
  }, 5000);

  const heartbeat = setInterval(() => {
    sse.comment('heartbeat');
  }, 15_000);

  ctx.request.signal?.addEventListener(
    'abort',
    () => {
      clearInterval(interval);
      clearInterval(heartbeat);
      sse.close();
    },
    { once: true },
  );

  return sse;
}
```

Browser `EventSource` clients should close the connection from the owning React effect cleanup. Because the built-in `EventSource` API cannot attach arbitrary `Authorization` headers, prefer same-origin cookies, `withCredentials` with an explicit CORS credentials policy, or short-lived signed URL/query tokens for authenticated streams. In production, keep proxy buffering and compression disabled for `text/event-stream`, keep idle timeouts above your heartbeat interval, and store enough event history to replay from `Last-Event-ID` after reconnects.

### 21.3.2 Using Raw Node streams

Even when using the Node.js Adapter, handlers should work with responses through the `FrameworkResponse` contract whenever possible and let the adapter map that result to the actual `ServerResponse`. In other words, express streaming inside the shared contract through `response.stream.write()`, `waitForDrain()`, and `close()` instead of depending directly on raw Node stream methods.

```typescript
@Get('download')
async download(_input: undefined, ctx: RequestContext) {
  const responseStream = ctx.response.stream;
  if (!responseStream) {
    throw new Error('The current adapter does not support streaming responses.');
  }

  for await (const chunk of fs.createReadStream('report.pdf')) {
    if (!responseStream.write(chunk)) {
      await responseStream.waitForDrain?.();
    }
  }

  responseStream.close();
}
```

### 21.3.3 Runtime diagnostics snapshots vs Studio rendering

Adapter choice does not change who owns diagnostics. `@fluojs/runtime` and the platform shell produce the machine-readable `PlatformShellSnapshot`, including readiness, health, component graph data, and structured diagnostic issues. `fluo inspect` exports that runtime-produced snapshot as JSON or as a report artifact for CLI, CI, and support workflows.

Visual presentation belongs elsewhere. When you request a graph view or Mermaid output, the CLI delegates rendering to `@fluojs/studio`. Studio parses and filters the runtime snapshot, owns viewer behavior, and owns the snapshot-to-Mermaid contract. This keeps Express and raw Node.js adapters focused on HTTP execution, keeps runtime focused on truthful diagnostics data, and prevents CLI or adapter packages from duplicating Studio rendering semantics.

## 21.4 Conclusion

Portability does not mean giving up the tools you prefer. fluo's adapter system separates business logic from the web engine while still letting you access the performance and ecosystem of the underlying platform when needed. In the next chapter, we'll look at the flow for moving FluoShop to the Bun runtime while keeping the same logic.

---

*The rest of this chapter organizes the Express and Node.js operational points you should actually check during the FluoShop migration in more concrete terms.*

## 21.5 FluoShop Integration: Moving to Express

When moving FluoShop to Express, the key host change point is `main.ts`, but only after controllers, providers, and modules have already moved to standard decorators and explicit DI/module wiring. With those runtime-independent contracts in place, changing the HTTP adapter should not spill into application logic changes.

```typescript
// apps/fluoshop-api/src/main.ts
import { bootstrapExpressApplication } from '@fluojs/platform-express';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const host = '127.0.0.1';
  const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;
  const app = await bootstrapExpressApplication(AppModule, {
    globalPrefix: 'v1',
    host,
    port,
  });

  await app.listen();
  console.log(`FluoShop API is running on: http://${host}:${port}/v1`);
}

bootstrap().catch(err => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
```

The route prefix belongs to the Express bootstrap configuration rather than mutable `Application` state. This example also reports the fixed host and port that it configured instead of asking `Application` to discover the listener URL. The important point here is that binding Decorators such as `@FromBody()`, `@FromPath()`, and `@FromQuery()` work through the same contract whether Fastify or Express handles the request. fluo's internal Dispatcher handles translation between the adapter's native request format and the standard fluo context. DTO validation still follows the `@fluojs/validation` contract: the HTTP binder constructs DTO instances from the selected request sources, then the validation adapter applies `@fluojs/validation` rules through the configured validator before business logic sees a typed DTO, rather than installing a Nest-style global `ValidationPipe`.

## 21.6 Advanced: The `run` Helpers

To reduce repeated bootstrap code, fluo provides the `runExpressApplication` and `runNodejsApplication` helpers, which handle signal wiring (SIGINT/SIGTERM) and graceful shutdown.

```typescript
import { runExpressApplication } from '@fluojs/platform-express';
import { AppModule } from './app.module';

await runExpressApplication(AppModule, {
  port: 3000,
  globalPrefix: 'api',
  shutdownSignals: ['SIGINT', 'SIGTERM'],
});
```

This helper wires process signals to the standard fluo shutdown lifecycle and helps clean up active connections before the host exits. Put application cleanup in lifecycle-aware providers, such as `onApplicationShutdown(signal)`, so the same cleanup path works across platform adapters. In deployment environments, this shutdown boundary is important for reducing lost logs, interrupted requests, and resource leaks.

## 21.7 Comparison Summary

| Feature | Express | Node.js (Raw) | Fastify (Default) |
| :--- | :--- | :--- | :--- |
| **Performance** | Good | Excellent | High |
| **Ecosystem** | Massive | Standard Lib | Large |
| **Middleware** | fluo contract plus opt-in pre-router native seam | Custom | fluo contract over Fastify host |
| **Footprint** | Moderate | Minimal | Moderate |
| **Best For** | Legacy Migrations | Micro-services | Standard Apps |

## 21.8 Key Takeaways

- fluo uses **Adapters** to interface with different HTTP engines.
- `@fluojs/platform-express` lets you continue using the existing Express ecosystem and operational assets.
- `nativeMiddleware` is a migration-only Express boundary with native continuation, termination, error, and resource-ownership semantics; it is not portable fluo middleware.
- `@fluojs/platform-nodejs` provides a minimal HTTP layer without a framework.
- Most fluo code (Controllers, Providers, Modules) does not need to know which adapter is running at all.
- Use `getListenTarget()` for the resolved post-startup bind target, and access `getServer()` or `getRealtimeCapability()` only at infrastructure boundaries that require platform-specific features.
- Runtime owns diagnostic snapshot and issue production; Studio owns graph viewing and Mermaid rendering of those artifacts.
- To maintain cross-platform compatibility, review fluo abstractions first, such as `MiddlewareConsumer`.
