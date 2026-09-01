# HTTP Runtime Contract

<p><strong><kbd>English</kbd></strong> <a href="./http-runtime.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current request execution contract implemented by `@fluojs/http` and assembled by `@fluojs/runtime`.

## Byte Range Contract

After conditional-request evaluation permits handler execution, the response policy applies one `Range: bytes=` member only to `GET` representations and the documented `HEAD` metadata mirror. Valid bounded, suffix, and open-ended members produce `206`; malformed and multi-range fields retain the full response; unsatisfiable members produce bodyless `416` with `Accept-Ranges: bytes`, `Content-Range: bytes */size`, and `Content-Length: 0`. `POST`, unsafe, and custom methods ignore `Range` and retain their ordinary full status, body, and metadata. `If-Range` reuses the selected representation validators and never re-runs conditional resolution. `HEAD` uses the same range status and headers as GET without consuming a portable stream. Partial Node responses are identity encoded so `Content-Range` and `Content-Length` describe the transmitted representation bytes.

`createByteRangeResponse(...)` accepts application-owned bytes or a stream factory with an exact representation size. It never opens, stats, seeks, sizes, or owns filesystem resources: the application supplies the exact size and source. Multi-range response construction is intentionally unsupported.

## Request Lifecycle

1. The adapter supplies a normalized `FrameworkRequest` and `FrameworkResponse` to `Dispatcher.dispatch(...)`, including `signal` or `isAborted()` when the host exposes request cancellation.
2. The dispatcher clones request params and abort metadata, then builds a `RequestContext` with request metadata and an optional `x-request-id`. It starts on the root container and promotes to an isolated request-scoped container only when the matched graph, active middleware, observers, DTO conversion, binder, guard, interceptor, controller dependency graph, or manual `RequestContext.container.resolve(...)` access may need request scope.
3. Registered request observers receive `onRequestStart` before route matching.
4. Global application middleware runs first through `runMiddlewareChain(...)`.
5. `matchHandlerOrThrow(...)` resolves one handler from the `HandlerMapping` or throws `HandlerNotFoundError`.
6. Matched route params are copied into `requestContext.request.params`, then observers may receive `onHandlerMatched`.
7. Module-level middleware attached to the matched handler runs after global middleware and before guard execution.
8. `runGuardChain(...)` resolves guards from the request container and throws `ForbiddenException` when any guard returns `false`.
9. When configured, `conditionalRequest.resolve(...)` runs after application/module middleware and guards, but before interceptors and controller invocation. A `304` or `412` therefore never bypasses authorization or middleware-owned audit work.
10. The interceptor chain is composed from global interceptors followed by route interceptors.
11. `invokeControllerHandler(...)` resolves the controller from the request container, binds the declared DTO through the binder, and validates DTO input through `HttpDtoValidationAdapter` when the route declares `request` metadata.
12. The controller method receives `(input, requestContext)` and returns the handler result.
13. Successful non-SSE results are written through `writeSuccessResponse(...)`, which applies redirect metadata, route headers, formatter selection, validators, and default success status rules. The dispatcher checks `signal` and `isAborted()` before and after handler execution, treating either cancellation surface as authoritative so a `false` probe cannot mask an aborted signal and aborted requests do not commit late success responses.
14. A handler that returns a manual `SseResponse` keeps its dispatch open until explicit close, request abort, or raw stream close. After explicit close or raw stream close, middleware settle, request observers receive success and then finish, and request-scoped resources dispose. After request abort, the dispatcher rechecks cancellation after completion, skips success, and emits finish before disposal.
15. After module-level and application-level middleware have fully settled, including their work after `await next()`, the dispatcher emits `onRequestSuccess` with the handler result.
16. If any stage throws, including middleware work after `next()` returns, the dispatcher emits `onRequestError` without a preceding success notification, then runs `onError` when configured. Otherwise `writeErrorResponse(...)` classifies the failure and either writes canonical JSON or, for eligible `HttpException` and route-miss outcomes, performs the configured HTTP-owned error representation negotiation.
17. The dispatcher always emits `onRequestFinish`. When a request scope was created or lazily promoted, it disposes that isolated request-scoped container before the request ends; requests whose graphs do not require request scope never dispose the root container. The fast path caches handler metadata only and resolves the controller through the active container for each dispatch, so container-owned singleton sharing and transient fresh-per-resolution identity remain intact.

