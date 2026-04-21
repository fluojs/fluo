<!-- packages: @fluojs/cron, @fluojs/redis -->
<!-- project-state: FluoShop v2.1.0 -->

# 12. Scheduling and Distributed Locks

Queues handle work that starts because something happened. Schedulers handle work that should happen because time passed. FluoShop needs both. The `@fluojs/cron` package gives the platform decorator-based scheduling with lifecycle management and optional Redis-backed distributed locking. That combination matters in production. A scheduled task is easy to write. A scheduled task that behaves correctly across multiple instances, during shutdown, and under failure is a more serious design problem. This chapter covers that boundary.

## 12.1 Why FluoShop needs scheduling

By v2.1.0, FluoShop already reacts to commands, events, sagas, and queued jobs. Some work still does not originate from a request or a fresh domain event. It originates from the calendar.

Examples include:

- expiring unpaid reservations every minute
- reconciling marketplace settlement files every hour
- cleaning abandoned upload artifacts every night
- running delayed warm-up tasks after startup
- polling an external fulfillment partner at fixed intervals

These are scheduling concerns. They are not naturally expressed as one-time commands sent by a user. They also need operational safeguards once the application runs on multiple instances.

## 12.2 Cron module wiring

The README documents `CronModule.forRoot(...)` as the registration entrypoint.

fluo supports cron expressions, fixed intervals, and one-time timeouts.

```typescript
import { Module } from '@fluojs/core';
import { CronModule } from '@fluojs/cron';

@Module({
  imports: [CronModule.forRoot()],
  providers: [ReservationExpiryService, SettlementService],
})
export class SchedulingModule {}
```

The design is consistent with earlier chapters. You register the package at the module boundary. You express scheduled behavior through decorators on providers. Lifecycle management belongs to the framework package, not to handwritten bootstrap glue.

## 12.3 Cron, interval, and timeout flows

The package exposes three main scheduling shapes. `@Cron` is for calendar-style schedules. `@Interval` is for fixed-rate repeated work. `@Timeout` is for one-off delayed work after startup. FluoShop uses all three.

### 12.3.1 Reservation expiry cron

Unpaid reservations should expire on a regular cadence.

That is a natural cron task.

```typescript
import { Cron, CronExpression } from '@fluojs/cron';

export class ReservationExpiryService {
  @Cron(CronExpression.EVERY_MINUTE, { name: 'checkout.expire-reservations' })
  async expireStaleReservations() {
    await this.reservations.expireOlderThanMinutes(15);
  }
}
```

This is time-based maintenance attached to a business rule.

The schedule is part of the behavior contract.

### 12.3.2 Startup timeout and periodic polling

Some work should happen shortly after boot. For example, FluoShop may run an initial cache warm-up or configuration sync five seconds after startup. Other work may poll a partner API every fifteen seconds. Those flows map naturally to `@Timeout` and `@Interval`. The important point is that fluo treats them as first-class scheduling concepts, not improvised `setTimeout` and `setInterval` calls scattered through bootstrap code.

## 12.4 Distributed locking across multiple instances

The README highlights distributed mode as the key production feature. When several application instances run the same scheduled task, FluoShop often wants only one of them to execute it at a time. That is what Redis-backed distributed locking provides.

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
export class DistributedSchedulingModule {}
```

This is not an optional detail for serious deployments. Without distributed locking, every instance might expire the same reservations, launch the same reconciliation, or enqueue the same downstream jobs. That can become both a data correctness problem and an infrastructure cost problem.

### 12.4.1 The lock flow in FluoShop

At v2.1.0, a distributed cron flow looks like this:

1. Several FluoShop instances reach the same schedule boundary.
2. Each instance attempts to acquire the Redis lock for the named job.
3. One instance wins and runs the task.
4. The others skip execution for that cycle.
5. The winning instance renews the lock while the task is still active.
6. The lock expires or is released when the run ends.

This pattern is easy to explain. That is a good sign. Distributed coordination should be explicit enough that operators can reason about it under incident pressure.

## 12.5 Lock TTL and named Redis clients

The README sets an important boundary. `distributed.lockTtlMs` must stay at or above `1_000ms`. fluo renews the lock before the TTL expires, including that minimum boundary. This tells FluoShop teams two things. First, lock duration is a real operational parameter. Second, tiny values are not a clever optimization. They are a reliability risk. The package also supports `distributed.clientName` for using a non-default Redis connection. That is useful when lock traffic should be isolated from cache or queue traffic.

## 12.6 Dynamic scheduling at runtime

The README also documents `SCHEDULING_REGISTRY` for runtime management. That means FluoShop is not limited to only compile-time schedules. Some jobs can be created, replaced, or removed at runtime.

```typescript
import { Inject } from '@fluojs/core';
import { SCHEDULING_REGISTRY, type SchedulingRegistry } from '@fluojs/cron';

