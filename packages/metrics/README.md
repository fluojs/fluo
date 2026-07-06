# @fluojs/metrics

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Prometheus metrics exposure for fluo applications, including framework-aware HTTP metrics and platform telemetry.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @fluojs/metrics
```

## Requirements

`@fluojs/metrics` runs on Node.js 20 or newer; the package manifest declares `engines.node >=20.0.0`.

## When to Use

- when your app should expose a `/metrics` endpoint for Prometheus-compatible scraping
- when HTTP latency and request counts should be instrumented without hand-written middleware
- when application telemetry should stay aligned with fluo readiness and health state

## Quick Start

```ts
import { MetricsModule } from '@fluojs/metrics';
import { Module } from '@fluojs/core';

@Module({
  imports: [MetricsModule.forRoot({ http: true })],
})
class AppModule {}
```

`MetricsModule.forRoot()` exposes `GET /metrics` by default. Pass `http: true` (or an `http` options object) when you want the module to install HTTP request instrumentation middleware. When HTTP instrumentation is enabled, the module records request totals, error counts, and request duration. For production deployments, make the scrape endpoint boundary explicit: either disable it with `path: false` until a platform-level proxy is in place, or attach dedicated endpoint middleware.

The scrape endpoint returns the active `prom-client` registry output with that registry's Prometheus content type. `MetricsModule.forRoot()` creates an isolated registry for each application bootstrap unless you pass a `registry` option; reusing the same dynamic module class for another bootstrap receives fresh isolated metrics state. Pass a shared `Registry` only when framework metrics and application-defined metrics intentionally share one scrape surface.

## Public Responsibilities

| Surface | Responsibility | Boundary |
| --- | --- | --- |
| `MetricsModule.forRoot(...)` | Wires the Prometheus scrape endpoint, default metrics, optional HTTP instrumentation, platform telemetry, and registry ownership. | `provider` currently accepts only `'prometheus'`; `path: false` disables the scrape route and route-scoped endpoint middleware. |
| `MetricsService` | Application-facing facade for custom `Counter`, `Gauge`, and `Histogram` metrics on the active registry, plus `getRegistry()` for deliberate advanced registry sharing. | Use collector helpers for business/application metrics. Use `getRegistry()` only when an integration must hand the active `prom-client` Registry to code that cannot receive `MetricsModule.forRoot({ registry })` directly. |
| `Registry` | Re-export of `prom-client`'s `Registry` constructor for shared-registry setups. | It is the same Prometheus registry implementation; duplicate metric names still fail according to Prometheus semantics. |
| `METER_PROVIDER` / `PrometheusMeterProvider` / meter types | Low-level meter bridge for first-party package integrations that need a provider token or backend-neutral counter/gauge/histogram facade. | Application code usually does not need this token unless it is composing package-level integrations; the only bundled provider backend today is Prometheus. |
| `middleware` | Module-level middleware that participates in the module middleware chain after framework HTTP metrics and endpoint-scoped middleware. | It is not route-scoped; use `endpointMiddleware` when only the scrape route should be protected. |
| `endpointMiddleware` | Class-based `@fluojs/http` middleware constructors bound only to the configured scrape endpoint. | Ignored only when `path: false`; any string `path`, including `''`, remains an active endpoint path. Functions or global middleware declarations are outside this option's contract. |

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

`pathLabelMode: 'raw'` is an unsafe opt-in. You must pass `allowUnsafeRawPathLabelMode: true` only when you can prove the path space is bounded.

### Custom path label normalization

```ts
MetricsModule.forRoot({
  http: {
    pathLabelNormalizer: ({ path }) => (path.startsWith('/api/v1') ? '/api/v1/:resource' : path),
  },
});
```

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

`endpointMiddleware` accepts class-based `@fluojs/http` middleware constructors and binds them only to the metrics scrape endpoint. Middleware functions or global middleware declarations are not the package contract for this option. `middleware` remains module-level middleware and runs as part of the module chain after endpoint-scoped middleware, while `endpointMiddleware` is skipped entirely when `path: false` disables the scrape route. When HTTP instrumentation is enabled, failures thrown by endpoint middleware are recorded in the built-in HTTP request and error collectors.

### Create custom metrics once and reuse them

`MetricsService.counter(...)`, `gauge(...)`, and `histogram(...)` create Prometheus collectors on the active registry. Create each custom metric once during provider construction or application startup, then reuse the returned collector when business actions occur.

```ts
import { Inject } from '@fluojs/core';
import { MetricsService } from '@fluojs/metrics';

@Inject(MetricsService)
class OrdersService {
  private readonly ordersCreated: ReturnType<MetricsService['counter']>;

  constructor(metrics: MetricsService) {
    this.ordersCreated = metrics.counter({
      name: 'orders_created_total',
      help: 'Total orders created',
    });
  }

  recordOrderCreated(): void {
    this.ordersCreated.inc();
  }
}
```

Calling `MetricsService.counter(...)` again with the same name recreates the collector and follows Prometheus' duplicate-name failure behavior. Store and reuse the collector instead of creating it inside each request or command handler.

`MetricsService.getRegistry()` returns the same active `prom-client` Registry used by the module scrape endpoint, built-in HTTP collectors, platform telemetry, and custom collectors created through the service. Prefer passing an explicit `registry` to `MetricsModule.forRoot({ registry })` when you own the bootstrap. Use `getRegistry()` for advanced integrations that receive `MetricsService` through DI and need to register a third-party Prometheus collector on the already active registry.

### Share one registry for framework and app metrics

```ts
import { Module } from '@fluojs/core';
import { Counter, Registry } from 'prom-client';
import { MetricsModule } from '@fluojs/metrics';

