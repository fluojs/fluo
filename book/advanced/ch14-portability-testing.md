<!-- packages: @fluojs/testing, @fluojs/http, @fluojs/runtime -->
<!-- project-state: FluoBlog v0 -->

# Chapter 14. Portability Testing and Conformance — 이식성 테스트와 적합성 검증

## What You Will Learn in This Chapter
- The importance of behavioral consistency across runtimes
- Structure and implementation of `HttpAdapterPortabilityHarness`
- Platform conformance checks for WebSocket and Web runtimes
- Hono-adapter-style application of conformance checks
- Verification of edge cases: malformed cookies, raw body preservation, and SSE

## Prerequisites
- Understanding of custom adapter implementation from Chapter 13
- Familiarity with the `RequestContext` and `FrameworkRequest` interfaces
- Basic knowledge of Vitest or similar testing frameworks

## 14.1 The Portability Challenge

In modern backend development, "Write Once, Run Anywhere" is often a dream that breaks at the edge. A framework that supports multiple platforms—Node.js, Bun, Cloudflare Workers, and Deno—must ensure that the business logic behaves identically regardless of the underlying engine.

Fluo achieves this through **Portability Testing**. Unlike standard unit tests that check if a function returns X given Y, portability tests verify that the *framework facade* preserves semantic invariants across different adapters. This ensures that a developer can focus on their code rather than the peculiarities of the runtime environment.

If a developer moves their application from Fastify to a Cloudflare Workers adapter, they shouldn't suddenly find that their raw body buffers are missing or that their SSE streams are buffered by the adapter. Fluo's testing infrastructure is designed to catch these subtle differences long before they reach production.

## 14.2 Conformance vs. Portability

Before diving into the code, it's essential to distinguish between these two concepts in the Fluo ecosystem. They represent two sides of the same reliability coin, working together to ensure a seamless developer experience across all supported platforms.

- **Conformance**: Does this specific implementation satisfy the required interface and behavioral contract? (e.g., "Does this WebSocket adapter correctly implement the broadcast method according to the spec?")
- **Portability**: Do different implementations yield the same result for the same operation? (e.g., "Do both the Node.js and Bun adapters handle malformed cookies the same way under stress?")

The `@fluojs/testing` package provides specialized harnesses for both. Conformance testing is often performed by the adapter author to verify their implementation details, while portability testing is part of the framework's core verification suite to ensure that no platform-specific leakage occurs in the higher-level APIs.

By maintaining high standards for both, Fluo ensures that developers can transition between runtimes with minimal friction and zero behavior changes. This consistency is the foundation of our "Standard-First" philosophy, providing a reliable baseline for complex distributed systems.

## 14.3 HttpAdapterPortabilityHarness Anatomy

The core tool for verifying HTTP adapters is the `HttpAdapterPortabilityHarness`. It lives in `packages/testing/src/portability/http-adapter-portability.ts` and acts as a comprehensive validator for any new or existing HTTP adapter implementation.

### Interface Definition

The harness requires a `bootstrap` and a `run` function to manage the application lifecycle during tests. This allows it to simulate various startup and shutdown scenarios that might differ between runtimes like Node.js and Bun.

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

The harness covers several critical surfaces that often differ between runtimes, ensuring that the Fluo abstraction layer remains leak-proof across different execution environments:

1. **Cookie Handling**: Ensuring malformed cookies don't crash the server or corrupt other headers.
2. **Raw Body Preservation**: Verifying that `rawBody` is available for JSON and Text but excluded for Multipart to save memory.
3. **SSE (Server-Sent Events)**: Checking for proper streaming behavior, keeping connections open without buffering.
4. **Startup Logs**: Validating that the adapter correctly reports the listening host and port via standardized hooks.
5. **Shutdown Signals**: Ensuring listeners for `SIGTERM` and `SIGINT` are cleaned up correctly to avoid memory leaks.

## 14.4 Implementation Deep Dive: Malformed Cookies

One of the most common ways an adapter can fail is by being too aggressive with header normalization. If a client sends a malformed cookie, some libraries might throw an unhandled exception, while others might silently drop all cookies, breaking session management.

