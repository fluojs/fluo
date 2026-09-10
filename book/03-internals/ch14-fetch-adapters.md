# Moving to Fetch-Based Runtimes

<!-- book:volume=03-internals;chapter=14 -->

[Previous: Comparing Node.js Adapters](./ch13-node-adapters.md) | [Contents](./toc.md) | [Next: Running Fluo Inside Next.js](./ch15-nextjs-hosting.md)

## Moving Public Products Closer Does Not Move Order Authority

An overseas reader opens the T-shirt link at the end of a FluoBlog post. The product description rarely changes, yet the first screen takes a long time to arrive. The operator wants to find out whether public posts and product queries can also be served from another runtime. That does not mean rebuilding `AccountsModule` or moving `OrdersModule`'s inventory and pricing decisions into an edge cache. The same user IDs, integer KRW amounts, and order-time snapshots from Volume 2 remain. Even if this experiment succeeds, it does not immediately follow that the entire application should be split into separate deployments.

The previous chapter connected the same module to three Node listeners. This time, the native request changes from `IncomingMessage` to a Web `Request`. Instead of writing to `ServerResponse`, we return a `Response`. Bun and Deno can connect this function to a network listener, while in Cloudflare Workers the host already owns the listener. Shared Web APIs provide a common language for input and output, not a common model for processes and shutdown.

The code uses `AppModule` from the experimental `src/app.ts` and `src/posts/posts.module.ts` defined in Chapter 13. It keeps `/posts/1` and `/payments/webhooks`, which only returns the original bytes. It does not process real payments. This read-and-parse experiment is separate from the runtime compatibility of PostgreSQL and Prisma connections. If any provider uses the Node filesystem, a TCP client, or process signals, investigate those dependencies first; do not treat an adapter change alone as a completed port.

## Start by Giving the Body a Single Consumer

One of the easiest migration failures to understand is a disappearing body. If the host calls `await request.json()` for logging before passing the same `Request` to Fluo, it consumes the stream that the parser needs to read. Encoding it back into JSON does not recover the original spaces, line breaks, or byte sequence. It may look harmless for blog JSON, but at the webhook signature boundary from Volume 2, it is a different request.

The request/response factory in `@fluojs/runtime/web` has parsing configuration. It creates the framework request that will reach the actual dispatcher and performs bounded body reads when needed. Bun's `createBunFetchHandler()` creates this factory with `consumeOriginalBody: true`, while Deno's `createDenoFetchHandler()` also delegates to the shared factory and `dispatchWebRequest()`. The application does not need to parse twice to compensate for these internal differences.

The field for obtaining the dispatcher from the public `Application` is `app.dispatcher`. The following is the complete `src/fetch-probe.ts`, which compares the public Bun and Deno Fetch interfaces without opening a server. This is a contract experiment using Node24's Web APIs, not evidence of running native Bun or Deno servers. `createNoopHttpApplicationAdapter()` is an explicit choice solely for this experiment without a listener.

```typescript
import assert from 'node:assert/strict';
import { createNoopHttpApplicationAdapter } from '@fluojs/http';
import { createBunFetchHandler } from '@fluojs/platform-bun';
import { createDenoFetchHandler } from '@fluojs/platform-deno';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.js';

const app = await FluoFactory.create(AppModule, {
  adapter: createNoopHttpApplicationAdapter(),
});

try {
  const options = {
    dispatcher: app.dispatcher,
    maxBodySize: 256,
    rawBody: true,
  };
  const handlers = [
    ['bun', createBunFetchHandler(options)],
    ['deno', createDenoFetchHandler(options)],
  ] as const;

  for (const [name, handle] of handlers) {
    const post = await handle(new Request('https://probe.test/posts/1'));
    assert.equal(post.status, 200);
    assert.equal(
      post.headers.get('content-type')?.split(';')[0],
      'application/json',
    );
    assert.deepEqual(await post.json(), {
      id: 1,
      title: 'Hello, Fluo!',
      content: 'My first post.',
      slug: 'hello-fluo',
      version: 2,
      publishedAt: '2026-09-01T00:00:00.000Z',
    });

    const bytes = new TextEncoder().encode('{ "id": "evt-1" }\r\n');
    const receipt = await handle(new Request('https://probe.test/payments/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bytes,
    }));
    assert.equal(receipt.status, 200);
    assert.equal(
      receipt.headers.get('content-type')?.split(';')[0],
      'application/json',
    );
    assert.deepEqual(await receipt.json(), {
      mode: 'dry-run',
      byteLength: bytes.byteLength,
      bytes: Array.from(bytes),
    });
    console.log(`${name}: fetch boundary assertions passed`);
  }
} finally {
  await app.close();
}
```

