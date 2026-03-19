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

When distributed mode is enabled, cron tasks acquire a Redis lock through `REDIS_CLIENT` before running so only one instance executes a tick while the lock is held. The guarantee is bounded by `lockTtlMs`, so set the TTL longer than the expected task duration for long-running jobs.

## API

- `@Cron(expression, options?)` - marks a provider/controller method as a cron task
- `CronExpression` - common cron expression constants
- `createCronModule(options?)` - registers cron lifecycle service and scheduler wiring
- `createCronProviders(options?)` - returns raw providers for manual composition
