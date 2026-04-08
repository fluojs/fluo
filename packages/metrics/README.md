# @konekti/metrics

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Prometheus metrics exposure for Konekti applications, including framework-aware HTTP metrics and platform telemetry.

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
pnpm add @konekti/metrics
```

## When to Use

- when your app should expose a `/metrics` endpoint for Prometheus-compatible scraping
- when HTTP latency and request counts should be instrumented without hand-written middleware
- when application telemetry should stay aligned with Konekti readiness and health state

## Quick Start

```ts
import { MetricsModule } from '@konekti/metrics';
import { Module } from '@konekti/core';

@Module({
  imports: [MetricsModule.forRoot()],
})
class AppModule {}
```

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

### Share one registry for framework and app metrics

```ts
import { Counter, Registry } from 'prom-client';
import { MetricsModule } from '@konekti/metrics';

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

## Public API Overview

- `MetricsModule.forRoot(options)`
- `MetricsService`
- `METER_PROVIDER`
- Prometheus-backed helpers for counters, gauges, histograms, and registry access

## Related Packages

- `@konekti/http`: contributes the request lifecycle that HTTP metrics observe
- `@konekti/runtime`: provides platform state used by runtime telemetry gauges
- `@konekti/terminus`: commonly paired with metrics for ops visibility

## Example Sources

- `examples/ops-metrics-terminus/src/app.ts`
- `packages/metrics/src/metrics-module.test.ts`
