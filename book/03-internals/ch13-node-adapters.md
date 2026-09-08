# Comparing Node.js Adapters

<!-- book:volume=03-internals;chapter=13 -->

[Previous: What If the Connection Closes Before the Request Ends?](./ch12-cancellation-and-streaming.md) | [Contents](./toc.md) | [Next: Moving to Fetch-Based Runtimes](./ch14-fetch-adapters.md)

## We Are Changing the HTTP Entry Point, Not the Order Rules

Even after FluoBlog readers begin buying T-shirts, post publishing and user accounts remain in the same application. The order and inventory modules added in Volume 2 have not suddenly become separate services either. The questions at this operations meeting are narrower: "Can we run FluoShop while keeping our existing Express middleware for a while? Would Node.js's built-in server make problems easier to trace than Fastify?" A concrete host requirement like this should be the reason to change adapters. Changing the order-processing path just because a package has a shorter name or a higher benchmark number is not a comparison.

The previous chapter distinguished returning a response from the end of a connection or stream. This chapter examines who implements that boundary. All three Node.js adapters own a Node HTTP or HTTPS listener, but they assemble request parsing, routing preselection, native middleware, and shutdown differently. What they share is that requests ultimately reach the same Fluo dispatcher. State transitions in `OrdersModule` and reservation rules in `InventoryModule` remain application responsibilities behind that dispatcher.

The execution baseline is Node24 and pnpm10. All three packages support Node.js `>=24.0.0 <27`. Use the existing Fluo build configuration that transforms standard decorators; do not enable `experimentalDecorators` or `emitDecoratorMetadata`. Replacing an adapter does not turn TypeScript design-time type metadata into DI registrations.

The code in this chapter is a small transport-layer experiment run separately in the `fluo-blog` application you created. It is not a snapshot of a finished shop repository. Do not replace your real PostgreSQL storage, authentication, or webhook signature verification with the in-memory values below and deploy them. In particular, `examples/fluo-blog` is evidence for the initial HTTP and DI paths, not a shop checkpoint for this chapter.

## Fix the Product's Observable Contract First

Let us compare the published post at `/posts/1` and the original bytes arriving at `/payments/webhooks`. The first checks that readers' existing links still work; the second checks that the byte-sensitive input introduced by the shop is preserved. There is no need to create a real order or connect to a payment provider. Before comparing response times, we must establish that the same request is processed with the same meaning.

The following is the complete experimental `src/posts/posts.module.ts` file. `PostsReader` is a projection defined in this chapter, not a repository provided by Fluo. The post with `id=1` is the published version of the post from the first exercise. The internal record preserves its author and publication status, while the public response includes only the fields it needs.

```typescript
import { Module } from '@fluojs/core';
import { NotFoundException } from '@fluojs/http';

interface PostRecord {
  id: number;
  authorId: string;
  title: string;
  content: string;
  slug: string;
  status: 'draft' | 'published';
  version: number;
  publishedAt: string | null;
}

export interface PublicPost {
  id: number;
  title: string;
  content: string;
  slug: string;
  version: number;
  publishedAt: string;
}

export class PostsReader {
  private readonly post: PostRecord = {
    id: 1,
    authorId: 'user-1',
    title: 'Hello, Fluo!',
    content: 'My first post.',
    slug: 'hello-fluo',
    status: 'published',
    version: 2,
    publishedAt: '2026-09-01T00:00:00.000Z',
  };

  findPublished(id: string): PublicPost {
    const post = this.post;
    if (
      id !== String(post.id) ||
      post.status !== 'published' ||
      post.publishedAt === null
    ) {
      throw new NotFoundException('Post not found');
    }
    return {
      id: post.id,
      title: post.title,
      content: post.content,
      slug: post.slug,
      version: post.version,
      publishedAt: post.publishedAt,
    };
  }
}

@Module({ providers: [PostsReader], exports: [PostsReader] })
export class PostsModule {}
```