export class CampaignWindowService {
  constructor(
    @Inject(SCHEDULING_REGISTRY)
    private readonly registry: SchedulingRegistry,
  ) {}

  scheduleFlashSaleWindow() {
    this.registry.addCron('campaign.flash-sale.close', '0 23 * * *', async () => {
      await this.campaigns.closeFlashSale();
    });
  }
}
```

This is powerful. It should still be used carefully. Dynamic schedules are best when business timing truly changes at runtime. They are not a reason to hide ordinary static maintenance tasks behind a registry call.

## 12.7 Bounded shutdown

One of the most practical notes in the README is about shutdown. `CronModule` drains active task executions during application shutdown, but only up to a bounded timeout. The documented default is `10_000ms`. After that, fluo logs a warning and continues shutdown. That is an operationally mature choice. One hung scheduler task should not block process termination forever.

### 12.7.1 Why this matters in FluoShop

Imagine a nightly settlement reconciliation talking to a slow partner API during a rolling deploy. Without bounded shutdown, a single stuck task might delay instance turnover indefinitely. With bounded shutdown, operators retain control. The task may need recovery logic. But the platform does not become impossible to redeploy.

## 12.8 Cron and queue together

Scheduling and queues often work best together. A cron task should usually decide that work must begin. A queue should often own the heavy execution. For example, a nightly cron can discover stale marketplace exports and enqueue one repair job per seller. That keeps the scheduler small and the background throughput controllable. It also creates a safer boundary for retries. Cron answers when to start. Queue answers how to process at scale. That combination is one of the most useful operational patterns in FluoShop.

## 12.9 A full cron and distributed-lock flow in FluoShop

At v2.1.0, the reservation expiry path now looks like this:

1. Every minute, each application instance reaches `checkout.expire-reservations`.
2. Distributed locking ensures only one instance performs the expiration run.
3. The task finds overdue reservations and expires them.
4. For any expensive cleanup, it enqueues follow-up jobs.
5. Read models update from the resulting events.
6. If the app is shutting down, the scheduler drains active work only within the configured timeout.

This flow is exactly what the plan of Part 2 has been building toward. Event-driven architecture is not only about reacting to user actions. It is also about reliable time-driven coordination in a distributed deployment.

## 12.10 FluoShop v2.1.0 progression

By the end of this chapter, FluoShop can respond to business facts and to time itself. That is a major architectural milestone. The platform can now model immediate reactions through events, orchestrated reactions through sagas, deferred reactions through queues, and periodic or delayed reactions through scheduling. Distributed locks keep multi-instance execution sane. Bounded shutdown keeps operations sane. Together, they make the system more trustworthy under real production conditions.

## 12.11 Summary

- `@fluojs/cron` gives FluoShop cron expressions, intervals, and timeouts through decorator-based scheduling.
- Redis-backed distributed locking ensures only one instance runs a scheduled task at a time in multi-instance deployments.
- `distributed.lockTtlMs` and optional named Redis clients are operational settings that shape reliability.
- dynamic scheduling through `SCHEDULING_REGISTRY` supports runtime-created tasks when the business genuinely needs it.
- bounded shutdown prevents a hung scheduled task from blocking process termination forever.

The practical lesson is that scheduling is easy to start and hard to run well. fluo makes it usable in production by pairing developer-friendly decorators with explicit distributed-lock and shutdown behavior.