Each handler receives a new `Request` so that consuming the same input stream a second time is not confused with the test itself. The test checks more than whether the response looks like JSON: it compares the status, Content-Type, and complete parsed receipt. Two payloads can have the same byte count but different bytes, so it compares the array as well. A failure can lead us to investigate the boundary between parsing and host conversion, but this result alone cannot establish anything about TLS, listener backlog, or operating-system signals.

## Let Bun and Deno Own Their Servers

After the experiment without a listener, choose an actual runtime. The following two files are complete alternatives for `src/main.ts`. Do not run both in one process. Use the previous chapter's `AppModule` and JavaScript output transformed for standard decorators. Do not remove the decorator transformation step just because the runtime can read TypeScript.

For Bun, create the concrete static adapter and pass it to Factory. State the 30-second application shutdown bound used by the former managed helper on the adapter, and select the package-root signal callback to retain its 30-second host force-exit bound.

```typescript
import {
  BunHttpApplicationAdapter,
  createBunShutdownSignalRegistration,
} from '@fluojs/platform-bun';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.js';

export const app = await FluoFactory.create(AppModule, {
  adapter: BunHttpApplicationAdapter.create({
    hostname: '127.0.0.1',
    port: 3000,
    rawBody: true,
    maxBodySize: 256,
    shutdownTimeoutMs: 30_000,
  }),
  shutdownRegistration: createBunShutdownSignalRegistration(),
});
await app.listen();
```

For Deno, use the same Factory path. Its callback logs and swallows signal-close failures without assigning an exit status. Omit the callback when the host owns signal lifecycle entirely.

```typescript
import {
  DenoHttpApplicationAdapter,
  createDenoShutdownSignalRegistration,
} from '@fluojs/platform-deno';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.js';

export const app = await FluoFactory.create(AppModule, {
  adapter: DenoHttpApplicationAdapter.create({
    hostname: '127.0.0.1',
    port: 3000,
    rawBody: true,
    maxBodySize: 256,
  }),
  shutdownRegistration: createDenoShutdownSignalRegistration(),
});
await app.listen();
```

For an application whose build output is `dist/main.js`, the respective execution commands are below. For Deno, the project's npm dependencies must be configured so that Deno can resolve them. These are not instructions to put a Node test file into a Worker bundle.

```bash
bun dist/main.js
```

```bash
deno run --allow-net dist/main.js
```

Deno's network permission is needed to open the actual server. The adapter does not read environment variables. If the application chooses to read `PORT`, add permission for that environment variable and validate its value at that point. If both Deno's `hostname` and its portability alias `host` are supplied, `hostname` takes precedence. TLS options also differ: Bun uses `tls`, while Deno uses `https: { cert, key }`. Do not blindly pass the same options object to every runtime.

Conversely, if a host already manages `Bun.serve()` or `Deno.serve()`, you can connect the earlier Fetch handler to that host. In this case, the bridge handles only request conversion and dispatch. Server shutdown, signal handling, WebSocket upgrades, and Bun's native `routes` acceleration do not come with it automatically. Calling both an adapter's `listen()` and a separate `serve()` creates two listener owners for the same application. Choose one and write shutdown tests against that owner.

## Separate Environment Lifetime from Request Lifetime in Workers

Suppose something odd happens when you first deploy public product queries to a Worker. The first request starts with the `region-a` configuration. The next request receives an environment object for `region-b`, yet the product provider still uses the first value. This looks like a bug if you expect singleton providers to be reconfigured for every request. The env-aware entrypoint contract, however, selects the root module and bootstrap options from the first environment and preserves that configuration within the isolate.

To observe this, add a projection for a single product. The following is the complete `src/worker-app.ts`. `CATALOG_REGION` is the actual DI token owned by this experiment. The product price in `CatalogReader` is an integer in KRW minor units; this is not an authoritative repository for inventory decisions or for fixing order prices. Do not replace the existing shop with this data.

```typescript
import { Inject, Module } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { AppModule } from './app.js';

const CATALOG_REGION = Symbol('catalog.region');

@Inject(CATALOG_REGION)
export class CatalogReader {
  constructor(readonly region: string) {}

  list() {
    return [{
      sku: 'T-SHIRT-BLOG',
      title: 'FluoBlog Logo T-Shirt',
      currency: 'KRW',
      unitPriceMinor: 25000,
      version: 1,
    }];
  }
}

@Inject(CatalogReader)
@Controller('/products')
class CatalogController {
  constructor(private readonly catalog: CatalogReader) {}

  @Get('/')
  list(_input: undefined, context: RequestContext) {
    context.response.setHeader('x-catalog-region', this.catalog.region);
    return this.catalog.list();
  }
}

export function createWorkerModule(region: string) {
  @Module({
    providers: [
      { provide: CATALOG_REGION, useValue: region },
      CatalogReader,
    ],
    controllers: [CatalogController],
    exports: [CatalogReader],
  })
  class CatalogModule {}

  @Module({ imports: [AppModule, CatalogModule] })
  class WorkerAppModule {}

  return WorkerAppModule;
}
```

