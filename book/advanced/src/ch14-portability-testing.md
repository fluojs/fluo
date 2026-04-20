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

Fluo achieves this through **Portability Testing**. Unlike standard unit tests that check if a function returns X given Y, portability tests verify that the *framework facade* preserves semantic invariants across different adapters.

If a developer moves their application from Fastify to a Cloudflare Workers adapter, they shouldn't suddenly find that their raw body buffers are missing or that their SSE streams are buffered by the adapter.

## 14.2 Conformance vs. Portability

Before diving into the code, it's essential to distinguish between these two concepts in the Fluo ecosystem. They represent two sides of the same reliability coin.

- **Conformance**: Does this specific implementation satisfy the required interface and behavioral contract? (e.g., "Does this WebSocket adapter correctly implement the broadcast method?")
- **Portability**: Do different implementations yield the same result for the same operation? (e.g., "Do both the Node.js and Bun adapters handle malformed cookies the same way?")

The `@fluojs/testing` package provides specialized harnesses for both. Conformance testing is often performed by the adapter author, while portability testing is usually part of the framework's core verification suite to ensure that no platform-specific leakage occurs.

By maintaining high standards for both, Fluo ensures that developers can transition between runtimes with minimal friction and zero behavior changes.

## 14.3 HttpAdapterPortabilityHarness Anatomy

The core tool for verifying HTTP adapters is the `HttpAdapterPortabilityHarness`. It lives in `packages/testing/src/portability/http-adapter-portability.ts`.

### Interface Definition

The harness requires a `bootstrap` and a `run` function to manage the application lifecycle during tests.

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

The harness covers several critical surfaces that often differ between runtimes:

1. **Cookie Handling**: Ensuring malformed cookies don't crash the server.
2. **Raw Body Preservation**: Verifying that `rawBody` is available for JSON and Text but excluded for Multipart.
3. **SSE (Server-Sent Events)**: Checking for proper streaming behavior and content-type headers.
4. **Startup Logs**: Validating that the adapter correctly reports the listening host and port.
5. **Shutdown Signals**: Ensuring listeners for `SIGTERM` are cleaned up correctly.

## 14.4 Implementation Deep Dive: Malformed Cookies

One of the most common ways an adapter can fail is by being too aggressive with header normalization. If a client sends a malformed cookie, some libraries might throw an unhandled exception, while others might silently drop all cookies.

Fluo's harness enforces a "preserve but don't crash" policy.

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

By running this same test against every official adapter, Fluo ensures a consistent developer experience.

Standardization across runtimes is one of our highest priorities. Whether a developer chooses Node.js for its vast ecosystem or Bun for its raw speed, the expectations for how Fluo handles basic primitives like cookies remains unchanged.

This level of rigor allows us to build higher-level abstractions on top of the adapter layer, confident that the foundation is solid. It also simplifies the process for third-party developers to contribute their own adapters, as they have a clear set of requirements to follow.

The portability harness acts as a living specification of the Fluo adapter interface, evolving as we support more edge cases and platform features.

## 14.5 Conformance Checks: Hono-Adapter Style

The Hono project is famous for its "Standard" middleware and adapter compliance. Fluo takes a similar approach in `packages/testing/src/conformance`.

For instance, the `platform-conformance.ts` checks if a platform adapter correctly handles the module graph initialization.

### Platform Conformance Surface

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
}
```

This ensures that when someone writes a new adapter (like a hypothetical `AzureFunctionsAdapter`), they can simply import the conformance suite and verify their work.

### Conformance Testing for Library Authors

If you are developing a library that extends Fluo—such as a custom validation pipe or a logging interceptor—you should also provide conformance tests for your users. This ensures that your library behaves as expected within the Fluo ecosystem.

By following the same patterns used in `@fluojs/testing/conformance`, you can create a standardized way for your users to verify their integration with your library. This not only improves the reliability of the ecosystem but also builds trust with your users.

Consistency in testing leads to consistency in behavior, which is the ultimate goal of the Fluo framework. As you build your own tools and libraries, keep this philosophy at the forefront of your development process.

## 14.6 Portability for Edge Runtimes

Edge runtimes like Cloudflare Workers or Vercel Edge Functions use the `Fetch API` instead of Node's `http` module. This requires a different kind of portability testing found in `web-runtime-adapter-portability.ts`.

These tests focus on:
- **Global Scope**: Availability of `fetch`, `Request`, `Response`, `Headers`.
- **Streaming**: ReadableStream behavior for large payloads.
- **Crypto**: `crypto.subtle` availability for JWT signing.

## 14.7 Testing the WebSocket Layer

WebSocket conformance is particularly tricky because protocols vary (standard `ws` vs. engine.io vs. socket.io). Fluo's `fetch-style-websocket-conformance.ts` focuses on the modern `Upgrade` header and `WebSocketPair` pattern used in the Web API.

It verifies:
- Connection establishment
- Message echoing
- Binary data handling
- Graceful closing

By standardizing on the Web API's WebSocket semantics, Fluo provides a bridge between traditional Node.js servers and modern Edge runtimes. This means that a WebSocket service written for a Node.js Fastify backend can be ported to Cloudflare Workers with minimal changes, provided the adapter satisfies the conformance suite.

The test suite also covers sub-protocol negotiation and heartbeat mechanisms, which are often sources of subtle bugs when moving between different WebSocket library implementations.

## 14.8 Practical Exercise: Verifying Your Custom Adapter

If you implemented a custom adapter in Chapter 13, you should now verify it using the harness. This is the ultimate test of whether your adapter adheres to the Fluo behavioral contract.

A successful pass through the portability harness gives you the confidence to deploy your adapter across different runtimes without fear of breaking existing business logic. It also serves as documentation for your team on how the adapter handles complex scenarios.

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
});
```

By integrating these tests into your local development cycle, you ensure that any changes to your adapter don't introduce subtle regressions that could affect the entire application.

## 14.9 Why Line-by-Line Consistency Matters

In the Fluo project, we maintain a strict policy where English and Korean documentation must have identical headings. This isn't just for aesthetics; it allows our CI/CD pipelines to perform automated diffing to ensure that no technical section is missed during translation.

Every heading in this file corresponds exactly to a section in the Korean version.

## Summary

Portability testing is the bedrock of Fluo's reliability. By using the `HttpAdapterPortabilityHarness` and conformance suites, we ensure that the "Standard-First" promise holds true whether your code is running on a massive Node.js server or a lightweight Edge function.

Our commitment to behavioral consistency means that you can invest in your business logic without worrying about the underlying platform's quirks. Fluo's testing infrastructure is designed to catch these differences before they ever reach your production environment.

As we continue to expand the range of supported platforms, these automated checks will remain our primary tool for maintaining the high standards of the ecosystem. We encourage all adapter authors to leverage these tools to ensure their implementations are fully compatible with the Fluo vision.

In the next chapter, we will explore **Studio**, the visual diagnostic tool that helps you inspect the resulting module graph and troubleshoot complex dependency issues.
