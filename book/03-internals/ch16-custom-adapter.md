# Building Your Own Adapter and Verifying Its Contract

<!-- book:volume=03-internals;chapter=16 -->

[Previous: Running Fluo Inside Next.js](./ch15-nextjs-hosting.md) | [Contents](./toc.md) | [Next: Building a Reusable Fluo Extension Package](./ch17-extension-package.md)

## Narrow the Interface Before Building a New Router

The operations team wants to connect FluoBlog and FluoShop to an internal request replay tool. The tool provides recorded HTTP requests as Web `Request` objects and observes `Response` objects. It needs neither a network port nor WebSocket upgrades. This environment runs the same module graph for post queries and order services without making real payments or sending anything externally. We could start the existing Fastify server and have the tool call it over HTTP, but this requirement is to connect directly to the request function of an existing host.

An important lesson from the previous three chapters is that an adapter does not need to find controllers and call them itself. The runtime compiles modules and creates the DI container and dispatcher. `HttpApplicationAdapter.listen(dispatcher)` connects that dispatcher to the host. Reimplementing methods, paths, DTOs, guards, and error representations would duplicate the framework rather than build an adapter.

In this chapter, we complete a small host-owned adapter that reuses the factory and dispatch-start function from `@fluojs/runtime/web`. It is neither a new official platform package nor a general-purpose server supporting every host. The surrounding host owns sockets, TLS, signals, and network transmission of response bodies. The adapter owns request acceptance, dispatcher binding, completion of ongoing dispatches, and terminal close. The host's contract is to close the application only after consumption or cancellation of returned streams has finished.

In particular, dispatch completion and response transmission completion are not the same. This adapter waits for the runtime's `completion`, not confirmation that the client received the last byte. The internal replay tool reads or cancels the response body and then calls close. For hosts that must track SSE body and upgraded socket lifetimes separately, such as Workers, the official adapter from Chapter 14 is a better fit. Stating this boundary from the outset keeps a small implementation honest.

## Make the First Failure an Early Close, Not a Failed Request

The first implementation that comes to mind stores the dispatcher in a field and calls `dispatchWebRequest()`. An experiment that returns JSON once may pass. But if close merely clears the field and finishes, the application can begin disposal while an already-accepted handler is still using a provider. We must satisfy both "no new requests are accepted" and "accepted work has finished."

There is no need to introduce real database latency to test this. Register a controllable read gate through DI, wait for the handler-entry signal, and then call close. The following is the complete `src/adapter-probe.module.ts`. It reuses only `PostsModule` and `PostsReader` defined in Chapter 13's `src/posts/posts.module.ts`; it does not depend on Chapter 15's Next-specific root module.

```typescript
import { Inject, Module } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { PostsModule, PostsReader } from './posts/posts.module.js';

export class ProbeGate {
  readonly entered = Promise.withResolvers<void>();
  readonly release = Promise.withResolvers<void>();
}

@Inject(PostsReader, ProbeGate)
@Controller('/posts')
class ProbePostsController {
  constructor(
    private readonly posts: PostsReader,
    private readonly gate: ProbeGate,
  ) {}

  @Get('/:id')
  async show(_input: undefined, context: RequestContext) {
    this.gate.entered.resolve();
    await this.gate.release.promise;
    return this.posts.findPublished(context.request.params.id);
  }
}

@Module({
  imports: [PostsModule],
  providers: [ProbeGate],
  controllers: [ProbePostsController],
})
export class AdapterProbeModule {}
```

`ProbeGate` is a control tool owned by the application test. It controls only the interval during which a request is in progress, without adding a sleep to the production `PostsReader`, while retaining real module visibility and class-level `@Inject`. The test uses Node24 and modern Promise type libraries. `Promise.withResolvers()` fixes the ordering of the race through explicit signals rather than elapsed time.

The expected failure in this example is that close completes first. Finishing quickly because a request has not yet been accepted or because a route returns 404 is not the same failure. The test must receive `entered.promise` before starting shutdown to target this regression. After changing the implementation, check that close stays pending until the completion gate is opened. The complete test below distinguishes those two implementations; this manuscript does not claim to have captured actual red and green execution logs.

## Add Completion Tracking to the Minimal Contract

The following is the complete `src/hosted-http-adapter.ts`. All imports come from public package roots or the public `runtime/web` subpath. Do not copy first-party assembly functions from `@fluojs/runtime/internal*` into the application.