The following complete `src/worker.ts` selects a module from an environment value. The function validates the value's allowed range because it is external configuration for an application generation, not request input. A failure of this validation is not the same 400 response contract as an error in a customer's product-query DTO.

```typescript
import { CloudflareWorkerApplicationHost } from '@fluojs/platform-cloudflare-workers';
import { createWorkerModule } from './worker-app.js';

export interface WorkerEnv {
  CATALOG_REGION: string;
}

export const worker = CloudflareWorkerApplicationHost.create<WorkerEnv>({
  fromEnv: (env) => {
    if (
      typeof env.CATALOG_REGION !== 'string' ||
      !/^[a-z0-9-]{1,32}$/.test(env.CATALOG_REGION)
    ) {
      throw new TypeError('CATALOG_REGION must be a short region identifier');
    }
    return {
      rootModule: createWorkerModule(env.CATALOG_REGION),
      options: { rawBody: true, maxBodySize: 256 },
    };
  },
});

export default { fetch: worker.fetch };
```

The environment passed to each fetch is still attached to `request.cloudflare.env`, but it does not recreate an already-configured singleton. Therefore, do not put per-request customer or authorization information into a provider built from the first environment. Validate and narrow bindings needed by a request within that request, then pass them as arguments to service methods. Conversely, select only configuration that must exist before module registration in the env-aware factory. The explicit environment argument to `ready(env)` also keeps this boundary visible.

## Distinguish What Stays the Same from What Changes on Restart

The following complete `src/worker-probe.ts` is a Node24 contract experiment that calls the Worker entrypoint outside its host. It neither deploys to Cloudflare nor changes infrastructure. Run it as a separate Node program after the standard-decorator build, and exclude it from the Worker bundle.

```typescript
import assert from 'node:assert/strict';
import type { CloudflareWorkerExecutionContext } from '@fluojs/platform-cloudflare-workers';
import { worker } from './worker.js';
import { CatalogReader } from './worker-app.js';

const pending: Promise<unknown>[] = [];
const context: CloudflareWorkerExecutionContext = {
  waitUntil(promise) {
    pending.push(promise);
  },
};
const firstEnv = { CATALOG_REGION: 'region-a' };
const laterEnv = { CATALOG_REGION: 'region-b' };

try {
  const [first, concurrent] = await Promise.all([
    worker.ready(firstEnv),
    worker.ready(firstEnv),
  ]);
  assert.strictEqual(first, concurrent);
  const firstReader = await first.app.get(CatalogReader);

  const response = await worker.fetch(
    new Request('https://probe.test/products'),
    laterEnv,
    context,
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type')?.split(';')[0],
    'application/json',
  );
  assert.equal(response.headers.get('x-catalog-region'), 'region-a');
  assert.deepEqual(await response.json(), [{
    sku: 'T-SHIRT-BLOG',
    title: 'FluoBlog Logo T-Shirt',
    currency: 'KRW',
    unitPriceMinor: 25000,
    version: 1,
  }]);
  assert.ok(pending.length > 0);
  await Promise.all(pending);

  await worker.close();
  const restarted = await worker.ready(laterEnv);
  const restartedReader = await restarted.app.get(CatalogReader);
  assert.notStrictEqual(restarted.app, first.app);
  assert.notStrictEqual(restartedReader, firstReader);
  assert.equal(restartedReader.region, 'region-a');
  console.log('worker: generation and configuration assertions passed');
} finally {
  await worker.close();
}
```

Concurrent readiness calls receive the same application wrapper. After a successful close, there is a new application and a new singleton, but the configuration is still `region-a` from the first environment. The experiment checks these distinctions separately through object identity and the actual response header. The expectation that "two requests mean two factory calls" should be wrong in this experiment. An application that intends to use a successful close as permanent shutdown must own a separate terminal state.

It also matters that `waitUntil()` is not an empty function. The fake must collect and await the promises it receives so that request lifecycle registration can be observed. This fake does not reproduce Cloudflare's CPU limits, isolate eviction, or deployment network, and it makes no such guarantees. The verification needed here is to await completion of the work actually registered, rather than blindly wait for a while.

## Returning a Response, Ending a Stream, and Closing an Application Are Different

In Workers, `adapter.fetch(request, env, executionContext)` requires its third argument. Work accepted after the dispatcher is bound is registered with `waitUntil()`. The relevant lifecycles include not only ordinary HTTP dispatch but also completion or cancellation of SSE response bodies and terminal close of upgraded server WebSockets. Returning a `Response` object does not end an SSE subscription to sales status.