Fluo's harness enforces a "preserve but don't crash" policy. This means the adapter must be resilient enough to handle invalid data without interrupting the request lifecycle.

```typescript
async assertPreservesMalformedCookieValues(): Promise<void> {
  @Controller('/cookies')
  class CookieController {
    @Get('/')
    readCookies(_input: undefined, context: RequestContext) {
      return context.request.cookies;
    }
  }

  // ... bootstrap app ...

  const response = await fetch(`http://127.0.0.1:${port}/cookies`, {
    headers: {
      cookie: 'good=hello%20world; bad=%E0%A4%A',
    },
  });

  const body = await response.json();
  // Expecting 'bad' to remain '%E0%A4%A' and 'good' to be decoded
}
```

By running this same test against every official adapter, Fluo ensures a consistent developer experience. Standardization across runtimes is one of our highest priorities. Whether a developer chooses Node.js for its vast ecosystem or Bun for its raw speed, the expectations for how Fluo handles basic primitives remains unchanged.

This level of rigor allows us to build higher-level abstractions on top of the adapter layer, confident that the foundation is solid. It also simplifies the process for third-party developers to contribute their own adapters, as they have a clear set of requirements and automated tests to follow.

The portability harness acts as a living specification of the Fluo adapter interface, evolving as we support more edge cases and platform features. It is the ultimate source of truth for behavioral expectations within the framework.

## 14.5 Conformance Checks: Hono-Adapter Style

The Hono project is famous for its "Standard" middleware and adapter compliance. Fluo takes a similar approach in `packages/testing/src/conformance`, focusing on explicit contracts rather than implicit assumptions.

For instance, the `platform-conformance.ts` checks if a platform adapter correctly handles the module graph initialization. This involves verifying that all providers are instantiated in the correct order and that lifecycle hooks are triggered exactly when expected.

### Platform Conformance Surface

The platform conformance suite focuses on the core handshake between the adapter and the runtime. It ensures that the adapter correctly signals its capabilities and that the runtime can successfully bind its dispatcher to the adapter's listener.

A critical part of conformance is ensuring that the `onModuleInit`, `onApplicationBootstrap`, and `onApplicationShutdown` hooks are triggered at the correct time relative to the adapter's own startup and shutdown sequence. The conformance suite uses a set of "spy" providers to record the exact order of these events. Any deviation from the standard Fluo lifecycle will result in a test failure, preventing subtle bugs that only appear in production.

By maintaining strict lifecycle consistency, Fluo ensures that plugins and interceptors that rely on specific startup phases (such as database connections or metric initialization) behave predictably across all environments. If an adapter fires `onApplicationBootstrap` before the underlying server is actually ready to receive traffic, it could lead to race conditions where requests are lost during the warmup period. The conformance harness explicitly tests for these scenarios by attempting to send a probe request immediately after the bootstrap signal is emitted.

This reliability extends to the way Fluo handles resource cleanup. During the shutdown phase, the conformance suite verifies that the adapter gracefully closes all active connections and allows pending requests to complete before exiting. This prevents data loss and ensuring that your application shuts down cleanly in containerized environments like Kubernetes, where SIGTERM handling is crucial for zero-downtime deployments.

Furthermore, the platform conformance checks include a rigorous evaluation of the adapter's error boundary. When an unhandled exception occurs during the bootstrap phase, the adapter must demonstrate that it can report the error via the standard Fluo diagnostic channel and terminate the process with a non-zero exit code. This "fail-fast" behavior is essential for preventing "zombie" processes that appear to be running but are unable to serve traffic.

```typescript
// packages/testing/src/conformance/platform-conformance.ts
export interface PlatformConformanceOptions {
  adapter: HttpApplicationAdapter;
  // ...
}

