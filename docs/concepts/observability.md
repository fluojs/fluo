# observability

<p><strong><kbd>English</kbd></strong> <a href="./observability.ko.md"><kbd>한국어</kbd></a></p>

This guide outlines the observability model used for logging, correlation IDs, health checks, and metrics.

### related documentation

- `./http-runtime.md`
- `../../packages/runtime/README.md`
- `../../packages/metrics/README.md`

## logging

The application logger uses a consistent interface for managing application events:

```ts
interface ApplicationLogger {
  log(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}
```

- **Console Logger**: The default implementation for local development.
- **JSON Logger**: The recommended implementation for production environments.
- **DI Token**: Use `APPLICATION_LOGGER` to inject or override the logger.

## correlation IDs

- **Storage**: Correlation data is stored in `AsyncLocalStorage` alongside the request context.
- **Extraction**: Middleware reads `X-Request-Id` (or `X-Correlation-Id`) from incoming headers or generates a new one.
- **Propagation**: The ID is returned in the `X-Request-Id` response header.
- **Enrichment**: Logger implementations can automatically include the active request ID without manual passing.

## health and readiness

- **Liveness (`GET /health`)**: Returns `200 { status: 'ok' }` to indicate the process is running.
- **Readiness (`GET /ready`)**: 
  - Returns `503 { status: 'starting' }` during the bootstrap phase.
  - Returns `200 { status: 'ready' }` once initialization is complete.
  - Returns `503 { status: 'unavailable' }` if any registered readiness checks fail.

Liveness and readiness are separate concerns. A failed readiness check affects `/ready` but does not impact the liveness signal at `/health`.

## metrics

- **Endpoint**: `@konekti/metrics` provides the `GET /metrics` endpoint.
- **Collection**: Uses `prom-client` to collect default metrics into isolated registries by default.
- **Shared registry option**: You can pass a `Registry` to `MetricsModule.forRoot({ registry })` so framework metrics and application metrics share one scrape target.
- **HTTP metric labels**: `HttpMetricsMiddleware` uses low-cardinality path normalization (`template` by default, `raw` opt-in) and records `method`, `path`, `status`.
- **Isolation**: Metrics exposure is independent of health checks and can be secured with middleware.

## responsibilities

- **Correlation Middleware**: Manages the correlation ID lifecycle.
- **Loggers**: Enrich log entries with request-specific data.
- **Runtime**: Manages the core health and readiness infrastructure.
- **Metrics Package**: Handles metric collection and exposure.
- **Request Observers**: The preferred mechanism for monitoring request lifecycles (start, match, success, error, finish).

## extension points

- **Readiness Checks**: Add custom checks via the health module API.
- **Logger Replacement**: Wrap or swap the application logger implementation.
- **Observability Hooks**: Attach additional behavior using middleware, interceptors, or observers.
