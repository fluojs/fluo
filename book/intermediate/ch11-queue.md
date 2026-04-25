<!-- packages: @fluojs/queue, @fluojs/redis -->
<!-- project-state: FluoShop v2.0.0 -->

# Chapter 11. Background Jobs and Queues

This chapter explains how to place a queue boundary on top of FluoShop's event-driven flow and move slow or failure-prone work out of the request path. Chapter 10 orchestrated long-running workflows. Now we treat follow-up work as an operable unit with retry, backoff, and dead-letter policies.

## Learning Objectives
- Understand why queues should move slow work outside the request path.
- Learn how to configure `QueueModule.forRoot()` together with a Redis connection.
- Explain that job payloads and worker implementations have different responsibilities.
- Summarize the criteria for choosing retry and backoff policies based on workload characteristics.
- Analyze how dead-letter handling lets operators track jobs that fail repeatedly.
- Compare when to choose an event handler, saga, or queue boundary.

## Prerequisites
- Completed Chapter 1, Chapter 2, Chapter 3, Chapter 4, Chapter 5, Chapter 6, Chapter 7, Chapter 8, Chapter 9, and Chapter 10.
- Basic understanding of Redis-based transport and background processing concepts.
- Basic intuition for retryable asynchronous work and operational failure response.

## 11.1 Why FluoShop needs queues

By v2.0.0, FluoShop already publishes domain events and coordinates multi-step workflows. But not every follow-up action is a good fit for immediate in-process handling. Examples include:

- sending bulk email batches
- generating invoice PDFs
- sending marketplace catalog syncs
- retrying warehouse label printing
- rebuilding expensive read projections

These tasks can be slow, may depend on unstable remote systems, and may need several retry attempts. Some may last minutes longer than the original web request. A Queue places this kind of work inside an explicit operational boundary.

## 11.2 Queue wiring in fluo

The README documents `QueueModule.forRoot(...)` as the supported root entrypoint. The Queue package depends on Redis for persistence and coordination. So FluoShop first connects `@fluojs/redis`, then registers queue support.

```typescript
import { Module } from '@fluojs/core';
import { RedisModule } from '@fluojs/redis';
import { QueueModule } from '@fluojs/queue';

@Module({
  imports: [
    RedisModule.forRoot({ host: 'localhost', port: 6379 }),
    QueueModule.forRoot(),
  ],
  providers: [InvoiceWorker, EmailWorker, CatalogSyncWorker],
})
export class BackgroundJobsModule {}
```

This contract keeps the same shape as the rest of fluo. A Module registers the package, Workers are discovered through decorators, and the application enqueues jobs through an injected lifecycle service.

## 11.3 Jobs and workers

A job is a serialized unit of work. A worker owns how that job is processed. This split is simple but important. The job payload is the durable handoff, while the worker implementation can evolve independently behind that boundary.

### 11.3.1 Invoice generation job

Invoice PDF generation is a typical queue task. It takes too long to run inside the checkout confirmation path. It may also fail for temporary reasons such as file storage or rendering outages.

```typescript
import { QueueWorker } from '@fluojs/queue';

export class GenerateInvoiceJob {
  constructor(public readonly orderId: string) {}
}

@QueueWorker(GenerateInvoiceJob, {
  attempts: 5,
  backoff: { type: 'exponential', delayMs: 1_000 },
})
export class InvoiceWorker {
  async handle(job: GenerateInvoiceJob) {
    await this.invoices.renderAndStore(job.orderId);
  }
}
```

Worker options are part of the design. Retry and backoff are not after-the-fact corrections. They are a contract that expresses how much transient failure the business is willing to absorb.

### 11.3.2 Enqueue after a business event

FluoShop often enqueues a job after a domain event or saga step. This keeps the request path short without losing the business action.

```typescript
import { Inject } from '@fluojs/core';
import { QueueLifecycleService } from '@fluojs/queue';

@Inject(QueueLifecycleService)
export class BillingProjectionHandler {
  constructor(private readonly queue: QueueLifecycleService) {}

  async onShipmentDispatched(orderId: string) {
    await this.queue.enqueue(new GenerateInvoiceJob(orderId));
  }
}
```

The domain flow remains explicit, and only the slow work moves out of band.

## 11.4 Retry and backoff strategy

