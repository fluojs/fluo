# @konekti/metrics

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Prometheus metrics endpoint for Konekti applications. Mount `MetricsModule` to expose a `/metrics` scrape target with Node.js default metrics collected out of the box.

## See also

- `../../docs/concepts/observability.md`
- `../../docs/concepts/http-runtime.md`

## Installation

```bash
pnpm add @konekti/metrics
```

## Quick Start

```typescript
import { Module } from '@konekti/core';
import { bootstrapApplication } from '@konekti/runtime';
import { MetricsModule } from '@konekti/metrics';

@Module({
  imports: [
    MetricsModule.forRoot(),
  ],
})
class AppModule {}

await bootstrapApplication({ rootModule: AppModule });
// GET /metrics → Prometheus text format
```

## Core API

### `MetricsModule.forRoot(options?)`

Registers a Prometheus metrics endpoint and returns a `ModuleType` to import into any module.

```typescript
interface MetricsModuleOptions {
  http?: boolean | {
    pathLabelMode?: 'raw' | 'template';
    pathLabelNormalizer?: (context: {
      method: string;
      path: string;
      params: Readonly<Record<string, string>>;
      request: FrameworkRequest;
    }) => string;
    unknownPathLabel?: string;
  };
  path?: string;              // scrape path (default: '/metrics')
  provider?: 'prometheus';    // only supported provider at this time
  defaultMetrics?: boolean;   // collect Node.js default metrics (default: true)
  middleware?: MiddlewareLike[];
  registry?: Registry;        // external Prometheus registry to share with custom metrics
}

class MetricsModule {
  static forRoot(options?: MetricsModuleOptions): ModuleType;
}
```

**Endpoint served:**

| Route | Description |
|-------|-------------|
| `GET /metrics` (default) | Prometheus text format. `Content-Type` is set automatically. |

---

## Configuration

### Custom scrape path

```typescript
MetricsModule.forRoot({ path: '/internal/metrics' })
// → GET /internal/metrics
```

### Disable default metrics

By default, `prom-client`'s `collectDefaultMetrics()` is called, which registers standard Node.js process and GC metrics. In `prom-client` v15 these values are collected on scrape rather than by a background interval. Disable default metrics if you want the built-in endpoint to expose only metrics registered by the module itself:

Default metrics are guarded per registry, so repeated `forRoot()` calls with the same registry do not double-register default collectors.

```typescript
MetricsModule.forRoot({ defaultMetrics: false })
```

### Middleware

Add middleware (e.g. auth guards) to the metrics route:

```typescript
MetricsModule.forRoot({
  middleware: [ipAllowlistMiddleware],
})
```

### HTTP label normalization

When `http` metrics are enabled, `HttpMetricsMiddleware` normalizes path labels to template style by default using request params (for example `/users/123` -> `/users/:id`) to reduce cardinality drift.

```typescript
MetricsModule.forRoot({
  http: {
    pathLabelMode: 'template',
  },
})
```

You can override `HttpMetricsMiddleware` label strategy with a custom normalizer:

```typescript
MetricsModule.forRoot({
  http: {
    pathLabelNormalizer: ({ path }) => (path.startsWith('/internal/') ? '/internal/:resource' : path),
  },
})
```

Use `pathLabelMode: 'raw'` only when you intentionally accept higher cardinality labels.

`unknownPathLabel` defaults to `UNKNOWN`. If a custom normalizer returns a blank string, `HttpMetricsMiddleware` falls back to that label.

### Runtime platform telemetry alignment

`MetricsModule` exports runtime-shared readiness/health semantics from `PLATFORM_SHELL` on every scrape so `/metrics` stays aligned with runtime inspect/snapshot output.

- `konekti_component_ready{component_id,component_kind,operation="readiness",result,env,instance}`
- `konekti_component_health{component_id,component_kind,operation="health",result,env,instance}`
- `konekti_metrics_registry_mode{mode="isolated|shared"}`

`runtime.shell` is exported as a synthetic component identity so aggregate shell readiness/health can be correlated with component-level series.

### Provider contract

`MetricsModule` currently supports only the Prometheus meter provider. Passing any non-prometheus provider value throws at runtime.

### MetricsService vs MeterProvider

- `MetricsService` is the Prometheus-native API and returns `prom-client` metric instances.
- `METER_PROVIDER` exposes the portable meter abstraction API.
- Both use the same module registry, so duplicate metric-name behavior is equivalent across both creation paths.

---

## Custom Metrics

`MetricsModule` creates a dedicated `prom-client` `Registry` instance per `forRoot()` call by default. You can either use the isolated default or provide a shared registry to emit both framework and application metrics from a single scrape endpoint.

### Shared Registry (Recommended)

Pass an external `Registry` to `forRoot()` so custom metrics and framework metrics share the same endpoint:

```typescript
import { Counter, Registry } from 'prom-client';
import { MetricsModule } from '@konekti/metrics';

const sharedRegistry = new Registry();

// Register custom metrics on the shared registry
const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'status'],
  registers: [sharedRegistry],
});

httpRequests.inc({ method: 'GET', status: '200' });

@Module({
  imports: [
    MetricsModule.forRoot({ registry: sharedRegistry }),
  ],
})
class AppModule {}
// GET /metrics → framework metrics + http_requests_total from same registry
```

### Using MetricsService with Shared Registry

After providing a shared registry, `MetricsService` and `METER_PROVIDER` both use it:

```typescript
import { MetricsService } from '@konekti/metrics';

@Inject([MetricsService])
class OrderService {
  constructor(private readonly metrics: MetricsService) {
    this.orderCounter = this.metrics.counter({
      name: 'orders_created_total',
      help: 'Total orders created',
      labelNames: ['status'],
    });
  }
}
// All metrics appear on /metrics endpoint
```

### Accessing the Registry

`MetricsService.getRegistry()` returns the underlying `prom-client` `Registry`:

```typescript
const metricsService = await app.container.resolve(MetricsService);
const registry = metricsService.getRegistry();
// Use registry directly with prom-client APIs
```

### Isolated Registry (Default)

Without a `registry` option, each `forRoot()` call creates a separate registry:

```typescript
import { Counter } from 'prom-client';

// Using the global registry (separate from MetricsModule's internal registry)
const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'status'],
});

httpRequests.inc({ method: 'GET', status: '200' });
```

> **Note:** When using isolated registries, custom metrics registered outside the module won't appear on the built-in `/metrics` endpoint. Use a shared registry for unified scraping.

### Duplicate Metric Names

Prometheus requires unique metric names. When using a shared registry, registering the same name twice throws:

```typescript
import { Counter } from 'prom-client';

const registry = new Registry();

new Counter({ name: 'my_counter', help: 'help', registers: [registry] });

// This throws: 'A metric with the name my_counter has already been registered.'
MetricsModule.forRoot({ registry }).container.resolve(MetricsService)
  .counter({ name: 'my_counter', help: 'duplicate' });
```

This behavior matches `prom-client` and prevents silent metric collisions.

---

## Dependencies

| Package | Role |
|---------|------|
| `@konekti/http` | `Controller`, `Get`, `RequestContext`, `MiddlewareLike` |
| `@konekti/runtime` | `bootstrapApplication`, `ModuleType` |
| `prom-client` | Prometheus metrics collection and formatting |
