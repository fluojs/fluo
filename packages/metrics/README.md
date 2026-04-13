# @fluojs/metrics

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Prometheus metrics exposure for fluo applications, including framework-aware HTTP metrics and platform telemetry.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @fluojs/metrics
```

## When to Use

- when your app should expose a `/metrics` endpoint for Prometheus-compatible scraping
- when HTTP latency and request counts should be instrumented without hand-written middleware
- when application telemetry should stay aligned with fluo readiness and health state

## Quick Start

```ts
import { MetricsModule } from '@fluojs/metrics';
import { Module } from '@fluojs/core';

@Module({
  imports: [MetricsModule.forRoot()],
})
class AppModule {}
```

`MetricsModule.forRoot()` still exposes `GET /metrics` by default. For production deployments, make that endpoint boundary explicit: either disable it with `path: false` until a platform-level proxy is in place, or attach dedicated endpoint middleware.

## Common Patterns

### Normalize HTTP path labels

```ts
MetricsModule.forRoot({
  http: {
    pathLabelMode: 'template',
    unknownPathLabel: 'UNKNOWN',
  },
});
```

`pathLabelMode: 'raw'` is now treated as an unsafe opt-in. You must pass `allowUnsafeRawPathLabelMode: true` only when you can prove the path space is bounded.

### Protect or disable the metrics endpoint

```ts
import { ForbiddenException, type MiddlewareContext, type Next } from '@fluojs/http';

class MetricsTokenMiddleware {
  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    if (context.request.headers['x-metrics-token'] !== 'secret-token') {
      throw new ForbiddenException('Metrics endpoint requires x-metrics-token.');
    }

    await next();
  }
}

MetricsModule.forRoot({
  endpointMiddleware: [MetricsTokenMiddleware],
});

MetricsModule.forRoot({
  path: false,
});
```

### Share one registry for framework and app metrics

```ts
import { Counter, Registry } from 'prom-client';
import { MetricsModule } from '@fluojs/metrics';

const registry = new Registry();

new Counter({
  name: 'orders_total',
  help: 'Total orders processed',
  registers: [registry],
});

@Module({
  imports: [MetricsModule.forRoot({ registry })],
})
class AppModule {}
```

### Duplicate metric names still fail fast

Prometheus metric names must stay unique inside a registry. Shared-registry mode keeps that behavior intact instead of silently shadowing metrics.

### Disable default process and Node metrics

`defaultMetrics` defaults to `true`, so `MetricsModule.forRoot()` registers Prometheus default process and Node.js collectors once per registry unless you opt out.

```ts
MetricsModule.forRoot({
  defaultMetrics: false,
});
```

## Public API Overview

- `MetricsModule.forRoot(options)`
- `MetricsService`
- `METER_PROVIDER`
- Prometheus-backed helpers for counters, gauges, histograms, and registry access

### Operational defaults

- `path` defaults to `'/metrics'`, and `path: false` disables the scrape endpoint entirely.
- `defaultMetrics` defaults to `true`, and `defaultMetrics: false` disables Prometheus default process and Node.js collectors for that registry.
- `endpointMiddleware` binds route-scoped middleware only to the scrape endpoint.
- HTTP metrics default to template-normalized path labels.
- Raw path labels require `allowUnsafeRawPathLabelMode: true` and should stay limited to bounded internal routes.

## Related Packages

- `@fluojs/http`: contributes the request lifecycle that HTTP metrics observe
- `@fluojs/runtime`: provides platform state used by runtime telemetry gauges
- `@fluojs/terminus`: commonly paired with metrics for ops visibility

## Example Sources

- `examples/ops-metrics-terminus/src/app.ts`
- `packages/metrics/src/metrics-module.test.ts`
