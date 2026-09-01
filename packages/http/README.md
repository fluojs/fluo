# @fluojs/http

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

The HTTP execution layer that turns route metadata into a request pipeline with binding, validation, guards, interceptors, and response writing.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Response Cookies](#response-cookies)
- [Early Hints](#early-hints)
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

### Portable header helpers

Use `getRequestHeader(request, name)` when middleware, versioning, DTO binding, or controller code
needs a case-insensitive lookup without flattening adapter-provided `string | string[] | undefined`
header values.

Use `appendVaryHeader(response, ...fields)` when response negotiation or caching logic needs to add
`Vary` fields without duplicating case variants, re-parsing comma lists by hand, or accidentally
expanding an existing wildcard `Vary: *` contract.

Use `getResponseHeader(response, name)` and `hasResponseHeader(response, name)` for the same
case-insensitive lookup over adapter-provided response headers. They preserve the original
`string | string[]` shape and do not write headers, body, status, or commit state.

Use `buildContentDisposition(disposition, filename)` to create an `attachment` or `inline`
Content-Disposition field value. It emits an escaped printable-ASCII `filename` fallback and a
deterministic RFC 8187 UTF-8 `filename*` value. Carriage return and line feed filenames reject
before a header value is returned.

```ts
import {
  appendVaryHeader,
  buildContentDisposition,
  getRequestHeader,
  getResponseHeader,
  hasResponseHeader,
  type RequestContext,
} from '@fluojs/http';

export function readLanguage(context: RequestContext): string | undefined {
  const acceptLanguage = getRequestHeader(context.request, 'accept-language');
  return Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage;
}

export function markLanguageVariance(context: RequestContext): void {
  appendVaryHeader(context.response, 'Accept-Language', 'Origin');
  context.response.setHeader(
    'Content-Disposition',
    buildContentDisposition('attachment', 'résumé.pdf'),
  );
}

export function readResponseEtag(
  context: RequestContext,
): string | string[] | undefined {
  return getResponseHeader(context.response, 'etag');
}

export function shouldSetResponseEtag(context: RequestContext): boolean {
  return !hasResponseHeader(context.response, 'etag');
}
```

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

### Request observers

`onRequestSuccess` runs only after the matched handler and all module-level and application-level middleware have settled, including work after `await next()`. If middleware throws after `next()` returns, observers receive `onRequestError` without a preceding success notification. `onRequestFinish` still runs after either outcome.

### Access logging

`createAccessLogObserver(...)` turns the request-observer lifecycle into application-owned structured records. It emits a start record, an error record for each dispatch error, and exactly one terminal finish record with a monotonic duration, request ID, method, path, matched route, status, and outcome (`success`, `handled_error`, `unhandled_error`, `not_found`, or `aborted`). Native route dispatch falls back to this complete lifecycle when observers are configured.

The sink is deliberately consumer-owned: route `AccessLogEvent` values to the structured logger, telemetry pipeline, or retention policy that owns your operational data. No headers are emitted unless they are allowlisted. `authorization`, `cookie`, `set-cookie`, `proxy-authorization`, and `x-api-key` remain redacted even when allowlisted; add organization-specific names with `redact`.

```ts
import { createAccessLogObserver } from '@fluojs/http';

const accessLogObserver = createAccessLogObserver({
  clientIdentity: {
    trustProxy: ['10.0.0.0/8'],
  },
  headers: {
    allow: ['user-agent', 'set-cookie'],
    redact: ['x-tenant-token'],
  },
  sink: {
    emit(event) {
      structuredLog.write(event);
    },
  },
});
```

Omit `clientIdentity` unless you have an explicit `trustProxy` boundary. When supplied, it resolves the trusted client address through `resolveHttpConnection(...)`; it never trusts forwarded identity by default.

### Async request context

```ts
import { getCurrentRequestContext } from '@fluojs/http';

function someDeepHelper() {
  const ctx = getCurrentRequestContext();
  console.log(ctx?.requestId);
}
```

`runWithRequestContext(...)` preserves the active context across awaited work when the host provides `AsyncLocalStorage` through `globalThis.AsyncLocalStorage` or the `node:async_hooks` module. The root `@fluojs/http` export selects a runtime-specific entrypoint without probing or instantiating async-context storage: Node and Bun register the host constructor during module initialization, while Deno, worker, browser, and default entries remain free of Node built-in imports. The request-local store itself is still created lazily on first use. Promise-returning non-async callbacks keep synchronous invocation, return, and throw behavior, and their continuations retain the bound context until the returned promise settles. The helpers never replace `Promise.prototype.then`, so unrelated promise continuations cannot capture a request. Hosts without an async-context primitive use a synchronous-only fallback that clears the context before awaited work resumes.

## Response Cookies

Use the portable `setCookie()` and `clearCookie()` helpers instead of adapter-native response APIs. Every call writes one independent `Set-Cookie` field, so repeated calls preserve their order and are never comma-folded.

```ts
import { clearCookie, setCookie } from '@fluojs/http';

setCookie(context.response, 'session', sessionToken, {
  httpOnly: true,
  maxAgeSeconds: 60 * 60,
  path: '/',
  sameSite: 'lax',
  secure: true,
});

clearCookie(context.response, 'session', {
  path: '/',
});
```

`maxAgeSeconds` is a non-negative whole-second lifetime on every adapter. Values are percent-encoded, names and attributes are validated before the response changes, and `sameSite: 'none'` requires `secure: true`. To delete the same browser cookie, repeat its original `path` and `domain`; `httpOnly`, `secure`, and `sameSite` are policy attributes rather than browser matching keys.

## Early Hints

`FrameworkResponse.earlyHints` is an optional, request-scoped capability for HTTP `103` informational responses. Check for property presence before use; property absence means the active adapter cannot emit Early Hints. There is no required `FrameworkResponse.writeEarlyHints()` method and unsupported adapters never silently ignore a write.

```ts
import type { RequestContext } from '@fluojs/http';

async function render(_input: undefined, context: RequestContext) {
  const earlyHints = context.response.earlyHints;

  if (earlyHints) {
    await earlyHints.write({
      link: [
        '</styles.css>; rel=preload; as=style',
        '</app.js>; rel=modulepreload',
      ],
      'x-trace-id': 'render-1',
    });
  }

  context.response.setHeader('link', '</final.css>; rel=stylesheet');
  return { ok: true };
}
```

Each `write(...)` emits one `103`, so callers may await multiple writes before the final response. Every write requires at least one non-empty `link` value and may include additional informational fields with valid HTTP names and values. Header names are case-insensitive and cannot be repeated with different casing. Status-forbidden framing fields (`content-length` and `transfer-encoding`) are rejected before the native write. Early fields do not populate `response.headers`, change status, set `committed`, or become final-response headers.

Node.js, Express, and Fastify expose this capability. Fetch-style Web, Bun, Deno, and Cloudflare Workers responses omit it because their `Response` APIs cannot represent an informational response before the final response. A write after final commitment or a native validation/write failure rejects with `EarlyHintsWriteError` (`EARLY_HINTS_WRITE_FAILED`); a disconnect before settlement rejects with `RequestAbortedError` (`REQUEST_ABORTED`).

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

`createRateLimitMiddleware(...)` resolves client identity from the adapter-snapshotted direct transport address by default. To trust `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`, configure `trustProxy` with an explicit hop count, address/CIDR list, or predicate. Forwarded data is ignored unless the direct peer satisfies that policy; malformed `Forwarded` data fails closed to the direct transport identity.

```ts
import { resolveHttpConnection } from '@fluojs/http';

const connection = resolveHttpConnection(context.request, {
  trustProxy: ['10.0.0.0/8', '2001:db8:feed::/48'],
});
```

`connection` is immutable and exposes the selected `clientAddress`, direct `remoteAddress`, trusted `proxyChain`, `protocol`, `secure`, `host`, `hostname`, and `port`. Fetch-only adapters may leave the direct address undefined because the Web `Request` contract does not expose it. A fetch-style HTTPS `Request` without an adapter-provided `connection` snapshot or explicit headers has no peer, host, or port, and `resolveHttpConnection(...)` does not infer HTTPS, `secure`, host, or port from its URL. The legacy `trustProxyHeaders: true` setting is broad compatibility only and is not recommended for new deployments; use `trustProxy` to describe the deployment boundary precisely. Only use either setting when you control the proxy that rewrites those headers. If an adapter provides neither a trusted proxy chain nor a raw socket identity, provide an explicit `keyResolver`.

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

`@Sse(path)` registers a `GET` route and declares `text/event-stream` produced media type metadata. Handlers may either return `SseResponse` for manual stream control or return `AsyncIterable<SseMessage<T> | T>` for managed streaming. A manual `SseResponse` keeps its dispatch, request observers, and request-scoped resources active until explicit close, request abort, or raw stream close; those lifecycle stages then release exactly once. Managed async iterables are converted with the same `encodeSseMessage(...)` behavior as `SseResponse`: plain yielded values become `data:` frames, while yielded objects with a `data` field may also provide `event`, `id`, and `retry`. The dispatcher stops consuming the source when `RequestContext.request.signal` aborts or the response stream closes, calls `FrameworkResponseStream.waitForDrain()` when a write reports backpressure, and closes the stream on completion or source errors. The same cancellation boundary bounds an in-flight `waitForDrain()`: request abort or stream close wins over an unsettled drain promise, after which the dispatcher closes the source iterator exactly once and continues request-scope disposal. Stream write failures and rejected drain promises still propagate their original errors. On cancellation, the dispatcher closes the response stream promptly and awaits the source iterator's `return()` cleanup before disposing request-scoped resources. Cleanup failures are reported through the request observer and dispatcher logger seams without replacing the already-committed SSE response. Thrown source errors follow the same committed-response error/observer boundary. Observable values remain out of scope and no RxJS dependency is required.

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

### Multipart DTO fields

Use `@FromFiles(fieldname?)` with `@RequestDto(...)` when multipart files are part of a handler's input contract:

```ts
import {
  Controller,
  FromFiles,
  Optional,
  Post,
  RequestDto,
  type FrameworkRequestFile,
} from '@fluojs/http';

class UploadAssetsDto {
  @FromFiles('attachments')
  attachments: readonly FrameworkRequestFile[] = [];

  @FromFiles('cover')
  @Optional()
  cover?: readonly FrameworkRequestFile[];
}

@Controller('/uploads')
export class UploadController {
  @Post('/')
  @RequestDto(UploadAssetsDto)
  upload(input: UploadAssetsDto) {
    return input.attachments.map((file) => file.originalname);
  }
}
```

`@FromFiles(...)` is array-only: when `FrameworkRequest.files` exists, it returns a readonly array filtered by `fieldname` in adapter arrival order; a present collection without matches becomes `[]`. When the collection is absent, required fields produce the standard missing-field error and `@Optional()` leaves the field `undefined`. Converters and validation receive that same portable array. The DTO binder projects only the five `FrameworkRequestFile` fields, so adapter-native file properties cannot leak through the DTO boundary. Direct `RequestContext.request.files` access remains supported for controllers and pipeline stages that need the entire request collection.

Response content negotiation formatters must return `string` or `Uint8Array` from `ResponseFormatter.format(...)`. Node.js `Buffer` values remain assignable because `Buffer` implements `Uint8Array`, but formatter contracts should rely only on runtime-neutral byte behavior.

## Public API

- **Routing decorators**: `Controller`, `Get`, `Sse`, `Query`, `Route`, `Post`, `Put`, `Patch`, `Delete`, `All`, `Options`, `Head`
- **Binding decorators**: `FromBody`, `FromQuery`, `FromPath`, `FromHeader`, `FromCookie`, `FromFiles`, `RequestDto`, `Optional`, `Convert`
- **Execution decorators**: `UseGuards`, `UseInterceptors`, `HttpCode`, `Version`, `Header`, `Redirect`, `Produces`
- **Header helpers**: `getRequestHeader`, `getResponseHeader`, `hasResponseHeader`, `appendVaryHeader`, `buildContentDisposition`
- **Response cookie helpers**: `setCookie`, `clearCookie`, `CookieOptions`, `ClearCookieOptions`, `CookieSameSite`
- **Trusted connection API**: `resolveHttpConnection`, `HttpConnection`, `ResolveHttpConnectionOptions`, `TrustProxyPolicy`, `TrustProxyPredicate`, `FrameworkRequestConnection`
- **Conditional request types**: `EntityTagStrength`, `EntityTag`, `ResponseValidators`, `ConditionalRequestContext`, `ConditionalRequestResolution`, `ConditionalRequestResolver`, `ConditionalRequestOptions`
- **Request/response and context types**: `RequestContext`, `Principal`, `ContextKey`, `ControllerHandler`, `FrameworkRequest`, `FrameworkRequestFile`, `FrameworkResponse`, `EarlyHintsHeaders`, `FrameworkResponseEarlyHints`, `FrameworkResponseStream`, `FrameworkResponseCompression`, `FrameworkResponseCompressionWriteOptions`, `SseResponse`, `SseMessage`
- **Dispatcher, routing, and negotiation types**: `Dispatcher`, `CreateDispatcherOptions`, `ErrorHandler`, `DispatcherLogger`, `HandlerMapping`, `HandlerMetadata`, `HandlerDescriptor`, `HandlerMatch`, `HandlerSource`, `RouteDefinition`, `HttpMethod`, `VersioningType`, `VersioningOptions`, `VersioningExtractor`, `VersioningExtractorResult`, `ContentNegotiationOptions`, `ResponseFormatter`, `HttpErrorRepresentationContext`, `HtmlErrorRepresentationProvider`, `HttpErrorRepresentationOptions`, `FastPathEligibility`, `FastPathStats`
- **Pipeline contract types**: `Middleware`, `MiddlewareLike`, `MiddlewareContext`, `MiddlewareRouteConfig`, `Next`, `Guard`, `GuardLike`, `GuardContext`, `Interceptor`, `InterceptorLike`, `InterceptorContext`, `CallHandler`, `RequestObserver`, `RequestObserverLike`, `RequestObservationContext`, `ArgumentResolverContext`, `Binder`, `Converter`, `ConverterLike`, `ConverterTarget`, `ValidationIssue`, `Validator`
- **Adapter API**: `HttpApplicationAdapter`, `HttpAdapterRealtimeCapability`, `ServerBackedHttpAdapterRealtimeCapability`, `FetchStyleHttpAdapterRealtimeCapability`, `HttpAdapterRealtimeBindingInstallation`, `UnsupportedHttpAdapterRealtimeCapability`, `createNoopHttpApplicationAdapter`, `createServerBackedHttpAdapterRealtimeCapability`, `createUnsupportedHttpAdapterRealtimeCapability`, `createFetchStyleHttpAdapterRealtimeCapability`
- **Exceptions and errors**: `HttpExceptionDetail`, `HttpExceptionOptions`, `ErrorResponse`, `HttpException`, `BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`, `NotAcceptableException`, `TooManyRequestsException`, `InternalServerErrorException`, `PayloadTooLargeException`, `createErrorResponse`, `RouteConflictError`, `InvalidRoutePathError`, `InvalidHttpMethodError`, `HandlerNotFoundError`, `RequestAbortedError`, `EarlyHintsWriteError`
- **Helpers**: `createHandlerMapping`, `createDispatcher`, `forRoutes`, `normalizeRoutePattern`, `matchRoutePattern`, `isMiddlewareRouteConfig`, `createCorrelationMiddleware`, `createCorsMiddleware`, `createRateLimitMiddleware`, `createMemoryRateLimitStore`, `createSecurityHeadersMiddleware`, `getRequestHeader`, `getResponseHeader`, `hasResponseHeader`, `appendVaryHeader`, `buildContentDisposition`, `runWithRequestContext`, `getCurrentRequestContext`, `assertRequestContext`, `createRequestContext`, `createContextKey`, `getContextValue`, `setContextValue`, `encodeSseComment`, `encodeSseMessage`, `isSseMessage`, `formatFastPathStats`, `getDispatcherFastPathStats`, `FAST_PATH_ELIGIBILITY_SYMBOL`, `FAST_PATH_STATS_SYMBOL`
- **Option and store types**: `CorsOptions`, `RateLimitOptions`, `RateLimitStore`, `RateLimitStoreEntry`, `SecurityHeadersOptions`, `SseSendOptions`

## Portable Subpath (`@fluojs/http/portable`)

Use `@fluojs/http/portable` from runtime-neutral integrations that need HTTP authoring contracts without eagerly initializing the Node `AsyncLocalStorage` bootstrap. It exports the supported HTTP decorators, exceptions, request/response contracts, and authoring helpers; Node applications should continue to import the root package when they need its Node request-context behavior.

## Internal Subpath (`@fluojs/http/internal`)

The `./internal` subpath exports only the low-level utilities used by platform adapters, the core runtime, and first-party response integrations. These are subject to change and should not be used in typical application code.

- `DefaultBinder`: Default DTO/request binder used by the runtime bootstrap path.
- `bindRawRequestNativeRouteHandoff(...)` / `attachFrameworkRequestNativeRouteHandoff(...)`: Internal adapter/runtime helpers for reusing semantically safe native route matches without widening the public dispatcher API.
- `consumeRawRequestNativeRouteHandoff(...)` / `readFrameworkRequestNativeRouteHandoff(...)`: Internal helpers for reading or consuming native route handoffs.
- Native route handoffs snapshot the framework request method and path when attached; if app middleware rewrites either value before handler matching, the dispatcher ignores the stale handoff and falls back to normal route matching.
- `isRoutePathNormalizationSensitive(path)`: Internal guard for keeping duplicate-slash and trailing-slash requests on the generic dispatcher path.
- `getCompiledRouteIdentity(descriptor)`: Reads the deterministic source/method position assigned by `createHandlerMapping(...)` for first-party package integrations. Manually authored descriptors return `undefined`.
- `resolveClientIdentity(request)`: Conservative client identity resolver used by rate limiting and other runtime integrations.
- `createFetchStyleHttpAdapterRealtimeCapability(...)`, `Dispatcher`, and `HttpApplicationAdapter`: internal adapter seams for edge/fetch-style platform packages that must avoid instantiating the full HTTP root barrel.
- `FRAMEWORK_RESPONSE_WRITER` / `registerFrameworkResponseWriter(...)`: Typed response-entry branding seam for first-party response integrations.
- `FRAMEWORK_RESPONSE_VALUE_FINALIZER` / `registerFrameworkResponseValueFinalizer(...)`: Typed request-local response finalization seam. Finalizers compose in registration order, each receives the prior resolved value, and the dispatcher awaits them so throws and rejections follow its normal error policy.

## Conditional Requests

Configure `conditionalRequest` during runtime bootstrap to resolve representation existence separately from optional validators:

```ts
const app = await bootstrapNodeApplication(AppModule, {
  conditionalRequest: {
    resolve({ handler, request }) {
      return {
        exists: true,
        validators: {
          etag: { opaqueValue: `${handler.route.method}:${request.path}:v1`, strength: 'strong' },
          lastModified: new Date('2026-01-01T00:00:00Z'),
        },
      };
    },
  },
});
```

Return `{ exists: false }` when no representation exists. Return `{ exists: true }` when it exists but intentionally has no validators. The dispatcher evaluates this resolver after application/module middleware and guards, so conditional `304` and `412` responses never bypass authorization or audit logic. It accepts only valid entity-tag lists and HTTP-date forms; malformed conditional fields are ignored.

The dispatcher owns RFC 9110 precedence and comparison: a successful `If-Match` skips only `If-Unmodified-Since`, then `If-None-Match` still takes precedence over `If-Modified-Since`; `If-Match` uses strong comparison and `If-None-Match` weak comparison. `304` and `412` are bodyless and retain `ETag`/`Last-Modified`, including redirect and supported custom response-writer paths. For the same selected representation, `HEAD` and `GET` use the same conditional result and framework-generated `HEAD` bodies are suppressed. An explicit `@Head` route remains an independent route; custom response writers own their body emission and must preserve the `HEAD` bodyless contract themselves. See the [HTTP Runtime Contract](../../docs/architecture/http-runtime.md).

## Related Packages

- `@fluojs/core`: stores controller, route, and DTO metadata
- `@fluojs/validation`: validates DTOs after HTTP binding
- `@fluojs/runtime`: assembles the dispatcher during application bootstrap
- `@fluojs/passport`: plugs auth guards into the same HTTP guard chain

## Example Sources

- `examples/realworld-api/src/users/create-user.dto.ts`
- `examples/auth-jwt-passport/src/auth/auth.controller.ts`
- `packages/http/src/dispatch/dispatcher.test.ts`