## Error Representation Boundary

- Canonical JSON remains the default error response and the only representation when no HTML provider is registered.
- Applications register optional HTML through `errorRepresentation.html` on `createDispatcher(...)` or runtime bootstrap. The provider receives the classified exception, canonical JSON, request, optional matched handler, request id, and active request-scope container, but no response mutation authority.
- `HandlerNotFoundError` is converted to the existing HTTP 404 outcome before `Accept` negotiation. Uncommitted `HttpException` failures from middleware, DTO binding/validation, guards, interceptors, and handlers use the same selection without merging those diagnostic phases.
- Unknown failures, React shell failures, post-shell recoverable errors, request aborts, and browser errors retain their separate owners and do not enter the HTML provider path.
- HTTP owns deterministic JSON/HTML quality and specificity selection, JSON tie-breaking, JSON 406 responses, `Vary: Accept`, status/content type, `HEAD` body suppression, abort checks, and already-committed response protection.
- A provider failure falls back once to the original canonical JSON outcome without re-entering negotiation.

The complete ownership, negotiation, React adapter, and fallback contract is recorded in the
[HTTP error representation decision](./http-error-representations.md).

## Request Context Isolation

- Runtime-specific root entries make host async-context storage available before exposing `runWithRequestContext(...)`: Node and Bun register the `node:async_hooks` constructor, while portable entries remain free of Node built-in imports.
- The request-local store is instantiated lazily on first helper use, and the callback runs inside that store whenever the host provides an async-context primitive.
- Non-async callbacks run immediately so return and throw behavior remains synchronous. When they return a promise, continuations created by the callback retain that request context until the promise settles, including while requests overlap.
- Request-context helpers never patch `Promise.prototype` or expose one request context to unrelated promise continuations.
- Hosts without an async-context primitive use a synchronous stack fallback that clears the context before awaited work resumes.

## Managed SSE Backpressure Cancellation

- Managed SSE applies request abort and response-stream close notifications to both iterator reads and adapter `waitForDrain()` backpressure waits.
- If cancellation wins while a drain promise remains unsettled, the dispatcher stops waiting for that promise, closes the response stream, calls the source iterator's `return()` exactly once, and awaits that cleanup before request-scope disposal.
- A stream write that throws or a drain promise that rejects is not reclassified as cancellation. The original error continues through the committed-response observer and dispatcher logging boundary.

## Connection Identity

Adapters snapshot a direct peer address and transport protocol into
`FrameworkRequest.connection` when their host exposes them. Node, Express, and
Fastify populate this portable seam through the shared Node request
normalization path; Fetch-only adapters may omit it because standard `Request`
objects expose no peer address. A fetch-style HTTPS `Request` is not Node
transport parity: without an adapter-provided `connection` snapshot or explicit
headers, `resolveHttpConnection(...)` reports no peer, host, or port and does
not infer HTTPS, `secure`, host, or port from the `Request` URL.

`resolveHttpConnection(request, { trustProxy })` derives the immutable public
connection model. Forwarding headers can influence client address, protocol,
and host only after the direct peer matches the explicit `trustProxy` policy.
Malformed forwarding input is discarded rather than partially trusted.

## Routing Rules