export async function runPlatformConformance(options: PlatformConformanceOptions) {
  // 1. Verify instance registration
  // 2. Verify lifecycle hook execution order
  // 3. Verify error handling during bootstrap
  
  it('should correctly report realtime capabilities', async () => {
    const caps = options.adapter.getRealtimeCapability?.();
    expect(caps).toBeDefined();
    // ... further capability checks ...
  });
  
  it('should gracefully handle listen() failures', async () => {
    // ... test logic for port conflicts, etc ...
  });
}
```

This ensures that when someone writes a new adapter (like a hypothetical `AzureFunctionsAdapter`), they can simply import the conformance suite and verify their work against the framework's internal requirements. It also serves as a documentation of the expected behavior for any new adapter author.

### Conformance Testing for Library Authors

If you are developing a library that extends Fluo—such as a custom validation pipe or a logging interceptor—you should also provide conformance tests for your users. This ensures that your library behaves as expected within the Fluo ecosystem and doesn't introduce side effects. We provide a `BaseLibraryConformanceHarness` that you can extend to define your library's specific behavioral requirements.

For custom pipes, the conformance suite focuses on how they handle invalid input and whether they correctly propagate metadata from the DI container. For interceptors, the focus is on the execution order and the ability to correctly handle both synchronous and asynchronous results. A common pitfall for pipe authors is neglecting the transformation of nested objects; our conformance harness includes deep-validation scenarios that ensure your pipe respects the structural integrity of complex DTOs.

```typescript
// packages/testing/src/conformance/library-conformance.ts
export function runPipeConformance(pipe: Pipe, options: PipeOptions) {
  it('should throw BadRequestException on invalid input', async () => {
    // ... test logic ...
  });
  
  it('should preserve metadata during transformation', async () => {
    // ... test logic ...
  });
}
```

These automated checks ensure that the "pluggable" nature of Fluo doesn't come at the cost of stability. Every extension point in the framework has a corresponding conformance surface to guide library authors toward the most robust implementation. For example, a custom logging interceptor must demonstrate that it doesn't accidentally consume the request body stream, which would prevent subsequent controllers from reading the payload. The library conformance harness includes "stream integrity" tests that verify the underlying `ReadableStream` is either cloned correctly or left untouched if the interceptor only needs to observe headers.

By following the same patterns used in `@fluojs/testing/conformance`, you can create a standardized way for your users to verify their integration. This not only improves the reliability of the ecosystem but also builds deep trust with your users. Consistency in testing leads to consistency in behavior, which is the ultimate goal of the Fluo framework. As you build your own tools and libraries, keep this philosophy at the forefront of your development process.

Beyond basic functionality, the conformance harness for library authors also checks for memory efficiency and performance overhead. For instance, a middleware that performs authentication must not introduce significant latency or retain references to the request object after the response has been sent. Our internal benchmarking tools, integrated into the conformance suite, provide library authors with immediate feedback on the "cost" of their abstractions.

We also encourage library authors to participate in the Fluo RFC process when introducing new extension patterns. This ensures that the conformance surfaces for those patterns are designed in collaboration with the core maintainers, leading to a more cohesive and predictable framework for everyone. The community thrives when everyone adheres to the same high standards of reliability and transparency.

## 14.6 Portability for Edge Runtimes

Edge runtimes like Cloudflare Workers or Vercel Edge Functions use the `Fetch API` instead of Node's legacy `http` module. This requires a different kind of portability testing found in `web-runtime-adapter-portability.ts`. These tests are critical because the constraints of edge environments (like memory limits and lack of Node.js globals) often reveal bugs that are invisible in local development.

These tests focus on:
- **Global Scope**: Availability and correct behavior of `fetch`, `Request`, `Response`, and `Headers`.
- **Streaming**: Ensuring `ReadableStream` behavior for large payloads doesn't result in partial reads or memory spikes.
- **Crypto**: `crypto.subtle` availability and performance for JWT signing and other cryptographic operations.
- **Execution Limits**: Verifying that the adapter handles CPU time limits and asynchronous task scheduling (e.g., `waitUntil`) correctly within the framework's lifecycle.

By verifying these surfaces, we ensure that Fluo applications remain truly portable, allowing teams to move their compute to the edge without rewriting their core application logic. The edge-specific harness also simulates "cold start" scenarios to ensure that the framework's initialization overhead remains within the strict limits imposed by modern serverless platforms.

## 14.7 Testing the WebSocket Layer

WebSocket conformance is particularly tricky because protocols vary significantly across implementations (standard `ws` vs. engine.io vs. socket.io). Fluo's `fetch-style-websocket-conformance.ts` focuses on the modern `Upgrade` header and `WebSocketPair` pattern used in the Web API.

It verifies:
- Connection establishment and protocol negotiation
- Message echoing and state persistence across frames
- Binary data handling (ArrayBuffer, Blob)
- Graceful closing and error propagation
- Heartbeat and Keep-Alive: Ensuring the adapter can handle long-lived connections without timing out prematurely or leaking resources.

By standardizing on the Web API's WebSocket semantics, Fluo provides a bridge between traditional Node.js servers and modern Edge runtimes. This means that a WebSocket service written for a Node.js Fastify backend can be ported to Cloudflare Workers with minimal changes, provided the adapter satisfies the conformance suite. The test suite also covers heartbeat mechanisms, which are often sources of subtle bugs in long-lived connections.

The WebSocket harness also includes "backpressure" tests. These verify that the adapter correctly handles situations where the client is unable to consume messages as fast as the server is producing them. By leveraging the underlying `WritableStream` abstractions, Fluo ensures that the server doesn't exhaust its memory buffer during high-throughput real-time communication.

## 14.8 Practical Exercise: Verifying Your Custom Adapter

If you implemented a custom adapter in Chapter 13, you should now verify it using the harness. This is the ultimate test of whether your adapter adheres to the Fluo behavioral contract. A successful pass through the portability harness gives you the confidence to deploy your adapter across different runtimes without fear of breaking existing business logic.

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
  it('should preserve malformed cookies', () => harness.assertPreservesMalformedCookieValues());
  it('should handle SSE', () => harness.assertSupportsSseStreaming());
  it('should respect abort signals', () => harness.assertPropagatesAbortSignals());
  it('should verify raw body integrity', () => harness.assertPreservesRawBodyBuffer());
});
```