```typescript
import {
  createUnsupportedHttpAdapterRealtimeCapability,
  type Dispatcher,
  type HttpApplicationAdapter,
} from '@fluojs/http';
import {
  createWebRequestResponseFactory,
  startWebRequestDispatch,
  type CreateWebRequestResponseFactoryOptions,
} from '@fluojs/runtime/web';

export type HostedAdapterOptions = Pick<
  CreateWebRequestResponseFactoryOptions,
  'maxBodySize' | 'multipart' | 'rawBody'
>;

export class HostedHttpAdapter implements HttpApplicationAdapter {
  private dispatcher?: Dispatcher;
  private closed = false;
  private closePromise?: Promise<void>;
  private readonly active = new Set<Promise<void>>();
  private readonly failures: unknown[] = [];
  private readonly factory;

  constructor(options: HostedAdapterOptions = {}) {
    const limit = options.maxBodySize;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw Object.assign(new RangeError('Invalid request body limit'), {
        code: 'HOSTED_ADAPTER_INVALID_BODY_LIMIT',
      });
    }
    this.factory = createWebRequestResponseFactory({
      ...options,
      consumeOriginalBody: true,
    });
  }

  listen(dispatcher: Dispatcher): void {
    if (this.closed) {
      throw Object.assign(new Error('Adapter is closed'), {
        code: 'HOSTED_ADAPTER_CLOSED',
      });
    }
    if (this.dispatcher && this.dispatcher !== dispatcher) {
      throw Object.assign(new Error('Adapter already has a dispatcher'), {
        code: 'HOSTED_ADAPTER_ALREADY_BOUND',
      });
    }
    this.dispatcher = dispatcher;
  }

  readonly fetch = (request: Request): Promise<Response> => {
    const dispatcher = this.dispatcher;
    if (this.closed || dispatcher === undefined) {
      const code = this.closed
        ? 'hosted_adapter_closed'
        : 'hosted_adapter_not_ready';
      return Promise.resolve(Response.json(
        { code, status: 503, title: 'Backend unavailable' },
        {
          status: 503,
          headers: { 'content-type': 'application/problem+json' },
        },
      ));
    }

    const work = startWebRequestDispatch({
      dispatcher,
      factory: this.factory,
      request,
    });
    const tracked = work.completion.then(
      () => undefined,
      (error: unknown) => {
        this.failures.push(error);
      },
    );
    this.active.add(tracked);
    void tracked.then(() => this.active.delete(tracked));
    return work.response;
  };

  close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.closed = true;
    this.closePromise = Promise.all([...this.active]).then(() => {
      this.dispatcher = undefined;
      if (this.failures.length > 0) {
        throw Object.assign(
          new AggregateError(this.failures, 'Request lifecycle cleanup failed'),
          { code: 'HOSTED_ADAPTER_DRAIN_FAILED' },
        );
      }
    });
    return this.closePromise;
  }

  getRealtimeCapability() {
    return createUnsupportedHttpAdapterRealtimeCapability(
      'The host exposes no raw WebSocket upgrade operation.',
    );
  }
}
```

The most important ordering in this implementation is that `closed = true` executes before the first await. There must be no gap in which a new request can enter and join the active set after close has copied it. Once JavaScript finishes this synchronous section, subsequent fetches end with 503, and only already-accepted dispatches are included in the work that close waits for.

The `listen()` policy is also an explicit choice made by this adapter. Repeated binding to the same dispatcher is idempotent, but replacing a live dispatcher is rejected. An instance is not reused once closed. This is not a shared restart policy for all Fluo adapters; this is precisely where we saw differences among Fastify, Workers, and Next. If another generation is needed, create a new `HostedHttpAdapter` and application.

`startWebRequestDispatch()` separates `response` from `completion`. Waiting for the entire handler to finish before obtaining a streaming response can leave the producer and consumer waiting for each other. Therefore, fetch returns `work.response`, and only close tracks completion. A final step such as multipart iterator disposal may fail after the `Response` has already been created. To avoid losing those failures, the adapter records them and exposes an `AggregateError` containing the original causes at close.

The failure record here is not intended to copy internal error details into customer responses. Nor can an error after the response is committed be overwritten with a second JSON response. It is a path through which the caller can observe lifecycle failures. The host must reflect close failures in its logs and failure status; this example contains no diagnostics that serialize tokens or passwords.

