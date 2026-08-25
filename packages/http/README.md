# @fluojs/http

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

The HTTP execution layer that turns route metadata into a request pipeline with binding, validation, guards, interceptors, and response writing.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Realtime Adapter Capabilities](#realtime-adapter-capabilities)
- [HTTP Error Representations](#http-error-representations)
- [Request Cleanup and Portability](#request-cleanup-and-portability)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/http
```

## When to Use

Use this package when you need to:

- define REST-style controllers with decorators such as `@Controller`, `@Get`, and `@Post`
- bind request data into DTOs with `@FromBody`, `@FromPath`, `@FromQuery`, and related decorators
- run guards, interceptors, and middleware in a predictable request lifecycle
- access the active request through `RequestContext` without passing it through every function

## Quick Start

```ts
import { Controller, FromBody, FromPath, Get, Post, RequestDto } from '@fluojs/http';
import { IsString, MinLength } from '@fluojs/validation';

class CreateUserDto {
  @FromBody()
  @IsString()
  @MinLength(3)
  name!: string;
}

class FindUserParamsDto {
  @FromPath('id')
  id!: string;
}

@Controller('/users')
export class UserController {
  @Post('/')
  @RequestDto(CreateUserDto)
  create(input: CreateUserDto) {
    return { id: '1', name: input.name };
  }

  @Get('/:id')
  @RequestDto(FindUserParamsDto)
  getById(input: FindUserParamsDto) {
    return { id: input.id, name: 'John Doe' };
  }
}
```

### Route path contract

HTTP route decorators such as `@Controller()`, `@Get()`, and `@Post()` accept only:

- literal path segments like `/users` or `/healthz`
- full-segment path params like `/:id` or `/users/:userId/posts/:postId`

Trailing slashes and duplicate slashes are normalized during route mapping, so `//users///:id/` resolves to `/users/:id`.

Route decorators do **not** support wildcard, regex-like, or mixed-segment syntax such as `*`, `?`, `/(.*)`, `user-:id`, or `:id.json`. Wildcard matching remains middleware-only via `forRoutes('/users/*')`.

Catch-all route grammar is intentionally deferred. The
[HTTP catch-all route grammar decision](../../docs/architecture/http-catch-all-route-grammar.md)
records the evaluated syntaxes, provisional precedence and params shape, OpenAPI limitations,
adapter native fast-path constraints, and the evidence required before this HTTP contract can be
revisited. No syntax described there is active route behavior.

### Custom HTTP method contract

Use `@Query(path)` for RFC `QUERY`, or `@Route(method, path)` for another HTTP extension method such as `PURGE` or WebDAV `PROPFIND`:

```ts
import { Controller, Query, Route } from '@fluojs/http';

@Controller('/operations')
export class OperationsController {
  @Query('/search')
  search() {
    return { method: 'QUERY' };
  }

  @Route('purge', '/cache')
  purgeCache() {
    return { method: 'PURGE' };
  }
}
```

`@Route(...)` accepts a non-empty HTTP token, canonicalizes it to uppercase before metadata registration, and rejects whitespace, separators, control characters, and non-ASCII token characters with `InvalidHttpMethodError`. `ALL` is reserved for the framework-owned `@All(...)` wildcard and is rejected by `@Route(...)`. Method-specific routes, including custom methods, take precedence over `@All(...)`, participate in duplicate detection and route versioning, and use the ordinary DTO binding, validation, guard, interceptor, and response pipeline. Unless status metadata says otherwise, successful `QUERY` and extension-method handlers default to `200`.

Adapter wire support is an explicit portability contract. Supported Node listeners, Fastify and Express wildcard fallbacks, and Bun, Deno, and Cloudflare Workers fetch dispatch execute `QUERY` and representative extension methods without converting them into ordinary methods. Custom methods stay off Bun native `routes` acceleration, while Fastify registers their method names only so its wildcard fallback can receive them; neither path creates a native fluo route handoff. `CONNECT` remains outside ordinary controller-route conformance.

Custom runtime methods do not become OpenAPI Path Item operations automatically. `@fluojs/openapi` continues to accept only its documented standard operation methods, so exclude custom-method descriptors from OpenAPI input or document those endpoints through an application-owned extension.

## Common Patterns

### Guards and interceptors

```ts
import { Controller, Get, UseGuards, UseInterceptors } from '@fluojs/http';

@Controller('/admin')
@UseGuards(AdminGuard)
@UseInterceptors(LoggingInterceptor)
class AdminController {
  @Get('/')
  dashboard() {
    return { data: 'secret' };
  }
}
```

### Async request context

```ts
import { getCurrentRequestContext } from '@fluojs/http';

function someDeepHelper() {
  const ctx = getCurrentRequestContext();
  console.log(ctx?.requestId);
}
```

`runWithRequestContext(...)` preserves the active context across awaited work when the host provides `AsyncLocalStorage` through `globalThis.AsyncLocalStorage` or the `node:async_hooks` module. The root `@fluojs/http` export selects a runtime-specific entrypoint without probing or instantiating async-context storage: Node and Bun register the host constructor during module initialization, while Deno, worker, browser, and default entries remain free of Node built-in imports. The request-local store itself is still created lazily on first use. Promise-returning non-async callbacks keep synchronous invocation, return, and throw behavior, and their continuations retain the bound context until the returned promise settles. The helpers never replace `Promise.prototype.then`, so unrelated promise continuations cannot capture a request. Hosts without an async-context primitive use a synchronous-only fallback that clears the context before awaited work resumes.

## Realtime Adapter Capabilities

`HttpApplicationAdapter.getRealtimeCapability()` reports whether a platform is server-backed, fetch-style, or unsupported for realtime protocol integration. The fetch-style capability remains version 1. Hosts may additionally expose its optional, independently versioned `bindingInstallation` extension so first-party realtime packages can install their binding before adapter `listen()` starts without changing the stable capability discriminator.

`createFetchStyleHttpAdapterRealtimeCapability(reason, options)` always returns the source-compatible version 1 capability. When an installer is supplied, the returned value also includes `bindingInstallation`; that installer accepts a protocol-owned binding or `undefined` for pre-listen cleanup. The platform adapter remains responsible for parsing that boundary into its host-specific binding type. Once a managed adapter is live, its `close()` boundary owns final binding cleanup. Application code should normally register `@fluojs/websockets` or `@fluojs/socket.io` modules rather than call this low-level adapter capability directly.

## HTTP Error Representations

Canonical JSON remains the default error response. Register an optional application-owned HTML
provider at runtime bootstrap when browser requests should receive complete error or not-found
documents without changing API clients:

```ts
import type { HttpErrorRepresentationOptions } from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const errorRepresentation = {
  html: {
    canRender({ request }) {
      return request.method === 'GET' || request.method === 'HEAD';
    },
    render({ json }) {
      return `<!doctype html><main>${json.error.status}: ${escapeHtml(json.error.message)}</main>`;
    },
  },
} satisfies HttpErrorRepresentationOptions;

const app = await bootstrapApplication({
  errorRepresentation,
  rootModule: AppModule,
});
```

HTTP classifies the outcome before representation selection. Route misses become the existing 404
outcome, and uncommitted `HttpException` values from middleware, DTO binding/validation, guards,
interceptors, and handlers use the same seam. The provider receives the classified exception,
canonical `ErrorResponse`, request, optional matched handler, request id, and active request-scope
container. It receives no `FrameworkResponse`, so status, headers, `HEAD`, abort, and commit ownership
remain in the dispatcher.

The provider return value is trusted application HTML. fluo does not escape or sanitize it. Escape
every request-derived or error-derived value before interpolation, as the example does for
`json.error.message`, or render through a framework whose text-node contract performs that escaping.

`Accept` negotiation is deterministic: absent `Accept` and wildcard/tie cases select JSON; quality
and specificity select between `application/json` and available `text/html`; unsupported ranges
produce canonical JSON 406. `canRender(...)` may constrain HTML per application or matched handler.
A provider failure falls back once to the original canonical JSON outcome, and committed or aborted
requests are never rewritten. Response writer `send(...)` or stream/write failures propagate
unchanged and do not trigger a second canonical JSON write. Existing native `Vary` values are
preserved when HTTP adds `Accept`. Successful-route `@Produces(...)` metadata does not control error
representations. See the
[HTTP error representation decision](../../docs/architecture/http-error-representations.md) for the
complete phase and fallback contract.

### Rate limiting behind proxies

`createRateLimitMiddleware(...)` resolves client identity from the raw socket `remoteAddress` by default. To trust `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`, opt in with `trustProxyHeaders: true` only when your adapter sits behind a trusted proxy that overwrites those headers. If your adapter exposes neither a trusted proxy chain nor a raw socket identity, provide an explicit `keyResolver`.

### Server-sent events

```ts
import { Controller, Sse, type SseMessage } from '@fluojs/http';

@Controller('/orders')
export class OrdersEventsController {
  @Sse('/events')
  async *stream(): AsyncIterable<SseMessage<{ status: string }> | { heartbeat: true }> {
    yield { data: { status: 'connected' }, event: 'ready', id: 'orders-ready' };

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      yield { heartbeat: true };
    }
  }
}
```

`@Sse(path)` registers a `GET` route and declares `text/event-stream` produced media type metadata. Handlers may either return `SseResponse` for manual stream control or return `AsyncIterable<SseMessage<T> | T>` for managed streaming. Managed async iterables are converted with the same `encodeSseMessage(...)` behavior as `SseResponse`: plain yielded values become `data:` frames, while yielded objects with a `data` field may also provide `event`, `id`, and `retry`. The dispatcher stops consuming the source when `RequestContext.request.signal` aborts or the response stream closes, calls `FrameworkResponseStream.waitForDrain()` when a write reports backpressure, and closes the stream on completion or source errors. The same cancellation boundary bounds an in-flight `waitForDrain()`: request abort or stream close wins over an unsettled drain promise, after which the dispatcher closes the source iterator exactly once and continues request-scope disposal. Stream write failures and rejected drain promises still propagate their original errors. On cancellation, the dispatcher closes the response stream promptly and awaits the source iterator's `return()` cleanup before disposing request-scoped resources. Cleanup failures are reported through the request observer and dispatcher logger seams without replacing the already-committed SSE response. Thrown source errors follow the same committed-response error/observer boundary. Observable values remain out of scope and no RxJS dependency is required.

Managed SSE requires an adapter that exposes `FrameworkResponse.stream`. When the active adapter does not provide a response stream, the dispatcher rejects the managed async iterable before marking the response handled and surfaces the failure through the standard dispatch error path (request error observers and the configured error response writer) instead of silently reporting the stream as handled.

On the browser side, create the `EventSource` inside the React effect that owns it and always close it from the cleanup function so route changes, Strict Mode remounts, and component unmounts do not leave duplicate streams open:

```tsx
import { useEffect, useState } from 'react';

export function OrderEvents({ orderId }: { orderId: string }) {
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    const source = new EventSource(`/orders/events?orderId=${encodeURIComponent(orderId)}`, {
      withCredentials: true,
    });

    source.addEventListener('ready', (event) => {
      setEvents((current) => [...current, event.data]);
    });

    source.onerror = () => {
      // Browsers reconnect automatically unless the server closes with a terminal status.
      console.warn('Order event stream disconnected; waiting for browser retry.');
    };

    return () => {
      source.close();
    };
  }, [orderId]);

  return <output>{events.join('\n')}</output>;
}
```

Browser `EventSource` does not let callers attach arbitrary `Authorization` headers. Authenticate SSE endpoints with same-origin cookies, `withCredentials` plus explicit CORS credentials policy, or a short-lived signed URL/query token that your guard validates. Do not document a bearer-header browser example unless you are using a custom fetch-based SSE client instead of the built-in `EventSource` API.

Operationally, keep SSE connections unbuffered and long-lived: allow credentials in CORS only for trusted origins, disable proxy buffering and response transforms (`SseResponse` sets `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`), avoid compression middleware that buffers `text/event-stream`, set load balancer or platform idle timeouts above your heartbeat interval, send comment heartbeats such as `sse.comment('heartbeat')`, and persist enough event history to honor `Last-Event-ID` when clients reconnect and need replay.

### Versioning

`createHandlerMapping(...)` supports URI, header, media-type, and custom versioning strategies through `VersioningType` and the `versioning` option. Route registration keeps exact/static matches ahead of fallbacks while preserving registration order for equivalent normalized routes.

### Request context helpers

Use `runWithRequestContext(...)`, `assertRequestContext()`, `createRequestContext(...)`, `createContextKey(...)`, `getContextValue(...)`, and `setContextValue(...)` when framework integrations need explicit request context boundaries or typed per-request storage.

### Fast-path observability

The dispatcher exposes fast-path observability for adapters and diagnostics through `FAST_PATH_ELIGIBILITY_SYMBOL`, `FAST_PATH_STATS_SYMBOL`, `formatFastPathStats(...)`, and `getDispatcherFastPathStats(...)`. Eligibility decisions belong to the dispatcher instance rather than the shared `HandlerMapping`: dispatchers may reuse one mapping with different middleware, observer, interceptor, binder, or adapter options without overwriting one another. `describeRoutes()` exposes frozen eligibility snapshots on its cloned descriptors, and dispatcher statistics plus their route entries are frozen observability values.

### Bun decorator bundling compatibility

Fluo's HTTP decorators are standard TC39 decorators and continue to record metadata through `context.metadata` when the runtime or compiler provides the standard decorator context. When Bun bundles an application through its legacy TypeScript decorator transform, the same controller, route, DTO binding, guard/interceptor, header, redirect, versioning, status, request DTO, and `@Produces(...)` metadata is recorded through Fluo's internal metadata stores so generated Bun bundles preserve route mapping behavior.

This compatibility path is an execution fallback for Bun bundle output; application source should still use Fluo's standard decorators and should not enable `emitDecoratorMetadata` or rely on `reflect-metadata`.

## Request Cleanup and Portability

The dispatcher binds `RequestContext` with host async-context storage for the active dispatch only. On hosts with `AsyncLocalStorage`, including supported Node 20+ runtimes, the context remains available across awaited work. On non-Node hosts without an async-context primitive, the fallback context is synchronous-only and intentionally unavailable after `await` so overlapping requests cannot observe one another's context. When a request may use request-scoped DI through its controller graph, middleware, guards, interceptors, observers, DTO converters, a custom binder, or manual `getCurrentRequestContext()` / `assertRequestContext()` container access, the dispatcher creates and disposes an isolated request-scoped DI container from its `finally` path after request observers finish. Routes whose graphs do not require request scope skip that container lifecycle until `RequestContext.container` is accessed, so the baseline path avoids unnecessary per-request allocation while preserving request-scoped provider isolation whenever the graph is ambiguous or request-scoped. The fast path caches handler metadata only and resolves the controller through the active container for every dispatch: singleton providers remain shared by the container, while transient controllers and dependencies retain fresh-per-resolution identity. Public `RequestContext.container` reads are therefore always safe for resolving request-scoped providers; the request-scope-free fast path is an internal dispatcher optimization, not a promise that the public context exposes the root container.

Adapters should pass an `AbortSignal` on `FrameworkRequest.signal` when the platform exposes one, or an `isAborted()` probe when allocating a signal is not practical. The dispatcher preserves both abort surfaces on its per-dispatch request clone and treats the request as aborted when either surface reports cancellation, so a `false` probe never masks an aborted signal. It checks both surfaces before and after handler work so adapters without `AbortSignal` can still stop abandoned requests. For SSE, adapters should also expose `FrameworkResponse.stream.onClose(...)` when possible; `SseResponse` listens to both request abort and raw stream close, closes idempotently, and removes registered listeners when either side terminates first.

Adapters that parse multipart uploads should attach runtime-neutral `FrameworkRequestFile` values to `FrameworkRequest.files` rather than augmenting the shared HTTP contract with adapter-specific file types. The seam intentionally models the portable fields every HTTP adapter can provide (`fieldname`, `originalname`, `mimetype`, `buffer`, and `size`); platform packages may keep richer native file objects on their raw request surfaces, but guards, binders, middleware, interceptors, and controllers should read files through `RequestContext.request.files` when they need cross-runtime behavior.

Response content negotiation formatters must return `string` or `Uint8Array` from `ResponseFormatter.format(...)`. Node.js `Buffer` values remain assignable because `Buffer` implements `Uint8Array`, but formatter contracts should rely only on runtime-neutral byte behavior.

## Public API

- **Routing decorators**: `Controller`, `Get`, `Sse`, `Query`, `Route`, `Post`, `Put`, `Patch`, `Delete`, `All`, `Options`, `Head`
- **Binding decorators**: `FromBody`, `FromQuery`, `FromPath`, `FromHeader`, `FromCookie`, `RequestDto`, `Optional`, `Convert`
- **Execution decorators**: `UseGuards`, `UseInterceptors`, `HttpCode`, `Version`, `Header`, `Redirect`, `Produces`
- **Request/response and context types**: `RequestContext`, `Principal`, `ContextKey`, `ControllerHandler`, `FrameworkRequest`, `FrameworkRequestFile`, `FrameworkResponse`, `FrameworkResponseStream`, `FrameworkResponseCompression`, `FrameworkResponseCompressionWriteOptions`, `SseResponse`, `SseMessage`
- **Dispatcher, routing, and negotiation types**: `Dispatcher`, `CreateDispatcherOptions`, `ErrorHandler`, `DispatcherLogger`, `HandlerMapping`, `HandlerMetadata`, `HandlerDescriptor`, `HandlerMatch`, `HandlerSource`, `RouteDefinition`, `HttpMethod`, `VersioningType`, `VersioningOptions`, `VersioningExtractor`, `VersioningExtractorResult`, `ContentNegotiationOptions`, `ResponseFormatter`, `HttpErrorRepresentationContext`, `HtmlErrorRepresentationProvider`, `HttpErrorRepresentationOptions`, `FastPathEligibility`, `FastPathStats`
- **Pipeline contract types**: `Middleware`, `MiddlewareLike`, `MiddlewareContext`, `MiddlewareRouteConfig`, `Next`, `Guard`, `GuardLike`, `GuardContext`, `Interceptor`, `InterceptorLike`, `InterceptorContext`, `CallHandler`, `RequestObserver`, `RequestObserverLike`, `RequestObservationContext`, `ArgumentResolverContext`, `Binder`, `Converter`, `ConverterLike`, `ConverterTarget`, `ValidationIssue`, `Validator`
- **Adapter API**: `HttpApplicationAdapter`, `HttpAdapterRealtimeCapability`, `ServerBackedHttpAdapterRealtimeCapability`, `FetchStyleHttpAdapterRealtimeCapability`, `HttpAdapterRealtimeBindingInstallation`, `UnsupportedHttpAdapterRealtimeCapability`, `createNoopHttpApplicationAdapter`, `createServerBackedHttpAdapterRealtimeCapability`, `createUnsupportedHttpAdapterRealtimeCapability`, `createFetchStyleHttpAdapterRealtimeCapability`
- **Exceptions and errors**: `HttpExceptionDetail`, `HttpExceptionOptions`, `ErrorResponse`, `HttpException`, `BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`, `NotAcceptableException`, `TooManyRequestsException`, `InternalServerErrorException`, `PayloadTooLargeException`, `createErrorResponse`, `RouteConflictError`, `InvalidRoutePathError`, `InvalidHttpMethodError`, `HandlerNotFoundError`, `RequestAbortedError`
- **Helpers**: `createHandlerMapping`, `createDispatcher`, `forRoutes`, `normalizeRoutePattern`, `matchRoutePattern`, `isMiddlewareRouteConfig`, `createCorrelationMiddleware`, `createCorsMiddleware`, `createRateLimitMiddleware`, `createMemoryRateLimitStore`, `createSecurityHeadersMiddleware`, `runWithRequestContext`, `getCurrentRequestContext`, `assertRequestContext`, `createRequestContext`, `createContextKey`, `getContextValue`, `setContextValue`, `encodeSseComment`, `encodeSseMessage`, `isSseMessage`, `formatFastPathStats`, `getDispatcherFastPathStats`, `FAST_PATH_ELIGIBILITY_SYMBOL`, `FAST_PATH_STATS_SYMBOL`
- **Option and store types**: `CorsOptions`, `RateLimitOptions`, `RateLimitStore`, `RateLimitStoreEntry`, `SecurityHeadersOptions`, `SseSendOptions`

## Internal Subpath (`@fluojs/http/internal`)

The `./internal` subpath exports only the low-level utilities used by platform adapters and the core runtime. These are subject to change and should not be used in typical application code.

- `DefaultBinder`: Default DTO/request binder used by the runtime bootstrap path.
- `bindRawRequestNativeRouteHandoff(...)` / `attachFrameworkRequestNativeRouteHandoff(...)`: Internal adapter/runtime helpers for reusing semantically safe native route matches without widening the public dispatcher API.
- `consumeRawRequestNativeRouteHandoff(...)` / `readFrameworkRequestNativeRouteHandoff(...)`: Internal helpers for reading or consuming native route handoffs.
- Native route handoffs snapshot the framework request method and path when attached; if app middleware rewrites either value before handler matching, the dispatcher ignores the stale handoff and falls back to normal route matching.
- `isRoutePathNormalizationSensitive(path)`: Internal guard for keeping duplicate-slash and trailing-slash requests on the generic dispatcher path.
- `getCompiledRouteIdentity(descriptor)`: Reads the deterministic source/method position assigned by `createHandlerMapping(...)` for first-party package integrations. Manually authored descriptors return `undefined`.
- `resolveClientIdentity(request)`: Conservative client identity resolver used by rate limiting and other runtime integrations.
- `createFetchStyleHttpAdapterRealtimeCapability(...)`, `Dispatcher`, and `HttpApplicationAdapter`: internal adapter seams for edge/fetch-style platform packages that must avoid instantiating the full HTTP root barrel.

## Related Packages

- `@fluojs/core`: stores controller, route, and DTO metadata
- `@fluojs/validation`: validates DTOs after HTTP binding
- `@fluojs/runtime`: assembles the dispatcher during application bootstrap
- `@fluojs/passport`: plugs auth guards into the same HTTP guard chain

## Example Sources

- `examples/realworld-api/src/users/create-user.dto.ts`
- `examples/auth-jwt-passport/src/auth/auth.controller.ts`
- `packages/http/src/dispatch/dispatcher.test.ts`
