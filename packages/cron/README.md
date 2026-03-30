# @konekti/cron

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Decorator-based cron scheduling for Konekti applications with lifecycle-managed startup/shutdown and optional Redis distributed locking.

## Installation

```bash
npm install @konekti/cron croner
```

## Quick Start

```typescript
import { Inject, Module } from '@konekti/core';
import { createCronModule, Cron, CronExpression } from '@konekti/cron';

class BillingService {
  @Cron(CronExpression.EVERY_MINUTE, { name: 'billing.reconcile' })
  async reconcilePendingInvoices() {
    // run periodic work
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

## API

- `@Cron(expression, options?)` - marks a provider/controller method as a cron task
- `CronExpression` - common cron expression constants
- `createCronModule(options?)` - registers cron lifecycle service and scheduler wiring
- `createCronProviders(options?)` - returns raw providers for manual composition

## non-goals and intentional limitations

- No silent fallback to in-process scheduling — if distributed mode is enabled and `REDIS_CLIENT` is missing or incompatible, bootstrap fails explicitly rather than silently degrading
- No sub-second scheduling — cron expressions follow standard 5-field cron syntax via `croner`; minimum resolution is one second
- No built-in job queue or persistence — `@Cron` is a fire-and-forget tick scheduler; for durable job processing with retries and persistence, use `@konekti/queue`
- No dynamic cron expression updates at runtime — expressions are resolved at bootstrap time from decorator metadata