The queue README highlights distributed retry and backoff as first-class features. That maps directly to real operational needs. FluoShop cannot assume every remote dependency is stable. Email providers fail temporarily, storage systems have short outages, and Marketplace APIs may throttle without warning. Retry gives the system room to recover automatically under those conditions, while backoff prevents an outage from turning immediately into a retry storm.

### 11.4.1 Fixed versus exponential backoff

Fixed backoff is easy to predict. Exponential backoff is often safer for dependencies under load. FluoShop should choose based on the remote system's characteristics. A warehouse printer reconnect can tolerate a short fixed delay, while a marketplace catalog push may fit exponential backoff better. The key is not to treat retry policy as a default copied onto every job.

## 11.5 Dead-letter handling

Some jobs still fail after every retry attempt. Those jobs must not disappear silently. The Queue package moves them to a Redis dead-letter list under `fluo:queue:dead-letter:<jobName>`. That list gives operators a durable place to inspect what failed. The README also states the default retention policy. Without separate configuration, `QueueModule.forRoot()` keeps the most recent `1_000` dead-letter entries per job. This is an important operational default. It prevents unbounded growth while preserving recent failure evidence.

### 11.5.1 What FluoShop stores in dead letters

In v2.0.0, dead letters matter most for integration-heavy work. Failed invoice renders, failed marketplace syncs, and failed bulk notification exports are representative examples. Operators need enough job payload context to diagnose failures safely. At the same time, job bodies must not contain secrets or unnecessary personal data. A dead letter is operational evidence. It should be useful, but its scope should stay limited.

## 11.6 Named Redis clients and workload isolation

The README describes `clientName` support for non-default Redis registration. This option is needed in deployments where queue traffic should not compete with other Redis-backed features. FluoShop can keep the default Redis client for cache and lightweight coordination, then dedicate a separate named Redis client to background jobs.

```typescript
QueueModule.forRoot({ clientName: 'jobs' })
```

This is not a code-style trick. It is a deployment decision. Workload isolation reduces noisy-neighbor effects and makes capacity planning clearer.

## 11.7 Queue flow in FluoShop

In v2.0.0, a representative background flow looks like this:

1. Checkout stores the order.
2. The write side publishes `OrderPlacedEvent`.
3. A saga proceeds with the fulfillment command.
4. `ShipmentDispatchedEvent` is published.
5. Billing reacts and enqueues `GenerateInvoiceJob`.
6. `InvoiceWorker` processes the job in the background.
7. If rendering fails temporarily, retry and backoff apply.
8. If it still fails, the job remains in the dead-letter list.

This boundary is operationally better than generating the PDF inline. The customer gets a timely API response, operators get a controlled failure model, and the system keeps room to recover.

## 11.8 Queue workers are not a second hidden application

Teams sometimes make the mistake of moving unclear logic into a worker and calling that architecture. FluoShop should avoid that trap. A worker should own background execution, not hidden business ownership. The command side should still decide which business step is needed, and the event side should still express why the follow-up action exists. Queue answers a different question: when and how should slow work be processed reliably? Keeping that split makes the platform understandable.

## 11.9 When to choose event handlers, sagas, or queues

At this point, FluoShop has all three. That makes selection rules important. If the reaction is fast and local, use an ordinary event handler. If an event should trigger the next explicit command in a business workflow, use a saga. If the work is slow, failure-prone, retryable, and should be operationally separated from the initiating request, use a queue. These tools complement each other. They are not competitors. Most mature systems need all three.

## 11.10 FluoShop v2.0.0 progression

As FluoShop moves to v2.0.0, it no longer stops at being event-aware. It recognizes background work as a first-class operational concern. Fulfillment can stay responsive while downstream work continues safely. Failures can be retried instead of immediately becoming support tickets, and operators can inspect durable dead letters instead of reconstructing lost state from logs. That is the value queues add to event-driven architecture. They turn deferred work into an explicitly managed subsystem.

## 11.11 Summary

- `@fluojs/queue` gives FluoShop Redis-backed background job processing with worker discovery and lifecycle-managed enqueueing.
- A job is a durable handoff for slow or failure-prone work such as invoice generation, email batches, and catalog syncs.
- Retry attempts and backoff strategies should be chosen per workload rather than copied uncritically.
- The dead-letter list preserves repeatedly failed jobs under a bounded retention policy so operators can inspect them.
- FluoShop v2.0.0 now moves expensive post-order work behind a queue boundary instead of extending the customer request path.

The practical standard is clear. If work is slow, retryable, and operationally distinct, a queue is likely a better fit than another synchronous callback in the main flow.
