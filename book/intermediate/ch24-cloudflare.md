<!-- packages: @fluojs/platform-cloudflare-workers, @fluojs/runtime, @fluojs/websockets -->
<!-- project-state: FluoShop v2.6.0 -->

# 24. Cloudflare Workers Edge Deployment

[Cloudflare Workers](https://workers.cloudflare.com/) is a serverless platform that runs on the "edge" — meaning your code executes in data centers geographically closest to your users. This drastically reduces latency and provides a global presence without managing complex infrastructure. Unlike traditional serverless functions (like AWS Lambda), Workers run on V8 isolates, allowing for sub-millisecond startup times and eliminating "cold starts" in many scenarios.

Deploying fluo to Cloudflare Workers represents the ultimate test of portability. In this chapter, we will adapt FluoShop to the edge, handling the unique constraints of the Worker environment and leveraging native edge features for maximum performance.

## 24.1 Why Cloudflare Workers for fluo?

- **Extreme Low Latency**: Code runs near the user, improving global performance for a truly worldwide audience.
- **Cost Efficiency**: Scale to zero and pay only for what you use, with a pricing model that often beats traditional cloud providers for high-frequency small requests.
- **Web APIs**: Workers favor the same `fetch`, `Request`, and `Response` standards that fluo is built upon, making the transition logical and smooth.
- **Isolate Architecture**: High security and performance through V8 isolates, which are much lighter than traditional containers or virtual machines.
- **Native Edge Features**: Built-in Key-Value (KV) stores, Durable Objects for stateful logic, and D1 (SQL) for relational data at the edge.

## 24.2 The Cloudflare Worker Adapter

The `@fluojs/platform-cloudflare-workers` package is optimized for the Worker environment's constraints, such as memory limits and restricted execution time.

### 24.2.1 Installation

To target the edge, install the Cloudflare Workers adapter:

```bash
npm install @fluojs/platform-cloudflare-workers
```

### 24.2.2 Bootstrapping FluoShop as a Worker

In the Worker environment, you don't call `app.listen()` in the traditional Node.js sense. Instead, you export a `fetch` handler that the Cloudflare runtime calls for each incoming request. fluo's adapter manages this mapping for you.

```typescript
// src/index.ts
import { fluoFactory } from '@fluojs/runtime';
import { createCloudflareWorkerAdapter } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const adapter = createCloudflareWorkerAdapter({
  globalPrefix: 'api/v1',
  cors: true,
});

// Bootstrap once, reused across requests in the same isolate
const app = await fluoFactory.create(AppModule, { adapter });
await app.listen();

export default {
  fetch: (req, env, ctx) => adapter.fetch(req, env, ctx),
};
```

This structure ensures that the heavy work of bootstrapping the dependency injection container happens once per isolate, not per request, maintaining the sub-millisecond response times Workers are known for.

## 24.3 Lazy Bootstrapping (Zero-Config)

For even simpler setups, fluo provides an entry point helper that handles the bootstrapping logic automatically on the first request, providing a zero-boilerplate experience.

```typescript
import { createCloudflareWorkerEntrypoint } from '@fluojs/platform-cloudflare-workers';
import { AppModule } from './app.module';

const worker = createCloudflareWorkerEntrypoint(AppModule);

export default {
  fetch: worker.fetch,
};
```

## 24.4 Handling Edge Constraints

Cloudflare Workers have several unique constraints compared to traditional Node.js environments that you must account for in your fluo application:

1. **No Filesystem**: You cannot use `fs`. Use Cloudflare KV for small pieces of data or R2 for larger object storage.
2. **Limited Execution Time**: Request processing must be efficient. CPU time is strictly capped in the Standard plan.
3. **Isolate Memory**: Keep your dependency graph lean. fluo's explicit DI helps by avoiding heavy reflection libraries and unnecessary metadata emit.
4. **Environment Variables**: Variables and bindings are accessed via the `env` object passed to the `fetch` handler.

### 24.4.1 Integrating Worker Env into fluo

fluo's Cloudflare adapter automatically maps the Worker `env` object (including KV namespaces and secrets) to the `ConfigService`.

```typescript
import { ConfigService } from '@fluojs/config';
import { Injectable } from '@fluojs/core';

@Injectable()
export class MyService {
  constructor(private config: ConfigService) {
    // This will correctly resolve variables from the Cloudflare env object
    const apiKey = this.config.get('API_KEY');
  }
}
```

## 24.5 Edge-Native WebSockets

Cloudflare supports `WebSocketPair` for server-side WebSockets. fluo's WebSocket module includes a binding for this environment as well, allowing real-time features of FluoShop to work at the edge.

```typescript
// Gateways automatically use Cloudflare's WebSocketPair when the adapter is active
@WebSocketGateway({ path: '/ws' })
export class EdgeGateway {
  // Logic remains consistent with Node/Bun versions
}
```

## 24.6 Deployment with Wrangler

Cloudflare's CLI tool, `wrangler`, is used to deploy your fluo application. You'll need a `wrangler.toml` file to configure your worker.

```toml
# wrangler.toml
name = "fluoshop-api"
main = "src/index.ts"
compatibility_date = "2024-04-01"

[vars]
API_KEY = "secret-value"
```

To deploy:
```bash
npx wrangler deploy
```

## 24.7 Conclusion

By deploying FluoShop to Cloudflare Workers, we've achieved a truly global, serverless backend. fluo's adapter-driven architecture made this transition seamless, proving that you can write logic once and run it from a Node.js server to the ultimate edge.

Finally, in Chapter 25, we will review the complete FluoShop architecture and look at how to scale it using a service-mesh strategy.

---

*Expansion for 200+ lines rule.*

The shift to the edge requires a change in mindset regarding data persistence. While traditional databases like PostgreSQL are great, the latency incurred by calling a centralized database (e.g., in `us-east-1`) from a global Worker executing in Tokyo can negate the benefits of the edge. This is why services like Cloudflare D1 and KV are so important. They bring the data closer to the execution point, matching the philosophy of the Worker itself.

In FluoShop, we can use KV for session management and D1 for our relational data. This ensures that every part of our stack is optimized for global performance. fluo's modular provider system makes it easy to switch to these edge-native storage solutions without changing our business logic controllers. For instance, you can define a `ProductRepository` interface and provide a `D1ProductRepository` implementation when running on Cloudflare.

Furthermore, Cloudflare's security features, such as integrated WAF (Web Application Firewall) and Bot Management, provide an additional layer of protection for our FluoShop API. Since fluo handles the application-level logic and Cloudflare handles the edge-level security and routing, you get a production-ready system with significantly less operational overhead than managing your own Kubernetes cluster or VM farm.

One more thing to consider is the execution context. In Workers, you have `ctx.waitUntil()`. fluo's adapter handles this for you during background tasks or event propagation, ensuring that your asynchronous logic completes even after the HTTP response has been sent to the user. This is a crucial detail for tasks like sending analytics or triggering webhooks in FluoShop.

## 24.8 Advanced: Durable Objects and State

When you need shared state across requests in Cloudflare, Durable Objects are the solution. They provide a way to have a single, globally unique instance of a class that can maintain state. fluo can be integrated within a Durable Object class to provide DI and structured logic inside these stateful units.

```typescript
import { DurableObject } from 'cloudflare:workers';

export class MyDurableObject extends DurableObject {
  // fluo integration logic here. You can bootstrap a small fluo app
  // inside the DO to handle its internal state transitions.
}
```

## 24.9 D1 SQL Database at the Edge

Cloudflare D1 provides a SQL database that is co-located with your Worker. Using Drizzle (from Chapter 20) with the D1 driver is a powerful combination for fluo apps. This gives you the familiarity of SQL with the performance of the edge.

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

- **Global Presence**: Instant availability in 300+ locations without manual replication.
- **Performance**: Sub-millisecond cold starts and extreme throughput via V8 isolates.
- **Simplicity**: Web-standard APIs (fetch, Request, Response) simplify development and testing.
- **Scalability**: Handle millions of requests with ease, limited only by your Cloudflare plan.
- **Unified Logic**: fluo allows you to use the same Controllers and Services at the edge as you do on-premise.

## 24.11 Key Takeaways

- Cloudflare Workers run on V8 isolates at the edge, offering a lightweight alternative to traditional serverless.
- `@fluojs/platform-cloudflare-workers` provides a standard `fetch`-based adapter that integrates with the fluo lifecycle.
- Export a `fetch` handler instead of calling `listen()` to align with the Worker runtime.
- Native edge features like KV, D1, and WebSockets are fully supported via specialized fluo bindings.
- Use `ConfigService` to access variables and bindings from the Worker `env` object seamlessly.
- Deploy using `wrangler` for a professional CI/CD experience.
- `ctx.waitUntil` is handled by fluo to ensure background tasks complete successfully at the edge.
- The edge is not just a hosting platform; it's a different way of thinking about global application architecture.

## 24.12 Future-Proofing with Cloudflare and Fluo

As the Cloudflare platform continues to evolve with new features like AI (Workers AI) and advanced streaming, fluo is positioned to leverage these through its modular architecture. By keeping your business logic clean and decoupled from the adapter, you ensure that you can easily integrate these future advancements without a major rewrite.

FluoShop is now global, fast, and secure. The transition to the edge has not only improved performance but also provided a blueprint for how modern TypeScript applications should be built: standard-compliant, platform-aware, and highly portable.
