<!-- packages: @fluojs/testing, @fluojs/http, @fluojs/runtime -->
<!-- project-state: FluoBlog v0 -->

# Chapter 14. Portability Testing and Conformance Verification

This chapter explains the role of portability testing and conformance testing in verifying that fluo keeps the same behavior across multiple runtimes. If you implemented an adapter in Chapter 13, now you need to prove through automation that the adapter actually honors the contract.

## Learning Objectives
- Understand which failures portability testing and conformance testing each catch.
- Learn the structure and key verification surfaces of `HttpAdapterPortabilityHarness`.
- See how boundary cases such as malformed cookies, raw bodies, and SSE are verified.
- Analyze how the platform conformance suite checks lifecycle hooks and error boundaries.
- Summarize additional verification viewpoints needed at the Edge Runtime and WebSocket layers.
- Learn the flow for applying the harness to a custom adapter and checking its Behavioral Contract.

## Prerequisites
- Completion of Chapter 13.
- Basic understanding of HTTP Runtime contracts such as `RequestContext` and `FrameworkRequest`.
- Basic experience using Vitest or an equivalent test framework.

## 14.1 The Portability Challenge

In modern backend development, "Write Once, Run Anywhere" can easily break down in edge environments. If a framework supports multiple platforms such as Node.js, Bun, Cloudflare Workers, and Deno, it must guarantee that business logic behaves the same way regardless of the underlying engine.

Fluo verifies this condition through **Portability Testing**. Unlike standard unit tests that check whether a particular input returns X, portability tests check whether the *framework Facade* preserves semantic invariants across different adapters. The goal is to let developers focus on their own code rather than runtime-specific quirks.

When a developer moves an application from Fastify to a Cloudflare Workers adapter, the raw body buffer must not suddenly disappear, and an SSE stream must not be buffered by the adapter. Fluo's testing infrastructure is designed to expose these subtle differences before they reach production.

## 14.2 Conformance vs. Portability

Before looking at code, you need to distinguish these two concepts in the Fluo ecosystem. They cover different sides of reliability and work together to create a consistent developer experience across every supported platform.

- **Conformance**: Does this specific implementation satisfy the required interface and Behavioral Contract? For example, "Does this WebSocket adapter correctly implement the broadcast method according to the spec?"
- **Portability**: Do different implementations produce the same result for the same operation? For example, "Do both the Node.js and Bun adapters handle malformed cookies the same way under load?"

The `@fluojs/testing` package provides specialized harnesses for both. Adapter authors usually run conformance tests to check their own implementation details. Portability tests run as part of the framework core verification suite to prevent platform-specific behavior from leaking through higher-level APIs.

Keeping both standards in place lets developers switch runtimes without changing behavior. This consistency connects directly to Fluo's "standard-first" philosophy, which provides a reliable baseline for complex distributed systems.

## 14.3 HttpAdapterPortabilityHarness Anatomy

The main tool for verifying HTTP adapters is `HttpAdapterPortabilityHarness`. It lives in `packages/testing/src/portability/http-adapter-portability.ts` and serves as the baseline for validating new or existing HTTP adapter implementations.

### Interface Definition

The harness requires `bootstrap` and `run` functions to manage the application lifecycle during tests. This lets it simulate startup and shutdown scenarios that can differ between runtimes such as Node.js and Bun.

```typescript
export interface HttpAdapterPortabilityHarnessOptions<
  TBootstrapOptions extends object,
  TRunOptions extends object,
  TApp extends AppLike = AppLike,
> {
  bootstrap: (rootModule: ModuleType, options: TBootstrapOptions) => Promise<TApp>;
  name: string;
  run: (rootModule: ModuleType, options: TRunOptions) => Promise<TApp>;
}
```

### Key Test Surfaces

The harness covers several critical surfaces where runtimes often diverge. The purpose is to make sure the Fluo abstraction layer does not leak across different execution environments:

1. **Cookie Handling**: Ensures malformed cookies do not crash the server or contaminate other headers.
2. **Raw Body Preservation**: Verifies that `rawBody` is available for JSON and Text to save memory, but excluded for Multipart.
3. **SSE (Server-Sent Events)**: Confirms proper streaming behavior that keeps the connection open without buffering.
4. **Startup Logs**: Verifies that adapters correctly report the listening host and port through standardized hooks.
5. **Shutdown Signals**: Ensures `SIGTERM` and `SIGINT` listeners are cleaned up correctly after shutdown to prevent memory leaks.

## 14.4 Implementation Deep Dive: Malformed Cookies

One common source of adapter failures is overly aggressive header normalization. When a client sends a malformed cookie, some libraries may throw an unhandled exception, while others may ignore all cookies and break session management.

Fluo's harness enforces a "preserve but don't crash" policy. This means the adapter must be able to handle invalid data without interrupting the request lifecycle.

```typescript
async assertPreservesMalformedCookieValues(): Promise<void> {
  @Controller('/cookies')
  class CookieController {
    @Get('/')
    readCookies(_input: undefined, context: RequestContext) {
      return context.request.cookies;
    }
  }

  // ... bootstrap the app ...

  const response = await fetch(`http://127.0.0.1:${port}/cookies`, {
    headers: {
      cookie: 'good=hello%20world; bad=%E0%A4%A',
    },
  });

  const body = await response.json();
  // 'bad' must remain '%E0%A4%A' and 'good' must be decoded.
}
```

By running the same test against every official adapter, Fluo maintains a consistent developer experience. Standardization across runtimes is the core challenge. Whether developers choose Node.js for its broad ecosystem or Bun for speed, their expectations for how Fluo handles basic primitives must not change.

This level of strictness lets higher-level abstractions be built reliably on top of the adapter layer. It also gives third-party developers clear requirements and automated tests, making it simpler to contribute their own adapters.

As it supports more edge cases and platform features, the portability harness acts as a living specification for Fluo's adapter interface. It is the source of truth when checking behavior expectations inside the framework.

## 14.5 Conformance Checks: Hono-Adapter Style

The Hono project is well known for compliance with "standard" middleware and adapters. Fluo takes a similar approach in `packages/testing/src/conformance`, focusing on explicit contracts rather than implicit assumptions.

For example, `platform-conformance.ts` checks whether a Platform Adapter correctly handles Module Graph initialization. This includes verifying that every Provider is instantiated in the correct order and that lifecycle hooks are triggered at the expected moments.

### Platform Conformance Surface

The platform conformance suite focuses on the core handshake between the adapter and the Runtime. It checks whether the adapter correctly signals its capabilities and whether the Runtime can successfully bind its dispatcher to the adapter's listener.

A central part of conformance is verifying that `onModuleInit`, `onApplicationBootstrap`, and `onApplicationShutdown` hooks fire at the exact moments that match the adapter's own startup and shutdown sequence. The conformance suite uses a set of "spy" Providers to record the exact order of these events. Any drift from the standard Fluo lifecycle fails the test, reducing subtle bugs that only appear in production.

Strict lifecycle consistency keeps plugins and interceptors predictable across every environment when they depend on a specific startup phase, such as database connection or metrics initialization. If an adapter runs `onApplicationBootstrap` before the real server is ready to accept requests, a race condition can drop requests during warmup. The conformance harness explicitly tests this scenario by sending a probe request immediately after the bootstrap signal is emitted.

This reliability extends to how Fluo handles resource cleanup. During shutdown, the conformance suite checks that the adapter gracefully closes all active connections and exits after pending requests complete. This ensures clean application shutdown in container environments such as Kubernetes, where SIGTERM handling is required for zero-downtime deployments.

Platform conformance checks also include strict evaluation of the adapter's error boundary. If an unhandled exception occurs during bootstrap, the adapter must prove that it can report the error through the standard Fluo diagnostics channel and exit the process with a non-zero exit code. This "fail-fast" behavior is needed to prevent "zombie" processes that appear to be running even though they cannot handle traffic.

```typescript
// packages/testing/src/conformance/platform-conformance.ts
export interface PlatformConformanceOptions {
  adapter: HttpApplicationAdapter;
  // ...
}