The body limit is validated at the external configuration boundary as a nonnegative safe integer. `0` is valid too. Actual body reading, multipart limits, raw body preservation, and query and cookie conversion are delegated to the shared factory. By not adding a custom parser built from `request.json()` and string-length comparisons, we can reuse the preceding chapter's byte-preservation contract.

## Keep the Two Kinds of Tests Separate

An application test can first establish whether the same `AdapterProbeModule` is actually wired correctly. The following is the complete `src/adapter-probe.slice.test.ts`. It assumes the existing standard-decorator Vitest configuration.

```typescript
import { createTestApp } from '@fluojs/testing';
import { expect, it } from 'vitest';
import { AdapterProbeModule, ProbeGate } from './adapter-probe.module.js';

it('resolves the registered reader through the real module graph', async () => {
  const gate = new ProbeGate();
  gate.release.resolve();
  const app = await createTestApp({
    rootModule: AdapterProbeModule,
    providers: [{ provide: ProbeGate, useValue: gate }],
  });
  try {
    const response = await app.request('GET', '/posts/1').send();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: 1,
      title: 'Hello, Fluo!',
      content: 'My first post.',
      slug: 'hello-fluo',
      version: 2,
      publishedAt: '2026-09-01T00:00:00.000Z',
    });
  } finally {
    await app.close();
  }
});
```

The runtime provider input replaces only the gate, while the request still passes through the real exports of `PostsModule` and controller injection. But success with `createTestApp()` is not success for the new adapter. This helper normalizes virtual requests and runs the dispatcher. It does not automatically test native parsing of the Cookie header, consumption of a `Request` body, or shutdown of an actual listener.

That is why the following complete `src/hosted-http-adapter.test.ts` uses the adapter itself separately. It creates the same application but enters through the public fetch boundary.

```typescript
import { FluoFactory } from '@fluojs/runtime';
import { expect, it } from 'vitest';
import { AdapterProbeModule, ProbeGate } from './adapter-probe.module.js';
import { HostedHttpAdapter } from './hosted-http-adapter.js';

it('rejects new ingress while draining the accepted request', async () => {
  const adapter = new HostedHttpAdapter();
  const app = await FluoFactory.create(AdapterProbeModule, { adapter });
  const gate = await app.get(ProbeGate);
  let request: Promise<Response> | undefined;
  let closing: Promise<void> | undefined;

  try {
    const before = await adapter.fetch(new Request('http://probe.test/posts/1'));
    expect(before.status).toBe(503);
    expect(await before.json()).toEqual({
      code: 'hosted_adapter_not_ready',
      status: 503,
      title: 'Backend unavailable',
    });

    await app.listen();
    request = adapter.fetch(new Request('http://probe.test/posts/1'));
    await gate.entered.promise;

    let closeSettled = false;
    closing = adapter.close();
    const observedClose = closing.then(() => { closeSettled = true; });
    expect(adapter.close()).toBe(closing);
    const blocked = await adapter.fetch(new Request('http://probe.test/posts/1'));
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get('content-type')).toBe('application/problem+json');
    expect(await blocked.json()).toEqual({
      code: 'hosted_adapter_closed',
      status: 503,
      title: 'Backend unavailable',
    });
    expect(closeSettled).toBe(false);

    gate.release.resolve();
    const response = await request;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')?.split(';')[0])
      .toBe('application/json');
    expect(await response.json()).toEqual({
      id: 1,
      title: 'Hello, Fluo!',
      content: 'My first post.',
      slug: 'hello-fluo',
      version: 2,
      publishedAt: '2026-09-01T00:00:00.000Z',
    });
    await observedClose;
    expect(closeSettled).toBe(true);
    expect(() => adapter.listen(app.dispatcher)).toThrow('Adapter is closed');
  } finally {
    gate.release.resolve();
    if (request) {
      const response = await request;
      if (!response.bodyUsed) {
        await response.body?.cancel();
      }
    }
    if (closing) {
      await closing;
    }
    await app.close();
  }
});
```

Observe the accepted request and the blocked request together. A request that entered before close still returns 200 and the correct post; a request after close receives 503; and close does not finish while the gate remains closed. A `finally` that releases the gate even when the test fails is necessary so that the next test does not inherit ongoing work. This file calls `adapter.close()` first to test the adapter's synchronous shutdown section directly, then disposes of application resources at the end. Ordinary applications use `app.close()`.

