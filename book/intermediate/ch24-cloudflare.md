<!-- packages: @fluojs/platform-cloudflare-workers, @fluojs/runtime, @fluojs/websockets -->
<!-- project-state: FluoShop v2.6.0 -->

# Chapter 24. Cloudflare Workers Edge Deployment

This chapter explains how to deploy FluoShop to Cloudflare Workers and handle the constraints and advantages of the edge environment through a fluo adapter. Chapter 23 validated standard-first runtime portability on Deno. This chapter extends the same principle to global edge execution environments.

## Learning Objectives
- Understand why Cloudflare Workers are a good fit for fluo applications.
- Learn how to configure a Worker entrypoint with `@fluojs/platform-cloudflare-workers`.
- Explain the difference between the `fetch`-based execution model and the lazy bootstrap pattern.
- Summarize edge constraints such as no filesystem, execution time limits, and memory limits.
- Review how to connect native features such as Worker `env`, KV, D1, and WebSocketPair to fluo.
- Confirm the Wrangler deployment flow and FluoShop edge operation checkpoints.

## Prerequisites
- Completion of Chapter 21, Chapter 22, and Chapter 23.
- Basic understanding of Cloudflare Workers and the `fetch`-based serverless execution model.
- Operational familiarity with reading environment bindings and edge deployment configuration files.

## 24.1 Why Cloudflare Workers for fluo?

- **Extreme Low Latency**: Running code close to users can reduce round-trip latency.
- **Cost Efficiency**: The request-based billing model can provide a cost structure suited to short, frequent API calls.
- **Web APIs**: Workers center the `fetch`, `Request`, and `Response` standards that fluo builds on.
- **Isolate Architecture**: The V8 Isolate model provides an execution unit lighter than containers and targets fast startup and isolation.
- **Native Edge Features**: Edge-native storage and state management features such as KV, Durable Objects, and D1 (SQL) are available.

## 24.2 The Cloudflare Worker Adapter

The `@fluojs/platform-cloudflare-workers` package is optimized for Worker environment constraints such as memory limits and limited execution time.

### 24.2.1 Installation

To target the edge, install the Cloudflare Workers adapter. This adapter connects a fluo application to the Worker `fetch` invocation model instead of a long-running server.

```bash
npm install @fluojs/platform-cloudflare-workers
```

### 24.2.2 Bootstrapping FluoShop as a Worker

In the Worker environment, you do not open a long-running server socket like in traditional Node.js. Instead, you export a `fetch` handler that the Cloudflare runtime calls for each request. The fluo adapter maps between this handler and the application Dispatcher.

```typescript
// src/index.ts
import { fluoFactory } from '@fluojs/runtime';
import { createCloudflareWorkerAdapter } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const adapter = createCloudflareWorkerAdapter({
  globalPrefix: 'api/v1',
  cors: true,
});

// After bootstrapping once, this is reused by requests in the same Isolate.
const app = await fluoFactory.create(AppModule, { adapter });
await app.listen();

export default {
  fetch: (req, env, ctx) => adapter.fetch(req, env, ctx),
};
```

This structure lets the dependency injection container bootstrap be reused inside the same Isolate instead of repeating it for every request. At the edge, this initialization boundary directly affects response time and cost.

## 24.3 Lazy Bootstrapping (Zero-Config)

If you need simpler configuration, you can use fluo's entrypoint helper. This helper handles bootstrap on the first request, reducing repeated initialization code in the Worker file.

```typescript
import { createCloudflareWorkerEntrypoint } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const worker = createCloudflareWorkerEntrypoint(AppModule);

export default {
  fetch: worker.fetch,
};
```

## 24.4 Handling Edge Constraints

Cloudflare Workers have constraints that differ from traditional Node.js environments. fluo applications also need to accept these constraints as runtime contracts.

1. **No Filesystem**: You cannot use `fs`. Review Cloudflare KV for small data and R2 for large object storage.
2. **Limited Execution Time**: Request handling should be short and predictable. Depending on the plan, CPU time limits become part of the operational design.
3. **Isolate Memory**: Keep the dependency graph lightweight. fluo's explicit DI helps avoid heavy reflection libraries and unnecessary metadata generation.
4. **Environment Variables**: Access variables and bindings through the `env` object passed to the `fetch` handler.

### 24.4.1 Integrating Worker Env into fluo

fluo's Cloudflare adapter connects the Worker `env` object, including KV namespaces and secrets, to the `ConfigService` boundary. Service code can handle settings and bindings through the same configuration contract without reading Cloudflare globals directly.

```typescript
import { ConfigService } from '@fluojs/config';
import { Inject } from '@fluojs/core';

@Inject(ConfigService)
export class MyService {
  constructor(private config: ConfigService) {
    // Correctly resolves variables from the Cloudflare env object.
    const apiKey = this.config.get('API_KEY');
  }
}
```

## 24.5 Edge-Native WebSockets

Cloudflare supports `WebSocketPair` for server-side WebSockets. fluo's WebSocket module provides bindings for this environment, so you can review FluoShop realtime features within edge constraints.

