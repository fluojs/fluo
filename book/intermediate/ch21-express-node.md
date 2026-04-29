<!-- packages: @fluojs/platform-express, @fluojs/platform-nodejs, @fluojs/runtime -->
<!-- project-state: FluoShop v2.3.0 -->

# Chapter 21. Express and Node.js Adapters

This chapter explains how to choose between the Express and raw Node.js adapters when moving FluoShop onto Node.js-family runtimes. Chapter 20 finished the data-layer choices. This chapter organizes which HTTP engine should host that application.

## Learning Objectives
- Understand the roles of the Express Adapter and raw Node.js Adapter in fluo.
- Learn how to change bootstrap configuration with `@fluojs/platform-express` and `@fluojs/platform-nodejs`.
- Confirm the portability principle that keeps business logic unchanged after swapping adapters.
- Review situations where you need access to platform-native request and response objects.
- Learn how to connect Express middleware and Node.js streams to the fluo flow.
- Summarize the checklist for moving FluoShop to an Express-based runtime environment.

## Prerequisites
- Completion of Chapter 18, Chapter 19, and Chapter 20.
- Basic understanding of Node.js HTTP servers and Express middleware.
- TypeScript familiarity with reading application entrypoints and runtime adapter configuration.

## 21.1 The Express Adapter

Express is still the most widely used framework in the Node.js ecosystem. If existing Express middleware is part of your operational path, or if you need to move a legacy Express app into fluo gradually, `@fluojs/platform-express` is a practical entry point.

### 21.1.1 Installation

To use Express, you need both the fluo adapter and the `express` package. The adapter connects fluo's HTTP contract to the Express execution model, while `express` provides the actual Node.js server behavior.

```bash
npm install @fluojs/platform-express express
```

### 21.1.2 Bootstrapping with Express

The switch to Express starts by changing the adapter selection in the application entrypoint. Controllers and services stay the same; only the HTTP engine boundary is replaced. This lets you use the Express middleware ecosystem without rewriting existing business logic.

```typescript
import { createExpressAdapter } from '@fluojs/platform-express';
import { fluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.module';

async function bootstrap() {
  const adapter = createExpressAdapter({ 
    port: 3000,
    rawBody: true 
  });

  const app = await fluoFactory.create(AppModule, { adapter });
  
  // You can still access the underlying express instance when absolutely necessary.
  const expressInstance = adapter.getInstance();
  
  await app.listen();
}
bootstrap();
```

### 21.1.3 Handling Middleware

One of the biggest reasons to choose Express is its proven middleware ecosystem. fluo's Express adapter lets you register that middleware globally or at Module boundaries, so you can migrate existing operational assets without throwing them away.

```typescript
// Apply middleware directly to the underlying instance
const adapter = createExpressAdapter();
const instance = adapter.getInstance();
instance.use(compression());
```

For long-term portability, however, it is better to register middleware inside the fluo Module system. That keeps the location of platform-specific code clear when you move to another runtime.

## 21.2 The Raw Node.js Adapter

When you need to minimize footprint as much as possible, or when you need to design operational boundaries directly on top of the Node.js standard library, `@fluojs/platform-nodejs` is the right fit. This adapter provides an HTTP/HTTPS bridge with the framework layer kept minimal.

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

The Express Adapter supports SSE through the `SseResponse` utility. For notifications or status updates that only need one-way streaming, SSE can be enough with a simpler operational model than WebSockets.

```typescript
import { Get, SseResponse, type RequestContext } from '@fluojs/http';

@Get('notifications')
async stream(_input: undefined, ctx: RequestContext) {
  const sse = new SseResponse(ctx);
  
  const interval = setInterval(() => {
    sse.send({ data: { message: 'New order received!' } });
  }, 5000);

  ctx.request.signal?.addEventListener('abort', () => clearInterval(interval), { once: true });
  
  return sse;
}
```

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

## 21.4 Conclusion

Portability does not mean giving up the tools you prefer. fluo's adapter system separates business logic from the web engine while still letting you access the performance and ecosystem of the underlying platform when needed. In the next chapter, we'll look at the flow for moving FluoShop to the Bun runtime while keeping the same logic.

---

*The rest of this chapter organizes the Express and Node.js operational points you should actually check during the FluoShop migration in more concrete terms.*

## 21.5 FluoShop Integration: Moving to Express

When moving FluoShop to Express, the key change point is `main.ts`. Controllers and services keep runtime-independent contracts, so changing the HTTP adapter should not spill into application logic changes.

```typescript
// apps/fluoshop-api/src/main.ts
import { fluoFactory } from '@fluojs/runtime';
import { createExpressAdapter } from '@fluojs/platform-express';
import { AppModule } from './app/app.module';
import { ValidationPipe } from '@fluojs/validation';
import { Logger } from '@fluojs/core';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const adapter = createExpressAdapter({
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
    cors: true,
  });

  const app = await fluoFactory.create(AppModule, { adapter });
  
  app.useGlobalPipes(new ValidationPipe());
  app.setGlobalPrefix('v1');

  await app.listen();
  logger.log(`FluoShop API is running on: ${await app.getUrl()}`);
}

bootstrap().catch(err => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
```

The important point here is that binding Decorators such as `@FromBody()`, `@FromPath()`, and `@FromQuery()` work through the same contract whether Fastify or Express handles the request. fluo's internal Dispatcher handles translation between the adapter's native request format and the standard fluo context.

## 21.6 Advanced: The `run` Helpers

To reduce repeated bootstrap code, fluo provides the `runExpressApplication` and `runNodejsApplication` helpers, which handle signal wiring (SIGINT/SIGTERM) and graceful shutdown.

```typescript
import { runExpressApplication } from '@fluojs/platform-express';
import { AppModule } from './app.module';

await runExpressApplication(AppModule, {
  port: 3000,
  globalPrefix: 'api',
  onShutdown: () => {
    console.log('Cleaning up resources...');
  }
});
```

This helper helps clean up active connections before the process exits. In deployment environments, this shutdown boundary is important for reducing lost logs, interrupted requests, and resource leaks.

## 21.7 Comparison Summary

| Feature | Express | Node.js (Raw) | Fastify (Default) |
| :--- | :--- | :--- | :--- |
| **Performance** | Good | Excellent | High |
| **Ecosystem** | Massive | Standard Lib | Large |
| **Middleware** | Connect-style | Custom | Hook-style |
| **Footprint** | Moderate | Minimal | Moderate |
| **Best For** | Legacy Migrations | Micro-services | Standard Apps |

## 21.8 Key Takeaways

- fluo uses **Adapters** to interface with different HTTP engines.
- `@fluojs/platform-express` lets you continue using the existing Express ecosystem and operational assets.
- `@fluojs/platform-nodejs` provides a minimal HTTP layer without a framework.
- Most fluo code (Controllers, Providers, Modules) does not need to know which adapter is running at all.
- Access the underlying engine with `getInstance()` only when you need platform-specific features.
- To maintain cross-platform compatibility, review fluo abstractions first, such as `MiddlewareConsumer`.
