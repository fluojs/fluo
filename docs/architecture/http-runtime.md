# HTTP Runtime Contract

<p><strong><kbd>English</kbd></strong> <a href="./http-runtime.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current request execution contract implemented by `@fluojs/http` and assembled by `@fluojs/runtime`.

## Request Lifecycle

1. The adapter supplies a normalized `FrameworkRequest` and `FrameworkResponse` to `Dispatcher.dispatch(...)`.
2. The dispatcher clones request params and builds a `RequestContext` with request metadata and an optional `x-request-id`. It starts on the root container and promotes to an isolated request-scoped container only when the matched graph, active middleware, observers, DTO conversion, binder, guard, interceptor, controller dependency graph, or manual `RequestContext.container.resolve(...)` access may need request scope.
3. Registered request observers receive `onRequestStart` before route matching.
4. Global application middleware runs first through `runMiddlewareChain(...)`.
5. `matchHandlerOrThrow(...)` resolves one handler from the `HandlerMapping` or throws `HandlerNotFoundError`.
6. Matched route params are copied into `requestContext.request.params`, then observers may receive `onHandlerMatched`.
7. Module-level middleware attached to the matched handler runs after global middleware and before guard execution.
8. `runGuardChain(...)` resolves guards from the request container and throws `ForbiddenException` when any guard returns `false`.
9. The interceptor chain is composed from global interceptors followed by route interceptors.
10. `invokeControllerHandler(...)` resolves the controller from the request container, binds the declared DTO through the binder, and validates DTO input through `HttpDtoValidationAdapter` when the route declares `request` metadata.
11. The controller method receives `(input, requestContext)` and returns the handler result.
12. Successful non-SSE results are written through `writeSuccessResponse(...)`, which applies redirect metadata, route headers, formatter selection, and default success status rules.
13. If any stage throws, the dispatcher runs `onError` when configured, otherwise `writeErrorResponse(...)` writes the default error response.
14. The dispatcher always emits `onRequestFinish`. When a request scope was created or lazily promoted, it disposes that isolated request-scoped container before the request ends; singleton-only fast-path requests that never promote do not dispose the root container.

## Routing Rules

| Rule | Current behavior |
| --- | --- |
| Path normalization | `normalizeRoutePath(...)` removes duplicate and trailing slashes, so equivalent forms normalize to one canonical path. |
| Supported segments | `parseRoutePath(...)` accepts literal segments and full-segment `:param` placeholders only. |
| Unsupported syntax | Wildcards, regex-like tokens, inline modifiers, and mixed segments such as `user-:id` or `:id.json` are rejected by route validation. |
| Param naming | Route param names MUST match `/[a-zA-Z_][a-zA-Z0-9_]*/`. |
| Match shape | `matchRoutePath(...)` matches only when the registered path and incoming path have the same segment count. |
| Handler lookup | `HandlerMapping.match(request)` returns one `HandlerMatch` containing the descriptor and extracted params, or `undefined` when no route matches. |
| Missing route behavior | `matchHandlerOrThrow(...)` throws `HandlerNotFoundError` for unmatched method and path combinations. |
| Response defaults | `writeSuccessResponse(...)` defaults `POST` to `201`, `DELETE` and `OPTIONS` with `undefined` payload to `204`, and other successful routes to `200` unless route metadata overrides the status. |

## Middleware Constraints

- Middleware MUST implement `handle(context, next)` and run through `runMiddlewareChain(...)`.
- Middleware definitions MAY be object instances, DI tokens, or `forRoutes(...)` declarations that target specific normalized route patterns.
- Route-targeted middleware matches exact normalized paths or prefix patterns ending in `/*`.
- Global application middleware runs before handler matching. Module middleware for the matched handler runs after handler matching and before guards.
- Middleware resolution uses the request-scoped container, so request-scoped dependencies remain available during middleware execution.
- Middleware MAY commit the response early. When `response.committed` is already `true`, later routing and handler stages do not continue.
- Guards and interceptors are not middleware. Guards enforce preconditions through `canActivate(...)`, and interceptors wrap handler execution through `intercept(...)`.
- Middleware MUST NOT redefine route matching, DTO validation, controller invocation, or response serialization rules owned by the dispatcher policies.
