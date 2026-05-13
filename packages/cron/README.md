# @fluojs/cron

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Decorator-based scheduling for fluo applications with lifecycle-managed startup/shutdown and optional Redis distributed locking.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
  - [Distributed Locking](#distributed-locking)
  - [Dynamic Scheduling](#dynamic-scheduling)
  - [Bounded Shutdown](#bounded-shutdown)
- [Public API Overview](#public-api-overview)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
npm install @fluojs/cron croner
```

`croner` is the scheduler engine used by `@fluojs/cron`. Install it alongside the package so lockfiles make the runtime scheduler dependency explicit for applications and deployment audits.

## When to Use

- When you need to run periodic background tasks (e.g., database cleanup, report generation).
- When you want to schedule tasks using standard Cron expressions.
- When running in a multi-instance environment and you need to ensure a task runs only on one instance at a time (Distributed Locking).
- When you need simple one-off delayed tasks (Timeout) or fixed-rate intervals.

## Quick Start

Register the `CronModule` and use decorators to schedule your methods.

Use `CronModule.forRoot(...)` to register scheduling for an application module.
Cron expressions may use either five fields (`minute hour day month weekday`) or six fields (`second minute hour day month weekday`). The built-in `CronExpression` presets use six-field expressions when sub-minute precision is needed. Cron tasks start only after application bootstrap, dynamically registered cron tasks start when added to a started registry, and fluo forwards `timezone` plus no-overlap protection to the scheduler so one task instance does not overlap itself.

```typescript
import { Module } from '@fluojs/core';
import { CronModule, Cron, CronExpression, Interval, Timeout } from '@fluojs/cron';

class BillingService {
  @Cron(CronExpression.EVERY_MINUTE, { name: 'billing.reconcile' })
  async reconcilePendingInvoices() {
    console.log('Reconciling invoices...');
  }

  @Interval(15_000) // 15 seconds
  async pollStatus() {
    console.log('Polling status...');
  }

  @Timeout(5_000) // 5 seconds after startup
  async initialSync() {
    console.log('Running initial sync...');
  }
}

@Module({
  imports: [CronModule.forRoot()],
  providers: [BillingService],
})
class AppModule {}
```

## Common Patterns

### Distributed Locking

To prevent scheduled tasks from running concurrently across multiple server instances, enable distributed mode. This requires `@fluojs/redis`.

```typescript
import { Module } from '@fluojs/core';
import { CronModule } from '@fluojs/cron';
import { RedisModule } from '@fluojs/redis';

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    CronModule.forRoot({
      distributed: {
        enabled: true,
        keyPrefix: 'fluo:cron:lock',
        lockTtlMs: 30_000,
      },
    }),
  ],
})
class AppModule {}
```

Leave `distributed.clientName` unset to keep using the default Redis registration above. To use a non-default Redis connection for distributed locks, set `distributed.clientName` to the name registered through `RedisModule.forRoot({ name, ... })`.

`distributed.lockTtlMs` must stay at or above `1_000ms`. fluo renews the Redis lock before that TTL expires, including the minimum supported `1_000ms` boundary.

Each scheduler instance uses a platform-neutral default `distributed.ownerId`; set `distributed.ownerId` explicitly only when your deployment has a stronger stable-owner convention. Lock release runs in a `finally` path after task execution. If Redis release fails, fluo keeps local ownership in status snapshots and retries during shutdown; if Redis reports that another owner holds the key, local ownership is cleared because fencing has already moved elsewhere. Redis TTL and renewal timing are still drift-sensitive coordination primitives rather than hard fencing tokens, so long-running jobs should remain idempotent and use application-level fencing when stale work would be unsafe.

```typescript
@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    RedisModule.forRoot({ name: 'locks', host: 'localhost', port: 6380 }),
    CronModule.forRoot({
      distributed: {
        clientName: 'locks',
        enabled: true,
        keyPrefix: 'fluo:cron:lock',
        lockTtlMs: 30_000,
      },
    }),
  ],
})
class MultiRedisCronModule {}
```

### Dynamic Scheduling

You can manage tasks at runtime using the `SCHEDULING_REGISTRY`.

```typescript
import { Inject } from '@fluojs/core';
import { SCHEDULING_REGISTRY, type SchedulingRegistry } from '@fluojs/cron';

