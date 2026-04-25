<!-- packages: @fluojs/cron, @fluojs/redis -->
<!-- project-state: FluoShop v2.1.0 -->

# Chapter 12. Scheduling and Distributed Locks

This chapter explains how to introduce time-based work into FluoShop and how to design a scheduling boundary that stays distinct from queues. In Chapter 11, work that had already happened was handed off to background jobs. Now FluoShop runs work at fixed times and intervals, including distributed locks, in a way that is safe to operate.

## Learning Objectives
- Understand that a scheduler has a different start condition than an event or a queue.
- Learn how to register cron, interval, and timeout tasks with `CronModule.forRoot()`.
- Explain why distributed locking is necessary in multi-instance environments.
- Summarize how lock TTL and named Redis clients affect operational reliability.
- Analyze cases where dynamic scheduling must be handled through a runtime registry.
- Explain how bounded shutdown protects long-running work and deployment stability together.

## Prerequisites
- Completion of Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9, Chapter 10, and Chapter 11.
- A basic understanding of Redis coordination and time-based job execution.
- Operational intuition for multi-instance deployment and graceful shutdown.

## 12.1 Why FluoShop needs scheduling

By v2.1.0, FluoShop can already react to commands, events, sagas, and queued jobs. Even so, some work does not start from a request or a new domain event. Time itself is the start condition. Examples include:

- expiring unpaid reservations every minute
- reconciling marketplace settlement files every hour
- cleaning abandoned upload artifacts every night
- running a delayed warm-up task after startup
- polling an external fulfillment partner at a fixed interval

These are scheduling concerns. They are not naturally expressed as one-time commands sent by a user. When the application runs across multiple instances, they also need operational safeguards that prevent duplicate execution.

## 12.2 Cron module wiring

The README documents `CronModule.forRoot(...)` as the registration entrypoint. fluo supports cron expressions, fixed intervals, and one-time timeouts.

```typescript
import { Module } from '@fluojs/core';
import { CronModule } from '@fluojs/cron';

@Module({
  imports: [CronModule.forRoot()],
  providers: [ReservationExpiryService, SettlementService],
})
export class SchedulingModule {}
```

The design is consistent with the previous chapters. The package is registered at the Module boundary, and scheduled behavior is expressed with decorators on Providers. Lifecycle management belongs to the framework package, not to handwritten bootstrap glue.

## 12.3 Cron, interval, and timeout flows

The package exposes three main scheduling shapes. `@Cron` is for calendar-style schedules, `@Interval` is for fixed-rate repeated work, and `@Timeout` is for delayed work that runs once after startup. FluoShop uses all three forms.

### 12.3.1 Reservation expiry cron

Unpaid reservations must expire regularly. This is a natural cron task. Checking stale reservations on every user request would make the response path unnecessarily heavy, so time-based cleanup is clearer when it is separated into its own schedule.

```typescript
import { Cron, CronExpression } from '@fluojs/cron';

export class ReservationExpiryService {
  @Cron(CronExpression.EVERY_MINUTE, { name: 'checkout.expire-reservations' })
  async expireStaleReservations() {
    await this.reservations.expireOlderThanMinutes(15);
  }
}
```

This is time-based maintenance tied to a business rule. The schedule is part of the behavior contract. How often it runs is not just an operations setting, but also a policy for how long inventory may remain reserved.

### 12.3.2 Startup timeout and periodic polling

Some work should run after a certain amount of time has passed since boot. For example, FluoShop can perform an initial cache warm-up or configuration sync five seconds after startup. Other work can poll a partner API every 15 seconds. These flows map naturally to `@Timeout` and `@Interval`. The key point is that fluo treats them as first-class scheduling concepts, not improvised `setTimeout` or `setInterval` calls scattered through bootstrap code.

## 12.4 Distributed locking across multiple instances

The README highlights distributed mode as a core production feature. When multiple application instances run the same scheduled task, FluoShop usually wants only one instance to perform that cycle's work. Redis-backed distributed locking owns that responsibility.

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

This is not an optional detail in serious deployments. Without distributed locking, every instance can expire the same reservations, run the same reconciliation, and enqueue the same downstream jobs. That can become both a data correctness problem and an infrastructure cost problem.

### 12.4.1 The lock flow in FluoShop

In v2.1.0, the distributed cron flow works like this:

1. Multiple FluoShop instances reach the same schedule boundary.
2. Each instance attempts to acquire the Redis lock for the named job.
3. One instance wins and runs the task.
4. The rest skip execution for that cycle.
5. The winning instance renews the lock while the task is still active.
6. When execution ends, the lock expires or is released.