export async function runPlatformConformance(options: PlatformConformanceOptions) {
  // 1. Check instance registration
  // 2. Check lifecycle hook execution order
  // 3. Check error handling during bootstrap

  it('reports realtime capabilities correctly', async () => {
    const caps = options.adapter.getRealtimeCapability?.();
    expect(caps).toBeDefined();
    // ... check additional capabilities ...
  });

  it('handles listen() failures gracefully', async () => {
    // ... test logic for port conflicts and similar cases ...
  });
}
```

This lets someone writing a new adapter, such as a hypothetical `AzureFunctionsAdapter`, immediately validate their work against the framework's internal requirements. It also acts as expected-behavior documentation for new adapter authors.

### Conformance Testing for Library Authors

If you develop a library that extends fluo, such as a custom validation pipe or logging interceptor, you should provide conformance tests to users. This ensures the library behaves as expected inside the fluo ecosystem and does not cause side effects. An extensible `BaseLibraryConformanceHarness` is available so you can define the library's specific behavior requirements.

For custom pipes, the conformance suite focuses on how invalid input is handled and whether metadata from the DI container is propagated correctly. For interceptors, it focuses on execution order and correct handling of both synchronous and asynchronous results. A common mistake by pipe authors is missing nested object transformation. The conformance harness includes deep validation scenarios that check structural integrity for complex DTOs.

```typescript
// packages/testing/src/conformance/library-conformance.ts
export function runPipeConformance(pipe: Pipe, options: PipeOptions) {
  it('throws BadRequestException for invalid input', async () => {
    // ... test logic ...
  });
  
  it('preserves metadata during transformation', async () => {
    // ... test logic ...
  });
}
```

These automated checks ensure fluo's "pluggable" nature does not trade away stability. Every extension point in the framework has a conformance area that guides library authors toward stable implementations. For example, a custom logging interceptor must prove that it does not accidentally consume the request body stream. Otherwise, later controllers may be unable to read the payload. The library conformance harness includes a "stream integrity" test that checks whether the underlying `ReadableStream` is cloned correctly or left intact when the interceptor only needs to observe headers.

By following the patterns used in `@fluojs/testing/conformance`, you can give users a standardized way to verify integrations. This improves ecosystem reliability and builds trust with users. Consistent tests lead to consistent behavior, which is the core goal of the fluo framework. When you create your own tools and libraries, you should make this philosophy a priority in your development process.

Beyond basic functionality, conformance harnesses for library authors also check memory efficiency and performance overhead. For example, middleware that performs authentication must not add large latency or keep references to request objects after the response has been sent. Internal benchmarking tools integrated into the conformance suite give library authors immediate feedback about the cost of their abstractions.

When introducing a new extension pattern, library authors are encouraged to participate in Fluo's RFC process. That way, the conformance area for the pattern can be designed together with core maintainers, making the whole framework more cohesive and predictable. The ecosystem grows safely when it shares the same standards for reliability and transparency.

## 14.6 Portability for Edge Runtimes

Edge Runtimes such as Cloudflare Workers and Vercel Edge Functions use the `Fetch API` instead of Node's legacy `http` module. This requires a different kind of portability testing, visible in `web-runtime-adapter-portability.ts`. These tests matter because edge environment constraints, such as memory limits and the absence of Node.js globals, often reveal bugs that do not appear during local development.

These tests focus on the following:
- **Global Scope**: Availability and correct behavior of `fetch`, `Request`, `Response`, and `Headers`.
- **Streaming**: Ensuring `ReadableStream` behavior for large payloads does not cause partial reads or memory spikes.
- **Crypto**: Availability and performance of `crypto.subtle` for JWT signing or other cryptographic work.
- **Execution Limits**: Verifying that the adapter correctly handles CPU time limits and asynchronous work scheduling, such as `waitUntil`, within the framework lifecycle.

Verifying these surfaces gives teams evidence that Fluo applications are truly portable. They can move compute to the edge without rewriting core logic. The edge-specific harness also simulates "cold start" scenarios to ensure the framework's initialization overhead stays within the strict limits imposed by modern serverless platforms.

## 14.7 Testing the WebSocket Layer

WebSocket conformance is especially tricky because the protocol differs widely across implementations, such as standard `ws`, engine.io, and socket.io. Fluo's `fetch-style-websocket-conformance.ts` focuses on the modern `Upgrade` header and `WebSocketPair` pattern used by Web APIs.

Key verification items include:
- Connection establishment and protocol negotiation
- Message echoing and state preservation across frames
- Binary data handling (ArrayBuffer, Blob)
- Graceful shutdown and error propagation
- Heartbeats and Keep-Alive: ensuring the adapter can handle long-lived connections without leaking resources or timing out too early.

By standardizing WebSocket semantics for Web APIs, Fluo provides a bridge between traditional Node.js servers and modern Edge Runtimes. This means a WebSocket service written for a Node.js Fastify backend can be ported to Cloudflare Workers with minimal changes as long as the adapter satisfies the conformance suite. The test suite also covers heartbeat mechanisms, which often cause subtle bugs in long-lived connections.

The WebSocket harness also includes "backpressure" tests. These verify that the adapter correctly handles situations where the client cannot consume messages as quickly as the server produces them. By using the underlying `WritableStream` abstraction, Fluo ensures the server does not exhaust memory buffers during high-throughput realtime communication.

## 14.8 Practical Exercise: Verifying Your Custom Adapter

If you implemented a custom adapter in Chapter 13, you should now verify it with the harness. This is the key test that checks whether your adapter complies with the fluo Behavioral Contract. Passing the portability harness gives you evidence that the adapter can be deployed to different runtimes without breaking existing business logic.

```typescript
import { createHttpAdapterPortabilityHarness } from '@fluojs/testing/portability';
import { myAdapter } from './my-adapter';

