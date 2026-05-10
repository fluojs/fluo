# Security Middleware Requirements

<p><strong><kbd>English</kbd></strong> <a href="./security-middleware.ko.md"><kbd>한국어</kbd></a></p>

This document defines the current HTTP security-header, CORS, and throttling requirements implemented by `@fluojs/http` and `@fluojs/throttler`.

## Required Headers

`createSecurityHeadersMiddleware()` writes the following headers before calling `next()` unless the application disables an individual header with `false`.

| Header | Default value | Rule | Source anchor |
| --- | --- | --- | --- |
| `Content-Security-Policy` | `default-src 'self'` | Set by default. MAY be overridden or disabled. | `packages/http/src/middleware/security-headers.ts` |
| `Cross-Origin-Opener-Policy` | `same-origin` | Set by default. MAY be overridden or disabled. | `packages/http/src/middleware/security-headers.ts` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Set by default. MAY be overridden or disabled. | `packages/http/src/middleware/security-headers.ts` |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` | Set by default. MAY be disabled with `strictTransportSecurity: false`. | `packages/http/src/middleware/security-headers.ts` |
| `X-Content-Type-Options` | `nosniff` | Set by default. MAY be disabled with `xContentTypeOptions: false`. | `packages/http/src/middleware/security-headers.ts` |
| `X-Frame-Options` | `SAMEORIGIN` | Set by default. MAY be overridden or disabled. | `packages/http/src/middleware/security-headers.ts` |
| `X-XSS-Protection` | `0` | Set by default. MAY be overridden or disabled. | `packages/http/src/middleware/security-headers.ts` |

CORS and rate-limit response headers in the current HTTP middleware contract:

| Header | Emission rule | Source anchor |
| --- | --- | --- |
| `Access-Control-Allow-Origin` | Written when the CORS middleware resolves an allowed origin. | `packages/http/src/middleware/cors.ts` |
| `Access-Control-Allow-Methods` | Written on every CORS middleware pass from the configured or default method list. | `packages/http/src/middleware/cors.ts` |
| `Access-Control-Allow-Headers` | Written only when `allowHeaders` is configured. | `packages/http/src/middleware/cors.ts` |
| `Access-Control-Expose-Headers` | Written only when `exposeHeaders` is configured. | `packages/http/src/middleware/cors.ts` |
| `Access-Control-Allow-Credentials` | Written only when `allowCredentials` is `true`. | `packages/http/src/middleware/cors.ts` |
| `Access-Control-Max-Age` | Written only when `maxAge` is configured. | `packages/http/src/middleware/cors.ts` |
| `Vary: Origin` | Required when CORS reflects a specific origin rather than `*`. | `packages/http/src/middleware/cors.ts` |
| `Retry-After` | Required on rate-limited responses from `createRateLimitMiddleware(...)` and `ThrottlerGuard`. | `packages/http/src/middleware/rate-limit.ts`, `packages/throttler/src/guard.ts` |

## Middleware Order

The current HTTP dispatcher order is fixed by `createDispatcher(...)`.

| Stage | Current order | Result | Source anchor |
| --- | --- | --- | --- |
| 1 | Request context creation and request observers start | Creates request metadata before middleware execution and promotes to a request scope only when the active pipeline may need one. | `packages/http/src/dispatch/dispatcher.ts` |
| 2 | Global application middleware | Runs `appMiddleware` first for every request. | `packages/http/src/dispatch/dispatcher.ts` |
| 3 | Route match and param update | Selects handler and writes route params before module middleware. | `packages/http/src/dispatch/dispatcher.ts` |
| 4 | Module middleware | Runs route-module middleware after route match and before guards. | `packages/http/src/dispatch/dispatcher.ts` |
| 5 | Guard chain | Runs route guards such as `AuthGuard` and `ThrottlerGuard`. | `packages/http/src/dispatch/dispatcher.ts`, `packages/passport/src/guard.ts`, `packages/throttler/src/guard.ts` |
| 6 | Interceptor chain | Runs global and route interceptors after guards succeed. | `packages/http/src/dispatch/dispatcher.ts` |
| 7 | Handler invocation and response write | Executes the controller handler, then writes success output unless the response is already committed. | `packages/http/src/dispatch/dispatcher.ts` |
| 8 | Error mapping and request-scope disposal | Normalizes unhandled failures, writes error responses, notifies finish observers, then disposes the request container only when the dispatch promoted to an isolated request scope. | `packages/http/src/dispatch/dispatcher.ts` |

Middleware-specific ordering rules:

- `createSecurityHeadersMiddleware()` sets headers before awaiting `next()`, so downstream handlers see the header state already attached to the response.
- `createCorsMiddleware()` runs inside the middleware phase. `OPTIONS` preflight requests short-circuit with status `204` and do not continue to guards or handlers.
- `createRateLimitMiddleware()` runs inside the middleware phase. Requests that exceed the configured limit return `429` and do not continue to route matching or handler logic when used as app middleware.
- `ThrottlerGuard` runs in the guard phase, after middleware and after route match, because it derives a handler-specific storage key from the resolved route descriptor.

## Constraints

- Applications that need the default security-header set MUST install `createSecurityHeadersMiddleware()` explicitly. The dispatcher does not add it automatically.
- CORS with `allowCredentials: true` MUST use explicit origins. `allowOrigin: '*'` or an omitted `allowOrigin` value is rejected, and an origin callback that returns `'*'` is rejected at request time.
- Reflected-origin CORS responses MUST include `Vary: Origin` so caches do not collapse distinct origin policies.
- The built-in HTTP rate-limit middleware uses process-local memory by default. Multi-instance deployments should not treat it as a shared quota mechanism.
- Proxy-derived client identity is disabled by default. `trustProxyHeaders: true` should be enabled only when the adapter is behind a trusted proxy that rewrites `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`.
- Handler-level throttling in `@fluojs/throttler` uses the resolved route signature plus client identity as the storage key, so it enforces limits per route-handler boundary rather than one global bucket.
- `@Throttle({ ttl, limit })` and `@SkipThrottle()` modify the guard-stage throttling policy only. They do not change the behavior of app-level HTTP middleware.
