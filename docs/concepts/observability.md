# Observability & Operations

<p><strong><kbd>English</kbd></strong> <a href="./observability.ko.md"><kbd>한국어</kbd></a></p>

You cannot manage what you cannot measure. Konekti provides a unified observability model that integrates **logging**, **Prometheus metrics**, **health checks**, and **request correlation** into a single, cohesive operations strategy.

## Why Observability in Konekti?

- **Unified Context**: Every log entry, metric, and trace is tied together by a consistent `X-Request-Id` that persists across asynchronous boundaries.
- **Production-Ready by Default**: With a few lines of code, your application exposes `/health`, `/ready`, and `/metrics` endpoints compatible with industry-standard tooling (Kubernetes, Prometheus, Grafana).
- **Safe Cardinality**: Automatic path normalization (e.g., `/users/123` -> `/users/:id`) prevents "label explosion" in your metrics, ensuring your observability stack stays stable under high load.
- **Graceful Lifecycle**: Integration with **Terminus** ensures that your application shuts down cleanly, finishing in-flight requests and closing database connections before exiting.

## Responsibility Split

- **`@konekti/metrics` (Telemetry)**: Collects and exposes Prometheus-compatible metrics. It handles the low-level instrumentation of HTTP latency and request counts.
- **`@konekti/terminus` (Health & Lifecycle)**: Orchestrates complex health checks (DB, Redis, custom) and manages the graceful shutdown sequence.
- **`@konekti/http` (Correlation)**: Manages the `AsyncLocalStorage` context that carries the `requestId` throughout the request's journey.
- **`@konekti/runtime` (State)**: Provides the fundamental "is-alive" and "is-ready" flags used by the health system.

## Typical Workflows

### 1. Request Correlation
Konekti automatically assigns a unique ID to every incoming request. This ID is accessible anywhere in your code without passing parameters.

```typescript
// Anywhere in your service logic
const reqId = RequestContext.current().requestId;
this.logger.info(`Processing order...`, { reqId });
```

### 2. Standardized Metrics
Enable framework-wide telemetry with a single module import.

```typescript
@Module({
  imports: [MetricsModule.forRoot({
    http: { pathLabelMode: 'template' }
  })],
})
class AppModule {}
```
*Exposes: `GET /metrics` for Prometheus scraping.*

### 3. Smart Health Checks
Distinguish between "the process is running" (Liveness) and "the system is ready for traffic" (Readiness).

```typescript
TerminusModule.forRoot({
  endpoints: {
    '/health': [() => db.ping()], // Liveness
    '/ready': [() => redis.isReady()], // Readiness
  }
})
```

## Core Boundaries

- **Liveness vs. Readiness**: 
  - `/health` (Liveness): If this fails, Kubernetes restarts the container.
  - `/ready` (Readiness): If this fails, the load balancer stops sending traffic to this instance.
- **Label Hygiene**: Never use raw user IDs or unique tokens in metric labels. Always use templates or normalized categories to keep your metrics storage efficient.
- **Async Safety**: Correlation IDs rely on `AsyncLocalStorage`. Avoid breaking the async chain (e.g., using `setTimeout` without wrapping) to ensure IDs are not lost.

## Next Steps

- **Full Example**: See it all working together in the [Ops Metrics Terminus Example](../../examples/ops-metrics-terminus/README.md).
- **Reference**: Deep dive into the [Metrics Package](../../packages/metrics/README.md) and [Terminus Package](../../packages/terminus/README.md).
- **Tracing**: Learn about OpenTelemetry integration in the [Metrics Package README](../../packages/metrics/README.md).