const registry = new Registry();

new Counter({
  name: 'orders_total',
  help: 'Total orders processed',
  registers: [registry],
});

@Module({
  imports: [MetricsModule.forRoot({ http: true, registry })],
})
class AppModule {}
```

When multiple metrics module instances intentionally share the same registry, built-in HTTP metrics reuse the existing `http_requests_total`, `http_errors_total`, and `http_request_duration_seconds` collectors instead of registering duplicate framework metrics only when their framework ownership, label schema, and effective path-label configuration match. The path-label compatibility check includes `pathLabelMode`, the exact `pathLabelNormalizer` function reference, and `unknownPathLabel` fallback semantics, so incompatible module instances fail fast instead of mixing different HTTP series policies into one collector set. Built-in platform telemetry gauges follow the same ownership rule: module-created `fluo_component_ready`, `fluo_component_health`, and `fluo_metrics_registry_mode` gauges are reused only when their framework ownership and label schema match. Platform telemetry state is tracked per reused registry, so a later scrape replaces stale module-owned component readiness and health series from an earlier module instance before metrics are returned. Application-defined duplicate names still fail fast.

### Duplicate metric names still fail fast

Prometheus metric names must stay unique inside a registry. Shared-registry mode keeps that behavior intact instead of silently shadowing metrics. If an application predefines a built-in HTTP collector or platform telemetry gauge name, `MetricsModule.forRoot()` rejects the collision instead of reusing an app-owned collector.

### Runtime platform telemetry

The module emits fluo-specific gauges that mirror the platform shell and registered component state.

- `fluo_component_ready`: `1` when a component is ready, otherwise `0`.
- `fluo_component_health`: `1` when a component is healthy, otherwise `0`.
- `fluo_metrics_registry_mode`: gauge value `1` with a `mode="isolated"` or `mode="shared"` label for the active registry mode.

The platform snapshot is refreshed during each registry scrape, including advanced `MetricsService.getRegistry().metrics()` scrape paths, and you can attach environment labels up front.

```ts
MetricsModule.forRoot({
  platformTelemetry: {
    env: 'production',
    instance: 'web-01',
  },
});
```

### Runtime platform telemetry scrape contract

Platform telemetry refreshes `fluo_component_ready` and `fluo_component_health` on each active registry scrape by resolving `PLATFORM_SHELL`, whether the scrape flows through the built-in `/metrics` controller or an advanced custom scraper using `MetricsService.getRegistry()`.

- If `PLATFORM_SHELL` is not registered, the scrape still succeeds and omits the platform telemetry series.
- If `PLATFORM_SHELL` becomes unavailable after the last successful scrape, stale `fluo_component_ready` and `fluo_component_health` series are removed before metrics are returned.
- If resolving `PLATFORM_SHELL` fails for any other reason, the scrape surfaces that failure instead of swallowing it.

### Disable default process and Node metrics

`defaultMetrics` defaults to `true`, so `MetricsModule.forRoot()` registers Prometheus default process and Node.js collectors once per registry unless you opt out.

```ts
MetricsModule.forRoot({
  defaultMetrics: false,
});
```

## Public API

- `MetricsModule.forRoot(options)`
- `MetricsService`, including `counter(...)`, `gauge(...)`, `histogram(...)`, and `getRegistry()`
- `METER_PROVIDER`
- `PrometheusMeterProvider`
- Meter abstraction types: `MeterProvider`, `MeterCounter`, `MeterGauge`, and `MeterHistogram`
- `HttpMetricsMiddleware` and HTTP path-label option types
- Module options including `provider` (currently only `'prometheus'`), module-level `middleware`, and endpoint-scoped `endpointMiddleware`
- `Registry` from `prom-client`

### Operational defaults

- `path` defaults to `'/metrics'`, any string path including `''` exposes a scrape endpoint, and `path: false` disables the scrape endpoint entirely.
- When `registry` is omitted, each application bootstrap owns a fresh isolated registry, `MetricsService`, meter provider, and telemetry collector set.
- The scrape response uses the active registry's Prometheus content type and registry contents.
- `defaultMetrics` defaults to `true`, and `defaultMetrics: false` disables Prometheus default process and Node.js collectors for that registry.
- `endpointMiddleware` binds class-based route-scoped middleware only to the scrape endpoint; with HTTP instrumentation enabled, endpoint middleware failures are counted by the built-in HTTP collectors.
- HTTP metrics are installed only when `http: true` or an `http` options object is provided, and then default to template-normalized path labels.
- Built-in HTTP collectors are reused when module instances share one registry only if they are framework-owned, have the expected label schema, and use matching path-label configuration; platform telemetry gauges are reused only if they are framework-owned and have the expected label schema; custom application metric name collisions keep Prometheus' duplicate-name failure behavior.
- Raw path labels require `allowUnsafeRawPathLabelMode: true` and should stay limited to bounded internal routes.
- Platform telemetry is omitted only when `PLATFORM_SHELL` is genuinely missing; other resolution failures fail the scrape.
- Stale platform telemetry series are removed when `PLATFORM_SHELL` becomes unavailable after the last successful scrape or when a later module instance refreshes a reused registry with a different platform snapshot.

## Related Packages

- `@fluojs/http`: contributes the request lifecycle that HTTP metrics observe
- `@fluojs/runtime`: provides platform state used by runtime telemetry gauges
- `@fluojs/terminus`: commonly paired with metrics for ops visibility

## Example Sources

- `examples/ops-metrics-terminus/src/app.ts`
- `packages/metrics/src/metrics-module.test.ts`
