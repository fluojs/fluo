# @konekti/cron

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Decorator-based scheduling for Konekti applications with lifecycle-managed startup/shutdown and optional Redis distributed locking.

## Installation

```bash
npm install @konekti/cron croner
```

## Quick Start

```typescript
import { Inject, Module } from '@konekti/core';
import { createCronModule, Cron, CronExpression, Interval, Timeout } from '@konekti/cron';

class BillingService {
  @Cron(CronExpression.EVERY_MINUTE, { name: 'billing.reconcile' })
  async reconcilePendingInvoices() {
    // run periodic work
  }

  @Interval(15_000, { name: 'billing.poll' })
  pollBillingProvider() {
    // run every 15s
  }

  @Timeout(30_000, { name: 'billing.initial-sync' })
  runInitialSync() {
    // run once 30s after bootstrap
  }
}

@Module({
  imports: [createCronModule()],
  providers: [BillingService],
})
export class AppModule {}
```

## Distributed locking (optional)

```typescript
import { Module } from '@konekti/core';
import { createCronModule } from '@konekti/cron';
import { createRedisModule } from '@konekti/redis';

@Module({
  imports: [
    createRedisModule({ host: '127.0.0.1', port: 6379 }),
    createCronModule({
      distributed: {
        enabled: true,
        keyPrefix: 'konekti:cron:lock',
        lockTtlMs: 30_000,
      },
    }),
  ],
})
export class AppModule {}
```

To run in distributed mode, register `REDIS_CLIENT` (for example via `createRedisModule(...)`) alongside `createCronModule(...)`. In distributed mode each tick acquires a Redis lock before running and attempts lock renewal while work is in progress; if lock ownership is lost or renewal fails before completion, the tick is treated as failed. If `REDIS_CLIENT` is missing or does not implement the required `set`/`eval` lock operations, application bootstrap fails instead of silently falling back to in-process scheduling.

## Runtime registry (dynamic scheduling)

`createCronModule()` registers an injectable runtime registry token backed by the lifecycle service:

```typescript
import { Inject } from '@konekti/core';
import { SCHEDULING_REGISTRY, type SchedulingRegistry } from '@konekti/cron';

@Inject([SCHEDULING_REGISTRY])
class TaskRegistrar {
  constructor(private readonly scheduling: SchedulingRegistry) {}

  register() {
    this.scheduling.addCron('sync.cron', '*/5 * * * * *', async () => {});
    this.scheduling.addInterval('sync.interval', 5_000, async () => {});
    this.scheduling.addTimeout('sync.timeout', 30_000, async () => {});
  }
}
```

Registry API:

- `addCron(name, expression, callback, options?)`
- `addInterval(name, ms, callback, options?)`
- `addTimeout(name, ms, callback, options?)`
- `remove(name)`
- `enable(name)` / `disable(name)`
- `get(name)` / `getAll()`
- `updateCronExpression(name, expression)` (cron tasks only)

Task names are global and name-based. Duplicate names across cron/interval/timeout fail fast.

Dynamic tasks accept the same scheduling options as decorator-based tasks. When module-level distributed mode is enabled and a runtime task keeps `distributed: true` (the default), registry-triggered cron/interval/timeout executions reuse the same Redis lock acquisition, renewal, release, and shutdown cleanup path as decorator-discovered tasks. Crash recovery still relies on lock TTL expiry rather than a separate heartbeat/orphan reaper.

Timeout behavior: after a timeout task fires, its task definition remains in the registry but is disabled (not scheduled). Calling `enable(name)` schedules it again using the full configured delay.

## API

- `@Cron(expression, options?)` - marks a provider/controller method as a cron task
- `@Interval(ms, options?)` - marks a provider/controller method as an interval task
- `@Timeout(ms, options?)` - marks a provider/controller method as a timeout task
- `CronExpression` - common cron expression constants
- `createCronModule(options?)` - registers cron lifecycle service and scheduler wiring
- `createCronProviders(options?)` - returns raw providers for manual composition
- `SCHEDULING_REGISTRY` - inject runtime scheduling registry
- `SchedulingRegistry` - runtime API for dynamic task registration and control
- `createCronPlatformStatusSnapshot(input)` - maps scheduler lifecycle/distributed-lock/drain visibility into shared platform snapshot fields

### Root barrel public surface governance (0.x)

- **supported**: scheduling decorators (`@Cron`, `@Interval`, `@Timeout`), `CronExpression`, `createCronModule`, `createCronProviders`, `SCHEDULING_REGISTRY`, and status snapshot helpers.
- **compatibility-only**: `CRON_OPTIONS` and metadata helper exports (`defineSchedulingTaskMetadata`, `defineCronTaskMetadata`, `get*TaskMetadata*`, `schedulingMetadataSymbol`, `cronMetadataSymbol`) remain exported for 0.x compatibility and framework/tooling integration, but are not recommended for new app-level imports.
- **internal**: scheduler lifecycle internals beyond documented APIs are not part of the root-barrel contract.

## non-goals and intentional limitations

- No silent fallback to in-process scheduling — if distributed mode is enabled and `REDIS_CLIENT` is missing or incompatible, bootstrap fails explicitly rather than silently degrading
- No sub-second scheduling — cron expressions follow standard 5-field cron syntax via `croner`; minimum resolution is one second
- No built-in job queue or persistence — `@Cron` is a fire-and-forget tick scheduler; for durable job processing with retries and persistence, use `@konekti/queue`
- No private method scheduling decorators — `@Cron`, `@Interval`, and `@Timeout` reject private methods

## Platform status snapshot semantics

Use `createCronPlatformStatusSnapshot(...)` (or `CronLifecycleService#createPlatformStatusSnapshot()`) to expose scheduler lifecycle and distributed-lock behavior in the shared platform snapshot shape.

- `dependencies`: when distributed mode is enabled, snapshots expose explicit `redis.default` dependency edges.
- `readiness`: lifecycle transitions and distributed Redis dependency availability are surfaced explicitly.
- `health`: lock ownership loss/renewal failures are represented as degraded health (not silent).
- `details`: includes total/enabled/running task counts, active in-flight ticks, owned lock count, and lock-failure counters.
