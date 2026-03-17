# observability

This guide describes the current observability model across logging, correlation IDs, health/readiness, and metrics exposure.

See also:

- `./http-runtime.md`
- `../../packages/runtime/README.md`
- `../../packages/metrics/README.md`

## logging contract

The current application logger surface is:

```ts
interface ApplicationLogger {
  log(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}
```

- the console logger remains the default development implementation
- the JSON logger is the production-oriented implementation
- `APPLICATION_LOGGER` is the DI token

## correlation ID propagation

- correlation data lives in AsyncLocalStorage alongside request context
- correlation middleware reads `X-Request-Id` (or `X-Correlation-Id`) from the request, or generates one
- the chosen ID is echoed back as `X-Request-Id`
- logger implementations can enrich log output from the active request context without explicit plumbing

## health and readiness

- `GET /health` -> `200 { status: 'ok' }`
- `GET /ready` -> `503 { status: 'starting' }` until boot completes
- `GET /ready` -> `200 { status: 'ready' }` after boot completes
- readiness can also return `503 { status: 'unavailable' }` when an added readiness check fails

## metrics

- `@konekti/metrics` exposes `GET /metrics`
- `prom-client` default metrics are collected into an isolated registry per module instance
- metrics exposure is separate from health/readiness and can be protected by dedicated middleware

## ownership boundaries

- correlation middleware owns the correlation-ID write path
- logger implementations own log-entry enrichment
- readiness and health live with runtime-owned health wiring
- metrics exposure lives in `@konekti/metrics`
- request observers remain the preferred seam for lifecycle fan-out such as start, match, success, error, and finish

## extension points

- add readiness checks through the health module API
- wrap or replace the application logger implementation
- attach extra request-level observability behavior through middleware, interceptors, or observers depending on the concern