`PostsModule` registers and exports the provider. The following `src/app.ts` is the complete root module for this experiment. `@Inject(PostsReader)` specifies the actual token for the constructor argument. Leaving only a constructor type annotation would not test module visibility and token resolution.

```typescript
import { Inject, Module } from '@fluojs/core';
import {
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  Post,
  type RequestContext,
} from '@fluojs/http';
import { PostsModule, PostsReader } from './posts/posts.module.js';

@Inject(PostsReader)
@Controller('/posts')
class PostsController {
  constructor(private readonly posts: PostsReader) {}

  @Get('/:id')
  show(_input: undefined, context: RequestContext) {
    return this.posts.findPublished(context.request.params.id);
  }
}

@Controller('/payments')
class WebhookBytesController {
  @Post('/webhooks')
  @HttpCode(200)
  receive(_input: undefined, context: RequestContext) {
    const bytes = context.request.rawBody;
    if (bytes === undefined) {
      throw new InternalServerErrorException('Raw body capture is required');
    }
    return {
      mode: 'dry-run',
      byteLength: bytes.byteLength,
      bytes: Array.from(bytes),
    };
  }
}

@Module({
  imports: [PostsModule],
  controllers: [PostsController, WebhookBytesController],
})
export class AppModule {}
```

The byte controller is an instrument for measuring the transport boundary, not a payment webhook implementation. It does not imitate the signature verification, duplicate handling, or order transition code owned by `PaymentsModule` in production. Nor does it trust the input as proof of a successful payment. If `rawBody` is absent, it fails explicitly rather than substituting an empty array. Otherwise, you could get a green "received successfully" result despite omitting the adapter configuration.

JSON containing spaces and line breaks may parse to the same result as JSON without spaces. The bytes covered by a signature, however, are different. Using `JSON.stringify(context.request.body)` to reconstruct the original loses that distinction. `rawBody: true` is an option for preserving the original bytes, not signature verification or an idempotency store. Both responsibilities still belong to the application.

## Connect the Same Module to Three Listeners

At first, one Fastify entry file is enough. The following `src/main.ts` is the complete entry file for the experimental module above.

```typescript
import { runFastifyApplication } from '@fluojs/platform-fastify';
import { AppModule } from './app.js';

export const app = await runFastifyApplication(AppModule, {
  host: '127.0.0.1',
  port: 3000,
  rawBody: true,
  maxBodySize: 256,
  shutdownSignals: ['SIGINT', 'SIGTERM'],
});
```

The 256-byte limit is an experimental value chosen to make failures easy to reproduce. It is not a recommended production limit for a real post-creation API that accepts post content. When `runFastifyApplication()` returns, listening and shutdown registration are already complete. There is no reason to add another `app.listen()` afterward. In contrast, `bootstrapFastifyApplication()` does not start a listener, so the host calls `listen()` separately.

To compare the three adapters, a small program that observes requests and responses is better than one focused on signal handling. The following is the complete `src/adapter-probe.ts`. Install all three adapter packages as direct dependencies of the application, and transform this file together with the two preceding module files through the existing standard-decorator build path. If your output directory is `dist`, run it with `node dist/adapter-probe.js`.

