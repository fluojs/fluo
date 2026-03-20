# @konekti/metrics

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Prometheus metrics endpoint for konekti applications. Mount `MetricsModule` to expose a `/metrics` scrape target with Node.js default metrics collected out of the box.

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
    }) => string;
    unknownPathLabel?: string;
  };
  path?: string;              // scrape path (default: '/metrics')
  provider?: 'prometheus';    // only supported provider at this time
  defaultMetrics?: boolean;   // collect Node.js default metrics (default: true)
  middleware?: MiddlewareLike[];
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

By default, `prom-client`'s `collectDefaultMetrics()` is called, which registers standard Node.js process and GC metrics. Disable it if you want the built-in endpoint to expose only metrics registered by the module itself:

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

When `http` metrics are enabled, path labels default to template-style normalization using request params (for example `/users/123` -> `/users/:id`) to reduce cardinality drift.

```typescript
MetricsModule.forRoot({
  http: {
    pathLabelMode: 'template',
  },
})
```

You can override the label strategy with a custom normalizer:

```typescript
MetricsModule.forRoot({
  http: {
    pathLabelNormalizer: ({ path }) => (path.startsWith('/internal/') ? '/internal/:resource' : path),
  },
})
```

Use `pathLabelMode: 'raw'` only when you intentionally accept higher cardinality labels.

### Provider contract

`MetricsModule` currently supports only the Prometheus meter provider. Passing any non-prometheus provider value throws at runtime.

### MetricsService vs MeterProvider

- `MetricsService` is the Prometheus-native API and returns `prom-client` metric instances.
- `METER_PROVIDER` exposes the portable meter abstraction API.
- Both use the same module registry, so duplicate metric-name behavior is equivalent across both creation paths.

---

## Custom Metrics

`MetricsModule` creates a dedicated `prom-client` `Registry` instance per `forRoot()` call. The current public API does not expose that internal registry, so sharing one registry between custom metrics and the built-in endpoint is not currently supported.

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

> **Note:** `MetricsModule` uses its own isolated `Registry`. If you need one endpoint backed by a shared registry, extend or wrap the module with your own registry plumbing.

---

## Dependencies

| Package | Role |
|---------|------|
| `@konekti/http` | `Controller`, `Get`, `RequestContext`, `MiddlewareLike` |
| `@konekti/runtime` | `bootstrapApplication`, `ModuleType` |
| `prom-client` | Prometheus metrics collection and formatting |