This pattern is easy to explain. That is a good sign. Distributed coordination should be explicit enough for operators to reason about during incidents.

## 12.5 Lock TTL and named Redis clients

The README sets an important boundary. `distributed.lockTtlMs` must be at least `1_000ms`. fluo validates that minimum boundary and renews the lock before the TTL expires. This tells the FluoShop team two things. First, lock duration is a real operational parameter. Second, values that are too small are not clever optimizations. They are reliability risks. The package also supports `distributed.clientName` for non-default Redis connections. That option is needed when lock traffic should be separated from cache or queue traffic.

## 12.6 Dynamic scheduling at runtime

The README also documents `SCHEDULING_REGISTRY` for runtime management. FluoShop is therefore not limited to compile-time schedules. Some jobs can be created, replaced, or removed at runtime.

```typescript
import { Inject } from '@fluojs/core';
import { SCHEDULING_REGISTRY, type SchedulingRegistry } from '@fluojs/cron';

@Inject(SCHEDULING_REGISTRY)
export class CampaignWindowService {
  constructor(private readonly registry: SchedulingRegistry) {}

  scheduleFlashSaleWindow() {
    this.registry.addCron('campaign.flash-sale.close', '0 23 * * *', async () => {
      await this.campaigns.closeFlashSale();
    });
  }
}
```

This feature is powerful, so it should be used with care. A dynamic schedule is the right fit when business timing truly changes at runtime. It does not mean ordinary static maintenance tasks should be hidden behind registry calls.

## 12.7 Bounded shutdown

One of the most practical parts of the README is its shutdown behavior. `CronModule` drains active task executions during application shutdown, but only up to a bounded timeout. The documented default is `10_000ms`. After that, fluo leaves a warning and continues shutdown. This is an operationally mature choice because one hung scheduler task must not block process termination forever.

### 12.7.1 Why this matters in FluoShop

Imagine that nightly settlement reconciliation is talking to a slow partner API during a rolling deploy. Without bounded shutdown, one stuck task could delay instance turnover indefinitely. With bounded shutdown, operators retain control. That task may need recovery logic, but the platform itself does not become impossible to redeploy.

## 12.8 Cron and queue together

Scheduling and queues often work best together. A cron task should usually only decide that work needs to start. A queue is a better owner for heavy execution. For example, a nightly cron can find stale marketplace exports and enqueue one repair job per seller. The scheduler stays small, and background throughput remains controllable. This also creates a safer boundary for retries. Cron answers when to start, and Queue answers how to process at scale. This combination is one of the most useful operational patterns in FluoShop.

## 12.9 A full cron and distributed-lock flow in FluoShop

In v2.1.0, the reservation expiry path now works like this:

1. Every minute, all application instances reach `checkout.expire-reservations`.
2. Distributed locking ensures that only one instance performs the expiration run.
3. The task finds and expires overdue reservations.
4. If there is expensive cleanup, it enqueues follow-up jobs.
5. Read models update from the resulting events.
6. If the app is shutting down, the scheduler drains active work only within the configured timeout.

This flow connects with the goal Part 2 has been building toward. Event-driven architecture does not only mean reacting to user actions. It also includes reliable time-driven coordination in distributed deployments.

## 12.10 FluoShop v2.1.0 progression

By the end of this chapter, FluoShop can react both to business facts and to time itself. This is an important architectural milestone. The platform can now model immediate reactions through events, orchestrated reactions through sagas, deferred reactions through queues, and periodic or delayed reactions through scheduling. Distributed locks keep multi-instance execution predictable. Bounded shutdown keeps operations under control. Together, they improve system reliability under real production conditions.

## 12.11 Summary

- `@fluojs/cron` gives FluoShop cron expressions, intervals, and timeouts through decorator-based scheduling.
- Redis-backed distributed locking ensures that only one instance runs a scheduled task in multi-instance deployments.
- `distributed.lockTtlMs` and optional named Redis clients are operational settings that determine reliability.
- Dynamic scheduling through `SCHEDULING_REGISTRY` is supported when the business truly needs runtime-created tasks.
- Bounded shutdown prevents one hung scheduled task from blocking process termination forever.

The practical lesson is that scheduling is easy to start but hard to operate well. fluo combines developer-friendly decorators with explicit distributed-lock and shutdown behavior so scheduling remains manageable in production.
