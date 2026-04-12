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

## When to Use

- When you need to run periodic background tasks (e.g., database cleanup, report generation).
- When you want to schedule tasks using standard Cron expressions.
- When running in a multi-instance environment and you need to ensure a task runs only on one instance at a time (Distributed Locking).
- When you need simple one-off delayed tasks (Timeout) or fixed-rate intervals.

## Quick Start

Register the `CronModule` and use decorators to schedule your methods.

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

Leave `distributed.clientName` unset to keep using the default Redis registration above. To use a non-default Redis connection for distributed locks, set `distributed.clientName` to the name registered through `RedisModule.forRootNamed(...)`.

```typescript
@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    RedisModule.forRootNamed('locks', { host: 'localhost', port: 6380 }),
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

class TaskManager {
  constructor(
    @Inject(SCHEDULING_REGISTRY) private readonly registry: SchedulingRegistry
  ) {}

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

### Bounded Shutdown

`CronModule` drains active task executions during application shutdown, but it now does so with a bounded timeout so one hung task cannot block process termination forever.

By default the shutdown drain waits up to `10_000ms`. If that timeout expires, the scheduler logs a warning and continues shutdown without waiting for the hung task to settle.

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

## Public API Overview

### Modules
- `CronModule.forRoot(options)`: Configures the scheduler and enables distributed locking if requested.

### Decorators
- `@Cron(expression, options?)`: Schedules a method using a cron expression.
- `@Interval(ms, options?)`: Schedules a method to run at a fixed interval.
- `@Timeout(ms, options?)`: Schedules a method to run once after a delay.

### Constants & Tokens
- `CronExpression`: Enum-like object with common cron patterns (e.g., `EVERY_HOUR`, `EVERY_DAY_AT_MIDNIGHT`).
- `SCHEDULING_REGISTRY`: Injection token for the `SchedulingRegistry` service.

## Related Packages

- `@fluojs/redis`: Required for distributed locking functionality.
- `@fluojs/core`: Required for DI and Module management.
- `croner`: The underlying scheduling engine.

## Example Sources

- `packages/cron/src/module.test.ts`: Comprehensive tests for decorators and module lifecycle.
- `packages/cron/src/scheduler.ts`: Implementation details of the core scheduling logic.