const harness = createHttpAdapterPortabilityHarness({
  name: 'MyCustomAdapter',
  bootstrap: async (module, opts) => {
    const app = await FluoFactory.create(module, { adapter: myAdapter(opts) });
    return app;
  },
  run: async (module, opts) => {
    return await FluoFactory.run(module, { adapter: myAdapter(opts) });
  }
});

describe('MyCustomAdapter Portability', () => {
  it('preserves malformed cookies', () => harness.assertPreservesMalformedCookieValues());
  it('handles SSE', () => harness.assertSupportsSseStreaming());
  it('respects abort signals', () => harness.assertPropagatesAbortSignals());
  it('verifies raw body integrity', () => harness.assertPreservesRawBodyBuffer());
});
```

When you run these tests, you should also inspect timing data. Slow tests in the portability suite can signal that a lower-level implementation of a platform primitive is not optimized. Use feedback from the harness to refine the adapter and check both correctness and performance.

## 14.9 Why Line-by-Line Consistency Matters

The fluo project follows a strict policy that English and Korean documents must keep the same headings. This is not just a formatting concern. It lets the CI/CD pipeline run automated diffs to confirm that technical sections were not lost during translation.

Every heading in this file exactly matches the corresponding section in the English version. This consistency ensures that technical depth and teaching clarity are preserved across languages. Readers should be able to follow the same technical guide whether they read in English or Korean, which is necessary for a framework that aims for global adoption and contributor trust.

This symmetry extends to code examples. Keeping document structure synchronized lets developers switch languages without losing the flow or encountering conflicting facts. Reliability in documentation matters as much as reliability in code.

## Summary

Portability testing is the foundation of Fluo reliability. With `HttpAdapterPortabilityHarness` and the conformance suites, you can verify that the "standard-first" promise holds whether your code runs on a large Node.js server or a lightweight edge function.

This commitment to behavioral consistency means you can focus on business logic without being pushed around by quirks of the underlying platform. Fluo's testing infrastructure is designed to catch those differences before they reach production. As the range of supported platforms keeps growing, these automated checks remain the main tool for maintaining the ecosystem's baseline.

Every adapter author is encouraged to use these tools to make sure their implementation is compatible with Fluo's vision. Strong testing is not an add-on, but a requirement of the modern multi-runtime web. By following these conformance and portability standards, you help create a more stable and predictable foundation for every Fluo developer.

The next chapter covers **Studio**, a visual diagnostics tool for inspecting the generated Module Graph and resolving complex dependency problems.