As you run these tests, pay close attention to the timing data. A slow test in the portability suite often indicates a sub-optimal implementation of a platform primitive. Use the feedback from the harness to refine your adapter, ensuring it is not only correct but also performant.

## 14.9 Why Line-by-Line Consistency Matters

In the Fluo project, we maintain a strict policy where English and Korean documentation must have identical headings. This isn't just for aesthetics; it allows our CI/CD pipelines to perform automated diffing to ensure that no technical section is missed during translation.

Every heading in this file corresponds exactly to a section in the Korean version. This consistency ensures that the technical depth and instructional clarity are preserved across linguistic boundaries. Whether you are reading in English or Korean, you are receiving the same high-quality technical guidance, which is essential for a framework that aims for global adoption and contributor trust.

This commitment to parity also extends to the code examples. By keeping the documentation structures in sync, we ensure that a developer can seamlessly switch between languages without losing their place in the narrative or encountering different versions of the truth. Reliability in documentation is just as important as reliability in code.

## Summary

Portability testing is the bedrock of Fluo's reliability. By using the `HttpAdapterPortabilityHarness` and conformance suites, we ensure that the "Standard-First" promise holds true whether your code is running on a massive Node.js server or a lightweight Edge function.

Our commitment to behavioral consistency means that you can invest in your business logic without worrying about the underlying platform's quirks. Fluo's testing infrastructure is designed to catch these differences before they ever reach your production environment. As we continue to expand the range of supported platforms, these automated checks will remain our primary tool for maintaining the high standards of the ecosystem.

We encourage all adapter authors to leverage these tools to ensure their implementations are fully compatible with the Fluo vision. Robust testing is not a luxury but a requirement for the modern, multi-runtime web. By adhering to these conformance and portability standards, you are helping build a more stable and predictable future for all Fluo developers.

In the next chapter, we will explore **Studio**, the visual diagnostic tool that helps you inspect the resulting module graph and troubleshoot complex dependency issues.

---
<!-- lines: 258 -->