```typescript
// When the adapter is active, gateways automatically use Cloudflare's WebSocketPair.
import { Module } from '@fluojs/core';
import { WebSocketGateway } from '@fluojs/websockets';
import { CloudflareWorkersWebSocketModule } from '@fluojs/websockets/cloudflare-workers';

@WebSocketGateway({ path: '/ws' })
export class EdgeGateway {
  // Logic stays the same as in the Node/Bun versions.
}

@Module({
  imports: [CloudflareWorkersWebSocketModule.forRoot()],
  providers: [EdgeGateway],
})
export class RealtimeModule {}
```

## 24.6 Deployment with Wrangler

Deploy the fluo application with Cloudflare's CLI tool, `wrangler`. The Worker name, entrypoint, compatibility date, and environment variables are managed in `wrangler.toml`. This file describes the edge execution contract separately from code, so deployment settings become reviewable artifacts too.

```toml
# wrangler.toml
name = "fluoshop-api"
main = "src/index.ts"
compatibility_date = "2024-04-01"

[vars]
API_KEY = "secret-value"
```

Deployment command:
```bash
npx wrangler deploy
```

## 24.7 Conclusion

Deploying FluoShop to Cloudflare Workers gives you a serverless backend configuration that runs at edge locations around the world. fluo's adapter-centered architecture lets you compare Node.js servers and edge execution environments while keeping application logic intact. This comparison is useful because edge deployment changes operational limits without requiring the domain model to be rewritten.

Finally, in Chapter 25, we'll review the overall FluoShop architecture and see how to scale it with a service mesh strategy.

---

*The following sections supplement the data placement, security, and state management boundaries that should be evaluated together in edge deployments.*

Moving to the edge also changes decisions about data persistence. Central databases such as PostgreSQL are still important, but if a Worker running in Tokyo calls a database in `us-east-1` on every request, the latency benefit of the edge is reduced. Services such as Cloudflare D1 and KV provide options for placing data closer to the execution point.

In FluoShop, you can review KV for session management and D1 for relational data paths. fluo's modular Provider system lets you swap storage implementations without changing business Controllers. For example, you can define a `ProductRepository` interface and provide a `D1ProductRepository` implementation when running on Cloudflare.

Cloudflare's WAF and bot management features can serve as the protection layer in front of the FluoShop API. If fluo owns application-level logic while Cloudflare owns edge-level routing and defense, you can reduce the infrastructure surface that operators must manage directly.

Another key point is the execution context. In Workers, `ctx.waitUntil()` lets you register asynchronous work with the runtime after the response. The fluo adapter can use this boundary during background work or event propagation, and it matters for work separated from the request response, such as sending analytics data or triggering webhooks.

## 24.8 Advanced: Durable Objects and State

If you need state shared across requests on Cloudflare, review Durable Objects. A Durable Object provides a unique instance responsible for specific state, and fluo can integrate by composing DI and structured logic inside it.

```typescript
import { DurableObject } from 'cloudflare:workers';

export class MyDurableObject extends DurableObject {
  // Write fluo integration logic here. You can bootstrap a small fluo app
  // inside the DO to handle internal state transitions.
}
```

## 24.9 D1 SQL Database at the Edge

Cloudflare D1 is a SQL database available near Workers. With the D1 driver and Drizzle (Chapter 20), you can handle edge placement and SQL models inside the same fluo repository boundary.

```typescript
import { drizzle } from 'drizzle-orm/d1';

@Module({
  providers: [
    {
      provide: 'DATABASE',
      inject: ['CF_ENV'],
      useFactory: (env) => drizzle(env.DB)
    }
  ]
})
export class DatabaseModule {}
```

## 24.10 Summary: The Edge Advantage

- **Global Presence**: Immediately available in 300+ locations without manual replication.
- **Performance**: Targets fast startup and high concurrency through the V8 Isolate model.
- **Simplicity**: Web-standard APIs (fetch, Request, Response) simplify development and testing.
- **Scalability**: Can handle large request volumes within Cloudflare plan and runtime limits.
- **Unified Logic**: With fluo, you can use the same Controllers and services at the edge that you use on-premises.

## 24.11 Key Takeaways

- Cloudflare Workers run in V8 Isolates at the edge and provide a lightweight alternative to traditional serverless.
- `@fluojs/platform-cloudflare-workers` provides a standard `fetch`-based adapter integrated with the fluo lifecycle.
- Export a `fetch` handler instead of calling `listen()` to match the Worker runtime.
- Native edge features such as KV, D1, and WebSockets can be connected through dedicated fluo bindings and Provider boundaries.
- Use `ConfigService` to access variables and bindings from the Worker `env` object smoothly.
- Use `wrangler` to keep deployment and environment management consistent.
- `ctx.waitUntil` is handled by fluo to ensure background work completes successfully at the edge.
- The edge is not just a hosting platform; it is a different way to think about global application architecture.

## 24.12 Future-Proofing with Cloudflare and Fluo

The Cloudflare platform keeps expanding with features such as Workers AI, advanced streaming, and new storage capabilities. In fluo, it is important to place these features behind adapter and Provider boundaries instead of scattering them directly through business logic. That keeps core domain logic stable even as platform features are added.

FluoShop now has a structure that can review global edge deployment. This transition shows that you need to design not only for performance, but also for standard APIs, platform awareness, and portable domain boundaries.