| Rule | Current behavior |
| --- | --- |
| Path normalization | `normalizeRoutePath(...)` removes duplicate and trailing slashes, so equivalent forms normalize to one canonical path. |
| Supported segments | `parseRoutePath(...)` accepts literal segments and full-segment `:param` placeholders only. |
| Unsupported syntax | Wildcards, regex-like tokens, inline modifiers, and mixed segments such as `user-:id` or `:id.json` are rejected by route validation. |
| Catch-all decision | Catch-all grammar is deferred; see the [HTTP catch-all route grammar decision](./http-catch-all-route-grammar.md). No candidate syntax is active. |
| Param naming | Route param names MUST match `/[a-zA-Z_][a-zA-Z0-9_]*/`. |
| Method authoring | `@Query(path)` registers `QUERY`. `@Route(method, path)` accepts a non-empty HTTP token, canonicalizes it to uppercase, and rejects invalid tokens plus the reserved `ALL` sentinel. `@All(path)` remains the only wildcard authoring API. |
| Method precedence | An exact method route is selected before an `ALL` route for the same normalized path. Custom methods use the same duplicate detection and version-selection rules as built-in methods. |
| Adapter boundary | Supported listeners and fetch dispatch preserve `QUERY` and extension methods. Custom methods stay on adapter fallback dispatch rather than native fluo route handoff, and `CONNECT` remains outside ordinary routing conformance. |
| OpenAPI boundary | Custom runtime methods do not become OpenAPI Path Item operations. `@fluojs/openapi` retains its documented standard-operation allowlist. |
| Match shape | `matchRoutePath(...)` matches only when the registered path and incoming path have the same segment count. |
| Handler lookup | `HandlerMapping.match(request)` returns one `HandlerMatch` containing the descriptor and extracted params, or `undefined` when no route matches. |
| Missing route behavior | `matchHandlerOrThrow(...)` throws `HandlerNotFoundError` for unmatched method and path combinations. |
| Response defaults | `writeSuccessResponse(...)` defaults `POST` to `201`, `DELETE` and `OPTIONS` with `undefined` payload to `204`, and other successful routes to `200` unless route metadata overrides the status. |

## Conditional Requests

`BootstrapApplicationOptions.conditionalRequest` gives the dispatcher a resolver for the selected representation. It returns either `{ exists: false }` when no representation exists or `{ exists: true, validators? }` when one exists, with optional `ETag` and `Last-Modified` validators. The dispatcher evaluates the resolver after route selection, application/module middleware, and guards, but before interceptors or the controller handler, so conditional outcomes never bypass authorization or middleware-owned audit work.

The policy follows RFC validator precedence: `If-Match` takes precedence over `If-Unmodified-Since`; `If-None-Match` takes precedence over `If-Modified-Since`. `If-Match` uses strong comparison, while `If-None-Match` uses weak comparison. A failed unsafe precondition produces a bodyless `412`; a fresh safe representation produces a bodyless `304`. Both responses retain resolved validators. `HEAD` receives the same validators and status as `GET`; framework-managed response writing suppresses its body. An explicit `@Head` handler remains an independent route, and custom response writers own body emission, including preserving the bodyless `HEAD` contract.

The dispatcher applies validators through the portable `FrameworkResponse` facade. Node.js, Express, Fastify, Bun, Deno, and Cloudflare Workers therefore expose identical conditional-response headers and body suppression.

## Middleware Constraints

- Middleware MUST implement `handle(context, next)` and run through `runMiddlewareChain(...)`.
- Middleware definitions MAY be object instances, DI tokens, or `forRoutes(...)` declarations that target specific normalized route patterns.
- Route-targeted middleware matches exact normalized paths or prefix patterns ending in `/*`.
- Global application middleware runs before handler matching. Module middleware for the matched handler runs after handler matching and before guards.
- Middleware resolution uses the request-scoped container, so request-scoped dependencies remain available during middleware execution.
- Middleware MAY commit the response early. When `response.committed` is already `true`, later routing and handler stages do not continue.
- A handled request is observed as successful only after both module and application middleware chains return. An after-`next()` middleware failure follows the request error observer path instead.
- Guards and interceptors are not middleware. Guards enforce preconditions through `canActivate(...)`, and interceptors wrap handler execution through `intercept(...)`.
- Middleware MUST NOT redefine route matching, DTO validation, controller invocation, or response serialization rules owned by the dispatcher policies.
