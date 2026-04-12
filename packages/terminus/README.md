# @fluojs/terminus

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Health indicator toolkit for fluo applications. `@fluojs/terminus` layers on top of runtime health/readiness endpoints to provide dependency-aware status reporting.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Built-in Indicators](#built-in-indicators)
  - [DI-Backed Indicators](#di-backed-indicators)
  - [Failure Semantics](#failure-semantics)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @fluojs/terminus
```

## When to Use

- When you need to monitor external dependencies (databases, Redis, APIs) as part of your application's health status.
- When you want a structured JSON health report that aligns with standard monitoring patterns.
- When you need your `/ready` check to fail if critical downstream services are unreachable.

## Quick Start

Import `TerminusModule.forRoot()` to register health indicators.

```typescript
import { Module } from '@fluojs/core';
import { HttpHealthIndicator, MemoryHealthIndicator, TerminusModule } from '@fluojs/terminus';

@Module({
  imports: [
    TerminusModule.forRoot({
      indicators: [
        new HttpHealthIndicator({ key: 'upstream-api', url: 'https://example.com/health' }),
        new MemoryHealthIndicator({ key: 'memory', heapUsedThresholdRatio: 0.9 }),
      ],
    }),
  ],
})
class AppModule {}
```

## Common Patterns

### Built-in Indicators

The package provides several indicators out of the box:

- `PrismaHealthIndicator` / `DrizzleHealthIndicator`
- `RedisHealthIndicator`
- `HttpHealthIndicator`
- `MemoryHealthIndicator`
- `DiskHealthIndicator`

### DI-Backed Indicators

To use indicators that require dependencies from the DI container (like Redis or Database clients) without importing peer dependencies at module load time, use the provider factories.

```typescript
import { createRedisHealthIndicatorProvider, TerminusModule } from '@fluojs/terminus';

TerminusModule.forRoot({
  indicatorProviders: [
    createRedisHealthIndicatorProvider({ key: 'redis' })
  ],
});
```

If the indicator should use a named Redis connection, pass `clientName` so the provider resolves that named client token instead of the default one.

```typescript
TerminusModule.forRoot({
  indicatorProviders: [
    createRedisHealthIndicatorProvider({ key: 'redis' }),
    createRedisHealthIndicatorProvider({ clientName: 'cache', key: 'cache-redis' }),
  ],
});
```

### Failure Semantics

When an indicator fails, it throws a `HealthCheckError`. The `TerminusHealthService` aggregates these failures into a report:

- `/health` returns HTTP `503` if any indicator fails.
- `/ready` returns HTTP `503` if any indicator associated with readiness fails.
- The response body contains a structured JSON object with `status`, `info`, `error`, and `details`.

## Public API Overview

### `TerminusModule`

- `static forRoot(options: TerminusModuleOptions): ModuleType`
  - Main entry point for registering indicators and providers.

### `TerminusHealthService`

- `runHealthCheck(indicators: HealthIndicator[]): Promise<HealthCheckReport>`
  - Manually trigger a health check aggregation.

### `HealthCheckError`

- Throw this error within custom indicators to signal a "down" state.

## Related Packages

- `@fluojs/metrics`: Often used together for observability.
- `@fluojs/prisma` / `@fluojs/drizzle` / `@fluojs/redis`: Peer dependencies for specific indicators.

## Example Sources

- `examples/ops-metrics-terminus/src/app.ts`: End-to-end integration of health and metrics.
- `packages/terminus/src/health-check.test.ts`: Demonstrates aggregation and assertion flow.