The test runner's finite timeout is an upper bound that ends a failing test, not a sleep used to produce correct behavior. If a real handler never finishes, this adapter's drain never finishes either. Forced shutdown deadlines and connection aborts required by a network host are the host's responsibility. This adapter without a listener does not claim to forcibly close sockets it does not own.

## Use the Shared Harness to Find Inputs You Missed

Passing one product scenario does not mean that query arrays, malformed cookies, independent `Set-Cookie` fields, `HEAD`, and byte ranges are correct too. Adapter authors can easily test only the examples they think of. `@fluojs/testing/web-runtime-adapter-portability` is a public subpath for testing these common input and output contracts with the same fixtures.

The following is the complete `src/hosted-http-adapter.portability.test.ts`. The harness creates this file's modules, so they do not depend on the post experiment's gate. The code distinguishes Web adapter configuration from general runtime options and consumes the harness's `cors: false` as an instruction not to install CORS in this experiment. It does not call a nonexistent `assertAll()` or private fixtures.

```typescript
import { FluoFactory, type CreateApplicationOptions } from '@fluojs/runtime';
import { createWebRuntimeHttpAdapterPortabilityHarness } from '@fluojs/testing/web-runtime-adapter-portability';
import { it } from 'vitest';
import {
  HostedHttpAdapter,
  type HostedAdapterOptions,
} from './hosted-http-adapter.js';

type BootstrapOptions =
  Omit<CreateApplicationOptions, 'adapter'> &
  HostedAdapterOptions &
  { cors?: false };

const portability = createWebRuntimeHttpAdapterPortabilityHarness<BootstrapOptions>({
  name: 'Book hosted adapter',
  createConditionalRequestBootstrapOptions: (options) => options,
  createErrorRepresentationBootstrapOptions: (options) => options,
  async bootstrap(rootModule, {
    maxBodySize,
    multipart,
    rawBody,
    cors: _cors,
    ...runtimeOptions
  }) {
    const adapter = new HostedHttpAdapter({ maxBodySize, multipart, rawBody });
    const app = await FluoFactory.create(rootModule, {
      ...runtimeOptions,
      adapter,
    });
    try {
      await app.listen();
    } catch (error: unknown) {
      try {
        await app.close();
      } catch (cleanupError: unknown) {
        throw new AggregateError([error, cleanupError], 'Startup and cleanup failed');
      }
      throw error;
    }
    return {
      close: () => app.close(),
      dispatch: adapter.fetch,
    };
  },
});

it('preserves decoded query arrays', () =>
  portability.assertPreservesQueryArraysAndDecoding());
it('preserves malformed cookie values', () =>
  portability.assertPreservesMalformedCookieValues());
it('preserves independent response cookies', () =>
  portability.assertSupportsPortableResponseCookies());
it('preserves JSON and text raw bodies', () =>
  portability.assertPreservesRawBodyForJsonAndText());
it('preserves byte-sensitive payloads', () =>
  portability.assertPreservesExactRawBodyBytesForByteSensitivePayloads());
it('excludes raw bodies from multipart requests', () =>
  portability.assertExcludesRawBodyForMultipart());
it('preserves body-bearing extension methods', () =>
  portability.assertSupportsCustomHttpRouteMethods());
it('preserves SSE framing', () =>
  portability.assertSupportsSseStreaming());
it('preserves single byte ranges', () =>
  portability.assertSupportsSingleByteRanges());
it('preserves conditional responses', () =>
  portability.assertSupportsConditionalRequests());
it('preserves negotiated error representations', () =>
  portability.assertSupportsHttpErrorRepresentations());
it('does not commit error representations after abort', () =>
  portability.assertDoesNotCommitAbortedHttpErrorRepresentations());
```

The bootstrap callback explicitly handles cleanup when `listen()` fails because the harness cannot dispose of an application it has not yet received. If startup and cleanup both fail, both causes are preserved. Once the application has been returned, the harness's cleanup contract handles failures in assertions and close. Ignoring close errors to turn a failing test green would erase the resource-ownership verification itself.

The byte-sensitive test is called separately in addition to the JSON and text raw-body tests. An implementation that decodes bytes into a string and encodes them again may pass with ordinary JSON while failing to preserve all bytes. The response cookie check also verifies that independent fields are preserved rather than combined into a comma-separated string. For SSE, the targets are the event-stream media type and framing, not a substitute measurement of network backpressure performance at the final consumer.