```typescript
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { createNodejsAdapter } from '@fluojs/platform-nodejs';
import { createExpressAdapter } from '@fluojs/platform-express';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.js';

const options = {
  host: '127.0.0.1',
  port: 0,
  rawBody: true,
  maxBodySize: 256,
};

const factories = [
  ['fastify', () => createFastifyAdapter(options)],
  ['nodejs', () => createNodejsAdapter(options)],
  ['express', () => createExpressAdapter(options)],
] as const;

for (const [name, createAdapter] of factories) {
  const adapter = createAdapter();
  const app = await FluoFactory.create(AppModule, { adapter });
  try {
    await app.listen();
    const server = adapter.getServer?.();
    assert.ok(server instanceof Server);
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;

    for (const path of ['/posts/1', '/posts//1/']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get('content-type')?.split(';')[0],
        'application/json',
      );
      assert.deepEqual(await response.json(), {
        id: 1,
        title: 'Hello, Fluo!',
        content: 'My first post.',
        slug: 'hello-fluo',
        version: 2,
        publishedAt: '2026-09-01T00:00:00.000Z',
      });
    }

    const missing = await fetch(`${base}/posts/999`);
    assert.equal(missing.status, 404);
    await missing.arrayBuffer();

    const body = '{ "id": "evt-1", "type": "payment.succeeded" }\r\n';
    const receipt = await fetch(`${base}/payments/webhooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(receipt.status, 200);
    assert.equal(
      receipt.headers.get('content-type')?.split(';')[0],
      'application/json',
    );
    const bytes = new TextEncoder().encode(body);
    assert.deepEqual(await receipt.json(), {
      mode: 'dry-run',
      byteLength: bytes.byteLength,
      bytes: Array.from(bytes),
    });

    for (const [body, status] of [['{', 400], ['x'.repeat(257), 413]] as const) {
      const failure = await fetch(`${base}/payments/webhooks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      assert.equal(failure.status, status);
      await failure.arrayBuffer();
    }
    console.log(`${name}: transport assertions passed`);
  } finally {
    await app.close();
  }
}
```

`port: 0` lets the operating system choose an available port. It avoids the race of finding a free port before a test starts and binding it later. Only the code that reads the address depends on Node's `Server`; that type is not passed to the controllers. Consuming every response body matters too. It prevents the verification program from leaving its own keep-alive connections open and distorting the shutdown experiment.

The expected results for each adapter are normal JSON, a 404, a receipt with an exact byte match, a 400 for malformed JSON, and a 413 for oversized input. This does not mean that the program above was executed while writing this manuscript. If it fails, first record the actual status, Content-Type, and body together, and stop comparing speed. Comparing throughput between two results with different transport contracts makes it easy to choose the wrong optimization.

## Native Routing Is Not a Shortcut Around the Dispatcher

The Fastify and Express implementations preregister native handlers for routes they can transfer safely. For paths such as `/posts/:id`, where semantics are preserved, they pass the host-selected descriptor and params to the dispatcher to reduce duplicate matching. Module middleware, guards, interceptors, observers, and error responses still remain on the Fluo path afterward. Describing native registration as "calling the controller directly" misses request scope and shutdown responsibilities.

Paths with the same normalized shape, such as `/:id` and `/:slug`, `@All`, version selection other than URI versioning, and requests sensitive to normalization require a fallback. In the experiment above, `/posts//1/` must mean the same thing as the normal path, but we cannot assume that the native engine makes the same decision. If middleware changes the method or path of the framework request, the earlier handoff is also invalidated. The dispatcher matches the modified request again.

An operator who finds order details slow should therefore not force native registration for every path. First determine whether the path is eligible for a native handoff and whether the fallback is the cost of preserving the contract. Validated extension methods such as `QUERY` and `PURGE` also pass through a wildcard route. Do not extend that claim to `CONNECT`, which is outside ordinary controller routing.

## Moving Express Assets Exposes Ownership

If all you need to keep from the existing Express code is request tagging, the following application fragment replaces the adapter-creation portion of `src/main.ts`. `AppModule` comes from the earlier file, and `FluoFactory` is the public runtime factory. A project using `RequestHandler` below manages `express` and its type dependencies directly.

```typescript
import type { RequestHandler } from 'express';
import { createExpressAdapter } from '@fluojs/platform-express';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.js';

const legacyTag: RequestHandler = (_request, response, next) => {
  response.setHeader('x-migration-host', 'express');
  next();
};

export const app = await FluoFactory.create(AppModule, {
  adapter: createExpressAdapter({
    host: '127.0.0.1',
    port: 3000,
    rawBody: true,
    nativeMiddleware: [legacyTag],
  }),
});
await app.listen();
```

On this path, the caller owns shutdown through `app.close()`. `nativeMiddleware` is fixed at creation time and runs before Fluo dispatch. Calling `next()` continues into Fluo, but ending the native response prevents everything afterward, including guards and the controller, from running. `next(error)` and native exceptions remain in the Express error chain. Assuming that a Fluo exception filter also unifies errors from this earlier stage leaves you with two kinds of failure response.

Portable behavior such as tagging is better moved eventually to `handle(context, next)` in Fluo `Middleware`. An Express-only library that must be retained, however, can stay at this narrow boundary. The model does not support having the adapter adopt an already-running Express application or modifying it with `use()` after bootstrap. The adapter does not discover and dispose of timers or clients created by native middleware either.

Fastify offers a creation-time integration point called `configureFastify` for the same requirement. Configuration must finish before Fluo registers its plugins and routes; if it fails, listening does not begin. Do not use this integration point to create a separate native route that bypasses authentication. Also, `context.request.raw` is a Node `IncomingMessage`, while `context.response.raw` is a `FastifyReply`. Code that casts both as raw Node objects is wrong even within a single adapter.

## An Operational Choice Must Include Shutdown Failures

Not every `close()` has the same implementation. Fastify chains a `listen()` issued during close to run after shutdown, whereas Express rejects `listen()` at that point. Nor should the connection drain limits in Express and raw Node and the close wait limit in Fastify be read as identical guarantees of forced shutdown. The underlying close may continue after Fastify's wait times out. The fact that `shutdownTimeoutMs: 0` is valid does not mean that requests finish safely.

A failure experiment that starts while another server holds the port and then calls `close()` is also useful. The expectation is not "it eventually starts." The in-progress retry should be cancelled and disposed of, so that freeing the port after close completes does not let the closed adapter bind late. The packages' lifecycle tests observe this sequence. In product tests, start shutdown after receiving a signal that a slow handler has been entered, then explicitly release the work-completion signal. Creating a race with an arbitrary 100-millisecond wait tests a different path on a heavily loaded CI machine.

The signal helper's `forceExitTimeoutMs` is separate from the adapter's connection drain limit. The Node-family run helpers report signal-driven shutdown failures or timeouts through logs and `process.exitCode`, but leave final process termination to the host. If other resources remain open, setting an exit code does not immediately end the process. That is why an experiment's manual `finally` path and a production process's signal path must be verified separately.

Keeping the existing Fastify adapter is also a valid conclusion if there is no new requirement. Express reduces the cost of retaining native assets, while raw Node removes an intermediate HTTP engine and lets you choose Node server options directly. Neither replaces database transactions or authentication. Do not turn a README's specific `/health` performance figure into a performance guarantee for order queries. Later, measure the real payload, concurrency, error rate, and shutdown time together.

The remaining question is no longer which of three Node engines to choose. Which responsibilities change if we hand the listener itself to Bun or Deno, or move into a Worker where we cannot create a listener? The next chapter changes the boundary around `Request` and `Response` while retaining the post and byte contracts we have just fixed.

## Evidence and Reproduction Scope

- [Fastify README](../../packages/platform-fastify/README.md), [public exports](../../packages/platform-fastify/src/index.ts), [adapter implementation](../../packages/platform-fastify/src/adapter.ts), [routing, parsing, and shutdown regression tests](../../packages/platform-fastify/src/adapter.test.ts).
- [Node.js README](../../packages/platform-nodejs/README.md), [public aliases and exports](../../packages/platform-nodejs/src/index.ts), [Node implementation](../../packages/platform-nodejs/src/node/internal-node.ts), [lifecycle integration tests](../../packages/platform-nodejs/src/lifecycle.integration.test.ts).
- [Express README](../../packages/platform-express/README.md), [public exports](../../packages/platform-express/src/index.ts), [adapter implementation](../../packages/platform-express/src/adapter.ts), [native middleware and fallback tests](../../packages/platform-express/src/adapter.test.ts).

The expected results in this chapter are derived from the public contracts and source code above. They do not claim newly captured execution logs or performance measurements for the experiments in the text.

[Previous: What If the Connection Closes Before the Request Ends?](./ch12-cancellation-and-streaming.md) | [Contents](./toc.md) | [Next: Moving to Fetch-Based Runtimes](./ch14-fetch-adapters.md)
