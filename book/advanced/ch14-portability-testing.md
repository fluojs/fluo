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
2. **Raw Body Preservation**: Verifies that `rawBody` is available for JSON and text, preserves exact bytes for byte-sensitive payloads, and is excluded for multipart requests to save memory.
3. **SSE (Server-Sent Events)**: Confirms proper streaming behavior that keeps the connection open without buffering.
4. **Startup Logs**: Verifies that adapters correctly report the listening host and port through standardized hooks.
5. **Shutdown Signals**: Ensures `SIGTERM` and `SIGINT` listeners are cleaned up correctly after shutdown to prevent memory leaks.

If a harness bootstraps an app and setup or `listen()` fails before the assertion body runs, cleanup is still part of the contract: the partially bootstrapped app must be closed, and any `close()` failure is reported together with the original setup failure.

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

For example, `platform-conformance.ts` checks the public component-level contract that platform-facing packages can expose through `createPlatformConformanceHarness(...)`: validation must avoid long-lived side effects, start must be deterministic, stop must be idempotent, degraded/failed snapshots must remain safe, diagnostics must stay stable, and snapshots must be sanitized.

### Platform Conformance Surface

The platform conformance suite focuses on stable public assertions rather than hidden lifecycle choreography. It does not prove that every provider lifecycle hook fired at a particular network readiness moment, that active connections drained, or that a process exited after bootstrap failure. Those guarantees belong in the adapter or runtime package tests that own the behavior. The published harness gives adapter and tooling authors a reusable baseline for the public component contract: repeated start/stop calls must be predictable, diagnostics and snapshots must remain safe to inspect, and validation must not leave persistent state behind.

```typescript
import { createPlatformConformanceHarness } from '@fluojs/testing/platform-conformance';

const harness = createPlatformConformanceHarness({
  createComponent: () => myPlatformComponent,
  // ...
});

await harness.assertAll();
```

This lets someone writing a platform-facing component immediately validate their work against the public component contract. It also acts as expected-behavior documentation for adapter and tooling authors.

### Conformance Testing for Library Authors

If you develop a library that extends fluo, such as a custom validation pipe or logging interceptor, you should still provide tests that describe the contract you publish to users. `@fluojs/testing` currently publishes concrete harness subpaths for platform, HTTP adapter, web-runtime adapter, and fetch-style WebSocket contracts. A dedicated pipe/interceptor/library conformance harness is not part of the public surface yet, so custom library authors should model their own package tests after these patterns instead of relying on a nonexistent shared harness.

By following the explicit assertion style used in `@fluojs/testing/platform-conformance` and the other published harness subpaths, you can give users a standardized way to verify integrations. This improves ecosystem reliability and builds trust with users. Consistent tests lead to consistent behavior, which is the core goal of the fluo framework. When a new extension pattern needs a shared conformance area, start with package-owned tests and an RFC so the eventual public harness can be designed with clear scope.

## 14.6 Portability for Edge Runtimes

Edge Runtimes such as Cloudflare Workers and Vercel Edge Functions use the `Fetch API` instead of Node's legacy `http` module. This requires a different kind of portability testing, visible in `web-runtime-adapter-portability.ts`. These tests matter because Fetch-shaped request and response handling differs from Node's stream-first APIs.

These tests focus on the following:
- **Query decoding**: preserving repeated query parameters and malformed percent-encoding behavior.
- **Cookie normalization**: decoding valid cookie values while preserving malformed values exactly.
- **Raw body handling**: preserving JSON/text raw bodies and exact bytes for byte-sensitive payloads.
- **Multipart boundaries**: excluding `rawBody` for multipart requests while still exposing parsed fields and files.
- **SSE framing**: returning `text/event-stream` responses with stable event and data framing.

Verifying these surfaces gives teams evidence that HTTP request semantics stay portable across Fetch-style runtimes. The current web-runtime harness does not check global-scope availability, `crypto.subtle` performance, CPU limits, `waitUntil`, or cold-start budgets; those concerns need separate package-owned tests if an adapter documents them.

## 14.7 Testing the WebSocket Layer

WebSocket conformance is especially tricky because the protocol differs widely across implementations, such as standard `ws`, engine.io, and socket.io. Fluo's current `fetch-style-websocket-conformance.ts` is intentionally narrow: it checks that an adapter exposes a stable fetch-style realtime capability describing the raw WebSocket expansion contract.

Key verification items include:
- the adapter provides `getRealtimeCapability()`
- the capability has `kind: 'fetch-style'`
- the capability keeps the `raw-websocket-expansion` contract tag, `request-upgrade` mode, and version `1`
- the support level and reason match the adapter's documented WebSocket support

This assertion keeps adapter support claims honest while Fluo's raw WebSocket contract evolves. It does not open a socket, negotiate subprotocols, echo messages, inspect binary frames, assert graceful shutdown, test heartbeat behavior, or apply backpressure. If an adapter promises those behaviors today, the adapter package should cover them in its own tests.

## 14.8 Practical Exercise: Verifying Your Custom Adapter

If you implemented a custom adapter in Chapter 13, you should now verify it with the harness. This is the key test that checks whether your adapter complies with the fluo Behavioral Contract. Passing the portability harness gives you evidence that the adapter can be deployed to different runtimes without breaking existing business logic.

```typescript
import { FluoFactory } from '@fluojs/runtime';
import { createHttpAdapterPortabilityHarness } from '@fluojs/testing/http-adapter-portability';
import { myAdapter } from './my-adapter';

const harness = createHttpAdapterPortabilityHarness({
  name: 'MyCustomAdapter',
  bootstrap: async (module, opts) => {
    const app = await FluoFactory.create(module, { adapter: myAdapter(opts) });
    return app;
  },
  run: async (module, opts) => {
    const app = await FluoFactory.create(module, { adapter: myAdapter(opts) });
    await app.listen();
    return app;
  }
});

describe('MyCustomAdapter Portability', () => {
  it('preserves malformed cookies', () => harness.assertPreservesMalformedCookieValues());
  it('handles SSE', () => harness.assertSupportsSseStreaming());
  it('preserves JSON and text raw bodies', () => harness.assertPreservesRawBodyForJsonAndText());
  it('excludes multipart raw bodies', () => harness.assertExcludesRawBodyForMultipart());
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