Conditional responses and byte ranges are also policies of the shared dispatcher. An adapter's "helpful" serialization must not add bodies to bodyless 304, 416, or `HEAD` responses, or slice binary ranges according to string positions. The configuration builders above forward the runtime options required by the fixtures unchanged. Keeping only adapter options and discarding the rest makes it look as though these checks are being run, but actually tests a different application in which the policies were never configured.

## Choose the Ownership Contract Before the Conformance Harness

`HttpApplicationAdapter` and `PlatformComponent` are not the same type. An HTTP adapter implements `listen(dispatcher)` and `close()` to connect the request boundary. A component such as persistence registered in `platform.components` has a different lifecycle, including validate, start, stop, and snapshot. Forcing an HTTP adapter into that list to pass generic conformance is not correct registration.

If you build an adapter that owns an actual Node listener, use `createHttpAdapterPortabilityHarness()` to verify the features it owns, such as listener URLs, TLS, signal listener disposal, and stream drain. For a host interface that already receives Web requests, as in this chapter, use the Web portability harness and separate integration tests on the actual host. This is the same principle that prevented us from claiming support for methods rejected by Next based solely on function tests outside Next.

For a new PlatformComponent, `createPlatformConformanceHarness()` is the right choice. For a change to PlatformShell start/stop overlap, a separate shell lifecycle harness is required. Distinguishing these roles is a way to discover missed ownership, not an excuse to reduce the amount of verification. This adapter does not support WebSockets, so it honestly returns an unsupported capability. It does not populate `getServer()` with a fake object that encourages a protocol package to attempt an upgrade.

The request replay tool is the actual usage surface, so test the sequence of reading the body, cancelling it, and closing the application there too. A demo that exits the process immediately after a successful GET is not evidence of drain or disposal. When an error representation provider completes late after a host abort, check that neither HTML nor canonical JSON is newly committed to an already-cancelled request. Database rollback and payment duplicate prevention are outside these adapter checks; retain the tests in the original feature modules.

## Conclusions to Record Before Turning This Into a Package

The value of the new adapter is not its new name or its number of layers. It implements only the necessary differences between the original host's `Request` and the existing Fluo modules, leaving body, routing, and error policies to shared implementations. This chapter's implementation is a socket-free, terminal, host-owned boundary; it does not claim to provide restart, forced shutdown, or transport drain of response bodies. For a product that needs those features, an already-verified official adapter may be the smaller choice.

The verification order for the chapter's code is module wiring, races between the adapter's actual fetch and close, Web portability, and use in the actual replay host. An earlier step does not substitute for a later step's result. If you extract this chapter's example into a project, explicitly run all three test files in the existing Vitest configuration and record the causes of any failures and the execution environment. In writing this manuscript, we do not rerun the full governance and build suites or pretend that the examples were executed.

We have now completed one extension boundary. The next chapter covers how to preserve public exports, peer dependencies, registration, and documentation contracts when moving code like this into a package other teams can use. Reuse begins not when you find a name to generalize, but when you can explain the actual ownership and failure conditions.

## Evidence and Reproduction Scope

- [runtime README](../../packages/runtime/README.md), [public root exports](../../packages/runtime/src/index.ts), [public Web subpath](../../packages/runtime/package.json), [Web factory and its two completion signals](../../packages/runtime/src/web.ts).
- [runtime bootstrap](../../packages/runtime/src/bootstrap.ts), [Application and creation options](../../packages/runtime/src/types.ts), [the actual HttpApplicationAdapter contract](../../packages/http/src/adapter.ts).
- [testing README](../../packages/testing/README.md), [public root exports](../../packages/testing/src/index.ts), [virtual inputs and responses in the request helper](../../packages/testing/src/http.ts), [Web portability harness](../../packages/testing/src/portability/web-runtime-adapter-portability.ts).
- [Web runtime portability regression tests](../../packages/testing/src/portability/web-runtime-adapter-portability.test.ts), [factory dispatch and multipart disposal implementation](../../packages/runtime/src/adapters/request-response-factory.ts), [platform conformance authoring contract](../../docs/contracts/platform-conformance-authoring-checklist.md).

This chapter provides complete implementation and test files, but it is not a report of a successful execution of the new adapter. It does not claim to have verified network listeners, TLS, host shutdown, real payments, or external transmissions.

[Previous: Running Fluo Inside Next.js](./ch15-nextjs-hosting.md) | [Contents](./toc.md) | [Next: Building a Reusable Fluo Extension Package](./ch17-extension-package.md)