@Inject(SCHEDULING_REGISTRY)
class TaskManager {
  constructor(private readonly registry: SchedulingRegistry) {}

  addNewTask() {
    this.registry.addCron('dynamic-job', '0 * * * *', () => {
      console.log('Dynamic job running!');
    });
  }

  stopTask() {
    this.registry.remove('dynamic-job');
  }
}
```

The registry exposes `addCron`, `addInterval`, `addTimeout`, `remove`, `enable`, `disable`, `get`, `getAll`, and `updateCronExpression`. Timeout tasks run once, then disable themselves while remaining in the registry so they can be re-enabled deliberately.

Dynamic cron registration is atomic with scheduler startup: if the scheduler rejects a new cron job, the registry does not retain a half-registered task. Updating a running cron expression is also rollback-safe. If rescheduling fails, the previous expression and scheduled job remain active. Cron tasks use both scheduler-level no-overlap protection and fluo's in-process running guard, so the same task instance will not run overlapping ticks.

### Bounded Shutdown

`CronModule` drains active task executions during application shutdown with a bounded timeout so one hung task cannot block process termination forever.

By default the shutdown drain waits up to `10_000ms`. If that timeout expires, the scheduler logs a warning and continues shutdown without waiting for the hung task to settle. When distributed locking is enabled, locks held by still-running tasks are not eagerly released on timeout; they remain owned by that task until it settles normally, or until Redis expires the lock after the process exits. This prevents another node from starting the same job while the original task is still running.

```typescript
@Module({
  imports: [
    CronModule.forRoot({
      shutdown: {
        timeoutMs: 5_000,
      },
    }),
  ],
})
class AppModule {}
```

Only singleton providers/controllers are scheduled. Request-scoped and transient scheduled classes are skipped with a warning.

## Public API Overview

### Modules
- `CronModule.forRoot(options)`: Configures the scheduler and enables distributed locking if requested.

### Decorators
- `@Cron(expression, options?)`: Schedules a method using a cron expression.
- `@Interval(ms, options?)`: Schedules a method to run at a fixed interval.
- `@Timeout(ms, options?)`: Schedules a method to run once after a delay.

### Constants & Tokens
- `CronExpression`: Enum-like object with common cron patterns, including sub-minute presets such as `EVERY_SECOND`, `EVERY_5_SECONDS`, and `EVERY_30_SECONDS`.
- `SCHEDULING_REGISTRY`: Injection token for the `SchedulingRegistry` service.
- `normalizeCronModuleOptions(...)`: Normalizes module options and defaults.
- `createCronPlatformStatusSnapshot(...)`: Creates a status snapshot for health/readiness integrations.
- Public types: `CronModuleOptions`, `CronDistributedOptions`, `CronShutdownOptions`, `CronScheduleOptions`, `CronScheduler`, `CronScheduledJob`, `SchedulingRegistry`, `SchedulingTaskDescriptor`, `SchedulingTaskCallback`, `SchedulingTaskOptions`, `CronTaskOptions`, `IntervalTaskOptions`, and `TimeoutTaskOptions`.
- Metadata helpers and symbols: `defineSchedulingTaskMetadata`, `defineCronTaskMetadata`, `getSchedulingTaskMetadata`, `getCronTaskMetadata`, `getSchedulingTaskMetadataEntries`, `getCronTaskMetadataEntries`, `schedulingMetadataSymbol`, `cronMetadataSymbol`.


## Related Packages

- `@fluojs/redis`: Required for distributed locking functionality.
- `@fluojs/core`: Required for DI and Module management.
- `croner`: The underlying scheduling engine.

## Example Sources

- `packages/cron/src/module.test.ts`: Comprehensive tests for decorators and module lifecycle.
- `packages/cron/src/service.ts`: Runtime scheduling, registry, and shutdown behavior.
- `packages/cron/src/status.test.ts`: Status snapshot behavior.
- `packages/cron/src/distributed-lock-manager.ts`: Redis distributed lock behavior.
