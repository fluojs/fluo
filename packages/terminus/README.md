# @konekti/terminus

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Health indicator toolkit for Konekti applications. `@konekti/terminus` layers on top of runtime health/readiness endpoints and adds dependency-aware checks for `/health`.

## What this package does

- preserves runtime-owned `/health` + `/ready` wiring through `createHealthModule()`
- adds composable health indicator contracts (`HealthIndicator`, `HealthIndicatorResult`)
- aggregates indicator outcomes into a structured report (`status`, `info`, `error`, `details`)
- sets `/health` to HTTP `503` when any indicator fails
- registers indicator-backed readiness checks so `/ready` returns `503` on dependency failures
- aligns `/health` and `/ready` with runtime-owned platform shell readiness/health semantics

## Installation

```bash
npm install @konekti/terminus
```

Optional peer integrations (`@konekti/prisma`, `@konekti/drizzle`, `@konekti/redis`) are not imported at module load time. You can use the package safely even when those peers are not installed.

## Quick start

```typescript
import { Module } from '@konekti/core';
import {
  HttpHealthIndicator,
  MemoryHealthIndicator,
  createTerminusModule,
} from '@konekti/terminus';

@Module({
  imports: [
     createTerminusModule({
       indicators: [
         new HttpHealthIndicator({ key: 'upstream-api', url: 'https://example.com/health' }),
         new MemoryHealthIndicator({ key: 'memory', heapUsedThresholdRatio: 0.9 }),
      ],
    }),
  ],
})
class AppModule {}
```

## Built-in indicators

- `PrismaHealthIndicator`
- `DrizzleHealthIndicator`
- `RedisHealthIndicator`
- `HttpHealthIndicator`
- `MemoryHealthIndicator`
- `DiskHealthIndicator`

Convenience factories (`createPrismaHealthIndicator()`, etc.) are also exported and return class instances.
Peer-backed integrations also expose DI registration helpers such as `createPrismaHealthIndicatorProvider()`, `createDrizzleHealthIndicatorProvider()`, and `createRedisHealthIndicatorProvider()` so the indicator instances can be created from the corresponding Konekti client tokens without importing optional peers at module load time.

When you want DI-backed indicators to participate in `/health` and `/ready`, pass them through `indicatorProviders`:

```typescript
import { REDIS_CLIENT } from '@konekti/redis';
import { createRedisHealthIndicatorProvider, createTerminusModule } from '@konekti/terminus';

createTerminusModule({
  indicatorProviders: [createRedisHealthIndicatorProvider({ key: 'redis' })],
});
```

For Drizzle specifically, the default path uses an **execute-capable handle** (`database.execute(...)`) with `select 1`. If your Drizzle setup does not expose a universal execute seam, pass an explicit `ping` callback.

The public DI seams for extension are `TERMINUS_HEALTH_INDICATORS`, `TERMINUS_INDICATOR_PROVIDER_TOKENS`, and `TerminusHealthService`. The module-options token wiring is internal and intentionally not part of the public contract.

## Migration notes (0.x)

- `TERMINUS_OPTIONS` was removed from the public package surface in `0.x` and is now internal wiring.
- If you previously imported or injected `TERMINUS_OPTIONS` from `@konekti/terminus`, migrate to the supported extension seams instead: `TERMINUS_HEALTH_INDICATORS`, indicator provider contracts (`indicatorProviders`, `create*HealthIndicatorProvider()`), and `TerminusHealthService`.

## Key API

- `createTerminusModule(options)`
- `createTerminusProviders(options)`
- `runHealthCheck(indicators)`
- `assertHealthCheck(report)`
- `TerminusHealthService`
- `HealthCheckError`

## Failure semantics

- `indicator.check(key)` returns `{ [key]: { status: 'up', ...details } }` on success.
- `indicator.check(key)` throws `HealthCheckError` on failure with `causes` shaped as `{ [key]: { status: 'down', ...details } }`.
- `runHealthCheck(indicators)` catches those failures, preserves their structured causes, and aggregates them into the `/health` report.
- `contributors` in the health report declares which indicator keys currently contribute `up` and `down` states.
- `/health` includes `platform.readiness` and `platform.health` from the runtime `PLATFORM_SHELL` so the endpoint does not diverge from inspect/snapshot semantics.

## Health report shape

```json
{
  "status": "error",
  "checkedAt": "2026-03-24T00:00:00.000Z",
  "contributors": {
    "up": ["memory"],
    "down": ["redis"]
  },
  "info": {
    "memory": { "status": "up", "rss": 123456 }
  },
  "error": {
    "redis": { "status": "down", "message": "ECONNREFUSED" }
  },
  "details": {
    "memory": { "status": "up", "rss": 123456 },
    "redis": { "status": "down", "message": "ECONNREFUSED" }
  },
  "platform": {
    "readiness": { "status": "ready", "critical": false },
    "health": { "status": "healthy" }
  }
}
```