Calling `await worker.close()` inside an administrative route is particularly dangerous. Close waits for active requests to finish, while the active request itself waits for close. When designing an administrative request, avoid a form that waits for the current request; use an asynchronous observation path such as `executionContext.waitUntil(worker.close())`. This chapter's probe closes outside the fetch call, so it can await close directly. A generic "same shutdown hook on every host" that hides this distinction can itself cause an outage.

Worker close rejects new ingress with 503 and waits up to 10 seconds for active work. A timeout does not mean that the underlying drain has finished. An adapter still draining rejects a resumption through `listen()`, and the lazy host does not bypass it with a new application during that interval. Once the underlying drain actually ends, the lazy host can recover. Distinguish the next fetch creating a new application after a successful host close from the raw adapter continuing to return 503 until an explicit listen.

Bun also blocks new ingress when shutdown begins and starts `server.stop(stopActiveConnections)`. A bounded timeout only fails the caller's wait for close; it is not a signal to discard ongoing work and immediately clear the adapter's state. Deno stops new ingress, drains active handlers, and aborts the serve signal if needed. A signal-driven close failure in the explicitly supplied Deno shutdown callback is logged but does not set the exit status. A host that owns failure-status propagation omits `shutdownRegistration` and coordinates signals separately.

## Document Both the Common Baseline and Optional Features

The three Fetch-based adapters do not have Fluo's `earlyHints` capability. Copying a 103 response used on Node into final response headers is not equivalent behavior. If a feature is optional, check for its capability. If the product requires actual informational response transmission, choose a host that supports it.

Multipart is not merely an extension of the JSON raw-body experiment either. Multipart requests do not preserve `rawBody`. With a streaming strategy, each file part's `ReadableStream` has a single consumer; finish reading or cancel the current stream before advancing to the next part. The runtime's responsibility for disposing of the route iterator is also separate from the responsibility of a consumer that calls `parseMultipartStream()` directly to call `return()`. When testing upload cancellation, observe whether the source is cancelled and resources are released, rather than merely whether a JSON receipt arrives.

Bun's native `routes` acceleration is likewise used only when semantics can be preserved. Sending ambiguous paths or extension methods through the fetch fallback does not break portability. Conversely, even if an adapter exposes a WebSocket capability, do not expect automatic upgrades before registering the protocol binding in the module graph. After the listen boundary, the binding identity in Workers cannot change even after close, so a different binding requires a new adapter.

Approval for a real migration requires an account of the contracts for public posts, products, and original bytes, together with body limits, cookies, stream cancellation, and shutdown ownership. Without separate smoke results from native Bun, Deno, and Worker environments, do not call this chapter's experiment without a listener deployment verification. Deciding that the product projection can be served closer to users and deciding where order authority belongs remain separate design questions.

The next chapter explores hosting in another direction. We keep Node24 rather than change runtimes, but hand the server and file routing to Next.js. The starting point is not to assume that sharing a Web `Request` also gives Workers and Next the same restart, method, and rendering contracts.

## Evidence and Reproduction Scope

- [Bun README](../../packages/platform-bun/README.md), [public exports](../../packages/platform-bun/src/index.ts), [Fetch handler and managed adapter implementation](../../packages/platform-bun/src/adapter.ts), [adapter tests](../../packages/platform-bun/src/adapter.test.ts).
- [Deno README](../../packages/platform-deno/README.md), [public exports](../../packages/platform-deno/src/index.ts), [host-owned Fetch handler](../../packages/platform-deno/src/fetch-handler.ts), [handler tests](../../packages/platform-deno/src/fetch-handler.test.ts), [managed lifecycle tests](../../packages/platform-deno/src/adapter.test.ts).
- [Workers README](../../packages/platform-cloudflare-workers/README.md), [public exports](../../packages/platform-cloudflare-workers/src/index.ts), [env-aware factory and lifecycle implementation](../../packages/platform-cloudflare-workers/src/adapter.ts), [shutdown regression tests](../../packages/platform-cloudflare-workers/src/adapter-lifecycle.test.ts).
- [Shared Web request and response implementation](../../packages/runtime/src/web.ts), [portability tests for the three Web runtimes](../../packages/testing/src/portability/web-runtime-adapter-portability.test.ts).

This chapter presents reproduction programs and expected results based on public APIs and source code. It does not claim that native Bun or Deno servers or a Cloudflare deployment were run and passed while the manuscript was written.

[Previous: Comparing Node.js Adapters](./ch13-node-adapters.md) | [Contents](./toc.md) | [Next: Running Fluo Inside Next.js](./ch15-nextjs-hosting.md)
